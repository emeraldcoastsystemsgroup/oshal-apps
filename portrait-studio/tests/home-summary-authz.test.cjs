/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Guard Portrait Studio's home-summary pre-read and post-read authorization checks so unauthorized callers cannot trigger database queries before 403.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROUTE_FILE = path.resolve(__dirname, '../routes/home-summary.js');

function loadSummaryHandler({ actor, authorize, query }) {
  let handler = null;
  const mod = { exports: {} };
  const source = fs.readFileSync(ROUTE_FILE, 'utf8');
  new Function('require', 'module', 'exports', source)(
    (name) => {
      assert.equal(name, 'express');
      return { Router: () => ({ get: (_, fn) => { handler = fn; } }) };
    },
    mod,
    mod.exports,
  );
  mod.exports.createHomeSummaryRoutes({
    pool: { query },
    authorization: { currentActor: () => actor, authorize },
  });
  return async () => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; },
    };
    await handler({}, res);
    return res;
  };
}

test('home-summary rejects missing permission with 403 before running any database query', async () => {
  let queries = 0;
  const call = loadSummaryHandler({
    actor: { sub: 'alice', issuer: 'https://idp.test', isActive: true },
    authorize: async ({ permission }) => ({ allowed: permission !== 'portrait.read' }),
    query: async () => { queries += 1; return { rows: [] }; },
  });
  const res = await call();
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'portrait_permission_denied');
  assert.equal(queries, 0, 'unauthorized caller must not trigger any database read');
});

test('home-summary still rejects mid-request permission revocation after reading', async () => {
  let calls = 0;
  let queries = 0;
  const call = loadSummaryHandler({
    actor: { sub: 'alice', issuer: 'https://idp.test', isActive: true },
    authorize: async () => { calls += 1; return { allowed: calls <= 2 }; },
    query: async () => { queries += 1; return { rows: [] }; },
  });
  const res = await call();
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'portrait_permission_denied');
  assert.equal(queries, 2);
});

test('home-summary returns 200 for an active permitted owner and 401 for an inactive actor', async () => {
  let queries = 0;
  const inactive = loadSummaryHandler({
    actor: { sub: 'alice', issuer: 'https://idp.test', isActive: false },
    authorize: async () => ({ allowed: true }),
    query: async () => { queries += 1; return { rows: [] }; },
  });
  assert.equal((await inactive()).statusCode, 401);
  assert.equal(queries, 0);

  const permitted = loadSummaryHandler({
    actor: { sub: 'alice', issuer: 'https://idp.test', isActive: true },
    authorize: async () => ({ allowed: true }),
    query: async () => { queries += 1; return { rows: [] }; },
  });
  const ok = await permitted();
  assert.equal(ok.statusCode, 200);
  assert.equal(queries, 2);
  assert.equal(ok.headers['Cache-Control'], 'no-store');
});
