/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the AI Bake-Off company audience view (ADR-164 D6): the review page, its declared URL, two synthetic read-only answers shaped like GET /api/bake-off/home-summary (routes/home-summary.js: the four counts as digit strings, mirrored as tiles; one item per run, newest started first, whose detail is '<status> / started <iso>' and whose one prepare-document offer carries the route's lane sentence with NUMERIC columns as text; then the ownership note) and GET /api/bake-off/jobs (bake-off-store toJob: numbers, JSONB arrays, ISO instants), and what the company view must show. The view never starts a run, never asks for a verdict and writes nothing; the harness still answers every non-GET with 405 and records it. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (ADR-164 D6) expects the same card as the company one: the harness paints it in the family grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

const OWNERSHIP = 'Benchmark jobs and runs are owner-scoped through their parent job, and each result must match the same owner. A missing or zero observed lane cost stays unknown, never free. The selected lane is only the best scored successful observation in that run, not a universal model recommendation. Prepare a comparison document without running a benchmark or changing providers.';

/**
 * @description The route's four metrics for an account with three saved benchmarks, one run in progress, one failed run
 * on record and two runs completed in five days. The route mirrors this array as `tiles`.
 * @returns {object[]} Metrics with digit-string values.
 */
function metrics() {
  return [
    { id: 'saved-benchmarks', label: 'Saved benchmarks', value: '3' },
    { id: 'runs-active', label: 'Benchmarks running', value: '1' },
    { id: 'runs-failed', label: 'Failed benchmark runs', value: '1' },
    { id: 'completed-5d', label: 'Runs completed / 5d', value: '2' },
  ];
}

/**
 * @description One run item as the route emits it: the job name, the detail, the tone and the one offer whose notes
 * are the detail and the lane sentence (clip collapses the newline between them to a space).
 * @param {string} name The job name.
 * @param {string} status running | complete | failed.
 * @param {string} started The ISO instant of started_at.
 * @param {Array} lane [completed, requested, model|null, score text|null, judge mode|null, cost text|null].
 * @returns {object} The item.
 */
function run(name, status, started, lane) {
  const [done, asked, model, score, mode, cost] = lane;
  const detail = status + ' / started ' + started;
  const body = 'Recorded lanes ' + done + ' of ' + asked + '. Best recorded successful lane by score: ' + (model || 'model not captured') + '; score ' + (score || 'unavailable') + '; judge mode ' + (mode || 'unknown') + '; observed USD cost ' + (Number(cost) > 0 ? cost : 'unknown') + '. Compare rubric and unscored lanes in Bake-Off before selecting a model.';
  return { text: name, detail, tone: status === 'failed' ? 'warn' : 'neutral', fix: 'bake-off-home', actions: [{ integration: 'prepare-document', context: { title: name, notes: detail + ' ' + body } }] };
}

/**
 * @description The three newest runs, newest started first: one in progress, one complete on the lexical fallback
 * judge with a sub-cent cost, one failed with no successful lane.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} Run items.
 */
function runs(iso) {
  return [
    run('Synthetic ticket triage', 'running', iso(-1), [0, 4, 'claude-sonnet-4-5', '88.50', 'llm', '0.042100']),
    run('Synthetic release notes', 'complete', iso(-27), [3, 3, 'qwen2.5:7b', '74.00', 'lexical-fallback', '0.000400']),
    run('Synthetic SQL review', 'failed', iso(-200), [0, 3, null, null, null, null]),
  ];
}

/**
 * @description Three saved jobs as GET /jobs returns them, newest created first.
 * @param {(hours: number) => string} iso Timestamp helper from the harness.
 * @returns {object} The route body.
 */
function jobs(iso) {
  const job = (name, bar, volume, lanes, created) => ({ id: 'job-' + name.length, ownerSub: 'synthetic-sub', name, prompt: 'Synthetic prompt long enough to separate one lane from another.', rubric: ['Synthetic criterion'], reference: null, qualityBar: bar, monthlyVolume: volume, laneAgentIds: lanes, createdAt: created, updatedAt: created });
  return { jobs: [
    job('Synthetic ticket triage', 80, 1200, [], iso(-192)),
    job('Synthetic release notes', 72.5, 30, ['lane-a', 'lane-b'], iso(-400)),
    job('Synthetic SQL review', 70, 1, ['lane-c'], iso(-600)),
  ] };
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => {
  const m = metrics();
  return {
    app: 'bake-off', file: 'bake-off/tools/review.html', url: '/api/bake-off/review', fullMarker: '#metrics .metric',
    reads: {
      '/api/bake-off/home-summary': { metrics: m, tiles: m, items: runs(iso).concat([{ text: OWNERSHIP, tone: 'neutral', fix: 'bake-off-home' }]), asOf: iso(0), partial: false },
      '/api/bake-off/jobs': jobs(iso),
    },
    audiences: {
      company: {
        stats: 4, sections: ['runs', 'benchmarks', 'notes'],
        text: ['Engineering · AI Bake-Off', '1 benchmark run in progress', 'Open AI Bake-Off Review', 'Newest benchmark runs',
          'Synthetic ticket triage', 'running', '0 of 4', 'claude-sonnet-4-5', '88.5', 'LLM judge', '$0.04', '1 h ago',
          'Synthetic release notes', 'complete', '3 of 3', 'qwen2.5:7b', 'lexical fallback', '< $0.01', 'yesterday',
          'Synthetic SQL review', 'failed', 'model not captured', 'unavailable', '8 days ago', 'never free.',
          'Saved benchmarks', '80 / 100', '1,200', 'Every reachable lane', '72.5 / 100', '2 chosen lanes', '1 chosen lane',
          'What these numbers mean', 'Benchmark jobs and runs are owner-scoped through their parent job', 'Open AI Bake-Off in the cockpit'],
        statValues: { 'saved-benchmarks': '3', 'runs-active': '1', 'runs-failed': '1', 'completed-5d': '2' },
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
