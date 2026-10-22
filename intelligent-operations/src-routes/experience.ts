// CHANGE LOG: 11 | maintainer@emeraldcoastsystemsgroup.com | Serve the selected-pod console under current application admission.
/** CHANGE LOG: 19 | maintainer@emeraldcoastsystemsgroup.com | Serve the historical RCA reference reader through existing own-scope asset admission. */
/** CHANGE LOG: 18 | maintainer@emeraldcoastsystemsgroup.com | Serve the exact-identity resource explorer through the existing authenticated asset boundary. */
/** CHANGE LOG: 17 | maintainer@emeraldcoastsystemsgroup.com | Expose own immutable ticket links, exact canonical phase reservations and clearly labeled operator reports on shared connector handoffs. */
/** CHANGE LOG: 16 | maintainer@emeraldcoastsystemsgroup.com | Expose preprocessed canonical investigation preparation and current owned workflow links. */
/** CHANGE LOG: 15 | maintainer@emeraldcoastsystemsgroup.com | Serve the 3D graph module through the existing authenticated asset boundary. */
/** CHANGE LOG: 4 | maintainer@emeraldcoastsystemsgroup.com | Admit source-bound candidate trials through existing records-write authority. */
/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Host the Operations experience through native application authorization and person-scoped durable records.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Bind retained telemetry, standard JSON stream routes and replay assets to existing caller authority.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Batch bounded alert admission with explicit per-delivery outcomes and preserved source authority.
 */
// @ts-nocheck
import fs from 'node:fs';
import {saveSyncLink,syncRecords,reserveSync,reportSync} from './ticket-sync';
import {capturePendingEvidence} from './evidence-worker';
import {prepareInvestigation,investigationRecords} from './investigations';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Router, json } from 'express';
import {admit, intakeRecords} from './intake';
import {saveScan, readGraph, correlateDeliveries} from './topology-store';
import {saveProcessingConfig,processingRecords,processPending,retryProcessing} from './processing-worker';
import {detectionEngine} from './detection-engine';
import {publishPolicy, previewPolicy, evaluateDelivery, pipelineRecords} from './pipeline';
import {configureStream,ingestTelemetry,streamRecords,telemetryWindow,pinTelemetryEvidence} from './telemetry-store';
import {completeReplay} from './replay-store';
const Contract = require('../ui/source-contract.js');
const Mapping = require('../ui/adapter-mapping.js');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clean = (s, n=256) => typeof s === 'string' && s.length > 0 && s.length <= n && s.trim() === s && !/[\x00-\x1f\x7f]/.test(s);
const fail = (message, status=400) => { throw Object.assign(new Error(message), {status}); };
const bounded = value => { if (Buffer.byteLength(JSON.stringify(value)) > 65536) fail('Record exceeds 64 KiB.',413); };

/** Immutable source definitions are selected by content revision; authority always comes from the current request. */
export function sourceDefinition(input) {
  if (!input || !clean(input.name,80) || !clean(input.environment,80)) fail('Name and environment are required.');
  const example = Contract.example(); example.source=input.source;
  if (!Contract.validate(JSON.stringify(example),input.source).ok) fail('Use an absolute source URI without credentials.');
  const mapping = input.mapping || Mapping.DEFAULTS;
  if (JSON.stringify(Object.keys(mapping).sort())!==JSON.stringify(Object.keys(Mapping.DEFAULTS).sort())) fail('Map exactly the seven supported fields.');
  const check = Mapping.normalize(JSON.stringify(example),mapping,input.source);
  if (check.errors?.some(error=>error.path.startsWith('mapping') && !error.message.startsWith('The mapped field is missing'))) fail('Invalid adapter mapping.');
  const body = {name:input.name,source:input.source,environment:input.environment,mapping}; bounded(body);
  return {...body,id:digest(body),version:1};
}

