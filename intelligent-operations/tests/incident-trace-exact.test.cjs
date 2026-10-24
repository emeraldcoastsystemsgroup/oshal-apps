/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Prove exact incident lineage survives global page rollover, remains caller isolated, and reports per-ticket caps. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,dependency,loadExperience,root}=require('./fixtures/intake.cjs');
const {incidentTrace}=require('../routes/incident-trace.js');
const ticketId='11111111-1111-4111-8111-111111111111',otherTicket='22222222-2222-4222-8222-222222222222';
const work='a'.repeat(64),delivery='b'.repeat(64),plan='c'.repeat(64),link='d'.repeat(64);
const at='2026-10-20T10:00:00Z';
async function put(pool,table,fields,values){
 const names=['user_sub',...fields,'record'],slots=names.map((_,i)=>'$'+(i+1)).join(',');
 await pool.query('INSERT INTO '+table+'('+names.join(',')+') VALUES('+slots+')',values);
}
test('exact ticket trace retrieves an older decision and cohort beyond the global 200-record page',async()=>{
 const f=await fixture();try{
  const pool=f.caller('alice');
  await put(pool,'operations_investigations',['id','created_at'],['alice',work,at,JSON.stringify({id:work,ticketId,deliveryId:delivery,packetSha256:'e'.repeat(64)})]);
  await put(pool,'operations_deliveries',['id','source_uri','event_id','payload_hash','source_revision','received_at'],['alice',delivery,'urn:lab',null,'f'.repeat(64),'g'.repeat(64),at,JSON.stringify({id:delivery,decision:'validated',receivedAt:at,normalized:{data:{alertType:'CPU pressure',resource:{id:'pod-a'}}}})]);
  await put(pool,'operations_filter_decisions',['id','delivery_id','created_at'],['alice','old-decision',delivery,at,JSON.stringify({id:'old-decision',deliveryId:delivery,outcome:'matched',at,reduction:{outcome:'admitted'}})]);
  await put(pool,'operations_topology_decisions',['id','created_at'],['alice','old-cohort',at,JSON.stringify({id:'old-cohort',deliveryIds:[delivery],groups:[{id:'group-a'}]})]);
  await put(pool,'operations_evidence_work',['id','state','created_at'],['alice',work,'captured',at,JSON.stringify({id:work,captureProcessing:{packetSha256:'e'.repeat(64)}})]);
  await put(pool,'operations_external_evidence',['id','created_at'],['alice',work,at,JSON.stringify({id:work,status:'not-configured',items:[]})]);
  await put(pool,'operations_action_plans',['id','created_at'],['alice',plan,at,JSON.stringify({id:plan,ticketId,ticketRevision:1,workId:work,phase:'revise',artifacts:[{name:'remediate.sh',sha256:'e'.repeat(64),bytes:18}]})]);
  await put(pool,'operations_action_approvals',['id','created_at'],['alice','approval-1',at,JSON.stringify({id:'approval-1',planId:plan,grantedAt:at,expiresAt:'2026-10-23T10:00:00Z'})]);
  await put(pool,'operations_action_executions',['id','created_at'],['alice','execution-1',at,JSON.stringify({id:'execution-1',planId:plan,recovery:{outcome:'healthy',signalVerifiedByServer:true}})]);
  await put(pool,'operations_ticket_links',['id','created_at'],['alice',link,at,JSON.stringify({id:link,ticketId,provider:'jira',recordKey:'OPS-1'})]);
  await put(pool,'operations_sync_attempts',['id','created_at'],['alice','attempt-1',at,JSON.stringify({id:'attempt-1',linkId:link,state:'operator-reported-readback-matched'})]);
  await pool.query("INSERT INTO operations_filter_decisions(user_sub,id,delivery_id,created_at,record) SELECT 'alice','new-'||n,'unrelated-'||n,'2026-10-23T10:00:00Z'::timestamptz,jsonb_build_object('id','new-'||n,'deliveryId','unrelated-'||n) FROM generate_series(1,205) n");
  await pool.query("INSERT INTO operations_topology_decisions(user_sub,id,created_at,record) SELECT 'alice','new-cohort-'||n,'2026-10-23T10:00:00Z'::timestamptz,jsonb_build_object('id','new-cohort-'||n,'deliveryIds',jsonb_build_array('unrelated-'||n)) FROM generate_series(1,205) n");
  const ctx={pool,ticketService:{getTicket:async id=>({id,ticketType:'intelligent-operations',status:'done',revision:2})}};
  const result=await incidentTrace(ctx,'alice',ticketId);
  assert.equal(result.data.exact,true);assert.equal(result.data.pipeline.decisions[0].id,'old-decision');assert.equal(result.data.pipeline.correlations[0].id,'old-cohort');assert.equal(result.data.records.events[0].id,delivery);
  assert.equal(result.data.responses.items[0].approval.id,'approval-1');assert.equal(result.data.responses.items[0].executions[0].id,'execution-1');assert.equal(result.data.responses.items[0].downloads[0].name,'remediate.sh');assert.equal(result.data.sync.attempts[0].id,'attempt-1');assert.equal(result.data.external.items[0].status,'not-configured');
  assert.deepEqual(Object.values(result.limits),Array(Object.keys(result.limits).length).fill(false));
  const bob=await incidentTrace({...ctx,pool:f.caller('bob')},'bob',ticketId);assert.equal(bob.data.investigations.items.length,0);assert.equal(bob.data.responses.items.length,0);assert.equal(bob.data.sync.items.length,0);
  await assert.rejects(incidentTrace(ctx,'alice','bad-id'),{status:400});
  await assert.rejects(incidentTrace({...ctx,ticketService:{getTicket:async()=>({id:otherTicket,ticketType:'other'})}},'alice',ticketId),{status:404});
 }finally{await f.close();}
});
test('exact trace flags overflow instead of treating omitted linked plans as absent',async()=>{
 const f=await fixture();try{const pool=f.caller('alice');
  for(let i=0;i<21;i++)await put(pool,'operations_action_plans',['id','created_at'],['alice','plan-'+i,at,JSON.stringify({id:'plan-'+i,ticketId,artifacts:[]})]);
  const result=await incidentTrace({pool,ticketService:{getTicket:async()=>({id:ticketId,ticketType:'intelligent-operations',status:'done',revision:1})}},'alice',ticketId);
  assert.equal(result.data.responses.items.length,20);assert.equal(result.limits.plans,true);assert.equal(result.data.responses.truncated,true);
 }finally{await f.close();}
});
test('installed route shape reads only the caller ticket and has GET/HEAD admission declarations',async()=>{
 const f=await fixture();let server;try{
  const express=dependency('express'),app=express(),pool=f.caller('alice');
  app.use((req,_res,next)=>{req.oidc={user:{sub:'alice'}};next();});
  app.use('/api/intelligent-operations',loadExperience().createOperationsExperienceRoutes({pool,appPackageDir:root,authorization:{registerResource(){}},store:{query:async()=>[],put:async()=>{}},ticketService:{getTicket:async id=>({id,ticketType:'intelligent-operations',status:'done',revision:1})}}));
  server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port+'/api/intelligent-operations/incidents/';
  const response=await fetch(base+ticketId+'/trace');assert.equal(response.status,200);const body=await response.json();assert.equal(body.ticket.id,ticketId);assert.equal(body.data.exact,true);assert.deepEqual(body.data.investigations.items,[]);
  assert.equal((await fetch(base+ticketId+'/trace',{method:'HEAD'})).status,200);
  assert.equal((await fetch(base+'invalid/trace')).status,400);
  const yaml=dependency('js-yaml'),fs=require('node:fs'),path=require('node:path'),auth=yaml.load(fs.readFileSync(path.join(root,'authorization.yaml'),'utf8'));
  for(const method of ['GET','HEAD'])assert.ok(auth.bindings.http.some(row=>row.method===method&&row.path==='/incidents/:ticketId/trace'&&row.allOf.includes('app.open')));
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await f.close();}
});
