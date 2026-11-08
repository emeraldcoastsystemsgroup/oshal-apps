/**
 * Sports Quant read and confirm-gated action routes — /api/sports-edge/quant/*.
 *
 * Read endpoints (`GET /quant/tonight`, `GET /quant/roi`, `GET /quant/game`) execute strictly
 * read-only queries so native reader admission never encounters a write. Any state change (recording
 * or refreshing a forward-test pick, or following a team) lives on `POST /quant/record-pick`, which
 * the manifest binds with `defaultAuthMode: ask` and `requiresApproval: true`.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — read-only tonight edge scan, outlier-trimmed ROI and CLV robustness check (WINNERS_REMOVED = 0.2), single-game quant breakdown, and confirm-gated forward-test pick/follow endpoint.
 *
 * @module sports-quant
 */

import type { Request, Response, Router } from 'express';
import type { Pool } from 'pg';
import { createChildLogger } from '@/shared/logger';
import { callerSub } from '@/app/routes/trading-routes-helpers';
import { devigTwoWay, impliedProbability, type League } from './sports-odds';
import { classify, ENSEMBLE_STRATEGY, MIN_GRADED, rollup } from './sports-ledger';
import type { EdgeCandidate, MarketQuote } from './sports-ensemble';
import type { GamePreview } from './sports-preview';
import { summariseMovement } from './sports-line-history';
import { observationsFor } from './sports-line-store';
import {
  followTeam, gradedRows, listFollowed, predictionsForEvent, readPreview, readSettings,
  type FollowedTeam, type GradedRow,
} from './sports-store';
import { FOLLOWED_GAMES_HORIZON_DAYS, followedGames, previewFor } from './sports-refresh';

const log = createChildLogger({ module: 'sports-quant' });
const LEAGUES: League[] = ['nfl', 'nba', 'ncaaf'];

/** Fraction of winning calls removed in the outlier-trimmed robustness pass. */
export const WINNERS_REMOVED = 0.2;

export interface SampleMetrics {
  graded: number;
  wins: number;
  losses: number;
  winRatePct: number;
  netUnits: number;
  roiPct: number;
  brier: number;
  marketBrier: number;
  brierAdvantage: number;
  clvSamples: number;
  meanClvPct: number;
}

export interface RobustnessReport {
  strategy: string;
  holdsUp: boolean;
  verdict: 'HOLDS_UP' | 'PROMISING_OUTLIER_DEPENDENT' | 'TOO_LITTLE_HISTORY' | 'FAILING';
  stakeAllowed: boolean;
  removedTopWinners: number;
  winnersRemovedFraction: number;
  minGradedRequired: number;
  full: SampleMetrics;
  withoutTopWinners: SampleMetrics;
  reason: string;
}

function round2(n: number): number { return Math.round((Number(n) || 0) * 100) / 100; }
function round4(n: number): number { return Math.round((Number(n) || 0) * 10000) / 10000; }

/** Summarises one sample of settled predictions into ROI, Brier, and CLV figures. */
export function summariseSample(rows: GradedRow[]): SampleMetrics {
  const graded = rows.length;
  if (!graded) {
    return {
      graded: 0, wins: 0, losses: 0, winRatePct: 0, netUnits: 0, roiPct: 0,
      brier: 0, marketBrier: 0, brierAdvantage: 0, clvSamples: 0, meanClvPct: 0,
    };
  }
  const wins = rows.filter((r) => r.won).length;
  const netUnits = round2(rows.reduce((s, r) => s + (Number(r.pnlUnits) || 0), 0));
  const brier = round4(rows.reduce((s, r) => s + r.brier, 0) / graded);
  const marketBrier = round4(rows.reduce((s, r) => s + r.marketBrier, 0) / graded);
  const clvRows = rows.filter((r) => r.clv !== null && Number.isFinite(r.clv));
  const meanClv = clvRows.length ? clvRows.reduce((s, r) => s + (r.clv as number), 0) / clvRows.length : 0;
  return {
    graded, wins, losses: graded - wins,
    winRatePct: round2((wins / graded) * 100),
    netUnits, roiPct: round2((netUnits / graded) * 100),
    brier, marketBrier, brierAdvantage: round4(marketBrier - brier),
    clvSamples: clvRows.length, meanClvPct: round2(meanClv * 100),
  };
}

