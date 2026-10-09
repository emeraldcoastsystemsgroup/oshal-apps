/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify owned Home entry/configuration, exact references and deliberate member roles without deployment credentials.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Bind attention asset order, default priorities and package-scoped factory composition without treating source contracts as installed proof.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Pin every version-2 role to the complete functional component bundle without optional choices.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
test('Home owns its entry, skin and one exact configuration', () => {
  const context = { window: {} }; vm.runInNewContext(read('ui/config.js'), context);
  const presets = context.window.HOMEBASE_PRESETS;
  assert.deepEqual(Object.keys(presets), ['family']);
  assert.equal(presets.family.title, 'Today');
  assert.equal(presets.family.calendarHeading, "Today's Schedule");
  assert.deepEqual(Array.from(presets.family.modules.main).slice(0, 3), ['calendar', 'projects', 'apps']);
  assert.ok(presets.family.hosts.every(host => Array.isArray(host.surfaces) && !host.hiddenTools));
  const entry = read('ui/index.html');
  assert.match(entry, /\/api\/home-experience\/assets\/config\.js/);
  assert.match(entry, /data-experience-app="home-experience"/);
  assert.match(entry, /\/experience\/experience-hosts\.js/);
  assert.ok(entry.indexOf('/experience/homebase-modules.js') < entry.indexOf('/api/home-experience/assets/home-attention.js'));
  assert.ok(entry.indexOf('/api/home-experience/assets/home-attention.js') < entry.indexOf('/experience/homebase.js'));
  for (const file of ['src-routes/experience.ts', 'routes/experience.js']) assert.ok(read(file).includes("router.get('/assets/home-attention.js', send('home-attention.js'))"));
  assert.match(read('ui/family.css'), /data-skin="family"/);
});
test('declares reviewed lifecycle without granting household or school authority', () => {
  const manifest = read('oshal-app.yaml');
  assert.match(manifest, /experience-roles/); assert.match(manifest, /roleTemplates:/);
  assert.match(manifest, /app: purchasing\r?\n\s+role: '@app-admin'/);
  assert.doesNotMatch(manifest, /role: (parent|teacher|admin)\b/);
  assert.match(read('authorization.yaml'), /minimumTier: viewer/);
  assert.match(read('authorization.yaml'), /id: asset-get-home-attention-js\r?\n\s+method: GET\r?\n\s+path: \/assets\/home-attention\.js\r?\n\s+allOf:\r?\n\s+- app\.open/);
  assert.match(read('authorization.yaml'), /id: asset-head-home-attention-js\r?\n\s+method: HEAD\r?\n\s+path: \/assets\/home-attention\.js\r?\n\s+allOf:\r?\n\s+- app\.open/);
  assert.doesNotMatch(read('authorization.yaml'), /effect: (write|execute|delete)/);
  assert.doesNotMatch(read('routes/experience.js'), /\.query\(|INSERT|UPDATE|DELETE|createRole|grantRole/);
});
test('readiness and entry handlers parse without importing deployment modules', () => {
  for (const file of ['routes/experience.js', 'routes/package-smoke.js', 'ui/config.js', 'ui/home-attention.js']) new vm.Script(read(file), { filename: file });
});

test('attention composition is scoped to the exact Home document and retains other factory methods', () => {
  const modules = { roomTabs: () => 'Original tabs' }, shared = { create: () => modules, LOCATION_SETTINGS: '/original/settings' };
  const foreign = { window: { HOMEBASE_MODULES: shared }, document: { body: { dataset: { experienceApp: 'business-experience' } } } };
  vm.runInNewContext(read('ui/home-attention.js'), foreign);
  assert.equal(foreign.window.HOMEBASE_MODULES, shared);
  const home = { window: { HOMEBASE_MODULES: shared }, document: { body: { dataset: { experienceApp: 'home-experience' } } } };
  vm.runInNewContext(read('ui/home-attention.js'), home);
  assert.equal(home.window.HOMEBASE_MODULES.LOCATION_SETTINGS, shared.LOCATION_SETTINGS);
  assert.equal(home.window.HOMEBASE_MODULES.create({ key: 'company' }), modules);
  const state = { page: 'tasks' }, composed = home.window.HOMEBASE_MODULES.create({ key: 'family', state });
  assert.equal(composed.roomTabs(), 'Original tabs');
  state.page = 'files'; assert.equal(composed.roomTabs(), 'Original tabs');
  state.page = 'tool'; assert.equal(composed.roomTabs(), 'Original tabs');
});

/** Complete shipped role membership is an independent consumer contract, not a catalog mirror. */
test('each named application role includes the whole bundle without component selections', () => {
  const manifest = read('oshal-app.yaml');
  const required = ["purchasing", "home", "finance", "little-monsters", "movies", "spotify", "travel", "presentations", "calendar", "circuit-lab"];
  const dependencyBlock = manifest.slice(manifest.indexOf('dependencies:'), manifest.indexOf('authorization:'));
  const requiredRows = dependencyBlock.split('  optional:')[0].match(/^      - .+$/gm) || [];
  assert.deepEqual(requiredRows.map(row => row.trim().slice(2)), required);
  assert.match(dependencyBlock, /optional:\r?\n    apps: \[\]/);
  const roleBlock = manifest.slice(manifest.indexOf('  roleTemplates:'), manifest.indexOf('routes:'));
  const bundles = roleBlock.split(/    - id: /).slice(1);
  assert.deepEqual(bundles.map(row => row.split(/\r?\n/)[0]), ["adult", "child", "guest"]);
  for (const bundle of bundles) {
    assert.match(bundle, /      version: 2/);
    const apps = [...bundle.matchAll(/        - app: ([a-z0-9-]+)/g)].map(match => match[1]);
    assert.deepEqual(apps, ['home-experience', ...required]);
    assert.equal(new Set(apps).size, apps.length);
  }
});

test('household guest receives the same learning components with the ordinary student role', () => {
  const guest = read('oshal-app.yaml').split('    - id: guest')[1].split('routes:')[0];
  assert.match(guest, /app: little-monsters\r?\n          role: student/);
  assert.match(guest, /app: circuit-lab\r?\n          role: '@app-admin'/);
  assert.doesNotMatch(guest, /role: (teacher|admin)\b/);
});
