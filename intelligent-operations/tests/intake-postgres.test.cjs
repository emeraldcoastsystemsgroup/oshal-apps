// CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Verify real transactional intake under concurrency, ownership, failure and restart.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,loadExperience}=require('./fixtures/intake.cjs');
const {admit,intakeRecords}=require('../routes/intake.js');
const {sourceDefinition}=loadExperience(),{example}=require('../ui/source-contract.js');
const source=sourceDefinition({name:'Local',source:example().source,environment:'local-lab'});
async function counts(f){return Object.fromEntries(await Promise.all(['deliveries','delivery_attempts','processing'].map(async n=>[n,(await f.inspect.query('SELECT count(*)::int AS n FROM operations_'+n)).rows[0].n])));}
test('100 reordered retries across two SQL pools admit one durable processing item and retain every attempt',async()=>{
 const f=await fixture();try{
  const pools=[f.caller('alice'),f.caller('alice')],event=example(),reordered=Object.fromEntries(Object.entries(event).reverse());
  reordered.data=Object.fromEntries(Object.entries(event.data).reverse());
  const replies=await Promise.all(Array.from({length:100},(_,i)=>admit(pools[i%2],'alice',source,i%2?event:reordered)));
  assert.equal(replies.filter(r=>r.status===201).length,1);assert.equal(replies.filter(r=>r.retry).length,99);
  assert.deepEqual(await counts(f),{deliveries:1,delivery_attempts:100,processing:1});
  // A replacement pool/process sees the committed ledger, without sharing a cache or connection.
  const restarted=f.caller('alice');assert.equal((await admit(restarted,'alice',source,event)).retry,true);
  assert.equal((await intakeRecords(restarted,'alice')).attempts.length,101);
 }finally{await f.close();}
});
test('reused event ID conflict preserves original content and retains conflicting raw input; independent source and ID stay distinct',async()=>{
 const f=await fixture();try{const p=f.caller('alice'),event=example();const first=await admit(p,'alice',source,event);
  const changed=structuredClone(event);changed.data.severity='critical';const conflict=await admit(p,'alice',source,changed);
  assert.equal(conflict.status,409);assert.deepEqual(conflict.record,first.record);assert.deepEqual(conflict.attempt.raw,changed);
  assert.equal((await admit(p,'alice',source,{...event,id:'another'})).status,201);
  const other=sourceDefinition({name:'Other',source:'urn:operations:other',environment:'local-lab'});
  assert.equal((await admit(p,'alice',other,{...event,source:other.source})).status,201);
  assert.deepEqual(await counts(f),{deliveries:3,delivery_attempts:4,processing:3});
 }finally{await f.close();}
});
test('missing identity, forged source and wrong environment are inspectable quarantine with no processing work',async()=>{
 const f=await fixture();try{const p=f.caller('alice');const missing=example();delete missing.data.resource.id;
  for(const e of [missing,{...example(),id:'forged',source:'urn:forged'},{...example(),id:'environment',data:{...example().data,environment:'elsewhere'}}]){
   const r=await admit(p,'alice',source,e);assert.equal(r.record.decision,'quarantined');assert.deepEqual(r.record.raw,e);
  }
  assert.deepEqual(await counts(f),{deliveries:3,delivery_attempts:3,processing:0});
 }finally{await f.close();}
});
test('owner policies hide every table and deny forged ownership even when SQL omits owner predicates',async()=>{
 const f=await fixture();try{const a=f.caller('alice'),b=f.caller('bob');await admit(a,'alice',source,example());
  for(const table of ['deliveries','delivery_attempts','processing'])assert.equal((await b.query('SELECT * FROM operations_'+table)).rows.length,0);
  assert.deepEqual(await intakeRecords(b,'bob'),{events:[],attempts:[],processing:[]});
  await assert.rejects(admit(b,'alice',source,{...example(),id:'forged-owner'}),/row-level security/);
  assert.equal((await admit(b,'bob',source,example())).status,201);
  await assert.rejects(admit(a,'',source,example()),{status:401});
 }finally{await f.close();}
});
test('statement failure rolls back delivery and processing; uncertain commit is reconciled by producer retry',async()=>{
 const f=await fixture();try{
  const failing=f.caller('alice',(phase,q)=>{if(phase==='before'&&q.startsWith('INSERT INTO operations_delivery_attempts'))throw Error('injected storage failure');});
  await assert.rejects(admit(failing,'alice',source,example()),/injected storage failure/);
  assert.deepEqual(await counts(f),{deliveries:0,delivery_attempts:0,processing:0});
  const lost=f.caller('alice',(phase,q)=>{if(phase==='after'&&q==='COMMIT')throw Error('lost acknowledgement');});
  await assert.rejects(admit(lost,'alice',source,example()),/lost acknowledgement/);
  assert.deepEqual(await counts(f),{deliveries:1,delivery_attempts:1,processing:1});
  assert.equal((await admit(f.caller('alice'),'alice',source,example())).retry,true);
  assert.deepEqual(await counts(f),{deliveries:1,delivery_attempts:2,processing:1});
 }finally{await f.close();}
});

test('the real experience shows durable retries/conflicts and quarantines without replacing original input',async()=>{
 const {dependency,root}=require('./fixtures/intake.cjs'),express=dependency('express'),{chromium}=dependency('playwright');
 const f=await fixture(),app=express(),collections=new Map();let server,browser;
 try{
  app.use((req,_res,next)=>{req.oidc={user:{sub:'alice'}};next();});
  app.use('/api/intelligent-operations',loadExperience().createOperationsExperienceRoutes({appPackageDir:root,pool:f.caller('alice'),authorization:{registerResource(){}},store:{query:async name=>[...(collections.get(name)||new Map()).values()],put:async(name,id,value)=>{if(!collections.has(name))collections.set(name,new Map());collections.get(name).set(id,value);}}}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
  const post=async(path,body)=>{const r=await fetch(base+'/api/intelligent-operations'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  const saved=await post('/sources',{name:'Local lab',source:source.source,environment:'local-lab'});
  const event=example();await post('/events',{sourceId:saved.body.id,event});await post('/events',{sourceId:saved.body.id,event});
  const changed=structuredClone(event);changed.data.severity='critical';assert.equal((await post('/events',{sourceId:saved.body.id,event:changed})).status,409);
  browser=await chromium.launch({headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/api/intelligent-operations/app#data');await page.getByRole('tab',{name:'Events',exact:true}).click();await page.getByRole('button',{name:'Inspect',exact:true}).click();
  await page.getByText('3 attempts in the latest returned page.',{exact:false}).waitFor();
  await page.getByText('conflict ·',{exact:false}).click();assert.match(await page.locator('#event-detail').innerText(),/"severity": "critical"/);
  await page.getByText('Original payload and complete decision records',{exact:true}).click();assert.match(await page.locator('#event-detail').innerText(),/"severity": "warning"/);
  assert.match(await page.locator('#event-detail').innerText(),/"state": "pending"/);
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await f.close();}
});
