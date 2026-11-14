/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Shopping 1.5.0: Order on the List screen, in Chromium at 412x915. Real: the page as the package's compiled router serves it, that router on the toolchain's Express over loopback, and the route's own SQL over the package's test pool. Stand-ins: the signed-in shopper, the shared theme and audience files (empty), and a Walmart rail that answers as the native kernel does (status not connected, every other operation refused). A shopper adds three items, presses Order and gets each with Find at Walmart; a ticked item is left out of the next order; with nothing left Order is off. Nothing leaves the installation: no link is followed.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fakePool, fakeProvider, loadRoutes } = require('./shopping-routes-harness');

const TOOLCHAIN = path.join(process.env.STORE_CI_TOOLCHAIN || path.resolve(__dirname, '..', '..', 'scripts', 'toolchain'), 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

/** The native kernel's Walmart answer: status says not connected, every other operation is refused. */
function nativeRail() {
  const refused = () => { throw Object.assign(new Error('Walmart provider operation (Walmart is not connected: no native connector)'), { status: 503 }); };
  return fakeProvider({ status: () => ({ mode: 'not_connected' }), search: refused, cart: refused, deals: refused });
}

/** The package's compiled router for one signed-in shopper, with the files a framed page asks its shell for. */
async function serve() {
  const pool = fakePool(), provider = nativeRail();
  const { router } = loadRoutes({ express, pool, provider });
  const app = express();
  app.use(express.json());
  app.get('/shared/ui/:kind/:file', (req, res) => res.type(req.params.kind === 'css' ? 'css' : 'js').send(''));
  app.get('/cockpit/js/app-handoff.js', (_req, res) => res.type('js').send('export function receiveHandoff() {}'));
  app.use('/api/purchasing', (req, res, next) => { req.oidc = { user: { sub: 'shopper-a' }, isAuthenticated: () => true }; router(req, res, next); });
  const listener = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => listener.once('listening', resolve));
  return { pool, provider, base: `http://127.0.0.1:${listener.address().port}`, close: () => new Promise((resolve) => listener.close(resolve)) };
}

test('a shopper adds three items, presses Order and gets each one with its place at Walmart', { timeout: 90000 }, async (t) => {
  const f = await serve();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await f.close(); });
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(), errors = [], outside = [];
  page.on('pageerror', (error) => errors.push(String(error.message)));
  page.on('request', (request) => { if (new URL(request.url()).origin !== f.base) outside.push(request.url()); });
  await page.goto(f.base + '/api/purchasing/dashboard?view=lists');
  await page.waitForFunction(() => document.querySelector('#list-items .empty'));
  assert.equal(await page.locator('#order').isDisabled(), true, 'an empty list has nothing to order');
  assert.equal(await page.locator('#storefront').isVisible(), false, 'no storefront without a rail');

  for (const title of ['eggs', 'bread', 'bananas']) {
    await page.fill('#add-title', title);
    await page.press('#add-title', 'Enter');
    await page.waitForFunction((words) => [...document.querySelectorAll('#list-items .lr-title')].some((node) => node.textContent === words), title);
  }
  assert.equal(await page.locator('#order').isEnabled(), true, 'Order needs no rail');
  await page.locator('#order').tap();
  await page.waitForFunction(() => document.querySelectorAll('#order-result .order-row').length === 3);
  assert.equal(await page.locator('#order-result h2').textContent(), 'Your order · 3 items');
  assert.match(await page.locator('#order-result .status-line').textContent(), /Nothing is bought or charged here/);
  const links = await page.locator('#order-result .order-row a').evaluateAll((nodes) => nodes.map((a) => [a.textContent, a.href, a.target, a.rel]));
  assert.deepEqual(links, ['eggs', 'bread', 'bananas'].map((title) => ['Find at Walmart', `https://www.walmart.com/search?q=${title}`, '_blank', 'noopener']));
  assert.equal(f.pool.tables.history.length, 1, 'the order is kept in the purchase history');
  assert.deepEqual(f.provider.calls.map(([operation]) => operation).filter((operation) => operation !== 'deals' && operation !== 'status'), [], 'no Walmart operation is asked for the order');
  const fits = await page.evaluate(() => ({
    sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    small: [...document.querySelectorAll('#order, #order-result a')].map((node) => Math.round(node.getBoundingClientRect().height)).filter((height) => height < 44),
  }));
  assert.deepEqual(fits, { sideways: 0, small: [] });

  await page.locator('.list-row', { hasText: 'bread' }).locator('input[type=checkbox]').check();
  await page.waitForFunction(() => document.querySelectorAll('#list-items .list-row.done').length === 1);
  await page.locator('#order').tap();
  await page.waitForFunction(() => document.querySelectorAll('#order-result .order-row').length === 2);
  assert.deepEqual(await page.locator('#order-result .order-row .lr-title').allTextContents(), ['eggs', 'bananas'], 'a ticked item is left out of the next order');

  for (const title of ['eggs', 'bananas']) await page.locator('.list-row', { hasText: title }).locator('input[type=checkbox]').check();
  await page.waitForFunction(() => document.querySelector('#order').disabled);
  assert.deepEqual([errors, outside], [[], []], 'no page error, and nothing left the installation');
});
