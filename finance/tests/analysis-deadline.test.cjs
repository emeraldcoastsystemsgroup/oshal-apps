/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.6.4: Request analysis answers before the native kernel ends a package request at 60 seconds (host CALL_DEADLINE). The judge pressed it twice on blue and read "HTTP 503" after 60 s, nothing saved. A silent analyst now gives 504 analysis_timeout in words, a slow first answer is not followed by a rewrite the deadline cannot hold, and a refused analyst gives 502 analyst_unavailable in words. The saved analysis is unchanged in every failure.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const ROUTES = path.join(ROOT, 'routes', 'finance-routes.js');
/** The native kernel ends an ordinary package call here (kernel crates/host-process/src/host.rs CALL_DEADLINE). */
const KERNEL_CUT_MS = 60_000;
const PENDING = Symbol('still waiting when the kernel cuts the request');
const EARLIER = { brief: '## Earlier analysis\nSaved before.', brief_at: '2026-11-12T19:05:00.000Z' };

/** One synthetic household: two accounts, so the quotable amounts are known. */
function aggregate() {
  return { generatedAt: '2026-11-13T00:00:00Z', currency: 'USD', netWorth: { assets: 1500, liabilities: 0, net: 1500 },
    accounts: [{ name: 'Everyday', type: 'depository', balance: 1000, currency: 'USD', institution: 'Example Bank' },
      { name: 'Savings', type: 'depository', balance: 500, currency: 'USD', institution: 'Example Bank' }],
    holdings: [], topSpending: [], spendByMonth: [], recentTransactions: [], transactionWindowDays: 90, notes: [],
    transactionsComplete: true, transactionCoverage: { state: 'complete', returned: 0, total: 0, institutions: [] } };
}

/** A pool double that records statements and keeps the one saved row. */
function financePool() {
  const pool = { statements: [], data: { aggregate: aggregate(), ...EARLIER },
    async query(text, values = []) {
      pool.statements.push(text);
      if (/^\s*UPDATE oshal_finance_data SET brief/.test(text)) {
        if (JSON.stringify(pool.data.aggregate) !== values[2]) return { rows: [], rowCount: 0 };
        pool.data.brief = values[1]; pool.data.brief_at = '2026-11-13T21:00:30.000Z';
        return { rows: [{ brief_at: pool.data.brief_at }], rowCount: 1 };
      }
      return { rows: [structuredClone(pool.data)], rowCount: 1 };
    } };
  return pool;
}

/** The compiled router with the bridge's modules replaced; `analyst(text, n)` answers the nth analyst turn. */
function loadRoutes(pool, analyst) {
  const handlers = {}, prompts = [];
  const record = (method) => (route, handler) => { handlers[`${method} ${route}`] = handler; };
  const doubles = {
    express: { Router: () => ({ get: record('GET'), post: record('POST'), delete: record('DELETE') }) },
    '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
    '@/shared/services/database': { runRuntimeSchemaBootstrap: async () => {}, buildOwnerRlsPolicyStatements: () => [] },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => null },
    '@/features/payments': { getPaymentAdapter: () => { throw new Error('no rail'); } },
    '@/app/routes/inline-bot-execution': { executeBotOrInline: async (_c, _b, _a, request) => { prompts.push(request.text); return { response: await analyst(request.text, prompts.length) }; } },
    '@/app/routes/free-tier-rotation': { resolveUserLlmConnection: async () => null },
    '@/shared/security/explicit-write-confirmation': { confirmationRequiredPayload: () => ({}), hasExplicitWriteConfirmation: () => false },
  };
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === ROUTES && request in doubles) return doubles[request];
    return original.call(this, request, parent, isMain);
  };
  try { delete require.cache[ROUTES]; require(ROUTES).createFinanceRoutes({ pool, appPackageDir: ROOT }); }
  finally { Module._load = original; delete require.cache[ROUTES]; }
  return { refresh: handlers['POST /brief/refresh'], prompts };
}

