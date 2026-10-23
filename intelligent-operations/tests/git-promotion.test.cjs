/* CHANGE LOG: git providers | maintainer@emeraldcoastsystemsgroup.com | Only configured Git providers are offered. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Guard Git promotion: server-supplied exact file bytes and manifest, one reservation per plan/path/destination, break-glass reconciliation only after an execution with a 24-hour deadline, bounded provider reports on github.com/gitlab.com only, owner isolation, and the shipped panel driving the GitHub tree → commit → ref → pull → dispatch sequence with a fresh confirmation per write. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash,randomUUID}=require('node:crypto');
const {fixture,loadExperience,dependency,root}=require('./fixtures/intake.cjs'),{saveScan}=require('../routes/topology-store.js');
const X=require('../routes/execution.js'),P=require('../routes/promotion.js');
const sha=t=>createHash('sha256').update(t).digest('hex'),UID='4f2c9a10-1111-4222-8333-444455556666';
const ANSWER='MODE: A\nApproval required before remediate.sh runs.\n\n```sh file=remediate.sh\n: > /run/pressure/stop\n```\n\n```sh file=verify.sh\ntest -f /run/pressure/stop\n```\n\n```md file=rollback.md\nStart a new episode instead of reverting.\n```\n\n```md file=verify.md\nRequire a resolved alert and a flat counter.\n```\n';
async function setup(f,owner='alice'){
 const pool=f.caller(owner),source=loadExperience().sourceDefinition({name:'Git lab',source:'urn:triagenorth:test:'+randomUUID(),environment:'local-lab'});
 const pod={provider:'kubernetes',scope:'cluster-uid',kind:'pod',nativeId:UID,name:'cpu-pressure-abc',health:'degraded',properties:{namespace:'operations-demo'}};
 await saveScan(pool,owner,source,{scanId:'scan-'+randomUUID(),collectionId:'cluster-uid/operations-demo',observedAt:'2026-01-01T00:00:01.000Z',complete:true,assets:[pod],relationships:[]});
 const current={id:randomUUID(),ticketType:'intelligent-operations',status:'awaiting_approval',revision:4},ctx={pool,ticketService:{async getTicket(id){return id===current.id?{...current}:null;}}};
 const plan=await X.preparePlan(ctx,owner,{ticketId:current.id,workId:randomUUID(),phase:'revise',answer:ANSWER,target:{namespace:'operations-demo',pod:'cpu-pressure-abc',uid:UID,container:'pressure'}});
 return {pool,ctx,current,plan};
}
const github={provider:'github',account:'primary',owner:'acme',repo:'ops',baseBranch:'main',folder:'ops/triagenorth',workflow:'apply.yml',runPipeline:true};
test('reservations carry the server-held bytes and manifest once per plan, path and destination; break-glass waits for an execution',async()=>{
 const f=await fixture();try{const x=await setup(f);
  const res=await P.reservePromotion(x.pool,'alice',{planId:x.plan.id,kind:'standard',target:github});assert.equal(res.state,'reserved-outcome-unknown');assert.equal(res.branch,'triagenorth-'+x.plan.id.slice(0,12));
  const files=res.request.files;assert.deepEqual(files.map(f=>f.path),['ops/triagenorth/remediate.sh','ops/triagenorth/rollback.md','ops/triagenorth/verify.md','ops/triagenorth/verify.sh','ops/triagenorth/manifest.json']);
  assert.equal(files[0].content,': > /run/pressure/stop\n');assert.equal(files[0].sha256,sha(files[0].content));const manifest=JSON.parse(files[4].content);assert.equal(manifest.planId,x.plan.id);assert.equal(manifest.ticketRevision,4);assert.equal(manifest.execution,null);assert.match(res.request.body,/Nothing was executed on the cluster/);
  const again=await P.reservePromotion(x.pool,'alice',{planId:x.plan.id,kind:'standard',target:github});assert.equal(again.retry,true);assert.equal(again.id,res.id);assert.equal(again.request,undefined,'a retry never re-issues the write request');
  await assert.rejects(P.reservePromotion(x.pool,'alice',{planId:x.plan.id,kind:'break-glass-reconciliation',target:github}),{status:409});
  for(const bad of [{...github,provider:'bitbucket'},{...github,repo:'../x'},{...github,folder:'../etc'},{...github,baseBranch:'fix/one'},{...github,workflow:'apply.sh'},{...github,token:'x'},{provider:'gitlab',account:'primary',projectId:'abc',baseBranch:'main',folder:'ops'}])await assert.rejects(P.reservePromotion(x.pool,'alice',{planId:x.plan.id,kind:'standard',target:bad}),{status:400});
  const approval=await X.approvePlan(x.ctx,'alice',{planId:x.plan.id}),execution=await X.reserveExecution(x.ctx,'alice',{approvalId:approval.id,account:'primary'});await X.reportExecution(x.ctx,'alice',{executionId:execution.id,result:{outcome:'completed',exitCode:0,target:{observedUid:UID}}});
  const glass=await P.reservePromotion(x.pool,'alice',{planId:x.plan.id,kind:'break-glass-reconciliation',target:{...github,runPipeline:false}});assert.equal(glass.branch,'triagenorth-reconcile-'+x.plan.id.slice(0,12));assert.ok(Math.abs(Date.parse(glass.deadline)-Date.now()-24*3600000)<120000);assert.equal(JSON.parse(glass.request.files.at(-1).content).execution.state,'completed');assert.match(glass.request.body,/must be merged/);
  await assert.rejects(P.reportPromotion(x.pool,'alice',{promotionId:res.id,outcome:'opened',requestUrl:'https://evil.example/acme/ops/pull/1'}),{status:400});
  const opened=await P.reportPromotion(x.pool,'alice',{promotionId:res.id,outcome:'pipeline-started',commitSha:'c0ffee',requestNumber:7,requestUrl:'https://github.com/acme/ops/pull/7',pipelineStatus:'dispatched'});assert.equal(opened.verifiedByServer,false);assert.equal(opened.requestNumber,7);
  const merged=await P.reportPromotion(x.pool,'alice',{promotionId:res.id,outcome:'merged',merged:true,pipelineStatus:'success'});assert.equal(merged.state,'merged');assert.equal(merged.requestUrl,'https://github.com/acme/ops/pull/7','status reports keep earlier facts');
  await f.inspect.query("UPDATE operations_git_promotions SET record=jsonb_set(record,'{deadline}',to_jsonb('2000-01-01T00:00:00.000Z'::text)) WHERE id=$1",[glass.id]);const page=await X.responseRecords(x.ctx,'alice');const row=page.items[0].promotions.find(r=>r.id===glass.id);assert.equal(row.overdue,true);
  const bob=f.caller('bob');await assert.rejects(P.reservePromotion(bob,'bob',{planId:x.plan.id,kind:'standard',target:github}),{status:404});await assert.rejects(P.reportPromotion(bob,'bob',{promotionId:res.id,outcome:'merged'}),{status:404});assert.equal((await P.promotionRecords(bob,'bob')).length,0);
 }finally{await f.close();}
});
test('the shipped panel commits the exact files, opens the pull request and dispatches the workflow with one confirmation per write',async()=>{
 const f=await fixture(),express=dependency('express'),{chromium}=dependency('playwright');let browser,server;
 try{const x=await setup(f),app=express(),proofs=new Set(),effects=[];app.use(express.json({limit:'2mb'}));
  app.get('/api/tickets',(_req,res)=>res.json({tickets:[x.current]}));app.get('/tickets/:id/work',(_req,res)=>res.json({work:[]}));
  app.get('/connectors',(_req,res)=>res.json({connections:[{connector:'github',account:'primary',shared:false,status:'connected'}],httpServices:[{connector:'github',configured:true,capabilityLinked:true,namedAccountSelection:true}]}));
  app.post('/confirmations',(_req,res)=>{const id=randomUUID();proofs.add(id);res.json({confirmation:id});});
  app.post('/connectors/github/actions/:op',(req,res)=>{assert.ok(proofs.delete(req.headers['x-oshal-confirm']),'fresh confirmation per action');assert.equal(req.query.account,'primary');effects.push({op:req.params.op,body:req.body});const op=req.params.op,ok=data=>res.json({status:op==='github-dispatch-workflow'?204:op.startsWith('github-create')?201:200,data,transport:'native_connector_http',operation:op});
   if(op==='github-get-branch')return ok({commit:{sha:'base-sha',commit:{tree:{sha:'base-tree'}}}});if(op==='github-create-tree')return ok({sha:'tree-sha'});if(op==='github-create-commit')return ok({sha:'commit-sha'});if(op==='github-create-ref')return ok({ref:req.body.ref});if(op==='github-create-pull')return ok({number:12,html_url:'https://github.com/acme/ops/pull/12'});if(op==='github-dispatch-workflow')return ok(null);res.status(404).end();});
  app.use((req,_res,next)=>{req.oidc={user:{sub:'alice'}};next();});app.use('/api/intelligent-operations',loadExperience().createOperationsExperienceRoutes({...x.ctx,appPackageDir:root,authorization:{registerResource(){}},store:{query:async()=>[],put:async()=>{}}}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage({viewport:{width:1280,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app#incidents');await page.getByText('Records refreshed',{exact:false}).waitFor();await page.getByRole('button',{name:'Refresh response plans',exact:true}).click();await page.locator('#response-plans .card').first().waitFor();
  const panel=page.locator('.git-promotion').first();await panel.locator('summary').click();await panel.getByLabel('Owner',{exact:true}).fill('acme');await panel.getByLabel('Repository',{exact:true}).fill('ops');await panel.getByLabel('GitHub workflow').fill('apply.yml');await panel.getByLabel('Start the pipeline on the new branch').check();
  assert.equal(await panel.getByRole('button',{name:'Reconcile break-glass change in Git'}).count(),0,'break-glass reconciliation appears only after an execution');
  assert.deepEqual(await panel.locator('label',{hasText:/^Provider/}).locator('select option').allInnerTexts(),['GitHub'],'only configured providers are offered');
  await panel.getByRole('button',{name:/Commit, open request/}).click();await page.locator('.git-promotion h5').first().waitFor();
  assert.deepEqual(effects.map(e=>e.op),['github-get-branch','github-create-tree','github-create-commit','github-create-ref','github-create-pull','github-dispatch-workflow']);
  const tree=effects[1].body.tree;assert.equal(effects[1].body.baseTree,'base-tree');assert.deepEqual(tree.find(t=>t.path.endsWith('remediate.sh')),{path:'ops/triagenorth/'+x.plan.id.slice(0,12)+'/remediate.sh',mode:'100755',type:'blob',content:': > /run/pressure/stop\n'});assert.ok(tree.some(t=>t.path.endsWith('manifest.json')));
  assert.deepEqual(effects[2].body.parents,['base-sha']);assert.equal(effects[3].body.ref,'refs/heads/triagenorth-'+x.plan.id.slice(0,12));assert.equal(effects[4].body.head,'triagenorth-'+x.plan.id.slice(0,12));assert.equal(effects[4].body.base,'main');assert.equal(effects[5].body.workflow,'apply.yml');
  const saved=(await P.promotionRecords(x.pool,'alice'))[0];assert.equal(saved.state,'pipeline-started');assert.equal(saved.requestUrl,'https://github.com/acme/ops/pull/12');assert.equal(saved.commitSha,'commit-sha');
  await panel.getByRole('button',{name:/Commit, open request/}).click();await page.getByText('already has that promotion',{exact:false}).waitFor();assert.equal(effects.filter(e=>e.op==='github-create-ref').length,1,'no second branch');assert.deepEqual(errors,[]);
 }finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await f.close();}
});
