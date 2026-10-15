/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Stage complete native effect values under sealed original authority with bounded chunks and one atomic native save.
 */
import { DatabaseSync } from 'node:sqlite';
import { constants } from 'node:fs';
import { open,mkdir,lstat,realpath,rename,unlink,readdir } from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {access} from './authorization.mjs';
import {MotionError,LIMITS} from './project-store.mjs';
import {projectReceipt} from './project-inspection.mjs';
export const VALUE_LIMITS=Object.freeze({bytes:LIMITS.documentBytes,chunkBytes:8192,sessions:2,lifetimeMs:3600000});
const DISK_CHUNK=131072,META_BYTES=65536,LOCK='.lock.sqlite';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const uid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const digest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const fail=(status,code)=>{throw new MotionError(status,code);};
function input(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))fail(400,'motion_invalid_value_input');}
function length(value){if(!Number.isSafeInteger(value)||value<1||value>VALUE_LIMITS.bytes)fail(413,'motion_value_limit');}
export function valueTarget(value){
 input(value,['project','revision','compId','layer','effect','prop','compTimeTicks']);
 if(!uid(value.project)||!Number.isSafeInteger(value.revision)||value.revision<1||value.revision>LIMITS.revisions)fail(400,'motion_invalid_value_target');
 for(const name of ['compId','layer','effect','prop'])if(typeof value[name]!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(value[name])||BigInt(value[name])>18446744073709551615n)fail(400,'motion_invalid_value_target');
 if(typeof value.compTimeTicks!=='string'||!/^(-?(0|[1-9][0-9]{0,18}))$/.test(value.compTimeTicks)||value.compTimeTicks==='-0'||BigInt(value.compTimeTicks)<-9223372036854775808n||BigInt(value.compTimeTicks)>9223372036854775807n)fail(400,'motion_invalid_value_target');
 return value;
}
function metadata(value,id){
 try{
 input(value,['id','state','created','expires','bytes','sha256','received','requestKey','target','receipt']);
 if(value.id!==id||!uid(id)||!['uploading','complete'].includes(value.state)||!Number.isSafeInteger(value.created)||!Number.isSafeInteger(value.expires)||value.expires-value.created!==VALUE_LIMITS.lifetimeMs||!Number.isSafeInteger(value.received)||value.received<0||value.received>value.bytes||!uid(value.requestKey)||!digest(value.sha256))fail(503,'motion_value_invalid_metadata');
 length(value.bytes);valueTarget(value.target);
 if(value.state==='complete'&&(!uid(value.receipt?.id)||value.receipt.revision!==value.target.revision+1||value.receipt.id!==value.target.project||value.received!==value.bytes)||value.state!=='complete'&&value.receipt!==undefined)fail(503,'motion_value_invalid_metadata');
 return value;
 }catch(error){if(error instanceof MotionError)fail(503,'motion_value_invalid_metadata');throw error;}
}
function receipt(meta){return{id:meta.id,state:meta.state,bytes:meta.bytes,received:meta.received,sha256:meta.sha256,target:meta.target,chunkBytes:VALUE_LIMITS.chunkBytes,expiresAt:new Date(meta.expires).toISOString(),...(meta.receipt?{project:meta.receipt}:{})};}
async function directory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || await realpath(path) !== path) fail(503, 'motion_value_unsafe_directory');
}
function regular(stat, limit = VALUE_LIMITS.bytes) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077) || stat.size > limit) fail(503, 'motion_value_unsafe_file');
  return stat;
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
export class MotionValueTransfers {
 #ctx;#root;#store;#original;#target=null;
 constructor(ctx,root,store){if(!ctx?.intent||typeof root!=='string'||!root.startsWith('/')||resolve(root)!==root||!store?.reference)fail(503,'motion_value_storage_unavailable');this.#ctx=ctx;this.#root=root;this.#store=store;}
 async #authority(action){
  await this.#store.assertOriginalContext(this.#ctx);await access(this.#ctx,'read');await access(this.#ctx,action);
  const p=(await this.#ctx.intent('auth.caller',{}))?.principal,actor=this.#ctx.authorization.currentActor();
  if(!p||p.state!=='active'||!['id','tenant','issuer','subject'].every(key=>typeof p[key]==='string'&&p[key]&&p[key].length<=2048)||p.issuer!==actor.issuer||p.subject!==actor.sub)fail(401,'motion_value_verified_principal_required');
  const original=JSON.stringify(['motion-studio',p.tenant,p.id,p.issuer,p.subject,'value-transfers']);if(this.#original&&this.#original!==original)fail(401,'motion_identity_changed');this.#original=original;
  if(this.#target)await this.#store.reference(this.#target.project,this.#target.revision);
  await access(this.#ctx,'read');await access(this.#ctx,action);return sha(original);
 }
  async #namespace(action) {
    const key = await this.#authority(action); await directory(this.#root);
    const parent = join(this.#root, '.motion-value-transfers');
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
    catch (error) { db.close(); if (error.errcode === 5 || error.errcode === 6 || /locked/i.test(error.message)) fail(503, 'motion_value_busy'); throw error; }
    const check = async () => {
      if (await this.#namespace(action) !== path) fail(401, 'motion_identity_changed');
      const current = regular(await lstat(file), 1048576);
      if (initial.ino !== current.ino || initial.dev !== current.dev) fail(503, 'motion_value_lock_changed');
    };
    try { await check(); return await work(path, check); }
    finally { try { db.exec('ROLLBACK'); } finally { db.close(); } }
  }
  async #file(path, id, flags) {
    if (!uid(id)) fail(400, 'motion_invalid_transfer_id');
    const file = join(path, id + '.data');
    const handle = await open(file, flags | constants.O_NOFOLLOW).catch(error => { if (error.code === 'ENOENT') fail(404, 'motion_value_not_found'); throw error; });
    try {
      const initial = regular(await handle.stat()), current = regular(await lstat(file));
      if (initial.ino !== current.ino || initial.dev !== current.dev) fail(503, 'motion_value_file_changed');
      const check = async () => { const now = regular(await lstat(file)), held = regular(await handle.stat()); if (now.ino !== initial.ino || now.dev !== initial.dev || held.ino !== initial.ino || held.dev !== initial.dev) fail(503, 'motion_value_file_changed'); };
      return { handle, check };
    } catch (error) { await handle.close(); throw error; }
  }
  async #load(path, id) {
    if (!uid(id)) fail(400, 'motion_invalid_transfer_id');
    const handle = await open(join(path, id + '.json'), constants.O_RDONLY | constants.O_NOFOLLOW).catch(error => { if (error.code === 'ENOENT') fail(404, 'motion_value_not_found'); throw error; });
    try {
      const initial = regular(await handle.stat(), META_BYTES), bytes = Buffer.alloc(initial.size); let offset = 0;
      while (offset < bytes.length) { const {bytesRead} = await handle.read(bytes,offset,bytes.length-offset,offset); if (!bytesRead) fail(503, 'motion_value_invalid_metadata'); offset += bytesRead; }
      const held = regular(await handle.stat(), META_BYTES), current = regular(await lstat(join(path,id+'.json')), META_BYTES);
      if (held.size !== initial.size || held.ino !== current.ino || held.dev !== current.dev) fail(503, 'motion_value_invalid_metadata');
      let value; try { value = metadata(JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)),id); }
      catch (error) { if (error instanceof MotionError) throw error; fail(503, 'motion_value_invalid_metadata'); }
      if (value.expires <= Date.now()) fail(410, 'motion_value_expired'); return value;
    }
    finally { await handle.close(); }
  }
  async #publish(path, meta, check) {
    metadata(meta, meta.id); const bytes = Buffer.from(JSON.stringify(meta)); if (bytes.length > META_BYTES) fail(503, 'motion_value_invalid_metadata');
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
    const file = join(path, name); regular(await lstat(file), name.endsWith('.json') || name.endsWith('.tmp') ? META_BYTES : VALUE_LIMITS.bytes); await unlink(file);
  }
  async #capacity(path, check) {
    const names = await readdir(path); if (names.length > 32) fail(503, 'motion_value_cleanup_required');
    const active = [];
    for (const name of names) {
      await check();
      if (name === LOCK || name === LOCK + '-journal') { regular(await lstat(join(path,name)), 1048576); continue; }
      if (!/^[0-9a-f-]{36}\.(json|data|tmp)$/.test(name) || !uid(name.slice(0,36))) fail(503, 'motion_value_unsafe_file');
      if (name.endsWith('.tmp')) { await this.#remove(path, name); continue; }
      if (name.endsWith('.data')) {
        if (!names.includes(name.slice(0,36) + '.json')) await this.#remove(path, name);
        continue;
      }
      try { active.push(await this.#load(path, name.slice(0,36))); }
      catch (error) {
        if (error.code !== 'motion_value_expired') throw error;
        await check(); await this.#remove(path, name); const data = name.slice(0,36) + '.data';
        if (names.includes(data)) await this.#remove(path, data);
      }
    }
    await syncDirectory(path); return active;
  }
 async begin(value){
  input(value,['bytes','sha256','requestKey','target']);length(value.bytes);valueTarget(value.target);
  if(!digest(value.sha256)||!uid(value.requestKey))fail(400,'motion_invalid_value_input');this.#target=value.target;
  return this.#locked('change',async(path,check)=>{
   const active=await this.#capacity(path,check),replay=active.find(m=>m.requestKey===value.requestKey);
   if(replay){if(replay.bytes!==value.bytes||replay.sha256!==value.sha256||JSON.stringify(replay.target)!==JSON.stringify(value.target))fail(409,'motion_idempotency_conflict');await check();return receipt(replay);}
   if(active.length>=VALUE_LIMITS.sessions)fail(409,'motion_value_session_limit');
   const created=Date.now(),meta={...value,id:randomUUID(),state:'uploading',created,expires:created+VALUE_LIMITS.lifetimeMs,received:0};await this.#newFile(path,meta.id);await this.#publish(path,meta,check);return receipt(meta);
  });
 }
 async status(id){return this.#locked('change',async(path,check)=>{const meta=await this.#load(path,id);this.#target=meta.target;await check();return receipt(meta);});}
  async append(id, offset, value) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !(value instanceof Uint8Array) || !value.length || value.length > VALUE_LIMITS.chunkBytes) fail(400, 'motion_invalid_transfer_chunk');
    const bytes = Buffer.from(value);
    return this.#locked('change', async (path, check) => {
      const meta = await this.#load(path,id); this.#target = meta.target; await check(); if (meta.state !== 'uploading') fail(409, 'motion_value_not_uploading');
      if (offset + bytes.length > meta.bytes || offset > meta.received || offset < meta.received && offset + bytes.length > meta.received) fail(409, 'motion_value_offset_conflict');
      const file = await this.#file(path,id,constants.O_RDWR); let published = false, writing = false;
      try {
        const size = (await file.handle.stat()).size; if (size < meta.received) fail(503, 'motion_value_integrity_error');
        await file.check(); await check(); if (size > meta.received) { await file.handle.truncate(meta.received); await file.handle.sync(); }
        if (offset < meta.received) {
          const held = await this.#read(file,offset,bytes.length,check); if (!held.equals(bytes)) fail(409, 'motion_value_chunk_conflict'); await check(); return receipt(meta);
        }
        writing = true;
        for (let n = 0; n < bytes.length;) {
          await check(); await file.check(); const { bytesWritten } = await file.handle.write(bytes,n,Math.min(DISK_CHUNK,bytes.length-n),offset+n);
          if (!bytesWritten) fail(503, 'motion_value_write_failed'); n += bytesWritten;
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
    for (let n = 0; n < size;) { await check(); await file.check(); const { bytesRead } = await file.handle.read(bytes,n,Math.min(DISK_CHUNK,size-n),offset+n); if (!bytesRead) fail(503, 'motion_value_integrity_error'); n += bytesRead; }
    await check(); await file.check(); return bytes;
  }
 async finish(id,apply){
  return this.#locked('change',async(path,check)=>{
   const meta=await this.#load(path,id);this.#target=meta.target;await check();
   if(meta.state==='complete'){const project=await this.#store.get(meta.receipt.id,meta.receipt.revision);await check();return{...receipt(meta),project:projectReceipt(project)};}
   if(meta.received!==meta.bytes)fail(409,'motion_value_incomplete');const file=await this.#file(path,id,constants.O_RDONLY);
   try{
    if((await file.handle.stat()).size!==meta.bytes)fail(503,'motion_value_integrity_error');const bytes=await this.#read(file,0,meta.bytes,check);if(sha(bytes)!==meta.sha256)fail(400,'motion_value_digest_mismatch');
    let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail(400,'motion_invalid_value_utf8');}
    await check();await file.check();const project=await apply(meta.target,text,meta.requestKey);await check();await file.check();
    const complete={...meta,state:'complete',receipt:projectReceipt(project)};await this.#publish(path,complete,check);return receipt(complete);
   }finally{await file.handle.close();}
  });
 }
 async cancel(id){this.#target=null;return this.#locked('change',async(path,check)=>{await this.#load(path,id);await check();await this.#remove(path,id+'.json');await check();await lstat(join(path,id+'.data')).then(()=>this.#remove(path,id+'.data')).catch(error=>{if(error.code!=='ENOENT')throw error;});await syncDirectory(path);await check();return{id,cancelled:true};});}
}
