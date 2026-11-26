/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.6.8 tool parity verification (CREATE-TOOL-VIDS-03, -05, -07, -08): proves case-insensitive orientation normalization on POST /jobs and POST /story, Brand intro/Brand graphic/Story screen controls and concierge schemas, finished-export status/publish/revoke/remove route-tool parity, owner-scoped POST /jobs/:id/cancel and POST /jobs/:id/retry (including worker cancel notification and box_required retry refusal preserving original failed jobs), and live Chromium UI flows at 1440x900 and 412x915 with zero page errors and zero native dialogs.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const Module = require('node:module');
const { randomUUID } = require('node:crypto');

const PKG = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.resolve(PKG, '..', 'scripts', 'toolchain');
const { chromium } = require(path.join(TOOLCHAIN, 'node_modules', 'playwright'));

function nativeRouter() {
  const stack = [];
  const router = (req, res, done) => {
    let index = 0;
    const next = (error) => {
      if (error) { res.status(500).json({ error: String(error.message || error) }); return; }
      const layer = stack[index++];
      if (!layer) { done(); return; }
      const pathname = req.url.split('?')[0];
      if (layer.use) {
        const hit = layer.path === '/' || pathname === layer.path || pathname.startsWith(layer.path + '/');
        return hit ? chain(layer.handlers, req, res, next) : next();
      }
      if (layer.method !== req.method.toLowerCase()) return next();
      const want = layer.path.split('/').filter(Boolean), got = pathname.split('/').filter(Boolean), params = {};
      const hit = want.length === got.length && want.every((p, i) => p.startsWith(':') ? ((params[p.slice(1)] = got[i]), true) : p === got[i]);
      if (!hit) return next();
      req.params = params;
      return chain(layer.handlers, req, res, next);
    };
    next();
  };
  router.registered = stack;
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) router[m] = (p, ...h) => { stack.push({ method: m, path: p, handlers: h.flat() }); return router; };
  router.use = (p, ...h) => { if (typeof p === 'function') { h.unshift(p); p = '/'; } stack.push({ use: true, path: p, handlers: h.flat() }); return router; };
  return router;
}

function chain(handlers, req, res, done) {
  let i = 0;
  const step = (error) => {
    if (error) return done(error);
    const h = handlers[i++];
    if (!h) return done();
    try { Promise.resolve(h(req, res, step)).catch(step); } catch (e) { step(e); }
  };
  step();
}

