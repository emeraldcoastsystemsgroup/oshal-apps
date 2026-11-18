/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Finance 1.7.0's record pages driven in Chromium against the real compiled routes over a disposable PostgreSQL (only the framework's logger and the sign-in are stood in: a made-up person is signed in). A person with no bank link chooses a statement file on Accounts, previews it (nothing added yet), adds its transactions and sees the account; Bills proposes the utility charged every month, Add to Bills makes it a bill and Mark paid says it pays nothing; Spending shows the month's money out with its source; a goal is added and money set aside says no money moved; Transactions marks one looked at; the same file again adds nothing; Undo takes the statement back out; a phone has no sideways scroll. Every person, payee and figure is invented. Run: OSHAL_TEST_POSTGRES=... node --test tests/browser/record-pages.browser.test.cjs
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Finance 1.8.0 (Lane FINH2): Recurring lists the utility with what it costs a year and that it is in Bills, Mark to cancel says Finance cancels nothing, Review again and Keep; the second preview of the same file is not listed among the statements brought in; a goal is closed and deleted from Closed goals; after Undo, Paid lists no matching payment and the bill is stopped with No longer due and deleted from Ended, each asked twice. Looked at waits for the counts to change instead of reading them once (it raced the reload in one run of four).
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Read actual saved bank summaries beside editable statement records; retain source/date/coverage, explicit row units and the recent25 display bound without posting bank rows.
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PKG, ROUTES, TOOLCHAIN, database, financeRoutes, ledgerRoutes, importStatement, requireWith, recentCsv } = require('../ledger.fixture.cjs');

const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));
const quiet = { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) };
const PERSON = 'test-person-rita';
const STATEMENT = recentCsv([[1, 'City Utilities', '-112.40'], [2, 'Harbor Market', '-84.31'], [5, 'Payroll Lakeside Design Co', '3200.00'], [29, 'City Utilities', '-109.80'],
  [33, 'Harbor Market', '-61.02'], [35, 'Payroll Lakeside Design Co', '3200.00'], [57, 'City Utilities', '-114.05'], [60, 'Harbor Market', '-70.00']], '4820.44');

