/**
 * Trading routes — the stock-trading app (ADR-052).
 *
 * Split, same as finance / kid-lens / the comms swarm:
 *  - **Execution + reads** (deterministic, no LLM) run here in the controller: record a
 *    signal snapshot, place/inspect an order via the provider-agnostic BrokerAdapter
 *    (@/features/trading), and read the account/positions/ledger.
 *  - **Reasoning** (the decision: does this signal warrant a trade, and what trade?) ALWAYS
 *    runs on the accountable trading-analyst bot via BotNodeClient.execute, so per-call cost
 *    lands in chat_tasks under the bot's own agent_id (ADR-036). The bot is reason-only (no
 *    broker, no CLI), so it runs INLINE on the api container — same path as finance-analyst.
 *
 * The invariant (ADR-052): every order is justified. The data layer enforces it —
 * oshal_trading_orders.decision_id is NOT NULL + FK, and a decision records the signal(s) it
 * reasoned over. So the chain signal -> decision -> order is unbreakable: from any fill you
 * can walk back to the exact tweet/headline and the indicators that moved the bot.
 *
 * Dual ledger: `mode` (paper|live) partitions every store and selects a physically separate
 * broker account. v1 ships PAPER-ONLY by default; a live order requires both
 * TRADING_LIVE_ENABLED=true (broker-provider gate) AND an explicit confirm flag.
 *
 * Every route is requiresAuth-gated at mount (auth is opt-in per route, CLAUDE.md).
 *
 * This file is the MOUNT ENTRY of the trading-routes module family (1000-line cap split):
 * shared helpers live in trading-routes-helpers.ts and the route groups in
 * trading-routes-{book-read,order-flow,algo}-builders.ts. The ENGINE — schema bootstrap,
 * analyst/order core, placeDecisionOrder, resolveMaturedPredictions — lives in
 * src/app/trading-{schema,engine}.ts, which this surface (and the background loops) consume.
 * placeDecisionOrder's env-level live gate (live_blocked) is source-guarded at the engine;
 * POST /trigger stays HERE and keeps the surface's route-level approval gate (live tickets
 * park in backlog), source-guarded in this file by tests/unit/risky-write-guards.spec.ts.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-18 00:00:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial — GET /status (per-mode broker config + counts), GET /account + /positions + /ledger (cheap broker reads), POST /signals + GET /signals (data-stream snapshots), POST /decide (trading-analyst reasons over signals -> persisted decision tree), POST /orders (guarded execution: decision required, guardrails enforced, live needs confirm) + GET /orders + GET /orders/:id (status refresh), GET /trace/:id (order -> decision -> signals provenance). Paper-only by default.
 * 2026-06-23 10:35:00 | roger.murphy@emeraldcoastsystemsgroup.com | Export recordOrder so the new autopilot reconciliation loop (trading-reconcile.ts) reuses the same fill upsert — fixes orders frozen at submit-time pending_new while the venue had filled them.
 * 2026-07-06 00:00:00 | roger.murphy@emeraldcoastsystemsgroup.com | Wire the Schwab LIVE rail: register the per-user Schwab token resolver (getValidAccessToken) at router creation, and thread the caller sub through every getBrokerAdapter(mode, sub) call site (account/positions/performance/ledger/status-live/order-refresh + the placeDecisionOrder/analyze helpers) so the Schwab adapter can resolve that user's brokered token. Alpaca (paper/autopilot) ignores the sub — unchanged.
 * 2026-07-06 00:00:00 | roger.murphy@emeraldcoastsystemsgroup.com | Data plane: route the live book's price reads through the per-mode getMarketData(mode, sub) source (Schwab Market Data API for live, Alpaca IEX for paper) — algoEnsembleDecision + the extended-hours order-pricing quote — and add GET /quote (latest price from the active book's source). Broad market-recommendation scans stay on the Alpaca IEX feed by design (market-wide data vendor, not account-specific).
 * 2026-07-06 00:00:00 | roger.murphy@emeraldcoastsystemsgroup.com | Use getBrokerReader (ungated reads) for the account/positions/performance/ledger/order-refresh/status-config reads + the decide-path cash context, so a connected LIVE Schwab account is viewable without arming live trading. Order placement (placeDecisionOrder) alone keeps the gated getBrokerAdapter.
 * 2026-07-08 12:20:00 | roger.murphy@emeraldcoastsystemsgroup.com | Two order-ledger fixes. (1) Extended-hours limits are priced from latestTrade() and REFUSED (409 stale_quote) when the last print is older than TRADING_EXT_QUOTE_MAX_AGE_SEC: latestPrice discarded the trade timestamp, so an off-hours limit pinned to an hours-old print never became marketable and was cancel/re-placed every 5-min fire — 525 dead orders over 30h (MRNA 97× at a frozen 79.54 while it fell to 74.61), with the "protective" exit never filling. Also dropped the silent `?? effLimit ?? refPrice` fallback, which hid a missing quote behind a stale decision price. (2) recordOrder's upsert is book-scoped: ON CONFLICT (user_sub, mode, client_order_id) over a matching unique index, so a paper fill can no longer overwrite a live order's broker id.
 * 2026-07-08 13:30:00 | roger.murphy@emeraldcoastsystemsgroup.com | rebindOrder + POST /orders/:orderId/rebind — re-find an order at its venue (listOrders, matched on symbol+side+qty inside a 15-min window around created_at) and persist the broker's own state over the row. Recovers rows whose broker id was never surfaced or was overwritten by the cross-book collision; refuses to bind when the window does not hold exactly one match, so a wrong trade can never be adopted.
 * 2026-07-11 05:05:00 | roger.murphy@emeraldcoastsystemsgroup.com | 1000-line cap decomposition (1186 code lines → split): moved shared helpers, the schema bootstrap, the analyst/order core, and the book-read / order-flow / algo+tuning route groups into sibling trading-routes-* modules, all handler code verbatim. This file remains the entry: createTradingRoutes keeps its exact signature and registration order, placeDecisionOrder + POST /trigger stay here (live-gate strings are source-guarded in this file), and the entire prior public API is re-exported so no consumer import changes. Zero route/behavior change.
 * 2026-07-19 16:55:00 | roger.murphy@emeraldcoastsystemsgroup.com | Trading engine extraction (ADR-085 pre-carve): placeDecisionOrder moved VERBATIM to app/trading-engine.ts (with trading-routes-core.ts and the schema bootstrap → app/trading-schema.ts), because 8 kernel dispatch/reconcile loops need the engine and must not import the carvable route surface. This file is now pure surface: createTradingRoutes (unchanged signature + registration order) + POST /trigger (its live-approval gate stays here, source-guarded). The pre-split re-export block removed — every consumer now imports the engine modules directly. Pure code motion — zero route/behavior change.
 * 2026-07-19 23:30:00 | roger.murphy@emeraldcoastsystemsgroup.com | Carved out of OSHAL core into the trading app package (ADR-085 Wave 3, "skill with a surface"). Standard (ctx) factory (the ManifestRouteMounter contract); the surface serves trading.html from ctx.appPackageDir/tools (load-time env fallback, D10) through the kernel's servePage helper. Relative imports flip to @/ aliases: @/app/routes/trading-routes-helpers (callerSub/resolveMode/servePage/guardrails — global-search + the engine also import them, they stay kernel), @/app/routes/connectors-routes (getValidAccessToken), @/app/trading-{schema,engine} (the ENGINE — stays kernel, the 8 dispatch/reconcile loops import it; D8 verified NOT orphaned). Route bodies byte-identical: POST /trigger keeps its route-level live-approval gate VERBATIM (live tickets park in backlog — source-guarded by this package's tests/trading-surface-live-gate.spec.ts; the engine's env-level live_blocked gate stays kernel-guarded in risky-write-guards.spec.ts).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-136 D6 event playbooks: register the /events/plans route family (trading-event-plan-routes.ts) right after the direct-trade routes — the operator's surface over the kernel event-plan store (IPO watch/entry/exit), book-scoped query-first like every 2026-09-03-audited route.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | ADR-138 single-stock research: register the /research/:symbol + /watchlist + /lots route family (trading-research-routes.ts) right after the event-plan routes — research reads, the per-user watchlist, and the operator's view/release over the kernel pinned-lot store.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Register the book-scoped specialist-context reader (ADR-090 uses: specialist-context) synchronously from this factory, through the activation-scoped port the manifest route mounter injects. A protected bot-node run is TOOL-LESS, so this append is the accountable trading bot's ONLY data channel: without it the bot is asked how the book did today and has no numbers to answer with. Facts live in trading-book-facts.ts - scalars only, one slot per BOOK (paper, live, live2...) so a stale sibling cannot withhold another book, computed for the ticket's OWNER, and venue-free so market hours and a venue outage cannot decide whether the dispatch happens.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Declare the MARKET half of the fact set alongside the book half (trading-market-facts.ts), so the registration is TRADING_SPECIALIST_FACT_KEYS and the read is readTradingSpecialistFacts. The book half alone is why the accountable bot could report the operator's equity to the cent and, in the same answer, say it could not access index or market-mover data: the screener ships in the kernel and GET /reports/movers already uses it, but a tool-less worker can never call a route, and no market number was declared on the one channel it can see. The market half reads SPY/QQQ/DIA day moves and the whole-market screener's extremes in PARALLEL with the book half, so the declaration costs no additional wall-clock time against the registry's 2000 ms deadline.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | ADR-136 D5 earnings-reaction rules: register the /events/rules route family (trading-earnings-rule-routes.ts) right after the event playbooks — the operator's surface over the kernel rule store, which until now could only be reached by calling the module, so no person could arm, see or stop a rule. Book-scoped query-first like every 2026-09-03-audited route.
 *
 * @module trading-routes
 */

