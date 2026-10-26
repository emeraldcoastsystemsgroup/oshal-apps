/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise actual preview/approval routes over explicit owner-aware synthetic storage and broker read fixtures: immutable studies, complete quotes, cash/retirement constraints, exact exception acknowledgements, stale evidence, isolation and no execution.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {application}=require('./support/native-portfolio-host');
const binding={accountId:'a',connectionKey:'owned-login'};
const config=(extra={})=>({modelVersion:1,kind:'allocation',assets:[{symbol:'ABC',weightPct:100}],lookbackSessions:20,rebalanceSessions:20,topN:1,grossExposurePct:100,transactionCostBps:10,marginAprPct:null,maintenancePct:null,fractionalShares:false,...extra});
async function host(t){const fixture=application(),server=await new Promise(resolve=>{const s=fixture.app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const req=async(path,body,owner='owner-a')=>{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/trading/portfolio'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-fixture-owner':owner},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,...await response.json()};};
 fixture.accounts[0].balanceFacts={buyingPower:20000,debitBalance:0,maintenanceRequirement:2000,cashAvailableForWithdrawal:1000};
 return{...fixture,req};}
async function study(h,cfg=config()){
 await h.req('/profiles',{...binding,label:'Owned account',registration:'taxable'});
 const strategy=(await h.req('/strategies',{name:'Owned study',config:cfg})).strategy;
 return (await h.req('/backtest',{...binding,strategyId:strategy.id,startDate:'2026-01-02',endDate:'2026-10-23'})).run;
}
const approve=(h,p,extra={})=>h.req('/plans/'+p.id+'/approve',{confirm:true,fingerprint:p.fingerprint,...extra});
test('actual routes persist a concrete preview, recheck exact evidence and preserve one planning approval identity',async t=>{
 const h=await host(t),run=await study(h),p=(await h.req('/plans',{runId:run.id})).plan;
 assert.equal(p.status,'pending-review');assert.equal(p.actions[0].symbol,'ABC');assert.equal(p.actions[0].changeQty,9);assert.equal(p.evidence.history.source,'schwab');
 const a=await approve(h,p);assert.equal(a.status,200);assert.equal(a.approval.status,'planning-approved');assert.equal(a.realOrdersPlaced,0);assert.equal(a.borrowingAuthorized,false);assert.equal(a.liveLimitsChanged,false);
 const again=await approve(h,p);assert.equal(again.approval.id,a.approval.id);
 const index=await h.req('/plans');assert.equal(index.plans.length,1);assert.equal(index.plans[0].status,'planning-approved');assert.equal(index.plans[0].evidence,undefined,'bulk listing does not send price histories/account witnesses');
 assert.ok(h.calls.filter(c=>c.intent).every(c=>['trading.accounts','trading.bars','trading.quotes'].includes(c.intent)));
});
test('a larger margin plan requires exact exceptions and cannot replace missing/failed broker facts with an acknowledgement',async t=>{
 const h=await host(t),run=await study(h,config({grossExposurePct:150,marginAprPct:12,maintenancePct:30})),p=(await h.req('/plans',{runId:run.id})).plan;
 assert.ok(p.funding.modeledBorrowingIncreaseUsd>0);assert.equal((await approve(h,p)).error,'planning_exceptions_required');
 const accepted=await approve(h,p,{acknowledgePlanningExceptions:true});assert.equal(accepted.approval.acknowledgedPlanningExceptions.length,p.planningExceptions.length);assert.equal(accepted.borrowingAuthorized,false);
 delete h.accounts[0].balanceFacts;
 const blocked=(await h.req('/plans',{runId:run.id})).plan;assert.equal(blocked.status,'blocked');assert.ok(blocked.blockers.some(b=>b.code==='broker_buying_power_unknown'));
 assert.equal((await approve(h,blocked,{acknowledgePlanningExceptions:true,acknowledgeUnmanagedSales:true})).error,'plan_facts_blocked');
});
test('whole-account previews show sales outside the strategy and require unmanaged-sale acknowledgement',async t=>{
 const h=await host(t),run=await study(h);h.accounts[0].positions=[{symbol:'OTHER',qty:90,marketValue:9000,unmanaged:true}];
 const keep=(await h.req('/plans',{runId:run.id})).plan;assert.equal(keep.rows.find(r=>r.symbol==='OTHER').action,'preserve');
 const whole=(await h.req('/plans',{runId:run.id,scope:'whole-account'})).plan;assert.ok(whole.actions.some(r=>r.symbol==='OTHER'&&r.action==='sell'));
 assert.equal((await approve(h,whole,{acknowledgePlanningExceptions:true})).error,'unmanaged_sales_confirmation_required');
 assert.equal((await approve(h,whole,{acknowledgePlanningExceptions:true,acknowledgeUnmanagedSales:true})).approval.status,'planning-approved');
});
test('cash/retirement facts, changed balances, changed prices and exact expiry cannot be bypassed',async t=>{
 const h=await host(t),run=await study(h);let p=(await h.req('/plans',{runId:run.id})).plan;
 h.accounts[0].cash=999;assert.equal((await approve(h,p)).error,'plan_account_changed');h.accounts[0].cash=1000;
 h.setQuote('ABC',{tradePrice:101});assert.equal((await approve(h,p)).error,'plan_prices_changed');h.setQuote('ABC',{});
 h.setNow('2026-10-25T06:15:00Z');assert.equal((await approve(h,p)).error,'plan_expired');h.setNow('2026-10-25T06:00:00Z');
 h.accounts[0].accountType='cash';delete h.accounts[0].balanceFacts.cashAvailableForWithdrawal;p=(await h.req('/plans',{runId:run.id})).plan;assert.ok(p.blockers.some(b=>b.code==='settled_cash_unknown'));
 const marginRun=await study(h,config({grossExposurePct:150,marginAprPct:12,maintenancePct:30}));
 // The saved historical run remains immutable even after the current account is reclassified.
 assert.equal(marginRun,undefined,'a cash account cannot create a borrowed historical run');
 h.accounts[0].accountType='margin';h.accounts[0].balanceFacts={buyingPower:20000,debitBalance:0,maintenanceRequirement:2000};
 const priorMarginRun=await study(h,config({grossExposurePct:150,marginAprPct:12,maintenancePct:30}));
 await h.req('/profiles',{...binding,label:'Retirement',registration:'401k'});const retired=(await h.req('/plans',{runId:priorMarginRun.id})).plan;
 assert.ok(retired.blockers.some(b=>b.code==='retirement_leverage_refused'));assert.equal((await approve(h,retired,{acknowledgePlanningExceptions:true,acknowledgeUnmanagedSales:true})).error,'plan_facts_blocked');
});
test('foreign studies/plans and caller-supplied financial inputs refuse; research approval is not plan approval',async t=>{
 const h=await host(t),run=await study(h),p=(await h.req('/plans',{runId:run.id})).plan;
 assert.equal((await h.req('/plans',{runId:run.id},'owner-b')).status,404);assert.equal((await h.req('/plans/'+p.id,undefined,'owner-b')).status,404);assert.equal((await h.req('/plans',undefined,'owner-b')).plans.length,0);
 assert.equal((await h.req('/plans',{runId:run.id,quotes:[{symbol:'ABC',price:1}]})).error,'plan_input_invalid');
 assert.equal((await h.req('/plans/'+p.id+'/approve',{confirm:true,fingerprint:p.fingerprint,cash:999999})).error,'plan_input_invalid');
 const review=(await h.req('/reviews',{runId:run.id})).review;assert.equal((await h.req('/plans/'+review.id+'/approve',{confirm:true,fingerprint:review.fingerprint})).status,404);
 assert.equal((await h.req('/plans/'+p.id+'/approve',{fingerprint:p.fingerprint})).error,'exact_plan_confirmation_required');
});
test('a session change during the approval window demands new signals',async t=>{
 const h=await host(t),run=await study(h);h.setNow('2026-10-26T20:05:00Z');h.setQuote('ABC',{tradeAt:'2026-10-26T20:00:00Z'});
 const p=(await h.req('/plans',{runId:run.id})).plan;assert.equal(p.signalAsOf,'2026-10-23');h.setNow('2026-10-26T20:16:00Z');assert.equal((await approve(h,p)).error,'plan_signal_changed');
});

