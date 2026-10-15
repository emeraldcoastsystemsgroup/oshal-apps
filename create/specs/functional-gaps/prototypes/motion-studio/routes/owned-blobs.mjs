/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Persist bounded immutable package-owned bytes under original host tenant/principal with fresh grants and integrity checks.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Separate revision authority namespaces and stream directory budgets through full declared history cardinality.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Lease the original owner across processes and reconcile only unreachable private bytes against authoritative source-store references.
 */
import { DatabaseSync } from 'node:sqlite';
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, opendir, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { MotionError } from './project-store.mjs';
import { access } from './authorization.mjs';
export const BLOB_LIMIT = 64 * 1024 * 1024;
const DISK_LIMIT = 320 * 1024 * 1024, PHOTO_FILES = 192, REVISION_FILES = 1000128, CHUNK = 128 * 1024;
const LOCK_FILE = '.motion-lock.sqlite';
const lockStates = new WeakMap();
const uuidFile = name => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.blob$/.test(name);
async function lockFile(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077) || stat.size > 1048576) fail('motion_blob_unsafe_lock');
  return stat;
}
async function checkLock(state) {
  if (state.closed) fail('motion_blob_lease_required');
  const current = await lockFile(state.file);
  if (current.ino !== state.ino || current.dev !== state.dev) fail('motion_blob_lock_changed');
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new MotionError(503, code); };
function descriptor(value) {
  if (!value || Object.keys(value).some(key => !['id','sha256','bytes'].includes(key))
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.id)
      || !/^[0-9a-f]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.bytes)
      || value.bytes < 1 || value.bytes > BLOB_LIMIT) fail('motion_blob_invalid_reference');
  return value;
}
async function directory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || await realpath(path) !== path) fail('motion_blob_unsafe_directory');
}
/** Root is supplied only by the trusted package-process environment. No request owner or path is accepted.
 * The kernel owns the package bind boundary; this consumer checks its original host principal on every chunk.
 * Exclusive UUID files are flushed before metadata publication. Crash orphans are reconciled against original-store references under an exclusive lease.
 */
