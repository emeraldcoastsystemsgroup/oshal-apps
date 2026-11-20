/**
 * Remaining-schedule playoff simulation — the season-level objective (spec 2.2.5).
 *
 * Rest-of-season expected points (SV) treats every point the same regardless of where a team sits
 * in the standings. Spec 2.2.5's season objective is P(making the playoffs): simulate the remaining
 * regular-season fixtures from the current standings (from an ESPN league read or a hand-typed
 * table), using each team's weekly lineup distribution (mean and spread from `fantasy-winprob.ts`),
 * breaking record ties by total points scored (pointsFor).
 *
 * DETERMINISTIC COMMON RANDOM NUMBERS + ANTITHETIC VARIATES. Standard normal draws Z[trial][week][team]
 * are generated once from a fixed seeded PRNG (Mulberry32 + Box-Muller, paired +Z / -Z) and reused
 * across the baseline and every candidate claim or trade. Reusing the same draws eliminates Monte
 * Carlo comparison noise between baseline and counterfactual so small variance-driven shifts in
 * P(playoffs) are crisp, reproducible, and fast.
 *
 * WHY THIS DIFFERS FROM SV. A team two games behind the playoff cutline needs wins AND often a
 * pointsFor surge, so its P(playoffs) rises with higher-variance (boom/bust) upside even at a modest
 * cost in expected points. A bubble or favoured team trying to protect a playoff spot benefits from
 * steadier scoring and suffers from bust weeks.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — deterministic seeded remaining-schedule playoff simulator (CRN + antithetic variates) over current standings and weekly lineup moments, reporting baseline P(playoffs), counterfactual P(playoffs), and delta for waiver claims and two-sided trades, plus ESPN mTeam/mSettings standings extraction.
 *
 * @module fantasy-playoff-sim
 */

import { optimiseLineup, type FantasyPlayer } from './fantasy-scoring';
import type { SeasonPlan } from './fantasy-season';
import { spreadFor, type LineupMoments, type WeighedPlayer } from './fantasy-winprob';

/** Default deterministic seed for reproducible playoff simulation. */
export const DEFAULT_SIM_SEED = 0x5f3759df;
/** Default trial count (even, paired into antithetic +Z / -Z draws). */
export const DEFAULT_SIM_TRIALS = 4000;

/** A team's current regular-season record and cumulative points scored. */
export interface TeamStanding {
  teamId: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
}

/** A team participating in the league simulation. */
export interface SimTeam {
  teamId: number;
  name: string;
  rosterIds: number[];
}

/** One scheduled regular-season matchup. */
export interface SimFixture {
  week: number;
  homeTeamId: number;
  awayTeamId: number | null;
}

/** Inputs needed to build a deterministic remaining-schedule playoff simulator. */
export interface PlayoffSimConfig {
  plan: SeasonPlan;
  teams: SimTeam[];
  targetTeamId: number;
  standings: TeamStanding[];
  fixtures: SimFixture[];
  currentWeek: number;
  playoffStart: number | null;
  playoffTeams: number | null;
  /** Optional completed-week point totals per player id for spread shrinkage. */
  history?: Map<number, number[]>;
  /** Optional custom weekly spread override per player (primarily for deterministic analysis). */
  spreadOverride?: (playerId: number, week: number, mean: number) => number | undefined;
  trials?: number;
  seed?: number;
}

/** Playoff probability before and after a single roster move (claim or trade). */
export interface PlayoffImpact {
  playoffProb: number;
  playoffProbWith: number;
  playoffDelta: number;
}

/** Metadata and availability status returned on every management board. */
export interface PlayoffSimAvailability {
  available: boolean;
  reason: string | null;
  baselineProb: number | null;
  playoffTeams: number | null;
  playoffTeamsAssumed: boolean;
  remainingWeeks: number[];
  fixturesSimulated: number;
  trials: number;
  seed: number;
}

