/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-31 18:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Behavioral guard for the Stage route's send gates: POST /broadcast without confirm:true is 428 and the publisher is NEVER invoked; a workspace-mismatched broadcast is 403 with zero sends; a confirmed broadcast submits once per channel through the compose publishTo and one throwing channel never blocks the rest. Exercises the COMPILED route handler with stubbed framework modules — asserts CALLS, not substrings.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install). The
 * compiled routes/switchboard-stage-routes.js is loaded with a module shim: framework
 * imports (@/…, express) are stubbed, the sibling compose module is replaced by a recording
 * publishTo, and the fan-out module is the REAL compiled pure module — so the handler under
 * test is the exact bytes the framework mounts.
 *
 * Why these are the tests that matter: Stage's only dangerous power is posting to live
 * accounts. The regressions that hurt are (a) a refactor that sends before (or without)
 * the explicit-write confirmation, and (b) the workspace guard or channel isolation
 * silently dropping out of the handler path.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const ROUTE_FILE = path.join(PKG, 'routes', 'switchboard-stage-routes.js');
const realFanout = require(path.join(PKG, 'routes', 'switchboard-stage-fanout.js'));

/** Load the compiled stage route module with stubbed framework requires; returns handlers + spies. */
function loadStageModule(opts) {
  const publishCalls = [];
  const publishTo = opts.publishTo || (async (_ctx, _sub, platform, text) => { publishCalls.push([platform, text]); return { ok: true, target: platform }; });
  const handlers = { get: new Map(), post: new Map() };
  const fakeRouter = {
    get(p, h) { handlers.get.set(p, h); return this; },
    post(p, h) { handlers.post.set(p, h); return this; },
    use() { return this; },
  };
  const stubs = {
    express: { Router: () => fakeRouter },
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
    // Mirrors the framework helper's exact semantics: only a literal confirm === true passes.
    '@/shared/security/explicit-write-confirmation': {
      hasExplicitWriteConfirmation: (body) => !!body && typeof body === 'object' && body.confirm === true,
      confirmationRequiredPayload: (guard, action) => ({ error: 'confirmation_required', guard, message: `${action} requires confirm: true. No write was attempted.` }),
    },
    './switchboard-compose-routes': {
      publishTo: (ctx, sub, platform, text) => publishTo(ctx, sub, platform, text, publishCalls),
      platformProviders: (p) => {
        if (p === 'x' || p === 'twitter') return ['twitter'];
        if (p === 'linkedin') return ['linkedin'];
        return ['meta-business', 'facebook'];
      },
      PLATFORMS: {
        x: { limit: 280, provider: 'twitter', label: 'X' },
        twitter: { limit: 280, provider: 'twitter', label: 'X' },
        linkedin: { limit: 3000, provider: 'linkedin', label: 'LinkedIn' },
        facebook: { limit: 63206, provider: 'meta-business', label: 'Facebook' },
      },
      PUBLISHABLE: new Set(['x', 'twitter', 'linkedin', 'facebook']),
    },
    './switchboard-stage-fanout': realFanout, // the REAL compiled fan-out — no re-implementation
  };
  const shimRequire = (id) => {
    if (id === 'path') return path;
    if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
    throw new Error(`unexpected require in stage route module: ${id}`);
  };
  const code = fs.readFileSync(ROUTE_FILE, 'utf8');
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', code)(
    shimRequire, mod, mod.exports, ROUTE_FILE, path.dirname(ROUTE_FILE),
  );
  const ctx = {
    pool: { query: opts.query || (async () => ({ rows: [], rowCount: 0 })) },
    appPackageDir: PKG,
  };
  mod.exports.createStageRoutes(ctx);
  return { handlers, publishCalls };
}

/** A minimal recording Express response. */
function fakeRes() {
  return {
    statusCode: 200, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
  };
}

function authedReq(body) {
  return { oidc: { user: { sub: 'user-1' } }, body, query: {}, params: {} };
}

test('the compiled module wires GET / and POST /broadcast', () => {
  const { handlers } = loadStageModule({});
  assert.ok(handlers.get.has('/'), 'surface route missing');
  assert.ok(handlers.post.has('/broadcast'), 'broadcast route missing');
});

