/**
 * Strategy Lab routes (ADR-092) — /api/trading/lab. Persistent strategy variations, persisted
 * backtests with full equity curves, daily forward (out-of-sample) walks, pinned-window
 * regressions, the knob/formula reference the UI renders, and the "describe it in words" draft
 * endpoint (trading-analyst translates prose into knobs; the operator reviews before saving).
 * Mounted with serviceSecretOr(requiresAuth) BEFORE /api/trading, like the autopilot routes.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-13 00:25:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial — strategies CRUD + backtest/forward/regression triggers + run curves + knobs reference + bot-drafted configs.
 * 2026-07-13 14:50:00 | roger.murphy@emeraldcoastsystemsgroup.com | ADR-095: per-strategy notes/lessons CRUD + APPLY-TO-PROFILE endpoints (GET /apply status incl. env-default comparison, POST /strategies/:id/apply with confirm guard + applyPct, POST /apply/revert). Every apply/revert returns a ready-to-paste strategy-log.md row — the log discipline survives the UI path.
 * 2026-07-13 21:00:00 | roger.murphy@emeraldcoastsystemsgroup.com | BLEND create/patch (ADR-095 round 2): resolveBlendRefs embeds {strategyId, weightPct} component references as config snapshots at save time (editing a source never mutates a blend), and knobSummary/log rows describe blends ("blend 30% A + 20% B · core 50%").
 * 2026-07-19 23:30:00 | roger.murphy@emeraldcoastsystemsgroup.com | Carved out of OSHAL core into the trading app package (ADR-085 Wave 3). Relative kernel imports flip to @/ aliases — the lab sim/ops/store, config-overrides, schedule-dispatch, free-tier-rotation, and inline-bot-execution ALL stay kernel (the lab dispatch leg and the blend/config engines import them). Route bodies byte-identical incl. the apply confirm guard — zero behavior change.
 * 2026-07-24 13:20:00 | roger.murphy@emeraldcoastsystemsgroup.com | Strategy Studio: POST /studio — a conversational quant analyst that grounds a design in cited peer-reviewed research (trading-strategy-research.ts), drafts a StrategyConfig, INJECTS it as a candidate, backtests ~2y, and narrates with sources. Reuses the /draft bot path + createStrategy + backtestStrategy; citations validated against the curated corpus so no invented paper survives.
 * 2026-07-25 21:55:00 | roger.murphy@emeraldcoastsystemsgroup.com | Studio REFINE-IN-PLACE (the workflow-assistant contract): /studio with a strategyId feeds the CURRENT config back into the prompt and updateStrategy()s the SAME row (store resets forward walk + baseline) instead of minting a new strategy every turn; a reply with no parseable JSON returns {needsInput, message} — a clarifying question — instead of 502; blends are refused conversationally (embedded snapshots); response flags refined and warns when the refined strategy is live-APPLIED (the override keeps its old snapshot until re-applied). Prompt/parse helpers moved to trading-strategy-studio-prompt.ts so the spec imports them without this module's kernel chain.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-136 D6 event playbooks: /studio resolves the SELECTED book query-first and branches on isEventIntent (or a strategyId that is an event plan) BEFORE the rotation flow — the Studio refused "the Anthropic IPO" because a single listing is not a rotation. The branch lives in trading-event-plan-routes.ts (respondEventStudioTurn); the rotation/ensemble flow is otherwise byte-identical.
 *
 * @module trading-strategy-lab-routes
 */

