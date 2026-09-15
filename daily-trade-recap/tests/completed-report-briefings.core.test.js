/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove recorded completion, current owner/preferences, atomic rollback/retry and bounded scheduled publication with actual core service code.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Add `app-dependencies` to the exact `uses` list. The store's dependency-tier migration (69e4716) correctly added that floor to every tiered manifest, and this suite went red the same day without anyone seeing it: it is framework-coupled, so the bare-checkout store CI excludes it, and no other gate runs it. The list stays exact so an unexpected kernel skill still fails here.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, httpFixture, report, actor, manifest } = require('./completed-report-briefings.fixture');
const sourceId = 'daily-trade-recap:recorded-reports';
const session = 'daily-trade-recap-recorded-reports';

/** @description Restore the composed service after each isolated serial test. */
async function setup(t, options) { const proof = await fixture(options); t.after(proof.stop); return proof; }

test('a recorded report commits one exact-owner completed briefing without starting work', async t => {
  const proof = await setup(t);
  const outcome = await proof.collect();
  assert.equal(outcome.counts.queued, 1);
  const [task] = [...proof.state.tasks.values()];
  assert.equal(task.user_sub, actor.sub); assert.equal(task.principal_issuer, actor.issuer);
  assert.equal(task.briefing_source_id, sourceId); assert.equal(task.session_id, session);
  assert.equal(task.status, 'done'); assert.equal(task.delivered, false); assert.ok(task.finished_at);
  assert.match(task.title, /^Trading report recorded for \d{4}-\d{2}-\d{2}$/);
  assert.match(task.result, /Synthetic report/); assert.match(task.result, /does not confirm email or site delivery/);
  assert.equal(proof.state.statements.some(sql => /UPDATE jarvis_tasks|pending|queued/.test(sql)), false);
  assert.deepEqual(new Set(proof.state.resolutions), new Set([actor.sub]));
  assert.deepEqual(new Set(proof.state.accesses.map(read => read.app)), new Set(['daily-trade-recap']));
  assert.equal(JSON.stringify(outcome).includes(actor.sub), false);
  assert.equal(JSON.stringify(outcome).includes('Synthetic report'), false);
});

test('journal rewrites and repeated fires retain the first completed row and delivery markers', async t => {
  const proof = await setup(t); await proof.collect();
  const [task] = [...proof.state.tasks.values()]; task.delivered = true;
  const before = structuredClone(task);
  proof.state.reports = [report({ id: 999, summary: 'Synthetic republished summary.' })];
  assert.equal((await proof.collect()).counts.queued, 0);
  assert.deepEqual([...proof.state.tasks.values()], [before]);
});

test('two overlapping collectors admit exactly one complete row', async t => {
  const proof = await setup(t);
  const results = await Promise.all([proof.collect(), proof.collect()]);
  assert.equal(results.reduce((sum, item) => sum + item.counts.queued, 0), 1);
  assert.equal(proof.state.tasks.size, 1);
  assert.equal([...proof.state.tasks.values()][0].status, 'done');
});

test('insert failure rolls back without a pending row and a later collection can retry', async t => {
  const proof = await setup(t, { failInserts: 1 });
  assert.equal((await proof.collect()).counts.queued, 0);
  assert.equal(proof.state.tasks.size, 0); assert.equal(proof.state.rollbacks, 1);
  assert.equal((await proof.collect()).counts.queued, 1);
  assert.equal(proof.state.tasks.size, 1);
});

test('authority revoked after insertion rolls the result back and permits a later authorized retry', async t => {
  const proof = await setup(t);
  proof.state.afterInsert = () => { proof.state.allowed = false; };
  assert.equal((await proof.collect()).counts.queued, 0);
  assert.equal(proof.state.tasks.size, 0); assert.equal(proof.state.rollbacks, 1);
  proof.state.afterInsert = undefined; proof.state.allowed = true;
  assert.equal((await proof.collect()).counts.queued, 1);
});

