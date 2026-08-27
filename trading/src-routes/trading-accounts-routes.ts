/**
 * Trading accounts + books surface (ADR-134 PR3) — the operator's multi-account cockpit API.
 *
 * Everything here is a thin, auth-inheriting layer over the CORE stores (trading-accounts-store /
 * trading-books-store / trading-config-overrides): discovery, the accounts⟷books join, book CRUD,
 * per-book strategy assignment, the manual mix editor, the confirm-gated breaker reset, and the
 * consolidated Schwab-style summary. Lifecycle invariants (live books born disabled, immutable
 * account binding, delete refusal, cross-user ownership) are enforced IN CORE — these routes only
 * call the core functions, never raw lifecycle SQL (adversarial-review rule).
 *
 * Registered from createTradingRoutes, so the module inherits the /api/trading mount's
 * service-or-oidc posture, and every handler resolves the caller via callerSub() — which carries
 * the SEC-01 service-secret READ refusal. The account roster and consolidated balances are the
 * most aggregation-valuable reads this surface has ever exposed; they get the same wall.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — GET /accounts (discovered accounts joined with books + connectionMissing), POST /accounts/discover, POST /accounts/books (+PATCH/DELETE), POST /accounts/books/:bookId/strategy (+DELETE revert), POST /accounts/books/:bookId/mix (overlay-merge on the ACTIVE override — never env defaults, so a mix edit cannot silently revert an applied strategy's other knobs), POST /accounts/books/:bookId/reset-breaker (confirm-gated, journaled), and GET /summary (every discovered account — unbooked rows flagged notTrading — with day-change fallback prior-close → broker day P/L → null, never 0).
 */

