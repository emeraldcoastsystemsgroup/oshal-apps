/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Mount the shared manual/agent motion API with original-actor admission, real engine previews and optimistic immutable edits.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Report the checked temporary native raster capacity with an honest 413 before accepted bytes can poison the asset collection.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Serve a complete compact agent contract and exact command schemas within observation bounds.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Return bounded original-owner receipts and complete immutable-revision inspection pages to agents.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Forward bounded engine failure/retry detail and administrator-only setup guidance after fresh route admission.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Import and fork editable native documents with original read-plus-create checks and revision-pinned copy intent.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Preserve exact native numeric text and original authority across the updated transport.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Use only trusted package lasting storage for original-person durable photos; refuse unavailable native storage honestly.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Bind durable revision bytes only to trusted package lasting storage.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Return bounded plain retry information for private-storage lease contention.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | Allow only trusted portable-import raster input in the compositor validation callback; existing public routes remain unchanged.
 * 12 | maintainer@emeraldcoastsystemsgroup.com | Admit current original-reader effect inventory/schema queries without saved customer edits.
 * 13 | maintainer@emeraldcoastsystemsgroup.com | Read exact native keyframe metadata and revision-pinned exact-tick frames under the original read grant.
 */
import {mountPortableRoutes,binaryChunkParser} from './portable-http.mjs';
import {mountRenderRoutes} from './render-http.mjs';
import {mountValueRoutes} from './value-http.mjs';
import {propertiesObservation} from './properties.mjs';
import {fontIndex,textObservation} from './text.mjs';
import {maskObservation} from './masks.mjs';
import {parseNative,stringifyNative,hasWideInteger,wireProject,decimalId} from '../tools/native-json.mjs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { MotionOwnedBlobs } from './owned-blobs.mjs';
import { MotionProjectStore, MotionError, LIMITS } from './project-store.mjs';
import { bindRequest, access, permissions } from './authorization.mjs';
import { decodeRaster, ownedAssets } from './assets.mjs';
import { motionEngine } from './engine-client.mjs';
import { editingContract, agentContract, commandSchema } from './contract.mjs';
import { effectIndex, effectSchema } from './effects.mjs';
import { projectReceipt, inspectProject, exportReceipt, projectIndex, revisionIndex } from './project-inspection.mjs';
const require=createRequire(import.meta.url);
const {Router,json}=require('express'),multer=require('multer');
const parse=json({limit:LIMITS.documentBytes+65536,strict:true});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:LIMITS.imageBytes,files:1,fields:0}}).single('file');
const documentUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:LIMITS.documentBytes*2,files:1,fields:3,fieldSize:1024,parts:4}}).single('document');
const id=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)?value.toLowerCase():(()=>{throw new MotionError(400,'motion_invalid_id');})();
function nativeId(value){try{return decimalId(value);}catch{throw new MotionError(400,'motion_invalid_native_id');}}
function signedTick(value){if(typeof value!=='string'||!/^(-?(?:0|[1-9][0-9]{0,18}))$/.test(value)||value==='-0'||BigInt(value)<-9223372036854775808n||BigInt(value)>9223372036854775807n)throw new MotionError(400,'motion_invalid_keyframe_tick');return value;}
function unsafeNumber(value){return typeof value==='number'&&Number.isInteger(value)&&!Number.isSafeInteger(value)||value&&typeof value==='object'&&Object.values(value).some(unsafeNumber);}
function fields(value,allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw new MotionError(400,'motion_invalid_input');}
function number(value,min,max,integer=false){if(!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))throw new MotionError(400,'motion_invalid_input');return value;}
const middleware=(fn,req,res)=>new Promise((done,reject)=>fn(req,res,error=>error?reject(error):done()));
function personal(req){if(Object.keys(req.query??{}).some(key=>/owner|tenant|issuer|subject/i.test(key))||req.headers?.['x-oshal-tenant-id']||req.headers?.['x-tenant-id'])throw new MotionError(400,'motion_personal_scope_only');}
function receiptMode(body){if(body.response!==undefined&&body.response!=='receipt')throw new MotionError(400,'motion_invalid_response');return body.response==='receipt';}
function projectReply(project,receipt,results){return receipt?{project:projectReceipt(project)}:{project,...(results!==undefined?{results}: {})};}
function pathBody(req,body){if(body.id!==undefined&&id(body.id)!==id(req.params.id))throw new MotionError(400,'motion_id_mismatch');}
function contextStore(ctx){let store;store=new MotionProjectStore(ctx,{revisionBlobs:process.env.OSHAL_PACKAGE_DATA_DIR?new MotionOwnedBlobs(ctx,process.env.OSHAL_PACKAGE_DATA_DIR,{purpose:'revision'}):undefined,blobs:process.env.OSHAL_PACKAGE_DATA_DIR?new MotionOwnedBlobs(ctx,process.env.OSHAL_PACKAGE_DATA_DIR):undefined,decodeRaster,validateDocument:async (document,incoming)=>(await motionEngine(ctx,{op:'inspect',document,assets:incoming??await ownedAssets(document,store)})).document});return store;}

