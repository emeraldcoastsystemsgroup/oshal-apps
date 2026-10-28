/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Desktop/phone planning acceptance over the actual native portfolio/rebalance renderers and routes. Named synthetic broker/owner/SQL fixtures prove exact quantity review, mandatory exceptions, persisted planning acknowledgement and hard missing-fact refusal without broker actions.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {application}=require('./support/native-portfolio-host'),PKG=path.resolve(__dirname,'..');
const TOOLCHAIN=path.resolve(process.env.STORE_CI_TOOLCHAIN||(process.env.OSHAL_FRAMEWORK?path.join(process.env.OSHAL_FRAMEWORK,'node_modules'):path.resolve(PKG,'../scripts/toolchain/node_modules')));
const {chromium}=require(path.join(TOOLCHAIN,'playwright'));
test('concrete planning previews require exact exception review and stay blocked when broker facts are absent',async t=>{
 const f=application(),app=f.app;f.accounts[0].balanceFacts={buyingPower:20000,debitBalance:0,maintenanceRequirement:2000};
 const styles=fs.readFileSync(path.join(PKG,'tools/trading.html'),'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
 for(const file of ['native-account-controls','native-portfolio','native-rebalance','native-management'])app.get('/'+file+'.js',(_req,res)=>res.type('js').send(fs.readFileSync(path.join(PKG,'tools/ui/'+file+'.js'),'utf8')));
 app.get('/boot.js',(_req,res)=>res.type('js').send(`const main=document.getElementById('main');const $=id=>document.getElementById(id);const stale=()=>false;
 const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>'$'+Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 const jbody=(method,obj)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});
 const paperScheduleRow=async()=>null;
 const api=async(p,init)=>{const r=await fetch('/api/trading'+p,init),j=await r.json();if(!r.ok)throw Error(j.message||j.error);return j;};renderNativePortfolioView(1);`));
 app.get('/',(_req,res)=>{res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");res.send('<!doctype html><meta name="viewport" content="width=device-width"><style>'+styles+'</style><div id="main"></div><script src="/native-rebalance.js"></script><script src="/native-account-controls.js"></script><script src="/native-management.js"></script><script src="/native-portfolio.js"></script><script src="/boot.js"></script>');});
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));const base='http://127.0.0.1:'+server.address().port;
 const request=async(path,body)=>{const r=await fetch(base+'/api/trading/portfolio'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
 await request('/profiles',{accountId:'a',connectionKey:'owned-login',registration:'taxable',label:'Owned account'});
 const {strategy}=await request('/strategies',{name:'Owned margin scenario',config:{modelVersion:1,kind:'allocation',assets:[{symbol:'ABC',weightPct:100}],lookbackSessions:20,rebalanceSessions:20,topN:1,grossExposurePct:150,transactionCostBps:10,marginAprPct:12,maintenancePct:30,fractionalShares:false}});
 await request('/backtest',{accountId:'a',connectionKey:'owned-login',strategyId:strategy.id,startDate:'2026-01-02',endDate:'2026-10-23'});
 const browser=await chromium.launch();t.after(()=>browser.close());
 for(const width of [1280,390]){
  f.accounts[0].balanceFacts={buyingPower:20000,debitBalance:0,maintenanceRequirement:2000};
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.locator('summary').filter({hasText:/^Buy\/sell planning previews$/}).click();await page.getByRole('button',{name:'Prepare buy/sell preview',exact:true}).waitFor();
  let response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/trading/portfolio/plans'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Prepare buy/sell preview',exact:true}).click();let plan=(await (await response).json()).plan;
  let card=page.locator('[data-plan-id="'+plan.id+'"]');await card.getByRole('button',{name:'Approve this planning preview…',exact:true}).waitFor();
  assert.match(await card.innerText(),/ABC[\s\S]*buy/);assert.match(await card.innerText(),/Modeled increase/);assert.match(await card.innerText(),/Planning-cap exceptions/);
  await card.getByRole('button',{name:'Approve this planning preview…',exact:true}).click();await page.getByText('Review and acknowledge the exact planning-cap exceptions first.').waitFor();
  await card.locator('[data-plan-exceptions]').check();page.once('dialog',d=>d.accept());await card.getByRole('button',{name:'Approve this planning preview…',exact:true}).click();await card.getByText('planning-approved',{exact:false}).waitFor();
  await page.reload();await page.locator('summary').filter({hasText:/^Buy\/sell planning previews$/}).click();await page.locator('[data-plan-id="'+plan.id+'"] h3').getByText('planning-approved',{exact:false}).waitFor();
  delete f.accounts[0].balanceFacts;
  response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/trading/portfolio/plans'&&r.request().method()==='POST');await page.getByRole('button',{name:'Prepare buy/sell preview',exact:true}).click();plan=(await (await response).json()).plan;card=page.locator('[data-plan-id="'+plan.id+'"]');await card.getByText(/Measured provider buying power is unavailable/).waitFor();
  assert.equal(await card.getByRole('button',{name:'Approve this planning preview…',exact:true}).count(),0);assert.match(await card.innerText(),/Broker debit balance and current maintenance requirement must be measured/);
  assert.equal(await page.getByRole('button',{name:/Execute|Place order|Borrow now|Increase live limit/i}).count(),0);assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no viewport overflow at '+width);
  await context.close();
 }
 assert.ok(f.calls.filter(c=>c.intent).every(c=>['trading.config','trading.accounts','trading.bars','trading.quotes'].includes(c.intent)));
});
