/**
 * A hand-typed league and the public feed that goes with it, for the manual-entry and grading suites.
 *
 * Three teams of four, two running-back slots and one receiver, one stat worth one point. The feed
 * carries the current week's projection for every player and a completed actual line for each
 * earlier week, in the shape ESPN's public feed uses (statSourceId 1 = projection, 0 = actual,
 * statSplitTypeId 1 = a week). ESPN is served from a stub that answers ONLY the two public reads a
 * hand-typed league may make — the season's current week and the player feed — and records every
 * URL, so a league read or a cookie is a failure the suites can see.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the hand-typed league document, its public feed with completed weeks, and a public-only ESPN stub that records every request.
 */

'use strict';

const SEASON = 2026;

/** Projection this week and the actual line for each earlier week, per player. */
const PLAYERS = {
  11: ['Mine Back One', 2, 18], 12: ['Mine Back Two', 2, 4], 13: ['Mine Bench Back', 2, 11], 14: ['Mine Receiver', 3, 12],
  21: ['Theirs Back One', 2, 20], 22: ['Theirs Back Two', 2, 17], 23: ['Theirs Back Three', 2, 15], 24: ['Theirs Receiver', 3, 5],
  31: ['Third Back One', 2, 12], 32: ['Third Back Two', 2, 10], 33: ['Third Receiver', 3, 14], 34: ['Third Receiver Two', 3, 13],
  50: ['Wire Back', 2, 16], 51: ['Wire Receiver', 3, 6],
};

/**
 * @description The hand-typed league document, as a person would submit it.
 * @param overrides - Fields to replace.
 * @returns The body.
 */
function manualLeague(overrides = {}) {
  return {
    name: 'Hand-typed league', season: SEASON,
    scoring: [{ statId: 1, points: 1 }],
    slots: [{ slotId: 2, count: 2 }, { slotId: 4, count: 1 }],
    teams: [
      { teamId: 1, name: 'Mine', mine: true, roster: [11, 12, 13, 14], starting: [11, 12, 14] },
      { teamId: 2, name: 'Theirs', roster: [21, 22, 23, 24], starting: [21, 22, 24] },
      { teamId: 3, name: 'Third', roster: [31, 32, 33, 34], starting: [31, 32, 33] },
    ],
    schedule: [{ week: 4, home: 1, away: 2 }, { week: 5, home: 1, away: 3 }],
    byes: {},
    faab: { budget: 100, spent: 10 },
    lastWeek: 6,
    playoffStart: 6,
    ...overrides,
  };
}

/**
 * @description The public feed as of `currentWeek`: this week's projection, and an actual line for
 * each completed week before it (the projection plus the week number, so each week is distinct).
 * @param currentWeek - The week being set.
 * @returns ESPN feed rows.
 */
function publicFeed(currentWeek) {
  return Object.entries(PLAYERS).map(([id, [name, pos, points]]) => ({
    id: Number(id), fullName: name, defaultPositionId: pos, proTeamId: Number(id) % 7 + 1,
    eligibleSlots: pos === 2 ? [2, 23, 20] : [4, 23, 20],
    stats: [
      { seasonId: SEASON, scoringPeriodId: currentWeek, statSourceId: 1, statSplitTypeId: 1, stats: { 1: points } },
      ...Array.from({ length: currentWeek - 1 }, (_, i) => ({
        seasonId: SEASON, scoringPeriodId: i + 1, statSourceId: 0, statSplitTypeId: 1, stats: { 1: points + i + 1 },
      })),
    ],
  }));
}

/**
 * @description ESPN for a hand-typed league: only the season's current week and the public feed
 * answer; anything else — a league read above all — is recorded and refused loudly.
 * @param currentWeek - The week ESPN reports as current.
 * @param seen - Records every URL and Cookie header sent.
 * @returns A fetch implementation.
 */
function publicOnlyEspn(currentWeek, seen) {
  return async (url, init) => {
    const target = String(url);
    seen.push({ url: target, cookie: String((init && init.headers && init.headers.Cookie) || '') });
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (/\/seasons\/\d+$/.test(new URL(target).pathname)) return json({ currentScoringPeriod: { id: currentWeek } });
    if (/\/players\?/.test(target)) return json(publicFeed(currentWeek));
    throw new Error(`a hand-typed league made a non-public ESPN read: ${target}`);
  };
}

module.exports = { PLAYERS, SEASON, manualLeague, publicFeed, publicOnlyEspn };
