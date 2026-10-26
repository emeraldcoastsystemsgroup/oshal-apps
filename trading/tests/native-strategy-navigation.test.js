/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Drive dedicated Congress tab through source-bound basket save and actual monthly backtest routes on desktop/phone.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive the real Trading shell and navigation on desktop/phone: portfolio and existing Futures research coexist, old Tuning bookmarks still work, and opening native research neither calls the unavailable legacy optimizer nor writes any schedule/account. API/provider/storage and cockpit handoff fixtures are explicit seams.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {application}=require('./support/native-portfolio-host');
const PKG=path.resolve(__dirname,'..');
const TOOLCHAIN=path.resolve(process.env.STORE_CI_TOOLCHAIN||(process.env.OSHAL_FRAMEWORK?path.join(process.env.OSHAL_FRAMEWORK,'node_modules'):path.resolve(PKG,'../scripts/toolchain/node_modules')));
const express=require(path.join(TOOLCHAIN,'express')),{chromium}=require(path.join(TOOLCHAIN,'playwright'));
async function host(t,native=true,congress=false){
 const fixture=application(),app=fixture.app;
 if(congress){
  const dates=require('../routes/trading-portfolio-calendar').sessionDates('2024-01-02','2026-10-23'),original=fixture.ctx.intent;
  const trade={ticker:'ABC',representative:'Fixture House Filer',chamber:'House',direction:'buy',transactionDate:'2026-10-01',disclosureDate:'2026-10-22',transactionType:'Purchase',amount:'$1,001 - $15,000',assetDescription:'Fixture Common Stock',ptrLink:'https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/fixture.pdf',source:'quiver-congress'};
  fixture.ctx.intent=async(name,input)=>name==='feeds.congress_trades'?{source:'world_congress_trades',trades:input.chamber==='House'?[trade,{...trade,ticker:'DEF',assetDescription:'Second Fixture Common Stock'}]:[]}:name==='trading.bars'?{symbol:input.symbol,source:'schwab',bars:dates.map((date,n)=>({t:Date.parse(date+'T05:00:00Z')/1000,c:input.symbol==='ABC'?100+n/10:100}))}:original(name,input);
  app.get('/api/trading/reports/congress',async(req,res)=>res.json(req.query.candidate==='long-term'?await require('../routes/trading-congress-candidates').readCongressCandidates(fixture.ctx,new Date('2026-10-25T12:00:00Z')):{status:'ok',rows:[],trades:[trade]}));
 }

 app.get('/api/trading/accounts',(_req,res)=>res.json({nativeReadOnly:native,accounts:[],books:[]}));
 app.get('/api/trading/status',(_req,res)=>res.json({liveEnabled:false,paperConfigured:false,liveConfigured:false,guardrails:{}}));
 app.get('/api/trading/autopilot/futures',(_req,res)=>res.json({native:true,schedule:null,runs:[],note:'Synthetic unsaved study fixture.'}));
 app.get('/api/trading/autopilot/futures/predictions',(_req,res)=>res.json({predictions:[],summary:{}}));
 app.get('/api/trading/autopilot/futures/archive',(_req,res)=>res.json({native:true,imports:[],needed:false}));
 app.get('/api/trading/autopilot/futures/sources/schwab/capture',(_req,res)=>res.json({native:true,needed:false,enabled:false,coverage:[],health:[]}));
 app.get('/api/trading/recommendations-tuning',(_req,res)=>res.json({pending:[],recent:[]}));
 app.get('/api/trading/params',(_req,res)=>res.json({params:[]}));
 app.get('/api/trading/',(_req,res)=>res.type('html').send(fs.readFileSync(path.join(PKG,'tools/trading.html'),'utf8')));
 app.use('/api/trading/ui',express.static(path.join(PKG,'tools/ui')));
 app.use('/api/trading-charts/vendor',express.static(path.join(PKG,'tools/vendor')));
 app.get(/^\/shared\/.*\.js$/,(_req,res)=>res.type('js').send(''));
 app.get(/^\/shared\/.*\.css$/,(_req,res)=>res.type('css').send(''));
 app.get('/cockpit/js/app-handoff.js',(_req,res)=>res.type('js').send('export function receiveHandoff() {}'));
 app.get('/cockpit/js/app-workflows.js',(_req,res)=>res.type('js').send('export async function mountConnectedActions() {}'));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 return 'http://127.0.0.1:'+server.address().port;
}
test('native Portfolio and Futures research remain reachable through buttons and legacy Tuning bookmarks',async t=>{
 const base=await host(t),browser=await chromium.launch();t.after(()=>browser.close());
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({method:r.method(),path:new URL(r.url()).pathname}));
  await page.goto(base+'/api/trading/?view=strategies');await page.getByRole('heading',{name:'Saved strategies',exact:true}).waitFor();
  await page.getByRole('button',{name:'Futures research →',exact:true}).click();
  await page.getByText('No Futures study saved yet.',{exact:false}).waitFor();
  assert.equal(await page.locator('#futSave').isVisible(),true);assert.equal(await page.locator('#optRunBtn').count(),0);
  assert.equal(await page.locator('#futSource').inputValue(),'schwab');assert.equal(await page.locator('#futSource').isDisabled(),true);assert.equal(await page.locator('#futCron').isVisible(),false);assert.match(await page.locator('#tabbody').innerText(),/02:15 New York, Tuesday through Saturday/);assert.equal(new URL(page.url()).searchParams.get('sub'),'tuning');
  await page.getByRole('button',{name:'Portfolio review',exact:true}).click();await page.getByRole('heading',{name:'Saved strategies',exact:true}).waitFor();
  for(const query of ['?view=strategies&sub=tuning','?tab=tuning']){
   await page.goto(base+'/api/trading/'+query);await page.getByText('No Futures study saved yet.',{exact:false}).waitFor();
   assert.equal(await page.locator('#futSave').isVisible(),true);assert.equal(await page.locator('#optRunBtn').count(),0);
  }
  assert.equal(requests.some(r=>r.path==='/api/trading/recommendations-tuning'||r.path==='/api/trading/params'),false,'native research never calls the legacy optimizer');
  assert.ok(requests.every(r=>r.method==='GET'),'navigation cannot save, arm, run or stop a study');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow at '+width);assert.deepEqual(errors,[]);await context.close();
 }
});
test('legacy Tuning retains its optimizer controls',async t=>{
 const base=await host(t,false),browser=await chromium.launch();t.after(()=>browser.close());const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/api/trading/?view=strategies&sub=tuning');await page.getByRole('button',{name:'Run optimization now',exact:true}).waitFor();
 assert.equal(await page.locator('#futSave').isVisible(),true);assert.deepEqual(errors,[]);
});