/** Press Request analysis as a signed-in person; the clock is simulated, so time passes only through `advance`. */
function press(refresh) {
  const res = { statusCode: 200, body: undefined, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  return refresh({ method: 'POST', oidc: { user: { sub: 'alice' }, isAuthenticated: () => true }, params: {}, query: {}, body: {} }, res).then(() => res);
}
const turn = () => new Promise((resolve) => setImmediate(resolve));
/** Let simulated seconds pass up to the kernel's cut; the answer, or PENDING when the request is still open then. */
async function byTheKernelCut(t, answering) {
  let settled = PENDING;
  answering.then((res) => { settled = res; });
  for (let second = 0; second < KERNEL_CUT_MS / 1000 && settled === PENDING; second += 1) {
    for (let i = 0; i < 5; i += 1) await turn();
    t.mock.timers.tick(1000);
  }
  for (let i = 0; i < 5; i += 1) await turn();
  return settled;
}
const slow = (ms, text) => () => new Promise((resolve) => setTimeout(() => resolve(text), ms));
const updates = (pool) => pool.statements.filter((s) => /^\s*UPDATE/.test(s));

test('a silent analyst: Request analysis answers in words before the kernel cut and keeps the earlier analysis', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-13T21:00:00Z') });
  const pool = financePool();
  const { refresh, prompts } = loadRoutes(pool, () => new Promise(() => {}));
  const res = await byTheKernelCut(t, press(refresh));
  assert.notEqual(res, PENDING, 'at 60 seconds the kernel ends the request and the page reads a bare HTTP 503');
  assert.equal(res.statusCode, 504);
  assert.equal(res.body.error, 'analysis_timeout');
  assert.match(res.body.message, /did not answer within 45 seconds, so nothing was saved/);
  assert.match(res.body.message, /earlier analysis, if any, is unchanged/);
  assert.equal(prompts.length, 1);
  assert.deepEqual(updates(pool), [], 'nothing is saved');
  assert.equal(pool.data.brief, EARLIER.brief);
});

test('a slow first answer is saved without a rewrite the deadline cannot hold; unmatched sentences are left out', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-13T21:00:00Z') });
  const pool = financePool();
  const { refresh, prompts } = loadRoutes(pool, slow(35_000, 'Your savings hold $500. You also have $9,999 elsewhere.'));
  const res = await byTheKernelCut(t, press(refresh));
  assert.notEqual(res, PENDING, 'two 35-second turns run past the 60-second cut');
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(prompts.length, 1, 'no rewrite is asked with 10 seconds of the budget left');
  assert.match(res.body.brief, /Your savings hold \$500\./);
  assert.doesNotMatch(res.body.brief, /9,999/);
  assert.match(res.body.brief, /1 statement was left out because it did not match your saved accounts/);
  assert.equal(updates(pool).length, 1);
  assert.equal(pool.data.brief, res.body.brief);
});

test('a quick answer that states an unlisted amount is still asked once to rewrite', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-13T21:00:00Z') });
  const pool = financePool();
  const answers = ['You hold $9,999.', 'Your savings hold $500.'];
  const { refresh, prompts } = loadRoutes(pool, (_text, n) => new Promise((resolve) => setTimeout(() => resolve(answers[n - 1]), 5_000)));
  const res = await byTheKernelCut(t, press(refresh));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(prompts.length, 2);
  assert.match(res.body.brief, /Your savings hold \$500\.$/);
});

test('a refused analyst reads in words and keeps the earlier analysis', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-13T21:00:00Z') });
  const pool = financePool();
  const { refresh } = loadRoutes(pool, () => Promise.reject(new Error('Inline bot execution refused or returned an empty response')));
  const res = await byTheKernelCut(t, press(refresh));
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, 'analyst_unavailable');
  assert.match(res.body.message, /^Your finance analyst could not answer just now, so nothing was saved\./);
  assert.doesNotMatch(res.body.message, /Inline bot execution/);
  assert.deepEqual(updates(pool), []);
});
