/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | The contours artifact serves as JSON with the three outlines and the extents.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The camera module is served beside the viewer from the fixed asset list.
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The packaged routes over real loopback HTTP with express, multer and sharp resolved from the framework checkout (OSHAL_CORE_DIR): the surface and assets serve, the caller gate 401s, jobs are owner-scoped (a second subject gets 404), three synthetic photos upload → silhouettes → views → ruler → reconstruct → STL/OBJ/SVG/report download with byte-identical re-runs, refusals are 4xx with reasons, printers store only ciphertext and never echo a key, printing needs confirm:true (428), G-code needs a slicer (409) unless one is configured (fake execFile), STL goes to an OctoPrint double and never to Moonraker, a point-cloud upload closes and fills, and deleting a job removes its files. The database is a SQL-dispatching in-memory double — the owner RLS boundary itself is proven by the migration's policy text and the live installer, not here.
 *
 * FRAMEWORK-COUPLED: needs a core checkout for express/multer/sharp. Not part of the store-CI
 * wildcard; run locally: OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/routes.core.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { randomUUID } = require('node:crypto');

const CORE = process.env.OSHAL_CORE_DIR || 'C:/Projects/oshal';
assert.ok(fs.existsSync(path.join(CORE, 'node_modules', 'express')), `OSHAL_CORE_DIR must point at a framework checkout with node_modules (got ${CORE})`);
const coreRequire = Module.createRequire(path.join(CORE, 'package.json'));
const PKG = path.resolve(__dirname, '..');

// ── Framework doubles: exactly the four @/ modules the package imports ────────
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const STUBS = {
  '@/shared/logger': { createChildLogger: () => logger },
  '@/features/personal-data': {
    isEncrypted: (v) => typeof v === 'string' && v.startsWith('enc:v1:'),
    encryptField: (sub, plain) => (plain === null || plain === undefined ? null : `enc:v1:${Buffer.from(`${sub}|${plain}`).toString('base64')}`),
    decryptField: (sub, stored) => {
      if (!stored || !stored.startsWith('enc:v1:')) return stored ?? null;
      const [owner, ...rest] = Buffer.from(stored.slice(7), 'base64').toString().split('|');
      return owner === sub ? rest.join('|') : null;
    },
  },
  '@/shared/security/explicit-write-confirmation': {
    hasExplicitWriteConfirmation: (body) => !!body && typeof body === 'object' && body.confirm === true,
    confirmationRequiredPayload: (guard, action) => ({ error: 'confirmation_required', guard, message: `${action} requires confirm: true. No write was attempted.` }),
  },
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (STUBS[request]) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`Unexpected framework import: ${request}`);
  if (!request.startsWith('.') && !path.isAbsolute(request) && !request.startsWith('node:') && !Module.builtinModules.includes(request)) {
    return originalLoad.call(this, coreRequire.resolve(request), parent, isMain);
  }
  return originalLoad.call(this, request, parent, isMain);
};

const express = coreRequire('express');
const sharp = coreRequire('sharp');
const { createScanToPrintRoutes } = require(path.join(PKG, 'routes', 'scan-to-print-routes.js'));