test('exact-principal disabled preference suppresses publication and can later be enabled', async t => {
  const proof = await setup(t);
  await proof.service.savePreference(actor, sourceId, { enabled: false, frequency: 'as-available', channel: 'bubble' });
  assert.equal((await proof.collect()).counts.queued, 0); assert.equal(proof.state.tasks.size, 0);
  await proof.service.savePreference(actor, sourceId, { enabled: true, frequency: 'as-available', channel: 'bubble' });
  assert.equal((await proof.collect()).counts.queued, 1);
});

test('another issuer preference does not substitute for the verified recipient preference', async t => {
  const proof = await setup(t);
  await proof.service.savePreference({ ...actor, issuer: 'https://other.fixture.test' }, sourceId,
    { enabled: false, frequency: 'daily', channel: 'screen' });
  assert.equal((await proof.collect()).counts.queued, 1);
  assert.equal([...proof.state.tasks.values()][0].principal_issuer, actor.issuer);
});

for (const [name, recipient] of [['unresolved or ambiguous', null], ['wrong subject', { ...actor, sub: 'synthetic-other' }],
  ['inactive', { ...actor, isActive: false }], ['missing issuer', { ...actor, issuer: '' }]]) {
  test(`${name} recorded owner cannot be replaced by an operator or broadcast recipient`, async t => {
    const proof = await setup(t, { recipient });
    assert.equal((await proof.collect()).counts.queued, 0); assert.equal(proof.state.tasks.size, 0);
  });
}

test('identity changing between initial and locked admission fails closed', async t => {
  const proof = await setup(t); let reads = 0;
  proof.state.resolve = () => ++reads === 1 ? actor : { ...actor, issuer: 'https://replacement.fixture.test' };
  assert.equal((await proof.collect()).counts.queued, 0); assert.equal(proof.state.tasks.size, 0);
});

test('missing registration, retired source and unavailable runtime cannot create ordinary tasks', async t => {
  const proof = await setup(t, { register: false });
  assert.equal((await proof.collect()).state, 'unavailable'); assert.equal(proof.state.reads.length, 0);
  assert.equal(await proof.taskStore.saveCompletedBriefing('synthetic-unregistered', actor.sub, session, 'Recorded', 'Synthetic result'), false);
  await proof.service.register(manifest.name, manifest.version, manifest.briefings);
  await proof.service.unregister(manifest.name);
  assert.equal((await proof.collect()).counts.queued, 0);
  proof.delivery.configureJarvisBriefingDelivery(undefined);
  assert.equal((await proof.collect()).state, 'unavailable');
  assert.equal(await proof.taskStore.saveCompletedBriefing('synthetic-missing-runtime', actor.sub, session, 'Recorded', 'Result'), false);
  assert.equal(proof.state.tasks.size, 0);
});

test('older core without the completed helper clearly defers without reading report contents', async t => {
  const proof = await setup(t, { store: {} });
  assert.equal((await proof.collect()).state, 'unavailable');
  assert.equal(proof.state.reads.length, 0); assert.equal(proof.state.tasks.size, 0);
});

test('journal failure is unavailable rather than an empty successful collection', async t => {
  const proof = await setup(t, { readError: true });
  const outcome = await proof.collect();
  assert.equal(outcome.state, 'unavailable'); assert.equal(outcome.counts, undefined);
  assert.equal(proof.state.tasks.size, 0);
  proof.state.readError = false; assert.equal((await proof.collect()).counts.queued, 1);
});

test('source read failure after report discovery remains deferred with no delivered or ordinary task', async t => {
  const proof = await setup(t, { sourceReadError: true });
  const outcome = await proof.collect();
  assert.equal(outcome.state, 'deferred'); assert.equal(outcome.counts.queued, 0);
  assert.equal(outcome.counts.deferred, 1); assert.equal(proof.state.tasks.size, 0);
  proof.state.sourceReadError = false;
  assert.equal((await proof.collect()).counts.queued, 1);
});

