/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Causal moving-stop, gap-fill, funding, owner isolation and every-position evidence regressions. Synthetic prices only; no broker orders.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {backstopPolicy,advanceBackstop,dailyBackstopBars,dailyBackstopEvidence,wilderAtr,simulateBackstop}=require('../routes/live/backstop-model');
const {brokerStopCoverage}=require('../routes/live/backstops');
const {setup,binding}=require('./support/native-management-host');
const {sessionDates}=require('../routes/trading-portfolio-calendar');
const {simulateProtectedPortfolio}=require('../routes/live/protected-model');
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

const combinedStrategy={modelVersion:1,kind:'allocation',assets:[{symbol:'ABC',weightPct:100}],lookbackSessions:20,rebalanceSessions:20,topN:1,grossExposurePct:100,transactionCostBps:25,marginAprPct:null,maintenancePct:null,fractionalShares:false};
function combinedFixture(){
 const days=sessionDates('2025-01-02','2025-12-31'),rows=days.map(date=>({date,open:100,high:101,low:99,close:100}));
 return{startDate:days[60],endDate:days[180],startingCapital:10000,series:Object.fromEntries(['ABC','SPY','DIA'].map(s=>[s,structuredClone(rows)]))};
}
test('combined model uses prior signals, next-open cash-funded fills and charges both stop legs',()=>{
 const input=combinedFixture(),rows=input.series.ABC,first=rows.findIndex(r=>r.date===input.startDate);
 Object.assign(rows[first],{open:100,high:150,low:95,close:140});Object.assign(rows[first+1],{open:120,high:125,low:110,close:115});
 const r=simulateProtectedPortfolio(combinedStrategy,input,{trailPct:10});
 assert.equal(r.events[0].price,100);assert.equal(r.events[0].quantity,99);assert.equal(r.rebalances[0].signalAsOf,rows[first-1].date);
 assert.equal(r.curve[0].stops.ABC.stop,135);const exit=r.events.find(e=>e.reason==='stop-gap');assert.equal(exit.price,120);assert.equal(exit.priorStop,135);
 assert.ok(r.costs.tradingUsd>=99*(100+120)*.0025);assert.ok(r.curve.every(p=>p.cash>=0));assert.equal(r.realOrdersPlaced,0);
 assert.equal(r.events.find(e=>e.side==='buy'&&e.date>exit.date).date,rows[first+20].date);
});
test('partial allocation sales retain the remaining stop floor and wait for sale completion before buys',()=>{
 const input=combinedFixture();input.startingCapital=10000;input.initialBook={cash:0,positions:[{symbol:'OLD',quantity:100}]};
 input.series.OLD=structuredClone(input.series.ABC);input.dailyAllocationNotionalLimitUsd=2000;
 const r=simulateProtectedPortfolio(combinedStrategy,input,{trailPct:10});
 assert.equal(r.curve[0].positions.OLD,80);assert.equal(r.curve[0].positions.ABC,undefined);
 assert.equal(r.curve[1].positions.OLD,60);assert.equal(r.curve[1].stops.OLD.stop,r.curve[0].stops.OLD.stop);
 assert.equal(r.events.find(e=>e.side==='buy').date,r.curve[5].date);
 assert.ok(r.events.filter(e=>e.reason==='allocation'&&e.side==='sell').every(e=>e.quantity===20));
 assert.ok(r.curve.every(p=>!p.positions.OLD||!p.positions.ABC));
});
test('a stop aborts a partially filled rebalance and prevents immediate repurchase or leftover buys',()=>{
 const input=combinedFixture();input.dailyAllocationNotionalLimitUsd=2000;
 const index=input.series.ABC.findIndex(r=>r.date===input.startDate);Object.assign(input.series.ABC[index+1],{open:80,high:85,low:75,close:82});
 const r=simulateProtectedPortfolio(combinedStrategy,input,{trailPct:10}),exit=r.events.find(e=>e.reason==='stop-gap');
 assert.equal(exit.quantity,20);assert.equal(r.curve[1].pendingCycle,null);assert.ok(r.events.some(e=>e.reason==='cycle-aborted-by-stop'));
 assert.equal(r.events.filter(e=>e.side==='buy'&&e.date>exit.date&&e.date<r.curve[20].date).length,0);
});
test('changing later or fill-day closing prices cannot select an earlier target or tighten its prior stop',()=>{
 const input=combinedFixture(),a=simulateProtectedPortfolio(combinedStrategy,input,{trailPct:10}),changed=structuredClone(input);
 const boundary=a.curve[30].date;
 for(const rows of Object.values(changed.series))for(const row of rows)if(row.date>boundary)Object.assign(row,{open:300,high:320,low:280,close:310});
 const b=simulateProtectedPortfolio(combinedStrategy,changed,{trailPct:10});
 assert.deepEqual(b.curve.slice(0,31),a.curve.slice(0,31));assert.deepEqual(b.rebalances.filter(r=>r.fillDate<=boundary),a.rebalances.filter(r=>r.fillDate<=boundary));
});
test('combined validation refuses missing sessions, fabricated candles, fractional protection and unmeasured debt',()=>{
 const input=combinedFixture();input.series.ABC.splice(90,1);assert.throws(()=>simulateProtectedPortfolio(combinedStrategy,input),/session is missing/);
 const invalid=combinedFixture();invalid.series.ABC[100].high=1;assert.throws(()=>simulateProtectedPortfolio(combinedStrategy,invalid),/invalid/);
 assert.throws(()=>simulateProtectedPortfolio({...combinedStrategy,fractionalShares:true},combinedFixture()),/whole-share/);
 const debt=combinedFixture();debt.initialBook={cash:-10000,positions:[{symbol:'ABC',quantity:200}]};assert.throws(()=>simulateProtectedPortfolio(combinedStrategy,debt),/Existing debt needs/);
});
test('existing measured debt is serviced by risk-reducing sales, financing remains explicit and no new borrowing is modeled',()=>{
 const input=combinedFixture();input.initialBook={cash:-10000,positions:[{symbol:'OLD',quantity:200}]};input.series.OLD=structuredClone(input.series.ABC);
 input.leverageAllowed=true;input.financingAprPct=12;input.maintenancePct=30;input.dailyAllocationNotionalLimitUsd=2000;
 const r=simulateProtectedPortfolio(combinedStrategy,input,{trailPct:10});
 assert.ok(r.costs.financingUsd>0);assert.ok(r.curve[0].cash>-10000);const buy=r.events.find(e=>e.side==='buy');assert.ok(buy);
 assert.ok(r.curve.find(p=>p.date===buy.date).cash>=0);assert.equal(r.events.find(e=>e.side==='sell').symbol,'OLD');
 assert.throws(()=>simulateProtectedPortfolio(combinedStrategy,{...input,startingCapital:20000}),/must equal starting equity/);
});

