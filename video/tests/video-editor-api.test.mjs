/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The compiled editor router's HTTP admission over real Express and Multer with a strict non-writing pool: every route refuses a missing named permission before decoding or database work, upload needs create OR change, tenant and owner selectors and inactive identities are refused, envelopes and documents are checked by the shipped shared validator before any transaction, and uploads the named prober refuses leave no file behind.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | CREATE-EDIT-05c: the permission matrix covers the five export routes too.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | CREATE-EDIT-05d: the editor screen and its modules are served only from a fixed allowlist behind editor.view, byte for byte from the package.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, stat, truncate, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFile as readBytes } from 'node:fs/promises';
import { startApi, emptyPool, mediaBytes, mediaForm, clipProbe, bedProbe, timeline, loadCompiled, logged, fixtureProber, packageRoot } from './video-editor.fixture.mjs';

const ID = '12345678-1234-4234-8234-123456789abc';
const ASSET = 'aaaaaaaa-0000-4000-8000-000000000001';
const SOURCE = { kind: 'video', asset: ASSET, name: 'Clip', frames: 90, width: 320, height: 180, audio: true };
const ROUTES = [
  ['GET', '/editor', ['editor.view']],
  ['GET', '/editor/assets/editor.mjs', ['editor.view']],
  ['GET', '/editor/capabilities', ['editor.view']],
  ['GET', '/editor/permissions', ['editor.view']],
  ['GET', '/editor/projects', ['editor.view', 'editor.read']],
  ['GET', `/editor/projects/${ID}`, ['editor.view', 'editor.read']],
  ['GET', `/editor/projects/${ID}/revisions`, ['editor.view', 'editor.read']],
  ['GET', `/editor/projects/${ID}/revisions/2`, ['editor.view', 'editor.read']],
  ['GET', `/editor/media/${ID}`, ['editor.view', 'editor.read']],
  ['POST', '/editor/projects', ['editor.view', 'editor.create'], { title: 'x', document: timeline('x') }],
  ['POST', `/editor/projects/${ID}/revisions`, ['editor.view', 'editor.change'], { baseRevision: 1, title: 'x', document: timeline('x') }],
  ['DELETE', `/editor/projects/${ID}`, ['editor.view', 'editor.delete'], { baseRevision: 1 }],
  ['POST', '/editor/media/cleanup', ['editor.view', 'editor.delete'], {}],
  ['DELETE', `/editor/media/${ID}`, ['editor.view', 'editor.delete'], {}],
  ['POST', `/editor/projects/${ID}/exports`, ['editor.view', 'editor.read', 'editor.export'], { revision: 1 }],
  ['GET', `/editor/projects/${ID}/exports`, ['editor.view', 'editor.read']],
  ['GET', `/editor/exports/${ID}`, ['editor.view', 'editor.read']],
  ['POST', `/editor/exports/${ID}/cancel`, ['editor.view', 'editor.read', 'editor.export'], {}],
  ['GET', `/editor/exports/${ID}/download`, ['editor.view', 'editor.read', 'editor.export']],
];

async function incoming(dataRoot) { return existsSync(join(dataRoot, '.incoming')) ? readdir(join(dataRoot, '.incoming')) : []; }

test('every route refuses each missing named permission before any body, file or database work', async t => {
  for (const [method, path, required, body] of ROUTES) {
    for (const permission of required) {
      const pool = emptyPool(), api = await startApi(t, pool, { denied: [permission] });
      const response = await api.call(path, method, body);
      assert.equal(response.status, 403, `${method} ${path} without ${permission}`);
      assert.deepEqual(response.body, { error: 'video_edit_permission_denied' });
      assert.equal(pool.queries.length, 0, `${method} ${path} touched the database without ${permission}`);
    }
  }
});

test('upload needs view plus create OR change, and a refused publish leaves no temporary or published file', async t => {
  const bytes = mediaBytes('video', clipProbe());
  const both = emptyPool(), denied = await startApi(t, both, { denied: ['editor.create', 'editor.change'] });
  assert.equal((await denied.call('/editor/media?kind=video', 'POST', mediaForm(bytes))).status, 403);
  assert.deepEqual(await incoming(denied.dataRoot), [], 'the body was never decoded');
  assert.equal(both.queries.length, 0);
  for (const missing of ['editor.create', 'editor.change']) {
    const pool = emptyPool(), api = await startApi(t, pool, { denied: [missing] });
    const response = await api.call('/editor/media?kind=video', 'POST', mediaForm(bytes));
    assert.equal(response.status, 503, `admitted with only one of create/change (${missing} denied); the strict pool then refuses the INSERT`);
    assert.ok(pool.queries.some(query => /INSERT INTO video_edit_assets/.test(query.sql)));
    assert.deepEqual(await incoming(api.dataRoot), [], 'the temporary upload is gone');
    const owners = (await readdir(api.dataRoot)).filter(name => name !== '.incoming');
    for (const owner of owners) assert.deepEqual(await readdir(join(api.dataRoot, owner)), [], 'the refused file was removed');
  }
});

