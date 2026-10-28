/** Original-owner read-only recovery of persisted financial drafts; no real broker I/O. */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {allocationFixture}=require('./support/native-allocation-host');
const {protectionFixture}=require('./support/native-protection-host');
const path='/live/reviews?accountId=a&connectionKey=owned-login';
test('a second tab recovers the exact saved account cap and proposal without activation or writes',async t=>{
 const h=await allocationFixture(t),inserts=()=>h.calls.filter(c=>c.sql?.startsWith('INSERT')).length,before=inserts();
 const r=await h.req(path);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.strategy.availability,'ready');assert.equal(r.strategy.review.activationReady,true);
 assert.equal(r.strategy.mandate.terms.capitalCents,h.draft.mandate.terms.capitalCents);assert.deepEqual(r.strategy.review.proposal,h.draft.review.proposal);
 assert.equal(inserts(),before,'opening the saved review cannot rewrite its terms');assert.equal(h.count(),0);assert.equal(h.mandate().status,'draft');
 assert.equal((await h.req(path,undefined,'owner-b')).strategy,null);
 assert.notEqual((await h.req('/live/reviews?accountId=a&connectionKey=foreign')).status,200);
});
test('expired, stopped, unverifiable and changed native reviews retain their terms but cannot activate',async t=>{
 const h=await allocationFixture(t),original=h.ctx.intent;
 for(const patch of [{reviewExpiresAtMs:null},{reviewExpiresAtMs:Date.parse('2026-10-26T15:59:00Z')},{effectiveStatus:'source-changed'},{status:'stopped'},{fingerprint:'different'}]){
  const before=structuredClone(h.mandate());Object.assign(h.mandate(),patch);
  const r=await h.req(path);assert.equal(r.strategy.review.activationReady,false,JSON.stringify(r));assert.notEqual(r.strategy.availability,'ready');assert.equal(r.strategy.mandate.terms.capitalCents,90000);
  Object.keys(h.mandate()).forEach(k=>delete h.mandate()[k]);Object.assign(h.mandate(),before);
 }
 h.ctx.intent=async(name,input)=>{if(name==='trading.orders.mandate.status')throw Error('Synthetic native outage');return original(name,input);};
 const r=await h.req(path);assert.equal(r.strategy.availability,'unavailable');assert.equal(r.strategy.review.activationReady,false);assert.equal(h.count(),0);
});
test('broker-stop review is restored only for the current owner, exact account and matching policy',async t=>{
 const h=await protectionFixture(t);await h.enroll();const created=await h.review();assert.equal(created.status,200);
 const r=await h.req(path);assert.equal(r.protection.id,created.review.id);assert.equal(r.protection.availability,'ready');assert.equal(r.protection.activationReady,true);assert.equal(r.protection.researchRunId,created.review.researchRunId);
 h.policy().reviewExpiresAtMs=0;const expired=await h.req(path);assert.equal(expired.protection.availability,'expired');assert.equal(expired.protection.activationReady,false);
 assert.equal((await h.req(path,undefined,'owner-b')).protection,null);assert.equal(h.effects.length,0);
});
