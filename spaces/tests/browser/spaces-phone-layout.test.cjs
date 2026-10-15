/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Phone proof for the Spaces page (tools/spaces.html): at 412 x 915 and in the 392 x 641 cockpit frame the capture forms are laid out at their natural height in one scrolling page (no inner scroll box; on a phone they were a 181 px box over the viewer), the 3D viewer below them is at least 300 px tall, and nothing is wider than the screen.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Phone proof that feedback stays on screen: with a connected engine, tapping the drone scan (scrolled to, in the one-column page) shows its refusal toast inside the visible screen. The toast was absolute at the bottom of <main>, which on a phone sits below the forms, so every success and failure message was drawn under the screen.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Phone proof that nothing covers the toast or the forms: the "Prepare a diagnostic brief" panel was fixed at the bottom of the screen (z-index 1000) on a phone, so it was drawn over the toast (z-index 5) and the bottom of the forms; live at 412 x 915 a tap at the toast's centre hit the panel's summary. The panel is now in the page flow after the viewer, and the toast is the topmost thing at its centre (measured with the toast taking hits for the probe); the "Choose a video first" toast is checked too.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { VIEWPORTS, playwright, openPage, overflow } = require('./phone-fixture.cjs');

const PAGE = path.resolve(__dirname, '../../tools/spaces.html');
const READS = { '/api/spaces/scans': { scans: [], configured: false, native: true, reason: 'no_reconstruction_engine',
  detail: 'This installation has no fixture engine connected (fixture reason).' } };

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

for (const viewport of VIEWPORTS) {
  test(`the Spaces forms and viewer stack as one page on a ${viewport.width} px screen`, async () => {
    const { page, context, writes } = await openPage(browser, viewport, { url: '/api/spaces/app', files: { '/api/spaces/app': PAGE }, reads: READS });
    try {
      await page.waitForFunction(() => !document.getElementById('phase-note').hidden);
      const layout = await page.evaluate(() => {
        const pane = document.querySelector('aside .scroll'), main = document.querySelector('main').getBoundingClientRect();
        const aside = document.querySelector('aside').getBoundingClientRect();
        return { paneClient: pane.clientHeight, paneScroll: pane.scrollHeight, mainHeight: main.height, mainTop: main.top, asideBottom: aside.bottom,
          pageScrolls: document.documentElement.scrollHeight > innerHeight };
      });
      assert.ok(layout.paneScroll <= layout.paneClient + 1, `the forms are a ${layout.paneClient}px box scrolling ${layout.paneScroll}px of content`);
      assert.ok(layout.mainHeight >= 300, `the 3D viewer is ${layout.mainHeight}px tall`);
      assert.ok(layout.mainTop >= layout.asideBottom - 1, 'the viewer follows the forms instead of sharing the screen with them');
      assert.ok(layout.pageScrolls, 'the page scrolls as one column');
      await page.locator('#drone-scan-btn').scrollIntoViewIfNeeded();
      const reach = await page.evaluate(() => { const b = document.getElementById('drone-scan-btn').getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return hit && hit.id; });
      assert.equal(reach, 'drone-scan-btn', 'the last capture control is reachable by scrolling the page');
      const fit = await overflow(page);
      assert.ok(fit.scrollWidth <= fit.clientWidth, `the page is ${fit.scrollWidth}px wide in a ${fit.clientWidth}px screen`);
      assert.deepEqual(writes, [], 'opening the page wrote nothing');
    } finally {
      await context.close();
    }
  });
}

/**
 * @description What is drawn on top at the toast's centre. The toast never takes taps (pointer-events: none), which hides
 * it from elementFromPoint; for the probe it takes hits, so a panel stacked over it is what the probe returns.
 * @param {object} page Playwright page or frame.
 * @returns {Promise<string>} The id of the topmost element with an id at the toast's centre.
 */
function topmostAtToast(page) {
  return page.evaluate(() => {
    const toast = document.getElementById('toast'), box = toast.getBoundingClientRect();
    toast.style.pointerEvents = 'auto';
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    toast.style.pointerEvents = '';
    return hit ? (hit.closest('[id]') || hit).id || hit.tagName : 'nothing';
  });
}

for (const viewport of VIEWPORTS) {
  test(`the "Choose a video first" toast is on top inside the visible ${viewport.width} x ${viewport.height} screen`, async () => {
    const { page, context, writes } = await openPage(browser, viewport, { url: '/api/spaces/app', files: { '/api/spaces/app': PAGE }, reads: READS });
    try {
      await page.waitForFunction(() => !document.getElementById('phase-note').hidden);
      await page.evaluate(() => document.getElementById('upload-form').requestSubmit());
      await page.waitForFunction(() => document.getElementById('toast').classList.contains('show'));
      const shown = await page.evaluate(() => { const b = document.getElementById('toast').getBoundingClientRect(); return { top: b.top, bottom: b.bottom, height: innerHeight, text: document.getElementById('toast').textContent }; });
      assert.equal(shown.text, 'Choose a video first');
      assert.ok(shown.top >= 0 && shown.bottom <= shown.height, `the toast is drawn at ${Math.round(shown.top)}-${Math.round(shown.bottom)}px of a ${shown.height}px screen`);
      assert.equal(await topmostAtToast(page), 'toast', 'nothing is drawn over the toast');
      assert.deepEqual(writes, [], 'a refused upload wrote nothing');
    } finally {
      await context.close();
    }
  });
}

const READY = { '/api/spaces/scans': { scans: [], configured: true, native: true } };

for (const viewport of VIEWPORTS) {
  test(`a refused drone scan says so inside the visible ${viewport.width} x ${viewport.height} screen`, async () => {
    const { page, context, writes } = await openPage(browser, viewport, { url: '/api/spaces/app', files: { '/api/spaces/app': PAGE }, reads: READY });
    try {
      await page.waitForFunction(() => !document.getElementById('drone-scan-btn').disabled && !document.getElementById('phase-note').hidden);
      await page.locator('#drone-scan-btn').scrollIntoViewIfNeeded();
      await page.locator('#drone-scan-btn').click();
      await page.waitForFunction(() => document.getElementById('toast').classList.contains('show'));
      const shown = await page.evaluate(() => {
        const box = document.getElementById('toast').getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, height: innerHeight, text: document.getElementById('toast').textContent };
      });
      assert.match(shown.text, /^Drone scan failed: /, `the toast says ${shown.text}`);
      assert.ok(shown.top >= 0 && shown.bottom <= shown.height,
        `the toast is drawn at ${Math.round(shown.top)}-${Math.round(shown.bottom)}px of a ${shown.height}px screen`);
      assert.equal(await topmostAtToast(page), 'toast', 'nothing is drawn over the toast');
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.getElementById('evidenceReview')).position), 'fixed',
        'the hand-off panel floats over the page at phone width');
      assert.deepEqual(writes, ['POST /api/spaces/drone-scan'], 'the only write is the refused drone scan');
    } finally {
      await context.close();
    }
  });
}
