/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Alert profile boundary, scoped identity and independent occurrence tests. */
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const C=require('../ui/source-contract.js');const M=require('../ui/operations-model.js');
const validate=(event,source)=>C.validate(JSON.stringify(event),source);
test('a bounded example exposes delivery and symptom identities without treating severity or text as identity',()=>{
  const event=C.example(),a=validate(event);assert.equal(a.ok,true);
  event.id='next-occurrence';event.data.severity='critical';event.data.message='different error wording';event.data.status='resolved';
  const b=validate(event);assert.equal(b.ok,true);assert.notDeepEqual(a.deliveryIdentity,b.deliveryIdentity);assert.deepEqual(a.symptomIdentity,b.symptomIdentity);
  event.data.alertType='DifferentFailure';assert.notDeepEqual(validate(event).symptomIdentity,b.symptomIdentity);
});
test('scope, environment and source stay in symptom identity, preserving resource case',()=>{
  const event=C.example(),base=validate(event).symptomIdentity;
  for(const [target,key] of [[event,'source'],[event.data,'environment'],[event.data.resource,'scope'],[event.data.resource,'id']]){
    const old=target[key];target[key]=key==='source'?'urn:other:source':old+'OTHER';assert.notDeepEqual(validate(event).symptomIdentity,base);target[key]=old;
  }
});
test('missing and forged source identities, malformed shape and padded IDs fail without returning raw input',()=>{
  for(const input of ['null','[]','42','{'])assert.equal(C.validate(input).ok,false);
  const event=C.example();assert.equal(validate(event,'urn:different:source').ok,false);
  for(const field of ['id','source','time','type','data']){
    const copy=structuredClone(event);delete copy[field];assert.equal(validate(copy).ok,false,field);
  }
  for(const resource of [{kind:'container',id:'x'},{kind:'container',scope:'cluster/x'},{kind:'unrecognized',id:'x',scope:'cluster/x'}]){
    const copy=structuredClone(event);copy.data.resource=resource;assert.equal(validate(copy).ok,false);
  }
  for(const id of ['', ' ', ' x', 'x\n','x\u009f']){event.id=id;assert.equal(validate(event).ok,false);}
  event.id='safe';event.source='https://user:password@example.test/events';const failed=validate(event);assert.equal(failed.ok,false);assert.doesNotMatch(JSON.stringify(failed),/password/);
});
test('calendar validation rejects rollover, missing timezone and leap seconds, accepts real offsets and leap days',()=>{
  const event=C.example();
  for(const time of ['2026-02-29T00:00:00Z','2026-04-31T00:00:00Z','2026-10-20T24:00:00Z','2026-10-20T00:00:60Z','2026-10-20T00:00:00','2026-10-20T00:00:00+24:00']){
    event.time=time;assert.equal(validate(event).ok,false,time);
  }
  for(const time of ['2024-02-29T00:00:00Z','2026-10-20T12:00:00-05:00']){event.time=time;assert.equal(validate(event).ok,true,time);}
});
test('size limit counts UTF-8 bytes and rejects mixed base64 content and unsupported profiles',()=>{
  const event=C.example();event.data.message='é'.repeat(34000);assert.equal(validate(event).ok,false);
  delete event.data.message;event.data_base64='eA==';assert.equal(validate(event).ok,false);delete event.data_base64;
  event.dataschema='urn:unregistered:schema';assert.equal(validate(event).ok,false);
});
test('ticket projection keeps separate tickets and reports workflow completion without claiming recovery',()=>{
  const rows=M.tickets({tickets:[{id:'1',kind:'intelligent-operations',title:'Same title',status:'done',updated_at:1000},{id:'2',kind:'intelligent-operations',title:'Same title',status:'awaiting_approval',updated_at:2000},{id:'3',kind:'intelligent-processing',status:'unknown-new-state'},{id:'x',kind:'other',status:'running'}]});
  assert.equal(rows.length,3);assert.equal(rows[0].id,'2');assert.equal(rows[1].label,'Workflow finished');assert.equal(rows[2].title,'Incident ticket');
  assert.deepEqual(M.summary(rows),{total:3,active:1,attention:2});assert.equal(rows[2].updated,null);
  assert.throws(()=>M.tickets({}));assert.throws(()=>M.tickets({tickets:[{kind:'intelligent-operations'}]}));
  assert.deepEqual(M.summary(M.tickets({tickets:[]})),{total:0,active:0,attention:0});
});

