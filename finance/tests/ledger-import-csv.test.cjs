/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | A bank's CSV export becomes transactions with no bank connection. The reader: columns guessed from their names, a signed amount or separate in and out columns, a preamble before the header, day-first dates, quoted cells, a balance column as the closing balance, each unreadable line listed with its number and reason, and refusals in words (empty, not text, too large, too many rows, no readable line). Through the compiled routes on a disposable PostgreSQL: preview writes only the preview record, apply needs confirm and adds the rows, the account takes the statement's closing balance with its date and source, a file with unnamed columns asks for them once and the map is remembered for that account, every amount answered is a figure with a source and a date, and another person sees none of it. Synthetic statements only. Run: OSHAL_TEST_POSTGRES=... node --test tests/ledger-import-csv.test.cjs
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ROUTES, database, ledgerRoutes, call, statement, assertFigures } = require('./ledger.fixture.cjs');

const csv = require(path.join(ROUTES, 'finance-parse-csv.js'));

test('the reader guesses columns by name, reads signed amounts and lists every line it could not read', () => {
  const read = csv.parseCsv(statement('harbor-checking.csv'));
  assert.equal(read.ok, true);
  assert.equal(read.kind, 'csv');
  assert.deepEqual(read.columnMap, { date: 0, description: 1, amount: 2, balance: 3 });
  assert.equal(read.rows.length, 8);
  assert.deepEqual(read.rows[0], { line: 2, date: '2026-10-31', amountCents: 8431, direction: 'out', description: 'Harbor Market #12, Main St', balanceCents: 482044 });
  const pay = read.rows.find((row) => row.description.startsWith('Payroll'));
  assert.deepEqual([pay.amountCents, pay.direction], [320000, 'in'], 'a quoted amount with a thousands comma is money in');
  assert.deepEqual([read.rows.find((row) => row.description === 'Corner Fuel').amountCents, read.rows.find((row) => row.description === 'Corner Fuel').direction], [3855, 'out'], 'parentheses mean money out');
  assert.deepEqual(read.unreadable, [{ line: 10, reason: 'no date in "not a date"' }, { line: 11, reason: 'the amount is zero' }]);
  assert.equal(read.unreadableCount, 2);
  assert.deepEqual(read.period, { start: '2026-10-01', end: '2026-10-31' });
  assert.deepEqual(read.closingBalance, { cents: 482044, asOf: '2026-10-31' }, 'the balance beside the newest line');
});

test('a preamble, a semicolon delimiter, separate in and out columns and day-first dates are read', () => {
  const read = csv.parseCsv(statement('coastal-savings.csv'));
  assert.equal(read.ok, true);
  assert.deepEqual(read.columnMap, { date: 0, description: 1, moneyIn: 3, moneyOut: 2, balance: 4 });
  assert.deepEqual(read.rows.map((row) => [row.date, row.direction, row.amountCents]), [['2026-10-01', 'in', 412], ['2026-09-20', 'out', 25000]]);
  assert.equal(read.unreadable[0].line, 6, 'an amount written 300,00 is listed, not guessed');
});

test('amounts and dates are read exactly or not at all', () => {
  const cents = (text) => csv.parseAmountCents(text);
  assert.deepEqual(['1,234.56', '(45.00)', '-12.30', '12.30-', '$1,200', '45.00 CR', '45.00 DR', '.50'].map(cents), [123456, -4500, -1230, -1230, 120000, 4500, -4500, 50]);
  assert.deepEqual(['12.345', 'abc', '1,23', '', '0.1.2'].map(cents), [null, null, null, null, null]);
  assert.equal(cents('0.29') + cents('0.57'), 86, 'whole cents, no floating point');
  const date = (text, dayFirst) => csv.parseStatementDate(text, dayFirst);
  assert.deepEqual(['2026-10-31', '10/31/2026', '10/31/26', '31 Oct 2026', 'Oct 31, 2026', '20261031'].map((d) => date(d)), Array(6).fill('2026-10-31'));
  assert.equal(date('03/04/2026', true), '2026-04-03');
  assert.deepEqual(['13/13/2026', '2026-02-30', 'soon'].map((d) => date(d)), [null, null, null]);
});

test('a file the reader cannot use is refused in words that say why', () => {
  assert.equal(csv.parseCsv('').message, 'This file is empty.');
  assert.match(csv.parseCsv('a\u0000b,c').message, /not text/);
  assert.match(csv.parseCsv('x'.repeat(csv.MAX_IMPORT_BYTES + 1)).message, /larger than 2 MB/);
  assert.equal(csv.parseCsv('Date,Description,Amount\nxx,yy,zz\n').message, 'Finance could not read any transaction in this file. Line 2 stopped it: no date in "xx".');
  const many = 'Date,Description,Amount\n' + Array.from({ length: csv.MAX_IMPORT_ROWS + 1 }, (_, i) => `2026-10-01,Row ${i},-1.00`).join('\n');
  assert.match(csv.parseCsv(many).message, /has 2,001 transactions\. Finance reads up to 2,000 from one file/);
});

