/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: in Chromium over the shipped tools/trading.html and ui scripts, served with the SHIPPED accounts, book-read, order-flow, research and chart routes on a native-kernel-shaped host (no broker, no market-data connector, the person's armed paper book holding UPCO, a World price archive). The landing shows the Paper tile with its $100,000 and a PAPER pill, the hero total is the paper book's (it said "$0 · No accounts yet - connect a Schwab login"), and the positions rollup lists UPCO in the paper book; opening the account and the UPCO row draws the archive's stored prices as a chart line with its note, and Allocation says the paper book needs no broker. Seams: the shell's shared theme assets are empty stand-ins and the kernel schedule list answers none. Needs the store toolchain (express, playwright, chromium).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createSqlDouble, createIntentDouble } = require('./support/paper-doubles');
const { standIns, loadShipped, nativeLandingPool, worldArchive } = require('./support/native-landing-host');
const { paperHandlers } = require('../routes/trading-paper-routes');

const PKG = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

const SUB = 'browser-alice';
const NOW = new Date();
const UNIVERSE = ['UPCO', 'SPY'];

/**
 * @description The shipped trading routers over the native-shaped host.
 * @param {object} ctx - Route context (pool + intent).
 * @returns {{api:object, charts:object}} Express routers for /api/trading and /api/trading-charts.
 */
function shippedRouters(ctx) {
  const api = express.Router();
  api.get('/', (_req, res) => res.sendFile(path.join(PKG, 'tools', 'trading.html')));
  api.use('/ui', express.static(path.join(PKG, 'tools', 'ui')));
  let charts = null;
  loadShipped(standIns({ universe: UNIVERSE, express }), (load) => {
    load('trading-accounts-routes.js').registerTradingAccountRoutes(api, ctx);
    load('trading-routes-book-read-builders.js').registerTradingBookReadRoutes(api, ctx, path.join(PKG, 'tools'));
    load('trading-routes-order-flow-builders.js').registerTradingOrderFlowRoutes(api, ctx, async () => { throw new Error('no order placement in this test'); });
    load('trading-research-routes.js').registerTradingResearchRoutes(api, ctx);
    charts = load('trading-charts-routes.js').createTradingChartsRoutes({ ...ctx, appPackageDir: PKG });
  });
  api.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'Not part of this test host.' }));
  return { api, charts };
}

/**
 * @description Serve the page and the shipped routes as the signed-in person.
 * @param {object} ctx - Route context.
 * @returns {Promise<{server:object, base:string}>} The server and its origin.
 */
async function serve(ctx) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.oshalCallerSub = SUB; req.userSub = SUB; next(); });
  const { api, charts } = shippedRouters(ctx);
  app.use('/api/trading-charts', charts);
  app.use('/api/trading', api);
  app.get('/api/v1/agent/schedules', (_req, res) => res.json({ schedules: [] }));
  app.get(/^\/shared\/.*\.js$/, (_req, res) => res.type('js').send(''));
  app.get(/^\/shared\/.*\.css$/, (_req, res) => res.type('css').send(''));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('with no Schwab the landing shows the paper book, and its chart draws the World archive', { timeout: 60000 }, async (t) => {
  const sql = createSqlDouble();
  const tickAt = new Date('2026-10-05T14:35:15Z');
  const prices = createIntentDouble({ UPCO: { price: 100, step: 0.005 } }, { now: tickAt });
  const paper = paperHandlers({ pool: sql.pool, intent: prices.intent }, () => tickAt);
  await paper.arm({ oshalCallerSub: SUB, body: { universe: ['UPCO'] }, headers: {} });
  const qty = (await paper.tick({ oshalCallerSub: SUB, body: {}, headers: {} })).body.orders[0].qty;
  const archive = worldArchive({ UPCO: { price: 100, step: 0.0004 }, SPY: { price: 600, step: 0.0001 } }, NOW);
  const { server, base } = await serve({ pool: nativeLandingPool(sql), intent: archive.intent });
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise((r) => server.close(r)); });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(base + '/api/trading/');
  const tile = page.locator('#tiles .tile', { hasText: 'Paper (reference book)' });
  await tile.waitFor();
  await page.waitForFunction(() => document.getElementById('heroTotal').textContent !== '…');
  assert.equal(await page.locator('#heroTotal').textContent(), '$100,000', 'the hero total is the paper book, not $0');
  assert.match(await tile.innerText(), /PAPER[\s\S]*\$100,000[\s\S]*Paper autopilot: armed/);
  assert.doesNotMatch(await page.locator('#tiles').innerText(), /No accounts yet/);
  const rollup = await page.locator('#rollup').innerText();
  assert.match(rollup, new RegExp(`UPCO\\s+${qty}\\s+\\$${(qty * 100).toLocaleString('en-US')}\\s+Paper \\(reference book\\) \\(${qty}\\)`));
  await page.screenshot({ path: path.join(process.env.TRADING_PROOF_DIR || require('node:os').tmpdir(), 'paper-landing.png'), fullPage: true });

  await tile.locator('[data-act="open"]').click();
  const row = page.locator('tr[data-fsym="UPCO"]');
  await row.waitFor();
  await row.click();
  const note = page.locator('.chart-note');
  await note.waitFor();
  assert.match(await note.textContent(), /Stored prices from oshal's World archive/);
  assert.ok(await page.locator('#focChart canvas').count() > 0, 'the chart drew');
  assert.doesNotMatch(await page.locator('#focChart').innerText(), /chart unavailable/i);
  await page.waitForFunction(() => /needs no broker/.test(document.body.innerText));
  assert.doesNotMatch(await page.locator('body').innerText(), /Connect one in Settings/);
  await page.screenshot({ path: path.join(process.env.TRADING_PROOF_DIR || require('node:os').tmpdir(), 'paper-account-chart.png'), fullPage: true });
  assert.deepEqual(errors, []);
});
