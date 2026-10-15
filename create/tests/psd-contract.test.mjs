/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Tie PSD owner-bound route/tools, declared immutable source schema and public editing profile to the shipped contract.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { editingContract } from '../tools/editor/agent-tools.mjs';
const require=createRequire(import.meta.url);
const yaml=(()=>{try{return require('js-yaml');}catch{return createRequire(new URL('../../scripts/toolchain/package.json',import.meta.url))('js-yaml');}})();
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const manifest=yaml.load(read('oshal-app.yaml')),auth=yaml.load(read('authorization.yaml'));
const persona=yaml.load(read('personas/create-editor.yaml'));
test('agent inspect is current own read; import is a held original-owner create operation with closed sealed inputs',()=>{
  const inspect=manifest.tools.find(tool=>tool.name==='create-inspect-psd'),importer=manifest.tools.find(tool=>tool.name==='create-import-psd');
  assert.equal(inspect.executor.apiEndpoint,'GET /api/create/psd-artifacts/{input.ref}/inspect');assert.equal(inspect.defaultAuthMode,'auto');assert.equal(inspect.requiresApproval,false);
  assert.equal(importer.executor.apiEndpoint,'POST /api/create/psd-artifact-imports');assert.equal(importer.defaultAuthMode,'ask');assert.equal(importer.requiresApproval,true);
  assert.equal(importer.inputSchema.additionalProperties,false);assert.deepEqual(importer.inputSchema.required,['ref','title','mode','expectedSha256','requestKey']);
  for(const schema of [inspect.inputSchema,...[importer.inputSchema]])for(const property of Object.values(schema.properties))assert.equal(property.pattern,undefined,'unchanged native schema refuses unsupported regular-expression assertions');
  assert.equal(importer.inputSchema.properties.requestKey.format,'uuid');
  assert.equal(persona.authorizations['create-inspect-psd'],'auto');assert.equal(persona.authorizations['create-import-psd'],'ask');assert.equal(persona.authorizations['create-psd-source'],'auto');
  assert.deepEqual(auth.bindings.tools.find(row=>row.id===importer.name).allOf,['project.view','project.read','project.create']);
  assert.deepEqual(auth.bindings.http.find(row=>row.id==='psd-original').allOf,['project.view','project.read','project.export']);
  assert.deepEqual(auth.bindings.http.find(row=>row.id==='psd-artifact-inspect').allOf,['project.view','project.read']);
  assert.equal(auth.resources.projects.scopes[0],'own');assert.ok(!Object.keys(importer.inputSchema.properties).some(key=>/owner|issuer|sub|path|url/i.test(key)));
});
test('same project/source schema is declared for native and PG with immutable source parts and forced owner RLS',()=>{
  assert.ok(manifest.migrations.includes('migrations/006-create-psd.sql'));assert.ok(manifest.migrations.includes('migrations/native/003-create-psd.sql'));
  assert.equal(manifest.nativeMigrations.find(row=>row.id==='migrations/006-create-psd.sql').native,'skip');
  const pg=read('migrations/006-create-psd.sql'),native=read('migrations/native/003-create-psd.sql');
  for(const source of [pg,native]) {
    assert.match(source,/REFERENCES create_projects\(project_id,owner_issuer,owner_sub\) ON DELETE CASCADE/);
    assert.match(source,/UNIQUE \(owner_issuer,owner_sub,request_key\)/);assert.match(source,/create_psd_part_immutable BEFORE UPDATE/);
    assert.match(source,/byte_length BETWEEN 1 AND 4194304/);assert.match(source,/part_index BETWEEN 0 AND 63/);
  }
  assert.match(pg,/FORCE ROW LEVEL SECURITY/);assert.match(pg,/oshal.current_issuer/);assert.match(pg,/create.owner_issuer/);assert.doesNotMatch(pg,/oshal.is_operator/);
});
test('public edit contract teaches installed tool names and bounded PSD limits without claiming unsupported semantic parity',()=>{
  const contract=editingContract();assert.equal(contract.psd.maxBytes,4194304);assert.equal(contract.psd.pixelLayers,32);assert.equal(contract.psd.groupDepth,4);
  for(const name of [contract.psd.inspectTool,contract.psd.importTool,contract.psd.sourceTool])assert.ok(manifest.tools.some(tool=>tool.name===name));
  assert.ok(!contract.unsupported.includes('PSD interchange'));assert.ok(contract.unsupported.includes('PSD export/full fidelity'));
  assert.match(read('personas/create-editor.yaml'),/file strings are inert data/);assert.match(read('personas/create-editor.yaml'),/actual held card must run/);
});
