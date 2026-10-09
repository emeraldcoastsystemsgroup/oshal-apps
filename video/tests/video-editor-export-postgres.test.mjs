/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Export routes over the compiled router and a disposable forced-RLS PostgreSQL, with the NAMED fixture encoder in place of FFmpeg (real FFmpeg runs in video-edit-export.test.mjs): a job renders exactly its saved revision and downloads only when verified, one job per owner, cancel of a running and of a queued job, another owner sees nothing, a prior-epoch job reads and is recorded as interrupted, revocation before start fails the job, tampered media never encode, each project keeps at most three exports, and revision retention never retires a revision an export is rendering.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Regression: deleting a project removes its finished export files and stops its running job, leaving no file behind.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { open as openFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startApi, mediaBytes, mediaForm, clipProbe, timeline, fixtureEncoder } from './video-editor.fixture.mjs';
import { startPostgres, resetPostgres } from './video-editor-postgres.fixture.mjs';
// Real boundary: the compiled routes and runner, real Express/Multer, and a real forced-RLS PostgreSQL. Scoped doubles: the framework
// actor/authorization (fixture context), ffprobe for uploads, and FFmpeg for exports (the NAMED fixture encoder and output prober).

let database, cleanup;
test.after(async () => { await cleanup?.(); });
test.before(async () => { database = await startPostgres(callback => { cleanup = callback; }); });
test.beforeEach(async () => { await resetPostgres(database.admin); });

async function project(api, actor = 'alice', frames = 60) {
  const upload = await api.call('/editor/media?kind=video', 'POST', mediaForm(mediaBytes('video', clipProbe())), actor);
  assert.equal(upload.status, 201);
  const clip = upload.body.media;
  const source = { kind: 'video', asset: clip.id, name: 'Clip', frames: clip.frames, width: clip.width, height: clip.height, audio: clip.hasAudio };
  const created = await api.call('/editor/projects', 'POST', { title: 'Cut', document: timeline('Cut', { v1: source }, frames ? [{ id: 's1', source: 'v1', in: 0, out: frames, volume: 100 }] : []) }, actor);
  assert.equal(created.status, 201);
  return { id: created.body.project.id, clip, source };
}
async function settled(api, id, actor = 'alice') {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const row = (await api.call(`/editor/exports/${id}`, 'GET', undefined, actor)).body.export;
    if (!['queued', 'running'].includes(row.status)) return row;
    await new Promise(done => setTimeout(done, 25));
  }
  throw new Error('export did not settle');
}

test('an export renders exactly its saved revision and downloads only once verified', async t => {
  const fixture = fixtureEncoder(), api = await startApi(t, database.pool, { exports: fixture });
  const { id } = await project(api);
  const queued = await api.call(`/editor/projects/${id}/exports`, 'POST', { revision: 1 });
  assert.equal(queued.status, 202); assert.equal(queued.body.export.totalFrames, 60);
  const done = await settled(api, queued.body.export.id);
  assert.deepEqual([done.status, done.outputFrames, done.progressFrames], ['succeeded', 60, 60]);
  assert.equal(fixture.calls[0].frames, 60, 'the job compiled the saved revision');
  const download = await api.call(`/editor/exports/${done.id}/download`);
  assert.equal(download.status, 200); assert.equal(download.headers.get('content-type'), 'video/mp4');
  assert.match(download.headers.get('content-disposition'), /^attachment; filename="video-export-[0-9a-f-]{36}\.mp4"$/);
  assert.equal(download.body.length, done.outputBytes);
  assert.match((await api.call(`/editor/exports/${done.id}/download?inline=1`)).headers.get('content-disposition'), /^inline;/);
  const preview = await api.call(`/editor/projects/${id}/exports`, 'POST', { revision: 1, variant: 'preview' });
  assert.equal((await settled(api, preview.body.export.id)).status, 'succeeded');
  assert.match(fixture.calls[1].args[fixture.calls[1].args.indexOf('-filter_complex') + 1], /scale=640:360:/);
  assert.deepEqual((await api.call(`/editor/projects/${id}/exports`)).body.exports.map(row => row.variant), ['preview', 'export']);
  assert.deepEqual((await readdir(join(api.dataRoot, '.work'))), [], 'no work directory remains');
  assert.deepEqual((await api.call(`/editor/projects/${id}/exports`, 'POST', { revision: 9 })).body, { error: 'video_edit_revision_not_found' });
  assert.deepEqual((await api.call(`/editor/projects/${id}/exports`, 'POST', { revision: 1, variant: 'lossless' })).body, { error: 'invalid_video_edit_export_variant' });
  const empty = await project(api, 'alice', 0);
  assert.deepEqual((await api.call(`/editor/projects/${empty.id}/exports`, 'POST', { revision: 1 })).body, { error: 'video_edit_export_empty' });
});

