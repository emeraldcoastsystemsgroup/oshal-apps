/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the desk composites in authorization.yaml (spec lanes/monitoring-four-desks-spec-2026-11-08.md): the eight desk permissions with their effect and tier, the four roles each granting app.open and its desk's two permissions (a role without app.open could not open the page), operator holding everything, every desk route bound to its desk alone and every policy save to that desk's write permission, and the closure a principal holding only ops-security gets: Sec Ops reads and its save admitted, App Ops reads and saves refused, the page itself open. The kernel evaluates this catalog; this test evaluates the same bindings over the same grants, so a binding that lets one desk into another goes red here before a kernel ever loads it. The desk's own handler holds no permission logic. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {dependency,root}=require('./fixtures/intake.cjs'),{DESKS}=require('../routes/desks');
const yaml=dependency('js-yaml');
const auth=yaml.load(fs.readFileSync(path.join(root,'authorization.yaml'),'utf8')),manifest=yaml.load(fs.readFileSync(path.join(root,'oshal-app.yaml'),'utf8'));
/** The permissions a role grants in the own scope, as the kernel's composite closure reads them. */
const granted=role=>new Set((auth.roles[role]?.grants||[]).filter(g=>g.scope==='own').map(g=>g.permission));
/** Whether a principal holding exactly these grants is admitted to one bound route: every permission the binding names must be granted. */
const admitted=(grants,method,route)=>{const binding=auth.bindings.http.find(b=>b.method===method&&b.path===route);if(!binding)throw Error('no binding for '+method+' '+route);return binding.allOf.every(p=>grants.has(p));};
const toolAdmitted=(grants,tool)=>auth.bindings.tools.find(t=>t.id===tool).allOf.every(p=>grants.has(p));

test('the eight desk permissions exist on the own-scoped application resource with the spec\'s effect and tier',()=>{
 for(const desk of DESKS){
  assert.deepEqual(auth.permissions[desk.permission],{resource:'application',effect:'read',minimumTier:'viewer'},desk.permission);
  assert.deepEqual(auth.permissions[desk.write],{resource:'application',effect:'write',minimumTier:'editor'},desk.write);
 }
 assert.deepEqual(Object.keys(auth.permissions).sort(),['app.open','desk.app','desk.app.write','desk.platform','desk.platform.write','desk.release','desk.release.write','desk.security','desk.security.write','records.write']);
});

test('each desk role grants app.open and its own two desk permissions and nothing else; operator keeps everything; reader is unchanged',()=>{
 for(const desk of DESKS){
  assert.equal(auth.roles[desk.role].tier,'editor');
  assert.deepEqual([...granted(desk.role)].sort(),['app.open',desk.permission,desk.write].sort(),desk.role+' grants the whole chain it needs and no other desk');
 }
 assert.deepEqual([...granted('operator')].sort(),Object.keys(auth.permissions).sort(),'operator holds every permission');
 assert.deepEqual([...granted('reader')],['app.open']);
});

test('every desk route and tool binds to its desk alone; the catalog and the asset ride app.open',()=>{
 for(const desk of DESKS){
  for(const method of ['GET','HEAD'])assert.deepEqual(auth.bindings.http.find(b=>b.method===method&&b.path==='/desks/'+desk.id)?.allOf,[desk.permission],method+' /desks/'+desk.id);
  assert.deepEqual(auth.bindings.http.find(b=>b.method==='POST'&&b.path==='/desks/'+desk.id+'/policy')?.allOf,[desk.write],'POST /desks/'+desk.id+'/policy');
  const tool=manifest.tools.find(t=>t.executor.apiEndpoint==='GET /api/intelligent-operations/desks/'+desk.id);assert.ok(tool,'a Jarvis tool reads '+desk.id);assert.deepEqual(auth.bindings.tools.find(t=>t.id===tool.name).allOf,[desk.permission]);
  assert.equal(tool.type,'api');assert.equal(tool.requiresApproval,false);assert.ok(tool.routingTags.length>=3);assert.match(tool.usageInstructions,/Nothing here runs anything/);
  const tile=manifest.ui.static.find(t=>t.iframeUrl==='/api/intelligent-operations/app#'+desk.id);assert.ok(tile,'a tile opens '+desk.id);assert.equal(tile.label,desk.label);
 }
 for(const path of ['/desks','/assets/desks.js'])for(const method of ['GET','HEAD'])assert.deepEqual(auth.bindings.http.find(b=>b.method===method&&b.path===path)?.allOf,['app.open'],method+' '+path);
 const ids=auth.bindings.http.map(b=>b.id);assert.equal(new Set(ids).size,ids.length,'binding ids are unique');
});

test('a principal holding only ops-security reads Sec Ops and saves its policy, is refused on App Ops reads and saves, and can open the page',()=>{
 const grants=granted('ops-security');
 assert.equal(admitted(grants,'GET','/app'),true,'the page opens');
 assert.equal(admitted(grants,'GET','/desks'),true,'the static catalog');
 assert.equal(admitted(grants,'GET','/desks/sec-ops'),true);assert.equal(admitted(grants,'POST','/desks/sec-ops/policy'),true);assert.equal(toolAdmitted(grants,'ops-security-desk'),true);
 for(const other of ['app-ops','platform-ops','dev-ops']){assert.equal(admitted(grants,'GET','/desks/'+other),false,'GET /desks/'+other+' refused');assert.equal(admitted(grants,'POST','/desks/'+other+'/policy'),false,'POST /desks/'+other+'/policy refused');}
 for(const tool of ['ops-app-desk','ops-platform-desk','ops-release-desk'])assert.equal(toolAdmitted(grants,tool),false,tool+' refused');
 assert.equal(admitted(grants,'POST','/sources'),false,'no general write');assert.equal(admitted(grants,'GET','/records'),true,'what app.open already allowed');
 const reader=granted('reader');for(const desk of DESKS){assert.equal(admitted(reader,'GET','/desks/'+desk.id),false,'reader cannot read '+desk.id);assert.equal(admitted(reader,'POST','/desks/'+desk.id+'/policy'),false);}
 const operator=granted('operator');for(const desk of DESKS){assert.equal(admitted(operator,'GET','/desks/'+desk.id),true);assert.equal(admitted(operator,'POST','/desks/'+desk.id+'/policy'),true);}
});
