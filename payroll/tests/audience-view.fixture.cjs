/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for this package's audience views (ADR-164 D6): the page, its declared URL, synthetic read-only answers for its own routes and what each audience must show. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Run dates carry the route's real serialization and are now asserted as painted. period_start, period_end and pay_date are Postgres DATE columns; GET /api/payroll/runs passes every row through normalizeDates, so they reach JSON as plain YYYY-MM-DD strings (verified in the acceptance sandbox: DB 2026-10-01, JSON "2026-10-01", painted "Oct 1" under America/Chicago). The draft run now pays on the first of a month, so a reader west of Greenwich would see the previous day if a date-only value were ever parsed as UTC midnight; the dates sit in the current year so the kit's short form (no year) stays the expected text in any year.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | The family audience (ADR-164 D6) expects the same card as the company one: the harness paints it in the family grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';
/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => {
  const Y = new Date().getFullYear();
  const day = (monthDay) => Y + '-' + monthDay;
  return {
    app: 'payroll', file: 'payroll/tools/payroll.html', url: '/api/payroll/', fullMarker: '#runDetail',
    reads: {
      '/api/payroll/company': { company: { company_name: 'Synthetic Co', pay_frequency: 'biweekly', state_code: 'FL' }, taxYear: 2026 },
      '/api/payroll/employees': { employees: [{ employee_id: 'e1', first_name: 'Synthetic', last_name: 'Person', status: 'active', state_code: 'FL', hourly_rate_cents: 2500 }, { employee_id: 'e2', name: 'Synthetic Second', status: 'active' }] },
      '/api/payroll/runs': { runs: [{ run_id: 'r2', period_start: day('09-14'), period_end: day('09-27'), pay_date: day('10-01'), status: 'draft', line_count: 2, total_gross_cents: 480000, total_net_cents: 390000 }, { run_id: 'r1', period_start: day('08-31'), period_end: day('09-13'), pay_date: day('09-15'), status: 'paid', line_count: 2, total_gross_cents: 480000, total_net_cents: 388000 }] },
      '/api/payroll/home-summary': { metrics: [{ id: 'draft-pay-runs', label: 'Pay runs to review', value: '1' }, { id: 'posted-pay-runs', label: 'Runs marked paid', value: '1' }, { id: 'pending-payments', label: 'Payments pending', value: '0' }, { id: 'returned-payments', label: 'Payments returned', value: '0' }], tiles: [], items: [], asOf: iso(0), partial: false },
    },
    audiences: {
      company: { stats: 4, sections: ['runs', 'roster'], text: ['Payroll', 'Synthetic Co', 'Synthetic Person', 'Synthetic Second', 'Review the open run', 'Sep 14 – Sep 27', 'Oct 1', 'Aug 31 – Sep 13', 'Net paid Sep 15'], statValues: { employees: '2', drafts: '1', lastNet: '$3,880', pending: '0' } },
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
