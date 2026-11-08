/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Replay a recorded delivery window (RP-OPS-01) or bounded CloudEvents/OTLP batch (RP-OPS-02) in an isolated sandbox without touching live symptoms, evidence reservations or notifications, plus clean-up.
 */
// @ts-nocheck
import {hash} from './intake';
import {policyDefinition} from './pipeline';
import {normalizeTelemetry} from './telemetry-model';
import {readGraph} from './topology-store';
const Mapping=require('../ui/adapter-mapping.js');

const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const validId=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
const requireOwner=owner=>{if(typeof owner!=='string'||!owner.trim())fail(401,'A verified caller is required.');};
const SEV={info:0,warning:1,error:2,critical:3};
const ASSET_KIND={'kubernetes-pod':['kubernetes','pod'],container:['kubernetes','container'],workload:['kubernetes','workload'],host:['import','host']};

function matchDoc(n){
 const d=n.data;
 return {source:n.source,environment:d.environment,alertType:d.alertType,severity:d.severity,status:d.status,resourceKind:d.resource.kind,resourceScope:d.resource.scope,resourceId:d.resource.id,time:n.time,...(typeof d.message==='string'?{message:d.message.slice(0,4096)}:{})};
}

async function resolvePolicy(pool,engine,owner,sourceId,policyId,policyInput){
 let policy=null;
 if(policyInput!==undefined)policy=policyDefinition(policyInput);
 else if(policyId){
  if(!validId(policyId))fail(400,'Choose a valid saved rule revision.');
  policy=(await pool.query('SELECT record FROM operations_policies WHERE user_sub=$1 AND id=$2',[owner,policyId])).rows[0]?.record;
  if(!policy)fail(404,'That rule revision is unavailable in your scope.');
 }else{
  const binding=(await pool.query('SELECT record FROM operations_policy_bindings WHERE user_sub=$1 AND id=$2',[owner,sourceId])).rows[0]?.record;
  if(!binding)fail(409,'No rule policy is active on this source yet. Choose a saved rule revision or publish rules first.');
  policy=(await pool.query('SELECT record FROM operations_policies WHERE user_sub=$1 AND id=$2',[owner,binding.policyId])).rows[0]?.record;
  if(!policy)fail(503,'The active rule policy record is unavailable.');
 }
 const receipt=await engine('publish',owner,{revision:policy.id,rules:policy.rules.map(({id,enabled,query})=>({id,enabled,query}))});
 if(receipt.revision!==policy.id||receipt.sealed!==true||receipt.count!==policy.rules.length)fail(503,'The detection service did not confirm the selected rules.');
 return policy;
}

function reduceStep(symptoms,item,policy,matches){
 const key=hash(['symptom-v1',policy.name,item.symptomKey]),prev=symptoms.get(key),status=item.normalized.data.status;
 const nowMs=Number.isFinite(Date.parse(item.time))?Date.parse(item.time):Date.now(),now=new Date(nowMs).toISOString();
 if(!matches.length&&status!=='resolved')return {outcome:'filtered',symptomKey:key,admitted:false};
 if(status==='resolved'&&!prev){
  if(matches.length)symptoms.set(key,{status:'resolved',severity:item.normalized.data.severity,maxSeverity:item.normalized.data.severity,eventTime:now,expiresAt:now,admittedAt:null,count:1});
  return {outcome:'orphan-resolution',symptomKey:key,admitted:false};
 }
 const late=prev?.eventTime&&now<prev.eventTime,expired=!prev||nowMs>=Date.parse(prev.expiresAt),reopened=prev?.status==='resolved';
 const flap=status==='firing'&&!late&&reopened&&!expired&&prev.admittedAt&&nowMs-Date.parse(prev.admittedAt)<policy.window.seconds*1000;
 const fresh=status==='firing'&&!late&&(expired||(reopened&&!flap));
 const sev=item.normalized.data.severity,oldSev=prev?.maxSeverity||prev?.severity||'info';
 const escalation=!fresh&&Boolean(prev)&&status==='firing'&&!late&&SEV[sev]>SEV[oldSev];
 const admitted=Boolean(fresh||escalation);
 const next={status:late?prev.status:status,severity:late?prev.severity:sev,maxSeverity:late?oldSev:fresh?sev:(SEV[sev]>SEV[oldSev]?sev:oldSev),
  eventTime:late?prev.eventTime:now,admittedAt:admitted?now:(prev?.admittedAt||null),count:(prev?.count||0)+1,
  expiresAt:fresh||(!late&&policy.window.mode==='sliding')?new Date(nowMs+policy.window.seconds*1000).toISOString():prev.expiresAt};
 symptoms.set(key,next);
 const outcome=late?'late-occurrence':status==='resolved'?'source-resolved':fresh?'admitted':escalation?'escalated':flap?'refired':'suppressed';
 return {outcome,symptomKey:key,admitted};
}

