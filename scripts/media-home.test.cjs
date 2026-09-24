/** Compiled creative summaries: authenticated saved evidence and bounded draft actions. */
const fs=require('fs'),path=require('path'),test=require('node:test'),assert=require('node:assert/strict');
const apps=['brand-graphics','creative-studio','daily-trade-recap','lora','portrait-studio','print-ingest','storage'];
// Two identity rails reach these routes and the harness has to model both, because the framework
// hands a package BOTH: manifest-route-mounter.ts builds each package context with
// `authorization: applicationAuthorization.forPackage(appName)` alongside the request's own oidc.
// Six apps here read `req.oidc`; portrait-studio reads `ctx.authorization.currentActor()` (ADR-149).
// Supplying only the first made portrait-studio 401 every authenticated case - a harness gap, not a
// product defect. Both rails are driven from ONE fixture below so an app cannot pass on one rail
// while failing the other, and every existing 401 case stays 401.
function route(app,query){
 let handler,actor=null,permitted=true;const module={exports:{}};
 const source=fs.readFileSync(path.join(__dirname,'..',app,'routes/home-summary.js'),'utf8');
 new Function('require','module','exports',source)(name=>{assert.equal(name,'express');return {Router:()=>({get:(_,fn)=>handler=fn})};},module,module.exports);
 module.exports.createHomeSummaryRoutes({pool:{query},authorization:{currentActor:()=>actor,authorize:async()=>({allowed:permitted})}});
 const call=async(oidc={user:{sub:'alice'},isAuthenticated:()=>true},opts={})=>{
  // The actor is DERIVED from the same oidc fixture rather than fixed, so a refusal stays a refusal
  // on both rails. opts covers the two states an oidc fixture cannot express: authenticated at the
  // door but inactive in the authorization catalog, and active but lacking a named permission.
  const sub=oidc&&oidc.user&&(oidc.user.sub||oidc.user.oid);
  actor='actor' in opts?opts.actor:(sub&&oidc.isAuthenticated&&oidc.isAuthenticated()===true?{sub,isActive:true}:null);
  permitted='allowed' in opts?opts.allowed:true;
  const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.statusCode=s;return this;},json(body){this.body=body;}};
  await handler({oidc,query:{user_sub:'bob'}},res);return res;};
 call.usesAuthorizationRail=/currentActor/.test(source);
 return call;}
