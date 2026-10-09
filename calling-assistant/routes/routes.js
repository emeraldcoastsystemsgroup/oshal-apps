'use strict';
// CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Read native connection metadata through the admitted caller's intent; retain the legacy SQL contract.
// CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Execute native carrier operations through scoped host intents without placing Twilio credentials in the package process.
// CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Require private native signed-callback/worker proof and enqueue durable audio without exporting continuation authority.
// CHANGE LOG: 4 | maintainer@emeraldcoastsystemsgroup.com | Align the settings response with released package version 0.1.7.
const {Router,json,raw} = require('express');
const {join} = require('node:path');
const {CallingService,interpretAudio} = require('./service');
const {Twilio,credentials} = require('./twilio');
const {registerCallingTool} = require('./tool');
const {callbackVerifier} = require('./callback');
const P = require('./policy');
// Existing platform ports: identity, connector ownership, encrypted tokens and voice registry.
const {getValidAccessToken} = require('@/app/routes/connector-account-operations');
const {getUserTenantIds} = require('@/app/routes/connector-tenancy');
const {VoiceService} = require('@/features/voice/services/voice-service');
const {getSTTProviderRegistry} = require('@/features/voice-providers');
const {runWithSystemIdentity,runWithRequestIdentity} = require('@/shared/services/database/request-identity');
function actor(ctx) { const a=ctx.authorization?.currentActor(); if(!a?.isActive || !a.sub || !a.issuer) throw P.fault('signed_in_owner_required',401); return a; }
async function connections(ctx,a) {
  if(ctx.pool.storageModel==='kernel-scoped-documents') {
    const metadata=await ctx.intent('connectors.metadata',{});
    if(!Array.isArray(metadata?.connections)) throw P.fault('connection_inventory_unavailable',503);
    return metadata.connections.filter(c=>c.provider==='twilio' && !c.revoked)
      .map(c=>({id:c.id,label:c.label,scope:c.shared?'shared':'personal'}));
  }
  const tenants=await getUserTenantIds(ctx.pool,a.sub);
  return (await ctx.pool.query(`SELECT connection_id::text AS id,COALESCE(label,account_email,'Twilio account') AS label,
    CASE WHEN tenant_id IS NULL THEN 'personal' ELSE 'shared' END AS scope FROM oshal_connections
    WHERE provider='twilio' AND status='connected' AND ((user_sub=$1 AND tenant_id IS NULL) OR tenant_id=ANY($2::uuid[])) ORDER BY created_at`,[a.sub,tenants])).rows;
}
async function carrier(ctx,a,id) {
  if(!(await connections(ctx,a)).some(c=>c.id===id)) throw P.fault('connection_unavailable',409);
  if(ctx.pool.storageModel==='kernel-scoped-documents') return nativeCarrier(ctx,id);
  return new Twilio(credentials(await getValidAccessToken(ctx.pool,a.sub,'twilio',{connectionId:id})));
}
/** The native host fixes carrier URLs, checks the selected account and owns all credential material. */
function nativeCarrier(ctx,connectionId) {
  const call=(operation,args={})=>ctx.intent('calling.carrier',{operation,connectionId,...args});
  return {
    numbers:async()=>(await call('numbers')).numbers,
    start:async params=>(await call('start',{params})).sid,
    stop:sid=>call('stop',{sid}),
    audio:async sid=>Buffer.from((await call('audio',{sid})).audio,'base64'),
    deleteAudio:sid=>call('deleteAudio',{sid}),
  };
}
function service(ctx) {
  const voice=new VoiceService();
  const enqueueAudio=ctx.pool.storageModel==='kernel-scoped-documents'
    ? input=>ctx.intent('calling.audio.enqueue',input) : undefined;
  return new CallingService({pool:ctx.pool,carrier:(a,id)=>carrier(ctx,a,id),transcribe:voice.transcribeAudio.bind(voice),enqueueAudio});
}
function handle(fn) { return (req,res,next) => Promise.resolve(fn(req,res)).catch(e=>{ if(res.headersSent) return next(e); res.status(e.status||503).json({error:e.code||'calling_service_unavailable'}); }); }
function writeGuard(req,res,next) {
  if(!['POST','PUT','DELETE'].includes(req.method)) return next();
  if(req.get('origin')!==`${req.protocol}://${req.get('host')}` || req.get('x-oshal-calling')!=='1' || req.get('sec-fetch-site')==='cross-site') return res.status(403).json({error:'same_origin_action_required'});
  next();
}
function createCallingRoutes(ctx) {
  const router=Router(), calls=service(ctx), dir=ctx.appPackageDir;
  ctx.authorization.registerResource('calling',{authorize:async({actor:a})=>a.isActive});
  registerCallingTool(ctx,calls);
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();});
  router.get('/app',(_req,res)=>res.sendFile(join(dir,'ui/index.html')));
  router.get('/client.js',(_req,res)=>res.sendFile(join(dir,'ui/client.js')));
  router.get('/config',handle(async(_req,res)=>{
    const a=actor(ctx), config=await calls.settings(a), available=await connections(ctx,a), registry=getSTTProviderRegistry();
    const providers=await Promise.all(['local-stt','google-cloud-stt','gemini-stt'].map(async id=>({id,...(await registry.get(id)?.getStatus() ?? {configured:false})})));
    res.json({config,connections:available,providers,configurationScope:'person',executionScope:'delegated-owner',
      effectiveEnabled:config.enabled && available.some(c=>c.id===config.connectionId),callbacksPath:'/api/calling-callbacks',version:'0.1.7'});
  }));
  router.get('/numbers',handle(async(req,res)=>{ if(!P.connectionId(req.query.connectionId)) throw P.fault('select_connection'); res.json({numbers:await(await carrier(ctx,actor(ctx),req.query.connectionId)).numbers()}); }));
  // The caller's own runs, plus the ADR-145 home summary (tiles, items) the manifest's `summary:` points a shell at: the same read, one more shape, no write.
  router.get('/tasks',handle(async(_req,res)=>{
    const a=actor(ctx);
    const [config,available,runs]=await Promise.all([calls.settings(a),connections(ctx,a),ctx.pool.query('SELECT id,status,outcome,created_at FROM calling_runs WHERE owner_sub=$1 AND owner_issuer=$2 ORDER BY created_at DESC LIMIT 50',[a.sub,a.issuer])]);
    res.json({tasks:runs.rows,...P.summary(config,available,runs.rows)});
  }));
  router.get('/tasks/:id',handle(async(req,res)=>res.json(await calls.report(actor(ctx),req.params.id))));
  router.use(writeGuard);
  router.put('/config',json({limit:'20kb'}),handle(async(req,res)=>{
    const a=actor(ctx), c=P.config(req.body);
    if(c.connectionId && !(await connections(ctx,a)).some(x=>x.id===c.connectionId)) throw P.fault('connection_unavailable',409);
    if(c.enabled) {
      if(!(await (await carrier(ctx,a,c.connectionId)).numbers()).some(n=>n.number===c.from)) throw P.fault('selected_sender_unavailable',409);
      const provider=getSTTProviderRegistry().get(c.sttProvider);
      if(!(await provider?.getStatus())?.configured) throw P.fault('speech_provider_unavailable',409);
    }
    res.json({config:await calls.save(a,c)});
  }));
  router.post('/tasks',json({limit:'20kb'}),handle(async(req,res)=>res.status(202).json(await calls.start(actor(ctx),req.body))));
  router.post('/tasks/:id/cancel',handle(async(req,res)=>res.json(await calls.cancel(actor(ctx),req.params.id))));
  router.post('/audio-test',raw({type:'audio/wav',limit:'4mb'}),handle(async(req,res)=>{
    const c=await calls.settings(actor(ctx));
    const task={keywords:['claims','existing claim'],responses:[{prompt:'say claims',say:'claims'}]};
    const result=await interpretAudio(req.body,task,c,calls.transcribe);
    res.json({...result,transport:'uploaded_audio',liveCall:false});
  }));
  return router;
}
/** The loader calls this before ordinary user authorization, then refreshes the returned owner. */
function createCallingCallbackVerifier(ctx) {
  if(ctx.pool.storageModel==='kernel-scoped-documents') return async()=>{throw P.fault('native_callback_entry_required',403);};
  return callbackVerifier({
    findRun:id=>runWithSystemIdentity(async()=>(await ctx.pool.query('SELECT owner_sub,owner_issuer,config,call_sid FROM calling_runs WHERE id=$1',[id])).rows[0]),
    carrier:(a,id)=>carrier(ctx,a,id),
    asOwner:(a,fn)=>runWithRequestIdentity({sub:a.sub,principalIssuer:a.issuer,isOperator:false},fn),
  });
}
function createCallingCallbackRoutes(ctx) {
  const router=Router(), calls=service(ctx);
  router.post('/run/:id/:action/:turn',handle(async(req,res)=>{
    if(ctx.pool.storageModel==='kernel-scoped-documents') {
      await ctx.intent('calling.callback.verify',{id:req.params.id,action:req.params.action,turn:Number(req.params.turn),body:req.body});
    }
    const result=await calls.callback(actor(ctx),req.params.id,req.params.action,Number(req.params.turn),req.body);
    res.type('text/xml').send(result);
  }));
  if(ctx.pool.storageModel==='kernel-scoped-documents') router.post('/work/:id/:turn',handle(async(req,res)=>{
    const work=await ctx.intent('calling.audio.work',{id:req.params.id,turn:Number(req.params.turn)});
    await calls.workAudio(actor(ctx),req.params.id,Number(req.params.turn),work.recordingSid);
    res.json({processed:true});
  }));
  return router;
}
module.exports={createCallingRoutes,createCallingCallbackRoutes,createCallingCallbackVerifier};
