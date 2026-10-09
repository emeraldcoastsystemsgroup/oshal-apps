/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The durable task and signed carrier lifecycle over a disposable PostgreSQL schema and a loopback fake Twilio API: idempotent starts, refusals before provider IO, owner/issuer isolation, signed callback admission, audio turns, DTMF and speech replies, hold, handoff, cancel, carrier and speech failures, recording cleanup and RLS under a non-superuser role.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Contract cases the suite did not have, for worker restart, owner no-answer and credential confinement. Worker restart: a worker that dies with the create request in flight is replaced by a fresh one (own pool, carrier client and service, tool registered again) that neither redials on retry nor loses the call the carrier placed, and resumes the run at its next turn; a worker that dies while a recording is being interpreted leaves a turn the restarted worker does not claim again and stops at the 90 second processing bound instead of acting on it. Owner no-answer: DialCallStatus no-answer on the handoff leg fails the run as handoff_no-answer, nothing dials the owner again, and a late carrier completed status or a duplicated handoff callback cannot turn it into a success. Credential confinement: across dial, answer, audio download and interpretation, a failing recording delete, handoff, a cancel that hangs up an active call, a failed create whose provider error body echoes the Authorization header, and refusals, the auth token, the SID:token pair and the Basic header value appear in no tool output or error, no callback response, no stored row and no process output (console, stream or file-descriptor writes), while the fake carrier proves the credential was in use on every request.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Move the credential lifecycle into a separate worker process (tests/calling-worker.fixture.cjs) spawned with piped stdio and a fresh temporary working directory. Entry 2 patched only this process's stdout/stderr write and the fs.write/writeSync properties, so a writer bound at module load (`const {writeSync}=require('node:fs')`) and a pino transport writing from a worker thread both leaked the token while the case stayed green. The case now reads the worker's complete stdout and stderr and every file it wrote under that directory, alongside the tool results (over IPC), callback responses and stored rows, and proves both pipes were read through one marker line per stream. The in-process capture helper is removed.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | A worker that fails during startup (for example credentials() throwing) left its calling-worker-* temporary directory behind, because only stop() deleted it and stop() is never reached when startup is refused. spawnWorkerProcess now ends such a worker, waits for it to close, deletes the directory and rethrows; a child 'error' event (failed spawn, send on a closed channel) refuses startup the same way instead of throwing unhandled.
 * -----------------------------------------------------------------------------
 */
