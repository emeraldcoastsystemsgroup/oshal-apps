/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the actual mounted nonexecuting remote-app operating packet, verified-caller refusal, closed tool declaration and unchanged own grants.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const yaml = (() => {
  for (const candidate of [path.resolve(__dirname, '../../scripts/toolchain/node_modules/js-yaml'), 'js-yaml']) {
    try { return require(candidate); } catch { /* use the installed test toolchain */ }
  }
  throw new Error('js-yaml is required: install the store test toolchain');
})();
const root = path.resolve(__dirname, '..');
const store = require('../lib/db.js');
const { createPhoneControlRoutes } = require('../routes/phone-control-routes.js');
const manifest = yaml.load(fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8'));
const catalog = yaml.load(fs.readFileSync(path.join(root, 'authorization.yaml'), 'utf8'));
const ROUTE = '/remote-apps/fire-tv/guide';
const TOOL = 'phone-control-fire-tv-guide';

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-remote-guide-'));
  const db = store.getDatabase(path.join(dir, 'fixture.sqlite'));
  const state = { actor: { isActive: true, issuer: 'https://issuer.example', sub: 'alice' }, intents: 0 };
  const router = createPhoneControlRoutes({ appPackageDir: root, db,
    authorization: { currentActor: () => state.actor, registerResource() {} },
    intent: async () => { state.intents += 1; throw new Error('a guide must not call a native action'); } });
  const server = http.createServer((req, res) => router.handle(req, res, () => { res.statusCode = 404; res.end('{}'); }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.base = `http://127.0.0.1:${server.address().port}`;
  state.get = async (suffix = '') => {
    const response = await fetch(state.base + ROUTE + suffix);
    return { status: response.status, body: await response.json() };
  };
  state.count = () => db.prepare('SELECT COUNT(*) AS n FROM phone_control_history').get().n;
  t.after(async () => { await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return state;
}

test('real mounted guide is a nonexecuting packet, without native calls or history writes', async (t) => {
  const state = await fixture(t), before = state.count();
  const answer = await state.get();
  assert.equal(answer.status, 200, 'actual remote-app guide route must exist');
  assert.equal(answer.body.version, 1);
  assert.equal(answer.body.kind, 'operating-guide');
  assert.equal(answer.body.executed, false);
  assert.equal(answer.body.connection_verified, false);
  assert.equal(answer.body.playback_verified, false);
  assert.equal(answer.body.package, 'com.amazon.storm.lightning.client.aosp');
  assert.deepEqual(answer.body.required_native_tools, ['app.open', 'screen.read', 'desktop.control.pinned']);
  assert.equal(state.intents, 0);
  assert.equal(state.count(), before);
  assert.equal(answer.body.command, undefined);
  assert.equal(answer.body.computerRunRequest, undefined);
});

test('guide cannot assert a current pairing, select a target, or default to an old TV', async (t) => {
  const state = await fixture(t);
  const { status, body } = await state.get();
  assert.equal(status, 200);
  assert.equal(body.target_selection, 'exact-user-requested-target-required');
  assert.equal(body.preferred_existing_path, 'existing-selected-remote-first');
  const resume = body.steps.findIndex((step) => /centre\/select/.test(step));
  const search = body.steps.findIndex((step) => /Only when the person requests different content/.test(step));
  assert.ok(resume >= 0 && search > resume, 'current selected remote/resume comes before optional content search');
  assert.match(body.steps[resume], /Do not select a different TV/);
  assert.equal(body.missing_target_evidence, 'stop-before-input');
  assert.equal(body.uncertain_result, 'unverified-no-automatic-retry');
  assert.equal(body.authority, 'existing-original-owner-native-tools-only');
  assert.match(body.steps.join(' '), /read.*selected.*target/i);
  assert.match(body.steps.join(' '), /expected_app/);
  assert.match(body.steps.join(' '), /locked|unlock/);
  assert.match(body.verification.join(' '), /acknowledg.*not.*playback/i);
  for (const key of ['target_device_id', 'binding_id', 'relay_node_id', 'address', 'url', 'token']) assert.equal(body[key], undefined);
});

test('actual middleware requires the kernel caller and refuses caller-selected foreign scope', async (t) => {
  const state = await fixture(t);
  state.actor = null;
  assert.equal((await state.get()).status, 401);
  state.actor = { isActive: false, issuer: 'https://issuer.example', sub: 'alice' };
  assert.equal((await state.get()).status, 401);
  state.actor = { isActive: true, issuer: 'https://issuer.example', sub: 'alice' };
  assert.equal((await state.get('?owner=bob')).status, 400);
  assert.equal((await state.get('?scope=tenant')).status, 400);
  assert.equal(state.intents, 0);
});

test('guide query accepts no hidden operation, device, link, or retry', async (t) => {
  const state = await fixture(t);
  for (const key of ['device', 'phone', 'operation', 'target', 'url', 'retry', 'expected_app']) {
    assert.equal((await state.get(`?${key}=x`)).status, 400, key);
  }
  assert.equal(state.intents, 0);
});

test('both owners receive the same recipe, not another person\'s device facts', async (t) => {
  const state = await fixture(t), first = await state.get();
  state.actor = { isActive: true, issuer: 'https://issuer.example', sub: 'bob' };
  const second = await state.get();
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, first.body);
  assert.equal(JSON.stringify(second.body).includes('alice'), false);
  assert.equal(state.count(), 0);
});

test('declared fixed GET tool and route use existing Own read only, without granting actions', () => {
  const tool = manifest.tools.find((row) => row.name === TOOL);
  assert.ok(tool, 'actual guide tool must be declared');
  assert.equal(tool.executor.apiEndpoint, `GET /api/phone-control${ROUTE}`);
  assert.equal(tool.executor.executorType, 'api');
  assert.deepEqual(tool.inputSchema, { type: 'object', properties: {}, additionalProperties: false });
  assert.equal(tool.computerPlan, undefined);
  assert.equal(tool.requiresApproval, false);
  const route = catalog.bindings.http.find((row) => row.method === 'GET' && row.path === ROUTE);
  const binding = catalog.bindings.tools.find((row) => row.id === TOOL);
  assert.deepEqual(route.allOf, ['execution.view', 'execution.read']);
  assert.deepEqual(binding.allOf, route.allOf);
  for (const role of Object.values(catalog.roles)) assert.ok(role.grants.every((g) => g.scope === 'own'));
});
