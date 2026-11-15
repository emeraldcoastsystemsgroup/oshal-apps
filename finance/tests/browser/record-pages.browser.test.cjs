/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Finance 1.7.0's record pages driven in Chromium against the real compiled routes over a disposable PostgreSQL (only the framework's logger and the sign-in are stood in: a made-up person is signed in). A person with no bank link chooses a statement file on Accounts, previews it (nothing added yet), adds its transactions and sees the account; Bills proposes the utility charged every month, Add to Bills makes it a bill and Mark paid says it pays nothing; Spending shows the month's money out with its source; a goal is added and money set aside says no money moved; Transactions marks one looked at; the same file again adds nothing; Undo takes the statement back out; a phone has no sideways scroll. Every person, payee and figure is invented. Run: OSHAL_TEST_POSTGRES=... node --test tests/browser/record-pages.browser.test.cjs
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Finance 1.8.0 (Lane FINH2): Recurring lists the utility with what it costs a year and that it is in Bills, Mark to cancel says Finance cancels nothing, Review again and Keep; the second preview of the same file is not listed among the statements brought in; a goal is closed and deleted from Closed goals; after Undo, Paid lists no matching payment and the bill is stopped with No longer due and deleted from Ended, each asked twice. Looked at waits for the counts to change instead of reading them once (it raced the reload in one run of four).
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PKG, ROUTES, TOOLCHAIN, database, requireWith, recentCsv } = require('../ledger.fixture.cjs');

const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));
const quiet = { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) };
const PERSON = 'test-person-rita';
const STATEMENT = recentCsv([[1, 'City Utilities', '-112.40'], [2, 'Harbor Market', '-84.31'], [5, 'Payroll Lakeside Design Co', '3200.00'], [29, 'City Utilities', '-109.80'],
  [33, 'Harbor Market', '-61.02'], [35, 'Payroll Lakeside Design Co', '3200.00'], [57, 'City Utilities', '-114.05'], [60, 'Harbor Market', '-70.00']], '4820.44');

/** A server with Finance's record routes over the pool, the made-up person signed in. */
async function serve(pool) {
  const app = express();
  app.use(express.json({ limit: '3mb' }));
  app.use((req, _res, next) => { req.oidc = { user: { sub: PERSON }, isAuthenticated: () => true }; next(); });
  const doubles = { express, '@/shared/logger': quiet, '@/shared/artifact-exchange': { redeemArtifactViaRelay: async () => ({ ok: false, status: 404 }) } };
  const ctx = { pool, appPackageDir: PKG };
  const mounts = [['/api/finance/ledger', 'finance-ledger.js', 'createFinanceLedgerRoutes'], ['/api/finance/bills', 'finance-bills.js', 'createFinanceBillsRoutes'],
    ['/api/finance/goals', 'finance-goals.js', 'createFinanceGoalsRoutes'], ['/api/finance/month', 'finance-month.js', 'createFinanceMonthRoutes'],
    ['/api/finance/day', 'finance-day.js', 'createFinanceDayRoutes'], ['/api/finance/p', 'finance-pages.js', 'createFinancePagesRoutes'],
    ['/api/finance/recurring', 'finance-recurring.js', 'createFinanceRecurringRoutes'], ['/api/finance/mail', 'finance-mail.js', 'createFinanceMailRoutes']];
  for (const [at, file, factory] of mounts) app.use(at, requireWith(path.join(ROUTES, file), doubles)[factory](ctx));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
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
