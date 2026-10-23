/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the response stage: byte-exact generated-file extraction, plans bound to observed targets, approvals invalidated by a changed canonical revision or expiry, one dispatch per approval across concurrent callers and lost acknowledgements, operator reports that never change canonical state, recovery outcomes that need a resolved admitted signal, server-read ticket updates, owner isolation, and the actual shipped panel driving confirmed native exec fixtures. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash,randomUUID}=require('node:crypto');
const {fixture,loadExperience,dependency,root}=require('./fixtures/intake.cjs');
const Artifacts=require('../ui/response-artifacts.js'),{saveScan}=require('../routes/topology-store.js'),{admit}=require('../routes/intake.js'),{example}=require('../ui/source-contract.js');
const X=require('../routes/execution.js');
const sha=t=>createHash('sha256').update(t).digest('hex');
const UID='4f2c9a10-1111-4222-8333-444455556666';
const ANSWER='# CPU pressure on cpu-pressure-abc\nMODE: A (remediation)\n\n## Decision table\nStop the loop. Approval required before remediate.sh runs.\n\n```sh file=remediate.sh\n: > /run/pressure/stop\n```\n\n```sh file=verify.sh\ntest -f /run/pressure/stop\n```\n\n```md file=rollback.md\nThe stop file only ends a disposable drill; start a new episode instead of reverting.\n```\n\n```md file=verify.md\nRequire a resolved alert for the same fingerprint and a flat counter.\n```\n';
test('generated response files are extracted byte-exact with digests and the approval statement is required',()=>{
 const r=Artifacts.extract(ANSWER,sha);assert.equal(r.executable,true);assert.deepEqual(r.missing,[]);assert.deepEqual(r.artifacts.map(a=>a.name),['remediate.sh','verify.sh','rollback.md','verify.md']);
 for(const a of r.artifacts){assert.equal(ANSWER.slice(a.range.start,a.range.start+a.content.length),a.content);assert.equal(a.sha256,sha(a.content));assert.equal(a.bytes,Buffer.byteLength(a.content));}
 assert.equal(r.artifacts[0].content,': > /run/pressure/stop\n');
 const noApproval=Artifacts.extract(ANSWER.replace('Approval required before remediate.sh runs.','Run it.'),sha);assert.equal(noApproval.executable,false);assert.match(noApproval.problems[0],/approval required/);
 const missing=Artifacts.extract(ANSWER.replace('file=verify.md','file=notes.md'),sha);assert.equal(missing.executable,false);assert.deepEqual(missing.missing,['verify.md']);assert.match(missing.problems[0],/unexpected response file/);
 const big=Artifacts.extract(ANSWER.replace(': > /run/pressure/stop',': > /run/pressure/stop # '+'x'.repeat(4100)),sha);assert.equal(big.executable,false);assert.match(big.problems[0],/exceeds 4096/);
 const dup=Artifacts.extract(ANSWER+'```sh file=remediate.sh\nrm -rf /\n```\n',sha);assert.equal(dup.artifacts.find(a=>a.name==='remediate.sh').content,': > /run/pressure/stop\n');assert.match(dup.problems[0],/Duplicate/);
 assert.equal(Artifacts.extract('plain prose with ```sh\necho\n```\n',sha).executable,false);assert.equal(Artifacts.extract('```sh file=../x.sh\nid\n```\n',sha).artifacts.length,0);
});
function port(status='awaiting_approval'){const current={id:randomUUID(),ticketType:'intelligent-operations',status,revision:7,position:{name:'queue-deliver',index:3}};return {current,async getTicket(id){return id===current.id?{...current}:null;}};}
async function setup(f,owner='alice',intercept){
 const pool=f.caller(owner,intercept),source=loadExperience().sourceDefinition({name:'Response lab',source:'urn:triagenorth:test:'+randomUUID(),environment:'local-lab'});
 const pod={provider:'kubernetes',scope:'cluster-uid',kind:'pod',nativeId:UID,name:'cpu-pressure-abc',health:'degraded',properties:{namespace:'operations-demo'}},node={provider:'kubernetes',scope:'cluster-uid',kind:'node',nativeId:'node-1',name:'worker2',health:'healthy'};
 await saveScan(pool,owner,source,{scanId:'scan-'+randomUUID(),collectionId:'cluster-uid/operations-demo',observedAt:'2026-01-01T00:00:01.000Z',complete:true,assets:[pod,node],relationships:[{from:pod,to:node,type:'RUNS_ON',evidence:'observed'}]});
 const p=port(),ctx={pool,ticketService:p},target={namespace:'operations-demo',pod:'cpu-pressure-abc',uid:UID,container:'pressure'};
 return {pool,source,ctx,current:p.current,target,plan:()=>X.preparePlan(ctx,owner,{ticketId:p.current.id,workId:randomUUID(),phase:'revise',answer:ANSWER,target})};
}
async function resolved(pool,owner,source,status='resolved'){const event=example();event.id=randomUUID();event.source=source.source;event.data.status=status;event.data.alertType='LabNodeCpuPressure';event.data.resource={kind:'kubernetes-pod',scope:'cluster-uid',id:UID};return (await admit(pool,owner,source,event)).record;}
test('a plan binds exact generated files to an observed pod and one canonical revision; approvals bind digests and expire; one dispatch per approval',async()=>{
 const f=await fixture();try{const x=await setup(f),plan=await x.plan();
  assert.equal(plan.target.uid,UID);assert.deepEqual(plan.artifacts.map(a=>a.name),['remediate.sh','verify.sh','rollback.md','verify.md']);assert.deepEqual(plan.dispatch.input.argv,['/bin/sh','-eu','-c',': > /run/pressure/stop\n']);assert.equal(plan.executionAuthorized,false);assert.equal(plan.answerVerifiedByServer,false);assert.equal(plan.ticketRevision,7);
  const again=await X.preparePlan(x.ctx,'alice',{ticketId:x.current.id,workId:randomUUID(),phase:'revise',answer:ANSWER,target:x.target});assert.notEqual(again.id,plan.id,'a different work record is a different plan');
  const same=await X.preparePlan(x.ctx,'alice',{ticketId:x.current.id,workId:plan.workId,phase:'revise',answer:ANSWER,target:x.target});assert.equal(same.id,plan.id);
  const file=await X.artifactContent(x.ctx,'alice',plan.id,'remediate.sh');assert.equal(file.content.toString(),': > /run/pressure/stop\n');assert.equal(file.sha256,plan.artifacts[0].sha256);
  await assert.rejects(X.preparePlan(x.ctx,'alice',{ticketId:x.current.id,workId:randomUUID(),phase:'revise',answer:ANSWER,target:{...x.target,uid:'unobserved-uid'}}),{status:409});
  await assert.rejects(X.preparePlan(x.ctx,'alice',{ticketId:x.current.id,workId:randomUUID(),phase:'revise',answer:'MODE: B\nno files',target:x.target}),{status:422});
  await assert.rejects(X.preparePlan(x.ctx,'alice',{ticketId:x.current.id,workId:randomUUID(),phase:'revise',answer:ANSWER,target:x.target,kubeconfig:'x'}),{status:400});
  const bob={pool:f.caller('bob'),ticketService:x.ctx.ticketService};assert.equal((await X.responseRecords(bob,'bob')).items.length,0);await assert.rejects(X.artifactContent(bob,'bob',plan.id,'remediate.sh'),{status:404});await assert.rejects(X.approvePlan(bob,'bob',{planId:plan.id}),{status:404});
  const approval=await X.approvePlan(x.ctx,'alice',{planId:plan.id});assert.equal(approval.principal,'alice');assert.deepEqual(approval.artifacts.map(a=>a.sha256),plan.artifacts.map(a=>a.sha256));assert.ok(Date.parse(approval.expiresAt)-Date.now()>1700000);assert.equal((await X.approvePlan(x.ctx,'alice',{planId:plan.id})).id,approval.id);
  const calls=await Promise.allSettled(Array.from({length:12},()=>X.reserveExecution(x.ctx,'alice',{approvalId:approval.id,account:'primary'})));assert.equal(calls.filter(r=>r.status==='fulfilled').length,1);for(const r of calls)if(r.status==='rejected')assert.equal(r.reason.status,409);
  const execution=calls.find(r=>r.status==='fulfilled').value;assert.equal(execution.state,'reserved-outcome-unknown');assert.equal(execution.verifiedByServer,false);assert.deepEqual(execution.dispatch.input,plan.dispatch.input);assert.equal(execution.dispatch.account,'primary');
  await assert.rejects(X.reserveVerification(x.ctx,'alice',{executionId:execution.id}),/Report the action outcome/);
  const reported=await X.reportExecution(x.ctx,'alice',{executionId:execution.id,result:{outcome:'completed',exitCode:0,stdout:'','stderr':'',observedAt:'now',target:{observedUid:UID},transport:'native_kubernetes'}});assert.equal(reported.state,'completed');assert.equal(reported.action.provenance,'operator-report');assert.equal(reported.recovery.outcome,'not-verified');assert.equal(x.current.status,'awaiting_approval');
  await assert.rejects(X.reportExecution(x.ctx,'alice',{executionId:execution.id,result:{outcome:'completed',exitCode:0}}),{status:409});
  await assert.rejects(X.reserveExecution(x.ctx,'alice',{approvalId:approval.id,account:'primary'}),/already has a reserved dispatch/);
  const second=await X.approvePlan(x.ctx,'alice',{planId:again.id});await f.inspect.query("UPDATE operations_action_approvals SET record=jsonb_set(record,'{expiresAt}',to_jsonb('2000-01-01T00:00:00.000Z'::text)) WHERE id=$1",[second.id]);await assert.rejects(X.reserveExecution(x.ctx,'alice',{approvalId:second.id,account:'primary'}),/expired/);
  x.current.revision=8;await assert.rejects(X.approvePlan(x.ctx,'alice',{planId:again.id}),/revision changed/);const page=await X.responseRecords(x.ctx,'alice');assert.equal(page.items.find(i=>i.id===plan.id).invalidated,true);assert.equal(page.automaticExecution,false);
  const receipt=await X.executionReceipt(x.ctx,'alice',execution.id);assert.equal(receipt.execution.id,execution.id);assert.match(receipt.labels.actionAndVerificationCommands,/verifiedByServer=false/);
 }finally{await f.close();}
});
test('recovery is healthy only with a passing verification and a resolved admitted signal for the same resource; the ticket update is server-read',async()=>{
 const f=await fixture();try{const x=await setup(f),plan=await x.plan(),approval=await X.approvePlan(x.ctx,'alice',{planId:plan.id}),execution=await X.reserveExecution(x.ctx,'alice',{approvalId:approval.id,account:'primary'});
  await X.reportExecution(x.ctx,'alice',{executionId:execution.id,result:{outcome:'completed',exitCode:0,target:{observedUid:UID}}});
  const ok={outcome:'completed',exitCode:0,stdout:'',target:{observedUid:UID}},readback={observedAt:'now',pod:{uid:UID,phase:'Running'}};
  let v=await X.reserveVerification(x.ctx,'alice',{executionId:execution.id});assert.deepEqual(v.dispatch.input.argv,['/bin/sh','-eu','-c','test -f /run/pressure/stop\n']);
  await assert.rejects(X.reserveVerification(x.ctx,'alice',{executionId:execution.id}),/already reserved/);
  let r=await X.reportVerification(x.ctx,'alice',{executionId:execution.id,verificationId:v.id,result:{...ok,exitCode:1},readback});assert.equal(r.recovery.outcome,'regressed');
  v=await X.reserveVerification(x.ctx,'alice',{executionId:execution.id});r=await X.reportVerification(x.ctx,'alice',{executionId:execution.id,verificationId:v.id,result:{...ok,outcome:'unknown',exitCode:null},readback});assert.equal(r.recovery.outcome,'inconclusive');
  v=await X.reserveVerification(x.ctx,'alice',{executionId:execution.id});r=await X.reportVerification(x.ctx,'alice',{executionId:execution.id,verificationId:v.id,result:ok,readback:{pod:{uid:'replacement-uid'}}});assert.equal(r.recovery.outcome,'inconclusive');assert.match(r.recovery.reason,/identity/);
  v=await X.reserveVerification(x.ctx,'alice',{executionId:execution.id});r=await X.reportVerification(x.ctx,'alice',{executionId:execution.id,verificationId:v.id,result:ok,readback});assert.equal(r.recovery.outcome,'inconclusive');assert.equal(r.verifications.at(-1).signal.resolved,false);
  await resolved(x.pool,'alice',x.source,'firing');v=await X.reserveVerification(x.ctx,'alice',{executionId:execution.id});r=await X.reportVerification(x.ctx,'alice',{executionId:execution.id,verificationId:v.id,result:ok,readback});assert.equal(r.recovery.outcome,'inconclusive','a firing delivery is not a resolved signal');
  const delivery=await resolved(x.pool,'alice',x.source);v=await X.reserveVerification(x.ctx,'alice',{executionId:execution.id});r=await X.reportVerification(x.ctx,'alice',{executionId:execution.id,verificationId:v.id,result:ok,readback});assert.equal(r.recovery.outcome,'healthy');assert.equal(r.verifications.at(-1).signal.deliveryId,delivery.id);assert.equal(r.recovery.signalVerifiedByServer,true);assert.equal(r.recovery.commandVerifiedByServer,false);
  assert.equal(x.current.status,'awaiting_approval','no operator report changed the canonical ticket');x.current.status='done';x.current.revision=8;const updated=await X.recordTicketUpdate(x.ctx,'alice',{executionId:execution.id});assert.deepEqual({status:updated.ticketUpdate.status,revision:updated.ticketUpdate.revision,verifiedByServer:updated.ticketUpdate.verifiedByServer},{status:'done',revision:8,verifiedByServer:true});
  const bob={pool:f.caller('bob'),ticketService:x.ctx.ticketService};await assert.rejects(X.reserveVerification(bob,'bob',{executionId:execution.id}),{status:404});await assert.rejects(X.executionReceipt(bob,'bob',execution.id),{status:404});
 }finally{await f.close();}
});
test('a lost reservation commit acknowledgement cannot authorize a second dispatch',async()=>{
 const f=await fixture();try{let writing=false,lost=false;const x=await setup(f,'alice',async(phase,q)=>{if(phase==='before'&&q.startsWith('INSERT INTO operations_action_executions'))writing=true;if(phase==='after'&&q==='COMMIT'&&writing&&!lost){lost=true;throw Error('lost acknowledgement');}});
  const plan=await x.plan(),approval=await X.approvePlan(x.ctx,'alice',{planId:plan.id});await assert.rejects(X.reserveExecution(x.ctx,'alice',{approvalId:approval.id,account:'primary'}),/lost acknowledgement/);assert.equal(lost,true);
  await assert.rejects(X.reserveExecution(x.ctx,'alice',{approvalId:approval.id,account:'primary'}),/already has a reserved dispatch/);assert.equal((await X.responseRecords(x.ctx,'alice')).items[0].executions.length,1);
 }finally{await f.close();}
});
async function browserFixture(){
 const f=await fixture(),x=await setup(f),express=dependency('express'),app=express(),proofs=new Set(),effects=[];let denied=false;const work=[{id:randomUUID(),phase:{index:0,name:'investigate'},state:'completed',answer:'MODE: B\nneeds data',receipt:'r0'},{id:randomUUID(),phase:{index:2,name:'revise'},state:'completed',answer:ANSWER,receipt:'r2'}];
 app.use(express.json({limit:'1mb'}));
 app.get('/api/tickets',(_req,res)=>res.status(denied?403:200).json({tickets:[x.current]}));app.get('/tickets/:id/work',(req,res)=>res.json({work:req.params.id===x.current.id?work:[]}));
 app.get('/connectors',(_req,res)=>res.status(denied?403:200).json({connections:[{connector:'kubernetes',account:'primary',shared:false,status:'connected'}],httpServices:[{connector:'kubernetes',configured:true,capabilityLinked:true}]}));
 app.post('/confirmations',(_req,res)=>{const id=randomUUID();proofs.add(id);res.json({confirmation:id});});
 app.post('/connectors/kubernetes/actions/:operation',(req,res)=>{assert.ok(proofs.delete(req.headers['x-oshal-confirm']),'every native action needs a fresh confirmation');assert.equal(req.query.account,'primary');const op=req.params.operation;effects.push({op,body:req.body});
  if(op==='kubernetes-inspect-pod')return res.json({transport:'native_kubernetes',operation:op,observedAt:'t',pod:{uid:UID,name:'cpu-pressure-abc',namespace:'operations-demo',phase:'Running',containers:[{name:'pressure',ready:true}]},executionAuthorized:false});
  assert.equal(op,'kubernetes-exec');res.json({transport:'native_kubernetes',operation:op,observedAt:'t',target:{namespace:'operations-demo',pod:'cpu-pressure-abc',observedUid:UID,container:'pressure'},outcome:'completed',exitCode:0,stdout:'',stderr:''});});
 app.post('/tickets/:id/approve',(req,res)=>{assert.ok(proofs.delete(req.headers['x-oshal-confirm']));effects.push({op:'approve'});x.current.status='done';x.current.revision++;res.json({ticket:{...x.current}});});
 app.use((req,_res,next)=>{req.oidc={user:{sub:'alice'}};next();});app.use('/api/intelligent-operations',loadExperience().createOperationsExperienceRoutes({...x.ctx,appPackageDir:root,authorization:{registerResource(){}},store:{query:async()=>[],put:async()=>{}}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const {chromium}=dependency('playwright'),browser=await chromium.launch({headless:true,args:['--disable-gpu']}),page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const origin='http://127.0.0.1:'+server.address().port;await page.goto(origin+'/api/intelligent-operations/app#incidents');await page.getByText('Records refreshed',{exact:false}).waitFor();
 return {page,x,effects,errors,origin,deny(){denied=true;},async close(){await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));await f.close();}};
}
test('the shipped panel plans from accepted work, approves exact files, dispatches once through confirmed native exec, verifies against a resolved signal and updates the canonical ticket',async()=>{
 const f=await browserFixture();try{const {page}=f;
  await page.getByRole('button',{name:'Refresh response plans',exact:true}).click();await page.getByText('Plans bind exact generated files',{exact:false}).waitFor();
  await page.getByText('Prepare a response plan from accepted work',{exact:true}).click();await page.locator('#response-preview').getByText('Generated response files: remediate.sh',{exact:false}).waitFor();
  await page.locator('#response-container').fill('pressure');assert.equal(await page.getByRole('button',{name:'Prepare response plan',exact:true}).isEnabled(),true);
  await page.getByRole('button',{name:'Prepare response plan',exact:true}).click();await page.locator('#response-plans .card').first().waitFor();assert.equal(f.effects.length,0,'planning makes no native action');
  const link=page.locator('#response-plans a',{hasText:'remediate.sh'}).first();const href=await link.getAttribute('href');const download=await fetch(f.origin+href);assert.equal(download.headers.get('content-disposition'),'attachment; filename="remediate.sh"');const bytes=await download.text();assert.equal(bytes,': > /run/pressure/stop\n');assert.equal(download.headers.get('x-content-sha256'),sha(bytes));
  await page.getByRole('button',{name:'Approve this exact action',exact:true}).click();await page.getByText('Approved by you until',{exact:false}).waitFor();assert.equal(f.effects.length,0,'approval makes no native action');
  await page.getByRole('button',{name:'Execute approved action',exact:true}).click();await page.getByText('Dispatch reported as completed',{exact:false}).waitFor();
  assert.deepEqual(f.effects.map(e=>e.op),['kubernetes-inspect-pod','kubernetes-exec']);assert.deepEqual(f.effects[1].body,{namespace:'operations-demo',pod:'cpu-pressure-abc',uid:UID,container:'pressure',argv:['/bin/sh','-eu','-c',': > /run/pressure/stop\n']});
  assert.equal(await page.getByRole('button',{name:'Execute approved action',exact:true}).isDisabled(),true,'one dispatch per approval');assert.equal(f.x.current.status,'awaiting_approval');
  await page.getByRole('button',{name:'Verify recovery',exact:true}).click();await page.getByText('Recovery outcome: inconclusive',{exact:false}).waitFor();assert.deepEqual(f.effects.slice(2).map(e=>e.op),['kubernetes-exec','kubernetes-inspect-pod']);assert.deepEqual(f.effects[2].body.argv,['/bin/sh','-eu','-c','test -f /run/pressure/stop\n']);
  assert.equal(await page.getByRole('button',{name:'Accept report and update ticket',exact:true}).isDisabled(),true,'no ticket update without a healthy outcome');
  await resolved(f.x.pool,'alice',f.x.source);await page.getByRole('button',{name:'Verify recovery',exact:true}).click();await page.getByText('Recovery outcome: healthy',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Accept report and update ticket',exact:true}).click();await page.getByText('Canonical ticket done at revision 8',{exact:false}).waitFor();assert.equal(f.effects.at(-1).op,'approve');assert.equal(f.x.current.status,'done');
  await page.getByText('Ticket after update: done · revision 8 (server-read)',{exact:false}).waitFor();assert.equal(f.effects.filter(e=>e.op==='kubernetes-exec').length,3);
  f.deny();await page.getByRole('button',{name:'Refresh response plans',exact:true}).click();await page.waitForFunction(()=>document.getElementById('response-plans').childElementCount===0);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
