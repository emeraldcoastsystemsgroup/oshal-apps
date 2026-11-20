/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 0.5.2 (BACKLOG B3): prove caller-scoped GET /api/cad-studio/artifacts (artifacts.provides), revision-row "Print in Scan to Print" + ADR-139 attributes, and confirmed Scan to Print multipart "model" STL handoff.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const Module = require('node:module');
const { randomUUID } = require('node:crypto');

const PKG = path.resolve(__dirname, '..');
const { artifactPath, ensureDir, revisionDir } = require(path.join(PKG, 'routes/data-dir.js'));
const VIEWPORT_JS = fs.readFileSync(path.join(PKG, 'tools/cad-viewport-tools.js'), 'utf8');
const STUDIO_JS = fs.readFileSync(path.join(PKG, 'tools/cad-studio.js'), 'utf8');
const STUDIO_HTML = fs.readFileSync(path.join(PKG, 'tools/cad-studio.html'), 'utf8');
const MANIFEST_RAW = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');

function loadModelRoutes() {
  const routerFactory = () => {
    const stack = [];
    const r = { stack, param: () => r, use: (fn) => { stack.push({ method: 'USE', path: '', fns: [fn] }); return r; } };
    for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
      r[m] = (p, ...fns) => { stack.push({ method: m.toUpperCase(), path: p, fns }); return r; };
    }
    return r;
  };
  const origLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'express') return { Router: routerFactory };
    if (request === 'multer') {
      const m = () => ({ single: () => (_req, _res, next) => next() });
      m.memoryStorage = () => ({});
      return m;
    }
    if (request === '@/shared/logger') {
      return { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) };
    }
    return origLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(path.join(PKG, 'routes/model-routes.js'))];
    return require(path.join(PKG, 'routes/model-routes.js'));
  } finally {
    Module._load = origLoad;
  }
}

async function invokeGet(router, routePath, { sub = 'alice', query = {} } = {}) {
  const req = { method: 'GET', path: routePath, params: {}, query, _sub: sub };
  const headers = {};
  const res = {
    statusCode: 200,
    headers,
    payload: undefined,
    headersSent: false,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.payload = b; this.headersSent = true; return this; },
  };
  for (const layer of router.stack) {
    if (layer.method === 'USE') {
      let advanced = false;
      await layer.fns[0](req, res, () => { advanced = true; });
      if (res.headersSent || !advanced) return res;
      continue;
    }
    if (layer.method === 'GET' && layer.path === routePath) {
      for (const fn of layer.fns) {
        await fn(req, res, () => {});
        if (res.headersSent) return res;
      }
    }
  }
  return { statusCode: 404, headers, payload: { error: 'not_found' } };
}

