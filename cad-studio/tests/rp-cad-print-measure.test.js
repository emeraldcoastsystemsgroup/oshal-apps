/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | 0.5.0: loopback HTTP connector proofs for OctoPrint, Moonraker, and PrusaLink print-queue handoff with zero fake printing claims (RP-CAD-05) plus VM proofs for sharp-edge extraction, mm/in CAD measurement (RP-CAD-01), View Cube presets (RP-CAD-02), and AR SVG QR encoding (RP-CAD-04).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const { randomUUID } = require('node:crypto');

const { parse3mf } = require('../routes/mesh-formats.js');
const { artifactPath, ensureDir, revisionDir } = require('../routes/data-dir.js');

const GL_JS = fs.readFileSync(path.join(__dirname, '../tools/cad-studio-gl.js'), 'utf8');
const VIEWPORT_TOOLS_JS = fs.readFileSync(path.join(__dirname, '../tools/cad-viewport-tools.js'), 'utf8');

function loadPrintHandoff() {
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
    if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
    return origLoad.call(this, request, parent, isMain);
  };
  try {
    return require('../routes/print-handoff.js');
  } finally {
    Module._load = origLoad;
  }
}

async function invokeRouter(router, method, urlPath, { sub = 'alice', body = {} } = {}) {
  const req = { method, path: urlPath, params: {}, body, _sub: sub };
  const res = {
    statusCode: 200,
    payload: undefined,
    headersSent: false,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.payload = b; this.headersSent = true; return this; },
  };
  for (const layer of router.stack) {
    if (layer.method !== method) continue;
    const keys = [];
    const pattern = '^' + layer.path.replace(/:([A-Za-z0-9_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$';
    const m = new RegExp(pattern).exec(urlPath);
    if (!m) continue;
    req.params = Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    for (const fn of layer.fns) {
      await fn(req, res, () => {});
      if (res.headersSent) return res;
    }
  }
  return { statusCode: 404, payload: { error: 'not_found' } };
}

function writeBinaryBoxStl(targetFile) {
  const verts = [[-30, -20, 0], [30, -20, 0], [30, 20, 0], [-30, 20, 0], [-30, -20, 30], [30, -20, 30], [30, 20, 30], [-30, 20, 30]];
  const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const buf = Buffer.alloc(84 + faces.length * 50);
  buf.writeUInt32LE(faces.length, 80);
  faces.forEach((f, idx) => {
    const vals = [0, 0, 1, ...verts[f[0]], ...verts[f[1]], ...verts[f[2]]];
    vals.forEach((v, k) => buf.writeFloatLE(v, 84 + idx * 50 + k * 4));
  });
  fs.writeFileSync(targetFile, buf);
  return buf;
}

function startFakePrinterHost() {
  const uploads = [];
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      if (req.url === '/api/printer' || req.url.startsWith('/printer/objects/query') || req.url === '/api/v1/status') {
        if (req.url !== '/printer/objects/query?print_stats' && req.headers['x-api-key'] !== 'secret-key') {
          res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'unauthorized' })); return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ state: { text: 'Operational' }, result: { status: { print_stats: { state: 'standby' } } }, printer: { state: 'IDLE' } }));
        return;
      }
      uploads.push({ method: req.method, url: req.url, headers: req.headers, raw });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ done: true }));
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({
    baseUrl: `http://127.0.0.1:${srv.address().port}`,
    uploads,
    close: () => new Promise((r) => srv.close(r)),
  })));
}

function makeMockPool(modelId) {
  return {
    async query(_sql, params) {
      if (params[0] !== 'alice' || params[1] !== modelId) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          model_id: modelId, owner_sub: 'alice', title: 'Gear Mount', base: { kind: 'box' },
          features: [], revision: 2, state: 'built', report: {}, feature_status: [],
          failure_reason: null, source: null, settings: {},
          created_at: '2026-11-06T00:00:00Z', updated_at: '2026-11-06T00:00:00Z',
        }],
        rowCount: 1,
      };
    },
  };
}

