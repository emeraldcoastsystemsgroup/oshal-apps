/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The compiled Vids router hands a published export's token to the kernel's no-login link seam (ctx.publicLinks). The native kernel serves the declared anonymous GET /api/vids-public/:token/video.mp4 only for a token the package published for its owner (oshal-kernel docs/apps/package-anonymous-routes.md), and vids never published one, so every live link answered 404 "no such link". Proves, against the compiled routes/vids-routes.js under the native bridge's routing contract with a recording SQL double: publish hands the exact minted token to the seam after the row's COMMIT; a refused publish rolls the row back to unpublished (the rollback names the minted token) and answers 503 public_link_unavailable; re-publishing an already published export hands the same token over again; unpublish clears the row and then revokes the cleared token, and a refused revoke still answers 200; with no seam (the legacy core) nothing is called and publish/unpublish work from the row alone.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install): framework imports,
 * Express and Multer are doubles; the seam is a recording double because the kernel's host call cannot be
 * crossed from the store (crates/oshald/tests/anonymous_package_reads.rs crosses it in the kernel).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const JOB = '40000000-0000-4000-8000-000000000001';
const ARTIFACT = '40000000-0000-4000-8000-000000000011';
const OWNER = 'owner-a';

/** The native bridge's routing contract: use() paths are literal prefixes; method routes match :params per segment. */
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
      const hit = want.length === got.length && want.every((part, i) => part.startsWith(':') ? ((params[part.slice(1)] = got[i]), true) : part === got[i]);
      if (!hit) return next();
      req.params = params;
      return chain(layer.handlers, req, res, next);
    };
    next();
  };
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) router[method] = (p, ...handlers) => { stack.push({ method, path: p, handlers: handlers.flat() }); return router; };
  router.use = (p, ...handlers) => { if (typeof p === 'function') { handlers.unshift(p); p = '/'; } stack.push({ use: true, path: p, handlers: handlers.flat() }); return router; };
  return router;
}

/** Run handlers in order the way Express does, including asynchronous ones. */
function chain(handlers, req, res, done) {
  let i = 0;
  const step = (error) => {
    if (error) return done(error);
    const handler = handlers[i++];
    if (!handler) return done();
    try { Promise.resolve(handler(req, res, step)).catch(step); } catch (failure) { step(failure); }
  };
  step();
}

function multerDouble() {
  const multer = () => ({ single: () => (_req, _res, next) => next() });
  multer.diskStorage = (options) => options;
  multer.MulterError = class MulterError extends Error {};
  return multer;
}

const logged = [];
function load() {
  const stubs = {
    express: { Router: nativeRouter },
    multer: multerDouble(),
    '@/shared/logger': { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error(fields, message) { logged.push({ fields, message }); } }) },
    '@/app/routes/remote-client-routes': { remoteClientRegistry: { listClients: () => [] } },
    '@/shared/middleware/authz': { getCaller: (req) => ({ sub: req.sub }), getTrustedServiceUserSub: () => null },
    '@/shared/middleware/trusted-service-user-identity': { requireTrustedServiceUserIdentity: (_req, _res, next) => next() },
    '@/shared/services/database/request-identity': { runWithRequestIdentity: (_identity, fn) => fn() },
    '@/shared/middleware/multipart-identity': { preserveRequestIdentity: (handler) => handler },
  };
  const original = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    if (request.startsWith('@/')) throw new Error(`Unexpected framework import: ${request}`);
    return original.call(this, request, parent, isMain);
  };
  try { return require(path.join(PKG, 'routes', 'vids-routes.js')); } finally { Module._load = original; }
}

/** A complete MP4 container with a video track: the publish route re-reads and digests the attached file. */
function box(type, payload) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(header.length + payload.length, 0);
  header.write(type, 4, 4, 'ascii');
  return Buffer.concat([header, payload]);
}
function validMp4() {
  const ftyp = box('ftyp', Buffer.from('isom\0\0\0\0isomiso2', 'ascii'));
  const handler = Buffer.concat([Buffer.alloc(8), Buffer.from('vide', 'ascii'), Buffer.alloc(12)]);
  const moov = box('moov', box('trak', box('mdia', box('hdlr', handler))));
  return Buffer.concat([ftyp, moov, box('mdat', Buffer.from('video-data'))]);
}

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vids-public-link-'));
process.env.CLINE_WORKSPACE_ROOT = workspace;
fs.mkdirSync(path.join(workspace, 'vids-artifacts'), { recursive: true });
const bytes = validMp4();
fs.writeFileSync(path.join(workspace, 'vids-artifacts', `${ARTIFACT}.mp4`), bytes);
const SHA = crypto.createHash('sha256').update(bytes).digest('hex');
const { createVidsRoutes } = load();
test.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

