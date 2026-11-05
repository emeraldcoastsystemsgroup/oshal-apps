/** CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Recreate the application against a reconnected disposable PostgreSQL database and verify exact two-margin/retirement assignments, settings and owner isolation. */
/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Exercise stock save, account binding, costed replay, native approval protocol, fills and duplicate prevention with a synthetic broker. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Named synthetic history/SQL/native-broker tests: exact account class, failed-validation refusal, persisted daily configuration, fractional leftovers, fresh cycles and replay safety. No live brokerage I/O. */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {PRESETS,normalizePolicy,hash,assertAccount}=require('../routes/strategy/policies');
const {signal}=require('../routes/strategy/signals');
const {validateReplay}=require('../routes/strategy/replay');
const {assertValidated}=require('../routes/strategy/authority');
const {simulatePortfolio,normalizePortfolioStrategy}=require('../routes/trading-portfolio-sim');
const {sessionDates}=require('../routes/trading-portfolio-calendar');
const {allocationFixture}=require('./support/native-allocation-host');
const binding={accountId:'a',connectionKey:'owned-login'};
const margin=PRESETS['quant-margin-daily'],retirement=PRESETS['retirement-defensive-daily'];
const stock=normalizePolicy({...PRESETS['quant-stock-daily'],assets:['AAA','BBB','CCC'].map(symbol=>({symbol,weightPct:100/3}))});
function history(config){const dates=sessionDates(config.kind==='quant-stock-daily'?'2024-08-01':'2025-01-02','2026-10-23');return Object.fromEntries([...config.assets,...(config.assets.some(a=>a.symbol==='SPY')?[]:[{symbol:'SPY'}])].map((a,j)=>[a.symbol,dates.map((date,i)=>({date,close:100*Math.exp((.001+j*.0001)*i+.00002*Math.sin(i/6))}))]));}
function input(c){return{series:history(c),startDate:'2025-10-23',endDate:'2026-10-23',startingCapital:100000};}
test('stored policy roundtrips without deployment defaults, fixes universe/version, and cannot borrow or cross account classes',()=>{
 for(const c of [margin,retirement]){const saved=normalizePortfolioStrategy(JSON.parse(JSON.stringify(c)));assert.deepEqual(saved,c);assert.equal(hash(saved),require('../routes/trading-portfolio-store').fingerprint(saved));}
 assert.throws(()=>normalizePolicy({...margin,borrowing:true}));assert.throws(()=>normalizePolicy({...margin,assets:[{symbol:'NEW',weightPct:100}]}));assert.throws(()=>normalizePolicy({...margin,grossExposurePct:110}));assert.throws(()=>normalizePolicy({...retirement,unknown:1}));
 assertAccount(margin,{accountType:'margin'},'taxable');assertAccount(retirement,{accountType:'cash'},'401k');assertAccount(retirement,{accountType:'cash'},'ira');
 for(const [c,type,reg] of [[margin,'cash','taxable'],[margin,'margin','ira'],[margin,'margin','401k'],[retirement,'margin','ira'],[retirement,'cash','taxable'],[retirement,'cash','unknown']])assert.throws(()=>assertAccount(c,{accountType:type},reg));
});
test('daily signal ignores future prices, checks complete benchmark sessions, and reconsiders a stopped name on a new session',()=>{
 const data=history(margin),asOf='2026-10-20',first=signal(margin,data,asOf),future=structuredClone(data);for(const rows of Object.values(future))for(const r of rows)if(r.date>asOf)r.close*=10;
 assert.deepEqual(signal(margin,future,asOf),first);
 const symbol=first.targets[0].symbol,stopped=signal(margin,data,asOf,{stops:{[symbol]:{session:asOf}}});assert.ok(!stopped.targets.some(t=>t.symbol===symbol));
 assert.ok(signal(margin,data,'2026-10-21',{stops:{[symbol]:{session:asOf}}}).targets.some(t=>t.symbol===symbol));
 const missing=structuredClone(data);missing.SPY.splice(-10,1);assert.throws(()=>signal(margin,missing,asOf),/missing benchmark/);
 assert.throws(()=>signal(margin,data,asOf,{riskState:{asOf:'2026-10-21'}}),/newer/);
});
test('one signal function drives costed next-session replay; full, held-out, doubled-cost and no-debt evidence are retained',()=>{
 for(const c of [margin,retirement]){const x=validateReplay(c,input(c));assert.ok(x.validation.passed,JSON.stringify(x.validation.reasons));assert.equal(x.result.window.sessions,252);assert.equal(x.result.holdout.sessions,126);assert.equal(x.validation.stress.costs.oneWayBps,50);assert.ok(x.result.curve.every(p=>p.cash>=0));assert.ok(x.result.rebalances.every(p=>p.decisionAsOf<p.fillDate));assert.deepEqual(simulatePortfolio(c,input(c)).validation,x.validation);}
});
test('retirement sale proceeds remain unsettled until the next exchange session',()=>{
 const i=input(retirement);for(const r of i.series.IEF)if(r.date>='2026-09-28')r.close*=.8;
 const x=validateReplay(retirement,i).result,p=x.curve.findIndex(p=>p.unsettledCash>0);assert.ok(p>=0,'fixture must actually sell');assert.ok(x.curve[p].cash>=0);for(let k=p;k<x.curve.length;k++){const fills=x.rebalances[k].fills,sales=fills.filter(f=>f.side==='sell').reduce((n,f)=>n+f.qty*f.price-f.cost,0),buys=fills.filter(f=>f.side==='buy').reduce((n,f)=>n+f.qty*f.price+f.cost,0);assert.ok(Math.abs(x.curve[k].unsettledCash-sales)<1e-6);if(k>0)assert.ok(Math.abs(x.curve[k].cash-(x.curve[k-1].cash+x.curve[k-1].unsettledCash-buys))<1e-6);}
 const bad=structuredClone(i);bad.series.SPY.splice(-3,1);assert.throws(()=>validateReplay(retirement,bad),/missing|coverage/);
});
test('completed losing, tampered or foreign evidence cannot become daily authority',()=>{
 const i=input(margin),x=validateReplay(margin,i),account={...binding,accountType:'margin'},run={...binding,status:'completed',strategy:{config:margin},history:{series:i.series},result:{...x.result,validation:x.validation}};
 assertValidated(run,margin,account,'taxable');
 assert.throws(()=>assertValidated({...run,result:{...run.result,validation:{...x.validation,passed:false}}},margin,account,'taxable'),/not passed/);
 const tampered=structuredClone(run);tampered.history.series.SPY[0].close*=2;assert.throws(()=>assertValidated(tampered,margin,account,'taxable'),/not passed/);
 assert.throws(()=>assertValidated(run,margin,{...account,accountId:'other'},'taxable'),/another account/);
});
async function dailyFixture(t,c=margin,options={}){
 const h=await allocationFixture(t);h.accounts[0].accountType=c===retirement?'cash':'margin';h.accounts[0].cash=10000;h.accounts[0].equity=10000;h.accounts[0].positions=structuredClone(options.positions||[]);h.accounts[0].cash-=h.accounts[0].positions.reduce((n,p)=>n+p.marketValue,0);
 if(c.kind==='quant-stock-daily'){const original=h.ctx.intent,series=history(c);h.ctx.intent=async(n,i)=>n==='trading.bars'?{source:'schwab',symbol:i.symbol,bars:series[i.symbol].map(r=>({t:Date.parse(r.date+'T05:00:00Z')/1000,c:r.close}))}:original(n,i);for(const a of c.assets)h.setQuote(a.symbol,{tradeAt:'2026-10-26T16:00:00Z'});}
 const saved=await h.req('/strategies',{name:c.name,config:c});assert.ok(saved.strategy?.id,JSON.stringify(saved));
 await h.req('/profiles',{...binding,label:'Synthetic daily account',registration:c===retirement?'401k':'taxable',strategyId:saved.strategy.id});
 const run=(await h.req('/backtest',{...binding,strategyId:saved.strategy.id,startDate:'2025-10-23',endDate:'2026-10-23'})).run;assert.equal(run?.status,'completed',JSON.stringify(run));assert.ok(run.result.validation.passed,JSON.stringify(run.result.validation));
 const response=await h.req('/watch',{runId:run.id,confirm:true});assert.ok(response.watch,JSON.stringify(response));
 const draft=await h.req('/live/mandate',{watchId:response.watch.id,capitalCents:1000000,...(options.positions?{scope:'whole-account'}:{})});assert.equal(draft.mandate?.terms.cadence,'daily',JSON.stringify(draft));assert.equal(draft.mandate.terms.accountClass,c.accountClass);assert.ok(draft.review.activationReady,JSON.stringify(draft.review));
 const original=h.ctx.intent;h.ctx.intent=async(name,arg)=>{const answer=await original(name,arg);if(name==='trading.orders.submit'){h.tickets.find(t=>t.ticketId===arg.ticketId).attemptedAtMs=Date.parse('2026-10-26T16:00:00Z');}return answer;};
 return {...h,run,watch:response.watch,draft,activate:()=>h.req('/live/activate',{watchId:response.watch.id,mandateId:draft.mandate.mandateId,fingerprint:draft.mandate.fingerprint,confirm:true,...(options.positions?{confirmAdoption:true}:{})})};
}
test('actual account routes persist and execute separate daily models through synthetic native approvals and acknowledged fills',async t=>{
 for(const c of [margin,retirement,stock]){
  const h=await dailyFixture(t,c);const activated=await h.activate();assert.equal(activated.watch?.executionMode,'automatic-daily',JSON.stringify(activated));
  const first=await h.req('/watch/tick',{});assert.equal(first.ordersSubmitted,1,JSON.stringify(first));assert.equal(h.count(),1);
  await h.req('/watch/tick',{});assert.equal(h.count(),1,'working order cannot replay after refresh');h.fill();
  for(let k=0;k<8;k++){const p=await h.req('/watch/tick',{});if(p.ordersSubmitted)h.fill();if(p.receipts?.[0]?.status==='cycle-completed')break;}
  const before=h.count();await h.req('/watch/tick',{});assert.equal(h.count(),before,'completed daily cycle is durable');
  const management=await h.req('/management');assert.equal(management.execution.automatedTradingAccounts,1);assert.equal(management.watches[0].mandate.terms.accountClass,c.accountClass);
  assert.ok([...h.records.values()].some(r=>r.kind==='strategy'&&JSON.parse(r.payload).config.modelVersion===3));
  assert.equal((await h.req('/live/mandate',{watchId:h.watch.id,capitalCents:1000000},'owner-b')).status,404);
 }
});
test('a monthly native release cannot silently downgrade a daily review or reuse old authority',async t=>{
 const h=await dailyFixture(t);await h.req('/live/stop',{watchId:h.watch.id});const original=h.ctx.intent;h.ctx.intent=async(n,i)=>{const out=await original(n,i);if(n==='trading.orders.mandate.prepare')out.terms.cadence='monthly';return out;};
 assert.equal((await h.req('/live/mandate',{watchId:h.watch.id,capitalCents:1000000})).error,'daily_native_release_required');assert.equal(h.count(),0);
});

