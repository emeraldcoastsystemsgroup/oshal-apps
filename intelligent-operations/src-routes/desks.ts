/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | The four monitoring desks (App Ops, Sec Ops, Platform Ops, Dev Ops; spec lanes/monitoring-four-desks-spec-2026-11-08.md): one desk is a saved source (spark/<desk>), one percolation policy whose defaults ship in deploy/policy.<desk>.default.json, one notification topic and one authorization composite over the one pipeline. The processing tick activates the desks for the person it runs as: a missing source is created, mapped for Alertmanager, its default policy published and the source added to the processing list; a desk already present is left exactly as the person edited it. Each desk answers one bounded read (firing now, sources with readings, rules, runbooks, settings) and one write (its rule toggles). Nothing here reads a host file: the threshold file is shown from the snapshot a heartbeat carried, or named as not reported. */
// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ingestMapping,saveIngestMapping} from './ingest';
import {publishPolicy} from './pipeline';
import {processingConfig,saveProcessingConfig} from './processing-worker';
import {installationRecords} from './installations';
import {runbooks} from './runbooks';
const Mapping=require('../ui/adapter-mapping.js');

const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const ownerRequired=owner=>{if(typeof owner!=='string'||!owner)fail(401,'A verified caller is required.');};
/** The installation name the spec gives the Spark's desks; a desk's source, scope and environment all carry it. */
const INSTALLATION='spark';
const URI_PREFIX='urn:operations:source:';
const NOTIFICATIONS_PAGE='/cockpit/tools/notify.html';
/** The desks, in the order the tabs show them. critical and warning are the alert types of spec section 3.1 and name the default rules; a person may add or switch rules in the tab. */
export const DESKS=[
 {id:'app-ops',key:'app',label:'App Ops',topic:'app-attention',permission:'desk.app',write:'desk.app.write',role:'ops-app',owns:'package health per installation',
  critical:['PackageScheduleRefused','PackageScheduleMissed','PackageCostDurabilityFailed','PackageInstallFailed'],warning:['PackageErrorBurst','PackageEgressSpike','PackageVersionDrift','PackageScheduleSkipped'],
  probe:'the App Ops consumer (kernel ops/app_ops_consumer.py, every 5 minutes) posts package alerts through the producer door'},
 {id:'sec-ops',key:'security',label:'Sec Ops',topic:'security-attention',permission:'desk.security',write:'desk.security.write',role:'ops-security',owns:'admission, identity, credentials and the perimeter',
  critical:['SignInFailureBurst','RootTransferred','AdminTierGranted','ProducerTokenIssued','DoorSeatsExhausted','UncommittedCodeInProduction','PlainHttpListenerPresent'],warning:['KernelRefusalStorm','RefusalCodeNew','TokenRevoked','LocationStepUp'],
  probe:'the Sec Ops consumer (kernel ops/sec_ops_consumer.py, every 5 minutes) posts security alerts through the producer door'},
 {id:'platform-ops',key:'platform',label:'Platform Ops',topic:'platform-attention',permission:'desk.platform',write:'desk.platform.write',role:'ops-platform',owns:'host, containers, databases, tunnels and slots',
  critical:['SiteDown','KernelMetricsUnreachable','ContainerMissing','ContainerRestarting','ContainerOutOfMemory','DiskFull','MemoryLow','PostgresDown','MonitoringBlind','PrometheusCannotStore','InstallationSilent','SlotDown','TunnelDown'],warning:['SiteSlow','DiskHigh','LoadHigh','RebootRequired','SecurityUpdatesPending','ContainerFactsStale','GpuThermal','EngineLinkStale'],
  probe:'the Platform Ops stack (Prometheus and Alertmanager on the host) posts a heartbeat every minute and its alerts as they fire'},
 {id:'dev-ops',key:'release',label:'Dev Ops',topic:'release-attention',permission:'desk.release',write:'desk.release.write',role:'ops-release',owns:'what is deployed and how it got there',
  critical:['ReleaseRolledBack','ReleaseLabelMismatch','ReleaseVerifyFailed'],warning:['ReleasePromoted','TrialBehindDev','DirtyTreeOnHost','PublishGateRed'],
  probe:'the promotion script posts each release and the Dev Ops consumer (kernel ops/dev_ops_consumer.py, every 15 minutes) posts drift'},
].map(desk=>Object.freeze({...desk,sourceName:INSTALLATION+'/'+desk.id,uri:URI_PREFIX+INSTALLATION+'/'+desk.id,thresholdFile:'~/.local/state/oshal-native/monitoring/'+desk.id+'.json',alertTypes:[...desk.critical,...desk.warning]}));
export const DESK_IDS=DESKS.map(d=>d.id);
/** @description The desk with this id, or null. */
export function deskById(id){return DESKS.find(d=>d.id===id)||null;}
/** @description The saved source revision that is this desk's, by its URI; a discarded one does not count. */
export function deskSource(sources,desk){return (sources||[]).find(s=>s?.source===desk.uri&&!s.discardedAt)||null;}
/** @description The desk a saved source belongs to, or null for any other source. The tick asks this to route a symptom to the desk's topic. */
export function deskOf(sources,sourceId){const source=(sources||[]).find(s=>s?.id===sourceId);return source?DESKS.find(d=>d.uri===source.source)||null:null;}
const policies=new Map();
/** @description The desk's default policy as shipped in deploy/policy.<desk>.default.json, read once; it is the policy a fresh activation publishes and the one Rules offers to restore. */
export function defaultPolicy(root,desk){
 const file=path.join(root,'deploy','policy.'+desk.id+'.default.json');
 if(!policies.has(file))policies.set(file,JSON.parse(fs.readFileSync(file,'utf8')));
 const policy=policies.get(file);return {name:policy.name,rules:policy.rules.map(r=>({...r,query:{...r.query}})),window:{...policy.window}};
}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** The source record a desk needs, in the exact shape sourceDefinition saves (same field order, same id), so a desk created here equals one a person would register by hand. */
function sourceRecord(desk){const body={name:desk.sourceName,source:desk.uri,environment:desk.sourceName,mapping:Mapping.DEFAULTS};return {...body,id:digest(body),version:1};}
const mappingFor=desk=>({resourceKind:'host',idLabel:'instance',scope:desk.sourceName,severityLabel:'severity'});
async function binding(pool,owner,sourceId){return (await pool.query('SELECT revision, record FROM operations_policy_bindings WHERE user_sub=$1 AND id=$2',[owner,sourceId])).rows[0]||null;}
/** @description Activate every desk for the person the tick runs as, idempotently: a desk whose source, mapping, policy binding and processing listing all exist costs one read each and changes nothing. A first processing configuration turns the chain on (evidence capture, correlation, investigations), as a first wiring does; a saved one keeps the person's enabled value and choices, the source only joins its list. One desk's failure is reported in its row and does not stop the others; the answer carries error naming every failed desk, which the tick records as a failed step. @param ctx The package context (store, pool, appPackageDir). @param engine The detection engine; publishing a policy needs it. @param owner The activating person. @param read The store read that gives the saved sources. @param options sources already read; inTime says when to stop starting work. @returns One row per desk saying what was created, kept or left pending. */
export async function activateDesks(ctx,engine,owner,read,options={}){
 ownerRequired(owner);
 if(typeof ctx.store?.put!=='function')return {desks:DESKS.map(d=>({id:d.id,pending:'no store'}))};
 const inTime=options.inTime||(()=>true),sources=options.sources||await read('sources'),rows=[],failures=[];
 for(const desk of DESKS){
  if(!inTime()){rows.push({id:desk.id,pending:'deferred to the next tick'});continue;}
  const row={id:desk.id,sourceId:null,created:false,mapped:'kept',policy:'kept',processing:'kept'};rows.push(row);
  try{
   let source=deskSource(sources,desk);
   if(!source){source=sourceRecord(desk);await ctx.store.put('sources',source.id,source);sources.push(source);row.created=true;}
   row.sourceId=source.id;
   if(!await ingestMapping(ctx.pool,owner,source.id)){await saveIngestMapping(ctx.pool,owner,{sourceId:source.id,...mappingFor(desk)},[source]);row.mapped='saved';}
   if(!await binding(ctx.pool,owner,source.id)){await publishPolicy(ctx.pool,engine,owner,source,defaultPolicy(ctx.appPackageDir,desk),0);row.policy='published';}
   const config=await processingConfig(ctx.pool,owner);
   if(!(config.sourceIds||[]).includes(source.id)){
    const first=!(config.revision||0),keep=Object.fromEntries(['captureEvidence','batchSize','maxAttempts','retrySeconds','correlate','correlationPolicy','autoInvestigate'].filter(k=>config[k]!==undefined).map(k=>[k,config[k]]));
    const chain=first?{captureEvidence:true,correlate:true,autoInvestigate:true}:{};
    await saveProcessingConfig(ctx.pool,owner,{...keep,...chain,enabled:first?true:Boolean(config.enabled),sourceIds:[...new Set([...(config.sourceIds||[]),source.id])].sort(),expectedRevision:config.revision||0},[...new Set([...(config.sourceIds||[]),source.id])]);
    row.processing=first?'listed and turned on':'listed';
   }
  }catch(error){row.error=String(error.message||error).slice(0,200);failures.push(desk.label+': '+row.error);}
 }
 return {desks:rows,...(failures.length?{error:failures.join('; ').slice(0,400)}:{})};
}
const by=(a,b)=>String(b.lastSeen||'').localeCompare(String(a.lastSeen||''));
/** What a symptom is, from its identity: [source, environment, kind, scope, id, alertType, service?]. */
const describe=identity=>Array.isArray(identity)?{environment:identity[1]||null,resourceKind:identity[2]||null,resourceId:identity[4]||null,alertType:identity[5]||null,service:identity[6]||null}:{};
/** @description The desk's symptoms, newest first: what its source's deliveries decided into, firing or cleared inside the policy window, each with its investigation when one was started. Decisions carry the source, so a policy edit (a new policy id) loses nothing. */
async function deskSymptoms(pool,owner,source,windowSeconds,now){
 const decisions=(await pool.query("SELECT record FROM operations_filter_decisions WHERE user_sub=$1 AND record->>'sourceId'=$2 ORDER BY created_at DESC, id LIMIT 200",[owner,source.id])).rows.map(r=>r.record);
 const keys=[...new Set(decisions.map(d=>d.reduction?.symptomKey).filter(Boolean))].slice(0,64);if(!keys.length)return [];
 const slots=ids=>ids.map((_,i)=>'$'+(i+2)).join(',');
 const symptoms=(await pool.query('SELECT record FROM operations_symptoms WHERE user_sub=$1 AND id IN ('+slots(keys)+')',[owner,...keys])).rows.map(r=>r.record);
 const work=(await pool.query("SELECT record FROM operations_evidence_work WHERE user_sub=$1 AND record->>'symptomKey' IN ("+slots(keys)+') ORDER BY created_at DESC, id LIMIT 200',[owner,...keys])).rows.map(r=>r.record);
 const workIds=[...new Set(work.map(w=>w.id))].slice(0,64);
 const investigations=workIds.length?(await pool.query('SELECT record FROM operations_investigations WHERE user_sub=$1 AND id IN ('+slots(workIds)+')',[owner,...workIds])).rows.map(r=>r.record):[];
 const latestWork=new Map();for(const w of work)if(!latestWork.has(w.symptomKey))latestWork.set(w.symptomKey,w);
 const recent=Date.parse(now)-windowSeconds*1000;
 return symptoms.filter(s=>s.status==='firing'||Date.parse(s.lastSeen)>=recent).sort(by).map(s=>{const w=latestWork.get(s.id),i=w?investigations.find(x=>x.id===w.id):null;
  return {id:s.id,...describe(s.identity),status:s.status,severity:s.severity,maxSeverity:s.maxSeverity||s.severity,count:s.count,episodeCount:s.episodeCount||0,firstSeen:s.firstSeen,lastSeen:s.lastSeen,eventTime:s.eventTime||null,admittedAt:s.admittedAt||null,expiresAt:s.expiresAt||null,
   evidence:w?{workId:w.id,state:w.state,capture:w.capture===true}:null,investigation:i?{ticketId:i.ticketId||null,state:i.state,href:i.ticketId?'/cockpit/?app=intelligent-operations&ticket='+encodeURIComponent(i.ticketId):null}:null};});
}
/** The bound policy with its rules as the Rules panel shows them, or null before activation. */
async function deskRules(pool,owner,source){
 const bound=await binding(pool,owner,source.id);if(!bound)return null;
 const policy=(await pool.query('SELECT record FROM operations_policies WHERE user_sub=$1 AND id=$2',[owner,bound.record.policyId])).rows[0]?.record;if(!policy)return null;
 return {policyId:policy.id,name:policy.name,window:policy.window,revision:bound.revision,publishedAt:policy.publishedAt||null,rules:policy.rules.map(r=>({id:r.id,name:r.name,enabled:r.enabled,capture:r.capture,alertType:r.query?.term?.alertType||null})).sort((a,b)=>Number(b.capture)-Number(a.capture)||a.name.localeCompare(b.name))};
}
const ago=s=>s===null?'never':s<90?s+' seconds ago':s<5400?Math.round(s/60)+' minutes ago':Math.round(s/3600)+' hours ago';
/** @description One desk as its tab and its Jarvis tool read it: firing now, its sources with readings, its rules, its runbooks and its settings, from the person's own records; nothing is run and no host file is read. @param ctx The package context. @param owner The caller. @param desk The desk. @param sources Saved source revisions. @param options days for the charts (1, 7, 14), clock. @returns The desk summary. */
export async function deskSummary(ctx,owner,desk,sources,options={}){
 ownerRequired(owner);
 const now=new Date((options.clock||Date.now)()).toISOString(),source=deskSource(sources,desk),defaults=defaultPolicy(ctx.appPackageDir,desk);
 const base={desk:desk.id,label:desk.label,owns:desk.owns,topic:desk.topic,permission:desk.permission,writePermission:desk.write,role:desk.role,asOf:now,
  settings:{topic:desk.topic,notificationsPage:NOTIFICATIONS_PAGE,sourceName:desk.sourceName,sourceUri:desk.uri,sourceId:source?.id||null,mapping:source?await ingestMapping(ctx.pool,owner,source.id):null,
   ingestRoute:source?'/api/intelligent-operations/ingest/alertmanager/'+source.id:null,producerTokens:'/api/v1/producer-tokens',thresholdFile:desk.thresholdFile,thresholds:null,lastHeardAt:null,probe:desk.probe},
  defaults:{critical:desk.critical,warning:desk.warning},executionAuthorized:false,open:desk.label,source:'your own saved Operations records; nothing was run'};
 if(!source)return {...base,activated:false,installations:[],symptoms:[],rules:null,runbooks:[],summary:desk.label+' has no source yet: the processing schedule creates spark/'+desk.id+' with its default policy on its next run, once it has started for you.'};
 const [rules,installations,books]=await Promise.all([deskRules(ctx.pool,owner,source),installationRecords(ctx.pool,owner,[source],[1,7,14].includes(options.days)?options.days:1,options.clock||Date.now),runbooks(ctx.pool,owner)]);
 const symptoms=await deskSymptoms(ctx.pool,owner,source,rules?.window?.seconds||defaults.window.seconds,now);
 const types=new Set([...desk.alertTypes,...(rules?.rules||[]).map(r=>r.alertType||r.name)]);
 const row=installations[0]||null;
 const firing=symptoms.filter(s=>s.status==='firing'),critical=firing.filter(s=>s.severity==='critical'),warnings=firing.filter(s=>s.severity!=='critical');
 const standing=!row?'no source has reported yet':row.state==='silent'?'its source stopped reporting, last heard '+ago(row.ageSeconds):row.state==='late'?'its source is late, last heard '+ago(row.ageSeconds):row.state==='never'?'its source has sent alerts but no report yet':'its source is reporting, heard '+ago(row.ageSeconds);
 const summary=desk.label+': '+(critical.length?critical.length+' critical firing ('+critical.slice(0,6).map(s=>s.alertType+(s.service?' ('+s.service+')':'')).join(', ')+')':'no critical alert firing')+(warnings.length?', '+warnings.length+' warning'+(warnings.length===1?'':'s'):'')+'; '+standing+'; '+(rules?rules.rules.filter(r=>r.enabled).length+' of '+rules.rules.length+' rules on':'its policy is not published yet')+'.';
 return {...base,activated:true,installations,symptoms,rules,runbooks:books.items.filter(r=>types.has(r.alertType)),summary,
  settings:{...base.settings,thresholds:row?.thresholds||null,lastHeardAt:row?.lastHeardAt||null}};
}
const cleanName=v=>typeof v==='string'&&v.trim()===v&&v.length>=1&&v.length<=80&&!/[\u0000-\u001f]/.test(v);
/** @description Save the desk's rule toggles: on or off and capture per rule, a rule added by alert type, a rule removed. Each kept rule keeps its stored query, so a query a person refined in Data pipeline survives a toggle here; a new name gets the one-term query the defaults use. The publish is revision-checked against the binding, as every policy publish is. @param input {rules:[{name,enabled,capture}], expectedRevision, restoreDefaults?} @returns The published policy and its binding. */
export async function saveDeskPolicy(ctx,engine,owner,desk,sources,input){
 ownerRequired(owner);
 const source=deskSource(sources,desk);if(!source)fail(409,desk.label+' has no source yet; the processing schedule creates it on its next run.');
 if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['rules','expectedRevision','restoreDefaults'].includes(k)))fail(400,'Send rules, expectedRevision and optionally restoreDefaults.');
 if(!Number.isInteger(input.expectedRevision)||input.expectedRevision<0)fail(400,'Invalid expectedRevision.');
 const current=await deskRules(ctx.pool,owner,source),defaults=defaultPolicy(ctx.appPackageDir,desk);
 let rules;
 if(input.restoreDefaults===true)rules=defaults.rules;
 else{
  if(!Array.isArray(input.rules)||!input.rules.length||input.rules.length>128)fail(400,'Send 1 to 128 rules.');
  const stored=current?(await ctx.pool.query('SELECT record FROM operations_policies WHERE user_sub=$1 AND id=$2',[owner,current.policyId])).rows[0]?.record:null;
  const queries=new Map((stored?.rules||[]).map(r=>[r.name,r.query]));
  rules=input.rules.map(r=>{if(!r||!cleanName(r.name)||typeof r.enabled!=='boolean'||typeof r.capture!=='boolean')fail(400,'Each rule needs its alert type name, enabled and capture.');return {name:r.name,enabled:r.enabled,capture:r.capture,query:queries.get(r.name)||{term:{alertType:r.name}}};});
  if(new Set(rules.map(r=>r.name)).size!==rules.length)fail(400,'Rule names must be unique within a policy.');
 }
 const policy={name:current?.name||defaults.name,rules,window:current?.window||defaults.window};
 return publishPolicy(ctx.pool,engine,owner,source,policy,input.expectedRevision);
}
