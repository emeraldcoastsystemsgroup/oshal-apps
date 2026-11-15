/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The shape rules the ledger depends on, read from the shipped files (no database). No ledger module creates, alters or drops a table: the tables come from migration 002 alone, which the manifest declares after 001. Migration 002 is plain: every table has one text primary key and an owner column, and there is no other unique rule, no foreign key, no row security and no procedure (a table under row security loses the native kernel's point insert, update and delete). Every statement the store issues names the owner, puts the selective text column first in its WHERE (the kernel starts from the first text equality it finds) and uses no ON CONFLICT, ORDER BY, GROUP BY, DISTINCT, join, subquery or transaction; the only other statements in the ledger modules are the four that read and save the one-row snapshot and the bank links. The ledger moves no money: no ledger module names the pay route, a transfer, the payment rail or Trading's order files, and only the routes file loads the bank module. Only the last four digits of an account number survive the store's own reader. Run: node --test tests/ledger-no-ddl.test.cjs
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Finance 1.7.0: the ledger's tables come from migration 003 (renumbered after 1.6.5's 002-finance-analysis), and 004 holds the money day's; the statements outside the store are compared as a set, since the snapshot rebuild now reads the bank links too (a linked bank's snapshot is never rewritten).
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | 1.8.0: migrations 005 (the person's mail check and the bills found in their mail) and 006 (the answers to repeating payments) are declared after 004.
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PKG, ROUTES, declaredMigrations } = require('./ledger.fixture.cjs');

const MODULES = ['finance-ledger', 'finance-ledger-store', 'finance-ledger-import', 'finance-parse-csv', 'finance-parse-ofx', 'finance-parse-text', 'finance-aggregate', 'finance-sample'];
const read = (...parts) => fs.readFileSync(path.join(PKG, ...parts), 'utf8');
/** Code only: comments say what is not done, and must not trip a rule about what is done. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const store = require(path.join(ROUTES, 'finance-ledger-store.js'));

test('no ledger module creates, alters or drops a table; the manifest declares the migration', () => {
  for (const name of MODULES) {
    for (const file of [['src-routes', `${name}.ts`], ['routes', `${name}.js`]]) {
      const text = code(read(...file));
      assert.doesNotMatch(text, /\b(CREATE|ALTER|DROP|TRUNCATE)\s+(TABLE|INDEX|POLICY|SCHEMA|EXTENSION)\b/i, `${file.join('/')} issues no DDL`);
      assert.doesNotMatch(text, /runRuntimeSchemaBootstrap|ensureFinanceSchema|buildOwnerRlsPolicyStatements/, `${file.join('/')} does not bootstrap a schema at run time`);
    }
  }
  assert.deepEqual(declaredMigrations(), ['migrations/001-finance-stores.sql', 'migrations/002-finance-analysis.sql', 'migrations/003-ledger.sql', 'migrations/004-day.sql', 'migrations/005-mail.sql', 'migrations/006-recurring.sql']);
});

test('migration 003 is plain: one text key and an owner on every table, nothing the kernel would have to load a table for', () => {
  const sql = read('migrations', '003-ledger.sql').replace(/^--.*$/gm, '');
  const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
  assert.ok(statements.every((s) => /^CREATE TABLE IF NOT EXISTS |^CREATE INDEX IF NOT EXISTS /.test(s)), 'only idempotent CREATE TABLE and CREATE INDEX');
  assert.doesNotMatch(sql, /ROW LEVEL SECURITY|POLICY|\bUNIQUE\b|\bREFERENCES\b|FOREIGN KEY|\bDO \$\$|\bTRIGGER\b|\bSERIAL\b/i);
  const tables = statements.filter((s) => s.startsWith('CREATE TABLE'));
  assert.deepEqual(tables.map((s) => /EXISTS (\w+)/.exec(s)[1]), ['finance_books', 'finance_accounts', 'finance_transactions', 'finance_imports', 'finance_rules', 'finance_documents']);
  for (const table of tables) {
    assert.equal((table.match(/PRIMARY KEY/g) || []).length, 1, 'one primary key');
    assert.match(table, /\(\s*\w+ TEXT PRIMARY KEY,/, 'a text key, first');
    assert.match(table, /\buser_sub TEXT NOT NULL\b/, 'the owner column the kernel checks');
  }
  assert.doesNotMatch(sql, /account_number|routing|card_number/i, 'no column for a full account number');
});

test('every statement the store issues is owner-scoped, selective first, and free of what makes the kernel copy a table', () => {
  const statements = { ...store.LEDGER_SQL, transactionInsert: store.transactionInsertSql(2) };
  assert.ok(Object.keys(statements).length >= 25);
  for (const [name, sql] of Object.entries(statements)) {
    assert.doesNotMatch(sql, /ON CONFLICT|ORDER BY|GROUP BY|\bDISTINCT\b|\bJOIN\b|\bRETURNING\b|\bBEGIN\b|\bCOMMIT\b|\(\s*SELECT\b/i, `${name} keeps to the plain shapes`);
    assert.match(sql, /\buser_sub\b/, `${name} names the owner`);
    if (/^INSERT/.test(sql)) continue;
    const where = /\bWHERE (\w+) = \$1 AND user_sub = \$2/.exec(sql);
    assert.ok(where, `${name} reads by one text column first, then the owner: ${sql.slice(-90)}`);
    assert.notEqual(where[1], 'user_sub');
  }
  const elsewhere = [];
  for (const name of MODULES.filter((m) => m !== 'finance-ledger-store')) {
    for (const found of code(read('routes', `${name}.js`)).matchAll(/['"`]\s*((?:SELECT|INSERT INTO|UPDATE|DELETE FROM)\b[^'"`]*)['"`]/g)) elsewhere.push(found[1].replace(/\s+/g, ' ').trim());
  }
  assert.deepEqual([...new Set(elsewhere)].sort(), [
    'DELETE FROM oshal_finance_data WHERE user_sub = $1',
    'INSERT INTO oshal_finance_data (user_sub, aggregate, brief, synced_at, brief_at) VALUES ($1, $2, NULL, now(), NULL) ON CONFLICT (user_sub) DO UPDATE SET aggregate = EXCLUDED.aggregate, brief = NULL, synced_at = now(), brief_at = NULL',
    'SELECT aggregate FROM oshal_finance_data WHERE user_sub = $1',
    'SELECT item_id FROM oshal_finance_items WHERE user_sub = $1',
  ], 'outside the store, only the one-row snapshot and the bank links are read or saved');
});

test('the ledger moves no money and keeps only the last four digits of an account number', () => {
  for (const name of MODULES) {
    const text = code(read('src-routes', `${name}.ts`));
    assert.doesNotMatch(text, /['"`/]pay\b|createTransfer|getPaymentAdapter|@\/features\/payments|orderAuthority|trading|\.post\(['"]\/(pay|link-token|exchange|link-sandbox)/i, `${name} touches no payment, order or bank-link route`);
    for (const line of text.split('\n').filter((l) => /finance-plaid/.test(l))) assert.match(line, /^import type /, `${name} loads the bank module only as a type: ${line}`);
  }
  assert.deepEqual(['000111224821', '4000-1111-2222-0082', 'x9', '', null].map(store.lastFour), ['4821', '0082', '9', '', '']);
  assert.throws(() => store.figure(100, 'USD', '', 'import', '2026-10-31'), /where it came from/);
  assert.throws(() => store.figure(100, 'USD', 'Harbor Bank statement', 'import', ''), /the date it is true for/);
  assert.throws(() => store.figure(1.5, 'USD', 'Harbor Bank statement', 'import', '2026-10-31'), /whole number of cents/);
});