/** A server with Finance's record routes over the pool, the made-up person signed in. */
async function serve(pool, options = {}) {
  const app = express();
  const requests = [];
  app.use((req, _res, next) => { requests.push(req.method + ' ' + req.path); next(); });
  app.use(express.json({ limit: '3mb' }));
  app.use((req, _res, next) => { req.oidc = { user: { sub: PERSON }, isAuthenticated: () => true }; next(); });
  const doubles = { express, '@/shared/logger': quiet, '@/shared/artifact-exchange': { redeemArtifactViaRelay: async () => ({ ok: false, status: 404 }) } };
  const ctx = { pool, appPackageDir: PKG };
  const mounts = [['/api/finance/ledger', 'finance-ledger.js', 'createFinanceLedgerRoutes'], ['/api/finance/bills', 'finance-bills.js', 'createFinanceBillsRoutes'],
    ['/api/finance/goals', 'finance-goals.js', 'createFinanceGoalsRoutes'], ['/api/finance/month', 'finance-month.js', 'createFinanceMonthRoutes'],
    ['/api/finance/day', 'finance-day.js', 'createFinanceDayRoutes'], ['/api/finance/p', 'finance-pages.js', 'createFinancePagesRoutes'],
    ['/api/finance/recurring', 'finance-recurring.js', 'createFinanceRecurringRoutes'], ['/api/finance/mail', 'finance-mail.js', 'createFinanceMailRoutes']];
  for (const [at, file, factory] of mounts) app.use(at, requireWith(path.join(ROUTES, file), doubles)[factory](ctx));
  const summary = financeRoutes(pool)['GET /summary'];
  app.get('/api/finance/summary', (req, res, next) => options.summary ? options.summary(req, res, () => summary(req, res, next)) : summary(req, res, next));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { requests, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

const notice = (page) => page.locator('#frNotice:not([hidden])');

test('a person brings in a statement and works their money day through the record pages', async (t) => {
  const pool = await database(t);
  const site = await serve(pool);
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await site.close(); });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  const file = { name: 'harbor-checking.csv', mimeType: 'text/csv', buffer: Buffer.from(STATEMENT) };

  await page.goto(`${site.base}/api/finance/p/accounts`);
  await page.getByText('No account yet.').waitFor();
  await page.getByRole('button', { name: 'Bring in a statement' }).click();
  await page.setInputFiles('#frFile', file);
  await page.fill('#frNewName', 'Everyday Checking');
  await page.fill('#frNewBank', 'Harbor Bank');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByText('Preview: nothing is added yet').waitFor();
  assert.match(await page.locator('#frPreviewBox').innerText(), /8 new · 0 already in Finance/);
  assert.equal(await pool.query('SELECT count(*)::int AS n FROM finance_transactions').then((r) => r.rows[0].n), 0, 'a preview adds nothing');
  await page.getByRole('button', { name: 'Add 8 transactions' }).click();
  await notice(page).filter({ hasText: 'Added 8 transactions.' }).waitFor();
  assert.match(await notice(page).innerText(), /Finance found 1 repeating charge that may be a bill: see Bills\./);
  await page.locator('#frList').getByText('Everyday Checking').waitFor();
  assert.match(await page.locator('#frWorth').innerText(), /\$4,820\.44[\s\S]*Harbor Bank statement, to /, 'net worth names its source and date');
  assert.match(await page.locator('#frImports').innerText(), /harbor-checking\.csv[\s\S]*8 added/);

  await page.getByRole('button', { name: 'Bring in a statement' }).click();
  await page.getByRole('button', { name: 'Bring in a statement' }).click();
  await page.setInputFiles('#frFile', file);
  await page.selectOption('#frImportAccount', { label: 'Everyday Checking · Harbor Bank' });
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByText('Preview: nothing is added yet').waitFor();
  assert.match(await page.locator('#frPreviewBox').innerText(), /0 new · 8 already in Finance/, 'the same file twice adds nothing');
  await page.goto(`${site.base}/api/finance/p/accounts`);
  await page.locator('#frImports').getByText('harbor-checking.csv').waitFor();
  assert.equal(await page.locator('#frImports li.fr-row').count(), 1, 'a preview nobody added is not a statement brought in');

  await page.goto(`${site.base}/api/finance/p/bills`);
  await page.locator('#frPropList').getByText('City Utilities').waitFor();
  await page.getByRole('button', { name: 'Add to Bills' }).click();
  await notice(page).filter({ hasText: 'City Utilities is in your Bills.' }).waitFor();
  await page.getByRole('button', { name: 'Mark paid', exact: true }).first().click();
  await notice(page).filter({ hasText: 'It does not pay the bill.' }).waitFor();
  await page.locator('#frPaid').getByText('City Utilities').waitFor();

  await page.goto(`${site.base}/api/finance/p/recurring`);
  await page.locator('#frList').getByText('City Utilities', { exact: true }).waitFor();
  assert.match(await page.locator('#frList').innerText(), /City Utilities[\s\S]*Every month · last charged [\s\S]*in your Bills[\s\S]*a year/);
  assert.match(await page.locator('#frTotals').innerText(), /A month[\s\S]*A year/);
  assert.equal(await page.getByRole('button', { name: 'Track as a bill' }).count(), 0, 'a payment already in Bills is not offered as a bill again');
  await page.getByRole('button', { name: 'Review City Utilities' }).click();
  await page.getByRole('button', { name: 'Mark to cancel' }).click();
  await notice(page).filter({ hasText: 'Recorded: you mean to cancel City Utilities. Finance cancels nothing' }).waitFor();
  await page.locator('#frList').getByText(/You mean to cancel it/).waitFor();
  await page.getByRole('button', { name: 'Review again' }).click();
  await notice(page).filter({ hasText: 'City Utilities is waiting for your review again.' }).waitFor();
  await page.getByRole('button', { name: 'Keep' }).click();
  await notice(page).filter({ hasText: 'City Utilities: kept.' }).waitFor();
  await page.waitForFunction(() => document.getElementById('frFirst').hidden, null, { timeout: 5000 });

  await page.goto(`${site.base}/api/finance/p/spending`);
  await page.locator('#frTotals').getByText('Money out').waitFor();
  const totals = await page.locator('#frTotals').innerText();
  assert.match(totals, /Money out\s*\$[\d,]+\.\d\d[\s\S]*Harbor Bank statement/);
  assert.match(totals, /Set a plan to see it/, 'no plan, no left to spend');

  await page.goto(`${site.base}/api/finance/p/goals`);
  await page.getByRole('button', { name: 'Add a goal' }).click();
  await page.fill('#frName', 'Emergency fund');
  await page.fill('#frTarget', '6,000');
  await page.getByRole('button', { name: 'Add the goal' }).click();
  await page.locator('#frList').getByText('Emergency fund').waitFor();
  await page.locator('#frList input').first().fill('250');
  await page.getByRole('button', { name: 'Set aside' }).click();
  await notice(page).filter({ hasText: 'No money moved.' }).waitFor();
  assert.match(await page.locator('#frList').innerText(), /\$250\.00/);
  await page.getByRole('button', { name: 'Close goal' }).click();
  await page.getByRole('button', { name: 'Close Emergency fund?' }).click();
  await notice(page).filter({ hasText: 'Emergency fund is closed.' }).waitFor();
  await page.locator('#frClosed').getByText('Emergency fund').waitFor();
  await page.locator('#frClosed').getByRole('button', { name: 'Delete' }).click();
  await page.locator('#frClosed').getByRole('button', { name: 'Delete Emergency fund and what was recorded for it?' }).click();
  await notice(page).filter({ hasText: 'Emergency fund is deleted from Finance. No money moved.' }).waitFor();
  await page.waitForFunction(() => document.getElementById('frClosedCard').hidden, null, { timeout: 5000 });
  assert.equal(await pool.query('SELECT count(*)::int AS n FROM finance_goal_moves WHERE user_sub = $1', [PERSON]).then((r) => r.rows[0].n), 0);

  await page.goto(`${site.base}/api/finance/p/transactions`);
  await page.locator('#frList .fr-row').first().waitFor();
  const before = (await page.locator('#frCounts').innerText());
  await page.getByRole('button', { name: 'Looked at' }).first().click();
  await notice(page).filter({ hasText: 'Marked as looked at.' }).waitFor();
  await page.waitForFunction((was) => document.getElementById('frCounts').innerText !== was, before);

  await page.goto(`${site.base}/api/finance/p/accounts`);
  const undo = page.locator('#frImports').getByRole('button', { name: 'Undo' });
  await undo.click();
  await page.locator('#frImports').getByRole('button', { name: /Take its 8 transactions out\?/ }).click();
  await notice(page).filter({ hasText: 'Undone: 8 transactions taken out.' }).waitFor();
  assert.equal(await pool.query("SELECT count(*)::int AS n FROM finance_transactions WHERE user_sub = $1", [PERSON]).then((r) => r.rows[0].n), 0);

  await page.goto(`${site.base}/api/finance/p/bills`);
  await page.locator('#frBills').getByText('City Utilities').waitFor();
  assert.doesNotMatch(await page.locator('#frPaid').innerText(), /a matching payment in your records/, 'a payment taken out no longer pays the bill');
  await page.locator('#frBills').getByRole('button', { name: 'No longer due' }).click();
  await page.locator('#frBills').getByRole('button', { name: /^Stop City Utilities\?/ }).click();
  await notice(page).filter({ hasText: 'City Utilities is no longer due. It is under Ended.' }).waitFor();
  await page.locator('#frEnded').getByText('City Utilities').waitFor();
  await page.locator('#frEnded').getByRole('button', { name: 'Delete' }).click();
  await page.locator('#frEnded').getByRole('button', { name: 'Delete City Utilities and its due dates?' }).click();
  await notice(page).filter({ hasText: 'City Utilities is deleted from Finance.' }).waitFor();
  await page.waitForFunction(() => document.getElementById('frEndedCard').hidden && document.getElementById('frYours').hidden, null, { timeout: 5000 });
  assert.deepEqual(errors, []);
});

