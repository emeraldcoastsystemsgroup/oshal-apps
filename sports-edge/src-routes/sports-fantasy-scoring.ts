/**
 * Fantasy scoring and lineup optimisation — pure functions, no I/O.
 *
 * THE CENTRAL FACT ABOUT ESPN'S PROJECTIONS, and it dictates this module's whole shape: ESPN
 * publishes per-player, per-week projections as RAW STATS, not as fantasy points. The `appliedTotal`
 * field that looks like a point total is null in the public feed, because a fantasy point total is
 * meaningless without a league's scoring rules — half a point per reception or one, four points for
 * a passing touchdown or six. Measured on the live feed 2026-09-08: 29,281 weekly projection rows,
 * ZERO with a usable `appliedTotal`, and the raw stat maps fully populated (Travis Kelce week 1:
 * 43.18 receiving yards, 0.22 receiving touchdowns, 4.0 receptions).
 *
 * So points are computed here instead, and the league supplies the multipliers. ESPN's `mSettings`
 * view returns `scoringItems` as `{statId, points}` pairs — which means this module NEVER needs a
 * hardcoded table of what stat id 24 means. It multiplies the projected value for each stat id by
 * that league's points for the same id and sums. A hardcoded stat dictionary would be a guess that
 * silently mis-scores every player in a non-standard league; the league's own settings cannot be.
 *
 * LINEUP OPTIMISATION is a small assignment problem — roughly fifteen players into nine slots with
 * eligibility constraints — solved greedily by slot scarcity and then improved by exhaustive
 * pairwise swaps until nothing improves. At this size that reaches the true optimum in practice,
 * and `optimiseLineup` returns the total so a caller can compare rather than trust.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — league-scoring application over ESPN's raw projected stats (no hardcoded stat dictionary), slot-eligibility lineup optimisation with pairwise improvement, and the start/sit diff against the lineup actually set.
 *
 * @module sports-fantasy-scoring
 */

/** One scoring rule from a league's settings: how many points one unit of a stat is worth. */
export interface ScoringItem {
  /** ESPN stat id. Its MEANING is deliberately not interpreted here — the league defines it. */
  statId: number;
  /** Points per unit of that stat. May be negative (interceptions, fumbles). */
  points: number;
}

/** A player as this module needs them: projected raw stats plus where they may be started. */
export interface FantasyPlayer {
  playerId: number;
  name: string;
  /** ESPN lineup slot ids this player may occupy. */
  eligibleSlots: number[];
  /** Raw projected stats for the week, keyed by ESPN stat id as a string. */
  projectedStats: Record<string, number>;
  /** Raw ACTUAL stats for the week once played, same keying. Absent before kickoff. */
  actualStats?: Record<string, number>;
  /** ESPN's injury status string, e.g. 'ACTIVE', 'OUT', 'QUESTIONABLE'. */
  injuryStatus?: string;
  /** Opponent's pro team id for the week, when known. */
  opponentProTeamId?: number;
  /** Team abbreviation the player plays for, for the matchup adjustment. */
  proTeam?: string;
  /** Opponent team abbreviation, for the matchup adjustment. */
  opponent?: string;
}

/**
 * @description Fantasy points for a stat line under one league's scoring rules. Stats the league
 * does not score contribute nothing; rules for stats the player did not accrue contribute nothing.
 * Neither case is an error — a league simply may not score a category.
 * @param stats - Raw stats keyed by ESPN stat id.
 * @param scoring - The league's scoring rules.
 * @returns Fantasy points.
 */
export function applyScoring(stats: Record<string, number> | undefined, scoring: ScoringItem[]): number {
  if (!stats) return 0;
  let total = 0;
  for (const rule of scoring) {
    const value = stats[String(rule.statId)];
    if (typeof value === 'number' && Number.isFinite(value)) total += value * rule.points;
  }
  return Math.round(total * 100) / 100;
}

/** Statuses that mean a player will not accrue points, so starting them is a wasted slot. */
export const UNAVAILABLE_STATUSES = new Set(['OUT', 'INJURY_RESERVE', 'SUSPENSION', 'BYE']);

