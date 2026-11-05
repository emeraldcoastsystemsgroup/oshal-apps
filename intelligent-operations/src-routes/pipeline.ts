/** CHANGE LOG: 5 | maintainer@emeraldcoastsystemsgroup.com | What a fourth review proved (2026-11-04). The worker's decisions say so, because only they may reach the phone: a replay or an Evaluate pressed after a policy edit paged critical alerts that were not happening. A re-fire that also escalated has its evidence already, so it does not wait for another. A promotion is written to the occurrence too, so a later re-evaluation does not undo it. The kernel's conflict wording changed, so the retry now matches both. */
/** CHANGE LOG: 4 | maintainer@emeraldcoastsystemsgroup.com | A third review proved a real outage that began with a blip never got evidence or a ticket, however long it lasted: its re-fire inside the window was only recorded, and nothing fired again to open the new occurrence (2026-11-04). A re-fire is now remembered, and promoteRefired gives it its own evidence once the window has passed if it is still firing. A flap that clears first costs nothing. */
/** CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Two holes an independent review proved (2026-11-03). A resolve evaluated before its firing (the percolator was down at the raise) now writes the symptom, so the older firing evaluates as late instead of opening a symptom on a recovered resource. A re-fire inside the policy window of the last admission is 'refired': recorded and told, with no new packet or ticket, so a flapping alert stops opening one of each per flap; after the window it is a new occurrence. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Seal stored-query policies before activation and atomically record filtering, scoped suppression and pre-evidence work reservations. */
/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Trial sealed policy candidates against owned deliveries without changing source bindings, counters or evidence work. */
// @ts-nocheck
import {randomUUID} from 'node:crypto';
import {hash} from './intake';
import {clean,fail} from './topology-model';
const conflict=e=>['40001','40P01','23505'].includes(e.code)||/scoped collection revision/.test(e.message);
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
export async function evaluateDelivery(pool,engine,owner,id,clock=()=>new Date().toISOString(),fence=null,quiet=false){
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
   const decision={id:decisionId,deliveryId:id,sourceId:record.sourceId,policyId:policy.id,bindingRevision:binding.revision,at:now,backend:result.backend,engineBuild:result.engineBuild,matches:result.matches,outcome:result.matches.length?'matched':'unmatched',reduction,previousDecisionId:work.record.filterDecisionId||null,...(fence?{byWorker:true}:{})};
   await c.query('INSERT INTO operations_filter_decisions(user_sub,id,delivery_id,record,created_at) VALUES($1,$2,$3,$4,$5)',[owner,decisionId,id,JSON.stringify(decision),now]);
   const state=reduction.workId?'evidence-pending':'processed';await c.query('UPDATE operations_processing SET state=$3, revision=revision+1, record=$4, ready_at=$5 WHERE user_sub=$1 AND id=$2',[owner,id,state,JSON.stringify({...work.record,filterDecisionId:decisionId,reduction,...(work.record.processing?{processing:{...work.record.processing,status:'completed',token:null,leaseUntil:null,completedAt:now}}:{})}),now]);
   return decision;
  });
 }catch(error){if(!quiet&&![400,401,404].includes(error.status))await failureAttempt(pool,owner,id,error);throw error;}
}
const severity={info:0,warning:1,error:2,critical:3};
async function reduce(c,owner,delivery,policy,matches,now){
 const key=hash(['symptom-v1',policy.name,delivery.identity.symptom]),occurrenceId=hash([key,delivery.id]);
 const previous=(await c.query('SELECT record FROM operations_symptom_occurrences WHERE user_sub=$1 AND id=$2',[owner,occurrenceId])).rows[0];if(previous)return {...previous.record,replayed:true};
 const result=await reduceNew(c,owner,delivery,policy,matches,now);
 if(result.outcome!=='filtered')await c.query('INSERT INTO operations_symptom_occurrences(user_sub,id,record) VALUES($1,$2,$3)',[owner,occurrenceId,JSON.stringify(result)]);
 return result;
}
const REFIRED='refired-watch',MAX_REFIRED=64;
/** One small row instead of a scan of every symptom each minute. */
async function refiredList(c,owner){return (await c.query('SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id=$2 FOR UPDATE',[owner,REFIRED])).rows[0]?.record||null;}
async function saveRefired(c,owner,exists,items){if(exists)await c.query('UPDATE operations_processing_config SET record=$3 WHERE user_sub=$1 AND id=$2',[owner,REFIRED,JSON.stringify({items})]);else await c.query('INSERT INTO operations_processing_config(user_sub,id,revision,record) VALUES($1,$2,1,$3)',[owner,REFIRED,JSON.stringify({items})]);}
async function rememberRefire(c,owner,symptomKey,dueAt){const held=await refiredList(c,owner);await saveRefired(c,owner,Boolean(held),[...(held?.items||[]).filter(i=>i.symptomKey!==symptomKey),{symptomKey,dueAt}].slice(-MAX_REFIRED));}
/** @description A re-fire inside the window only recorded and told, so a flap costs nothing; if the alert is still firing once the window has passed it was the start of a real outage, and it gets the evidence and the investigation a new occurrence would, once. The decision is corrected in place, so every reader sees it admitted, and nothing is told again: the phone already heard it fire again. @param pool Owner-scoped SQL. @param owner The caller. @param clock Milliseconds now. @returns How many were promoted, as results the tick can correlate. */
export async function promoteRefired(pool,owner,clock=Date.now){
 requireOwner(owner);const nowMs=clock(),now=new Date(nowMs).toISOString(),results=[];
 const list=(await pool.query('SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id=$2',[owner,REFIRED])).rows[0]?.record;
 for(const item of (list?.items||[]).filter(i=>Date.parse(i.dueAt)<=nowMs)){
  const promoted=await tx(pool,async c=>{
   const held=await refiredList(c,owner);await saveRefired(c,owner,Boolean(held),(held?.items||[]).filter(i=>i.symptomKey!==item.symptomKey));
   const symptom=(await c.query('SELECT record FROM operations_symptoms WHERE user_sub=$1 AND id=$2 FOR UPDATE',[owner,item.symptomKey])).rows[0]?.record,r=symptom?.refired;
   if(symptom?.status!=='firing'||!r)return null;
   const work=(await c.query('SELECT record FROM operations_processing WHERE user_sub=$1 AND id=$2 FOR UPDATE',[owner,r.deliveryId])).rows[0]?.record,decision=(await c.query('SELECT record FROM operations_filter_decisions WHERE user_sub=$1 AND id=$2 FOR UPDATE',[owner,r.decisionId])).rows[0]?.record;
   if(!work||!decision)return null;
   const episode=hash([item.symptomKey,r.deliveryId]),workId=hash(['evidence-v1',item.symptomKey,episode,1]),{refired,...kept}=symptom;
   const reduction={...decision.reduction,outcome:'admitted',promotedFrom:'refired',promotedAt:now,episode,revision:1,workId,capture:r.capture};
   await c.query('UPDATE operations_symptoms SET record=$3 WHERE user_sub=$1 AND id=$2',[owner,item.symptomKey,JSON.stringify({...kept,admittedAt:now,episode,revision:1,episodeCount:1,maxSeverity:symptom.severity,expiresAt:new Date(nowMs+r.windowSeconds*1000).toISOString()})]);
   await c.query('INSERT INTO operations_evidence_work(user_sub,id,state,record,created_at) VALUES($1,$2,$3,$4,$5)',[owner,workId,'pending',JSON.stringify({id:workId,symptomKey:item.symptomKey,episode,revision:1,deliveryId:r.deliveryId,policyId:r.policyId,ruleIds:r.ruleIds,capture:r.capture,state:'pending',createdAt:now,executionAuthorized:false}),now]);
   await c.query('UPDATE operations_filter_decisions SET record=$3 WHERE user_sub=$1 AND id=$2',[owner,r.decisionId,JSON.stringify({...decision,reduction})]);
   await c.query('UPDATE operations_symptom_occurrences SET record=$3 WHERE user_sub=$1 AND id=$2',[owner,hash([item.symptomKey,r.deliveryId]),JSON.stringify({outcome:'admitted',symptomKey:item.symptomKey,episode,revision:1,count:symptom.count,workId,capture:r.capture})]);
   await c.query('UPDATE operations_processing SET state=$3, revision=revision+1, ready_at=$4, record=$5 WHERE user_sub=$1 AND id=$2',[owner,r.deliveryId,'evidence-pending',now,JSON.stringify({...work,reduction})]);
   return {deliveryId:r.deliveryId,decisionId:r.decisionId,outcome:'admitted',promoted:true};
  });
  if(promoted)results.push(promoted);
 }
 return {promoted:results.length,results};
}
async function reduceNew(c,owner,delivery,policy,matches,now){
 const event=delivery.normalized,key=hash(['symptom-v1',policy.name,delivery.identity.symptom]);
 const previous=(await c.query('SELECT record FROM operations_symptoms WHERE user_sub=$1 AND id=$2 FOR UPDATE',[owner,key])).rows[0]?.record;
 const eventTime=new Date(event.time).toISOString(),oldTime=previous?.eventTime;
 if(!matches.length&&event.data.status!=='resolved')return {outcome:'filtered',symptomKey:key};
 if(event.data.status==='resolved'&&!previous){
  if(matches.length)await c.query('INSERT INTO operations_symptoms(user_sub,id,record) VALUES($1,$2,$3)',[owner,key,JSON.stringify({id:key,identity:delivery.identity.symptom,policyName:policy.name,policyId:policy.id,episode:null,revision:0,count:1,episodeCount:0,firstSeen:now,lastSeen:now,eventTime,status:'resolved',severity:event.data.severity,maxSeverity:event.data.severity,expiresAt:now})]);
  return {outcome:'orphan-resolution',symptomKey:key};
 }
 const late=oldTime&&eventTime<oldTime,ambiguous=oldTime===eventTime&&previous.status!==event.data.status;
 const expired=!previous||Date.parse(now)>=Date.parse(previous.expiresAt),reopened=previous?.status==='resolved';
 const flap=event.data.status==='firing'&&!late&&!ambiguous&&reopened&&!expired&&Date.parse(now)-Date.parse(previous.admittedAt)<policy.window.seconds*1000;
 const fresh=event.data.status==='firing'&&!late&&!ambiguous&&(expired||(reopened&&!flap));
 const escalation=!fresh&&previous&&event.data.status==='firing'&&!late&&!ambiguous&&(severity[event.data.severity]>severity[previous.maxSeverity||previous.severity]);
 const admitted=Boolean(fresh||escalation),episode=fresh?hash([key,delivery.id]):previous?.episode;
 const row={...previous,id:key,identity:delivery.identity.symptom,policyName:policy.name,policyId:policy.id,admittedAt:admitted?now:previous?.admittedAt||null,episode,revision:fresh?1:(previous?.revision||0)+(escalation?1:0),count:(previous?.count||0)+1,firstSeen:previous?.firstSeen||now,lastSeen:now,eventTime:late||ambiguous?oldTime:eventTime,status:late||ambiguous?previous.status:event.data.status,severity:late||ambiguous?previous.severity:event.data.severity};
 row.episodeCount=fresh?1:(previous?.episodeCount||0)+1;row.maxSeverity=late||ambiguous?(previous.maxSeverity||previous.severity):fresh?event.data.severity:(severity[event.data.severity]>severity[previous?.maxSeverity||previous?.severity]?event.data.severity:(previous?.maxSeverity||previous?.severity));
 row.expiresAt=fresh||(!late&&!ambiguous&&policy.window.mode==='sliding')?new Date(Date.parse(now)+policy.window.seconds*1000).toISOString():previous.expiresAt;
 // A re-fire waits for the window to pass (promoteRefired); anything newer that clears it or opens its own evidence ends the wait.
 if(flap&&!admitted)row.refired={deliveryId:delivery.id,decisionId:hash(['filter-v1',delivery.id,policy.id]),policyId:policy.id,ruleIds:matches,capture:policy.rules.some(r=>matches.includes(r.id)&&r.capture),windowSeconds:policy.window.seconds};
 else if(admitted||(event.data.status==='resolved'&&!late&&!ambiguous))delete row.refired;
 if(previous)await c.query('UPDATE operations_symptoms SET record=$3 WHERE user_sub=$1 AND id=$2',[owner,key,JSON.stringify(row)]);else await c.query('INSERT INTO operations_symptoms(user_sub,id,record) VALUES($1,$2,$3)',[owner,key,JSON.stringify(row)]);
 const outcome=late?'late-occurrence':ambiguous?'ambiguous-state-time':event.data.status==='resolved'?'source-resolved':fresh?'admitted':escalation?'escalated':flap?'refired':'suppressed';
 if(flap&&!admitted)await rememberRefire(c,owner,key,new Date(Date.parse(previous.admittedAt)+policy.window.seconds*1000).toISOString());
 if(!admitted)return {outcome,symptomKey:key,episode,revision:row.revision,count:row.count};
 const workId=hash(['evidence-v1',key,episode,row.revision]),capture=policy.rules.some(r=>matches.includes(r.id)&&r.capture);
 const work={id:workId,symptomKey:key,episode,revision:row.revision,deliveryId:delivery.id,policyId:policy.id,ruleIds:matches,capture,state:'pending',createdAt:now,executionAuthorized:false};
 await c.query('INSERT INTO operations_evidence_work(user_sub,id,state,record,created_at) VALUES($1,$2,$3,$4,$5)',[owner,workId,'pending',JSON.stringify(work),now]);
 return {outcome,symptomKey:key,episode,revision:row.revision,count:row.count,workId,capture};
}
export async function pipelineRecords(pool,owner){requireOwner(owner);const read=async table=>{const order=['operations_filter_decisions','operations_processing_attempts','operations_evidence_work','operations_topology_decisions'].includes(table)?'created_at DESC, id':'id';return (await pool.query('SELECT record FROM '+table+' WHERE user_sub=$1 ORDER BY '+order+' LIMIT 200',[owner])).rows.map(r=>r.record);};const [policies,bindings,decisions,attempts,symptoms,evidenceWork,correlations]=await Promise.all(['operations_policies','operations_policy_bindings','operations_filter_decisions','operations_processing_attempts','operations_symptoms','operations_evidence_work','operations_topology_decisions'].map(read));return {policies,bindings,decisions,attempts,symptoms,evidenceWork,correlations,limits:{perCollection:200}};}

export {tx as processingTransaction};
