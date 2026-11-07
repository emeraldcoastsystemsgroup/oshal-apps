/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | UX audit 2026-11-06 (dnd-table, FIX-BROKEN). Under the default light-blue theme the Dungeon Master drawer's Current Quest and Table Talk were the theme's navy ink on the dark drawer (about 1.2:1) and My Games was a see-through grey card with blue text. The table is a dark game set, so its palette is pinned in dnd.css. This guard loads the shipped table.html, dnd.css and scripts in Chromium under each of the twenty themes surface-theme.js supports (their tokens as served on 2026-11-06, theme-tokens.json), fills the drawer, the status strip, the HUD and its More menu, the dock, the banner and the My Games screen, and measures every text against the background it is painted on (each layer composited, a gradient at its worst stop): 4.5:1, or 3:1 for large text. A My Games card must be opaque.
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
const { themes: THEMES } = JSON.parse(fs.readFileSync(path.join(__dirname, 'theme-tokens.json'), 'utf8'));

const CAMPAIGNS = { campaigns: [
  { campaign_id: 'c1', name: 'Ambush on the Coast Road', is_owner: true, mode: 'combat', round: 2, scene_title: 'The Coast Road', player_count: 1 },
  { campaign_id: 'c2', name: 'Friday table', is_owner: false, my_character: 'Aria', mode: 'exploration', scene_title: 'Old Mill' },
] };

/** Text the table draws on its dark set, measured with the drawer open, the More menu open and a banner showing. */
const TABLE_TEXT = ['#initiative .round', '#initiative .round small', '#banner', '#gamesBtn', '#partyBtn', '#diceBtn', '#storyBtn', '#moreBtn',
  '#savesBtn', '#helpBtn', '#voiceBtn', '#fullscreenBtn', '#story h3', '#voiceStatus', '#recapBtn', '#closeStory', '.quest-thread .quest-label',
  '#questTitle', '#questAnchor', '#questReplay', '.rail-section-title', '.beat.table-talk', '.beat.table-talk .k', '.beat.table-talk .say',
  '.beat.milestone', '#dmPrompts button', '#sendTalk', '#who .name', '#who .sub', '#endTurn', '#moveBtn'];
/** Text on the My Games screen over the board, with the host row's ⋯ menu open. */
const SCREEN_TEXT = ['.card h1', '.card > p', '.campaign-row h2', '.campaign-row p', '.campaign-role', '.campaign-actions button[data-resume]',
  '.row-more > summary', '.campaign-actions button.leave', '#menuNew', '#menuJoin'];

/**
 * @description In the page: the contrast of each selector's first visible match against what is painted under it. Each
 *   ancestor's background colour is composited from the page root down; a gradient counts each of its stops and the
 *   worst one is kept; the element's own opacity and its ink's alpha fade the ink into that background.
 * @param {string[]} selectors CSS selectors.
 * @returns {Array<{selector:string, ratio:number, need:number, ink:string}>} One row per selector (ratio -1 when missing).
 */
