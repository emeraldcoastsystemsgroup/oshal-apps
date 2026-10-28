/** Synthetic owner, broker funding, native approvals and partial fills for actual allocation routes. No real brokerage I/O. */
'use strict';
const assert=require('node:assert/strict');
const {setup}=require('./native-management-host');
async function allocationFixture(t,options={}){
 const h=await setup(t);h.accounts[0].positions=structuredClone(options.positions||[]);h.accounts[0].cash=options.cash??1000;h.accounts[0].equity=options.equity??1000;Object.assign(h.accounts[0].balanceFacts,{marginBalance:0},options.balanceFacts||{});
 const original=h.ctx.intent;let m=null,n=0;const tickets=[];
 h.ctx.intent=async(name,input)=>{
  if(name==='trading.config')return{orderTickets:true,strategyMandates:true,wholeAccountMandates:true};
  if(name==='trading.orders.mandate.prepare'){
   if(!input.scope)assert.equal(h.accounts[0].positions.length,0,'legacy scope cannot adopt existing holdings');
   m={mandateId:'mandate-1',fingerprint:'review',status:'draft',reviewExpiresAtMs:Date.parse('2026-10-26T16:10:00Z'),accountMasked:'…1234',terms:{...input,maxDailyTurnoverCents:input.capitalCents*2},expiresAtMs:Date.parse('2026-11-25T16:00:00Z')};
   if(input.scope==='whole-account'){
    const a=h.accounts[0];m.terms.ownership='all-current-and-future-long-equities';m.terms.maxDailyTurnoverCents=Math.max(input.capitalCents*2,Math.ceil(a.positions.reduce((n,p)=>n+p.marketValue,0)*100)+input.capitalCents);
    m.adoptionReview={accountType:a.accountType,equity:a.equity,cash:a.cash,balanceFacts:structuredClone(a.balanceFacts),positions:structuredClone(a.positions),holdingsFingerprint:require('../../routes/trading-portfolio-store').fingerprint(a.positions.map(p=>[p.symbol,p.qty]))};
   }return structuredClone(m);
  }
  if(name==='trading.orders.mandate.activate'){m.status='active';return structuredClone(m);}
  if(name==='trading.orders.mandate.stop'){m.status='stopped';return structuredClone(m);}
  if(name==='trading.orders.mandate.status')return {...structuredClone(m),effectiveStatus:m.effectiveStatus||m.status};
  if(name==='trading.orders.list')return{orders:tickets.filter(t=>t.status==='submitted').map(t=>({...t.brokerStatus,orderId:t.orderId})),readAtMs:0};
  if(name==='trading.orders.refresh'||name==='trading.orders.tickets')return{tickets:structuredClone(tickets)};
  if(name==='trading.orders.balance')return{cashBudgetUsd:h.accounts[0].balanceFacts.marginBalance<0?null:h.accounts[0].cash};
  if(name==='trading.orders.prepare'){
   if(input.side==='buy'){const exposure=h.accounts[0].positions.reduce((sum,p)=>sum+p.marketValue,0);assert.ok(input.quantity*input.limitCents/100<=h.accounts[0].cash,'new buys must use current cash');assert.ok(exposure+input.quantity*input.limitCents/100<=m.terms.capitalCents/100,'Synthetic native capital guard: buy limits plus owned exposure must fit the mandate');}
   const old=tickets.find(t=>t.intentKey===input.intentKey);if(old)return structuredClone(old);
   const t={ticketId:'ticket-'+(tickets.length+1),fingerprint:'exact',intentKey:input.intentKey,mandateId:input.mandateId,mandateFingerprint:m.fingerprint,cycle:input.cycle,status:'prepared',terms:{symbol:input.symbol,side:input.side,quantity:input.quantity,limitCents:input.limitCents}};tickets.push(t);return structuredClone(t);
  }
  if(name==='trading.orders.submit'){
   const t=tickets.find(t=>t.ticketId===input.ticketId);assert.equal(m.status,'active');if(t.status!=='prepared')return {...structuredClone(t),ordersSubmitted:0,submissionAttempted:false};n++;t.status='submitted';t.orderId=String(n);t.ordersSubmitted=1;t.submissionAttempted=true;t.brokerStatus={status:'WORKING',quantity:t.terms.quantity,filledQuantity:0,remainingQuantity:t.terms.quantity,legs:[]};return structuredClone(t);
  }
  return original(name,input);
 };
 const watch=(await h.req('/watch',{runId:h.runId,confirm:true})).watch;
 const draft=await h.req('/live/mandate',{watchId:watch.id,capitalCents:options.capitalCents??90000,...(options.whole?{scope:'whole-account'}:{})});assert.ok(draft.mandate,JSON.stringify(draft));assert.equal(draft.mandate.status,'draft');
 const activate=()=>h.req('/live/activate',{watchId:watch.id,mandateId:'mandate-1',fingerprint:'review',confirm:true,...(options.whole?{confirmAdoption:true}:{})});
 const fill=(amount)=>{
  const t=tickets.find(t=>t.brokerStatus?.status==='WORKING');assert.ok(t);const qty=amount??t.terms.quantity-t.brokerStatus.filledQuantity;
  assert.ok(qty>0&&qty<=t.brokerStatus.remainingQuantity);t.brokerStatus.filledQuantity+=qty;t.brokerStatus.remainingQuantity-=qty;t.brokerStatus.status=t.brokerStatus.remainingQuantity?'WORKING':'FILLED';
  const a=h.accounts[0],price=t.terms.limitCents/100;let position=a.positions.find(p=>p.symbol===t.terms.symbol);
  if(t.terms.side==='sell'){
   assert.ok(position.qty>=qty);position.qty-=qty;position.marketValue=position.qty*100;
   const loan=Math.max(0,-a.balanceFacts.marginBalance);a.balanceFacts.marginBalance=Math.min(0,a.balanceFacts.marginBalance+qty*price);a.cash+=Math.max(0,qty*price-loan);
   a.positions=a.positions.filter(p=>p.qty>0);
  }else{
   a.cash-=qty*price;if(position){position.qty+=qty;position.marketValue=position.qty*100;}else a.positions.push({symbol:t.terms.symbol,qty,marketValue:qty*100});
  }
  a.equity=a.cash+a.positions.reduce((n,p)=>n+p.marketValue,0)+Math.min(0,a.balanceFacts.marginBalance);
 };
 return{...h,watch,activate,fill,tickets,count:()=>n,mandate:()=>m,draft};
}
module.exports={allocationFixture};
