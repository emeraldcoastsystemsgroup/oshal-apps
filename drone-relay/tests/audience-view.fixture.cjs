/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Drone Relay company audience view (ADR-164 D6): the page, its declared URL, the surface script's asset route, and synthetic read-only answers built by the package's REAL deterministic engine (routes/engine: validateSpec, planChain, simulate), so every chain is shaped exactly as the store keeps it: six chains (a restored corridor, a lattice whose last run lost the tip, a degraded tight corridor, a tree that held, a chain the fleet cannot fill, a LoRa corridor not run yet) as GET /api/drone-relay/plans lists them (last_metrics in place of the run, roster, designUrl), the newest chain with its whole stored run as GET /plans/:id answers it, the capabilities and the transport comparison, so the full page boots and draws that chain without the parameter; and what the company view must show. The same chains, in the store's row shape, are exported for tests/audience-view.test.cjs to feed through the real route. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (ADR-164 D6) expects the same card as the company one: the harness paints it in the family grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';
const path = require('node:path');

const E = require(path.join(__dirname, '..', 'routes', 'engine'));
const API = '/api/drone-relay';
const SUB = 'synthetic-sub';
const TIGHT_AREA = [{ x: 2500, y: -400 }, { x: 3300, y: -400 }, { x: 3300, y: 400 }, { x: 2500, y: 400 }];

/** The synthetic chains, newest first: what each one is sized from, the scenario its stored run came from, and its age in hours. */
const CHAINS = [
  { id: '00000000-0000-4000-8000-000000000001', title: 'Synthetic River Run', hours: -1,
    spec: { fleetSize: 6, enduranceS: 1800 }, scenario: { durationS: 300, events: [{ atS: 60, kind: 'fail', drone: 'r2' }] } },
  { id: '00000000-0000-4000-8000-000000000002', title: 'Synthetic Ridge Survey', hours: -3,
    spec: { area: TIGHT_AREA, requiredMarginDb: 2, degradedMarginDb: 0, spacingFactor: 0.9, fleetSize: 12, enduranceS: 1800 }, scenario: { durationS: 200, events: [{ atS: 60, kind: 'fail', drone: 'r2' }] } },
  { id: '00000000-0000-4000-8000-000000000003', title: 'Synthetic Canyon Chain', hours: -26,
    spec: { spacingFactor: 1, fleetSize: 2 }, scenario: { durationS: 60, events: [{ atS: 10, kind: 'fail', drone: 'r1' }] } },
  { id: '00000000-0000-4000-8000-000000000004', title: 'Synthetic Fork Line', hours: -72,
    spec: { path: [{ x: 0, y: 0, z: 0 }, { x: 400, y: 0, z: 0 }], branches: [[{ x: 700, y: 200, z: 0 }], [{ x: 700, y: -200, z: 0 }]], fleetSize: 8 }, scenario: { durationS: 30 } },
  { id: '00000000-0000-4000-8000-000000000005', title: 'Synthetic Long Haul', hours: -240, spec: { fleetSize: 1 }, scenario: null },
  { id: '00000000-0000-4000-8000-000000000006', title: 'Synthetic Orchard Line', hours: -288,
    spec: { transport: 'lora-915', tipDataKbps: 1, path: [{ x: 0, y: 0, z: 0 }, { x: 3000, y: 0, z: 0 }] }, scenario: null },
];

/**
 * @description The synthetic chains as drone_relay_plan rows (the stored shape getPlan selects): the validated spec, the plan
 * sized from it and the whole stored run, all from the real engine.
 * @param {(hours: number) => (string|Date)} at The timestamp for an age in hours (an ISO string in the browser, a Date as pg
 *   returns a timestamptz column in the unit test).
 * @returns {object[]} Rows, newest first.
 */
function chainRows(at) {
  return CHAINS.map((c) => {
    const spec = E.validateSpec(Object.assign({ title: c.title }, c.spec));
    const plan = E.planChain(spec);
    const sim = c.scenario ? E.simulate(spec, plan, E.validateScenario(c.scenario, plan)) : null;
    const when = at(c.hours);
    return { plan_id: c.id, owner_sub: SUB, title: c.title, spec, plan, last_sim: sim, created_at: when, updated_at: when };
  });
}

/**
 * @description A stored row as listPlans selects it: the last run's metrics stand in for the whole run.
 * @param {object} row A chainRows row.
 * @returns {object} The list row.
 */
function listRow(row) {
  const { last_sim: sim, ...rest } = row;
  return Object.assign(rest, { last_metrics: sim ? sim.metrics : null });
}

