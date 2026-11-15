/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | An import can be taken back. On a disposable PostgreSQL through the compiled routes: undo needs a confirm; it removes exactly that import's transactions, the account the import created and, with nothing left, the saved snapshot (so Finance reads as not set up, not as zeros); undone twice it answers the same and removes nothing; the file can be added again afterwards; an import into an account the person already had restores the balance it replaced and keeps the account and its other transactions; another person cannot undo it; a preview that was never applied can be discarded; and a month that is closed refuses the undo, a typed transaction and a change in the words the screen shows, while a preview counts those lines as in a closed month and adds none. A bank link's and the sample's records are not undone here. Synthetic statements only. Run: OSHAL_TEST_POSTGRES=... node --test tests/ledger-undo.test.cjs
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ROUTES, database, ledgerRoutes, call, statement, importStatement } = require('./ledger.fixture.cjs');

const store = require(path.join(ROUTES, 'finance-ledger-store.js'));
const count = async (pool, table) => (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

test('undo removes the import\'s transactions, the account it created and the empty snapshot; the file can be added again', async (t) => {
  const pool = await database(t);
  const routes = ledgerRoutes(pool);
  const first = await importStatement(routes, 'alice', { fileName: 'harbor.ofx', text: statement('harbor-checking.ofx') });
  assert.equal(await count(pool, 'finance_transactions'), 4);
  assert.equal(await count(pool, 'oshal_finance_data'), 1, 'the import saved a snapshot');

  const unconfirmed = await call(routes['POST /imports/:id/undo'], 'alice', { params: { id: first.preview.importId }, body: {} });
  assert.deepEqual([unconfirmed.statusCode, unconfirmed.body.message], [400, 'Undoing this import needs your confirmation.']);
  assert.equal((await call(routes['POST /imports/:id/undo'], 'bob', { params: { id: first.preview.importId }, body: { confirm: true } })).statusCode, 404, 'another person cannot undo it');
  assert.equal(await count(pool, 'finance_transactions'), 4);

  const undone = await call(routes['POST /imports/:id/undo'], 'alice', { params: { id: first.preview.importId }, body: { confirm: true } });
  assert.deepEqual([undone.statusCode, undone.body.state, undone.body.removed], [200, 'undone', 4]);
  assert.deepEqual([await count(pool, 'finance_transactions'), await count(pool, 'finance_accounts'), await count(pool, 'oshal_finance_data')], [0, 0, 0]);
  const again = await call(routes['POST /imports/:id/undo'], 'alice', { params: { id: first.preview.importId }, body: { confirm: true } });
  assert.deepEqual([again.statusCode, again.body.state, again.body.removed], [200, 'undone', 0], 'undone twice answers the same');
  const reapply = await call(routes['POST /imports/:id/apply'], 'alice', { params: { id: first.preview.importId }, body: { confirm: true } });
  assert.deepEqual([reapply.statusCode, reapply.body.message], [409, 'This import was undone. Add the file again to bring its transactions back.']);
  const list = (await call(routes['GET /imports'], 'alice')).body.imports;
  assert.deepEqual([list[0].state, list[0].canUndo, list[0].counts.added], ['undone', false, 0]);

  const second = await importStatement(routes, 'alice', { fileName: 'harbor.ofx', text: statement('harbor-checking.ofx') });
  assert.equal(second.applied.added, 4, 'the file can be added again');
});

test('undo restores the balance an import replaced and keeps what else stands on the account', async (t) => {
  const pool = await database(t);
  const routes = ledgerRoutes(pool);
  const typed = (await call(routes['POST /accounts'], 'alice', { body: { name: 'Everyday Checking', institution: 'Harbor Bank', type: 'depository', balanceCents: 100000, balanceAsOf: '2026-09-30' } })).body.account;
  await call(routes['POST /transactions'], 'alice', { body: { accountId: typed.id, date: '2026-10-03', amountCents: 1500, direction: 'out', description: 'Farm stand' } });
  const csv = await importStatement(routes, 'alice', { fileName: 'harbor.csv', text: statement('harbor-checking.csv'), accountId: typed.id });
  const after = (await call(routes['GET /accounts'], 'alice')).body.accounts[0];
  assert.deepEqual([after.balance.cents, after.balance.asOf, after.balance.sourceKind], [482044, '2026-10-31', 'import']);

  const undone = await call(routes['POST /imports/:id/undo'], 'alice', { params: { id: csv.preview.importId }, body: { confirm: true } });
  assert.equal(undone.body.removed, 8);
  const restored = (await call(routes['GET /accounts'], 'alice')).body.accounts[0];
  assert.deepEqual([restored.id, restored.balance.cents, restored.balance.asOf, restored.balance.source, restored.posture], [typed.id, 100000, '2026-09-30', 'Typed by you', 'typed']);
  assert.equal(await count(pool, 'finance_transactions'), 1, 'the transaction the person typed stays');
  assert.equal(await count(pool, 'oshal_finance_data'), 1, 'and the snapshot is rebuilt, not removed');

  const waiting = await call(routes['POST /imports/preview'], 'alice', { body: { fileName: 'harbor.csv', text: statement('harbor-checking.csv'), accountId: typed.id } });
  const discarded = await call(routes['POST /imports/:id/undo'], 'alice', { params: { id: waiting.body.importId }, body: { confirm: true } });
  assert.deepEqual([discarded.body.state, discarded.body.removed], ['undone', 0], 'a preview that was never applied can be discarded');
});

test('a closed month refuses changes in words, and a bank link or the sample is not undone here', async (t) => {
  const pool = await database(t);
  const routes = ledgerRoutes(pool);
  const first = await importStatement(routes, 'alice', { fileName: 'harbor.csv', text: statement('harbor-checking.csv'), newAccount: { name: 'Everyday Checking' } });
  const book = await store.readBook(pool, 'alice', 'home');
  await store.saveBook(pool, 'alice', { ...book, closedThrough: '2026-10' });
  const closed = 'October 2026 is closed. Reopen it to change this.';
  const undo = await call(routes['POST /imports/:id/undo'], 'alice', { params: { id: first.preview.importId }, body: { confirm: true } });
  assert.deepEqual([undo.statusCode, undo.body.error, undo.body.message], [409, 'month_closed', closed]);
  assert.equal(await count(pool, 'finance_transactions'), 8, 'nothing was removed');
  const typed = await call(routes['POST /transactions'], 'alice', { body: { accountId: first.applied.accountId, date: '2026-10-09', amountCents: 500, direction: 'out', description: 'Late entry' } });
  assert.deepEqual([typed.statusCode, typed.body.message], [409, closed]);
  const txn = (await store.listTransactions(pool, 'alice', 'home', '2026-10'))[0];
  const change = await call(routes['POST /transactions/:id'], 'alice', { params: { id: txn.txnId }, body: { category: 'Other' } });
  assert.deepEqual([change.statusCode, change.body.message], [409, closed]);
  const more = await call(routes['POST /imports/preview'], 'alice', { body: { fileName: 'more.csv', text: 'Date,Description,Amount\n10/20/2026,Late line,-9.00\n11/03/2026,Harbor Market,-20.00\n', accountId: first.applied.accountId } });
  assert.deepEqual(more.body.counts, { total: 2, toAdd: 1, duplicate: 0, closedMonth: 1, unreadable: 0 });
  const applied = await call(routes['POST /imports/:id/apply'], 'alice', { params: { id: more.body.importId }, body: { confirm: true } });
  assert.equal(applied.body.added, 1, 'the line in the closed month is not added');

  const now = store.nowStamp();
  const record = (importId, kind) => ({ importId, bookId: 'home', accountId: '', newAccount: null, kind, fileName: kind, fingerprint: '', periodStart: null, periodEnd: null, rowsTotal: 0, rowsNew: 0, rowsDuplicate: 0, rowsUnreadable: 0, rowsAdded: 0, closingBalanceCents: null, closingBalanceAsOf: null, columnMap: null, pending: null, state: 'applied', docId: '', createdAt: now, appliedAt: now, undoneAt: null });
  await store.insertImport(pool, 'alice', record('imp_link', 'plaid'));
  await store.insertImport(pool, 'alice', record('imp_sample', 'sample'));
  const link = await call(routes['POST /imports/:id/undo'], 'alice', { params: { id: 'imp_link' }, body: { confirm: true } });
  assert.deepEqual([link.statusCode, link.body.message], [409, 'These transactions came from a bank link. Remove the link on Linked banks to stop reading that bank.']);
  const sample = await call(routes['POST /imports/:id/undo'], 'alice', { params: { id: 'imp_sample' }, body: { confirm: true } });
  assert.deepEqual([sample.statusCode, sample.body.message], [409, 'Only a statement you added can be undone here.']);
});
