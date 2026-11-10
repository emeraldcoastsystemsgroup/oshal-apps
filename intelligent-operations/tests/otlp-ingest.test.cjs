/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | ADR-216 S2 (1.7.0): the OpenTelemetry route POST /ingest/otlp/:sourceId over real SQL with forced owner policies, the real router and, for the policy, the real percolator on the disposable search. An OTLP/JSON metrics body (hostmetrics and httpcheck as the collector sends them) is one heartbeat whose readings land on the heartbeat's keys, so the card, its checks, the charts and the telemetry banks read it and the checks a collector cannot read are not reported rather than problems; SiteDown, SiteSlow, DiskFull, DiskHigh, MemoryLow and LoadHigh each fire only after the Prometheus rule's window, from when the breach began, and resolve when the reading clears; a reading a delivery lacks moves no clock; a failed admit is owed to the next delivery; a firing alert is repeated so the card keeps it; logs and traces are answered and ignored, a missing producer path is metrics and an unknown one is refused; malformed and oversize bodies record nothing; a removed source answers 410 and an unknown one 404; a fired critical becomes a captured symptom under the source's policy; Disconnect stops the watch of a reporting installation and keeps its history. Red on 1.6.0: routes/otlp.js and the route did not exist (404), and stopWatching refused a reporting installation (409). */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,loadExperience,dependency}=require('./fixtures/intake.cjs'),{engineFixture}=require('./fixtures/detection.cjs');
const {hash}=require('../routes/intake.js'),{publishPolicy}=require('../routes/pipeline.js'),{processingConfig,saveProcessingConfig,processPending}=require('../routes/processing-worker.js');
const {saveIngestMapping,stopWatching}=require('../routes/ingest.js'),{installationRecords}=require('../routes/installations.js');
const {ingestOtlp,otlpReadings,OTLP_RULES}=require('../routes/otlp.js');

const T0=Date.parse('2026-11-09T12:00:00Z'),MIN=60000,iso=ms=>new Date(ms).toISOString(),GB=1e9;
const attr=(key,value)=>({key,value:{stringValue:value}});
const gauge=(name,points)=>({name,gauge:{dataPoints:points.map(([attrs,value])=>({attributes:Object.entries(attrs).map(([k,v])=>attr(k,v)),...(typeof value==='string'?{asInt:value}:{asDouble:value})}))}});
const sum=(name,points)=>({name,sum:{aggregationTemporality:2,isMonotonic:false,dataPoints:gauge(name,points).gauge.dataPoints}});
/** One collector's metrics as hostmetrics and httpcheck send them, in OTLP/JSON (int64 as strings). */
function metrics({disk=0.5,memory=0.4,total=8*GB,idle=[0.9,0.9],load=0.5,status='2xx',ms=250,host='web-1',url='https://web-1.example/health'}={}){
 const list=[];
 if(disk!==null)list.push(gauge('system.filesystem.utilization',[[{device:'/dev/vda1',mountpoint:'/',type:'ext4',mode:'rw'},disk],[{device:'/dev/vda15',mountpoint:'/boot/efi',type:'vfat',mode:'rw'},0.99]]));
 if(memory!==null)list.push(sum('system.memory.usage',[[{state:'used'},String(Math.round(memory*total))],[{state:'free'},String(Math.round((1-memory)*total))]]),gauge('system.memory.utilization',[[{state:'used'},memory],[{state:'free'},1-memory]]));
 if(idle!==null)list.push(gauge('system.cpu.utilization',idle.flatMap((v,i)=>[[{cpu:'cpu'+i,state:'idle'},v],[{cpu:'cpu'+i,state:'user'},1-v]])));
 if(load!==null)list.push(gauge('system.cpu.load_average.5m',[[{},load]]));
 if(status!==null)list.push(sum('httpcheck.status',['1xx','2xx','3xx','4xx','5xx'].map(c=>[{'http.url':url,'http.status_class':c},c===status?'1':'0'])));
 if(ms!==null)list.push(gauge('httpcheck.duration',[[{'http.url':url},String(ms)]]));
 return {resourceMetrics:[{resource:{attributes:[attr('host.name',host),attr('os.type','linux')]},scopeMetrics:[{scope:{name:'otelcol/hostmetricsreceiver'},metrics:list}]}]};
}
/** Every one of the six breached at once: the site answers 503 in 4 s, the disk is 95% full, 3% of memory is free, load 5 on 2 CPUs. */
const BREACHED={disk:0.95,memory:0.97,idle:[0.1,0.1],load:5,status:'5xx',ms:4000};
const once=pattern=>{let armed=true;return (when,q)=>{if(armed&&when==='before'&&pattern.test(q)){armed=false;throw Object.assign(Error('connection reset'),{code:'08006'});}};};

