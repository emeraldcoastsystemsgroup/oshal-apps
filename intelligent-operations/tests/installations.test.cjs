/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Guard monitored installations (Roger, 2026-11-03: "i dont see any proof that the dev droplet is being monitored") through real SQL, the real percolator, the real router and a real browser: a heartbeat is proof of life and never an event, its readings reach the card, the charts' history, the telemetry banks and the topology, an installation that goes quiet raises InstallationSilent exactly once and clears on the next report, a gap in the schedule itself blames nobody, what is firing follows the alerts, and the page says all of it in words without depending on hover. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {fixture,loadExperience,dependency,root}=require('./fixtures/intake.cjs'),{engineFixture}=require('./fixtures/detection.cjs');
const {hash}=require('../routes/intake.js'),{publishPolicy}=require('../routes/pipeline.js'),{processingConfig,saveProcessingConfig}=require('../routes/processing-worker.js');
const {saveIngestMapping,ingestAlertmanager,watchInstallations,stopWatching,clearNotices}=require('../routes/ingest.js');
const {readingsOf,assess,installationRecords,SILENT_MS,LATE_MS}=require('../routes/installations.js');
const {readGraph}=require('../routes/topology-store.js'),{telemetryWindow,streamRecords}=require('../routes/telemetry-store.js');

const READINGS={host:'droplet-1',site_url:'https://example.test/health',site_up:'1',site_seconds:'0.25',kernel_up:'1',postgres_up:'1',pg_connections:'9',pg_bytes:'2500000000',containers:'kernel=1 postgres=1 account-runtime=1 ',restarts:'0',disk_used:'50',memory_used:'40',cpu_used:'12',load5:'0.5',cpus:'2',boot_seconds:'86400',http_rate:'3.5',http_errors:'0',backup_age_hours:'5',backup_bytes:'50000000',offsite_age_hours:'6',offsite_bytes:'50000000',reboot_required:'0',security_updates:'0',updates_pending:'0',facts_age_seconds:'20',targets:'kernel=1 node=1 postgres=1 site=1 '};
const beat=(extra={},status='firing')=>({status,labels:{alertname:'InstallationHeartbeat',severity:'heartbeat',instance:'gsq-test',installation:'gsq-test'},annotations:{summary:"This installation's monitoring is alive",...READINGS,...extra},startsAt:'2026-11-03T10:00:00Z',endsAt:'0001-01-01T00:00:00Z',fingerprint:'beat000000000001'});
const alert=(name,fingerprint,status='firing',extra={})=>({status,labels:{alertname:name,severity:'critical',instance:'gsq-test',...extra},annotations:{summary:name+' summary',description:'detail'},startsAt:'2026-11-03T10:05:00Z',endsAt:status==='resolved'?'2026-11-03T10:15:00Z':'0001-01-01T00:00:00Z',fingerprint});
const T0=Date.parse('2026-11-03T12:00:00Z'),MIN=60000;

async function setup(owner='alice'){
 const f=await fixture(),pool=f.caller(owner),source=loadExperience().sourceDefinition({name:'gsq-test',environment:'gsq-test',source:'urn:operations:source:gsq-test'}),sources=[source];
 await saveIngestMapping(pool,owner,{sourceId:source.id,resourceKind:'host',idLabel:'instance',scope:'gsq-test'},sources);
 return {f,pool,owner,source,sources,send:(alerts,at=T0)=>ingestAlertmanager(pool,owner,sources,source.id,{alerts},()=>at),view:async(at=T0,days=1)=>(await installationRecords(pool,owner,sources,days,()=>at))[0],deliveries:async()=>(await pool.query('SELECT record FROM operations_deliveries WHERE user_sub=$1',[owner])).rows.map(r=>r.record),close:()=>f.close()};
}
const check=(view,id)=>view.checks.find(c=>c.id===id);

