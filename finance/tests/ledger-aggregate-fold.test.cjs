/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The saved snapshot stays the one thing the kernel's Finance summary, Jarvis and the Home and Business views read, and it is rebuilt from Finance's own records. On a disposable PostgreSQL through the compiled routes: after a statement import the saved row has the person's subject as its key, an aggregate object and a sync time (what the kernel's two routes read), every field the older readers use with the type they expect, sourceEnvironment 'imported', a sources list and each balance's date and source; the facts Jarvis reads, the brief's totals, the package's own summary route and its Home summary all answer from it unchanged; a transfer between a person's own accounts is neither spending nor income; an account with no known balance is left out of the totals and named, never shown as zero; a snapshot saved before Finance had records is carried through a rebuild with nothing counted twice; a sync writes the bank's accounts and every transaction in the window into the records (not the 25 the snapshot keeps), skips a pending one, adds nothing the second time, removes sample records, and still stands when a bank's records cannot be written; a disconnected bank's accounts leave net worth. Synthetic statements and a recorded bank double shaped like Plaid's documented fields; no provider or credential is used. Run: OSHAL_TEST_POSTGRES=... node --test tests/ledger-aggregate-fold.test.cjs
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Finance 1.7.0 on 1.6.5's snapshot rules: a person with a linked bank keeps the sync's snapshot and its analysis through any import or typed entry while the records still take them; without a link the snapshot is the records' own with the 1.6 marks (balancesComplete only when every balance is known, transactionsComplete false), so the facts withhold spending totals; an older snapshot is replaced, never mixed in, once records exist, and removed only when it was the records' own; only the sample's holdings are carried. The sync-fold case went with the sync change it tested.
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ROUTES, database, ledgerRoutes, financeRoutes, requireWith, call, day, recentCsv, importStatement, assertFigures } = require('./ledger.fixture.cjs');

const facts = require(path.join(ROUTES, 'finance-facts.js'));
const aggregate = require(path.join(ROUTES, 'finance-aggregate.js'));
const saved = async (pool, sub) => (await pool.query('SELECT user_sub, aggregate, brief, synced_at FROM oshal_finance_data WHERE user_sub = $1', [sub])).rows[0];
const STATEMENT = recentCsv([[2, 'Harbor Market', '-84.31'], [3, 'Transfer to savings', '-300.00'], [5, 'Payroll Lakeside Design Co', '3200.00'], [9, 'City Utilities', '-112.40'], [40, 'Harbor Market', '-96.12']], '4820.44');
/** The legacy fields of the aggregate and the type each reader expects. */
const LEGACY_SHAPE = { generatedAt: 'string', sourceEnvironment: 'string', currency: 'string', netWorth: 'object', accounts: 'array', holdings: 'array', topSpending: 'array', spendByMonth: 'array', recentTransactions: 'array', transactionWindowDays: 'number', notes: 'array' };
const kind = (value) => (Array.isArray(value) ? 'array' : typeof value);

