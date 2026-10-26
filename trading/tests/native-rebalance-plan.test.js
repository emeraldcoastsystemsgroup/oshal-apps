/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise concrete rebalance math using explicit synthetic broker facts: every holding, costs, target timing, cash/retirement funding, actual versus fallback capacity, planning exceptions and zero execution authority.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildRebalancePlan,planQuoteStatus}=require('../routes/trading-portfolio-plan');
const {portfolioNextTargets}=require('../routes/trading-portfolio-sim');
const {sessionDates}=require('../routes/trading-portfolio-calendar');
const now=()=>new Date('2026-10-25T06:00:00Z');
const cfg=(extra={})=>({modelVersion:1,kind:'allocation',assets:[{symbol:'ABC',weightPct:100}],lookbackSessions:20,rebalanceSessions:20,topN:1,grossExposurePct:100,transactionCostBps:10,marginAprPct:null,maintenancePct:null,fractionalShares:false,...extra});
const quote=(symbol,extra={})=>({symbol,tradePrice:100,tradeAt:'2026-10-23T19:59:00Z',source:'schwab',delayed:false,...extra});
const base=(extra={})=>({account:{accountId:'a',connectionKey:'own',broker:'schwab',kind:'live',accountType:'cash',equity:10000,cash:1000,positions:[{symbol:'ABC',qty:90,marketValue:9000,unmanaged:true}],balanceFacts:{cashAvailableForWithdrawal:1000,buyingPower:20000,debitBalance:0,maintenanceRequirement:2000}},profile:{accountId:'a',connectionKey:'own',registration:'taxable',label:'Account'},config:cfg(),targets:[{symbol:'ABC',weightPct:100}],signalAsOf:'2026-10-23',quotes:[quote('ABC')],scope:'preserve-other-holdings',now:now(),...extra});
const codes=p=>p.blockers.map(b=>b.code);
test('a concrete cash preview reserves modeled costs, keeps fractional rules and cannot execute',()=>{
 const p=buildRebalancePlan(base());assert.equal(p.status,'pending-review');assert.equal(p.actions[0].action,'buy');assert.equal(p.actions[0].changeQty,9);assert.equal(p.buyUsd,900.9);assert.equal(p.funding.derivedFinancingCashAfter,99.1);
 assert.equal(p.execution.available,false);assert.equal(p.execution.realOrdersPlaced,0);assert.equal(p.execution.borrowingAuthorized,false);assert.equal(p.execution.liveLimitsChanged,false);
});
test('cash and retirement funding never assumes sale proceeds are settled',()=>{
 const b=base(),p=buildRebalancePlan({...b,account:{...b.account,positions:[{symbol:'OTHER',qty:90,marketValue:9000,unmanaged:true}]},quotes:[quote('ABC'),quote('OTHER')],scope:'whole-account'});
 assert.ok(p.actions.some(r=>r.symbol==='OTHER'&&r.action==='sell'));assert.ok(codes(p).includes('sale_or_settlement_funding_required'));assert.equal(p.requiresUnmanagedSalesAcknowledgement,true);
 for(const registration of ['401k','ira','roth-ira']){const i=base();i.account.accountType='margin';i.profile.registration=registration;i.config=cfg({grossExposurePct:150,marginAprPct:12,maintenancePct:30});assert.ok(codes(buildRebalancePlan(i)).includes('retirement_leverage_refused'));}
});
test('outside-strategy holdings are preserved by default and explicitly sold only in whole-account scope',()=>{
 const b=base();b.account={...b.account,cash:1000,positions:[{symbol:'OTHER',qty:90,marketValue:9000,unmanaged:true}]};b.quotes=[quote('ABC'),quote('OTHER')];
 const keep=buildRebalancePlan(b),sell=buildRebalancePlan({...b,scope:'whole-account'});
 assert.equal(keep.rows.find(r=>r.symbol==='OTHER').action,'preserve');assert.equal(keep.funding.allocationBaseUsd,1000);assert.equal(keep.funding.preservedHoldingsUsd,9000);assert.equal(keep.actions.find(r=>r.symbol==='OTHER'),undefined);
 assert.ok(sell.actions.some(r=>r.symbol==='OTHER'&&r.changeQty===-90));assert.equal(sell.rows.length,2);
});
test('margin capacity uses measured provider facts, never the compatibility buying-power fallback',()=>{
 const i=base();i.account.accountType='margin';i.config=cfg({grossExposurePct:150,marginAprPct:12,maintenancePct:30});
 const p=buildRebalancePlan(i);assert.equal(p.status,'pending-review');assert.ok(p.funding.modeledBorrowingIncreaseUsd>0);assert.ok(p.planningExceptions.some(e=>e.code==='gross_exposure'));assert.equal(p.execution.borrowingAuthorized,false);assert.equal(p.funding.projectedBrokerMaintenanceRequirement,null);
 const missing=base();missing.account.accountType='margin';missing.account.buyingPower=999999;delete missing.account.balanceFacts;missing.config=i.config;
 assert.ok(codes(buildRebalancePlan(missing)).includes('broker_buying_power_unknown'));assert.ok(codes(buildRebalancePlan(missing)).includes('margin_facts_unknown'));
 const zero=base();zero.account.accountType='margin';zero.account.balanceFacts.buyingPower=0;assert.ok(codes(buildRebalancePlan(zero)).includes('broker_buying_power_exceeded'));
});
test('planning exceptions do not override hard broker funding or maintenance blockers',()=>{
 const i=base();i.account.accountType='margin';i.config=cfg({grossExposurePct:150,marginAprPct:12,maintenancePct:30});i.account.balanceFacts.buyingPower=10;i.account.balanceFacts.maintenanceRequirement=11000;
 const p=buildRebalancePlan(i);assert.equal(p.status,'blocked');assert.ok(codes(p).includes('broker_buying_power_exceeded'));assert.ok(codes(p).includes('current_maintenance_not_met'));assert.ok(p.planningExceptions.length>0);
});
test('missing settled facts, unclassified registrations and outside statements remain blocked',()=>{
 const i=base();delete i.account.balanceFacts;assert.ok(codes(buildRebalancePlan(i)).includes('settled_cash_unknown'));
 const unknown=base();delete unknown.profile;assert.ok(codes(buildRebalancePlan(unknown)).includes('account_classification_required'));
 const outside=base();outside.account.kind='outside';assert.ok(codes(buildRebalancePlan(outside)).includes('outside_account_unverified'));
});
test('unknown, delayed, stale or future trade evidence blocks approval without inventing a mark timestamp',()=>{
 for(const extra of [{delayed:null},{delayed:true},{tradeAt:null},{tradeAt:'2026-10-26T14:00:00Z'},{tradeAt:'2026-10-22T19:59:00Z'}])assert.ok(buildRebalancePlan(base({quotes:[quote('ABC',extra)]})).blockers.length>0);
 assert.equal(planQuoteStatus(quote('ABC'),now()).length,0);
 assert.ok(planQuoteStatus(quote('ABC'),new Date('2026-10-26T15:00:00Z')).some(e=>e.code==='quote_stale'));
 assert.throws(()=>buildRebalancePlan(base({quotes:[quote('ABC',{tradePrice:null})]})),e=>e.code==='plan_quote_missing');
});
test('account reconciliation and unsupported/duplicate/short holdings refuse instead of omitting holdings',()=>{
 const i=base();i.account.equity=15000;assert.ok(codes(buildRebalancePlan(i)).includes('account_reconciliation_required'));
 for(const positions of [[{symbol:'ABC',qty:-1,marketValue:100}],[{symbol:'UNSUPPORTED INSTRUMENT',qty:1,marketValue:100}],[{symbol:'ABC',qty:1,marketValue:100},{symbol:'ABC',qty:1,marketValue:100}]])assert.throws(()=>buildRebalancePlan({...base(),account:{...base().account,positions}}));
 assert.throws(()=>buildRebalancePlan(base({quotes:[]})),e=>e.code==='plan_quote_missing');
});
test('whole-share plans expose retained fractional residuals and canonicalize share class aliases',()=>{
 const b=base();b.account.positions=[{symbol:'OTHER',qty:2.5,marketValue:250}];b.account.equity=1250;b.quotes=[quote('ABC'),quote('OTHER')];b.scope='whole-account';assert.ok(codes(buildRebalancePlan(b)).includes('fractional_residual_requires_review'));
 const c=base();c.account.positions=[{symbol:'BRK.B',qty:90,marketValue:9000}];c.config=cfg({assets:[{symbol:'BRK/B',weightPct:100}]});c.targets=[{symbol:'BRK/B',weightPct:100}];c.quotes=[quote('BRK.B')];assert.equal(buildRebalancePlan(c).rows.length,1);
});
test('next-session trend/momentum targets include only completed data and fail on missing warmup',()=>{
 const days=sessionDates('2026-01-02','2026-10-23'),series={ABC:days.map((date,n)=>({date,close:100+n})),XYZ:days.map((date,n)=>({date,close:200-n/2})),SPY:days.map(date=>({date,close:100}))};
 const config=cfg({kind:'momentum',assets:[{symbol:'ABC',weightPct:50},{symbol:'XYZ',weightPct:50}]});
 const p=portfolioNextTargets(config,series,'2026-10-23');assert.deepEqual(p.targets,[{symbol:'ABC',weightPct:100}]);
 series.XYZ.push({date:'2026-10-26',close:99999});assert.deepEqual(portfolioNextTargets(config,series,'2026-10-23'),p,'Monday prices cannot enter Friday signals');
 const missing={...series,ABC:series.ABC.slice(-5)};assert.throws(()=>portfolioNextTargets(config,missing,'2026-10-23'),e=>e.code==='incomplete_history');
});

