/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Phone proof for the Kalshi page (tools/kalshi.html): with a synthetic scan, scorecard and alert history rendered by the page's own code, no tab makes the page wider than the screen at 412 x 915 or in the 392 px cockpit frame; the 12-column scan table keeps every column and scrolls sideways in its own box (it made the page 829 px wide in a 392 px frame, Scorecard 686, Alerts 484).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { VIEWPORTS, playwright, openPage, overflow } = require('./phone-fixture.cjs');

const PAGE = path.resolve(__dirname, '../../tools/kalshi.html');
const NOW = Date.now();

/** A synthetic hand with the long market titles the live feed carries. */
function hand(index) {
  return { strength: ['monster', 'strong', 'playable'][index % 3], side: index % 2 ? 'no' : 'yes', category: 'Climate and Weather',
    title: `Will the synthetic fixture temperature in Coastal Test City be above 71.99 degrees on day ${index}? — 72 degrees or above`,
    ticker: `KXFIXTURE-26OCT${10 + index}-T71.99`, price: 0.62, trueProb: 0.71, edgeNet: 0.061, stakeFraction: 0, confidence: 0.8,
    calibrationN: 140, riskFlags: ['thin', 'late'], closeTime: new Date(NOW + 36e5 * (index + 2)).toISOString() };
}
const SCORECARD = ['scan', 'weather-model', 'fixture-third-strategy'].map((strategy) => ({ strategy, status: 'unproven', graded: 12, pending: 30,
  brier: 0.2134, marketBrier: 0.2209, hitRate: 0.58, pnlPerContract: 0.012 }));
const READS = {
  '/api/kalshi/scan': { hands: [0, 1, 2, 3, 4].map(hand), evaluable: 1500, scorecard: SCORECARD, gateReason: 'No strategy has 30 settled predictions yet.',
    scan: { ageSeconds: 600, lastMs: 35600 }, exchangeActive: true, calibrationGeneratedAt: '2026-07-13T00:00:00Z' },
  '/api/kalshi/alerts': { alerts: [0, 1, 2].map((i) => ({ created_at: new Date(NOW - 36e5 * i).toISOString(), ticker: hand(i).ticker, strength: 'strong',
    edge_net: 0.061, settled: false, channel: 'jarvis', delivered: true, detail: { title: hand(i).title, side: 'yes' } })), record: null },
  '/api/kalshi/alerts/pops': { pops: {} },
};

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

for (const viewport of VIEWPORTS) {
  test(`every Kalshi tab fits a ${viewport.width} px screen; wide tables scroll in their own box`, async () => {
    const { page, context, writes } = await openPage(browser, viewport, { url: '/api/kalshi/', files: { '/api/kalshi/': PAGE }, reads: READS });
    try {
      await page.waitForFunction(() => document.querySelectorAll('#rows tr').length === 5 && document.querySelectorAll('#score-rows tr').length === 3);
      for (const tab of ['scan', 'scorecard', 'alerts']) {
        await page.locator(`.tab[data-tab="${tab}"]`).click();
        if (tab === 'alerts') await page.waitForFunction(() => document.querySelectorAll('#alert-rows tr').length === 3);
        const fit = await overflow(page);
        assert.ok(fit.scrollWidth <= fit.clientWidth, `${tab}: the page is ${fit.scrollWidth}px wide in a ${fit.clientWidth}px screen`);
        assert.deepEqual(fit.offenders, [], `${tab}: elements past the right edge`);
      }
      await page.locator('.tab[data-tab="scan"]').click();
      const table = await page.evaluate(() => {
        const box = document.getElementById('tbl').parentElement;
        return { headers: document.querySelectorAll('#tbl thead th').length, boxScrolls: box.scrollWidth > box.clientWidth, overflowX: getComputedStyle(box).overflowX };
      });
      assert.equal(table.headers, 12, 'the scan table keeps every column on a phone');
      assert.ok(table.boxScrolls && table.overflowX === 'auto', `the scan table scrolls sideways in its own box (${JSON.stringify(table)})`);
      assert.deepEqual(writes, [], 'opening the page and switching tabs wrote nothing');
    } finally {
      await context.close();
    }
  });
}
