/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Verify directed preset answers, deterministic XYZ depth and actual desktop/phone 3D interaction and access-withdrawal clearing. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {query,layout,project}=require('../experience/graph-space.js'),{dependency}=require('./fixtures/intake.cjs');
const at='2026-10-21T12:00:00Z';
const asset=(id,kind='pod',scope='cluster-a')=>({id,kind,name:id,nativeId:'uid-'+id,provider:'kubernetes',scope,observedAt:'2026-10-21T11:59:00Z',health:'healthy',observations:[],properties:{}});
function graph(){return {asOf:at,collections:[{complete:true}],assets:[asset('api'),asset('cache'),asset('web'),asset('worker','node'),{...asset('old','pod','cluster-b'),observedAt:'2026-10-21T11:44:59Z',health:'degraded'},asset('unknown')].map(a=>a.id==='unknown'?{...a,health:'unknown'}:a),relationships:[{from:'web',to:'api',type:'DEPENDS_ON'},{from:'api',to:'cache',type:'DEPENDS_ON'},{from:'api',to:'worker',type:'RUNS_ON'},{from:'cache',to:'api',type:'DEPENDS_ON'},{from:'api',to:'missing',type:'DEPENDS_ON'}]};}
const ids=m=>m.assets.map(a=>a.id).sort();
test('presets traverse directed recorded edges, stop cycles and distinguish stale, degraded and unknown',()=>{
 const data=graph();assert.deepEqual(ids(query(data,{preset:'dependencies',focus:'api'})),['api','cache']);assert.deepEqual(ids(query(data,{preset:'dependents',focus:'api'})),['api','cache','web']);assert.deepEqual(ids(query(data,{preset:'placement',focus:'worker'})),['api','worker']);assert.deepEqual(ids(query(data,{preset:'degraded'})),['old']);assert.deepEqual(ids(query(data,{preset:'stale'})),['old']);
 assert.equal(query(data).unresolved,1);assert.deepEqual(ids(query(data,{search:'UID-api',kind:'pod'})),['api']);assert.throws(()=>query(data,{preset:'dependencies',focus:'not-owned'}),/focus/);assert.throws(()=>query(data,{preset:'arbitrary-code'}),/predefined/);
 const future=graph();future.assets[0].observedAt='2026-10-21T12:01:00Z';assert.throws(()=>query(future),/observation/);assert.throws(()=>query({...data,assets:[...data.assets,data.assets[0]]}),/identity/);
});
test('query budgets disclose truncation and stable layout has true perspective depth',()=>{
 const data=graph();data.assets=Array.from({length:650},(_,i)=>asset('a'+i));data.relationships=data.assets.slice(1).map(a=>({from:'a0',to:a.id,type:'DEPENDS_ON'}));
 const model=query(data,{preset:'dependencies',focus:'a0'});assert.equal(model.assets.length,100);assert.equal(model.matched,500);assert.equal(model.limited,true);assert.equal(model.truncated,true);assert.ok(model.relationships.every(e=>model.assets.some(a=>a.id===e.from)&&model.assets.some(a=>a.id===e.to)));
 const nodes=layout(graph().assets);assert.deepEqual(nodes,layout(graph().assets));assert.ok(new Set(nodes.map(n=>n.z)).size>1);const camera={yaw:0,pitch:0,zoom:1,panX:0,panY:0},first=project(nodes,camera,800,400),second=project(nodes,{...camera,yaw:0.6},800,400);assert.notDeepEqual(first.map(a=>a.screenX),second.map(a=>a.screenX));assert.ok(new Set(first.map(a=>a.radius)).size>1);
});
test('shipped 3D view orbits, zooms, runs presets and clears private pixels after access withdrawal',async()=>{
 const root=path.resolve(__dirname,'../experience'),{chromium}=dependency('playwright');let status=200,browser;const errors=[];
 const server=http.createServer((req,res)=>{
  const route=new URL(req.url,'http://fixture').pathname;res.setHeader('Cache-Control','no-store');
  if(route.endsWith('/records')||route.endsWith('/topology')||route.endsWith('/pipeline')){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(route.endsWith('/records')?{sources:[],events:[],inventory:[]}:route.endsWith('/topology')?graph():{policies:[],bindings:[],decisions:[],symptoms:[],evidenceWork:[]}));return;}
  if(route.startsWith('/shared/')){res.writeHead(200,{'Content-Type':route.endsWith('.js')?'text/javascript':'text/css'});res.end('');return;}
  const file=route.endsWith('/app')?'index.html':route.split('/').pop(),directory=file==='operations.css'?path.resolve(root,'../ui'):root;
  if(!/^[a-z-]+\.(js|css|html)$/.test(file)||!fs.existsSync(path.join(directory,file))){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(path.join(directory,file)));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/app#estate');await page.locator('canvas.graph-space-canvas').waitFor();await page.waitForFunction(()=>document.querySelectorAll('.inventory-node').length===6);
  const canvas=page.locator('canvas.graph-space-canvas'),pixels=()=>canvas.evaluate(c=>c.toDataURL());const initial=await pixels();await page.getByRole('button',{name:'Orbit right',exact:true}).click();assert.notEqual(await pixels(),initial);const orbit=await pixels();await page.getByRole('button',{name:'Zoom in',exact:true}).click();assert.notEqual(await pixels(),orbit);await canvas.focus();await page.keyboard.press('ArrowLeft');
  await page.locator('#graph-focus').selectOption('api');await page.locator('#graph-preset').selectOption('dependencies');assert.equal(await page.locator('.inventory-node').count(),2);assert.match(await page.locator('#graph-overview').innerText(),/four hops/);await page.getByRole('button',{name:'Explore node cache',exact:true}).press('Enter');assert.equal(await page.locator('#graph-focus').inputValue(),'cache');
  await page.locator('#graph-preset').selectOption('degraded');assert.equal(await page.locator('.inventory-node').count(),1);await page.locator('#graph-preset').selectOption('stale');assert.equal(await page.locator('.inventory-node').count(),1);await page.locator('#graph-preset').selectOption('estate');
  await page.locator('#graph-display').selectOption('2d');assert.equal(await page.locator('svg.inventory-graph').count(),1);assert.equal(await page.locator('canvas').count(),0);await page.locator('#graph-display').selectOption('3d');
  for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.getByRole('button',{name:'Orbit left',exact:true}).click();}
  status=403;await page.locator('#refresh').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('role'));assert.equal(await page.locator('canvas').count(),0);assert.equal(await page.locator('.inventory-node').count(),0);assert.deepEqual(errors,[]);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('every shipped experience script has explicit current-user GET and HEAD admission',()=>{
 const yaml=dependency('js-yaml'),authorization=yaml.load(fs.readFileSync(path.join(__dirname,'../authorization.yaml'),'utf8')),html=fs.readFileSync(path.join(__dirname,'../experience/index.html'),'utf8');
 for(const match of html.matchAll(/src="\/api\/intelligent-operations(\/assets\/[^"]+)"/g))for(const method of ['GET','HEAD'])assert.ok(authorization.bindings.http.some(b=>b.path===match[1]&&b.method===method&&b.allOf.includes('app.open')),method+' '+match[1]+' must require current-user read admission');
});