/** Removes the top 20% most profitable winning rows to test whether edge survives without outliers. */
export function trimTopWinners(rows: GradedRow[], fraction = WINNERS_REMOVED): { trimmed: GradedRow[]; removed: number } {
  const winIdx = rows
    .map((row, idx) => ({ idx, pnl: Number(row.pnlUnits) || 0, won: row.won }))
    .filter((x) => x.won || x.pnl > 0)
    .sort((a, b) => b.pnl - a.pnl);
  if (!winIdx.length) return { trimmed: [...rows], removed: 0 };
  const removeCount = Math.min(winIdx.length, Math.max(1, Math.ceil(winIdx.length * fraction)));
  const drop = new Set(winIdx.slice(0, removeCount).map((x) => x.idx));
  return { trimmed: rows.filter((_, idx) => !drop.has(idx)), removed: removeCount };
}

/** Evaluates full-sample and outlier-trimmed robustness for one strategy's settled calls. */
export function evaluateLedgerRobustness(rows: GradedRow[], strategy = ENSEMBLE_STRATEGY): RobustnessReport {
  const scoped = rows.filter((r) => r.strategy === strategy);
  const full = summariseSample(scoped);
  const { trimmed, removed } = trimTopWinners(scoped, WINNERS_REMOVED);
  const withoutTopWinners = summariseSample(trimmed);
  const gate = classify(rollup(strategy, scoped));
  if (full.graded < MIN_GRADED) {
    return {
      strategy, holdsUp: false, verdict: 'TOO_LITTLE_HISTORY', stakeAllowed: false,
      removedTopWinners: removed, winnersRemovedFraction: WINNERS_REMOVED, minGradedRequired: MIN_GRADED,
      full, withoutTopWinners,
      reason: `${full.graded} of ${MIN_GRADED} settled calls graded (${full.netUnits}u, ${full.roiPct}% ROI); forward-testing at zero live stake.`,
    };
  }
  if (!gate.mayStake || full.netUnits <= 0) {
    return {
      strategy, holdsUp: false, verdict: 'FAILING', stakeAllowed: false,
      removedTopWinners: removed, winnersRemovedFraction: WINNERS_REMOVED, minGradedRequired: MIN_GRADED,
      full, withoutTopWinners,
      reason: `${gate.reason} Net units: ${full.netUnits}u (${full.roiPct}% ROI).`,
    };
  }
  const outlierDependent = withoutTopWinners.netUnits <= 0
    || withoutTopWinners.brier >= withoutTopWinners.marketBrier
    || (withoutTopWinners.clvSamples > 0 && withoutTopWinners.meanClvPct <= 0);
  if (outlierDependent) {
    return {
      strategy, holdsUp: false, verdict: 'PROMISING_OUTLIER_DEPENDENT', stakeAllowed: false,
      removedTopWinners: removed, winnersRemovedFraction: WINNERS_REMOVED, minGradedRequired: MIN_GRADED,
      full, withoutTopWinners,
      reason: `Full sample is +${full.netUnits}u (+${full.roiPct}% ROI), but removing top ${removed} winners flips return to ${withoutTopWinners.netUnits}u (${withoutTopWinners.roiPct}% ROI).`,
    };
  }
  return {
    strategy, holdsUp: true, verdict: 'HOLDS_UP', stakeAllowed: gate.mayStake,
    removedTopWinners: removed, winnersRemovedFraction: WINNERS_REMOVED, minGradedRequired: MIN_GRADED,
    full, withoutTopWinners,
    reason: `Holds up across ${full.graded} graded calls (+${full.roiPct}% ROI, +${full.meanClvPct}% CLV) and stays +${withoutTopWinners.netUnits}u (+${withoutTopWinners.roiPct}% ROI) without top ${removed} winners.`,
  };
}

