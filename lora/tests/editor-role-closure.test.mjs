/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Source-role boundary checks. Actual package guards use an explicit named-decision port; no native grant, SQL, engine or provider proof.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | RP-LORA-01: verify dataset-upload remains bound to lora.configure and denied to source-editor.
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
 for(const permission of ["lora.execute"])assert.equal(grants.has(permission),false,permission);
});
test('actual editor tools and concierge are admitted while privileged tools remain denied',()=>{
 for(const id of ["lora-editor-contract", "lora-editor-character", "lora-editor-character-edit", "lora-editor-caption", "lora-editor-caption-edit"]){const binding=catalog.bindings.tools.find(b=>b.id===id);assert.ok(allowed(binding),id);}
 for(const id of [])assert.equal(allowed(catalog.bindings.tools.find(b=>b.id===id)),false,id);
 for(const binding of catalog.bindings.tools.filter(allowed))assert.ok(binding.allOf.every(p=>catalog.permissions[p].effect!=='execute'));
 assert.ok(catalog.bindings.bots.some(allowed));
});
test('training, callback release and autonomous opt-in retain execute; editor metadata and captions do not grant it',()=>{for(const id of['train','validate','improve','improve-overnight','autonomous','worker-callback','worker-cell-image','worker-dataset-download']){const b=catalog.bindings.http.find(b=>b.id===id);assert.ok(b,id);assert.deepEqual(b.allOf,['lora.execute']);assert.equal(allowed(b),false,id);}assert.ok(catalog.roles.trainer.grants.some(g=>g.permission==='lora.execute'));});
test('actual LoRA access guard accepts current source configuration and freshly denies execution/revocation',async()=>{const Module=(await import('node:module')).default,old=Module._load,express=require('express');let editor;Module._load=function(name,parent,...rest){if(name==='express')return express;if(name==='@/shared/logger')return{createChildLogger:()=>({info(){},warn(){},error(){},debug(){}})};if(name==='@/shared/services/database/request-identity')return{runWithRequestIdentity:()=>{throw Error('No SQL/worker port in this authorization test');}};if(name==='@/app/routes/remote-client-routes')return{remoteClientRegistry:{listClients(){throw Error('No worker dispatch permitted');},enqueueTask(){throw Error('No worker dispatch permitted');}}};return old.call(this,name,parent,...rest);};try{editor=createRequire(import.meta.url)('../routes/lora-caption-editor.js');}finally{Module._load=old;}const p=port();await editor.editorAccess(p.ctx,'lora.source.change');await assert.rejects(editor.editorAccess(p.ctx,'lora.execute'),{status:403});p.revoke();await assert.rejects(editor.editorAccess(p.ctx,'lora.source.change'),{status:403});});

test('source role cannot borrow the broad lora.configure authority',()=>{assert.equal(grants.has('lora.configure'),false);assert.equal(grants.has('lora.source.change'),true);
 for(const id of ["dataset-import", "dataset-upload", "active-version", "model-delete", "autonomous", "train"]){assert.equal(allowed(catalog.bindings.http.find(b=>b.id===id)),false,id);}
});
