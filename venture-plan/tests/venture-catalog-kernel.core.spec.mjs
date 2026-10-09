/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The 1.5.0 catalog through the kernel's real boundary (tests/helpers/venture-kernel-harness.cjs): the package activates in enforce mode from its real manifest and registers its resource adapter; the kernel's own matcher binds every enumerated route exactly as the bare guard's mirror does; a signed-in person with no role is refused every route before package code while a member is served; the HTTP tick refuses every person; a swarm administrator's system activation of rebaseline-policy-tick is admitted over the kernel's HTTP route and grants the application service principal exactly venture.rebaseline, while a non-administrator is refused with nothing written; the scheduled tick skips until activated, runs the package's compiled handler under the service principal once activated, is denied and suspended when the grant is gone, and skips again after deactivation; a system-activated tick cannot spend as a policy owner, because the kernel's bot gate refuses an owner-pinned call under the service principal and the package's cost gate then stops every later call; and the same package without its catalog is refused 409 authorization_service_catalog_required.
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const harness = require('./helpers/venture-kernel-harness.cjs');
const bindings = require('./helpers/venture-route-bindings.cjs');
const { APP, SCHEDULE_ID, SCHEDULE_LOCAL_ID, call } = harness;
const SERVICES = `/api/swarm/apps/${APP}/services`;
const ACTIVATE = `${SERVICES}/${SCHEDULE_LOCAL_ID}/activate`;
const POLICY_SCAN = /FROM venture_rebaseline_policies p JOIN venture_ventures v/;

let h;

before(async () => {
  h = await harness.startKernelHarness();
  await h.changeRole('member');
}, { timeout: 180000 });

after(async () => { if (h) await h.stop(); });

/** @description The service principal as the kernel's tick runner builds it. */
const servicePrincipal = () => ({ sub: h.core.authorization.applicationServicePrincipalSub(APP),
  issuer: h.core.authorization.APPLICATION_SERVICE_PRINCIPAL_ISSUER, isActive: true, isSwarmAdmin: false, tenantIds: [] });
/** @description The assignments the policy store holds for the service principal. */
const principalAssignments = async () => (await h.store.read()).assignments.filter((row) => row.targetSub === servicePrincipal().sub);
/** @description Run one dispatch of the registered tick and report what the handler queried. */
async function tick() {
  h.recorded.queries.length = 0;
  const result = await h.dispatchTick();
  return { result, scanned: h.recorded.queries.some((sql) => POLICY_SCAN.test(sql)) };
}

test('the package activates in enforce mode with its catalog and registers its resource adapter', () => {
  assert.equal(h.runtime.protectedApp(APP), true, 'a catalog-bearing package is protected in every mode');
  const summary = h.policy.getApp(APP);
  assert.deepEqual({ status: summary.status, mode: summary.mode, missingAdapters: summary.missingAdapters },
    { status: 'catalog', mode: 'enforce', missingAdapters: [] }, "the tick router's factory registered the venture adapter at activation");
  assert.deepEqual(Object.keys(summary.catalog.roles), ['member']);
  assert.deepEqual(summary.catalog.bindings.jobs, [{ id: SCHEDULE_ID, allOf: ['venture.rebaseline'] }]);
  assert.deepEqual(h.manifest.schedules.map((schedule) => [schedule.id, schedule.runsAs, schedule.requires]),
    [[SCHEDULE_LOCAL_ID, 'system', ['venture.rebaseline']]], 'the real loader accepted requires against the imported catalog');
});

test("over every literal route under every mount, the kernel's own matcher binds one permission set and the bare guard's mirror agrees", () => {
  const summary = h.policy.getApp(APP);
  const mountPaths = h.manifest.routes.map((route) => route.mountPath);
  const registration = { app: APP, source: summary.source, version: summary.version, catalog: summary.catalog,
    mode: 'enforce', mountPaths, catalogRevision: summary.catalogRevision };
  const rows = bindings.resolvedRoutes(mountPaths, summary.catalog.bindings.http);
  assert.equal(rows.length, 50);
  for (const row of rows) {
    const kernel = h.core.authorization.resolveOperationPermissions(registration, { app: APP, kind: 'http', method: row.method, path: row.relative });
    assert.ok(Array.isArray(kernel) && kernel.length > 0, `${row.method} ${row.request} is bound by the kernel`);
    assert.equal(row.matches.length, 1, `${row.method} ${row.request} has one mirrored match`);
    assert.deepEqual(kernel, row.matches[0].allOf, `${row.method} ${row.request}: kernel and mirror agree`);
  }
});

