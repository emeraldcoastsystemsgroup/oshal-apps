/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Re-analyze is a write: GET /brief only reads the saved brief (even with ?refresh=1) and never runs the analyst or issues a mutation; POST /brief/refresh runs the analyst and saves the brief. The pool double refuses any mutation during a GET with the native kernel's own refusal text (crates/packages/src/sql_transaction.rs, "SQL mutation requires original writer admission"), which is what Re-analyze answered live. The brief and review prompts carry exact totals: the Plaid Sandbox accounts the review mis-added ($120,660.84 "liquid") give cash and deposits $62,589 and total assets $86,541.74. A missing payment rail names Connections and Payments, never STRIPE_SECRET_KEY. The page reads with GET, re-analyzes with POST and shows "No saved analysis" as a notice. Run: node --test tests/brief-refresh.test.cjs
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The prompt forbids naming VERIFIED TOTALS or field names in the brief (the live brief had said "sourced directly from VERIFIED TOTALS").
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Sweep 11: the saved brief is the code-written figures section followed by the analyst's commentary; the refresh prompt hands the analyst the figures and the amounts it may quote (tests/brief-figures.test.cjs proves the figure check). The advisory review keeps its VERIFIED TOTALS prompt.
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const ROUTES = path.join(ROOT, 'routes', 'finance-routes.js');
const KERNEL_READ_REFUSAL = 'refused: SQL mutation requires original writer admission';

/** The Plaid Sandbox institution's accounts as the aggregate stores them (the live review's data). */
const SANDBOX_ACCOUNTS = [
  ['Plaid Checking', 'depository', 110], ['Plaid Saving', 'depository', 210], ['Plaid CD', 'depository', 1000],
  ['Plaid Credit Card', 'credit', 410], ['Plaid Money Market', 'depository', 43200], ['Plaid IRA', 'investment', 320.76],
  ['Plaid 401k', 'investment', 23631.98], ['Plaid Student Loan', 'loan', 65262], ['Plaid Mortgage', 'loan', 56302.06],
  ['Plaid HSA', 'depository', 6009], ['Plaid Cash Management', 'depository', 12060], ['Plaid Business Credit Card', 'credit', 5020],
].map(([name, type, balance]) => ({ name, type, subtype: null, mask: null, balance, currency: 'USD', institution: 'First Platypus Bank' }));

function aggregate() {
  return { generatedAt: '2026-10-12T00:00:00Z', currency: 'USD', netWorth: { assets: 86541.74, liabilities: 126994.06, net: -40452.32 },
    accounts: SANDBOX_ACCOUNTS, holdings: [{ name: 'Fund', value: 1000.1 }, { name: 'Stock', value: 2000.2 }], topSpending: [], spendByMonth: [],
    recentTransactions: [], transactionWindowDays: 90, notes: [] };
}

/**
 * A pool double with the native kernel's admission rule: while the current request is a read (GET),
 * any INSERT/UPDATE/DELETE is refused exactly as the kernel refuses it.
 */
function financePool(row) {
  const pool = {
    mode: 'GET', statements: [], data: row,
    async query(text, values = []) {
      pool.statements.push({ mode: pool.mode, text, values });
      if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(text)) {
        if (pool.mode === 'GET') throw new Error(KERNEL_READ_REFUSAL);
        if (/^\s*UPDATE oshal_finance_data SET brief/.test(text) && pool.data) { pool.data.brief = values[1]; pool.data.brief_at = 'now'; }
        return { rows: [], rowCount: 1 };
      }
      return { rows: pool.data ? [pool.data] : [], rowCount: pool.data ? 1 : 0 };
    },
  };
  return pool;
}

