/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Phone proof for the game table (ui/table.html + ui/dnd.css, the dnd and games screens) in the battle layout a player sees on their turn: turn panel shown, Dungeon Master drawer open, the 18 x 12 board laid out by the page's own layout(). At 412 x 915 and in the 392 x 641 cockpit frame the map row under the toolbar is at least 300 px, the board is drawn at the full width, no toolbar button touches the board or another button, and the turn panel, board and drawer follow each other down the page. On a phone the board was a ~110 px strip under the turn panel with the toolbar drawn over it, and Full screen slid under DM & Story in the 392 px frame.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Phone proof that the sticky dock leaves the map and Ask DM in reach: with the dock filled as table-dock.js renders a player's own turn (name, controller badge, inventory button, race/class, hit points, two or four actions), every action is on screen and takes the tap with no sideways scroll (a fourth action started off screen in a row that scrolled sideways), the whole board and the dock fit one screen together, with two actions at the top of the page the whole board is above the dock, drawer open and closed (the 168px dock covered the board's bottom 52px in the 392 x 641 frame), and with the drawer open the Ask DM input starts within 150px of the board's bottom (it was under the whole story log, ~420px below) and, scrolled to or focused, stops above the dock.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Phone proof that the sticky dock stays bounded however many actions it holds: with 10 and with 32 actions on a player's own turn (32 is the character import's cap, lib/character-import-common.js ACTION_COUNT) and while watching another player's four-action hero (a full-width view-only note above the cards, as table-dock.js renders it), the dock is at most 220px (about 215px: two rows of cards, the top of a third, the identity line), the whole board and the dock fit one screen together, End Turn and the first action are on screen and take the tap, and every action can be scrolled into the dock's list and then takes the tap. The wrapping action grid grew with every three actions: 10 actions made a 324px dock over 69px of the board, 32 an 833px dock taller than the 641px frame with 8 actions out of reach.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | My Games: Delete Campaign and Leave Campaign read at 4.5:1 or better on an opaque background under the default (dark) and a light cockpit theme. Under a light theme they were #ffb2a5 over an 18% red tint of the pale --bg-tertiary row, pale pink on a pale card.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { VIEWPORTS, playwright, openPage, overflow } = require('./phone-fixture.cjs');

const UI = path.resolve(__dirname, '../../ui');
const FILES = { '/api/dnd/table': path.join(UI, 'table.html') };
for (const name of fs.readdirSync(UI)) if (/\.(js|css)$/.test(name)) FILES[`/api/dnd/${name}`] = path.join(UI, name);

/** The turn panel exactly as table-turns.js renders a player's own turn (four resource steps). */
const TURN_FLAG = '<div class="turn-copy"><span class="turn-kicker">Your turn</span><strong>Fixture hero\'s turn</strong>'
  + '<span class="turn-cue">Move up to 30 ft and take one action in either order. You may split movement before and after the action.</span></div>'
  + '<div class="turn-steps">' + ['Movement|30 FT LEFT', 'Action|1 LEFT', 'Spell slots|NONE', 'Health|12/12 HP']
    .map((step) => `<span class="turn-step"><b>${step.split('|')[0]}</b>${step.split('|')[1]}</span>`).join('') + '</div>';

