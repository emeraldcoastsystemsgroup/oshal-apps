#!/usr/bin/env node
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Scheduled discovery acceptance on the installed lab: a real headless browser turns on "Keep this cluster current" for the recorded lab cluster under the operator's native session; then, with no further browser action, the processing schedule must read the cluster through the person's own Kubernetes connection (kernel connector.read) and save a newer live scan. Records the setting, the schedule's result, the live collection before and after, and a screenshot. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require(path.join(__dirname,'../../scripts/toolchain/node_modules/playwright'));
const state=path.join(os.homedir(),'.local/state/oshal-k8s'),install=JSON.parse(fs.readFileSync(path.join(state,'installation.json'),'utf8'));
if(install.context!=='kind-operations-lab'||install.namespace!=='oshal-install-lab')throw Error('Only the owned lab installation is accepted.');
const base='http://127.0.0.1:'+install.port,cluster=process.argv[2],namespace='operations-demo';if(!cluster)throw Error('Pass the lab kube-system UID (the recorded cluster scope).');
async function call(p,body,token,method){const r=await fetch(base+p,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const t=await r.text();return t?JSON.parse(t):null;}
const liveCollection=async token=>{const graph=await call('/api/intelligent-operations/topology',null,token);const live=(graph.collections||[]).find(c=>c.collectionId==='live:'+cluster+'/'+namespace);return live?{complete:live.complete,observedAt:live.observedAt,scanId:live.scanId||null}:null;};
(async()=>{const token=(await call('/sessions',JSON.parse(fs.readFileSync(path.join(state,'admin-password.json'),'utf8'))))?.session;if(!token)throw Error('No session.');
 const browser=await chromium.launch({headless:true,args:['--disable-gpu']});const receipt={kind:'scheduled-discovery-acceptance',startedAt:new Date().toISOString(),cluster,namespace};
 try{receipt.before=await liveCollection(token);
  const page=await (await browser.newContext({viewport:{width:1360,height:1100},extraHTTPHeaders:{Authorization:'Bearer '+token}})).newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/api/intelligent-operations/app#systems');await page.getByText('Records refreshed',{exact:false}).waitFor({timeout:60000});
  await page.locator('#live-cluster summary').click();await page.getByText('Your Kubernetes connection is selected',{exact:false}).waitFor({timeout:30000});
  await page.waitForFunction(c=>[...document.querySelectorAll('#live-scope option')].some(o=>o.value===c),cluster,{timeout:60000});await page.locator('#live-scope').selectOption(cluster);
  const source=await page.locator('#live-source option').evaluateAll(o=>(o.find(x=>x.textContent.startsWith('Owned lab topology'))||{}).value);if(!source)throw Error('No Owned lab topology source.');await page.locator('#live-source').selectOption(source);
  await page.locator('#live-namespace').fill(namespace);await page.locator('#live-discovery-on').check();await page.locator('#live-discovery-interval').selectOption('5');
  await page.getByRole('button',{name:'Save discovery setting',exact:true}).click();await page.getByText('Saved. On:',{exact:false}).waitFor({timeout:30000});receipt.saved=await page.locator('#live-discovery-status').textContent();
  const setAt=Date.now();let config;
  // No browser action from here: only the scheduled tick (every minute) can read and save.
  for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,10000));config=await call('/api/intelligent-operations/topology/discovery',null,token);if(config?.lastResult&&Date.parse(config.lastResult.attemptAt)>=setAt-1000)break;}
  receipt.schedule={account:config?.account,intervalMinutes:config?.intervalMinutes,lastResult:config?.lastResult||null};
  receipt.after=await liveCollection(token);
  await page.getByRole('button',{name:'Refresh accounts',exact:true}).click();await page.getByText('Last read',{exact:false}).waitFor({timeout:30000}).catch(()=>{});receipt.panel=await page.locator('#live-discovery-status').textContent();
  await page.locator('#live-cluster').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(__dirname,'../deploy/evidence/scheduled-discovery.png'),fullPage:false});
  receipt.pageErrors=errors;
  const r=receipt.schedule.lastResult;receipt.result=r?.state==='saved'&&receipt.after&&(!receipt.before||Date.parse(receipt.after.observedAt.slice(0,23)+'Z')>Date.parse(receipt.before.observedAt.slice(0,23)+'Z'))&&!errors.length?'passed':'failed';
 }finally{await browser.close();await call('/sessions',null,token,'DELETE').catch(()=>{});receipt.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(__dirname,'../deploy/evidence/scheduled-discovery.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({result:receipt.result,saved:receipt.saved,schedule:receipt.schedule,before:receipt.before,after:receipt.after,panel:receipt.panel}));}
})().catch(e=>{console.error(e.message);process.exit(1);});
