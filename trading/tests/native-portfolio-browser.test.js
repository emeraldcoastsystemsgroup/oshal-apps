/** CHANGE LOG
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Exercise both monthly presets on desktop and phone; fixed fields and saved research do not assign or arm an account.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Show broker facts and distinct cash labels on desktop/phone without treating withdrawal capacity as settled cash.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Include the shipped planning companion script in the native portfolio component host.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Desktop/phone acceptance of the shipped portfolio renderer over actual routes and owner-aware synthetic provider/storage fixtures. Save, classify, backtest, inspect evidence, and confirm a research-only review.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {application}=require('./support/native-portfolio-host');
const PKG=path.resolve(__dirname,'..');
const TOOLCHAIN=path.resolve(process.env.STORE_CI_TOOLCHAIN || (process.env.OSHAL_FRAMEWORK ? path.join(process.env.OSHAL_FRAMEWORK,'node_modules') : path.resolve(PKG,'../scripts/toolchain/node_modules')));
const {chromium}=require(path.join(TOOLCHAIN,'playwright'));
const ui=fs.readFileSync(path.join(__dirname,'../tools/ui/native-portfolio.js'),'utf8');
const shell=fs.readFileSync(path.join(__dirname,'../tools/trading.html'),'utf8');
const styles=shell.match(/<style>([\s\S]*?)<\/style>/)[1];
test('portfolio workflow works on desktop and phone with exact receipts and no real trade controls',async t=>{
 const fixture=application(),app=fixture.app;
 app.get('/rebalance.js',(_req,res)=>res.type('js').send(fs.readFileSync(path.join(PKG,'tools/ui/native-rebalance.js'),'utf8')));
 app.get('/management.js',(_req,res)=>res.type('js').send(fs.readFileSync(path.join(PKG,'tools/ui/native-management.js'),'utf8')));
 app.get('/portfolio.js',(_req,res)=>res.type('js').send(ui));
 app.get('/boot.js',(_req,res)=>res.type('js').send(`
 const main=document.getElementById('main');const $=id=>document.getElementById(id);const stale=()=>false;
 const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>'$'+Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 const jbody=(method,obj)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});
 const paperScheduleRow=async()=>null;
 const api=async(p,init)=>{const r=await fetch('/api/trading'+p,init),j=await r.json();if(!r.ok)throw Error(j.message||j.error);return j;};
 renderNativePortfolioView(1);
 `));
 app.get('/',(_req,res)=>{res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");res.send('<!doctype html><meta name="viewport" content="width=device-width"><style>'+styles+'</style><div id="main"></div><script src="/rebalance.js"></script><script src="/management.js"></script><script src="/portfolio.js"></script><script src="/boot.js"></script>');});
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const browser=await chromium.launch();t.after(()=>browser.close());
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-10-26T12:00:00Z'));
  delete fixture.accounts[0].balanceFacts;
  await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.getByRole('heading',{name:'Saved strategies',exact:true}).waitFor();
  assert.equal(await page.locator('form[data-portfolio=backtest] [name=endDate]').inputValue(),'2026-10-23','Monday browser default uses the server-completed Friday session');
  assert.match(await page.locator('#main').innerText(),/1 outside watchlist/);assert.match(await page.locator('#main').innerText(),/Broker debit balance Unknown/);
  fixture.accounts[0].balanceFacts={buyingPower:0,debitBalance:0,maintenanceRequirement:1200,cashAvailableForWithdrawal:700,cashAvailableForTrading:900,unsettledCash:300,marginBalance:-500,accruedInterest:12.5,marginEquity:2500,equityPercentage:25};
  await page.getByRole('button',{name:'Refresh evidence',exact:true}).click();await page.getByText(/Broker buying power \$0\.00/).waitFor();
  const funding=await page.locator('[data-portfolio-account-funding]').first().innerText();assert.match(funding,/Broker debit balance \$0\.00/);assert.match(funding,/Current maintenance \$1,200\.00/);assert.match(funding,/Withdrawable cash \$700\.00/);assert.match(funding,/Unsettled cash \$300\.00/);assert.match(funding,/Settled cash Unknown/);
  assert.match(funding,/Signed margin balance \$-500\.00/);assert.match(funding,/Broker accrued interest \$12\.50/);assert.match(funding,/Margin equity \$2,500\.00/);assert.match(funding,/Broker equity percentage 25\.00%/);
  const profile=page.locator('form[data-portfolio="profile"]').first();await profile.locator('[name=registration]').selectOption('401k');await profile.getByRole('button').click();await page.getByText(/Saved\. No broker/).waitFor();
  assert.match(await page.locator('#main').innerText(),/Retirement capital is modeled without borrowing/);
  const strategy=page.locator('form[data-portfolio="strategy"]');await strategy.locator('[name=name]').fill('Browser allocation '+width);await strategy.locator('[name=assets]').fill('ABC:100');await strategy.getByRole('button').click();await page.getByText(/Saved\. No broker/).waitFor();
  const backtest=page.locator('form[data-portfolio="backtest"]');await backtest.locator('[name=strategyId]').selectOption({label:'Browser allocation '+width});await backtest.locator('[name=startDate]').fill('2026-01-02');await backtest.locator('[name=endDate]').fill('2026-10-23');await backtest.getByRole('button').click();await page.locator('#portfolioRunDetail svg').waitFor();
  assert.match(await page.locator('#portfolioRunDetail').innerText(),/fresh cash allocation/);
  assert.match(await page.locator('#portfolioRunDetail').innerText(),/dividends.*excluded/);
  const reviewResponse=page.waitForResponse(r=>r.url().endsWith('/portfolio/reviews')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Prepare research review'}).first().click();const review=(await (await reviewResponse).json()).review;
  const reviewCard=page.locator('[data-portfolio-review="'+review.id+'"]');await reviewCard.getByRole('button',{name:'Approve this research envelope…'}).waitFor();
  assert.match(await page.locator('#main').innerText(),/Strategy: Browser allocation/);assert.match(await page.locator('#main').innerText(),/Historical window 2026-01-02 to 2026-10-23/);
  page.once('dialog',d=>d.accept());await reviewCard.getByRole('button',{name:'Approve this research envelope…'}).click();await reviewCard.getByText('research-approved',{exact:false}).waitFor();
  for(const [button,kind,top,count] of [['Load defensive retirement candidate','monthly-trend',5,5],['Load active rotation candidate','quarterly-rotation',3,6]]){
   await page.getByRole('button',{name:button,exact:true}).click();const f=page.locator('form[data-portfolio="strategy"]');
   assert.equal(await f.locator('[name=kind]').inputValue(),kind);assert.equal(await f.locator('[name=rebalanceSessions]').isDisabled(),true);assert.equal(await f.locator('[name=grossExposurePct]').isDisabled(),true);
   const saved=page.waitForResponse(r=>r.url().endsWith('/portfolio/strategies')&&r.request().method()==='POST');await f.getByRole('button').click();const response=await saved;assert.equal(response.status(),200);const payload=response.request().postDataJSON();assert.equal(payload.config.modelVersion,2);assert.equal(payload.config.topN,top);assert.equal(payload.config.assets.length,count);assert.equal(payload.config.grossExposurePct,100);
   await page.getByText(/Saved\. No broker/).waitFor();
  }
  assert.equal(fixture.accounts[0].strategyId,undefined,'presets do not change the broker account');
  assert.equal(await page.getByRole('button',{name:/Place order|Start trading|Borrow now/i}).count(),0);
  fixture.setSourceFailure(true);await page.getByRole('button',{name:'Refresh evidence',exact:true}).click();await page.getByText(/partial account balances/).waitFor();
  assert.match(await page.locator('#main').innerText(),/Coverage is incomplete or stale/);fixture.setSourceFailure(false);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow at '+width);assert.deepEqual(errors,[]);await context.close();
 }
});
