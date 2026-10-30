/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise original guarded HTTP inspection and native artifact chunk contracts without a pretend renderer.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Bootstrap the genuine pinned toolchain before dynamic application loading, including clean archives.
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
 try{const response=await fetch(url+'/api/pdf-workbench/editing-contract');assert.equal(response.status,200);const contract=await response.json();assert.ok(contract.operations.includes('fill'));assert.ok(contract.unsupported.includes('redaction'));assert.equal((await fetch(url+'/api/pdf-workbench/editing-contract?owner=someone')).status,400);assert.equal((await fetch(url+'/api/pdf-workbench/documents/'+randomUUID()+'/forms/find?query=name&owner=someone')).status,400);active=false;assert.equal((await fetch(url+'/api/pdf-workbench/editing-contract')).status,401);assert.equal((await fetch(url+'/api/pdf-workbench/documents/'+randomUUID()+'/forms/find?query=name')).status,401);}finally{await new Promise(r=>server.close(r));}
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
 const refused=['$ref','$dynamicRef','oneOf','anyOf','allOf','not','if','then','else','pattern','patternProperties','dependentRequired','dependentSchemas','contains','propertyNames','unevaluatedProperties','unevaluatedItems'];
 function node(schema){assert.ok(['object','array','string','integer','number','boolean','null'].includes(schema.type));for(const key of refused)assert.equal(Object.hasOwn(schema,key),false,key+' is not a supported native tool schema assertion');for(const child of Object.values(schema.properties??{}))node(child);if(schema.items)node(schema.items);}
 for(const tool of manifest.tools)node(tool.inputSchema);
 const write=manifest.tools.filter(t=>t.executor.apiEndpoint.startsWith('POST ')||t.executor.apiEndpoint.startsWith('DELETE '));assert.ok(write.length>=7);for(const tool of write){assert.equal(tool.defaultAuthMode,'ask');assert.equal(tool.requiresApproval,true);}
 const authorization=yaml.load(fs.readFileSync(resolve(import.meta.dirname,'../authorization.yaml'),'utf8'));assert.equal(authorization.permissions['document.job.read'].effect,'read');assert.deepEqual(authorization.bindings.tools.find(t=>t.id==='pdf-read-model-part').allOf,['document.view','document.read']);const lookup=manifest.tools.find(t=>t.name==='pdf-read-model-part');assert.equal(lookup.defaultAuthMode,'auto');assert.equal(lookup.requiresApproval,false);assert.deepEqual(authorization.bindings.tools.find(t=>t.id==='pdf-job-status').allOf,['document.view','document.job.read']);assert.deepEqual(authorization.bindings.bots[0].allOf,['document.view']);for(const role of ['viewer','reader'])assert.ok(!authorization.roles[role].grants.some(g=>g.permission==='document.job.manage'));assert.deepEqual(authorization.bindings.tools.find(t=>t.id==='pdf-cancel-job').allOf,['document.view','document.read','document.job.manage']);
});
