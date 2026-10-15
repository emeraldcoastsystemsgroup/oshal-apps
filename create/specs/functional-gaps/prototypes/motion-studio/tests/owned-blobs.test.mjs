/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise real private byte files, exact integrity, original-principal isolation and mid-operation revocation.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Prove photo and revision purpose namespaces remain separate under the same original authority.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Refuse overlapping or replaced lock inodes, revoked recovery and foreign-principal lease reuse.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, writeFile, symlink, link, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MotionOwnedBlobs, BLOB_LIMIT } from '../routes/owned-blobs.mjs';
async function fixture(work) {
  const root = await mkdtemp(join(tmpdir(), 'motion-owned-blobs-'));
  const state = { principal: { id: 'person-one', tenant: 'tenant-one', issuer: 'issuer-one', subject: 'alice', state: 'active' }, denied: new Set(), calls: 0, hook: null };
  const ctx = { authorization: { currentActor: () => ({ issuer: 'issuer-one', sub: 'alice', isActive: true }),
    authorize: async ({ permission }) => ({ allowed: !state.denied.has(permission) }) },
    intent: async name => { assert.equal(name, 'auth.caller'); state.calls++; await state.hook?.(); return { principal: { ...state.principal } }; } };
  const blobs = new MotionOwnedBlobs(ctx, root);
  try { await work({ root, state, ctx, blobs }); } finally { await rm(root, { recursive: true, force: true }); }
}
async function files(root) { const names = await readdir(root); return names.length ? readdir(join(root, names[0])) : []; }
async function file(root, ref) { return join(root, (await readdir(root))[0], ref.id + '.blob'); }
test('64 MiB exact bytes survive a new adapter and committed rollback never deletes them', async () => fixture(async ({ blobs, ctx, root }) => {
  const bytes = Buffer.alloc(BLOB_LIMIT, 173), receipt = await blobs.put(bytes); receipt.commit();
  await receipt.rollback();
  assert.deepEqual(await new MotionOwnedBlobs(ctx, root).read(receipt.ref), bytes);
  await blobs.remove(receipt.ref); assert.deepEqual(await files(root), []);
  await assert.rejects(blobs.put(Buffer.alloc(BLOB_LIMIT + 1)), error => error.code === 'motion_blob_limit');
}));
test('fresh original tenant and principal namespaces isolate equal subjects; selectors and path traversal refused', async () => fixture(async ({ blobs, ctx, state, root }) => {
  const receipt = await blobs.put(Buffer.from('private')); receipt.commit();
  for (const key of ['tenant','id']) {
    const old = state.principal[key]; state.principal[key] = old + '-other';
    await assert.rejects(new MotionOwnedBlobs(ctx, root).read(receipt.ref));
    await assert.rejects(blobs.read(receipt.ref), error => error.code === 'motion_identity_changed'); state.principal[key] = old;
  }
  await assert.rejects(blobs.read({ ...receipt.ref, tenant: 'tenant-one' }), error => error.code === 'motion_blob_invalid_reference');
  await assert.rejects(blobs.read({ ...receipt.ref, id: '../secret' }), error => error.code === 'motion_blob_invalid_reference');
  state.principal.issuer = 'other';
  await assert.rejects(blobs.read(receipt.ref), error => error.code === 'motion_blob_verified_principal_required');
}));
test('grants and original source are checked during chunks; a revoked write removes only its unique inode', async () => fixture(async ({ blobs, state, root }) => {
  const saved = await blobs.put(Buffer.from('committed')); saved.commit(); state.calls = 0;
  state.hook = () => { if (state.calls === 3) { state.denied.add('project.create'); state.denied.add('project.change'); } };
  await assert.rejects(blobs.put(Buffer.alloc(1024 * 1024)), error => error.code === 'motion_permission_denied');
  assert.deepEqual(await files(root), [saved.ref.id + '.blob']);
  state.hook = null; state.denied.clear();
  const larger = await blobs.put(Buffer.alloc(1024 * 1024, 3)); larger.commit(); state.calls = 0;
  state.hook = () => { if (state.calls === 3) state.denied.add('project.read'); };
  await assert.rejects(blobs.read(larger.ref), error => error.code === 'motion_permission_denied');
  state.denied.clear(); state.calls = 0; state.hook = () => { if (state.calls === 3) throw new Error('host_source_changed'); };
  await assert.rejects(blobs.read(larger.ref), /host_source_changed/);
}));
test('corruption, truncation, links and public permissions fail closed without deleting a target', async () => fixture(async ({ blobs, root }) => {
  const receipt = await blobs.put(Buffer.from('private bytes')); receipt.commit(); const path = await file(root, receipt.ref);
  await writeFile(path, 'corrupt bytes'); await assert.rejects(blobs.read(receipt.ref), error => error.code === 'motion_blob_integrity_error');
  await writeFile(path, 'short'); await assert.rejects(blobs.read(receipt.ref), error => error.code === 'motion_blob_integrity_error');
  await rm(path); const target = join(root, 'target'); await writeFile(target, 'private bytes'); await symlink(target, path);
  await assert.rejects(blobs.read(receipt.ref)); await assert.rejects(blobs.remove(receipt.ref));
  await rm(path); await link(target, path); await assert.rejects(blobs.read(receipt.ref)); await assert.rejects(blobs.remove(receipt.ref));
  await rm(path); await writeFile(path, 'private bytes', { mode: 0o600 }); await chmod(path, 0o644);
  await assert.rejects(blobs.read(receipt.ref), error => error.code === 'motion_blob_integrity_error');
}));
test('symlink namespaces and roots are refused; failed publication can be rolled back repeatedly', async () => fixture(async ({ blobs, root, ctx }) => {
  const receipt = await blobs.put(Buffer.from('not published')); await receipt.rollback(); await receipt.rollback();
  assert.deepEqual(await files(root), []);
  const namespace = join(root, (await readdir(root))[0]); await rm(namespace, { recursive: true });
  const target = join(root, 'elsewhere'); await import('node:fs/promises').then(fs => fs.mkdir(target, { mode: 0o700 }));
  await symlink(target, namespace); await assert.rejects(blobs.put(Buffer.from('no')));
  const alias = root + '-alias'; await symlink(root, alias);
  try { await assert.rejects(new MotionOwnedBlobs(ctx, alias).put(Buffer.from('no'))); } finally { await rm(alias); }
}));