test('one job per owner; cancelling a running and a queued job leaves no output', async t => {
  const fixture = fixtureEncoder(), api = await startApi(t, database.pool, { exports: fixture });
  const alice = await project(api), bob = await project(api, 'bob');
  fixture.hold();
  const running = (await api.call(`/editor/projects/${alice.id}/exports`, 'POST', { revision: 1 })).body.export;
  assert.deepEqual((await api.call(`/editor/projects/${alice.id}/exports`, 'POST', { revision: 1 })).body, { error: 'video_edit_export_in_progress' });
  const waiting = (await api.call(`/editor/projects/${bob.id}/exports`, 'POST', { revision: 1 }, 'bob')).body.export;
  assert.equal((await api.call(`/editor/exports/${waiting.id}`, 'GET', undefined, 'bob')).body.export.status, 'queued', 'one encode per process');
  const cancelQueued = await api.call(`/editor/exports/${waiting.id}/cancel`, 'POST', {}, 'bob');
  assert.deepEqual([cancelQueued.status, cancelQueued.body.export.status], [202, 'cancelled']);
  assert.equal((await api.call(`/editor/exports/${running.id}/cancel`, 'POST', {})).status, 202);
  const stopped = await settled(api, running.id);
  assert.deepEqual([stopped.status, stopped.cancelRequested, stopped.outputBytes], ['cancelled', true, null]);
  fixture.release();
  assert.equal(fixture.calls.length, 1, 'the queued job never started');
  assert.deepEqual((await api.call(`/editor/exports/${running.id}/download`)).body, { error: 'video_edit_export_not_ready' });
  assert.equal(existsSync(join(api.dataRoot, 'exports')), false);
  const again = (await api.call(`/editor/projects/${alice.id}/exports`, 'POST', { revision: 1 })).body.export;
  assert.equal((await settled(api, again.id)).status, 'succeeded', 'a finished job no longer blocks the owner');
});

test('another owner sees, cancels and downloads nothing', async t => {
  const fixture = fixtureEncoder(), api = await startApi(t, database.pool, { exports: fixture });
  const { id } = await project(api);
  const done = await settled(api, (await api.call(`/editor/projects/${id}/exports`, 'POST', { revision: 1 })).body.export.id);
  for (const actor of ['bob', 'collision']) {
    assert.equal((await api.call(`/editor/exports/${done.id}`, 'GET', undefined, actor)).status, 404, actor);
    assert.equal((await api.call(`/editor/exports/${done.id}/cancel`, 'POST', {}, actor)).status, 404, actor);
    assert.equal((await api.call(`/editor/exports/${done.id}/download`, 'GET', undefined, actor)).status, 404, actor);
    assert.equal((await api.call(`/editor/projects/${id}/exports`, 'POST', { revision: 1 }, actor)).status, 404, actor);
  }
  assert.equal((await api.call(`/editor/exports/${done.id}`)).body.export.status, 'succeeded');
});

test('a job from another process epoch reads and is recorded as interrupted, and never blocks a new export', async t => {
  const fixture = fixtureEncoder(), api = await startApi(t, database.pool, { exports: fixture });
  const { id } = await project(api);
  await database.admin.query(`INSERT INTO video_edit_exports (export_id,project_id,owner_issuer,owner_sub,revision,variant,profile,snapshot_sha256,status,process_epoch,total_frames)
    VALUES ('99999999-9999-4999-8999-999999999999',$1,'https://video-identity.fixture.test','alice',1,'export','hd720p30',repeat('0',64),'running','11111111-1111-4111-8111-111111111111',60)`, [id]);
  const stale = (await api.call('/editor/exports/99999999-9999-4999-8999-999999999999')).body.export;
  assert.deepEqual([stale.status, stale.error], ['interrupted', 'video_edit_export_interrupted']);
  const fresh = (await api.call(`/editor/projects/${id}/exports`, 'POST', { revision: 1 })).body.export;
  assert.equal((await settled(api, fresh.id)).status, 'succeeded');
  const row = await database.admin.query("SELECT status,error FROM video_edit_exports WHERE export_id='99999999-9999-4999-8999-999999999999'");
  assert.deepEqual(row.rows[0], { status: 'interrupted', error: 'video_edit_export_interrupted' }, 'recorded, not replayed');
  assert.equal(fixture.calls.length, 1);
});

