/**
 * Payroll routes — HTTP surface over the payroll store and the deterministic
 * engine. Run an ADP-style payroll for the caller's own company.
 *
 * NO LLM: every dollar comes from payroll-engine.ts over the primary-source
 * constants in payroll-tax-tables.ts. Persistence lives in payroll-store.ts;
 * this file is HTTP only.
 *
 * The two money actions — approving a run and voiding a paid one — sit behind
 * the explicit-confirm 428 gate and are recorded with the approving sub. A paid
 * run is NEVER mutated: a mistake is corrected by a linked void run.
 *
 * oshal records payroll. It does not move funds, remit deposits, or file returns.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-31 23:00:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — company settings, employee CRUD w/ W-4 + election profiles, pay-run lifecycle (draft → approve behind confirm → paid), pay-stub payload, liability + W-2-preview reports.
 * 2026-08-01 11:00:00 | maintainer@emeraldcoastsystemsgroup.com | v1.1 — persistence carved into payroll-store.ts (this file was nearing the 1000-line cap). New: POST /runs/:id/void (confirm-gated linked reversal, the correction mechanism a paid run previously had no way to get), approval audit trail on approve/void, per-line tips + FLSA-qualified-overtime + proration + bonus-method inputs, GET /states coverage honesty, weekend pay-date shifting, and a W-2 preview that now emits box 12 (D deferrals / TT qualified overtime / TP cash tips) and box 14b as TY2026 requires.
 *
 * @module payroll-routes
 */

import { Router, type Request, type Response, type RequestHandler } from 'express';
import * as path from 'path';
import * as crypto from 'crypto';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { confirmationRequiredPayload, hasExplicitWriteConfirmation } from '@/shared/security/explicit-write-confirmation';
import { supportedStates, stateSupport } from './payroll-state-tax';
import { registerV2Routes } from './payroll-routes-v2';
import { registerSettlementRoutes } from './payroll-routes-settle';
import { createPayments, recordAudit } from './payroll-ledger';
import { PAY_PERIODS, TAX_YEAR, DEFAULT_SUTA_RATE_PCT, DEFAULT_SUTA_WAGE_BASE_CENTS } from './payroll-tax-tables';
import type { PayInputs } from './payroll-engine';
import {
  KIND_REGULAR, KIND_VOID, NegativeNetError, RUN_DRAFT, RUN_PAID, addDays, approveRun,
  createVoidRun, employeeCols,
  ensurePayrollSchema, fmtUtc, getCompany, insertEmployee, isoDate, isoDateOrNull, money,
  normalizeDates, normalizeRows, num, recomputeLine, scrubSecrets, updateCompany, updateEmployee, type Row,
} from './payroll-store';

const logger = createChildLogger({ module: 'payroll-routes' });

/** Package install dir — set by the loader on the context; env fallback at load time. */
let packageDir = process.env.OSHAL_APP_PACKAGE_DIR || '';

/** Default hours PER PAY PERIOD for a new hourly employee, by frequency. */
const DEFAULT_PERIOD_HOURS: Record<string, number> = { weekly: 40, biweekly: 80, semimonthly: 86.67, monthly: 173.33 };

/** Signed-in caller's OIDC sub. */
function callerSub(req: Request): string | null {
  const u = (req as { oidc?: { user?: { sub?: string; oid?: string } } }).oidc?.user;
  const sub = u?.sub || u?.oid;
  return sub ? String(sub) : null;
}

/** Serve a static surface file from the package's tools dir. */
function servePage(surfaceDir: string, file: string): RequestHandler {
  return (_req, res) => {
    res.sendFile(path.join(surfaceDir, file), (err) => {
      if (err) { logger.error({ err, file }, 'serve payroll surface failed'); res.status(404).send('Not found'); }
    });
  };
}

