/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The approval end dates (coordinator's added scope): under "Is it trading?" and on each card, the margin account's approval that ends before the Dec 1 trade says so and links to Strategy settings and approval (which opens on its Manage strategy page and changes nothing), the IRA's later one is a plain date, and the cash account with none shows no line.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The portfolio overview (1.58.0) in Chromium at 1440 and 412 pixels (and no sideways scroll at 1024 and 768), over the shipped trading.html, ui scripts and route handlers on a fixture host with three invented accounts. Intelligent Trades opens on it; it draws the total, today's change, the value line and daily bars that are green when the value rose and red when it fell, with a gap where a day has no record; the range buttons switch every chart; one card per account shows its value, day change, trendline and status chip and opens the existing account details page; the comparison draws each account with SPY and BIL and says when a price read fails; the holdings table sorts by each column; the Trading status tab is one tap away and shows the same cards and words as before; a person with no connected account sees how to connect one; and nothing the page sends can change an order, a strategy, an approval, a schedule or a job. No broker, no kernel, no real account.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const {overviewHost}=require('./support/overview-host');
const F=require('./support/overview-fixtures');
const S=require('../tools/ui/portfolio-series.js');
const C=require('../tools/ui/portfolio-charts.js');
const PKG=path.resolve(__dirname,'..');
const TOOLCHAIN=path.resolve(process.env.STORE_CI_TOOLCHAIN||(process.env.OSHAL_FRAMEWORK?path.join(process.env.OSHAL_FRAMEWORK,'node_modules'):path.resolve(PKG,'../scripts/toolchain/node_modules')));
const {chromium}=require(path.join(TOOLCHAIN,'playwright'));
const PROOF=process.env.TRADING_PROOF_DIR||os.tmpdir();
const UP='rgb(47, 191, 143)',DOWN='rgb(236, 118, 114)';   // the page's --buy and --sell fallbacks: no theme file is served here
const sum=day=>Math.round([F.ACCOUNT,F.IRA,F.CASH].reduce((n,a)=>n+F.valueOn(a,day),0)*100)/100;
const expected=range=>S.overview({accounts:[F.ACCOUNT,F.IRA,F.CASH].map(a=>({...a,points:F.valueRows().filter(r=>r[0]===a).map(r=>({day:r[1],at:r[2],equity:r[3]}))
 .concat(a===F.ACCOUNT?[{day:'2026-11-11',at:'2026-11-12T04:55:00.000Z',equity:31216.58},{day:'2026-11-12',at:'2026-11-12T18:45:00.000Z',equity:31204.18}]:[])})),sessions:F.historyDays().sessions},range);

/** @description Open the page at a width on the fixture clock and wait for the overview's charts. */
async function open(browser,h,width,{wait='#pfValueChart svg',query=''}={}){
 const context=await browser.newContext({viewport:{width,height:915},locale:'en-US',timezoneId:'America/New_York'}),page=await context.newPage(),errors=[],failed=[];
 // 30 s, not 15: on a loaded machine the page's first reads can take longer than the cases themselves.
 page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000);
 page.on('requestfailed',r=>failed.push(new URL(r.url()).pathname+' '+((r.failure()||{}).errorText||'')));
 await page.clock.setFixedTime(F.NOW);await page.goto(h.base+query);
 if(wait)await page.locator(wait).first().waitFor().catch(async err=>{throw new Error(err.message+'\npage showed: '+(await page.locator('#main').innerText()).slice(0,600)+'\npage errors: '+errors.join(' | ')+'\nfailed requests: '+failed.join(', ')+'\nrequests: '+h.calls().join(', '));});
 return {page,errors,close:()=>context.close()};
}
const settled=page=>page.waitForLoadState('networkidle');
const noSideways=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);

