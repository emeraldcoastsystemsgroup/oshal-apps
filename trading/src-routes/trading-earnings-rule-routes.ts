/**
 * Earnings-reaction rules (ADR-136 D5) — the OPERATOR SURFACE over the kernel rule store.
 *
 * The kernel (@/app/trading-earnings-rules) already owns everything that decides: the rule table and
 * its one-active-rule-per-(book,symbol) index, the held-names-only EDGAR watch for an item-2.02 8-K,
 * the analyst read of the company's OWN filed numbers, the mapped action through the single order
 * path, and the truncation/ambiguity invariants. What it had no way to reach was a person: a rule
 * could only be created or read by calling the module, so nothing on the account page could arm one,
 * see one, or stop one. These three routes are that half, and nothing else — no new decision, no
 * second place to size an order, no second copy of a rule's state.
 *
 *   GET  /events/rules            → this book's rules (newest first) + the watcher's posture
 *   POST /events/rules            → arm one (confirm-gated, 201)
 *   POST /events/rules/:id/cancel → disarm an active one; terminal rows stay as history
 *
 * WHAT THE SURFACE MUST SAY, because a rule that cannot act looks exactly like one that can:
 *  • {@link CLASSIFICATION_BASIS} rides every response. "Beat" and "miss" here are the company's own
 *    filed numbers against its own prior year and its own prior guidance — oshal ingests no
 *    consensus feed, and a surface that let the operator assume otherwise would be lying.
 *  • `enabled` is BOTH gates: the leg's TRADING_EVENT_PLANS and the watcher's TRADING_EARNINGS_RULES
 *    (default false). A rule armed while either is off is stored and inert, and the response says so
 *    in words rather than leaving an "armed" pill to imply a watcher that is not running.
 *  • `warning` names the view-only consequence exactly, because it is HALF true: the engine refuses a
 *    non-operator-authored BUY on a view-only book (trading-engine 409 book_disabled) and the rule's
 *    author id is `event-rule`, so a beat→buy dies there — while the protective miss→sell still runs.
 *    "This account is view-only" alone would be read as "nothing happens", which is the wrong half.
 *
 * ARMING ENSURES THE LEG FIRST. A rule rides the per-user `trading-events` schedule, so one armed
 * without it would never be looked at again. The schedule is ensured BEFORE the insert (shared with
 * the timed-order path, staleness check included) so a 503 leaves nothing stored — the same ordering
 * the event playbooks' arm uses, for the same reason.
 *
 * Every handler resolves the caller via callerSub (401) and the book QUERY-FIRST (`?book=` rides
 * every surface fetch; body.book wins only when the query is silent — the 2026-09-03 paper-routing
 * class, where a body/query split sent every order to PAPER regardless of the selected account).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the three earnings-rule routes (list/arm/cancel) over the kernel rule store: arm is 428 confirm-gated and ensures the per-user trading-events leg BEFORE the insert (503 changes nothing), the book is resolved query-first on every handler, both executor gates are reported as one `enabled` with the reason named, the view-only warning states that a BUY is refused and a SELL still runs, and the classification basis rides every response so no surface can imply a consensus feed oshal does not have.
 *
 * @module trading-earnings-rule-routes
 */

