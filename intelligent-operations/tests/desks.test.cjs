/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the four desks (spec lanes/monitoring-four-desks-spec-2026-11-08.md) on real SQL and the real percolator: the shipped default policies name exactly the spec's alert types with capture on the critical column only; the processing tick activates the desks for a fresh person (source, mapping, published default policy, processing list and chain on) once, changes nothing on the next tick, keeps a policy the person edited, and leaves a desk pending with the engine down and finishes it when the engine returns; a desk's read says what is firing, what its source reports (including the threshold snapshot a heartbeat carried) and which runbooks are its own; a symptom raised from a desk's source is told on that desk's topic beside operations-attention and a foreign source's is not; rule toggles publish revision-checked; another person sees no desk. */
/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Guard the clean-up the four desks made necessary: a tick for a fresh person publishes the four desk rule indexes on the real test search, and closing the engine fixture deletes every one of them. Each case used to delete only the index it published itself; about 79 desk indexes per full run were left behind and the gate's test search reached its 1000-shard limit on 2026-11-09, failing the Operations step of every store push. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {fixture,dependency,root,loadExperience}=require('./fixtures/intake.cjs'),{engineFixture}=require('./fixtures/detection.cjs');
const {DESKS,deskSource,deskOf,defaultPolicy,activateDesks,deskSummary,saveDeskPolicy}=require('../routes/desks'),{policyDefinition}=require('../routes/pipeline'),{processingTick}=require('../routes/processing-tick'),{processingConfig}=require('../routes/processing-worker'),{saveRunbook}=require('../routes/runbooks'),{hash}=require('../routes/intake');
const SPEC={
 'app-ops':[['PackageScheduleRefused','PackageScheduleMissed','PackageCostDurabilityFailed','PackageInstallFailed'],['PackageErrorBurst','PackageEgressSpike','PackageVersionDrift','PackageScheduleSkipped']],
 'sec-ops':[['SignInFailureBurst','RootTransferred','AdminTierGranted','ProducerTokenIssued','DoorSeatsExhausted','UncommittedCodeInProduction','PlainHttpListenerPresent'],['KernelRefusalStorm','RefusalCodeNew','TokenRevoked','LocationStepUp']],
 'platform-ops':[['SiteDown','KernelMetricsUnreachable','ContainerMissing','ContainerRestarting','ContainerOutOfMemory','DiskFull','MemoryLow','PostgresDown','MonitoringBlind','PrometheusCannotStore','InstallationSilent','SlotDown','TunnelDown'],['SiteSlow','DiskHigh','LoadHigh','RebootRequired','SecurityUpdatesPending','ContainerFactsStale','GpuThermal','EngineLinkStale']],
 'dev-ops':[['ReleaseRolledBack','ReleaseLabelMismatch','ReleaseVerifyFailed'],['ReleasePromoted','TrialBehindDev','DirtyTreeOnHost','PublishGateRed']]};
const iso=ms=>new Date(ms).toISOString();
const alert=(name,fingerprint,{status='firing',startsAt=Date.now(),endsAt=null,severity='critical',instance='spark'}={})=>({status,labels:{alertname:name,severity,instance},annotations:{summary:name+' summary',description:'detail'},startsAt:iso(startsAt),endsAt:endsAt?iso(endsAt):'0001-01-01T00:00:00Z',fingerprint});
const beat=(extra={})=>({status:'firing',labels:{alertname:'InstallationHeartbeat',severity:'heartbeat',instance:'spark'},annotations:{summary:'alive',host:'spark',site_up:'1',site_seconds:'0.2',kernel_up:'1',postgres_up:'1',containers:'kernel=1 postgres=1',disk_used:'74',memory_used:'40',prom_uptime:'900',targets:'site=1 node=1 postgres=1',alerts:'InstallationHeartbeat=1',...extra},startsAt:'2026-11-08T10:00:00Z',endsAt:'0001-01-01T00:00:00Z',fingerprint:'beat000000000001'});

