/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Harvest Siting Console asked the server about its design once, at boot, so after a control change the "Server cross-check" row kept the default design's verdict beside a headline for another design. Boots the shipped console script in a VM over a minimal DOM, a recording fetch and a hand-driven clock: a changed control drops the old verdict ("checking…"), POSTs the CURRENT design once the controls settle, and an answer for an older design never lands. Red on the previous console (one POST, at boot, ever).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'tools', 'harvest-console.js'), 'utf8');
const ROW = 'Server cross-check (/api/ocean-lab/harvest/simulate)';

/** @description A DOM element stand-in holding what the console reads and writes. @param {string} tag Tag. @returns {object} Element. */
function element(tag) {
  const el = {
    tagName: tag, value: '', textContent: '', innerHTML: '', children: [], listeners: {}, style: {}, hidden: false, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null,
    addEventListener(type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
    appendChild(child) { el.children.push(child); return child; },
  };
  Object.defineProperty(el, 'innerHTML', { get: () => '', set: () => { el.children = []; } });
  return el;
}

/**
 * @description Boot the console in a VM. Canvases are absent (the console draws nothing then); every
 * other id is an element. Timers and frames run only when the test advances them.
 * @param {Function} answer Answers one POST body with the server's JSON (or a Promise of it).
 * @returns {object} The harness: posts, elements, timers, frame and row helpers.
 */
function bootConsole(answer) {
  const els = new Map();
  const byId = (id) => {
    if (id.startsWith('cv-')) return null;
    if (!els.has(id)) els.set(id, element(id === 'table-body' ? 'tbody' : 'div'));
    return els.get(id);
  };
  const posts = [];
  const timers = [];
  const frames = [];
  const document = {
    readyState: 'complete', documentElement: element('html'),
    getElementById: byId, createElement: element, querySelectorAll: () => [], addEventListener() {},
  };
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    posts.push({ url, body });
    const payload = await answer(body, posts.length);
    return { ok: true, json: async () => payload };
  };
  const sandbox = {
    document, fetch, console: { warn() {}, error() {}, log() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    setTimeout: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].live = false; },
    MutationObserver: class { observe() {} },
    addEventListener() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'harvest-console.js' });
  const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r)); };
  return {
    posts, els, settle,
    runFrames() { while (frames.length) frames.shift()(); },
    runTimers() { for (const t of timers.splice(0)) if (t.live) t.fn(); },
    /** The cross-check row's value, or null when the table shows no such row. */
    row() {
      const tr = byId('table-body').children.find((r) => r.children[0] && r.children[0].textContent === ROW);
      return tr ? tr.children[1].textContent : null;
    },
    change(id, value) {
      const el = byId(id);
      el.value = value;
      for (const fn of el.listeners.change || []) fn({ target: el });
    },
  };
}

/** @description The server's answer for a design: perpetual exactly when the store is large. @param {object} body POST body. @returns {object} Verdict. */
const verdictFor = (body) => ({ verdict: { perpetual: body.config.storage.capacityWh >= 1, marginRatio: 1.5 } });

test('boot asks once; a changed control drops the old verdict and asks about the current design', async () => {
  const h = bootConsole(verdictFor);
  await h.settle();
  assert.equal(h.posts.length, 1, 'boot asks about the default design');
  const bootStore = h.posts[0].body.config.storage.capacityWh;
  assert.match(h.row(), /perpetual/);

  const capacity = bootStore >= 1 ? '0.01' : '5';
  h.change('c-cap', capacity);
  h.runFrames();
  assert.equal(h.row(), 'checking…', 'the old verdict is not shown beside the new headline');
  assert.equal(h.posts.length, 1, 'nothing is asked until the controls settle');

  h.runTimers();
  await h.settle();
  assert.equal(h.posts.length, 2, 'the changed design is asked about');
  assert.equal(h.posts[1].body.config.storage.capacityWh, Number(capacity));
  assert.equal(h.row(), (Number(capacity) >= 1 ? 'perpetual' : 'not perpetual') + ' · margin 1.50×');
});

test('an answer for an older design never replaces the current one, and a failed check shows no verdict', async () => {
  let release;
  const slow = new Promise((r) => { release = r; });
  const h = bootConsole((body, n) => (n === 1 ? slow.then(() => verdictFor(body)) : null));
  h.change('c-cap', '5');
  h.runTimers();
  await h.settle();
  assert.equal(h.posts.length, 2);
  assert.equal(h.row(), null, 'the current design\'s check failed: no verdict row');
  release();
  await h.settle();
  assert.equal(h.row(), null, 'the boot design\'s late answer is discarded');
});
