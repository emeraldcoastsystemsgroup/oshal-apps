/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Browser contract test for Level 3-5 progression and The Ashen Citadel 5-chapter campaign arc (v0.22.8) at 1440x900 and 412x915: adventure shelf card, Level 3 and Level 5 character sheets with XP progress, proficiency bonus, and 1st/2nd/3rd-level spell slots, zero page errors, zero horizontal overflow.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { playwright, openPage } = require('./phone-fixture.cjs');
const { loadAdventureCatalog } = require('../../lib/dnd-adventure-catalog.js');

const ROOT = path.resolve(__dirname, '../..');
const UI = path.join(ROOT, 'ui');
const DATA = path.join(ROOT, 'data');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const FILES = { '/api/dnd/table': path.join(UI, 'table.html') };
for (const name of fs.readdirSync(UI)) {
  if (/\.(js|css)$/.test(name)) FILES[`/api/dnd/${name}`] = path.join(UI, name);
}
for (const mapFile of fs.readdirSync(path.join(DATA, 'maps'))) {
  if (mapFile.endsWith('.jpg')) {
    FILES[`/api/dnd/art/map/${mapFile.slice(0, -4)}`] = path.join(DATA, 'maps', mapFile);
  }
}

const catalog = loadAdventureCatalog(DATA, readJson);
const CONTENT = {
  heroes: readJson(path.join(DATA, 'party.json')).party.concat(readJson(path.join(DATA, 'srd-roster.json')).roster),
  defaultParty: ['bram', 'della', 'fenwick', 'pip'],
  monsters: readJson(path.join(DATA, 'srd-monsters.json')).monsters,
  adventure: catalog.adventure,
  adventures: catalog.adventures,
  leveling: readJson(path.join(DATA, 'srd-leveling.json')),
  art: { tokens: [], maps: fs.readdirSync(path.join(DATA, 'maps')).filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4)).sort() },
};

const READS = {
  '/api/dnd/content': CONTENT,
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
  test(`Adventure shelf shows The Ashen Citadel and Level 5 sheet renders cleanly at ${vp.width}x${vp.height}`, async () => {
    const { page, context, writes } = await openPage(browser, vp, { url: '/api/dnd/table', files: FILES, reads: READS });
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    try {
      await page.waitForFunction(() => Boolean(window.DnDEngine && typeof showAdventureLibrary === 'function' && content && content.leveling));

      await page.evaluate(() => showAdventureLibrary());
      const arcCard = page.locator('[data-adventure="ashen-citadel"]');
      await arcCard.waitFor();
      const cardText = await arcCard.innerText();
      assert.match(cardText, /The Ashen Citadel/);
      assert.match(cardText, /Level 1-5 Campaign Arc/i);
      assert.match(cardText, /1 investigation · 4 battles/);

      const shelfOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(shelfOverflow <= 1, `shelf horizontal overflow at ${vp.width}: ${shelfOverflow}`);

      await page.evaluate(() => {
        closeOverlay();
        campaign = { campaign_id: 'c-arc', name: 'Ashen Citadel Proof', is_owner: true, join_code: 'ARC123' };
        players = [{ me: true, slug: 'fenwick', name: 'Player' }];
        const baseFen = JSON.parse(JSON.stringify(content.heroes.find((h) => h.id === 'fenwick')));
        const l5Fen = window.DnDEngine.applyLevelUp(baseFen, content.leveling, { xp: 6600 }).sheet;
        const baseDella = JSON.parse(JSON.stringify(content.heroes.find((h) => h.id === 'della')));
        const l3Della = window.DnDEngine.applyLevelUp(baseDella, content.leveling, { xp: 1200 }).sheet;
        boardSheets = { fenwick: l5Fen, della: l3Della };
        board = {
          mode: 'combat', sceneId: 'citadel-sanctum', adventureId: 'ashen-citadel', round: 1, turnIndex: 0, turnSerial: 1,
          order: ['fenwick', 'della'],
          tokens: [
            { id: 'fenwick', kind: 'pc', slug: 'fenwick', name: l5Fen.name, x: 2, y: 5, hp: l5Fen.maxHp, maxHp: l5Fen.maxHp, ac: l5Fen.ac, speed: l5Fen.speed, slots: { ...l5Fen.slots }, turnSerial: 1, moveRemaining: 30, acted: false },
            { id: 'della', kind: 'pc', slug: 'della', name: l3Della.name, x: 2, y: 6, hp: l3Della.maxHp, maxHp: l3Della.maxHp, ac: l3Della.ac, speed: l3Della.speed, slots: { ...l3Della.slots } },
          ],
        };
        activateAdventure('ashen-citadel');
        indexTerrain(); layout(); updateInitiativeBar(); renderDock();
      });

      assert.match(await page.locator('#who').innerText(), /Lv 5/);
      assert.match(await page.locator('#who').innerText(), /L1:4 L2:3 L3:2/);

      await page.evaluate(() => showCharacterSheet(board.tokens[0]));
      await page.locator('.sheet-head').waitFor();
      const l5Head = await page.locator('.sheet-head').innerText();
      assert.match(l5Head, /Level 5 \(Max\)/);
      assert.match(l5Head, /6,600 XP/);
      assert.match(await page.locator('.sheet-vitals').innerText(), /\+3\s*Prof/);
      const l5Slots = await page.locator('.slot-grid').innerText();
      assert.match(l5Slots, /Level 1[\s\S]*4 \/ 4/);
      assert.match(l5Slots, /Level 2[\s\S]*3 \/ 3/);
      assert.match(l5Slots, /Level 3[\s\S]*2 \/ 2/);
      const l5Actions = await page.locator('.character-action-grid.ready-now').innerText();
      assert.match(l5Actions, /Fireball/);
      assert.match(l5Actions, /Shatter/);
      assert.match(l5Actions, /Counterspell/);

      const sheetOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(sheetOverflow <= 1, `sheet horizontal overflow at ${vp.width}: ${sheetOverflow}`);

      await page.evaluate(() => showCharacterSheet(board.tokens[1]));
      const l3Head = await page.locator('.sheet-head').innerText();
      assert.match(l3Head, /Level 3 · 1,200 \/ 2,700 XP/);
      const l3Slots = await page.locator('.slot-grid').innerText();
      assert.match(l3Slots, /Level 1[\s\S]*4 \/ 4/);
      assert.match(l3Slots, /Level 2[\s\S]*2 \/ 2/);

      assert.deepEqual(writes, [], 'level3-arc browser contract must remain read-only');
      assert.deepEqual(pageErrors, [], 'zero page errors allowed');
    } finally {
      await context.close();
    }
  });
}
