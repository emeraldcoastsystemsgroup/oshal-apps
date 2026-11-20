/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Guard Animatronics' inline concierge posture, tool schemas, persona ```tool_call {"tool": ...} contract, and route execution under caller principal for oshald.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const MANIFEST = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
const PERSONA = fs.readFileSync(path.join(PKG, 'personas/animatronics-director.yaml'), 'utf8');

function extractToolBlocks(manifestText) {
  const start = manifestText.indexOf('\ntools:\n');
  const end = manifestText.indexOf('\nui:\n', start);
  const section = manifestText.slice(start, end > 0 ? end : undefined);
  return section.split(/\n  - name:\s*/).slice(1).map((chunk) => ({
    name: chunk.split(/\r?\n/, 1)[0].trim(),
    block: chunk,
  }));
}

function loadAnimatronicsRoutes() {
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
    return origLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(path.join(PKG, 'routes/animatronics-routes.js'))];
    return require(path.join(PKG, 'routes/animatronics-routes.js'));
  } finally {
    Module._load = origLoad;
  }
}

test('animatronics declares inline animatronics-director as chatBot with explicit object inputSchema on all 12 tools', () => {
  assert.match(MANIFEST, /\nchatBot:\s*animatronics-director\b/);
  const botSection = MANIFEST.slice(MANIFEST.indexOf('\nbots:\n'), MANIFEST.indexOf('\ntools:\n'));
  assert.match(botSection, /\n    name:\s*animatronics-director\b/);
  assert.match(botSection, /\n    posture:\s*inline\b/);
  const tools = extractToolBlocks(MANIFEST);
  const expected = [
    'animatronics-capabilities', 'animatronics-list-rigs', 'animatronics-get-rig',
    'animatronics-create-rig', 'animatronics-update-rig', 'animatronics-set-pose',
    'animatronics-delete-pose', 'animatronics-set-scenario', 'animatronics-delete-scenario',
    'animatronics-rehearse', 'animatronics-look-at', 'animatronics-servo-catalog',
  ];
  assert.deepEqual(tools.map((t) => t.name), expected);
  for (const { name, block } of tools) {
    assert.match(block, /executorType:\s*api\b/, `${name} is executorType: api`);
    assert.match(block, /apiEndpoint:\s*"(GET|POST|PUT|PATCH|DELETE) \/api\/animatronics\//, `${name} targets /api/animatronics/`);
    assert.match(block, /inputSchema:[\s\S]*?type:\s*object\b/, `${name} declares an object inputSchema`);
  }
});

test('animatronics-director persona teaches plain prose and ```tool_call with "tool" (never "name") for all 12 tools', () => {
  assert.match(PERSONA, /plain prose/i);
  assert.ok(PERSONA.includes('```tool_call'));
  assert.match(PERSONA, /"tool"/);
  assert.doesNotMatch(PERSONA, /```tool_call[\s\S]*?"name"\s*:/);
  for (const { name } of extractToolBlocks(MANIFEST)) {
    assert.match(PERSONA, new RegExp(`\\b${name}\\b`), `persona names ${name}`);
  }
});

test('animatronics GET /capabilities and GET /rigs execute cleanly under caller principal', async () => {
  const { createAnimatronicsRoutes } = loadAnimatronicsRoutes();
  const pool = { async query() { return { rows: [] }; } };
  const router = createAnimatronicsRoutes({ pool, appPackageDir: PKG });

  const capsLayer = router.stack.find((l) => l.method === 'GET' && l.path === '/capabilities');
  assert.ok(capsLayer);
  const capsRes = { statusCode: 200, payload: null, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; } };
  await capsLayer.fns[0]({ oidc: { user: { sub: 'alice' } } }, capsRes, () => {});
  assert.equal(capsRes.statusCode, 200);
  assert.equal(capsRes.payload.app, 'animatronics');

  const req = { method: 'GET', path: '/rigs', params: {}, query: {}, oidc: { user: { sub: 'alice' } } };
  const res = { statusCode: 200, payload: null, headersSent: false, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; this.headersSent = true; } };
  for (const layer of router.stack) {
    if (layer.method === 'USE') { await layer.fns[0](req, res, () => {}); if (res.headersSent) break; }
    if (layer.method === 'GET' && layer.path === '/rigs') {
      for (const fn of layer.fns) { await fn(req, res, () => {}); if (res.headersSent) break; }
      break;
    }
  }
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.rigs, []);
});
