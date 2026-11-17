/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.4.1 (lane mobilesweep2, the phone first-screen sweep of 2026-11-16: with no drone the "No drone connected" card started 306 px down a 915 px phone, 33%, in the middle of an empty map under a two-row header). The real page (tools/drone-ops.html) inside a stand-in for Today (tests/browser/today-phone-fixture.cjs) over the native kernel's no-drone fleet answer and empty lists, every write refused. At 412x915, 390x844 and 360x780 with touch: the no-drone card starts within the top 30% of the screen, the header is one row (no provider pill or battery repeating that there is no drone), Brief stays on it, nothing scrolls sideways and the flight bar keeps Land, Return home and Abort ALL. At 1440x900 the header keeps its provider pill and battery and the card stays in the middle of the map. Red on 1.4.0.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { SIZES, playwright, openInToday, screenTop, sideways } = require('./browser/today-phone-fixture.cjs');

const PAGE = path.join(__dirname, '..', 'tools', 'drone-ops.html');
const NO_DRONE = { configured: false, reason: 'no_drone_node', detail: 'No drone or flight simulator is registered with this native runtime.', fleet: [] };
const READS = { '/api/drone/fleet': NO_DRONE, '/api/drone/missions': { missions: [] }, '/api/drone/fleet/patterns': { patterns: [] },
  '/api/drone/show/status': { active: false }, '/api/drone/conversation': { messages: [] } };

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

/** @description How many lines the header's shown items take: items whose heights overlap share a line (a 44 px button beside a 20 px pill is one line). */
const headerLines = (frame) => frame.evaluate(() => {
  const lines = [];
  for (const el of document.querySelector('.topbar').children) {
    if (!el.getClientRects().length) continue;
    const b = el.getBoundingClientRect(), line = lines.find((l) => b.top < l.bottom - 2 && b.bottom > l.top + 2);
    if (line) { line.top = Math.min(line.top, b.top); line.bottom = Math.max(line.bottom, b.bottom); } else lines.push({ top: b.top, bottom: b.bottom });
  }
  return lines.length;
});
const drawn = (frame, selector) => frame.evaluate((sel) => { const el = document.querySelector(sel); return Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'); }, selector);

for (const size of SIZES) {
  test(`${size.width}x${size.height}, no drone: the empty state starts near the top under a one-row header`, { timeout: 60000 }, async (t) => {
    const phone = size.width <= 640;
    const { page, frame, context, writes, errors } = await openInToday(browser, size, { url: '/api/drone/app', files: { '/api/drone/app': PAGE }, reads: READS,
      scripts: { '/cockpit/js/app-workflows.js': 'export async function mountConnectedActions() {}' },
      ready: (f) => f.waitForSelector('#canvasEmpty:not([hidden])', { timeout: 15000 }) });
    try {
      const card = await screenTop(page, frame, '#canvasEmpty');
      t.diagnostic(`no-drone card ${card}px (${Math.round((card / size.height) * 100)}%)`);
      const fit = await sideways(frame);
      assert.ok(fit.scrollWidth <= fit.clientWidth, `nothing scrolls the page sideways (${fit.offenders.join(', ')})`);
      assert.equal(await drawn(frame, '#briefBtn'), true, 'Brief stays in the header');
      for (const name of ['Land', 'Return home', 'Abort ALL']) assert.equal(await frame.locator('#flightBar').getByRole('button', { name, exact: true }).isVisible(), true, `${name} stays in the flight bar`);
      if (phone) {
        assert.ok(card !== null && card <= size.height * 0.3, `the no-drone card starts within the top 30%: ${card}px of ${size.height}`);
        assert.equal(await headerLines(frame), 1, 'the header is one row');
        assert.equal(await drawn(frame, '#providerPill'), false, 'no provider pill repeating that there is no drone');
        assert.equal(await drawn(frame, '.batt'), false, 'no battery reading –%');
      } else {
        assert.equal(await drawn(frame, '#providerPill'), true, 'the desktop keeps the provider pill');
        assert.equal(await drawn(frame, '.batt'), true, 'and the battery');
        const map = await frame.locator('.map-wrap').boundingBox(), box = await frame.locator('#canvasEmpty').boundingBox();
        assert.ok(Math.abs((box.y + box.height / 2) - (map.y + map.height / 2)) < 4, 'the card stays in the middle of the map on the desktop');
      }
      assert.deepEqual(writes, [], 'opening Drone Ops writes nothing');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
