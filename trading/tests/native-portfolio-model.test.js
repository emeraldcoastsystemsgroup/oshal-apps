/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Guard separate accrued interest and margin equity plus explicit open-position daily P&L scope.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Native broker facts stay measured and distinct: no compatibility buying-power fallback, no inferred settlement, and retirement borrowing stays unavailable.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove real/paper capital separation, all-holding coverage, explicit retirement registration and conservative unknown margin facts on the shipped portfolio model.
 */
'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const model = require('../routes/trading-portfolio-model');
const account = (id, extra = {}) => ({accountId:id,connectionKey:'login',kind:'live',accountType:'margin',equity:10000,cash:1000,buyingPower:20000,positions:[{symbol:'NVDA',qty:10,marketValue:9000,unmanaged:true}],...extra});

test('paper money and paper losses never count as real portfolio capital', () => {
 const result = model.capitalSummary([account('a',{dayChange:-1000}),account('paper',{kind:'paper',ref:'paper',equity:100000,dayChange:5000}),account('outside',{kind:'outside',equity:2000,dayChange:null})]);
 assert.equal(result.real.equity,12000);assert.equal(result.real.dayChange,-1000);
 assert.equal(result.paper.equity,100000);assert.equal(result.paper.dayChange,5000);
 assert.equal(result.real.dayChangePartial,true);assert.equal(result.includesPaperInRealCapital,false);
});

test('retirement is separate from cash/margin mechanics and never allows leverage simulation', () => {
 for (const registration of ['401k','ira','roth-ira']) {
  const row = model.accountConstraints(account('a'),registration);
  assert.equal(row.retirement,true);assert.equal(row.leverageSimulationAllowed,false);
  assert.equal(row.borrowingExecutionAvailable,false);
 }
 assert.equal(model.accountConstraints(account('a')).group,'unclassified');
 assert.equal(model.accountConstraints(account('a')).leverageSimulationAllowed,false);
 assert.equal(model.accountConstraints(account('a'),'taxable').group,'margin');
 assert.equal(model.accountConstraints(account('a'),'taxable').leverageSimulationAllowed,true);
 assert.equal(model.accountConstraints(account('a',{accountType:'cash'}),'taxable').group,'cash');
});

test('missing debt, settlement and maintenance facts are null, and zero buying power stays zero', () => {
 const c = model.accountConstraints(account('a',{buyingPower:0}),'taxable');
 assert.equal(c.reportedBuyingPower,0);assert.equal(c.marginDebt,null);
 assert.equal(c.settledCash,null);assert.equal(c.maintenanceRequirement,null);
 for (const value of [null,undefined,'0',NaN,Infinity]) assert.equal(model.measured(value),null);
});

test('all positions appear independently of watchlist membership and no management is fabricated', () => {
 const a=account('a',{positions:[{symbol:'NVDA',qty:10,marketValue:5000,unmanaged:true},{symbol:'MSFT',qty:10,marketValue:4000,unmanaged:true}]});
 const result = model.buildPortfolio([a],[],['nvda']);
 assert.equal(result.coverage.holdings,2);assert.equal(result.coverage.notWatchlisted,1);
 assert.equal(result.accounts[0].holdings[1].symbol,'MSFT');
 assert.ok(result.accounts[0].holdings.every(p=>p.management==='view-only'));
 assert.equal(result.accounts[0].strategyAppliedToBroker,false);
 assert.equal(result.coverage.outsideAccountsVerifiedComplete,false);
});

test('partial failures, missing positions and nonfinite money never masquerade as complete coverage', () => {
 const result=model.buildPortfolio([account('a',{positions:undefined})],[],[],[{message:'Another login failed.'}]);
 assert.equal(result.coverage.allHoldingsCovered,false);assert.equal(result.coverage.sourceFailures,1);
 assert.equal(model.capitalGroup([{kind:'live',error:'failed'}]).equity,null);
 assert.equal(model.capitalGroup([{equity:NaN}]).equity,null);
 assert.equal(model.capitalGroup([{equity:0,dayChange:0}]).equity,0);
 assert.equal(model.inventoryAccount(account('a',{equity:0}),undefined,new Set()).grossExposurePct,null);
});

test('duplicate opaque identities cannot double-count or collide by masked suffix', () => {
 const a=account('a',{accountMasked:'…1234'}),b=account('b',{accountMasked:'…1234'});
 assert.equal(model.uniqueAccounts([a,a,b]).length,2);
 assert.throws(()=>model.uniqueAccounts([a,{...a,equity:20000}]),e=>e.code==='account_snapshot_conflict');
 assert.throws(()=>model.uniqueAccounts([{equity:1000}]),e=>e.code==='account_binding_missing');
});