test('readings are known keys and finite numbers; a malformed value is absent and never invented',()=>{
 const r=readingsOf({site_up:'1',site_seconds:'NaN',disk_used:'+Inf',memory_used:'',cpu_used:'1.5e+01',load5:7,unknown_key:'3',containers:'kernel=1 postgres=0 __proto__=1 constructor=0 bad/name=1 ok=2',targets:'site=0',host:'h'.repeat(300),site_url:'https://example.test/health?x=1'});
 assert.deepEqual(r.values,{site_up:1,cpu_used:15,containers_running:1});
 assert.deepEqual(r.containers,{kernel:1,postgres:0});assert.equal(Object.getPrototypeOf(r.containers),Object.prototype,'a hostile name cannot replace the prototype');
 assert.deepEqual(r.targets,{site:0});assert.equal(r.host.length,128);assert.equal(r.url,'https://example.test','the origin only');
 assert.equal(readingsOf({site_url:'javascript:alert(1)'}).url,null);assert.deepEqual(readingsOf(null).values,{});assert.deepEqual(readingsOf(['x']).values,{});
});
test('the checks use the droplet rules\' own thresholds and say what they saw',()=>{
 const of=extra=>assess(readingsOf({...READINGS,...extra}));
 const fine=of({});assert.equal(fine.health,'healthy');assert.ok(fine.checks.every(c=>c.state==='ok'),JSON.stringify(fine.checks));
 assert.equal(fine.checks.find(c=>c.id==='containers').reading,'3 of 3 running: kernel, postgres, account-runtime');assert.equal(fine.checks.find(c=>c.id==='site').reading,'Answers in 0.25 s');assert.match(fine.checks.find(c=>c.id==='postgres').reading,/9 connections, 2\.5 GB/);
 const state=(id,extra)=>of(extra).checks.find(c=>c.id===id).state;
 assert.equal(state('site',{site_up:'0'}),'bad');assert.equal(state('site',{site_seconds:'3.5'}),'warn');assert.equal(state('kernel',{kernel_up:'0'}),'bad');assert.equal(state('postgres',{postgres_up:'0'}),'bad');
 assert.equal(state('disk',{disk_used:'80'}),'ok');assert.equal(state('disk',{disk_used:'85'}),'warn');assert.equal(state('disk',{disk_used:'91'}),'bad');assert.equal(state('memory',{memory_used:'96'}),'bad');assert.equal(state('processor',{load5:'5'}),'warn');
 assert.equal(state('backup',{backup_age_hours:'27'}),'bad');assert.equal(state('backup',{backup_bytes:'1000'}),'bad');assert.equal(state('offsite',{offsite_age_hours:'27'}),'bad');assert.equal(state('updates',{reboot_required:'1'}),'warn');assert.equal(state('updates',{security_updates:'4'}),'warn');
 const stopped=of({containers:'kernel=0 postgres=1 '});assert.equal(stopped.health,'degraded');assert.equal(stopped.checks.find(c=>c.id==='containers').reading,'kernel not running; 1 of 2 running');
 assert.match(of({facts_age_seconds:'900'}).checks.find(c=>c.id==='containers').reading,/15 min old/);assert.equal(of({facts_age_seconds:'900'}).checks.find(c=>c.id==='containers').state,'warn');
 assert.equal(of({disk_used:'85'}).health,'healthy','a warning is not a degraded host');
 const none=assess(readingsOf({}));assert.equal(none.checks.find(c=>c.id==='site').reading,'Not reported');assert.equal(none.checks.find(c=>c.id==='backup').state,'bad','no backup ever reported is a problem, as BackupMissing says');
});
test('a heartbeat is proof of life, never an event, and its readings reach the card, the history, the banks and the topology',async()=>{
 const x=await setup();
 try{
  const first=await x.send([beat()]);
  assert.equal(first.received,1);assert.equal(first.admitted,0);assert.deepEqual(first.results,[]);assert.equal(first.heartbeat.recorded,true);assert.equal(first.heartbeat.health,'healthy');assert.equal(first.heartbeat.feedError,undefined);
  assert.equal((await x.deliveries()).length,0,'the ledger of events stays the ledger of events');
  await x.send([beat({site_seconds:'0.75'})],T0+MIN);
  const v=await x.view(T0+MIN+30000);
  assert.equal(v.state,'reporting');assert.equal(v.reports,2);assert.equal(v.ageSeconds,30);assert.equal(v.lastHeardAt,new Date(T0+MIN).toISOString());assert.equal(v.firstHeardAt,new Date(T0).toISOString());assert.equal(v.host,'droplet-1');assert.equal(v.url,'https://example.test');assert.equal(v.health,'healthy');
  assert.equal(check(v,'site').reading,'Answers in 0.75 s','the card reads the newest report');
  const points=v.history.series.site_seconds;assert.equal(points.length,1,'both reports fall in one 15-minute point');assert.deepEqual(points[0],[T0,0.5,0.25,0.75],'time, average, low and high');assert.equal(v.history.bucketMinutes,15);
  const window=await telemetryWindow(x.pool,x.owner,x.source.id,{kind:'host',scope:'gsq-test',id:'gsq-test'},new Date(T0+MIN).toISOString());
  assert.equal(window.observations.length,16,'eight readings a report: a 15-minute evidence window holds 120 of its 200');assert.ok(window.observations.some(o=>o.name==='host.disk.used'&&o.value===50));assert.ok(window.observations.some(o=>o.name==='host.containers.running'&&o.value===3));
  assert.equal((await streamRecords(x.pool,x.owner)).streams.length,1,'the stream configured itself on the first report');
  const graph=await readGraph(x.pool,x.owner,new Date(T0+MIN).toISOString()),host=graph.assets.find(a=>a.kind==='host');
  assert.equal(host.name,'gsq-test');assert.equal(host.health,'healthy');assert.equal(host.provider,'import');assert.equal(host.nativeId,'gsq-test');assert.equal(host.properties.hostName,'droplet-1');assert.equal(host.properties.publicAddress,'https://example.test');
  assert.deepEqual(graph.assets.filter(a=>a.kind==='container').map(a=>a.name).sort(),['account-runtime','kernel','postgres']);assert.equal(graph.relationships.filter(e=>e.type==='RUNS_ON'&&e.to===host.id&&e.resolved).length,3,'its containers run on it');
  const scans=async()=>(await x.pool.query('SELECT id FROM operations_topology_scans WHERE user_sub=$1',[x.owner])).rows.length;
  assert.equal(await scans(),1,'an unchanged report writes no new scan');
  await x.send([beat({containers:'kernel=0 postgres=1 account-runtime=1 '})],T0+2*MIN);assert.equal(await scans(),2,'a change is a scan at once');
  const stopped=await readGraph(x.pool,x.owner,new Date(T0+2*MIN).toISOString());assert.equal(stopped.assets.find(a=>a.kind==='host').health,'degraded');assert.equal(stopped.assets.find(a=>a.name==='kernel').health,'degraded');assert.equal(stopped.assets.find(a=>a.name==='postgres').health,'healthy');
  await x.send([beat()],T0+3*MIN);assert.equal(await scans(),3);await x.send([beat()],T0+4*MIN);assert.equal(await scans(),3);await x.send([beat()],T0+3*MIN+3600000);assert.equal(await scans(),4,'and otherwise every ten minutes, under the 15 minutes Topology and correlation call stale');
  await x.pool.query("UPDATE operations_topology_scans SET observed_at=$2 WHERE user_sub=$1 AND collection_id='installation:gsq-test' AND observed_at=$3",[x.owner,new Date(T0-8*86400000).toISOString(),new Date(T0).toISOString()]);
  await x.send([beat({containers:'kernel=0 postgres=1 account-runtime=1 '})],T0+4*MIN+3600000);assert.equal(await scans(),4,'a scan older than two days is pruned, so the 20,000-scan budget is never reached');
  assert.deepEqual(await installationRecords(x.f.caller('bob'),'bob',x.sources,1,()=>T0),[],'another person reads none of it');
 }finally{await x.close();}
});
test('a full bank never makes a live droplet look dead',async()=>{
 const x=await setup();
 try{
  await x.send([beat()]);
  const held=(await x.pool.query('SELECT record FROM operations_streams WHERE user_sub=$1 AND id=$2',[x.owner,x.source.id])).rows[0].record;
  held.banks.forEach(b=>Object.assign(b,{count:b.capacityRecords,newest:new Date(T0+5*MIN).toISOString()}));held.config.maxBankRecords=held.config.initialBankRecords;held.config.autoGrow=false;
  await x.pool.query('UPDATE operations_streams SET record=$3 WHERE user_sub=$1 AND id=$2',[x.owner,x.source.id,JSON.stringify(held)]);
  const refused=await x.send([beat()],T0+MIN);assert.equal(refused.heartbeat.recorded,true);assert.match(refused.heartbeat.feedError,/clock moved backwards|protected context/);
  const v=await x.view(T0+MIN);assert.equal(v.state,'reporting');assert.equal(v.reports,2);assert.match(v.feedError,/clock moved backwards|protected context/,'the card says so');
 }finally{await x.close();}
});
test('what is firing follows the alerts: a repeat refreshes, a resolve clears, an alert nobody repeated for nine hours falls off',async()=>{
 const x=await setup();
 try{
  const sent=await x.send([alert('DiskHigh','disk0001'),alert('ContainerMissing','cont0001',undefined,{service:'kernel'})]);assert.equal(sent.admitted,2);
  let v=await x.view();assert.equal(v.state,'never','alerts without a heartbeat are not proof of life');assert.equal(v.reports,0);assert.equal(v.health,'unknown');
  assert.deepEqual(v.firing.map(a=>a.alertType).sort(),['ContainerMissing','DiskHigh']);assert.equal(v.firing.find(a=>a.alertType==='ContainerMissing').service,'kernel');assert.equal(v.firing[0].severity,'critical');assert.match(v.firing[0].deliveryId,/^[a-f0-9]{64}$/);assert.equal(v.firing.find(a=>a.alertType==='DiskHigh').summary,'DiskHigh summary');
  await x.send([alert('ContainerMissing','cont0001','resolved',{service:'kernel'})],T0+MIN);v=await x.view(T0+MIN);assert.deepEqual(v.firing.map(a=>a.alertType),['DiskHigh']);
  await x.send([alert('DiskHigh','disk0001')],T0+4*3600000);assert.equal((await x.view(T0+12*3600000)).firing.length,1,'the 4-hour repeat keeps it');assert.equal((await x.view(T0+14*3600000)).firing.length,0,'nine hours without a repeat drops it');
  await x.send([beat()],T0+MIN);v=await x.view(T0+MIN);assert.equal(v.state,'reporting');assert.equal(v.firing.length,1,'the heartbeat keeps what is firing');
 }finally{await x.close();}
});
test('an installation that goes quiet raises InstallationSilent once, and the next report clears it',async()=>{
 const x=await setup();
 try{
  const watch=at=>watchInstallations(x.pool,x.owner,x.sources,()=>at);
  assert.deepEqual((await watch(T0)).silenced,[],'never heard: nothing to miss');
  await x.send([beat()],T0);
  for(let m=1;m<10;m++)assert.deepEqual((await watch(T0+m*MIN)).silenced,[],'minute '+m);
  assert.equal((await x.view(T0+LATE_MS-1)).state,'reporting');assert.equal((await x.view(T0+LATE_MS)).state,'late');assert.equal((await x.view(T0+SILENT_MS)).state,'silent','the card does not wait for the tick');
  assert.equal((await x.deliveries()).length,0);
  const raised=await watch(T0+10*MIN);assert.deepEqual(raised.silenced,['gsq-test']);
  const [delivery]=await x.deliveries();assert.equal(delivery.decision,'validated');assert.equal(delivery.normalized.data.alertType,'InstallationSilent');assert.equal(delivery.normalized.data.severity,'critical');assert.equal(delivery.normalized.data.status,'firing');assert.deepEqual(delivery.normalized.data.resource,{kind:'host',scope:'gsq-test',id:'gsq-test'});assert.equal(delivery.normalized.time,new Date(T0).toISOString(),'it starts at the last report, so its evidence window holds the readings before the silence');
  assert.match(raised.notices[0].text,/gsq-test has stopped reporting: Operations last heard from it 10 minutes ago/);
  const again=await watch(T0+11*MIN);assert.deepEqual(again.silenced,[],'once');assert.equal((await x.deliveries()).length,1);assert.equal(again.notices.length,1,'the notice stays until the rail took it');
  await clearNotices(x.pool,x.owner,x.source.id,again.notices.map(n=>n.id));assert.equal((await watch(T0+12*MIN)).notices.length,0);
  let v=await x.view(T0+12*MIN);assert.equal(v.state,'silent');assert.equal(v.health,'unknown');assert.equal(v.silentSince,new Date(T0).toISOString());assert.equal((await readGraph(x.pool,x.owner,new Date(T0+12*MIN).toISOString())).assets.find(a=>a.kind==='host').health,'unknown','Systems does not call a silent host healthy');
  const back=await x.send([beat()],T0+14*MIN);assert.equal(back.heartbeat.silence.minutes,14);
  const resolved=(await x.deliveries()).find(d=>d.normalized.data.status==='resolved');assert.equal(resolved.normalized.data.alertType,'InstallationSilent');assert.equal(resolved.normalized.time,new Date(T0+14*MIN-1).toISOString(),'just before the beat that ended it, so a second silence right after is a new occurrence');
  v=await x.view(T0+14*MIN);assert.equal(v.state,'reporting');assert.equal(v.silentSince,null);assert.equal(v.health,'healthy');
  const told=await watch(T0+15*MIN);assert.match(told.notices[0].text,/gsq-test is reporting again after 14 minutes of silence/);await clearNotices(x.pool,x.owner,x.source.id,told.notices.map(n=>n.id));
  for(let m=16;m<24;m++)await watch(T0+m*MIN);
  assert.deepEqual((await watch(T0+24*MIN)).silenced,['gsq-test'],'a second silence is its own occurrence');assert.equal((await x.deliveries()).filter(d=>d.normalized.data.status==='firing').length,2);
 }finally{await x.close();}
});
test('a gap in the schedule itself blames nobody: this Spark was not listening',async()=>{
 const x=await setup();
 try{
  const watch=at=>watchInstallations(x.pool,x.owner,x.sources,()=>at);
  await x.send([beat()],T0);await watch(T0+MIN);
  const after=await watch(T0+40*MIN);assert.deepEqual(after.silenced,[],'the first tick after a restart raises nothing');assert.equal(after.graceUntil,new Date(T0+50*MIN).toISOString());
  assert.deepEqual((await watch(T0+41*MIN)).silenced,[]);
  await x.send([beat()],T0+41*MIN+30000);for(let m=42;m<50;m++)assert.deepEqual((await watch(T0+m*MIN)).silenced,[],'a droplet that reported again was never silent');
  for(let m=50;m<52;m++)await watch(T0+m*MIN);assert.deepEqual((await watch(T0+52*MIN)).silenced,['gsq-test'],'after the grace a real silence is called');
 }finally{await x.close();}
});
test('an ended heartbeat is not a report, and Operations remembers what the Alertmanager said',async()=>{
 const x=await setup();
 try{
  await x.send([beat()],T0);const ended=await x.send([beat({},'resolved')],T0+5*MIN);assert.equal(ended.heartbeat.recorded,false);
  const v=await x.view(T0+5*MIN);assert.equal(v.reports,1);assert.equal(v.lastHeardAt,new Date(T0).toISOString());assert.equal(v.heartbeatEndedAt,new Date(T0+5*MIN).toISOString());
  await x.send([beat()],T0+6*MIN);assert.equal((await x.view(T0+6*MIN)).heartbeatEndedAt,null);
 }finally{await x.close();}
});
test('stopping the watch forgets a retired installation and resolves its silence; a server still running comes back',async()=>{
 const x=await setup();
 try{
  await x.send([beat()],T0);for(let m=1;m<=10;m++)await watchInstallations(x.pool,x.owner,x.sources,()=>T0+m*MIN);assert.equal((await x.view(T0+10*MIN)).state,'silent');
  assert.deepEqual(await stopWatching(x.pool,x.owner,x.sources,x.source.id,()=>T0+11*MIN),{forgotten:true,sourceId:x.source.id});
  assert.equal(await x.view(T0+11*MIN),undefined);assert.ok((await x.deliveries()).some(d=>d.normalized.data.status==='resolved'),'its symptom does not stand forever');
  assert.equal((await x.pool.query("SELECT count(*)::int AS n FROM operations_processing_config WHERE user_sub=$1 AND id LIKE 'installation-day:%'",[x.owner])).rows[0].n,0,'its history goes too');
  assert.deepEqual((await readGraph(x.pool,x.owner,new Date(T0+12*MIN).toISOString())).assets,[],'its host leaves Systems');assert.deepEqual((await streamRecords(x.pool,x.owner)).streams,[],'its readings leave the banks');
  assert.equal((await telemetryWindow(x.pool,x.owner,x.source.id,{kind:'host',scope:'gsq-test',id:'gsq-test'},new Date(T0).toISOString()).catch(e=>e.status)),404);
  assert.deepEqual((await watchInstallations(x.pool,x.owner,x.sources,()=>T0+40*MIN)).silenced,[]);
  await assert.rejects(stopWatching(x.f.caller('bob'),'bob',[],x.source.id),e=>e.status===404,'another person cannot');
  await x.send([beat()],T0+41*MIN);assert.equal((await x.view(T0+41*MIN)).reports,1);
 }finally{await x.close();}
});
test('history keeps fourteen days and the chart range reads about 96 points whichever it shows',async()=>{
 const x=await setup();
 try{
  for(let d=20;d>=0;d--)await x.send([beat({disk_used:String(50+d)})],T0-d*86400000);
  const ids=(await x.pool.query("SELECT id FROM operations_processing_config WHERE user_sub=$1 AND id LIKE 'installation-day:%'",[x.owner])).rows.map(r=>r.id);assert.ok(ids.length<=15,'older days are deleted: '+ids.length);
  const week=await x.view(T0,7);assert.equal(week.history.days,7);assert.equal(week.history.bucketMinutes,105);assert.equal(week.history.series.disk_used.length,8,'seven days back and today');assert.equal(week.history.series.disk_used.at(-1)[1],50);
  assert.equal((await x.view(T0,1)).history.series.disk_used.length,2);assert.equal((await x.view(T0,99)).history.days,1,'an unknown range is the default');
  assert.deepEqual((await x.view(T0,14)).history.series.disk_used.map(p=>p[0]).slice().sort((a,b)=>a-b),(await x.view(T0,14)).history.series.disk_used.map(p=>p[0]),'in time order');
 }finally{await x.close();}
});
test('through the real router and percolator: the tick raises the silence, evaluates it in the same tick, and names it on the person\'s phone',async()=>{
 const f=await fixture(),e=await engineFixture(),owner='watch-'+randomUUID(),pool=f.caller(owner),express=dependency('express'),app=express(),told=[];
 let server,index;
 try{
  const source=loadExperience().sourceDefinition({name:'gsq-test',environment:'gsq-test',source:'urn:operations:source:gsq-test'}),rules=['InstallationSilent','ContainerMissing'].map(name=>({name,enabled:true,capture:false,query:{term:{alertType:name}}}));
  const published=await publishPolicy(pool,e.engine,owner,source,{name:'checks',rules,window:{mode:'sliding',seconds:900}},0);index='ops-rules-'+hash(['detection-owner-v1',owner])+'-'+published.policy.id;
  await saveIngestMapping(pool,owner,{sourceId:source.id,resourceKind:'host',idLabel:'instance',scope:'gsq-test'},[source]);
  await saveProcessingConfig(pool,owner,{enabled:true,sourceIds:[source.id],batchSize:10,maxAttempts:3,retrySeconds:10,expectedRevision:(await processingConfig(pool,owner)).revision},[source.id]);
  app.use((req,_res,next)=>{req.oidc={user:{sub:owner}};next();});
  app.use('/api/intelligent-operations',loadExperience().createOperationsExperienceRoutes({appPackageDir:root,pool,intent:e.intent,notify:async(topic,message)=>{told.push([topic,message]);return {sent:true};},authorization:{registerResource(){}},store:{query:async name=>name==='sources'?[source]:[],put:async()=>{}}}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/api/intelligent-operations';
  const post=async(p,body)=>{const r=await fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status<300,true,await r.clone().text());return r.json();};
  const delivered=await post('/ingest/alertmanager/'+source.id,{alerts:[{...beat(),startsAt:new Date().toISOString()}]});assert.equal(delivered.heartbeat.recorded,true);
  let read=await (await fetch(base+'/telemetry')).json();assert.equal(read.installations.length,1,'GET /telemetry carries the installations');assert.equal(read.installations[0].state,'reporting');assert.ok(Array.isArray(read.streams),'and the streams it always did');
  const quiet=await post('/pipeline/process',{});assert.deepEqual(quiet.watch.silenced,[]);assert.equal(told.length,0,'a healthy tick tells nobody');
  const key='installation:'+source.id,row=(await pool.query('SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id=$2',[owner,key])).rows[0].record;
  await pool.query('UPDATE operations_processing_config SET record=$3 WHERE user_sub=$1 AND id=$2',[owner,key,JSON.stringify({...row,lastHeardAt:new Date(Date.now()-11*MIN).toISOString()})]);
  const tick=await post('/pipeline/process',{});assert.deepEqual(tick.watch.silenced,['gsq-test']);assert.ok(tick.results.some(r=>r.outcome==='admitted'),'evaluated in the same tick: '+JSON.stringify(tick.results));
  assert.deepEqual(told.map(t=>t[0]),['operations-attention'],'one message, not two within two seconds');assert.match(told[0][1],/has stopped reporting: Operations last heard from it 11 minutes ago/,'the notice: nothing after the watch can hold it up');assert.equal(tick.notices.sent,1);
  told.length=0;const next=await post('/pipeline/process',{});assert.equal(next.notices.requested,0,'a sent notice is not sent again');assert.equal(told.length,0);
  read=await (await fetch(base+'/telemetry?days=7')).json();assert.equal(read.installations[0].state,'silent');assert.equal(read.installations[0].history.days,7);
  await post('/ingest/alertmanager/'+source.id,{alerts:[{...alert('ContainerMissing','cont0002'),startsAt:new Date().toISOString()}]});const named=await post('/pipeline/process',{});assert.ok(named.results.length);assert.match(told[0][1],/\[critical\] ContainerMissing on gsq-test: ContainerMissing summary/);
  assert.deepEqual(await post('/ingest/mapping',{stopWatching:true,sourceId:source.id}),{forgotten:true,sourceId:source.id},'stopping the watch rides the mapping route');
  read=await (await fetch(base+'/telemetry')).json();assert.deepEqual(read.installations,[]);
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await e.close();await f.close();if(index)await fetch(process.env.OSHAL_TEST_SEARCH+'/'+index,{method:'DELETE'});}
});
test('every route this needs is already bound, so delivering it suspends nobody',()=>{
 const yaml=dependency('js-yaml'),catalog=yaml.load(require('node:fs').readFileSync(path.join(root,'authorization.yaml'),'utf8')),http=catalog.bindings.http;
 for(const [method,route]of [['GET','/telemetry'],['POST','/ingest/alertmanager/:sourceId'],['POST','/ingest/mapping'],['POST','/pipeline/process']])assert.ok(http.some(b=>b.method===method&&b.path===route),method+' '+route+' has its binding');
});
