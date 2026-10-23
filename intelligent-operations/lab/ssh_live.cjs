#!/usr/bin/env node
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | SSH acceptance on the installed lab in a real headless browser under the operator's native session: load the administrator-selected host, have the live analyst coach a host command, run it once on the pinned host with the person's own SSH key, and keep the record and a screenshot. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require(path.join(__dirname,'../../scripts/toolchain/node_modules/playwright'));
const state=path.join(os.homedir(),'.local/state/oshal-k8s'),install=JSON.parse(fs.readFileSync(path.join(state,'installation.json'),'utf8'));
if(install.context!=='kind-operations-lab'||install.namespace!=='oshal-install-lab')throw Error('Only the owned lab installation is accepted.');
const base='http://127.0.0.1:'+install.port;
async function call(p,body,token,method){const r=await fetch(base+p,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const t=await r.text();return t?JSON.parse(t):null;}
(async()=>{const token=(await call('/sessions',JSON.parse(fs.readFileSync(path.join(state,'admin-password.json'),'utf8'))))?.session;if(!token)throw Error('No session.');
 const receipt={kind:'ssh-host-command-acceptance',startedAt:new Date().toISOString(),kernel:install.image};const browser=await chromium.launch({headless:true,args:['--disable-gpu']});
 try{const page=await (await browser.newContext({viewport:{width:1360,height:1300},extraHTTPHeaders:{Authorization:'Bearer '+token}})).newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/api/intelligent-operations/app#commands');await page.getByText('Records refreshed',{exact:false}).waitFor({timeout:60000});
  await page.locator('#commands-tool').selectOption('ssh');await page.getByRole('button',{name:'Load selected hosts',exact:true}).click();await page.getByText('selected host(s)',{exact:false}).waitFor({timeout:30000});
  receipt.host=await page.locator('#commands-ssh-host').inputValue();
  await page.locator('#commands-goal').fill('How much disk space is free on this host? Read-only, please.');await page.getByRole('button',{name:'Ask the operations analyst',exact:true}).click();
  await page.locator('#commands-proposal pre').first().waitFor({timeout:240000});receipt.proposed=await page.locator('#commands-proposal pre').first().innerText();receipt.say=(await page.locator('#commands-proposal').innerText()).slice(0,1200);
  await page.getByRole('button',{name:'Run on the host',exact:true}).click();await page.getByText('Ran on '+receipt.host+' with your SSH key',{exact:false}).waitFor({timeout:90000});receipt.status=await page.locator('#commands-status').innerText();
  await page.locator('#commands-panel').screenshot({path:path.join(__dirname,'../deploy/evidence/ssh-host-command.png')});
  const record=(await call('/api/intelligent-operations/commands',null,token)).items[0];receipt.record={tool:record.tool,where:record.where,argv:record.argv,target:record.target,outcome:record.outcome,exitCode:record.exitCode,output:record.output.slice(0,800),provenance:record.provenance};
  receipt.pageErrors=errors;receipt.result=record.where==='ssh-connection'&&record.outcome==='completed'&&!errors.length?'passed':'failed';
 }finally{await browser.close();await call('/sessions',null,token,'DELETE').catch(()=>{});receipt.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(__dirname,'../deploy/evidence/ssh-host-command.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));}
})().catch(e=>{console.error(e.message);process.exit(1);});