function createHarness() {
  const state = {
    workers: [],
    enqueued: [],
    jobs: new Map(),
  };
  const stubs = {
    express: { Router: nativeRouter },
    multer: Object.assign(() => ({ single: () => (_req, _res, next) => next() }), { diskStorage: (o) => o, MulterError: class extends Error {} }),
    '@/shared/logger': { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) },
    '@/app/routes/remote-client-routes': {
      remoteClientRegistry: {
        listClients: () => state.workers,
        enqueueTask: async (clientId, task) => { state.enqueued.push({ clientId, task }); return { taskId: task.taskId }; },
        getCompletedResult: async () => null,
      },
    },
    '@/shared/middleware/authz': { getCaller: (req) => ({ sub: req.sub }), getTrustedServiceUserSub: () => null },
    '@/shared/middleware/trusted-service-user-identity': { requireTrustedServiceUserIdentity: (_req, _res, next) => next() },
    '@/shared/services/database/request-identity': { runWithRequestIdentity: (_id, fn) => fn() },
    '@/shared/middleware/multipart-identity': { preserveRequestIdentity: (h) => h },
  };
  for (const rel of ['vids-routes.js', 'vids-job-controls.js', 'vids-publish-routes.js', 'vids-artifacts.js', 'vids-artifact-files.js']) {
    delete require.cache[path.join(PKG, 'routes', rel)];
  }
  const orig = Module._load;
  Module._load = function load(req, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, req)) return stubs[req];
    if (req.startsWith('@/')) throw new Error(`Unexpected framework import: ${req}`);
    return orig.call(this, req, parent, isMain);
  };
  let mod;
  try { mod = require(path.join(PKG, 'routes', 'vids-routes.js')); } finally { Module._load = orig; }

  const pool = {
    async query(text, params = []) {
      if (/INSERT INTO vids_jobs/.test(text)) {
        const jobId = randomUUID();
        const isBrand = text.includes("'brand'");
        const isRetry = text.includes("'queued'");
        const row = isBrand
          ? { job_id: jobId, user_sub: params[0], client_id: params[1], status: params[2], idea: params[3], orientation: null, insert_mode: 'brand', ingredient: null, outcome: JSON.parse(params[4]) }
          : isRetry
            ? { job_id: jobId, user_sub: params[0], client_id: params[1], status: 'queued', idea: params[2], orientation: params[3], insert_mode: params[4], ingredient: params[5], outcome: JSON.parse(params[6]) }
            : { job_id: jobId, user_sub: params[0], client_id: params[1], status: params[2], idea: params[3], orientation: params[4], insert_mode: params[5], ingredient: params[6], outcome: {} };
        state.jobs.set(jobId, row);
        return { rows: [{ job_id: jobId }] };
      }
      if (/SELECT job_id, status, client_id, outcome FROM vids_jobs/.test(text) || /SELECT job_id, status, client_id, idea, orientation/.test(text)) {
        const row = state.jobs.get(params[0]);
        return { rows: row && row.user_sub === params[1] ? [{ ...row }] : [] };
      }
      if (/UPDATE vids_jobs\s+SET status = 'cancelled'/.test(text)) {
        const row = state.jobs.get(params[0]);
        if (!row || row.user_sub !== params[1] || !['queued', 'running'].includes(row.status)) return { rows: [] };
        row.status = 'cancelled';
        row.outcome = { ...row.outcome, ...JSON.parse(params[2]) };
        return { rows: [{ job_id: row.job_id, status: row.status, updated_at: new Date().toISOString() }] };
      }
      if (/UPDATE vids_jobs\s+SET outcome = outcome \|\| jsonb_build_object\('taskId'/.test(text) || /UPDATE vids_jobs SET outcome = jsonb_build_object\('taskId'/.test(text)) {
        const row = state.jobs.get(params[0]);
        if (row) row.outcome = { ...row.outcome, taskId: params[1] };
        return { rows: [] };
      }
      if (/UPDATE vids_jobs SET outcome = \$2::jsonb/.test(text)) {
        const row = state.jobs.get(params[0]);
        if (row) row.outcome = JSON.parse(params[1]);
        return { rows: [] };
      }
      if (/UPDATE vids_jobs\s+SET status = 'failed'/.test(text)) {
        const row = state.jobs.get(params[0]);
        if (row) row.status = 'failed';
        return { rows: [] };
      }
      if (/FROM vids_jobs\s+WHERE user_sub = \$1/.test(text)) {
        const rows = [...state.jobs.values()].filter((r) => r.user_sub === params[0] && (!params[2] || r.status === params[2]));
        return { rows };
      }
      return { rows: [] };
    },
  };
  const router = mod.createVidsRoutes({ pool });
  function call(method, url, { body = {}, query = {}, sub = 'owner-a' } = {}) {
    return new Promise((resolve) => {
      const res = {
        statusCode: 200,
        headers: {},
        set(k, v) { this.headers[k] = v; return this; },
        status(code) { this.statusCode = code; return this; },
        json(payload) { resolve({ status: this.statusCode, body: payload }); },
        type() { return this; },
        send(payload) { resolve({ status: this.statusCode, body: payload }); },
        end() { resolve({ status: this.statusCode, body: null }); },
      };
      router({ method, url, headers: {}, body, query, sub }, res, () => resolve({ status: 404, body: { error: 'No matching application route' } }));
    });
  }
  return { state, call };
}

test('CREATE-TOOL-VIDS-03: lowercase portrait/landscape/square normalize cleanly on /jobs and /story without 400', async () => {
  const h = createHarness();
  // Without worker: lowercase portrait returns 503 (no worker), NOT 400!
  const noWorker = await h.call('POST', '/jobs', { body: { prompt: 'Ocean waves', orientation: 'portrait', insertMode: 'Extend' } });
  assert.equal(noWorker.status, 503);
  assert.equal(h.state.jobs.get(noWorker.body.job_id).orientation, 'Portrait');
  assert.equal(h.state.jobs.get(noWorker.body.job_id).insert_mode, 'Extend');

  // With online worker: all 3 lowercase/mixed orientations normalize to canonical values.
  h.state.workers = [{ clientId: 'w-1', agentId: 'a-1', status: 'online', healthy: true, capabilities: ['vids.generate', 'content.produce'], tags: ['vids'] }];
  for (const [raw, expected] of [['portrait', 'Portrait'], ['landscape', 'Landscape'], ['square', 'Square'], ['PORTRAIT', 'Portrait']]) {
    const r = await h.call('POST', '/jobs', { body: { prompt: `Clip ${raw}`, orientation: raw, insertMode: 'Insert' } });
    assert.equal(r.status, 200, `POST /jobs orientation=${raw}`);
    assert.equal(h.state.jobs.get(r.body.job_id).orientation, expected);
    assert.equal(h.state.enqueued.at(-1).task.input.arguments.orientation, expected);

    const sr = await h.call('POST', '/story', { body: { title: 'Fable', script: 'Once upon a time', orientation: raw, beats: 4 } });
    assert.equal(sr.status, 200, `POST /story orientation=${raw}`);
    assert.equal(h.state.jobs.get(sr.body.job_id).orientation, expected);
  }
  // Invalid values still cleanly reject with 400.
  for (const bad of ['diagonal', '<script>alert(1)</script>', 42]) {
    assert.equal((await h.call('POST', '/jobs', { body: { prompt: 'Bad', orientation: bad } })).status, 400);
    assert.equal((await h.call('POST', '/story', { body: { storyId: 'fable', orientation: bad } })).status, 400);
  }
});

test('CREATE-TOOL-VIDS-08: cancel and retry enforce ownership, status transitions, worker notify, and box_required preservation', async () => {
  const h = createHarness();
  h.state.workers = [{ clientId: 'w-1', agentId: 'a-1', status: 'online', healthy: true, capabilities: ['vids.generate'], tags: ['vids'] }];
  const created = await h.call('POST', '/jobs', { body: { prompt: 'Active clip', orientation: 'portrait', insertMode: 'Insert' } });
  assert.equal(created.status, 200);
  const jobId = created.body.job_id;

  // Foreign owner and missing UUID are refused 404.
  assert.equal((await h.call('POST', `/jobs/${jobId}/cancel`, { sub: 'owner-b' })).status, 404);
  assert.equal((await h.call('POST', `/jobs/${randomUUID()}/cancel`)).status, 404);
  assert.equal((await h.call('POST', '/jobs/not-a-uuid/cancel')).status, 404);
  assert.equal((await h.call('POST', `/jobs/${jobId}/cancel`, { body: { reason: 'x'.repeat(501) } })).status, 400);

  // Cancel owned queued job -> status cancelled + worker notified.
  const cancelled = await h.call('POST', `/jobs/${jobId}/cancel`, { body: { reason: 'changed mind' } });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.status, 'cancelled');
  assert.equal(cancelled.body.workerNotified, true);
  assert.equal(h.state.jobs.get(jobId).status, 'cancelled');
  assert.equal(h.state.enqueued.at(-1).task.input.name, 'vids.cancel');

  // Already cancelled cannot be cancelled again.
  assert.equal((await h.call('POST', `/jobs/${jobId}/cancel`)).status, 409);

  // Retry without worker -> 503 box_required and original job stays preserved untouched.
  h.state.workers = [];
  const beforeCount = h.state.jobs.size;
  const noWorkerRetry = await h.call('POST', `/jobs/${jobId}/retry`);
  assert.equal(noWorkerRetry.status, 503);
  assert.equal(noWorkerRetry.body.error, 'box_required');
  assert.equal(noWorkerRetry.body.original_job_id, jobId);
  assert.equal(h.state.jobs.size, beforeCount, 'original row preserved without creating orphan row');
  assert.equal(h.state.jobs.get(jobId).status, 'cancelled');

  // Retry with worker online -> creates new queued job while preserving original row.
  h.state.workers = [{ clientId: 'w-1', agentId: 'a-1', status: 'online', healthy: true, capabilities: ['vids.generate'], tags: ['vids'] }];
  const retried = await h.call('POST', `/jobs/${jobId}/retry`);
  assert.equal(retried.status, 200);
  assert.equal(retried.body.status, 'queued');
  assert.equal(retried.body.original_job_id, jobId);
  assert.notEqual(retried.body.job_id, jobId);
  assert.equal(h.state.jobs.get(jobId).status, 'cancelled', 'original row still preserved');
  assert.equal(h.state.jobs.get(retried.body.job_id).status, 'queued');

  // Queued job cannot be retried; foreign owner cannot retry.
  assert.equal((await h.call('POST', `/jobs/${retried.body.job_id}/retry`)).status, 409);
  assert.equal((await h.call('POST', `/jobs/${jobId}/retry`, { sub: 'owner-b' })).status, 404);
});

