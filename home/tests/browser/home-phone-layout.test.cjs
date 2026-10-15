/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Phone proof for the Smart Home page (tools/home.html): with a synthetic device list long enough to scroll, at every scroll position on a 412 x 915 phone and in the 392 px cockpit frame the Ask input and Send are what a tap at their centre hits. The diagnostic-brief panel (position:relative, after the fixed Ask bar in the document) used to paint over the bar when it scrolled beneath it, so taps on Send landed on the panel.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { VIEWPORTS, playwright, openPage, overflow } = require('./phone-fixture.cjs');

const PAGE = path.resolve(__dirname, '../../tools/home.html');
const DEVICES = Array.from({ length: 10 }, (_, index) => ({ key: `fixture-${index}`, name: `Fixture lamp ${index + 1}`,
  switch: index % 2 ? 'on' : 'off', capabilities: ['switch', 'switchLevel'] }));
const READS = { '/api/home/devices': { devices: DEVICES, hubs: ['Fixture hub'] }, '/api/home/scenes': { scenes: [] }, '/api/home/schedules': { schedules: [] } };

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

for (const viewport of VIEWPORTS) {
  test(`the Ask bar takes its own taps at every scroll position on a ${viewport.width} px screen`, async () => {
    const { page, context, writes } = await openPage(browser, viewport, { url: '/api/home/ui', files: { '/api/home/ui': PAGE }, reads: READS });
    try {
      await page.waitForFunction(() => document.querySelectorAll('#grid .card').length === 10);
      const covered = await page.evaluate(async () => {
        const hits = (el) => { const b = el.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return hit === el || el.contains(hit); };
        const max = document.documentElement.scrollHeight - innerHeight, misses = [];
        for (let y = 0; y <= max + 40; y += 40) {
          window.scrollTo(0, Math.min(y, max));
          await new Promise(requestAnimationFrame);
          for (const id of ['msg', 'send']) if (!hits(document.getElementById(id))) {
            const el = document.getElementById(id), b = el.getBoundingClientRect(), on = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            misses.push(`${id} at scroll ${Math.min(y, max)} is under ${on && (on.id || on.tagName)}`);
          }
        }
        return { max, misses: misses.slice(0, 6) };
      });
      assert.ok(covered.max > 0, 'the synthetic page is long enough to scroll content under the Ask bar');
      assert.deepEqual(covered.misses, [], 'nothing paints over the Ask input or Send');
      const fit = await overflow(page);
      assert.ok(fit.scrollWidth <= fit.clientWidth, `the page is ${fit.scrollWidth}px wide in a ${fit.clientWidth}px screen`);
      assert.deepEqual(writes, [], 'opening and scrolling the page wrote nothing');
    } finally {
      await context.close();
    }
  });
}