/** Validate a scoped Kubernetes snapshot; retain only named inventory facts, never Secrets or kubeconfig. */
export function inventorySnapshot(input) {
  if (!input || !clean(input.environment,80) || !clean(input.clusterUid) || !Contract.validate(JSON.stringify({...Contract.example(),time:input.observedAt})).ok
      || Date.parse(input.observedAt) > Date.now()+300000 || !Array.isArray(input.pods) || input.pods.length>200) fail('Invalid bounded Kubernetes observation.');
  const seen = new Set();
  const pods = input.pods.map(pod=>{
    if (!pod || ![pod.uid,pod.name,pod.namespace].every(v=>clean(v)) || (pod.node!==null&&!clean(pod.node)) || seen.has(pod.uid)) fail('Every pod needs a unique UID, namespace, name and node or null.');
    seen.add(pod.uid);
    if (![true,false,null].includes(pod.ready)) fail('Readiness must be measured or unknown.');
    if (!Array.isArray(pod.containers)||pod.containers.length>32) fail('Bounded container observations required.');
    const containers=pod.containers.map(c=>{
      if (!clean(c.name)||!clean(c.image,512)||![true,false,null].includes(c.ready)||!Number.isSafeInteger(c.restarts)||c.restarts<0) fail('Invalid container observation.');
      return {name:c.name,image:c.image,ready:c.ready,restarts:c.restarts};
    });
    return {uid:pod.uid,name:pod.name,namespace:pod.namespace,node:pod.node,ready:pod.ready,terminating:pod.terminating===true,containers};
  });
  const body={environment:input.environment,clusterUid:input.clusterUid,observedAt:input.observedAt,complete:input.complete===true,pods,origin:'authenticated-capture'};bounded(body);
  return {...body,id:digest(body)};
}

