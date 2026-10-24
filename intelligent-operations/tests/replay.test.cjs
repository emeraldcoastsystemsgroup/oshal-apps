// CHANGE LOG: telemetry table | maintainer@emeraldcoastsystemsgroup.com | Retained context is one table: count each bank's meter across the stream rows.
// CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Run the synthetic non-container scenario through real intake, OpenSearch, reduction, graph correlation and pinned context.
// CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Verify mixed batch results, pre-write source refusal and actual grouped resource cards.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {datacenter}=require('../ui/replay-scenarios.js'),{fixture,loadExperience}=require('./fixtures/intake.cjs'),{engineFixture}=require('./fixtures/detection.cjs');
const {admit,hash}=require('../routes/intake.js'),{publishPolicy,evaluateDelivery}=require('../routes/pipeline.js'),{saveScan,correlateDeliveries}=require('../routes/topology-store.js'),{configureStream,ingestTelemetry,pinTelemetryEvidence}=require('../routes/telemetry-store.js');
const {completeReplay}=require('../routes/replay-store.js');
test('100 replayed host/cloud occurrences become 40 matches, four symptoms, two dependency groups and four persistent evidence packets',async()=>{
 const f=await fixture(),engine=await engineFixture(),owner='replay-'+randomUUID(),pool=f.caller(owner),scenario=datacenter(randomUUID()),sources={},indexes=[];
 try{
  for(const input of scenario.sources){const s=loadExperience().sourceDefinition(input);sources[input.key]=s;await configureStream(pool,owner,s,scenario.configs[input.key],0);const p=await publishPolicy(pool,engine.engine,owner,s,scenario.policy,0);indexes.push('ops-rules-'+hash(['detection-owner-v1',owner])+'-'+p.policy.id);}
  await saveScan(pool,owner,sources.hosts,scenario.scan);
  for(const t of scenario.telemetry)await ingestTelemetry(pool,owner,sources[t.key],t.format==='cloudwatch'?'cloudwatch':'otlp-logs',t.payload);
  const decisions=[];for(const row of scenario.events){const d=await admit(pool,owner,sources[row.key],row.event);decisions.push(await evaluateDelivery(pool,engine.engine,owner,d.record.id));}
  assert.equal(decisions.length,scenario.expect.deliveries);assert.equal(decisions.filter(d=>d.outcome==='matched').length,scenario.expect.matched);assert.equal(decisions.filter(d=>d.outcome==='unmatched').length,scenario.expect.filtered);assert.equal(decisions.filter(d=>d.reduction.outcome==='suppressed').length,scenario.expect.suppressed);
  const survivors=decisions.filter(d=>d.reduction.workId);assert.equal(survivors.length,scenario.expect.survivors);
  const correlation=await correlateDeliveries(pool,owner,{deliveryIds:survivors.map(d=>d.deliveryId),asOf:scenario.scan.observedAt,collectionId:scenario.scan.collectionId,policy:{id:'replay-dependencies-v1',types:['DEPENDS_ON'],maxDepth:4,maxVisited:100,maxAgeSeconds:900}});
  assert.equal(correlation.status,'complete');assert.equal(correlation.groups.length,scenario.expect.groups);assert.deepEqual(correlation.groups.map(g=>g.length).sort(),[1,3]);assert.ok(correlation.paths.length>=2);
  for(const d of survivors){const packet=await pinTelemetryEvidence(pool,owner,d.reduction.workId);assert.equal(packet.observations.length,1);assert.equal(packet.executionAuthorized,false);}
  const savedRuns=new Map(),ctx={pool,store:{query:async name=>name==='sources'?Object.values(sources):[...savedRuns.values()],put:async(_name,id,record)=>savedRuns.set(id,record)}};
  const input={decisionIds:decisions.map(d=>d.id),correlationId:correlation.id},receipt=await completeReplay(ctx,owner,input);assert.equal(receipt.passed,true);assert.deepEqual(receipt.actual,scenario.expect);assert.equal(receipt.graph.assets.length,4);
  assert.equal((await completeReplay(ctx,owner,input)).sha256,receipt.sha256);assert.equal(savedRuns.size,1);
  await assert.rejects(completeReplay(ctx,owner,{...input,actual:{matched:100}}),e=>e.status===400);
  await assert.rejects(completeReplay({...ctx,pool:f.caller('another-owner')},'another-owner',input),e=>e.status===404);
  const retry=await admit(pool,owner,sources.hosts,scenario.events[0].event);assert.equal(retry.retry,true);assert.equal((await evaluateDelivery(pool,engine.engine,owner,retry.record.id)).retry,true);
 }finally{await engine.close();await f.close();for(const index of new Set(indexes)){const r=await fetch(process.env.OSHAL_TEST_SEARCH+'/'+index,{method:'DELETE'});assert.ok(r.ok||r.status===404);}}
});

