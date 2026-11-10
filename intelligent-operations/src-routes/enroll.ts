/** CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Lane M2 (1.8.0): support Windows and macOS headless platforms, config-pack agent enrollments, and optional device trust metadata (Ed25519 publicKey / fingerprint, allowedIps CIDRs, observedIp, tool) on client and enrollmentRecords while keeping the base record shape unchanged when those fields are absent. */
/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | ADR-216 S2 (1.7.0): an OpenTelemetry Collector is taken. Its source gets the same host mapping (the silence watch, the card and every event read it), and prepare answers the OTLP route /ingest/otlp/<id> (otlp.ts) with the label '<name> otel'; a Prometheus or existing Alertmanager still answers /ingest/alertmanager/<id>. The kernel may pass the name the server suggested (client.name, up to 80 plain characters); it is bounded and decides nothing. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | ADR-216 S1 (1.6.0): enrolling a monitored installation with a one-time code. The kernel runs POST /installations/enroll as the person approving a server's code (oshal-kernel crates/api/src/producer_enrollments.rs prepare, body {name, client}) and mints a producer token for the one route this answers, under the prefix oshal-app.yaml producers.enroll declares. prepareInstallation does in one call what oshal-kernel ops/monitoring/wire_producer.py did in four: it creates the source urn:operations:source:<name> (environment <name>) or reuses the person's source of that name with its history, saves the Alertmanager mapping (host, label instance, scope <name>, severity), publishes the policy whose rule lists moved here from wire_producer.py (CRITICAL captured, WARNING recorded; a desk's own source gets its desk's default) unless one is already bound, and adds the source to processing without turning on a configuration the person switched off (a first configuration turns the whole chain on). A removed source is never reused: its id stays removed, so the routes its old tokens name stay gone (410). Everything that can refuse refuses before anything is written: the name and client, an OpenTelemetry agent (no OTLP route yet), a processing list at its 32 sources, and a detection engine that cannot publish. It records what the server said of itself, which Systems reads beside the person's producer tokens. */
// @ts-nocheck
import {createHash} from 'node:crypto';
import {ingestMapping,saveIngestMapping} from './ingest';
import {publishPolicy} from './pipeline';
import {processingConfig,saveProcessingConfig} from './processing-worker';
import {DESKS,defaultPolicy} from './desks';
import {OTLP_PREFIX} from './otlp';

const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
/** The prefixes of the one route an enrolled server's token names (oshal-app.yaml producers.enroll.routes): Alertmanager's, and an OpenTelemetry Collector's. */
export const ALERTMANAGER_PREFIX='/ingest/alertmanager/';
export {OTLP_PREFIX};
/** Where the person sees an enrolled installation: Systems. */
export const SYSTEMS='/cockpit/?app=intelligent-operations&screen=operations-estate';
/**
 * Critical alert types: each becomes a symptom with a captured snapshot.
 * Moved from oshal-kernel ops/monitoring/wire_producer.py (ADR-216 section 4); this is now the single copy.
 */
export const CRITICAL=Object.freeze(['SiteDown','KernelMetricsUnreachable','ContainerMissing','ContainerRestarting','ContainerOutOfMemory','DiskFull','MemoryLow','PostgresDown','BackupMissing','BackupSmall','OffsiteCopyMissing','MonitoringBlind','PrometheusCannotStore','SlotDown','TunnelDown','InstallationSilent']);
/** Warning alert types: each is recorded only. Moved from wire_producer.py with CRITICAL. */
export const WARNING=Object.freeze(['SiteSlow','KernelRefusalStorm','DiskHigh','LoadHigh','RebootRequired','SecurityUpdatesPending','ContainerFactsStale','EngineLinkStale','GpuThermal']);
const URN='urn:operations:source:',NAME=/^[\x20-\x7e]+$/,HOST=/^[A-Za-z0-9.-]{0,64}$/,VERSION=/^[A-Za-z0-9.+_-]{1,32}$/,KEY_TEXT=/^[A-Za-z0-9:+/=._-]{1,256}$/,CIDR_TEXT=/^[A-Fa-f0-9:./]{1,64}$/;
const AGENTS=['prometheus','otel','existing','config-pack'],PLATFORMS=['linux','windows','macos','kubernetes'],TOOLS=['prometheus','alertmanager','otel'],CLIENT_KEYS=['host','platform','agent','version','name','publicKey','fingerprint','allowedIps','observedIp','tool'];
/** The kernel's limit on an enrolment's name and label (producer_enrollments.rs check_prepared), and the policy name's (pipeline.ts). */
const MOST_TEXT=80;
/** saveProcessingConfig takes at most this many sources. */
const MOST_PROCESSED=32;
/** A removed source's id is never taken again; after this many removals under one name a new name is asked for. */
const MOST_GENERATIONS=64;
const KEEP=['captureEvidence','batchSize','maxAttempts','retrySeconds','correlate','correlationPolicy','autoInvestigate'];
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Text cut so that it and its suffix fit the kernel's 80 characters. Pure. */
const fit=(text,suffix)=>text.slice(0,MOST_TEXT-suffix.length).trimEnd()+suffix;

