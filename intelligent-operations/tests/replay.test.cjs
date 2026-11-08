// CHANGE LOG: 5 | maintainer@emeraldcoastsystemsgroup.com | Prove isolated recorded-window replay (RP-OPS-01), uploaded CloudEvents and OTLP batch replay (RP-OPS-02), mapping refusals, zero live side effects, and sandbox run clean-up.
// CHANGE LOG: 4 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 regression: the sample replay is all or nothing; failed runs remove created sources and telemetry, and only synthetic replay sources can be discarded.
// CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Retained context is one table: count each bank's meter across the stream rows.
// CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Verify mixed batch results, pre-write source refusal and actual grouped resource cards.
// CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Run the synthetic non-container scenario through real intake, OpenSearch, reduction, graph correlation and pinned context.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {datacenter}=require('../ui/replay-scenarios.js'),{fixture,loadExperience}=require('./fixtures/intake.cjs'),{engineFixture}=require('./fixtures/detection.cjs');
const {admit,hash}=require('../routes/intake.js'),{publishPolicy,evaluateDelivery}=require('../routes/pipeline.js'),{saveScan,correlateDeliveries}=require('../routes/topology-store.js'),{configureStream,ingestTelemetry,pinTelemetryEvidence}=require('../routes/telemetry-store.js');
const {completeReplay,discardReplay,preflightReplay}=require('../routes/replay-store.js');
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
  await page.goto(base+'/api/intelligent-operations/app#replay');await page.locator('#replay-sheet[open]').waitFor();assert.equal(await page.locator('#data').isVisible(),true,'the old Scenario lab address opens Replay a sample on Data pipeline');await page.getByRole('button',{name:'Run datacenter scenario',exact:true}).click();
  await page.getByText('Replay verified.',{exact:false}).waitFor({timeout:60000});assert.deepEqual(await page.locator('#replay-steps li').evaluateAll(items=>items.map(li=>li.dataset.state)),['done','done','done','done','done']);assert.equal(await page.locator('#replay-alert').isVisible(),false);assert.match(await page.locator('#replay-results').innerText(),/60 routine observations filtered; 36 repeated symptoms suppressed/);
  const savedRun=collections.get('replays').values().next().value;assert.equal(savedRun.passed,true);
  const posts=[];page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});await page.reload();await page.getByText('Saved replay ·',{exact:false}).waitFor();assert.deepEqual(posts,[]);assert.match(await page.locator('#replay-results').innerText(),/36 repeated symptoms suppressed/);
  assert.equal(await page.locator('#replay-results details').count(),5);assert.equal(await page.locator('.replay-groups article').count(),2);assert.equal(await page.locator('.dependency-node').count(),4);await page.locator('#replay-results details').first().locator('summary').click();assert.match(await page.locator('#replay-results').innerText(),/rawStreamAccess/);
  await page.locator('#replay-sheet-done').click();assert.equal(await page.locator('#replay-sheet[open]').count(),0);await page.getByRole('link',{name:'Live context',exact:true}).click();await page.locator('#telemetry-banks .bank-cell').first().waitFor();assert.equal(await page.locator('#telemetry-banks [role=meter]').count(),6,'two streams, three banks each, in one table');
  // UX audit 2026-11-06: Live context reads its detector on open, so the stream checklist and the candidate source are filled at first paint without Refresh detector.
  await page.locator('#anomaly-telemetry .check-row').nth(1).waitFor();assert.equal(await page.locator('#anomaly-telemetry input[type=checkbox]').count(),3,'one row per saved source');assert.ok(await page.locator('#anomaly-candidate option').count()>=3);
  assert.equal(await page.locator('#anomaly-run').isDisabled(),true);assert.match(await page.locator('#anomaly-run-why').textContent(),/save detector settings first/i);
  assert.deepEqual(await page.locator('#telemetry-banks th').allTextContents(),['Stream','Resource','Samples in the 15-minute bank','Last sample']);
  assert.equal(await page.locator('#streams > article').first().locator('h2').textContent(),'Retained context by stream','retained context comes first');
  assert.equal(await page.locator('#anomaly-warmupSamples').isVisible(),false,'warm-up, window and seasonal bucket sit under a closed Advanced');
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[]);
  await page.route('**/api/intelligent-operations/telemetry',route=>route.fulfill({status:403,contentType:'application/json',body:'{"error":"role withdrawn"}'}));
  await page.getByRole('button',{name:'Refresh telemetry banks',exact:true}).click();await page.getByText('Your current OSHAL role does not permit this operation.',{exact:false}).first().waitFor();assert.equal(await page.locator('#telemetry-banks [role=meter]').count(),0);assert.equal(await page.locator('#replay-results details').count(),0);
 }finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));await engine.close();await f.close();for(const index of indexes){const r=await fetch(process.env.OSHAL_TEST_SEARCH+'/'+index,{method:'DELETE'});assert.ok(r.ok||r.status===404);}}
});

