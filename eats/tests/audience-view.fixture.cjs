/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Eats family audience view (ADR-164 D6): the page, its declared URL, synthetic read-only answers shaped like GET /api/eats/home-summary (the three metrics, the pending cart items with their 'In your meal cart · <stamp>' detail and the standing note), /profile (eats_profile: TEXT[] tastes, NUMERIC budget as the column's string, the address), /orders/history (eats_orders rows: store_name, total as a string, handoff_url, created_at) and /config, and what the family view must show. /search and /cart answer only so the full page's own start has something to paint without an audience; the view never reads them. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company audience (ADR-164 D6) expects the same card as the family one: the harness paints it in the company grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/**
 * @description A pending cart item exactly as routes/home-summary.js writes it: the title is the text, the stamp sits in the detail.
 * @param {string} title The dish.
 * @param {string} stamp The ISO time it was added.
 * @returns {object} The home-summary item with its three continuation offers.
 */
function cartItem(title, stamp) {
  return { text: title, detail: 'In your meal cart · ' + stamp, tone: 'neutral', fix: 'eats-concierge',
    actions: ['plan-shopping', 'plan-movie', 'plan-music'].map((integration) => ({ integration, context: { title: 'Prepare for my meal choice', notes: 'Meal choice to discuss: ' + title + '; quantity 1 from Synthetic Noodle House. This is a cart item, not a placed order.' } })) };
}

/**
 * @description The synthetic home summary: two dishes waiting in the order, one checkout link in five days.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object} The route's answer.
 */
function homeSummary(iso) {
  const metrics = [
    { id: 'pending-meal-items', label: 'Meal items to review', value: '2', tone: 'neutral' },
    { id: 'meal-handoffs-24h', label: 'Checkout links / 24h', value: '0', tone: 'neutral' },
    { id: 'meal-handoffs-5d', label: 'Checkout links / 5 days', value: '1', tone: 'neutral' },
  ];
  const items = [cartItem('Synthetic Pad Thai', iso(-2)), cartItem('Synthetic Spring Rolls', iso(-30)),
    { text: 'Pending items in your active meal carts. Checkout links do not confirm an order or delivery.', tone: 'neutral', fix: 'eats-concierge' }];
  return { metrics, tiles: metrics, items, asOf: iso(0), partial: false };
}

/**
 * @description The synthetic checkout history as GET /orders/history returns it: newest first, totals as the NUMERIC column's string.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} eats_orders rows.
 */
function orders(iso) {
  return [
    { store_name: 'Synthetic Noodle House', total: '24.50', handoff_url: 'https://www.ubereats.com/store/synthetic-noodle-house', created_at: iso(-40) },
    { store_name: 'Synthetic Taqueria', total: '18.25', handoff_url: 'https://www.ubereats.com/store/synthetic-taqueria', created_at: iso(-200) },
  ];
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
  app: 'eats', file: 'eats/tools/eats-app.html', url: '/api/eats/app', fullMarker: '#grid [data-store]',
  reads: {
    '/api/eats/home-summary': homeSummary(iso),
    '/api/eats/profile': { profile: { user_sub: 'synthetic-diner', display_name: null, dietary: ['vegetarian'], favorite_cuisines: ['Thai', 'Mexican'], default_address: '1 Synthetic Way', budget_per_order: '40.00', notes: null, onboarded: true } },
    '/api/eats/orders/history': { orders: orders(iso) },
    '/api/eats/config': { uberConnected: true },
    '/api/eats/search': { items: [{ productId: 'synthetic-noodle-house', title: 'Synthetic Noodle House', cuisine: 'Thai', priceFrom: 9.5, etaMinutes: 25, imageUrl: null, rating: null }], source: 'catalog' },
    '/api/eats/cart': { cartId: 'synthetic-cart', storeId: null, storeName: null, items: [], total: 0, totalCents: 0, unpricedLines: 0 },
  },
  audiences: {
    family: {
      stats: 4, sections: ['order', 'tastes', 'checkouts'],
      text: ['Food delivery', '2 things in the order', 'Newest: Synthetic Pad Thai, added 2 h ago. Finish or change the order in Eats.', 'Order food in Eats',
        'In the order now', 'Synthetic Pad Thai', 'Waiting in the order', 'added 2 h ago', 'Synthetic Spring Rolls', 'added yesterday',
        'What Eats knows about us', 'Favorite food', 'Thai, Mexican', 'Dietary needs', 'vegetarian', 'Budget per order', '$40.00', 'Delivers to', '1 Synthetic Way',
        'Recent checkout links', 'Synthetic Noodle House', 'Checkout link, $24.50', '2 days ago', 'Synthetic Taqueria', 'Checkout link, $18.25',
        'A checkout link opens Uber Eats. It does not mean an order was placed or delivered.', 'Not placed orders'],
      statValues: { pending: '2', links: '1', saved: '2', uber: 'Linked' },
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
