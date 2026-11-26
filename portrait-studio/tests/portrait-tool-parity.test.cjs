/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.17.10 tool parity acceptance suite covering CREATE-TOOL-PORTRAIT-01, -02, -03, and -09: manifest/authz/persona closure plus live Express HTTP checks for portrait-list, portrait-read, portrait-catalog, portrait-provider-status, portrait-create (owned photo refs + daily cap), portrait-rerun (finished + failed rows + daily cap), portrait-rename, portrait-delete, portrait-export, and portrait-handoff.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.resolve(ROOT, '..', 'scripts', 'toolchain');
const deps = createRequire(path.join(TOOLCHAIN, 'package.json'));
const express = deps('express');
const multer = deps('multer');
const yaml = deps('js-yaml');
const sharp = deps('sharp');

const ISSUER = 'https://portrait-parity.fixture.test';
const IDS = {
  done: '11111111-1111-4111-8111-111111111111',
  failed: '22222222-2222-4222-8222-222222222222',
  foreign: '33333333-3333-4333-8333-333333333333',
  missing: '44444444-4444-4444-8444-444444444444',
  project: '55555555-5555-4555-8555-555555555555',
  foreignProject: '66666666-6666-4666-8666-666666666666',
  asset: '77777777-7777-4777-8777-777777777777',
};

function ownerKeyFor(actor) {
  return crypto.createHash('sha256').update(JSON.stringify([actor.issuer, actor.sub, String(actor.principalId), actor.tenantIds[0]])).digest('hex');
}