test('tenant, owner and workspace selectors and inactive identities are refused before any work', async t => {
  const pool = emptyPool(), api = await startApi(t, pool);
  for (const path of ['/editor/projects?tenantId=other', '/editor/projects?owner=bob', '/editor/projects?issuer=x', '/editor/projects?workspace=w']) {
    assert.deepEqual((await api.call(path)).body, { error: 'video_edit_personal_scope_only' }, path);
  }
  assert.equal((await api.call('/editor/projects', 'GET', undefined, 'alice', { 'x-oshal-tenant-id': 'other' })).status, 400);
  assert.deepEqual((await api.call('/editor/projects', 'GET', undefined, 'inactive')).body, { error: 'video_edit_verified_identity_required' });
  assert.equal(pool.queries.length, 0);
  const permissions = await api.call('/editor/permissions');
  assert.deepEqual(permissions.body.permissions, { view: true, read: true, create: true, change: true, delete: true, export: true });
  const limited = await startApi(t, emptyPool(), { denied: ['editor.delete', 'editor.export'] });
  assert.deepEqual((await limited.call('/editor/permissions')).body.permissions, { view: true, read: true, create: true, change: true, delete: false, export: false });
});

test('envelopes and documents are checked by the shipped shared validator before any transaction', async t => {
  const pool = emptyPool(), api = await startApi(t, pool);
  const good = { title: 'Edit', document: timeline('Edit', { v1: SOURCE }, [{ id: 's1', source: 'v1', in: 0, out: 30, volume: 100 }]) };
  const refusals = [
    [{ ...good, owner: 'bob' }, 'invalid_video_edit_fields'],
    [{ ...good, title: 'Other' }, 'video_edit_title_mismatch'],
    [{ ...good, title: '' }, 'invalid_video_edit_title'],
    [{ ...good, document: { ...good.document, segments: [{ id: 's1', source: 'v1', in: 0, out: 91, volume: 100 }] } }, 'invalid_video_edit_document'],
    [{ ...good, document: { ...good.document, sources: { v1: { ...SOURCE, asset: '/etc/passwd' } } } }, 'invalid_video_edit_document'],
    [{ ...good, document: { ...good.document, filter: 'movie=/etc/passwd' } }, 'invalid_video_edit_document'],
  ];
  for (const [body, code] of refusals) assert.deepEqual((await api.call('/editor/projects', 'POST', body)).body, { error: code }, code);
  assert.deepEqual((await api.call(`/editor/projects/${ID}/revisions`, 'POST', { ...good, baseRevision: '1' })).body, { error: 'invalid_base_revision' });
  assert.deepEqual((await api.call(`/editor/projects/${ID}/revisions`, 'POST', { ...good, baseRevision: 1.5 })).body, { error: 'invalid_base_revision' });
  assert.deepEqual((await api.call('/editor/projects/not-a-uuid')).body, { error: 'invalid_video_edit_id' });
  assert.deepEqual((await api.call(`/editor/projects/${ID}/revisions/1e3`)).body, { error: 'invalid_base_revision' });
  assert.deepEqual((await api.call(`/editor/projects/${ID}`, 'DELETE', { baseRevision: 1, force: true })).body, { error: 'invalid_video_edit_fields' });
  assert.deepEqual((await api.call('/editor/projects', 'POST', { title: 'x', document: timeline('x', {}, [], { pad: 'x'.repeat(300000) }) })).body, { error: 'invalid_video_edit_body' }, 'over the body bound');
  assert.equal(pool.queries.length, 0, 'no transaction was opened for a refused envelope');
});