'use strict';
const {test,before,after,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict');
const {createHmac,randomUUID}=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{fork}=require('node:child_process');
const express=require('express'),{Pool}=require('pg');
const {CallingService}=require('../routes/service'),{Twilio}=require('../routes/twilio');
const {callbackVerifier}=require('../routes/callback'),{registerCallingTool}=require('../routes/tool'),P=require('../routes/policy');
const dsn=process.env.CALLING_TEST_DATABASE_URL;
const actor={sub:'calling-fixture-owner',issuer:'https://identity.example.test',isActive:true};
const credential={sid:'AC'+'1'.repeat(32),token:'2'.repeat(32)},sid='CA'+'3'.repeat(32),recording='RE'+'4'.repeat(32);
const settings={...P.defaults,enabled:true,consent:true,connectionId:'11111111-1111-4111-8111-111111111111',from:'+12025550101',transferPhone:'+12025550102',publicOrigin:'https://calling.example.test',introduction:'I am the automated calling assistant.',allowedNumbers:['+12025550103']};
const makeTask=()=>({to:'+12025550103',objective:'Reach claims',keywords:['claims'],responses:[{prompt:'say claims',say:'claims'}],idempotencyKey:randomUUID()});
let admin,pool,server,appServer,carrier,calls,tool,requests=[],transcript,transcriptions,failCreate,deleteFails,currentActor,clock,callbackBase,audio;
let ctx,primary,forward,carrierBase;const workerPools=[];
const schema='calling_fixture_'+randomUUID().replaceAll('-','');
async function boot(app){return new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});}
const suiteOptions={skip:!dsn};
before(async()=>{
 if(!dsn)return;
 admin=new Pool({connectionString:dsn,max:1});await admin.query(`CREATE SCHEMA ${schema}`);
 pool=new Pool({connectionString:dsn,max:3,options:`-c search_path=${schema}`});
 await pool.query(fs.readFileSync(path.join(__dirname,'../migrations/001-calling.sql'),'utf8'));
 const mock=express();mock.use(express.urlencoded({extended:false}));
 mock.use((req,res)=>{
  res.set('Connection','close'); // no idle keep-alive socket holds a worker process open after it is told to exit
  const authorized=req.get('authorization')==='Basic '+Buffer.from(credential.sid+':'+credential.token).toString('base64');
  requests.push({method:req.method,path:req.path,body:req.body,authorized});
  assert.equal(authorized,true);
  if(req.path.endsWith('/IncomingPhoneNumbers.json'))return res.json({incoming_phone_numbers:[{phone_number:settings.from,friendly_name:'Fixture',capabilities:{voice:true}}]});
  // A failing create answers with a verbose error body that echoes the request's Authorization header.
  if(req.path.endsWith('/Calls.json'))return failCreate?res.status(500).json({message:'rejected '+req.get('authorization')}):res.json({sid});
  if(req.path.endsWith('.wav'))return res.type('audio/wav').send(audio);
  if(req.method==='DELETE')return res.status(deleteFails?500:204).end();
  if(req.path.endsWith('/'+sid+'.json'))return res.json({sid,status:'completed'});
  return res.status(404).end();
 });server=await boot(mock);
 carrierBase=`http://127.0.0.1:${server.address().port}`;
 forward=(url,opts)=>fetch(carrierBase+new URL(url).pathname+new URL(url).search,opts);
 carrier=new Twilio(credential,forward);
 calls=primary=new CallingService({pool,carrier:async()=>carrier,now:()=>clock,transcribe:async()=>{transcriptions++;return {text:transcript,providerId:'fixture-stt'};}});
 ctx={tools:{register:(name,handler)=>{assert.equal(name,'calling_task');tool=handler;}},authorization:{currentActor:()=>currentActor}};
 registerCallingTool(ctx,calls);
 const verify=callbackVerifier({findRun:async id=>(await pool.query('SELECT * FROM calling_runs WHERE id=$1',[id])).rows[0],carrier:async()=>carrier,asOwner:(_a,fn)=>fn()});
 const app=express();app.use(async(req,res)=>{try{const owner=await verify(req);if(!owner)return res.status(401).end();const parts=req.path.split('/');res.type('text/xml').send(await calls.callback(owner,parts[4],parts[5],Number(parts[6]),req.body));}catch(e){res.status(e.status||500).json({error:e.code||'failed'});}});
 appServer=await boot(app);callbackBase=`http://127.0.0.1:${appServer.address().port}`;
});
beforeEach(async()=>{if(!dsn)return;await pool.query('TRUNCATE calling_settings,calling_runs,calling_turns,calling_events CASCADE');requests=[];transcript='For claims press two.';transcriptions=0;failCreate=false;deleteFails=false;currentActor=actor;clock=Date.now();audio=Buffer.alloc(64);audio.write('RIFF');await calls.save(actor,settings);});
// Undo a simulated restart: the callback route and the registered tool go back to the primary worker.
afterEach(async()=>{if(!dsn)return;calls=primary;registerCallingTool(ctx,primary);await Promise.all(workerPools.splice(0).map(p=>p.end()));});
after(async()=>{if(!dsn)return;await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>appServer.close(r))]);await pool.end();if(!/^calling_fixture_[a-f0-9]{32}$/.test(schema))throw new Error('Unexpected fixture schema');await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
async function callback(id,action,turn=0,extra={},signature=true,target=callbackBase){const pathname=`/api/calling-callbacks/run/${id}/${action}/${turn}`,body={AccountSid:credential.sid,CallSid:sid,...extra};let signed=settings.publicOrigin+pathname;for(const k of Object.keys(body).sort())signed+=k+body[k];return fetch(target+pathname,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Twilio-Signature':signature?createHmac('sha1',credential.token).update(signed).digest('base64'):'invalid'},body:new URLSearchParams(body)});}
async function waitTurn(id,turn=0){for(let i=0;i<4500;i++){const row=(await pool.query('SELECT * FROM calling_turns WHERE run_id=$1 AND turn=$2',[id,turn])).rows[0];if(row?.status==='ready')return row;await new Promise(r=>setTimeout(r,20));}throw new Error('turn timeout');}
async function start(){const r=await tool({operation:'start',...makeTask()});assert.equal((await callback(r.id,'answer')).status,200);return r;}
async function until(check,label){for(let i=0;i<500;i++){if(await check())return;await new Promise(r=>setTimeout(r,20));}throw new Error('timed out waiting for '+label);}
const count=suffix=>requests.filter(x=>x.path.endsWith(suffix)).length;
/**
 * A worker process as the platform starts it after a restart. It shares nothing in memory with the
 * worker that died, only the database and the carrier: its own pool, its own carrier client, its own
 * service, and the package tool registered again. The callback route and `tool` now reach it.
 */
function startWorker({transport=forward,transcribe}={}){
 const workerPool=new Pool({connectionString:dsn,max:2,options:`-c search_path=${schema}`});workerPools.push(workerPool);
 const client=new Twilio(credential,transport),worker={transcriptions:0};
 worker.calls=new CallingService({pool:workerPool,carrier:async()=>client,now:()=>clock,
  transcribe:transcribe||(async()=>{worker.transcriptions++;return {text:transcript,providerId:'fixture-stt'};})});
 calls=worker.calls;registerCallingTool(ctx,worker.calls);
 return worker;
}
test('registered tool launches one durable task and idempotent retries do not redial',suiteOptions,async()=>{const task=makeTask();const [a,b]=await Promise.all([tool({operation:'start',...task}),tool({operation:'start',...task})]);assert.equal(a.id,b.id);assert.equal(requests.filter(r=>r.path.endsWith('/Calls.json')).length,1);assert.equal((await tool({operation:'status',id:a.id})).events.some(e=>e.kind==='carrier_accepted'),true);});
test('same key with different task is refused',suiteOptions,async()=>{const task=makeTask();await calls.start(actor,task);await assert.rejects(calls.start(actor,{...task,objective:'different'}),/idempotency_conflict/);});
test('disabled configuration cannot dial',suiteOptions,async()=>{await calls.save(actor,{...settings,enabled:false});await assert.rejects(calls.start(actor,makeTask()),/calling_disabled/);assert.equal(requests.length,0);});
test('unapproved destination cannot dial',suiteOptions,async()=>{await assert.rejects(calls.start(actor,{...makeTask(),to:'+12025550104'}),/destination_not_allowed/);assert.equal(requests.length,0);});
test('estimated limit refuses a call before provider IO',suiteOptions,async()=>{await calls.save(actor,{...settings,maxCostCents:1});await assert.rejects(calls.start(actor,makeTask()),/estimated_budget_exceeded/);assert.equal(requests.length,0);});
test('a second different active task is refused',suiteOptions,async()=>{await calls.start(actor,makeTask());await assert.rejects(calls.start(actor,makeTask()),/active_call_or_duplicate_request/);assert.equal(requests.filter(r=>r.path.endsWith('/Calls.json')).length,1);});
test('other owners and issuers cannot read or cancel a task',suiteOptions,async()=>{const r=await start();for(const a of [{...actor,sub:'other'},{...actor,issuer:'https://different.example.test'}]){await assert.rejects(calls.report(a,r.id),/task_not_found/);await assert.rejects(calls.cancel(a,r.id),/task_not_found/);}});
test('model cannot supply actor and missing authenticated actor refuses tool',suiteOptions,async()=>{await assert.rejects(tool({operation:'start',...makeTask(),ownerSub:actor.sub}),/invalid_task/);currentActor=undefined;await assert.rejects(tool({operation:'status',id:randomUUID()}),/signed_in_owner_required/);});
test('unsigned, wrong account, wrong call and changed URL callbacks are refused',suiteOptions,async()=>{const r=await start();assert.equal((await callback(r.id,'poll',0,{},false)).status,401);assert.equal((await callback(r.id,'poll',0,{AccountSid:'AC'+'9'.repeat(32)})).status,401);assert.equal((await callback(r.id,'poll',0,{CallSid:'CA'+'9'.repeat(32)})).status,401);assert.equal((await callback(randomUUID(),'poll')).status,401);assert.equal((await callback(r.id,'not-an-action')).status,401);});
test('audio callback downloads actual bytes and emits DTMF once in the next turn',suiteOptions,async()=>{const r=await start();await callback(r.id,'audio',0,{RecordingStatus:'completed',RecordingSid:recording});const turn=await waitTurn(r.id);assert.equal(turn.audio_bytes,audio.length);assert.equal(turn.decision.digits,'2');assert.match(await(await callback(r.id,'poll')).text(),/<Play digits="2"/);assert.match(await(await callback(r.id,'poll')).text(),/recorded\/1/);await callback(r.id,'audio',0,{RecordingStatus:'completed',RecordingSid:recording});assert.equal(transcriptions,1);assert.equal(requests.filter(x=>x.method==='DELETE').length,1);});
test('spoken choice renders a verbal response',suiteOptions,async()=>{const r=await start();transcript='Please say claims.';await callback(r.id,'audio',0,{RecordingStatus:'completed',RecordingSid:recording});await waitTurn(r.id);assert.match(await(await callback(r.id,'poll')).text(),/<Say voice="alice">claims<\/Say>/);});
test('hold audio loops silently and a later clear menu advances',suiteOptions,async()=>{const r=await start();transcript='Please hold. Your call is important.';await callback(r.id,'audio',0,{RecordingStatus:'completed',RecordingSid:recording});await waitTurn(r.id);assert.doesNotMatch(await(await callback(r.id,'poll')).text(),/<Play|<Say|<Dial/);transcript='For claims press three.';await callback(r.id,'audio',1,{RecordingStatus:'completed',RecordingSid:'RE'+'5'.repeat(32)});await waitTurn(r.id,1);assert.match(await(await callback(r.id,'poll',1)).text(),/<Play digits="3"/);});
test('human greeting starts handoff and carrier acceptance alone is not completion',suiteOptions,async()=>{const r=await start();transcript='Hello, my name is Sarah. How can I help you?';await callback(r.id,'audio',0,{RecordingStatus:'completed',RecordingSid:recording});await waitTurn(r.id);assert.match(await(await callback(r.id,'poll')).text(),/<Number>\+12025550102<\/Number>/);assert.equal((await calls.report(actor,r.id)).status,'transferring');await callback(r.id,'transfer',1,{DialCallStatus:'completed'});assert.equal((await calls.report(actor,r.id)).outcome,'handoff_completed');});
test('handoff busy is recorded as failure',suiteOptions,async()=>{const r=await start();await callback(r.id,'transfer',1,{DialCallStatus:'busy'});assert.equal((await calls.report(actor,r.id)).outcome,'handoff_busy');});
test('disabled owner setting terminates an existing session',suiteOptions,async()=>{const r=await start();await calls.save(actor,{...settings,enabled:false});assert.match(await(await callback(r.id,'poll')).text(),/<Hangup/);assert.equal((await calls.report(actor,r.id)).status,'cancelled');});
test('deadline and turn ceilings terminate',suiteOptions,async()=>{const r=await start();clock+=11*60000;assert.match(await(await callback(r.id,'poll')).text(),/<Hangup/);assert.equal((await calls.report(actor,r.id)).status,'expired');});
test('cancel issues one carrier hangup and late callbacks cannot revive it',suiteOptions,async()=>{const r=await start();await tool({operation:'cancel',id:r.id});await tool({operation:'cancel',id:r.id});assert.equal(requests.filter(x=>x.body?.Status==='completed').length,1);await callback(r.id,'status',0,{CallStatus:'completed'});assert.equal((await calls.report(actor,r.id)).status,'cancelled');});
test('ambiguous create result is durable and not automatically retried',suiteOptions,async()=>{failCreate=true;const task=makeTask(),r=await calls.start(actor,task);assert.equal(r.status,'uncertain');await calls.start(actor,task);assert.equal(requests.filter(x=>x.path.endsWith('/Calls.json')).length,1);});
test('speech provider failure stops rather than inventing speech',suiteOptions,async()=>{const r=await start();transcript=undefined;await callback(r.id,'audio',0,{RecordingStatus:'completed',RecordingSid:recording});const t=await waitTurn(r.id);assert.equal(t.decision.kind,'stop');assert.match(await(await callback(r.id,'poll')).text(),/<Hangup/);});
test('recording cleanup failure appears in the durable report',suiteOptions,async()=>{const r=await start();deleteFails=true;await callback(r.id,'audio',0,{RecordingStatus:'completed',RecordingSid:recording});await waitTurn(r.id);for(let i=0;i<100;i++){const report=await calls.report(actor,r.id);if(report.events.some(e=>e.kind==='recording_cleanup_failed'))return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('missing cleanup receipt');});
test('failed recording stops explicitly instead of waiting for the deadline',suiteOptions,async()=>{const r=await start();await callback(r.id,'audio',0,{RecordingStatus:'failed'});assert.match(await(await callback(r.id,'poll')).text(),/<Hangup/);assert.equal((await calls.report(actor,r.id)).outcome,'recording_failed');});

test('a worker restarted with the create request in flight neither redials nor loses the call the carrier placed',suiteOptions,async()=>{
 // The first worker hands the create to the carrier and dies before it can record the call SID.
 startWorker({transport:async(url,opts)=>{const response=await forward(url,opts);return url.endsWith('/Calls.json')?new Promise(()=>{}):response;}});
 const task=makeTask();
 void tool({operation:'start',...task});
 await until(()=>count('/Calls.json')===1,'the carrier create');
 const persisted=(await pool.query('SELECT id,status,call_sid FROM calling_runs WHERE request_key=$1',[task.idempotencyKey])).rows[0];
 assert.equal(persisted.status,'dialing');assert.equal(persisted.call_sid,null);
 const restarted=startWorker();
 const retry=await tool({operation:'start',...task});
 assert.equal(retry.id,persisted.id);assert.equal(retry.status,'dialing');
 await assert.rejects(tool({operation:'start',...makeTask()}),/active_call_or_duplicate_request/);
 assert.equal(count('/Calls.json'),1);
 // The call the carrier placed answers on the restarted worker, which adopts it and runs the next turn.
 assert.equal((await callback(persisted.id,'answer')).status,200);
 assert.equal((await pool.query('SELECT call_sid FROM calling_runs WHERE id=$1',[persisted.id])).rows[0].call_sid,sid);
 await callback(persisted.id,'audio',0,{RecordingStatus:'completed',RecordingSid:recording});await waitTurn(persisted.id);
 const next=await(await callback(persisted.id,'poll')).text();
 assert.match(next,/<Play digits="2"/);assert.match(next,/recorded\/1/);
 assert.equal(restarted.transcriptions,1);assert.equal(transcriptions,0);
 const cancelled=await tool({operation:'cancel',id:persisted.id});
 assert.equal(cancelled.status,'cancelled');
 assert.deepEqual(requests.filter(x=>x.body?.Status==='completed').map(x=>x.path.split('/').pop()),[sid+'.json']);
 assert.equal(count('/Calls.json'),1);
});
test('an audio turn interrupted by a worker restart stops at the processing bound instead of repeating its side effect',suiteOptions,async()=>{
 // The first worker downloads the recording and dies while the speech provider is still working.
 startWorker({transcribe:()=>new Promise(()=>{})});
 const r=await start();
 await callback(r.id,'audio',0,{RecordingStatus:'completed',RecordingSid:recording});
 await until(()=>count('.wav')===1,'the recording download');
 const restarted=startWorker();
 // The carrier retries the recording callback; the restarted worker does not claim the turn again.
 assert.equal((await callback(r.id,'audio',0,{RecordingStatus:'completed',RecordingSid:recording})).status,200);
 const pending=await(await callback(r.id,'poll')).text();
 assert.match(pending,/<Redirect method="POST">[^<]*\/poll\/0<\/Redirect>/);assert.doesNotMatch(pending,/<Play|<Say|<Dial/);
 clock=Date.now()+120000; // past the 90 second processing bound, inside the 10 minute call limit
 const stopped=await(await callback(r.id,'poll')).text();
 assert.match(stopped,/<Hangup\/>/);assert.doesNotMatch(stopped,/<Play|<Say|<Dial/);
 const report=await tool({operation:'status',id:r.id});
 assert.equal(report.status,'failed');assert.equal(report.outcome,'audio_processing_timeout');
 assert.equal(restarted.transcriptions,0);assert.equal(count('.wav'),1);assert.equal(count('/Calls.json'),1);
 await callback(r.id,'status',0,{CallStatus:'completed'});
 assert.equal((await tool({operation:'status',id:r.id})).outcome,'audio_processing_timeout');
});
test('owner no-answer on the handoff leg fails the run and nothing dials the owner again',suiteOptions,async()=>{
 const r=await start();transcript='Hello, my name is Sarah. How can I help you?';
 await callback(r.id,'audio',0,{RecordingStatus:'completed',RecordingSid:recording});await waitTurn(r.id);
 const dial=await(await callback(r.id,'poll')).text();
 assert.match(dial,/<Dial [^>]*action="[^"]*\/transfer\/1"/);assert.match(dial,/<Number>\+12025550102<\/Number>/);
 const missed=await callback(r.id,'transfer',1,{DialCallStatus:'no-answer'});
 assert.equal(missed.status,200);const hangup=await missed.text();
 assert.match(hangup,/<Hangup\/>/);assert.doesNotMatch(hangup,/<Dial|<Number|<Say|<Play/);
 const report=await tool({operation:'status',id:r.id});
 assert.equal(report.status,'failed');assert.equal(report.outcome,'handoff_no-answer');
 // The carrier then completes the parent call and may repeat the handoff callback: neither is a successful handoff.
 await callback(r.id,'status',1,{CallStatus:'completed'});
 assert.doesNotMatch(await(await callback(r.id,'transfer',1,{DialCallStatus:'completed'})).text(),/<Dial/);
 assert.doesNotMatch(await(await callback(r.id,'poll',1)).text(),/<Dial|<Play|<Say/);
 const final=await tool({operation:'status',id:r.id});
 assert.equal(final.status,'failed');assert.equal(final.outcome,'handoff_no-answer');
});
/** Every regular file under a directory, with its path relative to it, for the leak scan of what the worker wrote. */
function filesUnder(dir){
 return fs.readdirSync(dir,{withFileTypes:true,recursive:true}).filter(entry=>entry.isFile()).map(entry=>{
  const file=path.join(entry.parentPath??entry.path,entry.name);
  return {file:path.relative(dir,file),text:fs.readFileSync(file,'utf8')};
 });
}
/**
 * The package code in its own Node process, as a worker runs it (tests/calling-worker.fixture.cjs): piped
 * stdout and stderr, a fresh temporary working directory, the tool reachable over IPC and the callback
 * route on a loopback port. stop() asks it to exit and returns its exit status, everything it printed on
 * either stream and every file it left under that directory.
 */
async function spawnWorkerProcess(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'calling-worker-')),env={...process.env};delete env.NODE_TEST_CONTEXT;
 const child=fork(path.join(__dirname,'calling-worker.fixture.cjs'),[],{cwd:dir,env,execArgv:[],stdio:['ignore','pipe','pipe','ipc']});
 const chunks=[],pending=new Map();let seq=0,refuse;
 child.stdout.on('data',c=>chunks.push(c));child.stderr.on('data',c=>chunks.push(c));
 const closed=new Promise(resolve=>child.once('close',(code,signal)=>{refuse(new Error('worker process ended'));for(const p of pending.values())p.reject(new Error('worker process ended'));resolve({code,signal});}));
 const ready=new Promise((resolve,reject)=>{refuse=reject;child.on('message',m=>{
  if(m.op==='ready')resolve(m.port);
  else if(m.op==='fatal')reject(new Error('worker process failed to start: '+m.message));
  else if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);if(m.op==='result')p.resolve(m.result);else p.reject(Object.assign(new Error(m.error.message),m.error));}
 });});
 child.on('error',e=>refuse(e)); // a failed spawn or a send on a closed channel refuses startup instead of throwing unhandled
 child.send({op:'init',dsn,schema,carrierBase,credential:credential.sid+':'+credential.token,actor,transcript:'Hello, my name is Sarah. How can I help you?'});
 let port;
 try{port=await ready;}
 catch(e){
  // A worker that fails during startup never reaches stop(): end it, wait for it to close, delete its directory.
  if(child.exitCode===null&&child.signalCode===null)child.kill();
  await closed;fs.rmSync(dir,{recursive:true,force:true});
  throw e;
 }
 return {base:`http://127.0.0.1:${port}`,
  tool:input=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});child.send({op:'tool',id,input});}),
  async stop(){
   if(child.connected)child.send({op:'exit'});
   const timer=setTimeout(()=>child.kill(),20000),status=await closed;clearTimeout(timer);
   const files=filesUnder(dir);fs.rmSync(dir,{recursive:true,force:true});
   return {...status,output:Buffer.concat(chunks).toString('utf8'),files};
  }};
}
async function credentialLifecycle(worker,seen){
 const hook=async(id,action,turn=0,extra={})=>{const response=await callback(id,action,turn,extra,true,worker.base),text=await response.text();seen.push(text);assert.equal(response.status,200,action+' callback');return text;};
 const call=async input=>{const result=await worker.tool(input);seen.push(JSON.stringify(result));return result;};
 deleteFails=true;
 const r=await call({operation:'start',...makeTask()});await hook(r.id,'answer');
 await hook(r.id,'audio',0,{RecordingStatus:'completed',RecordingSid:recording});await waitTurn(r.id);
 assert.match(await hook(r.id,'poll'),/<Dial /);
 await hook(r.id,'transfer',1,{DialCallStatus:'no-answer'});
 await until(async()=>(await pool.query("SELECT 1 FROM calling_events WHERE run_id=$1 AND kind='recording_cleanup_failed'",[r.id])).rowCount>0,'the cleanup receipt');
 assert.equal((await call({operation:'status',id:r.id})).outcome,'handoff_no-answer');
 const active=await call({operation:'start',...makeTask()});await hook(active.id,'answer');
 assert.equal((await call({operation:'cancel',id:active.id})).status,'cancelled');
 failCreate=true;
 const uncertain=await call({operation:'start',...makeTask()});
 assert.equal(uncertain.status,'uncertain');assert.equal(uncertain.outcome,'twilio_http_500');
 await call({operation:'cancel',id:uncertain.id});
 for(const input of [{operation:'status',id:randomUUID()},{operation:'start',...makeTask(),to:'+12025550104'},{operation:'cancel',id:r.id,extra:true}]){
  await assert.rejects(worker.tool(input),e=>{seen.push(e.message,String(e.code),String(e.stack));return typeof e.status==='number';});
 }
}
test('the Twilio credential never reaches tool output, callback responses, stored rows, or the worker process output and files',{...suiteOptions,timeout:120000},async()=>{
 const forms={'auth token':credential.token,'SID:token pair':credential.sid+':'+credential.token,
  'Basic header value':Buffer.from(credential.sid+':'+credential.token).toString('base64')};
 const seen=[],worker=await spawnWorkerProcess();let exit;
 try{await credentialLifecycle(worker,seen);}finally{exit=await worker.stop();}
 assert.equal(exit.code,0,'the worker process exits on its own once told to');
 // Both pipes were read: the fixture prints one marker line on each stream.
 assert.match(exit.output,/calling worker stdout open/);assert.match(exit.output,/calling worker stderr open/);
 const rows=[];
 for(const table of ['calling_settings','calling_runs','calling_turns','calling_events'])rows.push(JSON.stringify((await pool.query(`SELECT * FROM ${table}`)).rows));
 // The credential was in use: every carrier request carried it, including the failed create that echoed it back.
 assert.ok(count('/Calls.json')===3 && count('.wav')===1 && requests.some(x=>x.method==='DELETE') && requests.some(x=>x.body?.Status==='completed'));
 assert.ok(requests.every(x=>x.authorized));
 const sources={'tool results and callback responses':seen.join('\n'),'worker stdout and stderr':exit.output,
  'files the worker wrote':exit.files.map(f=>f.file+'\n'+f.text).join('\n'),'stored rows':rows.join('\n')};
 for(const [source,text] of Object.entries(sources))for(const [form,value] of Object.entries(forms))assert.equal(text.includes(value),false,`the ${form} leaked into ${source}`);
});

