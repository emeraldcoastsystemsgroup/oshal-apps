/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The season cut reaches the studio. Runs the SHIPPED compiled GET /series handler and the SHIPPED surface function: the season artifact is returned per series, a framework without the kernel's season columns still renders the panel instead of 502-ing, the read stays owner-scoped, and the surface distinguishes "on Drive" / "on the node" / "still stitching" / "no season" instead of implying a delivery that did not happen.
 * 2   | maintainer@emeraldcoastsystemsgroup.com | Pin actual database errors in the compiled handler and validate the shipped artifact-link helper alongside season rendering.
 *
 * Node built-ins only; no install. Express and the framework's @/ modules are outside the claimed
 * boundary and are replaced by seam stubs (the store's compiled-route pattern); the pool is a
 * recorder, because the boundary under test is the handler's response, not PostgreSQL.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const { test } = require('node:test');

const PKG = path.resolve(__dirname, '..');

/** @description Minimal express seam: records handlers by "method path". @returns {object} router */
function fakeRouter() {
  const routes = new Map();
  const router = { routes };
  for (const method of ['get', 'post', 'put', 'delete']) {
    router[method] = (routePath, ...handlers) => { routes.set(`${method} ${routePath}`, handlers.at(-1)); return router; };
  }
  return router;
}

const noop = () => {};
const STUBS = {
  express: { Router: () => fakeRouter() },
  '@/shared/logger': { createChildLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }) },
  '@/shared/services/database': { runRuntimeSchemaBootstrap: async () => {}, buildOwnerRlsPolicyStatements: () => [] },
  '@/features/agent-management': { BotNodeClient: class { }, createRegistryEndpointResolver: () => () => null },
  '@/features/video-generation': {
    renderVideo: async () => ({}), sanitizeStoryboard: (s) => s, storyboardSeconds: () => 0,
    clampTargetSeconds: (n) => n, veoCostPerSecond: () => 0, getVertexAccessToken: async () => '',
  },
  '@/app/routes/storage-target': { saveContent: async () => ({}), listFolder: async () => null },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: '' }) },
  '@/app/routes/connectors-routes': { getValidAccessToken: async () => '' },
  '@/app/series-dispatch': { SCREENPLAY_WRITER_AGENT_ID: 'writer', isRenderInFlight: async () => false, dispatchStoryboardedEpisode: async () => ({ ok: true }) },
  '@/app/series-pipeline': { writeSeries: async () => ({ ok: true }), storyboardEpisode: async () => ({ ok: true }) },
  '@/app/series-orchestrator': { approveSeries: async () => ({ ok: true }), runVideoSeries: async () => [], advanceVideoSeries: async () => ({}) },
  '@/app/series-drive': { uploadFrameToDrive: async () => '' },
};
const originalLoad = Module._load;
Module._load = function loadWithStoreSeams(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return originalLoad.call(this, request, ...rest);
};
const { createBotVideoRoutes } = require('../routes/video-routes.js');
test.after(() => { Module._load = originalLoad; });

const OWNER = 'owner-sub';
const SERIES_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SERIES_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

/**
 * @description A pool that answers the three reads GET /series makes and records every call.
 * @param {{seasonColumns?: boolean}} opts - false makes the season read fail the way a framework
 *   without the kernel migration does (PostgreSQL 42703, undefined_column).
 * @returns {object} pool with a `calls` array of { sql, params }
 */
function recordingPool(opts = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      if (/FROM video_series WHERE user_sub = \$1 ORDER BY created_at/i.test(sql)) {
        return {
          rows: [
            { series_id: SERIES_A, title: 'The Breakfast Crew', premise: 'jokes', episode_count: 3, scenes_per_episode: 4, status: 'done', ticket_id: 't-1', created_at: '2026-09-01' },
            { series_id: SERIES_B, title: 'Solo', premise: 'one', episode_count: 1, scenes_per_episode: 4, status: 'done', ticket_id: 't-2', created_at: '2026-09-02' },
          ],
        };
      }
      if (/FROM video_episodes/i.test(sql)) {
        return {
          rows: [
            { series_id: SERIES_A, episode_id: 'e1', ordinal: 1, title: 'One', status: 'rendered', drive_url: null, assembled_path: null },
            { series_id: SERIES_A, episode_id: 'e2', ordinal: 2, title: 'Two', status: 'rendered', drive_url: null, assembled_path: null },
            { series_id: SERIES_B, episode_id: 'e9', ordinal: 1, title: 'Only', status: 'rendered', drive_url: null, assembled_path: null },
          ],
        };
      }
      if (/season_path/i.test(sql)) {
        if (opts.seasonColumns === false || opts.seasonErrorCode) {
          const err = new Error('column "season_path" does not exist');
          err.code = opts.seasonErrorCode || '42703';
          throw err;
        }
        return {
          rows: [
            { series_id: SERIES_A, intro_clip: 'breakfast-intro-FINAL.mp4', season_path: 'C:/content/the-breakfast-crew-season.mp4', season_drive_url: 'https://drive.example/season' },
            { series_id: SERIES_B, intro_clip: null, season_path: null, season_drive_url: null },
          ],
        };
      }
      return { rows: [] };
    },
  };
}

