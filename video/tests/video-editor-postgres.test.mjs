/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The manual editor's persistence over the compiled routes and a disposable PostgreSQL migrated as the owning role: owned uploads with authenticated range playback, optimistic immutable revisions, 100 retained revisions, media references checked against the owner's own uploads, cross-owner and colliding-issuer denial down to the forced two-arm policy, revocation before commit, quotas, cleanup that keeps referenced media, and a max-two pool that completes concurrent writes whose authorization reads share it.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | CREATE-EDIT-05c: the forced two-arm policy check now covers video_edit_exports as well (every table the fixture's migrations create).
 * 3 | maintainer@emeraldcoastsystemsgroup.com | CREATE-EDIT-05d: deleting one owned upload removes its file and row, refuses one a retained revision uses, and never reaches another owner's.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { startApi, mediaBytes, mediaForm, clipProbe, bedProbe, timeline } from './video-editor.fixture.mjs';
import { startPostgres, resetPostgres, EDITOR_TABLES } from './video-editor-postgres.fixture.mjs';
// Real boundary: the compiled routes, real Express/Multer, and a real forced-RLS PostgreSQL. Scoped doubles: the
// framework actor/authorization (fixture context) and ffprobe (the NAMED fixtureProber; real ffprobe is covered by
// video-editor-media.test.mjs inside the runtime image).

let database, cleanup;
test.after(async () => { await cleanup?.(); });
test.before(async () => { database = await startPostgres(callback => { cleanup = callback; }); });
test.beforeEach(async () => { await resetPostgres(database.admin); });

async function upload(api, kind = 'video', probe = clipProbe(), actor = 'alice') {
  const response = await api.call(`/editor/media?kind=${kind}`, 'POST', mediaForm(mediaBytes(kind, probe)), actor);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.media;
}
const source = media => media.kind === 'video'
  ? { kind: 'video', asset: media.id, name: 'Clip', frames: media.frames, width: media.width, height: media.height, audio: media.hasAudio }
  : { kind: 'audio', asset: media.id, name: 'Bed', frames: media.frames };
const edit = (title, clip, out = 30, extra = {}) => ({ title, document: timeline(title, { v1: source(clip) }, [{ id: 's1', source: 'v1', in: 0, out, volume: 100 }], extra) });

test('an upload publishes one immutable owned file that plays back whole or by byte range', async t => {
  const api = await startApi(t, database.pool);
  const clip = await upload(api, 'video', clipProbe({ seconds: 3 }));
  assert.deepEqual([clip.kind, clip.frames, clip.width, clip.height, clip.hasAudio, clip.videoCodec, clip.audioCodec], ['video', 90, 320, 180, true, 'h264', 'aac']);
  const owners = (await readdir(api.dataRoot)).filter(name => name !== '.incoming');
  assert.equal(owners.length, 1);
  const stored = await readFile(join(api.dataRoot, owners[0], `${clip.id}.mp4`));
  assert.equal(createHash('sha256').update(stored).digest('hex'), clip.sha256);
  const whole = await api.call(`/editor/media/${clip.id}`);
  assert.equal(whole.status, 200); assert.equal(whole.headers.get('content-type'), 'video/mp4');
  assert.equal(whole.headers.get('cache-control'), 'private, no-store'); assert.ok(stored.equals(whole.body));
  const part = await api.call(`/editor/media/${clip.id}`, 'GET', undefined, 'alice', { range: 'bytes=4-11' });
  assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), `bytes 4-11/${stored.length}`);
  assert.equal(part.body.toString('latin1'), 'ftypisom');
  const tail = await api.call(`/editor/media/${clip.id}`, 'GET', undefined, 'alice', { range: 'bytes=-4' });
  assert.ok(tail.body.equals(stored.subarray(stored.length - 4)));
  for (const range of [`bytes=${stored.length}-`, 'bytes=9-2', 'items=0-1', 'bytes=0-1,4-5']) {
    assert.equal((await api.call(`/editor/media/${clip.id}`, 'GET', undefined, 'alice', { range })).status, 416, range);
  }
  const bed = await upload(api, 'audio', bedProbe({ seconds: 12 }));
  assert.deepEqual([bed.kind, bed.frames, bed.audioCodec, bed.width], ['audio', 360, 'pcm_s16le', null]);
  assert.equal((await api.call(`/editor/media/${bed.id}`)).headers.get('content-type'), 'audio/wav');
});

