/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Synthetic brokerage acceptance of explicit mandate activation, sequential fills, repeat-safe cycles, stopped trading and uncertain results. Never real orders.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Effective native authority, release compatibility and per-invocation unknown/replay receipts.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {binding}=require('./support/native-management-host');
const {allocationFixture:fixture}=require('./support/native-allocation-host');
test('draft and forged approvals cannot trade; only the exact active account mandate dispatches',async t=>{
 const h=await fixture(t);assert.equal((await h.req('/watch/tick',{})).ordersSubmitted,0);assert.equal(h.count(),0);
 assert.equal((await h.req('/live/activate',{watchId:h.watch.id,mandateId:'mandate-1',fingerprint:'wrong',confirm:true})).error,'mandate_mismatch');
 assert.equal((await h.req('/live/activate',{watchId:h.watch.id,mandateId:'mandate-1',fingerprint:'review'})).status,428);
 assert.equal((await h.req('/live/activate',{watchId:h.watch.id,mandateId:'mandate-1',fingerprint:'review',confirm:true},'owner-b')).status,404);
 assert.equal((await h.activate()).mandate.status,'active');const aggregate=await h.req('/management');assert.equal(aggregate.execution.automatedTrading,true);assert.equal(aggregate.execution.automatedTradingAccounts,1);const fire=await h.req('/watch/tick',{});assert.equal(fire.ordersSubmitted,1,JSON.stringify(fire));assert.equal(h.count(),1);
 assert.equal((await h.req('/watch/tick',{})).ordersSubmitted,0);assert.equal(h.count(),1,'a working order blocks every following submission');
 assert.equal((await h.req('/watch',{runId:h.runId,confirm:true})).error,'live_mandate_active');
});
test('monthly cycle survives refreshes, waits for each actual fill, completes without daily rebalancing and stops without broker reads',async t=>{
 const h=await fixture(t);await h.activate();
 for(let i=0;i<8;i++){const result=await h.req('/watch/tick',{});assert.notEqual(result.receipts[0].status,'failed',JSON.stringify(result));if(result.ordersSubmitted)h.fill();if(result.receipts[0].status==='cycle-completed')break;}
 const n=h.count();assert.ok(n>0);assert.equal((await h.req('/watch/tick',{})).receipts[0].status,'cycle-completed');assert.equal(h.count(),n);
 h.setSourceFailure(true);const stopped=await h.req('/live/stop',{watchId:h.watch.id});assert.equal(stopped.watch.automatedTrading,false);assert.equal(h.mandate().status,'stopped');assert.equal(h.count(),n);
});
test('uncertain execution result is retained and never retried on a subsequent watcher pass',async t=>{
 const h=await fixture(t);await h.activate();await h.req('/watch/tick',{});h.tickets[0].status='unknown';h.tickets[0].orderId=null;h.tickets[0].brokerStatus={status:'CANCELED'};
 const result=await h.req('/watch/tick',{});assert.equal(result.receipts[0].status,'uncertain-order-review-required');assert.equal(h.count(),1);
 await h.req('/watch/stop',binding);assert.equal(h.mandate().status,'stopped');assert.equal((await h.req('/watch/tick',{})).checked,0);
});
test('account status and dispatch reject expired, changed, malformed or unavailable native authority',async t=>{
 const h=await fixture(t);await h.activate();
 for(const change of [
  {expiresAtMs:null,effectiveStatus:'active',expected:'expired'},
  {expiresAtMs:'2099-01-01',effectiveStatus:'active',expected:'expired'},
  {expiresAtMs:Date.parse('2026-10-26T16:00:00Z'),effectiveStatus:'active',expected:'expired'},
  {expiresAtMs:Date.parse('2026-11-25T16:00:00Z'),effectiveStatus:'source-changed',expected:'source-changed'},
 ]){
  Object.assign(h.mandate(),change);
  const data=await h.req('/management');assert.equal(data.watches[0].automatedTrading,true,'saved setting alone is not authority');
  assert.equal(data.watches[0].authority.active,false);assert.equal(data.watches[0].authority.status,change.expected);assert.equal(data.execution.automatedTrading,false);assert.equal(data.execution.automatedTradingAccounts,0);
  assert.equal((await h.req('/watch/tick',{})).receipts[0].status,'mandate-inactive');assert.equal(h.count(),0);
 }
 const original=h.ctx.intent;h.ctx.intent=async(name,input)=>{if(name==='trading.orders.mandate.status')throw Error('Synthetic native status outage');return original(name,input);};
 assert.equal((await h.req('/management')).watches[0].authority.status,'unavailable');assert.equal(h.count(),0);
});
test('a native release without effective status cannot silently enable automatic trading',async t=>{
 const h=await fixture(t),original=h.ctx.intent;
 h.ctx.intent=async(name,input)=>{const result=await original(name,input);if(name==='trading.orders.mandate.status')delete result.effectiveStatus;return result;};
 assert.equal((await h.activate()).error,'live_release_required');assert.equal(h.mandate().status,'draft');
 assert.equal((await h.req('/management')).watches[0].automatedTrading,false);assert.equal(h.count(),0);
});
test('allocation unknown outcomes remain unknown through account and aggregate watcher receipts',async t=>{
 const h=await fixture(t);await h.activate();const original=h.ctx.intent;
 h.ctx.intent=async(name,input)=>{
  if(name==='trading.orders.submit'){
   const ticket=h.tickets.find(t=>t.ticketId===input.ticketId);ticket.status='unknown';
   return{...structuredClone(ticket),ordersSubmitted:null,submissionAttempted:true};
  }
  return original(name,input);
 };
 const result=await h.req('/watch/tick',{});
 assert.equal(result.ordersSubmitted,null);assert.equal(result.receipts[0].ordersSubmitted,null);
 assert.equal(result.receipts[0].automation.ordersSubmitted,null);assert.equal(result.receipts[0].status,'order-result-uncertain');
 assert.equal((await h.req('/watch/tick',{})).receipts[0].status,'uncertain-order-review-required');assert.equal(h.count(),0);
});
test('broker receipts count confirmed new submissions, never durable replays or missing acknowledgments',()=>{
 const {submissionCount}=require('../routes/live/execution-state');
 assert.equal(submissionCount({status:'submitted',ordersSubmitted:1,submissionAttempted:true}),1);
 assert.equal(submissionCount({status:'submitted',ordersSubmitted:0,submissionAttempted:false}),0);
 assert.equal(submissionCount({status:'submitted',ordersSubmitted:1,submissionAttempted:false}),null);
 assert.equal(submissionCount({status:'submitted',ordersSubmitted:1}),null);
 assert.equal(submissionCount({status:'unknown',ordersSubmitted:0}),null);
 assert.equal(submissionCount({status:'attempting',ordersSubmitted:0}),null);
 assert.equal(submissionCount({status:'rejected',ordersSubmitted:0,submissionAttempted:true}),0);
});
test('whole-account review discloses existing debt and requires explicit adoption before sell-first deleveraging',async t=>{
 const h=await fixture(t,{whole:true,positions:[{symbol:'ABC',qty:10,marketValue:1000,unmanaged:true}],cash:0,equity:600,capitalCents:60000,balanceFacts:{marginBalance:-400,debitBalance:null,maintenanceRequirement:250}});
 assert.equal(h.draft.review.activationReady,true,JSON.stringify(h.draft.review));
 assert.equal(h.draft.mandate.adoptionReview.balanceFacts.marginBalance,-400);assert.equal(h.draft.mandate.adoptionReview.balanceFacts.debitBalance,null);
 assert.equal(h.draft.mandate.terms.maxDailyTurnoverCents,160000);assert.equal(h.draft.review.proposal.funding.reportedEquity,600);assert.equal(h.draft.review.proposal.funding.derivedFinancingCashBefore,-400);
 assert.ok(h.draft.review.proposal.blockers.some(b=>b.code==='margin_facts_unknown'));assert.equal(h.count(),0);
 assert.equal((await h.req('/live/activate',{watchId:h.watch.id,mandateId:'mandate-1',fingerprint:'review',confirm:true})).error,'adoption_confirmation_required');
 await h.activate();let tick=await h.req('/watch/tick',{});assert.equal(tick.ordersSubmitted,1,JSON.stringify(tick));assert.equal(h.tickets[0].terms.side,'sell');assert.equal(h.tickets[0].terms.symbol,'ABC');
 h.fill(3);tick=await h.req('/watch/tick',{});assert.equal(tick.ordersSubmitted,0);assert.equal(h.count(),1,'partial fill never authorizes the next chunk');
 h.fill();assert.equal(h.accounts[0].balanceFacts.marginBalance,0);
 for(let i=0;i<10;i++){tick=await h.req('/watch/tick',{});assert.notEqual(tick.receipts[0].status,'failed',JSON.stringify(tick));if(tick.ordersSubmitted)h.fill();if(tick.receipts[0].status.startsWith('cycle-completed'))break;}
 assert.ok(tick.receipts[0].status.startsWith('cycle-completed'),JSON.stringify(tick));assert.ok(h.tickets.some(t=>t.terms.side==='buy'));assert.ok(h.accounts[0].cash>=0);assert.equal(h.accounts[0].positions.some(p=>p.symbol==='ABC'),false);
});
test('large whole-account actions use distinct bounded chunks and reconcile every fill before completion',async t=>{
 const h=await fixture(t,{whole:true,positions:[{symbol:'ABC',qty:1200,marketValue:120000,unmanaged:true}],cash:0,equity:120000,capitalCents:9000000,balanceFacts:{buyingPower:240000}});await h.activate();
 let last;
 for(let i=0;i<30;i++){
  const tick=await h.req('/watch/tick',{});last=tick.receipts[0];assert.notEqual(last.status,'failed',JSON.stringify(tick));
  if(tick.ordersSubmitted){assert.equal(tick.ordersSubmitted,1);h.fill();}
  if(last.status.startsWith('cycle-completed'))break;
 }
 assert.equal(last.status,'cycle-completed',JSON.stringify(last));
 const sells=h.tickets.filter(t=>t.terms.side==='sell');assert.deepEqual(sells.map(t=>t.terms.quantity),[500,500,200]);
 assert.equal(new Set(h.tickets.map(t=>t.intentKey)).size,h.tickets.length);assert.ok(h.tickets.every(t=>t.terms.quantity*t.terms.limitCents<=5000000));
 const before=h.count();assert.equal((await h.req('/watch/tick',{})).ordersSubmitted,0);assert.equal(h.count(),before);
});
test('manual holding drift and canceled partial chunks pause allocation instead of resizing or retrying silently',async t=>{
 const h=await fixture(t,{whole:true,positions:[{symbol:'ABC',qty:1200,marketValue:120000,unmanaged:true}],cash:0,equity:120000,capitalCents:9000000,balanceFacts:{buyingPower:240000}});await h.activate();await h.req('/watch/tick',{});h.fill(100);
 h.tickets[0].brokerStatus.status='CANCELED';const canceled=await h.req('/watch/tick',{});assert.equal(canceled.receipts[0].status,'unfilled-order-review-required');assert.equal(h.count(),1);
 h.accounts[0].positions[0].qty+=1;h.accounts[0].positions[0].marketValue+=100;h.accounts[0].equity+=100;
 assert.equal((await h.req('/watch/tick',{})).receipts[0].status,'holdings-changed-review-required');assert.equal(h.count(),1);
});
test('whole-account review refuses unsupported native releases and blocks activation of incomplete transitions',async t=>{
 const h=await fixture(t);const original=h.ctx.intent;
 h.ctx.intent=async(name,input)=>name==='trading.config'?{orderTickets:true,strategyMandates:true,wholeAccountMandates:false}:original(name,input);
 assert.equal((await h.req('/live/mandate',{watchId:h.watch.id,capitalCents:90000,scope:'whole-account'})).error,'whole_account_release_required');
 h.ctx.intent=async(name,input)=>{if(name==='trading.quotes')return{source:'schwab',quotes:[]};return original(name,input);};
 const review=await h.req('/live/mandate',{watchId:h.watch.id,capitalCents:90000});assert.equal(review.review.activationReady,false);assert.ok(review.review.proposalError);
 assert.equal((await h.activate()).error,'live_transition_unverified');assert.equal(h.mandate().status,'draft');assert.equal(h.count(),0);
});
test('a protective fill aborts the remaining monthly cycle instead of buying the stopped asset back',async t=>{
 const h=await fixture(t,{whole:true,positions:[{symbol:'ABC',qty:1200,marketValue:120000}],cash:0,equity:120000,capitalCents:9000000,balanceFacts:{buyingPower:240000}});await h.activate();await h.req('/watch/tick',{});h.fill();
 h.tickets.push({ticketId:'protective-exit',status:'submitted',allocationMandateId:'mandate-1',protectionMandateId:'protection',orderId:'999',terms:{symbol:'ABC',side:'sell',quantity:100,orderType:'TRAILING_STOP'},brokerStatus:{status:'FILLED',quantity:100,filledQuantity:100,remainingQuantity:0,legs:[]}});
 h.accounts[0].positions[0].qty-=100;h.accounts[0].positions[0].marketValue-=10000;h.accounts[0].cash+=9000;h.accounts[0].equity-=1000;
 const tick=await h.req('/watch/tick',{});assert.equal(tick.receipts[0].status,'protective-exit-awaiting-next-cycle');assert.equal(tick.ordersSubmitted,0);assert.equal(h.count(),1);
});
test('renewed native approvals use separate cycle namespaces and never replay old allocation chunks',async t=>{
 const h=await fixture(t);await h.activate();
 for(let i=0;i<10;i++){const result=await h.req('/watch/tick',{});if(result.ordersSubmitted)h.fill();if(result.receipts[0].status==='cycle-completed')break;}
 const before=h.count();h.mandate().fingerprint='renewed-review';
 const tick=await h.req('/watch/tick',{});assert.equal(tick.receipts[0].status,'cycle-completed',JSON.stringify(tick));assert.equal(h.count(),before);
 const cycles=[...h.records.values()].filter(r=>r.kind==='live-cycle').map(r=>JSON.parse(r.payload));assert.equal(cycles.length,2);assert.notEqual(cycles[0].key,cycles[1].key);
});
test('strategy review retains a losing later-window study instead of displaying only the favorable full window',async t=>{
 const h=await fixture(t),{saveRecord}=require('../routes/trading-portfolio-store');
 const original=JSON.parse([...h.records.values()].find(r=>r.kind==='run').payload);
 await saveRecord(h.ctx,'owner-a','run',{...original,startDate:'2026-08-03',result:{...original.result,metrics:{...original.result.metrics,totalReturnPct:-12,benchmarkReturnPct:4}},evidenceFingerprint:'synthetic-later-evidence'});
 const result=await h.req('/live/mandate',{watchId:h.watch.id,capitalCents:90000});assert.equal(result.review.research.laterRunCount,1);
 assert.equal(result.review.research.laterRuns[0].metrics.totalReturnPct,-12);assert.equal(result.review.research.laterRuns[0].metrics.benchmarkReturnPct,4);assert.equal(h.count(),0);
});

