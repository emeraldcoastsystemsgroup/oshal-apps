#!/usr/bin/env node
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Live cluster acceptance on the installed lab: a real headless browser opens Systems under the operator's native session, reads nodes, pods and deployments through the person's own Kubernetes connection, saves the read as a live scan into the recorded lab cluster and checks the graph and a screenshot. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require(path.join(__dirname,'../../scripts/toolchain/node_modules/playwright'));
const state=path.join(os.homedir(),'.local/state/oshal-k8s'),install=JSON.parse(fs.readFileSync(path.join(state,'installation.json'),'utf8'));
if(install.context!=='kind-operations-lab'||install.namespace!=='oshal-install-lab')throw Error('Only the owned lab installation is accepted.');
const base='http://127.0.0.1:'+install.port,cluster=process.argv[2];if(!cluster)throw Error('Pass the lab kube-system UID (the recorded cluster scope).');
async function call(p,body,token,method){const r=await fetch(base+p,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const t=await r.text();return t?JSON.parse(t):null;}
(async()=>{const token=(await call('/sessions',JSON.parse(fs.readFileSync(path.join(state,'admin-password.json'),'utf8'))))?.session;if(!token)throw Error('No session.');
 const browser=await chromium.launch({headless:true,args:['--disable-gpu']});const receipt={kind:'live-cluster-panel-acceptance',startedAt:new Date().toISOString(),cluster};
 try{const page=await (await browser.newContext({viewport:{width:1360,height:1100},extraHTTPHeaders:{Authorization:'Bearer '+token}})).newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/api/intelligent-operations/app#systems');await page.getByText('Records refreshed',{exact:false}).waitFor({timeout:60000});
  await page.locator('#live-cluster summary').click();await page.getByText('Your Kubernetes connection is selected',{exact:false}).waitFor({timeout:30000});
  await page.waitForFunction(c=>[...document.querySelectorAll('#live-scope option')].some(o=>o.value===c),cluster,{timeout:60000});await page.locator('#live-scope').selectOption(cluster);
  const source=await page.locator('#live-source option').evaluateAll(o=>(o.find(x=>x.textContent.startsWith('Owned lab topology'))||{}).value);if(!source)throw Error('No Owned lab topology source.');await page.locator('#live-source').selectOption(source);
  await page.locator('#live-namespace').fill('operations-demo');await page.getByRole('button',{name:'Read live cluster',exact:true}).click();await page.getByText('Live read at',{exact:false}).waitFor({timeout:60000});
  receipt.read=await page.evaluate(()=>[...document.querySelectorAll('#live-results h3')].map(h=>h.textContent));receipt.nodeRows=await page.locator('#live-results table').first().locator('tr').evaluateAll(r=>r.slice(1).map(x=>[...x.children].map(c=>c.textContent)));
  await page.getByRole('button',{name:'Save as inventory scan',exact:true}).click();await page.getByText('live inventory scan',{exact:false}).waitFor({timeout:60000});receipt.saved=await page.locator('#live-status').textContent();
  await page.screenshot({path:path.join(__dirname,'../deploy/evidence/live-cluster.png'),fullPage:false});
  const graph=await call('/api/intelligent-operations/topology',null,token);const live=(graph.collections||[]).find(c=>c.collectionId==='live:'+cluster+'/operations-demo');
  receipt.graph={liveCollection:live?{complete:live.complete,observedAt:live.observedAt}:null,nodes:graph.assets.filter(a=>a.kind==='node'&&a.scope===cluster).map(a=>({name:a.name,health:a.health,allocatableCpu:a.properties?.allocatableCpu,allocatableMemory:a.properties?.allocatableMemory,pressure:a.properties?.pressure||null})),runsOn:graph.relationships.filter(e=>e.type==='RUNS_ON').length,collectorRoutesKept:graph.relationships.filter(e=>e.type==='ROUTES_TO').length};
  receipt.pageErrors=errors;receipt.result=live&&receipt.graph.nodes.length&&!errors.length?'passed':'failed';
 }finally{await browser.close();await call('/sessions',null,token,'DELETE').catch(()=>{});receipt.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(__dirname,'../deploy/evidence/live-cluster.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({result:receipt.result,read:receipt.read,saved:receipt.saved,graph:receipt.graph&&{live:receipt.graph.liveCollection,nodes:receipt.graph.nodes.length,runsOn:receipt.graph.runsOn,routes:receipt.graph.collectorRoutesKept}}));}
})().catch(e=>{console.error(e.message);process.exit(1);});
