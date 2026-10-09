/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 0.7.0: the ADR-149 catalog covers the package exactly. Every literal route under every manifest mount (plus GET /assets/<surface script>) matches exactly ONE http binding under the kernel's segment rule (an unbound route is denied authorization_operation_unbound and two matches deny too; oshal-app validate reads the catalog alone and cannot see a forgotten route), and every binding serves a route; the person's routes and the print service share their common paths through one binding; every manifest tool has exactly one tools binding; the bots binding is the operator bot; the photo intake is the one artifact action; exactly the four read tools are read-only and the print tool needs print.send; and every bound permission exists and is granted by the maker role at scope own. Plain Node: it runs in the bare store CI.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | 0.7.0 review: the operator persona's authorizations name exactly the manifest's five tools (the four reads auto, print-to-3d-printer ask) plus bash and write_file off, so the install seeds the printer bot's agent_tools rows; without the block every call is refused as unregistered.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PKG, readCatalog, readManifest, mountedRoutes, relativeToMount, matchBindings } = require('./catalog.fixture.cjs');

const READ_ONLY_TOOLS = ['scan-to-print-capabilities', 'print-service-jobs', 'print-service-printers', 'print-service-printer-status'];
const MOUNTS = ['/api/scan-to-print/service', '/api/scan-to-print/home-summary', '/api/scan-to-print/_smoke', '/api/scan-to-print'];

test('every literal route under every manifest mount matches exactly one http binding, and every binding serves a route', () => {
  const catalog = readCatalog();
  const mounts = readManifest().mounts.map((m) => m.mountPath);
  assert.deepEqual(mounts, MOUNTS);
  const rows = mountedRoutes().map((row) => ({ ...row, relative: relativeToMount(row.request, mounts) }))
    .map((row) => ({ ...row, matches: matchBindings(catalog.http, row.method, row.relative) }));
  assert.equal(rows.length, 36, 'six print service routes, Home, the smoke, the app, three scripts, capabilities, 15 object routes and 8 printer routes');
  const describe = (row) => `${row.method} ${row.request} (${row.file} "${row.pattern}") -> ${row.relative}`;
  assert.deepEqual(rows.filter((row) => row.matches.length === 0).map(describe), [], 'an unbound route is denied authorization_operation_unbound');
  assert.deepEqual(rows.filter((row) => row.matches.length > 1).map(describe), [], 'two matching bindings deny the request');
  const used = new Set(rows.map((row) => row.matches[0].id));
  assert.deepEqual(catalog.http.filter((binding) => !used.has(binding.id)).map((binding) => binding.id), [], 'a binding no route serves is a typo');
  assert.equal(catalog.http.length, 32);
  const root = rows.filter((row) => row.relative === '/');
  assert.deepEqual(root.map((row) => row.mount).sort(), ['/api/scan-to-print/_smoke', '/api/scan-to-print/home-summary']);
  const shared = rows.filter((row) => row.mount === '/api/scan-to-print/service' && rows.some((other) => other.mount === '/api/scan-to-print' && other.method === row.method && other.relative === row.relative));
  assert.deepEqual(shared.map((row) => `${row.method} ${row.relative}`).sort(), ['GET /jobs', 'GET /printers', 'POST /jobs/p6/print'].sort(),
    'the print service shares exactly these operations with the person\'s routes, through one binding each');
});

test('opening needs app.open, object changes scan.edit, printer settings printer.manage, every print print.send; unknown paths and dot segments are unbound', () => {
  const catalog = readCatalog();
  const mounts = readManifest().mounts.map((m) => m.mountPath);
  const need = (method, request) => matchBindings(catalog.http, method, relativeToMount(request, mounts)).map((b) => b.allOf.join('+'));
  const id = '00000000-0000-4000-8000-000000000000';
  assert.deepEqual(need('GET', '/api/scan-to-print/app'), ['app.open']);
  assert.deepEqual(need('GET', '/api/scan-to-print/assets/scan-to-print-camera.js'), ['app.open']);
  assert.deepEqual(need('POST', '/api/scan-to-print/jobs'), ['scan.edit']);
  assert.deepEqual(need('POST', `/api/scan-to-print/jobs/${id}/reconstruct`), ['scan.edit']);
  assert.deepEqual(need('GET', `/api/scan-to-print/jobs/${id}/artifacts/stl`), ['scan.read']);
  assert.deepEqual(need('POST', '/api/scan-to-print/printers'), ['printer.manage']);
  assert.deepEqual(need('PATCH', `/api/scan-to-print/printers/${id}`), ['printer.manage'], 'auto-start is a printer setting');
  assert.deepEqual(need('POST', `/api/scan-to-print/printers/${id}/status`), ['scan.read']);
  assert.deepEqual(need('GET', `/api/scan-to-print/service/printers/${id}/status`), ['scan.read']);
  assert.deepEqual(need('POST', `/api/scan-to-print/jobs/${id}/print`), ['print.send']);
  assert.deepEqual(need('POST', `/api/scan-to-print/service/jobs/${id}/print`), ['print.send']);
  assert.deepEqual(need('POST', '/api/scan-to-print/service/print'), ['print.send']);
  assert.deepEqual(need('GET', `/api/scan-to-print/jobs/${id}/artifacts/..`), [], 'a dot segment never matches a parameter');
  assert.deepEqual(need('GET', '/api/scan-to-print/unknown'), [], 'an unknown path is unbound, so the kernel refuses it');
  assert.deepEqual(need('PATCH', '/api/scan-to-print/service/printers/' + id), ['printer.manage'], 'a service caller cannot reach a printer setting: no service route serves it, and the binding still needs printer.manage');
});

