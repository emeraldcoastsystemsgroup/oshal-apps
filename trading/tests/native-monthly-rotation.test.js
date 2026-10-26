/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard completed-month signals, exact quarterly ranking, defensive vacancies, full coverage, backward compatibility and zero execution authority.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizePortfolioStrategy,simulatePortfolio,portfolioNextTargets}=require('../routes/trading-portfolio-sim');
const {portfolioStrategySymbols}=require('../routes/trading-portfolio-rotation');
const {sessionDates}=require('../routes/trading-portfolio-calendar');
const {buildRebalancePlan}=require('../routes/trading-portfolio-plan');
const {planSymbols}=require('../routes/trading-portfolio-plan-evidence');
const days=sessionDates('2024-01-02','2026-10-23');
const config=(extra={})=>({modelVersion:2,kind:'monthly-trend',assets:[{symbol:'ABC',weightPct:100}],lookbackSessions:63,rebalanceSessions:20,topN:1,grossExposurePct:100,transactionCostBps:10,marginAprPct:null,maintenancePct:null,fractionalShares:true,...extra});
const series=()=>({ABC:days.map(date=>({date,close:date<'2025-02-14'?100:150})),BIL:days.map((date,n)=>({date,close:100+n/1000})),SPY:days.map(date=>({date,close:100}))});
const input=()=>({startDate:'2025-01-02',endDate:'2025-12-31',startingCapital:10000,leverageAllowed:false,series:series()});

