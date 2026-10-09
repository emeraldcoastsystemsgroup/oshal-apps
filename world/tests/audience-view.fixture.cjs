/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the World Intelligence company audience view (ADR-164 D6). World has no page file: GET /api/world/app sends WORLD_APP_HTML from the compiled route module, so the fixture writes that exact string (routes/world-app-html.js) to a temporary file and names it relative to the store root, which is how the harness serves a page. Synthetic read-only answers are shaped like GET /api/world/entities (entity, label, items, ISO lastSeen or null), /home-summary (four metrics with pg text counts and one 'Unavailable', headlines with and without a sourceUrl, one highlight event, the coverage note last) and /pulls (per-source counts, a 0..1 freshRate or null, lastPull), with what the company view must show. Sentiment, neighbours and metric reads are deliberately absent: the view must not make them. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (ADR-164 D6) expects the same card as the company one: the harness paints it in the family grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * @description Write the page the route serves to a temporary file and return its path relative to the store root.
 * @returns {string} A store-relative path the harness can join onto its root.
 */
function servedPage() {
  const store = path.resolve(__dirname, '..', '..');
  const file = path.join(os.tmpdir(), 'oshal-world-audience-view-' + process.pid + '.html');
  fs.writeFileSync(file, require('../routes/world-app-html.js').WORLD_APP_HTML);
  process.once('exit', () => fs.rmSync(file, { force: true }));
  const rel = path.relative(store, file);
  if (path.isAbsolute(rel)) throw new Error('world audience fixture: the temporary directory must be on the store checkout\x27s drive (' + file + ')');
  return rel;
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
  app: 'world', file: servedPage(), url: '/api/world/app', fullMarker: '#subjects',
  reads: {
    '/api/world/entities': { entities: [
      { entity: 'world:topic:synthetic-energy', label: 'Synthetic energy', items: 1840, lastSeen: iso(-2) },
      { entity: 'world:topic:synthetic-health', label: 'Synthetic health', items: 912, lastSeen: iso(-40) },
      { entity: 'world:org:synthetic-co', label: 'Synthetic Co', items: 3, lastSeen: null },
    ] },
    '/api/world/home-summary': {
      metrics: [{ id: 'fetched-24h', label: 'Fetched / 24h', value: '1204' }, { id: 'new-subject-items-24h', label: 'New subject items / 24h', value: '96' }, { id: 'subjects-24h', label: 'Subjects pulled / 24h', value: '14' }, { id: 'pulls-24h', label: 'Feed pulls / 24h', value: 'Unavailable' }],
      items: [
        { text: 'Synthetic refinery restarts', detail: 'Synthetic Wire · Synthetic energy · Published Sep 27, 2:00 PM UTC.', sourceUrl: 'https://news.example.test/synthetic', tone: 'neutral', actions: [] },
        { text: 'Synthetic clinic opens', detail: 'Synthetic Daily · Synthetic health · Published Sep 27, 1:00 PM UTC.', tone: 'neutral', actions: [] },
        { text: 'Upcoming: Synthetic producers meeting', detail: 'Recorded event · world:topic:synthetic-energy · Sep 30, 9:00 AM UTC · synthetic-calendar', highlight: true, tone: 'neutral' },
        { text: 'Published within 48 hours · three-topic coverage sample.', detail: 'Samples the latest 100 saved items per baseline topic. Last pull: Sep 27, 3:00 PM UTC.', tone: 'neutral' },
      ],
      asOf: iso(0), partial: false,
    },
    '/api/world/pulls': { entity: 'world:topic:synthetic-energy', days: 30, archivedItems: 412, bySource: [
      { feedId: 'synthetic-news', pulls: 60, fetched: 900, uniqueItems: 700, newItems: 180, classified: 180, freshRate: 0.2, lastPull: iso(-1) },
      { feedId: 'synthetic-wire', pulls: 2, fetched: 0, uniqueItems: 0, newItems: 0, classified: 0, freshRate: null, lastPull: null },
    ] },
  },
  audiences: {
    company: {
      stats: 5, sections: ['subjects', 'headlines', 'upcoming', 'pulls'],
      text: ['World Intelligence', 'Coverage desk', 'Most covered: Synthetic energy (1,840 items).', 'every member sees the same coverage', 'Seen in 24 h', 'Nothing new in 24 h', 'Never seen',
        'Synthetic refinery restarts', 'Synthetic clinic opens', 'Last pull: Sep 27, 3:00 PM UTC.', 'Synthetic producers meeting', 'Recorded event', 'Pull-rate · Synthetic energy · 30 days',
        'synthetic-news', '20%', '412 new items archived for Synthetic energy in 30 days.', 'Could not be read'],
      statValues: { subjects: '3', 'fetched-24h': '1,204', 'new-subject-items-24h': '96', 'pulls-24h': '—', 'subjects-24h': '14' },
    },
  },
});

// ADR-164 D6: the family audience paints the same account-scoped card; every page entry expects the same text, stats and sections under it.
const __secondAudience = module.exports;
module.exports = (helpers) => {
  const entries = __secondAudience(helpers), list = Array.isArray(entries) ? entries : [entries];
  for (const entry of list) if (entry.audiences && entry.audiences.company && !entry.audiences.family) entry.audiences.family = entry.audiences.company;
  return entries;
};
Object.assign(module.exports, __secondAudience);