test('the shipped default policies are the spec: one rule per alert type, critical rules capture, warning rules record, a sliding 15-minute window',()=>{
 assert.deepEqual(DESKS.map(d=>d.id),Object.keys(SPEC));
 for(const desk of DESKS){
  const file=path.join(root,'deploy','policy.'+desk.id+'.default.json'),policy=JSON.parse(fs.readFileSync(file,'utf8')),[critical,warning]=SPEC[desk.id];
  assert.deepEqual(desk.critical,critical,desk.id+' critical');assert.deepEqual(desk.warning,warning,desk.id+' warning');
  assert.equal(policy.name,'spark/'+desk.id+' checks');assert.deepEqual(policy.window,{mode:'sliding',seconds:900});
  assert.deepEqual(policy.rules.map(r=>r.name),[...critical,...warning],desk.id+' rule order');
  for(const rule of policy.rules){assert.equal(rule.enabled,true);assert.equal(rule.capture,critical.includes(rule.name),rule.name+' capture');assert.deepEqual(rule.query,{term:{alertType:rule.name}});}
  const sealed=policyDefinition(policy);assert.equal(sealed.rules.length,policy.rules.length,'the pipeline accepts the shipped file as a policy');
  const copy=defaultPolicy(root,desk);copy.rules[0].enabled=false;assert.equal(defaultPolicy(root,desk).rules[0].enabled,true,'a caller cannot change the shipped default');
  assert.equal(desk.uri,'urn:operations:source:spark/'+desk.id);assert.equal(desk.thresholdFile,'~/.local/state/oshal-native/monitoring/'+desk.id+'.json');
 }
 assert.deepEqual(DESKS.map(d=>d.topic),['app-attention','security-attention','platform-attention','release-attention']);
 assert.deepEqual(DESKS.map(d=>d.role),['ops-app','ops-security','ops-platform','ops-release']);
});

