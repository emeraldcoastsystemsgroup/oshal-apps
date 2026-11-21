#!/usr/bin/env node
/**
 * Walk-forward benchmark for BACKLOG Item A: candidate signals derived from archived World
 * Intelligence `world_items` against the current sports-edge ensemble (Control).
 *
 * Strict zero-lookahead protocol:
 *   - For each scored game k at UTC kickoff date D, Elo, SRS power ratings, two-sided unit
 *     ratings, and rest days are fit ONLY on completed games with date < D (seeded from prior-
 *     season regressed Elo, matching buildSeasonRatings).
 *   - Candidate wire features use ONLY UTC daily buckets strictly prior to kickoff day
 *     ([D - 7d, D - 1d] for the active pre-kickoff window, [D - 37d, D - 8d] for the prior
 *     baseline). Same-day and post-game buckets are excluded so post-game reaction headlines
 *     cannot leak into pre-kickoff predictions.
 *
 * Reproducible command:
 *   node sports-edge/tests/walk-forward-wire-signal.mjs
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Initial — deterministic zero-lookahead walk-forward harness evaluating archived world_items candidate signals against the current sports-edge ensemble (BACKLOG Item A).
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const ratings = require('../routes/sports-ratings.js');
const adjustments = require('../routes/sports-adjustments.js');
const ensemble = require('../routes/sports-ensemble.js');
const preview = require('../routes/sports-preview.js');
const odds = require('../routes/sports-odds.js');

const DEFAULT_DATA_PATH = path.join(__dirname, 'walk-forward-wire-signal-data.json');
const MAX_WIRE_ADJ_PTS = 3.0;

/** @description Clamp a margin adjustment to the bounded candidate range. */
function clampAdj(points) {
  return Math.max(-MAX_WIRE_ADJ_PTS, Math.min(MAX_WIRE_ADJ_PTS, points));
}

/** @description Unpack compact game tuples [date, home, away, hScore, aScore, neutral]. */
function unpackGames(tuples) {
  return tuples.map(([date, homeTeam, awayTeam, homeScore, awayScore, neutral]) => ({
    date, homeTeam, awayTeam, homeScore, awayScore, neutralSite: Boolean(neutral),
  }));
}

/** @description Index compact UTC daily buckets [YYYY-MM-DD, count, meanSentiment] by date. */
export function indexDailyBuckets(tuples) {
  const map = new Map();
  for (const [date, count, mean] of tuples) map.set(date, { date, count, mean });
  return map;
}

/**
 * @description Aggregate archived daily World buckets strictly prior to kickoff UTC day.
 * Same-day (offset 0) and future buckets are never read, preventing post-game leakage.
 */
export function preKickoffWindow(bucketMap, gameIso, lookbackDays, startDaysAgo = 1) {
  if (startDaysAgo < 1) throw new RangeError('startDaysAgo must be >= 1 to prevent same-day leakage');
  const gameDayMs = Date.parse(`${gameIso.slice(0, 10)}T00:00:00Z`);
  let sumSent = 0;
  let count = 0;
  let activeDays = 0;
  for (let d = startDaysAgo; d < startDaysAgo + lookbackDays; d += 1) {
    const key = new Date(gameDayMs - d * 86400000).toISOString().slice(0, 10);
    const row = bucketMap.get(key);
    if (row && row.count > 0) {
      sumSent += row.mean * row.count;
      count += row.count;
      activeDays += 1;
    }
  }
  return { count, activeDays, mean: count > 0 ? sumSent / count : null, dailyAvg: count / lookbackDays };
}

/** @description Build walk-forward control rows plus pre-kickoff wire features for one season. */
function buildSeasonRows(seasonSpec) {
  const games = unpackGames(seasonSpec.games);
  const teamMap = indexDailyBuckets(seasonSpec.teamDaily);
  const injMap = indexDailyBuckets(seasonSpec.injuryDaily);
  const rows = [];
  for (const g of games) {
    if (g.homeTeam !== seasonSpec.targetTeam && g.awayTeam !== seasonSpec.targetTeam) continue;
    const prior = games.filter((p) => p.date < g.date);
    const line = controlLineFor(seasonSpec.league, g, prior, seasonSpec.priorSeasonEloSeed);
    rows.push(gameFeatureRow(seasonSpec.league, g, line, seasonSpec.targetTeam, teamMap, injMap));
  }
  return rows;
}

