/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify the package workflow and real compiled readiness route without using a provider or live database.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Preserve tool-less exact-context reasoning and release identity for forward-outcome reviews.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Verify 1.2.0 first-screen surface (/api/futures-research/app), ribbon defaultView, inline futures-research-concierge, and route-backed futures_research_overview read tool while keeping futures-research-worker tool-less.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const store = path.resolve(root, '..');
const candidates = [
  process.env.STORE_CI_TOOLCHAIN,
  process.env.OSHAL_FRAMEWORK,
  process.env.OSHAL_CORE_ROOT,
  path.join(store, 'scripts/toolchain'),
  '/app',
  path.resolve(root, '../../oshal'),
].filter(Boolean);
const core = candidates.map(candidate => path.resolve(candidate)).find(candidate => fs.existsSync(path.join(candidate, 'node_modules/express')));
assert.ok(core, 'Set STORE_CI_TOOLCHAIN or OSHAL_FRAMEWORK to a directory with installed dependencies; this suite does not silently skip.');
const coreRequire = createRequire(path.join(core, 'package.json'));
const express = coreRequire('express');
const yaml = coreRequire('js-yaml');
const manifest = yaml.load(fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8'));
const route = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'routes/package-smoke.js'), 'utf8'), {
  module: route, exports: route.exports, require: coreRequire,
}, { filename: 'package-smoke.js' });

test('dedicated workflow remains tool-less while inline concierge and own first screen are declared', () => {
  assert.equal(manifest.version, '1.2.0');
  assert.equal(manifest.ticketType, 'futures-research');
  assert.deepEqual(manifest.workflow, { name: 'Futures Research Review', pipeline: 'manifest-worker', workerBot: 'futures-research-worker', autoStart: true });
  assert.ok(manifest.uses.includes('bound-workflow-results'));
  assert.equal(manifest.chatBot, 'futures-research-concierge');
  assert.equal(manifest.bots.length, 2);

  const worker = manifest.bots.find(bot => bot.name === 'futures-research-worker');
  assert.ok(worker);
  assert.equal(worker.agentId, '7c51c6e6-cc8a-4de9-8695-40584737789d');
  assert.equal(worker.container, 'futures-research-worker');
  const workerPersona = yaml.load(fs.readFileSync(path.join(root, worker.persona), 'utf8'));
  assert.equal(workerPersona.agent_id, worker.agentId);
  assert.deepEqual(workerPersona.allowed_tools, []);
  assert.match(workerPersona.perspective, /exact context fingerprint/);
  assert.match(workerPersona.perspective, /not independent/);
  assert.match(workerPersona.perspective, /explicitly adopt/);

  const concierge = manifest.bots.find(bot => bot.name === 'futures-research-concierge');
  assert.ok(concierge);
  assert.equal(concierge.posture, 'inline');
  assert.equal(concierge.displayName, 'Futures Research concierge');
  assert.equal(concierge.role, 'concierge');
  assert.deepEqual(concierge.capabilities, ['futures-study-guidance']);
  assert.deepEqual(concierge.accessRoles, ['authenticated', 'operator', 'swarm']);
  const conciergePersona = yaml.load(fs.readFileSync(path.join(root, concierge.persona), 'utf8'));
  assert.equal(conciergePersona.agent_id, concierge.agentId);
  assert.deepEqual(conciergePersona.tools?.allow, ['futures_research_overview']);
  assert.match(conciergePersona.perspective, /plain prose/i);
  assert.ok(conciergePersona.perspective.includes('```tool_call'));
});

test('surface, ribbon, optional dependencies, summary and routes open Futures Research own screen', () => {
  assert.deepEqual(manifest.dependencies.required.connectors, []);
  assert.deepEqual(manifest.dependencies.optional.apps, ['intelligent-trades']);
  assert.equal(manifest.schedules, undefined, 'installation must not enroll users');
  assert.deepEqual(manifest.ui?.static, [{
    toolName: 'futures-research-home',
    label: 'Futures Research',
    icon: 'codicon codicon-graph-line',
    iframeUrl: '/api/futures-research/app',
    section: 'top',
  }]);
  assert.deepEqual(manifest.ribbon, {
    defaultView: 'futures-research-home',
    hideFrameworkItems: ['tickets', 'chat', 'calendar', 'addressbook', 'dashboard', 'logs', 'settings', 'operations'],
  });
  assert.equal(manifest.summary?.path, '/api/futures-research/home-summary');
  assert.equal(manifest.routes[0].auth, 'service');
  assert.equal(manifest.routes[0].requiresAi, false);
  assert.equal(manifest.routes[1].mountPath, '/api/futures-research');
  assert.equal(manifest.routes[1].auth, 'oidc');
  assert.equal(manifest.routes[1].requiresAi, false);
});

async function request(packageRoot) {
  const app = express();
  app.use('/', route.exports.createPackageSmokeRoutes({ appPackageDir: packageRoot }));
  const server = await new Promise(resolve => { const started = app.listen(0, '127.0.0.1', () => resolve(started)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
    return { status: response.status, body: await response.json() };
  } finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test('compiled readiness returns installed identity and fails closed for invalid or missing metadata', async () => {
  assert.deepEqual(await request(root), { status: 200, body: { status: 'ready', package: 'futures-research', version: '1.2.0', manifest: 'verified' } });
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'futures-package-readiness-'));
  try {
    for (const content of ['', 'name: invalid name\nversion: 1.0.0', 'x'.repeat(131073)]) {
      fs.writeFileSync(path.join(fixture, 'oshal-app.yaml'), content);
      assert.deepEqual(await request(fixture), { status: 503, body: { status: 'unavailable', code: 'package_integrity_failed' } });
    }
    assert.equal((await request(path.join(fixture, 'missing'))).status, 503);
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});
