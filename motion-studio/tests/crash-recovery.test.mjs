/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Kill exact owned native package children at file/SQL boundaries and prove original-owner reconciliation preserves committed data.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { MotionOwnedBlobs } from '../routes/owned-blobs.mjs';
import { startNativeSqlFixture } from './native-sql-fixture.mjs';
let fixture, input;
before(async () => {
  fixture = await startNativeSqlFixture();
  const bytes = await fixture.sharp(randomBytes(1100 * 1000 * 3), { raw: { width: 1100, height: 1000, channels: 3 } }).png().toBuffer();
  const form = new FormData(); form.append('file', new Blob([bytes], { type: 'image/png' }), 'owned.png');
  const req = new Request('http://fixture.invalid/', { method: 'POST', body: form });
  input = { method: 'POST', body: Buffer.from(await req.arrayBuffer()).toString('base64'), bodyEncoding: 'base64', headers: { 'content-type': req.headers.get('content-type') } };
});
after(async () => { await fixture?.close(); });
async function call(path, options = {}, status = 200) { const reply = await fixture.call(path, options); assert.equal(reply.status, status, JSON.stringify({ body: reply.body, errors: reply.status === status ? [] : fixture.calls.filter(frame => frame.fn === 'log' && JSON.stringify(frame.args).includes('error')).slice(-3).map(frame => frame.args) })); return reply.body; }
async function files() { const result = []; for (const dir of await readdir(fixture.dataDir)) for (const file of await readdir(join(fixture.dataDir, dir))) if (file.endsWith('.blob')) result.push(join(fixture.dataDir, dir, file)); return result.sort(); }
const create = title => call('/projects', { method: 'POST', body: { title, width: 320, height: 180, duration: 5, frameRate: 30, requestKey: randomUUID() } });
async function abortedConnection() {
  const frame = fixture.calls.findLast(frame => frame.actor === 'alice' && frame.fn === 'sql_query' && frame.args.transaction === 'begin');
  assert.ok(frame?.args.connection);
  // The fixture Rust host is intentionally independent of the killed Node
  // package process. Roll back only its exact aborted connection to model
  // production host-drop cleanup; this is not an installed-drop acceptance claim.
  await fixture.rpc('alice', 'sql', { connection: frame.args.connection, transaction: 'rollback' });
}
function resetHooks() { fixture.beforeSql(null); fixture.onSql(null); fixture.beforeIntent(null); }

