/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the compiled region-edit routes over real HTTP with the explicitly named fixture provider and a strict non-writing database double: identity, the separately named generate/read/change permissions and every body rule are enforced before any database work or provider call, and the provider report names the fixture provider without generating.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Require numeric costConsentVersion 1 on provider reports and reject malformed explicit maxCostClass values before storage, provider resolution or generation.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The operator-only antigravity-cli rail on the provider report (operator decision 2026-10-02): the operator sees it configured (free); a person the resolver refuses is reported not configured with no provider named, once, with no other provider resolved and no 500; a provider that is not available to the person is reported not configured; codex-cli is still refused.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApi, emptyPool } from './project-api.fixture.mjs';
import { fixtureProvider, FIXTURE_PROVIDER_ID } from './region-edit.fixture.mjs';

const ID = '00000000-0000-4000-8000-000000000001', EDIT = '00000000-0000-4000-8000-000000000002';
const SETTINGS = { dailyCap: 3, concurrency: 1, timeoutMs: 10000 };
const SELECTION = { version: 1, kind: 'layer', layerId: 'photo', assetId: 'photo', sourceWidth: 160, sourceHeight: 100, feather: 0,
  points: [{ x: 0, y: 0 }, { x: 160, y: 0 }, { x: 160, y: 100 }, { x: 0, y: 100 }] };
const body = (patch = {}) => ({ sourceRevision: 1, selection: structuredClone(SELECTION), instruction: 'Make the sky a warm sunset', ...patch });

async function start(t, options = {}) {
  const pool = options.pool ?? emptyPool(), fixture = fixtureProvider(options.provider);
  const api = await startApi(t, pool, { denied: options.denied, regionEdits: { dependencies: fixture.dependencies, settings: SETTINGS } });
  return { api, pool, fixture };
}
function untouched(value) {
  assert.equal(value.pool.queries.length, 0, 'no database work'); assert.deepEqual(value.fixture.calls, []); assert.deepEqual(value.fixture.resolvedFor, []);
}

test('the permissions report carries the separately named generate action', async t => {
  const allowed = await start(t), denied = await start(t, { denied: ['project.generate'] });
  assert.equal((await allowed.api.call('/permissions')).body.permissions.generate, true);
  assert.deepEqual((await denied.api.call('/permissions')).body.permissions,
    { view: true, read: true, create: true, change: true, delete: true, export: true, generate: false });
  untouched(allowed); untouched(denied);
});

test('each region route refuses a missing named permission before decoding, touching storage or reaching a provider', async t => {
  const routes = [
    ['project.generate', `/projects/${ID}/region-edits`, 'POST', body()], ['project.read', `/projects/${ID}/region-edits`, 'POST', body()],
    ['project.read', `/projects/${ID}/region-edits/${EDIT}`, 'GET'], ['project.change', `/projects/${ID}/region-edits/${EDIT}/accept`, 'POST', { baseRevision: 1 }],
    ['project.generate', `/projects/${ID}/region-edits/${EDIT}/cancel`, 'POST', {}], ['project.generate', `/projects/${ID}/region-edits/${EDIT}/reject`, 'POST', {}],
    ['project.generate', '/region-edit-provider', 'GET'], ['project.view', `/projects/${ID}/region-edits`, 'POST', body()],
  ];
  for (const [permission, path, method, payload] of routes) {
    const value = await start(t, { denied: [permission] }), result = await value.api.call(path, method, payload);
    assert.equal(result.status, 403, `${method} ${path} without ${permission}`); assert.deepEqual(result.body, { error: 'project_permission_denied' });
    assert.match(result.headers.get('cache-control'), /no-store/); untouched(value);
  }
});

test('missing and inactive identities and tenant selectors are refused without work', async t => {
  const value = await start(t);
  for (const actor of ['missing', 'inactive']) assert.equal((await value.api.call(`/projects/${ID}/region-edits`, 'POST', body(), actor)).status, 401);
  assert.equal((await value.api.call(`/projects/${ID}/region-edits?tenantId=synthetic`, 'POST', body())).status, 400);
  assert.equal((await value.api.call(`/projects/${ID}/region-edits`, 'POST', body(), 'alice', { 'x-oshal-tenant-id': 'synthetic' })).status, 400);
  untouched(value);
});