/** A test server whose detection relay can be made to refuse a publication, the shape of the 2026-11-05 index-create block. */
async function replayServer(refusePublish){
 const {dependency,root}=require('./fixtures/intake.cjs'),express=dependency('express');
 const f=await fixture(),engine=await engineFixture(),owner='replay-failure-'+randomUUID(),pool=f.caller(owner),collections=new Map(),indexes=new Set();let publishes=0;
 const app=express();app.use((req,_res,next)=>{req.oidc={user:{sub:owner}};next();});
 app.use('/api/intelligent-operations',loadExperience().createOperationsExperienceRoutes({pool,appPackageDir:root,authorization:{registerResource(){}},store:{async query(name){return [...(collections.get(name)||new Map()).values()];},async put(name,id,value){if(!collections.has(name))collections.set(name,new Map());collections.get(name).set(id,value);}},intent:async(name,input)=>{const reply=await engine.intent(name,input);if(input.request.cmd==='publish'){indexes.add('ops-rules-'+hash(['detection-owner-v1',owner])+'-'+input.request.args.revision);if(refusePublish(++publishes))return {...reply,reply:{error:{message:'Detection backend refused the operation (HTTP 403).'}}};}return reply;}}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const close=async()=>{await new Promise(resolve=>server.close(resolve));await engine.close();await f.close();for(const index of indexes){const r=await fetch(process.env.OSHAL_TEST_SEARCH+'/'+index,{method:'DELETE'});assert.ok(r.ok||r.status===404);}};
 return {base:'http://127.0.0.1:'+server.address().port,pool,owner,collections,close};
}
const count=async(pool,owner,table)=>(await pool.query('SELECT count(*)::int AS n FROM '+table+' WHERE user_sub=$1',[owner])).rows[0].n;
test('a sample replay the detection service cannot take saves nothing, says which step and the fix, and offers to remove an earlier run\'s leftovers',async()=>{
 const {dependency}=require('./fixtures/intake.cjs'),{chromium}=dependency('playwright');const t=await replayServer(()=>true);let browser;
 try{
  const old=datacenter('left-'+randomUUID().slice(0,8)).sources[0],leftover=loadExperience().sourceDefinition(old);t.collections.set('sources',new Map([[leftover.id,leftover]]));
  browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(t.base+'/api/intelligent-operations/app#data');await page.getByRole('tab',{name:'Rules',exact:true}).click();await page.getByRole('button',{name:'Replay a sample',exact:true}).click();await page.locator('#replay-sheet[open]').waitFor();
  await page.getByRole('button',{name:'Remove test data (1 source)',exact:true}).click();await page.getByText('Removed 1 test source',{exact:false}).waitFor();
  assert.ok(t.collections.get('sources').get(leftover.id).discardedAt,'the earlier run\'s source is discarded');
  const records=await (await fetch(t.base+'/api/intelligent-operations/records')).json();assert.equal(records.sources.length,0,'a discarded source is gone from every read');
  assert.equal(await page.locator('#replay-sheet [data-ds-not-yet], #replay-sheet [data-ds-backlog]').count(),0,'all replay modes are live');
  for(const name of ['Datacenter scenario','Replay a recorded window','Replay an uploaded batch'])assert.equal(await page.getByRole('button',{name,exact:true}).isEnabled(),true);
  const posts=[];page.on('request',r=>{if(r.method()==='POST')posts.push(new URL(r.url()).pathname);});
  await page.getByRole('button',{name:'Run datacenter scenario',exact:true}).click();
  const alert=page.getByRole('alert').filter({hasText:'Stopped at checking the detection service'});await alert.waitFor();
  assert.match(await alert.textContent(),/HTTP 403/);assert.match(await alert.textContent(),/nothing was saved/i);assert.match(await alert.textContent(),/Check detection service/);
  assert.deepEqual(posts,['/api/intelligent-operations/replays'],'nothing is created after the refused preflight');
  assert.equal([...t.collections.get('sources').values()].filter(s=>!s.discardedAt).length,0);assert.equal(await count(t.pool,t.owner,'operations_streams'),0);
  assert.equal(await page.locator('#replay-steps li[data-step=check]').getAttribute('data-state'),'failed');assert.equal(await page.getByRole('button',{name:'Run datacenter scenario',exact:true}).isEnabled(),true);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();await t.close();}
});
test('a sample replay that stops after saving removes its sources, telemetry and rule binding, and names the step',async()=>{
 const {dependency}=require('./fixtures/intake.cjs'),{chromium}=dependency('playwright');const t=await replayServer(n=>n===2);let browser;
 try{
  browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(t.base+'/api/intelligent-operations/app#replay');await page.locator('#replay-sheet[open]').waitFor();await page.getByRole('button',{name:'Run datacenter scenario',exact:true}).click();
  const alert=page.getByRole('alert').filter({hasText:'Stopped at publishing rules'});await alert.waitFor();
  assert.match(await alert.textContent(),/test sources and telemetry this run created were removed/);
  assert.deepEqual(await page.locator('#replay-steps li').evaluateAll(items=>items.map(li=>li.dataset.state)),['done','done','done','failed','pending']);
  const saved=[...t.collections.get('sources').values()];assert.equal(saved.length,2);assert.ok(saved.every(s=>s.discardedAt),'both test sources are discarded');
  for(const table of ['operations_streams','operations_policy_bindings','operations_topology_scans','operations_telemetry_0'])assert.equal(await count(t.pool,t.owner,table),0,table);
  assert.equal((await (await fetch(t.base+'/api/intelligent-operations/records')).json()).sources.length,0);
  assert.equal(await page.locator('#replay-discard').isVisible(),false);assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();await t.close();}
});
test('only synthetic replay sources can be discarded, and the replay write takes nothing else',async()=>{
 const f=await fixture(),owner='replay-discard-'+randomUUID(),pool=f.caller(owner);
 try{
  const real=loadExperience().sourceDefinition({name:'Production alerts',environment:'production',source:'urn:operations:source:production'}),fake=loadExperience().sourceDefinition(datacenter(randomUUID()).sources[1]),rows=new Map([[real.id,real],[fake.id,fake]]);
  const ctx={pool,store:{query:async()=>[...rows.values()],put:async(_n,id,v)=>rows.set(id,v)}};
  await assert.rejects(discardReplay(ctx,owner,{sourceIds:[real.id]}),e=>e.status===400&&/Only synthetic/.test(e.message));assert.equal(rows.get(real.id).discardedAt,undefined);
  await assert.rejects(discardReplay(ctx,owner,{sourceIds:[fake.id],extra:true}),e=>e.status===400);
  await assert.rejects(discardReplay(ctx,owner,{sourceIds:['0'.repeat(64)]}),e=>e.status===404);
  await assert.rejects(discardReplay(ctx,'',{sourceIds:[fake.id]}),e=>e.status===401);
  assert.deepEqual(await discardReplay(ctx,owner,{sourceIds:[fake.id]}),{discarded:1,sourceIds:[fake.id]});assert.ok(rows.get(fake.id).discardedAt);
  await assert.rejects(preflightReplay(async()=>({}),owner,{policy:{},sourceId:'x'}),e=>e.status===400);
  await assert.rejects(preflightReplay(async()=>({revision:'other',sealed:true,count:1}),owner,{policy:datacenter(randomUUID()).policy}),e=>e.status===503);
 }finally{await f.close();}
});

test('recorded-window replay (RP-OPS-01) and uploaded CloudEvents/OTLP batch replay (RP-OPS-02) run in an isolated sandbox with clean-up and zero live side effects',async()=>{
 const {dependency,root}=require('./fixtures/intake.cjs'),express=dependency('express'),{chromium}=dependency('playwright');
 const f=await fixture(),engine=await engineFixture(),owner='sandbox-replay-'+randomUUID(),pool=f.caller(owner),collections=new Map(),indexes=new Set();let browser,server;
 try{
  const app=express();app.use((req,_res,next)=>{req.oidc={user:{sub:owner}};next();});
  app.use('/api/intelligent-operations',loadExperience().createOperationsExperienceRoutes({pool,appPackageDir:root,authorization:{registerResource(){}},store:{async query(name){return [...(collections.get(name)||new Map()).values()];},async put(name,id,value){if(!collections.has(name))collections.set(name,new Map());collections.get(name).set(id,value);}},intent:async(name,input)=>{if(input.request.cmd==='publish')indexes.add('ops-rules-'+hash(['detection-owner-v1',owner])+'-'+input.request.args.revision);return engine.intent(name,input);}}));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base='http://127.0.0.1:'+server.address().port+'/api/intelligent-operations';
  const scenario=datacenter(randomUUID()),srcInput={...scenario.sources[0],name:'Prod host alerts',environment:'prod-lab',source:'urn:operations:source:prod-lab'};
  const savedSrc=await (await fetch(base+'/sources',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(srcInput)})).json();
  await fetch(base+'/telemetry/configure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceId:savedSrc.id,config:scenario.configs.hosts,expectedRevision:0})});
  const policyBody={name:'Sandbox Errors',window:{mode:'sliding',seconds:900},rules:[{name:'Host warning or critical',enabled:true,capture:true,query:{terms:{severity:['warning','critical']}}}]};
  const pub=await (await fetch(base+'/pipeline/policies',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceId:savedSrc.id,policy:policyBody,expectedRevision:0})})).json();
  const mkEvent=(id,severity,resId,time,env='prod-lab')=>({specversion:'1.0',id,source:savedSrc.source,type:'operations.alert',time,dataschema:'urn:oshal:operations:alert:1',datacontenttype:'application/json',data:{environment:env,alertType:'HostCpuHigh',severity,status:'firing',message:'cpu spike',resource:{kind:'host',scope:'rack-1',id:resId}}});
  const t0=new Date(Date.now()-60000).toISOString(),t1=new Date(Date.now()-50000).toISOString(),t2=new Date(Date.now()-40000).toISOString();
  const admitted=await fetch(base+'/events/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:[{sourceId:savedSrc.id,event:mkEvent('w-1','critical','host-a',t0)},{sourceId:savedSrc.id,event:mkEvent('w-2','critical','host-a',t1)},{sourceId:savedSrc.id,event:mkEvent('w-3','info','host-b',t2)}]})});
  assert.equal(admitted.status,200);
  browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/app#data');await page.getByRole('tab',{name:'Rules',exact:true}).click();await page.getByRole('button',{name:'Replay a sample',exact:true}).click();await page.locator('#replay-sheet[open]').waitFor();

  // RP-OPS-01: Replay a recorded window against the chosen rule revision
  await page.getByRole('button',{name:'Replay a recorded window',exact:true}).click();
  await page.locator('#replay-window-source option[value="'+savedSrc.id+'"]').waitFor({state:'attached'});
  await page.locator('#replay-window-policy option[value="'+pub.policy.id+'"]').waitFor({state:'attached'});
  await page.locator('#replay-window-policy').selectOption(pub.policy.id);
  await page.getByRole('button',{name:'Replay recorded window',exact:true}).click();
  await page.getByText('Isolated sandbox replay complete',{exact:false}).waitFor();
  assert.deepEqual(await page.locator('#replay-steps li').evaluateAll(items=>items.map(li=>li.dataset.state)),['done','done','done','done','done']);
  assert.match(await page.locator('#replay-results').innerText(),/1 unmatched filtered; 1 repeated symptoms suppressed/);
  assert.match(await page.locator('#replay-results').innerText(),/0 live symptoms, 0 evidence reservations, 0 notifications/);
  for(const table of ['operations_filter_decisions','operations_symptoms','operations_symptom_occurrences','operations_evidence_work'])assert.equal(await count(pool,owner,table),0,table+' untouched by window replay');
  await page.getByRole('button',{name:'Remove test run',exact:true}).click();await page.getByText('Removed sandbox test run receipt',{exact:false}).waitFor();
  assert.equal((await (await fetch(base+'/replays')).json()).runs.length,0,'cleaned-up sandbox receipt is gone');
  assert.equal(await count(pool,owner,'operations_deliveries'),3,'live deliveries stay intact');

  // RP-OPS-02: Uploaded batch mapping validation refusal + CloudEvents file upload + OTLP logs batch
  await page.getByRole('button',{name:'Replay an uploaded batch',exact:true}).click();
  await page.locator('#replay-batch-json').fill(JSON.stringify([mkEvent('bad-1','critical','host-z',t0,'wrong-env')]));
  await page.getByRole('button',{name:'Replay uploaded batch',exact:true}).click();
  await page.locator('#replay-alert').waitFor();assert.match(await page.locator('#replay-alert').textContent(),/does not match source environment/);
  assert.equal(await page.locator('#replay-steps li[data-step=source]').getAttribute('data-state'),'failed');

  const ceBatch=[mkEvent('b-1','warning','host-c',t0),mkEvent('b-2','warning','host-c',t1),mkEvent('b-3','info','host-d',t2)];
  await page.locator('#replay-batch-file').setInputFiles({name:'batch.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(ceBatch))});
  await page.getByRole('button',{name:'Replay uploaded batch',exact:true}).click();
  await page.getByText('Isolated sandbox replay complete · 3 occurrences → 2 rule matches → 1 symptoms',{exact:false}).waitFor();
  assert.equal(await count(pool,owner,'operations_deliveries'),3,'uploaded batch never admits live deliveries');

  const otlpBatch={resourceLogs:[{resource:{attributes:[{key:'host.id',value:{stringValue:'host-otlp-1'}},{key:'site.id',value:{stringValue:'rack-1'}}]},scopeLogs:[{logRecords:[{timeUnixNano:String(Date.now()*1e6),severityNumber:18,body:{stringValue:'kernel panic'}}]}]}]};
  await page.locator('#replay-batch-format').selectOption('otlp-logs');
  await page.locator('#replay-batch-json').fill(JSON.stringify(otlpBatch));
  await page.getByRole('button',{name:'Replay uploaded batch',exact:true}).click();
  await page.getByText('Isolated sandbox replay complete · 1 occurrences → 1 rule matches → 1 symptoms',{exact:false}).waitFor();
  for(const table of ['operations_filter_decisions','operations_symptoms','operations_evidence_work','operations_telemetry_0'])assert.equal(await count(pool,owner,table),0,table+' untouched by OTLP sandbox batch');
  await page.getByRole('button',{name:'Remove test run',exact:true}).click();await page.getByText('Removed sandbox test run receipt',{exact:false}).waitFor();
  assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));await engine.close();await f.close();for(const index of indexes){const r=await fetch(process.env.OSHAL_TEST_SEARCH+'/'+index,{method:'DELETE'});assert.ok(r.ok||r.status===404);}}
});
