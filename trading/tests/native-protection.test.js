/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Synthetic broker protection approval, coverage, reservation, reconciliation, restart, expiry and unknown-outcome regressions through shipped models/routes.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {nextProtectiveAction,allocationBlockingOrders}=require('../routes/live/protective-execution');
const {backstopPolicy,simulateBackstop}=require('../routes/live/backstop-model');
const {protectionFixture,config}=require('./support/native-protection-host');
const {binding}=require('./support/native-management-host');
const now=new Date('2026-10-26T16:00:00Z'),policy={config,protectionMandateId:'p'};
const account={...binding,positions:[{symbol:'ABC',qty:10,marketValue:1000}]};
const quotes=[{symbol:'ABC',tradePrice:100,tradeAt:now.toISOString(),source:'schwab',delayed:false}];
const order={orderId:'123',status:'WORKING',orderType:'TRAILING_STOP',remainingQuantity:10,filledQuantity:0,quantity:10,duration:'GOOD_TILL_CANCEL',session:'NORMAL',stopPriceLinkBasis:'LAST',stopPriceLinkType:'PERCENT',stopPriceOffset:10,legs:[{symbol:'ABC',instruction:'SELL',quantity:10}]};
function action(a=account,orders=[],tickets=[],q=quotes){return nextProtectiveAction(a,orders,tickets,policy,q,now);}
test('sell-only research exits to cash and never silently reenters the original breakout model',()=>{
 const rows=Array.from({length:160},(_,i)=>({date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),open:i<70?100:80+i,high:i<70?101:81+i,low:i===51?80:i<70?99:79+i,close:i<70?100:80+i}));
 const r=simulateBackstop(rows,config,{startDate:rows[50].date,endDate:rows.at(-1).date});
 assert.equal(r.trades.length,2);assert.equal(r.trades[1].side,'sell');assert.equal(r.curve.at(-1).qty,0);
 assert.throws(()=>backstopPolicy({...config,reentry:'breakout'}));assert.throws(()=>backstopPolicy({...config,modelVersion:1}));
});
test('protection covers uncovered whole shares, reserves partial fills and leaves fractions visible',()=>{
 assert.equal(action().actions[0].quantity,10);assert.equal(action(account,[order]).actions.length,0);
 const partial={...order,filledQuantity:3,remainingQuantity:7};assert.equal(action({...account,positions:[{symbol:'ABC',qty:7}]},[partial]).actions.length,0);
 const r=action({...account,positions:[{symbol:'ABC',qty:10.25}]});assert.equal(r.actions[0].quantity,10);assert.equal(r.exceptions[0].fractionalResidual,.25);
 const limit=action(account,[{...order,orderType:'LIMIT'}]);assert.equal(limit.actions.length,0);assert.match(limit.exceptions[0].reason,/not verified protective/);
 assert.match(action(account,[{...order,remainingQuantity:11}]).exceptions[0].reason,/exceed/);
});
test('uncertain attempts, stale quotes, complex orders and canceled floors never permit silent replacement',()=>{
 assert.throws(()=>action(account,[],[{status:'unknown'}]),/uncertain/);
 assert.equal(action(account,[],[],[{...quotes[0],delayed:true}]).actions.length,0);
 assert.equal(action(account,[],[],[{...quotes[0],tradeAt:'2026-10-26T15:00:00Z'}]).actions.length,0);
 assert.equal(action(account,[{...order,legs:[]}]).actions.length,0);
 const old={protectionMandateId:'p',terms:{symbol:'ABC'},brokerStatus:{status:'CANCELED'}};
 assert.equal(action(account,[],[old]).actions.length,0);assert.match(action(account,[],[old]).exceptions[0].reason,/previous ratcheted stop/);
});
test('missing order-list entries use native refreshed status; prepared references and chunk intents remain stable',()=>{
 const t={orderId:'123',brokerStatus:order,protectionMandateId:'p',terms:{symbol:'ABC'}};
 assert.equal(action(account,[],[t]).actions.length,0);
 const a=action().actions[0],prepared={...a,status:'prepared',expiresAtMs:now.getTime()+120000,protectionMandateId:'p',terms:{symbol:'ABC',referenceCents:10000}};
 assert.equal(action(account,[],[prepared],[{...quotes[0],tradePrice:101}]).actions[0].referenceCents,10000);
 const expired={...prepared,expiresAtMs:now.getTime()};
 assert.equal(action(account,[],[expired],[{...quotes[0],tradePrice:101}]).actions[0].referenceCents,10100,'expired unattempted drafts request native revalidation at the fresh price');
 const large={...account,positions:[{symbol:'ABC',qty:6000}]},first=action(large).actions[0],second=action(large,[{...order,quantity:2500,remainingQuantity:2500,legs:[{symbol:'ABC',instruction:'SELL',quantity:2500}]}]).actions[0];
 assert.equal(first.quantity,2500);assert.equal(second.quantity,2500);assert.notEqual(first.intentKey,second.intentKey);
});
test('only exact native protective acknowledgements coexist with allocation; manual, modified or changing orders block it',()=>{
 const t={connection:binding.connectionKey,accountId:binding.accountId,orderId:'123',status:'submitted',protectionMandateId:'p',terms:{symbol:'ABC',side:'sell',orderType:'TRAILING_STOP',quantity:10,trailBps:1000}};
 assert.equal(allocationBlockingOrders([order],[t],account).length,0);
 for(const altered of [{...order,stopPriceOffset:9},{...order,status:'PENDING_CANCEL'},{...order,remainingQuantity:9},{...order,duration:'DAY'}])assert.equal(allocationBlockingOrders([altered],[t],account).length,1);
 assert.equal(allocationBlockingOrders([order],[],account).length,1);assert.equal(allocationBlockingOrders([order],[{...t,accountId:'foreign'}],account).length,1);
});
test('actual owner review binds matching exit-only research and fails closed until the verified native feature exists',async t=>{
 const h=await protectionFixture(t);assert.equal((await h.review()).error,'protection_not_enrolled');await h.enroll();
 const s=await h.study();assert.ok(s.run.candidates.every(c=>c.config.modelVersion===2&&c.config.reentry==='none'));
 h.setAvailable(false);assert.equal((await h.req('/backstops/review',{...binding,researchRunId:s.run.id})).status,503);h.setAvailable(true);
 const review=await h.req('/backstops/review',{...binding,researchRunId:s.run.id});assert.equal(review.review.mandate.status,'draft');
 assert.deepEqual(review.review.research.candidate,s.run.candidates.find(c=>c.config.trailPct===config.trailPct));
 assert.deepEqual(review.review.research.trainingWindow,s.run.trainingWindow);assert.deepEqual(review.review.research.laterWindow,s.run.laterWindow);
 assert.equal(review.review.research.trainingSelected,s.run.selectedConfig?.trailPct===config.trailPct);
 const b={...binding,reviewId:review.review.id,fingerprint:review.review.mandate.fingerprint,confirm:true};
 assert.equal((await h.req('/backstops/activate',{...b,confirm:false})).status,428);
 assert.equal((await h.req('/backstops/activate',{...b,fingerprint:'forged'})).error,'protection_review_changed');
 assert.equal((await h.req('/backstops/activate',b,'owner-b')).status,404);assert.equal(h.effects.length,0);
 assert.equal((await h.req('/backstops/activate',b)).policy.automatedBrokerProtection,true);assert.equal(h.effects.length,0,'activation is not an order');
});
test('the actual watcher protects independently of allocation blockers and never repeats a working stop, including list lag',async t=>{
 const h=await protectionFixture(t);await h.activate();h.setListLag(true);
 const first=await h.req('/watch/tick',{});assert.equal(first.ordersSubmitted,1,JSON.stringify(first));assert.equal(h.effects.length,1);
 const next=await h.req('/watch/tick',{});assert.equal(next.ordersSubmitted,0);assert.equal(h.effects.length,1);
 const data=await h.req('/backstops');assert.equal(data.policies[0].nativeStatus.effectiveStatus,'active');assert.equal(data.policies[0].nativeTickets.length,1);
 h.setSourceFailure(true);const stopped=await h.req('/backstops/stop',binding);assert.equal(stopped.policy.automatedBrokerProtection,false,'stop does not need live broker reads');h.setSourceFailure(false);
 assert.equal((await h.req('/watch/tick',{})).ordersSubmitted,0);assert.equal(h.effects.length,1,'stopping leaves existing broker orders intact');
});
for(const mode of ['unknown','throw'])test('lost broker acknowledgement remains unknown and is never retried: '+mode,async t=>{
 const h=await protectionFixture(t);await h.activate();h.setSubmitMode(mode);
 const first=await h.req('/watch/tick',{});assert.equal(first.ordersSubmitted,null,JSON.stringify(first));assert.equal(h.effects.length,1);
 await h.req('/watch/tick',{});assert.equal(h.effects.length,1);
});
test('expired or changed native authority and a closed regular session dispatch no protection',async t=>{
 const h=await protectionFixture(t);await h.activate();
 for(const effective of ['expired','source-changed','stopped']){h.policy().effectiveStatus=effective;await h.req('/watch/tick',{});assert.equal(h.effects.length,0);}
 h.policy().effectiveStatus='active';h.setNow('2026-10-26T21:00:00Z');await h.req('/watch/tick',{});assert.equal(h.effects.length,0);
});
test('exact protection cancellation requires confirmation and cannot cancel another policy’s ticket',async t=>{
 const h=await protectionFixture(t);await h.activate();await h.req('/watch/tick',{});const row=h.tickets[0],b={...binding,ticketId:row.ticketId,orderId:row.orderId,fingerprint:row.fingerprint,confirm:true};
 assert.equal((await h.req('/backstops/cancel',{...b,confirm:false})).status,428);
 assert.equal((await h.req('/backstops/cancel',{...b,orderId:'foreign'})).error,'protection_cancel_mismatch');
 assert.equal((await h.req('/backstops/cancel',b,'owner-b')).status,404);
 assert.equal((await h.req('/backstops/cancel',b)).ticket.cancelStatus,'requested');assert.equal(h.effects.filter(e=>e.cancel).length,1);
});
