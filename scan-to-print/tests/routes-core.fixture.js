/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Share the existing real HTTP/sharp route fixture, isolated files and strict SQL/printer/process doubles across retained and freshness proofs.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Optionally enter the actual core request-identity context and model strict database refusal when an upload loses or changes that context.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Resolve the framework checkout from OSHAL_CORE_ROOT first (what the Test Lab sandbox sets, /app) and OSHAL_CORE_DIR second, and fail loud when neither is set. The old default C:/Projects/oshal existed on one Windows box only and turned a missing variable into a confusing module error.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Redirect a bare require to the framework checkout only when the package itself asks for it. Requires made inside node_modules resolve normally again: redirecting them to core's root broke in the Test Lab sandbox, where the image's pruned node_modules keeps semver only nested under sharp (Cannot find module 'semver'); a developer checkout hoists it, which is why no local run saw it.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { randomUUID } = require('node:crypto');
const CORE = process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR;
if (!CORE) throw new Error('Set OSHAL_CORE_ROOT (the Test Lab sets /app) or OSHAL_CORE_DIR to a framework checkout');
const PKG = path.resolve(__dirname, '..');
const coreRequire = Module.createRequire(path.join(CORE, 'package.json'));
const cols = (list) => list.split(',').map((c) => c.trim());
const pick = (row, names) => structuredClone(Object.fromEntries(names.map((n) => [n, row[n] ?? null])));