/** A person's Operations over the real routes, real SQL and the real percolator, with the store and the rail as named seams. */
async function world(run,{engineDown=false}={}){
 const f=await fixture(),e=await engineFixture(),owner='desk-'+randomUUID(),pool=f.caller(owner),express=dependency('express'),app=express(),told=[],stored=[],rail={engineDown},publishes=[];let server;const indexes=new Set();
 const engineCall=(name,input)=>{if(rail.engineDown)throw Error('connection refused');if(input?.request?.op==='publish'||JSON.stringify(input).includes('"publish"'))publishes.push(input);return e.intent(name,input);};
 const ctx={appPackageDir:root,pool,intent:engineCall,ticketService:{async createTicket(){return {ticketId:randomUUID()};},async getTicket(id){return {ticketId:id,status:'queued'};},async startTicket(){return {status:'queued'};}},notify:async(topic,message)=>{told.push([topic,message]);return {sent:true};},authorization:{registerResource(){}},store:{query:async name=>name==='sources'?stored.slice():[],put:async(collection,id,body)=>{assert.equal(collection,'sources');stored.push({...body,id});}}};
 try{
  app.use((req,_res,next)=>{req.oidc={user:{sub:owner}};next();});
  app.use('/api/intelligent-operations',loadExperience().createOperationsExperienceRoutes(ctx));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/api/intelligent-operations';
  const call=async(p,body,method)=>{const r=await fetch(base+p,{method:method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:String(r.headers.get('content-type')).includes('json')?await r.json():await r.text()};};
  const tick=async()=>{told.length=0;publishes.length=0;const r=await call('/pipeline/process',{});for(const row of await pool.query('SELECT id FROM operations_policies WHERE user_sub=$1',[owner]).then(x=>x.rows))indexes.add('ops-rules-'+hash(['detection-owner-v1',owner])+'-'+row.id);return {...r.body,status:r.status};};
  await run({pool,owner,ctx,e,told,stored,rail,publishes,call,tick,deliver:(sourceId,alerts)=>call('/ingest/alertmanager/'+sourceId,{alerts}),source:id=>deskSource(stored,DESKS.find(d=>d.id===id)),f});
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await e.close();await f.close();for(const index of indexes)await fetch(process.env.OSHAL_TEST_SEARCH+'/'+index,{method:'DELETE'}).catch(()=>{});}
}

test('the first tick activates the four desks for the person it runs as, the next changes nothing, and an edited policy is kept',async()=>world(async({pool,owner,told,stored,tick,ctx,e})=>{
 const first=await tick();
 assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.failed,0,'no evaluation failed');
 assert.deepEqual(first.desks.desks.map(d=>[d.id,d.created,d.mapped,d.policy,d.processing]),DESKS.map((d,i)=>[d.id,true,'saved','published',i?'listed':'listed and turned on']),'the first desk turns the chain on, the rest join the list');
 assert.deepEqual(stored.map(s=>[s.name,s.source,s.environment]),DESKS.map(d=>[d.sourceName,d.uri,d.sourceName]),'four sources, named as the spec names them');
 const config=await processingConfig(pool,owner);assert.equal(config.enabled,true);assert.deepEqual(config.sourceIds,stored.map(s=>s.id).sort());assert.equal(config.captureEvidence,true);assert.equal(config.correlate,true);assert.equal(config.autoInvestigate,true);
 assert.equal((await pool.query('SELECT id FROM operations_policy_bindings WHERE user_sub=$1',[owner])).rows.length,4,'a policy bound to each desk source');
 assert.deepEqual(told,[],'activation tells the phone nothing');
 const again=await tick();
 assert.deepEqual(again.desks.desks.map(d=>[d.id,d.created,d.mapped,d.policy,d.processing]),DESKS.map(d=>[d.id,false,'kept','kept','kept']));
 assert.equal((await pool.query('SELECT id FROM operations_policies WHERE user_sub=$1',[owner])).rows.length,4,'no second policy generation');
 // The person edits Platform Ops: SiteSlow becomes a captured symptom. The tick must not put the default back.
 const platform=DESKS.find(d=>d.id==='platform-ops'),before=await deskSummary(ctx,owner,platform,stored);
 assert.equal(before.rules.revision,1);const rules=before.rules.rules.map(r=>({name:r.name,enabled:r.enabled,capture:r.name==='SiteSlow'?true:r.capture}));
 const saved=await saveDeskPolicy(ctx,e.engine,owner,platform,stored,{rules,expectedRevision:1});assert.equal(saved.binding.revision,2);
 await tick();
 const after=await deskSummary(ctx,owner,platform,stored);assert.equal(after.rules.revision,2);assert.equal(after.rules.rules.find(r=>r.name==='SiteSlow').capture,true,'the edit survives the tick');
 await assert.rejects(saveDeskPolicy(ctx,e.engine,owner,platform,stored,{rules,expectedRevision:1}),e=>e.status===409,'a stale revision is refused');
 const added=await saveDeskPolicy(ctx,e.engine,owner,platform,stored,{rules:[...rules,{name:'BackupMissing',enabled:true,capture:true}],expectedRevision:2});
 assert.ok(added.policy.rules.some(r=>r.name==='BackupMissing'&&r.query.term.alertType==='BackupMissing'),'a new alert type gets the one-term query');
 const restored=await saveDeskPolicy(ctx,e.engine,owner,platform,stored,{restoreDefaults:true,expectedRevision:3});assert.equal(restored.policy.rules.length,21);assert.equal(restored.policy.rules.find(r=>r.name==='SiteSlow').capture,false);
 for(const bad of [{rules:[],expectedRevision:4},{rules:[{name:'',enabled:true,capture:true}],expectedRevision:4},{rules:[{name:'A',enabled:true,capture:true},{name:'A',enabled:true,capture:false}],expectedRevision:4},{rules:[{name:'A',enabled:true,capture:true}],expectedRevision:4,extra:1}])
  await assert.rejects(saveDeskPolicy(ctx,e.engine,owner,platform,stored,bad),e=>e.status===400,JSON.stringify(bad));
 const bob=await deskSummary(ctx,'bob-'+owner,platform,[]);assert.equal(bob.activated,false,'another person has no desk source');
 assert.match(bob.summary,/no source yet/);
 await assert.rejects(saveDeskPolicy(ctx,e.engine,'bob-'+owner,platform,[],{rules,expectedRevision:0}),e=>e.status===409,'no policy without a source');
}));