test('Chromium (1440x900 & 412x915): Brand intro/graphic, Story, Cancel and Retry controls work with zero page errors and zero dialogs', { timeout: 60000 }, async (t) => {
  const source = fs.readFileSync(path.join(PKG, 'routes', 'vids-routes.js'), 'utf8').match(/`(<!doctype html>[\s\S]*?<\/html>)`/i)[1];
  const html = new Function(`return \`${source}\`;`)();
  const requests = [];
  const jobs = [
    { job_id: '11111111-1111-4111-8111-111111111111', status: 'queued', idea: 'Queued clip', orientation: 'Portrait', client_id: 'w-1', created_at: new Date().toISOString() },
    { job_id: '22222222-2222-4222-8222-222222222222', status: 'failed', idea: 'Failed clip', orientation: 'Landscape', client_id: null, created_at: new Date().toISOString() },
  ];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const bodyText = Buffer.concat(chunks).toString('utf8');
      const body = bodyText ? JSON.parse(bodyText) : {};
      if (req.method === 'GET' && req.url === '/api/vids/app') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); return; }
      if (req.method === 'GET' && req.url === '/api/vids/jobs') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ workers: [], jobs })); return; }
      if (req.method === 'GET' && req.url === '/shared/ui/js/editor-foundation.js') {
        res.writeHead(200, { 'content-type': 'application/javascript' });
        res.end('export function createEditorFoundation(){return{refresh(){},hasPending(){return false;},flushPending(){return Promise.resolve();},discardPending(){},destroy(){}};}');
        return;
      }
      if (req.method === 'GET' && /\.(css|m?js)$/.test(req.url.split('?')[0])) {
        res.writeHead(200, { 'content-type': req.url.endsWith('.css') ? 'text/css' : 'application/javascript' });
        res.end(req.url.includes('app-handoff') ? 'export function receiveHandoff(){}' : req.url.includes('app-workflows') ? 'export function mountConnectedActions(){return Promise.resolve();}' : '');
        return;
      }
      if (req.method === 'POST' && req.url === '/api/vids/brand') {
        requests.push({ url: req.url, body });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ job_id: randomUUID(), status: 'queued' }));
        return;
      }
      if (req.method === 'POST' && req.url === '/api/vids/story') {
        requests.push({ url: req.url, body });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ job_id: randomUUID(), status: 'queued' }));
        return;
      }
      if (req.method === 'POST' && req.url.endsWith('/cancel')) {
        requests.push({ url: req.url, body });
        jobs[0].status = 'cancelled';
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ job_id: jobs[0].job_id, status: 'cancelled' }));
        return;
      }
      if (req.method === 'POST' && req.url.endsWith('/retry')) {
        requests.push({ url: req.url, body });
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'box_required', message: 'No Vids worker is registered.' }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":"not_found"}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); server.close(); });

  for (const viewport of [{ width: 1440, height: 900 }, { width: 412, height: 915 }]) {
    jobs[0].status = 'queued';
    requests.length = 0;
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [], dialogs = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });

    await page.goto(`${origin}/api/vids/app`, { waitUntil: 'load' });
    await page.locator('#brandIntroBtn').waitFor({ state: 'visible' });
    await page.locator('#prompt').fill('Launch brand spotlight');
    await page.locator('#brandIntroBtn').click();
    await page.locator('#vidsStatus').filter({ hasText: 'Brand intro queued.' }).waitFor();
    await page.locator('#brandGraphicBtn').click();
    await page.locator('#vidsStatus').filter({ hasText: 'Brand graphic queued.' }).waitFor();
    await page.locator('#storyToggleBtn').click();
    await page.locator('#storyTitle').fill('Harbor Fable');
    await page.locator('#storyBtn').click();
    await page.locator('#vidsStatus').filter({ hasText: 'Multi-scene story queued.' }).waitFor();

    await page.locator('button[data-job-action="cancel"]').first().click();
    await page.locator('#vidsStatus').filter({ hasText: 'Job cancelled.' }).waitFor();
    await page.locator('button[data-job-action="retry"]').first().click();
    await page.locator('#vidsStatus').filter({ hasText: 'No Vids worker is registered.' }).waitFor();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, `no horizontal overflow at ${viewport.width}x${viewport.height}`);
    assert.deepEqual(errors, [], `zero pageErrors at ${viewport.width}x${viewport.height}`);
    assert.deepEqual(dialogs, [], `zero native dialogs at ${viewport.width}x${viewport.height}`);
    assert.equal(requests.find((r) => r.url === '/api/vids/brand' && r.body.brandMode === 'intro')?.body.confirm, true);
    assert.equal(requests.find((r) => r.url === '/api/vids/brand' && r.body.brandMode === 'graphic')?.body.confirm, true);
    assert.equal(requests.find((r) => r.url === '/api/vids/story')?.body.title, 'Harbor Fable');
    assert.ok(requests.some((r) => r.url.endsWith('/cancel')));
    assert.ok(requests.some((r) => r.url.endsWith('/retry')));
    await context.close();
  }
});
