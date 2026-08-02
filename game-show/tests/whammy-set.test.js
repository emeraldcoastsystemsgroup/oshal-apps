/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-31 23:05:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Guards for backlog #3 + #5 against the REAL ui/gs-show-whammy.js (loaded in a vm with a stub GS/DOM, so the renderer under test is the byte-for-byte browser file): (3) every panel count 8-12 renders a CLOSED ring — panels plus dimmed fillers cover all 12 perimeter slots, no slot doubled; (5) the centre screen shows the CURRENT beat — a page opened mid-game starts on attract (never replaying the room's last readout), a fresh stop goes live, the module ticker hands a lapsed readout back to attract, a non-lights phase never shows a readout, and a new round clears it.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0, checks = 0;
const check = (cond, msg) => { checks++; if (!cond) { console.error('  ✗ ' + msg); failures++; } };

// ── A just-enough DOM: nodes with className/classList/children + an id registry ─
const registry = new Map();

function makeNode(tag, attrs) {
  const node = {
    tag,
    attrs: attrs || {},
    id: (attrs && attrs.id) || null,
    className: (attrs && attrs.class) || '',
    children: [],
    textContent: '',
    appendChild(child) { node.children.push(child); return child; },
  };
  node.classList = {
    toggle(cls, on) {
      const set = new Set(node.className.split(/\s+/).filter(Boolean));
      const want = on === undefined ? !set.has(cls) : !!on;
      if (want) set.add(cls); else set.delete(cls);
      node.className = Array.from(set).join(' ');
    },
    add(cls) { node.classList.toggle(cls, true); },
    remove(cls) { node.classList.toggle(cls, false); },
    contains(cls) { return node.className.split(/\s+/).indexOf(cls) >= 0; },
  };
  if (node.id) registry.set(node.id, node);
  return node;
}

/** @description GS.el stub matching the real signature: (tag, attrs, ...children). */
function el(tag, attrs) {
  const node = makeNode(tag, attrs);
  for (let i = 2; i < arguments.length; i++) {
    const child = arguments[i];
    if (child == null || child === false) continue;
    node.children.push(typeof child === 'object' ? child : { text: String(child), children: [] });
  }
  return node;
}

/** @description Depth-first walk of a fake node tree. */
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  (node.children || []).forEach((child) => walk(child, visit));
}

/** @description Find the first node whose className includes cls. */
function findByClass(root, cls) {
  let hit = null;
  walk(root, (node) => {
    if (!hit && String(node.className || '').split(/\s+/).indexOf(cls) >= 0) hit = node;
  });
  return hit;
}

// ── Load the REAL browser renderer in a vm with controllable time ────────────
let nowMs = 1000000;
const tickers = [];
let ui = null;

const GS = {
  el,
  registerShowUi(spec) { ui = spec; },
  state: null,
  seats: [
    { seatId: 's1', name: 'Ana', role: 'player' },
    { seatId: 's2', name: 'Bo', role: 'player' },
  ],
  players() { return GS.seats.filter((s) => s.role !== 'host'); },
};

const sandbox = {
  window: { GS, matchMedia: () => ({ matches: false }) },
  document: { getElementById: (id) => registry.get(id) || null },
  setInterval: (fn) => { tickers.push(fn); return 1; },
  Date: { now: () => nowMs },
};
vm.createContext(sandbox);
const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'gs-show-whammy.js'), 'utf8');
new vm.Script(source, { filename: 'gs-show-whammy.js' }).runInContext(sandbox);
check(!!ui && typeof ui.board === 'function', 'the real renderer registered via GS.registerShowUi');

/** @description A lights-phase state with n generated panels. */
function lightsState(n, extra) {
  return Object.assign({
    showId: 'whammy', phase: 'lights', round: 1,
    board: {
      panels: Array.from({ length: n }, (_, i) => ({ label: 'Panel ' + i, value: 100 + i * 10, kind: 'cash' })),
      control: null, spinsLeft: {}, whammies: {}, lastStop: null, winner: null, spinsPerPlayer: 5,
    },
    scores: {}, host: { line: '', mode: '', at: 0 }, shot: { type: 'board', serial: 1, at: nowMs },
  }, extra || {});
}

/** @description Render the set and return { wrap, ringSlots, panelCells, fillerCells, screen }. */
function render(state) {
  registry.clear();
  GS.state = state;
  const wrap = ui.board();
  const slots = new Map();   // ring position -> [cells]
  let panels = 0, fillers = 0;
  walk(wrap, (node) => {
    const match = String(node.className || '').match(/(?:^|\s)gsy-p(\d+)(?:\s|$)/);
    if (!match) return;
    const pos = Number(match[1]);
    slots.set(pos, (slots.get(pos) || []).concat(node));
    if (node.classList.contains('blank')) fillers++; else panels++;
  });
  return { wrap, slots, panels, fillers, screen: registry.get('gsy-screen') || null };
}

