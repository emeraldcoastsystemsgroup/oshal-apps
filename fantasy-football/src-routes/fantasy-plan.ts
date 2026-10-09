/**
 * The season plan — which projection stands for which player in which remaining week.
 *
 * WHAT THE FEED ACTUALLY CARRIES, established from a captured response before this was written
 * (2026-09-28, season 2026, current week 3): every player's stat array holds a projection row
 * (statSourceId 1, statSplitTypeId 1) for EVERY week 1-18, and a bye week is a projection row with
 * no stats at all. The fantasy-leagues skill distils ONE week per read (the whole ~39MB universe per
 * call), so this package holds the weeks it has read and nothing more.
 *
 * So each remaining week is priced from, in order:
 *   1. that week's own distilled feed, when the caller's cache holds it — a player absent from it is
 *      not projected that week (a bye, or out) and is priced at zero;
 *   2. otherwise the CURRENT week's projection as a per-week rate (for a player on a bye this week,
 *      the nearest other week the caller has read) — stated, not hidden: ESPN's
 *      future-week rows for the same player differ from the current one by a few percent (the
 *      captured sample moved 20.8-21.3 points across weeks 3-17 for one receiver), and
 *   3. a bye week from the league's bye table (hand-typed in a manual league), which prices that
 *      week at zero however good the rate is.
 * The response names which weeks were priced from a real feed and which from the rate, so nobody
 * mistakes the second for the first.
 *
 * A player OUT this week is not assumed out for the season: from the rate his future weeks carry no
 * injury status. INJURY_RESERVE and SUSPENSION do carry forward — neither has a published return
 * week, and pricing a suspended player back into the lineup would be a guess presented as a number.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — build a SeasonPlan from the cached weekly feeds, the current week as a stated rate, a bye table and a playoff weight, and say which weeks came from which; rate weeks with the same teams on bye share a signature so they are solved once.
 *
 * @module fantasy-plan
 */

import type { FantasyPlayer, LineupSlot, ScoringItem } from './fantasy-scoring';
import type { SeasonPlan } from './fantasy-season';

/** Statuses that carry forward from this week into the rest of the season. */
const LASTING_STATUSES = new Set(['INJURY_RESERVE', 'SUSPENSION']);

/** Default weight of a fantasy playoff week relative to a regular-season week. A stated parameter. */
export const DEFAULT_PLAYOFF_WEIGHT = 1.5;

/** The inputs a plan is built from. */
export interface PlanInputs {
  currentWeek: number;
  /** The last week that counts (the league's final scoring period). */
  lastWeek: number;
  /** The first fantasy playoff week, or null when unknown (every week then weighs 1). */
  playoffStart: number | null;
  playoffWeight?: number;
  /** Weekly feeds the caller holds, keyed by week (a week outside the plan still supplies rates). */
  feeds: Map<number, Record<number, FantasyPlayer>>;
  /** Bye week per pro team id, when known. */
  byes: Record<number, number>;
  slots: LineupSlot[];
  scoring: ScoringItem[];
}

/** A plan, and where each of its weeks' numbers came from. */
export interface BuiltPlan {
  plan: SeasonPlan;
  /** Weeks priced from their own cached feed. */
  fromFeed: number[];
  /** Weeks priced from the current week's projection as a rate. */
  fromRate: number[];
}

/**
 * @description A future week's copy of a player priced from the current week: same projection, and
 * only the injury statuses that last.
 * @param p - The player as projected this week.
 * @returns The player for a later week.
 */
function atRate(p: FantasyPlayer): FantasyPlayer {
  const status = String(p.injuryStatus || '').toUpperCase();
  return { ...p, injuryStatus: LASTING_STATUSES.has(status) ? p.injuryStatus : undefined, actualStats: undefined };
}

/**
 * @description Build the season plan for the weeks that remain, current week included.
 * @param input - Feeds, byes, the season shape and the league's rules.
 * @returns The plan and the provenance of each week.
 */
export function buildSeasonPlan(input: PlanInputs): BuiltPlan {
  const weight = input.playoffWeight ?? DEFAULT_PLAYOFF_WEIGHT;
  // The rate is this week's projection; a player on a bye THIS week is absent from it, so his rate
  // comes from the nearest other week the caller has read.
  const rateSources = [...input.feeds.entries()]
    .sort(([a], [b]) => Math.abs(a - input.currentWeek) - Math.abs(b - input.currentWeek))
    .map(([, feed]) => feed);
  const rateFor = (id: number): FantasyPlayer | null => rateSources.find((f) => f[id])?.[id] || null;
  const weeks = [];
  const fromFeed: number[] = [];
  const fromRate: number[] = [];
  for (let w = input.currentWeek; w <= input.lastWeek; w += 1) {
    weeks.push({ week: w, weight: input.playoffStart !== null && w >= input.playoffStart ? weight : 1 });
    (input.feeds.has(w) ? fromFeed : fromRate).push(w);
  }
  const planned = new Set(weeks.map((w) => w.week));
  const playerFor = (playerId: number, week: number): FantasyPlayer | null => {
    const own = planned.has(week) ? input.feeds.get(week) : undefined;
    if (own) return own[playerId] || null;
    const p = rateFor(playerId);
    if (!p) return null;
    const proTeam = Number((p as { proTeamId?: number }).proTeamId);
    if (Number.isFinite(proTeam) && input.byes[proTeam] === week) return null;
    return atRate(p);
  };
  // Every rate-priced week with the same pro teams on bye has identical inputs; a read week is its own.
  const signature = (week: number): string | null => {
    if (!planned.has(week)) return null;
    if (input.feeds.has(week)) return `feed:${week}`;
    const off = Object.entries(input.byes).filter(([, w]) => w === week).map(([team]) => team).sort();
    return `rate:${off.join(',')}`;
  };
  return { plan: { weeks, slots: input.slots, scoring: input.scoring, playerFor, signature }, fromFeed, fromRate };
}
