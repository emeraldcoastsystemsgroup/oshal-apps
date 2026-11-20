/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Guard Aero Lab's inline concierge posture, tool schemas, persona ```tool_call {"tool": ...} contract, and route execution under caller principal for oshald.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const MANIFEST = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
const PERSONA = fs.readFileSync(path.join(PKG, 'personas/aero-designer.yaml'), 'utf8');

function extractToolBlocks(manifestText) {
  const start = manifestText.indexOf('\ntools:\n');
  const end = manifestText.indexOf('\nui:\n', start);
  const section = manifestText.slice(start, end > 0 ? end : undefined);
  return section.split(/\n  - name:\s*/).slice(1).map((chunk) => ({
    name: chunk.split(/\r?\n/, 1)[0].trim(),
    block: chunk,
  }));
}

function loadRoutesWithMiniExpress() {
  const routerFactory = () => {
    const stack = [];
    const r = { stack };
    for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
      r[m] = (p, ...fns) => { stack.push({ method: m.toUpperCase(), path: p, fns }); return r; };
    }
    return r;
  };
  const origLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'express') return { Router: routerFactory };
    if (request === '@/shared/logger') {
      return { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) };
    }
    return origLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(path.join(PKG, 'routes/aero-lab-routes.js'))];
    return require(path.join(PKG, 'routes/aero-lab-routes.js'));
  } finally {
    Module._load = origLoad;
  }
}

async function callRoute(router, method, routePath, { sub = 'alice', body = {} } = {}) {
  const layer = router.stack.find((l) => l.method === method && l.path === routePath);
  assert.ok(layer, `route ${method} ${routePath} registered`);
  return new Promise((resolve) => {
    const req = { method, path: routePath, params: {}, query: {}, body, oidc: { user: { sub } } };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(payload) { resolve({ statusCode: this.statusCode, payload }); },
    };
    for (const fn of layer.fns) fn(req, res, () => {});
  });
}

test('aero-lab declares inline aero-designer as chatBot with explicit object inputSchema on every tool', () => {
  assert.match(MANIFEST, /\nchatBot:\s*aero-designer\b/);
  const botSection = MANIFEST.slice(MANIFEST.indexOf('\nbots:\n'), MANIFEST.indexOf('\ntools:\n'));
  assert.match(botSection, /\n    name:\s*aero-designer\b/);
  assert.match(botSection, /\n    posture:\s*inline\b/);
  const tools = extractToolBlocks(MANIFEST);
  const expected = [
    'aero-capabilities', 'aero-polar', 'aero-evaluate', 'aero-screen',
    'aero-export', 'propose-aero-draft', 'draft-aero-design',
  ];
  assert.deepEqual(tools.map((t) => t.name), expected);
  for (const { name, block } of tools) {
    assert.match(block, /executorType:\s*api\b/, `${name} is executorType: api`);
    assert.match(block, /apiEndpoint:\s*"(GET|POST) \/api\/aero-lab\//, `${name} targets /api/aero-lab/`);
    assert.match(block, /inputSchema:[\s\S]*?type:\s*object\b/, `${name} declares an object inputSchema`);
  }
});

test('aero-designer persona teaches plain prose and ```tool_call with "tool" (never "name")', () => {
  assert.match(PERSONA, /plain prose/i);
  assert.ok(PERSONA.includes('```tool_call'));
  assert.match(PERSONA, /"tool"/);
  assert.doesNotMatch(PERSONA, /```tool_call[\s\S]*?"name"\s*:/);
  for (const { name } of extractToolBlocks(MANIFEST)) {
    assert.match(PERSONA, new RegExp(`\\b${name}\\b`), `persona names ${name}`);
  }
});

test('aero-lab route handlers execute under caller principal for capabilities and draft tools', async () => {
  const { createAeroLabRoutes, DEFAULT_DESIGN } = loadRoutesWithMiniExpress();
  const stubAdapter = {
    engineStatus: () => ({
      present: true, transport: 'container', engineAddr: 'native://engine.exchange',
      installHint: 'automatic', engineDir: path.join(PKG, 'engine'), python: '', venvOk: false, workerPath: '', workerOk: false,
    }),
    refreshNativeStatus: async () => ({ state: 'ready' }),
    capabilities: async () => ({ engineVersion: '1.4.7', capabilities: { polar: true, evaluate: true, hybrid: false }, bounds: {} }),
    cachedCapabilities: () => null,
    workDir: '/tmp/aero-test',
  };
  const router = createAeroLabRoutes({ adapter: stubAdapter, ctx: { appPackageDir: PKG } });
  const caps = await callRoute(router, 'GET', '/capabilities', { sub: 'operator-1' });
  assert.equal(caps.statusCode, 200);
  assert.equal(caps.payload.engine.present, true);
  assert.deepEqual(caps.payload.engine.lifecycle, { state: 'ready' });
  assert.equal(caps.payload.capabilities.polar, true);

  const seed = await callRoute(router, 'POST', '/draft/design', { sub: 'operator-1', body: { design: DEFAULT_DESIGN } });
  assert.equal(seed.statusCode, 200);
  const draft = await callRoute(router, 'POST', '/draft', {
    sub: 'operator-1',
    body: {
      say: 'Increase battery mass for longer night endurance.',
      draft: { battery_mass_kg: 2.5 },
      moves: { battery_mass_kg: 'up' },
    },
  });
  assert.equal(draft.statusCode, 200);
  assert.equal(draft.payload.offered, true);
});
