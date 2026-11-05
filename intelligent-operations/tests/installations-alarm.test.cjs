/* CHANGE LOG: 4 | maintainer@emeraldcoastsystemsgroup.com | Guard what a fifth review proved (2026-11-04): a blank or unjudgeable list holds, a heartbeat repeated after Prometheus died clears nothing, a resolve evaluated ahead of its firing is still told, the newest undecided rows are named, and a failed read of the mark does not blank it. */
/* CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Guard what a fourth review proved on the real stack (2026-11-04): only the worker's decisions reach the phone, an engine outage still names a critical once, a resolve is believed by what the heartbeat lists from a settled Prometheus, the watch clears what no resolve ever came for, a stop tells nobody anything cleared, a message fits the shortest rail, and each failing step is its own news. */
/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Guard what a third review proved on the real stack (2026-11-04): the phone message is owed until the rail takes it and says the latest word, nothing after the watch can hold up an alarm, a timed-out alert is not a recovery, a blip that becomes an outage gets its evidence, a tick answers in time, and Jarvis says when the watch has stopped. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Guard what an independent review proved about the silence alarm and the message on the phone (2026-11-03), through real SQL, the real percolator and the real router, with the store failing where a real store fails: a failed admit never loses the alarm or its resolve, one report between two silences is still a second occurrence, a resolve evaluated first makes the older firing late, a flap inside the window is told but opens no second packet, a second container is its own symptom, a warning stays off the phone and a critical that clears is told, Jarvis names what is silent and firing, a packet seals a window in a few KB and is bounded in bytes, and stopping the watch leaves nothing behind and nobody else's host gone. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,loadExperience,dependency,root}=require('./fixtures/intake.cjs'),{engineFixture}=require('./fixtures/detection.cjs');
const {hash}=require('../routes/intake.js'),{publishPolicy,promoteRefired}=require('../routes/pipeline.js'),{processingTick,ENGINE_MS}=require('../routes/processing-tick.js'),{processingConfig,saveProcessingConfig,processPending}=require('../routes/processing-worker.js');
const {capturePendingEvidence}=require('../routes/evidence-worker.js'),{prepareInvestigation}=require('../routes/investigations.js');
const {saveIngestMapping,ingestAlertmanager,watchInstallations,stopWatching,clearNotices}=require('../routes/ingest.js');
const {readingsOf,assess,installationRecords,watchStatus}=require('../routes/installations.js'),{attentionSummary,systemsSummary}=require('../routes/attention.js');
const {readGraph}=require('../routes/topology-store.js'),{configureStream,ingestTelemetry}=require('../routes/telemetry-store.js');

const READINGS={host:'droplet-1',site_url:'https://example.test/health',site_up:'1',site_seconds:'0.25',kernel_up:'1',postgres_up:'1',pg_connections:'9',pg_bytes:'2500000000',containers:'kernel=1 postgres=1 account-runtime=1 ',restarts:'0',disk_used:'50',memory_used:'40',cpu_used:'12',load5:'0.5',cpus:'2',boot_seconds:'86400',http_rate:'3.5',http_errors:'0',backup_age_hours:'5',backup_bytes:'50000000',offsite_age_hours:'6',offsite_bytes:'50000000',reboot_required:'0',security_updates:'0',updates_pending:'0',facts_age_seconds:'20',targets:'kernel=1 node=1 postgres=1 site=1 '};
const beat=(extra={},instance='gsq-test')=>({status:'firing',labels:{alertname:'InstallationHeartbeat',severity:'heartbeat',instance},annotations:{summary:'alive',...READINGS,...extra},startsAt:'2026-11-03T10:00:00Z',endsAt:'0001-01-01T00:00:00Z',fingerprint:'beat000000000001'});
const T0=Date.parse('2026-11-03T12:00:00Z'),MIN=60000,iso=ms=>new Date(ms).toISOString();
const alert=(name,fingerprint,{status='firing',startsAt=T0,endsAt=null,severity='critical',service=null}={})=>({status,labels:{alertname:name,severity,instance:'gsq-test',...(service?{service}:{})},annotations:{summary:name+' summary',description:'detail'},startsAt:iso(startsAt),endsAt:endsAt?iso(endsAt):'0001-01-01T00:00:00Z',fingerprint});
const once=pattern=>{let armed=true;return (when,q)=>{if(armed&&when==='before'&&pattern.test(q)){armed=false;throw Object.assign(Error('connection reset'),{code:'08006'});}};};

/** One real owner, source and mapping over disposable SQL; `gate` fails a chosen statement the way a lost store does. */
async function world({rules=[],scope='gsq-test',capture=true,auto=false,window=900}={}){
 const f=await fixture(),owner='alarm-'+randomUUID(),gate={fail:null},seen=[];
 const pool=f.caller(owner,async(when,q,v)=>{if(when==='before')seen.push(q);if(gate.fail)await gate.fail(when,q,v);});
 const source=loadExperience().sourceDefinition({name:'gsq-test',environment:'gsq-test',source:'urn:operations:source:gsq-test'}),sources=[source];
 const e=rules.length?await engineFixture():null;let index=null;
 if(e){const published=await publishPolicy(pool,e.engine,owner,source,{name:'checks',rules:rules.map(name=>({name,enabled:true,capture,query:{term:{alertType:name}}})),window:{mode:'sliding',seconds:window}},0);index='ops-rules-'+hash(['detection-owner-v1',owner])+'-'+published.policy.id;
  await saveProcessingConfig(pool,owner,{enabled:true,captureEvidence:true,autoInvestigate:auto,sourceIds:[source.id],batchSize:10,maxAttempts:8,retrySeconds:30,expectedRevision:(await processingConfig(pool,owner)).revision},[source.id]);}
 await saveIngestMapping(pool,owner,{sourceId:source.id,resourceKind:'host',idLabel:'instance',scope},sources);
 return {f,e,pool,owner,source,sources,gate,seen,
  send:(alerts,at=T0)=>ingestAlertmanager(pool,owner,sources,source.id,{alerts},()=>at),
  watch:at=>watchInstallations(pool,owner,sources,()=>at),
  view:async(at=T0,days=1)=>(await installationRecords(pool,owner,sources,days,()=>at))[0],
  process:at=>processPending(pool,e.engine,owner,()=>at),
  deliveries:async()=>(await pool.query('SELECT record FROM operations_deliveries WHERE user_sub=$1',[owner])).rows.map(r=>r.record),
  decisions:async()=>(await pool.query('SELECT record FROM operations_filter_decisions WHERE user_sub=$1 ORDER BY created_at',[owner])).rows.map(r=>r.record),
  work:async()=>(await pool.query('SELECT record FROM operations_evidence_work WHERE user_sub=$1',[owner])).rows.map(r=>r.record),
  packets:async()=>(await pool.query('SELECT record FROM operations_telemetry_packets WHERE user_sub=$1',[owner])).rows.map(r=>r.record),
  close:async()=>{if(e)await e.close();await f.close();if(index)await fetch(process.env.OSHAL_TEST_SEARCH+'/'+index,{method:'DELETE'}).catch(()=>{});}};
}
/** Report once, then let minutes pass without another report until the tick calls it silent. */
async function goSilent(x,from=T0){await x.send([beat()],from);for(let m=1;m<10;m++)await x.watch(from+m*MIN);return x.watch(from+10*MIN);}
const silences=async(x,status)=>(await x.deliveries()).filter(d=>d.normalized.data.alertType==='InstallationSilent'&&(!status||d.normalized.data.status===status));

