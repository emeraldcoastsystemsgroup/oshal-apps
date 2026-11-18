/** CHANGE LOG
 * SEQ: 1
 * AUTHOR: maintainer@emeraldcoastsystemsgroup.com
 * Synthetic real-route regressions for loss-adjusted residuals, bounded cash,
 * completed-cycle stability and retained broker commitments. No real orders.
 * SEQ: 2
 * AUTHOR: maintainer@emeraldcoastsystemsgroup.com
 * Retain an oversized never-submitted draft without rewriting its native terms.
 * SEQ: 3
 * AUTHOR: maintainer@emeraldcoastsystemsgroup.com
 * Run candidate continuity only through explicitly adopted synthetic watches.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {continuityFixture:fixture}=require('./support/continuity-host');

async function tick(h){
 const result=await h.req('/watch/tick',{});
 assert.equal(result.status,200);
 assert.equal(result.receipts.length,1);
 assert.notEqual(result.receipts[0].status,'failed',JSON.stringify(result));
 return result.receipts[0];
}

async function complete(h){
 for(let pass=0;pass<12;pass++){
  const receipt=await tick(h);
  if(receipt.ordersSubmitted)h.fill();
  if(receipt.status==='cycle-completed')return receipt;
 }
 assert.fail('The synthetic allocation did not complete within twelve reconciled passes.');
}

function mark(h,symbol,price){
 const account=h.accounts[0],position=account.positions.find(p=>p.symbol===symbol);
 assert.ok(position,'The synthetic holding must exist before marking it.');
 position.marketValue=position.qty*price;
 account.equity=account.cash+account.positions.reduce((sum,p)=>sum+p.marketValue,0);
 h.setQuote(symbol,{tradePrice:price,tradeAt:'2026-10-26T16:00:00Z'});
}

test('a $5,000 mid-cycle loss resizes the remaining buy without changing the approved cap',async t=>{
 const h=await fixture(t,{whole:true,positions:[{symbol:'ABC',qty:1000,marketValue:100000,unmanaged:true}],
  cash:0,equity:100000,capitalCents:9900000,balanceFacts:{buyingPower:200000}});
 await h.activate();const initial=await tick(h);
 assert.equal(initial.automation.plan.actions.find(a=>a.action==='buy').changeQty,987);
 assert.equal(h.tickets.at(-1).terms.quantity,500);h.fill();
 const beforeLoss=h.accounts[0].equity;mark(h,'ABC',90);
 assert.equal(beforeLoss-h.accounts[0].equity,5000);
 assert.equal((await tick(h)).ordersSubmitted,1);h.fill();
 assert.equal((await tick(h)).ordersSubmitted,1);h.fill();
 const cash=h.accounts[0].cash,receipt=await tick(h);
 assert.equal(receipt.proposal.actions.find(a=>a.action==='buy').changeQty,448);
 assert.deepEqual(receipt.proposal.blockers,[]);
 assert.equal(receipt.status,'order-submitted','A fresh affordable target must replace the unaffordable old remainder.');
 const order=h.tickets.at(-1).terms;
 assert.equal(order.symbol,'BIL');assert.equal(order.side,'buy');assert.equal(order.quantity,448);
 assert.ok(order.quantity*order.limitCents/100+1<=cash);
 assert.equal(h.mandate().status,'active');assert.equal(h.mandate().terms.capitalCents,9900000);
 h.fill();await complete(h);
 const count=h.count();assert.equal((await tick(h)).ordersSubmitted,0);assert.equal(h.count(),count);
 assert.ok(h.accounts[0].cash>=0);
});

test('a verified cash shortfall submits a smaller valid chunk and resumes after funding is available',async t=>{
 const h=await fixture(t,{whole:true,positions:[{symbol:'ABC',qty:10,marketValue:1000}],cash:0,equity:1000,capitalCents:90000});
 await h.activate();assert.equal((await tick(h)).ordersSubmitted,1);h.fill();
 const original=h.ctx.intent;let available=250;
 h.ctx.intent=async(name,input)=>name==='trading.orders.balance'
  ?{cashBudgetUsd:Math.min(h.accounts[0].cash,available)}:original(name,input);
 const receipt=await tick(h);
 assert.equal(receipt.status,'order-submitted','Available cash should bound a new chunk, not strand the whole goal.');
 const order=h.tickets.at(-1).terms;
 assert.equal(order.side,'buy');assert.equal(order.quantity,2);
 assert.ok(order.quantity*order.limitCents/100+1<=available);
 assert.equal(h.mandate().terms.capitalCents,90000);h.fill();
 available=Infinity;await complete(h);
 assert.ok(h.accounts[0].cash>=0);
 assert.equal(new Set(h.tickets.map(t=>t.intentKey)).size,h.tickets.length);
});

test('a completed signal stays completed through later price gains and losses',async t=>{
 const h=await fixture(t);await h.activate();const completed=await complete(h),count=h.count();
 const terms=h.tickets.map(t=>structuredClone(t.terms));
 for(const price of [150,50,120]){
  mark(h,'BIL',price);
  for(let repeat=0;repeat<2;repeat++){
   const receipt=await tick(h);
   assert.equal(receipt.status,'cycle-completed');assert.equal(receipt.ordersSubmitted,0);
   assert.equal(receipt.automation.cycle,completed.automation.cycle);
   assert.equal(h.count(),count,'Price changes alone cannot reopen a completed signal.');
  }
 }
 assert.deepEqual(h.tickets.map(t=>t.terms),terms);
});

for(const state of ['working','partially filled','unknown'])test(state+' commitments survive repeated residual checks without duplicate submission',async t=>{
 const h=await fixture(t);await h.activate();assert.equal((await tick(h)).ordersSubmitted,1);
 if(state==='partially filled')h.fill(1);
 if(state==='unknown'){h.tickets[0].status='unknown';h.tickets[0].orderId=null;}
 const terms=structuredClone(h.tickets[0].terms),count=h.count();
 for(let repeat=0;repeat<3;repeat++){
  const receipt=await tick(h);
  assert.equal(receipt.status,state==='unknown'?'uncertain-order-review-required':'waiting-for-broker-order');
  assert.equal(receipt.ordersSubmitted,0);assert.equal(h.count(),count);
  assert.equal(h.tickets.length,1);assert.deepEqual(h.tickets[0].terms,terms);
 }
});

test('an oversized expired draft requires review without rewriting quantity or creating another intent',async t=>{
 const h=await fixture(t);await h.activate();
 const original=h.ctx.intent;let prepares=0,submits=0;
 h.ctx.intent=async(name,input)=>{
  if(name==='trading.orders.prepare'){
   prepares++;const old=h.tickets.find(ticket=>ticket.intentKey===input.intentKey);
   if(old)for(const field of ['symbol','side','quantity','limitCents'])assert.equal(input[field],old.terms[field],'Native preparation keeps exact terms even after expiry.');
   await original(name,input);const kept=h.tickets.find(ticket=>ticket.intentKey===input.intentKey);
   kept.expiresAtMs=Date.parse('2026-10-26T15:59:00Z');return structuredClone(kept);
  }
  if(name==='trading.orders.submit'){
   submits++;return{...structuredClone(h.tickets.find(ticket=>ticket.ticketId===input.ticketId)),ordersSubmitted:0,submissionAttempted:false};
  }
  return original(name,input);
 };
 await tick(h);assert.equal(h.tickets.length,1);assert.equal(h.tickets[0].status,'prepared');
 const kept=structuredClone(h.tickets[0]);assert.equal(h.count(),0);
 h.accounts[0].cash=500;h.accounts[0].equity=500;
 for(let repeat=0;repeat<2;repeat++){
  const receipt=await tick(h);
  assert.ok(receipt.proposal.actions.find(action=>action.action==='buy').changeQty<kept.terms.quantity);
  assert.equal(receipt.status,'prepared-chunk-review-required');assert.equal(receipt.ordersSubmitted,0);
  assert.equal(prepares,1);assert.equal(submits,1);assert.equal(h.count(),0);
  assert.deepEqual(h.tickets,[kept],'An expired draft remains the exact retained intent, never a smaller replacement.');
 }
});
