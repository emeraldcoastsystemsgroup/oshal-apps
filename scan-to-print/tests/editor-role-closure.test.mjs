/** Source-role boundary checks. Actual package guards use an explicit named-decision port; no native grant, SQL, engine or provider proof. */
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
 for(const permission of ["printer.manage", "print.send"])assert.equal(grants.has(permission),false,permission);
});
test('actual editor tools and concierge are admitted while privileged tools remain denied',()=>{
 for(const id of ["scan-read-calibration", "scan-update-calibration"]){const binding=catalog.bindings.tools.find(b=>b.id===id);assert.ok(allowed(binding),id);}
 for(const id of ["print-to-3d-printer"])assert.equal(allowed(catalog.bindings.tools.find(b=>b.id===id)),false,id);
 for(const binding of catalog.bindings.tools.filter(allowed))assert.ok(binding.allOf.every(p=>catalog.permissions[p].effect!=='execute'));
 assert.ok(catalog.bindings.bots.some(allowed));
});
test('real calibration guard permits saved source changes while printer registration and print release are denied',async()=>{const{calibrationAccess}=createRequire(import.meta.url)('../routes/calibration-editor.js'),p=port();const original=await calibrationAccess(p.ctx,'scan.read');await calibrationAccess(p.ctx,'scan.source.change',original);for(const permission of['printer.manage','print.send'])await assert.rejects(calibrationAccess(p.ctx,permission),{status:403});p.revoke();await assert.rejects(calibrationAccess(p.ctx,'scan.source.change'),{status:403});assert.ok(catalog.roles.maker.grants.some(g=>g.permission==='print.send'));});

test('source role cannot borrow the broad scan.edit authority',()=>{assert.equal(grants.has('scan.edit'),false);assert.equal(grants.has('scan.source.change'),true);
 for(const id of ["reconstruct", "import-pointcloud", "add-depth", "add-video", "add-printer", "print-job"]){assert.equal(allowed(catalog.bindings.http.find(b=>b.id===id)),false,id);}
});
