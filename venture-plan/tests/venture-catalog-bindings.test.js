/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The 1.5.0 authorization catalog, held to the routers and the manifest on a bare checkout. Every literal route in src-routes, under every manifest mount whose module reaches it, must match exactly one authorization.yaml http binding under the kernel's segment rule, and every binding must serve a route (oshal-app validate reads the catalog alone and cannot see an unbound or stale route; under enforce an unbound request is refused authorization_operation_unbound before package code). The routes that can reach a bot are pinned to venture.execute and no other route is; exports to venture.export. The rebaseline tick is pinned three ways: the jobs binding id is the full schedule id the kernel authorizes, its permission is exactly the schedule's `requires`, and no role grants it, so only a system activation can. The four manifest bots are bound once each. The rule mirror is held to the kernel's real matcher by tests/venture-catalog-kernel.core.spec.mjs.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const bindings = require('./helpers/venture-route-bindings.cjs');

const describe = (row) => `${row.method} ${row.request} (${row.file} "${row.pattern}" under ${row.mount}) -> ${row.relative}`;

/** The handlers that can reach a bot (venture-bots.ts) and so spend the caller's provider money. */
const SPENDING = [
  ['POST', '/api/venture', '/ventures', 'venture-create'],
  ['POST', '/api/venture', '/ventures/:id/runs', 'runs-start'],
  ['POST', '/api/venture', '/chat', 'chat'],
  ['POST', '/api/venture', '/ventures/:id/documents/:docKey/regenerate', 'document-regenerate'],
  ['PUT', '/api/venture', '/ventures/:id/rebaseline-policy', 'rebaseline-policy-update'],
];

test('every literal route in src-routes is served by a manifest mount and matches exactly one catalog binding', () => {
  const mounts = bindings.manifestMounts();
  assert.deepEqual(mounts.map((entry) => entry.mountPath),
    ['/api/venture-plan/home-summary', '/api/venture-plan/_smoke', '/api/venture', '/api/venture-rebaseline']);
  const literal = bindings.routeSources().flatMap((file) => bindings.literalRoutesIn(file));
  assert.equal(literal.length, 50, `the enumerator reads every route registration (read ${literal.length})`);
  const mounted = new Set(bindings.mountedRoutes().map((row) => `${row.file}|${row.method}|${row.pattern}`));
  const orphans = literal.filter((row) => !mounted.has(`${row.file}|${row.method}|${row.pattern}`));
  assert.deepEqual(orphans, [], 'a route registered in a source no manifest module reaches is never mounted and never checked');

  const rows = bindings.resolvedRoutes();
  const unbound = rows.filter((row) => row.matches.length === 0).map(describe);
  const ambiguous = rows.filter((row) => row.matches.length > 1).map((row) => `${describe(row)} matches ${row.matches.map((m) => m.id).join(', ')}`);
  assert.deepEqual(unbound, [], 'the kernel denies an unmatched request authorization_operation_unbound; bind it in authorization.yaml');
  assert.deepEqual(ambiguous, [], 'the kernel binds only when exactly one binding matches; two matches deny the request');
});

test('every http binding serves a registered route, so a renamed route cannot leave a stale binding behind', () => {
  const used = new Set(bindings.resolvedRoutes().flatMap((row) => row.matches.map((match) => match.id)));
  const http = bindings.catalogBindings('http');
  assert.equal(http.length, 48, `read ${http.length} http bindings`);
  assert.equal(new Set(http.map((binding) => binding.id)).size, http.length, 'binding ids are unique');
  assert.deepEqual(http.filter((binding) => !used.has(binding.id)).map((binding) => binding.id), []);
});

test('GET / is the console, the Home summary and the readiness smoke at once, and is bound to app.open alone', () => {
  const roots = bindings.resolvedRoutes().filter((row) => row.method === 'GET' && row.relative === '/');
  assert.deepEqual(roots.map((row) => row.mount).sort(), ['/api/venture', '/api/venture-plan/_smoke', '/api/venture-plan/home-summary']);
  for (const row of roots) assert.deepEqual(row.matches.map((m) => ({ id: m.id, allOf: m.allOf })), [{ id: 'console', allOf: ['app.open'] }]);
  const { roles } = bindings.catalogVocabulary();
  for (const [role, granted] of Object.entries(roles)) {
    if (granted.includes('app.open')) assert.ok(granted.includes('venture.read'), `${role}: app.open never admits more than venture.read would`);
  }
});

test('exactly the routes that can reach a bot need venture.execute, the downloads need venture.export, and every GET only reads', () => {
  const rows = bindings.resolvedRoutes();
  for (const [method, mount, pattern, id] of SPENDING) {
    const served = rows.filter((row) => row.method === method && row.mount === mount && row.pattern === pattern);
    assert.equal(served.length, 1, `${method} ${pattern} is registered once and mounted once`);
    assert.deepEqual(served[0].matches.map((m) => ({ id: m.id, allOf: m.allOf })), [{ id, allOf: ['venture.execute'] }]);
  }
  const http = bindings.catalogBindings('http');
  assert.deepEqual(http.filter((b) => b.allOf.includes('venture.execute')).map((b) => b.id).sort(),
    SPENDING.map((entry) => entry[3]).sort(), 'a new spending route is bound to venture.execute deliberately, here');
  assert.deepEqual(http.filter((b) => b.allOf.includes('venture.export')).map((b) => b.path).sort(),
    ['/ventures/:id/export/bundle.zip', '/ventures/:id/export/deck.pptx', '/ventures/:id/export/model.xlsx', '/ventures/:id/export/plan.docx']);
  const { permissions } = bindings.catalogVocabulary();
  const writesOnGet = http.filter((b) => b.method === 'GET' && b.allOf.some((p) => !['read', 'export'].includes(permissions[p].effect)));
  assert.deepEqual(writesOnGet.map((b) => b.id), [], 'a GET is bound only to read or export permissions');
});

