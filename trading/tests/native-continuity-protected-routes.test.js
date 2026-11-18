/** CHANGE LOG
 * SEQ: 1
 * AUTHOR: maintainer@emeraldcoastsystemsgroup.com
 * Exercise completed and unfinished buys plus native approval renewal after
 * event-dated synthetic protection fills through the real allocation routes.
 * SEQ: 2
 * AUTHOR: maintainer@emeraldcoastsystemsgroup.com
 * Keep candidate execution admission explicit and isolated to synthetic watches.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {continuityFixture:fixture}=require('./support/continuity-host');

async function tick(h){
 const result=await h.req('/watch/tick',{});
 assert.equal(result.status,200);assert.equal(result.receipts.length,1);
 assert.notEqual(result.receipts[0].status,'failed',JSON.stringify(result));
 return result.receipts[0];
}

function protectiveFill(h,symbol){
 const account=h.accounts[0],position=account.positions.find(p=>p.symbol===symbol);
 assert.ok(position);const quantity=position.qty,time='2026-10-26T15:59:30Z';
 const ticket={ticketId:'synthetic-protection',status:'submitted',allocationMandateId:h.mandate().mandateId,
  protectionMandateId:'synthetic-protection-authority',orderId:'synthetic-protection-order',
  terms:{symbol,side:'sell',quantity,orderType:'TRAILING_STOP'},
  brokerStatus:{status:'FILLED',quantity,filledQuantity:quantity,remainingQuantity:0,legs:[],
   closeTime:time,executions:[{quantity,time}]}};
 h.tickets.push(ticket);account.cash+=position.marketValue;
 account.positions=account.positions.filter(p=>p!==position);
 account.equity=account.cash+account.positions.reduce((sum,p)=>sum+p.marketValue,0);
 assert.equal(Object.hasOwn(ticket,'attemptedAtMs'),false,'Protection must use broker event dates.');
 return ticket;
}

test('a completed original buy remains completed after protection without review or an old-signal rebuy',async t=>{
 const h=await fixture(t);await h.activate();const first=await tick(h);
 const buy=h.tickets[0],goal=first.automation.plan.actions.find(a=>a.action==='buy');
 assert.equal(buy.terms.quantity,goal.changeQty);h.fill();
 protectiveFill(h,buy.terms.symbol);const count=h.count();
 for(let repeat=0;repeat<3;repeat++){
  const receipt=await tick(h);
  assert.equal(receipt.status,'cycle-completed');assert.equal(receipt.ordersSubmitted,0);
  assert.deepEqual(receipt.automation.deferred,[],'A completed buy is not unfinished merely because protection later sold it.');
  assert.equal(h.count(),count);assert.equal(h.accounts[0].positions.length,0);
 }
 assert.equal(h.tickets.filter(ticket=>ticket.terms.side==='buy').length,1);
});

test('protection blocks the genuine unfinished remainder of a partially completed original buy',async t=>{
 const h=await fixture(t,{whole:true,positions:[],cash:100000,equity:100000,capitalCents:9900000,balanceFacts:{buyingPower:200000}});
 await h.activate();const first=await tick(h),buy=h.tickets[0];
 const goal=first.automation.plan.actions.find(a=>a.action==='buy');
 assert.ok(goal.changeQty>buy.terms.quantity,'One filled bounded ticket must leave an original allocation remainder.');
 h.fill();protectiveFill(h,buy.terms.symbol);const count=h.count();
 for(let repeat=0;repeat<2;repeat++){
  const receipt=await tick(h);
  assert.equal(receipt.ordersSubmitted,0);assert.equal(receipt.status,'waiting-for-position-review');
  assert.ok(receipt.automation.deferred.some(item=>item.symbol===buy.terms.symbol&&item.blockers.some(b=>b.code==='protective_exit_requires_new_signal')));
  assert.equal(h.count(),count);assert.equal(h.accounts[0].positions.length,0);
 }
});

test('native approval fingerprint renewal preserves event-dated protection already included in new cycle baselines',async t=>{
 const h=await fixture(t);await h.activate();await tick(h);h.fill();
 const exit=protectiveFill(h,h.tickets[0].terms.symbol),count=h.count();
 assert.equal((await tick(h)).status,'cycle-completed');
 h.mandate().fingerprint='synthetic-renewed-approval';
 for(let repeat=0;repeat<2;repeat++){
  const receipt=await tick(h);
  assert.equal(receipt.ordersSubmitted,0);assert.equal(receipt.status,'waiting-for-position-review');
  assert.ok(receipt.automation.deferred.some(item=>item.symbol===exit.terms.symbol&&item.blockers.some(b=>b.code==='protective_exit_requires_new_signal')));
  assert.equal(h.count(),count);assert.equal(h.accounts[0].positions.length,0);
 }
 const cycle=[...h.records.values()].filter(row=>row.kind==='live-cycle').map(row=>JSON.parse(row.payload))
  .find(record=>record.key.includes(':synthetic-renewed-approval:'));
 assert.ok(cycle);assert.equal(cycle.fillBaselines[exit.ticketId],exit.brokerStatus.filledQuantity);
 assert.equal(cycle.cycle,'2026-09-30','Changing authority must not invent a newer market signal.');
});
