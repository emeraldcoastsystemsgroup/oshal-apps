/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Supply the explicit diagnostic logger fixture for Calendar's failed optional operations.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Load the real extracted school transaction helper in the strict compiled identity fixture.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Calendar's summary also reads the caller's own events (routes/own-events.js): load it with its logger and own-events module, and hold both reads to owner-scoped SELECTs.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | own-events.js loads its zone helpers (routes/event-time.js, no imports of its own).
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Calendar 1.5.0 reads Google Calendar live (routes/google-live.js + routes/event-time.js) and reads calendar_preparation_snapshots only when Google does not answer: wire the real event-time, sync, google-events (with a controlled offline transport) and google-live modules into calendarDeps(), and verify the live, not-connected and no-answer summary invariants and owner-scoped SELECT-only GET contract.
 */
const fs=require('fs'),path=require('path'),test=require('node:test'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
function load(app,file,deps={}){const m={exports:{}};new Function('require','module','exports',fs.readFileSync(path.join(root,app,'routes',file+'.js'),'utf8'))(name=>{if(name in deps)return deps[name];throw Error('Unexpected dependency '+name);},m,m.exports);return m.exports;}
const req=(extra={})=>({oidc:{user:{sub:'alice'},isAuthenticated:()=>true},...extra});
const res=()=>({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;}});
test('school setup gaps do not turn a valid framework login into a Home-wide login redirect',async()=>{
 const diagnostic={'@/shared/logger':{createChildLogger:()=>({error(){},info(){}})}};
 const transactions=load('little-monsters','education-transactions',diagnostic);
 const education=load('little-monsters','education-access',{'node:crypto':require('node:crypto'),...diagnostic,'./education-transactions':transactions});
 const saved=process.env.MOCK_OIDC;delete process.env.MOCK_OIDC;
 try{const {get}=route('little-monsters','home-summary','createHomeSummaryRoutes',{query:()=>assert.fail('identity is not school-bound')},{'./education-access':education});let r=res();await get(req(),r);assert.equal(r.statusCode,403);r=res();await get(req({oidc:null}),r);assert.equal(r.statusCode,401);}finally{if(saved===undefined)delete process.env.MOCK_OIDC;else process.env.MOCK_OIDC=saved;}
});
function route(app,file,factory,pool,imports={}){let get,post;load(app,file,{'express':{Router:()=>({get:(_,f)=>get=f,post:(_,f)=>post=f})},'@/shared/logger':{createChildLogger:()=>({error(){},info(){}})},...imports})[factory]({pool});return {get,post};}
/** Calendar's home-summary dependencies: real event-time, sync, google-events (offline transport), google-live and own-events. */
function calendarDeps(transport=async()=>({status:503,data:{}})){
 const logger={'@/shared/logger':{createChildLogger:()=>({error(){},info(){}})}};
 const router={'express':{Router:()=>({get(){},post(){},delete(){}})}};
 const eventTime=load('calendar','event-time');
 const sync=load('calendar','sync',{...router,...logger});
 const baseGoogle=load('calendar','google-events',{...router,'crypto':require('node:crypto'),...logger,'./event-time':eventTime});
 const googleEvents={...baseGoogle,send:(ctx,sub,method,url,payload)=>transport(ctx,sub,method,url,payload,baseGoogle)};
 const googleLive=load('calendar','google-live',{...logger,'./google-events':googleEvents,'./event-time':eventTime,'./sync':sync});
 const ownEvents=load('calendar','own-events',{...router,'crypto':require('node:crypto'),...logger,'./event-time':eventTime,'./google-live':googleLive});
 return {...logger,'./event-time':eventTime,'./own-events':ownEvents,'./google-live':googleLive};
}
test('calendar evidence distinguishes not-connected, no-answer, saved-copy fallback, live Google reads, and all-day dates',()=>{
 const {calendarEvidence}=load('calendar','home-summary',{'express':{Router:()=>({})},...calendarDeps()}),now=new Date('2026-09-10T12:00:00Z');
 const events=[{title:'Past',start:'2026-09-10T01:00:00Z'},{title:'Birthday',start:'2026-09-10',allDay:true,url:'javascript:alert(1)',attendees:['PRIVATE']},{title:'Meeting',start:'2026-09-11T14:00:00Z',calendar:'Family',description:'PRIVATE'},{title:'Later',start:'2026-10-20'},null];
 assert.equal(calendarEvidence(null,now).metrics[0].value,'Not connected');
 assert.equal(calendarEvidence(null,now,'no-answer').metrics[0].value,'No answer');
 assert.equal(calendarEvidence({synced_at:now,events:[]},now,'no-answer').metrics[0].value,'0');
 const saved=calendarEvidence({synced_at:now,events},now,'no-answer');
 const live=calendarEvidence({synced_at:now,events:[{title:'Stale',start:'2026-09-11T09:00:00Z'}]},now,{state:'live',readAt:now.toISOString(),events,read:['Family'],unread:[],listed:true,unlisted:null,beyond:0,full:[],capped:false});
 for(const [state,r] of [['saved-copy',saved],['live',live]]){
  assert.equal(r.google.state,state);assert.equal(r.metrics[0].value,'2');assert.equal(r.items[0].text,'Birthday');assert.equal(r.items[0].actions.length,4);
  const raw=JSON.stringify(r);assert.ok(!raw.includes('PRIVATE'));assert.ok(!raw.includes('javascript:'));assert.ok(!raw.includes('Past'));assert.ok(!raw.includes('Later'));
 }
 assert.ok(!JSON.stringify(live).includes('Stale'));
});
test('calendar GET is owner-scoped SELECT only and authenticates before reading',async()=>{
 let mode='no-answer',snapshotRows=[];const sqlCalls=[],googleCalls=[];
 const deps=calendarDeps(async(_ctx,sub,method,url,payload,google)=>{
  googleCalls.push({sub,method,url,payload});
  if(mode==='not-connected')return {refused:google.NOT_CONNECTED};
  if(mode==='no-answer')return {status:503,data:{}};
  if(url.includes('/calendarList?'))return {status:200,data:{items:[]}};
  return {status:200,data:{items:[{id:'ev1',summary:'Dentist',start:{dateTime:new Date(Date.now()+3600_000).toISOString()},description:'PRIVATE',attendees:['PRIVATE']}]}};
 });
 const {get}=route('calendar','home-summary','createHomeSummaryRoutes',{query:async(q,vals)=>{
  const text=typeof q==='string'?q:q.text,values=typeof q==='string'?vals:q.values;
  sqlCalls.push({text,values,kind:text.includes('calendar_own_events')?'own-events':'snapshots'});
  return {rows:text.includes('calendar_preparation_snapshots')?snapshotRows:[]};
 }},deps);
 let r=res();await get(req({oidc:null}),r);assert.equal(r.statusCode,401);assert.equal(sqlCalls.length,0);assert.equal(googleCalls.length,0);
 r=res();await get(req({query:{user_sub:'bob'}}),r);assert.equal(r.statusCode,200);assert.deepEqual(sqlCalls.map(c=>c.kind),['own-events','snapshots']);assert.equal(r.body.metrics[0].value,'No answer');
 snapshotRows=[{synced_at:new Date(Date.now()-60_000),events:[{title:'Saved',start:new Date(Date.now()+3600_000).toISOString()}]}];
 r=res();await get(req({query:{user_sub:'bob'}}),r);assert.equal(r.statusCode,200);assert.deepEqual(sqlCalls.slice(2).map(c=>c.kind),['own-events','snapshots']);assert.equal(r.body.google.state,'saved-copy');assert.equal(r.body.metrics[0].value,'1');
 mode='live';r=res();await get(req({query:{user_sub:'bob'}}),r);assert.equal(r.statusCode,200);assert.deepEqual(sqlCalls.slice(4).map(c=>c.kind),['own-events']);assert.equal(r.body.metrics[0].value,'1');assert.equal(r.body.google.state,'live');assert.ok(!JSON.stringify(r.body).includes('PRIVATE'));assert.ok(!JSON.stringify(r.body).includes('Saved'));
 mode='not-connected';r=res();await get(req({query:{user_sub:'bob'}}),r);assert.equal(r.statusCode,200);assert.deepEqual(sqlCalls.slice(5).map(c=>c.kind),['own-events']);assert.equal(r.body.metrics[0].value,'Not connected');assert.equal(r.body.google.state,'not-connected');
 for(const c of sqlCalls){assert.equal(c.values[0],'alice');assert.match(c.text,/^SELECT .* FROM (calendar_own_events|calendar_preparation_snapshots) WHERE user_sub = \$1( AND starts_at >= \$2 ORDER BY starts_at ASC LIMIT 100)?$/);}
 for(const g of googleCalls){assert.equal(g.sub,'alice');assert.equal(g.method,'GET');assert.equal(g.payload,undefined);}
});
test('calendar sync requires confirmation and caller credentials, minimizes data, and uses fixed primary-calendar bounds',async()=>{let calls=0,writes=0;const {post}=route('calendar','sync','createCalendarSyncRoutes',{query:async(text,values)=>{writes++;assert.match(text,/^INSERT INTO calendar_preparation_snapshots/);assert.equal(values[0],'alice');assert.ok(!values[1].includes('PRIVATE'));}}, {'@/app/routes/connectors-routes':{getValidAccessToken:async(_pool,sub,provider)=>{assert.equal(sub,'alice');assert.equal(provider,'google');return 'fixture-token';}},'@/features/google-calendar':{GoogleCalendarService:class{constructor(provider){this.provider=provider;}async listUpcoming(options){calls++;assert.equal(await this.provider(),'fixture-token');assert.equal(options.calendarId,'primary');assert.equal(options.maxResults,250);return [{id:'event',summary:'Birthday',start:'2026-09-11',allDay:true,description:'PRIVATE',attendees:['PRIVATE']}];}}}});let r=res();await post(req({body:{}}),r);assert.equal(r.statusCode,400);assert.equal(calls,0);await post(req({body:{confirm:true,owner:'bob',calendarId:'other'}}),res());assert.equal(calls,1);assert.equal(writes,1);});
test('calendar disconnected and failed sync retain the prior snapshot',async()=>{for(const token of [null,'token']){const {post}=route('calendar','sync','createCalendarSyncRoutes',{query:()=>assert.fail('write')},{'@/app/routes/connectors-routes':{getValidAccessToken:async()=>token},'@/features/google-calendar':{GoogleCalendarService:class{async listUpcoming(){throw Error('SECRET');}}}});const r=res();await post(req({body:{confirm:true}}),r);assert.equal(r.statusCode,token?502:409);assert.ok(!JSON.stringify(r.body).includes('SECRET'));}});
test('discovery is operator-gated but remains caller-owned, read-only and partial-aware',async()=>{let operator=false,reads=0;const {get}=route('capability-ideator','home-summary','createHomeSummaryRoutes',{query:async q=>{reads++;assert.match(q.text,/^SELECT /);assert.match(q.text,/owner_sub = \$1/);assert.equal(q.values[0],'alice');if(reads===2)throw Error('PRIVATE');return {rows:[]};}},{'@/shared/middleware/authz':{isOperator:()=>operator}});let r=res();await get(req(),r);assert.equal(r.statusCode,403);assert.equal(reads,0);operator=true;r=res();await get(req(),r);assert.equal(r.statusCode,200);assert.equal(r.body.partial,true);assert.ok(!JSON.stringify(r.body).includes('PRIVATE'));});