test('gains above the cap trim holdings without inventing a negative cash balance or borrowing requirement',async()=>{
 const {executeMonthly}=require('../routes/live/automation'),{fingerprint}=require('../routes/trading-portfolio-store');
 const at=new Date('2026-10-26T16:00:00Z'),config={modelVersion:2,kind:'quarterly-rotation',assets:['SPY','EFA','IEF','GLD','VNQ','DBC'].map(symbol=>({symbol,weightPct:100/6})),lookbackSessions:63,rebalanceSessions:20,topN:3,grossExposurePct:100,transactionCostBps:10,marginAprPct:null,maintenancePct:null,fractionalShares:false};
 const account={accountId:'synthetic',connectionKey:'synthetic',kind:'live',broker:'schwab',accountType:'margin',equity:1200,cash:100,positions:[{symbol:'SPY',qty:10,marketValue:1100}],balanceFacts:{buyingPower:2000,debitBalance:null,maintenanceRequirement:0,cashAvailableForWithdrawal:100,cashAvailableForTrading:100}};
 const receipt={signal:{decisionAsOf:'2026-09-30',evidenceThrough:'2026-10-23',targets:[{symbol:'SPY',weightPct:100}]},workingOrders:[],proposal:{rows:['SPY','EFA','IEF','GLD','VNQ','DBC','BIL'].map(symbol=>({symbol,referencePrice:symbol==='SPY'?110:100,tradeAt:at.toISOString()}))},brokerFunding:{cashBudgetUsd:100}};
 const sent=[],host=async(_ctx,action,input)=>{if(action==='mandate.status')return{status:'active',effectiveStatus:'active',expiresAtMs:at.getTime()+86400000,terms:{capitalCents:90000,strategyFingerprint:fingerprint(config)}};if(action==='refresh')return{tickets:[]};if(action==='prepare'){sent.push(input);return{ticketId:'synthetic',fingerprint:'synthetic'};}if(action==='submit')return{status:'submitted',ordersSubmitted:1,submissionAttempted:true};throw Error(action);};
 const result=await executeMonthly({pool:{query:async()=>({rows:[]})}},'synthetic',{mandateId:'synthetic'},receipt,{host,boundStudy:async()=>({selected:{account,profile:{registration:'taxable'}},config}),clock:()=>at});
 assert.equal(result.status,'order-submitted',JSON.stringify(result));assert.equal(sent.length,1);assert.equal(sent[0].side,'sell');assert.equal(sent[0].quantity,2);
 assert.equal(account.cash,100,'the measured account snapshot remains unchanged');
});