/**
 * @description The policy an enrolled installation starts with: one enabled rule per alert type, a critical alert captured, a warning recorded, in a sliding 15-minute window, as wire_producer.py policy_for published it.
 * @param name The installation's name.
 * @returns The policy input publishPolicy takes.
 */
export function policyFor(name){
 const rule=capture=>alertType=>({name:alertType,enabled:true,capture,query:{term:{alertType}}});
 return {name:fit(name,' checks'),rules:[...CRITICAL.map(rule(true)),...WARNING.map(rule(false))],window:{mode:'sliding',seconds:900}};
}

/** What the server said of itself, as the kernel bounds it (control::enrollment_client), or null for an offline file. A name it suggested is checked like the person's and otherwise ignored: the person's name decides. */
function clientOf(client){
 if(client===undefined||client===null)return null;
 if(typeof client!=='object'||Array.isArray(client)||Object.keys(client).some(k=>!CLIENT_KEYS.includes(k)))fail(400,'The client is {host, platform, agent, version, name}.');
 if(client.name!==undefined&&client.name!==null&&(typeof client.name!=='string'||!client.name.length||client.name.length>MOST_TEXT||!NAME.test(client.name)))fail(400,'The client name is up to 80 plain characters.');
 if(!AGENTS.includes(client.agent))fail(400,'The client agent is prometheus, otel, existing or config-pack.');
 if(!PLATFORMS.includes(client.platform))fail(400,'The client platform is linux, windows, macos or kubernetes.');
 if(typeof client.host!=='string'||!HOST.test(client.host))fail(400,'The client host is up to 64 letters, digits, dots and hyphens.');
 if(client.version!==undefined&&client.version!==null&&(typeof client.version!=='string'||!VERSION.test(client.version)))fail(400,'The client version is up to 32 letters, digits and . + _ -.');
 const out={agent:client.agent,platform:client.platform,host:client.host||null,version:client.version||null};
 if(client.publicKey!==undefined&&client.publicKey!==null){if(typeof client.publicKey!=='string'||!KEY_TEXT.test(client.publicKey))fail(400,'The client publicKey is up to 256 key characters.');out.publicKey=client.publicKey;}
 if(client.fingerprint!==undefined&&client.fingerprint!==null){if(typeof client.fingerprint!=='string'||!KEY_TEXT.test(client.fingerprint))fail(400,'The client fingerprint is up to 256 key characters.');out.fingerprint=client.fingerprint;}
 if(client.observedIp!==undefined&&client.observedIp!==null){if(typeof client.observedIp!=='string'||!CIDR_TEXT.test(client.observedIp))fail(400,'The client observedIp must be an IP address.');out.observedIp=client.observedIp;}
 if(client.allowedIps!==undefined&&client.allowedIps!==null){
  if(!Array.isArray(client.allowedIps)||client.allowedIps.length>16||client.allowedIps.some(ip=>typeof ip!=='string'||!CIDR_TEXT.test(ip)))fail(400,'The client allowedIps is up to 16 IP or CIDR strings.');
  out.allowedIps=client.allowedIps.slice();
 }
 if(client.tool!==undefined&&client.tool!==null){if(!TOOLS.includes(client.tool))fail(400,'The client tool is prometheus, alertmanager or otel.');out.tool=client.tool;}
 return out;
}