/** Simulator handle reused across every waiver claim or trade proposal in one request. */
export interface PlayoffSimulator {
  info: PlayoffSimAvailability;
  evaluateRoster: (nextTargetRosterIds: number[]) => PlayoffImpact | null;
  evaluateTrade: (nextTargetRosterIds: number[], partnerTeamId: number, nextPartnerRosterIds: number[]) => PlayoffImpact | null;
  evaluateMoments: (overrides: Map<number, LineupMoments[]>) => number | null;
}

/** Internal indexed fixture for zero-allocation trial loops. */
interface IndexedFixture {
  weekIdx: number;
  homeIdx: number;
  awayIdx: number;
}

/** Default playoff field size when a league does not declare one explicitly. */
export function defaultPlayoffTeams(teamCount: number): number {
  if (teamCount >= 12) return 6;
  if (teamCount >= 8) return 4;
  return Math.max(1, Math.floor(teamCount / 2));
}

/** Mulberry32 deterministic 32-bit PRNG returning uniform values in (0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) + 0.5) / 4294967296;
  };
}

/** Build a flat antithetic standard-normal draw matrix [trial][week][team]. */
function buildNormalMatrix(trials: number, numWeeks: number, numTeams: number, seed: number): Float64Array {
  const stride = numWeeks * numTeams;
  const out = new Float64Array(trials * stride);
  const rand = mulberry32(seed);
  const pairs = Math.floor(trials / 2);
  for (let p = 0; p < pairs; p += 1) {
    const baseA = (p * 2) * stride;
    const baseB = (p * 2 + 1) * stride;
    for (let i = 0; i < stride; i += 2) {
      const u1 = Math.max(rand(), 1e-12);
      const u2 = rand();
      const r = Math.sqrt(-2 * Math.log(u1));
      const theta = 2 * Math.PI * u2;
      const z0 = r * Math.cos(theta);
      const z1 = r * Math.sin(theta);
      out[baseA + i] = z0;
      out[baseB + i] = -z0;
      if (i + 1 < stride) {
        out[baseA + i + 1] = z1;
        out[baseB + i + 1] = -z1;
      }
    }
  }
  return out;
}

/** Extract current team standings and playoff field size from an ESPN mSettings+mTeam payload. */
export function extractEspnStandings(body: any): { standings: TeamStanding[]; playoffTeams: number | null } {
  const rawTeams = Array.isArray(body?.teams) ? body.teams : [];
  const rawPlayoff = Number(body?.settings?.scheduleSettings?.playoffTeamCount);
  const playoffTeams = Number.isInteger(rawPlayoff) && rawPlayoff >= 1 && rawPlayoff < rawTeams.length ? rawPlayoff : null;
  const standings: TeamStanding[] = [];
  for (const t of rawTeams) {
    const teamId = Number(t?.id);
    const ov = t?.record?.overall;
    if (!Number.isInteger(teamId) || !ov || typeof ov !== 'object') continue;
    const wins = Number(ov.wins);
    const losses = Number(ov.losses);
    const ties = Number(ov.ties ?? 0);
    const pointsFor = Number(ov.pointsFor ?? t?.points ?? 0);
    if (!Number.isFinite(wins) || !Number.isFinite(losses)) continue;
    standings.push({
      teamId,
      wins: Math.max(0, Math.trunc(wins)),
      losses: Math.max(0, Math.trunc(losses)),
      ties: Number.isFinite(ties) ? Math.max(0, Math.trunc(ties)) : 0,
      pointsFor: Number.isFinite(pointsFor) ? round2(pointsFor) : 0,
    });
  }
  return { standings, playoffTeams };
}

