/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Sat Ops company audience view (ADR-164 D6): the page, its declared URL, synthetic read-only answers shaped like GET /api/sat/fleet (SatFleetSummary rows: satId, engine, online, lastSeenMs, telemetry with mode, pointing error and the ADCS readout) and GET /api/sat/catalog (TleCatalogEntry rows: satId, name, satnum, tleRaw, updatedUtcMs), and what the company view must show. The full page (no audience) computes a ground track with POST /api/sat/track for every catalog row as soon as its catalog read lands, which is its own unchanged behaviour, so its catalog read is answered as an empty catalog (told apart by the Referer, which carries ?audience= only for the view) and the harness's no-writes rule still holds; its fleet read paints the fleet list the full-page marker waits for. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (ADR-164 D6) expects the same card as the company one: the harness paints it in the family grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/**
 * @description One node's heartbeat telemetry as the fleet registry keeps it.
 * @param {string} mode The ADCS mode (SAFE, DETUMBLE, SLEW, POINT, DESAT).
 * @param {number|null} pointingErrorDeg Pointing error in degrees, null when the node has no pointing target.
 * @param {number} momentumFrac Wheel momentum as a fraction of saturation.
 * @returns {object} The telemetry snapshot.
 */
function telemetry(mode, pointingErrorDeg, momentumFrac) {
  return { mode, pointingErrorDeg, attitudeCalibrated: true,
    state: { t: 42, q: { w: 1, x: 0, y: 0, z: 0 }, omega: { x: 0, y: 0, z: 0 }, wheelMomentum: { x: 0, y: 0, z: 0 } },
    adcs: { reason: 'synthetic', timeInModeS: 8, transitionCount: 3, momentumFrac, dumping: false, hasTarget: mode === 'POINT' || mode === 'SLEW' } };
}

/**
 * @description The synthetic fleet as GET /api/sat/fleet lists it: one stale node first (as insertion order may put it),
 * then two recent nodes.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} SatFleetSummary rows.
 */
function fleet(iso) {
  const ms = (h) => Date.parse(iso(h));
  return [
    { satId: 'synthetic-old', engine: 'rk4', online: false, lastSeenMs: ms(-2), telemetry: telemetry('SAFE', null, 0.9) },
    { satId: 'synthetic-leader', engine: 'rk4', online: true, lastSeenMs: ms(-0.001), telemetry: telemetry('POINT', 0.1234, 0.42) },
    { satId: 'synthetic-polar', engine: 'nasa42', online: true, lastSeenMs: ms(0), telemetry: telemetry('SLEW', 12.5, 0.071) },
  ];
}

/**
 * @description The catalog answer: three loaded element sets for the audience view, none for the full page (see the Change Log).
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {(req: object) => object} The route body for a request.
 */
function catalog(iso) {
  const row = (satId, name, satnum, h) => ({ satId, name, satnum, tleRaw: '1 ' + satnum + 'U SYNTHETIC\n2 ' + satnum + ' SYNTHETIC', updatedUtcMs: Date.parse(iso(h)) });
  const loaded = { catalog: [row('synthetic-leader', 'SYNTHETIC LEADER', 90001, -26), row('synthetic-chaser', null, 90002, -5), row('synthetic-old', 'SYNTHETIC OLD', 90004, -100)] };
  return (req) => (/[?&]audience=/.test(String(req.get('referer') || '')) ? loaded : { catalog: [] });
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
  app: 'sat-ops', file: 'sat-ops/tools/sat-ops.html', url: '/api/sat/app', fullMarker: '#fleetList .sat-row',
  reads: {
    '/api/sat/fleet': { fleet: fleet(iso) },
    '/api/sat/catalog': catalog(iso),
  },
  audiences: {
    company: {
      stats: 4, sections: ['fleet', 'orbits'],
      text: ['Engineering · Sat Ops', '2 of 3 simulated sats heartbeating', 'Simulation only: every engine is a simulator and nothing here sends a command.',
        'Open the fleet plane', 'Fleet (attitude nodes)', 'Heartbeat is the fleet registry’s own reading.',
        'synthetic-polar', 'NASA 42 sim', 'SLEW', '12.50°', '7%', 'synthetic-leader', 'RK4 sim', 'POINT', '0.12°', '42%', 'just now',
        'synthetic-old', 'Stale', 'SAFE', '90%', '2 h ago',
        'Orbit catalog (TLE)', 'not orbit-quality certification', 'synthetic-chaser', '90002', 'None', '5 h ago',
        'SYNTHETIC LEADER', '90001', 'Recent heartbeat', 'yesterday', 'SYNTHETIC OLD', '90004', 'Stale heartbeat', '4 days ago'],
      statValues: { nodes: '3', recent: '2', stale: '1', orbits: '3' },
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
