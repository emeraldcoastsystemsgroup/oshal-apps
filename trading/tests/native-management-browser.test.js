/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Desktop/phone monitor and exact order-review acceptance over actual shipped routes and UI, synthetic owner/history/SQL and a counted broker double. No real order is sent.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {setup}=require('./support/native-management-host'),PKG=path.resolve(__dirname,'..');
const {chromium}=require(path.resolve(__dirname,'../../scripts/toolchain/node_modules/playwright'));
test('advanced individual order reviews retain exact account, cancellation and submitted-not-filled status on desktop/phone',async t=>{
 const h=await setup(t);h.accounts[0].positions=[];h.accounts[0].equity=1000;let activations=0;const original=h.ctx.intent;h.ctx.intent=async(name,input)=>{if(name==='trading.config')return{orderTickets:true,strategyMandates:true};if(name==='trading.orders.mandate.prepare')return{mandateId:'review-mandate',fingerprint:'exact-mandate',accountMasked:'…1234',status:'draft',terms:{...input,maxDailyTurnoverCents:input.capitalCents*2}};if(name==='trading.orders.mandate.activate'){activations++;return{mandateId:input.mandateId,status:'active',terms:{capitalCents:99000},expiresAtMs:Date.parse('2026-11-25T16:00:00Z')};}return original(name,input);};const styles=fs.readFileSync(path.join(PKG,'tools/trading.html'),'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
 for(const file of ['native-account-controls','native-portfolio','native-rebalance','native-management'])h.app.get('/'+file+'.js',(_req,res)=>res.type('js').send(fs.readFileSync(path.join(PKG,'tools/ui/'+file+'.js'),'utf8')));
 h.app.get('/boot.js',(_req,res)=>res.type('js').send(`const main=document.getElementById('main'),$=id=>document.getElementById(id),stale=()=>false;
 const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>'$'+Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 const jbody=(method,obj)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});
 const api=async(p,init)=>{const r=await fetch('/api/trading'+p,init),j=await r.json();if(!r.ok)throw Error(j.message||j.error);return j;};
 const paperScheduleRow=async()=>({status:'suspended',reason:'deny_tier',activation:{}});renderNativePortfolioView(1);`));
 h.app.get('/',(_req,res)=>{res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");res.send('<!doctype html><meta name="viewport" content="width=device-width"><style>'+styles+'</style><p>Named synthetic acceptance fixture; no brokerage I/O.</p><div id="main"></div><script src="/native-rebalance.js"></script><script src="/native-account-controls.js"></script><script src="/native-management.js"></script><script src="/native-portfolio.js"></script><script src="/boot.js"></script>');});
 const browser=await chromium.launch();t.after(()=>browser.close());
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await h.req('/watch',{runId:h.runId,confirm:true});await h.req('/watch/tick',{});
  const before=h.submitted();await page.goto(h.base);await page.getByText('Advanced individual order reviews',{exact:true}).click();await page.getByRole('heading',{name:'Individual order reviews',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Start strategy monitor',exact:true}).count(),0,'account selection stays on the account page');
  await page.getByRole('button',{name:'Review real order',exact:true}).first().click();const submit=page.getByRole('button',{name:'Submit this REAL order',exact:true});await submit.waitFor();
  const review=page.locator('[data-live-ticket]').filter({hasText:'REAL MONEY order review'});assert.match(await review.innerText(),/Synthetic account.*buy.*BIL/);assert.match(await review.innerText(),/one order, not an atomic basket/);
  page.once('dialog',d=>d.dismiss());await submit.click();assert.equal(h.submitted(),before);assert.equal(await submit.isEnabled(),true,'cancel leaves the exact review usable');
  page.once('dialog',d=>d.accept());await submit.click();await page.getByText(/Broker attempt status: submitted.*A submission is not a fill/).waitFor();assert.equal(h.submitted(),before+1);assert.equal(await submit.isEnabled(),false);
  assert.equal(await page.getByRole('button',{name:'Activate this REAL MONEY strategy',exact:true}).count(),0,'research cannot activate a different selected account');assert.equal(activations,0);
  assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no viewport overflow at '+width);await context.close();
 }
});
