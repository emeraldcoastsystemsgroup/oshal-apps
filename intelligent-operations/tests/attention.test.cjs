/* CHANGE LOG: 5 | maintainer@emeraldcoastsystemsgroup.com | One Jarvis tool writes (1.5.3, P5-55b): ops-remove-source is held for the person's approval and bound under records.write, like the POST /sources/remove route it calls; every other tool still reads under exactly one read permission shared with its GET route. */
/* CHANGE LOG: 4 | maintainer@emeraldcoastsystemsgroup.com | The four desk tools (ops-app-desk, ops-security-desk, ops-platform-desk, ops-release-desk) are bound to their desk's read permission, not app.open, so the tool check now asks for exactly one read permission shared with the tool's route, and names which. */
/* CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | A refused start older than three days no longer counts as waiting: the card keeps its reason and nothing can be done about old evidence (third review, 2026-11-04). */
/* CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Guard the Jarvis systems, response-plan and anomaly summaries: own records only, degraded assets named with scope, discovery state stated, nothing claimed as run. */
/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the Jarvis attention summary and tools: counts come from the caller's own saved records in real SQL (another person sees nothing), the summary sentence names only what waits on the person, and every declared tool is read-only, bound under app.open and backed by a route the package serves. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {fixture,dependency,root}=require('./fixtures/intake.cjs'),{attentionSummary,systemsSummary,responsesSummary,anomaliesSummary}=require('../routes/attention.js'),{saveScan}=require('../routes/topology-store.js'),{saveDiscoveryConfig}=require('../routes/discovery.js'),{loadExperience}=require('./fixtures/intake.cjs');
const yaml=dependency('js-yaml');
test('the attention summary counts only the caller\'s own records and names only what waits on them',async()=>{
 const f=await fixture();try{const ins=(t,id,record)=>f.inspect.query('INSERT INTO '+t+'(user_sub,id,created_at,record) VALUES($1,$2,now(),$3)',['alice',id,JSON.stringify(record)]);
  await ins('operations_action_plans','p1',{id:'p1'});await ins('operations_action_plans','p2',{id:'p2'});
  await ins('operations_action_approvals','a2',{id:'a2',planId:'p2',expiresAt:new Date(Date.now()+600000).toISOString()});
  await ins('operations_action_executions','e1',{id:'e1',planId:'p1',state:'completed',recovery:{outcome:'regressed'}});
  await ins('operations_investigations','i1',{id:'i1',state:'started',trigger:'scheduled-tick'});await ins('operations_investigations','i2',{id:'i2',state:'start-refused',error:'refused: x'});await ins('operations_investigations','i3',{id:'i3',state:'start-refused',error:'refused: old',createdAt:new Date(Date.now()-4*86400000).toISOString()});
  await ins('operations_delegations','d1',{id:'d1',direction:'outbound',state:'delivered'});await ins('operations_delegations','d2',{id:'d2',direction:'inbound',ticketId:randomUUID()});
  await f.inspect.query("INSERT INTO operations_anomaly_state(user_sub,id,record) VALUES('alice','baseline:x',$1)",[JSON.stringify({state:{firing:true}})]);
  const s=await attentionSummary(f.caller('alice'),'alice'),by=Object.fromEntries(s.items.map(i=>[i.label,i.count]));
  assert.equal(by['Response plans awaiting your approval'],0,'p1 has an execution, p2 a live approval');assert.equal(by['Executions without verified recovery'],1);assert.equal(by['Anomaly baselines firing'],1);
  assert.equal(by['Investigations started automatically'],1);assert.equal(by['Automatic starts refused or uncertain'],1);assert.equal(by['Hand-offs sent to other swarms'],1);assert.equal(by['Delegations from other swarms filed as investigations'],1);
  assert.match(s.summary,/1 executions without verified recovery; 1 anomaly baselines firing; 1 automatic starts refused or uncertain\./);assert.doesNotMatch(s.summary,/hand-offs sent/);assert.equal(s.executionAuthorized,false);
  const bob=await attentionSummary(f.caller('bob'),'bob');assert.ok(bob.items.every(i=>i.count===0));assert.equal(bob.summary,'Nothing in Operations is waiting on you.');
 }finally{await f.close();}
});
test('every Jarvis tool but ops-remove-source is read-only, bound under exactly one read permission and backed by a route bound the same way',()=>{
 const manifest=yaml.load(fs.readFileSync(path.join(root,'oshal-app.yaml'),'utf8')),auth=yaml.load(fs.readFileSync(path.join(root,'authorization.yaml'),'utf8'));
 const bound=Object.fromEntries(auth.bindings.tools.map(t=>[t.id,t.allOf]));const http=Object.fromEntries(auth.bindings.http.map(b=>[b.method+' '+b.path,b.allOf]));
 assert.deepEqual(manifest.tools.map(t=>t.name).sort(),Object.keys(bound).sort());
 for(const tool of manifest.tools){
  // The one write: held for approval, under records.write like the route it calls.
  if(tool.name==='ops-remove-source'){assert.equal(tool.requiresApproval,true);assert.deepEqual(bound[tool.name],['records.write']);assert.equal(auth.permissions['records.write'].effect,'write');assert.equal(tool.executor.apiEndpoint,'POST /api/intelligent-operations/sources/remove');assert.deepEqual(http['POST /sources/remove'],['records.write']);continue;}
  assert.equal(tool.requiresApproval,false);assert.equal(bound[tool.name].length,1,tool.name+' is bound under one permission');assert.equal(auth.permissions[bound[tool.name][0]].effect,'read',tool.name+' is a read');
  const [method,endpoint]=tool.executor.apiEndpoint.split(' ');assert.equal(method,'GET',tool.name+' reads only');
  const route=endpoint.replace('/api/intelligent-operations','');assert.deepEqual(http['GET '+route],bound[tool.name],tool.name+' has an HTTP binding for '+route+' under the same permission');
  // A desk tool reads its desk alone; everything else rides app.open.
  assert.equal(bound[tool.name][0],tool.name.endsWith('-desk')?'desk.'+{app:'app',security:'security',platform:'platform',release:'release'}[tool.name.split('-')[1]]:'app.open',tool.name);}
});

