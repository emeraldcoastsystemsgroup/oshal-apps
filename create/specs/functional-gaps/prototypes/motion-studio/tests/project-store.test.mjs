/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove immutable motion persistence, decoded raster bytes and current-actor isolation on shared disposable PostgreSQL.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Reopen and render real masked owned footage while retaining its source bytes through immutable SQL history.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { MotionProjectStore, MotionError, LIMITS } from '../routes/project-store.mjs';
const repository = resolve(import.meta.dirname, '../../../../../..');
const requireToolchain = createRequire(resolve(process.env.STORE_CI_TOOLCHAIN || resolve(repository, 'scripts/toolchain'), 'package.json'));
const { Pool } = requireToolchain('pg');
const requireRaster = createRequire(resolve(process.env.MOTION_RASTER_DEPS || '/tmp/oshal-create-proof-ZFGNIA', 'package.json'));
const sharp = requireRaster('sharp');
const worker = process.env.MOTION_ENGINE_BINARY;
if (!worker) throw new Error('Set MOTION_ENGINE_BINARY to the reviewed local motion worker.');
const raw = process.env.OSHAL_TEST_POSTGRES || (process.env.MOTION_TEST_DSN_FILE ? (await readFile(process.env.MOTION_TEST_DSN_FILE, 'utf8')).trim() : '');
let dsn;
try { dsn = new URL(raw); } catch { throw new Error('Provide an explicit disposable PG URL with OSHAL_TEST_POSTGRES or MOTION_TEST_DSN_FILE.'); }
if (!['postgres:', 'postgresql:'].includes(dsn.protocol) || dsn.hostname !== '127.0.0.1' || dsn.port !== '35689') throw new Error('Motion tests require shared disposable PG127.0.0.1:35689 only.');
const suffix = randomUUID().replaceAll('-', '');
const schema = 'motion_test_' + suffix, role = 'motion_role_' + suffix;
let admin, pool, native, image;

/** The actual pinned compositor, with a hard process deadline and output byte ceiling. */
async function engine(input) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(worker, [], { stdio: ['pipe', 'pipe', 'pipe'] }); let output = '', error = '', settled = false;
    const fail = value => { if (!settled) { settled = true; clearTimeout(timer); child.kill(); reject(value); } };
    const timer = setTimeout(() => fail(new Error('motion worker fixture timeout')), 10000);
    child.on('error', fail); child.stdin.on('error', fail);
    child.stdout.on('data', part => { output += part; if (Buffer.byteLength(output) > 16 * 1024 * 1024) fail(new Error('motion fixture output limit')); });
    child.stderr.on('data', part => { if (error.length < 1024) error += part; });
    child.on('close', code => {
      if (settled) return; settled = true; clearTimeout(timer);
      try { const value = JSON.parse(output); if (code !== 0 || !value.ok) throw new MotionError(400, 'motion_document_refused'); resolveResult(value.result); }
      catch (failure) { reject(failure); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
const validators = {
  validateDocument: async document => (await engine({ op: 'inspect', document })).document,
  decodeRaster: async bytes => {
    try {
      const { data, info } = await sharp(bytes, { limitInputPixels: LIMITS.pixels, failOn: 'error' }).rotate().png().toBuffer({ resolveWithObject: true });
      return { bytes: data, type: 'image/png', width: info.width, height: info.height };
    } catch { throw new MotionError(400, 'motion_raster_refused'); }
  },
};
function context(sub, issuer = 'motion-fixture') {
  const state = { actor: { issuer, sub, isActive: true }, denied: new Set(), queryHook: null, validatorHook: null, authorizeHook: null, connects: 0 };
  const ctx = { authorization: { currentActor: () => state.actor, authorize: async ({ permission }) => { await state.authorizeHook?.(permission); return { allowed: !state.denied.has(permission) }; } },
    pool: { connect: async () => {
      state.connects++; const client = await pool.connect();
      return { query: async (...args) => { const result = await client.query(...args); await state.queryHook?.(...args); return result; }, release: discard => client.release(discard) };
    } } };
  let store;
  store = new MotionProjectStore(ctx, { ...validators, validateDocument: async document => {
    await state.validatorHook?.();
    const assets = await storedAssets(document, store);
    return (await engine({ op: 'inspect', document, assets })).document;
  } });
  return { state, store };
}
async function storedAssets(document, store) {
  const ids = new Set();
  for (const item of Object.values(document.items ?? {})) {
    if (item?.kind?.type !== 'Footage') continue;
    const match = /^oshal-asset:([^@]+)@[0-9a-f]{64}$/.exec(item.kind.path);
    if (!match) throw new MotionError(400, 'motion_document_refused');
    ids.add(match[1]);
  }
  const result = [];
  for (const id of ids) {
    const asset = await store.asset(id);
    result.push({ id, sha256: asset.sha256, data: asset.bytes.toString('base64') });
  }
  return result;
}
function input(title = 'Animated logo', document = native) { return { title, document: structuredClone(document), assets: [], requestKey: randomUUID() }; }
const refused = (promise, code) => assert.rejects(promise, failure => failure.code === code);
async function scoped(actor, work) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); await client.query("SELECT set_config('motion.owner_issuer',$1,true),set_config('motion.owner_sub',$2,true)", [actor.issuer, actor.sub]); return await work(client); }
  finally { await client.query('ROLLBACK'); client.release(); }
}

