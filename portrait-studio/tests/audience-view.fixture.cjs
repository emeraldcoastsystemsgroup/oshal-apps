/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Portrait Studio family audience view (ADR-164 D6): the page, its declared URL, synthetic read-only answers shaped like GET /api/portrait-studio/portraits (ps_portraits rows newest first: portrait_id, title, mode, style, status, error, model, cost_usd, created_at, updated_at, subjects) and /catalog (clientCatalog with synthetic presets), and what the family view must show. /permissions answers only so the full page's own start reaches its gallery without an audience; the view never reads it. /provider is deliberately not answered (the view never reads it; the full page shows its engine banner). The two package modules the page loads by src are served from tools/ so the full page runs as deployed. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company audience (ADR-164 D6) expects the same card as the family one: the harness paints it in the company grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/** The static style catalog as GET /catalog shapes it, with synthetic presets and no layers. */
const CATALOG = {
  presets: {
    professional: [{ id: 'syn-boardroom', label: 'Synthetic Boardroom', icon: '🏢', blurb: 'Synthetic', group: 'Synthetic', background: '', attire: '', headwear: '', finish: '', framing: '' }],
    character: [{ id: 'syn-farmer', label: 'Synthetic Gothic Farmer', icon: '🌾', blurb: 'Synthetic', group: 'Synthetic', background: '', attire: '', headwear: '', finish: '', framing: '' }],
    group: [{ id: 'syn-heroes', label: 'Synthetic Hero Team', icon: '🦸', blurb: 'Synthetic', group: 'Synthetic', background: '', attire: '', headwear: '', finish: '', framing: '' }],
  },
  groupLimits: { min: 2, max: 6 }, backgrounds: [], attire: [], headwear: [], props: [], finishes: [], framings: [],
};

/**
 * @description The synthetic gallery as GET /portraits returns it, newest first: one group portrait being made, two
 * finished (one titled, one named from the catalog) and one that did not finish.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} ps_portraits rows.
 */
function portraits(iso) {
  const row = (id, hours, over) => ({ portrait_id: id, title: null, mode: 'professional', style: 'syn-boardroom', status: 'done', error: null, model: 'synthetic-image', cost_usd: '0.040000', created_at: iso(hours), updated_at: iso(hours), subjects: null, ...over });
  return [
    row('00000000-0000-4000-8000-000000000001', -0.1, { mode: 'group', style: 'syn-heroes', status: 'generating', subjects: 4 }),
    row('00000000-0000-4000-8000-000000000002', -3, { title: 'Synthetic Office Headshot' }),
    row('00000000-0000-4000-8000-000000000003', -50, { mode: 'character', style: 'syn-farmer' }),
    row('00000000-0000-4000-8000-000000000004', -200, { status: 'failed', error: 'Synthetic provider refused the photo' }),
  ];
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
  app: 'portrait-studio', file: 'portrait-studio/tools/portrait-studio.html', url: '/api/portrait-studio/app', fullMarker: '#galleryGrid .g-item',
  assets: [
    { url: '/api/portrait-studio/capture-module', file: 'portrait-studio/tools/portrait-capture.js' },
    { url: '/api/portrait-studio/face-module', file: 'portrait-studio/tools/portrait-face.js' },
  ],
  reads: {
    '/api/portrait-studio/portraits': { portraits: portraits(iso) },
    '/api/portrait-studio/catalog': CATALOG,
    '/api/portrait-studio/permissions': { permissions: { view: true, read: true, create: true, change: true, delete: true, export: true, email: true, artist: false }, unavailable: { email: 'portrait_mail_identity_unavailable' } },
  },
  audiences: {
    family: {
      stats: 4, sections: ['ready', 'waiting', 'failed'],
      text: ['Our portraits', '1 portrait on the way', 'Newest: Synthetic Hero Team, being made now, started just now.', 'Open Portrait Studio',
        'Ready to see', 'Synthetic Office Headshot', 'Headshot · Synthetic Boardroom', 'started 3 h ago', 'Synthetic Gothic Farmer', 'Character portrait', 'started 2 days ago',
        'Tap a portrait to open the picture in a new tab.', 'On the way', 'Group of 4 · Being made now', 'Did not finish', 'Headshot · Did not finish', 'started 8 days ago',
        'Open Portrait Studio to see why and to make a new one.'],
      statValues: { ready: '2', waiting: '1', failed: '1', newest: 'just now' },
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
