/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify owned entry/configuration and declared supported references without deployment credentials.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Pin every version-2 role to the complete functional component bundle without optional choices.
 */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('owned Classroom display and shared engine contract',()=>{const context={window:{}};vm.runInNewContext(read('ui/config.js'),context);const config=context.window.HOMEBASE_PRESETS;assert.deepEqual(Object.keys(config),['classroom']);assert.ok(config.classroom.hosts.every(h=>Array.isArray(h.surfaces)&&!h.hiddenTools));assert.match(read('ui/index.html'),/data-experience-app="classroom-experience"/);assert.ok(read('ui/index.html').includes('/api/classroom-experience/assets/config.js'));assert.ok(read('ui/classroom.css').includes('data-skin="classroom"'));});
test('host role catalog has no business write or tenant-sharing permission',()=>{assert.match(read('authorization.yaml'),/minimumTier: viewer/);assert.doesNotMatch(read('authorization.yaml'),/effect: (write|execute|delete)/);assert.doesNotMatch(read('routes/experience.js'),/\.query\(|INSERT|UPDATE|DELETE|createRole|grantRole/);assert.match(read('oshal-app.yaml'),/experience-roles/);});
test('entry handlers and display configuration parse',()=>{for(const file of ['routes/experience.js','routes/package-smoke.js','ui/config.js'])new vm.Script(read(file),{filename:file});});

/** Complete shipped role membership is an independent consumer contract, not a catalog mirror. */
test('each named application role includes the whole bundle without component selections', () => {
  const manifest = read('oshal-app.yaml');
  const required = ["little-monsters", "presentations", "circuit-lab"];
  const dependencyBlock = manifest.slice(manifest.indexOf('dependencies:'), manifest.indexOf('authorization:'));
  const requiredRows = dependencyBlock.split('  optional:')[0].match(/^      - .+$/gm) || [];
  assert.deepEqual(requiredRows.map(row => row.trim().slice(2)), required);
  assert.match(dependencyBlock, /optional:\r?\n    apps: \[\]/);
  const roleBlock = manifest.slice(manifest.indexOf('  roleTemplates:'), manifest.indexOf('routes:'));
  const bundles = roleBlock.split(/    - id: /).slice(1);
  assert.deepEqual(bundles.map(row => row.split(/\r?\n/)[0]), ["learner", "teacher", "administrator"]);
  for (const bundle of bundles) {
    assert.match(bundle, /      version: 2/);
    const apps = [...bundle.matchAll(/        - app: ([a-z0-9-]+)/g)].map(match => match[1]);
    assert.deepEqual(apps, ['classroom-experience', ...required]);
    assert.equal(new Set(apps).size, apps.length);
  }
});
