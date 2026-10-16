/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive shipped preview/apply routes through a recording transactional ledger: complete venue reads, confirmation, stale witnesses, rollback, release and no order execution.
 */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./support/native-reconciliation-fixture');
test('preview reads the complete year once per bounded chunk, exposes proposals without private witness or writes',async()=>{
 const f=setup(),r=await f.request('preview',{bookId:'victim',subject:'victim',transactions:[{fake:true}]});assert.equal(r.status,200);assert.equal(r.body.corrections.length,1);assert.equal(r.body.ledger,undefined);assert.equal(f.sql.length,0);
 const windows=f.calls.filter(c=>c.name==='trading.transactions');assert.equal(windows.length,7);assert.ok(windows.every(c=>Date.parse(c.input.to)-Date.parse(c.input.from)<=55*86400000));assert.deepEqual(f.calls[0].input,{accountId:'opaque',connection:'login'});
});
test('apply requires authentication, a preview fingerprint and explicit confirmation before reading evidence',async()=>{
 const f=setup();assert.equal((await f.request('apply',{},null)).status,401);assert.equal((await f.request('apply')).status,428);assert.equal((await f.request('preview',{accountId:[]})).status,400);assert.equal(f.calls.length,0);
});
test('a confirmed apply fetches fresh evidence and commits paired historical rows only',async()=>{
 const f=setup(),p=await f.request('preview');f.calls.length=0;
 const a=await f.request('apply',{fingerprint:p.body.fingerprint,confirm:true,bookId:'victim',manualCloses:[{fake:true}]});assert.equal(a.status,200);assert.equal(a.body.bookedRows,1);assert.equal(a.body.realOrdersPlaced,0);assert.equal(a.body.nativeLedgerOnly,true);assert.equal(f.commits,1);assert.equal(f.released,1);assert.equal(f.stored.length,2);assert.equal(f.stored[1].book_id,'book');assert.equal(f.stored[1].side,'sell');assert.ok(f.calls.some(c=>c.name==='trading.transactions'));assert.equal(f.sql.filter(c=>c.text.startsWith('INSERT')).length,2);
});
test('changed evidence, concurrent ledger changes, insert failures and missing write acknowledgement refuse atomically',async()=>{
 const stale=setup(),p=await stale.request('preview');stale.ledger.orders[0].filled_qty=21;const a=await stale.request('apply',{fingerprint:p.body.fingerprint,confirm:true});assert.equal(a.status,409);assert.equal(stale.sql.length,0);
 for(const options of [{concurrent:true},{failure:'insert'},{failure:'ack'}]){
  const f=setup(options),preview=await f.request('preview'),r=await f.request('apply',{fingerprint:preview.body.fingerprint,confirm:true});assert.notEqual(r.status,200);assert.equal(f.commits,0);assert.equal(f.released,1);assert.equal(f.stored.length,1);assert.ok(f.sql.some(c=>c.text==='ROLLBACK'));
 }
});
test('failed history is a failed preview, and accounts without engine history do not enroll holdings',async()=>{
 const failed=setup({failure:'history'});assert.equal((await failed.request('preview')).status,502);assert.equal(failed.sql.length,0);
 const empty=setup({noLedger:true}),r=await empty.request('preview');assert.equal(r.body.status,'no-ledger');assert.equal(r.body.corrections.length,0);assert.equal(empty.calls.filter(c=>c.name==='trading.transactions').length,0);
});

test('a holdings change during the year-history read refuses preview before any writes',async()=>{
 const f=setup({holdingsChange:true}),r=await f.request('preview');assert.equal(r.status,409);assert.equal(r.body.error,'holdings_changed');assert.equal(f.sql.length,0);
});
