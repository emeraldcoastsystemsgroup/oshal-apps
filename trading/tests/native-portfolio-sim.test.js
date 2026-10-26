/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove deterministic historical portfolio simulation, explicit costs, prior-session signals, complete price coverage and retirement/cash leverage refusal.
 */
'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {simulatePortfolio,normalizePortfolioStrategy}=require('../routes/trading-portfolio-sim');
const {sessionDates}=require('../routes/trading-portfolio-calendar');
const days=sessionDates('2025-01-02','2025-12-31').slice(0,150);
const config=()=>({modelVersion:1,kind:'allocation',assets:[{symbol:'ABC',weightPct:100}],lookbackSessions:20,rebalanceSessions:20,topN:1,grossExposurePct:100,transactionCostBps:10,marginAprPct:null,maintenancePct:null,fractionalShares:false});
const input=()=>({startDate:days[30],endDate:days[130],startingCapital:10000,leverageAllowed:false,series:{ABC:days.map((date,i)=>({date,close:100+i})),SPY:days.map(date=>({date,close:100}))}});

test('historical simulations are deterministic and expose costs, assumptions and a real benchmark',()=>{
 const a=simulatePortfolio(config(),input()),b=simulatePortfolio(config(),input());assert.deepEqual(a,b);
 assert.ok(a.metrics.totalReturnPct>0);assert.ok(a.costs.tradingUsd>0);assert.equal(a.costs.financingUsd,0);
 assert.ok(a.metrics.benchmarkReturnPct<0,'the benchmark also pays its modeled entry cost');
 assert.equal(a.window.sessions,101);assert.equal(a.researchOnly,true);assert.equal(a.realOrdersPlaced,0);
 assert.ok(a.curve.every(p=>p.cash>=-1e-7));assert.match(a.assumptions.join(' '),/dividends.*excluded/);
});

test('retirement/cash accounts cannot simulate borrowed exposure even when a config asks for it',()=>{
 const leveraged={...config(),grossExposurePct:150,marginAprPct:12,maintenancePct:30};
 assert.throws(()=>simulatePortfolio(leveraged,input()),e=>e.code==='retirement_or_cash_leverage_refused');
 const result=simulatePortfolio(leveraged,{...input(),leverageAllowed:true});
 assert.ok(result.costs.financingUsd>0);assert.ok(result.curve.some(p=>p.cash<0));
 assert.equal(result.costs.calendarDayFinancing,true);
});

test('missing sessions and short history fail instead of padding prices or silently narrowing a window',()=>{
 const missing=input();missing.series.ABC.splice(90,1);
 assert.throws(()=>simulatePortfolio(config(),missing),e=>e.code==='incomplete_history');
 assert.throws(()=>simulatePortfolio(config(),{...input(),endDate:days[40]}),e=>e.code==='insufficient_history');
 const duplicate=input();duplicate.series.ABC.push(duplicate.series.ABC[0]);
 assert.throws(()=>simulatePortfolio(config(),duplicate),e=>e.code==='price_data_invalid');
});

test('trend entry uses the previous session, not the fill session jump',()=>{
 const i=input();i.series.ABC=days.map((date,n)=>({date,close:n===30?1000:100-n/10}));
 const result=simulatePortfolio({...config(),kind:'trend',rebalanceSessions:1},i);
 assert.equal(result.curve[0].gross,0,'the first-session jump cannot affect its own entry signal');
 assert.ok(result.curve[1].gross>0,'the following session can use that completed jump');
});

test('unsupported knobs, duplicate assets, nonfinite inputs and unpriced leverage assumptions refuse',()=>{
 assert.throws(()=>normalizePortfolioStrategy({...config(),madeUpRiskControl:true}),e=>e.code==='strategy_invalid');
 assert.throws(()=>normalizePortfolioStrategy({...config(),assets:[{symbol:'ABC',weightPct:50},{symbol:'ABC',weightPct:50}]}));
 assert.throws(()=>simulatePortfolio(config(),{...input(),startingCapital:Infinity}));
 assert.throws(()=>normalizePortfolioStrategy({...config(),grossExposurePct:150}),e=>e.code==='strategy_invalid');
});

test('a modeled maintenance breach liquidates the simulated positions and records the stop',()=>{
 const i=input();i.series.ABC=days.map((date,n)=>({date,close:n<35?100:30}));
 const result=simulatePortfolio({...config(),grossExposurePct:150,marginAprPct:12,maintenancePct:30}, {...i,leverageAllowed:true});
 assert.equal(result.maintenanceTriggered,true);assert.equal(result.curve.at(-1).gross,0);
 assert.ok(result.metrics.maxDrawdownPct>50);assert.equal(result.realOrdersPlaced,0);
});

test('benchmark holes and incomplete requested endpoints refuse independently of asset coverage',()=>{
 const hole=input();hole.series.SPY.splice(90,1);assert.throws(()=>simulatePortfolio(config(),hole),e=>e.code==='incomplete_history');
 const short=input();short.series.SPY=short.series.SPY.slice(50);assert.throws(()=>simulatePortfolio(config(),short),e=>e.code==='insufficient_history');
 const stale=input();stale.series.SPY=stale.series.SPY.slice(0,120);assert.throws(()=>simulatePortfolio(config(),stale),e=>e.code==='incomplete_history');
});