test('tools, bots and artifact actions: one binding per manifest declaration and none for anything else', () => {
  const catalog = readCatalog();
  const manifest = readManifest();
  assert.equal(manifest.tools.length, 5);
  assert.deepEqual(catalog.tools.map((binding) => binding.id), manifest.tools, 'one binding per tool, in manifest order');
  assert.deepEqual(catalog.bots.map((binding) => binding.id), manifest.bots);
  assert.deepEqual(catalog.bots.map((binding) => binding.allOf), [['scan.read']]);
  assert.deepEqual(catalog.artifactActions.map((binding) => binding.id), manifest.accepts);
  assert.deepEqual(catalog.artifactActions.map((binding) => binding.allOf), [['app.open', 'scan.edit']], 'a photo sent here opens the app and creates an object');
});

test('exactly the four read tools are read-only, so Jarvis proposes every print as an ask', () => {
  const catalog = readCatalog();
  const readOnly = catalog.tools.filter((binding) => binding.allOf.every((permission) => catalog.permissions[permission].effect === 'read')).map((binding) => binding.id);
  assert.deepEqual(readOnly.sort(), [...READ_ONLY_TOOLS].sort());
  assert.deepEqual(catalog.tools.find((binding) => binding.id === 'print-to-3d-printer').allOf, ['print.send']);
  assert.equal(catalog.permissions['print.send'].effect, 'execute');
});

test('every bound permission exists and the maker role grants each one at scope own', () => {
  const catalog = readCatalog();
  assert.deepEqual(Object.keys(catalog.permissions).sort(), ['app.open', 'print.send', 'printer.manage', 'scan.edit', 'scan.read']);
  assert.deepEqual(catalog.grants.map((grant) => grant.scope), Array(catalog.grants.length).fill('own'));
  const granted = new Set(catalog.grants.map((grant) => grant.permission));
  const bound = new Set([...catalog.http, ...catalog.tools, ...catalog.bots, ...catalog.artifactActions].flatMap((binding) => binding.allOf));
  for (const permission of bound) {
    assert.ok(catalog.permissions[permission], `${permission} is declared`);
    assert.ok(granted.has(permission), `${permission} is granted by maker`);
  }
  assert.deepEqual([...granted].sort(), Object.keys(catalog.permissions).sort(), 'maker carries the whole app, as @app-admin did');
});

test('the operator persona is assigned exactly the manifest tools: reads auto, print ask, shell and file writes off', () => {
  const text = fs.readFileSync(path.join(PKG, 'personas', 'scan-to-print-operator.yaml'), 'utf8').split(/\r?\n/);
  const start = text.indexOf('authorizations:');
  assert.ok(start >= 0, 'without authorizations: the install seeds no agent_tools rows and every call is refused');
  const modes = {};
  for (const line of text.slice(start + 1)) {
    if (!line.startsWith('  ')) break;
    const m = /^ {2}([a-z0-9_-]+): "(auto|ask|off)"$/.exec(line);
    if (!m) throw new Error(`unreadable authorization line: ${line}`);
    modes[m[1]] = m[2];
  }
  const tools = readManifest().tools;
  assert.deepEqual(Object.keys(modes).filter((name) => tools.includes(name)), tools, 'every manifest tool, in manifest order');
  assert.deepEqual(tools.map((name) => modes[name]), tools.map((name) => (READ_ONLY_TOOLS.includes(name) ? 'auto' : 'ask')));
  assert.deepEqual(Object.fromEntries(Object.entries(modes).filter(([name]) => !tools.includes(name))), { bash: 'off', write_file: 'off' });
});