function measure(selectors) {
  const parse = (css) => { const m = /rgba?\(([^)]+)\)/.exec(css); if (!m) return null; const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
  const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  const lum = (c) => { const f = (x) => { const v = x / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const stops = (image) => (image.match(/rgba?\([^)]+\)/g) || []).map(parse);
  function grounds(el) {
    const chain = []; for (let n = el; n; n = n.parentElement) chain.unshift(n);
    let out = [[255, 255, 255, 1]];
    for (const n of chain) {
      const cs = getComputedStyle(n), color = parse(cs.backgroundColor), image = cs.backgroundImage;
      if (color && color[3] > 0) out = out.map((g) => over(color, g));
      const layer = image && image !== 'none' && !/url\(/.test(image) ? stops(image) : [];
      if (layer.length) out = out.flatMap((g) => layer.map((s) => over(s, g)));
    }
    return out;
  }
  const visible = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  return selectors.map((selector) => {
    const el = [...document.querySelectorAll(selector)].find(visible);
    if (!el) return { selector, ratio: -1, need: 4.5, ink: 'missing' };
    const cs = getComputedStyle(el);
    let alpha = 1; for (let n = el; n; n = n.parentElement) alpha *= Number(getComputedStyle(n).opacity);
    const ink = parse(cs.color); ink[3] *= alpha;
    const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    const ratio = Math.min(...grounds(el).map((g) => { const a = lum(over(ink, g)), b = lum(g); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }));
    return { selector, ratio: Math.round(ratio * 100) / 100, need, ink: cs.color };
  });
}

/** @description Put the table in play: a quest, two story beats, the drawer open, a hero's turn, a banner, More open. */
function fillTable() {
  $('overlay').classList.add('hidden');
  $('initiative').innerHTML = '<span class="round">Party lobby · Ambush on the Coast Road<small>Party: 4 ALIVE · join code 7E99DA</small></span>';
  $('questThread').classList.remove('hidden');
  $('questTitle').textContent = 'Recover the merchant, shake off the goblins and follow the trail';
  $('questAnchor').textContent = 'Alden Reed, the cloth merchant, is missing - not trapped beneath the overturned cart.';
  $('log').innerHTML = '<div class="beat milestone"><span class="k">milestone</span>A new campaign begins: Ambush on the Coast Road.</div>'
    + '<div class="beat table-talk"><span class="k">table talk</span><span class="say">“What do I see around me?”</span><br>The air smells of pine resin and smoke.</div>';
  setStoryOpen(true);
  $('who').innerHTML = '<div class="who-top"><div><div class="name">Fixture hero</div></div></div><div class="sub">Human Fighter</div>';
  $('turnctl').classList.remove('idle');
  $('endTurn').disabled = false; $('moveBtn').disabled = true;
  banner('Claim a hero to roll - AI Companions roll visibly on the host screen.');
  setMoreMenu(true);
}

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

for (const [theme, tokens] of Object.entries(THEMES)) {
  for (const viewport of theme === 'light-blue' ? [{ width: 1440, height: 900 }, { width: 412, height: 915 }] : [{ width: 1440, height: 900 }]) {
    test(`the table and My Games read on the dark set under ${theme} (${viewport.width} px)`, async () => {
      const reads = { '/api/dnd/campaigns': CAMPAIGNS, '/api/dnd/characters': { characters: [] } };
      const { page, context, writes } = await openPage(browser, viewport, { url: '/api/dnd/table', files: FILES, reads });
      try {
        await page.waitForFunction(() => typeof setStoryOpen === 'function' && typeof setMoreMenu === 'function' && typeof showGameMenu === 'function');
        await page.evaluate((t) => { for (const [k, v] of Object.entries(t)) document.documentElement.style.setProperty(k, v); }, tokens);
        await page.evaluate(fillTable);
        await page.waitForTimeout(400); // the drawer fades in over 0.2 s
        const table = await page.evaluate(measure, TABLE_TEXT);
        await page.evaluate(async () => { setMoreMenu(false); setStoryOpen(false); await showGameMenu(); document.querySelector('.row-more').open = true; });
        await page.waitForSelector('.campaign-actions button.leave', { state: 'visible' });
        const screen = await page.evaluate(measure, SCREEN_TEXT);
        const card = await page.evaluate(() => getComputedStyle(document.getElementById('overlayCard')).backgroundColor);
        for (const row of table.concat(screen)) {
          assert.ok(row.ratio >= row.need, `${theme}: ${row.selector} reads at ${row.ratio}:1 (needs ${row.need}:1, ink ${row.ink})`);
        }
        assert.match(card, /^rgb\(/, `${theme}: the My Games card is opaque (${card}), so the board cannot show through it`);
        assert.deepEqual(writes, [], 'measuring the table wrote nothing');
      } finally {
        await context.close();
      }
    });
  }
}
