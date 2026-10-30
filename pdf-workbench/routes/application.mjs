/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Human and held-agent requests share original PDF authority and durable revisions.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Find exact saved field values through the same original-owner read boundary without exhausting model steps.
 */
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {bindRequest,access,permissions} from './authorization.mjs';
import {PdfStore} from './project-store.mjs';
import {findFormFields} from './form-lookup.mjs';
import {engine} from './engine-client.mjs';
import {PdfError,id,integer,exact,fail,LIMITS,CONTRACT,digest,readablePages} from './model.mjs';
const require=createRequire(import.meta.url),{Router,json}=require('express'),multer=require('multer');
const parse=json({limit:600000,strict:true});
const upload=multer({storage:multer.memoryStorage(),limits:{files:1,fileSize:LIMITS.bytes,fields:2,fieldSize:1024,parts:3}}).single('file');
const middleware=(fn,req,res)=>new Promise((done,reject)=>fn(req,res,error=>error?reject(error):done()));
function revision(value){if(value===undefined)return; if(typeof value!=='string'||! /^(?:[1-9][0-9]?|100)$/.test(value))fail(400,'pdf_invalid_revision');return Number(value);}
function closedRequest(req){if(Object.keys(req.query??{}).some(key=>/owner|tenant|issuer|subject/i.test(key))||req.headers?.['x-oshal-tenant-id']||req.headers?.['x-tenant-id'])fail(400,'pdf_personal_scope_only');}
function pathBody(req,param){const value={...req.body};if(value.id!==undefined){if(id(value.id)!==id(req.params[param]))fail(400,'pdf_path_body_mismatch');delete value.id;}return value;}
/** Ordinary native artifact chunks retain the original caller and producer's current source/grants. */
export async function artifactBytes(ctx,ref){
 if(typeof ref!=='string'||! /^art_[a-f0-9]{64}$/.test(ref))fail(400,'pdf_invalid_artifact');
 const meta=await ctx.intent('artifact.exchange',{op:'metadata',ref});if(meta.type!=='application/pdf'||!Number.isSafeInteger(meta.size)||meta.size<5||meta.size>LIMITS.bytes||typeof meta.sha256!=='string'||! /^[a-f0-9]{64}$/.test(meta.sha256))fail(400,'pdf_artifact_unsupported');
 const pieces=[];let offset=0;
 while(offset<meta.size){await access(ctx,'create');const chunk=await ctx.intent('artifact.exchange',{op:'chunk',ref,offset});const data=typeof chunk?.dataBase64==='string'?Buffer.from(chunk.dataBase64,'base64'):Buffer.alloc(0);if(chunk.ref!==ref||chunk.offset!==offset||chunk.size!==meta.size||!data.length||data.length>65536||data.toString('base64')!==chunk.dataBase64||offset+data.length>meta.size||chunk.done!==(offset+data.length===meta.size))fail(503,'pdf_artifact_invalid_chunk');pieces.push(data);offset+=data.length;}
 const data=Buffer.concat(pieces),latest=await ctx.intent('artifact.exchange',{op:'metadata',ref});if(latest.size!==meta.size||latest.sha256!==meta.sha256||latest.type!==meta.type||digest(data)!==meta.sha256)fail(409,'pdf_artifact_source_changed');await access(ctx,'create');return data;
}
export function createPdfRoutes(packageCtx,fixtureRuns){
 if(!packageCtx?.authorization?.registerResource)throw new Error('pdf_native_authorization_required');
 packageCtx.authorization.registerResource('documents',{authorize:({actor,operation,grant})=>actor.isActive&&!!actor.issuer&&!!actor.sub&&grant.scope==='own'&&!grant.fields&&!operation.tenantId});
 const router=Router(),root=packageCtx.appPackageDir??resolve(import.meta.dirname,'..');
 const run=(permission,work,body=false)=>async(req,res)=>{let ctx;try{closedRequest(req);ctx=bindRequest(packageCtx);await access(ctx,permission);if(body)await middleware(body==='upload'?upload:parse,req,res);const result=await work(req,new PdfStore(ctx),ctx);await access(ctx,permission);res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');if(result?.send)await result.send(res);else{const{httpStatus,...value}=result;if(httpStatus)res.status(httpStatus);res.json(value);}}catch(error){if(ctx)try{await access(ctx,permission);}catch(denial){error=denial;}if(res.headersSent)return;const busy=['55P03','40P01','40001'].includes(error.code);res.status(busy?503:error.status??503).json({error:busy?'pdf_storage_busy':error instanceof PdfError?error.code:error.code?.startsWith('LIMIT_')?'pdf_upload_limit':'pdf_service_unavailable',...(busy?{retryAfterMs:100}:{})});}};
 router.get('/app',run('view',async()=>({send:res=>res.type('html').sendFile(resolve(root,'tools/workbench.html'))})));
 for(const file of ['workbench.mjs','workbench.css'])router.get('/ui/'+file,run('view',async()=>({send:res=>res.type(file.endsWith('.css')?'text/css':'text/javascript').sendFile(resolve(root,'tools',file))})));
 router.get('/permissions',run('view',async(_req,_store,ctx)=>({permissions:await permissions(ctx)})));
 router.get('/editing-contract',run('view',async()=>CONTRACT));
 router.get('/home-summary',run('read',async(_req,store)=>{const data=await store.list();return{metrics:[{label:'Owned PDFs',value:data.documents.length}],items:data.documents.slice(0,5).map(d=>({title:d.title,url:'/api/pdf-workbench/app?document='+d.id})),notes:['Source files remain immutable; edits are saved as new PDF revisions.']};}));
 router.get('/sources',run('read',async(req,store)=>{const result=await store.sourceList();return req.query.receipt==='1'?{sources:result.sources.map(({id,title,bytes,sha256,pages,fields})=>({id,title,bytes,sha256,pages:pages.length,fields:fields.length}))}:result;}));
 router.post('/sources/upload',run('create',async(req,store)=>{if(!req.file?.buffer)fail(400,'pdf_file_required');exact(req.body,['title','requestKey']);return store.upload({title:req.body.title??req.file.originalname,data:req.file.buffer,requestKey:req.body.requestKey});},'upload'));
 router.post('/sources/import-artifact',run('create',async(req,store,ctx)=>{exact(req.body,['ref','title','requestKey']);return store.upload({title:req.body.title,data:await artifactBytes(ctx,req.body.ref),requestKey:req.body.requestKey});},true));
 router.delete('/sources/:source',run('delete',(req,store)=>store.removeSource(id(req.params.source))));
 router.get('/documents',run('read',(_req,store)=>store.list()));
 router.post('/documents',run('create',(req,store)=>store.create(req.body),true));
 router.get('/documents/:document',run('read',async(req,store)=>{const result=await store.get(id(req.params.document),revision(req.query.revision));if(req.query.receipt!=='1')return result;const d=result.document;return{document:{id:d.id,title:d.title,revision:d.revision,currentRevision:d.currentRevision,sha256:d.inspection.sha256,bytes:d.inspection.bytes,pages:readablePages(d),annotations:d.model.annotations.length,fieldValues:Object.keys(d.model.fields).length,formFields:d.inspection.fields.length},history:result.history};}));
 router.get('/documents/:document/model/:part/:offset',run('read',async(req,store)=>{const d=(await store.get(id(req.params.document),revision(req.query.revision))).document,part=req.params.part,offset=integer(Number(req.params.offset),0,1000);if(part.startsWith('form-fields:'))return findFormFields(d,{query:part.slice(12),offset:String(offset)});if(req.query.query!==undefined){if(part!=='form-fields')fail(400,'pdf_invalid_field_lookup_part');return findFormFields(d,{query:req.query.query,offset:String(offset)});}const rows=part==='pages'?readablePages(d):part==='annotations'?d.model.annotations:part==='fields'?Object.entries(d.model.fields).map(([name,value])=>({name,value})):part==='form-fields'?d.inspection.fields:null;if(!rows||offset>=rows.length)fail(404,'pdf_model_part_unavailable');return{document:d.id,revision:d.revision,part,offset,total:rows.length,value:rows[offset],nextOffset:offset+1<rows.length?offset+1:null};}));
 router.get('/documents/:document/text',run('read',async(req,store,ctx)=>{const saved=await store.content(id(req.params.document),revision(req.query.revision),'read');return engine(ctx,{op:'text',data:saved.data.toString('base64')});}));
 router.get('/documents/:document/text/:page/:offset',run('read',async(req,store,ctx)=>{const saved=await store.content(id(req.params.document),revision(req.query.revision),'read'),page=integer(Number(req.params.page),0,31),offset=integer(Number(req.params.offset),0,1048576),result=await engine(ctx,{op:'text',data:saved.data.toString('base64')});const found=result.pages[page];if(!found||offset>found.text.length)fail(404,'pdf_text_unavailable');const text=found.text.slice(offset,offset+4096);return{page,offset,text,truncated:found.truncated,totalCodeUnits:found.text.length,nextOffset:offset+text.length<found.text.length?offset+text.length:null};}));
 router.get('/documents/:document/forms/find',run('read',async(req,store)=>findFormFields((await store.get(id(req.params.document),revision(req.query.revision))).document,{query:req.query.query,offset:req.query.offset})));
 router.get('/documents/:document/forms',run('read',async(req,store)=>({fields:(await store.get(id(req.params.document),revision(req.query.revision))).document.inspection.fields})));
 router.get('/documents/:document/pages/:page/preview',run('read',async(req,store,ctx)=>{const saved=await store.content(id(req.params.document),revision(req.query.revision),'read'),page=saved.model.pages.findIndex(p=>p.id===id(req.params.page));if(page<0)fail(404,'pdf_page_unavailable');const preview=await engine(ctx,{op:'preview',data:saved.data.toString('base64'),page,side:1200});const data=Buffer.from(preview.data??'','base64');if(preview.type!=='image/png'||preview.bytes!==data.length||digest(data)!==preview.sha256||data.length>LIMITS.bytes||data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')fail(503,'pdf_preview_invalid');return{send:res=>res.type('image/png').send(data)};}));
 const start=kind=>run(kind==='ocr'?'ocr':'change',async(req,store)=>{
  const result=await store.begin(id(req.params.document),pathBody(req,'document'),kind);
  if(result.created&&!result.replayed){let runs;try{runs=fixtureRuns??require('@/shared/package-runs');await runs.keepRunAlive(result.job.id,300,'engine');}catch{await store.abandon(result.job.id,kind).catch(()=>{});fail(503,'pdf_continuation_unavailable');}
   setImmediate(()=>{void runs.run(result.job.id,async()=>new PdfStore(bindRequest(packageCtx)).produce(result.job.id)).then(()=>runs.runFinished(result.job.id,0),()=>runs.runFinished(result.job.id,1)).catch(()=>{});});
  }return{...result,httpStatus:202};
 },true);
 router.post('/documents/:document/revisions',start('revision'));
 router.post('/documents/:document/ocr',start('ocr'));
 router.get('/jobs/:job',run('job.read',async(req,store)=>{const job=await store.job(id(req.params.job));if(job.kind==='ocr'&&job.result)job.result={...job.result,pages:job.result.pages.map(({id,page,language,quality,confidence,text,words})=>({id,page,language,quality,confidence,textCodeUnits:text.length,words:words.length}))};return{job};}));
 router.get('/jobs/:job/ocr/:page/:offset',run('ocr',async(req,store)=>{const job=await store.job(id(req.params.job),'ocr');if(job.kind!=='ocr'||job.state!=='ready')fail(404,'pdf_ocr_unavailable');const page=integer(Number(req.params.page),0,9),offset=integer(Number(req.params.offset),0,1048576),found=job.result.pages[page];if(!found||offset>found.text.length)fail(404,'pdf_ocr_unavailable');const text=found.text.slice(offset,offset+4096);return{job:job.id,page:found.page,pageId:found.id,language:found.language,quality:found.quality,confidence:found.confidence,offset,text,totalCodeUnits:found.text.length,nextOffset:offset+text.length<found.text.length?offset+text.length:null,originalUnchanged:true};}));
 router.post('/jobs/:job/cancel',run('job.manage',async(req,store)=>{exact(pathBody(req,'job'),[]);return{job:await store.cancel(id(req.params.job))};},true));
 router.get('/documents/:document/revisions/:revision/content',run('export',async(req,store)=>{const saved=await store.content(id(req.params.document),integer(Number(req.params.revision),1,100));return{send:res=>{res.setHeader('Content-Disposition','attachment; filename="document.pdf"');res.type('application/pdf').send(saved.data);}};}));
 router.delete('/documents/:document',run('delete',(req,store)=>store.remove(id(req.params.document))));
 return router;
}
