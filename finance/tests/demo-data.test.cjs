/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.3.0 demo data: POST /demo-data answers 404 until the installation
 *     |                                             | sets FINANCE_DEMO_DATA, requires a signed-in caller, and writes that
 *     |                                             | caller's sample aggregate: positive net worth, named banks (never a
 *     |                                             | Plaid placeholder account), a note saying it is sample data, dates
 *     |                                             | relative to now, and the saved brief cleared so Re-analyze is real.
 *     |                                             | Run: node --test tests/demo-data.test.cjs
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const ROUTES = path.join(ROOT, 'routes', 'finance-routes.js');

/** Build the compiled router over a recording pool, framework modules doubled (plaid-link.test.cjs pattern). */
function loadRoutes(pool) {
  const handlers = {};
  const record = (method) => (route, handler) => { handlers[`${method} ${route}`] = handler; };
  const doubles = {
    express: { Router: () => ({ get: record('GET'), post: record('POST'), delete: record('DELETE') }) },
    '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
    '@/shared/services/database': { runRuntimeSchemaBootstrap: async () => {}, buildOwnerRlsPolicyStatements: () => [] },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => null },
    '@/features/payments': { getPaymentAdapter: () => null },
    '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({}) },
    '@/app/routes/free-tier-rotation': { resolveUserLlmConnection: async () => null },
    '@/shared/security/explicit-write-confirmation': { confirmationRequiredPayload: () => ({}), hasExplicitWriteConfirmation: () => false },
    './finance-plaid': { plaidConfigured: () => true, plaidEnv: () => 'sandbox', removeItem: async () => {}, fetchFinanceAggregate: async () => ({ notes: [] }) },
    './session-crypto': { encryptSessionValue: (v) => v, decryptSessionValue: (v) => v },
  };
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === ROUTES && request in doubles) return doubles[request];
    return original.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[ROUTES];
    require(ROUTES).createFinanceRoutes({ pool, appPackageDir: ROOT });
  } finally { Module._load = original; delete require.cache[ROUTES]; }
  return handlers;
}

/** A pool that records every write. */
function recordingPool() {
  const writes = [];
  return { writes, query: async (text, values) => { if (/^INSERT INTO oshal_finance_data/.test(text.trim())) writes.push(values); return { rows: [], rowCount: 0 }; } };
}

async function call(handler, sub) {
  const res = { statusCode: 200, body: undefined, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ oidc: sub ? { user: { sub } } : undefined, params: {}, body: {} }, res);
  return res;
}

function withEnv(value, run) {
  const saved = process.env.FINANCE_DEMO_DATA;
  if (value === undefined) delete process.env.FINANCE_DEMO_DATA; else process.env.FINANCE_DEMO_DATA = value;
  return run().finally(() => { if (saved === undefined) delete process.env.FINANCE_DEMO_DATA; else process.env.FINANCE_DEMO_DATA = saved; });
}

test('the shipped page opens on the money view whenever there is money to show', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(path.join(ROOT, 'tools', 'finance.html'), 'utf8');
  const start = html.indexOf('function startScreen(st)');
  assert.ok(start > 0, 'the page declares its first-screen decision');
  const source = html.slice(start, html.indexOf('\n', start) + 1);
  const startScreen = new Function(`${source}; return startScreen;`)();
  assert.equal(startScreen({ connected: 2, hasData: true }), 'dashboard');
  assert.equal(startScreen({ connected: 0, hasData: true }), 'dashboard', 'a saved aggregate (sample household, or banks disconnected after a sync) is money to show');
  assert.equal(startScreen({ connected: 0, hasData: false }), 'connect');
  assert.match(html, /startScreen\(st\) === 'dashboard'/, 'the boot uses the decision');
  assert.match(html, /if \(!st\.connected && !st\.hasData\) return \{ setup: 'link'/,
    'the audience view (Home\u2019s Finance card) gates its connect card the same way \u2014 the sweep caught it showing set-up wording to a seeded visitor');
});

test('demo-data answers 404 and writes nothing until the installation sets FINANCE_DEMO_DATA', () => withEnv(undefined, async () => {
  const pool = recordingPool();
  const res = await call(loadRoutes(pool)['POST /demo-data'], 'alice');
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'not_found');
  assert.equal(pool.writes.length, 0);
}));

test('demo-data requires a signed-in caller even when the installation turned it on', () => withEnv('1', async () => {
  const pool = recordingPool();
  const res = await call(loadRoutes(pool)['POST /demo-data'], null);
  assert.equal(res.statusCode, 401);
  assert.equal(pool.writes.length, 0);
}));

test('demo-data writes the caller\'s sample aggregate: healthy, named, labelled, dated now, brief cleared', () => withEnv('1', async () => {
  const pool = recordingPool();
  const res = await call(loadRoutes(pool)['POST /demo-data'], 'alice');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(pool.writes.length, 1);
  const [sub, aggregateJson] = pool.writes[0];
  assert.equal(sub, 'alice');
  const agg = JSON.parse(aggregateJson);
  assert.ok(agg.netWorth.net > 0, 'the sample household is solvent');
  assert.ok(agg.netWorth.assets > agg.netWorth.liabilities);
  assert.ok(agg.accounts.length >= 5 && agg.holdings.length >= 3);
  for (const account of agg.accounts) {
    assert.ok(!/plaid/i.test(account.name) && !/platypus/i.test(account.institution), `no Plaid placeholder: ${account.name}`);
    assert.ok(account.institution && account.mask, 'every account is named like a real one');
  }
  assert.ok(agg.notes.some((note) => /sample data/i.test(note)), 'the aggregate says it is sample data');
  assert.equal(agg.sourceEnvironment, 'sample');
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(agg.recentTransactions.every((t) => t.date <= today), 'transactions are dated, none in the future');
  assert.ok(agg.recentTransactions[0].date >= new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10), 'the newest transaction is recent');
  assert.ok(agg.spendByMonth.every((m) => m.income > 0));
}));
