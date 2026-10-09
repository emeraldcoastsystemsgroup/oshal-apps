/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Fantasy Football company audience view (ADR-164 D6): the page, its declared URL, one synthetic read-only answer in the shape routes/home-summary.js builds (linked leagues, ungraded calls, calls graded in five days, the closing note) and a status answer for the full page, and what the company view must show.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

const NOTE = 'Shows your own linked fantasy leagues and the grading state of the start/sit calls registered for your team. Opening this never reads ESPN, changes a lineup or submits a claim — the app advises, you act.';

/**
 * @description The route's three counts for an account with two linked leagues, three calls waiting to be graded and four
 * graded in five days; the route mirrors this array as `tiles`.
 * @returns {object[]} Metrics with digit-string values.
 */
function metrics() {
  return [
    { id: 'fantasy-leagues', label: 'Linked fantasy leagues', value: '2' },
    { id: 'calls-ungraded', label: 'Ungraded start/sit calls', value: '3' },
    { id: 'graded-5d', label: 'Start/sit calls graded/5d', value: '4' },
  ];
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => {
  const m = metrics();
  return {
    app: 'fantasy-football', file: 'fantasy-football/tools/fantasy-football.html', url: '/api/fantasy-football/', fullMarker: '#fantasyBody',
    reads: {
      '/api/fantasy-football/home-summary': { metrics: m, tiles: m, items: [{ text: NOTE, tone: 'neutral', fix: 'fantasy-football' }], partial: false, asOf: iso(0) },
      '/api/fantasy-football/status': { connected: false, leagues: [], season: null },
    },
    audiences: {
      company: {
        stats: 3, sections: ['notes'],
        text: ['Productivity · Fantasy Football', '3 start/sit calls waiting to be graded', 'the app advises, you act', 'Open Fantasy Football',
          'How these figures are read', NOTE, 'Open Fantasy Football in the cockpit'],
        statValues: { 'fantasy-leagues': '2', 'calls-ungraded': '3', 'graded-5d': '4' },
      },
    },
  };
};
