/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | ADR-216 S2 (1.7.0): an OpenTelemetry Collector is no longer refused. Prepare answers /ingest/otlp/<id> with the label '<name> otel' and the same host mapping, policy and processing; the same name enrolled again with a collector keeps its source. The kernel's client.name, the name the server suggested, is bounded and decides nothing. The manifest declares both prefixes and the OTLP route rides records.write. Red on 1.6.0: otel answered 409 and the manifest declared only /ingest/alertmanager/. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | ADR-216 S1 (1.6.0): the enrolment prepare route POST /installations/enroll, which the kernel runs as the approving person, through the real router, real SQL with forced owner policies, the real percolator on the disposable search and a store per person. It creates the source (urn:operations:source:<name>, environment <name>), the Alertmanager mapping, the policy whose rule lists moved here from the kernel's ops/monitoring/wire_producer.py (CRITICAL and WARNING, pinned below) and a first processing configuration, records what the server said it is, and answers the ingest route under the declared prefix. The same name again reuses the source with its history and keeps an edited policy; a removed source is never reused (its route stays gone); a processing schedule the person switched off stays off and only gains the source; a full processing list, the detection engine down, a malformed name or client and an OpenTelemetry agent are refused before anything is written. The manifest's producers.enroll and the route's binding are pinned to what the kernel validates. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {fixture,dependency,root,loadExperience}=require('./fixtures/intake.cjs'),{engineFixture}=require('./fixtures/detection.cjs');
const {processingConfig}=require('../routes/processing-worker.js');
const yaml=dependency('js-yaml');
const API='/api/intelligent-operations',OPEN='/cockpit/?app=intelligent-operations&screen=operations-estate';
/** The rule lists of oshal-kernel ops/monitoring/wire_producer.py:63-67 (c88ef9c3), whose single copy is now routes/enroll.js. */
const CRITICAL=['SiteDown','KernelMetricsUnreachable','ContainerMissing','ContainerRestarting','ContainerOutOfMemory','DiskFull','MemoryLow','PostgresDown','BackupMissing','BackupSmall','OffsiteCopyMissing','MonitoringBlind','PrometheusCannotStore','SlotDown','TunnelDown','InstallationSilent'];
const WARNING=['SiteSlow','KernelRefusalStorm','DiskHigh','LoadHigh','RebootRequired','SecurityUpdatesPending','ContainerFactsStale','EngineLinkStale','GpuThermal'];
/** The kernel's producer_route_is_valid (crates/control/src/producer_tokens.rs) and the declared prefix test of producer_enrollments.rs under_prefix. */
const kernelTakes=(route,prefixes)=>route.length<=256&&/^\/ingest\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(route)&&prefixes.some(p=>route.length>p.length&&route.startsWith(p));
const client={host:'web-1',platform:'linux',agent:'prometheus',version:'0.1.0'};
const beat=scope=>({status:'firing',labels:{alertname:'InstallationHeartbeat',severity:'heartbeat',instance:scope},annotations:{summary:"This installation's monitoring is alive",host:scope,site_up:'1',disk_used:'40'},startsAt:new Date(Date.now()-60000).toISOString(),endsAt:'0001-01-01T00:00:00Z',fingerprint:'beat000000000001'});

/** One person's Operations over the real routes, real SQL and the real percolator; the engine relay and the person's document store are the named seams. */
async function world(run){
 const f=await fixture(),e=await engineFixture(),owner='enrol-'+randomUUID(),pool=f.caller(owner),express=dependency('express'),app=express(),rail={engineDown:false},collections=new Map(),publishes=[];let server;
 const store={async query(name){return [...(collections.get(name)||new Map()).values()].map(v=>structuredClone(v));},async put(name,id,value){if(!collections.has(name))collections.set(name,new Map());collections.get(name).set(id,structuredClone(value));}};
 const intent=(name,input)=>{if(rail.engineDown)throw Error('connection refused');if(input?.request?.cmd==='publish')publishes.push(input.request.args.revision);return e.intent(name,input);};
 const ctx={appPackageDir:root,pool,intent,authorization:{registerResource(){}},store,notify:async()=>({sent:true})};
 try{
  app.use((req,_res,next)=>{req.oidc={user:{sub:owner}};next();});app.use(API,loadExperience().createOperationsExperienceRoutes(ctx));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+API;
  const call=async(p,body,headers={})=>{const r=await fetch(base+p,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json().catch(()=>null)};};
  // The kernel posts {name, client} with x-oshal-trigger: enroll (producer_enrollments.rs prepare).
  const enrol=(name,said=client)=>call('/installations/enroll',{name,client:said},{'x-oshal-trigger':'enroll'});
  const saved=async()=>(await store.query('sources'));
  const counts=async()=>Object.fromEntries(await Promise.all(['operations_policies','operations_policy_bindings'].map(async t=>[t,(await f.inspect.query('SELECT count(*)::int AS n FROM '+t+' WHERE user_sub=$1',[owner])).rows[0].n])));
  await run({f,owner,pool,call,enrol,saved,store,rail,counts,publishes,define:loadExperience().sourceDefinition});
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await e.close();await f.close();}
}
const idOf=answer=>answer.route.split('/').pop();

