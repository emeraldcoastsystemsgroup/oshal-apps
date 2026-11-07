/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | UX audit 2026-11-06 (dnd-table, dnd-review, dnd-party, dnd-help, dnd-tv), in headless Chromium over the shipped table.html, dnd.css and scripts with synthetic read-only answers. The HUD is one row of five and its More menu holds Timeline, Help, DM Settings and Full screen and closes on Escape; End Turn and Move are hidden with no campaign; a My Games row shows one action (Resume) with Recap and Delete Campaign in its ⋯ menu; the drawer has one close control. How to play has four headed sections in upright type, a ✕ and a Got it in view at 1440 x 900 and 412 x 915. My Characters cards have one action, Use in new game, Delete only in their ⋯ menu, and initials for a hero without art; the import form's Save character is on screen at 1440 x 900. TV Mode's lobby card names the game once and shows the join code at 48px or more, and its corner bar carries Full screen and Sound.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { playwright, openPage } = require('./phone-fixture.cjs');

const UI = path.resolve(__dirname, '../../ui');
const FILES = { '/api/dnd/table': path.join(UI, 'table.html') };
for (const name of fs.readdirSync(UI)) if (/\.(js|css)$/.test(name)) FILES[`/api/dnd/${name}`] = path.join(UI, name);
const DESK = { width: 1440, height: 900 }, PHONE = { width: 412, height: 915 };
const CAMPAIGNS = { campaigns: [{ campaign_id: 'c1', name: 'Ambush on the Coast Road', is_owner: true, mode: 'combat', round: 2, scene_title: 'The Coast Road', player_count: 1 }] };
const CHARACTERS = { characters: [{ character_id: 'k1', sheet: { id: 'imported-aria', name: 'Aria Nightwind', race: 'Wood Elf', class: 'Ranger', maxHp: 10, ac: 14, actions: [{ name: 'Longsword' }] } }] };
const READS = { '/api/dnd/campaigns': CAMPAIGNS, '/api/dnd/characters': CHARACTERS };

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

async function table(viewport, url) {
  const opened = await openPage(browser, viewport, { url: url || '/api/dnd/table', files: FILES, reads: READS });
  await opened.page.waitForFunction(() => typeof showGameMenu === 'function' && typeof setMoreMenu === 'function');
  return opened;
}
const inView = (b, vp) => b && b.y >= -0.5 && b.y + b.height <= vp.height + 0.5 && b.x >= -0.5 && b.x + b.width <= vp.width + 0.5;

for (const viewport of [DESK, PHONE]) {
  test(`the HUD is one row of five with a More menu, and no campaign hides End Turn (${viewport.width} px)`, async () => {
    const { page, context, writes } = await table(viewport);
    try {
      await page.evaluate(() => closeOverlay());
      const hud = await page.evaluate(() => [...document.querySelectorAll('#stage > .fab')].filter((b) => getComputedStyle(b).display !== 'none')
        .map((b) => ({ id: b.id, top: Math.round(b.getBoundingClientRect().top) })));
      assert.deepEqual(hud.map((b) => b.id).sort(), ['diceBtn', 'gamesBtn', 'moreBtn', 'partyBtn', 'storyBtn']);
      assert.equal(new Set(hud.map((b) => b.top)).size, 1, `one row: ${JSON.stringify(hud)}`);
      await page.click('#moreBtn');
      const items = await page.locator('#moreMenu [role="menuitem"]').allInnerTexts();
      assert.deepEqual(items.map((t) => t.replace(/^\W+/, '').trim()), ['Timeline', 'Help', 'DM Settings', 'Full screen']);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#moreMenu').isVisible(), false, 'Escape closes More');
      assert.equal(await page.locator('#endTurn').isVisible(), false, 'no campaign: End Turn is not shown');
      assert.equal(await page.locator('#story h3 #closeStory').count(), 1);
      assert.deepEqual(writes, []);
    } finally { await context.close(); }
  });

  test(`How to play: four headed sections, upright, ✕ and Got it in view (${viewport.width} px)`, async () => {
    const { page, context } = await table(viewport);
    try {
      await page.evaluate(() => showHelp());
      const heads = await page.locator('#overlayCard .help-body h2').allInnerTexts();
      assert.deepEqual(heads, ['Your turn', 'Combat', 'Companions', 'Playing with friends']);
      assert.equal(await page.locator('#overlayCard .help-body').evaluate((el) => getComputedStyle(el.querySelector('li')).fontStyle), 'normal');
      assert.match(await page.locator('#overlayCard').innerText(), /DM & Story[\s\S]*TV Mode/);
      assert.doesNotMatch(await page.locator('#overlayCard').innerText(), /📜 Story|mode=tv/);
      assert.ok(inView(await page.locator('#ovClose').boundingBox(), viewport), 'Got it is on screen');
      await page.click('#ovX');
      assert.equal(await page.locator('#overlay').isVisible(), true, 'with no campaign it returns to My Games');
      assert.match(await page.locator('#overlayCard h1').innerText(), /My Games/);
    } finally { await context.close(); }
  });
}

