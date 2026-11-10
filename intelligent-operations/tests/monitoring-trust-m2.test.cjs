/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Lane M2 rework (1.8.1): verify no package file touches oshal.current_sub, set_config, or system:monitoring (data stays in its existing owner scope); verify enrollment prepare with headless/Windows/macOS/config-pack and optional device trust metadata; verify removed-source topology scan filtering and discovery auto-disable; and verify Systems device trust UI in Chromium. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Lane M2 (1.8.0) guards: removed-source topology scan filtering and discovery auto-disable, and Systems device trust UI (pending device approval, allowed source CIDR editing, and headless/config-pack instructions). */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {createRequire}=require('node:module');
const {fixture,loadExperience}=require('./fixtures/intake.cjs');
const {engineFixture}=require('./fixtures/detection.cjs');
const root=path.resolve(__dirname,'..'),toolchain=path.resolve(process.env.STORE_CI_TOOLCHAIN||path.join(root,'..','scripts','toolchain'));
const reqFromToolchain=createRequire(path.join(toolchain,'package.json'));
const express=reqFromToolchain('express'),{chromium}=reqFromToolchain('playwright');

function createStore(){
 const collections=new Map();
 return {
  async query(name){return [...(collections.get(name)||new Map()).values()].map(v=>structuredClone(v));},
  async put(name,id,value){if(!collections.has(name))collections.set(name,new Map());collections.get(name).set(id,structuredClone(value));}
 };
}

test('data ownership boundary: package code never calls set_config, names oshal.current_sub or system:monitoring, or ships monitoring-scope',()=>{
 assert.equal(fs.existsSync(path.join(root,'src-routes/monitoring-scope.ts')),false);
 assert.equal(fs.existsSync(path.join(root,'routes/monitoring-scope.js')),false);
 for(const dir of ['src-routes','routes','experience']){
  const fullDir=path.join(root,dir);
  for(const entry of fs.readdirSync(fullDir)){
   const file=path.join(fullDir,entry);
   if(!fs.statSync(file).isFile())continue;
   const text=fs.readFileSync(file,'utf8');
   assert.doesNotMatch(text,/set_config|current_sub|system:monitoring|monitoring-scope/,`${dir}/${entry} must not forge or migrate database subjects`);
  }
 }
});

