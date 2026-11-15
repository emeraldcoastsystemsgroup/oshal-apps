/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Finance 1.8.0 (Lane FINH2): bills from a made-up person's mail, through the compiled mail and bills routes on a disposable PostgreSQL, against a stand-in Gmail server over real HTTP on loopback (only Express's Router and the logger are doubled; the kernel's egress is stood in by a fetch that sends Finance's requests to the stand-in unchanged). The check is off until the person turns it on with a yes, and while it is off no mail is read. A check sends one search for bill-like mail and reads each message once with format=full, GET only and with no credential of Finance's own (the kernel adds it); a bill becomes a proposal with its amount as a figure from the mail and its date; no message text is stored. A receipt and a newsletter give nothing. Add (with a yes) makes a bill, or brings the person's bill for that payee up to date; Not a bill keeps that payee from being proposed again. A check reads at most 20 messages and the next continues. No connection, an expired one and a refused permission are said in words. A second person sees and answers nothing. Migration 005 is plain and the module creates no table and moves no money. Every person, sender, payee and figure is invented. Run: OSHAL_TEST_POSTGRES=... node --test tests/mail-bills.test.cjs
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | 1.8.1 (VER4 acceptance, 2026-11-14: with no Google connection Bills said "There is more mail to read" after a check that read nothing): a check that could not reach the mailbox (no connection, an expired one, a refused permission) reads 0 and says there is no more mail to read, in its answer and in the next read of the check; turned off, it says none either.
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PKG, ROUTES, database, requireWith, call, assertFigures, declaredMigrations } = require('./ledger.fixture.cjs');

const quiet = { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) };
const { dayOffset, iso, words, mail, WATER, CARD, RECEIPT, NEWS, standIn } = require('./mail-stand-in.fixture.cjs');

/** One module's compiled routes over a pool, by "METHOD /path". */
function routes(pool, file, factory, extra = {}) {
  const handlers = {};
  const router = { get: (r, ...c) => { handlers[`GET ${r}`] = c[c.length - 1]; }, post: (r, ...c) => { handlers[`POST ${r}`] = c[c.length - 1]; } };
  requireWith(path.join(ROUTES, file), { express: { Router: () => router }, '@/shared/logger': quiet })[factory]({ pool, appPackageDir: PKG, ...extra });
  return handlers;
}
const mailRoutes = (pool, fetcher) => routes(pool, 'finance-mail.js', 'createFinanceMailRoutes', { financeMailFetch: fetcher });
const billRoutes = (pool) => routes(pool, 'finance-bills.js', 'createFinanceBillsRoutes');
const turnOn = (r, sub) => call(r['POST /switch'], sub, { body: { on: true, confirm: true } });

test('the mail check is off until the person turns it on, and while it is off no mail is read', async (t) => {
  const pool = await database(t);
  const box = await standIn(() => [WATER()]);
  t.after(box.close);
  const r = mailRoutes(pool, box.fetcher);
  const first = await call(r['GET /'], 'alice');
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.deepEqual([first.body.on, first.body.proposals], [false, []]);
  assert.match(first.body.words, /The mail check is off/);
  const off = await call(r['POST /check'], 'alice', { body: {} });
  assert.deepEqual([off.statusCode, off.body.ran, off.body.nothing], [200, false, 'The mail check is off; no mail was read.']);
  assert.deepEqual(box.requests, [], 'no request reached the mailbox');
  const asked = await call(r['POST /switch'], 'alice', { body: { on: true } });
  assert.deepEqual([asked.statusCode, asked.body.message], [400, 'Looking through your mail for bills needs your confirmation.']);
  assert.equal((await call(r['GET /'], null)).statusCode, 401, 'nobody signed in is refused');
});

