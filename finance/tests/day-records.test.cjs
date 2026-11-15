/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Finance 1.7.0's money day over a person's own records, on a disposable PostgreSQL through the compiled routes (only Express's Router and the logger are doubled). The day before any account says first run; a statement with a charge repeating monthly makes a bill proposal when it is applied (never on a GET), the proposal becomes a bill only with confirm: true, and Mark paid says it pays nothing; a typed bill is confirmed at once; a goal's Set aside says no money moved and its progress is worked out from what was set aside; the month answers money in and out with sources and dates and has no "left to spend" without a plan; closing a month needs confirmation; every GET writes nothing; a second person sees none of it. Migration 004 is plain and the day modules' statements keep the kernel's shapes. Every person, payee and figure is invented. Run: OSHAL_TEST_POSTGRES=... node --test tests/day-records.test.cjs
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | 1.8.0: migrations 001 to 004 stay first and in order; 005 (the mail) is checked in tests/mail-bills.test.cjs.
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PKG, ROUTES, database, ledgerRoutes, requireWith, call, day, recentCsv, importStatement, assertFigures, declaredMigrations } = require('./ledger.fixture.cjs');

const quiet = { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) };
/** One day module's compiled routes over a pool, by "METHOD /path". */
function dayModule(pool, file, factory) {
  const handlers = {};
  const router = { get: (r, ...c) => { handlers[`GET ${r}`] = c[c.length - 1]; }, post: (r, ...c) => { handlers[`POST ${r}`] = c[c.length - 1]; } };
  requireWith(path.join(ROUTES, file), { express: { Router: () => router }, '@/shared/logger': quiet })[factory]({ pool, appPackageDir: PKG });
  return handlers;
}
const bills = (pool) => dayModule(pool, 'finance-bills.js', 'createFinanceBillsRoutes');
const goals = (pool) => dayModule(pool, 'finance-goals.js', 'createFinanceGoalsRoutes');
const month = (pool) => dayModule(pool, 'finance-month.js', 'createFinanceMonthRoutes');
const dayRoutes = (pool) => dayModule(pool, 'finance-day.js', 'createFinanceDayRoutes');
const TABLES = ['finance_bills', 'finance_bill_events', 'finance_goals', 'finance_goal_moves', 'finance_budget_lines', 'finance_month_closes', 'finance_transactions', 'finance_accounts', 'oshal_finance_data'];
async function counts(pool) {
  const out = {};
  for (const table of TABLES) out[table] = (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
  return out;
}
/** A checking statement with rent and a utility charged monthly, three times each, and groceries. */
const STATEMENT = recentCsv([[1, 'City Utilities', '-112.40'], [2, 'Harbor Market', '-84.31'], [5, 'Payroll Lakeside Design Co', '3200.00'], [29, 'City Utilities', '-109.80'],
  [33, 'Harbor Market', '-61.02'], [35, 'Payroll Lakeside Design Co', '3200.00'], [57, 'City Utilities', '-114.05'], [60, 'Harbor Market', '-70.00']], '4820.44');

test('the day before any account is a first run, and reading it writes nothing', async (t) => {
  const pool = await database(t);
  const before = await counts(pool);
  const answer = await call(dayRoutes(pool)['GET /'], 'alice');
  assert.equal(answer.statusCode, 200, JSON.stringify(answer.body));
  assert.deepEqual([answer.body.firstRun, answer.body.accounts, answer.body.newTransactions], [true, 0, null]);
  assert.deepEqual(await counts(pool), before, 'a GET writes nothing');
  assert.equal((await call(dayRoutes(pool)['GET /'], null)).statusCode, 401, 'nobody signed in is refused');
});

test('a monthly charge in an applied statement is proposed as a bill, and becomes one only on the person\'s yes', async (t) => {
  const pool = await database(t);
  const ledger = ledgerRoutes(pool), routes = bills(pool);
  const done = await importStatement(ledger, 'alice', { fileName: 'harbor.csv', text: STATEMENT, newAccount: { name: 'Everyday Checking', institution: 'Harbor Bank', type: 'depository' } });
  assert.deepEqual(done.applied.bills, { proposed: 1, paid: 0 }, 'the apply answer says a bill was proposed');
  const before = await counts(pool);
  const listed = await call(routes['GET /'], 'alice');
  assert.equal(listed.statusCode, 200, JSON.stringify(listed.body));
  assert.deepEqual(await counts(pool), before, 'listing bills writes nothing');
  assert.equal(listed.body.proposals.length, 1);
  const proposal = listed.body.proposals[0];
  assert.deepEqual([proposal.payee, proposal.state, proposal.origin, proposal.cadence, proposal.evidence.length], ['City Utilities', 'proposed', 'found', 'monthly', 3]);
  assertFigures(listed.body);

  const unconfirmed = await call(routes['POST /:billId/confirm'], 'alice', { params: { billId: proposal.billId }, body: {} });
  assert.deepEqual([unconfirmed.statusCode, unconfirmed.body.message], [400, 'Adding this bill needs your confirmation.']);
  const confirmed = await call(routes['POST /:billId/confirm'], 'alice', { params: { billId: proposal.billId }, body: { confirm: true } });
  assert.equal(confirmed.statusCode, 200, JSON.stringify(confirmed.body));
  const after = (await call(routes['GET /'], 'alice')).body;
  assert.equal(after.proposals.length, 0);
  const due = [...after.overdue, ...after.week, ...after.later];
  assert.ok(due.length >= 1 && due.every((d) => d.payee === 'City Utilities'), 'the confirmed bill has a due date ahead');
  const paid = await call(routes['POST /events/:eventId/paid'], 'alice', { params: { eventId: due[0].eventId }, body: {} });
  assert.equal(paid.statusCode, 200, JSON.stringify(paid.body));
  assert.match(JSON.stringify(paid.body), /Marks it paid in Finance\. It does not pay the bill\./);

  const bob = (await call(routes['GET /'], 'bob')).body;
  assert.deepEqual([bob.proposals.length, bob.overdue.length, bob.week.length, bob.later.length], [0, 0, 0, 0], 'another person sees none of it');
  assert.equal((await call(routes['POST /:billId/confirm'], 'bob', { params: { billId: proposal.billId }, body: { confirm: true } })).statusCode, 404, 'nor can answer it');
});

test('a typed bill is a bill at once; a goal records what was set aside and says no money moved', async (t) => {
  const pool = await database(t);
  const typed = await call(bills(pool)['POST /'], 'alice', { body: { payee: 'Maple Court Apartments', amountCents: 145000, nextDue: day(-5), cadence: 'monthly' } });
  assert.equal(typed.statusCode, 200, JSON.stringify(typed.body));
  const list = (await call(bills(pool)['GET /'], 'alice')).body;
  assert.equal(list.proposals.length, 0);
  assert.ok([...list.week, ...list.later].some((d) => d.payee === 'Maple Court Apartments'));

  const g = goals(pool);
  assert.equal((await call(g['POST /'], 'alice', { body: {} })).statusCode, 400, 'a goal needs a name');
  const added = await call(g['POST /'], 'alice', { body: { name: 'Emergency fund', targetCents: 600000 } });
  assert.equal(added.statusCode, 200, JSON.stringify(added.body));
  const goalId = added.body.goal ? added.body.goal.goalId : added.body.goals[0].goalId;
  const set = await call(g['POST /:goalId/set-aside'], 'alice', { params: { goalId }, body: { amountCents: 25000 } });
  assert.equal(set.statusCode, 200, JSON.stringify(set.body));
  assert.match(JSON.stringify(set.body), /Recorded in Finance\. No money moved\./);
  const back = await call(g['POST /:goalId/take-back'], 'alice', { params: { goalId }, body: { amountCents: 99999999 } });
  assert.deepEqual([back.statusCode, back.body.message], [409, 'That is more than this goal holds.']);
  const listed = (await call(g['GET /'], 'alice')).body;
  const goal = listed.goals.find((one) => one.goalId === goalId);
  assert.equal(goal.saved.cents, 25000, 'progress is what was set aside');
  assertFigures(listed);
  assert.equal((await call(g['GET /'], 'bob')).body.goals.length, 0);
});

test('the month answers money in and out with sources and dates; no plan means no "left to spend"; closing needs a yes', async (t) => {
  const pool = await database(t);
  await importStatement(ledgerRoutes(pool), 'alice', { fileName: 'harbor.csv', text: STATEMENT, newAccount: { name: 'Everyday Checking', institution: 'Harbor Bank' } });
  const m = month(pool);
  const thisMonth = day(1).slice(0, 7);
  const before = await counts(pool);
  const view = await call(m['GET /'], 'alice', { query: { month: thisMonth, today: day(0) } });
  assert.equal(view.statusCode, 200, JSON.stringify(view.body));
  assert.deepEqual(await counts(pool), before, 'reading the month writes nothing');
  assert.ok(view.body.month.out && view.body.month.out.cents > 0 && view.body.month.out.source, 'money out is a figure with its source');
  assert.deepEqual([view.body.month.hasPlan, view.body.month.left], [false, null], 'no plan, no guess');
  assertFigures(view.body);
  const planned = await call(m['POST /plan'], 'alice', { body: { month: thisMonth, incomeCents: 640000, everythingElseCents: 150000, today: day(0) } });
  assert.equal(planned.statusCode, 200, JSON.stringify(planned.body));
  assert.equal(planned.body.month.hasPlan, true);
  const close = await call(m['POST /close'], 'alice', { body: {} });
  assert.equal(close.statusCode, 400);
  assert.match(close.body.message, /needs your confirmation/);
  assert.equal((await call(m['GET /'], 'bob', { query: { month: thisMonth } })).body.month.out, null, 'another person has no month');

  const after = (await call(dayRoutes(pool)['GET /'], 'alice', { query: { today: day(0) } })).body;
  assert.equal(after.firstRun, false);
  assert.ok(after.netWorth && after.month, 'the day carries net worth and the month');
});

test('migration 004 is plain and the day modules keep the kernel\'s statement shapes and create no table', () => {
  assert.deepEqual(declaredMigrations().slice(0, 4), ['migrations/001-finance-stores.sql', 'migrations/002-finance-analysis.sql', 'migrations/003-ledger.sql', 'migrations/004-day.sql']);
  const sql = fs.readFileSync(path.join(PKG, 'migrations', '004-day.sql'), 'utf8').replace(/^--.*$/gm, '');
  const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
  assert.ok(statements.every((s) => /^CREATE TABLE IF NOT EXISTS |^CREATE INDEX IF NOT EXISTS /.test(s)));
  assert.doesNotMatch(sql, /ROW LEVEL SECURITY|POLICY|\bUNIQUE\b|\bREFERENCES\b|FOREIGN KEY|\bDO \$\$|\bTRIGGER\b|\bSERIAL\b/i);
  for (const table of statements.filter((s) => s.startsWith('CREATE TABLE'))) {
    assert.match(table, /\(\s*\w+ TEXT PRIMARY KEY,/);
    assert.match(table, /\buser_sub TEXT NOT NULL\b/);
  }
  const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const name of ['finance-day', 'finance-day-kit', 'finance-day-model', 'finance-bills', 'finance-goals', 'finance-month']) {
    const text = code(fs.readFileSync(path.join(ROUTES, `${name}.js`), 'utf8'));
    assert.doesNotMatch(text, /\b(CREATE|ALTER|DROP|TRUNCATE)\s+(TABLE|INDEX|POLICY|SCHEMA)\b/i, `${name} issues no DDL`);
    assert.doesNotMatch(text, /createTransfer|getPaymentAdapter|orderAuthority|\/pay\b/, `${name} moves no money`);
  }
  const modules = { 'finance-bills.js': 'BILLS_SQL', 'finance-goals.js': 'GOALS_SQL', 'finance-month.js': 'MONTH_SQL' };
  for (const [file, key] of Object.entries(modules)) {
    const statementsOf = requireWith(path.join(ROUTES, file), { express: { Router: () => ({}) }, '@/shared/logger': quiet })[key];
    for (const [name, text] of Object.entries(statementsOf)) {
      assert.doesNotMatch(text, /ON CONFLICT|ORDER BY|GROUP BY|\bDISTINCT\b|\bJOIN\b|\bRETURNING\b|\bBEGIN\b|\(\s*SELECT\b/i, `${file} ${name}`);
      assert.match(text, /\buser_sub\b/, `${file} ${name} names the owner`);
    }
  }
});
