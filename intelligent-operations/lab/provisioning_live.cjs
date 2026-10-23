#!/usr/bin/env node
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Installed-lab acceptance in a real headless browser under the operator's native session: the Provisioning page renders a team namespace into exact manifests; after an authority-changing release the kernel suspends the processing schedule, Overview says so and its Re-activate button resumes it. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require(path.join(__dirname,'../../scripts/toolchain/node_modules/playwright'));
const state=path.join(os.homedir(),'.local/state/oshal-k8s'),install=JSON.parse(fs.readFileSync(path.join(state,'installation.json'),'utf8'));
if(install.context!=='kind-operations-lab'||install.namespace!=='oshal-install-lab')throw Error('Only the owned lab installation is accepted.');
const base='http://127.0.0.1:'+install.port;
async function call(p,body,token,method){const r=await fetch(base+p,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const t=await r.text();return {status:r.status,body:t?JSON.parse(t):null};}
const schedule=async token=>((await call('/api/v1/agent/schedules',null,token)).body.schedules||[]).find(x=>x.app==='intelligent-operations');
(async()=>{const token=(await call('/sessions',JSON.parse(fs.readFileSync(path.join(state,'admin-password.json'),'utf8')))).body?.session;if(!token)throw Error('No session.');
 const receipt={kind:'provisioning-and-schedule-notice-acceptance',startedAt:new Date().toISOString(),kernel:install.image};const browser=await chromium.launch({headless:true,args:['--disable-gpu']});
 try{const page=await (await browser.newContext({viewport:{width:1360,height:1200},extraHTTPHeaders:{Authorization:'Bearer '+token}})).newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/api/intelligent-operations/app#provision');await page.getByText('provisioning request(s)',{exact:false}).waitFor({timeout:60000});
  await page.locator('#provision-template').selectOption('team-namespace');await page.locator('#provision-name').fill('lab-acceptance');await page.locator('#provision-team').fill('operations');await page.locator('#provision-reason').fill('Installed-lab provisioning acceptance');await page.getByRole('button',{name:'Render manifests',exact:true}).click();await page.getByText('Rendered 5 manifests',{exact:false}).waitFor({timeout:60000});
  receipt.rendered=await page.locator('#provision-files summary').allInnerTexts();await page.locator('#provision-panel').screenshot({path:path.join(__dirname,'../deploy/evidence/provisioning.png')});
  let s=await schedule(token);const deadline=Date.now()+150000;while(s?.status==='active'&&Date.now()<deadline){await new Promise(r=>setTimeout(r,10000));s=await schedule(token);}
  receipt.scheduleBefore={status:s?.status,reason:s?.reason||null};
  if(s&&s.status!=='active'){await page.goto(base+'/api/intelligent-operations/app#overview');const actions=page.locator('#overview-actions');await actions.getByText('Processing schedule is',{exact:false}).waitFor({timeout:60000});receipt.notice=await actions.getByText('Processing schedule is',{exact:false}).innerText();
   await actions.getByRole('button',{name:'Re-activate',exact:true}).click();await actions.getByText('Processing schedule suspended',{exact:true}).waitFor({timeout:60000});receipt.scheduleAfter=(await schedule(token))?.status;}
  receipt.pageErrors=errors;receipt.result=receipt.rendered.length===5&&(receipt.scheduleBefore.status==='active'||receipt.scheduleAfter==='active')&&!errors.length?'passed':'failed';
 }finally{await browser.close();await call('/sessions',null,token,'DELETE').catch(()=>{});receipt.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(__dirname,'../deploy/evidence/provisioning-live.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));}
})().catch(e=>{console.error(e.message);process.exit(1);});
