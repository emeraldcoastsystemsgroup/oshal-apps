/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove genuine native editable copies, sealed-owner staging, retries, revocation and complete codec-capacity disk transfers.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { open, readdir, readFile, writeFile, lstat, link, unlink, symlink, mkdtemp, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { MotionBundleTransfers, TRANSFER_LIMITS } from '../routes/bundle-transfers.mjs';
import { MotionProjectStore, MotionError, LIMITS } from '../routes/project-store.mjs';
import { MotionOwnedBlobs } from '../routes/owned-blobs.mjs';
import { motionEngine } from '../routes/engine-client.mjs';
import { ownedAssets } from '../routes/assets.mjs';
import { encodeBundle } from '../routes/portable-bundle.mjs';
import { startNativeSqlFixture } from './native-sql-fixture.mjs';
let fixture; const contexts = [];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const key = () => randomUUID();
before(async () => { fixture = await startNativeSqlFixture(); });
after(async () => { for (const ctx of contexts) await ctx.pool.drain(); await fixture?.close(); });
function request(actor) {
  const ctx = fixture.service(actor); contexts.push(ctx); let store;
  store = new MotionProjectStore(ctx, { blobs: new MotionOwnedBlobs(ctx,fixture.dataDir), revisionBlobs: new MotionOwnedBlobs(ctx,fixture.dataDir,{purpose:'revision'}),
    decodeRaster: async bytes => {
      try { const {data,info} = await fixture.sharp(bytes,{limitInputPixels:LIMITS.pixels,failOn:'error'}).rotate().toColourspace('srgb').png().toBuffer({resolveWithObject:true}); return {bytes:data,type:'image/png',width:info.width,height:info.height}; }
      catch { throw new MotionError(400,'motion_invalid_raster'); }
    }, validateDocument: async (document,incoming) => (await motionEngine(ctx,{op:'inspect',document,assets:incoming??await ownedAssets(document,store)})).document });
  return { ctx, store, transfers: new MotionBundleTransfers(ctx,fixture.dataDir) };
}
async function create(actor,title) {
  const {store,ctx} = request(actor), blank = await motionEngine(ctx,{op:'create'});
  const document = (await motionEngine(ctx,{op:'edit',document:blank.document,commands:[{command:'comp.new',params:{name:title,width:320,height:180,frameRate:30,duration:5}}]})).document;
  return store.create({title,document,requestKey:key()});
}
async function dataPath(actor,id) {
  const p = fixture.principal(actor), owner = sha(JSON.stringify(['motion-studio',p.tenant,p.id,p.issuer,p.subject,'bundle-transfers']));
  return join(fixture.dataDir,'.motion-transfers',owner,id+'.data');
}
async function upload(actor,bytes,options={}) {
  const start = await request(actor).transfers.beginImport({bytes:bytes.length,sha256:sha(bytes),requestKey:key(),...options});
  for (let offset = 0; offset < bytes.length; offset += TRANSFER_LIMITS.chunkBytes) await request(actor).transfers.append(start.id,offset,bytes.subarray(offset,offset+TRANSFER_LIMITS.chunkBytes));
  return start;
}
async function exportSmall(actor,source) {
  const r = request(actor), ready = await r.transfers.prepareExport(r.store,source.id,source.revision), chunks = [];
  for (let offset = 0; offset !== null;) { const next = request(actor), read = await next.transfers.readChunk(next.store,ready.id,offset); chunks.push(read.bytes); offset = read.nextOffset; }
  return { ready, bytes: Buffer.concat(chunks) };
}

test('fresh native request contexts transfer a real editable caption and raster, with independent recipient ownership and replay',async () => {
  const source = await create('alice','Transfer original'); let imported, exported, staged, asset;
  try {
    const r = request('alice'), raster = await fixture.sharp({create:{width:16,height:8,channels:4,background:{r:255,g:0,b:0,alpha:.5}}}).png().toBuffer();
    asset = await r.store.uploadAsset({bytes:raster});
    const document = (await motionEngine(r.ctx,{op:'edit',document:source.document,assets:[{id:asset.id,sha256:asset.sha256,data:(await r.store.asset(asset.id)).bytes.toString('base64')}],commands:[{command:'asset.import',params:{assetId:asset.id}},{command:'layer.addMask',params:{layer:'#1',shape:'rect',rect:[0,0,8,8]}},{command:'layer.newText',params:{name:'Caption',text:'Portable native title',font:'Inter',size:24}}]})).document;
    const saved = await r.store.save(source.id,{title:source.title,document,assets:[asset.id],baseRevision:1,requestKey:key()});
    exported = await exportSmall('alice',saved); assert.equal(sha(exported.bytes),exported.ready.sha256);
    await assert.rejects(request('bob').transfers.status(exported.ready.id,'export'),e=>e.status===404);
    const foreign = request('bob'); await assert.rejects(request('alice').transfers.readChunk(foreign.store,exported.ready.id,0),e=>e.code==='motion_original_context_mismatch');
    staged = await upload('bob',exported.bytes,{title:'Recipient native title'});
    const recipient = request('bob'), result = await recipient.transfers.finishImport(recipient.store,staged.id); imported = await recipient.store.get(result.project.id);
    assert.equal(result.state,'complete'); assert.equal(result.project.title,'Recipient native title'); assert.notEqual(imported.id,source.id); assert.notEqual(imported.assets[0],asset.id);
    const replay = request('bob'); assert.equal((await replay.transfers.finishImport(replay.store,staged.id)).project.id,imported.id);
    assert.equal((await motionEngine(r.ctx,{op:'preview',document:saved.document,assets:await ownedAssets(saved.document,r.store),time:0})).png,(await motionEngine(recipient.ctx,{op:'preview',document:imported.document,assets:await ownedAssets(imported.document,recipient.store),time:0})).png);
    await r.store.delete(source.id); await r.store.deleteAsset(asset.id); asset = null;
    const read = request('alice'); await assert.rejects(read.transfers.readChunk(read.store,exported.ready.id,0),e=>e.status===404);
    const edited = await motionEngine(recipient.ctx,{op:'edit',document:imported.document,assets:await ownedAssets(imported.document,recipient.store),commands:[{command:'prop.set',params:{layer:'#1',path:'transform/opacity',value:25}}]});
    await recipient.store.save(imported.id,{title:imported.title,document:edited.document,assets:imported.assets,baseRevision:1,requestKey:key()});
  } finally {
    if (exported) await request('alice').transfers.cancel(exported.ready.id,'export'); if (staged) await request('bob').transfers.cancel(staged.id,'import');
    await request('alice').store.delete(source.id).catch(e=>{if(e.status!==404)throw e;});
    if (asset) await request('alice').store.deleteAsset(asset.id);
    if (imported) { await request('bob').store.delete(imported.id); for (const id of imported.assets) await request('bob').store.deleteAsset(id); }
  }
});

test('closed inputs, bounded bytes, durable offsets and duplicate retries refuse conflicting authority or content',async () => {
  const bytes = Buffer.alloc(TRANSFER_LIMITS.chunkBytes+512,7), value = {bytes:bytes.length,sha256:sha(bytes),requestKey:key()};
  await assert.rejects(request('bob').transfers.beginImport({...value,owner:'alice'}),e=>e.status===400);
  await assert.rejects(request('bob').transfers.beginImport({...value,bytes:TRANSFER_LIMITS.bytes+1}),e=>e.status===413);
  const start = await request('bob').transfers.beginImport(value);
  try {
    assert.equal((await request('bob').transfers.beginImport(value)).id,start.id);
    await assert.rejects(request('bob').transfers.beginImport({...value,title:'Other intent'}),e=>e.status===409);
    await assert.rejects(request('alice').transfers.append(start.id,0,bytes.subarray(0,1)),e=>e.status===404);
    await assert.rejects(request('bob').transfers.append(start.id,1,bytes.subarray(0,1)),e=>e.code==='motion_transfer_offset_conflict');
    await assert.rejects(request('bob').transfers.append(start.id,0,bytes),e=>e.status===400);
    assert.equal((await request('bob').transfers.append(start.id,0,bytes.subarray(0,TRANSFER_LIMITS.chunkBytes))).received,TRANSFER_LIMITS.chunkBytes);
    assert.equal((await request('bob').transfers.append(start.id,0,bytes.subarray(0,128))).received,TRANSFER_LIMITS.chunkBytes);
    await assert.rejects(request('bob').transfers.append(start.id,0,Buffer.alloc(128,8)),e=>e.code==='motion_transfer_chunk_conflict');
    const r = request('bob'); await assert.rejects(r.transfers.finishImport(r.store,start.id),e=>e.code==='motion_transfer_incomplete');
    const second = await request('bob').transfers.beginImport({...value,requestKey:key()});
    try { await assert.rejects(request('bob').transfers.beginImport({...value,requestKey:key()}),e=>e.code==='motion_transfer_session_limit'); }
    finally { await request('bob').transfers.cancel(second.id,'import'); }
    const path = await dataPath('bob',start.id), handle = await open(path,'a'); try { await handle.write(Buffer.alloc(512,99)); await handle.sync(); } finally { await handle.close(); }
    assert.equal((await lstat(path)).size,TRANSFER_LIMITS.chunkBytes+512);
    await request('bob').transfers.append(start.id,TRANSFER_LIMITS.chunkBytes,bytes.subarray(TRANSFER_LIMITS.chunkBytes));
    assert.equal(sha(await readFile(path)),sha(bytes),'unacknowledged tail is replaced, never accepted');
  } finally { await request('bob').transfers.cancel(start.id,'import'); }
});

test('withdrawn original read/create/export grants stop chunks and roll back only unacknowledged bytes',async () => {
  const bytes = Buffer.alloc(TRANSFER_LIMITS.chunkBytes,8), start = await request('bob').transfers.beginImport({bytes:bytes.length,sha256:sha(bytes),requestKey:key()}); let withdrawn = false;
  try {
    const path = await dataPath('bob',start.id);
    fixture.beforeIntent(async(actor,name)=>{ if(actor==='bob'&&name==='auth.caller'&&!withdrawn&&(await lstat(path)).size>0){withdrawn=true;fixture.deny('bob','project.create');} });
    await assert.rejects(request('bob').transfers.append(start.id,0,bytes),e=>e.status===403); assert.equal(withdrawn,true);
    assert.equal((await lstat(path)).size,0); fixture.beforeIntent(null); fixture.allow('bob','project.create');
    assert.equal((await request('bob').transfers.status(start.id,'import')).received,0);
    await request('bob').transfers.append(start.id,0,bytes); fixture.deny('bob','project.read');
    await assert.rejects(request('bob').transfers.status(start.id,'import'),e=>e.status===403); fixture.allow('bob','project.read');
  } finally {fixture.beforeIntent(null);fixture.assign('bob','administrator');await request('bob').transfers.cancel(start.id,'import');}
  const source = await create('alice','Withdrawn export'), exported = await exportSmall('alice',source);
  try {
    fixture.deny('alice','project.export'); const r=request('alice'); await assert.rejects(r.transfers.readChunk(r.store,exported.ready.id,0),e=>e.status===403);
    fixture.allow('alice','project.export'); let calls=0;
    fixture.beforeIntent((actor,name)=>{if(actor==='alice'&&name==='auth.caller'&&++calls===7)fixture.deny('alice','project.export');});
    const next=request('alice'); await assert.rejects(next.transfers.readChunk(next.store,exported.ready.id,0),e=>e.status===403);
  } finally {fixture.beforeIntent(null);fixture.assign('alice','administrator');await request('alice').transfers.cancel(exported.ready.id,'export');await request('alice').store.delete(source.id);}
});

test('unsafe staging links and corrupt completed export bytes cannot become successful downloads',async () => {
  const source=await create('alice','Integrity export'), exported=await exportSmall('alice',source), path=await dataPath('alice',exported.ready.id);
  try {
    const r=request('alice'); await assert.rejects(r.transfers.readChunk(r.store,exported.ready.id,1),e=>e.status===400);
    const other=path+'.outside'; await link(path,other);
    try {const next=request('alice');await assert.rejects(next.transfers.readChunk(next.store,exported.ready.id,0),e=>e.code==='motion_transfer_unsafe_file');}
    finally {await unlink(other);}
    const handle=await open(path,'r+');try{await handle.write(Buffer.from([0xff]),0,1,512);await handle.sync();}finally{await handle.close();}
    const next=request('alice');await assert.rejects(next.transfers.readChunk(next.store,exported.ready.id,0),e=>e.code==='motion_transfer_integrity_error');
    const original=await readFile(path);await unlink(path);const outside=join(fixture.dataDir,'transfer-outside-'+key());await writeFile(outside,original,{mode:0o600});await symlink(outside,path);
    try{const current=request('alice');await assert.rejects(current.transfers.readChunk(current.store,exported.ready.id,0),e=>e.code==='ELOOP');}
    finally{await unlink(path);await writeFile(path,original,{mode:0o600});await unlink(outside);}
  } finally {await request('alice').transfers.cancel(exported.ready.id,'export');await request('alice').store.delete(source.id);}
});

test('lost native import COMMIT acknowledgement retains staging and retries the same single owned project',async () => {
  const source=await create('alice','Unknown acknowledgement'), exported=await exportSmall('alice',source), staged=await upload('bob',exported.bytes);let imported,tripped=false,inserted=false;
  try {
    fixture.onSql((actor,args)=>{if(actor==='bob'&&/^INSERT INTO motion_requests/.test(args.text))inserted=true;if(actor==='bob'&&inserted&&args.transaction==='commit'&&!tripped){tripped=true;throw new Error('fixture_transfer_commit_reply_lost');}});
    const r=request('bob');await assert.rejects(r.transfers.finishImport(r.store,staged.id),/fixture_transfer_commit_reply_lost/);assert.equal(tripped,true);
    fixture.onSql(null);assert.equal((await request('bob').transfers.status(staged.id,'import')).state,'uploading');
    const next=request('bob'), completed=await next.transfers.finishImport(next.store,staged.id);imported=completed.project;
    assert.equal(completed.state,'complete');assert.equal((await next.store.list()).length,1);
    const final=request('bob');assert.equal((await final.transfers.finishImport(final.store,staged.id)).project.id,imported.id);
  } finally {fixture.onSql(null);await request('bob').transfers.cancel(staged.id,'import');await request('alice').transfers.cancel(exported.ready.id,'export');await request('alice').store.delete(source.id);if(imported)await request('bob').store.delete(imported.id);}
});

test('all 64-by-4MiB codec sources and the exact 2MiB document stage through bounded chunks without a whole-archive buffer',async () => {
  // Full envelope/storage capacity, not a raster-validity or installed-transport claim.
  // Genuine model/raster validation and native editable copy are exercised above.
  const payload=Buffer.alloc(LIMITS.imageBytes,19);Buffer.from([137,80,78,71,13,10,26,10]).copy(payload);
  const document={caption:'x'.repeat(LIMITS.documentBytes-Buffer.byteLength(JSON.stringify({caption:''})))}, hash=sha(payload);
  const assets=Array.from({length:64},()=>({id:key(),type:'image/png',width:1,height:1,bytes:payload.length,sha256:hash}));
  const dir=await mkdtemp(join(tmpdir(),'motion-transfer-envelope-')),path=join(dir,'archive.tar'), out=await open(path,'wx',0o600);let total=0,start;
  const archiveHash=createHash('sha256');
  try {
    for await(const bytes of encodeBundle({title:'Complete envelope',document,assets},async()=>payload)){await out.writeFile(bytes);archiveHash.update(bytes);total+=bytes.length;} await out.sync();await out.close();
    assert.ok(total>258*1024*1024&&total<TRANSFER_LIMITS.bytes);assert.equal(TRANSFER_LIMITS.bytes,264*1024*1024);
    start=await request('bob').transfers.beginImport({bytes:total,sha256:archiveHash.digest('hex'),requestKey:key()});let received=0;
    for await(const bytes of createReadStream(path,{highWaterMark:TRANSFER_LIMITS.chunkBytes})){assert.ok(bytes.length<=TRANSFER_LIMITS.chunkBytes);received=(await request('bob').transfers.append(start.id,received,bytes)).received;}
    assert.equal(received,total);const staged=await request('bob').transfers.status(start.id,'import'), diskHash=createHash('sha256');
    for await(const bytes of createReadStream(await dataPath('bob',start.id),{highWaterMark:131072}))diskHash.update(bytes);
    assert.equal(diskHash.digest('hex'),staged.sha256);assert.equal((await lstat(await dataPath('bob',start.id))).size,total);
  } finally {await out.close().catch(()=>{});if(start)await request('bob').transfers.cancel(start.id,'import');await rm(dir,{recursive:true,force:true});}
});

test('a real separate process holds the stable staging lock and an uncertain published offset retries safely',async () => {
  const bytes=Buffer.alloc(512,19),start=await request('bob').transfers.beginImport({bytes:bytes.length,sha256:sha(bytes),requestKey:key()}),path=await dataPath('bob',start.id);
  let child,withdrawn=false;
  try {
    child=spawn(process.execPath,['--input-type=module','-e',"import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1],{allowExtension:false,timeout:0});db.exec('BEGIN EXCLUSIVE');process.stdout.write('ready\\n');process.stdin.once('data',()=>{db.exec('ROLLBACK');db.close();process.exit(0);});",join(dirname(path),'.lock.sqlite')],{stdio:['pipe','pipe','pipe']});
    const ready=await once(child.stdout,'data');assert.match(String(ready[0]),/ready/);
    await assert.rejects(request('bob').transfers.append(start.id,0,bytes),e=>e.code==='motion_transfer_busy');
    const ended=once(child,'close');child.stdin.end('release');await ended;child=null;
    fixture.beforeIntent(async(actor,name)=>{if(actor==='bob'&&name==='auth.caller'&&!withdrawn){const meta=JSON.parse(await readFile(path.replace(/\.data$/,'.json'),'utf8'));if(meta.received===bytes.length){withdrawn=true;fixture.deny('bob','project.read');}}});
    await assert.rejects(request('bob').transfers.append(start.id,0,bytes),e=>e.status===403);assert.equal(withdrawn,true);
    fixture.beforeIntent(null);fixture.allow('bob','project.read');assert.equal((await lstat(path)).size,bytes.length);
    assert.equal((await request('bob').transfers.append(start.id,0,bytes)).received,bytes.length,'published offset survives a lost reply and exact retry');
    assert.equal(sha(await readFile(path)),sha(bytes));
  } finally {fixture.beforeIntent(null);fixture.assign('bob','administrator');if(child){const ended=once(child,'close');child.kill('SIGKILL');await ended;}await request('bob').transfers.cancel(start.id,'import');}
});

test('full acknowledged bytes with a wrong archive digest refuse before any native insert',async()=>{
  const source=await create('alice','Digest refusal'),exported=await exportSmall('alice',source);let staged;
  try {
    staged=await upload('bob',exported.bytes,{sha256:'a'.repeat(64)});const r=request('bob');await assert.rejects(r.transfers.finishImport(r.store,staged.id),e=>e.code==='motion_transfer_digest_mismatch');
    assert.deepEqual(await r.store.list(),[]);assert.deepEqual(await r.store.listAssets(),[]);
  } finally {if(staged)await request('bob').transfers.cancel(staged.id,'import');await request('alice').transfers.cancel(exported.ready.id,'export');await request('alice').store.delete(source.id);}
});

test('actual large PNG export has independently retryable complete aligned chunks and stops an interrupted producer',async()=>{
  const {randomBytes}=await import('node:crypto'),r=request('alice'),image=await fixture.sharp(randomBytes(1100*1000*3),{raw:{width:1100,height:1000,channels:3}}).png().toBuffer();
  const asset=await r.store.uploadAsset({bytes:image}),source=await create('alice','Large staged source');let ready,partial;
  try {
    const saved=await r.store.save(source.id,{title:source.title,document:source.document,assets:[asset.id],baseRevision:1,requestKey:key()});
    ready=await r.transfers.prepareExport(r.store,saved.id,saved.revision);assert.ok(ready.bytes>3*TRANSFER_LIMITS.chunkBytes);
    const hasher=createHash('sha256');let total=0;
    for(let offset=0;offset!==null;){const next=request('alice'),chunk=await next.transfers.readChunk(next.store,ready.id,offset);assert.ok(chunk.bytes.length<=TRANSFER_LIMITS.chunkBytes);assert.equal(sha(chunk.bytes),chunk.chunkSha256);hasher.update(chunk.bytes);total+=chunk.bytes.length;offset=chunk.nextOffset;}
    assert.equal(total,ready.bytes);assert.equal(hasher.digest('hex'),ready.sha256);
    const repeated=request('alice');assert.equal((await repeated.transfers.readChunk(repeated.store,ready.id,TRANSFER_LIMITS.chunkBytes)).offset,TRANSFER_LIMITS.chunkBytes);
    fixture.beforeIntent(async(actor,name)=>{
      if(actor!=='alice'||name!=='auth.caller'||partial)return;
      const parent=dirname(await dataPath('alice',ready.id));
      for(const file of await readdir(parent))if(file.endsWith('.data')&&!file.startsWith(ready.id)&&(await lstat(join(parent,file))).size>0){partial=file.slice(0,36);fixture.deny('alice','project.export');break;}
    });
    const interrupted=request('alice');await assert.rejects(interrupted.transfers.prepareExport(interrupted.store,saved.id,saved.revision),e=>e.status===403);assert.ok(partial);
    fixture.beforeIntent(null);fixture.allow('alice','project.export');assert.equal((await request('alice').transfers.status(partial,'export')).state,'preparing');
    const next=request('alice');await assert.rejects(next.transfers.readChunk(next.store,partial,0),e=>e.code==='motion_transfer_not_ready');
  } finally {fixture.beforeIntent(null);fixture.assign('alice','administrator');if(partial)await request('alice').transfers.cancel(partial,'export');if(ready)await request('alice').transfers.cancel(ready.id,'export');await r.store.delete(source.id);await r.store.deleteAsset(asset.id);}
});

test('a stable export key resolves ready and interrupted replies without duplicate sessions or changed intent',async()=>{
 const source=await create('alice','Stable export intent'),other=await create('alice','Other source'),requestKey=key();let ready;
 try{
  const first=request('alice');ready=await first.transfers.prepareExport(first.store,source.id,source.revision,requestKey);
  const retry=request('alice');assert.equal((await retry.transfers.prepareExport(retry.store,source.id,source.revision,requestKey)).id,ready.id);
  const changed=request('alice');await assert.rejects(changed.transfers.prepareExport(changed.store,other.id,other.revision,requestKey),e=>e.code==='motion_idempotency_conflict');
  await request('alice').transfers.cancel(ready.id,'export');ready=null;
  let interrupted=false,id;
  fixture.beforeIntent(async(actor,name)=>{
   if(actor!=='alice'||name!=='auth.caller'||interrupted)return;
   const base=dirname(await dataPath('alice',key()));
   for(const file of await readdir(base))if(file.endsWith('.data')&&(await lstat(join(base,file))).size>0){id=file.slice(0,36);interrupted=true;fixture.deny('alice','project.export');break;}
  });
  const stopped=request('alice');await assert.rejects(stopped.transfers.prepareExport(stopped.store,source.id,source.revision,requestKey),e=>e.status===403);assert.equal(interrupted,true);
  fixture.beforeIntent(null);fixture.allow('alice','project.export');assert.equal((await request('alice').transfers.status(id,'export')).state,'preparing');
  const resumed=request('alice');ready=await resumed.transfers.prepareExport(resumed.store,source.id,source.revision,requestKey);assert.equal(ready.id,id);assert.equal(ready.state,'ready');assert.equal(sha(await readFile(await dataPath('alice',id))),ready.sha256);
 }finally{fixture.beforeIntent(null);fixture.assign('alice','administrator');if(ready)await request('alice').transfers.cancel(ready.id,'export');await request('alice').store.delete(source.id);await request('alice').store.delete(other.id);}
});