/** One real owner and source, enrolled for OpenTelemetry as prepare enrols it (the same host mapping), over disposable SQL. */
async function world({rules=[]}={}){
 const f=await fixture(),owner='otlp-'+randomUUID(),gate={fail:null};
 const pool=f.caller(owner,async(when,q,v)=>{if(gate.fail)await gate.fail(when,q,v);});
 const source=loadExperience().sourceDefinition({name:'web-1',environment:'web-1',source:'urn:operations:source:web-1'}),sources=[source];
 const e=rules.length?await engineFixture():null;let index=null;
 if(e){const published=await publishPolicy(pool,e.engine,owner,source,{name:'web-1 checks',rules:rules.map(([name,capture])=>({name,enabled:true,capture,query:{term:{alertType:name}}})),window:{mode:'sliding',seconds:900}},0);index='ops-rules-'+hash(['detection-owner-v1',owner])+'-'+published.policy.id;
  await saveProcessingConfig(pool,owner,{enabled:true,captureEvidence:true,autoInvestigate:false,sourceIds:[source.id],batchSize:10,maxAttempts:8,retrySeconds:30,expectedRevision:(await processingConfig(pool,owner)).revision},[source.id]);}
 await saveIngestMapping(pool,owner,{sourceId:source.id,resourceKind:'host',idLabel:'instance',scope:'web-1',severityLabel:'severity'},sources);
 const deliveries=async()=>(await pool.query('SELECT record FROM operations_deliveries WHERE user_sub=$1',[owner])).rows.map(r=>r.record);
 return {f,e,pool,owner,source,sources,gate,deliveries,
  send:(body,at=T0,path)=>ingestOtlp(pool,owner,sources,source.id,body,{path,clock:()=>at}),
  view:async(at=T0)=>(await installationRecords(pool,owner,sources,1,()=>at))[0],
  events:async(type,status)=>(await deliveries()).filter(d=>d.normalized.data.alertType===type&&(!status||d.normalized.data.status===status)),
  close:async()=>{if(e)await e.close();await f.close();if(index)await fetch(process.env.OSHAL_TEST_SEARCH+'/'+index,{method:'DELETE'}).catch(()=>{});}};
}
/** Report every minute from `from` for `minutes` minutes with the same readings. */
async function report(x,readings,from,minutes){for(let m=0;m<minutes;m++)await x.send(metrics(readings),from+m*MIN);}

test('the readings of hostmetrics and httpcheck land on the heartbeat keys, worst host first when a cluster reports several',()=>{
 const [one]=otlpReadings(metrics({disk:0.871,memory:0.75,idle:[0.8,0.6],load:1.5,ms:420}));
 assert.equal(one.host,'web-1');
 assert.deepEqual({...one.readings,disk_used:Math.round(one.readings.disk_used*10)/10},{memory_used:75,memory_total:8*GB,memory_available:2*GB,cpu_used:30,cpus:2,load5:1.5,site_up:1,site_seconds:0.42,url:'https://web-1.example/health',disk_used:87.1},'/ only, busy is 100 minus idle averaged over the CPUs, the duration in seconds');
 const usage={resourceMetrics:[{resource:{attributes:[attr('host.name','db-1')]},scopeMetrics:[{metrics:[sum('system.filesystem.usage',[[{mountpoint:'/',state:'used'},'60'],[{mountpoint:'/',state:'free'},'40'],[{mountpoint:'/',state:'reserved'},'5']]),sum('httpcheck.error',[[{'http.url':'https://db-1.example/','error.message':'connection refused'},'1']])]}]}]};
 assert.deepEqual(otlpReadings(usage)[0].readings,{site_up:0,url:'https://db-1.example/',disk_used:60},'without utilization, used over used and free as df counts it; an httpcheck error alone is down');
 assert.equal(OTLP_RULES.map(r=>r.name).join(),'SiteDown,SiteSlow,DiskFull,DiskHigh,MemoryLow,LoadHigh');
});