import { Router, type Request, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { callerSub, resolveBook, TradingError } from '@/app/routes/trading-routes-helpers';
import { eventPlansEnabled } from '@/app/trading-event-plans';
import {
  CLASSIFICATION_BASIS, cancelEventRule, createEventRule, earningsRulesEnabled, listEventRules,
  normalizeEventRule, ruleMaxDays, ruleWindowAfterDays, ruleWindowBeforeDays, type EventRuleRow,
} from '@/app/trading-earnings-rules';
import { ensureEventSchedule } from './trading-manual-order-routes';

const logger = createChildLogger({ module: 'trading-earnings-rule-routes' });

/** Why arming needs the leg — said in the 503 so the operator knows nothing was stored. */
const SCHEDULER_UNAVAILABLE =
  'The agent scheduler is not running (ENABLE_AGENT_SCHEDULER) — an earnings rule rides the trading-events leg, and without it the rule would never be looked at.';
/** The note an armed rule carries while the watcher flag is off. */
const WATCHER_OFF_NOTE =
  'TRADING_EARNINGS_RULES is off on this server — the rule is stored and armed, but nothing will read EDGAR for it until it is enabled.';
/** The note an armed rule carries while the LEG itself is off (the watcher never gets a tick). */
const LEG_OFF_NOTE =
  'TRADING_EVENT_PLANS is off on this server — the trading-events leg does not act, so the earnings watcher never runs.';
/**
 * The view-only consequence, stated as the engine actually behaves. A rule's decisions are authored
 * by `event-rule`, which is not in the engine's operator-authored set, so a BUY is refused 409
 * book_disabled on a view-only book — while a SELL is not gated that way at all.
 */
const VIEW_ONLY_WARNING =
  'This account is view-only for the autopilot — a rule that decides to BUY will be refused, and the rule ends there. A rule that decides to SELL still runs.';

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
 * @description Resolve the SELECTED book QUERY-FIRST: `?book=` (the surface's selected account rides
 * every fetch), then body.book, then the legacy `mode` aliases in the same order.
 * @param ctx - App context (pool).
 * @param s - Caller sub.
 * @param req - The request.
 * @returns The resolved TradingBook (400 unknown_book on a garbage ref, never a silent paper remap).
 */
function resolveRequestBook(ctx: AppContext, s: string, req: Request) {
  const b = (req.body || {}) as { book?: string; mode?: string };
  return resolveBook(ctx.pool, s, (req.query.book as string | undefined) ?? b.book ?? (req.query.mode as string | undefined) ?? b.mode);
}

/**
 * @description Route failure → a TradingError's own status/code, else a logged 502.
 * @param res - The response.
 * @param err - The thrown value.
 * @param what - The handler, for the log line.
 */
function fail(res: Response, err: unknown, what: string): void {
  if (err instanceof TradingError) {
    res.status(err.httpStatus).json({ error: err.code, message: err.message });
    return;
  }
  logger.error({ err, what }, 'earnings rule route failed');
  res.status(502).json({ error: (err as Error).message || 'earnings_rule_failed' });
}

/** Both executor gates as ONE posture, with the reason named. Neither flag alone is the answer. */
interface WatcherPosture { enabled: boolean; note: string | null }

/**
 * @description The watcher's posture for this server: armed rules act only when the trading-events
 * leg is on AND the earnings watcher is on. Reported on every response so a surface never paints an
 * "armed" rule as a running one.
 * @returns Whether the watcher will act, and the sentence saying why not when it will not.
 */
export function watcherPosture(): WatcherPosture {
  if (!eventPlansEnabled()) return { enabled: false, note: LEG_OFF_NOTE };
  if (!earningsRulesEnabled()) return { enabled: false, note: WATCHER_OFF_NOTE };
  return { enabled: true, note: null };
}

/** The knobs the surface needs to describe a rule truthfully, read per request (no restart to change). */
const ruleLimits = () => ({ maxDays: ruleMaxDays(), windowBeforeDays: ruleWindowBeforeDays(), windowAfterDays: ruleWindowAfterDays() });

/**
 * @description Register the earnings-rule routes on the trading router (ADR-136 D5). Mounted by
 * createTradingRoutes under /api/trading, so the paths are /api/trading/events/rules*.
 * @param router - The trading router.
 * @param ctx - App context (pool).
 * @returns Nothing — the handlers are attached to the router.
 */
export function registerTradingEarningsRuleRoutes(router: Router, ctx: AppContext): void {
  /** GET /events/rules — this book's rules, newest first, with the watcher posture and the basis. */
  router.get('/events/rules', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    try {
      const book = await resolveRequestBook(ctx, s, req);
      const rules = await listEventRules(ctx.pool, s, { bookId: book.bookId });
      res.json({ rules, book: book.ref, ...watcherPosture(), limits: ruleLimits(), basis: CLASSIFICATION_BASIS });
    } catch (err) { fail(res, err, 'list'); }
  });

  /** POST /events/rules — arm one. Confirm-gated: a fired rule places a REAL order on this book. */
  router.post('/events/rules', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    const b = (req.body || {}) as { confirm?: boolean; rule?: unknown };
    if (b.confirm !== true) {
      res.status(428).json({ error: 'confirm_required', message: 'An armed rule places a REAL order on this account when the name reports — resend with confirm:true.' });
      return;
    }
    try {
      const book = await resolveRequestBook(ctx, s, req);
      const rule = normalizeEventRule(b.rule ?? req.body);
      // The leg FIRST: a rule armed without it would never be read again, and a 503 must leave
      // nothing stored. Same ordering, and the same staleness check, as a timed order's.
      await ensureEventSchedule(s, SCHEDULER_UNAVAILABLE);
      const stored: EventRuleRow = await createEventRule(ctx.pool, s, { book, rule });
      const posture = watcherPosture();
      logger.info({ sub: s, ruleId: stored.ruleId, symbol: stored.symbol, book: book.ref, enabled: posture.enabled }, 'earnings rule ARMED from the account page');
      res.status(201).json({ rule: stored, scheduled: true, ...posture, basis: CLASSIFICATION_BASIS, warning: book.enabled ? null : VIEW_ONLY_WARNING });
    } catch (err) { fail(res, err, 'arm'); }
  });

  /** POST /events/rules/:id/cancel — disarm an active rule (409 once it is already terminal). */
  router.post('/events/rules/:id/cancel', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    try {
      const rule = await cancelEventRule(ctx.pool, s, String(req.params.id));
      logger.info({ sub: s, ruleId: rule.ruleId, symbol: rule.symbol }, 'earnings rule disarmed by the operator');
      res.json({ rule });
    } catch (err) { fail(res, err, 'cancel'); }
  });
}
