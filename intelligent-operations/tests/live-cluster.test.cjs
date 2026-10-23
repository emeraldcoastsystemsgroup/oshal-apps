/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Open the panel before the graph arrives, so the cluster list must fill when it does (the race the parallel gate exposed). */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the live cluster explorer: kernel-shaped list reads become a scan the topology validator accepts, in its own live collection, trimmed to the 64 KiB budget and partial when cut; the shipped Systems panel reads through three confirmed connector actions, saves a live scan that keeps the collector's services and routes, and clears on refusal. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,loadExperience,dependency,root}=require('./fixtures/intake.cjs'),{scan}=require('../experience/live-cluster.js'),{scanDefinition}=require('../routes/topology-model.js'),{saveScan,readGraph}=require('../routes/topology-store.js');
const AT='2026-10-22T21:03:11.123456789+00:00';
// Row shapes exactly as crates/oshald/src/kubernetes/list.rs returns them.
const node=(i,extra={})=>({uid:'node-uid-'+i,name:'worker-'+i,ready:'True',pressure:[],unschedulable:false,roles:i?[]:['control-plane'],taints:0,internalIp:'10.0.0.'+i,capacity:{cpu:'20',memory:'127598544Ki',pods:'110'},allocatable:{cpu:'20',memory:'127598544Ki',pods:'110'},kubelet:'v1.37.0',os:'Debian',runtime:'containerd://2.1',architecture:'arm64',providerId:'kind://docker/lab/worker-'+i,...extra});
const pod=(i,nodeName)=>({uid:'pod-uid-'+i,name:'api-'+i,namespace:'operations-demo',phase:'Running',node:nodeName,ready:'True',restarts:i%3,owner:'ReplicaSet',ownerName:'api-69f6',created:'2026-10-22T20:25:16Z',containers:[{name:'api',ready:true,restarts:0,waitingReason:null,terminationReason:null}]});
const deployment={uid:'dep-uid-1',name:'api',namespace:'operations-demo',replicas:2,ready:2,available:2,updated:2,generation:23,observedGeneration:23,available_condition:'True',progressing:'True'};
const source={id:'source-1',source:'https://kubernetes.lab.example/clusters/operations-lab',name:'lab',environment:'lab'};
test('live reads become a valid bounded scan in their own collection, partial when trimmed or truncated',()=>{
 const s=scan('cluster-uid','operations-demo',[node(0),node(1,{pressure:['MemoryPressure']}),node(2,{ready:'Unknown'})],[pod(1,'worker-1'),pod(2,'gone-node')],[deployment],AT);
 assert.equal(s.collectionId,'live:cluster-uid/operations-demo');assert.equal(s.complete,true);
 const def=scanDefinition(s,source);assert.equal(def.assets.length,6);
 const byName=Object.fromEntries(def.assets.map(a=>[a.name,a]));assert.equal(byName['worker-1'].health,'degraded');assert.equal(byName['worker-1'].properties.pressure,'MemoryPressure');assert.equal(byName['worker-2'].health,'unknown');assert.equal(byName['worker-0'].properties.roles,'control-plane');assert.equal(byName['worker-0'].properties.allocatableMemory,'127598544Ki');assert.equal(byName['api'].properties.readyReplicas,2);
 assert.equal('pressure' in byName['worker-0'].properties,false,'absent facts are omitted, never fabricated');
 assert.equal(def.relationships.length,1,'a pod on an unread node gets no invented placement');assert.equal(def.relationships[0].type,'RUNS_ON');
 const nodes=Array.from({length:3},(_,i)=>node(i)),many=Array.from({length:400},(_,i)=>pod(i,'worker-'+(i%3))),big=scan('cluster-uid','operations-demo',nodes,many,[deployment],AT);
 assert.equal(big.complete,false);assert.equal(big.failures[0].kind,'scan-budget');assert.ok(Buffer.byteLength(JSON.stringify(big))<=65536);assert.ok(big.assets.length<404);const bigDef=scanDefinition(big,source);assert.equal(bigDef.complete,false);
 const cut=scan('cluster-uid','operations-demo',nodes,[],[],AT,true);assert.equal(cut.complete,false);assert.equal(cut.failures[0].kind,'list-limit');scanDefinition(cut,source);
});
test('the shipped Systems panel reads through three confirmed actions, saves a live scan that keeps collector routes, and clears on refusal',async()=>{
 const f=await fixture(),express=dependency('express'),{chromium}=dependency('playwright');let browser,server;
 try{const pool=f.caller('alice'),app=express(),proofs=new Set(),effects=[];let denied=false;app.use(express.json({limit:'1mb'}));
  const recorded=loadExperience().sourceDefinition({name:'lab',environment:'lab',source:source.source});
  await saveScan(pool,'alice',recorded,{scanId:'collector-1',collectionId:'cluster-uid/operations-demo',observedAt:'2026-10-22T20:00:00.000Z',complete:true,assets:[{provider:'kubernetes',scope:'cluster-uid',kind:'cluster',nativeId:'cluster-uid',name:'operations-lab',health:'healthy'},{provider:'kubernetes',scope:'cluster-uid',kind:'service',nativeId:'svc-uid-1',name:'api',health:'healthy'},{provider:'kubernetes',scope:'cluster-uid',kind:'pod',nativeId:'pod-uid-1',name:'api-1',health:'healthy'}],relationships:[{from:{provider:'kubernetes',scope:'cluster-uid',kind:'service',nativeId:'svc-uid-1'},to:{provider:'kubernetes',scope:'cluster-uid',kind:'pod',nativeId:'pod-uid-1'},type:'ROUTES_TO',evidence:'EndpointSlice targetRef.uid'}]});
  app.use((req,res,next)=>{if(denied)return res.status(403).json({detail:'denied'});req.oidc={user:{sub:'alice'}};next();});
  app.get('/connectors',(_req,res)=>res.json({connections:[{connector:'kubernetes',account:'primary',status:'connected',shared:false},{connector:'kubernetes',account:'team',status:'connected',shared:true},{connector:'github',account:'primary',status:'connected',shared:false}]}));
  app.post('/confirmations',(_req,res)=>{const id=randomUUID();proofs.add(id);res.json({confirmation:id});});
  app.post('/connectors/kubernetes/actions/:op',(req,res)=>{assert.ok(proofs.delete(req.headers['x-oshal-confirm']),'every read carries a fresh confirmation');assert.equal(req.query.account,'primary');effects.push({op:req.params.op,body:req.body});
   const items={'kubernetes-list-nodes':[node(0),node(1)],'kubernetes-list-pods':[pod(1,'worker-1'),pod(2,'worker-0')],'kubernetes-list-deployments':[deployment]}[req.params.op];res.json({transport:'native_kubernetes',operation:req.params.op,observedAt:AT,namespace:req.body.namespace??null,items,truncated:false,limit:500,executionAuthorized:false});});
  const routes=loadExperience().createOperationsExperienceRoutes({pool,appPackageDir:root,authorization:{registerResource(){}},store:{query:async name=>name==='sources'?[recorded]:[],put:async()=>{}}});app.use('/api/intelligent-operations/topology',(req,_res,next)=>{if(req.method==='GET'&&req.path==='/')setTimeout(next,1500);else next();});app.use('/api/intelligent-operations',routes);
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage({viewport:{width:1280,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app#systems');
  // The panel opens before the first graph arrives: its cluster list must fill when the graph does.
  await page.locator('#live-cluster summary').click();await page.getByText('Your Kubernetes connection is selected',{exact:false}).waitFor();
  assert.deepEqual(await page.locator('#live-account option').evaluateAll(o=>o.map(x=>x.value)),['primary'],'only the person\'s own Kubernetes connections are offered');
  await page.waitForFunction(()=>[...document.querySelectorAll('#live-scope option')].some(o=>o.value==='cluster-uid'));
  await page.getByText('Records refreshed',{exact:false}).waitFor();await page.getByRole('button',{name:'Read live cluster',exact:true}).click();await page.getByText('Live read at',{exact:false}).waitFor();
  assert.deepEqual(effects.map(e=>e.op),['kubernetes-list-nodes','kubernetes-list-pods','kubernetes-list-deployments']);assert.deepEqual(effects[0].body,{});assert.deepEqual(effects[1].body,{namespace:'operations-demo'});
  await page.locator('#live-results').getByText('Nodes · 2',{exact:true}).waitFor();await page.locator('#live-results').getByText('127598544Ki',{exact:false}).first().waitFor();await page.locator('#live-results').getByText('Pods in operations-demo · 2',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Save as inventory scan',exact:true}).click();await page.getByText('Saved as a complete live inventory scan',{exact:false}).waitFor();
  const graph=await readGraph(pool,'alice');const live=graph.assets.filter(a=>a.kind==='node');assert.equal(live.length,2);assert.equal(live.find(a=>a.name==='worker-0').properties.allocatableCpu,'20');
  assert.ok(graph.assets.some(a=>a.kind==='service'&&a.name==='api'),'the collector\'s services survive a complete live scan');assert.ok(graph.relationships.some(e=>e.type==='ROUTES_TO'),'the collector\'s routes survive');assert.equal(graph.relationships.filter(e=>e.type==='RUNS_ON').length,2);
  denied=true;await page.getByRole('button',{name:'Read live cluster',exact:true}).click();await page.waitForFunction(()=>document.getElementById('live-results').childElementCount===0);assert.equal(effects.length,3,'a refused session reads nothing');assert.deepEqual(errors,[]);
 }finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await f.close();}
});
