/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the shipped Create catalog the way the native kernel reads it: a bot turn is admitted only when the catalog binds the bot by name or agent id (crates/packages/src/operation_authorization.rs refuses 'operation has no explicit permission binding' otherwise), and a permission is held only when one of the caller's named roles grants it. The Create concierge (create-editor) was refused on every question because the catalog bound only HTTP routes; owners could not delete their own projects because project.delete was admin-only. The roles a workspace member holds come from the real studio-experience role template, not a copy.
 *
 * Reads the actual package files; js-yaml from the store's pinned gate toolchain. No network, no database.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(new URL('../../scripts/toolchain/package.json', import.meta.url));
const yaml = require('js-yaml');
const read = (rel) => yaml.load(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const manifest = read('../oshal-app.yaml');
const catalog = read('../authorization.yaml');
const member = read('../../studio-experience/oshal-app.yaml').experience.roleTemplates.find((t) => t.id === 'member');
const MEMBER_ROLES = member.members.filter((m) => m.app === 'create').map((m) => m.role);
const MOUNT = '/api/create';

/** The kernel's non-HTTP lookup: a binding id equal to the bot name, else to its agent id. */
function botPermissions(bot) {
  const bound = (id) => (catalog.bindings.bots || []).find((b) => b.id === id);
  return (bound(bot.name) || bound(bot.agentId))?.allOf;
}
/** Whether named roles hold one permission (any grant of it, as the kernel's candidate search). */
const holds = (roles, permission) => roles.some((r) => catalog.roles[r]?.grants.some((g) => g.permission === permission));
const admitted = (roles, allOf) => Array.isArray(allOf) && allOf.every((p) => holds(roles, p));
/** The HTTP binding a concrete request path selects, with :params matching one non-empty segment. */
function httpBinding(method, path) {
  const actual = path.split('/');
  return catalog.bindings.http.find((b) => b.method === method && b.path.split('/').length === actual.length
    && b.path.split('/').every((part, i) => part === actual[i] || (part.startsWith(':') && actual[i] !== '')));
}

test('the Create concierge turn is bound, admitted for a workspace member and spends nothing', () => {
  const concierge = manifest.bots.find((bot) => bot.name === manifest.chatBot);
  assert.equal(concierge.agentId, '992feff6-bda5-4d30-a075-22fd6f4aa9ee');
  const allOf = botPermissions(concierge);
  assert.ok(allOf, 'create-editor has an explicit bots binding');
  assert.ok(admitted(MEMBER_ROLES, allOf), `member roles ${MEMBER_ROLES} admit the turn`);
  for (const name of allOf) assert.equal(catalog.permissions[name].effect, 'read', `${name} is a read, not a spend`);
  assert.ok(!admitted(['viewer'], allOf), 'a viewer-only person cannot read owned projects through the concierge');
});

test('every bot the package declares is bound, and an undeclared bot is still refused', () => {
  for (const bot of manifest.bots) assert.ok(botPermissions(bot), `${bot.name} is bound`);
  assert.equal(botPermissions({ name: 'other-bot', agentId: '00000000-0000-4000-8000-000000000000' }), undefined);
  assert.ok(!admitted(MEMBER_ROLES, undefined), 'no binding is never admission');
});

test('each route-backed tool carries exactly the permissions of the route it calls', () => {
  const tools = manifest.tools.filter((tool) => tool.executor?.executorType === 'api');
  assert.equal(tools.length, 6);
  for (const tool of tools) {
    const [method, endpoint] = tool.executor.apiEndpoint.split(' ');
    assert.ok(endpoint.startsWith(MOUNT + '/'), tool.name);
    const route = httpBinding(method, endpoint.slice(MOUNT.length).replaceAll('{input.id}', 'x'));
    const bound = (catalog.bindings.tools || []).find((b) => b.id === tool.name);
    assert.ok(route && bound, `${tool.name} has a route binding and a tools binding`);
    assert.deepEqual(bound.allOf, route.allOf, `${tool.name} matches ${route.id}`);
  }
  assert.equal(catalog.bindings.tools.length, tools.length, 'no tools binding names an undeclared tool');
});

test('an owner deletes their own projects; nothing grants a reach beyond their own rows', () => {
  const route = httpBinding('DELETE', '/projects/x');
  assert.equal(route.id, 'delete-project');
  assert.ok(admitted(MEMBER_ROLES, route.allOf), 'a workspace member deletes what they own');
  for (const role of ['creator', 'editor']) assert.ok(holds([role], 'project.delete'), `${role} holds project.delete`);
  for (const role of ['viewer', 'reader', 'exporter', 'generator']) {
    assert.ok(!admitted([role], route.allOf), `${role} alone cannot delete`);
  }
  assert.deepEqual(catalog.resources.projects.scopes, ['own']);
  for (const [name, role] of Object.entries(catalog.roles)) {
    for (const grant of role.grants) assert.equal(grant.scope, 'own', `${name} ${grant.permission} stays own-scoped`);
  }
});
