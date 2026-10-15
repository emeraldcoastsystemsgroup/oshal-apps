/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | K4 phone proof for the Dungeon Master's voiceover caption: the real table (ui/table.html, ui/dnd.css, its own layout() and caption()) in the battle layout at 412 x 915 and in the 392 x 641 cockpit frame, showing the 260-character line the sweep saw cut off. The caption spans the table (it was 206 px, the right half of a 412 px screen, because it was centred with left:50%), stays inside the stage, covers at most the bottom quarter of the board (it covered 106 of 264 px), and shows every word without clipping (it was cut off mid-word by its height cap).
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | K4: the TV lobby names the campaign it joined and its join code (it named only the scene, so a TV on 'write check' read 'Ambush on the Coast Road', a game My Games does not list), and on a TV the initiative bar names the campaign before the scene; the name is escaped.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | During an AI turn (the turn panel above the board, the sticky dock holding the view-only note and four disabled cards) the caption is drawn above the dock and takes taps at its top, middle and bottom, at 412 x 915, 412 x 859 and the 392 x 641 cockpit frame, at the top of the page and scrolled 120 px. In the 392 x 641 frame the whole caption was behind the dock (all three points hit the dock), at 412 x 859 its last line.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | Sweep 14: the caption printed '**What do you do?**' with its asterisks; the real table's caption() now shows the narration's words without Markdown marks.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { VIEWPORTS, playwright, openPage } = require('./phone-fixture.cjs');

const UI = path.resolve(__dirname, '../../ui');
const FILES = { '/api/dnd/table': path.join(UI, 'table.html') };
for (const name of fs.readdirSync(UI)) if (/\.(js|css)$/.test(name)) FILES[`/api/dnd/${name}`] = path.join(UI, name);

/** The narration line from the sweep (s6-2 log-dnd-f), longer than captionExcerpt's 260-character cut. */
const LINE = 'Rikkit draws the bowstring taut, his arrow screaming toward the goblin boss in a wild, competitive arc—but it whistles '
  + 'harmlessly past Snaggletooth’s leathery ears, sinking point-first into the dirt with a hollow thunk beside the spilled bolts '
  + 'of dyed cloth. The goblins jeer from the cart.';

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

