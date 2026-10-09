/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Job Apply company audience view (ADR-164 D6): the review page, its declared URL, one synthetic read-only answer shaped like GET /api/job-apply/home-summary (routes/home-summary.js: the five ledger counts as digit strings, mirrored as tiles; one item per run in the route's order, failed or unknown first then most recently updated, whose detail is '<company> / <state> / <updated iso>' with the two continuation offers attached and tone warn for a failed or unknown state; then the ledger note), and what the company view must show. updated_at is a timestamptz that reaches JSON as an ISO instant. This page has no write; the harness still answers every non-GET with 405 and records it. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (ADR-164 D6) expects the same card as the company one: the harness paints it in the family grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

const LEDGER = 'Uses the authoritative Apply V2 ledger, not workflow completion. Verified counts are distinct posting IDs in each rolling completion window with retained confirmation path/hash; no private path is exposed. Active, failed/unknown and manually marked runs remain separate. Review in Career or prepare a follow-up document; Home never retries a submission.';

/**
 * @description The route's five metrics for an account with one run in flight, one failed, and two postings verified in
 * five days (one of them inside 24 hours). The route mirrors this array as `tiles`.
 * @returns {object[]} Metrics with digit-string values.
 */
function metrics() {
  return [
    { id: 'runs-active', label: 'Submission runs active', value: '1' },
    { id: 'runs-review', label: 'Failed / unknown runs', value: '1' },
    { id: 'manual-marks', label: 'Manually marked runs', value: '0' },
    { id: 'verified-24h', label: 'Verified submissions/24h', value: '1' },
    { id: 'verified-5d', label: 'Verified submissions/5d', value: '2' },
  ];
}

/**
 * @description One run item as the route emits it: title, the detail string, the tone and the two continuation offers.
 * @param {string} title The posting title.
 * @param {string} company The company name.
 * @param {string} state The apply_runs state.
 * @param {string} updated The ISO instant of updated_at.
 * @returns {object} The item.
 */
function run(title, company, state, updated) {
  const detail = company + ' / ' + state + ' / ' + updated;
  const notes = detail + '\nPosting p-' + state + '. State comes from the authoritative Apply run ledger. Only submitted_verified has retained confirmation evidence. A manual mark or completed workflow is not verified submission. Review in Career before retrying or contacting anyone.';
  return { text: title, detail, tone: ['failed', 'unknown_outcome'].includes(state) ? 'warn' : 'neutral', fix: 'job-apply-review',
    actions: ['review-career', 'prepare-document'].map((integration) => ({ integration, context: { title, notes } })) };
}

/**
 * @description The three newest runs in the route's order: the failed one first, then the newest updated.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} Run items.
 */
function runs(iso) {
  return [
    run('Synthetic Staff Engineer', 'Synthetic Robotics', 'failed', iso(-2)),
    run('Synthetic Platform Lead', 'Synthetic Cloud Co', 'running', iso(-30)),
    run('Synthetic Data Analyst', 'Synthetic Insights', 'submitted_verified', iso(-200)),
  ];
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => {
  const m = metrics();
  return {
    app: 'job-apply', file: 'job-apply/tools/review.html', url: '/api/job-apply/review', fullMarker: '#metrics .metric',
    reads: {
      '/api/job-apply/home-summary': { metrics: m, tiles: m, items: runs(iso).concat([{ text: LEDGER, tone: 'neutral', fix: 'job-apply-review' }]), asOf: iso(0), partial: false },
    },
    audiences: {
      company: {
        stats: 5, sections: ['runs', 'notes'],
        text: ['Knowledge · Job Apply', '1 failed or unknown run to review', 'Review the failed runs', 'Newest submission runs', 'Synthetic Staff Engineer', 'Synthetic Robotics', 'failed', '2 h ago',
          'Synthetic Platform Lead', 'Synthetic Cloud Co', 'running', 'yesterday', 'Synthetic Data Analyst', 'Synthetic Insights', 'submitted verified', '8 days ago',
          'Review in Career before retrying or contacting anyone.', 'What these numbers mean', 'Uses the authoritative Apply V2 ledger, not workflow completion.', 'Open Job Apply in the cockpit'],
        statValues: { 'runs-active': '1', 'runs-review': '1', 'manual-marks': '0', 'verified-24h': '1', 'verified-5d': '2' },
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