test('a check finds the bills in bill-like mail, reads each message once with no credential of its own, and keeps no message text', async (t) => {
  const pool = await database(t);
  const box = await standIn(() => [WATER(), CARD(), RECEIPT(), NEWS()]);
  t.after(box.close);
  const r = mailRoutes(pool, box.fetcher);
  assert.equal((await turnOn(r, 'alice')).body.on, true);
  const done = await call(r['POST /check'], 'alice', { body: {} });
  assert.equal(done.statusCode, 200, JSON.stringify(done.body));
  assert.deepEqual([done.body.ran, done.body.read, done.body.found, done.body.status, done.body.more], [true, 4, 2, 'connected', false]);
  assert.deepEqual(done.body.counts, { read: 4, found: 2, receipts: 1, noAmount: 1, noDate: 0 });
  assert.deepEqual(done.body.proposals.map((p) => [p.payee, p.amount.cents, p.dueDate]).sort(), [['Harbor Card', 64217, iso(dayOffset(18))], ['Pinecrest Water Co', 4820, iso(dayOffset(10))]]);
  assert.equal(done.body.proposals.find((p) => p.payee === 'Harbor Card').amount.source, 'Mail from Harbor Card');
  assertFigures(done.body);

  const list = box.requests.filter((q) => q.path === '/gmail/v1/users/me/messages');
  assert.equal(list.length, 1, 'one search');
  assert.match(list[0].query.q, /^after:\d+ before:\d+ \{statement bill invoice "payment due" "amount due" "balance due" "due date"\} -category:promotions$/);
  const window = Number(list[0].query.q.split(' ')[1].slice(7)) - Number(list[0].query.q.split(' ')[0].slice(6));
  assert.ok(Math.abs(window - 45 * 86400) < 120, 'the first check looks 45 days back');
  const reads = box.requests.filter((q) => q.path !== '/gmail/v1/users/me/messages');
  assert.deepEqual(reads.map((q) => q.query.format), ['full', 'full', 'full', 'full'], 'each message read once, whole');
  assert.ok(box.requests.every((q) => q.method === 'GET' && q.authorization === null), 'GET only, and Finance sends no credential of its own');

  const stored = JSON.stringify((await pool.query('SELECT * FROM finance_mail_finds')).rows) + JSON.stringify((await pool.query('SELECT * FROM finance_mail_checks')).rows);
  assert.doesNotMatch(stored, /Pay online at the stand-in site|Minimum payment due|Thank you for your payment|weather/, 'no message text is stored');
  const again = await call(r['POST /check'], 'alice', { body: {} });
  assert.deepEqual([again.body.read, again.body.found], [0, 0], 'a message already read is not read again');
  assert.equal(box.requests.filter((q) => q.path !== '/gmail/v1/users/me/messages').length, 4);

  const bob = await call(r['GET /'], 'bob');
  assert.deepEqual([bob.body.on, bob.body.proposals.length], [false, 0], 'another person sees none of it');
  const theirs = done.body.proposals[0].findId;
  assert.equal((await call(r['POST /finds/:findId/add'], 'bob', { params: { findId: theirs }, body: { confirm: true } })).statusCode, 404, 'nor can answer it');
});

test('Add with a yes makes a bill or brings the person\'s bill for that payee up to date; Not a bill is remembered for that payee', async (t) => {
  const pool = await database(t);
  let held = [WATER(), CARD()];
  const box = await standIn(() => held);
  t.after(box.close);
  const r = mailRoutes(pool, box.fetcher), bills = billRoutes(pool);
  const typed = await call(bills['POST /'], 'alice', { body: { payee: 'Harbor Card', amountCents: 50000, cadence: 'monthly', nextDue: iso(dayOffset(5)) } });
  assert.equal(typed.statusCode, 200, JSON.stringify(typed.body));
  await turnOn(r, 'alice');
  const found = (await call(r['POST /check'], 'alice', { body: {} })).body.proposals;
  const water = found.find((p) => p.payee === 'Pinecrest Water Co'), card = found.find((p) => p.payee === 'Harbor Card');
  assert.deepEqual([water.knownBill, card.knownBill && card.knownBill.payee], [null, 'Harbor Card'], 'the card statement matches the bill the person has');

  const asked = await call(r['POST /finds/:findId/add'], 'alice', { params: { findId: water.findId }, body: {} });
  assert.deepEqual([asked.statusCode, asked.body.message], [400, 'Adding this bill needs your confirmation.']);
  const added = await call(r['POST /finds/:findId/add'], 'alice', { params: { findId: water.findId }, body: { confirm: true } });
  assert.equal(added.statusCode, 200, JSON.stringify(added.body));
  assert.deepEqual([added.body.updated, added.body.bill.origin, added.body.bill.amount.cents, added.body.bill.amount.source, added.body.bill.nextDue],
    [false, 'mail', 4820, 'Mail from Pinecrest Water Co', iso(dayOffset(10))]);
  assert.match(added.body.note, /It does not pay the bill\./);
  const updated = await call(r['POST /finds/:findId/add'], 'alice', { params: { findId: card.findId }, body: { confirm: true } });
  assert.deepEqual([updated.body.updated, updated.body.bill.billId, updated.body.bill.amount.cents, updated.body.bill.nextDue], [true, typed.body.bill.billId, 64217, iso(dayOffset(18))]);
  const listed = (await call(bills['GET /'], 'alice')).body;
  assert.deepEqual(listed.bills.map((b) => b.payee).sort(), ['Harbor Card', 'Pinecrest Water Co'], 'two bills, the card brought up to date, not doubled');
  assert.ok([...listed.week, ...listed.later].some((d) => d.payee === 'Pinecrest Water Co' && d.due === iso(dayOffset(10))), 'the mail\'s due date is a due date');
  assertFigures(listed);
  assert.equal((await call(r['POST /finds/:findId/add'], 'alice', { params: { findId: water.findId }, body: { confirm: true } })).statusCode, 409, 'answered once');

  held = [mail('m-gym', 'Stand-in Gym <billing@gym.example>', 'Invoice', `Amount due $30.00, due ${words(dayOffset(7))}`, 1)];
  const gym = (await call(r['POST /check'], 'alice', { body: {} })).body.proposals.find((p) => p.payee === 'Stand-in Gym');
  assert.equal((await call(r['POST /finds/:findId/dismiss'], 'alice', { params: { findId: gym.findId }, body: {} })).statusCode, 200);
  held = [mail('m-gym-2', 'Stand-in Gym <billing@gym.example>', 'Invoice', `Amount due $30.00, due ${words(dayOffset(37))}`, 0)];
  const later = await call(r['POST /check'], 'alice', { body: {} });
  assert.deepEqual([later.body.read, later.body.found, later.body.proposals.length], [1, 0, 0], 'a payee the person said is not a bill is not proposed again');
});

