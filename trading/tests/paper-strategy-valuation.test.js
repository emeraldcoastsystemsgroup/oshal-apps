/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise assigned paper strategy valuation through real strategy/store functions and synthetic market SQL doubles; preserve execution gates, risk anchors and atomic fences.
 */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const store=require('../routes/paper/store');
const {runStrategyTick,rebalancePlan}=require('../routes/paper/strategy');
const {normalizePortfolioStrategy,portfolioNextTargets}=require('../routes/trading-portfolio-sim');
const {sessionDates,lastCompletedSession}=require('../routes/trading-portfolio-calendar');
const {portfolioStrategySymbols}=require('../routes/trading-portfolio-rotation');
const {fingerprint}=require('../routes/trading-portfolio-store');
const {createSqlDouble}=require('./support/paper-doubles');
const OWNER='synthetic-paper-owner',NOW=new Date('2026-11-12T16:00:00Z');
const monthly=normalizePortfolioStrategy({modelVersion:2,kind:'monthly-trend',assets:[{symbol:'ABC',weightPct:100}],lookbackSessions:63,rebalanceSessions:20,topN:1,grossExposurePct:100,transactionCostBps:10,marginAprPct:null,maintenancePct:null,fractionalShares:false});
const daily=normalizePortfolioStrategy({modelVersion:3,kind:'quant-margin-daily'});

function history(){
 const days=sessionDates('2025-01-02','2026-11-11');
 return Object.fromEntries(['ABC','SPY','BIL'].map((s,j)=>[s,days.map((date,i)=>({date,close:70+i*(j===2?.001:.1)}))]));
}
async function fixture({config=monthly,checked=true,anchor=null}={}){
 const sql=createSqlDouble(),clock={now:NOW},series=history(),calls=[],records=[];
 await store.arm(sql.pool,OWNER,{posture:'balanced',startingCash:1000,maxShares:100,maxNotional:1000,maxOrdersPerTick:5,maxQuoteAgeMinutes:10,universe:['ABC']},'2026-11-11T16:00:00Z');
 Object.assign(sql.db.account[0],{cash:200,equity:1000,high_water:1100,realized_pl:-2});
 sql.db.positions.push({user_sub:OWNER,symbol:'ABC',qty:8,avg_cost:90,last_price:100,last_price_at:'2026-11-11T16:00:00Z',peak_price:105,opened_at:'2026-11-02T16:00:00Z'});
 const assignment={bookRef:'synthetic-book',strategyId:'synthetic-strategy',strategyName:'Synthetic strategy',config,symbols:portfolioStrategySymbols(config),lastDecisionAsOf:'2026-10-30',lastCheckedSession:checked?'2026-11-12':'2026-11-11',lastAttemptAt:checked?NOW.toISOString():null,lastResult:'rebalanced'};
 const market={price:120,at:null,missing:false,hook:null};
 const intent=async(name,input)=>{
  calls.push({name,input});if(name==='trading.config')return {configured:true};
  if(name==='trading.quotes'){
   if(market.hook)await market.hook();
   return {quotes:market.missing?[]:input.symbols.map(symbol=>({symbol,tradePrice:market.price,tradeAt:market.at||clock.now.toISOString()}))};
  }
  if(name==='trading.bars')return {source:'schwab',symbol:input.symbol,bars:(series[input.symbol]||[]).map(r=>({t:Date.parse(r.date+'T00:00:00Z')/1000,c:r.close}))};
  throw Error('Unexpected intent '+name);
 };
 const root={pool:{query:async(text,values)=>{
  assert.match(text,/^INSERT INTO oshal_trading_portfolio_records/);assert.equal(values[1],OWNER);assert.equal(values[2],'paper-strategy');
  records.push(JSON.parse(values[3]));return {rows:[],rowCount:1};
 }}};
 if(anchor)sql.db.ticks.push({user_sub:OWNER,tick_window:'2026-11-12T15:00:00.000Z',order_count:0,summary:JSON.stringify({strategyId:assignment.strategyId,daily:anchor}),created_at:'2026-11-12T15:00:00Z'});
 const run=()=>runStrategyTick({pool:sql.pool,intent},root,OWNER,assignment,{now:clock.now,trigger:'schedule',runId:'synthetic-run'});
 return {...sql,clock,assignment,market,calls,records,run,series};
}
const dailyAnchor=(config=daily)=>({session:'2026-11-12',strategyFingerprint:fingerprint(config),riskState:{asOf:'2026-11-11',stops:{ABC:{session:'2026-11-11'}}},settledCash:125,unsettledCash:75,costs:2,decisionAsOf:'2026-11-11'});