test('a partial photo write killed mid-chunk is recovered without touching committed photos', async () => {
  const saved = (await call('/assets', input)).asset, original = await files(); let crashed = false;
  fixture.beforeIntent(async (actor, name) => {
    if (actor !== 'alice' || name !== 'auth.caller' || crashed) return;
    const added = (await files()).filter(file => !original.includes(file));
    if (added.length && (await stat(added[0])).size > 0) {
      assert.ok((await stat(added[0])).size < saved.bytes); crashed = true; await fixture.crash('alice');
    }
  });
  try {
    await assert.rejects(fixture.call('/assets', input), /Fixture exited/); assert.equal(crashed, true);
    resetHooks(); await abortedConnection(); assert.equal((await files()).length, 2);
    await fixture.restart('alice');
    assert.deepEqual((await call('/assets')).assets.map(asset => asset.id), [saved.id]);
    const next = (await call('/assets', input)).asset;
    assert.equal((await files()).length, 2, 'next admitted write removes partial orphan and publishes only its own new photo');
    await call('/assets/' + saved.id); await call('/assets/' + next.id);
    await call('/assets/' + next.id, { method: 'DELETE' });
  } finally { resetHooks(); await call('/assets/' + saved.id, { method: 'DELETE' }); }
});
test('a fsynced revision killed before metadata insertion is reclaimed on the next admitted write', async () => {
  const saved = (await create('Committed original')).project, original = await files(); let crashed = false;
  fixture.beforeSql(async (actor, args) => {
    if (actor === 'alice' && /^INSERT INTO motion_revisions/.test(args.text) && !crashed) { crashed = true; await fixture.crash('alice'); }
  });
  try {
    await assert.rejects(fixture.call('/projects', { method: 'POST', body: { title: 'Never published', width: 320, height: 180, duration: 5, frameRate: 30, requestKey: randomUUID() } }), /Fixture exited/);
    resetHooks(); await abortedConnection(); assert.equal((await files()).length, original.length + 1);
    await fixture.restart('alice'); const next = (await create('Recovery trigger')).project;
    assert.equal((await files()).length, original.length + 1);
    assert.equal((await call('/projects')).projects.length, 2);
    assert.equal((await call('/projects/' + saved.id)).project.id, saved.id);
    await call('/projects/' + next.id, { method: 'DELETE' });
  } finally { resetHooks(); await call('/projects/' + saved.id, { method: 'DELETE' }); }
});
test('SIGKILL after actual metadata commit but before its reply keeps the committed photo readable', async () => {
  let inserted = false, crashed = false;
  fixture.onSql(async (actor, args) => {
    if (actor !== 'alice') return;
    if (/^INSERT INTO motion_assets/.test(args.text)) inserted = true;
    if (inserted && args.transaction === 'commit' && !crashed) { crashed = true; await fixture.crash('alice'); }
  });
  await assert.rejects(fixture.call('/assets', input), /Fixture exited/); resetHooks(); assert.equal(crashed, true);
  await fixture.restart('alice'); const assets = (await call('/assets')).assets; assert.equal(assets.length, 1);
  try {
    const next = (await create('Preserve uncertain commit')).project;
    await call('/assets/' + assets[0].id); assert.equal((await files()).length, 2);
    await call('/projects/' + next.id, { method: 'DELETE' });
  } finally { await call('/assets/' + assets[0].id, { method: 'DELETE' }); }
});
test('SIGKILL after committed history deletion leaves only reclaimable files, not ghost projects', async () => {
  const saved = (await create('Deleted before cleanup')).project; let deleted = false, crashed = false;
  fixture.onSql(async (actor, args) => {
    if (actor !== 'alice') return;
    if (/^DELETE FROM motion_projects/.test(args.text)) deleted = true;
    if (deleted && args.transaction === 'commit' && !crashed) { crashed = true; await fixture.crash('alice'); }
  });
  await assert.rejects(fixture.call('/projects/' + saved.id, { method: 'DELETE' }), /Fixture exited/); resetHooks(); assert.equal(crashed, true);
  assert.equal((await files()).length, 1);
  await fixture.restart('alice'); await call('/projects/' + saved.id, {}, 404);
  const next = (await create('Reconcile deleted history')).project;
  assert.equal((await files()).length, 1); await call('/projects/' + next.id, { method: 'DELETE' }); assert.deepEqual(await files(), []);
});
test('a still-held lease refuses overlapping application reads and writes, then both recover after release', async () => {
  const p = fixture.principal('alice'), ctx = { authorization: { currentActor: () => ({ issuer: p.issuer, sub: p.subject, isActive: true }), authorize: async () => ({ allowed: true }) }, intent: async () => ({ principal: p }) };
  const lease = await new MotionOwnedBlobs(ctx, fixture.dataDir).lease('create');
  try {
    const read = await call('/projects', {}, 503); assert.equal(read.error, 'motion_storage_busy'); assert.equal(read.retryAfterMs, 100);
    await call('/assets', input, 503);
    assert.deepEqual((await call('/projects', { actor: 'bob' })).projects, [], 'another original principal has its own lock');
  } finally { lease.close(); }
  const saved = (await create('Released lock')).project; await call('/projects/' + saved.id); await call('/projects/' + saved.id, { method: 'DELETE' });
});

test('simultaneous native asset and project reads coexist under shared leases', async () => {
  const saved = (await call('/assets', input)).asset, p = fixture.principal('alice');
  const ctx = { authorization: { currentActor: () => ({ issuer: p.issuer, sub: p.subject, isActive: true }), authorize: async () => ({ allowed: true }) }, intent: async () => ({ principal: p }) };
  const lease = await new MotionOwnedBlobs(ctx, fixture.dataDir).lease('read');
  try { await Promise.all(Array.from({ length: 8 }, (_, n) => call(n % 2 ? '/assets/' + saved.id : '/projects'))); }
  finally { lease.close(); await call('/assets/' + saved.id, { method: 'DELETE' }); }
});

