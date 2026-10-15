/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Save says "Saved" only when the server answers with the settings it stored. The native kernel once answered every save with an empty 200 and every read with {}, so the page reported success while Interval and Max channels came back blank. The guard EXECUTES the shipped saveSettings() and loadSettings() out of the surface, and checks the package declares the migration that creates feed_settings.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Sweep 6: the settings drawer told the person 'The cron honors these; the operator can also set them in the DB'. Person-facing copy on the page names no cron, database or operator step.
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

const PKG = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(PKG, 'tools', 'feeds.html'), 'utf8');
const NAMES = ['storedSettings', 'loadSettings', 'saveSettings'];
const form = (page) => { page.el('setInterval').value = '45'; page.el('setMaxCh').value = '12'; };
const stubs = () => ({ settings: null, applyForm() {}, parseInt });

test('an empty 200 to a save is reported as not saved', async () => {
  const page = surface(html, NAMES, () => [200, {}], stubs());
  form(page);
  await page.fns.saveSettings();
  assert.match(page.el('savedMsg').textContent, /^Not saved/);
});

test('a save the server stored is reported as saved and read back with its values', async () => {
  const stored = { pollEnabled: true, pollIntervalMinutes: 45, maxChannels: 12, perChannel: 15, sentimentEnabled: false, lastSyncedAt: null };
  const page = surface(html, NAMES, () => [200, stored], stubs());
  form(page);
  await page.fns.saveSettings();
  assert.equal(page.el('savedMsg').textContent, 'Saved');
  await page.fns.loadSettings();
  assert.equal(page.sandbox.settings.pollIntervalMinutes, 45);
});

test('the package migration creates feed_settings and feed_messages', () => {
  const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
  const declared = /^migrations:\n((?:  - .+\n)+)/m.exec(manifest);
  assert.ok(declared, 'feeds declares its migrations');
  const sql = declared[1].trim().split('\n').map((line) => fs.readFileSync(path.join(PKG, line.replace(/^- /, '').trim()), 'utf8')).join('\n');
  for (const table of ['feed_settings', 'feed_messages']) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
});

test('the settings drawer speaks to the person: no cron, database or operator step', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'feeds.html'), 'utf8');
  const drawer = /<aside class="drawer" id="drawer">([\s\S]*?)<\/aside>/.exec(html);
  assert.ok(drawer, 'the page has its settings drawer');
  const text = drawer[1].replace(/<[^>]+>/g, ' ');
  assert.match(text, /Saved to your account\. Scheduled pulls follow these settings\./);
  assert.doesNotMatch(text, /\bcron\b|\bDB\b|database|operator/i);
});
