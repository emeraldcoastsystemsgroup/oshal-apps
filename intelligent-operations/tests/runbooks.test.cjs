/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Guard owner runbooks: one per alert type, revision-checked, bounded, own scope; an automatic investigation for that alert type attaches it as evidence/runbook.md and its digest is part of the sealed input; without a runbook nothing extra is attached. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,loadExperience}=require('./fixtures/intake.cjs'),{admit}=require('../routes/intake'),{publishPolicy,evaluateDelivery}=require('../routes/pipeline'),{saveProcessingConfig}=require('../routes/processing-worker'),{capturePendingEvidence}=require('../routes/evidence-worker'),{autoInvestigate}=require('../routes/auto-investigate'),{runbooks,saveRunbook,removeRunbook}=require('../routes/runbooks'),{example}=require('../ui/source-contract');

test('runbooks are one per alert type, revision-checked, bounded and the caller\'s own',async()=>{
 const f=await fixture();
 try{const pool=f.caller('alice');
  for(const bad of [{alertType:'',markdown:'x',expectedRevision:0},{alertType:'A',markdown:'',expectedRevision:0},{alertType:'A',markdown:'x'.repeat(16385),expectedRevision:0},{alertType:'A',markdown:'x',expectedRevision:0,run:true},{alertType:' A',markdown:'x',expectedRevision:0}])
   await assert.rejects(saveRunbook(pool,'alice',bad),e=>e.status===400);
  const first=await saveRunbook(pool,'alice',{alertType:'LabNodeCpuPressure',markdown:'# Stop\nTouch the stop file.',expectedRevision:0});assert.equal(first.revision,1);
  await assert.rejects(saveRunbook(pool,'alice',{alertType:'LabNodeCpuPressure',markdown:'new',expectedRevision:0}),e=>e.status===409);
  assert.equal((await saveRunbook(pool,'alice',{alertType:'LabNodeCpuPressure',markdown:'v2',expectedRevision:1})).revision,2);
  assert.equal((await runbooks(pool,'alice')).items.length,1);assert.equal((await runbooks(f.caller('bob'),'bob')).items.length,0,'another person sees none');
  assert.deepEqual(await removeRunbook(pool,'alice',{alertType:'LabNodeCpuPressure'}),{removed:true});assert.equal((await runbooks(pool,'alice')).items.length,0);
 }finally{await f.close();}
});

test('an investigation attaches the owner\'s runbook for its alert type and seals its digest',async()=>{
 const f=await fixture();
 try{const owner='alice',pool=f.caller(owner),source=loadExperience().sourceDefinition({name:'Auto',source:'urn:triagenorth:test:'+randomUUID(),environment:'test'});
  const detection=async(op,_o,input)=>op==='publish'?{revision:input.revision,count:input.rules.length,sealed:true}:{revision:input.revision,matches:[policy.policy.rules[0].id],total:1,complete:true};
  const policy=await publishPolicy(pool,detection,owner,source,{name:'Incident',window:{mode:'sliding',seconds:900},rules:[{name:'Firing',enabled:true,capture:true,query:{term:{status:'firing'}}}]},0);
  const event=example();event.id=randomUUID();event.source=source.source;event.data.environment='test';event.data.resource={kind:'kubernetes-pod',scope:'cluster',id:'pod-1'};
  const d=(await admit(pool,owner,source,event)).record;await evaluateDelivery(pool,detection,owner,d.id);
  await saveProcessingConfig(pool,owner,{enabled:true,captureEvidence:true,autoInvestigate:true,sourceIds:[source.id],batchSize:10,maxAttempts:3,retrySeconds:10,expectedRevision:0},[source.id]);
  const book=await saveRunbook(pool,owner,{alertType:event.data.alertType,markdown:'# Restart loop\nConfirm the pod, then restart the container.',expectedRevision:0});
  assert.equal((await capturePendingEvidence(pool,owner)).captured,1);
  const starts=[],tickets=new Map(),port={async createTicket(input){const id=randomUUID();tickets.set(id,{ticketId:id,ticketType:input.ticketType,status:'queued',revision:0});return {ticketId:id};},async getTicket(id){return tickets.get(id)||null;},async startTicket(id,input){starts.push(input);tickets.get(id).status='running';return {status:'queued'};}};
  assert.equal((await autoInvestigate({pool,ticketService:port},owner)).started,1);
  const files=Object.fromEntries(starts[0].files.map(x=>[x.path,Buffer.from(x.bytes).toString()]));
  assert.match(files['evidence/runbook.md'],/Confirm the pod, then restart the container/);assert.match(files['evidence/runbook.md'],/Owner runbook for ContainerRestartLoop \(revision 1\)/);
  assert.equal(JSON.parse(files['evidence/packet.json']).runbook.sha256,book.sha256,'the sealed input names the runbook it was given');
  assert.match(starts[0].prompt,/owner's own runbook/);
 }finally{await f.close();}
});
