/** CHANGE LOG
 * AUTHOR: maintainer@emeraldcoastsystemsgroup.com
 * SEQ: 1
 * Prove protective event continuity through monthly and daily signals, renewed approvals and incomplete broker evidence.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {eventProtectedSymbols}=require('../routes/live/continuity/protection');
const MANDATE='synthetic-allocation';
function sale(time='2026-11-13T17:00:00Z'){
 return{ticketId:'synthetic-protection',allocationMandateId:MANDATE,mandateFingerprint:'old-approval',status:'submitted',
  terms:{symbol:'DBC',side:'sell',quantity:10,duration:'DAY'},
  brokerStatus:{status:'FILLED',filledQuantity:10,executions:[{quantity:10,time}]}};
}
const blocked=(ticket,signalDate)=>eventProtectedSymbols([ticket],MANDATE,signalDate).has('DBC');

test('a protective fill preceding cycle creation remains excluded from the old monthly signal',()=>{
 const ticket=sale();ticket.cycle='2026-10-30';ticket.fillBaseline=10;
 assert.equal(blocked(ticket,'2026-10-30'),true);
 assert.equal(blocked(ticket,'2026-11-30'),false);
});

test('the completed daily or monthly signal can include the same regular-session fill date',()=>{
 const ticket=sale();
 assert.equal(blocked(ticket,'2026-11-12'),true);
 assert.equal(blocked(ticket,'2026-11-13'),false);
 assert.equal(blocked(ticket,'2026-11-16'),false);
});

test('approval renewal and later observation timestamps do not reset or prolong an exclusion',()=>{
 const ticket=sale(),before=structuredClone(ticket);
 assert.equal(blocked(ticket,'2026-10-30'),true);
 ticket.mandateFingerprint='renewed-approval';ticket.lastObservedAtMs=Date.parse('2026-12-02T17:00:00Z');
 assert.equal(blocked(ticket,'2026-10-30'),true);
 assert.equal(blocked(ticket,'2026-11-30'),false);
 assert.deepEqual(before.brokerStatus,ticket.brokerStatus);
});

test('unrelated mandate/account tickets, allocation sales, purchases and unfilled orders do not exclude',()=>{
 const foreign=sale();foreign.accountId='another-account';foreign.allocationMandateId='another-allocation';
 const allocation=sale();delete allocation.allocationMandateId;
 const buy=sale();buy.terms.side='buy';
 const unfilled=sale();unfilled.brokerStatus.filledQuantity=0;
 assert.deepEqual([...eventProtectedSymbols([foreign,allocation,buy,unfilled],MANDATE,'2026-10-30')],[]);
 assert.deepEqual([...eventProtectedSymbols([sale()], 'another-allocation','2026-10-30')],[]);
});

test('all observed partial fills must be dated and the latest fill determines signal eligibility',()=>{
 const ticket=sale();ticket.brokerStatus={status:'PARTIALLY_FILLED',filledQuantity:6,executions:[
  {quantity:2,time:'2026-11-12T17:00:00Z'},{quantity:4,time:'2026-11-13T17:00:00Z'}]};
 assert.equal(blocked(ticket,'2026-11-12'),true);
 assert.equal(blocked(ticket,'2026-11-13'),false);
 ticket.brokerStatus.executions.reverse();assert.equal(blocked(ticket,'2026-11-13'),false);
});

test('missing or inconsistent execution coverage stays excluded without a verified terminal close',()=>{
 for(const executions of [[],[{quantity:4,time:'2026-11-13T17:00:00Z'}],
  [{quantity:10,time:'unknown'}],[{quantity:10,time:'2026-11-13'}],
  [{quantity:11,time:'2026-11-13T17:00:00Z'}],[{quantity:-1,time:'2026-11-13T17:00:00Z'}],
  [{quantity:10,time:'2026-11-13T17:00:00Z'},{quantity:10,time:'2026-11-13T17:00:00Z'}]]){
  const ticket=sale();ticket.brokerStatus.executions=executions;
  assert.equal(blocked(ticket,'2026-11-30'),true,JSON.stringify(executions));
 }
});

test('a terminal FILLED close conservatively bounds missing fills but an observation or submission does not',()=>{
 const ticket=sale();delete ticket.brokerStatus.executions;
 ticket.attemptedAtMs=Date.parse('2026-11-12T17:00:00Z');ticket.lastObservedAtMs=Date.parse('2026-11-13T18:00:00Z');
 assert.equal(blocked(ticket,'2026-11-30'),true);
 ticket.brokerStatus.closeTime='2026-11-13T18:00:00Z';
 assert.equal(blocked(ticket,'2026-11-12'),true);assert.equal(blocked(ticket,'2026-11-13'),false);
 ticket.brokerStatus.status='PARTIALLY_FILLED';assert.equal(blocked(ticket,'2026-11-30'),true);
});

test('a terminal close earlier than a known execution is contradictory even with complete coverage',()=>{
 for(const quantity of [4,10]){
  const ticket=sale();ticket.brokerStatus.executions=[{quantity,time:'2026-11-13T19:00:00Z'}];
  ticket.brokerStatus.closeTime='2026-11-13T18:00:00Z';assert.equal(blocked(ticket,'2026-11-30'),true);
 }
});

test('after-hours fills remain excluded until a signal closes after the event, including early closes',()=>{
 for(const [time,day,next,expected] of [
  ['2026-11-13T21:00:00Z','2026-11-13','2026-11-16',false],
  ['2026-11-13T21:00:01Z','2026-11-13','2026-11-16',true],
  ['2026-11-13T23:30:00-05:00','2026-11-13','2026-11-16',true],
  ['2026-11-27T18:00:00Z','2026-11-27','2026-11-30',false],
  ['2026-11-27T18:00:01Z','2026-11-27','2026-11-30',true]]){
  assert.equal(blocked(sale(time),day),expected,time);assert.equal(blocked(sale(time),next),false,time);
 }
});

test('invalid, non-session or unsupported signal dates never clear an exclusion',()=>{
 for(const signal of [undefined,'invalid','2026-02-30','2026-11-14','2028-01-03'])assert.equal(blocked(sale(),signal),true,String(signal));
});

test('symbol identity is canonical and repeat observations neither mutate evidence nor duplicate symbols',()=>{
 const ticket=sale();ticket.terms.symbol=' brk/b ';const before=structuredClone(ticket);
 assert.deepEqual([...eventProtectedSymbols([ticket,ticket],MANDATE,'2026-10-30')],['BRK.B']);
 assert.deepEqual(ticket,before);
});