function formatQuoteMetrics(quote: MarketQuote) {
  const mlFair = Number.isFinite(quote.homeMoneyline as number) && Number.isFinite(quote.awayMoneyline as number)
    ? devigTwoWay(quote.homeMoneyline as number, quote.awayMoneyline as number) : null;
  const spHome = quote.homeSpreadOdds ?? (Number.isFinite(quote.homeSpread as number) ? -110 : undefined);
  const spAway = quote.awaySpreadOdds ?? (Number.isFinite(quote.homeSpread as number) ? -110 : undefined);
  const spFair = Number.isFinite(spHome as number) && Number.isFinite(spAway as number)
    ? devigTwoWay(spHome as number, spAway as number) : null;
  return {
    book: quote.book || 'consensus',
    homeSpread: quote.homeSpread ?? null,
    homeSpreadOdds: spHome ?? null,
    awaySpreadOdds: spAway ?? null,
    homeMoneyline: quote.homeMoneyline ?? null,
    awayMoneyline: quote.awayMoneyline ?? null,
    total: quote.total ?? null,
    moneylineVigPct: mlFair && Number.isFinite(mlFair.overround) ? round2((mlFair.overround - 1) * 100) : null,
    spreadVigPct: spFair && Number.isFinite(spFair.overround) ? round2((spFair.overround - 1) * 100) : null,
    fairHomeWinProbPct: mlFair && Number.isFinite(mlFair.home) ? round2(mlFair.home * 100) : null,
    fairAwayWinProbPct: mlFair && Number.isFinite(mlFair.away) ? round2(mlFair.away * 100) : null,
  };
}

function formatEdgeCandidate(e: EdgeCandidate, minEdgePoints: number, stakeAllowed: boolean) {
  const rawImplied = impliedProbability(e.price);
  const kellyPct = round2(e.kelly * 100);
  return {
    market: e.market,
    side: e.side,
    selection: e.selection,
    price: e.price,
    rawImpliedProbPct: Number.isFinite(rawImplied) ? round2(rawImplied * 100) : null,
    deVigMarketProbPct: round2(e.marketProbability * 100),
    modelProbPct: round2(e.modelProbability * 100),
    edgePct: round2(e.edge * 100),
    expectedValueUnits: round4(e.expectedValue),
    quarterKellyPct: kellyPct,
    paperUnitSizing: kellyPct,
    liveStakePct: stakeAllowed ? kellyPct : 0,
    meetsMinEdge: e.edge * 100 >= minEdgePoints,
  };
}

async function enrichStoredPreview(
  pool: Pool, preview: GamePreview, generatedAt: string, minEdgePoints: number, stakeAllowed: boolean, followedSet: Set<string>,
) {
  const obs = await observationsFor(pool, preview.eventId).catch(() => []);
  const move = obs.length ? summariseMovement(obs, preview.date) : null;
  const kickMs = Date.parse(preview.date);
  const hoursAway = Number.isFinite(kickMs) ? round2((kickMs - Date.now()) / 3600000) : null;
  const edges = (preview.edges || []).map((e) => formatEdgeCandidate(e, minEdgePoints, stakeAllowed));
  return {
    eventId: preview.eventId,
    league: preview.league,
    gameDate: preview.date,
    tonight: hoursAway !== null && hoursAway >= -6 && hoursAway <= 30,
    hoursUntilKickoff: hoursAway,
    matchup: `${preview.awayTeam} @ ${preview.homeTeam}`,
    homeTeam: preview.homeTeam,
    awayTeam: preview.awayTeam,
    followedMatch: followedSet.has(`${preview.league}:${preview.homeTeam}`) || followedSet.has(`${preview.league}:${preview.awayTeam}`),
    previewBuilt: true,
    generatedAt,
    bookQuote: formatQuoteMetrics(preview.quote || {}),
    model: {
      projectedMargin: preview.line.projectedMargin,
      homeWinProbPct: round2(preview.line.homeWinProbability * 100),
      awayWinProbPct: round2((1 - preview.line.homeWinProbability) * 100),
      espnHomeWinProbPct: preview.context?.espnHomeWinPct ?? null,
      carriedOver: preview.carriedOver,
    },
    edges,
    topEdge: edges[0] || null,
    hasActionableEdge: edges.some((e) => e.meetsMinEdge),
    lineMovement: move ? {
      observations: obs.length,
      firstSpread: move.firstSeen?.homeSpread ?? null,
      latestSpread: move.latest?.homeSpread ?? null,
      netSpreadMove: move.netSpreadMove,
      openerConfidence: move.openerConfidence,
      openerLeadHours: move.openerLeadHours,
    } : null,
  };
}

