/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Native-port contract: the package declares something runnable (the platform left only an inert declaration that opened nothing). Every workflow phase and the concierge name a bot this package declares or imports, every declared bot is inline with a persona file inside the package that answers in plain prose and teaches no shell, CLI script, workspace path or platform HTTP call, and no screen points at a platform-only route.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The only route a ported package may declare is the store's canonical service-authenticated readiness route, byte-identical to the reviewed brand-graphics module; any other route module (a platform TypeScript port) is still refused.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const store = path.resolve(root, '..');
const toolchain = path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(store, 'scripts', 'toolchain'));
const yaml = createRequire(path.join(toolchain, 'package.json'))('js-yaml');
const manifest = yaml.load(fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8'));
/** Platform screens and routes with no native route (they answered 404 on the native kernel). */
const PLATFORM_ONLY = ['/api/forge', '/api/security', '/intelligent-processing', '/system-health', '/alert-pipeline-admin',
  '/api/jarvis/ambient/person', '/task-explorer', '/queue-dashboard', '/mesh-dashboard', '/ops-dashboard', '/health-dashboard', '/rag-center'];
const own = (manifest.bots || []).map(bot => bot.name);
const imported = ['required', 'optional'].flatMap(tier => (manifest.dependencies?.[tier]?.bots || []));

test('the package declares something runnable: a concierge or a workflow, each bound to a declared or imported bot', () => {
  const phases = manifest.workflow?.phases || [];
  assert.ok(manifest.chatBot || phases.length, 'an inert declaration opens nothing');
  for (const phase of phases) {
    if (phase.action === 'complete') continue;
    assert.ok(own.includes(phase.bot) || imported.some(bot => bot.name === phase.bot), `phase ${phase.name} bot ${phase.bot}`);
  }
  if (manifest.chatBot) assert.ok(own.includes(manifest.chatBot) || imported.some(bot => bot.name === manifest.chatBot));
  for (const binding of imported) assert.ok(manifest.dependencies.required.apps.includes(binding.app), binding.app);
  const readiness = { module: 'routes/package-smoke.js', factory: 'createPackageSmokeRoutes',
    mountPath: `/api/${manifest.name}/_smoke`, auth: 'service', requiresContext: true, requiresAi: false };
  assert.deepEqual(manifest.routes, [readiness], 'only the canonical readiness route is declared');
  for (const file of ['routes/package-smoke.js', 'src-routes/package-smoke.ts']) {
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), fs.readFileSync(path.join(store, 'brand-graphics', file), 'utf8'), file);
  }
  assert.equal(manifest.tools, undefined, 'no CLI executor tool is declared');
});

test('declared bots are inline, own a persona inside the package and answer in plain prose without platform tooling', () => {
  for (const bot of manifest.bots || []) {
    assert.equal(bot.container, undefined, bot.name);
    assert.equal(bot.requiresOwnNode, undefined, bot.name);
    assert.ok(!['rca-specialist', 'queue-bot', 'general-bot'].includes(bot.name), `${bot.name} is a kernel or platform name`);
    const file = path.resolve(root, bot.persona);
    assert.ok(file.startsWith(root + path.sep) && fs.existsSync(file), bot.persona);
    const persona = yaml.load(fs.readFileSync(file, 'utf8'));
    assert.equal(persona.agent_id, bot.agentId);
    assert.match(persona.perspective, /plain prose/i);
    assert.doesNotMatch(persona.perspective, /curl |\/app\/|workspace-shared|oshal-local-api|node scripts\/|CLINE_WORKSPACE/);
  }
});

test('no screen points at a platform-only route', () => {
  for (const tile of manifest.ui?.static || []) {
    assert.ok(!PLATFORM_ONLY.some(prefix => tile.iframeUrl.startsWith(prefix)), tile.iframeUrl);
  }
});
