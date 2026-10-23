/* CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Guard the refused-versus-uncertain distinction. */
/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Assert the concurrency invariant (each tick at most two, no capture started twice) instead of a timing-dependent total. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Guard automatic investigation dispatch: only with the opt-in and evidence capture, at most two per tick, one start per captured evidence across concurrent ticks, sealed packet input to the kernel start port, an uncertain start held and never retried, and an explicit unavailable state when the kernel has no start port. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,loadExperience}=require('./fixtures/intake.cjs'),{admit}=require('../routes/intake'),{publishPolicy,evaluateDelivery}=require('../routes/pipeline'),{saveProcessingConfig}=require('../routes/processing-worker'),{capturePendingEvidence}=require('../routes/evidence-worker'),{autoInvestigate}=require('../routes/auto-investigate'),{investigationRecords}=require('../routes/investigations'),{example}=require('../ui/source-contract');
async function setup(f,count=1){
 const owner='alice',pool=f.caller(owner),source=loadExperience().sourceDefinition({name:'Auto',source:'urn:triagenorth:test:'+randomUUID(),environment:'test'});
 const detection=async(op,_o,input)=>op==='publish'?{revision:input.revision,count:input.rules.length,sealed:true}:{revision:input.revision,matches:[policy.policy.rules[0].id],total:1,complete:true};
 const policy=await publishPolicy(pool,detection,owner,source,{name:'Incident',window:{mode:'sliding',seconds:900},rules:[{name:'Firing',enabled:true,capture:true,query:{term:{status:'firing'}}}]},0);
 for(let i=0;i<count;i++){const event=example();event.id=randomUUID();event.source=source.source;event.data.environment='test';event.data.resource={kind:'kubernetes-pod',scope:'cluster',id:'pod-'+i};const d=(await admit(pool,owner,source,event)).record;await evaluateDelivery(pool,detection,owner,d.id);}
 return {owner,pool,source,config:extra=>saveProcessingConfig(pool,owner,{enabled:true,captureEvidence:true,sourceIds:[source.id],batchSize:10,maxAttempts:3,retrySeconds:10,expectedRevision:0,...extra},[source.id])};
}
function port(){const tickets=new Map(),starts=[];return {tickets,starts,async createTicket(input){const id=randomUUID();tickets.set(id,{ticketId:id,ticketType:input.ticketType,status:'queued',revision:0});return {ticketId:id};},async getTicket(id){return tickets.get(id)||null;},async startTicket(id,input){starts.push({id,input});const t=tickets.get(id);t.status='running';t.revision++;return {status:'queued',ticket:{...t}};}};}
test('opt-in starts one sealed investigation per captured evidence, bounded per tick and never twice',async()=>{
 const f=await fixture();try{const x=await setup(f,3),p=port(),ctx={pool:x.pool,ticketService:p};
  await x.config({});assert.equal((await capturePendingEvidence(x.pool,x.owner)).captured,3);assert.deepEqual(await autoInvestigate(ctx,x.owner),{enabled:false},'no opt-in, no start');
  await assert.rejects(saveProcessingConfig(x.pool,x.owner,{enabled:true,captureEvidence:false,autoInvestigate:true,sourceIds:[x.source.id],batchSize:10,maxAttempts:3,retrySeconds:10,expectedRevision:1},[x.source.id]),{status:400});
  await saveProcessingConfig(x.pool,x.owner,{enabled:true,captureEvidence:true,autoInvestigate:true,sourceIds:[x.source.id],batchSize:10,maxAttempts:3,retrySeconds:10,expectedRevision:1},[x.source.id]);
  const [a,b]=await Promise.all([autoInvestigate(ctx,x.owner),autoInvestigate({pool:f.caller(x.owner),ticketService:p},x.owner)]);
  // Two concurrent ticks: each is bounded to two, and no capture is started twice. How the three captures split between the ticks depends on timing.
  assert.ok(a.started<=2&&b.started<=2,'each tick starts at most two');assert.ok(p.starts.length>=2&&p.starts.length<=3);assert.equal(new Set(p.starts.map(s=>s.id)).size,p.starts.length,'no ticket is started twice');
  const s=p.starts[0].input;assert.equal(s.executor,'native-broker-v1');assert.equal(s.files[0].path,'evidence/packet.json');assert.equal(JSON.parse(Buffer.from(s.files[0].bytes)).executionAuthorized,false);
  const before=p.starts.length,third=await autoInvestigate(ctx,x.owner);assert.equal(third.started,3-before);assert.equal(p.starts.length,3);assert.equal(new Set(p.starts.map(s=>s.id)).size,3);assert.equal((await autoInvestigate(ctx,x.owner)).results.length,0,'nothing left to start');
  const page=await investigationRecords(ctx,x.owner);assert.equal(page.items.length,3);assert.ok(page.items.every(i=>i.state==='started'&&i.ticket.status==='running'));assert.equal(p.tickets.size,3,'one canonical ticket per evidence');
 }finally{await f.close();}
});
test('an uncertain start is held for the operator and a missing kernel start port is explicit',async()=>{
 const f=await fixture();try{const x=await setup(f,1),p=port();let calls=0;p.startTicket=async()=>{calls++;throw Error('lost response');};const ctx={pool:x.pool,ticketService:p};
  await x.config({autoInvestigate:true});await capturePendingEvidence(x.pool,x.owner);
  const r=await autoInvestigate(ctx,x.owner);assert.equal(r.uncertain,1);assert.equal((await investigationRecords(ctx,x.owner)).items[0].state,'start-uncertain');
  await autoInvestigate(ctx,x.owner);assert.equal(calls,1,'an uncertain start is never retried automatically');
  const legacy={pool:x.pool,ticketService:{createTicket:p.createTicket,getTicket:p.getTicket}};assert.equal((await autoInvestigate(legacy,x.owner)).available,false);
  assert.equal((await autoInvestigate({pool:f.caller('bob'),ticketService:p},'bob')).enabled,false);
 }finally{await f.close();}
});
test('a kernel refusal is recorded as a definite no-start with its reason, apart from an uncertain start',async()=>{
 const f=await fixture();try{const x=await setup(f,1),p=port();let calls=0;p.startTicket=async()=>{calls++;throw Error('refused: ticket start requires original Writer admission');};const ctx={pool:x.pool,ticketService:p};
  await x.config({autoInvestigate:true});await capturePendingEvidence(x.pool,x.owner);
  const r=await autoInvestigate(ctx,x.owner);assert.equal(r.refused,1);assert.equal(r.uncertain,0);
  const item=(await investigationRecords(ctx,x.owner)).items[0];assert.equal(item.state,'start-refused');assert.match(item.error,/Writer admission/);
  await autoInvestigate(ctx,x.owner);assert.equal(calls,1,'a refused start is held for the operator, not retried every tick');
 }finally{await f.close();}
});
