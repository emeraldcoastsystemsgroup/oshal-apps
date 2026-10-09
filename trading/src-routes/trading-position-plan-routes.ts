/**
 * Per-position exit plans (ADR-052 addendum P4) — the OPERATOR SURFACE over the kernel plan ledger.
 *
 * The kernel (@/app/trading-position-plans) owns everything that decides: the plan table with its
 * frozen terms, the stamping of every autonomous buy, the exit leg that judges a planned position on
 * its OWN stored terms, and amendPlans(), the one way a stored plan's terms change. What it had no
 * way to reach was a person: a plan could only be read or amended by calling the module. These two
 * routes are that half, and nothing else — no second copy of a plan, no second exit rule.
 *
 *   GET  /position-plans        → the selected book's plans (open by default) and whether plans are
 *                                  armed for it, through the dispatch's own resolver
 *   POST /position-plans/amend  → the deliberate "amend plans" action: new dials from a posture
 *                                  and/or a new life in sessions, recorded against the caller and
 *                                  the note. Confirm-gated (428), because it re-prices the exits of
 *                                  positions already in flight, which is exactly what a posture
 *                                  change is NOT allowed to do on its own.
 *
 * Every handler resolves the caller via callerSub (401) and the book QUERY-FIRST (`?book=` rides
 * every surface fetch; body.book wins only when the query is silent — the 2026-09-03 paper-routing
 * class). A garbage book ref is 400 unknown_book, never a silent remap to the paper book.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — GET /position-plans (the book's plans through the kernel's listPositionPlans, status filter open | closed | superseded | amended | all, and the plan arm resolved by exitPlanSessions over the book's applied strategy, so the surface can say "plans are off for this account" instead of painting an empty list as a clean one) and POST /position-plans/amend (428 without confirm:true before any read; posture must be a kernel posture, sessions a whole 1-252, symbols well-formed tickers, and something must change; amendPlans records the caller and the note on every successor row; a knob-turn journal line names the book and the count).
 *
 * @module trading-position-plan-routes
 */

import type { Router, Request, Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { RISK_POLICIES, exitPlanSessions, type RiskPosture, type TradingBook } from '@/features/trading';
import { callerSub, resolveBook, TradingError } from '@/app/routes/trading-routes-helpers';
import { listPositionPlans, amendPlans, type PlanAmendment } from '@/app/trading-position-plans';
import { getActiveOverride } from '@/app/trading-config-overrides';
import { recordStrategyJournal } from '@/app/trading-strategy-journal';

const logger = createChildLogger({ module: 'trading-position-plan-routes' });

/** Plan statuses the list accepts; 'all' drops the filter. */
const PLAN_STATUSES = ['open', 'closed', 'superseded', 'amended', 'all'];

/** The longest plan life the kernel's resolver allows (position-plan.ts MAX_EXIT_PLAN_SESSIONS). */
const MAX_PLAN_SESSIONS = 252;

/** Why the amend needs the flag — said in the 428 so the operator knows nothing changed. */
const AMEND_CONFIRM =
  'Amending plans re-prices the exits of positions already in flight — resend with confirm:true.';

/**
 * @description Resolve the caller's sub or answer 401 — shared by every handler.
 * @param req - The request.
 * @param res - The response (401 written when unauthenticated).
 * @returns The sub, or null after the 401 was sent.
 */
function sub(req: Request, res: Response): string | null {
  const s = callerSub(req);
  if (!s) res.status(401).json({ error: 'not_authenticated' });
  return s;
}

/**
 * @description Resolve the SELECTED book QUERY-FIRST: `?book=`, then body.book, then the legacy
 * `mode` aliases in the same order.
 * @param ctx - App context (pool).
 * @param s - Caller sub.
 * @param req - The request.
 * @returns The resolved book (400 unknown_book on a garbage ref).
 */
function resolveRequestBook(ctx: AppContext, s: string, req: Request): Promise<TradingBook> {
  const b = (req.body || {}) as { book?: string; mode?: string };
  return resolveBook(ctx.pool, s, (req.query.book as string | undefined) ?? b.book ?? (req.query.mode as string | undefined) ?? b.mode);
}

/**
 * @description Route failure → a TradingError's own status/code, else a logged 500.
 * @param res - The response.
 * @param err - The thrown value.
 * @param what - The handler, for the log line.
 */
function fail(res: Response, err: unknown, what: string): void {
  if (err instanceof TradingError) { res.status(err.httpStatus).json({ error: err.code, message: err.message }); return; }
  logger.error({ err, what }, 'position plan route failed');
  res.status(500).json({ error: 'internal_error', message: (err as Error).message || 'position_plan_failed' });
}

/** A validation refusal as a TradingError, so fail() answers it like every other one. */
const invalid = (code: string, message: string): TradingError => new TradingError(400, code, message);

/**
 * @description Validate an amend body into the kernel's PlanAmendment. Something must change: a
 * posture (its stop / take-profit / trailing dials) and/or a new life in whole sessions, optionally
 * limited to named symbols.
 * @param body - The request body.
 * @returns The amendment and the note.
 * @throws TradingError 400 on an unknown posture, bad sessions, bad symbols or an empty change.
 */
export function parseAmendment(body: Record<string, unknown>): { change: PlanAmendment; note: string } {
  const change: PlanAmendment = {};
  if (body.posture !== undefined && body.posture !== null && body.posture !== '') {
    const posture = String(body.posture);
    if (!(posture in RISK_POLICIES)) throw invalid('posture_invalid', `posture must be one of ${Object.keys(RISK_POLICIES).join(', ')}.`);
    change.policy = RISK_POLICIES[posture as RiskPosture];
  }
  if (body.sessions !== undefined && body.sessions !== null && body.sessions !== '') {
    const n = Number(body.sessions);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PLAN_SESSIONS) throw invalid('sessions_invalid', `sessions must be a whole number from 1 to ${MAX_PLAN_SESSIONS}.`);
    change.sessions = n;
  }
  if (body.symbols !== undefined && body.symbols !== null) {
    const raw = Array.isArray(body.symbols) ? body.symbols : [];
    const symbols = raw.map((s) => String(s).trim().toUpperCase());
    if (!raw.length || raw.length > 100 || symbols.some((s) => !/^[A-Z.]{1,6}$/.test(s))) throw invalid('symbols_invalid', 'symbols must be a list of 1 to 100 tickers.');
    change.symbols = [...new Set(symbols)];
  }
  if (!change.policy && change.sessions === undefined) throw invalid('nothing_to_amend', 'Name a posture, a new plan life in sessions, or both.');
  const note = String(body.note ?? '').trim().slice(0, 500) || 'amended from the trading surface';
  return { change, note };
}

