/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Guard Drone Relay's inline concierge posture, tool schemas, persona ```tool_call {"tool": ...} contract, and route execution under caller principal for oshald.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const MANIFEST = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
const PERSONA = fs.readFileSync(path.join(PKG, 'personas/relay-designer.yaml'), 'utf8');

function extractToolBlocks(manifestText) {
  const start = manifestText.indexOf('\ntools:\n');
  const end = manifestText.indexOf('\nui:\n', start);
  const section = manifestText.slice(start, end > 0 ? end : undefined);
  return section.split(/\n  - name:\s*/).slice(1).map((chunk) => ({
    name: chunk.split(/\r?\n/, 1)[0].trim(),
    block: chunk,
  }));
}

function loadRelayRoutes() {
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
    return origLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(path.join(PKG, 'routes/drone-relay-routes.js'))];
    return require(path.join(PKG, 'routes/drone-relay-routes.js'));
  } finally {
    Module._load = origLoad;
  }
}

test('drone-relay declares inline relay-designer as chatBot with explicit object inputSchema on all 12 tools', () => {
  assert.match(MANIFEST, /\nchatBot:\s*relay-designer\b/);
  const botSection = MANIFEST.slice(MANIFEST.indexOf('\nbots:\n'), MANIFEST.indexOf('\ntools:\n'));
  assert.match(botSection, /\n    name:\s*relay-designer\b/);
  assert.match(botSection, /\n    posture:\s*inline\b/);
  const tools = extractToolBlocks(MANIFEST);
  const expected = [
    'relay-capabilities', 'relay-transports', 'relay-link-budget', 'relay-list-plans',
    'relay-get-plan', 'relay-preview-plan', 'relay-create-plan', 'relay-update-plan',
    'relay-simulate', 'relay-design-doc', 'relay-trace-envelope', 'relay-fleet-mission-draft',
  ];
  assert.deepEqual(tools.map((t) => t.name), expected);
  for (const { name, block } of tools) {
    assert.match(block, /executorType:\s*api\b/, `${name} is executorType: api`);
    assert.match(block, /apiEndpoint:\s*"(GET|POST|PATCH) \/api\/drone-relay\//, `${name} targets /api/drone-relay/`);
    assert.match(block, /inputSchema:[\s\S]*?type:\s*object\b/, `${name} declares an object inputSchema`);
  }
});

test('relay-designer persona teaches plain prose and ```tool_call with "tool" (never "name") for all 12 tools', () => {
  assert.match(PERSONA, /plain prose/i);
  assert.ok(PERSONA.includes('```tool_call'));
  assert.match(PERSONA, /"tool"/);
  assert.doesNotMatch(PERSONA, /```tool_call[\s\S]*?"name"\s*:/);
  for (const { name } of extractToolBlocks(MANIFEST)) {
    assert.match(PERSONA, new RegExp(`\\b${name}\\b`), `persona names ${name}`);
  }
});

test('drone-relay GET /capabilities and GET /plans execute cleanly under caller principal', async () => {
  const { createDroneRelayRoutes } = loadRelayRoutes();
  const pool = { async query() { return { rows: [] }; } };
  const router = createDroneRelayRoutes({ pool, appPackageDir: PKG });

  const capsLayer = router.stack.find((l) => l.method === 'GET' && l.path === '/capabilities');
  assert.ok(capsLayer);
  const capsRes = { statusCode: 200, payload: null, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; } };
  await capsLayer.fns[0]({ oidc: { user: { sub: 'alice' } } }, capsRes, () => {});
  assert.equal(capsRes.statusCode, 200);
  assert.equal(capsRes.payload.app, 'drone-relay');

  const req = { method: 'GET', path: '/plans', params: {}, query: {}, oidc: { user: { sub: 'alice' } } };
  const res = { statusCode: 200, payload: null, headersSent: false, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; this.headersSent = true; } };
  for (const layer of router.stack) {
    if (layer.method === 'USE') { await layer.fns[0](req, res, () => {}); if (res.headersSent) break; }
    if (layer.method === 'GET' && layer.path === '/plans') {
      for (const fn of layer.fns) { await fn(req, res, () => {}); if (res.headersSent) break; }
      break;
    }
  }
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.plans, []);
});
