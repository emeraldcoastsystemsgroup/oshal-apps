/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.22.5 (lane mobilesweep2, the phone first-screen sweep of 2026-11-16: in Today on a phone Dungeon Master's My Games, which Games opens too, floated in the middle of a black stage 291 px down a 915 px phone, 32%, and its four buttons wrapped into two ragged rows). The real table page (ui/table.html with its scripts and stylesheet) inside a stand-in for Today (tests/browser/today-phone-fixture.cjs) with the package's own adventure content, no campaigns and no saved characters, every write refused. At 412x915, 390x844 and 360x780 with touch: My Games starts within the top 20% of the screen on the page colour (no scrim behind it), full width; Start New Campaign is one row across the card and Join with Code, My Characters and How to Play share the next row, each a whole 44 px button; nothing scrolls sideways and nothing to tap is under the floating Jarvis button at the end. At 1440x900 My Games is still the centred card over the scrim. Red on 0.22.4.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SIZES, playwright, openInToday, screenTop, sideways, underOrbAtEnd } = require('./browser/today-phone-fixture.cjs');
const { loadAdventureCatalog } = require('../lib/dnd-adventure-catalog');

const UI = path.join(__dirname, '..', 'ui');
const DATA = path.join(__dirname, '..', 'data');
const FILES = { '/api/dnd/table': path.join(UI, 'table.html') };
for (const name of fs.readdirSync(UI)) if (/\.(js|css)$/.test(name)) FILES['/api/dnd/' + name] = path.join(UI, name);

/** @description The package's own /content answer: its party and adventure catalog, as the route serves them. @returns {object} The content. */
function content() {
  const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_error) { return null; } };
  const party = (readJson(path.join(DATA, 'party.json')) || {}).party || [], catalog = loadAdventureCatalog(DATA, readJson);
  return { heroes: party, defaultParty: party.map((hero) => hero.id), monsters: {}, adventure: catalog.adventure, adventures: catalog.adventures };
}
const READS = { '/api/dnd/content': content(), '/api/dnd/campaigns': { campaigns: [] }, '/api/dnd/characters': { characters: [] } };

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

/** @description My Games' card, what is behind it and its buttons, in frame px. */
function library() {
  const card = document.getElementById('overlayCard'), overlay = document.getElementById('overlay'), r = card.getBoundingClientRect();
  const buttons = [...card.querySelectorAll('.library-actions button')].map((b) => { const x = b.getBoundingClientRect(); return { name: b.textContent.trim(), top: Math.round(x.top), height: Math.round(x.height), width: Math.round(x.width) }; });
  return { width: Math.round(r.width), behind: getComputedStyle(overlay).backgroundColor, buttons };
}

for (const size of SIZES) {
  test(`${size.width}x${size.height}: My Games starts near the top as a page, its buttons in two tidy rows`, { timeout: 60000 }, async (t) => {
    const phone = size.width <= 640;
    const { page, frame, context, writes, errors } = await openInToday(browser, size, { url: '/api/dnd/table', files: FILES, reads: READS,
      ready: (f) => f.waitForSelector('#overlayCard[data-screen="game-library"] .library-actions', { timeout: 15000 }) });
    try {
      const top = await screenTop(page, frame, '#overlayCard'), lib = await frame.evaluate(library);
      t.diagnostic(`My Games ${top}px (${Math.round((top / size.height) * 100)}%)`);
      const fit = await sideways(frame);
      assert.ok(fit.scrollWidth <= fit.clientWidth, `nothing scrolls the page sideways (${fit.offenders.join(', ')})`);
      const rows = [...new Set(lib.buttons.map((b) => b.top))];
      if (phone) {
        assert.ok(top !== null && top <= size.height * 0.2, `My Games starts within the top 20%: ${top}px of ${size.height}`);
        assert.ok(lib.width >= size.width - 2, `full width (${lib.width}px)`);
        assert.match(lib.behind, /^rgb\(/, `an opaque page colour behind it, not the see-through scrim (${lib.behind})`);
        assert.equal(rows.length, 2, `two rows of buttons (${JSON.stringify(lib.buttons)})`);
        assert.equal(lib.buttons[0].top, rows[0], 'Start New Campaign is the first row');
        assert.equal(lib.buttons.filter((b) => b.top === rows[1]).length, 3, 'the three other choices share the second row');
        for (const b of lib.buttons) assert.ok(b.height >= 44, `${b.name} is a whole 44 px button (${b.height})`);
        assert.deepEqual(await underOrbAtEnd(page, frame), [], 'nothing to tap is under the floating Jarvis button at the end');
      } else {
        const stage = await frame.locator('#stage').boundingBox(), card = await frame.locator('#overlayCard').boundingBox();
        assert.ok(Math.abs((card.y + card.height / 2) - (stage.y + stage.height / 2)) < 4, 'the desktop keeps the centred card');
      }
      assert.deepEqual(writes, [], 'opening My Games writes nothing');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