// ── An in-memory database that answers exactly the package's SQL ─────────────
function fakePool() {
  const tables = { scan_print_job: [], scan_print_image: [], scan_print_printer: [], scan_print_submission: [] };
  const now = () => new Date().toISOString();
  const cols = (list) => list.split(',').map((c) => c.trim());
  const pick = (row, names) => Object.fromEntries(names.map((n) => [n, row[n] ?? null]));
  return {
    tables,
    async query(sql, params = []) {
      const text = typeof sql === 'string' ? sql : sql.text;
      const p = typeof sql === 'string' ? params : sql.values;
      const table = /(?:FROM|INTO|UPDATE)\s+(scan_print_\w+)/.exec(text)[1];
      const rows = tables[table];
      const returning = /RETURNING\s+([\s\S]+)$/.exec(text.trim());
      if (/^INSERT/.test(text)) {
        const names = cols(/\(([^)]+)\)\s+VALUES/.exec(text)[1]);
        const row = { created_at: now(), updated_at: now() };
        names.forEach((n, i) => { row[n] = /::jsonb/.test(text) && typeof p[i] === 'string' && (n === 'silhouette' || n === 'remote_response') ? JSON.parse(p[i]) : p[i]; });
        const idCol = { scan_print_job: 'job_id', scan_print_image: 'image_id', scan_print_printer: 'printer_id', scan_print_submission: 'submission_id' }[table];
        if (!row[idCol]) row[idCol] = randomUUID();
        if (table === 'scan_print_job') Object.assign(row, { state: 'capturing', known_dimensions: [], settings: {}, report: null, failure_reason: null });
        if (table === 'scan_print_image') row.view = null;
        rows.push(row);
        return { rows: [pick(row, cols(returning[1]))], rowCount: 1 };
      }
      const where = /WHERE\s+([\s\S]+?)(?:\s+ORDER BY|\s+LIMIT|\s+RETURNING|$)/.exec(text)[1];
      const conds = where.split(/\s+AND\s+/).map((c) => c.trim());
      const matches = (row) => conds.every((c) => {
        const m = /^(\w+)\s*(=|<>)\s*\$(\d+)$/.exec(c);
        if (!m) throw new Error(`fake pool cannot evaluate: ${c}`);
        const value = p[Number(m[3]) - 1];
        return m[2] === '=' ? row[m[1]] === value : row[m[1]] !== value;
      });
      if (/^SELECT/.test(text)) {
        const selected = rows.filter(matches);
        const names = cols(/^SELECT\s+([\s\S]+?)\s+FROM/.exec(text)[1]);
        return { rows: selected.map((r) => pick(r, names)), rowCount: selected.length };
      }
      if (/^DELETE/.test(text)) {
        const keep = rows.filter((r) => !matches(r));
        const removed = rows.length - keep.length;
        tables[table] = keep;
        if (table === 'scan_print_job') { tables.scan_print_image = tables.scan_print_image.filter((r) => keep.some((j) => j.job_id === r.job_id)); }
        return { rows: [], rowCount: removed };
      }
      if (/^UPDATE scan_print_image SET view = NULL/.test(text)) { rows.filter(matches).forEach((r) => { r.view = null; }); return { rows: [], rowCount: 0 }; }
      if (/^UPDATE scan_print_image SET view = \$4/.test(text)) {
        const hit = rows.filter(matches);
        hit.forEach((r) => { r.view = p[3]; });
        return { rows: hit.map((r) => pick(r, cols(returning[1]))), rowCount: hit.length };
      }
      if (/^UPDATE scan_print_job/.test(text)) {
        const hit = rows.filter(matches);
        hit.forEach((r) => {
          if (p[2] !== null) r.title = p[2];
          if (p[3] !== null) r.known_dimensions = JSON.parse(p[3]);
          if (p[4] !== null) r.settings = JSON.parse(p[4]);
          if (p[5] !== null) r.state = p[5];
          if (p[6]) r.report = p[7] === null ? null : JSON.parse(p[7]);
          if (p[8]) r.failure_reason = p[9];
          if (p[10] !== null) r.source_kind = p[10];
          r.updated_at = now();
        });
        return { rows: hit.map((r) => pick(r, cols(returning[1]))), rowCount: hit.length };
      }
      throw new Error(`fake pool cannot run: ${text.slice(0, 80)}`);
    },
  };
}

// ── Test server ──────────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-to-print-'));
const pool = fakePool();
const fetchCalls = [];
let printerAnswer = { status: 201, body: { done: true } };
const fakeFetch = async (url, init) => { fetchCalls.push({ url, init }); return { status: printerAnswer.status, text: async () => JSON.stringify(printerAnswer.body) }; };
const env = { SCAN_TO_PRINT_SLICER_CMD: '' };
const fakeExecFile = async (file, args) => { const out = args[args.length - 1]; fs.writeFileSync(out, 'G28\nG1 X10\n'); return { stdout: file, stderr: '' }; };
let currentSub = 'alice';
const app = express();
app.use(express.json());
app.use((req, _res, next) => { if (currentSub) req.oidc = { user: { sub: currentSub }, isAuthenticated: () => true }; next(); });
app.use('/api/scan-to-print', createScanToPrintRoutes({ pool, appPackageDir: PKG }, { dataRoot: tmp, env, fetchImpl: fakeFetch, execFile: fakeExecFile }));
let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); }); base = `http://127.0.0.1:${server.address().port}/api/scan-to-print`; });
test.after(async () => { await new Promise((r) => server.close(r)); fs.rmSync(tmp, { recursive: true, force: true }); Module._load = originalLoad; });