const {compareProtectedPortfolio,combinedDaily}=require('../routes/live/combined-research');
test('combined selection never uses later prices and later results carry training holdings and stop ratchets',()=>{
 const input=combinedFixture(),start=input.series.ABC.findIndex(r=>r.date===input.startDate);
 for(const row of input.series.ABC){const i=input.series.ABC.indexOf(row);if(i>=start){const n=i-start;Object.assign(row,{open:100+n,high:101+n,low:99+n,close:100+n});}}
 const split=input.series.ABC[start+59].date,a=compareProtectedPortfolio(combinedStrategy,input,split),changed=structuredClone(input);
 for(const rows of Object.values(changed.series))for(const row of rows)if(row.date>split)Object.assign(row,{open:60,high:65,low:55,close:60});
 const b=compareProtectedPortfolio(combinedStrategy,changed,split);
 assert.equal(a.candidates.length,6);assert.ok(a.selectedTrailPct);assert.equal(b.selectedTrailPct,a.selectedTrailPct);
 assert.deepEqual(b.candidates.map(c=>c.training),a.candidates.map(c=>c.training));assert.deepEqual(b.candidates.map(c=>c.score),a.candidates.map(c=>c.score));
 const chosen=a.candidates.find(c=>c.trailPct===a.selectedTrailPct);
 assert.equal(chosen.later.startingEquity,a.selectedSimulation.curve[59].equity);assert.notEqual(chosen.later.startingEquity,input.startingCapital);
 assert.ok(b.candidates.some(c=>c.later.metrics.totalReturnPct<0));assert.equal(a.continuousEvaluation,true);assert.equal(a.brokerOrdersPlaced,0);
 assert.ok(a.comparators.allocationOnly.later.benchmarks.DIA);assert.equal(a.comparators.cash.laterReturnPct,0);
});
test('combined comparison retains all losing training candidates without declaring a winner',()=>{
 const input=combinedFixture(),start=input.series.ABC.findIndex(r=>r.date===input.startDate);
 for(let i=start;i<input.series.ABC.length;i++){const price=Math.max(1,100-(i-start)*.4);Object.assign(input.series.ABC[i],{open:price,high:price+1,low:price-.5,close:price});}
 const r=compareProtectedPortfolio(combinedStrategy,input,input.series.ABC[start+59].date);
 assert.equal(r.selectedTrailPct,null);assert.equal(r.selectedSimulation,null);assert.ok(r.candidates.every(c=>c.training.metrics.totalReturnPct<0));
 assert.ok(r.candidates.every(c=>c.later.window.sessions>=60));assert.equal(r.untouchedHoldout,false);
});
test('overlapping native OHLC reads coalesce identical snapshots and refuse changed overlap or duplicate pages',async()=>{
 const rows=candles(),bars=wire(rows),at=new Date('2026-10-25T06:00:00Z'),inputs=[];
 const ctx={intent:async(name,input)=>{assert.equal(name,'trading.bars');inputs.push(input);return{symbol:'ABC',source:'schwab',bars};}};
 const r=await combinedDaily(ctx,'owned','ABC','2026-10-23',at,'2025-01-01');assert.equal(inputs.length,2);assert.equal(r.quality.repeatedReadSnapshots,bars.length);
 assert.ok(inputs.every(i=>i.connection==='owned'&&i.timeframe==='1Day'&&!('historyDays'in i)));
 let n=0;ctx.intent=async()=>({symbol:'ABC',source:'schwab',bars:++n===1?bars:bars.map((b,i)=>i===100?{...b,c:b.c+1}:b)});
 await assert.rejects(()=>combinedDaily(ctx,'owned','ABC','2026-10-23',at,'2025-01-01'),/changed prices/);
 ctx.intent=async()=>({symbol:'ABC',source:'schwab',bars:[...bars,bars[0]]});
 await assert.rejects(()=>combinedDaily(ctx,'owned','ABC','2026-10-23',at,'2025-01-01'),/duplicate or invalid/);
});
test('actual combined route binds the assigned owner/account, retains evidence and comparisons, and creates no authority',async t=>{
 const h=await setup(t),original=h.ctx.intent;
 const rows=sessionDates('2024-01-02','2026-10-23').map((date,i)=>({date,open:100+i/10,high:101+i/10,low:99+i/10,close:100+i/10}));
 h.setNow('2026-10-25T06:00:00Z');
 h.ctx.intent=async(name,input)=>name==='trading.bars'?{source:'schwab',symbol:input.symbol,bars:wire(rows)}:original(name,input);
 const body={...binding,strategyId:h.strategyId},answer=await h.req('/backstops/combined',body);
 assert.equal(answer.status,200,JSON.stringify(answer));const r=answer.run;assert.equal(r.candidates.length,6);assert.equal(r.continuousEvaluation,true);
 assert.ok(r.historyFingerprint);assert.ok(r.configFingerprint);assert.equal(r.initialPortfolio,'fresh-cash-study-not-current-legacy-book');
 assert.equal(r.dailyAllocationNotionalLimitUsd,2*r.startingCapital);assert.equal(r.maxAllocationTicketNotionalUsd,50000);assert.equal(r.brokerOrdersPlaced,0);assert.equal(r.currentCongressBasket,false);
 assert.equal((await h.req('/backstops/combined')).runs.length,1);assert.equal((await h.req('/backstops/combined',undefined,'owner-b')).runs.length,0);
 assert.equal((await h.req('/backstops/combined/'+r.id,undefined,'owner-b')).status,404);
 assert.equal((await h.req('/backstops/combined/'+r.id)).run.historyFingerprint,r.historyFingerprint);
 assert.equal((await h.req('/backstops/combined',{...body,accountId:'foreign'})).status,404);
 assert.equal((await h.req('/backstops/combined',body,'owner-b')).status,404);
 assert.equal((await h.req('/backstops/combined',{...body,startingCapital:80000})).status,400);
 const other=(await h.req('/strategies',{name:'Unassigned',config:combinedStrategy})).strategy;
 assert.equal((await h.req('/backstops/combined',{...body,strategyId:other.id})).status,409);
 assert.equal(h.submitted(),0);assert.equal(h.canceled(),0);assert.equal([...h.records.values()].filter(r=>r.kind==='backstop-policy'||r.kind==='watch'||r.kind==='protection-review').length,0);
});

