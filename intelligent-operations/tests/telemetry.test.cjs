// CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise real PostgreSQL retention, rotation, transaction rollback, caller isolation and evidence survival; validate standard signal formats.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,loadExperience}=require('./fixtures/intake.cjs');
const {normalizeTelemetry,streamConfiguration}=require('../routes/telemetry-model.js');
const {configureStream,ingestTelemetry,streamRecords,telemetryWindow,pinTelemetryEvidence}=require('../routes/telemetry-store.js');
const {admit}=require('../routes/intake.js'),{example}=require('../ui/source-contract.js');
const config={resourceKind:'host',idAttribute:'host.id',scopeAttribute:'site.id',maxBankRecords:1};
const base=Date.now()-3600000,at=(offset=0)=>new Date(base+offset*1000).toISOString(),nano=offset=>String(BigInt(base+offset*1000)*1000000n);
const source=()=>loadExperience().sourceDefinition({name:'Host stream',source:'urn:triagenorth:test:'+randomUUID(),environment:'test-datacenter'});
const logs=(id,offset=0,host='host-001',body='disk queue high')=>({resourceLogs:[{resource:{attributes:[{key:'host.id',value:{stringValue:host}},{key:'site.id',value:{stringValue:'dc-east'}}]},scopeLogs:[{logRecords:[{timeUnixNano:nano(offset),severityNumber:17,body:{stringValue:body},attributes:[{key:'log.record.uid',value:{stringValue:id}}]}]}]}]});
async function setup(){const f=await fixture(),owner='stream-'+randomUUID(),p=f.caller(owner),s=source();await configureStream(p,owner,s,config,0);return {f,owner,p,s,write:(id,offset=0,body)=>ingestTelemetry(p,owner,s,'otlp-logs',logs(id,offset,'host-001',body),()=>at(offset)),close:f.close};}

