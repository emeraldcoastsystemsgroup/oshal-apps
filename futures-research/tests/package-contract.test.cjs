/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify the package workflow and real compiled readiness route without using a provider or live database.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Preserve tool-less exact-context reasoning and release identity for forward-outcome reviews.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const candidates = [process.env.OSHAL_FRAMEWORK, process.env.OSHAL_CORE_ROOT, '/app', path.resolve(root, '../../oshal')].filter(Boolean);
const core = candidates.map(candidate => path.resolve(candidate)).find(candidate => fs.existsSync(path.join(candidate, 'node_modules/express')));
assert.ok(core, 'Set OSHAL_FRAMEWORK to a core checkout with installed dependencies; this suite does not silently skip.');
const coreRequire = createRequire(path.join(core, 'package.json'));
const express = coreRequire('express');
const yaml = coreRequire('js-yaml');
const manifest = yaml.load(fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8'));
const route = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'routes/package-smoke.js'), 'utf8'), {
  module: route, exports: route.exports, require: coreRequire,
}, { filename: 'package-smoke.js' });

test('dedicated workflow is tool-less and declares the framework compatibility floor', () => {
  assert.equal(manifest.ticketType, 'futures-research');
  assert.deepEqual(manifest.workflow, { name: 'Futures Research Review', pipeline: 'manifest-worker', workerBot: 'futures-research-worker', autoStart: true });
  assert.ok(manifest.uses.includes('bound-workflow-results'));
  assert.equal(manifest.bots.length, 1);
  const bot = manifest.bots[0];
  assert.equal(bot.agentId, '7c51c6e6-cc8a-4de9-8695-40584737789d');
  assert.equal(bot.container, bot.name);
  const persona = yaml.load(fs.readFileSync(path.join(root, bot.persona), 'utf8'));
  assert.equal(persona.agent_id, bot.agentId);
  assert.deepEqual(persona.allowed_tools, []);
  assert.match(persona.perspective, /exact context fingerprint/);
  assert.match(persona.perspective, /not independent/);
  assert.match(persona.perspective, /explicitly adopt/);
  assert.deepEqual(manifest.dependencies.required.connectors, []);
  assert.equal(manifest.schedules, undefined, 'installation must not enroll users');
  assert.equal(manifest.routes[0].auth, 'service');
  assert.equal(manifest.routes[0].requiresAi, false);
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
  assert.deepEqual(await request(root), { status: 200, body: { status: 'ready', package: 'futures-research', version: '1.1.0', manifest: 'verified' } });
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'futures-package-readiness-'));
  try {
    for (const content of ['', 'name: invalid name\nversion: 1.0.0', 'x'.repeat(131073)]) {
      fs.writeFileSync(path.join(fixture, 'oshal-app.yaml'), content);
      assert.deepEqual(await request(fixture), { status: 503, body: { status: 'unavailable', code: 'package_integrity_failed' } });
    }
    assert.equal((await request(path.join(fixture, 'missing'))).status, 503);
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});
