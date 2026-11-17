/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.3.6 (lane mobilesweep2, the phone first-screen sweep of 2026-11-16: the Harvest Siting Console's verdict started 290 px down a 915 px phone, 32%, under the title, Brief and Help, a three-line intro and two badges). The real console (tools/harvest-console.html and its engine harvest-console.js, which computes in the page) inside a stand-in for Today (tests/browser/today-phone-fixture.cjs), every write refused (the console's model cross-check, POST /harvest/simulate, included: the page computes on its own). At 412x915, 390x844 and 360x780 with touch: the verdict starts within the top 30% of the screen, the intro is not drawn, the title is kept for assistive technology only (Today's bar names the console), Brief and Help stay in reach as whole 44 px buttons, nothing scrolls sideways and nothing to tap is under the floating Jarvis button at the end. At 1440x900 the title and the intro show as before. Red on 1.3.5.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { SIZES, playwright, openInToday, screenTop, sideways, underOrbAtEnd } = require('./browser/today-phone-fixture.cjs');

const TOOLS = path.join(__dirname, '..', 'tools');
const FILES = { '/api/ocean-lab/harvest-console': path.join(TOOLS, 'harvest-console.html'), '/api/ocean-lab/assets/harvest-console.js': path.join(TOOLS, 'harvest-console.js') };

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

const drawn = (frame, selector) => frame.evaluate((sel) => { const el = document.querySelector(sel); if (!el || !el.getClientRects().length) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden'; }, selector);

for (const size of SIZES) {
  test(`${size.width}x${size.height}: the verdict starts near the top of the Harvest Siting Console`, { timeout: 60000 }, async (t) => {
    const phone = size.width <= 640;
    const { page, frame, context, writes, errors } = await openInToday(browser, size, { url: '/api/ocean-lab/harvest-console', files: FILES, reads: {},
      ready: (f) => f.waitForFunction(() => !/Computing/.test(document.getElementById('verdict-note')?.textContent || 'Computing'), null, { timeout: 15000 }) });
    try {
      const verdict = await screenTop(page, frame, '#verdict');
      t.diagnostic(`verdict ${verdict}px (${Math.round((verdict / size.height) * 100)}%)`);
      const fit = await sideways(frame);
      assert.ok(fit.scrollWidth <= fit.clientWidth, `nothing scrolls the page sideways (${fit.offenders.join(', ')})`);
      for (const id of ['brief-open', 'help-open']) {
        const b = await frame.locator('#' + id).boundingBox();
        assert.ok(b && b.width >= 44 && b.height >= 44, `${id} is a whole 44 px button`);
      }
      assert.equal(await frame.locator('header.hero h1').textContent(), 'Harvest Siting Console', 'the title is still the page heading');
      if (phone) {
        assert.ok(verdict !== null && verdict <= size.height * 0.3, `the verdict starts within the top 30%: ${verdict}px of ${size.height}`);
        assert.equal(await drawn(frame, 'header.hero h1'), false, 'the title is for assistive technology only (Today\'s bar names the console)');
        assert.equal(await drawn(frame, 'header.hero > p:first-of-type'), false, 'the intro steps aside');
        assert.deepEqual(await underOrbAtEnd(page, frame), [], 'nothing to tap is under the floating Jarvis button at the end');
      } else {
        assert.equal(await drawn(frame, 'header.hero h1'), true, 'the desktop keeps the title');
        assert.equal(await drawn(frame, 'header.hero > p:first-of-type'), true, 'and the intro');
      }
      // The console asks the server to cross-check its model (POST /harvest/simulate, a computation that stores nothing); the fixture refuses it.
      assert.deepEqual(writes.filter((w) => w !== 'POST /api/ocean-lab/harvest/simulate'), [], 'opening the console sends nothing but the model cross-check');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
