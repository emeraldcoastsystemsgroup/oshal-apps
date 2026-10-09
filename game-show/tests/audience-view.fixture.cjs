/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Game Show family audience view (ADR-164 D6): the review page, its declared URL, synthetic read-only answers shaped like GET /api/game-show/home-summary (routes/home-summary.js: the three room counts as digit strings mirrored as tiles; the three newest hosted rooms, newest first, each '<status> / updated <iso>' with the two planning offers attached, one of them unnamed so it carries its show id; then the bounds note), /leaderboard (lib/room-service.js leaderboard(): best-first entries of name, team, score, showId, endedAt) and /shows (the static show catalog), and what the family view must show. /rooms is deliberately not answered: its listing runs the ended-room retention DELETE and the view never reads it. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company audience (ADR-164 D6) expects the same card as the family one: the harness paints it in the company grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/**
 * @description The route's three counts for a table with one room in the lobby, one marked live and two ended lately.
 * @returns {object[]} Metrics with digit-string values, which the route mirrors as tiles.
 */
function counts() {
  return [
    { id: 'hosted-lobbies', label: 'Hosted lobbies', value: '1' },
    { id: 'hosted-live', label: 'Hosted live sessions', value: '1' },
    { id: 'ended-updated-5d', label: 'Ended rooms updated/5d', value: '2' },
  ];
}

/**
 * @description One room item as the route writes it: the room name (or its show id), the status and update, the offers.
 * @param {string} text The room name, or the show id of an unnamed room.
 * @param {string} status lobby | live | ended.
 * @param {string} updated The ISO instant of updated_at.
 * @returns {object} The item.
 */
function room(text, status, updated) {
  const detail = status + ' / updated ' + updated;
  const notes = detail + ' Game format: family-feud. This is your hosted room state; it does not establish current player presence. Review plans for the next gathering.';
  return { text, detail, tone: 'neutral', fix: 'game-show-stage',
    actions: ['plan-meal', 'prepare-document'].map((integration) => ({ integration, context: { title: text, notes } })) };
}

/**
 * @description The three newest hosted rooms in the route's order (updated_at descending) followed by its bounds note.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} Items.
 */
function items(iso) {
  return [
    room('Synthetic Friday Feud', 'lobby', iso(-2)),
    room('Synthetic Wheel Night', 'live', iso(-26)),
    room('jeopardy', 'ended', iso(-80)),
    { text: 'Counts caller-hosted rooms by persisted lobby/live/ended state; live does not mean a connected player. Ended rooms updated within five days is not a completion timestamp. Plan refreshments or a host brief without starting a game, changing scores or exposing join codes or camera frames.', tone: 'neutral', fix: 'game-show-stage' },
  ];
}

/** @returns {object[]} The show catalog as GET /shows lists it. */
function shows() {
  return [
    { id: 'family-feud', title: 'Family Feud', tagline: 'Name the top survey answers before three strikes.', teams: true, minPlayers: 2, maxPlayers: 10 },
    { id: 'jeopardy', title: 'Jeopardy', tagline: 'Pick a category, ring in, and answer in the form of a question.', teams: false, minPlayers: 2, maxPlayers: 10 },
    { id: 'wheel', title: 'Wheel of Fortune', tagline: 'Spin for cash, call your letters, and solve the puzzle.', teams: false, minPlayers: 2, maxPlayers: 10 },
    { id: 'whammy', title: 'Whammy!', tagline: 'Press your luck for big bucks.', teams: false, minPlayers: 2, maxPlayers: 10 },
  ];
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => {
  const m = counts();
  return {
    app: 'game-show', file: 'game-show/tools/review.html', url: '/api/game-show/review', fullMarker: '#metrics .metric',
    reads: {
      '/api/game-show/home-summary': { metrics: m, tiles: m, items: items(iso), asOf: iso(0), partial: false },
      '/api/game-show/leaderboard': { ok: true, entries: [
        { name: 'Synthetic Ana', team: 'A', score: 12400, showId: 'family-feud', endedAt: iso(-80) },
        { name: 'Synthetic Ben', team: null, score: 900, showId: 'whammy', endedAt: iso(-100) },
      ] },
      '/api/game-show/shows': { ok: true, shows: shows() },
    },
    audiences: {
      family: {
        stats: 4, sections: ['rooms', 'fame'],
        text: ['Game night', '1 game marked live', 'Newest: Synthetic Friday Feud, waiting in the lobby, updated 2 h ago.', 'Open Game Show', 'Your recent rooms',
          'Synthetic Wheel Night', 'Marked live', 'updated yesterday', 'Jeopardy', 'Ended', 'updated 3 days ago', 'it does not mean anyone is playing right now.',
          'Hall of fame', 'Synthetic Ana', 'Family Feud · Team A', '12400', 'Synthetic Ben', 'Whammy!', '900', 'The best scores from ended games you hosted or played in.',
          'Open Game Show in the cockpit'],
        statValues: { lobby: '1', live: '1', ended: '2', top: '12400' },
      },
    },
  };
};

// ADR-164 D6: the company audience paints the same account-scoped card; every page entry expects the same text, stats and sections under it.
const __secondAudience = module.exports;
module.exports = (helpers) => {
  const entries = __secondAudience(helpers), list = Array.isArray(entries) ? entries : [entries];
  for (const entry of list) if (entry.audiences && entry.audiences.family && !entry.audiences.company) entry.audiences.company = entry.audiences.family;
  return entries;
};
