/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | A person's own records through the compiled ledger routes on a disposable PostgreSQL. Typed entry: an account with or without a balance, a balance typed later with its date (never a future one), a transaction, its category, reviewed, note and "not mine", a remembered "description contains X means category Y" that the next import uses, and a typed transaction removed (an imported one is not removed here). Two people never meet: each person's reads answer only their own records and a write naming another person's account, transaction or import is answered as not found and changes nothing. A read never writes: every statement a GET issues is a SELECT. Refusals are sentences. Every amount in every answer is a figure with its source and date. Run: OSHAL_TEST_POSTGRES=... node --test tests/ledger-records.test.cjs
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { database, ledgerRoutes, call, statement, day, importStatement, assertFigures } = require('./ledger.fixture.cjs');

test('a person types an account, a balance and a transaction, reviews it and teaches a category', async (t) => {
  const pool = await database(t);
  const routes = ledgerRoutes(pool);
  const added = await call(routes['POST /accounts'], 'alice', { body: { name: '  Everyday   Checking ', institution: 'Harbor Bank', type: 'depository', subtype: 'checking', last4: '0001-1122-4821' } });
  assert.equal(added.statusCode, 200, JSON.stringify(added.body));
  const account = added.body.account;
  assert.deepEqual([account.name, account.last4, account.balance, account.balanceNote, account.source, account.posture], ['Everyday Checking', '4821', null, 'Not known yet', 'typed', 'typed']);
  const typed = await call(routes['POST /accounts'], 'alice', { body: { accountId: account.id, balanceCents: 250000, balanceAsOf: day(1) } });
  assert.deepEqual(typed.body.account.balance, { cents: 250000, currency: 'USD', source: 'Typed by you', sourceKind: 'typed', asOf: day(1), posture: 'typed' });
  const refusals = [
    [{ name: '' }, 'Give the account a name.'], [{ name: 'X', type: 'wallet' }, 'An account is one of: depository, credit, loan, investment, other.'],
    [{ name: 'X', balanceCents: 10.5 }, 'A balance is a whole number of cents.'], [{ name: 'X', balanceCents: 100, balanceAsOf: '2099-01-01' }, 'The balance date must be a real date, today or earlier.'],
    [{ accountId: 'acct_missing', name: 'X' }, 'That account is not in your records.'],
  ];
  for (const [body, message] of refusals) assert.equal((await call(routes['POST /accounts'], 'alice', { body })).body.message, message);

  const txn = await call(routes['POST /transactions'], 'alice', { body: { accountId: account.id, date: day(2), amountCents: 4310, direction: 'out', description: 'Trailhead Outfitters', note: 'boots' } });
  assert.equal(txn.statusCode, 200, JSON.stringify(txn.body));
  assert.deepEqual([txn.body.transaction.amount, txn.body.transaction.review, txn.body.transaction.category, txn.body.transaction.note], [{ cents: 4310, currency: 'USD', source: 'Typed by you', sourceKind: 'typed', asOf: day(2), posture: 'typed' }, 'reviewed', 'Other', 'boots']);
  for (const [body, message] of [[{ date: 'soon' }, 'A transaction needs a real date.'], [{ amountCents: -5 }, 'An amount is a whole number of cents above zero.'], [{ direction: 'sideways' }, 'Say whether the money came in or went out.'], [{ description: ' ' }, 'Say what the transaction was.'], [{ accountId: 'acct_missing' }, 'Choose one of your accounts for this transaction.']]) {
    const res = await call(routes['POST /transactions'], 'alice', { body: { accountId: account.id, date: day(2), amountCents: 100, direction: 'out', description: 'Thing', ...body } });
    assert.deepEqual([res.statusCode >= 400, res.body.message], [true, message]);
  }

  const id = txn.body.transaction.id;
  const changed = await call(routes['POST /transactions/:id'], 'alice', { params: { id }, body: { category: 'Outdoors', reviewed: false, notMine: true, note: 'check this', remember: true } });
  assert.deepEqual([changed.body.transaction.category, changed.body.transaction.categorySource, changed.body.transaction.review, changed.body.transaction.flags, changed.body.transaction.note], ['Outdoors', 'person', 'new', ['not-mine'], 'check this']);
  const mine = await call(routes['POST /transactions/:id'], 'alice', { params: { id }, body: { notMine: false, reviewed: true } });
  assert.deepEqual([mine.body.transaction.flags, mine.body.transaction.review, mine.body.transaction.category], [[], 'reviewed', 'Outdoors']);
  const next = await call(routes['POST /imports/preview'], 'alice', { body: { fileName: 'more.csv', text: `Date,Description,Amount\n${day(3)},TRAILHEAD OUTFITTERS #4,-20.00\n${day(3)},Unknown Shop,-5.00\n`, accountId: account.id } });
  assert.deepEqual(next.body.rows.map((row) => [row.category, row.categorySource]), [['Outdoors', 'rule'], ['Other', 'guess']], 'the remembered rule names the next import\'s category');

  const month = (await call(routes['GET /transactions'], 'alice', { query: { month: day(2).slice(0, 7) } })).body;
  assert.equal(assertFigures(month), month.transactions.length);
  assert.deepEqual((await call(routes['GET /transactions'], 'alice', { query: { month: 'October' } })).body.message, 'A month is written YYYY-MM.');
  assert.deepEqual((await call(routes['GET /accounts'], 'alice', { query: { book: 'someone-else' } })).body.message, 'Finance keeps two sets of records: home and business.');
  const removed = await call(routes['POST /transactions/:id'], 'alice', { params: { id }, body: { remove: true } });
  assert.deepEqual(removed.body, { ok: true, removed: true });
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM finance_transactions')).rows[0].n, 0);
});