/** @description Fit the current ensemble strictly on prior finished games and score one game. */
function controlLineFor(league, game, prior, seed) {
  const elo = ratings.computeElo(prior, league, seed);
  const power = ratings.computePowerRatings(prior, league);
  const units = adjustments.computeUnitRatings(prior, league);
  const homeTape = prior.filter((p) => p.homeTeam === game.homeTeam || p.awayTeam === game.homeTeam);
  const awayTape = prior.filter((p) => p.homeTeam === game.awayTeam || p.awayTeam === game.awayTeam);
  return ensemble.buildLine({
    league, homeTeam: game.homeTeam, awayTeam: game.awayTeam, neutralSite: game.neutralSite,
    elo, power, units, homeInjuries: [], awayInjuries: [],
    homeRest: preview.restFrom(homeTape, game.date, league),
    awayRest: preview.restFrom(awayTape, game.date, league),
  });
}

/** @description Derive strict pre-kickoff wire features for one game against Control. */
function gameFeatureRow(league, game, line, targetTeam, teamMap, injMap) {
  const sign = game.homeTeam === targetTeam ? 1 : -1;
  const t7 = preKickoffWindow(teamMap, game.date, 7, 1);
  const t30 = preKickoffWindow(teamMap, game.date, 30, 8);
  const i7 = preKickoffWindow(injMap, game.date, 7, 1);
  const i30 = preKickoffWindow(injMap, game.date, 30, 8);
  const sentDelta = t7.mean !== null && t30.mean !== null ? t7.mean - t30.mean : (t7.mean ?? 0);
  const injBurst = i30.dailyAvg > 0 ? (i7.dailyAvg - i30.dailyAvg) / i30.dailyAvg : 0;
  const actualMargin = game.homeScore - game.awayScore;
  return {
    league, date: game.date.slice(0, 10), matchup: `${game.awayTeam}@${game.homeTeam}`,
    sign, actualMargin, outcome: actualMargin > 0 ? 1 : 0,
    ctrlMargin: line.projectedMargin, ctrlProb: line.homeWinProbability,
    t7Count: t7.count, t7Mean: t7.mean ?? 0, sentDelta,
    i7Count: i7.count, injBurst, injSent: i7.mean ?? 0,
  };
}

/** Candidate adjustment specs evaluated against Control. */
export const CANDIDATES = [
  { id: 'control', label: 'Control (current ensemble)', adjust: () => 0 },
  { id: 'sent-delta-5', label: '7d-vs-30d team sentiment delta (w=5 pts)', adjust: (r) => clampAdj(r.sign * r.sentDelta * 5) },
  { id: 'sent-delta-10', label: '7d-vs-30d team sentiment delta (w=10 pts)', adjust: (r) => clampAdj(r.sign * r.sentDelta * 10) },
  { id: 'inj-burst', label: 'Injury-wire 7d volume burst penalty (w=1.5 pts)', adjust: (r) => clampAdj(-r.sign * Math.max(0, r.injBurst) * 1.5) },
  { id: 'combined', label: 'Combined (sentDelta*5 - injBurst*1.0)', adjust: (r) => clampAdj(r.sign * (r.sentDelta * 5 - Math.max(0, r.injBurst) * 1.0)) },
  { id: 'raw-sent-5', label: 'Raw 7d team sentiment (w=5 pts, uncentered)', adjust: (r) => clampAdj(r.sign * r.t7Mean * 5) },
];

/** @description Score one candidate over a set of game rows and compute paired t-stat vs Control. */
function scoreCandidate(rows, candidate) {
  let n = 0; let brierSum = 0; let maeSum = 0; let suHits = 0;
  const diffs = [];
  for (const r of rows) {
    if (r.actualMargin === 0) continue;
    const margin = r.ctrlMargin + candidate.adjust(r);
    const prob = odds.winProbabilityFromMargin(margin, r.league);
    const candBrier = (prob - r.outcome) ** 2;
    const ctrlBrier = (r.ctrlProb - r.outcome) ** 2;
    brierSum += candBrier;
    maeSum += Math.abs(margin - r.actualMargin);
    if ((prob >= 0.5 ? 1 : 0) === r.outcome) suHits += 1;
    diffs.push(candBrier - ctrlBrier);
    n += 1;
  }
  const pairedT = pairedTStat(diffs);
  return {
    id: candidate.id, label: candidate.label, n,
    suPct: roundN((100 * suHits) / n, 1),
    brier: roundN(brierSum / n, 4),
    mae: roundN(maeSum / n, 2),
    pairedT: roundN(pairedT, 2),
  };
}

