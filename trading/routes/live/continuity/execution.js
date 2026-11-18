/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Bind candidate order preparation and submission to native execution version two.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Execute reconciled, bounded residuals while preserving completed actions, original holdings baselines and native ticket identities.
 */
'use strict';
const {listRecords,fingerprint}=require('../../trading-portfolio-store');
const {PortfolioError}=require('../../trading-portfolio-model');
const {canonicalPlanSymbol}=require('../../trading-portfolio-plan');
const {nyseSessionClock}=require('../../trading-portfolio-calendar');
const {allocationBlockingOrders}=require('../protective-execution');
const {mandateAuthority,submissionCount}=require('../execution-state');
const {wholeAccount,actionBlockers,positionScopedBlocker,orderedActions,allocationPlan,cycleTickets,fillBaselines,holdingsDrift,protectiveExits,nextChunk}=require('../allocation');
const {eventProtectedSymbols}=require('./protection');
const {readCycle,createCycle,updateCycle}=require('./cycles');
const {keyFor,retainedProgress,reviseBuyGoal,chunkBlockers,fundedChunk}=require('./goals');
const TERMINAL=new Set(['FILLED','CANCELED','CANCELLED','EXPIRED','REJECTED','REPLACED']);
const fail=(code,message)=>{throw new PortfolioError(409,code,message);};

async function prepareState(ctx,owner,watch,receipt,deps){
 const at=deps.clock(),study=await deps.boundStudy(ctx,owner,watch,at),{selected,config,run}=study;
 const bound={connection:selected.account.connectionKey,accountId:selected.account.accountId};
 const mandate=await deps.host(ctx,'mandate.status',{...bound,mandateId:watch.mandateId});
 const base={mandate,ordersSubmitted:0,status:'waiting',protection:config.modelVersion===3?'Daily completed-session exits; independent native protection remains separately authorized':'Monthly model exits; independent protection remains separately authorized'};
 const authority=mandateAuthority(mandate,at);
 if(!authority.active)return{result:{...base,status:'mandate-inactive',authority}};
 if(mandate.terms.executionVersion!==2||typeof watch.executionGeneration!=='string'||!watch.executionGeneration||mandate.terms.executionGeneration!==watch.executionGeneration)fail('continuity_authority_required','This account requires an explicitly approved native continuity generation before the new executor can submit.');
 if(mandate.terms.strategyFingerprint!==fingerprint(config))fail('live_strategy_changed','The approved strategy changed; stop and review a new mandate.');
 if(config.modelVersion===3){
  if(mandate.terms.cadence!=='daily'||mandate.terms.accountClass!==config.accountClass)fail('daily_mandate_required','A new daily mandate for this account class is required; monthly authority cannot authorize this model.');
  if(mandate.terms.backtestFingerprint!==run.evidenceFingerprint)fail('daily_study_changed','The approved daily backtest changed.');
  require('../../strategy/authority').assertAtCapital(run,config,mandate.terms.capitalCents);
 }
 if(!nyseSessionClock(at).regular)return{result:{...base,status:'market-closed'}};
 const tickets=(await deps.host(ctx,'refresh',bound)).tickets||[];
 if(tickets.some(t=>['attempting','unknown'].includes(t.status)))return{result:{...base,status:'uncertain-order-review-required'}};
 if(allocationBlockingOrders(receipt.workingOrders,tickets,selected.account).length)return{result:{...base,status:'waiting-for-broker-order'}};
 return{ctx,owner,watch,receipt,deps,at,selected,config,mandate,bound,base,tickets,rate:config.transactionCostBps/10000,deferred:[]};
}

