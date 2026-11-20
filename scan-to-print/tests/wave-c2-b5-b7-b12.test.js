/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | 0.10.3 (Wave C2): deterministic unit, route, and surface tests for BACKLOG B5 (live print progress read-back across OctoPrint, Moonraker, PrusaLink, and Bambu with bounded offline fallback and `printing 43 %` rendering), B7 (one-sided point-cloud base sealing including open-bottom dome, 1-voxel jittered rim, arch leak control, and LiDAR tab UI placement), and B12 (rotating-box square-on video frame suggestions across engine, route, and one-click confirmation UI).
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));
const { startFakePrinter } = require('./bambu-fake-printer.cjs');

const HTML = fs.readFileSync(path.join(__dirname, '../tools/scan-to-print.html'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '../tools/scan-to-print.js'), 'utf8');

function fakeFetch(status, body, delayMs = 0) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (delayMs > 0) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, delayMs);
        init?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
      });
    }
    return { status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  return { impl, calls };
}

function loadRouteModule(relFile) {
  const routerFactory = () => {
    const stack = [];
    const params = new Map();
    const r = { stack, params };
    for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
      r[m] = (p, ...fns) => { stack.push({ method: m.toUpperCase(), path: p, fns }); return r; };
    }
    r.use = (...fns) => { stack.push({ method: 'USE', path: '/', fns }); return r; };
    r.param = (name, fn) => { params.set(name, fn); return r; };
    return r;
  };
  const origLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'express') return { Router: routerFactory };
    if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
    if (request === '@/features/personal-data') {
      return {
        encryptField: async (_s, v) => `enc:${v}`,
        decryptField: async (_s, v) => String(v).replace(/^enc:/, ''),
        isEncrypted: (v) => String(v).startsWith('enc:'),
      };
    }
    if (request === '@/shared/security/explicit-write-confirmation') {
      return {
        hasExplicitWriteConfirmation: (b) => Boolean(b && b.confirm === true),
        confirmationRequiredPayload: (g, a) => ({ error: 'confirmation_required', guard: g, action: a }),
      };
    }
    if (request === '@/shared/middleware/trusted-service-user-identity') {
      return { requireTrustedServiceUserIdentity: (_req, _res, next) => next() };
    }
    if (request === 'sharp') return () => ({});
    if (request === 'multer') {
      const m = () => ({ single: () => (_q, _s, n) => n(), array: () => (_q, _s, n) => n() });
      m.memoryStorage = () => ({});
      m.diskStorage = () => ({});
      m.MulterError = class MulterError extends Error {};
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

async function invokeRouter(router, method, urlPath, { sub = 'alice', body = {}, query = {}, headers = {} } = {}) {
  const req = { method, path: urlPath, params: {}, body, query, headers, _sub: sub };
  const resHeaders = {};
  const res = {
    statusCode: 200, payload: undefined, headersSent: false,
    setHeader(k, v) { resHeaders[k.toLowerCase()] = v; },
    type() { return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.payload = b; this.headersSent = true; return this; },
    send(b) { this.payload = b; this.headersSent = true; return this; },
  };
  const match = (pattern, actual) => {
    const a = pattern.split('/').filter(Boolean), b = actual.split('/').filter(Boolean);
    if (a.length !== b.length) return null;
    const found = {};
    for (let i = 0; i < a.length; i += 1) {
      if (a[i].startsWith(':')) found[a[i].slice(1)] = decodeURIComponent(b[i]);
      else if (a[i] !== b[i]) return null;
    }
    return found;
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
    const found = match(layer.path, urlPath);
    if (!found) continue;
    req.params = found;
    for (const [key, val] of Object.entries(found)) {
      const pfn = router.params && router.params.get(key);
      if (pfn && !res.headersSent) await pfn(req, res, () => {}, val);
    }
    for (const fn of layer.fns) {
      if (res.headersSent) break;
      await fn(req, res, () => {});
    }
  }
  return { status: res.statusCode, payload: res.payload, headers: resHeaders };
}

function makeSurface(answer) {
  const seam = "document.addEventListener('DOMContentLoaded', boot);";
  const elements = new Map(), requests = [];
  const makeNode = () => ({
    hidden: true, disabled: false, value: '', textContent: '', className: '', children: [], listeners: {}, options: [],
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
    checkValidity() { return true; },
    setAttribute() {}, removeAttribute() {},
    addEventListener(kind, fn) { this.listeners[kind] = fn; },
    appendChild(c) { this.children.push(c); },
    replaceChildren(...c) { this.children = c; },
  });
  const get = (id) => { if (!elements.has(id)) elements.set(id, makeNode()); return elements.get(id); };
  const context = vm.createContext({
    document: { getElementById: get, createElement: makeNode, createTextNode: (t) => ({ textContent: t }) },
    window: { location: { assign() {} }, addEventListener() {} },
    sessionStorage: { setItem() {}, getItem() { return null; }, removeItem() {} },
    FormData, Blob, URLSearchParams, location: { search: '' },
    setTimeout: () => 1, clearTimeout() {},
    fetch: async (url, init = {}) => {
      requests.push({ url, method: init.method || 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
      return answer(url, init);
    },
  });
  vm.runInContext(JS.replace(seam, 'globalThis.surface = { state, loadSubmissions, printerStatus, submissionStatusText, uploadVideo, suggestViews };'), context);
  return { ...context.surface, requests, get };
}

const jsonResp = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) });

