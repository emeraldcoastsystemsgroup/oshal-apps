/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.57.1, after "the review blockers button does nothing" (2026-11-16). The watcher's own tick, through the shipped routes over synthetic records, leaves a whole-account allocation waiting on a holding whose price is stale. On the shipped account page, desktop and phone, with the evidence section already open (as it was when the button did nothing) and again closed, Review blockers must bring a list naming exactly the holdings the record names, why and what to do into view, mark their rows in the targets table and move a visible focus there. Review recorded orders, See targets and holdings, Review last check and Review setup each move focus to their own content the same way. Every page request that is not GET or HEAD is aborted and counted; none may occur, and no order is submitted.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(path.resolve(__dirname,'../../scripts/toolchain/node_modules/playwright'));
const {allocationFixture}=require('./support/native-allocation-host');
const {binding}=require('./support/native-management-host');
const UI=path.resolve(__dirname,'../tools/ui');
const SCRIPTS=['view-accounts','native-protection-controls','native-account-status','native-account-controls','native-account-management'];
const STYLES=fs.readFileSync(path.join(UI,'../trading.html'),'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
const SIZES=[{name:'desktop',width:1440,height:900},{name:'phone',width:412,height:915}];
const NOW=new Date('2026-10-26T16:01:00Z');
// Screenshots are written only when a proof folder is named; the suite itself leaves nothing behind.
const PROOF=process.env.TRADES_REVIEW_PROOF_DIR||'';

/** @description The page's own globals, as trading.html's app.js provides them, around the shipped account view. */
function boot(account){
 return `const main=document.getElementById('main'),$=id=>document.getElementById(id);let RENDER_TOKEN=1;const stale=t=>t!==RENDER_TOKEN;
 const money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v);
 const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const jbody=(method,obj)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});
 const api=async(p,init)=>{const r=await fetch('/api/trading'+p,init),j=await r.json();if(!r.ok)throw Error(j.message||j.error);return j;};
 const paperScheduleRow=async()=>({status:'active',activation:{},nextRunAt:'2026-10-26T16:02:00Z'});
 const navigate=()=>{main.innerHTML='<p>All accounts</p>';};
 const models=[{...${JSON.stringify(account)},nativeReadOnly:true,state:'ok',label:'Synthetic account'}];
 if(!showFocusedNativeAccount(models))nativeAccountView(models[0]);`;
}
/** @description Serve the shipped scripts and stylesheet beside the fixture's real trading routes. */
function serve(h){
 for(const file of SCRIPTS)h.app.get('/ui/'+file+'.js',(_req,res)=>res.type('js').send(fs.readFileSync(path.join(UI,file+'.js'),'utf8')));
 h.app.get('/ui/native-account-details.css',(_req,res)=>res.type('css').send(fs.readFileSync(path.join(UI,'native-account-details.css'),'utf8')));
 h.app.get('/boot.js',(_req,res)=>res.type('js').send(boot(h.accounts[0])));
 h.app.get('/',(_req,res)=>{res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");
  res.send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>'+STYLES+'</style><link rel="stylesheet" href="/ui/native-account-details.css"><div class="page"><div id="main"></div></div>'+SCRIPTS.map(file=>'<script src="/ui/'+file+'.js"></script>').join('')+'<script src="/boot.js"></script>');});
}
/** @description Open the account page at one size; any request that could change something is aborted and recorded. */
async function openPage(browser,h,size){
 const context=await browser.newContext({viewport:{width:size.width,height:size.height}}),page=await context.newPage(),errors=[],writes=[];
 page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(8000);
 await page.route('**/*',route=>{const method=route.request().method();if(method==='GET'||method==='HEAD')return route.continue();writes.push(method+' '+route.request().url());return route.abort();});
 await page.clock.setFixedTime(NOW);
 await page.goto(h.base+'/?view=strategies&sub=accounts&account=a&connection=owned-login');
 await page.getByRole('region',{name:'Account activity status'}).waitFor();
 return {context,page,errors,writes};
}
/** @description Let a smooth scroll finish: the page position must hold still across several frames. */
async function settle(page){
 await page.waitForTimeout(150);let last=null,still=0;
 for(let i=0;i<60&&still<3;i++){const y=await page.evaluate(()=>scrollY);still=y===last?still+1:0;last=y;await page.waitForTimeout(50);}
}
/** @description Put the section in the state given, show the button as the person saw it, press it and report where focus went.
 *   With a proof folder named, the view is saved just before and just after the press. */
async function press(page,label,section,open,shot=''){
 await page.locator(section==='settings'?'[data-native-strategy-settings]':'[data-native-status-evidence]').evaluate((el,value)=>{el.open=value;},open);
 const button=page.locator('.native-status-actions').getByRole('button',{name:label,exact:true});
 await button.evaluate(el=>el.scrollIntoView({block:'center'}));if(shot)await page.screenshot({path:shot+'-before.png'});
 await button.click();await settle(page);if(shot)await page.screenshot({path:shot+'-after.png'});
 return page.evaluate(()=>{
  const el=document.activeElement,box=el.getBoundingClientRect(),style=getComputedStyle(el);
  return {tag:el.tagName,focus:el.getAttribute('data-native-status-focus'),inEvidence:!!el.closest('[data-native-status-evidence]'),inSettings:!!el.closest('[data-native-strategy-settings]'),
   top:Math.round(box.top),height:innerHeight,outline:style.outlineStyle!=='none'&&parseFloat(style.outlineWidth)>=2,text:el.innerText||''};
 });
}
/** @description Focus left the section heading for the content the step names, that content is in view, and the focus is visible. */
function assertRevealed(state,label,focus,where){
 assert.notEqual(state.tag,'SUMMARY',where+': '+label+' must move focus past the section heading to its content');
 if(focus==='settings')assert.equal(state.inSettings,true,where+': '+label+' focuses the strategy settings content');
 else{assert.equal(state.focus,focus,where+': '+label+' focuses its own content (focused '+state.tag+' '+JSON.stringify(state.text.slice(0,60))+')');assert.equal(state.inEvidence,true);}
 assert.ok(state.top>=0&&state.top<=state.height-120,where+': '+label+' brings its content into view (top '+state.top+' of '+state.height+')');
 assert.equal(state.outline,true,where+': the focused content shows a visible outline');
}
async function waitingOnStaleHolding(t){
 const h=await allocationFixture(t,{whole:true,positions:[{symbol:'AAA',qty:1,marketValue:1},{symbol:'ABC',qty:10,marketValue:1000}],cash:0,equity:1001,capitalCents:100000});
 h.setQuote('AAA',{tradePrice:1,tradeAt:'2026-10-23T19:59:00Z'});
 const review=await h.req('/live/mandate',{watchId:h.watch.id,capitalCents:100000,scope:'whole-account'});assert.equal(review.review.activationReady,true,JSON.stringify(review));
 await h.activate();let tick;
 for(let i=0;i<12;i++){tick=await h.req('/watch/tick',{});if(tick.ordersSubmitted)h.fill();else break;}
 assert.equal(tick.receipts[0].status,'waiting-for-position-review',JSON.stringify(tick));
 return {h,deferred:tick.receipts[0].automation.deferred};
}

test('Review blockers names exactly the recorded holdings, marks their rows and takes focus there, section open or closed',async t=>{
 const {h,deferred}=await waitingOnStaleHolding(t);serve(h);
 assert.deepEqual(deferred.map(row=>[row.symbol,row.action,row.blockers.map(b=>b.code).join()]),[['AAA','sell','quote_stale']],'the watcher record this page reads');
 const browser=await chromium.launch();t.after(()=>browser.close());const submitted=h.count();
 for(const size of SIZES)for(const open of [true,false]){
  const where=size.name+(open?', section already open':', section closed'),{context,page,errors,writes}=await openPage(browser,h,size);
  const story=page.getByRole('region',{name:'Account activity status'});
  assert.match(await story.innerText(),/Review blocked/);assert.match(await story.innerText(),/Some positions need review before the allocation can finish/);
  const state=await press(page,'Review blockers','evidence',open,PROOF&&path.join(PROOF,'review-blockers-'+size.name+'-'+(open?'open':'closed')));
  assertRevealed(state,'Review blockers','blockers',where);
  const items=await page.locator('[data-native-status-focus="blockers"] li').allInnerTexts();
  assert.deepEqual(items.map(text=>text.split(/\s·\s|\n/)[0]),deferred.map(row=>row.symbol),where+': the list names exactly the holdings the record names');
  assert.match(items[0],/AAA · Sell/);assert.match(items[0],/not recent enough/i);assert.match(items[0],/next watcher check/i);
  const rows=page.locator('[data-native-status-focus="targets"] tbody tr');
  const marked=await rows.evaluateAll(list=>list.filter(row=>row.classList.contains('native-blocker-row')).map(row=>row.cells[0].innerText.split(/\s/)[0]));
  assert.deepEqual(marked,['AAA'],where+': only the blocking holding is marked in the targets table');
  const shades=await rows.evaluateAll(list=>list.map(row=>({marked:row.classList.contains('native-blocker-row'),background:getComputedStyle(row.cells[0]).backgroundColor})));
  assert.ok(shades.some(row=>!row.marked),where+': the table also holds holdings that are not blocking');
  for(const row of shades.filter(row=>!row.marked))assert.notEqual(row.background,shades.find(row=>row.marked).background,where+': the marked row is visibly highlighted');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,where+': nothing scrolls sideways');
  assert.deepEqual(writes,[],where+': the button sends nothing');assert.deepEqual(errors,[]);await context.close();
 }
 assert.equal(h.count(),submitted,'no order is submitted by the page');
});

const OTHER_STEPS=[
 {label:'Review recorded orders',focus:'orders',section:'evidence',async make(t){
  const h=await allocationFixture(t);await h.activate();await h.req('/watch/tick',{});const tick=await h.req('/watch/tick',{});
  assert.equal(tick.receipts[0].status,'waiting-for-broker-order',JSON.stringify(tick));return h;}},
 {label:'See targets and holdings',focus:'targets',section:'evidence',async make(t){
  const h=await allocationFixture(t);await h.activate();let status;
  for(let i=0;i<10&&status!=='cycle-completed';i++){const tick=await h.req('/watch/tick',{});status=tick.receipts[0].status;if(tick.ordersSubmitted)h.fill();}
  assert.equal(status,'cycle-completed');return h;}},
 {label:'Review last check',focus:'check',section:'evidence',async make(t){
  const h=await allocationFixture(t);await h.activate();const original=h.ctx.intent;
  h.ctx.intent=async(name,input)=>{if(name==='trading.orders.balance')throw Error('Synthetic broker outage');return original(name,input);};
  const tick=await h.req('/watch/tick',{});assert.equal(tick.receipts[0].status,'failed',JSON.stringify(tick));h.ctx.intent=original;return h;}},
 {label:'Review setup',focus:'settings',section:'settings',async make(t){
  const h=await allocationFixture(t);const stopped=await h.req('/watch/stop',binding);assert.equal(stopped.watch.enabled,false);return h;}},
];
for(const step of OTHER_STEPS)test(step.label+' moves focus to its own content, section open or closed',async t=>{
 const h=await step.make(t);serve(h);const browser=await chromium.launch();t.after(()=>browser.close());const submitted=h.count();
 for(const size of SIZES)for(const open of [true,false]){
  const where=size.name+(open?', section already open':', section closed'),{context,page,errors,writes}=await openPage(browser,h,size);
  assert.equal(await page.locator('.native-status-actions button.primary').innerText(),step.label,where+': the account offers this next step');
  const state=await press(page,step.label,step.section,open,PROOF&&path.join(PROOF,step.focus+'-'+size.name+'-'+(open?'open':'closed')));
  assertRevealed(state,step.label,step.focus,where);
  if(step.focus==='orders')assert.match(await page.locator('[data-native-status-focus="orders"]').innerText(),/Recorded working orders/);
  if(step.focus==='targets')assert.match(await page.locator('[data-native-status-focus="targets"]').innerText(),/Target weight/i);
  if(step.focus==='check')assert.match(await page.locator('[data-native-status-focus="check"]').innerText(),/Retained account check/);
  assert.equal(await page.locator('[data-native-status-focus="blockers"]').count(),0,where+': no blocker list without blockers');
  assert.deepEqual(writes,[],where+': the button sends nothing');assert.deepEqual(errors,[]);await context.close();
 }
 assert.equal(h.count(),submitted,'no order is submitted by the page');
});