import { Router, type Request, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import { getTrustedServiceUserSub } from '@/shared/middleware/authz';
import type { AppContext } from '@/app/composition/app-context';
import { BotNodeClient, createRegistryEndpointResolver } from '@/features/agent-management';
import { DEFAULT_UNIVERSE, RISK_POLICIES, riskPolicy } from '@/features/trading';
import { normalizeConfig, type StrategyConfig } from '@/app/trading-strategy-lab-sim';
import {
  backtestStrategy, forwardStepStrategy, regressStrategy, requireStrategy, runForwardAll, runRegressionsAll,
} from '@/app/trading-strategy-lab-ops';
import {
  addNote, createStrategy, deleteNote, deleteStrategy, ensureLabSchema, getForwardState, getRun, getStrategy,
  listNotes, listRuns, listStrategies, setBaseline, updateStrategy,
} from '@/app/trading-strategy-lab-store';
import {
  applyOverride, effectiveCorePct, getActiveOverride, listOverrideHistory, policyOverrideOf, revertOverride,
  type ConfigOverrideRow,
} from '@/app/trading-config-overrides';
import { coreConfig, rotationConfig } from '@/app/trading-schedule-dispatch';
import { resolveBook } from '@/app/routes/trading-routes-helpers';
import { resolveUserLlmConnection } from '@/app/routes/free-tier-rotation';
import { executeBotOrInline } from '@/app/routes/inline-bot-execution';
import { ensureEventPlansSchema, getEventPlan } from '@/app/trading-event-plans';
import { selectResearch } from './trading-strategy-research';
import { isEventIntent, parseStudioReply, stripBotFences, studioPrompt } from './trading-strategy-studio-prompt';
import { respondEventStudioTurn, equityForBook } from './trading-event-plan-routes';

const logger = createChildLogger({ module: 'trading-strategy-lab-routes' });

/** The trading-analyst bot (reason-only, inline on the api) — drafts configs from prose. */
const TRADING_AGENT_ID = 'a0000000-0000-0000-0000-000000000046';
const botClient = new BotNodeClient(createRegistryEndpointResolver());

/** Signed-in caller's OIDC sub, or the trusted sub from an internal service-secret call
 *  (X-Service-Secret + X-OSHAL-User-Sub) — the same precedence as the autopilot routes, so
 *  the trading_* operator tools / Jarvis / the regression CLI can act on the user's behalf. */
function callerSub(req: Request): string | undefined {
  const trusted = getTrustedServiceUserSub(req);
  if (trusted) return trusted;
  const oidc = (req as { oidc?: { isAuthenticated?: () => boolean; user?: { sub?: string; oid?: string } } }).oidc;
  if (oidc?.isAuthenticated?.()) return oidc.user?.sub || oidc.user?.oid;
  return (req as { userSub?: string }).userSub;
}

/**
 * The knob + formula reference the Strategy Lab tab renders — kept beside the routes so it ships
 * with the code it describes. Formulas quote algorithms.ts / portfolio.ts verbatim; if those
 * change, update this table in the same commit (the UI shows exactly this).
 */
const KNOBS_REFERENCE = {
  kinds: [
    { key: 'rotation', label: 'Rotation (production shape)', what: 'Every cadence, rank the whole universe and hold the top-N positive scores; sell dropouts, rebalance survivors toward goal weight. Protective exits run daily.' },
    { key: 'ensemble', label: 'Ensemble scan', what: 'Every session, score every name with the multi-timeframe ensemble; buy the highest-conviction BUYs (sized within caps), sell technical SELLs, bench the cold.' },
  ],
  knobs: [
    { key: 'posture', what: 'The risk-policy preset — every cap and stop below comes from it.', values: Object.entries(RISK_POLICIES).map(([k, p]) => ({ posture: k, maxPerNamePct: p.maxPerNamePct, maxSectorPct: p.maxSectorPct, maxDeployedPct: p.maxDeployedPct, maxPositions: p.maxPositions, stopLossPct: p.stopLossPct, takeProfitPct: p.takeProfitPct, dailyLossHaltPct: p.dailyLossHaltPct, trailArmPct: p.trailArmPct, trailGivebackPct: p.trailGivebackPct, maxDrawdownPct: p.maxDrawdownPct })) },
    { key: 'corePct', what: 'Percent of starting equity parked in coreSymbol at walk start and never rotated — the "SPY core" ballast. The armed production blend is 60.' },
    { key: 'takeProfitPct', what: 'Overrides the posture take-profit. The 2026-07-10 sweep left it UNSET for the armed rotation (tp dial mattered for the scan sleeve, not the rotation).' },
    { key: 'rank', what: 'Rotation ranking: gravity (mass×proximity displacement), momentum (20d gap vs SMA), ensemble (weighted algo vote score), blend (z-scored momentum+gravity average). Sweep #3: gravity best (Sharpe 2.36).' },
    { key: 'cadenceDays', what: 'Trading days between rotation rebalances. Armed config: 1 (daily).' },
    { key: 'topN', what: 'Leaderboard size the rotation holds. Armed config: 12.' },
    { key: 'weighting', what: 'conviction = score share of the sleeve budget (capped at per-name %); equal = budget / topN.' },
    { key: 'universe', what: 'Ticker list; empty = the default ~140-name universe (snapshotted on every run so regressions replay the same names).' },
    { key: 'warmupDays', what: 'Sessions consumed before the first decision — rankUniverse needs 60+ closes.' },
    { key: 'windowDays', what: 'Calendar-day lookback for a backtest fetch (~780 ≈ 2 years of sessions).' },
    { key: 'earningsGateDays', what: 'Earnings blackout in sessions (0 = off; rotation only): a name printing within the window is excluded from the leaderboard — never bought, and a held printing name drops off and is sold (the live TRADING_EARNINGS_GATE as a lab permutation). Calendar data exists from 2026-06-25, so backtests before that are ungated — the forward walk is the honest A/B.' },
  ],
  formulas: [
    { algo: 'momentum', formula: 'gap = (close − SMA20) / SMA20 → direction = sign(gap), confidence = min(1, |gap| × 12)', source: 'algorithms.ts' },
    { algo: 'gravity', formula: 'displacement d = Σ over masses (mass × proximity pull toward each attractor); direction = sign(d), confidence = min(1, |d| × 2)', source: 'algorithms.ts (deriveMasses + displacement, ADR-054)' },
    { algo: 'donchian', formula: 'close > 20d high → up @ 0.7 confidence; close < 20d low → down @ 0.7', source: 'algorithms.ts' },
    { algo: 'meanrev', formula: 'RSI(14) < 35 → up, > 65 → down; confidence scales with RSI distance from the band', source: 'algorithms.ts' },
    { algo: 'ensemble vote', formula: 'score = Σ(dir × confidence × algoWeight) / Σ weights → BUY above +threshold, SELL below −threshold, else HOLD', source: 'algorithms.ts ensemble()' },
    { algo: 'multi-timeframe', formula: 'decideSymbol = weighted vote across 1Day / 1Week / 3Month views; the higher-timeframe regime gate blocks buying into a falling trend', source: 'multi-timeframe.ts' },
    { algo: 'sizing', formula: 'sizeEntry: qty from confidence-scaled budget, clamped by per-name %, per-sector %, max-deployed %, max positions, and the daily-loss / drawdown halts', source: 'portfolio.ts' },
    { algo: 'protective exits', formula: 'stop-loss: price ≤ entry × (1 − stop%); take-profit: price ≥ entry × (1 + tp%); trailing: once up trailArm%, exit on trailGiveback% off the peak', source: 'portfolio.ts exitsToRun + trailingExits' },
  ],
  honestLimits: 'Daily bars only (5-min/1-hour exit legs not modeled) · fills at session close · no slippage/commission (~0.2%/round-trip bar applies before believing an edge) · SIP historical tape with IEX fallback.',
};

/** Prompt for the draft endpoint — the bot fills the SAME knobs the form exposes, nothing else. */
function draftPrompt(text: string): string {
  return [
    'You translate a trader\'s plain-English strategy description into the OSHAL Strategy Lab config.',
    'Answer with EXACTLY ONE fenced json block, nothing else:',
    '```json',
    '{ "name": "short human name", "description": "one-sentence restatement",',
    '  "config": { "kind": "rotation"|"ensemble", "posture": "conservative"|"balanced"|"aggressive"|"active",',
    '    "corePct": 0-90, "coreSymbol": "SPY", "takeProfitPct": number|null,',
    '    "rank": "gravity"|"momentum"|"ensemble"|"blend", "cadenceDays": 1-63, "topN": 1-64,',
    '    "weighting": "conviction"|"equal", "universe": [], "warmupDays": 80, "windowDays": 780 } }',
    '```',
    'Rules: pick the closest honest mapping; do not invent knobs; leave universe [] for the default',
    'unless specific tickers are named; null takeProfitPct unless the trader asked for one.',
    '',
    'THE TRADER SAID:',
    text,
  ].join('\n');
}

/** One-line human summary of a strategy config (the confirm dialog + log row body). */
function knobSummary(c: StrategyConfig, applyPct: number): string {
  const eff = effectiveCorePct(c, applyPct);
  if (c.kind === 'blend') {
    const comps = (c.components ?? []).map((x) => `${x.weightPct}% ${x.name}`).join(' + ');
    return `blend ${comps} · core ${eff}% ${c.coreSymbol}${applyPct < 100 ? ` (designed ${c.corePct}%, applied at ${applyPct}%)` : ''}`
      + ' · exits: most-conservative component · universes: per component';
  }
  const rot = c.kind === 'rotation' ? `rotation ${c.rank}/${c.cadenceDays}d/top${c.topN}/${c.weighting}` : 'ensemble scan';
  return `${rot} · posture ${c.posture} · core ${eff}% ${c.coreSymbol}${applyPct < 100 ? ` (designed ${c.corePct}%, applied at ${applyPct}%)` : ''}`
    + ` · tp ${c.takeProfitPct == null ? 'posture-default' : c.takeProfitPct + '%'}`
    + ` · universe ${c.universe.length ? c.universe.length + ' pinned' : 'default (' + DEFAULT_UNIVERSE.length + ', tracks expansions)'}`;
}

/**
 * @description Resolves `{strategyId, weightPct}` blend component references into embedded config
 * snapshots (owner-scoped). Embedding at create time is deliberate: editing a source strategy
 * later never silently mutates a blend — the blend you backtested is the blend you run.
 * @param pool - Postgres pool.
 * @param sub - Owner sub.
 * @param raw - The untrusted config body.
 * @returns The config with components embedded (untouched when not a blend / already embedded).
 */
async function resolveBlendRefs(pool: Parameters<typeof getStrategy>[0], sub: string, raw: unknown): Promise<unknown> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (r.kind !== 'blend' || !Array.isArray(r.components)) return raw;
  const components = [];
  for (const c of r.components) {
    const cc = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
    if (cc.config || !cc.strategyId) { components.push(cc); continue; }
    const src = await getStrategy(pool, sub, String(cc.strategyId));
    if (!src) throw new Error(`blend component strategy ${String(cc.strategyId)} not found`);
    if ((src.config as { kind?: string }).kind !== 'rotation') throw new Error(`"${src.name}" is not a rotation strategy — blends take rotation components only`);
    components.push({ name: src.name, weightPct: cc.weightPct, config: src.config });
  }
  return { ...r, components };
}

