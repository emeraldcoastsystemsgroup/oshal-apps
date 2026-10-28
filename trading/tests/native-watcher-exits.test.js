/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the actual saved watcher trigger, partial-fill, restart and duplicate guards with synthetic brokerage data.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {advanceBackstop}=require('../routes/live/backstop-model');
const {watcherExitPlan,exitWitness}=require('../routes/live/watcher-exits');
const {protectionFixture}=require('./support/native-protection-host');
const config={modelVersion:2,trailPct:5,transactionCostBps:25,reentry:'none'};
const at=new Date('2026-10-26T22:00:00Z');
const q=(bid,time=at.toISOString())=>({symbol:'ABC',source:'schwab',delayed:false,bidPrice:bid,askPrice:bid+.01,bidSize:10,quoteAt:time,tradePrice:100,tradeAt:'2026-10-26T20:00:00Z'});
function crossing(){return advanceBackstop(advanceBackstop(null,{price:100,quantity:10,observedAt:'2026-10-26T21:59:00Z'},config),{price:94,quantity:10,observedAt:at.toISOString()},config);}
function plan({state=crossing(),tickets=[],orders=[],quote=q(94),qty=10}={}){
 return watcherExitPlan({positions:[{symbol:'ABC',qty}]},orders,tickets,{rows:[{symbol:'ABC',status:state.status,state,fractionalResidual:0}]},{protectionMandateId:'p',mandate:{activatedAtMs:Date.parse('2026-10-26T21:00:00Z')}},[quote],at);
}
test('the existing ratchet records one crossing and retains its floor, witness and quantity through rebound/restart',()=>{
 const state=crossing();assert.equal(state.stop,95);assert.equal(state.triggered,true);assert.equal(state.triggerPrice,94);
 const restarted=JSON.parse(JSON.stringify(state)),rebound=advanceBackstop(restarted,{price:101,quantity:10,observedAt:'2026-10-26T22:01:00Z'},config);
 assert.equal(rebound.triggeredAt,state.triggeredAt);assert.equal(rebound.triggerStop,95);assert.equal(rebound.triggerQuantity,10);assert.ok(rebound.stop>=state.stop);
 assert.deepEqual(exitWitness(rebound),exitWitness(state));
 const above=advanceBackstop(null,{price:100,quantity:10,observedAt:'2026-10-26T21:59:00Z'},config);assert.equal(plan({state:above}).actions.length,0);
 assert.equal(plan().actions[0].quantity,10);assert.ok(plan().actions[0].limitCents<9400);
});
test('stale/wide quotes, uncertainty and reserved shares cannot create watcher exits',()=>{
 assert.equal(plan({quote:q(94,'2026-10-26T21:58:00Z')}).actions.length,0);
 assert.equal(plan({quote:{...q(94),askPrice:100}}).actions.length,0);
 assert.equal(plan({tickets:[{status:'unknown'}]}).actions.length,0);
 assert.equal(plan({orders:[{orderId:'manual',status:'WORKING',remainingQuantity:10,legs:[{symbol:'ABC',instruction:'SELL'}]}]}).actions.length,0);
});
test('partial fills reconcile against the original crossing; a stale limit may be cancelled without resetting its floor',()=>{
 const action=plan().actions[0],ticket={protectionMandateId:'p',ticketId:'t',intentKey:action.intentKey,status:'submitted',attemptedAtMs:at.getTime()-120000,terms:{...action,orderType:'LIMIT',session:'SEAMLESS',side:'sell',limitCents:10000},orderId:'123',brokerStatus:{status:'WORKING',filledQuantity:3,remainingQuantity:7}};
 assert.equal(plan({tickets:[ticket],qty:7}).actions[0].kind,'cancel');
 ticket.cancelStatus='requested';assert.equal(plan({tickets:[ticket],qty:7}).actions.length,0);
 ticket.brokerStatus.status='CANCELED';ticket.brokerStatus.remainingQuantity=0;
 const next=plan({tickets:[ticket],qty:7}).actions[0];assert.equal(next.quantity,7);assert.deepEqual(next.exitTrigger,action.exitTrigger);
 assert.equal(plan({tickets:[ticket],qty:10}).actions.length,0,'broker position lag cannot authorize a duplicate sale');
});
test('actual owner watcher routes submit a triggered limit after hours and do not repeat it',async t=>{
 const h=await protectionFixture(t,{watcher:true});h.accounts[0].positions=[{symbol:'ABC',qty:10,marketValue:1000}];
 assert.equal((await h.activate()).policy.automatedWatcherExits,true);
 const set=(time,bid)=>{h.setNow(time);h.setQuote('ABC',q(bid,time));};
 set('2026-10-26T21:59:00Z',100);await h.req('/watch/tick',{});assert.equal(h.effects.length,0);
 set('2026-10-26T22:00:00Z',89);const result=await h.req('/watch/tick',{});
 assert.equal(result.ordersSubmitted,1,JSON.stringify(result));assert.equal(h.effects.length,1);assert.equal(h.tickets[0].terms.orderType,'LIMIT');assert.equal(h.tickets[0].terms.session,'SEAMLESS');
 await h.req('/watch/tick',{});assert.equal(h.effects.length,1,'a working exit must not repeat');
 const saved=await h.req('/backstops');assert.equal(saved.accounts[0].rows[0].state.triggerStop,90);assert.equal(saved.accounts[0].rows[0].priceBasis,'bid');
});
test('a lost watcher-exit acknowledgement stays uncertain across later checks and never retries',async t=>{
 const h=await protectionFixture(t,{watcher:true});h.accounts[0].positions=[{symbol:'ABC',qty:10,marketValue:1000}];await h.activate();
 h.setNow('2026-10-26T21:59:00Z');h.setQuote('ABC',q(100,'2026-10-26T21:59:00Z'));await h.req('/watch/tick',{});
 h.setNow('2026-10-26T22:00:00Z');h.setQuote('ABC',q(89));h.setSubmitMode('throw');
 const first=await h.req('/watch/tick',{});assert.equal(first.ordersSubmitted,null);assert.equal(h.effects.length,1);
 await h.req('/watch/tick',{});assert.equal(h.effects.length,1);assert.equal(h.tickets[0].status,'unknown');
});
test('scheduled minute checks run the guard without advancing the monthly allocation on intermediate minutes',async t=>{
 const h=await protectionFixture(t,{watcher:true});await h.activate();h.setNow('2026-10-26T22:01:00Z');h.setQuote('ABC',q(100,'2026-10-26T22:01:00Z'));
 const response=await fetch(h.base+'/api/trading/portfolio/watch/tick',{method:'POST',headers:{'Content-Type':'application/json','x-oshal-trigger':'schedule'},body:'{}'}),result=await response.json();
 assert.equal(response.status,200);assert.equal(result.receipts[0].status,'watching');assert.equal(h.effects.length,0);
 const watch=(await h.req('/management')).watches[0];assert.equal(watch.lastReceipt,null);assert.equal(watch.lastGuardAt,'2026-10-26T22:01:00.000Z');assert.equal(watch.lastProtectionCheck.authorityActive,true);
});
test('an unexplained quantity change retains the existing review guard and cannot turn a split-like adjustment into an exit',async t=>{
 const h=await protectionFixture(t,{watcher:true});h.accounts[0].positions=[{symbol:'ABC',qty:10,marketValue:1000}];await h.activate();
 h.setNow('2026-10-26T21:59:00Z');h.setQuote('ABC',q(100,'2026-10-26T21:59:00Z'));await h.req('/watch/tick',{});
 h.accounts[0].positions=[{symbol:'ABC',qty:20,marketValue:1000}];h.setNow('2026-10-26T22:00:00Z');h.setQuote('ABC',q(50));await h.req('/watch/tick',{});
 assert.equal(h.effects.length,0);const row=(await h.req('/backstops')).accounts[0].rows[0];assert.equal(row.status,'review-required');assert.equal(row.state.stop,90);
});
test('a reconciled native allocation fill resizes the watched quantity while retaining its peak and floor',async t=>{
 const h=await protectionFixture(t,{watcher:true});h.accounts[0].positions=[{symbol:'ABC',qty:10,marketValue:1000}];await h.activate();
 h.setNow('2026-10-26T21:59:00Z');h.setQuote('ABC',q(100,'2026-10-26T21:59:00Z'));await h.req('/watch/tick',{});
 h.tickets.push({ticketId:'allocation-fill',connection:'owned-login',accountId:'a',orderId:'500',status:'submitted',terms:{symbol:'ABC',side:'sell'},brokerStatus:{orderId:'500',status:'FILLED',filledQuantity:3,remainingQuantity:0,executions:[{quantity:3,time:'2026-10-26T22:00:00Z'}]}});
 h.accounts[0].positions=[{symbol:'ABC',qty:7,marketValue:665}];h.setNow('2026-10-26T22:00:00Z');h.setQuote('ABC',q(95));await h.req('/watch/tick',{});
 const row=(await h.req('/backstops')).accounts[0].rows[0];assert.equal(row.status,'model-watching');assert.equal(row.state.quantity,7);assert.equal(row.state.peak,100);assert.equal(row.state.stop,90);assert.equal(h.effects.length,0);
});