test('NOTHING sends without the explicit per-send confirm: 428 and zero publisher calls', async () => {
  const { handlers, publishCalls } = loadStageModule({});
  const res = fakeRes();
  await handlers.post.get('/broadcast')(
    authedReq({ posts: [{ platform: 'x', text: 'hello' }, { platform: 'linkedin', text: 'hello' }] }), res,
  );
  assert.equal(res.statusCode, 428);
  assert.equal(res.body.error, 'confirmation_required');
  assert.equal(publishCalls.length, 0, 'the publisher must never be invoked without confirm');
});

test('confirm must be the literal true — truthy strings do not send', async () => {
  const { handlers, publishCalls } = loadStageModule({});
  const res = fakeRes();
  await handlers.post.get('/broadcast')(
    authedReq({ posts: [{ platform: 'x', text: 'hello' }], confirm: 'yes' }), res,
  );
  assert.equal(res.statusCode, 428);
  assert.equal(publishCalls.length, 0);
});

test('unauthenticated → 401 and zero publisher calls', async () => {
  const { handlers, publishCalls } = loadStageModule({});
  const res = fakeRes();
  await handlers.post.get('/broadcast')({ oidc: {}, body: { posts: [{ platform: 'x', text: 'hi' }], confirm: true } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(publishCalls.length, 0);
});

test('a confirmed broadcast submits ONCE per channel through the compose publish path', async () => {
  const { handlers, publishCalls } = loadStageModule({});
  const res = fakeRes();
  await handlers.post.get('/broadcast')(
    authedReq({ posts: [{ platform: 'x', text: 'tweet text' }, { platform: 'linkedin', text: 'post text' }], confirm: true }), res,
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(publishCalls, [['x', 'tweet text'], ['linkedin', 'post text']]);
  assert.deepEqual(res.body.summary, { total: 2, sent: 2, failed: 0 });
});

test('one throwing channel never blocks the rest of a confirmed broadcast', async () => {
  const { handlers, publishCalls } = loadStageModule({
    publishTo: async (_ctx, _sub, platform, text, calls) => {
      calls.push([platform, text]);
      if (platform === 'x') throw new Error('vendor 500');
      return { ok: true, target: platform };
    },
  });
  const res = fakeRes();
  await handlers.post.get('/broadcast')(
    authedReq({ posts: [{ platform: 'x', text: 'a' }, { platform: 'linkedin', text: 'b' }, { platform: 'facebook', text: 'c' }], confirm: true }), res,
  );
  assert.equal(res.statusCode, 200, 'partial success is a 200 with per-channel results');
  assert.equal(publishCalls.length, 3, 'later channels must still submit');
  assert.equal(res.body.results[0].ok, false);
  assert.equal(res.body.results[1].ok, true);
  assert.equal(res.body.results[2].ok, true);
  assert.deepEqual(res.body.summary, { total: 3, sent: 2, failed: 1 });
});

test('every channel failing → 502, with the per-channel errors reported', async () => {
  const { handlers } = loadStageModule({
    publishTo: async (_ctx, _sub, platform, _text, calls) => { calls.push(platform); return { ok: false, error: 'no_connection' }; },
  });
  const res = fakeRes();
  await handlers.post.get('/broadcast')(
    authedReq({ posts: [{ platform: 'x', text: 'a' }, { platform: 'linkedin', text: 'b' }], confirm: true }), res,
  );
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body.summary, { total: 2, sent: 0, failed: 2 });
});

test('a workspace that excludes a channel refuses the WHOLE broadcast before any send', async () => {
  const { handlers, publishCalls } = loadStageModule({
    query: async () => ({ rows: [{ provider: 'linkedin' }], rowCount: 1 }), // the desk holds only LinkedIn
  });
  const res = fakeRes();
  await handlers.post.get('/broadcast')(
    authedReq({ posts: [{ platform: 'linkedin', text: 'a' }, { platform: 'x', text: 'b' }], workspaceId: '11111111-2222-3333-4444-555555555555', confirm: true }), res,
  );
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'workspace_mismatch');
  assert.equal(publishCalls.length, 0, 'a mismatched broadcast must send nothing at all');
});

test('an invalid broadcast (duplicate channel via the twitter alias) is 400 and sends nothing', async () => {
  const { handlers, publishCalls } = loadStageModule({});
  const res = fakeRes();
  await handlers.post.get('/broadcast')(
    authedReq({ posts: [{ platform: 'x', text: 'a' }, { platform: 'twitter', text: 'b' }], confirm: true }), res,
  );
  assert.equal(res.statusCode, 400);
  assert.equal(publishCalls.length, 0);
});
