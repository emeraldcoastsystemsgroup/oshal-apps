/** Synthetic native protective ledger for actual owner routes; never a real connection or broker request. */
'use strict';
const assert=require('node:assert/strict');
const {setup,binding}=require('./native-management-host');
const {sessionDates}=require('../../routes/trading-portfolio-calendar');
const config={modelVersion:2,trailPct:10,transactionCostBps:25,reentry:'none'};
async function protectionFixture(t,{watcher=false}={}){
 const h=await setup(t),original=h.ctx.intent,tickets=[],effects=[];let policy=null,available=true,listLag=false,submitMode='ok';
 let at=Date.parse('2026-10-26T16:00:00Z');const dates=sessionDates('2025-01-02','2026-10-23');
 h.ctx.intent=async(name,input)=>{
  if(name==='trading.config')return{orderTickets:true,strategyMandates:true,protectiveMandates:available,watcherExitMandates:watcher&&available};
  if(name==='trading.bars')return{source:'schwab',symbol:input.symbol,bars:dates.map((d,i)=>({t:Date.parse(d+'T05:00:00Z')/1000,o:100+i/10,h:101+i/10,l:99+i/10,c:100+i/10}))};
  if(name==='trading.orders.protection.prepare'){
   policy={...input,protectionMandateId:'synthetic-policy',fingerprint:'exact-policy',status:'draft',effectiveStatus:'draft',reviewExpiresAtMs:at+600000,terms:{...input,execution:input.execution||'broker',maxTicketNotionalCents:watcher?5000000:25000000,maxOrdersPerPass:8}};return structuredClone(policy);
  }
  if(name==='trading.orders.protection.activate'){assert.equal(input.fingerprint,policy.fingerprint);policy.status='active';policy.effectiveStatus='active';policy.activatedAtMs=at;policy.expiresAtMs=at+30*86400000;return structuredClone(policy);}
  if(name==='trading.orders.protection.status')return structuredClone(policy);
  if(name==='trading.orders.protection.stop'){policy.status='stopped';policy.effectiveStatus='stopped';return structuredClone(policy);}
  if(name==='trading.orders.tickets'||name==='trading.orders.refresh')return{tickets:structuredClone(tickets)};
  if(name==='trading.orders.list')return{orders:listLag?[]:structuredClone(tickets.flatMap(t=>t.brokerStatus?[t.brokerStatus]:[]))};
  if(name==='trading.orders.prepare'){
   assert.equal(policy.effectiveStatus,'active');assert.equal(input.protectionMandateId,policy.protectionMandateId);assert.equal(input.orderType,watcher?'LIMIT':'TRAILING_STOP');if(watcher)assert.equal(input.session,'SEAMLESS');assert.equal(input.side,'sell');
   const old=tickets.find(t=>t.intentKey===input.intentKey);if(old)return structuredClone(old);
   const row={...input,ticketId:'synthetic-ticket-'+tickets.length,fingerprint:'exact-ticket-'+tickets.length,status:'prepared',terms:{...input,orderType:watcher?'LIMIT':'TRAILING_STOP',side:'sell'},expiresAtMs:at+120000};tickets.push(row);return structuredClone(row);
  }
  if(name==='trading.orders.submit'){
   const row=tickets.find(t=>t.ticketId===input.ticketId);assert.equal(row.status,'prepared');assert.equal(policy.effectiveStatus,'active');effects.push(structuredClone(input));
   row.status=submitMode==='ok'?'submitted':'unknown';if(submitMode==='throw')throw Error('Synthetic acknowledgement lost');if(submitMode==='unknown')return structuredClone(row);
   row.ordersSubmitted=1;row.submissionAttempted=true;row.attemptedAtMs=at;row.orderId=String(100+effects.length);row.brokerStatus={orderId:row.orderId,status:'WORKING',quantity:row.terms.quantity,remainingQuantity:row.terms.quantity,filledQuantity:0,price:row.terms.limitCents/100,enteredTime:new Date(at).toISOString(),orderType:watcher?'LIMIT':'TRAILING_STOP',duration:watcher?'DAY':'GOOD_TILL_CANCEL',session:watcher?'SEAMLESS':'NORMAL',stopPriceLinkBasis:'LAST',stopPriceLinkType:'PERCENT',stopPriceOffset:10,stopPrice:90,legs:[{symbol:row.terms.symbol,instruction:'SELL',quantity:row.terms.quantity}]};return structuredClone(row);
  }
  if(name==='trading.orders.cancel'){effects.push({cancel:input.orderId});const row=tickets.find(t=>t.orderId===input.orderId);assert.equal(row.fingerprint,input.fingerprint);row.cancelStatus='requested';return structuredClone(row);}
  return original(name,input);
 };
 const enroll=()=>h.req('/backstops/configure',{...binding,config,confirm:true});
 const study=()=>h.req('/backstops/backtest',{...binding,symbol:'ABC',modelVersion:2});
 const review=async()=>{const r=await study();return h.req('/backstops/review',{...binding,researchRunId:r.run.id,...(watcher?{execution:'watcher'}:{})});};
 const activate=async()=>{await enroll();const r=await review();assert.equal(r.status,200,JSON.stringify(r));return h.req('/backstops/activate',{...binding,reviewId:r.review.id,fingerprint:r.review.mandate.fingerprint,confirm:true});};
 await h.req('/watch',{runId:h.runId,confirm:true});
 return{...h,setNow:value=>{at=Date.parse(value);h.setNow(value);},enroll,study,review,activate,tickets,effects,policy:()=>policy,setAvailable:v=>{available=v;},setListLag:v=>{listLag=v;},setSubmitMode:v=>{submitMode=v;}};
}
module.exports={protectionFixture,config};
