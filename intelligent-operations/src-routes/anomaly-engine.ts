/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Express the compound cursor without a row-value comparison: the native package SQL interpreter refuses Tuple expressions (installed lab run 2026-10-22), and the OR form is equivalent. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Anomaly service on the retained telemetry banks: a persisted per-resource/metric baseline with a compound cursor, scoring before learning, explicit cold/ready/stale/failed readiness, and candidates admitted through the normal alert intake under a dedicated source revision so they flow into percolation and reduction like any source alert. */
// @ts-nocheck
import {hash} from './intake';
import {admit} from './intake';
import {processingTransaction} from './pipeline';
const Detector=require('../ui/anomaly-detector.js');
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const requireOwner=owner=>{if(typeof owner!=='string'||!owner.trim())fail(401,'A verified caller is required.');};
const closed=(input,fields)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!fields.includes(k)))fail(400,'Supply only the supported detector fields.');};
const DEFAULT={enabled:false,telemetrySourceIds:[],candidateSourceId:null,metricNames:[],parameters:Detector.configuration({}),revision:0};
const BATCH=500,BUDGET_MS=20000,MAX_BASELINES=500;
async function row(c,owner,id){return (await c.query('SELECT record FROM operations_anomaly_state WHERE user_sub=$1 AND id=$2',[owner,id])).rows[0]?.record;}
async function put(c,owner,id,record){await c.query('INSERT INTO operations_anomaly_state(user_sub,id,record) VALUES($1,$2,$3) ON CONFLICT (user_sub,id) DO UPDATE SET record=EXCLUDED.record',[owner,id,JSON.stringify(record)]);}
/** @description Current detector configuration; absent configuration is the explicit disabled default. */
export async function detectorConfig(pool,owner,c=pool){requireOwner(owner);return (await row(c,owner,'config'))||DEFAULT;}
/** @description Compare-and-set configuration: telemetry sources are the streams to read, the candidate source is the alert revision candidates are admitted under; they must differ, and parameters are validated by the shared detector. */
export async function saveDetectorConfig(pool,owner,input,sources){
 requireOwner(owner);closed(input,['enabled','telemetrySourceIds','candidateSourceId','metricNames','parameters','expectedRevision']);
 const ids=new Set(sources.map(s=>s.id));
 if(!Array.isArray(input.telemetrySourceIds)||input.telemetrySourceIds.length>16||new Set(input.telemetrySourceIds).size!==input.telemetrySourceIds.length||input.telemetrySourceIds.some(id=>!ids.has(id)))fail(400,'Choose up to 16 distinct saved telemetry source revisions.');
 if(input.candidateSourceId!==null&&(!ids.has(input.candidateSourceId)||input.telemetrySourceIds.includes(input.candidateSourceId)))fail(400,'The candidate source must be a saved alert source revision distinct from the telemetry sources.');
 if(!Array.isArray(input.metricNames)||input.metricNames.length>32||input.metricNames.some(n=>typeof n!=='string'||!n.length||n.length>256))fail(400,'Metric names are an optional list of up to 32 names.');
 if(input.enabled===true&&(!input.candidateSourceId||!input.telemetrySourceIds.length))fail(400,'Enabling detection needs at least one telemetry source and a candidate source.');
 let parameters;try{parameters=Detector.configuration(input.parameters||{});}catch(error){fail(400,error.message);}
 return processingTransaction(pool,async c=>{
  const current=(await row(c,owner,'config'))||DEFAULT;
  if(input.expectedRevision!==current.revision)fail(409,'The detector configuration changed. Reload before saving.');
  const record={enabled:input.enabled===true,telemetrySourceIds:input.telemetrySourceIds.slice().sort(),candidateSourceId:input.candidateSourceId,metricNames:input.metricNames.slice().sort(),parameters,revision:current.revision+1,updatedAt:new Date().toISOString()};
  await put(c,owner,'config',record);return record;
 });
}
const baselineId=(sourceId,resource,name)=>'baseline:'+hash([sourceId,resource.kind,resource.scope,resource.id,name]);
async function observations(c,owner,sourceId,cursor){
 const parts=[0,1,2].map(n=>'SELECT id, observed_at, record FROM operations_telemetry_'+n+" WHERE user_sub=$1 AND source_id=$2 AND (observed_at > $3::timestamptz OR (observed_at = $3::timestamptz AND id > $4)) AND record->>'signal'='metric'");
 return (await c.query('SELECT * FROM ('+parts.join(' UNION ALL ')+') AS t ORDER BY observed_at, id LIMIT '+BATCH,[owner,sourceId,cursor.observedAt,cursor.id])).rows;
}
function candidate(config,source,delivery,point,result,status,now){
 const detector={id:config.parameters.detector,version:Detector.DETECTORS[config.parameters.detector].version};
 const severity=status==='resolved'?'info':result.score>=2*config.parameters.threshold?'critical':'warning';
 return {specversion:'1.0',id:hash(['anomaly-candidate-v1',detector,point.sourceId,point.resource,point.name,point.observedAt,status]),source:source.source,type:'operations.anomaly',time:point.observedAt,dataschema:'urn:oshal:operations:alert:1',datacontenttype:'application/json',
  data:{environment:source.environment,alertType:'anomaly:'+detector.id+':'+point.name,severity,status,resource:{kind:point.resource.kind,scope:point.resource.scope,id:point.resource.id},
   detector,metric:{name:point.name,unit:point.unit||null,value:point.value,observedAt:point.observedAt,telemetrySourceId:point.sourceId,observationId:delivery},window:result.window,baseline:result.baseline,score:result.score,confidence:result.confidence,readiness:result.readiness,evaluatedAt:now,localDetection:true}};
}
/** @description One bounded detection pass per telemetry source: lock the cursor, score new metric samples in (observed_at,id) order, admit candidates through intake (idempotent by candidate id), then advance the cursor only after every admit of the batch succeeded. */
async function detectSource(pool,owner,config,sources,sourceId,clock){
 const candidateSource=sources.find(s=>s.id===config.candidateSourceId);if(!candidateSource)fail(409,'The candidate source revision is unavailable.');
 const started=Date.now(),summary={sourceId,processed:0,candidates:0,resolved:0,late:0,cold:0,stale:0,invalid:0,skippedMetrics:0,baselinesTouched:0};
 return processingTransaction(pool,async c=>{
  const cursorId='cursor:'+sourceId,cursor=(await (async()=>{const r=(await c.query('SELECT record FROM operations_anomaly_state WHERE user_sub=$1 AND id=$2 FOR UPDATE',[owner,cursorId])).rows[0];return r?.record;})())||{observedAt:'1970-01-01T00:00:00Z',id:'',runs:0};
  const current=await detectorConfig(pool,owner,c);if(!current.enabled||current.revision!==config.revision||!current.telemetrySourceIds.includes(sourceId))fail(409,'Detection was disabled or reconfigured.');
  const rows=await observations(c,owner,sourceId,cursor),baselines=new Map();let last=null;
  for(const r of rows){
   if(Date.now()-started>BUDGET_MS)break;
   const point=r.record;last={observedAt:new Date(r.observed_at).toISOString(),id:r.id};summary.processed++;
   if(config.metricNames.length&&!config.metricNames.includes(point.name)){summary.skippedMetrics++;continue;}
   const id=baselineId(sourceId,point.resource,point.name);
   if(!baselines.has(id)){const saved=await row(c,owner,id);if(!saved&&baselines.size+await count(c,owner)>=MAX_BASELINES){summary.skippedMetrics++;continue;}baselines.set(id,saved||{id,sourceId,resource:point.resource,name:point.name,state:Detector.createState(config.parameters),readiness:'cold',samples:0,createdAt:new Date(clock()).toISOString()});}
   const b=baselines.get(id),result=Detector.observe(config.parameters,b.state,{observedAt:point.observedAt,value:point.value},clock());
   b.readiness=result.readiness;b.samples=b.state.samples;b.lastObservedAt=point.observedAt;b.lastScore=result.score;b.lastBaseline=result.baseline;b.unit=point.unit||null;
   if(result.readiness==='late')summary.late++;else if(result.readiness==='cold')summary.cold++;else if(result.readiness==='stale')summary.stale++;else if(result.readiness==='invalid')summary.invalid++;
   if(result.emit){const event=candidate(config,candidateSource,r.id,{...point,sourceId},result,result.emit,new Date(clock()).toISOString());const admitted=await admit(pool,owner,candidateSource,event);if(admitted.status>=400)fail(503,'Candidate admission refused: '+(admitted.attempt?.reasons?.[0]||admitted.status));if(result.emit==='firing')summary.candidates++;else summary.resolved++;b.lastCandidate={deliveryId:admitted.record.id,status:result.emit,at:point.observedAt};}
  }
  for(const b of baselines.values()){await put(c,owner,b.id,b);summary.baselinesTouched++;}
  const next={...cursor,...(last||{}),runs:(cursor.runs||0)+1,lastRunAt:new Date(clock()).toISOString(),lastSummary:summary,lastError:null};await put(c,owner,cursorId,next);
  return {...summary,cursor:{observedAt:next.observedAt,id:next.id},more:rows.length===BATCH};
 });
}
async function count(c,owner){return (await c.query("SELECT count(*)::int AS n FROM operations_anomaly_state WHERE user_sub=$1 AND id LIKE 'baseline:%'",[owner])).rows[0].n;}
async function recordFailure(pool,owner,sourceId,error,clock){try{await processingTransaction(pool,async c=>{const id='cursor:'+sourceId,cursor=(await row(c,owner,id))||{observedAt:'1970-01-01T00:00:00Z',id:'',runs:0};await put(c,owner,id,{...cursor,lastError:{at:new Date(clock()).toISOString(),message:error.status?String(error.message).slice(0,240):'Telemetry or intake storage is unavailable.'},failures:(cursor.failures||0)+1});});}catch{/* the next tick reports the same failure */}}
/** @description Run detection for every enabled telemetry source; a failed source keeps its cursor and records the failure, so nothing is skipped silently. */
export async function runDetection(pool,owner,sources,clock=Date.now){
 const config=await detectorConfig(pool,owner),results=[];if(!config.enabled)return {enabled:false,results};
 for(const sourceId of config.telemetrySourceIds){try{results.push(await detectSource(pool,owner,config,sources,sourceId,clock));}catch(error){await recordFailure(pool,owner,sourceId,error,clock);results.push({sourceId,error:error.status?String(error.message).slice(0,240):'Telemetry or intake storage is unavailable.'});if(error.status===409)break;}}
 return {enabled:true,candidates:results.reduce((n,r)=>n+(r.candidates||0),0),resolved:results.reduce((n,r)=>n+(r.resolved||0),0),failed:results.filter(r=>r.error).length,results};
}
/** @description Configuration, per-source cursors and a bounded readiness page of baselines; unknown or failed states remain explicit. */
export async function anomalyRecords(pool,owner){
 requireOwner(owner);const config=await detectorConfig(pool,owner);
 const rows=(await pool.query("SELECT id, record FROM operations_anomaly_state WHERE user_sub=$1 AND id <> 'config' ORDER BY id LIMIT 701",[owner])).rows;
 const cursors=rows.filter(r=>r.id.startsWith('cursor:')).map(r=>r.record),baselines=rows.filter(r=>r.id.startsWith('baseline:')).slice(0,200).map(r=>({id:r.id,sourceId:r.record.sourceId,resource:r.record.resource,name:r.record.name,unit:r.record.unit,readiness:r.record.readiness,samples:r.record.samples,lastObservedAt:r.record.lastObservedAt,lastScore:r.record.lastScore,lastBaseline:r.record.lastBaseline,firing:r.record.state?.firing===true,lastCandidate:r.record.lastCandidate||null}));
 return {config,cursors,baselines,truncated:rows.length>700,limits:{baselines:200,maxBaselines:MAX_BASELINES,batch:BATCH},detectors:Detector.DETECTORS,defaults:Detector.DEFAULTS,limitsByParameter:Detector.LIMITS,localDetection:true,importedResults:false};
}
