/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Guard automatic post-reduction correlation: only an explicit opt-in correlates, only newly admitted ticks trigger it, the admitted firing cohort of the policy window is correlated once (idempotent on an unchanged cohort), and a bounded policy is enforced. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,loadExperience}=require('./fixtures/intake.cjs'),{admit}=require('../routes/intake'),{publishPolicy,evaluateDelivery,pipelineRecords}=require('../routes/pipeline'),{saveProcessingConfig,processingConfig}=require('../routes/processing-worker'),{correlateAdmitted}=require('../routes/correlation-tick'),{example}=require('../ui/source-contract');
test('an opted-in tick correlates the admitted firing cohort once and reports degraded or unresolved evidence honestly',async()=>{
 const f=await fixture();try{const owner='alice',pool=f.caller(owner),source=loadExperience().sourceDefinition({name:'Correlation',source:'urn:triagenorth:test:'+randomUUID(),environment:'test'});
  const detection=async(op,_o,input)=>op==='publish'?{revision:input.revision,count:input.rules.length,sealed:true}:{revision:input.revision,matches:[policy.policy.rules[0].id],total:1,complete:true};
  const policy=await publishPolicy(pool,detection,owner,source,{name:'Incident',window:{mode:'sliding',seconds:900},rules:[{name:'Firing',enabled:true,capture:false,query:{term:{status:'firing'}}}]},0);
  const admitted=[];for(const id of ['pod-a','pod-b']){const event=example();event.id=randomUUID();event.source=source.source;event.data.environment='test';event.data.resource={kind:'kubernetes-pod',scope:'cluster-uid',id};const delivery=(await admit(pool,owner,source,event)).record;admitted.push(await evaluateDelivery(pool,detection,owner,delivery.id));}
  assert.deepEqual(admitted.map(d=>d.reduction.outcome),['admitted','admitted']);const results=admitted.map(d=>({deliveryId:d.deliveryId,outcome:d.reduction.outcome}));
  await saveProcessingConfig(pool,owner,{enabled:true,sourceIds:[source.id],batchSize:10,maxAttempts:3,retrySeconds:10,expectedRevision:0},[source.id]);
  assert.deepEqual(await correlateAdmitted(pool,owner,results),{enabled:false},'without the opt-in nothing is correlated');
  await assert.rejects(saveProcessingConfig(pool,owner,{enabled:true,sourceIds:[source.id],batchSize:10,maxAttempts:3,retrySeconds:10,correlate:true,correlationPolicy:{id:'x',types:['OWNS'],maxDepth:1,maxVisited:1,maxAgeSeconds:1},expectedRevision:1},[source.id]),{status:400});
  const config=await saveProcessingConfig(pool,owner,{enabled:true,sourceIds:[source.id],batchSize:10,maxAttempts:3,retrySeconds:10,correlate:true,expectedRevision:1},[source.id]);assert.equal(config.correlate,true);assert.equal(config.correlationPolicy.id,'scheduled-dependencies-v1');
  assert.equal((await correlateAdmitted(pool,owner,[{deliveryId:'x',outcome:'suppressed'}])).correlated,false,'a tick without new admissions correlates nothing');
  const first=await correlateAdmitted(pool,owner,results);assert.equal(first.correlated,true);assert.equal(first.deliveries,2);assert.equal(first.retry,false);assert.equal(first.trigger,'scheduled-tick');assert.equal(first.degraded,true,'missing graph assets require an explicitly degraded tick receipt');
  const again=await correlateAdmitted(pool,owner,results);assert.equal(again.correlationId,first.correlationId);assert.equal(again.retry,true,'an unchanged cohort reuses the record');
  const saved=(await pipelineRecords(pool,owner)).correlations;assert.equal(saved.length,1);assert.equal(saved[0].automaticDispatch,false);assert.equal(saved[0].deliveryIds.length,2);assert.ok(saved[0].events.every(e=>e.assetId.startsWith('unresolved-')),'without a recorded graph every event is explicitly unresolved');
  assert.equal((await correlateAdmitted(f.caller('bob'),'bob',results)).enabled,false);assert.equal((await processingConfig(f.caller('bob'),'bob')).correlate,undefined);
 }finally{await f.close();}
});