async function correlatePreview(pool,owner,survivors){
 let full={assets:[],relationships:[]};
 try{full=await readGraph(pool,owner);}catch{full={assets:[],relationships:[]};}
 const events=[],assetSet=new Set();
 for(const s of survivors){
  const r=s.resource,[provider,kind]=ASSET_KIND[r.kind]||[];
  const asset=provider?full.assets.find(a=>a.provider===provider&&a.kind===kind&&a.scope===r.scope&&a.nativeId===r.id):full.assets.find(a=>a.scope===r.scope&&a.nativeId===r.id);
  if(asset)assetSet.add(asset.id);
  events.push({id:s.id,assetId:asset?.id||null,resource:r});
 }
 const edges=(full.relationships||[]).filter(e=>e.resolved&&['DEPENDS_ON','RUNS_ON','ROUTES_TO','FORWARDS_TO'].includes(e.type)&&assetSet.has(e.from)&&assetSet.has(e.to));
 const parent=new Map(events.map(e=>[e.id,e.id]));
 const find=x=>{while(parent.get(x)!==x)x=parent.get(x);return x;};
 const join=(a,b)=>{const ra=find(a),rb=find(b);if(ra!==rb)parent.set(rb,ra);};
 for(let i=0;i<events.length;i++)for(let j=i+1;j<events.length;j++){
  const a=events[i].assetId,b=events[j].assetId;if(!a||!b)continue;
  if(a===b||edges.some(e=>(e.from===a&&e.to===b)||(e.from===b&&e.to===a)))join(events[i].id,events[j].id);
 }
 const byRoot=new Map();
 for(const e of events){const r=find(e.id);if(!byRoot.has(r))byRoot.set(r,[]);byRoot.get(r).push(e.id);}
 const assets=(full.assets||[]).filter(a=>assetSet.has(a.id)).slice(0,16);
 return {correlation:{status:'sandbox-preview',policy:{id:'sandbox-dependencies-v1'},groups:[...byRoot.values()],events},graph:{assets,relationships:edges.slice(0,32)}};
}

async function executeSandbox(ctx,engine,owner,source,policy,items,meta){
 const symptoms=new Map(),decisions=[];
 for(const item of items){
  const matched=await engine('match',owner,{revision:policy.id,document:matchDoc(item.normalized)});
  if(matched.complete!==true||matched.revision!==policy.id||!Array.isArray(matched.matches)||matched.matches.length!==matched.total)fail(503,'Sandbox percolation returned an incomplete match set.');
  const red=reduceStep(symptoms,item,policy,matched.matches);
  const names=policy.rules.filter(r=>matched.matches.includes(r.id)).map(r=>r.name);
  decisions.push({id:item.id,eventId:item.eventId,time:item.time,resource:item.normalized.data.resource,alertType:item.normalized.data.alertType,severity:item.normalized.data.severity,status:item.normalized.data.status,outcome:matched.matches.length?'matched':'unmatched',reduction:red.outcome,admitted:red.admitted,matchedRules:names});
 }
 const survivors=decisions.filter(d=>d.admitted);
 const {correlation,graph}=await correlatePreview(ctx.pool,owner,survivors);
 const actual={deliveries:decisions.length,matched:decisions.filter(d=>d.outcome==='matched').length,filtered:decisions.filter(d=>d.outcome==='unmatched').length,survivors:survivors.length,suppressed:decisions.filter(d=>['suppressed','refired'].includes(d.reduction)).length,groups:correlation.groups.length,evidencePackets:0};
 const completedAt=new Date().toISOString();
 const id=hash(['replay-sandbox-v1',meta.mode,source.id,policy.id,items.map(i=>i.id),meta.detail]);
 const body={id,scenario:meta.mode+'-v1',mode:meta.mode,synthetic:true,isolated:true,liveSideEffects:false,sourceId:source.id,sourceName:source.name,environment:source.environment,policyId:policy.id,policyName:policy.name,completedAt,...meta.extra,expected:null,actual,passed:true,decisions:decisions.slice(0,50),packets:[],correlation,graph};
 if(Buffer.byteLength(JSON.stringify(body))>65536)body.decisions=body.decisions.slice(0,20);
 const record={...body,sha256:hash(body)};
 await ctx.store.put('replays',id,record);
 return record;
}

