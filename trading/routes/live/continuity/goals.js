/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Reconcile unsubmitted purchase goals to current targets and conserved economic budgets; bound each new chunk by verified funding.
 */
'use strict';
const {PortfolioError}=require('../../trading-portfolio-model');
const {actionProgress}=require('../allocation');
const invalid=message=>{throw new PortfolioError(409,'continuity_evidence_invalid',message);};
const keyFor=action=>action.action+':'+action.symbol;
function costPerShare(limitCents,rate){
 if(!Number.isSafeInteger(limitCents)||limitCents<1||!Number.isFinite(rate)||rate<0)invalid('Purchase prices and modeled costs must be finite and nonnegative.');
 const cost=Math.ceil(limitCents*(1+rate));
 if(!Number.isSafeInteger(cost)||cost<1)invalid('Modeled purchase costs exceed the supported range.');
 return cost;
}

/** @description Read the retained goal without altering the original holdings baseline. @param record Cycle. @param action Original action. @param rate Cost fraction. @returns Goal. */
function retainedGoal(record,action,rate){
 if(!Number.isFinite(action.referencePrice)||action.referencePrice<=0)invalid('The original purchase price must be measured.');
 if(record.continuity&&Object.hasOwn(record.continuity,'goals')&&(!record.continuity.goals||typeof record.continuity.goals!=='object'||Array.isArray(record.continuity.goals)))invalid('The retained purchase goals are malformed.');
 const quantity=Math.abs(action.changeQty),goals=record.continuity?.goals,hasGoal=Object.hasOwn(goals||{},keyFor(action)),kept=goals?.[keyFor(action)];
 const limitCents=Math.max(1,Math.round(action.referencePrice*100*1.001));
 const budgetCents=quantity*costPerShare(limitCents,rate);
 if(!Number.isSafeInteger(quantity)||quantity<0||!Number.isSafeInteger(budgetCents)||budgetCents<0)invalid('The original purchase goal exceeds the supported range.');
 if(hasGoal&&(!kept||!Number.isSafeInteger(kept.quantity)||kept.quantity<0||kept.quantity>quantity||!Number.isSafeInteger(kept.budgetCents)||kept.budgetCents<0||kept.budgetCents>budgetCents))invalid('The retained purchase goal is inconsistent with its original allocation.');
 return hasGoal?kept:{quantity,budgetCents};
}

/** @description Count filled commitments at their maximum approved price plus modeled costs. @param action Action. @param tickets Reconciled cycle tickets. @param rate Cost fraction. @returns Reserved cost cents. */
function filledCost(action,tickets,rate){
 return tickets.filter(t=>t.terms.symbol===action.symbol&&t.terms.side===action.action&&t.status==='submitted').reduce((sum,t)=>{
  const qty=t.brokerStatus?.filledQuantity,limit=t.terms.limitCents;
  if(!Number.isSafeInteger(qty)||qty<0||!Number.isSafeInteger(t.terms.quantity)||qty>t.terms.quantity||!Number.isSafeInteger(limit)||limit<1)invalid('Filled purchase costs require exact quantities and approved prices.');
  const cost=sum+qty*costPerShare(limit,rate);
  if(!Number.isSafeInteger(cost))invalid('Filled purchase costs exceed the supported range.');
  return cost;
 },0);
}

/** @description Assess the already retained goal before considering protection or new sizing. @param record Cycle. @param action Original action. @param tickets Tickets. @param sold Protected sales. @param rate Cost fraction. @returns Existing progress. */
function retainedProgress(record,action,tickets,sold,rate){
 const goal=action.action==='buy'?retainedGoal(record,action,rate).quantity:Math.abs(action.changeQty);
 return actionProgress({...action,changeQty:action.action==='sell'?-goal:goal},tickets,sold);
}

