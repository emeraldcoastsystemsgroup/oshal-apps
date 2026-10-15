/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Stage complete editable bundles with request-owned original authority, durable offsets and bounded private chunks.
 */
import { DatabaseSync } from 'node:sqlite';
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, rename, unlink, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { access } from './authorization.mjs';
import { MotionError, LIMITS } from './project-store.mjs';
import { BUNDLE_LIMITS } from './portable-bundle.mjs';
import { projectReceipt } from './project-inspection.mjs';
export const TRANSFER_LIMITS = Object.freeze({ bytes: BUNDLE_LIMITS.archiveBytes, chunkBytes: 1048576, sessions: 2, lifetimeMs: 3600000 });
const DISK_CHUNK = 131072, META_BYTES = 65536, LOCK = '.lock.sqlite';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const uid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const fail = (status, code) => { throw new MotionError(status, code); };
function input(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail(400, 'motion_invalid_transfer_input');
}
function length(value) { if (!Number.isSafeInteger(value) || value < 1 || value > TRANSFER_LIMITS.bytes) fail(413, 'motion_transfer_limit'); }
function title(value) { if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > LIMITS.title)) fail(400, 'motion_invalid_title'); }
async function directory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || await realpath(path) !== path) fail(503, 'motion_transfer_unsafe_directory');
}
function regular(stat, limit = TRANSFER_LIMITS.bytes) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077) || stat.size > limit) fail(503, 'motion_transfer_unsafe_file');
  return stat;
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
function metadata(value, id) {
  input(value, ['id','kind','state','created','expires','bytes','sha256','received','requestKey','title','project','revision','chunks','receipt']);
  if (value.id !== id || !uid(id) || !['import','export'].includes(value.kind) || !['uploading','preparing','ready','complete'].includes(value.state)
      || !Number.isSafeInteger(value.created) || !Number.isSafeInteger(value.expires) || value.expires - value.created !== TRANSFER_LIMITS.lifetimeMs
      || !Number.isSafeInteger(value.received) || value.received < 0 || value.received > value.bytes) fail(503, 'motion_transfer_invalid_metadata');
  length(value.bytes); if (!digest(value.sha256)) fail(503, 'motion_transfer_invalid_metadata');
  if (value.kind === 'import') {
    if (!uid(value.requestKey) || !['uploading','complete'].includes(value.state) || value.chunks !== undefined || value.project !== undefined || value.revision !== undefined) fail(503, 'motion_transfer_invalid_metadata');
    title(value.title);
    if (value.state === 'complete' && (!uid(value.receipt?.id) || value.received !== value.bytes)) fail(503, 'motion_transfer_invalid_metadata');
    if (value.state !== 'complete' && value.receipt !== undefined) fail(503, 'motion_transfer_invalid_metadata');
  } else {
    if (!uid(value.project) || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision > LIMITS.revisions || !['preparing','ready'].includes(value.state)
        || value.requestKey !== undefined && !uid(value.requestKey) || value.title !== undefined || value.receipt !== undefined) fail(503, 'motion_transfer_invalid_metadata');
    if (value.state === 'ready' && (value.received !== value.bytes || !Array.isArray(value.chunks) || value.chunks.length !== Math.ceil(value.bytes / TRANSFER_LIMITS.chunkBytes) || !value.chunks.every(digest))) fail(503, 'motion_transfer_invalid_metadata');
  }
  return value;
}
function receipt(meta) {
  return { id: meta.id, kind: meta.kind, state: meta.state, bytes: meta.bytes, received: meta.received, sha256: meta.sha256,
    chunkBytes: TRANSFER_LIMITS.chunkBytes, expiresAt: new Date(meta.expires).toISOString(),
    ...(meta.kind === 'export' ? { project: meta.project, revision: meta.revision } : {}), ...(meta.receipt ? { project: meta.receipt } : {}) };
}
/** Construct once per fresh admitted request together with its source store. Never hold this context
 * as a background capability. Root is trusted package-process data; inputs contain no owner/path.
 * This source service has no public route/tool binding yet. Each read is a bounded independent request.
 */
