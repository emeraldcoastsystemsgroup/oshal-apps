/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Actual account renderer and owner routes on desktop/phone: exact deep links, model-versus-broker stop status, research, pending funding and zero brokerage writes.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {binding}=require('./support/native-management-host');
const {protectionFixture}=require('./support/native-protection-host');
const {sessionDates}=require('../routes/trading-portfolio-calendar');
const {chromium}=require(path.resolve(__dirname,'../../scripts/toolchain/node_modules/playwright'));
test('per-account pages preserve owner binding, research, backstop honesty and expected-funding separation on desktop/phone',async t=>{
 const h=await protectionFixture(t),original=h.ctx.intent,dates=sessionDates('2025-01-02','2026-10-23');let allocationEffective='expired';
 h.ctx.intent=async(name,input)=>{
  if(name==='trading.orders.mandate.status')return{mandateId:input.mandateId,status:'active',effectiveStatus:allocationEffective,expiresAtMs:Date.parse(allocationEffective==='expired'?'2026-10-25T16:00:00Z':'2026-11-25T16:00:00Z')};
  return name==='trading.bars'?{source:'schwab',symbol:input.symbol,bars:dates.map((d,i)=>({t:Date.parse(d+'T05:00:00Z')/1000,o:100+i/10,h:101+i/10,l:99+i/10,c:100+i/10}))}:original(name,input);
 };
 const styles=fs.readFileSync(path.join(__dirname,'../tools/trading.html'),'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
 for(const file of ['view-accounts','native-account-management','native-protection-controls'])h.app.get('/'+file+'.js',(_req,res)=>res.type('js').send(fs.readFileSync(path.join(__dirname,'../tools/ui/'+file+'.js'),'utf8')));
 h.app.get('/boot.js',(_req,res)=>res.type('js').send(`const main=document.getElementById('main'),$=id=>document.getElementById(id);let RENDER_TOKEN=1;const stale=t=>t!==RENDER_TOKEN;
 const money=v=>'$'+Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const jbody=(method,obj)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});
 const api=async(p,init)=>{if(init?.body)init={...init,body:JSON.stringify({...JSON.parse(init.body),book:'paper',mode:'paper'})};const r=await fetch('/api/trading'+p,init),j=await r.json();if(!r.ok)throw Error(j.message||j.error);return j;};
 const paperScheduleRow=async()=>({status:'active',activation:{},nextRunAt:'2026-10-27T13:00:00Z'});
 const navigate=()=>{clearNativeAccountAddress();main.innerHTML='<p>All accounts</p>';};
 const models=[{...${JSON.stringify(h.accounts[0])},nativeReadOnly:true,state:'ok',label:'Synthetic account'}];
 if(!showFocusedNativeAccount(models))nativeAccountView(models[0]);`));
 h.app.get('/',(_req,res)=>{res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");res.send('<!doctype html><meta name="viewport" content="width=device-width"><style>'+styles+'</style><div id="main"></div><script src="/view-accounts.js"></script><script src="/native-protection-controls.js"></script><script src="/native-account-management.js"></script><script src="/boot.js"></script>');});
 const browser=await chromium.launch();t.after(()=>browser.close());
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(h.base+'/?view=accounts&account=a&connection=owned-login');await page.getByRole('heading',{name:'Account strategy & management',exact:true}).waitFor();
  assert.match(await page.locator('#nativeAccountManagement').innerText(),/Monthly model/);assert.match(await page.locator('#nativeAccountManagement').innerText(),/Real-order authority: NOT ENABLED/);
  assert.match(await page.locator('#nativeAccountManagement').innerText(),/Watcher schedule: active/);
  const watched=[...h.records.values()].find(r=>r.kind==='watch'),savedWatch=watched.payload;
  watched.payload=JSON.stringify({...JSON.parse(savedWatch),automatedTrading:true,mandateId:'synthetic-allocation'});
  for(const effective of ['expired','source-changed','active']){
   allocationEffective=effective;
   await page.getByRole('button',{name:'Refresh this account',exact:true}).click();
   await page.getByText('Real-order authority: '+(effective==='active'?'ENABLED':'NOT ACTIVE ('+effective+')'),{exact:true}).waitFor();
  }
  watched.payload=savedWatch;
  await page.getByRole('button',{name:'Refresh this account',exact:true}).click();
  await page.getByText('Real-order authority: NOT ENABLED',{exact:true}).waitFor();
  if(await page.getByRole('button',{name:'Enable backstop tracking',exact:true}).count())await page.getByRole('button',{name:'Enable backstop tracking',exact:true}).click();
  await page.getByRole('button',{name:'Check position backstops',exact:true}).click();await page.getByText('model-watching',{exact:true}).waitFor();
  assert.match(await page.locator('#nativeAccountManagement').innerText(),/Model tracking does not place broker stops/);assert.match(await page.locator('#nativeAccountManagement').innerText(),/\$90\.00/);
  await page.locator('[data-native-funding]').fill('80000');await page.getByRole('button',{name:'Save expected funding',exact:true}).click();await page.getByText(/\$80,000.00 expected; destination account not assigned/).waitFor();assert.equal(h.accounts[0].cash,1000);
  await page.getByRole('button',{name:'Run backstop comparison',exact:true}).click();await page.getByRole('heading',{name:'ABC · retained backstop study',exact:true}).waitFor();assert.match(await page.locator('[data-native-study]').innerText(),/Training.*later/);
  await page.getByRole('button',{name:'Review real-money protection',exact:true}).click();
  await page.getByRole('button',{name:'Activate REAL MONEY protective stops',exact:true}).waitFor();
  const reviewText=await page.locator('[data-native-protection-review]').innerText();
  assert.match(reviewText,/Exact trail research · ABC/);assert.match(reviewText,/training/);assert.match(reviewText,/later/);
  assert.match(reviewText,/Modeled costs on \$10,000/i);assert.match(reviewText,/does not test a combined allocation/);
  await page.getByRole('heading',{name:'Review protection · Synthetic account',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:'/tmp/oshal-native-protection-review-'+width+'.png'});
  assert.equal(h.policy().status,'draft');assert.equal(h.effects.length,0);
  page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Activate REAL MONEY protective stops',exact:true}).click();
  assert.equal(h.policy().status,'draft');assert.equal(h.effects.length,0,'cancelled personal approval has no broker effect');
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Activate REAL MONEY protective stops',exact:true}).click();
  await page.getByText(/Protective authority: ACTIVE/).waitFor();assert.equal(h.effects.length,0,'activation alone submits no synthetic order');
  await page.getByRole('button',{name:'Stop future protection submissions',exact:true}).click();await page.getByText(/Protective authority: STOPPED/).waitFor();
  assert.equal(h.submitted(),0);assert.equal(h.canceled(),0);assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'account page fits width'+width);
  await page.reload();await page.getByRole('heading',{name:'Account strategy & management',exact:true}).waitFor();assert.match(page.url(),/account=a/);
  await page.goto(h.base+'/?view=accounts&account=a&connection=foreign-login');await page.getByRole('heading',{name:'Account page unavailable',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Account strategy & management',exact:true}).count(),0);
  await context.close();
 }
});