test('an OTLP metrics delivery is the installation\'s heartbeat: the card reports with its readings, the charts and telemetry take them, and what a collector cannot read is not reported',async()=>{
 const x=await world();
 try{
  const first=await x.send(metrics({disk:0.871}),T0);
  assert.equal(first.heartbeat.recorded,true);assert.deepEqual([first.fired,first.resolved],[[],[]]);
  const card=await x.view(T0+30000);
  assert.deepEqual([card.state,card.host,card.url,card.reports,card.health],['reporting','web-1','https://web-1.example',1,'healthy']);
  const check=id=>card.checks.find(c=>c.id===id);
  assert.deepEqual(['site','disk','memory','processor'].map(id=>[check(id).state,check(id).reading]),[['ok','Answers in 0.25 s'],['warn','87% used'],['ok','40% used'],['ok','10% busy, load 0.50 on 2 CPUs']]);
  for(const id of ['kernel','postgres','containers','backup','offsite','updates','monitoring'])assert.deepEqual([check(id).state,check(id).reading],['unknown','Not reported by its collector'],id+' is not a problem a collector can see');
  assert.deepEqual(Object.keys(card.history.series).sort(),['cpu_used','disk_used','load5','memory_used','site_seconds','site_up']);
  assert.equal(card.thresholds.body.disk_full_percent_max,90,'Settings shows the thresholds Operations judges it by');
  const streamed=(await x.pool.query('SELECT count(*)::int AS n FROM operations_telemetry_0 WHERE user_sub=$1 AND source_id=$2',[x.owner,x.source.id])).rows[0].n
   +(await x.pool.query('SELECT count(*)::int AS n FROM operations_telemetry_1 WHERE user_sub=$1 AND source_id=$2',[x.owner,x.source.id])).rows[0].n
   +(await x.pool.query('SELECT count(*)::int AS n FROM operations_telemetry_2 WHERE user_sub=$1 AND source_id=$2',[x.owner,x.source.id])).rows[0].n;
  assert.ok(streamed>=6,'the readings are in the telemetry banks for evidence packets: '+streamed);
  await x.send(metrics(),T0+MIN);assert.equal((await x.view(T0+MIN)).reports,2,'every accepted delivery is a beat');
  assert.equal((await x.deliveries()).length,0,'a heartbeat is never an event');
 }finally{await x.close();}
});

test('each of the six alerts fires only after its rule\'s window, from when the breach began, and resolves when its reading clears',async()=>{
 const x=await world();
 try{
  const firedAt={};
  for(let m=0;m<=30;m++){const r=await x.send(metrics(BREACHED),T0+m*MIN);for(const name of r.fired)firedAt[name]=m;}
  assert.deepEqual(firedAt,{SiteDown:5,SiteSlow:10,DiskFull:10,MemoryLow:10,LoadHigh:15,DiskHigh:30},'the windows of rules/installation.yml');
  for(const name of Object.keys(firedAt)){const [event]=await x.events(name,'firing');assert.equal(event.normalized.time,iso(T0),name+' starts when its breach began');assert.equal(event.decision,'validated');}
  assert.equal((await x.events('SiteDown','firing'))[0].normalized.data.severity,'critical');assert.equal((await x.events('DiskHigh','firing'))[0].normalized.data.severity,'warning');
  assert.match((await x.events('MemoryLow','firing'))[0].raw.data.summary,/^Under 0\.4 GiB of memory available$/,'5% of 8 GB');
  const card=await x.view(T0+30*MIN);assert.deepEqual(card.firing.map(a=>a.alertType).sort(),Object.keys(firedAt).sort());assert.equal(card.health,'degraded');
  const cleared=await x.send(metrics(),T0+31*MIN);
  assert.deepEqual(cleared.resolved.sort(),Object.keys(firedAt).sort());
  for(const name of Object.keys(firedAt)){const [event]=await x.events(name,'resolved');assert.equal(event.normalized.time,iso(T0+31*MIN),name+' resolves when it cleared');}
  assert.deepEqual((await x.view(T0+31*MIN)).firing,[],'the card is clear');
  assert.deepEqual((await x.send(metrics(),T0+32*MIN)).resolved,[],'and once');
 }finally{await x.close();}
});

test('a breach that clears inside its window never fires; a missed delivery keeps its clock, a longer gap starts it again, and nothing fires without its reading',async()=>{
 const x=await world();
 try{
  await report(x,{disk:0.95},T0,9);await report(x,{disk:0.5},T0+9*MIN,1);await report(x,{disk:0.95},T0+10*MIN,9);
  assert.equal((await x.events('DiskFull')).length,0,'nine minutes, a clear, nine minutes: no DiskFull');
  await report(x,{disk:null},T0+19*MIN,1);
  const r=await x.send(metrics({disk:0.95}),T0+20*MIN);
  assert.deepEqual(r.fired,['DiskFull'],'one delivery without a disk reading kept the clock from minute 10');
  assert.equal((await x.events('DiskFull','firing'))[0].normalized.time,iso(T0+10*MIN));
  await report(x,{load:5},T0+21*MIN,10);await report(x,{load:null},T0+31*MIN,5);
  assert.equal((await x.events('LoadHigh')).length,0,'fifteen minutes passed with no load reading in the last five: nothing fires without its reading');
  await report(x,{load:5},T0+36*MIN,14);assert.equal((await x.events('LoadHigh')).length,0,'five minutes without it started the clock again at minute 36');
  assert.deepEqual((await x.send(metrics({load:5}),T0+51*MIN)).fired,['LoadHigh']);assert.equal((await x.events('LoadHigh','firing'))[0].normalized.time,iso(T0+36*MIN));
 }finally{await x.close();}
});