test('a delayed old COMMIT after process death cannot publish bytes reclaimed by a newer recovery', async () => {
  let inserted = false, connection, ready, release;
  const stopped = new Promise(done => { ready = done; }), gate = new Promise(done => { release = done; });
  fixture.onSql((actor, args) => { if (actor === 'alice' && /^INSERT INTO motion_assets/.test(args.text)) inserted = true; });
  fixture.beforeSql(async (actor, args) => {
    if (actor === 'alice' && inserted && args.transaction === 'commit') {
      connection = args.connection; ready(); await gate;
      throw new Error('fixture_old_reply_route_stopped');
    }
  });
  const pending = fixture.call('/assets', input).then(() => ({ unexpected: true }), error => ({ error }));
  await stopped; await fixture.crash('alice'); const died = await pending; assert.match(died.error.message, /Fixture exited/);
  resetHooks(); await fixture.restart('alice');
  let next;
  try {
    assert.equal((await files()).length, 1);
    const body = { title: 'Fenced replacement', width: 320, height: 180, duration: 5, frameRate: 30, requestKey: randomUUID() };
    const attempted = await fixture.call('/projects', { method: 'POST', body });
    let lateAsset;
    if (attempted.status === 503) {
      // The real relational projection holds the original epoch row lock.
      // A blocked newer recovery must leave the old publisher's bytes untouched.
      assert.equal((await files()).length, 1);
      await fixture.rpc('alice', 'sql', { connection, transaction: 'commit' });
      const assets = (await call('/assets')).assets; assert.equal(assets.length, 1); lateAsset = assets[0];
      next = (await call('/projects', { method: 'POST', body })).project;
      await call('/assets/' + lateAsset.id);
      assert.equal((await files()).length, 2, 'settled original commit remains referenced during newer recovery');
    } else {
      assert.equal(attempted.status, 200, JSON.stringify(attempted.body)); next = attempted.body.project;
      assert.equal((await files()).length, 1);
      await assert.rejects(fixture.rpc('alice', 'sql', { connection, transaction: 'commit' }), /revision|changed|conflict/i);
      assert.deepEqual((await call('/assets')).assets, []);
    }
    if (lateAsset) await call('/assets/' + lateAsset.id, { method: 'DELETE' });
    await call('/projects/' + next.id);
  } finally { release(); resetHooks(); if (next) await call('/projects/' + next.id, { method: 'DELETE' }); }
});
test('an uncertain recovery-commit reply reclaims no file until a later confirmed recovery', async () => {
  const p = fixture.principal('alice'), ctx = { authorization: { currentActor: () => ({ issuer: p.issuer, sub: p.subject, isActive: true }), authorize: async () => ({ allowed: true }) }, intent: async () => ({ principal: p }) };
  const orphan = await new MotionOwnedBlobs(ctx, fixture.dataDir).put(Buffer.from('unpublished private bytes'), 'create'); orphan.commit();
  let tripped = false;
  fixture.onSql((actor, args) => { if (actor === 'alice' && args.transaction === 'commit' && !tripped) { tripped = true; throw new Error('fixture_recovery_commit_reply_lost'); } });
  try {
    await call('/projects', { method: 'POST', body: { title: 'Recovery acknowledgement lost', width: 320, height: 180, duration: 5, frameRate: 30, requestKey: randomUUID() } }, 503);
    assert.equal(tripped, true); assert.equal((await files()).length, 1, 'unconfirmed recovery never unlinks');
    resetHooks(); const saved = (await create('Confirmed recovery')).project;
    assert.equal((await files()).length, 1, 'confirmed recovery removes orphan and keeps its own new revision');
    assert.ok(!(await files()).some(file => file.endsWith(orphan.ref.id + '.blob')));
    await call('/projects/' + saved.id, { method: 'DELETE' });
  } finally { resetHooks(); }
});
