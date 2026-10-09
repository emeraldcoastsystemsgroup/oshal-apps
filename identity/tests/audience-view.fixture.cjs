/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for this package's audience views (ADR-164 D6): the page, its declared URL, synthetic read-only answers for its own routes and what each audience must show. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (ADR-164 D6) expects the same card as the company one: the harness paints it in the family grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';
/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
    app: 'identity', file: 'identity/tools/identity.html', url: '/api/identity/', fullMarker: '#main',
    reads: {
      '/api/connect/list': { providers: [
        { id: 'google', label: 'Google', category: 'productivity', connected: true, connections: [{ label: 'Synthetic Mail', expired: true }, { account: 'ops@synthetic.example', expired: false }] },
        { id: 'github', label: 'GitHub', category: 'engineering', connected: true, connections: [{ label: 'synthetic-dev' }] },
        { id: 'slack', label: 'Slack', category: 'communication', connected: false, connections: [] } ] },
      '/api/connect/liveness': { results: [] },
      '/api/identity/summary': { metrics: [{ id: 'saved-accounts', label: 'Saved accounts', value: '3', tone: 'neutral' }, { id: 'reconnect', label: 'Need reconnect', value: '1', tone: 'warn' }, { id: 'expires-7d', label: 'Expire within 7 days', value: '0', tone: 'neutral' }, { id: 'shared-accounts', label: 'Shared accounts', value: '1', tone: 'neutral' }, { id: 'providers', label: 'Providers saved', value: '2', tone: 'neutral' }], tiles: [], items: [{ metricId: 'reconnect', text: 'Synthetic Mail needs reconnect', tone: 'warn', fix: 'identity-home' }], asOf: iso(0) },
    },
    audiences: {
      company: { stats: 5, sections: ['attention', 'connections'], text: ['Identity Hub', 'Synthetic Mail needs reconnect', 'synthetic-dev', 'ops@synthetic.example', 'Reconnect'], statValues: { reconnect: '1', providers: '2' } },
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
