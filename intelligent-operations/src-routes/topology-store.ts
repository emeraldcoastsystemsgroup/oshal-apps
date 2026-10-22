/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Journal immutable topology scans and persist correlation against exact event-time observations. */
// @ts-nocheck
import {hash} from './intake';
import {scanDefinition,reconstruct,correlate,clean,instant,fail} from './topology-model';
const ownerRequired=owner=>{if(!clean(owner))fail(401,'A verified OSHAL caller is required.');};
const conflict=e=>['40001','40P01','23505'].includes(e.code)||/scoped collection revision changed/.test(e.message);
async function transaction(pool,run){for(let i=0;i<8;i++){const c=await pool.connect();try{await c.query('BEGIN');const result=await run(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK').catch(()=>{});if(!conflict(e)||i===7)throw e;}finally{await c.release();}}}
export async function saveScan(pool,owner,source,input){
 ownerRequired(owner);const scan=scanDefinition(input,source);
 return transaction(pool,async c=>{
  const old=(await c.query('SELECT payload_hash, record FROM operations_topology_scans WHERE user_sub=$1 AND id=$2 FOR UPDATE',[owner,scan.id])).rows[0];
  if(old){if(old.payload_hash!==scan.payloadHash)fail(409,'This scan ID already identifies different content.');return {status:200,retry:true,scan:old.record};}
  const tie=(await c.query('SELECT id, payload_hash, record FROM operations_topology_scans WHERE user_sub=$1 AND source_uri=$2 AND collection_id=$3 AND observed_at=$4',[owner,source.source,scan.collectionId,scan.observedAt])).rows;
  if(tie.length){if(tie[0].id===scan.id&&tie[0].payload_hash===scan.payloadHash)return {status:200,retry:true,scan:tie[0].record};fail(409,'This collection already has different content at that observation time.');}
  await c.query('INSERT INTO operations_topology_scans(user_sub,id,source_uri,collection_id,observed_at,payload_hash,record) VALUES($1,$2,$3,$4,$5,$6,$7)',[owner,scan.id,source.source,scan.collectionId,scan.observedAt,scan.payloadHash,JSON.stringify(scan)]);
  return {status:201,retry:false,scan};
 });
}
export async function readGraph(pool,owner,at=new Date().toISOString(),collectionId=null){
 ownerRequired(owner);at=instant(at);if(collectionId!==null&&!clean(collectionId))fail(400,'Invalid collection scope.');
 const values=[owner,at];let sql='SELECT record FROM operations_topology_scans WHERE user_sub=$1 AND observed_at<=$2';
 if(collectionId!==null){values.push(collectionId);sql+=' AND collection_id=$3';}
 sql+=' ORDER BY observed_at ASC, id ASC LIMIT 201';const scans=(await pool.query(sql,values)).rows.map(r=>r.record);
 if(scans.length>200)fail(503,'Topology history exceeds the 200-scan reconstruction budget. Select a narrower collection scope.');
 const graph=reconstruct(scans,at);return {...graph,revision:hash(scans.map(s=>[s.id,s.payloadHash])),scanIds:scans.map(s=>s.id),limits:{scans:200,assets:2000,relationships:5000}};
}
function eventAsset(record,graph){
 const resource=record.normalized?.data?.resource;
 const provider={'kubernetes-pod':'kubernetes',container:'kubernetes',workload:'kubernetes','aws-resource':'aws','azure-resource':'azure','gcp-resource':'gcp',host:'import'}[resource?.kind];
 const kind={'kubernetes-pod':'pod',container:'container',workload:'workload',host:'host'}[resource?.kind];
 const matches=graph.assets.filter(a=>a.provider===provider&&a.scope===resource?.scope&&a.nativeId===resource?.id&&(!kind||a.kind===kind));
 return matches.length===1?matches[0].id:'unresolved-'+record.id.slice(0,48);
}
export async function correlateDeliveries(pool,owner,input){
 ownerRequired(owner);if(!input||!Array.isArray(input.deliveryIds)||!input.deliveryIds.length||input.deliveryIds.length>200||input.deliveryIds.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))||new Set(input.deliveryIds).size!==input.deliveryIds.length)fail(400,'Choose 1–200 distinct recorded delivery IDs.');
 const at=instant(input.asOf);return transaction(pool,async c=>{
  const graph=await readGraph(c,owner,at,input.collectionId||null);
  const placeholders=input.deliveryIds.map((_,i)=>'$'+(i+2)).join(',');
  const records=(await c.query('SELECT record FROM operations_deliveries WHERE user_sub=$1 AND id IN ('+placeholders+')',[owner,...input.deliveryIds])).rows.map(r=>r.record);
  if(records.length!==input.deliveryIds.length)fail(404,'A selected delivery is unavailable in your scope.');
  if(records.some(r=>r.decision!=='validated'||r.normalized?.data.status!=='firing'))fail(400,'Correlation candidates must be validated firing occurrences.');
  records.sort((a,b)=>a.id.localeCompare(b.id));
  const events=records.map(r=>({id:r.id,assetId:eventAsset(r,graph)}));
  const result=correlate(graph,events,input.policy),createdAt=new Date().toISOString();
  const body={...result,graphRevision:graph.revision,scanIds:graph.scanIds,deliveryIds:input.deliveryIds.slice().sort(),events,automaticDispatch:false};
  const id=hash(['correlation-v1',body]),old=(await c.query('SELECT record FROM operations_topology_decisions WHERE user_sub=$1 AND id=$2',[owner,id])).rows[0];
  if(old)return {...old.record,retry:true};
  const record={...body,id,createdAt};await c.query('INSERT INTO operations_topology_decisions(user_sub,id,created_at,record) VALUES($1,$2,$3,$4)',[owner,id,createdAt,JSON.stringify(record)]);return record;
 });
}