async function prepareCycle(s){
 const {ctx,owner,watch,receipt,selected,config,mandate,at,tickets}=s;
 const sourceBlockers=receipt.proposal.blockers?.filter(b=>b.code==='quote_source_unverified')||[];
 if(sourceBlockers.length)return{status:'blocked',blockers:sourceBlockers};
 s.cycle=receipt.signal.decisionAsOf;s.key=[watch.mandateId,mandate.fingerprint,s.cycle].join(':');
 s.own=cycleTickets(tickets,watch.mandateId,s.cycle,mandate.fingerprint);
 const quotes=receipt.proposal.rows.map(r=>({symbol:r.symbol,tradePrice:r.referencePrice,tradeAt:r.tradeAt,source:'schwab',delayed:false}));
 s.plan=allocationPlan(selected,config,receipt.signal,quotes,mandate.terms.capitalCents,wholeAccount(mandate)?'whole-account':'preserve-other-holdings',at,receipt.brokerFunding.cashBudgetUsd);
 s.record=await readCycle(ctx,owner,s.key);
 if(!s.record){
  if(s.own.length)return{status:'cycle-record-missing-review-required'};
  if(s.plan.blockers.length&&!s.plan.actions.some(a=>!actionBlockers(s.plan,a.action,a.symbol).length))return{status:'blocked',blockers:s.plan.blockers};
  s.record=await createCycle(ctx,owner,s.key,{key:s.key,mandateId:watch.mandateId,cycle:s.cycle,plan:s.plan,fillBaselines:fillBaselines(tickets,watch.mandateId,s.cycle,mandate.fingerprint),status:'in-progress',createdAt:at.toISOString()});
 }
 const drift=holdingsDrift(s.record,tickets,selected.account,watch.mandateId,s.cycle,mandate.fingerprint);
 if(drift.length)return{status:'holdings-changed-review-required',symbols:drift};
 s.protectedSales=new Map();
 for(const t of protectiveExits(s.record,tickets,watch.mandateId)){
  const symbol=canonicalPlanSymbol(t.terms.symbol),sold=t.brokerStatus.filledQuantity-(s.record.fillBaselines?.[t.ticketId]??0);
  s.protectedSales.set(symbol,(s.protectedSales.get(symbol)||0)+sold);
 }
 s.signalStops=eventProtectedSymbols(tickets,watch.mandateId,s.cycle);
 return null;
}

function defer(s,action,blockers){s.deferred.push({symbol:action.symbol,action:action.action,blockers});return{skip:true};}

async function actionDecision(s,action){
 let progress=retainedProgress(s.record,action,s.own,s.protectedSales.get(action.symbol)||0,s.rate);
 if(progress.status==='filled')return{skip:true};
 if(progress.status!=='prepare')return progress;
 if(action.action==='buy'&&(s.protectedSales.has(action.symbol)||s.signalStops.has(action.symbol)))return defer(s,action,[{code:'protective_exit_requires_new_signal',symbol:action.symbol,message:'This instrument was sold by protection. Its old allocation cannot buy it straight back; independent account actions continue.'}]);
 let blockers=actionBlockers(s.plan,action.action,action.symbol);
 if(action.action==='buy')blockers=chunkBlockers(s.plan,blockers);
 if(blockers.length){
  if(blockers.every(b=>positionScopedBlocker(b,action.symbol)))return defer(s,action,blockers);
  return{status:action.action==='buy'?'waiting-for-verified-buy-funding':'blocked',blockers};
 }
 const fresh=s.receipt.proposal.rows.find(r=>r.symbol===action.symbol);
 if(!fresh||!Number.isFinite(fresh.referencePrice)||fresh.referencePrice<=0)fail('live_quote_missing','A current price is unavailable.');
 const limitCents=progress.prior?.expiresAtMs>s.at.getTime()?progress.prior.terms.limitCents:Math.max(1,Math.round(fresh.referencePrice*100*(action.action==='buy'?1.001:.999)));
 if(action.action==='buy'){
  progress=reviseBuyGoal({record:s.record,action,progress,plan:s.plan,tickets:s.own,limitCents,rate:s.rate});
  if(progress.changed){
   const continuity={...s.record.continuity,version:1,goals:{...s.record.continuity?.goals,[keyFor(action)]:progress.goal}};
   s.record=await updateCycle(s.ctx,s.owner,s.key,s.record,{...s.record,continuity});
  }
  if(progress.status==='filled')return{skip:true};
  if(progress.status!=='prepare')return progress;
 }
 let chunk=nextChunk(progress,limitCents);
 if(chunk.status!=='prepare')return chunk;
 if(action.action==='buy')chunk=fundedChunk({chunk,limitCents,receipt:s.receipt,account:s.selected.account,mandate:s.mandate,plan:s.plan,rate:s.rate});
 if(chunk.status!=='prepare')return chunk;
 return{status:'prepare',chunk,limitCents};
}

