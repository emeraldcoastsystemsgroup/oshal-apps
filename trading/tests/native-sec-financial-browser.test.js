/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the actual Research financial route and renderer at desktop/phone widths with named SEC/broker fixtures, retaining provenance and failure words.
 */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {standIns,loadShipped}=require('./support/native-landing-host');
const {documents}=require('./support/sec-financial-fixture');
const PKG=path.resolve(__dirname,'..');
const TOOLCHAIN=path.resolve(process.env.STORE_CI_TOOLCHAIN || (process.env.OSHAL_FRAMEWORK ? path.join(process.env.OSHAL_FRAMEWORK,'node_modules') : path.resolve(PKG,'../scripts/toolchain/node_modules')));
const express=require(path.join(TOOLCHAIN,'express')),{chromium}=require(path.join(TOOLCHAIN,'playwright'));

/** A component host serves the real route and source renderer; market/SQL/SEC transport is synthetic. */
function application() {
 const modules=standIns({express}),docs=documents(),original=global.fetch;
 modules['@/features/trading'].nativeSchwabReads=true;modules['@/app/routes/trading-routes-helpers'].resolveBook=async()=>({kind:'paper',ref:'paper'});
 global.fetch=async url=>{
  if(String(url).includes('/companyconcept/')){
   if(String(url).includes('CIK0000009999'))return {ok:false,status:503};
   const doc=docs.find(d=>String(url).endsWith('/'+d.taxonomy+'/'+d.tag+'.json'));assert.ok(doc);return {ok:true,status:200,json:async()=>doc};
  }
  if(String(url).includes('company_tickers'))return {ok:true,status:200,json:async()=>({0:{cik_str:1045810,ticker:'NVDA'},1:{cik_str:9999,ticker:'MPC'}})};
  return {ok:true,status:200,json:async()=>({filings:{recent:{form:[],filingDate:[],accessionNumber:[],primaryDocument:[],items:[]}}})};
 };
 const ctx={pool:{query:async()=>({rows:[]})},intent:async name=>{assert.equal(name,'prices.latest');return {prices:[{symbol:'NVDA',price:125,at:'2026-10-15T15:00:00Z'}],missing:[]};}};
 const app=express();app.use((req,_res,next)=>{req.oshalCallerSub='owned-component-fixture';next();});
 const api=express.Router();loadShipped(modules,load=>load('trading-research-routes').registerTradingResearchRoutes(api,ctx));app.use('/api/trading',api);
 app.get('/view.js',(_req,res)=>res.type('js').send(fs.readFileSync(path.join(PKG,'tools/ui/view-research.js'),'utf8')));
 app.get('/',(_req,res)=>res.send(`<!doctype html><meta name="viewport" content="width=device-width"><main id="main"></main><p id="summary"></p>
 <script>function esc(x){return String(x).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));}function st(k,v){return '<div>'+k+': '+v+'</div>';}function pct(x){return Number(x).toFixed(1)+'%';}function fmtDate(x){return x;}const documentFixture=true;</script>
 <script src="/view.js"></script><script>fetch('/api/trading/research/'+(new URLSearchParams(location.search).get('symbol')||'NVDA')).then(r=>r.json()).then(j=>{document.getElementById('main').innerHTML=researchFundHtml(j);document.getElementById('summary').textContent=researchSummaryText(j);});</script>`));
 return {app,restore:()=>{global.fetch=original;}};
}
test('annual financial data and independent failure are readable at desktop and phone widths',async t=>{
 const {app,restore}=application();t.after(restore);
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const browser=await chromium.launch();t.after(()=>browser.close());
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.getByRole('link',{name:'SEC financial source'}).waitFor();
  const text=await page.locator('#main').innerText();assert.match(text,/Revenue: \$100/);assert.match(text,/Net income: \$25/);assert.match(text,/2025-01-27 through 2026-01-25/);assert.match(text,/currency USD/);assert.match(text,/filed 2026-02-25/);assert.match(text,/retrieved/);assert.doesNotMatch(text,/FY2026/);
  assert.match(await page.locator('#summary').innerText(),/Source: SEC annual financial statements/);
  assert.match(await page.getByRole('link',{name:'SEC financial source'}).getAttribute('href'),/^https:\/\/data\.sec\.gov\/api\/xbrl\/companyconcept\//);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
  await page.goto('http://127.0.0.1:'+server.address().port+'/?symbol=MPC');await page.getByText(/unavailable.*503/).first().waitFor();
  assert.doesNotMatch(await page.locator('#main').innerText(),/Revenue: \$0|Net income: \$0/);assert.deepEqual(errors,[]);await context.close();
 }
});