function frameworkStubs() {
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  return {
    '@/shared/logger': { createChildLogger: () => logger },
    '@/features/personal-data': {
      isEncrypted: (v) => typeof v === 'string' && v.startsWith('enc:v1:'),
      encryptField: (sub, value) => value == null ? null : `enc:v1:${Buffer.from(`${sub}|${value}`).toString('base64')}`,
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
}

function loadRoutes() {
  const original = Module._load, stubs = frameworkStubs();
  Module._load = function fixtureLoad(request, parent, isMain) {
    if (stubs[request]) return stubs[request];
    if (request.startsWith('@/')) throw new Error(`Unexpected framework import: ${request}`);
    if (!request.startsWith('.') && !path.isAbsolute(request) && !request.startsWith('node:') && !Module.builtinModules.includes(request) && String(parent?.filename || '').startsWith(PKG + path.sep)) {
      return original.call(this, coreRequire.resolve(request), parent, isMain);
    }
    return original.call(this, request, parent, isMain);
  };
  return { factory: require(path.join(PKG, 'routes/scan-to-print-routes.js')).createScanToPrintRoutes,
    restore: () => { Module._load = original; } };
}

function insert(tables, table, sql, values, returning) {
  const row = { created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  cols(/\(([^)]+)\)\s+VALUES/.exec(sql)[1]).forEach((name, i) => {
    row[name] = ['silhouette', 'remote_response'].includes(name) && typeof values[i] === 'string' ? JSON.parse(values[i]) : values[i];
  });
  const id = { scan_print_job: 'job_id', scan_print_image: 'image_id', scan_print_printer: 'printer_id', scan_print_submission: 'submission_id' }[table];
  if (!row[id]) row[id] = randomUUID();
  if (table === 'scan_print_job') Object.assign(row, { state: 'capturing', known_dimensions: [], settings: {}, report: null, failure_reason: null });
  if (table === 'scan_print_image') row.view = null;
  tables[table].push(row);
  return { rows: [pick(row, cols(returning))], rowCount: 1 };
}

function predicate(sql, values) {
  const where = /WHERE\s+([\s\S]+?)(?:\s+ORDER BY|\s+LIMIT|\s+RETURNING|$)/.exec(sql)[1];
  return (row) => where.split(/\s+AND\s+/).every((condition) => {
    const match = /^(\w+)\s*(=|<>)\s*\$(\d+)$/.exec(condition.trim());
    if (!match) throw new Error(`fixture cannot evaluate: ${condition}`);
    const value = values[Number(match[3]) - 1];
    return match[2] === '=' ? row[match[1]] === value : row[match[1]] !== value;
  });
}

function updateJob(row, p) {
  if (p[2] !== null) row.title = p[2];
  if (p[3] !== null) row.known_dimensions = JSON.parse(p[3]);
  if (p[4] !== null) row.settings = JSON.parse(p[4]);
  if (p[5] !== null) row.state = p[5];
  if (p[6]) row.report = p[7] === null ? null : JSON.parse(p[7]);
  if (p[8]) row.failure_reason = p[9];
  if (p[10] !== null) row.source_kind = p[10];
  row.updated_at = new Date().toISOString();
}

function query(tables, sql, p) {
  const table = /(?:FROM|INTO|UPDATE)\s+(scan_print_\w+)/.exec(sql)[1];
  const returning = /RETURNING\s+([\s\S]+)$/.exec(sql.trim());
  if (/^INSERT/.test(sql)) return insert(tables, table, sql, p, returning[1]);
  const matches = predicate(sql, p), hit = tables[table].filter(matches);
  if (/^SELECT/.test(sql)) return { rows: hit.map((r) => pick(r, cols(/^SELECT\s+([\s\S]+?)\s+FROM/.exec(sql)[1]))), rowCount: hit.length };
  if (/^DELETE/.test(sql)) {
    tables[table] = tables[table].filter((row) => !matches(row));
    if (table === 'scan_print_job') tables.scan_print_image = tables.scan_print_image.filter((r) => tables[table].some((j) => j.job_id === r.job_id));
    return { rows: [], rowCount: hit.length };
  }
  if (/^UPDATE scan_print_image SET view = NULL/.test(sql)) hit.forEach((r) => { r.view = null; });
  else if (/^UPDATE scan_print_image SET view = \$4/.test(sql)) hit.forEach((r) => { r.view = p[3]; });
  else if (/^UPDATE scan_print_job/.test(sql)) hit.forEach((r) => updateJob(r, p));
  else throw new Error(`fixture cannot run: ${sql.slice(0, 80)}`);
  return { rows: returning ? hit.map((r) => pick(r, cols(returning[1]))) : [], rowCount: hit.length };
}

function fakePool(control) {
  const tables = { scan_print_job: [], scan_print_image: [], scan_print_printer: [], scan_print_submission: [] };
  return { tables, async query(sql, params = []) {
    const text = typeof sql === 'string' ? sql : sql.text, values = typeof sql === 'string' ? params : sql.values;
    if (!queryIdentity(control, text)) return { rows: [], rowCount: 0 };
    if (control.beforeQuery) await control.beforeQuery(text, values);
    return query(tables, text, values);
  } };
}

function queryIdentity(control, sql) {
  if (!control.identityModule) return true;
  const current = control.identityModule.getRequestIdentity();
  control.identityQueries.push({ operation: sql.trim().split(/\s/)[0], identity: current ? structuredClone(current) : null });
  return current?.sub === control.sub && current?.principalIssuer === control.issuer && current?.isOperator === false;
}

function enterIdentity(control, next) {
  if (!control.identityModule) return next();
  return control.identityModule.runWithRequestIdentity(control.ambientIdentity ?? {
    sub: control.sub, principalIssuer: control.issuer, isOperator: false,
  }, next);
}

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function call(base, route, init = {}) {
  const res = await fetch(base + route, init), text = await res.text();
  let body = text;
  if ((res.headers.get('content-type') || '').includes('application/json')) body = text ? JSON.parse(text) : null;
  return { status: res.status, body, headers: res.headers, text };
}

async function photo(uMm, vMm) {
  const w = 200, h = 200, data = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const inside = Math.abs(x + 0.5 - w / 2) < uMm && Math.abs(y + 0.5 - h / 2) < vMm;
    data.set(inside ? [40, 70, 160] : [214, 200, 176], (y * w + x) * 3);
  }
  return coreRequire('sharp')(data, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

async function startFixture(options = {}) {
  const loaded = loadRoutes(), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-freshness-'));
  const control = { sub: 'alice', issuer: 'https://scan-fixture.invalid', identityModule: options.identityModule,
    identityQueries: [], ambientIdentity: null, printerAnswer: { status: 201, body: { done: true } }, beforeQuery: null, execFile: null };
  const pool = fakePool(control), env = { SCAN_TO_PRINT_SLICER_CMD: '' }, fetchCalls = [], execCalls = [];
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url, init });
    return { status: control.printerAnswer.status, text: async () => JSON.stringify(control.printerAnswer.body) };
  };
  const execFile = async (file, args) => {
    execCalls.push({ file, args });
    if (control.execFile) return control.execFile(file, args);
    fs.writeFileSync(args.at(-1), 'G28\nG1 X10\n'); return { stdout: file, stderr: '' };
  };
  const express = coreRequire('express'), app = express();
  app.use(express.json());
  app.use('/shared/ui/css', express.static(path.join(CORE, 'src/shared/ui/css')));
  app.use('/shared/ui/js', express.static(path.join(CORE, 'src/shared/ui/js')));
  app.use('/cockpit', express.static(path.join(CORE, 'src/pages/cockpit')));
  app.get('/shared/ui-debug.js', (_req, res) => res.sendFile(path.join(CORE, 'src/pages/shared/ui-debug.js')));
  app.use((req, _res, next) => { if (control.sub) req.oidc = { user: { sub: control.sub }, isAuthenticated: () => true }; enterIdentity(control, next); });
  app.use('/api/scan-to-print', loaded.factory({ pool, appPackageDir: PKG }, { dataRoot: tmp, env, fetchImpl, execFile }));
  let server;
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`, base = origin + '/api/scan-to-print';
  return { base, origin, tmp, pool, control, env, fetchCalls, execCalls, coreRequire,
    call: (route, init) => call(base, route, init),
    uploadPhotos: (id, files) => uploadPhotos(base, id, files),
    async close() { server.closeAllConnections(); await new Promise((r) => server.close(r)); fs.rmSync(tmp, { recursive: true, force: true }); loaded.restore(); },
  };
}

async function uploadPhotos(base, id, files) {
  const body = new FormData();
  for (const [name, bytes] of files) body.append('images', new Blob([bytes], { type: 'image/png' }), name);
  return call(base, `/jobs/${id}/images`, { method: 'POST', body });
}

async function readyJob(f, title = 'Synthetic box') {
  const created = await f.call('/jobs', json('POST', { title }));
  assert.equal(created.status, 201);
  const id = created.body.job.job_id;
  const up = await f.uploadPhotos(id, [['front.png', await photo(60, 30)], ['top.png', await photo(60, 40)], ['right.png', await photo(40, 30)]]);
  assert.equal(up.status, 201, JSON.stringify(up.body));
  for (const [index, view] of ['front', 'top', 'right'].entries()) {
    assert.equal((await f.call(`/jobs/${id}/images/${up.body.images[index].image_id}`, json('PATCH', { view }))).status, 200);
  }
  assert.equal((await f.call(`/jobs/${id}`, json('PATCH', { knownDimensions: [{ axis: 'x', mm: 60 }], settings: { resolution: 32, smoothIterations: 0 } }))).status, 200);
  const result = await f.call(`/jobs/${id}/reconstruct`, json('POST', {}));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return { id, images: up.body.images, report: result.body.report };
}

module.exports = { startFixture, json, photo, readyJob, coreRequire };
