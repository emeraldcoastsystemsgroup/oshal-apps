/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Sports Edge company audience view and its family alias (ADR-164 D6): the review page, its declared URL, one synthetic read-only answer in the shape routes/home-summary.js builds (the followed-teams count, two upcoming games with league and start, the closing note), and what each view must show.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

const NOTE = "Shows the caller's followed teams and upcoming cached previews, which must match a followed team; preview time remains visible because schedules can change.";

/**
 * @description One upcoming game exactly as the route builds it: '<away> at <home>' as the text, '<league> / scheduled
 * <ISO>' as the detail, and the continuation offers.
 * @param {string} away Away team.
 * @param {string} home Home team.
 * @param {string} league League code.
 * @param {string} starts ISO instant of the game.
 * @returns {object} The item.
 */
function game(away, home, league, starts) {
  const text = away + ' at ' + home, detail = league + ' / scheduled ' + starts;
  return { text, detail, tone: 'neutral', fix: 'sports-edge-home', actions: ['prepare-meal-plan', 'prepare-trip'].map((integration) => ({ integration, context: { title: text, notes: detail } })) };
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => {
  const m = [{ id: 'followed-teams', label: 'Followed teams', value: '3' }];
  const expect = {
    stats: 1, sections: ['games', 'notes'],
    text: ['Finance · Sports Edge', '2 upcoming games with a preview', 'nothing here refreshes odds, places a bet or books travel', 'Open Sports Edge',
      'Upcoming games', 'Synthetic Falcons at Synthetic Saints', 'League: NFL', 'Synthetic Hawks at Synthetic Heat', 'League: NBA',
      'How these figures are read', NOTE, 'Open Sports Edge in the cockpit'],
    statValues: { 'followed-teams': '3' },
  };
  return {
    app: 'sports-edge', file: 'sports-edge/tools/review.html', url: '/api/sports-edge/review', fullMarker: '#metrics .metric',
    reads: {
      '/api/sports-edge/home-summary': { metrics: m, tiles: m, partial: false, asOf: iso(0),
        items: [game('Synthetic Falcons', 'Synthetic Saints', 'NFL', iso(96)), game('Synthetic Hawks', 'Synthetic Heat', 'NBA', iso(150)), { text: NOTE, tone: 'neutral', fix: 'sports-edge-home' }] },
    },
    audiences: { company: expect, family: expect },
  };
};
