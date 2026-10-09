/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify owned entry/configuration and declared supported references without deployment credentials.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Verify the complete shared product, exact ordinary role unions, active component declarations and current required dependency coverage.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Scan to Print's member role is its catalog's `maker` (0.7.0 adopts an ADR-149 catalog); manifest 1.1.1 and template version 3.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Require the current named Jarvis chat-user and complete template4 rights across all four layouts.
 */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('owned Studio display and shared engine contract',()=>{const context={window:{}};vm.runInNewContext(read('ui/config.js'),context);const config=context.window.OSHAL_EXPERIENCE_CONFIG;assert.equal(config.labels.studio,'Studio');assert.equal(config.catalog,'current-caller');assert.match(read('ui/index.html'),/data-experience-app="studio-experience"/);assert.ok(read('ui/index.html').includes('/api/studio-experience/assets/config.js'));assert.ok(read('ui/studio.css').includes('data-skin="studio"'));});
test('host role catalog has no business write or tenant-sharing permission',()=>{assert.match(read('authorization.yaml'),/minimumTier: viewer/);assert.doesNotMatch(read('authorization.yaml'),/effect: (write|execute|delete)/);assert.doesNotMatch(read('routes/experience.js'),/\.query\(|INSERT|UPDATE|DELETE|createRole|grantRole/);assert.match(read('oshal-app.yaml'),/experience-roles/);});
test('entry handlers and display configuration parse',()=>{for(const file of ['routes/experience.js','routes/package-smoke.js','ui/config.js'])new vm.Script(read(file),{filename:file});});

// The core checkout supplies the canonical YAML parser, just as the registered runtime proof does.
const { createRequire } = require('node:module');
const framework = path.resolve(process.env.OSHAL_FRAMEWORK || process.env.OSHAL_ROOT || path.join(root, '../../oshal-dev'));
const yaml = createRequire(path.join(framework, 'package.json'))('js-yaml');
const { readAppDependencies } = require(path.join(framework, 'scripts/oshal-app-dependencies.js'));
const manifest = yaml.load(read('oshal-app.yaml'));
const template = manifest.experience.roleTemplates[0];
const components = 'home purchasing finance little-monsters movies spotify travel presentations calendar email-summarizer world switchboard social calling-assistant marketing-engine venture-plan private-app-1 payroll payments identity cad-studio circuit-lab create portrait-studio video lora vids creative-studio scan-to-print storage career-hunter dnd game-show games jarvis workflow-studio private-app-2 intelligent-sales private-app-3'.split(' ');
const ordinaryRoles = {
  jarvis: ['chat-user'], 'scan-to-print': ['maker'],
  'little-monsters': ['student'], 'calling-assistant': ['caller'], 'venture-plan': ['member'], 'private-app-1': ['crm_representative'], 'intelligent-sales': ['sales_manager'], 'private-app-3': ['administrator'],
  create: ['creator', 'editor', 'exporter', 'generator'], 'portrait-studio': ['creator', 'editor', 'deleter', 'mailer', 'artist'],
  video: ['producer', 'creator', 'editor', 'exporter'], lora: ['trainer'], 'career-hunter': ['member'],
};
const expectedMembers = [{ app: manifest.name, role: 'member' }, ...components.flatMap(app => (ordinaryRoles[app] || ['@app-admin']).map(role => ({ app, role })))];
const componentManifest = name => {
  const file = name === 'jarvis' || name === 'workflow-studio' ? path.join(framework, 'swarm-apps', name + '.yaml') : path.join(root, '..', name, 'oshal-app.yaml');
  return { file, directory: ['jarvis', 'workflow-studio'].includes(name) ? framework : path.dirname(file), manifest: yaml.load(fs.readFileSync(file, 'utf8')) };
};
test('one complete product role includes every functional component, without optional setup', () => {
  assert.equal(manifest.version, '1.1.2'); assert.equal(template.version, 4);
  assert.deepEqual(manifest.dependencies.required.apps, components);
  assert.deepEqual(manifest.dependencies.optional.apps, []); assert.equal(components.length, 39);
  assert.deepEqual(template.members, expectedMembers); assert.equal(template.members.length, 50);
  assert.ok(template.members.every(({ role }) => !['@access-admin', '@access-auditor', 'admin', 'manager', 'teacher'].includes(role)));
});
test('four layouts share the same product rights instead of granting one empty shell', () => {
  for (const skin of ['studio', 'jarvis', 'orbit', 'commons']) {
    const other = yaml.load(fs.readFileSync(path.join(root, '..', skin + '-experience', 'oshal-app.yaml'), 'utf8'));
    assert.deepEqual(other.dependencies.required.apps, components);
    assert.deepEqual(other.experience.roleTemplates[0].members.slice(1), expectedMembers.slice(1));
  }
});
test('public component roles exist and include their current required package closure', () => {
  for (const name of components.filter(name => !['private-app-1', 'private-app-2', 'intelligent-sales', 'private-app-3'].includes(name))) {
    const source = componentManifest(name); assert.equal(source.manifest.name, name); assert.equal(source.manifest.status, 'active');
    assert.notEqual(source.manifest.scope, 'operator'); assert.notEqual(source.manifest.scope, 'deployment');
    for (const dependency of readAppDependencies(source.manifest).required.apps) assert.ok(components.includes(dependency), name + ' requires ' + dependency);
    const declaration = source.manifest.authorization;
    const catalog = declaration ? yaml.load(fs.readFileSync(path.join(source.directory, declaration.catalog), 'utf8')) : null;
    for (const role of ordinaryRoles[name] || ['@app-admin']) {
      if (role === '@app-admin') assert.equal(catalog, null, name + ' must use its named catalog when present');
      else { assert.ok(catalog.roles[role], name + ':' + role); assert.notEqual(catalog.roles[role].tier, 'admin'); }
    }
  }
});
test('ordinary creative roles cover creating, editing, generation and export as distinct permissions', () => {
  const needs = { create: ['project.create', 'project.change', 'project.export', 'project.generate', 'brand.read', 'brand.change'],
    'portrait-studio': ['portrait.create', 'portrait.change', 'portrait.delete', 'portrait.export', 'portrait.email', 'portrait.artist'],
    video: ['studio.generate', 'editor.create', 'editor.change', 'editor.export'] };
  for (const [name, required] of Object.entries(needs)) {
    const source = componentManifest(name), catalog = yaml.load(fs.readFileSync(path.join(source.directory, source.manifest.authorization.catalog), 'utf8'));
    const permissions = new Set(ordinaryRoles[name].flatMap(role => catalog.roles[role].grants.map(grant => grant.permission)));
    for (const permission of required) assert.ok(permissions.has(permission), name + ':' + permission);
    assert.ok(ordinaryRoles[name].flatMap(role => catalog.roles[role].grants).every(grant => grant.scope === 'own'));
  }
});
