/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove full native photo-library cardinality, private durable bytes, original grants, rollback and restarted package reads.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Count only payload blobs and verify distinct private namespaces including empty reader bookkeeping.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startNativeSqlFixture } from './native-sql-fixture.mjs';
let fixture, uploadInput;
before(async () => {
  fixture = await startNativeSqlFixture();
  const bytes = await fixture.sharp(randomBytes(1100 * 1000 * 3), { raw: { width: 1100, height: 1000, channels: 3 } }).png().toBuffer();
  assert.ok(bytes.length > 3200000 && bytes.length < 4194304);
  const form = new FormData(); form.append('file', new Blob([bytes], { type: 'image/png' }), 'owned.png');
  const req = new Request('http://fixture.invalid/', { method: 'POST', body: form });
  uploadInput = { method: 'POST', body: Buffer.from(await req.arrayBuffer()).toString('base64'), bodyEncoding: 'base64', headers: { 'content-type': req.headers.get('content-type') } };
});
after(async () => { await fixture?.close(); });
async function call(path, input, status = 200) { const reply = await fixture.call(path, input); assert.equal(reply.status, status, JSON.stringify(reply.body)); return reply; }
async function sql(text, values = []) { return fixture.rpc('alice', 'sql', { text, values, connection: 'durable-check' }); }
async function ownedFiles() {
  const dirs = await readdir(fixture.dataDir), files = [];
  for (const dir of dirs) for (const file of await readdir(join(fixture.dataDir, dir))) if (file.endsWith('.blob')) files.push(join(fixture.dataDir, dir, file));
  return files.sort();
}
test('64 large photos stay metadata-only and readable across a real runner restart, owner isolation and named permissions', async () => {
  const assets = [];
  try {
    for (let i = 0; i < 64; i++) assets.push((await call('/assets', uploadInput)).body.asset);
    assert.ok(assets.reduce((sum, asset) => sum + asset.bytes, 0) > 200 * 1024 * 1024);
    const rows = (await sql('SELECT asset_id,content_base64,blob_handle,byte_length FROM motion_assets')).rows;
    assert.equal(rows.length, 64); assert.ok(rows.every(row => row.content_base64 === null && row.blob_handle));
    assert.ok(Buffer.byteLength(JSON.stringify(rows)) < 20000, 'large native libraries load only metadata');
    assert.equal((await call('/assets')).body.assets.length, 64);
    await call('/assets', uploadInput, 409);
    const first = assets[0]; await fixture.restart('alice');
    const read = await call('/assets/' + first.id);
    const data = Buffer.from(read.body, read.representation?.encoding === 'base64' ? 'base64' : undefined);
    assert.equal(data.length, first.bytes); assert.equal(createHash('sha256').update(data).digest('hex'), first.sha256);
    await call('/assets/' + first.id, { actor: 'bob' }, 404);
    fixture.assign('alice', 'reader'); await call('/assets/' + first.id); await call('/assets/' + first.id, { method: 'DELETE' }, 403);
    fixture.deny('alice', 'project.read'); await call('/assets/' + first.id, {}, 403);
    fixture.assign('alice', 'administrator');
    const namespaces = await readdir(fixture.dataDir), p = fixture.principal('alice');
    const base = ['motion-studio', p.tenant, p.id, p.issuer, p.subject];
    for (const key of [base, [...base, 'revisions']]) assert.ok(namespaces.includes(createHash('sha256').update(JSON.stringify(key)).digest('hex')));
    assert.ok(namespaces.every(name => /^[0-9a-f]{64}$/.test(name)), 'private namespace names expose no caller identifiers');
    assert.equal((await ownedFiles()).length, 64);
  } finally {
    fixture.assign('alice', 'administrator');
    for (const asset of assets) await call('/assets/' + asset.id, { method: 'DELETE' });
  }
  assert.deepEqual(await ownedFiles(), []);
});
test('withdrawal after actual native metadata insertion rolls back SQL and only the new private byte file', async () => {
  const original = (await call('/assets', uploadInput)).body.asset, before = await ownedFiles();
  fixture.onSql((actor, args) => { if (actor === 'alice' && /^INSERT INTO motion_assets/.test(args.text)) { fixture.deny('alice', 'project.create'); fixture.deny('alice', 'project.change'); } });
  try {
    await call('/assets', uploadInput, 403);
    assert.deepEqual(await ownedFiles(), before);
    fixture.onSql(null); fixture.assign('alice', 'administrator');
    assert.deepEqual((await call('/assets')).body.assets.map(asset => asset.id), [original.id]);
    await call('/assets/' + original.id);
  } finally { fixture.onSql(null); fixture.assign('alice', 'administrator'); await call('/assets/' + original.id, { method: 'DELETE' }); }
});
test('native reads refuse on-disk corruption; absent lasting storage does not silently replace durable data', async () => {
  const asset = (await call('/assets', uploadInput)).body.asset, paths = await ownedFiles();
  const path = paths[0], bytes = await readFile(path);
  try {
    await writeFile(path, Buffer.alloc(bytes.length));
    const failed = await call('/assets/' + asset.id, {}, 503); assert.equal(failed.body.error, 'motion_blob_integrity_error');
    await writeFile(path, bytes); await call('/assets/' + asset.id);
    await fixture.restart('alice', { lasting: false });
    assert.equal((await call('/assets/' + asset.id, {}, 503)).body.error, 'motion_blob_storage_unavailable');
    assert.equal((await call('/assets')).body.assets.length, 1);
    assert.equal((await call('/assets', uploadInput, 503)).body.error, 'motion_blob_storage_unavailable');
    await fixture.restart('alice'); await call('/assets/' + asset.id);
  } finally { await call('/assets/' + asset.id, { method: 'DELETE' }); }
});
test('an uncertain COMMIT reply retains bytes belonging to successfully committed metadata', async () => {
  let tripped = false, inserted = false;
  fixture.onSql((actor, args) => {
    if (actor === 'alice' && /^INSERT INTO motion_assets/.test(args.text)) inserted = true;
    if (actor === 'alice' && inserted && args.transaction === 'commit' && !tripped) { tripped = true; throw new Error('fixture_commit_reply_lost'); }
  });
  try { await call('/assets', uploadInput, 503); }
  finally { fixture.onSql(null); }
  assert.equal(tripped, true);
  const assets = (await call('/assets')).body.assets;
  assert.equal(assets.length, 1); assert.equal((await ownedFiles()).length, 1);
  try { await call('/assets/' + assets[0].id); }
  finally { await call('/assets/' + assets[0].id, { method: 'DELETE' }); }
});