test('malformed requests fail with a named 400 before any database query or provider call', async t => {
  const value = await start(t), outside = structuredClone(SELECTION); outside.points[1].x = 161;
  const cases = [
    [body({ ownerSub: 'bob' }), 'invalid_project_fields'], [body({ sourceRevision: '1' }), 'invalid_base_revision'],
    [body({ sourceRevision: 0 }), 'invalid_base_revision'], [body({ instruction: '   ' }), 'invalid_region_instruction'],
    [body({ instruction: 'x'.repeat(1001) }), 'invalid_region_instruction'], [body({ instruction: 'bell\u0007' }), 'invalid_region_instruction'],
    [body({ selection: { ...SELECTION, owner: 'bob' } }), 'invalid_region_selection'], [body({ selection: outside }), 'invalid_region_selection'],
    [body({ selection: { ...SELECTION, points: SELECTION.points.slice(0, 2) } }), 'invalid_region_selection'],
  ];
  for (const [payload, error] of cases) {
    const result = await value.api.call(`/projects/${ID}/region-edits`, 'POST', payload);
    assert.equal(result.status, 400, JSON.stringify(payload).slice(0, 80)); assert.deepEqual(result.body, { error });
  }
  assert.equal((await value.api.call('/projects/not-a-uuid/region-edits', 'POST', body())).status, 400);
  for (const suffix of ['', '/accept', '/cancel', '/reject']) {
    assert.equal((await value.api.call(`/projects/${ID}/region-edits/not-a-uuid${suffix}`, suffix ? 'POST' : 'GET', suffix === '/accept' ? { baseRevision: 1 } : suffix ? {} : undefined)).status, 400);
  }
  assert.equal((await value.api.call(`/projects/${ID}/region-edits/${EDIT}/accept`, 'POST', { baseRevision: 1, force: true })).status, 400);
  assert.equal((await value.api.call(`/projects/${ID}/region-edits/${EDIT}/reject`, 'POST', { reason: 'x' })).status, 400);
  untouched(value);
});

test('a foreign or absent region edit reads as not found through an owner-qualified query', async t => {
  const value = await start(t), result = await value.api.call(`/projects/${ID}/region-edits/${EDIT}`, 'GET', undefined, 'bob');
  assert.equal(result.status, 404); assert.deepEqual(result.body, { error: 'region_edit_not_found' });
  const query = value.pool.queries.find(row => /FROM create_region_edits/.test(row.sql));
  assert.deepEqual(query.values, ['https://create-identity.fixture.test', 'bob', ID, EDIT]); assert.deepEqual(value.fixture.calls, []);
});

test('malformed explicit cost caps fail before storage or provider work', async t => {
  const value = await start(t);
  for (const maxCostClass of [null, true, false, 0, 1, 'true', '', 'FREE', 'unknown', ['free'], { costClass: 'free' }]) {
    const result = await value.api.call(`/projects/${ID}/region-edits`, 'POST', body({ maxCostClass }));
    assert.equal(result.status, 400, JSON.stringify(maxCostClass));
    assert.deepEqual(result.body, { error: 'invalid_region_cost_cap' });
    untouched(value);
  }
});

test('the provider report names the fixture provider and its cost class without generating anything', async t => {
  const value = await start(t), result = await value.api.call('/region-edit-provider');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { configured: true, provider: FIXTURE_PROVIDER_ID, costClass: 'paid', dailyCap: SETTINGS.dailyCap, costConsentVersion: 1 });
  assert.deepEqual(value.fixture.calls, []); assert.deepEqual(value.fixture.resolvedFor, ['alice']);
  const cli = await start(t, { provider: { id: 'codex-cli' } }), refused = await cli.api.call('/region-edit-provider');
  assert.deepEqual(refused.body, { configured: false, provider: 'codex-cli', costClass: 'paid', dailyCap: SETTINGS.dailyCap, costConsentVersion: 1, reason: 'region_edit_provider_unavailable' });
  const offline = await start(t, { provider: { available: false } });
  assert.equal((await offline.api.call('/region-edit-provider')).body.configured, false); assert.deepEqual(cli.fixture.calls, []);
});

test('the operator-only antigravity-cli rail: configured for the operator, not configured for anyone else, never a fallback', async t => {
  const value = await start(t, { provider: { id: 'antigravity-cli', costClass: 'free', operators: ['alice'] } });
  const operator = await value.api.call('/region-edit-provider');
  assert.equal(operator.status, 200);
  assert.deepEqual(operator.body, { configured: true, provider: 'antigravity-cli', costClass: 'free', dailyCap: SETTINGS.dailyCap, costConsentVersion: 1 });
  const guest = await value.api.call('/region-edit-provider', 'GET', undefined, 'bob');
  assert.equal(guest.status, 200, JSON.stringify(guest.body));
  assert.deepEqual(guest.body, { configured: false, provider: null, costClass: null, dailyCap: SETTINGS.dailyCap, costConsentVersion: 1, reason: 'region_edit_provider_unavailable' });
  assert.deepEqual(value.fixture.resolvedFor, ['alice', 'bob'], 'one resolve per report, no second provider tried');
  const unavailable = await start(t, { provider: { id: 'antigravity-cli', costClass: 'free', availableFor: ['alice'] } });
  assert.deepEqual((await unavailable.api.call('/region-edit-provider', 'GET', undefined, 'bob')).body,
    { configured: false, provider: 'antigravity-cli', costClass: 'free', dailyCap: SETTINGS.dailyCap, costConsentVersion: 1, reason: 'region_edit_provider_unavailable' });
  const cli = await start(t, { provider: { id: 'codex-cli', costClass: 'free', operators: ['alice'] } });
  assert.deepEqual((await cli.api.call('/region-edit-provider')).body,
    { configured: false, provider: 'codex-cli', costClass: 'free', dailyCap: SETTINGS.dailyCap, costConsentVersion: 1, reason: 'region_edit_provider_unavailable' });
  assert.deepEqual([...value.fixture.calls, ...unavailable.fixture.calls, ...cli.fixture.calls], [], 'a report never generates');
});