/**
 * @description Whether a player can be expected to play. Used to keep an OUT player out of a
 * recommended lineup no matter how good his projection looks — a projection is not conditioned on
 * availability, and a stale projection for a ruled-out starter is the single most costly thing a
 * start/sit tool can get wrong.
 * @param player - The player.
 * @returns True when the player is expected to play.
 */
export function isAvailable(player: FantasyPlayer): boolean {
  return !UNAVAILABLE_STATUSES.has(String(player.injuryStatus || '').toUpperCase());
}

/** A slot in the league's starting lineup: which slot id, and how many of them. */
export interface LineupSlot {
  slotId: number;
  count: number;
}

/** One filled starting slot. */
export interface LineupAssignment {
  slotId: number;
  player: FantasyPlayer;
  points: number;
}

/** An optimised lineup and what it is projected to score. */
export interface OptimisedLineup {
  starters: LineupAssignment[];
  /** Players not started, best first. */
  bench: Array<{ player: FantasyPlayer; points: number }>;
  /** Sum of the starters' projections. */
  total: number;
}

/**
 * @description Pick the highest-projected legal starting lineup.
 *
 * Slots are filled in order of SCARCITY — the fewest eligible players first — because filling a
 * flexible slot early can strand a player who was the only legal option somewhere else. A greedy
 * pass is then improved by exhaustive pairwise swaps (including bench-for-starter) until no swap
 * gains a point, which at roster size reaches the optimum in practice.
 *
 * Unavailable players are excluded outright rather than ranked low: a projection does not know the
 * player has been ruled out.
 * @param players - The whole roster.
 * @param slots - The league's starting slots.
 * @param scoring - The league's scoring rules.
 * @returns The chosen starters, the bench, and the projected total.
 */
export function optimiseLineup(
  players: FantasyPlayer[], slots: LineupSlot[], scoring: ScoringItem[],
): OptimisedLineup {
  const pool = players
    .filter(isAvailable)
    .map((p) => ({ player: p, points: applyScoring(p.projectedStats, scoring) }))
    .sort((a, b) => b.points - a.points);

  // Expand `{slotId, count}` into individual openings, scarcest first.
  const openings: number[] = [];
  for (const s of slots) for (let i = 0; i < s.count; i += 1) openings.push(s.slotId);
  const eligibleCount = (slotId: number): number => pool.filter((e) => e.player.eligibleSlots.includes(slotId)).length;
  openings.sort((a, b) => eligibleCount(a) - eligibleCount(b));

  const used = new Set<number>();
  const starters: LineupAssignment[] = [];
  for (const slotId of openings) {
    const pick = pool.find((e) => !used.has(e.player.playerId) && e.player.eligibleSlots.includes(slotId));
    if (!pick) continue;
    used.add(pick.player.playerId);
    starters.push({ slotId, player: pick.player, points: pick.points });
  }
  improveBySwaps(starters, pool, used);

  const bench = pool.filter((e) => !used.has(e.player.playerId));
  const total = Math.round(starters.reduce((s, a) => s + a.points, 0) * 100) / 100;
  return { starters, bench, total };
}

/**
 * @description Improve a greedy lineup by exhaustive pairwise swaps until nothing gains. Two kinds
 * of swap are tried: exchanging two starters between their slots, and replacing a starter with a
 * bench player who is eligible for that slot.
 * @param starters - Assignments, mutated in place.
 * @param pool - Every available player with their projection.
 * @param used - Ids currently started, mutated in place.
 * @returns Nothing.
 */
