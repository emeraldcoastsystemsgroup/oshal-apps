/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove real mounted HTTP boundaries and compact supported native tool contracts.
 * Native artifact callbacks below are a named broker unit seam, not a genuine kernel-handle proof.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {requireRuntime} from './fixtures/runtime.mjs';
import {digest,CONTRACT} from '../routes/model.mjs';
const {createPublishingRoutes,artifactBytes}=await import('../routes/application.mjs');
const express=requireRuntime('express'),yaml=requireRuntime('js-yaml');
const root=resolve(import.meta.dirname,'..');
const original=()=>({issuer:'https://fixture.invalid',sub:'original-owner',principalId:'person-alice',tenantIds:['fixture-tenant'],isActive:true});
async function mounted(context,runs){const app=express();app.use('/api/publishing-studio',createPublishingRoutes(context,runs));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));return{url:`http://127.0.0.1:${server.address().port}/api/publishing-studio`,close:()=>new Promise(r=>server.close(r))};}
const request=(url,options={})=>fetch(url,{...options,signal:AbortSignal.timeout(90000)});
function inspection(){const state={actor:original(),denied:new Set(),calls:0,after:undefined};return{state,ctx:{appPackageDir:root,pool:{connect(){throw new Error('inspection must not query SQL');}},intent(){throw new Error('inspection must not execute an engine');},authorization:{registerResource(){},currentActor:()=>state.actor,authorize:async({permission})=>{state.calls++;state.after?.(permission,state.calls);return{allowed:state.actor.isActive&&!state.denied.has(permission)};}}}};}
test('actual authenticated route serves complete current contract and fixed exact UI assets before any SQL',async()=>{
 const {ctx,state}=inspection(),app=await mounted(ctx);
 try{const result=await request(app.url+'/editing-contract');assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'private, no-store');const c=await result.json();assert.deepEqual(c.operations,CONTRACT.operations);assert.deepEqual(Object.keys(c.operationSchemas),CONTRACT.operations);assert.equal(c.agentTransport.field,'operationsJson');assert.equal(c.agentTransport.maxInputBytes,16384);assert.equal(c.operationSchemas['set-link'].properties.nextFrame.type.includes('null'),true);
 const frame=c.operationSchemas['set-frame'].properties.values.properties,page=c.operationSchemas['set-page'].properties.values.properties;for(const [field,min]of Object.entries({x:0,y:0,width:12,height:12}))assert.equal(frame[field].minimum,min,'frame '+field+' actual model minimum');for(const field of ['width','height'])assert.equal(page[field].minimum,72,'page '+field+' actual model minimum');
 for(const [path,file,mime]of [['/app','workbench.html','text/html'],['/ui/workbench.mjs','workbench.mjs','text/javascript'],['/ui/workbench.css','workbench.css','text/css']]){const r=await request(app.url+path);assert.equal(r.status,200,path);assert.match(r.headers.get('content-type'),new RegExp('^'+mime));assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await r.arrayBuffer()),await readFile(resolve(root,'tools',file)));}
 for(const path of ['/editing-contract?owner=foreign','/editing-contract?principalId=foreign','/editing-contract?tenant=foreign'])assert.equal((await request(app.url+path)).status,400);
 assert.equal((await request(app.url+'/editing-contract',{headers:{'x-oshal-tenant-id':'other'}})).status,400);
 assert.equal((await request(app.url+'/ui/constructor')).status,404);assert.equal((await request(app.url+'/ui/worker.py')).status,404);
 state.actor.isActive=false;assert.equal((await request(app.url+'/editing-contract')).status,401);
 }finally{await app.close();}
});
test('original identity and grant are rechecked after contract preparation, not only at route entry',async()=>{
 const first=inspection(),app=await mounted(first.ctx);try{first.state.after=(_permission,count)=>{if(count===2)first.state.denied.add('document.view');};assert.equal((await request(app.url+'/editing-contract')).status,403);}finally{await app.close();}
 const second=inspection(),other=await mounted(second.ctx);try{second.state.after=(_permission,count)=>{if(count===2)second.state.actor={...second.state.actor,principalId:'changed-person'};};assert.equal((await request(other.url+'/editing-contract')).status,401);}finally{await other.close();}
});
test('native artifact unit reader enforces exact bounded chunks, current owner and final whole source SHA',async()=>{
 const data=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(150000,7)]),ref='art_'+'a'.repeat(64),meta={size:data.length,sha256:digest(data),type:'image/png'};let actor=original(),reads=0,mode='okay';
 const ctx={authorization:{currentActor:()=>actor,authorize:async()=>({allowed:true})},intent:async(_name,input)=>{if(input.op==='metadata'){reads++;return{...meta,...(mode==='changed'&&reads===2?{sha256:'0'.repeat(64)}:{})};}const part=data.subarray(input.offset,input.offset+65536);if(mode==='owner')actor={...actor,principalId:'other'};return{ref,offset:input.offset+(mode==='offset'?1:0),size:data.length,dataBase64:mode==='base64'?part.toString('base64')+'!':part.toString('base64'),done:input.offset+part.length===data.length};}};
 assert.deepEqual(await artifactBytes(ctx,ref),{data,mime:'image/png'});
 for(const m of ['changed','offset','base64']){mode=m;reads=0;await assert.rejects(artifactBytes(ctx,ref),/publishing_artifact_(source_changed|chunk_invalid)/);}
 mode='owner';reads=0;await assert.rejects(artifactBytes(ctx,ref),/publishing_identity_changed/);
 actor=original();await assert.rejects(artifactBytes(ctx,'file:///tmp/other'),/publishing_artifact_invalid/);
 await assert.rejects(artifactBytes({...ctx,intent:async()=>({...meta,size:4194305})},ref),/publishing_artifact_unsupported/);
});
test('every offered tool has a supported closed native schema, real route binding and bounded rendered catalogue',async()=>{
 const manifest=yaml.load(await readFile(resolve(root,'oshal-app.yaml'),'utf8')),auth=yaml.load(await readFile(resolve(root,'authorization.yaml'),'utf8'));
 const unsupported=['$ref','$dynamicRef','oneOf','anyOf','allOf','not','if','then','else','pattern','patternProperties','dependentRequired','dependentSchemas','contains','propertyNames','minContains','maxContains','additionalItems','dependencies','contentSchema','unevaluatedProperties','unevaluatedItems','prefixItems','multipleOf','exclusiveMinimum','exclusiveMaximum'];
 function schema(value,depth=0){assert.ok(depth<=24);assert.ok(['object','array','string','integer','number','boolean','null'].includes(value.type));for(const key of unsupported)assert.equal(Object.hasOwn(value,key),false,key);if(value.type==='object')assert.equal(value.additionalProperties,false);for(const child of Object.values(value.properties??{}))schema(child,depth+1);if(value.items)schema(value.items,depth+1);}
 let tokens=0;for(const tool of manifest.tools){schema(tool.inputSchema);assert.ok(Buffer.byteLength(JSON.stringify(tool.inputSchema))<=16384);assert.ok(auth.bindings.tools.some(binding=>binding.id===tool.name));tokens+=Math.max(12,Math.ceil(Buffer.byteLength(`- \`${tool.name}\`: ${tool.description} (schema: ${JSON.stringify(tool.inputSchema)})`)/3));if(!tool.executor.apiEndpoint.startsWith('GET ')){assert.equal(tool.defaultAuthMode,'ask');assert.equal(tool.requiresApproval,true);}}
 assert.ok(tokens<4096,'even all14 footprints fit unchanged token budget; actual count selection remains12');assert.equal(manifest.bots[0].name,'publishing-editor');assert.equal(manifest.bots[0].posture,'inline');assert.equal(manifest.chatBot,'publishing-editor');assert.equal(manifest.ribbon.hideChatPanel,false);
 assert.deepEqual(manifest.tools.slice(0,12).map(t=>t.name).filter(name=>['publishing-editing-contract','publishing-read-document','publishing-read-model-part','publishing-apply-edits','publishing-start-render','publishing-export'].includes(name)),['publishing-editing-contract','publishing-read-document','publishing-read-model-part','publishing-apply-edits','publishing-start-render','publishing-export']);
 const edit=manifest.tools.find(t=>t.name==='publishing-apply-edits');assert.equal(edit.inputSchema.properties.operationsJson.type,'string');assert.equal(Object.hasOwn(edit.inputSchema.properties,'operations'),false);assert.match(edit.description,/contract/);
 for(const permission of ['document.view','document.read','asset.read','job.read'])assert.equal(auth.permissions[permission].effect,'read');assert.equal(auth.permissions['document.export'].effect,'export');assert.ok(!auth.roles.reader.grants.some(g=>['document.export','job.manage','document.render'].includes(g.permission)));assert.deepEqual(auth.bindings.bots[0].allOf,['document.view']);
 const cancel=auth.bindings.tools.find(t=>t.id==='publishing-cancel-render');assert.deepEqual(cancel.allOf,['document.view','document.read','job.manage']);
});

test('versioned fixed UI assets accept only bounded inert cache hints, never identity or data query widening',async()=>{
 const {ctx}=inspection(),app=await mounted(ctx);try{for(const file of ['workbench.mjs','workbench.css']){const response=await request(app.url+'/ui/'+file+'?v=0123456789ab');assert.equal(response.status,200,'actual kernel freshness query must serve fixed bytes');assert.deepEqual(Buffer.from(await response.arrayBuffer()),await readFile(resolve(root,'tools',file)));for(const suffix of ['?v=','?v[]=a','?v=a&v=b','?v='+('a'.repeat(129)),'?v=%3Cscript%3E','?v=0123456789ab&owner=bob','?other=0123456789ab'])assert.equal((await request(app.url+'/ui/'+file+suffix)).status,400,suffix);}assert.equal((await request(app.url+'/editing-contract?v=0123456789ab')).status,400);const document=randomUUID();assert.equal((await request(app.url+'/app?document='+document)).status,200);assert.equal((await request(app.url+'/app?document=not-a-uuid')).status,400);assert.equal((await request(app.url+'/app?document='+document+'&owner=bob')).status,400);}finally{await app.close();}
});