test('prepare sets up a new installation as wire_producer.py did and answers the one ingest route the kernel will mint a token for',async()=>world(async({call,enrol,saved,store,pool,owner,f,define})=>{
 const first=await enrol('web-1');
 assert.equal(first.status,200,JSON.stringify(first.body));
 const id=idOf(first.body);
 assert.deepEqual(first.body,{route:'/ingest/alertmanager/'+id,label:'web-1 alertmanager',name:'web-1',open:OPEN,sourceId:id,created:true,mapping:'saved',policy:'published',processing:{listed:true,enabled:true,firstConfiguration:true}});
 assert.ok(kernelTakes(first.body.route,['/ingest/alertmanager/']),'the kernel accepts the answered route under the declared prefix');
 const [source]=await saved();
 assert.deepEqual([source.name,source.source,source.environment],['web-1','urn:operations:source:web-1','web-1']);
 assert.equal(source.id,define({name:'web-1',source:'urn:operations:source:web-1',environment:'web-1'}).id,'the same id Sources and wire_producer.py give this definition');
 const mapping=(await call('/ingest/mapping/'+id)).body;
 assert.deepEqual([mapping.resourceKind,mapping.idLabel,mapping.scope,mapping.severityLabel,mapping.environment],['host','instance','web-1','severity','web-1']);
 const pipeline=(await call('/pipeline')).body,binding=pipeline.bindings.find(b=>b.sourceId===id),policy=pipeline.policies.find(p=>p.id===binding.policyId);
 assert.equal(policy.name,'web-1 checks');assert.deepEqual(policy.window,{mode:'sliding',seconds:900});
 assert.deepEqual(policy.rules.filter(r=>r.capture).map(r=>r.name).sort(),CRITICAL.slice().sort(),'a critical alert is a symptom with a captured snapshot');
 assert.deepEqual(policy.rules.filter(r=>!r.capture).map(r=>r.name).sort(),WARNING.slice().sort(),'a warning is recorded only');
 assert.ok(policy.rules.every(r=>r.enabled&&r.query.term.alertType===r.name),'one enabled term rule per alert type');
 const config=await processingConfig(pool,owner);
 assert.deepEqual([config.enabled,config.sourceIds,config.captureEvidence,config.correlate,config.autoInvestigate,config.revision],[true,[id],true,true,true,1],'a first configuration turns the whole chain on');
 const [kept]=await store.query('enrollments');
 assert.deepEqual({...kept,preparedAt:undefined,firstPreparedAt:undefined},{sourceId:id,name:'web-1',agent:'prometheus',platform:'linux',host:'web-1',version:'0.1.0',preparedAt:undefined,firstPreparedAt:undefined});
 assert.ok(Number.isFinite(Date.parse(kept.preparedAt))&&kept.firstPreparedAt===kept.preparedAt);
 assert.deepEqual((await call('/telemetry')).body.enrollments.map(e=>[e.sourceId,e.agent,e.host]),[[id,'prometheus','web-1']],'Systems reads what the server said it is');
 const delivered=await call('/ingest/alertmanager/'+id,{alerts:[beat('web-1')]});
 assert.equal(delivered.status,202,JSON.stringify(delivered.body));
 assert.equal((await f.inspect.query("SELECT count(*)::int AS n FROM operations_processing_config WHERE user_sub=$1 AND id=$2",[owner,'installation:'+id])).rows[0].n,1,'its first report is an installation');
}));

