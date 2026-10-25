/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify owned Home entry/configuration, exact references and deliberate member roles without deployment credentials.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Bind attention asset order, default priorities and package-scoped factory composition without treating source contracts as installed proof.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Pin every complete role to the complete functional component bundle without optional choices.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Guard that the entry loads the shared routine reader (live-views.js) before homebase-data.js; without it Routines answered routine_reader_missing.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Sweep 12: the page title is the application's display name alone (it read '<name> · your swarm', which the concierge repeated as the screen's name).
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Prove every template covers the actual transitive required application closure, including Little Monsters Email, with an exact reviewed role.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Mirror native import's direct declaration requirement for every role template member, independently of transitive closure coverage.
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
  const required = ["purchasing", "home", "finance", "little-monsters", "movies", "spotify", "travel", "presentations", "calendar", "circuit-lab", "email-summarizer"];
  const dependencyBlock = manifest.slice(manifest.indexOf('dependencies:'), manifest.indexOf('authorization:'));
  const requiredRows = dependencyBlock.split('  optional:')[0].match(/^      - .+$/gm) || [];
  assert.deepEqual(requiredRows.map(row => row.trim().slice(2)), required);
  assert.match(dependencyBlock, /optional:\r?\n    apps: \[\]/);
  const roleBlock = manifest.slice(manifest.indexOf('  roleTemplates:'), manifest.indexOf('routes:'));
  const bundles = roleBlock.split(/    - id: /).slice(1);
  assert.deepEqual(bundles.map(row => row.split(/\r?\n/)[0]), ["adult", "child", "guest"]);
  for (const bundle of bundles) {
    assert.match(bundle, /      version: 3/);
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

/** The Routines page reads schedules through window.OSHAL_LIVE_VIEWS; homebase-data.js refuses with routine_reader_missing without it. */
test('entry loads the shared routine reader before the homebase data client', () => {
  const scripts = [...read('ui/index.html').matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1]);
  const reader = scripts.indexOf('/experience/live-views.js');
  const data = scripts.indexOf('/experience/homebase-data.js');
  assert.ok(data >= 0, 'the entry loads /experience/homebase-data.js');
  assert.ok(reader >= 0, 'the entry loads /experience/live-views.js');
  assert.ok(reader < data, 'live-views.js loads before homebase-data.js');
});

/** Sweep 12: the docked frame's title reaches the concierge as the screen's name, so it is the application's own name. */
test('the page title is the application display name, nothing more', () => {
  const fsx = require('node:fs'), px = require('node:path'), dir = px.resolve(__dirname, '..');
  const name = fsx.readFileSync(px.join(dir, 'oshal-app.yaml'), 'utf8').match(/^displayName: *(.+)$/m)[1].trim();
  const title = fsx.readFileSync(px.join(dir, 'ui', 'index.html'), 'utf8').match(/<title>([^<]*)<\/title>/)[1];
  require('node:assert/strict').equal(title, name);
});

/** Required component changes must invalidate every incomplete enclosing role template. */
test('every template maps the real transitive dependency closure including personal Email', async () => {
  const { readManifestDependencies } = await import('../../scripts/manifest-dependencies.mjs');
  const store = path.dirname(root), required = new Set();
  const visit = (app) => {
    if (required.has(app)) return;
    required.add(app);
    const source = fs.readFileSync(path.join(store, app, 'oshal-app.yaml'), 'utf8');
    const parsed = readManifestDependencies(source, app);
    assert.deepEqual(parsed.problems, [], `${app} has readable dependency declarations`);
    for (const child of parsed.dependencies?.apps || []) visit(child);
  };
  visit(path.basename(root));
  assert.ok(required.has('email-summarizer'), 'the actual Little Monsters dependency reaches Email');
  const templates = read('oshal-app.yaml').split('  roleTemplates:')[1].split('routes:')[0].split(/    - id: /).slice(1);
  for (const template of templates) {
    const name = template.split(/\r?\n/)[0];
    const members = [...template.matchAll(/        - app: ([a-z0-9-]+)\r?\n          role: ['"]?([^'"\r\n]+)['"]?/g)];
    const mapped = members.map(member => member[1]);
    assert.deepEqual([...mapped].sort(), [...required].sort(), `${name} maps every actual required application exactly once`);
    assert.equal(members.find(member => member[1] === 'email-summarizer')?.[2], '@app-admin', `${name} reviews Email's existing package role`);
    assert.match(template, /      version: 3\b/, `${name} advances the changed role contract`);
  }
});

/** Native import accepts exact role members only from the owner's explicit declarations. */
test('each template member is the owner or a directly declared application', async () => {
  const { readManifestDependencies } = await import('../../scripts/manifest-dependencies.mjs');
  const manifest = read('oshal-app.yaml');
  const parsed = readManifestDependencies(manifest, path.basename(root));
  assert.deepEqual(parsed.problems, []);
  const declared = new Set([path.basename(root), ...(parsed.dependencies?.apps || []), ...(parsed.dependencies?.optional?.apps || [])]);
  const templates = manifest.split('  roleTemplates:')[1].split('routes:')[0].split(/    - id: /).slice(1);
  for (const template of templates) {
    const name = template.split(/\r?\n/)[0];
    const members = [...template.matchAll(/        - app: ([a-z0-9-]+)\r?\n          role: ['"]?([^'"\r\n]+)['"]?/g)];
    for (const member of members) assert.ok(declared.has(member[1]), `${name}: ${member[1]} must be a directly declared application before native import`);
    assert.equal(new Set(members.map(member => `${member[1]}:${member[2]}`)).size, members.length, `${name} has distinct exact roles`);
  }
});