test('database RLS enforces current subject AND issuer under a non-superuser role',suiteOptions,async()=>{
 const r=await start(),role='calling_role_'+randomUUID().replaceAll('-',''),client=await pool.connect();
 try {
  await client.query('BEGIN');
  await client.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
  await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
  await client.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
  await client.query(`SET LOCAL ROLE ${role}`);
  const identify=(sub,issuer,operator='off')=>client.query("SELECT set_config('oshal.current_sub',$1,true),set_config('oshal.current_issuer',$2,true),set_config('oshal.is_operator',$3,true)",[sub,issuer,operator]);
  for(const [sub,issuer] of [['',''],['other',actor.issuer],[actor.sub,'https://different.example.test']]) {
   await identify(sub,issuer);
   for(const table of ['calling_settings','calling_runs','calling_turns','calling_events'])assert.equal((await client.query(`SELECT * FROM ${table}`)).rowCount,0,table);
   assert.equal((await client.query('UPDATE calling_runs SET outcome=$2 WHERE id=$1',[r.id,'forbidden'])).rowCount,0);
  }
  await identify(actor.sub,actor.issuer);
  for(const table of ['calling_settings','calling_runs','calling_turns','calling_events'])assert.ok((await client.query(`SELECT * FROM ${table}`)).rowCount>0,table);
  await client.query('SAVEPOINT forbidden_insert');
  await assert.rejects(client.query('INSERT INTO calling_settings(owner_sub,owner_issuer,config) VALUES($1,$2,$3)',['other',actor.issuer,{}]),e=>e.code==='42501');
  await client.query('ROLLBACK TO SAVEPOINT forbidden_insert');
  await identify('','','on');assert.equal((await client.query('SELECT * FROM calling_runs')).rowCount,1);
 } finally { await client.query('ROLLBACK');client.release(); }
});