test('a check reads at most 20 messages and the next continues where it stopped', async (t) => {
  const pool = await database(t);
  const many = Array.from({ length: 23 }, (_, i) => mail(`m-${i}`, `Stand-in Biller ${String.fromCharCode(65 + i)} <b${i}@biller.example>`, 'Your bill', `Amount due $${10 + i}.00, payment due ${words(dayOffset(5 + i))}`, 2));
  const box = await standIn(() => many);
  t.after(box.close);
  const r = mailRoutes(pool, box.fetcher);
  await turnOn(r, 'alice');
  const first = (await call(r['POST /check'], 'alice', { body: {} })).body;
  assert.deepEqual([first.read, first.found, first.more], [20, 20, true]);
  const second = (await call(r['POST /check'], 'alice', { body: {} })).body;
  assert.deepEqual([second.read, second.found, second.more, second.proposals.length], [3, 3, false, 23]);
});

test('no connection, an expired one and a refused permission are said in words', async (t) => {
  const pool = await database(t);
  const kernelSays = (words) => async () => { throw new Error(words); };
  const cases = [
    [kernelSays('gmail is not connected: connect your own gmail account on Utilities'), 'not-connected', /Connect your mail to find bills/],
    [kernelSays('the saved gmail connection expired and could not be renewed (refused); reconnect it on Utilities'), 'reconnect', /expired/],
  ];
  for (const [fetcher, status, said] of cases) {
    const r = mailRoutes(pool, fetcher);
    await turnOn(r, 'alice');
    const done = (await call(r['POST /check'], 'alice', { body: {} })).body;
    assert.deepEqual([done.ran, done.status, done.read, done.more], [true, status, 0, false], 'no mail was read, so there is no more to read');
    assert.match(done.words, said);
    assert.equal((await call(r['GET /'], 'alice')).body.more, false, 'the next read of the check says the same');
  }
  const box = await standIn(() => [], { status: 403 });
  t.after(box.close);
  const r = mailRoutes(pool, box.fetcher);
  const denied = (await call(r['POST /check'], 'alice', { body: {} })).body;
  assert.deepEqual([denied.status, denied.words, denied.more], ['no-permission', 'Finance needs permission to read your mail: connect Gmail again in Connections and allow reading your email.', false]);
  const off = await call(r['POST /switch'], 'alice', { body: { on: false } });
  assert.deepEqual([off.statusCode, off.body.on, off.body.more], [200, false, false], 'turning it off needs no confirmation, and a check that is off has no more to read');
});

test('migration 005 is plain and the mail module keeps the kernel\'s statement shapes, creates no table and moves no money', () => {
  assert.ok(declaredMigrations().includes('migrations/005-mail.sql'));
  const sql = fs.readFileSync(path.join(PKG, 'migrations', '005-mail.sql'), 'utf8').replace(/^--.*$/gm, '');
  const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
  assert.ok(statements.every((s) => /^CREATE TABLE IF NOT EXISTS |^CREATE INDEX IF NOT EXISTS /.test(s)));
  assert.doesNotMatch(sql, /ROW LEVEL SECURITY|POLICY|\bUNIQUE\b|\bREFERENCES\b|FOREIGN KEY|\bDO \$\$|\bTRIGGER\b|\bSERIAL\b|\bbody\b|\bsnippet\b/i);
  for (const table of statements.filter((s) => s.startsWith('CREATE TABLE'))) {
    assert.match(table, /\(\s*\w+ TEXT PRIMARY KEY,/);
    assert.match(table, /\buser_sub TEXT NOT NULL\b/);
  }
  const code = fs.readFileSync(path.join(ROUTES, 'finance-mail.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /\b(CREATE|ALTER|DROP|TRUNCATE)\s+(TABLE|INDEX|POLICY|SCHEMA)\b/i);
  assert.doesNotMatch(code, /createTransfer|getPaymentAdapter|orderAuthority|messages\/send|\/modify|\/trash|batchModify|authorization:/i, 'no money moves and no mail is sent or changed');
  const { MAIL_SQL } = requireWith(path.join(ROUTES, 'finance-mail.js'), { express: { Router: () => ({}) }, '@/shared/logger': quiet });
  for (const [name, text] of Object.entries(MAIL_SQL)) {
    assert.doesNotMatch(text, /ON CONFLICT|ORDER BY|GROUP BY|\bDISTINCT\b|\bJOIN\b|\bRETURNING\b|\bBEGIN\b|\(\s*SELECT\b/i, name);
    assert.match(text, /\buser_sub\b/, `${name} names the owner`);
  }
});