/** @description Shrink only unsubmitted work using a verified fresh target, never temporary cash. @param input Current execution facts. @returns Goal revision or a prepared-ticket refusal. */
function reviseBuyGoal({record,action,progress,plan,tickets,limitCents,rate}){
 const old=retainedGoal(record,action,rate),fresh=plan.rows.find(r=>r.symbol===action.symbol);
 if(!Number.isSafeInteger(progress.filled)||progress.filled<0||progress.filled>old.quantity)invalid('Reconciled filled quantity must fit within the retained purchase goal.');
 if(!fresh||!Number.isSafeInteger(fresh.changeQty))invalid('A fresh whole-share target is required before revising a purchase.');
 const remaining=Math.max(0,fresh.changeQty),spent=filledCost(action,tickets,rate),unit=costPerShare(limitCents,rate);
 const budgetCents=Math.max(spent,Math.min(old.budgetCents,spent+remaining*unit));
 const quantity=Math.max(progress.filled,Math.min(old.quantity,progress.filled+remaining,progress.filled+Math.floor((budgetCents-spent)/unit)));
 if(spent>old.budgetCents)invalid('Recorded fills exceed the retained economic budget.');
 if(progress.prior&&progress.prior.terms.quantity>quantity-progress.filled)return{status:'prepared-chunk-review-required',ticket:progress.prior};
 const goal={quantity,budgetCents},changed=old.quantity!==quantity||old.budgetCents!==budgetCents;
 return{status:quantity===progress.filled?'filled':'prepare',goal,changed,remaining:quantity-progress.filled,filled:progress.filled,prior:progress.prior};
}

/** @description Quantitative whole-plan funding limits are enforced again on the actual chunk. @param plan Fresh plan. @param blockers Existing blockers. @returns Non-deferrable blockers. */
function chunkBlockers(plan,blockers){
 return blockers.filter(b=>!(b.code==='sale_or_settlement_funding_required'&&Number.isFinite(plan.funding.measuredSettledOrWithdrawableCash)&&plan.funding.measuredSettledOrWithdrawableCash>=0)&&
  !(b.code==='broker_buying_power_exceeded'&&Number.isFinite(plan.funding.measuredBuyingPower)&&plan.funding.measuredBuyingPower>=0));
}

/** @description Bound a new buy by measured cash, exposure and modeled costs; never resize a prepared ticket. @param input Chunk and current account facts. @returns Chunk or resumable wait. */
function fundedChunk({chunk,limitCents,receipt,account,mandate,plan,rate}){
 const unit=costPerShare(limitCents,rate);
 if(!Number.isSafeInteger(chunk.quantity)||chunk.quantity<1)invalid('A purchase chunk must have an exact positive whole-share quantity.');
 const broker=receipt.brokerFunding.cashBudgetUsd;
 if(!Number.isFinite(broker)||broker<0)return{status:'waiting-for-settled-cash'};
 if(!Number.isFinite(account.cash)||!Number.isSafeInteger(limitCents)||limitCents<1||!Number.isSafeInteger(mandate.terms.capitalCents)||mandate.terms.capitalCents<0)invalid('Current cash, price and approved capital must be measured before sizing a chunk.');
 const cashLimits=[Math.max(0,account.cash),broker];
 for(const n of [plan.funding.measuredSettledOrWithdrawableCash,plan.funding.measuredBuyingPower])if(Number.isFinite(n)&&n>=0)cashLimits.push(n);
 const cashCents=Math.max(0,Math.floor(Math.min(...cashLimits)*100)-100),cashQty=Math.floor(cashCents/unit);
 const exposure=account.positions.reduce((sum,p)=>sum+p.marketValue,0);
 if(!Number.isFinite(exposure)||exposure<0||account.positions.some(p=>!Number.isFinite(p.marketValue)||p.marketValue<0))invalid('Every holding must have a measured nonnegative market value.');
 const capQty=Math.max(0,Math.floor((mandate.terms.capitalCents-Math.ceil(exposure*100))/limitCents));
 if(cashQty<1)return{status:'waiting-for-settled-cash'};
 if(capQty<1)return{status:'waiting-for-capital-capacity'};
 if(chunk.prior&&(chunk.quantity>cashQty||chunk.quantity>capQty))return{status:chunk.quantity>cashQty?'waiting-for-settled-cash':'waiting-for-capital-capacity'};
 return{...chunk,quantity:Math.min(chunk.quantity,cashQty,capQty)};
}

module.exports={keyFor,retainedGoal,retainedProgress,reviseBuyGoal,chunkBlockers,fundedChunk};