test('with the engine down a desk stays pending and the tick says so once; when the engine returns the desks finish',async()=>world(async({told,stored,rail,tick,pool,owner})=>{
 const down=await tick();
 assert.equal(down.status,503);assert.ok(down.desks.desks.every(d=>d.created===true&&d.mapped==='saved'&&d.policy==='kept'&&d.error),'sources and mappings exist, the policy waits for the engine: '+JSON.stringify(down.desks));
 assert.equal(stored.length,4);assert.equal((await pool.query('SELECT id FROM operations_policy_bindings WHERE user_sub=$1',[owner])).rows.length,0);
 assert.ok(told.some(([topic,text])=>topic==='operations-attention'&&/desk activation.*could not finish/.test(text)),JSON.stringify(told));
 const still=await tick();assert.equal(still.status,503);assert.deepEqual(told,[],'the same failure is not told again inside its quiet period');
 rail.engineDown=false;
 const up=await tick();assert.equal(up.status,200,JSON.stringify(up));assert.deepEqual(up.desks.desks.map(d=>[d.created,d.mapped,d.policy,d.processing]),DESKS.map((_,i)=>[false,'kept','published',i?'listed':'listed and turned on']));
 assert.equal(stored.length,4,'no second source');
},{engineDown:true}));

test('a desk reads what is firing, what its source reports with the threshold snapshot, and only its own runbooks; a symptom from its source rings its topic beside the umbrella',async()=>world(async({pool,owner,ctx,e,told,stored,tick,deliver,source})=>{
 await tick();
 const platform=DESKS.find(d=>d.id==='platform-ops'),appDesk=DESKS.find(d=>d.id==='app-ops'),p=source('platform-ops'),a=source('app-ops');
 const empty=await deskSummary(ctx,owner,platform,stored);
 assert.equal(empty.activated,true);assert.deepEqual(empty.installations,[]);assert.deepEqual(empty.symptoms,[]);assert.equal(empty.rules.rules.length,21);assert.equal(empty.settings.thresholds,null);assert.equal(empty.settings.topic,'platform-attention');
 assert.equal(empty.settings.thresholdFile,'~/.local/state/oshal-native/monitoring/platform-ops.json');assert.equal(empty.settings.ingestRoute,'/api/intelligent-operations/ingest/alertmanager/'+p.id);assert.equal(empty.settings.notificationsPage,'/cockpit/tools/notify.html');
 assert.match(empty.summary,/^Platform Ops: no critical alert firing; no source has reported yet; 21 of 21 rules on\.$/);
 // A heartbeat with the probe's threshold file: the snapshot is kept, bounded, and a hostile key is dropped.
 const thresholds='{"desk":"platform-ops","version":1,"thresholds":{"disk_used_percent_max":85,"mem_available_gib_min":12},"targets":{"slots":["127.0.0.1:38788"]},"__proto__":{"x":1},"constructor":{"y":2}}';
 const heard=await deliver(p.id,[beat({thresholds,thresholds_file:'/home/x/.local/state/oshal-native/monitoring/platform-ops.json'})]);assert.equal(heard.status,202,JSON.stringify(heard.body));
 const reporting=await deskSummary(ctx,owner,platform,stored);
 assert.equal(reporting.installations.length,1);assert.equal(reporting.installations[0].state,'reporting');assert.equal(reporting.installations[0].name,'spark/platform-ops');
 assert.deepEqual(reporting.settings.thresholds.body,{desk:'platform-ops',version:1,thresholds:{disk_used_percent_max:85,mem_available_gib_min:12},targets:{slots:['127.0.0.1:38788']}});
 assert.equal(reporting.settings.thresholds.file,'/home/x/.local/state/oshal-native/monitoring/platform-ops.json');assert.ok(reporting.settings.lastHeardAt);
 assert.match(reporting.summary,/its source is reporting, heard \d+ seconds ago/);
 const quiet=await deliver(p.id,[beat()]);assert.equal(quiet.status,202);assert.equal((await deskSummary(ctx,owner,platform,stored)).settings.thresholds.file,'/home/x/.local/state/oshal-native/monitoring/platform-ops.json','a beat without the annotation keeps the last snapshot');
 const oversized=await deliver(p.id,[beat({thresholds:JSON.stringify({pad:'x'.repeat(5000)})})]);assert.equal(oversized.status,202);assert.equal((await deskSummary(ctx,owner,platform,stored)).settings.thresholds.body.desk,'platform-ops','an oversized snapshot is ignored, not stored');
 // Runbooks: the desk shows the ones for its alert types only.
 await saveRunbook(pool,owner,{alertType:'SiteDown',markdown:'# Site down\nCheck the tunnel.',expectedRevision:0});await saveRunbook(pool,owner,{alertType:'LabNodeCpuPressure',markdown:'# Lab\nNot a desk alert.',expectedRevision:0});
 assert.deepEqual((await deskSummary(ctx,owner,platform,stored)).runbooks.map(r=>r.alertType),['SiteDown']);assert.deepEqual((await deskSummary(ctx,owner,appDesk,stored)).runbooks,[]);
 // A critical on the platform source: told on operations-attention and platform-attention, with the desk's name leading its message.
 const started=Date.now();const site=await deliver(p.id,[alert('SiteDown','site0001',{startsAt:started})]);assert.equal(site.status,202,JSON.stringify(site.body));
 let result=await tick();assert.equal(result.status,200,JSON.stringify(result));
 assert.deepEqual(told.map(t=>t[0]),['operations-attention','platform-attention'],JSON.stringify(told));
 assert.match(told[0][1],/^Operations attention: \[critical\] SiteDown on spark\/platform-ops: SiteDown summary/);assert.match(told[1][1],/^Platform Ops attention: \[critical\] SiteDown on spark\/platform-ops: SiteDown summary/);
 assert.deepEqual(result.notification.topics,['operations-attention','platform-attention']);
 const firing=await deskSummary(ctx,owner,platform,stored);
 assert.equal(firing.symptoms.length,1);assert.equal(firing.symptoms[0].alertType,'SiteDown');assert.equal(firing.symptoms[0].status,'firing');assert.equal(firing.symptoms[0].severity,'critical');assert.equal(firing.symptoms[0].resourceId,'spark');
 assert.ok(firing.symptoms[0].evidence,'a captured rule reserves evidence');assert.match(firing.summary,/^Platform Ops: 1 critical firing \(SiteDown\)/);
 assert.deepEqual((await deskSummary(ctx,owner,appDesk,stored)).symptoms,[],'the other desk does not show it');
 // A warning on the app desk: recorded as a symptom, nothing on the phone (as the rules say); a critical there rings app-attention.
 const warned=await deliver(a.id,[alert('PackageErrorBurst','burst0001',{severity:'warning'})]);assert.equal(warned.status,202);
 result=await tick();assert.deepEqual(told,[],'a warning stays off every phone');
 assert.equal((await deskSummary(ctx,owner,appDesk,stored)).symptoms.filter(s=>s.severity==='warning').length,1);
 await deliver(a.id,[alert('PackageScheduleRefused','refused0001')]);result=await tick();
 assert.deepEqual(told.map(t=>t[0]),['operations-attention','app-attention']);assert.match(told[1][1],/^App Ops attention: \[critical\] PackageScheduleRefused on spark\/app-ops/);
 // A source that is no desk rings the umbrella only.
 const other=loadExperience().sourceDefinition({name:'droplet',environment:'droplet',source:'urn:operations:source:droplet'});stored.push(other);
 const {publishPolicy}=require('../routes/pipeline'),{saveIngestMapping}=require('../routes/ingest'),{saveProcessingConfig}=require('../routes/processing-worker');
 await saveIngestMapping(pool,owner,{sourceId:other.id,resourceKind:'host',idLabel:'instance',scope:'droplet'},[other]);
 await publishPolicy(pool,e.engine,owner,other,{name:'droplet checks',rules:[{name:'SiteDown',enabled:true,capture:false,query:{term:{alertType:'SiteDown'}}}],window:{mode:'sliding',seconds:900}},0);
 const config=await processingConfig(pool,owner);await saveProcessingConfig(pool,owner,{enabled:true,captureEvidence:true,correlate:true,autoInvestigate:true,batchSize:10,maxAttempts:8,retrySeconds:30,sourceIds:[...config.sourceIds,other.id].sort(),expectedRevision:config.revision},[...config.sourceIds,other.id]);
 await deliver(other.id,[alert('SiteDown','drop0001',{instance:'droplet'})]);result=await tick();
 assert.deepEqual(told.map(t=>t[0]),['operations-attention'],JSON.stringify(told));
 assert.equal(deskOf(stored,other.id),null);assert.equal(deskOf(stored,p.id).id,'platform-ops');
 // The all-clear reaches the desk too.
 await deliver(p.id,[alert('SiteDown','site0001',{status:'resolved',startsAt:started,endsAt:Date.now()})]);result=await tick();
 assert.deepEqual(told.map(t=>t[0]),['operations-attention','platform-attention']);assert.match(told[1][1],/SiteDown on spark\/platform-ops cleared/);
 const cleared=await deskSummary(ctx,owner,platform,stored);assert.equal(cleared.symptoms[0].status,'resolved','a cleared symptom stays in the window, marked cleared');
}));

