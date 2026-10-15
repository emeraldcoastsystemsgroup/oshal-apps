/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Demo sweep 1, in Chromium at 412 x 915 over the shipped tools/home.html: an assistant reply with **bold** shows bold text and no asterisks, markup in a reply stays text, and the You line and the reply sit off the screen edge (they were flush at x=0).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { playwright, openPage } = require('./phone-fixture.cjs');

const PAGE = path.resolve(__dirname, '../../tools/home.html');
const READS = { '/api/home/devices': { devices: [], hubs: [] }, '/api/home/scenes': { scenes: [] }, '/api/home/schedules': { schedules: [] } };

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

test('an assistant reply shows bold words without asterisks and sits off the screen edge', async () => {
  const { page, context } = await openPage(browser, { width: 412, height: 915 }, { url: '/api/home/ui', files: { '/api/home/ui': PAGE }, reads: READS });
  try {
    const shown = await page.evaluate(() => {
      showTurn('how do I add a hub?', 'Go to the **Hubs tab** in the Smart Home app. <img src=x onerror=alert(1)>');
      const reply = document.getElementById('reply'), you = reply.querySelector('.you'), answer = reply.querySelector('.answer');
      reply.classList.remove('dash-only'); reply.style.display = 'block';
      const range = document.createRange(); range.selectNodeContents(you);
      return { text: answer.textContent, strong: [...answer.querySelectorAll('strong')].map((b) => b.textContent),
        images: answer.querySelectorAll('img').length, youLeft: range.getBoundingClientRect().left };
    });
    assert.equal(shown.text, 'Go to the Hubs tab in the Smart Home app. <img src=x onerror=alert(1)>');
    assert.deepEqual(shown.strong, ['Hubs tab']);
    assert.equal(shown.images, 0, 'markup in a reply stays text');
    assert.ok(shown.youLeft >= 12, `the You line starts ${shown.youLeft}px from the screen edge`);
  } finally {
    await context.close();
  }
});
