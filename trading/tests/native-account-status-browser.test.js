/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Keep the retained submission count visibly bound to its own date, independent of a later failed attempt, and withhold broker evidence without explicit strategy identity.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Keep the selected account next step local, accessible and honest on desktop and phone; exercise the real renderer without starting the application keeper.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Render the shipped account roster, strategy panel and pure status reader in Chromium at desktop and phone sizes with synthetic receipts only. Verify failure and stale evidence stay visible, approval is distinct from activity, targets differ from measured holdings, and the page sends no mutation.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(path.resolve(__dirname,'../../scripts/toolchain/node_modules/playwright'));
const UI=path.resolve(__dirname,'../tools/ui'),NOW=new Date('2026-11-12T18:50:00Z');
const FILES=['native-account-status.js','native-account-controls.js','native-account-management.js'];
const STYLES=fs.readFileSync(path.resolve(UI,'../trading.html'),'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
function fixture(kind){
 const stale=kind==='stale';
 const account={accountId:'synthetic-account',connectionKey:'synthetic-connection',strategyId:'synthetic-strategy',label:'Synthetic account',kind:'live',equity:10000,cash:0,constraints:{group:'taxable-cash'}};
 const receipt={...account,observedAt:stale?'2026-10-30T18:49:45Z':'2026-11-12T18:49:45Z',status:'aligned',accountEquity:10000,
  signal:{signalAsOf:'2026-11-11',decisionAsOf:'2026-10-30',evidenceThrough:'2026-10-30',targets:[{symbol:'BIL',weightPct:100}]},
  positions:[{symbol:'ABC',qty:20,marketValue:5000},{symbol:'BIL',qty:50,marketValue:5000}],workingOrders:[],brokerOrders:[],
  automation:stale?{status:'cycle-completed'}:{status:'waiting-for-position-review',deferred:[{blockers:[{message:'Synthetic holding needs review.'}]}]}};
 if(kind==='unverified')return {account,watch:{...account,enabled:true,automatedTrading:true,authority:{active:true,status:'active'}}};
 const watch={...account,enabled:true,automatedTrading:true,authority:{active:true,status:'active'},lastRunAt:receipt.observedAt,lastReceipt:receipt};
 if(kind==='pending'){receipt.automation={status:'order-submitted'};receipt.workingOrders=[{orderId:'synthetic-working-order',status:'WORKING'}];}
 if(kind==='aligned')receipt.automation={status:'aligned'};
 if(kind==='cycle')receipt.automation={status:'cycle-completed'};
 if(kind==='exceptions')receipt.automation={status:'cycle-completed-with-exceptions'};
 if(kind==='protective')receipt.automation={status:'protective-exit-awaiting-next-cycle'};
 if(kind==='paused')watch.enabled=false;
 if(kind==='unapproved')watch.authority={active:false,status:'expired'};
 if(kind==='monitoring')watch.automatedTrading=false;
 if(kind==='future')receipt.observedAt='2026-11-12T20:00:00Z';
 if(kind==='foreign'){receipt.connectionKey='foreign';receipt.brokerOrders=[{orderId:'FOREIGN_ORDER_DO_NOT_SHOW',executions:[{price:25,quantity:1}]}];}
 if(kind==='malformed'){receipt.positions=[null];receipt.brokerOrders=[null];}
 if(kind==='untrusted'){account.label='<img src=x onerror=bad>';watch.lastError='<svg onload=bad>';}
 if(kind==='no-watch')return {account};
 receipt.ordersSubmitted=kind==='aligned'?0:undefined;
 if(kind==='failed-newer'){receipt.observedAt='2026-11-12T18:30:00Z';receipt.ordersSubmitted=0;watch.lastRunAt='2026-11-12T18:49:59Z';watch.lastError='Synthetic later failure';}
 if(kind==='missing-count-date'){receipt.observedAt=null;receipt.ordersSubmitted=0;}
 if(['missing-strategy','wrong-strategy'].includes(kind)){
  receipt.brokerOrders=[{orderId:'UNBOUND_STRATEGY_ORDER_DO_NOT_SHOW',legs:[{instruction:'BUY',symbol:'SYNTHETIC'}],executions:[{price:25,quantity:1,time:'2026-11-12T18:20:00Z'}]}];
  if(kind==='missing-strategy')delete account.strategyId;else account.strategyId='replacement';
 }
 return {account,watch,latestSession:kind==='no-calendar'?null:'2026-11-11',schedule:kind==='schedule-paused'?{status:'suspended',reason:'owner_paused'}:null};
}
function boot(kind){
 return `const sample=${JSON.stringify(fixture(kind))},main=document.getElementById('main');
 const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=value=>'$'+Number(value).toFixed(2);
 const research={strategies:[{id:'synthetic-strategy',name:'Synthetic monthly strategy',config:{modelVersion:2}}]},schedule=sample.schedule||{status:'active',nextRunAt:'2026-11-12T18:51:00Z'},windowInfo={latestCompletedSession:sample.latestSession===null?null:'2026-11-11'};
 document.getElementById('roster').innerHTML=nativeAccountRoster({accounts:[sample.account],researchWindow:windowInfo},research,{watches:[sample.watch].filter(Boolean)},null,schedule);
 main.innerHTML=nativeStrategyPanel(sample.account,research.strategies[0],null,sample.watch,research,{watches:[sample.watch].filter(Boolean)},schedule,null,true,windowInfo);
 globalThis.operations=[];globalThis.api=(...args)=>{operations.push(args);throw Error('Fixture forbids account actions');};globalThis.fetch=(...args)=>{operations.push(args);throw Error('Fixture forbids requests');};
 main.onclick=event=>nativeAccountLocalAction(event,main);`;
}
async function server(t){
 const requests=[],app=http.createServer((req,res)=>{
  requests.push(req.method+' '+req.url);const url=new URL(req.url,'http://fixture');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'");
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  if(FILES.includes(url.pathname.slice(1))){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(fs.readFileSync(path.join(UI,url.pathname.slice(1))));return;}
  if(url.pathname==='/boot.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(boot(url.searchParams.get('kind')||(url.searchParams.has('stale')?'stale':'blocked')));return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>'+STYLES+'</style><div class="page"><div id="roster"></div><main id="main"></main></div>'+FILES.map(file=>'<script src="/'+file+'"></script>').join('')+'<script src="/boot.js'+('?kind='+encodeURIComponent(url.searchParams.get('kind')||(url.searchParams.has('stale')?'stale':'blocked')))+'"></script>');
 });
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>app.close(resolve)));
 return {base:'http://127.0.0.1:'+app.address().port,requests};
}
test('desktop and phone show the actual dated account outcome and holdings without activating anything',async t=>{
 const h=await server(t),browser=await chromium.launch();t.after(()=>browser.close());
 for(const width of [1440,412]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.setDefaultTimeout(5000);
  page.setDefaultTimeout(5000);await page.clock.setFixedTime(NOW);await page.goto(h.base);const story=page.getByRole('region',{name:'Account activity status'});
  assert.deepEqual(errors,[]);
  await story.waitFor();assert.match(await story.innerText(),/Review blocked/);assert.match(await story.innerText(),/Some positions need review/);
  assert.match(await story.innerText(),/Setting: Armed · Live approval: Active · Schedule: active/);
  await story.locator('[data-native-status-evidence]').evaluate(el=>{el.open=true;});
  assert.equal(await story.locator('time[datetime="2026-11-12T18:49:45Z"]').count(),3);
  const rows=await story.locator('tbody tr').allTextContents();assert.deepEqual(rows,['ABC0.00%50.00%20','BIL100.00%50.00%50']);
  assert.match(await page.locator('#roster').innerText(),/Latest account check/i);assert.match(await page.locator('#roster').innerText(),/Review blocked/);
  assert.equal(await page.getByRole('button',{name:'Live approval is active',exact:true}).count(),0);
  assert.equal(await page.locator('.native-approval-standing').textContent(),'Live approval is active');
  assert.doesNotMatch(await story.innerText(),/Parked|Live trading is active/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  await page.goto(h.base+'/?stale');await story.waitFor();await story.locator('[data-native-status-evidence]').evaluate(el=>{el.open=true;});assert.match(await story.innerText(),/Status unknown/);assert.match(await story.innerText(),/not verified current/);
  assert.equal(await story.locator('time[datetime="2026-10-30T18:49:45Z"]').count(),3);await page.close();
 }
 assert.deepEqual(h.requests.filter(line=>!line.startsWith('GET ')),[]);
});

for(const [kind,next] of [['blocked','Review blockers'],['stale','Review last check'],['unverified','Review setup'],['pending','Review recorded orders'],['aligned','See targets and holdings'],['cycle','See targets and holdings'],['exceptions','See targets and holdings'],['protective','Review last check'],['paused','Review setup'],['unapproved','Review setup'],['monitoring','Review last check'],['future','Review last check'],['foreign','Review last check'],['malformed','Review last check'],['untrusted','Review last check'],['no-watch','Review last check'],['no-calendar','Review last check'],['schedule-paused','Review setup']])test('selected '+kind+' account has one local contextual next step at both widths',async t=>{
 const h=await server(t),browser=await chromium.launch();t.after(()=>browser.close());
 for(const width of [1440,412]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.setDefaultTimeout(5000);await page.clock.setFixedTime(NOW);await page.goto(h.base+'/?kind='+kind);await page.locator('.native-management-panel').waitFor();
  const primary=page.locator('.native-management-panel button.primary:visible:not(:disabled)');
  assert.equal(await primary.count(),1);assert.equal(await primary.innerText(),next);
  const settings=page.locator('[data-native-strategy-settings]'),evidence=page.locator('[data-native-status-evidence]');
  assert.equal(await settings.evaluate(el=>el.open),false);assert.equal(await evidence.evaluate(el=>el.open),false);
  const stop=page.getByRole('button',{name:'Deactivate strategy',exact:true}),hasStop=!['paused','monitoring','no-watch'].includes(kind);
  assert.equal(await stop.count(),hasStop?1:0);if(hasStop)assert.equal(await stop.isVisible(),true);
  for(const control of hasStop?[primary,stop]:[primary])assert.ok((await control.boundingBox()).height>=44);
  const before=h.requests.length;await primary.focus();await page.keyboard.press('Enter');
  const destination=next==='Review setup'?settings:evidence;
  assert.equal(await destination.evaluate(el=>el.open),true);
  assert.equal(await destination.locator(':scope>summary').evaluate(el=>el===document.activeElement),true);
  assert.equal(h.requests.length,before);assert.deepEqual(await page.evaluate(()=>operations),[]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const text=await page.locator('.native-management-panel').innerText();
  assert.doesNotMatch(text,/FOREIGN_ORDER_DO_NOT_SHOW|Parked|Live trading is active/);
  assert.equal(await page.locator('.native-management-panel img,.native-management-panel svg').count(),0);
  if(kind==='aligned')assert.match(text,/recorded check: 0/);
  if(kind==='pending')assert.match(text,/synthetic-working-order/);
  if(kind==='no-watch')assert.match(text,/No matching account monitor/);
  assert.deepEqual(errors,[]);await page.close();
 }
});

test('retained submitted count has its own visible date independent of the latest attempt',async t=>{
 const h=await server(t),browser=await chromium.launch();t.after(()=>browser.close());
 for(const width of [1440,412])for(const [kind,date,count] of [['failed-newer','2026-11-12T18:30:00Z','0'],['unverified',null,'Unknown'],['blocked','2026-11-12T18:49:45Z','Unknown'],['missing-count-date',null,'0']]){
  const page=await browser.newPage({viewport:{width,height:1000}});page.setDefaultTimeout(5000);
  await page.clock.setFixedTime(NOW);await page.goto(h.base+'/?kind='+kind);
  const story=page.getByRole('region',{name:'Account activity status'}),line=story.locator('.native-recorded-count');await line.waitFor();
  assert.equal(await story.locator('[data-native-status-evidence]').evaluate(el=>el.open),false);
  assert.match(await line.innerText(),new RegExp('recorded check: '+count));
  if(date){assert.equal(await line.locator('time').getAttribute('datetime'),date);assert.equal(await line.locator('time').isVisible(),true);}
  else{assert.match(await line.innerText(),/Count date Unknown/);assert.equal(await line.locator('time').count(),0);}
  if(kind==='failed-newer'){
   assert.equal(await story.locator('time[datetime="2026-11-12T18:49:59Z"]').isVisible(),true);
   assert.equal(await line.locator('time[datetime="2026-11-12T18:49:59Z"]').count(),0);
   assert.match(await story.innerText(),/Last check failed: Synthetic later failure/);
  }
  assert.deepEqual(await page.evaluate(()=>operations),[]);await page.close();
 }
});
test('selected execution rows require an explicit matching strategy even when account history exists',async t=>{
 const h=await server(t),browser=await chromium.launch();t.after(()=>browser.close());
 for(const width of [1440,412])for(const kind of ['missing-strategy','wrong-strategy']){
  const page=await browser.newPage({viewport:{width,height:1000}});page.setDefaultTimeout(5000);await page.clock.setFixedTime(NOW);
  await page.goto(h.base+'/?kind='+kind);const evidence=page.locator('[data-native-status-evidence]');await evidence.waitFor({state:'attached'});
  await evidence.evaluate(el=>{el.open=true;el.querySelectorAll('details').forEach(row=>{row.open=true;});});
  const text=await page.locator('.native-execution-evidence').innerText();
  assert.doesNotMatch(text,/UNBOUND_STRATEGY_ORDER_DO_NOT_SHOW|BUY SYNTHETIC/);assert.match(text,/No matching account broker receipt/);
  assert.doesNotMatch(await page.locator('.native-execution-story').innerText(),/^Aligned/);
  assert.deepEqual(await page.evaluate(()=>operations),[]);await page.close();
 }
});