test('a failed admit never loses the alarm: the silence stays owed, the person is told regardless, and the next tick raises it',async()=>{
 const x=await world();
 try{
  await x.send([beat()],T0);for(let m=1;m<10;m++)await x.watch(T0+m*MIN);
  x.gate.fail=once(/INSERT INTO operations_deliveries/);
  const failed=await x.watch(T0+10*MIN);x.gate.fail=null;
  assert.deepEqual(failed.silenced,[]);assert.match(failed.errors[0],/gsq-test: connection reset/);assert.equal(failed.notices.length,1,'the notice does not depend on the event');
  assert.equal((await x.view(T0+10*MIN)).state,'silent');assert.equal((await silences(x)).length,0);
  const retried=await x.watch(T0+11*MIN);assert.deepEqual(retried.silenced,['gsq-test'],'raised on the next tick');assert.equal(retried.errors,undefined);
  const [event]=await silences(x,'firing');assert.equal(event.normalized.time,iso(T0),'still the same occurrence');
  assert.deepEqual((await x.watch(T0+12*MIN)).silenced,[],'and once');assert.equal((await silences(x)).length,1);
  const card=await x.view(T0+12*MIN);assert.equal(card.firing[0].alertType,'InstallationSilent','a silent card lists the silence, first');assert.equal(card.firing[0].severity,'critical');assert.equal(card.firing[0].deliveryId,event.id,'and links to its event');
  assert.equal((await readGraph(x.pool,x.owner,iso(T0+12*MIN))).assets.find(a=>a.kind==='host').health,'unknown');
 }finally{await x.close();}
});
test('a failed resolve is owed too: the beat still counts, the next tick settles it, and it is one event',async()=>{
 const x=await world();
 try{
  await goSilent(x);x.gate.fail=once(/INSERT INTO operations_deliveries/);
  const back=await x.send([beat()],T0+14*MIN);x.gate.fail=null;
  assert.equal(back.heartbeat.recorded,true,'the report itself landed');assert.match(back.heartbeat.resolveError,/connection reset/);assert.equal((await x.view(T0+14*MIN)).state,'reporting');assert.equal((await silences(x,'resolved')).length,0);
  await x.watch(T0+15*MIN);const [resolved]=await silences(x,'resolved');assert.equal(resolved.normalized.time,iso(T0+14*MIN-1),'timed by the beat that ended it, not by the retry');
  await x.watch(T0+16*MIN);assert.equal((await silences(x,'resolved')).length,1,'once');
 }finally{await x.close();}
});
test('stopping the watch resolves first, so a failure leaves everything in place for a second press',async()=>{
 const x=await world();
 try{
  await goSilent(x);x.gate.fail=once(/INSERT INTO operations_deliveries/);
  await assert.rejects(stopWatching(x.pool,x.owner,x.sources,x.source.id,()=>T0+11*MIN),/connection reset/);x.gate.fail=null;
  assert.equal((await x.view(T0+11*MIN)).state,'silent','the card is still there');
  assert.deepEqual(await stopWatching(x.pool,x.owner,x.sources,x.source.id,()=>T0+12*MIN),{forgotten:true,sourceId:x.source.id});assert.equal((await silences(x,'resolved')).length,1);assert.equal(await x.view(T0+12*MIN),undefined);
 }finally{await x.close();}
});
test('one report between two silences is still a second occurrence, with its own symptom and evidence',async()=>{
 const x=await world({rules:['InstallationSilent']});
 try{
  await goSilent(x);await x.process(T0+10*MIN);for(let m=11;m<30;m++)await x.watch(T0+m*MIN);
  await x.send([beat()],T0+30*MIN);await x.process(T0+30*MIN+1000);
  for(let m=31;m<40;m++)await x.watch(T0+m*MIN);
  assert.deepEqual((await x.watch(T0+40*MIN)).silenced,['gsq-test']);await x.process(T0+40*MIN);
  assert.deepEqual((await x.decisions()).map(d=>d.reduction.outcome).sort(),['admitted','admitted','source-resolved'],'never late-occurrence');assert.equal((await x.work()).length,2,'two packets to investigate');
  const [resolved]=await silences(x,'resolved'),second=(await silences(x,'firing')).find(d=>d.normalized.time===iso(T0+30*MIN));assert.ok(second);assert.ok(resolved.normalized.time<second.normalized.time,'firing, resolved, firing, strictly in order');
 }finally{await x.close();}
});
test('a resolve evaluated before its firing makes the firing late, and a later outage is still new',async()=>{
 const x=await world({rules:['SiteDown']});
 try{
  await x.send([alert('SiteDown','site0001',{startsAt:T0,status:'firing'})],T0);
  const down=(await x.pool.query('SELECT id FROM operations_processing WHERE user_sub=$1',[x.owner])).rows[0].id;
  await x.pool.query("UPDATE operations_processing SET ready_at=$3 WHERE user_sub=$1 AND id=$2",[x.owner,down,iso(T0+3600000)]);
  await x.send([alert('SiteDown','site0001',{status:'resolved',startsAt:T0,endsAt:T0+5*MIN})],T0+5*MIN);
  await x.process(T0+6*MIN);assert.deepEqual((await x.decisions()).map(d=>d.reduction.outcome),['orphan-resolution']);
  await x.pool.query("UPDATE operations_processing SET ready_at=$3 WHERE user_sub=$1 AND id=$2",[x.owner,down,iso(T0)]);
  await x.process(T0+7*MIN);assert.deepEqual((await x.decisions()).map(d=>d.reduction.outcome).sort(),['late-occurrence','orphan-resolution'],'no symptom opens on a recovered site');assert.equal((await x.work()).length,0);
  await x.send([alert('SiteDown','site0001',{startsAt:T0+60*MIN})],T0+60*MIN);await x.process(T0+60*MIN+1000);assert.equal((await x.work()).length,1,'a real outage later is new');
 }finally{await x.close();}
});
test('a flap inside the window is recorded and told once more, with no second packet; after the window it is new',async()=>{
 const x=await world({rules:['SiteDown']});
 try{
  const cycle=async(minute)=>{await x.send([alert('SiteDown','site0001',{startsAt:T0+minute*MIN})],T0+minute*MIN);const fired=await x.process(T0+minute*MIN+1000);await x.send([alert('SiteDown','site0001',{status:'resolved',startsAt:T0+minute*MIN,endsAt:T0+(minute+1)*MIN})],T0+(minute+1)*MIN);await x.process(T0+(minute+1)*MIN+1000);return fired.results[0].outcome;};
  assert.equal(await cycle(0),'admitted');assert.equal(await cycle(3),'refired');assert.equal(await cycle(6),'refired');assert.equal((await x.work()).length,1,'one packet and one ticket for one flapping alert');
  assert.equal(await cycle(16),'admitted','past the window since the last admission it is a new occurrence');assert.equal((await x.work()).length,2);
 }finally{await x.close();}
});
test('a silent card keeps what was firing and never says nothing is: a dead droplet cannot repeat anything',async()=>{
 const x=await world();
 try{
  await x.send([beat()],T0);await x.send([alert('DiskFull','disk0001',{startsAt:T0})],T0);
  for(let m=1;m<=10;m++)await x.watch(T0+m*MIN);
  const hours=await x.view(T0+10*3600000);assert.equal(hours.state,'silent');assert.deepEqual(hours.firing.map(a=>a.alertType),['InstallationSilent','DiskFull'],'nine hours without a repeat means nothing here');
  await x.send([beat()],T0+10*3600000);const back=await x.view(T0+10*3600000);assert.equal(back.state,'reporting');assert.deepEqual(back.firing,[],'once reporting, the absence of a repeat means something again, and the silence is over');
 }finally{await x.close();}
});
test('a silence notice waits for the rail until the installation recovers; a reporting-again notice expires',async()=>{
 const x=await world();
 try{
  await goSilent(x);
  assert.equal((await x.watch(T0+71*MIN)).notices.length,1,'the rail has been down for over an hour: still owed');assert.match((await x.watch(T0+6*3600000)).notices[0].id,/^silent-/);
  await x.send([beat()],T0+6*3600000+MIN);const told=await x.watch(T0+6*3600000+2*MIN);assert.deepEqual(told.notices.map(n=>n.id.split('-')[0]),['recovered'],'recovery replaces it');
  assert.deepEqual((await x.watch(T0+7*3600000+3*MIN)).notices,[],'and that one expires');
 }finally{await x.close();}
});
test('the silence names the host the heartbeats filed, so its evidence finds it when scope and instance differ',async()=>{
 const x=await world({rules:['InstallationSilent'],scope:'customer'});
 try{
  await x.send([beat({},'droplet-a')],T0);for(let m=1;m<=10;m++)await x.watch(T0+m*MIN);
  const [event]=await silences(x,'firing');assert.deepEqual(event.normalized.data.resource,{kind:'host',scope:'customer',id:'droplet-a'});
  await x.process(T0+10*MIN);await capturePendingEvidence(x.pool,x.owner,()=>T0+10*MIN);const [packet]=await x.packets();assert.equal(packet.inventory.status,'recorded');assert.equal(packet.coverage,'available-observations-only');
 }finally{await x.close();}
});
test('a packet seals a full window in a few KB however many reports repeat, and any window is bounded in bytes',async()=>{
 const x=await world({rules:['ContainerMissing']}),ctx=()=>({pool:x.pool,ticketService:{async createTicket(){return {ticketId:randomUUID()};},async getTicket(){return {status:'queued',ticketType:'intelligent-operations'};}}});
 try{
  for(let m=0;m<15;m++){await x.send([beat()],T0+m*MIN);if(m%2)await x.send([beat()],T0+m*MIN+7000);}
  await x.send([alert('ContainerMissing','cont0001',{startsAt:T0+15*MIN,service:'kernel'})],T0+15*MIN);await x.process(T0+15*MIN+1000);assert.equal((await capturePendingEvidence(x.pool,x.owner,()=>T0+15*MIN+2000)).captured,1);
  const [packet]=await x.packets(),bytes=Buffer.byteLength(JSON.stringify(packet));
  assert.ok(bytes<16*1024,'a few KB, not about 60: '+bytes);assert.equal(packet.truncated,false);
  const disk=packet.observations.find(o=>o.name==='host.disk.used');assert.equal(packet.observations.length,8,'one series per reading');assert.equal(disk.unit,'%');assert.ok(disk.points.length>=15);assert.deepEqual(disk.points[0],[iso(T0),50]);
  assert.equal(packet.observations.some(o=>o.payloadHash||o.resource),false,'the packet names the resource once');
  const prepared=await prepareInvestigation(ctx(),x.owner,packet.id);assert.ok(prepared.startInput.files.find(f=>f.path==='evidence/packet.json').bytes.length<20*1024,'the investigation input has its room back');
  // Long log lines fill any window: the newest that fit are sealed and truncated says so.
  const logs={resourceLogs:[{resource:{attributes:[{key:'host.id',value:{stringValue:'gsq-test'}},{key:'site.id',value:{stringValue:'gsq-test'}}]},scopeLogs:[{logRecords:[]}]}]};
  for(let b=0;b<4;b++){logs.resourceLogs[0].scopeLogs[0].logRecords=Array.from({length:50},(_,i)=>({timeUnixNano:String(BigInt(T0+35*MIN+b*1000+i)*1000000n),body:{stringValue:'line '+b+'-'+i+' '+'x'.repeat(480)},attributes:[{key:'log.record.uid',value:{stringValue:'l'+b+'-'+i}}]}));await ingestTelemetry(x.pool,x.owner,x.source,'otlp-logs',logs,()=>iso(T0+36*MIN+b*1000));}
  await x.send([alert('ContainerMissing','cont0002',{startsAt:T0+40*MIN,service:'postgres'})],T0+40*MIN);await x.process(T0+40*MIN+1000);await capturePendingEvidence(x.pool,x.owner,()=>T0+40*MIN+2000);
  const big=(await x.packets()).find(p=>p.id!==packet.id);assert.ok(Buffer.byteLength(JSON.stringify(big))<=61*1024,'bounded: '+Buffer.byteLength(JSON.stringify(big)));assert.equal(big.truncated,true,'and it says so');assert.ok(big.observations.some(o=>o.signal==='log'&&o.message?.startsWith('line 3-49')),'the newest line stays');
  await prepareInvestigation(ctx(),x.owner,big.id);
 }finally{await x.close();}
});
test('one heartbeat is a bounded number of statements, because each one is a kernel log line',async()=>{
 const x=await world();
 try{
  await x.send([beat()],T0);x.seen.length=0;await x.send([beat()],T0+MIN);
  const statements=x.seen.filter(q=>!['BEGIN','COMMIT','ROLLBACK'].includes(q));assert.ok(statements.length<=22,'was about 45: '+statements.length);
  x.seen.length=0;await x.watch(T0+2*MIN);assert.ok(!x.seen.some(q=>/operations_processing_config SET|INTO operations_deliveries/.test(q)&&!/installation-watch/.test(q))||x.seen.filter(q=>/^UPDATE/.test(q)).length<=1,'a tick that owes nothing writes only its clock');
  const replayed=await ingestTelemetry(x.pool,x.owner,x.source,'otlp-metrics',{resourceMetrics:[{resource:{attributes:[{key:'host.id',value:{stringValue:'gsq-test'}},{key:'site.id',value:{stringValue:'gsq-test'}}]},scopeMetrics:[{metrics:[{name:'host.disk.used',unit:'%',gauge:{dataPoints:[{timeUnixNano:String(BigInt(T0+MIN)*1000000n),asDouble:50}]}}]}]}]},()=>iso(T0+2*MIN));assert.equal(replayed.duplicates,1,'a repeated observation is still recognised');
 }finally{await x.close();}
});
test('stopping the watch leaves no history however old, retention skips nothing after a gap, and two sources on one scope keep their hosts',async()=>{
 const x=await world();
 try{
  const days=async()=>(await x.pool.query("SELECT id FROM operations_processing_config WHERE user_sub=$1 AND id LIKE 'installation-day:%'",[x.owner])).rows.map(r=>r.id);
  for(let d=0;d<15;d++)await x.send([beat()],T0-(60-d)*86400000);assert.equal((await days()).length,15);
  await x.send([beat()],T0-30*86400000);for(let d=29;d>=25;d--)await x.send([beat()],T0-d*86400000);
  assert.ok((await days()).every(id=>id.slice(-10)>=iso(T0-25*86400000-14*86400000).slice(0,10)),'a 21-day outage leaves nothing older behind: '+(await days()).join(' '));
  const second=loadExperience().sourceDefinition({name:'second',environment:'second',source:'urn:operations:source:second'}),both=[x.source,second];
  await saveIngestMapping(x.pool,x.owner,{sourceId:second.id,resourceKind:'host',idLabel:'instance',scope:'gsq-test'},both);
  await ingestAlertmanager(x.pool,x.owner,both,second.id,{alerts:[beat({},'droplet-b')]},()=>T0);await x.send([beat()],T0);
  assert.equal((await readGraph(x.pool,x.owner,iso(T0+MIN))).assets.filter(a=>a.kind==='host').length,2);
  await assert.rejects(stopWatching(x.pool,x.owner,both,x.source.id,()=>T0+MIN),{status:409},'one still reporting is refused, and nothing goes with it');assert.ok((await days()).some(id=>id.includes(x.source.id)));
  await stopWatching(x.pool,x.owner,both,x.source.id,()=>T0+11*MIN);assert.deepEqual(await days().then(d=>d.filter(id=>id.includes(x.source.id))),[],'no day of its history stays');
  assert.deepEqual((await readGraph(x.pool,x.owner,iso(T0+2*MIN))).assets.filter(a=>a.kind==='host').map(a=>a.name),['second'],"the other source's host stays");
 }finally{await x.close();}
});
test('the checks: the droplet\'s own targets are a row, a blind core check is not healthy, a server with no heartbeat claims nothing',async()=>{
 const of=extra=>assess(readingsOf({...READINGS,...extra})),row=(a,id)=>a.checks.find(c=>c.id===id);
 assert.equal(row(of({}),'monitoring').state,'ok');assert.equal(row(of({}),'monitoring').reading,'Reads all 4 of its sources');
 const blind=of({targets:'kernel=1 node=1 postgres=0 site=1 '});assert.equal(row(blind,'monitoring').state,'bad');assert.match(row(blind,'monitoring').reading,/Cannot read postgres: those checks are blind/);assert.equal(blind.health,'degraded');
 const gone=of({site_up:'',site_seconds:''});assert.equal(row(gone,'site').state,'unknown');assert.equal(gone.health,'unknown','an unread site is not a healthy one');
 const offsite=of({offsite_age_hours:'',offsite_bytes:''});assert.equal(row(offsite,'offsite').state,'unknown');assert.equal(row(offsite,'offsite').reading,'Not reported here');assert.equal(offsite.health,'healthy','a droplet that does not hold the copy is not degraded for it');
 assert.equal(row(of({updates_pending:'59',security_updates:'37'}),'updates').reading,'37 security updates, 22 other updates waiting');assert.equal(row(of({updates_pending:'5',security_updates:'0'}),'updates').state,'ok');assert.equal(row(of({updates_pending:'5',security_updates:'0'}),'updates').reading,'5 other updates waiting');
 const x=await world();
 try{
  await x.send([alert('DiskHigh','disk0001',{severity:'warning'})],T0);const never=await x.view(T0);assert.equal(never.state,'never');assert.ok(never.checks.every(c=>c.state==='unknown'&&c.reading==='Not reported'),JSON.stringify(never.checks));assert.equal(never.lateAfterSeconds,180);assert.equal(never.silentAfterSeconds,600);
  assert.equal(never.history.now,T0);assert.equal(never.history.since,T0-86400000);
  assert.deepEqual(await stopWatching(x.pool,x.owner,x.sources,x.source.id,()=>T0),{forgotten:true,sourceId:x.source.id},'and it can be removed');
 }finally{await x.close();}
});
test('Jarvis names what is silent and what critical is firing, and answers a question about the droplet with its standing',async()=>{
 const x=await world();
 try{
  await x.watch(T0);await x.send([beat()],T0);await x.send([alert('ContainerMissing','cont0001',{service:'kernel'})],T0);
  let attention=await attentionSummary(x.pool,x.owner,T0+MIN);assert.match(attention.summary,/1 critical alerts on monitored installations \(ContainerMissing \(kernel\) on gsq-test\)/);assert.equal(attention.items.find(i=>/Critical alerts/.test(i.label)).page,'systems');
  let systems=await systemsSummary(x.pool,x.owner,T0+MIN);assert.match(systems.summary,/^Monitored installations: gsq-test is reporting, heard 60 seconds ago, firing ContainerMissing \(kernel\)\. /);assert.doesNotMatch(systems.summary,/turn it on in Systems/,'not discovery advice about a droplet that is reporting');assert.equal(systems.installations[0].state,'reporting');
  await x.send([alert('ContainerMissing','cont0001',{status:'resolved',endsAt:T0+MIN,service:'kernel'})],T0+MIN);assert.equal((await attentionSummary(x.pool,x.owner,T0+2*MIN)).summary,'Nothing in Operations is waiting on you.','and it clears');
  for(let m=1;m<=10;m++)await x.watch(T0+m*MIN);
  attention=await attentionSummary(x.pool,x.owner,T0+11*MIN);assert.match(attention.summary,/1 monitored installations that stopped reporting \(gsq-test\)/);assert.doesNotMatch(attention.summary,/Nothing in Operations/);
  systems=await systemsSummary(x.pool,x.owner,T0+3*3600000);assert.match(systems.summary,/gsq-test has stopped reporting, last heard 3 hours ago/);
  assert.equal((await attentionSummary(x.f.caller('bob'),'bob',T0+11*MIN)).summary,'Nothing in Operations is waiting on you.','another person reads none of it');
 }finally{await x.close();}
});
test('the watch says when it last ran: heartbeats do not depend on it, so a page can look alive while no alarm can be raised',async()=>{
 const x=await world();
 try{
  assert.deepEqual(await watchStatus(x.pool,x.owner,()=>T0),{lastTickAt:null,ageSeconds:null,overdue:true,graceUntil:null},'never run');
  await x.watch(T0);assert.deepEqual(await watchStatus(x.pool,x.owner,()=>T0+MIN),{lastTickAt:iso(T0),ageSeconds:60,overdue:false,graceUntil:null});assert.equal((await watchStatus(x.pool,x.owner,()=>T0+6*MIN)).overdue,true);
  await x.watch(T0+40*MIN);assert.equal((await watchStatus(x.pool,x.owner,()=>T0+41*MIN)).graceUntil,iso(T0+50*MIN),'after a gap in the schedule it says so');
 }finally{await x.close();}
});

