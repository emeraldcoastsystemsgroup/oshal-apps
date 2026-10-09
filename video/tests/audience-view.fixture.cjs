/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Video Studio family audience view (ADR-164 D6): the page, its declared URL, synthetic read-only answers shaped like GET /api/video/series (series rows with their episodes and season fields) and GET /api/video/home-summary (the route's metric ids and string counts), and what the family view must show. /list answers only so the full page's own start has a video to paint without an audience; the view never reads it. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company audience (ADR-164 D6) expects the same card as the family one: the harness paints it in the company grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/**
 * @description The synthetic series, newest first, as GET /series returns them: a finished series with a season cut and
 * two uploaded episodes, one waiting for approval of its scripts, and one being made.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} Series rows with episodes and season fields.
 */
function series(iso) {
  const episode = (id, ordinal, title, status, driveUrl) => ({ series_id: id, episode_id: id + '-' + ordinal, ordinal, title, status, drive_url: driveUrl, assembled_path: null });
  return [
    { series_id: 's1', title: 'Synthetic Breakfast Crew', premise: 'Jokes at breakfast.', episode_count: 3, scenes_per_episode: 4, status: 'done', ticket_id: 't1', created_at: iso(-2),
      episodes: [episode('s1', 1, 'Pancake Day', 'assembled', 'https://drive.example/pancake-day'), episode('s1', 2, 'Toast Trouble', 'assembled', 'https://drive.example/toast-trouble'), episode('s1', 3, 'Jam Session', 'rendered', null)],
      introClip: null, seasonPath: 'C:/content/crew-season.mp4', seasonDriveUrl: 'https://drive.example/crew-season' },
    { series_id: 's2', title: 'Synthetic Detective Dot', premise: 'A tiny detective.', episode_count: 2, scenes_per_episode: 4, status: 'awaiting_approval', ticket_id: 't2', created_at: iso(-30),
      episodes: [episode('s2', 1, 'The Missing Hat', 'scripted', null), episode('s2', 2, 'The Loud Clock', 'scripted', null)],
      introClip: null, seasonPath: null, seasonDriveUrl: null },
    { series_id: 's3', title: 'Synthetic Neon Noodle Jam', premise: 'Noodles dance.', episode_count: 1, scenes_per_episode: 4, status: 'rendering', ticket_id: 't3', created_at: iso(-80),
      episodes: [episode('s3', 1, 'First Slurp', 'rendering', null)], introClip: null, seasonPath: null, seasonDriveUrl: null },
  ];
}

/**
 * @description GET /home-summary as the route answers it: four metrics with string counts, the newest-series items and its note.
 * @param {(hours: number) => string} iso Timestamp helper from the harness.
 * @returns {object} The summary body.
 */
function summary(iso) {
  const metrics = [
    { id: 'scripts-review', label: 'Scripts needing approval', value: '1' },
    { id: 'series-active', label: 'Series in progress', value: '1' },
    { id: 'series-failed', label: 'Failed series', value: '0' },
    { id: 'videos-saved-5d', label: 'Videos saved / 5 days', value: '2' },
  ];
  return { metrics, tiles: metrics, items: [{ text: 'Series and episode states are saved pipeline evidence.', tone: 'neutral', fix: 'video-studio' }], asOf: iso(0), partial: false };
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => ({
  app: 'video', file: 'video/tools/video.html', url: '/api/video/ui', fullMarker: '#list .vid',
  reads: {
    '/api/video/series': { series: series(iso) },
    '/api/video/home-summary': summary(iso),
    '/api/video/list': { videos: [{ title: 'Synthetic Full Page Clip', fileName: 'synthetic-full-page-clip.mp4', provider: 'dropbox', downloadUrl: null, url: 'https://drive.example/synthetic-clip', seconds: 20, scenes: 4, costUsd: null, createdAt: iso(-5) }] },
  },
  audiences: {
    family: {
      stats: 4, sections: ['series', 'watch'],
      text: ['Our videos', '1 series needs your OK on the scripts', 'Newest: Synthetic Breakfast Crew, finished, started', 'Our series', 'Finished · 2 of 3 episodes finished', 'Season cut ready',
        'Waiting for your OK on the scripts · 0 of 2 episodes finished', 'Needs your OK', 'Being made · 0 of 1 episode finished', 'Ready to watch', 'Synthetic Breakfast Crew: the whole season',
        'Episode 1: Pancake Day', 'Episode 2: Toast Trouble', 'Single videos made in the studio are in its My videos list.'],
      statValues: { series: '3', review: '1', active: '1', saved: '2' },
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