for(const app of apps){
 // Registered per app rather than skipped inside a shared case: a test that returns early for six
 // of seven apps reports green while asserting nothing, which is how the gap below survived.
 const onAuthorizationRail=/currentActor/.test(fs.readFileSync(path.join(__dirname,'..',app,'routes/home-summary.js'),'utf8'));
 if(onAuthorizationRail){
  test(app+' fails closed when the authorization catalog says the actor is inactive',async()=>{
   const r=await route(app,()=>assert.fail('read'))(undefined,{actor:{sub:'alice',isActive:false}});
   assert.equal(r.statusCode,401);});
  test(app+' refuses a caller missing a named permission instead of answering',async()=>{
   const r=await route(app,async()=>({rows:[]}))(undefined,{allowed:false});
   assert.equal(r.statusCode,403);});
 }
 test(app+' authenticates before reading',async()=>{const call=route(app,()=>assert.fail('read'));for(const oidc of [null,{user:{sub:'alice'}},{user:{sub:'alice'},isAuthenticated:()=>false}])assert.equal((await call(oidc)).statusCode,401);});
 test(app+' uses repeated bounded owner SELECTs only',async()=>{const call=route(app,async q=>{assert.match(q.text,/^SELECT /);assert.match(q.text,/(user_sub|owner_sub) = \$1/);assert.equal(q.values[0],'alice');assert.ok(q.values[1] instanceof Date);assert.equal(q.query_timeout,1800);return {rows:[]};});for(let i=0;i<2;i++){const r=await call();assert.equal(r.statusCode,200);assert.equal(r.body.partial,false);assert.equal(r.headers['Cache-Control'],'no-store');assert.ok(r.body.metrics.every(m=>m.value===(app==='storage'?'Automatic':'0')));}});
 test(app+' reports unavailable sources without inventing zero',async()=>{const r=await route(app,async()=>{throw Error('PRIVATE');})();assert.equal(r.statusCode,503);assert.ok(r.body.metrics.every(m=>m.value==='Unavailable'));assert.ok(!JSON.stringify(r.body).includes('PRIVATE'));});
 test(app+' isolates partial failures and bounds transferred context',async()=>{let n=0;const r=await route(app,async()=>{if(n++===0)throw Error('missing');return {rows:[{title:'Title',name:'Plan',idea:'A'.repeat(5000),body:'B'.repeat(6000),idea_text:'C'.repeat(6000),premise:'D'.repeat(6000),created_at:'2026-09-01',updated_at:'2026-09-01',outline:[{title:'Slide',content:'E'.repeat(5000)}]}]};})();assert.equal(r.statusCode,app==='storage'?503:200);assert.equal(r.body.partial,true);assert.equal(r.body.metrics[0].value,'Unavailable');for(const i of r.body.items){assert.ok((i.actions||[]).length<=4);for(const a of i.actions||[]){assert.ok(a.context.notes.length<=2000);assert.ok(a.context.title.length<=120);}}});
}
const vm=require('node:vm');
async function brandCli(env,input={brief:'Reviewed brief'}){const calls=[],output=[],fakeProcess={env,argv:['node','brand','graphic',JSON.stringify(input)],stdout:{write:s=>output.push(s)},exitCode:0};await vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../brand-graphics/tools/oshal-brand.js'),'utf8'),{process:fakeProcess,Buffer,fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({job_id:'saved-brand'})};}});return {calls,output,exitCode:fakeProcess.exitCode};}
test('Brand CLI sends the approved brief through the attributed brand dispatch door',async()=>{const r=await brandCli({SWARM_SERVICE_SECRET:'fixture-secret',OSHAL_USER_SUB:'owner@example.test'});assert.equal(r.exitCode,0);assert.equal(r.calls.length,1);assert.match(r.calls[0].url,/\/api\/vids\/brand$/);assert.equal(Buffer.from(r.calls[0].options.headers['X-Oshal-User-Sub-B64'],'base64url').toString(),'owner@example.test');assert.equal(JSON.parse(r.calls[0].options.body).confirm,true);assert.equal(JSON.parse(r.calls[0].options.body).brandMode,'graphic');});
test('Brand CLI refuses missing attribution before network calls',async()=>{const r=await brandCli({SWARM_SERVICE_SECRET:'fixture-secret'});assert.equal(r.exitCode,1);assert.equal(r.calls.length,0);assert.ok(!r.output.join('').includes('fixture-secret'));});
// ── daily-trade-recap: count what the PRODUCTION nightly writes, never workflow_runs ──────────
// The nightly recap is a host scheduled task (scripts/run-daily-recap.ps1). It creates no ticket
// and no workflow run, so tiles counting workflow_runs for ticket_type 'daily-trade-recap' read 0
// on a good night and a bad one alike - the type has never had a single row. The records that do
// exist are a trading session (oshal_trading_daily_equity, written by the trading schedule) and
// the day's published report (oshal_trading_strategy_journal kind='report'), plus the ticket
// path's own approval_required backlog, which workflow-run states could never see.
const recapRows=({sessions='0',recaps='0',missed='0',review='0',days=[],parked=[]}={})=>async q=>{
 if(/AS missed/.test(q.text))return {rows:[{sessions,recaps,missed}]};
 if(/AS review/.test(q.text))return {rows:[{review}]};
 if(/AS session_day/.test(q.text))return {rows:days};
 return {rows:parked};};
test('daily-trade-recap reads the records the nightly actually writes, never workflow_runs',async()=>{
 const texts=[];await route('daily-trade-recap',async q=>{texts.push(q.text);return {rows:[]};})();
 assert.equal(texts.length,4);
 assert.equal(texts.some(t=>/workflow_run/.test(t)),false,'the host nightly writes no workflow run to count');
 assert.ok(texts.some(t=>/oshal_trading_daily_equity/.test(t)),'a recorded trading session is the only holiday-proof signal that a recap was due');
 assert.ok(texts.some(t=>/oshal_trading_strategy_journal/.test(t)),'the recap publishes its own report journal row');
 assert.ok(texts.some(t=>/FROM tickets/.test(t)&&/approval_required/.test(t)),'the parked tickets are the ticket path`s own backlog');});
test('daily-trade-recap: a recorded recap moves a tile and a session without one is counted and named',async()=>{
 const good=await route('daily-trade-recap',recapRows({sessions:'2',recaps:'2',days:[{session_day:'2026-09-18',recap_at:'2026-09-18T21:10:00.000Z',recap_summary:'Daily report published for 2026-09-18'}]}))();
 assert.equal(good.statusCode,200);
 assert.deepEqual(good.body.metrics.map(m=>[m.id,m.value]),[['recaps-missed','0'],['recaps-recorded','2'],['trading-sessions','2'],['recaps-awaiting-review','0']]);
 assert.ok(good.body.items.some(i=>/^Recap recorded for 2026-09-18/.test(i.text)&&i.tone==='neutral'));
 assert.equal(good.body.items.some(i=>i.tone==='warn'),false);
 const bad=await route('daily-trade-recap',recapRows({sessions:'2',recaps:'1',missed:'1',days:[{session_day:'2026-09-19',recap_at:null,recap_summary:null}]}))();
 assert.equal(bad.body.metrics[0].value,'1');
 const missed=bad.body.items.find(i=>/^No recap recorded for 2026-09-19/.test(i.text));
 assert.ok(missed,'a closed session with no published report has to be named, not merely absent');
 assert.equal(missed.tone,'warn');});
test('daily-trade-recap: nothing recorded reads 0 everywhere and claims no success',async()=>{
 const r=await route('daily-trade-recap',recapRows())();
 assert.deepEqual(r.body.metrics.map(m=>m.value),['0','0','0','0']);
 assert.equal(r.body.items.some(i=>i.tone==='warn'),false);
 assert.ok(r.body.items.some(i=>/No recorded trading session/.test(i.text)));});
test('daily-trade-recap: a ticket parked at its approval gate is counted and listed',async()=>{
 const r=await route('daily-trade-recap',recapRows({review:'3',parked:[{title:'Daily trade recap 2026-06-11',status:'approval_required',created_at:'2026-06-11T20:15:00.000Z'}]}))();
 assert.equal(r.body.metrics[3].value,'3');
 const stale=r.body.items.find(i=>/Daily trade recap 2026-06-11/.test(i.text));
 assert.ok(stale,'a ticket parked since June is invisible in workflow-run states');
 assert.equal(stale.tone,'warn');
 assert.match(stale.detail,/approval_required/);});
