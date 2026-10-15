/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The real native history route keeps verified caller authority, exact account/date input and failed reads; no historical write or real order path exists.
 */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {standIns,loadShipped}=require('./support/native-landing-host');
async function history({caller='alice',query={},failure=false}={}) {
 const modules=standIns({universe:[]});
 modules['@/features/trading']={...modules['@/features/trading'],nativeSchwabReads:true};
 const calls=[],routes=new Map(),router={get:(p,f)=>routes.set(p,f),post(){},delete(){},patch(){},use(){}};
 const answer={transactions:[{transactionId:'execution-1',side:'sell',qty:8}],unsupported:[],accountId:'opaque-account'};
 loadShipped(modules,load=>load('trading-accounts-routes').registerTradingAccountRoutes(router,{intent:async(name,input)=>{calls.push({name,input});if(failure)throw Error('upstream failure');return answer;}}));
 const result={status:200,body:null,headers:{}},res={setHeader(k,v){result.headers[k]=v;},status(n){result.status=n;return res;},json(b){result.body=b;return res;}};
 await routes.get('/reconciliation/history')({oshalCallerSub:caller,query},res);
 return{...result,calls,answer};
}
const query={accountId:'opaque-account',connection:'owned-connection',from:'2026-10-01T00:00:00Z',to:'2026-10-14T00:00:00Z'};
test('the shipped history route forwards only exact read selectors, retaining genuine fills',async()=>{
 const r=await history({query:{...query,subject:'victim',url:'https://evil.invalid',apply:'true'}});
 assert.equal(r.status,200);assert.deepEqual(r.body,r.answer);assert.equal(r.headers['Cache-Control'],'no-store');
 assert.deepEqual(r.calls,[{name:'trading.transactions',input:query}]);
});
test('unauthenticated or malformed history requests never reach the native reader',async()=>{
 const a=await history({caller:null,query});assert.equal(a.status,401);assert.deepEqual(a.calls,[]);
 for(const bad of [{},{...query,accountId:['other']},{...query,connection:''}]) {
  const r=await history({query:bad});assert.equal(r.status,400);assert.deepEqual(r.calls,[]);
 }
});
test('a failed execution read stays a failure rather than a clean or empty reconciliation',async()=>{
 const r=await history({query,failure:true});assert.equal(r.status,502);assert.equal(r.body.error,'history_read_failed');assert.equal(r.body.transactions,undefined);
});
