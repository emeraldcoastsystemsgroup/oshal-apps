/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove residual sizing conserves filled work, economic budgets, prepared identities and verified funding without altering original evidence.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Reject invalid numeric inputs, malformed goal maps and fills beyond exact ticket quantities before residual sizing.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {keyFor,retainedGoal,retainedProgress,reviseBuyGoal,chunkBlockers,fundedChunk}=require('../routes/live/continuity/goals');
const invalid=e=>e.status===409&&e.code==='continuity_evidence_invalid';

/** Pure synthetic decision inputs; no route, database or provider is reachable. */
function fixture({filled=40,remaining=20,rate=0,limitCents=10010}={}){
 const action={symbol:'ABC',action:'buy',changeQty:100,referencePrice:100,targetWeightPct:100};
 const record={plan:{rows:[{symbol:'ABC',currentQty:0}],actions:[action]},fillBaselines:{'earlier-ticket':3}};
 const tickets=filled?[{ticketId:'filled-ticket',status:'submitted',terms:{symbol:'ABC',side:'buy',quantity:filled,limitCents:10010},brokerStatus:{status:'FILLED',filledQuantity:filled}}]:[];
 const plan={rows:[{symbol:'ABC',action:remaining>0?'buy':remaining<0?'sell':'hold',changeQty:remaining}],funding:{measuredSettledOrWithdrawableCash:10000,measuredBuyingPower:10000}};
 const progress=retainedProgress(record,action,tickets,0,rate);
 return{record,action,tickets,plan,progress,rate,limitCents};
}

/** Freeze nested evidence so accidental writes fail even before value comparisons. */
function freeze(value){
 if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}
 return value;
}

/** Independent whole-share affordability inputs; commitments are already excluded by the caller. */
function funding({cash=1000,broker=1000,settled=1000,buyingPower=1000,cap=1000000,exposure=0,rate=0,limitCents=10000}={}){
 return{chunk:{status:'prepare',quantity:10,filled:0},limitCents,rate,
  receipt:{brokerFunding:{cashBudgetUsd:broker}},account:{cash,positions:exposure?[{marketValue:exposure}]:[]},
  mandate:{terms:{capitalCents:cap}},plan:{funding:{measuredSettledOrWithdrawableCash:settled,measuredBuyingPower:buyingPower}}};
}

test('a fresh residual is added to fills once and leaves the original plan and baseline untouched',()=>{
 const input=fixture(),before=structuredClone(input);freeze(input);
 const result=reviseBuyGoal(input);
 assert.equal(result.status,'prepare');assert.equal(result.goal.quantity,60);
 assert.equal(result.filled,40);assert.equal(result.remaining,20);
 assert.deepEqual(input,before);assert.equal(input.record.plan.actions[0].changeQty,100);
 assert.deepEqual(input.record.fillBaselines,{'earlier-ticket':3});
});

test('a rising price is bounded by the conserved economic budget as well as the share goal',()=>{
 const input=fixture({remaining:60,rate:.001,limitCents:11011});
 const before=retainedGoal(input.record,input.action,input.rate),result=reviseBuyGoal(input);
 const spent=40*Math.ceil(10010*1.001),unit=Math.ceil(11011*1.001);
 assert.equal(result.goal.quantity,94,'six shares are removed even though the fresh share target is unchanged');
 assert.equal(result.goal.budgetCents,before.budgetCents);
 assert.ok(spent+result.remaining*unit<=before.budgetCents);
 assert.ok(spent+(result.remaining+1)*unit>before.budgetCents);
});

test('a previously reduced goal cannot regrow when targets or available cash increase',()=>{
 const input=fixture({remaining:60});
 input.record.continuity={goals:{[keyFor(input.action)]:{quantity:60,budgetCents:600600}}};
 const result=reviseBuyGoal(input);
 assert.equal(result.goal.quantity,60);assert.equal(result.remaining,20);assert.equal(result.changed,false);
});

test('zero and unknown current cash do not permanently shrink the economic goal',()=>{
 const base=fixture({remaining:60}),expected=reviseBuyGoal(base);
 for(const value of [0,null,undefined,NaN,Infinity]){
  const input=fixture({remaining:60});input.plan.funding={measuredSettledOrWithdrawableCash:value,measuredBuyingPower:value};
  assert.deepEqual(reviseBuyGoal(input),expected);
 }
 const now=funding({cash:0,broker:0,settled:0,buyingPower:0});
 assert.equal(fundedChunk(now).status,'waiting-for-settled-cash');
 assert.equal(fundedChunk(funding({broker:null})).status,'waiting-for-settled-cash');
 assert.equal(reviseBuyGoal(base).goal.quantity,100,'funding waits do not consume or close the goal');
});

