/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Spotify family audience view (ADR-164 D6): the page, its declared URL, synthetic read-only answers shaped like GET /api/spotify/config (status 'ok' with the account), /profile, /now-playing (SpotifyTrack) and /playlists (SpotifyPlaylist), and what the family view must show. /top-tracks answers only so the full page's own start has something to paint without an audience; the view never reads it. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company audience (ADR-164 D6) expects the same card as the family one: the harness paints it in the company grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

const TRACK = { id: 't1', uri: 'spotify:track:t1', title: 'Synthetic Sunshine', artist: 'Synthetic Band', album: 'Synthetic Summer', imageUrl: null, durationMs: 200000, url: 'https://open.spotify.com/track/t1', previewUrl: null, explicit: false };

/** @returns {object} The page entry. */
module.exports = () => ({
  app: 'spotify', file: 'spotify/tools/spotify-app.html', url: '/api/spotify/app', fullMarker: '#grid .card',
  reads: {
    '/api/spotify/config': { connected: true, status: 'ok', me: { id: 'synthetic', displayName: 'Synthetic Family', product: 'premium', imageUrl: null, country: 'US' } },
    '/api/spotify/profile': { profile: { favorite_genres: ['indie pop', 'soundtracks'], favorite_artists: ['Synthetic Band'], onboarded: true } },
    '/api/spotify/now-playing': { nowPlaying: { track: TRACK, isPlaying: true } },
    '/api/spotify/playlists': { playlists: [
      { id: 'p1', name: 'Synthetic Road Trip', trackCount: 42, imageUrl: null, url: 'https://open.spotify.com/playlist/p1', owner: 'Synthetic Family', isPublic: false },
      { id: 'p2', name: 'Synthetic Bedtime', trackCount: 12, imageUrl: null, url: 'https://open.spotify.com/playlist/p2', owner: 'Synthetic Family', isPublic: false },
    ] },
    '/api/spotify/top-tracks': { items: [TRACK] },
  },
  audiences: {
    family: {
      stats: 4, sections: ['playlists', 'taste'],
      text: ['Music', 'Now playing: Synthetic Sunshine', 'Synthetic Band · Synthetic Summer', 'Open in Spotify', 'Synthetic Road Trip', '42 tracks', 'Synthetic Bedtime', 'indie pop, soundtracks', 'Tap a playlist to open it in Spotify.'],
      statValues: { playlists: '2', playing: 'Playing', genres: '2', artists: '1' },
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
