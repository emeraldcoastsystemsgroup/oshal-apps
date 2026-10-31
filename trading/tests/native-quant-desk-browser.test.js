/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive the shipped Quant desk screen at desktop and phone widths over the shipped routes: run it, read the list, sort, open a reason, see holdings and both records, turn nightly scoring on. The screen may write only to the desk and its own job.
 */
'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { detailsHost } = require('./support/native-details-host');
const { createTradingQuantRoutes } = require('../routes/quant/routes');
const { seeded, weekdays, candles, memoryPool } = require('./support/native-quant-doubles');
const { lastCompletedSession } = require('../routes/trading-portfolio-calendar');
const { chromium } = require(path.resolve(__dirname, '../../scripts/toolchain/node_modules/playwright'));
const express = require(path.resolve(__dirname, '../../scripts/toolchain/node_modules/express'));

test('the Quant desk runs, explains a rank and shows its record on desktop and phone', async (t) => {
  const h = await detailsHost();
  t.after(() => new Promise((resolve) => h.server.close(resolve)));
  const session = lastCompletedSession(new Date());
  const dates = weekdays(session, 800), series = new Map();
  const barsOf = (symbol) => { if (!series.has(symbol)) { const r = seeded(symbol.length * 97 + symbol.charCodeAt(0)); series.set(symbol, candles(dates, () => 0.0006 + (r() - 0.5) * 0.015)); } return series.get(symbol); };
  const accounts = [{ accountMasked: '…1234', positions: [{ symbol: 'AAPL', marketValue: 6000 }, { symbol: 'BIL', marketValue: 4000 }] }];
  const intent = async (name, input) => {
    if (name === 'trading.config') return { configured: true };
    if (name === 'trading.accounts') return { accounts };
    if (name === 'trading.bars') return { source: 'schwab', symbol: input.symbol, bars: barsOf(input.symbol) };
    if (name === 'feeds.congress_trades') return { source: 'world_congress_trades', trades: [] };
    if (name === 'feeds.events') return [];
    throw new Error('Unexpected intent ' + name);
  };
  const seam = createTradingQuantRoutes({ pool: memoryPool(), intent }, () => express.Router(), { secTickers: async () => ({}), pause: async () => {} });
  const activated = [], schedule = { id: 'quant-job', app: 'intelligent-trades', name: 'quant-desk', status: 'not-activated' };
  const outer = express();
  outer.use(express.json());
  outer.use((req, _res, next) => { req.oshalCallerSub = 'owner-a'; next(); });
  outer.use('/api/trading/quant', seam);
  outer.get('/api/v1/agent/schedules', (_q, r) => r.json({ schedules: [schedule] }));
  outer.post('/api/v1/agent/schedules/:id/activate', (q, r) => { activated.push(q.params.id); schedule.status = 'active'; schedule.activation = { class: 'Person' }; r.json({ status: 'activated' }); });
  const proxy = require('node:http');
  outer.use((req, res) => { const up = proxy.request({ host: '127.0.0.1', port: h.server.address().port, path: req.originalUrl, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); }); if (req.body && Object.keys(req.body).length) up.write(JSON.stringify(req.body)); up.end(); });
  const server = await new Promise((resolve) => { const s = outer.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } }), page = await context.newPage(), errors = [], writes = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => { if (r.method() !== 'GET') writes.push(new URL(r.url()).pathname); });
    await page.goto(base + '/api/trading/?view=research&sub=quant');
    await page.getByRole('heading', { name: 'Quant desk', exact: true }).waitFor();
    if (width === 1440) {
      await page.getByText('No list yet.').waitFor();
      assert.equal(await page.locator('[data-quant-state] b').innerText(), 'off');
      await page.getByRole('button', { name: 'Run now', exact: true }).click();
    }
    await page.locator('[data-quant-top] table').waitFor({ timeout: 120000 });
    assert.match(await page.locator('[data-quant-covered]').innerText(), /Scored \d+ stocks/);
    assert.match(await page.locator('[data-quant-market] h2').innerText(), /The market: /);
    const holdings = await page.locator('[data-quant-holdings]').innerText();
    assert.match(holdings, /AAPL[\s\S]*#\d+ of \d+/);
    assert.match(holdings, /BIL[\s\S]*Fund, not ranked/);
    const first = page.locator('[data-quant-table="top"] tbody tr').first();
    assert.equal((await first.locator('td').first().innerText()).trim(), '1');
    await first.locator('summary').click();
    assert.match(await first.locator('details').innerText(), /12 months before last month/);
    await page.locator('[data-quant-table="top"]').getByRole('button', { name: /^Volatility/ }).click();
    const vols = await page.locator('[data-quant-table="top"] tbody tr td:nth-child(9)').allInnerTexts();
    assert.deepEqual(vols.map(parseFloat), [...vols.map(parseFloat)].sort((a, b) => b - a), 'sorted by the chosen column');
    assert.match(await page.locator('[data-quant-lead]').innerText(), /History test verdict for this ranking/);
    await page.locator('[data-qd-rank]').selectOption('lowvol');
    assert.equal(await page.locator('[data-qd-rank]').inputValue(), 'lowvol');
    const volsBy = await page.locator('[data-quant-table="top"] tbody tr td:nth-child(9)').allInnerTexts();
    assert.deepEqual(volsBy.map(parseFloat), [...volsBy.map(parseFloat)].sort((a, b) => a - b), 'ranking by low volatility puts the calmest first');
    assert.match(await page.locator('[data-quant-history]').innerText(), /Without biggest winners/i);
    assert.match(await page.locator('[data-quant-history]').innerText(), /Composite[\s\S]*Market trend rule/);
    assert.match(await page.locator('[data-quant-history]').innerText(), /today's companies/);
    assert.match(await page.locator('[data-quant-forward]').innerText(), /Not enough yet[\s\S]*0 of 12/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no page overflow ' + width);
    if (width === 1440) {
      await page.getByRole('button', { name: 'Turn on nightly scoring', exact: true }).click();
      await page.getByRole('button', { name: 'Turn off nightly scoring', exact: true }).waitFor();
      assert.deepEqual(activated, ['quant-job'], "the person's own job is activated in their session");
    }
    assert.deepEqual(errors, [], width + ' page errors');
    assert.deepEqual([...new Set(writes)].filter((p) => !/^\/api\/trading\/quant\/|^\/api\/v1\/agent\/schedules\/quant-job\/activate$/.test(p)), [], 'the screen writes only to the desk and its own job');
    await context.close();
  }
});
