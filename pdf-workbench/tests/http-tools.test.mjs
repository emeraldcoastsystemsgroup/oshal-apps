/** CHANGE LOG: request-key | maintainer@emeraldcoastsystemsgroup.com | Verify real fresh contract GETs and backend-aligned edit-key assertions. */
/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise original guarded HTTP inspection and native artifact chunk contracts without a pretend renderer.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Bootstrap the genuine pinned toolchain before dynamic application loading, including clean archives.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Verify RP-PDF-01..10 model operations (insert-blank, QuadPoints markup, ink strokeWidth, check/cross) and fail-closed authorization bindings.
 * Named unit seam: artifact metadata/chunks and application grant callbacks. Genuine kernel handle acceptance is separate.
 */
import test from 'node:test';import assert from 'node:assert/strict';import {resolve} from 'node:path';import {randomUUID} from 'node:crypto';
import {apply,initial,digest} from '../routes/model.mjs';
import {requireRuntime} from './fixtures/runtime.mjs';
const require=requireRuntime;
// Application imports its actual mounted Express runtime; fixtures supply only existing runtime dependencies.
const {createPdfRoutes,artifactBytes}=await import('../routes/application.mjs');
const express=require('express');
test('actual contract route rechecks original authority and refuses impersonation inputs',async()=>{
 let active=true;const ctx={appPackageDir:resolve(import.meta.dirname,'..'),pool:{connect:()=>{throw new Error('inspection must not access SQL');}},intent:()=>{throw new Error('inspection must not render');},authorization:{currentActor:()=>({issuer:'fixture',sub:'alice',isActive:active}),authorize:async()=>({allowed:active}),registerResource:()=>{}}};
 const app=express();app.use('/api/pdf-workbench',createPdfRoutes(ctx));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port;
 try{const response=await fetch(url+'/api/pdf-workbench/editing-contract');assert.equal(response.status,200);const contract=await response.json();assert.equal(response.headers.get('cache-control'),'private, no-store');const secondResponse=await fetch(url+'/api/pdf-workbench/editing-contract'),second=await secondResponse.json();assert.notEqual(contract.requestKey,second.requestKey);assert.equal(secondResponse.headers.get('cache-control'),'private, no-store');assert.match(contract.requestKey,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);assert.ok(contract.operations.includes('fill'));assert.ok(contract.unsupported.includes('redaction'));assert.equal((await fetch(url+'/api/pdf-workbench/editing-contract?owner=someone')).status,400);assert.equal((await fetch(url+'/api/pdf-workbench/documents/'+randomUUID()+'/forms/find?query=name&owner=someone')).status,400);active=false;assert.equal((await fetch(url+'/api/pdf-workbench/editing-contract')).status,401);assert.equal((await fetch(url+'/api/pdf-workbench/documents/'+randomUUID()+'/forms/find?query=name')).status,401);}finally{await new Promise(r=>server.close(r));}
});
test('closed native artifact reader verifies every chunk and final source before returning PDF bytes',async()=>{
 const data=Buffer.from('%PDF-1.4\n'+ 'fixture-content'.repeat(6000)),ref='art_'+'a'.repeat(64),meta={size:data.length,sha256:digest(data),type:'application/pdf',name:'Owned.pdf'};let changed=false;
 const ctx={authorization:{currentActor:()=>({issuer:'fixture',sub:'alice',isActive:true}),authorize:async()=>({allowed:true})},intent:async(_name,input)=>input.op==='metadata'?{...meta,...(changed?{sha256:'0'.repeat(64)}:{})}:{ref,offset:input.offset,size:data.length,dataBase64:data.subarray(input.offset,input.offset+65536).toString('base64'),done:input.offset+65536>=data.length}};
 assert.deepEqual(await artifactBytes(ctx,ref),data);
 let reads=0;const changedCtx={...ctx,intent:async(name,input)=>{if(input.op==='metadata'&&++reads===2)changed=true;return ctx.intent(name,input);}};await assert.rejects(artifactBytes(changedCtx,ref),/pdf_artifact_source_changed/);
 await assert.rejects(artifactBytes({...ctx,intent:async()=>{throw new Error('genuine broker refusal');}},ref),/genuine broker refusal/);
});
test('unknown or hidden form edits cannot silently disappear from an operation',()=>{const source={id:randomUUID(),pages:[{index:0}],fields:[]},model=initial(source);assert.throws(()=>apply(model,[{op:'fill',name:'nonexistent',value:'lost'}],[source]),/pdf_field_unsupported/);});
test('every offered PDF input schema uses the actual bounded native schema vocabulary',()=>{
 const fs=require('node:fs'),yaml=require('js-yaml'),manifest=yaml.load(fs.readFileSync(resolve(import.meta.dirname,'../oshal-app.yaml'),'utf8'));
 const refused=['$ref','$dynamicRef','oneOf','anyOf','allOf','not','if','then','else','patternProperties','dependentRequired','dependentSchemas','contains','propertyNames','unevaluatedProperties','unevaluatedItems'];
 function node(schema){assert.ok(['object','array','string','integer','number','boolean','null'].includes(schema.type));for(const key of refused)assert.equal(Object.hasOwn(schema,key),false,key+' is not a supported native tool schema assertion');for(const child of Object.values(schema.properties??{}))node(child);if(schema.items)node(schema.items);}
 for(const tool of manifest.tools)node(tool.inputSchema);
 const write=manifest.tools.filter(t=>t.executor.apiEndpoint.startsWith('POST ')||t.executor.apiEndpoint.startsWith('DELETE '));assert.ok(write.length>=7);for(const tool of write){assert.equal(tool.defaultAuthMode,'ask');assert.equal(tool.requiresApproval,true);}
 const authorization=yaml.load(fs.readFileSync(resolve(import.meta.dirname,'../authorization.yaml'),'utf8'));assert.equal(authorization.permissions['document.job.read'].effect,'read');assert.deepEqual(authorization.bindings.tools.find(t=>t.id==='pdf-read-model-part').allOf,['document.view','document.read']);const lookup=manifest.tools.find(t=>t.name==='pdf-read-model-part');assert.equal(lookup.defaultAuthMode,'auto');assert.equal(lookup.requiresApproval,false);assert.deepEqual(authorization.bindings.tools.find(t=>t.id==='pdf-job-status').allOf,['document.view','document.job.read']);assert.deepEqual(authorization.bindings.bots[0].allOf,['document.view']);for(const role of ['viewer','reader'])assert.ok(!authorization.roles[role].grants.some(g=>g.permission==='document.job.manage'));assert.deepEqual(authorization.bindings.tools.find(t=>t.id==='pdf-cancel-job').allOf,['document.view','document.read','document.job.manage']);
});