/* The message on the phone, through the real router and percolator. */
async function routed(run,{rules=['SiteDown','ContainerMissing','LoadHigh','InstallationSilent'],capture=false,auto=false}={}){
 const f=await fixture(),e=await engineFixture(),owner='phone-'+randomUUID(),gate={fail:null},pool=f.caller(owner,async(when,q,v)=>{if(gate.fail)await gate.fail(when,q,v);}),express=dependency('express'),app=express(),told=[],rail={down:false},asked=[];let server,index;
 try{
  const source=loadExperience().sourceDefinition({name:'gsq-test',environment:'gsq-test',source:'urn:operations:source:gsq-test'});
  const published=await publishPolicy(pool,e.engine,owner,source,{name:'checks',rules:rules.map(name=>({name,enabled:true,capture:capture&&name!=='LoadHigh',query:{term:{alertType:name}}})),window:{mode:'sliding',seconds:900}},0);index='ops-rules-'+hash(['detection-owner-v1',owner])+'-'+published.policy.id;
  await saveIngestMapping(pool,owner,{sourceId:source.id,resourceKind:'host',idLabel:'instance',scope:'gsq-test'},[source]);
  await saveProcessingConfig(pool,owner,{enabled:true,captureEvidence:capture,autoInvestigate:auto,sourceIds:[source.id],batchSize:10,maxAttempts:3,retrySeconds:10,expectedRevision:(await processingConfig(pool,owner)).revision},[source.id]);
  const tickets=new Map(),ticketService={async createTicket(input){const ticketId=randomUUID();tickets.set(ticketId,{ticketId,ticketType:input.ticketType,status:'queued',revision:0});return {ticketId};},async getTicket(id){return tickets.get(id)||null;},async startTicket(id){const t=tickets.get(id);t.status='running';return {status:'queued',ticket:{...t}};}};
  app.use((req,_res,next)=>{req.oidc={user:{sub:owner}};next();});
  app.use('/api/intelligent-operations',loadExperience().createOperationsExperienceRoutes({appPackageDir:root,pool,intent:(name,input)=>{asked.push(input.timeoutMs);if(rail.engineDown)throw Error('connection refused');return e.intent(name,input);},ticketService,notify:async(topic,message)=>{if(rail.down)throw Error('rail down');told.push(message);return {sent:true};},authorization:{registerResource(){}},store:{query:async name=>name==='sources'?[source]:[],put:async()=>{}}}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/api/intelligent-operations';
  const call=async(p,body)=>{const r=await fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  await run({deliver:alerts=>call('/ingest/alertmanager/'+source.id,{alerts}),tick:async()=>{told.length=0;const r=await call('/pipeline/process',{});return {...r.body,status:r.status};},told,gate,base,pool,owner,source,rail,asked,e,call});
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await e.close();await f.close();if(index)await fetch(process.env.OSHAL_TEST_SEARCH+'/'+index,{method:'DELETE'}).catch(()=>{});}
}
const live=(name,fingerprint,options={})=>alert(name,fingerprint,{startsAt:Date.now(),...options});
test('a warning stays off the phone; a critical is told by name as it fires and as it clears',async()=>routed(async({deliver,tick,told})=>{
 await deliver([live('LoadHigh','load0001',{severity:'warning'})]);let result=await tick();assert.ok(result.results.some(r=>r.outcome==='admitted'),'the pipeline records it');assert.deepEqual(told,[],'the phone does not hear it, as the rules say');
 const started=Date.now();await deliver([live('SiteDown','site0001',{startsAt:started})]);result=await tick();assert.equal(told.length,1);assert.match(told[0],/\[critical\] SiteDown on gsq-test: SiteDown summary/);
 await deliver([alert('SiteDown','site0001',{status:'resolved',startsAt:started,endsAt:started+1000})]);result=await tick();assert.ok(result.results.some(r=>r.outcome==='source-resolved'));assert.equal(told.length,1,'the all-clear');assert.match(told[0],/\[critical\] SiteDown on gsq-test cleared/);
 await deliver([live('SiteDown','site0001',{startsAt:Date.now()+2000})]);result=await tick();assert.ok(result.results.some(r=>r.outcome==='refired'));assert.match(told[0],/\[critical\] SiteDown on gsq-test again: SiteDown summary/,'a re-fire after an all-clear is told, so the last word on the phone is the true one');
}));
test('a second container failing during the first is its own symptom, message and all-clear',async()=>routed(async({deliver,tick,told,pool,owner})=>{
 const started=Date.now();
 await deliver([alert('ContainerMissing','cont0001',{startsAt:started,service:'kernel'})]);await tick();assert.match(told[0],/\[critical\] ContainerMissing \(kernel\) on gsq-test/);
 await deliver([alert('ContainerMissing','cont0002',{startsAt:started+1000,service:'account-runtime'})]);let result=await tick();assert.ok(result.results.some(r=>r.outcome==='admitted'),'not suppressed: '+JSON.stringify(result.results));assert.match(told[0],/\[critical\] ContainerMissing \(account-runtime\) on gsq-test/);
 await deliver([alert('ContainerMissing','cont0001',{status:'resolved',startsAt:started,endsAt:started+2000,service:'kernel'})]);await tick();assert.match(told[0],/ContainerMissing \(kernel\) on gsq-test cleared/);
 const symptoms=(await pool.query('SELECT record FROM operations_symptoms WHERE user_sub=$1',[owner])).rows.map(r=>r.record.status).sort();assert.deepEqual(symptoms,['firing','resolved'],'account-runtime is still down, and its symptom says so');
}));
test('a tick whose only news is an investigation starting sends nothing',async()=>routed(async({deliver,tick,told})=>{
 const started=Date.now();await deliver(['a','b','c'].map((s,i)=>alert('ContainerMissing','cont000'+i,{startsAt:started,service:'svc-'+s})));
 const first=await tick();assert.equal(first.investigation.started,2,'two a tick');assert.equal(told.length,1);assert.match(told[0],/\[critical\] ContainerMissing/);
 const second=await tick();assert.equal(second.investigation.started,1,'the third starts');assert.deepEqual(told,[],'with no nameless message');
},{capture:true,auto:true}));
test('a delivery whose admission failed answers 503, so Alertmanager sends it again, and the retry is one event',async()=>routed(async({deliver,gate,pool,owner})=>{
 const started=Date.now(),down=alert('SiteDown','site0001',{startsAt:started});gate.fail=once(/INSERT INTO operations_deliveries/);
 const failed=await deliver([down]);gate.fail=null;assert.equal(failed.status,503,'a 202 here means no second try for four hours');
 const ok=await deliver([down]);assert.equal(ok.status,202);assert.equal(ok.body.admitted,1);assert.equal((await deliver([down])).body.admitted,0,'a repeat is a retry');
 assert.equal((await pool.query('SELECT id FROM operations_deliveries WHERE user_sub=$1',[owner])).rows.length,1);
}));
test('a tick whose watch failed answers 503, and GET /telemetry says when the watch last ran',async()=>routed(async({deliver,tick,told,gate,base,pool,owner,source})=>{
 const {body:delivered}=await deliver([{...beat(),startsAt:new Date().toISOString()}]);assert.equal(delivered.heartbeat.recorded,true);
 let read=await (await fetch(base+'/telemetry')).json();assert.equal(read.watch.overdue,true,'no tick yet');assert.equal(read.installations[0].lateAfterSeconds,180);
 await tick();read=await (await fetch(base+'/telemetry')).json();assert.equal(read.watch.overdue,false);assert.ok(read.watch.ageSeconds<30);
 const key='installation:'+source.id,row=(await pool.query('SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id=$2',[owner,key])).rows[0].record;
 await pool.query('UPDATE operations_processing_config SET record=$3 WHERE user_sub=$1 AND id=$2',[owner,key,JSON.stringify({...row,lastHeardAt:new Date(Date.now()-11*MIN).toISOString()})]);
 gate.fail=once(/INSERT INTO operations_deliveries/);const failed=await tick();gate.fail=null;assert.equal(failed.status,503);assert.match(failed.watch.errors[0],/connection reset/);assert.match(told.join(' '),/has stopped reporting: Operations last heard/,'the plain notice still goes out');
 const retried=await tick();assert.equal(retried.status,200);assert.deepEqual(retried.watch.silenced,['gsq-test']);assert.ok(retried.results.some(r=>r.outcome==='admitted'),'and the alarm follows, its notice having told the person');assert.deepEqual(told,[]);
 read=await (await fetch(base+'/telemetry')).json();assert.equal(read.installations[0].firing[0].alertType,'InstallationSilent');assert.match(read.installations[0].firing[0].deliveryId,/^[a-f0-9]{64}$/);
}));

/* What a third review proved on the real stack (2026-11-04). */
let uptime=3600;
const listing=(alerts,extra={})=>beat({alerts:'InstallationHeartbeat=1 '+alerts,prom_uptime:String(uptime+=30),targets:'kernel=1 node=1 postgres=1 site=1 prometheus=1',...extra});
const reading=async(pool,owner,id)=>(await pool.query('SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id=$2',[owner,id])).rows[0]?.record;
async function ageRow(pool,owner,source,minutes){const key='installation:'+source.id,row=await reading(pool,owner,key);await pool.query('UPDATE operations_processing_config SET record=$3 WHERE user_sub=$1 AND id=$2',[owner,key,JSON.stringify({...row,lastHeardAt:new Date(Date.now()-minutes*MIN).toISOString()})]);}
test('a phone message that fails is told on the next tick, once',async()=>routed(async({deliver,tick,told,rail})=>{
 const started=Date.now();await deliver([alert('SiteDown','site0001',{startsAt:started})]);rail.down=true;
 const failed=await tick();assert.equal(failed.notification.accepted,false,'the rail threw');assert.deepEqual(told,[]);
 rail.down=false;await tick();assert.equal(told.length,1);assert.match(told[0],/\[critical\] SiteDown on gsq-test: SiteDown summary/);
 await tick();assert.deepEqual(told,[],'told once');
 await deliver([alert('SiteDown','site0001',{status:'resolved',startsAt:started,endsAt:started+1000})]);await tick();assert.match(told[0],/SiteDown on gsq-test cleared/);
 await deliver([alert('SiteDown','site0001',{startsAt:started+2000})]);rail.down=true;await tick();rail.down=false;await tick();assert.match(told[0],/SiteDown on gsq-test again/,"the phone's last word does not stay cleared");
}));
test('a decision a tick never got to tell is told by the next one, with the store failing or the tick ended',async()=>routed(async({deliver,tick,told,gate,pool,owner,e})=>{
 await tick();await deliver([alert('SiteDown','site0001',{startsAt:Date.now()})]);await processPending(pool,e.engine,owner);
 const next=await tick();assert.deepEqual(next.results,[],'nothing left to evaluate');assert.match(told[0],/\[critical\] SiteDown on gsq-test/,'the kernel ended that tick after its decision');
 await deliver([alert('ContainerMissing','cont0001',{startsAt:Date.now(),service:'kernel'})]);gate.fail=once(/FROM operations_deliveries WHERE user_sub=\$1 AND id IN/);
 await tick();gate.fail=null;assert.deepEqual(told.filter(t=>/ContainerMissing/.test(t)),[],'the read that names it failed');
 await tick();assert.match(told.join(' '),/\[critical\] ContainerMissing \(kernel\) on gsq-test/,'and nothing was lost');
}));
test('a catch-up names only the latest word per symptom, so it never ends on cleared while the alert is firing',async()=>routed(async({deliver,tick,told})=>{
 let t=Date.now();
 for(const fingerprint of ['site0001','siteffff','site8888']){
  t+=10000;await deliver([alert('SiteDown',fingerprint,{startsAt:t}),alert('SiteDown',fingerprint,{status:'resolved',startsAt:t,endsAt:t+1000}),alert('SiteDown',fingerprint,{startsAt:t+2000})]);
  await tick();assert.equal(told.length,1);assert.doesNotMatch(told[0],/cleared/,fingerprint);assert.equal(told[0].match(/\[critical\]/g).length,1,told[0]);
  await deliver([alert('SiteDown',fingerprint,{status:'resolved',startsAt:t+2000,endsAt:t+3000})]);await tick();
 }
}));
test('cleared is not said while another alert of that type is on the card',async()=>routed(async({deliver,tick,told})=>{
 const t=Date.now();await deliver([alert('SiteDown','healthbad',{startsAt:t}),alert('SiteDown','loginbad',{startsAt:t})]);await tick();assert.equal(told.length,1);
 await deliver([alert('SiteDown','healthbad',{status:'resolved',startsAt:t,endsAt:t+1000})]);await tick();assert.deepEqual(told,[],'/login is still down');
 await deliver([alert('SiteDown','loginbad',{status:'resolved',startsAt:t,endsAt:t+2000})]);await tick();assert.match(told[0],/SiteDown on gsq-test cleared/);
}));
test('a later step that keeps failing cannot hold up the silence notice or the alarm, and tells the phone once',async()=>routed(async({deliver,tick,told,gate,pool,owner,source})=>{
 await deliver([{...beat(),startsAt:new Date().toISOString()}]);await tick();await ageRow(pool,owner,source,11);
 gate.fail=(when,q)=>{if(when==='before'&&/FROM operations_anomaly_state/.test(q))throw Object.assign(Error('connection reset'),{code:'08006'});};
 const first=await tick();const heard=[...told];assert.equal(first.status,503);assert.equal(first.notices.sent,1);
 assert.match(heard[0],/has stopped reporting/,'the notice first');assert.ok(first.results.some(r=>r.outcome==='admitted'),'evaluation still ran');
 assert.equal(heard.filter(t=>/could not finish/.test(t)).length,1);assert.match(heard.find(t=>/could not finish/.test(t)),/anomaly detection/,'it names the step');
 const again=[];for(let i=0;i<3;i++){assert.equal((await tick()).status,503);again.push(...told);}assert.deepEqual(again,[],'not every minute');
 const mark=await reading(pool,owner,'alerts-told');await pool.query('UPDATE operations_processing_config SET record=$3 WHERE user_sub=$1 AND id=$2',[owner,'alerts-told',JSON.stringify({...mark,failedSteps:{'anomaly detection':new Date(Date.now()-16*MIN).toISOString()}})]);
 await tick();assert.equal(told.filter(t=>/could not finish/.test(t)).length,1,'15 quiet minutes make the next one news');
}));
test('past its time a tick starts nothing new, answers, and the next one carries on; its engine calls are held under the kernel deadline',async()=>routed(async({deliver,tick,told,pool,owner,source,e,asked})=>{
 await tick();const t=Date.now();await deliver(['a','b','c'].map((s,i)=>alert('ContainerMissing','cont000'+i,{startsAt:t,service:'svc-'+s})));
 const slow=async(...a)=>{await new Promise(r=>setTimeout(r,1500));return e.engine(...a);},ctx={pool,notify:async(_,m)=>{told.push(m);return {sent:true};}},read=async()=>[source];
 const first=await processingTick(ctx,slow,owner,read,800);assert.equal(first.failed,0);assert.equal(first.body.evaluated,1);assert.equal(first.body.evidence.deferred,true);assert.equal(first.body.investigation.deferred,true);assert.match(told.join(' '),/ContainerMissing \(svc-/,'what was decided is told');
 const next=await tick();assert.equal(next.evaluated,2,'the rest wait durably');assert.equal(next.status,200);
 assert.ok(asked.length&&asked.every(ms=>ms===ENGINE_MS),'the route gives its engine calls the shorter deadline: '+asked);assert.ok(ENGINE_MS<=25000);
}));
test('when Prometheus dies its timed-out alerts are not a recovery: the card keeps them, the phone says nothing, and the resolve waits until Prometheus has been back long enough',async()=>{
 const x=await world();
 try{
  const site={...alert('SiteDown','site0001',{startsAt:T0}),annotations:{summary:'SiteDown summary'}},resolved={...site,status:'resolved',endsAt:iso(T0+5*MIN)};
  const events=async()=>(await x.deliveries()).filter(d=>d.normalized.data.alertType==='SiteDown'&&d.normalized.data.status==='resolved');
  await x.send([beat()],T0);await x.send([site],T0);
  await x.send([{...beat(),status:'resolved'}],T0+4*MIN);
  const held=await x.send([resolved],T0+6*MIN);assert.equal(held.heldResolves,1);assert.equal(held.admitted,0);assert.equal((await events()).length,0,'nothing to clear on');
  assert.deepEqual((await x.view(T0+7*MIN)).firing.map(a=>a.alertType),['SiteDown']);
  for(let m=7;m<=10;m++)await x.watch(T0+m*MIN);assert.deepEqual((await x.view(T0+11*MIN)).firing.map(a=>a.alertType),['InstallationSilent','SiteDown'],'the silent card keeps what was firing');
  await x.send([beat()],T0+30*MIN);await x.watch(T0+31*MIN);assert.equal((await events()).length,0,'it could still fire again');
  for(let m=32;m<=48;m+=2)await x.send([beat()],T0+m*MIN);await x.send([beat()],T0+49*MIN);await x.watch(T0+49*MIN+30000);assert.equal((await events()).length,0,'not before 20 minutes');
  await x.watch(T0+50*MIN);assert.equal((await events()).length,1,'Prometheus has had long enough: it is cleared');assert.deepEqual((await x.view(T0+50*MIN)).firing.filter(a=>a.alertType==='SiteDown'),[]);
  await x.send([beat()],T0+51*MIN);await x.watch(T0+51*MIN);assert.equal((await events()).length,1,'once');
 }finally{await x.close();}
});
test('a held resolve dies with a re-fire, and a stop admits what is held',async()=>{
 const x=await world();
 try{
  const site={...alert('SiteDown','site0001',{startsAt:T0}),annotations:{summary:'s'}},events=async()=>(await x.deliveries()).filter(d=>d.normalized.data.alertType==='SiteDown'&&d.normalized.data.status==='resolved');
  await x.send([beat()],T0);await x.send([site],T0);await x.send([{...beat(),status:'resolved'}],T0+4*MIN);await x.send([{...site,status:'resolved',endsAt:iso(T0+5*MIN)}],T0+6*MIN);
  await x.send([beat()],T0+8*MIN);await x.send([alert('SiteDown','site0001',{startsAt:T0+8*MIN})],T0+8*MIN);
  for(let m=9;m<=40;m+=2){await x.send([beat()],T0+m*MIN);await x.watch(T0+m*MIN);}assert.equal((await events()).length,0,'it fired again, so it never cleared');assert.equal((await x.view(T0+40*MIN)).firing.filter(a=>a.alertType==='SiteDown').length,1);
  await x.send([{...beat(),status:'resolved'}],T0+44*MIN);await x.send([{...site,startsAt:iso(T0+8*MIN),status:'resolved',endsAt:iso(T0+45*MIN)}],T0+46*MIN);assert.equal((await events()).length,0);
  await stopWatching(x.pool,x.owner,x.sources,x.source.id,()=>T0+60*MIN);assert.equal((await events()).length,1,'nothing is left firing on a retired server');
 }finally{await x.close();}
});
test('a blip that becomes an outage gets its evidence once the window has passed, once; a flap that clears first costs nothing',async()=>{
 const x=await world({rules:['SiteDown','ContainerMissing'],window:900});
 try{
  const flap=async(name,fingerprint,from)=>{await x.send([alert(name,fingerprint,{startsAt:from})],from);await x.process(from);await capturePendingEvidence(x.pool,x.owner,()=>from);await x.send([alert(name,fingerprint,{status:'resolved',startsAt:from,endsAt:from+MIN})],from+MIN);await x.process(from+MIN);await x.send([alert(name,fingerprint,{startsAt:from+2*MIN})],from+2*MIN);await x.process(from+2*MIN);};
  await flap('SiteDown','site0001',T0);
  let decisions=await x.decisions();assert.deepEqual(decisions.map(d=>d.reduction.outcome),['admitted','source-resolved','refired']);assert.equal((await x.work()).length,1,'the flap itself costs nothing');
  assert.equal((await promoteRefired(x.pool,x.owner,()=>T0+14*MIN)).promoted,0,'not inside the window');
  assert.equal((await promoteRefired(x.pool,x.owner,()=>T0+15*MIN)).promoted,1,'still firing after it');assert.equal((await x.work()).length,2);
  assert.equal((await capturePendingEvidence(x.pool,x.owner,()=>T0+15*MIN)).captured,1);assert.equal((await x.packets()).length,2,'its own packet');
  decisions=await x.decisions();assert.equal(decisions[2].reduction.outcome,'admitted');assert.equal(decisions[2].reduction.promotedFrom,'refired');assert.equal(decisions[2].reduction.workId,(await x.work()).find(w=>w.deliveryId===decisions[2].deliveryId).id,'every reader finds it');
  assert.equal((await promoteRefired(x.pool,x.owner,()=>T0+16*MIN)).promoted,0,'once');
  await flap('ContainerMissing','cont0001',T0+20*MIN);await x.send([alert('ContainerMissing','cont0001',{status:'resolved',startsAt:T0+22*MIN,endsAt:T0+23*MIN})],T0+23*MIN);await x.process(T0+23*MIN);
  assert.equal((await promoteRefired(x.pool,x.owner,()=>T0+40*MIN)).promoted,0,'a flap that cleared is left alone');assert.equal((await reading(x.pool,x.owner,'refired-watch')).items.length,0,'and nothing is left waiting');
 }finally{await x.close();}
});
test('a silence notice says the age it has when sent, and is pending only while the row is silent',async()=>{
 const x=await world();
 try{
  await goSilent(x);const late=await x.watch(T0+250*MIN);assert.match(late.notices.find(n=>/stopped reporting/.test(n.text)).text,/last heard from it 250 minutes ago/,'the rail was down for hours');
  await x.send([beat()],T0+251*MIN);const key='installation:'+x.source.id,row=await reading(x.pool,x.owner,key);
  await x.pool.query('UPDATE operations_processing_config SET record=$3 WHERE user_sub=$1 AND id=$2',[x.owner,key,JSON.stringify({...row,notices:[...row.notices,{id:'silent-old',at:iso(T0),text:'gsq-test has stopped reporting'}]})]);
  const after=await x.watch(T0+252*MIN);assert.deepEqual(after.notices.filter(n=>/stopped reporting/.test(n.text)),[],'a row left over from 1.1.6 does not call a healthy droplet silent');
 }finally{await x.close();}
});
test('with the schedule stopped Jarvis says no alarm can be raised, while the droplet reports',async()=>{
 const x=await world();
 try{
  await x.send([beat()],T0);let systems=await systemsSummary(x.pool,x.owner,T0+MIN);assert.match(systems.summary,/^Watch out: the silence watch has not run yet/);
  await x.watch(T0);await x.send([beat()],T0+180*MIN);
  const attention=await attentionSummary(x.pool,x.owner,T0+180*MIN);assert.match(attention.summary,/1 silence watches stopped \(the silence watch last ran 3 hours ago, so no alarm can be raised/);assert.doesNotMatch(attention.summary,/Nothing in Operations/);assert.equal(attention.items.find(i=>/Silence watches/.test(i.label)).page,'systems');
  systems=await systemsSummary(x.pool,x.owner,T0+180*MIN);assert.match(systems.summary,/^Watch out: the silence watch last ran 3 hours ago.*Monitored installations: gsq-test is reporting/);
  await x.watch(T0+180*MIN);assert.doesNotMatch((await systemsSummary(x.pool,x.owner,T0+181*MIN)).summary,/Watch out/);
  const none=await world();try{assert.equal((await attentionSummary(none.pool,none.owner,T0)).summary,'Nothing in Operations is waiting on you.','no installation, no watch to speak of');}finally{await none.close();}
 }finally{await x.close();}
});
test('stop watching refuses a server still reporting or late, and a resolve after the stop makes no empty card',async()=>{
 const x=await world();
 try{
  await x.send([beat()],T0);await x.send([alert('DiskFull','disk0001',{startsAt:T0})],T0);
  await assert.rejects(stopWatching(x.pool,x.owner,x.sources,x.source.id,()=>T0+MIN),{status:409,message:/still reporting/});await assert.rejects(stopWatching(x.pool,x.owner,x.sources,x.source.id,()=>T0+5*MIN),{status:409},'late is not gone');
  assert.equal((await x.view(T0+MIN)).firing.length,1,'nothing went with the refusal');
  assert.equal((await stopWatching(x.pool,x.owner,x.sources,x.source.id,()=>T0+11*MIN)).forgotten,true);
  await x.send([alert('DiskFull','disk0001',{status:'resolved',startsAt:T0,endsAt:T0+12*MIN})],T0+12*MIN);assert.equal(await x.view(T0+13*MIN),undefined,'no card for what was stopped');
 }finally{await x.close();}
});
test('stop watching one revision leaves the scans when another revision of the source still reports on them',async()=>{
 const x=await world();
 try{
  const revision=loadExperience().sourceDefinition({name:'gsq renamed',environment:'gsq-test',source:'urn:operations:source:gsq-test'}),both=[x.source,revision];
  await saveIngestMapping(x.pool,x.owner,{sourceId:revision.id,resourceKind:'host',idLabel:'instance',scope:'gsq-test'},both);
  await x.send([beat()],T0);await ingestAlertmanager(x.pool,x.owner,both,revision.id,{alerts:[beat()]},()=>T0+11*MIN);
  await stopWatching(x.pool,x.owner,both,x.source.id,()=>T0+11*MIN);
  assert.deepEqual((await readGraph(x.pool,x.owner,iso(T0+12*MIN))).assets.filter(a=>a.kind==='host').map(a=>a.name),['gsq renamed'],'its host stays');
 }finally{await x.close();}
});
test('a refusal that will not change frees the slot: two prepared investigations whose runbook moved on do not starve the next alert',async()=>routed(async({deliver,tick,call,pool,owner,source,base})=>{
 const t=Date.now();await deliver([alert('SiteDown','site0001',{startsAt:t}),alert('ContainerMissing','cont0001',{startsAt:t,service:'kernel'})]);await tick();
 const work=(await pool.query('SELECT id FROM operations_evidence_work WHERE user_sub=$1',[owner])).rows;assert.equal(work.length,2);
 for(const {id}of work)assert.equal((await call('/investigations',{workId:id})).status<300,true);
 for(const alertType of ['SiteDown','ContainerMissing'])assert.equal((await call('/runbooks',{alertType,markdown:'# steps\ncheck it',expectedRevision:0})).status<300,true);
 const config=await processingConfig(pool,owner);await saveProcessingConfig(pool,owner,{enabled:true,captureEvidence:true,autoInvestigate:true,sourceIds:[source.id],batchSize:10,maxAttempts:3,retrySeconds:10,expectedRevision:config.revision},[source.id]);
 await deliver([alert('ContainerMissing','cont0002',{startsAt:Date.now(),service:'postgres'})]);
 const first=await tick();assert.equal(first.investigation.refused,2,JSON.stringify(first.investigation));assert.match(first.investigation.results[0].error,/no longer matches/);
 const second=await tick();assert.equal(second.investigation.started,1,'the later alert gets its slot: '+JSON.stringify(second.investigation));
 const attention=(await (await fetch(base+'/attention')).json());assert.equal(attention.items.find(i=>/refused or uncertain/.test(i.label)).count,2,'and the two say why');
},{capture:true}));

/* What a fourth review proved on the real stack (2026-11-04). */
test('a resolve is believed from a settled Prometheus that no longer lists the alert, and only then',async()=>{
 const x=await world();
 try{
  const site=fp=>({...alert('SiteDown',fp,{startsAt:T0,service:'health'}),annotations:{summary:'s'}}),gone=fp=>({...site(fp),status:'resolved',endsAt:iso(T0+5*MIN)});
  const events=async fp=>(await x.deliveries()).filter(d=>d.raw.id.startsWith(fp)&&d.normalized.data.status==='resolved');
  await x.send([listing('')],T0);await x.send([site('real0001')],T0);
  await x.send([listing('')],T0+MIN);const real=await x.send([gone('real0001')],T0+MIN);assert.equal(real.heldResolves,undefined,'a real recovery goes through at once, whatever the clocks say');assert.equal((await events('real0001')).length,1);
  await x.send([site('rest0001')],T0+2*MIN);await x.send([listing('SiteDown.health=0')],T0+3*MIN);
  const restart=await x.send([gone('rest0001')],T0+3*MIN);assert.equal(restart.heldResolves,1,'Prometheus restarted and has it pending: Alertmanager timing it out says nothing');assert.equal((await events('rest0001')).length,0);
  await x.send([listing('SiteDown.health=1')],T0+4*MIN);await x.watch(T0+4*MIN);assert.equal((await events('rest0001')).length,0);assert.equal((await x.view(T0+4*MIN)).firing.length,1);
  await x.send([site('blnd0001')],T0+5*MIN);await x.send([listing('',{targets:'kernel=1 node=1 postgres=1 site=0 prometheus=1'})],T0+6*MIN);
  assert.equal((await x.send([gone('blnd0001')],T0+6*MIN)).heldResolves,1,'a dead exporter ending what it held is not a recovery');
  await x.send([site('newp0001')],T0+7*MIN);await x.send([listing('',{prom_uptime:'30'})],T0+8*MIN);
  assert.equal((await x.send([gone('newp0001')],T0+8*MIN)).heldResolves,1,'a Prometheus just started has not evaluated everything yet');
 }finally{await x.close();}
});
test('the watch clears what no resolve ever came for, after a reboot for instance, and only once it has stayed unlisted',async()=>{
 const x=await world();
 try{
  const events=async()=>(await x.deliveries()).filter(d=>d.normalized.data.alertType==='SiteDown'&&d.normalized.data.status==='resolved');
  const site=alert('SiteDown','site0001',{startsAt:T0,service:'health'});
  await x.send([listing('SiteDown.health=1')],T0);await x.send([site],T0);await x.watch(T0);
  await x.send([listing('')],T0+MIN);await x.watch(T0+MIN);assert.equal((await x.view(T0+MIN)).firing[0].clearing,true,'the card says it is being confirmed');
  await x.send([listing('SiteDown.health=0')],T0+2*MIN);await x.watch(T0+2*MIN);assert.equal((await x.view(T0+2*MIN)).firing[0].clearing,undefined,'listed again, so the count starts over');
  await x.send([listing('')],T0+3*MIN);await x.watch(T0+3*MIN);await x.send([listing('')],T0+5*MIN);await x.watch(T0+5*MIN);assert.equal((await events()).length,0,'not before 3 minutes unlisted');
  await x.send([listing('',{targets:'kernel=1 node=0 postgres=1 site=1 prometheus=1'})],T0+6*MIN);await x.watch(T0+6*MIN);assert.equal((await events()).length,0,'not while an exporter is blind');
  await x.send([listing('')],T0+7*MIN);await x.watch(T0+7*MIN);assert.equal((await events()).length,1,'cleared with its own event');assert.deepEqual((await x.view(T0+7*MIN)).firing,[],'and the card is clear hours before any fall-off');
  await x.watch(T0+8*MIN);assert.equal((await events()).length,1,'once');
 }finally{await x.close();}
});
test('a Prometheus dead for 30 minutes with the site down keeps its alert, and a Prometheus back with the site fine clears it within minutes, with no clock compared',async()=>{
 const x=await world();
 try{
  const site={...alert('SiteDown','site0001',{startsAt:T0,service:'health'}),annotations:{summary:'s'}},events=async()=>(await x.deliveries()).filter(d=>d.normalized.data.alertType==='SiteDown'&&d.normalized.data.status==='resolved');
  await x.send([listing('SiteDown.health=1')],T0);await x.send([site],T0);
  await x.send([{...beat(),status:'resolved'}],T0+4*MIN);assert.equal((await x.send([{...site,status:'resolved',endsAt:iso(T0+5*MIN)}],T0+6*MIN)).heldResolves,1);
  for(let m=7;m<=30;m++)await x.watch(T0+m*MIN);assert.deepEqual((await x.view(T0+30*MIN)).firing.map(a=>a.alertType),['InstallationSilent','SiteDown']);assert.equal((await events()).length,0);
  await x.send([listing('',{prom_uptime:'40'})],T0+31*MIN);await x.watch(T0+31*MIN);assert.equal((await events()).length,0,'just started');
  await x.send([listing('',{prom_uptime:'130'})],T0+33*MIN);await x.watch(T0+33*MIN);await x.send([listing('',{prom_uptime:'310'})],T0+36*MIN);await x.watch(T0+36*MIN);assert.equal((await events()).length,1,'cleared');
 }finally{await x.close();}
});
test('only the worker reaches the phone: the Evaluate button and a replay do not page anyone',async()=>routed(async({deliver,tick,told,call,pool,owner})=>{
 await tick();const started=Date.now();await deliver([alert('SiteDown','site0001',{startsAt:started})]);
 const id=(await pool.query('SELECT id FROM operations_deliveries WHERE user_sub=$1',[owner])).rows[0].id;
 const hand=await call('/pipeline/evaluate',{deliveryIds:[id]});assert.equal(hand.status<300,true);
 const next=await tick();assert.deepEqual(told,[],'a decision made by hand tells nobody: '+JSON.stringify(next.notification));
 await deliver([alert('ContainerMissing','cont0001',{startsAt:Date.now(),service:'kernel'})]);await tick();assert.match(told.join(' '),/ContainerMissing \(kernel\)/,'the worker still does');
}));
test('an engine outage still names a critical, once, and the decision that follows stays quiet',async()=>routed(async({deliver,tick,told,rail,pool,owner})=>{
 await tick();const ready=()=>pool.query("UPDATE operations_processing SET ready_at=$2 WHERE user_sub=$1",[owner,new Date(Date.now()-1000).toISOString()]);
 const started=Date.now();await deliver([alert('SiteDown','site0001',{startsAt:started,service:'health'})]);rail.engineDown=true;
 const first=await tick();assert.equal(first.status,503);const heard=told.join(' ');assert.match(heard,/\[critical\] SiteDown \(health\) on gsq-test: SiteDown summary/);assert.match(heard,/not evaluated yet/);assert.match(heard,/alert evaluation could not finish/);
 await ready();await tick();assert.deepEqual(told,[],'once, however long it lasts');
 await deliver([alert('ContainerMissing','cont0001',{startsAt:Date.now(),service:'kernel'})]);await ready();await tick();assert.equal(told.length,1,'a new one is news');assert.match(told[0],/ContainerMissing \(kernel\)/);assert.doesNotMatch(told[0],/SiteDown/);
 for(let i=0;i<4;i++){await ready();await tick();}assert.deepEqual((await pool.query("SELECT state FROM operations_processing WHERE user_sub=$1",[owner])).rows.map(r=>r.state).filter(s=>s==='attention'),[],'no retry budget was spent');
 rail.engineDown=false;await ready();const back=await tick();assert.equal(back.status,200);assert.ok(back.results.filter(r=>r.outcome==='admitted').length===2,JSON.stringify(back.results));assert.deepEqual(told,[],'the phone heard these already');
 assert.equal((await pool.query('SELECT id FROM operations_telemetry_packets WHERE user_sub=$1',[owner])).rows.length,2,'and the evidence still follows');
},{capture:true}));
test('each failing step is its own news, and a message fits the shortest rail with what is firing first',async()=>routed(async({deliver,tick,told,gate,rail,pool,owner})=>{
 await tick();
 gate.fail=(when,q)=>{if(when==='before'&&/FROM operations_anomaly_state/.test(q))throw Object.assign(Error('connection reset'),{code:'08006'});};
 await tick();assert.match(told.join(' '),/anomaly detection could not finish/);await tick();assert.deepEqual(told,[]);
 rail.engineDown=true;await deliver([alert('SiteDown','site0001',{startsAt:Date.now()})]);await tick();assert.match(told.join(' '),/alert evaluation could not finish/,'a second step failing inside the streak is news');assert.doesNotMatch(told.join(' '),/anomaly detection/,'the first stays quiet');
 rail.engineDown=false;gate.fail=null;await pool.query('UPDATE operations_processing SET ready_at=$2 WHERE user_sub=$1',[owner,new Date(Date.now()-1000).toISOString()]);await tick();
 const t=Date.now()+5000;await deliver(Array.from({length:3},(_,i)=>alert('ContainerMissing','clr000'+i,{startsAt:t,service:'clr-'+i})));await tick();
 await deliver(Array.from({length:3},(_,i)=>alert('ContainerMissing','clr000'+i,{status:'resolved',startsAt:t,endsAt:t+1000,service:'clr-'+i})));
 await deliver(Array.from({length:12},(_,i)=>({...alert('ContainerMissing','new'+String(i).padStart(4,'0'),{startsAt:t+2000,service:'new-'+i}),annotations:{summary:'x'.repeat(190),description:'d'}})));
 await tick();assert.equal(told.length,1);assert.ok(told[0].length<=500,'length '+told[0].length);assert.match(told[0],/^Operations attention: \[critical\] ContainerMissing \(new-/,'what is firing first');assert.match(told[0],/and \d+ more/);assert.doesNotMatch(told[0].split('and ')[0],/cleared/);
}));
test('a rail that keeps refusing goes on the attention list and comes off when it takes a message',async()=>routed(async({deliver,tick,rail,base})=>{
 await tick();await deliver([alert('SiteDown','site0001',{startsAt:Date.now()})]);rail.down=true;await tick();await tick();
 let attention=await (await fetch(base+'/attention')).json();assert.match(attention.summary,/1 phone rails refusing messages \(since .*rail down\)/);
 rail.down=false;await tick();attention=await (await fetch(base+'/attention')).json();assert.doesNotMatch(attention.summary,/phone rails/);
}));
test('stop watching tells nobody anything cleared, and closes what the row held so no symptom stands',async()=>routed(async({deliver,tick,told,call,pool,owner,source})=>{
 await tick();const t=Date.now();await deliver([{...listing(''),startsAt:new Date(t).toISOString()}]);await deliver([alert('SiteDown','site0001',{startsAt:t,service:'health'})]);await tick();assert.equal(told.length,1);
 await ageRow(pool,owner,source,11);await tick();told.length=0;
 const stopped=await call('/ingest/mapping',{stopWatching:true,sourceId:source.id});assert.equal(stopped.status,200);await tick();assert.doesNotMatch(told.join(' '),/cleared/,'a retired server cleared nothing');
 assert.deepEqual((await pool.query('SELECT record FROM operations_symptoms WHERE user_sub=$1',[owner])).rows.map(r=>r.record.status).filter(s=>s==='firing'),[],'and nothing stands firing');
}));
test('the kernel\'s conflict wording retries like any conflict, instead of reaching the door',async()=>{
 const x=await world();
 try{
  let armed=true;x.gate.fail=(when,q)=>{if(armed&&when==='before'&&/UPDATE operations_processing_config/.test(q)){armed=false;throw Error('refused: conflict: scoped collection revision or expected body changed');}};
  await x.send([beat()],T0);await x.send([beat()],T0+MIN);x.gate.fail=null;assert.equal(armed,false);assert.equal((await x.view(T0+MIN)).reports,2,'the text crates/store/src/postgres_snapshot.rs answers, retried');
 }finally{await x.close();}
});
test('a blank backup reads unknown while the node exporter is unread or Prometheus has just started, and a real miss still reads as one',()=>{
 const check=a=>assess(readingsOf({...READINGS,backup_age_hours:'',backup_bytes:'',...a})).checks.find(c=>c.id==='backup');
 assert.equal(check({targets:'kernel=1 node=0 postgres=1 site=1'}).state,'unknown');assert.equal(check({prom_uptime:'30'}).state,'unknown');assert.equal(check({prom_uptime:'3600',targets:'kernel=1 node=1 postgres=1 site=1'}).state,'bad');
});
test('a re-fire that also escalated has its evidence and does not wait for another, and a tick behind on evaluation promotes nothing',async()=>{
 const x=await world({rules:['SiteDown','ContainerMissing'],window:900});
 try{
  const name='SiteDown',fp='esc00001';
  await x.send([alert(name,fp,{startsAt:T0,severity:'warning'})],T0);await x.process(T0);await x.send([alert(name,fp,{status:'resolved',startsAt:T0,endsAt:T0+MIN,severity:'warning'})],T0+MIN);await x.process(T0+MIN);await x.send([alert(name,fp,{startsAt:T0+2*MIN})],T0+2*MIN);await x.process(T0+2*MIN);
  assert.equal((await x.decisions()).at(-1).reduction.outcome,'escalated');assert.equal((await promoteRefired(x.pool,x.owner,()=>T0+20*MIN)).promoted,0,'one alert, one packet');
 }finally{await x.close();}
});

/* What a fifth review proved (2026-11-04). */
test('a list that is blank or holds an item it cannot carry holds every resolve and clears nothing',async()=>{
 const x=await world();
 try{
  const site={...alert('SiteDown','site0001',{startsAt:T0,service:'health'}),annotations:{summary:'s'}},gone={...site,status:'resolved',endsAt:iso(T0+5*MIN)};
  const events=async()=>(await x.deliveries()).filter(d=>d.normalized.data.alertType==='SiteDown'&&d.normalized.data.status==='resolved');
  await x.send([listing('SiteDown.health=1')],T0);await x.send([site],T0);
  await x.send([beat({alerts:'',prom_uptime:''})],T0+MIN);assert.equal((await x.send([gone],T0+MIN)).heldResolves,1,'Prometheus just restarted past the lookback, or its disk is full: a blank list is not an all-clear');
  await x.send([site],T0+MIN);for(let m=2;m<=8;m++){await x.send([beat({alerts:'',prom_uptime:''})],T0+m*MIN);await x.watch(T0+m*MIN);}assert.equal((await events()).length,0);assert.equal((await x.view(T0+8*MIN)).firing.length,1);
  for(let m=9;m<=16;m++){await x.send([listing('',{alerts:'InstallationHeartbeat=1 SiteDown.app/health=1'})],T0+m*MIN);await x.watch(T0+m*MIN);}assert.equal((await events()).length,0,'an item the list cannot carry cannot clear anything');
 }finally{await x.close();}
});
test('a heartbeat Alertmanager repeats after Prometheus died clears nothing: Prometheus must be seen moving',async()=>{
 const x=await world();
 try{
  const events=async()=>(await x.deliveries()).filter(d=>d.normalized.data.alertType==='ContainerOutOfMemory'&&d.normalized.data.status==='resolved');
  const frozen=listing('');await x.send([frozen],T0);await x.send([alert('ContainerOutOfMemory','oom00001',{startsAt:T0})],T0);
  for(let s=30;s<=240;s+=30){await x.send([frozen],T0+s*1000);await x.watch(T0+s*1000);}
  assert.equal((await events()).length,0,'the same reading repeated');
  assert.equal((await x.send([{...alert('ContainerOutOfMemory','oom00001',{status:'resolved',startsAt:T0,endsAt:T0+4*MIN})}],T0+4*MIN)).heldResolves,1,'and its timed-out resolve waits');
 }finally{await x.close();}
});
test('a critical told while the engine was down gets its all-clear even when the resolve is evaluated first',async()=>routed(async({deliver,tick,told,rail,pool,owner})=>{
 await tick();const t=Date.now();await deliver([alert('DiskFull','disk0001',{startsAt:t})]);rail.engineDown=true;await tick();assert.match(told.join(' '),/\[critical\] DiskFull on gsq-test.*not evaluated yet/);
 rail.engineDown=false;await deliver([alert('DiskFull','disk0001',{status:'resolved',startsAt:t,endsAt:t+60000})]);
 const next=await tick();assert.ok(next.results.some(r=>r.outcome==='orphan-resolution'),JSON.stringify(next.results));assert.match(told.join(' '),/\[critical\] DiskFull on gsq-test cleared/,"the phone's last word is not that the disk is full");
},{rules:['DiskFull','InstallationSilent','LoadHigh','SiteDown']}));
test('the newest undecided rows are named, so 64 older ones cannot hide a new critical during an outage',async()=>routed(async({deliver,tick,told,rail})=>{
 await tick();const t=Date.now();rail.engineDown=true;
 for(let b=0;b<7;b++)await deliver(Array.from({length:10},(_,i)=>alert('LoadHigh','load'+b+String(i).padStart(3,'0'),{startsAt:t,severity:'warning',service:'w-'+b+'-'+i})));
 await tick();await deliver([alert('SiteDown','site0001',{startsAt:t+1000})]);await tick();assert.match(told.join(' '),/\[critical\] SiteDown on gsq-test/,told.join(' | '));
}));
test('a failed read of the mark in a tick past its time does not blank the mark',async()=>routed(async({deliver,told,gate,pool,owner,source,e})=>{
 const ctx={pool,notify:async(_,m)=>{told.push(m);return {sent:true};}},read=async()=>[source],mark=async()=>(await pool.query('SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id=$2',[owner,'alerts-told'])).rows[0]?.record;
 await processingTick(ctx,e.engine,owner,read);const before=await mark();
 await deliver([alert('ContainerMissing','cont0001',{startsAt:Date.now(),service:'kernel'})]);let reads=0;
 gate.fail=(when,q,v)=>{if(when==='before'&&Array.isArray(v)&&v[1]==='alerts-told'&&/^SELECT/.test(q)&&++reads===2)throw Object.assign(Error('connection reset'),{code:'08006'});};
 const slow=async(...a)=>{await new Promise(r=>setTimeout(r,1500));return e.engine(...a);};told.length=0;
 const tick=await processingTick(ctx,slow,owner,read,800);gate.fail=null;assert.equal(tick.body.correlation.deferred,true);
 const after=await mark();assert.equal(after.error,undefined,'no fallback was saved as the mark');assert.ok(after.through>=before.through);assert.match(told.join(' '),/ContainerMissing \(kernel\)/,'and the alert was told');
}));
