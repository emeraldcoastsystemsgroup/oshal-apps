// CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Prove actual percolation and transactional reduction under concurrency, replay, late states and backend failure.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,loadExperience}=require('./fixtures/intake.cjs'),{engineFixture}=require('./fixtures/detection.cjs');
const {publishPolicy,evaluateDelivery,pipelineRecords}=require('../routes/pipeline.js'),{admit,hash}=require('../routes/intake.js'),{example}=require('../ui/source-contract.js');
const source=loadExperience().sourceDefinition({name:'Pipeline acceptance',source:example().source,environment:'local-lab'});
const policy=(extra={})=>({name:'Availability',window:{mode:'sliding',seconds:900},rules:[{name:'All lab alerts',enabled:true,capture:true,query:{term:{environment:'local-lab'}}}],...extra});
async function env(){const f=await fixture(),e=await engineFixture(),owner='pipeline-'+randomUUID(),p=f.caller(owner),indexes=new Set();const engine=async(cmd,who,args)=>{if(cmd==='publish')indexes.add('ops-rules-'+hash(['detection-owner-v1',who])+'-'+args.revision);return e.engine(cmd,who,args);};return {f,e,owner,p,engine,async close(){await e.close();await f.close();for(const index of indexes){const r=await fetch(process.env.OSHAL_TEST_SEARCH+'/'+index,{method:'DELETE'});assert.ok(r.ok||r.status===404);}}};}
async function event(x,id,changes={}){const n=example();n.id=id;Object.assign(n.data,changes);return (await admit(x.p,x.owner,source,n)).record.id;}