test('registered task through signed mock carrier callbacks and real speech service', {skip:!dsn||!process.env.CALLING_REAL_AUDIO_FIXTURES,timeout:180000},async()=>{
 const {LocalSTTProvider}=require(path.join(process.env.OSHAL_CORE_DIR||'/app','dist/features/voice-providers/providers/local-stt-provider.js'));
 const speech=new LocalSTTProvider({timeoutMs:85000});
 calls.transcribe=(audio,mimeType,options)=>speech.transcribe({audio,mimeType,...options});
 const r=await start(),fixtures=process.env.CALLING_REAL_AUDIO_FIXTURES;
 const sequence=[['MicrosoftDavidDesktop-menu-before.wav',/<Play digits="2"/],['MicrosoftDavidDesktop-speech-choice.wav',/<Say voice="alice">claims/],['MicrosoftDavidDesktop-hold.wav',/<Record/],['silence',/<Record/],['MicrosoftDavidDesktop-human.wav',/<Dial /]];
 for(let turn=0;turn<sequence.length;turn++){
   const [file,expected]=sequence[turn];
   audio=fs.readFileSync(path.join(fixtures,file==='silence'?'MicrosoftDavidDesktop-hold.wav':file));
   if(file==='silence'){let off=12;while(off+8<=audio.length){const length=audio.readUInt32LE(off+4);if(audio.toString('ascii',off,off+4)==='data'){audio.fill(0,off+8,off+8+length);break;}off+=8+length+(length%2);}}
   const recordingSid='RE'+String(turn+5).repeat(32);
   assert.equal((await callback(r.id,'audio',turn,{RecordingStatus:'completed',RecordingSid:recordingSid})).status,200);
   const observed=await waitTurn(r.id,turn);assert.equal(observed.provider,'local-stt');
   const output=await(await callback(r.id,'poll',turn)).text();assert.match(output,expected);
   if(turn===2||turn===3)assert.doesNotMatch(output,/<Play|<Say|<Dial/);
 }
 await callback(r.id,'transfer',5,{DialCallStatus:'completed'});
 const report=await tool({operation:'status',id:r.id});assert.equal(report.outcome,'handoff_completed');
 if(process.env.CALLING_AUDIO_REPORT)fs.writeFileSync(process.env.CALLING_AUDIO_REPORT,JSON.stringify({transport:'mock carrier HTTP',speech:'real local-stt',report},null,2));
});