export class MotionOwnedBlobs {
  #root; #ctx; #original; #purpose; #owner;
  constructor(ctx, root, { purpose = 'photo' } = {}) {
    if (!['photo','revision'].includes(purpose) || !ctx?.intent || typeof root !== 'string' || !root.startsWith('/') || resolve(root) !== root) fail('motion_blob_storage_unavailable');
    this.#ctx = ctx; this.#root = root; this.#purpose = purpose;
  }
  async #authority(action) {
    await access(this.#ctx, action);
    // Host intent validates the original source/grant before auth.caller returns a sealed principal.
    const { principal: p } = await this.#ctx.intent('auth.caller', {});
    const actor = this.#ctx.authorization.currentActor();
    if (!p || !['id','tenant','issuer','subject'].every(key => typeof p[key] === 'string' && p[key].length > 0 && p[key].length <= 2048)
        || p.state !== 'active' || p.issuer !== actor.issuer || p.subject !== actor.sub) throw new MotionError(401, 'motion_blob_verified_principal_required');
    const base = ['motion-studio', p.tenant, p.id, p.issuer, p.subject];
    const key = JSON.stringify([...base, ...(this.#purpose === 'revision' ? ['revisions'] : [])]);
    this.#owner = hash(JSON.stringify(base));
    if (this.#original && this.#original !== key) throw new MotionError(401, 'motion_identity_changed');
    this.#original = key;
    await access(this.#ctx, action);
    return hash(key);
  }
  async #namespace(action, create = false) {
    const key = await this.#authority(action);
    await directory(this.#root);
    const path = join(this.#root, key);
    if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    await directory(path);
    return path;
  }
  async #fresh(action, path) {
    if (await this.#namespace(action) !== path) throw new MotionError(401, 'motion_identity_changed');
  }
  async #sync(path) { const dir = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { await dir.sync(); } finally { await dir.close(); } }
  async #budget(path, bytes) {
    let count = 0, size = 0;
    const limit = this.#purpose === 'revision' ? REVISION_FILES : PHOTO_FILES;
    const dir = await opendir(path);
    for await (const entry of dir) {
      if (entry.name === LOCK_FILE || entry.name === LOCK_FILE + '-journal') { await lockFile(join(path, entry.name)); continue; }
      if (!uuidFile(entry.name)) fail('motion_blob_cleanup_required');
      const stat = await lstat(join(path, entry.name));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail('motion_blob_unsafe_file');
      size += stat.size; count++;
      if (count >= limit || size + bytes > DISK_LIMIT) fail('motion_blob_cleanup_required');
    }
    if (size + bytes > DISK_LIMIT) fail('motion_blob_cleanup_required');
  }

  /** SQLite is used only as an OS file lock. No user records or handle metadata live in it.
   * Never unlink its inode: every process must lock the same private file, including after a crash.
   */
  async lease(action, { write = !['view','read','export'].includes(action) } = {}) {
    if (typeof write !== 'boolean' || write && ['view','read','export'].includes(action)) throw new MotionError(403, 'motion_permission_denied');
    await this.#authority(action); await directory(this.#root);
    const path = join(this.#root, this.#owner);
    await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    await directory(path);
    const file = join(path, LOCK_FILE);
    try {
      const created = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await created.sync(); } finally { await created.close(); }
      await this.#sync(path);
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const original = await lockFile(file);
    await lstat(file + '-journal').then(() => lockFile(file + '-journal')).catch(error => { if (error.code !== 'ENOENT') throw error; });
    const db = new DatabaseSync(file, { allowExtension: false, timeout: 0 });
    try { db.exec(write ? 'PRAGMA trusted_schema=OFF; BEGIN EXCLUSIVE' : 'PRAGMA trusted_schema=OFF; BEGIN; SELECT name FROM sqlite_schema LIMIT 1'); }
    catch (error) {
      db.close();
      if (error.errcode === 5 || error.errcode === 6 || /locked/i.test(error.message)) {
        const busy = new MotionError(503, 'motion_storage_busy'); busy.retryAfterMs = 100; throw busy;
      }
      fail('motion_blob_unsafe_lock');
    }
    const state = { root: this.#root, owner: this.#owner, file, ino: original.ino, dev: original.dev, write, closed: false };
    const lease = Object.freeze({ check: () => checkLock(state), close() {
      if (state.closed) return; state.closed = true;
      try { db.exec('ROLLBACK'); } finally { db.close(); }
    } });
    lockStates.set(lease, state);
    try { await this.#authority(action); await checkLock(state); return lease; }
    catch (error) { lease.close(); throw error; }
  }
  /** Only store-owned SQL results are passed here, after BEGIN and exact-owner stamping.
   * A capability for the still-held exclusive owner lock is mandatory, even across purposes.
   */
  async reconcile(handles, action, lease) {
    if (!['create','copy','change','upload','delete'].includes(action)) throw new MotionError(403, 'motion_permission_denied');
    if (!(handles instanceof Set) || [...handles].some(id => !uuidFile(id + '.blob'))) fail('motion_blob_invalid_reference');
    await this.#authority(action);
    const state = lockStates.get(lease);
    if (!state || !state.write || state.closed || state.root !== this.#root || state.owner !== this.#owner) fail('motion_blob_lease_required');
    await checkLock(state);
    const path = await this.#namespace(action, true); let removed = 0;
    const dir = await opendir(path);
    for await (const entry of dir) {
      if (entry.name === LOCK_FILE || entry.name === LOCK_FILE + '-journal') { await lockFile(join(path, entry.name)); continue; }
      if (!uuidFile(entry.name)) fail('motion_blob_unsafe_file');
      if (handles.has(entry.name.slice(0, -5))) continue;
      const file = join(path, entry.name), before = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!before) continue;
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || (before.mode & 0o077)) fail('motion_blob_unsafe_file');
      await this.#fresh(action, path);
      await checkLock(state);
      const current = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!current) continue;
      if (current.ino !== before.ino || current.dev !== before.dev || current.nlink !== 1 || !current.isFile() || current.isSymbolicLink()) fail('motion_blob_unsafe_file');
      await unlink(file); removed++;
    }
    if (removed) await this.#sync(path);
    await this.#fresh(action, path); return { removed };
  }
  async put(bytes, action = 'upload') {
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > BLOB_LIMIT) throw new MotionError(413, 'motion_blob_limit');
    bytes = Buffer.from(bytes); // Hold an immutable snapshot across asynchronous host admission.
    const path = await this.#namespace(action, true); await this.#budget(path, bytes.length);
    const ref = { id: randomUUID(), bytes: bytes.length, sha256: hash(bytes) }, file = join(path, ref.id + '.blob');
    const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const created = await handle.stat(); let published = false, closed = false;
    // Receipt owns only the inode it exclusively created, even when the grant is withdrawn on rollback.
    const rollback = async () => {
      if (published) return;
      if (!closed) { await handle.close(); closed = true; }
      await directory(this.#root); await directory(path);
      const stat = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (stat && stat.isFile() && stat.nlink === 1 && stat.ino === created.ino && stat.dev === created.dev) { await unlink(file); await this.#sync(path); }
    };
    try {
      for (let offset = 0; offset < bytes.length;) {
        await this.#fresh(action, path);
        const { bytesWritten } = await handle.write(bytes, offset, Math.min(CHUNK, bytes.length - offset), offset);
        if (!bytesWritten) fail('motion_blob_write_failed'); offset += bytesWritten;
      }
      await handle.sync(); await handle.close(); closed = true; await this.#sync(path);
      await this.#fresh(action, path);
      return { ref: Object.freeze(ref), commit() { published = true; }, rollback };
    } catch (error) { await rollback(); throw error; }
  }
  async read(value, action = 'read') {
    const ref = descriptor(value), path = await this.#namespace(action);
    const handle = await open(join(path, ref.id + '.blob'), constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => fail('motion_blob_unavailable'));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size !== ref.bytes || (stat.mode & 0o077)) fail('motion_blob_integrity_error');
      const bytes = Buffer.alloc(ref.bytes);
      for (let offset = 0; offset < bytes.length;) {
        await this.#fresh(action, path);
        const { bytesRead } = await handle.read(bytes, offset, Math.min(CHUNK, bytes.length - offset), offset);
        if (!bytesRead) fail('motion_blob_integrity_error'); offset += bytesRead;
      }
      if ((await handle.stat()).size !== ref.bytes || hash(bytes) !== ref.sha256) fail('motion_blob_integrity_error');
      await this.#fresh(action, path); return bytes;
    } finally { await handle.close(); }
  }
  async remove(value, action = 'delete') {
    const ref = descriptor(value), path = await this.#namespace(action), file = join(path, ref.id + '.blob');
    const stat = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) return;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== ref.bytes) fail('motion_blob_unsafe_file');
    await this.#fresh(action, path); await unlink(file); await this.#sync(path);
  }
}