test('uploads the named prober refuses are rejected with no file left behind and no database write', async t => {
  const pool = emptyPool(), api = await startApi(t, pool);
  const refusals = [
    ['video', mediaBytes('audio', bedProbe()), 'video_edit_media_unsupported', 'a WAV sent as a clip fails the signature'],
    ['video', mediaBytes('video', clipProbe({ codec: 'hevc' })), 'video_edit_media_unsupported', 'HEVC'],
    ['video', mediaBytes('video', clipProbe({ extra: [{ codec_type: 'audio', codec_name: 'aac' }] })), 'video_edit_media_unsupported', 'a second audio track is never dropped silently'],
    ['video', mediaBytes('video', clipProbe({ extra: [{ codec_type: 'subtitle', codec_name: 'mov_text' }] })), 'video_edit_media_unsupported', 'subtitle stream'],
    ['video', mediaBytes('video', clipProbe({ seconds: 31 })), 'video_edit_media_too_long', '31 s'],
    ['video', mediaBytes('video', clipProbe({ width: 2560, height: 1440 })), 'video_edit_media_unsupported', '1440p'],
    ['video', mediaBytes('video', clipProbe({ fps: '120/1' })), 'video_edit_media_unsupported', '120 fps'],
    ['audio', mediaBytes('audio', { ...bedProbe(), streams: [{ codec_type: 'audio', codec_name: 'mp3', channels: 2, sample_rate: '48000' }] }), 'video_edit_media_unsupported', 'MP3 in WAV'],
    ['audio', mediaBytes('audio', bedProbe({ seconds: 61 })), 'video_edit_media_too_long', '61 s bed'],
  ];
  for (const [kind, bytes, code, label] of refusals) {
    const response = await api.call(`/editor/media?kind=${kind}`, 'POST', mediaForm(bytes));
    assert.deepEqual(response.body, { error: code }, label);
  }
  assert.deepEqual((await api.call('/editor/media?kind=image', 'POST', mediaForm(mediaBytes('video', clipProbe())))).body, { error: 'invalid_video_edit_media_kind' });
  assert.deepEqual((await api.call('/editor/media', 'POST', mediaForm(mediaBytes('video', clipProbe())))).body, { error: 'invalid_video_edit_media_kind' });
  const two = mediaForm(mediaBytes('video', clipProbe())); two.append('media', new Blob([mediaBytes('video', clipProbe())]), 'second.mp4');
  assert.deepEqual((await api.call('/editor/media?kind=video', 'POST', two)).body, { error: 'invalid_video_edit_upload' });
  const field = mediaForm(mediaBytes('video', clipProbe())); field.append('owner', 'bob');
  assert.deepEqual((await api.call('/editor/media?kind=video', 'POST', field)).body, { error: 'invalid_video_edit_upload' });
  assert.deepEqual(await incoming(api.dataRoot), []);
  assert.equal(pool.queries.filter(query => /INSERT/.test(query.sql)).length, 0);
});

test('inspectUpload holds each kind to its byte ceiling before hashing or probing', async t => {
  const { inspectUpload } = loadCompiled('video-editor-media.js');
  const dir = await mkdtemp(resolve(tmpdir(), 'video-editor-inspect-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const big = join(dir, 'bed.upload');
  await writeFile(big, mediaBytes('audio', bedProbe()));
  await truncate(big, 33554433);
  let probed = 0;
  await assert.rejects(inspectUpload(big, 'audio', async file => { probed += 1; return fixtureProber(file); }), error => error.code === 'video_edit_media_too_large');
  assert.equal(probed, 0);
  const ok = join(dir, 'clip.upload');
  await writeFile(ok, mediaBytes('video', clipProbe({ seconds: 2.5 })));
  const media = await inspectUpload(ok, 'video', fixtureProber);
  assert.equal(media.bytes, (await stat(ok)).size);
  assert.deepEqual([media.kind, media.frames, media.durationMs, media.width, media.height, media.hasAudio, media.audioCodec], ['video', 75, 2500, 320, 180, true, 'aac']);
  assert.match(media.sha256, /^[0-9a-f]{64}$/);
});

test('an unexpected failure answers a stable code and is logged at error with the error itself', async t => {
  const broken = { connect: async () => { throw new Error('fixture connection refused'); } };
  const api = await startApi(t, broken);
  assert.deepEqual((await api.call('/editor/projects')).body, { error: 'video_edit_service_unavailable' });
  assert.ok(logged.some(entry => entry.level === 'error' && entry.fields?.err?.message === 'fixture connection refused'));
  assert.ok(logged.some(entry => entry.level === 'info' && entry.message === 'video editor request' && entry.fields.status === 503));
  const capabilities = await api.call('/editor/capabilities');
  assert.equal(capabilities.body.profile.width, 1280);
  assert.deepEqual(capabilities.body.uploads.video.videoCodecs, ['h264']);
});

test('the editor screen and its modules come only from a fixed allowlist, byte for byte', async t => {
  const pool = emptyPool(), api = await startApi(t, pool);
  const page = await api.call('/editor');
  assert.equal(page.status, 200); assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.equal(page.headers.get('cache-control'), 'private, no-store');
  assert.ok(page.body.equals(await readBytes(join(packageRoot, 'tools/editor/editor.html'))));
  for (const name of ['editor.mjs', 'editor-api.mjs', 'editor-player.mjs', 'editor-export.mjs', 'timeline-view.mjs', 'timeline-model.mjs',
    'timeline-validation.mjs', 'timeline-history.mjs', 'editor.css']) {
    const asset = await api.call(`/editor/assets/${name}`);
    assert.equal(asset.status, 200, name);
    assert.match(asset.headers.get('content-type'), name.endsWith('.css') ? /^text\/css/ : /^text\/javascript/, name);
    assert.ok(Buffer.from(typeof asset.body === 'string' ? asset.body : asset.body).equals(await readBytes(join(packageRoot, 'tools/editor', name))), name);
  }
  for (const name of ['editor.html', 'not-packaged.mjs', '..%2Foshal-app.yaml', '%2e%2e%2fauthorization.yaml']) {
    assert.equal((await api.call(`/editor/assets/${name}`)).status, 404, name);
  }
  assert.equal(pool.queries.length, 0, 'serving the screen touches no database');
});