export async function windowReplay(ctx,engine,owner,input){
 requireOwner(owner);
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['sourceId','from','to','timeField','policyId','policy'].includes(k)))fail(400,'Supply sourceId, from, to and optional policy selection only.');
 const sources=(await ctx.store.query('sources')).filter(s=>!s?.discardedAt),source=sources.find(s=>s.id===input.sourceId);
 if(!source)fail(404,'Choose one of your saved source revisions.');
 const fromMs=Date.parse(input.from),toMs=Date.parse(input.to);
 if(!Number.isFinite(fromMs)||!Number.isFinite(toMs)||fromMs>toMs||toMs-fromMs>30*86400*1000)fail(400,'Choose a start and end time within 30 days.');
 const byEvent=input.timeField==='eventTime',fromIso=new Date(fromMs).toISOString(),toIso=new Date(toMs).toISOString();
 const rows=byEvent
  ?(await ctx.pool.query('SELECT record FROM operations_deliveries WHERE user_sub=$1 AND source_revision=$2 ORDER BY received_at ASC, id ASC LIMIT 500',[owner,source.id])).rows.map(r=>r.record).filter(r=>{const t=Date.parse(r?.normalized?.time);return Number.isFinite(t)&&t>=fromMs&&t<=toMs;})
  :(await ctx.pool.query('SELECT record FROM operations_deliveries WHERE user_sub=$1 AND source_revision=$2 AND received_at>=$3 AND received_at<=$4 ORDER BY received_at ASC, id ASC LIMIT 101',[owner,source.id,fromIso,toIso])).rows.map(r=>r.record);
 const validated=rows.filter(r=>r?.decision==='validated'&&r.normalized);
 if(!validated.length)fail(400,'No validated deliveries were recorded for this source in that time window.');
 if(validated.length>100)fail(413,'Narrow the time window to at most 100 validated deliveries.');
 const policy=await resolvePolicy(ctx.pool,engine,owner,source.id,input.policyId,input.policy);
 const items=validated.map(r=>({id:r.id,eventId:r.normalized.id,time:r.normalized.time||r.receivedAt,normalized:r.normalized,symptomKey:r.identity?.symptom||[source.source,r.normalized.data.alertType,r.normalized.data.resource.id]}));
 return executeSandbox(ctx,engine,owner,source,policy,items,{mode:'recorded-window',detail:{from:fromIso,to:toIso},extra:{window:{from:fromIso,to:toIso,quarantinedSkipped:rows.length-validated.length}}});
}

function normalizeCloudEventsBatch(source,batch){
 const list=Array.isArray(batch)?batch:Array.isArray(batch?.events)?batch.events:[batch];
 if(!list.length||list.length>50)fail(list.length>50?413:400,'Upload 1–50 CloudEvents in a single JSON batch.');
 return list.map((raw,index)=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail(400,'Item '+(index+1)+' must be a CloudEvents JSON object.');
  const check=Mapping.normalize(JSON.stringify(raw),source.mapping,source.source);
  if(!check.ok)fail(422,'Item '+(index+1)+' failed source mapping validation: '+(check.errors?.[0]?.message||'invalid CloudEvent.'));
  if(check.normalized.data.environment!==source.environment)fail(422,'Item '+(index+1)+' environment ('+check.normalized.data.environment+') does not match source environment ('+source.environment+').');
  const service=typeof raw.data?.labels?.service==='string'&&raw.data.labels.service?raw.data.labels.service.slice(0,128):null;
  const id=hash(['sandbox-ce-v1',source.id,index,raw]);
  return {id,eventId:check.normalized.id,time:check.normalized.time,normalized:check.normalized,symptomKey:service?[...check.symptomIdentity,service]:check.symptomIdentity};
 });
}

