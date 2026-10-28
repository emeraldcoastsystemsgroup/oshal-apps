/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Verify visible control contrast and account/schedule hierarchy in both themes and phone layouts, retaining financial confirmation guards.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Actual account renderer and owner routes on desktop/phone: exact deep links, model-versus-broker stop status, research, pending funding and zero brokerage writes.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {binding}=require('./support/native-management-host');
const {protectionFixture}=require('./support/native-protection-host');
const {allocationFixture}=require('./support/native-allocation-host');
async function expand(page,name){const summary=page.getByText(name,{exact:true});if(!await summary.evaluate(el=>el.parentElement.open))await summary.click();}
const {sessionDates}=require('../routes/trading-portfolio-calendar');
const {chromium}=require(path.resolve(__dirname,'../../scripts/toolchain/node_modules/playwright'));
test('per-account pages preserve owner binding, research, backstop honesty and expected-funding separation on desktop/phone',async t=>{
 const h=await protectionFixture(t),original=h.ctx.intent,dates=sessionDates('2024-01-02','2026-10-23');let allocationEffective='expired';
 h.ctx.intent=async(name,input)=>{
  if(name==='trading.orders.mandate.status')return{mandateId:input.mandateId,status:'active',effectiveStatus:allocationEffective,expiresAtMs:Date.parse(allocationEffective==='expired'?'2026-10-25T16:00:00Z':'2026-11-25T16:00:00Z')};
  return name==='trading.bars'?{source:'schwab',symbol:input.symbol,bars:dates.map((d,i)=>({t:Date.parse(d+'T05:00:00Z')/1000,o:100+i/10,h:101+i/10,l:99+i/10,c:100+i/10}))}:original(name,input);
 };
 const styles=fs.readFileSync(path.join(__dirname,'../tools/trading.html'),'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
 for(const file of ['native-account-controls','view-accounts','native-account-management','native-protection-controls'])h.app.get('/'+file+'.js',(_req,res)=>res.type('js').send(fs.readFileSync(path.join(__dirname,'../tools/ui/'+file+'.js'),'utf8')));
 h.app.get('/boot.js',(_req,res)=>res.type('js').send(`const main=document.getElementById('main'),$=id=>document.getElementById(id);let RENDER_TOKEN=1;const stale=t=>t!==RENDER_TOKEN;
 const money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v);
 const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const jbody=(method,obj)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});
 const api=async(p,init)=>{if(init?.body)init={...init,body:JSON.stringify({...JSON.parse(init.body),book:'paper',mode:'paper'})};const r=await fetch('/api/trading'+p,init),j=await r.json();if(!r.ok)throw Error(j.message||j.error);return j;};
 const paperScheduleRow=async()=>({status:'active',activation:{},nextRunAt:'2026-10-27T13:00:00Z'});
 const navigate=()=>{clearNativeAccountAddress();main.innerHTML='<p>All accounts</p>';};
 const models=[{...${JSON.stringify(h.accounts[0])},nativeReadOnly:true,state:'ok',label:'Synthetic account'}];
 if(!showFocusedNativeAccount(models))nativeAccountView(models[0]);`));
 h.app.get('/',(_req,res)=>{res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");res.send('<!doctype html><meta name="viewport" content="width=device-width"><style>'+styles+'</style><div id="main"></div><script src="/view-accounts.js"></script><script src="/native-protection-controls.js"></script><script src="/native-account-controls.js"></script><script src="/native-account-management.js"></script><script src="/boot.js"></script>');});
 const browser=await chromium.launch();t.after(()=>browser.close());
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(h.base+'/?view=accounts&account=a&connection=owned-login');await page.getByRole('heading',{name:'Trading strategy',exact:true}).waitFor();
  assert.match(await page.locator('#nativeAccountManagement').innerText(),/Monthly model/);assert.match(await page.locator('#nativeAccountManagement').innerText(),/Live trading: Inactive/);
  assert.match(await page.locator('#nativeAccountManagement').innerText(),/Watcher schedule is active/);
  const boundary=await page.locator('[data-native-account-strategy]').evaluate(el=>({background:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderColor,height:el.getBoundingClientRect().height}));assert.notEqual(boundary.background,'rgba(0, 0, 0, 0)','missing theme assets still leave a visible field');assert.notEqual(boundary.border,boundary.background);assert.ok(boundary.height>=42);
  const summaryBox=await page.locator('.native-account-summary').boundingBox(),scheduleBox=await page.locator('.native-schedule-bar').boundingBox(),cardBox=await page.locator('.native-management-panel').first().boundingBox();assert.ok(summaryBox.y+summaryBox.height<=scheduleBox.y+1);assert.ok(scheduleBox.y+scheduleBox.height<=cardBox.y+1,'shared schedule is visible before both control cards');
  const watched=[...h.records.values()].find(r=>r.kind==='watch'),savedWatch=watched.payload;
  watched.payload=JSON.stringify({...JSON.parse(savedWatch),automatedTrading:true,mandateId:'synthetic-allocation'});
  for(const effective of ['expired','source-changed','active']){
   allocationEffective=effective;
   await page.getByRole('button',{name:'Refresh this account',exact:true}).click();
   await page.getByText('Live trading: '+(effective==='active'?'Active':'Needs review · '+effective),{exact:true}).waitFor();
  }
  watched.payload=savedWatch;
  await page.getByRole('button',{name:'Refresh this account',exact:true}).click();
  await page.getByText('Live trading: Inactive',{exact:true}).waitFor();
  await expand(page,'Position floors & stop research');
  if(await page.getByRole('button',{name:'Enable backstop tracking',exact:true}).count()){await page.getByRole('button',{name:'Enable backstop tracking',exact:true}).click();await page.getByRole('button',{name:'Enable backstop tracking',exact:true}).waitFor({state:'detached'});}
  await page.locator('details').filter({has:page.getByText('Position floors & stop research',{exact:true})}).evaluate(el=>{el.open=true;});
  await page.getByRole('button',{name:'Check position backstops',exact:true}).click();await page.getByText('model-watching',{exact:true}).waitFor();
  assert.match(await page.locator('#nativeAccountManagement').innerText(),/Model tracking does not place broker stops/);assert.match(await page.locator('#nativeAccountManagement').innerText(),/\$90\.00/);
  await expand(page,'Expected incoming funds');
  await page.locator('[data-native-funding]').fill('80000');await page.getByRole('button',{name:'Save expected funding',exact:true}).click();await page.getByText(/\$80,000.00 expected; destination account not assigned/).waitFor();assert.equal(h.accounts[0].cash,1000);
  await expand(page,'Position floors & stop research');
  await page.getByRole('button',{name:'Run backstop comparison',exact:true}).click();await page.getByRole('heading',{name:'ABC · retained backstop study',exact:true}).waitFor();assert.match(await page.locator('[data-native-study]').innerText(),/Training.*later/);
  await expand(page,'Strategy research & backtests');
  await page.getByLabel('Study end date',{exact:true}).fill('2026-10-22');
  await page.getByRole('button',{name:'Compare strategy with moving stops',exact:true}).click();
  await page.getByRole('heading',{name:'Retained combined study · Monthly model',exact:true}).waitFor();
  const combinedText=await page.locator('[data-native-combined-panel]').innerText();
  assert.match(combinedText,/later sessions carry forward/i);assert.match(combinedText,/Allocation only/);assert.match(combinedText,/DIA buy & hold/);
  assert.match(combinedText,/does not reconstruct the current legacy holdings or margin loan/);assert.match(combinedText,/no untouched holdout/);assert.match(combinedText,/Requested study end 2026-10-22/);assert.match(combinedText,/latest completed session at read 2026-10-23/);
  assert.equal(h.effects.length,0);
  await page.getByRole('heading',{name:'Strategy + moving backstops',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:'/tmp/oshal-combined-study-'+width+'.png'});
  await page.getByRole('button',{name:'Review broker stops',exact:true}).click();
  await page.getByRole('button',{name:'Activate broker stops',exact:true}).waitFor();
  await page.reload();await page.getByRole('button',{name:'Activate broker stops',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Activate broker stops',exact:true}).isEnabled(),true,'protective draft survives reload');
  const reviewText=await page.locator('[data-native-protection-review]').innerText();
  assert.match(reviewText,/Exact trail research · ABC/);assert.match(reviewText,/training/);assert.match(reviewText,/later/);
  assert.match(reviewText,/Modeled costs on \$10,000/i);assert.match(reviewText,/does not test a combined allocation/);
  await page.getByRole('heading',{name:'Review protection · Synthetic account',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:'/tmp/oshal-native-protection-review-'+width+'.png'});
  assert.equal(h.policy().status,'draft');assert.equal(h.effects.length,0);
  page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Activate broker stops',exact:true}).click();
  assert.equal(h.policy().status,'draft');assert.equal(h.effects.length,0,'cancelled personal approval has no broker effect');
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Activate broker stops',exact:true}).click();
  await page.getByText(/Broker stops are active/).waitFor();assert.equal(h.effects.length,0,'activation alone submits no synthetic order');
  await page.getByRole('button',{name:'Deactivate broker stops',exact:true}).click();await page.getByText(/Review broker stops/).waitFor();
  assert.equal(h.submitted(),0);assert.equal(h.canceled(),0);assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'account page fits width'+width);
  await page.reload();await page.getByRole('heading',{name:'Trading strategy',exact:true}).waitFor();assert.match(page.url(),/account=a/);
  await page.goto(h.base+'/?view=accounts&account=a&connection=foreign-login');await page.getByRole('heading',{name:'Account page unavailable',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Trading strategy',exact:true}).count(),0);
  await context.close();
 }
});
test('whole-account strategy is reviewed and personally activated on the account page on desktop and phone',async t=>{
 const h=await allocationFixture(t,{whole:true,positions:[{symbol:'ABC',qty:10.25,marketValue:1025,unmanaged:true}],cash:0,equity:625,capitalCents:60000,balanceFacts:{marginBalance:-400,debitBalance:null,maintenanceRequirement:250}});
 const styles=fs.readFileSync(path.join(__dirname,'../tools/trading.html'),'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
 for(const file of ['native-account-controls','view-accounts','native-management','native-account-management','native-protection-controls'])h.app.get('/'+file+'.js',(_req,res)=>res.type('js').send(fs.readFileSync(path.join(__dirname,'../tools/ui/'+file+'.js'),'utf8')));
 h.app.get('/boot.js',(_req,res)=>res.type('js').send(`const main=document.getElementById('main'),$=id=>document.getElementById(id);let RENDER_TOKEN=1;const stale=t=>t!==RENDER_TOKEN;
 const money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v);
 const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const jbody=(method,obj)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});
 const api=async(p,init)=>{const r=await fetch('/api/trading'+p,init),j=await r.json();if(!r.ok)throw Error(j.message||j.error);return j;};
 const paperScheduleRow=async()=>({status:'active',nextRunAt:'2026-10-27T13:00:00Z'}),navigate=()=>{};
 nativeAccountView({...${JSON.stringify(h.accounts[0])},nativeReadOnly:true,state:'ok',label:'Synthetic account'});`));
 h.app.get('/',(_req,res)=>{res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");res.send('<!doctype html><html data-theme="'+( _req.query.theme==='midnight'?'midnight':'daylight')+'"><meta name="viewport" content="width=device-width"><style>[data-theme=daylight]{--bg-primary:#f0f2f8;--bg-secondary:#ffffff;--bg-tertiary:#f4f5fa;--border-color:#dce0eb;--text-primary:#1a1a2e;--text-secondary:#5b6475;--accent-primary:#5b54d6}[data-theme=midnight]{--bg-primary:#101420;--bg-secondary:#1a2030;--bg-tertiary:#232c40;--border-color:#374059;--text-primary:#f0f3fa;--text-secondary:#a7b3c9;--accent-primary:#ad9aff}'+styles+'</style><main id="main"></main><script src="/view-accounts.js"></script><script src="/native-account-controls.js"></script><script src="/native-management.js"></script><script src="/native-protection-controls.js"></script><script src="/native-account-management.js"></script><script src="/boot.js"></script>');});
 h.app.get('/cockpit/',(req,res)=>res.type('html').send('<!doctype html><meta name="viewport" content="width=device-width"><body style="margin:0"><iframe title="Trading account" src="/?theme='+(req.query.theme==='midnight'?'midnight':'daylight')+'" style="width:100%;height:100vh;border:0"></iframe>'));
 const browser=await chromium.launch();t.after(()=>browser.close());
 for(const {width,embedded,theme} of [{width:1280,embedded:false,theme:'daylight'},{width:1280,embedded:true,theme:'midnight'},{width:390,embedded:true,theme:'daylight'}]){
  const context=await browser.newContext({viewport:{width,height:1000}}),shell=await context.newPage(),errors=[];shell.on('pageerror',e=>errors.push(e.message));
  const url=h.base+(embedded?'/cockpit/?theme=':'/?theme=')+theme;await shell.goto(url);
  if(embedded)await shell.frameLocator('iframe').getByRole('heading',{name:'Trading strategy',exact:true}).waitFor();
  let page=embedded?shell.frames().find(f=>f!==shell.mainFrame()):shell;
 await page.getByRole('button',{name:/^(Review & activate|Refresh activation review)$/}).waitFor();
  assert.equal(await page.locator('[data-native-strategy-scope]').inputValue(),'whole-account');await page.locator('[data-native-strategy-cap]').fill('600');
  await page.getByRole('button',{name:/^(Review & activate|Refresh activation review)$/}).click();await page.getByRole('heading',{name:'REAL MONEY strategy mandate',exact:true}).waitFor();
  await shell.reload();
  if(embedded)await shell.frameLocator('iframe').getByRole('heading',{name:'Trading strategy',exact:true}).waitFor();
  page=embedded?shell.frames().find(f=>f!==shell.mainFrame()):shell;
  await page.getByRole('button',{name:'Activate live trading',exact:true}).waitFor();
  assert.equal(await page.locator('[data-native-strategy-cap]').inputValue(),'600','reload preserves the reviewed cap, not an equity-derived replacement');
  assert.equal(await page.getByRole('button',{name:'Activate live trading',exact:true}).isEnabled(),true);
  const reopened=await context.newPage();await reopened.goto(url);
  const freshView=embedded?reopened.frameLocator('iframe'):reopened;
  await freshView.getByRole('button',{name:'Activate live trading',exact:true}).waitFor();
  assert.equal(await freshView.locator('[data-native-strategy-cap]').inputValue(),'600');await reopened.close();assert.equal(h.count(),0);
  const appearance=await page.locator('.native-review-card').evaluate(el=>({background:getComputedStyle(el).backgroundColor,padding:getComputedStyle(el).padding,theme:document.documentElement.dataset.theme}));
  assert.equal(appearance.theme,theme);assert.equal(appearance.background,theme==='midnight'?'rgb(35, 44, 64)':'rgb(244, 245, 250)');assert.equal(appearance.padding,width===390?'12px':'18px');
  const button=await page.getByRole('button',{name:'Activate live trading',exact:true}).evaluate(el=>{const s=getComputedStyle(el);return{background:s.backgroundColor,color:s.color,height:el.getBoundingClientRect().height};});
  const luminance=color=>{const v=color.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>color.startsWith('color(')?n:n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2];};
  const contrast=(a,b)=>{a=luminance(a);b=luminance(b);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
  assert.ok(contrast(button.background,button.color)>=4.5,'activation text is readable');assert.ok(button.height>=44,'activation has a usable touch target');
  const input=await page.locator('[data-native-strategy-cap]').evaluate(el=>{const s=getComputedStyle(el);return{background:s.backgroundColor,border:s.borderColor};});assert.ok(contrast(input.background,input.border)>=3,'input boundary remains visible in each theme');

  const review=page.locator('[data-native-allocation-review]');await review.locator('summary').click();const text=await review.innerText();
  assert.match(text,/Whole account: includes existing\/manual and future/);assert.match(text,/signed margin balance -\$400\.00/);assert.match(text,/explicit debit Unknown/);
  assert.match(text,/ELIGIBILITY/);assert.match(text,/Eligible after live recheck/);assert.match(text,/independently eligible actions/);assert.match(text,/10\.25/);assert.match(text,/Initial account transition/);assert.match(text,/Saved strategy research/);assert.match(text,/ABC\s+sell\s+10/);assert.match(text,/fractional residuals/);assert.doesNotMatch(text.split('Saved strategy research')[1].split('Initial account transition')[0],/Unknown/);
  await page.getByRole('heading',{name:'Existing holdings being adopted',exact:true}).scrollIntoViewIfNeeded();await shell.screenshot({path:'/tmp/oshal-account-strategy-review-'+width+'.png'});
  assert.equal(h.mandate().status,'draft');assert.equal(h.count(),0);
  h.mandate().reviewExpiresAtMs=0;await shell.reload();
  if(embedded)await shell.frameLocator('iframe').getByRole('heading',{name:'Trading strategy',exact:true}).waitFor();
  page=embedded?shell.frames().find(f=>f!==shell.mainFrame()):shell;
  await page.getByText('Review expired',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Activate live trading',exact:true}).isEnabled(),false);assert.equal(await page.locator('[data-native-strategy-cap]').inputValue(),'600');
  await page.getByRole('button',{name:'Refresh activation review',exact:true}).click();await page.getByText('Review saved. No strategy authority activated and no broker orders placed.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Activate live trading',exact:true}).isEnabled(),true);assert.equal(h.count(),0);

  shell.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Activate live trading',exact:true}).click();assert.equal(h.mandate().status,'draft');
  shell.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Activate live trading',exact:true}).click();await page.getByText('Live trading: Active',{exact:true}).waitFor();assert.equal(h.count(),0,'approval alone submits no order');
  await h.req('/profiles',{accountId:'a',connectionKey:'owned-login',label:'Synthetic account',registration:'taxable',strategyId:null});
  await page.getByRole('button',{name:'Refresh this account',exact:true}).click();await page.getByText('Live trading: Active · different strategy',{exact:true}).waitFor();
  assert.match(await page.locator('[data-native-account-strategy]').locator('..').innerText(),/Strategy for Synthetic account/);assert.match(await page.locator('.native-strategy-picker').innerText(),/Authorized strategy: Monthly model.*differs from the assigned strategy/);
  await h.req('/profiles',{accountId:'a',connectionKey:'owned-login',label:'Synthetic account',registration:'taxable',strategyId:h.strategyId});
  await page.getByRole('button',{name:'Refresh this account',exact:true}).click();await page.getByText('Live trading: Active',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Deactivate strategy',exact:true}).click();await page.getByText('Live trading: Inactive',{exact:true}).waitFor();assert.equal(h.count(),0);
  await shell.route(/\/portfolio\/live\/reviews\?/,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic saved-review outage'})}));await shell.reload();
  if(embedded)await shell.frameLocator('iframe').getByRole('heading',{name:'Trading strategy',exact:true}).waitFor();
  page=embedded?shell.frames().find(f=>f!==shell.mainFrame()):shell;
  await page.getByText('Saved account reviews could not be read. Refresh this account before changing reviewed terms or preparing activation.',{exact:true}).waitFor();assert.equal(await page.locator('[data-native-strategy-cap]').count(),0,'an unreadable review cannot silently replace the cap');
  assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await context.close();
 }
});