test('Jarvis summaries name degraded systems, discovery state, plans and anomalies from the caller\'s own records only',async()=>{
 const f=await fixture();
 try{const pool=f.caller('alice'),source=loadExperience().sourceDefinition({name:'lab',environment:'lab',source:'https://kubernetes.lab.example/clusters/operations-lab'});
  await saveScan(pool,'alice',source,{scanId:'s1',collectionId:'c/ns',observedAt:'2026-10-23T03:00:00.000Z',complete:true,assets:[{provider:'kubernetes',scope:'c',kind:'node',nativeId:'n1',name:'worker-1',health:'degraded',properties:{pressure:'MemoryPressure'}},{provider:'kubernetes',scope:'c',kind:'node',nativeId:'n2',name:'worker-2',health:'healthy'},{provider:'kubernetes',scope:'c',kind:'pod',nativeId:'p1',name:'api-1',health:'unknown',properties:{namespace:'ops'}}],relationships:[]});
  let s=await systemsSummary(pool,'alice');
  assert.deepEqual(s.counts,{assets:3,healthy:1,degraded:1,unknown:1});assert.deepEqual(s.issues.map(i=>[i.name,i.health,i.scope]),[['worker-1','degraded','c'],['api-1','unknown','c']]);assert.equal(s.issues[0].pressure,'MemoryPressure');
  assert.match(s.summary,/Scheduled discovery is off/);assert.equal(s.executionAuthorized,false);
  await saveDiscoveryConfig(pool,'alice',{enabled:true,account:'primary',sourceId:source.id,scope:'c',namespace:'ops',intervalMinutes:15,expectedRevision:0},[source.id]);
  s=await systemsSummary(pool,'alice');assert.match(s.summary,/waiting for its first read/);assert.equal(s.discovery.namespace,'ops');
  const bob=await systemsSummary(f.caller('bob'),'bob');assert.equal(bob.counts.assets,0);assert.equal(bob.issues.length,0);
  const r=await responsesSummary({pool},'alice');assert.equal(r.plans.length,0);assert.match(r.summary,/^0 response plans/);assert.match(r.approveAndRunIn,/cannot approve or run/);
  const a=await anomaliesSummary(pool,'alice');assert.equal(a.baselines.length,0);assert.match(a.summary,/0 baselines/);
 }finally{await f.close();}
});