test('a failed admit is owed to the next delivery, and a firing alert is repeated so the card keeps it while it holds',async()=>{
 const x=await world();
 try{
  await report(x,{status:'5xx'},T0,5);
  x.gate.fail=once(/INSERT INTO operations_deliveries/);
  const failed=await x.send(metrics({status:'5xx'}),T0+5*MIN);x.gate.fail=null;
  assert.deepEqual(failed.fired,[]);assert.match(failed.errors[0],/^SiteDown: connection reset/);assert.equal(failed.heartbeat.recorded,true,'the beat itself landed');
  const retried=await x.send(metrics({status:'5xx'}),T0+6*MIN);assert.deepEqual(retried.fired,['SiteDown']);
  assert.equal((await x.events('SiteDown','firing'))[0].normalized.time,iso(T0),'still the same occurrence');
  const later=T0+6*MIN+4*3600000;
  assert.deepEqual((await x.send(metrics({status:'5xx'}),later)).repeated,['SiteDown'],'said again after 4 hours');
  assert.equal((await x.events('SiteDown','firing')).length,1,'a repeat is the same event');
  const card=await x.view(later+8*3600000);assert.equal(card.firing[0]?.alertType,'SiteDown','still on the card 12 hours after it fired, where an unrepeated alert falls off after 9');
 }finally{await x.close();}
});

test('a fired critical goes through the source\'s policy into a captured symptom, a warning is recorded',async()=>{
 const x=await world({rules:[['DiskFull',true],['DiskHigh',false]]});
 try{
  await report(x,{disk:0.95},T0,31);
  const processed=await processPending(x.pool,x.e.engine,x.owner,()=>T0+31*MIN);
  assert.deepEqual(processed.results.map(r=>r.outcome),['admitted','admitted'],JSON.stringify(processed));
  const decisions=(await x.pool.query('SELECT record FROM operations_filter_decisions WHERE user_sub=$1',[x.owner])).rows.map(r=>r.record);
  assert.equal(decisions.length,2,'both matched the source\'s policy');
  const work=(await x.pool.query('SELECT record FROM operations_evidence_work WHERE user_sub=$1',[x.owner])).rows.map(r=>r.record);
  const captured=type=>work.find(w=>w.deliveryId===deliveryOf[type])?.capture;
  const deliveryOf=Object.fromEntries((await x.deliveries()).map(d=>[d.normalized.data.alertType,d.id]));
  assert.deepEqual([captured('DiskFull'),captured('DiskHigh')],[true,false],'the critical DiskFull is captured with a snapshot; the warning DiskHigh is recorded only');
 }finally{await x.close();}
});

test('logs and traces are answered and ignored, a missing producer path is metrics, and an unknown one, a malformed or an oversize body records nothing',async()=>{
 const x=await world();
 try{
  for(const path of ['/v1/logs','/v1/traces'])assert.deepEqual(await x.send(metrics(),T0,path),{sourceId:x.source.id,signal:path.slice(4),ignored:true});
  assert.equal((await x.send({resourceLogs:[{resource:{},scopeLogs:[]}]},T0)).ignored,true,'a logs body on the base door');
  assert.equal(await x.view(),undefined,'nothing was heard yet');
  await assert.rejects(x.send(metrics(),T0,'/v1/profiles'),e=>e.status===400);
  for(const bad of [null,[],{},{resourceMetrics:{}},{resourceMetrics:[],resourceLogs:'x'}])await assert.rejects(x.send(bad,T0),e=>e.status===400,JSON.stringify(bad));
  const huge={resourceMetrics:[{resource:{attributes:[attr('pad','x'.repeat(270000))]},scopeMetrics:[]}]};
  await assert.rejects(x.send(huge,T0),e=>e.status===413);
  assert.equal(await x.view(),undefined,'still nothing heard');
  assert.equal((await x.send(metrics(),T0,'/v1/metrics')).heartbeat.recorded,true);assert.equal((await x.send(metrics(),T0+MIN)).signal,'metrics','no path is metrics');
 }finally{await x.close();}
});