// ── B5: Print progress read-back ────────────────────────────────────────────

test('B5: adapters extract integer progress from OctoPrint, Moonraker, PrusaLink, and Bambu payloads', async () => {
  const octo = fakeFetch(200, { state: 'Printing', progress: { completion: 43.2 } });
  const oRes = await e.adapterFor('octoprint').status({ kind: 'octoprint', baseUrl: 'http://octo.lan', apiKey: 'k1' }, octo.impl);
  assert.equal(oRes.ok, true);
  assert.equal(oRes.state, 'printing');
  assert.equal(oRes.progress, 43);

  const moon = fakeFetch(200, { result: { status: { print_stats: { state: 'printing' }, display_status: { progress: 0.432 } } } });
  const mRes = await e.adapterFor('moonraker').status({ kind: 'moonraker', baseUrl: 'http://moon.lan', apiKey: 'k2' }, moon.impl);
  assert.equal(mRes.ok, true);
  assert.equal(mRes.state, 'printing');
  assert.equal(mRes.progress, 43);
  assert.match(moon.calls[0].url, /print_stats&display_status&virtual_sdcard/);

  const moonSd = fakeFetch(200, { result: { status: { print_stats: { state: 'printing' }, virtual_sdcard: { progress: 0.43 } } } });
  assert.equal((await e.adapterFor('moonraker').status({ kind: 'moonraker', baseUrl: 'http://moon.lan', apiKey: 'k2' }, moonSd.impl)).progress, 43);

  const prusa = fakeFetch(200, { printer: { state: 'PRINTING' }, job: { progress: 43.0 } });
  const pRes = await e.adapterFor('prusalink').status({ kind: 'prusalink', baseUrl: 'http://prusa.lan', apiKey: 'k3' }, prusa.impl);
  assert.equal(pRes.ok, true);
  assert.equal(pRes.state, 'printing');
  assert.equal(pRes.progress, 43);

  assert.equal(e.extractProgress('bambu-lan', { state: 'printing', percent: 43 }), 43);
  assert.equal(e.extractProgress('bambu-lan', { mc_percent: 43.4 }), 43);
  assert.equal(e.extractProgress('octoprint', { state: 'Operational' }), null);
});