test('OTLP logs require explicitly mapped resource scope and exact environment; attributes keep protobuf types',()=>{
 const s=source(),r=normalizeTelemetry(s,config,'otlp-logs',logs('one'));
 assert.equal(r[0].resource.id,'host-001');assert.equal(r[0].resource.scope,'dc-east');assert.equal(r[0].severityNumber,17);
 const unmapped=logs('bad');unmapped.resourceLogs[0].resource.attributes.pop();assert.throws(()=>normalizeTelemetry(s,config,'otlp-logs',unmapped),/unmapped/);
 const wrong=logs('bad');wrong.resourceLogs[0].resource.attributes.push({key:'deployment.environment.name',value:{stringValue:'another-datacenter'}});assert.throws(()=>normalizeTelemetry(s,config,'otlp-logs',wrong),/environment differs/);
 const bad=logs('bad');bad.resourceLogs[0].resource.attributes[0].value={stringValue:true};assert.throws(()=>normalizeTelemetry(s,config,'otlp-logs',bad),/declared protobuf type/);
 assert.throws(()=>streamConfiguration({...config,retentionSeconds:60}),/900-second/);
});
test('OTLP numeric metrics preserve unit, temporality and time ties without unsafe integer coercion',()=>{
 const s=source(),body={resourceMetrics:[{resource:logs('x').resourceLogs[0].resource,scopeMetrics:[{metrics:[{name:'host.disk.queue',unit:'1',gauge:{dataPoints:[{timeUnixNano:nano(0),asDouble:4},{timeUnixNano:nano(0),asDouble:5}]}}]}]}]};
 const result=normalizeTelemetry(s,config,'otlp-metrics',body);assert.equal(result.length,2);assert.notEqual(result[0].id,result[1].id);assert.equal(result[0].unit,'1');
 const point=body.resourceMetrics[0].scopeMetrics[0].metrics[0].gauge.dataPoints[0];delete point.asDouble;point.asInt='9007199254740993';assert.throws(()=>normalizeTelemetry(s,config,'otlp-metrics',body),/accurately/);
 delete point.asInt;point.asDouble='4';assert.throws(()=>normalizeTelemetry(s,config,'otlp-metrics',body),/must be numbers/);
});
test('CloudWatch subscriptions bind account, group and explicit stream mapping; control messages are not observations',()=>{
 const s=source(),c={...config,resourceKind:'aws-resource',cloudwatch:{account:'123456789012',region:'us-east-1',logGroup:'/demo/servers',streams:[{stream:'i-demo',scope:'123456789012/us-east-1',id:'i-demo'}]}},body={owner:'123456789012',messageType:'DATA_MESSAGE',logGroup:'/demo/servers',logStream:'i-demo',logEvents:[{id:'aws-event-1',timestamp:base,message:'connection refused'}]};
 const r=normalizeTelemetry(s,c,'cloudwatch',body);assert.equal(r[0].resource.id,'i-demo');assert.equal(r[0].attributes['cloud.region'],'us-east-1');
 assert.throws(()=>normalizeTelemetry(s,c,'cloudwatch',{...body,owner:'999999999999'}),/account\/log group/);
 assert.throws(()=>normalizeTelemetry(s,c,'cloudwatch',{...body,logStream:'guessed-hostname'}),/mapped stream/);
 assert.deepEqual(normalizeTelemetry(s,c,'cloudwatch',{...body,messageType:'CONTROL_MESSAGE'}),[]);
});
test('three banks rotate on capacity; all fresh banks backpressure without deleting protected observations',async()=>{
 const x=await setup();try{for(let i=0;i<3;i++)assert.equal((await x.write('event-'+i,i)).accepted,1);
  await assert.rejects(x.write('fourth',3),e=>e.status===429);
  const state=(await streamRecords(x.p,x.owner)).streams[0];assert.deepEqual(state.banks.map(b=>b.count),[1,1,1]);assert.equal(state.active,2);
  const next=await x.write('fourth',900);assert.equal(next.activeBank,0);assert.equal(next.rotations[0].generation,1);
  assert.equal((await x.f.inspect.query('SELECT count(*)::int AS n FROM operations_telemetry_0')).rows[0].n,1);
 }finally{await x.close();}
});
test('partial batch capacity failure rolls back every inserted row and the active bank',async()=>{
 const x=await setup();try{const payload=logs('one');const record=payload.resourceLogs[0].scopeLogs[0].logRecords[0];payload.resourceLogs[0].scopeLogs[0].logRecords=Array.from({length:4},(_,i)=>({...record,attributes:[{key:'log.record.uid',value:{stringValue:'item-'+i}}]}));
  await assert.rejects(ingestTelemetry(x.p,x.owner,x.s,'otlp-logs',payload,()=>at(0)),e=>e.status===429);
  assert.deepEqual((await streamRecords(x.p,x.owner)).streams[0].banks.map(b=>b.count),[0,0,0]);
  for(const table of ['operations_telemetry_0','operations_telemetry_1','operations_telemetry_2'])assert.equal((await x.f.inspect.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n,0);
 }finally{await x.close();}
});
test('fresh banks grow within explicit ceilings without erasing old rows; reviewed capacity increases keep source identity',async()=>{
 const f=await fixture(),owner='growth-'+randomUUID(),p=f.caller(owner),s=source();try{
  await configureStream(p,owner,s,{...config,initialBankRecords:1,maxBankRecords:4,autoGrow:true},0);
  for(let i=0;i<12;i++)await ingestTelemetry(p,owner,s,'otlp-logs',logs('grow-'+i,i),()=>at(i));
  const state=(await streamRecords(p,owner)).streams[0];assert.equal(state.banks.reduce((n,b)=>n+b.count,0),12);assert.deepEqual(state.banks.map(b=>b.capacityRecords),[4,4,4]);assert.ok(state.banks.every(b=>b.generation===0||b.generation===1));
  await assert.rejects(ingestTelemetry(p,owner,s,'otlp-logs',logs('over',12),()=>at(12)),e=>e.status===429);
  const increased=await configureStream(p,owner,s,{...state.config,maxBankRecords:8},state.revision);assert.equal(increased.id,s.id);
  assert.equal((await ingestTelemetry(p,owner,s,'otlp-logs',logs('after-review',13),()=>at(13))).accepted,1);
  await assert.rejects(configureStream(p,owner,s,{...increased.config,idAttribute:'host.name'},increased.revision),e=>e.status===409);
  await assert.rejects(configureStream(p,owner,s,{...increased.config,maxBankRecords:4},increased.revision),e=>e.status===409);
  assert.equal((await telemetryWindow(p,owner,s.id,{kind:'host',scope:'dc-east',id:'host-001'},at(13))).matched,13);
 }finally{await f.close();}
});
test('independent pools serialize retries and reject reused telemetry IDs with different content',async()=>{
 const x=await setup();try{const p2=x.f.caller(x.owner),results=await Promise.all(Array.from({length:8},(_,i)=>ingestTelemetry(i%2?p2:x.p,x.owner,x.s,'otlp-logs',logs('same'),()=>at(0))));
  assert.equal(results.reduce((sum,r)=>sum+r.accepted,0),1);assert.equal(results.reduce((sum,r)=>sum+r.duplicates,0),7);
  await assert.rejects(x.write('same',0,'changed content'),e=>e.status===409);
  assert.equal((await streamRecords(x.p,x.owner)).streams[0].banks[0].count,1);
 }finally{await x.close();}
});
test('forced SQL owner policies and exact native identities prevent cross-user and cross-host context reads',async()=>{
 const x=await setup();try{await x.write('first');const intruder=x.f.caller('another-user');assert.equal((await streamRecords(intruder,'another-user')).streams.length,0);
  await assert.rejects(telemetryWindow(intruder,'another-user',x.s.id,{kind:'host',scope:'dc-east',id:'host-001'},at(0)),e=>e.status===404);
  assert.equal((await telemetryWindow(x.p,x.owner,x.s.id,{kind:'host',scope:'dc-east',id:'different-host'},at(0))).matched,0);
  assert.equal((await telemetryWindow(x.p,x.owner,x.s.id,{kind:'host',scope:'dc-east',id:'host-001'},at(0))).matched,1);
  await assert.rejects(intruder.query('INSERT INTO operations_telemetry_packets(user_sub,id,record) VALUES($1,$2,$3)',[x.owner,'forged','{}']),/row-level security/);
 }finally{await x.close();}
});
test('durable evidence pins only a capture reservation and survives reuse of its raw telemetry bank',async()=>{
 const x=await setup();try{
  await x.write('context',0,'token=private-value queue full');const raw=example();Object.assign(raw,{source:x.s.source,time:at(5)});Object.assign(raw.data,{environment:x.s.environment,resource:{kind:'host',scope:'dc-east',id:'host-001'}});
  const delivery=(await admit(x.p,x.owner,x.s,raw)).record,workId='a'.repeat(64),work={id:workId,deliveryId:delivery.id,capture:true,state:'pending'};
  // A committed reservation is a prerequisite supplied by filtering; these rows deliberately test the consumer boundary alone.
  await x.p.query('INSERT INTO operations_evidence_work(user_sub,id,state,record,created_at) VALUES($1,$2,$3,$4,$5)',[x.owner,workId,'pending',JSON.stringify(work),at(5)]);
  const packet=await pinTelemetryEvidence(x.p,x.owner,workId);assert.equal(packet.observations.length,1);assert.match(packet.observations[0].message,/\[redacted\]/);assert.doesNotMatch(JSON.stringify(packet),/private-value/);assert.equal(packet.executionAuthorized,false);assert.equal(packet.rawStreamAccess,false);
  await x.write('next',1);await x.write('next2',2);await x.write('reused',900);
  assert.equal((await telemetryWindow(x.p,x.owner,x.s.id,raw.data.resource,at(5))).matched,2);
  assert.deepEqual(await pinTelemetryEvidence(x.p,x.owner,workId),{...packet,retry:true});
  await assert.rejects(pinTelemetryEvidence(x.p,x.owner,'b'.repeat(64)),e=>e.status===409);
 }finally{await x.close();}
});