test('PDF contract keys satisfy actual backend and manifest assertions before a held edit',async()=>{
 const {editingContract,id,CONTRACT}=await import('../routes/model.mjs'),first=editingContract(),second=editingContract();assert.notEqual(first.requestKey,second.requestKey);assert.equal(id(first.requestKey),first.requestKey);assert.equal(Object.hasOwn(CONTRACT,'requestKey'),false);
 const yaml=require('js-yaml'),fs=require('node:fs'),manifest=yaml.load(fs.readFileSync(resolve(import.meta.dirname,'../oshal-app.yaml'),'utf8')),schema=manifest.tools.find(t=>t.name==='pdf-apply-operations').inputSchema.properties.requestKey;assert.equal(schema.format,'uuid');const pattern=new RegExp(schema.pattern);assert.ok(pattern.test(first.requestKey));
 for(const bad of ['not-a-uuid'.padEnd(36,'x'),'11111111-1111-7111-8111-111111111111','00000000-0000-0000-0000-000000000000']){assert.equal(pattern.test(bad),false);assert.throws(()=>id(bad),{code:'pdf_invalid_id'});}
});

test('model validates adjacent-sized blank pages, QuadPoints text markup, ink strokeWidth and check/cross marks',()=>{
 const source={id:randomUUID(),pages:[{index:0,cropBox:[0,0,612,792],rotation:0,objects:[]}],fields:[]},base=initial(source);
 const pageId=base.pages[0].id,blankId=randomUUID(),hlId=randomUUID(),ulId=randomUUID(),stId=randomUUID(),inkId=randomUUID(),chkId=randomUUID(),crsId=randomUUID();
 const rotated=apply(base,[{op:'rotate',page:pageId,degrees:90},{op:'insert-blank',position:1,id:blankId}],[source]);
 assert.deepEqual(rotated.pages[1].cropBox,[0,0,792,612]);assert.equal(rotated.pages[1].blank,true);
 const edited=apply(rotated,[
  {op:'annotate',annotation:{id:hlId,page:pageId,kind:'highlight',rect:[40,700,200,720],quadPoints:[[40,720,200,720,40,700,200,700]],color:'ffcc00'}},
  {op:'annotate',annotation:{id:ulId,page:pageId,kind:'underline',rect:[40,660,180,680],quadPoints:[[40,680,180,680,40,660,180,660]],color:'2563eb'}},
  {op:'annotate',annotation:{id:stId,page:pageId,kind:'strikethrough',rect:[40,620,180,640],quadPoints:[[40,640,180,640,40,620,180,620]],color:'dc2626'}},
  {op:'annotate',annotation:{id:inkId,page:blankId,kind:'ink',rect:[50,50,150,120],points:[[50,50],[100,90],[150,120]],color:'1d4ed8',strokeWidth:3.5}},
  {op:'add-object',page:blankId,item:{id:chkId,kind:'check',rect:[200,200,224,224],stroke:'111827',strokeWidth:2.2}},
  {op:'add-object',page:blankId,item:{id:crsId,kind:'cross',rect:[260,200,284,224],stroke:'dc2626',strokeWidth:2.2}}
 ],[source]);
 assert.equal(edited.annotations.length,4);assert.equal(edited.objects.length,2);
 assert.throws(()=>apply(base,[{op:'annotate',annotation:{id:randomUUID(),page:pageId,kind:'underline',rect:[40,700,200,720],quadPoints:[[10,720,200,720,10,700,200,700]]}}],[source]),/pdf_annotation_geometry/);
});

