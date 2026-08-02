"use strict";
/**
 * Ledger operations for the v2 entities — earning rows, deduction elections,
 * payments, and the change audit log.
 *
 * payroll-store.ts still owns the v1 scalar path (kept working so no shipped
 * install breaks); this module owns the row-based model and the records a real
 * payroll system is expected to be able to produce afterwards: what was paid,
 * how it was sent, and who changed what.
 *
 * THE AUDIT LOG IS THE POINT of half this file. An employee's rate, W-4 or
 * garnishment changing with no before/after record is the single thing an
 * auditor, an unemployment claim, or a wage dispute will ask for and this app
 * previously could not answer. Every master-data write goes through
 * `recordAudit` in the SAME transaction as the change, so the trail can never
 * disagree with the store.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 19:00:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — append-only change audit, earning-row and deduction-election persistence, the v2 line assembly that stores per-check earning + deduction ROWS, payment records with check-number uniqueness, and the arrears write-back that makes a carried balance real rather than advisory.
 *
 * @module payroll-ledger
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordAudit = recordAudit;
exports.auditTrail = auditTrail;
exports.setLineEarnings = setLineEarnings;
exports.getLineEarnings = getLineEarnings;
exports.getDeductionRows = getDeductionRows;
exports.recomputeLineV2 = recomputeLineV2;
exports.settleDeductionBalances = settleDeductionBalances;
exports.createPayments = createPayments;
const crypto = __importStar(require("crypto"));
const payroll_payrun_1 = require("./payroll-payrun");
const payroll_codes_1 = require("./payroll-codes");
const payroll_store_1 = require("./payroll-store");
/** Fields never written to the audit trail in the clear. */
const REDACTED_COLUMNS = ['ssn_encrypted', 'ein_encrypted', 'routing_encrypted', 'account_encrypted'];
/** Strip encrypted blobs from an audited snapshot — the trail records that a value CHANGED, never the value. */
function redact(row) {
    if (!row)
        return null;
    const out = {};
    for (const [k, v] of Object.entries(row))
        out[k] = REDACTED_COLUMNS.includes(k) ? (v ? '[encrypted]' : null) : v;
    return out;
}
/**
 * @description Append a change to the audit log.
 * @param q - Pool or transaction client — pass the CLIENT so the trail commits with the change.
 * @param sub - Owning OIDC sub.
 * @param entity - Table/entity name.
 * @param entityId - The row's id.
 * @param action - create | update | delete | approve | void | pay.
 * @param actor - Who did it.
 * @param before - Row state before, or null on create.
 * @param after - Row state after, or null on delete.
 */