test('fractional leftovers remain counted without blocking independent whole-share orders',async t=>{
 const h=await dailyFixture(t,margin,{positions:[{symbol:'ABC',qty:.4,marketValue:40,unmanaged:true}]});h.setQuote('ABC',{tradeAt:'2026-09-01T19:59:00Z'});assert.equal((await h.activate()).watch.executionMode,'automatic-daily');
 const tick=await h.req('/watch/tick',{});assert.equal(tick.ordersSubmitted,1,JSON.stringify(tick));assert.equal(h.accounts[0].positions.find(p=>p.symbol==='ABC').qty,.4);assert.ok(h.tickets.every(t=>t.terms.symbol!=='ABC'));
 const plan=tick.receipts[0].automation.plan;assert.ok(plan.rows.find(r=>r.symbol==='ABC').afterMarketValue>=40);assert.ok(!plan.blockers.some(b=>b.code==='fractional_residual_requires_review'));
});
test('failed validation blocks activation even after a draft exists, and account-type drift blocks scheduled orders',async t=>{
 const h=await dailyFixture(t);const record=[...h.records.values()].find(r=>r.record_id===h.run.id),payload=JSON.parse(record.payload);payload.result.validation.passed=false;record.payload=JSON.stringify(payload);assert.equal((await h.activate()).error,'daily_backtest_not_passed');assert.equal(h.count(),0);
 payload.result.validation.passed=true;record.payload=JSON.stringify(payload);await h.activate();h.accounts[0].accountType='cash';await h.req('/watch/tick',{});assert.equal(h.count(),0);
});