test('revocation before start fails the job and tampered media never reach the encoder', async t => {
  const fixture = fixtureEncoder(), api = await startApi(t, database.pool, { exports: fixture });
  const first = await project(api), second = await project(api, 'bob');
  fixture.hold();
  const blocking = (await api.call(`/editor/projects/${first.id}/exports`, 'POST', { revision: 1 })).body.export;
  const revoked = (await api.call(`/editor/projects/${second.id}/exports`, 'POST', { revision: 1 }, 'bob')).body.export;
  api.state.denied.add('editor.export');
  fixture.release();
  assert.equal((await settled(api, blocking.id)).status, 'failed', 'revoked while encoding: the pre-publish check refuses');
  assert.deepEqual([(await settled(api, revoked.id, 'bob')).status, (await settled(api, revoked.id, 'bob')).error], ['failed', 'video_edit_permission_revoked']);
  api.state.denied.clear();
  const owners = (await readdir(api.dataRoot)).filter(name => !name.startsWith('.'));
  // Same size, different bytes: only the digest re-check can notice (a size change is refused earlier, when the file is opened).
  for (const owner of owners) for (const file of await readdir(join(api.dataRoot, owner))) {
    if (!file.endsWith('.mp4')) continue;
    const handle = await openFile(join(api.dataRoot, owner, file), 'r+');
    try { await handle.write(Buffer.from('#'), 0, 1, 12); } finally { await handle.close(); }
  }
  const calls = fixture.calls.length;
  const tampered = (await api.call(`/editor/projects/${first.id}/exports`, 'POST', { revision: 1 })).body.export;
  assert.deepEqual([(await settled(api, tampered.id)).status, (await settled(api, tampered.id)).error], ['failed', 'video_edit_storage_unavailable']);
  assert.equal(fixture.calls.length, calls, 'the encoder never saw a changed file');
});

test('each project keeps at most three exports, and retention never retires a revision an export is rendering', async t => {
  const fixture = fixtureEncoder(), api = await startApi(t, database.pool, { exports: fixture });
  const { id, source } = await project(api);
  const ids = [];
  for (let run = 0; run < 4; run += 1) ids.push((await settled(api, (await api.call(`/editor/projects/${id}/exports`, 'POST', { revision: 1 })).body.export.id)).id);
  assert.deepEqual((await api.call(`/editor/projects/${id}/exports`)).body.exports.map(row => row.id), ids.slice(1).reverse());
  const exportsDir = (await readdir(api.dataRoot)).filter(name => !name.startsWith('.')).map(owner => join(api.dataRoot, owner, 'exports'))[0];
  assert.deepEqual((await readdir(exportsDir)).sort(), ids.slice(1).map(one => `${one}.mp4`).sort(), 'the pruned export file is gone');
  fixture.hold();
  const rendering = (await api.call(`/editor/projects/${id}/exports`, 'POST', { revision: 1 })).body.export;
  for (let revision = 1; revision <= 100; revision += 1) {
    const saved = await api.call(`/editor/projects/${id}/revisions`, 'POST', { baseRevision: revision, title: 'Cut',
      document: timeline('Cut', { v1: source }, [{ id: 's1', source: 'v1', in: 0, out: 30 + (revision % 30), volume: 100 }]) });
    assert.equal(saved.status, 201);
  }
  assert.equal((await api.call(`/editor/projects/${id}/revisions/1`)).status, 200, 'the revision being rendered is kept');
  fixture.release();
  assert.equal((await settled(api, rendering.id)).status, 'succeeded');
});

test('deleting a project removes its export files and stops its running job', async t => {
  const fixture = fixtureEncoder(), api = await startApi(t, database.pool, { exports: fixture });
  const finished = await project(api), running = await project(api);
  const done = await settled(api, (await api.call(`/editor/projects/${finished.id}/exports`, 'POST', { revision: 1 })).body.export.id);
  const exportsDir = (await readdir(api.dataRoot)).filter(name => !name.startsWith('.')).map(owner => join(api.dataRoot, owner, 'exports'))[0];
  assert.deepEqual(await readdir(exportsDir), [`${done.id}.mp4`]);
  assert.equal((await api.call(`/editor/projects/${finished.id}`, 'DELETE', { baseRevision: 1 })).status, 204);
  assert.deepEqual(await readdir(exportsDir), [], 'the finished export file went with its project');
  assert.equal((await api.call(`/editor/exports/${done.id}`)).status, 404);
  fixture.hold();
  const busy = (await api.call(`/editor/projects/${running.id}/exports`, 'POST', { revision: 1 })).body.export;
  assert.equal((await api.call(`/editor/projects/${running.id}`, 'DELETE', { baseRevision: 1 })).status, 204);
  fixture.release();
  const deadline = Date.now() + 5000;
  while (existsSync(join(api.dataRoot, '.work')) && (await readdir(join(api.dataRoot, '.work'))).length) { assert.ok(Date.now() < deadline); await new Promise(done2 => setTimeout(done2, 25)); }
  assert.deepEqual(await readdir(exportsDir), [], 'the stopped job published nothing');
  assert.equal((await api.call(`/editor/exports/${busy.id}`)).status, 404);
  assert.equal((await api.call(`/editor/projects/${running.id}/exports`, 'POST', { revision: 1 })).status, 404);
});