test('two people never meet, and a read never writes', async (t) => {
  const pool = await database(t);
  const statements = [];
  const recording = { query: (text, values) => { statements.push(String(text).trim().split(/\s+/)[0].toUpperCase()); return pool.query(text, values); } };
  const routes = ledgerRoutes(recording);
  const alice = await importStatement(routes, 'alice', { fileName: 'harbor.ofx', text: statement('harbor-checking.ofx') });
  const bob = await importStatement(routes, 'bob', { fileName: 'harbor.ofx', text: statement('harbor-checking.ofx') });
  assert.notEqual(alice.applied.accountId, bob.applied.accountId, 'the same statement in two people\'s hands is two accounts');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM finance_transactions')).rows[0].n, 8, 'and two sets of transactions, none refused as the other\'s duplicate');
  const aliceTxn = (await call(routes['GET /transactions'], 'alice', { query: { month: '2026-10' } })).body.transactions[0];

  const asBob = async (route, request) => call(routes[route], 'bob', request);
  assert.equal((await asBob('POST /transactions/:id', { params: { id: aliceTxn.id }, body: { category: 'Mine now' } })).statusCode, 404);
  assert.equal((await asBob('POST /transactions', { body: { accountId: alice.applied.accountId, date: '2026-10-09', amountCents: 100, direction: 'out', description: 'Intrusion' } })).statusCode, 404);
  assert.equal((await asBob('POST /accounts', { body: { accountId: alice.applied.accountId, balanceCents: 1, balanceAsOf: '2026-10-31' } })).statusCode, 404);
  assert.equal((await asBob('POST /imports/preview', { body: { fileName: 'x.csv', text: 'Date,Description,Amount\n10/09/2026,Intrusion,-1.00\n', accountId: alice.applied.accountId } })).statusCode, 404);
  assert.equal((await asBob('POST /imports/:id/undo', { params: { id: alice.preview.importId }, body: { confirm: true } })).statusCode, 404);
  assert.equal((await asBob('GET /imports/:id', { params: { id: alice.preview.importId } })).statusCode, 404);
  const still = (await call(routes['GET /transactions'], 'alice', { query: { month: '2026-10' } })).body;
  assert.deepEqual([still.transactions.length, still.transactions[0].category], [4, aliceTxn.category], 'nothing of alice\'s changed');
  assert.deepEqual((await asBob('GET /transactions', { query: { month: '2026-10' } })).body.transactions.map((row) => row.accountId), Array(4).fill(bob.applied.accountId));
  assert.equal((await call(routes['GET /accounts'], 'carol')).body.accounts.length, 0);
  assert.deepEqual((await call(routes['GET /transactions'], 'carol')).body.transactions, []);
  for (const route of ['GET /accounts', 'GET /transactions', 'GET /imports', 'POST /accounts', 'POST /transactions', 'POST /imports/preview']) assert.equal((await call(routes[route], null)).statusCode, 401, `${route} needs a signed-in person`);

  statements.length = 0;
  await call(routes['GET /accounts'], 'alice');
  await call(routes['GET /transactions'], 'alice', { query: { month: '2026-10' } });
  await call(routes['GET /transactions'], 'alice');
  await call(routes['GET /imports'], 'alice');
  await call(routes['GET /imports/:id'], 'alice', { params: { id: alice.preview.importId } });
  for (const route of ['GET /accounts', 'GET /transactions', 'GET /imports']) assert.equal((await call(routes[route], 'dave-never-seen')).statusCode, 200, `${route} answers a person with no records`);
  assert.ok(statements.length >= 8);
  assert.deepEqual([...new Set(statements)], ['SELECT'], 'a GET only reads: on the native kernel a GET cannot write');
});