/**
 * @description A row as the API returns it (publicPlan in routes/plan-routes.js): the row plus its roster and write-up URL.
 * @param {object} row A stored or list row.
 * @returns {object} The public shape.
 */
function publicShape(row) {
  return Object.assign({}, row, { roster: E.rosterIds(row.plan), designUrl: API + '/plans/' + row.plan_id + '/design.md' });
}

/** @returns {object} GET /capabilities as routes/drone-relay-routes.js answers it (the full page reads it first). */
function capabilities() {
  return { app: 'drone-relay', transports: E.TRANSPORTS, limits: E.SPEC_LIMITS, groundNodes: E.GROUND_NODE_LIMITS, branches: E.BRANCH_LIMITS, lattice: E.LATTICE_LIMITS, scenario: E.SCENARIO_LIMITS,
    defaults: E.validateSpec({}), gapPolicies: ['retreat', 'hold-degraded'], postures: E.POSTURES, controlChannels: E.controlChannelIds(), heartbeatBytes: E.HEARTBEAT_BYTES,
    envelope: { maxRoute: E.MAX_ROUTE, baseId: E.BASE_ID }, model: 'log-distance path loss on datasheet numbers; the range test replaces it' };
}

/** @param {object} q The query string. @returns {object} GET /transports as the route answers it: every catalog budget at one distance. */
function transports(q) {
  const p = { distanceM: Number(q.distanceM) || 500, requiredMarginDb: Number(q.requiredMarginDb) || 10, exponent: Number(q.exponent) || E.DEFAULT_PATH_LOSS_EXPONENT };
  return Object.assign(p, { budgets: E.compareTransports(p.distanceM, p.requiredMarginDb, p.exponent) });
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => {
  const rows = chainRows(iso);
  return {
    app: 'drone-relay', file: 'drone-relay/tools/drone-relay.html', url: API + '/app', fullMarker: '#plan-facts dd',
    assets: [{ url: API + '/assets/drone-relay.js', file: 'drone-relay/tools/drone-relay.js' }],
    reads: {
      [API + '/plans']: { plans: rows.map((r) => publicShape(listRow(r))) },
      [API + '/plans/' + rows[0].plan_id]: { plan: publicShape(rows[0]) },
      [API + '/capabilities']: capabilities(),
      [API + '/transports']: (req) => transports(req.query),
    },
    audiences: {
      company: {
        stats: 4, sections: ['chains', 'attention'],
        text: ['Engineering · Drone Relay', '1 chain lost the tip in its last run', 'Newest: Synthetic River Run, changed 1 h ago.',
          'Newest relay chains', 'Synthetic River Run', 'Corridor · 1 km · ESP-NOW', '4 + 2 spares', '200 m · 15.2 dB', 'Restored · no outage', '1 h ago',
          'Synthetic Ridge Survey', 'Lattice · 11 slots · ESP-NOW', '11 + 1 spare', '716 m · 3.0 dB', 'Lost · tip out 140 s', '3 h ago',
          'Synthetic Canyon Chain', '2 · no spare', '333 m · 10.3 dB', 'Degraded · no outage', 'yesterday',
          'Synthetic Fork Line', 'Tree · 2 branches · ESP-NOW', '4 + 4 spares', 'Held · no outage', '3 days ago',
          'Synthetic Long Haul', '4 · no spare', 'Not feasible as sized', '10 days ago',
          'Synthetic Orchard Line', 'Corridor · 3 km · LoRa 915 MHz', '0 + 6 spares', '3 km · 34.8 dB', 'Not run yet', '12 days ago',
          'Needs a look', 'Last run lost the tip: out of reach 140 s of 200 s; worst hop margin 3.0 dB.',
          'the corridor needs 4 relays at a 207 m hop and the fleet has 1', 'worst hop margin 3.7 dB.', 'Open the chain designer'],
        statValues: { chains: '6', feasible: '5', holding: '2', lost: '1' },
      },
    },
  };
};
module.exports.chainRows = chainRows;
module.exports.listRow = listRow;
module.exports.SUB = SUB;

// ADR-164 D6: the family audience paints the same account-scoped card; every page entry expects the same text, stats and sections under it.
const __secondAudience = module.exports;
module.exports = (helpers) => {
  const entries = __secondAudience(helpers), list = Array.isArray(entries) ? entries : [entries];
  for (const entry of list) if (entry.audiences && entry.audiences.company && !entry.audiences.family) entry.audiences.family = entry.audiences.company;
  return entries;
};
Object.assign(module.exports, __secondAudience);