test('byte publication snapshots the caller buffer before asynchronous authority checks', async () => fixture(async ({ blobs, state }) => {
  const bytes = Buffer.alloc(1024 * 1024, 5), expected = Buffer.from(bytes);
  state.hook = () => bytes.fill(0);
  const receipt = await blobs.put(bytes); receipt.commit(); state.hook = null;
  assert.deepEqual(await blobs.read(receipt.ref), expected);
}));

test('revision files have a separate trusted namespace from existing photo files', async () => fixture(async ({ blobs, ctx, root }) => {
  const revision = new MotionOwnedBlobs(ctx, root, { purpose: 'revision' });
  const photo = await blobs.put(Buffer.from('photo')); photo.commit();
  const doc = await revision.put(Buffer.from('document'), 'create'); doc.commit();
  assert.equal((await readdir(root)).length, 2);
  await assert.rejects(blobs.read(doc.ref)); await assert.rejects(revision.read(photo.ref));
  assert.equal((await revision.read(doc.ref)).toString(), 'document');
  await revision.remove(doc.ref); assert.equal((await blobs.read(photo.ref)).toString(), 'photo');
}));

test('live owner lease excludes overlap and reconciliation preserves every committed handle', async () => fixture(async ({ blobs, ctx, root }) => {
  const saved = await blobs.put(Buffer.from('committed')); saved.commit();
  const orphan = await blobs.put(Buffer.from('orphan')); orphan.commit();
  const lease = await blobs.lease('create');
  try {
    await assert.rejects(new MotionOwnedBlobs(ctx, root).lease('read'), error => error.code === 'motion_storage_busy');
    await assert.rejects(blobs.reconcile(new Set([saved.ref.id]), 'create', {}), error => error.code === 'motion_blob_lease_required');
    assert.equal((await blobs.reconcile(new Set([saved.ref.id]), 'create', lease)).removed, 1);
    assert.equal((await blobs.read(saved.ref)).toString(), 'committed');
    await assert.rejects(blobs.read(orphan.ref));
  } finally { lease.close(); }
  await assert.rejects(blobs.reconcile(new Set(), 'create', lease), error => error.code === 'motion_blob_lease_required');
  const next = await new MotionOwnedBlobs(ctx, root).lease('read'); next.close();
}));
test('reconciliation stops on revoked grants and cannot reuse a lease for another original principal', async () => fixture(async ({ blobs, ctx, state, root }) => {
  const receipt = await blobs.put(Buffer.from('unreachable')); receipt.commit(); const lease = await blobs.lease('create');
  try {
    state.denied.add('project.create');
    await assert.rejects(blobs.reconcile(new Set(), 'create', lease), error => error.code === 'motion_permission_denied');
    state.denied.clear(); state.principal.id = 'different';
    const other = new MotionOwnedBlobs(ctx, root);
    await assert.rejects(other.reconcile(new Set(), 'create', lease), error => error.code === 'motion_blob_lease_required');
    state.principal.id = 'person-one';
    assert.equal((await blobs.read(receipt.ref)).toString(), 'unreachable');
    state.hook = () => { throw new Error('original_source_withdrawn'); };
    await assert.rejects(blobs.reconcile(new Set(), 'create', lease), /original_source_withdrawn/);
  } finally { state.hook = null; lease.close(); }
}));
test('lock symlinks and hard links fail closed and never remove their targets', async () => fixture(async ({ blobs, root }) => {
  const receipt = await blobs.put(Buffer.from('private')); receipt.commit();
  const namespace = join(root, (await readdir(root))[0]), path = join(namespace, '.motion-lock.sqlite'), target = join(root, 'target');
  await writeFile(target, '', { mode: 0o600 }); await symlink(target, path);
  await assert.rejects(blobs.lease('create'));
  await rm(path); await link(target, path); await assert.rejects(blobs.lease('create'));
  assert.equal((await blobs.read(receipt.ref)).toString(), 'private');
}));