/**
 * A recording SQL double over one finished job and its attached export. Every statement the artifact module
 * sends is answered from (and applied to) `state.row`; the order of statements and seam calls is kept in `events`.
 */
function sqlDouble() {
  const state = { row: { job_id: JOB, artifact_id: ARTIFACT, owner_sub: OWNER, sha256: SHA, byte_length: bytes.length, public_token: null, published_at: null }, events: [] };
  const owned = (values) => values[0] === JOB && values[1] === OWNER;
  async function query(text, values = []) {
    const sql = text.replace(/\s+/g, ' ').trim();
    state.events.push(sql);
    if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/.test(sql)) return { rows: [] };
    if (/SELECT status FROM vids_jobs/.test(sql)) return { rows: owned(values) ? [{ status: 'done' }] : [] };
    if (/SELECT \* FROM vids_artifacts/.test(sql)) return { rows: owned(values) ? [{ ...state.row }] : [] };
    if (/SELECT public_token FROM vids_artifacts/.test(sql)) return { rows: owned(values) ? [{ public_token: state.row.public_token }] : [] };
    if (/UPDATE vids_artifacts SET public_token=\$3,published_at=now\(\)/.test(sql)) {
      if (!owned(values)) return { rows: [] };
      state.row = { ...state.row, public_token: values[2], published_at: '2026-10-11T00:00:00.000Z' };
      return { rows: [{ ...state.row }] };
    }
    if (/UPDATE vids_artifacts SET public_token=NULL,published_at=NULL/.test(sql)) {
      if (!owned(values) || (/AND public_token=\$3/.test(sql) && state.row.public_token !== values[2])) return { rows: [] };
      state.row = { ...state.row, public_token: null, published_at: null };
      return { rows: [{ ...state.row }] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
  state.pool = { query, connect: async () => ({ query, release() {} }) };
  return state;
}

/** A recording seam double; `refuse` makes the named call reject the way the bridge rejects a kernel refusal. */
function seamDouble(state, refuse = {}) {
  const calls = [];
  const seam = {
    async publish(token) { calls.push(['publish', token]); state.events.push(`publish(${token})`); if (refuse.publish) throw new Error(refuse.publish); return { package: 'vids', changed: true }; },
    async revoke(token) { calls.push(['revoke', token]); state.events.push(`revoke(${token})`); if (refuse.revoke) throw new Error(refuse.revoke); return { package: 'vids', changed: true }; },
  };
  return { seam, calls };
}

/** One request through the router; resolves with the answer (or a 404 when no route matched). */
function call(router, method, url, body = {}) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(code) { this.statusCode = code; return this; },
      json(answer) { resolve({ status: this.statusCode, body: answer }); }, end() { resolve({ status: this.statusCode, body: null }); }, headersSent: false };
    router({ method, url, headers: {}, body, sub: OWNER, params: {} }, res, () => resolve({ status: 404, body: { error: 'No matching application route' } }));
  });
}

const publish = (router) => call(router, 'POST', `/jobs/${JOB}/artifact/publish`, { confirm: true, sha256: SHA });
const unpublish = (router) => call(router, 'POST', `/jobs/${JOB}/artifact/unpublish`, { confirm: true });
const index = (events, pattern) => events.findIndex((event) => pattern.test(event));