before(async () => {
  admin = new Pool({ connectionString: dsn.href, max: 2 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const password = randomUUID();
  await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  const migration = await readFile(new URL('../migrations/001-motion-projects.sql', import.meta.url), 'utf8');
  const client = await admin.connect();
  try { await client.query(`SET search_path TO ${schema}`); await client.query(migration); }
  finally { client.release(); }
  await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
  await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
  const userDsn = new URL(dsn); userDsn.username = role; userDsn.password = password;
  pool = new Pool({ connectionString: userDsn.href, options: `-c search_path=${schema}`, max: 8 });
  const created = await engine({ op: 'create' });
  const manifest = await readFile(new URL('../engine/Cargo.toml', import.meta.url), 'utf8');
  assert.equal(created.upstream, manifest.match(/rev = "([a-f0-9]{40})"/)[1], 'fixture binary must match the pinned compositor');
  native = created.document;
  image = await sharp({ create: { width: 16, height: 8, channels: 4, background: { r: 200, g: 30, b: 20, alpha: 0.5 } } }).png().toBuffer();
});
after(async () => {
  await pool?.end();
  if (admin) { try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.query(`DROP ROLE IF EXISTS ${role}`); } finally { await admin.end(); } }
});

test('saves, reopens, and exports the genuine native animation with immutable undo history', async () => {
  const { store } = context('native-reopen');
  const document = (await engine({ op: 'edit', document: native, commands: [
    { command: 'comp.new', params: { name: 'Main', width: 320, height: 180, duration: 5, frameRate: 30 } },
    { command: 'layer.newSolid', params: { name: 'Logo', color: '#ff0000', width: 100, height: 60 } },
    { command: 'prop.addKey', params: { layer: '#1', path: 'transform/opacity', time: 0, value: 0 } },
    { command: 'prop.addKey', params: { layer: '#1', path: 'transform/opacity', time: 5, value: 100 } },
  ] })).document;
  const created = await store.create(input('Logo', document));
  const saved = await store.save(created.id, { ...input('Caption edit', document), baseRevision: 1 });
  assert.equal(saved.revision, 2);
  assert.deepEqual((await store.get(created.id)).document, document);
  assert.equal((await store.get(created.id, 1)).title, 'Logo');
  assert.equal((await store.revisions(created.id)).length, 2);
  const exported = await store.export(created.id), frame = await engine({ op: 'preview', document: exported.document, time: 2.5, max_side: 320 });
  const pixels = await sharp(Buffer.from(frame.png, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(pixels.info.width, 320); assert.equal(pixels.data[(90 * 320 + 160) * 4 + 3], 128);
  const restored = await store.save(created.id, { ...input('Undo', (await store.get(created.id, 1)).document), baseRevision: 2 });
  assert.equal(restored.revision, 3); assert.equal((await store.get(created.id, 2)).title, 'Caption edit');
});

test('issuer and subject both isolate private project ids, exports, changes, deletes and bytes', async () => {
  const alice = context('same-sub', 'issuer-A'), bob = context('same-sub', 'issuer-B'), carol = context('other-sub', 'issuer-A');
  const asset = await alice.store.uploadAsset({ bytes: image });
  const created = await alice.store.create({ ...input('Private'), assets: [asset.id] });
  for (const caller of [bob, carol]) {
    assert.deepEqual(await caller.store.list(), []);
    await refused(caller.store.get(created.id), 'motion_project_not_found');
    await refused(caller.store.export(created.id), 'motion_project_not_found');
    await refused(caller.store.save(created.id, { ...input('Stolen'), baseRevision: 1 }), 'motion_project_not_found');
    await refused(caller.store.delete(created.id), 'motion_project_not_found');
    await refused(caller.store.asset(asset.id), 'motion_asset_not_found');
    await refused(caller.store.create({ ...input('Foreign bytes'), assets: [asset.id] }), 'motion_asset_unavailable');
    assert.deepEqual(await caller.store.list(), []);
  }
  assert.equal((await alice.store.get(created.id)).title, 'Private');
  assert.equal((await alice.store.asset(asset.id)).bytes.length, asset.bytes);
});

test('actual decoded pixels and original content digest survive owned raster persistence', async () => {
  const { store } = context('raster');
  const saved = await store.uploadAsset({ bytes: image }), read = await store.asset(saved.id);
  assert.equal(saved.width, 16); assert.equal(saved.height, 8); assert.equal(saved.sha256, read.sha256);
  const decoded = await sharp(read.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.width, 16); assert.equal(decoded.info.height, 8); assert.equal(decoded.data[3], 128);
  await refused(store.uploadAsset({ bytes: Buffer.from('<html>not an image</html>') }), 'motion_raster_refused');
  await refused(store.uploadAsset({ bytes: image, width: 16, type: 'image/png' }), 'motion_invalid_input');
});

test('concurrent retries create one project and a reused key with different data refuses', async () => {
  const { store } = context('retry-create'), request = input();
  const replies = await Promise.all([store.create(request), store.create(request), store.create(request)]);
  assert.equal(new Set(replies.map(value => value.id)).size, 1); assert.equal((await store.list()).length, 1);
  await refused(store.create({ ...request, title: 'Different' }), 'motion_idempotency_conflict');
});

test('concurrent edits admit one base revision; retries return their original snapshot after later writes', async () => {
  const { store } = context('optimistic'), created = await store.create(input());
  const requests = [input('First'), input('Second')].map(value => ({ ...value, baseRevision: 1 }));
  const results = await Promise.allSettled(requests.map(value => store.save(created.id, value)));
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(results.find(value => value.status === 'rejected').reason.code, 'motion_revision_conflict');
  const winner = results.findIndex(value => value.status === 'fulfilled');
  await store.save(created.id, { ...input('Third'), baseRevision: 2 });
  const replay = await store.save(created.id, requests[winner]);
  assert.equal(replay.revision, 2); assert.equal((await store.get(created.id)).revision, 3);
  assert.equal((await store.revisions(created.id)).length, 3);
});

test('permission withdrawal after SQL writes rolls the entire project/revision/request back', async () => {
  const { store, state } = context('withdrawn-write');
  state.queryHook = text => { if (text.startsWith('INSERT INTO motion_requests')) state.denied.add('project.create'); };
  await refused(store.create(input()), 'motion_permission_denied');
  state.queryHook = null; state.denied.clear(); assert.deepEqual(await store.list(), []);
  const counts = await scoped(state.actor, client => client.query('SELECT COUNT(*)::int AS count FROM motion_requests'));
  assert.equal(counts.rows[0].count, 0);
});

test('a read withdrawn after fetching cannot return private documents or image bytes', async () => {
  const { store, state } = context('withdrawn-read'), created = await store.create(input()), asset = await store.uploadAsset({ bytes: image });
  state.queryHook = text => { if (text.includes('FROM motion_revision_assets')) state.denied.add('project.read'); };
  await refused(store.get(created.id), 'motion_permission_denied');
  state.denied.clear(); state.queryHook = text => { if (text.includes('FROM motion_assets')) state.denied.add('project.read'); };
  await refused(store.asset(asset.id), 'motion_permission_denied');
});

test('an actor change during real document validation refuses before pool checkout', async () => {
  const { store, state } = context('original');
  state.validatorHook = () => { state.actor = { ...state.actor, sub: 'replacement' }; };
  await refused(store.create(input()), 'motion_identity_changed'); assert.equal(state.connects, 0);
});

test('export and deletion need their own named grants; caller owner selectors never enter SQL', async () => {
  const { store, state } = context('grants'), created = await store.create(input());
  state.denied.add('project.export'); await refused(store.export(created.id), 'motion_permission_denied');
  state.denied.add('project.delete'); await refused(store.delete(created.id), 'motion_permission_denied');
  const before = state.connects;
  await refused(store.create({ ...input(), owner: 'forged' }), 'motion_invalid_input'); assert.equal(state.connects, before);
  state.denied.clear(); assert.deepEqual(await store.delete(created.id), { deleted: true }); await refused(store.get(created.id), 'motion_project_not_found');
});

test('forced RLS hides all unstamped rows and the DB rejects immutable document/asset updates', async () => {
  const { store, state } = context('rls'), created = await store.create(input()), asset = await store.uploadAsset({ bytes: image });
  assert.deepEqual((await pool.query('SELECT * FROM motion_projects')).rows, []);
  await scoped(state.actor, async client => {
    await assert.rejects(client.query('UPDATE motion_revisions SET title=$1 WHERE project_id=$2', ['Rewrite history', created.id]), /immutable/);
  });
  await scoped(state.actor, async client => {
    await assert.rejects(client.query('UPDATE motion_assets SET width=2 WHERE asset_id=$1', [asset.id]), /immutable/);
  });
  assert.equal((await store.get(created.id)).title, 'Animated logo');
});

test('oversize documents/rasters and invalid identities refuse before pool checkout', async () => {
  const { store, state } = context('bounds');
  await refused(store.create(input('Huge', { padding: 'x'.repeat(LIMITS.documentBytes) })), 'motion_document_limit');
  await refused(store.uploadAsset({ bytes: new Uint8Array(LIMITS.imageBytes + 1) }), 'motion_image_limit');
  state.actor.isActive = false; await refused(store.create(input()), 'motion_verified_identity_required'); assert.equal(state.connects, 0);
});


test('concurrent uploads cannot pass the last owned asset slot together', async () => {
  const { store } = context('asset-quota');
  for (let n = 0; n < LIMITS.assets - 1; n++) await store.uploadAsset({ bytes: image });
  const outcomes = await Promise.allSettled([store.uploadAsset({ bytes: image }), store.uploadAsset({ bytes: image })]);
  assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(value => value.status === 'rejected').reason.code, 'motion_asset_limit');
});

test('rejects model/validator failure before persisting a draft or append', async () => {
  const { store } = context('engine-refusal'), created = await store.create(input());
  await refused(store.save(created.id, { ...input('Corrupt', { items: 'corrupt native project' }), baseRevision: 1 }), 'motion_document_refused');
  assert.equal((await store.get(created.id)).revision, 1); assert.equal((await store.revisions(created.id)).length, 1);
});


test('referenced bytes survive deletion refusal until all referencing project history is deleted', async () => {
  const alice = context('asset-lifecycle'), bob = context('asset-lifecycle-other');
  const asset = await alice.store.uploadAsset({ bytes: image });
  const project = await alice.store.create({ ...input(), assets: [asset.id] });
  assert.equal((await alice.store.listAssets()).length, 1); assert.deepEqual(await bob.store.listAssets(), []);
  await refused(alice.store.deleteAsset(asset.id), 'motion_asset_in_use');
  await refused(bob.store.deleteAsset(asset.id), 'motion_asset_not_found');
  await alice.store.delete(project.id); await alice.store.deleteAsset(asset.id);
  assert.deepEqual(await alice.store.listAssets(), []);
  await refused(alice.store.asset(asset.id), 'motion_asset_not_found');
});


test('an actor change inside asynchronous authorization cannot combine identities and grants', async () => {
  const { store, state } = context('auth-original');
  state.authorizeHook = permission => { if (permission === 'project.create') state.actor = { ...state.actor, issuer: 'replacement-issuer' }; };
  await refused(store.create(input()), 'motion_identity_changed'); assert.equal(state.connects, 0);
});


test('a real masked photo saves/reopens/renders and keeps its source even when body.assets is omitted', async () => {
  const alice = context('owned-photo'), bob = context('foreign-photo');
  const asset = await alice.store.uploadAsset({ bytes: image });
  const transported = await alice.store.asset(asset.id);
  const assets = [{ id: asset.id, sha256: transported.sha256, data: transported.bytes.toString('base64') }];
  const document = (await engine({ op: 'edit', document: native, assets, commands: [
    { command: 'comp.new', params: { name: 'Photo', width: 32, height: 32, duration: 5, frameRate: 30 } },
    { command: 'asset.import', params: { assetId: asset.id, name: 'Photo with editable mask' } },
    { command: 'layer.addMask', params: { layer: '#1', shape: 'rect', rect: [0, 0, 8, 8] } },
  ] })).document;
  const saved = await alice.store.create(input('Masked photo', document));
  assert.deepEqual(saved.assets, [asset.id]);
  await refused(alice.store.deleteAsset(asset.id), 'motion_asset_in_use');
  await refused(bob.store.create(input('Foreign photo', document)), 'motion_asset_not_found');
  const reopened = await alice.store.get(saved.id), original = await engine({ op: 'preview', document, assets, time: 2.5, transparent: true });
  const frame = await engine({ op: 'preview', document: reopened.document, assets: await storedAssets(reopened.document, alice.store), time: 2.5, transparent: true });
  assert.deepEqual(frame, original);
  const png = await sharp(Buffer.from(frame.png, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(png.info.width, 32); assert.equal(png.data[(16 * 32 + 10) * 4 + 3], 128);
  assert.equal(png.data[(16 * 32 + 20) * 4 + 3], 0);
  const latest = await alice.store.save(saved.id, { ...input('Mask adjusted', reopened.document), baseRevision: 1 });
  assert.deepEqual(latest.assets, [asset.id]); assert.deepEqual((await alice.store.get(saved.id, 1)).document, document);
});
