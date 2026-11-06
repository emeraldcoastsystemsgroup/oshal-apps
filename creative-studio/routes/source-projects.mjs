/** CHANGE LOG: request-key | maintainer@emeraldcoastsystemsgroup.com | Return a fresh transient contract edit key without changing saved source or retry semantics. */
/** Human and AI source edits share typed operations, exact original authority and immutable SQL revisions.
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Recheck named source permissions and app/actor identity through registered own-only native resource adapters; generation remains separately privileged.
 */
import {createRequire} from 'node:module';
import {SourceProjectStore,exact,uuid,integer,fail,identity} from './vendor/source-project-store.mjs';
import {validate,apply,sourceContract} from './source-model.mjs';
const {Router,json}=createRequire(import.meta.url)('express');
const APP='creative-studio',PREFIX='story_source';
export function registerSourceAuthorization(ctx){
 const port=ctx.authorization;if(typeof port?.registerResource!=='function'||typeof port?.authorize!=='function')throw Error('Source editors require named application authorization.');
 const authorize=({actor,operation,grant})=>actor?.isActive===true&&typeof actor.issuer==='string'&&Boolean(actor.issuer)&&typeof actor.sub==='string'&&Boolean(actor.sub)&&['string','number'].includes(typeof actor.principalId)&&String(actor.principalId)!==''&&Array.isArray(actor.tenantIds)&&actor.tenantIds.length===1&&typeof actor.tenantIds[0]==='string'&&Boolean(actor.tenantIds[0])&&grant?.scope==='own'&&operation?.app===APP&&operation?.tenantId===undefined;
 for(const resource of ['sources','legacy'])port.registerResource(resource,{authorize});
}
export async function authorizeSource(ctx,action,expected){
 if(!['read','create','change','delete'].includes(action))fail(403,'source_permission_denied');
 const current=identity(ctx);if(JSON.stringify(current)!==JSON.stringify(expected))fail(403,'source_actor_changed');
 const authority=await ctx.intent('auth.application',{}),p=authority?.principal;
 if(authority?.app!==APP||!p||String(p.id)!==expected.principalId||p.issuer!==expected.issuer||p.subject!==expected.sub||p.tenant!==expected.tenant||p.state!=='active')fail(403,'source_permission_denied');
 for(const permission of ['app.open','source.read',...(action==='read'?[]:['source.'+action])]){
  if((await ctx.authorization?.authorize?.({permission}))?.allowed!==true)fail(403,'source_permission_denied');
 }
 if(JSON.stringify(identity(ctx))!==JSON.stringify(expected))fail(403,'source_actor_changed');
}
export function sourceStore(ctx){return new SourceProjectStore(ctx,{prefix:PREFIX,authorize:(action,owner)=>authorizeSource(ctx,action,owner),validate,apply});}
function pathBody(req){const body={...req.body};if(body.id!==undefined){if(uuid(body.id)!==uuid(req.params.id))fail(400,'source_path_body_mismatch');delete body.id;}return body;}
export function createSourceProjectRoutes(ctx){registerSourceAuthorization(ctx);const r=Router(),parse=json({limit:'320kb',strict:true});r.use('/source-projects',(_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
 const run=fn=>async(req,res)=>{try{for(const key of ['tenantId','owner','ownerKey','userSub','principalId'])if(req.query?.[key]!==undefined)fail(400,'source_personal_scope_only');await fn(req,res,sourceStore(ctx));}catch(error){res.status(error.status||500).json({error:error.status?error.code||error.message:'source_unavailable'});}};
 r.get('/source-project-editor.mjs',(_req,res)=>res.type('text/javascript').sendFile(createRequire(import.meta.url)('node:path').join(ctx.appPackageDir,'tools/source-project-editor.mjs')));
 r.get('/source-projects',run(async(_q,res,store)=>res.json(await store.list())));
 r.get('/source-projects/contract',run(async(_q,res,store)=>{await store.guard('read');res.json(sourceContract());}));
 r.post('/source-projects',parse,run(async(req,res,store)=>res.status(201).json(await store.create(req.body))));
 r.get('/source-projects/:id',run(async(req,res,store)=>res.json(await store.get(uuid(req.params.id),req.query.revision===undefined?undefined:integer(Number(req.query.revision),1,100)))));
 r.post('/source-projects/:id/edits',parse,run(async(req,res,store)=>res.json(await store.save(uuid(req.params.id),pathBody(req)))));
 r.delete('/source-projects/:id',run(async(req,res,store)=>res.json(await store.remove(uuid(req.params.id)))));
 r.use((error,_req,res,_next)=>res.status(error.status===413?413:400).json({error:error.status===413?'source_body_limit':'source_invalid_json'}));return r;}
