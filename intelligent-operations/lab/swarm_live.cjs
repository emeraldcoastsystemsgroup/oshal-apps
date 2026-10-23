#!/usr/bin/env node
/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Take the evidence screenshot before issuing a token, so a once-shown token never lands in evidence. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Swarm hand-off acceptance on the installed lab: a real headless browser under the operator's native session opens Swarm hand-off, inspects a delegation that a peer token delivered to the kernel inbox, files it as an investigation and records the canonical ticket it started; issues and revokes a peer token from the page. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require(path.join(__dirname,'../../scripts/toolchain/node_modules/playwright'));
const state=path.join(os.homedir(),'.local/state/oshal-k8s'),install=JSON.parse(fs.readFileSync(path.join(state,'installation.json'),'utf8'));
if(install.context!=='kind-operations-lab'||install.namespace!=='oshal-install-lab')throw Error('Only the owned lab installation is accepted.');
const base='http://127.0.0.1:'+install.port;
async function call(p,body,token,method,extra={}){const r=await fetch(base+p,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...extra},body:body?JSON.stringify(body):undefined});const t=await r.text();return {status:r.status,body:t?JSON.parse(t):null};}
(async()=>{const token=(await call('/sessions',JSON.parse(fs.readFileSync(path.join(state,'admin-password.json'),'utf8')))).body?.session;if(!token)throw Error('No session.');
 const receipt={kind:'swarm-hand-off-acceptance',startedAt:new Date().toISOString(),kernel:install.image};
 const browser=await chromium.launch({headless:true,args:['--disable-gpu']});
 try{const page=await (await browser.newContext({viewport:{width:1360,height:1300},extraHTTPHeaders:{Authorization:'Bearer '+token}})).newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/api/intelligent-operations/app#swarms');await page.getByText('delegation(s) in your inbox',{exact:false}).waitFor({timeout:60000});
  receipt.status=await page.locator('#swarms-status').textContent();
  await page.getByRole('button',{name:'Inspect',exact:true}).first().click();await page.locator('#swarms-detail').getByText('Everything below is data another swarm sent',{exact:false}).waitFor({timeout:30000});
  await page.getByRole('button',{name:'File as investigation',exact:true}).first().click();await page.getByText('Filed',{exact:false}).first().waitFor({timeout:60000});receipt.filed=await page.locator('#swarms-status').textContent();
  // The screenshot is taken before a token is issued: a once-shown token never goes into evidence.
  await page.locator('#swarms-panel').screenshot({path:path.join(__dirname,'../deploy/evidence/swarm-hand-off.png')});
  await page.locator('#swarms-token-label').fill('Swarm acceptance peer');await page.getByRole('button',{name:'Issue peer token',exact:true}).click();await page.getByText('It is not shown again',{exact:false}).waitFor({timeout:30000});
  const listed=await call('/api/v1/peer-tokens',null,token);const mine=listed.body.peerTokens.find(t=>t.label==='Swarm acceptance peer');
  if(mine){const confirm=(await call('/confirmations',{},token)).body.confirmation;receipt.revoke=(await call('/api/v1/peer-tokens/'+mine.tokenId,null,token,'DELETE',{'x-oshal-confirm':confirm})).status;}
  const records=(await call('/api/intelligent-operations/delegations',null,token)).body;const inbound=records.items.find(r=>r.direction==='inbound');
  receipt.inbound=inbound&&{state:inbound.state,ticketId:inbound.ticketId,sender:inbound.sender,error:inbound.error||null};
  if(inbound?.ticketId){const t=await call('/api/tickets/'+inbound.ticketId,null,token);receipt.ticketStatus=t.body?.status??t.body?.ticket?.status??t.status;}
  receipt.pageErrors=errors;receipt.result=inbound&&['started','queued'].includes(inbound.state)&&!errors.length?'passed':'failed';
 }finally{await browser.close();await call('/sessions',null,token,'DELETE').catch(()=>{});receipt.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(__dirname,'../deploy/evidence/swarm-hand-off.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));}
})().catch(e=>{console.error(e.message);process.exit(1);});
