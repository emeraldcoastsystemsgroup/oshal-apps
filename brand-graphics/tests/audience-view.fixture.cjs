/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Brand Graphics family audience view (ADR-164 D6): the review page, its declared URL, one synthetic read-only answer in the shape routes/home-summary.js builds (three counts, the newest three brand builds with their state and update time, the closing note), and what the family view must show.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

const NOTE = 'Only Vids jobs explicitly attributed as brand builds are counted. Completion is a saved worker result, not a publication. Review or edit the brand brief before explicitly starting a render; a connected draft consumes no rendering credits.';

/**
 * @description The route's three counts for an account with one build in progress, one failed and two done in five days;
 * the route mirrors this array as `tiles`.
 * @returns {object[]} Metrics with digit-string values.
 */
function metrics() {
  return [
    { id: 'brand-active', label: 'Brand jobs in progress', value: '1' },
    { id: 'brand-failed', label: 'Failed brand jobs', value: '1' },
    { id: 'brand-done-5d', label: 'Done jobs updated / 5d', value: '2' },
  ];
}

/**
 * @description One recorded build exactly as the route builds it: the idea as the text, '<status> · updated <ISO>' as the
 * detail, the state's tone and the two continuation offers.
 * @param {string} idea The brand brief.
 * @param {string} status queued | running | done | failed.
 * @param {string} updated ISO instant of updated_at.
 * @returns {object} The item.
 */
function build(idea, status, updated) {
  const detail = status + ' · updated ' + updated;
  return { text: idea, detail, tone: status === 'failed' ? 'warn' : 'neutral', fix: 'brand-graphics',
    actions: ['prepare-document', 'prepare-episode'].map((integration) => ({ integration, context: { title: idea, notes: detail + '\n' + idea } })) };
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => {
  const m = metrics();
  return {
    app: 'brand-graphics', file: 'brand-graphics/tools/review.html', url: '/api/brand-graphics/review', fullMarker: '#metrics .metric',
    reads: {
      '/api/brand-graphics/home-summary': { metrics: m, tiles: m, partial: false, asOf: iso(0),
        items: [build('Synthetic autumn intro', 'running', iso(-3)), build('Synthetic launch bumper', 'done', iso(-27)), build('Synthetic recall intro', 'failed', iso(-200)),
          { text: NOTE, tone: 'neutral', fix: 'brand-graphics' }] },
    },
    audiences: {
      family: {
        stats: 3, sections: ['builds', 'notes'],
        text: ['Creative · Brand Graphics', '1 brand build in progress', 'Looking here starts nothing and spends nothing', 'Open Brand Graphics',
          'Newest brand builds', 'saved result, not a publication',
          'Synthetic autumn intro', 'State: running', '3 h ago', 'Synthetic launch bumper', 'State: done', 'yesterday', 'Synthetic recall intro', 'State: failed', '8 days ago',
          'Good to know', NOTE, 'Open Brand Graphics in the cockpit'],
        statValues: { 'brand-active': '1', 'brand-failed': '1', 'brand-done-5d': '2' },
      },
    },
  };
};