test('Intelligent Trades opens on the overview: the total, today\'s change, the value line and daily bars, from saved values, sending nothing that can change money',async t=>{
 const h=await overviewHost(t,F.seedPortfolio),browser=await chromium.launch();t.after(()=>browser.close());
 const want=expected('1M'),runs=C.runs(want.total.points.map(p=>p.value)).length,bars=want.total.changes.filter(c=>c.change!==null);
 for(const width of [1440,412]){
  h.state.requests.length=0;h.state.sql.length=0;
  const {page,errors,close}=await open(browser,h,width);await settled(page);
  assert.equal(await page.locator('#nav button.on').innerText(),'Accounts');
  assert.equal(await page.locator('[data-accounts-tab="overview"]').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('[data-pf-total]').innerText(),C.money(sum(F.TODAY)));
  const deltas=await page.locator('.pf-deltas').innerText();
  assert.match(deltas,new RegExp(C.signedMoney(Math.round((sum(F.TODAY)-sum('2026-11-11'))*100)/100).replace(/[$+.]/g,'\\$&')+' \\([+-][0-9.]+%\\)\\s+Today'));
  assert.match(deltas,/change in value, one month/);
  assert.match(await page.locator('#pfHero').innerText(),/History starts Oct 13, 2026, so this range begins there\./);
  assert.equal(await page.locator('#pfValueChart polyline.pf-line').count(),runs,'the line breaks where a day has no record');
  assert.equal(runs,2);
  assert.equal(await page.locator('#pfValueChart .pf-hit').count(),want.total.points.length,'one hover area per market day in the range');
  const signs=await page.locator('#pfBarsChart path[data-pf-sign]').evaluateAll(list=>list.map(el=>[el.getAttribute('data-pf-sign'),getComputedStyle(el).fill]));
  assert.equal(signs.length,bars.length,'a bar for each day with a change, none on a gap');
  assert.deepEqual(signs.filter(s=>s[0]==='up').length,bars.filter(c=>c.change>0).length);
  for(const [sign,fill] of signs)assert.equal(fill,sign==='up'?UP:sign==='down'?DOWN:fill,'bar colour by sign');
  assert.ok(signs.some(s=>s[0]==='up')&&signs.some(s=>s[0]==='down'),'the fixture has days up and days down');
  assert.deepEqual(h.calls().filter(line=>!line.startsWith('GET ')),[],'opening the overview sends no POST, PUT, PATCH or DELETE');
  assert.deepEqual(h.state.sql.filter(text=>!/^\s*SELECT\b/.test(text)),[],'no statement that is not a SELECT');
  for(const read of ['GET /api/trading/paper/values','GET /api/trading/paper/today','GET /api/v1/agent/schedules','GET /api/trading-charts/bars?SPY','GET /api/trading-charts/bars?BIL'])assert.ok(h.calls().includes(read),read);
  assert.equal(h.calls().some(line=>/\/portfolio|\/summary/.test(line)),false,'no broker balance read beyond the roster boot() starts');
  assert.ok(await noSideways(page),'no sideways scroll at '+width);
  for(const control of await page.locator('#pfRoot button:visible, #pfRoot summary:visible, .pf-tabs button:visible').all())assert.ok((await control.boundingBox()).height>=44,'every control is at least 44 pixels high');
  await page.screenshot({path:path.join(PROOF,'trades-overview-'+width+'.png'),fullPage:true});
  assert.deepEqual(errors,[]);await close();
 }
 for(const width of [1024,768]){const {page,errors,close}=await open(browser,h,width);await settled(page);assert.ok(await noSideways(page),'no sideways scroll at '+width);assert.deepEqual(errors,[]);await close();}
});

test('the range buttons switch the total, the cards and the comparison together, and say when the history starts',async t=>{
 const h=await overviewHost(t,F.seedPortfolio),browser=await chromium.launch();t.after(()=>browser.close());
 for(const width of [1440,412]){
  const {page,errors,close}=await open(browser,h,width);await settled(page);
  for(const [range,words,short] of [['1W','one week',false],['3M','three months',true],['ALL','everything recorded',false],['1M','one month',true]]){
   await page.locator('[data-pf-range="'+range+'"]').click();
   const want=expected(range);
   assert.equal(await page.locator('[data-pf-range="'+range+'"]').getAttribute('aria-pressed'),'true');
   assert.equal(await page.locator('[data-pf-range][aria-pressed="true"]').count(),1);
   assert.equal(await page.locator('#pfValueChart .pf-hit').count(),want.total.points.length,range+': the value chart shows the range');
   assert.equal(await page.locator('#pfCompareChart .pf-hit').count(),want.compareDays.length,range+': the comparison shows the range');
   assert.match(await page.locator('.pf-deltas').innerText(),new RegExp('change in value, '+words));
   assert.equal(/History starts Oct 13, 2026/.test(await page.locator('#pfHero').innerText()),short,range+': the history note');
   const margin=want.accounts.find(a=>a.key===F.ACCOUNT.connectionKey+'|'+F.ACCOUNT.accountId);
   assert.equal(await page.locator('[data-pf-spark="'+margin.key+'"] .pf-hit').count(),0,'a card\'s trendline has no hover areas of its own');
   assert.match(await page.locator('[data-pf-account="'+margin.key+'"] .pf-card-deltas').innerText(),new RegExp((range==='ALL'?'all':range)+'$'));
  }
  assert.deepEqual(errors,[]);await close();
 }
});

