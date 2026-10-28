/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Monthly previews use only the completed-month signal history; current quotes, holdings, funding and orders are still independently verified.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Original-owner strategy review retains exact research, current holdings/debt and a read-only initial transition. No watcher tick or broker effect occurs while preparing the review.
 */
'use strict';
const {listRecords,fingerprint}=require('../trading-portfolio-store');
const {portfolioHistory}=require('../trading-portfolio-history');
const {portfolioSignalHistoryEnd}=require('../trading-portfolio-rotation');
const {portfolioNextTargets}=require('../trading-portfolio-sim');
const {lastCompletedSession}=require('../trading-portfolio-calendar');
const {planSymbols,readPlanQuotes}=require('../trading-portfolio-plan-evidence');
const {PortfolioError,accountKey}=require('../trading-portfolio-model');
const {allocationBlockingOrders}=require('./protective-execution');
const {allocationPlan,actionBlockers,orderedActions}=require('./allocation');
const TERMINAL=new Set(['FILLED','CANCELED','CANCELLED','REJECTED','EXPIRED','REPLACED']);
async function strategyReview(ctx,owner,watch,study,capitalCents,scope,{host,selected,clock}){
 const {run,config,strategy}=study;
 const later=(await listRecords(ctx,owner,'run')).filter(r=>r.id!==run.id&&r.status==='completed'&&r.strategyId===run.strategyId&&accountKey(r)===accountKey(run)&&r.startDate>run.startDate&&r.endDate<=run.endDate&&fingerprint(r.strategy?.config)===fingerprint(config)).sort((a,b)=>b.startDate.localeCompare(a.startDate)||a.id.localeCompare(b.id));
 const summarize=r=>({id:r.id,startDate:r.startDate,endDate:r.endDate,window:r.result?.window,metrics:r.result?.metrics,costs:r.result?.costs,evidenceFingerprint:r.evidenceFingerprint});
 const review={research:{...summarize(run),strategyName:strategy.name,currentCongressBasket:!!strategy.universeEvidence,laterRuns:later.slice(0,10).map(summarize),laterRunCount:later.length},activationReady:false,scope};
 if(![review.research.metrics?.totalReturnPct,review.research.metrics?.benchmarkReturnPct,review.research.metrics?.maxDrawdownPct,review.research.costs?.tradingUsd].every(n=>typeof n==='number'&&Number.isFinite(n))){review.proposalError='The saved strategy performance and costs are unavailable. Complete a verified study before approval.';return review;}
 try{
  const at=clock(),fresh=await selected(owner,watch,at);
  if(fresh.profile?.strategyId!==watch.strategyId)throw new PortfolioError(409,'strategy_assignment_changed','The account strategy changed during review.');
  const latest=lastCompletedSession(at),evidenceThrough=portfolioSignalHistoryEnd(config,latest),start=new Date(Date.parse(latest+'T00:00:00Z')-110*86400000).toISOString().slice(0,10),bound={connection:fresh.account.connectionKey,accountId:fresh.account.accountId};
  const [history,quotes,balance,orders,tickets]=await Promise.all([portfolioHistory(ctx,bound.connection,config,start,evidenceThrough,at),readPlanQuotes(ctx,bound.connection,planSymbols(fresh.account,config)),host(ctx,'balance',bound),host(ctx,'list',bound),host(ctx,'tickets',bound)]);
  if(!Array.isArray(orders.orders)||!Array.isArray(tickets.tickets))throw new PortfolioError(503,'review_orders_unavailable','Complete current broker orders and retained attempts are required.');
  const signal={...portfolioNextTargets(config,history.series,latest),evidenceThrough};
  const plan=allocationPlan(fresh,config,signal,quotes.quotes,capitalCents,scope==='whole-account'?'whole-account':'preserve-other-holdings',at,balance.cashBudgetUsd);
  if(tickets.tickets.some(t=>['attempting','unknown'].includes(t.status)))plan.blockers.push({code:'uncertain_order',message:'An uncertain broker attempt must be reconciled before approval.'});
  const working=orders.orders.filter(o=>!TERMINAL.has(o.status));
  if(allocationBlockingOrders(working,tickets.tickets,fresh.account).length)plan.blockers.push({code:'working_broker_order',message:'Resolve working or unrecognized broker orders before this transition.'});
  for(const a of plan.actions.filter(a=>a.action==='sell')){
   const reserved=working.filter(o=>o.legs?.length===1&&o.legs[0].instruction==='SELL'&&o.legs[0].symbol===a.symbol).reduce((n,o)=>n+(Number.isFinite(o.remainingQuantity)?o.remainingQuantity:Infinity),0);
   if(a.currentQty-reserved<Math.abs(a.changeQty))plan.blockers.push({code:'protected_sale_requires_coordination',symbol:a.symbol,message:a.symbol+': the sale overlaps broker-held protection; a verified transition is required.'});
  }
  plan.actions=orderedActions(plan.actions,scope==='whole-account');
  review.actionEligibility=plan.actions.map(a=>({symbol:a.symbol,action:a.action,blockers:actionBlockers(plan,a.action,a.symbol)}));
  review.proposal=plan;review.signal=signal;review.brokerReadAt=clock().toISOString();
  review.activationReady=!plan.blockers.length||review.actionEligibility.some(a=>!a.blockers.length);
 }catch(e){review.proposalError=e instanceof PortfolioError?e.message:'The complete current account transition could not be verified.';}
 return review;
}
module.exports={strategyReview};