/** Wrap a handler with auth + schema + uniform error reporting. */
function guarded(
  ctx: AppContext,
  op: string,
  fn: (req: Request, res: Response, sub: string) => Promise<void>,
): RequestHandler {
  return async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      await ensurePayrollSchema(ctx.pool);
      await fn(req, res, sub);
    } catch (err) {
      logger.error({ err, op }, 'payroll route failed');
      if (!res.headersSent) res.status(500).json({ error: 'internal_error', message: (err as Error).message });
    }
  };
}

/** Shift a pay date off Saturday/Sunday back to the preceding Friday. */
function shiftOffWeekend(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  if (day === 6) return addDays(iso, -1);
  if (day === 0) return addDays(iso, -2);
  return iso;
}

/** Derive the next pay period from the frequency and the last run's end. */
function derivePeriod(frequency: string, lastEnd: string | null, today: string): { start: string; end: string; payDate: string } {
  const start = lastEnd ? addDays(lastEnd, 1) : today;
  let end: string;
  if (frequency === 'weekly') end = addDays(start, 6);
  else if (frequency === 'biweekly') end = addDays(start, 13);
  else if (frequency === 'semimonthly') {
    const d = new Date(`${start}T00:00:00Z`);
    end = d.getUTCDate() <= 15
      ? fmtUtc(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 15)))
      : fmtUtc(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
  } else {
    const d = new Date(`${start}T00:00:00Z`);
    end = fmtUtc(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
  }
  return { start, end, payDate: addDays(end, 5) };
}

/** Read per-line pay inputs from a request body. */
function payInputs(b: Record<string, unknown>): PayInputs {
  return {
    hours: num(b.hours),
    otHours: num(b.otHours),
    bonusCents: money(b.bonusCents),
    tipsCents: money(b.tipsCents),
    reimbursementCents: money(b.reimbursementCents),
    proratePct: Math.min(100, num(b.proratePct, 100)),
    bonusMethod: b.bonusMethod === 'flat' ? 'flat' : 'aggregate',
    otIsFlsaQualified: b.otIsFlsaQualified !== false,
    bonusIsDiscretionary: b.bonusIsDiscretionary === true,
  };
}

