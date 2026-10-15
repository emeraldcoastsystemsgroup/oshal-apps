/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise real durable revision workflows and full native history cardinality with explicit source fixture seeding.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Keep payload-file cardinality assertions separate from persistent private lock bookkeeping.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MotionOwnedBlobs } from '../routes/owned-blobs.mjs';
import { stringifyNative, readProject } from '../tools/native-json.mjs';
import { startNativeSqlFixture } from './native-sql-fixture.mjs';
let fixture;
before(async () => { fixture = await startNativeSqlFixture(); });
after(async () => { await fixture?.close(); });
const fresh = title => ({ title, width: 320, height: 180, frameRate: 30, duration: 5, requestKey: randomUUID() });
async function call(path, options = {}, status = 200) { const reply = await fixture.call(path, options); assert.equal(reply.status, status, JSON.stringify(reply.body)); return reply; }
async function sql(text, values = []) { return fixture.rpc('alice', 'sql', { text, values, connection: 'revision-growth-fixture' }); }
async function project(path, options) { return readProject((await call(path, options)).body.project); }
async function files() { const result = []; for (const dir of await readdir(fixture.dataDir)) for (const name of await readdir(join(fixture.dataDir, dir))) if (name.endsWith('.blob')) result.push(join(fixture.dataDir, dir, name)); return result.sort(); }
function comp(document) { return Object.values(document.items).find(item => item.kind.type === 'Comp').id; }
async function operation(saved, commands, requestKey = randomUUID()) { return project('/projects/' + saved.id + '/operations', { method: 'POST', body: { baseRevision: saved.revision, requestKey, compId: String(comp(saved.document)), commandsJson: stringifyNative(commands) } }); }

