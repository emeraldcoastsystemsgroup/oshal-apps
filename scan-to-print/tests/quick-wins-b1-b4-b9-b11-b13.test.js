/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | 0.10.2: RED -> GREEN unit & contract proofs for scan-to-print quick wins: B1 (depth map upload UI & validation), B4 (artifacts.provides manifest + caller-scoped GET /artifacts listing with pagination), B9 (GET /markers printable 6-face SVG sheet & individual face + UI download link), B11 (symmetry parameter on settings/reconstruct + UI option), and B13 (nozzleMm, layerHeightMm, perimeters print-check bounds on routes & UI).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const { artifactPath, ensureDir, jobDir } = require('../routes/data-dir.js');
const HTML = fs.readFileSync(path.join(__dirname, '../tools/scan-to-print.html'), 'utf8');
const MANIFEST = fs.readFileSync(path.join(__dirname, '../oshal-app.yaml'), 'utf8');
const AUTHZ = fs.readFileSync(path.join(__dirname, '../authorization.yaml'), 'utf8');

function loadRouteModule(relFile) {
  const routerFactory = () => {
    const stack = [];
    const r = { stack };
    for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
      r[m] = (p, ...fns) => { stack.push({ method: m.toUpperCase(), path: p, fns }); return r; };
    }
    r.use = (...fns) => { stack.push({ method: 'USE', path: '/', fns }); return r; };
    r.param = () => r;
    return r;
  };
  const origLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'express') return { Router: routerFactory };
    if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
    if (request === 'sharp') return () => ({});
    if (request === 'multer') {
      const m = () => ({ single: () => (_q, _s, n) => n(), array: () => (_q, _s, n) => n() });
      m.memoryStorage = () => ({});
      m.diskStorage = () => ({});
      return m;
    }
    return origLoad.call(this, request, parent, isMain);
  };
  try {
    return require(path.join(__dirname, '..', relFile));
  } finally {
    Module._load = origLoad;
  }
}

async function invokeRouter(router, method, urlPath, { sub = 'owner-1', body = {}, query = {}, headers = {} } = {}) {
  const req = { method, path: urlPath, params: {}, body, query, headers, _sub: sub };
  const resHeaders = {};
  const res = {
    statusCode: 200, payload: undefined, contentType: 'application/json', headersSent: false,
    setHeader(k, v) { resHeaders[k.toLowerCase()] = v; },
    type(t) { this.contentType = t; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.payload = b; this.headersSent = true; return this; },
    send(b) { this.payload = b; this.headersSent = true; return this; },
  };
  const match = (pattern, actual) => {
    const a = pattern.split('/').filter(Boolean), b = actual.split('/').filter(Boolean);
    if (a.length !== b.length) return null;
    const params = {};
    for (let i = 0; i < a.length; i += 1) {
      if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
      else if (a[i] !== b[i]) return null;
    }
    return params;
  };
  for (const layer of router.stack) {
    if (res.headersSent) break;
    if (layer.method === 'USE') {
      for (const fn of layer.fns) {
        if (res.headersSent) break;
        let cont = false;
        await fn(req, res, () => { cont = true; });
        if (!cont) break;
      }
      continue;
    }
    if (layer.method !== method) continue;
    const params = match(layer.path, urlPath);
    if (!params) continue;
    req.params = params;
    for (const fn of layer.fns) {
      if (res.headersSent) break;
      await fn(req, res, () => {});
    }
  }
  return { status: res.statusCode, payload: res.payload, contentType: res.contentType, headers: resHeaders };
}

