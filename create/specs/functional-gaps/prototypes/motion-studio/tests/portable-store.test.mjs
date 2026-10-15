/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Transfer editable owned projects through genuine native SQL, SDK pools and compositor with explicit controlled grant seams.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MotionProjectStore, MotionError, LIMITS } from '../routes/project-store.mjs';
import { MotionOwnedBlobs } from '../routes/owned-blobs.mjs';
import { motionEngine } from '../routes/engine-client.mjs';
import { ownedAssets } from '../routes/assets.mjs';
import { parseNative, stringifyNative } from '../tools/native-json.mjs';
import { encodeBundle } from '../routes/portable-bundle.mjs';
import { startNativeSqlFixture } from './native-sql-fixture.mjs';
let fixture, alice, bob, aCtx, bCtx;
before(async () => {
  fixture = await startNativeSqlFixture(); aCtx = fixture.service('alice'); bCtx = fixture.service('bob');
  function service(ctx) {
    let store;
    store = new MotionProjectStore(ctx, { blobs: new MotionOwnedBlobs(ctx,fixture.dataDir), revisionBlobs: new MotionOwnedBlobs(ctx,fixture.dataDir,{purpose:'revision'}),
      decodeRaster: async bytes => {
        try { const {data,info}=await fixture.sharp(bytes,{limitInputPixels:LIMITS.pixels,failOn:'error'}).rotate().toColourspace('srgb').png().toBuffer({resolveWithObject:true});return{bytes:data,type:'image/png',width:info.width,height:info.height}; }
        catch { throw new MotionError(400,'motion_invalid_raster'); }
      }, validateDocument: async (document,incoming) => (await motionEngine(ctx,{op:'inspect',document,assets:incoming??await ownedAssets(document,store)})).document });
    return store;
  }
  alice=service(aCtx);bob=service(bCtx);
});
after(async () => { await aCtx?.pool.drain(); await bCtx?.pool.drain(); await fixture?.close(); });
const key=()=>randomUUID();
async function create(store,ctx,title,assets=[]) { const blank=await motionEngine(ctx,{op:'create'});const doc=(await motionEngine(ctx,{op:'edit',document:blank.document,commands:[{command:'comp.new',params:{name:title,width:320,height:180,frameRate:30,duration:5}}]})).document;return store.create({title,document:doc,assets,requestKey:key()}); }
async function archive(store,id,revision) { const pieces=[];const receipt=await store.exportBundleTo(id,revision,async bytes=>pieces.push(Buffer.from(bytes)));return{bytes:Buffer.concat(pieces),receipt}; }
async function* stream(bytes) { for(let n=0;n<bytes.length;n+=65536)yield bytes.subarray(n,n+65536); }
async function fileArchive(store,id,revision,work) {
  const dir=await mkdtemp(join(tmpdir(),'motion-portable-copy-')),path=join(dir,'project.motionbundle.tar');const out=createWriteStream(path,{mode:0o600});
  try {
    const receipt=await store.exportBundleTo(id,revision,async bytes=>{if(!out.write(bytes))await once(out,'drain');});out.end();await once(out,'close');
    await work(path,receipt);
  } finally {out.destroy();await rm(dir,{recursive:true,force:true});}
}
function shift(document,base) {
  const walk=(value,name='')=>typeof value==='number'&&['id','item','parent','next_id'].includes(name)?base+BigInt(value):Array.isArray(value)?value.map(v=>walk(v)):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,walk(v,k)])):value;
  const result=walk(document);result.items=Object.fromEntries(Object.entries(result.items).map(([k,v])=>[String(base+BigInt(k)),v]));return result;
}
async function blobFiles() {const files=[];for(const dir of await readdir(fixture.dataDir))for(const name of await readdir(join(fixture.dataDir,dir)))if(name.endsWith('.blob'))files.push(join(fixture.dataDir,dir,name));return files.sort();}

