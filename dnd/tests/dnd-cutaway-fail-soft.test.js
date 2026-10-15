/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-10-12 05:20:00 | maintainer@emeraldcoastsystemsgroup.com    | K4 regression: POST /api/dnd/cutaway answered 500 'server error' at quest start with no journal line. The seat check and the cutaway directory (mkdir under CLINE_WORKSPACE_ROOT) ran outside the fail-soft path, and the route logged only through a context logger the native kernel does not supply. Proves an unwritable workspace, a failing seat lookup and a failing render each answer {ok:false, soft:true} with plain words and a journaled error; that the route answers 200 soft instead of 500; and that an unexpected route failure is journaled through the framework logger when the context has none.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');

/** Captures what the framework logger ('@/shared/logger') would journal; the package resolves it lazily. */
const journal = [];
const frameworkLogger = { createChildLogger: (bindings) => ({ error: (fields, message) => journal.push({ bindings, fields, message }), warn() {}, info() {}, debug() {} }) };
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === '@/shared/logger') return frameworkLogger;
  return originalLoad.call(this, request, parent, isMain);
};
test.after(() => { Module._load = originalLoad; });

const { createMediaService } = require('../lib/dnd-media-service');
const { createDndRoutes } = require('../routes/dnd-routes.js');

/** @description A media service over observable doubles; `logger` is the AppContext logger (or none). */
function media({ access = async () => ({ campaign_id: 'c0ffee00' }), render, logger } = {}) {
  const observed = { renders: 0, archives: 0 };
  const provider = { id: 'test-image', generateWithMeta: async () => { observed.renders++; if (render) return render(); return { image: Buffer.from('png'), costUsd: 0, model: 'm' }; } };
  const service = createMediaService({
    pool: {},
    logger,
    campaign: { access, archive: async () => { observed.archives++; } },
    imageFramework: { resolve: async () => provider, recordCost: async () => {} },
  });
  return { service, observed };
}

/** @description Point the cutaway workspace somewhere for one test and restore it after. */
function withWorkspace(t, root) {
  const previous = process.env.CLINE_WORKSPACE_ROOT;
  process.env.CLINE_WORKSPACE_ROOT = root;
  t.after(() => { if (previous === undefined) delete process.env.CLINE_WORKSPACE_ROOT; else process.env.CLINE_WORKSPACE_ROOT = previous; });
}

test('an unwritable workspace answers fail-soft in plain words and is journaled, with no render or archive', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-cutaway-soft-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const notADirectory = path.join(dir, 'workspace-is-a-file');
  fs.writeFileSync(notADirectory, 'x');
  withWorkspace(t, notADirectory);
  const logged = [];
  const { service, observed } = media({ logger: { error: (fields, message) => logged.push({ fields, message }) } });
  const result = await service.generateCutaway('host', { campaignId: 'c0ffee00', prompt: 'The quest begins.', eventKey: 'quest:start' });
  assert.deepEqual(result, { ok: false, soft: true, error: 'Cutaway art is not available right now.' });
  assert.equal(observed.renders, 0);
  assert.equal(observed.archives, 0);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].fields.stage, 'prepare');
  assert.match(String(logged[0].fields.code), /ENOTDIR|EEXIST|EACCES/);
});

test('a failing seat lookup answers fail-soft and is journaled through the framework logger when the context has none', async (t) => {
  withWorkspace(t, fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-cutaway-soft-')));
  journal.length = 0;
  const { service } = media({ access: async () => { throw new Error('relation "dnd_campaign" is unavailable'); } });
  const result = await service.generateCutaway('host', { campaignId: 'c0ffee00', prompt: 'x' });
  assert.equal(result.soft, true);
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.error, /relation|dnd_campaign/, 'no raw error reaches the person');
  assert.equal(journal.length, 1);
  assert.equal(journal[0].bindings.module, 'dnd-media');
  assert.equal(journal[0].fields.stage, 'prepare');
});

test('a failing render answers plain words without the raw error, and is journaled', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-cutaway-soft-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  withWorkspace(t, root);
  const logged = [];
  const { service } = media({ render: () => { throw new Error('ECONNREFUSED 10.0.0.7:443 /srv/secret/path'); }, logger: { error: (fields) => logged.push(fields) } });
  const result = await service.generateCutaway('host', { campaignId: 'c0ffee00', prompt: 'x', eventKey: 'k' });
  assert.deepEqual(result, { ok: false, soft: true, error: 'The illustrator is resting.' });
  assert.equal(logged.length, 1);
  assert.equal(logged[0].stage, 'render');
});

/** @description One authenticated POST through the real router over a pool that fails every query. */
async function post(url, body) {
  const pool = { query: async () => { throw Object.assign(new Error('store unavailable'), { code: 'XX000' }); } };
  const router = createDndRoutes({ pool, appPackageDir: path.join(__dirname, '..') });
  let payload = '';
  const req = { method: 'POST', url, body, headers: {}, oidc: { user: { sub: 'host', name: 'host' }, isAuthenticated: () => true } };
  const res = { statusCode: 0, setHeader() {}, end(value) { payload = String(value || ''); } };
  await router(req, res, () => { throw new Error('route unexpectedly fell through'); });
  return { status: res.statusCode, body: JSON.parse(payload) };
}

test('POST /cutaway answers 200 fail-soft, not a 500, when the store fails at quest start', async (t) => {
  withWorkspace(t, fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-cutaway-soft-')));
  journal.length = 0;
  const r = await post('/cutaway', { campaignId: 'c0ffee00', prompt: 'The quest begins.', eventKey: 'quest:start' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, false);
  assert.equal(r.body.soft, true);
  assert.ok(journal.some((j) => j.fields.stage === 'prepare'), 'the failure is journaled');
});

test('an unexpected route failure is journaled through the framework logger when the context has none', async () => {
  journal.length = 0;
  const r = await post('/state', { campaignId: 'c0ffee00' });
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { error: 'server error' });
  assert.ok(journal.some((j) => j.bindings.module === 'dnd-routes' && j.message === 'D&D route request failed'), JSON.stringify(journal));
});
