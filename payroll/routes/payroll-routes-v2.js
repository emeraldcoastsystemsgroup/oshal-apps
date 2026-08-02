"use strict";
/**
 * v2 HTTP surface — identity, elections, earning rows, gross-up, payments,
 * the audit trail, and the reports that connect payroll to accounting.
 *
 * Mounted by createPayrollRoutes onto the same router, so everything still lives
 * under /api/payroll behind one OIDC gate. Split into its own module because
 * payroll-routes.ts was approaching the file cap and these are a coherent set.
 *
 * THE SSN RULE, enforced here rather than merely documented: exactly ONE route
 * returns a full Social Security number, it requires an explicit confirm, and it
 * writes an audit row before returning. Every other route sees ***-**-1234.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 20:00:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — employer/employee legal identity with encrypted SSN + EIN and the single audited full-SSN read, direct-deposit accounts, effective-dated deduction elections, per-check earning rows with the v2 recompute, gross-up, payment records, the change-audit reader, and the GL journal / deposit schedule / deduction register / labor distribution reports.
 *
 * @module payroll-routes-v2
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
exports.createPayments = void 0;
exports.registerV2Routes = registerV2Routes;
const crypto = __importStar(require("crypto"));
const explicit_write_confirmation_1 = require("@/shared/security/explicit-write-confirmation");
const payroll_codes_1 = require("./payroll-codes");
const payroll_grossup_1 = require("./payroll-grossup");
const payroll_ledger_1 = require("./payroll-ledger");
Object.defineProperty(exports, "createPayments", { enumerable: true, get: function () { return payroll_ledger_1.createPayments; } });
const payroll_identity_1 = require("./payroll-identity");
const payroll_reports_1 = require("./payroll-reports");
const payroll_nacha_1 = require("./payroll-nacha");
const payroll_forms_1 = require("./payroll-forms");
const payroll_tax_tables_1 = require("./payroll-tax-tables");
const payroll_store_1 = require("./payroll-store");
/** Fetch a row owned by the caller. */
async function owned(ctx, table, idCol, id, sub) {
    const r = await ctx.pool.query(`SELECT * FROM ${table} WHERE ${idCol} = $1 AND user_sub = $2`, [id, sub]);
    return r.rows[0] || null;
}
/** Engine options for one employee on one run. */
async function engineOpts(ctx, sub, run, emp) {
    const company = await (0, payroll_store_1.getCompany)(ctx.pool, sub);
    const payDate = (0, payroll_store_1.isoDate)(run.pay_date);
    const year = Number(payDate.slice(0, 4));
    return {
        periodsPerYear: payroll_tax_tables_1.PAY_PERIODS[String(run.pay_frequency)] || 26,
        age: (0, payroll_store_1.ageAtYearEnd)(emp.birth_date, year),
        state: {
            code: String(emp.state_code || company.state_code || ''),
            manualRatePct: (0, payroll_store_1.num)(emp.state_rate_pct),
            allowances: (0, payroll_store_1.num)(emp.state_allowances),
        },
        ytd: await (0, payroll_store_1.ytdBefore)(ctx.pool, sub, emp, payDate, String(run.run_id)),
        employerTax: {
            sutaRatePct: (0, payroll_store_1.num)(company.suta_rate_pct, payroll_tax_tables_1.DEFAULT_SUTA_RATE_PCT),
            sutaWageBaseCents: (0, payroll_store_1.money)(company.suta_wage_base_cents, payroll_tax_tables_1.DEFAULT_SUTA_WAGE_BASE_CENTS),
            futaCreditReductionPct: (0, payroll_store_1.num)(company.futa_credit_reduction_pct),
            minimumWageCents: (0, payroll_tax_tables_1.minimumWageCents)(String(emp.state_code || company.state_code || ''), payDate),
        },
        suppressVoluntaryDeductions: run.suppress_voluntary === true,
    };
}
/** Register identity + PII routes. */
function identityRoutes(router, ctx, guarded) {
    router.put('/company/identity', guarded('company.identity', async (req, res, sub) => {
        const b = (req.body || {});
        const before = await (0, payroll_store_1.getCompany)(ctx.pool, sub);
        const ein = (0, payroll_identity_1.normalizeEin)(b.ein);
        if (b.ein && !ein) {
            res.status(400).json({ error: 'bad_ein', message: 'An EIN must be 9 digits.' });
            return;
        }
        const r = await ctx.pool.query(`UPDATE payroll_company SET legal_name=$2, trade_name=$3, address_line1=$4, address_line2=$5,
              city=$6, postal_code=$7, state_account_number=$8, depositor_status=$9,
              workweek_start_day=$10, ein_encrypted=COALESCE($11, ein_encrypted),
              ein_last4=COALESCE($12, ein_last4), updated_at=now()
        WHERE user_sub=$1 RETURNING *`, [sub, String(b.legalName || '').slice(0, 200), String(b.tradeName || '').slice(0, 200),
            String(b.addressLine1 || '').slice(0, 200), String(b.addressLine2 || '').slice(0, 200),
            String(b.city || '').slice(0, 100), String(b.postalCode || '').slice(0, 20),
            String(b.stateAccountNumber || '').slice(0, 40),
            b.depositorStatus === 'semiweekly' ? 'semiweekly' : 'monthly',
            Math.min(6, Math.max(0, Math.trunc((0, payroll_store_1.num)(b.workweekStartDay)))),
            ein ? (0, payroll_identity_1.sealIdentifier)(sub, ein) : null, ein ? (0, payroll_identity_1.last4)(ein) : null]);
        await (0, payroll_ledger_1.recordAudit)(ctx.pool, sub, 'company', sub, 'update', sub, before, r.rows[0]);
        res.json({ company: (0, payroll_store_1.scrubSecrets)(r.rows[0]) });
    }));
    router.put('/employees/:id/identity', guarded('employee.identity', async (req, res, sub) => {
        const b = (req.body || {});
        const id = String(req.params.id);
        const before = await owned(ctx, 'payroll_employees', 'employee_id', id, sub);
        if (!before) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const ssn = b.ssn === undefined || b.ssn === '' ? null : (0, payroll_identity_1.normalizeSsn)(b.ssn);
        if (b.ssn && !ssn) {
            res.status(400).json({ error: 'bad_ssn', message: 'That is not a structurally valid Social Security number.' });
            return;
        }
        const r = await ctx.pool.query(`UPDATE payroll_employees SET address_line1=$3, address_line2=$4, city=$5, postal_code=$6,
              worker_type=$7, flsa_exempt=$8, department=$9, cost_center=$10, work_location=$11,
              pay_method=$12, ssn_encrypted=COALESCE($13, ssn_encrypted),
              ssn_last4=COALESCE($14, ssn_last4), updated_at=now()
        WHERE employee_id=$1 AND user_sub=$2 RETURNING *`, [id, sub, String(b.addressLine1 || '').slice(0, 200), String(b.addressLine2 || '').slice(0, 200),
            String(b.city || '').slice(0, 100), String(b.postalCode || '').slice(0, 20),
            b.workerType === '1099' ? '1099' : 'w2', b.flsaExempt === true,
            String(b.department || '').slice(0, 80), String(b.costCenter || '').slice(0, 80),
            String(b.workLocation || '').slice(0, 80),
            b.payMethod === 'direct_deposit' ? 'direct_deposit' : 'check',
            ssn ? (0, payroll_identity_1.sealIdentifier)(sub, ssn) : null, ssn ? (0, payroll_identity_1.last4)(ssn) : null]);
        await (0, payroll_ledger_1.recordAudit)(ctx.pool, sub, 'employee', id, 'update', sub, before, r.rows[0]);
        const out = (0, payroll_store_1.normalizeDates)(r.rows[0]);
        out.ssn_masked = (0, payroll_identity_1.maskSsn)(String(out.ssn_last4 || ''));
        res.json({ employee: out });
    }));
    /** The ONE route that returns a full SSN. Confirm-gated and audited. */
    router.post('/employees/:id/ssn', guarded('employee.ssn.reveal', async (req, res, sub) => {
        if (!(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(req.body)) {
            res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('no-reveal', 'Revealing a full Social Security number'));
            return;
        }
        const id = String(req.params.id);
        const emp = await owned(ctx, 'payroll_employees', 'employee_id', id, sub);
        if (!emp) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const ssn = (0, payroll_identity_1.openIdentifier)(sub, emp.ssn_encrypted);
        if (!ssn) {
            res.status(409).json({ error: 'no_ssn', message: 'No SSN is on file for this employee.' });
            return;
        }
        // Audited BEFORE the value leaves — a read that is not recorded did not happen.
        await (0, payroll_ledger_1.recordAudit)(ctx.pool, sub, 'employee', id, 'ssn-reveal', sub, null, { revealed: true, reason: String(req.body.reason || '') });
        res.json({ ssn, reason: 'This read has been recorded on the audit trail.' });
    }));
    router.get('/employees/:id/bank-accounts', guarded('bank.list', async (req, res, sub) => {
        const rows = (await ctx.pool.query(`SELECT account_id, nickname, routing_last4, account_last4, account_type, split_order,
              split_amount_cents, split_percent, active
         FROM payroll_bank_accounts WHERE user_sub=$1 AND employee_id=$2 ORDER BY split_order`, [sub, String(req.params.id)])).rows;
        res.json({ accounts: rows.map((a) => ({ ...a, account_masked: (0, payroll_identity_1.maskAccount)(String(a.account_last4 || '')) })) });
    }));
    router.post('/employees/:id/bank-accounts', guarded('bank.create', async (req, res, sub) => {
        const b = (req.body || {});
        const id = String(req.params.id);
        if (!await owned(ctx, 'payroll_employees', 'employee_id', id, sub)) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const routing = (0, payroll_identity_1.normalizeRouting)(b.routing);
        if (!routing) {
            res.status(400).json({ error: 'bad_routing', message: 'That routing number fails its ABA check digit.' });
            return;
        }
        const account = String(b.account || '').replace(/\D/g, '');
        if (account.length < 4) {
            res.status(400).json({ error: 'bad_account' });
            return;
        }
        const accountId = crypto.randomUUID();
        await ctx.pool.query(`INSERT INTO payroll_bank_accounts (account_id, user_sub, employee_id, nickname, routing_encrypted,
          routing_last4, account_encrypted, account_last4, account_type, split_order, split_amount_cents, split_percent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [accountId, sub, id, String(b.nickname || '').slice(0, 60), (0, payroll_identity_1.sealIdentifier)(sub, routing), (0, payroll_identity_1.last4)(routing),
            (0, payroll_identity_1.sealIdentifier)(sub, account), (0, payroll_identity_1.last4)(account),
            b.accountType === 'savings' ? 'savings' : 'checking',
            Math.max(1, Math.trunc((0, payroll_store_1.num)(b.splitOrder, 1))),
            b.splitAmountCents === undefined ? null : (0, payroll_store_1.money)(b.splitAmountCents),
            b.splitPercent === undefined ? null : (0, payroll_store_1.num)(b.splitPercent)]);
        await (0, payroll_ledger_1.recordAudit)(ctx.pool, sub, 'bank_account', accountId, 'create', sub, null, { employee_id: id });
        res.json({ ok: true, accountId });
    }));
}
/** Register deduction-election routes. */
function electionRoutes(router, ctx, guarded) {
    router.get('/codes', guarded('codes', async (_req, res) => {
        res.json({
            earnings: Object.values(payroll_codes_1.EARNINGS_CODES).map((e) => ({
                code: e.code, label: e.label, entry: e.entry, multiplier: e.multiplier,
                paid: e.paid, hoursWorked: e.hoursWorked, note: e.note,
            })),
            deductions: Object.values(payroll_codes_1.DEDUCTION_CODES).map((d) => ({
                code: d.code, label: d.label, reduces: d.reduces, statutory: d.statutory,
                garnishmentPriority: d.garnishmentPriority, note: d.note,
            })),
        });
    }));
    router.get('/employees/:id/deductions', guarded('elections.list', async (req, res, sub) => {
        const rows = (await ctx.pool.query('SELECT * FROM payroll_deduction_elections WHERE user_sub=$1 AND employee_id=$2 ORDER BY code', [sub, String(req.params.id)])).rows;
        res.json({ elections: (0, payroll_store_1.normalizeRows)(rows) });
    }));
    router.post('/employees/:id/deductions', guarded('elections.create', async (req, res, sub) => {
        const b = (req.body || {});
        const id = String(req.params.id);
        const code = String(b.code || '').toUpperCase();
        if (!(0, payroll_codes_1.deductionCode)(code)) {
            res.status(400).json({ error: 'unknown_code', message: `Unknown deduction code ${code}.` });
            return;
        }
        if (!await owned(ctx, 'payroll_employees', 'employee_id', id, sub)) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const electionId = crypto.randomUUID();
        const r = await ctx.pool.query(`INSERT INTO payroll_deduction_elections (election_id, user_sub, employee_id, code, amount_cents,
          percent_of_gross, annual_limit_cents, support_ccpa_pct, payee, case_number, effective_from, effective_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [electionId, sub, id, code, (0, payroll_store_1.money)(b.amountCents),
            b.percentOfGross === undefined ? null : (0, payroll_store_1.num)(b.percentOfGross),
            b.annualLimitCents === undefined ? null : (0, payroll_store_1.money)(b.annualLimitCents),
            b.supportCcpaPct === undefined ? null : Math.min(65, (0, payroll_store_1.num)(b.supportCcpaPct)),
            String(b.payee || '').slice(0, 120), String(b.caseNumber || '').slice(0, 60),
            b.effectiveFrom || null, b.effectiveTo || null]);
        await (0, payroll_ledger_1.recordAudit)(ctx.pool, sub, 'deduction_election', electionId, 'create', sub, null, r.rows[0]);
        res.json({ election: (0, payroll_store_1.normalizeDates)(r.rows[0]) });
    }));
    router.delete('/employees/:id/deductions/:electionId', guarded('elections.delete', async (req, res, sub) => {
        const eid = String(req.params.electionId);
        const before = await owned(ctx, 'payroll_deduction_elections', 'election_id', eid, sub);
        if (!before) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        // Never hard-delete an election with history — deactivate it so the audit
        // trail and any arrears balance survive.
        const r = await ctx.pool.query('UPDATE payroll_deduction_elections SET active=false, updated_at=now() WHERE election_id=$1 AND user_sub=$2 RETURNING *', [eid, sub]);
        await (0, payroll_ledger_1.recordAudit)(ctx.pool, sub, 'deduction_election', eid, 'deactivate', sub, before, r.rows[0]);
        res.json({ ok: true, deactivated: true });
    }));
}
/** Register earning-row + gross-up routes. */
function earningsRoutes(router, ctx, guarded) {
    router.get('/runs/:id/lines/:employeeId/earnings', guarded('earnings.list', async (req, res, sub) => {
        res.json({ earnings: await (0, payroll_ledger_1.getLineEarnings)(ctx.pool, sub, String(req.params.id), String(req.params.employeeId)) });
    }));
    router.put('/runs/:id/lines/:employeeId/earnings', guarded('earnings.set', async (req, res, sub) => {
        const runId = String(req.params.id);
        const empId = String(req.params.employeeId);
        const run = await owned(ctx, 'payroll_runs', 'run_id', runId, sub);
        if (!run) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        if (run.status !== 'draft') {
            res.status(409).json({ error: 'run_not_draft', message: 'Only a draft run can be edited. Void the paid run to correct it.' });
            return;
        }
        const emp = await owned(ctx, 'payroll_employees', 'employee_id', empId, sub);
        if (!emp) {
            res.status(404).json({ error: 'employee_not_found' });
            return;
        }
        const rows = Array.isArray((req.body || {}).earnings) ? req.body.earnings : [];
        const unknown = rows.map((r) => String(r.code || '').toUpperCase()).filter((c) => !payroll_codes_1.EARNINGS_CODES[c]);
        if (unknown.length) {
            res.status(400).json({ error: 'unknown_earnings_code', message: `Unknown code(s): ${[...new Set(unknown)].join(', ')}.` });
            return;
        }
        const earnings = rows.map((r) => ({
            code: String(r.code).toUpperCase(), hours: (0, payroll_store_1.num)(r.hours), rateCents: (0, payroll_store_1.money)(r.rateCents),
            amountCents: (0, payroll_store_1.money)(r.amountCents), workweek: Math.max(1, Math.trunc((0, payroll_store_1.num)(r.workweek, 1)) || 1),
            memo: String(r.memo || ''),
        }));
        await (0, payroll_ledger_1.setLineEarnings)(ctx.pool, sub, runId, empId, earnings);
        const deductions = await (0, payroll_ledger_1.getDeductionRows)(ctx.pool, sub, empId, (0, payroll_store_1.isoDate)(run.pay_date));
        const check = await (0, payroll_ledger_1.recomputeLineV2)(ctx.pool, sub, run, emp, earnings, deductions, await engineOpts(ctx, sub, run, emp));
        res.json({ ok: true, check, warnings: check.warnings });
    }));
    router.post('/grossup', guarded('grossup', async (req, res, sub) => {
        const b = (req.body || {});
        const empId = String(b.employeeId || '');
        const runId = String(b.runId || '');
        const run = await owned(ctx, 'payroll_runs', 'run_id', runId, sub);
        const emp = await owned(ctx, 'payroll_employees', 'employee_id', empId, sub);
        if (!run || !emp) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const code = String(b.code || 'BONUS_D').toUpperCase();
        if (!payroll_codes_1.EARNINGS_CODES[code]) {
            res.status(400).json({ error: 'unknown_earnings_code' });
            return;
        }
        const base = await (0, payroll_ledger_1.getLineEarnings)(ctx.pool, sub, runId, empId);
        const deductions = await (0, payroll_ledger_1.getDeductionRows)(ctx.pool, sub, empId, (0, payroll_store_1.isoDate)(run.pay_date));
        const result = (0, payroll_grossup_1.grossUp)((0, payroll_store_1.money)(b.targetNetCents), code, base, deductions, {
            filingStatus: emp.filing_status || 'single',
            step2: emp.w4_step2 === true,
            dependentsCreditCents: (0, payroll_store_1.money)(emp.w4_dependents_credit_cents),
            otherIncomeCents: (0, payroll_store_1.money)(emp.w4_other_income_cents),
            deductionsCents: (0, payroll_store_1.money)(emp.w4_deductions_cents),
            extraWithholdingCents: (0, payroll_store_1.money)(emp.w4_extra_withholding_cents),
            exempt: emp.w4_exempt === true,
        }, await engineOpts(ctx, sub, run, emp));
        res.json({
            grossCents: result.grossCents, achievedNetCents: result.achievedNetCents,
            exact: result.exact, iterations: result.iterations, warnings: result.warnings,
        });
    }));
}
/** Register report + audit routes. */
function reportRoutes(router, ctx, guarded) {
    router.get('/reports/journal/:runId', guarded('reports.journal', async (req, res, sub) => {
        const j = await (0, payroll_reports_1.runJournal)(ctx.pool, sub, String(req.params.runId));
        if (!j) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        res.json(j);
    }));
    router.get('/reports/deposits', guarded('reports.deposits', async (req, res, sub) => {
        const year = Number(String(req.query.year || payroll_tax_tables_1.TAX_YEAR).replace(/\D/g, '')) || payroll_tax_tables_1.TAX_YEAR;
        const company = await (0, payroll_store_1.getCompany)(ctx.pool, sub);
        res.json({
            year,
            depositorStatus: String(company.depositor_status || 'monthly'),
            obligations: await (0, payroll_reports_1.depositSchedule)(ctx.pool, sub, year, String(company.depositor_status || 'monthly')),
        });
    }));
    router.get('/reports/deduction-register', guarded('reports.deductions', async (req, res, sub) => {
        const from = (0, payroll_store_1.isoDate)(req.query.from || `${payroll_tax_tables_1.TAX_YEAR}-01-01`);
        const to = (0, payroll_store_1.isoDate)(req.query.to || `${payroll_tax_tables_1.TAX_YEAR}-12-31`);
        res.json({ from, to, rows: await (0, payroll_reports_1.deductionRegister)(ctx.pool, sub, from, to) });
    }));
    router.get('/reports/labor', guarded('reports.labor', async (req, res, sub) => {
        const from = (0, payroll_store_1.isoDate)(req.query.from || `${payroll_tax_tables_1.TAX_YEAR}-01-01`);
        const to = (0, payroll_store_1.isoDate)(req.query.to || `${payroll_tax_tables_1.TAX_YEAR}-12-31`);
        res.json({ from, to, rows: await (0, payroll_reports_1.laborDistribution)(ctx.pool, sub, from, to) });
    }));
    router.get('/reports/w2-readiness/:employeeId', guarded('reports.w2ready', async (req, res, sub) => {
        const emp = await owned(ctx, 'payroll_employees', 'employee_id', String(req.params.employeeId), sub);
        if (!emp) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        res.json((0, payroll_identity_1.w2Readiness)(await (0, payroll_store_1.getCompany)(ctx.pool, sub), emp));
    }));
    router.get('/payments', guarded('payments.list', async (req, res, sub) => {
        const runId = String(req.query.runId || '');
        const rows = (await ctx.pool.query(`SELECT p.*, e.first_name, e.last_name FROM payroll_payments p
         JOIN payroll_employees e ON e.employee_id = p.employee_id AND e.user_sub = p.user_sub
        WHERE p.user_sub = $1 AND ($2 = '' OR p.run_id = $2)
        ORDER BY p.issued_on DESC, e.last_name LIMIT 500`, [sub, runId])).rows;
        res.json({ payments: (0, payroll_store_1.normalizeRows)(rows) });
    }));
    router.get('/audit/:entity/:entityId', guarded('audit.read', async (req, res, sub) => {
        res.json({ trail: await (0, payroll_ledger_1.auditTrail)(ctx.pool, sub, String(req.params.entity), String(req.params.entityId)) });
    }));
}
/** Register the disbursement + filing ARTIFACT routes. */
function artifactRoutes(router, ctx, guarded) {
    /**
     * POST /runs/:id/ach — build the NACHA file for a paid run.
     *
     * Generating the file is not sending money, but it IS the artifact a bank
     * executes, so it sits behind the same explicit confirm as the other money
     * actions and is recorded on the audit trail.
     */
    router.post('/runs/:id/ach', guarded('ach.build', async (req, res, sub) => {
        if (!(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(req.body)) {
            res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('no-ach', 'Generating an ACH file your bank will execute'));
            return;
        }
        const runId = String(req.params.id);
        const run = await owned(ctx, 'payroll_runs', 'run_id', runId, sub);
        if (!run) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        if (run.status !== 'paid') {
            res.status(409).json({ error: 'run_not_paid', message: 'Approve the run before generating its ACH file.' });
            return;
        }
        const company = await (0, payroll_store_1.getCompany)(ctx.pool, sub);
        const rows = (await ctx.pool.query(`SELECT p.amount_cents, e.first_name, e.last_name, e.employee_id,
              b.routing_encrypted, b.account_encrypted, b.account_type
         FROM payroll_payments p
         JOIN payroll_employees e ON e.employee_id = p.employee_id AND e.user_sub = p.user_sub
         LEFT JOIN payroll_bank_accounts b ON b.account_id = p.bank_account_id AND b.user_sub = p.user_sub
        WHERE p.user_sub = $1 AND p.run_id = $2 AND p.method = 'direct_deposit' AND p.amount_cents > 0
        ORDER BY e.last_name, e.first_name`, [sub, runId])).rows;
        if (!rows.length) {
            res.status(409).json({
                error: 'no_direct_deposits',
                message: 'No direct-deposit payments on this run. Employees paid by check need no ACH file.',
            });
            return;
        }
        const entries = rows.map((r) => ({
            routingNumber: (0, payroll_identity_1.openIdentifier)(sub, r.routing_encrypted) || '',
            accountNumber: (0, payroll_identity_1.openIdentifier)(sub, r.account_encrypted) || '',
            accountType: r.account_type === 'savings' ? 'savings' : 'checking',
            amountCents: (0, payroll_store_1.money)(r.amount_cents),
            name: `${r.last_name} ${r.first_name}`,
            // NOT truncated here. buildAchFile truncates to 15 characters for the
            // record's Individual Identification Number field, but it also hands the
            // id back on the trace, and THAT value is used as a database key.
            // Employee ids are UUIDs, so pre-truncating made `WHERE employee_id = $4`
            // match nothing: ach_trace was never written, and every subsequent return
            // was permanently unmatchable — the exact failure this feature exists to
            // prevent, hidden because the guard used a two-character fixture id.
            employeeId: String(r.employee_id),
        }));
        const now = new Date();
        // Continue the trace sequence across files. Restarting at 1 would let two
        // runs mint identical traces, and since a return is matched on the trace
        // alone, one run's return could then mark another run's payment.
        const traceStart = await (0, payroll_nacha_1.allocateTraceStart)(ctx.pool, sub, entries.length);
        const file = (0, payroll_nacha_1.buildAchFile)(entries, {
            traceStart,
            odfiRoutingNumber: String(company.ach_odfi_routing || ''),
            odfiName: String(company.ach_odfi_name || ''),
            companyName: String(company.legal_name || company.company_name || ''),
            companyId: String(company.ach_company_id || ''),
            entryDescription: String(company.ach_entry_description || 'PAYROLL'),
            effectiveDate: (0, payroll_store_1.isoDate)(run.pay_date),
            fileDate: (0, payroll_store_1.isoDate)(now),
            fileTime: `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`,
        }, req.body.prenote === true);
        await (0, payroll_ledger_1.recordAudit)(ctx.pool, sub, 'run', runId, 'ach-generated', sub, null, { entries: file.entryCount, totalCents: file.totalCreditCents, valid: file.valid });
        if (!file.valid) {
            res.status(409).json({ error: 'ach_invalid', problems: file.problems });
            return;
        }
        // Persist the trace numbers. A return or notification of change identifies
        // the entry it concerns ONLY by its original trace, so a file sent without
        // recording these leaves every returned deposit unmatchable — and a failed
        // deposit then looks exactly like a successful one. A prenote moves no
        // money, so its traces are not recorded against the payments.
        if (req.body.prenote !== true) {
            for (const t of file.traces) {
                await ctx.pool.query(`UPDATE payroll_payments SET ach_trace = $3, updated_at = now()
            WHERE user_sub = $1 AND run_id = $2 AND employee_id = $4 AND method = 'direct_deposit'`, [sub, runId, t.trace, t.employeeId]);
            }
        }
        res.type('text/plain').set('Content-Disposition', `attachment; filename="payroll-${(0, payroll_store_1.isoDate)(run.pay_date)}.ach"`).send(file.content);
    }));
    router.get('/forms/941', guarded('forms.941', async (req, res, sub) => {
        const year = Number(String(req.query.year || payroll_tax_tables_1.TAX_YEAR).replace(/\D/g, '')) || payroll_tax_tables_1.TAX_YEAR;
        const quarter = Math.min(4, Math.max(1, Number(req.query.quarter) || 1));
        res.json(await (0, payroll_forms_1.form941)(ctx.pool, sub, year, quarter));
    }));
    router.get('/forms/940', guarded('forms.940', async (req, res, sub) => {
        const year = Number(String(req.query.year || payroll_tax_tables_1.TAX_YEAR).replace(/\D/g, '')) || payroll_tax_tables_1.TAX_YEAR;
        res.json(await (0, payroll_forms_1.form940)(ctx.pool, sub, year));
    }));
    /**
     * POST /forms/w2/:employeeId — the real W-2.
     *
     * Confirm-gated and audited because producing it decrypts the SSN and the EIN.
     * When identity is incomplete it returns `issuable: false` with the missing
     * fields named, rather than a document that cannot legally be filed.
     */
    router.post('/forms/w2/:employeeId', guarded('forms.w2', async (req, res, sub) => {
        if (!(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(req.body)) {
            res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('no-w2', 'Producing a W-2 (this decrypts the SSN and EIN)'));
            return;
        }
        const year = Number(String(req.body.year || payroll_tax_tables_1.TAX_YEAR)) || payroll_tax_tables_1.TAX_YEAR;
        const emp = await owned(ctx, 'payroll_employees', 'employee_id', String(req.params.employeeId), sub);
        if (!emp) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const company = await (0, payroll_store_1.getCompany)(ctx.pool, sub);
        const doc = await (0, payroll_forms_1.w2Document)(ctx.pool, sub, emp, company, year, {
            ssn: (0, payroll_identity_1.openIdentifier)(sub, emp.ssn_encrypted),
            ein: (0, payroll_identity_1.openIdentifier)(sub, company.ein_encrypted),
        });
        await (0, payroll_ledger_1.recordAudit)(ctx.pool, sub, 'employee', String(emp.employee_id), 'w2-produced', sub, null, { year, issuable: doc.issuable });
        res.json(doc);
    }));
}
/**
 * @description Mount every v2 route onto the payroll router.
 * @param router - The router createPayrollRoutes built.
 * @param ctx - App context.
 * @param guarded - The shared auth + schema + error wrapper.
 */
function registerV2Routes(router, ctx, guarded) {
    identityRoutes(router, ctx, guarded);
    electionRoutes(router, ctx, guarded);
    earningsRoutes(router, ctx, guarded);
    reportRoutes(router, ctx, guarded);
    artifactRoutes(router, ctx, guarded);
}
//# sourceMappingURL=payroll-routes-v2.js.map