test('B3: manifest declares artifacts.provides and HTML loads ADR-139 send-to.js', () => {
  assert.match(MANIFEST_RAW, /\nartifacts:\n\s+provides:\n\s+- label:\s*CAD Studio\b/);
  assert.match(MANIFEST_RAW, /types:\s*\[model\/stl,\s*model\/3mf,\s*model\/obj,\s*model\/step\]/);
  assert.match(MANIFEST_RAW, /list:\s*\/api\/cad-studio\/artifacts\b/);
  assert.match(STUDIO_HTML, /<script src="\/api\/artifacts\/send-to\.js" defer><\/script>/);
  assert.match(STUDIO_JS, /Print in Scan to Print/);
  assert.match(STUDIO_JS, /data-artifact-source/);
  assert.match(STUDIO_JS, /data-artifact-type': 'model\/stl'/);
});

test('B3: GET /artifacts lists only the signed-in caller built revision artifacts with no-store and cursor validation', async () => {
  const { createModelRoutes } = loadModelRoutes();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-b3-art-'));
  const aliceModel = randomUUID();
  const aliceDraft = randomUUID();
  const bobModel = randomUUID();
  try {
    const aliceRev = revisionDir(tmpRoot, 'alice', aliceModel, 2);
    ensureDir(aliceRev);
    fs.writeFileSync(artifactPath(aliceRev, 'stl'), Buffer.from('solid a\nendsolid a\n'));
    fs.writeFileSync(artifactPath(aliceRev, 'step'), Buffer.from('ISO-10303-21;\nEND-ISO-10303-21;\n'));

    const bobRev = revisionDir(tmpRoot, 'bob', bobModel, 1);
    ensureDir(bobRev);
    fs.writeFileSync(artifactPath(bobRev, 'stl'), Buffer.from('solid b\nendsolid b\n'));

    const rows = [
      { model_id: aliceModel, owner_sub: 'alice', title: 'Bracket Mount', revision: 2, state: 'built', base: { kind: 'box' }, features: [], settings: {}, updated_at: '2026-11-19T00:00:00Z' },
      { model_id: aliceDraft, owner_sub: 'alice', title: 'Unbuilt Draft', revision: 0, state: 'draft', base: { kind: 'box' }, features: [], settings: {}, updated_at: '2026-11-19T00:00:00Z' },
      { model_id: bobModel, owner_sub: 'bob', title: 'Bob Secret', revision: 1, state: 'built', base: { kind: 'box' }, features: [], settings: {}, updated_at: '2026-11-19T00:00:00Z' },
    ];
    const pool = {
      async query(_sql, params) {
        return { rows: rows.filter((r) => r.owner_sub === params[0]) };
      },
    };
    const router = createModelRoutes({
      pool,
      engine: { status: () => ({ connected: true }) },
      dataRoot: tmpRoot,
      engineBuild: 'test-hash',
      callerSub: (req) => req._sub,
    });

    const unauth = await invokeGet(router, '/artifacts', { sub: null });
    assert.equal(unauth.statusCode, 401);

    const ok = await invokeGet(router, '/artifacts', { sub: 'alice' });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.headers['cache-control'], 'private, no-store');
    assert.deepEqual(ok.payload.folders, []);
    assert.equal(ok.payload.nextCursor, null);
    assert.deepEqual(
      ok.payload.items.map((i) => ({ name: i.name, type: i.type, source: i.source })),
      [
        { name: 'Bracket_Mount-r2.stl', type: 'model/stl', source: `/api/cad-studio/models/${aliceModel}/artifacts/stl?revision=2` },
        { name: 'Bracket_Mount-r2.3mf', type: 'model/3mf', source: `/api/cad-studio/models/${aliceModel}/artifacts/3mf?revision=2` },
        { name: 'Bracket_Mount-r2.obj', type: 'model/obj', source: `/api/cad-studio/models/${aliceModel}/artifacts/obj?revision=2` },
        { name: 'Bracket_Mount-r2.step', type: 'model/step', source: `/api/cad-studio/models/${aliceModel}/artifacts/step?revision=2` },
      ],
    );
    assert.equal(ok.payload.items.some((i) => i.name.includes('Bob') || i.name.includes('Draft')), false);

    const badCursor = await invokeGet(router, '/artifacts', { sub: 'alice', query: { cursor: 'not-valid-base64!!!' } });
    assert.equal(badCursor.statusCode, 400);
    assert.equal(badCursor.payload.error, 'invalid_cursor');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('B3: queueViaScanToPrint requires confirmation, posts multipart field "model" for chosen revision, and reads outcome', async () => {
  const posted = [];
  const toasts = [];
  const statusEl = { textContent: '' };
  const fakeFetch = async (url, init) => {
    if (url.includes('/artifacts/stl')) {
      return { ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer };
    }
    posted.push({ url, method: init.method, form: init.body });
    return {
      ok: true,
      json: async () => ({
        outcome: { uploaded: true, started: false, message: 'Uploaded to Bambu A1 — auto-start is off.' },
      }),
    };
  };
  const ctx = {
    window: { location: { search: '', origin: 'https://oshal.example' } },
    document: { querySelector: () => null, getElementById: (id) => (id === 'printer-status-msg' ? statusEl : null) },
    fetch: fakeFetch,
    FormData,
    Blob,
    TextEncoder,
    TextDecoder,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(VIEWPORT_JS, ctx);

  const model = { model_id: '11111111-1111-4111-8111-111111111111', title: 'Gear Hub', revision: 3 };
  const printer = { printer_id: '22222222-2222-4222-8222-222222222222', label: 'Bambu A1', kind: 'bambu-lan' };

  // Declined confirmation sends nothing
  await ctx.window.CadViewportTools.queueViaScanToPrint(
    { getModel: () => model, ask: async () => false, toast: (m, t) => toasts.push([m, t]) },
    printer,
    { disabled: false },
    2,
  );
  assert.equal(posted.length, 0, 'declining confirmation aborts handoff');

  // Confirmed handoff posts revision 2 STL under multipart field "model"
  const btn = { disabled: false };
  await ctx.window.CadViewportTools.queueViaScanToPrint(
    { getModel: () => model, ask: async () => true, toast: (m, t) => toasts.push([m, t]) },
    printer,
    btn,
    2,
  );
  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, '/api/scan-to-print/service/print');
  assert.equal(posted[0].method, 'POST');
  assert.equal(posted[0].form.get('printerId'), printer.printer_id);
  const filePart = posted[0].form.get('model');
  assert.ok(filePart, 'multipart field must be named "model"');
  assert.equal(posted[0].form.get('file'), null, 'must not use wrong field name "file"');
  assert.equal(filePart.name, 'Gear_Hub-r2.stl');
  assert.match(statusEl.textContent, /Uploaded to Bambu A1/);
  assert.equal(btn.disabled, false);
});