/**
 * @description Register the per-position plan routes on the trading router (ADR-052 addendum P4).
 * Mounted by createTradingRoutes under /api/trading, so the paths are /api/trading/position-plans*.
 * @param router - The trading router (mounted service-or-oidc).
 * @param ctx - App context (pool).
 * @returns Nothing — the handlers are attached to the router.
 */
export function registerTradingPositionPlanRoutes(router: Router, ctx: AppContext): void {
  /** GET /position-plans — this book's plans and whether plans are armed for it. */
  router.get('/position-plans', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    try {
      const status = String(req.query.status ?? 'open');
      if (!PLAN_STATUSES.includes(status)) throw invalid('status_invalid', `status must be one of ${PLAN_STATUSES.join(', ')}.`);
      const book = await resolveRequestBook(ctx, s, req);
      const [plans, override] = await Promise.all([
        listPositionPlans(ctx.pool, s, book.bookId, { status: status === 'all' ? undefined : status, limit: Number(req.query.limit) || undefined }),
        getActiveOverride(ctx.pool, s, book.bookId),
      ]);
      const knob = override?.config.exitPlanSessions;
      const sessions = exitPlanSessions(knob, book.kind);
      res.json({ book: book.ref, plans, armed: { sessions, source: knob !== null && knob !== undefined ? 'strategy' : sessions > 0 ? 'env' : 'off' } });
    } catch (err) { fail(res, err, 'list'); }
  });

  /** POST /position-plans/amend {confirm:true, posture?, sessions?, symbols?, note?} — the deliberate re-price. */
  router.post('/position-plans/amend', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    const body = (req.body || {}) as Record<string, unknown>;
    if (body.confirm !== true) { res.status(428).json({ error: 'confirm_required', message: AMEND_CONFIRM }); return; }
    try {
      const { change, note } = parseAmendment(body);
      const book = await resolveRequestBook(ctx, s, req);
      const amended = await amendPlans(ctx.pool, s, book, change, s, note);
      void recordStrategyJournal(ctx.pool, {
        sub: s, kind: 'knob-turn', source: 'trading-position-plan-routes.amend', bookRef: book.ref,
        summary: `Position plans amended on [${book.ref}]: ${amended.length} plan(s)${change.policy ? `, dials of the ${change.policy.posture} posture` : ''}${change.sessions ? `, life ${change.sessions} sessions` : ''} (operator confirm)`,
        detail: { bookId: book.bookId, symbols: change.symbols ?? null, posture: change.policy?.posture ?? null, sessions: change.sessions ?? null, note },
      });
      res.json({ book: book.ref, amended });
    } catch (err) { fail(res, err, 'amend'); }
  });
}
