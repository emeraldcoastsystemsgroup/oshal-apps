/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Explicit original-owner review of native sell-only protection authority and bounded, durable trailing-stop maintenance. No purchase authority or silent retries.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Refresh expired unattempted reference prices and count only confirmed new native submissions.
 */
'use strict';
const {getRecord,listRecords,saveRecord,fingerprint}=require('../trading-portfolio-store');
const {PortfolioError,accountKey}=require('../trading-portfolio-model');
const {readPlanQuotes}=require('../trading-portfolio-plan-evidence');
const {nyseSessionClock}=require('../trading-portfolio-calendar');
const {backstopPolicy}=require('./backstop-model');
const {submissionCount}=require('./execution-state');
const terminal=new Set(['FILLED','CANCELED','CANCELLED','EXPIRED','REJECTED','REPLACED']);
const fail=(code,message,status=409)=>{throw new PortfolioError(status,code,message);};
const binding=a=>({connection:a.connectionKey,accountId:a.accountId});
async function native(ctx,name,input){return ctx.intent('trading.orders.'+name,input);}
async function accountPolicy(ctx,owner,account){return(await listRecords(ctx,owner,'backstop-policy')).find(p=>accountKey(p)===accountKey(account));}
function fields(b,allowed){if(Object.keys(b).some(k=>![...allowed,'book','mode'].includes(k)))fail('protection_fields_invalid','Unexpected protective-policy fields.',400);}
function canonical(s){if(typeof s!=='string'||!/^\$?[A-Z][A-Z0-9./-]{0,15}$/.test(s))fail('protection_symbol_invalid','An instrument symbol could not be verified.');return s.replace(/^\$/,'').replace(/\//g,'.');}
/** Existing native protection reserves shares but need not stall cash-funded purchases of other assets. */
function allocationBlockingOrders(orders,tickets,account){
 return orders.filter(o=>!terminal.has(o.status)&&!tickets.some(t=>{
  const terms=t.terms,leg=o.legs?.[0];
  return t.connection===account.connectionKey&&t.accountId===account.accountId&&t.status==='submitted'&&t.orderId===o.orderId&&t.protectionMandateId&&
   terms?.orderType==='TRAILING_STOP'&&terms.side==='sell'&&o.orderType==='TRAILING_STOP'&&o.duration==='GOOD_TILL_CANCEL'&&o.session==='NORMAL'&&
   ['WORKING','ACCEPTED','QUEUED','PENDING_ACTIVATION','AWAITING_STOP_CONDITION'].includes(o.status)&&o.stopPriceLinkBasis==='LAST'&&o.stopPriceLinkType==='PERCENT'&&
   typeof o.stopPriceOffset==='number'&&Math.abs(o.stopPriceOffset*100-terms.trailBps)<0.000001&&o.legs.length===1&&leg.instruction==='SELL'&&
   typeof leg.symbol==='string'&&canonical(leg.symbol)===terms.symbol&&leg.quantity===terms.quantity&&o.quantity===terms.quantity&&
   typeof o.remainingQuantity==='number'&&o.remainingQuantity>0&&typeof o.filledQuantity==='number'&&o.filledQuantity>=0&&Math.abs(o.remainingQuantity+o.filledQuantity-terms.quantity)<0.000001;
 }));
}
/** A declined, uncertain or unfilled ticket never becomes permission for another request. */
function nextProtectiveAction(account,orders,tickets,policy,quotes,at){
 const actions=[],exceptions=[];
 if(!Array.isArray(account.positions)||account.positions.length>200)fail('protection_roster_invalid','Protection needs the complete current position roster.');
 if(!Array.isArray(orders)||!Array.isArray(tickets)||!Array.isArray(quotes))fail('protection_orders_unavailable','Current broker orders, native attempts and quotes must all be available.');
 if(tickets.some(t=>['attempting','unknown'].includes(t.status)))fail('protection_attempt_uncertain','An uncertain native attempt must be reconciled before more protective submissions.');
 const merged=new Map(orders.map(o=>[o.orderId,o]));
 for(const ticket of tickets){const order=ticket.brokerStatus;if(ticket.orderId&&order&&!terminal.has(order.status)){
  const existing=merged.get(ticket.orderId);if(!existing||terminal.has(existing.status)||(order.remainingQuantity??Infinity)>(existing.remainingQuantity??Infinity))merged.set(ticket.orderId,order);
 }}
 orders=[...merged.values()];
 const seen=new Set();
 for(const position of account.positions){
  const symbol=canonical(position.symbol);if(seen.has(symbol))fail('protection_duplicate_position','Duplicate position rows require reconciliation.');seen.add(symbol);
  const base={symbol,heldQuantity:position.qty};
  if(typeof position.qty!=='number'||!Number.isFinite(position.qty)||position.qty<=0){exceptions.push({...base,reason:'Only measured positive long equity holdings are eligible.'});continue;}
  const residual=position.qty-Math.floor(position.qty);if(residual>0.000001)exceptions.push({...base,fractionalResidual:residual,reason:'Fractional shares cannot have broker stop orders.'});
  let reserved=0,stopCovered=0,ambiguous=false;
  for(const order of orders.filter(o=>!terminal.has(o.status))){
   if(order.legs?.length!==1||typeof order.legs[0].symbol!=='string'){ambiguous=true;break;}
   const leg=order.legs[0];if(canonical(leg.symbol)!==symbol)continue;
   if(!['BUY','SELL'].includes(leg.instruction)||!['WORKING','ACCEPTED','QUEUED','PENDING_ACTIVATION','AWAITING_PARENT_ORDER','AWAITING_RELEASE_TIME','AWAITING_CONDITION','AWAITING_STOP_CONDITION'].includes(order.status)){ambiguous=true;break;}
   if(leg.instruction==='SELL'){if(typeof order.remainingQuantity!=='number'||!Number.isFinite(order.remainingQuantity)||order.remainingQuantity<0){ambiguous=true;break;}reserved+=order.remainingQuantity;if(['STOP','STOP_LIMIT','TRAILING_STOP','TRAILING_STOP_LIMIT'].includes(order.orderType))stopCovered+=order.remainingQuantity;}
  }
  if(ambiguous){exceptions.push({...base,reason:'Complex, changing or unrecognized broker orders need review.'});continue;}
  if(reserved>position.qty+0.000001){exceptions.push({...base,reason:'Working sell reservations exceed the reported holding.'});continue;}
  const uncovered=Math.max(0,Math.floor(position.qty-reserved+0.0000001));
  if(!uncovered){if(stopCovered+0.000001<Math.floor(position.qty))exceptions.push({...base,reason:'Shares reserved by other sells are not verified protective stops.'});continue;}
  const quote=quotes.find(q=>q.symbol===symbol),age=at-Date.parse(quote?.tradeAt);
  if(!quote||quote.source!=='schwab'||quote.delayed!==false||!Number.isFinite(age)||age>90000||age< -5000||typeof quote.tradePrice!=='number'||!Number.isFinite(quote.tradePrice)||quote.tradePrice<=0){exceptions.push({...base,reason:'No fresh explicitly real-time trade price.'});continue;}
  let referenceCents=Math.round(quote.tradePrice*100);const quantity=Math.min(uncovered,100000,Math.floor(250000/quote.tradePrice));
  if(referenceCents<1||!Number.isSafeInteger(quantity)||quantity<1){exceptions.push({...base,reason:'Price or quantity is outside the protective order bounds.'});continue;}
  const own=tickets.filter(t=>t.protectionMandateId===policy.protectionMandateId&&t.terms?.symbol===symbol);
  if(own.some(t=>['CANCELED','CANCELLED','EXPIRED','REPLACED'].includes(t.brokerStatus?.status))){exceptions.push({...base,reason:'Canceled, expired or replaced protection needs review of its previous ratcheted stop before restoration.'});continue;}
  const generations=own.filter(t=>t.brokerStatus?.status==='FILLED').map(t=>t.ticketId).sort();
  const intentKey=fingerprint([policy.protectionMandateId,symbol,quantity,reserved,generations]);
  const old=own.find(t=>t.intentKey===intentKey);
  if(old&&old.status!=='prepared'){exceptions.push({...base,reason:'The existing protective attempt requires review or broker reconciliation.',ticketId:old.ticketId});continue;}
  // Live drafts retain their reviewed price. An expired unattempted draft is rechecked natively.
  if(old&&old.expiresAtMs>at.getTime())referenceCents=old.terms.referenceCents;
  actions.push({...base,quantity,referenceCents,trailBps:Math.round(policy.config.trailPct*100),intentKey});
 }
 return{actions,exceptions};
}
/** Source-bound native authority is checked again at each prepare and submit, independently of this UI store. */
async function protectiveTick(ctx,owner,selected,at){
 let policy=await accountPolicy(ctx,owner,selected.account);
 if(!policy?.automatedBrokerProtection)return{status:'not-enabled',ordersSubmitted:0};
 const bound=binding(selected.account),outcome={status:'waiting',observedAt:at.toISOString(),ordersSubmitted:0,attempted:0,exceptions:[],tickets:[]};
 try{
  const mandate=await native(ctx,'protection.status',{...bound,protectionMandateId:policy.protectionMandateId});
  if(mandate.status!=='active'||mandate.effectiveStatus!=='active'||!Number.isFinite(mandate.expiresAtMs)||mandate.expiresAtMs<=at.getTime()){outcome.status='authority-not-active';return outcome;}
  if(!nyseSessionClock(at).regular){outcome.status='waiting-regular-session';return outcome;}
  for(let pass=0;pass<4;pass++){
   const current=await selected.refresh(),account=current.account;
   const [orderData,ticketData,quoteData]=await Promise.all([native(ctx,'list',bound),native(ctx,'refresh',bound),readPlanQuotes(ctx,account.connectionKey,[...new Set(account.positions.map(p=>canonical(p.symbol)))])]);
   const plan=nextProtectiveAction(account,orderData.orders,ticketData.tickets,policy,quoteData.quotes,selected.clock());outcome.exceptions=plan.exceptions;
   if(!plan.actions.length){outcome.status=plan.exceptions.length?'partial-coverage':'covered-or-flat';break;}
   const action=plan.actions[0],authority={...bound,protectionMandateId:policy.protectionMandateId,policyFingerprint:fingerprint(policy.config)};
   const ticket=await native(ctx,'prepare',{...authority,...action,orderType:'TRAILING_STOP',side:'sell'});
   if(ticket.status!=='prepared'){outcome.status='attempt-requires-review';outcome.tickets.push(ticket);break;}
   outcome.attempted++;
   let submitted;
   try{submitted=await native(ctx,'submit',{...authority,ticketId:ticket.ticketId,fingerprint:ticket.fingerprint,confirm:true});}
   catch{outcome.status='submission-outcome-unknown';outcome.ordersSubmitted=null;break;}
   outcome.tickets.push(submitted);
   if(submitted.status!=='submitted'||!submitted.orderId){outcome.status=submitted.status==='unknown'?'submission-outcome-unknown':'broker-refused';if(submitted.status==='unknown')outcome.ordersSubmitted=null;break;}
   const count=submissionCount(submitted);
   if(count===null){outcome.ordersSubmitted=null;outcome.status='submission-outcome-unknown';break;}
   outcome.ordersSubmitted+=count;outcome.status=count?'submitted-awaiting-broker-coverage':'submission-replayed';
   if(!count)break;
   // The next pass rereads broker reservations before considering another instrument.
  }
  return outcome;
 }catch(e){outcome.status='protection-check-failed';outcome.message='Native protective authority or broker evidence could not be verified.';return outcome;}
 finally{
  policy={...policy,lastBrokerProtectionCheck:outcome};await saveRecord(ctx,owner,'backstop-policy',policy,accountKey(policy));
 }
}
function registerProtectiveExecutionRoutes(route,ctx,deps){
 route('post','/portfolio/backstops/review',async(req,owner,at)=>{
  const b=req.body||{};fields(b,['accountId','connectionKey','researchRunId']);const selected=await deps.selected(owner,b,at),policy=await accountPolicy(ctx,owner,selected.account);
  if(!policy)fail('protection_not_enrolled','Enroll this account in exit-to-cash model tracking first.');
  const config=backstopPolicy(policy.config);if(config.modelVersion!==2)fail('protection_model_mismatch','Broker protection uses the separately tested exit-to-cash model.');
  const study=await getRecord(ctx,owner,'backstop-run',b.researchRunId);
  if(accountKey(study)!==accountKey(selected.account)||study.source!=='schwab'||study.researchOnly!==true||!study.historyFingerprint||!study.candidates?.some(c=>fingerprint(c.config)===fingerprint(config)))fail('protection_research_mismatch','Choose a completed matching exit-to-cash study for this exact account.');
  if(policy.automatedBrokerProtection)fail('protection_already_enabled','Stop existing protective authority before reviewing changed terms.');
  const nativeConfig=await ctx.intent('trading.config',{});if(nativeConfig.protectiveMandates!==true)fail('protection_release_required','The verified native protective-mandate release is not active.',503);
  const mandate=await native(ctx,'protection.prepare',{...binding(selected.account),trailBps:Math.round(config.trailPct*100),policyFingerprint:fingerprint(config),backtestFingerprint:fingerprint(study)});
  const candidate=study.candidates.find(c=>fingerprint(c.config)===fingerprint(config));
  const research={symbol:study.symbol,historyFingerprint:study.historyFingerprint,trainingWindow:study.trainingWindow,laterWindow:study.laterWindow,candidate,
   trainingSelected:!!study.selectedConfig&&fingerprint(study.selectedConfig)===fingerprint(config),hasPositiveTrainingCandidate:!!study.selectedConfig,selection:study.selection,
   untouchedHoldout:study.untouchedHoldout===true,currentHoldingsSelectionBias:study.currentHoldingsSelectionBias===true};
  const review=await saveRecord(ctx,owner,'protection-review',{accountId:b.accountId,connectionKey:b.connectionKey,policyId:policy.id,policyFingerprint:fingerprint(config),researchRunId:study.id,research,mandate},mandate.protectionMandateId);
  return{review,requiresHumanActivation:true};
 });
 route('post','/portfolio/backstops/activate',async(req,owner,at)=>{
  const b=req.body||{};fields(b,['accountId','connectionKey','reviewId','fingerprint','confirm']);if(b.confirm!==true)fail('protection_confirmation_required','Confirm the exact real-money protective mandate.',428);
  const selected=await deps.selected(owner,b,at),policy=await accountPolicy(ctx,owner,selected.account),review=await getRecord(ctx,owner,'protection-review',b.reviewId);
  if(!policy||accountKey(review)!==accountKey(selected.account)||review.policyId!==policy.id||review.policyFingerprint!==fingerprint(policy.config)||b.fingerprint!==review.mandate.fingerprint)fail('protection_review_changed','The protective review does not match this account and policy.');
  const mandate=await native(ctx,'protection.activate',{...binding(selected.account),protectionMandateId:review.mandate.protectionMandateId,fingerprint:b.fingerprint,confirm:true});
  if(mandate.status!=='active')fail('protection_activation_unverified','The native broker did not confirm active protective authority.');
  return{policy:await saveRecord(ctx,owner,'backstop-policy',{...policy,modelOnly:false,automatedBrokerProtection:true,protectionMandateId:mandate.protectionMandateId,mandate},accountKey(policy)),requiresWatcherSchedule:true};
 });
 route('post','/portfolio/backstops/stop',async(req,owner,at)=>{
  const b=req.body||{};fields(b,['accountId','connectionKey']);const policy=await accountPolicy(ctx,owner,b);
  if(!policy)fail('protection_not_enrolled','This account has no protection policy.');
  if(policy.protectionMandateId)await native(ctx,'protection.stop',{connection:policy.connectionKey,accountId:policy.accountId,protectionMandateId:policy.protectionMandateId});
  return{policy:await saveRecord(ctx,owner,'backstop-policy',{...policy,automatedBrokerProtection:false},accountKey(policy)),existingBrokerOrdersRemain:true};
 });
 route('post','/portfolio/backstops/cancel',async(req,owner,at)=>{
  const b=req.body||{};fields(b,['accountId','connectionKey','ticketId','orderId','fingerprint','confirm']);if(b.confirm!==true)fail('protection_cancel_confirmation','Confirm cancellation of this exact real broker order.',428);
  const selected=await deps.selected(owner,b,at),policy=await accountPolicy(ctx,owner,selected.account);
  if(!policy?.protectionMandateId)fail('protection_not_enrolled','This account has no native protection policy.',404);
  const data=await native(ctx,'tickets',binding(selected.account));
  const ticket=data.tickets?.find(t=>t.ticketId===b.ticketId&&t.orderId===b.orderId&&t.fingerprint===b.fingerprint&&t.protectionMandateId===policy?.protectionMandateId);
  if(!ticket)fail('protection_cancel_mismatch','This protective order was not found for the account and policy.');
  return{ticket:await native(ctx,'cancel',{...binding(selected.account),ticketId:b.ticketId,orderId:b.orderId,fingerprint:b.fingerprint,confirm:true}),cancellationIsNotAFill:true};
 });
}
module.exports={nextProtectiveAction,protectiveTick,registerProtectiveExecutionRoutes,allocationBlockingOrders};
