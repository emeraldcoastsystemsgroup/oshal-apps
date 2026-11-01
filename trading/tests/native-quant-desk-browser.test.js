/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The list is read a page at a time: the page, the group filter, search and sorting across the whole list are driven in the browser, on real companies from a stand-in for the SEC's list.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Roger pressed both buttons, both worked, and all he saw was a flicker: every click must leave a message saying what it did, and Run now with nothing new must not repaint.
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
  const seam = createTradingQuantRoutes({ pool: memoryPool(), intent }, () => express.Router(), { listedCompanies: async () => ({ fields: ['cik', 'name', 'ticker', 'exchange'], data: Array.from({ length: 60 }, (_, i) => [1000 + i, i === 0 ? 'Newmont Corp' : 'Company ' + i, 'C' + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + (i >> 2)), 'NYSE']) }), readSec: async () => ({ revenueYoYPct: 5, netMarginPct: 5 }), readCompany: async () => ({ sic: '1040' }), pause: async () => {} });
  const activated = [], schedule = { id: 'quant-job', app: 'intelligent-trades', name: 'quant-desk', status: 'not-activated', nextRunAt: '2026-11-02T22:00:00.000Z' };
  const outer = express();
  outer.use(express.json());
  outer.use((req, _res, next) => { req.oshalCallerSub = 'owner-a'; next(); });
  outer.use('/api/trading/quant', seam);
  outer.get('/api/v1/agent/schedules', (_q, r) => r.json({ schedules: [schedule] }));
  outer.post('/api/v1/agent/schedules/:id/deactivate', (_q, r) => { schedule.status = 'not-activated'; schedule.activation = null; r.json({ status: 'deactivated' }); });
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
    await page.locator('[data-quant-table="top"] table').waitFor({ timeout: 120000 });
    if (width === 1440) await page.getByText(/^Finished: scored the close of /).waitFor({ timeout: 120000 });
    assert.match(await page.locator('[data-quant-covered]').innerText(), /Scored \d+ stocks/);
    const poolNote = await page.locator('[data-quant-pool]').innerText();
    assert.match(poolNote, /Tonight's pool is \d+ names/);
    assert.match(poolNote, /Disclosures show trades, not what a member holds now/, 'what Congress data can show is said plainly');
    assert.match(poolNote, /Schwab has no coin prices/);
    assert.match(await page.locator('[data-quant-market] h2').innerText(), /The market: /);
    const holdings = await page.locator('[data-quant-holdings]').innerText();
    assert.match(holdings, /AAPL[\s\S]*#\d+ of \d+/);
    assert.match(holdings, /BIL[\s\S]*Fund, not ranked/);
    const first = page.locator('[data-quant-table="top"] tbody tr').first();
    assert.equal((await first.locator('td').first().innerText()).trim(), '1');
    await first.locator('summary').click();
    assert.match(await first.locator('details').innerText(), /12 months before last month/);
    await page.locator('[data-quant-table="top"]').getByRole('button', { name: /^Volatility/ }).click();
    await page.locator('[data-quant-table="top"]').getByRole('button', { name: /^Volatility ▼/ }).waitFor();
    const vols = await page.locator('[data-quant-table="top"] tbody tr td:nth-child(9)').allInnerTexts();
    assert.deepEqual(vols.map(parseFloat), [...vols.map(parseFloat)].sort((a, b) => b - a), 'sorted by the chosen column');
    assert.match(await page.locator('[data-quant-lead]').innerText(), /History test verdict for this ranking/);
    await page.locator('[data-qd-rank]').selectOption('lowvol');
    await page.waitForFunction(() => document.querySelector('[data-qd-rank]') && document.querySelector('[data-qd-rank]').value === 'lowvol' && document.querySelector('[data-quant-table="top"] tbody tr td') && document.querySelector('[data-quant-table="top"] tbody tr td').textContent.trim() === '1');
    const volsBy = await page.locator('[data-quant-table="top"] tbody tr td:nth-child(9)').allInnerTexts();
    assert.deepEqual(volsBy.map(parseFloat), [...volsBy.map(parseFloat)].sort((a, b) => a - b), 'ranking by low volatility puts the calmest first');
    assert.match(await page.locator('[data-quant-count]').innerText(), /Showing 1 to 25 of \d+\./);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByText(/Showing 26 to /).waitFor();
    assert.equal((await page.locator('[data-quant-table="top"] tbody tr').first().locator('td').first().innerText()).trim(), '26', 'the next page continues the ranking');
    await page.getByRole('button', { name: 'Previous', exact: true }).click();
    await page.getByText(/Showing 1 to 25 of /).waitFor();
    await page.locator('[data-qd-search]').fill('newmont');
    await page.getByText(/Showing 1 to 1 of 1 matching, ranked among all \d+\./).waitFor();
    assert.equal(await page.locator('[data-qd-search]').evaluate((el) => el === document.activeElement), true, 'typing keeps its place in the box');
    assert.match(await page.locator('[data-quant-table="top"] tbody').innerText(), /CAA/);
    await page.locator('[data-qd-search]').fill('');
    await page.getByText(/Showing 1 to 25 of \d+\./).waitFor();
    await page.locator('[data-quant-groups] summary').click();
    assert.match(await page.locator('[data-quant-groups]').innerText(), /Crypto funds|Gold & silver|Traded by Congress/, 'themes are summarized');
    assert.match(await page.locator('[data-quant-groups]').innerText(), /Gold & silver mining/, 'and so are industries from what companies report');
    await page.locator('[data-quant-groups]').getByRole('button', { name: 'Gold & silver mining', exact: true }).click();
    await page.getByText(/matching, ranked among all/).waitFor();
    assert.equal(await page.locator('[data-qd-group]').inputValue(), 'Gold & silver mining', 'pressing a group filters the list');
    await page.locator('[data-qd-group]').selectOption('');
    await page.getByText(/Showing 1 to 25 of \d+\./).waitFor();
    assert.match(await page.locator('[data-quant-history]').innerText(), /Without biggest winners/i);
    assert.match(await page.locator('[data-quant-history]').innerText(), /Composite[\s\S]*Market trend rule/);
    assert.match(await page.locator('[data-quant-history]').innerText(), /today's companies/);
    assert.match(await page.locator('[data-quant-forward]').innerText(), /Not enough yet[\s\S]*0 of 12/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no page overflow ' + width);
    if (width === 1440) {
      await page.locator('[data-quant-top]').evaluate((el) => { el.dataset.marker = 'same'; });
      await page.getByRole('button', { name: 'Run now', exact: true }).click();
      await page.getByText(/Already up to date: this list covers the close of/).waitFor();
      assert.equal(await page.locator('[data-quant-top]').getAttribute('data-marker'), 'same', 'nothing new to score means no repaint');
      assert.equal(await page.getByRole('button', { name: 'Run now', exact: true }).isEnabled(), true, 'the button comes back');
      await page.getByRole('button', { name: 'Turn on nightly scoring', exact: true }).click();
      await page.getByRole('button', { name: 'Turn off nightly scoring', exact: true }).waitFor();
      assert.deepEqual(activated, ['quant-job'], "the person's own job is activated in their session");
      assert.match(await page.locator('#qdMsg').innerText(), /Nightly scoring is on\. First run: /, 'the message survives the repaint');
      assert.match(await page.locator('[data-quant-state]').innerText(), /Nightly scoring: on\. Next run: /, 'the state line shows the real job');
      await page.getByRole('button', { name: 'Turn off nightly scoring', exact: true }).click();
      await page.getByRole('button', { name: 'Turn on nightly scoring', exact: true }).waitFor();
      assert.match(await page.locator('#qdMsg').innerText(), /Nightly scoring is off/);
      await page.getByRole('button', { name: 'Turn on nightly scoring', exact: true }).click();
      await page.getByRole('button', { name: 'Turn off nightly scoring', exact: true }).waitFor();
    }
    assert.deepEqual(errors, [], width + ' page errors');
    assert.deepEqual([...new Set(writes)].filter((p) => !/^\/api\/trading\/quant\/|^\/api\/v1\/agent\/schedules\/quant-job\/(activate|deactivate)$/.test(p)), [], 'the screen writes only to the desk and its own job');
    await context.close();
  }
});
