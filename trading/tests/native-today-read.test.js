/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | GET /paper/today (1.57.0), on invented accounts: it sends SELECT statements only, opens no transaction and calls no kernel intent; it says from saved records whether an account runs and how much of its plan is the strategy's fallback, what was sent and filled today in New York time, and why the value moved in two parts that add up; a receipt for another account or strategy, an unreadable list and a missing figure stay unknown; another person's rows never appear; and none of its files joins the order-authority set.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {OWNER,ACCOUNT,createTodayDb,brokerOrder,receipt,seedConnected,seedPaper}=require('./support/today-fixtures');
const {accountKey}=require('../routes/trading-portfolio-model');
const NOW=new Date('2026-11-12T18:50:00.000Z'),ROOT=path.resolve(__dirname,'..');
const routes=()=>require('../routes/trading-paper-routes');
const read=(db,owner=OWNER,now=NOW)=>require('../routes/today/read').todayRead({pool:db.pool},owner,now);

test('GET /paper/today is a registered read that refuses a caller who is not admitted',async()=>{
 const db=createTodayDb(),registered=[],router={};
 for(const method of ['get','post'])router[method]=(route,handler)=>registered.push({method,route,handler});
 routes().createTradingPaperRoutes({pool:db.pool},()=>router);
 const today=registered.find(r=>r.method==='get'&&r.route==='/today');
 assert.ok(today,'GET /today is mounted on the paper router');
 const answer=req=>new Promise(resolve=>{const res={status(code){this.code=code;return this;},json(body){resolve({status:this.code,body});}};today.handler(req,res);});
 assert.equal((await answer({headers:{}})).status,401);
 assert.equal(db.log.length,0,'nothing is read for a caller who is not admitted');
 const ok=await answer({oshalCallerSub:OWNER,headers:{}});
 assert.equal(ok.status,200);assert.equal(ok.body.ok,true);assert.deepEqual(ok.body.connected,[]);
});

test('the read sends SELECT statements only, opens no transaction and never calls a kernel intent',async()=>{
 const db=createTodayDb(),intents=[];seedConnected(db);seedPaper(db,'paper');seedPaper(db,'example-paper');
 const ctx={pool:db.pool,intent:async name=>{intents.push(name);throw new Error('the today read must not call '+name);}};
 const out=await routes().paperHandlers(ctx,()=>NOW).today({oshalCallerSub:OWNER,headers:{}});
 assert.equal(out.status,200);assert.equal(out.body.connected.length,1);assert.equal(out.body.paper.length,2);
 assert.ok(db.log.length>10,'the fixture was really read');
 for(const text of db.log)assert.match(text,/^\s*SELECT\b/,'not a read: '+text.slice(0,80));
 assert.deepEqual(intents,[],'no broker, price or order service is reached');
 for(const file of ['routes/today/read.js','routes/today/connected.js','routes/today/paper.js'])
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT,file),'utf8'),/\.intent\s*\(|trading\.orders\.|INSERT INTO|UPDATE [a-z_]+ SET|DELETE FROM|saveRecord|removeRecord/,file+' reads only');
});

test('a running account says how much of its plan is the strategy\'s fallback, and when the plan was decided',async()=>{
 const db=createTodayDb();seedConnected(db);
 const out=await read(db),a=out.connected[0];
 assert.equal(out.sessionDate,'2026-11-12');assert.equal(out.latestCompletedSession,'2026-11-11');assert.equal(out.marketOpen,true);
 assert.equal(a.label,'Example margin ···0001');assert.equal(a.strategy.name,'Example monthly trend');
 assert.deepEqual([a.plan.cadence,a.plan.decisionAsOf,a.plan.fallbackSymbol,a.plan.fallbackPct,a.plan.fundsInPlan,a.plan.funds,a.plan.nextDecisionUses],
  ['monthly','2026-10-30','BIL',60,2,5,'2026-11-30']);
 assert.deepEqual(a.plan.targets,[{symbol:'SPY',weightPct:20},{symbol:'GLD',weightPct:20},{symbol:'BIL',weightPct:60}]);
 assert.deepEqual([a.monitor.enabled,a.monitor.automatedTrading,a.monitor.heartbeatAt],[true,true,'2026-11-12T18:49:00.000Z']);
 assert.deepEqual(a.monitor.approval,{status:'active',active:true,asOf:'2026-11-12T18:45:00.000Z',expiresAt:'2026-12-02T15:00:00.000Z',capitalUsd:30000,scope:'whole-account',cadence:'monthly'});
 assert.deepEqual(a.status.watch.authority,{status:'active',active:true});
 assert.equal(a.status.account.strategyId,a.strategy.id);assert.equal(a.status.watch.lastReceipt.automation.status,'cycle-completed');
 assert.equal(a.holdings.at,'2026-11-12T18:45:00.000Z');assert.equal(a.holdings.positions[0].weightPct,59.83);
});

