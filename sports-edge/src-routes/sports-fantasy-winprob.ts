/**
 * The objective, when you are behind — win probability instead of projected points.
 *
 * THE SHIPPED OPTIMISER MAXIMISES THE MEAN, AND FOR MOST TEAMS THAT IS WRONG. A fantasy week is not
 * a scoring contest against the field; it is head-to-head against one known opponent. What decides
 * the season is how often you clear THEIR number, so the quantity to maximise is
 *
 *     P(win) = Φ( (μ_you − μ_opp) / √(σ²_you + σ²_opp) )
 *
 * Differentiate that with respect to σ_you and the consequence is not a heuristic, it is arithmetic:
 *
 *   - when μ_you < μ_opp — you are the UNDERDOG — P(win) RISES with your own variance. Start the
 *     boom/bust player. You do not need the average, you need the tail.
 *   - when μ_you > μ_opp — you are FAVOURED — P(win) rises as your variance FALLS. Start the steady
 *     one and refuse the coin flip.
 *
 * That is why this module exists rather than a rule that says "play your studs". A manager whose
 * draft left them with other managers' leftovers who plays the safest lineup every single week is
 * choosing, week after week, the option that most reliably loses to better teams. The mean-maximal
 * lineup is a special case of this one — it is what you get when the two teams are evenly matched.
 *
 * SPREADS ARE A MODELLED PARAMETER AND THIS FILE SAYS SO OUT LOUD. There is no free per-player
 * variance feed anywhere in ESPN's API: the projection is a point estimate and nothing publishes its
 * dispersion. So a player's spread starts from a POSITIONAL PRIOR — a coefficient of variation per
 * position — and is replaced by his own sample deviation as real weekly scores accumulate, shrunk
 * toward the prior while the sample is small. The priors below are stated beliefs about which
 * positions are streaky, NOT measurements, and the ONLY property the recommendation actually leans
 * on is their ORDER (a wide receiver's week is less predictable than a quarterback's). They are
 * exported so they can be overridden and, once the ledger has a season of graded calls, replaced by
 * something measured.
 *
 * INDEPENDENCE IS ASSUMED between the two lineups, which is why the variances add. It is not exactly
 * true — a defence facing an opposing quarterback in the same real game is negatively correlated
 * with him — but the error is second-order next to the effect this module exists to capture, and
 * pretending to model it without a covariance source would be worse than naming the assumption.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — positional spread priors with sample shrinkage, lineup moments, the normal win-probability model, and a lineup search that maximises P(win) rather than the projected total (falling back to the mean-maximal lineup when no opponent is known).
 *
 * @module sports-fantasy-winprob
 */

import {
  applyScoring, isAvailable, optimiseLineup,
  type FantasyPlayer, type LineupSlot, type OptimisedLineup, type ScoringItem,
} from './sports-fantasy-scoring';

/**
 * Coefficient of variation by ESPN `defaultPositionId` — the spread of a week's actual points as a
 * fraction of its projection.
 *
 * PRIORS, NOT MEASUREMENTS. They encode one belief: quarterbacks and kickers are comparatively
 * predictable, receivers and defences are not. Only the ORDER matters to a recommendation; the
 * magnitudes are placeholders to be replaced from the graded ledger. 1 QB, 2 RB, 3 WR, 4 TE, 5 K,
 * 16 D/ST — ESPN's ids, used as opaque keys.
 */
export const POSITION_SPREAD_PRIORS: Record<number, number> = {
  1: 0.38, 2: 0.55, 3: 0.62, 4: 0.65, 5: 0.45, 16: 0.75,
};

/** Coefficient of variation for a position nobody has a prior for. */
export const DEFAULT_SPREAD_PRIOR = 0.60;

/**
 * Floor on a player's spread, in points.
 *
 * Without it a player projected at zero gets σ = 0 and the model treats him as a CERTAINTY of
 * scoring nothing — which would make benching him look risk-free and starting anyone else look
 * risky. Every real player has some chance of a touchdown.
 */
export const MIN_SPREAD_POINTS = 2.0;

/** Sample weight at which a player's own deviation fully replaces the positional prior. */
const SHRINKAGE_WEIGHT = 4;

/**
 * @description The standard normal CDF, via the Abramowitz & Stegun 26.2.17 rational approximation
 * (absolute error < 7.5e-8) — accurate far beyond what a fantasy projection deserves, and with no
 * dependency, which is what lets this module be tested by plain node against the compiled output.
 * @param z - Standard score.
 * @returns P(Z ≤ z).
 */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t
    + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * @description One player's weekly spread in points: the positional prior applied to his projection,
 * replaced by his own sample deviation as real weeks accumulate.
 *
 * The shrinkage matters more than it looks. Three weeks of scores is not evidence of a player's
 * volatility — it is three numbers — so a raw sample deviation early in a season would swing the
 * recommendation on noise. The weight `n / (n + 4)` reaches the sample slowly and never abandons the
 * prior entirely.
 * @param mean - The player's projected points this week.
 * @param positionId - ESPN `defaultPositionId`, used only as a key into the priors.
 * @param samples - The player's actual weekly point totals so far, when any are known.
 * @returns Standard deviation in points, never below the floor.
 */
