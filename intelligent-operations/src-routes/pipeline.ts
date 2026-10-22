/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Seal stored-query policies before activation and atomically record filtering, scoped suppression and pre-evidence work reservations. */
/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Trial sealed policy candidates against owned deliveries without changing source bindings, counters or evidence work. */
// @ts-nocheck
import {randomUUID} from 'node:crypto';
import {hash} from './intake';
import {clean,fail} from './topology-model';
const conflict=e=>['40001','40P01','23505'].includes(e.code)||/scoped collection revision changed/.test(e.message);
async function tx(pool,run){for(let i=0;i<8;i++){const c=await pool.connect();try{await c.query('BEGIN');const result=await run(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK').catch(()=>{});if(!conflict(e)||i===7)throw e;}finally{await c.release();}}}
const requireOwner=owner=>{if(!clean(owner))fail(401,'A verified caller is required.');};
const idValid=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
export function policyDefinition(input){
 if(!input||!clean(input.name,80)||!Array.isArray(input.rules)||!input.rules.length||input.rules.length>128||!['fixed','sliding'].includes(input.window?.mode)||!Number.isInteger(input.window.seconds)||input.window.seconds<1||input.window.seconds>86400)fail(400,'Policy needs a name, 1–128 rules, and an explicit fixed/sliding window of 1–86400 seconds.');
 if(Buffer.byteLength(JSON.stringify(input))>65536)fail(413,'Policy exceeds 64 KiB.');
 const rules=input.rules.map(r=>{if(!r||!clean(r.name,80)||typeof r.enabled!=='boolean'||typeof r.capture!=='boolean'||!r.query||typeof r.query!=='object'||Array.isArray(r.query))fail(400,'Each rule needs its name, query, enabled state and snapshot choice.');const body={name:r.name,enabled:r.enabled,capture:r.capture,query:r.query};return {...body,id:hash(['rule-v1',body])};});
 if(new Set(rules.map(r=>r.name)).size!==rules.length)fail(400,'Rule names must be unique within a policy.');
 rules.sort((a,b)=>a.id.localeCompare(b.id));const body={name:input.name,rules,window:{mode:input.window.mode,seconds:input.window.seconds}};return {...body,id:hash(['policy-v1',body])};
}
export async function publishPolicy(pool,engine,owner,source,input,expectedRevision){
 requireOwner(owner);const policy=policyDefinition(input);
 const receipt=await engine('publish',owner,{revision:policy.id,rules:policy.rules.map(({id,enabled,query})=>({id,enabled,query}))});
 if(receipt.revision!==policy.id||receipt.sealed!==true||receipt.count!==policy.rules.length)fail(503,'The complete rule generation was not confirmed published.');
 return tx(pool,async c=>{
  const current=(await c.query('SELECT revision, record FROM operations_policy_bindings WHERE user_sub=$1 AND id=$2 FOR UPDATE',[owner,source.id])).rows[0];
  if((current?.revision??0)!==expectedRevision)fail(409,'The active source policy changed. Refresh before publishing.');
  const published={...policy,publishedAt:new Date().toISOString(),receipt};
  const old=(await c.query('SELECT id FROM operations_policies WHERE user_sub=$1 AND id=$2',[owner,policy.id])).rows[0];
  if(!old)await c.query('INSERT INTO operations_policies(user_sub,id,record) VALUES($1,$2,$3)',[owner,policy.id,JSON.stringify(published)]);
  const binding={sourceId:source.id,policyId:policy.id,revision:expectedRevision+1,activatedAt:published.publishedAt};
  if(current)await c.query('UPDATE operations_policy_bindings SET revision=$3, record=$4 WHERE user_sub=$1 AND id=$2',[owner,source.id,binding.revision,JSON.stringify(binding)]);
  else await c.query('INSERT INTO operations_policy_bindings(user_sub,id,revision,record) VALUES($1,$2,$3,$4)',[owner,source.id,binding.revision,JSON.stringify(binding)]);
  return {policy:published,binding};
 });
}
function document(record){const n=record.normalized,d=n.data;return {source:n.source,environment:d.environment,alertType:d.alertType,severity:d.severity,status:d.status,resourceKind:d.resource.kind,resourceScope:d.resource.scope,resourceId:d.resource.id,time:n.time,...(typeof d.message==='string'?{message:d.message.slice(0,4096)}:{})};}
export async function previewPolicy(pool,engine,owner,source,input,deliveryIds){
 requireOwner(owner);
 if(!Array.isArray(deliveryIds)||!deliveryIds.length||deliveryIds.length>20||new Set(deliveryIds).size!==deliveryIds.length||deliveryIds.some(id=>!idValid(id)))fail(400,'Select 1–20 distinct recorded deliveries for this source.');
 const slots=deliveryIds.map((_,i)=>'$'+(i+2)).join(',');
 const records=(await pool.query('SELECT record FROM operations_deliveries WHERE user_sub=$1 AND id IN ('+slots+')',[owner,...deliveryIds])).rows.map(r=>r.record);
 if(records.length!==deliveryIds.length||records.some(r=>r.sourceId!==source.id))fail(404,'A selected delivery is unavailable under this source and account.');
 if(records.some(r=>r.decision!=='validated'))fail(400,'Only validated deliveries can test a policy.');
 const policy=policyDefinition(input),receipt=await engine('publish',owner,{revision:policy.id,rules:policy.rules.map(({id,enabled,query})=>({id,enabled,query}))});
 if(receipt.revision!==policy.id||receipt.sealed!==true||receipt.count!==policy.rules.length)fail(503,'The candidate rule generation was not confirmed sealed.');
 // A candidate is an intentional immutable saved generation, not a disposable index or an activation.
 await tx(pool,async c=>{if(!(await c.query('SELECT id FROM operations_policies WHERE user_sub=$1 AND id=$2',[owner,policy.id])).rows.length)await c.query('INSERT INTO operations_policies(user_sub,id,record) VALUES($1,$2,$3)',[owner,policy.id,JSON.stringify({...policy,publishedAt:new Date().toISOString(),receipt})]);});
 const results=[];
 for(const id of deliveryIds){const record=records.find(r=>r.id===id),matched=await engine('match',owner,{revision:policy.id,document:document(record)});
  if(matched.complete!==true||matched.revision!==policy.id||!Array.isArray(matched.matches)||matched.matches.length!==matched.total||new Set(matched.matches).size!==matched.matches.length||matched.matches.some(rule=>!policy.rules.some(r=>r.id===rule&&r.enabled)))fail(503,'Candidate percolation returned an incomplete match set.');
  results.push({deliveryId:id,eventId:record.normalized.id,resource:record.normalized.data.resource,outcome:matched.matches.length?'matched':'unmatched',matches:policy.rules.filter(r=>matched.matches.includes(r.id)).map(({id,name,capture})=>({id,name,capture}))});
 }
 return {policyId:policy.id,sourceId:source.id,savedCandidate:true,activationChanged:false,decisionsCommitted:false,evidenceReserved:false,complete:true,results,summary:{observations:results.length,matched:results.filter(r=>r.outcome==='matched').length,filtered:results.filter(r=>r.outcome==='unmatched').length}};
}
async function failureAttempt(pool,owner,id,error){const record={id:randomUUID(),deliveryId:id,outcome:'evaluation-failed',reason:error.status?error.message:'Detection storage or engine is unavailable.',at:new Date().toISOString()};await pool.query('INSERT INTO operations_processing_attempts(user_sub,id,record,created_at) VALUES($1,$2,$3,$4)',[owner,record.id,JSON.stringify(record),record.at]);}
export async function evaluateDelivery(pool,engine,owner,id,clock=()=>new Date().toISOString(),fence=null){
 requireOwner(owner);if(!idValid(id))fail(400,'Select a recorded delivery.');
 try{
  const record=(await pool.query('SELECT record FROM operations_deliveries WHERE user_sub=$1 AND id=$2',[owner,id])).rows[0]?.record;
  if(!record)fail(404,'Delivery is unavailable in your scope.');if(record.decision!=='validated')fail(400,'Only validated deliveries can enter filtering.');
  const binding=(await pool.query('SELECT record FROM operations_policy_bindings WHERE user_sub=$1 AND id=$2',[owner,record.sourceId])).rows[0]?.record;
  if(!binding)fail(409,'No published policy is active for this source revision.');
  const policy=(await pool.query('SELECT record FROM operations_policies WHERE user_sub=$1 AND id=$2',[owner,binding.policyId])).rows[0]?.record;if(!policy)fail(503,'The published policy is unavailable.');
  const decisionId=hash(['filter-v1',id,policy.id]);const existing=(await pool.query('SELECT record FROM operations_filter_decisions WHERE user_sub=$1 AND id=$2',[owner,decisionId])).rows[0];if(existing)return {...existing.record,retry:true};
  const result=await engine('match',owner,{revision:policy.id,document:document(record)});
  if(result.complete!==true||result.revision!==policy.id||!Array.isArray(result.matches)||result.matches.length!==result.total||new Set(result.matches).size!==result.matches.length||result.matches.some(id=>!policy.rules.some(r=>r.id===id&&r.enabled)))fail(503,'Percolation did not return a complete, valid rule match set.');
  return await tx(pool,async c=>{
   const work=(await c.query('SELECT record FROM operations_processing WHERE user_sub=$1 AND id=$2 FOR UPDATE',[owner,id])).rows[0];if(!work)fail(409,'The durable processing admission is unavailable.');
   const now=clock();if(fence)await fence(c,work,now);
   const previous=(await c.query('SELECT record FROM operations_filter_decisions WHERE user_sub=$1 AND id=$2',[owner,decisionId])).rows[0];if(previous)return {...previous.record,retry:true};
   const active=(await c.query('SELECT revision FROM operations_policy_bindings WHERE user_sub=$1 AND id=$2 FOR UPDATE',[owner,record.sourceId])).rows[0];if(active?.revision!==binding.revision)fail(409,'Policy changed during evaluation; retry with its current revision.');
   const reduction=await reduce(c,owner,record,policy,result.matches,now);
   const decision={id:decisionId,deliveryId:id,sourceId:record.sourceId,policyId:policy.id,bindingRevision:binding.revision,at:now,backend:result.backend,engineBuild:result.engineBuild,matches:result.matches,outcome:result.matches.length?'matched':'unmatched',reduction,previousDecisionId:work.record.filterDecisionId||null};
   await c.query('INSERT INTO operations_filter_decisions(user_sub,id,delivery_id,record,created_at) VALUES($1,$2,$3,$4,$5)',[owner,decisionId,id,JSON.stringify(decision),now]);
   const state=reduction.workId?'evidence-pending':'processed';await c.query('UPDATE operations_processing SET state=$3, revision=revision+1, record=$4, ready_at=$5 WHERE user_sub=$1 AND id=$2',[owner,id,state,JSON.stringify({...work.record,filterDecisionId:decisionId,reduction,...(work.record.processing?{processing:{...work.record.processing,status:'completed',token:null,leaseUntil:null,completedAt:now}}:{})}),now]);
   return decision;
  });
 }catch(error){if(![400,401,404].includes(error.status))await failureAttempt(pool,owner,id,error);throw error;}
}
const severity={info:0,warning:1,error:2,critical:3};
async function reduce(c,owner,delivery,policy,matches,now){
 const key=hash(['symptom-v1',policy.name,delivery.identity.symptom]),occurrenceId=hash([key,delivery.id]);
 const previous=(await c.query('SELECT record FROM operations_symptom_occurrences WHERE user_sub=$1 AND id=$2',[owner,occurrenceId])).rows[0];if(previous)return {...previous.record,replayed:true};
 const result=await reduceNew(c,owner,delivery,policy,matches,now);
 if(result.outcome!=='filtered')await c.query('INSERT INTO operations_symptom_occurrences(user_sub,id,record) VALUES($1,$2,$3)',[owner,occurrenceId,JSON.stringify(result)]);
 return result;
}
async function reduceNew(c,owner,delivery,policy,matches,now){
 const event=delivery.normalized,key=hash(['symptom-v1',policy.name,delivery.identity.symptom]);
 const previous=(await c.query('SELECT record FROM operations_symptoms WHERE user_sub=$1 AND id=$2 FOR UPDATE',[owner,key])).rows[0]?.record;
 const eventTime=new Date(event.time).toISOString(),oldTime=previous?.eventTime;
 if(!matches.length&&event.data.status!=='resolved')return {outcome:'filtered',symptomKey:key};
 if(event.data.status==='resolved'&&!previous)return {outcome:'orphan-resolution',symptomKey:key};
 const late=oldTime&&eventTime<oldTime,ambiguous=oldTime===eventTime&&previous.status!==event.data.status;
 const expired=!previous||Date.parse(now)>=Date.parse(previous.expiresAt),reopened=previous?.status==='resolved';
 const fresh=event.data.status==='firing'&&!late&&!ambiguous&&(expired||reopened);
 const escalation=!fresh&&previous&&event.data.status==='firing'&&!late&&!ambiguous&&(severity[event.data.severity]>severity[previous.maxSeverity||previous.severity]);
 const admitted=Boolean(fresh||escalation),episode=fresh?hash([key,delivery.id]):previous?.episode;
 const row={...previous,id:key,identity:delivery.identity.symptom,policyName:policy.name,policyId:policy.id,episode,revision:fresh?1:(previous?.revision||0)+(escalation?1:0),count:(previous?.count||0)+1,firstSeen:previous?.firstSeen||now,lastSeen:now,eventTime:late||ambiguous?oldTime:eventTime,status:late||ambiguous?previous.status:event.data.status,severity:late||ambiguous?previous.severity:event.data.severity};
 row.episodeCount=fresh?1:(previous?.episodeCount||0)+1;row.maxSeverity=late||ambiguous?(previous.maxSeverity||previous.severity):fresh?event.data.severity:(severity[event.data.severity]>severity[previous?.maxSeverity||previous?.severity]?event.data.severity:(previous?.maxSeverity||previous?.severity));
 row.expiresAt=fresh||(!late&&!ambiguous&&policy.window.mode==='sliding')?new Date(Date.parse(now)+policy.window.seconds*1000).toISOString():previous.expiresAt;
 if(previous)await c.query('UPDATE operations_symptoms SET record=$3 WHERE user_sub=$1 AND id=$2',[owner,key,JSON.stringify(row)]);else await c.query('INSERT INTO operations_symptoms(user_sub,id,record) VALUES($1,$2,$3)',[owner,key,JSON.stringify(row)]);
 const outcome=late?'late-occurrence':ambiguous?'ambiguous-state-time':event.data.status==='resolved'?'source-resolved':fresh?'admitted':escalation?'escalated':'suppressed';
 if(!admitted)return {outcome,symptomKey:key,episode,revision:row.revision,count:row.count};
 const workId=hash(['evidence-v1',key,episode,row.revision]),capture=policy.rules.some(r=>matches.includes(r.id)&&r.capture);
 const work={id:workId,symptomKey:key,episode,revision:row.revision,deliveryId:delivery.id,policyId:policy.id,ruleIds:matches,capture,state:'pending',createdAt:now,executionAuthorized:false};
 await c.query('INSERT INTO operations_evidence_work(user_sub,id,state,record,created_at) VALUES($1,$2,$3,$4,$5)',[owner,workId,'pending',JSON.stringify(work),now]);
 return {outcome,symptomKey:key,episode,revision:row.revision,count:row.count,workId,capture};
}
export async function pipelineRecords(pool,owner){requireOwner(owner);const read=async table=>{const order=['operations_filter_decisions','operations_processing_attempts','operations_evidence_work','operations_topology_decisions'].includes(table)?'created_at DESC, id':'id';return (await pool.query('SELECT record FROM '+table+' WHERE user_sub=$1 ORDER BY '+order+' LIMIT 200',[owner])).rows.map(r=>r.record);};const [policies,bindings,decisions,attempts,symptoms,evidenceWork,correlations]=await Promise.all(['operations_policies','operations_policy_bindings','operations_filter_decisions','operations_processing_attempts','operations_symptoms','operations_evidence_work','operations_topology_decisions'].map(read));return {policies,bindings,decisions,attempts,symptoms,evidenceWork,correlations,limits:{perCollection:200}};}

export {tx as processingTransaction};
