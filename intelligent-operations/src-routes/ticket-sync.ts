/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Reconcile a reserved attempt through the person's native connector read, pinned to the saved service revision, and retain only a bounded server-observed state receipt. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Keep immutable original-person external links and reserve exact canonical phase/revision actions before manual confirmed native connector handoff; client observations remain explicitly operator-reported. */
// @ts-nocheck
import {createHash} from 'node:crypto';
import {canonical} from './intake';
import {processingTransaction} from './pipeline';
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const id=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const statuses=['draft','queued','running','awaiting_approval','blocked','done','failed','cancelled'];
const phases=['*','-','investigate','review','revise','queue-deliver'];
function closed(input,fields){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!fields.includes(k)))fail(400,'Supply only the supported synchronization fields.');}
function owner(value){if(typeof value!=='string'||!value.trim())fail(401,'A verified caller is required.');}
function target(provider,value){
 closed(value,provider==='gitlab'?['action']:['action','expectedState']);
 if(provider==='jira'){if(typeof value.action!=='string'||typeof value.expectedState!=='string'||!/^[0-9]{1,20}$/.test(value.action)||!/^[0-9]{1,20}$/.test(value.expectedState))fail(400,'Jira mappings need explicit transition and destination status IDs.');return {action:value.action,expectedState:value.expectedState};}
 if(provider==='gitlab'){if(!['close','reopen'].includes(value.action))fail(400,'GitLab state action must be close or reopen.');return {action:value.action,expectedState:value.action==='close'?'closed':'opened'};}
 if(typeof value.action!=='string'||!/^[-a-zA-Z0-9_]{1,32}$/.test(value.action)||typeof value.expectedState!=='string'||!value.expectedState.trim()||value.expectedState.length>80||/[\r\n]/.test(value.expectedState))fail(400,'Use the ServiceNow state value and expected displayed state.');return {action:value.action,expectedState:value.expectedState};
}
/** @description Freeze provider realm, external identity and explicit phase/status mappings; no credentials or arbitrary operation bodies are accepted. */
export function syncLinkDefinition(input){
 closed(input,['ticketId','provider','recordKey','projectId','account','targetRevision','mapping']);
 if(!uuid(input.ticketId)||!['jira','gitlab','servicenow'].includes(input.provider)||!id(input.targetRevision))fail(400,'Choose an owned Operations ticket and a configured supported service revision.');
 if(typeof input.account!=='string'||!input.account.trim()||input.account.length>128||input.account.trim()!==input.account||/[\x00-\x1f\x7f]/.test(input.account))fail(400,'Select an exact personal connection account.');
 const {provider}=input,recordKey=input.recordKey,projectId=provider==='gitlab'?input.projectId:null;
 if(typeof recordKey!=='string'||(provider==='gitlab'&&typeof projectId!=='string'))fail(400,'External identifiers must be explicit strings.');
 if(provider==='jira'&&!/^[A-Z][A-Z0-9_]{0,39}-[0-9]{1,20}$/.test(recordKey))fail(400,'Use the Jira issue key.');
 if(provider==='gitlab'&&(!/^[1-9][0-9]{0,19}$/.test(projectId)||!/^[1-9][0-9]{0,19}$/.test(recordKey)))fail(400,'Use numeric GitLab project ID and issue IID.');
 if(provider==='servicenow'&&!/^[a-f0-9]{32}$/i.test(recordKey))fail(400,'Use the ServiceNow incident sys_id.');
 if(provider!=='gitlab'&&input.projectId!=null&&input.projectId!=='')fail(400,'Only GitLab uses a project ID.');
 if(!input.mapping||typeof input.mapping!=='object'||Array.isArray(input.mapping)||Object.keys(input.mapping).length<1||Object.keys(input.mapping).length>32)fail(400,'Supply 1–32 explicit workflow mappings.');
 const mapping={};for(const [key,value]of Object.entries(input.mapping)){const parts=key.split(':');if(parts.length!==2||!statuses.includes(parts[0])||!phases.includes(parts[1]))fail(400,'Map status:phase, using an exact Operations phase or *.');mapping[key]=target(provider,value);}
 const body={ticketId:input.ticketId,provider,recordKey,projectId,account:input.account,targetRevision:input.targetRevision,mapping};return {...body,id:hash(['ticket-link-v1',body])};
}
async function ticket(ctx,ticketId){
 if(typeof ctx.ticketService?.getTicket!=='function')fail(503,'Canonical ticket reads are unavailable.');const result=await ctx.ticketService.getTicket(ticketId);
 if(!result||!['intelligent-operations'].includes(result.ticketType||result.kind))fail(404,'The owned Operations ticket is unavailable.');
 if(!statuses.includes(result.status)||!Number.isSafeInteger(result.revision)||result.revision<0)fail(503,'The current canonical ticket revision is unavailable.');return result;
}
export function syncPlan(link,current){
 const trigger=current.status+':'+(current.position?.name||'-'),selected=link.mapping[trigger]||link.mapping[current.status+':*'];if(!selected)return null;
 let operation,input,readOperation,readInput;
 if(link.provider==='jira'){operation='jira-transition-issue';input={issueKey:link.recordKey,transitionId:selected.action};readOperation='jira-get-issue';readInput={issueKey:link.recordKey};}
 else if(link.provider==='gitlab'){operation='gitlab-update-issue-state';input={projectId:link.projectId,issueIid:link.recordKey,stateEvent:selected.action};readOperation='gitlab-get-issue';readInput={projectId:link.projectId,issueIid:link.recordKey};}
 else{operation='servicenow-update-incident-state';input={sysId:link.recordKey,state:selected.action};readOperation='servicenow-record';readInput={table:'incident',sysId:link.recordKey};}
 const body={linkId:link.id,ticketId:link.ticketId,ticketRevision:current.revision,trigger,provider:link.provider,account:link.account,recordKey:link.recordKey,targetRevision:link.targetRevision,operation,input,readOperation,readInput,expectedState:selected.expectedState};return {...body,id:hash(['ticket-sync-v1',body])};
}
/** @description Save only immutable own-ticket linkage, never a second ticket engine or a provider credential. */
export async function saveSyncLink(ctx,sub,input){
 owner(sub);const link=syncLinkDefinition(input);await ticket(ctx,link.ticketId);
 return processingTransaction(ctx.pool,async c=>{
  const anchor=(await c.query('SELECT record FROM operations_sync_owners WHERE user_sub=$1 AND id=$2 FOR UPDATE',[sub,'link-capacity'])).rows[0];
  if(!anchor)await c.query('INSERT INTO operations_sync_owners(user_sub,id,record) VALUES($1,$2,$3)',[sub,'link-capacity',JSON.stringify({bounded:true})]);
  const previous=(await c.query('SELECT record FROM operations_ticket_links WHERE user_sub=$1 AND id=$2',[sub,link.id])).rows[0]?.record;if(previous)return previous;
  const rows=(await c.query('SELECT id FROM operations_ticket_links WHERE user_sub=$1 LIMIT 33',[sub])).rows;if(rows.length>=32)fail(409,'This workbench holds at most 32 immutable links.');
  const record={...link,createdAt:new Date().toISOString(),direction:'manual-outbound',credentialsStored:false};await c.query('INSERT INTO operations_ticket_links(user_sub,id,created_at,record) VALUES($1,$2,$3,$4)',[sub,link.id,record.createdAt,JSON.stringify(record)]);return record;
 });
}
/** @description Read current canonical state and bounded own attempts. Missing state remains unavailable, never an actionable stale plan. */
export async function syncRecords(ctx,sub){
 owner(sub);const records=(await ctx.pool.query('SELECT record FROM operations_ticket_links WHERE user_sub=$1 ORDER BY created_at DESC,id LIMIT 33',[sub])).rows.map(r=>r.record),items=[];
 for(const link of records.slice(0,32)){try{const current=await ticket(ctx,link.ticketId);items.push({...link,ticket:current,plan:syncPlan(link,current)});}catch{items.push({...link,ticketUnavailable:true,plan:null});}}
 const attempts=(await ctx.pool.query('SELECT record FROM operations_sync_attempts WHERE user_sub=$1 ORDER BY created_at DESC,id LIMIT 101',[sub])).rows.map(r=>r.record);
 return {items,attempts:attempts.slice(0,100),truncated:records.length>32||attempts.length>100,deliveryProof:'outbound writes remain browser-confirmed; a saved server readback verifies only the observed remote state',automaticSync:false};
}
/** @description Reserve before leaving the application; no repeated dispatch authorization after an unknown transport or lost acknowledgement. */
export async function reserveSync(ctx,sub,input){
 owner(sub);closed(input,['linkId','planId']);if(!id(input.linkId)||!id(input.planId))fail(400,'Choose a current saved link and plan.');
 const link=(await ctx.pool.query('SELECT record FROM operations_ticket_links WHERE user_sub=$1 AND id=$2',[sub,input.linkId])).rows[0]?.record;if(!link)fail(404,'The owned external link is unavailable.');
 const plan=syncPlan(link,await ticket(ctx,link.ticketId));if(!plan||plan.id!==input.planId)fail(409,'The canonical phase/revision or mapping changed. Refresh before any external action.');
 return processingTransaction(ctx.pool,async c=>{
  const old=(await c.query('SELECT record FROM operations_sync_attempts WHERE user_sub=$1 AND id=$2 FOR UPDATE',[sub,plan.id])).rows[0]?.record;if(old)fail(409,'This phase/revision already has an attempt. Reconcile its outcome; no repeat dispatch was authorized.');
  const record={id:plan.id,linkId:link.id,createdAt:new Date().toISOString(),state:'reserved-outcome-unknown',plan,provenance:'native-dispatch-reservation',verifiedByServer:false};await c.query('INSERT INTO operations_sync_attempts(user_sub,id,created_at,record) VALUES($1,$2,$3,$4)',[sub,record.id,record.createdAt,JSON.stringify(record)]);return record;
 });
}
/** @description Keep a clearly labeled original-operator report; client input never establishes server-verified provider delivery or changes canonical status/recovery. */
export async function reportSync(ctx,sub,input){
 owner(sub);closed(input,['attemptId','outcome']);if(!id(input.attemptId)||!['readback-matched','accepted-unverified','uncertain','readback-conflict'].includes(input.outcome))fail(400,'Use a bounded reported attempt outcome.');
 return processingTransaction(ctx.pool,async c=>{
  const row=(await c.query('SELECT record FROM operations_sync_attempts WHERE user_sub=$1 AND id=$2 FOR UPDATE',[sub,input.attemptId])).rows[0]?.record;if(!row)fail(404,'The owned attempt is unavailable.');
  if(row.verifiedByServer)fail(409,'A server-observed remote state cannot be replaced by an operator report.');
  const record={...row,state:'operator-reported-'+input.outcome,reportedAt:new Date().toISOString(),provenance:'operator-report',verifiedByServer:false};await c.query('UPDATE operations_sync_attempts SET record=$3 WHERE user_sub=$1 AND id=$2',[sub,row.id,JSON.stringify(record)]);return record;
 });
}