for(const reason of ['exact strategy and completed backtest fingerprints are required','whole-account review requires the complete broker position roster'])test('actual draft review reports only a canonical native refusal: '+reason,async t=>{
 const h=await fixture(t),original=h.ctx.intent;
 h.ctx.intent=async(name,input)=>{if(name==='trading.orders.mandate.prepare')throw Error('secret=must-not-appear '+reason+' private-provider-payload');return original(name,input);};
 const r=await h.req('/live/mandate',{watchId:h.watch.id,capitalCents:90000});
 assert.equal(r.status,503);assert.equal(r.error,'native_broker_refused');assert.equal(r.message,'Broker mandate.prepare: '+reason);assert.equal(h.count(),0);
});


test('stale holdings remain visible and deferred while independently quoted whole-account sales proceed',async t=>{
 const h=await fixture(t,{whole:true,positions:[{symbol:'AAA',qty:1,marketValue:1},{symbol:'ABC',qty:10,marketValue:1000}],cash:0,equity:1001,capitalCents:100000});
 h.setQuote('AAA',{tradePrice:1,tradeAt:'2026-10-23T19:59:00Z'});
 const review=await h.req('/live/mandate',{watchId:h.watch.id,capitalCents:100000,scope:'whole-account'});
 assert.equal(review.review.activationReady,true,JSON.stringify(review));
 assert.ok(review.review.actionEligibility.find(a=>a.symbol==='AAA').blockers.some(b=>b.code==='quote_stale'));
 assert.deepEqual(review.review.actionEligibility.find(a=>a.symbol==='ABC').blockers,[]);
 await h.activate();let tick=await h.req('/watch/tick',{});
 assert.equal(tick.ordersSubmitted,1,JSON.stringify(tick));assert.equal(h.tickets[0].terms.symbol,'ABC');assert.equal(h.tickets[0].terms.side,'sell');h.fill();
 for(let i=0;i<10;i++){tick=await h.req('/watch/tick',{});if(tick.ordersSubmitted)h.fill();else break;}
 assert.equal(tick.receipts[0].status,'waiting-for-position-review',JSON.stringify(tick));
 assert.equal(tick.receipts[0].automation.deferred[0].symbol,'AAA');assert.equal(h.tickets.some(t=>t.terms.symbol==='AAA'),false);
 const cycle=JSON.parse([...h.records.values()].find(r=>r.kind==='live-cycle').payload);assert.equal(cycle.status,'in-progress');assert.equal(cycle.completedAt,undefined);
 h.setQuote('AAA',{tradePrice:1,tradeAt:'2026-10-26T16:00:00Z'});tick=await h.req('/watch/tick',{});
 assert.equal(tick.ordersSubmitted,1,JSON.stringify(tick));assert.equal(h.tickets.at(-1).terms.symbol,'AAA');
});
test('whole-account deleveraging prioritizes the largest reviewed sale and still waits for its actual fill',async t=>{
 const h=await fixture(t,{whole:true,positions:[{symbol:'AAA',qty:1,marketValue:100},{symbol:'XYZ',qty:20,marketValue:2000}],cash:0,equity:1100,capitalCents:100000,balanceFacts:{marginBalance:-1000,debitBalance:null}});
 for(const symbol of ['AAA','XYZ'])h.setQuote(symbol,{tradeAt:'2026-10-26T16:00:00Z'});
 const review=await h.req('/live/mandate',{watchId:h.watch.id,capitalCents:100000,scope:'whole-account'});assert.equal(review.review.proposal.actions[0].symbol,'XYZ');
 await h.activate();const tick=await h.req('/watch/tick',{});assert.equal(tick.ordersSubmitted,1,JSON.stringify(tick));assert.equal(h.tickets[0].terms.symbol,'XYZ');
 assert.equal((await h.req('/watch/tick',{})).ordersSubmitted,0);assert.equal(h.count(),1);
});
test('symbol-bearing unverified quote sources and unknown errors remain global while cash facts still govern buys',()=>{
 const {actionBlockers,positionScopedBlocker}=require('../routes/live/allocation');
 const stale={code:'quote_stale',symbol:'AAA'},source={code:'quote_source_unverified',symbol:'AAA'},unknown={code:'unexpected',symbol:'AAA'},cash={code:'settled_cash_unknown'};
 assert.deepEqual(actionBlockers({blockers:[stale]},'sell','BBB'),[]);assert.deepEqual(actionBlockers({blockers:[stale]},'sell','AAA'),[stale]);
 for(const blocker of [source,unknown]){assert.equal(positionScopedBlocker(blocker,'AAA'),false);assert.deepEqual(actionBlockers({blockers:[blocker]},'sell','BBB'),[blocker]);}
 assert.deepEqual(actionBlockers({blockers:[cash]},'buy','BBB'),[cash]);assert.deepEqual(actionBlockers({blockers:[cash]},'sell','BBB'),[]);
 assert.equal(positionScopedBlocker({code:'quote_stale'},'AAA'),false);
});

