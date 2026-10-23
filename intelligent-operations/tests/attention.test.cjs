/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the Jarvis attention summary and tools: counts come from the caller's own saved records in real SQL (another person sees nothing), the summary sentence names only what waits on the person, and every declared tool is read-only, bound under app.open and backed by a route the package serves. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {fixture,dependency,root}=require('./fixtures/intake.cjs'),{attentionSummary}=require('../routes/attention.js');
const yaml=dependency('js-yaml');
test('the attention summary counts only the caller\'s own records and names only what waits on them',async()=>{
 const f=await fixture();try{const ins=(t,id,record)=>f.inspect.query('INSERT INTO '+t+'(user_sub,id,created_at,record) VALUES($1,$2,now(),$3)',['alice',id,JSON.stringify(record)]);
  await ins('operations_action_plans','p1',{id:'p1'});await ins('operations_action_plans','p2',{id:'p2'});
  await ins('operations_action_approvals','a2',{id:'a2',planId:'p2',expiresAt:new Date(Date.now()+600000).toISOString()});
  await ins('operations_action_executions','e1',{id:'e1',planId:'p1',state:'completed',recovery:{outcome:'regressed'}});
  await ins('operations_investigations','i1',{id:'i1',state:'started',trigger:'scheduled-tick'});await ins('operations_investigations','i2',{id:'i2',state:'start-refused',error:'refused: x'});
  await ins('operations_delegations','d1',{id:'d1',direction:'outbound',state:'delivered'});await ins('operations_delegations','d2',{id:'d2',direction:'inbound',ticketId:randomUUID()});
  await f.inspect.query("INSERT INTO operations_anomaly_state(user_sub,id,record) VALUES('alice','baseline:x',$1)",[JSON.stringify({state:{firing:true}})]);
  const s=await attentionSummary(f.caller('alice'),'alice'),by=Object.fromEntries(s.items.map(i=>[i.label,i.count]));
  assert.equal(by['Response plans awaiting your approval'],0,'p1 has an execution, p2 a live approval');assert.equal(by['Executions without verified recovery'],1);assert.equal(by['Anomaly baselines firing'],1);
  assert.equal(by['Investigations started automatically'],1);assert.equal(by['Automatic starts refused or uncertain'],1);assert.equal(by['Hand-offs sent to other swarms'],1);assert.equal(by['Delegations from other swarms filed as investigations'],1);
  assert.match(s.summary,/1 executions without verified recovery; 1 anomaly baselines firing; 1 automatic starts refused or uncertain\./);assert.doesNotMatch(s.summary,/hand-offs sent/);assert.equal(s.executionAuthorized,false);
  const bob=await attentionSummary(f.caller('bob'),'bob');assert.ok(bob.items.every(i=>i.count===0));assert.equal(bob.summary,'Nothing in Operations is waiting on you.');
 }finally{await f.close();}
});
test('every Jarvis tool is read-only, bound under app.open and backed by a served route',()=>{
 const manifest=yaml.load(fs.readFileSync(path.join(root,'oshal-app.yaml'),'utf8')),auth=yaml.load(fs.readFileSync(path.join(root,'authorization.yaml'),'utf8'));
 const bound=Object.fromEntries(auth.bindings.tools.map(t=>[t.id,t.allOf]));const http=auth.bindings.http.map(b=>b.method+' '+b.path);
 assert.deepEqual(manifest.tools.map(t=>t.name).sort(),Object.keys(bound).sort());
 for(const tool of manifest.tools){assert.equal(tool.requiresApproval,false);assert.deepEqual(bound[tool.name],['app.open']);const [method,endpoint]=tool.executor.apiEndpoint.split(' ');assert.equal(method,'GET',tool.name+' reads only');
  const route=endpoint.replace('/api/intelligent-operations','');assert.ok(http.includes('GET '+route),tool.name+' has an HTTP binding for '+route);}
});