test('through the real router: 200 {} as OTLP expects, 410 for a removed source, 404 for an unknown one, and the producer path header is read',async()=>{
 const f=await fixture(),owner='otlp-router-'+randomUUID(),pool=f.caller(owner),express=dependency('express'),app=express(),collections=new Map();let server;
 const store={async query(name){return [...(collections.get(name)||new Map()).values()].map(v=>structuredClone(v));},async put(name,id,value){if(!collections.has(name))collections.set(name,new Map());collections.get(name).set(id,structuredClone(value));}};
 const ctx={appPackageDir:require('./fixtures/intake.cjs').root,pool,intent:async()=>{throw Error('no engine here');},authorization:{registerResource(){}},store,notify:async()=>({sent:true})};
 try{
  app.use((req,_res,next)=>{req.oidc={user:{sub:owner}};next();});app.use('/api/intelligent-operations',loadExperience().createOperationsExperienceRoutes(ctx));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/api/intelligent-operations';
  const post=async(p,body,headers={})=>{const r=await fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};};
  const kept=loadExperience().sourceDefinition({name:'web-1',environment:'web-1',source:'urn:operations:source:web-1'}),gone={...loadExperience().sourceDefinition({name:'web-2',environment:'web-2',source:'urn:operations:source:web-2'}),discardedAt:iso(T0)};
  await store.put('sources',kept.id,kept);await store.put('sources',gone.id,gone);
  await saveIngestMapping(pool,owner,{sourceId:kept.id,resourceKind:'host',idLabel:'instance',scope:'web-1'},[kept]);
  const big=metrics();big.resourceMetrics[0].resource.attributes.push(attr('pad','x'.repeat(100000)));
  const ok=await post('/ingest/otlp/'+kept.id,big,{'x-oshal-producer-path':'/v1/metrics','x-oshal-trigger':'producer'});
  assert.deepEqual(ok,{status:200,body:{}},'an empty ExportMetricsServiceResponse, for a body past the other routes\' 70 kb');
  assert.equal((await post('/ingest/otlp/'+kept.id,metrics(),{'x-oshal-producer-path':'/v1/logs'})).status,200);
  assert.equal((await installationRecords(pool,owner,[kept],1,()=>Date.now()))[0].reports,1,'the logs delivery was not a beat');
  assert.deepEqual(await post('/ingest/otlp/'+gone.id,metrics()),{status:410,body:{gone:'This source was removed in Operations.'}},'the door ends this token');
  assert.equal((await post('/ingest/otlp/no-such-source',metrics())).status,404);
  assert.equal((await post('/ingest/otlp/'+kept.id,'{"resourceMetrics":')).status,400);
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await f.close();}
});

test('Disconnect stops watching an installation that was reporting a moment ago and keeps its history; stop watching alone still refuses one',async()=>{
 const x=await world();
 try{
  await report(x,BREACHED,T0,6);
  assert.equal((await x.view(T0+6*MIN)).firing[0].alertType,'SiteDown');
  await assert.rejects(stopWatching(x.pool,x.owner,x.sources,x.source.id,()=>T0+6*MIN),e=>e.status===409,'a reporting installation is not stopped without its tokens revoked');
  assert.deepEqual(await stopWatching(x.pool,x.owner,x.sources,x.source.id,()=>T0+6*MIN,{disconnect:true}),{forgotten:true,sourceId:x.source.id,disconnected:true});
  assert.equal(await x.view(T0+20*MIN),undefined,'the card goes, and nothing calls it silent');
  const [closed]=await x.events('SiteDown','resolved');assert.equal(closed.raw.data.labels.closed_by,'disconnect','closed, and kept off the phone');
  const kept=(await x.pool.query("SELECT count(*)::int AS n FROM operations_processing_config WHERE user_sub=$1 AND id LIKE $2",[x.owner,'installation-day:'+x.source.id+':%'])).rows[0].n;
  assert.equal(kept,1,'the chart history stays');
  assert.equal((await x.pool.query('SELECT count(*)::int AS n FROM operations_processing_config WHERE user_sub=$1 AND id=$2',[x.owner,'otlp-evaluation:'+x.source.id])).rows[0].n,0,'the alert clocks go');
  await x.send(metrics(),T0+30*MIN);const back=await x.view(T0+30*MIN);
  assert.ok(back.history.series.disk_used.length>=2,'enrolled again, the same source brings its history back');assert.deepEqual(back.firing,[]);
 }finally{await x.close();}
});
