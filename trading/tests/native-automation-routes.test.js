/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Synthetic brokerage acceptance of explicit mandate activation, sequential fills, repeat-safe cycles, stopped trading and uncertain results. Never real orders.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Effective native authority, release compatibility and per-invocation unknown/replay receipts.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,binding}=require('./support/native-management-host');
async function fixture(t){
 const h=await setup(t);h.accounts[0].positions=[];h.accounts[0].cash=1000;h.accounts[0].equity=1000;
 const original=h.ctx.intent;let m=null,n=0;const tickets=[];
 h.ctx.intent=async(name,input)=>{
  if(name==='trading.config')return{orderTickets:true,strategyMandates:true};
  if(name==='trading.orders.mandate.prepare'){m={mandateId:'mandate-1',fingerprint:'review',status:'draft',accountMasked:'…1234',terms:{...input,maxDailyTurnoverCents:input.capitalCents*2},expiresAtMs:Date.parse('2026-11-25T16:00:00Z')};return structuredClone(m);}
  if(name==='trading.orders.mandate.activate'){m.status='active';return structuredClone(m);}
  if(name==='trading.orders.mandate.stop'){m.status='stopped';return structuredClone(m);}
  if(name==='trading.orders.mandate.status')return {...structuredClone(m),effectiveStatus:m.effectiveStatus||m.status};
  if(name==='trading.orders.list')return{orders:tickets.filter(t=>t.status==='submitted').map(t=>({...t.brokerStatus,orderId:t.orderId})),readAtMs:0};
  if(name==='trading.orders.refresh'||name==='trading.orders.tickets')return{tickets:structuredClone(tickets)};
  if(name==='trading.orders.balance')return{cashBudgetUsd:h.accounts[0].cash};
  if(name==='trading.orders.prepare'){
   if(input.side==='buy'){const exposure=h.accounts[0].positions.reduce((sum,p)=>sum+p.marketValue,0);assert.ok(exposure+input.quantity*input.limitCents/100<=m.terms.capitalCents/100,'Synthetic native capital guard: buy limits plus owned exposure must fit the mandate');}
   const old=tickets.find(t=>t.intentKey===input.intentKey);if(old)return structuredClone(old);
   const t={ticketId:'ticket-'+(tickets.length+1),fingerprint:'exact',intentKey:input.intentKey,mandateId:input.mandateId,cycle:input.cycle,status:'prepared',terms:{symbol:input.symbol,side:input.side,quantity:input.quantity,limitCents:input.limitCents}};tickets.push(t);return structuredClone(t);
  }
  if(name==='trading.orders.submit'){
   const t=tickets.find(t=>t.ticketId===input.ticketId);assert.equal(m.status,'active');if(t.status!=='prepared')return {...structuredClone(t),ordersSubmitted:0,submissionAttempted:false};n++;t.status='submitted';t.orderId=String(n);t.ordersSubmitted=1;t.submissionAttempted=true;t.brokerStatus={status:'WORKING',quantity:t.terms.quantity,filledQuantity:0,legs:[]};return structuredClone(t);
  }
  return original(name,input);
 };
 const watch=(await h.req('/watch',{runId:h.runId,confirm:true})).watch;
 const draft=await h.req('/live/mandate',{watchId:watch.id,capitalCents:90000});assert.ok(draft.mandate,JSON.stringify(draft));assert.equal(draft.mandate.status,'draft');
 const activate=()=>h.req('/live/activate',{watchId:watch.id,mandateId:'mandate-1',fingerprint:'review',confirm:true});
 const fill=()=>{const t=tickets.find(t=>t.brokerStatus?.status==='WORKING');assert.ok(t);t.brokerStatus.status='FILLED';t.brokerStatus.filledQuantity=t.terms.quantity;const price=t.terms.limitCents/100;h.accounts[0].cash-=t.terms.quantity*price;h.accounts[0].positions.push({symbol:t.terms.symbol,qty:t.terms.quantity,marketValue:t.terms.quantity*price});};
 return{...h,watch,activate,fill,tickets,count:()=>n,mandate:()=>m};
}
test('draft and forged approvals cannot trade; only the exact active account mandate dispatches',async t=>{
 const h=await fixture(t);assert.equal((await h.req('/watch/tick',{})).ordersSubmitted,0);assert.equal(h.count(),0);
 assert.equal((await h.req('/live/activate',{watchId:h.watch.id,mandateId:'mandate-1',fingerprint:'wrong',confirm:true})).error,'mandate_mismatch');
 assert.equal((await h.req('/live/activate',{watchId:h.watch.id,mandateId:'mandate-1',fingerprint:'review'})).status,428);
 assert.equal((await h.req('/live/activate',{watchId:h.watch.id,mandateId:'mandate-1',fingerprint:'review',confirm:true},'owner-b')).status,404);
 assert.equal((await h.activate()).mandate.status,'active');const fire=await h.req('/watch/tick',{});assert.equal(fire.ordersSubmitted,1,JSON.stringify(fire));assert.equal(h.count(),1);
 assert.equal((await h.req('/watch/tick',{})).ordersSubmitted,0);assert.equal(h.count(),1,'a working order blocks every following submission');
 assert.equal((await h.req('/watch',{runId:h.runId,confirm:true})).error,'live_mandate_active');
});
test('monthly cycle survives refreshes, waits for each actual fill, completes without daily rebalancing and stops without broker reads',async t=>{
 const h=await fixture(t);await h.activate();
 for(let i=0;i<8;i++){const result=await h.req('/watch/tick',{});assert.notEqual(result.receipts[0].status,'failed',JSON.stringify(result));if(result.ordersSubmitted)h.fill();if(result.receipts[0].status==='cycle-completed')break;}
 const n=h.count();assert.ok(n>0);assert.equal((await h.req('/watch/tick',{})).receipts[0].status,'cycle-completed');assert.equal(h.count(),n);
 h.setSourceFailure(true);const stopped=await h.req('/live/stop',{watchId:h.watch.id});assert.equal(stopped.watch.automatedTrading,false);assert.equal(h.mandate().status,'stopped');assert.equal(h.count(),n);
});
test('uncertain execution result is retained and never retried on a subsequent watcher pass',async t=>{
 const h=await fixture(t);await h.activate();await h.req('/watch/tick',{});h.tickets[0].status='unknown';h.tickets[0].orderId=null;h.tickets[0].brokerStatus={status:'CANCELED'};
 const result=await h.req('/watch/tick',{});assert.equal(result.receipts[0].status,'uncertain-order-review-required');assert.equal(h.count(),1);
 await h.req('/watch/stop',binding);assert.equal(h.mandate().status,'stopped');assert.equal((await h.req('/watch/tick',{})).checked,0);
});
test('account status and dispatch reject expired, changed, malformed or unavailable native authority',async t=>{
 const h=await fixture(t);await h.activate();
 for(const change of [
  {expiresAtMs:null,effectiveStatus:'active',expected:'expired'},
  {expiresAtMs:'2099-01-01',effectiveStatus:'active',expected:'expired'},
  {expiresAtMs:Date.parse('2026-10-26T16:00:00Z'),effectiveStatus:'active',expected:'expired'},
  {expiresAtMs:Date.parse('2026-11-25T16:00:00Z'),effectiveStatus:'source-changed',expected:'source-changed'},
 ]){
  Object.assign(h.mandate(),change);
  const data=await h.req('/management');assert.equal(data.watches[0].automatedTrading,true,'saved setting alone is not authority');
  assert.equal(data.watches[0].authority.active,false);assert.equal(data.watches[0].authority.status,change.expected);
  assert.equal((await h.req('/watch/tick',{})).receipts[0].status,'mandate-inactive');assert.equal(h.count(),0);
 }
 const original=h.ctx.intent;h.ctx.intent=async(name,input)=>{if(name==='trading.orders.mandate.status')throw Error('Synthetic native status outage');return original(name,input);};
 assert.equal((await h.req('/management')).watches[0].authority.status,'unavailable');assert.equal(h.count(),0);
});
test('a native release without effective status cannot silently enable automatic trading',async t=>{
 const h=await fixture(t),original=h.ctx.intent;
 h.ctx.intent=async(name,input)=>{const result=await original(name,input);if(name==='trading.orders.mandate.status')delete result.effectiveStatus;return result;};
 assert.equal((await h.activate()).error,'live_release_required');assert.equal(h.mandate().status,'draft');
 assert.equal((await h.req('/management')).watches[0].automatedTrading,false);assert.equal(h.count(),0);
});
test('allocation unknown outcomes remain unknown through account and aggregate watcher receipts',async t=>{
 const h=await fixture(t);await h.activate();const original=h.ctx.intent;
 h.ctx.intent=async(name,input)=>{
  if(name==='trading.orders.submit'){
   const ticket=h.tickets.find(t=>t.ticketId===input.ticketId);ticket.status='unknown';
   return{...structuredClone(ticket),ordersSubmitted:null,submissionAttempted:true};
  }
  return original(name,input);
 };
 const result=await h.req('/watch/tick',{});
 assert.equal(result.ordersSubmitted,null);assert.equal(result.receipts[0].ordersSubmitted,null);
 assert.equal(result.receipts[0].automation.ordersSubmitted,null);assert.equal(result.receipts[0].status,'order-result-uncertain');
 assert.equal((await h.req('/watch/tick',{})).receipts[0].status,'uncertain-order-review-required');assert.equal(h.count(),0);
});
test('broker receipts count confirmed new submissions, never durable replays or missing acknowledgments',()=>{
 const {submissionCount}=require('../routes/live/execution-state');
 assert.equal(submissionCount({status:'submitted',ordersSubmitted:1,submissionAttempted:true}),1);
 assert.equal(submissionCount({status:'submitted',ordersSubmitted:0,submissionAttempted:false}),0);
 assert.equal(submissionCount({status:'submitted',ordersSubmitted:1,submissionAttempted:false}),null);
 assert.equal(submissionCount({status:'submitted',ordersSubmitted:1}),null);
 assert.equal(submissionCount({status:'unknown',ordersSubmitted:0}),null);
 assert.equal(submissionCount({status:'attempting',ordersSubmitted:0}),null);
 assert.equal(submissionCount({status:'rejected',ordersSubmitted:0,submissionAttempted:true}),0);
});