test('the same name again reuses the source with its history, and keeps the mapping, an edited policy and processing as they are',async()=>world(async({call,enrol,saved,pool,owner,counts,publishes})=>{
 const first=(await enrol('web-1')).body,id=idOf(first);
 assert.equal((await call('/ingest/alertmanager/'+id,{alerts:[beat('web-1')]})).status,202);
 const before=(await call('/telemetry')).body.installations.find(i=>i.sourceId===id);assert.equal(before.reports,1);
 // The person edits the policy on Data pipeline: SiteSlow becomes a captured symptom.
 const pipeline=(await call('/pipeline')).body,bound=pipeline.policies.find(p=>p.id===pipeline.bindings[0].policyId);
 const edited=await call('/pipeline/policies',{sourceId:id,policy:{name:bound.name,window:bound.window,rules:bound.rules.map(r=>({name:r.name,enabled:r.enabled,capture:r.name==='SiteSlow'?true:r.capture,query:r.query}))},expectedRevision:1});
 assert.equal(edited.status,200,JSON.stringify(edited.body));
 const configBefore=await processingConfig(pool,owner),countsBefore=await counts(),published=publishes.length;
 const again=await enrol('web-1',{...client,host:'web-1b',version:'0.2.0'});
 assert.equal(again.status,200,JSON.stringify(again.body));
 assert.deepEqual([again.body.route,again.body.created,again.body.mapping,again.body.policy],[first.route,false,'kept','kept'],'the same route: the kernel retires the older token on it');
 assert.equal((await saved()).length,1,'no second source');
 assert.equal(publishes.length,published,'nothing published again');assert.deepEqual(await counts(),countsBefore);
 const binding=(await call('/pipeline')).body.bindings.find(b=>b.sourceId===id);assert.equal(binding.revision,2,'the edited policy stays active');
 assert.deepEqual(await processingConfig(pool,owner),configBefore,'processing unchanged: the source is already listed');
 const after=(await call('/telemetry')).body,row=after.installations.find(i=>i.sourceId===id);
 assert.deepEqual([row.reports,row.firstHeardAt],[1,before.firstHeardAt],'its history stays');
 const kept=after.enrollments.find(e=>e.sourceId===id);assert.deepEqual([kept.host,kept.version],['web-1b','0.2.0'],'the latest account of the server');assert.ok(kept.firstPreparedAt<=kept.preparedAt);
}));

test('a removed source is never reused: its name gets a new source with its own route, and the removed one stays gone',async()=>world(async({call,enrol,saved})=>{
 const removedId=idOf((await enrol('web-2')).body);
 assert.equal((await call('/sources/remove',{sourceId:removedId,confirm:true})).body.removed,true);
 const fresh=await enrol('web-2');
 assert.equal(fresh.status,200,JSON.stringify(fresh.body));
 const freshId=idOf(fresh.body);
 assert.notEqual(freshId,removedId,'a removed source keeps its own tokens dead');assert.match(freshId,/^[a-f0-9]{64}$/);assert.equal(fresh.body.created,true);
 const all=await saved();
 assert.ok(all.find(s=>s.id===removedId).discardedAt,'the removed one stays removed');
 assert.deepEqual((await call('/records')).body.sources.map(s=>[s.id,s.name,s.source]),[[freshId,'web-2','urn:operations:source:web-2']]);
 assert.equal((await call('/ingest/alertmanager/'+removedId,{alerts:[beat('web-2')]})).status,410);
 assert.equal((await call('/ingest/alertmanager/'+freshId,{alerts:[beat('web-2')]})).status,202);
 assert.equal(idOf((await enrol('web-2')).body),freshId,'the new one is reused from then on');
 assert.deepEqual((await call('/telemetry')).body.enrollments.map(e=>e.sourceId),[freshId],'a removed source\'s enrolment is not shown');
}));