test('B5: GET /printers/:id/status and GET /jobs/:id/submissions attach live progress (43 %) for OctoPrint, Moonraker, and Bambu', async (t) => {
  const bambu = await startFakePrinter({ status: { gcode_state: 'RUNNING', mc_percent: 43, mc_remaining_time: 18 } });
  t.after(() => bambu.close());
  const { createPrintRoutes } = loadRouteModule('routes/print-routes.js');
  const { createPrintServiceRouter } = loadRouteModule('routes/service-routes.js');
  const jobId = '11111111-1111-4111-8111-111111111111';
  const printers = new Map([
    ['22222222-2222-4222-8222-222222222201', { printer_id: '22222222-2222-4222-8222-222222222201', label: 'Octo', kind: 'octoprint', base_url: 'http://octo.lan', api_key_ciphertext: 'enc:k1', device_serial: null, device_model: null, device_cert_sha256: null, slice_profile: {}, auto_start: false, created_at: '2026-11-19T00:00:00Z' }],
    ['22222222-2222-4222-8222-222222222202', { printer_id: '22222222-2222-4222-8222-222222222202', label: 'Klipper', kind: 'moonraker', base_url: 'http://moon.lan', api_key_ciphertext: 'enc:k2', device_serial: null, device_model: null, device_cert_sha256: null, slice_profile: {}, auto_start: false, created_at: '2026-11-19T00:00:00Z' }],
    ['22222222-2222-4222-8222-222222222203', { printer_id: '22222222-2222-4222-8222-222222222203', label: 'P2S', kind: 'bambu-lan', base_url: 'bambu://bambu.lan', api_key_ciphertext: `enc:${bambu.printer.accessCode}`, device_serial: bambu.printer.serial, device_model: 'N7', device_cert_sha256: bambu.printer.certSha256, slice_profile: {}, auto_start: false, created_at: '2026-11-19T00:00:00Z' }],
  ]);
  const fetchImpl = async (url) => {
    if (url.startsWith('http://octo.lan')) return { status: 200, text: async () => JSON.stringify({ state: 'Printing', progress: { completion: 43.2 } }) };
    if (url.startsWith('http://moon.lan')) return { status: 200, text: async () => JSON.stringify({ result: { status: { print_stats: { state: 'printing' }, display_status: { progress: 0.431 } } } }) };
    return { status: 500, text: async () => '' };
  };
  let activeSubs = [];
  const pool = {
    async query(sql, params) {
      if (sql.includes('FROM scan_print_printer') && sql.includes('printer_id = $2')) {
        const p = printers.get(params[1]);
        return { rows: p ? [p] : [] };
      }
      if (sql.includes('FROM scan_print_submission')) return { rows: activeSubs };
      return { rows: [] };
    },
  };
  const deps = {
    pool, dataRoot: os.tmpdir(), env: {}, callerSub: (r) => r._sub,
    slicer: { host: '127.0.0.1', port: 1, expectedBuildHash: '0'.repeat(64), installHint: '' },
    fetchImpl, bambuIo: { connect: bambu.connect, connectTcp: bambu.connectTcp },
  };
  const router = createPrintRoutes(deps);
  const serviceRouter = createPrintServiceRouter(deps);

  for (const [id, expectedLabel] of [
    ['22222222-2222-4222-8222-222222222201', 'Octo'],
    ['22222222-2222-4222-8222-222222222202', 'Klipper'],
    ['22222222-2222-4222-8222-222222222203', 'P2S'],
  ]) {
    const st = await invokeRouter(router, 'GET', `/printers/${id}/status`);
    assert.equal(st.status, 200, expectedLabel);
    assert.equal(st.payload.status.ok, true);
    assert.equal(st.payload.status.state, 'printing');
    assert.equal(st.payload.status.progress, 43, `${expectedLabel} GET /printers/:id/status reports 43`);

    activeSubs = [
      { submission_id: 's-new', job_id: jobId, source_name: null, requested_by: 'person', printer_id: id, file_name: 'part.gcode', file_kind: 'gcode', started: true, state: 'printing', failure_reason: null, remote_response: null, created_at: '2026-11-19T12:00:00Z' },
      { submission_id: 's-old', job_id: jobId, source_name: null, requested_by: 'person', printer_id: id, file_name: 'old.gcode', file_kind: 'gcode', started: false, state: 'uploaded', failure_reason: null, remote_response: null, created_at: '2026-11-18T12:00:00Z' },
    ];
    const subs = await invokeRouter(router, 'GET', `/jobs/${jobId}/submissions`);
    assert.equal(subs.status, 200);
    assert.equal(subs.payload.submissions[0].liveStatus.ok, true);
    assert.equal(subs.payload.submissions[0].liveStatus.state, 'printing');
    assert.equal(subs.payload.submissions[0].liveStatus.progress, 43, `${expectedLabel} attaches live progress to latest submission`);
    assert.equal(subs.payload.submissions[1].liveStatus, undefined, 'older submissions are not probed');

    const svcSubs = await invokeRouter(serviceRouter, 'GET', '/submissions');
    assert.equal(svcSubs.status, 200);
    assert.equal(svcSubs.payload.submissions[0].liveStatus.progress, 43, `${expectedLabel} service GET /submissions attaches live progress`);
  }
});