/** @description Interpret only the fixed state field of one native issue read; never store the provider's full issue body. */
export function observedRemoteState(provider,answer){
 if(!answer||typeof answer!=='object'||Array.isArray(answer)||!answer.data||typeof answer.data!=='object')fail(503,'The native issue read returned no supported state.');
 if(answer.operation!=null&&answer.operation!==({jira:'jira-get-issue',gitlab:'gitlab-get-issue',servicenow:'servicenow-record'})[provider])fail(503,'The native issue read returned another operation.');
 if(answer.status!=null&&(!Number.isInteger(answer.status)||answer.status<200||answer.status>299))fail(503,'The native issue read was not successful.');
 const state=provider==='jira'?answer.data.fields?.status?.id:provider==='gitlab'?answer.data.state:answer.data.result?.state;
 const value=typeof state==='object'&&state!==null?state.value:state;
 if(typeof value!=='string'||!value||value.length>80||/[\x00-\x1f\x7f]/.test(value))fail(503,'The native issue read returned no supported state.');
 return value;
}

/** @description An app cannot prove delivery by reporting a browser result. Re-read only the frozen issue through the original person's native connection and pinned service realm. */
export async function reconcileSync(ctx,sub,input){
 owner(sub);closed(input,['attemptId']);if(!id(input.attemptId))fail(400,'Choose a reserved synchronization attempt.');
 const row=(await ctx.pool.query('SELECT record FROM operations_sync_attempts WHERE user_sub=$1 AND id=$2',[sub,input.attemptId])).rows[0]?.record;
 if(!row)fail(404,'The owned attempt is unavailable.');
 const p=row.plan;
 if(!p||!['jira','gitlab','servicenow'].includes(p.provider)||!id(p.targetRevision)||typeof p.account!=='string'||!p.account||typeof ctx.intent!=='function')fail(503,'The saved issue or native read port is unavailable.');
 const link=(await ctx.pool.query('SELECT record FROM operations_ticket_links WHERE user_sub=$1 AND id=$2',[sub,p.linkId])).rows[0]?.record;
 const trigger=typeof p.trigger==='string'?p.trigger.split(':'):[],historical=link&&trigger.length===2?syncPlan(link, {status:trigger[0],position:trigger[1]==='-'?null:{name:trigger[1]},revision:p.ticketRevision}):null;
 if(!link||!historical||historical.id!==row.id||hash(historical)!==hash(p))fail(503,'The frozen issue read plan no longer matches its saved link.');
 await ticket(ctx,p.ticketId);
 let answer,state;
 try{answer=await ctx.intent('connector.read',{connector:p.provider,operation:p.readOperation,account:p.account,input:p.readInput,expectedTargetRevision:p.targetRevision});state=observedRemoteState(p.provider,answer);}
 catch(error){const message=String(error?.message||error);if(error?.status===403||/^(refused|invalid): |is not linked for this package/.test(message))fail(403,'Your native connector read is no longer authorized; the held attempt was not changed.');fail(503,'Native remote-state readback was refused or unavailable; the held attempt was not changed.');}
 const observedAt=new Date().toISOString(),matched=state===p.expectedState;
 return processingTransaction(ctx.pool,async c=>{
  const current=(await c.query('SELECT record FROM operations_sync_attempts WHERE user_sub=$1 AND id=$2 FOR UPDATE',[sub,row.id])).rows[0]?.record;
  if(!current||hash(current.plan)!==hash(p))fail(409,'The saved attempt changed while the provider was read; refresh before reconciling.');
  const record={...current,state:matched?'server-observed-match':'server-observed-conflict',verifiedByServer:true,writeDeliveryVerifiedByServer:false,provenance:'native-connector-read',observedState:state,observedAt,readbackSha256:hash({provider:p.provider,recordKey:p.recordKey,state,observedAt}),readbackOperation:p.readOperation};
  await c.query('UPDATE operations_sync_attempts SET record=$3 WHERE user_sub=$1 AND id=$2',[sub,row.id,JSON.stringify(record)]);return record;
 });
}
