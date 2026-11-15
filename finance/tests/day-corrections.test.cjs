/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Finance 1.8.0 (Lane FINH2): what VER2 saw on the test slot with Finance 1.7.0, each as a guard, on a disposable PostgreSQL through the compiled routes (only Express's Router and the logger are doubled). Undo of a statement puts back to due every due date one of its payments had paid by matching, and a due date the person had marked paid keeps their mark without the payment's amount; a second preview of the same file is not listed among the statements brought in, and is still read by its id; an ended bill can be deleted (with confirm: true), its due dates go, and a bill found in the person's payments is not proposed again from the same charges; a typed bill is removed outright; a closed goal can be deleted with what was set aside for it, an open one cannot. A second person can delete nothing of the first's. Every person, payee and figure is invented. Run: OSHAL_TEST_POSTGRES=... node --test tests/day-corrections.test.cjs
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PKG, ROUTES, database, ledgerRoutes, requireWith, call, recentCsv, importStatement } = require('./ledger.fixture.cjs');

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
const STATEMENT = recentCsv([[1, 'Pinecrest Water Co', '-48.20'], [2, 'Harbor Market', '-84.31'], [5, 'Payroll Lakeside Design Co', '1850.00'], [29, 'Pinecrest Water Co', '-47.90'],
  [33, 'Harbor Market', '-61.02'], [57, 'Pinecrest Water Co', '-48.05']], '2410.55');
const NEW_ACCOUNT = { name: 'Test Everyday Checking', institution: 'Lantern Ridge Credit Union', type: 'depository' };
const events = async (pool, sub) => (await pool.query('SELECT event_id, bill_id, state, paid_by, paid_txn_id, paid_cents FROM finance_bill_events WHERE user_sub = $1', [sub])).rows;

/** A person with the statement in and its water bill confirmed, so its payments have marked due dates paid. */
async function withWaterBill(pool, sub) {
  const ledger = ledgerRoutes(pool), routes = bills(pool);
  const done = await importStatement(ledger, sub, { fileName: 'lantern-ridge-checking.csv', text: STATEMENT, newAccount: NEW_ACCOUNT });
  const proposal = (await call(routes['GET /'], sub)).body.proposals.find((b) => b.payee === 'Pinecrest Water Co');
  assert.ok(proposal, 'the water bill is proposed');
  assert.equal((await call(routes['POST /:billId/confirm'], sub, { params: { billId: proposal.billId }, body: { confirm: true } })).statusCode, 200);
  return { ledger, routes, importId: done.preview.importId, billId: proposal.billId };
}

test('undo of a statement puts back to due what its payments had paid, and keeps a mark the person made', async (t) => {
  const pool = await database(t);
  const { ledger, importId, billId } = await withWaterBill(pool, 'alice');
  const matched = (await events(pool, 'alice')).filter((e) => e.bill_id === billId && e.paid_by === 'matched' && e.paid_txn_id);
  assert.ok(matched.length >= 1, 'a payment in the statement paid a due date');
  const marked = matched[0];
  await pool.query("UPDATE finance_bill_events SET paid_by = 'marked' WHERE event_id = $1 AND user_sub = 'alice'", [marked.event_id]);

  const undone = await call(ledger['POST /imports/:id/undo'], 'alice', { params: { id: importId }, body: { confirm: true } });
  assert.equal(undone.statusCode, 200, JSON.stringify(undone.body));
  assert.equal(undone.body.released, matched.length, 'the answer says how many due dates were put back');
  const after = await events(pool, 'alice');
  assert.deepEqual(after.filter((e) => e.paid_txn_id), [], 'no due date points at a payment that is no longer in the records');
  for (const e of matched.filter((m) => m.event_id !== marked.event_id)) assert.equal(after.find((a) => a.event_id === e.event_id).state, 'due');
  const kept = after.find((a) => a.event_id === marked.event_id);
  assert.deepEqual([kept.state, kept.paid_by, kept.paid_cents], ['paid', 'marked', null], 'the person\'s own mark stays, without the removed payment\'s amount');
  const listed = (await call(bills(pool)['GET /'], 'alice')).body;
  assert.deepEqual(listed.paid.filter((d) => d.paidBy === 'matched'), [], 'Paid lists no matching payment once it is taken out');
});

test('a preview nobody added is not among the statements brought in, and is still read by its id', async (t) => {
  const pool = await database(t);
  const ledger = ledgerRoutes(pool);
  await importStatement(ledger, 'alice', { fileName: 'lantern-ridge-checking.csv', text: STATEMENT, newAccount: NEW_ACCOUNT });
  const again = await call(ledger['POST /imports/preview'], 'alice', { body: { fileName: 'lantern-ridge-checking.csv', text: STATEMENT, newAccount: NEW_ACCOUNT } });
  assert.equal(again.statusCode, 200, JSON.stringify(again.body));
  const listed = (await call(ledger['GET /imports'], 'alice')).body.imports;
  assert.deepEqual(listed.map((i) => i.state), ['applied'], 'only the statement brought in is listed');
  const one = await call(ledger['GET /imports/:id'], 'alice', { params: { id: again.body.importId } });
  assert.equal(one.statusCode, 200, JSON.stringify(one.body));
});