test('prepared quantity cannot be resized to fit a reduced goal or reduced cash',()=>{
 const input=fixture(),prior={ticketId:'prepared-ticket',intentKey:'same-intent',status:'prepared',terms:{quantity:25,limitCents:10010}};
 input.progress.prior=prior;freeze(prior);
 const revised=reviseBuyGoal(input);
 assert.equal(revised.status,'prepared-chunk-review-required');assert.equal(revised.ticket,prior);
 assert.equal(prior.terms.quantity,25);assert.equal(revised.goal,undefined);
 const chunkInput=funding({cash:250,broker:250,settled:250,buyingPower:250});
 chunkInput.chunk={status:'prepare',quantity:3,filled:0,prior:{ticketId:'cash-draft',terms:{quantity:3}}};
 const before=structuredClone(chunkInput);
 assert.equal(fundedChunk(chunkInput).status,'waiting-for-settled-cash');assert.deepEqual(chunkInput,before);
});

test('an exact prepared ticket that still fits retains its identity and quantity',()=>{
 const input=fixture(),prior={ticketId:'prepared-ticket',intentKey:'same-intent',terms:{quantity:20,limitCents:10010}};
 input.progress.prior=prior;
 const result=reviseBuyGoal(input);
 assert.equal(result.status,'prepare');assert.equal(result.prior,prior);assert.equal(result.remaining,20);
 const chunkInput=funding(),cashPrior={ticketId:'cash-draft',terms:{quantity:2}};
 chunkInput.chunk={status:'prepare',quantity:2,filled:40,prior:cashPrior};
 assert.equal(fundedChunk(chunkInput).quantity,2);assert.equal(fundedChunk(chunkInput).prior,cashPrior);
});

test('a missing or fractional fresh row refuses rather than fabricating a zero target',()=>{
 for(const rows of [[],[{symbol:'OTHER',changeQty:20}],[{symbol:'ABC',changeQty:1.5}],[{symbol:'ABC',changeQty:NaN}]]){
  const input=fixture();input.plan.rows=rows;assert.throws(()=>reviseBuyGoal(input),invalid);
 }
});

test('a valid hold or sell target seals only the outstanding buy without inventing a reversal',()=>{
 for(const remaining of [0,-10]){
  const input=fixture({remaining}),result=reviseBuyGoal(input);
  assert.equal(result.status,'filled');assert.equal(result.goal.quantity,40);assert.equal(result.remaining,0);
  assert.equal(input.action.action,'buy');assert.equal(input.action.changeQty,100);
 }
});

test('invalid stored goals and economic budgets are rejected',()=>{
 for(const goal of [{quantity:-1,budgetCents:1},{quantity:101,budgetCents:1},{quantity:1.5,budgetCents:1},
  {quantity:'10',budgetCents:1},{quantity:10,budgetCents:-1},{quantity:10,budgetCents:1.5},
  {quantity:10,budgetCents:'100'},{quantity:10,budgetCents:1001001},{quantity:10,budgetCents:NaN}]){
  const input=fixture();input.record.continuity={goals:{[keyFor(input.action)]:goal}};
  assert.throws(()=>retainedGoal(input.record,input.action,0),invalid);
 }
});

test('a present malformed goal cannot fall back to the larger original allocation',()=>{
 for(const goal of [null,false,0,'',[],{}]){
  const input=fixture();input.record.continuity={goals:{[keyFor(input.action)]:goal}};
  assert.throws(()=>retainedGoal(input.record,input.action,0),invalid,`stored ${String(goal)} must not reset the goal`);
 }
});

test('a retained budget cannot erase cost already committed by fills',()=>{
 const input=fixture();input.record.continuity={goals:{[keyFor(input.action)]:{quantity:100,budgetCents:100}}};
 assert.throws(()=>reviseBuyGoal(input),invalid);
 input.record.continuity=undefined;input.tickets[0].terms.limitCents=null;
 assert.throws(()=>reviseBuyGoal(input),invalid);
});

test('funded chunks reserve one dollar and modeled costs with an exact whole-share boundary',()=>{
 const exact=funding({cash:203,broker:203,settled:203,buyingPower:203,rate:.01}),before=structuredClone(exact);
 assert.equal(fundedChunk(exact).quantity,2);assert.deepEqual(exact,before);
 const short=funding({cash:202.99,broker:202.99,settled:202.99,buyingPower:202.99,rate:.01});
 assert.equal(fundedChunk(short).quantity,1);
 const cap=funding({cap:70000,exposure:500});assert.equal(fundedChunk(cap).quantity,2);
 assert.equal(fundedChunk(funding({cap:50000,exposure:500})).status,'waiting-for-capital-capacity');
});

test('only measured finite nonnegative funding limits constrain a chunk; zero remains binding',()=>{
 for(const unknown of [null,undefined,NaN,Infinity]){
  const input=funding();input.plan.funding={measuredSettledOrWithdrawableCash:unknown,measuredBuyingPower:unknown};
  assert.equal(fundedChunk(input).quantity,9);
 }
 assert.equal(fundedChunk(funding({settled:500,buyingPower:250})).quantity,2);
 assert.equal(fundedChunk(funding({settled:0})).status,'waiting-for-settled-cash');
 for(const unknown of [null,undefined,NaN,Infinity,-1]){
  const input=funding();input.receipt.brokerFunding.cashBudgetUsd=unknown;
  assert.equal(fundedChunk(input).status,'waiting-for-settled-cash');
 }
});