test('projects save immutable revisions optimistically and keep the newest 100', async t => {
  const api = await startApi(t, database.pool);
  const clip = await upload(api);
  const created = await api.call('/editor/projects', 'POST', edit('First cut', clip));
  assert.equal(created.status, 201); assert.equal(created.body.project.revision, 1);
  const id = created.body.project.id;
  const saved = await api.call(`/editor/projects/${id}/revisions`, 'POST', { baseRevision: 1, ...edit('Second cut', clip, 60) });
  assert.equal(saved.body.project.revision, 2);
  const stale = await api.call(`/editor/projects/${id}/revisions`, 'POST', { baseRevision: 1, ...edit('Late tab', clip, 45) });
  assert.deepEqual([stale.status, stale.body], [409, { error: 'video_edit_revision_conflict' }]);
  assert.equal((await api.call(`/editor/projects/${id}`)).body.project.document.segments[0].out, 60, 'the late save did not replace the newer revision');
  assert.equal((await api.call(`/editor/projects/${id}/revisions/1`)).body.project.title, 'First cut');
  assert.deepEqual((await api.call(`/editor/projects/${id}/revisions`)).body.revisions.map(row => row.revision), [2, 1]);
  await assert.rejects(database.admin.query(`UPDATE video_edit_revisions SET title='x' WHERE project_id=$1`, [id]), /immutable/);
  for (let revision = 2; revision <= 101; revision += 1) {
    const next = await api.call(`/editor/projects/${id}/revisions`, 'POST', { baseRevision: revision, ...edit(`Cut ${revision + 1}`, clip, 30 + (revision % 30)) });
    assert.equal(next.status, 201);
  }
  const retained = (await api.call(`/editor/projects/${id}/revisions`)).body.revisions.map(row => row.revision);
  assert.deepEqual([retained.length, retained[0], retained.at(-1)], [100, 102, 3]);
  assert.equal((await api.call(`/editor/projects/${id}/revisions/2`)).status, 404, 'revision 2 was retired');
  const rows = await database.admin.query('SELECT count(*)::int AS count FROM video_edit_revision_assets WHERE project_id=$1', [id]);
  assert.equal(rows.rows[0].count, 100, 'retired revisions released their media references');
});

test('a document may reference only the owner\'s own uploads with exactly their verified metadata', async t => {
  const api = await startApi(t, database.pool);
  const clip = await upload(api), bobs = await upload(api, 'video', clipProbe(), 'bob');
  const wrong = edit('Wrong frames', { ...clip, frames: 89 });
  assert.deepEqual((await api.call('/editor/projects', 'POST', wrong)).body, { error: 'video_edit_media_unavailable' });
  assert.deepEqual((await api.call('/editor/projects', 'POST', edit('Silent claim', { ...clip, hasAudio: false }))).body, { error: 'video_edit_media_unavailable' });
  assert.deepEqual((await api.call('/editor/projects', 'POST', edit('Borrowed', bobs))).body, { error: 'video_edit_media_unavailable' });
  const bed = await upload(api, 'audio', bedProbe());
  const document = timeline('With bed', { v1: source(clip), m1: source(bed) }, [{ id: 's1', source: 'v1', in: 0, out: 90, volume: 100 }], { audioBed: { source: 'm1', volume: 30 } });
  assert.equal((await api.call('/editor/projects', 'POST', { title: 'With bed', document })).status, 201);
  const count = await database.admin.query('SELECT count(*)::int AS count FROM video_edit_projects');
  assert.equal(count.rows[0].count, 1, 'refused documents wrote nothing');
});

test('another owner and a colliding issuer see and change nothing', async t => {
  const api = await startApi(t, database.pool);
  const clip = await upload(api);
  const id = (await api.call('/editor/projects', 'POST', edit('Private', clip))).body.project.id;
  for (const actor of ['bob', 'collision']) {
    assert.equal((await api.call(`/editor/projects/${id}`, 'GET', undefined, actor)).status, 404, actor);
    assert.equal((await api.call(`/editor/media/${clip.id}`, 'GET', undefined, actor)).status, 404, actor);
    assert.deepEqual((await api.call('/editor/projects', 'GET', undefined, actor)).body, { projects: [] }, actor);
    assert.equal((await api.call(`/editor/projects/${id}/revisions`, 'POST', { baseRevision: 1, ...edit('Hijack', clip) }, actor)).status, 404, actor);
    assert.equal((await api.call(`/editor/projects/${id}`, 'DELETE', { baseRevision: 1 }, actor)).status, 404, actor);
  }
  assert.equal((await api.call(`/editor/projects/${id}`)).body.project.title, 'Private');
  assert.equal((await api.call(`/editor/projects/${id}`, 'DELETE', { baseRevision: 2 })).status, 409);
  assert.equal((await api.call(`/editor/projects/${id}`, 'DELETE', { baseRevision: 1 })).status, 204);
  assert.equal((await api.call(`/editor/projects/${id}`)).status, 404);
  assert.equal((await api.call(`/editor/media/${clip.id}`)).status, 200, 'deleting a project never deletes its uploads');
});

