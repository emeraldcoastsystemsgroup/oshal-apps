/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove exact native schema receipts, actual mounted revision/asset workflows, original-person isolation and kernel read-only/immutable refusal through the real SQL adapter.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Admit large real normalized photos through durable storage and reopen them after native runner replacement.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { startNativeSqlFixture } from './native-sql-fixture.mjs';
let fixture;
before(async () => { fixture = await startNativeSqlFixture(); });
after(async () => { await fixture?.close(); });
const fresh = title => ({ title, width: 320, height: 180, frameRate: 30, duration: 5, requestKey: randomUUID() });
async function call(path, input = {}, status = 200) {
  const answer = await fixture.call(path, input);
  assert.equal(answer.status, status, JSON.stringify(answer.body)); return answer.body;
}
async function sql(text, values = [], actor = 'alice', connection = 'pool') {
  return fixture.rpc(actor, 'sql', { text, values, connection });
}
let project;

test('actual native schema provisioning is complete, immutable and idempotent for each owner', async () => {
  for (const actor of ['alice', 'bob']) {
    const receipt = await fixture.rpc(actor, 'inspect'); assert.equal(receipt.complete, true);
    assert.equal(receipt.pending, 0); assert.equal(receipt.migrations.length, 1);
    const repeated = await fixture.rpc(actor, 'migrate'); assert.equal(repeated.applied, 0);
  }
  await assert.rejects(fixture.rpc('reader', 'migrate'), /writer admission/i);
});
test('mounted Motion create/edit/retry/restore preserves real native animation and rendered pixels', async () => {
  project = (await call('/projects', { method: 'POST', body: fresh('Native keyed logo') })).project;
  const request = { baseRevision: 1, requestKey: randomUUID(), commands: [
    { command: 'layer.newSolid', params: { name: 'Logo', color: '#ff0000', width: 100, height: 60 } },
    { command: 'prop.addKey', params: { layer: '#1', path: 'transform/opacity', time: 0, value: 0 } },
    { command: 'prop.addKey', params: { layer: '#1', path: 'transform/opacity', time: 5, value: 100 } },
  ] };
  const edited = (await call('/projects/' + project.id + '/operations', { method: 'POST', body: request })).project;
  assert.equal(edited.revision, 2);
  const replay = (await call('/projects/' + project.id + '/operations', { method: 'POST', body: request })).project;
  assert.equal(replay.revision, 2); assert.deepEqual(replay.document, edited.document);
  await call('/projects/' + project.id + '/operations', { method: 'POST', body: { ...request, requestKey: randomUUID() } }, 409);
  const opened = (await call('/projects/' + project.id)).project; assert.deepEqual(opened.document, edited.document);
  const preview = await call('/preview', { method: 'POST', body: { document: opened.document, time: 2.5 } });
  const { data, info } = await fixture.sharp(Buffer.from(preview.png, 'base64')).raw().toBuffer({ resolveWithObject: true });
  assert.equal(data[(90 * info.width + 160) * info.channels + 3], 128);
  const restored = (await call('/projects/' + project.id + '/restore', { method: 'POST', body: {
    revision: 1, baseRevision: 2, requestKey: randomUUID(),
  } })).project;
  assert.equal(restored.revision, 3);
  assert.equal((await call('/projects/' + project.id + '/revisions')).revisions.length, 3);
});
test('another admitted subject cannot query, read, mutate, export or delete the original project', async () => {
  assert.deepEqual((await call('/projects', { actor: 'bob' })).projects, []);
  for (const path of ['', '/revisions', '/export']) await call('/projects/' + project.id + path, { actor: 'bob' }, 404);
  await call('/projects/' + project.id, { actor: 'bob', method: 'DELETE' }, 404);
  await call('/projects/' + project.id + '/operations', { actor: 'bob', method: 'POST', body: {
    baseRevision: 3, requestKey: randomUUID(), commands: [{ command: 'layer.newSolid', params: { name: 'Foreign' } }],
  } }, 404);
  const forged = await sql('SELECT * FROM motion_projects WHERE owner_sub=$1', ['alice'], 'bob');
  assert.deepEqual(forged.rows, [], 'actual native person scope excludes rows even with another owner predicate');
  await fixture.rpc('bob', 'sql', { connection: 'forged-owner', transaction: 'begin' });
  try { await assert.rejects(sql("SELECT set_config('motion.owner_sub',$1,true)", ['alice'], 'bob', 'forged-owner'), /identity.*principal/i); }
  finally { await fixture.rpc('bob', 'sql', { connection: 'forged-owner', transaction: 'rollback' }); }
  assert.deepEqual((await sql('SELECT * FROM motion_projects', [], 'other-package')).rows, []);
  await fixture.rpc('same-subject', 'migrate');
  assert.deepEqual((await sql('SELECT * FROM motion_projects', [], 'same-subject')).rows, [], 'identical subjects from another issuer have separate native person scopes');
});
test('actual native triggers and read-only host refuse revision mutation and writes', async () => {
  await assert.rejects(sql('UPDATE motion_revisions SET title=$1 WHERE project_id=$2', ['Forged', project.id]), /immutable/i);
  assert.equal((await call('/projects/' + project.id)).project.title, 'Native keyed logo');
  await assert.rejects(sql('DELETE FROM motion_projects WHERE project_id=$1', [project.id], 'reader'), /store.write|read.only|write/i);
  assert.equal((await call('/projects/' + project.id)).project.revision, 3);
});
test('named export/change/delete remain independent in the mounted native application', async () => {
  fixture.deny('alice', 'project.export');
  try { await call('/projects/' + project.id + '/export', {}, 403); }
  finally { fixture.allow('alice', 'project.export'); }
  fixture.deny('alice', 'project.change');
  try { await call('/projects/' + project.id + '/restore', { method: 'POST', body: {} }, 403); }
  finally { fixture.allow('alice', 'project.change'); }
  fixture.deny('alice', 'project.delete');
  try { await call('/projects/' + project.id, { method: 'DELETE' }, 403); }
  finally { fixture.allow('alice', 'project.delete'); }
  const exported = await fixture.call('/projects/' + project.id + '/export'); assert.equal(exported.status, 200);
  assert.deepEqual(JSON.parse(exported.body), (await call('/projects/' + project.id)).project.document);
});

