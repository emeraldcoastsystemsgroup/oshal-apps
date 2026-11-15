/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Nothing is added twice. A statement downloaded again with the bank's own ids is recognised by those ids even when the bank rewrote a description. On a disposable PostgreSQL through the compiled routes: the same file added again previews every line as already there and adds none; two identical lines of one statement are both kept and both recognised the second time; a later file that overlaps an earlier one adds only what is new; the same transactions arriving in another format (a CSV after an OFX with bank ids) are recognised by account, date, amount and description, and a third identical line beyond the two already held is new; an apply call repeated after it finished adds nothing, and a file larger than one call's 1,500 rows is added over two calls with nothing doubled; a typed transaction sent twice with the same request id is one transaction; the store's own insert skips a duplicate inside a run and keeps the rest. Synthetic statements only. Run: OSHAL_TEST_POSTGRES=... node --test tests/ledger-dedupe.test.cjs
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ROUTES, database, ledgerRoutes, call, statement, importStatement } = require('./ledger.fixture.cjs');

const store = require(path.join(ROUTES, 'finance-ledger-store.js'));
const count = async (pool, table = 'finance_transactions') => (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

test('the same file again adds nothing, and identical lines of one statement are both kept', async (t) => {
  const pool = await database(t);
  const routes = ledgerRoutes(pool);
  const first = await importStatement(routes, 'alice', { fileName: 'harbor.csv', text: statement('harbor-checking.csv'), newAccount: { name: 'Everyday Checking', institution: 'Harbor Bank' } });
  assert.equal(first.applied.added, 8);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM finance_transactions WHERE description = 'Corner Trattoria' AND amount_cents = 5280")).rows[0].n, 2, 'two identical charges on one day are two transactions');

  const again = await call(routes['POST /imports/preview'], 'alice', { body: { fileName: 'harbor.csv', text: statement('harbor-checking.csv'), accountId: first.applied.accountId } });
  assert.deepEqual(again.body.counts, { total: 8, toAdd: 0, duplicate: 8, closedMonth: 0, unreadable: 2 });
  assert.equal(again.body.button, 'Add 0 transactions');
  assert.ok(again.body.rows.every((row) => row.status === 'duplicate'));
  const applied = await call(routes['POST /imports/:id/apply'], 'alice', { params: { id: again.body.importId }, body: { confirm: true } });
  assert.deepEqual([applied.body.added, applied.body.duplicate, applied.body.state], [0, 8, 'applied']);
  assert.equal(await count(pool), 8);

  const overlap = 'Date,Description,Amount\n11/02/2026,Harbor Market,-41.10\n10/31/2026,"Harbor Market #12, Main St",-84.31\n10/30/2026,City Utilities,-112.40\n';
  const later = await importStatement(routes, 'alice', { fileName: 'harbor-nov.csv', text: overlap, accountId: first.applied.accountId });
  assert.deepEqual([later.preview.counts.toAdd, later.preview.counts.duplicate, later.applied.added], [1, 2, 1], 'an overlapping file adds only what is new');
  assert.equal(await count(pool), 9);
  const repeat = await call(routes['POST /imports/:id/apply'], 'alice', { params: { id: later.preview.importId }, body: { confirm: true } });
  assert.deepEqual([repeat.statusCode, repeat.body.added, repeat.body.state], [200, 0, 'applied'], 'an apply call repeated after it finished adds nothing');
  assert.equal(await count(pool), 9);
});

test('the same transactions in another format are recognised by account, date, amount and description', async (t) => {
  const pool = await database(t);
  const routes = ledgerRoutes(pool);
  const first = await importStatement(routes, 'alice', { fileName: 'harbor.ofx', text: statement('harbor-checking.ofx') });
  assert.equal(first.applied.added, 4);
  const sameAsCsv = 'Date,Description,Amount\n10/30/2026,city utilities,-112.40\n10/01/2026,MAPLE COURT APARTMENTS,-1450.00\n10/01/2026,MAPLE COURT APARTMENTS,-1450.00\n';
  const second = await call(routes['POST /imports/preview'], 'alice', { body: { fileName: 'harbor.csv', text: sameAsCsv, accountId: first.applied.accountId } });
  assert.deepEqual(second.body.rows.map((row) => row.status), ['duplicate', 'duplicate', 'new'], 'one held, two in the file: the second is new');
  assert.deepEqual(second.body.counts, { total: 3, toAdd: 1, duplicate: 2, closedMonth: 0, unreadable: 0 });

  const renamed = statement('harbor-checking.ofx').replace('<NAME>CITY UTILITIES', '<NAME>CITY UTIL *ONLINE PMT').replace('<NAME>MAPLE COURT APARTMENTS', '<NAME>MAPLE CT APTS');
  const third = await call(routes['POST /imports/preview'], 'alice', { body: { fileName: 'harbor-again.ofx', text: renamed } });
  assert.deepEqual(third.body.rows.map((row) => row.status), ['duplicate', 'duplicate', 'duplicate', 'duplicate'], 'the bank\'s own id decides, even when the bank rewrote the description');
});

test('a file larger than one call is added over two calls with nothing doubled', async (t) => {
  const pool = await database(t);
  const routes = ledgerRoutes(pool);
  const lines = Array.from({ length: 1700 }, (_, i) => `2026-${String(1 + (i % 9)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')},Shop ${i},-${(1 + i / 100).toFixed(2)}`);
  const preview = await call(routes['POST /imports/preview'], 'alice', { body: { fileName: 'year.csv', text: 'Date,Description,Amount\n' + lines.join('\n'), newAccount: { name: 'Everyday Checking' } } });
  assert.equal(preview.body.counts.toAdd, 1700);
  assert.equal(preview.body.rowsShown, 200, 'a preview answers its first lines; the counts cover the whole file');
  const one = await call(routes['POST /imports/:id/apply'], 'alice', { params: { id: preview.body.importId }, body: { confirm: true } });
  assert.deepEqual([one.body.state, one.body.added, one.body.remaining], ['applying', 1500, 200]);
  const two = await call(routes['POST /imports/:id/apply'], 'alice', { params: { id: preview.body.importId }, body: { confirm: true } });
  assert.deepEqual([two.body.state, two.body.added, two.body.addedTotal, two.body.remaining], ['applied', 200, 1700, 0]);
  assert.equal(await count(pool), 1700);
  assert.equal(await count(pool, 'finance_accounts'), 1, 'both calls wrote to the one account the preview proposed');
});

test('a typed transaction sent twice is one transaction, and the store skips a duplicate inside a run', async (t) => {
  const pool = await database(t);
  const routes = ledgerRoutes(pool);
  const account = (await call(routes['POST /accounts'], 'alice', { body: { name: 'Cash', type: 'depository' } })).body.account;
  const body = { accountId: account.id, date: '2026-10-05', amountCents: 2500, direction: 'out', description: 'Farm stand', requestId: 'press-1' };
  const first = await call(routes['POST /transactions'], 'alice', { body });
  const second = await call(routes['POST /transactions'], 'alice', { body });
  assert.deepEqual([first.statusCode, second.statusCode, first.body.transaction.id === second.body.transaction.id], [200, 200, true]);
  assert.equal(await count(pool), 1);

  const held = (await store.listTransactions(pool, 'alice', 'home', '2026-10'))[0];
  const fresh = (n) => ({ ...held, txnId: store.transactionId(account.id, { date: held.date, amountCents: n, direction: 'out', description: 'Run', position: 0 }), amountCents: n, description: 'Run' });
  const run = [fresh(1), held, fresh(2), fresh(1)];
  assert.deepEqual(await store.insertTransactions(pool, 'alice', run), { added: 2, skipped: 2 }, 'a duplicate in a run is skipped and the rest are kept');
  assert.equal(await count(pool), 3);
});