test('authorization.yaml binds every new preference, signature, photo-to-PDF, compression, words and conversion route fail-closed',()=>{
 const fs=require('node:fs'),yaml=require('js-yaml'),auth=yaml.load(fs.readFileSync(resolve(import.meta.dirname,'../authorization.yaml'),'utf8'));
 const http=new Map(auth.bindings.http.map(b=>[`${b.method} ${b.path}`,b.allOf]));
 assert.deepEqual(http.get('GET /preferences'),['document.view']);
 assert.deepEqual(http.get('PUT /preferences'),['document.view']);
 assert.deepEqual(http.get('GET /signatures'),['document.view','document.read']);
 assert.deepEqual(http.get('POST /signatures'),['document.view','document.read','document.change']);
 assert.deepEqual(http.get('GET /signatures/:signature/content'),['document.view','document.read']);
 assert.deepEqual(http.get('POST /signatures/:signature/place'),['document.view','document.read','document.change']);
 assert.deepEqual(http.get('DELETE /signatures/:signature'),['document.view','document.read','document.delete']);
 assert.deepEqual(http.get('POST /documents/from-photos'),['document.view','document.create']);
 assert.deepEqual(http.get('GET /documents/:document/pages/:page/words'),['document.view','document.read']);
 assert.deepEqual(http.get('POST /documents/:document/compress'),['document.view','document.read','document.change']);
 assert.deepEqual(http.get('POST /documents/:document/convert'),['document.view','document.read','document.export']);
 assert.deepEqual(http.get('GET /documents/:document/export/:format'),['document.view','document.read','document.export']);
});
