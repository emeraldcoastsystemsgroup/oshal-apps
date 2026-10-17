/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | "How much did I spend on restaurants last month?" from Jarvis: the finance-analyst had only finance_facts and said it could not query transactions. finance-summary is a read route tool onto GET /api/finance/summary that the persona authorizes and is told to call for spending; through the compiled route it answers the caller's own saved aggregate (categorized transactions included), 404 with nothing synced, and 401 for no caller, never another person's row.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const manifest = fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8');
const persona = fs.readFileSync(path.join(ROOT, 'personas', 'finance-analyst.yaml'), 'utf8');

/** The compiled route module with every framework import stubbed; routes recorded by method and path. */
function load(rows) {
  const routes = {};
  const router = new Proxy({}, { get: (_t, method) => (p, ...h) => { routes[`${String(method).toUpperCase()} ${p}`] = h[h.length - 1]; } });
  const original = Module._load;
  Module._load = function stubbed(request, ...rest) {
    if (request === 'express') return { Router: () => router, raw: () => () => {}, json: () => () => {} };
    if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
    if (request === '@/shared/services/database') return { runRuntimeSchemaBootstrap: async () => {}, buildOwnerRlsPolicyStatements: () => [] };
    if (request.startsWith('@/')) return new Proxy({}, { get: () => function stub() { return {}; } });
    return original.call(this, request, ...rest);
  };
  const file = path.join(ROOT, 'routes', 'finance-routes.js');
  delete require.cache[file];
  let mod;
  try { mod = require(file); } finally { Module._load = original; }
  const pool = { asked: [], async query(text, params = []) {
    this.asked.push(params);
    if (/FROM oshal_finance_data WHERE user_sub = \$1/.test(text)) return { rows: rows.filter((r) => r.user_sub === params[0]) };
    return { rows: [] };
  } };
  mod.createFinanceRoutes({ pool, appPackageDir: ROOT });
  return { routes, pool };
}

async function get(routes, sub) {
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; return this; } };
  await routes['GET /summary']({ oidc: sub ? { user: { sub } } : {}, query: {}, params: {} }, res);
  return res;
}

const ROWS = [
  { user_sub: 'person-a', synced_at: '2026-10-15T00:00:00Z', aggregate: { topSpending: [{ category: 'FOOD_AND_DRINK', amount: 212.5 }], recentTransactions: [{ name: 'Taco Bar', category: 'FOOD_AND_DRINK', amount: 18 }] } },
  { user_sub: 'person-b', synced_at: '2026-10-15T00:00:00Z', aggregate: { topSpending: [{ category: 'TRAVEL', amount: 900 }] } },
];

test('finance-summary is an automatic read tool onto GET /api/finance/summary, authorized and called for spending', () => {
  const block = manifest.slice(manifest.indexOf('  - name: finance-summary\n'));
  assert.match(block, /apiEndpoint: "GET \/api\/finance\/summary"/);
  assert.match(block, /defaultAuthMode: auto\n    requiresApproval: false/);
  assert.match(persona, /\n  finance-summary: "auto"\n/);
  assert.match(persona, /call finance-summary with \{\}/);
});

test('the compiled route answers the caller\'s own aggregate with its categorized transactions', async () => {
  const { routes } = load(ROWS);
  const res = await get(routes, 'person-a');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.aggregate.topSpending[0].category, 'FOOD_AND_DRINK');
  assert.equal(res.body.aggregate.recentTransactions[0].name, 'Taco Bar');
  assert.doesNotMatch(JSON.stringify(res.body), /TRAVEL/, 'never another person\'s row');
});

test('nothing synced is 404 and no caller is 401', async () => {
  const { routes, pool } = load(ROWS);
  assert.equal((await get(routes, 'person-z')).statusCode, 404);
  const before = pool.asked.length;
  assert.equal((await get(routes, null)).statusCode, 401);
  assert.equal(pool.asked.length, before, 'no query runs without a caller');
});
