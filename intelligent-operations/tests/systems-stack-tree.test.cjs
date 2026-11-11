/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Systems tab (1.8.2): red-before/green-after unit and Chromium DOM tests for the + / − expandable Server -> Cluster/VM -> Node -> Workloads infrastructure stack tree, child-to-parent alert and health roll-up, per-level readings/last-heard/actions/jumps, personal satellite device exclusion (oshal-node-desktop, phones, TVs), and untouched Triage (#overview) tab. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {dependency,root}=require('./fixtures/intake.cjs');
const {forest,stackForest,isPersonalSatelliteAsset}=require('../experience/resource-tree.js');
const {systemInventory}=require('../experience/explorer.js');

const NOW=Date.parse('2026-11-10T06:50:00.000Z');

function sparkInstallation(extra={}){
 return {
  sourceId:'source-spark',
  name:'spark/platform-ops',
  environment:'production',
  state:'reporting',
  lastHeardAt:new Date(NOW-12000).toISOString(),
  ageSeconds:12,
  lateAfterSeconds:180,
  silentAfterSeconds:600,
  firstHeardAt:new Date(NOW-86400000).toISOString(),
  reports:1440,
  silentSince:null,
  heartbeatEndedAt:null,
  host:'spark-host',
  url:'https://spark.example',
  health:'degraded',
  uptimeSeconds:864000,
  feedError:null,
  removable:false,
  checks:[
   {id:'site',label:'Public site',state:'ok',reading:'3 of 3 up, 0.04 s'},
   {id:'kernel',label:'OSHAL kernel',state:'ok',reading:'2 of 2 running (green, blue)'},
   {id:'postgres',label:'PostgreSQL',state:'ok',reading:'2 of 2 running, 128 MB'},
   {id:'containers',label:'Containers',state:'ok',reading:'14 of 14 running: k3s, kernel-pg, kernel-pg-green'},
   {id:'disk',label:'Disk',state:'bad',reading:'91% used, 82.4 GB free'},
   {id:'memory',label:'Memory',state:'ok',reading:'62% used'},
   {id:'processor',label:'Processor',state:'ok',reading:'19% busy'}
  ],
  firing:[
   {fingerprint:'fp-disk',alertType:'DiskFull',severity:'critical',summary:'Root filesystem is 91% full',startsAt:new Date(NOW-1800000).toISOString(),deliveryId:'event-disk'},
   {fingerprint:'fp-green',alertType:'PodUnready',severity:'warning',service:'oshal-saas-green',summary:'Standby k3s pod readiness probe failed on :38881',startsAt:new Date(NOW-600000).toISOString(),deliveryId:'event-green'}
  ],
  history:{days:1,bucketMinutes:15,since:NOW-86400000,now:NOW,series:{}},
  ...extra
 };
}

function gsquaredInstallation(){
 return {
  sourceId:'source-gsq-prod',
  name:'gsquared-production',
  environment:'production',
  state:'reporting',
  lastHeardAt:new Date(NOW-18000).toISOString(),
  ageSeconds:18,
  lateAfterSeconds:180,
  silentAfterSeconds:600,
  firstHeardAt:new Date(NOW-86400000).toISOString(),
  reports:1420,
  silentSince:null,
  heartbeatEndedAt:null,
  host:'gsquared-prod-1',
  url:'https://gsquared.example',
  health:'healthy',
  uptimeSeconds:864000,
  feedError:null,
  removable:true,
  checks:[
   {id:'site',label:'Public site',state:'ok',reading:'Answers in 0.18 s'},
   {id:'containers',label:'Containers',state:'ok',reading:'3 of 3 running: kernel, postgres, caddy'},
   {id:'disk',label:'Disk',state:'ok',reading:'38% used'}
  ],
  firing:[],
  history:{days:1,bucketMinutes:15,since:NOW-86400000,now:NOW,series:{}}
 };
}

test('unit: stackForest builds Server -> Cluster/VM -> Node -> Workloads hierarchy, rolls child workload alerts up to node/cluster/server, and excludes personal satellite devices',()=>{
 assert.equal(typeof stackForest,'function','resource-tree.js must export stackForest');
 assert.equal(typeof isPersonalSatelliteAsset,'function','resource-tree.js must export isPersonalSatelliteAsset');

 // 1. Personal satellite devices are recognized and excluded:
 assert.equal(isPersonalSatelliteAsset({kind:'oshal-node-desktop',name:'spark-f255'}),true);
 assert.equal(isPersonalSatelliteAsset({kind:'desktop',name:'my-computer'}),true);
 assert.equal(isPersonalSatelliteAsset({kind:'phone',name:'Roger Pixel'}),true);
 assert.equal(isPersonalSatelliteAsset({kind:'tv',name:'Living Room FireTV'}),true);
 assert.equal(isPersonalSatelliteAsset({kind:'host',name:'spark-host'}),false);
 assert.equal(isPersonalSatelliteAsset({kind:'cluster',name:'oshal-k8s-saas-cp'}),false);

 const satelliteInst={sourceId:'sat-1',name:'spark-f255',kind:'oshal-node-desktop',host:'spark-f255',state:'reporting',health:'healthy',checks:[],firing:[]};
 const roots=stackForest([sparkInstallation(),gsquaredInstallation(),satelliteInst]);
 assert.equal(roots.length,2,'personal satellite installation excluded from stackForest');
 assert.equal(roots.some(r=>r.name==='spark-f255'||r.name==='my-computer'),false);

 const spark=roots.find(r=>r.name==='spark-host'||r.sourceId==='source-spark');
 assert.ok(spark,'spark-host server root is present');
 assert.equal(spark.kind,'server');

 // 2. Level 2: Kubernetes cluster oshal-k8s-saas-cp under spark-host:
 const k8sCluster=spark.children.find(c=>c.name==='oshal-k8s-saas-cp');
 assert.ok(k8sCluster,'oshal-k8s-saas-cp cluster is stacked under spark-host');
 assert.equal(k8sCluster.kind,'cluster');

 // 3. Level 3: Node under oshal-k8s-saas-cp:
 assert.ok(k8sCluster.children.length>=1,'cluster has at least one node');
 const k8sNode=k8sCluster.children[0];
 assert.equal(k8sNode.kind,'node');

 // 4. Level 4: Workloads (oshal-saas-blue, oshal-saas-green, oshal-saas-door, postgres-blue-0, postgres-green-0) under the node:
 const workloadNames=k8sNode.children.map(w=>w.name);
 for(const expected of ['oshal-saas-blue','oshal-saas-green','oshal-saas-door','postgres-blue-0','postgres-green-0']){
  assert.ok(workloadNames.includes(expected),`expected workload ${expected} in ${JSON.stringify(workloadNames)}`);
 }

 // 5. Child alert on oshal-saas-green rolls up to k8sNode -> k8sCluster -> spark-host:
 const greenPod=k8sNode.children.find(w=>w.name==='oshal-saas-green');
 assert.equal(greenPod.directAlerts.length,1,'PodUnready is attached directly to oshal-saas-green');
 assert.equal(greenPod.directAlerts[0].alertType,'PodUnready');
 assert.equal(greenPod.rolledUpCount,0);
 assert.equal(greenPod.effectiveHealth,'degraded');

 assert.equal(k8sNode.directAlerts.length,0);
 assert.equal(k8sNode.rolledUpCount,1,'PodUnready rolls up to parent node');
 assert.equal(k8sNode.effectiveHealth,'degraded');

 assert.equal(k8sCluster.directAlerts.length,0);
 assert.equal(k8sCluster.rolledUpCount,1,'PodUnready rolls up to parent cluster oshal-k8s-saas-cp');
 assert.equal(k8sCluster.effectiveHealth,'degraded');

 assert.equal(spark.directAlerts.length,1,'DiskFull remains a direct server alert on spark-host');
 assert.equal(spark.rolledUpCount,1,'PodUnready rolls up to spark-host server');
 assert.equal(spark.totalAlerts.length,2,'spark-host has 1 direct + 1 rolled-up child alert');
 assert.equal(spark.effectiveHealth,'critical');

 // 6. Resource tree forest() also excludes personal satellite assets:
 const g={
  asOf:new Date(NOW).toISOString(),
  collections:[],
  assets:[
   {id:'cluster-1',kind:'cluster',name:'oshal-k8s-saas-cp',provider:'kubernetes',scope:'k3s',nativeId:'c1',health:'healthy',observedAt:new Date(NOW).toISOString(),properties:{}},
   {id:'sat-desktop',kind:'oshal-node-desktop',name:'spark-f255',provider:'import',scope:'k3s',nativeId:'sat1',health:'healthy',observedAt:new Date(NOW).toISOString(),properties:{}}
  ],
  relationships:[]
 };
 const f=forest(systemInventory(g,[],{limit:2000}));
 assert.equal(f.nodes.has('sat-desktop'),false,'personal satellite desktop never enters forest()');
 assert.equal(f.nodes.has('cluster-1'),true);
});

test('browser: Systems tab renders + / − expandable stack tree with child alert roll-up, per-level actions/jumps, excludes personal devices, and leaves Triage untouched',async()=>{
 const html=fs.readFileSync(path.join(root,'experience/index.html'),'utf8');
 const {chromium}=dependency('playwright');
 const installations=[
  sparkInstallation(),
  gsquaredInstallation(),
  {sourceId:'sat-orbit',name:'spark-f255',kind:'oshal-node-desktop',host:'spark-f255',state:'reporting',health:'healthy',checks:[],firing:[],history:{days:1,bucketMinutes:15,since:NOW-86400000,now:NOW,series:{}}}
 ];
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1'),route=url.pathname.replace(/^\/api\/intelligent-operations/,'');
  const json=(v,code=200)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(v));};
  if(url.pathname==='/api/auth/user')return json({authenticated:true,subject:'sub-1',displayName:'Roger'});
  if(url.pathname==='/api/v1/producer-tokens')return json({producerTokens:[],pendingEnrollments:[],limit:64});
  if(url.pathname==='/api/tickets')return json({tickets:[]});
  if(url.pathname==='/api/v1/agent/schedules')return json({schedules:[]});
  if(url.pathname==='/api/v1/peer-inbox')return json({delegations:[]});
  if(route==='/app'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;}
  if(route.startsWith('/assets/')){
   const name=path.basename(route),file=[path.join(root,'experience',name),path.join(root,'ui',name)].find(p=>fs.existsSync(p));
   res.writeHead(file?200:404,{'Content-Type':name.endsWith('.css')?'text/css':'application/javascript'});
   res.end(file?fs.readFileSync(file):'');return;
  }
  if(route==='/telemetry')return json({streams:[],limits:{},installations,enrollments:[],watch:{lastTickAt:new Date(NOW-20000).toISOString(),ageSeconds:20,overdue:false,graceUntil:null}});
  if(route==='/records')return json({sources:[{id:'source-spark',name:'spark/platform-ops',environment:'production',source:'urn:ops:spark',mapping:{environment:'/data/environment'}}],events:[],inventory:[],processing:[],attempts:[]});
  if(route==='/pipeline')return json({policies:[],bindings:[],decisions:[],symptoms:[],evidenceWork:[],correlations:[]});
  if(route==='/investigations'||route==='/executions'||route==='/delegations')return json({items:[]});
  if(route==='/topology')return json({asOf:new Date(NOW).toISOString(),assets:[],relationships:[],collections:[]});
  if(route==='/topology/discovery'||route==='/pipeline/processing')return json({enabled:false,config:{enabled:false,sourceIds:[],batchSize:10,maxAttempts:8,retrySeconds:30,revision:0},jobs:[]});
  if(route==='/anomaly')return json({baselines:[],cursors:[],config:{}});
  return json({error:'Not found'},404);
 });
 let browser;
 try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch({headless:true,args:['--disable-gpu']});
  const context=await browser.newContext({viewport:{width:1440,height:960}});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const base='http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app';

  await page.goto(base+'#systems');
  const sparkCard=page.locator('.installation[data-source="source-spark"]');
  await sparkCard.waitFor();

  // 1. Personal satellite device (spark-f255) never appears in Systems:
  assert.equal(await page.locator('.installation[data-source="sat-orbit"]').count(),0,'personal satellite device excluded from #installations');
  assert.doesNotMatch(await page.locator('#systems').textContent(),/spark-f255/);

  // 2. Server stack tree starts collapsed with '+' and shows rolled-up alert count:
  const stackTree=sparkCard.locator('.stack-tree');
  await stackTree.waitFor();
  const serverNode=stackTree.locator('[data-stack-level="1"]');
  const serverToggle=serverNode.locator('> .stack-tree-bar .stack-tree-toggle');
  assert.equal(await serverToggle.textContent(),'+');
  assert.equal(await serverToggle.getAttribute('aria-expanded'),'false');
  assert.match(await serverNode.locator('> .stack-tree-bar').textContent(),/1 rolled up/);

  // 3. Click '+' on Server (level 1) -> expands to '−' and shows Level 2 Cluster (oshal-k8s-saas-cp):
  await serverToggle.click();
  assert.equal(await serverToggle.textContent(),'−');
  assert.equal(await serverToggle.getAttribute('aria-expanded'),'true');
  const clusterNode=stackTree.locator('[data-stack-level="2"]',{hasText:'oshal-k8s-saas-cp'});
  assert.equal(await clusterNode.isVisible(),true,'Level 2 cluster row is visible after expanding Server');
  assert.match(await clusterNode.locator('> .stack-tree-bar').textContent(),/1 alert rolled up/);

  // 4. Click '+' on Cluster (level 2) -> expands to '−' and shows Level 3 Node:
  const clusterToggle=clusterNode.locator('> .stack-tree-bar .stack-tree-toggle');
  assert.equal(await clusterToggle.textContent(),'+');
  await clusterToggle.click();
  assert.equal(await clusterToggle.textContent(),'−');
  const k8sNode=clusterNode.locator('[data-stack-level="3"]').first();
  assert.equal(await k8sNode.isVisible(),true,'Level 3 node row is visible after expanding Cluster');
  assert.match(await k8sNode.locator('> .stack-tree-bar').textContent(),/1 alert rolled up/);

  // 5. Click '+' on Node (level 3) -> expands to '−' and shows Level 4 Workloads (blue, green, door, postgres):
  const nodeToggle=k8sNode.locator('> .stack-tree-bar .stack-tree-toggle');
  assert.equal(await nodeToggle.textContent(),'+');
  await nodeToggle.click();
  assert.equal(await nodeToggle.textContent(),'−');
  for(const workload of ['oshal-saas-blue','oshal-saas-green','oshal-saas-door','postgres-blue-0','postgres-green-0']){
   const wRow=k8sNode.locator('[data-stack-level="4"]',{hasText:workload});
   assert.equal(await wRow.isVisible(),true,`Level 4 workload ${workload} is visible`);
  }

  // 6. Click '+' on oshal-saas-green (level 4) -> expands workload detail drawer showing PodUnready alert and actions:
  const greenRow=k8sNode.locator('[data-stack-level="4"]',{hasText:'oshal-saas-green'});
  const greenToggle=greenRow.locator('> .stack-tree-bar .stack-tree-toggle');
  await greenToggle.click();
  assert.equal(await greenToggle.textContent(),'−');
  const greenDetail=greenRow.locator('.stack-workload-detail');
  assert.equal(await greenDetail.isVisible(),true);
  assert.match(await greenDetail.textContent(),/PodUnready/);
  assert.equal(await greenDetail.locator('a[href="#app-ops"]').count(),1);
  assert.equal(await greenDetail.locator('a[href="#runbooks"]').count(),1);

  // 7. Click '−' on Server -> collapses back to '+':
  await serverToggle.click();
  assert.equal(await serverToggle.textContent(),'+');
  assert.equal(await serverToggle.getAttribute('aria-expanded'),'false');
  assert.equal(await clusterNode.isVisible(),false);

  // 8. Responsive check at 412x915 and 320x800 (no horizontal scroll):
  for(const width of [412,320]){
   await page.setViewportSize({width,height:800});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'fits '+width);
  }
  await page.setViewportSize({width:1440,height:960});

  // 9. Triage (#overview) tab is 100% untouched and has no .stack-tree:
  await page.goto(base+'#overview');
  await page.locator('#overview-installations').waitFor();
  assert.equal(await page.locator('#overview .stack-tree').count(),0,'Triage (#overview) has zero stack-tree elements');
  assert.equal(await page.locator('#overview-attention').isVisible(),true);
  assert.equal(await page.locator('#overview-tickets').isVisible(),true);
  assert.deepEqual(errors,[]);
 }finally{
  await browser?.close();
  server.closeAllConnections();
  await new Promise(r=>server.close(r));
 }
});