function assertValued(t,price=120){
 assert.equal(t.db.account[0].equity,200+8*price);assert.equal(t.db.account[0].cash,200);
 assert.equal(t.db.account[0].high_water,1100);assert.equal(t.db.account[0].realized_pl,-2);
 const p=t.db.positions[0];assert.deepEqual([p.qty,p.avg_cost,p.peak_price,p.last_price,p.last_price_at],[8,90,105,price,t.clock.now.toISOString()]);
 assert.equal(p.opened_at,'2026-11-02T16:00:00Z');assert.equal(t.db.orders.length,0);assert.equal(t.db.decisions.length,0);
 assert.equal(t.db.equity.at(-1).equity,200+8*price);assert.equal(t.db.equity.at(-1).recorded_at,t.clock.now.toISOString());
}
test('already-checked strategy marks fresh holdings without new decisions, fills, peaks or high-water',async()=>{
 const t=await fixture(),out=await t.run();assert.equal(out.ok,true,JSON.stringify(out));assert.equal(out.valuationOnly,true);assertValued(t);
 assert.deepEqual(t.calls.map(c=>c.name),['trading.config','trading.quotes']);assert.equal(t.records.length,0,'valuation cannot rewrite decision metadata');
 assert.equal(JSON.parse(t.db.ticks.at(-1).summary).valuationOnly,true);
});
test('unchanged actual monthly signal still marks the new session without a rebalance',async()=>{
 const t=await fixture({checked:false});assert.equal(portfolioNextTargets(monthly,t.series,lastCompletedSession(NOW)).decisionAsOf,'2026-10-30');
 const out=await t.run();assert.equal(out.ok,true,JSON.stringify(out));assert.equal(out.unchanged,'2026-10-30');assertValued(t);
 assert.equal(t.records.at(-1).lastResult,'current');assert.equal(t.records.at(-1).lastCheckedSession,'2026-11-12');
 assert.deepEqual(JSON.parse(t.db.ticks.at(-1).summary).targets,[{symbol:'ABC',weightPct:100}]);
});
test('committed daily anchor prevents execution even if assignment metadata is stale',async()=>{
 const anchor=dailyAnchor(),t=await fixture({config:daily,checked:false,anchor}),out=await t.run();
 assert.equal(out.ok,true,JSON.stringify(out));assertValued(t);assert.deepEqual(JSON.parse(t.db.ticks.at(-1).summary).daily,anchor);
 assert.deepEqual(t.calls.map(c=>c.name),['trading.config','trading.quotes']);
});
test('over twenty fresh valuation ticks keep the exact daily stop and cash-settlement anchor',async()=>{
 const anchor=dailyAnchor(),t=await fixture({config:daily,anchor});
 for(let i=0;i<24;i++){t.clock.now=new Date(NOW.getTime()+i*300000);const out=await t.run();assert.equal(out.ok,true,JSON.stringify(out));}
 const recent=await store.listTicks(t.pool,OWNER);assert.equal(recent.length,20);assert.ok(recent.every(k=>JSON.stringify(k.summary.daily)===JSON.stringify(anchor)));
 assert.equal(t.calls.filter(c=>c.name==='trading.bars').length,0);assertValued(t);
});
for(const [label,patch] of [['stale',{at:'2026-11-11T16:00:00Z'}],['missing',{missing:true}],['future',{at:'2026-11-12T16:02:00Z'}],['nonfinite',{price:Infinity}]]){
 test(label+' fresh-price failure retains all last-known values and records the actual failure',async()=>{
  const t=await fixture();Object.assign(t.market,patch);const before=JSON.stringify(t.db),out=await t.run();
  assert.equal(out.error,'strategy_pass_failed',JSON.stringify(out));assert.equal(JSON.stringify(t.db),before);assert.match(t.records.at(-1).lastResult,/^failed: .*price/i);
 });
}
test('not armed, market closed and undecided retry remain refusal gates with no market reads',async()=>{
 const disarmed=await fixture();disarmed.db.config[0].armed=false;assert.equal((await disarmed.run()).skipped,'not_armed');assert.equal(disarmed.calls.length,0);
 const closed=await fixture();closed.clock.now=new Date('2026-11-12T11:00:00Z');assert.equal((await closed.run()).skipped,'market_closed');assert.equal(closed.calls.length,0);
 const retry=await fixture({checked:false});retry.assignment.lastAttemptAt=NOW.toISOString();assert.equal((await retry.run()).skipped,'retry_later');assert.equal(retry.calls.length,0);
});
test('same-window and changed-account fences roll back valuation writes',async()=>{
 const t=await fixture();await t.run();const before=JSON.stringify(t.db);assert.equal((await t.run()).skipped,'already_ticked');assert.equal(JSON.stringify(t.db),before);
 const race=await fixture();race.market.hook=()=>{race.db.account[0].version+=1;};const out=await race.run();assert.equal(out.skipped,'book_changed',JSON.stringify(out));
 assert.equal(race.db.account[0].equity,1000);assert.equal(race.db.positions[0].last_price,100);assert.equal(race.db.ticks.length+race.db.orders.length+race.db.equity.length,0);
});
test('future committed daily state refuses valuation and records a failure',async()=>{
 const anchor={...dailyAnchor(),session:'2026-11-13'},t=await fixture({config:daily,anchor}),before=JSON.stringify(t.db),out=await t.run();
 assert.equal(out.error,'strategy_pass_failed',JSON.stringify(out));assert.match(out.message,/future/);assert.equal(JSON.stringify(t.db),before);
});
test('ordinary rebalance still advances the existing peak/high-water and creates its real fills',async()=>{
 const t=await fixture(),account=await store.loadAccount(t.pool,OWNER),positions=await store.loadPositions(t.pool,OWNER),prices=new Map([['ABC',{price:120,at:NOW.toISOString()}]]);
 const plan=rebalancePlan(account,positions,[{symbol:'ABC',weightPct:100}],prices,'Synthetic strategy');plan.summary={};
 const out=await store.writeTick(t.pool,OWNER,{window:NOW.toISOString(),trigger:'test',runId:null,at:NOW.toISOString(),sessionDate:'2026-11-12',plan,account,ids:plan.fills.map((_,i)=>({orderId:'order-'+i,decisionId:'decision-'+i})),previousSymbols:['ABC']});
 assert.equal(out.written,true);assert.equal(t.db.positions[0].peak_price,120);assert.equal(t.db.account[0].high_water,1160);assert.ok(t.db.orders.length>0);
});