async function readUpcomingPreviews(pool: Pool, leagueFilter: League | null, horizonDays: number) {
  const fromIso = new Date(Date.now() - 6 * 3600000).toISOString();
  const toIso = new Date(Date.now() + horizonDays * 86400000).toISOString();
  const r = leagueFilter
    ? await pool.query(
      `SELECT payload, generated_at FROM sports_previews
       WHERE league = $1 AND (game_date IS NULL OR (game_date >= $2 AND game_date <= $3))
       ORDER BY game_date ASC LIMIT 40`,
      [leagueFilter, fromIso, toIso],
    )
    : await pool.query(
      `SELECT payload, generated_at FROM sports_previews
       WHERE game_date IS NULL OR (game_date >= $1 AND game_date <= $2)
       ORDER BY game_date ASC LIMIT 40`,
      [fromIso, toIso],
    );
  return r.rows.map((row: any) => ({
    preview: row.payload as GamePreview,
    generatedAt: new Date(row.generated_at).toISOString(),
  }));
}

async function collectUnbuiltSchedule(pool: Pool, followed: FollowedTeam[], horizonDays: number, seenIds: Set<string>) {
  if (!followed.length) return [];
  const { rows } = await followedGames(pool, followed, horizonDays).catch(() => ({ rows: [] }));
  return rows.filter((r) => !seenIds.has(r.game.eventId)).map((r) => {
    const matched = followed.find((f) => f.team === r.game.homeTeam || f.team === r.game.awayTeam);
    return {
      eventId: r.game.eventId,
      league: matched?.league || 'nfl',
      gameDate: r.game.date,
      tonight: Math.abs(Date.parse(r.game.date) - Date.now()) <= 30 * 3600000,
      hoursUntilKickoff: round2((Date.parse(r.game.date) - Date.now()) / 3600000),
      matchup: `${r.game.awayTeam} @ ${r.game.homeTeam}`,
      homeTeam: r.game.homeTeam,
      awayTeam: r.game.awayTeam,
      followedMatch: true,
      previewBuilt: false,
      generatedAt: null,
      bookQuote: formatQuoteMetrics(r.game.quote || {}),
      model: null,
      edges: [],
      topEdge: null,
      hasActionableEdge: false,
      lineMovement: null,
    };
  });
}

function requireSub(req: Request, res: Response): string | null {
  const sub = callerSub(req);
  if (!sub) { res.status(401).json({ error: 'authentication required' }); return null; }
  return sub;
}

function optionalLeague(raw: unknown): League | null {
  const v = String(raw || '').trim().toLowerCase() as League;
  return LEAGUES.includes(v) ? v : null;
}

