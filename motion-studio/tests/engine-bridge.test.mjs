/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise actual native wire framing/rendering and owned child teardown, with explicit lifecycle-only stalled-worker fixtures.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMotionBridge, MAX_LINE } from '../engine/bridge.mjs';
import { sourceIdentity } from '../engine/package-identity.mjs';
import { motionEngine, ENGINE_IDENTITY } from '../routes/engine-client.mjs';
const binary = process.env.MOTION_ENGINE_BINARY;
if (!binary) throw new Error('Set MOTION_ENGINE_BINARY to the reviewed local worker.');

async function waitFor(check, limit = 3000) {
  const started = Date.now();
  while (!check()) { if (Date.now() - started > limit) throw new Error('owned bridge lifecycle did not settle'); await new Promise(done=>setTimeout(done,10)); }
}
/** The wire shape is the native relay's hello then id1 packet; this is transport proof, not installed kernel authorization. */
async function openWire(bridge) {
  const socket = connect(bridge.address.port,'127.0.0.1'); let tail = '', lines = [], waits = [];
  socket.on('data', data => { tail += data.toString('utf8'); for (;;) { const end=tail.indexOf('\n'); if(end<0)break; const line=tail.slice(0,end);tail=tail.slice(end+1); const value=JSON.parse(line); if(waits.length)waits.shift().resolve(value);else lines.push(value); } });
  socket.on('error',error=>{for(const wait of waits.splice(0))wait.reject(error);});
  const next = () => lines.length ? Promise.resolve(lines.shift()) : new Promise((resolve,reject)=>waits.push({resolve,reject}));
  const hello = await next();
  return {socket,hello,next,close:()=>socket.destroy()};
}
async function exchange(bridge, request) {
  const wire = await openWire(bridge);
  try { if(wire.hello.error)return{hello:wire.hello,reply:null};wire.socket.write(JSON.stringify({...request,id:1})+'\n');return{hello:wire.hello,reply:await wire.next()}; }
  finally {wire.close();}
}
async function fixture(t,options={}) {
  const bridge = await startMotionBridge({binary,...options});t.after(()=>bridge.close());return bridge;
}
async function stalled(t,{ignoreTerm=false,exposeEnvironment=false, staleReply=false}={}) {
  const dir = await mkdtemp(join(tmpdir(),'oshal-motion-owned-bridge-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=join(dir,'worker.js'),identity=sourceIdentity();
  const output=exposeEnvironment ? `process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({ok:true,buildHash:${JSON.stringify(staleReply?'0'.repeat(64):identity.buildHash)},result:{upstream:${JSON.stringify(identity.upstream)},leaked:process.env.MOTION_FIXTURE_SECRET||null}})+'\\n'));` : `${ignoreTerm?"process.on('SIGTERM',()=>{});":''}process.stdin.resume();setInterval(()=>{},1000);`;
  await writeFile(file,`#!${process.execPath}\nif(process.argv.includes('--identity'))process.stdout.write(${JSON.stringify(JSON.stringify(identity))});else{${output}}\n`,{mode:0o700});
  return file;
}

test('compiled/source/package identities match and the real framed worker renders actual middle-frame pixels',async t=>{
  assert.deepEqual(ENGINE_IDENTITY,sourceIdentity());const bridge=await fixture(t);
  const calls=[];const ctx={intent:async(name,input)=>{calls.push({name,input});return exchange(bridge,input.request);}};
  const blank=await motionEngine(ctx,{op:'create'});
  const edited=await motionEngine(ctx,{op:'edit',document:blank.document,commands:[
    {command:'comp.new',params:{name:'Main',width:320,height:180,duration:5,frameRate:30}},
    {command:'layer.newSolid',params:{name:'Logo',color:'#ff0000',width:100,height:60}},
    {command:'prop.addKey',params:{layer:'#1',path:'transform/opacity',time:0,value:0}},
    {command:'prop.addKey',params:{layer:'#1',path:'transform/opacity',time:5,value:100}}
  ]});
  const frame=await motionEngine(ctx,{op:'preview',document:edited.document,time:2.5,transparent:true});
  const {createRequire}=await import('node:module');const require=createRequire(join(process.env.MOTION_RASTER_DEPS||'/tmp/oshal-create-proof-ZFGNIA','package.json'));const sharp=require('sharp');
  const image=await sharp(Buffer.from(frame.png,'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(image.info.width,320);assert.equal(image.data[(90*320+160)*4+3],128);
  assert.ok(calls.every(call=>call.name==='engine.exchange'&&call.input.timeoutMs===45000));
  await waitFor(()=>bridge.state().workers===0&&bridge.state().connections===0);
});

test('wrong installed source identity refuses before opening a listener or issuing a package request',async()=>{
  await assert.rejects(startMotionBridge({binary,identity:{...sourceIdentity(),buildHash:'0'.repeat(64)}}),/source_mismatch/);
  const ctx={intent:async()=>({hello:{bridge:{...ENGINE_IDENTITY,buildHash:'0'.repeat(64)}},reply:{id:1,ok:true,result:{upstream:ENGINE_IDENTITY.upstream}}})};
  await assert.rejects(motionEngine(ctx,{op:'create'}),error=>error.code==='motion_engine_source_mismatch');
});

test('caller owner/host/executable selectors and an unavailable relay refuse without a socket fallback',async()=>{
  let calls=0;const ctx={intent:async()=>{calls++;}};
  for(const key of ['owner','host','binary'])await assert.rejects(motionEngine(ctx,{op:'create',[key]:'foreign'}),error=>error.code==='motion_invalid_request');
  assert.equal(calls,0);await assert.rejects(motionEngine({}, {op:'create'}),error=>error.code==='motion_native_engine_unavailable');
});

test('malformed/extra wire fields refuse before spawning a worker',async t=>{
  const bridge=await fixture(t);
  for(const packet of ['{\n',JSON.stringify({id:1,cmd:'motion',args:{op:'create'},owner:'forged'})+'\n',JSON.stringify({id:1,cmd:'shell',args:{op:'create'}})+'\n']){
    const wire=await openWire(bridge);wire.socket.write(packet);assert.equal((await wire.next()).error,'motion_invalid_request');wire.close();assert.equal(bridge.state().workers,0);
    await waitFor(()=>bridge.state().leases===0);
  }
});

test('actual excessive socket bytes refuse before worker admission',async t=>{
  const bridge=await fixture(t);const wire=await openWire(bridge);wire.socket.write(Buffer.alloc(MAX_LINE+1,32));
  assert.equal((await wire.next()).error,'motion_request_limit');wire.close();assert.equal(bridge.state().workers,0);
});

test('busy hello retains the actual worker lease and does not evict another connection',async t=>{
  const fake=await stalled(t);const bridge=await fixture(t,{binary:fake,slots:1});const held=await openWire(bridge);
  held.socket.write(JSON.stringify({id:1,cmd:'motion',args:{op:'create'}})+'\n');await waitFor(()=>bridge.state().workers===1);
  const next=await openWire(bridge);assert.equal(next.hello.error,'motion_engine_busy');next.close();assert.equal(bridge.state().workers,1);
  await assert.rejects(motionEngine({intent:()=>Promise.resolve({hello:{error:'motion_engine_busy'},reply:null})},{op:'create'}),error=>error.code==='motion_engine_busy');
  held.close();await waitFor(()=>bridge.state().workers===0&&bridge.state().leases===0);
});

test('disconnect kills only its unresponsive owned worker and verifies exit before lease reuse',async t=>{
  const fake=await stalled(t,{ignoreTerm:true});const bridge=await fixture(t,{binary:fake,slots:1});const wire=await openWire(bridge);
  wire.socket.write(JSON.stringify({id:1,cmd:'motion',args:{op:'create'}})+'\n');await waitFor(()=>bridge.state().workers===1);
  await new Promise(done=>setTimeout(done,100));wire.close();await waitFor(()=>bridge.state().workers===0&&bridge.state().leases===0);
  const next=await openWire(bridge);assert.ok(next.hello.bridge);next.close();
});

test('a real deadline stops its owned child and releases the slot',async t=>{
  const fake=await stalled(t);const bridge=await fixture(t,{binary:fake,slots:1,timeoutMs:50});
  const answer=await exchange(bridge,{cmd:'motion',args:{op:'create'}});assert.equal(answer.reply.error,'motion_engine_timeout');
  await waitFor(()=>bridge.state().workers===0&&bridge.state().leases===0);
});

test('worker environment excludes inherited credentials and a second packet cannot start another worker',async t=>{
  const previous=process.env.MOTION_FIXTURE_SECRET;process.env.MOTION_FIXTURE_SECRET='fixture-only-marker';t.after(()=>{if(previous===undefined)delete process.env.MOTION_FIXTURE_SECRET;else process.env.MOTION_FIXTURE_SECRET=previous;});
  const fake=await stalled(t,{exposeEnvironment:true});const bridge=await fixture(t,{binary:fake});const answer=await exchange(bridge,{cmd:'motion',args:{op:'create'}});
  assert.equal(answer.reply.result.leaked,null);
  const wire=await openWire(bridge);wire.socket.write(JSON.stringify({id:1,cmd:'motion',args:{op:'create'}})+'\n'+JSON.stringify({id:1,cmd:'motion',args:{op:'create'}})+'\n');
  assert.equal((await wire.next()).error,'motion_single_request_required');wire.close();await waitFor(()=>bridge.state().workers===0);
});


test('a changed worker result cannot reuse the earlier verified bridge identity',async t=>{
  const fake=await stalled(t,{exposeEnvironment:true,staleReply:true});const bridge=await fixture(t,{binary:fake});
  const result=await exchange(bridge,{cmd:'motion',args:{op:'create'}});assert.equal(result.reply.error,'motion_engine_source_mismatch');
});