test('portable owner transfer preserves actual masks, animation, wide ids/ticks and independent editable bytes',async()=>{
  const raster=await fixture.sharp({create:{width:16,height:8,channels:4,background:{r:255,g:0,b:0,alpha:.5}}}).png().toBuffer();
  const asset=await alice.uploadAsset({bytes:raster});let source=await create(alice,aCtx,'Portable masked original');let imported;
  try {
    const edited=await motionEngine(aCtx,{op:'edit',document:source.document,assets:[{id:asset.id,sha256:asset.sha256,data:(await alice.asset(asset.id)).bytes.toString('base64')}],commands:[
      {command:'asset.import',params:{assetId:asset.id}},{command:'layer.addMask',params:{layer:'#1',shape:'rect',rect:[0,0,8,8]}},
      {command:'prop.addKey',params:{layer:'#1',path:'transform/opacity',time:0,value:0}},
      {command:'prop.addKey',params:{layer:'#1',path:'transform/opacity',time:5,value:100}},
    ]});
    let document=shift(edited.document,18446744073709551400n),composition=Object.values(document.items).find(item=>item.kind.type==='Comp');composition.kind.duration=9007199254740993n;
    source=await alice.save(source.id,{title:source.title,document,assets:[asset.id],baseRevision:1,requestKey:key()});
    const output=await archive(alice,source.id,source.revision),requestKey=key();imported=await bob.importBundle(stream(output.bytes),{requestKey});
    assert.notEqual(imported.id,source.id);assert.equal(imported.revision,1);assert.equal(imported.assets.length,1);assert.notEqual(imported.assets[0],asset.id);
    composition=Object.values(imported.document.items).find(item=>item.kind.type==='Comp');assert.equal(composition.kind.duration,9007199254740993n);assert.ok(composition.id>9007199254740992n);
    const expected=parseNative(stringifyNative(source.document));for(const item of Object.values(expected.items))if(item.kind.type==='Footage')item.kind.path=Object.values(imported.document.items).find(i=>i.kind.type==='Footage').kind.path;
    assert.deepEqual(imported.document,expected);
    const before=await motionEngine(aCtx,{op:'preview',document:source.document,assets:await ownedAssets(source.document,alice),time:2.5});
    const after=await motionEngine(bCtx,{op:'preview',document:imported.document,assets:await ownedAssets(imported.document,bob),time:2.5});assert.equal(after.png,before.png);
    assert.equal((await bob.importBundle(stream(output.bytes),{requestKey})).id,imported.id);
    await assert.rejects(bob.importBundle(stream(output.bytes),{requestKey,title:'Different intent'}),error=>error.code==='motion_idempotency_conflict');
    await assert.rejects(alice.get(imported.id),error=>error.status===404);await assert.rejects(bob.get(source.id),error=>error.status===404);
    await alice.delete(source.id);await alice.deleteAsset(asset.id);source=null;
    const layer=composition.kind.layers[0].id;
    const changed=await motionEngine(bCtx,{op:'edit',document:imported.document,assets:await ownedAssets(imported.document,bob),commands:[{command:'prop.set',params:{layer,path:'transform/rotation',value:30,time:0}}],comp:composition.id});
    const saved=await bob.save(imported.id,{title:imported.title,document:changed.document,assets:imported.assets,baseRevision:1,requestKey:key()});assert.equal(saved.revision,2);
    await assert.rejects(bob.deleteAsset(imported.assets[0]),error=>error.code==='motion_asset_in_use');
  } finally {if(source){await alice.delete(source.id);await alice.deleteAsset(asset.id);}if(imported){await bob.delete(imported.id);for(const id of imported.assets)await bob.deleteAsset(id);}}
});
test('export withdrawal under sink backpressure and import withdrawal during actual insertion leave no unauthorized receipt or partial project',async()=>{
  const raster=await fixture.sharp({create:{width:8,height:8,channels:3,background:'#0000ff'}}).png().toBuffer(),asset=await alice.uploadAsset({bytes:raster}),source=await create(alice,aCtx,'Atomic archive',[asset.id]);
  try {
    let called=0;await assert.rejects(alice.exportBundleTo(source.id,1,async()=>{if(++called===2)fixture.deny('alice','project.export');}),error=>error.status===403);fixture.allow('alice','project.export');
    const output=await archive(alice,source.id,1),before=await blobFiles();
    fixture.onSql((actor,args)=>{if(actor==='bob'&&/^INSERT INTO motion_assets/.test(args.text))fixture.deny('bob','project.read');});
    await assert.rejects(bob.importBundle(stream(output.bytes),{requestKey:key()}),error=>error.status===403);
    fixture.onSql(null);fixture.allow('bob','project.read');assert.deepEqual(await blobFiles(),before);assert.deepEqual(await bob.list(),[]);assert.deepEqual(await bob.listAssets(),[]);
    fixture.assign('bob','reader');await assert.rejects(bob.importBundle(stream(output.bytes),{requestKey:key()}),error=>error.status===403);fixture.assign('bob','administrator');
    const altered=Buffer.from(output.bytes);altered[512]^=1;await assert.rejects(bob.importBundle(stream(altered),{requestKey:key()}));assert.deepEqual(await bob.list(),[]);
  } finally {fixture.onSql(null);fixture.assign('alice','administrator');fixture.assign('bob','administrator');await alice.delete(source.id);await alice.deleteAsset(asset.id);}
});
test('64 real large attached photos transfer through a streamed file and atomic native import without lowering declared library limits',async()=>{
  const image=await fixture.sharp(randomBytes(1100*1000*3),{raw:{width:1100,height:1000,channels:3}}).png().toBuffer();const ids=[];let source,imported;
  try {
    for(let n=0;n<64;n++)ids.push((await alice.uploadAsset({bytes:image})).id);
    source=await create(alice,aCtx,'Full attached library',ids);
    await fileArchive(alice,source.id,1,async(path,receipt)=>{
      assert.ok(receipt.bytes>200*1024*1024);imported=await bob.importBundle(createReadStream(path,{highWaterMark:65536}),{requestKey:key()});
    });
    assert.equal(imported.assets.length,64);assert.equal((await bob.listAssets()).length,64);assert.ok(imported.assets.every(id=>!ids.includes(id)));
    const first=await bob.asset(imported.assets[0]);assert.ok(first.bytes.length>3200000);
    await assert.rejects(bob.uploadAsset({bytes:image}),error=>error.code==='motion_asset_limit');
  } finally {if(source)await alice.delete(source.id);for(const id of ids)await alice.deleteAsset(id);if(imported){await bob.delete(imported.id);for(const id of imported.assets)await bob.deleteAsset(id);}}
});
test('hash-correct malformed raster bytes and unresolved native footage refuse before any owned insert',async()=>{
  const source=await create(alice,aCtx,'Refusal source');
  try {
    const id=key(),data=Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4]),hash=(await import('node:crypto')).createHash('sha256').update(data).digest('hex');
    const pieces=[];for await(const bytes of encodeBundle({title:'Invalid pixels',document:source.document,assets:[{id,type:'image/png',width:1,height:1,bytes:data.length,sha256:hash}]},async()=>data))pieces.push(bytes);
    await assert.rejects(bob.importBundle(stream(Buffer.concat(pieces)),{requestKey:key()}),error=>error.code==='motion_invalid_raster');
    assert.deepEqual(await bob.list(),[]);assert.deepEqual(await bob.listAssets(),[]);
    const missing=parseNative(stringifyNative(source.document));missing.items.fake={kind:{type:'Footage',path:'oshal-asset:'+id+'@'+hash}};
    const parts=[];for await(const bytes of encodeBundle({title:'Missing source',document:missing,assets:[]},async()=>data))parts.push(bytes);
    await assert.rejects(bob.importBundle(stream(Buffer.concat(parts)),{requestKey:key()}),error=>error.code==='motion_bundle_source_unavailable');
    assert.deepEqual(await bob.list(),[]);
  } finally {await alice.delete(source.id);}
});