test('on a phone each record page fits the width with no sideways scroll and buttons large enough to press', async (t) => {
  const pool = await database(t);
  const site = await serve(pool);
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await site.close(); });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  for (const name of ['accounts', 'transactions', 'bills', 'recurring', 'spending', 'goals']) {
    await page.goto(`${site.base}/api/finance/p/${name}`);
    await page.waitForLoadState('networkidle');
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(wide <= 0, `${name}: ${wide}px wider than the phone`);
    const small = await page.locator('button:visible').evaluateAll((nodes) => nodes.filter((n) => n.getBoundingClientRect().height < 44).map((n) => n.textContent));
    assert.deepEqual(small, [], `${name}: every button is at least 44 px tall`);
  }
});


/** A synthetic native-shaped saved snapshot, independent of the editable ledger. */
function savedBank(rows, coverage = 'complete') {
  const total = coverage === 'partial' ? 2501 : rows.length;
  const returned = coverage === 'partial' ? 2000 : rows.length;
  const c = { institution: 'Fixture Bank', state: coverage, returned, total, pages: coverage === 'partial' ? 4 : 1, reason: coverage === 'complete' ? null : 'page_limit' };
  return { generatedAt: '2026-11-17T12:00:00Z', sourceEnvironment: 'sandbox', currency: 'USD', balancesComplete: true,
    accounts: [{ name: 'Checking', type: 'depository', balance: 100, currency: 'USD' }], netWorth: { assets: 100, liabilities: 0, net: 100 },
    transactionsComplete: coverage === 'complete', transactionCoverage: { state: coverage, returned, total, institutions: [c] },
    transactionWindowDays: 90, recentTransactions: rows };
}