export function spreadFor(mean: number, positionId?: number, samples?: number[]): number {
  const cv = (positionId !== undefined && POSITION_SPREAD_PRIORS[positionId] !== undefined)
    ? POSITION_SPREAD_PRIORS[positionId]
    : DEFAULT_SPREAD_PRIOR;
  const prior = Math.abs(mean) * cv;
  const usable = (samples || []).filter((s) => Number.isFinite(s));
  if (usable.length >= 2) {
    const avg = usable.reduce((s, v) => s + v, 0) / usable.length;
    const variance = usable.reduce((s, v) => s + (v - avg) ** 2, 0) / (usable.length - 1);
    const observed = Math.sqrt(Math.max(variance, 0));
    const w = usable.length / (usable.length + SHRINKAGE_WEIGHT);
    return Math.max(w * observed + (1 - w) * prior, MIN_SPREAD_POINTS);
  }
  return Math.max(prior, MIN_SPREAD_POINTS);
}

/** A lineup reduced to the only two numbers a head-to-head week depends on. */
export interface LineupMoments {
  /** Projected total. */
  mean: number;
  /** Standard deviation of that total, variances summed across starters. */
  sd: number;
}

/** A player with everything the moment calculation needs. */
export interface WeighedPlayer extends FantasyPlayer {
  /** ESPN `defaultPositionId`, for the spread prior. */
  defaultPositionId?: number;
  /** Actual weekly totals already scored this season, when known. */
  pointsHistory?: number[];
}

/**
 * @description Mean and standard deviation of a set of starters' combined score. Variances add
 * because the lineups are treated as independent — the assumption named in this module's header.
 * @param starters - The starting players.
 * @param scoring - The league's scoring rules.
 * @returns The lineup's moments.
 */
export function lineupMoments(starters: WeighedPlayer[], scoring: ScoringItem[]): LineupMoments {
  let mean = 0;
  let variance = 0;
  for (const p of starters) {
    const pts = isAvailable(p) ? applyScoring(p.projectedStats, scoring) : 0;
    const sd = spreadFor(pts, p.defaultPositionId, p.pointsHistory);
    mean += pts;
    variance += sd * sd;
  }
  return { mean: round2(mean), sd: round2(Math.sqrt(variance)) };
}

/**
 * @description The probability that the first lineup outscores the second.
 * @param mine - My lineup's moments.
 * @param theirs - The opponent's moments.
 * @returns P(my score > their score), in [0, 1].
 */
export function winProbability(mine: LineupMoments, theirs: LineupMoments): number {
  const spread = Math.sqrt(mine.sd * mine.sd + theirs.sd * theirs.sd);
  if (!(spread > 0)) return mine.mean === theirs.mean ? 0.5 : Number(mine.mean > theirs.mean);
  return round4(normalCdf((mine.mean - theirs.mean) / spread));
}

/** How the week looks before any lineup decision is made. */
export type Posture = 'underdog' | 'favourite' | 'even';

/**
 * @description Which way the variance argument points this week.
 * @param mine - My mean-maximal lineup's moments.
 * @param theirs - The opponent's moments.
 * @returns The posture. 'even' is a band, not a knife edge — inside it the two objectives agree.
 */
export function postureOf(mine: LineupMoments, theirs: LineupMoments): Posture {
  const gap = mine.mean - theirs.mean;
  const band = 0.15 * Math.sqrt(mine.sd * mine.sd + theirs.sd * theirs.sd);
  if (gap < -band) return 'underdog';
  if (gap > band) return 'favourite';
  return 'even';
}

/** One swap the win-probability objective makes that the mean objective would not. */
export interface WinSwap {
  start: { playerId: number; name: string; points: number; sd: number };
  sit: { playerId: number; name: string; points: number; sd: number };
  slotId: number;
  /** Points of projection given up (negative when the swap also gains points). */
  meanCost: number;
  /** Win probability gained, in points of percentage. */
  winGain: number;
}

/** The lineup that maximises P(win), beside the one that maximises points. */
export interface WinOptimisedLineup {
  /** The recommended lineup. */
  lineup: OptimisedLineup;
  moments: LineupMoments;
  winProbability: number;
  /** The highest-projected lineup, for comparison — always computed, never hidden. */
  meanLineup: OptimisedLineup;
  meanMoments: LineupMoments;
  meanWinProbability: number;
  posture: Posture;
  /** Swaps taken away from the mean-maximal lineup, and what each one bought. */
  swaps: WinSwap[];
  /** True when no opponent was known and the mean-maximal lineup was returned unchanged. */
  meanFallback: boolean;
}

