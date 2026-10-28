/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Shipped native monitor/order routes over synthetic account/history/SQL boundaries: exact study ownership, failure receipts, no scheduled submissions, and separate exact live confirmation. No real brokerage I/O.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,binding}=require('./support/native-management-host');
test('monitor activation needs the exact owned completed model and never activates trading',async t=>{
 const h=await setup(t);
 assert.equal((await h.req('/watch',{runId:h.runId})).status,428);
 assert.equal((await h.req('/watch',{runId:h.runId,confirm:true,subject:'foreign'})).status,400);
 assert.equal((await h.req('/watch',{runId:h.runId,confirm:true},'owner-b')).status,404);
 const saved=await h.req('/watch',{runId:h.runId,confirm:true});assert.equal(saved.watch.enabled,true);assert.equal(saved.watch.automatedTrading,false);assert.equal(saved.requiresScheduleActivation,true);
 const data=await h.req('/management');assert.equal(data.watches.length,1);assert.equal(data.execution.automatedTrading,false);assert.equal((await h.req('/management',undefined,'owner-b')).watches.length,0);assert.equal(h.submitted(),0);
 await h.req('/profiles',{...binding,label:'Synthetic account',registration:'taxable',strategyId:null});assert.equal((await h.req('/watch',{runId:h.runId,confirm:true})).error,'strategy_assignment_changed');
});
test('monitor records real failures and never calls a broker submit from its tick',async t=>{
 const h=await setup(t);await h.req('/watch',{runId:h.runId,confirm:true});
 const tick=await h.req('/watch/tick',{});assert.equal(tick.checked,1);assert.equal(tick.ordersSubmitted,0);assert.notEqual(tick.receipts[0].status,'failed');
 assert.equal((await h.req('/management')).watches[0].lastRunAt,'2026-10-26T16:00:00.000Z');assert.equal(h.submitted(),0);
 h.failOrders();const failed=await h.req('/watch/tick',{});assert.equal(failed.receipts[0].status,'failed');assert.ok((await h.req('/management')).watches[0].lastError);assert.equal(h.submitted(),0);
 await h.req('/watch/stop',binding);assert.equal((await h.req('/watch/tick',{})).checked,0);
});
test('exact live ticket is bound to monitored study and separate confirmation; forged and stale actions refuse',async t=>{
 const h=await setup(t);const watch=(await h.req('/watch',{runId:h.runId,confirm:true})).watch;
 assert.equal((await h.req('/live/ticket',{watchId:watch.id,symbol:'BIL',limitCents:10000})).error,'watch_stale');
 const tick=await h.req('/watch/tick',{});const receipt=tick.receipts[0];assert.notEqual(receipt.status,'failed');
 const action=receipt.proposal.actions.find(x=>x.action==='buy');assert.ok(action);assert.equal(receipt.proposal.blockers.length,0,JSON.stringify(receipt.proposal.blockers));
 assert.equal((await h.req('/live/ticket',{watchId:watch.id,symbol:'OTHER',limitCents:10000})).error,'strategy_action_missing');
 const prepared=await h.req('/live/ticket',{watchId:watch.id,symbol:action.symbol,limitCents:10000});assert.equal(prepared.ticket.status,'prepared');assert.equal(h.submitted(),0);
 assert.equal((await h.req('/live/submit',{watchId:watch.id,ticketId:'ticket-1',fingerprint:'exact-ticket'})).status,428);
 assert.equal((await h.req('/live/submit',{watchId:watch.id,ticketId:'ticket-1',fingerprint:'forged',confirm:true})).error,'live_ticket_mismatch');
 const submitted=await h.req('/live/submit',{watchId:watch.id,ticketId:'ticket-1',fingerprint:'exact-ticket',confirm:true});assert.equal(submitted.ticket.status,'submitted');assert.equal(h.submitted(),1);
 await h.req('/watch/stop',binding);assert.equal((await h.req('/live/submit',{watchId:watch.id,ticketId:'ticket-1',fingerprint:'exact-ticket',confirm:true})).error,'watch_off');assert.equal(h.submitted(),1);
 assert.equal((await h.req('/live/cancel',{watchId:watch.id,ticketId:'ticket-1',orderId:'12345',fingerprint:'exact-ticket'})).status,428);
 const canceled=await h.req('/live/cancel',{watchId:watch.id,ticketId:'ticket-1',orderId:'12345',fingerprint:'exact-ticket',confirm:true});assert.equal(canceled.ticket.cancelStatus,'requested');assert.equal(h.canceled(),1,'cancellation remains available while the monitor is stopped');
});

test('monthly monitoring ignores prices after its decision cutoff while preserving fresh assessments and relevant-history refusals',async t=>{
 const h=await setup(t),original=h.ctx.intent;await h.req('/watch',{runId:h.runId,confirm:true});let relevantConflict=false;
 h.ctx.intent=async(name,input)=>{
  const r=await original(name,input);if(name!=='trading.bars')return r;
  const date=relevantConflict?'2026-09-30':'2026-10-23';
  return{...r,bars:[...r.bars,{t:Date.parse(date+'T04:00:00Z')/1000,c:100},{t:Date.parse(date+'T05:00:00Z')/1000,c:101}]};
 };
 const checked=await h.req('/watch/tick',{}),receipt=checked.receipts[0];assert.notEqual(receipt.status,'failed',JSON.stringify(receipt));
 assert.equal(receipt.signal.decisionAsOf,'2026-09-30');assert.equal(receipt.signal.evidenceThrough,'2026-09-30');assert.equal(receipt.signal.signalAsOf,'2026-10-23');assert.equal(receipt.proposal.signalAsOf,'2026-10-23');
 assert.equal(checked.ordersSubmitted,0);assert.equal(h.submitted(),0);assert.equal(h.canceled(),0);
 relevantConflict=true;h.setNow('2026-10-27T16:00:00Z');
 const failed=await h.req('/watch/tick',{});assert.equal(failed.receipts[0].status,'failed');assert.match(failed.receipts[0].message,/history changed/);
 assert.equal(h.submitted(),0);assert.equal(h.canceled(),0);
});
