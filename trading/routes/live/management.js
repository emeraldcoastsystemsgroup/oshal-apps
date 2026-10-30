/** CHANGE LOG
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Treat native capital-coverage refusal as an actionable review conflict instead of a service outage.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Account-bound monthly strategy monitoring and exact native order tickets. Monitoring prepares evidence; only a separate interactive exact-ticket submission reaches the broker.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Check enrolled position backstops independently before strategy reads, retain partial failures, and name the broker operation that failed.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Aggregate automatic-strategy status only from fresh effective native authority, including active account counts.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Bind monthly evidence to its completed-month decision cutoff while keeping daily assessment and current broker facts fresh.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Read native effective authority for every account and retain unknown allocation submission counts.
 */
'use strict';
const {getRecord,listRecords,saveRecord,fingerprint}=require('../trading-portfolio-store');
const {normalizePortfolioStrategy,portfolioNextTargets}=require('../trading-portfolio-sim');
const {portfolioHistory}=require('../trading-portfolio-history');
const {portfolioSignalHistoryEnd}=require('../trading-portfolio-rotation');
const {lastCompletedSession,nyseSessionClock}=require('../trading-portfolio-calendar');
const {planSymbols,readPlanQuotes}=require('../trading-portfolio-plan-evidence');
const {buildRebalancePlan}=require('../trading-portfolio-plan');
const {mandateDraftReason}=require('./mandate-diagnostics');
const {PortfolioError,accountKey}=require('../trading-portfolio-model');
const {executeMonthly,registerAutomationRoutes}=require('./automation');
const {registerBackstopRoutes,checkAccountBackstops}=require('./backstops');
const {protectiveTick}=require('./protective-execution');
const {mandateAuthority}=require('./execution-state');
const {wholeAccount,allocationPlan}=require('./allocation');
const {registerReviewRead}=require('./review-read');
const busy=new Set();
const WATCH_SCHEDULE={app:'intelligent-trades',name:'portfolio-watcher'};
function refuse(code,message,status=409){throw new PortfolioError(status,code,message);}
function fields(body,allowed){if(Object.keys(body).some(k=>![...allowed,'book','mode'].includes(k)))refuse('live_input_invalid','Unexpected live-management fields.',400);}
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
 if(!['monthly-trend','quarterly-rotation'].includes(config.kind)||config.modelVersion!==2||config.fractionalShares||config.grossExposurePct!==100)refuse('live_model_unsupported','This monitor supports the backtested whole-share, cash-funded monthly models only.');
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
  const targets=portfolioNextTargets(config,historical.series,latest);
  signal={...targets,evidenceThrough,strategyFingerprint:fingerprint(config),historyFingerprint:fingerprint(historical),readAt:at.toISOString()};
 }
 const symbols=planSymbols(selected.account,config);
 const [quotes,orders,balance,tickets]=await Promise.all([readPlanQuotes(ctx,connection,symbols),host(ctx,'list',{connection,accountId:selected.account.accountId}),host(ctx,'balance',{connection,accountId:selected.account.accountId}),host(ctx,'tickets',{connection,accountId:selected.account.accountId})]);
 const fresh=await deps.selected(owner,run,deps.clock());
 await require('../trading-account-values').recordAccountValue(ctx,owner,fresh.account,fresh.native.readAt).catch(()=>{});
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
/** All handlers use the parent route's admitted owner; caller-supplied subjects are rejected. */
function registerNativeManagementRoutes(route,ctx,deps){
 registerBackstopRoutes(route,ctx,deps);
 registerReviewRead(route,ctx,{...deps,host,fields});
 registerAutomationRoutes(route,ctx,{...deps,host,boundStudy:(c,o,b,a)=>boundStudy(c,o,b,a,deps),fields});
 route('get','/portfolio/management',async(_req,owner,at)=>{const config=typeof ctx.intent==='function'?await ctx.intent('trading.config',{}):{};
  const watches=await listRecords(ctx,owner,'watch');
  for(const watch of watches){
   watch.authority={status:'not-enabled',active:false};
   if(!watch.mandateId)continue;
   try{
    const mandate=await host(ctx,'mandate.status',{connection:watch.connectionKey,accountId:watch.accountId,mandateId:watch.mandateId});
    watch.mandate=mandate;watch.authority=mandateAuthority(mandate,at);
    if(watch.authority.active&&(!watch.automatedTrading||!watch.enabled))watch.authority={status:'execution-disabled',active:false};
   }catch{watch.authority={status:'unavailable',active:false};}
  }
  const automatedTradingAccounts=watches.filter(w=>w.enabled&&w.automatedTrading&&w.authority?.active).length;
  return {watches,schedule:WATCH_SCHEDULE,
  execution:{available:config.orderTickets===true,mandatesAvailable:config.strategyMandates===true,wholeAccountAvailable:config.wholeAccountMandates===true,mode:automatedTradingAccounts?'reviewed-account-strategy':'interactive-day-limit',automatedTrading:automatedTradingAccounts>0,automatedTradingAccounts,borrowing:false,protection:false,maxTicketUsd:50000}};});
 route('post','/portfolio/watch',async(req,owner,at)=>{
  const b=req.body||{};fields(b,['runId','confirm']);
  if(b.confirm!==true)refuse('watch_confirmation_required','Confirm monitoring this account and its exact saved model.',428);
  const {run,selected,config}=await boundStudy(ctx,owner,b,at,deps);
  const previous=(await listRecords(ctx,owner,'watch')).find(w=>accountKey(w)===accountKey(selected.account));
  if(previous?.automatedTrading)refuse('live_mandate_active','Stop the active strategy before replacing this monitor.');
  const watch=await saveRecord(ctx,owner,'watch',{accountId:run.accountId,connectionKey:run.connectionKey,accountLabel:selected.profile.label,strategyId:run.strategyId,
   strategyFingerprint:fingerprint(config),runId:run.id,enabled:true,enabledAt:at.toISOString(),lastRunAt:null,lastError:null,lastReceipt:null,
   executionMode:'review-required',ordersSubmitted:0,automatedTrading:false},accountKey(selected.account));
  return {watch,schedule:WATCH_SCHEDULE,requiresScheduleActivation:true};
 });
 route('post','/portfolio/watch/stop',async(req,owner,at)=>{
  const b=req.body||{};fields(b,['accountId','connectionKey']);
  const watch=(await listRecords(ctx,owner,'watch')).find(w=>accountKey(w)===accountKey(b));
  if(!watch)refuse('watch_not_found','This account has no saved monitor.',404);
  if(watch.mandateId)await host(ctx,'mandate.stop',{connection:watch.connectionKey,accountId:watch.accountId,mandateId:watch.mandateId});
  return {watch:await saveRecord(ctx,owner,'watch',{...watch,automatedTrading:false,enabled:false,stoppedAt:at.toISOString()},accountKey(watch))};
 });
 route('post','/portfolio/watch/tick',async(req,owner,at)=>{
  const b=req.body||{};fields(b,[]);
  if(busy.has(owner))refuse('watch_running','A monitor check is already running.');
  const watches=(await listRecords(ctx,owner,'watch')).filter(w=>w.enabled);
  if(!watches.length)return {checked:0,receipts:[],ordersSubmitted:0};
  if(watches.length>8)refuse('watch_limit','At most eight connected accounts can be monitored.');
  busy.add(owner);const receipts=[];
  try{for(const watch of watches){
   let protectionOutcome;
   try{const current=await deps.selected(owner,watch,deps.clock());protectionOutcome=await protectiveTick(ctx,owner,{...current,clock:deps.clock,refresh:()=>deps.selected(owner,watch,deps.clock())},deps.clock());}
   catch{protectionOutcome={status:'protection-check-failed',ordersSubmitted:null};}
   if(req.headers?.['x-oshal-trigger']==='schedule'&&at.getUTCMinutes()%5!==0){
    await saveRecord(ctx,owner,'watch',{...watch,lastProtectionCheck:protectionOutcome,lastGuardAt:deps.clock().toISOString()},accountKey(watch));
    receipts.push({accountId:watch.accountId,status:protectionOutcome.status,protectiveExecution:protectionOutcome,ordersSubmitted:protectionOutcome.ordersSubmitted});continue;
   }
   try{const result=await tickOne(ctx,owner,watch,at,{...deps,protectionOutcome,trigger:req.headers?.['x-oshal-trigger']==='schedule'?'schedule':'manual'});receipts.push(result.receipt);}
   catch(e){const message=e instanceof PortfolioError?e.message:'Current broker or signal evidence could not be verified.';
    await saveRecord(ctx,owner,'watch',{...watch,lastRunAt:deps.clock().toISOString(),lastError:message,lastProtectionCheck:protectionOutcome},accountKey(watch));receipts.push({accountId:watch.accountId,status:'failed',message,protectiveExecution:protectionOutcome,ordersSubmitted:watch.automatedTrading?null:protectionOutcome.ordersSubmitted});}
  }return {checked:receipts.length,receipts,ordersSubmitted:receipts.some(r=>r.ordersSubmitted===null)?null:receipts.reduce((n,r)=>n+(r.ordersSubmitted||0),0)};}finally{busy.delete(owner);}
 });
 route('post','/portfolio/live/ticket',async(req,owner,at)=>{
  const b=req.body||{};fields(b,['watchId','symbol','limitCents']);
  const watch=await getRecord(ctx,owner,'watch',b.watchId);
  if(!watch.enabled)refuse('watch_off','Start this account monitor before preparing its orders.');
  const {selected}=await boundStudy(ctx,owner,watch,at,deps),receipt=watch.lastReceipt;
  if(!receipt||watch.lastError||at-Date.parse(receipt.observedAt)>300000)refuse('watch_stale','Run a fresh monitor check before preparing an order.');
  if(receipt.proposal.blockers.length||receipt.workingOrders.length)refuse('live_facts_blocked','Resolve the monitor’s funding, quote or working-order blockers first.');
  if(!nyseSessionClock(at).regular)refuse('regular_session_required','Prepare strategy orders during the regular NYSE session.');
  const row=receipt.proposal.actions.find(a=>a.symbol===b.symbol);
  if(!row||!['buy','sell'].includes(row.action)||!Number.isSafeInteger(Math.abs(row.changeQty))||row.changeQty===0)refuse('strategy_action_missing','This instrument has no whole-share action in the monitored proposal.');
  const connection=selected.account.connectionKey,accountId=selected.account.accountId;
  const ticket=await host(ctx,'prepare',{connection,accountId,symbol:row.symbol,side:row.action,quantity:Math.abs(row.changeQty),limitCents:b.limitCents,
   intentKey:fingerprint([watch.strategyId,receipt.signal.decisionAsOf,receipt.observedAt,row.symbol,row.action])});
  await saveRecord(ctx,owner,'live-ticket',{ticketId:ticket.ticketId,watchId:watch.id,strategyId:watch.strategyId,accountId,connectionKey:connection,fingerprint:ticket.fingerprint,
   signalDecisionAsOf:receipt.signal.decisionAsOf,receiptObservedAt:receipt.observedAt},ticket.ticketId);
  return {ticket,watchId:watch.id,requiresInteractiveSubmission:true};
 });
 route('post','/portfolio/live/submit',async(req,owner,at)=>{
  const b=req.body||{};fields(b,['watchId','ticketId','fingerprint','confirm']);
  if(b.confirm!==true)refuse('exact_live_confirmation_required','Confirm the exact displayed real-money order.',428);
  const watch=await getRecord(ctx,owner,'watch',b.watchId);
  if(!watch.enabled)refuse('watch_off','This account monitor is stopped.');
  const {selected}=await boundStudy(ctx,owner,watch,at,deps);
  const retained=await getRecord(ctx,owner,'live-ticket','live-ticket:'+fingerprint([owner,b.ticketId]));
  if(retained.watchId!==watch.id||retained.strategyId!==watch.strategyId||retained.accountId!==selected.account.accountId||retained.connectionKey!==selected.account.connectionKey||retained.fingerprint!==b.fingerprint)refuse('live_ticket_mismatch','The exact ticket does not match this monitored account and strategy.');
  if(watch.lastError||watch.lastReceipt?.signal?.decisionAsOf!==retained.signalDecisionAsOf)refuse('live_signal_changed','The monitor is blocked or its completed monthly signal changed; review a fresh ticket.');
  if(!nyseSessionClock(at).regular)refuse('regular_session_required','Submit strategy orders during the regular NYSE session.');
  return {ticket:await host(ctx,'submit',{connection:selected.account.connectionKey,accountId:selected.account.accountId,ticketId:b.ticketId,fingerprint:b.fingerprint,confirm:true})};
 });
 route('post','/portfolio/live/cancel',async(req,owner,at)=>{
  const b=req.body||{};fields(b,['watchId','ticketId','orderId','fingerprint','confirm']);
  if(b.confirm!==true)refuse('exact_cancel_confirmation_required','Confirm the exact account-bound broker order cancellation.',428);
  const watch=await getRecord(ctx,owner,'watch',b.watchId),selected=await deps.selected(owner,watch,at);
  const retained=await getRecord(ctx,owner,'live-ticket','live-ticket:'+fingerprint([owner,b.ticketId]));
  if(retained.watchId!==watch.id||retained.accountId!==selected.account.accountId||retained.connectionKey!==selected.account.connectionKey||retained.fingerprint!==b.fingerprint)refuse('live_ticket_mismatch','The order does not belong to this monitored account.');
  return {ticket:await host(ctx,'cancel',{connection:selected.account.connectionKey,accountId:selected.account.accountId,ticketId:b.ticketId,orderId:b.orderId,fingerprint:b.fingerprint,confirm:true})};
 });
 route('post','/portfolio/live/reconcile',async(req,owner,at)=>{
  const b=req.body||{};fields(b,['watchId','ticketId','orderId','confirm']);
  if(b.confirm!==true)refuse('reconciliation_confirmation_required','Confirm matching this uncertain attempt to the exact broker order.',428);
  const watch=await getRecord(ctx,owner,'watch',b.watchId),{selected}=await boundStudy(ctx,owner,watch,at,deps);
  const retained=await getRecord(ctx,owner,'live-ticket','live-ticket:'+fingerprint([owner,b.ticketId]));
  if(retained.watchId!==watch.id||retained.accountId!==selected.account.accountId)refuse('live_ticket_mismatch','The attempt belongs to a different monitored account.');
  return {ticket:await host(ctx,'reconcile',{connection:selected.account.connectionKey,accountId:selected.account.accountId,ticketId:b.ticketId,orderId:b.orderId,confirm:true})};
 });
 route('get','/portfolio/live/orders',async(req,owner,at)=>{
  const watch=await getRecord(ctx,owner,'watch',req.query.watchId);
  const {selected}=await boundStudy(ctx,owner,watch,at,deps);
  return host(ctx,'list',{connection:selected.account.connectionKey,accountId:selected.account.accountId});
 });
}
module.exports={registerNativeManagementRoutes,boundStudy,tickOne,WATCH_SCHEDULE};