const call = async (p, init = {}) => {
  const res = await fetch(base + p, init);
  const text = await res.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
  return { status: res.status, body, headers: res.headers, text };
};
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** A synthetic photo: blue rectangle (uMm × vMm at 2 px/mm) on a beige 200×200 background. */
async function photo(uMm, vMm) {
  const w = 200, h = 200, data = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const inside = Math.abs(x + 0.5 - w / 2) < uMm && Math.abs(y + 0.5 - h / 2) < vMm;
    data.set(inside ? [40, 70, 160] : [214, 200, 176], (y * w + x) * 3);
  }
  return sharp(data, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}
async function uploadPhotos(jobId, files) {
  const form = new FormData();
  for (const [name, buf] of files) form.append('images', new Blob([buf], { type: 'image/png' }), name);
  return call(`/jobs/${jobId}/images`, { method: 'POST', body: form });
}

test('surface, assets and capabilities serve; the caller gate answers 401', async () => {
  const page = await call('/app');
  assert.equal(page.status, 200);
  assert.ok(page.text.includes('<title>Scan to Print</title>'));
  const js = await call('/assets/scan-to-print-gl.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  const camera = await call('/assets/scan-to-print-camera.js');
  assert.equal(camera.status, 200);
  assert.ok(camera.text.includes('ScanToPrintCamera'), 'the camera module serves from the fixed asset list');
  assert.ok(page.text.includes('/assets/scan-to-print-camera.js'), 'the surface loads it');
  const caps = await call('/capabilities');
  assert.deepEqual(caps.body.views, ['front', 'back', 'left', 'right', 'top', 'bottom']);
  assert.equal(caps.body.limits.resolution.default, 96);
  assert.equal(caps.body.printers.slicerConfigured, false);
  currentSub = null;
  assert.equal((await call('/jobs')).status, 401);
  assert.equal((await call('/printers')).status, 401);
  currentSub = 'alice';
});

let jobId;
test('jobs are created, listed and owner-scoped', async () => {
  const created = await call('/jobs', json('POST', { title: 'test box' }));
  assert.equal(created.status, 201);
  jobId = created.body.job.job_id;
  assert.equal((await call('/jobs')).body.jobs.length, 1);
  assert.equal((await call('/jobs', json('POST', { title: '   ' }))).status, 400);
  currentSub = 'mallory';
  assert.equal((await call(`/jobs/${jobId}`)).status, 404);
  assert.equal((await call('/jobs')).body.jobs.length, 0);
  currentSub = 'alice';
  assert.equal((await call('/jobs/not-a-uuid')).status, 400);
});

let stlBytes;
test('photos → silhouettes → views → ruler → reconstruct → artifacts, byte-identical on re-run', async () => {
  const up = await uploadPhotos(jobId, [['front.png', await photo(60, 30)], ['top.png', await photo(60, 40)], ['right.png', await photo(40, 30)]]);
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal(up.body.images.length, 3);
  assert.ok(up.body.images[0].silhouette.stats.pixels > 0);
  const noViews = await call(`/jobs/${jobId}/reconstruct`, json('POST', {}));
  assert.equal(noViews.status, 409);
  for (const [i, view] of ['front', 'top', 'right'].entries()) {
    const r = await call(`/jobs/${jobId}/images/${up.body.images[i].image_id}`, json('PATCH', { view }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  assert.equal((await call(`/jobs/${jobId}/images/${up.body.images[0].image_id}`, json('PATCH', { view: 'sideways' }))).status, 400);
  assert.equal((await call(`/jobs/${jobId}`, json('PATCH', { knownDimensions: [{ axis: 'x', mm: -5 }] }))).status, 400);
  assert.equal((await call(`/jobs/${jobId}`, json('PATCH', { knownDimensions: [{ axis: 'x', mm: 60 }] }))).status, 200);
  const rec = await call(`/jobs/${jobId}/reconstruct`, json('POST', { resolution: 48, smoothIterations: 0 }));
  assert.equal(rec.status, 200, JSON.stringify(rec.body));
  const { report } = rec.body;
  assert.equal(report.dimensionSources.x, 'known');
  assert.ok(Math.abs(report.sizeMm.y - 40) <= report.voxelMm && Math.abs(report.sizeMm.z - 30) <= report.voxelMm, JSON.stringify(report.sizeMm));
  assert.equal(report.printable, true);
  const detail = await call(`/jobs/${jobId}`);
  assert.equal(detail.body.job.state, 'reconstructed');
  assert.deepEqual(detail.body.artifacts, { stl: true, obj: true, svg: true, report: true, gcode: false, contours: true });
  const stl = await fetch(`${base}/jobs/${jobId}/artifacts/stl?download`);
  assert.equal(stl.status, 200);
  assert.match(stl.headers.get('content-disposition'), /test_box\.stl/);
  stlBytes = Buffer.from(await stl.arrayBuffer());
  assert.equal(stlBytes.length, 84 + 50 * report.triangleCount);
  const contours = await call(`/jobs/${jobId}/artifacts/contours`);
  assert.equal(contours.status, 200);
  assert.match(contours.headers.get('content-type'), /json/);
  assert.deepEqual(Object.keys(contours.body.views).sort(), ['front', 'right', 'top']);
  assert.ok(contours.body.pointCounts.front >= 4 && contours.body.voxelMm > 0 && contours.body.sizeMm.x > 0);
  const svg = await call(`/jobs/${jobId}/artifacts/svg`);
  assert.match(svg.headers.get('content-type'), /svg/);
  assert.ok(svg.text.includes('THIRD ANGLE'));
  assert.equal((await call(`/jobs/${jobId}/artifacts/bogus`)).status, 400);
  const again = await call(`/jobs/${jobId}/reconstruct`, json('POST', { resolution: 48, smoothIterations: 0 }));
  assert.equal(again.status, 200);
  const stl2 = Buffer.from(await (await fetch(`${base}/jobs/${jobId}/artifacts/stl`)).arrayBuffer());
  assert.equal(Buffer.compare(stlBytes, stl2), 0, 'same inputs, same bytes');
  const mask = await fetch(`${base}/jobs/${jobId}/images/${up.body.images[0].image_id}/file?kind=mask`);
  assert.equal(mask.headers.get('content-type'), 'image/png');
});

let printerId;
test('printers store ciphertext only and never echo the key; status probes the host', async () => {
  const bad = await call('/printers', json('POST', { label: 'p', kind: 'octoprint', baseUrl: 'http://localhost:5000', apiKey: 'K' }));
  assert.equal(bad.status, 400);
  const made = await call('/printers', json('POST', { label: 'Bench', kind: 'octoprint', baseUrl: 'http://octopi.local/', apiKey: 'SECRET-KEY' }));
  assert.equal(made.status, 201, JSON.stringify(made.body));
  printerId = made.body.printer.printer_id;
  assert.ok(!JSON.stringify(made.body).includes('SECRET-KEY'));
  const stored = pool.tables.scan_print_printer[0];
  assert.ok(stored.api_key_ciphertext.startsWith('enc:v1:') && !stored.api_key_ciphertext.includes('SECRET-KEY'));
  const listed = await call('/printers');
  assert.equal(listed.body.printers.length, 1);
  assert.ok(!('api_key_ciphertext' in listed.body.printers[0]));
  printerAnswer = { status: 200, body: { state: 'Operational' } };
  const status = await call(`/printers/${printerId}/status`, { method: 'POST' });
  assert.equal(status.status, 200);
  assert.equal(status.body.status.state, 'operational');
  assert.equal(fetchCalls.at(-1).init.headers['X-Api-Key'], 'SECRET-KEY');
  currentSub = 'mallory';
  assert.equal((await call(`/printers/${printerId}/status`, { method: 'POST' })).status, 404);
  currentSub = 'alice';
});

test('printing needs confirm, G-code needs a slicer, STL goes only where a host accepts it', async () => {
  const unconfirmed = await call(`/jobs/${jobId}/print`, json('POST', { printerId, fileKind: 'stl' }));
  assert.equal(unconfirmed.status, 428);
  assert.equal(unconfirmed.body.error, 'confirmation_required');
  const noSlicer = await call(`/jobs/${jobId}/print`, json('POST', { printerId, fileKind: 'gcode', confirm: true }));
  assert.equal(noSlicer.status, 409);
  assert.equal(noSlicer.body.error, 'needs_gcode');
  printerAnswer = { status: 201, body: { done: true } };
  const stl = await call(`/jobs/${jobId}/print`, json('POST', { printerId, fileKind: 'stl', startPrint: true, confirm: true }));
  assert.equal(stl.status, 201, JSON.stringify(stl.body));
  assert.equal(stl.body.submission.state, 'uploaded', 'an STL is never auto-started');
  assert.equal(fetchCalls.at(-1).url, 'http://octopi.local/api/files/local');
  const moon = await call('/printers', json('POST', { label: 'K1', kind: 'moonraker', baseUrl: 'http://klipper.lan', apiKey: 'MK' }));
  const stlToMoon = await call(`/jobs/${jobId}/print`, json('POST', { printerId: moon.body.printer.printer_id, fileKind: 'stl', confirm: true }));
  assert.equal(stlToMoon.status, 409);
  assert.equal(stlToMoon.body.error, 'unsupported_file');
  env.SCAN_TO_PRINT_SLICER_CMD = 'fake-slicer --export {input} {output}';
  printerAnswer = { status: 201, body: { item: {}, print_started: true } };
  const gcode = await call(`/jobs/${jobId}/print`, json('POST', { printerId: moon.body.printer.printer_id, fileKind: 'gcode', startPrint: true, confirm: true }));
  assert.equal(gcode.status, 201, JSON.stringify(gcode.body));
  assert.equal(gcode.body.submission.state, 'printing');
  assert.equal(fetchCalls.at(-1).url, 'http://klipper.lan/server/files/upload');
  const subs = await call(`/jobs/${jobId}/submissions`);
  assert.equal(subs.body.submissions.length, 2);
  printerAnswer = { status: 500, body: { error: 'boom' } };
  const failed = await call(`/jobs/${jobId}/print`, json('POST', { printerId, fileKind: 'stl', confirm: true }));
  assert.equal(failed.status, 502);
  assert.equal(failed.body.submission.state, 'failed');
});

test('a point cloud upload closes, fills and reconstructs through the same tail', async () => {
  const pts = [];
  for (let a = 0; a <= 60; a += 1) for (let b = 0; b <= 40; b += 1) { pts.push([a - 30, b - 20, 0], [a - 30, b - 20, 30]); }
  for (let a = 0; a <= 60; a += 1) for (let c = 0; c <= 30; c += 1) { pts.push([a - 30, -20, c], [a - 30, 20, c]); }
  for (let b = 0; b <= 40; b += 1) for (let c = 0; c <= 30; c += 1) { pts.push([-30, b - 20, c], [30, b - 20, c]); }
  const ply = `ply\nformat ascii 1.0\nelement vertex ${pts.length}\nproperty float x\nproperty float y\nproperty float z\nend_header\n${pts.map((p) => p.join(' ')).join('\n')}\n`;
  const created = await call('/jobs', json('POST', { title: 'lidar box' }));
  const form = new FormData();
  form.append('model', new Blob([ply]), 'box.ply');
  form.append('voxelMm', '2'); form.append('unitScale', '1'); form.append('up', 'z');
  const out = await call(`/jobs/${created.body.job.job_id}/pointcloud`, { method: 'POST', body: form });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.closed, true);
  assert.equal(out.body.report.lane, 'pointcloud');
  assert.equal(out.body.report.gridVolumeMm3, 72000);
  assert.equal(out.body.job.source_kind, 'pointcloud');
});

test('deleting a job removes its rows and files', async () => {
  const dirs = fs.readdirSync(tmp);
  assert.ok(dirs.length >= 1);
  const del = await call(`/jobs/${jobId}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await call(`/jobs/${jobId}`)).status, 404);
  const remaining = fs.readdirSync(path.join(tmp, dirs[0]));
  assert.ok(!remaining.includes(jobId));
});
