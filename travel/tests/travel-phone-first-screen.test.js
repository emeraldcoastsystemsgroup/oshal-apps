/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.3.4 (lane mobilesweep2, the phone first-screen sweep of 2026-11-16: the results started 618 px down a 915 px phone, 68%, under a title, a tagline, the tabs and a seven-row flight search with Swap on a row of its own). The real page (tools/travel-app.html) inside a stand-in for Today (tests/browser/today-phone-fixture.cjs; Today hides its own assistant button for Travel, so the stand-in draws none) with test-fare answers and every write refused. At 412x915, 390x844 and 360x780 with touch: the flight search is four rows (From and To with Swap beside them, Depart | Return, Cabin | Search flights) that start within the top 30%, the tagline is not drawn and the empty results line shows on the first screen; after a search that found options the form folds into one line naming the trip with Edit search and the first option starts within the top 30%; Edit search opens the form again with the typed trip. At 1440x900 the form stays open after the search and the tagline shows. Nothing scrolls sideways and the page's own Travel concierge button covers nothing at the end. Red on 1.3.3.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { SIZES, playwright, openInToday, screenTop, sideways } = require('./browser/today-phone-fixture.cjs');

const PAGE = path.join(__dirname, '..', 'tools', 'travel-app.html');
const offer = (n) => ({ id: `fixture-offer-${n}`, airline: `Fixture Air ${n}`, cabin: 'economy', price: 180 + n * 20, currency: 'USD',
  slices: [{ origin: 'VPS', destination: 'DCA', stops: n === 1 ? 0 : 1, duration: '3h 10m', departAt: '2026-12-16T08:00:00' }] });
const READS = { '/api/travel/config': { mode: 'test' }, '/api/travel/watches': { watches: [] },
  '/api/travel/flights': { source: 'duffel-test', note: 'Duffel test fares, not real prices.', items: [offer(1), offer(2), offer(3)], price: { verdict: 'typical', advice: 'A typical price for this route.' } } };

// The kernel modules the page imports for connected actions and hand-offs: stand-ins that do nothing.
const SCRIPTS = { '/cockpit/js/app-workflows.js': 'export function mountConnectedActions() { return Promise.resolve(); }',
  '/cockpit/js/app-handoff.js': 'export function receiveHandoff() { return Promise.resolve(null); }' };

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

const drawn = (frame, selector) => frame.evaluate((sel) => { const el = document.querySelector(sel); return Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'); }, selector);

/** @description At the end of the page, the buttons and links under the page's own floating Travel concierge button. */
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
  test(`${size.width}x${size.height}: the flight search is compact and a search's options start near the top`, { timeout: 60000 }, async (t) => {
    const phone = size.width <= 640;
    const { page, frame, context, writes, errors } = await openInToday(browser, size, { url: '/api/travel/app', files: { '/api/travel/app': PAGE }, reads: READS, scripts: SCRIPTS,
      ready: (f) => f.waitForSelector('#f_origin', { timeout: 15000 }) });
    try {
      await page.evaluate(() => document.getElementById('jarvisOrbFab')?.remove()); // Today hides its button for Travel (ribbon.hideAssistant)
      const form = await screenTop(page, frame, '#searchForm'), empty = await screenTop(page, frame, '#results');
      t.diagnostic(`form ${form}px, results line ${empty}px (${Math.round((empty / size.height) * 100)}%)`);
      let fit = await sideways(frame);
      assert.ok(fit.scrollWidth <= fit.clientWidth, `nothing scrolls the page sideways (${fit.offenders.join(', ')})`);
      if (phone) {
        assert.ok(form !== null && form <= size.height * 0.3, `the search starts within the top 30%: ${form}px of ${size.height}`);
        assert.ok(empty !== null && empty + 30 <= size.height, `the empty results line shows on the first screen: ${empty}px of ${size.height}`);
        assert.equal(await drawn(frame, 'header .sub'), false, 'the tagline steps aside');
        const rows = await frame.evaluate(() => { const tops = []; for (const f of document.querySelectorAll('#searchForm > .field:not(:has(#f_swap))')) { const r = f.getBoundingClientRect(); if (!tops.some((x) => Math.abs(x - r.bottom) < 6)) tops.push(r.bottom); } return tops.length; });
        assert.equal(rows, 4, `the flight search is four rows (${rows})`);
        const swap = await frame.locator('#f_swap').boundingBox(), from = await frame.locator('#f_origin').boundingBox();
        assert.ok(swap.width >= 44 && swap.height >= 44 && swap.x > from.x + from.width - 1, 'Swap is a whole 44 px button beside From and To');
      } else {
        assert.equal(await drawn(frame, 'header .sub'), true, 'the desktop keeps the tagline');
      }
      await frame.locator('#f_origin').fill('VPS');
      await frame.locator('#f_dest').fill('DCA');
      await frame.locator('#searchForm button[type="submit"]').click();
      await frame.waitForSelector('#results .card');
      const first = await screenTop(page, frame, '#results .card');
      t.diagnostic(`first option ${first}px (${Math.round((first / size.height) * 100)}%)`);
      if (phone) {
        assert.ok(first !== null && first <= size.height * 0.3, `after the search the first option starts within the top 30%: ${first}px of ${size.height}`);
        assert.equal(await drawn(frame, '#searchForm'), false, 'the search folds');
        assert.match(await frame.locator('#searchSummaryText').textContent(), /^VPS → DCA · /, 'into one line naming the trip');
        const edit = await frame.locator('#searchEdit').boundingBox(), line = await frame.locator('#searchSummary').boundingBox();
        assert.ok(edit.height >= 44 && edit.x + edit.width <= line.x + line.width + 1 && edit.y >= line.y - 1 && edit.y + edit.height <= line.y + line.height + 1, 'with a whole 44 px Edit search inside it');
        await frame.locator('#searchEdit').click();
        assert.equal(await drawn(frame, '#searchForm'), true, 'Edit search opens the form again');
        assert.equal(await frame.locator('#f_origin').inputValue(), 'VPS', 'with the typed trip');
        assert.deepEqual(await frame.evaluate(underConcierge), [], 'the Travel concierge button covers nothing at the end of the page');
      } else {
        assert.equal(await drawn(frame, '#searchForm'), true, 'the desktop keeps the form open after the search');
        assert.equal(await drawn(frame, '#searchSummary'), false, 'and draws no folded line');
      }
      fit = await sideways(frame);
      assert.ok(fit.scrollWidth <= fit.clientWidth, `nothing scrolls sideways after the search (${fit.offenders.join(', ')})`);
      assert.deepEqual(writes, [], 'searching writes nothing');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
