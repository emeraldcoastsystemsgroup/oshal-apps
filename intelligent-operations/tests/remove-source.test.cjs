/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | ADR-216: a delivery to a removed source answers 410 {gone} (it was 404), so the kernel's producer door can end that source's producer tokens on its route's own answer; a source that never existed, and another person's, stay 404; a source saved again takes reports again. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Remove a saved source (1.5.3, backlog P5-55b: the stopped fleet observer's six made-up installations stayed in Operations) through the real router, real SQL with forced owner policies and a store per person, as the kernel keeps one: the remove takes confirm: true and one way to name the source, another person cannot remove it, Sources, Systems' installations, the systems summary and the attention list drop it (the summaries were red before: they read every installation row), its alerts are refused, its installation row, day history and stream stay, a retry answers the first removal, saving the same definition again brings it back with its history, an ambiguous or unknown name is refused, and a desk's own source is refused and never offered. Also the tool and route bindings: held for approval, records.write, which a reader lacks. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,loadExperience,dependency,root}=require('./fixtures/intake.cjs'),{DESKS}=require('../routes/desks.js');
const yaml=dependency('js-yaml');

/** One person's Operations over the shared disposable database, with that person's own document store. */
async function person(f,owner){
 const express=dependency('express'),collections=new Map(),pool=f.caller(owner);
 const store={async query(name){return [...(collections.get(name)||new Map()).values()];},async put(name,id,value){if(!collections.has(name))collections.set(name,new Map());collections.get(name).set(id,value);}};
 const app=express();app.use((req,_res,next)=>{req.oidc={user:{sub:owner}};next();});
 app.use('/api/intelligent-operations',loadExperience().createOperationsExperienceRoutes({pool,appPackageDir:root,authorization:{registerResource(){}},store}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));}),base='http://127.0.0.1:'+server.address().port+'/api/intelligent-operations';
 const call=async(method,route,body)=>{const r=await fetch(base+route,{method,headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json().catch(()=>null)};};
 return {call,close:()=>new Promise(resolve=>server.close(resolve))};
}
const beat=scope=>({status:'firing',labels:{alertname:'InstallationHeartbeat',severity:'heartbeat',instance:scope},annotations:{summary:"This installation's monitoring is alive",host:scope,site_up:'1',site_seconds:'0.2',disk_used:'40',memory_used:'30'},startsAt:new Date(Date.now()-60000).toISOString(),endsAt:'0001-01-01T00:00:00Z',fingerprint:'beat000000000001'});
/** Save a source, map it and let it report once, as a monitored installation does. */
async function reporting(x,definition){
 const saved=await x.call('POST','/sources',definition);assert.equal(saved.status,201);
 assert.equal((await x.call('POST','/ingest/mapping',{sourceId:saved.body.id,resourceKind:'host',idLabel:'instance',scope:definition.environment})).status,200);
 assert.equal((await x.call('POST','/ingest/alertmanager/'+saved.body.id,{alerts:[beat(definition.environment)]})).status,202);
 return saved.body;
}
const FLEET={name:'OSHAL SaaS — Green',environment:'oshal-saas-green',source:'urn:operations:source:oshal-saas-green'};
const KEPT={name:'gsq-test',environment:'gsq-test',source:'urn:operations:source:gsq-test'};

