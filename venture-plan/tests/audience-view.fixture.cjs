/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for this package's audience views (ADR-164 D6): the page, its declared URL, synthetic read-only answers for its own routes (the venture list, each venture header, the Home summary, and the reads the full console makes when it auto-selects the first venture) in the shapes those routes send, and what the company audience must show. Consumed by scripts/audience-views.browser.cjs in headless Chromium and by tests/audience-view.test.cjs; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The header coverage was invented in the engine's confidence words (quoted/observed/benchmarked/estimated/guessed), a shape GET /ventures/:id never sends, so the view's evidence section passed here and painted "0 of N" on real data. Each header's coverage is now built by the package's own coverageOf (routes/venture-store.js, loaded with only the framework logger stubbed) from synthetic live assumptions, so it carries bySourceKind over the store's source kinds and byConfidence over low/medium/high exactly as the route does; the Home summary's model-estimate count now matches the model estimates in those assumptions. coverageOf is also exposed on the export for the unit test.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (ADR-164 D6) expects the same card as the company one: the harness paints it in the family grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';
const path = require('node:path');

/**
 * @description Load the package's own coverage roll-up (routes/venture-store.js coverageOf) with the framework logger
 * stubbed at the require layer for this one require, so the header coverage below is what GET /ventures/:id really
 * sends and a vocabulary drift between the store and the view goes red instead of being hidden by an invented shape.
 * @returns {(assumptions: Array<{sourceKind: string, confidence: string}>) => object} The store's coverageOf.
 */
function storeCoverageOf() {
  const Module = require('node:module');
  const load = Module._load;
  const logger = { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) };
  Module._load = function stubbed(request, ...rest) { return request === '@/shared/logger' ? logger : load.call(this, request, ...rest); };
  try { return require(path.join(__dirname, '..', 'routes', 'venture-store.js')).coverageOf; } finally { Module._load = load; }
}
const coverageOf = storeCoverageOf();

/**
 * @description Synthetic live assumptions in the two fields coverageOf reads, from [sourceKind, confidence, count] groups.
 * @param {Array<[string, string, number]>} groups Source kind, confidence and how many assumptions carry them.
 * @returns {Array<{sourceKind: string, confidence: string}>} The assumption rows.
 */
function assumptions(groups) {
  return groups.flatMap(([sourceKind, confidence, n]) => Array.from({ length: n }, () => ({ sourceKind, confidence })));
}

/**
 * @description One venture as GET /api/venture/ventures lists it (targetLaunchDate is a date-only string).
 * @param {string} id Venture id.
 * @param {string} name Synthetic name.
 * @param {object} extra Fields that differ per venture.
 * @returns {object} The list row.
 */
function venture(id, name, extra) {
  return { id, name, ideaText: name + ' idea', spec: {}, currency: 'USD', targetLaunchDate: null, stage: 'scoped', horizonMonths: 24, openQuestions: [], createdAt: '2026-08-01T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z', ...extra };
}

/**
 * @description A run header as GET /ventures/:id returns it in latestRun.
 * @param {string} id Run id.
 * @param {object} extra kind, status, phase, bot counts, trigger and start time.
 * @returns {object} The run summary.
 */
function run(id, extra) {
  return { id, ventureId: 'v', phase: null, phases: [], botsRequested: 1, botsCompleted: 0, triggerKind: 'manual', scheduleSlot: null, costCapMicros: null, costSpentMicros: 0, costStatus: 'not-capped', error: null, finishedAt: null, ...extra };
}

/**
 * @description A venture header (GET /api/venture/ventures/:id) around one list row; its coverage is the store's own
 * coverageOf over the venture's live assumptions, as the route computes it.
 * @param {object} v The list row.
 * @param {Array<{sourceKind: string, confidence: string}>} live The venture's live assumptions.
 * @param {object|null} latestModel The latest base-model summary.
 * @param {object|null} latestRun The latest run.
 * @returns {object} The header payload.
 */
