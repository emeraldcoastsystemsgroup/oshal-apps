/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Guard scheduled live discovery: the server scan builder stays identical to the Systems panel's; the setting is validated and revision-checked; the tick reads through kernel connector.read (reads only, the chosen account and namespace) once per interval even with concurrent ticks, saves a live scan that keeps the collector's routes, and records a refused read without retrying it. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,loadExperience}=require('./fixtures/intake.cjs'),{scan}=require('../experience/live-cluster.js');
const {liveScan,discoveryConfig,saveDiscoveryConfig,runDiscovery}=require('../routes/discovery.js'),{saveScan,readGraph}=require('../routes/topology-store.js');
const AT='2026-10-23T03:10:00.123456789+00:00';
// Row shapes exactly as crates/oshald/src/kubernetes/list.rs returns them.
const node=(i,extra={})=>({uid:'node-uid-'+i,name:'worker-'+i,ready:'True',pressure:[],unschedulable:false,roles:i?[]:['control-plane'],internalIp:'10.0.0.'+i,capacity:{cpu:'4',memory:'8Gi',pods:'110'},allocatable:{cpu:'4',memory:'8Gi',pods:'110'},kubelet:'v1.37.0',os:'Debian',runtime:'containerd://2.1',architecture:'amd64',...extra});
const pod=(i,nodeName)=>({uid:'pod-uid-'+i,name:'api-'+i,namespace:'operations-demo',phase:'Running',node:nodeName,ready:'True',restarts:0,owner:'ReplicaSet',ownerName:'api-69f6'});
const deployment={uid:'dep-uid-1',name:'api',namespace:'operations-demo',replicas:2,ready:2,available:2,available_condition:'True'};

test('the server scan builder is the Systems panel builder',()=>{
 const nodes=[node(0),node(1,{pressure:['DiskPressure']}),node(2,{ready:'Unknown'})],pods=[pod(1,'worker-1'),pod(2,'gone')];
 for(const args of [['c','operations-demo',nodes,pods,[deployment],AT],['c','operations-demo',nodes,[],[],AT,true],['c','ns',nodes,Array.from({length:400},(_,i)=>pod(i,'worker-'+(i%3))),[deployment],AT]])
  assert.deepEqual(liveScan(...args),scan(...args));
});