async function normalizeOtlpBatch(pool,owner,source,format,batch){
 const stream=(await pool.query('SELECT record FROM operations_streams WHERE user_sub=$1 AND id=$2',[owner,source.id])).rows[0]?.record;
 if(!stream)fail(409,'Configure a stream mapping on Live context for this source before replaying OTLP batches.');
 const rows=normalizeTelemetry(source,stream.config,format,batch);
 if(!rows.length||rows.length>50)fail(rows.length>50?413:400,'Upload 1–50 OTLP observations in a single batch.');
 return rows.map((obs,index)=>{
  const alertType=obs.signal==='metric'?obs.name:'otlp-log';
  const severity=obs.signal==='log'&&(obs.severityNumber||0)>=17?'critical':obs.signal==='log'&&(obs.severityNumber||0)>=13?'warning':'info';
  const message=obs.signal==='metric'?(obs.name+'='+obs.value+(obs.unit?' '+obs.unit:'')):String(obs.body||'').slice(0,4096);
  const normalized={id:obs.id.slice(0,32),source:source.source,time:obs.observedAt,data:{environment:source.environment,alertType,severity,status:'firing',resource:obs.resource,message}};
  return {id:hash(['sandbox-otlp-v1',source.id,index,obs.id]),eventId:normalized.id,time:obs.observedAt,normalized,symptomKey:[source.source,alertType,obs.resource.kind,obs.resource.scope,obs.resource.id]};
 });
}

export async function batchReplay(ctx,engine,owner,input){
 requireOwner(owner);
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['sourceId','format','batch','policyId','policy'].includes(k)))fail(400,'Supply sourceId, format, batch and optional policy selection only.');
 if(input.batch===undefined||input.batch===null||Buffer.byteLength(JSON.stringify(input.batch))>65536)fail(413,'Upload a non-empty JSON batch of at most 64 KiB.');
 const sources=(await ctx.store.query('sources')).filter(s=>!s?.discardedAt),source=sources.find(s=>s.id===input.sourceId);
 if(!source)fail(404,'Choose one of your saved source revisions.');
 const rawFmt=input.format||'auto';
 const format=rawFmt!=='auto'?rawFmt:(Array.isArray(input.batch?.resourceLogs)?'otlp-logs':Array.isArray(input.batch?.resourceMetrics)?'otlp-metrics':'cloudevents');
 if(!['cloudevents','otlp-logs','otlp-metrics'].includes(format))fail(400,'Choose CloudEvents JSON, OTLP logs JSON or OTLP metrics JSON.');
 const items=format==='cloudevents'?normalizeCloudEventsBatch(source,input.batch):await normalizeOtlpBatch(ctx.pool,owner,source,format,input.batch);
 const policy=await resolvePolicy(ctx.pool,engine,owner,source.id,input.policyId,input.policy);
 return executeSandbox(ctx,engine,owner,source,policy,items,{mode:'uploaded-batch',detail:{format,hash:hash(input.batch)},extra:{batch:{format,count:items.length}}});
}

export async function discardReplayRun(ctx,owner,input){
 requireOwner(owner);
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='runId')||!validId(input.runId))fail(400,'Choose a sandbox replay run to remove.');
 const runs=await ctx.store.query('replays'),target=runs.find(r=>r?.id===input.runId&&!r.discardedAt);
 if(!target)fail(404,'That replay run receipt is unavailable in your scope.');
 if(target.isolated!==true)fail(400,'Only isolated sandbox replay receipts can be removed with run clean-up.');
 const discardedAt=new Date().toISOString();
 await ctx.store.put('replays',target.id,{...target,discardedAt});
 return {discardedRun:target.id,discardedAt};
}
