// CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise temporal topology through real SQL, native identities, bounded correlation and Kubernetes loader fixtures.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {fixture,loadExperience,root}=require('./fixtures/intake.cjs');
const {identity,scanDefinition,reconstruct,correlate}=require('../routes/topology-model.js');
const {saveScan,readGraph,correlateDeliveries}=require('../routes/topology-store.js');
const {admit}=require('../routes/intake.js'),{example}=require('../ui/source-contract.js');
const source=loadExperience().sourceDefinition({name:'Topology lab',source:example().source,environment:'local-lab'});
const asset=(kind,nativeId,extra={})=>({provider:'kubernetes',scope:'cluster-uid',kind,nativeId,name:nativeId,health:'healthy',...extra});
const a=asset('pod','pod-a'),b=asset('pod','pod-b'),node=asset('node','node-a');
const edge=(from,to,type='RUNS_ON')=>({from,to,type,evidence:'observed native placement'});
const time=n=>`2026-01-01T00:00:${String(n).padStart(2,'0')}.000Z`;
const scan=(n,assets=[a,b,node],relationships=[edge(a,node),edge(b,node)],extra={})=>({scanId:'scan-'+n,collectionId:'cluster-uid/operations-demo',observedAt:time(n),complete:true,assets,relationships,...extra});
const policy={id:'affected-paths-v1',types:['RUNS_ON'],maxDepth:4,maxVisited:100,maxAgeSeconds:60};
const events=assets=>assets.map(a=>({id:a.nativeId,assetId:identity(a).id}));

