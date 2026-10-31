/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Eats family audience view (ADR-164 D6): the page, its declared URL, synthetic read-only answers shaped like the package's routes, and what the family view must show. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | 1.4.0: the home summary carries the restaurants opened in Uber Eats (detail 'Opened in Uber Eats · <stamp>'), the history rows carry the place id and the Uber Eats search link with no total, /config names rail places, and /search answers one real-shaped restaurant so the full page's own start has something to paint without an audience (the view never reads it).
 */
'use strict';

/**
 * @description A hand-off exactly as routes/home-summary.js writes it: the restaurant is the text, the stamp sits in the detail.
 * @param {string} store The restaurant. @param {string} stamp ISO time.
 * @returns {object} The summary item.
 */
function handoff(store, stamp) {
  return { text: store, detail: 'Opened in Uber Eats · ' + stamp, tone: 'neutral', fix: 'eats-concierge',
    actions: ['plan-shopping', 'plan-movie', 'plan-music'].map((integration) => ({ integration, context: { title: 'Prepare for my meal from ' + store, notes: 'Restaurant opened in Uber Eats: ' + store + ' on ' + stamp + '. Opening the link is not a placed order; the dishes, address and payment are chosen in Uber Eats.' } })) };
}

/**
 * @description The synthetic home summary: two restaurants opened lately, one of them today.
 * @param {(hours: number) => string} iso Hours from now as ISO.
 * @returns {object} As GET /api/eats/home-summary answers.
 */
function homeSummary(iso) {
  const metrics = [
    { id: 'meal-handoffs-24h', label: 'Uber Eats links / 24h', value: '1', tone: 'neutral' },
    { id: 'meal-handoffs-5d', label: 'Uber Eats links / 5 days', value: '2', tone: 'neutral' },
    { id: 'meal-restaurants-30d', label: 'Restaurants opened / 30 days', value: '2', tone: 'neutral' },
  ];
  const items = [handoff('Synthetic Noodle House', iso(-2)), handoff('Synthetic Taqueria', iso(-30)),
    { text: 'Uber Eats links opened from Eats. Opening a link does not confirm an order or delivery.', tone: 'neutral', fix: 'eats-concierge' }];
  return { metrics, tiles: metrics.slice(0, 4), items, asOf: iso(0), partial: false };
}

/**
 * @description The synthetic hand-off history as GET /orders/history returns it: newest first, no totals (nothing is priced here).
 * @param {(hours: number) => string} iso Hours from now as ISO.
 * @returns {object[]} eats_orders rows.
 */
function orders(iso) {
  return [
    { store_id: 'ChIJ-synthetic-noodle', store_name: 'Synthetic Noodle House', total: null, handoff_url: 'https://www.ubereats.com/search?q=Synthetic+Noodle+House&pl=synthetic', created_at: iso(-2) },
    { store_id: 'ChIJ-synthetic-taqueria', store_name: 'Synthetic Taqueria', total: null, handoff_url: 'https://www.ubereats.com/search?q=Synthetic+Taqueria&pl=synthetic', created_at: iso(-30) },
  ];
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
  app: 'eats', file: 'eats/tools/eats-app.html', url: '/api/eats/app', fullMarker: '#grid [data-place]',
  reads: {
    '/api/eats/home-summary': homeSummary(iso),
    '/api/eats/profile': { profile: { user_sub: 'synthetic-diner', display_name: null, dietary: ['vegetarian'], favorite_cuisines: ['Thai', 'Mexican'], default_address: '1 Synthetic Way', budget_per_order: '40.00', notes: null, onboarded: true } },
    '/api/eats/orders/history': { orders: orders(iso) },
    '/api/eats/config': { rail: 'places', source: 'Google Places', connector: 'google-places', handoff: 'uber-eats', uberConnected: false },
    '/api/eats/search': { source: 'Google Places', place: { address: '1 Synthetic Way, Pensacola, FL 32502, USA', placeId: 'ChIJ-synthetic-address', latitude: 30.4213, longitude: -87.2169 }, query: '',
      items: [{ placeId: 'ChIJ-synthetic-noodle', name: 'Synthetic Noodle House', address: '2 Synthetic Ave', cuisine: 'Thai restaurant', rating: 4.7, ratingCount: 210, priceLevel: 2, priceLabel: '$$', openNow: true, delivery: true, takeout: true, photo: null, mapsUrl: null, website: null, latitude: 30.41, longitude: -87.22, distanceKm: 1.1, uberUrl: 'https://www.ubereats.com/search?q=Synthetic+Noodle+House&pl=synthetic' }],
      feedUrl: 'https://www.ubereats.com/feed?diningMode=DELIVERY&pl=synthetic', uberSearchUrl: 'https://www.ubereats.com/search?q=food&pl=synthetic' },
  },
  audiences: {
    family: {
      stats: 4, sections: ['recent', 'tastes', 'checkouts'],
      text: ['Food delivery', 'Last restaurant: Synthetic Noodle House', 'Opened in Uber Eats 2 h ago. Open Eats to find another or open it again.', 'Order food in Eats',
        'Opened in Uber Eats lately', 'Synthetic Noodle House', 'Opened in Uber Eats', 'opened 2 h ago', 'Synthetic Taqueria', 'opened yesterday',
        'What Eats knows about us', 'Favorite food', 'Thai, Mexican', 'Dietary needs', 'vegetarian', 'Budget per order', '$40.00', 'Delivers to', '1 Synthetic Way',
        'Recent Uber Eats links', 'Uber Eats link', '2 h ago',
        'A link opens Uber Eats at your address with that restaurant searched. It does not mean an order was placed or delivered.', 'Not placed orders', 'Opens at your address on your own sign-in'],
      statValues: { day: '1', links: '2', saved: '2', uber: 'Handoff' },
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