test('dedicated Congress tab opens a source-bound candidate draft, saves it and runs monthly research on desktop/phone',async t=>{
 const base=await host(t,true,true),browser=await chromium.launch();t.after(()=>browser.close());
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/api/trading/?view=research&sub=congress');
  await page.getByRole('heading',{name:'Congress purchase research',exact:true}).waitFor();
  await page.getByRole('checkbox',{name:'Select ABC',exact:true}).waitFor();assert.equal(await page.getByRole('checkbox',{name:'Select DEF',exact:true}).isChecked(),true);
  await page.getByRole('button',{name:'Load this basket into strategy review',exact:true}).click();
  const f=page.locator('form[data-portfolio="strategy"]');await f.waitFor();assert.equal(await f.locator('[name=kind]').inputValue(),'monthly-trend');assert.equal(await f.locator('[name=assets]').inputValue(),'ABC:50\nDEF:50');await f.locator('[name=assets]').fill('ABC:100');
  const strategyName='Congress fixture '+width;await f.locator('[name=name]').fill(strategyName);
  assert.equal(await f.evaluate(el=>el.checkValidity()),true,JSON.stringify(await f.locator(':invalid').evaluateAll(nodes=>nodes.map(n=>({name:n.name,value:n.value,message:n.validationMessage})))));
  const saved=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/portfolio/strategies')&&r.request().method()==='POST');await f.getByRole('button').click();
  assert.equal(await page.locator('#portfolioNotice.err').count(),0,await page.locator('#portfolioNotice').innerText());assert.deepEqual(errors,[]);
  const sr=await saved;assert.equal(sr.status(),200);const strategy=(await sr.json()).strategy;assert.equal(strategy.universeEvidence.selectedFilings[0].symbol,'ABC');assert.equal(strategy.universeEvidence.historicalCongressStrategyValidated,false);
  await page.getByText(/Saved\. No broker/).waitFor();const form=page.locator('form[data-portfolio="backtest"]');await form.locator('[name=strategyId]').selectOption(strategy.id);
  const response=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/portfolio/backtest')&&r.request().method()==='POST');await form.getByRole('button').click();
  const run=(await (await response).json()).run;assert.equal(run.status,'completed');assert.equal(run.result.model,'portfolio-monthly-v2');assert.equal(run.result.realOrdersPlaced,0);assert.match(run.result.assumptions.join(' '),/not a point-in-time backtest/);
  await page.locator('#portfolioRunDetail svg').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);await context.close();
 }
});
