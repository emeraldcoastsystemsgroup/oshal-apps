/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 0.2.0: the ADR-149 catalog covers the package exactly. Every literal route in src-routes (plus GET /assets/<surface script>) under every manifest mount matches exactly ONE http binding under the kernel's segment rule (an unbound route is denied authorization_operation_unbound and two matches deny too; oshal-app validate reads the catalog alone and cannot see a forgotten route), and every binding serves a route; every manifest tool has exactly one tools binding and no binding names an undeclared tool; the bots binding is the manifest's director; exactly the 7 read tools are read-only, which is what Jarvis may propose without asking; and every bound permission exists and is granted by the creator role at scope own. Plain Node: it runs in the bare store CI.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readCatalog, readManifest, mountedRoutes, relativeToMount, matchBindings } = require('./catalog.fixture.cjs');

const READ_ONLY_TOOLS = ['scene-capabilities', 'scene-list-projects', 'scene-get-project', 'scene-read-file',
  'blender-file-summary', 'blender-docs', 'scene-inspect-object'];

test('every literal route under every manifest mount matches exactly one http binding, and every binding serves a route', () => {
  const catalog = readCatalog();
  const mounts = readManifest().mounts.map((m) => m.mountPath);
  assert.deepEqual(mounts, ['/api/scene-studio/home-summary', '/api/scene-studio/_smoke', '/api/scene-studio']);
  const rows = mountedRoutes().map((row) => ({ ...row, relative: relativeToMount(row.request, mounts) }))
    .map((row) => ({ ...row, matches: matchBindings(catalog.http, row.method, row.relative) }));
  assert.equal(rows.length, 28, 'home summary, smoke, app, three editor asset scripts, capabilities and the 21 project routes');
  const describe = (row) => `${row.method} ${row.request} (${row.file} "${row.pattern}") -> ${row.relative}`;
  assert.deepEqual(rows.filter((row) => row.matches.length === 0).map(describe), [], 'an unbound route is denied authorization_operation_unbound');
  assert.deepEqual(rows.filter((row) => row.matches.length > 1).map(describe), [], 'two matching bindings deny the request');
  const used = new Set(rows.map((row) => row.matches[0].id));
  assert.deepEqual(catalog.http.filter((binding) => !used.has(binding.id)).map((binding) => binding.id), [], 'a binding no route serves is a typo');
  assert.equal(catalog.http.length, 27);
  const root = rows.filter((row) => row.relative === '/');
  assert.deepEqual(root.map((row) => row.mount).sort(), ['/api/scene-studio/_smoke', '/api/scene-studio/home-summary']);
  assert.deepEqual([...new Set(root.map((row) => row.matches[0].allOf.join()))], ['scene.read'], 'Home and the readiness smoke need scene.read');
});

test('opening needs app.open, writes scene.edit, runs scene.run, downloads scene.export; unknown paths and dot segments are unbound', () => {
  const catalog = readCatalog();
  const mounts = readManifest().mounts.map((m) => m.mountPath);
  const need = (method, request) => matchBindings(catalog.http, method, relativeToMount(request, mounts)).map((b) => b.allOf.join('+'));
  const id = '/api/scene-studio/projects/00000000-0000-4000-8000-000000000000';
  assert.deepEqual(need('GET', '/api/scene-studio/app'), ['app.open']);
  assert.deepEqual(need('POST', '/api/scene-studio/projects'), ['scene.edit']);
  assert.deepEqual(need('DELETE', id), ['scene.edit']);
  assert.deepEqual(need('POST', `${id}/files/read`), ['scene.read']);
  assert.deepEqual(need('PUT', `${id}/files`), ['scene.edit']);
  assert.deepEqual(need('POST', `${id}/blender/execute_blender_code_for_cli`), ['scene.edit+scene.run']);
  assert.deepEqual(need('POST', `${id}/run`), ['scene.run']);
  assert.deepEqual(need('POST', `${id}/export`), ['scene.export']);
  assert.deepEqual(need('GET', `${id}/files/download`), ['scene.read+scene.export']);
  assert.deepEqual(need('GET', `${id}/artifacts/..`), [], 'a dot segment never matches a parameter');
  assert.deepEqual(need('GET', '/api/scene-studio/unknown'), [], 'an unknown path is unbound, so the kernel refuses it');
});

test('tools and bots: one binding per manifest tool, none for anything else, and the director is the one bound bot', () => {
  const catalog = readCatalog();
  const manifest = readManifest();
  assert.equal(manifest.tools.length, 24);
  assert.deepEqual(catalog.tools.map((binding) => binding.id), manifest.tools, 'one binding per tool, in manifest order');
  assert.equal(new Set(catalog.tools.map((binding) => binding.id)).size, catalog.tools.length);
  assert.deepEqual(catalog.bots.map((binding) => binding.id), manifest.bots);
  assert.deepEqual(catalog.bots.map((binding) => binding.allOf), [['scene.read']], 'the director can inspect; unsafe tools separately require run');
});

test('exactly the 7 read tools are read-only, so Jarvis proposes every write, run and export as an ask', () => {
  const catalog = readCatalog();
  const readOnly = catalog.tools.filter((binding) => binding.allOf.every((permission) => catalog.permissions[permission].effect === 'read')).map((binding) => binding.id);
  assert.deepEqual(readOnly.sort(), [...READ_ONLY_TOOLS].sort());
});

test('every bound permission exists and the creator role grants each one at scope own', () => {
  const catalog = readCatalog();
  assert.deepEqual(Object.keys(catalog.permissions).sort(), ['app.open', 'scene.edit', 'scene.export', 'scene.read', 'scene.run']);
  assert.deepEqual(catalog.grants.map((grant) => grant.scope), Array(catalog.grants.length).fill('own'));
  const granted = new Set(catalog.grants.map((grant) => grant.permission));
  const bound = new Set([...catalog.http, ...catalog.tools, ...catalog.bots].flatMap((binding) => binding.allOf));
  for (const permission of bound) {
    assert.ok(catalog.permissions[permission], `${permission} is declared`);
    assert.ok(granted.has(permission), `${permission} is granted by creator`);
  }
  assert.deepEqual([...granted].sort(), Object.keys(catalog.permissions).sort(), 'creator carries the whole app, as @app-admin did');
});

// Every Godot MCP operation imports a caller-editable project, including nominal reads.
test('source editors cannot trigger Godot import or arbitrary code through nominal reads', () => {
  const catalog = readCatalog();
  for (const binding of [...catalog.http, ...catalog.tools].filter(b => b.id.startsWith('godot-') || ['import-model','scene-import-model','blender-tool','blender-run-python'].includes(b.id))) {
    assert.ok(binding.allOf.includes('scene.run'), binding.id);
  }
  for (const id of ['file-read','file-write','object-inspect','object-edit','export']) {
    assert.ok(!catalog.http.find(b => b.id === id).allOf.includes('scene.run'), id);
  }
});
