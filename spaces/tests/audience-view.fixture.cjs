/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Spaces family audience view (ADR-164 D6): the page, its declared URL, a synthetic read-only answer shaped like GET /api/spaces/home-summary (its four metrics with their ids and the tiles mirror, the latest three scans as items with the 'status / provider / updated_at' detail and the prepare-document action, the trailing note, asOf, partial) and what the family view must show. GET /api/spaces/scans answers only so the full page's own start has a scan list to paint without an audience; the view never reads it. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company audience (ADR-164 D6) expects the same card as the family one: the harness paints it in the company grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/**
 * @description One saved scan as GET /api/spaces/home-summary lists it (routes/home-summary.js item()).
 * @param {string} title The scan title.
 * @param {string} status queued | reconstructing | ready | failed.
 * @param {string|null} provider sim | edge | import, or null before an engine is picked.
 * @param {string} updated ISO time of the last update.
 * @returns {object} The home-summary item.
 */
function item(title, status, provider, updated) {
  const detail = status + ' / ' + (provider || 'provider pending') + ' / ' + updated;
  return { text: title, detail, tone: status === 'failed' ? 'warn' : 'neutral', fix: 'spaces-viewer',
    actions: [{ integration: 'prepare-document', context: { title, notes: detail + ' Source: synthetic.' } }] };
}

/**
 * @description The synthetic home-summary answer: counts for every state and the three most recently updated scans.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object} The route's JSON body.
 */
function summary(iso) {
  const metrics = [
    { id: 'scans-active', label: 'Scans in progress', value: '1' },
    { id: 'scans-failed', label: 'Failed scans', value: '0' },
    { id: 'scans-ready', label: 'Ready imports / captures', value: '2' },
    { id: 'sim-ready', label: 'Ready simulations', value: '1' },
  ];
  const items = [
    item('Synthetic Living Room', 'ready', 'import', iso(-3)),
    item('Synthetic Porch', 'reconstructing', 'edge', iso(-5)),
    item('Synthetic Demo Room', 'ready', 'sim', iso(-50)),
    { text: 'Caller-owned reconstruction queue and saved artifacts. Home reads metadata only.', tone: 'neutral', fix: 'spaces-viewer' },
  ];
  return { metrics, tiles: metrics, items, asOf: iso(0), partial: false };
}

/**
 * @description The scan list the full page reads on its own start (SpatialScan rows, newest first).
 * @param {(hours: number) => string} iso Timestamp helper from the harness.
 * @returns {object} The GET /api/spaces/scans body.
 */
function scans(iso) {
  return { scans: [
    { id: 's1', title: 'Synthetic Living Room', status: 'ready', provider: 'import', sourceKind: 'model', gaussianCount: 120000, error: null, createdAt: iso(-4), updatedAt: iso(-3) },
    { id: 's2', title: 'Synthetic Attic', status: 'failed', provider: null, sourceKind: 'video', gaussianCount: null, error: 'Synthetic failure', createdAt: iso(-80), updatedAt: iso(-79) },
  ] };
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
  app: 'spaces', file: 'spaces/tools/spaces.html', url: '/api/spaces/app', fullMarker: '#scan-list .scan',
  reads: {
    '/api/spaces/home-summary': summary(iso),
    '/api/spaces/scans': scans(iso),
  },
  audiences: {
    family: {
      stats: 4, sections: ['latest'],
      text: ['Spaces in 3D', '2 real spaces ready to explore', 'Latest: Synthetic Living Room, ready to explore, updated 3 h ago', 'Latest spaces',
        'Imported from a 3D scan', 'Synthetic Porch', 'Built from a walk-through video', 'Practice room, made up and not measured', 'Nothing on this page films, imports or builds a space.'],
      statValues: { real: '2', practice: '1', building: '1', failed: '0' },
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