test('an ended bill can be deleted with a yes; a found one is not proposed again from the same charges', async (t) => {
  const pool = await database(t);
  const { ledger, routes, billId } = await withWaterBill(pool, 'alice');
  const early = await call(routes['POST /:billId/delete'], 'alice', { params: { billId }, body: { confirm: true } });
  assert.deepEqual([early.statusCode, early.body.message], [409, 'Only a bill that has ended can be deleted. Say it is no longer due first.']);
  assert.equal((await call(routes['POST /:billId/end'], 'alice', { params: { billId }, body: {} })).statusCode, 200);
  assert.deepEqual((await call(routes['GET /'], 'alice')).body.ended.map((b) => b.billId), [billId]);
  const asked = await call(routes['POST /:billId/delete'], 'alice', { params: { billId }, body: {} });
  assert.deepEqual([asked.statusCode, asked.body.message], [400, 'Deleting this bill needs your confirmation.']);
  assert.equal((await call(routes['POST /:billId/delete'], 'bob', { params: { billId }, body: { confirm: true } })).statusCode, 404, 'another person cannot delete it');

  const deleted = await call(routes['POST /:billId/delete'], 'alice', { params: { billId }, body: { confirm: true } });
  assert.equal(deleted.statusCode, 200, JSON.stringify(deleted.body));
  const listed = (await call(routes['GET /'], 'alice')).body;
  assert.deepEqual([listed.proposals.length, listed.bills.length, listed.ended.length, listed.paid.length], [0, 0, 0, 0], 'the bill is listed nowhere');
  assert.deepEqual((await events(pool, 'alice')).filter((e) => e.bill_id === billId), [], 'its due dates are gone');
  const kept = (await pool.query("SELECT payee, amount_cents, evidence, state FROM finance_bills WHERE bill_id = $1 AND user_sub = 'alice'", [billId])).rows[0];
  assert.deepEqual(kept, { payee: '', amount_cents: null, evidence: null, state: 'deleted' }, 'only the match words are kept');
  assert.equal((await call(routes['POST /:billId/confirm'], 'alice', { params: { billId }, body: { confirm: true } })).statusCode, 404);

  const more = recentCsv([[0, 'Pinecrest Water Co', '-48.40'], [3, 'Harbor Market', '-12.00']], '2300.00');
  const accountId = (await call(ledger['GET /accounts'], 'alice')).body.accounts[0].id;
  const second = await importStatement(ledger, 'alice', { fileName: 'lantern-ridge-later.csv', text: more, accountId });
  assert.deepEqual(second.applied.bills, { proposed: 0, paid: 0 }, 'the same charges are not proposed again');
});

test('a typed bill that ended is removed outright', async (t) => {
  const pool = await database(t);
  const routes = bills(pool);
  const added = await call(routes['POST /'], 'alice', { body: { payee: 'Maple Street Rent', amountCents: 125000, cadence: 'monthly', nextDue: new Date().toISOString().slice(0, 10) } });
  assert.equal(added.statusCode, 200, JSON.stringify(added.body));
  const billId = added.body.bill.billId;
  await call(routes['POST /:billId/end'], 'alice', { params: { billId }, body: {} });
  assert.equal((await call(routes['POST /:billId/delete'], 'alice', { params: { billId }, body: { confirm: true } })).statusCode, 200);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM finance_bills WHERE user_sub = 'alice'")).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM finance_bill_events WHERE user_sub = 'alice'")).rows[0].n, 0);
});

test('a closed goal can be deleted with what was set aside for it; an open one cannot', async (t) => {
  const pool = await database(t);
  const routes = goals(pool);
  const added = await call(routes['POST /'], 'alice', { body: { name: 'Test trip fund', targetCents: 50000 } });
  assert.equal(added.statusCode, 200, JSON.stringify(added.body));
  const goalId = added.body.goal.goalId;
  assert.equal((await call(routes['POST /:goalId/set-aside'], 'alice', { params: { goalId }, body: { amountCents: 2500 } })).statusCode, 200);
  const open = await call(routes['POST /:goalId/delete'], 'alice', { params: { goalId }, body: { confirm: true } });
  assert.deepEqual([open.statusCode, open.body.message], [409, 'Only a closed goal can be deleted. Close it first.']);
  assert.equal((await call(routes['POST /:goalId'], 'alice', { params: { goalId }, body: { state: 'closed' } })).statusCode, 200);
  const asked = await call(routes['POST /:goalId/delete'], 'alice', { params: { goalId }, body: {} });
  assert.deepEqual([asked.statusCode, asked.body.message], [400, 'Deleting this goal needs your confirmation.']);
  assert.equal((await call(routes['POST /:goalId/delete'], 'bob', { params: { goalId }, body: { confirm: true } })).statusCode, 404, 'another person cannot delete it');
  const deleted = await call(routes['POST /:goalId/delete'], 'alice', { params: { goalId }, body: { confirm: true } });
  assert.equal(deleted.statusCode, 200, JSON.stringify(deleted.body));
  assert.deepEqual([deleted.body.amountsRemoved, deleted.body.note], [1, 'Recorded in Finance. No money moved.']);
  assert.deepEqual((await call(routes['GET /'], 'alice')).body.goals, []);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM finance_goal_moves WHERE user_sub = 'alice'")).rows[0].n, 0);
});