test('the tick reads once per interval through connector.read, saves a live scan and records a refusal',async()=>{
 const f=await fixture();
 try{
  const pool=f.caller('alice'),source=loadExperience().sourceDefinition({name:'lab',environment:'lab',source:'https://kubernetes.lab.example/clusters/operations-lab'}),sources=[source];
  await saveScan(pool,'alice',source,{scanId:'collector-1',collectionId:'cluster-uid/operations-demo',observedAt:'2026-10-23T03:00:00.000Z',complete:true,assets:[{provider:'kubernetes',scope:'cluster-uid',kind:'cluster',nativeId:'cluster-uid',name:'operations-lab',health:'healthy'},{provider:'kubernetes',scope:'cluster-uid',kind:'service',nativeId:'svc-1',name:'api',health:'healthy'},{provider:'kubernetes',scope:'cluster-uid',kind:'workload',nativeId:'wl-1',name:'api',health:'healthy'}],relationships:[{from:{provider:'kubernetes',scope:'cluster-uid',kind:'service',nativeId:'svc-1'},to:{provider:'kubernetes',scope:'cluster-uid',kind:'workload',nativeId:'wl-1'},type:'ROUTES_TO',evidence:'collector'}]});
  const calls=[];let refuse=false;
  const ctx={pool,intent:async(name,input)=>{calls.push({name,input});await new Promise(r=>setTimeout(r,5));if(refuse)throw Error('refused: that connection to kubernetes is not yours to use');
   const items={'kubernetes-list-nodes':[node(0),node(1)],'kubernetes-list-pods':[pod(1,'worker-1'),pod(2,'worker-0')],'kubernetes-list-deployments':[deployment]}[input.operation];
   return {transport:'native_kubernetes',operation:input.operation,observedAt:AT,items,truncated:false,limit:500,executionAuthorized:false};}};
  assert.deepEqual(await runDiscovery(ctx,'alice',sources),{enabled:false},'off until the person turns it on');assert.equal(calls.length,0);

  const good={enabled:true,account:'primary',sourceId:source.id,scope:'cluster-uid',namespace:'operations-demo',intervalMinutes:15,expectedRevision:0},ids=[source.id];
  for(const bad of [{...good,intervalMinutes:1},{...good,namespace:'Not A Label'},{...good,sourceId:'someone-else'},{...good,account:''},{...good,execute:true}])
   await assert.rejects(saveDiscoveryConfig(pool,'alice',bad,ids),e=>e.status===400);
  const saved=await saveDiscoveryConfig(pool,'alice',good,ids);assert.equal(saved.revision,1);
  await assert.rejects(saveDiscoveryConfig(pool,'alice',good,ids),e=>e.status===409,'a stale revision is refused');

  let now=Date.parse('2026-10-23T03:10:00Z');const clock=()=>now;
  const [first,second]=await Promise.all([runDiscovery(ctx,'alice',sources,clock),runDiscovery(ctx,'alice',sources,clock)]);
  const ran=[first,second].filter(r=>r.due);assert.equal(ran.length,1,'concurrent ticks read once');assert.equal(ran[0].state,'saved');assert.equal(ran[0].assets,5);
  assert.deepEqual(calls.map(c=>[c.name,c.input.connector,c.input.operation,c.input.account,c.input.input]),[
   ['connector.read','kubernetes','kubernetes-list-nodes','primary',{}],
   ['connector.read','kubernetes','kubernetes-list-pods','primary',{namespace:'operations-demo'}],
   ['connector.read','kubernetes','kubernetes-list-deployments','primary',{namespace:'operations-demo'}]]);
  const graph=await readGraph(pool,'alice');
  assert.equal(graph.assets.filter(a=>a.kind==='node').length,2);assert.equal(graph.relationships.filter(e=>e.type==='RUNS_ON').length,2);
  assert.ok(graph.relationships.some(e=>e.type==='ROUTES_TO'),'the collector\'s routes survive a scheduled live scan');

  now+=5*60000;assert.equal((await runDiscovery(ctx,'alice',sources,clock)).due,false,'not again within the interval');assert.equal(calls.length,3);
  now+=11*60000;refuse=true;const refused=await runDiscovery(ctx,'alice',sources,clock);
  assert.equal(refused.state,'refused');assert.equal(calls.length,4,'a refused read stops at the first call');
  const after=await discoveryConfig(pool,'alice');assert.equal(after.lastResult.state,'refused');assert.match(after.lastResult.error,/not yours/);
  assert.equal((await runDiscovery(ctx,'alice',sources,clock)).due,false,'a refusal waits for the next interval');

  assert.equal((await runDiscovery({pool},'alice',sources,()=>now+3600000)).available,false,'no kernel read port, no read');
  await saveDiscoveryConfig(pool,'alice',{...good,enabled:false,expectedRevision:1},ids);now+=3600000;
  assert.deepEqual(await runDiscovery(ctx,'alice',sources,clock),{enabled:false});assert.equal(calls.length,4);
  assert.deepEqual(await discoveryConfig(pool,'bob'),{enabled:false,account:'primary',sourceId:null,scope:null,namespace:null,intervalMinutes:15,revision:0},'another person sees only their own setting');
 }finally{await f.close();}
});

test('a forced read happens inside the interval, and a long live history still reconstructs from the latest complete scan',async()=>{
 const f=await fixture();
 try{const pool=f.caller('carol'),source=loadExperience().sourceDefinition({name:'lab',environment:'lab',source:'https://kubernetes.lab.example/clusters/operations-lab'}),sources=[source];
  let reads=0;const ctx={pool,intent:async(_name,input)=>{reads++;return {observedAt:new Date().toISOString(),items:input.operation==='kubernetes-list-nodes'?[node(0)]:[],truncated:false};}};
  await saveDiscoveryConfig(pool,'carol',{enabled:true,account:'primary',sourceId:source.id,scope:'cluster-uid',namespace:'operations-demo',intervalMinutes:60,expectedRevision:0},[source.id]);
  assert.equal((await runDiscovery(ctx,'carol',sources)).state,'saved');assert.equal(reads,3);
  assert.equal((await runDiscovery(ctx,'carol',sources)).due,false,'not due within the interval');
  assert.equal((await runDiscovery(ctx,'carol',sources,Date.now,true)).state,'saved','new alerts force a read');assert.equal(reads,6);
  // 250 complete live scans of one collection: far past the 200-scan budget, still one current graph.
  for(let i=0;i<250;i++)await saveScan(pool,'carol',source,liveScan('cluster-uid','history',[node(i%3)],[],[],new Date(Date.UTC(2026,9,23,0,0,i)).toISOString()));
  const graph=await readGraph(pool,'carol');
  assert.ok(graph.assets.some(a=>a.kind==='node'&&a.name==='worker-'+(249%3)));assert.equal(graph.assets.filter(a=>a.kind==='node'&&a.scope==='cluster-uid'&&a.properties).length>=1,true);
  const earlier=await readGraph(pool,'carol',new Date(Date.UTC(2026,9,23,0,0,10)).toISOString());
  assert.ok(earlier.assets.some(a=>a.name==='worker-'+(10%3)),'as of an earlier time, that time\'s scan');
 }finally{await f.close();}
});
