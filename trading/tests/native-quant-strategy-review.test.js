/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Regress failed-composite fallback, changed evidence, stale saved proposals and cross-connection monthly execution claims.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Daily Quant proposals refuse stale/incomplete evidence, expose failed holdings, enforce concentration and hysteresis, survive handler recreation and have no trading authority.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {buildReview,exclusions,RULES}=require('../routes/quant/strategy-review');
const store=require('../routes/quant/store');
const {quantHandlers,createTradingQuantRoutes}=require('../routes/quant/routes');
const {memoryPool}=require('./support/native-quant-doubles');
const now=new Date('2026-11-04T18:00:00Z');
function row(symbol,score=90,group='Industry '+symbol){return{symbol,price:100,pct:{composite:score,momentum:score},f:{vsMa200:.2,vsMa50:.1,trend:3,mom12:.3,rev1:.05,fromHigh:-.03},chg1d:.01,group,fund:{netMarginPct:10,revenueYoYPct:8}};}
function fixture(){const rows=Array.from({length:20},(_,i)=>row('S'+String.fromCharCode(65+i),100-i));return{rows,today:{rankBy:'momentum',session:'2026-11-03',at:'2026-11-03T23:00:00Z',scored:rows.length,market:{vsMa200:.1,above200Pct:60}},accounts:[{accountId:'a',connectionKey:'c',accountMasked:'…1234',accountType:'margin',registration:'taxable',equity:100000,cash:5000,positions:[]}],history:{signals:[{id:'composite',name:'Composite',verdict:'Fails'},{id:'momentum',name:'12-month momentum',verdict:'Promising'}]}};}
function build(f=fixture()){return buildReview(f.today,f.rows,f.history,f.accounts,now);}
test('the daily proposal uses the published momentum signal, not the failed composite',()=>{
 const r=build();assert.equal(r.armed,false);assert.equal(r.executionAvailable,false);assert.equal(r.ordersSubmitted,0);assert.equal(r.rules.cadence,'daily');assert.equal(r.rules.rankBy,'momentum');assert.equal(r.validation.readyForLive,false);assert.equal(r.signalEvidence.verdict,'Promising');assert.equal(r.signalEvidence.id,'momentum');assert.equal(r.signalEvidence.testCadence,'calendar-monthly');
 assert.equal(r.accounts[0].targets.length,10);assert.equal(r.accounts[0].proposedGrossPct,50);assert.equal(r.accounts[0].targets[0].referenceShares,50);
 assert.ok(r.operatingRules.some(s=>s.includes('next completed session')));assert.ok(r.validation.reasons.some(s=>s.includes('no completed backtest')));
});
test('a high old momentum rank cannot hide a falling trend, recent collapse or unknown fundamentals',()=>{
 for(const patch of [{f:{vsMa200:-.1}},{f:{rev1:-.2}},{f:{fromHigh:-.4}},{chg1d:-.08},{fund:null},{fund:{netMarginPct:-1,revenueYoYPct:20}},{group:'Unknown'}]){
  const f=fixture(),bad={...f.rows[0],...patch,f:{...f.rows[0].f,...patch.f}};f.rows[0]=bad;f.accounts[0].positions=[{symbol:bad.symbol,qty:100,marketValue:10000}];
  const r=build(f);assert.ok(exclusions(bad,'momentum').length);assert.ok(!r.accounts[0].targets.some(t=>t.symbol===bad.symbol));assert.equal(r.accounts[0].holdings[0].disposition,'Review exit or reduction');assert.ok(r.accounts[0].holdings[0].reasons.length);
 }
});
test('industry limits cannot be bypassed by rank, and a defensive market leaves more cash',()=>{
 const f=fixture();for(const r of f.rows.slice(0,8))r.group='Crowded industry';const r=build(f);
 assert.equal(r.accounts[0].targets.filter(t=>t.industry==='Crowded industry').length,3);
 f.today.market.vsMa200=-.1;const defensive=build(f);assert.equal(defensive.accounts[0].proposedGrossPct,25);assert.equal(defensive.accounts[0].residualCashPct,75);
});
test('eligible existing holdings use rank hysteresis without exceeding portfolio limits',()=>{
 const f=fixture();f.accounts[0].positions=[{symbol:f.rows[15].symbol,qty:10,marketValue:1000}];const r=build(f);
 assert.ok(r.accounts[0].targets.some(t=>t.symbol===f.rows[15].symbol));assert.equal(r.accounts[0].targets.length,RULES.maxPositions);assert.equal(r.accounts[0].holdings[0].disposition,'Retain within proposed limits');
 assert.deepEqual(buildReview(f.today,[...f.rows].reverse(),f.history,f.accounts,now).accounts,r.accounts,'read order never selects a different portfolio');
});
test('stale, partial, duplicated, future or missing market evidence produces no target transitions',()=>{
 for(const mutate of [f=>f.today.session='2026-11-02',f=>f.rows.pop(),f=>f.rows[1]=f.rows[0],f=>f.today.at='2099-01-01T00:00:00Z',f=>f.today.market=null]){
  const f=fixture();f.accounts[0].positions=[{symbol:'HELD',qty:5,marketValue:500}];mutate(f);const r=build(f);assert.ok(r.blockers.length);assert.equal(r.accounts[0].targets.length,0);assert.equal(r.accounts[0].holdings[0].disposition,'Data incomplete; no transition proposed');
 }
});
test('review creation reads only owner accounts, persists its exact snapshot and restores after handler recreation',async()=>{
 const f=fixture(),pool=memoryPool(),calls=[];
 for(const [kind,value] of [['today',f.today],['rows',f.rows],['history',f.history]])await store.putRecord(pool,'owner-a',kind,'current',value,now);
 pool.portfolioRows.set('profile-a',{record_id:'profile-a',user_sub:'owner-a',kind:'profile',payload:JSON.stringify({accountId:'a',connectionKey:'c',registration:'taxable'}),created_at:now.toISOString()});
 const ctx={pool,intent:async(name,input)=>{calls.push({name,input});assert.equal(name,'trading.accounts','review cannot reach orders, approvals, assignments or jobs');return{accounts:f.accounts,errors:[]};}};
 const h=quantHandlers(ctx,{time:()=>now.getTime()}),r=(await h.strategyReview('owner-a',{body:{}})).body;
 assert.ok(r.reviewId);assert.equal(r.armed,false);assert.equal(calls.length,1);
 assert.deepEqual((await quantHandlers(ctx).savedStrategyReview('owner-a')).body.review,r);
 assert.equal((await h.savedStrategyReview('owner-b')).body.review,null,'no other owner can read the saved proposal');
 const before=pool.rows.size;assert.equal((await h.strategyReview('owner-a',{body:{owner:'owner-b'}})).status,400);assert.equal(pool.rows.size,before);assert.equal(calls.length,1);
});
test('review routes use the existing authenticated Quant router',async()=>{
 const routes=[];createTradingQuantRoutes({pool:memoryPool()},()=>({get:(p,h)=>routes.push(['GET',p,h]),post:(p,h)=>routes.push(['POST',p,h])}));
 for(const method of ['GET','POST']){const route=routes.find(r=>r[0]===method&&r[1]==='/strategy-review');assert.ok(route);let code,body;await route[2]({body:{}},{status:n=>{code=n;return{json:b=>{body=b;}};}});assert.equal(code,401);assert.equal(body.error,'not_authenticated');}
});
test('the rendered review identifies each account, shows its validation gap and offers no live activation',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../tools/ui/view-quant.js'),'utf8'),ctx=vm.createContext({console,esc:s=>String(s).replace(/</g,'&lt;'),money:n=>String(n)});
 vm.runInContext(source+'\n;globalThis.render=qdStrategyReview;',ctx);const r=build();r.reviewId='fixture-review';const html=ctx.render(r);
 assert.match(html,/unarmed proposal/);assert.match(html,/Schwab …1234/);assert.match(html,/12-month momentum/);assert.match(html,/Promising/);assert.match(html,/no completed backtest/);assert.match(html,/next completed session/);assert.doesNotMatch(html,/data-native-management="strategy-activate"|Activate live trading/);
});

