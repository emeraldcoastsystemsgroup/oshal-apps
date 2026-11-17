/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.57.1: each next step names the content it shows; Review blockers lists exactly the holdings the watcher's record names (deferred changes, recorded blockers, changed holdings, the order it stopped at) with plain reasons and steps, marks only those rows, says what an unnamed record leaves out, escapes and caps the list.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Map retained status to local guidance without modifying the classifier, distinguish zero submitted from unknown, and retain conservative outcomes for stale or foreign evidence.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the shipped pure account-status reader with synthetic retained receipts: separate settings and schedules from outcomes, retain failures and dates, reject wrong-account/strategy evidence and stale signals, preserve unknown amounts, and show actual target/holding differences without declaring a Treasury position parked.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Status=require('../tools/ui/native-account-status');
const NOW=Date.parse('2026-11-12T18:50:00Z');
function fixture(){
 const account={accountId:'fixture-account',connectionKey:'fixture-connection',strategyId:'fixture-strategy',label:'Synthetic brokerage',kind:'live'};
 const receipt={...account,observedAt:'2026-11-12T18:49:45Z',accountEquity:10000,reportedCash:0,status:'aligned',
  positions:[{symbol:'BIL',qty:100,marketValue:10000}],workingOrders:[],brokerOrders:[],
  signal:{signalAsOf:'2026-11-11',decisionAsOf:'2026-10-30',evidenceThrough:'2026-10-30',targets:[{symbol:'BIL',weightPct:100}]}};
 const watch={...account,enabled:true,automatedTrading:true,authority:{active:true,status:'active'},lastRunAt:receipt.observedAt,lastReceipt:receipt};
 return {account,watch,schedule:{status:'active',nextRunAt:'2026-11-12T18:51:00Z'},latestSession:'2026-11-11',now:NOW};
}
test('a current monthly decision can be old while its completed-session check is current',()=>{
 const f=fixture(),model=Status.live(f);
 assert.equal(model.label,'Aligned');assert.equal(model.receiptFresh,true);
 assert.equal(model.decisionAsOf,'2026-10-30');assert.equal(model.signalAsOf,'2026-11-11');
 assert.deepEqual(model.comparison,[{symbol:'BIL',targetPct:100,heldPct:100,quantity:100}]);
 const html=Status.html(model);assert.match(html,/Target weight/);assert.match(html,/Held weight/);
 assert.match(html,/2026-11-12T18:49:45Z/);assert.match(html,/Setting: Armed · Live approval: Active · Schedule: active/);
 assert.doesNotMatch(html,/Parked|profit.*\$/i);
});
test('armed, monitoring and approval-required are distinct from verified execution',()=>{
 const f=fixture();delete f.watch.lastReceipt;
 assert.equal(Status.live(f).label,'Armed');
 f.watch.automatedTrading=false;f.watch.authority={active:false,status:'not-enabled'};
 assert.equal(Status.live(f).label,'Monitoring');
 f.watch.automatedTrading=true;f.watch.authority={active:false,status:'expired'};
 assert.equal(Status.live(f).label,'Review blocked');assert.match(Status.live(f).detail,/expired/);
});
test('the actual latest failure cannot be hidden by a previous aligned receipt or an active schedule',()=>{
 const f=fixture();f.watch.lastError='Connected account roster could not be read';
 f.watch.lastRunAt='2026-11-12T18:49:59Z';
 const model=Status.live(f);assert.equal(model.label,'Review blocked');assert.match(model.detail,/roster could not be read/);
 assert.match(Status.html(model),/2026-11-12T18:49:59Z/);assert.match(Status.html(model),/2026-11-12T18:49:45Z/);
 f.watch.lastRunAt='2026-11-12T18:48:00Z';assert.equal(Status.live(f).label,'Aligned','an older failure cannot replace the newer successful receipt');
});
test('a live receipt retains position review blockers and the exact targets alongside actual holdings',()=>{
 const f=fixture();f.watch.lastReceipt.automation={status:'waiting-for-position-review',deferred:[{blockers:[{message:'Synthetic holding needs review.'}]}]};
 f.watch.lastReceipt.positions=[{symbol:'ABC',qty:20,marketValue:5000},{symbol:'BIL',qty:50,marketValue:5000}];
 const model=Status.live(f);assert.equal(model.label,'Review blocked');assert.match(model.detail,/positions need review/);
 assert.deepEqual(model.reasons,['Synthetic holding needs review.']);
 assert.deepEqual(model.comparison,[{symbol:'ABC',targetPct:0,heldPct:50,quantity:20},{symbol:'BIL',targetPct:100,heldPct:50,quantity:50}]);
});
test('broker orders pending are not fills; a quiet aligned check is not a claim of trading or parking',()=>{
 const f=fixture();f.watch.lastReceipt.workingOrders=[{orderId:'fixture-order',status:'WORKING'}];
 assert.equal(Status.live(f).label,'Order pending');assert.match(Status.live(f).detail,/not a confirmed fill/);
 f.watch.lastReceipt.workingOrders=[];assert.equal(Status.live(f).label,'Aligned');
});
test('a completed cycle with mismatched holdings does not establish alignment',()=>{
 const f=fixture();f.watch.lastReceipt.positions[0].marketValue=5000;
 for(const [status,label] of [['cycle-completed','Cycle complete'],['cycle-completed-with-exceptions','Cycle complete with exceptions']]){
  f.watch.lastReceipt.automation={status};const model=Status.live(f);
  assert.equal(model.label,label);assert.equal(model.comparison[0].heldPct,50);assert.doesNotMatch(Status.html(model),/Aligned/);
 }
});
test('calendar proof and a strict boolean approval are required for a current outcome',()=>{
 const f=fixture();delete f.latestSession;assert.equal(Status.live(f).label,'Status unknown');assert.equal(Status.live(f).receiptFresh,false);
 f.latestSession='2026-11-11';for(const active of ['false','true',1]){
  f.watch.authority.active=active;assert.equal(Status.live(f).label,'Review blocked');assert.notEqual(Status.live(f).approval,'Active');
 }
});
test('malformed receipt arrays fail closed rather than crash the account page',()=>{
 for(const change of [
  r=>{r.positions={symbol:'ABC'};},r=>{r.signal.targets=[null];},r=>{r.workingOrders='orders';},
  r=>{r.automation={status:'aligned',blockers:{message:'bad shape'}};},
  r=>{r.automation={status:'aligned',deferred:[null]};},r=>{r.proposal={blockers:'bad shape'};},
 ]){
  const f=fixture();change(f.watch.lastReceipt);const model=Status.live(f);
  assert.equal(model.label,'Status unknown');assert.doesNotThrow(()=>Status.html(model));
 }
});
test('paused configuration and inactive schedules do not read as running',()=>{
 const f=fixture();f.watch.enabled=false;assert.equal(Status.live(f).label,'Paused');
 f.watch.enabled=true;f.schedule.status='suspended';f.schedule.reason='owner_paused';
 assert.equal(Status.live(f).label,'Paused');assert.match(Status.live(f).detail,/owner_paused/);
 f.schedule=null;assert.equal(Status.live(f).label,'Status unknown');
});
test('stale, future and missing check timestamps and signal sessions never establish a current outcome',()=>{
 for(const observedAt of ['2026-11-12T18:00:00Z','2026-11-12T19:00:00Z',null,'invalid']){
  const f=fixture();f.watch.lastReceipt.observedAt=observedAt;
  assert.equal(Status.live(f).label,'Status unknown');assert.equal(Status.live(f).receiptFresh,false);
 }
 for(const signalAsOf of ['2026-10-30',null]){
  const f=fixture();f.watch.lastReceipt.signal.signalAsOf=signalAsOf;
  assert.equal(Status.live(f).label,'Status unknown');
 }
});
test('wrong account, connection or strategy receipts cannot provide targets or a successful outcome',()=>{
 for(const patch of [{accountId:'other'},{connectionKey:'other'},{strategyId:'other'}]){
  const f=fixture();Object.assign(f.watch.lastReceipt,patch);
  const model=Status.live(f);assert.equal(model.label,'Status unknown');assert.deepEqual(model.comparison,[]);
 }
 const f=fixture();f.watch.accountId='other';assert.deepEqual(Status.live(f).comparison,[]);
 f.watch.accountId=f.account.accountId;f.account.strategyId='replacement';assert.equal(Status.live(f).label,'Review blocked');
 f.account.strategyId=null;assert.equal(Status.live(f).label,'Review blocked');
});
test('unknown values and missing configuration are retained as unknown rather than zero or stopped',()=>{
 const f=fixture();delete f.watch.lastReceipt.accountEquity;delete f.watch.lastReceipt.positions;
 f.watch.lastReceipt.signal.targets[0].weightPct=null;
 assert.deepEqual(Status.live(f).comparison,[{symbol:'BIL',targetPct:null,heldPct:null,quantity:null}]);
 assert.match(Status.html(Status.live(f)),/<td>Unknown<\/td>/);
 delete f.watch.enabled;assert.equal(Status.live(f).label,'Status unknown');
 assert.equal(Status.live().label,'Status unknown');
});
test('account status rendering escapes source strings and performs no I/O',()=>{
 const f=fixture();f.watch.lastError='<img src=x onerror=bad>';const model=Status.live(f);
 const before=JSON.stringify(f),html=Status.html(model);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);
 assert.equal(JSON.stringify(f),before);assert.match(Status.html(model,{compact:true}),/Last check/);
});
test('the shipped account dashboard keeps the actual failure and last-check date on its tile',async()=>{
 const f=fixture(),tile={...f.account,nativeReadOnly:true},reads=[];let painted;
 f.watch.lastError='Synthetic account source unavailable';
 const context=vm.createContext({NativeAccountStatus:Status,ACCT_TILES:[tile],stale:()=>false,$:()=>({}),
  sameNativeAccount:(a,b)=>a.accountId===b.accountId&&a.connectionKey===b.connectionKey,
  nativeProtectionLabel:()=> 'Unavailable',paperScheduleRow:async()=>f.schedule,paintTiles:tiles=>{painted=tiles;},
  api:async route=>{reads.push(route);if(route==='/portfolio')return{accounts:[f.account],researchWindow:{latestCompletedSession:f.latestSession}};
   if(route==='/portfolio/management')return{watches:[f.watch]};return{policies:[]};}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../tools/ui/native-account-details.js'),'utf8')+'\nglobalThis.run=loadNativeDashboardState;',context);
 await context.run(1);assert.match(painted[0].executionLabel,/Review blocked.*Synthetic account source unavailable.*Last check/);
 assert.deepEqual(reads,['/portfolio','/portfolio/management','/portfolio/backstops']);
});

function next(f){return Status.live(f).nextStep;}
test('local next steps retain the classifier precedence and never imply a trading operation',()=>{
 const cases=[
  [f=>{},'See targets and holdings','evidence','targets','Aligned'],
  [f=>{f.watch.lastReceipt.automation={status:'cycle-completed'};},'See targets and holdings','evidence','targets','Cycle complete'],
  [f=>{f.watch.lastReceipt.automation={status:'cycle-completed-with-exceptions'};},'See targets and holdings','evidence','targets','Cycle complete with exceptions'],
  [f=>{f.watch.lastReceipt.automation={status:'waiting-for-position-review'};},'Review blockers','evidence','blockers','Review blocked'],
  [f=>{f.watch.lastReceipt.workingOrders=[{orderId:'pending'}];},'Review recorded orders','evidence','orders','Order pending'],
  [f=>{f.watch.lastReceipt.automation={status:'protective-exit-awaiting-next-cycle'};},'Review last check','evidence','check','Paused'],
  [f=>{f.watch.enabled=false;},'Review setup','settings','settings','Paused'],
  [f=>{f.schedule.status='suspended';},'Review setup','settings','settings','Paused'],
  [f=>{f.watch.authority.active=false;},'Review setup','settings','settings','Review blocked'],
  [f=>{f.account.strategyId='replacement';},'Review setup','settings','settings','Review blocked'],
  [f=>{delete f.watch.lastReceipt;},'Review setup','settings','settings','Armed'],
  [f=>{f.watch.automatedTrading=false;},'Review last check','evidence','check','Monitoring'],
  [f=>{f.watch.lastError='Current failed read';},'Review last check','evidence','check','Review blocked'],
 ];
 for(const [change,label,destination,focus,outcome] of cases){const f=fixture();change(f);assert.deepEqual(next(f),{label,destination,focus});assert.equal(Status.live(f).label,outcome);}
});
test('unverified evidence remains a local last-check review rather than setup, refresh or an execution promise',()=>{
 for(const change of [f=>{delete f.latestSession;},f=>{f.watch.lastReceipt.observedAt='2026-11-12T17:00:00Z';},f=>{f.watch.lastReceipt.observedAt='2026-11-12T20:00:00Z';},f=>{f.watch.lastReceipt.accountId='foreign';},f=>{f.watch.lastReceipt.connectionKey='foreign';},f=>{f.watch.lastReceipt.strategyId='foreign';},f=>{f.watch.lastReceipt.positions=[null];},f=>{f.schedule=null;},f=>{f.watch.accountId='foreign';}]){
  const f=fixture();change(f);assert.deepEqual(next(f),{label:'Review last check',destination:'evidence',focus:'check'});assert.equal(Status.live(f).label,'Status unknown');
 }
});

// 1.57.1: "the review blockers button does nothing". The list names only what the watcher's record names.
function blocked(automation,positions=[{symbol:'AAA',qty:3,marketValue:300},{symbol:'BIL',qty:97,marketValue:9700}]){
 const f=fixture();f.watch.lastReceipt.automation=automation;f.watch.lastReceipt.positions=positions;return Status.live(f);
}
test('Review blockers lists each deferred holding with its plain reason and the step the person can take',()=>{
 const model=blocked({status:'waiting-for-position-review',deferred:[
  {symbol:'AAA',action:'sell',blockers:[{code:'protected_sale_requires_coordination',symbol:'AAA',message:'The planned sale overlaps broker-held protection.'}]},
  {symbol:'bil',action:'buy',blockers:[{code:'protective_exit_requires_new_signal',symbol:'BIL',message:'This instrument was sold by protection.'}]},
  {symbol:'CCC',action:'sell',blockers:[{code:'quote_stale',symbol:'CCC',message:'CCC: the trade is neither recent nor a reference from the last completed session.'}]}]});
 assert.equal(model.nextStep.label,'Review blockers');assert.deepEqual(model.blockers.rows.map(row=>[row.symbol,row.side]),[['AAA','sell'],['BIL','buy'],['CCC','sell']]);
 assert.equal(model.blockers.missing,null);
 const [sale,buy,stale]=model.blockers.rows.map(row=>row.reasons[0]);
 assert.match(sale.reason,/protective sell order at the broker/);assert.match(sale.step,/Watcher evidence & submitted orders/);assert.match(sale.step,/your own confirmed choice/);
 assert.match(buy.reason,/Protection sold this holding/);assert.match(buy.step,/^Nothing to do\. The strategy’s next signal decides whether to buy it again/);
 assert.match(stale.reason,/not recent enough/);assert.match(stale.step,/next watcher check reads the price again/);
 const html=Status.html(model);
 assert.match(html,/data-native-status-focus="blockers"/);assert.match(html,/Every other change in this allocation has filled/);assert.match(html,/AAA · Sell/);assert.match(html,/BIL · Buy/);
 assert.match(html,/data-native-status-show="blockers"/);
 assert.deepEqual([...html.matchAll(/<tr class="native-blocker-row"><td>([A-Z]+) /g)].map(m=>m[1]),['AAA','BIL'],'only rows the record names are marked; CCC is not in the table');
});
test('other blocked records name their holdings, an order or nothing, and say what the record leaves out',()=>{
 const changed=blocked({status:'holdings-changed-review-required',symbols:['AAA']});
 assert.deepEqual(changed.blockers.rows.map(row=>row.symbol),['AAA']);assert.match(changed.blockers.rows[0].reasons[0].reason,/different number of shares/);assert.equal(changed.blockers.rows[0].reasons[0].step,'The record names no step for this.');
 const rejected=blocked({status:'order-rejected',ticket:{terms:{symbol:'AAA',side:'buy'},orderId:'synthetic-order'}});
 assert.deepEqual(rejected.blockers.rows.map(row=>[row.symbol,row.side]),[['AAA','buy']]);assert.match(rejected.blockers.rows[0].reasons[0].reason,/rejected this allocation order\. Broker order synthetic-order\./);
 const global=blocked({status:'blocked',blockers:[{code:'settled_cash_unknown',message:'Broker-reported settled cash is unavailable.'},{code:'quote_source_unverified',symbol:'AAA',message:'AAA: unverified.'}]});
 assert.deepEqual(global.blockers.rows.map(row=>[row.symbol,row.whole]),[[null,true],['AAA',false]]);assert.equal(global.blockers.missing,null);
 assert.equal(global.blockers.rows[0].reasons[0].reason,'Broker-reported settled cash is unavailable.','an unlisted code keeps the record’s own words');
 assert.match(Status.html(global),/Whole account/);assert.doesNotMatch(Status.html(global),/Every other change/);
 const uncertain=blocked({status:'uncertain-order-review-required'});
 assert.deepEqual(uncertain.blockers.rows,[]);assert.match(uncertain.blockers.missing,/does not say which order/);assert.match(Status.html(uncertain),/does not say which order/);assert.doesNotMatch(Status.html(uncertain),/native-blocker-row/);
 const unnamed=blocked({status:'waiting-for-position-review',deferred:[{blockers:[{message:'Synthetic holding needs review.'}]}]});
 assert.equal(unnamed.blockers.rows[0].symbol,null);assert.match(unnamed.blockers.missing,/does not name the holding/);assert.match(Status.html(unnamed),/Holding not named in the record/);
 assert.equal(blocked({status:'cycle-completed'}).blockers,null,'no blocker list for an outcome that is not blocked');
 const failed=fixture();failed.watch.lastError='Current failed read';assert.equal(Status.live(failed).blockers,null,'a failed check is Review last check, not a blocker list');
});
test('blocker records are escaped, capped and never invent a holding from a malformed entry',()=>{
 const many=Array.from({length:25},(_,i)=>({symbol:'S'+i,action:'sell',blockers:[{code:'quote_stale',symbol:'S'+i}]}));
 const capped=blocked({status:'waiting-for-position-review',deferred:many});assert.equal(capped.blockers.rows.length,20);assert.equal(capped.blockers.more,5);assert.match(Status.html(capped),/5 more are in the record/);
 const hostile=blocked({status:'blocked',blockers:[{code:'x',symbol:'<img src=x onerror=bad>',message:'<script>bad()</script>'}]});
 const html=Status.html(hostile);assert.doesNotMatch(html,/<img|<script/);assert.match(html,/&lt;IMG SRC=X ONERROR=BAD&gt;/);
 const odd=blocked({status:'holdings-changed-review-required',symbols:[null,7,'AAA']});assert.deepEqual(odd.blockers.rows.map(row=>row.symbol),['AAA']);
 assert.doesNotThrow(()=>Status.html(blocked({status:'order-rejected',ticket:'not an object'})));
});
test('a retained zero is a dated submitted count and missing, negative or malformed counts stay unknown',()=>{
 for(const value of [0,2,null,undefined,-1,1.5,'0',NaN,Infinity]){
  const f=fixture();f.watch.lastReceipt.ordersSubmitted=value;const model=Status.live(f),valid=Number.isSafeInteger(value)&&value>=0;
  assert.equal(model.ordersSubmitted,valid?value:null);assert.match(Status.html(model),valid?new RegExp('recorded check: <strong>'+value):/recorded check: <strong>Unknown/);
  assert.doesNotMatch(Status.html(model),/Parked|no historical trading|trading is active/i);
 }
 const f=fixture();f.watch.lastReceipt.accountId='foreign';f.watch.lastReceipt.ordersSubmitted=9;assert.equal(Status.live(f).ordersSubmitted,null);
});
