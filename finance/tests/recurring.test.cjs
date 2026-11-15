/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Finance 1.8.0 (Lane FINH2, the design's slice 3): Recurring through the compiled routes on a disposable PostgreSQL after a synthetic statement is applied (only Express's Router and the logger are doubled). Every monthly charge is listed with what it costs a year as an estimate with its source and date, and a price that went up says so; the totals a month and a year leave out what the person marked to cancel. Each is answered once: Keep; Track as a bill (only with confirm: true) makes it a bill; Mark to cancel records it, and a later charge says it was charged again; Review again takes the answer back. A GET writes nothing, and a second person sees and answers nothing. Migration 006 is plain and the module creates no table and moves no money. Every person, payee and figure is invented. Run: OSHAL_TEST_POSTGRES=... node --test tests/recurring.test.cjs
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PKG, ROUTES, database, ledgerRoutes, requireWith, call, recentCsv, importStatement, assertFigures, declaredMigrations } = require('./ledger.fixture.cjs');

const quiet = { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) };
function module_(pool, file, factory) {
  const handlers = {};
  const router = { get: (r, ...c) => { handlers[`GET ${r}`] = c[c.length - 1]; }, post: (r, ...c) => { handlers[`POST ${r}`] = c[c.length - 1]; } };
  requireWith(path.join(ROUTES, file), { express: { Router: () => router }, '@/shared/logger': quiet })[factory]({ pool, appPackageDir: PKG });
  return handlers;
}
const recurring = (pool) => module_(pool, 'finance-recurring.js', 'createFinanceRecurringRoutes');
const bills = (pool) => module_(pool, 'finance-bills.js', 'createFinanceBillsRoutes');
/** Three months of a streaming service, a gym whose price went up, a utility, and groceries that do not repeat evenly. */
const STATEMENT = recentCsv([[2, 'Riverstream Video', '-15.49'], [3, 'Summit Gym', '-42.00'], [4, 'Pinecrest Water Co', '-48.20'], [6, 'Harbor Market', '-84.31'],
  [32, 'Riverstream Video', '-15.49'], [33, 'Summit Gym', '-40.00'], [34, 'Pinecrest Water Co', '-47.90'], [45, 'Harbor Market', '-61.02'],
  [62, 'Riverstream Video', '-15.49'], [63, 'Summit Gym', '-40.00'], [64, 'Pinecrest Water Co', '-48.05']], '2410.55');