test('large combined allocations split into native-size modeled tickets rather than pretending $50k is a daily limit',()=>{
 const input=combinedFixture();input.startingCapital=200000;const r=simulateProtectedPortfolio(combinedStrategy,input,{trailPct:10});
 const first=r.events.filter(e=>e.date===input.startDate&&e.side==='buy');assert.equal(first.length,4);
 assert.ok(first.every(e=>e.quantity*e.price<=50000&&e.quantity<=100000));assert.ok(r.curve[0].positions.ABC>1900);assert.equal(r.curve[0].pendingCycle,null);
});

test('historical combined windows reject in-window conflicting candles and exclude later candles before duplicate checks',async()=>{
 const rows=candles(),bars=wire(rows),at=new Date('2026-10-27T07:00:00Z');
 const after=[{t:Date.parse('2026-10-26T04:00:00Z')/1000,o:100,h:105,l:95,c:101},{t:Date.parse('2026-10-26T05:00:00Z')/1000,o:100,h:105,l:95,c:101.019}];
 const ctx={intent:async()=>({source:'schwab',symbol:'NVDA',bars:[...bars,...after]})};
 const past=await combinedDaily(ctx,'owned','NVDA','2026-10-23',at,'2025-01-01');assert.equal(past.rows.at(-1).date,'2026-10-23');assert.equal(past.quality.ignoredAfterEnd,4);
 await assert.rejects(()=>combinedDaily(ctx,'owned','NVDA','2026-10-26',at,'2025-01-01'),/NVDA:.*2026-10-26/);
});
test('combined owner routes retain the explicit end and latest-session distinction without repairing current conflicts',async t=>{
 const h=await setup(t),original=h.ctx.intent,inputs=[];
 const rows=sessionDates('2024-01-02','2026-10-26').map((date,i)=>({date,open:100+i/10,high:101+i/10,low:99+i/10,close:100+i/10}));
 const bars=wire(rows),last=bars.at(-1),duplicate={...last,t:last.t+3600,c:last.c+.019};h.setNow('2026-10-27T07:00:00Z');
 h.ctx.intent=async(name,input)=>{if(name==='trading.bars'){inputs.push(input);return{source:'schwab',symbol:input.symbol,bars:[...bars,duplicate]};}return original(name,input);};
 const body={...binding,strategyId:h.strategyId};assert.match((await h.req('/backstops/combined',body)).message,/2026-10-26/);
 const past=await h.req('/backstops/combined',{...body,endDate:'2026-10-23'});assert.equal(past.status,200,JSON.stringify(past));
 assert.equal(past.run.requestedEndDate,'2026-10-23');assert.equal(past.run.laterWindow.endDate,'2026-10-23');assert.equal(past.run.latestCompletedSession,'2026-10-26');assert.equal(past.run.sessionsAfterStudyEnd,1);
 assert.equal((await h.req('/backstops/combined')).latestCompletedSession,'2026-10-26');assert.equal((await h.req('/backstops/combined')).runs.length,1);
 assert.equal((await h.req('/backstops/combined',{...body,endDate:'2026-10-27'})).status,422);assert.equal((await h.req('/backstops/combined',{...body,endDate:'2026-10-25'})).status,422);
 assert.ok(inputs.every(i=>i.end<=Date.parse('2026-10-27T07:00:00Z')&&i.end>=Date.parse('2026-10-27T07:00:00Z')-400*86400000));
 assert.equal(h.submitted(),0);assert.equal(h.canceled(),0);
});
test('combined historical research uses a bounded single extended window only when the native release advertises it',async t=>{
 const h=await setup(t),original=h.ctx.intent,inputs=[];h.setNow('2026-10-27T07:00:00Z');
 const rows=sessionDates('2024-01-02','2026-10-26').map((date,i)=>({date,open:100+i/10,high:101+i/10,low:99+i/10,close:100+i/10}));
 h.ctx.intent=async(name,input)=>{
  if(name==='trading.config')return{orderTickets:true,maxDailyHistoryDays:4000};
  if(name==='trading.bars'){inputs.push(input);return{source:'schwab',symbol:input.symbol,bars:wire(rows)};}return original(name,input);
 };
 const result=await h.req('/backstops/combined',{...binding,strategyId:h.strategyId,endDate:'2026-07-31'});assert.equal(result.status,200,JSON.stringify(result));
 assert.equal(inputs.length,Object.keys(result.run.history).length);assert.ok(inputs.every(i=>Number.isInteger(i.historyDays)&&i.historyDays>=400&&i.historyDays<=4000));
 assert.ok(Object.values(result.run.dataQuality).every(q=>q.windows===1&&q.requestedEndDate==='2026-07-31'));
 assert.equal(h.submitted(),0);assert.equal(h.canceled(),0);
});