test('retained source evidence is fetched separately, owner scoped and fingerprint checked before approval',async t=>{
 const h=await host(t),run=await study(h),p=(await h.req('/plans',{runId:run.id})).plan;
 assert.equal((await h.req('/plans/'+p.id)).plan.evidence.history.source,'schwab');
 assert.ok(h.calls.some(c=>c.sql?.startsWith('SELECT record_id FROM')&&c.args[1]==='plan-evidence'),'record counting never loads every retained price snapshot');
 const key='owner-a|'+p.evidence.snapshotId,row=h.records.get(key),snapshot=JSON.parse(row.payload);snapshot.history.source='changed-source';row.payload=JSON.stringify(snapshot);
 assert.equal((await h.req('/plans/'+p.id)).error,'plan_evidence_changed');assert.equal((await approve(h,p)).error,'plan_evidence_changed');
});
test('concurrent planning approval retries retain the first immutable receipt',async t=>{
 const h=await host(t),run=await study(h),p=(await h.req('/plans',{runId:run.id})).plan;
 const responses=await Promise.all([approve(h,p),approve(h,p)]);assert.ok(responses.every(r=>r.status===200));assert.equal(responses[0].approval.id,responses[1].approval.id);assert.equal(responses[0].approval.approvedAt,responses[1].approval.approvedAt);
 const approvals=[...h.records.values()].filter(r=>r.kind==='plan-approval');assert.equal(approvals.length,1);assert.ok(h.calls.some(c=>c.sql?.includes('DO NOTHING')&&c.args[2]==='plan-approval'));
});
