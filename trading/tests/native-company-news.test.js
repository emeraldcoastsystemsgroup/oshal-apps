/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify exact-symbol company news, publication bounds, safe navigation, deduplication and honest transport failures; all provider data is synthetic.
 */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),vm=require('node:vm');
const file=path.resolve(__dirname,'../routes/trading-company-news.js'),NOW=Date.parse('2026-10-15T20:00:00Z');
const row=(extra={})=>({id:1,related:'NVDA',headline:'Synthetic company headline',summary:'Synthetic source summary',source:'Fixture publisher',url:'https://publisher.example/story',datetime:NOW/1000-100,...extra});
const load=()=>{const m=new Module(file);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(fs.readFileSync(file,'utf8'),file);return m.exports;};
test('news retains publication, source, retrieval window and exact symbol, sorted newest first',()=>{
 const r=load().companyNews([row(),row({id:2,url:'https://publisher.example/new',datetime:NOW/1000-1,related:'MPC, NVDA'})],'NVDA',NOW);
 assert.deepEqual(r.items.map(x=>x.id),[2,1]);assert.equal(r.items[0].createdAt,'2026-10-15T19:59:59.000Z');assert.equal(r.items[0].source,'Fixture publisher');
 assert.equal(r.coverage.fetchedAt,'2026-10-15T20:00:00.000Z');assert.equal(r.coverage.from,'2026-10-08T20:00:00.000Z');assert.equal(r.coverage.excluded,0);
});
test('malformed, future, stale, wrong-symbol and executable links cannot become headlines',()=>{
 for(const extra of [{datetime:NOW/1000+1},{datetime:NOW/1000-7*86400-1},{datetime:'2026-10-15'}, {related:'NVDAX'},{url:'javascript:alert(1)'},{url:'data:text/html,x'},{url:'https://user:secret@example.org/x'},{url:'/relative'}, {headline:''},{id:NaN},{summary:{secret:'bad'}},{source:''}])
  assert.throws(()=>load().companyNews([row(extra)],'NVDA',NOW),/no usable/);
});
test('duplicates and invalid returned entries are counted; valid empty arrays remain successful empty reads',()=>{
 const r=load().companyNews([row(),row(),row({related:'MPC'})],'NVDA',NOW);assert.equal(r.items.length,1);assert.equal(r.coverage.excluded,2);
 assert.equal(load().companyNews([],'NVDA',NOW).items.length,0);
 for(const raw of [null,{error:'credential=fixture-secret'},Array(5001).fill(row())]) assert.throws(()=>load().companyNews(raw,'NVDA',NOW),/invalid/);
});
test('bounded output retains only 25 newest articles and limits summary length',()=>{
 const r=load().companyNews(Array.from({length:30},(_,i)=>row({id:i,url:'https://publisher.example/'+i,datetime:NOW/1000-i,summary:'x'.repeat(3000)})),'NVDA',NOW);
 assert.equal(r.items.length,25);assert.equal(r.items[0].id,0);assert.equal(r.items[0].summary.length,2000);
});
test('each request re-enters fenced fetch without keys or shared result cache',async t=>{
 const original=global.fetch;t.after(()=>{global.fetch=original;});const requests=[];
 global.fetch=async(url,init)=>{requests.push({url,init});return {ok:true,json:async()=>[]};};
 const api=load();await api.readCompanyNews('NVDA');await api.readCompanyNews('NVDA');assert.equal(requests.length,2);
 for(const r of requests){const u=new URL(r.url);assert.equal(u.origin,'https://finnhub.io');assert.equal(u.pathname,'/api/v1/company-news');assert.equal(u.searchParams.get('symbol'),'NVDA');assert.equal(u.searchParams.has('token'),false);assert.deepEqual(r.init.headers,{Accept:'application/json'});assert.equal(r.init.redirect,'error');}
 await assert.rejects(api.readCompanyNews('https://evil.example'),/invalid/);assert.equal(requests.length,2);
});
test('transport, authorization, throttling, bad JSON and vendor error objects fail visibly without raw vendor secrets',async t=>{
 const original=global.fetch;t.after(()=>{global.fetch=original;});
 for(const response of [new Error('fixture-secret'),{ok:false,status:401},{ok:false,status:403},{ok:false,status:429},{ok:false,status:500},{ok:true,json:async()=>{throw Error('fixture-secret');}},{ok:true,json:async()=>({error:'fixture-secret'})}]){
  global.fetch=async()=>{if(response instanceof Error)throw response;return response;};
  await assert.rejects(load().readCompanyNews('NVDA'),e=>/news|Finnhub/.test(e.message)&&!/fixture-secret/.test(e.message));
 }
});
test('renderer escapes source content, rejects executable URLs and preserves news provenance in handoff',()=>{
 const scope={URL,esc:x=>String(x).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),fmtDate:x=>x};vm.createContext(scope);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../tools/ui/view-research.js'),'utf8'),scope);
 const j={symbol:'NVDA',sections:{news:'ok'},news:[{headline:'<script>fixture</script>',url:'javascript:alert(1)',source:'<publisher>',createdAt:'2026-10-15'}],newsCoverage:{source:'Finnhub company news',from:'2026-10-08',through:'2026-10-15',fetchedAt:'2026-10-15T20:00:00Z',excluded:2,note:'Synthetic coverage'}};
 const html=scope.researchNewsHtml(j);assert.doesNotMatch(html,/href=|<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/retrieved/);assert.match(html,/Excluded 2/);
 assert.match(scope.researchSummaryText(j),/Finnhub company news.*retrieved/);
});

test('manifest admits only the declared Finnhub host with a lowercase kernel-injected credential header',()=>{
 const text=fs.readFileSync(path.resolve(__dirname,'../oshal-app.yaml'),'utf8');assert.match(text,/connectors: \[finnhub\]/);assert.match(text,/host: finnhub\.io\s+credential: \{ connector: finnhub, header: x-finnhub-token \}/);assert.doesNotMatch(text,/header: X-Finnhub/);
});
