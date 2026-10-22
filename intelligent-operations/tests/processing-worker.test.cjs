// CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Prove background leases, pause fencing, retry exhaustion and uncertain commits against actual SQL and percolation.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,loadExperience}=require('./fixtures/intake.cjs'),{engineFixture}=require('./fixtures/detection.cjs');
const {admit,hash}=require('../routes/intake.js'),{publishPolicy,evaluateDelivery,pipelineRecords}=require('../routes/pipeline.js');
const {processingConfig,saveProcessingConfig,claimProcessing,processingFence,processPending,retryProcessing,processingRecords}=require('../routes/processing-worker.js');
const {example}=require('../ui/source-contract.js');
async function setup(){
 const f=await fixture(),e=await engineFixture(),owner='worker-'+randomUUID(),p=f.caller(owner),source=loadExperience().sourceDefinition({name:'Worker acceptance',source:example().source,environment:'local-lab'});
 const policy={name:'Worker availability',rules:[{name:'Warning',enabled:true,capture:true,query:{term:{severity:'warning'}}}],window:{mode:'sliding',seconds:900}};
 const published=await publishPolicy(p,e.engine,owner,source,policy,0),index='ops-rules-'+hash(['detection-owner-v1',owner])+'-'+published.policy.id;
 return {f,e,p,owner,source,async config(extra={}){const current=await processingConfig(p,owner);return saveProcessingConfig(p,owner,{enabled:true,sourceIds:[source.id],batchSize:10,maxAttempts:3,retrySeconds:10,expectedRevision:current.revision,...extra},[source.id]);},async event(id){const event=example();event.id=id;return (await admit(p,owner,source,event)).record.id;},async close(){await e.close();await f.close();assert.ok((await fetch(process.env.OSHAL_TEST_SEARCH+'/'+index,{method:'DELETE'})).ok);}};
}
test('processing defaults off, only saved sources with published policies enable, and config uses compare-and-set',async()=>{
 const x=await setup();try{
  await x.event('disabled');assert.equal((await processPending(x.p,()=>{throw Error('must not call');},x.owner)).enabled,false);
  await assert.rejects(x.config({sourceIds:['forged']}),{status:400});
  const config=await x.config();assert.equal(config.revision,1);
  await assert.rejects(saveProcessingConfig(x.p,x.owner,{...config,expectedRevision:0},[x.source.id]),{status:400});
  await assert.rejects(x.config({expectedRevision:0}),{status:409});
  assert.equal((await processingRecords(x.f.caller('other'),'other')).jobs.length,0);
 }finally{await x.close();}
});
test('two real SQL workers drain distinct occurrences exactly once and reserve evidence only after reduction',async()=>{
 const x=await setup();try{
  await x.config();for(let i=0;i<24;i++)await x.event('parallel-'+i);
  const other=x.f.caller(x.owner);for(let batch=0;batch<3;batch++)await Promise.all([x.p,other].map(p=>processPending(p,x.e.engine,x.owner)));
  const rows=await pipelineRecords(x.p,x.owner),jobs=(await processingRecords(other,x.owner)).jobs;
  assert.equal(rows.decisions.length,24);assert.equal(rows.symptoms[0].count,24);assert.equal(rows.evidenceWork.length,1);
  assert.ok(jobs.every(j=>j.processing.status==='completed'&&j.processing.attempts===1&&!('token'in j.processing)));
  assert.equal((await processPending(x.p,x.e.engine,x.owner)).evaluated,0);
 }finally{await x.close();}
});
test('retry backoff, exhaustion, explicit recovery and foreign-owner refusal survive separate SQL sessions',async()=>{
 const x=await setup();try{
  await x.config({maxAttempts:2});const id=await x.event('retry');let at=Date.parse('2026-10-21T01:00:00Z');const clock=()=>at;
  const down=async()=>{throw Error('unavailable');};assert.equal((await processPending(x.p,down,x.owner,clock)).failed,1);
  assert.equal((await processPending(x.f.caller(x.owner),down,x.owner,clock)).failed,0);
  at+=10000;assert.equal((await processPending(x.p,down,x.owner,clock)).failed,1);
  assert.equal((await processingRecords(x.p,x.owner)).jobs[0].state,'attention');
  await assert.rejects(retryProcessing(x.f.caller('other'),'other',id,clock),{status:404});
  await retryProcessing(x.p,x.owner,id,clock);assert.equal((await processPending(x.p,x.e.engine,x.owner,clock)).evaluated,1);
  assert.equal((await pipelineRecords(x.p,x.owner)).evidenceWork.length,1);
 }finally{await x.close();}
});
test('expired leases are recoverable and the stale worker cannot publish a decision',async()=>{
 const x=await setup();try{
  await x.config();const id=await x.event('lease');let at=Date.parse('2026-10-21T01:00:00Z');const clock=()=>at;
  const first=await claimProcessing(x.p,x.owner,clock);assert.equal((await claimProcessing(x.f.caller(x.owner),x.owner,clock)),null);
  at+=120001;const second=await claimProcessing(x.f.caller(x.owner),x.owner,clock);assert.notEqual(first.token,second.token);
  await assert.rejects(evaluateDelivery(x.p,x.e.engine,x.owner,id,()=>new Date(at).toISOString(),(c,w,n)=>processingFence(c,x.owner,first,w,n)),{status:409});
  assert.equal((await pipelineRecords(x.p,x.owner)).decisions.length,0);
  await evaluateDelivery(x.p,x.e.engine,x.owner,id,()=>new Date(at).toISOString(),(c,w,n)=>processingFence(c,x.owner,second,w,n));
  assert.equal((await pipelineRecords(x.p,x.owner)).symptoms[0].count,1);
 }finally{await x.close();}
});
test('stopping processing fences an already claimed worker before any decision or evidence reservation',async()=>{
 const x=await setup();try{
  await x.config();const id=await x.event('paused'),lease=await claimProcessing(x.p,x.owner);await x.config({enabled:false});
  await assert.rejects(evaluateDelivery(x.p,x.e.engine,x.owner,id,undefined,(c,w,n)=>processingFence(c,x.owner,lease,w,n)),{status:409});
  const rows=await pipelineRecords(x.p,x.owner);assert.equal(rows.decisions.length,0);assert.equal(rows.evidenceWork.length,0);
  assert.equal((await processPending(x.p,x.e.engine,x.owner)).enabled,false);
 }finally{await x.close();}
});
test('a lost successful commit acknowledgement never requeues completed processing or recounts the symptom',async()=>{
 const x=await setup();try{
  await x.config();await x.event('lost-ack');let committed=false,lose=true;
  const p=x.f.caller(x.owner,(phase,q,v)=>{if(phase==='before'&&q.startsWith('UPDATE operations_processing SET state=')&&v?.[2]==='evidence-pending')committed=true;if(phase==='after'&&q==='COMMIT'&&committed&&lose){lose=false;throw Error('lost commit acknowledgement');}});
  assert.equal((await processPending(p,x.e.engine,x.owner)).failed,1);
  assert.equal((await processPending(x.f.caller(x.owner),x.e.engine,x.owner)).evaluated,0);
  const rows=await pipelineRecords(x.p,x.owner);assert.equal(rows.decisions.length,1);assert.equal(rows.symptoms[0].count,1);assert.equal(rows.evidenceWork.length,1);
  assert.equal((await processingRecords(x.p,x.owner)).jobs[0].state,'evidence-pending');
 }finally{await x.close();}
});
test('the actual worker controls save scoped settings and never claim an unavailable scheduler is active',async()=>{
 const {dependency,root}=require('./fixtures/intake.cjs'),express=dependency('express'),{chromium}=dependency('playwright');
 const x=await setup(),app=express();let browser,server,allowed=true;
 try{
  app.use((req,res,next)=>{if(!allowed)return res.status(403).json({error:'Scope withdrawn'});req.oidc={user:{sub:x.owner}};next();});
  app.use('/api/intelligent-operations',loadExperience().createOperationsExperienceRoutes({appPackageDir:root,pool:x.p,intent:x.e.intent,authorization:{registerResource(){}},store:{query:async name=>name==='sources'?[x.source]:[],put:async()=>{throw Error('unexpected write');}}}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  browser=await chromium.launch({headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app#data');await page.getByRole('tab',{name:'Automation',exact:true}).click();await page.getByText('Worker disabled · native schedule unavailable',{exact:false}).waitFor();
  await page.getByLabel('Enabled source revisions',{exact:true}).selectOption(x.source.id);await page.getByLabel('Enable evaluation for these sources',{exact:true}).check();
  await page.getByRole('button',{name:'Save worker settings',exact:true}).click();await page.getByText('Worker enabled · native schedule unavailable',{exact:false}).waitFor();
  assert.equal((await processingConfig(x.p,x.owner)).enabled,true);assert.equal(await page.getByRole('button',{name:'Activate scheduled processing',exact:true}).isEnabled(),false);
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  allowed=false;await page.getByRole('button',{name:'Refresh worker status',exact:true}).click();await page.waitForFunction(()=>document.getElementById('processing-sources').options.length===0);
  assert.equal(await page.getByRole('button',{name:'Save worker settings',exact:true}).isEnabled(),false);assert.deepEqual(errors,[]);
 }finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await x.close();}
});

test('disable acknowledgement is serialized with a decision already inside its commit fence',async()=>{
 const x=await setup();let release,decision,disable;const gate=new Promise(r=>release=r);
 try{
  await x.config();const id=await x.event('pause-commit-race'),lease=await claimProcessing(x.p,x.owner);
  let reached;const fenced=new Promise(r=>reached=r);
  decision=evaluateDelivery(x.p,x.e.engine,x.owner,id,undefined,async(c,w,n)=>{await processingFence(c,x.owner,lease,w,n);reached();await gate;});
  await fenced;let acknowledged=false;disable=x.config({enabled:false}).then(r=>{acknowledged=true;return r;});
  let blocked=false;const deadline=Date.now()+2000;
  while(Date.now()<deadline&&!acknowledged){
   const rows=await x.f.inspect.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT record FROM operations_processing_config%'");
   if(rows.rows.length){blocked=true;break;}await new Promise(r=>setTimeout(r,10));
  }
  assert.equal(acknowledged,false,'disable cannot acknowledge while an earlier decision is still inside its fence');
  assert.equal(blocked,true,'the actual PostgreSQL configuration row lock serializes the boundary');
  release();await decision;await disable;
  assert.equal((await pipelineRecords(x.p,x.owner)).decisions.length,1);
  assert.equal((await processPending(x.p,x.e.engine,x.owner)).enabled,false);
 }finally{release();await Promise.allSettled([decision,disable].filter(Boolean));await x.close();}
});

test('real percolation drains repeated symptoms into one immediately eligible retained packet',async()=>{
 const {capturePendingEvidence}=require('../routes/evidence-worker.js'),x=await setup();try{await x.config({captureEvidence:true});for(let i=0;i<5;i++)await x.event('capture-chain-'+i);assert.equal((await processPending(x.p,x.e.engine,x.owner)).evaluated,5);assert.equal((await capturePendingEvidence(x.p,x.owner)).captured,1);assert.equal((await pipelineRecords(x.p,x.owner)).symptoms[0].count,5);assert.equal((await capturePendingEvidence(x.p,x.owner)).captured,0);}finally{await x.close();}
});
