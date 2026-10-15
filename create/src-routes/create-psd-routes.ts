/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Require explicit PSD conversion review, current original-owner grants and immutable-source export authority.
 */
import { AsyncResource } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { json, type Router, type RequestHandler } from 'express';
import multer from 'multer';
import { parsePsd, psdInspection, psdSelection, importPsd, readPsdSource, psdSourceMetadata, PSD_PROFILE } from './create-psd';
import { requireProjectAccess } from './create-project-authorization';
import { exactFields, projectId, type ProjectValidator } from './create-project-validation';
import { ProjectError, type ProjectContext, type ProjectOwner } from './create-project-types';
import type { CreateProjectStore } from './create-project-store';

interface Environment { ctx:ProjectContext;store:CreateProjectStore;validator:Promise<ProjectValidator>;dataRoot:string;
  guards:{personalOnly:(req:import('express').Request)=>void;sendError:(res:import('express').Response,error:unknown)=>void} }
interface Metadata {ref:string;type:string;size:number;sha256:string}
let activeRequests=0;
const admissions=new WeakMap<import('express').Request,()=>void>();
const working=new WeakSet<import('express').Request>();
function release(req:import('express').Request):void { admissions.get(req)?.(); }
function complete(req:import('express').Request,res:import('express').Response):void {
  working.delete(req);
  if(!res.socket || res.destroyed || res.writableFinished)release(req);
}
type ArtifactPort={native?:boolean;metadata:(ref:string)=>Promise<unknown>;chunk:(ref:string,offset:number)=>Promise<unknown>};
function artifactPort():ArtifactPort {
  try { return require('@/shared/artifact-exchange') as ArtifactPort; }
  catch { throw new ProjectError(403,'psd_artifact_unavailable'); }
}
const record=(value:unknown):value is Record<string,unknown>=>!!value && typeof value==='object' && !Array.isArray(value);
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function check(env:Environment,owner:ProjectOwner,write:boolean,exporting=false):()=>Promise<void> {
  return async()=>{await requireProjectAccess(env.ctx,'read',owner);if(write)await requireProjectAccess(env.ctx,'create',owner);if(exporting)await requireProjectAccess(env.ctx,'export',owner);};
}
async function artifactMetadata(ref:string):Promise<Metadata> {
  const port=artifactPort();
  if (port.native!==true || !/^art_[a-f0-9]{64}$/.test(ref)) throw new ProjectError(403,'psd_artifact_unavailable');
  let value:unknown;try{value=await port.metadata(ref);}catch{throw new ProjectError(403,'psd_artifact_unavailable');}
  if(!record(value) || value.ref!==ref || !Number.isSafeInteger(value.size) || Number(value.size)<1 || Number(value.size)>PSD_PROFILE.fileBytes
    || typeof value.sha256!=='string' || !/^[a-f0-9]{64}$/.test(value.sha256)
    || typeof value.type!=='string' || !['image/vnd.adobe.photoshop','image/x-photoshop','application/x-photoshop','application/octet-stream'].includes(value.type)) throw new ProjectError(400,'psd_artifact_required');
  return value as unknown as Metadata;
}
async function artifactBytes(ref:string,confirm:()=>Promise<void>):Promise<{bytes:Buffer;confirm:()=>Promise<void>}> {
  const port=artifactPort();
  const meta=await artifactMetadata(ref),parts:Buffer[]=[];let offset=0;
  while(offset<meta.size) {
    await confirm();let value:unknown;try{value=await port.chunk(ref,offset);}catch{throw new ProjectError(403,'psd_artifact_unavailable');}
    if(!record(value) || value.ref!==ref || value.offset!==offset || value.size!==meta.size || typeof value.dataBase64!=='string' || value.dataBase64.length>87384) throw new ProjectError(503,'psd_artifact_invalid');
    const bytes=Buffer.from(value.dataBase64,'base64');if(!bytes.length || bytes.length>65536 || bytes.toString('base64')!==value.dataBase64 || offset+bytes.length>meta.size || value.done!==(offset+bytes.length===meta.size)) throw new ProjectError(503,'psd_artifact_invalid');
    offset+=bytes.length;parts.push(bytes);
  }
  const bytes=Buffer.concat(parts,offset);if(sha(bytes)!==meta.sha256)throw new ProjectError(503,'psd_artifact_invalid');
  const current=async()=>{await confirm();const latest=await artifactMetadata(ref);if(latest.size!==meta.size || latest.type!==meta.type || latest.sha256!==meta.sha256)throw new ProjectError(409,'psd_source_changed');};
  await current();return{bytes,confirm:current};
}
/** All admission precedes decoding; caller-selected identity, scope and extra fields are refused. */
export function registerPsdRoutes(router:Router,env:Environment):void {
  const admit=(write:boolean):RequestHandler=>(req,res,next)=>{
    res.set('Cache-Control','private, no-store');
    if(activeRequests>=2){env.guards.sendError(res,new ProjectError(503,'psd_import_busy'));return;}
    activeRequests++;let released=false;admissions.set(req,()=>{if(!released){released=true;activeRequests--;admissions.delete(req);}});
    // Native transport supplies a fully buffered request without stream events.
    if(typeof req.once==='function')req.once('aborted',()=>{if(!working.has(req))release(req);});
    res.once('finish',()=>{if(!working.has(req))release(req);});
    res.once('close',()=>{if(!working.has(req))release(req);});
    Promise.resolve().then(()=>env.guards.personalOnly(req)).then(()=>requireProjectAccess(env.ctx,'read'))
      .then(owner=>check(env,owner,write)()).then(()=>next()).catch(error=>{release(req);env.guards.sendError(res,error);});
  };
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:PSD_PROFILE.fileBytes,files:1,fields:4,fieldSize:1024,parts:6}}).single('psd');
  const decode:RequestHandler=(req,res,next)=>upload(req,res,AsyncResource.bind(next));
  const jsonBody=json({limit:4096,strict:true});
  for(const write of [false,true]) {
    router.post(write?'/psd-imports':'/psd-inspect',admit(write),decode,(req,res)=>{
      working.add(req);
      void (async()=>{
        exactFields(req.body??{},write?['title','mode','expectedSha256','requestKey']:[]);
        if(!req.file)throw new ProjectError(400,'psd_file_required');
        const owner=await requireProjectAccess(env.ctx,'read'),confirm=check(env,owner,write),bytes=req.file.buffer;
        await confirm();const parsed=await parsePsd(bytes,env.ctx.appPackageDir!);await confirm();
        if(!write){res.json(psdInspection(bytes,parsed));return;}
        const selection=psdSelection(req.body),result=await importPsd(env.store,owner,bytes,parsed,selection,await env.validator,env.ctx.appPackageDir!,env.dataRoot,confirm);
        await confirm();res.status(201).json(result);
      })().catch(error=>env.guards.sendError(res,error)).finally(()=>complete(req,res));
    });
    if(write)router.post('/psd-artifact-imports',admit(true),jsonBody,(req,res)=>{
      working.add(req);
      void (async()=>{
        exactFields(req.body,write?['ref','title','mode','expectedSha256','requestKey']:['ref']);
        if(typeof req.body.ref!=='string')throw new ProjectError(400,'psd_artifact_required');
        const owner=await requireProjectAccess(env.ctx,'read'),source=await artifactBytes(req.body.ref,check(env,owner,write));
        const parsed=await parsePsd(source.bytes,env.ctx.appPackageDir!);await source.confirm();
        if(!write){res.json(psdInspection(source.bytes,parsed));return;}
        const result=await importPsd(env.store,owner,source.bytes,parsed,psdSelection(req.body),await env.validator,env.ctx.appPackageDir!,env.dataRoot,source.confirm);
        await source.confirm();res.status(201).json(result);
      })().catch(error=>env.guards.sendError(res,error)).finally(()=>complete(req,res));
    });
  }
  router.get('/psd-artifacts/:ref/inspect',admit(false),(req,res)=>{
    working.add(req);
    void(async()=>{
      if(Object.keys(req.query).length)throw new ProjectError(400,'invalid_psd_selection');
      const owner=await requireProjectAccess(env.ctx,'read'),source=await artifactBytes(String(req.params.ref),check(env,owner,false));
      const parsed=await parsePsd(source.bytes,env.ctx.appPackageDir!);await source.confirm();res.json(psdInspection(source.bytes,parsed));
    })().catch(error=>env.guards.sendError(res,error)).finally(()=>complete(req,res));
  });
  for(const content of [false,true])router.get(`/projects/:id/${content?'psd-original':'psd-source'}`,admit(false),(req,res)=>{
    working.add(req);
    void(async()=>{
      const owner=await requireProjectAccess(env.ctx,'read'),confirm=check(env,owner,false,content);await confirm();
      const result=await readPsdSource(env.store,owner,projectId(req.params.id),content,confirm);await confirm();
      if(content)res.set('X-Content-Type-Options','nosniff').set('Content-Disposition','attachment; filename="original.psd"').type('image/vnd.adobe.photoshop').send(result.bytes);
      else res.json({source:psdSourceMetadata(result.source)});
    })().catch(error=>env.guards.sendError(res,error)).finally(()=>complete(req,res));
  });
  // Multer/body-parser failures bypass the work callback; release the reservation
  // here too. Native buffered responses do not emit the socket finish event.
  router.use((error:unknown,req:import('express').Request,_res:import('express').Response,next:import('express').NextFunction)=>{release(req);next(error);});
}
