/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Guard Embodied Swarm's inline concierge posture, tool schemas, persona ```tool_call {"tool": ...} contract, and route execution under caller principal for oshald.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Design Studio B3: verify GET /physics/status nodes[] and GET /capabilities publish tickHz and sensor rateHz cleanly without breaking existing fields.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const MANIFEST = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
const PERSONA = fs.readFileSync(path.join(PKG, 'personas/embodied-operator.yaml'), 'utf8');

function extractToolBlocks(manifestText) {
  const start = manifestText.indexOf('\ntools:\n');
  const end = manifestText.indexOf('\nui:\n', start);
  const section = manifestText.slice(start, end > 0 ? end : undefined);
  return section.split(/\n  - name:\s*/).slice(1).map((chunk) => ({
    name: chunk.split(/\r?\n/, 1)[0].trim(),
    block: chunk,
  }));
}

function loadEmbodiedRoutes() {
  const routerFactory = () => {
    const stack = [];
    const r = {
      stack,
      param: () => r,
      use: (p, sub) => {
        if (typeof p === 'string' && sub?.stack) {
          for (const layer of sub.stack) stack.push({ ...layer, path: p + layer.path });
        } else if (p?.stack) {
          for (const layer of p.stack) stack.push(layer);
        } else if (typeof p === 'function') {
          stack.push({ method: 'USE', path: '', fns: [p] });
        }
        return r;
      },
    };
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
    if (request === '@/shared/security/explicit-write-confirmation') {
      return {
        hasExplicitWriteConfirmation: (b) => b?.confirm === true,
        confirmationRequiredPayload: (action, description) => ({ error: 'confirmation_required', action, description }),
      };
    }
    if (request === '@/shared/artifact-exchange') {
      return { redeemArtifactViaRelay: async () => ({ ok: false, status: 404, error: 'not_found' }) };
    }
    return origLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(path.join(PKG, 'routes/embodied-routes.js'))];
    return require(path.join(PKG, 'routes/embodied-routes.js'));
  } finally {
    Module._load = origLoad;
  }
}

