/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Capability Ideator company audience view (ADR-164 D6): the review page, its declared URL, one synthetic read-only answer shaped like GET /api/capability-ideator/home-summary (routes/home-summary.js: the three counts as digit strings, mirrored as tiles; one item per run, newest started first, whose detail is '<status> / <iso>' and whose two offers carry the route's sentence with the latest step (null when no step is saved) and the saved redacted output; then the route's closing note), and what the company view must show. The view never starts a discovery run, never reads the loaded-applications plan and writes nothing; the harness still answers every non-GET with 405 and records it. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (ADR-164 D6) expects the same card as the company one: the harness paints it in the family grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

const NOTE = 'Open discovery to inspect loaded app actions and connection requirements, then develop a sourced process proposal.';

/**
 * @description The route's three metrics for an account with one discovery run active, one run needing review and two
 * runs completed in five days. The route mirrors this array as `tiles`.
 * @returns {object[]} Metrics with digit-string values.
 */
function metrics() {
  return [
    { id: 'running', label: 'Discovery runs active', value: '1' },
    { id: 'review', label: 'Runs needing review', value: '1' },
    { id: 'completed', label: 'Runs completed / 5d', value: '2' },
  ];
}

/**
 * @description One run item exactly as the route builds it: the workflow name, the detail, and the two continuation
 * offers whose notes are the route's sentence (a missing step concatenates as 'null', a missing excerpt reads
 * 'No saved output'), clipped at 2000 characters.
 * @param {string} name The workflow name.
 * @param {string} status running | suspended | completed | escalated | error.
 * @param {string} started The ISO instant of started_at.
 * @param {string|null} step The latest step's node title, or null when no step is saved.
 * @param {string|null} excerpt The saved redacted step output, or null.
 * @returns {object} The item.
 */
function run(name, status, started, step, excerpt) {
  const notes = ('Recorded workflow state: ' + status + '. Latest step: ' + step + '. Saved, redacted step output: ' + (excerpt || 'No saved output') + '. This is workflow evidence, not proof that a proposed tool exists, is connected, or has been implemented. Review sources and requirements before planning.').slice(0, 2000);
  return { text: name, detail: status + ' / ' + started, fix: 'capability-ideator-review',
    actions: ['prepare-document', 'explore-venture'].map((integration) => ({ integration, context: { title: 'Review capability discovery', notes } })) };
}

/**
 * @description The three newest runs, newest started first: one that ended in error with a saved output, one completed
 * without a saved output, one still running with no step saved yet.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} Run items.
 */
function runs(iso) {
  return [
    run('Synthetic onboarding discovery', 'error', iso(-3), 'Propose capabilities', '{"proposal": "Synthetic intake triage over installed apps"}'),
    run('Synthetic invoice discovery', 'completed', iso(-27), 'Research sources', null),
    run('Synthetic support discovery', 'running', iso(-200), null, null),
  ];
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => {
  const m = metrics();
  return {
    app: 'capability-ideator', file: 'capability-ideator/tools/review.html', url: '/api/capability-ideator/review', fullMarker: '#metrics .metric',
    reads: {
      '/api/capability-ideator/home-summary': { metrics: m, tiles: m, items: runs(iso).concat([{ text: NOTE, fix: 'capability-ideator-review', tone: 'neutral' }]), partial: false, asOf: iso(0) },
    },
    audiences: {
      company: {
        stats: 3, sections: ['runs', 'notes'],
        text: ['Engineering · Capability Ideator', '1 run needs review', 'Open Capability Ideator', 'not ideas built or savings achieved',
          'Newest discovery runs', 'not proof that a proposed tool exists',
          'Synthetic onboarding discovery', 'error', 'Propose capabilities', '{"proposal": "Synthetic intake triage over installed apps"}', '3 h ago',
          'Synthetic invoice discovery', 'completed', 'Research sources', 'No saved output', 'yesterday',
          'Synthetic support discovery', 'running', 'No step saved', '8 days ago',
          'Notes', NOTE, 'Open Capability Ideator in the cockpit'],
        statValues: { running: '1', review: '1', completed: '2' },
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