test('RP-CAD-05: printer handoff refuses unconfigured URLs and unconfirmed sends with printing:false', async () => {
  const { createCadPrintRoutes, validatePrinterTarget } = loadPrintHandoff();
  assert.equal(validatePrinterTarget({ kind: 'octoprint', baseUrl: '' }).error, 'printer_not_configured');
  assert.equal(validatePrinterTarget({ kind: 'bambu-lan', baseUrl: 'http://192.168.1.50' }).error, 'bambu_uses_scan_to_print');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-print-gate-'));
  const modelId = randomUUID();
  try {
    const router = createCadPrintRoutes({ pool: makeMockPool(modelId), dataRoot: tmpRoot, callerSub: (req) => req._sub });
    const unconf = await invokeRouter(router, 'POST', '/printers/status', { body: { printer: { kind: 'octoprint', baseUrl: '' } } });
    assert.equal(unconf.statusCode, 400);
    assert.equal(unconf.payload.error, 'printer_not_configured');
    assert.equal(unconf.payload.printing, false);
    const noConfirm = await invokeRouter(router, 'POST', `/models/${modelId}/print`, {
      body: { printer: { kind: 'moonraker', baseUrl: 'http://127.0.0.1:7125' } },
    });
    assert.equal(noConfirm.statusCode, 428);
    assert.equal(noConfirm.payload.error, 'confirmation_required');
    assert.equal(noConfirm.payload.printing, false);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('RP-CAD-05: printer handoff probes status and uploads valid 3MF to OctoPrint, Moonraker, and PrusaLink', async () => {
  const { createCadPrintRoutes } = loadPrintHandoff();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-print-live-'));
  const host = await startFakePrinterHost();
  const modelId = randomUUID();
  try {
    const revPath = revisionDir(tmpRoot, 'alice', modelId, 2);
    ensureDir(revPath);
    writeBinaryBoxStl(artifactPath(revPath, 'stl'));
    const router = createCadPrintRoutes({ pool: makeMockPool(modelId), dataRoot: tmpRoot, callerSub: (req) => req._sub });

    const statusOk = await invokeRouter(router, 'POST', '/printers/status', { body: { printer: { kind: 'octoprint', baseUrl: host.baseUrl, apiKey: 'secret-key' } } });
    assert.equal(statusOk.statusCode, 200);
    assert.equal(statusOk.payload.printerState, 'Operational');

    const octo = await invokeRouter(router, 'POST', `/models/${modelId}/print`, {
      body: { confirm: true, format: '3mf', startPrint: false, printer: { kind: 'octoprint', baseUrl: host.baseUrl, apiKey: 'secret-key' } },
    });
    assert.equal(octo.statusCode, 200);
    assert.equal(octo.payload.state, 'uploaded');
    assert.equal(octo.payload.printing, false);

    const moon = await invokeRouter(router, 'POST', `/models/${modelId}/print`, {
      body: { confirm: true, format: '3mf', startPrint: true, printer: { kind: 'moonraker', baseUrl: host.baseUrl } },
    });
    assert.equal(moon.statusCode, 200);
    assert.equal(moon.payload.state, 'print_requested');
    assert.equal(moon.payload.printing, true);

    const prusa = await invokeRouter(router, 'POST', `/models/${modelId}/print`, {
      body: { confirm: true, format: '3mf', startPrint: false, printer: { kind: 'prusalink', baseUrl: host.baseUrl, apiKey: 'secret-key' } },
    });
    assert.equal(prusa.statusCode, 200);
    assert.equal(prusa.payload.printing, false);
    const parsedPrusa3mf = parse3mf(new Uint8Array(host.uploads[2].raw));
    assert.equal(parsedPrusa3mf.mesh.vertices.length, 8);
    assert.equal(parsedPrusa3mf.mesh.triangles.length, 12);
  } finally {
    await host.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

function makeMockSvgDoc() {
  const makeNode = (tag) => ({
    tag,
    attrs: {},
    children: [],
    setAttribute(k, v) { this.attrs[k] = String(v); },
    appendChild(c) { this.children.push(c); return c; },
  });
  return { createElementNS: (_ns, tag) => makeNode(tag) };
}

test('RP-CAD-01, RP-CAD-02, RP-CAD-04: sharp feature-edge extraction, mm/in measurement, and AR QR SVG matrix', () => {
  const ctx = {
    window: { location: { search: '', origin: 'https://oshal.example' } },
    document: { querySelector: () => null, getElementById: () => null },
    TextEncoder,
    TextDecoder,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(GL_JS, ctx);
  vm.runInContext(VIEWPORT_TOOLS_JS, ctx);

  const tmpFile = path.join(os.tmpdir(), `cad-gl-box-${randomUUID()}.stl`);
  try {
    const raw = writeBinaryBoxStl(tmpFile);
    const mesh = ctx.window.CadStudioGl.parseStl(raw);
    const edges = ctx.window.CadStudioGl.extractFeatureEdges(mesh.positions);
    assert.equal(edges.length, 12, 'coplanar diagonal facet edges merge away, leaving exactly 12 box edges');
    const lengths = Array.from(edges, (e) => Math.round(e.lengthMm)).sort((a, b) => a - b);
    assert.deepEqual(lengths, [30, 30, 30, 30, 40, 40, 40, 40, 60, 60, 60, 60]);

    const mmRes = ctx.window.CadStudioGl.measureDistance([0, 0, 0], [25.4, 0, 0], 'mm');
    const inRes = ctx.window.CadStudioGl.measureDistance([0, 0, 0], [25.4, 0, 0], 'in');
    assert.equal(mmRes.distance, 25.4);
    assert.ok(Math.abs(inRes.distance - 1.0) < 1e-9);
    assert.match(ctx.window.CadViewportTools.formatMeasureReadout(inRes), /^Distance: 1\.000 in/);

    const svg = ctx.window.CadStudioQr.renderQrSvg(makeMockSvgDoc(), 'https://oshal.example/api/cad-studio/app?model=1&ar=1', 'AR QR');
    assert.equal(svg.tag, 'svg');
    assert.equal(svg.children.length, 2);
    assert.match(svg.children[1].attrs.d, /^M4,4h1v1h-1z/);
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
});
