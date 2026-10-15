/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | GET /home-summary refused a person who holds this application's own administrator
 *   role (the kernel's @app-admin for a catalog-less app) with 403 "Operator access required", because only the
 *   kernel-operator flag was read. The compiled route is driven with the kernel's two answers - auth.caller's operator
 *   flag and auth.application's roles - and must admit the operator and the application administrator, refuse a caller
 *   with neither, and keep the operator-only rule on a host that reports no application roles.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const COMPILED = path.resolve(__dirname, '../routes/home-summary.js');

/** @description Load the compiled route with an express stand-in and the given operator answer; return its GET handler. */
function handler(operator, ctx) {
  let get = null;
  const subject = new Module(COMPILED, module);
  subject.filename = COMPILED;
  subject.require = (request) => {
    if (request === 'express') return { Router: () => ({ get: (_p, h) => { get = h; } }) };
    if (request === '@/shared/middleware/authz') return { isOperator: () => operator };
    return require(request);
  };
  subject._compile(fs.readFileSync(COMPILED, 'utf8'), COMPILED);
  subject.exports.createHomeSummaryRoutes(ctx);
  return get;
}

/** @description Answer one GET as an authenticated person. */
async function call(operator, ctx) {
  const reply = { status: 200, body: null };
  const res = {
    setHeader() {},
    status(code) { reply.status = code; return res; },
    json(body) { reply.body = body; return res; },
  };
  await handler(operator, ctx)({ oidc: { isAuthenticated: () => true, user: { sub: 'ideator-person' } } }, res);
  return reply;
}

const pool = { query: async (q) => ({ rows: /count\(\*\)/.test(q.text) ? [{ running: '0', review: '0', completed: '0' }] : [] }) };
const withRoles = (roles, asked = []) => ({ pool, intent: async (name, input) => { asked.push([name, input]); return { roles }; } });

test('a holder of the application administrator role is admitted', async () => {
  const asked = [];
  const reply = await call(false, withRoles(['@app-admin'], asked));
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  assert.ok(Array.isArray(reply.body.metrics));
  assert.deepEqual(asked, [['auth.application', {}]]);
});

test('the kernel operator is admitted without asking for application roles', async () => {
  const asked = [];
  assert.equal((await call(true, withRoles([], asked))).status, 200);
  assert.deepEqual(asked, []);
});

test('a caller with neither is refused', async () => {
  const reply = await call(false, withRoles(['member']));
  assert.equal(reply.status, 403);
  assert.deepEqual(reply.body, { error: 'Operator access required' });
});

test('a host that reports no application roles keeps the operator-only rule', async () => {
  assert.equal((await call(false, { pool })).status, 403);
  assert.equal((await call(true, { pool })).status, 200);
});
