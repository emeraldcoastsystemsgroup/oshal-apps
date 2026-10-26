/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Preserve the exact native daily amount while asserting its open-position scope on desktop and phone.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Render the shipped Schwab landing and holdings view on desktop and phone; native provider/SQL results are named fixture seams, no real orders execute.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A measured Schwab account day change shows on its tile and counts toward the headline total (it had read "$0 today").
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {standIns,loadShipped} = require('./support/native-landing-host');
const PKG = path.resolve(__dirname,'..');
const TOOLCHAIN = path.resolve(process.env.STORE_CI_TOOLCHAIN || (process.env.OSHAL_FRAMEWORK ? path.join(process.env.OSHAL_FRAMEWORK,'node_modules') : path.resolve(PKG,'../scripts/toolchain/node_modules')));
const express = require(path.join(TOOLCHAIN,'express'));
const {chromium} = require(path.join(TOOLCHAIN,'playwright'));

test('Schwab balances and holdings are usable on desktop and phone with no live-order controls',async t => {
  const accounts = [{accountId:'own-account',connectionKey:'own-login',accountMasked:'…1234',accountType:'margin',broker:'schwab',equity:12500,cash:2500,buyingPower:5000,dayChange:-40,dayChangePct:-0.32,kind:'live',notTrading:true,positions:[{symbol:'NVDA',qty:20,marketValue:10000}]}];
  const modules = standIns({express});
  modules['@/features/trading'] = {...modules['@/features/trading'],nativeSchwabReads:true};
  let historyFailure = false;
  const ctx = {pool:{query:async () => ({rows:[],rowCount:0})},intent:async (name,input) => {
    if (name === 'trading.accounts') return {accounts,errors:[],readAt:'2026-10-14T15:00:00Z'};
    if (name === 'trading.transactions' && historyFailure) throw Error('failed chunk');
    if (name === 'trading.transactions') return {accountId:'own-account',accountBinding:'stable-binding',transactions:[{transactionId:'fill-1',orderId:'order-1',tradeDate:'2026-10-01T14:00:00.000Z',side:'sell',symbol:'NVDA',qty:8,price:100,fees:0.01}],unsupported:[]};
    if (name === 'trading.reconciliation.ledger') return {accountId:'own-account',accountBinding:'stable-binding',status:'no-ledger',bookId:null,orders:[]};
    if (name === 'trading.config') return {configured:true};
    if (name === 'trading.bars') return {symbol:'NVDA',timeframe:'1Day',source:'schwab',bars:[{t:123456,o:490,h:505,l:485,c:500,v:20000}]};
    if (name === 'personal_jobs.list') return {schedules:[]};
    throw new Error('unexpected native intent '+name);
  }};
  const app = express();
  app.use(express.json());
  app.use((req,_res,next) => {req.oshalCallerSub='browser-owner';req.userSub='browser-owner';next();});
  const api = express.Router();
  api.get('/',(_req,res) => res.sendFile(path.join(PKG,'tools/trading.html')));
  api.use('/ui',express.static(path.join(PKG,'tools/ui')));
  let charts;
  loadShipped(modules,load => {
    load('trading-accounts-routes').registerTradingAccountRoutes(api,ctx);
    load('trading-routes-book-read-builders').registerTradingBookReadRoutes(api,ctx,PKG);
    load('trading-research-routes').registerTradingResearchRoutes(api,ctx);
    charts = load('trading-charts-routes').createTradingChartsRoutes(ctx);
  });
  app.use('/api/trading-charts',charts); app.use('/api/trading',api);
  app.get('/api/v1/agent/schedules',(_req,res) => res.json({schedules:[]}));
  app.get(/^\/shared\/.*\.js$/,(_req,res) => res.type('js').send(''));
  app.get(/^\/shared\/.*\.css$/,(_req,res) => res.type('css').send(''));
  const server = await new Promise(resolve => {const server=app.listen(0,'127.0.0.1',() => resolve(server));});
  const browser = await chromium.launch();
  t.after(async () => {await browser.close();await new Promise(resolve => server.close(resolve));});
  for (const width of [1280,412]) {
    const context = await browser.newContext({viewport:{width,height:900},locale:'en-US'});
    const page = await context.newPage();const errors=[];page.on('pageerror',e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/api/trading/`);
    const tile = page.locator('#tiles .tile',{hasText:'Account …1234'});
    await tile.getByRole('button',{name:'View holdings'}).waitFor();
    assert.match(await tile.innerText(),/VIEW-ONLY[\s\S]*\$12,500/);
    assert.equal(await page.locator('#heroTotal').innerText(),'$12,500');
    assert.match(await page.locator('#heroDay').innerText(),/-\$40[\s\S]*open-position day P&L/,'a measured Schwab day change counts toward the total');
    assert.match(await tile.innerText(),/Open-position day P&L[\s\S]*-\$40/);
    // Exercise the shipped renderer with mixed known/unknown day changes, independently of the provider seam.
    await page.evaluate(() => paintHero({totalValue:12510,totalDayChange:10,accounts:[{dayChange:10},{dayChange:null}]},null,[]));
    assert.match(await page.locator('#heroDay').innerText(),/1 of 2 accounts report day change/);
    assert.match(await page.locator('#rollup').innerText(),/NVDA[\s\S]*20[\s\S]*\$10,000/);
    assert.doesNotMatch(await tile.innerText(),/Create book|Start trading/);
    await tile.getByRole('button',{name:'View holdings'}).click();
    assert.match(await page.locator('#main').innerText(),/NVDA[\s\S]*20[\s\S]*\$10,000/);
    assert.doesNotMatch(await page.locator('#main').innerText(),/Buy a stock|Create book/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth+1),'no phone-width overflow');
    await page.getByRole('button',{name:'View execution history'}).click();
    await page.getByRole('button',{name:'Download execution CSV'}).waitFor();
    assert.match(await page.locator('#nativeHistoryBody').innerText(),/1 equity executions/);
    assert.doesNotMatch(await page.locator('#main').innerText(),/Reading the last year/);
    assert.match(await page.locator('#nativeHistoryBody').innerText(),/sell[\s\S]*NVDA[\s\S]*8/);
    const downloadWait = page.waitForEvent('download');
    await page.getByRole('button',{name:'Download execution CSV'}).click();
    const download = await downloadWait;
    const csv = require('node:fs').readFileSync(await download.path(),'utf8');
    assert.match(csv,/stable-binding/);assert.match(csv,/fill-1/);assert.equal(csv.split('\r\n').length,2,'boundary duplicates export once');
    await page.getByRole('button',{name:'Holdings',exact:false}).click();
    historyFailure = true;
    await page.getByRole('button',{name:'View execution history'}).click();
    await page.getByText('No reconciliation or ledger changes were made.').waitFor();
    assert.equal(await page.getByRole('button',{name:'Download execution CSV'}).count(),0,'failed history cannot be exported as complete');
    historyFailure = false;
    await page.getByRole('button',{name:'Holdings',exact:false}).click();
    await page.getByRole('button',{name:'Reconcile ledger'}).click();
    await page.getByText('No filled engine ledger was found for this account.',{exact:false}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Record verified closes'}).count(),0);
    await page.getByRole('button',{name:'Holdings',exact:false}).click();
    await page.getByRole('button',{name:'All accounts'}).click();
    await page.locator('#tiles .tile',{hasText:'Account …1234'}).waitFor();
    assert.deepEqual(errors,[]);await context.close();
  }
});


test('native historical correction preview and confirmation work on desktop and phone',async t=>{
 const {setup}=require('./support/native-reconciliation-fixture');
 let fixture=setup();const app=express();app.use(express.json());
 app.get('/api/trading/',(_req,res)=>res.sendFile(path.join(PKG,'tools/trading.html')));
 app.use('/api/trading/ui',express.static(path.join(PKG,'tools/ui')));
 for(const [route,handler]of fixture.routes)app.post('/api/trading'+route,(req,res)=>{req.oshalCallerSub='owner';return fixture.routes.get(route)(req,res);});
 app.get('/api/trading/accounts',(_req,res)=>res.json({accounts:[],books:[]}));
 app.get('/api/trading/summary',(_req,res)=>res.json({accounts:[],positions:[],totalValue:0,totalDayChange:0}));
 app.use((_req,res)=>res.json({}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));}),browser=await chromium.launch();
 t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 // Use fresh owned ledger state for each viewport.
 for(const width of [1280,412]){
  fixture=setup();
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/api/trading/`);
  await page.waitForFunction(()=>typeof nativeAccountView==='function');
  await page.evaluate(()=>nativeAccountView({state:'ok',accountId:'opaque',connectionKey:'login',label:'Account …1234',equity:1000,cash:400,positions:[{symbol:'ANET',qty:6,marketValue:600}]}));
  await page.getByRole('button',{name:'Reconcile ledger'}).click();
  const apply=page.getByRole('button',{name:'Record verified closes'});await apply.waitFor();assert.equal(await apply.isDisabled(),true);
  assert.match(await page.locator('#nativeReconcileBody').innerText(),/1 verified historical closes/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'reconciliation fits the phone');
  await page.getByRole('checkbox').check();assert.equal(await apply.isEnabled(),true);
  if(width===1280){await apply.click();await page.getByText('1 historical closes recorded in the native ledger.',{exact:false}).waitFor();assert.equal(fixture.commits,1);assert.equal(fixture.stored.length,2);}
  assert.deepEqual(errors,[]);await context.close();
 }
});