test('replacing a still-locked inode refuses recovery and preserves its orphan', async () => fixture(async ({ blobs, root }) => {
  const receipt = await blobs.put(Buffer.from('not published')); receipt.commit(); const lease = await blobs.lease('create');
  try {
    const path = join(root, (await readdir(root))[0], '.motion-lock.sqlite');
    // Rename aside keeps the old inode allocated while replacing its pathname.
    const fs = await import('node:fs/promises'); await fs.rename(path, path + '-old'); await writeFile(path, '', { mode: 0o600 });
    await assert.rejects(lease.check(), error => error.code === 'motion_blob_lock_changed');
    await assert.rejects(blobs.reconcile(new Set(), 'create', lease), error => error.code === 'motion_blob_lock_changed');
    assert.equal((await blobs.read(receipt.ref)).toString(), 'not published');
  } finally { lease.close(); }
}));

test('shared readers coexist while excluding publication and cannot perform reconciliation', async () => fixture(async ({ blobs, ctx, root }) => {
  const first = await blobs.lease('read'), second = await new MotionOwnedBlobs(ctx, root).lease('export');
  try {
    await assert.rejects(blobs.lease('create'), error => error.code === 'motion_storage_busy');
    await assert.rejects(blobs.reconcile(new Set(), 'read', first), error => error.code === 'motion_permission_denied');
    await assert.rejects(blobs.reconcile(new Set(), 'create', first), error => error.code === 'motion_blob_lease_required');
  } finally { first.close(); second.close(); }
  const next = await blobs.lease('create'); next.close();
}));
