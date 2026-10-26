/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the shipped portfolio endpoints over named synthetic owner/SQL/Schwab fixtures: persistence, every holding, retirement separation, historical evidence, failed reads, exact and stale approval refusal. No live broker writer exists in the fixture.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {application}=require('./support/native-portfolio-host');
const strategy=(extra={})=>({modelVersion:1,kind:'allocation',assets:[{symbol:'ABC',weightPct:100}],lookbackSessions:20,rebalanceSessions:20,topN:1,grossExposurePct:100,transactionCostBps:10,marginAprPct:null,maintenancePct:null,fractionalShares:false,...extra});
const binding={accountId:'a',connectionKey:'owned-login'};
async function host(t){const fixture=application();const server=await new Promise(resolve=>{const s=fixture.app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const req=async(path,body,owner='owner-a',method)=>{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/trading/portfolio'+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json','x-fixture-owner':owner},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,...await response.json()};};return{...fixture,req};}
test('saved account registration and review strategy persist; outside snapshots reconcile and remain owner isolated',async t=>{
 const h=await host(t),initial=await h.req('');assert.equal(initial.accounts[0].notWatchlisted,1);assert.equal(initial.accounts[0].constraints.group,'unclassified');
 const saved=await h.req('/strategies',{name:'Fixed research',config:strategy()});assert.ok(saved.strategy.id);
 const profile=await h.req('/profiles',{...binding,label:'Workplace plan',registration:'401k',strategyId:saved.strategy.id});assert.equal(profile.strategyAppliedToBroker,false);
 const refreshed=await h.req('');assert.equal(refreshed.accounts[0].constraints.group,'401k');assert.equal(refreshed.accounts[0].strategyId,saved.strategy.id);assert.equal(refreshed.capital.real.equity,10000);
 const foreign=await h.req('/profiles',{...binding,label:'Other',registration:'taxable',strategyId:saved.strategy.id},'owner-b');assert.equal(foreign.status,404);
 assert.equal((await h.req('/research',undefined,'owner-b')).strategies.length,0);
 const outside={provider:'Outside provider',label:'401k statement',asOf:'2026-10-25',registration:'401k',equity:5000,cash:1000,positions:[{symbol:'MUTUAL',qty:40,marketValue:4000}]};
 assert.equal((await h.req('/outside',{...outside,equity:9000})).error,'snapshot_unreconciled');
 const s=await h.req('/outside',outside);assert.equal(s.brokerVerified,false);assert.equal((await h.req('')).capital.real.equity,15000);
 assert.equal((await h.req('',undefined,'owner-b')).capital.real.equity,10000);
 assert.equal((await h.req('/outside/'+s.outside.id,{},'owner-b','DELETE')).status,404);
 assert.equal((await h.req('/outside/'+s.outside.id,{},'owner-a','DELETE')).removed,true);
 assert.equal((await h.req('')).capital.real.equity,10000);
});
test('historical runs preserve exact strategy/data, refuse foreign receipts and stale or unconfirmed research approval',async t=>{
 const h=await host(t);await h.req('/profiles',{...binding,label:'Taxable',registration:'taxable'});
 const saved=await h.req('/strategies',{name:'Research',config:strategy()});
 const completed=await h.req('/backtest',{...binding,strategyId:saved.strategy.id,startDate:'2026-01-02',endDate:'2026-10-23'});
 assert.equal(completed.run.status,'completed');assert.ok(completed.run.history.series.ABC.length>200);assert.equal(completed.run.result.realOrdersPlaced,0);assert.equal(completed.run.strategy.config.transactionCostBps,10);
 assert.equal((await h.req('/runs/'+completed.run.id,undefined,'owner-b')).status,404);
 const review=(await h.req('/reviews',{runId:completed.run.id})).review;assert.equal(review.status,'pending');assert.equal(review.liveExecutionAvailable,false);
 assert.equal((await h.req('/reviews/'+review.id+'/approve',{fingerprint:review.fingerprint})).status,428);
 const approved=await h.req('/reviews/'+review.id+'/approve',{confirm:true,fingerprint:review.fingerprint});assert.equal(approved.approval.status,'research-approved');assert.equal(approved.realOrdersPlaced,0);assert.equal(approved.borrowingAuthorized,false);
 const research=await h.req('/research');assert.equal(research.reviews.length,1);assert.equal(research.reviews[0].id,review.id);assert.equal(research.reviews[0].status,'research-approved');
 const retried=await h.req('/reviews/'+review.id+'/approve',{confirm:true,fingerprint:review.fingerprint});assert.equal(retried.approval.id,approved.approval.id);assert.equal(retried.approval.approvedAt,approved.approval.approvedAt);
 h.accounts[0].cash=999;
 assert.equal((await h.req('/reviews/'+review.id+'/approve',{confirm:true,fingerprint:review.fingerprint})).error,'account_changed');
 assert.ok(h.calls.filter(c=>c.intent).every(c=>['trading.accounts','trading.bars'].includes(c.intent)));
 for(const call of h.calls.filter(c=>c.sql))assert.equal(call.args[0]==='owner-a'||call.args[1]==='owner-a'||call.args[0]==='owner-b'||call.args[1]==='owner-b',true,'SQL carries explicit owner');
});
test('retirement leverage is refused and missing daily coverage is saved as unavailable, never an empty successful backtest',async t=>{
 const h=await host(t);await h.req('/profiles',{...binding,label:'401k',registration:'401k'});
 const saved=await h.req('/strategies',{name:'Levered research',config:strategy({grossExposurePct:150,marginAprPct:12,maintenancePct:30})});
 assert.equal((await h.req('/backtest',{...binding,strategyId:saved.strategy.id,startDate:'2026-01-02',endDate:'2026-10-23'})).error,'retirement_or_cash_leverage_refused');
 await h.req('/profiles',{...binding,label:'Taxable',registration:'taxable'});h.setBadHistory(true);
 const unavailable=await h.req('/backtest',{...binding,strategyId:saved.strategy.id,startDate:'2026-01-02',endDate:'2026-10-23'});
 assert.equal(unavailable.completed,false);assert.equal(unavailable.run.status,'insufficient_or_unavailable');assert.equal(unavailable.run.result,undefined);
 assert.equal((await h.req('/reviews',{runId:unavailable.run.id})).error,'completed_backtest_required');
 assert.equal((await h.req('/backtest',{...binding,strategyId:saved.strategy.id,startDate:'2026-01-02',endDate:'2027-10-23'})).run.status,'failed');
});