async function createParityServer(t, { dailyCap = '25', providerAvailable = true, nativeProvider = true } = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portrait-parity-'));
  const prevDataDir = process.env.OSHAL_PACKAGE_DATA_DIR;
  const prevWorkspace = process.env.CLINE_WORKSPACE_ROOT;
  const prevCap = process.env.PORTRAIT_STUDIO_DAILY_CAP;
  process.env.OSHAL_PACKAGE_DATA_DIR = tmpDir;
  process.env.CLINE_WORKSPACE_ROOT = tmpDir;
  process.env.PORTRAIT_STUDIO_DAILY_CAP = String(dailyCap);

  const pngBytes = await sharp({ create: { width: 320, height: 400, channels: 3, background: '#336699' } }).png().toBuffer();
  const srcFile = path.join(tmpDir, 'src.png');
  const outFile = path.join(tmpDir, 'out.png');
  fs.writeFileSync(srcFile, pngBytes);
  fs.writeFileSync(outFile, pngBytes);

  const actors = {
    alice: { isActive: true, issuer: ISSUER, sub: 'alice', principalId: 'p-alice', tenantIds: ['t-alice'] },
    bob: { isActive: true, issuer: ISSUER, sub: 'bob', principalId: 'p-bob', tenantIds: ['t-bob'] },
  };
  const aliceKey = ownerKeyFor(actors.alice);
  const bobKey = ownerKeyFor(actors.bob);
  const rows = [
    {
      portrait_id: IDS.done, user_sub: 'alice', owner_issuer: ISSUER, title: 'Boardroom Shot',
      mode: 'professional', style: 'linkedin', options: { background: 'studio-gray', attire: 'dark-suit' },
      prompt: 'fixture', status: 'done', source_path: srcFile, original_path: null, output_path: outFile,
      model: 'fixture:v1', cost_usd: 0.04, error: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
    {
      portrait_id: IDS.failed, user_sub: 'alice', owner_issuer: ISSUER, title: 'Failed Astronaut',
      mode: 'character', style: 'astronaut', options: { background: 'studio-gray' },
      prompt: 'fixture', status: 'failed', source_path: srcFile, original_path: null, output_path: null,
      model: null, cost_usd: null, error: 'upstream timed out', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
    {
      portrait_id: IDS.foreign, user_sub: 'bob', owner_issuer: ISSUER, title: 'Bob Private',
      mode: 'professional', style: 'linkedin', options: {},
      prompt: 'fixture', status: 'done', source_path: srcFile, original_path: null, output_path: outFile,
      model: 'fixture:v1', cost_usd: null, error: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
  ];
  const sourceProjects = new Map([
    [`${aliceKey}:${IDS.project}`, {
      id: IDS.project, current_revision: 1, title: 'Cropped Headshot',
      model: { mode: 'professional', style: 'linkedin', title: 'Cropped Headshot', notes: 'warm lighting', settings: { background: 'studio-gray' }, photos: [{ id: 'p1', assetId: IDS.asset, crops: [{ x: 20, y: 20, w: 200, h: 250 }] }] },
    }],
    [`${bobKey}:${IDS.foreignProject}`, {
      id: IDS.foreignProject, current_revision: 1, title: 'Bob Source',
      model: { mode: 'professional', style: 'linkedin', photos: [] },
    }],
  ]);
  const sourceAssets = new Map([
    [`${aliceKey}:${IDS.asset}`, pngBytes],
  ]);

  let currentUser = 'alice';
  let providerCalls = 0;
  let lastPrompt = '';
  const deniedPerms = new Set();

  const pool = {
    async query(sql, values = []) {
      if (/^\s*(?:CREATE|ALTER|BEGIN|COMMIT|ROLLBACK|SELECT set_config)/.test(sql) || /INTERVAL '\d+ minutes'/.test(sql)) {
        return { rows: [], rowCount: 0 };
      }
      if (/FROM portrait_source_projects/.test(sql)) {
        const hit = sourceProjects.get(`${values[0]}:${values[1]}`);
        return { rows: hit ? [{ id: hit.id, current_revision: hit.current_revision, title: hit.title }] : [], rowCount: hit ? 1 : 0 };
      }
      if (/FROM portrait_source_revisions/.test(sql)) {
        const hit = sourceProjects.get(`${values[0]}:${values[1]}`);
        return { rows: hit ? [{ model: hit.model }] : [], rowCount: hit ? 1 : 0 };
      }
      if (/FROM portrait_source_assets/.test(sql)) {
        const bytes = sourceAssets.get(`${values[0]}:${values[1]}`);
        return { rows: bytes ? [{ id: values[1], bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }] : [], rowCount: bytes ? 1 : 0 };
      }
      if (/FROM portrait_source_chunks/.test(sql)) {
        const bytes = sourceAssets.get(`${values[0]}:${values[1]}`);
        return { rows: bytes ? [{ data_base64: bytes.toString('base64') }] : [], rowCount: bytes ? 1 : 0 };
      }
      if (/INSERT INTO ps_portraits/.test(sql)) {
        const id = crypto.randomUUID();
        const opts = typeof values[3] === 'string' ? JSON.parse(values[3]) : (values[3] || {});
        rows.unshift({
          portrait_id: id, user_sub: String(values[0]), mode: String(values[1]), style: String(values[2]),
          options: opts, prompt: String(values[4]), status: 'queued', owner_issuer: String(values[5]),
          title: String(values[6] || ''), source_path: null, original_path: null, output_path: null,
          model: null, cost_usd: null, error: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        });
        return { rows: [{ portrait_id: id }], rowCount: 1 };
      }
      if (/WHERE portrait_id = \$1/.test(sql)) {
        const row = rows.find((item) => item.portrait_id === values[0]);
        if (/owner_issuer/.test(sql) && (!row || row.user_sub !== values[1] || row.owner_issuer !== values[2])) return { rows: [], rowCount: 0 };
        if (!row) return { rows: [], rowCount: 0 };
        if (/^DELETE/.test(sql)) { rows.splice(rows.indexOf(row), 1); return { rows: [], rowCount: 1 }; }
        if (/SET title = \$4/.test(sql)) { row.title = String(values[3]); return { rows: [{ portrait_id: row.portrait_id, title: row.title }], rowCount: 1 }; }
        if (/SET source_path = \$2/.test(sql)) { row.source_path = String(values[1]); return { rows: [], rowCount: 1 }; }
        if (/SET status = 'generating'/.test(sql)) { row.status = 'generating'; return { rows: [], rowCount: 1 }; }
        if (/SET status = 'done'/.test(sql)) { row.status = 'done'; row.output_path = String(values[1]); row.model = String(values[2]); row.cost_usd = values[3]; return { rows: [], rowCount: 1 }; }
        if (/SET status = 'failed'/.test(sql)) { row.status = 'failed'; row.error = String(values[1]); return { rows: [], rowCount: 1 }; }
        return { rows: [{ ...row }], rowCount: 1 };
      }
      if (/FROM ps_portraits WHERE user_sub = \$1/.test(sql)) {
        const owned = rows.filter((item) => item.user_sub === values[0] && item.owner_issuer === values[1]);
        if (/COUNT\(\*\)/.test(sql)) {
          const active = owned.filter((item) => item.status === 'queued' || item.status === 'generating').length;
          return { rows: [{ n: owned.length, active, done: owned.filter((i) => i.status === 'done').length, total: owned.length }], rowCount: 1 };
        }
        return { rows: owned.map((item) => ({ ...item, has_source: Boolean(item.source_path) })), rowCount: owned.length };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const originalLoad = Module._load;
  Module._load = function (name, parent, ...rest) {
    if (name === 'express') return express;
    if (name === 'multer') return multer;
    if (name === 'sharp') return sharp;
    if (name === '@/shared/logger') return { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) };
    if (name === '@/features/video-generation') {
      return {
        resolveStoryboardImageProvider: async () => ({
          id: 'fixture-engine',
          costClass: 'free',
          native: nativeProvider,
          available: async () => providerAvailable,
          healthCheck: async () => ({ ok: providerAvailable, detail: providerAvailable ? 'fixture model ready' : 'no image provider configured' }),
          generateWithMeta: async (prompt) => { providerCalls += 1; lastPrompt = prompt; return { image: pngBytes, costUsd: 0.02, model: 'fixture-v1' }; },
        }),
        recordStoryboardImageCost: async () => undefined,
      };
    }
    return originalLoad.call(this, name, parent, ...rest);
  };

  let createPortraitStudioRoutes;
  try {
    for (const file of ['portrait-studio-routes.js', 'portrait-parity.js', 'portrait-authorization.js', 'portrait-catalog.js']) {
      delete require.cache[require.resolve(path.join(ROOT, 'routes', file))];
    }
    ({ createPortraitStudioRoutes } = require(path.join(ROOT, 'routes', 'portrait-studio-routes.js')));
  } finally {
    Module._load = originalLoad;
  }

  let registeredAdapter = null;
  const ctx = {
    pool,
    appPackageDir: ROOT,
    authorization: {
      currentActor: () => actors[currentUser],
      registerResource: (_name, adapter) => { registeredAdapter = adapter; },
      authorize: async ({ permission, resourceId }) => {
        if (deniedPerms.has(permission)) return { allowed: false };
        if (resourceId && registeredAdapter) {
          const ok = await registeredAdapter.authorize({ actor: actors[currentUser], operation: { resourceId }, grant: { scope: 'own' } });
          return { allowed: ok };
        }
        return { allowed: true };
      },
    },
  };

  const app = express();
  app.use('/api/portrait-studio', createPortraitStudioRoutes(ctx));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  const base = `http://127.0.0.1:${server.address().port}/api/portrait-studio`;

  t.after(async () => {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    if (prevDataDir === undefined) delete process.env.OSHAL_PACKAGE_DATA_DIR; else process.env.OSHAL_PACKAGE_DATA_DIR = prevDataDir;
    if (prevWorkspace === undefined) delete process.env.CLINE_WORKSPACE_ROOT; else process.env.CLINE_WORKSPACE_ROOT = prevWorkspace;
    if (prevCap === undefined) delete process.env.PORTRAIT_STUDIO_DAILY_CAP; else process.env.PORTRAIT_STUDIO_DAILY_CAP = prevCap;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  return {
    base,
    rows,
    setUser: (u) => { currentUser = u; },
    deny: (p) => deniedPerms.add(p),
    allowAll: () => deniedPerms.clear(),
    getProviderCalls: () => providerCalls,
    getLastPrompt: () => lastPrompt,
    call: (p, { method = 'GET', body } = {}) => fetch(base + p, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  };
}

test('manifest, authorization bindings, and portrait-artist persona declare all 10 new parity tools without adding permissions or roles', () => {
  const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
  const auth = yaml.load(fs.readFileSync(path.join(ROOT, 'authorization.yaml'), 'utf8'));
  const persona = yaml.load(fs.readFileSync(path.join(ROOT, 'personas', 'portrait-artist.yaml'), 'utf8'));

  const expectedTools = [
    ['portrait-list', 'auto', false, 'GET /api/portrait-studio/portraits'],
    ['portrait-read', 'auto', false, 'GET /api/portrait-studio/portraits/{input.id}'],
    ['portrait-catalog', 'auto', false, 'GET /api/portrait-studio/catalog'],
    ['portrait-provider-status', 'auto', false, 'GET /api/portrait-studio/provider-status'],
    ['portrait-export', 'auto', false, 'GET /api/portrait-studio/portraits/{input.id}/export-link?size={input.size}'],
    ['portrait-create', 'ask', true, 'POST /api/portrait-studio/portraits'],
    ['portrait-rerun', 'ask', true, 'POST /api/portrait-studio/portraits/{input.id}/rerun'],
    ['portrait-rename', 'ask', true, 'PATCH /api/portrait-studio/portraits/{input.id}'],
    ['portrait-delete', 'ask', true, 'DELETE /api/portrait-studio/portraits/{input.id}'],
    ['portrait-handoff', 'ask', true, 'POST /api/portrait-studio/portraits/{input.id}/handoff'],
  ];

  for (const [name, mode, approval, endpoint] of expectedTools) {
    const tool = manifest.tools.find((item) => item.name === name);
    assert.ok(tool, `manifest tool ${name}`);
    assert.equal(tool.defaultAuthMode, mode, `${name} defaultAuthMode`);
    assert.equal(tool.requiresApproval, approval, `${name} requiresApproval`);
    assert.equal(tool.executor.apiEndpoint, endpoint, `${name} apiEndpoint`);
    assert.equal(tool.inputSchema.additionalProperties, false, `${name} closed inputSchema`);
    if (approval) assert.ok(typeof tool.cardText === 'string' && tool.cardText.length > 10, `${name} cardText`);
    const binding = auth.bindings.tools.find((b) => b.id === name);
    assert.ok(binding, `${name} bound in authorization.yaml`);
    for (const perm of binding.allOf) assert.ok(auth.permissions[perm], `${name} uses existing permission ${perm}`);
    assert.equal(persona.authorizations[name], approval ? 'approval' : 'auto', `${name} in portrait-artist authorizations`);
  }

  assert.deepEqual(Object.keys(auth.permissions).sort(), [
    'portrait.artist', 'portrait.change', 'portrait.create', 'portrait.delete', 'portrait.email',
    'portrait.export', 'portrait.read', 'portrait.source.create', 'portrait.view',
  ]);
  for (const [method, routePath] of [
    ['GET', '/provider-status'],
    ['GET', '/portraits/:id'],
    ['POST', '/portraits/:id/rerun'],
    ['GET', '/portraits/:id/export-link'],
    ['POST', '/portraits/:id/handoff'],
  ]) {
    assert.ok(auth.bindings.http.some((b) => b.method === method && b.path === routePath), `HTTP binding ${method} ${routePath}`);
  }
});

test('CREATE-TOOL-PORTRAIT-01: portrait-list, portrait-read, portrait-catalog, and portrait-provider-status work and enforce ownership', async (t) => {
  const srv = await createParityServer(t);

  const listRes = await srv.call('/portraits');
  assert.equal(listRes.status, 200);
  const listBody = await listRes.json();
  assert.deepEqual(listBody.portraits.map((p) => p.portrait_id), [IDS.done, IDS.failed]);
  assert.equal(listBody.portraits[0].id, IDS.done);
  assert.equal(listBody.portraits[0].resultUrl, `/api/portrait-studio/portraits/${IDS.done}/image`);
  assert.equal(listBody.portraits[0].canRerun, true);
  assert.equal(listBody.portraits[0].source_path, undefined);
  assert.equal(listBody.portraits[1].resultUrl, null);
  assert.equal(listBody.portraits[1].error, 'upstream timed out');

  const readDone = await srv.call(`/portraits/${IDS.done}`);
  assert.equal(readDone.status, 200);
  const detail = (await readDone.json()).portrait;
  assert.equal(detail.id, IDS.done);
  assert.equal(detail.title, 'Boardroom Shot');
  assert.equal(detail.options.background, 'studio-gray');
  assert.equal(detail.exports.linkedin.downloadUrl, `/api/portrait-studio/portraits/${IDS.done}/export?size=600`);
  assert.equal(detail.source_path, undefined);

  assert.equal((await srv.call(`/portraits/${IDS.foreign}`)).status, 404);
  assert.equal((await srv.call(`/portraits/${IDS.missing}`)).status, 404);
  assert.equal((await srv.call('/portraits/not-a-uuid')).status, 404);

  const catBody = await (await srv.call('/catalog')).json();
  assert.ok(Array.isArray(catBody.presets.professional) && catBody.presets.professional.length > 0);
  assert.ok(Array.isArray(catBody.exportFormats) && catBody.exportFormats.some((f) => f.id === 'linkedin'));

  const statusBody = await (await srv.call('/provider-status')).json();
  assert.equal(statusBody.configured, true);
  assert.equal(statusBody.available, true);
  assert.deepEqual(statusBody.dailyCap, { used: 2, limit: 25, remaining: 23, active: 0, maxActive: 2 });

  const unavailSrv = await createParityServer(t, { providerAvailable: false });
  const downStatus = await (await unavailSrv.call('/provider-status')).json();
  assert.equal(downStatus.configured, false);
  assert.equal(downStatus.available, false);
  assert.equal(downStatus.dailyCap.used, 2);
});

test('CREATE-TOOL-PORTRAIT-02: portrait-create accepts owned sourceProjectId/sourceAssetId/portraitId, rejects foreign refs and scope spoofing, and enforces daily cap', async (t) => {
  const srv = await createParityServer(t, { dailyCap: '4' });

  const fromProject = await srv.call('/portraits', {
    method: 'POST',
    body: { sourceProjectId: IDS.project, mode: 'professional', style: 'linkedin', background: 'corporate-navy', title: 'LinkedIn Navy' },
  });
  assert.equal(fromProject.status, 201);
  const created1 = await fromProject.json();
  assert.equal(created1.status, 'done');
  assert.ok(srv.getLastPrompt().includes('navy'), 'override background reached generated prompt');

  const fromAsset = await srv.call('/portraits', {
    method: 'POST',
    body: { sourceAssetId: IDS.asset, mode: 'professional', style: 'executive', title: 'From Asset' },
  });
  assert.equal(fromAsset.status, 201);

  assert.equal((await srv.call('/portraits', { method: 'POST', body: { sourceProjectId: IDS.foreignProject, mode: 'professional', style: 'linkedin' } })).status, 404);
  assert.equal((await srv.call('/portraits', { method: 'POST', body: { portraitId: IDS.foreign, mode: 'professional', style: 'linkedin' } })).status, 404);
  assert.equal((await srv.call('/portraits', { method: 'POST', body: { sourceProjectId: IDS.project, tenantId: 'other' } })).status, 400);

  // Daily cap is 4; we started with 2 existing rows + created 2 = 4, so the next must return 429.
  const capped = await srv.call('/portraits', {
    method: 'POST',
    body: { portraitId: IDS.done, mode: 'professional', style: 'linkedin' },
  });
  assert.equal(capped.status, 429);
  assert.match((await capped.json()).error, /daily cap reached/);
});

test('CREATE-TOOL-PORTRAIT-03: portrait-rerun works on both finished and failed rows, preserves original, counts toward daily cap, and refuses foreign/missing with 404', async (t) => {
  const srv = await createParityServer(t, { dailyCap: '4' });

  const rerunFailed = await srv.call(`/portraits/${IDS.failed}/rerun`, { method: 'POST', body: { id: IDS.failed } });
  assert.equal(rerunFailed.status, 201);
  const body1 = await rerunFailed.json();
  assert.equal(body1.status, 'done');
  assert.equal(body1.rerunOf, IDS.failed);
  assert.notEqual(body1.portraitId, IDS.failed);

  const rerunDone = await srv.call(`/portraits/${IDS.done}/rerun`, { method: 'POST', body: {} });
  assert.equal(rerunDone.status, 201);
  const body2 = await rerunDone.json();
  assert.equal(body2.rerunOf, IDS.done);

  // Now 2 original + 2 reruns = 4 == dailyCap -> next rerun must fail 429.
  const capped = await srv.call(`/portraits/${IDS.done}/rerun`, { method: 'POST', body: {} });
  assert.equal(capped.status, 429);

  assert.equal((await srv.call(`/portraits/${IDS.foreign}/rerun`, { method: 'POST', body: {} })).status, 404);
  assert.equal((await srv.call(`/portraits/${IDS.missing}/rerun`, { method: 'POST', body: {} })).status, 404);
  assert.equal((await srv.call(`/portraits/${IDS.done}/rerun`, { method: 'POST', body: { id: IDS.failed } })).status, 400);
});

test('CREATE-TOOL-PORTRAIT-09: portrait-rename, portrait-export, portrait-handoff, and portrait-delete enforce ownership and closed catalogs', async (t) => {
  const srv = await createParityServer(t);

  const renamed = await srv.call(`/portraits/${IDS.done}`, { method: 'PATCH', body: { id: IDS.done, title: 'Updated Headshot' } });
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).title, 'Updated Headshot');
  assert.equal((await srv.call(`/portraits/${IDS.done}`, { method: 'PATCH', body: { id: IDS.failed, title: 'Bad' } })).status, 400);
  assert.equal((await srv.call(`/portraits/${IDS.done}`, { method: 'PATCH', body: { title: 'Bad', user_sub: 'bob' } })).status, 400);

  for (const [preset, expectedSize, w, h] of [
    ['original', 'original', 320, 400],
    ['linkedin', '600', 600, 600],
    ['square', '600', 600, 600],
    ['print', 'portrait', 1200, 1800],
    ['landscape', 'landscape', 1800, 1200],
  ]) {
    const expRes = await srv.call(`/portraits/${IDS.done}/export-link?size=${preset}`);
    assert.equal(expRes.status, 200, `export preset ${preset}`);
    const exp = await expRes.json();
    assert.equal(exp.size, expectedSize);
    assert.equal(exp.width, w);
    assert.equal(exp.height, h);
    assert.equal(exp.mimeType, 'image/png');
    assert.ok(exp.downloadUrl.startsWith(`/api/portrait-studio/portraits/${IDS.done}/`));
  }
  assert.equal((await srv.call(`/portraits/${IDS.done}/export-link?size=huge`)).status, 400);
  assert.equal((await srv.call(`/portraits/${IDS.failed}/export-link?size=linkedin`)).status, 404);
  assert.equal((await srv.call(`/portraits/${IDS.foreign}/export-link?size=linkedin`)).status, 404);

  const handoffRes = await srv.call(`/portraits/${IDS.done}/handoff`, {
    method: 'POST',
    body: { id: IDS.done, targetApp: 'publishing-studio', size: 'print' },
  });
  assert.equal(handoffRes.status, 200);
  const handoff = await handoffRes.json();
  assert.equal(handoff.ok, true);
  assert.equal(handoff.targetApp, 'publishing-studio');
  assert.equal(handoff.artifact.type, 'image/png');
  assert.match(handoff.openUrl, /app=publishing-studio/);
  assert.equal((await srv.call(`/portraits/${IDS.done}/handoff`, { method: 'POST', body: { targetApp: 'unknown-app' } })).status, 400);
  assert.equal((await srv.call(`/portraits/${IDS.failed}/handoff`, { method: 'POST', body: { targetApp: 'create' } })).status, 404);
  assert.equal((await srv.call(`/portraits/${IDS.foreign}/handoff`, { method: 'POST', body: { targetApp: 'create' } })).status, 404);

  assert.equal((await srv.call(`/portraits/${IDS.foreign}`, { method: 'DELETE' })).status, 404);
  const delRes = await srv.call(`/portraits/${IDS.failed}`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);
  assert.equal((await srv.call(`/portraits/${IDS.failed}`)).status, 404);
});
