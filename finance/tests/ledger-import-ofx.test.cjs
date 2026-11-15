/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | An OFX or QFX statement needs no column step: the file carries its account, each transaction's bank id, the period and the closing balance. The reader on both forms (tag-per-line and XML): the account's type and institution with only the last four digits of its number, FITID as the bank id, name and memo joined, entities decoded, a transaction with no posted date listed with its line, the ledger balance with its date, and refusals in words (not OFX, an investment statement, several accounts). Through the compiled routes on a disposable PostgreSQL: the account is proposed from the file and created on apply, a card's negative ledger balance is kept as the amount owed, net worth is what you have less what you owe with the oldest date, and the next file for the same account is recognised by its last four digits. Synthetic statements only. Run: OSHAL_TEST_POSTGRES=... node --test tests/ledger-import-ofx.test.cjs
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ROUTES, database, ledgerRoutes, call, statement, assertFigures, importStatement } = require('./ledger.fixture.cjs');

const ofx = require(path.join(ROUTES, 'finance-parse-ofx.js'));

test('the tag-per-line form is read: account, bank ids, memo, period and closing balance', () => {
  const read = ofx.parseOfx(statement('harbor-checking.ofx'));
  assert.equal(read.ok, true);
  assert.deepEqual(read.account, { last4: '4821', type: 'depository', subtype: 'checking', institution: 'Harbor Bank', currency: 'USD' });
  assert.equal(JSON.stringify(read).includes('000111224821'), false, 'the account number never leaves the reader');
  assert.equal(read.rows.length, 4);
  assert.deepEqual(read.rows[0], { line: 33, date: '2026-10-31', amountCents: 8431, direction: 'out', description: 'HARBOR MARKET #12 POS PURCHASE', bankRef: '20261031-0001' });
  assert.equal(read.rows[2].description, 'PAYROLL LAKESIDE DESIGN CO DIRECT DEP & BONUS', 'an entity in a memo is decoded');
  assert.equal(read.rows[2].direction, 'in');
  assert.deepEqual(read.unreadable, [{ line: 63, reason: 'no posted date in ""' }]);
  assert.deepEqual(read.period, { start: '2026-10-01', end: '2026-10-31' });
  assert.deepEqual(read.closingBalance, { cents: 482044, asOf: '2026-10-31' }, 'the ledger balance, not the available one');
});

test('the XML form of a card statement is read, and files Finance cannot use are refused in words', () => {
  const card = ofx.parseOfx(statement('travel-card.qfx'));
  assert.deepEqual(card.account, { last4: '0082', type: 'credit', subtype: 'credit card', institution: 'Harbor Bank', currency: 'USD' });
  assert.deepEqual(card.rows.map((row) => [row.date, row.direction, row.amountCents, row.bankRef]), [['2026-10-20', 'out', 8620, 'cc-1'], ['2026-10-25', 'in', 40000, 'cc-2']]);
  assert.deepEqual(card.closingBalance, { cents: -124032, asOf: '2026-10-31' });
  assert.equal(ofx.parseOfx('Date,Amount\n1,2\n').message, 'This is not an OFX or QFX file: it has no <OFX> section.');
  assert.match(ofx.parseOfx('<OFX><INVSTMTRS></INVSTMTRS></OFX>').message, /investment statement/);
  assert.match(ofx.parseOfx('<OFX><STMTRS><CURDEF>USD</STMTRS><STMTRS><CURDEF>USD</STMTRS></OFX>').message, /statements for 2 accounts\. Finance reads one account from a file/);
  assert.equal(ofx.parseOfx('<OFX><SONRS></SONRS></OFX>').message, 'This OFX file holds no bank or card statement.');
  const unclosed = ofx.parseOfx('<OFX>\n<STMTRS>\n<CURDEF>USD\n<BANKACCTFROM>\n<ACCTID>9990001\n<ACCTTYPE>SAVINGS\n<STMTTRN>\n<DTPOSTED>20261005\n<TRNAMT>12.00\n<FITID>a\n<NAME>INTEREST\n<STMTTRN>\n<DTPOSTED>20261006\n<TRNAMT>-3.00\n<FITID>b\n<NAME>FEE\n');
  assert.deepEqual([unclosed.ok, unclosed.rows.length, unclosed.account.last4, unclosed.account.subtype], [true, 2, '0001', 'savings'], 'a file that closes nothing is still read');
});

test('the account comes from the file; a card keeps what is owed; net worth is what you have less what you owe', async (t) => {
  const pool = await database(t);
  const routes = ledgerRoutes(pool);
  const checking = await call(routes['POST /imports/preview'], 'alice', { body: { fileName: 'harbor.ofx', text: statement('harbor-checking.ofx') } });
  assert.equal(checking.statusCode, 200, JSON.stringify(checking.body));
  assert.deepEqual({ ...checking.body.account, id: undefined }, { id: undefined, name: 'Harbor Bank checking ending 4821', institution: 'Harbor Bank', type: 'depository', last4: '4821', isNew: true, guessed: true });
  assert.deepEqual(checking.body.counts, { total: 4, toAdd: 4, duplicate: 0, closedMonth: 0, unreadable: 1 });
  assert.equal(checking.body.needsAccount, false);
  const applied = await call(routes['POST /imports/:id/apply'], 'alice', { params: { id: checking.body.importId }, body: { confirm: true } });
  assert.deepEqual([applied.body.state, applied.body.added], ['applied', 4]);
  await importStatement(routes, 'alice', { fileName: 'card.qfx', text: statement('travel-card.qfx') });

  const accounts = (await call(routes['GET /accounts'], 'alice')).body;
  assertFigures(accounts);
  const card = accounts.accounts.find((a) => a.type === 'credit');
  assert.deepEqual([card.owed, card.balance.cents, card.balance.asOf, card.last4], [true, 124032, '2026-10-31', '0082'], 'a negative card balance is the amount owed');
  assert.deepEqual([accounts.netWorth.assets.cents, accounts.netWorth.liabilities.cents, accounts.netWorth.net.cents], [482044, 124032, 358012]);
  assert.deepEqual([accounts.netWorth.net.source, accounts.netWorth.net.sourceKind, accounts.netWorth.net.asOf], ['Harbor Bank statement', 'import', '2026-10-31']);
  assert.equal(accounts.netWorth.parts.length, 2, 'a total lists its parts');
  const stored = JSON.stringify((await pool.query('SELECT * FROM finance_accounts')).rows) + JSON.stringify((await pool.query('SELECT new_account, pending FROM finance_imports')).rows);
  assert.equal(/000111224821|4000111122220082/.test(stored), false, 'no full account or card number is stored');
  const refs = (await pool.query("SELECT source_ref FROM finance_transactions WHERE source_ref <> ''")).rows.map((row) => row.source_ref).sort();
  assert.deepEqual(refs, ['20261001-0001', '20261015-0001', '20261030-0001', '20261031-0001', 'cc-1', 'cc-2']);

  const next = await call(routes['POST /imports/preview'], 'alice', { body: { fileName: 'harbor-nov.ofx', text: statement('harbor-checking.ofx').replace(/2026103/g, '2026110').replace(/20261031-0001|20261030-0001/g, (id) => id + 'n') } });
  assert.deepEqual([next.body.account.isNew, next.body.account.guessed, next.body.account.id], [false, true, applied.body.accountId], 'the same last four digits and type mean the same account');
  assert.equal((await call(routes['GET /accounts'], 'bob')).body.accounts.length, 0);
});