test('legacy native Lab cannot acknowledge a placeholder save or empty successful backtest',async t=>{
 const path=require('node:path'),{standIns,loadShipped}=require('./support/native-landing-host');
 const toolchain=path.resolve(process.env.STORE_CI_TOOLCHAIN||(process.env.OSHAL_FRAMEWORK?path.join(process.env.OSHAL_FRAMEWORK,'node_modules'):path.resolve(__dirname,'../../scripts/toolchain/node_modules'))),express=require(path.join(toolchain,'express'));
 const modules=standIns({express});modules['@/features/trading']={nativeSchwabReads:true,RISK_POLICIES:{},DEFAULT_UNIVERSE:[]};
 modules['@/features/agent-management']={BotNodeClient:class{},createRegistryEndpointResolver:()=>null};
 const app=express();app.use(express.json());app.use((req,_res,next)=>{req.userSub='own';next();});
 const router=loadShipped(modules,load=>load('trading-strategy-lab-routes').createTradingStrategyLabRoutes({pool:{}}));app.use('/lab',router);
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 for(const route of ['/strategies','/strategies/fake/backtest']){const response=await fetch('http://127.0.0.1:'+server.address().port+'/lab'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,503);assert.equal((await response.json()).error,'native_lab_unavailable');}
});

test('research reviews need explicit classification, current outside statements and unexpired exact confirmation',async t=>{
 const h=await host(t),saved=await h.req('/strategies',{name:'Review research',config:strategy()});
 const completed=await h.req('/backtest',{...binding,strategyId:saved.strategy.id,startDate:'2026-01-02',endDate:'2026-10-23'});
 assert.equal((await h.req('/reviews',{runId:completed.run.id})).error,'account_classification_required');
 await h.req('/profiles',{...binding,label:'Taxable',registration:'taxable'});
 const review=(await h.req('/reviews',{runId:completed.run.id})).review;assert.equal(review.strategyName,'Review research');assert.equal(review.backtest.window.lastSession,'2026-10-23');
 h.setNow('2026-10-25T06:15:00Z');assert.equal((await h.req('/reviews/'+review.id+'/approve',{confirm:true,fingerprint:review.fingerprint})).error,'review_expired');
 const outside=(await h.req('/outside',{provider:'Old statement provider',label:'Stale plan',asOf:'2026-09-01',registration:'401k',accountType:'cash',equity:10000,cash:10000,positions:[]})).outside;
 const result=await h.req('/backtest',{accountId:outside.account.accountId,connectionKey:'outside',strategyId:saved.strategy.id,startDate:'2026-01-02',endDate:'2026-10-23'});assert.equal(result.run.status,'completed');
 assert.equal((await h.req('/reviews',{runId:result.run.id})).error,'outside_statement_stale');
});

test('outside statement refresh and re-add remember the assigned strategy and established account category',async t=>{
 const h=await host(t),strategyRecord=(await h.req('/strategies',{name:'Remember this plan',config:strategy()})).strategy;
 const statement={provider:'Plan provider',label:'Workplace plan',asOf:'2026-10-24',registration:'401k',accountType:'cash',equity:10000,cash:10000,positions:[]};
 const first=(await h.req('/outside',statement)).outside;
 await h.req('/profiles',{accountId:first.account.accountId,connectionKey:'outside',registration:'401k',label:'My retirement account',strategyId:strategyRecord.id});
 const refreshed=await h.req('/outside',{...statement,asOf:'2026-10-25',registration:'unknown',equity:9500,cash:9500});assert.equal(refreshed.preservedReviewSettings,true);
 let account=(await h.req('')).accounts.find(a=>a.accountId===first.account.accountId);
 assert.equal(account.equity,9500);assert.equal(account.constraints.group,'401k');assert.equal(account.strategyId,strategyRecord.id);assert.equal(account.label,'My retirement account');
 await h.req('/outside/'+first.id,{},'owner-a','DELETE');await h.req('/outside',statement);
 account=(await h.req('')).accounts.find(a=>a.accountId===first.account.accountId);assert.equal(account.strategyId,strategyRecord.id);assert.equal(account.constraints.group,'401k');
});
