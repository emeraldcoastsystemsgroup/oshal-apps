/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Explicitly scoped holding exceptions do not block independent actions; whole-account sales prioritize larger reviewed notionals.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Keep current assessment freshness distinct from the monthly historical cutoff used to derive targets.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve measured net equity/debt during whole-account planning, separate buy funding from long-share sales, and reconcile bounded chunks against retained fills.
 */
'use strict';
const {buildRebalancePlan,canonicalPlanSymbol}=require('../trading-portfolio-plan');
const {PortfolioError}=require('../trading-portfolio-model');
const fail=message=>{throw new PortfolioError(409,'allocation_evidence_invalid',message);};
const BUY_BLOCKERS=new Set(['settled_cash_unknown','sale_or_settlement_funding_required','broker_buying_power_unknown','broker_buying_power_exceeded','margin_facts_unknown','account_reconciliation_required','current_maintenance_not_met','debit_balance_invalid','nonmargin_borrowing_refused']);
function wholeAccount(mandate){return mandate?.terms?.scope==='whole-account'&&mandate.terms.ownership==='all-current-and-future-long-equities';}
// Only these measured, holding-specific exceptions may be deferred. Unknown errors remain global.
const POSITION_BLOCKERS=new Set(['quote_stale','quote_time_invalid','fractional_residual_requires_review','protected_sale_requires_coordination']);
function positionScopedBlocker(b,symbol){return typeof b.symbol==='string'&&b.symbol===symbol&&POSITION_BLOCKERS.has(b.code);}
function actionBlockers(plan,side,symbol){return plan.blockers.filter(b=>
 !(symbol&&typeof b.symbol==='string'&&b.symbol!==symbol&&POSITION_BLOCKERS.has(b.code))&&
 (side!=='sell'||!BUY_BLOCKERS.has(b.code)&&b.code!=='fractional_residual_requires_review'));}
function orderedActions(actions,whole){return actions.slice().sort((a,b)=>
 (a.action==='sell'?0:1)-(b.action==='sell'?0:1)||
 (whole&&a.action==='sell'&&b.action==='sell'?b.notionalUsd-a.notionalUsd:0)||a.symbol.localeCompare(b.symbol));}
/** Funding facts remain measured; the capital cap changes weights, never cash or net equity. */
function allocationPlan(selected,config,signal,quotes,capitalCents,scope,at,cashBudget){
 const original=selected.account;
 if(!Number.isSafeInteger(capitalCents)||capitalCents<10000||!Number.isFinite(original.equity)||original.equity<100)fail('A measured account and exact capital cap are required.');
 const marks=new Map(quotes.map(q=>[canonicalPlanSymbol(q.symbol),q.tradePrice]));
 const marked=original.positions.reduce((eq,p)=>{
  const price=marks.get(canonicalPlanSymbol(p.symbol));if(!Number.isFinite(price)||price<=0)fail('Every holding needs a measured trade price; none are dropped.');
  return eq+p.qty*price-p.marketValue;
 },original.equity);
 if(!Number.isFinite(marked)||marked<=0)fail('Measured repriced net equity must be positive.');
 const capital=Math.min(capitalCents/100,original.equity),scale=Math.min(1,capital/marked);
 const funding=Number.isFinite(cashBudget)?Math.min(Math.max(0,original.cash),cashBudget):null;
 const account={...original,nativeReadOnly:false,notTrading:false,balanceFacts:{...original.balanceFacts,cashAvailableForWithdrawal:funding,cashAvailableForTrading:funding}};
 return buildRebalancePlan({account,profile:selected.profile,config,targets:signal.targets.map(t=>({...t,weightPct:t.weightPct*scale})),signalAsOf:signal.signalAsOf??signal.evidenceThrough,quotes,scope,now:at,buyPriceBufferBps:10});
}
function filledQuantity(ticket){
 if(['prepared','rejected'].includes(ticket.status))return 0;
 const n=ticket.brokerStatus?.filledQuantity;
 if(!Number.isSafeInteger(n)||n<0||n>ticket.terms?.quantity)fail('Native filled quantities are unavailable or inconsistent.');
 return n;
}
function cycleTickets(tickets,mandateId,cycle,approval){return tickets.filter(t=>t.mandateId===mandateId&&t.mandateFingerprint===approval&&t.cycle===cycle);}
function fillBaselines(tickets,mandateId,cycle,approval){return Object.fromEntries(tickets.filter(t=>t.mandateId===mandateId&&t.mandateFingerprint===approval&&t.cycle===cycle||t.allocationMandateId===mandateId).map(t=>[t.ticketId,filledQuantity(t)]));}
/** A missing cycle cannot be reconstructed by silently treating already submitted orders as new. */
function holdingsDrift(record,tickets,account,mandateId,cycle,approval){
 const expected=new Map(record.plan.rows.map(r=>[r.symbol,r.currentQty]));
 for(const t of tickets.filter(t=>t.mandateId===mandateId&&t.mandateFingerprint===approval&&t.cycle===cycle||t.allocationMandateId===mandateId)){
  const delta=filledQuantity(t)-(record.fillBaselines?.[t.ticketId]??0);
  if(delta<0)fail('A broker fill observation moved backwards; reconcile it before another order.');
  const symbol=canonicalPlanSymbol(t.terms.symbol);
  expected.set(symbol,(expected.get(symbol)||0)+(t.terms.side==='buy'?delta:-delta));
 }
 const actual=new Map(account.positions.map(p=>[canonicalPlanSymbol(p.symbol),p.qty]));
 if(actual.size!==account.positions.length)fail('Duplicate current holdings require reconciliation.');
 return [...new Set([...expected.keys(),...actual.keys()])].filter(s=>Math.abs((expected.get(s)||0)-(actual.get(s)||0))>0.000001);
}
function protectiveExits(record,tickets,mandateId){return tickets.filter(t=>t.allocationMandateId===mandateId&&filledQuantity(t)>(record.fillBaselines?.[t.ticketId]??0));}
function actionProgress(action,tickets){
 let filled=0;const prepared=[];
 for(const t of tickets.filter(t=>t.terms.symbol===action.symbol&&t.terms.side===action.action)){
  if(t.status==='prepared'){prepared.push(t);continue;}
  if(t.status!=='submitted'||t.brokerStatus?.status!=='FILLED'||filledQuantity(t)!==t.terms.quantity)return{status:['REJECTED','CANCELED','CANCELLED','EXPIRED','REPLACED'].includes(t.brokerStatus?.status)||t.status==='rejected'?'unfilled-order-review-required':'waiting-for-broker-order',ticket:t};
  filled+=filledQuantity(t);
 }
 const remaining=Math.abs(action.changeQty)-filled;
 if(remaining<0||prepared.length>1)fail('Retained allocation chunks exceed the reviewed action.');
 if(!remaining)return{status:'filled'};
 return{status:'prepare',remaining,filled,prior:prepared[0]};
}
function nextChunk(progress,limitCents){
 const {remaining,filled,prior}=progress;
 const max=Math.min(100000,Math.floor(5000000/limitCents));
 if(!Number.isSafeInteger(max)||max<1)fail('One whole share exceeds the native order notional limit.');
 if(prior&&(prior.terms.quantity>remaining||prior.terms.quantity>max))return{status:'prepared-chunk-review-required',ticket:prior};
 return{status:'prepare',quantity:prior?.terms.quantity??Math.min(remaining,max),filled,prior};
}
module.exports={wholeAccount,actionBlockers,positionScopedBlocker,orderedActions,allocationPlan,cycleTickets,fillBaselines,holdingsDrift,protectiveExits,actionProgress,nextChunk};
