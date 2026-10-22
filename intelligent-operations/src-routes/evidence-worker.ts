/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Consume reduced capture reservations on the existing personal schedule with atomic packet completion, source fences and bounded retries. */
// @ts-nocheck
import {processingTransaction as tx} from './pipeline';
import {processingConfig} from './processing-worker';
import {pinEvidenceInTransaction} from './telemetry-store';
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const stamp=clock=>new Date(clock()).toISOString();
async function fence(c,owner,config,work){
 const current=await processingConfig(c,owner,true);
 if(!current.enabled||!current.captureEvidence||current.revision!==config.revision||!current.sourceIds.includes(work.record.sourceId))fail(409,'Evidence capture was stopped or its source configuration changed.');
}
async function capture(pool,owner,id,config,clock){
 return tx(pool,async c=>{
  const work=(await c.query('SELECT state, ready_at, record FROM operations_processing WHERE user_sub=$1 AND id=$2 FOR UPDATE',[owner,id])).rows[0];
  if(!work||!['evidence-pending','evidence-retry'].includes(work.state)||new Date(work.ready_at).getTime()>clock())return null;
  await fence(c,owner,config,work);
  const reservationId=work.record.reduction?.workId;
  const reserved=(await c.query('SELECT record FROM operations_evidence_work WHERE user_sub=$1 AND id=$2 FOR UPDATE',[owner,reservationId])).rows[0]?.record;
  if(!reserved||reserved.deliveryId!==id||typeof reserved.capture!=='boolean')fail(503,'The matching evidence reservation is unavailable.');
  const packet=reserved.capture?await pinEvidenceInTransaction(c,owner,reservationId):null;
  const completedAt=stamp(clock),state=packet?'evidence-captured':'evidence-not-requested';
  const captureProcessing={status:packet?'captured':'not-requested',attempts:(work.record.captureProcessing?.attempts||0)+1,configurationRevision:config.revision,completedAt,packetId:packet?.id||null,packetSha256:packet?.sha256||null,coverage:packet?.coverage||null,truncated:packet?.truncated||false};
  await c.query('UPDATE operations_evidence_work SET state=$3, record=$4 WHERE user_sub=$1 AND id=$2',[owner,reservationId,captureProcessing.status,JSON.stringify({...reserved,state:captureProcessing.status,captureProcessing})]);
  await c.query('UPDATE operations_processing SET state=$3, revision=revision+1, record=$4 WHERE user_sub=$1 AND id=$2',[owner,id,state,JSON.stringify({...work.record,captureProcessing})]);
  return {deliveryId:id,reservationId,...captureProcessing};
 });
}
async function recordFailure(pool,owner,id,config,error,clock){
 return tx(pool,async c=>{
  const work=(await c.query('SELECT state, ready_at, record FROM operations_processing WHERE user_sub=$1 AND id=$2 FOR UPDATE',[owner,id])).rows[0];
  // A lost commit acknowledgement must not regress a successfully captured packet.
  if(!work||!['evidence-pending','evidence-retry'].includes(work.state))return false;
  await fence(c,owner,config,work);
  const attempts=(work.record.captureProcessing?.attempts||0)+1,attention=attempts>=config.maxAttempts;
  const now=stamp(clock),retryAt=new Date(Date.parse(now)+Math.min(3600,config.retrySeconds*2**(attempts-1))*1000).toISOString();
  const captureProcessing={status:attention?'attention':'retry',attempts,failedAt:now,retryAt,lastError:error.status?String(error.message).slice(0,240):'Retained evidence storage is unavailable.'};
  await c.query('UPDATE operations_processing SET state=$3, revision=revision+1, ready_at=$4, record=$5 WHERE user_sub=$1 AND id=$2',[owner,id,attention?'evidence-attention':'evidence-retry',retryAt,JSON.stringify({...work.record,captureProcessing})]);
  return true;
 });
}
/** @description Preserve reduced evidence before its raw banks rotate, without model or infrastructure authority.
 * @param pool Caller-scoped database. @param owner Verified original user. @param clock Testable receipt clock. @returns Actual bounded capture outcomes. */
export async function capturePendingEvidence(pool,owner,clock=Date.now){
 const config=await processingConfig(pool,owner),results=[],started=Date.now();
 if(!config.enabled||!config.captureEvidence)return {enabled:false,captured:0,notRequested:0,failed:0,results};
 const slots=config.sourceIds.map((_,i)=>'$'+(i+3)).join(',');
 const candidates=(await pool.query("SELECT id FROM operations_processing WHERE user_sub=$1 AND state IN ('evidence-pending','evidence-retry') AND ready_at <= $2 AND record->>'sourceId' IN ("+slots+") ORDER BY ready_at, created_at, id LIMIT 10",[owner,stamp(clock),...config.sourceIds])).rows;
 for(const candidate of candidates.slice(0,config.batchSize)){
  if(Date.now()-started>=45000)break;
  try{const result=await capture(pool,owner,candidate.id,config,clock);if(result)results.push(result);}
  catch(error){if(error.status===409)break;await recordFailure(pool,owner,candidate.id,config,error,clock);results.push({deliveryId:candidate.id,error:error.status?String(error.message).slice(0,240):'Retained evidence storage is unavailable.'});break;}
 }
 return {enabled:true,captured:results.filter(r=>r.status==='captured').length,notRequested:results.filter(r=>r.status==='not-requested').length,failed:results.filter(r=>r.error).length,results};
}
