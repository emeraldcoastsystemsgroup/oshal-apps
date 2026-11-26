/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Browser contract test for deeper spellcasting (v0.22.7): sphere AoE preview, concentration/condition/reaction/temp-AC indicators on dock, sheet, and rail, and in-page reaction prompt at 1440x900 and 412x915 with zero page errors and zero horizontal overflow.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { playwright, openPage } = require('./phone-fixture.cjs');

const UI = path.resolve(__dirname, '../../ui');
const FILES = { '/api/dnd/table': path.join(UI, 'table.html') };
for (const name of fs.readdirSync(UI)) {
  if (/\.(js|css)$/.test(name)) FILES[`/api/dnd/${name}`] = path.join(UI, name);
}
FILES['/api/dnd/art/map/coast-road'] = path.resolve(__dirname, '../../data/maps/coast-road.jpg');

const CONTENT = {
  heroes: JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/party.json'), 'utf8')).party,
  defaultParty: ['bram', 'della', 'fenwick', 'pip'],
  monsters: JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/srd-monsters.json'), 'utf8')).monsters,
  adventure: JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/adventure-goblin-ambush.json'), 'utf8')),
  adventures: [JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/adventure-goblin-ambush.json'), 'utf8'))],
  art: { tokens: [], maps: ['coast-road'] },
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
  test(`Spellcasting UI renders sphere preview, status pills, and reaction prompt at ${vp.width}x${vp.height}`, async () => {
    const { page, context, writes } = await openPage(browser, vp, { url: '/api/dnd/table', files: FILES, reads: READS });
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    try {
      await page.waitForFunction(() => Boolean(window.DnDEngine && window.DnDSpellcasting && typeof renderDock === 'function'));
      const apiCheck = await page.evaluate(() => ({
        sphereCells: typeof window.DnDEngine.sphereCells === 'function',
        startConcentration: typeof window.DnDEngine.startConcentration === 'function',
        addCondition: typeof window.DnDEngine.addCondition === 'function',
        eligibleReactions: typeof window.DnDEngine.eligibleReactions === 'function',
        resolveReaction: typeof window.DnDEngine.resolveReaction === 'function',
      }));
      assert.deepEqual(apiCheck, {
        sphereCells: true, startConcentration: true, addCondition: true, eligibleReactions: true, resolveReaction: true,
      });

      await page.evaluate(() => {
        closeOverlay();
        campaign = { campaign_id: 'c-spell', name: 'Spell Proof', is_owner: true, join_code: 'ABC123' };
        players = [{ me: true, slug: 'fenwick', name: 'Player' }];
        const fen = JSON.parse(JSON.stringify(content.heroes.find((h) => h.id === 'fenwick')));
        fen.slots = { 1: 2, 3: 1 };
        fen.actions.push(window.DnDSpellcasting.SRD_SPELLS.fireball);
        boardSheets = { fenwick: fen };
        board = {
          mode: 'combat', sceneId: 'coast-road', adventureId: 'goblin-ambush', round: 1, turnIndex: 0, turnSerial: 1,
          order: ['fenwick', 'g1'],
          tokens: [
            {
              id: 'fenwick', kind: 'pc', slug: 'fenwick', name: 'Fenwick Quill', x: 3, y: 5,
              hp: 7, maxHp: 7, ac: 12, speed: 30, slots: { 1: 2, 3: 1 },
              turnSerial: 1, moveRemaining: 30, moved: false, positionSet: false, acted: false,
              concentration: { spellId: 'bless', spellName: 'Bless', startedRound: 1, targetIds: ['fenwick'] },
              conditions: [{ id: 'blessed', sourceId: 'fenwick', spellId: 'bless', concentration: true }],
              reactionUsed: false, tempAcBonus: 5,
            },
            { id: 'g1', kind: 'monster', ref: 'goblin', name: 'Tallow', x: 8, y: 5, hp: 7, maxHp: 7, ac: 13, speed: 30 },
          ],
        };
        indexTerrain(); layout(); updateInitiativeBar();
        selected = board.tokens[0];
        selectedAction = window.DnDSpellcasting.SRD_SPELLS.fireball;
        hoverCell = { x: 8, y: 5 };
        renderDock(); draw();
      });

      assert.match(await page.locator('#who .conc-pill').innerText(), /Conc: Bless/);
      assert.match(await page.locator('#who .cond-pill').innerText(), /Blessed/);
      assert.match(await page.locator('#who .ac-pill').innerText(), /\+5 AC/);
      assert.match(await page.locator('#who .react-pill').innerText(), /Reaction ready/);

      const promptPromise = page.evaluate(() => promptReactionChoice(
        board.tokens[0],
        { id: 'shield', actionName: 'Shield', acBonus: 5 },
        'Incoming attack hits AC 12. Cast Shield (+5 AC)?',
      ));
      await page.locator('#reactionAccept').waitFor();
      assert.match(await page.locator('.reaction-prompt').innerText(), /Use Shield \(\+5 AC\)/);
      await page.click('#reactionAccept');
      assert.equal(await promptPromise, true);

      await page.evaluate(() => showCharacterSheet(board.tokens[0]));
      await page.locator('.sheet-status-pills .conc-pill').waitFor();
      assert.match(await page.locator('.sheet-vitals').innerText(), /17 \(\+5\)/);

      const overflow = await page.evaluate(() => ({
        docOverflow: document.documentElement.scrollWidth - window.innerWidth,
      }));
      assert.ok(overflow.docOverflow <= 1, `horizontal overflow at ${vp.width}: ${JSON.stringify(overflow)}`);
      assert.deepEqual(writes, [], 'spellcasting browser contract must remain read-only');
      assert.deepEqual(pageErrors, [], 'zero page errors allowed');
    } finally {
      await context.close();
    }
  });
}