async function handleQuantTonight(pool: Pool, req: Request, res: Response): Promise<void> {
  const sub = requireSub(req, res);
  if (!sub) return;
  try {
    const leagueFilter = optionalLeague(req.query.league);
    const horizonDays = Math.min(Math.max(Number(req.query.days) || FOLLOWED_GAMES_HORIZON_DAYS, 1), 21);
    const [followed, userSettings, settled] = await Promise.all([
      listFollowed(pool, sub), readSettings(pool, sub), gradedRows(pool),
    ]);
    const minEdgePoints = Number(userSettings.minEdgePoints) || 2;
    const robustness = evaluateLedgerRobustness(settled, ENSEMBLE_STRATEGY);
    const followedSet = new Set(followed.map((f) => `${f.league}:${f.team}`));
    const stored = await readUpcomingPreviews(pool, leagueFilter, horizonDays);
    const builtGames = await Promise.all(stored.map((s) =>
      enrichStoredPreview(pool, s.preview, s.generatedAt, minEdgePoints, robustness.stakeAllowed, followedSet)));
    const scopedBuilt = followed.length && !leagueFilter && builtGames.some((g) => g.followedMatch)
      ? builtGames.filter((g) => g.followedMatch) : builtGames;
    const seenIds = new Set(scopedBuilt.map((g) => g.eventId));
    const unbuilt = req.query.storedOnly === '1' ? [] : await collectUnbuiltSchedule(pool, followed, horizonDays, seenIds);
    const games = [...scopedBuilt, ...unbuilt].sort((a, b) =>
      ((b.topEdge?.edgePct ?? -999) - (a.topEdge?.edgePct ?? -999)) || String(a.gameDate).localeCompare(String(b.gameDate)));
    res.json({
      followedTeams: followed,
      minEdgePoints,
      horizonDays,
      scorecardGate: {
        verdict: robustness.verdict,
        holdsUp: robustness.holdsUp,
        stakeAllowed: robustness.stakeAllowed,
        fullRoiPct: robustness.full.roiPct,
        withoutTopWinnersRoiPct: robustness.withoutTopWinners.roiPct,
      },
      gamesWithEdgeCount: games.filter((g) => (g.edges?.length || 0) > 0).length,
      games,
    });
  } catch (err) {
    log.error({ err }, 'quant tonight failed');
    res.status(500).json({ error: 'could not evaluate upcoming game edges' });
  }
}

async function handleQuantRoi(pool: Pool, req: Request, res: Response): Promise<void> {
  if (!requireSub(req, res)) return;
  try {
    const strategy = String(req.query.strategy || ENSEMBLE_STRATEGY).trim() || ENSEMBLE_STRATEGY;
    const [settled, recentRes] = await Promise.all([
      gradedRows(pool),
      pool.query(
        `SELECT strategy, league, event_id, game_date, home_team, away_team, market, side, selection,
                model_prob, market_prob, edge, price_at_pick, spread_at_pick, stake_fraction,
                settled, won, brier, market_brier, clv, pnl_units, graded_at
         FROM sports_predictions WHERE strategy = $1
         ORDER BY COALESCE(graded_at, created_at) DESC LIMIT 25`,
        [strategy],
      ),
    ]);
    const strategies = [...new Set([ENSEMBLE_STRATEGY, ...settled.map((r) => r.strategy)])];
    const comparisons = strategies.map((name) => evaluateLedgerRobustness(settled, name));
    const primary = comparisons.find((c) => c.strategy === strategy) || evaluateLedgerRobustness(settled, strategy);
    res.json({
      strategy, robustness: primary, comparisons,
      recentPicks: recentRes.rows.map((r: any) => ({
        eventId: r.event_id, league: r.league, gameDate: r.game_date,
        matchup: `${r.away_team} @ ${r.home_team}`, market: r.market, side: r.side, selection: r.selection,
        modelProbPct: round2(Number(r.model_prob) * 100),
        marketProbPct: round2(Number(r.market_prob) * 100),
        edgePct: round2(Number(r.edge) * 100),
        priceAtPick: r.price_at_pick === null ? null : Number(r.price_at_pick),
        settled: Boolean(r.settled), won: r.won === null ? null : Boolean(r.won),
        clvPct: r.clv === null ? null : round2(Number(r.clv) * 100),
        pnlUnits: r.pnl_units === null ? null : round2(Number(r.pnl_units)),
      })),
    });
  } catch (err) {
    log.error({ err }, 'quant roi failed');
    res.status(500).json({ error: 'could not evaluate ledger ROI and robustness' });
  }
}

