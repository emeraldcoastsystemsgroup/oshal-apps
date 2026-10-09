/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify native client proof/limits and refusal before standalone revision writes while preserving legacy SQL.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const logs=[];
const originalLoad=Module._load;
Module._load=function(request,parent,isMain) {
  if (request==='@/shared/logger') return {createChildLogger:()=>Object.fromEntries(['debug','info','warn','error'].map(level=>[level,(fields,msg)=>logs.push({level,fields,msg})]))};
  return originalLoad.call(this,request,parent,isMain);
};
const routes=path.resolve(__dirname,'../routes');
const {EngineClient}=require(path.join(routes,'engine-client.js'));
const {commitRevision}=require(path.join(routes,'project-store.js'));
const HASH='e'.repeat(64);
const LIMITS={requestBytes:12*1024*1024,replyBytes:12*1024*1024,timeoutMs:45_000};
const proof=result=>({protocol:1,buildHash:HASH,limits:LIMITS,result});
const client=(nativeRequest,extra={})=>new EngineClient({host:'legacy',port:1,expectedBuildHash:null,installHint:'native installer',nativeRequest,
  socketFactory(){ throw new Error('Native execution must not open a package socket'); },...extra});
const REV={action:'write-file',detail:{path:'main.gd'},fileCount:1,totalBytes:8,blob:'revision.gz',engineBuild:HASH};

/** The scripted SQL port records admission shape; actual atomic persistence is a separate native PG case. */
function pool(update, insert, held=true) {
  const calls=[];
  return {calls,storageModel:'kernel-scoped-documents',nativeAtomicRequest:()=>held,
    async query(sql,values) { calls.push({sql,values}); return sql.startsWith('UPDATE') ? update : insert; }};
}

test('native RPC returns real proof and explicit bounds without using a process network socket', async()=>{
  let call;
  const c=client(async(op,fields,timeout)=>{call={op,fields,timeout};return proof({files:[]});});
  assert.deepEqual(await c.request('new_project',{kind:'godot'},120_000),{files:[]});
  assert.deepEqual(call,{op:'new_project',fields:{kind:'godot'},timeout:45_000});
  assert.deepEqual(c.status().transportLimits,LIMITS);assert.equal(c.status().address,'native://scene.engine');
  assert.equal(c.status().buildHash,HASH);assert.equal(c.status().connected,true);c.close();
});

test('unverifiable protocol/hash/limits and unavailable execution never advertise connected success',async()=>{
  for (const changed of [{protocol:99},{buildHash:'wrong'},{limits:{...LIMITS,timeoutMs:0}}]) {
    const c=client(async()=>({...proof('discarded'),...changed}));
    await assert.rejects(c.request('ping'),/proof is invalid/);assert.equal(c.status().connected,false);c.close();
  }
  const marker='plain prompt or user code must not enter diagnostic fields';
  const c=client(async()=>{throw new Error(marker);});
  await assert.rejects(c.request('mcp_call',{arguments:{code:marker}}),/refused/);
  assert.equal(c.status().connected,false);assert.equal(logs.map(row=>JSON.stringify(row)+String(row.fields.err?.message)+String(row.fields.err?.stack)).join(' ').includes(marker),false);c.close();
});

test('in-flight native requests are bounded and a refused attempt can reconnect truthfully',async()=>{
  let release;const wait=new Promise(resolve=>{release=resolve;});let count=0;
  const c=client(async()=>{ count++;if(count===1){await wait;throw new Error('fixture refusal');}return proof('actual'); },{maxQueue:1});
  const first=c.request('preview');
  await assert.rejects(c.request('preview'),/queue is full/);release();await assert.rejects(first,/refused/);
  assert.equal(await c.request('preview'),'actual');assert.equal(c.status().connected,true);c.close();
});

test('native revision refuses before SQL unless its actual outer file transaction is held',async()=>{
  const p=pool({rowCount:1,rows:[{revision:1}]},{rowCount:1},false);
  await assert.rejects(commitRevision(p,'alice','id',0,REV),/held atomic file transaction/);assert.deepEqual(p.calls,[]);
});

test('native revision preserves stale-write conflict and exact original owner/value bindings',async()=>{
  const stale=pool({rowCount:0,rows:[]},{rowCount:1});
  assert.equal(await commitRevision(stale,'alice','id',0,REV),null);assert.equal(stale.calls.length,1);
  const p=pool({rowCount:1,rows:[{revision:3}]},{rowCount:1,rows:[{revision:3}]});
  assert.equal((await commitRevision(p,'alice','id',2,REV)).revision,3);
  assert.deepEqual(p.calls[0].values,['alice','id',2,1,8]);
  assert.deepEqual(p.calls[1].values,['id',3,'alice','write-file',JSON.stringify(REV.detail),1,8,'revision.gz',HASH]);
  assert.equal(p.calls.some(row=>row.sql.includes('WITH up AS')),false);
});

test('mismatched update/insert acknowledgements refuse instead of reporting a completed revision',async()=>{
  for (const [update,insert] of [[{rowCount:2,rows:[]},{rowCount:1}],[{rowCount:1,rows:[{}]},{rowCount:0}]])
    await assert.rejects(commitRevision(pool(update,insert),'alice','id',0,REV),/acknowledgement mismatch/);
});

test('legacy pools keep the original one-statement CTE and every value unchanged',async()=>{
  const calls=[];const legacy={query:async(sql,values)=>{calls.push({sql,values});return {rows:[{revision:1}]};}};
  assert.equal((await commitRevision(legacy,'alice','id',0,REV)).revision,1);assert.equal(calls.length,1);
  assert.match(calls[0].sql,/WITH up AS/);assert.deepEqual(calls[0].values,['alice','id',0,1,8,'write-file',JSON.stringify(REV.detail),'revision.gz',HASH]);
});

test('native limits are explicit and legacy file limits remain unchanged',()=>{
  const file=path.join(routes,'project-files.js'),before=process.env.OSHAL_SCENE_NATIVE_RUNTIME;
  try {
    process.env.OSHAL_SCENE_NATIVE_RUNTIME='1';delete require.cache[file];const native=require(file).FILE_LIMITS;
    assert.equal(native.maxFileBytes,8*1024*1024);assert.equal(native.maxTotalBytes,8*1024*1024);
    assert.equal(native.maxStoredBytes,32*1024*1024);assert.equal(native.maxEngineRequestMs,45_000);
    delete process.env.OSHAL_SCENE_NATIVE_RUNTIME;delete require.cache[file];const legacy=require(file).FILE_LIMITS;
    assert.equal(legacy.maxFileBytes,48*1024*1024);assert.equal(legacy.maxTotalBytes,64*1024*1024);
    assert.equal(legacy.maxStoredBytes,undefined);assert.equal(legacy.maxUploadBytes,32*1024*1024);
  } finally {if(before===undefined)delete process.env.OSHAL_SCENE_NATIVE_RUNTIME;else process.env.OSHAL_SCENE_NATIVE_RUNTIME=before;delete require.cache[file];}
});
