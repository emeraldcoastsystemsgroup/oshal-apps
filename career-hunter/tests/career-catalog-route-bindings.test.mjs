/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard-per-fix for the unbound Companies surface (1.25.1 review): every literal route this package registers (router.get/post/put/delete/patch in src-routes/*.ts, under every manifest mount whose module reaches it) must match exactly one authorization.yaml http binding under the kernel's segment rule, so a route the catalog forgets goes red here. oshal-app validate reads the catalog alone and passed with GET /companies-admin unbound, which under enforce answered the operator's Companies page 403 authorization_operation_unbound. The rule is mirrored in tests/helpers/career-route-bindings.cjs and held to the kernel's real matcher by tests/career-rail-kernel-boundary.core.test.js.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Pin the two 1.26.0 removals by name: DELETE /stories/test-lab/:tag and DELETE /jobs/:id/packet each match exactly one binding, that binding needs career.change (a state write, never the execute permission that spends provider money), and no other route answers to either path.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Pin the 1.27.0 Test Lab application seam the same way: POST /test-lab/applications and DELETE /test-lab/applications/:postingId/:tag each match exactly one binding, that binding needs career.change, and both live in career-test-lab-applications.ts. The DELETE-binding census grows by exactly that one removal.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Prove JavaScript module import closure is inspected and the declared native tool-only reader has genuine registration source, without relaxing any HTTP authorization census.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {mkdtempSync, rmSync, writeFileSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const require = createRequire(import.meta.url);
const bindings = require('./helpers/career-route-bindings.cjs');

const describe = (row) => `${row.method} ${row.request} (${row.file} "${row.pattern}" under ${row.mount}) -> ${row.relative}`;

test('JavaScript manifest modules retain relative-import HTTP coverage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-js-route-enumeration-'));
  try {
    const entry = join(dir, 'entry.js'), child = join(dir, 'child.js');
    writeFileSync(entry, "require('./child.js'); router.get('/native-read', handler);");
    writeFileSync(child, "router.post('/native-write', handler);");
    const closure = bindings.importClosure(entry);
    assert.deepEqual(new Set(closure), new Set([entry, child]));
    assert.deepEqual(closure.flatMap(bindings.literalRoutesIn).map(r => [r.method, r.pattern]).sort(),
      [['GET', '/native-read'], ['POST', '/native-write']]);
  } finally {rmSync(dir, {recursive:true, force:true});}
});

test('the native reader mount has an inspected real tool registration and no invented HTTP route', () => {
  const entry = bindings.manifestMounts().find(m => m.module === 'lib/native-career-read.js');
  assert.equal(entry?.mountPath, '/api/career-hunter');
  const file = join(bindings.PKG, entry.module);
  assert.match(readFileSync(file, 'utf8'), /ctx\.tools\.register\('career_database'/);
  assert.ok(bindings.importClosure(file).includes(file));
  assert.deepEqual(bindings.literalRoutesIn(file), []);
  assert.ok(bindings.mountedRoutes().length >= 90, 'all previously served HTTP routes remain inspected');
});

test('every literal route in src-routes is served by a manifest mount and matches exactly one catalog binding', () => {
  const mounts = bindings.manifestMounts();
  assert.ok(mounts.length >= 5, `the manifest declares the package's mounts (read ${mounts.length})`);
  const literal = bindings.routeSources().flatMap((file) => bindings.literalRoutesIn(file));
  assert.ok(literal.length >= 90, `the enumerator reads the package's routes (read ${literal.length})`);
  const mounted = new Set(bindings.mountedRoutes().map((row) => `${row.file}|${row.method}|${row.pattern}`));
  const orphans = literal.filter((row) => !mounted.has(`${row.file}|${row.method}|${row.pattern}`));
  assert.deepEqual(orphans, [], 'a route registered in a source no manifest module reaches is never mounted and never checked');

  const rows = bindings.resolvedRoutes();
  const unbound = rows.filter((row) => row.matches.length === 0).map(describe);
  const ambiguous = rows.filter((row) => row.matches.length > 1).map((row) => `${describe(row)} matches ${row.matches.map((m) => m.id).join(', ')}`);
  assert.deepEqual(unbound, [], 'the kernel denies an unmatched request authorization_operation_unbound; bind it in authorization.yaml');
  assert.deepEqual(ambiguous, [], 'the kernel binds only when exactly one binding matches; two matches deny the request');
});

test('the operator surfaces the ribbon opens are bound, page and data alike, to career.administer', () => {
  const rows = bindings.resolvedRoutes();
  const page = rows.find((row) => row.method === 'GET' && row.relative === '/companies-admin');
  assert.ok(page, 'GET /companies-admin is registered (career-company-routes.ts) and mounted');
  assert.deepEqual(page.matches.map((m) => ({ id: m.id, allOf: m.allOf })), [{ id: 'companies-admin-ui', allOf: ['career.administer'] }]);
  const list = rows.find((row) => row.method === 'GET' && row.relative === '/companies-admin/list');
  assert.deepEqual(list.matches[0].allOf, ['career.administer']);
  const status = rows.find((row) => row.mount === '/api/career-hunter/cutover' && row.relative === '/status');
  assert.deepEqual(status.matches.map((m) => m.id), ['cutover-status']);
});

test('the 1.26.0 owner-scoped removals are each bound once, to career.change', () => {
  const rows = bindings.resolvedRoutes();
  const expected = [
    ['DELETE', '/stories/test-lab/:tag', 'career-stories-routes.ts', 'stories-test-lab-remove'],
    ['DELETE', '/jobs/:id/packet', 'career-board-routes.ts', 'job-packet-remove'],
  ];
  for (const [method, pattern, file, id] of expected) {
    const served = rows.filter((row) => row.method === method && row.pattern === pattern);
    assert.equal(served.length, 1, `${method} ${pattern} is registered once and mounted once`);
    assert.ok(served[0].file.endsWith(file), `${method} ${pattern} lives in ${file}`);
    assert.deepEqual(served[0].matches.map((m) => ({ id: m.id, allOf: m.allOf })), [{ id, allOf: ['career.change'] }]);
  }
  const http = bindings.catalogHttpBindings();
  assert.deepEqual(http.filter((b) => b.method === 'DELETE').map((b) => b.id).sort(),
    ['job-packet-remove', 'recruiter-delete', 'settings-key-delete', 'settings-target-delete', 'stories-test-lab-remove',
      'test-lab-application-remove'],
    'the catalog grows by exactly these DELETE bindings (1.26.0 two, 1.27.0 one)');
});

test('the 1.27.0 Test Lab application seam is bound once per route, to career.change', () => {
  const rows = bindings.resolvedRoutes();
  const expected = [
    ['POST', '/test-lab/applications', 'test-lab-application-plant'],
    ['DELETE', '/test-lab/applications/:postingId/:tag', 'test-lab-application-remove'],
  ];
  for (const [method, pattern, id] of expected) {
    const served = rows.filter((row) => row.method === method && row.pattern === pattern);
    assert.equal(served.length, 1, `${method} ${pattern} is registered once and mounted once`);
    assert.ok(served[0].file.endsWith('career-test-lab-applications.ts'), `${method} ${pattern} lives in the seam module`);
    assert.deepEqual(served[0].matches.map((m) => ({ id: m.id, allOf: m.allOf })), [{ id, allOf: ['career.change'] }]);
  }
});

test('the classic-board wildcard is bound at every depth the catalog promises, and the kernel rule refuses one deeper', () => {
  const http = bindings.catalogHttpBindings();
  const mounts = bindings.manifestMounts().map((entry) => entry.mountPath);
  for (let depth = 1; depth <= bindings.WILDCARD_DEPTHS; depth += 1) {
    const relative = `/board/${Array.from({ length: depth }, (_v, i) => `legacy${i}`).join('/')}`;
    assert.equal(bindings.matchBindings(http, mounts, 'GET', relative).length, 1, `depth ${depth}: ${relative}`);
  }
  const deeper = `/board/${Array.from({ length: bindings.WILDCARD_DEPTHS + 1 }, (_v, i) => `legacy${i}`).join('/')}`;
  assert.equal(bindings.matchBindings(http, mounts, 'GET', deeper).length, 0, 'documented in authorization.yaml beside the classic-board bindings');
  assert.equal(bindings.sampleRequests('/board/*boardPath').length, bindings.WILDCARD_DEPTHS, 'the enumerator tries exactly the bound depths');
});

test('the mirror of the kernel rule keeps its shape: segment count, literal equality, :param exclusions, one-match rule', () => {
  const http = [{ id: 'job', method: 'GET', path: '/jobs/:id', allOf: ['career.read'] }, { id: 'jobs', method: 'GET', path: '/jobs', allOf: ['career.read'] },
    { id: 'root', method: 'GET', path: '/', allOf: ['career.read'] }];
  const mounts = ['/api/career-hunter', '/api/career-hunter/home-summary'];
  const ids = (method, relative) => bindings.matchBindings(http, mounts, method, relative).map((m) => m.id);
  assert.deepEqual(ids('GET', '/jobs/42'), ['job']);
  assert.deepEqual(ids('GET', '/jobs/stats'), ['job'], 'a literal sibling the catalog does not bind is matched by the parameter binding');
  assert.deepEqual(ids('GET', '/jobs/42/extra'), [], 'segment count must be equal');
  assert.deepEqual(ids('GET', '/jobs/..'), [], 'a parameter never takes ..');
  assert.deepEqual(ids('GET', '/jobs/'), [], 'an empty trailing segment is not a parameter value');
  assert.deepEqual(ids('POST', '/jobs/42'), [], 'method is part of the match');
  assert.deepEqual(ids('GET', '/jobs/a%20b'), [], 'an encoded path is refused outright');
  assert.equal(bindings.kernelRelativePath('/api/career-hunter/home-summary', mounts), '/', 'the longest mount wins and an exact mount hit is /');
  assert.equal(bindings.kernelRelativePath('/api/career-hunter/jobs/42', mounts), '/jobs/42');
  assert.equal(bindings.kernelRelativePath('/elsewhere/jobs', mounts), '/elsewhere/jobs', 'no mount: the whole path is tried');
});

test('the catalog reader refuses a binding it cannot read instead of skipping it', () => {
  const http = bindings.catalogHttpBindings();
  assert.ok(http.length >= 90, `read ${http.length} http bindings`);
  assert.ok(http.every((binding) => /^[A-Z]+$/.test(binding.method) && binding.path.startsWith('/') && binding.allOf.length >= 1));
  assert.equal(new Set(http.map((binding) => binding.id)).size, http.length, 'binding ids are unique');
});