test('the desk catalog, each desk read and each rule save are served under their own paths',async()=>world(async({call,tick,source})=>{
 const catalog=await call('/desks');assert.equal(catalog.status,200);assert.deepEqual(catalog.body.desks.map(d=>d.id),DESKS.map(d=>d.id));assert.equal(catalog.body.executionAuthorized,false);
 const before=await call('/desks/sec-ops');assert.equal(before.status,200);assert.equal(before.body.activated,false);
 await tick();
 const sec=await call('/desks/sec-ops');assert.equal(sec.body.activated,true);assert.equal(sec.body.settings.sourceId,source('sec-ops').id);assert.equal(sec.body.rules.rules.length,11);
 const refused=await call('/desks/sec-ops/policy',{rules:[{name:'RootTransferred',enabled:false,capture:true}],expectedRevision:0});assert.equal(refused.status,409,'a stale revision is a conflict');
 const saved=await call('/desks/sec-ops/policy',{rules:sec.body.rules.rules.map(r=>({name:r.name,enabled:r.name!=='RootTransferred',capture:r.capture})),expectedRevision:1});assert.equal(saved.status,200,JSON.stringify(saved.body));
 assert.equal((await call('/desks/sec-ops')).body.rules.rules.find(r=>r.name==='RootTransferred').enabled,false);
 assert.equal((await call('/desks/nowhere')).status,404);
}));

