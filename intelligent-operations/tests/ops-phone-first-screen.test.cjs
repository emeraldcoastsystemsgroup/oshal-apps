/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.9.3 (lane mobilesweep2, the phone first-screen sweep of 2026-11-16: in Today on a phone the Systems list started under the Updated row, List / Graph, the heading and two paragraphs, 252 px down a 915 px phone, and Cloud clusters ended under the floating Jarvis button). The real Operations experience (experience/index.html and every script and stylesheet it loads) inside a stand-in for Today (tests/browser/today-phone-fixture.cjs), opened on Systems for a person whose account no installation has reported to, synthetic answers and every write refused. At 412x915, 390x844 and 360x780 with touch: the empty line of Monitored installations starts within the top 30% of the screen, the general lead is not drawn (the empty line says what to do), nothing scrolls sideways and nothing to tap is under the floating Jarvis button at the end of the page. At 1440x900 the lead shows as before. Red on 1.9.2.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SIZES, playwright, openInToday, screenTop, sideways, underOrbAtEnd } = require('./browser/today-phone-fixture.cjs');

const PKG = path.join(__dirname, '..');
const FILES = { '/api/intelligent-operations/app': path.join(PKG, 'experience', 'index.html') };
for (const name of fs.readdirSync(path.join(PKG, 'experience'))) if (/\.(js|css)$/.test(name)) FILES['/api/intelligent-operations/assets/' + name] = path.join(PKG, 'experience', name);
for (const name of ['operations.css', 'replay-scenarios.js', 'response-artifacts.js', 'anomaly-detector.js']) FILES['/api/intelligent-operations/assets/' + name] = path.join(PKG, 'ui', name);
const READS = { '/api/intelligent-operations/telemetry': { installations: [], watch: null, enrollments: [] },
  '/api/auth/user': { authenticated: true, subject: 'fixture-person', displayName: 'Fixture Person' } };

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

const drawn = (frame, selector) => frame.evaluate((sel) => { const el = document.querySelector(sel); return Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'); }, selector);

for (const size of SIZES) {
  test(`${size.width}x${size.height}: Systems shows its installations line near the top and nothing under the Jarvis button at the end`, { timeout: 90000 }, async (t) => {
    const phone = size.width <= 640;
    const { page, frame, context, writes, errors } = await openInToday(browser, size, { url: '/api/intelligent-operations/app#systems', files: FILES, reads: READS,
      ready: (f) => f.waitForFunction(() => /No installation has reported/.test(document.querySelector('#installations .installations-empty')?.textContent || ''), null, { timeout: 20000 }) });
    try {
      const empty = await screenTop(page, frame, '#installations .installations-empty');
      t.diagnostic(`installations line ${empty}px (${Math.round((empty / size.height) * 100)}%)`);
      const fit = await sideways(frame);
      assert.ok(fit.scrollWidth <= fit.clientWidth, `nothing scrolls the page sideways (${fit.offenders.join(', ')})`);
      if (phone) {
        assert.ok(empty !== null && empty <= size.height * 0.3, `the installations line starts within the top 30%: ${empty}px of ${size.height}`);
        assert.equal(await drawn(frame, '#installations .installations-title .operator-note'), false, 'the general lead steps aside while nothing has reported');
        assert.deepEqual(await underOrbAtEnd(page, frame), [], 'nothing to tap is under the floating Jarvis button at the end');
      } else {
        assert.equal(await drawn(frame, '#installations .installations-title .operator-note'), true, 'the desktop keeps the lead');
      }
      assert.deepEqual(writes, [], 'opening Systems writes nothing');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
