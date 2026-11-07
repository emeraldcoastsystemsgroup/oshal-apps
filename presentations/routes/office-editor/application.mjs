/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve structured Office editing through original-person routes shared by browser and approval-held assistant operations.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 2.19.0: serve design.mjs, the editor's design-standard layer (app row, bottom bar, sheets and menus), from the same fixed asset list under the same view permission.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 2.20.0 (RP-OFF-01..07): serve collaboration and find UI modules, expose highlight/comment/tracked-change operations in CONTRACT, and mount sharing and collaborator routes.
 */
import{createRequire}from'node:module';
import{randomUUID}from'node:crypto';
import{resolve}from'node:path';
import{OfficeStore}from'./store.mjs';
import{modelPart,selectedModel}from'./selection.mjs';
import{permissions,access,actor}from'./authorization.mjs';
import{OfficeError,integer,LIMITS}from'../../tools/office/model.mjs';
const require=createRequire(import.meta.url),{Router,json,raw}=require('express');
const cleanBody=req=>{const body={...req.body};if(body.id!==undefined){if(body.id!==req.params.id)throw new OfficeError('office_path_mismatch','The document identity does not match the request.');delete body.id;}return body;};
const jsonBody=json({limit:15500000,strict:true}),fileBody=raw({type:()=>true,limit:10485760});
const ASSETS=new Set(['model.mjs','collab.mjs','operations.mjs','formulas.mjs','controller.mjs','state.mjs','properties.mjs','render.mjs','richtext.mjs','handoffs.mjs','entry-actions.mjs','files.mjs','design.mjs','collab-ui.mjs','find-ui.mjs','office.css']);
const readMiddleware=(middleware,req,res)=>new Promise((done,reject)=>middleware(req,res,error=>error?reject(error):done()));
export const CONTRACT=Object.freeze({
 version:1,modelVersion:1,kinds:['pptx','docx','xlsx'],exportFormats:['pptx','docx','xlsx','pdf','txt','json'],
 units:{pptx:'points',docx:'points',xlsx:'cell addresses; row/column sizes in pixels'},limits:LIMITS,
 operations:['document','add-page','remove-page','move-page','page','add-object','update-object','remove-object','move-object','add-block','update-block','remove-block','move-block','text-range','table-cell','cell','format-range','clear-range','paste-range','add-sheet','move-sheet','remove-sheet','sheet','add-comment','reply-comment','resolve-comment','remove-comment','propose-change','accept-change','reject-change','accept-all-changes','reject-all-changes'],
 styles:{text:['fontFamily','fontSize','bold','italic','underline','color','highlight','align'],shapes:['x','y','width','height','rotation','fill','stroke','strokeWidth','opacity','shadow'],cells:['fontFamily','fontSize','bold','italic','underline','color','align','fill','border','numberFormat']},
 examples:[
  {op:'text-range',page:'actual page ID',id:'actual text ID',start:0,end:5,text:'New words'},
  {op:'text-range',page:'actual page ID',id:'actual text ID',start:0,end:5,style:{highlight:'#fef08a'}},
  {op:'add-comment',comment:{page:'actual page ID',targetId:'actual text ID',start:0,end:5,author:'Reviewer',text:'Check wording'}},
  {op:'propose-change',page:'actual page ID',id:'actual block ID',start:0,end:5,text:'Suggested words',author:'Reviewer'},
  {op:'update-object',page:'actual page ID',id:'actual selected object ID',patch:{fill:'#2563eb',stroke:'#172033',strokeWidth:2}},
  {op:'cell',sheet:'actual sheet ID',from:'B3',value:'=SUM(B1:B2)'}
 ],
 rules:[
  'Read the actual saved document and its current revision before proposing edits.',
  'For PPTX text and Word paragraphs copy the item wholeTextRanges entry from office-read-selection-part and add text. Its exact UTF-16 start/end offsets are authoritative; do not count or guess. Surrounding text and unaffected styles remain intact.',
  'operationsJson is a JSON string containing an array of the listed closed operations. Copy this response requestKey unchanged for a new create or edit. Read a fresh contract for each new action; only an unchanged uncertain retry reuses its prior key.',
  'Use existing stable IDs; never guess an object identity.',
  'One approved batch creates one immutable revision; failed batches save nothing.',
  'Formula calculation supports SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, IF, ABS, ROUND, AND, OR and NOT. Unsupported formulas remain formula text and show an explicit calculation error.',
  'Original imported files remain immutable. Unsupported semantics require reviewed conversion; the exact original can be downloaded separately.'
 ]
});
/** A fresh request identity is supplied as data, so the assistant never has to invent one. */
export function editingContract(){return{...CONTRACT,requestKey:randomUUID()};}
export function createOfficeEditorRoutes(ctx){
 if(typeof ctx.authorization?.registerResource!=='function')throw new Error('office_native_authorization_required');
 ctx.authorization.registerResource('documents',{authorize:({actor,operation,grant})=>actor.isActive===true&&typeof actor.issuer==='string'&&!!actor.issuer&&typeof actor.sub==='string'&&!!actor.sub&&typeof actor.principalId==='string'&&!!actor.principalId&&Array.isArray(actor.tenantIds)&&actor.tenantIds.length===1&&grant.scope==='own'&&!grant.fields&&!operation.tenantId});
 const router=Router(),root=resolve(ctx.appPackageDir,'tools/office');
 function route(method,path,action,work,parse){router[method](path,async(req,res)=>{try{await access(ctx,action);if(parse)await readMiddleware(parse,req,res);await work(req,res,new OfficeStore(ctx));}catch(error){if(res.headersSent)return;const known=error instanceof OfficeError;res.status(known?error.status:error.status===413?413:503).json({error:known?error.code:error.status===413?'office_request_limit':'office_backend_unavailable',message:known?error.message:error.status===413?'This request exceeds the supported byte limit.':'The Office backend could not complete this request. Your draft is retained.'});}});}
 route('get','/app','view',(_req,res)=>{res.setHeader('Cache-Control','no-store');res.sendFile(resolve(root,'editor.html'));});
 route('get','/assets/:name','view',(req,res)=>{if(!ASSETS.has(req.params.name)){res.status(404).json({error:'office_asset_missing'});return;}res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',req.params.name.endsWith('.css')?'text/css':'text/javascript');res.sendFile(resolve(root,req.params.name));});
 route('get','/permissions','view',async(_req,res)=>res.json({permissions:await permissions(ctx),actorSub:actor(ctx).sub}));
 route('get','/editing-contract','view',(_req,res)=>{res.setHeader('Cache-Control','no-store');res.json(editingContract());});
 route('get','/documents','read',async(_req,res,store)=>res.json(await store.list()));
 route('post','/documents','create',async(req,res,store)=>res.status(201).json(await store.create(req.body)),jsonBody);
 route('get','/documents/:id','read',async(req,res,store)=>res.json(await store.read(req.params.id,req.query.revision===undefined?undefined:integer(Number(req.query.revision),1,100))));
 route('get','/documents/:id/model-part','read',async(req,res,store)=>{const result=await store.read(req.params.id,req.query.revision===undefined?undefined:integer(Number(req.query.revision),1,100));res.json(modelPart(result.document,JSON.stringify(result.document.model),req.query.offset));});
 route('get','/documents/:id/selection-part','read',async(req,res,store)=>{if(typeof req.query.selectionJson!=='string'||req.query.selectionJson.length>4096)throw new OfficeError('office_invalid_selection','Provide the exact bounded selection from CURRENT DOCUMENT context.');let selection;try{selection=JSON.parse(req.query.selectionJson);}catch{throw new OfficeError('office_invalid_selection','Provide a valid JSON selection.');}const result=await store.read(req.params.id,integer(Number(req.query.revision),1,100));res.json(modelPart(result.document,JSON.stringify(selectedModel(result.document.model,selection)),req.query.offset));});
 route('post','/documents/:id/revisions','change',async(req,res,store)=>res.status(201).json(await store.save(req.params.id,req.body)),jsonBody);
 route('post','/documents/:id/collaborate','read',async(req,res,store)=>{const body=cleanBody(req);let operations=body.operations;if(body.operationsJson!==undefined){if(typeof body.operationsJson!=='string'||Buffer.byteLength(JSON.stringify(req.body))>16384)throw new OfficeError('office_tool_input_limit','Collaborator edits use a JSON operation array within 16 KiB.');try{operations=JSON.parse(body.operationsJson);}catch{throw new OfficeError('office_invalid_edit','Use a valid JSON array of collaborative operations.');}}res.status(201).json(await store.collaborate(req.params.id,{baseRevision:body.baseRevision,requestKey:body.requestKey,operations,model:body.model}));},jsonBody);
 route('post','/documents/:id/edits','change',async(req,res,store)=>{const body=cleanBody(req);if(typeof body.operationsJson!=='string'||Buffer.byteLength(JSON.stringify(req.body))>16384)throw new OfficeError('office_tool_input_limit','Assistant edits use a JSON operation array within 16 KiB.');let operations;try{operations=JSON.parse(body.operationsJson);}catch{throw new OfficeError('office_invalid_edit','Use a valid JSON array of editing operations.');}res.status(201).json(await store.save(req.params.id,{baseRevision:body.baseRevision,requestKey:body.requestKey,operations}));},jsonBody);
 route('get','/documents/:id/shares','read',async(req,res,store)=>res.json(await store.listShares(req.params.id)));
 route('post','/documents/:id/shares','change',async(req,res,store)=>res.status(201).json(await store.grantShare(req.params.id,cleanBody(req))),jsonBody);
 route('delete','/documents/:id/shares/:shareId','change',async(req,res,store)=>res.json(await store.revokeShare(req.params.id,req.params.shareId)));
 route('delete','/documents/:id','delete',async(req,res,store)=>res.json(await store.remove(req.params.id,integer(req.body?.baseRevision,1,100))),jsonBody);
 route('post','/import/inspect','read',async(req,res,store)=>res.json(await store.inspect(req.body)),fileBody);
 route('post','/import','create',async(req,res,store)=>res.status(201).json(await store.import(req.body)),jsonBody);
 route('get','/documents/:id/original','export',async(req,res,store)=>{const result=await store.original(req.params.id);res.setHeader('Content-Type',result.mime);res.setHeader('Content-Disposition',attachment(result.name));res.setHeader('Cache-Control','private, no-store');res.send(result.bytes);});
 route('get','/documents/:id/revisions/:revision/content','export',async(req,res,store)=>{const result=await store.export(req.params.id,integer(Number(req.params.revision),1,100),req.query.format);res.setHeader('Content-Type',result.mime);res.setHeader('Content-Disposition',attachment(result.name));res.setHeader('Cache-Control','private, no-store');res.send(result.bytes);});
 route('get','/documents/:id/export','export',async(req,res,store)=>{const revision=integer(Number(req.query.revision),1,100),result=await store.export(req.params.id,revision,req.query.format);res.json({status:'ready',id:req.params.id,revision,bytes:result.bytes.length,mime:result.mime,downloadUrl:`/api/presentations/editor/documents/${req.params.id}/revisions/${revision}/content?format=${req.query.format??result.name.split('.').at(-1)}`});});
 return router;
}
function attachment(name){return'attachment; filename="'+String(name).replace(/[^A-Za-z0-9_. -]/g,'_').slice(0,180)+'"';}
