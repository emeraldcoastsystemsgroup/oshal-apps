/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Get a Ride family audience view (ADR-164 D6): the page, its declared URL, synthetic read-only answers shaped like GET /api/rides/history (rides_requests rows, newest first: pickup, dropoff, ride_type, the NUMERIC fares as strings, deep_link, created_at) and /home-summary (the two handoff metrics), and what the family view must show. /config answers, with a same-origin tile URL, only so the full page's own start has a map config to read without an audience; the view never reads it. The vendored Leaflet is served so the full page paints as deployed. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company audience (ADR-164 D6) expects the same card as the family one: the harness paints it in the company grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/**
 * @description The synthetic saved rides: the airport twice (the older one saved no fare) and the grocery once.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} rides_requests rows as GET /history returns them.
 */
function trips(iso) {
  return [
    { pickup: 'my location', dropoff: 'Synthetic Airport', ride_type: 'comfort', est_fare_low: '23.00', est_fare_high: '30.00', deep_link: 'https://m.uber.com/ul/?synthetic=1', created_at: iso(-2) },
    { pickup: '12 Synthetic Oak St', dropoff: 'Synthetic Grocery', ride_type: 'uberx', est_fare_low: '9.00', est_fare_high: '12.00', deep_link: 'https://m.uber.com/ul/?synthetic=2', created_at: iso(-30) },
    { pickup: 'my location', dropoff: 'Synthetic Airport', ride_type: 'comfort', est_fare_low: null, est_fare_high: null, deep_link: 'https://m.uber.com/ul/?synthetic=3', created_at: iso(-100) },
  ];
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
  app: 'rides', file: 'rides/tools/rides-app.html', url: '/api/rides/app', fullMarker: '#recentTrips .suggestion',
  assets: [
    { url: '/api/rides/vendor/leaflet/leaflet.css', file: 'rides/tools/vendor/leaflet/leaflet.css' },
    { url: '/api/rides/vendor/leaflet/leaflet.js', file: 'rides/tools/vendor/leaflet/leaflet.js' },
  ],
  reads: {
    '/api/rides/history': { trips: trips(iso) },
    '/api/rides/home-summary': {
      metrics: [
        { id: 'ride-handoffs-24h', label: 'Ride links / 24h', value: '1', tone: 'neutral' },
        { id: 'ride-handoffs-5d', label: 'Ride links / 5 days', value: '3', tone: 'neutral' },
      ],
      tiles: [], items: [{ text: 'Saved ride handoff requests, not confirmed bookings or completed rides.', tone: 'neutral', fix: 'rides-concierge' }], asOf: iso(0), partial: false,
    },
    '/api/rides/config': { uberRidesConnected: false, maps: { provider: 'osm', googleMapsEnabled: false, tileUrl: '/api/rides/synthetic-tiles/{z}/{x}/{y}.png', tileAttribution: 'Synthetic tiles', maxZoom: 19 } },
  },
  audiences: {
    family: {
      stats: 4, sections: ['rides', 'places'],
      text: ['Getting around', '3 rides planned', 'Newest: to Synthetic Airport, planned 2 h ago.', 'Open Get a Ride', 'Recent rides',
        'To Synthetic Airport', 'From my location · Comfort · about $23.00–$30.00', 'planned 2 h ago',
        'To Synthetic Grocery', 'From 12 Synthetic Oak St · UberX · about $9.00–$12.00', 'planned yesterday',
        'From my location · Comfort · no fare estimate saved', 'planned 4 days ago',
        'Each ride was handed to Uber to confirm and pay; this list cannot tell whether the ride happened.',
        'Places we go', '2 rides', 'last 2 h ago', '1 ride', 'last yesterday', 'Handed to Uber'],
      statValues: { planned: '3', recent: '3', last: '2 h ago', usual: 'Comfort' },
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
