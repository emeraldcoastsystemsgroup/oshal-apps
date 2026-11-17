/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.5.6 (lane mobilesweep1, the phone first-screen sweep of 2026-11-16: the restaurants started 438 px down a 915 px phone, 48%, under the brand bar, the "Food delivered where you are." headline, the address card and the search card). The real page in a stand-in for Today (tests/browser/today-phone-fixture.cjs; Today hides its own assistant button for Eats, so the stand-in draws none) with synthetic answers and every write refused, for a new person (no address) and for one with a saved address and three synthetic restaurants: at 412x915, 390x844 and 360x780 with touch the restaurants section starts within the top 30% and the first restaurant within the top 40% (a delivery app's address, search and cuisine rows come first), the brand and the headline are not drawn, Settings is a whole 44 px icon beside the first row, nothing scrolls the page sideways and the page's own Eats Concierge button covers nothing at the end; at 1440x900 the desktop keeps its brand bar and headline. Red on 1.5.5.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { SIZES, playwright, openInToday, screenTop, sideways } = require('./browser/today-phone-fixture.cjs');

const PAGE = path.join(__dirname, '..', 'tools', 'eats-app.html');
const ADDRESS = '1 Example Way, Springfield';
const place = (n) => ({ placeId: `fixture-place-${n}`, name: `Fixture Kitchen ${n}`, rating: 4.5, ratingCount: 120, cuisine: 'Thai', address: `${n} Example Street, Springfield`, delivery: true });
const reads = (saved) => ({
  '/api/eats/config': { rail: 'places', source: 'Google Places' },
  '/api/eats/profile': { profile: saved ? { default_address: ADDRESS } : {}, remembered: [] },
  '/api/eats/orders/history': { orders: [] },
  '/api/eats/search': { items: [place(1), place(2), place(3)], place: { address: ADDRESS } },
});

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

/** Eats in the stand-in Today, waiting for its first paint: the address prompt, or the three restaurants. */
async function openEats(size, saved) {
  const opened = await openInToday(browser, size, { url: '/api/eats/app', files: { '/api/eats/app': PAGE }, reads: reads(saved),
    scripts: { '/cockpit/js/app-workflows.js': 'export function mountConnectedActions() { return Promise.resolve(); }',
      '/cockpit/js/app-handoff.js': 'export function receiveHandoff() { return Promise.resolve(null); }' },
    ready: (frame) => frame.waitForFunction((want) => (want ? document.querySelectorAll('#grid .card').length === 3 : /address/i.test(document.getElementById('grid').textContent || '')), saved, { timeout: 15000 }) });
  await opened.page.evaluate(() => document.getElementById('jarvisOrbFab')?.remove()); // Today hides its button for Eats (ribbon.hideAssistant)
  return opened;
}

const drawn = (frame, selector) => frame.evaluate((sel) => { const el = document.querySelector(sel); return Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'); }, selector);

/** At the end of the page, the buttons and links under the page's own floating Eats Concierge button. */
function underConcierge() {
  const se = document.scrollingElement || document.documentElement;
  se.scrollTop = se.scrollHeight;
  const b = document.querySelector('.concierge-open-btn');
  if (!b || !b.getClientRects().length) return [];
  const o = b.getBoundingClientRect();
  return [...document.querySelectorAll('button,a[href],input,select,textarea')].filter((el) => el !== b && el.getClientRects().length)
    .filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > o.top && r.top < o.bottom && r.right > o.left && r.left < o.right; })
    .map((el) => (el.getAttribute('aria-label') || el.textContent).trim().slice(0, 30));
}

for (const size of SIZES) {
  for (const saved of [false, true]) {
    test(`${size.width}x${size.height}, ${saved ? 'a saved address' : 'a new person'}: the restaurants start near the top`, { timeout: 60000 }, async (t) => {
      const phone = size.width <= 640;
      const { page, frame, context, writes, errors } = await openEats(size, saved);
      try {
        const results = await screenTop(page, frame, '.results');
        const first = saved ? await screenTop(page, frame, '#grid .card') : null;
        t.diagnostic(`restaurants section ${results}px (${Math.round((results / size.height) * 100)}%)${saved ? `, first restaurant ${first}px (${Math.round((first / size.height) * 100)}%)` : ''}`);
        const fit = await sideways(frame);
        assert.ok(fit.scrollWidth <= fit.clientWidth, `nothing scrolls the page sideways (${fit.scrollWidth} > ${fit.clientWidth})`);
        if (phone) {
          assert.ok(results <= size.height * 0.3, `the restaurants section starts within the top 30%: ${results}px of ${size.height}`);
          if (saved) assert.ok(first <= size.height * 0.4, `the first restaurant starts within the top 40%: ${first}px of ${size.height}`);
          assert.equal(await drawn(frame, '.topbar .brand'), false, 'Today\'s bar names the page; the brand is not drawn again');
          assert.equal(await drawn(frame, '.location-title'), false, 'no headline above the address');
          const settings = await frame.getByRole('button', { name: 'Settings' }).boundingBox();
          const row = await frame.locator(saved ? '#deliverToBtn' : '#address').boundingBox();
          assert.ok(settings.width >= 44 && settings.height >= 44, 'Settings is a whole 44 px target');
          assert.ok(Math.abs((settings.y + settings.height / 2) - (row.y + row.height / 2)) < 10 && settings.x >= row.x + row.width - 1, `beside the first row (settings ${JSON.stringify(settings)}, row ${JSON.stringify(row)})`);
          assert.deepEqual(await frame.evaluate(underConcierge), [], 'the Eats Concierge button covers nothing at the end of the page');
        } else {
          assert.equal(await drawn(frame, '.topbar .brand'), true, 'the desktop keeps its brand bar');
          if (!saved) assert.equal(await drawn(frame, '.location-title'), true, 'and its headline for a new person');
        }
        assert.deepEqual(writes, [], 'opening Eats writes nothing');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  }
}
