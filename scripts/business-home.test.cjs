/** Compiled financial summary and explicit-review boundaries; no providers or AI used. */
const fs=require('fs'),path=require('path'),test=require('node:test'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
function moduleFor(file,dependencies){const module={exports:{}};new Function('require','module','exports',fs.readFileSync(path.join(root,file),'utf8'))(dependencies,module,module.exports);return module.exports;}
function response(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.statusCode=s;return this;},json(body){this.body=body;}};}
function summary(app,query){let handler;moduleFor(app+'/routes/home-summary.js',name=>{assert.equal(name,'express');return {Router:()=>({get:(_,fn)=>handler=fn})};}).createHomeSummaryRoutes({pool:{query}});return async(oidc={user:{sub:'alice'},isAuthenticated:()=>true})=>{const res=response();await handler({oidc,query:{user_sub:'bob'}},res);return res;};}
for(const app of ['finance','payments','payroll']){
 test(app+' rejects unverified callers before any read',async()=>{const call=summary(app,()=>assert.fail('read'));for(const oidc of [null,{user:{sub:'alice'}},{user:{sub:'alice'},isAuthenticated:()=>false}])assert.equal((await call(oidc)).statusCode,401);});
 test(app+' uses bounded owner SELECTs on every repeat',async()=>{let reads=0;const call=summary(app,async q=>{reads++;assert.match(q.text,/^SELECT /);assert.match(q.text,/user_sub = \$1/);assert.equal(q.values[0],'alice');assert.ok(q.values[1] instanceof Date);assert.equal(q.query_timeout,1800);return {rows:[]};});for(let i=0;i<2;i++){const r=await call();assert.equal(r.statusCode,200);assert.equal(r.body.partial,false);assert.equal(r.headers['Cache-Control'],'no-store');}assert.ok(reads>=4);});
 test(app+' reports unavailable instead of zero on missing sources',async()=>{const r=await summary(app,async()=>{throw Error('PRIVATE');})();assert.equal(r.statusCode,503);assert.equal(r.body.partial,true);assert.ok(r.body.metrics.every(m=>m.value==='Unavailable'));assert.ok(!JSON.stringify(r.body).includes('PRIVATE'));});
}
test('Finance refuses mixed-currency totals and retains unknown historical mode',async()=>{
 const r=await summary('finance',async q=>({rows:q.text.includes('SELECT aggregate')?[{aggregate:{currency:'USD',netWorth:{net:200},accounts:[{currency:'USD'},{currency:'EUR'}]},synced_at:new Date()}]:[]}))();
 assert.equal(r.body.metrics.find(m=>m.id==='cached-net-worth').value,'Mixed currencies');assert.equal(r.body.metrics.find(m=>m.id==='snapshot-mode').value,'mode not recorded');
});
function financeRoute(query,execute){const handlers={};const stub={createChildLogger:()=>({error(){}}),BotNodeClient:class{},createRegistryEndpointResolver:()=>()=>{},resolveUserLlmConnection:async()=>null,executeBotOrInline:execute,runRuntimeSchemaBootstrap:()=>assert.fail('read must not bootstrap schema')};moduleFor('finance/routes/finance-routes.js',name=>name==='express'?{Router:()=>Object.fromEntries(['get','post','delete'].map(method=>[method,(p,fn)=>handlers[method+' '+p]=fn]))}:name==='path'?require('path'):stub).createFinanceRoutes({pool:{query}});return async(route,body,oidc={user:{sub:'alice'},isAuthenticated:()=>true},query={})=>{const res=response();await handlers[route]({body,oidc,query},res);return res;};}
test('review needs authenticated confirmation and bounded context before reading or execution',async()=>{
 const call=financeRoute(()=>assert.fail('read'),()=>assert.fail('execute'));
 assert.equal((await call('post /review',{},null)).statusCode,401);
 assert.equal((await call('post /review',{}, {user:{sub:'alice'}})).statusCode,401);
 for(const body of [{title:'A',notes:'B'},{confirm:true,title:'',notes:'B'},{confirm:true,title:'A',notes:'B'.repeat(2001)},{confirm:true,title:'A',notes:'B',sourceUrl:'javascript:alert(1)'}])assert.equal((await call('post /review',body)).statusCode,400);
});
test('review reads only its owner and requires saved accounts before analysis',async()=>{
 const call=financeRoute(async(sql,args)=>{assert.match(sql,/^SELECT aggregate, synced_at/);assert.deepEqual(args,['alice']);return {rows:[]};},()=>assert.fail('execute'));
 assert.equal((await call('post /review',{confirm:true,title:'A',notes:'B',user_sub:'bob'})).statusCode,409);
});
test('confirmed review passes saved evidence to advisory execution without ledger writes',async()=>{
 let executed=0;const call=financeRoute(async(sql,args)=>{assert.match(sql,/^SELECT /);assert.deepEqual(args,['alice']);return {rows:[{aggregate:{currency:'USD',generatedAt:'2026-09-01'},synced_at:'2026-09-01'}]};},async(ctx,client,id,request)=>{executed++;assert.equal(request.userSub,'alice');assert.match(request.text,/unverified source data/);assert.match(request.text,/saved payment evidence/);return {response:'Review result'};});
 const r=await call('post /review',{confirm:true,title:'A',notes:'saved payment evidence'});assert.equal(r.statusCode,200);assert.equal(r.body.advisory,true);assert.equal(r.body.snapshotAt,'2026-09-01');assert.equal(executed,1);
});
test('cached brief GET never initializes schemas, executes or updates a missing brief',async()=>{
 const call=financeRoute(async sql=>{assert.match(sql,/^SELECT /);return {rows:[{aggregate:{currency:'USD'}}]};},()=>assert.fail('execute'));
 assert.equal((await call('get /brief',null,undefined,{cached:'1'})).statusCode,404);
});