test('reported debit is not subtracted twice when cash is already net, and both explicit balance bases reconcile',()=>{
 const i=base();i.account.accountType='margin';i.account.positions=[{symbol:'ABC',qty:150,marketValue:15000,unmanaged:true}];i.account.balanceFacts.debitBalance=5000;
 for(const cash of [-5000,0]){const p=buildRebalancePlan({...i,account:{...i.account,cash}});assert.equal(codes(p).includes('account_reconciliation_required'),false);assert.equal(p.funding.modeledBorrowingBeforeUsd,5000);assert.equal(p.funding.modeledBorrowingAfterUsd,5,'selling 50 whole shares repays principal but leaves the modeled $5 transaction cost');assert.equal(p.modeledCostsUsd,5);assert.equal(p.funding.modeledAnnualInterestUsd,null,'interest remains unknown without an assumed APR');assert.equal(p.funding.reconciliationBasis,cash<0?'reported-cash-already-net':'reported-cash-minus-debit');}
});
test('fractional previews conserve net financing and reserve costs without a spurious exposure exception',()=>{
 const i=base();i.account.positions=[];i.account.equity=100;i.account.cash=100;i.account.balanceFacts.cashAvailableForWithdrawal=100;i.config=cfg({fractionalShares:true});
 const p=buildRebalancePlan(i);assert.equal(p.status,'pending-review');assert.ok(p.funding.derivedFinancingCashAfter>=0);assert.equal(p.planningExceptions.some(e=>e.code==='gross_exposure'),false);
 const rawCash=100-p.rows.reduce((sum,r)=>sum+r.changeQty*r.referencePrice+r.modeledCostUsd,0);assert.ok(rawCash>=-0.00001);
});
test('quote transport is bounded to exact caller connection and instruments, without owner/URL inputs',async()=>{
 const {readPlanQuotes}=require('../routes/trading-portfolio-plan-evidence'),asked=[];
 const symbols=Array.from({length:125},(_,n)=>'A'+n);
 const answer=await readPlanQuotes({intent:async(name,input)=>{asked.push({name,input});return{source:'schwab',quotes:input.symbols.map(s=>quote(s))};}},'owned-login',symbols);
 assert.equal(answer.quotes.length,125);assert.equal(asked.length,3);
 for(const a of asked){assert.equal(a.name,'trading.quotes');assert.equal(a.input.connection,'owned-login');assert.ok(a.input.symbols.length<=50);assert.deepEqual(Object.keys(a.input).sort(),['connection','symbols']);}
 await assert.rejects(()=>readPlanQuotes({intent:async()=>({source:'schwab',quotes:[quote('WRONG')]})},'owned-login',['ABC']),e=>e.code==='plan_quotes_invalid');
 await assert.rejects(()=>readPlanQuotes({intent:async()=>({source:'schwab',quotes:[]})},'owned-login',['ABC']),e=>e.code==='plan_quotes_incomplete');
});
