/** CHANGE LOG: request-key | maintainer@emeraldcoastsystemsgroup.com | Verify transient distinct uncached contract keys and strict edit schemas. */
/** Actual source grammar/catalog projections; HTTP authorization ports are explicitly named fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import Module,{createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {CONTRACT,CATALOG_SECTIONS,sourceContract,apply,validate} from '../routes/source-model.mjs';
const require=createRequire(import.meta.url),catalog=require('../routes/portrait-catalog.js');
const photo='11111111-1111-4111-8111-111111111111',asset='22222222-2222-4222-8222-222222222222',crop='33333333-3333-4333-8333-333333333333';
const initial=()=>validate({version:1,kind:'portrait',title:'Original',mode:'professional',style:null,aspect:0.8,notes:'Before',settings:{},photos:[{id:photo,assetId:asset,sha256:'a'.repeat(64),width:400,height:500,crops:[{id:crop,x:9,y:30,w:160,h:200}]}]});
const bytes=body=>Buffer.byteLength(JSON.stringify({status:200,body}));

test('compact closed source operations have executable examples and reject the actual invented aliases',()=>{
 assert.ok(bytes(CONTRACT)<8192);assert.equal(CONTRACT.wire.discriminator,'op');assert.equal(CONTRACT.wire.closed,true);
 for(const [name,operation] of Object.entries(CONTRACT.operations))assert.equal(operation.op,name);
 const before=initial(),snapshot=structuredClone(before);
 for(const example of CONTRACT.examples){const after=apply(before,example.operations);assert.equal(after.photos[0].crops[0].id,crop);assert.equal(after.photos[0].assetId,asset);assert.equal(after.photos[0].crops[0].x,17);assert.equal(after.notes,'Preserve the original photo');}
 assert.deepEqual(before,snapshot);
 for(const operation of [{op:'update-crop',id:crop,values:{x:17}},{op:'set-notes',notes:'Changed'},{type:'set-crop',id:crop,values:{x:17}},{op:'set-crop',id:crop,values:{x:17,arbitrary:1}}])assert.throws(()=>apply(before,[operation]));
});

test('all bounded catalog sections contain the exact existing allowed IDs and leave the UI catalog intact',()=>{
 const {requestKey,requestKeyRule,...grammar}=sourceContract();assert.deepEqual(grammar,CONTRACT);assert.match(requestKey,/^[0-9a-f-]{36}$/);assert.match(requestKeyRule,/Copy requestKey unchanged/);const full=catalog.clientCatalog();assert.ok(full.presets.professional[0].blurb);
 assert.equal(CONTRACT.catalog.tool,'portrait-studio-source-contract');assert.deepEqual(CONTRACT.catalog.input.section,CATALOG_SECTIONS);
 const keys={background:'backgrounds',attire:'attire',headwear:'headwear',prop:'props',finish:'finishes',framing:'framings'};
 for(const section of CATALOG_SECTIONS){const body=sourceContract(section);assert.ok(bytes(body)<8192,section);assert.equal(body.section,section);
  if(section==='styles')assert.deepEqual(body.values,Object.fromEntries(Object.entries(full.presets).map(([mode,items])=>[mode,items.map(item=>item.id)])));
  else{assert.deepEqual(body.values,['',...full[keys[section]].map(item=>item.id)]);for(const id of body.values)assert.equal(catalog.validateOverrides({[section]:id}),null);}
 }
 for(const section of ['unknown','',{},['styles']])assert.throws(()=>sourceContract(section),{code:'source_invalid_catalog_section'});
 assert.deepEqual(catalog.clientCatalog(),full);assert.equal(Object.hasOwn(CONTRACT,'presets'),false);
});

test('actual protected HTTP contract and optional native query use the same read authority without SQL or generation',async t=>{
 const toolchain=process.env.STORE_CI_TOOLCHAIN,core=process.env.OSHAL_CORE_ROOT;
 assert.ok(toolchain&&core,'Canonical toolchain and actual Sharp runtime dependency roots required');
 process.env.NODE_PATH=[resolve(toolchain,'node_modules'),resolve(core,'node_modules'),process.env.NODE_PATH].filter(Boolean).join(':');Module._initPaths();
 const dependencies=createRequire(resolve(toolchain,'package.json')),express=dependencies('express'),yaml=dependencies('js-yaml');
 const manifest=yaml.load(await readFile(new URL('../oshal-app.yaml',import.meta.url),'utf8'));
 const tool=manifest.tools.find(tool=>tool.name==='portrait-studio-source-contract');
 assert.equal(tool.executor.apiEndpoint,'GET /api/portrait-studio/source-projects/contract?section={input.section}');
 assert.deepEqual(tool.inputSchema.required,[]);assert.deepEqual(tool.inputSchema.properties.section.enum,CATALOG_SECTIONS);
 const edits=manifest.tools.find(tool=>tool.name==='portrait-studio-source-edits'),examples=edits.description.match(/\{"op":.*?\}\}/g)||[];
 assert.equal(edits.defaultAuthMode,'ask');assert.equal(edits.requiresApproval,true);assert.equal(examples.length,2);
 for(const example of examples)apply(initial(),[JSON.parse(example.replaceAll('actual crop UUID',crop))]);
 const auth=yaml.load(await readFile(new URL('../authorization.yaml',import.meta.url),'utf8'));
 assert.deepEqual(auth.bindings.tools.find(tool=>tool.id==='portrait-studio-source-contract').allOf,['portrait.view','portrait.read']);
 const{createSourceProjectRoutes}=await import('../routes/source-projects.mjs');
 const actor={issuer:'https://contract.fixture',sub:'original-person',principalId:'original-principal',tenantIds:['original-tenant'],isActive:true};
 let allowed=true,connections=0;const permissions=[];
 // The real handler's contract read needs no database. This port refuses every attempted query.
 const ctx={pool:{connect:async()=>{connections++;throw Error('Contract reads must not query SQL');}},authorization:{currentActor:()=>actor,authorize:async({permission})=>{permissions.push(permission);return{allowed};}}};
 const app=express();app.use('/api/portrait-studio',createSourceProjectRoutes(ctx));
 const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
 t.after(async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));});
 const url='http://127.0.0.1:'+server.address().port+'/api/portrait-studio/source-projects/contract';
 for(const section of [undefined,...CATALOG_SECTIONS]){const response=await fetch(url+(section?'?section='+section:''));assert.equal(response.status,200);const body=await response.json();const expected=sourceContract(section);assert.notEqual(body.requestKey,expected.requestKey);const {requestKey,requestKeyRule,...actualGrammar}=body;const {requestKey:otherKey,requestKeyRule:otherRule,...expectedGrammar}=expected;assert.deepEqual(actualGrammar,expectedGrammar);assert.equal(requestKeyRule,otherRule);assert.match(requestKey,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.ok(bytes(body)<8192);}
 assert.deepEqual(permissions.slice(0,2),['portrait.view','portrait.read']);
 for(const query of ['section=unknown','section[]=styles','section=styles&owner=foreign'])assert.equal((await fetch(url+'?'+query)).status,400);
 allowed=false;for(const suffix of ['', '?section=styles'])assert.equal((await fetch(url+suffix)).status,403);
 assert.equal(connections,0);
});

test('portrait edit schema and backend reject malformed and v7 keys while fresh contracts stay transient',async()=>{
 const {uuid}=await import('../routes/vendor/source-project-store.mjs');const first=sourceContract(),second=sourceContract();assert.notEqual(first.requestKey,second.requestKey);assert.equal(uuid(first.requestKey),first.requestKey);assert.equal(Object.hasOwn(CONTRACT,'requestKey'),false);
 const dependencies=createRequire(resolve(process.env.STORE_CI_TOOLCHAIN,'package.json')),yaml=dependencies('js-yaml');const manifest=yaml.load(await readFile(new URL('../oshal-app.yaml',import.meta.url),'utf8'));const schema=manifest.tools.find(t=>t.name==='portrait-studio-source-edits').inputSchema.properties.requestKey;assert.equal(schema.format,'uuid');const pattern=new RegExp(schema.pattern);assert.ok(pattern.test(first.requestKey));
 for(const bad of ['not-a-uuid'.padEnd(36,'x'),'11111111-1111-7111-8111-111111111111','00000000-0000-0000-0000-000000000000']){assert.equal(pattern.test(bad),false);assert.throws(()=>uuid(bad),{code:'source_invalid_id'});}
});