/** Build the compiled router with framework modules replaced by recorded doubles. */
function loadRoutes(pool, { answer = 'A saved brief.', adapter = null } = {}) {
  const handlers = {}; const prompts = [];
  const record = (method) => (route, handler) => { handlers[`${method} ${route}`] = handler; };
  const doubles = {
    express: { Router: () => ({ get: record('GET'), post: record('POST'), delete: record('DELETE') }) },
    '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
    '@/shared/services/database': { runRuntimeSchemaBootstrap: async () => {}, buildOwnerRlsPolicyStatements: () => [] },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => null },
    '@/features/payments': { getPaymentAdapter: () => { if (!adapter) throw new Error('unknown PAYMENT_PROVIDER'); return adapter; } },
    '@/app/routes/inline-bot-execution': { executeBotOrInline: async (_ctx, _client, _agent, request) => { prompts.push(request.text); return { response: answer }; } },
    '@/app/routes/free-tier-rotation': { resolveUserLlmConnection: async () => null },
    '@/shared/security/explicit-write-confirmation': { confirmationRequiredPayload: () => ({}), hasExplicitWriteConfirmation: () => false },
    './finance-plaid': { plaidConfigured: () => true, plaidEnv: () => 'sandbox' },
    './session-crypto': { encryptSessionValue: (v) => v, decryptSessionValue: (v) => v },
  };
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === ROUTES && request in doubles) return doubles[request];
    return original.call(this, request, parent, isMain);
  };
  let exported;
  try {
    delete require.cache[ROUTES];
    exported = require(ROUTES);
    exported.createFinanceRoutes({ pool, appPackageDir: ROOT });
  } finally { Module._load = original; delete require.cache[ROUTES]; }
  return { handlers, prompts, exported };
}

/** Call one handler as a signed-in caller; the pool sees the request's method as its admission. */
async function call(handler, pool, method, { query = {}, body = {} } = {}) {
  pool.mode = method;
  const res = { statusCode: 200, body: undefined, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await handler({ method, oidc: { user: { sub: 'alice' }, isAuthenticated: () => true }, params: {}, query, body }, res);
  return res;
}

const mutations = (pool) => pool.statements.filter((s) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(s.text));

test('GET /brief only reads: it never runs the analyst or writes, even with ?refresh=1', async () => {
  const pool = financePool({ aggregate: aggregate(), brief: '## Where you stand\nSaved.', brief_at: '2026-10-12T01:00:00Z' });
  const { handlers, prompts } = loadRoutes(pool);
  for (const query of [{ cached: '1' }, {}, { refresh: '1' }]) {
    const res = await call(handlers['GET /brief'], pool, 'GET', { query });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.brief, '## Where you stand\nSaved.');
    assert.equal(res.body.cached, true);
  }
  assert.deepEqual(prompts, [], 'a read never asks the analyst');
  assert.deepEqual(mutations(pool), [], 'a read never issues a mutation');
});

test('GET /brief with nothing saved answers 404 no_saved_brief in words', async () => {
  const pool = financePool({ aggregate: aggregate(), brief: null });
  const { handlers, prompts } = loadRoutes(pool);
  const res = await call(handlers['GET /brief'], pool, 'GET', { query: { refresh: '1' } });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'no_saved_brief', message: 'No saved analysis yet. Choose Re-analyze to request one.' });
  assert.deepEqual(prompts, []);
  assert.deepEqual(mutations(pool), []);
});

test('POST /brief/refresh runs the analyst with exact totals and saves the brief under the write admission', async () => {
  const pool = financePool({ aggregate: aggregate(), brief: null });
  const { handlers, prompts } = loadRoutes(pool, { answer: '## The story\nFresh.' });
  const res = await call(handlers['POST /brief/refresh'], pool, 'POST');
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const brief = res.body.brief;
  assert.match(brief, /^## Where you stand\n- Net worth: -\$40,452\.32\n/);
  assert.match(brief, /\n- Total owed: \$126,994\.06 /);
  assert.ok(brief.endsWith('\n\n## The story\nFresh.'), brief);
  assert.equal(res.body.cached, false);
  const saved = mutations(pool);
  assert.equal(saved.length, 1);
  assert.match(saved[0].text, /^UPDATE oshal_finance_data SET brief = \$2, brief_at = now\(\) WHERE user_sub = \$1/);
  assert.deepEqual(saved[0].values, ['alice', brief]);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /AMOUNTS YOU MAY QUOTE:\n- netWorth: -?\$40,452\.32\n- totalAssets: \$86,541\.74\n/);
  const read = await call(handlers['GET /brief'], pool, 'GET', { query: { cached: '1' } });
  assert.equal(read.body.brief, brief, 'the saved brief is what the next read returns');
});

