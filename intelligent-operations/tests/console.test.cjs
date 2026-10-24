/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | The largest cluster is ranked across recorded Kubernetes, EKS, GKE and AKS clusters by node count; live kubectl still names the connected cluster. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the Ops console: kubectl lines map to exactly one native read (or a staged exec), tables and the computed assessment are deterministic, and in the shipped page a plain-words question is planned, every command is shown and run through the person's own connection with a fresh confirmation, the result is assessed and explained as text (never markup), an exec runs only on the person's click, a refused connection stays in the terminal while a refused identity clears it, and without the analyst a local plan still answers. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,loadExperience,dependency,root}=require('./fixtures/intake.cjs');
const C=require('../experience/console.js');

const NODES=[{uid:'n1',name:'lab-control-plane',ready:true,pressure:[],roles:['control-plane'],allocatable:{cpu:'4',memory:'8Gi',pods:'110'},kubelet:'v1.34.0'},{uid:'n2',name:'lab-worker',ready:true,pressure:['MemoryPressure'],roles:[],allocatable:{cpu:'3500m',memory:'16318704Ki',pods:'110'},kubelet:'v1.34.0'}];
const PODS=[{uid:'p1',name:'web-1',namespace:'demo',phase:'Running',node:'lab-worker',ready:true,restarts:0,containers:[{name:'web',ready:true,restarts:0}]},{uid:'p2',name:'checkout-1',namespace:'demo',phase:'Running',node:'lab-worker',ready:false,restarts:9,containers:[{name:'checkout',ready:false,restarts:9,waitingReason:'CrashLoopBackOff'}]}];

test('kubectl lines map to one native read, an exec is a write, and anything else is refused with a reason',()=>{
 assert.deepEqual(C.parseKubectl(C.splitArgs('kubectl get nodes -o wide')),{kind:'nodes',op:'kubernetes-list-nodes',input:{},write:false});
 assert.equal(C.parseKubectl(C.splitArgs('kubectl get po -A')).all,true);
 assert.equal(C.parseKubectl(C.splitArgs('kubectl get deploy --namespace=demo')).namespace,'demo');
 assert.throws(()=>C.parseKubectl(C.splitArgs('kubectl get pods')),/namespace/);
 assert.deepEqual(C.parseKubectl(C.splitArgs('kubectl logs checkout-1 -n demo --tail 9999 -c checkout')),{kind:'logs',op:'kubernetes-pod-logs',pod:'checkout-1',namespace:'demo',container:'checkout',tail:500,previous:false,write:false});
 const exec=C.parseKubectl(C.splitArgs('kubectl exec -it web-1 -n demo -- sh -c "df -h /"'));assert.equal(exec.write,true);assert.deepEqual(exec.argv,['sh','-c','df -h /']);
 assert.throws(()=>C.parseKubectl(C.splitArgs('kubectl delete pod web-1 -n demo')),/Available here/);
 assert.throws(()=>C.parseKubectl(['aws','s3','ls']),/start with kubectl/);
 assert.throws(()=>C.parseKubectl(C.splitArgs('kubectl get pods -n demo --kubeconfig /x')),/not available/);
 assert.throws(()=>C.splitArgs('kubectl get "pods'),/Unclosed quote/);
});
test('tables print like kubectl and the assessment is computed, not taken from the model',()=>{
 const t=C.table('nodes',NODES);assert.deepEqual(t.head,['NAME','STATUS','ROLES','CPU','MEMORY','PODS','PRESSURE','KUBELET']);assert.deepEqual(t.rows[1].slice(3,7),['3.50 cores','16 GiB','110','MemoryPressure']);assert.deepEqual(t.tone,['good','bad']);
 assert.match(C.plain(t).split('\n')[0],/^NAME\s+STATUS\s+ROLES/);
 const a=C.assess('nodes',NODES);assert.equal(a.verdict,'unhealthy');assert.match(a.headline,/^2 nodes · 2 ready · 7\.5 cores · 23\.6 GiB allocatable$/);assert.deepEqual(a.facts.find(f=>f[0]==='Under pressure'),['Under pressure','lab-worker (MemoryPressure)']);
 const p=C.assess('pods',PODS);assert.equal(p.verdict,'unhealthy');assert.equal(C.table('pods',PODS).rows[1][3],'CrashLoopBackOff');
 assert.equal(C.assess('deployments',[{name:'w',replicas:2,available:2,ready:2}]).verdict,'healthy');
 assert.equal(C.commonPrefix(['operations-lab-control-plane','operations-lab-worker','operations-lab-worker2']),'operations-lab-');assert.equal(C.commonPrefix(['solo']),'');
 assert.deepEqual(C.localPlan('show me all the nodes').map(s=>s.argv.join(' ')),['kubectl get nodes -o wide']);
 assert.equal(C.bytes('1Gi'),1024**3);assert.equal(C.cores('250m'),0.25);
});

