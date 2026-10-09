/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Travel family audience view (ADR-164 D6): the page, its declared URL, synthetic read-only answers shaped like GET /api/travel/config (the Duffel status operation, demo mode) and /watches (travel_watches rows: kind, route_key, the query JSONB with 'YYYY-MM-DD' dates, NUMERIC prices as strings, status active/tripped, timestamps), and what the family view must show. The flight/hotel/car search routes are deliberately absent: the view must never call them. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company audience (ADR-164 D6) expects the same card as the family one: the harness paints it in the company grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/**
 * @description A calendar day relative to the reader's today, as the watch stores it ('YYYY-MM-DD').
 * @param {number} offset Days from today (negative for the past).
 * @returns {string} The local calendar day.
 */
function day(offset) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
  app: 'travel', file: 'travel/tools/travel-app.html', url: '/api/travel/app', fullMarker: '#f_origin',
  reads: {
    '/api/travel/config': { connected: false, mode: 'demo', live: false },
    '/api/travel/watches': { items: [
      { watch_id: 'w1', kind: 'flight', route_key: 'flight:VPS-DCA', query: { origin: 'VPS', destination: 'DCA', departDate: day(20), returnDate: day(27), pax: 3, cabin: 'economy' }, target_price: null, last_price: '412.00', currency: 'USD', status: 'active', last_checked_at: iso(-2), created_at: iso(-100) },
      { watch_id: 'w2', kind: 'flight', route_key: 'flight:JFK-LHR', query: { origin: 'JFK', destination: 'LHR', departDate: day(9), pax: 1, cabin: 'premium_economy' }, target_price: null, last_price: '389.50', currency: 'USD', status: 'tripped', last_checked_at: iso(-5), created_at: iso(-300) },
      { watch_id: 'w3', kind: 'hotel', route_key: 'hotel:PARIS', query: { city: 'Paris', checkIn: day(-3), checkOut: day(1) }, target_price: null, last_price: null, currency: 'USD', status: 'active', last_checked_at: null, created_at: iso(-400) },
    ] },
  },
  audiences: {
    family: {
      stats: 4, sections: ['upcoming', 'watches'],
      text: ['Trips', 'A watched fare dropped', 'Next: JFK → LHR', 'in 9 days', '· demo prices', 'Plan a trip', 'Connect live prices', 'VPS → DCA and back', 'Flight · economy · 3 travellers · last seen $412.00', 'premium economy', 'Hotel in Paris', 'no price checked yet', 'Price dropped', 'Date passed', 'Watching', 'Prices are demo data until a Duffel token is connected on the Connections page.'],
      statValues: { watching: '2', drops: '1', next: 'in 9 days', prices: 'Demo' },
    },
  },
});

// ADR-164 D6: the company audience paints the same account-scoped card; every page entry expects the same text, stats and sections under it.
const __secondAudience = module.exports;
module.exports = (helpers) => {
  const entries = __secondAudience(helpers), list = Array.isArray(entries) ? entries : [entries];
  for (const entry of list) if (entry.audiences && entry.audiences.family && !entry.audiences.company) entry.audiences.company = entry.audiences.family;
  return entries;
};