test('a failed, unknown or missing published signal cannot silently fall back or emit stock targets',()=>{
 for(const mutate of [f=>f.today.rankBy='composite',f=>delete f.today.rankBy,f=>f.today.rankBy='invented',f=>f.history.signals=[],f=>f.history.signals[1].verdict='Fails']){
  const f=fixture();mutate(f);const r=build(f);assert.ok(r.blockers.length);assert.equal(r.accounts[0].targets.length,0);assert.equal(r.accounts[0].proposalAvailable,false);assert.equal(r.accounts[0].proposedGrossPct,null);assert.equal(r.accounts[0].residualCashPct,null,'failed evidence is not a 100% cash instruction');assert.equal(r.armed,false);
 }
 const f=fixture();for(const [i,r] of f.rows.entries())r.pct.composite=i;const r=build(f);assert.equal(r.accounts[0].targets[0].symbol,f.rows[0].symbol,'the failed composite cannot reorder momentum picks');
});
test('changed historical verdict changes the source witness and hides old saved target lists',()=>{
 const f=fixture(),first=build(f);f.history.signals[1].verdict='Fails';assert.notEqual(build(f).sourceFingerprint,first.sourceFingerprint);
 const source=fs.readFileSync(path.join(__dirname,'../tools/ui/view-quant.js'),'utf8'),ctx=vm.createContext({esc:String});vm.runInContext(source+'\n;globalThis.render=qdStrategyReview;',ctx);first.rules.id='daily-quant-review-v2';const html=ctx.render(first);assert.match(html,/Refresh this older review/);assert.doesNotMatch(html,/Reference shares|50% proposed stock exposure/);
});

