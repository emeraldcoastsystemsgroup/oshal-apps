/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 0.4.1 (lane mobilesweep2, the phone first-screen sweep of 2026-11-16: on a phone in Today the league walkthrough's Continue sat under the floating Jarvis button, on the first screen and at the end of the page; Intelligent Sports opens the same page). The real page (tools/fantasy-football.html with its concierge files) inside a stand-in for Today (tests/browser/today-phone-fixture.cjs) for a new person with no league (no ESPN connection here, no hand-typed league: the walkthrough opens by itself), synthetic answers and every write refused. At 412x915, 390x844 and 360x780 with touch: Continue is not under the button on the first screen nor at the end of the page, nothing else to tap is under it at the end, the walkthrough starts within the top 30% and nothing scrolls sideways. At 1440x900 Continue keeps its place at the right end of its bar. Red on 0.4.0.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { SIZES, playwright, openInToday, screenTop, sideways, underOrbAtEnd } = require('./browser/today-phone-fixture.cjs');

const TOOLS = path.join(__dirname, '..', 'tools');
const FILES = { '/api/fantasy-football/': path.join(TOOLS, 'fantasy-football.html'), '/api/fantasy-football/concierge.css': path.join(TOOLS, 'concierge.css'),
  '/api/fantasy-football/concierge.js': path.join(TOOLS, 'concierge.js') };
const READS = { '/api/fantasy-football/status': { connected: false, leagues: [], season: 2026, credentialSupported: false }, '/api/fantasy-football/manual-leagues': { leagues: [] } };

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

/** @description Where a control and the floating button overlap, in screen px (0 when they do not). */
async function overlap(page, frame, selector) {
  const orb = await page.locator('#jarvisOrbFab').boundingBox(), box = await page.locator('.tool-view-container > iframe').boundingBox();
  const b = await frame.locator(selector).boundingBox();
  if (!b) return 0;
  const x = Math.max(0, Math.min(b.x + box.x + b.width, orb.x + orb.width) - Math.max(b.x + box.x, orb.x));
  const y = Math.max(0, Math.min(b.y + box.y + b.height, orb.y + orb.height) - Math.max(b.y + box.y, orb.y));
  return Math.round(x * y);
}

for (const size of SIZES) {
  test(`${size.width}x${size.height}: the walkthrough's Continue is never under the floating Jarvis button`, { timeout: 60000 }, async (t) => {
    const phone = size.width <= 640;
    const { page, frame, context, writes, errors } = await openInToday(browser, size, { url: '/api/fantasy-football/', files: FILES, reads: READS,
      ready: (f) => f.waitForSelector('#mNext', { state: 'visible', timeout: 15000 }) });
    try {
      const form = await screenTop(page, frame, '#manualBody');
      t.diagnostic(`walkthrough ${form}px (${Math.round((form / size.height) * 100)}%)`);
      const fit = await sideways(frame);
      assert.ok(fit.scrollWidth <= fit.clientWidth, `nothing scrolls the page sideways (${fit.offenders.join(', ')})`);
      if (phone) {
        assert.ok(form !== null && form <= size.height * 0.3, `the walkthrough starts within the top 30%: ${form}px of ${size.height}`);
        assert.equal(await overlap(page, frame, '#mNext'), 0, 'Continue is not under the button on the first screen');
        assert.deepEqual(await underOrbAtEnd(page, frame), [], 'nothing to tap is under the button at the end of the page');
        assert.equal(await overlap(page, frame, '#mNext'), 0, 'Continue is not under the button at the end of the page');
      } else {
        const next = await frame.locator('#mNext').boundingBox(), bar = await frame.locator('.mbar').boundingBox();
        assert.ok(bar.x + bar.width - (next.x + next.width) <= 2, `Continue keeps the right end of its bar on the desktop (${Math.round(bar.x + bar.width - next.x - next.width)}px in)`);
      }
      assert.deepEqual(writes, [], 'opening the walkthrough writes nothing');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
