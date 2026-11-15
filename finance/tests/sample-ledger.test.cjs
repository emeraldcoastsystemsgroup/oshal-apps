/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The demo's sample household is records, so a trial opens on a day with things to do. On a disposable PostgreSQL through the unchanged POST /demo-data (behind FINANCE_DEMO_DATA): seven named accounts with balances dated today, three months of dated transactions none of them in the future, exactly five still to review and one of those larger than twice what is usual at its merchant, a rent and a utility charge a month apart for the day lane to find, pay every two weeks and income in every month; every account and transaction is marked sample data and every amount answered carries that posture; the snapshot is rebuilt from them (sample, with holdings and its note); loading again on the same day changes nothing and never doubles; a person's own account and transaction survive a reload and the sample's removal; another person has nothing. The records are deterministic for a person and a day, and the paycheck names a made-up employer, not the owner's company. Run: OSHAL_TEST_POSTGRES=... node --test tests/sample-ledger.test.cjs
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Finance 1.7.0 on 1.6.5: POST /demo-data keeps writing 1.6.5's sample snapshot and also writes the same household (the same seven accounts and net worth) as records marked sample, without rebuilding the snapshot from them.
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROUTES, database, ledgerRoutes, financeRoutes, call, day, assertFigures } = require('./ledger.fixture.cjs');

const sample = require(path.join(ROUTES, 'finance-sample.js'));
const store = require(path.join(ROUTES, 'finance-ledger-store.js'));
const count = async (pool, where = '') => (await pool.query(`SELECT count(*)::int AS n FROM finance_transactions ${where}`)).rows[0].n;
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };

function withDemo(t) {
  const saved = process.env.FINANCE_DEMO_DATA;
  process.env.FINANCE_DEMO_DATA = '1';
  t.after(() => { if (saved === undefined) delete process.env.FINANCE_DEMO_DATA; else process.env.FINANCE_DEMO_DATA = saved; });
}

test('the sample is deterministic for a person and a day, and names a made-up employer', () => {
  const now = new Date('2026-11-12T15:00:00Z');
  const one = sample.sampleRecords('alice', now), two = sample.sampleRecords('alice', now), other = sample.sampleRecords('bob', now);
  assert.deepEqual(one.transactions.map((t) => t.txnId), two.transactions.map((t) => t.txnId));
  assert.equal(new Set(one.transactions.map((t) => t.txnId)).size, one.transactions.length, 'every sample transaction has its own id');
  assert.equal(one.transactions.some((t) => other.transactions.some((o) => o.txnId === t.txnId)), false, 'two people never share an id');
  assert.ok(one.transactions.some((t) => t.description === 'Paycheck Lakeside Design Co'));
  for (const file of ['finance-sample.js', 'finance-routes.js']) assert.equal(/Emerald Systems/i.test(fs.readFileSync(path.join(ROUTES, file), 'utf8')), false, `${file} does not name the owner's company`);
  for (const today of ['2026-11-01', '2026-11-02', '2026-11-16', '2026-11-17', '2026-11-24', '2026-11-25', '2027-01-03', '2027-03-01']) {
    const records = sample.sampleRecords('alice', new Date(`${today}T12:00:00Z`));
    const fresh = records.transactions.filter((t) => t.review === 'new');
    assert.equal(fresh.length, 5, `${today}: five to review`);
    assert.ok(fresh.some((t) => t.description === 'Harbor Dental' && t.amountCents === 41200), `${today}: the unusual charge is among them`);
    assert.ok(records.transactions.every((t) => t.date <= today), `${today}: nothing in the future`);
    const months = new Map();
    for (const t of records.transactions) if (t.category !== 'Transfer') months.set(t.month, (months.get(t.month) || 0) + (t.direction === 'in' ? t.amountCents : 0));
    assert.ok([...months.values()].every((income) => income > 0), `${today}: income in every month the sample touches`);
  }
});

