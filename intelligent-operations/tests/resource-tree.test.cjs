/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Node details show capacity, pressure and the pods placed on the node, and the pod link reveals and selects the exact pod in the tree. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Verify exact ownership, cycles, safe resource details and actual keyboard tree navigation on phone and desktop. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {forest}=require('../experience/resource-tree.js'),{systemInventory}=require('../experience/explorer.js'),{dependency}=require('./fixtures/intake.cjs');
const at='2026-10-21T14:00:00.000Z';
function graph(){
 const a=(id,kind,name=id,extra={})=>({id,kind,name,provider:'kubernetes',scope:'cluster-uid',nativeId:id,health:'unknown',observedAt:at,properties:{namespace:'shop'},...extra});
 return {asOf:at,collections:[],assets:[a('cluster-uid','cluster','lab',{properties:{}}),a('ns','namespace','shop',{properties:{}}),a('node','node','worker1',{properties:{}}),a('deploy','workload','checkout'),a('rs','replica-set','checkout-rs'),a('pod','pod','checkout-pod',{health:'degraded',properties:{namespace:'shop',phase:'Running',nodeName:'worker1'}}),a('container','container','api',{health:'degraded',properties:{namespace:'shop',image:'image@sha256:abc',restarts:4,waitingReason:'CrashLoopBackOff'}})],relationships:[{from:'rs',to:'deploy',type:'OWNED_BY',resolved:true},{from:'pod',to:'rs',type:'OWNED_BY',resolved:true},{from:'container',to:'pod',type:'RUNS_ON',resolved:true},{from:'pod',to:'node',type:'RUNS_ON',resolved:true}]};
}
test('resource tree follows exact ownership; pod placement is a fact rather than a duplicate parent',()=>{
 const g=graph(),m=systemInventory(g,[],{limit:2000}),f=forest(m);
 assert.equal(f.nodes.get('deploy').children[0].id,'rs');assert.equal(f.nodes.get('rs').children[0].id,'pod');assert.equal(f.nodes.get('pod').children[0].id,'container');assert.equal(f.nodes.get('node').children.length,0);assert.equal(f.roots[0].label,'lab · kubernetes');
 const old=JSON.stringify(g);forest(m);assert.equal(JSON.stringify(g),old);
});
test('ambiguous ownership and cycles stay independently visible; missing or duplicate identities refuse',()=>{
 const g=graph();g.relationships.push({from:'pod',to:'deploy',type:'OWNED_BY',resolved:true});let f=forest(systemInventory(g,[],{limit:2000}));assert.equal(f.nodes.get('rs').children.length,0);
 g.relationships=[{from:'pod',to:'rs',type:'OWNED_BY'},{from:'rs',to:'pod',type:'OWNED_BY'}];f=forest(systemInventory(g,[],{limit:2000}));assert.deepEqual(new Set(f.cycles),new Set(['pod','rs']));assert.equal(f.nodes.get('pod').children.length,0);
 assert.throws(()=>forest({rows:[{id:'x'},{id:'x'}]}),/repeated/);assert.throws(()=>forest({rows:Array(2001).fill({id:'x'})}),/unavailable/);
});
test('tree projection may use all returned assets while legacy cards retain their 100-row limit',()=>{
 const g=graph();g.assets=Array.from({length:120},(_,i)=>({...g.assets[5],id:'p'+i,nativeId:'p'+i}));g.relationships=[];
 assert.equal(systemInventory(g).rows.length,100);assert.equal(systemInventory(g,[],{limit:2000}).rows.length,120);assert.equal(systemInventory(g,[],{limit:999999}).rows.length,100);
});
test('shipped tree expands with keyboard, inspects original container facts, fits phone and clears on disposal',async()=>{
 const root=path.resolve(__dirname,'../experience'),fixture=graph();fixture.assets[6].name='<img src=x onerror=bad()>';let browser;
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://fixture').pathname;
  if(pathname==='/fixture.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(fixture));return;}
  const asset=path.basename(pathname);if(['resource-tree.js','explorer.js','experience.css','operations.css'].includes(asset)){res.setHeader('Content-Type',asset.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8');res.end(fs.readFileSync(path.join(asset==='operations.css'?path.resolve(root,'../ui'):root,asset)));return;}
  res.setHeader('Content-Type','text/html');res.end('<meta charset="utf-8"><link rel="stylesheet" href="operations.css"><link rel="stylesheet" href="experience.css"><main><div id="result"></div></main><script src="explorer.js"></script><script src="resource-tree.js"></script><script>fetch("fixture.json").then(r=>r.json()).then(g=>{window.tree=OperationsResourceTree.mount(document.getElementById("result"),OperationsExplorer.systemInventory(g,[],{limit:2000}));});</script>');
 });
 try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const {chromium}=dependency('playwright');browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage({viewport:{width:1280,height:1000}});page.setDefaultTimeout(5000);page.on('pageerror',e=>console.error('Fixture script failure:',e.message));await page.goto('http://127.0.0.1:'+server.address().port);
  const tree=page.getByRole('tree');await tree.waitFor();await tree.getByRole('treeitem',{name:/lab · kubernetes/}).click();
  const ns=tree.getByRole('treeitem',{name:/shop group/});await ns.focus();await ns.press('ArrowRight');await ns.press('ArrowRight');
  assert.match(await page.locator(':focus').innerText(),/checkout/);await page.locator(':focus').press('ArrowRight');await page.locator(':focus').press('ArrowRight');assert.match(await page.locator(':focus').innerText(),/checkout-rs/);
  await page.locator(':focus').press('ArrowLeft');assert.match(await page.locator(':focus').innerText(),/checkout/);
  await tree.locator('[data-resource-id="rs"]').click();
  await tree.locator('[data-resource-id="pod"]').click();await tree.locator('[data-resource-id="container"]').click();
  const detail=page.getByRole('region',{name:'Resource details'});assert.match(await detail.innerText(),/CrashLoopBackOff/);assert.match(await detail.innerText(),/image@sha256:abc/);assert.match(await detail.innerText(),/Restart count\s+4/);assert.equal(await page.locator('img').count(),0);
  for(const width of [390,768,1280]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'fits '+width);}
  await page.evaluate(()=>window.tree.dispose());assert.equal(await page.locator('#result').innerText(),'');
 }finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('filtered pod results retain the observed cluster label without adding filtered resources',()=>{
 const m=systemInventory(graph(),[],{search:'checkout-pod',limit:2000}),f=forest(m);
 assert.equal(f.roots[0].label,'lab · kubernetes');assert.equal(f.nodes.size,1);assert.ok(f.nodes.has('pod'));
});
test('node details show capacity, pressure and placed pods, and a pod link reveals the exact pod in the shipped tree',async()=>{
 const root=path.resolve(__dirname,'../experience'),fixture=graph();const node=fixture.assets.find(a=>a.id==='node');node.properties={capacityCpu:'2',capacityMemory:'3145728Ki',capacityPods:'110',allocatableCpu:'2',allocatableMemory:'3043328Ki',allocatablePods:'110',pressure:'MemoryPressure',conditions:'DiskPressure=False,MemoryPressure=True,Ready=True',kubeletVersion:'v1.37.0',roles:'worker',taints:'dedicated=ops:NoSchedule',internalIp:'172.18.0.3'};
 if(!fixture.relationships.some(e=>e.from==='pod'&&e.to==='node'))fixture.relationships.push({from:'pod',to:'node',type:'RUNS_ON',evidence:'spec.nodeName',resolved:true});
 let browser;const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://fixture').pathname;if(pathname==='/fixture.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(fixture));return;}const asset=path.basename(pathname);if(['resource-tree.js','explorer.js','experience.css','operations.css'].includes(asset)){res.setHeader('Content-Type',asset.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8');res.end(fs.readFileSync(path.join(asset==='operations.css'?path.resolve(root,'../ui'):root,asset)));return;}res.setHeader('Content-Type','text/html');res.end('<meta charset="utf-8"><link rel="stylesheet" href="operations.css"><link rel="stylesheet" href="experience.css"><main><div id="result"></div></main><script src="explorer.js"></script><script src="resource-tree.js"></script><script>fetch("fixture.json").then(r=>r.json()).then(g=>{window.tree=OperationsResourceTree.mount(document.getElementById("result"),OperationsExplorer.systemInventory(g,[],{limit:2000}));});</script>');});
 try{await new Promise(r=>server.listen(0,'127.0.0.1',r));const {chromium}=dependency('playwright');browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage({viewport:{width:1280,height:1000}});page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
  const tree=page.getByRole('tree');await tree.waitFor();await tree.getByRole('treeitem',{name:/lab · kubernetes/}).click();await tree.locator('[data-resource-id="node"]').click();
  const detail=page.getByRole('region',{name:'Resource details'});const textNow=await detail.innerText();assert.match(textNow,/Node facts/);assert.match(textNow,/Pressure at capture: MemoryPressure/);assert.match(textNow,/CPU\s+2\s+2/);assert.match(textNow,/Pods on this node · 1/);assert.match(textNow,/dedicated=ops:NoSchedule/);
  await detail.getByRole('button',{name:/checkout-pod/}).click();assert.equal(await tree.locator('[data-resource-id="pod"][aria-selected="true"]').count(),1,'the pod link reveals and selects the exact pod');assert.match(await detail.innerText(),/^POD/m);assert.deepEqual(errors,[]);
 }finally{await browser?.close();server.close();}
});