test('B5: attachLiveStatus is bounded and fail-safe when a printer hangs, is offline, or latest submission failed', async () => {
  const { attachLiveStatus } = loadRouteModule('routes/print-service.js');
  const printerId = '33333333-3333-4333-8333-333333333333';
  const pool = {
    async query() {
      return { rows: [{ printer_id: printerId, label: 'Slow', kind: 'octoprint', base_url: 'http://slow.lan', api_key_ciphertext: 'enc:k', device_serial: null, device_model: null, device_cert_sha256: null, slice_profile: {}, auto_start: false, created_at: '2026-11-19T00:00:00Z' }] };
    },
  };
  const slowFetch = fakeFetch(200, { state: 'Printing', progress: { completion: 50 } }, 5000);
  const deps = { pool, fetchImpl: slowFetch.impl, slicer: { host: '127.0.0.1', port: 1, expectedBuildHash: '0'.repeat(64), installHint: '' } };
  const active = [{ submission_id: 's1', job_id: 'j1', source_name: null, requested_by: 'person', printer_id: printerId, file_name: 'a.gcode', file_kind: 'gcode', started: true, state: 'printing', failure_reason: null, remote_response: null, created_at: '2026-11-19T00:00:00Z' }];
  const t0 = Date.now();
  const out = await attachLiveStatus(deps, 'alice', active, { timeoutMs: 80 });
  assert.ok(Date.now() - t0 < 1000, 'bounded timeout returns promptly');
  assert.equal(out[0].liveStatus.ok, false);
  assert.equal(out[0].liveStatus.state, 'offline');
  assert.equal(out[0].liveStatus.progress, null);

  let called = 0;
  const failedRow = [{ ...active[0], state: 'failed', failure_reason: 'boom' }];
  const skipped = await attachLiveStatus({ ...deps, fetchImpl: async () => { called += 1; return { status: 200, text: async () => '{}' }; } }, 'alice', failedRow, { timeoutMs: 80 });
  assert.equal(called, 0, 'a failed submission does not contact the printer');
  assert.equal(skipped[0].liveStatus, undefined);
});

test('B5: surface renders `printing 43 %` from attached host status for OctoPrint, Moonraker, PrusaLink, and Bambu, plus offline fallback', async () => {
  const hosts = [
    ['OctoPrint', { ok: true, state: 'printing', progress: 43, detail: { state: 'Printing', progress: { completion: 43.2 } } }],
    ['Moonraker', { ok: true, state: 'printing', progress: 43, detail: { result: { status: { print_stats: { state: 'printing' }, display_status: { progress: 0.431 } } } } }],
    ['PrusaLink', { ok: true, state: 'printing', progress: 43, detail: { printer: { state: 'PRINTING' }, job: { progress: 43 } } }],
    ['Bambu', { ok: true, state: 'printing', progress: 43, detail: { state: 'printing', percent: 43, remainingMinutes: 12 } }],
  ];
  for (const [label, liveStatus] of hosts) {
    const f = makeSurface((url) => {
      if (url.endsWith('/submissions')) {
        return jsonResp(200, {
          submissions: [
            { submission_id: 's1', file_name: 'bracket.gcode', state: 'uploaded', failure_reason: null, created_at: '2026-11-19T12:00:00Z', liveStatus },
            { submission_id: 's0', file_name: 'old.gcode', state: 'uploaded', failure_reason: null, created_at: '2026-11-18T12:00:00Z' },
          ],
        });
      }
      if (url.endsWith('/status')) {
        return jsonResp(200, { printer: { label, kind: label === 'Bambu' ? 'bambu-lan' : label.toLowerCase() }, status: liveStatus });
      }
      return jsonResp(404, {});
    });
    f.state.job = { job_id: '11111111-1111-4111-8111-111111111111' };
    await f.loadSubmissions();
    const rows = f.get('submissions').children;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].className, 'printing', `${label} promotes row class to live state`);
    assert.match(rows[0].children[0].textContent, /printing 43 %/, `${label} submission row renders printing 43 %`);
    assert.doesNotMatch(rows[1].children[0].textContent, /43 %/, 'older submission keeps its recorded state');

    await f.printerStatus('22222222-2222-4222-8222-222222222201');
    assert.match(f.get('toast').textContent, /printing 43 %/, `${label} status toast renders printing 43 %`);
    assert.equal(f.requests.at(-1).method, 'GET', 'printerStatus reads via GET /printers/:id/status');
  }

  const offline = makeSurface(() => jsonResp(200, {
    submissions: [{ submission_id: 's1', file_name: 'bracket.gcode', state: 'printing', failure_reason: null, created_at: '2026-11-19T12:00:00Z', liveStatus: { ok: false, state: 'offline', progress: null } }],
  }));
  offline.state.job = { job_id: '11111111-1111-4111-8111-111111111111' };
  await offline.loadSubmissions();
  assert.match(offline.get('submissions').children[0].children[0].textContent, /printing \(offline\)/);
});