test('preview writes only the preview record; apply needs a confirm, adds the rows and brings the account to the closing balance', async (t) => {
  const pool = await database(t);
  const routes = ledgerRoutes(pool);
  const preview = await call(routes['POST /imports/preview'], 'alice', { body: { fileName: 'harbor-checking.csv', text: statement('harbor-checking.csv'), newAccount: { name: 'Everyday Checking', institution: 'Harbor Bank', type: 'depository', subtype: 'checking', last4: '000111224821' } } });
  assert.equal(preview.statusCode, 200, JSON.stringify(preview.body));
  assert.deepEqual(preview.body.counts, { total: 8, toAdd: 8, duplicate: 0, closedMonth: 0, unreadable: 2 });
  assert.equal(preview.body.button, 'Add 8 transactions');
  assert.equal(preview.body.account.isNew, true);
  assert.equal(preview.body.account.last4, '4821', 'only the last four digits of an account number are kept');
  assert.deepEqual(preview.body.closingBalance, { cents: 482044, currency: 'USD', source: 'Harbor Bank statement', sourceKind: 'import', asOf: '2026-10-31', posture: null });
  assert.equal(assertFigures(preview.body) >= 9, true);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM finance_transactions')).rows[0].n, 0, 'a preview adds no transaction');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM finance_accounts')).rows[0].n, 0, 'and no account');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM finance_imports')).rows[0].n, 1, 'only the preview record');

  const unconfirmed = await call(routes['POST /imports/:id/apply'], 'alice', { params: { id: preview.body.importId }, body: {} });
  assert.equal(unconfirmed.statusCode, 400);
  assert.equal(unconfirmed.body.message, 'Adding these transactions needs your confirmation.');
  const applied = await call(routes['POST /imports/:id/apply'], 'alice', { params: { id: preview.body.importId }, body: { confirm: true } });
  assert.deepEqual([applied.statusCode, applied.body.state, applied.body.added, applied.body.remaining], [200, 'applied', 8, 0], JSON.stringify(applied.body));

  const accounts = await call(routes['GET /accounts'], 'alice');
  assert.equal(accounts.body.accounts.length, 1);
  assert.deepEqual(accounts.body.accounts[0].balance, { cents: 482044, currency: 'USD', source: 'Harbor Bank statement', sourceKind: 'import', asOf: '2026-10-31', posture: null });
  assert.equal(accounts.body.netWorth.net.cents, 482044);
  assertFigures(accounts.body);
  const month = await call(routes['GET /transactions'], 'alice', { query: { month: '2026-10' } });
  assert.equal(month.body.transactions.length, 8);
  assert.deepEqual(month.body.counts, { total: 8, toReview: 8 });
  assert.equal(month.body.transactions[0].date, '2026-10-31', 'newest first');
  assert.deepEqual(month.body.transactions[0].amount, { cents: 8431, currency: 'USD', source: 'Harbor Bank statement', sourceKind: 'import', asOf: '2026-10-31', posture: null });
  assert.equal(month.body.transactions.find((row) => row.description === 'City Utilities').category, 'Utilities');
  assert.equal(month.body.transactions.find((row) => row.description === 'City Utilities').categorySource, 'guess', 'a category from plain words says it is a guess');
  assert.equal(assertFigures(month.body), 8);
  const stored = (await pool.query('SELECT pending, state, rows_added FROM finance_imports')).rows[0];
  assert.deepEqual([stored.pending, stored.state, stored.rows_added], [null, 'applied', 8], 'the read rows are not kept once they are in the records');
  assert.equal(JSON.stringify((await pool.query('SELECT * FROM finance_accounts')).rows).includes('000111224821'), false, 'the full account number is stored nowhere');

  for (const read of ['GET /accounts', 'GET /transactions', 'GET /imports']) {
    const theirs = await call(routes[read], 'bob', { query: { month: '2026-10' } });
    assert.deepEqual([theirs.body.accounts || theirs.body.transactions || theirs.body.imports].flat(), [], `${read}: another person sees nothing`);
  }
  assert.equal((await call(routes['GET /imports/:id'], 'bob', { params: { id: preview.body.importId } })).statusCode, 404);
  assert.equal((await call(routes['POST /imports/:id/apply'], 'bob', { params: { id: preview.body.importId }, body: { confirm: true } })).statusCode, 404);
  assert.equal((await call(routes['GET /accounts'], null)).statusCode, 401);
});

test('a file with unnamed columns asks for them once, and the map is remembered for that account', async (t) => {
  const pool = await database(t);
  const routes = ledgerRoutes(pool);
  const text = statement('unnamed-columns.csv');
  const asked = await call(routes['POST /imports/preview'], 'alice', { body: { fileName: 'export.csv', text, newAccount: { name: 'Corner Card', type: 'credit' } } });
  assert.equal(asked.statusCode, 200);
  assert.equal(asked.body.needsColumns, true);
  assert.deepEqual(asked.body.sample[0], ['2026-10-03', '84.31', 'HARBOR MARKET']);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM finance_imports')).rows[0].n, 0, 'nothing is kept until the columns are known');
  const columnMap = { date: 0, amount: 1, description: 2, flip: true };
  const preview = await call(routes['POST /imports/preview'], 'alice', { body: { fileName: 'export.csv', text, columnMap, newAccount: { name: 'Corner Card', type: 'credit' } } });
  assert.deepEqual(preview.body.rows.map((row) => [row.direction, row.amount.cents]), [['out', 8431], ['out', 1200]], 'flip reads a positive amount as money out');
  const applied = await call(routes['POST /imports/:id/apply'], 'alice', { params: { id: preview.body.importId }, body: { confirm: true } });
  assert.equal(applied.body.added, 2);
  const later = await call(routes['POST /imports/preview'], 'alice', { body: { fileName: 'next.csv', text: '2026-11-02,5.00,CORNER FUEL\n', columnMap } });
  assert.equal(later.body.account.id, applied.body.accountId, 'the next file with the same columns is guessed to be the same account');
  assert.equal(later.body.account.guessed, true);
  const bad = await call(routes['POST /imports/preview'], 'alice', { body: { fileName: 'x.csv', text: 'Date,Description,Amount\nxx,yy,zz\n' } });
  assert.deepEqual([bad.statusCode, bad.body.error], [422, 'no_transactions']);
  assert.match(bad.body.message, /Line 2 stopped it/);
});