test('monthly trend waits for a completed month and trades calendar boundaries, not every20 sessions',()=>{
 const r=simulatePortfolio(config(),input());
 assert.equal(r.model,'portfolio-monthly-v2');assert.equal(r.realOrdersPlaced,0);assert.equal(r.researchOnly,true);
 assert.deepEqual(r.rebalances[0].targets,[{symbol:'BIL',weightPct:100}]);
 assert.equal(r.rebalances.length,12);assert.ok(r.rebalances.every((p,n)=>n===0||p.fillDate.slice(0,7)!==r.curve[r.curve.findIndex(d=>d.date===p.fillDate)-1].date.slice(0,7)));
 assert.deepEqual(r.rebalances.find(p=>p.fillDate==='2025-02-03').targets,[{symbol:'BIL',weightPct:100}]);
 const march=r.rebalances.find(p=>p.fillDate==='2025-03-03');assert.equal(march.decisionAsOf,'2025-02-28');assert.deepEqual(march.targets,[{symbol:'ABC',weightPct:100}]);
 assert.ok(r.curve.every(p=>p.cash>=-1e-7));
});
test('a fill-day or unfinished-month jump cannot enter its own monthly signal',()=>{
 const original=series(),changed=series();changed.ABC=changed.ABC.map(p=>({...p,close:p.date==='2025-03-03'?99999:p.close}));
 const a=simulatePortfolio(config(),{...input(),series:original}),b=simulatePortfolio(config(),{...input(),series:changed});
 assert.deepEqual(a.rebalances.find(p=>p.fillDate==='2025-03-03').targets,b.rebalances.find(p=>p.fillDate==='2025-03-03').targets);
 const fresh=series();fresh.ABC=fresh.ABC.map(p=>({...p,close:p.date>='2026-10-01'?99999:p.close}));
 const p=portfolioNextTargets(config(),series(),'2026-10-23'),q=portfolioNextTargets(config(),fresh,'2026-10-23');
 assert.equal(p.decisionAsOf,'2026-09-30');assert.deepEqual(p,q);assert.equal(p.signalAsOf,'2026-10-23');
});
test('a completed month-end can drive the next session while a mid-month startup uses the previous month',()=>{
 const r=portfolioNextTargets(config(),series(),'2026-09-30');assert.equal(r.decisionAsOf,'2026-09-30');
 const mid=simulatePortfolio(config(),{...input(),startDate:'2025-02-18'});assert.equal(mid.rebalances[0].decisionAsOf,'2025-01-31');assert.deepEqual(mid.rebalances[0].targets,[{symbol:'BIL',weightPct:100}]);
});
test('quarterly rotation fills fixed one-third slots and leaves vacancies in BIL',()=>{
 const data=series();data.DEF=days.map(date=>({date,close:100}));data.GHI=days.map(date=>({date,close:100}));
 data.ABC=days.map((date,n)=>({date,close:100+n/10}));
 const s=config({kind:'quarterly-rotation',assets:['ABC','DEF','GHI'].map(symbol=>({symbol,weightPct:100/3})),topN:3});
 const p=portfolioNextTargets(s,data,'2026-10-23');
 assert.equal(p.targets.length,2);assert.equal(p.targets[0].symbol,'ABC');assert.ok(Math.abs(p.targets[0].weightPct-100/3)<1e-7);assert.equal(p.targets[1].symbol,'BIL');assert.ok(Math.abs(p.targets[1].weightPct-200/3)<1e-7);
});
test('missing defensive prices, required month ends and incomplete warmups refuse',()=>{
 const missing=series();delete missing.BIL;assert.throws(()=>simulatePortfolio(config(),{...input(),series:missing}),e=>e.code==='price_data_invalid');
 const hole=series();hole.ABC=hole.ABC.filter(p=>p.date!=='2025-02-28');assert.throws(()=>simulatePortfolio(config(),{...input(),series:hole}),e=>e.code==='incomplete_history');
 const short=series();for(const key in short)short[key]=short[key].slice(-200);assert.throws(()=>portfolioNextTargets(config(),short,'2026-10-23'),e=>e.code==='insufficient_history');
});
test('noncanonical monthly knobs and cross-version kinds refuse rather than silently changing rules',()=>{
 for(const extra of [{grossExposurePct:125,marginAprPct:12,maintenancePct:40},{lookbackSessions:64},{rebalanceSessions:21},{topN:2},{marginAprPct:12},{modelVersion:1},{kind:'allocation'},{assets:[{symbol:'BIL',weightPct:100}]},{assets:[{symbol:'ABC',weightPct:50}]}])assert.throws(()=>normalizePortfolioStrategy(config(extra)),e=>e.code==='strategy_invalid');
 assert.deepEqual(normalizePortfolioStrategy(config()),config());
});
test('BIL participates in quote rosters, targets and concrete planning; no order authority added',()=>{
 const s=config(),account={accountId:'fixture',connectionKey:'own',kind:'live',broker:'schwab',accountType:'cash',equity:10000,cash:10000,positions:[],balanceFacts:{cashAvailableForWithdrawal:10000}};
 assert.deepEqual(portfolioStrategySymbols(s),['ABC','BIL']);assert.deepEqual(planSymbols(account,s),['ABC','BIL']);
 const quotes=['ABC','BIL'].map(symbol=>({symbol,tradePrice:100,tradeAt:'2026-10-23T19:59:00Z',source:'schwab',delayed:false}));
 const p=buildRebalancePlan({account,profile:{registration:'taxable'},config:s,targets:[{symbol:'BIL',weightPct:100}],signalAsOf:'2026-10-23',quotes,scope:'preserve-other-holdings',now:new Date('2026-10-25T12:00:00Z')});
 assert.equal(p.actions.length,1);assert.equal(p.actions[0].symbol,'BIL');assert.equal(p.status,'pending-review');assert.equal(p.execution.available,false);assert.equal(p.execution.realOrdersPlaced,0);assert.equal(p.execution.borrowingAuthorized,false);
 assert.throws(()=>buildRebalancePlan({account,profile:{registration:'taxable'},config:s,targets:[{symbol:'BIL',weightPct:100}],signalAsOf:'2026-10-23',quotes:quotes.slice(0,1),scope:'whole-account',now:new Date('2026-10-25T12:00:00Z')}),e=>e.code==='plan_quote_missing');
});