test('the rebaseline tick: one jobs binding under the full schedule id, needing exactly what the schedule requires, granted by no role', () => {
  const name = bindings.manifestName();
  const schedules = bindings.manifestSchedules();
  assert.deepEqual(schedules, [{ id: 'rebaseline-policy-tick', runsAs: 'system', requires: ['venture.rebaseline'] }]);
  assert.deepEqual(bindings.catalogBindings('jobs'), [{ id: `${name}-rebaseline-policy-tick`, allOf: ['venture.rebaseline'] }],
    'the kernel authorizes an activated tick as kind jobs with the full schedule id `{app}-{id}`');
  const tick = bindings.resolvedRoutes().filter((row) => row.mount === '/api/venture-rebaseline');
  assert.deepEqual(tick.map((row) => [row.method, row.relative, row.matches.map((m) => m.allOf)]),
    [['POST', '/tick', [['venture.rebaseline']]]]);
  const { permissions, roles } = bindings.catalogVocabulary();
  assert.deepEqual(permissions['venture.rebaseline'], { resource: 'venture', effect: 'execute', minimumTier: 'editor' });
  assert.deepEqual(Object.entries(roles).filter(([, granted]) => granted.includes('venture.rebaseline')).map(([role]) => role), [],
    'only a swarm administrator\'s system activation grants it, to the application service principal');
  assert.deepEqual(Object.keys(roles), ['member']);
});

test('the four manifest bots are bound once each, to venture.execute, under the ids the package bills', () => {
  const agents = bindings.manifestAgentIds();
  assert.equal(agents.length, 4);
  const bots = bindings.catalogBindings('bots');
  assert.deepEqual(bots.map((b) => b.id), agents);
  for (const bot of bots) assert.deepEqual(bot.allOf, ['venture.execute']);
  const source = fs.readFileSync(path.join(bindings.PKG, 'src-routes', 'venture-bots.ts'), 'utf8');
  for (const agent of agents) assert.ok(source.includes(`'${agent}'`), `venture-bots.ts AGENT_IDS bills ${agent}`);
});

test('the mirror of the kernel rule keeps its shape: segment count, literal equality, :param exclusions, one-match rule', () => {
  const http = [{ id: 'venture', method: 'GET', path: '/ventures/:id', allOf: ['venture.read'] },
    { id: 'ventures', method: 'GET', path: '/ventures', allOf: ['venture.read'] }, { id: 'console', method: 'GET', path: '/', allOf: ['app.open'] }];
  const mounts = ['/api/venture', '/api/venture-plan/home-summary'];
  const ids = (method, relative) => bindings.matchBindings(http, mounts, method, relative).map((m) => m.id);
  assert.deepEqual(ids('GET', '/ventures/42'), ['venture']);
  assert.deepEqual(ids('GET', '/ventures/42/extra'), [], 'segment count must be equal');
  assert.deepEqual(ids('GET', '/ventures/..'), [], 'a parameter never takes ..');
  assert.deepEqual(ids('GET', '/ventures/'), [], 'an empty trailing segment is not a parameter value');
  assert.deepEqual(ids('POST', '/ventures/42'), [], 'method is part of the match');
  assert.deepEqual(ids('GET', '/ventures/a%20b'), [], 'an encoded path is refused outright');
  assert.equal(bindings.kernelRelativePath('/api/venture-plan/home-summary', mounts), '/', 'an exact mount hit is /');
  assert.equal(bindings.kernelRelativePath('/api/venture-rebaseline/tick', ['/api/venture', '/api/venture-rebaseline']), '/tick',
    '/api/venture is not a prefix of /api/venture-rebaseline on a segment boundary');
  assert.equal(bindings.kernelRelativePath('/elsewhere/ventures', mounts), '/elsewhere/ventures', 'no mount: the whole path is tried');
});

test('the catalog reader refuses a binding line it cannot read instead of skipping it', () => {
  const http = bindings.catalogBindings('http');
  assert.ok(http.every((binding) => /^[A-Z]+$/.test(binding.method) && binding.path.startsWith('/') && binding.allOf.length >= 1));
  const { permissions } = bindings.catalogVocabulary();
  assert.deepEqual(Object.keys(permissions), ['app.open', 'venture.read', 'venture.change', 'venture.execute', 'venture.export', 'venture.rebaseline']);
  for (const binding of [...http, ...bindings.catalogBindings('jobs'), ...bindings.catalogBindings('bots')]) {
    for (const permission of binding.allOf) assert.ok(permissions[permission], `${binding.id} names a defined permission (${permission})`);
  }
});
