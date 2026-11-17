/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 0.4.1 (lane mobilesweep2, the phone first-screen sweep of 2026-11-16: the Print Inbox list started 264 px down a 915 px phone, 29%, under the explanation, the printed-documents note and the tabs). The real page (ui/index.html) inside a stand-in for Today (tests/browser/today-phone-fixture.cjs) with no documents and the printed-documents collect refused (every write is refused here, so the page shows its could-not-take-them note: the tallest first screen it draws). At 412x915, 390x844 and 360x780 with touch: the list starts within the top 30% of the screen, the one-line explanation is not drawn, the note and both tabs still show, nothing scrolls sideways and nothing to tap is under the floating Jarvis button at the end. At 1440x900 the explanation shows as before. Red on 0.4.0.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { SIZES, playwright, openInToday, screenTop, sideways, underOrbAtEnd } = require('./browser/today-phone-fixture.cjs');

const PAGE = path.join(__dirname, '..', 'ui', 'index.html');
const READS = { '/api/print-ingest/documents': { documents: [] } };

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

const drawn = (frame, selector) => frame.evaluate((sel) => { const el = document.querySelector(sel); return Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'); }, selector);

for (const size of SIZES) {
  test(`${size.width}x${size.height}: the Print Inbox list starts near the top`, { timeout: 60000 }, async (t) => {
    const phone = size.width <= 640;
    const { page, frame, context, writes, errors } = await openInToday(browser, size, { url: '/api/print-ingest/app', files: { '/api/print-ingest/app': PAGE }, reads: READS,
      ready: (f) => f.waitForFunction(() => document.querySelector('#list .empty') && !document.getElementById('printedNote').hidden, null, { timeout: 15000 }) });
    try {
      const list = await screenTop(page, frame, '#list');
      t.diagnostic(`list ${list}px (${Math.round((list / size.height) * 100)}%)`);
      const fit = await sideways(frame);
      assert.ok(fit.scrollWidth <= fit.clientWidth, `nothing scrolls the page sideways (${fit.offenders.join(', ')})`);
      assert.equal(await drawn(frame, '#printedNote'), true, 'the printed-documents note still shows');
      assert.equal(await frame.locator('.tabs [role="tab"]').count(), 2, 'both tabs show');
      if (phone) {
        assert.ok(list !== null && list <= size.height * 0.3, `the list starts within the top 30%: ${list}px of ${size.height}`);
        assert.equal(await drawn(frame, '.wrap > .sub:not(#printedNote)'), false, 'the one-line explanation steps aside');
        assert.deepEqual(await underOrbAtEnd(page, frame), [], 'nothing to tap is under the floating Jarvis button at the end');
      } else {
        assert.equal(await drawn(frame, '.wrap > .sub:not(#printedNote)'), true, 'the desktop keeps the explanation');
      }
      assert.deepEqual(writes, ['POST /api/print-ingest/printed/collect'], 'the only write is taking printed documents in, refused here');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