test('native multipart photo, immutable history, owned masks and source cleanup survive the actual kernel store', async () => {
  const image = await fixture.sharp({ create: { width: 16, height: 8, channels: 4,
    background: { r: 255, g: 0, b: 0, alpha: .5 } } }).png().toBuffer();
  const form = new FormData(); form.append('file', new Blob([image], { type: 'image/png' }), 'owned.png');
  const upload = new Request('http://fixture.invalid/', { method: 'POST', body: form });
  const bytes = Buffer.from(await upload.arrayBuffer());
  const uploaded = (await call('/assets', { method: 'POST', body: bytes.toString('base64'),
    bodyEncoding: 'base64', headers: { 'content-type': upload.headers.get('content-type') } })).asset;
  const created = (await call('/projects', { method: 'POST', body: fresh('Native owned photo') })).project;
  const edited = (await call('/projects/' + created.id + '/operations', { method: 'POST', body: {
    baseRevision: 1, requestKey: randomUUID(), commands: [
      { command: 'asset.import', params: { assetId: uploaded.id } },
      { command: 'layer.addMask', params: { layer: '#1', shape: 'rect', rect: [0, 0, 8, 8] } },
    ],
  } })).project;
  assert.deepEqual(edited.assets, [uploaded.id]);
  const opened = (await call('/projects/' + created.id)).project; assert.deepEqual(opened.document, edited.document);
  const preview = await call('/preview', { method: 'POST', body: { document: edited.document } });
  const repeated = await call('/preview', { method: 'POST', body: { document: opened.document } });
  assert.equal(preview.png, repeated.png, 'actual native store reopen renders byte-identical owned masked pixels');
  const { data, info } = await fixture.sharp(Buffer.from(preview.png, 'base64')).raw().toBuffer({ resolveWithObject: true });
  assert.ok([...data].some((value, index) => index % info.channels === 3 && value === 128));
  await call('/preview', { actor: 'bob', method: 'POST', body: { document: edited.document } }, 404);
  await call('/assets/' + uploaded.id, { actor: 'bob' }, 404);
  await call('/assets/' + uploaded.id, { method: 'DELETE' }, 409);
  await assert.rejects(sql('UPDATE motion_assets SET content_base64=$1 WHERE asset_id=$2', ['AAAA', uploaded.id]), /immutable/i);
  await call('/projects/' + created.id, { method: 'DELETE' });
  await call('/projects/' + created.id, {}, 404);
  await call('/assets/' + uploaded.id, { method: 'DELETE' });
  await call('/assets/' + uploaded.id, {}, 404);
});

test('native durable assets admit large normalized photos and keep the library readable', async () => {
  const image = await fixture.sharp(randomBytes(1100 * 1000 * 3), {
    raw: { width: 1100, height: 1000, channels: 3 },
  }).png().toBuffer();
  assert.ok(image.length < 4194304 && image.length > 3200000);
  async function upload(bytes) {
    const form = new FormData(); form.append('file', new Blob([bytes], { type: 'image/png' }), 'photo.png');
    const request = new Request('http://fixture.invalid/', { method: 'POST', body: form });
    return fixture.call('/assets', { method: 'POST', body: Buffer.from(await request.arrayBuffer()).toString('base64'),
      bodyEncoding: 'base64', headers: { 'content-type': request.headers.get('content-type') } });
  }
  const acceptedLarge = await upload(image);
  assert.equal(acceptedLarge.status, 200, JSON.stringify(acceptedLarge.body));
  const largeId = acceptedLarge.body.asset.id;
  assert.equal((await call('/assets')).assets[0].id, largeId);
  assert.equal((await fixture.call('/assets/' + largeId)).status, 200);
  await fixture.restart('alice');
  assert.equal((await fixture.call('/assets/' + largeId)).status, 200, 'bytes survive a new real package runner');
  await call('/assets/' + largeId, { method: 'DELETE' });
  const small = await fixture.sharp({ create: { width: 16, height: 8, channels: 4,
    background: { r: 0, g: 0, b: 255, alpha: .5 } } }).png().toBuffer();
  const accepted = await upload(small); assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  const id = accepted.body.asset.id;
  assert.equal((await call('/assets')).assets[0].id, id);
  assert.equal((await fixture.call('/assets/' + id)).status, 200);
  await call('/assets/' + id, { method: 'DELETE' });
  assert.deepEqual((await call('/assets')).assets, []);
});
