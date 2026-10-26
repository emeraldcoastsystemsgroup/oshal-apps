/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Independent NYSE session and read contracts: holidays/early closes, incomplete sessions, caller-only selectors, bounded concurrency and conflicting price overlap. Synthetic history only.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sessionDates,lastCompletedSession,portfolioResearchWindow}=require('../routes/trading-portfolio-calendar');
const {portfolioHistory}=require('../routes/trading-portfolio-history');
const config={assets:[{symbol:'ABC',weightPct:100}],lookbackSessions:252};
const now=new Date('2026-10-25T06:00:00Z');
test('NYSE calendar includes the mourning closure and distinguishes a completed early close from a still publishing bar',()=>{
 assert.deepEqual(sessionDates('2025-01-08','2025-01-10'),['2025-01-08','2025-01-10']);
 assert.deepEqual(sessionDates('2026-07-02','2026-07-06'),['2026-07-02','2026-07-06']);
 assert.equal(lastCompletedSession(new Date('2026-12-24T18:10:00Z')),'2026-12-23');
 assert.equal(lastCompletedSession(new Date('2026-12-24T18:16:00Z')),'2026-12-24');
 assert.equal(lastCompletedSession(new Date('2026-12-25T23:00:00Z')),'2026-12-24');
 assert.throws(()=>sessionDates('2023-01-01','2024-01-01'),e=>e.code==='calendar_unavailable');
});
test('historical reads carry only caller-owned connection/data selectors and exclude unfinished prices',async()=>{
 let active=0,max=0;const calls=[];
 const ctx={intent:async(name,input)=>{calls.push({name,input});active++;max=Math.max(max,active);await Promise.resolve();active--;return{symbol:input.symbol,source:'schwab',bars:[{t:Date.parse('2026-10-23T05:00:00Z')/1000,c:100},{t:Date.parse('2026-10-26T05:00:00Z')/1000,c:200}]};}};
 const history=await portfolioHistory(ctx,'own-login',config,'2025-10-24','2026-10-23',now);
 assert.equal(calls.length,4);assert.ok(max<=2);assert.equal(history.series.ABC.length,1);assert.equal(history.lastCompletedSession,'2026-10-23');
 for(const {name,input}of calls){assert.equal(name,'trading.bars');assert.equal(input.connection,'own-login');assert.deepEqual(Object.keys(input).sort(),['connection','end','symbol','timeframe']);}
 await assert.rejects(()=>portfolioHistory(ctx,'own-login',config,'2026-01-01','2026-10-26',now),e=>e.code==='window_invalid');
});
test('conflicting overlap and wrong symbol/source fail instead of manufacturing a stable history',async()=>{
 let call=0;
 await assert.rejects(()=>portfolioHistory({intent:async(_n,input)=>({symbol:input.symbol,source:'schwab',bars:[{t:Date.parse('2026-10-23T05:00:00Z')/1000,c:100+(call++)}]})},'own-login',config,'2025-10-24','2026-10-23',now),e=>e.code==='history_changed');
 await assert.rejects(()=>portfolioHistory({intent:async()=>({symbol:'WRONG',source:'schwab',bars:[]})},'own-login',config,'2026-01-02','2026-10-23',now),e=>e.code==='history_invalid');
});

test('Monday and holiday research defaults stop on the most recent completed NYSE session',()=>{
 assert.equal(portfolioResearchWindow(new Date('2026-10-26T12:00:00Z')).latestCompletedSession,'2026-10-23');
 assert.equal(portfolioResearchWindow(new Date('2026-10-26T20:10:00Z')).latestCompletedSession,'2026-10-23');
 assert.equal(portfolioResearchWindow(new Date('2026-10-26T20:16:00Z')).latestCompletedSession,'2026-10-26');
 assert.equal(portfolioResearchWindow(new Date('2026-11-26T23:00:00Z')).latestCompletedSession,'2026-11-25');
 assert.equal(portfolioResearchWindow(new Date('2028-01-20T23:00:00Z')).available,false);
 assert.deepEqual(sessionDates('2024-03-28','2024-04-01'),['2024-03-28','2024-04-01']);
});