test('My Games: one action per row, Recap and Delete Campaign in its ⋯ menu', async () => {
  const { page, context } = await table(DESK);
  try {
    await page.evaluate(() => showGameMenu());
    await page.locator('.campaign-row').waitFor();
    const visible = await page.locator('.campaign-row .campaign-actions button:visible').allInnerTexts();
    assert.deepEqual(visible, ['Resume']);
    await page.click('.campaign-row .row-more > summary');
    assert.deepEqual(await page.locator('.campaign-row .row-more-menu button:visible').allInnerTexts(), ['⟲ Recap', 'Delete Campaign']);
    await page.click('[data-delete-campaign]');
    assert.match(await page.locator('#overlayCard h1').innerText(), /Delete Ambush on the Coast Road\?/, 'Delete still confirms in the page');
  } finally { await context.close(); }
});

test('My Characters: Use in new game is the card action, Delete waits in ⋯, initials stand in for missing art', async () => {
  const { page, context } = await table(DESK);
  try {
    // The bundled art manifest lists the shipped heroes only; an imported hero is not in it.
    await page.evaluate(async () => { content = { art: { tokens: ['aria'], maps: [] } }; await fetchSavedCharacters(); showCharacterLibrary(); });
    await page.locator('.herocard').waitFor();
    assert.deepEqual(await page.locator('.herocard .campaign-actions button:visible').allInnerTexts(), ['Use in new game']);
    assert.equal(await page.locator('.herocard .portrait.initials').innerText(), 'AN');
    await page.click('#libraryImport');
    const save = page.locator('#importManual');
    assert.equal(await save.innerText(), 'Save character');
    assert.ok(inView(await save.boundingBox(), DESK), 'Save character is on screen at 1440 x 900');
  } finally { await context.close(); }
});

test('TV Mode: the lobby code is big and not repeated, and the corner bar has Full screen and Sound', async () => {
  const { page, context } = await table(DESK, '/api/dnd/table?mode=tv');
  try {
    await page.waitForFunction(() => typeof showTvLobby === 'function' && typeof wireTvBar === 'function');
    await page.evaluate(() => {
      document.body.classList.add('tv'); wireTvBar();
      campaign = { campaign_id: 'c1', name: 'Ambush on the Coast Road', join_code: '7E99DA' };
      board = { mode: 'setup', tokens: [], order: [] }; window.SC = () => ({ title: 'The Coast Road' });
      updateInitiativeBar(); showTvLobby();
    });
    const size = await page.locator('.tv-code strong').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(size >= 48, `the code is ${size}px`);
    assert.equal(await page.locator('#overlayCard').evaluate((el) => (el.innerText.match(/Ambush on the Coast Road/g) || []).length), 1, 'the card names the game once');
    await page.mouse.move(200, 200);
    assert.deepEqual(await page.locator('#tvBar button').allInnerTexts(), ['Full screen', 'Sound on']);
    assert.equal(await page.locator('#tvBar').evaluate((el) => getComputedStyle(el).opacity), '1');
    await page.click('#tvSound');
    assert.equal(await page.locator('#tvSound').innerText(), 'Sound off', 'the press turns the narration on');
    await page.click('#tvSound');
    assert.equal(await page.evaluate(() => _voiceMutedByPlayer), true, 'and the next press mutes it');
  } finally { await context.close(); }
});