test('after an import the saved row is what every existing reader expects, rebuilt from the records', async (t) => {
  const pool = await database(t);
  const ledger = ledgerRoutes(pool);
  await importStatement(ledger, 'alice', { fileName: 'harbor.csv', text: STATEMENT, newAccount: { name: 'Everyday Checking', institution: 'Harbor Bank', type: 'depository', subtype: 'checking', last4: '4821' } });
  const row = await saved(pool, 'alice');
  assert.equal(row.user_sub, 'alice', 'the kernel reads the row by the person\'s subject');
  assert.ok(row.aggregate && typeof row.aggregate === 'object' && !Array.isArray(row.aggregate), 'the kernel requires an aggregate object');
  assert.ok(row.synced_at instanceof Date, 'and a sync time');
  const agg = row.aggregate;
  for (const [field, type] of Object.entries(LEGACY_SHAPE)) assert.equal(kind(agg[field]), type, `${field} keeps its type`);
  assert.deepEqual(agg.netWorth, { assets: 4820.44, liabilities: 0, net: 4820.44 });
  assert.deepEqual(agg.accounts, [{ name: 'Everyday Checking', type: 'depository', subtype: 'checking', mask: '4821', balance: 4820.44, currency: 'USD', institution: 'Harbor Bank', balanceAsOf: day(2), source: 'import', sourceLabel: 'Harbor Bank statement', posture: null }]);
  assert.equal(agg.sourceEnvironment, 'imported');
  assert.deepEqual(agg.sources, [{ kind: 'import', label: 'Harbor Bank statement', asOf: day(2) }]);
  assert.equal(agg.transactionWindowDays, 90);
  assert.deepEqual(agg.topSpending, [{ category: 'Groceries', total: 180.43, count: 2 }, { category: 'Utilities', total: 112.4, count: 1 }], 'a transfer between own accounts is not spending');
  assert.equal(agg.spendByMonth.reduce((sum, m) => sum + Math.round(m.income * 100), 0), 320000);
  assert.equal(agg.spendByMonth.reduce((sum, m) => sum + Math.round(m.spend * 100), 0), 29283);
  assert.deepEqual(agg.recentTransactions[0], { date: day(2), name: 'Harbor Market', amount: 84.31, category: 'Groceries' }, 'money out is positive, as before');
  assert.equal(agg.recentTransactions.find((r) => r.name.startsWith('Payroll')).amount, -3200, 'money in is negative, as before');
  assert.equal(row.brief, null, 'a rebuild clears the brief written over the older figures');

  const read = facts.financeFacts(0, { aggregate: agg, synced_at: row.synced_at, has_brief: false }, new Date());
  assert.deepEqual([read['facts.complete'], read.synced, read.net_worth, read.assets, read.accounts, read.single_currency, read.sandbox_data], [true, true, 4820.44, 4820.44, 1, true, null]);
  const routes = requireWith(path.join(ROUTES, 'finance-routes.js'), { express: { Router: () => ({ get() {}, post() {}, delete() {} }) }, '@/shared/logger': { createChildLogger: () => ({ error() {} }) }, '@/shared/services/database': {}, '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => null }, '@/features/payments': {}, '@/app/routes/inline-bot-execution': {}, '@/app/routes/free-tier-rotation': {}, '@/shared/security/explicit-write-confirmation': {}, './finance-plaid': {}, './session-crypto': {} });
  const totals = routes.computeFinanceTotals(agg);
  assert.deepEqual([totals.cashAndDeposits, totals.netWorth, totals.accountCount, totals.mixedCurrencies], [4820.44, 4820.44, 1, false], 'the brief\'s totals read it unchanged');
  const summary = await call(financeRoutes(pool)['GET /summary'], 'alice');
  assert.equal(summary.statusCode, 200);
  assert.deepEqual(summary.body.aggregate.netWorth, agg.netWorth);
  const home = {};
  requireWith(path.join(ROUTES, 'home-summary.js'), { express: { Router: () => ({ get: (route, handler) => { home[route] = handler; } }) } }).createHomeSummaryRoutes({ pool });
  const tiles = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await home['/']({ oidc: { user: { sub: 'alice' }, isAuthenticated: () => true } }, tiles);
  assert.deepEqual([tiles.statusCode, tiles.body.metrics.find((m) => m.id === 'cached-net-worth').value], [200, 'USD 4,820.44'], 'the package\'s Home summary reads it unchanged');
  assert.equal((await saved(pool, 'bob')), undefined, 'another person has no snapshot');
});

test('an account with no known balance is left out of the totals and named, never shown as zero', async (t) => {
  const pool = await database(t);
  const ledger = ledgerRoutes(pool);
  await call(ledger['POST /accounts'], 'alice', { body: { name: 'Everyday Checking', type: 'depository', balanceCents: 250000, balanceAsOf: day(1) } });
  await call(ledger['POST /accounts'], 'alice', { body: { name: 'Savings', type: 'depository' } });
  const agg = (await saved(pool, 'alice')).aggregate;
  assert.deepEqual(agg.accounts.map((a) => a.name), ['Everyday Checking']);
  assert.deepEqual(agg.netWorth, { assets: 2500, liabilities: 0, net: 2500 });
  assert.ok(agg.notes.includes('Savings has no balance yet, so it is not in these totals.'));
  const accounts = (await call(ledger['GET /accounts'], 'alice')).body;
  const savings = accounts.accounts.find((a) => a.name === 'Savings');
  assert.deepEqual([savings.balance, savings.balanceNote], [null, 'Not known yet']);
  assert.deepEqual([accounts.netWorth.net.cents, accounts.netWorth.without, accounts.netWorth.note], [250000, ['Savings'], 'Without Savings: no balance is known yet.']);
  assertFigures(accounts);
});

test('a snapshot the records did not write is left alone until records exist, and then replaced; only the sample\'s holdings are carried', async (t) => {
  const pool = await database(t);
  const ledger = ledgerRoutes(pool);
  const older = { generatedAt: new Date(Date.now() - 3 * 86400000).toISOString(), sourceEnvironment: 'sandbox', currency: 'USD', netWorth: { assets: 1000, liabilities: 200, net: 800 },
    accounts: [{ name: 'Test Checking', type: 'depository', subtype: 'checking', mask: '0000', balance: 1000, currency: 'USD', institution: 'Test Bank' }],
    holdings: [{ name: 'Index Fund', ticker: 'IDX', type: 'etf', quantity: 1, value: 50, costBasis: 40, institution: 'Test Bank', accountName: 'Brokerage' }],
    topSpending: [], spendByMonth: [], recentTransactions: [], transactionWindowDays: 90, notes: [] };
  await pool.query("INSERT INTO oshal_finance_data (user_sub, aggregate, brief, synced_at, brief_at) VALUES ('alice', $1, NULL, now(), NULL)", [JSON.stringify(older)]);
  const opened = await importStatement(ledger, 'alice', { fileName: 'harbor.csv', text: STATEMENT, newAccount: { name: 'Everyday Checking', institution: 'Harbor Bank' } });
  const first = (await saved(pool, 'alice')).aggregate;
  assert.deepEqual(first.accounts.map((a) => a.name), ['Everyday Checking'], 'a disconnected bank\'s old figures are not mixed into the records');
  assert.deepEqual([first.holdings.length, first.sourceEnvironment, first.ledger], [0, 'imported', true]);
  assert.deepEqual([first.balancesComplete, first.transactionsComplete], [true, false], 'the 1.6 marks: every balance known, no window claimed whole');
  const read = facts.financeFacts(0, { aggregate: first, synced_at: new Date(), has_brief: false }, new Date());
  assert.deepEqual([read.net_worth, read.latest_month_spend], [4820.44, null], 'spending totals are withheld, as for any window not proven whole');
  assert.equal((await call(ledger[`POST /imports/:id/undo`], 'alice', { params: { id: opened.preview.importId }, body: { confirm: true } })).statusCode, 200);
  assert.equal(await saved(pool, 'alice'), undefined, 'with the records gone, the snapshot they wrote goes too');

  const sample = { ...older, sourceEnvironment: 'sample', accounts: [] };
  await pool.query("INSERT INTO oshal_finance_data (user_sub, aggregate, brief, synced_at, brief_at) VALUES ('bob', $1, NULL, now(), NULL)", [JSON.stringify(sample)]);
  assert.equal((await call(ledger['POST /accounts'], 'bob', { body: { name: 'Savings', type: 'depository' } })).statusCode, 200);
  const typed = (await saved(pool, 'bob')).aggregate;
  assert.deepEqual([typed.holdings.length, typed.balancesComplete, typed.notes.includes('Savings has no balance yet, so it is not in these totals.')], [1, false, true], 'the sample\'s holdings carried; a balance not known keeps the totals incomplete');
  assert.deepEqual(aggregate.windowMonths(new Date('2026-11-12T00:00:00Z')), ['2026-08', '2026-09', '2026-10', '2026-11']);
});

test('a bank-linked snapshot is never rewritten by an import or a typed entry; the records still hold them', async (t) => {
  const pool = await database(t);
  const ledger = ledgerRoutes(pool);
  const linked = { generatedAt: new Date().toISOString(), sourceEnvironment: 'sandbox', currency: 'USD', netWorth: { assets: 1000, liabilities: 0, net: 1000 },
    balancesComplete: true, accounts: [{ name: 'Test Checking', type: 'depository', subtype: 'checking', mask: '0000', balance: 1000, currency: 'USD', institution: 'Test Bank' }],
    holdings: [], topSpending: [], spendByMonth: [], recentTransactions: [], transactionWindowDays: 90, notes: [] };
  await pool.query("INSERT INTO oshal_finance_items (item_id, user_sub, institution, access_token) VALUES ('item-test', 'alice', 'Test Bank', 'vault:synthetic')");
  await pool.query("INSERT INTO oshal_finance_data (user_sub, aggregate, brief, synced_at, brief_at) VALUES ('alice', $1, 'kept brief', now(), now())", [JSON.stringify(linked)]);
  await importStatement(ledger, 'alice', { fileName: 'harbor.csv', text: STATEMENT, newAccount: { name: 'Everyday Checking', institution: 'Harbor Bank' } });
  const account = (await call(ledger['GET /accounts'], 'alice')).body.accounts[0];
  await call(ledger['POST /transactions'], 'alice', { body: { accountId: account.id, date: day(1), amountCents: 1000, direction: 'out', description: 'Farm stand', category: 'Groceries' } });
  const row = await saved(pool, 'alice');
  assert.deepEqual(row.aggregate, linked, 'the sync\'s snapshot stands as it was written');
  assert.equal(row.brief, 'kept brief', 'and so does the analysis written over it');
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM finance_transactions WHERE user_sub = 'alice'")).rows[0].n, 6, 'the statement and the typed entry are in the records');
  assert.equal(account.name, 'Everyday Checking');
});
