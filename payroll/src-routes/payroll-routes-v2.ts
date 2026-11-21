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
 * 2026-10-11 12:00:00 | maintainer@emeraldcoastsystemsgroup.com | Await every sealIdentifier/openIdentifier (now asynchronous, PDATA-01): company EIN and employee SSN saves, the SSN reveal, bank accounts, the ACH entries and the W-2 document.
 * 3                   | maintainer@emeraldcoastsystemsgroup.com | Backlog item 8: GET /reports/deposits answers the deposit-period schedule from payroll-deposits (holiday-aware due dates, the One-Day rule over the period, the $2,500 test per quarter, any forced switch to semiweekly), and GET /deposits/lookback works out monthly or semiweekly from four entered lookback amounts without saving anything; a bad amount or an unheld year is a 422 in words.
 * 4                   | maintainer@emeraldcoastsystemsgroup.com | Backlog item 7: creating a garnishment order requires the facts its limit and priority depend on (payroll-garnish orderFactsFromInput) and stores them; PUT /employees/:id/deductions/:electionId/order corrects them, audited; recomputeEarningRowLine is exported for approval, and engine options are read through the approving client and carry the pay date.
 * 5                   | maintainer@emeraldcoastsystemsgroup.com | Backlog item 3: GET /reports/flsa-records/:employeeId answers the 29 CFR 516.2(a) record from stored rows (payroll-flsa-records); earning rows may carry the day they were worked; a dated row's workweek comes from the company's workweek start (a date outside the period, or a mix of dated and undated rows, is a 422 in words), and a workweek an earlier paid check shares is computed over the whole workweek, both when the line is edited and when the run is approved; the deductions set on the employee form go along as rows for any code no election covers, so a line moved to earning rows keeps them.
 *
 * @module payroll-routes-v2
 */

import type { Request, RequestHandler, Response, Router } from 'express';
import * as crypto from 'crypto';
import type { AppContext } from '@/app/composition/app-context';
import { confirmationRequiredPayload, hasExplicitWriteConfirmation } from '@/shared/security/explicit-write-confirmation';
import { DEDUCTION_CODES, EARNINGS_CODES, deductionCode } from './payroll-codes';
import { grossUp } from './payroll-grossup';
import {
  auditTrail, createPayments, getDeductionRows, getLineEarnings, recomputeLineV2,
  recordAudit, setLineEarnings, type Queryable,
} from './payroll-ledger';
import {
  last4, maskAccount, maskSsn, normalizeEin, normalizeRouting, normalizeSsn,
  openIdentifier, sealIdentifier, w2Readiness,
} from './payroll-identity';
import { deductionRegister, depositSchedule, laborDistribution, runJournal } from './payroll-reports';
import { allocateTraceStart, buildAchFile } from './payroll-nacha';
import { LookbackInputError, depositorStatusFromLookback, requireLookbackYear } from './payroll-deposits';
import { isGarnishmentCode, orderFactsFromInput, type OrderFacts } from './payroll-garnish';
import { assignWorkweeks, carriedWorkweeks } from './payroll-workweek';
import { flsaRecords } from './payroll-flsa-records';
import type { DeductionRow, EarningRow } from './payroll-payrun';
import { form940, form941, w2Document } from './payroll-forms';
import {
  DEFAULT_SUTA_RATE_PCT, DEFAULT_SUTA_WAGE_BASE_CENTS, PAY_PERIODS, TAX_YEAR, minimumWageCents,
} from './payroll-tax-tables';
import {
  ageAtYearEnd, getCompany, isoDate, money, normalizeDates, normalizeRows, num, scrubSecrets,
  ytdBefore, type Row,
} from './payroll-store';

/** The auth+schema wrapper createPayrollRoutes builds; passed in so both halves share it. */
export type Guarded = (
  op: string,
  fn: (req: Request, res: Response, sub: string) => Promise<void>,
) => RequestHandler;

/** Fetch a row owned by the caller. */
async function owned(ctx: AppContext, table: string, idCol: string, id: string, sub: string): Promise<Row | null> {
  const r = await ctx.pool.query(
    `SELECT * FROM ${table} WHERE ${idCol} = $1 AND user_sub = $2`, [id, sub]);
  return r.rows[0] || null;
}

