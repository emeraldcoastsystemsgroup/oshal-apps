/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Statement text (a PDF the kernel turned into text, or pasted lines) becomes proposed transactions a person confirms. The reader: a line that starts with a date and ends in an amount is one transaction; a date with no year takes it from the statement period, across a year end too; the direction comes from the line's own sign, then the running balance, then the heading it stands under; a dated line with no amount is counted and listed; the last running balance is the closing balance. Text with nothing readable in it is refused as a picture of a page, and text with no dated line says so. The bill reader finds the payee, the amount due and the due date, or refuses naming what is missing. Through the compiled routes on a disposable PostgreSQL: a text preview and its apply, and a bill answered as a proposal kept with its document while no transaction is written. Synthetic text only. Run: OSHAL_TEST_POSTGRES=... node --test tests/ledger-import-text.test.cjs
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ROUTES, database, ledgerRoutes, call, statement, assertFigures } = require('./ledger.fixture.cjs');

const text = require(path.join(ROUTES, 'finance-parse-text.js'));

test('dated lines ending in an amount are read; the period gives the year and the running balance gives the direction', () => {
  const read = text.parseStatementText(statement('harbor-statement.txt'));
  assert.equal(read.ok, true);
  assert.equal(read.kind, 'text');
  assert.deepEqual(read.rows.map((row) => [row.date, row.direction, row.amountCents, row.description]), [
    ['2026-10-01', 'out', 145000, 'MAPLE COURT APARTMENTS'], ['2026-10-08', 'out', 3855, 'CORNER FUEL'], ['2026-10-12', 'out', 1399, 'STREAMING PLUS'],
    ['2026-10-15', 'in', 320000, 'PAYROLL LAKESIDE DESIGN CO'], ['2026-10-28', 'out', 5280, 'CORNER TRATTORIA'], ['2026-10-30', 'out', 11240, 'CITY UTILITIES'],
    ['2026-10-31', 'out', 8431, 'HARBOR MARKET'],
  ]);
  assert.deepEqual(read.unreadable, [{ line: 14, reason: 'no amount at the end of the line' }], 'a dated line it could not read is listed with its number');
  assert.equal(read.unreadableCount, 1);
  assert.deepEqual(read.period, { start: '2026-10-01', end: '2026-10-31' });
  assert.deepEqual(read.closingBalance, { cents: 487324, asOf: '2026-10-31' });
});

test('a heading or a sign says which way money went, and a December line on a January statement is last year', () => {
  const sections = text.parseStatementText([
    'Statement period 12/16/2026 - 01/15/2027', 'Deposits and other credits', '12/20 PAYROLL LAKESIDE DESIGN CO 3,200.00', '01/02 Interest 4.12',
    'Withdrawals and other debits', '12/28 MAPLE COURT APARTMENTS 1,450.00', '01/05 HARBOR MARKET 84.31', '01/06 REFUND HARBOR MARKET 12.00 CR', '01/07 ADJUSTMENT (5.00)',
  ].join('\n'));
  assert.deepEqual(sections.rows.map((row) => [row.date, row.direction, row.amountCents]), [
    ['2026-12-20', 'in', 320000], ['2027-01-02', 'in', 412], ['2026-12-28', 'out', 145000], ['2027-01-05', 'out', 8431], ['2027-01-06', 'in', 1200], ['2027-01-07', 'out', 500],
  ]);
  const noYear = text.parseStatementText('10/01 MAPLE COURT APARTMENTS 1,450.00\n');
  assert.match(noYear.message, /Line 1 stopped it: no year for the date "10\/01"/, 'a date with no year and no period is not guessed');
});

test('text with nothing to read is refused in words', () => {
  assert.equal(text.parseStatementText(' \n\f \n').message, 'This PDF is a picture of a page; Finance cannot read it.');
  assert.equal(text.parseStatementText('').message, 'This PDF is a picture of a page; Finance cannot read it.');
  assert.equal(text.parseStatementText('Thank you for banking with us.\nNo activity this period.').message, 'Finance found no line in this text that starts with a date and ends in an amount.');
});

test('a bill gives its payee, amount due and due date, or says what is missing', () => {
  const bill = statement('city-utilities-bill.txt');
  assert.deepEqual(text.parseBillText(bill), { ok: true, payee: 'City Utilities', amountDueCents: 11240, dueDate: '2026-11-21' });
  assert.equal(text.looksLikeBill(bill), true);
  assert.equal(text.looksLikeBill(statement('harbor-statement.txt')), false);
  assert.equal(text.parseBillText('City Utilities\nDue date: November 21, 2026\n').message, 'Finance could not find an amount due in this document.');
  assert.equal(text.parseBillText('City Utilities\nAmount due: $112.40\n').message, 'Finance could not find a due date in this document.');
});

test('a text statement is previewed and applied; a bill is answered as a proposal and writes no transaction', async (t) => {
  const pool = await database(t);
  const routes = ledgerRoutes(pool);
  const preview = await call(routes['POST /imports/preview'], 'alice', { body: { kind: 'text', fileName: 'october.pdf', text: statement('harbor-statement.txt'), newAccount: { name: 'Everyday Checking', institution: 'Harbor Bank', last4: '4821' } } });
  assert.equal(preview.statusCode, 200, JSON.stringify(preview.body));
  assert.deepEqual(preview.body.counts, { total: 7, toAdd: 7, duplicate: 0, closedMonth: 0, unreadable: 1 });
  assert.deepEqual(preview.body.unreadable, [{ line: 14, reason: 'no amount at the end of the line' }]);
  assertFigures(preview.body);
  const applied = await call(routes['POST /imports/:id/apply'], 'alice', { params: { id: preview.body.importId }, body: { confirm: true } });
  assert.deepEqual([applied.body.state, applied.body.added], ['applied', 7]);
  const month = (await call(routes['GET /transactions'], 'alice', { query: { month: '2026-10' } })).body;
  assert.equal(month.transactions.find((row) => row.description === 'PAYROLL LAKESIDE DESIGN CO').direction, 'in');
  assert.equal((await call(routes['GET /accounts'], 'alice')).body.accounts[0].balance.cents, 487324);

  const picture = await call(routes['POST /imports/preview'], 'alice', { body: { kind: 'text', fileName: 'scan.pdf', text: ' \n \n' } });
  assert.deepEqual([picture.statusCode, picture.body.error, picture.body.message], [422, 'picture_only', 'This PDF is a picture of a page; Finance cannot read it.']);

  const before = (await pool.query('SELECT count(*)::int AS n FROM finance_transactions')).rows[0].n;
  const bill = await call(routes['POST /imports/preview'], 'alice', { body: { fileName: 'utilities.pdf', kind: 'text', text: statement('city-utilities-bill.txt') } });
  assert.equal(bill.statusCode, 200, JSON.stringify(bill.body));
  assert.equal(bill.body.kind, 'bill');
  assert.deepEqual([bill.body.bill.payee, bill.body.bill.amountDue.cents, bill.body.bill.amountDue.source, bill.body.bill.dueDate], ['City Utilities', 11240, 'City Utilities bill', '2026-11-21']);
  assertFigures(bill.body);
  const doc = (await pool.query('SELECT kind, origin, produced, user_sub FROM finance_documents WHERE doc_id = $1', [bill.body.docId])).rows[0];
  assert.deepEqual([doc.kind, doc.origin, doc.user_sub, doc.produced.proposal.dueDate], ['bill', 'upload', 'alice', '2026-11-21']);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM finance_transactions')).rows[0].n, before, 'a bill proposal writes no transaction');
});