test('an unverified quote source blocks actual automatic routes across all holdings, not just that symbol',async t=>{
 const h=await fixture(t,{whole:true,positions:[{symbol:'ABC',qty:10,marketValue:1000}],cash:0,equity:1000,capitalCents:100000});await h.activate();
 h.setQuote('ABC',{source:'unknown'});const tick=await h.req('/watch/tick',{});
 assert.equal(tick.ordersSubmitted,0,JSON.stringify(tick));assert.equal(tick.receipts[0].status,'blocked');assert.ok(tick.receipts[0].automation.blockers.some(b=>b.code==='quote_source_unverified'));assert.equal(h.count(),0);
});
test('deferred holdings cannot cause a buy above the native capital cap',async t=>{
 const h=await fixture(t,{whole:true,positions:[{symbol:'AAA',qty:1,marketValue:100},{symbol:'ABC',qty:10,marketValue:1000}],cash:0,equity:1100,capitalCents:100000});
 h.setQuote('AAA',{tradeAt:'2026-10-23T19:59:00Z'});await h.activate();await h.req('/watch/tick',{});h.fill();
 const tick=await h.req('/watch/tick',{});assert.equal(tick.ordersSubmitted,0,JSON.stringify(tick));assert.equal(tick.receipts[0].status,'waiting-for-capital-capacity');assert.equal(h.count(),1);
});
