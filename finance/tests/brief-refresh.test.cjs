/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Re-analyze is a write: GET /brief only reads the saved brief (even with ?refresh=1) and never runs the analyst or issues a mutation; POST /brief/refresh runs the analyst and saves the brief. The pool double refuses any mutation during a GET with the native kernel's own refusal text (crates/packages/src/sql_transaction.rs, "SQL mutation requires original writer admission"), which is what Re-analyze answered live. The brief and review prompts carry exact totals: the Plaid Sandbox accounts the review mis-added ($120,660.84 "liquid") give cash and deposits $62,589 and total assets $86,541.74. A missing payment rail names Connections and Payments, never STRIPE_SECRET_KEY. The page reads with GET, re-analyzes with POST and shows "No saved analysis" as a notice. Run: node --test tests/brief-refresh.test.cjs
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The prompt forbids naming VERIFIED TOTALS or field names in the brief (the live brief had said "sourced directly from VERIFIED TOTALS").
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Sweep 11: the saved brief is the code-written figures section followed by the analyst's commentary; the refresh prompt hands the analyst the figures and the amounts it may quote (tests/brief-figures.test.cjs proves the figure check). The advisory review keeps its VERIFIED TOTALS prompt.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | Exercise compiled Sync and explicit analysis against persisted snapshot/brief dates: Sync retains prior analysis without running the analyst, and refresh returns the database date it actually saved.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Guard synthetic aggregate currency contracts and concurrent Sync versus explicit analysis using actual compiled handlers.
 * -----------------------------------------------------------------------------
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Guard incomplete and unknown transaction coverage through actual saved readers, analysis or rendered views without changing independent balances.
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
    transactionsComplete: true, transactionCoverage: { state: 'complete', returned: 30, total: 30, institutions: [{ institution: 'Example Bank', state: 'complete', returned: 30, total: 30, pages: 1, reason: null }] },
    recentTransactions: [], transactionWindowDays: 90, notes: [] };
}

/**
 * A pool double with the native kernel's admission rule: while the current request is a read (GET),
 * any INSERT/UPDATE/DELETE is refused exactly as the kernel refuses it.
 */
function financePool(row, { linked = 1, itemRows = null } = {}) {
  const pool = {
    mode: 'GET', statements: [], data: row,
    async query(text, values = []) {
      pool.statements.push({ mode: pool.mode, text, values });
      if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(text)) {
        if (pool.mode === 'GET') throw new Error(KERNEL_READ_REFUSAL);
        if (/^\s*UPDATE oshal_finance_data SET brief/.test(text) && pool.data) {
          if (/aggregate\s*=\s*\$3::jsonb/.test(text) && JSON.stringify(pool.data.aggregate) !== values[2]) return { rows: [], rowCount: 0 };
          pool.data.brief = values[1]; pool.data.brief_at = '2026-11-12T19:05:00.000Z';
          return { rows: /RETURNING brief_at/.test(text) ? [{ brief_at: pool.data.brief_at }] : [], rowCount: 1 };
        }
        if (/^\s*INSERT INTO oshal_finance_data/.test(text)) {
          const update = text.split(/ON CONFLICT/i)[1] || '';
          if (!pool.data) pool.data = { brief: null, brief_at: null };
          pool.data.aggregate = JSON.parse(values[1]); pool.data.synced_at = '2026-11-12T19:00:00.000Z';
          if (/\bbrief\s*=\s*NULL/i.test(update)) pool.data.brief = null;
          if (/\bbrief_at\s*=\s*NULL/i.test(update)) pool.data.brief_at = null;
        }
        return { rows: [], rowCount: 1 };
      }
      if (/SELECT COUNT\(\*\).*oshal_finance_items/.test(text)) return { rows: [{ n: linked }], rowCount: 1 };
      if (/SELECT institution, access_token FROM oshal_finance_items/.test(text)) return { rows: itemRows || (linked ? [{ institution: 'Example Bank', access_token: 'synthetic-token' }] : []), rowCount: linked };
      return { rows: pool.data ? [structuredClone(pool.data)] : [], rowCount: pool.data ? 1 : 0 };
    },
  };
  return pool;
}