/** Compute weekly (mean, sd) moments for one roster across the specified regular-season weeks. */
function rosterWeeklyMoments(
  rosterIds: number[], weeks: number[], config: PlayoffSimConfig,
): LineupMoments[] {
  const ids = [...new Set(rosterIds)];
  const cached = new Map<string, LineupMoments>();
  return weeks.map((week) => {
    const sig = config.plan.signature?.(week) ?? null;
    if (sig !== null && cached.has(sig)) return cached.get(sig) as LineupMoments;
    const pool: FantasyPlayer[] = [];
    for (const id of ids) {
      const p = config.plan.playerFor(id, week);
      if (p) pool.push(p);
    }
    const lineup = optimiseLineup(pool, config.plan.slots, config.plan.scoring);
    let mean = 0;
    let variance = 0;
    for (const a of lineup.starters) {
      const wp = a.player as WeighedPlayer;
      const hist = config.history?.get(wp.playerId) ?? wp.pointsHistory;
      const customSd = config.spreadOverride?.(wp.playerId, week, a.points);
      const sd = customSd !== undefined && Number.isFinite(customSd)
        ? Math.max(customSd, 0)
        : spreadFor(a.points, wp.defaultPositionId, hist);
      mean += a.points;
      variance += sd * sd;
    }
    const moments = { mean: round2(mean), sd: round2(Math.sqrt(variance)) };
    if (sig !== null) cached.set(sig, moments);
    return moments;
  });
}

/** Determine whether team a finishes strictly ahead of team b in playoff tiebreakers. */
function finishesAhead(
  aIdx: number, bIdx: number, wins: Float64Array, games: Float64Array, pf: Float64Array, teamIds: number[],
): boolean {
  const pctA = games[aIdx] > 0 ? wins[aIdx] / games[aIdx] : 0;
  const pctB = games[bIdx] > 0 ? wins[bIdx] / games[bIdx] : 0;
  if (Math.abs(pctA - pctB) > 1e-12) return pctA > pctB;
  if (Math.abs(pf[aIdx] - pf[bIdx]) > 1e-9) return pf[aIdx] > pf[bIdx];
  return teamIds[aIdx] < teamIds[bIdx];
}

/** Unavailable simulator stub carrying an explicit human-readable reason. */
function unavailableSimulator(reason: string, trials: number, seed: number): PlayoffSimulator {
  const info: PlayoffSimAvailability = {
    available: false, reason, baselineProb: null, playoffTeams: null,
    playoffTeamsAssumed: false, remainingWeeks: [], fixturesSimulated: 0, trials, seed,
  };
  return {
    info,
    evaluateRoster: () => null,
    evaluateTrade: () => null,
    evaluateMoments: () => null,
  };
}

/** Resolve starting standings for every team, or explain why they are missing. */
function resolveStandings(
  teams: SimTeam[], standings: TeamStanding[], currentWeek: number,
): { ok: true; list: TeamStanding[] } | { ok: false; reason: string } {
  if (!standings.length) {
    if (currentWeek <= 1) {
      return { ok: true, list: teams.map((t) => ({ teamId: t.teamId, wins: 0, losses: 0, ties: 0, pointsFor: 0 })) };
    }
    return {
      ok: false,
      reason: 'Current standings are needed to simulate P(playoffs) after week 1 (add standings in League setup or link an ESPN league).',
    };
  }
  const byId = new Map(standings.map((s) => [s.teamId, s]));
  const missing = teams.filter((t) => !byId.has(t.teamId));
  if (missing.length) {
    return {
      ok: false,
      reason: `Current standings are missing for ${missing.length} team${missing.length === 1 ? '' : 's'}, so P(playoffs) was not simulated.`,
    };
  }
  return { ok: true, list: teams.map((t) => byId.get(t.teamId) as TeamStanding) };
}

