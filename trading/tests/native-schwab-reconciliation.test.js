/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the shipped exact-decimal planner over rejected twins, missing buys, partial fills, ambiguous account allocation and deterministic historical identities.
 */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planNativeReconciliation:plan}=require('../routes/trading-native-reconciliation');
function fixture(){
 const trade=(transactionId,orderId,side,qty,price,date)=>({transactionId,orderId,side,qty,price,fees:0.02,symbol:'ANET',tradeDate:date,activityAt:date});
 const transactions=[trade('buy-1','venue-buy','buy',20,100,'2026-08-01T14:00:00Z'),trade('sell-1','venue-close','sell',14,110,'2026-08-03T14:00:00Z')];
 const ledger={accountId:'opaque',accountBinding:'binding',status:'available',bookId:'book',orders:[{order_id:'engine-buy',book_id:'book',mode:'live',symbol:'ANET',side:'buy',status:'filled',filled_qty:20,filled_avg_price:100,broker_order_id:'venue-buy',created_at:'2026-08-01T14:00:00Z'},{order_id:'rejected-twin',book_id:'book',mode:'live',symbol:'ANET',side:'sell',status:'rejected',filled_qty:0,filled_avg_price:null,broker_order_id:'rejected-close',created_at:'2026-08-03T14:00:00Z'}]};
 const venue={accountId:'opaque',accountBinding:'binding',transactions,unsupported:[],positions:[{symbol:'ANET',qty:6}]};return{ledger,venue};
}
test('a missing venue close creates separate deterministic historical rows and preserves rejected twins',()=>{
 const{ledger,venue}=fixture(),before=structuredClone(ledger),p=plan(ledger,venue);assert.equal(p.status,'verified');assert.equal(p.corrections.length,1);
 const c=p.corrections[0];assert.equal(c.side,'sell');assert.equal(c.filled_qty,'14.000000000000');assert.equal(c.cost_basis,'100.000000000000');assert.equal(c.realized_pnl,'139.980000000000');assert.equal(c.created_at,'2026-08-03T14:00:00.000Z');assert.deepEqual(ledger,before);
 assert.deepEqual(plan(ledger,venue),p);
 ledger.orders.push({...c,broker_order_id:'venue-close'});assert.equal(plan(ledger,venue).corrections.length,0);
});
test('fractional lots, partial executions and fees retain exact quantity and FIFO basis',()=>{
 const{ledger,venue}=fixture();ledger.orders=ledger.orders.slice(0,1);ledger.orders[0].filled_qty='0.3';
 venue.transactions[0].qty='0.3';venue.transactions[1].qty='0.1';venue.transactions.push({...venue.transactions[1],transactionId:'sell-2',qty:'0.1'});venue.positions[0].qty='0.1';
 const p=plan(ledger,venue);assert.equal(p.corrections.length,2);assert.equal(p.corrections[0].cost_basis,'100.000000000000');
});
test('manual purchases and opening changes stay explicit review exceptions',()=>{
 for(const change of [f=>{f.venue.transactions.push({...f.venue.transactions[0],transactionId:'manual',orderId:'manual',qty:1});f.venue.positions[0].qty=7;},f=>{f.venue.positions[0].qty=8;},f=>{f.venue.positions[0].qty=-1;}]){
  const f=fixture();change(f);const p=plan(f.ledger,f.venue);assert.equal(p.status,'review-required');assert.equal(p.corrections.length,0);assert.ok(p.symbols[0].reason);
 }
});
test('account and book confusion, unsupported records and invalid numeric evidence refuse',()=>{
 for(const change of [f=>{f.venue.accountBinding='foreign';},f=>{f.venue.accountId='foreign';},f=>{f.ledger.orders[0].book_id='other';},f=>{f.venue.unsupported.push({activityId:'unknown'});}]){const f=fixture();change(f);assert.throws(()=>plan(f.ledger,f.venue));}
 for(const invalid of [NaN,Infinity,'oops',null]){const f=fixture();f.venue.transactions[0].qty=invalid;assert.equal(plan(f.ledger,f.venue).corrections.length,0);}
});
test('duplicate execution conflicts and ambiguous fallback matches do not create closes',()=>{
 const f=fixture();f.venue.transactions.push({...f.venue.transactions[1],qty:13});assert.equal(plan(f.ledger,f.venue).symbols[0].action,'refuse');
 const g=fixture();g.ledger.orders[0].broker_order_id='clobbered';g.venue.transactions.push({...g.venue.transactions[0],transactionId:'another-buy',orderId:'another-buy'});g.venue.positions[0].qty=26;assert.equal(plan(g.ledger,g.venue).corrections.length,0);
});
test('fingerprints ignore response order and mark accounts without engine history separately',()=>{
 const f=fixture(),a=plan(f.ledger,f.venue);f.ledger.orders.reverse();f.venue.transactions.reverse();assert.equal(plan(f.ledger,f.venue).fingerprint,a.fingerprint);
 f.ledger.status='no-ledger';f.ledger.bookId=null;f.ledger.orders=[];assert.equal(plan(f.ledger,f.venue).status,'no-ledger');
});
test('date-only venue trade dates preserve original provenance and use same-session activity time',()=>{
 const f=fixture();f.venue.transactions[1].tradeDate='2026-08-03T04:00:00Z';const c=plan(f.ledger,f.venue).corrections[0];assert.equal(c.created_at,'2026-08-03T14:00:00.000Z');assert.equal(c.venue_trade_date,'2026-08-03T04:00:00Z');
});