/** Build the compiled router with framework modules replaced by recorded doubles. */
function loadRoutes(pool, { answer = 'A saved brief.', adapter = null, fresh = aggregate() } = {}) {
  const handlers = {}; const prompts = [], syncs = [];
  const record = (method) => (route, handler) => { handlers[`${method} ${route}`] = handler; };
  const doubles = {
    express: { Router: () => ({ get: record('GET'), post: record('POST'), delete: record('DELETE') }) },
    '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
    '@/shared/services/database': { runRuntimeSchemaBootstrap: async () => {}, buildOwnerRlsPolicyStatements: () => [] },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => null },
    '@/features/payments': { getPaymentAdapter: () => { if (!adapter) throw new Error('unknown PAYMENT_PROVIDER'); return adapter; } },
    '@/app/routes/inline-bot-execution': { executeBotOrInline: async (_ctx, _client, _agent, request) => { prompts.push(request.text); return { response: typeof answer === 'function' ? await answer(request.text) : answer }; } },
    '@/app/routes/free-tier-rotation': { resolveUserLlmConnection: async () => null },
    '@/shared/security/explicit-write-confirmation': { confirmationRequiredPayload: () => ({}), hasExplicitWriteConfirmation: () => false },
    './finance-plaid': { plaidConfigured: () => true, plaidEnv: () => 'sandbox', fetchFinanceAggregate: async (items, days) => { syncs.push({ items, days }); return fresh; } },
    './session-crypto': { encryptSessionValue: (v) => v, decryptSessionValue: (v) => { if (v === 'unreadable-synthetic') throw new Error('synthetic unreadable credential'); return v; } },
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
  return { handlers, prompts, syncs, exported };
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
  assert.equal(res.body.briefAt, pool.data.brief_at, 'refresh returns the persisted database timestamp');
  const saved = mutations(pool);
  assert.equal(saved.length, 1);
  assert.match(saved[0].text, /^UPDATE oshal_finance_data SET brief = \$2, brief_at = now\(\) WHERE user_sub = \$1/);
  assert.deepEqual(saved[0].values, ['alice', brief, JSON.stringify(aggregate())]);
  assert.match(saved[0].text, /AND aggregate = \$3::jsonb RETURNING brief_at/);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /AMOUNTS YOU MAY QUOTE:\n- netWorth: -?\$40,452\.32\n- totalAssets: \$86,541\.74\n/);
  const read = await call(handlers['GET /brief'], pool, 'GET', { query: { cached: '1' } });
  assert.equal(read.body.brief, brief, 'the saved brief is what the next read returns');
  assert.equal(read.body.briefAt, res.body.briefAt, 'POST and the subsequent cached GET agree on the saved date');
});

test('Sync preserves the previous dated analysis while advancing only the saved account snapshot', async () => {
  const pool = financePool({ aggregate: aggregate(), synced_at: '2026-11-10T18:15:00.000Z', brief: 'Previous saved analysis.', brief_at: '2026-11-09T17:05:00.000Z' });
  const { handlers, prompts, syncs } = loadRoutes(pool);
  const synced = await call(handlers['POST /sync'], pool, 'POST');
  assert.equal(synced.statusCode, 200, JSON.stringify(synced.body));
  const saved = await call(handlers['GET /brief'], pool, 'GET', { query: { cached: '1' } });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.brief, 'Previous saved analysis.');
  assert.equal(saved.body.briefAt, '2026-11-09T17:05:00.000Z');
  const snapshot = await call(handlers['GET /summary'], pool, 'GET');
  assert.ok(Date.parse(saved.body.briefAt) < Date.parse(snapshot.body.syncedAt));
  assert.equal(syncs.length, 1); assert.deepEqual(prompts, [], 'Sync does not commission analysis');
  assert.ok(pool.statements.every((s) => s.values[0] === 'alice' || !s.values.length), 'the existing owner scope is retained');
});

