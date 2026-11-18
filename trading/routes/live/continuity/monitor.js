/** CHANGE LOG
 * SEQ: 2
 * AUTHOR: maintainer@emeraldcoastsystemsgroup.com
 * Verify native continuity admission before protection, backstops or broker evidence reads.
 * SEQ: 1
 * AUTHOR: maintainer@emeraldcoastsystemsgroup.com
 * Mount an independently declared continuity monitor for explicitly adopted
 * version-two watches without changing the approved legacy executor or schedule.
 */
'use strict';
const {getRecord,listRecords,saveRecord,fingerprint}=require('../../trading-portfolio-store');
const {normalizePortfolioStrategy,portfolioNextTargets}=require('../../trading-portfolio-sim');
const {portfolioHistory}=require('../../trading-portfolio-history');
const {portfolioSignalHistoryEnd}=require('../../trading-portfolio-rotation');
const {lastCompletedSession}=require('../../trading-portfolio-calendar');
const {planSymbols,readPlanQuotes}=require('../../trading-portfolio-plan-evidence');
const {buildRebalancePlan}=require('../../trading-portfolio-plan');
const {PortfolioError,accountKey}=require('../../trading-portfolio-model');
const {mandateDraftReason}=require('../mandate-diagnostics');
const {checkAccountBackstops}=require('../backstops');
const {protectiveTick}=require('../protective-execution');
const {wholeAccount,allocationPlan}=require('../allocation');
const {mandateAuthority}=require('../execution-state');
const {executeMonthly}=require('./execution');
const busy=new Set();
function refuse(code,message,status=409){throw new PortfolioError(status,code,message);}
async function host(ctx,name,input){if(typeof ctx.intent!=='function')refuse('live_host_unavailable','Native broker operations are unavailable.',503);try{return await ctx.intent('trading.orders.'+name,input);}catch(e){const raw=String(e?.message||'');const known=['verified current cash','working or unrecognized broker orders','fresh explicitly real-time broker quote','uncertain result','ticket expired','interactive exact-ticket','native intent','unknown Trading','unknown native','order history may be incomplete','broker order is missing its identity','broker order status is missing','broker order legs are malformed','execution details exceed the order read bound'];const safe=known.some(part=>raw.toLowerCase().includes(part.toLowerCase())),draftReason=mandateDraftReason(name,raw);if(draftReason==='verified current cash and strategy-owned holdings, or reviewed whole-account net equity, must cover approved capital')refuse('live_cap_not_covered','The capital cap is no longer covered by verified account funding. Refresh this account and lower Capital cap before preparing a new review. Whole-account management uses net account equity, not margin buying power. No live trading was activated.');refuse('native_broker_refused','Broker '+name+': '+(draftReason||(safe?raw.slice(0,700):'The native broker refused this operation. No success is assumed; check broker orders and the retained attempt before retrying.')),503);}}
async function boundStudy(ctx,owner,body,at,deps){
 const run=await getRecord(ctx,owner,'run',body.runId);
 if(run.status!=='completed'||!run.evidenceFingerprint)refuse('completed_backtest_required','Select a completed backtest for this exact account.');
 const selected=await deps.selected(owner,run,at);
 if(selected.account.kind!=='live'||selected.account.broker!=='schwab')refuse('live_account_required','Select your connected real Schwab account.');
 if(selected.constraints?.group==='unclassified')refuse('account_classification_required','Confirm this account’s registration before monitoring it for orders.');
 if(!selected.profile?.strategyId||selected.profile.strategyId!==run.strategyId)refuse('strategy_assignment_changed','The account review strategy must match this completed study.');
 const strategy=await getRecord(ctx,owner,'strategy',run.strategyId),config=normalizePortfolioStrategy(strategy.config);
 if(fingerprint(config)!==fingerprint(normalizePortfolioStrategy(run.strategy.config)))refuse('strategy_study_mismatch','The saved strategy differs from its backtest.');
 if(config.modelVersion===3)require('../../strategy/authority').assertValidated(run,config,selected.account,selected.profile?.registration);
 else if(!['monthly-trend','quarterly-rotation'].includes(config.kind)||config.modelVersion!==2||config.fractionalShares||config.grossExposurePct!==100)refuse('live_model_unsupported','This monitor supports the backtested whole-share, cash-funded monthly models only.');
 return {run,selected,config,strategy};
}
async function tickOne(ctx,owner,watch,at,deps){
 const {selected,config,run}=await boundStudy(ctx,owner,watch,at,deps);
 const backstops=await checkAccountBackstops(ctx,owner,selected,at).catch(()=>({configured:true,status:'failed',message:'Position backstop evidence could not be verified.',brokerOrdersPlaced:0}));
 const latest=lastCompletedSession(at),evidenceThrough=portfolioSignalHistoryEnd(config,latest),key=accountKey(selected.account),connection=selected.account.connectionKey;
 let signal=watch.signal;
 if(!signal||signal.signalAsOf!==latest||signal.evidenceThrough!==evidenceThrough||signal.strategyFingerprint!==fingerprint(config)){
  const start=new Date(Date.parse(latest+'T00:00:00Z')-110*86400000).toISOString().slice(0,10);
  const historical=await portfolioHistory(ctx,connection,config,start,evidenceThrough,at);
  const targets=config.modelVersion===3?require('../../strategy/signals').signal(config,historical.series,latest,{holdings:selected.account.positions,riskState:watch.signal?.riskState||{}}):portfolioNextTargets(config,historical.series,latest);
  signal={...targets,evidenceThrough,strategyFingerprint:fingerprint(config),historyFingerprint:fingerprint(historical),readAt:at.toISOString()};
 }
 const symbols=planSymbols(selected.account,config);
 const [quotes,orders,balance,tickets]=await Promise.all([readPlanQuotes(ctx,connection,symbols),host(ctx,'list',{connection,accountId:selected.account.accountId}),host(ctx,'balance',{connection,accountId:selected.account.accountId}),host(ctx,'tickets',{connection,accountId:selected.account.accountId})]);
 const fresh=await deps.selected(owner,run,deps.clock());
 await require('../../trading-account-values').recordAccountValue(ctx,owner,fresh.account,fresh.native.readAt).catch(()=>{});
 if(fresh.profile?.strategyId!==watch.strategyId)refuse('strategy_assignment_changed','The assigned strategy changed while monitoring.');
 const plan=watch.automatedTrading&&watch.mandate?allocationPlan(fresh,config,signal,quotes.quotes,watch.mandate.terms.capitalCents,wholeAccount(watch.mandate)?'whole-account':'preserve-other-holdings',deps.clock(),balance.cashBudgetUsd):buildRebalancePlan({account:fresh.account,profile:fresh.profile,config,targets:signal.targets,signalAsOf:latest,quotes:quotes.quotes,scope:'preserve-other-holdings',now:deps.clock()});
 const working=(orders.orders||[]).filter(o=>!['FILLED','CANCELED','CANCELLED','REJECTED','EXPIRED','REPLACED'].includes(o.status));
 const receipt={accountId:fresh.account.accountId,connectionKey:connection,accountLabel:fresh.profile.label,strategyId:watch.strategyId,runId:run.id,
  observedAt:deps.clock().toISOString(),trigger:deps.trigger||'manual',status:working.length?'working-orders':plan.blockers.length?'blocked':plan.actions.length?'review-required':'aligned',
  signal,accountEquity:fresh.account.equity,reportedCash:fresh.account.cash,positions:fresh.account.positions,brokerOrders:orders.orders,workingOrders:working,brokerFunding:balance,nativeTickets:tickets.tickets,
  proposal:{...plan,signalDecisionAsOf:signal.decisionAsOf,rebalanceCadence:signal.rebalanceCadence},backstops,protectiveExecution:deps.protectionOutcome||{status:'not-enabled',ordersSubmitted:0},ordersSubmitted:deps.protectionOutcome?.ordersSubmitted??0,automatedProtection:deps.protectionOutcome?.authorityActive===true};
 if(deps.protectionOutcome?.ordersSubmitted===null)receipt.ordersSubmitted=null;
 if(watch.automatedTrading&&watch.mandateId){receipt.automation=await executeMonthly(ctx,owner,watch,receipt,{...deps,host,boundStudy:(c,o,b,a)=>boundStudy(c,o,b,a,deps)});receipt.ordersSubmitted=receipt.ordersSubmitted===null||receipt.automation.ordersSubmitted===null?null:receipt.ordersSubmitted+receipt.automation.ordersSubmitted;receipt.status=receipt.automation.status;}
 const updated=await saveRecord(ctx,owner,'watch',{...watch,signal,lastRunAt:receipt.observedAt,lastError:null,lastReceipt:receipt},key);
 return {watch:updated,receipt};
}