// ── #3: the ring closes at every allowed panel count ─────────────────────────
[8, 9, 10, 11, 12].forEach((n) => {
  const scene = render(lightsState(n));
  const covered = Array.from({ length: 12 }, (_, p) => p).filter((p) => (scene.slots.get(p) || []).length);
  check(covered.length === 12, `n=${n}: all 12 ring slots are occupied (got ${covered.length})`);
  const doubled = Array.from(scene.slots.values()).filter((cells) => cells.length > 1);
  check(doubled.length === 0, `n=${n}: no ring slot holds two cells`);
  check(scene.panels === n, `n=${n}: exactly ${n} live panel cells (got ${scene.panels})`);
  check(scene.fillers === 12 - n, `n=${n}: ${12 - n} dimmed fillers close the ring (got ${scene.fillers})`);
});

// The arithmetic the backlog names: n=10 leaves ring slots 3 and 9 panel-free.
{
  const scene = render(lightsState(10));
  const fillerAt = (p) => (scene.slots.get(p) || []).some((c) => c.classList.contains('blank'));
  check(fillerAt(3) && fillerAt(9), 'n=10: the two arithmetic gaps (slots 3 and 9) hold fillers');
}

// ── #5: the centre screen shows the CURRENT beat ─────────────────────────────
// A page opened MID-GAME (module state fresh, board already carries a stop):
// the centre must start on attract, not replay the room's last readout.
{
  const state = lightsState(12);
  state.board.lastStop = { seatId: 's1', panelIndex: 2, kind: 'panel', label: 'Big Bucks', value: 500 };
  state.board.spinsLeft = { s1: 4 };
  state.scores = { s1: 500 };
  const scene = render(state);
  check(!!scene.screen, 'mid-game load: the centre screen node exists');
  check(scene.screen && scene.screen.classList.contains('gsy-past'), 'mid-game load: the readout is PAST — attract owns the screen');
  check(scene.screen && !scene.screen.classList.contains('gsy-live'), 'mid-game load: no stale readout is revived');

  // A FRESH press (signature moves): the readout goes live for its window.
  const pressed = lightsState(12);
  pressed.board.lastStop = { seatId: 's1', panelIndex: 5, kind: 'panel', label: 'Spa Day', value: 700 };
  pressed.board.spinsLeft = { s1: 3 };
  pressed.scores = { s1: 1200 };
  const live = render(pressed);
  check(live.screen && live.screen.classList.contains('gsy-live'), 'a fresh stop takes the centre screen (gsy-live)');
  check(!!findByClass(live.wrap, 'gsy-beat-stop') && !!findByClass(live.wrap, 'gsy-beat-attract'),
    'both beat layers are in the DOM so the ticker can flip without creating nodes');

  // The ticker hands a lapsed readout back to attract — no re-render involved.
  nowMs += 60000;
  tickers.forEach((tick) => tick());
  check(live.screen.classList.contains('gsy-past') && !live.screen.classList.contains('gsy-live'),
    'the module ticker flips a lapsed readout back to attract (#5)');
}

// A WHAMMY readout also lapses back to attract once the drain has finished.
{
  const hit = lightsState(12);
  hit.board.lastStop = { seatId: 's1', panelIndex: null, kind: 'whammy', label: 'WHAMMY', value: 0 };
  hit.board.spinsLeft = { s1: 2 };
  hit.board.whammies = { s1: 1 };
  hit.scores = { s1: 0 };
  const scene = render(hit);
  check(scene.screen && scene.screen.classList.contains('gsy-scr-whammy') && scene.screen.classList.contains('gsy-live'),
    'a fresh whammy takes the centre screen');
  nowMs += 60000;
  tickers.forEach((tick) => tick());
  // First tick finishes the drain; the flip happens once no drain is falling.
  tickers.forEach((tick) => tick());
  check(scene.screen.classList.contains('gsy-past'), 'the whammy readout lapses back to attract too');
}

// Outside the lights phase a readout never renders, whatever the board holds.
{
  const scored = lightsState(12, { phase: 'scoreboard' });
  scored.board.lastStop = { seatId: 's1', panelIndex: 1, kind: 'panel', label: 'Stale', value: 250 };
  const scene = render(scored);
  check(!findByClass(scene.wrap, 'gsy-beat-stop'), 'a non-lights phase never shows a stop readout');
  check(!!findByClass(scene.wrap, 'gsy-marquee'), 'the attract marquee holds the screen instead');
}

// A new round (ingestGenerated clears lastStop) starts clean on attract.
{
  const fresh = render(lightsState(12));
  check(!findByClass(fresh.wrap, 'gsy-beat-stop'), 'a cleared lastStop renders no readout layer');
  check(!!findByClass(fresh.wrap, 'gsy-marquee'), 'a new round opens on the attract marquee');
}

// The winner card still owns the screen at the end of the game.
{
  const done = lightsState(12, { phase: 'round-win' });
  done.board.winner = 's2';
  done.scores = { s2: 4200 };
  const scene = render(done);
  check(!!findByClass(scene.wrap, 'gsy-stop-val'), 'the winner card renders at round-win');
  check(!findByClass(scene.wrap, 'gsy-beat-attract'), 'the winner card is not layered under attract');
}

if (failures) { console.error(`\n✗ ${failures}/${checks} whammy set checks failed`); process.exit(1); }
console.log(`✓ Whammy set holds — ${checks} checks green (closed ring at 8-12 panels, current-beat centre screen)`);
