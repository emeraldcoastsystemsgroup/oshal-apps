/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.0.0 (design-studio BACKLOG B12): the Engineer role gives exactly what Design Studio's four steps need. The calls a person's browser makes in New product, a partner-built part, Simulate and Make the print set are listed here and held to Design Studio's own page code (each call's path is in tools/*.js, and the page reaches no application the list leaves out). Each call is then admitted the way the kernel admits it: an application with a catalog by the permissions its binding names (crates/packages/src/operation_authorization.rs), one without a catalog by tier, viewer for a read and editor for a write (crates/control/src/mode.rs), with "@app-admin" its one role (crates/packages/src/composite_roles.rs). The role must grant every call, and every application it maps must be one a step calls. A role renamed in one of the five, a catalog added to one, or a new call to an application the role does not map fails here, not on a person.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const store = path.resolve(root, '..');
const toolchain = path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(store, 'scripts', 'toolchain'));
const yaml = createRequire(path.join(toolchain, 'package.json'))('js-yaml');
const load = (...parts) => yaml.load(fs.readFileSync(path.join(store, ...parts), 'utf8'));

const template = load('engineering-shelf', 'oshal-app.yaml').authorization.roleTemplates[0];
const roleOf = Object.fromEntries(template.members.map((member) => [member.app, member.role]));
const studio = load('design-studio', 'oshal-app.yaml');
const page = fs.readdirSync(path.join(store, 'design-studio', 'tools')).filter((file) => file.endsWith('.js'))
  .map((file) => fs.readFileSync(path.join(store, 'design-studio', 'tools', file), 'utf8')).join('\n');
const TIERS = ['viewer', 'editor', 'admin'];

/** The calls each step makes with the person's session: [application, method, path under /api/<application>]. */
const STEPS = {
  'New product': [
    ['design-studio', 'GET', '/capabilities'], ['design-studio', 'POST', '/plan'], ['design-studio', 'POST', '/projects'], ['design-studio', 'GET', '/projects/:id'],
    // The product page that opens reads every engine its chain binds, before any button is pressed.
    ['cad-studio', 'GET', '/models'], ['cad-studio', 'GET', '/capabilities'], ['circuit-lab', 'GET', '/designs'], ['circuit-lab', 'GET', '/examples'], ['circuit-lab', 'GET', '/capabilities'],
    ['embodied', 'GET', '/physics/status'], ['embodied', 'GET', '/physics/reports'], ['scan-to-print', 'GET', '/printers'], ['scan-to-print', 'GET', '/capabilities'], ['design-studio', 'GET', '/projects/:id/print-set'],
  ],
  'A partner-built part': [
    ['design-studio', 'POST', '/projects/:id/orders'], ['design-studio', 'GET', '/orders/pending'], ['design-studio', 'POST', '/orders/:orderId/claim'],
    ['cad-studio', 'GET', '/capabilities'], ['cad-studio', 'POST', '/models'], ['design-studio', 'POST', '/projects/:id/bind'], ['design-studio', 'POST', '/orders/:orderId/finish'],
  ],
  Simulate: [
    ['design-studio', 'GET', '/projects/:id/mechanism'], ['embodied', 'GET', '/build/catalog'], ['circuit-lab', 'GET', '/catalog/drivers'], ['design-studio', 'PUT', '/projects/:id/mechanism'],
    ['design-studio', 'POST', '/projects/:id/plant-spec'], ['embodied', 'POST', '/physics/plant/load'], ['embodied', 'GET', '/physics/plant/state'], ['embodied', 'GET', '/physics/plant/train'], ['embodied', 'POST', '/physics/plant/train'],
  ],
  'Make the print set': [
    ['design-studio', 'POST', '/projects/:id/print-set'], ['cad-studio', 'GET', '/models'], ['cad-studio', 'GET', '/models/:id/artifacts/stl'],
    ['design-studio', 'PUT', '/projects/:id/print-set/parts/:part'], ['design-studio', 'POST', '/projects/:id/print-set/finish'], ['design-studio', 'GET', '/projects/:id/print-set'],
  ],
};
const CALLS = Object.values(STEPS).flat();

/** @description The catalog of an application of this repository, or null when it has none. */
function catalogOf(app) {
  const declared = load(app, 'oshal-app.yaml').authorization;
  return declared && declared.catalog ? load(app, declared.catalog) : null;
}