test('the shipped Scenario lab runs real filtering and renders retained context at desktop and phone widths',async()=>{
 const {dependency,root}=require('./fixtures/intake.cjs'),express=dependency('express'),{chromium}=dependency('playwright');
 const f=await fixture(),engine=await engineFixture(),owner='browser-replay-'+randomUUID(),pool=f.caller(owner),collections=new Map(),indexes=new Set();let browser,server;
 try{
  const app=express();app.use((req,_res,next)=>{req.oidc={user:{sub:owner}};next();});
  app.use('/api/intelligent-operations',loadExperience().createOperationsExperienceRoutes({pool,appPackageDir:root,authorization:{registerResource(){}},store:{async query(name){return [...(collections.get(name)||new Map()).values()];},async put(name,id,value){if(!collections.has(name))collections.set(name,new Map());collections.get(name).set(id,value);}},intent:async(name,input)=>{if(input.request.cmd==='publish')indexes.add('ops-rules-'+hash(['detection-owner-v1',owner])+'-'+input.request.args.revision);return engine.intent(name,input);}}));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base='http://127.0.0.1:'+server.address().port;
  const scenario=datacenter(randomUUID()),input=scenario.sources[0];let r=await fetch(base+'/api/intelligent-operations/sources',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(r.status,201);const saved=await r.json(),event=scenario.events[0].event;
  const batch=events=>fetch(base+'/api/intelligent-operations/events/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events})});
  r=await batch([{sourceId:saved.id,event},{sourceId:saved.id,event}]);assert.equal(r.status,200);assert.deepEqual((await r.json()).results.map(row=>row.status),[201,200]);
  r=await batch([{sourceId:saved.id,event:{...event,data:{...event.data,message:'changed-content'}}}]);assert.equal(r.status,207);const conflict=await r.json();assert.equal(conflict.atomicity,'per-delivery');assert.equal(conflict.results[0].status,409);assert.deepEqual(conflict.results[0].raw,event);
  r=await batch([{sourceId:saved.id,event:{...event,id:'must-not-commit'}},{sourceId:'foreign-source',event}]);assert.equal(r.status,404);assert.equal((await pool.query('SELECT count(*)::int AS n FROM operations_deliveries WHERE user_sub=$1',[owner])).rows[0].n,1);
  r=await batch(Array.from({length:21},()=>({sourceId:saved.id,event})));assert.equal(r.status,400);
  browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/api/intelligent-operations/app#replay');await page.getByRole('button',{name:'Run datacenter scenario',exact:true}).click();
  await page.getByText('Replay verified.',{exact:false}).waitFor({timeout:60000});assert.match(await page.locator('#replay-results').innerText(),/60 routine observations filtered; 36 repeated symptoms suppressed/);
  const savedRun=collections.get('replays').values().next().value;assert.equal(savedRun.passed,true);
  const posts=[];page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});await page.reload();await page.getByText('Saved replay ·',{exact:false}).waitFor();assert.deepEqual(posts,[]);assert.match(await page.locator('#replay-results').innerText(),/36 repeated symptoms suppressed/);
  assert.equal(await page.locator('#replay-results details').count(),5);assert.equal(await page.locator('.replay-groups article').count(),2);assert.equal(await page.locator('.dependency-node').count(),4);await page.locator('#replay-results details').first().locator('summary').click();assert.match(await page.locator('#replay-results').innerText(),/rawStreamAccess/);
  await page.getByRole('link',{name:'Live context',exact:true}).click();await page.locator('#telemetry-banks .bank-cell').first().waitFor();assert.equal(await page.locator('#telemetry-banks [role=meter]').count(),6,'two streams, three banks each, in one table');
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[]);
  await page.route('**/api/intelligent-operations/telemetry',route=>route.fulfill({status:403,contentType:'application/json',body:'{"error":"role withdrawn"}'}));
  await page.getByRole('button',{name:'Refresh telemetry banks',exact:true}).click();await page.getByText('Your current OSHAL role does not permit this operation.',{exact:false}).first().waitFor();assert.equal(await page.locator('#telemetry-banks [role=meter]').count(),0);assert.equal(await page.locator('#replay-results details').count(),0);
 }finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));await engine.close();await f.close();for(const index of indexes){const r=await fetch(process.env.OSHAL_TEST_SEARCH+'/'+index,{method:'DELETE'});assert.ok(r.ok||r.status===404);}}
});