test('saved monthly execution is exact-account evidence and never a claim that daily stocks are trading',async()=>{
 const f=fixture(),pool=memoryPool();for(const [kind,value]of [['today',f.today],['rows',f.rows],['history',f.history]])await store.putRecord(pool,'owner-a',kind,'current',value,now);
 const save=(id,kind,payload)=>pool.portfolioRows.set(id,{record_id:id,user_sub:'owner-a',kind,payload:JSON.stringify(payload),created_at:now.toISOString()});
 save('profile','profile',{accountId:'a',connectionKey:'c',registration:'taxable'});
 save('watch','watch',{accountId:'a',connectionKey:'another-connection',executionMode:'automatic-daily',enabled:true,automatedTrading:true});
 const ctx={pool,intent:async()=>({accounts:f.accounts,errors:[]})},create=()=>require('../routes/quant/strategy-review').createReview(ctx,'owner-a',now);
 assert.equal((await create()).accounts[0].configuredExecution.mode,null,'another connection cannot establish this account’s execution');
 save('watch','watch',{accountId:'a',connectionKey:'c',executionMode:'automatic-monthly',enabled:true,automatedTrading:true,lastReceipt:{observedAt:now.toISOString(),status:'cycle-completed',signal:{decisionAsOf:'2026-10-30'}}});
 const r=await create(),x=r.accounts[0].configuredExecution;assert.equal(x.mode,'automatic-monthly');assert.equal(x.dailyStockQuantConnected,false);assert.equal(x.authorityVerified,false);assert.match(x.mismatch,/does not consume/);assert.equal(x.decisionAsOf,'2026-10-30');assert.equal(r.executionAvailable,false);
 const source=fs.readFileSync(path.join(__dirname,'../tools/ui/view-quant.js'),'utf8'),ui=vm.createContext({esc:String,money:String,console});vm.runInContext(source+'\n;globalThis.render=qdStrategyReview;',ui);const html=ui.render(r);assert.match(html,/automatic-monthly/);assert.match(html,/does not consume/);
 x.available=false;const unavailable=ui.render(r);assert.match(unavailable,/Saved live configuration is unavailable/);assert.doesNotMatch(unavailable,/Saved live mode:/);
});

test('the stock proposal excludes retirement and unclassified accounts instead of applying margin picks to them',()=>{
 const f=fixture();for(const [registration,accountType] of [['ira','cash'],['401k','cash'],['ira','margin'],['unknown','margin'],['taxable','cash']]){f.accounts[0].registration=registration;f.accounts[0].accountType=accountType;f.accounts[0].positions=[{symbol:f.rows[0].symbol,qty:10,marketValue:1000}];const r=build(f),a=r.accounts[0];assert.equal(a.eligible,false);assert.equal(a.targets.length,0);assert.equal(a.proposedGrossPct,null);assert.match(a.holdings[0].disposition,/no stock transition/);}
});
test('older saved reviews cannot present unclassified account targets as a current stock proposal',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../tools/ui/view-quant.js'),'utf8'),ctx=vm.createContext({console,esc:String,money:String});vm.runInContext(source+'\n;globalThis.render=qdStrategyReview;',ctx);const r=build();delete r.accounts[0].eligible;const html=ctx.render(r);assert.match(html,/Refresh this older review/);assert.doesNotMatch(html,/50% proposed stock exposure|Reference shares/);
});

test('only this owner’s saved registration can classify a broker margin account for the stock proposal',async()=>{
 const f=fixture(),pool=memoryPool(),ctx={pool,intent:async()=>({accounts:f.accounts,errors:[]})};for(const [kind,value] of [['today',f.today],['rows',f.rows],['history',f.history]])await store.putRecord(pool,'owner-a',kind,'current',value,now);
 const create=()=>require('../routes/quant/strategy-review').createReview(ctx,'owner-a',now);assert.equal((await create()).accounts[0].eligible,false,'broker metadata alone cannot declare a taxable registration');
 const profile=registration=>({record_id:'p',user_sub:'owner-a',kind:'profile',payload:JSON.stringify({accountId:'a',connectionKey:'c',registration}),created_at:now.toISOString()});pool.portfolioRows.set('foreign',{...profile('taxable'),user_sub:'owner-b'});assert.equal((await create()).accounts[0].eligible,false);
 pool.portfolioRows.set('owned',profile('ira'));assert.equal((await create()).accounts[0].eligible,false,'retirement declaration wins over the broker MARGIN type');pool.portfolioRows.set('owned',profile('taxable'));assert.equal((await create()).accounts[0].eligible,true);
});