async function handleQuantGame(pool: Pool, req: Request, res: Response): Promise<void> {
  const sub = requireSub(req, res);
  if (!sub) return;
  try {
    const eventId = String(req.query.eventId || '').trim();
    const teamQuery = String(req.query.team || '').trim().toUpperCase();
    let target = eventId ? await readPreview(pool, eventId) : null;
    if (!target && teamQuery) {
      const upcoming = await readUpcomingPreviews(pool, optionalLeague(req.query.league), 21);
      target = upcoming.find((u) => u.preview.homeTeam === teamQuery || u.preview.awayTeam === teamQuery) || null;
    }
    if (!target) { res.status(404).json({ error: 'no stored preview matched that eventId or team' }); return; }
    const [followed, userSettings, settled, calls] = await Promise.all([
      listFollowed(pool, sub), readSettings(pool, sub), gradedRows(pool), predictionsForEvent(pool, target.preview.eventId),
    ]);
    const robustness = evaluateLedgerRobustness(settled, ENSEMBLE_STRATEGY);
    const followedSet = new Set(followed.map((f) => `${f.league}:${f.team}`));
    const enriched = await enrichStoredPreview(
      pool, target.preview, target.generatedAt, Number(userSettings.minEdgePoints) || 2, robustness.stakeAllowed, followedSet,
    );
    res.json({
      ...enriched, signals: target.preview.line.signals, adjustments: target.preview.line.adjustments,
      availability: target.preview.line.availability, ratings: target.preview.ratings,
      context: target.preview.context, registeredCalls: calls,
    });
  } catch (err) {
    log.error({ err }, 'quant game failed');
    res.status(500).json({ error: 'could not read game quant breakdown' });
  }
}

async function handleQuantRecordPick(pool: Pool, req: Request, res: Response): Promise<void> {
  const sub = requireSub(req, res);
  if (!sub) return;
  const action = String(req.body?.action || 'record_pick').trim();
  const league = optionalLeague(req.body?.league);
  if (!league) { res.status(400).json({ error: 'league must be one of nfl, nba, ncaaf' }); return; }
  try {
    if (action === 'follow_team') {
      const team = String(req.body?.team || '').trim().toUpperCase();
      const teamId = String(req.body?.teamId || '').trim();
      if (!team || !teamId) { res.status(400).json({ error: 'team and teamId are required' }); return; }
      await followTeam(pool, sub, { league, team, teamId, displayName: req.body?.displayName || null });
      res.json({ ok: true, action, followed: { league, team, teamId }, teams: await listFollowed(pool, sub) });
      return;
    }
    const eventId = String(req.body?.eventId || '').trim();
    if (!eventId) { res.status(400).json({ error: 'eventId is required to record a forward-test pick' }); return; }
    const built = await previewFor(pool, league, eventId, true);
    if (!built) { res.status(404).json({ error: 'that game is not on the upcoming schedule' }); return; }
    const calls = await predictionsForEvent(pool, eventId);
    res.json({
      ok: true, action: 'record_pick', eventId, league,
      matchup: `${built.preview.awayTeam} @ ${built.preview.homeTeam}`,
      registeredCalls: calls.length, edges: built.preview.edges,
      note: 'Forward-test calls registered in the ledger; Phase 1 places zero real-money orders.',
    });
  } catch (err) {
    log.error({ err }, 'quant record-pick failed');
    res.status(502).json({ error: 'could not record forward-test pick', detail: (err as Error).message });
  }
}

/** Mounts read-only quant inspection routes and the confirm-gated forward-test action route. */
export function registerQuantRoutes(router: Router, pool: Pool): void {
  router.get('/quant/tonight', (req, res) => handleQuantTonight(pool, req, res));
  router.get('/quant/roi', (req, res) => handleQuantRoi(pool, req, res));
  router.get('/quant/game', (req, res) => handleQuantGame(pool, req, res));
  router.post('/quant/record-pick', (req, res) => handleQuantRecordPick(pool, req, res));
}
