/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career Coaching 0.1.0 declarations: the authorization catalog (two roles, no administrator role, the coach's only read is summary-v1, the field set equals the projection's fields, every served route has exactly one binding under the kernel's segment rule and no binding is unused), the relationship policy against the migration (every table and column it names exists, the actor binds issuer and subject, no table is readable by everyone), the manifest (one human-gated phase with no bot or worker, no schedule, Career declared), and the source boundary (server code never opens Career's store, files, mail, engines, models or any network; the page reads only the seeker's own three Career routes).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.1.1: the manifest declares `person-status.read`, the one kernel capability behind coach reads, and the source boundary now admits exactly one kernel intent: `person.status`, sent from lib/participant-status.js with three fields. No other file calls an intent, and no other intent name appears in server code.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.1.2: Career is declared optional, so no role template has to map it (the kernel refuses a template that leaves out a required application; the store-wide rule and its red case for 0.1.1's declaration are scripts/role-template-coverage.test.mjs). The Coaching client template maps Career's own Job seeker role, read from Career's manifest and catalog in this store; the Career coach template maps nothing in Career.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {STORE, PACKAGE, standInKernel, mount} = require('./support/stand-ins.cjs');
const projection = require('../lib/projection');

/** @description js-yaml from the gate toolchain, or a loud failure. */
function yaml() {
  for (const base of [process.env.STORE_CI_TOOLCHAIN, path.join(STORE, 'scripts/toolchain')].filter(Boolean)) {
    const home = path.join(base, 'node_modules/js-yaml');
    if (fs.existsSync(home)) return require(home);
  }
  throw new Error('BLOCKED: js-yaml not found (npm ci --prefix scripts/toolchain)');
}
const read = (file) => fs.readFileSync(path.join(PACKAGE, file), 'utf8');
const catalog = yaml().load(read('authorization.yaml'));
const manifest = yaml().load(read('oshal-app.yaml'));
const policy = JSON.parse(read('storage/relationships.json'));

/** @description The served (method, path) pairs of the compiled router. */
function served() {
  const router = mount(standInKernel(), {repo: {}});
  return router.stack.filter((layer) => layer.route).flatMap((layer) => Object.keys(layer.route.methods)
    .filter((method) => method !== '_all').map((method) => ({method: method.toUpperCase(), path: layer.route.path})));
}

/** @description The kernel's binding overlap rule (crates/packages/src/authorization_validation.rs overlaps). */
function matches(binding, route) {
  const a = binding.path.split('/'), b = route.path.split('/');
  return binding.method === route.method && a.length === b.length && a.every((part, i) => part === b[i] || part.startsWith(':'));
}

test('catalog: two roles, no administrator role, and the coach reads only the summary-v1 projection', () => {
  assert.deepEqual(Object.keys(catalog.roles).sort(), ['coach', 'seeker']);
  const grants = (role) => catalog.roles[role].grants.map((g) => g.permission).sort();
  assert.deepEqual(grants('seeker'), ['app.open', 'coaching.share.change', 'coaching.share.confirm', 'coaching.share.read']);
  assert.deepEqual(grants('coach'), ['app.open', 'coaching.card.change', 'coaching.card.read', 'coaching.summary.read']);
  assert.ok(Object.values(catalog.permissions).every((p) => p.effect !== 'administer' && p.effect !== 'export'));
  const summary = catalog.roles.coach.grants.find((g) => g.permission === 'coaching.summary.read');
  assert.equal(summary.fields, 'summary-v1');
  assert.deepEqual(catalog.resources['coaching-summary'].fieldSets['summary-v1'], [...projection.SUMMARY_FIELDS]);
  assert.ok(Object.values(catalog.roles).every((role) => role.grants.every((g) => g.scope === 'own')));
  const confirm = catalog.permissions['coaching.share.confirm'];
  assert.equal(confirm.effect, 'execute', 'the kernel\'s owner decision path needs an own-scoped Execute grant');
});

test('catalog: every served route has exactly one binding and every binding serves a route', () => {
  const routes = served(), bindings = catalog.bindings.http;
  for (const route of routes) {
    const found = bindings.filter((b) => matches(b, route));
    assert.equal(found.length, 1, `${route.method} ${route.path} has ${found.length} bindings`);
  }
  for (const binding of bindings) assert.ok(routes.some((route) => matches(binding, route)), `${binding.id} serves nothing`);
  for (const [i, a] of bindings.entries()) {
    for (const b of bindings.slice(i + 1)) assert.ok(!(matches(a, b) || matches(b, a)), `${a.id} overlaps ${b.id}`);
  }
});

test('policy: every table and column it names exists in the migration; the actor binds issuer and subject', () => {
  const sql = read('migrations/001-career-coaching.sql');
  const tables = Object.fromEntries([...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)]
    .map(([, name, body]) => [name, body.split('\n').map((line) => line.trim().split(/\s+/)[0]).filter((w) => /^[a-z_]+$/.test(w))]));
  assert.deepEqual(Object.keys(policy.tables).sort(), Object.keys(tables).sort());
  assert.equal(policy.actor_table, 'cc_people');
  assert.ok(tables.cc_people.includes(policy.issuer_column) && tables.cc_people.includes(policy.subject_column));
  for (const [name, rules] of Object.entries(policy.tables)) {
    assert.notEqual(rules.read.trim().toLowerCase(), 'true', `${name} is readable by everyone`);
    for (const column of [...(rules.immutable || []), ...(rules.unique || []).flat()]) assert.ok(tables[name].includes(column), `${name}.${column}`);
    for (const rule of ['read', 'insert', 'update', 'delete'].map((k) => rules[k]).filter(Boolean)) {
      for (const [, column] of rule.matchAll(/\br\.(\w+)/g)) assert.ok(tables[name].includes(column), `${name}: r.${column}`);
    }
  }
  assert.equal(policy.tables.cc_snapshots.read.includes('l.expires_at > now()'), true, 'the policy also ends access at the deadline');
});