async function candidateAdmission(ctx,watch,at){
 try{
  if(typeof watch.mandateId!=='string'||!watch.mandateId)refuse('continuity_authority_required','This account requires an explicitly approved native continuity generation before the new executor can submit.');
  const mandate=await host(ctx,'mandate.status',{connection:watch.connectionKey,accountId:watch.accountId,mandateId:watch.mandateId});
  const authority=mandateAuthority(mandate,at);
  if(!authority.active)return{status:'mandate-inactive',authority,automation:{mandate,authority,status:'mandate-inactive',ordersSubmitted:0},ordersSubmitted:0};
  if(mandate.terms?.executionVersion!==2||typeof watch.executionGeneration!=='string'||!watch.executionGeneration||mandate.terms?.executionGeneration!==watch.executionGeneration)
   refuse('continuity_authority_required','This account requires an explicitly approved native continuity generation before the new executor can submit.');
  return null;
 }catch(error){
  const message=error instanceof PortfolioError?error.message:'Native continuity authority could not be verified.';
  return{status:'failed',message,ordersSubmitted:0};
 }
}

async function checkWatch(ctx,owner,watch,at,req,deps){
 if(watch.executionVersion!==2)return{accountId:watch.accountId,status:'failed',message:'This account execution version is not supported.',ordersSubmitted:0};
 const admission=await candidateAdmission(ctx,watch,at);
 if(admission)return{accountId:watch.accountId,...admission};
 let protectionOutcome;
 try{const current=await deps.selected(owner,watch,deps.clock());protectionOutcome=await protectiveTick(ctx,owner,{...current,clock:deps.clock,refresh:()=>deps.selected(owner,watch,deps.clock())},deps.clock());}
 catch{protectionOutcome={status:'protection-check-failed',ordersSubmitted:null};}
 if(req.headers?.['x-oshal-trigger']==='schedule'&&at.getUTCMinutes()%5!==0){
  await saveRecord(ctx,owner,'watch',{...watch,lastProtectionCheck:protectionOutcome,lastGuardAt:deps.clock().toISOString()},accountKey(watch));
  return{accountId:watch.accountId,status:protectionOutcome.status,protectiveExecution:protectionOutcome,ordersSubmitted:protectionOutcome.ordersSubmitted};
 }
 try{return(await tickOne(ctx,owner,watch,at,{...deps,protectionOutcome,trigger:req.headers?.['x-oshal-trigger']==='schedule'?'schedule':'manual'})).receipt;}
 catch(error){
  const message=error instanceof PortfolioError?error.message:'Current broker or signal evidence could not be verified.';
  await saveRecord(ctx,owner,'watch',{...watch,lastRunAt:deps.clock().toISOString(),lastError:message,lastProtectionCheck:protectionOutcome},accountKey(watch));
  return{accountId:watch.accountId,status:'failed',message,protectiveExecution:protectionOutcome,ordersSubmitted:watch.automatedTrading?null:protectionOutcome.ordersSubmitted};
 }
}