import { Router, static as serveStatic, type Request, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { registerSchwabTokenResolver, type OrderResult } from '@/features/trading';
import { getValidAccessToken } from '@/app/routes/connectors-routes';
import { CreateInternalTicketSchema } from '@/entities/ticket';
import { callerSub, resolveMode, resolveBook, TradingError, type SignalRow } from '@/app/routes/trading-routes-helpers';
import { ensureTradingSchema } from '@/app/trading-schema';
import { placeDecisionOrder, analyzeAndRecordDecision } from '@/app/trading-engine';
import { registerTradingBookReadRoutes } from './trading-routes-book-read-builders';
import { registerTradingOrderFlowRoutes } from './trading-routes-order-flow-builders';
import { registerTradingAlgoRoutes, registerTradingTuningRoutes } from './trading-routes-algo-builders';
import { registerTradingAccountRoutes } from './trading-accounts-routes';
import { registerTradingManualOrderRoutes } from './trading-manual-order-routes';
import { registerTradingEventPlanRoutes } from './trading-event-plan-routes';
import { registerTradingEarningsRuleRoutes } from './trading-earnings-rule-routes';
import { registerTradingResearchRoutes } from './trading-research-routes';
import { TRADING_SPECIALIST_FACT_KEYS, readTradingSpecialistFacts } from './trading-market-facts';

const logger = createChildLogger({ module: 'trading-routes' });

/**
 * The accountable trading specialist. Declared in this package's oshal-app.yaml `bots:` - the
 * kernel registry refuses a specialist registration whose bot this package does not own, and
 * tests/trading-specialist-context.spec.ts pins the two together so the pair cannot drift.
 */
export const TRADING_ANALYST_AGENT_ID = 'a0000000-0000-0000-0000-000000000046';

/**
 * The named read the facts run under - this package's own `tools:` entry, so the kernel resolves
 * us as its owner. When this app gains an authorization catalog, this is the binding that carries
 * the permission; until then it is the audited name of the read.
 */
export const TRADING_FACTS_TOOL = 'trading_book_facts';

/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

/**
 * @description Resolve the package tools/ directory holding the bundled surface (trading.html):
 * ctx.appPackageDir (captured at factory time per D10), the load-time env fallback, then a
 * relative fallback for running the built routes/ next to src-routes/ (tests, local checks).
 * @param appPackageDir - This package's directory from the per-package context.
 * @returns The first candidate dir containing trading.html (or the last candidate for sendFile's 404 path).
 */
export function surfaceDir(appPackageDir: string | undefined): string {
  const candidates = [
    appPackageDir ? path.join(appPackageDir, 'tools') : '',
    LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'tools') : '',
    path.resolve(__dirname, '../tools'),
  ].filter(Boolean) as string[];
  return candidates.find((d) => fs.existsSync(path.join(d, 'trading.html'))) || candidates[candidates.length - 1];
}