test('the maintained TypeScript source and shipped JavaScript preserve the same daily policy and decision behavior',()=>{
 const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('../../scripts/toolchain/node_modules/typescript');
 for(const name of ['sim','plan','routes']){const file=path.resolve(__dirname,'../src-routes/trading-portfolio-'+name+'.ts'),compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});assert.equal(compiled.diagnostics.length,0);if(name==='routes')continue;const filename=path.resolve(__dirname,'../routes/trading-portfolio-'+name+'.js'),m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));m._compile(compiled.outputText,filename);if(name==='sim'){assert.deepEqual(m.exports.normalizePortfolioStrategy(margin),normalizePortfolioStrategy(margin));assert.deepEqual(m.exports.portfolioNextTargets(margin,history(margin),'2026-10-23'),require('../routes/trading-portfolio-sim').portfolioNextTargets(margin,history(margin),'2026-10-23'));}}
});

test('a protective fill predating cycle creation blocks old-signal repurchase, not independent actions or a later signal',async t=>{
 const {protectiveSignalStops}=require('../routes/live/allocation'),h=await dailyFixture(t);await h.activate();
 const sold={ticketId:'before-cycle-stop',status:'submitted',allocationMandateId:'mandate-1',terms:{symbol:'DBC',side:'sell',quantity:1,orderType:'LIMIT',duration:'DAY'},attemptedAtMs:Date.parse('2026-10-26T15:55:00Z'),brokerStatus:{status:'FILLED',filledQuantity:1,executions:[{quantity:1,price:100,time:'2026-10-26T15:55:00Z'}]}};
 h.tickets.push({ticketId:'older-buy',status:'submitted',mandateId:'mandate-1',mandateFingerprint:'review',cycle:'2026-10-22',terms:{symbol:'DBC',side:'buy',quantity:1,limitCents:10000},attemptedAtMs:Date.parse('2026-10-23T15:55:00Z'),brokerStatus:{status:'FILLED',filledQuantity:1}},sold);
 const tick=await h.req('/watch/tick',{});assert.equal(tick.ordersSubmitted,1,JSON.stringify(tick));assert.notEqual(h.tickets.at(-1).terms.symbol,'DBC');assert.ok(tick.receipts[0].automation.deferred.some(d=>d.symbol==='DBC'&&d.blockers[0].code==='protective_exit_requires_new_signal'));
 const refreshed={...sold,lastObservedAtMs:Date.parse('2026-10-28T18:00:00Z')};assert.equal(protectiveSignalStops([refreshed],'mandate-1','2026-10-23').has('DBC'),true);assert.equal(protectiveSignalStops([refreshed],'mandate-1','2026-10-26').has('DBC'),false,'refresh cannot extend a cooldown past the next completed signal');
 const gtc={...sold,terms:{...sold.terms,duration:'GTC'},attemptedAtMs:Date.parse('2026-10-01T15:00:00Z')};assert.equal(protectiveSignalStops([gtc],'mandate-1','2026-10-23').has('DBC'),true,'a GTC submission date is not its later fill');assert.equal(protectiveSignalStops([{...gtc,brokerStatus:{status:'FILLED',filledQuantity:1}}],'mandate-1','2026-10-26').has('DBC'),true,'undated fills require per-symbol reconciliation');
 assert.equal(protectiveSignalStops([sold],'foreign-mandate','2026-10-23').size,0);
});