test('the forced two-arm policy holds against the owning role itself, with no operator arm', async () => {
  const { pool, admin } = database;
  const rows = await admin.query(`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner FROM pg_class c
    WHERE c.relname = ANY($1) ORDER BY c.relname`, [EDITOR_TABLES]);
  assert.equal(rows.rows.length, EDITOR_TABLES.length);
  for (const row of rows.rows) assert.deepEqual([row.relrowsecurity, row.relforcerowsecurity, row.owner], [true, true, 'video_fixture_app'], row.relname);
  const policies = await admin.query('SELECT tablename, qual, with_check FROM pg_policies WHERE tablename = ANY($1)', [EDITOR_TABLES]);
  assert.equal(policies.rows.length, EDITOR_TABLES.length);
  for (const policy of policies.rows) {
    for (const text of [policy.qual, policy.with_check]) {
      assert.match(text, /video\.owner_sub/); assert.match(text, /oshal\.current_sub/); assert.doesNotMatch(text, /is_operator/);
    }
  }
  await admin.query(`INSERT INTO video_edit_projects (project_id,owner_issuer,owner_sub,title) VALUES ('11111111-1111-4111-8111-111111111111','https://video-identity.fixture.test','alice','Row')`);
  const as = async (settings, sql, values = []) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [name, value] of Object.entries(settings)) await client.query('SELECT set_config($1,$2,true)', [name, value]);
      const result = await client.query(sql, values); await client.query('ROLLBACK'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  };
  const count = 'SELECT count(*)::int AS count FROM video_edit_projects';
  const alice = { 'video.owner_issuer': 'https://video-identity.fixture.test', 'video.owner_sub': 'alice' };
  assert.equal((await as({}, count)).rows[0].count, 0, 'unstamped');
  assert.equal((await as(alice, count)).rows[0].count, 1, 'package arm');
  assert.equal((await as({ ...alice, 'video.owner_issuer': 'https://other-video.fixture.test' }, count)).rows[0].count, 0, 'wrong issuer');
  assert.equal((await as({ 'oshal.current_issuer': 'https://video-identity.fixture.test', 'oshal.current_sub': 'alice' }, count)).rows[0].count, 1, 'platform arm');
  assert.equal((await as({ 'oshal.current_issuer': '', 'oshal.current_sub': '', 'oshal.is_operator': 'on' }, count)).rows[0].count, 0, 'empty system stamp, operator flag ignored');
  assert.equal((await as({ ...alice, 'video.owner_sub': 'bob' }, "UPDATE video_edit_projects SET title='x'")).rowCount, 0);
  assert.equal((await as({ ...alice, 'video.owner_sub': 'bob' }, 'DELETE FROM video_edit_projects')).rowCount, 0);
  await assert.rejects(as(alice, `INSERT INTO video_edit_projects (project_id,owner_issuer,owner_sub,title) VALUES ('22222222-2222-4222-8222-222222222222','https://video-identity.fixture.test','bob','Forged')`), /row-level security/);
  await admin.query('ALTER TABLE video_edit_projects NO FORCE ROW LEVEL SECURITY');
  try { assert.equal((await as({}, count)).rows[0].count, 1, 'without FORCE the owning role reads everything - which is why FORCE is required'); }
  finally { await admin.query('ALTER TABLE video_edit_projects FORCE ROW LEVEL SECURITY'); }
  assert.equal((await as({}, count)).rows[0].count, 0);
});

test('a permission revoked before commit rolls the write back', async t => {
  const dedicated = database.makePool(2);
  const revoking = { connect: async () => {
    const client = await dedicated.connect(), query = client.query.bind(client);
    return Object.assign(client, { query: async (sql, values) => {
      if (/^INSERT INTO video_edit_revisions/.test(sql)) revoking.api.state.denied.add('editor.create');
      return query(sql, values);
    } });
  } };
  const plain = await startApi(t, database.pool);
  const clip = await upload(plain);
  revoking.api = await startApi(t, revoking, { dataRoot: plain.dataRoot });
  assert.deepEqual((await revoking.api.call('/editor/projects', 'POST', edit('Revoked', clip))).body, { error: 'video_edit_permission_denied' });
  assert.equal((await database.admin.query('SELECT count(*)::int AS count FROM video_edit_projects')).rows[0].count, 0);
});

