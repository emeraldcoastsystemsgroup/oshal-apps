/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Causal moving-stop, gap-fill, funding, owner isolation and every-position evidence regressions. Synthetic prices only; no broker orders.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {backstopPolicy,advanceBackstop,dailyBackstopBars,dailyBackstopEvidence,wilderAtr,simulateBackstop}=require('../routes/live/backstop-model');
const {brokerStopCoverage}=require('../routes/live/backstops');
const {setup,binding}=require('./support/native-management-host');
const {sessionDates}=require('../routes/trading-portfolio-calendar');
const policy={modelVersion:1,trailPct:10,transactionCostBps:25};
function candles(){return sessionDates('2025-01-02','2026-10-23').map((date,i)=>({date,open:100+i/10,high:101+i/10,low:99+i/10,close:100+i/10}));}
function wire(rows){return rows.map(r=>({t:Date.parse(r.date+'T05:00:00Z')/1000,o:r.open,h:r.high,l:r.low,c:r.close}));}
test('backstop policy refuses unsupported knobs, unmeasured values and excessive trails',()=>{
 assert.deepEqual(backstopPolicy(policy),policy);
 for(const raw of [{...policy,margin:true},{...policy,trailPct:NaN},{...policy,trailPct:0.1},{...policy,trailPct:51},{...policy,transactionCostBps:101}])assert.throws(()=>backstopPolicy(raw));
});
test('long-position backstop ratchets upward, never down, and remembers a trigger',()=>{
 const observation=(price,seconds)=>({price,quantity:10,observedAt:new Date(Date.parse('2026-10-26T14:00:00Z')+seconds*1000).toISOString()});
 let s=advanceBackstop(null,observation(100,0),policy);assert.equal(s.peak,100);assert.equal(s.stop,90);
 s=advanceBackstop(s,observation(120,30),policy);assert.equal(s.stop,108);
 s=advanceBackstop(s,observation(110,60),policy);assert.equal(s.stop,108);assert.equal(s.triggered,false);
 s=advanceBackstop(s,observation(107,90),policy);assert.equal(s.triggered,true);
 s=advanceBackstop(s,observation(125,120),policy);assert.equal(s.triggered,true);assert.equal(s.brokerOrderPlaced,false);
});
test('older observations and changed quantities cannot lower or reset an enrolled backstop',()=>{
 const s=advanceBackstop(null,{price:120,quantity:10,observedAt:'2026-10-26T14:00:00Z'},policy);
 assert.equal(advanceBackstop(s,{price:100,quantity:10,observedAt:'2026-10-26T13:00:00Z'},policy).stop,108);
 const changed=advanceBackstop(s,{price:100,quantity:11,observedAt:'2026-10-26T14:01:00Z'},policy);assert.equal(changed.status,'review-required');assert.equal(changed.stop,108);
 assert.throws(()=>advanceBackstop(s,{price:null,quantity:10,observedAt:'2026-10-26T14:01:00Z'},policy));
});
test('daily history requires real complete OHLC sessions; future candles never enter the sample',()=>{
 const bars=wire(candles()),latest='2026-10-23';assert.equal(dailyBackstopBars(bars,latest).at(-1).date,latest);
 assert.throws(()=>dailyBackstopBars(bars.filter((_,i)=>i!==300),latest),/missing a required/);
 assert.throws(()=>dailyBackstopBars([...bars,bars[100]],latest),/duplicated/);
 assert.throws(()=>dailyBackstopBars(bars.map((b,i)=>i===100?{...b,h:1}:b),latest),/invalid/);
 assert.equal(dailyBackstopBars([...bars,{t:Date.parse('2026-10-26T05:00:00Z')/1000,o:999,h:999,l:999,c:999}],latest).length,bars.length);
 assert.ok(wilderAtr(candles())>0);assert.equal(wilderAtr(candles().slice(0,10)),null);
});
test('today high cannot retroactively tighten today stop; next-session gap fills below the trigger',()=>{
 const rows=candles().slice(0,120);for(const r of rows)Object.assign(r,{open:100,high:101,low:99,close:100});
 Object.assign(rows[50],{open:100,high:150,low:95,close:140});Object.assign(rows[51],{open:120,high:125,low:110,close:115});
 const r=simulateBackstop(rows,policy,{startDate:rows[50].date,endDate:rows.at(-1).date});
 assert.equal(r.curve[0].qty,99);assert.equal(r.curve[0].stop,135);assert.equal(r.trades[1].date,rows[51].date);assert.equal(r.trades[1].price,120);assert.equal(r.realOrdersPlaced,0);
 assert.ok(r.curve.every(p=>p.cash>=0&&Number.isInteger(p.qty)));
});
test('separate same-session snapshots with identical OHLC preserve the price history and report consolidation',()=>{
 const bars=wire(candles()),last=bars.at(-1),repeat={...last,t:last.t+3600,v:2000};
 const r=dailyBackstopEvidence([...bars,repeat],'2026-10-23');
 assert.deepEqual(r.rows,dailyBackstopBars(bars,'2026-10-23'));assert.equal(r.quality.coalescedSnapshots,1);
 assert.equal(r.quality.equivalentSnapshots[0].pricesIdentical,true);
 assert.throws(()=>dailyBackstopBars([...bars,{...repeat,c:repeat.c+0.01}],'2026-10-23'),/conflict/);
 assert.throws(()=>dailyBackstopBars([...bars,{...last,v:999}],'2026-10-23'),/duplicated/);
});
test('simulation results are unchanged by prices after the requested end',()=>{
 const rows=candles(),input={startDate:rows[50].date,endDate:rows[180].date};
 const a=simulateBackstop(rows,policy,input),changed=rows.map((r,i)=>i>180?{...r,open:r.open*100,high:r.high*100,low:r.low*100,close:r.close*100}:r);
 assert.deepEqual(simulateBackstop(changed,policy,input),a);
});
test('broker coverage is unknown without evidence, counts remaining SELL stops, and keeps fractional residuals visible',()=>{
 assert.equal(brokerStopCoverage(undefined,'ABC',10).status,'unknown');
 const o={orderId:'1',status:'WORKING',orderType:'TRAILING_STOP',remainingQuantity:10,legs:[{symbol:'ABC',instruction:'SELL'}]};
 assert.equal(brokerStopCoverage([o],'ABC',10).status,'working-broker-stop');assert.equal(brokerStopCoverage([o],'ABC',10.2).status,'partial');
 assert.equal(brokerStopCoverage([{...o,remainingQuantity:null}],'ABC',10).status,'none');
 assert.equal(brokerStopCoverage([o],'ABC',10).matchesConfiguredModel,false);
});
test('actual owner routes enroll and ratchet every holding, isolate records, and retain stale evidence without placing orders',async t=>{
 const h=await setup(t);const fresh={...binding,config:policy,confirm:true};
 assert.equal((await h.req('/backstops/configure',{...fresh,confirm:false})).status,428);
 assert.equal((await h.req('/backstops/configure',{...fresh,accountId:'other-account'})).status,404);
 assert.equal((await h.req('/backstops/configure',fresh)).policy.modelOnly,true);
 assert.equal((await h.req('/backstops',undefined,'owner-b')).policies.length,0);
 let r=await h.req('/backstops/check',binding);assert.equal(r.account.rows.length,1);assert.equal(r.account.rows[0].state.stop,90);assert.equal(r.account.rows[0].broker.status,'none');assert.equal(r.account.brokerReadStatus,'verified');
 h.setNow('2026-10-26T16:00:30Z');h.setQuote('ABC',{tradePrice:120,tradeAt:'2026-10-26T16:00:30Z'});
 r=await h.req('/backstops/check',binding);assert.equal(r.account.rows[0].state.stop,108);
 h.setNow('2026-10-26T16:05:00Z');r=await h.req('/backstops/check',binding);assert.equal(r.account.rows[0].status,'unavailable');assert.equal(r.account.rows[0].state.stop,108);assert.equal(r.account.summary.positions,1);
 assert.equal((await h.req('/backstops/configure',{...fresh,config:{...policy,trailPct:20}})).status,422);
 h.failOrders();r=await h.req('/backstops/check',binding);assert.equal(r.account.brokerReadStatus,'unavailable');assert.equal(r.account.rows[0].broker.status,'unknown');
 assert.equal(h.submitted(),0);assert.equal(h.canceled(),0);
});
test('expected funding is separate from actual cash and cannot authorize borrowing or change another owner',async t=>{
 const h=await setup(t),cash=h.accounts[0].cash;
 const r=await h.req('/expected-funding',{amountUsd:80000});assert.equal(r.plan.status,'expected');assert.equal(r.availableForTrading,false);assert.equal(h.accounts[0].cash,cash);
 assert.equal((await h.req('/expected-funding',undefined,'owner-b')).plans.length,0);
 assert.equal((await h.req('/expected-funding',{amountUsd:80000,accountId:'foreign'})).status,400);assert.equal(h.submitted(),0);
});
test('backstop comparison retains six fixed candidates, earlier selection and later evidence through actual routes',async t=>{
 const h=await setup(t),original=h.ctx.intent,rows=candles();h.setNow('2026-10-25T06:00:00Z');
 h.ctx.intent=async(name,input)=>name==='trading.bars'?{source:'schwab',symbol:input.symbol,bars:wire(rows)}:original(name,input);
 const answer=await h.req('/backstops/backtest',{...binding,symbol:'ABC'});assert.equal(answer.status,200,JSON.stringify(answer));
 assert.equal(answer.run.candidates.length,6);assert.ok(answer.run.trainingWindow.endDate<answer.run.laterWindow.startDate);assert.equal(answer.run.researchOnly,true);assert.equal(answer.run.untouchedHoldout,false);
 assert.equal(answer.run.brokerOrdersPlaced,0);assert.ok(answer.run.historyFingerprint);assert.equal(h.submitted(),0);
 assert.equal((await h.req('/backstops',undefined,'owner-b')).research.length,0);
});