async function storeBank(pool, aggregate, person = PERSON) {
  await pool.query('INSERT INTO oshal_finance_data (user_sub,aggregate,synced_at) VALUES ($1,$2,$3) ON CONFLICT (user_sub) DO UPDATE SET aggregate=EXCLUDED.aggregate,synced_at=EXCLUDED.synced_at',
    [person, JSON.stringify(aggregate), '2026-11-17T12:00:00Z']);
}

async function bankFixture(t, aggregate, options) {
  const pool = await database(t); await storeBank(pool, aggregate);
  const site = await serve(pool, options), browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await site.close(); });
  if (!options?.summary) {
    const response = await fetch(site.base + '/api/finance/summary');
    assert.equal(response.status, 200, 'the actual compiled saved-summary route is ready before the page assertion');
    assert.deepEqual((await response.json()).aggregate.recentTransactions, aggregate.recentTransactions);
  }
  return { pool, site, browser };
}

async function openBankPage(f, width = 412) {
  const context = await f.browser.newContext({ viewport: { width, height: 915 }, locale: 'en-US' }), page = await context.newPage();
  await page.goto(f.site.base + '/api/finance/p/transactions');
  await page.locator('#frCounts').filter({ hasText: 'transactions' }).waitFor();
  return { context, page };
}

test('real saved bank activity is visible on phone and desktop without becoming ledger records', async (t) => {
  const bank = savedBank([{ name: 'Saved bank merchant', date: '2026-11-16', amount: 12.34, currency: 'USD', institution: 'Fixture Bank' }]);
  const f = await bankFixture(t, bank);
  await storeBank(f.pool, savedBank([{ name: 'Other owner only', date: '2026-11-16', amount: 99, currency: 'USD' }]), 'other-fixture-owner');
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM finance_transactions')).rows[0].n, 0);
  for (const width of [412, 1280]) {
    const { page, context } = await openBankPage(f, width);
    try {
      assert.equal(await page.locator('#frBankActivity').count(), 1, 'the actual Transactions page must expose its saved bank snapshot');
      await page.locator('#frBankActivity[data-state="ready"]').waitFor();
      const body = await page.locator('#frBankActivity').innerText();
      assert.match(body, /Saved bank activity[\s\S]*Test bank data[\s\S]*Nov 17, 2026/);
      assert.match(body, /1 of 1[\s\S]*90 days/);
      assert.match(body, /Saved bank merchant[\s\S]*USD\s*12\.34/);
      assert.doesNotMatch(body, /Other owner only/);
      assert.equal(await page.locator('#frBankRows input, #frBankRows button, #frBankRows select').count(), 0);
      assert.match(await page.locator('#frList').innerText(), /No transactions this month/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const box = await page.locator('#frBankActivity a.fr-link').boundingBox(); assert.ok(box.height >= 44);
      if (process.env.BANK_SHOTS) { fs.mkdirSync(process.env.BANK_SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.BANK_SHOTS, 'saved-bank-' + width + '.png') }); }
    } finally { await context.close(); }
  }
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM finance_transactions')).rows[0].n, 0);
  assert.deepEqual(f.site.requests.filter(r => !r.startsWith('GET ')), [], 'displaying bank activity writes nothing');
});