test('gains above the cap trim holdings without inventing a negative cash balance or borrowing requirement',async()=>{
 const {executeMonthly}=require('../routes/live/automation'),{fingerprint}=require('../routes/trading-portfolio-store');
 const at=new Date('2026-10-26T16:00:00Z'),config={modelVersion:2,kind:'quarterly-rotation',assets:['SPY','EFA','IEF','GLD','VNQ','DBC'].map(symbol=>({symbol,weightPct:100/6})),lookbackSessions:63,rebalanceSessions:20,topN:3,grossExposurePct:100,transactionCostBps:10,marginAprPct:null,maintenancePct:null,fractionalShares:false};
 const account={accountId:'synthetic',connectionKey:'synthetic',kind:'live',broker:'schwab',accountType:'margin',equity:1200,cash:100,positions:[{symbol:'SPY',qty:10,marketValue:1100}],balanceFacts:{buyingPower:2000,debitBalance:null,maintenanceRequirement:0,cashAvailableForWithdrawal:100,cashAvailableForTrading:100}};
 const receipt={signal:{decisionAsOf:'2026-09-30',evidenceThrough:'2026-10-23',targets:[{symbol:'SPY',weightPct:100}]},workingOrders:[],proposal:{rows:['SPY','EFA','IEF','GLD','VNQ','DBC','BIL'].map(symbol=>({symbol,referencePrice:symbol==='SPY'?110:100,tradeAt:at.toISOString()}))},brokerFunding:{cashBudgetUsd:100}};
 const sent=[],host=async(_ctx,action,input)=>{if(action==='mandate.status')return{status:'active',effectiveStatus:'active',expiresAtMs:at.getTime()+86400000,terms:{capitalCents:90000,strategyFingerprint:fingerprint(config)}};if(action==='refresh')return{tickets:[]};if(action==='prepare'){sent.push(input);return{ticketId:'synthetic',fingerprint:'synthetic'};}if(action==='submit')return{status:'submitted',ordersSubmitted:1,submissionAttempted:true};throw Error(action);};
 const result=await executeMonthly({pool:{query:async()=>({rows:[]})}},'synthetic',{mandateId:'synthetic'},receipt,{host,boundStudy:async()=>({selected:{account,profile:{registration:'taxable'}},config}),clock:()=>at});
 assert.equal(result.status,'order-submitted',JSON.stringify(result));assert.equal(sent.length,1);assert.equal(sent[0].side,'sell');assert.equal(sent[0].quantity,2);
 assert.equal(account.cash,100,'the measured account snapshot remains unchanged');
});
