/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Creative Studio family audience view (ADR-164 D6): the page, its declared URL, one synthetic read-only answer shaped like GET /api/creative-studio/home-summary (the route's three story counts with their ids, the tiles mirror, the newest story items with their '<status> · updated <ISO>' detail and draft offers, the trailing ledger note) and what the family view must show. The same answer lets the full page paint its own saved-evidence cards without an audience. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company audience (ADR-164 D6) expects the same card as the family one: the harness paints it in the company grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/**
 * @description One story item as routes/home-summary.js builds it: the idea as text, '<status> · updated <ISO>' as detail,
 * the two draft offers carrying the editable context.
 * @param {string} idea The saved idea ('story: <label>' as the Vids story route writes it).
 * @param {string} status The vids_jobs status.
 * @param {string} updated The ISO update time.
 * @returns {object} The item.
 */
function story(idea, status, updated) {
  const detail = status + ' · updated ' + updated;
  return { text: idea, detail, tone: status === 'failed' ? 'warn' : 'neutral', fix: 'creative-studio',
    actions: ['prepare-document', 'prepare-episode'].map((integration) => ({ integration, context: { title: idea, notes: detail + '\n' + idea } })) };
}

/**
 * @description The synthetic home summary: one story waiting or being made (the route's stories-active counts queued and
 * running together; this one is running), two finished in five days, one not finished, the newest three.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object} The route's JSON body.
 */
function summary(iso) {
  const metrics = [
    { id: 'stories-active', label: 'Story jobs in progress', value: '1' },
    { id: 'stories-failed', label: 'Failed story jobs', value: '1' },
    { id: 'stories-done-5d', label: 'Stories done / 5d', value: '2' },
  ];
  return { metrics, tiles: metrics, partial: false, asOf: iso(0), items: [
    story('story: Synthetic Tortoise and Hare', 'running', iso(-2)),
    story('story: Synthetic Fox and Grapes', 'done', iso(-30)),
    story('story: Synthetic Boy Who Cried Wolf', 'failed', iso(-80)),
    { text: 'Shows only the caller’s Vids story pipeline jobs, never generic clip or brand jobs. A completed story job records the worker outcome; it does not prove social publication or current remote file availability. Prepare an editable next episode or production document.', tone: 'neutral', fix: 'creative-studio' },
  ] };
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
  app: 'creative-studio', file: 'creative-studio/tools/review.html', url: '/api/creative-studio/review', fullMarker: '#metrics .metric',
  reads: { '/api/creative-studio/home-summary': summary(iso) },
  audiences: {
    family: {
      stats: 4, sections: ['stories'],
      text: ['Story videos', '1 story video waiting or being made', 'Waiting or being made',
        'Newest: Synthetic Tortoise and Hare (being made now, updated 2 h ago).', 'Newest story videos',
        'Synthetic Fox and Grapes', 'Finished', 'updated yesterday', 'Synthetic Boy Who Cried Wolf', 'Did not finish', 'updated 3 days ago',
        'Only the story videos made for this account show here.', 'Open Creative Studio'],
      statValues: { active: '1', finished: '2', unfinished: '1', latest: '2 h ago' },
    },
  },
});

// ADR-164 D6: the company audience paints the same account-scoped card; every page entry expects the same text, stats and sections under it.
const __secondAudience = module.exports;
module.exports = (helpers) => {
  const entries = __secondAudience(helpers), list = Array.isArray(entries) ? entries : [entries];
  for (const entry of list) if (entry.audiences && entry.audiences.family && !entry.audiences.company) entry.audiences.company = entry.audiences.family;
  return entries;
};