test('publish hands the exact minted token to the seam after the row commits, and again on a repeat publish', async () => {
  const state = sqlDouble();
  const { seam, calls } = seamDouble(state);
  const router = createVidsRoutes({ pool: state.pool, publicLinks: seam });
  const answer = await publish(router);
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  const token = state.row.public_token;
  assert.match(token, /^[a-f0-9]{64}$/, 'the row carries the minted 64-hex token');
  assert.equal(answer.body.artifact.publicUrl, `/api/vids-public/${token}/video.mp4`);
  assert.deepEqual(calls, [['publish', token]], 'the seam received exactly the minted token, once');
  const minted = index(state.events, /SET public_token=\$3/), committed = state.events.indexOf('COMMIT'), handed = index(state.events, /^publish\(/);
  assert.ok(minted >= 0 && minted < committed && committed < handed, `mint, COMMIT, then publish: ${state.events.join(' | ')}`);
  const again = await publish(router);
  assert.equal(again.status, 200);
  assert.equal(state.row.public_token, token, 'a repeat publish keeps the same token');
  assert.deepEqual(calls, [['publish', token], ['publish', token]], 'the same token is handed over again: one link, not two');
  assert.equal(calls.filter(([verb]) => verb === 'revoke').length, 0);
});

test('a refused publish leaves the row unpublished and answers 503 public_link_unavailable', async () => {
  const state = sqlDouble();
  const { seam, calls } = seamDouble(state, { publish: 'that link was published by someone else' });
  const router = createVidsRoutes({ pool: state.pool, publicLinks: seam });
  logged.length = 0;
  const answer = await publish(router);
  assert.equal(answer.status, 503);
  assert.deepEqual(answer.body, { error: 'public_link_unavailable' });
  assert.equal(calls.length, 1);
  const minted = calls[0][1];
  assert.match(minted, /^[a-f0-9]{64}$/);
  assert.equal(state.row.public_token, null, 'the row is unpublished again');
  assert.equal(state.row.published_at, null);
  const rollback = state.events.find((event) => /SET public_token=NULL,published_at=NULL WHERE job_id=\$1 AND owner_sub=\$2 AND public_token=\$3/.test(event));
  assert.ok(rollback, `the rollback clears only the minted token: ${state.events.join(' | ')}`);
  assert.ok(index(state.events, /^publish\(/) < state.events.indexOf(rollback), 'the rollback follows the refusal');
  assert.equal(logged.length, 1, 'the refusal is logged once at error');
  assert.equal(logged[0].fields.err.message, 'that link was published by someone else');
  const record = await call(router, 'GET', `/jobs/${JOB}/artifact`);
  assert.equal(record.body.artifact.publicUrl, null, 'the owner is not shown a link the kernel will never serve');
});

test('unpublish clears the row and then revokes the cleared token; a refused revoke is logged, not fatal', async () => {
  const state = sqlDouble();
  const { seam, calls } = seamDouble(state);
  const router = createVidsRoutes({ pool: state.pool, publicLinks: seam });
  await publish(router);
  const token = state.row.public_token;
  const answer = await unpublish(router);
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.equal(answer.body.artifact.publicUrl, null);
  assert.equal(state.row.public_token, null);
  assert.deepEqual(calls, [['publish', token], ['revoke', token]], 'the seam revokes exactly the token the row carried');
  assert.ok(state.events.lastIndexOf('COMMIT') < index(state.events, /^revoke\(/), 'the row is cleared before the kernel is told');

  const refused = sqlDouble();
  const refusing = seamDouble(refused, { revoke: 'this call was admitted to read, so it cannot publish a link' });
  const refusingRouter = createVidsRoutes({ pool: refused.pool, publicLinks: refusing.seam });
  await publish(refusingRouter);
  const cleared = refused.row.public_token;
  logged.length = 0;
  const still = await unpublish(refusingRouter);
  assert.equal(still.status, 200, 'the owner\'s revoke succeeds: the row no longer serves');
  assert.equal(refused.row.public_token, null);
  assert.deepEqual(refusing.calls.at(-1), ['revoke', cleared]);
  assert.equal(logged.length, 1);
  assert.match(logged[0].message, /withdrawal refused/);
});

test('with no seam (the legacy core) nothing is called and publish and unpublish work from the row alone', async () => {
  for (const publicLinks of [undefined, null, {}, { publish: 'not a function' }]) {
    const state = sqlDouble();
    const router = createVidsRoutes({ pool: state.pool, publicLinks });
    const answer = await publish(router);
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.match(state.row.public_token, /^[a-f0-9]{64}$/);
    assert.equal(answer.body.artifact.publicUrl, `/api/vids-public/${state.row.public_token}/video.mp4`);
    const revoked = await unpublish(router);
    assert.equal(revoked.status, 200);
    assert.equal(state.row.public_token, null);
    assert.deepEqual(state.events.filter((event) => /^(publish|revoke)\(/.test(event)), [], `no seam call for ${JSON.stringify(publicLinks)}`);
  }
});

test('the unpublish of an export that was never published tells the seam nothing', async () => {
  const state = sqlDouble();
  const { seam, calls } = seamDouble(state);
  const router = createVidsRoutes({ pool: state.pool, publicLinks: seam });
  const answer = await unpublish(router);
  assert.equal(answer.status, 200);
  assert.deepEqual(calls, [], 'no token was cleared, so nothing is withdrawn');
});
