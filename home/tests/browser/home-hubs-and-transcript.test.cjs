/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Two phone regressions on the Smart Home page (tools/home.html) at 412 x 915 and in the 392 px cockpit frame. (a) The chat transcript showed only the bot's reply after Send, never what the person asked; it now shows "You: <message>" above the answer. (b) The Hubs tab opened the generic Connections page with every connector declaration; the manifest now opens this page's hubs view (?view=hubs), which shows the SmartThings connect link, the Google Home set-up link and the hubs that reported devices, and hides the dashboard.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | UX audit 2026-11-05 (home-dashboard): the inline Ask bar is removed (the shell's concierge button is the one assistant entry), so the transcript case goes; the dashboard case now proves there is no Ask bar and no empty state when devices exist.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { VIEWPORTS, playwright, openPage, overflow } = require('./phone-fixture.cjs');

const PAGE = path.resolve(__dirname, '../../tools/home.html');
const MANIFEST = path.resolve(__dirname, '../../oshal-app.yaml');
const DEVICES = Array.from({ length: 3 }, (_, index) => ({ key: `fixture-${index}`, name: `Fixture lamp ${index + 1}`,
  switch: 'off', capabilities: ['switch'] }));
const READS = { '/api/home/devices': { devices: DEVICES, hubs: ['Fixture hub'] }, '/api/home/scenes': { scenes: [] }, '/api/home/schedules': { schedules: [] } };

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

for (const viewport of VIEWPORTS) {
  test(`the Hubs view shows the hub connections, not the dashboard, on a ${viewport.width} px screen`, async () => {
    const { page, context, writes } = await openPage(browser, viewport, { url: '/api/home/ui?view=hubs', files: { '/api/home/ui': PAGE }, reads: READS });
    try {
      await page.waitForFunction(() => /Reporting devices/.test(document.getElementById('hubsReporting').textContent));
      assert.equal(await page.textContent('#hubsReporting'), 'Reporting devices: Fixture hub (3 devices).');
      assert.ok(await page.isVisible('#hubsPanel'));
      const smartthings = page.locator('#hubsPanel a', { hasText: 'Connect SmartThings' });
      assert.equal(await smartthings.getAttribute('href'), '/api/connect/smartthings/start');
      assert.equal(await smartthings.getAttribute('target'), '_top');
      assert.equal(await page.locator('#hubsPanel a', { hasText: 'Set up in Connections' }).getAttribute('href'), '/utilities');
      for (const id of ['grid', 'msg', 'schedules']) assert.equal(await page.isVisible('#' + id), false, `#${id} is hidden in the hubs view`);
      const fit = await overflow(page);
      assert.ok(fit.scrollWidth <= fit.clientWidth, `the page is ${fit.scrollWidth}px wide in a ${fit.clientWidth}px screen`);
      assert.deepEqual(writes, [], 'opening the hubs view wrote nothing');
    } finally {
      await context.close();
    }
  });
}

test('the dashboard keeps the hubs panel hidden', async () => {
  const { page, context } = await openPage(browser, VIEWPORTS[0], { url: '/api/home/ui', files: { '/api/home/ui': PAGE }, reads: READS });
  try {
    await page.waitForFunction(() => document.querySelectorAll('#grid .card').length === 3);
    assert.equal(await page.isVisible('#hubsPanel'), false);
    assert.equal(await page.isVisible('#emptyState'), false, 'devices exist, so no empty state');
    assert.equal(await page.locator('#msg, #send').count(), 0, 'no inline Ask bar: the shell concierge is the one assistant entry');
  } finally {
    await context.close();
  }
});

test('the manifest Hubs tab opens the hubs view', () => {
  const manifest = fs.readFileSync(MANIFEST, 'utf8');
  const block = manifest.slice(manifest.indexOf('toolName: home-accounts'), manifest.indexOf('section: bottom', manifest.indexOf('toolName: home-accounts')));
  assert.match(block, /label: Hubs/);
  assert.match(block, /iframeUrl: \/api\/home\/ui\?view=hubs\b/);
});
