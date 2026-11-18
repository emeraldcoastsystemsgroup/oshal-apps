/** CHANGE LOG
 * SEQ: 1
 * AUTHOR: maintainer@emeraldcoastsystemsgroup.com
 * Pin the retained version-one approval closure and prove version-two-only
 * mutations cannot change its exact native authority digest.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Reuse the native closure reader shared by every version-aware read-only and research boundary guard; keep each original mutation test.
 */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const authority=require('./support/order-authority');
const {LEGACY_ROOTS,LEGACY_DIGEST}=authority;
const manifestVersions=authority.versions(ROOT);
const closure=(roots,overrides)=>authority.closure(ROOT,roots,overrides);
const digest=(roots,overrides)=>authority.digest(ROOT,roots,overrides);

function changed(relative){return new Map([[relative,Buffer.concat([fs.readFileSync(path.join(ROOT,relative)),Buffer.from('\n// Synthetic authority mutation.\n')])]]);}

function roots(version){
 const result=manifestVersions[String(version)];
 assert.ok(Array.isArray(result)&&result.length,'version '+version+' must have explicit roots');return result;
}

test('version one retains the exact twenty-nine-file approval closure and native digest',()=>{
 assert.deepEqual(roots(1),LEGACY_ROOTS);
 const files=closure(roots(1));assert.equal(files.size,29);
 assert.equal(digest(roots(1)),LEGACY_DIGEST,'Changing approved v1 bytes requires a separate explicit authority decision.');
 assert.ok([...files.keys()].every(file=>!file.startsWith('routes/live/continuity/')));
 for(const file of ['routes/today/read.js','routes/trading-portfolio-routes.js','routes/trading-paper-routes.js'])assert.equal(files.has(file),false);
});

test('version two explicitly covers its separate monitor and every candidate decision module',()=>{
 assert.deepEqual(roots(2),[...LEGACY_ROOTS,'routes/live/continuity/monitor.js','routes/live/continuity/execution.js']);
 const files=closure(roots(2));
 for(const name of ['monitor','execution','cycles','goals','protection'])assert.ok(files.has('routes/live/continuity/'+name+'.js'));
 for(const file of closure(roots(1)).keys())assert.ok(files.has(file),'shared order code stays covered: '+file);
 const legacy=closure(roots(1));
 assert.deepEqual([...files.keys()].filter(file=>!legacy.has(file)).sort(),['cycles','execution','goals','monitor','protection'].map(name=>'routes/live/continuity/'+name+'.js').sort(),'version two adds exactly the five separate continuity modules');
});

test('each candidate-only mutation changes v2 authority while preserving v1 exactly',()=>{
 for(const name of ['monitor','execution','cycles','goals','protection']){
  const mutation=changed('routes/live/continuity/'+name+'.js');
  assert.equal(digest(roots(1),mutation),LEGACY_DIGEST);
  assert.notEqual(digest(roots(2),mutation),digest(roots(2)));
 }
});

test('a mutation of any original closure file changes the v1 approval binding',()=>{
 for(const file of closure(roots(1)).keys())assert.notEqual(digest(roots(1),changed(file)),LEGACY_DIGEST,file);
});

test('moving the legacy root list into a versioned declaration does not alter native digest framing',()=>{
 const old={sources:LEGACY_ROOTS},versioned={versions:{'1':{sources:LEGACY_ROOTS}}};
 assert.equal(digest(old.sources),digest(versioned.versions['1'].sources));
 assert.equal(digest([...LEGACY_ROOTS].reverse()),LEGACY_DIGEST,'native translation sorts and deduplicates roots');
});