test('adapter mappings preserve authenticated-envelope candidates and normalize explicit escaped paths without coercion',()=>{
  const Mapping=require('../ui/adapter-mapping.js'),Contract=require('../ui/source-contract.js');
  const event=Contract.example();event.data.labels={'pod/uid':'Pod-UID-A','scope~name':'cluster/example-cluster'};
  delete event.data.resource.id;delete event.data.resource.scope;
  const mapping={...Mapping.DEFAULTS,id:'/data/labels/pod~1uid',scope:'/data/labels/scope~0name'};
  const before=JSON.stringify(event),result=Mapping.normalize(before,mapping,event.source);
  assert.equal(result.ok,true);assert.equal(result.normalized.data.resource.id,'Pod-UID-A');assert.equal(JSON.stringify(event),before);
  assert.deepEqual(result.deliveryIdentity,[event.source,event.id]);assert.equal(result.symptomIdentity[4],'Pod-UID-A');
  assert.equal(Object.hasOwn(result.normalized.data,'labels'),false);
  assert.equal(Mapping.normalize(before,mapping,'urn:operations:source:foreign').ok,false);
  assert.equal(Mapping.normalize(before,{...mapping,source:'/data/source'}).ok,false);
  event.data.labels['pod/uid']=123;assert.equal(Mapping.normalize(JSON.stringify(event),mapping).ok,false);
});

test('adapter mappings fail closed on missing fields, reserved paths, invalid escapes, array indices and excessive inputs',()=>{
  const Mapping=require('../ui/adapter-mapping.js'),Contract=require('../ui/source-contract.js'),sample=Contract.example();
  for(const id of ['/data/absent','/data/__proto__/id','/data/constructor','/data/resource/id~2','not/a/pointer','/'+'a/'.repeat(13),'/data/\u0000','/data/labels/01','/data/labels/-']){
    sample.data.labels=['uid'];const result=Mapping.normalize(JSON.stringify(sample),{...Mapping.DEFAULTS,id});assert.equal(result.ok,false,id);
    assert.equal(Object.hasOwn(result,'normalized'),false);assert.equal(Object.hasOwn(result,'symptomIdentity'),false);
  }
  sample.data.labels=['uid'];assert.equal(Mapping.normalize(JSON.stringify(sample),{...Mapping.DEFAULTS,id:'/data/labels/0'}).resource.id,'uid');
  assert.equal(Mapping.normalize('x'.repeat(65537)).ok,false);
  sample.data.padding='é'.repeat(35000);assert.equal(Mapping.normalize(JSON.stringify(sample)).ok,false);
  delete sample.data.padding;sample.data.labels={'~1':'literal-tilde-one'};
  assert.equal(Mapping.normalize(JSON.stringify(sample),{...Mapping.DEFAULTS,id:'/data/labels/~01'}).resource.id,'literal-tilde-one');
  sample.data_base64='e30=';assert.equal(Mapping.normalize(JSON.stringify(sample)).ok,false);
  assert.equal(Mapping.normalize('{}',{}).ok,false);assert.equal(Mapping.normalize('[]').ok,false);assert.equal(Mapping.normalize('{').ok,false);
});

test('synthetic data decisions distinguish delivery retries, repeated symptoms, filtering and unauthorized scope',()=>{
  const Demo=require('../prototype/data-model.js');const result=Demo.inspect();
  assert.equal(result.received,8);assert.equal(result.eligible,3);assert.equal(result.updates,1);assert.equal(result.retries,1);
  assert.equal(result.rows[0].key,result.rows[2].key);assert.equal(result.rows[2].snapshot,true);
  assert.notEqual(result.rows[0].key,result.rows[7].key,'cross-source correlation must be explicit');
  assert.equal(result.rows[5].outcome,'Quarantined');assert.equal(result.rows[6].raw,null);assert.equal(result.rows[6].key,null);
  assert.equal(Demo.inspect('critical').eligible,1);assert.equal(Demo.inspect('info').eligible,4);assert.equal(Demo.inspect('warning',false).eligible,4);
  assert.throws(()=>Demo.inspect('bogus'));assert.equal(Demo.inspect().eligible,3,'replays have independent state');
});