/** @description Invoke a recorded handler and capture its status + JSON body. @param {Function} handler route handler @param {object} req request @returns {Promise<{status:number, body:any}>} response */
async function invoke(handler, req) {
  const captured = { status: 200, body: undefined };
  const res = {
    status: (code) => { captured.status = code; return res; },
    json: (body) => { captured.body = body; return res; },
  };
  await handler(req, res);
  return captured;
}

/** @description The shipped GET /series handler from the compiled package route. @param {object} pool recording pool @returns {Function} handler */
function seriesHandler(pool) {
  const router = createBotVideoRoutes({ pool, appPackageDir: PKG });
  const handler = router.routes.get('get /series');
  assert.ok(handler, 'the compiled package still registers GET /series');
  return handler;
}

test('a finished multi-episode series carries its season cut; a one-episode series carries none', async () => {
  const pool = recordingPool();
  const res = await invoke(seriesHandler(pool), { oidc: { user: { sub: OWNER } } });

  assert.equal(res.status, 200);
  const [crew, solo] = res.body.series;
  assert.equal(crew.title, 'The Breakfast Crew');
  assert.equal(crew.seasonDriveUrl, 'https://drive.example/season');
  assert.equal(crew.seasonPath, 'C:/content/the-breakfast-crew-season.mp4');
  assert.equal(crew.introClip, 'breakfast-intro-FINAL.mp4');
  assert.equal(crew.episodes.length, 2);
  assert.equal(solo.seasonDriveUrl, null);
  assert.equal(solo.seasonPath, null);

  // Owner-scoped: every read this handler makes is parameterised on the caller's own sub.
  const reads = pool.calls.filter((c) => /SELECT/i.test(c.sql));
  assert.ok(reads.length >= 3, 'the season artifact is read alongside the series and episodes');
  for (const c of reads) assert.deepEqual(c.params, [OWNER]);
  assert.ok(reads.some((c) => /season_path/.test(c.sql)), 'the season artifact read is made');
});

test('a framework without the kernel season columns still renders the panel', async () => {
  const pool = recordingPool({ seasonColumns: false });
  const res = await invoke(seriesHandler(pool), { oidc: { user: { sub: OWNER } } });

  assert.equal(res.status, 200, 'one missing kernel column must not 502 the whole series panel');
  assert.equal(res.body.series.length, 2);
  assert.equal(res.body.series[0].episodes.length, 2, 'the episodes survive the missing season columns');
  assert.equal(res.body.series[0].seasonDriveUrl, null);
  assert.equal(res.body.series[0].seasonPath, null);
});

test('permission and connection failures in the shipped route remain failures', async () => {
  for (const seasonErrorCode of ['42501', '08006']) {
    const res = await invoke(seriesHandler(recordingPool({ seasonErrorCode })), { oidc: { user: { sub: OWNER } } });
    assert.equal(res.status, 502);
    assert.equal(res.body.series, undefined);
  }
});

test('an anonymous caller reads nothing', async () => {
  const pool = recordingPool();
  const res = await invoke(seriesHandler(pool), {});
  assert.equal(res.status, 401);
  assert.equal(pool.calls.filter((c) => /SELECT/i.test(c.sql)).length, 0, 'no query runs before the caller is known');
});

test('the surface reports the season honestly in all four states', () => {
  const html = fs.readFileSync(path.join(PKG, 'tools', 'video.html'), 'utf8');
  const match = html.match(/function seasonLine\(s\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'tools/video.html still ships seasonLine');
  const link = html.match(/function seriesArtifactLink\(value\) \{[\s\S]*?\n\}/);
  assert.ok(link, 'tools/video.html still validates artifact links');
  const sandbox = { URL, esc: (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') };
  vm.runInNewContext(`${link[0]}; ${match[0]}; __out = seasonLine;`, sandbox);
  const seasonLine = sandbox.__out;

  const onDrive = seasonLine({ seasonDriveUrl: 'https://drive.example/season', seasonPath: 'C:/x.mp4', status: 'done' });
  assert.match(onDrive, /Season cut/);
  assert.match(onDrive, /href="https:\/\/drive\.example\/season"/);

  const onNode = seasonLine({ seasonDriveUrl: null, seasonPath: 'C:/x.mp4', status: 'done' });
  assert.match(onNode, /on the render node/);
  assert.doesNotMatch(onNode, /<a /, 'a season that never uploaded must not offer a watch link');

  assert.match(seasonLine({ seasonDriveUrl: null, seasonPath: null, status: 'assembling' }), /stitching/);
  assert.equal(seasonLine({ seasonDriveUrl: null, seasonPath: null, status: 'done' }), '');
});
