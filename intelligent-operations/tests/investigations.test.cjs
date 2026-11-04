/* CHANGE LOG: investigate again | maintainer@emeraldcoastsystemsgroup.com | Guard Investigate again in real SQL (only a failed or cancelled ticket, one new ticket however many ask, the same sealed bytes, earlier attempts kept, another person opens nothing) and on the shipped evidence card; listed investigations carry their alert label. */
/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | The funnel's recovery card counts cohort tickets with a healthy response outcome (zero without executions), never unrelated tickets. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise real SQL reservations, canonical-service boundary seams, concurrent/uncertain creation, immutable dispatch inputs and cohort-linked receipt counts. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash,randomUUID}=require('node:crypto');
const {fixture,loadExperience,dependency,root}=require('./fixtures/intake.cjs'),{admit}=require('../routes/intake'),{publishPolicy,evaluateDelivery}=require('../routes/pipeline'),{prepareInvestigation,investigationRecords,investigateAgain}=require('../routes/investigations'),{investigationLabels}=require('../experience/rca-library.js'),{metrics}=require('../experience/lifecycle.js'),{example}=require('../ui/source-contract');
const {saveExternalConfig}=require('../routes/external-evidence');
async function setup(f,owner='alice',intercept){const pool=f.caller(owner,intercept),source=loadExperience().sourceDefinition({name:'Investigations',source:'urn:triagenorth:test:'+randomUUID(),environment:'test'}),event=example();event.id=randomUUID();event.source=source.source;event.data.environment='test';const delivery=(await admit(pool,owner,source,event)).record
 // The production detection engine has its own actual OpenSearch tests. This boundary fixture returns a sealed exact rule and one actual match to exercise SQL handoff, never a live detector acceptance claim.
 const detection=async(op,_owner,input)=>op==='publish'?{revision:input.revision,count:input.rules.length,sealed:true}:{revision:input.revision,matches:[policy.policy.rules[0].id],total:1,complete:true};
 const policy=await publishPolicy(pool,detection,owner,source,{name:'Incident',window:{mode:'sliding',seconds:900},rules:[{name:'Firing',enabled:true,capture:true,query:{term:{status:'firing'}}}]},0);const decision=await evaluateDelivery(pool,detection,owner,delivery.id);return {pool,source,delivery,decision,workId:decision.reduction.workId};}
