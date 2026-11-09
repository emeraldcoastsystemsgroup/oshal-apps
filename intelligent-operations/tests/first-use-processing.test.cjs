/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | The four desks changed what a first tick does for a fresh person (spec lanes/monitoring-four-desks-spec-2026-11-08.md, 1.5.0): it creates the four desk sources, publishes their default policies through the real percolator and lists them for processing, and that is all. It still calls no connector, opens no ticket and sends no message, and a second tick changes nothing and calls no engine. Disabled evaluation keeps its meaning once the desks exist. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | A first-use tick does no evaluation, capture, discovery, investigation or notification for an empty default owner or explicitly disabled evaluation with pending admitted data. All SQL and owner policies are real. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,loadExperience,root}=require('./fixtures/intake.cjs'),{engineFixture}=require('./fixtures/detection.cjs');
const {processingTick}=require('../routes/processing-tick'),{processingConfig,saveProcessingConfig,processingRecords}=require('../routes/processing-worker');
const {admit,hash}=require('../routes/intake'),{publishPolicy,pipelineRecords}=require('../routes/pipeline'),{example}=require('../ui/source-contract'),{DESKS}=require('../routes/desks');
/** The ports a tick can reach, each counted: the store is a real seam (the desks live in it), the rail, tickets and connectors must stay untouched. */
function ports(pool,stored){const calls={engine:[],notify:[],ticket:[],connector:[]};return {calls,stored,ctx:{pool,appPackageDir:root,store:{query:async name=>name==='sources'?stored.slice():[],put:async(collection,id,body)=>{stored.push({...body,id});}},notify:async(...args)=>{calls.notify.push(args);return {sent:true};},intent:async(...args)=>{calls.connector.push(args);throw Error('Unexpected intent');},ticketService:{createTicket:async(...args)=>{calls.ticket.push(args);throw Error('Unexpected ticket');}}},engine:async(...args)=>{calls.engine.push(args);throw Error('Unexpected evaluation');}};}
const indexesOf=async(pool,owner)=>(await pool.query('SELECT id FROM operations_policies WHERE user_sub=$1',[owner])).rows.map(r=>'ops-rules-'+hash(['detection-owner-v1',owner])+'-'+r.id);
async function noWork(pool,owner,stored,expectedJobs=[]){
 const {ctx,engine,calls}=ports(pool,stored);const result=await processingTick(ctx,engine,owner,async()=>stored.slice());
 assert.equal(result.failed,0,JSON.stringify(result));assert.equal(result.body.evaluated,0);assert.equal(result.body.discovery.enabled,false,'scheduled discovery stays off');assert.equal(result.body.evidence.captured,0);assert.equal(result.body.investigation.started||0,0);
 assert.deepEqual(calls,{engine:[],notify:[],ticket:[],connector:[]},'no engine, rail, ticket or connector call');
 const records=await pipelineRecords(pool,owner);for(const key of ['decisions','symptoms','evidenceWork','correlations'])assert.equal(records[key].length,0,key);
 assert.deepEqual((await processingRecords(pool,owner)).jobs,expectedJobs);return result;
}
test('a fresh owner\'s first tick activates the four desks and nothing else; later ticks do no work and send no message',async()=>{
 const f=await fixture();let e,indexes=[];try{e=await engineFixture();const owner='default-'+randomUUID(),pool=f.caller(owner),stored=[];assert.equal((await processingConfig(pool,owner)).enabled,false);
  const {ctx,calls}=ports(pool,stored);const first=await processingTick(ctx,e.engine,owner,async()=>stored.slice());indexes=await indexesOf(pool,owner);
  assert.equal(first.failed,0,JSON.stringify(first.body));assert.deepEqual(first.body.desks.desks.map(d=>[d.id,d.created,d.policy]),DESKS.map(d=>[d.id,true,'published']));
  assert.deepEqual(stored.map(s=>s.source),DESKS.map(d=>d.uri),'the four desk sources and no other');
  assert.deepEqual({notify:calls.notify,ticket:calls.ticket,connector:calls.connector},{notify:[],ticket:[],connector:[]},'activation sends nothing, opens nothing, reaches no connector');
  assert.equal(first.body.evaluated,0);assert.equal(first.body.evidence.captured,0);
  const config=await processingConfig(pool,owner);assert.equal(config.enabled,true,'the desks are listed for processing');assert.equal(config.sourceIds.length,4);
  // From here on, with nothing delivered, a tick is no work: no engine call (the desks are kept), no message.
  for(let i=0;i<2;i++){const result=await noWork(pool,owner,stored);assert.deepEqual(result.body.desks.desks.map(d=>d.policy),['kept','kept','kept','kept']);assert.equal(result.body.enabled,true);}
 }finally{if(e)await e.close();await f.close();for(const index of indexes)await fetch(process.env.OSHAL_TEST_SEARCH+'/'+index,{method:'DELETE'}).catch(()=>{});}
});
test('disabled evaluation leaves eligible admitted data untouched and enables no other work or messages',async()=>{
 const f=await fixture();let e,indexes=[];try{e=await engineFixture();const owner='disabled-'+randomUUID(),pool=f.caller(owner),source=loadExperience().sourceDefinition({name:'Disabled first use',source:example().source,environment:'local-lab'}),stored=[source];
  // The desks exist first, as they would for any person the schedule runs for; then the person configures and disables evaluation.
  const activation=await processingTick(ports(pool,stored).ctx,e.engine,owner,async()=>stored.slice());assert.equal(activation.failed,0,JSON.stringify(activation.body));
  await publishPolicy(pool,e.engine,owner,source,{name:'Eligible critical',rules:[{name:'Critical',enabled:true,capture:true,query:{term:{severity:'critical'}}}],window:{mode:'sliding',seconds:900}},0);
  const held=await processingConfig(pool,owner),flags={captureEvidence:true,correlate:true,autoInvestigate:true,sourceIds:[...held.sourceIds,source.id].sort(),batchSize:10,maxAttempts:3,retrySeconds:10};
  await saveProcessingConfig(pool,owner,{...flags,enabled:true,expectedRevision:held.revision},flags.sourceIds);
  const event=example();event.id='first-use-'+randomUUID();event.data.severity='critical';const delivery=await admit(pool,owner,source,event);assert.ok(delivery.record);
  const revision=(await processingConfig(pool,owner)).revision;await saveProcessingConfig(pool,owner,{...flags,enabled:false,expectedRevision:revision},flags.sourceIds);indexes=await indexesOf(pool,owner);
  // No watch/mapping was enabled on this source: processing disable is not a global stop for an independently configured silence watch.
  const pending=(await processingRecords(pool,owner)).jobs;assert.equal(pending.length,1);const result=await noWork(pool,owner,stored,pending);assert.equal(result.body.enabled,false);
 }finally{if(e)await e.close();await f.close();for(const index of indexes)await fetch(process.env.OSHAL_TEST_SEARCH+'/'+index,{method:'DELETE'}).catch(()=>{});}
});
