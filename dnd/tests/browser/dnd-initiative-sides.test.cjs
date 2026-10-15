/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Sweep 9: the initiative bar read "Vesh / AMBUSH ARCHER / 7/7 ... Della / AI COMPANION / 12/12"
 *     |                                             | with nothing telling sides apart, and the concierge called the enemy archer an AI-controlled hero.
 *     |                                             | The real table (ui/table.html and its scripts) in Chromium at 412 x 915 draws the bar with
 *     |                                             | updateInitiativeBar(), and the kernel's REAL screen snapshot (crates/api/src/shell_screen_state.js
 *     |                                             | captureScreenState, the text the concierge receives) reads "(enemy)" on the monster and "(party)" on
 *     |                                             | the AI companion and the person's hero; the mark is visually hidden (1px, clipped), so the chips look
 *     |                                             | as before. Seams: the synthetic read-only page fixture (phone-fixture.cjs). Needs the kernel checkout
 *     |                                             | (OSHAL_KERNEL_ROOT).
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Sweep 10: the play view scrolled sideways at 412 px (document 689 px wide): each chip's
 *     |                                             | visually hidden side mark is position:absolute, and with no positioned chip it was placed
 *     |                                             | against the page, outside the bar's own sideways scroll, so the page grew to the strip's
 *     |                                             | full width. With eight combatants the page is exactly the screen wide at 412 and 392 px.
 *     |                                             | And while "Tallow is defeated!" showed as Pip's result, the bar still read "Enemies: 4/4"
 *     |                                             | and Tallow 7/7: the Result stage (table-automation.js showOutcomeResultStage) repainted
 *     |                                             | the dock only. Showing a result now repaints the bar from the board it reports.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { VIEWPORTS, playwright, openPage } = require('./phone-fixture.cjs');

const UI = path.resolve(__dirname, '../../ui');
const FILES = { '/api/dnd/table': path.join(UI, 'table.html') };
for (const name of fs.readdirSync(UI)) if (/\.(js|css)$/.test(name)) FILES[`/api/dnd/${name}`] = path.join(UI, name);
const KERNEL = process.env.OSHAL_KERNEL_ROOT || path.join(os.homedir(), 'Documents', 'projects', 'oshal-kernel');
const SNAPSHOT = path.join(KERNEL, 'crates', 'api', 'src', 'shell_screen_state.js');

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

test('the concierge\'s snapshot of the initiative bar says which side each combatant is on', async () => {
  assert.ok(fs.existsSync(SNAPSHOT), `the kernel checkout must be present (set OSHAL_KERNEL_ROOT); missing ${SNAPSHOT}`);
  const { page, context, writes } = await openPage(browser, { width: 412, height: 915 }, { url: '/api/dnd/table', files: FILES, reads: {} });
  try {
    await page.waitForFunction(() => typeof updateInitiativeBar === 'function');
    await page.addScriptTag({ content: fs.readFileSync(SNAPSHOT, 'utf8') });
    const r = await page.evaluate(() => {
      document.getElementById('overlay').classList.add('hidden');
      window.SC = () => ({ title: 'Ambush on the Coast Road', grid: { w: 18, h: 12 }, monsters: [{ instanceId: 'm1', role: 'Ambush archer' }] });
      board = { mode: 'combat', round: 1, order: ['m1', 'p1'],
        tokens: [{ id: 'm1', kind: 'monster', ref: 'goblin', name: 'Vesh Far-Eye', hp: 7, maxHp: 7 },
          { id: 'p1', kind: 'pc', slug: 'della', name: 'Della', hp: 12, maxHp: 12 }] };
      updateInitiativeBar();
      const chip = document.querySelector('#initiative .init-chip .side');
      const box = chip.getBoundingClientRect();
      return { text: window.captureScreenState({ contentDocument: document }).text, width: box.width, height: box.height };
    });
    assert.match(r.text, /^.*Vesh \(enemy\) Ambush archer 7\/7$/m, r.text);
    assert.match(r.text, /^.*Della \(party\) AI Companion 12\/12$/m, r.text);
    assert.ok(r.width <= 1 && r.height <= 1, 'the side mark is visually hidden');
    assert.deepEqual(writes, []);
  } finally {
    await context.close();
  }
});