test('only recent recorded report entries are eligible and empty successful reads stay empty', async t => {
  const proof = await setup(t, { reports: [report({ kind: 'note' }), report({ source: 'untrusted-other-source' }),
    report({ created_at: new Date(Date.now() - 73 * 3600_000).toISOString() }),
    report({ created_at: new Date(Date.now() + 3600_000).toISOString() })] });
  const outcome = await proof.collect();
  assert.equal(outcome.state, 'available'); assert.equal(outcome.counts.inspected, 0);
  assert.equal(proof.state.tasks.size, 0);
});

test('malformed owner, date or empty result never reaches recipient resolution', async t => {
  const proof = await setup(t, { reports: [report({ user_sub: '' }), report({ user_sub: ' synthetic-owner' }),
    report({ user_sub: 'synthetic\nowner' }), report({ user_sub: 'x'.repeat(513) }),
    report({ et_day: '2025-02-30' }), report({ summary: ' ' })] });
  const outcome = await proof.collect();
  assert.equal(outcome.counts.invalid, 6); assert.equal(proof.state.resolutions.length, 0);
  assert.equal(proof.state.tasks.size, 0);
});

test('query and processing cap at fifty rows with distinct verified owners', async t => {
  const reports = Array.from({ length: 55 }, (_, id) => report({ id, user_sub: `synthetic-owner-${id}` }));
  const proof = await setup(t, { reports, resolve: sub => ({ ...actor, sub }) });
  const outcome = await proof.collect();
  assert.equal(outcome.counts.inspected, 50); assert.equal(outcome.counts.queued, 50);
  assert.equal(proof.state.tasks.size, 50);
});

test('elapsed admission budget stops subsequent reports without launching detached writes', async t => {
  const proof = await setup(t, { reports: [report(), report({ id: 2, et_day: '2026-01-01' })] });
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  proof.state.afterInsert = () => { now += 10_001; };
  const outcome = await proof.collect();
  assert.equal(outcome.counts.inspected, 1); assert.equal(outcome.counts.queued, 1);
  assert.equal(outcome.counts.budgetReached, true); assert.equal(proof.state.tasks.size, 1);
  assert.equal(outcome.state, 'deferred');
});

test('fixed service HTTP ignores caller recipients and reports clear unavailable state', { timeout: 10000 }, async t => {
  const proof = await setup(t); const http = await httpFixture(proof); t.after(http.stop);
  const url = `${http.base}/api/daily-trade-recap/briefings/collect`;
  assert.equal((await fetch(url, { method: 'POST' })).status, 401);
  assert.equal(proof.state.reads.length, 0);
  const response = await fetch(url, { method: 'POST', headers: { 'x-synthetic-service': 'allowed', 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_sub: 'synthetic-attacker', issuer: 'https://attacker.fixture.test', result: 'Invented result' }) });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const [task] = [...proof.state.tasks.values()]; assert.equal(task.user_sub, actor.sub);
  assert.equal(task.result.includes('Invented'), false);
  proof.state.readError = true;
  assert.equal((await fetch(url, { method: 'POST', headers: { 'x-synthetic-service': 'allowed' } })).status, 503);
});

test('manifest contributes one existing scheduler target, registered source and exact Lab recipe', () => {
  // Exact on purpose: an unexpected kernel skill should fail here. `app-dependencies` joined on
  // 2026-09-14 when every tiered manifest began declaring that floor (store 69e4716).
  assert.deepEqual(manifest.uses, ['jarvis-briefings', 'test-catalog', 'app-dependencies']);
  assert.equal(manifest.briefings[0].sessionId, session);
  assert.equal(manifest.briefings[0].id, 'recorded-reports');
  assert.equal(manifest.schedules.length, 1);
  const schedule = manifest.schedules[0];
  assert.equal(schedule.target, 'service-route'); assert.equal(schedule.scope, 'framework');
  assert.equal(schedule.cron, '*/15 * * * *'); assert.equal(schedule.handler, 'collectCompletedReports');
  const route = manifest.routes.find(item => item.factory === 'createCompletedReportBriefingRoutes');
  assert.equal(route.auth, 'service'); assert.equal(schedule.route, `${route.mountPath}/collect`);
  assert.equal(route.requiresAi, false); assert.equal(manifest.testing.catalog, 'tests/test-lab.yaml');
});
