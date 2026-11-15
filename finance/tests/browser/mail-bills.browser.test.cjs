/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Finance 1.8.0 (Lane FINH2): Found in your mail on Bills, in Chromium against the real compiled routes over a disposable PostgreSQL and a stand-in Gmail server on loopback (only the framework's logger and the sign-in are stood in: a made-up person is signed in; the kernel's egress is a fetch that sends Finance's requests to the stand-in unchanged). Before the person presses Look for bills in my mail, no mail is read; the press turns the check on and looks at once; the two bills found show with who, the amount, the due date and the mail's date; Add to Bills makes one a bill (it says it pays nothing) and Not a bill turns the other down; Stop looking in my mail turns it off. With no Gmail connected the page says so and Open Connections goes to the connections page. A phone has no sideways scroll and every button is at least 44 px tall. Every person, sender, payee and figure is invented. Run: OSHAL_TEST_POSTGRES=... node --test tests/browser/mail-bills.browser.test.cjs
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PKG, ROUTES, TOOLCHAIN, database, requireWith } = require('../ledger.fixture.cjs');
const { WATER, CARD, RECEIPT, standIn } = require('../mail-stand-in.fixture.cjs');

const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));
const quiet = { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) };
const PERSON = 'test-person-mira';

/** A server with Finance's bills, mail and page routes over the pool, the made-up person signed in. */
async function serve(pool, fetcher) {
  const app = express();
  const requests = [];
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => { requests.push(`${req.method} ${req.path}`); req.oidc = { user: { sub: PERSON }, isAuthenticated: () => true }; next(); });
  const doubles = { express, '@/shared/logger': quiet, '@/shared/artifact-exchange': { redeemArtifactViaRelay: async () => ({ ok: false, status: 404 }) } };
  const ctx = { pool, appPackageDir: PKG, financeMailFetch: fetcher };
  const mounts = [['/api/finance/mail', 'finance-mail.js', 'createFinanceMailRoutes'], ['/api/finance/bills', 'finance-bills.js', 'createFinanceBillsRoutes'],
    ['/api/finance/p', 'finance-pages.js', 'createFinancePagesRoutes']];
  for (const [at, file, factory] of mounts) app.use(at, requireWith(path.join(ROUTES, file), doubles)[factory](ctx));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

const notice = (page) => page.locator('#frNotice:not([hidden])');

test('a person turns on the mail check on Bills, adds one bill found in their mail and turns down the other', async (t) => {
  const pool = await database(t);
  const box = await standIn(() => [WATER(), CARD(), RECEIPT()]);
  const site = await serve(pool, box.fetcher);
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await site.close(); await box.close(); });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto(`${site.base}/api/finance/p/bills`);
  await page.locator('#frMailWords').filter({ hasText: 'Finance can look through your Gmail for bills' }).waitFor();
  assert.match(await page.locator('#frMailWords').innerText(), /sends nothing, changes nothing in your mailbox and pays nothing/);
  assert.deepEqual(box.requests, [], 'no mail is read before the person turns the check on');
  await page.getByRole('button', { name: 'Look for bills in my mail' }).click();
  await notice(page).filter({ hasText: 'Finance found 2 bills in your mail. Each waits for your yes.' }).waitFor();
  await page.locator('#frMailList').getByText('Pinecrest Water Co', { exact: true }).waitFor();
  const listed = await page.locator('#frMailList').innerText();
  assert.match(listed, /Pinecrest Water Co[\s\S]*Due [^·]+ · from your mail of [\s\S]*\$48\.20[\s\S]*Mail from Pinecrest Water Co/);
  assert.match(listed, /Harbor Card[\s\S]*\$642\.17/);
  assert.ok(box.requests.every((q) => q.method === 'GET' && q.authorization === null));

  await page.locator('#frMailList li', { hasText: 'Pinecrest Water Co' }).getByRole('button', { name: 'Add to Bills' }).click();
  await notice(page).filter({ hasText: 'Pinecrest Water Co is in your Bills. It does not pay the bill.' }).waitFor();
  await page.locator('#frBills').getByText('Pinecrest Water Co', { exact: true }).waitFor();
  await page.locator('#frMailList li', { hasText: 'Harbor Card' }).getByRole('button', { name: 'Not a bill' }).click();
  await notice(page).filter({ hasText: 'Harbor Card will not be proposed again.' }).waitFor();
  await page.locator('#frMailList').getByText('No bill from your mail is waiting.').waitFor();

  await page.getByRole('button', { name: 'Stop looking in my mail' }).click();
  await notice(page).filter({ hasText: 'Finance no longer looks in your mail. The bills you added stay.' }).waitFor();
  await page.getByRole('button', { name: 'Look for bills in my mail' }).waitFor();
  assert.ok(site.requests.every((r) => /^(GET|POST) \//.test(r)));
  assert.deepEqual(errors, []);
});

test('with no Gmail connected the page says so and Open Connections goes to the connections page', async (t) => {
  const pool = await database(t);
  const site = await serve(pool, async () => { throw new Error('gmail is not connected: connect your own gmail account on Utilities'); });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await site.close(); });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto(`${site.base}/api/finance/p/bills`);
  await page.getByRole('button', { name: 'Look for bills in my mail' }).click();
  await page.locator('#frMailWords').filter({ hasText: 'Connect your mail to find bills' }).waitFor();
  const link = page.getByRole('link', { name: 'Open Connections' });
  assert.deepEqual([await link.getAttribute('href'), await link.getAttribute('target')], ['/utilities', '_top']);
});

test('on a phone Found in your mail fits the width and every button is large enough to press', async (t) => {
  const pool = await database(t);
  const box = await standIn(() => [WATER(), CARD()]);
  const site = await serve(pool, box.fetcher);
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await site.close(); await box.close(); });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await page.goto(`${site.base}/api/finance/p/bills`);
  await page.getByRole('button', { name: 'Look for bills in my mail' }).click();
  await page.locator('#frMailList').getByText('Harbor Card', { exact: true }).waitFor();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(wide <= 0, `${wide}px wider than the phone`);
  const small = await page.locator('button:visible, a.fr-link:visible').evaluateAll((nodes) => nodes.filter((n) => n.getBoundingClientRect().height < 44).map((n) => n.textContent));
  assert.deepEqual(small, []);
});