function ticketPort(){let creates=0;const tickets=new Map();return {get creates(){return creates;},tickets,async createTicket(input){creates++;assert.deepEqual(input,{ticketType:'intelligent-operations',ownerSub:'alice'});const id=randomUUID();tickets.set(id,{ticketId:id,ticketType:'intelligent-operations',status:'queued'});return {ticketId:id};},async getTicket(id){return tickets.get(id)||null;}};}
test('one evidence reservation creates one canonical ticket across concurrent callers and retries with identical sealed input',async()=>{
 const f=await fixture();try{const x=await setup(f),port=ticketPort(),ctx={pool:x.pool,ticketService:port};const results=await Promise.allSettled(Array.from({length:12},()=>prepareInvestigation(ctx,'alice',x.workId)));assert.equal(port.creates,1);assert.ok(results.some(r=>r.status==='fulfilled'));for(const r of results)if(r.status==='rejected')assert.equal(r.reason.status,409);
 const first=results.find(r=>r.status==='fulfilled').value,retry=await prepareInvestigation(ctx,'alice',x.workId);assert.equal(first.ticketId,retry.ticketId);assert.deepEqual(first.startInput,retry.startInput);assert.equal(retry.executionAuthorized,false);assert.match(retry.startInput.prompt,/Evidence reviewed table/);assert.match(retry.startInput.prompt,/Decision table/);assert.equal(retry.startInput.limits.output_tokens,6144);
 const file=retry.startInput.files[0],bytes=Buffer.from(file.bytes);assert.equal(file.path,'evidence/packet.json');assert.deepEqual(file.digest,[...createHash('sha256').update(bytes).digest()]);const input=JSON.parse(bytes);assert.equal(input.rawStreamAccess,false);assert.equal(input.executionAuthorized,false);assert.equal(input.alert.deliveryId,x.delivery.id);assert.ok(!JSON.stringify(input).includes('kubeconfig'));assert.equal(bytes.length<65536,true);
 assert.equal((await investigationRecords(ctx,'alice')).items.length,1);assert.equal((await investigationRecords({pool:f.caller('bob'),ticketService:port},'bob')).items.length,0);await assert.rejects(prepareInvestigation({pool:f.caller('bob'),ticketService:port},'bob',x.workId));assert.equal(port.creates,1);
 }finally{await f.close();}
});
test('uncertain canonical creation holds its reservation and never repeats the external side effect',async()=>{
 const f=await fixture();try{const x=await setup(f),port=ticketPort();let attempts=0;port.createTicket=async()=>{attempts++;throw Error('lost external response');};const ctx={pool:x.pool,ticketService:port};await assert.rejects(prepareInvestigation(ctx,'alice',x.workId),/uncertain/);await assert.rejects(prepareInvestigation(ctx,'alice',x.workId),/pending or uncertain/);assert.equal(attempts,1);const row=(await investigationRecords(ctx,'alice')).items[0];assert.equal(row.state,'creating');assert.equal(row.ticketId,undefined);assert.equal(row.executionAuthorized,false);
 }finally{await f.close();}
});
test('a refused optional Splunk read remains an explicit sealed gap and the canonical investigation still starts',async()=>{
 const f=await fixture();try{
  const x=await setup(f),port=ticketPort();
  await saveExternalConfig(x.pool,'alice',{enabled:true,account:'primary',index:'main',sourceIds:[x.source.id],expectedRevision:0},[x.source.id]);
  const result=await prepareInvestigation({pool:x.pool,ticketService:port,intent:async()=>{throw Error('refused: connector.read.splunk is not linked for this package');}},'alice',x.workId);
  assert.equal(result.ticket.status,'queued');assert.equal(port.creates,1);
  const file=result.startInput.files.find(f=>f.path==='evidence/external.json');assert.ok(file);
  assert.deepEqual(file.digest,[...createHash('sha256').update(Buffer.from(file.bytes)).digest()]);
  const external=JSON.parse(Buffer.from(file.bytes));assert.equal(external.status,'refused');assert.deepEqual(external.items,[]);assert.equal(external.sourceId,x.source.id);
  const retry=await prepareInvestigation({pool:x.pool,ticketService:port,intent:async()=>{throw Error('should not query again');}},'alice',x.workId);
  assert.equal(retry.inputSha256,result.inputSha256);assert.equal(port.creates,1);
 }finally{await f.close();}
});
test('lost link commit acknowledgement reconciles the same canonical ticket without another create',async()=>{
 const f=await fixture();try{let updating=false,lost=false;const x=await setup(f,'alice',async(phase,q)=>{if(phase==='before'&&q.startsWith('UPDATE operations_investigations'))updating=true;if(phase==='after'&&q==='COMMIT'&&updating&&!lost){lost=true;throw Error('lost committed acknowledgement');}}),port=ticketPort();const result=await prepareInvestigation({pool:x.pool,ticketService:port},'alice',x.workId);assert.equal(lost,true);assert.equal(result.ticket.status,'queued');assert.equal(port.creates,1);assert.equal((await prepareInvestigation({pool:x.pool,ticketService:port},'alice',x.workId)).ticketId,result.ticketId);assert.equal(port.creates,1);
 }finally{await f.close();}
});
test('funnel counts distinct cohort-linked accepted native outputs and exposes unavailable downstream stages',()=>{
 const decision=(id,at,outcome='admitted')=>({id:id+at,deliveryId:id,at,outcome:'matched',reduction:{outcome}}),records={decisions:[decision('a','2'),decision('a','1'),decision('b','2'),decision('c','2','suppressed')]};const completed={state:'completed',phase:{index:0},answer:'Measured report',receipt:'native-receipt'};
 const result=metrics(records,{items:[{id:'one',deliveryId:'a',ticket:{status:'done'},work:[completed]},{id:'one',deliveryId:'a',ticket:{status:'done'},work:[completed]},{id:'two',deliveryId:'b',ticket:{status:'queued'},work:[{...completed,resultUnavailable:true}]},{id:'unrelated',deliveryId:'x',ticket:{status:'done'},work:[completed]}]});assert.equal(result.survivors,2);assert.equal(result.packets,2);assert.equal(result.assessed,1);assert.equal(result.reportAccepted,1);assert.equal(result.queued,1);assert.equal(result.recovered,null);assert.equal(metrics(records,{items:[{id:'one',deliveryId:'a',ticketId:'t1',ticket:{status:'done'},work:[completed]}]},{items:[{ticketId:'t1',executions:[{recovery:{outcome:'healthy'}}]},{ticketId:'other',executions:[{recovery:{outcome:'healthy'}}]}]}).recovered,1);assert.equal(metrics(records,{items:[{id:'one',deliveryId:'a',ticketUnavailable:true}]}).unavailable,1);
});