test('enrollment prepare accepts Windows, macOS, config-pack, and optional device trust metadata in the caller scope',async()=>{
 const f=await fixture(),engine=await engineFixture();
 try{
  const store=createStore(),pool=f.caller('alice'),app=express();
  app.use((req,_res,next)=>{req.oidc={user:{sub:'alice'}};next();});
  app.use('/api/intelligent-operations',loadExperience().createOperationsExperienceRoutes({
   appPackageDir:root,pool,store,intent:engine.intent,authorization:{registerResource(){}}
  }));
  const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
  const base='http://127.0.0.1:'+server.address().port+'/api/intelligent-operations';
  const call=async(method,route,body,headers={})=>{
   const r=await fetch(base+route,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
   return {status:r.status,body:await r.json()};
  };
  try{
   const win=await call('POST','/installations/enroll',{
    name:'win-edge-1',
    client:{host:'win-edge-1',platform:'windows',agent:'otel',version:'0.2.0',fingerprint:'SHA256:winfp123',allowedIps:['203.0.113.10/32'],observedIp:'203.0.113.10'}
   },{'x-oshal-trigger':'enroll'});
   assert.equal(win.status,200,JSON.stringify(win.body));
   assert.match(win.body.route,/^\/ingest\/otlp\//);

   const packOtel=await call('POST','/installations/enroll',{
    name:'k8s-otel-pack',
    client:{host:'k8s-node-1',platform:'macos',agent:'config-pack',tool:'otel',version:'0.2.0',publicKey:'ed25519:pubkey123'}
   },{'x-oshal-trigger':'enroll'});
   assert.equal(packOtel.status,200,JSON.stringify(packOtel.body));
   assert.match(packOtel.body.route,/^\/ingest\/otlp\//);

   const packProm=await call('POST','/installations/enroll',{
    name:'prom-pack-1',
    client:{host:'prom-1',platform:'linux',agent:'config-pack',tool:'alertmanager',version:'0.2.0'}
   },{'x-oshal-trigger':'enroll'});
   assert.equal(packProm.status,200,JSON.stringify(packProm.body));
   assert.match(packProm.body.route,/^\/ingest\/alertmanager\//);

   const tel=await call('GET','/telemetry');
   assert.equal(tel.status,200);
   const winEnr=tel.body.enrollments.find(e=>e.name==='win-edge-1');
   assert.equal(winEnr?.platform,'windows');
   assert.equal(winEnr?.fingerprint,'SHA256:winfp123');
   assert.deepEqual(winEnr?.allowedIps,['203.0.113.10/32']);
   assert.equal(winEnr?.observedIp,'203.0.113.10');
  }finally{server.closeAllConnections?.();await new Promise(r=>server.close(r));}
 }finally{await engine.close();await f.close();}
});

test('removed sources: systemsSummary excludes topology assets from removed sources, and removeSource disables scheduled discovery if bound to the removed source',async()=>{
 const f=await fixture();
 try{
  const {sourceDefinition,createOperationsExperienceRoutes}=loadExperience();
  const {saveScan}=require('../routes/topology-store.js');
  const {saveDiscoveryConfig,discoveryConfig,runDiscovery}=require('../routes/discovery.js');
  const store=createStore();
  const pool=f.caller('alice');
  const fleet=sourceDefinition({name:'fleet-observer-1',source:'urn:operations:source:fleet-observer-1',environment:'fleet-1'});
  const live=sourceDefinition({name:'spark-live',source:'urn:operations:source:spark-live',environment:'spark-live'});
  await store.put('sources',fleet.id,fleet);
  await store.put('sources',live.id,live);

  await saveScan(pool,'alice',fleet,{
   scanId:'fleet-scan-1',collectionId:'fleet/c1',observedAt:'2026-11-10T02:00:00.000Z',complete:true,
   assets:[{provider:'import',scope:'fleet',kind:'host',nativeId:'ghost-1',name:'ghost-asset-1',health:'unknown'}],
   relationships:[]
  });
  await saveScan(pool,'alice',live,{
   scanId:'live-scan-1',collectionId:'spark/c1',observedAt:'2026-11-10T02:05:00.000Z',complete:true,
   assets:[{provider:'kubernetes',scope:'spark',kind:'node',nativeId:'spark-1',name:'spark-node-1',health:'healthy'}],
   relationships:[]
  });
  await saveDiscoveryConfig(pool,'alice',{
   enabled:true,account:'primary',sourceId:fleet.id,scope:'fleet-cluster',namespace:'default',intervalMinutes:15,expectedRevision:0
  },[fleet.id,live.id]);

  const app=express();
  app.use((req,_res,next)=>{req.oidc={user:{sub:'alice'}};next();});
  app.use('/api/intelligent-operations',createOperationsExperienceRoutes({
   appPackageDir:root,pool,store,authorization:{registerResource(){}}
  }));
  const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
  const base='http://127.0.0.1:'+server.address().port+'/api/intelligent-operations';
  try{
   const rem=await fetch(base+'/sources/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceId:fleet.id,confirm:true})});
   assert.equal(rem.status,200);

   // 1. systemsSummary excludes the removed fleet-observer scan's unknown asset:
   const sys=await(await fetch(base+'/summary/systems')).json();
   assert.equal(sys.counts.assets,1,'removed source topology scan excluded from systemsSummary');
   assert.equal(sys.counts.unknown,0,'zero unknown ghost assets from removed source');
   assert.deepEqual(sys.issues,[]);

   // 2. discovery config pointing at the removed source is automatically disabled and cleared:
   const disc=await discoveryConfig(pool,'alice');
   assert.equal(disc.enabled,false,'scheduled discovery disabled when its source is removed');
   assert.equal(disc.sourceId,null,'removed sourceId cleared from discovery config');
   assert.deepEqual(await runDiscovery({pool,intent:async()=>({items:[]})},'alice',[live]),{enabled:false});
  }finally{server.closeAllConnections?.();await new Promise(r=>server.close(r));}
 }finally{await f.close();}
});

test('Systems UI device trust controls: pending self-registered device approval, allowed source CIDR editing, and headless/config-pack instructions work cleanly on desktop and phone',async()=>{
 const html=fs.readFileSync(path.join(root,'experience/index.html'),'utf8');
 const requests=[];
 let pending=[{
  id:'pend-dev-1',status:'pending',name:'edge-sensor-1',host:'edge-sensor-1',platform:'linux',agent:'otel',
  publicKeyFingerprint:'SHA256:ed25519keyfp987654321',observedIp:'198.51.100.42',allowedIps:['198.51.100.42/32']
 }];
 let tokens=[{
  id:'tok-m1-1',app:'intelligent-operations',label:'gsquared-staging alertmanager',route:'/ingest/alertmanager/'+'c'.repeat(64),
  expiresAt:'2027-02-07T00:00:00Z',firstDeliveryAt:'2026-11-10T01:00:00Z',lastDelivery:{at:'2026-11-10T03:00:00Z',status:202},
  publicKeyFingerprint:'SHA256:prodkeyfp112233',allowedIps:['203.0.113.10/32'],observedIp:'203.0.113.10'
 }];
 const telemetryBody={
  streams:[],packets:[],silenceWatch:{lastCheckedAt:'2026-11-10T03:00:10Z',ageSeconds:20,overdue:false},
  enrollments:[{sourceId:'c'.repeat(64),name:'gsquared-staging',agent:'prometheus',platform:'linux',host:'gsquared-1',version:'0.2.0',preparedAt:'2026-11-10T01:00:00Z',firstPreparedAt:'2026-11-10T01:00:00Z',fingerprint:'SHA256:prodkeyfp112233',allowedIps:['203.0.113.10/32']}],
  installations:[{
   sourceId:'c'.repeat(64),host:'gsquared-1',name:'gsquared-staging',environment:'gsquared-staging',
   url:'https://staging.example.com',state:'reporting',health:'ok',summary:'all checks ok',
   firstHeardAt:'2026-11-10T01:00:00Z',lastHeardAt:'2026-11-10T03:00:00Z',ageSeconds:20,reports:12,
   checks:[{id:'site',label:'Public site',state:'ok',reading:'200 in 0.12s'}],firing:[],history:[],trends:{},removable:true
  }]
 };
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1'),route=url.pathname.replace(/^\/api\/intelligent-operations/,'');
  const json=(v,code=200)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(v));};
  if(route==='/app'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;}
  if(route.startsWith('/assets/')){
   const name=path.basename(route),file=[path.join(root,'experience',name),path.join(root,'ui',name)].find(p=>fs.existsSync(p));
   res.writeHead(file?200:404,{'Content-Type':name.endsWith('.css')?'text/css':'application/javascript'});
   res.end(file?fs.readFileSync(file):'');return;
  }
  if(route==='/telemetry')return json(telemetryBody);
  if(route==='/api/v1/producer-tokens'&&req.method==='GET')return json({producerTokens:tokens,pendingEnrollments:pending});
  if(route==='/api/v1/producer-tokens/pend-dev-1/approve'&&req.method==='POST'){
   let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
    const body=JSON.parse(raw||'{}');
    requests.push(['APPROVE',body]);
    pending=[];
    json({approved:true,tokenId:'tok-approved-1',allowedIps:body.allowedIps});
   });return;
  }
  if(route==='/api/v1/producer-tokens/tok-m1-1/addresses'&&req.method==='POST'){
   let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
    const body=JSON.parse(raw||'{}');
    requests.push(['ADDRESSES',body]);
    tokens=[{...tokens[0],allowedIps:body.allowedIps}];
    json({updated:true,allowedIps:body.allowedIps});
   });return;
  }
  if(route==='/records')return json({sources:[],mappings:[],policies:[],bindings:[],processing:[],events:[],attempts:[],filterDecisions:[],symptoms:[],evidence:[],investigations:[],plans:[],approvals:[],executions:[],promotions:[],delegations:[],repos:[],provisioning:[],ticketLinks:[],syncAttempts:[]});
  if(route==='/topology')return json({assets:[],relationships:[],collections:[]});
  json({});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app';
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.goto(base+'#systems');
  const panel=page.locator('#monitor-enroll');
  await panel.waitFor({state:'visible'});

  // 1. Primary 3 install lines remain unchanged, and headless/config-pack section is present:
  assert.equal(await panel.locator('.monitor-line code').count(),3);
  const packs=panel.locator('details.monitor-packs');
  assert.equal(await packs.count(),1,'headless self-registration & config packs disclosure exists');
  await packs.locator('summary').click();
  const packCodes=await packs.locator('code').allTextContents();
  assert.ok(packCodes.some(c=>c.includes('--register')),'includes headless --register line');
  assert.ok(packCodes.some(c=>c.includes('install-windows.ps1')),'includes Windows installer line');
  assert.ok(packCodes.some(c=>c.includes('install-macos.sh')),'includes macOS installer line');
  assert.ok(packCodes.some(c=>c.includes('--config-pack alertmanager')),'includes Alertmanager config pack');
  assert.ok(packCodes.some(c=>c.includes('--config-pack prometheus')),'includes Prometheus config pack');
  assert.ok(packCodes.some(c=>c.includes('--config-pack otel')),'includes OTel config pack');

  // 2. Pending self-registered device shows fingerprint & editable CIDR allow-list, and Approve works:
  const pendingBox=panel.locator('.monitor-pending');
  await pendingBox.waitFor({state:'visible'});
  assert.match(await pendingBox.textContent(),/edge-sensor-1/);
  assert.match(await pendingBox.textContent(),/SHA256:ed25519keyfp987654321/);
  const pendingInput=pendingBox.locator('input.monitor-pending-ips');
  assert.equal(await pendingInput.inputValue(),'198.51.100.42/32');
  await pendingInput.fill('198.51.100.42/32, 10.20.0.0/16');
  await pendingBox.getByRole('button',{name:'Approve device'}).click();
  await page.waitForFunction(()=>document.querySelector('.monitor-pending')?.hidden===true);
  assert.deepEqual(requests[0],['APPROVE',{name:'edge-sensor-1',allowedIps:['198.51.100.42/32','10.20.0.0/16'],publicKeyFingerprint:'SHA256:ed25519keyfp987654321'}]);

  // 3. Installation card shows device key fingerprint and editable allowed addresses:
  const card=page.locator('.installation').first();
  await card.locator('.installation-trust').waitFor({state:'visible'});
  assert.match(await card.locator('.installation-trust').textContent(),/SHA256:prodkeyfp112233/);
  assert.match(await card.locator('.installation-trust').textContent(),/203\.0\.113\.10\/32/);
  const addrInput=card.locator('input.installation-ips-input');
  assert.equal(await addrInput.inputValue(),'203.0.113.10/32');
  await addrInput.fill('203.0.113.10/32, 203.0.113.11/32');
  await card.getByRole('button',{name:'Save addresses'}).click();
  await page.waitForFunction(()=>document.querySelector('.installation-trust')?.textContent.includes('203.0.113.11/32'));
  assert.deepEqual(requests[1],['ADDRESSES',{allowedIps:['203.0.113.10/32','203.0.113.11/32']}]);

  // 4. Phone viewport (412x915) fits with no horizontal overflow:
  await page.setViewportSize({width:412,height:915});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
  assert.equal(overflow,false,'no horizontal scroll on 412x915 phone viewport');
 }finally{await browser.close();server.closeAllConnections?.();await new Promise(r=>server.close(r));}
});
