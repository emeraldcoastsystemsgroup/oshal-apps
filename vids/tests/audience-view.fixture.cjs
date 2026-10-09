/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Vids Studio family audience view (ADR-164 D6). Vids has no page file: GET /api/vids/app sends SURFACE_HTML from the compiled route module, so the fixture evaluates that template literal from routes/vids-routes.js (without executing the module, which needs the framework) into a temporary file and names it relative to the store root, which is how the harness serves a page. Synthetic read-only answers are shaped like GET /api/vids/jobs (owner-scoped vids_jobs rows, newest first: job_id, status, idea with the story route's 'story: ' prefix, orientation, insert_mode, ISO created_at and updated_at; plus the registered worker list), /jobs/:jobId/artifact (the finished export record: a same-origin previewUrl and, once published, a publicUrl; null when no export is attached) and /home-summary (the four metrics as pg text counts), with what the family view must show. The full page reads the same answers without an audience. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company audience (ADR-164 D6) expects the same card as the family one: the harness paints it in the company grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * @description Write the page the route serves to a temporary file and return its path relative to the store root.
 * @returns {string} A store-relative path the harness can join onto its root.
 */
function servedPage() {
  const store = path.resolve(__dirname, '..', '..');
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'vids-routes.js'), 'utf8');
  const marker = 'const SURFACE_HTML = `', s = source.indexOf(marker), e = source.indexOf('`;', s + marker.length);
  if (s < 0 || e < 0) throw new Error('vids audience fixture: routes/vids-routes.js has no SURFACE_HTML literal');
  const file = path.join(os.tmpdir(), 'oshal-vids-audience-view-' + process.pid + '.html');
  fs.writeFileSync(file, new Function('return `' + source.slice(s + marker.length, e) + '`;')());
  process.once('exit', () => fs.rmSync(file, { force: true }));
  const rel = path.relative(store, file);
  if (path.isAbsolute(rel)) throw new Error('vids audience fixture: the temporary directory must be on the store checkout\x27s drive (' + file + ')');
  return rel;
}

/**
 * @description The synthetic saved videos, newest first: one being made, one story waiting its turn, three finished
 * (one with a published export, one brand graphic with none, one with an attached private export) and one that failed.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} vids_jobs rows as GET /jobs returns them.
 */
function jobs(iso) {
  const row = (n, status, extra) => Object.assign({ job_id: '00000000-0000-4000-8000-00000000000' + n, status, idea: 'Synthetic idea ' + n, final_prompt: null,
    orientation: 'Landscape', insert_mode: 'Insert', client_id: 'synthetic-worker', task_id: null, created_at: iso(-n - 10), updated_at: iso(-n) }, extra);
  return [
    row(1, 'running', { idea: 'Synthetic anchor recap' }),
    row(2, 'queued', { insert_mode: 'story', idea: 'story: Synthetic tortoise race', orientation: 'Portrait' }),
    row(3, 'done', { idea: 'Synthetic harbour sunset' }),
    row(4, 'done', { insert_mode: 'brand', idea: 'Synthetic bakery intro', orientation: null }),
    row(5, 'failed', { orientation: 'Square' }),
    row(6, 'done', { idea: 'Synthetic garden timelapse' }),
  ];
}

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object} The page entry. */
module.exports = ({ iso }) => {
  const exported = (n, published) => ({ jobId: '00000000-0000-4000-8000-00000000000' + n, sha256: 'a'.repeat(64), byteLength: 2048,
    previewUrl: '/api/vids/jobs/00000000-0000-4000-8000-00000000000' + n + '/artifact/video.mp4', publicUrl: published ? '/api/vids-public/' + 'b'.repeat(64) + '/video.mp4' : null, publishedAt: published ? iso(-2) : null });
  const artifacts = { '00000000-0000-4000-8000-000000000003': exported(3, true), '00000000-0000-4000-8000-000000000006': exported(6, false) };
  const counts = [['jobs-active', 'Queued / rendering', '2'], ['jobs-failed', 'Failed jobs', '1'], ['jobs-done-24h', 'Done jobs updated / 24h', '1'], ['jobs-done-5d', 'Done jobs updated / 5d', '3']]
    .map(([id, label, value]) => ({ id, label, value }));
  return {
    app: 'vids', file: servedPage(), url: '/api/vids/app', fullMarker: '#rows td.idea',
    reads: {
      '/api/vids/jobs': { jobs: jobs(iso), workers: [{ clientId: 'synthetic-worker', name: 'Synthetic operator', status: 'online', healthy: true, lastSeenAt: iso(0), queueDepth: 1 }] },
      '/api/vids/jobs/:jobId/artifact': (req) => ({ artifact: artifacts[req.params.jobId] || null }),
      '/api/vids/home-summary': { metrics: counts, tiles: counts, items: [{ text: 'Done means the worker recorded completion, not social publication.', tone: 'neutral', fix: 'vids-studio' }], asOf: iso(0), partial: false },
    },
    audiences: {
      family: {
        stats: 4, sections: ['videos'],
        text: ['Our videos', '2 videos waiting or being made', 'Newest: Synthetic anchor recap', 'Newest videos', 'Being made now · Clip, landscape',
          'Synthetic tortoise race', 'Waiting its turn · Story video, portrait', 'Finished · Clip, landscape · public link on', 'Ready to watch',
          'Finished · Brand graphic', 'Did not finish · Clip, square', 'Synthetic garden timelapse', 'Tap a video marked Ready to watch to play it in a new tab.',
          'Finished means the video maker reported it done, not that it was posted anywhere'],
        statValues: { active: '2', finished: '3', unfinished: '1', maker: 'Ready' },
      },
    },
  };
};

// ADR-164 D6: the company audience paints the same account-scoped card; every page entry expects the same text, stats and sections under it.
const __secondAudience = module.exports;
module.exports = (helpers) => {
  const entries = __secondAudience(helpers), list = Array.isArray(entries) ? entries : [entries];
  for (const entry of list) if (entry.audiences && entry.audiences.family && !entry.audiences.company) entry.audiences.company = entry.audiences.family;
  return entries;
};