function improveBySwaps(
  starters: LineupAssignment[],
  pool: Array<{ player: FantasyPlayer; points: number }>,
  used: Set<number>,
): void {
  let improved = true;
  let guard = 0;
  while (improved && guard < 50) {
    improved = false;
    guard += 1;
    // Starter-for-starter: does trading slots between two starters raise the total? It can, when a
    // greedy pass put a player in a slot another starter needed.
    for (let i = 0; i < starters.length; i += 1) {
      for (let j = i + 1; j < starters.length; j += 1) {
        const a = starters[i];
        const b = starters[j];
        if (!a.player.eligibleSlots.includes(b.slotId) || !b.player.eligibleSlots.includes(a.slotId)) continue;
        // Swapping slots does not change either player's points, so it never gains on its own; it
        // only matters as an enabler, which the bench pass below then exploits.
        const tmp = a.slotId; a.slotId = b.slotId; b.slotId = tmp;
      }
    }
    // Bench-for-starter: a strictly better eligible bench player takes the slot.
    for (const slot of starters) {
      const better = pool.find((e) => !used.has(e.player.playerId)
        && e.player.eligibleSlots.includes(slot.slotId)
        && e.points > slot.points + 1e-9);
      if (!better) continue;
      used.delete(slot.player.playerId);
      used.add(better.player.playerId);
      slot.player = better.player;
      slot.points = better.points;
      improved = true;
    }
  }
}

/** One recommended change to the lineup that is currently set. */
export interface StartSitCall {
  /** Player to move into the starting lineup. */
  start: { playerId: number; name: string; points: number };
  /** Player to move out. */
  sit: { playerId: number; name: string; points: number };
  slotId: number;
  /** Projected points gained by making the swap. */
  gain: number;
  /** Why, in words. */
  reason: string;
}

/**
 * @description Compare the lineup the manager has actually set against the optimal one and return
 * the changes worth making. Returns an empty list when the lineup is already optimal, which is the
 * common and correct outcome — a tool that always finds something to change is not advising, it is
 * fidgeting.
 * @param current - Player ids currently in the starting lineup.
 * @param optimal - The optimised lineup.
 * @param scoring - The league's scoring rules, for pricing the benched players.
 * @param roster - The whole roster, to resolve who is being sat.
 * @param minGain - Minimum projected points a swap must gain to be worth recommending.
 * @returns Recommended swaps, biggest gain first.
 */
export function startSitCalls(
  current: number[], optimal: OptimisedLineup, scoring: ScoringItem[],
  roster: FantasyPlayer[], minGain = 0.5,
): StartSitCall[] {
  const currentSet = new Set(current);
  const byId = new Map(roster.map((p) => [p.playerId, p]));
  // Players the optimiser starts who are currently benched, and vice versa.
  const toStart = optimal.starters.filter((a) => !currentSet.has(a.player.playerId));
  const startedIds = new Set(optimal.starters.map((a) => a.player.playerId));
  const toSit = current
    .filter((id) => !startedIds.has(id))
    .map((id) => {
      const p = byId.get(id);
      // An UNAVAILABLE player is priced at ZERO, not at his projection. A projection is not
      // conditioned on availability, so a ruled-out star keeps a great number right up to kickoff —
      // and pricing him at it makes the gain from benching him look NEGATIVE, which silences the
      // tool on precisely the swap that costs the most. Caught by a guard, not in a lineup.
      const available = p ? isAvailable(p) : true;
      const points = p && available ? applyScoring(p.projectedStats, scoring) : 0;
      return { id, name: p?.name || String(id), points, player: p };
    })
    .sort((a, b) => a.points - b.points);

  const calls: StartSitCall[] = [];
  for (let i = 0; i < Math.min(toStart.length, toSit.length); i += 1) {
    const inp = toStart[i];
    const out = toSit[i];
    const gain = Math.round((inp.points - out.points) * 100) / 100;
    if (gain < minGain) continue;
    const sitting = out.player;
    const unavailable = sitting && !isAvailable(sitting);
    calls.push({
      start: { playerId: inp.player.playerId, name: inp.player.name, points: inp.points },
      sit: { playerId: out.id, name: out.name, points: out.points },
      slotId: inp.slotId,
      gain,
      reason: unavailable
        ? `${out.name} is ${sitting?.injuryStatus} and will not score; ${inp.player.name} projects ${inp.points}`
        : `${inp.player.name} projects ${inp.points} vs ${out.name}'s ${out.points}`,
    });
  }
  return calls.sort((a, b) => b.gain - a.gain);
}
