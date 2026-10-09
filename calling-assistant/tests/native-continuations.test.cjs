/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Require private native callback/worker proof and durable audio acknowledgement without changing legacy execution.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const {CallingService}=require('../routes/service'),P=require('../routes/policy');
const id='11111111-1111-4111-8111-111111111111',sid='CA'+'3'.repeat(32),recording='RE'+'4'.repeat(32);
const actor={sub:'fixture-owner',issuer:'fixture-issuer',isActive:true};

function service(enqueueAudio){
 const writes=[],config={...P.defaults,enabled:true},run={id,config,call_sid:sid,status:'active',created_at:new Date().toISOString()};
 const pool={query:async(sql,args)=>{
  if(sql.startsWith('SELECT * FROM calling_runs'))return{rows:[run]};
  if(sql.startsWith('SELECT config'))return{rows:[{config}]};
  if(sql.startsWith('SELECT * FROM calling_turns'))return{rows:[{status:'waiting'}]};
  writes.push({sql,args});return{rows:[{turn:0}]};
 }};
 const calls=new CallingService({pool,enqueueAudio,carrier:async()=>assert.fail('no carrier during acknowledgement')});
 return{calls,writes};
}
test('native audio acknowledgement awaits durable enqueue and never starts an unowned promise',async()=>{
 let resolve,reached;const started=new Promise(r=>{reached=r;});
 const durable=new Promise(r=>{resolve=r;});
 const fx=service(async input=>{assert.deepEqual(input,{id,turn:0,recordingSid:recording});reached();await durable;});
 fx.calls.processAudio=()=>assert.fail('callback must not process audio');
 let finished=false;const pending=fx.calls.callback(actor,id,'audio',0,{CallSid:sid,RecordingStatus:'completed',RecordingSid:recording}).then(x=>{finished=true;return x;});
 await started;assert.equal(finished,false);assert.equal(fx.writes.length,0);
 resolve();assert.match(await pending,/<Response>/);assert.equal(finished,true);
});
test('durable enqueue failure refuses acknowledgement and makes no SQL processing claim',async()=>{
 const fx=service(async()=>{throw new Error('durable queue unavailable');});
 await assert.rejects(fx.calls.callback(actor,id,'audio',0,{CallSid:sid,RecordingStatus:'completed',RecordingSid:recording}),/durable queue unavailable/);
 assert.equal(fx.writes.length,0);
});
test('legacy callback retains its conditional SQL claim and processor',async()=>{
 const fx=service();let processed=0;
 fx.calls.processAudio=async()=>{processed++;};
 await fx.calls.callback(actor,id,'audio',0,{CallSid:sid,RecordingStatus:'completed',RecordingSid:recording});
 assert.equal(processed,1);assert.match(fx.writes[0].sql,/status='waiting' RETURNING turn/);
});

/** Load the real route factory with only non-executing framework registrations stubbed. */
function routes(native){
 const paths=new Map(),queries=[],intents=[];
 const filename=require.resolve('../routes/routes'),local=createRequire(filename),module={exports:{}};
 const router={post:(path,fn)=>paths.set(path,fn)};
 const aliases={
  './callback':{callbackVerifier:()=>assert.fail('native verifier cannot delegate to system identity')},
  '@/app/routes/connector-account-operations':{},'@/app/routes/connector-tenancy':{},
  '@/features/voice/services/voice-service':{VoiceService:class{transcribeAudio(){assert.fail('no speech');}}},
  '@/features/voice-providers':{},'@/shared/services/database/request-identity':{},
 };
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,require:name=>
  name==='express'?{Router:()=>router}:aliases[name]||local(name)},{filename});
 const ctx={pool:{storageModel:native?'kernel-scoped-documents':undefined,query:async sql=>{queries.push(sql);throw new Error('must verify first');}},
  authorization:{currentActor:()=>actor},intent:async(name,input)=>{intents.push({name,input});throw Object.assign(new Error('no private proof'),{status:403,code:'native_proof_required'});}};
 module.exports.createCallingCallbackRoutes(ctx);
 return{paths,queries,intents,verifier:()=>module.exports.createCallingCallbackVerifier(ctx)};
}
async function invoke(fn,body){
 const res={statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;},type(){return this;},send(body){this.body=body;}};
 await fn({params:{id,action:'audio',turn:'0'},body},res,error=>{throw error;});return res;
}
test('forged callback JSON and direct worker requests cannot reach owned rows without native proof',async()=>{
 const fx=routes(true),body={verified:true,authority:'forged',CallSid:sid};
 assert.equal((await invoke(fx.paths.get('/run/:id/:action/:turn'),body)).statusCode,403);
 assert.equal((await invoke(fx.paths.get('/work/:id/:turn'),body)).statusCode,403);
 assert.deepEqual(fx.intents.map(x=>x.name),['calling.callback.verify','calling.audio.work']);
 assert.equal(fx.queries.length,0);
 await assert.rejects(fx.verifier()(),/native_callback_entry_required/);
 assert.equal(routes(false).paths.has('/work/:id/:turn'),false);
});