test('a first Sync does not invent saved analysis and missing accounts still refuse Sync', async () => {
  const pool = financePool(null);
  const { handlers, prompts } = loadRoutes(pool);
  assert.equal((await call(handlers['POST /sync'], pool, 'POST')).statusCode, 200);
  const saved = await call(handlers['GET /brief'], pool, 'GET', { query: { cached: '1' } });
  assert.equal(saved.statusCode, 404); assert.equal(saved.body.error, 'no_saved_brief');
  const empty = financePool(null, { linked: 0 });
  const absent = loadRoutes(empty);
  assert.equal((await call(absent.handlers['POST /sync'], empty, 'POST')).statusCode, 409);
  assert.deepEqual(absent.syncs, []); assert.deepEqual(prompts, []);
});

test('compiled summary preserves missing values, known zero and the original snapshot date', async () => {
  for (const raw of [{}, { netWorth: { assets: null, liabilities: null, net: null } }, { netWorth: { assets: 0, liabilities: 0, net: 0 } }, { netWorth: { assets: 150, liabilities: 20, net: 130 } }]) {
    const pool = financePool({ aggregate: { currency: 'USD', ...raw, accounts: [{ name: 'Known', balance: 100 }, { name: 'Zero', balance: 0 }] }, synced_at: '2026-11-10T18:15:00.000Z' });
    const { handlers } = loadRoutes(pool);
    const saved = await call(handlers['GET /summary'], pool, 'GET');
    assert.equal(saved.statusCode, 200);
    assert.deepEqual(saved.body.aggregate.netWorth, raw.netWorth || { assets: null, liabilities: null, net: null });
    assert.equal(saved.body.aggregate.accounts[0].balance, 100);
    assert.equal(saved.body.aggregate.accounts[1].balance, 0);
    assert.equal(saved.body.syncedAt, '2026-11-10T18:15:00.000Z');
    assert.deepEqual(mutations(pool), []);
  }
});

