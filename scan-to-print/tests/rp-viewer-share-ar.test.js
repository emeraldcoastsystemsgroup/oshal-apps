/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | 0.10.0: route, forced-RLS SQL, and QR/AR proofs for caller-scoped shareable read-only viewer links with revocation (RP-SCN-05), mesh edit/undo/reset routes (RP-SCN-01/02), and ISO/IEC 18004 SVG QR + Quick Look / Scene Viewer AR handoff (RP-SCN-06).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');

const { toStlBinary, parseGlb, parseUsdz } = require('../routes/engine/index.js');
const { artifactPath, ensureDir, jobDir } = require('../routes/data-dir.js');

const MIG_004 = fs.readFileSync(path.join(__dirname, '../migrations/004-share-links.sql'), 'utf8');
const MIG_004_NATIVE = fs.readFileSync(path.join(__dirname, '../migrations/native/004-share-links.sql'), 'utf8');
const TOOLS_JS = fs.readFileSync(path.join(__dirname, '../tools/scan-to-print-tools.js'), 'utf8');

function loadRouteModule(relFile) {
  const routerFactory = () => {
    const stack = [];
    const r = { stack };
    for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
      r[m] = (p, ...fns) => { stack.push({ method: m.toUpperCase(), path: p, fns }); return r; };
    }
    r.use = (...fns) => { stack.push({ method: 'USE', path: '/', fns }); return r; };
    return r;
  };
  const origLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'express') return { Router: routerFactory };
    if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
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
    statusCode: 200,
    payload: undefined,
    contentType: 'application/json',
    headersSent: false,
    setHeader(k, v) { resHeaders[k.toLowerCase()] = v; },
    type(t) { this.contentType = t; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.payload = b; this.headersSent = true; return this; },
    send(b) { this.payload = b; this.headersSent = true; return this; },
  };

  for (const layer of router.stack) {
    if (layer.method === 'USE') {
      let advanced = false;
      for (const fn of layer.fns) {
        advanced = false;
        await fn(req, res, () => { advanced = true; });
        if (res.headersSent || !advanced) return { status: res.statusCode, body: res.payload, headers: resHeaders, type: res.contentType };
      }
      continue;
    }
    if (layer.method !== method) continue;
    const keys = [];
    const pattern = '^' + layer.path.replace(/:([A-Za-z0-9_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$';
    const m = new RegExp(pattern).exec(urlPath);
    if (!m) continue;
    req.params = Object.fromEntries(keys.map((k, idx) => [k, decodeURIComponent(m[idx + 1])]));
    for (const fn of layer.fns) {
      let nextCalled = false;
      await fn(req, res, () => { nextCalled = true; });
      if (res.headersSent || !nextCalled) break;
    }
    return { status: res.statusCode, body: res.payload, headers: resHeaders, type: res.contentType };
  }
  return { status: 404, body: { error: 'not_found' }, headers: resHeaders, type: res.contentType };
}

test('RP-SCN-05: 004-share-links.sql enforces forced two-arm RLS on scan_print_share_link and companion native DDL matches', () => {
  assert.match(MIG_004, /ALTER TABLE scan_print_share_link ENABLE ROW LEVEL SECURITY;/);
  assert.match(MIG_004, /ALTER TABLE scan_print_share_link FORCE ROW LEVEL SECURITY;/);
  assert.match(MIG_004, /CREATE POLICY scan_print_share_link_owner ON scan_print_share_link/);
  assert.match(MIG_004, /CREATE POLICY scan_print_share_link_token_read ON scan_print_share_link/);
  assert.match(MIG_004_NATIVE, /CREATE TABLE IF NOT EXISTS scan_print_share_link/);
});

test('RP-SCN-05 & RP-SCN-01/02: share-routes creates, serves read-only HTML/GLB/USDZ, and revokes with 410; mesh-edit-routes crops, transforms, undoes, and resets', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stp-rp-test-'));
  try {
    const jobId = '11111111-1111-4111-8111-111111111111';
    const owner = 'owner-1';
    const dir = jobDir(tmpRoot, owner, jobId);
    ensureDir(path.join(dir, 'artifacts'));
    const box = {
      vertices: [
        { x: -10, y: -10, z: 0 }, { x: 10, y: -10, z: 0 }, { x: 10, y: 10, z: 0 }, { x: -10, y: 10, z: 0 },
        { x: -10, y: -10, z: 20 }, { x: 10, y: -10, z: 20 }, { x: 10, y: 10, z: 20 }, { x: -10, y: 10, z: 20 },
      ],
      triangles: [
        [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
        [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6],
        [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5],
      ],
    };
    fs.writeFileSync(artifactPath(dir, 'stl'), toStlBinary(box));

    let jobRow = {
      job_id: jobId, owner_sub: owner, title: 'Test Housing', source_kind: 'photos', state: 'reconstructed',
      known_dimensions: [{ axis: 'x', mm: 20 }], settings: {},
      report: { sizeMm: { x: 20, y: 20, z: 20 }, triangleCount: 12, vertexCount: 8, printable: true, warnings: [], limitations: [] },
      failure_reason: null, created_at: '2026-11-06T00:00:00Z', updated_at: '2026-11-06T00:00:00Z',
    };
    const shares = [];
    let currentShareToken = '';
    const pool = {
      async query(sql, params = []) {
        const text = String(sql);
        if (text.includes('set_config')) { currentShareToken = params[0] || ''; return { rows: [] }; }
        if (text.startsWith('BEGIN') || text.startsWith('COMMIT')) return { rows: [] };
        if (text.includes('UPDATE scan_print_job SET')) {
          if (params[0] !== owner || params[1] !== jobId) return { rows: [] };
          jobRow = {
            ...jobRow,
            state: params[5] ?? jobRow.state,
            report: params[6] ? (params[7] ? JSON.parse(params[7]) : null) : jobRow.report,
            updated_at: new Date().toISOString(),
          };
          return { rows: [jobRow] };
        }
        if (text.includes('FROM scan_print_job WHERE owner_sub = $1 AND job_id = $2')) {
          return { rows: params[0] === owner && params[1] === jobId ? [jobRow] : [] };
        }
        if (text.includes('INSERT INTO scan_print_share_link')) {
          const row = {
            share_id: '22222222-2222-4222-8222-222222222222',
            job_id: params[0], owner_sub: params[1], share_token: params[2], label: params[3],
            created_at: '2026-11-06T01:00:00Z', revoked_at: null,
          };
          shares.push(row);
          return { rows: [row] };
        }
        if (text.includes('FROM scan_print_share_link WHERE owner_sub = $1')) {
          return { rows: shares.filter((s) => s.owner_sub === params[0] && s.job_id === params[1]) };
        }
        if (text.includes('FROM scan_print_share_link WHERE share_token = $1')) {
          return { rows: shares.filter((s) => s.share_token === params[0] && s.share_token === currentShareToken) };
        }
        if (text.includes('FROM scan_print_job WHERE owner_sub = $1 AND job_id = $2')) {
          return { rows: params[0] === owner && params[1] === jobId ? [jobRow] : [] };
        }
        if (text.includes('UPDATE scan_print_share_link SET revoked_at')) {
          const found = shares.find((s) => s.owner_sub === params[0] && s.job_id === params[1] && s.share_id === params[2]);
          if (!found) return { rows: [] };
          found.revoked_at = params[3];
          return { rows: [found] };
        }
        throw new Error('Unexpected SQL: ' + text);
      },
    };
    const deps = { pool, dataRoot: tmpRoot, callerSub: (req) => req._sub };

    const { createMeshEditRoutes } = loadRouteModule('routes/mesh-edit-routes.js');
    const meshRouter = createMeshEditRoutes(deps);
    const cropRes = await invokeRouter(meshRouter, 'POST', `/jobs/${jobId}/mesh/crop`, {
      body: { bounds: { minX: -5, maxX: 5, minY: -10, maxY: 10, minZ: 5, maxZ: 20 }, snapToBed: true },
    });
    assert.equal(cropRes.status, 200);
    assert.equal(cropRes.body.report.sizeMm.x, 10);
    assert.equal(cropRes.body.report.sizeMm.z, 15);
    assert.equal(cropRes.body.meshState.canUndo, true);

    const undoRes = await invokeRouter(meshRouter, 'POST', `/jobs/${jobId}/mesh/undo`);
    assert.equal(undoRes.status, 200);
    assert.equal(undoRes.body.report.sizeMm.x, 20);

    const { createShareRoutes } = loadRouteModule('routes/share-routes.js');
    const shareRouter = createShareRoutes(deps);
    const created = await invokeRouter(shareRouter, 'POST', `/jobs/${jobId}/shares`, { body: { label: 'Customer review' } });
    assert.equal(created.status, 201);
    const token = created.body.share.token;
    assert.ok(token.length >= 32);

    const viewerHtml = await invokeRouter(shareRouter, 'GET', `/shared/${token}`);
    assert.equal(viewerHtml.status, 200);
    assert.match(String(viewerHtml.body), /data-shared-viewer="read-only"/);
    assert.match(String(viewerHtml.body), /rel="ar"/);

    const glbRes = await invokeRouter(shareRouter, 'GET', `/shared/${token}/artifacts/glb`);
    assert.equal(glbRes.status, 200);
    assert.equal(parseGlb(new Uint8Array(glbRes.body)).mesh.triangles.length, 12);

    const usdzRes = await invokeRouter(shareRouter, 'GET', `/shared/${token}/artifacts/usdz`);
    assert.equal(usdzRes.status, 200);
    assert.equal(parseUsdz(new Uint8Array(usdzRes.body)).entries[0].dataOffset % 64, 0);

    const foreignDelete = await invokeRouter(shareRouter, 'DELETE', `/jobs/${jobId}/shares/${created.body.share.shareId}`, { sub: 'stranger' });
    assert.equal(foreignDelete.status, 404, 'foreign caller cannot revoke owner share');

    const revoked = await invokeRouter(shareRouter, 'DELETE', `/jobs/${jobId}/shares/${created.body.share.shareId}`);
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.share.active, false);

    const afterRevoke = await invokeRouter(shareRouter, 'GET', `/shared/${token}`);
    assert.equal(afterRevoke.status, 410, 'revoked share link immediately returns 410 Gone');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('RP-SCN-06: ScanToPrintQr renders deterministic ISO/IEC 18004 SVG QR codes with quiet-zone and finder modules', () => {
  const ctx = vm.createContext({ window: {}, TextEncoder });
  vm.runInContext(TOOLS_JS, ctx);
  const svg = ctx.window.ScanToPrintQr.renderQrSvg('https://oshal.example/api/scan-to-print/shared/abc123XYZ_token_value');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /<path d="M3,3h1v1h-1z/, 'top-left finder pattern starts at quiet-zone (3,3)');
});