test('a fresh fall updates losses and the day snapshot without inventing a defensive decision',async()=>{
 const t=await fixture();t.market.price=80;const out=await t.run();assert.equal(out.ok,true,JSON.stringify(out));assertValued(t,80);
 assert.equal(t.db.account[0].equity,840);assert.deepEqual(t.calls.map(c=>c.name),['trading.config','trading.quotes']);
});
test('failure before an unchanged monthly mark leaves the session undecided and retries after the original delay',async()=>{
 const t=await fixture({checked:false});t.market.missing=true;const out=await t.run();assert.equal(out.error,'strategy_pass_failed');
 assert.equal(t.records.at(-1).lastCheckedSession,'2026-11-11');assert.equal(t.db.account[0].equity,1000);
 Object.assign(t.assignment,t.records.at(-1));t.market.missing=false;t.clock.now=new Date(NOW.getTime()+5*60000);
 assert.equal((await t.run()).skipped,'retry_later');t.clock.now=new Date(NOW.getTime()+30*60000);
 const recovered=await t.run();assert.equal(recovered.ok,true,JSON.stringify(recovered));assertValued(t);
});
test('a disarm during the market read invalidates valuation with the actual account-version bump',async()=>{
 const t=await fixture();t.market.hook=()=>store.disarm(t.pool,OWNER,NOW.toISOString());const out=await t.run();
 assert.equal(out.skipped,'book_changed',JSON.stringify(out));assert.equal(t.db.config[0].armed,false);
 assert.equal(t.db.account[0].equity,1000);assert.equal(t.db.positions[0].last_price,100);assert.equal(t.db.ticks.length,0);
});
test('a paper valuation leaves another owner account, marks and equity history untouched',async()=>{
 const t=await fixture();await store.arm(t.pool,'synthetic-other',{posture:'balanced',startingCash:1234,maxShares:100,maxNotional:1000,maxOrdersPerTick:5,maxQuoteAgeMinutes:10},NOW.toISOString());
 const other=JSON.stringify(t.db.account.find(a=>a.user_sub==='synthetic-other')),out=await t.run();assert.equal(out.ok,true,JSON.stringify(out));
 assert.equal(JSON.stringify(t.db.account.find(a=>a.user_sub==='synthetic-other')),other);assert.ok(t.db.equity.every(e=>e.user_sub===OWNER));
});
test('successful valuation after a checked-session quote failure clears that failure without rewriting its decision date',async()=>{
 const t=await fixture();t.market.missing=true;assert.equal((await t.run()).error,'strategy_pass_failed');
 Object.assign(t.assignment,t.records.at(-1));t.market.missing=false;t.clock.now=new Date(NOW.getTime()+5*60000);assert.equal((await t.run()).skipped,'retry_later');
 t.clock.now=new Date(NOW.getTime()+30*60000);const out=await t.run();assert.equal(out.ok,true,JSON.stringify(out));assertValued(t);
 assert.equal(t.records.at(-1).lastResult,'current');assert.equal(t.records.at(-1).lastDecisionAsOf,'2026-10-30');assert.equal(t.records.at(-1).lastCheckedSession,'2026-11-12');
});
test('a new actual monthly decision keeps the original execution timing, whole shares and ledger fills',async()=>{
 const t=await fixture({checked:false});t.assignment.lastDecisionAsOf='2026-09-30';const out=await t.run();
 assert.equal(out.ok,true,JSON.stringify(out));assert.notEqual(out.valuationOnly,true);assert.equal(out.decisionAsOf,'2026-10-30');
 assert.deepEqual(out.orders,[{symbol:'ABC',side:'buy',qty:1,fillPrice:120}]);
 assert.equal(t.db.orders.length,1);assert.equal(t.db.decisions.length,1);assert.equal(t.db.positions[0].qty,9);assert.equal(t.db.positions[0].peak_price,120);
 assert.equal(t.db.account[0].high_water,1160);assert.equal(t.records.at(-1).lastResult,'rebalanced');
});