// ── B7: One-sided point-cloud base sealing ──────────────────────────────────

function domePoints(radiusMm = 20, stepDeg = 4) {
  const pts = [];
  for (let phiDeg = 0; phiDeg <= 88; phiDeg += stepDeg) {
    const phi = (phiDeg * Math.PI) / 180;
    const z = radiusMm * Math.sin(phi);
    const r = radiusMm * Math.cos(phi);
    const nTheta = Math.max(8, Math.ceil((2 * Math.PI * r) / 1.0));
    for (let t = 0; t < nTheta; t += 1) {
      const th = (2 * Math.PI * t) / nTheta;
      pts.push([r * Math.cos(th), r * Math.sin(th), z]);
    }
  }
  pts.push([0, 0, radiusMm]);
  return pts;
}

function jitteredOpenBoxPoints() {
  const pts = [];
  for (let a = 0; a <= 60; a += 1) for (let b = 0; b <= 40; b += 1) pts.push([a - 30, b - 20, 30]);
  for (let a = 0; a <= 60; a += 1) for (let c = 0; c <= 30; c += 1) {
    // Half the perimeter drops to z=0 and the other half starts at z=2 (1-voxel LiDAR rim jitter)
    if (c === 0 && a % 2 === 1) continue;
    pts.push([a - 30, -20, c === 0 ? 0 : c], [a - 30, 20, c === 0 ? 2 : c]);
  }
  for (let b = 0; b <= 40; b += 1) for (let c = 2; c <= 30; c += 1) {
    pts.push([-30, b - 20, c], [30, b - 20, c]);
  }
  return pts;
}

test('B7: open-bottom dome resting on Z = 0 leaks unsealed and reconstructs watertight with accurate bounds when sealed', () => {
  const pts = domePoints(20);
  const cloud = { count: pts.length, xyz: Float32Array.from(pts.flat()) };
  const unsealed = e.fillSolidFromSurface(e.voxelizePointCloud(cloud, { voxelMm: 2 }).grid, 1);
  assert.equal(unsealed.closed, false, 'open-bottom dome leaks without sealBase');

  const vox = e.voxelizePointCloud(cloud, { voxelMm: 2 });
  const fill = e.fillSolidFromSurface(vox.grid, 1, { sealBase: true });
  assert.equal(fill.closed, true, 'open-bottom dome closes with sealBase');
  assert.equal(fill.sealedBase, true);
  assert.ok(fill.interiorFilled > 0);
  const result = e.finishFromGrid(vox.grid, vox.sizeMm, { lane: 'pointcloud', viewsUsed: [], sources: { x: 'known', y: 'known', z: 'known' }, warnings: [], sealedBase: true, method: 'test' }, { smoothIterations: 0 });
  assert.equal(result.report.validation.valid, true, 'sealed dome mesh is watertight');
  assert.equal(result.report.printable, true);
  assert.ok(Math.abs(result.report.sizeMm.x - 40) < 1.5 && Math.abs(result.report.sizeMm.z - 20) < 1.5);
  const analyticHalfSphere = (2 / 3) * Math.PI * 20 ** 3;
  assert.ok(Math.abs(result.report.gridVolumeMm3 - analyticHalfSphere) / analyticHalfSphere < 0.25, `dome volume ${result.report.gridVolumeMm3} matches hemisphere`);
});

