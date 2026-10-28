/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Connect the existing ratcheted backstop crossing to durable sell-only native limit tickets, with fill reconciliation and bounded repricing.
 */
'use strict';
const {fingerprint}=require('../trading-portfolio-store');
const {readPlanQuotes}=require('../trading-portfolio-plan-evidence');
const {submissionCount}=require('./execution-state');
const TERMINAL=new Set(['FILLED','CANCELED','CANCELLED','EXPIRED','REJECTED','REPLACED']);
const symbol=s=>s.replace(/^\$/,'').replace(/\//g,'.');
const own=(t,p)=>t.protectionMandateId===p.protectionMandateId&&t.terms?.orderType==='LIMIT'&&t.terms?.side==='sell'&&t.terms?.session==='SEAMLESS'&&t.terms?.exitTrigger;
function exitWitness(state){
 const t={peakCents:Math.ceil(state.triggerPeak*100),floorCents:Math.ceil(state.triggerStop*100),observedCents:Math.floor(state.triggerPrice*100),triggeredAtMs:Date.parse(state.triggeredAt),quantity:state.triggerQuantity};
 if(!Object.values(t).every(Number.isSafeInteger)||t.observedCents<=0||t.observedCents>t.floorCents||t.floorCents>=t.peakCents||t.quantity<1)return null;
 return{...t,stateFingerprint:fingerprint(t)};
}
function verifiedResize(old,position,ticker,policy,tickets,account){
 const since=Date.parse(old.observedAt),approved=policy.mandate;
 if(approved?.activatedAtMs>since&&approved.reviewHoldings?.some(p=>symbol(p.symbol)===ticker&&p.quantity===position.qty))return true;
 let delta=0;
 for(const t of tickets)if(t.connection===account.connectionKey&&t.accountId===account.accountId&&t.status==='submitted'&&t.orderId&&t.terms?.symbol===ticker&&['buy','sell'].includes(t.terms.side)){
  for(const e of t.brokerStatus?.executions||[]){const time=Date.parse(e.time);if(Number.isFinite(time)&&time>since&&Number.isFinite(e.quantity)&&e.quantity>0)delta+=(t.terms.side==='buy'?1:-1)*e.quantity;}
 }
 return Number.isFinite(since)&&Math.abs(position.qty-old.quantity-delta)<0.000001;
}
/** A trigger is latched; subsequent fills and cancellations never reset its peak or floor. */
function watcherExitPlan(account,orders,tickets,observation,policy,quotes,at){
 const actions=[],exceptions=[],waiting=[];
 if(!Array.isArray(orders)||!Array.isArray(tickets)||!Array.isArray(observation?.rows))throw Error('Complete watcher, order and native-attempt evidence is required.');
 if(tickets.some(t=>['attempting','unknown'].includes(t.status)))return{actions,exceptions:[{reason:'An uncertain native attempt requires reconciliation.'}],waiting};
 const merged=new Map(orders.map(o=>[o.orderId,o]));
 for(const t of tickets)if(t.orderId&&t.brokerStatus){const old=merged.get(t.orderId);if(!old||!TERMINAL.has(t.brokerStatus.status))merged.set(t.orderId,t.brokerStatus);}
 for(const row of observation.rows){
  if(['unavailable','review-required'].includes(row.status)){exceptions.push({symbol:row.symbol,reason:row.message||row.state?.reason||'Fresh watcher observations are unavailable; the previous floor is retained.'});continue;}
  if(row.status!=='model-triggered')continue;
  const ticker=symbol(row.symbol),base={symbol:ticker},q=quotes.find(q=>symbol(q.symbol)===ticker),state=row.state,witness=exitWitness(state||{});
  const stamp=Date.parse(q?.quoteAt),bid=q?.bidPrice,ask=q?.askPrice;
  if(!witness||witness.triggeredAtMs<policy.mandate.activatedAtMs||state.ignoredEarlierObservation){exceptions.push({...base,reason:'A crossing observed under this activated policy is required.'});continue;}
  if(q?.source!=='schwab'||q.delayed!==false||!Number.isFinite(stamp)||at-stamp>30000||stamp>at.getTime()+5000||!Number.isFinite(bid)||bid<=0||!Number.isFinite(ask)||ask<bid||ask/bid-1>0.01||!Number.isFinite(q.bidSize)||q.bidSize<=0){exceptions.push({...base,reason:'A fresh real-time bid, positive size and spread within 1% are required.'});continue;}
  const related=tickets.filter(t=>own(t,policy)&&t.terms.symbol===ticker&&t.terms.exitTrigger.stateFingerprint===witness.stateFingerprint);
  const pending=related.find(t=>t.status==='submitted'&&!TERMINAL.has(t.brokerStatus?.status));
  if(pending){
   const age=at.getTime()-(pending.attemptedAtMs||Date.parse(pending.brokerStatus?.enteredTime));
   if(Number.isFinite(age)&&age>=60000&&!['attempting','requested','unknown'].includes(pending.cancelStatus)&&pending.terms.limitCents>bid*100*1.001)actions.push({...base,kind:'cancel',ticket:pending});
   else waiting.push({...base,reason:'Awaiting the acknowledged exit or its cancellation.'});
   continue;
  }
  const held=account.positions.find(p=>symbol(p.symbol)===ticker)?.qty,filled=related.reduce((n,t)=>n+(t.brokerStatus?.filledQuantity||0),0),remaining=Math.max(0,witness.quantity-filled);
  if(!Number.isFinite(held)||held<0||held>remaining+0.000001+((row.fractionalResidual||0))){exceptions.push({...base,reason:'Wait for holdings and protective fills to reconcile; no duplicate exit is inferred.'});continue;}
  let reserved=0,valid=true;
  for(const order of merged.values())if(!TERMINAL.has(order.status)){
   if(order.legs?.length!==1||!Number.isFinite(order.remainingQuantity)){valid=false;break;}
   if(order.legs[0].instruction==='SELL'&&symbol(order.legs[0].symbol)===ticker)reserved+=order.remainingQuantity;
  }
  if(!valid){exceptions.push({...base,reason:'An unrecognized order reservation requires reconciliation.'});continue;}
  const available=Math.min(Math.floor(held-reserved+0.0000001),remaining),limitCents=Math.max(1,Math.ceil(bid*100*0.991));
  const quantity=Math.min(available,100000,Math.floor(5000000/limitCents));
  if(quantity<1){if(remaining>0)exceptions.push({...base,reason:'Existing sell reservations or fractional shares prevent another exit.'});continue;}
  const prepared=related.find(t=>t.status==='prepared'&&t.terms.quantity<=available);
  const intentKey=prepared?.intentKey||fingerprint([policy.protectionMandateId,ticker,witness.stateFingerprint,filled,related.filter(t=>t.status!=='prepared').length]);
  actions.push({...base,kind:'exit',quantity:prepared?.terms.quantity||quantity,limitCents:prepared?.expiresAtMs>at.getTime()?prepared.terms.limitCents:limitCents,exitTrigger:witness,intentKey,marketValue:held*bid});
 }
 actions.sort((a,b)=>(b.marketValue||0)-(a.marketValue||0));
 return{actions,exceptions,waiting};
}
async function watcherExitPass(ctx,owner,selected,policy,at){
 const account=selected.account,bound={connection:account.connectionKey,accountId:account.accountId};
 const [orderData,ticketData,quoteData]=await Promise.all([ctx.intent('trading.orders.list',bound),ctx.intent('trading.orders.refresh',bound),readPlanQuotes(ctx,account.connectionKey,[...new Set(account.positions.map(p=>symbol(p.symbol)))])]);
 const observation=await require('./backstops').checkAccountBackstops(ctx,owner,selected,at,{orders:orderData.orders,quotes:quoteData.quotes,nativeTickets:ticketData.tickets});
 return watcherExitPlan(account,orderData.orders,ticketData.tickets,observation,policy,quoteData.quotes,at);
}
async function executeWatcherExitPass(ctx,owner,selected,policy,at){
 const plan=await watcherExitPass(ctx,owner,selected,policy,at),outcome={exceptions:plan.exceptions,tickets:[],attempted:0,ordersSubmitted:0,done:true};
 if(!plan.actions.length)return{...outcome,status:plan.exceptions.length?'watcher-exceptions':plan.waiting.length?'waiting-for-exit-fill':'watching'};
 const action=plan.actions[0],authority={connection:selected.account.connectionKey,accountId:selected.account.accountId,protectionMandateId:policy.protectionMandateId,policyFingerprint:fingerprint(policy.config)};
 const native=(name,input)=>ctx.intent('trading.orders.'+name,{...authority,...input});
 if(action.kind==='cancel'){
  const t=action.ticket,cancel=await native('cancel',{ticketId:t.ticketId,orderId:t.orderId,fingerprint:t.fingerprint,confirm:true});
  return{...outcome,tickets:[cancel],status:'waiting-for-exit-cancellation'};
 }
 const ticket=await native('prepare',{...action,orderType:'LIMIT',session:'SEAMLESS',duration:'DAY',side:'sell'});
 if(ticket.status!=='prepared')return{...outcome,tickets:[ticket],status:'attempt-requires-review'};
 let submitted;try{submitted=await native('submit',{ticketId:ticket.ticketId,fingerprint:ticket.fingerprint,confirm:true});}
 catch{return{...outcome,attempted:1,ordersSubmitted:null,status:'submission-outcome-unknown'};}
 const count=submissionCount(submitted);
 return{...outcome,attempted:1,tickets:[submitted],ordersSubmitted:count,done:count!==1||submitted.status!=='submitted',
  status:count===null?'submission-outcome-unknown':submitted.status==='rejected'?'broker-refused':count?'watcher-exit-submitted':'submission-replayed'};
}
module.exports={watcherExitPlan,watcherExitPass,executeWatcherExitPass,exitWitness,verifiedResize};
