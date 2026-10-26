/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Collector timestamps and stored filing identities survive source-bound saving; missing, noncanonical and impossible timing never receives a disclosure-date fallback.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard source-bound congressional stock baskets, both-chamber coverage, delayed dates, primary links, duplicate resistance and refusal of forged/mismatched selections.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {congressStockDescription,projectCongressCandidates,readCongressCandidates,congressStrategyEvidence}=require('../routes/trading-congress-candidates');
const now=new Date('2026-10-25T12:00:00Z');
const trade=(extra={})=>({ticker:'ABC',representative:'A Filer',chamber:'House',direction:'buy',transactionDate:'2026-10-01',disclosureDate:'2026-10-22',transactionType:'Purchase',amount:'$1,001 - $15,000',assetDescription:'Example Corporation Common Stock',ptrLink:'https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/example.pdf',source:'quiver-congress',...extra});
const ctx=(trades,asked=[])=>({intent:async(name,input)=>{asked.push({name,input});return{source:'world_congress_trades',trades:input.chamber==='House'?trades:[]};}});
const config=()=>({modelVersion:2,kind:'monthly-trend',assets:[{symbol:'ABC',weightPct:100}],lookbackSessions:63,rebalanceSessions:20,topN:1,grossExposurePct:100,transactionCostBps:10,marginAprPct:null,maintenancePct:null,fractionalShares:true});
test('candidate projection excludes non-Congress, derivatives/funds, ambiguous descriptions and unavailable primary provenance',()=>{
 const good=trade();
 const bad=[{chamber:'Executive'},{direction:'sell'},{representative:'Unknown'},{assetDescription:'Common Stock Option Type: Call Strike $100'},{assetDescription:'SPY ETF'},{assetDescription:'Example Corp'},{ptrLink:'https://example.com/claim.pdf'},{source:'unverified'},{disclosureDate:'2026-10-26'},{transactionDate:'2026-11-01'},{disclosureDate:'2026-99-99'},{disclosureDate:'2026-01-01',transactionDate:'2025-12-01'}].map(extra=>trade(extra));
 const r=projectCongressCandidates([good,...bad],now);assert.equal(r.candidates.length,1);assert.equal(r.excluded,bad.length);assert.equal(r.candidates[0].symbol,'ABC');
 assert.match(r.note,/not a point-in-time backtest/);assert.match(r.note,/first-seen time/);
 for(const value of ['Stock Fund','Treasury Bond','Common Stock Put Option','Preferred Stock','Warrant Common Stock'])assert.equal(congressStockDescription(value),false);
});
test('one filer with repeated transactions cannot masquerade as multiple independent buyers',()=>{
 const t=trade(),r=projectCongressCandidates([t,t,trade({transactionDate:'2026-10-02'}),trade({representative:'B Filer'}),trade({ticker:'DEF'})],now);
 assert.equal(r.duplicates,1);assert.equal(r.candidates[0].symbol,'ABC');assert.equal(r.candidates[0].distinctBuyers,2);assert.equal(r.candidates[0].filings.length,3);
});
test('both chambers use bounded admitted reads and a saturated page remains explicitly incomplete',async()=>{
 const asked=[],r=await readCongressCandidates(ctx(Array.from({length:200},()=>trade()),asked),now);
 assert.equal(asked.length,2);assert.equal(r.possiblyTruncated,true);assert.equal(r.coverage[0].atReadLimit,true);
 for(const call of asked){assert.equal(call.name,'feeds.congress_trades');assert.deepEqual(Object.keys(call.input).sort(),['chamber','direction','limit','sinceDays']);assert.equal(call.input.limit,200);assert.equal(call.input.sinceDays,90);assert.equal(call.input.direction,'buy');}
 await assert.rejects(()=>readCongressCandidates({intent:async(_n,input)=>{if(input.chamber==='Senate')throw Error('unavailable');return{source:'world_congress_trades',trades:[]};}},now),e=>e.code==='congress_unavailable');
 await assert.rejects(()=>readCongressCandidates({intent:async()=>({source:'other',trades:[]})},now),e=>e.code==='congress_invalid');
});
test('strategy provenance is server-read and exact selected symbols/weights cannot be forged',async()=>{
 const evidence=await congressStrategyEvidence(ctx([trade()]),['ABC'],config(),now);assert.deepEqual(evidence.selectedSymbols,['ABC']);assert.equal(evidence.historicalCongressStrategyValidated,false);assert.equal(evidence.selectedFilings[0].filings[0].representative,'A Filer');
 for(const selection of [[],['ABC','ABC'],['OTHER']])await assert.rejects(()=>congressStrategyEvidence(ctx([trade()]),selection,config(),now),e=>e.code==='congress_selection_invalid');
 await assert.rejects(()=>congressStrategyEvidence(ctx([]),['ABC'],config(),now),e=>e.code==='congress_universe_changed');
 await assert.rejects(()=>congressStrategyEvidence(ctx([trade()]),['ABC'],{...config(),kind:'quarterly-rotation'},now),e=>e.code==='congress_selection_invalid');
});
test('filing identity and collector observation stay distinct from disclosure and missing timing stays unavailable',async()=>{
 const t=trade({tradeId:'stored-filing-1',observedAt:'2026-10-24T03:04:05.678Z'});
 const r=projectCongressCandidates([t,trade({representative:'B Filer'})],now),filings=r.candidates[0].filings;
 assert.equal(filings[0].tradeId,'stored-filing-1');assert.equal(filings[0].observedAt,t.observedAt);
 assert.equal(filings[1].observedAt,null,'disclosure date is never substituted for collection time');
 assert.deepEqual(r.observationCoverage,{filings:2,withObservedAt:1,unavailable:1});
 const retained=await congressStrategyEvidence(ctx([t]),['ABC'],config(),now);
 assert.equal(retained.selectedFilings[0].filings[0].observedAt,t.observedAt);assert.equal(retained.historicalCongressStrategyValidated,false);
 for(const observedAt of ['2026-10-26T01:00:00.000Z','2026-01-01T00:00:00.000Z','invalid','2026-10-24','2026-10-23T24:00:00.000Z']){
  const bad=projectCongressCandidates([trade({observedAt})],now);
  assert.equal(bad.candidates[0].filings[0].observedAt,null);assert.equal(bad.observationCoverage.unavailable,1);
 }
});
