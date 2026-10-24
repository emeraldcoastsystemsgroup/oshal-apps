/* CHANGE LOG: 7 | maintainer@emeraldcoastsystemsgroup.com | A GitHub token pasted for GitLab is refused before saving and the field is cleared. */
/* CHANGE LOG: 6 | maintainer@emeraldcoastsystemsgroup.com | A GitLab connection browses projects through GitLab reads only: merge requests, pipelines and files. */
/* CHANGE LOG: 5 | maintainer@emeraldcoastsystemsgroup.com | The compact explorer: files open first in a folder tree with a named viewer; pull requests, pipelines and the cluster link are tabs. */
/* CHANGE LOG: 4 | maintainer@emeraldcoastsystemsgroup.com | The token field stays visible whenever GitHub is set up, a saved token is checked with GitHub at once (the login is named), and the repository filter refuses browser autofill. */
/* CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | A rejected token (401) is named plainly and can be replaced in place. */
/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | The explorer saves the person's own token when they have no connection. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the Git explorer: repository links are closed, one per cluster per person and owner-scoped in real SQL; blobs decode to text only when they are text; the shipped page lists repositories, opens one (branches, pull requests, runs, files, a file read-only) through confirmed reads, links it to a recorded cluster, and the promotion panel offers that link and fills its target. Nothing is written to GitHub. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,loadExperience,dependency,root}=require('./fixtures/intake.cjs'),L=require('../routes/repo-links.js'),{blobText}=require('../experience/git-explorer.js'),P=require('../routes/provisioning.js'),{DEFAULTS}=require('../experience/provisioning.js');
const link={clusterScope:'cluster-uid-a',clusterName:'prod-east',owner:'acme',repo:'gitops-prod-east',baseBranch:'main',folder:'clusters/prod-east',workflow:'apply.yml'};
test('repository links are closed, one per cluster per person and owner-scoped',async()=>{
 for(const bad of [{...link,owner:'a b'},{...link,folder:'../x'},{...link,workflow:'run.sh'},{...link,extra:1},{...link,clusterScope:''}])assert.throws(()=>L.repoLink(bad),{status:400});
 const f=await fixture();try{const pool=f.caller('alice');const a=await L.saveRepoLink(pool,'alice',link);assert.equal(a.replaced,false);const b=await L.saveRepoLink(pool,'alice',{...link,repo:'gitops-east-v2'});assert.equal(b.replaced,true);
  const mine=await L.repoLinks(pool,'alice');assert.equal(mine.items.length,1);assert.equal(mine.items[0].repo,'gitops-east-v2');assert.equal((await L.repoLinks(f.caller('bob'),'bob')).items.length,0);
  await assert.rejects(L.removeRepoLink(f.caller('bob'),'bob',{id:a.id}),{status:404});assert.deepEqual(await L.removeRepoLink(pool,'alice',{id:a.id}),{removed:a.id});
 }finally{await f.close();}
});
test('a pasted token is matched to its service by prefix only',()=>{const {tokenProvider}=require('../experience/git-explorer.js');assert.deepEqual(['github_pat_x','ghp_x','glpat-x','gldt-x','abc'].map(tokenProvider),['github','github','gitlab','gitlab',null]);});
test('blobs decode to text only when they are readable text',()=>{
 assert.equal(blobText({encoding:'base64',content:Buffer.from('kind: Namespace\n').toString('base64'),size:16}),'kind: Namespace\n');
 assert.equal(blobText({encoding:'base64',content:Buffer.from([0,1,2,255]).toString('base64'),size:4}),null);
 assert.equal(blobText({encoding:'base64',content:'',size:300000}),null);
 assert.equal(blobText({encoding:'utf-8',content:'kind: Namespace\n# token [redacted]\n',size:36}),'kind: Namespace\n# token [redacted]\n','the kernel\'s decoded text is read as is');assert.equal(blobText({encoding:'utf-8',content:'a\u0000b'}),null);
});
test('the shipped explorer browses a repository read-only, links it to a cluster, and promotion offers the link',async()=>{
 const f=await fixture(),express=dependency('express'),{chromium}=dependency('playwright');let browser,server;
 try{const pool=f.caller('alice'),app=express(),proofs=new Set(),reads=[];app.use(express.json({limit:'2mb'}));
  app.get('/connectors',(_req,res)=>res.json({connections:[{connector:'github',account:'primary',shared:false,status:'connected'}],httpServices:[{connector:'github',configured:true,capabilityLinked:true}]}));
  app.post('/confirmations',(_req,res)=>{const id=randomUUID();proofs.add(id);res.json({confirmation:id});});
  const tree=[{path:'clusters/prod-east/namespace.yaml',type:'blob',sha:'b'.repeat(40)},{path:'README.md',type:'blob',sha:'c'.repeat(40)}];
  app.post('/connectors/github/actions/:op',(req,res)=>{assert.ok(proofs.delete(req.headers['x-oshal-confirm']),'a fresh confirmation per read');reads.push(req.params.op);const ok=data=>res.json({status:200,data,transport:'native_connector_http',operation:req.params.op});
   switch(req.params.op){case 'github-list-repos':return ok([{full_name:'acme/gitops-prod-east',private:true,default_branch:'main',html_url:'https://github.com/acme/gitops-prod-east'},{full_name:'acme/web',private:false,default_branch:'main',html_url:'https://github.com/acme/web'}]);
    case 'github-list-branches':return ok([{name:'main',commit:{sha:'a'.repeat(40)},protected:true}]);case 'github-list-pulls':return ok([{number:7,title:'Provision payments',head:{ref:'triagenorth-provision-1'},user:{login:'roger'},updated_at:'2026-10-23T01:00:00Z',html_url:'https://github.com/acme/gitops-prod-east/pull/7'}]);
    case 'github-list-repo-runs':return ok({workflow_runs:[{name:'validate',head_branch:'triagenorth-provision-1',status:'completed',conclusion:'success',created_at:'2026-10-23T01:01:00Z',html_url:'https://github.com/acme/gitops-prod-east/actions/runs/1'}]});
    case 'github-get-branch':return ok({commit:{sha:'a'.repeat(40),commit:{tree:{sha:'d'.repeat(40)}}}});case 'github-get-tree':return ok({tree,truncated:false});
    case 'github-get-blob':return ok({encoding:'base64',content:Buffer.from('apiVersion: v1\nkind: Namespace\n').toString('base64'),size:31});default:return res.status(404).json({detail:'not a read'});}});
  app.use((req,_res,next)=>{req.oidc={user:{sub:'alice'}};next();});
  const routes=loadExperience().createOperationsExperienceRoutes({pool,appPackageDir:root,authorization:{registerResource(){}},store:{query:async()=>[],put:async()=>{}}});
  app.use('/api/intelligent-operations',(req,res,next)=>{if(req.path==='/topology')return res.json({assets:[{id:'c1',provider:'kubernetes',scope:'cluster-uid-a',kind:'cluster',nativeId:'cluster-uid-a',name:'prod-east',health:'healthy',observedAt:'2026-10-23T00:00:00.000Z',properties:{}}],relationships:[],asOf:'2026-10-23T00:00:00.000Z',collections:[],revision:'r',scanIds:[],limits:{scans:200,assets:2000,relationships:5000}});next();},routes);
  await P.saveProvisioning(pool,'alice',{template:'team-namespace',reason:'payments',params:{...DEFAULTS['team-namespace']}});
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage({viewport:{width:1280,height:1200}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const base='http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app';await page.goto(base+'#git');await page.getByText('Load your repositories to browse them',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Load my repositories',exact:true}).click();await page.getByText('2 repositories you can reach',{exact:false}).waitFor();
  await page.locator('#git-filter').fill('gitops');assert.equal(await page.locator('#git-repos .git-repo').count(),1);await page.locator('#git-repos .git-repo').first().click();
  const detail=page.locator('#git-repo-detail');await detail.getByText('Files on main · 2',{exact:false}).waitFor();assert.equal(await detail.getByRole('tab',{name:'Files',exact:true}).getAttribute('aria-selected'),'true','files open first');
  await detail.getByRole('tab',{name:'Pull requests · 1',exact:true}).click();await detail.getByText('Provision payments',{exact:false}).waitFor();await detail.getByRole('tab',{name:'Pipelines · 1',exact:true}).click();assert.match(await detail.locator('.git-pane:not([hidden])').innerText(),/validate[\s\S]*success/);await detail.getByRole('tab',{name:'Files',exact:true}).click();
  await detail.getByRole('button',{name:'clusters/prod-east/namespace.yaml',exact:true}).click();await detail.getByText('kind: Namespace',{exact:false}).waitFor();assert.equal(await detail.locator('.git-crumb').innerText().then(t=>t.includes('clusters / prod-east / namespace.yaml')),true,'the viewer names the file');
  await detail.getByRole('tab',{name:'Cluster link',exact:true}).click();await detail.getByRole('button',{name:'Link this repository to the cluster',exact:true}).click();await page.getByText('Linked prod-east to acme/gitops-prod-east',{exact:false}).waitFor();
  assert.ok(reads.every(op=>op.startsWith('github-list')||op.startsWith('github-get')),'only reads');const saved=(await L.repoLinks(pool,'alice')).items[0];assert.deepEqual([saved.owner,saved.repo,saved.folder,saved.clusterScope],['acme','gitops-prod-east','clusters/gitops-prod-east','cluster-uid-a']);
  await page.goto(base+'#provision');const panel=page.locator('#provision-list .git-promotion').first();await panel.waitFor();await panel.locator('summary').click();
  await panel.getByLabel('Linked repository').selectOption({label:'prod-east → acme/gitops-prod-east'});assert.equal(await panel.getByLabel('Owner',{exact:true}).inputValue(),'acme');assert.equal(await panel.getByLabel('Repository',{exact:true}).inputValue(),'gitops-prod-east');
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await f.close();}
});
test('with no GitHub connection the explorer saves the person\'s own token and then offers it',async()=>{
 const f=await fixture(),express=dependency('express'),{chromium}=dependency('playwright');let browser,server;
 try{const pool=f.caller('alice'),app=express(),connects=[];let connected=false;app.use(express.json({limit:'1mb'}));
  app.get('/connectors',(_req,res)=>res.json({connections:connected?[{connector:'github',account:'primary',shared:false,status:'connected'}]:[],httpServices:[{connector:'github',configured:true}]}));
  app.post('/connectors/github/connect',(req,res)=>{connects.push(req.body);connected=true;res.json({status:'connected'});});
  app.post('/confirmations',(_req,res)=>res.json({confirmation:randomUUID()}));
  app.post('/connectors/github/actions/github-me',(_req,res)=>res.json({status:200,data:{login:'alice-gh'},transport:'native_connector_http'}));
  app.use((req,_res,next)=>{req.oidc={user:{sub:'alice'}};next();});app.use('/api/intelligent-operations',(req,res,next)=>{if(req.path==='/topology')return res.json({assets:[],relationships:[],asOf:'2026-10-23T00:00:00.000Z',collections:[],revision:'r',scanIds:[],limits:{scans:200,assets:2000,relationships:5000}});next();},loadExperience().createOperationsExperienceRoutes({pool,appPackageDir:root,authorization:{registerResource(){}},store:{query:async()=>[],put:async()=>{}}}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app#git');await page.getByText('Save your own GitHub token below',{exact:false}).waitFor();
  assert.equal(await page.locator('#git-filter').getAttribute('autocomplete'),'off','the repository filter refuses browser autofill');
  const token='github_pat_'+'y'.repeat(40);await page.locator('#git-token').fill(token);await page.getByRole('button',{name:'Save as my GitHub connection',exact:true}).click();await page.getByText('Connected to GitHub as alice-gh',{exact:false}).waitFor();
  assert.deepEqual(connects,[{token}]);assert.equal(await page.locator('#git-token').inputValue(),'');assert.equal(await page.locator('#git-connect').isHidden(),false,'the token field stays available');assert.equal(await page.getByRole('button',{name:'Replace my GitHub token',exact:true}).isVisible(),true);assert.equal(await page.getByRole('button',{name:'Load my repositories',exact:true}).isDisabled(),false);assert.deepEqual(errors,[]);
 }finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await f.close();}
});
test('a token GitHub rejects is named plainly and can be replaced in place',async()=>{
 const f=await fixture(),express=dependency('express'),{chromium}=dependency('playwright');let browser,server;
 try{const pool=f.caller('alice'),app=express(),connects=[];let good=false;app.use(express.json({limit:'1mb'}));
  app.get('/connectors',(_req,res)=>res.json({connections:[{connector:'github',account:'primary',shared:false,status:'connected'}],httpServices:[{connector:'github',configured:true}]}));
  app.post('/confirmations',(_req,res)=>res.json({confirmation:randomUUID()}));
  app.post('/connectors/github/actions/:op',(_req,res)=>good?res.json({status:200,data:[{full_name:'acme/gitops',private:true,default_branch:'main'}],transport:'native_connector_http'}):res.status(503).json({detail:'upstream: Connector returned HTTP 401; no automatic retry was attempted',refused:'store_unavailable'}));
  app.post('/connectors/github/connect',(req,res)=>{connects.push(req.body);good=true;res.json({status:'connected'});});
  app.use((req,_res,next)=>{req.oidc={user:{sub:'alice'}};next();});app.use('/api/intelligent-operations',(req,res,next)=>{if(req.path==='/topology')return res.json({assets:[],relationships:[],asOf:'2026-10-23T00:00:00.000Z',collections:[],revision:'r',scanIds:[],limits:{scans:200,assets:2000,relationships:5000}});next();},loadExperience().createOperationsExperienceRoutes({pool,appPackageDir:root,authorization:{registerResource(){}},store:{query:async()=>[],put:async()=>{}}}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app#git');await page.getByText('Load your repositories to browse them',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Replace my GitHub token',exact:true}).isVisible(),true,'a connected person can replace the token before anything fails');
  await page.getByRole('button',{name:'Load my repositories',exact:true}).click();await page.getByText('GitHub rejected your saved token',{exact:false}).waitFor();assert.equal(await page.locator('#git-connect').isHidden(),false);
  await page.locator('#git-token').fill('github_pat_'+'z'.repeat(40));await page.getByRole('button',{name:'Replace my GitHub token',exact:true}).click();await page.getByText('Connected to GitHub as',{exact:false}).waitFor();assert.equal(connects.length,1);
  await page.getByRole('button',{name:'Load my repositories',exact:true}).click();await page.getByText('1 repositories you can reach',{exact:false}).waitFor();assert.deepEqual(errors,[]);
 }finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await f.close();}
});
test('a GitLab connection browses projects the same way: merge requests, pipelines and files through GitLab reads only',async()=>{
 const f=await fixture(),express=dependency('express'),{chromium}=dependency('playwright');let browser,server;
 try{const pool=f.caller('alice'),app=express(),proofs=new Set(),reads=[];app.use(express.json({limit:'1mb'}));
  app.get('/connectors',(_req,res)=>res.json({connections:[{connector:'github',account:'primary',shared:false,status:'connected'},{connector:'gitlab',account:'work',shared:false,status:'connected'}],httpServices:[{connector:'github',configured:true},{connector:'gitlab',configured:true}]}));
  app.post('/confirmations',(_req,res)=>{const id=randomUUID();proofs.add(id);res.json({confirmation:id});});
  app.post('/connectors/github/actions/:op',(_req,res)=>res.status(500).json({detail:'GitHub must not be read'}));
  app.post('/connectors/gitlab/actions/:op',(req,res)=>{assert.ok(proofs.delete(req.headers['x-oshal-confirm']));assert.equal(req.query.account,'work');reads.push(req.params.op);const ok=data=>res.json({status:200,data,transport:'native_connector_http',operation:req.params.op});
   switch(req.params.op){case 'gitlab-list-projects':return ok([{id:42,path_with_namespace:'platform/infra/gitops',visibility:'private',default_branch:'main',web_url:'https://gitlab.com/platform/infra/gitops',last_activity_at:'2026-10-23T01:00:00Z'}]);
    case 'gitlab-list-branches':assert.equal(req.body.projectId,'42');return ok([{name:'main',commit:{id:'c'.repeat(40)},protected:true}]);
    case 'gitlab-list-merge-requests':return ok([{iid:12,title:'Raise checkout memory',source_branch:'raise-mem',author:{username:'roger'},updated_at:'2026-10-23T01:00:00Z',web_url:'https://gitlab.com/x/-/merge_requests/12'}]);
    case 'gitlab-list-project-pipelines':return ok([{id:901,ref:'raise-mem',status:'failed',created_at:'2026-10-23T01:02:00Z',web_url:'https://gitlab.com/x/-/pipelines/901'}]);
    case 'gitlab-list-tree':assert.equal(req.body.ref,'main');return ok([{id:'d'.repeat(40),path:'apps',type:'tree'},{id:'e'.repeat(40),path:'apps/checkout.yaml',type:'blob'}]);
    case 'gitlab-get-blob':assert.equal(req.body.sha,'e'.repeat(40));return ok({encoding:'base64',content:Buffer.from('kind: Deployment\n').toString('base64'),size:17});
    default:return res.status(404).json({detail:'not a read'});}});
  app.use((req,_res,next)=>{req.oidc={user:{sub:'alice'}};next();});app.use('/api/intelligent-operations',(req,res,next)=>{if(req.path==='/topology')return res.json({assets:[],relationships:[],asOf:'2026-10-23T00:00:00.000Z',collections:[],revision:'r',scanIds:[],limits:{scans:200,assets:2000,relationships:5000}});next();},loadExperience().createOperationsExperienceRoutes({pool,appPackageDir:root,authorization:{registerResource(){}},store:{query:async()=>[],put:async()=>{}}}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app#git');await page.getByText('Load your repositories to browse them',{exact:false}).waitFor();
  await page.locator('#git-provider').selectOption('gitlab');await page.waitForFunction(()=>document.getElementById('git-account').value==='work');assert.equal(await page.locator('#git-token-save').innerText(),'Replace my GitLab token');
  await page.locator('#git-token').fill('github_pat_'+'q'.repeat(40));await page.getByRole('button',{name:'Replace my GitLab token',exact:true}).click();await page.getByText('That looks like a GitHub token, so GitLab would refuse it.',{exact:false}).waitFor();assert.equal(await page.locator('#git-token').inputValue(),'','the field is cleared; nothing was saved');
  await page.getByRole('button',{name:'Load my repositories',exact:true}).click();await page.getByText('1 repositories you can reach',{exact:false}).waitFor();
  await page.locator('#git-repos .git-repo').first().click();const detail=page.locator('#git-repo-detail');await detail.getByText('Files on main · 1',{exact:false}).waitFor();
  assert.match(await detail.locator('.git-head').innerText(),/platform\/infra \/\s*gitops[\s\S]*failure · pipeline #901/);assert.equal(await detail.getByRole('link',{name:'Open on GitLab ↗'}).count(),1);
  await detail.getByRole('button',{name:'apps/checkout.yaml',exact:true}).click();await detail.getByText('kind: Deployment',{exact:false}).waitFor();
  await detail.getByRole('tab',{name:'Merge requests · 1',exact:true}).click();await detail.getByText('Raise checkout memory',{exact:false}).waitFor();
  await detail.getByRole('tab',{name:'Cluster link',exact:true}).click();await detail.getByText('Cluster links name a GitHub repository today',{exact:false}).waitFor();
  assert.ok(reads.every(op=>/^gitlab-(list|get)-/.test(op)),'only GitLab reads: '+reads.join(','));assert.deepEqual(errors,[]);
 }finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await f.close();}
});