test('POST /brief/refresh before any sync is refused without asking the analyst', async () => {
  const pool = financePool(null);
  const { handlers, prompts } = loadRoutes(pool);
  const res = await call(handlers['POST /brief/refresh'], pool, 'POST');
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'no_data');
  assert.deepEqual(prompts, []);
});

test('totals are summed exactly by account group (the review had said $120,660.84 liquid)', () => {
  const { exported } = loadRoutes(financePool(null));
  assert.deepEqual(exported.computeFinanceTotals(aggregate()), {
    currency: 'USD', mixedCurrencies: false, accountCount: 12,
    cashAndDeposits: 62589, investmentAccounts: 23952.74, otherAssets: 0,
    creditOwed: 5430, loansOwed: 121564.06,
    totalAssets: 86541.74, totalLiabilities: 126994.06, netWorth: -40452.32, holdingsValue: 3000.3,
  });
  const mixed = aggregate(); mixed.accounts = [...mixed.accounts, { ...mixed.accounts[0], currency: 'EUR' }];
  assert.equal(exported.computeFinanceTotals(mixed).mixedCurrencies, true);
});

test('the advisory review carries the same verified totals', async () => {
  const pool = financePool({ aggregate: aggregate(), synced_at: '2026-10-12T00:00:00Z' });
  const { handlers, prompts } = loadRoutes(pool, { answer: 'Review.' });
  const res = await call(handlers['POST /review'], pool, 'POST', { body: { confirm: true, title: 'Rent', notes: 'Can I afford it?' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.match(prompts[0], /"cashAndDeposits":62589,"investmentAccounts":23952.74,.*"totalAssets":86541.74/);
  assert.match(prompts[0], /Never add\nup balances yourself/);
  assert.match(prompts[0], /Never name\nVERIFIED TOTALS, JSON or any field name in the brief/);
});

test('a missing payment rail names Connections and Payments, never an environment variable', async () => {
  const pool = financePool(null);
  for (const adapter of [null, { provider: 'stripe', configured: () => false, isTestMode: () => true }]) {
    const { handlers } = loadRoutes(pool, { adapter });
    const res = await call(handlers['GET /pay-status'], pool, 'GET');
    assert.equal(res.body.configured, false);
    assert.match(res.body.message, /Connections page/);
    assert.doesNotMatch(res.body.message, /STRIPE_SECRET_KEY|PAYMENT_PROVIDER/);
  }
  const html = fs.readFileSync(path.join(ROOT, 'tools', 'finance.html'), 'utf8');
  assert.doesNotMatch(html, /STRIPE_SECRET_KEY/);
});

test('the page reads the saved brief with GET, re-analyzes with POST, and shows no saved brief as a notice', () => {
  const html = fs.readFileSync(path.join(ROOT, 'tools', 'finance.html'), 'utf8');
  assert.doesNotMatch(html, /\/brief\?refresh=1|'\?refresh=1'/);
  assert.match(html, /api\('\/brief\/refresh', \{ method: 'POST'/);
  assert.match(html, /api\('\/brief\?cached=1'\)/);
  assert.match(html, /e\.code === 'no_saved_brief' \|\| e\.status === 404/);
  assert.match(html, /err\.status = r\.status/);
});
