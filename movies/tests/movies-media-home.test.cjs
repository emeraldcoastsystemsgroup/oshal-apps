/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (movies--movies-concierge, FIX-LAYOUT): browse led with a search form, an
 *   "OSHAL Movies & TV" header and a "TMDB connected" chip, the mood box sat below 18 posters, the search placeholder promised
 *   "sci-fi thrillers" from a title search, and the watchlist had no place of its own. Guard over the served surface and its
 *   script run in a sandbox: a hero from Trending with Where to watch as the one primary and + Watchlist beside it, poster
 *   rows with one caption line, Home · Search · Watchlist views, Movies · TV chips, the literal search placeholder, an empty
 *   watchlist that says so, and the concierge as a sheet with suggested prompts that never sits under the title sheet.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.1.6: the manifest's ribbon.hideAssistant keeps the shell orb off the Ask sheet's Send button.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'tools', 'movies-app.html'), 'utf8');
const body = HTML.slice(HTML.indexOf('<body>'));
const classic = () => [...HTML.matchAll(/<script(?![^>]*\s(?:src|type)=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

test('browse carries no inner header, overline or connection chip (the shell names the app; status lives in Settings)', () => {
  assert.doesNotMatch(body, /<header>/);
  assert.doesNotMatch(body, /OSHAL Movies &amp; TV<small>|What to watch &amp; where/);
  assert.doesNotMatch(body, /TMDB connected|id="connTxt"/);
});

test('Home · Search · Watchlist are views of the page, with Movies · TV chips above them', () => {
  for (const v of ['home', 'search', 'watchlist']) {
    assert.match(body, new RegExp(`<button type="button" data-view="${v}"`));
    assert.match(body, new RegExp(`<section class="view col" id="view-${v}"`));
  }
  assert.match(body, /data-type="movie" aria-pressed="false">Movies<\/button>/);
  assert.match(body, /data-type="tv" aria-pressed="false">TV<\/button>/);
  assert.match(HTML, /\.tabs\{position:fixed;left:0;right:0;bottom:0;/, 'a bottom bar on a phone');
});

test('Search is its own view with a literal placeholder for the title search it runs', () => {
  const q = body.match(/<input id="q"[^>]*>/)[0];
  assert.match(q, /placeholder="Search movies and shows"/);
  assert.doesNotMatch(body, /sci-fi thrillers/);
  assert.ok(body.indexOf('id="q"') > body.indexOf('id="view-search"') && body.indexOf('id="q"') < body.indexOf('id="view-watchlist"'));
});

test('the concierge is a sheet with two to four suggested prompts, opened from Ask, and the mood box left browse', () => {
  const ask = body.slice(body.indexOf('id="askModal"'), body.indexOf('id="toast"'));
  assert.match(ask, /id="chatq"/);
  assert.match(ask, /id="sendBtn"/);
  const prompts = (ask.match(/<button type="button" class="chip">/g) || []).length;
  assert.ok(prompts >= 2 && prompts <= 4, `${prompts} suggested prompts`);
  assert.ok(body.indexOf('id="chatq"') > body.indexOf('id="askModal"'), 'the mood box lives in the sheet only');
  assert.match(body, /id="askBtn" aria-haspopup="dialog">Ask<\/button>/);
});

/** The page script in a sandbox with a recording DOM, enough to run its view, hero and sheet functions. */
function page(answers) {
  const nodes = {};
  const make = (sel) => ({ sel, hidden: false, innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false,
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, toggle(c, on) { (on === undefined ? !this.set.has(c) : on) ? this.set.add(c) : this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null, addEventListener() {}, appendChild(c) { (this.children = this.children || []).push(c); },
    querySelector: () => make('child'), focus() {}, contains: () => true, replaceWith() {} });
  const node = (sel) => (nodes[sel] = nodes[sel] || make(sel));
  const sandbox = {
    document: { querySelector: node, getElementById: (id) => node('#' + id), querySelectorAll: () => [], addEventListener() {},
      createElement: () => { const n = make('new'); Object.defineProperty(n, 'textContent', { set(v) { this._t = String(v); }, get() { return this._t; } }); Object.defineProperty(n, 'innerHTML', { set(v) { this._h = v; }, get() { return this._h !== undefined ? this._h : String(this._t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;'); } }); return n; },
      body: { style: {} } },
    localStorage: { getItem: () => '', setItem() {} }, setTimeout: (fn) => fn(), console: { log() {}, error() {} },
    fetch: async (url) => ({ json: async () => (answers[String(url).split('?')[0]] || {}) }),
    scrollTo() {}, addEventListener() {}, parent: null, MutationObserver: function () { this.observe = () => {}; },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const s of classic()) vm.runInContext(s, sandbox, { filename: 'movies-app.html' });
  return { sandbox, nodes };
}

test('the hero is the first trending title: Where to watch is the one primary and + Watchlist the secondary', async () => {
  const p = page({ '/api/movies/config': { connected: true }, '/api/movies/watchlist': { items: [] },
    '/api/movies/trending': { items: [{ id: 1, mediaType: 'movie', key: 'movie:1', title: 'Synthetic Arrival', year: '2016', overview: 'A linguist.' }, { id: 2, mediaType: 'tv', key: 'tv:2', title: 'Synthetic Show', year: '2022' }] } });
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  const hero = p.nodes['#hero'].innerHTML;
  assert.match(hero, /Synthetic Arrival/);
  assert.match(hero, /<button type="button" class="btn" id="heroWatch">Where to watch<\/button>/);
  assert.match(hero, /<button type="button" class="btn ghost" id="heroAdd">\+ Watchlist<\/button>/);
  assert.equal((hero.match(/class="btn"/g) || []).length, 1, 'one primary');
  const cards = p.nodes['#grid'].children || [];
  assert.equal(cards.length, 2, 'every trending title is a poster in the row');
  assert.match(cards[0].innerHTML, /<div class="name" title="Synthetic Arrival · 2016">Synthetic Arrival · 2016<\/div>/, 'one caption line, title · year');
});

test('an empty watchlist says so in its own view; the type chips filter what is shown', async () => {
  const p = page({ '/api/movies/config': { connected: true }, '/api/movies/watchlist': { items: [] }, '/api/movies/trending': { items: [] } });
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  assert.match(p.nodes['#watchlist'].innerHTML, /Nothing saved yet\. Tap \+ Watchlist on a title to keep it here\./);
  const ofType = vm.runInContext('shown.type="tv";ofType([{mediaType:"tv"},{mediaType:"movie"}]).length', p.sandbox);
  assert.equal(ofType, 1);
});

test('opening a title closes the concierge sheet and opening the concierge closes the title sheet', () => {
  const src = classic().join('\n');
  assert.match(src, /async function openDetail\(type,id\)\{\n  closeAsk\(\);/);
  assert.match(src, /function openAsk\(\)\{closeDetail\(\);/);
});

test('the Ask sheet is the one assistant entry: the manifest withholds the shell orb that covered its Send button', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8');
  const ribbon = manifest.slice(manifest.indexOf('\nribbon:'), manifest.indexOf('\nsummary:'));
  assert.match(ribbon, /\n  hideAssistant: true\n/);
});
