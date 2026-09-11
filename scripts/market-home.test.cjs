/** Compiled market summaries preserve owner, period and paper/live attribution. */
const fs=require('fs'),path=require('path'),test=require('node:test'),assert=require('node:assert/strict');
function route(app,query){let handler;const module={exports:{}};new Function('require','module','exports',fs.readFileSync(path.join(__dirname,'..',app,'routes/home-summary.js'),'utf8'))(name=>{assert.equal(name,'express');return {Router:()=>({get:(_,fn)=>handler=fn})};},module,module.exports);module.exports.createHomeSummaryRoutes({pool:{query}});return async(oidc={user:{sub:'alice'},isAuthenticated:()=>true})=>{const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.statusCode=s;return this;},json(body){this.body=body;}};await handler({oidc,query:{user_sub:'bob'}},res);return res;};}
for(const app of ['trading','kalshi']){
 test(app+' authenticates before reading',async()=>{const call=route(app,()=>assert.fail('read'));for(const oidc of [null,{user:{sub:'alice'}},{user:{sub:'alice'},isAuthenticated:()=>false}])assert.equal((await call(oidc)).statusCode,401);});
 test(app+' repeats bounded owner SELECTs without writes',async()=>{const call=route(app,async q=>{assert.match(q.text,/^SELECT /);assert.match(q.text,/user_sub = \$1/);assert.equal(q.values[0],'alice');assert.ok(q.values[1] instanceof Date);assert.equal(q.query_timeout,1800);return {rows:[]};});for(let i=0;i<2;i++){const r=await call();assert.equal(r.statusCode,200);assert.equal(r.body.partial,false);assert.equal(r.headers['Cache-Control'],'no-store');}});
 test(app+' preserves unknown when all sources fail',async()=>{const r=await route(app,async()=>{throw Error('PRIVATE');})();assert.equal(r.statusCode,503);assert.equal(r.body.partial,true);assert.ok(r.body.metrics.every(m=>m.value==='Unavailable'));assert.ok(!JSON.stringify(r.body).includes('PRIVATE'));});
}
test('Trading keeps mode counts and individual snapshots separate',async()=>{
 const r=await route('trading',async q=>({rows:q.text.includes('GROUP BY mode')?[{mode:'live',day:'1',five:'2'},{mode:'paper',day:'5',five:'8'}]:[{label:'Live book',kind:'live',ref:'live-a',equity:'123.45',et_day:'2026-09-01',updated_at:'2026-09-01',enabled:false},{label:'Paper book',kind:'paper',ref:'paper',equity:null,enabled:true}]}))();
 assert.deepEqual(r.body.metrics.map(m=>m.value),['1','2','5','8']);assert.match(r.body.items[0].detail,/LIVE book/);assert.match(r.body.items[0].detail,/123.45/);assert.match(r.body.items[1].detail,/No saved equity/);
});
test('Kalshi records are not rewritten as delivered alerts or settled trades',async()=>{
 const r=await route('kalshi',async q=>({rows:q.text.includes('FROM kalshi_orders')?[{env:'demo',ticker:'EXAMPLE',side:'yes',action:'buy',count:1,kalshi_status:'resting',created_at:'2026-09-01'}]:q.text.includes('SELECT ticker')?[{ticker:'EXAMPLE',delivered:false,created_at:'2026-09-01'}]:[{day:'1',five:'1',delivered:'0'}]}))();
 assert.equal(r.body.metrics[2].value,'0');assert.match(r.body.items[0].detail,/Delivery not confirmed/);assert.match(r.body.items[1].detail,/demo placement record/);assert.match(r.body.items[1].detail,/status at placement resting/);
});