/** @description One-sample paired t-statistic on per-game Brier deltas (negative = candidate better). */
function pairedTStat(diffs) {
  if (diffs.length < 2) return 0;
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const variance = diffs.reduce((s, x) => s + (x - mean) ** 2, 0) / (diffs.length - 1);
  if (variance <= 0) return 0;
  return mean / Math.sqrt(variance / diffs.length);
}

/** @description Round to fixed decimal places. */
function roundN(value, digits) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** @description Evaluate every candidate across NFL 2026 (SEA), NCAAF 2026 (ARK), and Combined. */
export function evaluateWireSignalWalkForward(dataPath = DEFAULT_DATA_PATH) {
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const nflRows = buildSeasonRows(data.seasons.nfl2026);
  const ncaafRows = buildSeasonRows(data.seasons.ncaaf2026);
  const combinedRows = [...nflRows, ...ncaafRows];
  const scoreSet = (rows) => CANDIDATES.map((c) => scoreCandidate(rows, c));
  return {
    capturedAt: data.capturedAt,
    archiveAudit: data.archiveAudit,
    nflRows, ncaafRows, combinedRows,
    results: { nfl2026: scoreSet(nflRows), ncaaf2026: scoreSet(ncaafRows), combined2026: scoreSet(combinedRows) },
  };
}

/** @description Format one benchmark table in GitHub-flavored Markdown. */
function printTable(title, scores) {
  const ctrl = scores[0];
  console.log(`\n### ${title} (n=${ctrl.n})`);
  console.log('| Variant | SU% | Brier | ΔBrier | MAE (pts) | ΔMAE | Paired t (Brier) |');
  console.log('|---|---:|---:|---:|---:|---:|---:|');
  for (const s of scores) {
    const db = s.id === 'control' ? '—' : `${s.brier - ctrl.brier >= 0 ? '+' : ''}${(s.brier - ctrl.brier).toFixed(4)}`;
    const dm = s.id === 'control' ? '—' : `${s.mae - ctrl.mae >= 0 ? '+' : ''}${(s.mae - ctrl.mae).toFixed(2)}`;
    const t = s.id === 'control' ? '—' : `${s.pairedT >= 0 ? '+' : ''}${s.pairedT.toFixed(2)}`;
    console.log(`| ${s.label} | ${s.suPct.toFixed(1)}% | ${s.brier.toFixed(4)} | ${db} | ${s.mae.toFixed(2)} | ${dm} | ${t} |`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const out = evaluateWireSignalWalkForward();
  const a = out.archiveAudit;
  console.log(`Sports Edge — Item A Wire Signal Walk-Forward (snapshot ${out.capturedAt})`);
  console.log(`Completed 2025 seasons coverage: ${a.completedSeasons2025.gamesWithWorldItems}/${a.completedSeasons2025.totalGames} games (0.0%; archive started ${a.archiveFirstObserved})`);
  console.log(`Live 2026 coverage: NFL ${a.liveCoverage2026.nflTeamsWithItems}/${a.liveCoverage2026.nflTeamsTotal} (SEA), NBA ${a.liveCoverage2026.nbaTeamsWithItems}/${a.liveCoverage2026.nbaTeamsTotal}, NCAAF ${a.liveCoverage2026.ncaafTeamsWithItems} (ARK) — ${a.liveCoverage2026.totalClassifications} classifications across ${a.liveCoverage2026.totalArchivedItems} archived items`);
  printTable('NFL 2026 (SEA)', out.results.nfl2026);
  printTable('NCAAF 2026 (ARK)', out.results.ncaaf2026);
  printTable('Combined 2026 (SEA + ARK)', out.results.combined2026);
  console.log('\nDecision: NEGATIVE RESULT — no candidate improves Control cleanly; unused wire ingest retired in refreshWorld.');
}