/**
 * @description Builds the trading router (mounted at /api/trading with auth: service-or-oidc by
 * the ManifestRouteMounter — the EXACT posture core server.ts mounted, ADR-085 D2).
 * @param ctx - The per-package app context (Postgres pool for the per-user, per-mode stores;
 * appPackageDir for the bundled surface per D10).
 * @returns Express router.
 */
export function createTradingRoutes(ctx: AppContext): Router {
  const router = Router();
  const apiDir = surfaceDir(ctx.appPackageDir);

  // ADR-090 specialist context. Registration is SYNCHRONOUS and inside the factory on purpose:
  // the mounter stages this package's readers around the factory call and rolls them back if the
  // factory fails, so a half-activated package can never leave a live reader behind.
  //
  // A protected run is tool-less, so this append is the trading bot's only data channel. The
  // manifest declares `uses: specialist-context`, which makes a kernel that predates the channel
  // REFUSE this package outright rather than install it with the channel silently missing. The
  // port can still be absent on a framework that has the skill but composes no registry (no
  // server.ts wiring) - that is a deployment fault, not a package one, so it is logged loudly
  // rather than thrown, which would unmount 89 working routes over a missing prompt appendix.
  //
  // The declared set is BOTH halves: the per-book numbers and the market context. Declaring only
  // the book half is what left the bot able to report the operator's equity to the cent while
  // answering that it could not access index or market-mover data - the surface route had the
  // screener all along, and a tool-less worker can never call a route.
  if (ctx.specialistContext) {
    ctx.specialistContext.register({
      agentId: TRADING_ANALYST_AGENT_ID,
      toolName: TRADING_FACTS_TOOL,
      facts: [...TRADING_SPECIALIST_FACT_KEYS],
      read: (input) => readTradingSpecialistFacts(ctx, { sub: input.sub, signal: input.signal }),
    });
  } else {
    logger.error({ agentId: TRADING_ANALYST_AGENT_ID, tool: TRADING_FACTS_TOOL },
      'No specialist-context port on this framework - the trading bot will be dispatched with no book or market facts');
  }

  // Wire the Schwab LIVE rail's per-user token lookup (ADR-036 brokered creds): the trading feature
  // slice can't import the app-layer connector store (FSD), so it calls back through this resolver to
  // decrypt/refresh the caller's Schwab access token. No-op for the Alpaca (paper/autopilot) rail.
  // ADR-134 D5.6: the resolver is connectionKey-CAPABLE (3-arg — the core factory's fail-closed
  // guard checks Function.length): a book bound to a specific Schwab LOGIN passes its connection_key
  // (= oshal_connections.account_key), which maps to that login's connection row; no key = the
  // default connection, exactly today's behavior for legacy/unbound books.
  registerSchwabTokenResolver(async (_mode, sub, connectionKey) => {
    if (!connectionKey || connectionKey === 'default') return getValidAccessToken(ctx.pool, sub, 'schwab');
    const row = (await ctx.pool.query(
      `SELECT connection_id FROM oshal_connections WHERE user_sub=$1 AND provider='schwab' AND account_key=$2 LIMIT 1`,
      [sub, connectionKey])).rows[0];
    // FAIL CLOSED: a bound book whose login connection is gone gets NO token (the fire skips) —
    // never a silent fallback onto a different login's token against a bound account.
    if (!row) return null;
    return getValidAccessToken(ctx.pool, sub, 'schwab', { connectionId: String(row.connection_id) });
  });

  // Route groups register in the ORIGINAL pre-split order (surface/reads → signal→decision→order
  // flow → POST /trigger below → algo engine → tuning). Paths are all distinct, but the order is
  // preserved anyway so the mounted surface is exactly what it was before the decomposition.
  // ADR-134 PR3: the accounts/books/summary family registers FIRST (most-specific paths).
  registerTradingAccountRoutes(router, ctx);
  // ADR-136 D2: the surface is a thin shell + per-view modules under tools/ui, served same-origin
  // behind the SAME auth posture as the surface (this router is mounted service-or-oidc). no-cache
  // so a redeploy is picked up on the next load without a cache-busting rename; ETags keep it cheap.
  router.use('/ui', serveStatic(path.join(apiDir, 'ui'), {
    etag: true, maxAge: 0, index: false, fallthrough: false,
    setHeaders: (res) => { res.setHeader('Cache-Control', 'no-cache'); },
  }));
  // ADR-136 D3: direct trades — operator-authored decisions + quotes (before the generic flow).
  registerTradingManualOrderRoutes(router, ctx);
  // ADR-136 D6: event playbooks — the IPO watch/entry/exit plans (before the generic flow).
  registerTradingEventPlanRoutes(router, ctx);
  // ADR-136 D5: earnings-reaction rules — arm/list/cancel over the kernel rule store (before the generic flow).
  registerTradingEarningsRuleRoutes(router, ctx);
  // ADR-138: single-stock research, the per-user watchlist, and pinned lots (before the generic flow).
  registerTradingResearchRoutes(router, ctx);
  registerTradingBookReadRoutes(router, ctx, apiDir);
  registerTradingOrderFlowRoutes(router, ctx, placeDecisionOrder);

  /** POST /trigger — turn captured signal(s) into a `trading-decision` ticket.
   *  Body: { mode?, signalIds: string[] }. The ticket carries the signalIds so the decision reasons
   *  over the SAME captured artifacts the provenance chain stores. This is the bridge a cron/
   *  heuristic/sentiment signal generator calls.
   *
   *  AUTONOMY (ADR-052/053): PAPER trades need NO approval — the ticket is created 'approved' and
   *  this route runs the loop inline (analyst decides → if actionable, places the order) and drives
   *  the ticket approved → complete (or escalated on failure). LIVE stays gated: the ticket is left
   *  'backlog' for manual approval and nothing is placed here. */
  router.post('/trigger', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const b = (req.body || {}) as { mode?: string; book?: string; signalIds?: string[] };
    const signalIds = Array.isArray(b.signalIds) ? b.signalIds.map(String) : [];
    if (!signalIds.length) { res.status(400).json({ error: 'signal_ids_required', message: 'Provide at least one captured signalId to trigger a decision ticket.' }); return; }
    try {
      await ensureTradingSchema(ctx.pool);
      const book = await resolveBook(ctx.pool, sub, b.book ?? b.mode);
      const mode = book.kind;
      const signals = (await ctx.pool.query(
        `SELECT signal_id, source, author, title, body, url, symbols, indicators, observed_at
           FROM oshal_trading_signals WHERE user_sub=$1 AND book_id=$2 AND signal_id = ANY($3::uuid[])`,
        [sub, book.bookId, signalIds])).rows as SignalRow[];
      if (!signals.length) { res.status(404).json({ error: 'signals_not_found', message: 'No matching captured signals for this book.' }); return; }
      const syms = [...new Set(signals.flatMap((s) => (s.symbols || []) as string[]))];
      const lead = signals[0];
      // Paper auto-approves; live waits for a human (the ADR-052 autonomy gate).
      const input = CreateInternalTicketSchema.parse({
        title: `Trading signal: ${lead.title || (lead.body || '').slice(0, 80)}${syms.length ? ' [' + syms.join(', ') + ']' : ''}`,
        description: `A ${mode} trading-decision triggered by ${signals.length} captured signal(s) from `
          + `${[...new Set(signals.map((s) => s.source))].join(', ')}. Reason over the signal(s) and decide whether to trade.`,
        ticketType: 'trading-decision',
        status: mode === 'paper' ? 'approved' : 'backlog',
        ownerSub: sub,
        payload: { mode, signalIds, symbols: syms },
        metadata: { source: 'trading-trigger', book: mode },
      });
      const ticket = await ctx.ticketService.createTicket(input);

      // LIVE: leave the ticket for manual approval; place nothing here.
      if (mode === 'live') {
        res.status(201).json({ ok: true, ticketId: ticket.ticketId, status: ticket.status, mode, signalIds, note: 'Live trades require approval — ticket left in backlog.' });
        return;
      }

      // PAPER: run the loop now, no approval. Decide → (if actionable) place → complete the ticket.
      try {
        const { decisionId, decision } = await analyzeAndRecordDecision(ctx, sub, book, signals);
        let order: OrderResult | null = null;
        if (decision.action !== 'hold') {
          order = await placeDecisionOrder(ctx.pool, sub, book, decisionId, ticket.ticketId, false);
        }
        await ctx.ticketService.updateStatus(ticket.ticketId, 'complete').catch(() => { /* status best-effort */ });
        res.status(201).json({
          ok: true, ticketId: ticket.ticketId, status: 'complete', mode, decisionId,
          action: decision.action,
          order: order ? { id: order.id, status: order.status, symbol: order.symbol, side: order.side, qty: order.qty, type: order.type } : null,
          note: decision.action === 'hold' ? 'Analyst held — no trade (justified non-action).' : undefined,
        });
      } catch (e) {
        // A guardrail block / not-actionable is a clean "no trade" → complete; anything else escalates.
        const benign = e instanceof TradingError && (e.code === 'guardrail_blocked' || e.code === 'not_actionable');
        await ctx.ticketService.updateStatus(
          ticket.ticketId,
          benign ? 'complete' : 'escalated',
          benign ? {
            reason: e instanceof TradingError ? e.code : 'trading_decision_not_actionable',
            source: 'trading-trigger',
            message: (e as Error).message,
          } : {
            reason: 'trading_trigger_failed',
            source: 'trading-trigger',
            message: (e as Error).message,
          },
        ).catch(() => { /* best-effort */ });
        res.status(201).json({ ok: true, ticketId: ticket.ticketId, status: benign ? 'complete' : 'escalated', mode, note: (e as Error).message });
      }
    } catch (err) {
      logger.error({ err }, 'trading trigger failed');
      res.status(500).json({ error: (err as Error).message });
    }
  });

  registerTradingAlgoRoutes(router, ctx);
  registerTradingTuningRoutes(router, ctx);

  return router;
}