test('a signed-in person without a role is refused every route before package code; a member is served', async () => {
  h.recorded.queries.length = 0;
  for (const [method, route] of [['GET', '/api/venture/ventures'], ['POST', '/api/venture/ventures'], ['GET', '/api/venture/'],
    ['GET', '/api/venture-plan/home-summary'], ['GET', '/api/venture/ventures/v1/export/plan.docx'], ['POST', '/api/venture/chat']]) {
    const answer = await call(h.base, method, route, { user: 'outsider', ...(method === 'POST' ? { body: {} } : {}) });
    assert.equal(answer.status, 403, `${method} ${route} as a person with no role: ${JSON.stringify(answer.body)}`);
  }
  assert.deepEqual(h.recorded.queries, [], 'no refused request reached a handler or the database');
  const served = await call(h.base, 'GET', '/api/venture/ventures', { user: 'member' });
  assert.deepEqual([served.status, served.body], [200, { ventures: [] }]);
  assert.ok(h.recorded.queries.some((sql) => sql.startsWith('SELECT * FROM venture_ventures WHERE owner_sub = $1')), 'the member reached the owner-scoped handler');
});

test("the HTTP tick is the service principal's alone: no secret, the secret with no user, and a member holding the whole role are refused", async () => {
  h.recorded.queries.length = 0;
  const route = '/api/venture-rebaseline/tick';
  assert.equal((await call(h.base, 'POST', route, { user: 'member', body: {} })).status, 401, 'the mount needs the service secret');
  const anonymous = await call(h.base, 'POST', route, { serviceSecret: true, body: {} });
  assert.deepEqual([anonymous.status, anonymous.body], [401, { error: 'authorization_identity_required' }], 'the shared secret names no user');
  const member = await call(h.base, 'POST', route, { serviceSecret: true, user: 'member', body: {} });
  assert.deepEqual([member.status, member.body.error], [403, 'authorization_permission_denied'], 'no role grants venture.rebaseline');
  assert.equal(h.recorded.queries.some((sql) => POLICY_SCAN.test(sql)), false, 'the tick handler never ran');
});

test('before any activation the scheduled tick is skipped and the handler never runs', async () => {
  const { result, scanned } = await tick();
  assert.deepEqual([result.success, result.error], [false, 'skipped: not-activated']);
  assert.equal(scanned, false);
});

test("a swarm administrator's system activation is admitted and grants the service principal exactly venture.rebaseline; a non-administrator writes nothing", async () => {
  const refused = await call(h.base, 'POST', ACTIVATE, { user: 'member', body: { runsAs: 'system' } });
  assert.deepEqual([refused.status, refused.body], [403, { error: 'authorization_service_admin_required' }]);
  const wrongClass = await call(h.base, 'POST', ACTIVATE, { user: 'admin', body: { runsAs: 'user' } });
  assert.deepEqual([wrongClass.status, wrongClass.body], [400, { error: 'authorization_service_class_mismatch' }]);
  assert.deepEqual([await h.activations.listByApp(APP), await principalAssignments()], [[], []], 'refusals wrote nothing');

  const admitted = await call(h.base, 'POST', ACTIVATE, { user: 'admin', body: { runsAs: 'system' } });
  assert.equal(admitted.status, 200, JSON.stringify(admitted.body));
  const [activation] = await h.activations.listByApp(APP);
  assert.deepEqual([activation.scheduleId, activation.runsAs, activation.requires, activation.activatedBySub],
    [SCHEDULE_ID, 'system', ['venture.rebaseline'], 'vk_admin']);
  const grants = await principalAssignments();
  assert.deepEqual(grants.map((row) => [row.permission, row.role, row.deny, row.grantSource]),
    [['venture.rebaseline', undefined, false, `service-activation:${activation.id}`]]);
  const view = await call(h.base, 'GET', SERVICES, { user: 'admin' });
  assert.deepEqual([view.body.ready, view.body.services[0].state, view.body.services[0].requires],
    [true, 'active', [{ permission: 'venture.rebaseline', resource: 'venture', effect: 'execute' }]]);
});

test('the service principal holds the tick and nothing else; no person holds the tick', async () => {
  const jobs = { app: APP, kind: 'jobs', operation: SCHEDULE_ID };
  assert.equal((await h.runtime.authorize(servicePrincipal(), jobs)).allowed, true);
  const member = { ...h.directory.people.member, tenantIds: [] };
  assert.equal((await h.runtime.authorize(member, jobs)).reason, 'authorization_permission_denied');
  const read = await h.runtime.authorize(servicePrincipal(), { app: APP, kind: 'http', method: 'GET', path: '/ventures' });
  assert.deepEqual([read.allowed, read.reason], [false, 'authorization_permission_denied']);
  const bot = await h.runtime.authorize(servicePrincipal(), { app: APP, kind: 'bots', operation: 'b7000000-0000-0000-0000-000000000002' });
  assert.deepEqual([bot.allowed, bot.reason], [false, 'authorization_permission_denied']);
});