async function recordAudit(q, sub, entity, entityId, action, actor, before, after) {
    await q.query(`INSERT INTO payroll_audit (user_sub, entity, entity_id, action, actor, before_json, after_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`, [sub, entity, entityId, action, actor,
        JSON.stringify(redact(before)), JSON.stringify(redact(after))]);
}
/** The audit trail for one entity, newest first. */
async function auditTrail(pool, sub, entity, entityId) {
    const r = await pool.query(`SELECT audit_id, action, actor, before_json, after_json, at
       FROM payroll_audit WHERE user_sub = $1 AND entity = $2 AND entity_id = $3
      ORDER BY at DESC, audit_id DESC LIMIT 200`, [sub, entity, entityId]);
    return r.rows;
}
/** Replace the earning rows for one check. */
async function setLineEarnings(q, sub, runId, employeeId, rows) {
    await q.query('DELETE FROM payroll_line_earnings WHERE user_sub = $1 AND run_id = $2 AND employee_id = $3 AND derived = false', [sub, runId, employeeId]);
    for (const r of rows) {
        await q.query(`INSERT INTO payroll_line_earnings
         (earning_id, user_sub, run_id, employee_id, code, hours, rate_cents, amount_cents, workweek, memo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [crypto.randomUUID(), sub, runId, employeeId, String(r.code || '').toUpperCase(),
            (0, payroll_store_1.num)(r.hours), (0, payroll_store_1.money)(r.rateCents), (0, payroll_store_1.money)(r.amountCents),
            Math.max(1, Math.trunc((0, payroll_store_1.num)(r.workweek, 1)) || 1), String(r.memo || '')]);
    }
}
/** The operator-entered earning rows for one check (derived premium rows excluded). */
async function getLineEarnings(q, sub, runId, employeeId) {
    const r = await q.query(`SELECT code, hours, rate_cents, amount_cents, workweek, memo
       FROM payroll_line_earnings
      WHERE user_sub = $1 AND run_id = $2 AND employee_id = $3 AND derived = false
      ORDER BY workweek, created_at`, [sub, runId, employeeId]);
    return r.rows.map((x) => ({
        code: String(x.code), hours: (0, payroll_store_1.num)(x.hours), rateCents: (0, payroll_store_1.money)(x.rate_cents),
        amountCents: (0, payroll_store_1.money)(x.amount_cents), workweek: (0, payroll_store_1.num)(x.workweek, 1), memo: String(x.memo || ''),
    }));
}
/** The active deduction elections for an employee, as engine rows. */
async function getDeductionRows(q, sub, employeeId, onDate) {
    const r = await q.query(`SELECT * FROM payroll_deduction_elections
      WHERE user_sub = $1 AND employee_id = $2 AND active = true
        AND (effective_from IS NULL OR effective_from <= $3)
        AND (effective_to IS NULL OR effective_to >= $3)
      ORDER BY code`, [sub, employeeId, onDate]);
    return r.rows.map((e) => ({
        code: String(e.code),
        amountCents: (0, payroll_store_1.money)(e.amount_cents),
        percentOfGross: e.percent_of_gross === null || e.percent_of_gross === undefined ? undefined : (0, payroll_store_1.num)(e.percent_of_gross),
        annualLimitCents: e.annual_limit_cents === null || e.annual_limit_cents === undefined ? undefined : (0, payroll_store_1.money)(e.annual_limit_cents),
        ytdCents: (0, payroll_store_1.money)(e.ytd_cents),
        arrearsCents: (0, payroll_store_1.money)(e.arrears_cents),
        supportCcpaPct: e.support_ccpa_pct === null || e.support_ccpa_pct === undefined ? undefined : (0, payroll_store_1.num)(e.support_ccpa_pct),
    }));
}
/** Persist what each deduction actually did on this check. */
async function storeLineDeductions(q, sub, runId, employeeId, check) {
    await q.query('DELETE FROM payroll_line_deductions WHERE user_sub = $1 AND run_id = $2 AND employee_id = $3', [sub, runId, employeeId]);
    for (const d of check.deductions) {
        await q.query(`INSERT INTO payroll_line_deductions
         (deduction_id, user_sub, run_id, employee_id, code, requested_cents, applied_cents, arrears_added_cents, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [crypto.randomUUID(), sub, runId, employeeId, d.code,
            d.requestedCents, d.appliedCents, d.arrearsAddedCents, d.reason || '']);
    }
}
/** Persist the derived FLSA premium rows so the register shows where they came from. */
async function storeDerivedEarnings(q, sub, runId, employeeId, check) {
    await q.query('DELETE FROM payroll_line_earnings WHERE user_sub = $1 AND run_id = $2 AND employee_id = $3 AND derived = true', [sub, runId, employeeId]);
    for (const e of check.earnings) {
        if (!String(e.memo || '').includes('derived') && !String(e.memo || '').includes('top-up'))
            continue;
        await q.query(`INSERT INTO payroll_line_earnings
         (earning_id, user_sub, run_id, employee_id, code, hours, rate_cents, amount_cents, workweek, gross_cents, derived, memo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11)`, [crypto.randomUUID(), sub, runId, employeeId, e.code, (0, payroll_store_1.num)(e.hours), (0, payroll_store_1.money)(e.rateCents),
            (0, payroll_store_1.money)(e.amountCents), (0, payroll_store_1.num)(e.workweek, 1), (0, payroll_store_1.money)(e.grossCents), String(e.memo || '')]);
    }
}
/**
 * @description Compute and persist ONE check from earning rows + elections, and
 * store the per-row detail a register and a stub need.
 * @param q - Pool or transaction client.
 * @param sub - Owning OIDC sub.
 * @param run - The run row.
 * @param emp - The employee row.
 * @param earnings - Operator-entered earning rows.
 * @param deductions - Resolved deduction elections.
 * @param opts - Engine options (periods, age, state, ytd, employer tax, suppression).
 * @returns The computed check.
 */
async function recomputeLineV2(q, sub, run, emp, earnings, deductions, opts) {
    const check = (0, payroll_payrun_1.computeCheck)(earnings, deductions, {
        filingStatus: emp.filing_status || 'single',
        step2: emp.w4_step2 === true,
        dependentsCreditCents: (0, payroll_store_1.money)(emp.w4_dependents_credit_cents),
        otherIncomeCents: (0, payroll_store_1.money)(emp.w4_other_income_cents),
        deductionsCents: (0, payroll_store_1.money)(emp.w4_deductions_cents),
        extraWithholdingCents: (0, payroll_store_1.money)(emp.w4_extra_withholding_cents),
        exempt: emp.w4_exempt === true,
    }, opts);
    const t = check.taxes;
    await q.query(`INSERT INTO payroll_run_lines (
        run_id, employee_id, user_sub, gross_cents, cash_earnings_cents, imputed_cents,
        nontaxable_paid_cents, fit_taxable_cents, fica_taxable_cents, ss_taxable_cents,
        supplemental_taxable_cents, fit_cents, supplemental_fit_cents, ss_cents, medicare_cents,
        addl_medicare_cents, state_cents, pretax_cents, posttax_cents, garnishment_cents,
        disposable_cents, qualified_ot_cents, tips_cents, net_cents, er_ss_cents, er_medicare_cents,
        futa_cents, suta_cents, uses_earning_rows, workweek_hours, computed, warnings, updated_at)
     SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,true,$29,$30,$31,now()
      WHERE EXISTS (SELECT 1 FROM payroll_runs r WHERE r.run_id = $1 AND r.user_sub = $3 AND r.status = 'draft')
     ON CONFLICT (run_id, employee_id) DO UPDATE SET
        gross_cents = EXCLUDED.gross_cents, cash_earnings_cents = EXCLUDED.cash_earnings_cents,
        imputed_cents = EXCLUDED.imputed_cents, nontaxable_paid_cents = EXCLUDED.nontaxable_paid_cents,
        fit_taxable_cents = EXCLUDED.fit_taxable_cents, fica_taxable_cents = EXCLUDED.fica_taxable_cents,
        ss_taxable_cents = EXCLUDED.ss_taxable_cents, supplemental_taxable_cents = EXCLUDED.supplemental_taxable_cents,
        fit_cents = EXCLUDED.fit_cents, supplemental_fit_cents = EXCLUDED.supplemental_fit_cents,
        ss_cents = EXCLUDED.ss_cents, medicare_cents = EXCLUDED.medicare_cents,
        addl_medicare_cents = EXCLUDED.addl_medicare_cents, state_cents = EXCLUDED.state_cents,
        pretax_cents = EXCLUDED.pretax_cents, posttax_cents = EXCLUDED.posttax_cents,
        garnishment_cents = EXCLUDED.garnishment_cents, disposable_cents = EXCLUDED.disposable_cents,
        qualified_ot_cents = EXCLUDED.qualified_ot_cents, tips_cents = EXCLUDED.tips_cents,
        net_cents = EXCLUDED.net_cents, er_ss_cents = EXCLUDED.er_ss_cents,
        er_medicare_cents = EXCLUDED.er_medicare_cents, futa_cents = EXCLUDED.futa_cents,
        suta_cents = EXCLUDED.suta_cents, uses_earning_rows = true,
        workweek_hours = EXCLUDED.workweek_hours, computed = EXCLUDED.computed,
        warnings = EXCLUDED.warnings, updated_at = now()`, [run.run_id, emp.employee_id, sub, check.grossCents, check.cashEarningsCents, check.imputedCents,
        check.nontaxablePaidCents, check.bases.fitCents, check.bases.ficaCents, t.ssTaxableCents,
        check.bases.supplementalCents, t.fitCents, t.supplementalFitCents, t.ssCents, t.medicareCents,
        t.addlMedicareCents, t.stateCents, check.preTaxCents, check.postTaxCents, check.garnishmentCents,
        check.disposableEarningsCents, check.qualifiedOvertimeCents, check.reportedTipsCents, check.netCents,
        t.employer.ssCents, t.employer.medicareCents, t.employer.futaCents, t.employer.sutaCents,
        JSON.stringify(check.workweekHours), JSON.stringify(check), JSON.stringify(check.warnings)]);
    await storeDerivedEarnings(q, sub, String(run.run_id), String(emp.employee_id), check);
    await storeLineDeductions(q, sub, String(run.run_id), String(emp.employee_id), check);
    return check;
}
/**
 * @description Write back what each deduction consumed: YTD toward its annual
 * ceiling, and the arrears balance carried forward.
 *
 * Called only at APPROVAL, never on a draft recompute — otherwise editing a
 * draft twice would double-count the year-to-date and shrink the ceiling.
 * @param q - Transaction client.
 * @param sub - Owning OIDC sub.
 * @param runId - The run being approved.
 */
async function settleDeductionBalances(q, sub, runId) {
    const rows = (await q.query(`SELECT employee_id, code, applied_cents, arrears_added_cents
       FROM payroll_line_deductions WHERE user_sub = $1 AND run_id = $2`, [sub, runId])).rows;
    for (const d of rows) {
        const def = (0, payroll_codes_1.deductionCode)(String(d.code));
        if (!def)
            continue;
        await q.query(`UPDATE payroll_deduction_elections
          SET ytd_cents = ytd_cents + $4,
              lifetime_cents = lifetime_cents + $4,
              arrears_cents = GREATEST(0, arrears_cents - $4 + $5),
              updated_at = now()
        WHERE user_sub = $1 AND employee_id = $2 AND code = $3 AND active = true`, [sub, d.employee_id, d.code, (0, payroll_store_1.money)(d.applied_cents), (0, payroll_store_1.money)(d.arrears_added_cents)]);
    }
}
/**
 * @description Create the payment records for an approved run — one per employee,
 * split across their direct-deposit accounts in split order with the remainder to
 * the last, or a single check row when they are paid by check.
 *
 * This app does not move money. Recording HOW it was sent is what makes the
 * register reconcile against a bank statement afterwards, which is the whole
 * reason the record matters.
 * @param q - Transaction client.
 * @param sub - Owning OIDC sub.
 * @param runId - The approved run.
 * @param payDate - Issue date.
 * @returns Number of payment rows written.
 */
async function createPayments(q, sub, runId, payDate) {
    const lines = (await q.query(`SELECT l.employee_id, l.net_cents, e.pay_method
       FROM payroll_run_lines l
       JOIN payroll_employees e ON e.employee_id = l.employee_id AND e.user_sub = l.user_sub
      WHERE l.user_sub = $1 AND l.run_id = $2 AND l.net_cents <> 0`, [sub, runId])).rows;
    let written = 0;
    for (const line of lines) {
        const net = Number(line.net_cents);
        const accounts = line.pay_method === 'direct_deposit'
            ? (await q.query(`SELECT * FROM payroll_bank_accounts
          WHERE user_sub = $1 AND employee_id = $2 AND active = true ORDER BY split_order`, [sub, line.employee_id])).rows
            : [];
        if (!accounts.length) {
            await q.query(`INSERT INTO payroll_payments (payment_id, user_sub, run_id, employee_id, method, amount_cents, status, issued_on)
         VALUES ($1,$2,$3,$4,'check',$5,'pending',$6)`, [crypto.randomUUID(), sub, runId, line.employee_id, net, payDate]);
            written += 1;
            continue;
        }
        let remaining = net;
        for (let i = 0; i < accounts.length; i += 1) {
            const a = accounts[i];
            const isLast = i === accounts.length - 1;
            let amount;
            if (isLast) {
                amount = remaining; // the remainder always lands on the last account
            }
            else if (a.split_percent !== null && a.split_percent !== undefined) {
                amount = Math.min(remaining, Math.round((net * (0, payroll_store_1.num)(a.split_percent)) / 100));
            }
            else {
                amount = Math.min(remaining, (0, payroll_store_1.money)(a.split_amount_cents));
            }
            if (amount <= 0)
                continue;
            remaining -= amount;
            await q.query(`INSERT INTO payroll_payments (payment_id, user_sub, run_id, employee_id, method, amount_cents, bank_account_id, status, issued_on)
         VALUES ($1,$2,$3,$4,'direct_deposit',$5,$6,'pending',$7)`, [crypto.randomUUID(), sub, runId, line.employee_id, amount, a.account_id, payDate]);
            written += 1;
        }
    }
    return written;
}
//# sourceMappingURL=payroll-ledger.js.map