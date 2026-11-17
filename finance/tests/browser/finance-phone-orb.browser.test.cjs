/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.8.2 (lane mobilesweep1, the phone first-screen sweep of 2026-11-16: inside Today the floating Jarvis button rested on Finance's bottom bar, over its More tab, on every Finance screen). The real Finance page in a stand-in for Today (today-phone-fixture.cjs, an application that owns the window: no Today bar, the button 12 px above --oshal-app-bottom-inset as Today's jarvis-orb.js places it on a phone) with stand-in answers and every write refused: at 412x915, 390x844 and 360x780 with touch the button rests above the bottom bar and covers none of its tabs, and nothing to tap sits under it at the end of Home; at 1440x900 there is no bottom bar and Finance sets no inset. Red on 1.8.1.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { SIZES, playwright, openInToday, underOrbAtEnd } = require('./today-phone-fixture.cjs');

const PAGE = path.resolve(__dirname, '../../tools/finance-app.html');
const item = (id, label, url) => ({ id: `tool-${id}`, label, toolUi: { iframeUrl: url } });
const job = (app, name, more = {}) => ({ app, name, cron: '0 6 * * *', cadence: '0 6 * * *', description: `${name} does its work.`, status: 'active', executionCount: 3, failureCount: 0,
  lastRunAt: '2026-11-10T12:00:00Z', lastOutcome: 'completed', lastDurationMs: 1200, nextRunAt: '2026-11-11T12:00:00Z', history: [], ...more });
// Synthetic answers in the shapes the kernel gives (as tests/browser/finance-app.browser.test.cjs), enough for a Home that
// scrolls, so its last rows reach the floating button's corner at the end of the page.
const READS = {
  '/api/ui/profile': { profile: { ribbon: { items: [item('finance-app', 'Finance', '/api/finance/app'), item('finance-accounts', 'Accounts', '/api/finance/p/accounts'),
    item('finance-transactions', 'Transactions', '/api/finance/p/transactions'), item('finance-bills', 'Bills', '/api/finance/p/bills'), item('finance-spending', 'Spending', '/api/finance/p/spending'),
    item('finance-goals', 'Goals', '/api/finance/p/goals'), item('finance-home', 'Money', '/api/finance/'), item('finance-trading', 'Intelligent Trades', '/api/trading/'),
    item('finance-world', 'World Intelligence', '/api/world/app'), item('finance-kalshi', 'Kalshi Edge', '/api/kalshi/'), item('finance-recap', 'Daily recap', '/api/daily-trade-recap/review')] } } },
  '/api/v1/agent/schedules': { schedules: [job('intelligent-trades', 'paper-autopilot'), job('intelligent-trades', 'oshal-daily-report'), job('kalshi', 'background-scan'), job('daily-trade-recap', 'recorded-reports')] },
  '/api/swarm/roles/me': { displayName: 'Fixture Person' },
  '/api/finance/status': { connected: 1, env: 'sandbox', configured: true, items: [], hasData: true },
  '/api/finance/summary': { syncedAt: '2026-11-10T18:15:00Z', aggregate: { sourceEnvironment: 'sandbox', netWorth: { assets: 2450, liabilities: 1050, net: 1400 } } },
  '/api/finance/home-summary': { tiles: [{ id: 'linked-institutions', label: 'Saved bank links', value: '1' }], items: [{ text: 'Your saved account snapshot', detail: 'Source: sandbox', tone: 'neutral', fix: 'finance-home' }] },
  '/api/trading/home-summary': { tiles: [{ id: 'paper-orders-24h', label: 'Paper order records / 24h', value: '14' }], items: [{ text: 'No saved trading books yet.', tone: 'neutral', fix: 'intelligent-trades-home' }] },
  '/api/kalshi/home-summary': { tiles: [{ id: 'alerts-24h', label: 'Recorded alerts / 24h', value: '2' }], items: [] },
  '/api/daily-trade-recap/home-summary': { tiles: [{ id: 'awaiting', label: 'Recaps awaiting review', value: '1' }], items: [{ text: 'One recap is waiting for your review.', tone: 'warn', fix: 'recap-review' }] },
};

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

/** Finance in the stand-in Today, waiting for its first paint. */
function openFinance(size) {
  return openInToday(browser, size, { url: '/api/finance/app', files: { '/api/finance/app': PAGE }, reads: READS, ownFrame: true,
    ready: (frame) => frame.waitForFunction(() => document.querySelectorAll('#fxBottom .fx-tab, #fxBottom summary').length >= 3 || matchMedia('(min-width: 721px)').matches, null, { timeout: 15000 }) });
}

/** The bottom bar's tabs (and More) the floating button covers, in Today's coordinates. */
async function tabsUnderOrb(page, frame) {
  const orb = await page.locator('#jarvisOrbFab').boundingBox(), box = await page.locator('.tool-view-container > iframe').boundingBox();
  const local = { top: orb.y - box.y, bottom: orb.y + orb.height - box.y, left: orb.x - box.x, right: orb.x + orb.width - box.x };
  // A closed More menu's items keep layout boxes in Chromium (its details content is only content-visibility: hidden): skip them.
  return frame.evaluate((o) => [...document.querySelectorAll('#fxBottom .fx-tab, #fxBottom summary')].filter((el) => el.getClientRects().length && !el.closest('details:not([open]) > :not(summary)'))
    .filter((el) => { const b = el.getBoundingClientRect(); return b.bottom > o.top && b.top < o.bottom && b.right > o.left && b.left < o.right; })
    .map((el) => el.textContent.trim()), local);
}

for (const size of SIZES) {
  test(`${size.width}x${size.height}: the floating Jarvis button leaves Finance's bottom bar free`, { timeout: 60000 }, async (t) => {
    const phone = size.width <= 640;
    const { page, frame, context, writes, errors } = await openFinance(size);
    try {
      const inset = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--oshal-app-bottom-inset').trim());
      if (phone) {
        const orb = await page.locator('#jarvisOrbFab').boundingBox(), bar = await frame.locator('#fxBottom').boundingBox();
        t.diagnostic(`button ${Math.round(orb.y)}-${Math.round(orb.y + orb.height)}px, bottom bar from ${Math.round(bar.y)}px, inset "${inset}"`);
        assert.deepEqual(await tabsUnderOrb(page, frame), [], 'no tab of the bottom bar is under the floating button');
        assert.ok(orb.y + orb.height <= bar.y, `the button rests above the bar (${Math.round(orb.y + orb.height)} <= ${Math.round(bar.y)})`);
        assert.deepEqual(await underOrbAtEnd(page, frame), [], 'nothing to tap under the floating button at the end of Home');
      } else {
        assert.equal(inset, '', 'a desktop has no bottom bar, so Finance sets no inset');
      }
      assert.deepEqual(writes, [], 'opening Finance writes nothing');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