test('demo data writes the 1.6.5 sample snapshot as before and the same household as records, marked as sample', async (t) => {
  withDemo(t);
  const pool = await database(t);
  const routes = financeRoutes(pool), ledger = ledgerRoutes(pool);
  const loaded = await call(routes['POST /demo-data'], 'alice');
  assert.equal(loaded.statusCode, 200, JSON.stringify(loaded.body));
  assert.deepEqual([loaded.body.ok, loaded.body.accounts, loaded.body.holdings], [true, 7, 4]);
  assert.ok(loaded.body.netWorth.net > 0 && loaded.body.transactions > 60);

  const accounts = (await call(ledger['GET /accounts'], 'alice')).body;
  assert.equal(accounts.accounts.length, 7);
  assert.ok(accounts.accounts.every((a) => a.source === 'sample' && a.posture === 'sample' && a.balance.source === 'Sample data' && a.balance.asOf === day(0) && a.last4.length === 4));
  assert.deepEqual([accounts.netWorth.net.posture, accounts.netWorth.net.source, accounts.netWorth.net.cents], ['sample', 'Sample data', 14856012]);
  assertFigures(accounts);

  const all = (await pool.query("SELECT * FROM finance_transactions WHERE user_sub = 'alice'")).rows;
  assert.equal(all.length, loaded.body.transactions);
  assert.ok(all.every((row) => row.source === 'sample' && row.posture === 'sample' && row.source_label === 'Sample data' && row.txn_date <= day(0)));
  assert.ok(new Set(all.map((row) => row.month)).size >= 3, 'three months of transactions');
  assert.ok(all.some((row) => row.txn_date <= day(85)), 'reaching back about three months');
  const fresh = all.filter((row) => row.review === 'new');
  assert.equal(fresh.length, 5);
  const dental = all.filter((row) => row.description === 'Harbor Dental').map((row) => Number(row.amount_cents));
  const unusual = fresh.find((row) => row.description === 'Harbor Dental');
  assert.ok(unusual && Number(unusual.amount_cents) > 5000 && Number(unusual.amount_cents) > 2 * median(dental.filter((cents) => cents !== Number(unusual.amount_cents))), 'one charge to review is larger than twice the usual there');
  for (const payee of ['Maple Court Apartments', 'City Utilities']) {
    const dates = all.filter((row) => row.description === payee).map((row) => row.txn_date).sort();
    assert.ok(dates.length >= 2, `${payee} repeats`);
    const gap = (new Date(dates[1]) - new Date(dates[0])) / 86400000;
    assert.ok(gap >= 26 && gap <= 33, `${payee} is charged a month apart (${gap} days)`);
  }
  const month = (await call(ledger['GET /transactions'], 'alice')).body;
  assert.ok(month.transactions.length > 0 && month.transactions.every((row) => row.amount.posture === 'sample'));
  assert.equal(month.month, day(0).slice(0, 7), 'with no month named, the newest month that has records');
  assertFigures(month);

  const agg = (await pool.query("SELECT aggregate FROM oshal_finance_data WHERE user_sub = 'alice'")).rows[0].aggregate;
  assert.deepEqual([agg.sourceEnvironment, agg.accounts.length, agg.holdings.length, agg.netWorth.net], ['sample', 7, 4, 148560.12]);
  assert.equal(agg.ledger, undefined, 'the saved snapshot is the one 1.6.5 writes, not rebuilt from the records');
  assert.ok(agg.notes.some((note) => /sample data/i.test(note)));
  assert.ok(agg.spendByMonth.length >= 3 && agg.spendByMonth.every((m) => m.income > 0 && m.spend > 0));
  assert.equal(agg.topSpending.some((c) => c.category === 'Transfer'), false);

  const before = await count(pool);
  assert.equal((await call(routes['POST /demo-data'], 'alice')).statusCode, 200);
  assert.equal(await count(pool), before, 'loading again never doubles the sample');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM finance_accounts')).rows[0].n, 7);
  assert.equal((await call(ledger['GET /accounts'], 'bob')).body.accounts.length, 0, 'another person has nothing');
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM oshal_finance_data WHERE user_sub <> 'alice'")).rows[0].n, 0);
});

test('a person\'s own records survive a reload and the sample\'s removal', async (t) => {
  withDemo(t);
  const pool = await database(t);
  const routes = financeRoutes(pool), ledger = ledgerRoutes(pool);
  const own = (await call(ledger['POST /accounts'], 'alice', { body: { name: 'My Cash', type: 'depository', balanceCents: 5000, balanceAsOf: day(0) } })).body.account;
  await call(ledger['POST /transactions'], 'alice', { body: { accountId: own.id, date: day(1), amountCents: 700, direction: 'out', description: 'Farm stand' } });
  await call(routes['POST /demo-data'], 'alice');
  await call(routes['POST /demo-data'], 'alice');
  assert.equal(await count(pool, "WHERE source = 'typed'"), 1);
  const refused = await call(ledger['POST /accounts'], 'alice', { body: { accountId: store.hashId('acct', 'alice', 'sample', 'checking'), balanceCents: 1, balanceAsOf: day(0) } });
  assert.deepEqual([refused.statusCode, refused.body.message], [409, 'This is a sample account. Add your own account to keep your own figures.']);
  assert.ok(await sample.clearSample(pool, 'alice') > 60);
  assert.deepEqual([await count(pool, "WHERE source = 'sample'"), await count(pool, "WHERE source = 'typed'")], [0, 1]);
  const left = (await call(ledger['GET /accounts'], 'alice')).body.accounts;
  assert.deepEqual(left.map((a) => [a.name, a.source]), [['My Cash', 'typed']]);
  assert.equal(await sample.clearSample(pool, 'alice'), 0, 'removing it twice removes nothing');
});