test('computed totals do not present the known part of a missing-balance group as complete', () => {
  const { exported } = loadRoutes(financePool(null));
  const saved = aggregate();
  saved.accounts = [{ name: 'Known', type: 'depository', balance: 100 }, { name: 'Missing', type: 'depository', balance: null }, { name: 'Known debt', type: 'credit', balance: 20 }];
  const totals = exported.computeFinanceTotals(saved);
  assert.equal(totals.cashAndDeposits, null); assert.equal(totals.totalAssets, null); assert.equal(totals.netWorth, null);
  assert.equal(totals.creditOwed, 20); assert.equal(totals.totalLiabilities, 20);
  saved.accounts[1].balance = 0;
  assert.equal(exported.computeFinanceTotals(saved).netWorth, 80);
  saved.accounts[1] = { name: 'Missing debt', type: 'loan', balance: null };
  const missingDebt = exported.computeFinanceTotals(saved);
  assert.equal(missingDebt.totalAssets, 100); assert.equal(missingDebt.totalLiabilities, null); assert.equal(missingDebt.netWorth, null);
  saved.balancesComplete = false;
  const incomplete = exported.computeFinanceTotals(saved);
  assert.equal(incomplete.totalAssets, null); assert.equal(incomplete.creditOwed, null);
  delete saved.accounts; delete saved.balancesComplete;
  const absentInventory = exported.computeFinanceTotals(saved);
  assert.equal(absentInventory.totalAssets, null); assert.equal(absentInventory.totalLiabilities, null);
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


test('an analysis started before concurrent Sync cannot overwrite the previous dated brief', async () => {
  const previous = 'Previously saved analysis.', stamp = '2026-11-09T17:05:00.000Z';
  const pool = financePool({ aggregate: aggregate(), brief: previous, brief_at: stamp });
  let release, started;
  const begin = new Promise(resolve => { started = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const fresh = { ...aggregate(), generatedAt: '2026-11-12T22:30:00Z', accounts: [{ ...SANDBOX_ACCOUNTS[0], balance: 7 }] };
  const { handlers } = loadRoutes(pool, { fresh, answer: async () => { started(); return held; } });
  const pending = call(handlers['POST /brief/refresh'], pool, 'POST');
  await begin;
  await call(handlers['POST /sync'], pool, 'POST');
  release('## The story\nThis describes the older snapshot.');
  const res = await pending;
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.error, 'snapshot_changed');
  assert.equal(pool.data.brief, previous);
  assert.equal(pool.data.brief_at, stamp);
  assert.equal(pool.data.aggregate.accounts[0].balance, 7);
});

test('historical nominal mixed-currency net worth is withheld without rewriting storage', async () => {
  const raw = { ...aggregate(), accounts: [{ ...SANDBOX_ACCOUNTS[0], balance: 100 }, { ...SANDBOX_ACCOUNTS[0], currency: 'EUR', balance: 100 }], netWorth: { assets: 200, liabilities: 0, net: 200 } };
  const pool = financePool({ aggregate: raw, synced_at: '2026-11-10T18:15:00Z' });
  const { handlers, exported } = loadRoutes(pool);
  const res = await call(handlers['GET /summary'], pool, 'GET');
  assert.deepEqual(res.body.aggregate.netWorth, { assets: null, liabilities: null, net: null });
  assert.equal(pool.data.aggregate.netWorth.net, 200, 'read normalization never rewrites historical evidence');
  assert.equal(exported.computeFinanceTotals(raw).netWorth, null);
  assert.deepEqual(res.body.aggregate.accounts.map(a => a.balance), [100, 100]);
  assert.deepEqual(mutations(pool), []);
});


test('explicit missing units never inherit USD while omitted legacy units use only a stored unit', async () => {
  for (const [currency, accountCurrency, expectBalance] of [['USD', undefined, 0], [undefined, undefined, null], ['USD', null, null], ['USD', 'bad', null], ['USD', 'EUR', 0]]) {
    const a = { name: 'Zero', type: 'depository', balance: 0 };
    if (accountCurrency !== undefined) a.currency = accountCurrency;
    const pool = financePool({ aggregate: { currency, accounts: [a], netWorth: { assets: 0, liabilities: 0, net: 0 } } });
    const { handlers } = loadRoutes(pool);
    const result = await call(handlers['GET /summary'], pool, 'GET');
    assert.equal(result.body.aggregate.accounts[0].balance, expectBalance);
    if (expectBalance === null) { assert.equal(result.body.aggregate.netWorth.net, null); assert.match(result.body.aggregate.notes.join(' '), /currency.*unknown/i); }
    assert.deepEqual(mutations(pool), []);
  }
});


test('historical missing account component constrains stale cached totals without DB writes', async () => {
  const raw = { ...aggregate(), accounts: [{ ...SANDBOX_ACCOUNTS[0], balance: null }, { ...SANDBOX_ACCOUNTS[3], balance: 20 }], netWorth: { assets: 100, liabilities: 20, net: 80 } };
  const pool = financePool({ aggregate: raw }); const { handlers } = loadRoutes(pool);
  const result = await call(handlers['GET /summary'], pool, 'GET');
  assert.deepEqual(result.body.aggregate.netWorth, { assets: null, liabilities: 20, net: null });
  assert.deepEqual(pool.data.aggregate.netWorth, raw.netWorth); assert.deepEqual(mutations(pool), []);
});

test('a sole foreign account never becomes a nominal total in the snapshot currency', async () => {
  const raw = { ...aggregate(), currency: 'USD', accounts: [{ ...SANDBOX_ACCOUNTS[0], currency: 'EUR', balance: 100 }], netWorth: { assets: 100, liabilities: 0, net: 100 } };
  const pool = financePool({ aggregate: raw }); const { handlers, exported, prompts } = loadRoutes(pool, { fresh: raw });
  const summary = await call(handlers['GET /summary'], pool, 'GET');
  assert.deepEqual(summary.body.aggregate.netWorth, { assets: null, liabilities: null, net: null });
  assert.deepEqual(summary.body.aggregate.accounts.map(a => [a.balance, a.currency]), [[100, 'EUR']]);
  assert.equal(exported.computeFinanceTotals(raw).netWorth, null);
  assert.deepEqual(mutations(pool), []);
  const synced = await call(handlers['POST /sync'], pool, 'POST');
  assert.equal(synced.body.netWorth.net, null);
  const result = await call(handlers['POST /brief/refresh'], pool, 'POST');
  assert.equal(result.statusCode, 200); assert.match(result.body.brief, /€100.00/); assert.doesNotMatch(result.body.brief, /\$100.00/);
  const quotes = prompts[0].split('AMOUNTS YOU MAY QUOTE:')[1].split('ACCOUNTS, HOLDINGS')[0];
  assert.doesNotMatch(quotes, /100/);
});


/** A historical rollup whose underlying provider window was clipped; balances remain independent. */
function partialTransactions() {
  return { ...aggregate(), transactionsComplete: false,
    transactionCoverage: { state: 'partial', returned: 2000, total: 2501,
      institutions: [{ institution: 'Example Bank', state: 'partial', returned: 2000, total: 2501, pages: 4, reason: 'page_limit' }] },
    topSpending: [{ category: 'Clipped category', total: 25000, count: 2000 }],
    spendByMonth: [{ month: '2026-10', spend: 25000, income: 0 }],
    recentTransactions: [{ date: '2026-10-01', name: 'Available transaction', amount: 12.5, currency: 'USD' }] };
}

test('compiled summary masks incomplete historical rollups without mutating saved data or analysis', async () => {
  const raw = partialTransactions(), pool = financePool({ aggregate: raw, brief: 'Older dated analysis.', brief_at: '2026-10-01T00:00:00Z' });
  const { handlers, prompts } = loadRoutes(pool);
  const result = await call(handlers['GET /summary'], pool, 'GET');
  assert.equal(result.body.aggregate.transactionsComplete, false);
  assert.deepEqual(result.body.aggregate.topSpending, []); assert.deepEqual(result.body.aggregate.spendByMonth, []);
  assert.equal(result.body.aggregate.recentTransactions.length, 1);
  assert.equal(result.body.aggregate.netWorth.net, -40452.32);
  assert.match(result.body.aggregate.notes.join(' '), /Transaction coverage.*partial/i);
  assert.equal(pool.data.aggregate.topSpending[0].total, 25000); assert.deepEqual(mutations(pool), []);
  const saved = await call(handlers['GET /brief'], pool, 'GET');
  assert.equal(saved.body.brief, 'Older dated analysis.'); assert.deepEqual(prompts, []);
});

test('compiled Sync persists coverage and available rows without commissioning analysis', async () => {
  const pool = financePool({ aggregate: aggregate(), brief: 'Older analysis.', brief_at: '2026-10-01T00:00:00Z' });
  const { handlers, prompts } = loadRoutes(pool, { fresh: partialTransactions() });
  const synced = await call(handlers['POST /sync'], pool, 'POST');
  assert.equal(synced.body.ok, true); assert.equal(pool.data.aggregate.transactionsComplete, false);
  assert.equal(pool.data.aggregate.transactionCoverage.total, 2501);
  assert.deepEqual(pool.data.aggregate.topSpending, []); assert.deepEqual(pool.data.aggregate.spendByMonth, []);
  assert.equal(pool.data.aggregate.recentTransactions.length, 1);
  assert.equal(pool.data.brief, 'Older analysis.'); assert.deepEqual(prompts, []);
});

test('compiled explicit analysis reads partial snapshot honestly while retaining its snapshot identity CAS', async () => {
  const raw = partialTransactions(), pool = financePool({ aggregate: raw, brief: null });
  const { handlers, prompts } = loadRoutes(pool, { answer: '## Spending\nCoverage is partial; complete spending totals are unavailable.' });
  const result = await call(handlers['POST /brief/refresh'], pool, 'POST');
  assert.equal(result.statusCode, 200); assert.match(result.body.brief, /Transaction coverage.*partial/i);
  assert.doesNotMatch(prompts[0], /25000|25,000/);
  assert.match(prompts[0], /Full-window spending, income and trends are unavailable/);
  assert.equal(pool.data.aggregate.topSpending[0].total, 25000);
  assert.equal(mutations(pool).length, 1);
  assert.equal(mutations(pool)[0].values[2], JSON.stringify(raw), 'CAS remains bound to original persisted bytes');
});

test('legacy missing coverage is unknown while positively complete rollups remain readable', async () => {
  for (const complete of [false, true]) {
    const raw = partialTransactions(); raw.transactionsComplete = complete ? true : undefined;
    raw.transactionCoverage = complete ? { state: 'complete', returned: 2000, total: 2000,
      institutions: [{ institution: 'Example', state: 'complete', returned: 2000, total: 2000, pages: 4, reason: null }] } : undefined;
    const pool = financePool({ aggregate: raw }); const { handlers } = loadRoutes(pool);
    const result = await call(handlers['GET /summary'], pool, 'GET');
    assert.equal(result.body.aggregate.transactionsComplete, complete);
    assert.equal(result.body.aggregate.topSpending.length, complete ? 1 : 0);
    assert.deepEqual(mutations(pool), []);
  }
});


test('compiled Sync never labels a readable subset complete after another stored credential was unreadable', async () => {
  const raw = partialTransactions(); raw.transactionsComplete = true;
  raw.transactionCoverage = { state: 'complete', returned: 2000, total: 2000,
    institutions: [{ institution: 'Readable', state: 'complete', returned: 2000, total: 2000, pages: 4, reason: null }] };
  const pool = financePool({ aggregate: aggregate(), brief: 'Previous dated analysis.' }, { linked: 2, itemRows: [
    { institution: 'Readable', access_token: 'synthetic-token' }, { institution: 'Unreadable', access_token: 'unreadable-synthetic' }] });
  const { handlers, prompts } = loadRoutes(pool, { fresh: raw });
  const result = await call(handlers['POST /sync'], pool, 'POST');
  assert.equal(result.body.ok, true); assert.equal(pool.data.aggregate.transactionsComplete, false);
  assert.equal(pool.data.aggregate.transactionCoverage.state, 'unknown'); assert.equal(pool.data.aggregate.transactionCoverage.total, null);
  assert.deepEqual(pool.data.aggregate.topSpending, []); assert.deepEqual(pool.data.aggregate.spendByMonth, []);
  assert.match(result.body.notes.join(' '), /Unreadable skipped/);
  assert.equal(pool.data.brief, 'Previous dated analysis.'); assert.deepEqual(prompts, []);
});


test('compiled summary never repeats a partial aggregate count contradicted by an unknown institution', async () => {
  const raw = partialTransactions(); raw.transactionCoverage = { state: 'partial', returned: 1, total: 10,
    institutions: [{ institution: 'Example', state: 'unknown', returned: 1, total: null, pages: 1, reason: 'unknown_total' }] };
  const pool = financePool({ aggregate: raw }); const { handlers } = loadRoutes(pool);
  const result = await call(handlers['GET /summary'], pool, 'GET');
  assert.equal(result.body.aggregate.transactionCoverage.state, 'unknown');
  assert.match(result.body.aggregate.notes.join(' '), /Transaction coverage is unknown/);
  assert.doesNotMatch(result.body.aggregate.notes.join(' '), /1 of 10/);
  assert.deepEqual(result.body.aggregate.topSpending, []); assert.deepEqual(mutations(pool), []);
});