/** Run the full Monte Carlo trial loop over pre-generated CRN draws. */
function runTrials(
  numTeams: number, numWeeks: number, trials: number, targetIdx: number, playoffTeams: number,
  teamIds: number[], baseW: Float64Array, baseG: Float64Array, basePf: Float64Array,
  fixtures: IndexedFixture[], z: Float64Array, means: Float64Array, sds: Float64Array,
): number {
  const wins = new Float64Array(numTeams);
  const games = new Float64Array(numTeams);
  const pf = new Float64Array(numTeams);
  const scores = new Float64Array(numWeeks * numTeams);
  const stride = numWeeks * numTeams;
  let made = 0;

  for (let s = 0; s < trials; s += 1) {
    wins.set(baseW);
    games.set(baseG);
    pf.set(basePf);
    const zOff = s * stride;
    for (let k = 0; k < stride; k += 1) {
      scores[k] = means[k] + sds[k] * z[zOff + k];
    }
    for (let f = 0; f < fixtures.length; f += 1) {
      const { weekIdx, homeIdx, awayIdx } = fixtures[f];
      const sh = scores[weekIdx * numTeams + homeIdx];
      const sa = scores[weekIdx * numTeams + awayIdx];
      pf[homeIdx] += sh;
      pf[awayIdx] += sa;
      games[homeIdx] += 1;
      games[awayIdx] += 1;
      if (sh > sa) wins[homeIdx] += 1;
      else if (sa > sh) wins[awayIdx] += 1;
      else { wins[homeIdx] += 0.5; wins[awayIdx] += 0.5; }
    }
    let ahead = 0;
    for (let i = 0; i < numTeams; i += 1) {
      if (i === targetIdx) continue;
      if (finishesAhead(i, targetIdx, wins, games, pf, teamIds)) {
        ahead += 1;
        if (ahead >= playoffTeams) break;
      }
    }
    if (ahead < playoffTeams) made += 1;
  }
  return round4(made / trials);
}

/** Map remaining regular-season fixtures to compact team/week indices. */
function indexFixtures(
  config: PlayoffSimConfig, idxById: Map<number, number>,
): { regWeeks: number[]; fixtures: IndexedFixture[] } {
  const regWeeks = config.plan.weeks
    .map((w) => w.week)
    .filter((w) => w >= config.currentWeek && (config.playoffStart === null || w < config.playoffStart));
  const weekIdxByNum = new Map(regWeeks.map((w, i) => [w, i]));
  const fixtures: IndexedFixture[] = [];
  for (const f of config.fixtures) {
    if (f.awayTeamId === null || f.awayTeamId === f.homeTeamId) continue;
    const weekIdx = weekIdxByNum.get(f.week);
    const homeIdx = idxById.get(f.homeTeamId);
    const awayIdx = idxById.get(f.awayTeamId);
    if (weekIdx !== undefined && homeIdx !== undefined && awayIdx !== undefined) {
      fixtures.push({ weekIdx, homeIdx, awayIdx });
    }
  }
  return { regWeeks, fixtures };
}

/** Precompute flat [week][team] baseline moment buffers for every team. */
function buildBaseMoments(
  config: PlayoffSimConfig, regWeeks: number[],
): { baseMeans: Float64Array; baseSds: Float64Array } {
  const numTeams = config.teams.length;
  const numWeeks = regWeeks.length;
  const baseMeans = new Float64Array(numWeeks * numTeams);
  const baseSds = new Float64Array(numWeeks * numTeams);
  config.teams.forEach((team, tIdx) => {
    const mom = rosterWeeklyMoments(team.rosterIds, regWeeks, config);
    for (let wIdx = 0; wIdx < numWeeks; wIdx += 1) {
      baseMeans[wIdx * numTeams + tIdx] = mom[wIdx].mean;
      baseSds[wIdx * numTeams + tIdx] = mom[wIdx].sd;
    }
  });
  return { baseMeans, baseSds };
}

/** Pack starting standings into flat Float64Arrays for trial resets. */
function packStandings(list: TeamStanding[]): { baseW: Float64Array; baseG: Float64Array; basePf: Float64Array } {
  const baseW = new Float64Array(list.length);
  const baseG = new Float64Array(list.length);
  const basePf = new Float64Array(list.length);
  list.forEach((st, i) => {
    baseW[i] = st.wins + 0.5 * st.ties;
    baseG[i] = st.wins + st.losses + st.ties;
    basePf[i] = st.pointsFor;
  });
  return { baseW, baseG, basePf };
}

/**
 * @description Build a deterministic remaining-schedule playoff simulator for a league.
 * @param config - Season plan, rosters, standings, schedule fixtures and playoff cutline.
 * @returns A reusable simulator reporting availability and evaluating claims and trades.
 */