test('B4: manifest declares artifacts.provides and GET /artifacts lists only caller current STL/SVG/OBJ with pagination', async () => {
  assert.match(MANIFEST, /provides:\s*\n\s*- label:\s*Scan to Print\s*\n\s*types:\s*\[model\/stl,\s*image\/svg\+xml,\s*model\/obj\]\s*\n\s*list:\s*\/api\/scan-to-print\/artifacts/);
  assert.match(AUTHZ, /id:\s*list-artifacts,\s*method:\s*GET,\s*path:\s*\/artifacts,\s*allOf:\s*\[scan\.read\]/);
  const { createExchangeRoutes } = loadRouteModule('routes/exchange-routes.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stp-b4-'));
  try {
    const job1 = { job_id: '11111111-1111-4111-8111-111111111111', owner_sub: 'alice', title: 'Bracket V1', state: 'reconstructed', report: { printable: true } };
    const job2 = { job_id: '22222222-2222-4222-8222-222222222222', owner_sub: 'alice', title: 'Stale Draft', state: 'capturing', report: null };
    const dir1 = jobDir(tmp, 'alice', job1.job_id);
    ensureDir(path.join(dir1, 'artifacts'));
    fs.writeFileSync(artifactPath(dir1, 'stl'), Buffer.alloc(184, 1));
    fs.writeFileSync(artifactPath(dir1, 'svg'), '<svg/>');
    fs.writeFileSync(artifactPath(dir1, 'obj'), 'v 0 0 0\n');
    const pool = {
      async query(sql, params) {
        if (sql.includes('FROM scan_print_job') && params[0] === 'alice') return { rows: [job1, job2] };
        return { rows: [] };
      },
    };
    const router = createExchangeRoutes({ pool, dataRoot: tmp, callerSub: (req) => req._sub });
    const unauth = await invokeRouter(router, 'GET', '/artifacts', { sub: null });
    assert.equal(unauth.status, 401);
    const badCursor = await invokeRouter(router, 'GET', '/artifacts', { sub: 'alice', query: { cursor: 'abc' } });
    assert.equal(badCursor.status, 400);
    const ok = await invokeRouter(router, 'GET', '/artifacts', { sub: 'alice' });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers['cache-control'], 'private, no-store');
    assert.deepEqual(ok.payload.folders, []);
    assert.equal(ok.payload.nextCursor, null);
    assert.equal(ok.payload.items.length, 3);
    assert.deepEqual(ok.payload.items.map((x) => x.type), ['model/stl', 'image/svg+xml', 'model/obj']);
    assert.equal(ok.payload.items[0].source, `/api/scan-to-print/jobs/${job1.job_id}/artifacts/stl`);
    assert.equal(ok.payload.items[0].size, 184);
    const bob = await invokeRouter(router, 'GET', '/artifacts', { sub: 'bob' });
    assert.equal(bob.status, 200);
    assert.deepEqual(bob.payload.items, [], 'another owner sees none of alice artifacts');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('B9: GET /markers serves printable 6-face orientation cube SVG sheet and single face, and UI exposes download link', async () => {
  assert.match(AUTHZ, /id:\s*printable-markers,\s*method:\s*GET,\s*path:\s*\/markers,\s*allOf:\s*\[scan\.read\]/);
  assert.match(HTML, /id="download-markers"[^>]*href="\/api\/scan-to-print\/markers\?download=1"/);
  const { createExchangeRoutes } = loadRouteModule('routes/exchange-routes.js');
  const router = createExchangeRoutes({ pool: { async query() { return { rows: [] }; } }, dataRoot: os.tmpdir(), callerSub: (req) => req._sub });
  const sheet = await invokeRouter(router, 'GET', '/markers', { sub: 'alice', query: { download: '1' } });
  assert.equal(sheet.status, 200);
  assert.equal(sheet.contentType, 'image/svg+xml');
  assert.match(sheet.headers['content-disposition'], /orientation-cube-markers\.svg/);
  for (const face of ['front', 'back', 'left', 'right', 'top', 'bottom']) {
    assert.ok(String(sheet.payload).includes(face), `sheet includes ${face} face`);
  }
  const one = await invokeRouter(router, 'GET', '/markers', { sub: 'alice', query: { view: 'front', sideMm: '50' } });
  assert.equal(one.status, 200);
  assert.match(String(one.payload), /width="50mm"/);
  const badView = await invokeRouter(router, 'GET', '/markers', { sub: 'alice', query: { view: 'diagonal' } });
  assert.equal(badView.status, 400);
  const badSide = await invokeRouter(router, 'GET', '/markers', { sub: 'alice', query: { sideMm: '500' } });
  assert.equal(badSide.status, 400);
});

test('B1: UI exposes depth map upload controls and validation for POST /jobs/:id/depth', () => {
  for (const id of ['depth-panel', 'depth-file', 'depth-format', 'depth-view', 'depth-mm-per-px', 'depth-plane-mm', 'depth-scale', 'depth-u-center', 'depth-v-center', 'upload-depth', 'depth-note']) {
    assert.ok(HTML.includes(`id="${id}"`), `scan-to-print.html includes #${id}`);
  }
  const toolsJs = fs.readFileSync(path.join(__dirname, '../tools/scan-to-print-tools.js'), 'utf8');
  assert.match(toolsJs, /\/depth/, 'scan-to-print-tools.js posts depth uploads to /jobs/:id/depth');
});

test('B11 & B13: parseSettings validates symmetry and nozzleMm/layerHeightMm/perimeters bounds, and UI exposes controls', () => {
  for (const id of ['symmetry', 'pc-nozzle', 'pc-layer', 'pc-perimeters']) {
    assert.ok(HTML.includes(`id="${id}"`), `scan-to-print.html includes #${id}`);
  }
  const mod = loadRouteModule('routes/job-routes.js');
  assert.equal(typeof mod.parseSettings, 'function', 'job-routes exports parseSettings');
  const parsed = mod.parseSettings({ resolution: 64, smoothIterations: 1, symmetry: 'x', nozzleMm: 0.6, layerHeightMm: 0.25, perimeters: 3 });
  assert.deepEqual(parsed, { resolution: 64, smoothIterations: 1, symmetry: 'x', nozzleMm: 0.6, layerHeightMm: 0.25, perimeters: 3 });
  assert.deepEqual(mod.parseSettings({ symmetry: 'none' }), {});
  assert.throws(() => mod.parseSettings({ symmetry: 'z' }), RangeError);
  assert.throws(() => mod.parseSettings({ nozzleMm: 0.01 }), RangeError);
  assert.throws(() => mod.parseSettings({ nozzleMm: 0.4, layerHeightMm: 0.5 }), RangeError);
  assert.throws(() => mod.parseSettings({ perimeters: 9 }), RangeError);
});