/** Put the table in the battle layout and run its own layout() for an 18 x 12 board. */
async function battleLayout(page, storyOpen) {
  await page.waitForFunction(() => typeof layout === 'function' && typeof setStoryOpen === 'function');
  await page.evaluate(({ flag, open }) => {
    document.getElementById('overlay').classList.add('hidden');
    const turn = document.getElementById('turnflag'); turn.className = 'yours'; turn.innerHTML = flag;
    window.SC = () => ({ grid: { w: 18, h: 12 } });
    setStoryOpen(open);
    layout();
  }, { flag: TURN_FLAG, open: storyOpen });
  return page.evaluate(() => {
    const box = (el) => { const b = el.getBoundingClientRect(); return { id: el.id, left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
    const fabs = [...document.querySelectorAll('#stage .fab')].filter((el) => getComputedStyle(el).display !== 'none').map(box);
    return { stage: box(document.getElementById('stage')), board: box(document.getElementById('board')), turn: box(document.getElementById('turnflag')),
      story: box(document.getElementById('story')), storyShown: getComputedStyle(document.getElementById('story')).display !== 'none', fabs };
  });
}

const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

for (const viewport of VIEWPORTS) {
  for (const storyOpen of [true, false]) {
    test(`the battle map gets the width and a 300 px row on a ${viewport.width} px screen (drawer ${storyOpen ? 'open' : 'closed'})`, async () => {
      const { page, context, writes } = await openPage(browser, viewport, { url: '/api/dnd/table', files: FILES, reads: {} });
      try {
        const r = await battleLayout(page, storyOpen);
        assert.ok(r.fabs.length >= 4, `toolbar buttons are on the table (${r.fabs.length})`);
        const toolbarBottom = Math.max(...r.fabs.map((fab) => fab.bottom));
        const mapRow = r.stage.bottom - toolbarBottom;
        assert.ok(mapRow >= 300, `the map row under the toolbar is ${Math.round(mapRow)}px tall`);
        assert.ok(r.board.width >= r.stage.width - 20, `the board is ${Math.round(r.board.width)}px wide in a ${Math.round(r.stage.width)}px table`);
        assert.ok(r.board.top >= toolbarBottom - 0.5 && r.board.bottom <= r.stage.bottom + 0.5, `the board (${Math.round(r.board.top)}-${Math.round(r.board.bottom)}) sits in the map row (${Math.round(toolbarBottom)}-${Math.round(r.stage.bottom)})`);
        for (const fab of r.fabs) assert.ok(!overlaps(fab, r.board), `${fab.id} is drawn over the board`);
        for (let i = 0; i < r.fabs.length; i++) for (let j = i + 1; j < r.fabs.length; j++) assert.ok(!overlaps(r.fabs[i], r.fabs[j]), `${r.fabs[i].id} overlaps ${r.fabs[j].id}`);
        assert.ok(r.turn.bottom <= r.stage.top + 0.5, 'the turn panel is above the board, not on it');
        assert.equal(r.storyShown, storyOpen, 'the drawer is on the page only while it is open');
        if (storyOpen) assert.ok(r.story.top >= r.stage.bottom - 0.5 && r.story.height >= 300, `the drawer follows the board (${Math.round(r.story.top)}) with room to read (${Math.round(r.story.height)}px)`);
        const fit = await overflow(page);
        assert.ok(fit.scrollWidth <= fit.clientWidth, `the table is ${fit.scrollWidth}px wide in a ${fit.clientWidth}px screen`);
        assert.deepEqual(writes, [], 'laying out the table wrote nothing');
      } finally {
        await context.close();
      }
    });
  }
}

/** The dock exactly as table-dock.js renders a hero's own turn: identity, two actions, the turn buttons. */
const actionCards = (specs) => specs.map((spec) => {
  const [name, effect, range] = spec.split('|');
  return `<button class="act"><div class="an">⚔ ${name}</div><div class="ax">${effect}</div><div class="ar">${range}</div><div class="resource-label ready">Action ready</div></button>`;
}).join('');
/** A fighter's two attacks, and a caster's four actions (the most a bundled hero has, data/party.json). */
const DOCKS = { 2: actionCards(['Longsword|1d8+3 slashing|melee', 'Shortbow|1d6+2 piercing|80ft']),
  4: actionCards(['Quarterstaff|1d6 bludgeoning|melee', 'Fire Bolt|1d10 fire|120ft', 'Magic Missile|3d4+3 force|120ft', 'Sleep|5d8 hit points|90ft']) };

/** The dock's identity exactly as table-dock.js renders a player character: name, controller badge, inventory, race/class, bars. */
const WHO = '<div class="who-top"><div><div class="name">Fixture hero</div><span class="controller-badge human">You</span></div>'
  + '<button id="sheetBtn" class="sheet-btn" title="Open character sheet and inventory">🎒 3</button></div>'
  + '<div class="sub">Human Fighter</div><div class="bars">❤ 12/12 &nbsp; 🛡 16 &nbsp; 👟 30/30ft</div>';

/** Fill the dock, then measure where its controls and the Ask DM input are, and what a tap at their centres hits. */
async function dockReach(page) {
  return page.evaluate(() => {
    const at = (el) => {
      const b = el.getBoundingClientRect(), hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { top: b.top, bottom: b.bottom, takesTap: !!hit && (hit === el || el.contains(hit)) };
    };
    return { height: innerHeight, width: innerWidth, act: at(document.querySelector('#actions .act')),
      acts: [...document.querySelectorAll('#actions .act')].map((el) => ({ ...at(el), right: el.getBoundingClientRect().right })), endTurn: at(document.getElementById('endTurn')),
      talk: at(document.getElementById('talkInput')), dock: at(document.getElementById('dock')), stage: at(document.getElementById('stage')),
      board: at(document.getElementById('board')) };
  });
}

const onScreen = (box, height) => box.top >= -0.5 && box.bottom <= height + 0.5;

for (const viewport of VIEWPORTS) {
  for (const [storyOpen, count] of [[false, 2], [true, 2], [false, 4], [true, 4]]) {
    test(`the turn actions and End Turn stay on a ${viewport.width} x ${viewport.height} screen (drawer ${storyOpen ? 'open' : 'closed'}, ${count} actions)`, async () => {
      const { page, context, writes } = await openPage(browser, viewport, { url: '/api/dnd/table', files: FILES, reads: {} });
      try {
        await battleLayout(page, storyOpen);
        await page.evaluate(({ who, acts }) => {
          document.getElementById('who').innerHTML = who;
          document.getElementById('actions').innerHTML = acts; window.scrollTo(0, 0);
        }, { who: WHO, acts: DOCKS[count] });
        const top = await dockReach(page);
        if (count === 2) assert.ok(top.board.bottom <= top.dock.top + 0.5, `at the top of the page the dock (${Math.round(top.dock.top)}) covers the board (to ${Math.round(top.board.bottom)})`);
        assert.ok(top.board.bottom - top.board.top + top.dock.bottom - top.dock.top <= top.height,
          `the whole board (${Math.round(top.board.bottom - top.board.top)}px) and the dock (${Math.round(top.dock.bottom - top.dock.top)}px) fit one ${top.height}px screen together`);
        assert.equal(top.acts.length, count);
        for (const [i, act] of top.acts.entries()) {
          assert.ok(onScreen(act, top.height) && act.right <= top.width + 0.5 && act.takesTap, `action ${i + 1} is at ${Math.round(act.top)}-${Math.round(act.bottom)}px, right edge ${Math.round(act.right)} of ${top.width}, and takes the tap`);
        }
        for (const name of ['act', 'endTurn']) {
          assert.ok(onScreen(top[name], top.height), `${name} is drawn at ${Math.round(top[name].top)}-${Math.round(top[name].bottom)}px of a ${top.height}px screen`);
          assert.ok(top[name].takesTap, `a tap on ${name} reaches it`);
        }
        if (storyOpen) {
          assert.ok(top.talk.top - top.stage.bottom <= 150, `the Ask DM input starts ${Math.round(top.talk.top - top.stage.bottom)}px below the board`);
          await page.locator('#talkInput').scrollIntoViewIfNeeded();
          const talk = await dockReach(page);
          assert.ok(onScreen(talk.talk, talk.height) && talk.talk.takesTap, `the Ask DM input (${Math.round(talk.talk.top)}-${Math.round(talk.talk.bottom)}) takes the tap, not the dock`);
          assert.ok(onScreen(talk.act, talk.height) && talk.act.takesTap, 'the actions are still on screen beside the Ask DM input');
          await page.evaluate(() => { window.scrollTo(0, 0); document.getElementById('talkInput').focus(); });
          const focused = await dockReach(page);
          assert.ok(onScreen(focused.talk, focused.height) && focused.talk.takesTap, `focused from the top of the page, the Ask DM input (${Math.round(focused.talk.top)}-${Math.round(focused.talk.bottom)}) is on screen above the dock`);
        }
        await page.evaluate(() => { document.getElementById('overlay').classList.remove('hidden'); document.getElementById('overlayCard').textContent = 'Fixture screen'; window.scrollTo(0, 0); });
        const card = await dockReach(page);
        assert.ok(card.dock.top >= card.stage.bottom - 0.5, `with a screen card open the dock (${Math.round(card.dock.top)}) stays below the board (${Math.round(card.stage.bottom)})`);
        assert.deepEqual(writes, [], 'laying out the table wrote nothing');
      } finally {
        await context.close();
      }
    });
  }
}

/** Generate `count` distinct action cards (attacks, spells and features as an imported character carries them). */
const manyCards = (count, extraClass = '') => Array.from({ length: count }, (_, i) => {
  const kind = ['⚔ Strike', '✦ Spell', '★ Feature'][i % 3];
  return `<button class="act${extraClass}"${extraClass ? ' disabled' : ''}><div class="an">${kind} ${i + 1}</div><div class="ax">${1 + (i % 4)}d${6 + 2 * (i % 3)}+${i % 5} damage</div>`
    + `<div class="ar">${i % 2 ? 'melee' : `${30 + 10 * (i % 9)}ft`}</div><div class="resource-label ready">Action ready</div></button>`;
}).join('');
/** The view-only note table-dock.js puts above the cards while another player's hero acts. */
const WATCH_NOTE = '<div class="watch-note"><b>VIEW ONLY</b><span>🔒 Morgan controls this hero. Skills are view-only on your device.</span></div>';
const MANY = [
  { label: '10 actions on your turn', count: 10, acts: manyCards(10), tappable: true },
  { label: '32 actions on your turn (the import cap)', count: 32, acts: manyCards(32), tappable: true },
  { label: 'watching another player\'s 4-action hero', count: 4, acts: WATCH_NOTE + manyCards(4, ' disabled'), tappable: false },
];
/** Two rows of cards and the top of a third (156px), the identity line and the dock's padding. */
const DOCK_LIMIT = 220;

for (const viewport of VIEWPORTS) {
  for (const scenario of MANY) {
    for (const storyOpen of [false, true]) {
      test(`the dock stays bounded with ${scenario.label} on a ${viewport.width} x ${viewport.height} screen (drawer ${storyOpen ? 'open' : 'closed'})`, async () => {
        const { page, context, writes } = await openPage(browser, viewport, { url: '/api/dnd/table', files: FILES, reads: {} });
        try {
          await battleLayout(page, storyOpen);
          await page.evaluate(({ who, acts }) => {
            document.getElementById('who').innerHTML = who;
            document.getElementById('actions').innerHTML = acts; window.scrollTo(0, 0);
          }, { who: WHO, acts: scenario.acts });
          const top = await dockReach(page);
          const dockHeight = top.dock.bottom - top.dock.top, boardHeight = top.board.bottom - top.board.top;
          assert.ok(dockHeight <= DOCK_LIMIT, `the dock is ${Math.round(dockHeight)}px tall (at most ${DOCK_LIMIT}px)`);
          assert.ok(boardHeight + dockHeight <= top.height, `the whole board (${Math.round(boardHeight)}px) and the dock (${Math.round(dockHeight)}px) fit one ${top.height}px screen together`);
          assert.equal(top.acts.length, scenario.count);
          assert.ok(onScreen(top.endTurn, top.height) && top.endTurn.takesTap, `End Turn (${Math.round(top.endTurn.top)}-${Math.round(top.endTurn.bottom)}) is on screen and takes the tap`);
          assert.ok(onScreen(top.act, top.height), `the first action (${Math.round(top.act.top)}-${Math.round(top.act.bottom)}) is on screen`);
          if (scenario.tappable) assert.ok(top.act.takesTap, 'a tap on the first action reaches it');
          for (let i = 0; i < scenario.count; i++) {
            const reach = await page.evaluate((index) => {
              const list = document.getElementById('actions'), card = list.querySelectorAll('.act')[index];
              const l = list.getBoundingClientRect(), c = card.getBoundingClientRect();
              if (c.top < l.top) list.scrollTop -= l.top - c.top; else if (c.bottom > l.bottom) list.scrollTop += c.bottom - l.bottom;
              const b = card.getBoundingClientRect(), hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
              return { top: b.top, bottom: b.bottom, right: b.right, takesTap: !!hit && (hit === card || card.contains(hit)), pageY: scrollY };
            }, i);
            assert.ok(onScreen(reach, top.height) && reach.right <= top.width + 0.5, `action ${i + 1} scrolled into the dock is at ${Math.round(reach.top)}-${Math.round(reach.bottom)}px, right edge ${Math.round(reach.right)} of ${top.width}`);
            if (scenario.tappable) assert.ok(reach.takesTap, `action ${i + 1} scrolled into the dock takes the tap`);
            assert.equal(reach.pageY, 0, 'scrolling the action list leaves the page where it was');
          }
          assert.deepEqual(writes, [], 'laying out the table wrote nothing');
        } finally {
          await context.close();
        }
      });
    }
  }
}

/** WCAG relative luminance of an rgb()/rgba() string; null when it is not opaque. */
function luminance(css) {
  const m = /rgba?\(([^)]+)\)/.exec(css); if (!m) return null;
  const [r, g, b, a = 1] = m[1].split(',').map((v) => Number(v.trim()));
  if (a < 1) return null;
  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
const LIGHT_THEME = { '--bg-primary': '#f7f4ee', '--bg-secondary': '#ffffff', '--bg-tertiary': '#f1ece4', '--text-primary': '#14213d', '--text-secondary': '#4a5568' };

for (const theme of ['dark', 'light']) {
  test(`My Games' Delete Campaign and Leave Campaign read at 4.5:1 or better (${theme} theme)`, async () => {
    const { page, context } = await openPage(browser, { width: 412, height: 915 }, { url: '/api/dnd/table', files: FILES, reads: {} });
    try {
      await page.waitForFunction(() => typeof overlay === 'function');
      const r = await page.evaluate(({ tokens }) => {
        for (const [k, v] of Object.entries(tokens)) document.documentElement.style.setProperty(k, v);
        // The rows exactly as showGameMenu (table-screens.js) renders an owned and a joined campaign.
        overlay('<h1>My Games</h1><div class="campaign-list"><div class="campaign-row"><div><h2>write check<span class="campaign-role">Host</span></h2><p>Coast Road</p></div>'
          + '<div class="campaign-actions"><button data-resume="c1">Resume</button><button class="leave" data-delete-campaign="c1" data-name="write check">Delete Campaign</button></div></div>'
          + '<div class="campaign-row"><div><h2>other<span class="campaign-role">Joined</span></h2><p>Coast Road</p></div>'
          + '<div class="campaign-actions"><button data-resume="c2">Resume</button><button class="leave" data-leave="c2" data-name="other">Leave Campaign</button></div></div></div>', 'game-library');
        return [...document.querySelectorAll('.campaign-actions button.leave')].map((b) => ({ text: b.textContent, color: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor }));
      }, { tokens: theme === 'light' ? LIGHT_THEME : {} });
      assert.equal(r.length, 2);
      for (const b of r) {
        const fg = luminance(b.color), bg = luminance(b.bg);
        assert.ok(bg !== null, `${b.text} has an opaque background (${b.bg}), so the card under it cannot wash it out`);
        const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
        assert.ok(ratio >= 4.5, `${b.text} reads at ${ratio.toFixed(2)}:1 (${b.color} on ${b.bg})`);
      }
    } finally {
      await context.close();
    }
  });
}