test('owner quotas are serialized and refuse before publishing, and cleanup keeps referenced media', async t => {
  const api = await startApi(t, database.pool);
  const kept = await upload(api), spare = await upload(api);
  await api.call('/editor/projects', 'POST', edit('Keeps one', kept));
  await database.admin.query('ALTER TABLE video_edit_assets DISABLE TRIGGER video_edit_asset_immutable');
  await database.admin.query("UPDATE video_edit_assets SET created_at = now() - interval '2 days'");
  await database.admin.query('ALTER TABLE video_edit_assets ENABLE TRIGGER video_edit_asset_immutable');
  const cleaned = await api.call('/editor/media/cleanup', 'POST', {});
  assert.deepEqual(cleaned.body, { deleted: [spare.id] });
  assert.equal((await api.call(`/editor/media/${spare.id}`)).status, 404);
  assert.equal((await api.call(`/editor/media/${kept.id}`)).status, 200);
  await database.admin.query(`INSERT INTO video_edit_assets (asset_id,owner_issuer,owner_sub,kind,byte_length,sha256,container,video_codec,audio_codec,width,height,frames,duration_ms,has_audio)
    VALUES ('33333333-3333-4333-8333-333333333333','https://video-identity.fixture.test','alice','video',104857600,repeat('a',64),'mp4','h264',NULL,320,180,900,30000,false),
           ('44444444-4444-4444-8444-444444444444','https://video-identity.fixture.test','alice','video',104857600,repeat('b',64),'mp4','h264',NULL,320,180,900,30000,false),
           ('55555555-5555-4555-8555-555555555555','https://video-identity.fixture.test','alice','video',104857600,repeat('c',64),'mp4','h264',NULL,320,180,900,30000,false),
           ('66666666-6666-4666-8666-666666666666','https://video-identity.fixture.test','alice','video',104857600,repeat('d',64),'mp4','h264',NULL,320,180,900,30000,false),
           ('77777777-7777-4777-8777-777777777777','https://video-identity.fixture.test','alice','video',104857600,repeat('e',64),'mp4','h264',NULL,320,180,900,30000,false)`);
  const full = await api.call('/editor/media?kind=video', 'POST', mediaForm(mediaBytes('video', clipProbe())));
  assert.deepEqual([full.status, full.body], [409, { error: 'video_edit_media_limit' }], 'five 100 MiB clips already fill 500 MiB');
  assert.equal((await upload(api, 'video', clipProbe(), 'bob')).kind, 'video', 'the quota is per owner');
});

test('a max-two pool completes concurrent writes whose authorization reads share it', async t => {
  const small = { pool: database.makePool(2) };
  const api = await startApi(t, small.pool);
  const clips = [await upload(api), await upload(api, 'video', clipProbe(), 'bob')];
  const authorize = api.resources.get('editor').authorize;
  api.resources.set('editor', { authorize: async input => { await small.pool.query('SELECT 1'); return authorize(input); } });
  const ids = [];
  for (const [index, actor] of ['alice', 'bob'].entries()) ids.push([actor, (await api.call('/editor/projects', 'POST', edit(`Busy ${actor}`, clips[index]), actor)).body.project.id, index]);
  const writes = ids.flatMap(([actor, id, index]) => [1, 2, 3].map(() => api.call(`/editor/projects/${id}/revisions`, 'POST', { baseRevision: 1, ...edit(`Race ${actor}`, clips[index]) }, actor)));
  const results = await Promise.all([...writes, api.call('/editor/projects'), api.call('/editor/projects', 'GET', undefined, 'bob')]);
  const statuses = results.slice(0, 6).map(result => result.status).sort();
  assert.deepEqual(statuses, [201, 201, 409, 409, 409, 409], 'exactly one save per project wins; the rest conflict, none time out');
  assert.equal(results[6].status, 200); assert.equal(results[7].status, 200);
});

test('an unused upload can be deleted by its owner; one a revision uses cannot', async t => {
  const api = await startApi(t, database.pool);
  const kept = await upload(api), spare = await upload(api);
  await api.call('/editor/projects', 'POST', edit('Uses one', kept));
  assert.deepEqual((await api.call(`/editor/media/${kept.id}`, 'DELETE', {})).body, { error: 'video_edit_media_in_use' });
  assert.equal((await api.call(`/editor/media/${spare.id}`, 'DELETE', {}, 'bob')).status, 404, 'another owner reaches nothing');
  assert.equal((await api.call(`/editor/media/${spare.id}`, 'DELETE', { force: true })).status, 400);
  assert.equal((await api.call(`/editor/media/${spare.id}`, 'DELETE', {})).status, 204);
  assert.equal((await api.call(`/editor/media/${spare.id}`)).status, 404);
  const owner = (await readdir(api.dataRoot)).filter(name => !name.startsWith('.'))[0];
  assert.deepEqual((await readdir(join(api.dataRoot, owner))).sort(), [`${kept.id}.mp4`], 'only the used file remains');
});
