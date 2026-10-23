/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | The catalog-validator case needs the old TypeScript platform's scripts/oshal-test-catalog.js, which the store gate's own toolchain (OSHAL_ROOT = scripts/toolchain) does not carry. It now reports SKIPPED naming that legacy loader instead of throwing; js-yaml still comes from OSHAL_ROOT and every other case runs.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Parse the package's own Test Lab catalog: an unquoted colon in a case description made the loader fail the whole package closed on the dev box
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The answer is served on the already-bound /class-tool-keys (a new binding cannot activate where assignments exist), so the guard follows that route and the restored catalog
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The tool-keys visibility answer: the static surface names are read from this package's own manifest (never a second list), learners are not offered the teacher-only surfaces, teachers and admins get every surface, and the catalog binds the route and the class-material import the rail relies on
 * 2   | maintainer@emeraldcoastsystemsgroup.com | Learners see Record (they record into their own class), Email and Storage; only Teacher stays teacher-only.
 * -----------------------------------------------------------------------------
 *
 * Runs against the COMPILED route module (what the loader mounts). Needs OSHAL_ROOT for js-yaml, like
 * the other core-backed guards; without it the suite fails loudly instead of skipping.
 *
 * @module lm-tool-keys.test
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const OSHAL_ROOT = process.env.OSHAL_ROOT;
assert.ok(OSHAL_ROOT && fs.existsSync(path.join(OSHAL_ROOT, 'node_modules', 'js-yaml')), 'set OSHAL_ROOT to a core checkout (js-yaml is read from there)');
const yaml = require(path.join(OSHAL_ROOT, 'node_modules', 'js-yaml'));

// The compiled module imports framework paths (@/...) and express; stub them the way the compiled authz
// suites do (Module._load interception), and stub its sibling modules: only the two pure exports are under test.
const Module = require('node:module');
const fakeRouter = () => { const r = {}; for (const m of ['get', 'post', 'put', 'patch', 'delete', 'use']) r[m] = () => r; return r; };
const STUBS = {
  express: { Router: fakeRouter, static: () => () => {} },
  '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
  '@/app/routes/tool-routes': { registerDynamicToolUI() {}, deregisterDynamicToolUI() {} },
  './education-access': { assertClassAccess() {}, assertTeacherOfClass() {}, EducationAccessError: class extends Error {}, listAccessibleClassIds: async () => [], resolveAuthedStudent: async () => null },
  './education-material-storage': { deleteMaterialCollection: async () => {}, deleteStoredMaterial() {} },
};
const originalLoad = Module._load;
Module._load = function loadWithFrameworkStubs(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return originalLoad.call(this, request, ...rest);
};
let routes;
try { routes = require(path.join(PACKAGE_ROOT, 'routes', 'education-class-routes.js')); } finally { Module._load = originalLoad; }

const manifest = yaml.load(fs.readFileSync(path.join(PACKAGE_ROOT, 'oshal-app.yaml'), 'utf8'));
const declared = manifest.ui.static.map(s => s.toolName);

// The loader lives in the old TypeScript platform checkout, not in a node_modules toolchain.
const CATALOG_LOADER = path.join(OSHAL_ROOT, 'scripts', 'oshal-test-catalog.js');
const LEGACY_LOADER = fs.existsSync(CATALOG_LOADER) ? false
  : `LEGACY: needs the old TypeScript platform checkout's scripts/oshal-test-catalog.js (OSHAL_ROOT=${OSHAL_ROOT} has none)`;

test('the Test Lab catalog this package declares passes the loader\x27s own validator (it fails the whole package closed otherwise)', { skip: LEGACY_LOADER }, () => {
  // The same script the api runs at activation (scripts/oshal-test-catalog.js): YAML, schema, prerequisite ids, referenced files.
  const validator = require(CATALOG_LOADER);
  const loaded = validator.loadPackageTestCatalog(PACKAGE_ROOT, manifest);
  assert.ok(loaded && loaded.catalog && loaded.catalog.cases.some(c => c.id === 'lm-tool-keys'));
});

test('the static surface names come from the manifest itself', () => {
  assert.deepEqual(routes.readStaticToolNames(PACKAGE_ROOT), declared);
  assert.ok(declared.includes('lm-teacher') && declared.includes('lm-recorder') && declared.includes('lm-dashboard'));
  assert.deepEqual(routes.readStaticToolNames(path.join(PACKAGE_ROOT, 'no-such-dir')), [], 'an unreadable manifest admits nothing');
});

test('learners are not offered the teacher-only surfaces; teachers and admins get every surface', () => {
  const learner = routes.visibleStaticToolNames('student', declared);
  assert.ok(!learner.includes('lm-teacher'));
  assert.ok(learner.includes('lm-recorder'), 'a student records into a class they own');
  assert.ok(learner.includes('lm-email') && learner.includes('lm-storage'), 'the email viewer and file browser are offered to learners');
  assert.deepEqual(learner, declared.filter(n => n !== 'lm-teacher'));
  assert.deepEqual(routes.visibleStaticToolNames('teacher', declared), declared);
  assert.deepEqual(routes.visibleStaticToolNames('admin', declared), declared);
});

test('the manifest rule covers every lm-* tool through the already-bound class-tool-keys route', () => {
  assert.equal(manifest.ui.dynamic.visibility.endpoint, '/api/education/class-tool-keys');
  assert.equal(manifest.ui.dynamic.visibility.pattern, 'lm-*');
  const catalog = yaml.load(fs.readFileSync(path.join(PACKAGE_ROOT, 'authorization.yaml'), 'utf8'));
  const http = catalog.bindings.http;
  assert.ok(http.some(b => b.method === 'GET' && b.path === '/class-tool-keys'), 'GET /class-tool-keys bound');
  assert.ok(!http.some(b => b.path === '/tool-keys'), 'no unbound tool-keys route is advertised');
  assert.ok(manifest.migrations.includes('migrations/038-rewards.sql'), 'rewards migration listed');
});
