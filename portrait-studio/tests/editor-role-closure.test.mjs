/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Source-role boundary checks. Actual package guards use an explicit named-decision port; no native grant, SQL, engine or provider proof.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Verify GET /permissions exposes source.create=true and create=false for source-editor and revokes on withdrawal.
 */
import test from 'node:test';import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';import{createRequire}from'node:module';
const require=createRequire(new URL('../../scripts/toolchain/package.json',import.meta.url)),yaml=require('js-yaml');
const catalog=yaml.load(readFileSync(new URL('../authorization.yaml',import.meta.url),'utf8'));
const grants=new Set(catalog.roles['source-editor'].grants.map(g=>g.permission));
const allowed=b=>!!b&&b.allOf.every(p=>grants.has(p));
const actor={isActive:true,issuer:'https://role.fixture',sub:'original',principalId:'principal',tenantIds:['tenant']};
function port(){let active=true;return{revoke(){active=false;},ctx:{authorization:{currentActor:()=>({...actor}),authorize:async({permission})=>({allowed:active&&grants.has(permission)})}}};}
test('editing-only role owns its source and cannot acquire privileged generation or external-action capabilities',()=>{
 assert.equal(catalog.roles['source-editor'].tier,'editor');for(const grant of catalog.roles['source-editor'].grants){assert.equal(grant.scope,'own');assert.ok(catalog.permissions[grant.permission]);assert.notEqual(catalog.permissions[grant.permission].effect,'execute');}
 for(const permission of ["portrait.create", "portrait.artist", "portrait.email"])assert.equal(grants.has(permission),false,permission);
});
test('actual editor tools and concierge are admitted while privileged tools remain denied',()=>{
 for(const id of ["portrait-studio-source-contract", "portrait-studio-source-read", "portrait-studio-source-edits"]){const binding=catalog.bindings.tools.find(b=>b.id===id);assert.ok(allowed(binding),id);}
 for(const id of [])assert.equal(allowed(catalog.bindings.tools.find(b=>b.id===id)),false,id);
 for(const binding of catalog.bindings.tools.filter(allowed))assert.ok(binding.allOf.every(p=>catalog.permissions[p].effect!=='execute'));
 assert.ok(catalog.bindings.bots.some(allowed));
});
test('paid creation, restyle and artist capabilities retain their original permissions; source creation has its own exact capability',()=>{const http=id=>catalog.bindings.http.find(b=>b.id===id);assert.equal(allowed(http('create-portrait')),false);assert.ok(allowed(http('source-create')));assert.ok(allowed(http('source-asset-create')));assert.equal(allowed(catalog.bindings.artifactActions.find(b=>b.id==='restyle')),false);for(const role of['creator','manager']){assert.ok(catalog.roles[role].grants.some(g=>g.permission==='portrait.create'));assert.ok(catalog.roles[role].grants.some(g=>g.permission==='portrait.source.create'));}assert.ok(catalog.roles.manager.grants.some(g=>g.permission==='portrait.artist'));});
test('actual Portrait source-create guard uses the split permission and preserves all other current checks',async()=>{
 const Module=(await import('node:module')).default,original=Module._load,express=require('express');
 Module._load=function(name,parent,...args){if(name==='express')return express;if(name==='sharp')return()=>{throw Error('No image processing in this authority test');};return original.call(this,name,parent,...args);};
 let authorizeSource;try{({authorizeSource}=await import('../routes/source-projects.mjs'));}finally{Module._load=original;}
 const p=port();for(const action of['read','create','change'])await authorizeSource(p.ctx,action);await assert.rejects(authorizeSource(p.ctx,'delete'));p.revoke();await assert.rejects(authorizeSource(p.ctx,'create'));
});
test('GET /permissions reports source.create without create for source-editor and clears on revocation',async t=>{
 const Module=(await import('node:module')).default,original=Module._load,express=require('express'),localRequire=createRequire(import.meta.url);
 Module._load=function(name,parent,...args){if(name==='express')return express;return original.call(this,name,parent,...args);};
 let createPortraitAuthorizationRoutes;try{({createPortraitAuthorizationRoutes}=localRequire('../routes/portrait-authorization.js'));}finally{Module._load=original;}
 const p=port(),app=express();app.use('/api/portrait-studio',createPortraitAuthorizationRoutes(p.ctx));
 const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
 t.after(()=>{server.closeAllConnections();return new Promise(done=>server.close(done));});
 const origin='http://127.0.0.1:'+server.address().port;
 const first=await(await fetch(origin+'/api/portrait-studio/permissions')).json();
 assert.equal(first.permissions.view,true);assert.equal(first.permissions.read,true);assert.equal(first.permissions['source.create'],true);assert.equal(first.permissions.create,false);assert.equal(first.permissions.change,true);
 p.revoke();
 const second=await(await fetch(origin+'/api/portrait-studio/permissions')).json();
 assert.equal(second.permissions['source.create'],false);assert.equal(second.permissions.view,false);
});
