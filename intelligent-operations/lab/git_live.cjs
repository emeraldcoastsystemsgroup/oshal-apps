#!/usr/bin/env node
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Live Git explorer and provisioning promotion on the installed lab, in a real headless browser under the operator's native session and their own saved GitHub connection: list repositories, open the demo GitOps repository, link the lab cluster to it, render a team namespace and promote it through the linked repository (branch, pull request, validate workflow), and keep the request link and a screenshot. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require(path.join(__dirname,'../../scripts/toolchain/node_modules/playwright'));
const state=path.join(os.homedir(),'.local/state/oshal-k8s'),install=JSON.parse(fs.readFileSync(path.join(state,'installation.json'),'utf8'));
if(install.context!=='kind-operations-lab'||install.namespace!=='oshal-install-lab')throw Error('Only the owned lab installation is accepted.');
const base='http://127.0.0.1:'+install.port,REPO=process.argv[2]||'emeraldcoastsystemsgroup/triagenorth-provisioning-demo';
async function call(p,body,token,method){const r=await fetch(base+p,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const t=await r.text();return t?JSON.parse(t):null;}
(async()=>{const token=(await call('/sessions',JSON.parse(fs.readFileSync(path.join(state,'admin-password.json'),'utf8'))))?.session;if(!token)throw Error('No session.');
 const receipt={kind:'git-explorer-and-provisioning-promotion-acceptance',startedAt:new Date().toISOString(),kernel:install.image,repository:REPO};const browser=await chromium.launch({headless:true,args:['--disable-gpu']});
 try{const page=await (await browser.newContext({viewport:{width:1360,height:1400},extraHTTPHeaders:{Authorization:'Bearer '+token}})).newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/api/intelligent-operations/app#git');await page.getByText('Load your repositories to browse them',{exact:false}).waitFor({timeout:60000});
  await page.getByRole('button',{name:'Load my repositories',exact:true}).click();await page.getByText(/repositories you can reach|HTTP/).first().waitFor({timeout:90000});receipt.repositories=await page.locator('#git-status').innerText();
  await page.locator('#git-filter').fill(REPO.split('/')[1]);await page.locator('#git-repos .git-repo').filter({hasText:REPO}).first().click();
  const detail=page.locator('#git-repo-detail');await detail.getByText(/Files on /).waitFor({timeout:90000});receipt.files=await detail.getByText(/Files on /).innerText();receipt.branches=await detail.getByText(/Branches · /).innerText();
  await detail.locator('section.git-link input').first().fill('clusters/operations-lab');await detail.getByRole('button',{name:'Link this repository to the cluster',exact:true}).click();await page.getByText(/Linked .* to /).waitFor({timeout:30000});receipt.link=await page.locator('#git-status').innerText();
  await page.locator('#git-panel,#git-explorer').first().screenshot({path:path.join(__dirname,'../deploy/evidence/git-explorer.png')});
  await page.goto(base+'/api/intelligent-operations/app#provision');await page.getByText('provisioning request(s)',{exact:false}).waitFor({timeout:60000});
  await page.locator('#provision-template').selectOption('team-namespace');await page.locator('#provision-name').fill('payments-live');await page.locator('#provision-team').fill('payments');await page.locator('#provision-reason').fill('Live Git promotion acceptance');await page.getByRole('button',{name:'Render manifests',exact:true}).click();await page.getByText('Rendered 5 manifests',{exact:false}).waitFor({timeout:60000});
  const card=page.locator('#provision-list article.card').filter({hasText:'payments-live'}).first(),panel=card.locator('.git-promotion');await panel.locator('summary').click();
  await panel.getByLabel('Linked repository').selectOption({index:1});await panel.getByLabel('GitHub workflow').fill('validate.yml');await panel.getByLabel('Start the pipeline on the new branch').check();
  await panel.getByRole('button',{name:'Commit, open request',exact:true}).click();await panel.locator('h5').first().waitFor({timeout:120000});receipt.promotion=(await panel.locator('article.card').first().innerText()).slice(0,600);receipt.status=await panel.locator('[role=status]').innerText();
  await card.screenshot({path:path.join(__dirname,'../deploy/evidence/git-promotion-live.png')});
  receipt.pageErrors=errors;receipt.result=/github\.com\/.*\/pull\/\d+/.test(receipt.promotion+receipt.status)&&!errors.length?'passed':'failed';
 }finally{await browser.close();await call('/sessions',null,token,'DELETE').catch(()=>{});receipt.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(__dirname,'../deploy/evidence/git-live.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));}
})().catch(e=>{console.error(e.message);process.exit(1);});
