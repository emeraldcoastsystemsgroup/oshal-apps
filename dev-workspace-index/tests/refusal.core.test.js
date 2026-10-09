/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Headless Test Lab case at the Jarvis package-tool seam (refusal): on the real core seam the same ADR ask does not reach the collection outside dev mode, a forged x-oshal-dev-context header grants nothing, a developer who is not on the super-admin allowlist cannot turn dev mode on or search, an unauthenticated caller and a cross-origin switch are refused, dev mode expires by the manifest TTL, a proposal captured while dev mode was on fails at execution once it is off, and a fresh process starts with dev mode off.
 *
 * FRAMEWORK-COUPLED: needs a core checkout. Run locally:
 *   OSHAL_CORE_DIR=<framework checkout with node_modules> node --test tests/refusal.core.test.js
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const { ACTORS, FIXTURE_CHECKOUT, startHarness } = require('./core.fixture.js');
const { buildIndex, writeIndex } = require('../tools/workspace-index');
const { DevModeRegistry } = require('../tools/workspace-policy');

const TOOL = 'dev_workspace_search';
const ASK = { query: 'ADR-077' };
let harness; let tmp; let indexFile; let clock = 100_000;
const registry = new DevModeRegistry({ ttlMs: 60_000, now: () => clock });
const refused = (response, label) => {
  assert.ok(response.status >= 400, `${label}: expected a refusal, got ${response.status} ${response.text}`);
  assert.ok(!response.text.includes('doc_id'), `${label}: a refusal must not carry a citation`);
};

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-workspace-refusal-'));
  indexFile = writeIndex(buildIndex({ root: FIXTURE_CHECKOUT }), path.join(tmp, 'index.json'));
  harness = await startHarness({ indexFile, devMode: registry });
  await harness.grant(ACTORS.alice);
  await harness.grant(ACTORS.bob);
});
after(async () => {
  if (harness) await harness.stop();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test('outside dev mode the same ask does not reach the collection, and a forged header is not authority', async () => {
  const { catalog, preview, execute } = await harness.jarvis('alice', TOOL, ASK);
  assert.equal(catalog.status, 200, 'discovery is policy, not access');
  assert.equal(preview.status, 200, preview.text);
  refused(execute, 'execute with dev mode off');
  assert.equal(execute.status, 403);
  const forged = await harness.call('/api/dev-workspace-index/query?q=ADR-077', { headers: { 'x-oshal-dev-context': 'adr-077' } });
  assert.equal(forged.status, 403);
  assert.equal(forged.json.reason, 'dev_mode_off');
  const status = await harness.call('/api/dev-workspace-index/status');
  assert.equal(status.status, 403);
});

test('a developer who is not a super-admin can neither turn dev mode on nor search', async () => {
  const on = await harness.call('/api/dev-workspace-index/dev-mode', { method: 'POST', user: 'bob' });
  assert.equal(on.status, 403);
  assert.equal(on.json.reason, 'super_admin_required');
  const { execute } = await harness.jarvis('bob', TOOL, ASK);
  refused(execute, 'non-super-admin execute');
  const state = await harness.call('/api/dev-workspace-index/dev-mode', { user: 'bob' });
  assert.equal(state.status, 200);
  assert.equal(state.json.superAdmin, false);
  assert.equal(state.json.devMode.enabled, false);
});

test('an unauthenticated caller and a cross-origin switch are refused', async () => {
  const anonymous = await harness.call('/api/dev-workspace-index/dev-mode', { method: 'POST', user: null });
  assert.ok([401, 403].includes(anonymous.status), anonymous.text);
  const catalog = await harness.call('/api/jarvis/package-tools/catalog', { user: null });
  assert.equal(catalog.status, 401);
  const crossOrigin = await harness.call('/api/dev-workspace-index/dev-mode', { method: 'POST', headers: { origin: 'https://foreign.example.test' } });
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.json.error, 'same_origin_action_required');
  const noMarker = await harness.call('/api/dev-workspace-index/dev-mode', { method: 'POST', headers: { 'x-oshal-dev-workspace': '0' } });
  assert.equal(noMarker.status, 403);
});

test('dev mode expires by the TTL and a proposal captured while it was on fails once it is off', async () => {
  const on = await harness.call('/api/dev-workspace-index/dev-mode', { method: 'POST' });
  assert.equal(on.status, 200, on.text);
  const live = await harness.jarvis('alice', TOOL, ASK);
  assert.equal(live.execute.status, 200, live.execute.text);
  clock += 60_000;
  const expired = await harness.jarvis('alice', TOOL, ASK);
  refused(expired.execute, 'execute after TTL');
  assert.equal((await harness.call('/api/dev-workspace-index/dev-mode')).json.devMode.enabled, false);
  assert.equal((await harness.call('/api/dev-workspace-index/dev-mode', { method: 'POST' })).status, 200);
  const pending = await harness.call('/api/jarvis/package-tools/preview', { body: { sessionId: `session-${ACTORS.alice.sub}`, toolName: TOOL, input: ASK } });
  assert.equal(pending.status, 200, pending.text);
  assert.equal((await harness.call('/api/dev-workspace-index/dev-mode', { method: 'DELETE' })).json.devMode.enabled, false);
  const late = await harness.call('/api/jarvis/package-tools/execute', { body: { proposalId: pending.json.id } });
  refused(late, 'execute after dev mode was turned off');
});

test('a fresh process starts with dev mode off for the same super-admin', async () => {
  assert.equal((await harness.call('/api/dev-workspace-index/dev-mode', { method: 'POST' })).status, 200);
  await harness.stop();
  harness = await startHarness({ indexFile });
  await harness.grant(ACTORS.alice);
  const state = await harness.call('/api/dev-workspace-index/dev-mode');
  assert.equal(state.status, 200, state.text);
  assert.equal(state.json.devMode.enabled, false);
  const { execute } = await harness.jarvis('alice', TOOL, ASK);
  refused(execute, 'execute in a fresh process');
});