test('a processing schedule the person switched off stays off; the source only joins its list',async()=>world(async({call,enrol,pool,owner})=>{
 const first=idOf((await enrol('base')).body),on=await processingConfig(pool,owner);
 const off=await call('/pipeline/processing-config',{enabled:false,captureEvidence:false,sourceIds:[first],batchSize:4,maxAttempts:3,retrySeconds:60,correlate:false,autoInvestigate:false,expectedRevision:on.revision});
 assert.equal(off.status,200,JSON.stringify(off.body));
 const second=await enrol('web-3');
 assert.equal(second.status,200,JSON.stringify(second.body));assert.deepEqual(second.body.processing,{listed:true,enabled:false,firstConfiguration:false});
 const now=await processingConfig(pool,owner),id=idOf(second.body);
 assert.deepEqual([now.enabled,now.captureEvidence,now.correlate,now.autoInvestigate,now.batchSize,now.maxAttempts,now.retrySeconds],[false,false,false,false,4,3,60],'every saved choice is kept');
 assert.deepEqual(now.sourceIds,[first,id].sort());assert.equal(now.revision,off.body.revision+1);
}));

test('refusals write nothing: a malformed name or client, a full processing list and the engine down',async()=>world(async({call,enrol,saved,store,rail,f,owner,counts})=>{
 for(const [body,status,words] of [
  [{name:'',client},400,/1 to 80/],[{name:'x'.repeat(81),client},400,/1 to 80/],[{name:'café',client},400,/plain characters/],[{name:' web-1',client},400,/1 to 80/],[{name:'web\u0007',client},400,/plain characters/],
  [{name:'web-1',client,extra:1},400,/name and client/],[{name:'web-1',client:{...client,agent:'telnet'}},400,/agent/],[{name:'web-1',client:{...client,host:'a b'}},400,/host/],[{name:'web-1',client:'web-1'},400,/client/],
  [{name:'web-1',client:{...client,name:'x'.repeat(81)}},400,/client name/],
 ]){const r=await call('/installations/enroll',body);assert.equal(r.status,status,JSON.stringify(body));assert.match(r.body.error,words,JSON.stringify(r.body));}
 // A processing list already holding 32 sources (the configuration's own limit) cannot take one more.
 const full=Array.from({length:32},(_,i)=>String(i).padStart(64,'a'));
 await f.inspect.query("INSERT INTO operations_processing_config(user_sub,id,revision,record) VALUES($1,'worker',1,$2)",[owner,JSON.stringify({enabled:false,captureEvidence:false,sourceIds:full,batchSize:10,maxAttempts:8,retrySeconds:30,revision:1})]);
 const crowded=await enrol('web-4');assert.equal(crowded.status,409);assert.match(crowded.body.error,/32 sources/);
 await f.inspect.query("DELETE FROM operations_processing_config WHERE user_sub=$1 AND id='worker'",[owner]);
 rail.engineDown=true;
 const down=await enrol('web-5');assert.equal(down.status,503);assert.match(down.body.error,/detection engine/);
 assert.deepEqual(await saved(),[],'no source');assert.deepEqual(await store.query('enrollments'),[],'no enrolment');
 assert.deepEqual(await counts(),{operations_policies:0,operations_policy_bindings:0},'no policy');
 assert.equal((await f.inspect.query("SELECT count(*)::int AS n FROM operations_processing_config WHERE user_sub=$1",[owner])).rows[0].n,0,'no mapping and no processing configuration');
 rail.engineDown=false;assert.equal((await enrol('web-5')).status,200,'pressing again once the engine is back completes it');
}));

test('a long or spaced name fits the kernel\'s 80-character label, and a client-less offline enrolment is taken',async()=>world(async({enrol,call,saved})=>{
 const long='n'.repeat(80),answer=(await enrol(long)).body;
 assert.equal(answer.name,long);assert.ok(answer.label.length<=80&&answer.label.endsWith(' alertmanager'),answer.label);
 const policy=(await call('/pipeline')).body.policies[0];assert.ok(policy.name.length<=80&&policy.name.endsWith(' checks'));
 const spaced=await call('/installations/enroll',{name:'Web server 1',client:null});
 assert.equal(spaced.status,200,JSON.stringify(spaced.body));
 assert.equal((await saved()).find(s=>s.name==='Web server 1').source,'urn:operations:source:Web%20server%201');
 const kept=(await call('/telemetry')).body.enrollments.find(e=>e.name==='Web server 1');assert.deepEqual([kept.agent,kept.host],[null,null],'an offline file says nothing about the server');
 const desk=await call('/installations/enroll',{name:'spark/platform-ops'});assert.equal(desk.status,200,'a desk-shaped name keeps its slash');
 const deskPipeline=(await call('/pipeline')).body,deskPolicy=deskPipeline.policies.find(p=>p.id===deskPipeline.bindings.find(b=>b.sourceId===desk.body.sourceId).policyId);
 assert.deepEqual(deskPolicy.rules.map(r=>r.name).sort(),JSON.parse(fs.readFileSync(path.join(root,'deploy/policy.platform-ops.default.json'),'utf8')).rules.map(r=>r.name).sort(),'a desk\'s own source starts from its desk\'s shipped default, not the enrolment lists');
}));