test('bank activity caps25 rows and refuses missing amounts or units instead of inventing dollars', async (t) => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ name: 'Bank row ' + i, date: '2026-11-16', amount: i + 1, currency: 'USD' }));
  Object.assign(rows[0], { name: '<img src=x onerror=alert(1)>', amount: 12.34 });
  Object.assign(rows[1], { amount: -8, currency: 'EUR' }); Object.assign(rows[2], { amount: 0, currency: 'GBP' });
  delete rows[3].currency; rows[4].amount = null; rows[5].currency = null; rows[6].date = ''; rows[7].date = '2026-02-30';
  const f = await bankFixture(t, savedBank(rows)), { page, context } = await openBankPage(f);
  try {
    assert.equal(await page.locator('#frBankActivity').count(), 1);
    await page.locator('#frBankActivity[data-state="ready"]').waitFor();
    assert.equal(await page.locator('#frBankRows > li').count(), 25);
    assert.match(await page.locator('#frBankCoverage').innerText(), /30 of 30[\s\S]*90 days/);
    assert.match(await page.locator('#frBankDisplay').innerText(), /25[\s\S]*recent[\s\S]*not[\s\S]*entire/);
    assert.match(await page.locator('#frBankRows > li').nth(1).innerText(), /In[\s\S]*EUR\s*8\.00/);
    assert.match(await page.locator('#frBankRows > li').nth(2).innerText(), /GBP\s*0\.00/);
    for (const i of [3, 4, 5]) { const row = await page.locator('#frBankRows > li').nth(i).innerText(); assert.match(row, /Unknown/); assert.doesNotMatch(row, /USD|\$/); }
    for (const i of [6, 7]) assert.match(await page.locator('#frBankRows > li').nth(i).innerText(), /Date unknown/);
    assert.equal(await page.locator('#frBankRows img').count(), 0);
    assert.doesNotMatch(await page.locator('#frBankRows').innerText(), /Bank row 25/);
  } finally { await context.close(); }
});

test('partial, unknown and complete-empty bank windows have distinct honest empty states', async (t) => {
  const f = await bankFixture(t, savedBank([], 'partial'));
  for (const [kind, aggregate, expected] of [
    ['partial', savedBank([], 'partial'), /partial[\s\S]*2000 of 2501/],
    ['unknown', { ...savedBank([]), transactionCoverage: null }, /Coverage unknown/],
    ['malformed', { ...savedBank([]), transactionCoverage: { state: 'complete', returned: 2000, total: 2501, institutions: [] } }, /Coverage unknown/],
    ['complete', savedBank([]), /complete[\s\S]*0 of 0/],
  ]) {
    await storeBank(f.pool, aggregate);
    const { page, context } = await openBankPage(f);
    try {
      assert.equal(await page.locator('#frBankActivity').count(), 1, kind);
      await page.locator('#frBankActivity[data-state="ready"]').waitFor();
      assert.match(await page.locator('#frBankCoverage').innerText(), expected, kind);
      const empty = await page.locator('#frBankRows').innerText();
      if (kind === 'complete') assert.match(empty, /No transactions in the provider-reported window/);
      else assert.doesNotMatch(empty, /No transactions in the provider-reported window/);
    } finally { await context.close(); }
  }
});

test('bank read failure leaves statement records usable and never triggers Sync', async (t) => {
  const f = await bankFixture(t, savedBank([]), { summary: (_req, res) => res.status(503).json({ message: 'Synthetic saved read refusal' }) });
  const { page, context } = await openBankPage(f);
  try {
    assert.equal(await page.locator('#frBankActivity').count(), 1);
    await page.locator('#frBankActivity[data-state="unavailable"]').waitFor();
    assert.match(await page.locator('#frBankActivity').innerText(), /could not be read[\s\S]*statement and manual/i);
    assert.match(await page.locator('#frCounts').innerText(), /0 transactions/);
    assert.equal(await page.getByRole('button', { name: 'Add one by hand', exact: true }).isEnabled(), true);
    assert.deepEqual(f.site.requests.filter(r => !r.startsWith('GET ')), []);
  } finally { await context.close(); }
});