/** Engine options for one employee on one run, read through any client (a pool, or approval's transaction). */
async function engineOpts(q: Queryable, sub: string, run: Row, emp: Row) {
  const company = await getCompany(q, sub);
  const payDate = isoDate(run.pay_date);
  const year = Number(payDate.slice(0, 4));
  return {
    periodsPerYear: PAY_PERIODS[String(run.pay_frequency)] || 26,
    age: ageAtYearEnd(emp.birth_date, year),
    state: {
      code: String(emp.state_code || company.state_code || ''),
      manualRatePct: num(emp.state_rate_pct),
      allowances: num(emp.state_allowances),
    },
    ytd: await ytdBefore(q, sub, emp, payDate, String(run.run_id)),
    employerTax: {
      sutaRatePct: num(company.suta_rate_pct, DEFAULT_SUTA_RATE_PCT),
      sutaWageBaseCents: money(company.suta_wage_base_cents, DEFAULT_SUTA_WAGE_BASE_CENTS),
      futaCreditReductionPct: num(company.futa_credit_reduction_pct),
      minimumWageCents: minimumWageCents(String(emp.state_code || company.state_code || ''), payDate),
    },
    suppressVoluntaryDeductions: run.suppress_voluntary === true,
    payDate,
  };
}

/**
 * @description Recompute a line built from earning rows, with that engine, on any
 * client. Approval passes this in so a paid line keeps its earning rows and its
 * deduction elections instead of being recomputed from hours and rate.
 * @param q - The approving transaction's client.
 * @param sub - Owning OIDC sub.
 * @param run - The run being approved.
 * @param emp - The employee row.
 * @returns The recomputed check, including any garnishment refusals.
 */
export async function recomputeEarningRowLine(q: Queryable, sub: string, run: Row, emp: Row) {
  const empId = String(emp.employee_id);
  const dated = await datedEarnings(q, sub, run, emp, await getLineEarnings(q, sub, String(run.run_id), empId));
  const deductions = withSettings(emp, await getDeductionRows(q, sub, empId, isoDate(run.pay_date)));
  return recomputeLineV2(q, sub, run, emp, dated.rows, deductions, { ...await engineOpts(q, sub, run, emp), ...dated.opts });
}

/**
 * The deductions set on the employee form (401(k) and Roth percentages, health
 * premium, other post-tax, the single garnishment amount) as rows, for every code
 * no election already covers, so a line moved to earning rows (Hours by day)
 * keeps the deductions the hours-and-rate line took. The single garnishment
 * amount stays unused once garnishment orders are on file, as on that line.
 */
function withSettings(emp: Row, elections: DeductionRow[]): DeductionRow[] {
  const has = new Set(elections.map((e) => e.code));
  const out = [...elections];
  const add = (row: DeductionRow) => { if (!has.has(row.code)) out.push(row); };
  if (num(emp.k401_pct) > 0) add({ code: 'K401', amountCents: 0, percentOfGross: num(emp.k401_pct) });
  if (num(emp.roth_pct) > 0) add({ code: 'ROTH401', amountCents: 0, percentOfGross: num(emp.roth_pct) });
  if (money(emp.health_per_period_cents) > 0) add({ code: 'MED125', amountCents: money(emp.health_per_period_cents) });
  if (money(emp.other_posttax_cents) > 0) add({ code: 'OTHER_POST', amountCents: money(emp.other_posttax_cents) });
  if (money(emp.garnishment_cents) > 0 && !elections.some((e) => isGarnishmentCode(e.code))) {
    add({ code: 'GARN_CREDITOR', amountCents: money(emp.garnishment_cents) });
  }
  return out;
}

/**
 * Place dated rows in the company's workweeks and read what earlier paid checks
 * recorded for a workweek this check shares (payroll-workweek). Undated rows
 * pass through as entered.
 */
async function datedEarnings(q: Queryable, sub: string, run: Row, emp: Row, rows: EarningRow[]) {
  const company = await getCompany(q, sub);
  const placed = assignWorkweeks(rows, isoDate(run.period_start), isoDate(run.period_end), num(company.workweek_start_day));
  if (placed.refusal || !Object.keys(placed.weekStarts).length) return { rows: placed.rows, opts: {}, refusal: placed.refusal };
  const carried = await carriedWorkweeks(q, sub, String(emp.employee_id), String(run.run_id), placed.weekStarts, isoDate(run.period_start));
  return { rows: placed.rows, opts: { carriedWorkweeks: carried, weekStarts: placed.weekStarts }, refusal: '' };
}