for (const viewport of VIEWPORTS) {
  test(`the voiceover caption spans the table and leaves the map readable on a ${viewport.width} px screen`, async () => {
    const { page, context, writes } = await openPage(browser, viewport, { url: '/api/dnd/table', files: FILES, reads: {} });
    try {
      await page.waitForFunction(() => typeof layout === 'function' && typeof caption === 'function' && typeof setStoryOpen === 'function');
      const r = await page.evaluate((line) => {
        document.getElementById('overlay').classList.add('hidden');
        window.SC = () => ({ grid: { w: 18, h: 12 } });
        setStoryOpen(false);
        layout();
        caption(line, { hold: true });
        const el = document.getElementById('caption');
        el.style.transition = 'none';
        const box = (node) => { const b = node.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
        return { cap: box(el), board: box(document.getElementById('board')), stage: box(document.getElementById('stage')),
          scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, overflowY: getComputedStyle(el).overflowY, shown: el.classList.contains('show') };
      }, LINE);
      assert.ok(r.shown, 'the caption is showing');
      assert.ok(r.cap.width >= r.stage.width - 24, `the caption is ${Math.round(r.cap.width)}px wide in a ${Math.round(r.stage.width)}px table`);
      assert.ok(r.cap.left >= r.stage.left - 0.5 && r.cap.right <= r.stage.right + 0.5 && r.cap.bottom <= r.stage.bottom + 0.5, 'the caption stays inside the table');
      const covered = Math.max(0, Math.min(r.cap.bottom, r.board.bottom) - Math.max(r.cap.top, r.board.top));
      assert.ok(covered <= r.board.height / 4, `the caption covers ${Math.round(covered)}px of the ${Math.round(r.board.height)}px board`);
      assert.ok(r.scrollHeight <= r.clientHeight + 1 || r.overflowY === 'auto', `every word can be read (${r.scrollHeight}px of text in ${r.clientHeight}px, overflow ${r.overflowY})`);
      assert.deepEqual(writes, [], 'showing a caption wrote nothing');
    } finally {
      await context.close();
    }
  });
}

test('the voiceover caption shows the narration as words, never its Markdown marks (sweep 14)', async () => {
  const { page, context } = await openPage(browser, VIEWPORTS[0], { url: '/api/dnd/table', files: FILES, reads: {} });
  try {
    await page.waitForFunction(() => typeof layout === 'function' && typeof caption === 'function');
    const shown = await page.evaluate(() => {
      document.getElementById('overlay').classList.add('hidden');
      window.SC = () => ({ grid: { w: 18, h: 12 } });
      layout();
      caption('The goblins scatter into the *eastern* woods. **What do you do?**', { hold: true });
      const el = document.getElementById('caption');
      return { text: el.textContent, label: el.getAttribute('aria-label') };
    });
    assert.equal(shown.text, 'The goblins scatter into the eastern woods. What do you do?');
    assert.doesNotMatch(shown.label, /\*/);
  } finally {
    await context.close();
  }
});

test('the TV lobby names the campaign the screen joined, as My Games lists it, with its join code', async () => {
  const { page, context, writes } = await openPage(browser, { width: 412, height: 915 }, { url: '/api/dnd/table?mode=tv', files: FILES, reads: {} });
  try {
    await page.waitForFunction(() => typeof showTvLobby === 'function' && typeof updateInitiativeBar === 'function');
    const text = await page.evaluate(() => {
      campaign = { campaign_id: 'c1', name: 'write check <b>', join_code: '7E99DA', is_owner: true };
      board = { mode: 'setup', round: 0, tokens: [], order: [] };
      window.SC = () => ({ title: 'Ambush on the Coast Road', grid: { w: 18, h: 12 } });
      showTvLobby();
      updateInitiativeBar();
      return { overlay: document.getElementById('overlay').innerText, bar: document.getElementById('initiative').innerText, html: document.getElementById('overlay').innerHTML };
    });
    assert.match(text.overlay, /write check <b>/, 'the lobby names the campaign (escaped, as text)');
    assert.match(text.overlay, /7E99DA/);
    assert.doesNotMatch(text.html, /<b>write check <b><\/b>/, 'the name is escaped');
    assert.match(text.bar, /write check <b>.*Ambush on the Coast Road/s, 'the TV bar names the campaign before the scene');
    assert.deepEqual(writes, []);
  } finally {
    await context.close();
  }
});


/** The AI turn as table-turns.js / table-dock.js render it: the turn panel, and a view-only dock with four disabled cards. */
const AI_FLAG = '<div class="turn-copy"><span class="turn-kicker">AI turn</span><strong>Snaggletooth\'s turn</strong><span class="turn-cue">The AI controls this turn.</span></div>'
  + '<div class="turn-steps"><span class="turn-step"><b>Movement</b>30 FT</span><span class="turn-step"><b>Action</b>1</span></div>';
const AI_WHO = '<div class="who-top"><div><div class="name">Snaggletooth</div><span class="controller-badge ai">AI Companion</span></div></div><div class="sub">Goblin</div><div class="bars">❤ 7/7</div>';
const AI_ACTS = '<div class="watch-note"><b>VIEW ONLY</b><span>Watching Snaggletooth. The AI controls this turn; every available skill stays visible but cannot be selected.</span></div>'
  + Array.from({ length: 4 }, (_, i) => `<button class="act" disabled><div class="an">⚔ Strike ${i + 1}</div><div class="ax">1d6+2</div><div class="ar">melee</div></button>`).join('');

for (const viewport of [{ width: 412, height: 915 }, { width: 412, height: 859 }, { width: 392, height: 641 }]) {
  for (const scroll of [0, 120]) {
    test(`during an AI turn the caption is above the dock on a ${viewport.width} x ${viewport.height} screen (page scrolled ${scroll}px)`, async () => {
      const { page, context, writes } = await openPage(browser, viewport, { url: '/api/dnd/table', files: FILES, reads: {} });
      try {
        await page.waitForFunction(() => typeof layout === 'function' && typeof caption === 'function' && typeof setStoryOpen === 'function');
        const r = await page.evaluate(({ line, flag, who, acts, scroll }) => {
          document.getElementById('overlay').classList.add('hidden');
          const turn = document.getElementById('turnflag'); turn.className = 'watching'; turn.innerHTML = flag;
          window.SC = () => ({ grid: { w: 18, h: 12 } });
          setStoryOpen(true);
          layout();
          document.getElementById('who').innerHTML = who;
          document.getElementById('actions').innerHTML = acts;
          const el = document.getElementById('caption');
          el.style.transition = 'none';
          caption(line, { hold: true });
          window.scrollTo(0, scroll);
          window.dispatchEvent(new Event('scroll'));
          const c = el.getBoundingClientRect(), d = document.getElementById('dock').getBoundingClientRect();
          const hits = [0.15, 0.5, 0.85].map((f) => { const h = document.elementFromPoint(c.left + c.width / 2, c.top + c.height * f); return !!h && (h === el || el.contains(h)); });
          return { cap: { top: c.top, bottom: c.bottom }, dockTop: d.top, hits, scrollY: window.scrollY, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, overflowY: getComputedStyle(el).overflowY };
        }, { line: LINE, flag: AI_FLAG, who: AI_WHO, acts: AI_ACTS, scroll });
        assert.ok(r.cap.bottom <= r.dockTop + 0.5, `the caption ends at ${Math.round(r.cap.bottom)}px, the dock starts at ${Math.round(r.dockTop)}px`);
        assert.deepEqual(r.hits, [true, true, true], 'the caption takes taps at its top, middle and bottom (nothing is drawn over it)');
        assert.ok(r.scrollHeight <= r.clientHeight + 1 || r.overflowY === 'auto', 'every word can be read');
        assert.deepEqual(writes, [], 'showing a caption wrote nothing');
      } finally {
        await context.close();
      }
    });
  }
}