test('unknown measured account cash never returns an executable nonfinite quantity',()=>{
 for(const cash of [null,undefined,NaN,Infinity]){
  const input=funding();input.account.cash=cash;
  assert.throws(()=>fundedChunk(input),invalid,`cash=${String(cash)} cannot be verified by a separate broker allowance`);
 }
});

test('whole-plan funding blockers are removed only when their exact finite nonnegative fact is known',()=>{
 const settlement={code:'sale_or_settlement_funding_required'},power={code:'broker_buying_power_exceeded'},blockers=[settlement,power];
 for(const unknown of [null,undefined,NaN,Infinity,-1]){
  const plan={funding:{measuredSettledOrWithdrawableCash:unknown,measuredBuyingPower:unknown}};
  assert.deepEqual(chunkBlockers(plan,blockers),blockers,`unknown capacity ${String(unknown)} retains both blockers`);
 }
 assert.deepEqual(chunkBlockers({funding:{measuredSettledOrWithdrawableCash:250}},blockers),[power]);
 assert.deepEqual(chunkBlockers({funding:{measuredBuyingPower:250}},blockers),[settlement]);
 assert.deepEqual(chunkBlockers({funding:{measuredSettledOrWithdrawableCash:0,measuredBuyingPower:0}},blockers),[]);
});

test('fresh funding never clears stale quotes, unknown settlement or unrelated blockers',()=>{
 const blockers=['quote_stale','quote_time_invalid','quote_source_unverified','settled_cash_unknown','broker_buying_power_unknown','account_reconciliation_required','unexpected'].map(code=>({code,symbol:'ABC'}));
 const plan={funding:{measuredSettledOrWithdrawableCash:10000,measuredBuyingPower:10000}},before=structuredClone(blockers);
 assert.deepEqual(chunkBlockers(plan,blockers),blockers);assert.deepEqual(blockers,before);
});

test('nonfinite or negative modeled rates cannot produce an executable funded chunk',()=>{
 for(const rate of [NaN,-1,Infinity,-Infinity,Number.MAX_VALUE]){
  const input=funding({rate}),before=structuredClone(input);freeze(input);
  assert.throws(()=>fundedChunk(input),invalid,`modeled rate ${String(rate)} must refuse`);
  assert.deepEqual(input,before);
 }
});

test('zero, negative, fractional and unsafe share counts cannot become funded chunks',()=>{
 for(const quantity of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'2']){
  const input=funding();input.chunk.quantity=quantity;const before=structuredClone(input);freeze(input);
  assert.throws(()=>fundedChunk(input),invalid,`chunk quantity ${String(quantity)} must refuse`);
  assert.deepEqual(input,before);
 }
});

test('revised goals reject invalid or excessive reconciled fill quantities',()=>{
 for(const filled of [NaN,-1,1.5,Infinity,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1]){
  const input=fixture();input.progress.filled=filled;const before=structuredClone(input);freeze(input);
  assert.throws(()=>reviseBuyGoal(input),invalid,`filled quantity ${String(filled)} cannot exceed or replace the retained goal`);
  assert.deepEqual(input,before);
 }
});

test('missing, nonpositive and unsafe original prices cannot recreate a purchase budget',()=>{
 for(const referencePrice of [undefined,null,0,-1,NaN,Infinity,Number.MAX_SAFE_INTEGER,'100']){
  const input=fixture();input.action.referencePrice=referencePrice;const before=structuredClone(input);freeze(input);
  assert.throws(()=>retainedGoal(input.record,input.action,input.rate),invalid,`original price ${String(referencePrice)} must refuse`);
  assert.deepEqual(input,before);
 }
});

test('an explicitly malformed goals map cannot reset retained work to the original goal',()=>{
 for(const goals of [undefined,null,false,0,'',[],['buy:ABC']]){
  const input=fixture();input.record.continuity={version:1,goals};const before=structuredClone(input);freeze(input);
  assert.throws(()=>retainedGoal(input.record,input.action,input.rate),invalid,`goals map ${String(goals)} must refuse`);
  assert.deepEqual(input,before);
 }
});

test('filled shares must fit an exact ticket quantity before their cost can revise a goal',()=>{
 for(const quantity of [39,undefined,NaN,40.5]){
  const input=fixture({filled:40});input.tickets[0].terms.quantity=quantity;
  const before=structuredClone(input);freeze(input);
  assert.throws(()=>reviseBuyGoal(input),invalid,`forty filled shares cannot be covered by ticket quantity ${String(quantity)}`);
  assert.deepEqual(input,before);
 }
});