async function harness({analyst=true,refuse=null,extra=[]}={}){
 const f=await fixture(),express=dependency('express'),{chromium}=dependency('playwright'),app=express(),proofs=new Set(),calls=[],asks=[];let state={refuse};
 app.use(express.json({limit:'1mb'}));
 app.get('/connectors',(_q,r)=>r.json({connections:[{connector:'kubernetes',account:'primary',shared:false,status:'connected'}],httpServices:[{connector:'kubernetes',configured:true}]}));
 app.post('/confirmations',(_q,r)=>{const id=randomUUID();proofs.add(id);r.json({confirmation:id});});
 app.post('/connectors/kubernetes/actions/:op',(q,r)=>{assert.ok(proofs.delete(q.headers['x-oshal-confirm']),'a fresh confirmation for every native call');assert.equal(q.query.account,'primary');calls.push({op:q.params.op,body:q.body});
  if(state.refuse==='connection')return r.status(403).json({detail:'the connection to kubernetes is expired; reconnect it',refused:'capability_not_granted'});
  if(state.refuse==='identity')return r.status(401).json({detail:'that credential is not known',refused:'no_identity'});
  const base={transport:'native_kubernetes',operation:q.params.op,observedAt:new Date().toISOString()};
  if(q.params.op==='kubernetes-list-nodes')return r.json({...base,items:NODES});if(q.params.op==='kubernetes-list-pods')return r.json({...base,items:PODS.filter(p=>p.namespace===q.body.namespace)});
  if(q.params.op==='kubernetes-exec')return r.json({...base,outcome:'completed',exitCode:0,stdout:'overlay 1.8T 34% /',stderr:''});r.status(404).json({detail:'no'});});
 app.post('/api/swarm/bots/ops-rca-specialist/ask',(q,r)=>{const m=String(q.body.message||'');asks.push(m);if(!analyst)return r.status(503).json({detail:'analyst offline'});
  if(m.includes('console-plan-v1'))return r.json({reply:JSON.stringify({say:'Reading node readiness and sizing.',steps:[{argv:['kubectl','get','nodes','-o','wide'],reason:'nodes'},{argv:['kubectl','delete','node','lab-worker'],reason:'not allowed'}]}),sessionId:'s'});
  return r.json({reply:'',structured:{headline:'2 nodes; lab-worker under MemoryPressure',verdict:'attention',explanation:'- **Sizing:** 7.5 cores in all.\n- <img src=x onerror="window.__owned=1"> stays text',next:[{argv:['kubectl','get','pods','-A'],reason:'what runs there'}]},sessionId:'s'});});
 app.use((q,_r,n)=>{q.oidc={user:{sub:'alice'}};n();});
 const graph={assets:[{id:'c',provider:'kubernetes',scope:'s1',kind:'cluster',nativeId:'s1',name:'lab',health:'healthy',observedAt:'2026-10-23T00:00:00.000Z',properties:{}},{id:'p1',provider:'kubernetes',scope:'s1',kind:'pod',nativeId:'p1',name:'web-1',health:'healthy',observedAt:'2026-10-23T00:00:00.000Z',properties:{namespace:'demo'}},...extra],relationships:[],asOf:'2026-10-23T00:00:00.000Z',collections:[],revision:'r',scanIds:[],limits:{scans:200,assets:2000,relationships:5000}};
 app.use('/api/intelligent-operations',(q,r,n)=>{if(q.path==='/topology')return r.json(graph);n();},loadExperience().createOperationsExperienceRoutes({pool:f.caller('alice'),appPackageDir:root,authorization:{registerResource(){}},store:{query:async()=>[],put:async()=>{}}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const browser=await chromium.launch({headless:true,args:['--disable-gpu']}),page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app#console');await page.locator('#console-tree .console-leaf').first().waitFor();
 return {page,calls,asks,errors,set(v){state.refuse=v;},async close(){await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));await f.close();}};
}

test('a plain-words question is planned, each command shows and runs through the person\'s connection, then is assessed and explained as text',async()=>{
 const h=await harness();try{const {page}=h,out=page.locator('#console-output');
  assert.match(await page.locator('#console-tree').innerText(),/lab[\s\S]*control-plane[\s\S]*worker[\s\S]*demo[\s\S]*checkout-1/,'the tree shows nodes and pods with short names');
  await page.locator('#console-input').fill('show me all the nodes in the largest cluster with their sizing and health');await page.locator('#console-input').press('Enter');
  await out.locator('.console-report').waitFor();const t=await out.innerText();
  assert.match(t,/ops@lab › show me all the nodes/);assert.match(t,/one cluster, lab; it is the largest/);assert.match(t,/\$ kubectl get nodes -o wide/);assert.match(t,/lab-worker\s+Ready\s+<none>\s+3\.50 cores\s+16 GiB\s+110\s+MemoryPressure/);
  assert.match(t,/\$ kubectl delete node lab-worker\nAvailable here/,'a planned step outside the read list is shown and refused, never run');
  assert.match(t,/ATTENTION|attention/i);assert.match(t,/Allocatable CPU\s*7\.5 cores/i);assert.match(t,/<img src=x onerror="window.__owned=1"> stays text/,'model text is never markup');
  assert.equal(await page.evaluate(()=>window.__owned),undefined);assert.equal(await out.locator('.console-report img').count(),0);
  assert.ok(h.asks.some(m=>m.includes('console-plan-v1'))&&h.asks.some(m=>m.includes('console-assess-v1')));assert.ok(h.calls.every(c=>c.op!=='kubernetes-exec'),'a question never executes');
  await out.locator('.console-chip',{hasText:'kubectl get pods -A'}).click();assert.equal(await page.locator('#console-input').inputValue(),'kubectl get pods -A','a follow-up is offered, not run');assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});
test('a typed exec is staged and runs once on the person\'s click; a refused connection stays in the terminal; a refused identity clears it',async()=>{
 const h=await harness();try{const {page}=h,out=page.locator('#console-output');
  await page.locator('#console-input').fill('kubectl exec web-1 -n demo -- df -h /');await page.locator('#console-input').press('Enter');await out.getByRole('button',{name:'Run in pod',exact:true}).waitFor();
  assert.equal(h.calls.filter(c=>c.op==='kubernetes-exec').length,0,'staged, not run');await out.getByRole('button',{name:'Run in pod',exact:true}).click();await out.getByText('exit 0 · completed',{exact:false}).waitFor();
  const exec=h.calls.filter(c=>c.op==='kubernetes-exec');assert.equal(exec.length,1);assert.deepEqual(exec[0].body,{namespace:'demo',pod:'web-1',uid:'p1',container:'web',argv:['df','-h','/']});
  h.set('connection');await page.locator('#console-input').fill('kubectl get nodes');await page.locator('#console-input').press('Enter');await out.getByText('refused (capability_not_granted): the connection to kubernetes is expired',{exact:false}).waitFor();
  assert.ok((await out.innerText()).includes('exit 0 · completed'),'the terminal keeps its history');
  h.set('identity');await page.locator('#console-input').fill('kubectl get nodes');await page.locator('#console-input').press('Enter');await page.waitForFunction(()=>!document.getElementById('console-output').innerText.includes('exit 0'));assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});
test('without the analyst a local plan still runs the read and the computed assessment still reports',async()=>{
 const h=await harness({analyst:false});try{const {page}=h,out=page.locator('#console-output');
  await page.locator('[data-console-ask="Which pods are not healthy or restarting, and why?"]').click();await out.locator('.console-report').waitFor();const t=await out.innerText();
  assert.match(t,/analyst unavailable[\s\S]*planning locally/);assert.match(t,/\$ kubectl get pods -A/);assert.match(t,/checkout-1\s+0\/1\s+CrashLoopBackOff\s+9/);assert.match(t,/unhealthy/i);assert.match(t,/Analyst explanation unavailable/);assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});
test('the largest cluster is ranked across clouds, and live reads still say which cluster they reach',async()=>{
 const eks={id:'e',provider:'aws',scope:'ops/us-east-1',kind:'cluster',nativeId:'arn:aws:eks:us-east-1:1:cluster/prod-east',name:'prod-east',health:'healthy',observedAt:'2026-10-23T00:00:00.000Z',properties:{nodeCount:40}};
 const h=await harness({extra:[eks]});try{const {page}=h,out=page.locator('#console-output');
  await page.locator('#console-input').fill('which is the largest cluster?');await page.locator('#console-input').press('Enter');await out.locator('.console-report').waitFor();
  assert.match(await out.innerText(),/Largest recorded cluster: prod-east \(Amazon EKS, 40 nodes\)\. By size: prod-east \(Amazon EKS, 40 nodes\), lab \(Kubernetes, 0 nodes\)\. Live kubectl reads go to lab/);assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});
