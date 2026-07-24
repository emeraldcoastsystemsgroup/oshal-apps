/**
 * Trading algorithm + tuning route builders (ADR-052) — the deterministic, no-LLM engine surface:
 * watchlist scans, the stored-signal lookup, the algo-ensemble decision, universe recommendations,
 * the per-algo hit-rate scoreboard, and the nightly-optimizer approval gate. Also home of the
 * prediction-recording helper (recordPredictions; its resolver sibling resolveMaturedPredictions
 * lives in the engine, app/trading-engine.ts, shared with the review/assess dispatch loops).
 * Registered after POST /trigger by trading-routes.ts, preserving the original order exactly.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-11 05:05:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Extracted from trading-routes.ts (1000-line cap decomposition): POST /scan + /signal-latest + /decide-algo, GET /recommendations + /algo-stats, the tuning routes (GET /strategy-params, GET /recommendations-tuning, POST approve/reject, POST /optimize-now), and the recordPredictions/resolveMaturedPredictions/algoEnsembleDecision helpers. Code moved verbatim — zero behavior change.
 * 2026-07-19 16:55:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Trading engine extraction (ADR-085 pre-carve): resolveMaturedPredictions moved VERBATIM to app/trading-engine.ts (the review/assess loops import the engine, not this carvable surface); this builder now imports it back from the engine, and ensureTradingSchema from its moved home app/trading-schema.ts. Pure code motion — zero behavior change.
 * 2026-07-19 23:30:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Carved out of OSHAL core into the trading app package (ADR-085 Wave 3). Relative kernel imports flip to @/ aliases (helpers/schema/engine/strategy-params/optimize-dispatch/schedule-dispatch ALL stay kernel with the dispatch loops). Handler bodies byte-identical — zero behavior change.
 *
 * @module trading-routes-algo-builders
 */

import type { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import {
  getMarketData, scoreSymbol, ensemble, dailyCloses, latestPrice, marketDataConfigured, algoNames,
  type TradingMode, type AlgoSignal, type EnsembleDecision,
} from '@/features/trading';
import { callerSub, resolveMode, guardrails, TradingError } from '@/app/routes/trading-routes-helpers';
import { ensureTradingSchema } from '@/app/trading-schema';
import { resolveMaturedPredictions } from '@/app/trading-engine';
import { loadStrategyParams, loadStrategyParamsDetailed } from '@/app/trading-strategy-params';
import { runOptimize, loadRecommendations, approveRecommendation, rejectRecommendation, optimizeTaskType, OPTIMIZE_CRON } from '@/app/trading-optimize-dispatch';
import { getTradingScheduleService } from '@/app/trading-schedule-dispatch';

// Same module tag as the entry file so structured log output is unchanged by the split.
const logger = createChildLogger({ module: 'trading-routes' });

/** Default universe the market-analysis recommendation scan assesses. */
const RECO_UNIVERSE = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'TSLA', 'AMD', 'JPM', 'XOM', 'WMT', 'DIS', 'NFLX', 'HD', 'LOW', 'GNRC', 'BLDR', 'COST', 'GOOGL'];

/* ── deterministic, algorithm-driven path (no LLM): scoreSymbol → ensemble → decision ── */