/** @description Register the dormant v2 monitor only; this route grants no authority or adoption.
 * @param {Function} route Owner-admitted route registrar. @param {object} ctx Package context.
 * @param {object} deps Clock and fresh account reader. @returns {void} No approval or schedule is created.
 */
function registerContinuityRoutes(route,ctx,deps){
 route('post','/portfolio/continuity/watch/tick',async(req,owner,at)=>{
  if(Object.keys(req.body||{}).some(key=>!['book','mode'].includes(key)))refuse('live_input_invalid','Unexpected live-management fields.',400);
  if(busy.has(owner))refuse('watch_running','A monitor check is already running.');
  const watches=(await listRecords(ctx,owner,'watch')).filter(w=>w.enabled&&w.executionVersion!==undefined&&w.executionVersion!==null&&w.executionVersion!==1);
  if(!watches.length)return{checked:0,receipts:[],ordersSubmitted:0};
  if(watches.length>8)refuse('watch_limit','At most eight connected accounts can be monitored.');
  busy.add(owner);const receipts=[];
  try{
   for(const watch of watches)receipts.push(await checkWatch(ctx,owner,watch,at,req,deps));
   return{checked:receipts.length,receipts,ordersSubmitted:receipts.some(r=>r.ordersSubmitted===null)?null:receipts.reduce((sum,r)=>sum+(r.ordersSubmitted||0),0)};
  }finally{busy.delete(owner);}
 });
}
module.exports={registerContinuityRoutes};