/** Register identity + PII routes. */
function identityRoutes(router: Router, ctx: AppContext, guarded: Guarded): void {
  router.put('/company/identity', guarded('company.identity', async (req, res, sub) => {
    const b = (req.body || {}) as Record<string, unknown>;
    const before = await getCompany(ctx.pool, sub);
    const ein = normalizeEin(b.ein);
    if (b.ein && !ein) { res.status(400).json({ error: 'bad_ein', message: 'An EIN must be 9 digits.' }); return; }
    const r = await ctx.pool.query(
      `UPDATE payroll_company SET legal_name=$2, trade_name=$3, address_line1=$4, address_line2=$5,
              city=$6, postal_code=$7, state_account_number=$8, depositor_status=$9,
              workweek_start_day=$10, ein_encrypted=COALESCE($11, ein_encrypted),
              ein_last4=COALESCE($12, ein_last4), workweek_start_time=$13, updated_at=now()
        WHERE user_sub=$1 RETURNING *`,
      [sub, String(b.legalName || '').slice(0, 200), String(b.tradeName || '').slice(0, 200),
        String(b.addressLine1 || '').slice(0, 200), String(b.addressLine2 || '').slice(0, 200),
        String(b.city || '').slice(0, 100), String(b.postalCode || '').slice(0, 20),
        String(b.stateAccountNumber || '').slice(0, 40),
        b.depositorStatus === 'semiweekly' ? 'semiweekly' : 'monthly',
        Math.min(6, Math.max(0, Math.trunc(num(b.workweekStartDay)))),
        ein ? await sealIdentifier(sub, ein) : null, ein ? last4(ein) : null,
        // 29 CFR 516.2(a)(5): the time of day the workweek begins, beside its day.
        /^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.workweekStartTime || '')) ? String(b.workweekStartTime) : '00:00']);
    await recordAudit(ctx.pool, sub, 'company', sub, 'update', sub, before, r.rows[0]);
    res.json({ company: scrubSecrets(r.rows[0]) });
  }));

  router.put('/employees/:id/identity', guarded('employee.identity', async (req, res, sub) => {
    const b = (req.body || {}) as Record<string, unknown>;
    const id = String(req.params.id);
    const before = await owned(ctx, 'payroll_employees', 'employee_id', id, sub);
    if (!before) { res.status(404).json({ error: 'not_found' }); return; }
    const ssn = b.ssn === undefined || b.ssn === '' ? null : normalizeSsn(b.ssn);
    if (b.ssn && !ssn) {
      res.status(400).json({ error: 'bad_ssn', message: 'That is not a structurally valid Social Security number.' });
      return;
    }
    const r = await ctx.pool.query(
      `UPDATE payroll_employees SET address_line1=$3, address_line2=$4, city=$5, postal_code=$6,
              worker_type=$7, flsa_exempt=$8, department=$9, cost_center=$10, work_location=$11,
              pay_method=$12, ssn_encrypted=COALESCE($13, ssn_encrypted),
              ssn_last4=COALESCE($14, ssn_last4), updated_at=now()
        WHERE employee_id=$1 AND user_sub=$2 RETURNING *`,
      [id, sub, String(b.addressLine1 || '').slice(0, 200), String(b.addressLine2 || '').slice(0, 200),
        String(b.city || '').slice(0, 100), String(b.postalCode || '').slice(0, 20),
        b.workerType === '1099' ? '1099' : 'w2', b.flsaExempt === true,
        String(b.department || '').slice(0, 80), String(b.costCenter || '').slice(0, 80),
        String(b.workLocation || '').slice(0, 80),
        b.payMethod === 'direct_deposit' ? 'direct_deposit' : 'check',
        ssn ? await sealIdentifier(sub, ssn) : null, ssn ? last4(ssn) : null]);
    await recordAudit(ctx.pool, sub, 'employee', id, 'update', sub, before, r.rows[0]);
    const out = normalizeDates(r.rows[0]);
    out.ssn_masked = maskSsn(String(out.ssn_last4 || ''));
    res.json({ employee: out });
  }));

  /** The ONE route that returns a full SSN. Confirm-gated and audited. */
  router.post('/employees/:id/ssn', guarded('employee.ssn.reveal', async (req, res, sub) => {
    if (!hasExplicitWriteConfirmation(req.body)) {
      res.status(428).json(confirmationRequiredPayload('no-reveal', 'Revealing a full Social Security number'));
      return;
    }
    const id = String(req.params.id);
    const emp = await owned(ctx, 'payroll_employees', 'employee_id', id, sub);
    if (!emp) { res.status(404).json({ error: 'not_found' }); return; }
    const ssn = await openIdentifier(sub, emp.ssn_encrypted);
    if (!ssn) { res.status(409).json({ error: 'no_ssn', message: 'No SSN is on file for this employee.' }); return; }
    // Audited BEFORE the value leaves — a read that is not recorded did not happen.
    await recordAudit(ctx.pool, sub, 'employee', id, 'ssn-reveal', sub, null,
      { revealed: true, reason: String((req.body as Record<string, unknown>).reason || '') });
    res.json({ ssn, reason: 'This read has been recorded on the audit trail.' });
  }));

  router.get('/employees/:id/bank-accounts', guarded('bank.list', async (req, res, sub) => {
    const rows = (await ctx.pool.query(
      `SELECT account_id, nickname, routing_last4, account_last4, account_type, split_order,
              split_amount_cents, split_percent, active
         FROM payroll_bank_accounts WHERE user_sub=$1 AND employee_id=$2 ORDER BY split_order`,
      [sub, String(req.params.id)])).rows;
    res.json({ accounts: rows.map((a: Row) => ({ ...a, account_masked: maskAccount(String(a.account_last4 || '')) })) });
  }));

  router.post('/employees/:id/bank-accounts', guarded('bank.create', async (req, res, sub) => {
    const b = (req.body || {}) as Record<string, unknown>;
    const id = String(req.params.id);
    if (!await owned(ctx, 'payroll_employees', 'employee_id', id, sub)) { res.status(404).json({ error: 'not_found' }); return; }
    const routing = normalizeRouting(b.routing);
    if (!routing) {
      res.status(400).json({ error: 'bad_routing', message: 'That routing number fails its ABA check digit.' });
      return;
    }
    const account = String(b.account || '').replace(/\D/g, '');
    if (account.length < 4) { res.status(400).json({ error: 'bad_account' }); return; }
    const accountId = crypto.randomUUID();
    await ctx.pool.query(
      `INSERT INTO payroll_bank_accounts (account_id, user_sub, employee_id, nickname, routing_encrypted,
          routing_last4, account_encrypted, account_last4, account_type, split_order, split_amount_cents, split_percent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [accountId, sub, id, String(b.nickname || '').slice(0, 60), await sealIdentifier(sub, routing), last4(routing),
        await sealIdentifier(sub, account), last4(account),
        b.accountType === 'savings' ? 'savings' : 'checking',
        Math.max(1, Math.trunc(num(b.splitOrder, 1))),
        b.splitAmountCents === undefined ? null : money(b.splitAmountCents),
        b.splitPercent === undefined ? null : num(b.splitPercent)]);
    await recordAudit(ctx.pool, sub, 'bank_account', accountId, 'create', sub, null, { employee_id: id });
    res.json({ ok: true, accountId });
  }));
}

/** Register deduction-election routes. */
function electionRoutes(router: Router, ctx: AppContext, guarded: Guarded): void {
  router.get('/codes', guarded('codes', async (_req, res) => {
    res.json({
      earnings: Object.values(EARNINGS_CODES).map((e) => ({
        code: e.code, label: e.label, entry: e.entry, multiplier: e.multiplier,
        paid: e.paid, hoursWorked: e.hoursWorked, note: e.note,
      })),
      deductions: Object.values(DEDUCTION_CODES).map((d) => ({
        code: d.code, label: d.label, reduces: d.reduces, statutory: d.statutory,
        garnishmentPriority: d.garnishmentPriority, note: d.note,
      })),
    });
  }));

  router.get('/employees/:id/deductions', guarded('elections.list', async (req, res, sub) => {
    const rows = (await ctx.pool.query(
      'SELECT * FROM payroll_deduction_elections WHERE user_sub=$1 AND employee_id=$2 ORDER BY code',
      [sub, String(req.params.id)])).rows;
    res.json({ elections: normalizeRows(rows) });
  }));

  router.delete('/employees/:id/deductions/:electionId', guarded('elections.delete', async (req, res, sub) => {
    const eid = String(req.params.electionId);
    const before = await owned(ctx, 'payroll_deduction_elections', 'election_id', eid, sub);
    if (!before) { res.status(404).json({ error: 'not_found' }); return; }
    // Never hard-delete an election with history — deactivate it so the audit
    // trail and any arrears balance survive.
    const r = await ctx.pool.query(
      'UPDATE payroll_deduction_elections SET active=false, updated_at=now() WHERE election_id=$1 AND user_sub=$2 RETURNING *',
      [eid, sub]);
    await recordAudit(ctx.pool, sub, 'deduction_election', eid, 'deactivate', sub, before, r.rows[0]);
    res.json({ ok: true, deactivated: true });
  }));
}

/** Register earning-row + gross-up routes. */
function earningsRoutes(router: Router, ctx: AppContext, guarded: Guarded): void {
  router.get('/runs/:id/lines/:employeeId/earnings', guarded('earnings.list', async (req, res, sub) => {
    res.json({ earnings: await getLineEarnings(ctx.pool, sub, String(req.params.id), String(req.params.employeeId)) });
  }));

  router.put('/runs/:id/lines/:employeeId/earnings', guarded('earnings.set', async (req, res, sub) => {
    const runId = String(req.params.id);
    const empId = String(req.params.employeeId);
    const run = await owned(ctx, 'payroll_runs', 'run_id', runId, sub);
    if (!run) { res.status(404).json({ error: 'not_found' }); return; }
    if (run.status !== 'draft') {
      res.status(409).json({ error: 'run_not_draft', message: 'Only a draft run can be edited. Void the paid run to correct it.' });
      return;
    }
    const emp = await owned(ctx, 'payroll_employees', 'employee_id', empId, sub);
    if (!emp) { res.status(404).json({ error: 'employee_not_found' }); return; }

    const rows = Array.isArray((req.body || {}).earnings) ? (req.body as { earnings: Row[] }).earnings : [];
    const unknown = rows.map((r) => String(r.code || '').toUpperCase()).filter((c) => !EARNINGS_CODES[c]);
    if (unknown.length) {
      res.status(400).json({ error: 'unknown_earnings_code', message: `Unknown code(s): ${[...new Set(unknown)].join(', ')}.` });
      return;
    }
    const entered = rows.map((r) => ({
      code: String(r.code).toUpperCase(), hours: num(r.hours), rateCents: money(r.rateCents),
      amountCents: money(r.amountCents), workweek: Math.max(1, Math.trunc(num(r.workweek, 1)) || 1),
      memo: String(r.memo || ''), ...(r.workDate ? { workDate: String(r.workDate).slice(0, 10) } : {}),
    }));
    // A dated row's workweek comes from its date (29 CFR 516.2(a)(7)), never from the typed index.
    const dated = await datedEarnings(ctx.pool, sub, run, emp, entered);
    if (dated.refusal) { res.status(422).json({ error: 'bad_work_date', message: dated.refusal }); return; }
    await setLineEarnings(ctx.pool, sub, runId, empId, dated.rows);
    const deductions = withSettings(emp, await getDeductionRows(ctx.pool, sub, empId, isoDate(run.pay_date)));
    const check = await recomputeLineV2(ctx.pool, sub, run, emp, dated.rows, deductions,
      { ...await engineOpts(ctx.pool, sub, run, emp), ...dated.opts });
    res.json({ ok: true, check, warnings: check.warnings });
  }));

  router.post('/grossup', guarded('grossup', async (req, res, sub) => {
    const b = (req.body || {}) as Record<string, unknown>;
    const empId = String(b.employeeId || '');
    const runId = String(b.runId || '');
    const run = await owned(ctx, 'payroll_runs', 'run_id', runId, sub);
    const emp = await owned(ctx, 'payroll_employees', 'employee_id', empId, sub);
    if (!run || !emp) { res.status(404).json({ error: 'not_found' }); return; }
    const code = String(b.code || 'BONUS_D').toUpperCase();
    if (!EARNINGS_CODES[code]) { res.status(400).json({ error: 'unknown_earnings_code' }); return; }
    const base = await getLineEarnings(ctx.pool, sub, runId, empId);
    const deductions = await getDeductionRows(ctx.pool, sub, empId, isoDate(run.pay_date));
    const result = grossUp(money(b.targetNetCents), code, base, deductions, {
      filingStatus: (emp.filing_status as 'single' | 'married' | 'hoh') || 'single',
      step2: emp.w4_step2 === true,
      dependentsCreditCents: money(emp.w4_dependents_credit_cents),
      otherIncomeCents: money(emp.w4_other_income_cents),
      deductionsCents: money(emp.w4_deductions_cents),
      extraWithholdingCents: money(emp.w4_extra_withholding_cents),
      exempt: emp.w4_exempt === true,
    }, await engineOpts(ctx.pool, sub, run, emp));
    res.json({
      grossCents: result.grossCents, achievedNetCents: result.achievedNetCents,
      exact: result.exact, iterations: result.iterations, warnings: result.warnings,
    });
  }));
}

/** Insert one deduction election; a garnishment order's facts come checked from orderFactsFromInput. */
async function insertElection(
  ctx: AppContext, sub: string, employeeId: string, code: string, b: Record<string, unknown>, f?: OrderFacts,
): Promise<{ electionId: string; row: Row }> {
  const electionId = crypto.randomUUID();
  const r = await ctx.pool.query(
    `INSERT INTO payroll_deduction_elections (election_id, user_sub, employee_id, code, amount_cents,
        percent_of_gross, annual_limit_cents, support_ccpa_pct, payee, case_number, effective_from, effective_to,
        served_on, entered_on, priority_rank, order_pct, levy_filing_status, levy_dependents, levy_additional_std,
        levy_statement_on)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
    [electionId, sub, employeeId, code, f ? f.amountCents : money(b.amountCents),
      b.percentOfGross === undefined || f ? null : num(b.percentOfGross),
      b.annualLimitCents === undefined ? null : money(b.annualLimitCents),
      f ? f.supportCcpaPct : (b.supportCcpaPct === undefined ? null : Math.min(65, num(b.supportCcpaPct))),
      String(b.payee || '').slice(0, 120), String(b.caseNumber || '').slice(0, 60),
      b.effectiveFrom || null, b.effectiveTo || null,
      f ? f.servedOn : null, f ? f.enteredOn : null, f ? f.priorityRank : null, f ? f.orderPct : null,
      f ? f.levyFilingStatus : '', f ? f.levyDependents : 0, f ? f.levyAdditionalStd : 0, f ? f.levyStatementOn : null]);
  return { electionId, row: r.rows[0] };
}

/** Register the routes that create an election and correct a garnishment order's facts. */
function orderRoutes(router: Router, ctx: AppContext, guarded: Guarded): void {
  router.post('/employees/:id/deductions', guarded('elections.create', async (req, res, sub) => {
    const b = (req.body || {}) as Record<string, unknown>;
    const id = String(req.params.id);
    const code = String(b.code || '').toUpperCase();
    if (!deductionCode(code)) {
      res.status(400).json({ error: 'unknown_code', message: `Unknown deduction code ${code}.` }); return;
    }
    // A garnishment order carries the facts its limit and priority depend on (payroll-garnish).
    const order = isGarnishmentCode(code) ? orderFactsFromInput(code, b) : null;
    if (order && order.message) { res.status(400).json({ error: 'bad_order', message: order.message }); return; }
    if (!await owned(ctx, 'payroll_employees', 'employee_id', id, sub)) { res.status(404).json({ error: 'not_found' }); return; }
    const { electionId, row } = await insertElection(ctx, sub, id, code, b, order?.facts);
    await recordAudit(ctx.pool, sub, 'deduction_election', electionId, 'create', sub, null, row);
    res.json({ election: normalizeDates(row) });
  }));

  /** PUT /employees/:id/deductions/:electionId/order — correct a garnishment order's facts; audited. */
  router.put('/employees/:id/deductions/:electionId/order', guarded('elections.order', async (req, res, sub) => {
    const eid = String(req.params.electionId);
    const before = await owned(ctx, 'payroll_deduction_elections', 'election_id', eid, sub);
    if (!before || String(before.employee_id) !== String(req.params.id)) { res.status(404).json({ error: 'not_found' }); return; }
    const code = String(before.code);
    if (!isGarnishmentCode(code)) { res.status(400).json({ error: 'not_an_order', message: 'Only a garnishment order has order facts.' }); return; }
    const order = orderFactsFromInput(code, { ...(req.body || {}) as Record<string, unknown> });
    if (!order.facts) { res.status(400).json({ error: 'bad_order', message: order.message }); return; }
    const f = order.facts;
    const r = await ctx.pool.query(
      `UPDATE payroll_deduction_elections SET amount_cents=$3, order_pct=$4, support_ccpa_pct=$5, served_on=$6,
          entered_on=$7, priority_rank=$8, levy_filing_status=$9, levy_dependents=$10, levy_additional_std=$11,
          levy_statement_on=$12, updated_at=now()
        WHERE election_id=$1 AND user_sub=$2 RETURNING *`,
      [eid, sub, f.amountCents, f.orderPct, f.supportCcpaPct, f.servedOn, f.enteredOn, f.priorityRank,
        f.levyFilingStatus, f.levyDependents, f.levyAdditionalStd, f.levyStatementOn]);
    await recordAudit(ctx.pool, sub, 'deduction_election', eid, 'order-facts', sub, before, r.rows[0]);
    res.json({ election: normalizeDates(r.rows[0]) });
  }));
}

/** Register the 29 CFR 516.2 payroll record. */
function recordRoutes(router: Router, ctx: AppContext, guarded: Guarded): void {
  /** GET /reports/flsa-records/:employeeId?from&to — the FLSA record from stored rows; reads only. */
  router.get('/reports/flsa-records/:employeeId', guarded('reports.flsa', async (req, res, sub) => {
    const from = isoDate(req.query.from || `${TAX_YEAR}-01-01`);
    const to = isoDate(req.query.to || `${TAX_YEAR}-12-31`);
    const record = await flsaRecords(ctx.pool, sub, String(req.params.employeeId), from, to);
    if (!record) { res.status(404).json({ error: 'not_found' }); return; }
    res.json(record);
  }));
}

/** Register the federal deposit schedule and the lookback status routes. */
function depositRoutes(router: Router, ctx: AppContext, guarded: Guarded): void {
  /**
   * GET /reports/deposits — what each deposit period owes and when. A due date
   * in a year the IRS calendar does not hold travels as words on that row.
   */
  router.get('/reports/deposits', guarded('reports.deposits', async (req, res, sub) => {
    const year = Number(String(req.query.year || TAX_YEAR).replace(/\D/g, '')) || TAX_YEAR;
    const company = await getCompany(ctx.pool, sub);
    const status = String(company.depositor_status || 'monthly');
    const schedule = await depositSchedule(ctx.pool, sub, year, status, isoDate(new Date()));
    res.json({ ...schedule, depositorStatus: status });
  }));

  /**
   * GET /deposits/lookback — monthly or semiweekly from the four lookback
   * quarters the person enters. Computes only; nothing is saved here.
   */
  router.get('/deposits/lookback', guarded('deposits.lookback', async (req, res) => {
    const year = Number(String(req.query.year || TAX_YEAR).replace(/\D/g, '')) || TAX_YEAR;
    const filed944 = String(req.query.filed944 || '') === 'true';
    const amounts = ['q1', 'q2', 'q3', 'q4'].map((k) => req.query[k]);
    try {
      // With no amounts yet, answer which quarters to look up; with all four, the status.
      res.json(amounts.some((a) => a === undefined || a === '')
        ? { year, filed944, period: requireLookbackYear(year, filed944) }
        : { ...depositorStatusFromLookback(year, amounts.map((a) => String(a)), filed944), filed944 });
    } catch (err) {
      if (!(err instanceof LookbackInputError)) throw err;
      res.status(422).json({ error: err.code, message: err.message });
    }
  }));
}

/** Register report + audit routes. */
function reportRoutes(router: Router, ctx: AppContext, guarded: Guarded): void {
  router.get('/reports/journal/:runId', guarded('reports.journal', async (req, res, sub) => {
    const j = await runJournal(ctx.pool, sub, String(req.params.runId));
    if (!j) { res.status(404).json({ error: 'not_found' }); return; }
    res.json(j);
  }));

  router.get('/reports/deduction-register', guarded('reports.deductions', async (req, res, sub) => {
    const from = isoDate(req.query.from || `${TAX_YEAR}-01-01`);
    const to = isoDate(req.query.to || `${TAX_YEAR}-12-31`);
    res.json({ from, to, rows: await deductionRegister(ctx.pool, sub, from, to) });
  }));

  router.get('/reports/labor', guarded('reports.labor', async (req, res, sub) => {
    const from = isoDate(req.query.from || `${TAX_YEAR}-01-01`);
    const to = isoDate(req.query.to || `${TAX_YEAR}-12-31`);
    res.json({ from, to, rows: await laborDistribution(ctx.pool, sub, from, to) });
  }));

  router.get('/reports/w2-readiness/:employeeId', guarded('reports.w2ready', async (req, res, sub) => {
    const emp = await owned(ctx, 'payroll_employees', 'employee_id', String(req.params.employeeId), sub);
    if (!emp) { res.status(404).json({ error: 'not_found' }); return; }
    res.json(w2Readiness(await getCompany(ctx.pool, sub), emp));
  }));

  router.get('/payments', guarded('payments.list', async (req, res, sub) => {
    const runId = String(req.query.runId || '');
    const rows = (await ctx.pool.query(
      `SELECT p.*, e.first_name, e.last_name FROM payroll_payments p
         JOIN payroll_employees e ON e.employee_id = p.employee_id AND e.user_sub = p.user_sub
        WHERE p.user_sub = $1 AND ($2 = '' OR p.run_id = $2)
        ORDER BY p.issued_on DESC, e.last_name LIMIT 500`, [sub, runId])).rows;
    res.json({ payments: normalizeRows(rows) });
  }));

  router.get('/audit/:entity/:entityId', guarded('audit.read', async (req, res, sub) => {
    res.json({ trail: await auditTrail(ctx.pool, sub, String(req.params.entity), String(req.params.entityId)) });
  }));
}

/** Register the disbursement + filing ARTIFACT routes. */
function artifactRoutes(router: Router, ctx: AppContext, guarded: Guarded): void {
  /**
   * POST /runs/:id/ach — build the NACHA file for a paid run.
   *
   * Generating the file is not sending money, but it IS the artifact a bank
   * executes, so it sits behind the same explicit confirm as the other money
   * actions and is recorded on the audit trail.
   */
  router.post('/runs/:id/ach', guarded('ach.build', async (req, res, sub) => {
    if (!hasExplicitWriteConfirmation(req.body)) {
      res.status(428).json(confirmationRequiredPayload('no-ach', 'Generating an ACH file your bank will execute'));
      return;
    }
    const runId = String(req.params.id);
    const run = await owned(ctx, 'payroll_runs', 'run_id', runId, sub);
    if (!run) { res.status(404).json({ error: 'not_found' }); return; }
    if (run.status !== 'paid') {
      res.status(409).json({ error: 'run_not_paid', message: 'Approve the run before generating its ACH file.' });
      return;
    }
    const company = await getCompany(ctx.pool, sub);
    const rows = (await ctx.pool.query(
      `SELECT p.amount_cents, e.first_name, e.last_name, e.employee_id,
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
    const entries = await Promise.all(rows.map(async (r: Row) => ({
      routingNumber: (await openIdentifier(sub, r.routing_encrypted)) || '',
      accountNumber: (await openIdentifier(sub, r.account_encrypted)) || '',
      accountType: r.account_type === 'savings' ? 'savings' as const : 'checking' as const,
      amountCents: money(r.amount_cents),
      name: `${r.last_name} ${r.first_name}`,
      // NOT truncated here. buildAchFile truncates to 15 characters for the
      // record's Individual Identification Number field, but it also hands the
      // id back on the trace, and THAT value is used as a database key.
      // Employee ids are UUIDs, so pre-truncating made `WHERE employee_id = $4`
      // match nothing: ach_trace was never written, and every subsequent return
      // was permanently unmatchable — the exact failure this feature exists to
      // prevent, hidden because the guard used a two-character fixture id.
      employeeId: String(r.employee_id),
    })));
    const now = new Date();
    // Continue the trace sequence across files. Restarting at 1 would let two
    // runs mint identical traces, and since a return is matched on the trace
    // alone, one run's return could then mark another run's payment.
    const traceStart = await allocateTraceStart(ctx.pool, sub, entries.length);
    const file = buildAchFile(entries, {
      traceStart,
      odfiRoutingNumber: String(company.ach_odfi_routing || ''),
      odfiName: String(company.ach_odfi_name || ''),
      companyName: String(company.legal_name || company.company_name || ''),
      companyId: String(company.ach_company_id || ''),
      entryDescription: String(company.ach_entry_description || 'PAYROLL'),
      effectiveDate: isoDate(run.pay_date),
      fileDate: isoDate(now),
      fileTime: `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`,
    }, (req.body as Record<string, unknown>).prenote === true);

    await recordAudit(ctx.pool, sub, 'run', runId, 'ach-generated', sub, null,
      { entries: file.entryCount, totalCents: file.totalCreditCents, valid: file.valid });

    if (!file.valid) {
      res.status(409).json({ error: 'ach_invalid', problems: file.problems });
      return;
    }

    // Persist the trace numbers. A return or notification of change identifies
    // the entry it concerns ONLY by its original trace, so a file sent without
    // recording these leaves every returned deposit unmatchable — and a failed
    // deposit then looks exactly like a successful one. A prenote moves no
    // money, so its traces are not recorded against the payments.
    if ((req.body as Record<string, unknown>).prenote !== true) {
      for (const t of file.traces) {
        await ctx.pool.query(
          `UPDATE payroll_payments SET ach_trace = $3, updated_at = now()
            WHERE user_sub = $1 AND run_id = $2 AND employee_id = $4 AND method = 'direct_deposit'`,
          [sub, runId, t.trace, t.employeeId]);
      }
    }
    res.type('text/plain').set(
      'Content-Disposition',
      `attachment; filename="payroll-${isoDate(run.pay_date)}.ach"`,
    ).send(file.content);
  }));

  router.get('/forms/941', guarded('forms.941', async (req, res, sub) => {
    const year = Number(String(req.query.year || TAX_YEAR).replace(/\D/g, '')) || TAX_YEAR;
    const quarter = Math.min(4, Math.max(1, Number(req.query.quarter) || 1));
    res.json(await form941(ctx.pool, sub, year, quarter));
  }));

  router.get('/forms/940', guarded('forms.940', async (req, res, sub) => {
    const year = Number(String(req.query.year || TAX_YEAR).replace(/\D/g, '')) || TAX_YEAR;
    res.json(await form940(ctx.pool, sub, year));
  }));

  /**
   * POST /forms/w2/:employeeId — the real W-2.
   *
   * Confirm-gated and audited because producing it decrypts the SSN and the EIN.
   * When identity is incomplete it returns `issuable: false` with the missing
   * fields named, rather than a document that cannot legally be filed.
   */
  router.post('/forms/w2/:employeeId', guarded('forms.w2', async (req, res, sub) => {
    if (!hasExplicitWriteConfirmation(req.body)) {
      res.status(428).json(confirmationRequiredPayload('no-w2', 'Producing a W-2 (this decrypts the SSN and EIN)'));
      return;
    }
    const year = Number(String((req.body as Record<string, unknown>).year || TAX_YEAR)) || TAX_YEAR;
    const emp = await owned(ctx, 'payroll_employees', 'employee_id', String(req.params.employeeId), sub);
    if (!emp) { res.status(404).json({ error: 'not_found' }); return; }
    const company = await getCompany(ctx.pool, sub);
    const doc = await w2Document(ctx.pool, sub, emp, company, year, {
      ssn: await openIdentifier(sub, emp.ssn_encrypted),
      ein: await openIdentifier(sub, company.ein_encrypted),
    });
    await recordAudit(ctx.pool, sub, 'employee', String(emp.employee_id), 'w2-produced', sub, null,
      { year, issuable: doc.issuable });
    res.json(doc);
  }));
}

/**
 * @description Mount every v2 route onto the payroll router.
 * @param router - The router createPayrollRoutes built.
 * @param ctx - App context.
 * @param guarded - The shared auth + schema + error wrapper.
 */
export function registerV2Routes(router: Router, ctx: AppContext, guarded: Guarded): void {
  identityRoutes(router, ctx, guarded);
  electionRoutes(router, ctx, guarded);
  orderRoutes(router, ctx, guarded);
  earningsRoutes(router, ctx, guarded);
  reportRoutes(router, ctx, guarded);
  depositRoutes(router, ctx, guarded);
  recordRoutes(router, ctx, guarded);
  artifactRoutes(router, ctx, guarded);
}

/** Re-exported so the approve path can create payment records in its transaction. */
export { createPayments };
