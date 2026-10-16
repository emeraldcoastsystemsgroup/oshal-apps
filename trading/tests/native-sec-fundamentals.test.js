/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify period-first annual financial selection, coherent ratios, source identity, missing facts and filing provenance.
 */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {secFinancialSummary}=require('../routes/trading-sec-fundamentals');
const {CIK,FETCHED,current,prior,documents}=require('./support/sec-financial-fixture');
const summarize=docs=>secFinancialSummary(docs,CIK,'NVDA',FETCHED);
test('annual revenue and ratios retain their exact period, currency and filing without inventing fiscal labels',()=>{
 const f=summarize(documents());assert.equal(f.revenue,100);assert.equal(f.netIncome,25);assert.equal(f.revenueYoYPct,25);assert.equal(f.netMarginPct,25);assert.equal(f.fiscalYear,null);
 assert.deepEqual(f.period,{start:current.start,end:current.end});assert.equal(f.currency,'USD');assert.equal(f.fetchedAt,FETCHED);
 assert.equal(f.metrics.revenue.accession,current.accn);assert.equal(f.metrics.revenue.concept,'Revenues');assert.equal(f.metrics.priorRevenue.end,prior.end);
 assert.equal(f.metrics.revenue.url,'https://data.sec.gov/api/xbrl/companyconcept/CIK0001045810/us-gaap/Revenues.json');
});
test('a superseded revenue tag cannot select an old year ahead of a newly reported concept',()=>{
 const docs=documents();docs[0].units.USD=[{...prior,start:'2021-01-25',end:'2022-01-23',filed:'2022-02-20',val:1000}];
 docs[1].units.USD=[{...current,val:120},{...prior,val:100,fy:2099}];
 const f=summarize(docs);assert.equal(f.revenue,120);assert.equal(f.period.end,'2026-01-25');assert.ok(Math.abs(f.revenueYoYPct-20)<1e-10);assert.equal(f.fiscalYear,null);
});
test('quarterly, instantaneous, invalid dates and future disclosures do not outrank annual facts',()=>{
 const docs=documents();docs[0].units.USD.push({...current,start:'2026-04-01',end:'2026-07-01',filed:'2026-08-01',fp:'Q2',form:'10-Q',val:500},
 {...current,start:undefined,val:501},{...current,start:'2025-02-30',val:502},{...current,filed:'2027-02-01',val:503});
 assert.equal(summarize(docs).revenue,100);
});
test('different annual periods or filing accessions never manufacture a margin',()=>{
 for(const change of [{start:prior.start,end:prior.end},{accn:'0001045810-26-000022'}]){
  const docs=documents();docs[4].units.USD=[{...current,val:25,...change}];const f=summarize(docs);assert.equal(f.netMarginPct,null);
  assert.ok(f.revenue===null || f.netIncome===null);assert.ok(f.missing.netMarginPct);
 }
});
test('growth needs adjacent prior annual revenue in the same filing, concept and currency',()=>{
 for(const change of [{accn:'0001045810-25-000021'},{end:'2025-01-25'},{val:0},{val:-10}]){
  const docs=documents();docs[0].units.USD=[{...current},{...prior,...change}];assert.equal(summarize(docs).revenueYoYPct,null);
 }
});
test('conflicting reported values stay missing instead of being selected arbitrarily',()=>{
 const docs=documents();docs[0].units.USD.push({...current,val:999});const f=summarize(docs);
 assert.equal(f.revenue,null);assert.equal(f.netIncome,25);assert.equal(f.netMarginPct,null);assert.ok(f.missing.revenue);
});
test('zero and losses are reported figures, not missing values',()=>{
 const docs=documents();docs[0].units.USD[0].val=0;docs[4].units.USD[0].val=-20;
 const f=summarize(docs);assert.equal(f.revenue,0);assert.equal(f.netIncome,-20);assert.equal(f.revenueYoYPct,-100);assert.equal(f.netMarginPct,null);
});
test('IFRS annual facts preserve their actual reporting currency',()=>{
 const docs=documents().map(d=>({...d,units:{}}));docs[5].units={EUR:[{...current,val:200},{...prior,val:100}]};docs[6].units={EUR:[{...current,val:50}]};
 const f=summarize(docs);assert.equal(f.currency,'EUR');assert.equal(f.revenue,200);assert.equal(f.netMarginPct,25);assert.equal(f.metrics.netIncome.taxonomy,'ifrs-full');
});
test('mixed currencies, wrong source identities and empty annual evidence refuse',()=>{
 const mixed=documents();mixed[4].units={CAD:[{...current,val:25}]};assert.throws(()=>summarize(mixed),/currencies/);
 const wrong=documents();wrong[0].cik=999;assert.throws(()=>summarize(wrong),/identity/);
 const tag=documents();tag[0].tag='Incorrect';assert.throws(()=>summarize(tag),/identity/);
 assert.throws(()=>summarize([]),/No supported annual/);
});
test('a later amended annual filing replaces older values only as one coherent context',()=>{
 const docs=documents(),amended={...current,filed:'2026-03-01',accn:'0001045810-26-000022',form:'10-K/A'};
 docs[0].units.USD.push({...amended,val:200});docs[4].units.USD.push({...amended,val:60});
 const f=summarize(docs);assert.equal(f.revenue,200);assert.equal(f.netIncome,60);assert.equal(f.netMarginPct,30);assert.equal(f.revenueYoYPct,null);
});

test('the bounded concept reader keeps 404s missing, preserves public cache time and stops on a failed source',async t=>{
 const original=global.fetch;t.after(()=>{global.fetch=original;});let calls=0;const docs=documents();
 global.fetch=async(url,init)=>{calls++;assert.equal(init.redirect,'error');assert.ok(init.headers['User-Agent'].includes('maintainer@'));
  const found=docs.find(d=>String(url).endsWith('/'+d.taxonomy+'/'+d.tag+'.json'));assert.ok(found);
  if(found.units.USD.length===0)return {ok:false,status:404,json:()=>{throw Error('do not parse unavailable evidence');}};
  return {ok:true,status:200,json:async()=>found};};
 const modulePath=require.resolve('../routes/trading-sec-financial-reader');delete require.cache[modulePath];
 const {readSecFinancialSummary}=require(modulePath);const first=await readSecFinancialSummary(CIK,'NVDA');assert.equal(calls,7);
 const second=await readSecFinancialSummary(CIK,'NVDA');assert.equal(calls,7);assert.equal(first.fetchedAt,second.fetchedAt);
 await assert.rejects(readSecFinancialSummary('../bad','NVDA'),/identity/);assert.equal(calls,7);
 global.fetch=async()=>{calls++;return {ok:false,status:429};};await assert.rejects(readSecFinancialSummary('0000000002','TEST'),/429/);assert.equal(calls,8);
});

test('the actual financial renderer keeps foreign currency and safely escapes source evidence',()=>{
 const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
 const esc=x=>String(x).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 const context=vm.createContext({esc,st:(k,v)=>k+': '+v,pct:String});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../tools/ui/view-research.js'),'utf8')+'\nthis.render={researchFundHtml,financialAmount};',context);
 const f={...summarize(documents()),currency:'EUR',summary:'<script>unsafe()</script>'};
 const html=context.render.researchFundHtml({fundamentals:f,sections:{fundamentals:'ok'}});
 assert.match(html,/100 EUR/);assert.doesNotMatch(html,/\$100|<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/SEC financial source/);
 assert.equal(context.render.financialAmount({...f,currency:'<img src=x>'},100),'—');
});