/** Routes run inside the native package sandbox; no process, network, credential or alternate identity runtime. */
export function createOperationsExperienceRoutes(ctx) {
  if (!ctx.authorization || !ctx.store || !ctx.pool || !ctx.appPackageDir) throw Error('Native Operations context required');
  ctx.authorization.registerResource('application',{authorize:async({actor,grant,fields})=>actor.isActive&&Boolean(actor.sub?.trim())&&Boolean(actor.issuer?.trim())&&grant.scope==='own'&&fields.length===0});
  const router=Router(); router.use(json({limit:'70kb'}));
  router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
  const root=fs.realpathSync(ctx.appPackageDir);
  const asset=(relative)=>(_req,res)=>{
    const file=fs.realpathSync(path.join(root,relative));
    if (!file.startsWith(root+path.sep)) return res.status(404).end();
    res.sendFile(file);
  };
  router.get('/app',asset('experience/index.html'));
  router.get('/evaluation',asset('deploy/evidence/recorded-bgl.json'));
  for(const file of ['operator-workspace.js','pod-console.js','rca-library.js','resource-tree.js','ticket-sync.js','experience.js','experience.css','explorer.js','graph-space.js','lifecycle.js','processing-controls.js','telemetry-controls.js','policy-workbench.js'])router.get('/assets/'+file,asset('experience/'+file));
  router.get('/assets/operations.css',asset('ui/operations.css'));
  router.get('/assets/replay-scenarios.js',asset('ui/replay-scenarios.js'));
  const handle=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){res.status(error.status||503).json({error:error.status?error.message:'Operations storage is unavailable. Retry after reconnecting.'});}};
  const read=async name=>{const rows=await ctx.store.query(name);if(!Array.isArray(rows))throw Error('Malformed store response');return rows;};
  router.get('/records',handle(async(req,res)=>{
    const [sources,events,inventory]=await Promise.all(['sources','events','inventory'].map(read));
    const intake=await intakeRecords(ctx.pool,req.oidc?.user?.sub);
    res.json({sources,attempts:intake.attempts,processing:intake.processing,events:[...intake.events,...events.map(e=>({...e,ingestion:'historical-manual-import'}))].sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)).slice(0,200),inventory:inventory.sort((a,b)=>b.observedAt.localeCompare(a.observedAt)).slice(0,30),limits:{events:200,attempts:200,processing:200,snapshots:30},capabilities:{transactionalManualIntake:true,automaticIntake:false,noiseAlgorithm:true,manualEvaluation:true,backgroundEvaluationAvailable:true,telemetryWindows:true,anomalyDetection:false,cloudDiscovery:false,ticketSync:false,manualTicketHandoff:true,automaticTicketSync:false}});
  }));
  router.post('/sources',handle(async(req,res)=>{const record=sourceDefinition(req.body);await ctx.store.put('sources',record.id,record);res.status(201).json(record);}));
  router.post('/events',handle(async(req,res)=>{
    bounded(req.body);
    const source=(await read('sources')).find(s=>s.id===req.body.sourceId);if(!source)fail('Choose one of your saved source revisions.',404);
    const admitted=await admit(ctx.pool,req.oidc?.user?.sub,source,req.body.event);
    res.status(admitted.status).json({...admitted.record,retry:admitted.retry,attempt:admitted.attempt,...(admitted.status===409?{error:admitted.attempt.reasons[0]}:{})});
  }));
  router.post('/events/batch',handle(async(req,res)=>{
    bounded(req.body);const entries=req.body?.events;
    if(!Array.isArray(entries)||!entries.length||entries.length>20||entries.some(e=>!e||!e.event||typeof e.event!=='object'||Array.isArray(e.event)))fail('Submit 1–20 source-bound alert objects.');
    const saved=new Map((await read('sources')).map(s=>[s.id,s]));
    if(entries.some(e=>!saved.has(e.sourceId)))fail('A source revision is unavailable in your account.',404);
    const results=[];for(const entry of entries){
      try{const result=await admit(ctx.pool,req.oidc?.user?.sub,saved.get(entry.sourceId),entry.event);results.push({...result.record,status:result.status,retry:result.retry,...(result.status===409?{error:'Event ID conflicts with its original content.'}:{})});}
      catch(error){results.push({status:error.status||503,error:error.status?error.message:'Delivery outcome is unconfirmed. Retry this exact event to reconcile.'});}
    }
    res.status(results.some(r=>r.status>=400)?207:200).json({results,atomicity:'per-delivery'});
  }));
  router.post('/inventory',handle(async(req,res)=>{const record=inventorySnapshot(req.body);await ctx.store.put('inventory',record.id,record);res.status(201).json(record);}));
  router.get('/topology',handle(async(req,res)=>res.json(await readGraph(ctx.pool,req.oidc?.user?.sub,req.query.at||undefined,req.query.collectionId||null))));
  router.post('/topology/scans',handle(async(req,res)=>{
    const source=(await read('sources')).find(s=>s.id===req.body?.sourceId);if(!source)fail('Choose one of your saved source revisions.',404);
    const result=await saveScan(ctx.pool,req.oidc?.user?.sub,source,req.body.scan);res.status(result.status).json(result);
  }));
  router.post('/topology/correlate',handle(async(req,res)=>res.json(await correlateDeliveries(ctx.pool,req.oidc?.user?.sub,req.body))));
  const engine=detectionEngine(ctx);
  router.get('/replays',handle(async(req,res)=>res.json({runs:(await read('replays')).sort((a,b)=>b.completedAt.localeCompare(a.completedAt)).slice(0,10),limit:10})));
  router.post('/replays',handle(async(req,res)=>res.json(await completeReplay(ctx,req.oidc?.user?.sub,req.body))));
  router.get('/telemetry',handle(async(req,res)=>res.json(await streamRecords(ctx.pool,req.oidc?.user?.sub))));
  router.post('/telemetry/configure',handle(async(req,res)=>{
    const source=(await read('sources')).find(s=>s.id===req.body?.sourceId);if(!source)fail('Choose one of your saved source revisions.',404);
    res.json(await configureStream(ctx.pool,req.oidc?.user?.sub,source,req.body.config,req.body.expectedRevision));
  }));
  for(const [suffix,format] of [['v1/logs','otlp-logs'],['v1/metrics','otlp-metrics'],['cloudwatch','cloudwatch']])router.post('/streams/:sourceId/'+suffix,handle(async(req,res)=>{
    const source=(await read('sources')).find(s=>s.id===req.params.sourceId);if(!source)fail('This source revision is unavailable to your account.',404);
    const result=await ingestTelemetry(ctx.pool,req.oidc?.user?.sub,source,format,req.body);
    // Valid OTLP/HTTP success is an empty Export response; detailed admission is available for CloudWatch/replay.
    res.status(200).json(format==='cloudwatch'?result:{});
  }));
  router.post('/telemetry/window',handle(async(req,res)=>{
    const source=(await read('sources')).find(s=>s.id===req.body?.sourceId);if(!source)fail('Choose one of your saved source revisions.',404);
    res.json(await telemetryWindow(ctx.pool,req.oidc?.user?.sub,source.id,req.body.resource,req.body.at));
  }));
  router.post('/telemetry/pin',handle(async(req,res)=>res.json(await pinTelemetryEvidence(ctx.pool,req.oidc?.user?.sub,req.body?.workId))));
  router.get('/pipeline/processing',handle(async(req,res)=>res.json(await processingRecords(ctx.pool,req.oidc?.user?.sub))));
  router.post('/pipeline/processing-config',handle(async(req,res)=>res.json(await saveProcessingConfig(ctx.pool,req.oidc?.user?.sub,req.body,(await read('sources')).map(s=>s.id)))));
  router.post('/pipeline/process',handle(async(req,res)=>{const result=await processPending(ctx.pool,engine,req.oidc?.user?.sub),evidence=await capturePendingEvidence(ctx.pool,req.oidc?.user?.sub),failed=result.failed+evidence.failed;res.status(failed?503:200).json({...result,evidence,...(failed?{error:failed+' processing or capture attempts need attention; refresh processing status.'}:{})});}));
  router.post('/pipeline/retry',handle(async(req,res)=>res.json(await retryProcessing(ctx.pool,req.oidc?.user?.sub,req.body?.deliveryId))));
  router.get('/ticket-sync',handle(async(req,res)=>res.json(await syncRecords(ctx,req.oidc?.user?.sub))));
  router.post('/ticket-sync/links',handle(async(req,res)=>res.json(await saveSyncLink(ctx,req.oidc?.user?.sub,req.body))));
  router.post('/ticket-sync/reserve',handle(async(req,res)=>res.json(await reserveSync(ctx,req.oidc?.user?.sub,req.body))));
  router.post('/ticket-sync/report',handle(async(req,res)=>res.json(await reportSync(ctx,req.oidc?.user?.sub,req.body))));
  router.get('/investigations',handle(async(req,res)=>res.json(await investigationRecords(ctx,req.oidc?.user?.sub))));
  router.post('/investigations',handle(async(req,res)=>res.json(await prepareInvestigation(ctx,req.oidc?.user?.sub,req.body?.workId))));
  router.get('/pipeline',handle(async(req,res)=>res.json(await pipelineRecords(ctx.pool,req.oidc?.user?.sub))));
  router.get('/pipeline/health',handle(async(req,res)=>res.json(await engine('health',req.oidc?.user?.sub))));
  router.post('/pipeline/policies',handle(async(req,res)=>{
    const source=(await read('sources')).find(s=>s.id===req.body?.sourceId);if(!source)fail('Choose one of your saved source revisions.',404);
    res.json(await publishPolicy(ctx.pool,engine,req.oidc?.user?.sub,source,req.body.policy,req.body.expectedRevision));
  }));
  router.post('/pipeline/policy-preview',handle(async(req,res)=>{
    bounded(req.body);const source=(await read('sources')).find(s=>s.id===req.body?.sourceId);if(!source)fail('Choose one of your saved source revisions.',404);
    res.json(await previewPolicy(ctx.pool,engine,req.oidc?.user?.sub,source,req.body.policy,req.body.deliveryIds));
  }));
  router.post('/pipeline/evaluate',handle(async(req,res)=>{
    const ids=req.body?.deliveryIds;if(!Array.isArray(ids)||!ids.length||ids.length>20||new Set(ids).size!==ids.length)fail('Choose 1–20 distinct recorded deliveries.');
    const results=[];for(const id of ids){try{results.push(await evaluateDelivery(ctx.pool,engine,req.oidc?.user?.sub,id));}catch(error){results.push({deliveryId:id,error:error.status?error.message:'Processing is unavailable.',status:error.status||503});}}
    res.json({results});
  }));
  return router;
}