/** The request the kernel sends: a name the source, the mapping's scope and the kernel's label can all carry, and the client. */
function checked(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['name','client'].includes(k)))fail(400,'Send the installation\'s name and client only.');
 const name=input.name;
 if(typeof name!=='string'||!name.length||name.length>MOST_TEXT||name.trim()!==name)fail(400,'Name the installation in 1 to 80 characters, with no space at either end.');
 if(!NAME.test(name))fail(400,'Name the installation in plain characters: letters, digits, spaces and punctuation.');
 return {name,client:clientOf(input.client)};
}

/** The person's saved source this name reuses: the one not removed that has the name; of several, the one with the name's own URN; otherwise the person chooses. */
function reusable(saved,name,urn){
 const named=saved.filter(s=>s&&!s.discardedAt&&s.name===name);
 if(named.length<2)return named[0]||null;
 const own=named.filter(s=>s.source===urn);
 if(own.length===1)return own[0];
 return fail(409,named.length+' saved sources are named '+JSON.stringify(name)+'. Remove the one you no longer use on Systems, or choose another name.');
}

/** A new source for the name: the definition Sources and wire_producer.py save, under its content id, unless a removed source holds that id; then the next generation's id, so a removed source's route never takes reports again. */
function freshSource(saved,define,name,urn){
 const base=define({name,source:urn,environment:name}),body={name:base.name,source:base.source,environment:base.environment,mapping:base.mapping};
 for(let generation=1;generation<=MOST_GENERATIONS;generation++){
  const id=generation===1?base.id:digest({...body,generation});
  if(!saved.some(s=>s?.id===id))return generation===1?base:{...base,id,generation};
 }
 return fail(409,JSON.stringify(name)+' was removed from Operations too many times; choose another name.');
}

/** How processing changes: the source joins the list, an enabled value stays as the person saved it, a first configuration turns on. A full list is refused here, before anything is written. */
async function processingPlan(pool,owner,sourceId){
 const config=await processingConfig(pool,owner),listed=(config.sourceIds||[]).slice().sort(),first=!(config.revision||0);
 const sourceIds=[...new Set([...listed,sourceId])].sort();
 if(sourceIds.length>MOST_PROCESSED)fail(409,'Processing already covers '+MOST_PROCESSED+' sources, its most. Take one off on Data pipeline, Background processing, or remove a source you no longer use, then approve again.');
 return {config,sourceIds,first,write:first||sourceIds.length!==listed.length,enabled:first||Boolean(config.enabled)};
}

/** Save the plan, keeping every choice the person made; a first configuration turns on evidence capture, correlation and investigations, as a first wiring did. */
async function applyProcessing(pool,owner,plan){
 if(plan.write){
  const keep=Object.fromEntries(KEEP.filter(k=>plan.config[k]!==undefined).map(k=>[k,plan.config[k]]));
  const chain=plan.first?{captureEvidence:true,correlate:true,autoInvestigate:true}:{};
  await saveProcessingConfig(pool,owner,{...keep,...chain,enabled:plan.enabled,sourceIds:plan.sourceIds,expectedRevision:plan.config.revision||0},plan.sourceIds);
 }
 return {listed:true,enabled:plan.enabled,firstConfiguration:plan.first};
}

/** Publish the starting policy unless one is bound; a policy the person edited is theirs. A desk's own source starts from its desk's shipped default. */
async function ensurePolicy(ctx,engine,owner,source){
 if((await ctx.pool.query('SELECT id FROM operations_policy_bindings WHERE user_sub=$1 AND id=$2',[owner,source.id])).rows.length)return 'kept';
 const desk=DESKS.find(d=>d.uri===source.source);
 await publishPolicy(ctx.pool,engine,owner,source,desk?defaultPolicy(ctx.appPackageDir,desk):policyFor(source.name),0);
 return 'published';
}