/** The ready-to-paste strategy-log.md row an apply/revert returns (the log discipline, UI path). */
function logRowMarkdown(action: 'APPLIED' | 'REVERTED', row: ConfigOverrideRow | null, note: string): string {
  const now = new Date();
  const day = now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const hm = now.toLocaleTimeString('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit' });
  if (action === 'REVERTED' || !row) {
    return `### ${day} (~${hm} CT) — Strategy Library REVERT: profile back on env defaults${row ? ` (was "${row.strategyName}" @ ${row.applyPct}%)` : ''}\n`
      + `Applied via the Strategy Lab UI (audit: trading_config_overrides).${note ? ` Note: ${note}` : ''}`;
  }
  return `### ${day} (~${hm} CT) — Strategy Library APPLY: "${row.strategyName}" @ ${row.applyPct}% of profile\n`
    + `- ${knobSummary(row.config, row.applyPct)}\n`
    + `- Applied via the Strategy Lab UI; overrides env knobs on the TARGETED BOOK until reverted (audit: trading_config_overrides).${note ? `\n- Note: ${note}` : ''}`;
}

/** What the book runs when NO override is active — the production-baseline side of the comparison.
 *  Takes the book's KIND so a live book shows TRADING_RISK_POSTURE_LIVE, not the paper posture
 *  (surface-audit 2026-09-03: the baseline panel showed paper knobs for the live book). */
