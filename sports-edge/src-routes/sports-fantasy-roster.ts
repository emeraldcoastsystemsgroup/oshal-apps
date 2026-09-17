/**
 * The roster a decision is actually made on — ESPN's entries joined to the shared projection feed
 * and to each player's own scoring history.
 *
 * WHY THIS IS ITS OWN MODULE. The join used to live in the route handler beside express and the
 * connector broker, which meant the one step where a player's history either reaches the spread
 * model or silently does not could only be exercised by standing up the framework. It is pure
 * shaping — entries in, players out — so it belongs somewhere a plain-node guard can drive the same
 * function the route calls, rather than a re-implementation of it that cannot go wrong.
 *
 * THE HISTORY IS SCORED PER LEAGUE, NOT STORED AS POINTS. `sports_fantasy_player_weeks` holds raw
 * stat lines, and a stat line is not a point total until a league's rules are applied to it. The
 * same week for the same player is a different number in a PPR league and a standard one, so the
 * conversion happens here, against the scoring rules the caller's league actually returned.
 *
 * WHAT THE HISTORY BUYS. `spreadFor` starts every player at a positional prior times his
 * projection, so two running backs projected at 13.2 and 13.1 come out at spreads of 7.26 and 7.21
 * — near-identical, which leaves the win-probability objective nothing to trade and produces the
 * exact live result recorded on 2026-09-09: posture underdog, 40.4% to win, and zero variance
 * swaps. Real weekly scores are what make one of them volatile and the other steady; until they are
 * fed in, the objective is correct arithmetic over inputs that cannot differ.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the roster join moved out of the route handler, now attaching each player's completed weeks scored under the league's own rules as the sample the spread model shrinks toward.
 *
 * @module sports-fantasy-roster
 */

import type { PlayerWeekActual } from './sports-fantasy-espn';
import { applyScoring, type FantasyPlayer, type ScoringItem } from './sports-fantasy-scoring';
import type { WeighedPlayer } from './sports-fantasy-winprob';

/** A roster entry as ESPN returns it. */
export interface RosterEntry {
  playerId: number;
  lineupSlotId: number;
  player: any;
}

/**
 * @description Turn stored stat lines into each player's weekly point totals under ONE league's
 * rules, oldest week first.
 *
 * Order matters to nothing in `spreadFor` — a sample deviation is order-free — but it is what makes
 * the series readable when it is shown, and an unordered series invites someone to treat the last
 * element as the most recent week when it is whichever row the database returned last.
 * @param rows - Stored player-weeks, in any order.
 * @param scoring - The league's scoring rules.
 * @returns Weekly point totals per player id.
 */
export function historyFor(rows: PlayerWeekActual[], scoring: ScoringItem[]): Map<number, number[]> {
  const byPlayer = new Map<number, PlayerWeekActual[]>();
  for (const row of rows) {
    const list = byPlayer.get(row.playerId);
    if (list) list.push(row); else byPlayer.set(row.playerId, [row]);
  }
  const out = new Map<number, number[]>();
  for (const [playerId, weeks] of byPlayer) {
    out.set(playerId, [...weeks]
      .sort((a, b) => a.week - b.week)
      .map((w) => applyScoring(w.stats, scoring)));
  }
  return out;
}

/**
 * @description Build the roster as the scoring model needs it: ESPN's league roster entries joined
 * to the shared projection feed and to each player's own completed weeks. A player missing from the
 * feed still appears, with no projection, rather than being dropped — a roster with a silently
 * missing player is worse than one with an obvious zero.
 * @param entries - Roster entries from the league read.
 * @param projections - The shared projection feed.
 * @param history - Weekly point totals per player id, when any have been accumulated.
 * @returns Players for the optimiser.
 */
export function joinRoster(
  entries: RosterEntry[],
  projections: Record<number, FantasyPlayer>,
  history?: Map<number, number[]>,
): WeighedPlayer[] {
  return entries.map((e) => {
    const proj = projections[e.playerId];
    const espnPlayer = e.player || {};
    const played = history?.get(e.playerId);
    return {
      // Carried for the spread prior in sports-fantasy-winprob: without a position every player
      // gets the default coefficient of variation, which silently flattens the whole variance
      // argument into "everyone is equally streaky" — the objective would still change, but the
      // ranking inside it would stop meaning anything.
      defaultPositionId: Number(
        (proj as { defaultPositionId?: number } | undefined)?.defaultPositionId
        ?? espnPlayer.defaultPositionId,
      ) || undefined,
      playerId: e.playerId,
      name: proj?.name || String(espnPlayer.fullName || `Player ${e.playerId}`),
      eligibleSlots: proj?.eligibleSlots?.length ? proj.eligibleSlots : (espnPlayer.eligibleSlots || []).map(Number),
      projectedStats: proj?.projectedStats || {},
      actualStats: proj?.actualStats,
      injuryStatus: proj?.injuryStatus || (espnPlayer.injuryStatus ? String(espnPlayer.injuryStatus) : undefined),
      // Undefined rather than an empty array when nothing has been accumulated: `spreadFor` falls
      // back to the positional prior on a sample it cannot use, and an empty array says "measured
      // nothing" where absence says "have not measured".
      pointsHistory: played && played.length ? played : undefined,
    };
  });
}