/** Save the Alertmanager mapping unless the source has one. */
async function ensureMapping(pool,owner,source){
 if(await ingestMapping(pool,owner,source.id))return 'kept';
 await saveIngestMapping(pool,owner,{sourceId:source.id,resourceKind:'host',idLabel:'instance',scope:source.name,severityLabel:'severity'},[source]);
 return 'saved';
}

/** Keep what the server said of itself and when; the first approval's time stays. */
async function recordEnrollment(store,source,client){
 const rows=await store.query('enrollments'),held=(Array.isArray(rows)?rows:[]).find(r=>r?.sourceId===source.id),at=new Date().toISOString();
 const extra={};
 for(const k of ['publicKey','fingerprint','allowedIps','observedIp','tool']){const v=client?.[k]??held?.[k];if(v!==undefined)extra[k]=v;}
 await store.put('enrollments',source.id,{sourceId:source.id,name:source.name,agent:client?.agent??null,platform:client?.platform??null,host:client?.host??null,version:client?.version??null,preparedAt:at,firstPreparedAt:held?.firstPreparedAt||at,...extra});
}

/**
 * @description Prepare Operations for a server the person is enrolling: the source, its mapping, its policy and its place in processing, then the route its producer token will name.
 * @param ctx The package context: the person's SQL pool, document store and package directory.
 * @param owner The approving person's verified subject.
 * @param input {name, client} as the kernel sends it; client is null for an offline enrolment file.
 * @param deps {engine, define}: the detection engine with the tick's deadline (the kernel ends a package call at 60 s) and the Sources definition function, so the id is the one Sources gives.
 * @returns {route, label, name, open} for the kernel, with what was created or kept.
 */
export async function prepareInstallation(ctx,owner,input,{engine,define}){
 if(typeof owner!=='string'||!owner.trim())fail(401,'A verified caller is required.');
 const {name,client}=checked(input),urn=URN+name.split('/').map(encodeURIComponent).join('/');
 const saved=await ctx.store.query('sources');if(!Array.isArray(saved))throw Error('Malformed store response');
 const existing=reusable(saved,name,urn),source=existing||freshSource(saved,define,name,urn);
 const plan=await processingPlan(ctx.pool,owner,source.id);
 const policy=await ensurePolicy(ctx,engine,owner,source);
 if(!existing)await ctx.store.put('sources',source.id,source);
 const mapping=await ensureMapping(ctx.pool,owner,source);
 const processing=await applyProcessing(ctx.pool,owner,plan);
 await recordEnrollment(ctx.store,source,client);
 // An OpenTelemetry Collector reports to the OTLP route, where Operations reads its metrics and evaluates the alerts itself.
 const otlp=client?.agent==='otel'||(client?.agent==='config-pack'&&client?.tool==='otel');
 return {route:(otlp?OTLP_PREFIX:ALERTMANAGER_PREFIX)+source.id,label:fit(source.name,otlp?' otel':' alertmanager'),name:source.name,open:SYSTEMS,sourceId:source.id,created:!existing,mapping,policy,processing};
}

/**
 * @description What prepare recorded for each of the person's sources still saved, newest first, for Systems.
 * @param store The person's document store.
 * @param sources The saved sources that are not removed.
 * @returns One row per enrolled source.
 */
export async function enrollmentRecords(store,sources){
 const rows=await store.query('enrollments'),live=new Set((sources||[]).map(s=>s.id));
 return (Array.isArray(rows)?rows:[]).filter(r=>r&&live.has(r.sourceId))
  .map(r=>{
   const base={sourceId:r.sourceId,name:r.name,agent:r.agent??null,platform:r.platform??null,host:r.host??null,version:r.version??null,preparedAt:r.preparedAt||null,firstPreparedAt:r.firstPreparedAt||null};
   for(const k of ['publicKey','fingerprint','allowedIps','observedIp','tool'])if(r[k]!==undefined)base[k]=r[k];
   return base;
  })
  .sort((a,b)=>String(b.preparedAt).localeCompare(String(a.preparedAt)));
}