function envDefaultsSummary(kind: 'paper' | 'live' = 'paper'): Record<string, unknown> {
  const pol = riskPolicy(kind);
  const rot = rotationConfig(null);
  const core = coreConfig(null);
  return {
    posture: pol.posture,
    takeProfitPct: pol.takeProfitPct,
    rotation: rot,
    core: { targetPct: core.targetPct, symbols: [...core.perSymbolPct.entries()].map(([s, p]) => `${s}:${p}`).join(',') },
    universeCount: DEFAULT_UNIVERSE.length,
  };
}

/**
 * @description Builds the /api/trading/lab router.
 * @param ctx - App context (pool + orchestrator for the inline draft bot).
 * @returns Express router.
 */
export function createTradingStrategyLabRoutes(ctx: AppContext): Router {
  const router = Router();
  const pool = ctx.pool;

  const sub = (req: Request, res: Response): string | null => {
    const s = callerSub(req);
    if (!s) { res.status(401).json({ error: 'unauthenticated' }); return null; }
    return s;
  };
  const fail = (res: Response, err: unknown, code = 500): void => {
    const message = (err as Error).message || String(err);
    logger.error({ err }, 'lab route failed');
    res.status(code).json({ error: 'lab_error', message });
  };

  /** GET /knobs — the knob + formula reference the UI renders. */
  router.get('/knobs', (_req: Request, res: Response) => { res.json(KNOBS_REFERENCE); });

  /** GET /strategies — the caller's strategies with latest metrics + forward tallies, plus the
   *  TRUTH about application: appliedOn = the book refs whose ACTIVE override snapshots came from
   *  this strategy (the stored 'armed' status is a lab-lifecycle label, not an application fact —
   *  it once read as "this is what production runs" while nothing was applied anywhere). */
  router.get('/strategies', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    try {
      await ensureLabSchema(pool);
      const strategies = await listStrategies(pool, s);
      const applied = (await pool.query(
        `SELECT o.strategy_id, b.ref FROM trading_config_overrides o
           JOIN oshal_trading_books b ON b.book_id = o.book_id AND b.user_sub = o.user_sub
          WHERE o.user_sub = $1 AND o.active AND o.strategy_id IS NOT NULL`, [s])).rows;
      const refsByStrategy = new Map<string, string[]>();
      for (const r of applied) {
        const k = String(r.strategy_id);
        refsByStrategy.set(k, [...(refsByStrategy.get(k) ?? []), String(r.ref)]);
      }
      res.json({ strategies: strategies.map((st) => ({ ...st, appliedOn: refsByStrategy.get(st.id) ?? [] })) });
    } catch (err) { fail(res, err); }
  });

  /** POST /strategies — create a variation. Body: { name, description?, config }. */
  router.post('/strategies', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    const b = (req.body || {}) as { name?: string; description?: string; config?: unknown };
    const name = String(b.name || '').trim().slice(0, 80);
    if (!name) { res.status(400).json({ error: 'name_required' }); return; }
    try {
      await ensureLabSchema(pool);
      const config = normalizeConfig(await resolveBlendRefs(pool, s, b.config));
      const row = await createStrategy(pool, s, name, String(b.description || '').slice(0, 500), config);
      logger.info({ sub: s, strategyId: row.id, name, kind: config.kind }, 'strategy created');
      res.status(201).json({ strategy: row });
    } catch (err) {
      const msg = (err as Error).message || '';
      if (msg.includes('duplicate key')) { res.status(409).json({ error: 'name_taken', message: `A strategy named "${name}" already exists.` }); return; }
      fail(res, err, msg.includes('universe') || msg.includes('takeProfitPct') || msg.includes('blend') || msg.includes('rotation strategy') ? 400 : 500);
    }
  });

  /** GET /strategies/:id — one strategy + its runs + forward curve points. */
  router.get('/strategies/:id', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    try {
      const strategy = await requireStrategy(pool, s, String(req.params.id));
      const [runs, fwd] = await Promise.all([listRuns(pool, s, strategy.id), getForwardState(pool, s, strategy.id)]);
      res.json({ strategy, runs, forward: fwd ? { asOf: fwd.asOf, points: fwd.points } : null });
    } catch (err) { fail(res, err, (err as Error).message === 'strategy not found' ? 404 : 500); }
  });

  /** PATCH /strategies/:id — rename / describe / lifecycle / re-knob (config change resets forward + baseline). */
  router.patch('/strategies/:id', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    const b = (req.body || {}) as { name?: string; description?: string; status?: string; config?: unknown };
    try {
      const patch: Parameters<typeof updateStrategy>[3] = {};
      if (b.name !== undefined) patch.name = String(b.name).trim().slice(0, 80);
      if (b.description !== undefined) patch.description = String(b.description).slice(0, 500);
      if (b.status !== undefined) {
        if (!['candidate', 'armed', 'retired'].includes(String(b.status))) { res.status(400).json({ error: 'bad_status' }); return; }
        patch.status = b.status as 'candidate' | 'armed' | 'retired';
      }
      if (b.config !== undefined) patch.config = normalizeConfig(await resolveBlendRefs(pool, s, b.config));
      const row = await updateStrategy(pool, s, String(req.params.id), patch);
      if (!row) { res.status(404).json({ error: 'not_found' }); return; }
      res.json({ strategy: row, note: b.config !== undefined ? 'config changed — forward walk reset, baseline unpinned (run a new backtest)' : undefined });
    } catch (err) { fail(res, err, 400); }
  });

  /** DELETE /strategies/:id — remove a variation (runs + state cascade). */
  router.delete('/strategies/:id', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    try { res.json({ deleted: await deleteStrategy(pool, s, String(req.params.id)) }); }
    catch (err) { fail(res, err); }
  });

  /** POST /strategies/:id/backtest — run + persist (10–30 s for a 2-year, 140-name walk). */
  router.post('/strategies/:id/backtest', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    const windowDays = Number((req.body || {}).windowDays) || undefined;
    // startCash sizes the walk to a real account (whole shares: $20K and $500K do not trade alike).
    // Bounded so a typo cannot request a nonsensical book; absent = the $100K reference.
    const rawCash = Number((req.body || {}).startCash);
    if (Number.isFinite(rawCash) && rawCash !== 0 && (rawCash < 1_000 || rawCash > 100_000_000)) { res.status(400).json({ error: 'start_cash_out_of_range', message: 'startCash must be between $1,000 and $100,000,000.' }); return; }
    const startCash = Number.isFinite(rawCash) && rawCash >= 1_000 ? Math.round(rawCash) : undefined;
    try {
      const strategy = await requireStrategy(pool, s, String(req.params.id));
      const run = await backtestStrategy(pool, s, strategy, windowDays, startCash);
      res.status(run.status === 'failed' ? 502 : 201).json({ run });
    } catch (err) { fail(res, err, (err as Error).message === 'strategy not found' ? 404 : 500); }
  });

  /** POST /strategies/:id/baseline — pin a run as the regression baseline. Body: { runId }. */
  router.post('/strategies/:id/baseline', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    const runId = String((req.body || {}).runId || '');
    try {
      await requireStrategy(pool, s, String(req.params.id));
      const run = await getRun(pool, s, runId);
      if (!run || run.strategyId !== String(req.params.id) || run.kind !== 'backtest' || run.status !== 'ok') {
        res.status(400).json({ error: 'bad_baseline', message: 'runId must be an OK backtest run of this strategy' }); return;
      }
      await setBaseline(pool, s, String(req.params.id), runId);
      res.json({ ok: true });
    } catch (err) { fail(res, err, (err as Error).message === 'strategy not found' ? 404 : 500); }
  });

  /** POST /strategies/:id/forward — advance this strategy's forward walk now. */
  router.post('/strategies/:id/forward', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    try {
      const strategy = await requireStrategy(pool, s, String(req.params.id));
      res.json(await forwardStepStrategy(pool, s, strategy));
    } catch (err) { fail(res, err, (err as Error).message === 'strategy not found' ? 404 : 500); }
  });

  /** POST /strategies/:id/regression — pinned-window regression for this strategy now. */
  router.post('/strategies/:id/regression', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    try {
      const strategy = await requireStrategy(pool, s, String(req.params.id));
      res.json(await regressStrategy(pool, s, strategy));
    } catch (err) { fail(res, err, (err as Error).message === 'strategy not found' ? 404 : 500); }
  });

  /** GET /runs/:runId — one run WITH its equity curve. */
  router.get('/runs/:runId', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    try {
      const run = await getRun(pool, s, String(req.params.runId));
      if (!run) { res.status(404).json({ error: 'not_found' }); return; }
      res.json({ run });
    } catch (err) { fail(res, err); }
  });

  /** POST /forward-run — forward-step ALL of the caller's strategies (leg/CLI entry). */
  router.post('/forward-run', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    try { res.json({ results: await runForwardAll(pool, s) }); }
    catch (err) { fail(res, err); }
  });

  /** POST /regression-run — regression-run ALL baselined strategies (leg/CLI entry). */
  router.post('/regression-run', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    try {
      const verdicts = await runRegressionsAll(pool, s);
      res.json({ verdicts, drifted: verdicts.filter((v) => v.status === 'drifted').length, failed: verdicts.filter((v) => v.status === 'failed').length });
    } catch (err) { fail(res, err); }
  });

  /** GET /strategies/:id/notes — the strategy's dated notes/lessons journal, newest first. */
  router.get('/strategies/:id/notes', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    try {
      await requireStrategy(pool, s, String(req.params.id));
      res.json({ notes: await listNotes(pool, s, String(req.params.id)) });
    } catch (err) { fail(res, err, (err as Error).message === 'strategy not found' ? 404 : 500); }
  });

  /** POST /strategies/:id/notes — append a note. Body: { body, kind?: note|lesson|decision }. */
  router.post('/strategies/:id/notes', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    const b = (req.body || {}) as { body?: string; kind?: string };
    const body = String(b.body || '').trim();
    if (!body) { res.status(400).json({ error: 'body_required' }); return; }
    const kind = (['note', 'lesson', 'decision'].includes(String(b.kind)) ? String(b.kind) : 'note') as 'note' | 'lesson' | 'decision';
    try {
      await requireStrategy(pool, s, String(req.params.id));
      res.status(201).json({ note: await addNote(pool, s, String(req.params.id), kind, body) });
    } catch (err) { fail(res, err, (err as Error).message === 'strategy not found' ? 404 : 500); }
  });

  /** DELETE /strategies/:id/notes/:noteId — remove one note. */
  router.delete('/strategies/:id/notes/:noteId', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    try { res.json({ deleted: await deleteNote(pool, s, String(req.params.id), String(req.params.noteId)) }); }
    catch (err) { fail(res, err); }
  });

  /** GET /apply — what THE SELECTED BOOK currently runs: its active override (or null = env
   *  defaults), the env-default summary for comparison, and the apply/revert audit history
   *  (history stays user-wide — it is the audit trail across books). */
  router.get('/apply', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    try {
      const book = await resolveBook(pool, s, (req.query.book as string | undefined) ?? (req.query.mode as string | undefined));
      const [active, history] = await Promise.all([getActiveOverride(pool, s, book.bookId), listOverrideHistory(pool, s)]);
      res.json({
        book: book.ref,
        active,
        activeSummary: active ? knobSummary(active.config, active.applyPct) : null,
        envDefaults: envDefaultsSummary(book.kind),
        history,
      });
    } catch (err) { fail(res, err); }
  });

  /** POST /strategies/:id/apply — switch the profile onto this strategy (part or all of it).
   *  Body: { applyPct?: 1-100 (default 100 = as designed), note?, confirm: true }. The confirm
   *  guard exists because this changes what the LIVE autopilot trades on its next fire. */
  router.post('/strategies/:id/apply', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    const b = (req.body || {}) as { applyPct?: number; note?: string; confirm?: boolean; book?: string };
    if (b.confirm !== true) {
      res.status(400).json({ error: 'confirm_required', message: 'Applying changes what the autopilot trades on its next fire — resend with confirm:true.' });
      return;
    }
    const applyPct = Math.round(Math.max(1, Math.min(100, Number(b.applyPct) || 100)));
    try {
      // ADR-134: apply targets THE SELECTED BOOK (query.book rides every surface fetch; body.book
      // wins when set). Without this the lab was the last two-book surface — Apply silently cloned
      // to the legacy paper+live pair no matter which account the operator was looking at
      // ("the software only works for a single account and everything else is mangled").
      const book = await resolveBook(pool, s, b.book ?? (req.query.book as string | undefined) ?? (req.query.mode as string | undefined));
      const strategy = await requireStrategy(pool, s, String(req.params.id));
      const config = normalizeConfig(strategy.config); // defensive re-normalize of the stored knobs
      const row = await applyOverride(pool, s, {
        strategyId: strategy.id, strategyName: strategy.name, config, applyPct, note: String(b.note || ''),
        bookId: book.bookId, bookRef: book.ref,
      });
      if (strategy.status !== 'armed') await updateStrategy(pool, s, strategy.id, { status: 'armed' });
      const policy = riskPolicy(book.kind, policyOverrideOf(row));
      logger.info({ sub: s, strategy: strategy.name, applyPct, bookRef: book.ref }, 'strategy APPLIED to book');
      res.status(201).json({
        override: row,
        effective: {
          summary: knobSummary(config, applyPct),
          posture: policy.posture,
          takeProfitPct: policy.takeProfitPct,
          corePct: effectiveCorePct(config, applyPct),
          rotation: rotationConfig(row),
          universeCount: config.universe.length || DEFAULT_UNIVERSE.length,
        },
        logRow: logRowMarkdown('APPLIED', row, String(b.note || '')),
      });
    } catch (err) { fail(res, err, (err as Error).message === 'strategy not found' ? 404 : 500); }
  });

  /** POST /apply/revert — the SELECTED book back to env defaults on the next fire. Body: { note?, book? }. */
  router.post('/apply/revert', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    try {
      const book = await resolveBook(pool, s, String((req.body || {}).book ?? req.query.book ?? req.query.mode ?? '') || undefined);
      const row = await revertOverride(pool, s, book.bookId, book.ref);
      res.json({
        reverted: !!row,
        was: row,
        envDefaults: envDefaultsSummary(),
        logRow: row ? logRowMarkdown('REVERTED', row, String((req.body || {}).note || '')) : null,
      });
    } catch (err) { fail(res, err); }
  });

  /** POST /draft — the trading-analyst turns prose into knobs; returned for review, never saved. */
  router.post('/draft', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    const text = String((req.body || {}).text || '').trim().slice(0, 4000);
    if (!text) { res.status(400).json({ error: 'text_required' }); return; }
    try {
      const byoLlmConnection = await resolveUserLlmConnection(ctx.pool, s);
      const result = await executeBotOrInline(ctx, botClient, TRADING_AGENT_ID, {
        text: draftPrompt(text), taskId: `trading-lab-draft-${s}`, workspaceFolderId: `trading-${s}`,
        agentId: TRADING_AGENT_ID, agenticMode: true, direct: true, userSub: s, byoLlmConnection,
      });
      const raw = String(result.response || '');
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const parsed = JSON.parse((fenced ? fenced[1] : raw.match(/\{[\s\S]*\}/)?.[0] ?? '').trim()) as { name?: string; description?: string; config?: unknown };
      const config = normalizeConfig(parsed.config);
      res.json({ name: String(parsed.name || 'Drafted strategy').slice(0, 80), description: String(parsed.description || '').slice(0, 500), config });
    } catch (err) { fail(res, err, 502); }
  });

  /**
   * POST /studio — the Strategy Studio. Talk to the quant analyst: it grounds the design in cited
   * research, drafts a StrategyConfig, INJECTS it into the library as a candidate, backtests it (~2y),
   * and narrates the result with sources. Body: { message, strategyId? }. With a strategyId this is a
   * REFINEMENT turn (workflow-assistant contract): the current config feeds the prompt and the SAME
   * row is updated (forward walk + baseline reset by the store) — no duplicate strategies per turn.
   * A reply with no parseable JSON comes back as { needsInput: true, message } — the bot's clarifying
   * question — never a 502. Applying to the live profile stays a manual, confirm-gated action.
   */
  router.post('/studio', async (req: Request, res: Response) => {
    const s = sub(req, res); if (!s) return;
    const b = (req.body || {}) as { message?: string; strategyId?: string; book?: string; mode?: string };
    const message = String(b.message || '').trim().slice(0, 4000);
    if (!message) { res.status(400).json({ error: 'message_required' }); return; }
    try {
      await ensureLabSchema(pool);
      // ADR-136 D6: an EVENT playbook (an IPO, a listing day) is not a rotation — branch BEFORE the
      // rotation flow. The book is the SELECTED account, resolved query-first (the 2026-09-03
      // paper-routing class); a strategyId that names an event plan is a refinement of that plan.
      const book = await resolveBook(pool, s, (req.query.book as string | undefined) ?? b.book ?? (req.query.mode as string | undefined) ?? b.mode);
      await ensureEventPlansSchema(pool);
      const existingPlan = b.strategyId ? await getEventPlan(pool, s, String(b.strategyId)) : null;
      if (existingPlan || isEventIntent(message)) {
        await respondEventStudioTurn(ctx, res, { sub: s, book, message, existingPlan, botClient, agentId: TRADING_AGENT_ID });
        return;
      }
      // A stale/foreign strategyId degrades to a fresh design turn — same as the workflow assist.
      const existing = b.strategyId ? await getStrategy(pool, s, String(b.strategyId)) : null;
      if (existing && (existing.config as { kind?: string }).kind === 'blend') {
        res.json({
          needsInput: true,
          message: `"${existing.name}" is a BLEND — its components are embedded snapshots, so I can't re-knob it conversationally. Refine one of its component strategies here and rebuild the blend in the Strategy Lab, or say what you want and I'll design it as a new strategy.`,
        });
        return;
      }
      const findings = selectResearch(message, 4);
      const byoLlmConnection = await resolveUserLlmConnection(ctx.pool, s);
      const result = await executeBotOrInline(ctx, botClient, TRADING_AGENT_ID, {
        text: studioPrompt(message, findings, existing ? { name: existing.name, config: existing.config } : undefined),
        taskId: `trading-studio-${s}`, workspaceFolderId: `trading-${s}`,
        agentId: TRADING_AGENT_ID, agenticMode: true, direct: true, userSub: s, byoLlmConnection,
      });
      const raw = String(result.response || '').trim();
      let parsed: ReturnType<typeof parseStudioReply>;
      try {
        parsed = parseStudioReply(raw, findings);
      } catch {
        const question = stripBotFences(raw);
        if (!question) throw new Error('empty bot reply');
        res.json({ needsInput: true, message: question.slice(0, 2000) });
        return;
      }
      // On a refinement turn the stored config backfills anything the bot omitted — the contract is
      // "change only what was asked", so omission means keep.
      const config = existing
        ? normalizeConfig({ ...(existing.config as unknown as Record<string, unknown>), ...(parsed.config as Record<string, unknown> || {}) })
        : normalizeConfig(parsed.config);
      let row;
      if (existing) {
        row = await updateStrategy(pool, s, existing.id, { description: parsed.description, config });
        if (!row) throw new Error('strategy not found');
      } else {
        const name = `${parsed.name} · ${Date.now().toString(36).slice(-4)}`.slice(0, 80);
        row = await createStrategy(pool, s, name, parsed.description, config);
      }
      // Size the Studio's backtest to the SELECTED account's real equity (null → the $100K reference):
      // whole-share sizing means a $20K account and a $500K account do not trade the same design alike.
      const equity = await equityForBook(s, book);
      const run = await backtestStrategy(pool, s, row, config.windowDays, equity != null && equity >= 1000 ? Math.round(equity) : undefined);
      const full = await getRun(pool, s, run.id);
      const active = existing ? await getActiveOverride(pool, s) : null;
      logger.info({ sub: s, strategyId: row.id, refined: !!existing, kind: config.kind, cites: parsed.citations.map((c) => c.id) }, 'studio strategy designed + backtested');
      res.json({
        strategyId: row.id, name: row.name, refined: !!existing, config, knobSummary: knobSummary(config, 100),
        hypothesis: parsed.hypothesis, narration: parsed.narration,
        citations: parsed.citations.map((c) => ({ id: c.id, name: c.name, authors: c.authors, year: c.year, journal: c.journal, url: c.url })),
        metrics: run.metrics, curve: full?.curve ?? [], runStatus: run.status,
        appliedNote: active && active.strategyId === row.id
          ? 'This strategy is currently APPLIED to your profile — the live override keeps its previous snapshot; re-apply it (confirm-gated) to trade the refined knobs.'
          : undefined,
      });
    } catch (err) { fail(res, err, 502); }
  });

  return router;
}