test('an approval that has run out is said as of the last check, and a daily plan reports its target cash and market check',async()=>{
 const db=createTodayDb();
 seedConnected(db,{receipt:{signal:{model:'portfolio-daily-v3',signalAsOf:'2026-11-11',decisionAsOf:'2026-11-11',evidenceThrough:'2026-11-11',rebalanceCadence:'completed-session-daily',
  targets:[{symbol:'SPY',weightPct:15},{symbol:'IEF',weightPct:10}],cashWeightPct:75,marketRiskOn:false},
  automation:{status:'mandate-inactive',mandate:{status:'active',effectiveStatus:'active',expiresAtMs:Date.parse('2026-11-10T00:00:00Z'),terms:{capitalCents:100000,cadence:'daily'}}}}});
 const a=(await read(db)).connected[0];
 assert.deepEqual([a.plan.cadence,a.plan.fallbackSymbol,a.plan.fallbackPct,a.plan.cashWeightPct,a.plan.marketRiskOn,a.plan.nextDecisionUses],['daily',null,75,75,false,null]);
 assert.deepEqual(a.status.watch.authority,{status:'expired',active:false});assert.equal(a.monitor.approval.active,false);
});

test('today counts what was sent and filled in New York time, by who sent it, and keeps uncertain attempts apart',async()=>{
 const db=createTodayDb();
 const orders=[brokerOrder('9101','SELL','GLD',4,377.5,'2026-11-12T15:02:00.000Z'),brokerOrder('9102','BUY','BIL',16,91.4,'2026-11-12T15:07:00.000Z'),
  brokerOrder('9103','SELL','SPY',1,686,'2026-11-12T16:00:00.000Z'),brokerOrder('9104','BUY','SPY',2,680,'2026-11-12T17:00:00.000Z',{status:'REJECTED'}),
  brokerOrder('9105','BUY','GLD',1,370,'2026-11-12T17:30:00.000Z',{status:'WORKING'}),
  brokerOrder('9001','BUY','BIL',41,91.52,'2026-11-12T04:59:00.000Z'),brokerOrder('9106','BUY','BIL',1,91.4,'2026-11-12T05:00:00.000Z')];
 const tickets=[{ticketId:'t1',orderId:'9101',status:'submitted',mandateId:'fixture-mandate'},{ticketId:'t2',orderId:'9102',status:'submitted',mandateId:'fixture-mandate'},
  {ticketId:'t3',orderId:'9103',status:'submitted',protectionMandateId:'fixture-protection'},{ticketId:'t4',orderId:null,status:'unknown',mandateId:'fixture-mandate'}];
 seedConnected(db,{receipt:{brokerOrders:orders,nativeTickets:tickets,ordersSubmitted:1}});
 const t=(await read(db)).connected[0].today;
 assert.deepEqual(t.orders.entered,{total:6,strategy:2,watcherExit:1,oneOff:0,outside:3});
 assert.deepEqual([t.orders.refused,t.orders.working,t.orders.cancelled],[1,1,0]);
 assert.equal(t.fills.length,4,'the 04:59Z fill belongs to the day before in New York; the 05:00Z fill is today');
 assert.deepEqual(t.fills.map(f=>f.orderId).sort(),['9101','9102','9103','9106']);
 assert.deepEqual(t.fills.find(f=>f.orderId==='9103'),{at:'2026-11-12T16:00:00.000Z',symbol:'SPY',side:'SELL',quantity:1,price:686,notional:686,orderId:'9103',origin:'watcherExit'});
 assert.equal(t.uncertainAttempts,1);assert.equal(t.ordersSubmittedLastCheck,1);assert.equal(t.at,'2026-11-12T18:45:00.000Z');
 assert.equal(t.lastFill.orderId,'9103');assert.equal(t.all,undefined,'the sixty-day list is not sent to the page');
});

