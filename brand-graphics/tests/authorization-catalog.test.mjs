/** Actual catalog and source-authorizer closure; explicit named-authority port seam, no provider/SQL substitutes claimed as native acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import Module from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const require=createRequire(new URL('../../scripts/toolchain/package.json',import.meta.url));
process.env.NODE_PATH=[resolve(new URL('../../scripts/toolchain/node_modules',import.meta.url).pathname),process.env.NODE_PATH].filter(Boolean).join(':');Module._initPaths();
const yaml=require('js-yaml'),read=path=>yaml.load(readFileSync(new URL(path,import.meta.url),'utf8'));
const catalog=read('../authorization.yaml'),manifest=read('../oshal-app.yaml'),APP='brand-graphics';
const {authorizeSource,registerSourceAuthorization}=await import('../routes/source-projects.mjs');
const {identity}=await import('../routes/vendor/source-project-store.mjs');
const holds=(role,p)=>catalog.roles[role]?.grants.some(g=>g.permission===p&&g.scope==='own')===true;
function context(role='source-editor'){
 let actor={issuer:'https://source-roles.invalid',sub:'original',principalId:'original-person',tenantIds:['original-tenant'],isActive:true};
 const control={role,deny:new Set(),calls:[],adapters:new Map(),alter:null};
 const ctx={authorization:{currentActor:()=>actor,registerResource:(name,value)=>control.adapters.set(name,value),authorize:async({permission})=>{
  control.calls.push(permission);await control.alter?.(permission);return{allowed:!control.deny.has(permission)&&holds(control.role,permission)};
 }},intent:async name=>{assert.equal(name,'auth.application');return{app:APP,roles:[control.role],principal:{id:actor.principalId,issuer:actor.issuer,subject:actor.sub,tenant:actor.tenantIds[0],state:actor.isActive?'active':'inactive'}};}};
 registerSourceAuthorization(ctx);return{ctx,control,actor:()=>actor,setActor:value=>{actor=value;}};
}
function bound(method,path){
 const candidates=[path];for(const mount of new Set(manifest.routes.map(r=>r.mountPath))){if(path===mount)candidates.push('/');else if(path.startsWith(mount+'/'))candidates.push(path.slice(mount.length));}
 const found=catalog.bindings.http.filter(b=>b.method===method&&candidates.some(p=>{const a=b.path.split('/'),v=p.split('/');return a.length===v.length&&a.every((x,i)=>x===v[i]||x.startsWith(':')&&v[i]);}));
 assert.equal(found.length,1,'one actual mounted HTTP permission binding for '+method+' '+path);return found[0].allOf;
}
test('source-editor and reader have closed owned grants and no dispatch/generation execution',()=>{
 assert.deepEqual(Object.keys(catalog.roles).sort(),['admin','reader','source-editor']);assert.equal(catalog.roles.reader.tier,'viewer');assert.equal(catalog.roles['source-editor'].tier,'editor');
 assert.deepEqual(catalog.roles['source-editor'].grants.map(g=>g.permission).sort(),['app.open','legacy.read','source.change','source.create','source.delete','source.read']);
 for(const role of ['reader','source-editor'])for(const grant of catalog.roles[role].grants){assert.equal(grant.scope,'own');assert.ok(['read','write'].includes(catalog.permissions[grant.permission].effect));}
 assert.equal(holds('reader','source.read'),true);for(const p of ['source.create','source.change','source.delete','legacy.execute'])assert.equal(holds('reader',p),false);
 assert.equal(holds('source-editor','legacy.execute'),false);assert.equal(holds('@app-admin','source.read'),false,'no silent legacy selector adapter');
 for(const p of Object.keys(catalog.permissions))assert.equal(holds('admin',p),true,'reviewed admin retains '+p);
 assert.deepEqual(manifest.dependencies.required.apps,[]);assert.ok(manifest.dependencies.optional.apps.includes('vids'));
 assert.equal(manifest.authorization.catalog,'authorization.yaml');assert.ok(manifest.uses.includes('application-authorization'));
 const templates=[read('../../create/oshal-app.yaml'),...(APP==='vids'?[read('../../video/oshal-app.yaml')]:[])].flatMap(m=>m.authorization.roleTemplates).flatMap(t=>t.members).filter(m=>m.app===APP);
 assert.equal(templates.length,APP==='vids'?4:2);for(const member of templates)assert.equal(member.role,'admin','only reviewed named admin replaces legacy template selectors');
});
test('source tools and bot use source permissions while every spending tool stays admin-only',()=>{
 assert.equal(catalog.bindings.tools.length,manifest.tools.length);
 for(const tool of manifest.tools){const binding=catalog.bindings.tools.find(b=>b.id===tool.name);assert.ok(binding,tool.name);
  if(tool.name.includes('-source-')){assert.ok(binding.allOf.every(p=>holds('source-editor',p)));assert.ok(!binding.allOf.includes('legacy.execute'));}
  else if(!['creative_list','vids-jobs'].includes(tool.name)){assert.ok(binding.allOf.includes('legacy.execute'));assert.ok(binding.allOf.some(p=>!holds('source-editor',p)));}
 }
 for(const bot of manifest.bots){const binding=catalog.bindings.bots.find(b=>b.id===bot.agentId||b.id===bot.name);assert.deepEqual(binding?.allOf,['app.open','source.read']);}
 for(const job of catalog.bindings.jobs)assert.deepEqual(job.allOf,['app.open','legacy.execute']);
});
test('real mounted surfaces/contracts/HTTP edits have one exact binding and matching API tools',()=>{
 const mount='/api/'+APP;
 assert.deepEqual(bound('GET',mount+(APP==='vids'?'/app':'/review')),['app.open']);
 assert.deepEqual(bound('GET',mount+'/source-projects/contract'),['app.open','source.read']);
 assert.deepEqual(bound('GET',mount+'/home-summary'),['app.open','legacy.read']);
 assert.deepEqual(bound('GET',mount+'/_smoke'),['app.open']);
 assert.deepEqual(bound('POST',mount+'/source-projects'),['app.open','source.read','source.create']);
 for(const tool of manifest.tools.filter(t=>t.executor?.executorType==='api')){
  const [method,path]=tool.executor.apiEndpoint.split(' ');assert.deepEqual(catalog.bindings.tools.find(b=>b.id===tool.name).allOf,bound(method,path.replaceAll('{input.id}','owned-id')));
 }
 if(APP==='vids')for(const p of ['/jobs','/brand','/story','/jobs/owned-id/artifact/publish'])assert.ok(bound('POST',mount+p).includes('legacy.execute'));
});
test('fresh source role decisions permit actual source operations and reject reader/legacy/revoked authority',async()=>{
 const f=context(),owner=identity(f.ctx);for(const action of ['read','create','change','delete'])await authorizeSource(f.ctx,action,owner);
 assert.deepEqual(f.control.calls.slice(-3),['app.open','source.read','source.delete']);
 f.control.role='reader';await authorizeSource(f.ctx,'read',owner);for(const action of ['create','change','delete'])await assert.rejects(authorizeSource(f.ctx,action,owner),e=>e.code==='source_permission_denied');
 f.control.role='@app-admin';await assert.rejects(authorizeSource(f.ctx,'read',owner),e=>e.status===403);
 f.control.role='source-editor';f.control.deny.add('source.change');await assert.rejects(authorizeSource(f.ctx,'change',owner),e=>e.status===403);
});
test('original four-part identity and live own-scope resource checks cannot be widened by role metadata',async()=>{
 const f=context(),owner=identity(f.ctx),original=f.actor();
 for(const [field,value]of [['issuer','other'],['sub','other'],['principalId','other'],['tenantIds',['other']]]){f.setActor({...original,[field]:value});await assert.rejects(authorizeSource(f.ctx,'read',owner),e=>e.status===403);}
 f.setActor(original);for(const name of ['sources','legacy']){const adapter=f.control.adapters.get(name);assert.ok(adapter);
  assert.equal(adapter.authorize({actor:original,operation:{app:APP},grant:{scope:'own'}}),true);
  assert.equal(adapter.authorize({actor:original,operation:{app:APP},grant:{scope:'tenant'}}),false);
  assert.equal(adapter.authorize({actor:original,operation:{app:'foreign-app'},grant:{scope:'own'}}),false);
  assert.equal(adapter.authorize({actor:original,operation:{app:APP,tenantId:'original-tenant'},grant:{scope:'own'}}),false);
 }
 f.control.alter=permission=>{if(permission==='source.change')f.setActor({...original,sub:'replaced-during-await'});};
 await assert.rejects(authorizeSource(f.ctx,'change',owner),e=>e.code==='source_actor_changed');
});