test("the activated tick runs the package's compiled handler under the service principal", async () => {
  const { result, scanned } = await tick();
  assert.deepEqual([result.success, result.error], [true, undefined]);
  assert.equal(scanned, true, 'the handler evaluated the enabled policies');
});

test('current rights are rechecked every tick: with the grant gone the tick is denied and the activation suspended until reactivated', async () => {
  await h.store.transaction(async ({ state }) => {
    state.assignments = state.assignments.filter((row) => row.targetSub !== servicePrincipal().sub);
    state.revision += 1;
  });
  const denied = await tick();
  assert.deepEqual([denied.result.success, denied.result.error, denied.scanned], [false, 'skipped: denied', false]);
  const [suspended] = await h.activations.listByApp(APP);
  assert.equal(suspended.suspendedReason, 'authorization_tier_denied');
  const reactivated = await call(h.base, 'POST', ACTIVATE, { user: 'admin', body: { runsAs: 'system' } });
  assert.equal(reactivated.status, 200);
  const again = await tick();
  assert.deepEqual([again.result.success, again.scanned], [true, true]);
});

test('a system-activated tick cannot spend as a policy owner: the kernel refuses the owner-pinned bot call and the cost gate stops every later call', async () => {
  const pkg = harness.PKG;
  const bots = require(path.join(pkg, 'routes', 'venture-bots.js'));
  const rebaseline = require(path.join(pkg, 'routes', 'venture-rebaseline.js'));
  const spec = { name: 'Fixture lamp', ideaText: 'A synthetic desk lamp idea for the kernel fixture.', spec: {} };
  const client = { hasEndpoint: () => false };
  h.recorded.botCalls.length = 0;
  const outcome = await h.core.serviceTick.runActivatedServiceTick({ app: APP, scheduleId: SCHEDULE_ID, ownerSub: null }, async () => {
    const budget = new rebaseline.ScheduledRunBudget(50_000);
    const settle = (work) => rebaseline.costCappedBotCall(budget, work).then(() => 'spent', (error) => error.code ?? String(error));
    const first = await settle(() => bots.authorBom(h.ctx, client, 'vk_member', spec, 5000));
    const second = await settle(() => bots.authorMarket(h.ctx, client, 'vk_member', spec));
    return { first, second, budget: budget.status() };
  });
  assert.equal(outcome.ran, true, 'the jobs operation itself is admitted');
  assert.deepEqual([outcome.result.first, outcome.result.second], ['authorization_execution_identity_required', 'rebaseline_cost_cap_blocked']);
  assert.deepEqual([outcome.result.budget.status, outcome.result.budget.spentMicros, outcome.result.budget.callsSkipped], ['capture-failed', 0, 1]);
  assert.deepEqual(h.recorded.botCalls, [{ agentId: 'b7000000-0000-0000-0000-000000000002', userSub: 'vk_member', admitted: false }]);

  const member = { ...h.directory.people.member, tenantIds: [] };
  const own = await h.core.actors.runWithApplicationAuthorizationActor(member, () => bots.authorBom(h.ctx, client, member.sub, spec, 5000));
  assert.equal(own.costUsd, 0.0025, 'the same call as the owner, who holds venture.execute, is admitted');
  const outsider = { ...h.directory.people.outsider, tenantIds: [] };
  await assert.rejects(h.core.actors.runWithApplicationAuthorizationActor(outsider, () => bots.authorBom(h.ctx, client, outsider.sub, spec, 5000)),
    (error) => error.code === 'authorization_tier_denied');
});

test('deactivation revokes exactly the grant it made, and the tick skips again', async () => {
  const closed = await call(h.base, 'DELETE', `${SERVICES}/${SCHEDULE_LOCAL_ID}/activation?runsAs=system`, { user: 'admin' });
  assert.deepEqual([closed.status, closed.body], [200, { deactivated: true }]);
  assert.deepEqual(await principalAssignments(), []);
  const { result, scanned } = await tick();
  assert.deepEqual([result.error, scanned], ['skipped: not-activated', false]);
});

test('the catalog is what admits it: the same package without its catalog is refused 409 before anything is written', async () => {
  const control = await harness.catalogLessControl(h.core, h.manifest, h.directory);
  assert.equal(control.policy.getApp(APP).status, 'admin-required', 'a catalog-less package under enforce admits only @app-admin');
  await assert.rejects(control.service.activate(h.directory.people.admin, { app: APP, scheduleId: SCHEDULE_LOCAL_ID, runsAs: 'system' }),
    (error) => error.status === 409 && error.code === 'authorization_service_catalog_required');
  assert.deepEqual((await control.store.read()).assignments, []);
});
