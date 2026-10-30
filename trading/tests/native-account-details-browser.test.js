/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive dashboard links, charts, symbol/period changes, reload and empty/error account states at desktop and phone widths using synthetic evidence.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Holdings performance: gain/loss bars, the largest holding charted against SPY by default, a clicked holding charted instead, and the cash-account empty state.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {detailsHost}=require('./support/native-details-host');
const {chromium}=require(path.resolve(__dirname,'../../scripts/toolchain/node_modules/playwright'));
test('account details and strategy are distinct exact-account destinations on desktop and phone',async t=>{
 const h=await detailsHost();t.after(()=>new Promise(resolve=>h.server.close(resolve)));
 const browser=await chromium.launch();t.after(()=>browser.close());
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url());});
  await page.goto(h.base+'/api/trading/');
  const tile=page.locator('.tile').filter({hasText:'1234'});
  await tile.getByRole('link',{name:'Account details →',exact:true}).click();
  await page.getByRole('heading',{name:'Current holdings',exact:true}).waitFor();
  await page.getByRole('img',{name:'Recorded account value',exact:true}).waitFor();
  assert.equal(await page.locator('#nav button.on').innerText(),'Accounts');
  assert.match(await page.locator('[data-details-holdings]').innerText(),/ABC/);
  assert.match(await page.locator('[data-details-summary]').innerText(),/\$400.00/);
  await page.getByRole('img',{name:'Gain or loss since purchase by holding',exact:true}).waitFor();
  assert.match(await page.locator('[data-details-bars]').innerText(),/ABC[\s\S]*\+5\.26%[\s\S]*SPY|SPY[\s\S]*\+11\.11%/);
  await page.getByRole('heading',{name:'ABC vs. SPY',exact:true}).waitFor();
  await page.getByRole('img',{name:/^ABC [+-]?\d+\.\d\d% versus SPY 0\.00%$/}).waitFor();
  await page.getByRole('button',{name:'SPY',exact:true}).click();
  await page.getByRole('heading',{name:'SPY vs. SPY',exact:true}).waitFor();
  await page.getByRole('button',{name:'ABC',exact:true}).click();
  await page.getByRole('heading',{name:'ABC vs. SPY',exact:true}).waitFor();
  assert.equal(await page.locator('[data-details-compare]').inputValue(),'SPY');
  await page.locator('[data-details-period]').selectOption('1W');
  await page.locator('[data-details-status]').filter({hasText:'Updating'}).waitFor({state:'hidden'});
  assert.ok(await page.locator('[data-details-charts] svg').count()>=2);
  assert.equal(new URL(page.url()).searchParams.get('sub'),'details');
  await page.reload();await page.getByRole('heading',{name:'Current holdings',exact:true}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('account'),'a');
  assert.equal(await page.locator('#nativeAccountManagement').count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page overflow '+width);
  await page.getByRole('button',{name:'Manage strategy →',exact:true}).click();
  await page.getByRole('heading',{name:'Trading strategy',exact:true}).waitFor();
  assert.equal(await page.locator('#nav button.on').innerText(),'Strategies');
  assert.equal(new URL(page.url()).searchParams.get('account'),'a');
  await page.goto(h.base+'/api/trading/?view=accounts&sub=details&account=b&connection=owned-login');
  await page.getByText('This account currently holds cash.',{exact:true}).waitFor();
  await page.getByText('No open positions',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'ABC',exact:true}).count(),0);
  await page.goto(h.base+'/api/trading/?view=accounts&sub=details&account=a&connection=unowned');
  await page.getByRole('heading',{name:'Account page unavailable',exact:true}).waitFor();
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);await context.close();
 }
});
