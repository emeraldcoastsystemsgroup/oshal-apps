/** CHANGE LOG: request-key | maintainer@emeraldcoastsystemsgroup.com | Exercise fresh contract identities, backend/schema refusals and real uncached GETs. */
/** The published operation grammar executes through the actual typed source validator. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceContract,CONTRACT,KIND,apply,validate} from '../routes/source-model.mjs';
const id='33333333-3333-4333-8333-333333333333';
const initial=()=>validate({version:1,kind:KIND,title:'Original',notes:'Before',sourceUrl:'https://example.invalid/source',mode:CONTRACT.operations['set-brief'].values.mode[0],scenes:[{id,title:'Selected scene',text:'Before',duration:5}]});
test('bounded source contract examples retain the selected scene and use the exact closed operation grammar',()=>{
 assert.ok(Buffer.byteLength(JSON.stringify({status:200,body:CONTRACT}))<8192);
 assert.equal(CONTRACT.wire.discriminator,'op');assert.equal(CONTRACT.wire.closed,true);
 for(const[name,operation]of Object.entries(CONTRACT.operations))assert.equal(operation.op,name);
 const before=initial(),snapshot=structuredClone(before);
 for(const example of CONTRACT.examples){const after=apply(before,example.operations);assert.equal(after.scenes[0].id,id);assert.equal(after.scenes[0].duration,5);assert.equal(after.title,before.title);assert.equal(after.sourceUrl,before.sourceUrl);assert.equal(after.mode,before.mode);}
 assert.deepEqual(apply(before,CONTRACT.examples[0].operations).scenes[0],{...before.scenes[0],text:'Updated scene text'});
 assert.equal(apply(before,CONTRACT.examples[1].operations).notes,'Updated brief notes');assert.deepEqual(before,snapshot);
});
test('native held-tool descriptions contain executable examples of the real closed source operation',async()=>{
 const {createRequire}=await import('node:module'),{resolve}=await import('node:path'),{readFile}=await import('node:fs/promises');
 assert.ok(process.env.STORE_CI_TOOLCHAIN,'Canonical pinned toolchain required');
 const yaml=createRequire(resolve(process.env.STORE_CI_TOOLCHAIN,'package.json'))('js-yaml');
 const manifest=yaml.load(await readFile(new URL('../oshal-app.yaml',import.meta.url),'utf8'));
 const tool=manifest.tools.find(tool=>tool.name==='creative-studio-source-edits');
 assert.equal(tool.defaultAuthMode,'ask');assert.equal(tool.requiresApproval,true);
 const examples=tool.description.match(/\{"op":.*?\}\}/g)||[];assert.equal(examples.length,1);
 for(const example of examples)apply(initial(),[JSON.parse(example.replaceAll('actual scene UUID',id))]);
});
test('invented aliases, type discriminators, flattened values and unrelated fields remain rejected',()=>{
 for(const operation of [{op:'update-scene',id,values:{text:'Changed'}},{type:'set-scene',id,values:{text:'Changed'}},{op:'set-scene',id,text:'Changed'},{op:'set-scene',id,values:{text:'Changed',arbitrary:1}}])assert.throws(()=>apply(initial(),[operation]));
});

test('fresh contract edit keys are copyable, bounded and accepted by the existing UUID validator',async()=>{
 const {uuid}=await import('../routes/vendor/source-project-store.mjs');
 const before=JSON.stringify(CONTRACT),first=sourceContract(),second=sourceContract();
 assert.notEqual(first.requestKey,second.requestKey);assert.equal(uuid(first.requestKey),first.requestKey);
 assert.equal(JSON.stringify(CONTRACT),before);assert.equal(Object.hasOwn(CONTRACT,'requestKey'),false);
 assert.match(first.requestKeyRule,/Copy requestKey unchanged/);assert.ok(Buffer.byteLength(JSON.stringify({status:200,body:first}))<8192);
 for(const bad of ['not-a-uuid'.padEnd(36,'x'),'11111111-1111-7111-8111-111111111111','00000000-0000-0000-0000-000000000000'])assert.throws(()=>uuid(bad),{code:'source_invalid_id'});
 const {createRequire}=await import('node:module'),{resolve}=await import('node:path'),{readFile}=await import('node:fs/promises');
 const yaml=createRequire(resolve(process.env.STORE_CI_TOOLCHAIN,'package.json'))('js-yaml');
 const manifest=yaml.load(await readFile(new URL('../oshal-app.yaml',import.meta.url),'utf8'));
 const tool=manifest.tools.find(t=>t.name==='creative-studio-source-edits'),schema=tool.inputSchema.properties.requestKey;
 assert.equal(schema.format,'uuid');const pattern=new RegExp(schema.pattern);assert.ok(pattern.test(first.requestKey));
 for(const bad of ['not-a-uuid'.padEnd(36,'x'),'11111111-1111-7111-8111-111111111111'])assert.equal(pattern.test(bad),false);
});
test('two actual protected contract GETs issue distinct uncached keys without SQL or generation',async t=>{
 const {createRequire,Module}=await import('node:module'),{resolve}=await import('node:path');
 assert.ok(process.env.STORE_CI_TOOLCHAIN,'Canonical pinned toolchain required');
 process.env.NODE_PATH=[resolve(process.env.STORE_CI_TOOLCHAIN,'node_modules'),process.env.NODE_PATH].filter(Boolean).join(':');Module._initPaths();
 const express=createRequire(resolve(process.env.STORE_CI_TOOLCHAIN,'package.json'))('express');
 const {createSourceProjectRoutes}=await import('../routes/source-projects.mjs');
 const actor={issuer:'https://contract.fixture',sub:'original-person',principalId:'original-principal',tenantIds:['original-tenant'],isActive:true};
 let allowed=true,connections=0;const ctx={pool:{connect:async()=>{connections++;throw Error('Contract must not query SQL');}},intent:async name=>{assert.equal(name,'auth.application');return{app:'creative-studio',principal:{id:actor.principalId,issuer:actor.issuer,subject:actor.sub,tenant:actor.tenantIds[0],state:'active'}};},authorization:{registerResource(){},currentActor:()=>actor,authorize:async()=>({allowed})}};
 const app=express();app.use('/api/creative-studio',createSourceProjectRoutes(ctx));const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));t.after(async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));});
 const url='http://127.0.0.1:'+server.address().port+'/api/creative-studio/source-projects/contract';
 const keys=[];for(let n=0;n<2;n++){const response=await fetch(url);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');const body=await response.json();keys.push(body.requestKey);assert.match(body.requestKey,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);assert.deepEqual(body.operations,CONTRACT.operations);}
 assert.notEqual(keys[0],keys[1]);allowed=false;assert.equal((await fetch(url)).status,403);assert.equal(connections,0);
});