test('the value change is two parts that add up to the cent, and a missing figure leaves the change alone',async()=>{
 const plain=createTodayDb();seedConnected(plain);
 const v=(await read(plain)).connected[0].value;
 assert.deepEqual([v.now.equity,v.prior.day,v.prior.equity,v.change],[31204.18,'2026-11-11',31216.58,-12.4]);
 assert.deepEqual(v.parts,{prices:-14.9,otherCash:2.5,bought:0,sold:0});assert.equal(Math.round((v.parts.prices+v.parts.otherCash)*100),Math.round(v.change*100));
 const traded=createTodayDb();
 seedConnected(traded,{receipt:{reportedCash:1820.5,brokerOrders:[brokerOrder('9101','SELL','GLD',4,377.5,'2026-11-12T15:02:00.000Z')]}});
 const w=(await read(traded)).connected[0].value;
 assert.deepEqual(w.parts,{prices:-14.9,otherCash:2.5,bought:0,sold:1510});assert.equal(Math.round((w.parts.prices+w.parts.otherCash)*100),Math.round(w.change*100));
 const noCash=createTodayDb();seedConnected(noCash,{receipt:{reportedCash:null}});
 const x=(await read(noCash)).connected[0].value;
 assert.equal(x.change,-12.4);assert.equal(x.parts,null);assert.deepEqual(x.unknown,['cash']);
 const first=createTodayDb();seedConnected(first,{receipt:{observedAt:'2026-11-11T18:45:00.000Z'}});
 const y=(await read(first)).connected[0].value;
 assert.equal(y.prior,null);assert.equal(y.change,null);assert.deepEqual(y.unknown,['prior']);
});

test('an order list that cannot be read is unknown, never an empty day or a zero',async()=>{
 const db=createTodayDb();seedConnected(db,{receipt:{brokerOrders:'unreadable',nativeTickets:[null],positions:[null]}});
 const a=(await read(db)).connected[0];
 assert.equal(a.today.orders,null);assert.equal(a.today.fills,null);assert.equal(a.today.uncertainAttempts,null);
 assert.equal(a.value.change,-12.4);assert.equal(a.value.parts,null);assert.deepEqual(a.value.unknown,['fills']);
 assert.equal(a.holdings.positions,null);assert.equal(a.status.watch.lastReceipt.positions,null,'the status reader still sees an unreadable list');
});

test('a receipt for another account or another strategy is dropped, and nothing outside the listed fields is sent',async()=>{
 const db=createTodayDb(),{strategyId}=seedConnected(db,{receipt:{strategyId:'another-strategy',brokerOrders:[brokerOrder('FOREIGN-ORDER-DO-NOT-SHOW','BUY','SPY',1,1,'2026-11-12T15:00:00.000Z')]}});
 const a=(await read(db)).connected[0],sent=JSON.stringify(a);
 assert.deepEqual(a.status.watch.lastReceipt,{accountId:null},'the status reader is told a receipt exists and does not match');
 assert.equal(a.holdings,null);assert.equal(a.today,null);assert.equal(a.value,null);assert.equal(a.strategy.id,strategyId);
 assert.doesNotMatch(sent,/FOREIGN-ORDER-DO-NOT-SHOW/);
 const clean=createTodayDb();seedConnected(clean);
 assert.doesNotMatch(JSON.stringify(await read(clean)),/DO-NOT-SHOW|fingerprint|accountNumber|mandateId/);
});