test('actual OpenSearch percolates every sealed rule page and excludes disabled rules; failed publication never activates',async()=>{
 const x=await env();try{
  const rules=Array.from({length:37},(_,i)=>({name:'Rule '+i,enabled:i!==36,capture:true,query:{term:{environment:'local-lab'}}}));
  const saved=await publishPolicy(x.p,x.engine,x.owner,source,policy({rules}),0);assert.equal(saved.policy.receipt.count,37);
  const id=await event(x,'page-test');const decision=await evaluateDelivery(x.p,x.engine,x.owner,id);assert.equal(decision.matches.length,36);assert.equal(decision.outcome,'matched');assert.equal(decision.reduction.outcome,'admitted');
  assert.equal((await evaluateDelivery(x.p,x.engine,x.owner,id)).retry,true);
  await assert.rejects(publishPolicy(x.p,x.engine,x.owner,source,policy({rules:[{name:'invalid',enabled:true,capture:true,query:{script:{script:'true'}}}]}),1),/Unsupported stored query/);
  assert.equal((await pipelineRecords(x.p,x.owner)).bindings[0].policyId,saved.policy.id);
  await assert.rejects(x.engine('match','other-person',{revision:saved.policy.id,document:{environment:'local-lab'}}),/HTTP 404/);
 }finally{await x.close();}
});
test('100 distinct occurrences across two SQL workers reserve one evidence job; replay does not inflate counts',async()=>{
 const x=await env();try{
  await publishPolicy(x.p,x.engine,x.owner,source,policy(),0);
  const ids=[];for(let i=0;i<100;i++)ids.push(await event(x,'storm-'+i));
  const second=x.f.caller(x.owner),decisions=[];
  await Promise.all([0,1].map(async replica=>{for(let i=replica;i<ids.length;i+=2)decisions.push(await evaluateDelivery(replica?second:x.p,x.engine,x.owner,ids[i]));}));
  assert.equal(decisions.filter(d=>d.reduction.outcome==='admitted').length,1);assert.equal(decisions.filter(d=>d.reduction.outcome==='suppressed').length,99);
  let rows=await pipelineRecords(x.p,x.owner);assert.equal(rows.symptoms[0].count,100);assert.equal(rows.evidenceWork.length,1);assert.equal(rows.evidenceWork[0].executionAuthorized,false);
  const changed=policy();changed.rules[0].name='Changed interpretation';await publishPolicy(x.p,x.engine,x.owner,source,changed,1);
  const replay=await evaluateDelivery(second,x.engine,x.owner,ids[0]);assert.equal(replay.reduction.replayed,true);assert.ok(replay.previousDecisionId);
  rows=await pipelineRecords(second,x.owner);assert.equal(rows.symptoms[0].count,100);assert.equal(rows.evidenceWork.length,1);
  for(const table of ['policies','policy_bindings','filter_decisions','processing_attempts','symptoms','symptom_occurrences','evidence_work'])assert.equal((await x.f.caller('outsider').query('SELECT * FROM operations_'+table)).rows.length,0);
 }finally{await x.close();}
});
test('fixed and sliding boundaries, escalation high-water and late resolution are explicit',async()=>{
 const x=await env();try{
  await publishPolicy(x.p,x.engine,x.owner,source,policy({window:{mode:'fixed',seconds:10}}),0);
  const at=seconds=>()=>new Date(Date.UTC(2026,9,20,12,0,seconds)).toISOString();
  const first=await event(x,'first');assert.equal((await evaluateDelivery(x.p,x.engine,x.owner,first,at(0))).reduction.outcome,'admitted');
  const next=await event(x,'within');assert.equal((await evaluateDelivery(x.p,x.engine,x.owner,next,at(9))).reduction.outcome,'suppressed');
  const boundary=await event(x,'boundary');assert.equal((await evaluateDelivery(x.p,x.engine,x.owner,boundary,at(10))).reduction.outcome,'admitted');
  const critical=await event(x,'critical',{severity:'critical'});assert.equal((await evaluateDelivery(x.p,x.engine,x.owner,critical,at(11))).reduction.outcome,'escalated');
  const down=await event(x,'down');await evaluateDelivery(x.p,x.engine,x.owner,down,at(12));
  const criticalAgain=await event(x,'critical-again',{severity:'critical'});assert.equal((await evaluateDelivery(x.p,x.engine,x.owner,criticalAgain,at(13))).reduction.outcome,'suppressed');
  const resolved=example();resolved.id='old-resolution';resolved.time='2026-01-01T00:00:00Z';resolved.data.status='resolved';const old=(await admit(x.p,x.owner,source,resolved)).record.id;
  assert.equal((await evaluateDelivery(x.p,x.engine,x.owner,old,at(14))).reduction.outcome,'late-occurrence');assert.equal((await pipelineRecords(x.p,x.owner)).symptoms[0].status,'firing');
 }finally{await x.close();}
});
test('backend loss records a failed attempt and leaves pending work; genuine no-match is a separate completed decision',async()=>{
 const x=await env();try{
  await publishPolicy(x.p,x.engine,x.owner,source,policy({rules:[{name:'Other kind',enabled:true,capture:false,query:{term:{alertType:'WillNotMatch'}}}]}),0);
  const id=await event(x,'failure');
  // A failed transport is injected outside the real percolator/store boundaries; live no-match follows against both real services.
  await assert.rejects(evaluateDelivery(x.p,async()=>{throw Error('transport unavailable');},x.owner,id));
  assert.equal((await x.p.query('SELECT state FROM operations_processing WHERE user_sub=$1 AND id=$2',[x.owner,id])).rows[0].state,'pending');
  let rows=await pipelineRecords(x.p,x.owner);assert.equal(rows.decisions.length,0);assert.equal(rows.attempts.length,1);assert.equal(rows.evidenceWork.length,0);
  const result=await evaluateDelivery(x.p,x.engine,x.owner,id);assert.equal(result.outcome,'unmatched');assert.equal(result.reduction.outcome,'filtered');
  rows=await pipelineRecords(x.p,x.owner);assert.equal(rows.decisions.length,1);assert.equal(rows.evidenceWork.length,0);
 }finally{await x.close();}
});
test('simultaneous policy activation uses a revision check and an unavailable index is never an unmatched event',async()=>{
 const x=await env();try{
  const changed=policy();changed.rules[0].name='Alternate';
  const results=await Promise.allSettled([publishPolicy(x.p,x.engine,x.owner,source,policy(),0),publishPolicy(x.f.caller(x.owner),x.engine,x.owner,source,changed,0)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  const active=(await pipelineRecords(x.p,x.owner)).bindings[0];const index='ops-rules-'+hash(['detection-owner-v1',x.owner])+'-'+active.policyId;
  assert.equal((await fetch(process.env.OSHAL_TEST_SEARCH+'/'+index,{method:'DELETE'})).ok,true);
  const id=await event(x,'missing-index');await assert.rejects(evaluateDelivery(x.p,x.engine,x.owner,id),/HTTP 404/);
  const rows=await pipelineRecords(x.p,x.owner);assert.equal(rows.decisions.length,0);assert.equal(rows.evidenceWork.length,0);assert.equal(rows.attempts.length,1);
 }finally{await x.close();}
});
test('sliding reservations extend on a new occurrence; resolution changes the source state without claiming recovery',async()=>{
 const x=await env();try{
  await publishPolicy(x.p,x.engine,x.owner,source,policy({window:{mode:'sliding',seconds:10}}),0);
  const at=s=>()=>new Date(Date.UTC(2026,9,20,12,0,s)).toISOString();
  await evaluateDelivery(x.p,x.engine,x.owner,await event(x,'start'),at(0));await evaluateDelivery(x.p,x.engine,x.owner,await event(x,'repeat'),at(9));
  assert.equal((await evaluateDelivery(x.p,x.engine,x.owner,await event(x,'extended'),at(10))).reduction.outcome,'suppressed');
  const raw=example();raw.id='resolved';raw.time='2026-10-21T00:00:00Z';raw.data.status='resolved';const id=(await admit(x.p,x.owner,source,raw)).record.id;
  const resolved=await evaluateDelivery(x.p,x.engine,x.owner,id,at(11));assert.equal(resolved.reduction.outcome,'source-resolved');
  const rows=await pipelineRecords(x.p,x.owner);assert.equal(rows.symptoms[0].status,'resolved');assert.equal(rows.evidenceWork.length,1);assert.equal(rows.evidenceWork[0].state,'pending');assert.equal(rows.evidenceWork[0].executionAuthorized,false);
 }finally{await x.close();}
});
test('a failed final write rolls back filtering, counts and reservation; uncertain commit reconciles on retry',async()=>{
 const x=await env();try{
  await publishPolicy(x.p,x.engine,x.owner,source,policy(),0);const id=await event(x,'atomic');
  const broken=x.f.caller(x.owner,(phase,q)=>{if(phase==='before'&&q.startsWith('UPDATE operations_processing SET'))throw Error('storage failure');});
  await assert.rejects(evaluateDelivery(broken,x.engine,x.owner,id),/storage failure/);
  let rows=await pipelineRecords(x.p,x.owner);assert.equal(rows.symptoms.length,0);assert.equal(rows.decisions.length,0);assert.equal(rows.evidenceWork.length,0);
  // Lose the COMMIT response only after the reduction transaction reaches its last statement.
  let armed=false;const lost=x.f.caller(x.owner,(phase,q)=>{if(q.startsWith('UPDATE operations_processing SET'))armed=true;if(armed&&phase==='after'&&q==='COMMIT'){armed=false;throw Error('lost commit acknowledgement');}});
  await assert.rejects(evaluateDelivery(lost,x.engine,x.owner,id),/lost commit acknowledgement/);
  assert.equal((await evaluateDelivery(x.p,x.engine,x.owner,id)).retry,true);
  rows=await pipelineRecords(x.p,x.owner);assert.equal(rows.symptoms[0].count,1);assert.equal(rows.decisions.length,1);assert.equal(rows.evidenceWork.length,1);
 }finally{await x.close();}
});
test('the shipped Data view publishes and evaluates through real SQL and percolation at desktop and phone widths',async()=>{
 const {dependency,root}=require('./fixtures/intake.cjs'),express=dependency('express'),{chromium}=dependency('playwright');
 const x=await env(),collections=new Map(),app=express();let server,browser,index;
 try{
  app.use((req,_res,next)=>{req.oidc={user:{sub:x.owner}};next();});
  app.use('/api/intelligent-operations',loadExperience().createOperationsExperienceRoutes({appPackageDir:root,pool:x.p,intent:x.e.intent,authorization:{registerResource(){}},store:{query:async name=>[...(collections.get(name)||new Map()).values()],put:async(name,id,value)=>{if(!collections.has(name))collections.set(name,new Map());collections.get(name).set(id,value);}}}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
  const post=async(path,body)=>{const r=await fetch(base+'/api/intelligent-operations'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.ok,true,await r.clone().text());return r.json();};
  const saved=await post('/sources',{name:source.name,source:source.source,environment:source.environment});
  for(let i=0;i<4;i++){const raw=example();raw.id='browser-'+i;if(i===3)raw.data.alertType='Ignored';await post('/events',{sourceId:saved.id,event:raw});}
  browser=await chromium.launch({headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/api/intelligent-operations/app#data');await page.getByText('Records refreshed',{exact:false}).waitFor();
  await page.getByRole('tab',{name:'Rules',exact:true}).click();await page.getByText('Saved generations and advanced JSON',{exact:true}).click();await page.locator('#policy-json').fill(JSON.stringify(policy({rules:[{name:'Only selected type',enabled:true,capture:true,query:{term:{alertType:example().data.alertType}}}]})));
  await page.locator('#policy-import-json').click();await page.getByRole('button',{name:'Publish and activate',exact:true}).click();await page.waitForFunction(()=>document.getElementById('policy-active').textContent.includes('binding revision 1'),{}, {timeout:15000});
  const binding=(await pipelineRecords(x.p,x.owner)).bindings[0];index='ops-rules-'+hash(['detection-owner-v1',x.owner])+'-'+binding.policyId;
  await page.getByRole('tab',{name:'Flow',exact:true}).click();await page.getByRole('button',{name:'Check detection service',exact:true}).click();await page.getByText('Detection service: opensearch',{exact:false}).waitFor();
  await page.getByRole('tab',{name:'Events',exact:true}).click();for(const check of await page.locator('#event-list input[type=checkbox]').all())await check.check();
  await page.getByRole('button',{name:'Evaluate selected events',exact:true}).click();await page.getByText('4 evaluations completed; 0 require attention.',{exact:false}).waitFor();
  const rows=await pipelineRecords(x.p,x.owner);assert.equal(rows.decisions.length,4);assert.equal(rows.symptoms[0].count,3);assert.equal(rows.evidenceWork.length,1);
  await page.getByRole('tab',{name:'Flow',exact:true}).click();assert.match(await page.locator('#pipeline-flow').innerText(),/3\/4 · 75.0%/);
  assert.match(await page.locator('#pipeline-flow').innerText(),/2 duplicate occurrences suppressed/);
  await page.getByRole('tab',{name:'Events',exact:true}).click();await page.getByRole('button',{name:'Filter, reduce & correlate selected',exact:true}).click();
  await page.getByText('4 submitted · 1 surviving events · 1 correlation groups',{exact:false}).waitFor();
  await page.getByRole('tab',{name:'Correlation',exact:true}).click();assert.match(await page.locator('#correlation-history').innerText(),/exact-asset fallback groups/);
  const persisted=await pipelineRecords(x.p,x.owner);assert.equal(persisted.correlations.length,1);assert.equal(persisted.correlations[0].deliveryIds.length,1);
  const foreign=await pipelineRecords(x.f.caller('another-reader'),'another-reader');assert.equal(foreign.correlations.length,0);
  await page.reload();await page.getByText('Records refreshed',{exact:false}).waitFor();await page.getByRole('tab',{name:'Correlation',exact:true}).click();await page.getByText('1 groups from 1 events',{exact:true}).waitFor();
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await x.close();if(index)assert.equal((await fetch(process.env.OSHAL_TEST_SEARCH+'/'+index,{method:'DELETE'})).ok,true);}
});
test('incomplete percolation responses cannot become a successful match set',()=>{
 const {spawnSync}=require('node:child_process');const code=String.raw`import copy
from percolation import Percolator, Failure
scope='a'*64; revision='b'*64; rule='c'*64; index='ops-rules-'+scope+'-'+revision
valid={'_shards':{'total':1,'successful':1,'failed':0},'timed_out':False,'hits':{'total':{'relation':'eq','value':1},'hits':[{'_source':{'ruleId':rule},'sort':[rule]}]}}
# Named protocol seams: actual backend behavior is separately exercised by the integration cases.
for mutation in ['timeout','shard','inexact','empty','repeated']:
 response=copy.deepcopy(valid)
 if mutation=='timeout':response['timed_out']=True
 if mutation=='shard':response['_shards']['total']=2
 if mutation=='inexact':response['hits']['total']['relation']='gte'
 if mutation=='empty':response['hits']['hits']=[]
 if mutation=='repeated':response['hits']['total']['value']=2;response['hits']['hits']*=2
 engine=Percolator('http://127.0.0.1:1')
 engine.call=lambda method,path,body=None:(200,{index:{'settings':{'index':{'blocks':{'write':'true'}}}}} if path.endswith('_settings') else response)
 try:engine.match(scope,revision,{'status':'firing'});raise AssertionError(mutation+' accepted')
 except Failure:pass
print('incomplete results refused')`;
 const result=spawnSync('python3',['-c',code],{cwd:require('./fixtures/intake.cjs').root+'/engine',encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/incomplete results refused/);
});
test('detection deployment keeps search private, denies cluster credentials and pins the package build',()=>{
 const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),{root}=require('./fixtures/intake.cjs');
 const objects=JSON.parse(execFileSync('python3',[path.join(root,'lab/detection.py'),'render'],{encoding:'utf8'}));
 const deployment=objects.find(o=>o.kind==='Deployment'),pod=deployment.spec.template.spec;
 assert.equal(pod.automountServiceAccountToken,false);assert.equal(deployment.spec.replicas,1);
 assert.equal(deployment.spec.template.metadata.annotations['operations.oshal.dev/engine-build'],JSON.parse(fs.readFileSync(path.join(root,'engine/identity.json'))).buildHash);
 for(const c of pod.containers){assert.match(c.image,/@sha256:[a-f0-9]{64}$/);assert.equal(c.securityContext.allowPrivilegeEscalation,false);assert.ok(c.resources.limits.memory);}
 assert.equal(pod.containers.find(c=>c.name==='search').env.find(e=>e.name==='network.host').value,'127.0.0.1');
 assert.deepEqual(objects.find(o=>o.kind==='Service').spec.ports,[{port:7419,targetPort:7419}]);
 const network=objects.find(o=>o.kind==='NetworkPolicy').spec;assert.deepEqual(network.egress,[]);assert.equal(network.ingress[0].from[0].namespaceSelector.matchLabels['kubernetes.io/metadata.name'],'oshal-install-lab');
});

test('flow percentages use one latest decision per event and keep correlation coverage explicit',()=>{
 const {cohort}=require('../experience/explorer.js');
 const rows=cohort({decisions:[{id:'old',deliveryId:'one',at:'1',outcome:'unmatched'},
 {id:'new',deliveryId:'one',at:'2',outcome:'matched',reduction:{outcome:'admitted',replayed:true}},
 {id:'two',deliveryId:'two',at:'2',outcome:'matched',reduction:{outcome:'suppressed'}},
 {id:'three',deliveryId:'three',at:'2',outcome:'unmatched'}],correlations:[{deliveryIds:['unrelated'],groups:[['unrelated']]},{deliveryIds:['one'],groups:[['one']]}]});
 assert.equal(rows.decisions.length,3);assert.equal(rows.matched.length,2);assert.equal(rows.survivors.length,1);assert.equal(rows.suppressed.length,1);assert.deepEqual(rows.correlation.deliveryIds,['one']);
 assert.equal(cohort({decisions:[],correlations:[]}).correlation,null);
});