/** @description The permissions a catalog binds a call to: the binding whose method matches and whose path matches segment by segment, a `:name` segment matching any one segment. */
function bound(catalog, method, route) {
  const want = route.split('/');
  const hit = catalog.bindings.http.filter((binding) => {
    const have = binding.path.split('/');
    return binding.method === method && have.length === want.length && have.every((segment, index) => segment.startsWith(':') || want[index].startsWith(':') || segment === want[index]);
  });
  assert.equal(hit.length, 1, `${method} ${route} has ${hit.length} bindings in the catalog; the kernel needs exactly one`);
  return hit[0].allOf;
}

/** @description Why the role would be refused this call, in words, or null when the kernel admits it. */
function refusal(app, method, route) {
  const role = roleOf[app];
  if (!role) return `the Engineer role maps no role for ${app}`;
  const catalog = catalogOf(app);
  if (!catalog) return role === '@app-admin' ? null : `${app} has no catalog, so its one role is "@app-admin", not ${role}`;
  const held = catalog.roles[role];
  if (!held) return `${app} has no role ${role}`;
  for (const permission of bound(catalog, method, route)) {
    const needs = catalog.permissions[permission];
    if (!held.grants.some((grant) => grant.permission === permission)) return `${app} role ${role} does not grant ${permission}, which ${method} ${route} needs`;
    if (TIERS.indexOf(held.tier) < TIERS.indexOf(needs.minimumTier)) return `${app} role ${role} is ${held.tier} and ${permission} needs ${needs.minimumTier}`;
  }
  return null;
}

test('every call of the four steps is admitted by the role the Engineer template gives for that application', () => {
  for (const [step, calls] of Object.entries(STEPS)) {
    for (const [app, method, route] of calls) assert.equal(refusal(app, method, route), null, `${step}: ${method} /api/${app}${route}`);
  }
});

test('the role maps exactly the applications the four steps call, and nothing they do not', () => {
  const called = [...new Set(CALLS.map(([app]) => app))].sort();
  const mapped = template.members.map((member) => member.app).filter((app) => app !== 'engineering-shelf').sort();
  assert.deepEqual(mapped, called);
  assert.deepEqual(called, ['cad-studio', 'circuit-lab', 'design-studio', 'embodied', 'scan-to-print']);
});

test('the list is the page\'s own: each call\'s path is in Design Studio\'s page code, and the page reaches no other application', () => {
  for (const [app, , route] of CALLS.filter(([app]) => app !== 'design-studio')) {
    const literal = route.split('/').filter((segment) => segment && !segment.startsWith(':')).map((segment) => `/${segment}`);
    for (const segment of literal) assert.ok(page.includes(segment), `the page code no longer names ${segment} of /api/${app}${route}`);
  }
  const reached = [...new Set([...page.matchAll(/['"`]\/api\/([a-z0-9-]+)/g)].map((found) => found[1]))].sort();
  assert.deepEqual(reached, ['cad-studio', 'circuit-lab', 'design-studio', 'embodied', 'scan-to-print'], 'a new application reached from the page needs a role in the Engineer template');
});

test('the design partner\'s tools call Design Studio\'s own routes only, so the partner needs no role but Design Studio\'s', () => {
  assert.ok(studio.tools.length >= 10);
  for (const tool of studio.tools) assert.match(tool.executor.apiEndpoint, /^(GET|POST|PUT|PATCH|DELETE) \/api\/design-studio\//, tool.name);
  assert.equal(studio.authorization, undefined, 'Design Studio has no catalog: its tools are admitted by tier, as its routes are');
});

test('Send to printer, which the Fabricate poster offers once the set is made, is in the role too', () => {
  assert.ok(page.includes("'/api/scan-to-print/service'") && page.includes('/print`'));
  assert.equal(refusal('scan-to-print', 'POST', '/print'), null);
});

test('the check goes red on a role that falls short, a renamed role, an unmapped application and a catalog on a catalog-free one', () => {
  const kept = { ...roleOf };
  try {
    roleOf['scan-to-print'] = 'source-editor';
    assert.match(refusal('scan-to-print', 'POST', '/print'), /does not grant print\.send/);
    roleOf['scan-to-print'] = 'printer';
    assert.match(refusal('scan-to-print', 'GET', '/printers'), /has no role printer/);
    delete roleOf.embodied;
    assert.match(refusal('embodied', 'POST', '/physics/plant/load'), /maps no role for embodied/);
    roleOf['cad-studio'] = 'designer';
    assert.match(refusal('cad-studio', 'POST', '/models'), /no catalog, so its one role is "@app-admin"/);
  } finally { for (const app of Object.keys(roleOf)) delete roleOf[app]; Object.assign(roleOf, kept); }
  assert.equal(refusal('scan-to-print', 'GET', '/printers'), null);
});
