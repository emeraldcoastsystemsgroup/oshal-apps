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
    app: 'payments', file: 'payments/tools/payments.html', url: '/api/payments/', fullMarker: '#main',
    reads: {
      '/api/payments/providers': { providers: [{ provider: 'square', connected: true, testMode: false, sourceLabel: 'Synthetic Store' }, { provider: 'paypal', connected: false, testMode: false }] },
      '/api/payments/history': { charges: [
        { charge_id: 'c1', provider: 'square', amount_cents: 12345, currency: 'USD', note: 'Synthetic invoice 1', status: 'completed', test_mode: false, created_at: iso(-2) },
        { charge_id: 'c2', provider: 'square', amount_cents: 5000, currency: 'USD', note: 'Synthetic invoice 2', status: 'pending', test_mode: false, created_at: iso(-26) },
        { charge_id: 'c3', provider: 'square', amount_cents: 700, currency: 'USD', note: 'Synthetic invoice 3', status: 'failed', test_mode: false, created_at: iso(-50) },
        { charge_id: 'c4', provider: 'square', amount_cents: 100, currency: 'USD', note: 'Synthetic test', status: 'completed', test_mode: true, created_at: iso(-70) } ] },
    },
    audiences: {
      company: { stats: 5, sections: ['providers', 'charges'], text: ['Payments', 'Money in', 'Square', 'PayPal', 'Synthetic invoice 1', 'Synthetic test (test)'], statValues: { done24h: '1', done5d: '1', pending: '1', failed5d: '1', test5d: '1' } },
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