test('a removed source leaves every read, its alerts are refused, its history stays, and saving it again brings it back',async()=>{
 const f=await fixture(),alice=await person(f,'alice'),bob=await person(f,'bob');
 try{
  const fleet=await reporting(alice,FLEET),kept=await reporting(alice,KEPT);
  // The fleet observer stopped: its installation went silent an hour ago.
  await f.inspect.query("UPDATE operations_processing_config SET record=jsonb_set(record,'{lastHeardAt}',to_jsonb($1::text)) WHERE user_sub='alice' AND id=$2",[new Date(Date.now()-3600000).toISOString(),'installation:'+fleet.id]);
  const silentBefore=(await alice.call('GET','/attention')).body.items.find(i=>i.label==='Monitored installations that stopped reporting');
  assert.deepEqual([silentBefore.count,silentBefore.names],[1,FLEET.name]);
  assert.match((await alice.call('GET','/summary/systems')).body.summary,/OSHAL SaaS — Green has stopped reporting/);
  for(const input of [{sourceId:fleet.id},{sourceId:fleet.id,confirm:'yes'},{sourceId:fleet.id,name:FLEET.name,confirm:true},{confirm:true},{sourceId:'x',confirm:true},{sourceId:fleet.id,confirm:true,owner:'bob'}])
   assert.equal((await alice.call('POST','/sources/remove',input)).status,400,JSON.stringify(input));
  assert.match((await alice.call('POST','/sources/remove',{confirm:true})).body.error,/send sourceId or name/);assert.match((await alice.call('POST','/sources/remove',{sourceId:fleet.id,name:FLEET.name,confirm:true})).body.error,/not both/);
  assert.equal((await bob.call('POST','/sources/remove',{sourceId:fleet.id,confirm:true})).status,404,'another person cannot reach it');
  const removed=await alice.call('POST','/sources/remove',{sourceId:fleet.id,confirm:true});
  assert.equal(removed.status,200);assert.equal(removed.body.removed,true);assert.equal(removed.body.name,FLEET.name);assert.ok(Number.isFinite(Date.parse(removed.body.discardedAt)));assert.match(removed.body.kept,/stay/);
  const again=(await alice.call('POST','/sources/remove',{sourceId:fleet.id,confirm:true})).body;
  assert.deepEqual([again.removed,again.alreadyRemoved,again.discardedAt],[false,true,removed.body.discardedAt],'a retry answers the first removal');
  assert.deepEqual((await alice.call('GET','/records')).body.sources.map(s=>s.id),[kept.id],'Sources drops it');
  const telemetry=(await alice.call('GET','/telemetry')).body;assert.deepEqual(telemetry.installations.map(i=>[i.sourceId,i.removable]),[[kept.id,true]],'Systems drops its installation');
  const systems=(await alice.call('GET','/summary/systems')).body;assert.doesNotMatch(systems.summary,/OSHAL SaaS/);assert.deepEqual(systems.installations.map(i=>i.name),[KEPT.name]);
  const silentAfter=(await alice.call('GET','/attention')).body.items.find(i=>i.label==='Monitored installations that stopped reporting');assert.equal(silentAfter.count,0,'the attention list no longer names it');
  // ADR-216: 410, not 404, so the kernel's producer door can end the source's producer tokens on its own route's answer.
  const gone=await alice.call('POST','/ingest/alertmanager/'+fleet.id,{alerts:[beat(FLEET.environment)]});
  assert.deepEqual([gone.status,gone.body],[410,{gone:'This source was removed in Operations.'}],'its alerts are refused as gone');
  assert.equal((await alice.call('POST','/ingest/alertmanager/'+'f'.repeat(64),{alerts:[beat(FLEET.environment)]})).status,404,'a source that never existed is still not found');
  assert.equal((await bob.call('POST','/ingest/alertmanager/'+fleet.id,{alerts:[beat(FLEET.environment)]})).status,404,'another person learns nothing about it');
  const history=(await f.inspect.query("SELECT id FROM operations_processing_config WHERE user_sub='alice' AND (id=$1 OR id LIKE $2)",['installation:'+fleet.id,'installation-day:'+fleet.id+':%'])).rows;
  assert.ok(history.some(r=>r.id==='installation:'+fleet.id)&&history.some(r=>r.id.startsWith('installation-day:')),'its installation row and day history stay');
  assert.equal((await f.inspect.query("SELECT count(*)::int AS n FROM operations_streams WHERE user_sub='alice' AND id=$1",[fleet.id])).rows[0].n,1,'its stream stays');
  assert.equal((await alice.call('POST','/sources',FLEET)).status,201);
  const back=(await alice.call('GET','/telemetry')).body.installations.find(i=>i.sourceId===fleet.id);
  assert.ok(back&&back.reports>=1&&back.firstHeardAt,'saving the same source again brings it back with its history');
  assert.equal((await alice.call('POST','/ingest/alertmanager/'+fleet.id,{alerts:[beat(FLEET.environment)]})).status,202,'and its reports are taken again');
 }finally{await alice.close();await bob.close();await f.close();}
});

test('a name two saved sources share, an unknown name and a desk\'s own source are refused in words',async()=>{
 const f=await fixture(),alice=await person(f,'alice');
 try{
  for(const environment of ['lab-a','lab-b'])assert.equal((await alice.call('POST','/sources',{name:'lab',environment,source:'urn:operations:source:'+environment})).status,201);
  const shared=await alice.call('POST','/sources/remove',{name:'lab',confirm:true});assert.equal(shared.status,409);assert.match(shared.body.error,/2 saved sources are named "lab"/);
  assert.equal((await alice.call('POST','/sources/remove',{name:'nobody',confirm:true})).status,404);
  const desk=DESKS.find(d=>d.id==='platform-ops'),deskSource=await reporting(alice,{name:desk.sourceName,environment:desk.sourceName,source:desk.uri});
  const refused=await alice.call('POST','/sources/remove',{sourceId:deskSource.id,confirm:true});assert.equal(refused.status,409);assert.match(refused.body.error,/Platform Ops desk's own source/);
  assert.equal((await alice.call('GET','/telemetry')).body.installations.find(i=>i.sourceId===deskSource.id).removable,false,'Systems does not offer it');
  const byName=await alice.call('POST','/sources/remove',{name:'lab',confirm:true});assert.equal(byName.status,409,'still two');
  const one=(await alice.call('GET','/records')).body.sources.find(s=>s.environment==='lab-a');
  assert.equal((await alice.call('POST','/sources/remove',{sourceId:one.id,confirm:true})).body.removed,true);
  assert.equal((await alice.call('POST','/sources/remove',{name:'lab',confirm:true})).body.removed,true,'with one left the name is enough');
  assert.deepEqual((await alice.call('GET','/records')).body.sources.map(s=>s.name),[desk.sourceName]);
 }finally{await alice.close();await f.close();}
});

test('Jarvis removes a source only with the person\'s approval, under the grant that saves one, which a reader lacks',()=>{
 const manifest=yaml.load(fs.readFileSync(path.join(root,'oshal-app.yaml'),'utf8')),auth=yaml.load(fs.readFileSync(path.join(root,'authorization.yaml'),'utf8'));
 const tool=manifest.tools.find(t=>t.name==='ops-remove-source');
 assert.equal(tool.requiresApproval,true);assert.equal(tool.executor.apiEndpoint,'POST /api/intelligent-operations/sources/remove');assert.deepEqual(tool.inputSchema.properties.confirm,{type:'boolean',const:true});assert.deepEqual(tool.inputSchema.required,['confirm']);
 assert.deepEqual(auth.bindings.tools.find(t=>t.id==='ops-remove-source').allOf,['records.write']);
 assert.deepEqual(auth.bindings.http.filter(b=>b.path==='/sources/remove').map(b=>[b.method,b.allOf]),[['POST',['records.write']]]);
 assert.ok(auth.roles.operator.grants.some(g=>g.permission==='records.write'));assert.ok(!auth.roles.reader.grants.some(g=>g.permission==='records.write'),'a reader cannot remove a source');
 assert.match(fs.readFileSync(path.join(root,'routes/experience.js'),'utf8'),/router\.post\('\/sources\/remove'/);
});