test('one person never receives another person\'s accounts, and the list says when it is cut at its bound',async()=>{
 const db=createTodayDb();seedConnected(db);seedPaper(db,'example-paper');
 const other=await read(db,'someone-else');
 assert.deepEqual(other.connected,[]);assert.deepEqual(other.paper,[{kind:'paper',ref:'paper',label:'Paper (reference book)',simulated:true,basis:'prices-only',opened:false}]);
 const many=createTodayDb();
 for(let i=0;i<9;i+=1){const account={accountId:'fixture-account-'+i,connectionKey:'fixture-login'};many.record(OWNER,'watch',{...account,strategyId:'s',enabled:true,automatedTrading:false},accountKey(account));}
 const out=await read(many);assert.equal(out.connected.length,8);assert.equal(out.cut.connected,true);
 const busy=createTodayDb();
 seedConnected(busy,{receipt:{brokerOrders:Array.from({length:60},(_,i)=>brokerOrder(String(9200+i),'BUY','BIL',1,91.4,'2026-11-12T15:00:00.000Z'))}});
 const t=(await read(busy)).connected[0].today;assert.equal(t.fills.length,50);assert.equal(t.fillsCut,true);
});

test('paper accounts answer from their own ledgers: the plan, today, a prices-only value, and archived ones left out',async()=>{
 const db=createTodayDb();seedPaper(db,'paper',{strategy:false});seedPaper(db,'example-paper');db.book(OWNER,'old-paper','Archived paper account',true);
 const out=await read(db),[reference,named]=out.paper;
 assert.equal(out.paper.length,2);assert.equal(out.archivedPaper,1);
 assert.deepEqual([reference.ref,reference.opened,reference.strategy,reference.plan],['paper',true,null,null]);
 assert.deepEqual([named.ref,named.label,named.simulated,named.basis,named.config.armed],['example-paper','Example paper account',true,'prices-only',true]);
 assert.deepEqual([named.strategy.name,named.strategy.lastResult,named.plan.fallbackSymbol,named.plan.fallbackPct,named.plan.decisionAsOf],['Example monthly trend','current','BIL',100,'2026-10-30']);
 assert.deepEqual(named.lastTick,{at:'2026-11-12T18:45:00.000Z',trigger:'schedule',outcome:'no_trade',orders:0});
 assert.deepEqual(named.passesToday,{count:2,withTrades:0,capped:false});assert.equal(named.lastScheduledTickAt,'2026-11-12T18:45:00.000Z');
 assert.deepEqual(named.today.fills,[]);assert.equal(named.today.lastFill.reason,'Strategy rebalance: Example monthly trend');
 assert.deepEqual([named.value.change,named.value.parts.prices,named.value.parts.costs,named.value.prior.day],[-41.5,-41.5,0,'2026-11-11']);
 assert.deepEqual(named.value.sinceStart,{startingCash:100000,startedAt:'2026-10-28T13:00:00.000Z',change:-131.04,pct:-0.13});
 assert.deepEqual(named.holdings.positions[0],{symbol:'BIL',qty:1092,avgCost:91.52,lastPrice:91.4,lastPriceAt:'2026-11-12T18:44:00.000Z',marketValue:99808.8,weightPct:99.94,unrealizedPl:-131.04});
});

test('none of the read\'s files joins the order-authority set, and the manifest sources are unchanged',()=>{
 const manifest=fs.readFileSync(path.join(ROOT,'oshal-app.yaml'),'utf8');
 assert.match(manifest,/orderAuthority:\s*\n\s*sources:\s*\n\s*-\s*routes\/trading-native-management\.js\s*\n\s*-\s*routes\/live\/management\.js\s*\n/);
 const seen=new Set(),pending=['routes/trading-native-management.js','routes/live/management.js'];
 while(pending.length){
  const rel=pending.pop();if(seen.has(rel))continue;seen.add(rel);
  for(const m of fs.readFileSync(path.join(ROOT,rel),'utf8').matchAll(/\brequire[ \t\r\n]*\([ \t\r\n]*(['"])(\.[^'"\n]+)['"][ \t\r\n]*\)/g)){
   const base=path.posix.normalize(path.posix.join(path.posix.dirname(rel),m[2]));
   const hit=[base,base+'.js',base+'/index.js'].find(c=>fs.existsSync(path.join(ROOT,c))&&fs.statSync(path.join(ROOT,c)).isFile());
   if(hit)pending.push(hit);
  }
 }
 assert.equal(seen.size,29,'the set approvals bind to is the same twenty-nine files');
 for(const file of ['routes/today/read.js','routes/today/connected.js','routes/today/paper.js','routes/trading-paper-routes.js'])assert.ok(!seen.has(file),file+' is outside it');
});