import type { Router, Request, Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { getBrokerReader } from '@/features/trading';
import type { TradingBook } from '@/features/trading';
import { callerSub, resolveBook, TradingError } from '@/app/routes/trading-routes-helpers';
import { listAccounts, discoverBrokerAccounts } from '@/app/trading-accounts-store';
import {
  listBooks, createBook, updateBook, deleteBook, loadBook, resetBreaker, ensureLegacyBooks, multiAccountEnabled,
} from '@/app/trading-books-store';
import { getActiveOverride, applyOverride, revertOverride } from '@/app/trading-config-overrides';
import { loadPriorCloseEquity } from '@/app/trading-daily-equity-store';
import { recordStrategyJournal } from '@/app/trading-strategy-journal';
import type { StrategyConfig } from '@/app/trading-strategy-lab-sim';

const logger = createChildLogger({ module: 'trading-accounts-routes' });

/** Resolve + 401 helper shared by every handler. */
function sub(req: Request, res: Response): string | null {
  const s = callerSub(req);
  if (!s) res.status(401).json({ error: 'not_authenticated' });
  return s;
}

function fail(res: Response, err: unknown): void {
  if (err instanceof TradingError) { res.status(err.httpStatus).json({ error: err.code, message: err.message }); return; }
  const msg = (err as Error).message || 'internal_error';
  const known = /account_not_owned|book_delete_refused|book_binding_undecryptable/.exec(msg);
  if (known) { res.status(409).json({ error: known[0], message: msg }); return; }
  logger.error({ err }, 'trading accounts route failed');
  res.status(500).json({ error: 'internal_error', message: msg });
}

/**
 * @description Register the ADR-134 accounts/books/summary routes onto the /api/trading router.
 * @param router - The trading router (mounted service-or-oidc).
 * @param ctx - Package app context.
 */
export function registerTradingAccountRoutes(router: Router, ctx: AppContext): void {
  /** GET /accounts — the roster: discovered accounts LEFT-joined with their books, plus link
   *  state. connectionMissing flags a book whose login's connection row is gone (a dropped Schwab
   *  login otherwise fail-closed-skips every fire invisibly — the watchdog counts these). */
  router.get('/accounts', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    try {
      await ensureLegacyBooks(ctx.pool, s);
      const [accounts, books] = await Promise.all([listAccounts(ctx.pool, s), listBooks(ctx.pool, s)]);
      const conns = (await ctx.pool.query(
        `SELECT DISTINCT account_key FROM oshal_connections WHERE user_sub=$1 AND provider='schwab'`, [s])).rows;
      const liveKeys = new Set(conns.map((r) => String(r.account_key || 'default')));
      const bookByAccount = new Map<string, (typeof books)[number]>();
      const accountIds = (await ctx.pool.query(
        'SELECT book_id, account_id FROM oshal_trading_books WHERE user_sub=$1 AND account_id IS NOT NULL', [s])).rows;
      for (const r of accountIds) {
        const b = books.find((x) => x.bookId === String(r.book_id));
        if (b) bookByAccount.set(String(r.account_id), b);
      }
      res.json({
        multiAccountEnabled: multiAccountEnabled(),
        accounts: accounts.map((a) => {
          const book = bookByAccount.get(a.accountId) ?? null;
          return {
            ...a,
            book: book ? { bookId: book.bookId, ref: book.ref, label: (book as TradingBook & { label?: string }).ref, enabled: book.enabled } : null,
            connectionMissing: !liveKeys.has(a.connectionKey),
          };
        }),
        books: books.map((b) => ({
          bookId: b.bookId, ref: b.ref, kind: b.kind, enabled: b.enabled, learn: b.learn,
          capitalCapUsd: b.capitalCapUsd, connectionMissing: b.connectionKey ? !liveKeys.has(b.connectionKey) : false,
        })),
      });
    } catch (err) { fail(res, err); }
  });

  /** POST /accounts/discover — enumerate every Schwab login's accounts and upsert the roster. */
  router.post('/accounts/discover', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    try { res.json(await discoverBrokerAccounts(ctx.pool, s)); }
    catch (err) { fail(res, err); }
  });

  /** POST /accounts/books {accountId, label, confirm:true} — create a live book (born DISABLED). */
  router.post('/accounts/books', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    const b = (req.body || {}) as { accountId?: string; label?: string; confirm?: boolean };
    if (b.confirm !== true) { res.status(428).json({ error: 'confirm_required', message: 'Creating a live trading book requires confirm:true.' }); return; }
    if (!b.accountId || !b.label) { res.status(400).json({ error: 'account_and_label_required' }); return; }
    try { res.json({ book: await createBook(ctx.pool, s, String(b.accountId), String(b.label)) }); }
    catch (err) { fail(res, err); }
  });

  /** PATCH /accounts/books/:bookId — label / enabled / capitalCapUsd. NEVER account_id (immutable
   *  once traded — re-pointing carries the old HWM onto a new account, the phantom-drawdown class). */
  router.patch('/accounts/books/:bookId', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    const b = (req.body || {}) as { label?: string; enabled?: boolean; capitalCapUsd?: number | null };
    try {
      const book = await updateBook(ctx.pool, s, String(req.params.bookId), {
        label: b.label != null ? String(b.label) : undefined,
        enabled: typeof b.enabled === 'boolean' ? b.enabled : undefined,
        capitalCapUsd: b.capitalCapUsd === undefined ? undefined : (b.capitalCapUsd == null ? null : Number(b.capitalCapUsd)),
      });
      if (!book) { res.status(404).json({ error: 'unknown_book' }); return; }
      res.json({ book });
    } catch (err) { fail(res, err); }
  });

  /** DELETE /accounts/books/:bookId — core refusal while history exists (disable instead). */
  router.delete('/accounts/books/:bookId', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    try { res.json({ deleted: await deleteBook(ctx.pool, s, String(req.params.bookId)) }); }
    catch (err) { fail(res, err); }
  });

  /** POST /accounts/books/:bookId/strategy {strategyId?, strategyName, config, applyPct, note, confirm:true}
   *  — apply a Strategy Library snapshot to THIS book (the ADR-095 rail, book-scoped). */
  router.post('/accounts/books/:bookId/strategy', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    const b = (req.body || {}) as { strategyId?: string | null; strategyName?: string; config?: unknown; applyPct?: number; note?: string; confirm?: boolean };
    if (b.confirm !== true) { res.status(428).json({ error: 'confirm_required' }); return; }
    if (!b.strategyName || !b.config) { res.status(400).json({ error: 'strategy_required' }); return; }
    try {
      const book = await loadBook(ctx.pool, s, String(req.params.bookId));
      if (!book) { res.status(404).json({ error: 'unknown_book' }); return; }
      const row = await applyOverride(ctx.pool, s, {
        strategyId: b.strategyId ? String(b.strategyId) : null, strategyName: String(b.strategyName),
        config: b.config as StrategyConfig, applyPct: Number(b.applyPct) || 100,
        note: String(b.note || ''), bookId: book.bookId, bookRef: book.ref,
      });
      res.json({ override: row });
    } catch (err) { fail(res, err); }
  });

  /** DELETE /accounts/books/:bookId/strategy — revert THIS book to env defaults. */
  router.delete('/accounts/books/:bookId/strategy', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    try {
      const book = await loadBook(ctx.pool, s, String(req.params.bookId));
      if (!book) { res.status(404).json({ error: 'unknown_book' }); return; }
      res.json({ reverted: await revertOverride(ctx.pool, s, book.bookId, book.ref) });
    } catch (err) { fail(res, err); }
  });

  /** POST /accounts/books/:bookId/mix — the manual asset-mix editor. OVERLAY-MERGE semantics: the
   *  posted fields overlay the book's CURRENT ACTIVE override (else env-default shape) — building
   *  from env would silently revert an applied strategy's non-mix knobs while the strategy strip
   *  still names it (adversarial-review rule). One rail: the merged snapshot goes through the same
   *  applyOverride as a strategy, named 'manual-mix' with the prior strategy in the note. */
  router.post('/accounts/books/:bookId/mix', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    const posted = (req.body || {}) as Partial<StrategyConfig> & { applyPct?: number; confirm?: boolean };
    if (posted.confirm !== true) { res.status(428).json({ error: 'confirm_required' }); return; }
    try {
      const book = await loadBook(ctx.pool, s, String(req.params.bookId));
      if (!book) { res.status(404).json({ error: 'unknown_book' }); return; }
      const current = await getActiveOverride(ctx.pool, s, book.bookId);
      const base: StrategyConfig = current?.config ?? ({
        kind: 'rotation', posture: 'balanced', corePct: 0, coreSymbol: 'SPY', takeProfitPct: null,
        rank: 'momentum', cadenceDays: 5, topN: 8, weighting: 'conviction', universe: [],
        warmupDays: 60, windowDays: 365, earningsGateDays: 0,
      } as unknown as StrategyConfig);
      const MIX_KEYS: Array<keyof StrategyConfig> = ['coreSymbol', 'corePct', 'universe', 'rank', 'cadenceDays', 'topN', 'weighting', 'posture'];
      const merged: StrategyConfig = { ...base };
      for (const k of MIX_KEYS) if (posted[k] !== undefined) (merged as unknown as Record<string, unknown>)[k as string] = posted[k];
      const row = await applyOverride(ctx.pool, s, {
        strategyId: null, strategyName: 'manual-mix', config: merged,
        applyPct: Number(posted.applyPct) || current?.applyPct || 100,
        note: current ? `mix edit over "${current.strategyName}"` : 'mix edit over env defaults',
        bookId: book.bookId, bookRef: book.ref,
      });
      res.json({ override: row });
    } catch (err) { fail(res, err); }
  });

  /** POST /accounts/books/:bookId/reset-breaker {confirm:true} — the explicit re-baseline for a
   *  deliberate withdrawal/transfer (the phantom-drawdown case). Confirm-gated + journaled. */
  router.post('/accounts/books/:bookId/reset-breaker', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    if ((req.body || {}).confirm !== true) { res.status(428).json({ error: 'confirm_required', message: 'Resetting the drawdown breaker requires confirm:true — only do this after a deliberate cash movement, never on real losses.' }); return; }
    try {
      const book = await loadBook(ctx.pool, s, String(req.params.bookId));
      if (!book) { res.status(404).json({ error: 'unknown_book' }); return; }
      const r = await resetBreaker(ctx.pool, s, book.bookId);
      if (!r) { res.status(404).json({ error: 'no_hwm_row', message: 'This book has no equity history yet.' }); return; }
      void recordStrategyJournal(ctx.pool, {
        sub: s, kind: 'knob-turn', source: 'trading-accounts-routes.reset-breaker', bookRef: book.ref,
        summary: `Drawdown breaker re-baselined on [${book.ref}]: HWM ${r.prior.toFixed(2)} → ${r.next.toFixed(2)} (operator confirm)`,
        detail: { bookId: book.bookId, ...r },
      });
      res.json(r);
    } catch (err) { fail(res, err); }
  });

  /** GET /summary — the consolidated Schwab-style rollup: EVERY discovered account (unbooked rows
   *  read-only + flagged notTrading), per-row day change with the fallback chain prior-close →
   *  broker day P/L → null (never 0 — a book created today must read "n/a", not "flat"), and a
   *  positions rollup. One failed row degrades to an error entry — never a failed report. */
  router.get('/summary', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    try {
      await ensureLegacyBooks(ctx.pool, s);
      const books = await listBooks(ctx.pool, s);
      const rows: Array<Record<string, unknown>> = [];
      const rollup = new Map<string, { symbol: string; qty: number; marketValue: number; perBook: Array<{ ref: string; qty: number; marketValue: number }> }>();
      let totalValue = 0; let totalDayChange = 0; let sawDayChange = false;
      for (const book of books) {
        try {
          const reader = getBrokerReader(book.kind, s, book.accountNumber ? { accountNumber: book.accountNumber, connectionKey: book.connectionKey } : undefined);
          if (!reader.configured()) { rows.push({ bookId: book.bookId, ref: book.ref, kind: book.kind, error: 'broker_not_configured' }); continue; }
          const [account, positions] = await Promise.all([reader.getAccount(), reader.getPositions()]);
          const prior = await loadPriorCloseEquity(ctx.pool, s, book).catch(() => null);
          const dayChange = prior != null && account.equity > 0 ? account.equity - prior : null;
          totalValue += account.equity;
          if (dayChange != null) { totalDayChange += dayChange; sawDayChange = true; }
          rows.push({
            bookId: book.bookId, ref: book.ref, kind: book.kind, enabled: book.enabled,
            equity: account.equity, cash: account.cash, buyingPower: account.buyingPower,
            dayChange, dayChangePct: dayChange != null && prior ? (dayChange / prior) * 100 : null,
          });
          for (const p of positions) {
            const key = p.symbol.toUpperCase();
            const cur = rollup.get(key) ?? { symbol: key, qty: 0, marketValue: 0, perBook: [] };
            cur.qty += p.qty; cur.marketValue += p.marketValue;
            cur.perBook.push({ ref: book.ref, qty: p.qty, marketValue: p.marketValue });
            rollup.set(key, cur);
          }
        } catch (err) {
          rows.push({ bookId: book.bookId, ref: book.ref, kind: book.kind, error: (err as Error).message.slice(0, 200) });
        }
      }
      res.json({
        totalValue, totalDayChange: sawDayChange ? totalDayChange : null,
        accounts: rows,
        positionsRollup: [...rollup.values()].sort((a, b) => b.marketValue - a.marketValue),
      });
    } catch (err) { fail(res, err); }
  });
}

/**
 * @description Resolve a route's book param the shared way (re-exported for the builder modules'
 * resolveMode→resolveBook conversion).
 * @param ctx - App context.
 * @param s - Caller sub.
 * @param req - The request (reads query.book then query.mode).
 * @returns The TradingBook.
 */
export async function routeBook(ctx: AppContext, s: string, req: Request): Promise<TradingBook> {
  return resolveBook(ctx.pool, s, (req.query.book as string | undefined) ?? (req.query.mode as string | undefined));
}
