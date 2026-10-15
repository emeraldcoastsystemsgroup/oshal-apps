/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A refused Uber Eats call (HTTP 503: no Uber Eats connection on this installation) is shown as "Not connected" and never as "No restaurants matched that craving." The guard EXECUTES the shipped search(), openMenu() and sendChat() out of the surface against a fetch that answers 503, and checks that a real empty 200 still reads as no matches.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The refusal names the installation's fact (no Uber Eats rail, no Uber Eats connector exists here) and never says a connection can be added.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'eats-app.html'), 'utf8');
/** One declaration (function, async function or one-line const) cut out of the shipped surface. */
function extract(source, name) {
  const constant = new RegExp(`^\\s*const ${name} = .*;$`, 'm').exec(source);
  if (constant) return constant[0].trim();
  let start = source.search(new RegExp(`(async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} is not in the surface`);
  let depth = 0;
  for (let i = source.indexOf('{', source.indexOf(')', start)); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} is never closed`);
}

/** A DOM element double: only the fields the surface writes and reads. */
function element() {
  return { textContent: '', innerHTML: '', value: '', style: {}, dataset: {}, hidden: false, disabled: false, className: '',
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } }, addEventListener() {}, appendChild(c) { return c; } };
}

/** Run named declarations from the surface in a sandbox whose fetch answers `respond(url, init)`. */
function surface(source, names, respond, extra = {}) {
  const elements = new Map();
  const el = (key) => { if (!elements.has(key)) elements.set(key, element()); return elements.get(key); };
  const sandbox = { Number, String, Boolean, Object, Array, Math, JSON, Error, Map, Set, Promise, URLSearchParams, encodeURIComponent,
    console, setTimeout: () => 0, clearTimeout() {}, $: el,
    document: { getElementById: (id) => el(`#${id}`), querySelector: el, querySelectorAll: () => [], createElement: () => element() },
    window: { open() {} }, localStorage: { getItem: () => null, setItem() {} },
    fetch: async (url, init) => { const [status, body] = await respond(String(url), init || {}); return { status, ok: status >= 200 && status < 300, json: async () => body }; },
    ...extra };
  vm.createContext(sandbox);
  new vm.Script(names.map((name) => extract(source, name)).join('\n') + '\n' +
    `globalThis.__exports = {${names.filter((n) => !/^[A-Z_]+$/.test(n)).join(',')}};`).runInContext(sandbox);
  return { el, fns: sandbox.__exports, sandbox };
}

const NAMES = ['NOT_CONNECTED', 'readBody', 'getJson', 'postJson', 'providerRefused', 'showNotConnected', 'escapeHtml', 'search', 'openMenu', 'sendChat'];
const REFUSED = [503, { error: 'native_executor_unavailable' }];
const stubs = () => ({ API: '/api/eats', state: { restaurants: [], dishes: [] }, renderChips() {}, publishContext() {}, hydrateDishButtons() {},
  renderRestaurantCard: (item) => `<card>${item.title}</card>`, renderDishCard: (item) => `<dish>${item.title}</dish>`,
  addMessage: () => ({ textContent: '' }), loadCart: async () => {}, proposeOrder() {} });

test('a refused restaurant search says Uber Eats is not connected, not that nothing matched', async () => {
  const page = surface(html, NAMES, () => REFUSED, stubs());
  await page.fns.search('pizza');
  assert.match(page.el('#grid').innerHTML, /no Uber Eats rail \(no Uber Eats connector exists here\)/);
  assert.doesNotMatch(page.el('#grid').innerHTML, /connection is added|\/utilities|connect it/i);
  assert.doesNotMatch(page.el('#grid').innerHTML, /No restaurants matched/);
});

test('a refused menu and a refused concierge turn say not connected too', async () => {
  const page = surface(html, NAMES, () => REFUSED, stubs());
  await page.fns.openMenu('store-1', 'Store');
  assert.match(page.el('#grid').innerHTML, /Unavailable: this installation has no Uber Eats rail/);
  const bubble = { textContent: '' };
  page.sandbox.addMessage = () => bubble;
  page.el('#chatInput').value = 'tacos';
  await page.fns.sendChat();
  assert.match(bubble.textContent, /Unavailable: this installation has no Uber Eats rail/);
});

test('a real empty catalog answer still reads as no matches', async () => {
  const page = surface(html, NAMES, () => [200, { items: [], source: 'catalog' }], stubs());
  await page.fns.search('nothing');
  assert.match(page.el('#grid').innerHTML, /No restaurants matched that craving/);
});