/** Whole days between two YYYY-MM-DD dates, inclusive of both endpoints. */
function daysInclusive(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * @description Proration percentage for a SALARY employee whose hire or
 * termination date falls inside the pay period. Calendar-day based, which is the
 * common convention and is at least explicit; 100 when they worked the whole
 * period or are hourly (hours already carry it).
 * @param emp - Employee row.
 * @param start - Period start, YYYY-MM-DD.
 * @param end - Period end, YYYY-MM-DD.
 * @returns 0–100.
 */
function salaryProratePct(emp: Row, start: string, end: string): number {
  if (emp.comp_type !== 'salary') return 100;
  const hire = isoDateOrNull(emp.hire_date);
  const term = isoDateOrNull(emp.termination_date);
  const from = hire && hire > start ? hire : start;
  const to = term && term < end ? term : end;
  if (from === start && to === end) return 100;
  const total = daysInclusive(start, end);
  const worked = daysInclusive(from, to);
  if (!(total > 0) || !(worked > 0)) return 0;
  return Math.max(0, Math.min(100, (worked / total) * 100));
}

/** Fetch a run owned by the caller, or null. */
async function ownedRun(ctx: AppContext, sub: string, id: string): Promise<Row | null> {
  const r = await ctx.pool.query('SELECT * FROM payroll_runs WHERE run_id = $1 AND user_sub = $2', [id, sub]);
  return r.rows[0] || null;
}

/** Fetch an employee owned by the caller, or null. */
async function ownedEmployee(ctx: AppContext, sub: string, id: string): Promise<Row | null> {
  const r = await ctx.pool.query('SELECT * FROM payroll_employees WHERE employee_id = $1 AND user_sub = $2', [id, sub]);
  return r.rows[0] || null;
}

/** Register company + state-coverage routes. */
function companyRoutes(router: Router, ctx: AppContext): void {
  router.get('/company', guarded(ctx, 'company.read', async (_req, res, sub) => {
    res.json({ company: scrubSecrets(await getCompany(ctx.pool, sub)), taxYear: TAX_YEAR });
  }));

  router.put('/company', guarded(ctx, 'company.update', async (req, res, sub) => {
    const b = (req.body || {}) as Record<string, unknown>;
    await getCompany(ctx.pool, sub);
    const company = await updateCompany(ctx.pool, sub, {
      company_name: String(b.companyName || 'My Company').trim().slice(0, 120),
      pay_frequency: PAY_PERIODS[String(b.payFrequency)] ? String(b.payFrequency) : 'biweekly',
      state_code: String(b.stateCode || 'FL').trim().toUpperCase().slice(0, 2),
      suta_rate_pct: Math.min(100, num(b.sutaRatePct, DEFAULT_SUTA_RATE_PCT)),
      suta_wage_base_cents: money(b.sutaWageBaseCents, DEFAULT_SUTA_WAGE_BASE_CENTS),
      futa_credit_reduction_pct: Math.min(100, num(b.futaCreditReductionPct)),
      shift_pay_date: b.shiftPayDate !== false,
      // ACH origination — shapes the file the employer's own bank executes.
      ach_odfi_routing: String(b.achOdfiRouting || '').replace(/\D/g, '').slice(0, 9),
      ach_odfi_name: String(b.achOdfiName || '').slice(0, 60),
      ach_company_id: String(b.achCompanyId || '').replace(/\D/g, '').slice(0, 10),
      ach_entry_description: String(b.achEntryDescription || 'PAYROLL').slice(0, 10),
      // v2.2 settlement. The BSO User ID names the person attesting to an EFW2
      // submission, and SSA rejects a file with no contact e-mail — both are
      // identity, not secrets, so they live here rather than on the audited
      // identity route.
      bank_name: String(b.bankName || '').slice(0, 80),
      bso_user_id: String(b.bsoUserId || '').trim().toUpperCase().slice(0, 8),
      contact_name: String(b.contactName || '').slice(0, 27),
      contact_phone: String(b.contactPhone || '').replace(/\D/g, '').slice(0, 15),
      contact_email: String(b.contactEmail || '').slice(0, 40),
      kind_of_employer: ['F', 'S', 'T', 'Y', 'N'].includes(String(b.kindOfEmployer)) ? String(b.kindOfEmployer) : 'N',
      employment_code: ['A', 'H', 'M', 'Q', 'X', 'F', 'R'].includes(String(b.employmentCode)) ? String(b.employmentCode) : 'R',
    });
    res.json({ company: scrubSecrets(company) });
  }));

  /** GET /states — which states this build computes from a verified table, honestly. */
  router.get('/states', guarded(ctx, 'states', async (req, res) => {
    const code = String((req.query.code as string) || '');
    res.json({ supported: supportedStates(), detail: code ? stateSupport(code) : null });
  }));
}

/** Register employee CRUD routes. */
function employeeRoutes(router: Router, ctx: AppContext): void {
  router.get('/employees', guarded(ctx, 'employees.list', async (_req, res, sub) => {
    const rows = (await ctx.pool.query(
      'SELECT * FROM payroll_employees WHERE user_sub = $1 ORDER BY last_name, first_name', [sub])).rows;
    res.json({ employees: normalizeRows(rows) });
  }));

  router.post('/employees', guarded(ctx, 'employees.create', async (req, res, sub) => {
    const cols = employeeCols((req.body || {}) as Record<string, unknown>);
    if (!cols.first_name || !cols.last_name) {
      res.status(400).json({ error: 'name_required', message: 'firstName and lastName are required.' });
      return;
    }
    res.json({ employee: normalizeDates(await insertEmployee(ctx.pool, sub, cols)) });
  }));

  router.put('/employees/:id', guarded(ctx, 'employees.update', async (req, res, sub) => {
    // partial: true — an edit form that omits a field must NEVER blank it.
    const cols = employeeCols((req.body || {}) as Record<string, unknown>, true);
    const employee = await updateEmployee(ctx.pool, sub, String(req.params.id), cols);
    if (!employee) { res.status(404).json({ error: 'not_found' }); return; }
    res.json({ employee: normalizeDates(employee) });
  }));

  router.delete('/employees/:id', guarded(ctx, 'employees.delete', async (req, res, sub) => {
    const id = String(req.params.id);
    const used = (await ctx.pool.query(
      'SELECT 1 FROM payroll_run_lines WHERE employee_id = $1 AND user_sub = $2 LIMIT 1', [id, sub])).rowCount;
    if (used) {
      const r = await ctx.pool.query(
        "UPDATE payroll_employees SET status = 'terminated', updated_at = now() WHERE employee_id = $1 AND user_sub = $2 RETURNING employee_id",
        [id, sub]);
      if (!r.rows[0]) { res.status(404).json({ error: 'not_found' }); return; }
      res.json({ ok: true, terminated: true, reason: 'Employee has pay history, which is immutable — terminated instead of deleted.' });
      return;
    }
    const r = await ctx.pool.query(
      'DELETE FROM payroll_employees WHERE employee_id = $1 AND user_sub = $2 RETURNING employee_id', [id, sub]);
    if (!r.rows[0]) { res.status(404).json({ error: 'not_found' }); return; }
    res.json({ ok: true, deleted: true });
  }));
}

/** Register pay-run lifecycle routes. */
function runRoutes(router: Router, ctx: AppContext): void {
  router.get('/runs', guarded(ctx, 'runs.list', async (_req, res, sub) => {
    const rows = (await ctx.pool.query(
      `SELECT r.*, COALESCE(t.n,0) AS line_count, COALESCE(t.gross,0) AS total_gross_cents,
              COALESCE(t.net,0) AS total_net_cents, COALESCE(t.er,0) AS total_employer_cents
         FROM payroll_runs r
         LEFT JOIN (SELECT run_id, COUNT(*) n, SUM(gross_cents) gross, SUM(net_cents) net,
                           SUM(er_ss_cents + er_medicare_cents + futa_cents + suta_cents) er
                      FROM payroll_run_lines WHERE user_sub = $1 GROUP BY run_id) t ON t.run_id = r.run_id
        WHERE r.user_sub = $1 ORDER BY r.pay_date DESC, r.created_at DESC LIMIT 60`, [sub])).rows;
    res.json({ runs: normalizeRows(rows) });
  }));

  router.post('/runs', guarded(ctx, 'runs.create', async (req, res, sub) => {
    const b = (req.body || {}) as Record<string, unknown>;
    const company = await getCompany(ctx.pool, sub);
    const freq = String(company.pay_frequency);
    const last = (await ctx.pool.query(
      "SELECT period_end FROM payroll_runs WHERE user_sub = $1 AND kind = 'regular' ORDER BY period_end DESC LIMIT 1",
      [sub])).rows[0];
    const auto = derivePeriod(freq, last ? isoDate(last.period_end) : null, isoDate(new Date()));
    const start = isoDateOrNull(b.periodStart) || auto.start;
    const end = isoDateOrNull(b.periodEnd) || auto.end;
    let payDate = isoDateOrNull(b.payDate) || auto.payDate;
    if (company.shift_pay_date !== false) payDate = shiftOffWeekend(payDate);
    if (end < start) { res.status(400).json({ error: 'bad_period', message: 'periodEnd is before periodStart.' }); return; }
    if (payDate < end) { res.status(400).json({ error: 'bad_pay_date', message: 'payDate cannot precede the period end.' }); return; }

    const runId = crypto.randomUUID();
    const run = (await ctx.pool.query(
      `INSERT INTO payroll_runs (run_id, user_sub, period_start, period_end, pay_date, pay_frequency, kind)
       VALUES ($1,$2,$3,$4,$5,$6,'${KIND_REGULAR}') RETURNING *`,
      [runId, sub, start, end, payDate, freq])).rows[0];

    // Only employees actually employed during the period get a line.
    const employees = (await ctx.pool.query(
      `SELECT * FROM payroll_employees
        WHERE user_sub = $1 AND status = 'active'
          AND (hire_date IS NULL OR hire_date <= $2)
          AND (termination_date IS NULL OR termination_date >= $3)`, [sub, end, start])).rows;
    for (const emp of employees) {
      const hours = emp.comp_type === 'hourly' ? num(emp.default_hours, DEFAULT_PERIOD_HOURS[freq] || 80) : 0;
      await recomputeLine(ctx.pool, sub, run, emp, {
        hours, otHours: 0, bonusCents: 0, tipsCents: 0, reimbursementCents: 0,
        // A salaried mid-period hire or termination is pre-prorated so the
        // default draft never pays a full period for partial work.
        proratePct: salaryProratePct(emp, start, end),
        bonusMethod: 'aggregate', otIsFlsaQualified: true, bonusIsDiscretionary: false,
      });
    }
    res.json({ run: normalizeDates(run), lineCount: employees.length });
  }));

  router.get('/runs/:id', guarded(ctx, 'runs.read', async (req, res, sub) => {
    const run = await ownedRun(ctx, sub, String(req.params.id));
    if (!run) { res.status(404).json({ error: 'not_found' }); return; }
    const lines = (await ctx.pool.query(
      `SELECT l.*, e.first_name, e.last_name, e.comp_type FROM payroll_run_lines l
         JOIN payroll_employees e ON e.employee_id = l.employee_id AND e.user_sub = l.user_sub
        WHERE l.run_id = $1 AND l.user_sub = $2 ORDER BY e.last_name, e.first_name`, [run.run_id, sub])).rows;
    const voided = (await ctx.pool.query(
      'SELECT run_id FROM payroll_runs WHERE user_sub = $1 AND corrects_run_id = $2', [sub, run.run_id])).rows[0];
    res.json({ run: normalizeDates(run), lines, voidedBy: voided ? voided.run_id : null });
  }));

  router.put('/runs/:id/lines/:employeeId', guarded(ctx, 'runs.line', async (req, res, sub) => {
    const run = await ownedRun(ctx, sub, String(req.params.id));
    if (!run) { res.status(404).json({ error: 'not_found' }); return; }
    if (run.status !== RUN_DRAFT) {
      res.status(409).json({ error: 'run_not_draft', message: 'Only a draft run can be edited. Void the paid run to correct it.' });
      return;
    }
    const emp = await ownedEmployee(ctx, sub, String(req.params.employeeId));
    if (!emp) { res.status(404).json({ error: 'employee_not_found' }); return; }
    const check = await recomputeLine(ctx.pool, sub, run, emp, payInputs((req.body || {}) as Record<string, unknown>));
    res.json({ ok: true, line: check, warnings: check.warnings });
  }));

  router.post('/runs/:id/approve', guarded(ctx, 'runs.approve', async (req, res, sub) => {
    if (!hasExplicitWriteConfirmation(req.body)) {
      res.status(428).json(confirmationRequiredPayload('no-pay', 'Approving a payroll run')); return;
    }
    // Every line is recomputed against the year-to-date as of NOW inside the
    // approving transaction, so two drafts prepared in parallel cannot each
    // consume the same wage-base room. Fail closed on an unpayable check.
    const override = (req.body as Record<string, unknown> | undefined)?.acceptNegativeNet === true;
    try {
      const run = await approveRun(ctx.pool, sub, String(req.params.id), sub, override);
      if (!run) {
        res.status(409).json({ error: 'not_draft_or_missing', message: 'Run is missing or already approved.' }); return;
      }
      // Record HOW the money is being sent and WHO approved it. This app moves no
      // money, which is exactly why the record has to exist to reconcile against.
      const payments = await createPayments(ctx.pool, sub, String(run.run_id), isoDate(run.pay_date));
      await recordAudit(ctx.pool, sub, 'run', String(run.run_id), 'approve', sub, null,
        { pay_date: isoDate(run.pay_date), payments });
      res.json({ ok: true, run: normalizeDates(run), payments });
    } catch (err) {
      if (err instanceof NegativeNetError) {
        res.status(409).json({
          error: 'negative_net_pay',
          message: `${err.employees.length} employee(s) have a negative net on this run. Fix the lines, or re-submit with acceptNegativeNet: true to record it anyway.`,
          employees: err.employees,
        });
        return;
      }
      throw err;
    }
  }));

  /** POST /runs/:id/void — the correction mechanism: a linked, negated reversal. */
  router.post('/runs/:id/void', guarded(ctx, 'runs.void', async (req, res, sub) => {
    if (!hasExplicitWriteConfirmation(req.body)) {
      res.status(428).json(confirmationRequiredPayload('no-void', 'Voiding a paid payroll run')); return;
    }
    const b = (req.body || {}) as Record<string, unknown>;
    const run = await ownedRun(ctx, sub, String(req.params.id));
    if (!run) { res.status(404).json({ error: 'not_found' }); return; }
    if (run.status !== RUN_PAID) {
      res.status(409).json({ error: 'run_not_paid', message: 'Only a paid run can be voided; discard a draft instead.' }); return;
    }
    if (run.kind === KIND_VOID) {
      res.status(409).json({ error: 'cannot_void_a_void', message: 'A void run cannot itself be voided.' }); return;
    }
    // The void's pay date drives every report it touches, so it may not wander
    // into another tax year or land before the work it reverses.
    const originalPayDate = isoDate(run.pay_date);
    const voidPayDate = isoDateOrNull(b.payDate) || originalPayDate;
    if (voidPayDate.slice(0, 4) !== originalPayDate.slice(0, 4) || voidPayDate < isoDate(run.period_end)) {
      res.status(400).json({
        error: 'bad_void_pay_date',
        message: `A void must be dated in the same tax year as the run it reverses (${originalPayDate.slice(0, 4)}) and no earlier than that run's period end.`,
      });
      return;
    }
    try {
      const voidRun = await createVoidRun(ctx.pool, sub, run, voidPayDate, sub, String(b.note || ''));
      res.json({ ok: true, run: normalizeDates(voidRun) });
    } catch (err) {
      // The partial unique index makes a second void impossible at the database
      // level; surface that as a clean conflict rather than a 500.
      if (/payroll_runs_one_void|duplicate key/i.test(String((err as Error).message))) {
        res.status(409).json({ error: 'already_voided', message: 'This run has already been voided.' });
        return;
      }
      throw err;
    }
  }));

  router.delete('/runs/:id', guarded(ctx, 'runs.delete', async (req, res, sub) => {
    const run = await ownedRun(ctx, sub, String(req.params.id));
    if (!run) { res.status(404).json({ error: 'not_found' }); return; }
    if (run.status !== RUN_DRAFT) {
      res.status(409).json({ error: 'run_not_draft', message: 'A paid run is immutable history — void it instead.' }); return;
    }
    await ctx.pool.query('DELETE FROM payroll_run_lines WHERE run_id = $1 AND user_sub = $2', [run.run_id, sub]);
    await ctx.pool.query('DELETE FROM payroll_runs WHERE run_id = $1 AND user_sub = $2', [run.run_id, sub]);
    res.json({ ok: true });
  }));
}

/** Register stub + report routes. */
function reportRoutes(router: Router, ctx: AppContext): void {
  router.get('/stub/:runId/:employeeId', guarded(ctx, 'stub', async (req, res, sub) => {
    const run = await ownedRun(ctx, sub, String(req.params.runId));
    if (!run) { res.status(404).json({ error: 'not_found' }); return; }
    const emp = await ownedEmployee(ctx, sub, String(req.params.employeeId));
    if (!emp) { res.status(404).json({ error: 'employee_not_found' }); return; }
    const line = (await ctx.pool.query(
      'SELECT * FROM payroll_run_lines WHERE run_id = $1 AND employee_id = $2 AND user_sub = $3',
      [run.run_id, emp.employee_id, sub])).rows[0];
    if (!line) { res.status(404).json({ error: 'line_not_found' }); return; }
    const year = isoDate(run.pay_date).slice(0, 4);
    const ytd = (await ctx.pool.query(
      `SELECT COALESCE(SUM(l.gross_cents),0) gross, COALESCE(SUM(l.fit_cents),0) fit, COALESCE(SUM(l.ss_cents),0) ss,
              COALESCE(SUM(l.medicare_cents + l.addl_medicare_cents),0) medicare, COALESCE(SUM(l.state_cents),0) state,
              COALESCE(SUM(l.pretax_cents),0) pretax, COALESCE(SUM(l.posttax_cents),0) posttax,
              COALESCE(SUM(l.net_cents),0) net
         FROM payroll_run_lines l JOIN payroll_runs r ON r.run_id = l.run_id AND r.user_sub = l.user_sub
        WHERE l.user_sub = $1 AND l.employee_id = $2 AND (r.status = '${RUN_PAID}' OR r.run_id = $3)
          AND r.pay_date <= $4 AND date_part('year', r.pay_date) = $5`,
      [sub, emp.employee_id, run.run_id, isoDate(run.pay_date), year])).rows[0];
    // The stub is the document the EMPLOYEE reads, so its YTD must include wages
    // this employer paid through a previous payroll system — otherwise a mid-year
    // switch shows them a wildly understated year and they reasonably panic.
    const priorApplies = Number(emp.prior_ytd_year || 0) === Number(year);
    const prior = (col: string) => (priorApplies ? money(emp[col]) : 0);
    const combined = {
      gross: Number(ytd.gross) + prior('prior_ytd_gross_cents'),
      fit: Number(ytd.fit) + prior('prior_ytd_fit_cents'),
      ss: Number(ytd.ss) + prior('prior_ytd_ss_cents'),
      medicare: Number(ytd.medicare) + prior('prior_ytd_medicare_cents'),
      state: Number(ytd.state) + prior('prior_ytd_state_cents'),
      pretax: Number(ytd.pretax),
      posttax: Number(ytd.posttax),
      net: Number(ytd.net),
    };
    res.json({
      company: scrubSecrets(await getCompany(ctx.pool, sub)), run: normalizeDates(run), employee: normalizeDates(emp), line,
      ytd: combined, priorYtdIncluded: priorApplies,
    });
  }));

  router.get('/reports/liability', guarded(ctx, 'reports.liability', async (req, res, sub) => {
    const year = String(req.query.year || TAX_YEAR).replace(/\D/g, '').slice(0, 4) || String(TAX_YEAR);
    const rows = (await ctx.pool.query(
      `SELECT date_part('quarter', r.pay_date)::int AS quarter,
              COALESCE(SUM(l.gross_cents),0) gross, COALESCE(SUM(l.fit_cents),0) fit,
              COALESCE(SUM(l.ss_cents + l.er_ss_cents),0) ss,
              COALESCE(SUM(l.medicare_cents + l.addl_medicare_cents + l.er_medicare_cents),0) medicare,
              COALESCE(SUM(l.state_cents),0) state, COALESCE(SUM(l.futa_cents),0) futa,
              COALESCE(SUM(l.suta_cents),0) suta
         FROM payroll_run_lines l JOIN payroll_runs r ON r.run_id = l.run_id AND r.user_sub = l.user_sub
        WHERE l.user_sub = $1 AND r.status = '${RUN_PAID}' AND date_part('year', r.pay_date) = $2
        GROUP BY 1 ORDER BY 1`, [sub, year])).rows;
    res.json({ year: Number(year), quarters: rows });
  }));

  router.get('/reports/w2/:employeeId', guarded(ctx, 'reports.w2', async (req, res, sub) => {
    const year = String(req.query.year || TAX_YEAR).replace(/\D/g, '').slice(0, 4) || String(TAX_YEAR);
    const emp = await ownedEmployee(ctx, sub, String(req.params.employeeId));
    if (!emp) { res.status(404).json({ error: 'not_found' }); return; }
    const t = (await ctx.pool.query(
      `SELECT COALESCE(SUM(l.fit_taxable_cents + l.supplemental_taxable_cents),0) box1, COALESCE(SUM(l.fit_cents),0) box2,
              COALESCE(SUM(l.ss_taxable_cents),0) box3, COALESCE(SUM(l.ss_cents),0) box4,
              COALESCE(SUM(l.fica_taxable_cents),0) box5,
              COALESCE(SUM(l.medicare_cents + l.addl_medicare_cents),0) box6,
              COALESCE(SUM(l.tips_cents),0) box7, COALESCE(SUM(l.state_cents),0) box17,
              COALESCE(SUM(l.deferral_cents),0) code_d, COALESCE(SUM(l.qualified_ot_cents),0) code_tt,
              COALESCE(SUM(l.tips_cents),0) code_tp
         FROM payroll_run_lines l JOIN payroll_runs r ON r.run_id = l.run_id AND r.user_sub = l.user_sub
        WHERE l.user_sub = $1 AND l.employee_id = $2 AND r.status = '${RUN_PAID}'
          AND date_part('year', r.pay_date) = $3`, [sub, emp.employee_id, year])).rows[0];
    const priorApplies = Number(emp.prior_ytd_year || 0) === Number(year);
    res.json({
      year: Number(year),
      employee: normalizeDates(emp),
      boxes: t,
      box12: { D: Number(t.code_d || 0), TT: Number(t.code_tt || 0), TP: Number(t.code_tp || 0) },
      box14b: String(emp.tipped_occupation_code || ''),
      priorYtdIncluded: priorApplies,
      preview: true,
      caveat: priorApplies
        ? 'Preview over runs paid in this system ONLY. Prior-YTD figures entered for a mid-year switch are NOT added here — combine with the prior provider\'s W-2 data before filing.'
        : 'Preview over runs paid in this system. Not a filing.',
    });
  }));
}

/**
 * @description Builds the payroll router (mounted at /api/payroll behind OIDC by
 * the app loader). The surface HTML serves from this package's tools/ dir.
 * @param ctx - App context (Postgres pool + appPackageDir).
 * @returns Express router.
 */
export function createPayrollRoutes(ctx: AppContext): Router {
  if (ctx.appPackageDir) packageDir = ctx.appPackageDir;
  const surfaceDir = packageDir ? path.join(packageDir, 'tools') : path.resolve(process.cwd(), 'tools');
  const router = Router();

  router.get('/', servePage(surfaceDir, 'payroll.html'));
  router.get('/ui', servePage(surfaceDir, 'payroll.html'));

  companyRoutes(router, ctx);
  employeeRoutes(router, ctx);
  runRoutes(router, ctx);
  reportRoutes(router, ctx);
  // The v2 surface (identity, elections, earning rows, gross-up, payments,
  // audit, GL/deposit reports) mounts on the same router behind the same gate.
  registerV2Routes(router, ctx, (op, fn) => guarded(ctx, op, fn));
  registerSettlementRoutes(router, ctx, (op, fn) => guarded(ctx, op, fn));

  return router;
}
