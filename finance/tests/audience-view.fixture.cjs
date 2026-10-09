/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for this package's audience views (ADR-164 D6): the page, its declared URL, synthetic read-only answers for its own routes and what each audience must show. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';
/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
    app: 'finance', file: 'finance/tools/finance.html', url: '/api/finance/', fullMarker: '#main',
    reads: {
      '/api/finance/status': { configured: true, connected: 2, hasData: true, institutions: [{ name: 'Synthetic Bank' }, { name: 'Synthetic Broker' }], syncedAt: iso(-3) },
      '/api/finance/summary': { syncedAt: iso(-3), aggregate: { currency: 'USD', sourceEnvironment: 'sandbox', transactionWindowDays: 30, netWorth: { assets: 15250.5, liabilities: 1200, net: 14050.5 },
        accounts: [{ name: 'Everyday checking', mask: '0001', institution: 'Synthetic Bank', type: 'depository', subtype: 'checking', balance: 5250.5 }, { name: 'Brokerage', institution: 'Synthetic Broker', type: 'investment', balance: 10000 }, { name: 'Card', mask: '9', institution: 'Synthetic Bank', type: 'credit', balance: 1200 }],
        holdings: [{ name: 'Synthetic Index Fund', ticker: 'SYN', quantity: 12.5, value: 8000 }, { name: 'Synthetic Bond', ticker: 'SYB', quantity: 20, value: 2000 }],
        topSpending: [{ category: 'Groceries', total: 640.25, count: 12 }, { category: 'Utilities', total: 210, count: 3 }],
        spendByMonth: [{ month: '2026-08', spend: 2100, income: 4200 }, { month: '2026-09', spend: 1850.75, income: 4200 }],
        recentTransactions: [{ date: '2026-09-25', name: 'Synthetic Market', amount: 84.2, category: 'Groceries' }, { date: '2026-09-24', name: 'Synthetic Power', amount: 110, category: 'Utilities' }], notes: [] } },
      '/api/finance/payments': { payments: [{ transfer_id: 't1', provider: 'stripe', amount_cents: 12500, currency: 'USD', payee: 'Synthetic Vendor', status: 'paid', test_mode: true, created_at: iso(-30) }] },
    },
    audiences: {
      family: { stats: 4, sections: ['spending', 'accounts', 'recent'], text: ['Money at home', 'Groceries', 'Everyday checking', 'Synthetic Market'], statValues: { net: '$14,051', debts: '$1,200' } },
      company: { stats: 6, sections: ['accounts', 'months', 'holdings', 'transfers'], text: ['Cash position', 'Synthetic Index Fund', 'Synthetic Vendor', 'Brokerage'], statValues: { net: '$14,051', holdings: '$10,000' } },
    },
  });