test('each account has a card with its value, day change, trendline and chip, and a tap opens the existing account details page',async t=>{
 const h=await overviewHost(t,F.seedPortfolio),browser=await chromium.launch();t.after(()=>browser.close());
 for(const width of [1440,412]){
  h.state.requests.length=0;
  const {page,errors,close}=await open(browser,h,width);await settled(page);
  const cards=page.locator('#pfCards .pf-card');assert.equal(await cards.count(),3);
  assert.deepEqual(await cards.locator('.pf-card-name').allInnerTexts(),[F.LABELS[F.IRA.connectionKey+'|'+F.IRA.accountId],'Example margin ···0001',F.LABELS[F.CASH.connectionKey+'|'+F.CASH.accountId]],'largest value first');
  assert.deepEqual(await cards.evaluateAll(list=>list.map(c=>[...c.querySelectorAll('.story-chip')].map(x=>x.textContent).join(' '))),['NEEDS YOU MOSTLY PARKED','RUNNING MOSTLY PARKED','NOT SET UP'],'the status tab\'s own chips');
  assert.equal(await cards.nth(1).locator('.pf-card-value').innerText(),'$31,204.18');
  assert.match((await cards.nth(1).locator('.pf-card-deltas').innerText()).replace(/\s+/g,' '),/^-\$12\.40 \(-0\.04%\) Today \+\$[0-9,.]+ \(\+[0-9.]+%\) 1M$/);
  for(const card of await cards.all())assert.equal(await card.locator('.pf-spark-host svg').count(),2,'a trendline over its daily bars');
  assert.equal(await cards.nth(1).locator('.pf-spark-host polyline.pf-s'+(await cards.nth(1).locator('.pf-key').getAttribute('class')).match(/pf-k(\d)/)[1]).count()>=1,true,'the trendline wears the account\'s colour');
  assert.equal(await page.locator('#pfCards a button, #pfCards a a').count(),0,'a card holds no control inside it');
  await cards.nth(1).click();
  await page.getByText('Account details · Schwab',{exact:true}).waitFor();
  assert.match(await page.locator('.details-header h1').innerText(),/···0001/);
  const url=new URL(page.url());assert.deepEqual([url.searchParams.get('view'),url.searchParams.get('sub'),url.searchParams.get('account'),url.searchParams.get('connection')],['accounts','details',F.ACCOUNT.accountId,F.ACCOUNT.connectionKey]);
  await page.locator('[data-details-back]').click();await page.locator('#pfValueChart svg').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('account'),null,'back on the overview, the address names no account');
  await settled(page);assert.deepEqual(h.calls().filter(line=>!line.startsWith('GET ')),[],'the tap only navigates');assert.deepEqual(errors,[]);await close();
 }
});