/** Eight combatants as the Coast Road ambush seats them: four heroes and four goblins. */
function ambushBoard() {
  const monsters = [['m1', 'Rikkit Quickfang', 'Road skirmisher', 7], ['m2', 'Vesh Far-Eye', 'Ambush archer', 7],
    ['m3', 'Tallow Grin', 'Cart cutter', 7], ['m4', 'Snaggletooth', 'Goblin boss', 21]];
  const heroes = [['p1', 'pip', 'Pip Underbough', 10], ['p2', 'fenwick', 'Fenwick Quill', 7], ['p3', 'bram', 'Bram Ironhand', 12],
    ['p4', 'della', 'Della Stonehearth', 12]];
  return {
    scene: { title: 'Ambush on the Coast Road', grid: { w: 18, h: 12 }, monsters: monsters.map(([id, , role]) => ({ instanceId: id, role })) },
    board: { mode: 'combat', round: 1, order: ['p1', 'p2', 'm1', 'm2', 'm3', 'm4', 'p3', 'p4'],
      tokens: [...monsters.map(([id, name, , hp]) => ({ id, kind: 'monster', ref: 'goblin', name, hp, maxHp: hp })),
        ...heroes.map(([id, slug, name, hp]) => ({ id, kind: 'pc', slug, name, hp, maxHp: hp }))] },
  };
}

for (const viewport of VIEWPORTS) {
  test(`a full initiative bar scrolls inside itself; the page never scrolls sideways at ${viewport.width} px`, async () => {
    const { page, context, writes } = await openPage(browser, viewport, { url: '/api/dnd/table', files: FILES, reads: {} });
    try {
      await page.waitForFunction(() => typeof updateInitiativeBar === 'function');
      const r = await page.evaluate((fixture) => {
        document.getElementById('overlay').classList.add('hidden');
        window.SC = () => fixture.scene;
        board = fixture.board;
        updateInitiativeBar();
        const bar = document.getElementById('initiative');
        return { chips: bar.querySelectorAll('.init-chip').length, barScroll: bar.scrollWidth, barWidth: bar.clientWidth,
          page: document.documentElement.scrollWidth, screen: document.documentElement.clientWidth };
      }, ambushBoard());
      assert.equal(r.chips, 8);
      assert.ok(r.barScroll > r.barWidth, `the strip holds more than the screen (${r.barScroll} in ${r.barWidth}) and scrolls itself`);
      assert.ok(r.page <= r.screen, `the page is ${r.page}px wide on a ${r.screen}px screen`);
      assert.deepEqual(writes, []);
    } finally {
      await context.close();
    }
  });
}

test('showing an AI turn\'s result repaints the initiative bar from the board it reports', async () => {
  const { page, context, writes } = await openPage(browser, { width: 412, height: 915 }, { url: '/api/dnd/table', files: FILES, reads: {} });
  try {
    await page.waitForFunction(() => typeof showOutcomeResultStage === 'function' && typeof updateInitiativeBar === 'function');
    const r = await page.evaluate((fixture) => {
      document.getElementById('overlay').classList.add('hidden');
      window.SC = () => fixture.scene;
      board = fixture.board;
      updateInitiativeBar();
      const before = document.getElementById('initiative').innerText;
      // The engine has already applied Pip's 7 piercing (engine.js applyDamage): Tallow is down when the result is shown.
      const tallow = board.tokens.find((t) => t.id === 'm3');
      tallow.hp = 0; tallow.dead = true;
      const pip = board.tokens.find((t) => t.id === 'p1');
      let shown = null;
      try { showOutcomeResultStage(pip, { text: 'Pip Underbough\'s Shortbow: 14+5=19 vs AC 15 — hit for 7 piercing — Tallow Grin is defeated!' }); }
      catch (err) { shown = String(err && err.message || err); }
      return { before, after: document.getElementById('initiative').innerText, shown };
    }, ambushBoard());
    assert.match(r.before, /Enemies: 4\/4/);
    assert.match(r.after, /Enemies: 3\/4/, r.after);
    assert.match(r.after, /Tallow\s*\(enemy\)\s*Cart cutter\s*Defeated/i, r.after);
    assert.deepEqual(writes, []);
  } finally {
    await context.close();
  }
});