const NEW_ACCOUNT = { name: 'Test Everyday Checking', institution: 'Lantern Ridge Credit Union', type: 'depository' };
const count = async (pool, table) => (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

test('every monthly charge is listed with what it costs a year, and each is answered once', async (t) => {
  const pool = await database(t);
  const ledger = ledgerRoutes(pool), routes = recurring(pool);
  await importStatement(ledger, 'alice', { fileName: 'lantern-ridge.csv', text: STATEMENT, newAccount: NEW_ACCOUNT });
  const before = await count(pool, 'finance_recurring_reviews');
  const read = await call(routes['GET /'], 'alice');
  assert.equal(read.statusCode, 200, JSON.stringify(read.body));
  assert.equal(await count(pool, 'finance_recurring_reviews'), before, 'a GET writes nothing');
  const items = read.body.items;
  assert.deepEqual(items.map((i) => i.payee), ['Pinecrest Water Co', 'Riverstream Video', 'Summit Gym'], 'groceries at uneven gaps are not recurring');
  const video = items.find((i) => i.payee === 'Riverstream Video'), gym = items.find((i) => i.payee === 'Summit Gym');
  assert.deepEqual([video.cadence, video.amount.cents, video.perYear.cents, video.perYear.posture], ['monthly', 1549, 18588, 'estimate']);
  assert.deepEqual([gym.priceWentUp, gym.earlierAmount.cents, video.priceWentUp], [true, 4000, false]);
  assert.equal(read.body.toReview, 3);
  assert.equal(read.body.totals.yearly.cents, (4820 + 1549 + 4200) * 12);
  assertFigures(read.body);

  const keep = await call(routes['POST /:seriesId/answer'], 'alice', { params: { seriesId: video.seriesId }, body: { answer: 'keep' } });
  assert.deepEqual([keep.statusCode, keep.body.words], [200, 'Riverstream Video: kept.']);
  const asked = await call(routes['POST /:seriesId/answer'], 'alice', { params: { seriesId: items[0].seriesId }, body: { answer: 'bill' } });
  assert.deepEqual([asked.statusCode, asked.body.message], [400, 'Tracking this as a bill needs your confirmation.']);
  const bill = await call(routes['POST /:seriesId/answer'], 'alice', { params: { seriesId: items[0].seriesId }, body: { answer: 'bill', confirm: true } });
  assert.equal(bill.statusCode, 200, JSON.stringify(bill.body));
  assert.deepEqual([bill.body.bill.payee, bill.body.bill.state], ['Pinecrest Water Co', 'confirmed']);
  assert.ok((await call(bills(pool)['GET /'], 'alice')).body.bills.some((b) => b.payee === 'Pinecrest Water Co'), 'it is in Bills');
  const cancel = await call(routes['POST /:seriesId/answer'], 'alice', { params: { seriesId: gym.seriesId }, body: { answer: 'cancel' } });
  assert.match(cancel.body.words, /^Recorded: you mean to cancel Summit Gym\. Finance cancels nothing/);
  const after = (await call(routes['GET /'], 'alice')).body;
  assert.equal(after.toReview, 0);
  assert.deepEqual(after.items.map((i) => i.review && i.review.answer), ['bill', 'keep', 'cancel']);
  assert.equal(after.items.find((i) => i.payee === 'Pinecrest Water Co').hasBill, true);
  assert.equal(after.totals.yearly.cents, (4820 + 1549) * 12, 'what the person means to cancel is left out of the totals');
  assert.equal(after.items.find((i) => i.payee === 'Summit Gym').chargedAgain, null);
  assert.equal((await call(routes['POST /:seriesId/answer'], 'alice', { params: { seriesId: 'recur_none' }, body: { answer: 'keep' } })).statusCode, 404);
  assert.equal((await call(routes['POST /:seriesId/answer'], 'alice', { params: { seriesId: gym.seriesId }, body: { answer: 'later' } })).statusCode, 400);

  const bob = await call(routes['GET /'], 'bob');
  assert.deepEqual([bob.body.items.length, bob.body.totals], [0, null], 'another person sees none of it');
  assert.equal((await call(routes['POST /:seriesId/answer'], 'bob', { params: { seriesId: gym.seriesId }, body: { answer: 'keep' } })).statusCode, 404, 'nor can answer it');

  const cleared = await call(routes['POST /:seriesId/clear'], 'alice', { params: { seriesId: video.seriesId }, body: {} });
  assert.deepEqual([cleared.statusCode, cleared.body.payee], [200, 'Riverstream Video']);
  assert.equal((await call(routes['GET /'], 'alice')).body.toReview, 1, 'it waits for a review again');
});

test('a payment marked to cancel that is charged again says so', async (t) => {
  const pool = await database(t);
  const ledger = ledgerRoutes(pool), routes = recurring(pool);
  const old = recentCsv([[40, 'Riverstream Video', '-15.49'], [70, 'Riverstream Video', '-15.49'], [100, 'Riverstream Video', '-15.49']], '900.00');
  await importStatement(ledger, 'alice', { fileName: 'older.csv', text: old, newAccount: NEW_ACCOUNT });
  const video = (await call(routes['GET /'], 'alice')).body.items[0];
  const yesterday = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10);
  await call(routes['POST /:seriesId/answer'], 'alice', { params: { seriesId: video.seriesId }, body: { answer: 'cancel', today: yesterday } });
  await pool.query("UPDATE finance_recurring_reviews SET answered_on = $1 WHERE user_sub = 'alice'", [yesterday]);
  const accountId = (await call(ledger['GET /accounts'], 'alice')).body.accounts[0].id;
  await importStatement(ledger, 'alice', { fileName: 'newer.csv', text: recentCsv([[10, 'Riverstream Video', '-15.49']], '880.00'), accountId });
  const again = (await call(routes['GET /'], 'alice')).body.items[0];
  assert.equal(again.chargedAgain, new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10));
});

test('migration 006 is plain and the recurring module keeps the kernel\'s statement shapes, creates no table and moves no money', () => {
  assert.deepEqual(declaredMigrations().slice(-1), ['migrations/006-recurring.sql']);
  const sql = fs.readFileSync(path.join(PKG, 'migrations', '006-recurring.sql'), 'utf8').replace(/^--.*$/gm, '');
  assert.ok(sql.split(';').map((s) => s.trim()).filter(Boolean).every((s) => /^CREATE TABLE IF NOT EXISTS |^CREATE INDEX IF NOT EXISTS /.test(s)));
  assert.doesNotMatch(sql, /ROW LEVEL SECURITY|POLICY|\bUNIQUE\b|\bREFERENCES\b|FOREIGN KEY|\bDO \$\$|\bTRIGGER\b|\bSERIAL\b/i);
  const code = fs.readFileSync(path.join(ROUTES, 'finance-recurring.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /\b(CREATE|ALTER|DROP|TRUNCATE)\s+(TABLE|INDEX|POLICY|SCHEMA)\b|createTransfer|getPaymentAdapter|orderAuthority|fetch\(/i);
  const { RECURRING_SQL } = requireWith(path.join(ROUTES, 'finance-recurring.js'), { express: { Router: () => ({}) }, '@/shared/logger': quiet });
  for (const [name, text] of Object.entries(RECURRING_SQL)) {
    assert.doesNotMatch(text, /ON CONFLICT|ORDER BY|GROUP BY|\bDISTINCT\b|\bJOIN\b|\bRETURNING\b|\bBEGIN\b|\(\s*SELECT\b/i, name);
    assert.match(text, /\buser_sub\b/, `${name} names the owner`);
  }
});