test('the line under "Is it trading?" and each card say when the approval ends; one ending before the next trade says so and links to Strategy settings and approval',async t=>{
 const h=await overviewHost(t,F.seedPortfolio),browser=await chromium.launch();t.after(()=>browser.close());
 const card=(page,account)=>page.locator('[data-pf-account="'+F.keyOf(account)+'"]'),flat=text=>text.replace(/\s+/g,' ').trim();
 for(const width of [1440,412]){
  h.state.requests.length=0;
  const {page,errors,close}=await open(browser,h,width);await settled(page);
  assert.deepEqual((await page.locator('.pf-approvals li').allInnerTexts()).map(flat),['Example margin ···0001 Approval ends Nov 30, before the Dec 1 trade. Strategy settings and approval','Example IRA ···0002 Approval ends Dec 2.'],'the one that needs the owner first');
  assert.equal(await page.locator('.pf-approvals li.is-warn').count(),1);
  assert.equal(flat(await card(page,F.ACCOUNT).locator('.pf-approval').innerText()),'Approval ends Nov 30, before the Dec 1 trade. Strategy settings and approval');
  assert.equal(await card(page,F.ACCOUNT).locator('.pf-approval.is-warn a[data-pf-approval]').count(),1);
  assert.equal(await card(page,F.IRA).locator('.pf-approval').innerText(),'Approval ends Dec 2.');assert.equal(await card(page,F.IRA).locator('.pf-approval a').count(),0,'a plain date has no link');
  assert.equal(await card(page,F.CASH).locator('.pf-approval').count(),0,'no approval, no line');
  for(const link of await page.locator('[data-pf-approval]').all())assert.ok((await link.boundingBox()).height>=44,'the link is at least 44 pixels high');
  await (width===1440?card(page,F.ACCOUNT).locator('[data-pf-approval]'):page.locator('.pf-approvals [data-pf-approval]')).click();
  await page.waitForFunction(()=>document.querySelector('#nativeStrategySettings')?.open===true);
  assert.equal(await page.locator('#nav button.on').innerText(),'Strategies');
  const url=new URL(page.url());assert.deepEqual([url.searchParams.get('view'),url.searchParams.get('account'),url.searchParams.get('connection')],['strategies',F.ACCOUNT.accountId,F.ACCOUNT.connectionKey]);
  await page.waitForFunction(()=>{const box=document.querySelector('#nativeStrategySettings').getBoundingClientRect();return box.top>=-1&&box.top<innerHeight;});
  await settled(page);assert.deepEqual(h.calls().filter(line=>!line.startsWith('GET ')),[],'the link only navigates');assert.deepEqual(errors,[]);await close();
 }
});

test('the comparison draws each account with SPY and BIL from the same day, and a price read that fails is said, not drawn',async t=>{
 const h=await overviewHost(t,F.seedPortfolio),browser=await chromium.launch();t.after(()=>browser.close());
 const want=expected('1M'),spy=S.benchmarkSeries(S.closesOf(F.benchmarkBars('SPY')),want.compareDays);
 let {page,errors,close}=await open(browser,h,1440,{wait:'#pfCompareChart polyline.pf-bench-b'});
 const legend=(await page.locator('.pf-legend li').allInnerTexts()).map(text=>text.replace(/\s+/g,' '));
 assert.equal(legend.length,5);
 assert.ok(legend.includes('S&P 500 (SPY) '+C.signedPercent(spy.points.filter(p=>p.pct!==null).at(-1).pct)));
 for(const a of want.accounts)assert.ok(legend.includes(F.LABELS[a.key]+' '+C.signedPercent(a.span.pct)),F.LABELS[a.key]);
 assert.equal(await page.locator('#pfCompareChart polyline.pf-bench-a').count(),1);
 assert.match(await page.locator('#pfCompare').innerText(),/SPY and BIL from the close of Oct 13, 2026\./);
 assert.match(await page.locator('#pfCompare').innerText(),/change in value includes deposits and withdrawals; SPY and BIL are price change only/);
 await page.locator('#pfCompare .pf-twin summary').click();
 assert.equal(await page.locator('#pfCompare .pf-twin tbody tr').count(),want.compareDays.length,'the comparison has its table');
 const hit=page.locator('#pfCompareChart .pf-hit').last(),box=await hit.boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 assert.match(await page.locator('#pfTip').innerText(),/Nov 12, 2026[\s\S]*S&P 500 \(SPY\)/,'the tooltip lists every line on that day');
 assert.deepEqual(errors,[]);await close();
 h.state.barsFail=true;
 ({page,errors,close}=await open(browser,h,412));
 await page.locator('#pfCompare',{hasText:'prices could not be read just now'}).waitFor();
 assert.match(await page.locator('#pfCompare').innerText(),/S&P 500 \(SPY\) and Treasury bills \(BIL\) prices could not be read just now\./);
 assert.equal(await page.locator('#pfCompareChart polyline.pf-bench-a, #pfCompareChart polyline.pf-bench-b').count(),0);
 assert.equal(await page.locator('.pf-legend li').count(),3);assert.deepEqual(errors,[]);await close();
});

