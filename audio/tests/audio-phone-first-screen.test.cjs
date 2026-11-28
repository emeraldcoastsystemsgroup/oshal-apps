/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.2.2 (lane mobilesweep1, the phone first-screen sweep of 2026-11-16: Audio Studio's first track started 617 px down a 915 px phone, 67%, under the app bar, the section tabs, a transport on three rows, six formula macros on four rows and the status line). The real studio page with its own scripts (the default five-stem arrangement the page builds itself) in a stand-in for Today (tests/browser/today-phone-fixture.cjs), every write refused: at 412x915, 390x844 and 360x780 with touch the first track starts within the top 30% of the screen, the transport (Play, Pause, Stop, Record Take, the time) is one row whose buttons keep their names, the formula macros are one row, the kicker is not drawn, nothing scrolls the page sideways and nothing to tap sits under the floating Jarvis button at the end; at 1440x900 the desktop keeps its kicker, its one transport bar with the LUFS meter and its macros. Red on 1.2.1.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Serve the genuine extracted session controller in the read-only phone fixture.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { SIZES, playwright, openInToday, screenTop, sideways, underOrbAtEnd } = require('./browser/today-phone-fixture.cjs');

const PKG = path.join(__dirname, '..');
const FILES = {
  '/api/audio/ui': path.join(PKG, 'tools', 'audio.html'),
  '/api/audio/audio.css': path.join(PKG, 'tools', 'audio.css'),
  '/api/audio/audio.js': path.join(PKG, 'tools', 'audio.js'),
  '/api/audio/ui/audio-session.js': path.join(PKG, 'tools', 'audio-session.js'),
  '/api/audio/audio-ui-helpers.js': path.join(PKG, 'tools', 'audio-ui-helpers.js'),
  '/api/audio/dsp_engine.js': path.join(PKG, 'lib', 'dsp_engine.js'),
  '/api/audio/dsp_synth.js': path.join(PKG, 'lib', 'dsp_synth.js'),
};
const READS = { '/api/audio/editor/projects': { projects: [] } };

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

/** The studio in the stand-in Today, waiting for the five tracks the page builds itself. */
function openStudio(size) {
  return openInToday(browser, size, { url: '/api/audio/ui', files: FILES, reads: READS,
    ready: (frame) => frame.waitForFunction(() => document.querySelectorAll('#track-list .track-card').length >= 5, null, { timeout: 20000 }) });
}

const drawn = (frame, selector) => frame.evaluate((sel) => { const el = document.querySelector(sel); return Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'); }, selector);

/** How many lines the given elements take (their tops within 8 px are one line). */
function lines(frame, selector) {
  return frame.evaluate((sel) => {
    const tops = [];
    for (const el of document.querySelectorAll(sel)) {
      if (!el.getClientRects().length) continue;
      const t = el.getBoundingClientRect().top;
      if (!tops.some((x) => Math.abs(x - t) < 8)) tops.push(t);
    }
    return tops.length;
  }, selector);
}

/** How many lines the transport's buttons and its time take. */
function transportLines(frame) {
  return frame.evaluate(() => {
    const tops = [];
    for (const id of ['btn-play', 'btn-pause', 'btn-stop', 'btn-transport-record', 'timecode']) {
      const t = document.getElementById(id).getBoundingClientRect().top;
      if (!tops.some((x) => Math.abs(x - t) < 8)) tops.push(t);
    }
    return tops.length;
  });
}

for (const size of SIZES) {
  test(`${size.width}x${size.height}: Audio Studio opens on its tracks`, { timeout: 90000 }, async (t) => {
    const phone = size.width <= 640;
    const { page, frame, context, writes, errors } = await openStudio(size);
    try {
      const first = await screenTop(page, frame, '#track-list .track-card');
      const macros = await lines(frame, '.macro-strip button'), transport = await transportLines(frame);
      t.diagnostic(`first track ${first}px (${Math.round((first / size.height) * 100)}%), transport lines ${transport}, macro rows ${macros}`);
      const fit = await sideways(frame);
      assert.ok(fit.scrollWidth <= fit.clientWidth, `nothing scrolls the page sideways (${fit.scrollWidth} > ${fit.clientWidth})`);
      if (phone) {
        assert.ok(first <= size.height * 0.3, `the first track starts within the top 30%: ${first}px of ${size.height}`);
        assert.equal(transport, 1, 'Play, Pause, Stop, Record Take and the time are one row');
        assert.equal(macros, 1, 'the six formula macros are one row');
        for (const name of ['Play', 'Pause', 'Stop', 'Record Take']) assert.equal(await frame.getByRole('button', { name, exact: true }).isVisible(), true, `${name} keeps its name`);
        assert.equal(await drawn(frame, '.wb-brand .kicker'), false, 'Today\'s bar says Audio Studio; the kicker is not drawn again');
        assert.deepEqual(await underOrbAtEnd(page, frame), [], 'nothing to tap under the floating Jarvis button at the end');
      } else {
        assert.equal(await drawn(frame, '.wb-brand .kicker'), true, 'the desktop keeps its kicker');
        assert.equal(transport, 1, 'and its one transport bar');
        assert.equal(await drawn(frame, '#master-lufs-value'), true, 'with the LUFS meter');
        assert.equal(await drawn(frame, '#btn-preset-broadcast'), true, 'and its macros');
      }
      assert.deepEqual(writes, [], 'opening the studio writes nothing');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