test('embodied declares inline embodied-operator as chatBot with explicit object inputSchema on all 9 tools', () => {
  assert.match(MANIFEST, /\nchatBot:\s*embodied-operator\b/);
  const botSection = MANIFEST.slice(MANIFEST.indexOf('\nbots:\n'), MANIFEST.indexOf('\ntools:\n'));
  assert.match(botSection, /\n    name:\s*embodied-operator\b/);
  assert.match(botSection, /\n    posture:\s*inline\b/);
  const tools = extractToolBlocks(MANIFEST);
  const expected = [
    'embodied-capabilities', 'embodied-state', 'embodied-physics-status',
    'embodied-physics-reports', 'embodied-build-drone', 'embodied-world',
    'embodied-label', 'embodied-tasks', 'embodied-command-log',
  ];
  assert.deepEqual(tools.map((t) => t.name), expected);
  for (const { name, block } of tools) {
    assert.match(block, /executorType:\s*api\b/, `${name} is executorType: api`);
    assert.match(block, /apiEndpoint:\s*"(GET|POST) \/api\/embodied\//, `${name} targets /api/embodied/`);
    assert.match(block, /inputSchema:[\s\S]*?type:\s*object\b/, `${name} declares an object inputSchema`);
  }
});

test('embodied-operator persona teaches plain prose and ```tool_call with "tool" (never "name") for all 9 tools', () => {
  assert.match(PERSONA, /plain prose/i);
  assert.ok(PERSONA.includes('```tool_call'));
  assert.match(PERSONA, /"tool"/);
  assert.doesNotMatch(PERSONA, /```tool_call[\s\S]*?"name"\s*:/);
  for (const { name } of extractToolBlocks(MANIFEST)) {
    assert.match(PERSONA, new RegExp(`\\b${name}\\b`), `persona names ${name}`);
  }
});

test('embodied GET /capabilities and GET /tasks execute cleanly under caller principal', async () => {
  const { createEmbodiedRoutes } = loadEmbodiedRoutes();
  const pool = { async query() { return { rows: [] }; } };
  const router = createEmbodiedRoutes({ pool, appPackageDir: PKG });

  const runGet = async (routePath) => {
    const req = { method: 'GET', path: routePath, params: {}, query: {}, oidc: { user: { sub: 'alice' } } };
    const res = { statusCode: 200, payload: null, headersSent: false, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; this.headersSent = true; } };
    for (const layer of router.stack) {
      if (layer.method === 'USE') { await layer.fns[0](req, res, () => {}); if (res.headersSent) break; }
      if (layer.method === 'GET' && layer.path === routePath) {
        for (const fn of layer.fns) { await fn(req, res, () => {}); if (res.headersSent) break; }
        break;
      }
    }
    return res;
  };

  const caps = await runGet('/capabilities');
  assert.equal(caps.statusCode, 200);
  assert.equal(caps.payload.app, 'embodied');

  const tasks = await runGet('/tasks');
  assert.equal(tasks.statusCode, 200);
  assert.ok(Array.isArray(tasks.payload));
});

test('B3: GET /physics/status nodes[] and GET /capabilities publish node tickHz and sensor rateHz cleanly', async () => {
  const { createEmbodiedRoutes } = loadEmbodiedRoutes();
  const { DroneNodeFleet } = require(path.join(PKG, 'routes/engine/node/node-fleet.js'));
  const pool = { async query() { return { rows: [] }; } };
  const nowMs = 1_000_000;
  const fleet = new DroneNodeFleet({ endpointHosts: ['127.0.0.1'] });
  fleet.ingest({
    nodeId: 'spider-pi', kind: 'hexapod', endpointUrl: 'http://127.0.0.1:7421',
    protocol: 1, engine: 'hexapod-fake', version: '0.1.0', buildHash: 'abc123', tickHz: 50,
  }, nowMs, 'alice');
  fleet.ingest({
    nodeId: 'custom-hex', kind: 'hexapod', endpointUrl: 'http://127.0.0.1:7422',
    protocol: 1, engine: 'hexapod-serial', version: '0.2.0', buildHash: 'def456', tickHz: 100,
    senses: [{ name: 'lidar', rateHz: 12 }, { name: 'imu', rateHz: 200 }, { name: 'joint-state', rateHz: 100 }],
  }, nowMs, 'alice');
  const router = createEmbodiedRoutes({ pool, appPackageDir: PKG }, { now: () => nowMs, fleet, engineAddr: '127.0.0.1:1' });

  const runGet = async (routePath) => {
    const req = { method: 'GET', path: routePath, params: {}, query: {}, oidc: { user: { sub: 'alice' } } };
    const res = { statusCode: 200, payload: null, headersSent: false, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; this.headersSent = true; } };
    for (const layer of router.stack) {
      if (layer.method === 'USE') { await layer.fns[0](req, res, () => {}); if (res.headersSent) break; }
      if (layer.method === 'GET' && layer.path === routePath) {
        for (const fn of layer.fns) { await fn(req, res, () => {}); if (res.headersSent) break; }
        break;
      }
    }
    return res;
  };

  const status = await runGet('/physics/status');
  assert.equal(status.statusCode, 200);
  const spider = status.payload.nodes.find((n) => n.nodeId === 'spider-pi');
  assert.ok(spider, 'spider-pi listed on /physics/status');
  assert.equal(spider.kind, 'hexapod');
  assert.equal(spider.online, true);
  assert.equal(spider.endpointUrl, 'http://127.0.0.1:7421');
  assert.equal(spider.tickHz, 50);
  assert.equal(spider.senses.find((s) => s.name === 'lidar').rateHz, 10);
  assert.equal(spider.senses.find((s) => s.name === 'imu').rateHz, 100);
  assert.equal(spider.senses.find((s) => s.name === 'joint-state').rateHz, 50);

  const custom = status.payload.nodes.find((n) => n.nodeId === 'custom-hex');
  assert.equal(custom.tickHz, 100);
  assert.deepEqual(custom.senses, [{ name: 'lidar', rateHz: 12 }, { name: 'imu', rateHz: 200 }, { name: 'joint-state', rateHz: 100 }]);

  const caps = await runGet('/capabilities');
  assert.equal(caps.statusCode, 200);
  const hexManifest = caps.payload.nodes.find((n) => n.kind === 'hexapod');
  assert.ok(hexManifest, 'SPIDER_18_MANIFEST published on /capabilities');
  assert.equal(hexManifest.envelope.tickHz, 50);
  assert.equal(hexManifest.senseRates.lidar, 10);
  assert.equal(hexManifest.senseRates.imu, 100);
  assert.equal(hexManifest.senseRates['joint-state'], 50);

  const design = await runGet('/build/hexapod');
  assert.equal(design.statusCode, 200);
  assert.equal(design.payload.bought.find((b) => b.id === 'ld19-lidar').rateHz, 10);
  assert.equal(design.payload.bought.find((b) => b.id === 'bno055-imu').rateHz, 100);
  assert.deepEqual(design.payload.senses.map((s) => `${s.name}:${s.rateHz}`), ['lidar:10', 'imu:100', 'joints:50']);
});
