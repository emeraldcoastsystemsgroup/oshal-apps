"use strict";
/**
 * The settlement surface — what happened after the run was approved.
 *
 * Approving a run says who SHOULD be paid. Everything here answers the harder
 * question: who actually WAS. Returns and notifications of change come back
 * from the bank days later, pay dates land on days the Federal Reserve is
 * closed, and the year-end and state filings are built from the same ledger.
 *
 * THE ONE ASYMMETRY WORTH KNOWING: importing a return file is RECORDING WHAT
 * THE BANK SAID, so it is audited but not confirm-gated — putting friction in
 * front of recording reality would leave people silently unpaid, which is the
 * exact failure this module exists to end. APPLYING a notification of change
 * rewrites an employee's banking details, so that one is confirm-gated like
 * every other money action in this app.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-02 04:45:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — return/NOC import matched on the stored ACH trace, the settlement view that names who was NOT paid, confirm-gated NOC application, the RT-6 and EFW2 artifacts, check-number allocation with rendered checks, and the two banking calendars exposed for the run screen.
 *
 * @module payroll-routes-settle
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
exports.registerSettlementRoutes = registerSettlementRoutes;
const crypto = __importStar(require("crypto"));
const explicit_write_confirmation_1 = require("@/shared/security/explicit-write-confirmation");
const payroll_ach_returns_1 = require("./payroll-ach-returns");
const payroll_checks_1 = require("./payroll-checks");
const payroll_calendar_1 = require("./payroll-calendar");
const payroll_efw2_1 = require("./payroll-efw2");
const payroll_rt6_1 = require("./payroll-rt6");
const payroll_identity_1 = require("./payroll-identity");
const payroll_ledger_1 = require("./payroll-ledger");
const payroll_tax_tables_1 = require("./payroll-tax-tables");
const payroll_store_1 = require("./payroll-store");
/** Fetch a row owned by the caller. */
async function owned(ctx, table, idCol, id, sub) {
    const r = await ctx.pool.query(`SELECT * FROM ${table} WHERE ${idCol} = $1 AND user_sub = $2`, [id, sub]);
    return r.rows[0] || null;
}
/** Seal the banking details out of a decoded correction. */
function sealCorrection(sub, event) {
    const c = event.correction;
    if (!c)
        return null;
    return {
        changeCode: c.changeCode,
        title: c.title,
        routingSealed: c.routingNumber ? (0, payroll_identity_1.sealIdentifier)(sub, c.routingNumber) : null,
        routingLast4: c.routingNumber ? (0, payroll_identity_1.last4)(c.routingNumber) : '',
        accountSealed: c.accountNumber ? (0, payroll_identity_1.sealIdentifier)(sub, c.accountNumber) : null,
        accountLast4: c.accountNumber ? (0, payroll_identity_1.last4)(c.accountNumber) : '',
        transactionCode: c.transactionCode,
        individualId: c.individualId,
        autoApplicable: c.autoApplicable,
        note: c.note,
    };
}
/** What a caller may see about a correction — never the numbers themselves. */
function maskCorrection(c) {
    if (!c)
        return undefined;
    return {
        changeCode: c.changeCode,
        title: c.title,
        routingMasked: c.routingLast4 ? (0, payroll_identity_1.maskAccount)(c.routingLast4) : undefined,
        accountMasked: c.accountLast4 ? (0, payroll_identity_1.maskAccount)(c.accountLast4) : undefined,
        transactionCode: c.transactionCode,
        autoApplicable: c.autoApplicable,
        note: c.note,
    };
}
/** Record one parsed event and move the payment it concerns. */
async function applyEvent(ctx, sub, event) {
    const outcome = (0, payroll_ach_returns_1.outcomeFor)(event);
    // The trace is the only handle the bank gives back; it is indexed for this.
    const payment = event.originalTrace
        ? (await ctx.pool.query(`SELECT payment_id, employee_id FROM payroll_payments
        WHERE user_sub = $1 AND ach_trace = $2 LIMIT 1`, [sub, event.originalTrace])).rows[0]
        : undefined;
    const correction = sealCorrection(sub, event);
    const detail = JSON.stringify({
        reason: event.reason,
        correction,
        // The account the bank's entry actually named, so applying a correction can
        // target the right split rather than whichever row sorts first.
        originalAccountLast4: (0, payroll_identity_1.last4)(event.accountNumber || ''),
        outcome,
        problems: event.problems,
    });
    // RETURNING gives back the id only when the row was actually inserted. A
    // re-imported file conflicts on the return trace, and minting a fresh UUID
    // there would hand the caller an id no row has — making the NOC permanently
    // unappliable. Fall back to the id already on file.
    const inserted = await ctx.pool.query(`INSERT INTO payroll_ach_events (event_id, user_sub, kind, code, original_trace, return_trace,
        amount_cents, individual_name, payment_id, employee_id, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT DO NOTHING
     RETURNING event_id`, [crypto.randomUUID(), sub, event.kind, event.code, event.originalTrace, event.returnTrace,
        event.amountCents, event.individualName, payment?.payment_id || null,
        payment?.employee_id || null, detail]);
    let eventId = String(inserted.rows[0]?.event_id || '');
    if (!eventId) {
        const existing = await ctx.pool.query(`SELECT event_id FROM payroll_ach_events
        WHERE user_sub = $1 AND return_trace = $2 LIMIT 1`, [sub, event.returnTrace]);
        eventId = String(existing.rows[0]?.event_id || '');
    }
    if (payment) {
        await ctx.pool.query(`UPDATE payroll_payments
          SET status = $3, return_code = $4, return_reason = $5,
              returned_on = CASE WHEN $3 = 'returned' THEN now()::date ELSE returned_on END,
              noc_change_code = CASE WHEN $3 = 'corrected' THEN $4 ELSE noc_change_code END,
              updated_at = now()
        WHERE payment_id = $1 AND user_sub = $2`, [payment.payment_id, sub, outcome.status, event.code, outcome.summary]);
    }
    return { matched: Boolean(payment), employeeId: payment?.employee_id || null, eventId, correction };
}
/** Register return / notification-of-change routes. */
function returnRoutes(router, ctx, guarded) {
    /**
     * POST /returns/import — read a return / NOC file from the bank.
     *
     * Audited but NOT confirm-gated: this records what the bank already did.
     * Requiring a confirmation to write down that someone was not paid would
     * preserve exactly the silence this module was built to remove.
     */
    router.post('/returns/import', guarded('returns.import', async (req, res, sub) => {
        const content = typeof req.body?.content === 'string' ? req.body.content : '';
        if (!content.trim()) {
            res.status(400).json({ error: 'no_content', message: 'Paste or upload the return file from your bank.' });
            return;
        }
        const parsed = (0, payroll_ach_returns_1.parseAchReturnFile)(content);
        if (!parsed.events.length) {
            res.status(422).json({
                error: 'no_events',
                message: 'No return or notification-of-change records were found in that file.',
                problems: parsed.problems,
            });
            return;
        }
        const applied = [];
        for (const event of parsed.events)
            applied.push({ event, ...await applyEvent(ctx, sub, event) });
        const unmatched = applied.filter((a) => !a.matched).length;
        await (0, payroll_ledger_1.recordAudit)(ctx.pool, sub, 'ach', 'import', 'returns-imported', sub, null, { returns: parsed.returnCount, nocs: parsed.nocCount, unmatched });
        res.json({
            returnCount: parsed.returnCount,
            nocCount: parsed.nocCount,
            totalReturnedCents: parsed.totalReturnedCents,
            unmatched,
            problems: parsed.problems,
            events: applied.map((a) => ({
                eventId: a.eventId,
                kind: a.event.kind,
                code: a.event.code,
                name: a.event.individualName,
                amountCents: a.event.amountCents,
                matched: a.matched,
                ...(0, payroll_ach_returns_1.outcomeFor)(a.event),
                // Masked: the corrected routing and account are bank credentials and
                // never leave the server, even to the operator who imported them.
                correction: maskCorrection(a.correction),
                problems: a.event.problems,
            })),
            note: unmatched
                ? `${unmatched} record(s) could not be matched to a payment. That happens when the ACH file `
                    + 'was generated before trace numbers were recorded, or the file is from another system.'
                : '',
        });
    }));
    /**
     * POST /returns/:eventId/apply — write an NOC correction onto the account.
     *
     * Confirm-gated: this rewrites banking details, and the next payroll goes
     * wherever it points.
     */
    router.post('/returns/:eventId/apply', guarded('returns.apply', async (req, res, sub) => {
        if (!(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(req.body)) {
            res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('no-noc-apply', "Rewriting an employee's bank account from a notification of change"));
            return;
        }
        const event = await owned(ctx, 'payroll_ach_events', 'event_id', String(req.params.eventId), sub);
        if (!event) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const detail = (event.detail || {});
        const correction = detail.correction;
        if (event.kind !== 'noc' || !correction) {
            res.status(409).json({ error: 'not_a_noc', message: 'Only a notification of change can be applied.' });
            return;
        }
        if (correction.autoApplicable !== true) {
            res.status(409).json({
                error: 'not_auto_applicable',
                message: String(correction.note || 'This change code must be handled by hand.'),
            });
            return;
        }
        // Target the account the bank's ENTRY named, not whichever split sorts
        // first. An employee with a checking and a savings split would otherwise
        // have the wrong one rewritten, silently redirecting part of their pay.
        const wasLast4 = String(detail.originalAccountLast4 || '');
        const accounts = (await ctx.pool.query(`SELECT b.* FROM payroll_bank_accounts b
        WHERE b.user_sub = $1 AND b.employee_id = $2 AND b.active ORDER BY b.split_order`, [sub, String(event.employee_id || '')])).rows;
        if (!accounts.length) {
            res.status(409).json({ error: 'no_account', message: 'That employee has no active direct-deposit account.' });
            return;
        }
        const named = wasLast4 ? accounts.filter((a) => String(a.account_last4 || '') === wasLast4) : [];
        if (wasLast4 && named.length !== 1 && accounts.length > 1) {
            res.status(409).json({
                error: 'ambiguous_account',
                message: named.length
                    ? `More than one active account ends ${wasLast4}. Apply this correction by hand so the right split is changed.`
                    : `No active account ends ${wasLast4} — the account this notice concerns is not on file any more. `
                        + 'Apply it by hand.',
            });
            return;
        }
        const account = named[0] || accounts[0];
        const correctedRouting = (0, payroll_identity_1.openIdentifier)(sub, correction.routingSealed);
        const correctedAccount = (0, payroll_identity_1.openIdentifier)(sub, correction.accountSealed);
        const routing = correctedRouting ? (0, payroll_identity_1.normalizeRouting)(correctedRouting) : null;
        if (correctedRouting && !routing) {
            res.status(422).json({
                error: 'bad_corrected_routing',
                message: 'The corrected routing number fails its ABA check digit. Confirm it with your bank.',
            });
            return;
        }
        const acct = correctedAccount ? String(correctedAccount).replace(/\D/g, '') : '';
        await ctx.pool.query(`UPDATE payroll_bank_accounts
          SET routing_encrypted = COALESCE($3, routing_encrypted),
              routing_last4     = COALESCE($4, routing_last4),
              account_encrypted = COALESCE($5, account_encrypted),
              account_last4     = COALESCE($6, account_last4)
        WHERE account_id = $1 AND user_sub = $2`, [account.account_id, sub,
            routing ? (0, payroll_identity_1.sealIdentifier)(sub, routing) : null, routing ? (0, payroll_identity_1.last4)(routing) : null,
            acct ? (0, payroll_identity_1.sealIdentifier)(sub, acct) : null, acct ? (0, payroll_identity_1.last4)(acct) : null]);
        await ctx.pool.query('UPDATE payroll_ach_events SET applied = true WHERE event_id = $1 AND user_sub = $2', [String(event.event_id), sub]);
        await (0, payroll_ledger_1.recordAudit)(ctx.pool, sub, 'bank_account', String(account.account_id), 'noc-applied', sub, { routing_last4: account.routing_last4, account_last4: account.account_last4 }, { change_code: event.code, routing_last4: routing ? (0, payroll_identity_1.last4)(routing) : account.routing_last4 });
        res.json({ ok: true, changeCode: event.code, note: 'Banking details updated and recorded on the audit trail.' });
    }));
    /** GET /runs/:id/settlement — who was actually paid, and who was not. */
    router.get('/runs/:id/settlement', guarded('settlement.read', async (req, res, sub) => {
        const runId = String(req.params.id);
        if (!await owned(ctx, 'payroll_runs', 'run_id', runId, sub)) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const rows = (await ctx.pool.query(`SELECT p.payment_id, p.employee_id, p.method, p.amount_cents, p.status, p.check_number,
              p.ach_trace, p.return_code, p.return_reason, p.returned_on,
              e.first_name, e.last_name
         FROM payroll_payments p
         JOIN payroll_employees e ON e.employee_id = p.employee_id AND e.user_sub = p.user_sub
        WHERE p.user_sub = $1 AND p.run_id = $2
        ORDER BY e.last_name, e.first_name`, [sub, runId])).rows;
        const notPaid = rows.filter((r) => r.status === 'returned');
        res.json({
            payments: (0, payroll_store_1.normalizeRows)(rows),
            paidCount: rows.filter((r) => r.status === 'paid' || r.status === 'corrected').length,
            pendingCount: rows.filter((r) => r.status === 'pending').length,
            notPaid: (0, payroll_store_1.normalizeRows)(notPaid),
            notPaidCents: notPaid.reduce((a, r) => a + Number(r.amount_cents || 0), 0),
            untraceable: rows.filter((r) => r.method === 'direct_deposit' && !r.ach_trace).length,
        });
    }));
}
/** Register the calendar, filing and check routes. */
function settlementArtifactRoutes(router, ctx, guarded) {
    /** GET /calendar/holidays — both calendars, because they disagree. */
    router.get('/calendar/holidays', guarded('calendar.holidays', async (req, res) => {
        const year = Number(String(req.query.year || payroll_tax_tables_1.TAX_YEAR).replace(/\D/g, '')) || payroll_tax_tables_1.TAX_YEAR;
        const irs = (0, payroll_calendar_1.irsLegalHolidays)(year);
        res.json({
            year,
            federalReserve: (0, payroll_calendar_1.fedBankingClosures)(year),
            irs: irs.holidays,
            irsVerified: irs.verified,
            irsNote: irs.note,
            note: 'These deliberately differ. The Federal Reserve calendar decides whether payroll funds; '
                + 'the IRS calendar decides when a deposit is due.',
        });
    }));
    /** GET /calendar/pay-date — will this pay date actually fund? */
    router.get('/calendar/pay-date', guarded('calendar.paydate', async (req, res, sub) => {
        const date = (0, payroll_store_1.isoDate)(req.query.date || new Date());
        const company = await (0, payroll_store_1.getCompany)(ctx.pool, sub);
        const check = (0, payroll_calendar_1.resolvePayDate)(date, req.query.direction === 'later' ? 'later' : 'earlier');
        res.json({
            ...check,
            deposit: (0, payroll_calendar_1.depositDueDate)(check.payDate, String(company.depositor_status || 'monthly')),
        });
    }));
    /** GET /forms/rt6 — the Florida quarterly reemployment return. */
    router.get('/forms/rt6', guarded('forms.rt6', async (req, res, sub) => {
        const year = Number(String(req.query.year || payroll_tax_tables_1.TAX_YEAR).replace(/\D/g, '')) || payroll_tax_tables_1.TAX_YEAR;
        const quarter = Math.min(4, Math.max(1, Number(req.query.quarter) || 1));
        const company = await (0, payroll_store_1.getCompany)(ctx.pool, sub);
        res.json(await (0, payroll_rt6_1.formRt6)(ctx.pool, sub, company, year, quarter, {
            filedOn: req.query.filedOn ? (0, payroll_store_1.isoDate)(req.query.filedOn) : undefined,
            installment: req.query.installment === 'true',
        }));
    }));
    /**
     * POST /forms/efw2 — the SSA electronic W-2 submission.
     *
     * Confirm-gated: producing it decrypts every employee's Social Security
     * number and the employer EIN.
     */
    router.post('/forms/efw2', guarded('forms.efw2', async (req, res, sub) => {
        if (!(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(req.body)) {
            res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('no-efw2', 'Producing an EFW2 submission (this decrypts every SSN on the file)'));
            return;
        }
        const year = Number(req.body.year || payroll_tax_tables_1.TAX_YEAR) || payroll_tax_tables_1.TAX_YEAR;
        const company = await (0, payroll_store_1.getCompany)(ctx.pool, sub);
        const ein = (0, payroll_identity_1.openIdentifier)(sub, company.ein_encrypted) || '';
        const employees = await efw2Employees(ctx, sub, year);
        const file = (0, payroll_efw2_1.buildEfw2)(year, {
            ein,
            userId: String(company.bso_user_id || ''),
            name: String(company.legal_name || company.company_name || ''),
            deliveryAddress: String(company.address_line1 || ''),
            city: String(company.city || ''),
            stateCode: String(company.state_code || ''),
            zip: String(company.postal_code || ''),
            contactName: String(company.contact_name || ''),
            contactPhone: String(company.contact_phone || ''),
            contactEmail: String(company.contact_email || ''),
        }, {
            ein,
            name: String(company.legal_name || company.company_name || ''),
            deliveryAddress: String(company.address_line1 || ''),
            city: String(company.city || ''),
            stateCode: String(company.state_code || ''),
            zip: String(company.postal_code || ''),
            contactName: String(company.contact_name || ''),
            contactPhone: String(company.contact_phone || ''),
            contactEmail: String(company.contact_email || ''),
            kindOfEmployer: String(company.kind_of_employer || 'N'),
            employmentCode: String(company.employment_code || 'R'),
        }, employees);
        await (0, payroll_ledger_1.recordAudit)(ctx.pool, sub, 'filing', `efw2-${year}`, 'efw2-produced', sub, null, { year, employees: file.employeeCount, valid: file.valid });
        if (!file.valid) {
            res.status(409).json({ error: 'efw2_invalid', problems: file.problems, caveat: file.caveat });
            return;
        }
        await ctx.pool.query(`INSERT INTO payroll_filings (filing_id, user_sub, kind, period, totals, produced_by, note)
       VALUES ($1,$2,'efw2',$3,$4,$5,$6)`, [crypto.randomUUID(), sub, String(year), JSON.stringify(file.totals), sub, file.caveat]);
        res.type('text/plain')
            .set('Content-Disposition', `attachment; filename="W2REPORT-${year}.txt"`)
            .send(file.content);
    }));
    /**
     * POST /runs/:id/checks — allocate numbers and render the paper checks.
     *
     * Confirm-gated because a check number, once issued, may never be reused —
     * allocating a block is not reversible.
     */
    router.post('/runs/:id/checks', guarded('checks.issue', async (req, res, sub) => {
        if (!(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(req.body)) {
            res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('no-checks', 'Allocating check numbers (a number, once issued, can never be reused)'));
            return;
        }
        const runId = String(req.params.id);
        const run = await owned(ctx, 'payroll_runs', 'run_id', runId, sub);
        if (!run) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        if (run.status !== 'paid') {
            res.status(409).json({ error: 'run_not_paid', message: 'Approve the run before printing its checks.' });
            return;
        }
        const rows = (await ctx.pool.query(`SELECT p.payment_id, p.amount_cents, e.first_name, e.last_name,
              e.address_line1, e.city, e.state_code, e.postal_code
         FROM payroll_payments p
         JOIN payroll_employees e ON e.employee_id = p.employee_id AND e.user_sub = p.user_sub
        WHERE p.user_sub = $1 AND p.run_id = $2 AND p.method = 'check'
          AND p.amount_cents > 0 AND p.check_number = ''
        ORDER BY e.last_name, e.first_name`, [sub, runId])).rows;
        if (!rows.length) {
            res.status(409).json({ error: 'no_checks', message: 'No unissued check payments on this run.' });
            return;
        }
        const company = await (0, payroll_store_1.getCompany)(ctx.pool, sub);
        const numbers = await (0, payroll_checks_1.allocateCheckNumbers)(ctx.pool, sub, rows.length);
        const checks = [];
        for (const [i, r] of rows.entries()) {
            await ctx.pool.query(`UPDATE payroll_payments SET check_number = $3, issued_on = $4, updated_at = now()
          WHERE payment_id = $1 AND user_sub = $2`, [r.payment_id, sub, String(numbers[i]), (0, payroll_store_1.isoDate)(run.pay_date)]);
            checks.push((0, payroll_checks_1.checkDocument)({
                checkNumber: numbers[i],
                date: (0, payroll_store_1.isoDate)(run.pay_date),
                payeeName: `${r.first_name} ${r.last_name}`,
                payeeAddress: [String(r.address_line1 || ''), `${r.city || ''} ${r.state_code || ''} ${r.postal_code || ''}`.trim()]
                    .filter(Boolean),
                amountCents: (0, payroll_store_1.money)(r.amount_cents),
                employerName: String(company.legal_name || company.company_name || ''),
                employerAddress: [String(company.address_line1 || ''), `${company.city || ''} ${company.state_code || ''} ${company.postal_code || ''}`.trim()]
                    .filter(Boolean),
                bankName: String(company.bank_name || ''),
                memo: `Payroll ${(0, payroll_store_1.isoDate)(run.period_start)} to ${(0, payroll_store_1.isoDate)(run.period_end)}`,
            }));
        }
        await (0, payroll_ledger_1.recordAudit)(ctx.pool, sub, 'run', runId, 'checks-issued', sub, null, { count: checks.length, from: numbers[0], to: numbers[numbers.length - 1] });
        res.json({ checks, allocated: numbers });
    }));
}
/** Assemble one EFW2 employee row per person with wages in the year. */
async function efw2Employees(ctx, sub, year) {
    const rows = (await ctx.pool.query(`SELECT e.employee_id, e.first_name, e.last_name, e.ssn_encrypted,
            e.address_line1, e.city, e.state_code, e.postal_code,
            COALESCE(SUM(l.fit_taxable_cents),0) AS b1, COALESCE(SUM(l.fit_cents),0) AS b2,
            COALESCE(SUM(l.ss_taxable_cents),0) AS b3, COALESCE(SUM(l.ss_cents),0) AS b4,
            COALESCE(SUM(l.fica_taxable_cents),0) AS b5,
            COALESCE(SUM(l.medicare_cents + l.addl_medicare_cents),0) AS b6,
            COALESCE(SUM(l.tips_cents),0) AS b7, COALESCE(SUM(l.k401_cents),0) AS d,
            COALESCE(SUM(l.roth_cents),0) AS aa
       FROM payroll_run_lines l
       JOIN payroll_runs r ON r.run_id = l.run_id AND r.user_sub = l.user_sub
       JOIN payroll_employees e ON e.employee_id = l.employee_id AND e.user_sub = l.user_sub
      WHERE l.user_sub = $1 AND r.status = 'paid' AND date_part('year', r.pay_date) = $2
      GROUP BY e.employee_id, e.first_name, e.last_name, e.ssn_encrypted,
               e.address_line1, e.city, e.state_code, e.postal_code
      ORDER BY e.last_name, e.first_name`, [sub, year])).rows;
    return rows.map((r) => ({
        ssn: (0, payroll_identity_1.openIdentifier)(sub, r.ssn_encrypted) || '',
        firstName: String(r.first_name || ''),
        lastName: String(r.last_name || ''),
        deliveryAddress: String(r.address_line1 || ''),
        city: String(r.city || ''),
        stateCode: String(r.state_code || ''),
        zip: String(r.postal_code || ''),
        amounts: {
            wages: Number(r.b1 || 0), fit: Number(r.b2 || 0), ssWages: Number(r.b3 || 0),
            ssTax: Number(r.b4 || 0), medicareWages: Number(r.b5 || 0), medicareTax: Number(r.b6 || 0),
            ssTips: Number(r.b7 || 0), d401k: Number(r.d || 0), aaRoth401k: Number(r.aa || 0),
        },
    }));
}
/**
 * @description Mount the settlement routes onto the payroll router.
 * @param router - The router createPayrollRoutes built.
 * @param ctx - App context.
 * @param guarded - The shared auth + schema + error wrapper.
 */
function registerSettlementRoutes(router, ctx, guarded) {
    returnRoutes(router, ctx, guarded);
    settlementArtifactRoutes(router, ctx, guarded);
}
//# sourceMappingURL=payroll-routes-settle.js.map