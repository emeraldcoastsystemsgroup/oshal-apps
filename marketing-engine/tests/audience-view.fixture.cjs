/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for this package's audience views (ADR-164 D6): the page, its declared URL, synthetic read-only answers for its own routes (the board overview, saved content, readiness probes and the Home summary, in the shapes those routes send) and what the company audience must show. Consumed by scripts/audience-views.browser.cjs in headless Chromium and by tests/audience-view.test.cjs; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The run rows carried an empty detail, so the view's fixed "daily cap reached" label passed even for the cap-0 Mastodon channel. Refused runs now carry detail.reason as the publish route records it, produced by the package's real publishDecision (routes/marketing-model.js): a cap-0 refusal on Mastodon and a paused refusal on Bluesky, and the company expectations name those causes.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (ADR-164 D6) expects the same card as the company one: the harness paints it in the family grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';
const path = require('node:path');
// The package's own publish gate (pure, no framework imports): the source of every refusal reason below.
const { publishDecision } = require(path.join(__dirname, '..', 'routes', 'marketing-model.js'));

/**
 * @description The synthetic reads, shaped like GET /api/marketing/overview (rows as the tables store them, the
 * scorecard week_start as a UTC-midnight DATE), GET /content, GET /api/marketing-engine/readiness and /home-summary.
 * @param {(hours: number) => string} iso ISO timestamp this many hours from now.
 * @returns {Record<string, object>} Route path to JSON body.
 */
function reads(iso) {
  const campaigns = [
    { campaign_id: 'c-1', product: 'Synthetic Notes', name: 'Synthetic launch', slug: 'synthetic-launch', motion: 'adoption', stage: 1, status: 'active', budget_monthly_usd: '150', target_cpa_usd: null, updated_at: iso(-3) },
    { campaign_id: 'c-2', product: 'Synthetic Ledger', name: 'Synthetic pricing test', slug: 'synthetic-pricing', motion: 'revenue', stage: 2, status: 'paused', budget_monthly_usd: '0', target_cpa_usd: '12', updated_at: iso(-50) },
  ];
  const channels = [
    { channel: 'linkedin', enabled: true, standing_authorization: false, daily_cap: 3, paused_reason: null },
    { channel: 'mastodon', enabled: true, standing_authorization: false, daily_cap: 0, paused_reason: null },
    { channel: 'bluesky', enabled: false, standing_authorization: false, daily_cap: 0, paused_reason: 'Synthetic token revoked' },
    { channel: 'email', enabled: false, standing_authorization: false, daily_cap: 0, paused_reason: null },
  ];
  const scorecard = [{ week_start: '2026-09-21T00:00:00.000Z', computed_at: iso(-20), sources: { gsc: { status: 'no_data' }, posthog: { status: 'ok' }, github: { status: 'ok' } },
    data: { weekStart: '2026-09-21', totals: { events: 42, value: 7.5 }, bySource: { posthog: { events: 40, value: 7.5, byEvent: {} }, github: { events: 2, value: 0, byEvent: {} } }, byMedium: {}, byCampaign: {} } }];
  const pendingProposals = [{ entry_id: 'p-1', campaign_id: 'c-1', channel: 'linkedin', field: 'budget_monthly_usd', old_value: '150', new_value: '200', status: 'proposed', proposed_by: 'campaign-director', created_at: iso(-5) }];
  // A refusal records the gate's own words in detail.reason (the publish route's recordRun); they come from the
  // package's real publishDecision here, so the view is checked against what the ledger really holds.
  const refused = (row, count) => ({ itemId: 'i-1', campaignId: 'c-1', reason: publishDecision(row, count).detail });
  const recentRuns = [
    { channel: 'linkedin', action: 'publish', outcome: 'published', detail: { itemId: 'i-0', campaignId: 'c-1', ref: 'Synthetic ref' }, ts: iso(-2) },
    { channel: 'mastodon', action: 'publish', outcome: 'skipped_cap', detail: refused(channels[1], 0), ts: iso(-30) },
    // Recorded while Bluesky was still on with a cap, after its token was revoked and before it was turned off.
    { channel: 'bluesky', action: 'publish', outcome: 'skipped_consent', detail: refused({ ...channels[2], enabled: true, daily_cap: 2 }, 0), ts: iso(-40) },
  ];
  const items = [
    { item_id: 'i-1', campaign_id: 'c-1', channel: 'linkedin', title: 'Synthetic launch post', status: 'draft', updated_at: iso(-1) },
    { item_id: 'i-2', campaign_id: null, channel: 'email', title: 'Synthetic welcome email', status: 'approved', updated_at: iso(-4) },
    { item_id: 'i-3', campaign_id: 'c-1', channel: 'bluesky', title: 'Synthetic published note', status: 'published', updated_at: iso(-6) },
  ];
  const metrics = [
    { id: 'content-drafts', label: 'Drafts to review', value: '1' }, { id: 'content-approved', label: 'Approved content', value: '1' },
    { id: 'published-24h', label: 'Published / 24h', value: '1' }, { id: 'published-5d', label: 'Published / 5 days', value: '1' },
  ];
  return {
    '/api/marketing/overview': { campaigns, channels, scorecard, pendingProposals, experiments: [{ status: 'running' }, { status: 'proposed' }], recentRuns },
    '/api/marketing/content': { items },
    '/api/marketing-engine/readiness': { campaign: { ready: true, detail: '2 campaigns, 1 active.' }, channels: { ready: true, detail: 'Armed: linkedin.' }, sender: { ready: false, detail: 'No sender address set and Resend is not connected.' } },
    '/api/marketing-engine/home-summary': { metrics, tiles: metrics, items: [], asOf: iso(0), partial: false },
  };
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
  app: 'marketing-engine', file: 'marketing-engine/tools/marketing-engine.html', url: '/api/marketing', fullMarker: '#chanList [data-chan]',
  reads: reads(iso),
  audiences: {
    company: {
      stats: 6, sections: ['attention', 'setup', 'scorecard', 'campaigns', 'channels', 'outcomes'],
      text: ['Marketing Engine', 'Campaigns and approvals', '2 campaigns, 1 active.', 'budget_monthly_usd: 150 → 200', 'Synthetic launch post', 'Synthetic welcome email',
        'No sender address set and Resend is not connected.', 'Search Console', 'No data', 'Synthetic pricing test', '1 · organic', 'On, cap 0: never sends', 'Synthetic token revoked',
        'Skipped: ' + publishDecision({ enabled: true, daily_cap: 0 }, 0).detail, 'Skipped: ' + publishDecision({ enabled: true, daily_cap: 2, paused_reason: 'Synthetic token revoked' }, 0).detail],
      statValues: { 'active-campaigns': '1', drafts: '1', 'published-24h': '1', approvals: '1', 'armed-channels': '1/4', experiments: '1' },
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
