/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A connected native quote feed cannot activate the unsupported whole-market screener; the actual Movers route keeps its labelled archive board.
 */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {standIns,loadShipped}=require('./support/native-landing-host');
async function report(kind, points, failure = false) {
  const modules=standIns({universe:['NVDA']});
  modules['@/features/trading']={...modules['@/features/trading'],nativeSchwabReads:true,marketDataConfigured:()=>true,
    screenerMovers:async()=>{throw Error('native quotes must not activate a missing screener');},
    screenerMostActives:async()=>{throw Error('native quotes must not activate a missing screener');}};
  const ctx={pool:{query:async()=>({rows:[]})},intent:async(name)=>{
    assert.equal(name,'prices.series');if(failure) throw Error('World archive read timed out');return {series:{NVDA:points}};
  }};
  const routes=new Map(),router={get:(p,f)=>routes.set(p,f),post(){},delete(){},patch(){},use(){}};
  loadShipped(modules,load=>load('trading-research-routes').registerTradingResearchRoutes(router,ctx));
  const result={status:200,body:null},res={status(n){result.status=n;return res;},json(b){result.body=b;return res;}};
  await routes.get('/reports/movers')({oshalCallerSub:'alice',query:{kind},body:{},params:{}},res);
  return result;
}
const points = [100,101,103,104,102,108].map((price,i)=>({at:`2026-10-${String(9+i).padStart(2,'0')}T20:00:00Z`,price,volume:10000000+i*100000,bucket:`2026-10-${String(9+i).padStart(2,'0')}`}));
for (const kind of ['winners','losers','active','volatile']) test(`connected native ${kind} uses the labelled archive and genuine daily history`,async()=>{
  const result=await report(kind,points);
  assert.equal(result.status,200,JSON.stringify(result.body));
  assert.match(result.body.source,/World price archive/);
  assert.match(result.body.note,/Not live quotes/);
  assert.equal(result.body.rows[0].symbol,'NVDA');
  assert.equal(result.body.rows[0].price,108);
  if(kind==='volatile') assert.ok(result.body.rows[0].volatilityPct>0);
});
test('a short volatility history is explained, never replaced by zero volatility',async()=>{
  const result=await report('volatile',points.slice(-2));
  assert.equal(result.status,200);assert.deepEqual(result.body.rows,[]);
  assert.match(result.body.note,/Not enough stored daily history to calculate volatility/);
});
test('a single stored session cannot pretend to have a daily comparison',async()=>{
  const result=await report('winners',points.slice(-1));
  assert.equal(result.status,200);assert.deepEqual(result.body.rows,[]);
  assert.match(result.body.note,/Not enough stored daily history to compare sessions/);
});
test('an untracked universe explicitly has no archived prices',async()=>{
  const result=await report('active',[]);
  assert.equal(result.status,200);assert.deepEqual(result.body.rows,[]);
  assert.match(result.body.note,/No stored daily prices/);
});
test('an archive timeout remains an error rather than an empty market',async()=>{
  const result=await report('winners',[],true);
  assert.equal(result.status,502);assert.equal(result.body.rows,undefined);
  assert.match(result.body.error,/World archive read timed out/);
});
