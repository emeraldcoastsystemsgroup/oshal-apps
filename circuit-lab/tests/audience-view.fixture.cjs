/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for this package's classroom audience view (ADR-164 D6): the page, its declared URL, the lab's own scripts at their served paths, synthetic read-only answers for its own routes (three circuits, one per state; all six examples; an engine whose last request failed) and what the view must show. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company audience view for the Business shells: the same reads now carry what the ledger paints (each circuit's wires, the solved circuit's last report with one warning, the failed circuit's failure_reason in the route's own '<code>: <reason>' form, a solver refusal) and the company expectations (four stats, the ledger and the failed-run list, the refusal quoted, the simulator note without the install command). The classroom expectations are unchanged.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (ADR-164 D6) expects the same card as the company one: the harness paints it in the family grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';
const SCRIPTS = ['circuit-lab-plot.js', 'circuit-lab-geometry.js', 'circuit-lab-canvas.js', 'circuit-lab-board-model.js', 'circuit-lab-board.js', 'circuit-lab.js'];
const EXAMPLES = ['led-switch', 'rc-charge', 'motor-gearbox', 'pwm-motor', 'crank-slider', 'arduino-blink'].map((id) => ({ id, title: 'Synthetic ' + id, description: 'Synthetic example ' + id + '.' }));
const parts = (n) => Array.from({ length: n }, (_, i) => ({ id: 'R' + (i + 1), type: 'resistor', x: 100 + 40 * i, y: 100, rotation: 0, props: { ohms: 1000 } }));
const wires = (n) => Array.from({ length: n }, (_, i) => ({ id: 'W' + (i + 1), from: { part: 'R' + (i + 1), pin: 'b' }, to: { part: 'R' + (i + 2), pin: 'a' } }));
// routes/simulate-service.js stores a failed solve as '<code>: <reason>'; a refusal's reason is the solver's sentence about the circuit.
const REFUSAL = 'refused: Synthetic wire W2 joins an electrical pin to a shaft pin';
const REPORT = { readings: parts(4).map((p) => ({ part: p.id, type: p.type, currentA: 0.01 })), mechanism: {}, warnings: [{ part: 'R1', message: 'Synthetic warning' }], nets: {}, netOfPin: {}, sim: {}, engineMs: 12, engineLog: '' };
const design = (id, title, state, runCount, n, updatedAt, w, report) => ({ design_id: '00000000-0000-4000-8000-00000000000' + id, owner_sub: 'synthetic-learner', title, parts: parts(n), wires: wires(w), sim: {}, run_count: runCount, state, report: report || null, failure_reason: state === 'failed' ? REFUSAL : null, source: {}, board: null, created_at: updatedAt, updated_at: updatedAt, artifacts: {} });

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
    app: 'circuit-lab', file: 'circuit-lab/tools/circuit-lab.html', url: '/api/circuit-lab/app', fullMarker: '.design-item',
    assets: SCRIPTS.map((f) => ({ url: '/api/circuit-lab/assets/' + f, file: 'circuit-lab/tools/' + f })),
    reads: {
      '/api/circuit-lab/designs': { designs: [
        design(1, 'Synthetic LED circuit', 'ran', 3, 4, iso(-1), 3, REPORT),
        design(2, 'Synthetic motor build', 'failed', 0, 5, iso(-30), 4, null),
        design(3, 'Synthetic blink test', 'draft', 0, 1, iso(-200), 0, null) ] },
      '/api/circuit-lab/examples': { examples: EXAMPLES },
      '/api/circuit-lab/capabilities': { app: 'circuit-lab', solver: 'synthetic', contract: { parts: {} }, examples: EXAMPLES,
        engine: { connected: false, buildHash: null, expectedBuildHash: 'synthetic', lastError: 'Synthetic engine refused the connection', installHint: 'synthetic-install-hint', address: 'synthetic:0' },
        catalog: { drivers: 0, unresolved: [], path: '/api/circuit-lab/catalog/drivers' } },
      '/api/circuit-lab/catalog/drivers': { drivers: [], unresolved: [] },
    },
    audiences: {
      classroom: { stats: 4, sections: ['starters', 'circuits'], text: ['Circuit Lab', 'Your circuits', '3 circuits', 'Keep building', 'Light an LED', 'Fill a capacitor', 'Synthetic LED circuit', 'Ran OK', 'Needs a fix', 'Not run yet', '1 part', 'The simulator did not answer'], statValues: { circuits: '3', ran: '1', failed: '1', draft: '1' } },
      company: { stats: 4, sections: ['saved', 'attention'], text: ['Engineering · Circuit Lab', '1 circuit failed its last run', 'Newest: Synthetic LED circuit', 'Open the newest circuit', 'Newest circuits', 'Synthetic LED circuit', 'Synthetic motor build', 'Synthetic blink test', 'Solved', 'Failed', 'Not run yet', '4 parts · 3 wires', '5 parts · 4 wires', '1 part · 0 wires', 'Failed on the last run', 'The solver refused the circuit: Synthetic wire W2 joins an electrical pin to a shaft pin', 'The last request to the simulator failed'], statValues: { circuits: '3', runs: '3', solved: '1', failed: '1' } },
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