test('manifest: one human-gated approval phase, no worker or bot, no schedule, Career declared', () => {
  assert.equal(manifest.name, 'career-coaching');
  assert.deepEqual(manifest.workflows, [{id: 'career-coaching:career-coaching-share', ticketType: 'career-coaching-share',
    name: 'Share a job search summary with a coach', phases: [{name: 'approve-share', action: 'complete', approval: {approver: 'editor'}}]}]);
  assert.equal(manifest.bots, undefined);
  assert.equal(manifest.schedules, undefined);
  assert.deepEqual(manifest.dependencies.required.apps, [], 'no application is required: a required one must be mapped by every role template');
  assert.deepEqual(manifest.dependencies.optional.apps, ['career-hunter'], 'Career is declared, so the page may read it and a template may map it');
  assert.ok(manifest.uses.includes('application-authorization') && manifest.uses.includes('experience-roles'));
  assert.ok(manifest.uses.includes('person-status.read'), 'the kernel links the status read only to a package that declares it');
  assert.deepEqual(manifest.uses.filter((name) => /\.(read|write|run|send)$/.test(name)), ['person-status.read'], 'no other host capability is declared');
  for (const route of manifest.routes) assert.ok(fs.existsSync(path.join(PACKAGE, route.module)), route.module);
  for (const file of manifest.migrations) assert.ok(fs.existsSync(path.join(PACKAGE, file)), file);
  assert.deepEqual(manifest.ui.static.map((s) => s.iframeUrl), ['/api/career-coaching/?view=share', '/api/career-coaching/?view=coach']);
});

test('role templates: a client may be given Career\'s own Job seeker role; a coach is given nothing in Career', () => {
  const [seeker, coach] = manifest.authorization.roleTemplates;
  assert.deepEqual([seeker, coach].map((t) => [t.id, t.label]), [['seeker', 'Coaching client'], ['coach', 'Career coach']]);
  assert.deepEqual(coach.members, [{app: 'career-coaching', role: 'coach'}], 'the coach\'s page and routes read nothing in Career');
  assert.deepEqual(seeker.members, [{app: 'career-coaching', role: 'seeker'}, {app: 'career-hunter', role: 'member'}]);
  for (const template of [seeker, coach]) {
    const own = template.members.filter((member) => member.app === 'career-coaching').map((member) => member.role);
    assert.deepEqual(own, [template.id], 'each template gives exactly its own role here');
    assert.ok(catalog.roles[own[0]], `${own[0]} is a role of this catalog`);
  }
  // The Career role is the one Career's own Job seeker template gives, and it exists in Career's catalog. The kernel
  // resolves a mapped role by name in the mapped application's catalog when the bundle is assigned.
  const career = (file) => yaml().load(fs.readFileSync(path.join(STORE, 'career-hunter', file), 'utf8'));
  const jobSeeker = career('oshal-app.yaml').authorization.roleTemplates.find((template) => template.label === 'Job seeker');
  assert.deepEqual(jobSeeker.members, [{app: 'career-hunter', role: 'member'}]);
  assert.ok(career('authorization.yaml').roles.member, 'Career declares the member role');
  assert.deepEqual(career('oshal-app.yaml').dependencies.required.apps, [], 'Career requires no application the client template would also have to map');
});

test('boundary: server code never reaches Career\'s store, files, mail, engines, models or the network', () => {
  const files = ['lib', 'routes'].flatMap((dir) => fs.readdirSync(path.join(PACKAGE, dir)).map((f) => path.join(dir, f)));
  const forbidden = [/openUserDb|career-user-store|CareerFiles|JOBHUNTER_STORE_ROOT|career_files/, /api\/career-hunter/, /executeBot|orchestrator|notify\(/,
    /http\.fetch|egressFetch|require\(['"]node:(https?|net|child_process)['"]\)/, /publicLinks/];
  for (const file of files) {
    const text = read(file);
    for (const pattern of forbidden) assert.ok(!pattern.test(text), `${file} matches ${pattern}`);
    // One kernel intent in the whole package: the status read, sent from the participant-status reader only.
    const intents = [...text.matchAll(/\.intent\(([^)]*)\)/g)].map(([, args]) => args.trim());
    assert.deepEqual(intents, file === path.join('lib', 'participant-status.js') ? ['name, input'] : [], `${file} sends a kernel intent`);
  }
  const reader = read('lib/participant-status.js');
  assert.match(reader, /const STATUS_INTENT = 'person\.status';/);
  assert.equal([...reader.matchAll(/intent\(([A-Z_']+[^,)]*),/g)].map(([, name]) => name).join(), 'STATUS_INTENT', 'the only intent name sent');
  assert.match(reader, /intent\(STATUS_INTENT, \{principal_id: person\.personId, issuer: person\.issuer, subject: person\.subject\}\)/,
    'exactly the three fields the kernel takes');
  const page = read('tools/coaching.js') + read('tools/coaching-page.js');
  const career = [...page.matchAll(/CAREER \+ '([^']+)'/g)].map(([, p]) => p.split('?')[0]).sort();
  assert.deepEqual(career, ['/jobs', '/jobs/progress', '/jobs/stats'], 'the page reads only the seeker\'s own three Career routes');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(page), 'server values are written as text');
});