/** The package factory has no owner argument or custom HTTP/engine authority transport. */
export function createMotionRoutes(ctx){
  if(!ctx?.authorization?.registerResource)throw new Error('motion_application_authorization_required');
  ctx.authorization.registerResource('projects',{authorize:async({actor,operation,grant})=>actor.isActive&&!!actor.issuer&&!!actor.sub&&grant.scope==='own'&&!operation.tenantId});
  const router=Router(),root=ctx.appPackageDir||resolve(import.meta.dirname,'..');
  const run=(action,work,body=false)=>async(req,res)=>{
    let bound;
    try{personal(req);bound=bindRequest(ctx);await access(bound,action);if(body)await middleware(body==='upload'?upload:body==='document'?documentUpload:body==='binary'?binaryChunkParser:parse,req,res);
      const store=contextStore(bound),result=await work(req,store,bound);await access(bound,action);
      res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
      if(result?.send){await result.send(res);return;}const output=result?.project?{...result,project:wireProject(result.project)}:result;
      if(hasWideInteger(output))res.type('application/json').send(stringifyNative(output));else res.json(output);
    }catch(error){if(bound)try{await access(bound,action);}catch(denial){error=denial;}
      if(res.headersSent)return;
      if(error.code==='LIMIT_FILE_SIZE')error=new MotionError(413,body==='document'?'motion_document_limit':'motion_image_limit');
      else if(typeof error.code==='string'&&error.code.startsWith('LIMIT_'))error=new MotionError(400,'motion_invalid_upload');
      else if(error.type==='entity.parse.failed')error=new MotionError(400,'motion_invalid_json');
      else if(error.type==='entity.too.large')error=new MotionError(413,body==='binary'?'motion_transfer_chunk_limit':'motion_document_limit');
      const busy=error instanceof MotionError&&['motion_storage_busy','motion_transfer_busy'].includes(error.code)?{detail:'Your project storage is busy. Retry shortly.',retryAfterMs:error.retryAfterMs}:{};
      const storage=error instanceof MotionError&&['motion_blob_storage_unavailable','motion_revision_storage_unavailable','motion_transfer_storage_unavailable'].includes(error.code)?{detail:'Durable project storage is unavailable. An administrator must configure this package’s private lasting storage.'}:{};
      const setup=error instanceof MotionError&&['motion_native_engine_unavailable','motion_engine_source_mismatch','motion_engine_invalid_response','motion_engine_busy','motion_engine_timeout','motion_engine_failed'].includes(error.code)?{detail:error.detail,...error.engineSetup}:{};
      res.status(error.status||503).json({error:error.code||'motion_service_unavailable',...storage,...setup,...busy});
    }
  };
  router.get('/app',run('view',async()=>({send:res=>res.type('html').sendFile(resolve(root,'tools/workbench.html'))})));
  for(const file of ['workbench.mjs','workbench.css','native-json.mjs','bundle-client.mjs','sha256-stream.mjs','value-patch.mjs','render-client.mjs'])router.get('/ui/'+file,run('view',async()=>({send:res=>res.type(file.endsWith('.css')?'text/css':'text/javascript').sendFile(resolve(root,'tools',file))})));
  mountPortableRoutes(router,run);
  mountValueRoutes(router,run);
  mountRenderRoutes(router,run,ctx,contextStore);
  router.get('/permissions',run('view',async(_req,_store,bound)=>({permissions:await permissions(bound)})));
  router.get('/editing-contract',run('view',async(_req,_store,bound)=>editingContract(bound)));
  router.get('/agent-contract',run('view',async(_req,_store,bound)=>agentContract(bound)));
  router.get('/command-schema/:command',run('view',async(req,_store,bound)=>commandSchema(bound,req.params.command)));
  router.get('/font-index/:stamp/:offset',run('view',async(req,_store,bound)=>fontIndex(bound,req.params.stamp,req.params.offset)));
  router.get('/effect-index/:stamp/:offset',run('view',async(req,_store,bound)=>effectIndex(bound,req.params.stamp,req.params.offset)));
  router.get('/effect-schema/:effect',run('view',async(req,_store,bound)=>effectSchema(bound,req.params.effect)));
  router.get('/project-index/:stamp/:offset',run('read',async(req,store)=>projectIndex(await store.list(),req.params.stamp,number(Number(req.params.offset),0,LIMITS.projects,true))));
  router.get('/projects/:id/revision-index/:revision/:offset',run('read',async(req,store)=>revisionIndex(await store.revisions(id(req.params.id)),number(Number(req.params.revision),1,LIMITS.revisions,true),number(Number(req.params.offset),0,LIMITS.revisions,true))));
  router.get('/projects',run('read',async(_req,store)=>({projects:await store.list()})));
  router.get('/home-summary',run('read',async(_req,store)=>{const projects=await store.list();return{items:projects.slice(0,6).map(p=>({text:p.title,detail:'Motion composition · revision '+p.revision,actions:[{tool:'motion-studio-editor',query:'project='+p.id}]})),metrics:[{label:'Compositions',value:String(projects.length)}]};}));
  router.get('/projects/:id/receipt',run('read',async(req,store)=>({project:projectReceipt(await store.get(id(req.params.id)))})));
  router.get('/projects/:id/revisions/:revision/receipt',run('read',async(req,store)=>({project:projectReceipt(await store.get(id(req.params.id),number(Number(req.params.revision),1,LIMITS.revisions,true)))})));
  router.get('/projects/:id/inspection/:revision/:part/:node/:offset',run('read',async(req,store)=>inspectProject(await store.get(id(req.params.id),number(Number(req.params.revision),1,LIMITS.revisions,true)),{part:req.params.part,node:req.params.node,offset:number(Number(req.params.offset),0,Number.MAX_SAFE_INTEGER,true)})));
  router.get('/projects/:id/export-receipt',run('export',async(req,store)=>exportReceipt(await store.export(id(req.params.id)))));
  router.get('/projects/:id/revisions/:revision/export',run('export',async(req,store)=>{const project=await store.export(id(req.params.id),number(Number(req.params.revision),1,LIMITS.revisions,true));return{send:res=>res.type('application/json').setHeader('Content-Disposition','attachment; filename="composition.ecproj"').send(stringifyNative(project.document))};}));
  router.get('/projects/:id',run('read',async(req,store)=>({project:await store.get(id(req.params.id))})));
  router.get('/projects/:id/revisions',run('read',async(req,store)=>({revisions:await store.revisions(id(req.params.id))})));
  router.get('/projects/:id/revisions/:revision',run('read',async(req,store)=>({project:await store.get(id(req.params.id),number(Number(req.params.revision),1,LIMITS.revisions,true))})));
  router.post('/projects',run('create',async(req,store,bound)=>{
    const body=req.body;fields(body,['title','width','height','frameRate','duration','requestKey','response']);const receipt=receiptMode(body);id(body.requestKey);
    const width=number(body.width,1,8192,true),height=number(body.height,1,8192,true);if(width*height>LIMITS.pixels)throw new MotionError(413,'motion_canvas_limit');
    const blank=await motionEngine(bound,{op:'create'}),created=await motionEngine(bound,{op:'edit',document:blank.document,commands:[{command:'comp.new',params:{name:body.title,width,height,frameRate:number(body.frameRate,0.000001,1000),duration:number(body.duration,0.000001,86400)}}]});
    return projectReply(await store.create({title:body.title,document:created.document,requestKey:body.requestKey}),receipt);
  },true));
  router.post('/projects/import',run('copy',async(req,store)=>{
    const body=req.body;fields(body,['title','requestKey','response']);id(body.requestKey);const receipt=receiptMode(body);
    if(!req.file?.buffer)throw new MotionError(400,'motion_document_required');
    let document;try{document=parseNative(new TextDecoder('utf-8',{fatal:true}).decode(req.file.buffer));}catch{throw new MotionError(400,'motion_invalid_document');}
    const sourceTag='file:'+createHash('sha256').update(req.file.buffer).digest('hex');
    return projectReply(await store.copy({title:body.title,document,requestKey:body.requestKey},sourceTag),receipt);
  },'document'));
  router.post('/projects/:id/fork',run('copy',async(req,store)=>{
    const body=req.body;fields(body,['id','revision','title','requestKey','response']);pathBody(req,body);id(body.requestKey);const receipt=receiptMode(body);
    const sourceId=id(req.params.id),sourceRevision=number(body.revision,1,LIMITS.revisions,true),sourceTag='fork:'+sourceId+'@'+sourceRevision;
    const replay=await store.copyReplay(body.requestKey,sourceTag,body.title);if(replay)return projectReply(replay,receipt);
    const source=await store.get(sourceId,sourceRevision);
    return projectReply(await store.copy({title:body.title??(source.title.slice(0,155)+' copy'),document:source.document,assets:source.assets,requestKey:body.requestKey},sourceTag),receipt);
  },true));
  router.post('/projects/:id/revisions',run('change',async(req,store)=>{const body=req.body;fields(body,['id','title','document','baseRevision','requestKey']);pathBody(req,body);const{ id:_id,...input}=body;return{project:await store.save(id(req.params.id),input)};},true));
  router.post('/projects/:id/operations',run('change',async(req,store,bound)=>{
    const body=req.body;fields(body,['id','title','baseRevision','requestKey','commands','commandsJson','comp','compId','response']);const receipt=receiptMode(body);pathBody(req,body);id(body.requestKey);number(body.baseRevision,1,LIMITS.revisions,true);
    if((body.commands===undefined)===(body.commandsJson===undefined)||body.comp!==undefined&&body.compId!==undefined)throw new MotionError(400,'motion_invalid_input');
    let commands;try{commands=body.commandsJson!==undefined?(typeof body.commandsJson==='string'&&Buffer.byteLength(body.commandsJson)<=65536?parseNative(body.commandsJson):null):body.commands;}catch{throw new MotionError(400,'motion_invalid_commands');}
    if(!Array.isArray(commands)||!commands.length||commands.length>32||Buffer.byteLength(stringifyNative(commands))>65536)throw new MotionError(413,'motion_command_limit');
    if(body.commandsJson===undefined&&unsafeNumber(commands)||body.comp!==undefined&&unsafeNumber(body.comp))throw new MotionError(400,'motion_exact_commands_required');
    const base=await store.get(id(req.params.id),body.baseRevision);
    const extras=commands.filter(c=>c?.command==='asset.import').map(c=>id(c.params?.assetId));
    const result=await motionEngine(bound,{op:'edit',document:base.document,assets:await ownedAssets(base.document,store,extras),commands,...(body.compId!==undefined?{comp:nativeId(body.compId)}:body.comp!==undefined?{comp:body.comp}:{})});
    return projectReply(await store.save(base.id,{title:body.title??base.title,document:result.document,baseRevision:body.baseRevision,requestKey:body.requestKey}),receipt,result.results);
  },true));
  router.post('/projects/:id/effect-values',run('change',async(req,store,bound)=>{
    fields(req.body??{},[]);
    if(!req.file?.buffer||req.file.buffer.length>LIMITS.documentBytes+65536)throw new MotionError(413,'motion_document_limit');
    let body;try{body=parseNative(new TextDecoder('utf-8',{fatal:true}).decode(req.file.buffer));}catch{throw new MotionError(400,'motion_invalid_input');}
    fields(body,['baseRevision','requestKey','compId','layer','effect','compTimeTicks','changes']);id(body.requestKey);number(body.baseRevision,1,LIMITS.revisions,true);
    if(!Array.isArray(body.changes)||!body.changes.length||body.changes.length>32||Buffer.byteLength(stringifyNative(body.changes))>LIMITS.documentBytes)throw new MotionError(413,'motion_command_limit');
    const base=await store.get(id(req.params.id),body.baseRevision),params={layer:String(nativeId(body.layer)),effect:String(nativeId(body.effect)),compTimeTicks:signedTick(body.compTimeTicks),changes:body.changes};
    const result=await motionEngine(bound,{op:'edit',document:base.document,assets:await ownedAssets(base.document,store),comp:nativeId(body.compId),commands:[{command:'properties.patchAt',params}]});
    return projectReply(await store.save(base.id,{title:base.title,document:result.document,baseRevision:body.baseRevision,requestKey:body.requestKey}),false,result.results);
  },'document'));
  router.post('/projects/:id/restore',run('change',async(req,store)=>{const body=req.body;fields(body,['id','revision','baseRevision','requestKey','response']);const receipt=receiptMode(body);pathBody(req,body);const previous=await store.get(id(req.params.id),number(body.revision,1,LIMITS.revisions,true));return projectReply(await store.save(previous.id,{title:previous.title,document:previous.document,assets:previous.assets,baseRevision:body.baseRevision,requestKey:body.requestKey}),receipt);},true));
  router.delete('/projects/:id',run('delete',async(req,store)=>store.delete(id(req.params.id))));
  router.get('/projects/:id/export',run('export',async(req,store)=>{const project=await store.export(id(req.params.id));return{send:res=>res.type('application/json').setHeader('Content-Disposition','attachment; filename="composition.ecproj"').send(stringifyNative(project.document))};}));
  router.get('/projects/:id/revisions/:revision/preview/:time/:compId/:maxSide/:transparent',run('read',async(req,store,bound)=>{
    if(!['0','1'].includes(req.params.transparent))throw new MotionError(400,'motion_invalid_input');
    const project=await store.get(id(req.params.id),number(Number(req.params.revision),1,LIMITS.revisions,true));
    return motionEngine(bound,{op:'preview',document:project.document,assets:await ownedAssets(project.document,store),...(req.params.compId==='auto'?{}:{comp:nativeId(req.params.compId)}),time:number(Number(req.params.time),0,86400),max_side:number(Number(req.params.maxSide),1,4096,true),transparent:req.params.transparent==='1'});
  }));
  router.get('/projects/:id/revisions/:revision/properties/:compId/:layer/:compTimeTicks',run('read',async(req,store,bound)=>{
    const time=signedTick(req.params.compTimeTicks),project=await store.get(id(req.params.id),number(Number(req.params.revision),1,LIMITS.revisions,true));
    const result=await motionEngine(bound,{op:'edit',document:project.document,assets:await ownedAssets(project.document,store),comp:nativeId(req.params.compId),commands:[{command:'properties.inspectAt',params:{layer:String(nativeId(req.params.layer)),compTimeTicks:time}}]});
    return propertiesObservation(project,result.results?.[0]);
  }));
  router.get('/projects/:id/revisions/:revision/effects/:compId/:layer/:effect/:compTimeTicks',run('read',async(req,store,bound)=>{
    const time=signedTick(req.params.compTimeTicks),project=await store.get(id(req.params.id),number(Number(req.params.revision),1,LIMITS.revisions,true));
    const result=await motionEngine(bound,{op:'edit',document:project.document,assets:await ownedAssets(project.document,store),comp:nativeId(req.params.compId),commands:[{command:'properties.inspectAt',params:{layer:String(nativeId(req.params.layer)),effect:String(nativeId(req.params.effect)),compTimeTicks:time}}]});
    return propertiesObservation(project,result.results?.[0]);
  }));
  router.get('/projects/:id/revisions/:revision/effects/:compId/:layer/:effect/:compTimeTicks/full',run('read',async(req,store,bound)=>{
    const time=signedTick(req.params.compTimeTicks),project=await store.get(id(req.params.id),number(Number(req.params.revision),1,LIMITS.revisions,true));
    const result=await motionEngine(bound,{op:'edit',document:project.document,assets:await ownedAssets(project.document,store),comp:nativeId(req.params.compId),commands:[{command:'properties.inspectAt',params:{layer:String(nativeId(req.params.layer)),effect:String(nativeId(req.params.effect)),compTimeTicks:time}}]});
    return propertiesObservation(project,result.results?.[0],{full:true});
  }));
  router.get('/projects/:id/revisions/:revision/effects/:compId/:layer/:effect/:compTimeTicks/values/:prop/:offset',run('read',async(req,store,bound)=>{
    const time=signedTick(req.params.compTimeTicks),project=await store.get(id(req.params.id),number(Number(req.params.revision),1,LIMITS.revisions,true));
    const result=await motionEngine(bound,{op:'edit',document:project.document,assets:await ownedAssets(project.document,store),comp:nativeId(req.params.compId),commands:[{command:'properties.inspectAt',params:{layer:String(nativeId(req.params.layer)),effect:String(nativeId(req.params.effect)),compTimeTicks:time}}]});
    return propertiesObservation(project,result.results?.[0],{prop:String(nativeId(req.params.prop)),offset:number(Number(req.params.offset),0,6*1024*1024,true)});
  }));
  router.get('/projects/:id/revisions/:revision/masks/:compId/:layer/:mask/:compTimeTicks/:detail/:offset',run('read',async(req,store,bound)=>{
    if(!['full','bounded'].includes(req.params.detail))throw new MotionError(400,'motion_invalid_input');
    const time=signedTick(req.params.compTimeTicks);if(BigInt(time)<0n)throw new MotionError(400,'motion_invalid_input');
    const project=await store.get(id(req.params.id),number(Number(req.params.revision),1,LIMITS.revisions,true));
    const result=await motionEngine(bound,{op:'edit',document:project.document,assets:await ownedAssets(project.document,store),comp:nativeId(req.params.compId),commands:[{command:'mask.inspectAt',params:{layer:String(nativeId(req.params.layer)),mask:String(nativeId(req.params.mask)),compTimeTicks:time}}]});
    return maskObservation(project,result.results?.[0],req.params.detail,req.params.offset);
  }));
  router.get('/projects/:id/revisions/:revision/text/:compId/:layer/:compTimeTicks/:detail',run('read',async(req,store,bound)=>{
    if(!['full','bounded'].includes(req.params.detail))throw new MotionError(400,'motion_invalid_input');
    const time=signedTick(req.params.compTimeTicks);if(BigInt(time)<0n)throw new MotionError(400,'motion_invalid_input');
    const project=await store.get(id(req.params.id),number(Number(req.params.revision),1,LIMITS.revisions,true));
    const result=await motionEngine(bound,{op:'edit',document:project.document,assets:await ownedAssets(project.document,store),comp:nativeId(req.params.compId),commands:[{command:'text.inspectAt',params:{layer:String(nativeId(req.params.layer)),compTimeTicks:time}}]});
    return textObservation(project,result.results?.[0],req.params.detail);
  }));
  router.get('/projects/:id/revisions/:revision/keyframes/:compId/:layer/:prop/:timeTicks',run('read',async(req,store,bound)=>{
    const project=await store.get(id(req.params.id),number(Number(req.params.revision),1,LIMITS.revisions,true));
    const references={layer:String(nativeId(req.params.layer)),prop:String(nativeId(req.params.prop)),timeTicks:signedTick(req.params.timeTicks)};
    const result=await motionEngine(bound,{op:'edit',document:project.document,assets:await ownedAssets(project.document,store),comp:BigInt(nativeId(req.params.compId)),commands:[{command:'keys.inspectExact',params:references}]});
    const frame=result.results?.[0];if(!frame?.key)throw new MotionError(503,'motion_keyframe_inspection_failed');
    const valueBytes=Buffer.byteLength(stringifyNative(frame.key.value));
    const metadata={...frame,layer:String(frame.layer),prop:String(frame.prop),layerTimeTicks:String(frame.layerTimeTicks),compTimeTicks:String(frame.compTimeTicks),key:{...frame.key,time:String(frame.key.time)},keyTimeEncoding:'decimal-i64',valueComplete:valueBytes<=32768};
    if(!metadata.valueComplete){delete metadata.key.value;metadata.valueInspection=projectReceipt(project).inspection;metadata.valueBytes=valueBytes;}
    const output={project:projectReceipt(project),keyframe:metadata};if(Buffer.byteLength(stringifyNative(output))>60*1024)throw new MotionError(413,'motion_agent_observation_limit');return output;
  }));
  router.get('/projects/:id/revisions/:revision/preview-ticks/:timeTicks/:compId/:maxSide/:transparent',run('read',async(req,store,bound)=>{
    const time=signedTick(req.params.timeTicks);if(BigInt(time)<0n||!['0','1'].includes(req.params.transparent))throw new MotionError(400,'motion_invalid_input');
    const project=await store.get(id(req.params.id),number(Number(req.params.revision),1,LIMITS.revisions,true));
    return motionEngine(bound,{op:'preview',document:project.document,assets:await ownedAssets(project.document,store),comp:BigInt(nativeId(req.params.compId)),time_ticks:BigInt(time),max_side:number(Number(req.params.maxSide),1,4096,true),transparent:req.params.transparent==='1'});
  }));
  router.post('/preview',run('read',async(req,store,bound)=>{const body=req.body;fields(body,['document','documentJson','comp','compId','time','max_side','transparent']);if(body.documentJson!==undefined){if(body.document!==undefined||typeof body.documentJson!=='string')throw new MotionError(400,'motion_invalid_document');try{body.document=parseNative(body.documentJson);}catch{throw new MotionError(400,'motion_invalid_document');}}if(body.compId!==undefined){if(body.comp!==undefined)throw new MotionError(400,'motion_invalid_input');body.comp=nativeId(body.compId);}delete body.documentJson;delete body.compId;if(!body.document||typeof body.document!=='object'||Array.isArray(body.document))throw new MotionError(400,'motion_invalid_document');return motionEngine(bound,{op:'preview',...body,assets:await ownedAssets(body.document,store)});},true));
  router.get('/assets',run('read',async(_req,store)=>({assets:await store.listAssets()})));
  router.post('/assets',run('upload',async(req,store)=>{if(!req.file?.buffer)throw new MotionError(400,'motion_image_required');return{asset:await store.uploadAsset({bytes:req.file.buffer})};},'upload'));
  router.get('/assets/:id',run('read',async(req,store)=>{const asset=await store.asset(id(req.params.id));return{send:res=>res.type(asset.type).send(asset.bytes)};}));
  router.delete('/assets/:id',run('delete',async(req,store)=>store.deleteAsset(id(req.params.id))));
  return router;
}