export function createPlayoffSimulator(config: PlayoffSimConfig): PlayoffSimulator {
  const rawTrials = Number.isInteger(config.trials) && (config.trials as number) >= 2 ? (config.trials as number) : DEFAULT_SIM_TRIALS;
  const trials = rawTrials % 2 === 0 ? rawTrials : rawTrials + 1;
  const seed = Number.isInteger(config.seed) ? (config.seed as number) : DEFAULT_SIM_SEED;
  if (config.teams.length < 2) return unavailableSimulator('At least two teams are required to simulate P(playoffs).', trials, seed);

  const idxById = new Map(config.teams.map((t, i) => [t.teamId, i]));
  const targetIdx = idxById.get(config.targetTeamId);
  if (targetIdx === undefined) return unavailableSimulator('Your team was not found in the league teams list.', trials, seed);

  const { regWeeks, fixtures } = indexFixtures(config, idxById);
  if (!fixtures.length) return unavailableSimulator('No remaining regular-season fixtures are scheduled to simulate P(playoffs).', trials, seed);

  const standingState = resolveStandings(config.teams, config.standings, config.currentWeek);
  if (!standingState.ok) return unavailableSimulator(standingState.reason, trials, seed);

  const explicitPlayoffs = config.playoffTeams !== null && Number.isInteger(config.playoffTeams)
    && config.playoffTeams >= 1 && config.playoffTeams < config.teams.length;
  const playoffTeams = explicitPlayoffs ? (config.playoffTeams as number) : defaultPlayoffTeams(config.teams.length);
  const numTeams = config.teams.length;
  const numWeeks = regWeeks.length;
  const teamIds = config.teams.map((t) => t.teamId);
  const { baseW, baseG, basePf } = packStandings(standingState.list);
  const { baseMeans, baseSds } = buildBaseMoments(config, regWeeks);
  const z = buildNormalMatrix(trials, numWeeks, numTeams, seed);
  const workMeans = new Float64Array(baseMeans.length);
  const workSds = new Float64Array(baseSds.length);

  const evaluateMoments = (overrides: Map<number, LineupMoments[]>): number => {
    workMeans.set(baseMeans);
    workSds.set(baseSds);
    for (const [teamId, mom] of overrides) {
      const tIdx = idxById.get(teamId);
      if (tIdx === undefined) continue;
      for (let wIdx = 0; wIdx < Math.min(numWeeks, mom.length); wIdx += 1) {
        workMeans[wIdx * numTeams + tIdx] = mom[wIdx].mean;
        workSds[wIdx * numTeams + tIdx] = mom[wIdx].sd;
      }
    }
    return runTrials(numTeams, numWeeks, trials, targetIdx, playoffTeams, teamIds, baseW, baseG, basePf, fixtures, z, workMeans, workSds);
  };

  const baselineProb = evaluateMoments(new Map());
  const info: PlayoffSimAvailability = {
    available: true, reason: null, baselineProb, playoffTeams, playoffTeamsAssumed: !explicitPlayoffs,
    remainingWeeks: regWeeks, fixturesSimulated: fixtures.length, trials, seed,
  };
  return {
    info, evaluateMoments,
    evaluateRoster(nextTargetRosterIds: number[]): PlayoffImpact {
      const withProb = evaluateMoments(new Map([[config.targetTeamId, rosterWeeklyMoments(nextTargetRosterIds, regWeeks, config)]]));
      return { playoffProb: baselineProb, playoffProbWith: withProb, playoffDelta: round4(withProb - baselineProb) };
    },
    evaluateTrade(nextTargetRosterIds: number[], partnerTeamId: number, nextPartnerRosterIds: number[]): PlayoffImpact {
      const withProb = evaluateMoments(new Map([
        [config.targetTeamId, rosterWeeklyMoments(nextTargetRosterIds, regWeeks, config)],
        [partnerTeamId, rosterWeeklyMoments(nextPartnerRosterIds, regWeeks, config)],
      ]));
      return { playoffProb: baselineProb, playoffProbWith: withProb, playoffDelta: round4(withProb - baselineProb) };
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