test('the holdings table lists every position across accounts, sorts by each column and leaves unknown figures as a dash',async t=>{
 const h=await overviewHost(t,F.seedPortfolio),browser=await chromium.launch();t.after(()=>browser.close());
 const total=F.brokerAccounts().reduce((n,a)=>n+a.equity,0);
 for(const width of [1440,412]){
  const {page,errors,close}=await open(browser,h,width,{wait:'#pfPositions .pf-holdings'});
  await page.locator('#pfPositions',{hasText:'Read from your broker at'}).waitFor();
  const rows=page.locator('#pfPositions tbody tr');assert.equal(await rows.count(),6);
  assert.deepEqual(await rows.locator('td:first-child').allInnerTexts(),['VTI','BIL','BND','GLD','SPY','EXMP'].sort((a,b)=>({VTI:38400,BIL:18670.08,GLD:6043.3,SPY:6180.3,EXMP:F.valueOn(F.CASH,F.TODAY)-2100,BND:F.valueOn(F.IRA,F.TODAY)-1250-38400})[b]-({VTI:38400,BIL:18670.08,GLD:6043.3,SPY:6180.3,EXMP:F.valueOn(F.CASH,F.TODAY)-2100,BND:F.valueOn(F.IRA,F.TODAY)-1250-38400})[a]),'value, largest first');
  const vti=await rows.filter({hasText:'VTI'}).locator('td').allInnerTexts();
  assert.deepEqual(vti,['VTI',F.LABELS[F.IRA.connectionKey+'|'+F.IRA.accountId],'120','$38,400.00',(38400/total*100).toFixed(2)+'%','—','+$3,600.00']);
  assert.equal((await rows.filter({hasText:'BND'}).locator('td').allInnerTexts())[6],'—','a gain the broker does not report is a dash');
  await page.locator('[data-pf-sort="symbol"]').click();
  assert.deepEqual(await rows.locator('td:first-child').allInnerTexts(),['BIL','BND','EXMP','GLD','SPY','VTI']);
  assert.equal(await page.locator('th:has([data-pf-sort="symbol"])').getAttribute('aria-sort'),'ascending');
  await page.locator('[data-pf-sort="symbol"]').click();
  assert.deepEqual(await rows.locator('td:first-child').allInnerTexts(),['VTI','SPY','GLD','EXMP','BND','BIL']);
  await page.locator('[data-pf-sort="gain"]').click();
  assert.deepEqual(await rows.locator('td:first-child').allInnerTexts(),['VTI','SPY','BIL','GLD','EXMP','BND'],'largest gain first, the unknown one last');
  assert.ok(await noSideways(page),'the table scrolls inside its panel, not the page');assert.deepEqual(errors,[]);await close();
 }
});

