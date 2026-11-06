/** CHANGE LOG: request-key | maintainer@emeraldcoastsystemsgroup.com | Exercise fresh contract identities, backend/schema refusals and real uncached GETs. */
/** Closed brief operations execute without generation or transport fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceContract,CONTRACT,apply,validate} from '../routes/source-model.mjs';
const initial=()=>validate({version:1,kind:'vids-brief',title:'Original',prompt:'Before',orientation:'Landscape',insertMode:'Insert'});
test('bounded saved-brief contract provides the exact executable op/values shape',()=>{
 assert.ok(Buffer.byteLength(JSON.stringify({status:200,body:CONTRACT}))<8192);
 assert.equal(CONTRACT.wire.discriminator,'op');assert.equal(CONTRACT.wire.closed,true);
 assert.deepEqual(Object.keys(CONTRACT.operations),['set-brief']);assert.equal(CONTRACT.operations['set-brief'].op,'set-brief');
 const before=initial(),snapshot=structuredClone(before);
 for(const example of CONTRACT.examples){const after=apply(before,example.operations);assert.deepEqual(after,{...before,prompt:'A slow camera move across a sunlit landscape'});}
 assert.deepEqual(before,snapshot);
});
test('native held-tool descriptions contain executable examples of the real closed source operation',async()=>{
 const {createRequire}=await import('node:module'),{resolve}=await import('node:path'),{readFile}=await import('node:fs/promises');
 assert.ok(process.env.STORE_CI_TOOLCHAIN,'Canonical pinned toolchain required');
 const yaml=createRequire(resolve(process.env.STORE_CI_TOOLCHAIN,'package.json'))('js-yaml');
 const manifest=yaml.load(await readFile(new URL('../oshal-app.yaml',import.meta.url),'utf8'));
 const tool=manifest.tools.find(tool=>tool.name==='vids-source-edits');
 assert.equal(tool.defaultAuthMode,'ask');assert.equal(tool.requiresApproval,true);
 const examples=tool.description.match(/\{"op":.*?\}\}/g)||[];assert.equal(examples.length,1);
 for(const example of examples)apply(initial(),[JSON.parse(example)]);
});
test('actual failed provider type/prompt shape and invented aliases remain refused',()=>{
 for(const operation of [{type:'set-brief',prompt:'Changed'},{op:'update-brief',values:{prompt:'Changed'}},{op:'set-brief',prompt:'Changed'},{op:'set-brief',values:{prompt:'Changed',generate:true}}])assert.throws(()=>apply(initial(),[operation]));
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
 const tool=manifest.tools.find(t=>t.name==='vids-source-edits'),schema=tool.inputSchema.properties.requestKey;
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
 let allowed=true,connections=0;const ctx={pool:{connect:async()=>{connections++;throw Error('Contract must not query SQL');}},intent:async name=>{assert.equal(name,'auth.application');return{app:'vids',principal:{id:actor.principalId,issuer:actor.issuer,subject:actor.sub,tenant:actor.tenantIds[0],state:'active'}};},authorization:{registerResource(){},currentActor:()=>actor,authorize:async()=>({allowed})}};
 const app=express();app.use('/api/vids',createSourceProjectRoutes(ctx));const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));t.after(async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));});
 const url='http://127.0.0.1:'+server.address().port+'/api/vids/source-projects/contract';
 const keys=[];for(let n=0;n<2;n++){const response=await fetch(url);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');const body=await response.json();keys.push(body.requestKey);assert.match(body.requestKey,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);assert.deepEqual(body.operations,CONTRACT.operations);}
 assert.notEqual(keys[0],keys[1]);allowed=false;assert.equal((await fetch(url)).status,403);assert.equal(connections,0);
});
