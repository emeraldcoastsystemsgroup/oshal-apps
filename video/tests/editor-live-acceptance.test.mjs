/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the installed-box acceptance (editor-live-acceptance.mjs) before any box runs it: drive the SAME function against the real compiled routes over a disposable PostgreSQL, with the NAMED acceptance-clip prober (it answers only for the committed clip's exact bytes, with the metadata the runtime image's ffprobe measures for it - see video-editor-media.test.mjs) and the named fixture encoder. A full walk passes and leaves no row and no file; a missing permission fails before anything is created; an incomplete cleanup is reported as a failure, never a pass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startApi, fixtureEncoder } from './video-editor.fixture.mjs';
import { startPostgres, resetPostgres, EDITOR_TABLES } from './video-editor-postgres.fixture.mjs';
import { runEditorAcceptance, CLIP, CASE_ID } from './editor-live-acceptance.mjs';

let database, cleanup, clipSha;
test.after(async () => { await cleanup?.(); });
test.before(async () => {
  database = await startPostgres(callback => { cleanup = callback; });
  clipSha = createHash('sha256').update(await readFile(CLIP)).digest('hex');
});
test.beforeEach(async () => { await resetPostgres(database.admin); });

/** The NAMED stand-in for ffprobe here: it recognises only the committed clip, by hash, and answers what the real ffprobe measures. */
async function acceptanceClipProber(file) {
  if (createHash('sha256').update(await readFile(file)).digest('hex') !== clipSha) throw new Error('not the committed acceptance clip');
  return { format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '1.000000' }, streams: [
    { codec_type: 'video', codec_name: 'h264', width: 160, height: 90, avg_frame_rate: '30/1', duration: '1.000000' },
    { codec_type: 'audio', codec_name: 'aac', channels: 1, sample_rate: '48000', duration: '1.000000' }] };
}
acceptanceClipProber.fixtureName = 'video-editor-acceptance-clip-prober';

async function leftovers(api) {
  const rows = {};
  for (const table of EDITOR_TABLES) rows[table] = (await database.admin.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count;
  const files = [];
  for (const owner of (await readdir(api.dataRoot)).filter(name => !name.startsWith('.'))) {
    for (const entry of await readdir(join(api.dataRoot, owner), { withFileTypes: true })) {
      if (entry.isFile()) files.push(entry.name);
      else files.push(...(await readdir(join(api.dataRoot, owner, entry.name))));
    }
  }
  return { rows: Object.values(rows).reduce((sum, count) => sum + count, 0), files };
}

test('the acceptance walk passes against the real routes and leaves no row and no file behind', async t => {
  const fixture = fixtureEncoder();
  const api = await startApi(t, database.pool, { prober: acceptanceClipProber, exports: fixture });
  const result = await runEditorAcceptance({ base: api.origin, token: 'loopback-fixture-token' });
  assert.deepEqual([result.case, result.state, result.failure, result.cleanupErrors], [CASE_ID, 'pass', null, []], JSON.stringify(result));
  assert.deepEqual(result.evidence.export.frames, 20, 'the export rendered the SAVED revision, not the first one');
  assert.equal(fixture.calls.length, 1);
  assert.deepEqual(await leftovers(api), { rows: 0, files: [] });
});

test('a missing permission fails the walk before anything is created', async t => {
  const api = await startApi(t, database.pool, { prober: acceptanceClipProber, exports: fixtureEncoder(), denied: ['editor.delete'] });
  const result = await runEditorAcceptance({ base: api.origin, token: 'loopback-fixture-token' });
  assert.equal(result.state, 'fail'); assert.match(result.failure, /lacks editor permissions/);
  assert.deepEqual(await leftovers(api), { rows: 0, files: [] });
});

test('an incomplete cleanup is reported as a failure, never a pass', async t => {
  const api = await startApi(t, database.pool, { prober: acceptanceClipProber, exports: fixtureEncoder() });
  const refusingDelete = (url, init) => (init?.method === 'DELETE' && /\/media\//.test(String(url))
    ? Promise.resolve(new Response('{"error":"fixture_refused"}', { status: 500 })) : fetch(url, init));
  const result = await runEditorAcceptance({ base: api.origin, token: 'loopback-fixture-token', fetchImpl: refusingDelete });
  assert.deepEqual([result.state, result.failure, result.cleanupErrors], ['fail', null, ['media 500']]);
  const media = (await database.admin.query('SELECT asset_id FROM video_edit_assets')).rows;
  assert.equal(media.length, 1, 'the refused delete really left the upload');
  assert.equal((await api.call(`/editor/media/${media[0].asset_id}`, 'DELETE', {})).status, 204);
});