test('every rule index the tick published for a fresh person is gone once the engine fixture closes, so a run leaves the shared test search as it found it',async()=>{
 // Before 1.5.0 a case published one index and deleted that one; the tick now publishes four more for the person it runs as.
 const f=await fixture(),e=await engineFixture(),owner='desk-cleanup-'+randomUUID(),pool=f.caller(owner),stored=[],search=process.env.OSHAL_TEST_SEARCH;let closed=false;
 const status=async name=>(await fetch(search+'/'+name,{method:'HEAD'})).status;
 try{
  const ctx={appPackageDir:root,pool,intent:e.intent,store:{query:async name=>name==='sources'?stored.slice():[],put:async(collection,id,body)=>{stored.push({...body,id});}},notify:async()=>({sent:true}),ticketService:{async createTicket(){throw Error('Unexpected ticket');}}};
  const tick=await processingTick(ctx,e.engine,owner,async()=>stored.slice());assert.equal(tick.failed,0,JSON.stringify(tick.body));
  assert.deepEqual(tick.body.desks.desks.map(d=>d.policy),DESKS.map(()=>'published'));
  const names=(await pool.query('SELECT id FROM operations_policies WHERE user_sub=$1',[owner])).rows.map(r=>'ops-rules-'+hash(['detection-owner-v1',owner])+'-'+r.id);
  assert.equal(names.length,4,'one default policy per desk');
  for(const name of names)assert.equal(await status(name),200,name+' is on the test search while the engine is open');
  closed=true;await e.close();
  for(const name of names)assert.equal(await status(name),404,name+' outlived the engine fixture');
 }finally{if(!closed)await e.close();await f.close();}
});
