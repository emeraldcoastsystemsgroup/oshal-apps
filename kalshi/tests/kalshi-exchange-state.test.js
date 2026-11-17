/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The header says "trading halted" only when a scan actually read the exchange status and it was halted. With no scan yet (the route answers exchangeActive false before the first snapshot) or a status this installation could not read (null), it says the status is unknown. The guard EXECUTES the shipped exchangeState() out of the surface.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.10.0: the exchange is said only when there is something to say. "trading active" beside "paper mode" read as if the page were trading (Roger's phone, 2026-11-16), so an open exchange says nothing; paused reads "Kalshi has paused trading" only when a scan read it so; an unreadable status with a scan reads "Kalshi status unknown"; before any scan nothing is claimed, never paused.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'kalshi.html'), 'utf8');

test('no scan yet claims nothing, an unreadable status reads as unknown, and only a scan that read it says paused', () => {
  const { fns } = surface(html, ['exchangeState'], () => [200, {}]);
  assert.deepEqual({ ...fns.exchangeState({ awaitingFirstScan: true, generatedAt: null, exchangeActive: false }) }, { tone: '', label: '' });
  assert.equal(fns.exchangeState({ generatedAt: '2026-10-11T00:00:00Z', exchangeActive: null }).label, 'Kalshi status unknown');
  assert.equal(fns.exchangeState({ generatedAt: '2026-10-11T00:00:00Z', exchangeActive: false }).label, 'Kalshi has paused trading');
  assert.deepEqual({ ...fns.exchangeState({ generatedAt: '2026-10-11T00:00:00Z', exchangeActive: true }) }, { tone: 'ok', label: '' }, 'an open exchange is not said as "trading active"');
  assert.doesNotMatch(html, /'trading active'/, 'no script says it');
});
