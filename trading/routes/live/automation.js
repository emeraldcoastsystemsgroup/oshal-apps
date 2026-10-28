/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Account-bound scheduled execution of an exact completed monthly model through kernel-kept mandates, durable cycles and reconciled broker fills.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Require effective native authority and distinguish new broker submissions, durable replays and unknown acknowledgments.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Explicit whole-account reviews, measured net-equity sizing, sell-first funding separation and fill-reconciled bounded allocation chunks.
 */
'use strict';
const {getRecord,listRecords,saveRecord,fingerprint}=require('../trading-portfolio-store');
const {canonicalPlanSymbol}=require('../trading-portfolio-plan');
const {portfolioStrategySymbols}=require('../trading-portfolio-rotation');
const {accountKey,PortfolioError}=require('../trading-portfolio-model');
const {nyseSessionClock}=require('../trading-portfolio-calendar');
const {allocationBlockingOrders}=require('./protective-execution');
const {mandateAuthority,submissionCount}=require('./execution-state');
const {wholeAccount,actionBlockers,positionScopedBlocker,orderedActions,allocationPlan,cycleTickets,fillBaselines,holdingsDrift,protectiveExits,actionProgress,nextChunk}=require('./allocation');
const {strategyReview}=require('./allocation-review');
const TERMINAL=new Set(['FILLED','CANCELED','CANCELLED','EXPIRED','REJECTED','REPLACED']);
const fail=(code,message,status=409)=>{throw new PortfolioError(status,code,message);};
async function cycleRecord(ctx,owner,id){return(await listRecords(ctx,owner,'live-cycle')).find(r=>r.key===id);}
function binding(selected){return{connection:selected.account.connectionKey,accountId:selected.account.accountId};}
/** At most one broker request per pass; uncertain attempts are never repeated. */
async function executeMonthly(ctx,owner,watch,receipt,{host,boundStudy,clock}){
 const at=clock(),{selected,config}=await boundStudy(ctx,owner,watch,at),bound=binding(selected);
 const mandate=await host(ctx,'mandate.status',{...bound,mandateId:watch.mandateId});
 const status={mandate,ordersSubmitted:0,status:'waiting',protection:'Monthly model exits; no intraday stops'};
 const authority=mandateAuthority(mandate,at);
 if(!authority.active)return{...status,status:'mandate-inactive',authority};
 if(mandate.terms.strategyFingerprint!==fingerprint(config))fail('live_strategy_changed','The approved strategy changed; stop and review a new mandate.');
 if(!nyseSessionClock(at).regular)return{...status,status:'market-closed'};
 const updated=await host(ctx,'refresh',bound),tickets=updated.tickets||[];
 if(tickets.some(t=>['attempting','unknown'].includes(t.status)))return{...status,status:'uncertain-order-review-required'};
 if(allocationBlockingOrders(receipt.workingOrders,tickets,selected.account).length)return{...status,status:'waiting-for-broker-order'};
 const cycle=receipt.signal.decisionAsOf,key=[watch.mandateId,mandate.fingerprint,cycle].join(':'),own=cycleTickets(tickets,watch.mandateId,cycle,mandate.fingerprint);
 const scope=wholeAccount(mandate)?'whole-account':'preserve-other-holdings';
 const quotes=receipt.proposal.rows.map(r=>({symbol:r.symbol,tradePrice:r.referencePrice,tradeAt:r.tradeAt,source:'schwab',delayed:false}));
 const sourceBlockers=receipt.proposal.blockers?.filter(b=>b.code==='quote_source_unverified')||[];
 if(sourceBlockers.length)return{...status,status:'blocked',blockers:sourceBlockers};
 const currentPlan=allocationPlan(selected,config,receipt.signal,quotes,mandate.terms.capitalCents,scope,at,receipt.brokerFunding.cashBudgetUsd);
 let record=await cycleRecord(ctx,owner,key);
 if(!record){
  if(own.length)return{...status,status:'cycle-record-missing-review-required'};
  if(currentPlan.blockers.length&&!currentPlan.actions.some(a=>!actionBlockers(currentPlan,a.action,a.symbol).length))return{...status,status:'blocked',blockers:currentPlan.blockers};
  record=await saveRecord(ctx,owner,'live-cycle',{key,mandateId:watch.mandateId,cycle,plan:currentPlan,fillBaselines:fillBaselines(tickets,watch.mandateId,cycle,mandate.fingerprint),status:'in-progress',createdAt:at.toISOString()},key);
 }
 if(protectiveExits(record,tickets,watch.mandateId).length)return{...status,status:'protective-exit-awaiting-next-cycle',message:'A protective exit occurred after this allocation began. No same-cycle reentry or remaining allocation order is submitted.'};
 const drift=holdingsDrift(record,tickets,selected.account,watch.mandateId,cycle,mandate.fingerprint);
 if(drift.length)return{...status,status:'holdings-changed-review-required',symbols:drift};
 const actions=orderedActions(record.plan.actions,wholeAccount(mandate)),deferred=[];
 for(const action of actions){
  const progress=actionProgress(action,own);
  if(progress.status==='filled')continue;
  if(progress.status!=='prepare')return{...status,...progress};
  const blockers=actionBlockers(currentPlan,action.action,action.symbol);
  if(blockers.length){
   if(blockers.every(b=>positionScopedBlocker(b,action.symbol))){deferred.push({symbol:action.symbol,action:action.action,blockers});continue;}
   return{...status,status:action.action==='buy'?'waiting-for-verified-buy-funding':'blocked',blockers,deferred};
  }
  const fresh=receipt.proposal.rows.find(r=>r.symbol===action.symbol);
  if(!fresh||!Number.isFinite(fresh.referencePrice)||fresh.referencePrice<=0)fail('live_quote_missing','A current price is unavailable.');
  const pending=progress.prior;
  // A marketable limit is capped one tenth percent from the observed price. Venue execution is never assumed.
  const limitCents=pending?.expiresAtMs>at.getTime()?pending.terms.limitCents:Math.max(1,Math.round(fresh.referencePrice*100*(action.action==='buy'?1.001:0.999)));
  const chunk=nextChunk(progress,limitCents);
  if(chunk.status!=='prepare')return{...status,...chunk};
  const {quantity,prior}=chunk;
  if(action.action==='sell'){
   const held=selected.account.positions.find(p=>canonicalPlanSymbol(p.symbol)===action.symbol)?.qty||0;
   const reserved=receipt.workingOrders.filter(o=>!TERMINAL.has(o.status)&&o.legs?.length===1&&o.legs[0].instruction==='SELL'&&canonicalPlanSymbol(o.legs[0].symbol)===action.symbol).reduce((n,o)=>n+(Number.isFinite(o.remainingQuantity)?o.remainingQuantity:Infinity),0);
   if(held-reserved<quantity){deferred.push({symbol:action.symbol,action:action.action,blockers:[{code:'protected_sale_requires_coordination',symbol:action.symbol,message:'The planned sale overlaps broker-held protection. A coordinated cancellation and remaining-share protection review is required.'}]});continue;}
  }
  if(action.action==='buy'&&(receipt.brokerFunding.cashBudgetUsd===null||receipt.brokerFunding.cashBudgetUsd<quantity*limitCents/100+1))return{...status,status:'waiting-for-settled-cash',deferred};
  if(action.action==='buy'&&selected.account.positions.reduce((sum,p)=>sum+p.marketValue,0)+quantity*limitCents/100>mandate.terms.capitalCents/100)return{...status,status:'waiting-for-capital-capacity',deferred};
  const input={...bound,mandateId:watch.mandateId,strategyFingerprint:fingerprint(config),cycle,symbol:action.symbol,side:action.action,quantity,limitCents,
   intentKey:prior?.intentKey||fingerprint([watch.mandateId,mandate.fingerprint,cycle,action.symbol,action.action,chunk.filled])};
  const ticket=await host(ctx,'prepare',input);
  const sent=await host(ctx,'submit',{...input,ticketId:ticket.ticketId,fingerprint:ticket.fingerprint,confirm:true});
  const count=submissionCount(sent);
  return{...status,status:count===null?'order-result-uncertain':sent.status==='submitted'?(count===1?'order-submitted':'submission-replayed'):sent.status==='rejected'?'order-rejected':'order-result-uncertain',ticket:sent,ordersSubmitted:count,cycle,plan:record.plan,deferred};
 }
 if(deferred.length)return{...status,status:'waiting-for-position-review',cycle,plan:record.plan,deferred};
 const completion=currentPlan.blockers.length?'cycle-completed-with-exceptions':'cycle-completed';
 await saveRecord(ctx,owner,'live-cycle',{...record,status:completion,completedAt:at.toISOString(),completionBlockers:currentPlan.blockers},key);
 return{...status,status:completion,cycle,plan:record.plan,blockers:currentPlan.blockers};
}
function registerAutomationRoutes(route,ctx,deps){
 const {host,boundStudy,fields,clock}=deps;
 route('post','/portfolio/live/mandate',async(req,owner,at)=>{
  const b=req.body||{};fields(b,['watchId','capitalCents','scope']);
  if(b.scope!==undefined&&!['whole-account','strategy-owned'].includes(b.scope))fail('live_scope_invalid','Choose whole-account or strategy-owned allocation.',400);
  const whole=b.scope==='whole-account',scope=whole?'whole-account':'strategy-owned';
  if(!Number.isSafeInteger(b.capitalCents)||b.capitalCents<10000||b.capitalCents>(whole?100000000:5000000))fail('live_cap_invalid','Choose a capital cap within this allocation scope.',400);
  const watch=await getRecord(ctx,owner,'watch',b.watchId);
  if(!watch.enabled)fail('watch_off','Start this account monitor first.');
  if(watch.automatedTrading)fail('live_mandate_active','Stop existing automatic execution before reviewing new terms.');
  const study=await boundStudy(ctx,owner,watch,at),{selected,config,run}=study;
  if(whole&&(await ctx.intent('trading.config',{})).wholeAccountMandates!==true)fail('whole_account_release_required','The verified native whole-account release is not active.',503);
  const mandate=await host(ctx,'mandate.prepare',{...binding(selected),capitalCents:b.capitalCents,...(whole?{scope}:{}),renewMandateId:watch.mandateId||null,strategyId:watch.strategyId,strategyFingerprint:fingerprint(config),backtestFingerprint:run.evidenceFingerprint,symbols:portfolioStrategySymbols(config)});
  if(whole&&(!wholeAccount(mandate)||!Array.isArray(mandate.adoptionReview?.positions)||!/^[a-f0-9]{64}$/i.test(mandate.adoptionReview?.holdingsFingerprint||'')))fail('whole_account_review_unverified','The native service did not retain the exact existing-holdings review.');
  const review=await strategyReview(ctx,owner,watch,study,b.capitalCents,scope,deps);
  await saveRecord(ctx,owner,'live-mandate',{mandateId:mandate.mandateId,watchId:watch.id,mandate,review,fingerprint:mandate.fingerprint,accountId:selected.account.accountId,connectionKey:selected.account.connectionKey},mandate.mandateId);
  return{mandate,review,requiresHumanActivation:true};
 });
 route('post','/portfolio/live/activate',async(req,owner,at)=>{
  const b=req.body||{};fields(b,['watchId','mandateId','fingerprint','confirm','confirmAdoption']);
  if(b.confirm!==true)fail('live_mandate_confirmation_required','Confirm the exact real-money strategy mandate.',428);
  const watch=await getRecord(ctx,owner,'watch',b.watchId),{selected}=await boundStudy(ctx,owner,watch,at);
  if(!watch.enabled)fail('watch_off','This monitor is stopped.');
  const retained=await getRecord(ctx,owner,'live-mandate','live-mandate:'+fingerprint([owner,b.mandateId]));
  if(retained.watchId!==watch.id||retained.fingerprint!==b.fingerprint||retained.accountId!==selected.account.accountId||retained.connectionKey!==selected.account.connectionKey)fail('mandate_mismatch','The mandate does not match this account and watcher.');
  if(retained.review?.activationReady!==true)fail('live_transition_unverified','Resolve the initial transition blockers and prepare a fresh review before approval.');
  if(wholeAccount(retained.mandate)&&b.confirmAdoption!==true)fail('adoption_confirmation_required','Explicitly confirm management and sales of existing and future long equity holdings.',428);
  const bound={...binding(selected),mandateId:b.mandateId};
  const before=await host(ctx,'mandate.status',bound);
  if(typeof before.effectiveStatus!=='string')fail('live_release_required','The native release must verify effective mandate authority before activation.',503);
  await host(ctx,'mandate.activate',{...bound,fingerprint:b.fingerprint,confirm:true});
  const mandate=await host(ctx,'mandate.status',bound);
  if(!mandateAuthority(mandate,clock()).active)fail('live_authority_not_active','The native strategy authority is not active. Refresh its status before proceeding.');
  const saved=await saveRecord(ctx,owner,'watch',{...watch,mandateId:mandate.mandateId,executionMode:'automatic-monthly',automatedTrading:true,mandate},accountKey(watch));
  return{watch:saved,mandate,requiresScheduleActivation:true};
 });
 route('post','/portfolio/live/stop',async(req,owner,at)=>{
  const b=req.body||{};fields(b,['watchId']);const watch=await getRecord(ctx,owner,'watch',b.watchId);
  const mandate=watch.mandateId?await host(ctx,'mandate.stop',{connection:watch.connectionKey,accountId:watch.accountId,mandateId:watch.mandateId}):null;
  return{watch:await saveRecord(ctx,owner,'watch',{...watch,automatedTrading:false,executionMode:'review-required',mandate},accountKey(watch)),note:'Future strategy submissions stopped. Already submitted broker orders remain visible and require separate cancellation.'};
 });
}
module.exports={executeMonthly,registerAutomationRoutes};
