/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser contract test for v0.22.9 combat cutaway beats, visible per-campaign Art X/20 budget badge, cap-reached indicator, and non-blocking local transition banner at 1440x900 and 412x915 with zero page errors and zero horizontal overflow.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { playwright, openPage } = require('./phone-fixture.cjs');

const ROOT = path.resolve(__dirname, '../..');
const UI = path.join(ROOT, 'ui');
const FILES = { '/api/dnd/table': path.join(UI, 'table.html') };
for (const name of fs.readdirSync(UI)) {
  if (/\.(js|css)$/.test(name)) FILES[`/api/dnd/${name}`] = path.join(UI, name);
}

const READS = {
  '/api/dnd/campaigns': { campaigns: [] },
  '/api/dnd/characters': { characters: [] },
};

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 412, height: 915 },
];

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

for (const vp of VIEWPORTS) {
  test(`visible Art X/20 budget indicator and non-blocking local beat banner work cleanly at ${vp.width}x${vp.height}`, async () => {
    const { page, context, writes } = await openPage(browser, vp, { url: '/api/dnd/table', files: FILES, reads: READS });
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    try {
      await page.waitForFunction(() => Boolean(
        window.DnDCutawayBeats && typeof setCutawayBudget === 'function'
        && typeof showLocalBeatTransition === 'function' && typeof dispatchClassifiedCutawayBeat === 'function'
      ));

      await page.evaluate(() => {
        closeOverlay();
        campaign = { campaign_id: 'c-cutaways', name: 'Cutaway Proof', is_owner: true, join_code: 'ART123' };
        board = {
          mode: 'combat', sceneId: 'coast-road', round: 2, turnIndex: 0, turnSerial: 4,
          order: ['bram', 'gob-1'],
          tokens: [
            { id: 'bram', kind: 'pc', slug: 'bram', name: 'Bram', x: 3, y: 5, hp: 12, maxHp: 12, ac: 16, speed: 30 },
            { id: 'gob-1', kind: 'monster', ref: 'goblin', name: 'Rikkit', x: 4, y: 5, hp: 5, maxHp: 7, ac: 15, speed: 30 },
          ],
        };
        window.SC = () => ({ id: 'coast-road', title: 'Ambush on the Coast Road', grid: { w: 18, h: 12, unitFeet: 5 }, monsters: [] });
        setCutawayBudget({ used: 3, cap: 20, remaining: 17 });
        updateInitiativeBar();
      });

      const badge = page.locator('#cutawayBudgetBadge');
      await badge.waitFor({ state: 'visible' });
      assert.equal(await badge.innerText(), 'Art 3/20');
      assert.equal(await badge.getAttribute('aria-label'), 'Campaign cutaway art budget: 3 of 20 used');

      await page.click('#moreBtn');
      assert.match(await page.locator('#moreCutawayBudget').innerText(), /Cutaway art: 3\/20/);
      await page.keyboard.press('Escape');

      // Common beat plays local transition banner with ZERO /cutaway writes.
      await page.evaluate(async () => {
        const beat = window.DnDCutawayBeats.classifyCombatBeat({
          actorName: 'Bram', targetName: 'Rikkit', actionName: 'Longsword', damage: 6, outcome: 'hit', natural: 14,
        });
        await dispatchClassifiedCutawayBeat(beat);
      });
      const localBanner = page.locator('#localBeatBanner');
      await localBanner.waitFor({ state: 'visible' });
      assert.equal(await localBanner.getAttribute('data-beat-kind'), 'local:hit');
      assert.equal(await localBanner.evaluate((el) => getComputedStyle(el).pointerEvents), 'none');
      assert.match(await localBanner.innerText(), /Strike Lands/i);

      // At cap (20/20), badge shows cap reached and big beats fall back locally without POST /cutaway.
      await page.evaluate(async () => {
        setCutawayBudget({ used: 20, cap: 20, remaining: 0 });
        updateInitiativeBar();
        const crit = window.DnDCutawayBeats.classifyCombatBeat({
          sceneId: 'coast-road', round: 2, actorId: 'bram', actorName: 'Bram', targetId: 'gob-1', targetName: 'Rikkit',
          actionName: 'Longsword', natural: 20, damage: 14,
        });
        await dispatchClassifiedCutawayBeat(crit);
      });
      assert.equal(await badge.innerText(), 'Art 20/20 (cap reached)');
      assert.equal(await badge.getAttribute('aria-label'), 'Campaign cutaway art budget: 20 of 20 used (cap reached)');
      assert.equal(await localBanner.getAttribute('data-beat-kind'), 'nat20');
      assert.match(await localBanner.innerText(), /Natural 20!/i);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `horizontal overflow at ${vp.width}: ${overflow}`);
      assert.deepEqual(writes, [], 'common beats and capped big beats must never POST /cutaway');
      assert.deepEqual(pageErrors, [], 'zero page errors allowed');
    } finally {
      await context.close();
    }
  });
}