test('native scope isolates accounts and replacement UIDs; partial scans preserve observations and full scans retire only their collection',()=>{
 assert.notEqual(identity(a).id,identity({...a,scope:'other-cluster'}).id);
 const replacement={...a,nativeId:'pod-a-replacement'};assert.notEqual(identity(a).id,identity(replacement).id);
 const first=scanDefinition(scan(1),source),partial=scanDefinition(scan(3,[replacement],[],{complete:false,failures:[{kind:'nodes',reason:'read failed'}]}),source);
 const other=scanDefinition(scan(2,[asset('pod','other')],[],{collectionId:'another-namespace'}),source);
 const graph=reconstruct([partial,other,first],time(4));
 assert.equal(graph.assets.length,5);assert.equal(graph.assets.find(x=>x.nativeId==='pod-a').observedAt,time(1));
 const full=scanDefinition(scan(5,[replacement],[]),source),current=reconstruct([first,other,partial,full],time(6));
 assert.deepEqual(current.assets.map(a=>a.nativeId).sort(),['other','pod-a-replacement']);
 assert.equal(reconstruct([full,first,other,partial],time(2)).assets.length,4);
 assert.throws(()=>scanDefinition(scan(1,[],[],{complete:true,failures:[{kind:'pods',reason:'denied'}]}),source),{status:400});
});
test('sharing a healthy hub does not merge alerts; affected dependency paths carry exact edges; stale or incomplete evidence falls back',()=>{
 const graph=reconstruct([scanDefinition(scan(1),source)],time(2));
 const independent=correlate(graph,events([a,b]),policy);assert.equal(independent.groups.length,2);assert.equal(independent.paths.length,0);
 const affected=correlate(graph,events([a,b,node]),policy);assert.equal(affected.groups.length,1);assert.equal(affected.paths.length,2);assert.ok(affected.paths.every(p=>p.edges.length===1));
 const stale=reconstruct([scanDefinition(scan(1),source)],time(10));assert.equal(correlate(stale,events([a,b,node]),{...policy,maxAgeSeconds:1}).method,'exact-asset-fallback');
 const partial=reconstruct([scanDefinition(scan(1),source),scanDefinition(scan(2,[node],[],{complete:false}),source)],time(3));assert.equal(correlate(partial,events([a,node]),policy).status,'degraded');
 const unresolved=reconstruct([scanDefinition(scan(1,[a],[edge(a,node)]),source)],time(2));assert.equal(correlate(unresolved,events([a]),policy).status,'degraded');
 const containment=reconstruct([scanDefinition(scan(1,[a,node],[edge(a,node,'IN_CLUSTER')]),source)],time(2));assert.equal(correlate(containment,events([a,node]),policy).groups.length,2);
 assert.equal(correlate(graph,events([a,b,node]),{...policy,maxVisited:1}).status,'degraded');
 const cycle=reconstruct([scanDefinition(scan(1,[a,b],[edge(a,b),edge(b,a)]),source)],time(2));assert.equal(correlate(cycle,events([a,b]),policy).status,'complete');
});
test('scan retries across independent SQL pools persist once; timestamp/content conflicts fail and owner policies isolate scans',async()=>{
 const f=await fixture();try{
  const pools=[f.caller('alice'),f.caller('alice')],input=scan(1);
  const replies=await Promise.all(Array.from({length:20},(_,i)=>saveScan(pools[i%2],'alice',source,{...input,assets:i%2?input.assets:input.assets.slice().reverse()})));
  assert.equal(replies.filter(r=>r.status===201).length,1);assert.equal(replies.filter(r=>r.retry).length,19);
  await assert.rejects(saveScan(pools[0],'alice',source,scan(1,[] ,[])),{status:409});
  await assert.rejects(saveScan(pools[0],'alice',source,{...input,scanId:'different'}),{status:409});
  await saveScan(pools[0],'alice',source,scan(3,[b],[]));await saveScan(pools[1],'alice',source,scan(2,[a],[]));
  assert.equal((await readGraph(f.caller('alice'),'alice',time(2))).assets[0].nativeId,'pod-a');
  assert.equal((await readGraph(pools[0],'alice',time(4))).assets[0].nativeId,'pod-b');
  const bob=f.caller('bob');assert.equal((await bob.query('SELECT * FROM operations_topology_scans')).rows.length,0);
  await assert.rejects(saveScan(bob,'alice',source,scan(4)),/row-level security/);
  assert.equal((await readGraph(bob,'bob',time(5))).assets.length,0);
 }finally{await f.close();}
});
test('correlation uses owned recorded occurrences and persists reproducible graph and policy evidence without dispatch',async()=>{
 const f=await fixture();try{
  const p=f.caller('alice');await saveScan(p,'alice',source,scan(1));
  const deliveries=[];for(const item of [a,b]){const event=example();event.id=item.nativeId;event.data.resource={kind:'kubernetes-pod',scope:item.scope,id:item.nativeId};deliveries.push((await admit(p,'alice',source,event)).record.id);}
  const request={deliveryIds:deliveries,asOf:time(2),policy};const result=await correlateDeliveries(p,'alice',request);
  assert.equal(result.groups.length,2);assert.equal(result.automaticDispatch,false);assert.equal(result.scanIds.length,1);
  const again=await correlateDeliveries(f.caller('alice'),'alice',{...request,deliveryIds:deliveries.slice().reverse()});assert.equal(again.id,result.id);assert.equal(again.retry,true);
  assert.equal((await f.caller('bob').query('SELECT * FROM operations_topology_decisions')).rows.length,0);
  await assert.rejects(correlateDeliveries(f.caller('bob'),'bob',request),{status:404});
  const count=(await f.inspect.query('SELECT count(*)::int AS n FROM operations_topology_decisions')).rows[0].n;assert.equal(count,1);
 }finally{await f.close();}
});
test('lost scan commit acknowledgement reconciles safely; failed insertion rolls back',async()=>{
 const f=await fixture();try{
  const failed=f.caller('alice',(phase,q)=>{if(phase==='after'&&q.startsWith('INSERT INTO operations_topology_scans'))throw Error('storage fault');});
  await assert.rejects(saveScan(failed,'alice',source,scan(1)),/storage fault/);assert.equal((await readGraph(f.caller('alice'),'alice',time(2))).assets.length,0);
  const lost=f.caller('alice',(phase,q)=>{if(phase==='after'&&q==='COMMIT')throw Error('lost acknowledgement');});
  await assert.rejects(saveScan(lost,'alice',source,scan(1)),/lost acknowledgement/);
  assert.equal((await saveScan(f.caller('alice'),'alice',source,scan(1))).retry,true);
 }finally{await f.close();}
});
test('Kubernetes translation preserves owner UID chains, runtime instance IDs and endpoint readiness without carrying secrets',()=>{
 const run=spawnSync('python3',['-'],{cwd:root+'/lab',encoding:'utf8',input:`import json, topology
ns='operations-demo'
def obj(kind,name,uid,**kw):
 return {'kind':kind,'metadata':{'name':name,'uid':uid,**({} if kind in ['Namespace','Node'] else {'namespace':ns})},**kw}
namespace=obj('Namespace',ns,'ns-uid');node=obj('Node','worker','node-uid');rs=obj('ReplicaSet','different-name','rs-uid')
pod=obj('Pod','api-123-456','pod-uid',spec={'nodeName':'worker','containers':[{'env':[{'name':'PASSWORD','value':'DO-NOT-COPY'}]}]},status={'containerStatuses':[{'name':'api','containerID':'containerd://one','ready':False}]})
pod['metadata'].update({'labels':{'app':'api'},'ownerReferences':[{'kind':'ReplicaSet','name':'not-a-name-guess','uid':'rs-uid'}]})
service=obj('Service','api','service-uid',spec={'selector':{'app':'api'}})
slice=obj('EndpointSlice','api-x','slice-uid',endpoints=[{'targetRef':{'kind':'Pod','namespace':ns,'uid':'pod-uid'},'conditions':{'ready':False}}]);slice['metadata']['labels']={'kubernetes.io/service-name':'api'}
objects=[namespace,node,rs,pod,service,slice]
scan=topology.normalize('cluster',ns,objects,observed_at='2026-01-01T00:00:01Z')
assert scan['complete'];assert 'DO-NOT-COPY' not in json.dumps(scan)
assert any(e['type']=='OWNED_BY' and e['to']['nativeId']=='rs-uid' for e in scan['relationships'])
assert any(e['type']=='ROUTES_TO' and e['properties']['ready']==False for e in scan['relationships'])
assert any(a['nativeId']=='containerd://one' for a in scan['assets'])
pod['metadata']['uid']='new-pod';pod['status']['containerStatuses'][0]['containerID']='containerd://two'
new=topology.normalize('cluster',ns,objects,failures=[{'kind':'nodes','reason':'denied'}]);assert not new['complete']
assert not any(a['nativeId']=='pod-uid' or a['nativeId']=='containerd://one' for a in new['assets'])
print(json.dumps(scan))
`});assert.equal(run.status,0,run.stderr);assert.ok(scanDefinition(JSON.parse(run.stdout),source));
});
test('the real Estate graph and Data correlation use saved SQL observations and remain usable on narrow screens',async()=>{
 const {dependency}=require('./fixtures/intake.cjs'),express=dependency('express'),{chromium}=dependency('playwright');
 const f=await fixture(),app=express(),collections=new Map();let server,browser;
 try{
  app.use((req,_res,next)=>{req.oidc={user:{sub:'alice'}};next();});
  app.use('/api/intelligent-operations',loadExperience().createOperationsExperienceRoutes({appPackageDir:root,pool:f.caller('alice'),authorization:{registerResource(){}},store:{query:async name=>[...(collections.get(name)||new Map()).values()],put:async(name,id,value)=>{if(!collections.has(name))collections.set(name,new Map());collections.get(name).set(id,value);}}}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
  const post=async(path,body)=>{const r=await fetch(base+'/api/intelligent-operations'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.ok,true,await r.clone().text());return r.json();};
  const saved=await post('/sources',{name:source.name,source:source.source,environment:source.environment});
  await post('/topology/scans',{sourceId:saved.id,scan:scan(1)});
  for(const item of [a,b]){const event=example();event.id=item.nativeId;event.data.resource={kind:'kubernetes-pod',scope:item.scope,id:item.nativeId};await post('/events',{sourceId:saved.id,event});}
  browser=await chromium.launch({headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/api/intelligent-operations/app#estate');await page.getByText('Records refreshed',{exact:false}).waitFor();
  await page.locator('#graph-at').fill(time(2));await page.getByRole('button',{name:'Load graph',exact:true}).click();
  await page.getByText('3 assets · 2 relationships',{exact:false}).waitFor();assert.equal(await page.locator('svg.topology-diagram').count(),1);
  assert.equal(await page.locator('.inventory-node').count(),3);
  await page.locator('#graph-search').fill('node-a');assert.equal(await page.locator('.inventory-node').count(),1);
  await page.getByRole('button',{name:'Explore node node-a',exact:true}).press('Enter');
  await page.locator('#graph-search').fill('');
  assert.match(await page.locator('#graph-detail').innerText(),/node-a/);
  // Shared portal themes override the default dark palette; labels and arrows must remain visible in both.
  for(const [fg,bg] of [['#182239','#ffffff'],['#e7edf5','#172231']]){
   await page.addStyleTag({content:':root{--text-primary:'+fg+';--bg-card:'+bg+'}'});
   const colors=await page.evaluate(()=>[getComputedStyle(document.querySelector('.topology-diagram')).color,getComputedStyle(document.querySelector('.graph-box')).fill]);
   const luminance=color=>{const rgb=color.match(/\d+/g).slice(0,3).map(n=>Number(n)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
   const levels=colors.map(luminance).sort((a,b)=>a-b);assert.ok((levels[1]+.05)/(levels[0]+.05)>=4.5,'Graph text must retain accessible contrast in the portal theme.');
  }
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await page.getByRole('link',{name:'Data pipeline',exact:true}).click();await page.getByRole('tab',{name:'Events',exact:true}).click();for(const check of await page.locator('#event-list input[type=checkbox]').all())await check.check();
  await page.getByRole('tab',{name:'Correlation',exact:true}).click();await page.getByRole('button',{name:'Correlate selected events',exact:true}).click();await page.getByText('2 groups · complete',{exact:false}).waitFor();
  assert.deepEqual(errors,[]);assert.equal((await f.inspect.query('SELECT count(*)::int AS n FROM operations_topology_decisions')).rows[0].n,1);
 }finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await f.close();}
});

test('Kubernetes collector preserves actual phase, readiness and failure reasons without exporting environment credentials',()=>{
 const run=spawnSync('python3',['-c',`
import sys,json
sys.path.insert(0,${JSON.stringify(pathForLab())})
import topology
pod={'kind':'Pod','metadata':{'uid':'pod-uid','name':'api','namespace':'operations-demo'},'spec':{'nodeName':'worker','containers':[{'name':'api','env':[{'name':'SECRET','value':'do-not-export'}]}]},'status':{'phase':'Running','conditions':[{'type':'Ready','status':'False','reason':'ContainersNotReady'}],'containerStatuses':[{'name':'api','containerID':'containerd://one','ready':False,'restartCount':4,'image':'api@sha256:abc','state':{'waiting':{'reason':'CrashLoopBackOff'}},'lastState':{'terminated':{'reason':'OOMKilled','exitCode':137}}}]}}
scan=topology.normalize('cluster-uid','operations-demo',[pod],observed_at='2026-10-21T14:00:00Z')
p=next(a for a in scan['assets'] if a['kind']=='pod');c=next(a for a in scan['assets'] if a['kind']=='container')
assert p['health']=='degraded' and p['properties']['phase']=='Running' and p['properties']['readyStatus']=='False'
assert c['properties']['waitingReason']=='CrashLoopBackOff' and c['properties']['lastTerminationReason']=='OOMKilled' and c['properties']['exitCode']==137
assert 'do-not-export' not in json.dumps(scan) and 'env' not in c['properties']
print('Captured measured status only')
`],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
});
function pathForLab(){return require('node:path').join(root,'lab');}