function detail(v, live, latestModel, latestRun) {
  return { venture: v, scenarios: [], counts: { assumptions: live.length, bomLines: 0, vendors: 0, quotes: 0, fxAssumptions: 0 },
    coverage: coverageOf(live), latestModel, latestRun, fxAssumptions: [], documentCatalog: [] };
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => {
  const lamp = venture('v-1', 'Synthetic lamp', { stage: 'modelled', targetLaunchDate: '2027-03-01', updatedAt: iso(-2) });
  const kettle = venture('v-2', 'Synthetic kettle', { stage: 'documented', updatedAt: iso(-26) });
  const rack = venture('v-3', 'Synthetic bike rack', { stage: 'scoped', targetLaunchDate: '2026-12-15', openQuestions: ['Synthetic question one?', 'Synthetic question two?'], updatedAt: iso(-60) });
  // Five of the lamp's twelve assumptions are model estimates (41.7%); the kettle has none; the rack has no assumptions.
  const lampLive = assumptions([['vendor-quote', 'high', 2], ['published-source', 'medium', 1], ['user-entered', 'medium', 2], ['derived', 'medium', 2], ['model-estimate', 'low', 5]]);
  const kettleLive = assumptions([['vendor-quote', 'high', 6], ['published-source', 'medium', 2], ['user-entered', 'high', 1], ['derived', 'medium', 1]]);
  const summary = [{ id: 'saved-ventures', label: 'Saved ventures', value: '3' }, { id: 'estimated-assumptions', label: 'Model estimates', value: '5' }];
  return {
    app: 'venture-plan', file: 'venture-plan/tools/venture.html', url: '/api/venture/', fullMarker: '#vlist .vitem',
    reads: {
      '/api/venture/ventures': { ventures: [lamp, kettle, rack] },
      '/api/venture/ventures/v-1': detail(lamp, lampLive,
        { id: 'm-1', computedAt: iso(-6), posture: 'estimate', canPublish: false, warnings: 2 }, run('r-1', { kind: 'full', status: 'done', phase: 'deliver', botsRequested: 4, botsCompleted: 4, startedAt: iso(-8), finishedAt: iso(-7) })),
      '/api/venture/ventures/v-2': detail(kettle, kettleLive,
        { id: 'm-2', computedAt: iso(-30), posture: 'quoted', canPublish: true, warnings: 0 }, run('r-2', { kind: 'market', status: 'running', phase: 'assume', botsRequested: 2, botsCompleted: 1, triggerKind: 'scheduled', startedAt: iso(-0.2) })),
      '/api/venture/ventures/v-3': detail(rack, [],
        null, run('r-3', { kind: 'bom', status: 'failed', phase: 'assume', botsRequested: 1, botsCompleted: 1, startedAt: iso(-50), finishedAt: iso(-50), error: 'Synthetic failure' })),
      '/api/venture-plan/home-summary': { metrics: summary, tiles: summary, items: [], asOf: iso(0), partial: false },
      // Read by the full console only, when it auto-selects the first venture (never by the company view).
      '/api/venture/ventures/v-1/assumptions': { assumptions: [] },
      '/api/venture/ventures/v-1/model': { model: { id: 'm-1', ventureId: 'v-1', scenarioId: null, figures: {}, tables: {}, coverage: coverageOf(lampLive),
        warnings: ['Synthetic warning one', 'Synthetic warning two'], posture: 'estimate', canPublish: false, computedAt: iso(-6) } },
      '/api/venture/ventures/v-1/documents': { documents: [], catalog: [] },
    },
    audiences: {
      company: {
        stats: 5, sections: ['portfolio', 'attention', 'runs', 'evidence'],
        text: ['Venture Plan', 'Portfolio', '3 saved ventures · 5 model estimates to replace with quotes', 'Synthetic lamp', 'Synthetic kettle', 'Synthetic bike rack', 'Modelled', 'Estimate', 'Will not publish', 'Publishable', 'No model yet', '42%',
          'Market run in progress', 'Bill of materials run failed at assume', '2 open questions from scoping', 'Evidence behind the numbers', 'Vendor quote', '8 of 22', 'Model estimate', '5 of 22'],
        statValues: { 'saved-ventures': '3', 'model-estimates': '5', publishable: '1', 'runs-running': '1', 'open-questions': '2' },
      },
    },
  };
};
module.exports.coverageOf = coverageOf;

// ADR-164 D6: the family audience paints the same account-scoped card; every page entry expects the same text, stats and sections under it.
const __secondAudience = module.exports;
module.exports = (helpers) => {
  const entries = __secondAudience(helpers), list = Array.isArray(entries) ? entries : [entries];
  for (const entry of list) if (entry.audiences && entry.audiences.company && !entry.audiences.family) entry.audiences.family = entry.audiences.company;
  return entries;
};
Object.assign(module.exports, __secondAudience);