test('the Trading status tab is one tap away, from its tab and from See why, and its cards and words are the ones the first screen had',async t=>{
 const h=await overviewHost(t,F.seedPortfolio),browser=await chromium.launch();t.after(()=>browser.close());
 for(const width of [1440,412]){
  h.state.requests.length=0;
  const {page,errors,close}=await open(browser,h,width);await settled(page);
  const strip=await page.locator('.pf-strip p').innerText();
  assert.match(strip,/^Is it trading\? (Yes|Partly|No)\. /);
  await page.locator('.pf-strip').getByRole('button',{name:'See why'}).click();
  await page.locator('#homeCards [data-story]').first().waitFor();
  assert.equal(new URL(page.url()).searchParams.get('sub'),'status');
  assert.equal(await page.locator('[data-accounts-tab="status"]').getAttribute('aria-selected'),'true');
  assert.equal(strip,await page.locator('#homeTop .story-answer').innerText(),'the line on the overview is the status tab\'s own headline');
  const cards=page.locator('#homeCards [data-story]');
  assert.deepEqual(await cards.evaluateAll(list=>list.map(c=>c.getAttribute('data-story-kind'))).then(k=>k.slice(0,3)),['connected','connected','connected']);
  for(const card of await cards.all()){assert.equal(await card.locator('button').count(),1,'one button per card');assert.ok(await card.locator('a').count()<=1);}
  const margin=page.locator('#homeCards [data-story="'+F.ACCOUNT.connectionKey+'|'+F.ACCOUNT.accountId+'"]');
  assert.match(await margin.innerText(),/Example margin ···0001\s+CONNECTED ACCOUNT\s+RUNNING\s*MOSTLY PARKED/i);
  assert.deepEqual(await margin.locator('[data-story-part]').evaluateAll(parts=>parts.map(p=>p.getAttribute('data-story-part'))),['plan','today','value']);
  assert.equal(await page.locator('#homeBroker').evaluate(el=>el.open),false,'the closed broker section is still there');
  await page.screenshot({path:path.join(PROOF,'trades-status-tab-'+width+'.png'),fullPage:true});
  await page.locator('[data-accounts-tab="overview"]').click();await page.locator('#pfValueChart svg').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('sub'),null);
  await page.locator('[data-accounts-tab="status"]').click();await page.locator('#homeCards [data-story]').first().waitFor();
  await page.goBack().catch(()=>null);
  await settled(page);assert.deepEqual(h.calls().filter(line=>!line.startsWith('GET ')),[],'switching tabs changes nothing');assert.ok(await noSideways(page));assert.deepEqual(errors,[]);await close();
 }
});

test('a person with no connected account sees how to connect one, with no broker price read and no page error',async t=>{
 const h=await overviewHost(t,()=>{},{roster:[]}),browser=await chromium.launch();t.after(()=>browser.close());
 for(const width of [1440,412]){
  h.state.requests.length=0;
  const {page,errors,close}=await open(browser,h,width,{wait:'[data-pf-empty]'});await settled(page);
  assert.match(await page.locator('#pfHero').innerText(),/Connect your brokerage account[\s\S]*Settings, Connections[\s\S]*Discover accounts/);
  assert.equal(await page.locator('#pfCards .pf-card').count(),0);assert.equal(await page.locator('#pfCompare').isVisible(),false);assert.equal(await page.locator('#pfPositions').isVisible(),false);
  assert.match(await page.locator('.pf-strip p').innerText(),/^Is it trading\? /);
  assert.equal(h.calls().some(line=>line.includes('/bars')),false,'nothing to compare, so no price read');
  await page.locator('[data-pf-go="settings"]').click();await page.locator('#settingsBody #rosterPanel #discoverBtn').waitFor();
  await page.locator('#settingsClose').click();
  assert.deepEqual(h.calls().filter(line=>!line.startsWith('GET ')),[]);assert.ok(await noSideways(page));assert.deepEqual(errors,[]);await close();
 }
 h.state.rosterFails=true;
 const {page,errors,close}=await open(browser,h,412,{wait:'[data-pf-empty="unread"]'});
 assert.match(await page.locator('#pfHero').innerText(),/Your accounts could not be read just now[\s\S]*Press Refresh to try again\./,'a roster that cannot be read is never said as no account');
 assert.equal(await page.locator('#pfHero').getByText('Connect your brokerage account').count(),0);assert.deepEqual(errors,[]);await close();
});

test('when a saved-record read fails the screen says so in one line and draws the former landing',async t=>{
 const h=await overviewHost(t,F.seedPortfolio),browser=await chromium.launch();t.after(()=>browser.close());h.state.fail='values';
 const {page,errors,close}=await open(browser,h,412,{wait:'#tiles .tile'});
 await page.locator('#tiles .tile',{hasText:'···0001'}).getByRole('link',{name:'Manage strategy →'}).waitFor();
 assert.equal(await page.locator('#homeFallback').innerText(),'Saved activity could not be read, so balances read from your broker are shown instead. Reason: the server could not answer just now. Try again in a moment.');
 assert.equal(await page.locator('#pfRoot').count(),0);assert.ok(await noSideways(page));assert.deepEqual(errors,[]);await close();
});