test('1000 real private revision bodies keep native rows small and application history, undo, edits, replay and exports usable', async () => {
  let saved = await project('/projects', { method: 'POST', body: fresh('Full history source') });
  const id = saved.id, first = saved.document;
  try {
    // Produce the large canonical model through actual commands and the pinned engine.
    let bytes = Buffer.from(stringifyNative(saved.document)), caption = 0;
    while (bytes.length < 160000) {
      assert.ok(caption < 32, 'bounded real-model fixture construction');
      saved = await operation(saved, [{ command: 'layer.newText', params: {
        name: 'Original caption ' + caption++, text: 'A real Unicode caption 😀\n'.repeat(500), size: 36, position: [100, 80] } }]);
      bytes = Buffer.from(stringifyNative(saved.document));
    }
    assert.ok(bytes.length < 250000, 'canonical document bytes: ' + bytes.length);
    // Controlled cardinality seeding: genuine original-person native SQL, real
    // unique private files and actual validated model. This is not repeated UI/agent writes.
    const p = fixture.principal('alice');
    const seedCtx = { authorization: { currentActor: () => ({ issuer: p.issuer, sub: p.subject, isActive: true }), authorize: async () => ({ allowed: true }) },
      intent: async name => { assert.equal(name, 'auth.caller'); return { principal: p }; } };
    const blobs = new MotionOwnedBlobs(seedCtx, fixture.dataDir, { purpose: 'revision' });
    const values = [], receipts = [];
    for (let version = saved.revision + 1; version <= 998; version++) {
      const receipt = await blobs.put(bytes, 'create'); receipts.push(receipt);
      values.push(id, p.issuer, p.subject, version, 'Seeded immutable history', receipt.ref.id, receipt.ref.bytes, receipt.ref.sha256);
      if (version % 100 === 0) process.stdout.write('Prepared ' + version + '/998 genuine private history files\n');
    }
    // Seed in bounded metadata batches. Fixture preparation is separate from
    // the production application's own single-revision writes tested below.
    for (const receipt of receipts) receipt.commit(); // Autocommit outcome may be uncertain; retain bytes until fixture cleanup.
    for (let start = 0; start < values.length; start += 800) {
      const batch = values.slice(start, start + 800), rows = [];
      for (let offset = 0; offset < batch.length; offset += 8) rows.push('(' + Array.from({ length: 8 }, (_, n) => '$' + (offset + n + 1)).join(',') + ')');
      await sql('INSERT INTO motion_revisions (project_id,owner_issuer,owner_sub,revision,title,document_blob,document_bytes,document_sha256) VALUES ' + rows.join(','), batch);
      process.stdout.write('Seeded native metadata batch ' + (start / 800 + 1) + '/10\n');
    }
    process.stdout.write('Checking actual application at 998 revisions\n');
    await sql('UPDATE motion_projects SET current_revision=$2 WHERE project_id=$1', [id, 998]);
    await fixture.restart('alice');
    saved = await project('/projects/' + id); assert.equal(saved.revision, 998);
    assert.deepEqual(saved.document, JSON.parse(bytes));
    const rows = (await sql('SELECT revision,document,document_blob,document_bytes FROM motion_revisions WHERE project_id=$1', [id])).rows;
    assert.equal(rows.length, 998); assert.ok(rows.every(row => row.document === null && row.document_blob));
    assert.ok(rows.reduce((sum, row) => sum + row.document_bytes, 0) > 120 * 1024 * 1024);
    assert.ok(Buffer.byteLength(JSON.stringify(rows)) < 200000);
    assert.equal((await call('/projects/' + id + '/revisions')).body.revisions.length, 998);
    assert.deepEqual((await project('/projects/' + id + '/revisions/1')).document, first);
    const exported = await call('/projects/' + id + '/revisions/998/export');
    assert.equal(createHash('sha256').update(exported.body).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
    // Real admitted writes at full history scale, rather than seeding the final states.
    saved = await project('/projects/' + id + '/restore', { method: 'POST', body: { revision: 1, baseRevision: 998, requestKey: randomUUID() } });
    assert.equal(saved.revision, 999); assert.deepEqual(saved.document, first);
    const prior = saved, commands = [{ command: 'layer.newSolid', params: { name: 'Final blue layer', color: '#0000ff', width: 60, height: 40 } }], key = randomUUID();
    saved = await operation(saved, commands, key); assert.equal(saved.revision, 1000);
    assert.deepEqual(await operation(prior, commands, key), saved);
    const refused = await call('/projects/' + id + '/operations', { method: 'POST', body: { baseRevision: 1000, requestKey: randomUUID(), compId: String(comp(saved.document)), commandsJson: stringifyNative(commands) } }, 409);
    assert.equal(refused.body.error, 'motion_revision_limit');
    const preview = await call('/projects/' + id + '/revisions/1000/preview/0/' + comp(saved.document) + '/320/1');
    const { data, info } = await fixture.sharp(Buffer.from(preview.body.png, 'base64')).raw().toBuffer({ resolveWithObject: true });
    assert.equal(data[(90 * info.width + 160) * info.channels + 2], 255); assert.equal(data[(90 * info.width + 160) * info.channels + 3], 255);
    assert.equal((await call('/projects/' + id + '/revisions')).body.revisions.length, 1000);
    await call('/projects/' + id, { actor: 'bob' }, 404);
    await call('/projects/' + id + '/revisions/998/export', { actor: 'bob' }, 404);
    fixture.assign('alice', 'reader'); await call('/projects/' + id + '/revisions/998');
    await call('/projects/' + id + '/revisions/998/export', {}, 403);
  } finally { fixture.assign('alice', 'administrator'); await call('/projects/' + id, { method: 'DELETE' }); }
  assert.deepEqual(await files(), [], 'all 1000 files are removed only after metadata deletion commits');
});
test('native revision insert withdrawal rolls back its new file, and uncertain committed replies retain it', async () => {
  let saved = await project('/projects', { method: 'POST', body: fresh('Revision transaction proof') });
  const before = await files(), commands = [{ command: 'layer.newSolid', params: { name: 'Held layer', color: '#ff0000', width: 20, height: 10 } }];
  try {
    fixture.onSql((actor, args) => { if (actor === 'alice' && /^INSERT INTO motion_revisions/.test(args.text)) fixture.deny('alice', 'project.change'); });
    await call('/projects/' + saved.id + '/operations', { method: 'POST', body: { baseRevision: 1, requestKey: randomUUID(), commandsJson: stringifyNative(commands), compId: String(comp(saved.document)) } }, 403);
    fixture.onSql(null); fixture.assign('alice', 'administrator');
    assert.deepEqual(await files(), before); assert.equal((await project('/projects/' + saved.id)).revision, 1);
    let tripped = false;
    // An operation first reads its source in a read-only transaction. Arm only after a fresh insert.
    let inserted = false; fixture.onSql((actor, args) => {
      if (actor !== 'alice') return;
      if (/^INSERT INTO motion_revisions/.test(args.text)) inserted = true;
      if (inserted && args.transaction === 'commit' && !tripped) { tripped = true; throw new Error('fixture_commit_reply_lost'); }
    });
    await call('/projects/' + saved.id + '/operations', { method: 'POST', body: { baseRevision: 1, requestKey: randomUUID(), commandsJson: stringifyNative(commands), compId: String(comp(saved.document)) } }, 503);
    fixture.onSql(null); assert.equal(tripped, true);
    saved = await project('/projects/' + saved.id); assert.equal(saved.revision, 2); assert.equal((await files()).length, 2);
  } finally { fixture.onSql(null); fixture.assign('alice', 'administrator'); await call('/projects/' + saved.id, { method: 'DELETE' }); }
});
test('corrupted or unavailable revision files refuse reads without hiding metadata history or losing older undo data', async () => {
  let saved = await project('/projects', { method: 'POST', body: fresh('Recoverable history') });
  const first = saved.document;
  try {
    saved = await operation(saved, [{ command: 'layer.newSolid', params: { name: 'Second', color: '#ff0000', width: 10, height: 10 } }]);
    const row = (await sql('SELECT document_blob FROM motion_revisions WHERE project_id=$1 AND revision=$2', [saved.id, 2])).rows[0];
    const path = (await files()).find(file => file.endsWith(row.document_blob + '.blob')), bytes = await readFile(path);
    await writeFile(path, Buffer.alloc(bytes.length)); await call('/projects/' + saved.id, {}, 503);
    assert.equal((await call('/projects/' + saved.id + '/revisions')).body.revisions.length, 2);
    assert.deepEqual((await project('/projects/' + saved.id + '/revisions/1')).document, first);
    await writeFile(path, bytes); await fixture.restart('alice', { lasting: false });
    assert.equal((await call('/projects/' + saved.id, {}, 503)).body.error, 'motion_revision_storage_unavailable');
    await call('/projects', { method: 'POST', body: fresh('No inline fallback') }, 503);
    await fixture.restart('alice'); assert.equal((await project('/projects/' + saved.id)).revision, 2);
  } finally { await call('/projects/' + saved.id, { method: 'DELETE' }); }
});
