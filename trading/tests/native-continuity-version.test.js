/** CHANGE LOG
 * SEQ: 3
 * AUTHOR: maintainer@emeraldcoastsystemsgroup.com
 * Refuse candidate protection and allocation before any broker work without native versioned admission.
 * SEQ: 2
 * AUTHOR: maintainer@emeraldcoastsystemsgroup.com
 * Verify candidate endpoint isolation while keeping the original legacy route byte-identical.
 * SEQ: 1
 * AUTHOR: maintainer@emeraldcoastsystemsgroup.com
 * Verify legacy execution remains unchanged and synthetic continuity admission
 * fails closed without matching explicit watch and native authority versions.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {allocationFixture}=require('./support/native-allocation-host');
const {continuityFixture}=require('./support/continuity-host');
const {getRecord,saveRecord}=require('../routes/trading-portfolio-store');
const {accountKey}=require('../routes/trading-portfolio-model');

async function patchWatch(h,changes){
 const watch=await getRecord(h.ctx,'owner-a','watch',h.watch.id);
 return saveRecord(h.ctx,'owner-a','watch',{...watch,...changes},accountKey(watch));
}

function countExecutionCalls(h){
 const original=h.ctx.intent,calls={prepare:0,submit:0};
 h.ctx.intent=async(name,input)=>{
  if(name==='trading.orders.prepare')calls.prepare++;
  if(name==='trading.orders.submit')calls.submit++;
  return original(name,input);
 };
 return calls;
}

async function expectAdmissionRefused(h,pattern){
 const calls=countExecutionCalls(h);
 for(let repeat=0;repeat<2;repeat++){
  const result=await h.req('/watch/tick',{});
  assert.equal(result.status,200);assert.equal(result.receipts[0].status,'failed');
  assert.match(result.receipts[0].message,pattern);
  assert.deepEqual(calls,{prepare:0,submit:0});assert.equal(h.count(),0);assert.equal(h.tickets.length,0);
 }
 assert.equal([...h.records.values()].filter(row=>row.kind==='live-cycle').length,0);
}

for(const version of [undefined,1])test('legacy watch version '+String(version)+' retains its approved executor without implicit adoption',async t=>{
 const h=await allocationFixture(t,{whole:true,positions:[{symbol:'ABC',qty:10,marketValue:1000}],cash:0,equity:1000,capitalCents:90000});
 await h.activate();if(version!==undefined)await patchWatch(h,{executionVersion:version});
 const excluded=await h.req('/continuity/watch/tick',{});assert.deepEqual([excluded.checked,excluded.receipts,excluded.ordersSubmitted],[0,[],0]);assert.equal(h.count(),0);
 assert.equal((await h.req('/watch/tick',{})).ordersSubmitted,1);h.fill();
 const original=h.ctx.intent;
 h.ctx.intent=async(name,input)=>name==='trading.orders.balance'?{cashBudgetUsd:250}:original(name,input);
 const calls=countExecutionCalls(h),result=await h.req('/watch/tick',{});
 assert.equal(result.receipts[0].status,'waiting-for-settled-cash','Legacy approved quantities must not silently use the candidate chunk sizing.');
 assert.equal(result.ordersSubmitted,0);assert.deepEqual(calls,{prepare:0,submit:0});assert.equal(h.count(),1);
 const watch=await getRecord(h.ctx,'owner-a','watch',h.watch.id);
 assert.equal(watch.executionVersion,version);assert.equal(watch.executionGeneration,undefined);
});

for(const version of [0,3,'2'])test('unsupported watch execution version '+JSON.stringify(version)+' cannot prepare or submit',async t=>{
 const h=await continuityFixture(t);await h.activate();await patchWatch(h,{executionVersion:version});
 await expectAdmissionRefused(h,/execution version is not supported/);
});

const refusals=[
 ['missing native execution version',h=>{delete h.mandate().terms.executionVersion;}],
 ['legacy native execution version',h=>{h.mandate().terms.executionVersion=1;}],
 ['missing native generation',h=>{delete h.mandate().terms.executionGeneration;}],
 ['different native generation',h=>{h.mandate().terms.executionGeneration='another-synthetic-generation';}],
 ['missing watch generation',h=>patchWatch(h,{executionGeneration:undefined})],
];
for(const [label,change] of refusals)test('version 2 with '+label+' cannot prepare or submit',async t=>{
 const h=await continuityFixture(t);await h.activate();await change(h);
 await expectAdmissionRefused(h,/explicitly approved native continuity generation/);
});


const beforeProtection=[
 ['missing native version',h=>{delete h.mandate().terms.executionVersion;},'failed'],
 ['missing native generation',h=>{delete h.mandate().terms.executionGeneration;},'failed'],
 ['mismatched native generation',h=>{h.mandate().terms.executionGeneration='other-generation';},'failed'],
 ['expired native authority',h=>{h.mandate().expiresAtMs=Date.parse('2026-10-26T15:59:00Z');},'mandate-inactive'],
 ['stopped native authority',h=>{h.mandate().status='stopped';},'mandate-inactive'],
 ['missing native mandate binding',h=>patchWatch(h,{mandateId:undefined}),'failed'],
];
for(const [label,change,status] of beforeProtection)test('configured protection is untouched before admission with '+label,async t=>{
 const h=await continuityFixture(t);await h.activate();await change(h);
 const account=h.accounts[0],policy={accountId:account.accountId,connectionKey:account.connectionKey,
  automatedBrokerProtection:true,protectionMandateId:'synthetic-guarded-protection',config:{trailPct:5}};
 await saveRecord(h.ctx,'owner-a','backstop-policy',policy,accountKey(account));
 const original=h.ctx.intent,calls=[];
 h.ctx.intent=async(name,input)=>{
  calls.push(name);
  if(name==='trading.orders.protection.status')throw Error('Synthetic protection must not run before candidate admission.');
  return original(name,input);
 };
 const result=await h.req('/watch/tick',{});
 assert.equal(result.status,200);assert.equal(result.receipts[0].status,status);
 assert.equal(result.ordersSubmitted,0);assert.equal(h.count(),0);assert.equal(h.tickets.length,0);
 assert.deepEqual(calls.filter(name=>name!=='trading.orders.mandate.status'),[],
  'Admission failure must precede protection, account reads, quotes, backstops, order preparation, submission and cancellation.');
 const stored=[...h.records.values()].find(row=>row.kind==='backstop-policy');
 assert.deepEqual(JSON.parse(stored.payload),policy,'The protection checker did not run or rewrite its policy.');
});

test('candidate order preparation and submission explicitly select native execution version two',async t=>{
 const h=await continuityFixture(t);await h.activate();const original=h.ctx.intent,calls=[];
 h.ctx.intent=async(name,input)=>{
  if(['trading.orders.prepare','trading.orders.submit'].includes(name))calls.push({name,input:structuredClone(input)});
  return original(name,input);
 };
 const result=await h.req('/watch/tick',{});
 assert.equal(result.ordersSubmitted,1);assert.equal(calls.length,2);
 assert.deepEqual(calls.map(call=>call.input.executionVersion),[2,2]);
});