/**
 * @description Choose the lineup with the best chance of winning THIS week's matchup.
 *
 * Starts from the highest-projected lineup and hill-climbs on P(win) with the same bench-for-starter
 * swaps the mean optimiser uses, so the two searches are directly comparable and the difference
 * between them is attributable to the objective rather than to the search. Every accepted swap is
 * returned with what it cost in projected points and what it bought in win probability, because a
 * recommendation that knowingly gives up points has to show its work.
 *
 * With no opponent — an unread matchup, a bye, a league whose schedule ESPN will not return — this
 * returns the mean-maximal lineup unchanged and says so in `meanFallback`. Guessing at an opponent
 * would be worse than declining to change anything.
 * @param roster - The whole roster.
 * @param slots - The league's starting slots.
 * @param scoring - The league's scoring rules.
 * @param opponent - The opponent lineup's moments, or null when unknown.
 * @returns The recommended lineup, the mean-maximal one, and the difference between them.
 */
export function optimiseForWin(
  roster: WeighedPlayer[], slots: LineupSlot[], scoring: ScoringItem[], opponent: LineupMoments | null,
): WinOptimisedLineup {
  const meanLineup = optimiseLineup(roster, slots, scoring);
  const meanStarters = meanLineup.starters.map((a) => a.player as WeighedPlayer);
  const meanMoments = lineupMoments(meanStarters, scoring);
  if (!opponent) {
    return {
      lineup: meanLineup, moments: meanMoments, winProbability: 0.5,
      meanLineup, meanMoments, meanWinProbability: 0.5,
      posture: 'even', swaps: [], meanFallback: true,
    };
  }

  const starters = meanLineup.starters.map((a) => ({ ...a }));
  const bench = new Map(meanLineup.bench.map((b) => [b.player.playerId, b.player as WeighedPlayer]));
  const swaps: WinSwap[] = [];
  for (let guard = 0; guard < 20; guard += 1) {
    const best = bestWinSwap(starters, bench, scoring, opponent);
    if (!best) break;
    const outgoing = starters[best.index].player as WeighedPlayer;
    starters[best.index] = { slotId: starters[best.index].slotId, player: best.player, points: best.points };
    bench.delete(best.player.playerId);
    bench.set(outgoing.playerId, outgoing);
    swaps.push(best.swap);
  }

  const lineup: OptimisedLineup = {
    starters,
    bench: [...bench.values()].map((p) => ({ player: p, points: applyScoring(p.projectedStats, scoring) }))
      .sort((a, b) => b.points - a.points),
    total: round2(starters.reduce((s, a) => s + a.points, 0)),
  };
  const moments = lineupMoments(starters.map((a) => a.player as WeighedPlayer), scoring);
  return {
    lineup,
    moments,
    winProbability: winProbability(moments, opponent),
    meanLineup,
    meanMoments,
    meanWinProbability: winProbability(meanMoments, opponent),
    posture: postureOf(meanMoments, opponent),
    swaps,
    meanFallback: false,
  };
}

/** The single bench-for-starter swap that raises P(win) most, or null when none does. */
function bestWinSwap(
  starters: Array<{ slotId: number; player: FantasyPlayer; points: number }>,
  bench: Map<number, WeighedPlayer>,
  scoring: ScoringItem[],
  opponent: LineupMoments,
): { index: number; player: WeighedPlayer; points: number; swap: WinSwap } | null {
  const current = lineupMoments(starters.map((a) => a.player as WeighedPlayer), scoring);
  const base = winProbability(current, opponent);
  let best: { index: number; player: WeighedPlayer; points: number; swap: WinSwap } | null = null;
  for (let i = 0; i < starters.length; i += 1) {
    for (const candidate of bench.values()) {
      if (!isAvailable(candidate) || !candidate.eligibleSlots.includes(starters[i].slotId)) continue;
      const trial = starters.map((a, j) => (j === i ? candidate : a.player as WeighedPlayer));
      const gain = winProbability(lineupMoments(trial, scoring), opponent) - base;
      if (gain <= 1e-6 || (best && gain <= best.swap.winGain / 100)) continue;
      const points = applyScoring(candidate.projectedStats, scoring);
      const out = starters[i].player as WeighedPlayer;
      best = {
        index: i,
        player: candidate,
        points,
        swap: {
          start: { playerId: candidate.playerId, name: candidate.name, points, sd: spreadFor(points, candidate.defaultPositionId, candidate.pointsHistory) },
          sit: { playerId: out.playerId, name: out.name, points: starters[i].points, sd: spreadFor(starters[i].points, out.defaultPositionId, out.pointsHistory) },
          slotId: starters[i].slotId,
          meanCost: round2(starters[i].points - points),
          winGain: round2(gain * 100),
        },
      };
    }
  }
  return best;
}

/** Rounds to two decimals, the precision every points figure in this package uses. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Rounds a probability to four decimals — a hundredth of a percentage point. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