test('ordinary account metadata updates retain the database assignment and cannot silently disrupt active automation',async t=>{
 const h=await dailyFixture(t);await h.activate();
 const updated=await h.req('/profiles',{...binding,label:'Renamed account',registration:'taxable'});assert.equal(updated.profile.strategyId,h.run.strategyId);assert.equal((await h.req('/management')).execution.automatedTradingAccounts,1);
 const refused=await h.req('/profiles',{...binding,label:'Clear active',registration:'taxable',strategyId:null});assert.equal(refused.error,'active_strategy_assignment_locked');assert.equal((await h.req('/management')).watches[0].automatedTrading,true);
 await h.req('/live/stop',{watchId:h.watch.id});assert.equal((await h.req('/profiles',{...binding,label:'Explicit clear',registration:'taxable',strategyId:null})).profile.strategyId,null);
});

test('stock universe and selected Quant signal persist and share the desk factor definitions',()=>{
 const c=normalizePolicy(JSON.parse(JSON.stringify(stock)));assert.deepEqual(c,stock);assert.equal(c.assets.some(a=>a.symbol==='SPY'),false);assertAccount(c,{accountType:'margin'},'taxable');assert.throws(()=>assertAccount(c,{accountType:'margin'},'401k'));
 assert.throws(()=>normalizePolicy({...c,assets:[]}));assert.throws(()=>normalizePolicy({...c,rankBy:'invented'}));
 const data=history(c),asOf='2026-10-20',answer=signal(c,data,asOf),q=require('../routes/quant/factors');assert.equal(answer.model,'quant-stock-daily-v1');
 for(const t of answer.targets){const closes=data[t.symbol].filter(r=>r.date<=asOf).map(r=>r.close);assert.equal(t.score,q.factorsAt(closes,closes.length-1).mom12);}
 assert.ok(answer.targets.length);const future=structuredClone(data);for(const rows of Object.values(future))for(const r of rows)if(r.date>asOf)r.close*=100;assert.deepEqual(signal(c,future,asOf),answer);
 const replay=validateReplay(c,input(c));assert.ok(replay.validation.passed,JSON.stringify(replay.validation));assert.ok(replay.result.rebalances.every(r=>r.decisionAsOf<r.fillDate));
});