test('actual experience dispatches sealed bytes to the canonical start route and clears workflow rows on refusal',async()=>{
 const f=await fixture(),express=dependency('express'),{chromium}=dependency('playwright');let browser,server;
 try{
  const x=await setup(f),port=ticketPort(),app=express(),errors=[];let starts=0,readStatus=200;
  app.use(express.json({limit:'1mb'}));app.get('/tickets/:id/work',(req,res)=>res.status(readStatus).json({work:port.tickets.get(req.params.id)?.status==='running'?[{state:'completed',phase:{index:0},answer:'Explicit workflow fixture output',receipt:'fixture-only-receipt'}]:[]}));
  app.post('/tickets/:id/start',(req,res)=>{starts++;const file=req.body.files[0],bytes=Buffer.from(file.bytes);assert.deepEqual(file.digest,[...createHash('sha256').update(bytes).digest()]);assert.equal(JSON.parse(bytes).rawStreamAccess,false);assert.equal(req.body.executor,'native-broker-v1');port.tickets.get(req.params.id).status='running';res.json({ticket:port.tickets.get(req.params.id)});});
  app.use((req,_res,next)=>{req.oidc={user:{sub:'alice'}};next();});app.use('/api/intelligent-operations',loadExperience().createOperationsExperienceRoutes({appPackageDir:root,pool:x.pool,ticketService:port,authorization:{registerResource(){}},store:{query:async()=>[],put:async()=>{}}}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app#data');await page.locator('.operator-evidence-work>summary').click();await page.getByRole('button',{name:'Start AI investigation',exact:true}).click();await page.getByRole('link',{name:'Open canonical ticket',exact:true}).waitFor();assert.equal(starts,1);assert.equal(port.creates,1);const panel=page.locator('#pipeline-lifecycle');assert.match(await panel.innerText(),/AI assessments completed\n1/);assert.match(await panel.innerText(),/Verified infrastructure recovery\n0/);
  await Promise.all([page.waitForResponse(r=>r.url().endsWith('/work')&&r.status()===200),page.getByRole('button',{name:'Open or resume investigation',exact:true}).click()]);await page.waitForFunction(()=>document.getElementById('pipeline-lifecycle').getAttribute('aria-busy')==='false');assert.equal(starts,1);assert.equal(port.creates,1);
  readStatus=403;await page.getByRole('button',{name:'Refresh workflow progress',exact:true}).click();await page.waitForFunction(()=>document.getElementById('pipeline-lifecycle').childElementCount===0);assert.equal(await page.getByRole('link',{name:'Open canonical ticket',exact:true}).count(),0);assert.deepEqual(errors,[]);
 }finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await f.close();}
});

test('a failed or cancelled investigation runs again once on a fresh ticket for the same sealed evidence; nothing else may',async()=>{
 const f=await fixture();try{const x=await setup(f),port=ticketPort(),ctx={pool:x.pool,ticketService:port};
  await assert.rejects(investigateAgain(ctx,'alice',x.workId),e=>e.status===409&&/no investigation yet/.test(e.message));
  const first=await prepareInvestigation(ctx,'alice',x.workId);
  await assert.rejects(investigateAgain(ctx,'alice',x.workId),e=>e.status===409&&/this ticket is queued/.test(e.message));assert.equal(port.creates,1);
  port.tickets.get(first.ticketId).status='failed';
  const results=await Promise.allSettled(Array.from({length:6},()=>investigateAgain(ctx,'alice',x.workId)));
  assert.equal(port.creates,2,'one new ticket however many ask at once');
  const opened=results.filter(r=>r.status==='fulfilled').map(r=>r.value);assert.ok(opened.length>=1);assert.equal(new Set(opened.map(v=>v.ticketId)).size,1);
  for(const r of results.filter(r=>r.status==='rejected'))assert.equal(r.reason.status,409);
  const again=opened[0];assert.notEqual(again.ticketId,first.ticketId);assert.equal(again.ticket.status,'queued');assert.equal(again.state,'queued');
  assert.deepEqual(again.startInput,first.startInput,'the same sealed evidence, byte for byte');assert.equal(again.inputSha256,first.inputSha256);assert.notEqual(again.attempt,first.attempt);
  assert.deepEqual(again.previousAttempts.map(p=>[p.ticketId,p.endedAs,p.attempt]),[[first.ticketId,'failed',first.attempt]]);assert.equal(again.executionAuthorized,false);
  port.tickets.get(again.ticketId).status='cancelled';const third=await investigateAgain(ctx,'alice',x.workId);assert.equal(port.creates,3);
  assert.deepEqual(third.previousAttempts.map(p=>p.endedAs),['failed','cancelled']);
  port.tickets.get(third.ticketId).status='done';await assert.rejects(investigateAgain(ctx,'alice',x.workId),e=>e.status===409&&/this ticket is done/.test(e.message));
  await assert.rejects(investigateAgain({pool:f.caller('bob'),ticketService:port},'bob',x.workId),e=>e.status===409);assert.equal(port.creates,3,'another person opens nothing');
  const listed=(await investigationRecords(ctx,'alice')).items;assert.equal(listed.length,1);assert.equal(listed[0].ticketId,third.ticketId);
  assert.equal(listed[0].alert.alertType,x.delivery.normalized.data.alertType);assert.equal(listed[0].alert.environment,'test');
  const labels=investigationLabels(listed);assert.match(labels.get(third.ticketId),new RegExp(listed[0].alert.alertType));assert.match(labels.get(first.ticketId),/\(earlier attempt, failed\)$/);assert.match(labels.get(again.ticketId),/\(earlier attempt, cancelled\)$/);
 }finally{await f.close();}
});
test('a failed investigation offers Investigate again on its evidence card, which opens and starts one new ticket for the same sealed evidence',async()=>{
 const f=await fixture(),express=dependency('express'),{chromium}=dependency('playwright');let browser,server;
 try{
  const x=await setup(f),port=ticketPort(),app=express(),errors=[],started=[];
  app.use(express.json({limit:'1mb'}));app.get('/tickets/:id/work',(_req,res)=>res.json({work:[]}));
  app.post('/tickets/:id/start',(req,res)=>{const t=port.tickets.get(req.params.id);assert.equal(t.status,'queued','only a queued ticket is started');started.push([req.params.id,createHash('sha256').update(Buffer.from(req.body.files[0].bytes)).digest('hex')]);t.status='running';res.json({ticket:t});});
  app.use((req,_res,next)=>{req.oidc={user:{sub:'alice'}};next();});app.use('/api/intelligent-operations',loadExperience().createOperationsExperienceRoutes({appPackageDir:root,pool:x.pool,ticketService:port,authorization:{registerResource(){}},store:{query:async()=>[],put:async()=>{}}}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app#data');await page.locator('.operator-evidence-work>summary').click();
  await page.getByRole('button',{name:'Start AI investigation',exact:true}).click();await page.getByRole('link',{name:'Open canonical ticket',exact:true}).waitFor();assert.equal(started.length,1);
  assert.equal(await page.getByRole('button',{name:'Investigate again',exact:true}).count(),0,'a running investigation offers no second ticket');
  const panel=page.locator('#pipeline-lifecycle');assert.match(await panel.locator('h4').first().innerText(),new RegExp(x.delivery.normalized.data.alertType));
  port.tickets.get(started[0][0]).status='failed';await page.getByRole('button',{name:'Refresh workflow progress',exact:true}).click();
  await panel.getByText('This investigation failed without a report.',{exact:false}).waitFor();await page.getByRole('button',{name:'Investigate again',exact:true}).click();
  await panel.getByText('Earlier attempts: 1; the last one failed.',{exact:true}).waitFor();
  assert.equal(port.creates,2);assert.equal(started.length,2);assert.notEqual(started[1][0],started[0][0]);assert.equal(started[1][1],started[0][1],'the same sealed packet');
  assert.equal(await page.getByRole('button',{name:'Investigate again',exact:true}).count(),0);assert.deepEqual(errors,[]);
 }finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await f.close();}
});