test('B7: 1-voxel jittered one-sided box rim seals via bed-contact band while a bed-touching arch still leaks', () => {
  const jittered = jitteredOpenBoxPoints();
  const cloud = { count: jittered.length, xyz: Float32Array.from(jittered.flat()) };
  assert.equal(e.fillSolidFromSurface(e.voxelizePointCloud(cloud, { voxelMm: 2 }).grid, 1).closed, false);

  const vox = e.voxelizePointCloud(cloud, { voxelMm: 2 });
  const fill = e.fillSolidFromSurface(vox.grid, 1, { sealBase: true });
  assert.equal(fill.closed, true, 'bed-contact band seals 1-voxel rim jitter on Z = 0');
  assert.equal(fill.sealedBase, true);
  const res = e.finishFromGrid(vox.grid, vox.sizeMm, { lane: 'pointcloud', viewsUsed: [], sources: { x: 'known', y: 'known', z: 'known' }, warnings: [], sealedBase: true, method: 'test' }, { smoothIterations: 0 });
  assert.equal(res.report.validation.valid, true);
  assert.deepEqual(res.report.sizeMm, { x: 60, y: 40, z: 30 });

  // Negative control: genuine arch opening extending all the way down to Z = 0 on the -X face
  const archPts = [];
  for (let a = 0; a <= 60; a += 1) for (let b = 0; b <= 40; b += 1) archPts.push([a - 30, b - 20, 30]);
  for (let a = 0; a <= 60; a += 1) for (let c = 1; c <= 30; c += 1) { archPts.push([a - 30, -20, c], [a - 30, 20, c]); }
  for (let b = 0; b <= 40; b += 1) for (let c = 1; c <= 30; c += 1) {
    archPts.push([30, b - 20, c]);
    if (!(b - 20 >= -8 && b - 20 <= 8 && c <= 16)) archPts.push([-30, b - 20, c]);
  }
  const archVox = e.voxelizePointCloud({ count: archPts.length, xyz: Float32Array.from(archPts.flat()) }, { voxelMm: 2 });
  const archFill = e.fillSolidFromSurface(archVox.grid, 1, { sealBase: true });
  assert.equal(archFill.closed, false, 'a genuine arch opening down to Z = 0 must still leak');
});

test('B7: seal base control sits directly inside the LiDAR capture mode tab', () => {
  const start = HTML.indexOf('<div class="stp-mode" data-stp-mode="lidar"');
  const end = HTML.indexOf('<details id="capture-advanced"', start);
  assert.ok(start > 0 && end > start);
  const lidarBlock = HTML.slice(start, end);
  assert.ok(lidarBlock.includes('id="pointcloud-settings"'), 'point-cloud settings are visible in LiDAR mode');
  assert.ok(lidarBlock.includes('id="pc-seal"'), 'seal base toggle is directly accessible in LiDAR mode');
});

// ── B12: Video automatic square-on frame suggestion ─────────────────────────

function boxSilhouetteStats(yawDeg, pitchDeg, box = { x: 60, y: 40, z: 20 }) {
  const a = (yawDeg * Math.PI) / 180;
  const b = (pitchDeg * Math.PI) / 180;
  const corners = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const x0 = (sx * box.x) / 2, y0 = (sy * box.y) / 2, z0 = (sz * box.z) / 2;
    const x1 = x0 * Math.cos(a) - y0 * Math.sin(a);
    const y1 = x0 * Math.sin(a) + y0 * Math.cos(a);
    const z2 = y1 * Math.sin(b) + z0 * Math.cos(b);
    corners.push([110 + x1 * 2, 110 - z2 * 2]);
  }
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  const minX = Math.floor(Math.min(...xs)), maxX = Math.ceil(Math.max(...xs));
  const minY = Math.floor(Math.min(...ys)), maxY = Math.ceil(Math.max(...ys));
  return { pixels: (maxX - minX + 1) * (maxY - minY + 1), bbox: { minX, minY, maxX, maxY } };
}