test('malformed bank coverage cannot claim a complete window or crash the current page', async (t) => {
  const row = { name: 'Available bank row', date: '2026-11-16', amount: 10, currency: 'USD' };
  const good = savedBank([row]), f = await bankFixture(t, good);
  const changed = (change) => { const value = structuredClone(good); change(value); return value; };
  for (const aggregate of [
    changed(a => { a.transactionCoverage.institutions[0].institution = ''; }),
    changed(a => { a.transactionCoverage.institutions[0].pages = 4; }),
    changed(a => { a.transactionCoverage.institutions[0].state = 'unknown'; }),
    changed(a => { a.transactionCoverage.returned = 2; }),
    changed(a => { a.transactionCoverage.institutions = [null]; }),
    changed(a => { a.recentTransactions.push(null); }),
  ]) {
    await storeBank(f.pool, aggregate);
    const { page, context } = await openBankPage(f);
    try {
      await page.locator('#frBankActivity[data-state="ready"]').waitFor();
      assert.match(await page.locator('#frBankCoverage').innerText(), /Coverage unknown/);
      assert.match(await page.locator('#frBankRows').innerText(), /Available bank row/);
    } finally { await context.close(); }
  }
});

function holdBankReply() {
  let release, observed;
  const gate = new Promise(resolve => { release = resolve; }), captured = new Promise(resolve => { observed = resolve; });
  return { release, captured, summary: (_req, res, read) => {
    const send = res.json.bind(res);
    res.json = body => { observed(body); gate.then(() => send(body)); return res; };
    return read();
  } };
}

test('pagehide revokes a held real bank reply and a timed-out read restores manual refresh', async (t) => {
  const row = { name: 'Held bank merchant', date: '2026-11-16', amount: 10, currency: 'USD' };
  const held = holdBankReply(), f = await bankFixture(t, savedBank([row]), held);
  const { page, context } = await openBankPage(f);
  try {
    assert.equal((await held.captured).aggregate.recentTransactions[0].name, row.name, 'actual summary completed before its wire reply was held');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    held.release();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.doesNotMatch(await page.locator('#frBankActivity').innerText(), /Held bank merchant/);
  } finally { held.release(); await context.close(); }
  const late = holdBankReply(), timeout = await bankFixture(t, savedBank([row]), late);
  const ctx = await timeout.browser.newContext(), timed = await ctx.newPage();
  try {
    await timed.clock.install(); await timed.goto(timeout.site.base + '/api/finance/p/transactions'); await late.captured;
    await timed.clock.runFor(15001);
    await timed.locator('#frBankActivity[data-state="unavailable"]').waitFor();
    assert.equal(await timed.getByRole('button', { name: 'Refresh saved view', exact: true }).isEnabled(), true);
    assert.match(await timed.locator('#frCounts').innerText(), /Statement and manual records/);
    late.release(); await timed.clock.runFor(100);
    assert.doesNotMatch(await timed.locator('#frBankRows').innerText(), /Held bank merchant/);
    assert.deepEqual(timeout.site.requests.filter(r => !r.startsWith('GET ')), []);
  } finally { late.release(); await ctx.close(); }
});


test('an actual statement-built summary is not relabelled or duplicated as bank activity', async (t) => {
  const pool = await database(t);
  await importStatement(ledgerRoutes(pool), PERSON, { fileName: 'statement-only.csv', text: recentCsv([[1, 'Statement-only merchant', '-10.00']], '100.00'), newAccount: { name: 'Statement account', institution: 'Statement Bank', type: 'depository' } });
  const site = await serve(pool), browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await site.close(); });
  const reply = await fetch(site.base + '/api/finance/summary'), summary = await reply.json();
  assert.equal(reply.status, 200); assert.equal(summary.aggregate.ledger, true); assert.equal(summary.aggregate.sourceEnvironment, 'imported');
  assert.equal(summary.aggregate.recentTransactions[0].name, 'Statement-only merchant');
  const { page, context } = await openBankPage({ site, browser });
  try {
    await page.locator('#frBankActivity[data-state="ready"]').waitFor();
    assert.match(await page.locator('#frBankSource').innerText(), /statement and manual records[\s\S]*not a bank snapshot/i);
    assert.equal(await page.locator('#frBankRows .fr-row').count(), 0, 'statement rows must not appear again under bank activity');
    assert.match(await page.locator('#frList').innerText(), /Statement-only merchant/);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM finance_transactions')).rows[0].n, 1);
    assert.deepEqual(site.requests.filter(r => !r.startsWith('GET ')), []);
  } finally { await context.close(); }
});
