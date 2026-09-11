/** Compiled creative summaries: authenticated saved evidence and bounded draft actions. */
const fs=require('fs'),path=require('path'),test=require('node:test'),assert=require('node:assert/strict');
const apps=['camera','drone','spaces'];
function route(app,query){let handler;const module={exports:{}};new Function('require','module','exports',fs.readFileSync(path.join(__dirname,'..',app,'routes/home-summary.js'),'utf8'))(name=>{assert.equal(name,'express');return {Router:()=>({get:(_,fn)=>handler=fn})};},module,module.exports);module.exports.createHomeSummaryRoutes({pool:{query}});return async(oidc={user:{sub:'alice'},isAuthenticated:()=>true})=>{const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.statusCode=s;return this;},json(body){this.body=body;}};await handler({oidc,query:{user_sub:'bob'}},res);return res;};}
for(const app of apps){
 test(app+' authenticates before reading',async()=>{const call=route(app,()=>assert.fail('read'));for(const oidc of [null,{user:{sub:'alice'}},{user:{sub:'alice'},isAuthenticated:()=>false}])assert.equal((await call(oidc)).statusCode,401);});
 test(app+' uses repeated bounded owner SELECTs only',async()=>{const call=route(app,async q=>{assert.match(q.text,/^SELECT /);assert.match(q.text,/(user_sub|owner_sub) = \$1/);assert.equal(q.values[0],'alice');assert.ok(q.values[1] instanceof Date);assert.equal(q.query_timeout,1800);return {rows:[]};});for(let i=0;i<2;i++){const r=await call();assert.equal(r.statusCode,200);assert.equal(r.body.partial,false);assert.equal(r.headers['Cache-Control'],'no-store');assert.ok(r.body.metrics.every(m=>m.value===(app==='storage'?'Automatic':'0')));}});
 test(app+' reports unavailable sources without inventing zero',async()=>{const r=await route(app,async()=>{throw Error('PRIVATE');})();assert.equal(r.statusCode,503);assert.ok(r.body.metrics.every(m=>m.value==='Unavailable'));assert.ok(!JSON.stringify(r.body).includes('PRIVATE'));});
 test(app+' isolates partial failures and bounds transferred context',async()=>{let n=0;const r=await route(app,async()=>{if(n++===0)throw Error('missing');return {rows:[{title:'Title',name:'Plan',idea:'A'.repeat(5000),body:'B'.repeat(6000),idea_text:'C'.repeat(6000),premise:'D'.repeat(6000),created_at:'2026-09-01',updated_at:'2026-09-01',outline:[{title:'Slide',content:'E'.repeat(5000)}]}]};})();assert.equal(r.statusCode,app==='storage'?503:200);assert.equal(r.body.partial,true);assert.equal(r.body.metrics[0].value,'Unavailable');for(const i of r.body.items){assert.ok((i.actions||[]).length<=4);for(const a of i.actions||[]){assert.ok(a.context.notes.length<=2000);assert.ok(a.context.title.length<=120);}}});
}
test('Smart Home distinguishes absent, empty and invalid snapshots',()=>{
 const {homeSnapshotSummary,readHomeSnapshot}=require('../home/routes/home-summary');
 assert.deepEqual(homeSnapshotSummary(null,null).metrics.map(m=>m.value),['Not indexed','Not indexed']);
 assert.deepEqual(homeSnapshotSummary({devices:[],generatedAt:'2026-09-01'},{scenes:[]}).metrics.map(m=>m.value),['0','0']);
 assert.throws(()=>homeSnapshotSummary({devices:'invalid'},null));
 const dir=fs.mkdtempSync(path.join(require('os').tmpdir(),'home-snapshot-'));
 try{fs.mkdirSync(path.join(dir,'alice'));fs.mkdirSync(path.join(dir,'bob'));fs.writeFileSync(path.join(dir,'bob','devices.json'),'{"devices":[]}');assert.equal(readHomeSnapshot(dir,'alice','devices.json'),null);assert.throws(()=>readHomeSnapshot(dir,'alice/../bob','devices.json'));assert.throws(()=>readHomeSnapshot(dir,'../bob','devices.json'));}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Sat summary labels the shared simulator snapshot and omits telemetry payloads',()=>{
 const {satHomeSummary}=require('../sat-ops/routes/home-summary');
 const result=satHomeSummary([{satId:'sim-1',engine:'rk4',online:false,lastSeenMs:1000,telemetry:{private:'do not share'}}],[]);
 assert.deepEqual(result.metrics.map(m=>m.value),['1','0','1','0']);assert.match(result.items[0].detail,/SIMULATION/);assert.ok(!JSON.stringify(result).includes('do not share'));
 const code=fs.readFileSync(path.join(__dirname,'../sat-ops/src-routes/sat-routes.ts'),'utf8');assert.match(code,/satHomeSummary\(fleet.list\(\),catalog.list\(\)\)/);
});
test('Cloud uses canonical access filtering and exposes only GCP posture',async()=>{
 let handler,reads=0;const module={exports:{}};
 new Function('require','module','exports',fs.readFileSync(path.join(__dirname,'../cloud/routes/home-summary.js'),'utf8'))(name=>name==='express'?{Router:()=>({get:(_,fn)=>handler=fn})}:{accessibleConnections:async(_,sub)=>{reads++;assert.equal(sub,'alice');return [{provider:'gcp',refresh_token:'secret'},{provider:'spotify'}];},isConnectionExpired:()=>false},module,module.exports);
 module.exports.createHomeSummaryRoutes({pool:{}});const res={statusCode:200,setHeader(){},status(s){this.statusCode=s;return this;},json(body){this.body=body;}};
 await handler({oidc:{user:{sub:'alice'},isAuthenticated:()=>false}},res);assert.equal(reads,0);assert.equal(res.statusCode,401);
 await handler({oidc:{user:{sub:'alice'},isAuthenticated:()=>true}},res);assert.equal(reads,1);assert.equal(res.body.metrics[0].value,'1');assert.ok(!JSON.stringify(res.body).includes('secret'));
});