async function dailyChunk(s,action,chunk,limitCents){
 if(s.config.modelVersion!==3||action.action==='sell'&&action.targetWeightPct===0)return chunk;
 const cycles=await listRecords(s.ctx,s.owner,'live-cycle'),initial=!cycles.some(r=>r.mandateId===s.watch.mandateId&&r.cycle<s.cycle);
 const today=s.at.toISOString().slice(0,10);
 const spent=s.tickets.filter(t=>t.mandateId===s.watch.mandateId&&['submitted','attempting','unknown'].includes(t.status)&&Number.isFinite(t.attemptedAtMs)&&new Date(t.attemptedAtMs).toISOString().slice(0,10)===today).reduce((sum,t)=>{
  const old=cycles.find(r=>r.mandateId===s.watch.mandateId&&r.cycle===t.cycle),row=old?.plan?.actions.find(a=>a.symbol===t.terms.symbol&&a.action===t.terms.side);
  return sum+(t.terms.side==='sell'&&row?.targetWeightPct===0?0:t.terms.quantity*t.terms.limitCents);
 },0);
 const remaining=Math.floor(s.mandate.terms.capitalCents*(initial?s.config.initialTransitionTurnoverPct:s.config.maxDailyTurnoverPct)/100)-spent,allowed=Math.floor(Math.max(0,remaining)/limitCents);
 if(allowed<1||chunk.prior&&chunk.quantity>allowed)return{status:'waiting-for-daily-turnover-budget',cycle:s.cycle};
 return chunk.prior?chunk:{...chunk,quantity:Math.min(chunk.quantity,allowed)};
}

function saleAvailable(s,action,quantity){
 const held=s.selected.account.positions.find(p=>canonicalPlanSymbol(p.symbol)===action.symbol)?.qty||0;
 const reserved=s.receipt.workingOrders.filter(o=>!TERMINAL.has(o.status)&&o.legs?.length===1&&o.legs[0].instruction==='SELL'&&canonicalPlanSymbol(o.legs[0].symbol)===action.symbol).reduce((n,o)=>n+(Number.isFinite(o.remainingQuantity)?o.remainingQuantity:Infinity),0);
 return held-reserved>=quantity;
}

async function submitAction(s,action,chunk,limitCents){
 const input={...s.bound,executionVersion:2,mandateId:s.watch.mandateId,strategyFingerprint:fingerprint(s.config),cycle:s.cycle,symbol:action.symbol,side:action.action,quantity:chunk.quantity,limitCents,
  intentKey:chunk.prior?.intentKey||fingerprint([s.watch.mandateId,s.mandate.fingerprint,s.cycle,action.symbol,action.action,chunk.filled])};
 const ticket=await s.deps.host(s.ctx,'prepare',input);
 const sent=await s.deps.host(s.ctx,'submit',{...input,ticketId:ticket.ticketId,fingerprint:ticket.fingerprint,confirm:true}),count=submissionCount(sent);
 return{status:count===null?'order-result-uncertain':sent.status==='submitted'?(count===1?'order-submitted':'submission-replayed'):sent.status==='rejected'?'order-rejected':'order-result-uncertain',ticket:sent,ordersSubmitted:count};
}

async function executeActions(s){
 if(s.record.completedAt)return{status:s.record.status,blockers:s.plan.blockers};
 for(const action of orderedActions(s.record.plan.actions,wholeAccount(s.mandate))){
  const decision=await actionDecision(s,action);
  if(decision.skip)continue;
  if(decision.status!=='prepare')return decision;
  const chunk=await dailyChunk(s,action,decision.chunk,decision.limitCents);
  if(chunk.status!=='prepare')return chunk;
  if(action.action==='sell'&&!saleAvailable(s,action,chunk.quantity)){
   defer(s,action,[{code:'protected_sale_requires_coordination',symbol:action.symbol,message:'The planned sale overlaps broker-held protection. A coordinated cancellation and remaining-share protection review is required.'}]);continue;
  }
  return submitAction(s,action,chunk,decision.limitCents);
 }
 if(s.deferred.length)return{status:'waiting-for-position-review'};
 const status=s.plan.blockers.length?'cycle-completed-with-exceptions':'cycle-completed';
 s.record=await updateCycle(s.ctx,s.owner,s.key,s.record,{...s.record,status,completedAt:s.at.toISOString(),completionBlockers:s.plan.blockers});
 return{status,blockers:s.plan.blockers};
}

/** @description Reconcile and execute at most one native allocation request. @param ctx Package context. @param owner Owner. @param watch Approved watch. @param receipt Fresh facts. @param deps Native dependencies. @returns Execution evidence. */
async function executeMonthly(ctx,owner,watch,receipt,deps){
 const s=await prepareState(ctx,owner,watch,receipt,deps);
 if(s.result)return s.result;
 const stop=await prepareCycle(s);
 if(stop)return{...s.base,...stop};
 const result=await executeActions(s);
 return{...s.base,cycle:s.cycle,plan:s.record.plan,continuity:s.record.continuity,deferred:s.deferred,...result};
}

module.exports={executeMonthly};