/** Persist the per-algo + ensemble predictions for a symbol (the queryable track record). */
async function recordPredictions(pool: AppContext['pool'], sub: string, mode: TradingMode, symbol: string, price: number, signals: AlgoSignal[], ens: EnsembleDecision): Promise<void> {
  for (const s of signals) {
    await pool.query(`INSERT INTO oshal_trading_predictions (user_sub,mode,symbol,algo,pred_dir,confidence,price,basis) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [sub, mode, symbol, s.algo, s.dir, s.confidence, price, s.basis]);
  }
  if (ens.action !== 'hold' && ens.side) {
    await pool.query(`INSERT INTO oshal_trading_predictions (user_sub,mode,symbol,algo,pred_dir,confidence,price,basis) VALUES ($1,$2,$3,'ensemble',$4,$5,$6,$7)`,
      [sub, mode, symbol, ens.side === 'buy' ? 'up' : 'down', ens.confidence, price, `ensemble score ${ens.score}`]);
  }
}

/** Run the algorithms over live market data and fold them into a DETERMINISTIC decision (no LLM).
 *  Captures the scan as a provenance signal so the order still chains signal → decision → order. */
async function algoEnsembleDecision(pool: AppContext['pool'], sub: string, mode: TradingMode, symbol: string): Promise<{ decisionId: string; decision: Record<string, unknown>; signals: AlgoSignal[]; ensemble: EnsembleDecision; price: number }> {
  // Per-mode data source: paper reads Alpaca (IEX), the live book reads the caller's Schwab feed.
  const md = getMarketData(mode, sub);
  if (!md.configured()) throw new TradingError(503, 'market_data_not_configured', md.kind === 'schwab' ? 'Connect your Charles Schwab account for live market data.' : 'Set Alpaca data keys (ALPACA_PAPER_KEY_ID/_SECRET).');
  const SYM = symbol.toUpperCase();
  const closes = await md.dailyCloses(SYM);
  if (!closes.length) throw new TradingError(502, 'no_data', `No daily bars for ${SYM}.`);
  const price = (await md.latestPrice(SYM)) ?? closes[closes.length - 1];
  const live = price && price !== closes[closes.length - 1] ? [...closes, price] : [...closes];
  const spy = SYM === 'SPY' ? undefined : await md.dailyCloses('SPY').catch(() => [] as number[]);
  const params = await loadStrategyParams(pool);
  const signals = scoreSymbol(SYM, live, spy && spy.length ? spy : undefined, 'SPY', params);
  const ens = ensemble(signals, {}, params.ensembleThreshold);
  await recordPredictions(pool, sub, mode, SYM, price, signals, ens);

  const artifact = JSON.stringify({ source: 'algo-scan', symbol: SYM, price, signals, ensemble: ens });
  const hash = crypto.createHash('sha256').update(artifact).digest('hex');
  const sig = (await pool.query(
    `INSERT INTO oshal_trading_signals (user_sub, mode, source, title, body, symbols, indicators, content_hash)
       VALUES ($1,$2,'algo-scan',$3,$4,$5,$6,$7)
     ON CONFLICT (user_sub, mode, content_hash) DO UPDATE SET observed_at = oshal_trading_signals.observed_at
     RETURNING signal_id`,
    [sub, mode, `Algo scan ${SYM} @ ${price}`, JSON.stringify({ signals, ensemble: ens }), [SYM], JSON.stringify({ price, signals, ensemble: ens }), hash])).rows[0];

  const g = guardrails(); const qty = Number(process.env.TRADING_ALGO_QTY || 1);
  const rationale = `Deterministic ensemble of ${signals.length} algos — score ${ens.score}, confidence ${ens.confidence}: `
    + signals.map((s) => `${s.algo}:${s.dir}(${s.confidence.toFixed(2)})`).join(', ') + '.';
  const row = (await pool.query(
    `INSERT INTO oshal_trading_decisions
       (user_sub, mode, signal_ids, agent_id, action, symbol, side, qty, order_type, confidence, rationale, indicators, guardrails)
     VALUES ($1,$2,$3::uuid[],'algo-ensemble',$4,$5,$6,$7,'market',$8,$9,$10,$11)
     RETURNING decision_id`,
    [sub, mode, [sig.signal_id], ens.action, ens.action === 'hold' ? null : SYM, ens.side,
     ens.action === 'hold' ? null : qty, ens.confidence, rationale, JSON.stringify(signals), JSON.stringify(g)])).rows[0];
  return { decisionId: row.decision_id, decision: { action: ens.action, symbol: SYM, side: ens.side, qty: ens.action === 'hold' ? null : qty, confidence: ens.confidence, score: ens.score, rationale }, signals, ensemble: ens, price };
}

/**
 * @description Registers the deterministic algorithm routes (scan / signal-latest / decide-algo /
 * recommendations / algo-stats) on the trading router. Auth is enforced at the mount
 * (`/api/trading` sits behind serviceSecretOr(requiresAuth) in server.ts) plus each handler's own
 * callerSub 401 check — unchanged from the pre-split file.
 * @param router - The trading router being composed by createTradingRoutes.
 * @param ctx - App context (Postgres pool for the per-user, per-mode stores).
 * @returns Nothing — routes are registered on the passed router.
 */
export function registerTradingAlgoRoutes(router: Router, ctx: AppContext): void {
  /** POST /scan — run every algorithm over a watchlist's live market data, persist the per-algo
   *  predictions, resolve matured ones, and return signals + the deterministic ensemble per symbol.
   *  No orders placed — this is the monitor/predict step. Body: { mode?, symbols?: string[] }. */
  router.post('/scan', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      await ensureTradingSchema(ctx.pool);
      if (!marketDataConfigured()) { res.status(503).json({ error: 'market_data_not_configured', message: 'Set Alpaca data keys.' }); return; }
      const b = (req.body || {}) as { mode?: string; symbols?: string[] };
      const mode = resolveMode(b.mode);
      const watch = (Array.isArray(b.symbols) && b.symbols.length ? b.symbols : ['HD', 'LOW', 'GNRC', 'BLDR', 'SPY']).map((s) => String(s).toUpperCase());
      const resolved = await resolveMaturedPredictions(ctx.pool, mode);
      const spy = await dailyCloses('SPY').catch(() => [] as number[]);
      const params = await loadStrategyParams(ctx.pool); // approved tuned params (defaults until approved)
      const scanned = [];
      for (const sym of watch) {
        try {
          const closes = await dailyCloses(sym); if (!closes.length) { scanned.push({ symbol: sym, error: 'no_data' }); continue; }
          const price = (await latestPrice(sym)) ?? closes[closes.length - 1];
          const live = price && price !== closes[closes.length - 1] ? [...closes, price] : [...closes];
          const signals = scoreSymbol(sym, live, sym === 'SPY' ? undefined : (spy.length ? spy : undefined), 'SPY', params);
          const ens = ensemble(signals, {}, params.ensembleThreshold);
          await recordPredictions(ctx.pool, sub, mode, sym, price, signals, ens);
          scanned.push({ symbol: sym, price, signals, ensemble: ens });
        } catch (e) { scanned.push({ symbol: sym, error: (e as Error).message }); }
      }
      res.json({ mode, resolved, scanned });
    } catch (err) {
      logger.error({ err }, 'trading scan failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** POST /signal-latest — READ-ONLY: the latest STORED per-algo signals + ensemble for the given
   *  symbols, straight from oshal_trading_predictions (the deterministic engine's recorded track
   *  record). NO market-data calls — this is the cheap DB lookup the surface uses for passive display
   *  (focusing a name, annotating the held book) so ordinary browsing never burns the Alpaca data
   *  rate limit. POST /scan stays the explicit, live recompute. Body: { mode?, symbols: string[] }.
   *  Returns { mode, results: [{ symbol, asOf, price, signals[], ensemble, mtf }] }. */
  router.post('/signal-latest', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      await ensureTradingSchema(ctx.pool);
      const b = (req.body || {}) as { mode?: string; symbols?: string[] };
      const mode = resolveMode(b.mode);
      const symbols = [...new Set((Array.isArray(b.symbols) ? b.symbols : []).map((s) => String(s).toUpperCase()).filter(Boolean))].slice(0, 100);
      if (!symbols.length) { res.json({ mode, results: [] }); return; }
      const voteAlgos = algoNames();                 // canonical ensemble algos (momentum/gravity/donchian/meanrev)
      const wantAlgos = [...voteAlgos, 'mtf-assess']; // + the autopilot's multi-timeframe conviction (display only)
      // latest row per (symbol, algo) within a freshness window — served by idx_trd_pred_symbol_algo.
      const rows = (await ctx.pool.query(
        `SELECT DISTINCT ON (symbol, algo) symbol, algo, pred_dir, confidence, price, basis, created_at
           FROM oshal_trading_predictions
          WHERE mode=$1 AND symbol = ANY($2::text[]) AND algo = ANY($3::text[])
            AND created_at > now() - interval '72 hours'
          ORDER BY symbol, algo, created_at DESC`,
        [mode, symbols, wantAlgos])).rows as Array<{ symbol: string; algo: string; pred_dir: string; confidence: string | null; price: string | null; basis: string | null; created_at: Date }>;
      const bySym = new Map<string, typeof rows>();
      for (const r of rows) { const a = bySym.get(r.symbol) || []; a.push(r); bySym.set(r.symbol, a); }
      const results = symbols.map((sym) => {
        const rs = bySym.get(sym) || [];
        const signals: AlgoSignal[] = rs.filter((r) => voteAlgos.includes(r.algo))
          .map((r) => ({ algo: r.algo, dir: r.pred_dir === 'up' ? 'up' : 'down', confidence: Number(r.confidence) || 0, basis: r.basis || '' }));
        const mtfRow = rs.find((r) => r.algo === 'mtf-assess');
        const asOf = rs.length ? rs.reduce((m, r) => (r.created_at > m ? r.created_at : m), rs[0].created_at) : null;
        const priceRow = rs.find((r) => r.price != null);
        return {
          symbol: sym,
          asOf,
          price: priceRow ? Number(priceRow.price) : null,
          signals,
          ensemble: ensemble(signals),
          mtf: mtfRow ? { dir: mtfRow.pred_dir === 'up' ? 'up' : 'down', confidence: Number(mtfRow.confidence) || 0 } : null,
        };
      });
      res.json({ mode, results });
    } catch (err) {
      logger.error({ err }, 'trading signal-latest failed');
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /** POST /decide-algo — the DETERMINISTIC decision: algorithms over live data → ensemble → a
   *  persisted decision (no LLM), provenance-anchored to an algo-scan signal. Body: { mode?, symbol }.
   *  Returns a decisionId that POST /orders executes exactly like an analyst decision. */
  router.post('/decide-algo', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const b = (req.body || {}) as { mode?: string; symbol?: string };
    if (!b.symbol) { res.status(400).json({ error: 'symbol_required', message: 'A symbol is required.' }); return; }
    try {
      await ensureTradingSchema(ctx.pool);
      const out = await algoEnsembleDecision(ctx.pool, sub, resolveMode(b.mode), String(b.symbol));
      res.json({ ok: true, ...out });
    } catch (err) {
      if (err instanceof TradingError) { res.status(err.httpStatus).json({ error: err.code, message: err.message }); return; }
      logger.error({ err }, 'trading decide-algo failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** GET /recommendations?mode=&universe= — the market-analysis view: scan the universe with the
   *  deterministic ensemble, rank into BUY / SELL recommendations by conviction. Read-only (no
   *  orders, no persistence) — it shows WHAT is assessed and WHAT the algos recommend right now. */
  router.get('/recommendations', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      const mode = resolveMode(req.query.mode);
      // Per-mode data source: the live book scans on the Schwab feed, paper on Alpaca IEX.
      const md = getMarketData(mode, sub);
      if (!md.configured()) { res.status(503).json({ error: 'market_data_not_configured', message: md.kind === 'schwab' ? 'Connect your Charles Schwab account for live data.' : 'Set Alpaca data keys.' }); return; }
      const universe = (req.query.universe ? String(req.query.universe).split(',') : RECO_UNIVERSE).map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 40);
      const spy = await md.dailyCloses('SPY').catch(() => [] as number[]);
      const params = await loadStrategyParams(ctx.pool);
      const scored = await Promise.all(universe.map(async (sym) => {
        try {
          const closes = await md.dailyCloses(sym); if (closes.length < 25) return null;
          const price = (await md.latestPrice(sym)) ?? closes[closes.length - 1];
          const live = price !== closes[closes.length - 1] ? [...closes, price] : [...closes];
          const signals = scoreSymbol(sym, live, sym === 'SPY' ? undefined : (spy.length ? spy : undefined), 'SPY', params);
          return { symbol: sym, price, signals, ensemble: ensemble(signals, {}, params.ensembleThreshold) };
        } catch { return null; }
      }));
      const ok = scored.filter((x): x is NonNullable<typeof x> => x != null);
      const buys = ok.filter((r) => r.ensemble.action === 'buy').sort((a, b) => b.ensemble.score - a.ensemble.score);
      const sells = ok.filter((r) => r.ensemble.action === 'sell').sort((a, b) => a.ensemble.score - b.ensemble.score);
      res.json({ mode, source: md.kind, asOf: new Date().toISOString(), assessed: { symbols: ok.length, algorithms: algoNames() }, buys, sells, holds: ok.length - buys.length - sells.length });
    } catch (err) {
      logger.error({ err }, 'trading recommendations failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  /** GET /algo-stats?mode= — per-algorithm live hit-rate from the resolved prediction ledger.
   *  This is the scoreboard: which algorithm is actually right. */
  router.get('/algo-stats', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      await ensureTradingSchema(ctx.pool);
      const mode = resolveMode(req.query.mode);
      const rows = (await ctx.pool.query(
        `SELECT algo,
                COUNT(*) FILTER (WHERE resolved) ::int AS resolved,
                COUNT(*) FILTER (WHERE resolved AND hit) ::int AS hits,
                COUNT(*) FILTER (WHERE NOT resolved) ::int AS open,
                ROUND(100.0 * COUNT(*) FILTER (WHERE resolved AND hit) / NULLIF(COUNT(*) FILTER (WHERE resolved), 0), 1) AS hit_rate_pct
           FROM oshal_trading_predictions WHERE mode=$1 GROUP BY algo ORDER BY hit_rate_pct DESC NULLS LAST`, [mode])).rows;
      res.json({ mode, algos: rows });
    } catch (err) {
      logger.error({ err }, 'trading algo-stats failed');
      res.status(500).json({ error: (err as Error).message });
    }
  });
}

/**
 * @description Registers the tuning routes (nightly parameter optimizer + approval gate — ADR-052
 * addendum) on the trading router. The optimizer (trading-optimize-dispatch) backtests parameter
 * tweaks and writes RECOMMENDATIONS; nothing changes how the bot trades until the operator
 * APPROVES one here, which writes the value to the param store the live (paper) engine reads.
 * Paper-only; defaults reproduce today's engine. Auth unchanged: mount-level gate + per-handler
 * callerSub 401 check.
 * @param router - The trading router being composed by createTradingRoutes.
 * @param ctx - App context (Postgres pool for the per-user, per-mode stores).
 * @returns Nothing — routes are registered on the passed router.
 */
export function registerTradingTuningRoutes(router: Router, ctx: AppContext): void {
  /** GET /strategy-params — the current (approved or default) tunable params + per-param last-changed. */
  router.get('/strategy-params', async (req: Request, res: Response) => {
    if (!callerSub(req)) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try { res.json({ params: await loadStrategyParamsDetailed(ctx.pool) }); }
    catch (err) { logger.error({ err }, 'strategy-params failed'); res.status(500).json({ error: (err as Error).message }); }
  });

  /** GET /recommendations-tuning?mode= — pending param recommendations + recent applied/rejected. */
  router.get('/recommendations-tuning', async (req: Request, res: Response) => {
    if (!callerSub(req)) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try { res.json(await loadRecommendations(ctx.pool, resolveMode(req.query.mode))); }
    catch (err) { logger.error({ err }, 'recommendations-tuning list failed'); res.status(500).json({ error: (err as Error).message }); }
  });

  /** POST /recommendations-tuning/:id/approve — apply the proposed value to the live (paper) params. */
  router.post('/recommendations-tuning/:id/approve', async (req: Request, res: Response) => {
    if (!callerSub(req)) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      const out = await approveRecommendation(ctx.pool, String(req.params.id));
      if (!out.applied) { res.status(409).json({ error: out.reason || 'not_applied' }); return; }
      res.json({ ok: true, ...out });
    } catch (err) { logger.error({ err }, 'recommendation approve failed'); res.status(500).json({ error: (err as Error).message }); }
  });

  /** POST /recommendations-tuning/:id/reject — archive a pending recommendation. */
  router.post('/recommendations-tuning/:id/reject', async (req: Request, res: Response) => {
    if (!callerSub(req)) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      const out = await rejectRecommendation(ctx.pool, String(req.params.id));
      if (!out.rejected) { res.status(409).json({ error: out.reason || 'not_rejected' }); return; }
      res.json({ ok: true });
    } catch (err) { logger.error({ err }, 'recommendation reject failed'); res.status(500).json({ error: (err as Error).message }); }
  });

  /** POST /optimize-now — run the optimizer on demand (and backfill the nightly schedule if missing). */
  router.post('/optimize-now', async (req: Request, res: Response) => {
    const sub = callerSub(req); if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const mode = resolveMode(req.query.mode ?? (req.body || {}).mode);
    try {
      const svc = getTradingScheduleService();
      if (svc) {
        try { await svc.createSchedule({ taskType: optimizeTaskType(sub), schedule: OPTIMIZE_CRON, ownerSub: sub, queue: 'intelligent-trades', taskData: { prompt: 'Nightly parameter optimization — backtest tweaks, recommend (approval-gated)', userSub: sub, mode } }); }
        catch (e) { logger.warn({ err: e }, 'optimize schedule backfill failed'); }
      }
      const out = await runOptimize(ctx, sub, mode);
      res.json({ ok: true, ...out });
    } catch (err) { logger.error({ err }, 'optimize-now failed'); res.status(500).json({ error: (err as Error).message }); }
  });
}