test('cross-account concentration excludes paper and separates retirement registration from taxable margin capital',()=>{
 const profiles=[{accountId:'a',connectionKey:'login',registration:'401k',label:'Plan'},{accountId:'b',connectionKey:'login',registration:'taxable',label:'Taxable'}];
 const result=model.buildPortfolio([account('a'),account('b',{equity:20000,positions:[{symbol:'NVDA',qty:20,marketValue:18000,unmanaged:true}]}),account('paper',{kind:'paper',equity:1e6,positions:[{symbol:'OTHER',qty:1,marketValue:1e6}]})],profiles,[]);
 assert.equal(result.risk.groups['401k'].equity,10000);assert.equal(result.risk.groups.margin.equity,20000);assert.equal(result.risk.exposures.length,1);
 assert.equal(result.risk.exposures[0].symbol,'NVDA');assert.equal(result.risk.exposures[0].accounts,2);assert.equal(result.risk.exposures[0].shareOfReportedEquityPct,90);
 assert.equal(result.risk.grossExposurePct,90);assert.equal(result.risk.paperExcluded,true);
});
test('failed sources force partial totals and incomplete concentration even when every returned account is priced',()=>{
 const result=model.buildPortfolio([account('a')],[],[],[{message:'Other login did not answer'}]);
 assert.equal(result.capital.real.partial,true);assert.equal(result.capital.live.partial,true);assert.equal(result.capital.real.dayChangePartial,true);
 assert.equal(result.risk.complete,false);assert.equal(result.risk.grossExposurePct,null);assert.equal(result.risk.exposures[0].shareOfReportedEquityPct,null);
});
test('stale outside statements and missing holding values cannot become verified complete concentration',()=>{
 const now=new Date('2026-10-25T06:00:00Z');
 const outside=model.inventoryAccount(account('old',{kind:'outside',asOf:'2026-09-01'}),undefined,new Set());
 const stale=model.portfolioRisk([outside],0,now);assert.equal(stale.staleOutsideAccounts,1);assert.equal(stale.complete,false);assert.equal(stale.grossExposurePct,null);
 const partial=model.portfolioRisk([model.inventoryAccount(account('partial',{positions:[{symbol:'NVDA',qty:1,marketValue:null}]}),undefined,new Set())],0,now);
 assert.equal(partial.exposures[0].valueComplete,false);assert.equal(partial.grossMarketValue,null);
 assert.equal(partial.exposures[0].shareOfReportedEquityPct,null);
});

test('native account review uses measured broker facts while keeping settlement and retirement restrictions distinct',()=>{
 const facts={buyingPower:0,debitBalance:500,maintenanceRequirement:1200,cashAvailableForWithdrawal:700,cashAvailableForTrading:900,unsettledCash:300,marginBalance:-500,accruedInterest:12.5,marginEquity:2500,equityPercentage:25};
 const row=account('a',{broker:'schwab',buyingPower:999999,marginDebt:9999,maintenanceRequirement:8888,balanceFacts:facts});
 for(const registration of ['taxable','401k','ira']){
  const c=model.accountConstraints(row,registration);assert.equal(c.reportedBuyingPower,0);assert.equal(c.marginDebt,500);assert.equal(c.maintenanceRequirement,1200);assert.equal(c.withdrawableCash,700);assert.equal(c.availableForTradingCash,900);assert.equal(c.unsettledCash,300);assert.equal(c.reportedMarginBalance,-500);assert.equal(c.settledCash,null);assert.equal(c.borrowingExecutionAvailable,false);
  if(registration!=='taxable')assert.equal(c.leverageSimulationAllowed,false);
  assert.equal(c.accruedInterest,12.5);assert.equal(c.marginEquity,2500);assert.equal(c.equityPercentage,25);
 }
});
test('missing or malformed native broker facts cannot inherit top-level cash or compatibility capacity',()=>{
 for(const balanceFacts of [undefined,{}, {buyingPower:null,debitBalance:'0',maintenanceRequirement:false,cashAvailableForWithdrawal:'700',unsettledCash:NaN}]){
  const c=model.accountConstraints(account('a',{broker:'schwab',buyingPower:20000,marginDebt:500,maintenanceRequirement:1200,balanceFacts}),'taxable');
  for(const key of ['reportedBuyingPower','marginDebt','maintenanceRequirement','withdrawableCash','unsettledCash','settledCash','accruedInterest','marginEquity','equityPercentage'])assert.equal(c[key],null,key+' stays unknown');
 }
});
test('native open-position day P&L is labelled as a limited basis rather than a full account return',()=>{
 const native=model.capitalGroup([account('a',{nativeReadOnly:true,dayChange:10}),account('b',{nativeReadOnly:true,dayChange:0})]);
 assert.equal(native.dayChange,10);assert.equal(native.dayChangeBasis,'open-positions');
 const mixed=model.capitalGroup([account('a',{nativeReadOnly:true,dayChange:10}),account('b',{dayChange:-20})]);
 assert.equal(mixed.dayChangeBasis,'mixed');
});