export class MotionBundleTransfers {
  #ctx; #root; #original;
  constructor(ctx, root) {
    if (!ctx?.intent || typeof root !== 'string' || !root.startsWith('/') || resolve(root) !== root) fail(503, 'motion_transfer_storage_unavailable');
    this.#ctx = ctx; this.#root = root;
  }
  async #authority(action) {
    await access(this.#ctx, action);
    const p = (await this.#ctx.intent('auth.caller', {}))?.principal, actor = this.#ctx.authorization.currentActor();
    if (!p || p.state !== 'active' || !['id','tenant','issuer','subject'].every(key => typeof p[key] === 'string' && p[key].length > 0 && p[key].length <= 2048)
        || p.issuer !== actor.issuer || p.subject !== actor.sub) fail(401, 'motion_transfer_verified_principal_required');
    const original = JSON.stringify(['motion-studio',p.tenant,p.id,p.issuer,p.subject,'bundle-transfers']);
    if (this.#original && this.#original !== original) fail(401, 'motion_identity_changed');
    this.#original = original; await access(this.#ctx, action); return sha(original);
  }
  async #namespace(action) {
    const key = await this.#authority(action); await directory(this.#root);
    const parent = join(this.#root, '.motion-transfers');
    await mkdir(parent, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; }); await directory(parent);
    const path = join(parent, key);
    await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; }); await directory(path);
    return path;
  }
  async #locked(action, work) {
    const path = await this.#namespace(action), file = join(path, LOCK);
    try { const created = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); try { await created.sync(); } finally { await created.close(); } await syncDirectory(path); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const initial = regular(await lstat(file), 1048576);
    await lstat(file + '-journal').then(stat => regular(stat, 1048576)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    const db = new DatabaseSync(file, { allowExtension: false, timeout: 0 });
    try { db.exec('PRAGMA trusted_schema=OFF; BEGIN EXCLUSIVE'); }
    catch (error) { db.close(); if (error.errcode === 5 || error.errcode === 6 || /locked/i.test(error.message)) fail(503, 'motion_transfer_busy'); throw error; }
    const check = async () => {
      if (await this.#namespace(action) !== path) fail(401, 'motion_identity_changed');
      const current = regular(await lstat(file), 1048576);
      if (initial.ino !== current.ino || initial.dev !== current.dev) fail(503, 'motion_transfer_lock_changed');
    };
    try { await check(); return await work(path, check); }
    finally { try { db.exec('ROLLBACK'); } finally { db.close(); } }
  }
  async #file(path, id, flags) {
    if (!uid(id)) fail(400, 'motion_invalid_transfer_id');
    const file = join(path, id + '.data');
    const handle = await open(file, flags | constants.O_NOFOLLOW).catch(error => { if (error.code === 'ENOENT') fail(404, 'motion_transfer_not_found'); throw error; });
    try {
      const initial = regular(await handle.stat()), current = regular(await lstat(file));
      if (initial.ino !== current.ino || initial.dev !== current.dev) fail(503, 'motion_transfer_file_changed');
      const check = async () => { const now = regular(await lstat(file)), held = regular(await handle.stat()); if (now.ino !== initial.ino || now.dev !== initial.dev || held.ino !== initial.ino || held.dev !== initial.dev) fail(503, 'motion_transfer_file_changed'); };
      return { handle, check };
    } catch (error) { await handle.close(); throw error; }
  }
  async #load(path, id) {
    if (!uid(id)) fail(400, 'motion_invalid_transfer_id');
    const handle = await open(join(path, id + '.json'), constants.O_RDONLY | constants.O_NOFOLLOW).catch(error => { if (error.code === 'ENOENT') fail(404, 'motion_transfer_not_found'); throw error; });
    try {
      const initial = regular(await handle.stat(), META_BYTES), bytes = Buffer.alloc(initial.size); let offset = 0;
      while (offset < bytes.length) { const {bytesRead} = await handle.read(bytes,offset,bytes.length-offset,offset); if (!bytesRead) fail(503, 'motion_transfer_invalid_metadata'); offset += bytesRead; }
      const held = regular(await handle.stat(), META_BYTES), current = regular(await lstat(join(path,id+'.json')), META_BYTES);
      if (held.size !== initial.size || held.ino !== current.ino || held.dev !== current.dev) fail(503, 'motion_transfer_invalid_metadata');
      let value; try { value = metadata(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),id); }
      catch (error) { if (error instanceof MotionError) throw error; fail(503, 'motion_transfer_invalid_metadata'); }
      if (value.expires <= Date.now()) fail(410, 'motion_transfer_expired'); return value;
    }
    finally { await handle.close(); }
  }
  async #publish(path, meta, check) {
    metadata(meta, meta.id); const bytes = Buffer.from(JSON.stringify(meta)); if (bytes.length > META_BYTES) fail(503, 'motion_transfer_invalid_metadata');
    const temp = join(path, randomUUID() + '.tmp'), destination = join(path, meta.id + '.json');
    const handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); let renamed = false;
    try {
      await handle.writeFile(bytes); await handle.sync(); await handle.close(); await check();
      await lstat(destination).then(stat => regular(stat, META_BYTES)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await rename(temp, destination); renamed = true; await syncDirectory(path); await check();
    } catch (error) {
      // A rename may have settled even when its acknowledgement/next admission failed. Never
      // truncate already-published payload on an unknown reply; next request reconciles metadata.
      error.transferMetadataPublished = renamed; throw error;
    } finally { await handle.close().catch(() => {}); if (!renamed) await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async #newFile(path, id) {
    const handle = await open(join(path, id + '.data'), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.sync(); } finally { await handle.close(); } await syncDirectory(path);
  }
  async #remove(path, name) {
    const file = join(path, name); regular(await lstat(file), name.endsWith('.json') || name.endsWith('.tmp') ? META_BYTES : TRANSFER_LIMITS.bytes); await unlink(file);
  }
  async #capacity(path, check) {
    const names = await readdir(path); if (names.length > 32) fail(503, 'motion_transfer_cleanup_required');
    const active = [];
    for (const name of names) {
      await check();
      if (name === LOCK || name === LOCK + '-journal') { regular(await lstat(join(path,name)), 1048576); continue; }
      if (!/^[0-9a-f-]{36}\.(json|data|tmp)$/.test(name) || !uid(name.slice(0,36))) fail(503, 'motion_transfer_unsafe_file');
      if (name.endsWith('.tmp')) { await this.#remove(path, name); continue; }
      if (name.endsWith('.data')) {
        if (!names.includes(name.slice(0,36) + '.json')) await this.#remove(path, name);
        continue;
      }
      try { active.push(await this.#load(path, name.slice(0,36))); }
      catch (error) {
        if (error.code !== 'motion_transfer_expired') throw error;
        await check(); await this.#remove(path, name); const data = name.slice(0,36) + '.data';
        if (names.includes(data)) await this.#remove(path, data);
      }
    }
    await syncDirectory(path); return active;
  }
  async beginImport(value) {
    input(value, ['bytes','sha256','title','requestKey']); length(value.bytes); title(value.title);
    if (!digest(value.sha256) || !uid(value.requestKey)) fail(400, 'motion_invalid_transfer_input');
    value = { ...value };
    return this.#locked('copy', async (path, check) => {
      const active = await this.#capacity(path, check), replay = active.find(meta => meta.kind === 'import' && meta.requestKey === value.requestKey);
      if (replay) {
        if (replay.bytes !== value.bytes || replay.sha256 !== value.sha256 || replay.title !== value.title) fail(409, 'motion_idempotency_conflict');
        await check(); return receipt(replay);
      }
      if (active.length >= TRANSFER_LIMITS.sessions) fail(409, 'motion_transfer_session_limit');
      const created = Date.now(), meta = { ...value, id: randomUUID(), kind: 'import', state: 'uploading', created, expires: created + TRANSFER_LIMITS.lifetimeMs, received: 0 };
      await this.#newFile(path,meta.id); await this.#publish(path,meta,check); return receipt(meta);
    });
  }
  async status(id, kind) {
    if (!['import','export'].includes(kind)) fail(400, 'motion_invalid_transfer_input');
    return this.#locked(kind === 'import' ? 'copy' : 'export', async (path, check) => { const meta = await this.#load(path,id); if (meta.kind !== kind) fail(404, 'motion_transfer_not_found'); await check(); return receipt(meta); });
  }
  async append(id, offset, value) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !(value instanceof Uint8Array) || !value.length || value.length > TRANSFER_LIMITS.chunkBytes) fail(400, 'motion_invalid_transfer_chunk');
    const bytes = Buffer.from(value);
    return this.#locked('copy', async (path, check) => {
      const meta = await this.#load(path,id); if (meta.kind !== 'import' || meta.state !== 'uploading') fail(409, 'motion_transfer_not_uploading');
      if (offset + bytes.length > meta.bytes || offset > meta.received || offset < meta.received && offset + bytes.length > meta.received) fail(409, 'motion_transfer_offset_conflict');
      const file = await this.#file(path,id,constants.O_RDWR); let published = false, writing = false;
      try {
        const size = (await file.handle.stat()).size; if (size < meta.received) fail(503, 'motion_transfer_integrity_error');
        await file.check(); await check(); if (size > meta.received) { await file.handle.truncate(meta.received); await file.handle.sync(); }
        if (offset < meta.received) {
          const held = await this.#read(file,offset,bytes.length,check); if (!held.equals(bytes)) fail(409, 'motion_transfer_chunk_conflict'); await check(); return receipt(meta);
        }
        writing = true;
        for (let n = 0; n < bytes.length;) {
          await check(); await file.check(); const { bytesWritten } = await file.handle.write(bytes,n,Math.min(DISK_CHUNK,bytes.length-n),offset+n);
          if (!bytesWritten) fail(503, 'motion_transfer_write_failed'); n += bytesWritten;
        }
        await file.handle.sync(); await file.check(); await check();
        const next = { ...meta, received: offset + bytes.length }; await this.#publish(path,next,check); published = true; return receipt(next);
      } catch (error) {
        if (writing && !published && !error.transferMetadataPublished) { await file.check(); await file.handle.truncate(meta.received); await file.handle.sync(); }
        throw error;
      } finally { await file.handle.close(); }
    });
  }
  async #read(file, offset, size, check) {
    const bytes = Buffer.alloc(size);
    for (let n = 0; n < size;) { await check(); await file.check(); const { bytesRead } = await file.handle.read(bytes,n,Math.min(DISK_CHUNK,size-n),offset+n); if (!bytesRead) fail(503, 'motion_transfer_integrity_error'); n += bytesRead; }
    await check(); await file.check(); return bytes;
  }
  async prepareExport(store, id, revision, requestKey) {
    if (requestKey !== undefined && !uid(requestKey)) fail(400, 'motion_invalid_transfer_input');
    await store.assertOriginalContext(this.#ctx);
    // Resolve a current immutable source before acquiring the staging lease. exportBundleTo
    // takes its own source read lease while this independent transfer lock is held.
    const source = await store.export(id, revision);
    return this.#locked('export', async (path, check) => {
      const active = await this.#capacity(path,check), replay = requestKey && active.find(m => m.kind === 'export' && m.requestKey === requestKey);
      if (replay && (replay.project !== source.id || replay.revision !== source.revision)) fail(409, 'motion_idempotency_conflict');
      if (replay?.state === 'ready') { await check(); return receipt(replay); }
      if (!replay && active.length >= TRANSFER_LIMITS.sessions) fail(409, 'motion_transfer_session_limit');
      const created = Date.now(), meta = replay || { id: randomUUID(), kind: 'export', state: 'preparing', created, expires: created+TRANSFER_LIMITS.lifetimeMs,
        bytes: TRANSFER_LIMITS.bytes, received: 0, sha256: '0'.repeat(64), project: source.id, revision: source.revision, ...(requestKey === undefined ? {} : {requestKey}) };
      if (!replay) await this.#newFile(path,meta.id); await this.#publish(path,meta,check);
      const file = await this.#file(path,meta.id,constants.O_RDWR); let size = 0, pending = Buffer.alloc(TRANSFER_LIMITS.chunkBytes), used = 0; const chunks = [], hasher = createHash('sha256');
      try {
        await check(); await file.check(); await file.handle.truncate(0); await file.handle.sync();
        const exported = await store.exportBundleTo(source.id,source.revision,async bytes => {
          if (size+bytes.length > TRANSFER_LIMITS.bytes) fail(413, 'motion_transfer_limit');
          for (let n = 0; n < bytes.length;) {
            await check(); await file.check(); const {bytesWritten} = await file.handle.write(bytes,n,Math.min(DISK_CHUNK,bytes.length-n),size+n); if (!bytesWritten) fail(503, 'motion_transfer_write_failed'); n += bytesWritten;
          }
          hasher.update(bytes); size += bytes.length;
          for (let n = 0; n < bytes.length;) { const take = Math.min(bytes.length-n,pending.length-used); pending.set(bytes.subarray(n,n+take),used); n += take; used += take; if (used === pending.length) { chunks.push(sha(pending)); used = 0; } }
          await check();
        });
        if (used) chunks.push(sha(pending.subarray(0,used))); const hash = hasher.digest('hex');
        if (exported.bytes !== size || exported.sha256 !== hash) fail(503, 'motion_transfer_integrity_error');
        await file.handle.sync(); await file.check(); await check();
        const ready = { ...meta, state: 'ready', bytes: size, received: size, sha256: hash, chunks }; await this.#publish(path,ready,check); return receipt(ready);
      } finally { await file.handle.close(); pending = null; }
    });
  }
  async readChunk(store, id, offset) {
    await store.assertOriginalContext(this.#ctx);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset % TRANSFER_LIMITS.chunkBytes) fail(400, 'motion_invalid_transfer_offset');
    return this.#locked('export', async (path,check) => {
      const meta = await this.#load(path,id); if (meta.kind !== 'export' || meta.state !== 'ready') fail(409, 'motion_transfer_not_ready');
      await store.export(meta.project,meta.revision); await check(); if (offset >= meta.bytes) fail(400, 'motion_invalid_transfer_offset');
      const file = await this.#file(path,id,constants.O_RDONLY);
      try {
        if ((await file.handle.stat()).size !== meta.bytes) fail(503, 'motion_transfer_integrity_error');
        const bytes = await this.#read(file,offset,Math.min(TRANSFER_LIMITS.chunkBytes,meta.bytes-offset),check);
        const hash = sha(bytes); if (hash !== meta.chunks[offset / TRANSFER_LIMITS.chunkBytes]) fail(503, 'motion_transfer_integrity_error');
        await store.export(meta.project,meta.revision); await check(); return { ...receipt(meta), offset, bytes, chunkSha256: hash, nextOffset: offset+bytes.length < meta.bytes ? offset+bytes.length : null };
      } finally { await file.handle.close(); }
    });
  }
  async readFragment(store,id,offset) {
    if (!Number.isSafeInteger(offset)||offset<0||offset%65536) fail(400,'motion_invalid_transfer_offset');
    const segment=Math.floor(offset/TRANSFER_LIMITS.chunkBytes)*TRANSFER_LIMITS.chunkBytes;
    const whole=await this.readChunk(store,id,segment);
    if(offset>=whole.bytes.length+segment)fail(400,'motion_invalid_transfer_offset');
    const bytes=whole.bytes.subarray(offset-segment,Math.min(offset-segment+65536,whole.bytes.length));
    return {offset,bytes:bytes.length,totalBytes:whole.received,sha256:sha(bytes),dataBase64:bytes.toString('base64'),complete:offset+bytes.length===whole.received,nextOffset:offset+bytes.length===whole.received?null:offset+bytes.length};
  }
  async finishImport(store,id) {
    await store.assertOriginalContext(this.#ctx);
    return this.#locked('copy', async (path,check) => {
      const meta = await this.#load(path,id); if (meta.kind !== 'import' || meta.received !== meta.bytes) fail(409, 'motion_transfer_incomplete');
      if (meta.state === 'complete') { const project = await store.get(meta.receipt.id,meta.receipt.revision); await check(); return { ...receipt(meta), project: projectReceipt(project) }; }
      const file = await this.#file(path,id,constants.O_RDONLY);
      try {
        if ((await file.handle.stat()).size !== meta.bytes) fail(503, 'motion_transfer_integrity_error');
        const hasher = createHash('sha256');
        for (let n = 0; n < meta.bytes; n += DISK_CHUNK) hasher.update(await this.#read(file,n,Math.min(DISK_CHUNK,meta.bytes-n),check));
        if (hasher.digest('hex') !== meta.sha256) fail(400, 'motion_transfer_digest_mismatch');
        const self = this;
        async function* stream() {
          const streamed = createHash('sha256');
          for (let n = 0; n < meta.bytes; n += DISK_CHUNK) { const bytes = await self.#read(file,n,Math.min(DISK_CHUNK,meta.bytes-n),check); streamed.update(bytes); yield bytes; }
          if (streamed.digest('hex') !== meta.sha256) fail(400, 'motion_transfer_digest_mismatch');
          await check(); await file.check();
        }
        // A lost COMMIT reply leaves the upload intact and requestKey stable. Only confirmed
        // source-store success publishes completion; retry uses that store's real idempotency.
        const project = await store.importBundle(stream(), { requestKey: meta.requestKey, ...(meta.title === undefined ? {} : { title: meta.title }) });
        await check(); const complete = { ...meta, state: 'complete', receipt: projectReceipt(project) }; await this.#publish(path,complete,check); return receipt(complete);
      } finally { await file.handle.close(); }
    });
  }
  async cancel(id,kind) {
    if (!['import','export'].includes(kind)) fail(400, 'motion_invalid_transfer_input');
    return this.#locked(kind === 'import' ? 'copy' : 'export', async (path,check) => {
      const meta = await this.#load(path,id); if (meta.kind !== kind) fail(404, 'motion_transfer_not_found');
      await check(); await this.#remove(path,id+'.json'); await check();
      await lstat(join(path,id+'.data')).then(() => this.#remove(path,id+'.data')).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await syncDirectory(path); await check(); return { id, cancelled: true };
    });
  }
}