test('B12: GET /jobs/:id/frame-suggestions ranks a synthetic rotating-box sequence to its 3 axis-aligned frames', async () => {
  const { createJobRoutes } = loadRouteModule('routes/job-routes.js');
  const jobId = '44444444-4444-4444-8444-444444444444';
  const yaws = Array.from({ length: 17 }, (_, i) => -30 + 15 * i); // 0, 90, 180 are frames 3, 9, 15
  const images = yaws.map((yaw, i) => ({
    image_id: `aaaaaaaa-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    job_id: jobId,
    file_name: `frame-${String(i + 1).padStart(3, '0')}.png`,
    view: null, width: 220, height: 220,
    silhouette: { stats: boxSilhouetteStats(yaw, 0) },
    created_at: '2026-11-19T00:00:00Z',
  }));
  const job = {
    job_id: jobId, owner_sub: 'alice', title: 'Rotating box', source_kind: 'video', state: 'capturing',
    known_dimensions: [{ axis: 'x', mm: 60 }, { axis: 'y', mm: 40 }, { axis: 'z', mm: 20 }],
    settings: {}, report: null, failure_reason: null, created_at: '2026-11-19T00:00:00Z', updated_at: '2026-11-19T00:00:00Z',
  };
  const pool = {
    async query(sql) {
      if (sql.includes('FROM scan_print_job')) return { rows: [job] };
      if (sql.includes('FROM scan_print_image')) return { rows: images };
      return { rows: [] };
    },
  };
  const router = createJobRoutes({ pool, dataRoot: os.tmpdir(), env: {}, callerSub: (r) => r._sub });
  const res = await invokeRouter(router, 'GET', `/jobs/${jobId}/frame-suggestions`);
  assert.equal(res.status, 200);
  assert.equal(res.payload.frames, 17);
  const byView = Object.fromEntries(res.payload.suggestions.map((s) => [s.view, s.fileName]));
  assert.deepEqual(byView, { front: 'frame-003.png', right: 'frame-009.png', back: 'frame-015.png' });
  assert.deepEqual(res.payload.unmatched, ['top', 'left', 'bottom']);
  assert.equal(res.payload.proportionsKnown, 3);
});

test('B12: uploading a video automatically proposes the best frame per view for one-click confirmation without auto-assigning', async () => {
  const jobId = '55555555-5555-4555-8555-555555555555';
  const job = { job_id: jobId, title: 'Turntable', state: 'capturing', source_kind: 'video', known_dimensions: [{ axis: 'x', mm: 60 }, { axis: 'y', mm: 40 }, { axis: 'z', mm: 20 }], settings: {}, updated_at: '2026-11-19T00:00:00Z' };
  const suggestions = [
    { view: 'front', imageId: 'img-3', fileName: 'frame-003.png', score: -0.05, skew: 0, turn: 0.05 },
    { view: 'right', imageId: 'img-9', fileName: 'frame-009.png', score: -0.05, skew: 0, turn: 0.05 },
    { view: 'top', imageId: 'img-15', fileName: 'frame-015.png', score: -0.05, skew: 0, turn: 0.05 },
  ];
  const f = makeSurface((url, init) => {
    if (url.endsWith('/video') && init.method === 'POST') return jsonResp(201, { images: [], frames: 17, suggestions });
    if (url.endsWith(`/jobs/${jobId}`)) return jsonResp(200, { job, images: [{ image_id: 'img-3', file_name: 'frame-003.png', view: null, width: 220, height: 220, created_at: '2026-11-19T00:00:00Z' }], artifacts: {} });
    if (url.endsWith('/calibration')) return jsonResp(200, { sourceSha: 'a'.repeat(64), canEdit: true, canReconstruct: true, knownDimensions: job.known_dimensions, settings: {} });
    if (url.endsWith('/jobs')) return jsonResp(200, { jobs: [job] });
    if (url.endsWith('/printers')) return jsonResp(200, { printers: [], slicerConfigured: false });
    if (url.endsWith('/submissions')) return jsonResp(200, { submissions: [] });
    if (url.endsWith('/frame-suggestions')) return jsonResp(200, { frames: 17, suggestions, unmatched: ['back', 'left', 'bottom'], proportionsKnown: 3 });
    if (url.includes('/images/img-3') && init.method === 'PATCH') return jsonResp(200, { image: { image_id: 'img-3', view: 'front' } });
    return jsonResp(404, {});
  });
  f.state.job = job;
  f.state.detail = { job, images: [], artifacts: {} };
  await f.uploadVideo(new Blob([Buffer.from('fake-mp4')]));
  assert.equal(f.requests.filter((r) => r.method === 'PATCH').length, 0, 'uploading video proposes without auto-assigning');
  const items = f.get('suggest-list').children;
  assert.deepEqual(items.map((li) => li.children[0].textContent), ['front → frame-003.png', 'right → frame-009.png', 'top → frame-015.png']);
  assert.equal(f.get('suggest-all').hidden, false);
  await items[0].children[1].listeners.click();
  const patch = f.requests.find((r) => r.method === 'PATCH');
  assert.ok(patch && patch.url.endsWith('/images/img-3'), 'clicking assign confirms that exact suggested frame');
  assert.deepEqual(patch.body, { view: 'front' });
});
