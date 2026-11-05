/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | A first-use tick does no evaluation, capture, discovery, investigation or notification for an empty default owner or explicitly disabled evaluation with pending admitted data. All SQL and owner policies are real. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,loadExperience}=require('./fixtures/intake.cjs'),{engineFixture}=require('./fixtures/detection.cjs');
const {processingTick}=require('../routes/processing-tick'),{processingConfig,saveProcessingConfig,processingRecords}=require('../routes/processing-worker');
const {admit,hash}=require('../routes/intake'),{publishPolicy,pipelineRecords}=require('../routes/pipeline'),{example}=require('../ui/source-contract');
function ports(pool){const calls={engine:[],notify:[],ticket:[],connector:[]};return {calls,ctx:{pool,notify:async(...args)=>{calls.notify.push(args);return {sent:true};},intent:async(...args)=>{calls.connector.push(args);throw Error('Unexpected intent');},ticketService:{createTicket:async(...args)=>{calls.ticket.push(args);throw Error('Unexpected ticket');}}},engine:async(...args)=>{calls.engine.push(args);throw Error('Unexpected evaluation');}};}
async function noWork(pool,owner,read,expectedJobs=[]){
 const {ctx,engine,calls}=ports(pool);const result=await processingTick(ctx,engine,owner,read);
 assert.equal(result.failed,0,JSON.stringify(result));assert.equal(result.body.enabled,false);assert.equal(result.body.evaluated,0);assert.equal(result.body.discovery.enabled,false);assert.equal(result.body.evidence.enabled,false);assert.equal(result.body.investigation.enabled,false);
 assert.deepEqual(calls,{engine:[],notify:[],ticket:[],connector:[]});
 const records=await pipelineRecords(pool,owner);for(const key of ['decisions','symptoms','evidenceWork','correlations'])assert.equal(records[key].length,0,key);
 assert.deepEqual((await processingRecords(pool,owner)).jobs,expectedJobs);return result;
}
test('a fresh owner can receive repeated first-use ticks without work or messages from default settings',async()=>{
 const f=await fixture();try{const owner='default-'+randomUUID(),pool=f.caller(owner);assert.equal((await processingConfig(pool,owner)).enabled,false);
  for(let i=0;i<2;i++)await noWork(pool,owner,async()=>[]);
 }finally{await f.close();}
});
test('disabled evaluation leaves eligible admitted data untouched and enables no other work or messages',async()=>{
 const f=await fixture();let e,index;try{e=await engineFixture();const owner='disabled-'+randomUUID(),pool=f.caller(owner),source=loadExperience().sourceDefinition({name:'Disabled first use',source:example().source,environment:'local-lab'});
  const policy=await publishPolicy(pool,e.engine,owner,source,{name:'Eligible critical',rules:[{name:'Critical',enabled:true,capture:true,query:{term:{severity:'critical'}}}],window:{mode:'sliding',seconds:900}},0);index='ops-rules-'+hash(['detection-owner-v1',owner])+'-'+policy.policy.id;
  const flags={captureEvidence:true,correlate:true,autoInvestigate:true,sourceIds:[source.id],batchSize:10,maxAttempts:3,retrySeconds:10};
  await saveProcessingConfig(pool,owner,{...flags,enabled:true,expectedRevision:0},[source.id]);
  const event=example();event.id='first-use-'+randomUUID();event.data.severity='critical';const delivery=await admit(pool,owner,source,event);assert.ok(delivery.record);
  const revision=(await processingConfig(pool,owner)).revision;await saveProcessingConfig(pool,owner,{...flags,enabled:false,expectedRevision:revision},[source.id]);
  // No watch/mapping was enabled here: processing disable is not a global stop for an independently configured silence watch.
  const pending=(await processingRecords(pool,owner)).jobs;assert.equal(pending.length,1);await noWork(pool,owner,async()=>[source],pending);
 }finally{if(e)await e.close();await f.close();if(index){const removed=await fetch(process.env.OSHAL_TEST_SEARCH+'/'+index,{method:'DELETE'});assert.ok(removed.ok);}}
});