test('component backstop research supports an explicit prior end without treating conflicting current candles as repaired',async t=>{
 const h=await setup(t),original=h.ctx.intent,rows=candles(),bars=wire(rows);h.setNow('2026-10-27T07:00:00Z');
 const future=[{t:Date.parse('2026-10-26T04:00:00Z')/1000,o:100,h:105,l:95,c:101},{t:Date.parse('2026-10-26T05:00:00Z')/1000,o:100,h:105,l:95,c:101.019}];
 h.ctx.intent=async(name,input)=>name==='trading.bars'?{source:'schwab',symbol:input.symbol,bars:[...bars,...future]}:original(name,input);
 const body={...binding,symbol:'ABC',modelVersion:2};assert.equal((await h.req('/backstops/backtest',body)).status,422);
 const past=await h.req('/backstops/backtest',{...body,endDate:'2026-10-23'});assert.equal(past.status,200,JSON.stringify(past));
 assert.equal(past.run.requestedEndDate,'2026-10-23');assert.equal(past.run.latestCompletedSession,'2026-10-26');assert.equal(past.run.sessionsAfterStudyEnd,1);assert.equal(past.run.history.at(-1).date,'2026-10-23');assert.equal(past.run.brokerOrdersPlaced,0);
 assert.equal((await h.req('/backstops')).latestCompletedSession,'2026-10-26');assert.equal(h.submitted(),0);assert.equal(h.canceled(),0);
});