test('account strategies survive application recreation and PostgreSQL reconnection without cross-owner reassignment',async t=>{
 const {Pool,Client}=require('../../scripts/toolchain/node_modules/pg'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
 const dsn=process.env.OSHAL_TEST_POSTGRES;assert.ok(dsn,'Explicit disposable PostgreSQL required');const url=new URL(dsn);assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&['35689','32768'].includes(url.port),'Disposable PostgreSQL fixture only');
 const admin=new Client({connectionString:dsn});await admin.connect();const db='trading_restart_'+randomUUID().replaceAll('-','');await admin.query('CREATE DATABASE '+db);url.pathname='/'+db;
 let pool=new Pool({connectionString:url.toString()}),server;
 t.after(async()=>{if(server)await new Promise(r=>server.close(r));await pool.end();await admin.query('DROP DATABASE '+db);await admin.end();});
 for(const file of ['001-trading-watchlist.sql','007-native-portfolio.sql','011-native-account-values.sql'])await pool.query(fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8'));
 const boot=async()=>{const h=require('./support/native-portfolio-host').application();h.ctx.pool=pool;h.accounts.push({...structuredClone(h.accounts[0]),accountId:'b'},{...structuredClone(h.accounts[0]),accountId:'retirement',accountType:'cash'});server=await new Promise(r=>{const s=h.app.listen(0,'127.0.0.1',()=>r(s));});return async(p,body,owner='owner-a')=>{const res=await fetch('http://127.0.0.1:'+server.address().port+'/api/trading/portfolio'+p,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-fixture-owner':owner},...(body?{body:JSON.stringify(body)}:{})});assert.equal(res.status,200,await res.clone().text());return res.json();};};
 let req=await boot();const saved=[];
 for(const [id,config,reg]of [['a',{...stock,grossExposurePct:20,defensiveGrossPct:10},'taxable'],['b',{...stock,assets:[{symbol:'DDD',weightPct:100}],grossExposurePct:15,defensiveGrossPct:10},'taxable'],['retirement',retirement,'401k']]){const s=(await req('/strategies',{name:'Saved '+id,config})).strategy;saved.push(s);await req('/profiles',{accountId:id,connectionKey:'owned-login',label:'Saved '+id,registration:reg,strategyId:s.id});}
 const before=await req('/research');await new Promise(r=>server.close(r));server=null;await pool.end();pool=new Pool({connectionString:url.toString()});req=await boot();
 const after=await req('/research');assert.deepEqual(after.strategies,before.strategies);assert.deepEqual(after.accounts,before.accounts);assert.equal(after.strategies.length,3);
 const changed=await req('/profiles',{accountId:'a',connectionKey:'owned-login',label:'New account label',registration:'taxable'});assert.equal(changed.profile.strategyId,saved[0].id);
 const foreign=await req('/research',undefined,'owner-b');assert.deepEqual(foreign.strategies,[]);assert.deepEqual(foreign.accounts,[]);
 const last=await req('/research');assert.equal(last.accounts.find(a=>a.accountId==='b').strategyId,saved[1].id);assert.equal(last.accounts.find(a=>a.accountId==='retirement').strategyId,saved[2].id);
});
