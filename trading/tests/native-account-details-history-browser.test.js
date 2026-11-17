/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The details page's daily bars wear the page's buy and sell colours (they drew black outside the overview).
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The account details page (1.58.0) in Chromium at 1440 and 412 pixels draws an account's recorded value history and its daily change bars from GET /paper/values, compares it with SPY on matching dates, and asks the server for no save. Before 1.58.0 it read GET /portfolio/account-details, which saves today's value before it reads; on the native kernel a GET is admitted as a reader, the save is refused, and the page said "Account history could not be read" (kernel test crates/oshald/tests/trading_today_read.rs, second case). The fixture host refuses that save the same way. Expectations come from the invented fixture rows alone, not from the page's own modules. No broker, no kernel, no real account.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {overviewHost}=require('./support/overview-host');
const F=require('./support/overview-fixtures');
const PKG=path.resolve(__dirname,'..');
const TOOLCHAIN=path.resolve(process.env.STORE_CI_TOOLCHAIN||(process.env.OSHAL_FRAMEWORK?path.join(process.env.OSHAL_FRAMEWORK,'node_modules'):path.resolve(PKG,'../scripts/toolchain/node_modules')));
const {chromium}=require(path.join(TOOLCHAIN,'playwright'));
const DETAILS='?view=accounts&sub=details&account='+encodeURIComponent(F.ACCOUNT.accountId)+'&connection='+encodeURIComponent(F.ACCOUNT.connectionKey);
const pct=v=>(v>0?'+':'')+v.toFixed(2)+'%';

/** @description The margin account's recorded market days on or after a day, from the fixture rows (its Saturday record is not a market day). */
function recordedSince(start){
 const days=new Map(F.valueRows().filter(r=>r[0]===F.ACCOUNT&&r[1]!==F.SATURDAY).map(r=>[r[1],r[3]]));
 days.set('2026-11-11',31216.58);days.set('2026-11-12',31204.18);   // the two records today-fixtures' seedConnected saves
 return [...days.entries()].filter(([day])=>day>=start).sort(([a],[b])=>a.localeCompare(b));
}

/** @description The value change against SPY on the first and last recorded days, from the fixture's own closes. */
function versusSpy(rows){
 const closes=new Map(F.benchmarkBars('SPY').bars.map(b=>[new Date(b.t*1000).toISOString().slice(0,10),b.c])),first=rows[0],last=rows.at(-1);
 return 'Account value change '+pct((last[1]/first[1]-1)*100)+' versus SPY '+pct((closes.get(last[0])/closes.get(first[0])-1)*100);
}

/** @description Open a page at a width on the fixture clock, recording page errors and every request that is not a read. */
async function open(browser,h,width,query){
 const context=await browser.newContext({viewport:{width,height:915},locale:'en-US',timezoneId:'America/New_York'}),page=await context.newPage(),errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.method()+' '+new URL(r.url()).pathname);});
 page.setDefaultTimeout(30000);await page.clock.setFixedTime(F.NOW);await page.goto(h.base+query);
 return {page,errors,writes,close:()=>context.close()};
}

/** @description Wait for the recorded history's chart, or fail with what the page said instead. */
async function history(page){
 await page.getByRole('img',{name:'Recorded account value',exact:true}).waitFor().catch(async err=>{throw new Error(err.message+'\nthe history said: '+(await page.locator('[data-details-charts]').innerText().catch(()=>'(no history section)')).slice(0,400));});
}

test('the account details page draws the recorded history from GET /paper/values, compares it with SPY, and asks for no save',async t=>{
 const h=await overviewHost(t,F.seedPortfolio),browser=await chromium.launch();t.after(()=>browser.close());
 const month=recordedSince('2026-10-12'),week=recordedSince('2026-11-05');
 for(const width of [1440,412]){
  h.state.requests.length=0;h.state.sql.length=0;
  const {page,errors,writes,close}=await open(browser,h,width,DETAILS);
  await page.getByText('Account details · Schwab',{exact:true}).waitFor();await history(page);
  const charts=page.locator('[data-details-charts]');
  assert.doesNotMatch(await charts.innerText(),/could not be read/,'the history is read, not refused');
  assert.equal(await charts.locator('.details-chart-value').innerText(),'$31,204.18','the newest recorded value');
  assert.equal(await charts.locator('[data-details-value-chart] .pf-hit').count(),month.length,'one day per recorded market day in the month');
  assert.equal(await page.locator('.details-observations tbody tr').count(),month.length,'the recorded values table lists the same days');
  assert.equal(await charts.locator('[data-details-change-chart] path[data-pf-sign]').count(),month.length-1,'a daily change bar for each recorded day but the first: the history starts inside the month');
  const fills=await charts.locator('[data-details-change-chart] path[data-pf-sign]').evaluateAll(list=>list.map(el=>[el.getAttribute('data-pf-sign'),getComputedStyle(el).fill]));
  for(const [sign,fill] of fills.filter(([sign])=>sign!=='flat'))assert.equal(fill,sign==='up'?'rgb(47, 191, 143)':'rgb(236, 118, 114)','a '+sign+' bar wears the page\'s '+(sign==='up'?'buy':'sell')+' colour');
  assert.ok(fills.some(([sign])=>sign==='up')&&fills.some(([sign])=>sign==='down'));
  await charts.getByRole('img',{name:versusSpy(month),exact:true}).waitFor();
  assert.match(await charts.locator('[data-details-compare-result]').innerText(),new RegExp('Matching dates: '+month[0][0]+' – '+month.at(-1)[0]));
  await page.locator('[data-details-period]').selectOption('1W');
  await page.waitForFunction(n=>document.querySelectorAll('[data-details-value-chart] .pf-hit').length===n,week.length);
  assert.equal(await charts.locator('[data-details-change-chart] path[data-pf-sign]').count(),week.length,'in a week the first bar counts from the market day before it');
  await charts.getByRole('img',{name:versusSpy(week),exact:true}).waitFor();
  assert.ok(h.calls().includes('GET /api/trading/paper/values'),'the history comes from the recorded values');
  assert.equal(h.calls().some(line=>line.includes('/portfolio/account-details')),false,'no read that saves before it reads');
  assert.deepEqual(h.state.sql.filter(text=>/^\s*(INSERT|UPDATE|DELETE)\b/i.test(text)),[],'reading the page asks for no save');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no sideways scroll at '+width);
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);await close();
 }
});

test('a card on the overview opens the same page with the history drawn',async t=>{
 const h=await overviewHost(t,F.seedPortfolio),browser=await chromium.launch();t.after(()=>browser.close());
 const {page,errors,writes,close}=await open(browser,h,412,'');
 await page.locator('[data-pf-account="'+F.keyOf(F.ACCOUNT)+'"] .pf-card-link').click();
 await page.getByText('Account details · Schwab',{exact:true}).waitFor();await history(page);
 assert.equal(await page.locator('[data-details-value-chart] .pf-hit').count(),recordedSince('2026-10-12').length);
 assert.deepEqual(h.state.sql.filter(text=>/^\s*(INSERT|UPDATE|DELETE)\b/i.test(text)),[]);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);await close();
});