test('an OpenTelemetry Collector is enrolled to the OTLP route, with the same mapping, policy and processing, and the same name again keeps its source',async()=>world(async({call,enrol,saved,store,pool,owner})=>{
 const otel={...client,agent:'otel',name:'web-otel'},first=await enrol('web-otel',otel);
 assert.equal(first.status,200,JSON.stringify(first.body));
 const id=idOf(first.body);
 assert.deepEqual([first.body.route,first.body.label,first.body.name,first.body.created],['/ingest/otlp/'+id,'web-otel otel','web-otel',true]);
 assert.ok(kernelTakes(first.body.route,['/ingest/alertmanager/','/ingest/otlp/']),'the kernel accepts it under the declared OTLP prefix');
 assert.ok(!kernelTakes(first.body.route,['/ingest/alertmanager/']),'and not under the Alertmanager one');
 const mapping=(await call('/ingest/mapping/'+id)).body;assert.deepEqual([mapping.resourceKind,mapping.idLabel,mapping.scope],['host','instance','web-otel'],'the silence watch and every event read the same host mapping');
 assert.equal((await processingConfig(pool,owner)).sourceIds.includes(id),true);
 assert.equal((await store.query('enrollments')).find(e=>e.sourceId===id).agent,'otel','Systems says it reports through a collector');
 const again=await enrol('web-otel',otel);assert.deepEqual([again.body.route,again.body.created,(await saved()).length],['/ingest/otlp/'+id,false,1],'the same name keeps its source and history');
 const moved=await enrol('web-otel',client);assert.equal(moved.body.route,'/ingest/alertmanager/'+id,'the same source, moved to Prometheus, answers the Alertmanager route');
}));

test('the manifest declares enrolment the way the kernel validates it, and prepare rides records.write, which a reader lacks',()=>{
 const manifest=yaml.load(fs.readFileSync(path.join(root,'oshal-app.yaml'),'utf8')),auth=yaml.load(fs.readFileSync(path.join(root,'authorization.yaml'),'utf8'));
 const enroll=manifest.producers.enroll;
 assert.deepEqual(Object.keys(manifest.producers),['enroll'],'the kernel refuses any other key');assert.deepEqual(Object.keys(enroll).sort(),['action','prepare','routes']);
 assert.equal(enroll.action,'Monitor this installation');assert.ok(enroll.action.length<=40);
 assert.equal(enroll.prepare,'/installations/enroll');assert.match(enroll.prepare,/^(\/[A-Za-z0-9_-]+)+$/);
 assert.deepEqual(enroll.routes,['/ingest/alertmanager/','/ingest/otlp/']);
 for(const prefix of enroll.routes)assert.ok(kernelTakes(prefix+'x',enroll.routes)&&/^\/ingest\/[A-Za-z0-9_-]+\/$/.test(prefix),prefix);
 assert.deepEqual(auth.bindings.http.filter(b=>b.path==='/installations/enroll').map(b=>[b.method,b.allOf]),[['POST',['records.write']]]);
 assert.deepEqual(auth.bindings.http.filter(b=>b.path==='/ingest/otlp/:sourceId').map(b=>[b.method,b.allOf]),[['POST',['records.write']]],'the OTLP route rides the grant the Alertmanager ingest rides');
 assert.match(fs.readFileSync(path.join(root,'routes/experience.js'),'utf8'),/router\.post\('\/ingest\/otlp\/:sourceId'/);
 assert.ok(!auth.roles.reader.grants.some(g=>g.permission==='records.write'),'a reader cannot enrol a server');
 assert.match(fs.readFileSync(path.join(root,'routes/experience.js'),'utf8'),/router\.post\('\/installations\/enroll'/);
});
