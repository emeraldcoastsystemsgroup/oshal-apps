/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Explicit completed-session ends for component studies, with cutoff provenance; current-data conflicts stay refused.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Expose separate combined allocation/protection research routes without mixing component studies or broker authority.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Original-owner position backstop observations, causal research receipts and expected funding. Model observations never masquerade as brokerage orders.
 */
'use strict';
const {PortfolioError,accountKey}=require('../trading-portfolio-model');
const {listRecords,getRecord,saveRecord,fingerprint}=require('../trading-portfolio-store');
const {lastCompletedSession,validDay,sessionDates}=require('../trading-portfolio-calendar');
const {readPlanQuotes}=require('../trading-portfolio-plan-evidence');
const {backstopPolicy,advanceBackstop,dailyBackstopEvidence,wilderAtr,simulateBackstop}=require('./backstop-model');
const {registerCombinedResearch}=require('./combined-research');
const {registerProtectiveExecutionRoutes}=require('./protective-execution');
const fail=(message,status=422)=>{throw new PortfolioError(status,'backstop_unavailable',message);};
const busy=new Set();
function strict(body,allowed){if(Object.keys(body).some(k=>![...allowed,'book','mode'].includes(k)))fail('Unexpected backstop request fields.',400);}
function symbol(value){if(typeof value!=='string'||!/^\$?[A-Z][A-Z0-9./-]{0,15}$/.test(value))fail('Select a valid instrument symbol.');return value.replace(/^\$/,'').replace(/\//g,'.');}
async function readDaily(ctx,connection,ticker,latest){
 const result=await ctx.intent('trading.bars',{connection,symbol:ticker,timeframe:'1Day'});
 if(result?.source!=='schwab'||result.symbol!==ticker)fail('Historical source or symbol does not match this request.');
 return dailyBackstopEvidence(result.bars,latest);
}
function brokerStopCoverage(orders,ticker,quantity){
 if(!Array.isArray(orders))return{status:'unknown',quantity:null,orderIds:[]};
 const rows=orders.filter(o=>['WORKING','ACCEPTED','AWAITING_STOP_CONDITION','PENDING_ACTIVATION'].includes(o.status)&&['STOP','STOP_LIMIT','TRAILING_STOP','TRAILING_STOP_LIMIT'].includes(o.orderType)&&o.legs?.length===1&&o.legs[0].instruction==='SELL'&&o.legs[0].symbol?.replace(/\//g,'.')===ticker);
 const valid=rows.filter(o=>typeof o.remainingQuantity==='number'&&Number.isFinite(o.remainingQuantity)&&o.remainingQuantity>0);
 const covered=valid.reduce((n,o)=>n+o.remainingQuantity,0);
 return{status:covered>=quantity&&quantity>0?'working-broker-stop':covered>0?'partial':'none',quantity:covered,orderIds:valid.map(o=>o.orderId),matchesConfiguredModel:false,
  note:'A working broker stop is separate from the modeled backstop. Trigger terms and instrument eligibility require exact order review; execution price is not guaranteed.'};
}
/** Persist one account snapshot; retain every reported position, including unavailable rows. */
async function checkAccountBackstops(ctx,owner,selected,at,{quotes,orders,nativeTickets}={}){
 const lock=owner+':'+accountKey(selected.account);if(busy.has(lock))fail('This account backstop check is already running.',409);busy.add(lock);
 try{return await recordAccountBackstops(ctx,owner,selected,at,{quotes,orders,nativeTickets});}finally{busy.delete(lock);}
}
async function recordAccountBackstops(ctx,owner,selected,at,{quotes,orders,nativeTickets=[]}={}){
 const key=accountKey(selected.account),policy=(await listRecords(ctx,owner,'backstop-policy')).find(r=>accountKey(r)===key);
 if(!policy)return{configured:false,brokerOrdersPlaced:0};
 const config=backstopPolicy(policy.config),previous=(await listRecords(ctx,owner,'backstop-state')).find(r=>accountKey(r)===key);
 const positions=selected.account.positions;
 if(!Array.isArray(positions)||positions.length>200)fail('A complete account roster of at most200 positions is required.');
 const tickers=positions.map(p=>symbol(p.symbol));
 if(new Set(tickers).size!==tickers.length)fail('The account reports duplicate instrument rows; reconcile their quantities before enrolling backstops.');
 let prices=quotes;
 if(!prices)prices=(await readPlanQuotes(ctx,selected.account.connectionKey,[...new Set(tickers)])).quotes;
 let brokerReadStatus=Array.isArray(orders)?'verified':'unavailable';
 if(!Array.isArray(orders)){
  try{const answer=await ctx.intent('trading.orders.list',{connection:selected.account.connectionKey,accountId:selected.account.accountId});if(!Array.isArray(answer.orders))fail('Broker order roster is missing.');orders=answer.orders;brokerReadStatus='verified';}
  catch{brokerReadStatus='unavailable';}
 }
 const rows=positions.map((p,i)=>{
  const ticker=tickers[i],old=previous?.rows?.find(r=>r.symbol===ticker)?.state,q=prices.find(x=>x.symbol===ticker),watcher=policy.executionMode==='watcher',stamp=watcher?q?.quoteAt:q?.tradeAt,price=watcher?q?.bidPrice:q?.tradePrice;
  const base={symbol:ticker,quantity:p.qty,wholeShares:typeof p.qty==='number'?Math.floor(p.qty):null,fractionalResidual:typeof p.qty==='number'?p.qty-Math.floor(p.qty):null,broker:brokerStopCoverage(orders,ticker,p.qty),state:old||null};
  try{
   if(typeof p.qty!=='number'||!Number.isFinite(p.qty)||p.qty<=0)fail('Only measured positive long holdings can enroll; review this instrument separately.');
   if(!q||q.source!=='schwab'||q.delayed!==false||typeof price!=='number'||!Number.isFinite(price)||price<=0||!Number.isFinite(Date.parse(stamp)))fail(watcher?'An explicitly real-time Schwab bid and quote timestamp are required.':'An explicitly real-time Schwab trade and timestamp are required.');
   const age=at.getTime()-Date.parse(stamp);if(age< -5000||age>(watcher?30000:90000))fail('The price is stale. Its prior backstop is retained but no fresh protection is claimed.');
   if(watcher&&(!Number.isFinite(q.askPrice)||q.askPrice<price||q.askPrice/price-1>0.01||!Number.isFinite(q.bidSize)||q.bidSize<=0))fail('Watcher exits require a measured ask, positive bid size and spread within 1%.');
   if(watcher&&old&&old.quantity!==p.qty&&!require('./watcher-exits').verifiedResize(old,p,ticker,policy,nativeTickets,selected.account)){
    const state={...old,status:'review-required',reason:'Quantity changed without matching native fills or a newly reviewed holding. Reconcile manual or corporate-action adjustments; the previous floor is retained.'};
    return{...base,state,status:state.status,price,priceAsOf:stamp,priceBasis:'bid',modelOnly:true};
   }
   let prior=watcher&&old?{...old,quantity:p.qty}:old;
   if(watcher&&prior&&Number.isFinite(policy.mandate?.activatedAtMs)&&(!Number.isFinite(Date.parse(prior.triggeredAt))||Date.parse(prior.triggeredAt)<policy.mandate.activatedAtMs))prior={...prior,triggered:false,triggeredAt:null};
   const state=advanceBackstop(prior,{price,quantity:p.qty,observedAt:stamp},config);
   return{...base,state,status:state.status,price,priceAsOf:stamp,priceBasis:watcher?'bid':'last-trade',modelOnly:true};
  }catch(e){return{...base,status:'unavailable',message:e instanceof PortfolioError?e.message:'This position could not be verified.',modelOnly:true};}
 });
 const result={accountId:selected.account.accountId,connectionKey:selected.account.connectionKey,accountLabel:selected.profile?.label||selected.account.accountMasked,policyId:policy.id,config,observedAt:at.toISOString(),brokerReadStatus,rows,
  summary:{positions:rows.length,modelWatching:rows.filter(r=>r.status==='model-watching').length,triggered:rows.filter(r=>r.status==='model-triggered').length,unavailable:rows.filter(r=>r.status==='unavailable'||r.status==='review-required').length,workingBrokerStops:rows.filter(r=>r.broker.status==='working-broker-stop').length},brokerOrdersPlaced:0,
  disclosure:'Model tracking does not create a broker stop. Every holding remains visible. Stale quotes and changed quantities require review; no average-cost or invented peak substitutes for an observation.'};
 return saveRecord(ctx,owner,'backstop-state',result,key);
}
/** Authenticated routes use the existing owner/account resolver, never caller-supplied credentials. */
function registerBackstopRoutes(route,ctx,deps){
 registerCombinedResearch(route,ctx,deps);
 registerProtectiveExecutionRoutes(route,ctx,deps);
 route('get','/portfolio/backstops',async(_req,owner,at)=>{
  const policies=await listRecords(ctx,owner,'backstop-policy');
  for(const p of policies)if(p.protectionMandateId){
   const bound={connection:p.connectionKey,accountId:p.accountId};
   const results=await Promise.allSettled([ctx.intent('trading.orders.protection.status',{...bound,protectionMandateId:p.protectionMandateId}),ctx.intent('trading.orders.tickets',bound)]);
   p.nativeStatus=results[0].status==='fulfilled'?results[0].value:{effectiveStatus:'unavailable'};
   p.nativeTickets=results[1].status==='fulfilled'?results[1].value.tickets?.filter(t=>t.protectionMandateId===p.protectionMandateId):null;
  }
  const nativeConfig=await ctx.intent('trading.config',{});
  return{latestCompletedSession:lastCompletedSession(at),policies,accounts:await listRecords(ctx,owner,'backstop-state'),research:(await listRecords(ctx,owner,'backstop-run')).map(({history,selectedSimulation,...r})=>r),brokerExecutionAvailable:nativeConfig.protectiveMandates===true,watcherExecutionAvailable:nativeConfig.watcherExitMandates===true};
 });
 route('post','/portfolio/backstops/configure',async(req,owner,at)=>{
  const b=req.body||{};strict(b,['accountId','connectionKey','config','confirm','upgrade']);if(b.confirm!==true)fail('Confirm model tracking for this exact account.',428);
  const selected=await deps.selected(owner,b,at);if(selected.account.kind!=='live')fail('Choose a connected real account.');
  const config=backstopPolicy(b.config),old=(await listRecords(ctx,owner,'backstop-policy')).find(r=>accountKey(r)===accountKey(selected.account));
  const same=old&&fingerprint(old.config)===fingerprint(config),upgrade=old&&!old.automatedBrokerProtection&&old.config.modelVersion===1&&config.modelVersion===2&&old.config.trailPct===config.trailPct&&old.config.transactionCostBps===config.transactionCostBps&&b.upgrade===true;
  if(old&&!same&&!upgrade)fail('This enrolled policy has different terms. Review its position states before changing or loosening the trail.');
  const policy=same?old:await saveRecord(ctx,owner,'backstop-policy',{...old,accountId:b.accountId,connectionKey:b.connectionKey,config,enrolledAt:old?.enrolledAt||at.toISOString(),modelOnly:true},accountKey(selected.account));
  return{policy,brokerOrderPlaced:false,requiresBrokerOrderReview:true};
 });
 route('post','/portfolio/backstops/check',async(req,owner,at)=>{
  const b=req.body||{};strict(b,['accountId','connectionKey']);const selected=await deps.selected(owner,b,at);
  return{account:await checkAccountBackstops(ctx,owner,selected,at)};
 });
 route('post','/portfolio/backstops/backtest',async(req,owner,at)=>{
  const b=req.body||{};strict(b,['accountId','connectionKey','symbol','modelVersion','endDate']);const selected=await deps.selected(owner,b,at),ticker=symbol(b.symbol);
  const modelVersion=b.modelVersion??1;if(![1,2].includes(modelVersion))fail('Select a supported backstop model version.');
  const lock=owner+':research';if(busy.has(lock))fail('A backstop study is already running.',409);busy.add(lock);
  try{
   const latest=lastCompletedSession(at),endDate=validDay(b.endDate??latest);
   if(endDate>latest||sessionDates(endDate,endDate).length!==1)fail('Choose a completed NYSE session for the backstop study end.');
   const {rows:history,quality}=await readDaily(ctx,selected.account.connectionKey,ticker,endDate),start=50,split=start+Math.floor((history.length-start)/2);
   const train={startDate:history[start].date,endDate:history[split-1].date},later={startDate:history[split].date,endDate:history.at(-1).date};
   const candidates=[5,8,10,12,15,20].map(trailPct=>{const config=backstopPolicy({modelVersion,trailPct,transactionCostBps:25,...(modelVersion===2?{reentry:'none'}:{})}),r=simulateBackstop(history,config,train);return{config,training:{metrics:r.metrics,fees:r.fees,tradeCount:r.tradeCount},score:r.metrics.returnPct/Math.max(5,r.metrics.maxDrawdownPct)};});
   const chosen=candidates.filter(c=>c.training.metrics.returnPct>0).sort((a,b)=>b.score-a.score||a.training.tradeCount-b.training.tradeCount||a.config.trailPct-b.config.trailPct)[0]||null;
   // The selection above is fixed before any later-period simulation is evaluated.
   for(const c of candidates){const r=simulateBackstop(history,c.config,later);c.later={metrics:r.metrics,fees:r.fees,tradeCount:r.tradeCount};}
   const selectedSimulation=chosen?simulateBackstop(history,chosen.config,{startDate:train.startDate,endDate:later.endDate}):null;
   const indicators={asOf:history.at(-1).date,atr14:wilderAtr(history),sma50:history.slice(-50).reduce((n,r)=>n+r.close,0)/50,donchian20Upper:Math.max(...history.slice(-20).map(r=>r.high))};
   const run=await saveRecord(ctx,owner,'backstop-run',{accountId:b.accountId,connectionKey:b.connectionKey,symbol:ticker,source:'schwab',sourceReadAt:at.toISOString(),latestCompletedSession:latest,requestedEndDate:endDate,sessionsAfterStudyEnd:sessionDates(endDate,latest).filter(d=>d>endDate).length,historyFingerprint:fingerprint(history),history,dataQuality:quality,indicators,trainingWindow:train,laterWindow:later,candidates,selectedConfig:chosen?.config||null,selectedSimulation,
    selection:'Training price return divided by maximum drawdown with a5% denominator floor; positive training return required, then fewer training trades and lower trail percentage. Fixed six trails;25bps costs. Later performance never chooses the winner.',researchOnly:true,untouchedHoldout:false,currentHoldingsSelectionBias:true,brokerOrdersPlaced:0});
   return{run};
  }finally{busy.delete(lock);}
 });
 route('get','/portfolio/expected-funding',async(_req,owner)=>({plans:await listRecords(ctx,owner,'funding-plan'),availableForTrading:false}));
 route('post','/portfolio/expected-funding',async(req,owner,at)=>{
  const b=req.body||{};strict(b,['amountUsd']);if(typeof b.amountUsd!=='number'||!Number.isFinite(b.amountUsd)||b.amountUsd<=0||b.amountUsd>1e8)fail('Enter a positive expected amount up to$100million.');
  return{plan:await saveRecord(ctx,owner,'funding-plan',{amountUsd:b.amountUsd,status:'expected',recordedAt:at.toISOString(),availableForTrading:false,destinationAccount:null},'expected-funding'),availableForTrading:false};
 });
}
module.exports={registerBackstopRoutes,checkAccountBackstops,brokerStopCoverage,readDaily};
