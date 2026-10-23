/* CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | With no GitHub connection, the promotion panel saves the person's own token through the kernel connect route once and clears it. */
/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Rendering keeps the typed values (the installed acceptance showed the reset). */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Guard provisioning through Git: templates render deterministic, parseable Kubernetes manifests from closed, strictly validated parameters (no :latest, no YAML injection, hardened pods); one request per template and parameters in real SQL, owner-scoped and capped; the provisioning promotion commits exactly those bytes plus a manifest file; the shipped page renders, reviews and promotes a request through the person's own confirmed GitHub connection and applies nothing. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,loadExperience,dependency,root}=require('./fixtures/intake.cjs'),P=require('../routes/provisioning.js'),{reservePromotion}=require('../routes/promotion.js'),{DEFAULTS}=require('../experience/provisioning.js');
const yaml=dependency('js-yaml');
const ns={template:'team-namespace',reason:'New payments team',params:{...DEFAULTS['team-namespace']}},app={template:'app-deployment',reason:'Payments API',params:{...DEFAULTS['app-deployment']}};
const target={provider:'github',account:'primary',owner:'acme',repo:'platform',baseBranch:'main',folder:'provisioning/team-namespace/payments',runPipeline:false};
test('templates render deterministic, parseable and hardened manifests from strictly validated parameters',()=>{
 const a=P.renderProvisioning(structuredClone(ns)),b=P.renderProvisioning(structuredClone(ns));assert.deepEqual(a.files,b.files,'same parameters, same bytes');
 const docs=Object.fromEntries(a.files.map(f=>[f.name,yaml.load(f.content)]));assert.equal(docs['namespace.yaml'].kind,'Namespace');assert.equal(docs['namespace.yaml'].metadata.labels['pod-security.kubernetes.io/enforce'],'baseline');
 assert.equal(docs['resourcequota.yaml'].spec.hard['limits.memory'],'16Gi');assert.equal(docs['rolebinding.yaml'].subjects[0].name,'oidc:payments-devs');assert.deepEqual(docs['networkpolicy.yaml'].spec.policyTypes,['Ingress']);
 const d=yaml.load(P.renderProvisioning(structuredClone(app)).files.find(f=>f.name==='deployment.yaml').content),c=d.spec.template.spec.containers[0];
 assert.equal(d.spec.replicas,2);assert.equal(c.image,'ghcr.io/example/payments-api:1.4.2');assert.equal(c.securityContext.allowPrivilegeEscalation,false);assert.equal(c.securityContext.readOnlyRootFilesystem,true);assert.equal(d.spec.template.spec.securityContext.runAsNonRoot,true);assert.equal(d.spec.template.spec.automountServiceAccountToken,false);
 for(const [base,bad] of [[app,{image:'ghcr.io/example/payments-api:latest'}],[app,{image:'payments-api'}],[ns,{name:'Payments'}],[ns,{name:'a"\nkind: Secret'}],[ns,{editorsGroup:'devs\n- kind: User'}],[ns,{cpuRequests:'4; rm'}],[ns,{pods:5000}],[app,{replicas:0}],[app,{healthPath:'healthz'}],[ns,{extra:'x'}]])
  assert.throws(()=>P.renderProvisioning({...structuredClone(base),params:{...base.params,...bad}}),{status:400},JSON.stringify(bad));
 assert.throws(()=>P.renderProvisioning({template:'cluster-admin',params:{},reason:'x'}),{status:400});assert.throws(()=>P.renderProvisioning({...structuredClone(ns),reason:''}),{status:400});
});
test('one request per template and parameters, owner-scoped; the provisioning promotion commits exactly those bytes and a manifest',async()=>{
 const f=await fixture();try{const pool=f.caller('alice'),saved=await P.saveProvisioning(pool,'alice',structuredClone(ns));assert.equal(saved.files.length,5);assert.equal(saved.executionAuthorized,false);
  assert.equal((await P.saveProvisioning(pool,'alice',structuredClone(ns))).retry,true);
  const res=await reservePromotion(pool,'alice',{planId:saved.id,kind:'provisioning',target});assert.equal(res.branch,'triagenorth-provision-'+saved.id.slice(0,12));
  assert.deepEqual(res.request.files.map(x=>x.path),[...saved.files.map(x=>target.folder+'/'+x.name),target.folder+'/manifest.json']);for(const file of saved.files)assert.equal(res.request.files.find(x=>x.path.endsWith('/'+file.name)).content,file.content);
  const manifest=JSON.parse(res.request.files.at(-1).content);assert.equal(manifest.schema,'triagenorth-provisioning-manifest/1');assert.match(res.request.body,/Nothing was applied to a cluster by the application/);
  assert.equal((await reservePromotion(pool,'alice',{planId:saved.id,kind:'provisioning',target})).retry,true);
  await assert.rejects(reservePromotion(f.caller('bob'),'bob',{planId:saved.id,kind:'provisioning',target}),{status:404},'another person cannot promote alice\'s request');
  assert.equal((await P.provisioningRecords(f.caller('bob'),'bob',[])).items.length,0);
 }finally{await f.close();}
});
test('the shipped page renders, reviews and promotes a provisioning request through the person\'s own confirmed GitHub connection',async()=>{
 const f=await fixture(),express=dependency('express'),{chromium}=dependency('playwright');let browser,server;
 try{const pool=f.caller('alice'),expressApp=express(),proofs=new Set(),effects=[];expressApp.use(express.json({limit:'2mb'}));
  expressApp.get('/connectors',(_req,res)=>res.json({connections:[{connector:'github',account:'primary',shared:false,status:'connected'}],httpServices:[{connector:'github',configured:true,capabilityLinked:true,namedAccountSelection:true}]}));
  expressApp.post('/confirmations',(_req,res)=>{const id=randomUUID();proofs.add(id);res.json({confirmation:id});});
  expressApp.post('/connectors/github/actions/:op',(req,res)=>{assert.ok(proofs.delete(req.headers['x-oshal-confirm']),'fresh confirmation per action');effects.push({op:req.params.op,body:req.body});const op=req.params.op,ok=data=>res.json({status:op.startsWith('github-create')?201:200,data,transport:'native_connector_http',operation:op});
   if(op==='github-get-branch')return ok({commit:{sha:'base-sha',commit:{tree:{sha:'base-tree'}}}});if(op==='github-create-tree')return ok({sha:'tree-sha'});if(op==='github-create-commit')return ok({sha:'commit-sha'});if(op==='github-create-ref')return ok({ref:req.body.ref});if(op==='github-create-pull')return ok({number:7,html_url:'https://github.com/acme/platform/pull/7'});res.status(404).end();});
  expressApp.use((req,_res,next)=>{req.oidc={user:{sub:'alice'}};next();});expressApp.use('/api/intelligent-operations',loadExperience().createOperationsExperienceRoutes({pool,appPackageDir:root,authorization:{registerResource(){}},store:{query:async()=>[],put:async()=>{}}}));
  server=expressApp.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage({viewport:{width:1280,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app#provision');await page.getByText('No provisioning requests yet',{exact:false}).waitFor();
  await page.locator('#provision-team').fill('payments-core');await page.locator('#provision-reason').fill('New payments team namespace');await page.getByRole('button',{name:'Render manifests',exact:true}).click();await page.getByText('Rendered 5 manifests',{exact:false}).waitFor();assert.equal(await page.locator('#provision-team').inputValue(),'payments-core','rendering keeps what the person typed');assert.match(await page.locator('#provision-fields').innerText(),/CPU requests quota/);
  assert.match(await page.locator('#provision-files').innerText(),/resourcequota\.yaml/);assert.match(await page.locator('#provision-files').innerText(),/kubectl apply --dry-run=server -f provisioning\/team-namespace\/payments\//);
  const panel=page.locator('#provision-list .git-promotion').first();await panel.locator('summary').click();await panel.getByLabel('Owner',{exact:true}).fill('acme');await panel.getByLabel('Repository',{exact:true}).fill('platform');
  assert.equal(await panel.getByRole('button',{name:'Reconcile break-glass change in Git'}).count(),0);await panel.getByRole('button',{name:'Commit, open request',exact:true}).click();await page.locator('#provision-list .git-promotion h5').first().waitFor();
  assert.deepEqual(effects.map(e=>e.op),['github-get-branch','github-create-tree','github-create-commit','github-create-ref','github-create-pull']);
  const tree=effects[1].body.tree.map(t=>t.path);assert.ok(tree.includes('provisioning/team-namespace/payments/namespace.yaml'));assert.ok(tree.includes('provisioning/team-namespace/payments/manifest.json'));
  assert.match(await page.locator('#provision-list .git-promotion h5').first().innerText(),/Provisioning request/);assert.deepEqual(errors,[]);
 }finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await f.close();}
});
test('with no GitHub connection the panel saves the person\'s own token once and keeps nothing in the page',async()=>{
 const f=await fixture(),express=dependency('express'),{chromium}=dependency('playwright');let browser,server;
 try{const pool=f.caller('alice'),expressApp=express(),connects=[];let connected=false;expressApp.use(express.json({limit:'1mb'}));
  expressApp.get('/connectors',(_req,res)=>res.json({connections:connected?[{connector:'github',account:'primary',shared:false,status:'connected'}]:[],httpServices:[{connector:'github',configured:true,capabilityLinked:true}]}));
  expressApp.post('/connectors/github/connect',(req,res)=>{connects.push(req.body);connected=true;res.json({status:'connected',connector:'github'});});
  expressApp.use((req,_res,next)=>{req.oidc={user:{sub:'alice'}};next();});expressApp.use('/api/intelligent-operations',loadExperience().createOperationsExperienceRoutes({pool,appPackageDir:root,authorization:{registerResource(){}},store:{query:async()=>[],put:async()=>{}}}));
  await P.saveProvisioning(pool,'alice',structuredClone(ns));
  server=expressApp.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage({viewport:{width:1280,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app#provision');await page.locator('#provision-list .git-promotion').first().waitFor();
  const panel=page.locator('#provision-list .git-promotion').first();await panel.locator('summary').click();
  const token='github_pat_'+'x'.repeat(40);await panel.getByLabel('Your own access token').fill(token);await panel.getByRole('button',{name:'Save as my connection',exact:true}).click();await panel.getByText('Saved as your own GitHub connection',{exact:false}).waitFor();
  assert.deepEqual(connects,[{token}],'the token goes to the kernel connect route once');assert.equal(await panel.getByLabel('Your own access token').inputValue(),'','the field is cleared');
  assert.equal(await panel.locator('label',{hasText:/^Your account/}).locator('select option').count(),1,'the new connection is offered');assert.equal(await panel.locator('.git-connect').isHidden(),true);
  assert.equal(await page.evaluate(t=>JSON.stringify(localStorage)+JSON.stringify(sessionStorage)+document.documentElement.outerHTML,token).then(t=>t.includes(token)),false,'nothing keeps the token');assert.deepEqual(errors,[]);
 }finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await f.close();}
});
