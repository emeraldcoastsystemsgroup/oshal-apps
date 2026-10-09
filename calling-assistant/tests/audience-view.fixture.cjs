/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Calling Assistant company audience view (ADR-164 D6): the page at its declared URL, client.js at its served path, synthetic read-only answers shaped like GET /api/calling-assistant/tasks (calling_runs rows as the route selects them: id, status, outcome, created_at, a timestamptz that reaches JSON as an ISO string; plus the tiles, items and asOf the route adds through the package's real summary helper in routes/policy.js) and what the company view must show. GET /config is answered only so the full page's own start can paint without an audience; the view never reads it. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (ADR-164 D6) expects the same card as the company one: the harness paints it in the family grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';
const path = require('node:path');
// The package's own summary (pure, no framework imports): the tiles and items below are what the route really adds.
const P = require(path.join(__dirname, '..', 'routes', 'policy.js'));
const CONNECTION = '11111111-1111-4111-8111-111111111111';

/**
 * @description The caller's saved runs, newest first, as GET /tasks selects them: the newest failed at handoff (the
 * carrier's busy signal), the one before completed, and the oldest was left uncertain when the carrier's answer was lost.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} calling_runs rows.
 */
function runs(iso) {
  return [
    { id: '00000000-0000-4000-8000-000000000003', status: 'failed', outcome: 'handoff_busy', created_at: iso(-2) },
    { id: '00000000-0000-4000-8000-000000000002', status: 'completed', outcome: 'carrier_completed', created_at: iso(-30) },
    { id: '00000000-0000-4000-8000-000000000001', status: 'uncertain', outcome: 'carrier_result_uncertain', created_at: iso(-200) },
  ];
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => {
  const config = { ...P.defaults, enabled: true, consent: true, connectionId: CONNECTION, from: '+12025550101', transferPhone: '+12025550102', publicOrigin: 'https://calling.example.test', introduction: 'Synthetic assistant calling.', allowedNumbers: ['+12025550103'] };
  const connections = [{ id: CONNECTION, label: 'Synthetic Twilio', scope: 'personal' }];
  const rows = runs(iso);
  return {
    app: 'calling-assistant', file: 'calling-assistant/ui/index.html', url: '/api/calling-assistant/app', fullMarker: '#tasks .task',
    assets: [{ url: '/api/calling-assistant/client.js', file: 'calling-assistant/ui/client.js' }],
    reads: {
      '/api/calling-assistant/tasks': { tasks: rows, ...P.summary(config, connections, rows) },
      '/api/calling-assistant/config': { config, connections, providers: [{ id: 'local-stt', configured: true }], configurationScope: 'person', executionScope: 'delegated-owner', effectiveEnabled: true, callbacksPath: '/api/calling-callbacks', version: '0.1.4' },
    },
    audiences: {
      company: {
        stats: 3, sections: ['runs', 'notes'],
        text: ['Communications · Calls', 'Calls', '3 saved runs · Calling: Ready', 'Open Calling', 'Recent runs', '2 h ago', 'failed', 'handoff busy', 'yesterday', 'completed', 'carrier completed', '8 days ago', 'uncertain', 'carrier result uncertain', 'What these numbers mean', 'Calls go out from +12025550101 over your own Twilio connection, to approved destinations only.', 'A run marked done is not proof of what the destination heard or did.'],
        statValues: { calling: 'Ready', runs: '3', last: 'handoff busy' },
      },
    },
  };
};

// ADR-164 D6: the family audience paints the same account-scoped card; every page entry expects the same text, stats and sections under it.
const __secondAudience = module.exports;
module.exports = (helpers) => {
  const entries = __secondAudience(helpers), list = Array.isArray(entries) ? entries : [entries];
  for (const entry of list) if (entry.audiences && entry.audiences.company && !entry.audiences.family) entry.audiences.family = entry.audiences.company;
  return entries;
};
Object.assign(module.exports, __secondAudience);
