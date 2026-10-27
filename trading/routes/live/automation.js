/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Account-bound scheduled execution of an exact completed monthly model through kernel-kept mandates, durable cycles and reconciled broker fills.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Require effective native authority and distinguish new broker submissions, durable replays and unknown acknowledgments.
 */
'use strict';
const {getRecord,listRecords,saveRecord,fingerprint}=require('../trading-portfolio-store');
const {buildRebalancePlan,canonicalPlanSymbol}=require('../trading-portfolio-plan');
const {portfolioStrategySymbols}=require('../trading-portfolio-rotation');
const {accountKey,PortfolioError}=require('../trading-portfolio-model');
const {nyseSessionClock}=require('../trading-portfolio-calendar');
const {allocationBlockingOrders}=require('./protective-execution');
const {mandateAuthority,submissionCount}=require('./execution-state');
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
 const cycle=receipt.signal.decisionAsOf,key=[watch.mandateId,cycle].join(':'),own=tickets.filter(t=>t.mandateId===watch.mandateId&&t.cycle===cycle);
 let record=await cycleRecord(ctx,owner,key);
 if(!record){
  const capital=Math.min(Number(mandate.terms.capitalCents)/100,selected.account.equity),held=selected.account.positions.reduce((sum,p)=>sum+p.marketValue,0);
  // A capital cap changes target weights; it never turns gains into a fabricated cash debit.
  const cash=Math.min(Math.max(0,selected.account.cash),Math.max(0,capital-held)),funding=Number.isFinite(receipt.brokerFunding.cashBudgetUsd)?Math.min(cash,receipt.brokerFunding.cashBudgetUsd):null;
  const account={...selected.account,equity:held+cash,cash,nativeReadOnly:false,notTrading:false,balanceFacts:{...selected.account.balanceFacts,cashAvailableForWithdrawal:funding,cashAvailableForTrading:funding}};
  const quotes=receipt.proposal.rows.map(r=>({symbol:r.symbol,tradePrice:r.referencePrice,tradeAt:r.tradeAt,source:'schwab',delayed:false}));
  const marks=new Map(quotes.map(q=>[canonicalPlanSymbol(q.symbol),q.tradePrice])),marked=selected.account.positions.reduce((sum,p)=>sum+p.qty*(marks.get(canonicalPlanSymbol(p.symbol))??p.marketValue/p.qty),cash);
  const scale=marked>0?Math.min(1,capital/marked):1,targets=receipt.signal.targets.map(t=>({...t,weightPct:t.weightPct*scale}));
  const plan=buildRebalancePlan({account,profile:selected.profile,config,targets,signalAsOf:receipt.signal.evidenceThrough,quotes,scope:'preserve-other-holdings',now:at});
  if(plan.blockers.length)return{...status,status:'blocked',blockers:plan.blockers};
  record=await saveRecord(ctx,owner,'live-cycle',{key,mandateId:watch.mandateId,cycle,plan,status:'in-progress',createdAt:at.toISOString()},key);
 }
 const actions=record.plan.actions.slice().sort((a,b)=>(a.action==='sell'?0:1)-(b.action==='sell'?0:1)||a.symbol.localeCompare(b.symbol));
 for(const action of actions){
  const prior=own.find(t=>t.terms.symbol===action.symbol&&t.terms.side===action.action);
  if(prior&&prior.status!=='prepared'){
   if(prior.brokerStatus?.status==='FILLED'&&prior.brokerStatus.filledQuantity===prior.terms.quantity)continue;
   return{...status,status:TERMINAL.has(prior.brokerStatus?.status)||prior.status==='rejected'?'unfilled-order-review-required':'waiting-for-broker-order',ticket:prior};
  }
  const fresh=receipt.proposal.rows.find(r=>r.symbol===action.symbol);
  if(!fresh||!Number.isFinite(fresh.referencePrice)||fresh.referencePrice<=0)fail('live_quote_missing','A current price is unavailable.');
  // A marketable limit is capped one tenth percent from the observed price. Venue execution is never assumed.
  const limitCents=prior?.expiresAtMs>at.getTime()?prior.terms.limitCents:Math.max(1,Math.round(fresh.referencePrice*100*(action.action==='buy'?1.001:0.999)));
  const quantity=Math.abs(action.changeQty);
  if(action.action==='sell'){
   const held=selected.account.positions.find(p=>canonicalPlanSymbol(p.symbol)===action.symbol)?.qty||0;
   const reserved=receipt.workingOrders.filter(o=>!TERMINAL.has(o.status)&&o.legs?.length===1&&o.legs[0].instruction==='SELL'&&canonicalPlanSymbol(o.legs[0].symbol)===action.symbol).reduce((n,o)=>n+(Number.isFinite(o.remainingQuantity)?o.remainingQuantity:Infinity),0);
   if(held-reserved<quantity)return{...status,status:'protection-release-required',symbol:action.symbol,message:'The planned sale overlaps broker-held protection. A coordinated cancellation and remaining-share protection review is required.'};
  }
  if(action.action==='buy'&&(receipt.brokerFunding.cashBudgetUsd===null||receipt.brokerFunding.cashBudgetUsd<quantity*limitCents/100+1))return{...status,status:'waiting-for-settled-cash'};
  const input={...bound,mandateId:watch.mandateId,strategyFingerprint:fingerprint(config),cycle,symbol:action.symbol,side:action.action,quantity,limitCents,
   intentKey:fingerprint([watch.mandateId,cycle,action.symbol,action.action])};
  const ticket=await host(ctx,'prepare',input);
  const sent=await host(ctx,'submit',{...input,ticketId:ticket.ticketId,fingerprint:ticket.fingerprint,confirm:true});
  const count=submissionCount(sent);
  return{...status,status:count===null?'order-result-uncertain':sent.status==='submitted'?(count===1?'order-submitted':'submission-replayed'):sent.status==='rejected'?'order-rejected':'order-result-uncertain',ticket:sent,ordersSubmitted:count,cycle,plan:record.plan};
 }
 await saveRecord(ctx,owner,'live-cycle',{...record,status:'completed',completedAt:at.toISOString()},key);
 return{...status,status:'cycle-completed',cycle,plan:record.plan};
}
function registerAutomationRoutes(route,ctx,deps){
 const {host,boundStudy,fields,clock}=deps;
 route('post','/portfolio/live/mandate',async(req,owner,at)=>{
  const b=req.body||{};fields(b,['watchId','capitalCents']);
  const watch=await getRecord(ctx,owner,'watch',b.watchId);
  if(!watch.enabled)fail('watch_off','Start this account monitor first.');
  const {selected,config,run}=await boundStudy(ctx,owner,watch,at);
  const mandate=await host(ctx,'mandate.prepare',{...binding(selected),capitalCents:b.capitalCents,renewMandateId:watch.mandateId||null,strategyId:watch.strategyId,strategyFingerprint:fingerprint(config),backtestFingerprint:run.evidenceFingerprint,symbols:portfolioStrategySymbols(config)});
  await saveRecord(ctx,owner,'live-mandate',{mandateId:mandate.mandateId,watchId:watch.id,mandate,fingerprint:mandate.fingerprint,accountId:selected.account.accountId,connectionKey:selected.account.connectionKey},mandate.mandateId);
  return{mandate,requiresHumanActivation:true};
 });
 route('post','/portfolio/live/activate',async(req,owner,at)=>{
  const b=req.body||{};fields(b,['watchId','mandateId','fingerprint','confirm']);
  if(b.confirm!==true)fail('live_mandate_confirmation_required','Confirm the exact real-money strategy mandate.',428);
  const watch=await getRecord(ctx,owner,'watch',b.watchId),{selected}=await boundStudy(ctx,owner,watch,at);
  if(!watch.enabled)fail('watch_off','This monitor is stopped.');
  const retained=await getRecord(ctx,owner,'live-mandate','live-mandate:'+fingerprint([owner,b.mandateId]));
  if(retained.watchId!==watch.id||retained.fingerprint!==b.fingerprint||retained.accountId!==selected.account.accountId||retained.connectionKey!==selected.account.connectionKey)fail('mandate_mismatch','The mandate does not match this account and watcher.');
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
