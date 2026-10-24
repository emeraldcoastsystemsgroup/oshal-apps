// CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Prove original-user scheduled evidence completion, concurrent commits, replay and pause fences against real isolated PostgreSQL.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,loadExperience}=require('./fixtures/intake.cjs');
const {admit,hash}=require('../routes/intake.js'),{example}=require('../ui/source-contract.js');
const {configureStream,ingestTelemetry}=require('../routes/telemetry-store.js');
const {saveProcessingConfig,retryProcessing}=require('../routes/processing-worker.js');
const {capturePendingEvidence}=require('../routes/evidence-worker.js');
async function setup(captureEvidence=true){
 const f=await fixture(),owner='capture-'+randomUUID(),p=f.caller(owner),source=loadExperience().sourceDefinition({name:'Capture source',source:'urn:test:'+randomUUID(),environment:'local-lab'}),at=Date.now();
 await p.query('INSERT INTO operations_policy_bindings(user_sub,id,revision,record) VALUES($1,$2,$3,$4)',[owner,source.id,1,'{}']);
 const config=await saveProcessingConfig(p,owner,{enabled:true,captureEvidence,sourceIds:[source.id],batchSize:10,maxAttempts:2,retrySeconds:10,expectedRevision:0},[source.id]);
 const event=example();Object.assign(event,{id:randomUUID(),source:source.source,time:new Date(at).toISOString()});
 const delivery=(await admit(p,owner,source,event)).record,id=hash(['reservation',delivery.id]);
 // A committed reducer reservation is the consumer boundary; processing-worker.test also exercises real percolation → capture.
 const work={id,deliveryId:delivery.id,capture:true,state:'pending'};
 await p.query('INSERT INTO operations_evidence_work(user_sub,id,state,record,created_at) VALUES($1,$2,$3,$4,$5)',[owner,id,'pending',JSON.stringify(work),new Date(at).toISOString()]);
 await p.query('UPDATE operations_processing SET state=$3, record=$4 WHERE user_sub=$1 AND id=$2',[owner,delivery.id,'evidence-pending',JSON.stringify({sourceId:source.id,reduction:{workId:id},processing:{status:'completed'}})]);
 return {f,p,owner,source,at,id,delivery,config,async saved(){return (await p.query('SELECT state, record FROM operations_processing WHERE user_sub=$1 AND id=$2',[owner,delivery.id])).rows[0];},close:f.close};
}
test('capture is explicit opt-in and foreign users cannot read or consume reservations',async()=>{
 const x=await setup(false);try{assert.equal((await capturePendingEvidence(x.p,x.owner)).enabled,false);assert.equal((await x.saved()).state,'evidence-pending');assert.equal((await capturePendingEvidence(x.f.caller('other'),'other')).enabled,false);assert.equal((await x.f.inspect.query('SELECT count(*)::int AS n FROM operations_telemetry_packets')).rows[0].n,0);}finally{await x.close();}
});
test('two real SQL consumers commit one immutable packet and completion; reruns do no work',async()=>{
 const x=await setup();try{const results=await Promise.all([capturePendingEvidence(x.p,x.owner),capturePendingEvidence(x.f.caller(x.owner),x.owner)]);assert.equal(results.reduce((n,r)=>n+r.captured,0),1);const saved=await x.saved();assert.equal(saved.state,'evidence-captured');assert.equal(saved.record.captureProcessing.attempts,1);assert.equal(saved.record.captureProcessing.coverage,'no-retained-context');assert.equal((await capturePendingEvidence(x.p,x.owner)).captured,0);const packet=(await x.p.query('SELECT record FROM operations_telemetry_packets WHERE user_sub=$1 AND id=$2',[x.owner,x.id])).rows[0].record;assert.equal(packet.sha256,saved.record.captureProcessing.packetSha256);assert.equal(packet.executionAuthorized,false);}finally{await x.close();}
});
test('a rule that does not request capture completes without manufacturing evidence',async()=>{
 const x=await setup();try{await x.p.query('UPDATE operations_evidence_work SET record=$3 WHERE user_sub=$1 AND id=$2',[x.owner,x.id,JSON.stringify({id:x.id,deliveryId:x.delivery.id,capture:false})]);assert.equal((await capturePendingEvidence(x.p,x.owner)).notRequested,1);assert.equal((await x.saved()).state,'evidence-not-requested');assert.equal((await x.f.inspect.query('SELECT count(*)::int AS n FROM operations_telemetry_packets')).rows[0].n,0);}finally{await x.close();}
});
test('storage failures back off, exhaust and retry only capture without repeating filtering',async()=>{
 const x=await setup();let at=Date.now();try{const broken=x.f.caller(x.owner,async(when,q)=>{if(when==='before'&&q.startsWith('INSERT INTO operations_telemetry_packets'))throw Error('fixture storage interruption');});assert.equal((await capturePendingEvidence(broken,x.owner,()=>at)).failed,1);assert.equal((await x.saved()).state,'evidence-retry');assert.equal((await capturePendingEvidence(broken,x.owner,()=>at)).failed,0);at+=10001;assert.equal((await capturePendingEvidence(broken,x.owner,()=>at)).failed,1);assert.equal((await x.saved()).state,'evidence-attention');await retryProcessing(x.p,x.owner,x.delivery.id,()=>at);assert.equal((await x.saved()).record.processing.status,'completed');assert.equal((await capturePendingEvidence(x.p,x.owner,()=>at)).captured,1);}finally{await x.close();}
});
test('disable waits for the in-flight packet commit fence and prevents later capture',async()=>{
 const x=await setup();let release,run,disable;const hold=new Promise(r=>release=r);try{let signal;const reached=new Promise(r=>signal=r);const slow=x.f.caller(x.owner,async(when,q)=>{if(when==='before'&&q.startsWith('INSERT INTO operations_telemetry_packets')){signal();await hold;}});run=capturePendingEvidence(slow,x.owner);await reached;let acknowledged=false;disable=saveProcessingConfig(x.p,x.owner,{enabled:false,captureEvidence:false,sourceIds:[x.source.id],batchSize:10,maxAttempts:2,retrySeconds:10,expectedRevision:x.config.revision},[x.source.id]).then(()=>{acknowledged=true;});let blocked=false;for(let i=0;i<100;i++){const rows=await x.f.inspect.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT record FROM operations_processing_config%'");if(rows.rows.length){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}assert.equal(blocked,true);assert.equal(acknowledged,false);release();assert.equal((await run).captured,1);await disable;assert.equal((await capturePendingEvidence(x.p,x.owner)).enabled,false);}finally{release();await Promise.allSettled([run,disable].filter(Boolean));await x.close();}
});

test('automatic capture preserves bounded matching context and redacts credentials',async()=>{
 const x=await setup();try{const resource=x.delivery.normalized.data.resource;await configureStream(x.p,x.owner,x.source,{resourceKind:resource.kind,idAttribute:'resource.id',scopeAttribute:'resource.scope',maxBankRecords:3},0);const payload={resourceLogs:[{resource:{attributes:[{key:'resource.id',value:{stringValue:resource.id}},{key:'resource.scope',value:{stringValue:resource.scope}}]},scopeLogs:[{logRecords:[{timeUnixNano:String(BigInt(x.at-1000)*1000000n),body:{stringValue:'token=private-test-value connection refused'},attributes:[{key:'log.record.uid',value:{stringValue:'context'}}]}]}]}]};await ingestTelemetry(x.p,x.owner,x.source,'otlp-logs',payload);assert.equal((await capturePendingEvidence(x.p,x.owner)).captured,1);const packet=(await x.p.query('SELECT record FROM operations_telemetry_packets WHERE user_sub=$1 AND id=$2',[x.owner,x.id])).rows[0].record;assert.equal(packet.observations.length,1);assert.equal(packet.coverage,'available-observations-only');assert.match(packet.observations[0].message,/redacted/);assert.doesNotMatch(JSON.stringify(packet),/private-test-value/);}finally{await x.close();}
});
test('a packet quotes the alert and names the pod, namespace and node from recorded inventory, and says when it cannot',async()=>{
 const f=await fixture(),owner='capture-'+randomUUID(),p=f.caller(owner),source=loadExperience().sourceDefinition({name:'Pod alerts',source:'urn:test:'+randomUUID(),environment:'local-lab'});
 try{
  await p.query('INSERT INTO operations_policy_bindings(user_sub,id,revision,record) VALUES($1,$2,$3,$4)',[owner,source.id,1,'{}']);
  await saveProcessingConfig(p,owner,{enabled:true,captureEvidence:true,sourceIds:[source.id],batchSize:10,maxAttempts:2,retrySeconds:10,expectedRevision:0},[source.id]);
  const {saveScan}=require('../routes/topology-store.js');
  await saveScan(p,owner,source,{scanId:'live-1',collectionId:'live:c/ns',observedAt:new Date(Date.now()-60000).toISOString(),complete:true,
   assets:[{provider:'kubernetes',scope:'c',kind:'node',nativeId:'node-1',name:'worker-1',health:'degraded',properties:{pressure:'MemoryPressure',allocatableCpu:'2'}},
    {provider:'kubernetes',scope:'c',kind:'pod',nativeId:'pod-uid-1',name:'cpu-pressure-abc',health:'healthy',properties:{namespace:'operations-demo',nodeName:'worker-1',phase:'Running'}}],
   relationships:[{from:{provider:'kubernetes',scope:'c',kind:'pod',nativeId:'pod-uid-1'},to:{provider:'kubernetes',scope:'c',kind:'node',nativeId:'node-1'},type:'RUNS_ON',evidence:'fixture'}]});
  const pin=async(resourceId,extra)=>{
   const event=example();Object.assign(event,{id:randomUUID(),source:source.source,time:new Date().toISOString()});
   Object.assign(event.data,{resource:{kind:'kubernetes-pod',scope:'c',id:resourceId},...extra});
   const delivery=(await admit(p,owner,source,event)).record,id=hash(['reservation',delivery.id]);
   await p.query('INSERT INTO operations_evidence_work(user_sub,id,state,record,created_at) VALUES($1,$2,$3,$4,$5)',[owner,id,'pending',JSON.stringify({id,deliveryId:delivery.id,capture:true,state:'pending'}),new Date().toISOString()]);
   await p.query('UPDATE operations_processing SET state=$3, record=$4 WHERE user_sub=$1 AND id=$2',[owner,delivery.id,'evidence-pending',JSON.stringify({sourceId:source.id,reduction:{workId:id},processing:{status:'completed'}})]);
   await capturePendingEvidence(p,owner);
   return (await p.query('SELECT record FROM operations_telemetry_packets WHERE user_sub=$1 AND id=$2',[owner,id])).rows[0].record;
  };
  const packet=await pin('pod-uid-1',{summary:'Workload over 0.45 CPU cores',labels:{alertname:'LabNodeCpuPressure',pod:'cpu-pressure-abc','bad key':'x'}});
  assert.equal(packet.alert.summary,'Workload over 0.45 CPU cores');assert.equal(packet.alert.labels.pod,'cpu-pressure-abc');assert.equal('bad key' in packet.alert.labels,false);assert.match(packet.alert.trust,/not instructions/);
  assert.equal(packet.inventory.status,'recorded');assert.equal(packet.inventory.asset.name,'cpu-pressure-abc');assert.equal(packet.inventory.asset.properties.namespace,'operations-demo');
  assert.equal(packet.inventory.runsOn.name,'worker-1');assert.equal(packet.inventory.runsOn.properties.pressure,'MemoryPressure');assert.equal(packet.executionAuthorized,false);
  const unknown=await pin('pod-uid-missing',{});
  assert.equal(unknown.inventory.status,'not-in-recorded-inventory','an unrecorded pod is said to be unrecorded, never invented');
 }finally{await f.close();}
});
