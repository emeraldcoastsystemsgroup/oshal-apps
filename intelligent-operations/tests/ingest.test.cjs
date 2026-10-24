/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the Alertmanager producer adapter: alerts map to the Operations envelope with a stable id per fingerprint and status; a mapped source admits each alert through real SQL intake (validated, deduplicated on repeat notifications, quarantined without a resource id); an unmapped source, another person's source, an oversized delivery and a malformed body admit nothing. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,loadExperience}=require('./fixtures/intake.cjs'),{alertEvent,saveIngestMapping,ingestAlertmanager,ingestMapping}=require('../routes/ingest.js');
const mapping={source:'urn:operations:source:lab-alertmanager',environment:'operations-lab',resourceKind:'kubernetes-pod',idLabel:'pod_uid',severityLabel:'severity',scope:'cluster-uid'};
const alert=(status,extra={})=>({status,labels:{alertname:'LabNodeCpuPressure',pod_uid:'pod-uid-1',severity:'critical',...extra},startsAt:'2026-10-23T08:00:00Z',endsAt:status==='resolved'?'2026-10-23T08:05:00Z':'0001-01-01T00:00:00Z',fingerprint:'f1a2b3'});

test('an Alertmanager alert becomes the Operations envelope with a stable id',()=>{
 const firing=alertEvent(mapping,alert('firing')),again=alertEvent(mapping,alert('firing')),resolved=alertEvent(mapping,alert('resolved'));
 assert.equal(firing.id,again.id,'repeat notifications of one firing alert are the same event');assert.notEqual(firing.id,resolved.id);
 assert.deepEqual(firing.data.resource,{kind:'kubernetes-pod',scope:'cluster-uid',id:'pod-uid-1'});assert.equal(firing.data.severity,'critical');assert.equal(resolved.time,'2026-10-23T08:05:00Z');
 assert.equal(alertEvent(mapping,{status:'firing',labels:{alertname:'X'}}).data.resource.id,'','a missing id label is left empty for intake to quarantine');
});

test('a mapped source admits each alert through intake; unmapped, foreign, oversized and malformed deliveries admit nothing',async()=>{
 const f=await fixture();
 try{const pool=f.caller('alice'),source=loadExperience().sourceDefinition({name:'Lab Alertmanager',environment:'operations-lab',source:'urn:operations:source:lab-alertmanager'}),sources=[source];
  await assert.rejects(ingestAlertmanager(pool,'alice',sources,source.id,{alerts:[alert('firing')]}),e=>e.status===409,'unmapped');
  for(const bad of [{sourceId:source.id,resourceKind:'node',idLabel:'pod_uid',scope:'c'},{sourceId:source.id,resourceKind:'kubernetes-pod',idLabel:'pod uid',scope:'c'},{sourceId:'other',resourceKind:'kubernetes-pod',idLabel:'pod_uid',scope:'c'},{sourceId:source.id,resourceKind:'kubernetes-pod',idLabel:'pod_uid',scope:'c',execute:true}])
   await assert.rejects(saveIngestMapping(pool,'alice',bad,sources),e=>e.status===400);
  await saveIngestMapping(pool,'alice',{sourceId:source.id,resourceKind:'kubernetes-pod',idLabel:'pod_uid',scope:'cluster-uid'},sources);
  const first=await ingestAlertmanager(pool,'alice',sources,source.id,{version:'4',status:'firing',alerts:[alert('firing'),{...alert('firing',{pod_uid:undefined}),fingerprint:'f9e8d7'}]});
  assert.equal(first.received,2);assert.equal(first.admitted,1);assert.equal(first.quarantined,1);assert.equal(first.executionAuthorized,false);
  const repeat=await ingestAlertmanager(pool,'alice',sources,source.id,{alerts:[alert('firing')]});assert.equal(repeat.results[0].retry,true,'a repeat notification is the same delivery');
  const resolved=await ingestAlertmanager(pool,'alice',sources,source.id,{alerts:[alert('resolved')]});assert.equal(resolved.admitted,1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM operations_deliveries WHERE user_sub=$1",['alice'])).rows[0].n,3);
  await assert.rejects(ingestAlertmanager(pool,'alice',sources,source.id,{alerts:Array.from({length:101},()=>alert('firing'))}),e=>e.status===413);
  await assert.rejects(ingestAlertmanager(pool,'alice',sources,source.id,{alerts:'x'}),e=>e.status===400);
  await assert.rejects(ingestAlertmanager(f.caller('bob'),'bob',[],source.id,{alerts:[alert('firing')]}),e=>e.status===404,'another person names a source they do not own');
  assert.equal(await ingestMapping(f.caller('bob'),'bob',source.id),null);
 }finally{await f.close();}
});
