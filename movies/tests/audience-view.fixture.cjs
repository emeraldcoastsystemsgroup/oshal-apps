/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Movies & TV family audience view (ADR-164 D6): the page, its declared URL, synthetic read-only answers shaped like GET /api/movies/config and /watchlist (movies_watchlist rows: media_type, title, year, tmdb_url, status, created_at) and what the family view must show. /trending answers only so the full page's own start has something to paint without an audience; the view never reads it. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company audience (ADR-164 D6) expects the same card as the family one: the harness paints it in the company grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/**
 * @description The synthetic watchlist: three saved titles, newest first, as the route returns them.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} movies_watchlist rows.
 */
function watchlist(iso) {
  return [
    { row_id: 'w1', item_key: 'movie:1', media_type: 'movie', tmdb_id: 1, title: 'Synthetic Dune', year: '2021', poster_url: null, tmdb_url: 'https://www.themoviedb.org/movie/1', status: 'want', created_at: iso(-3) },
    { row_id: 'w2', item_key: 'tv:2', media_type: 'tv', tmdb_id: 2, title: 'Synthetic Bake Show', year: '2016', poster_url: null, tmdb_url: 'https://www.themoviedb.org/tv/2', status: 'want', created_at: iso(-50) },
    { row_id: 'w3', item_key: 'movie:3', media_type: 'movie', tmdb_id: 3, title: 'Synthetic Paddington', year: '2014', poster_url: null, tmdb_url: '', status: 'want', created_at: iso(-200) },
  ];
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
  app: 'movies', file: 'movies/tools/movies-app.html', url: '/api/movies/app', fullMarker: '#grid .card',
  reads: {
    '/api/movies/config': { connected: true },
    '/api/movies/watchlist': { items: watchlist(iso) },
    '/api/movies/trending': { items: [{ key: 'movie:9', mediaType: 'movie', id: 9, title: 'Synthetic Trending', year: '2026', overview: '', rating: 7.1, genres: [], posterUrl: null, tmdbUrl: 'https://www.themoviedb.org/movie/9' }] },
  },
  audiences: {
    family: {
      stats: 4, sections: ['watchlist'],
      text: ['Movie night', '3 saved to watch', 'Newest: Synthetic Dune', 'Up next on the watchlist', 'Synthetic Bake Show', 'Show · 2016', 'Movie · 2014', 'Tap a title to see it on The Movie Database.'],
      statValues: { want: '3', movies: '2', shows: '1', database: 'Connected' },
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
