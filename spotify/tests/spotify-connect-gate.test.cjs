/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (spotify--spotify-concierge, FIX-BROKEN): with no Spotify link the page is
 *   the connect card, and its "Refresh" was a <span> that fired a silent read, "Connect Spotify" left the person on the
 *   Connections page instead of back in Music, the button was underlined white-on-silver in Graphite, and the page repeated
 *   the shell's name in its own header. Regression guard over the served surface: the connect link names the return to
 *   /cockpit/?app=spotify (the kernel's /api/connect/<id>/start honours ?return=), Refresh is a real button that says
 *   "Checking…" and then what it found, the button ink is the theme's on-accent token, and the inner header is gone.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'tools', 'spotify-app.html'), 'utf8');
const classic = () => [...HTML.matchAll(/<script(?![^>]*\s(?:src|type)=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

test('Connect Spotify signs in at the top level and comes back to Music in the cockpit', () => {
  const a = HTML.match(/<a [^>]*id="connectSpotify"[^>]*>/);
  assert.ok(a, 'the connect button is there');
  assert.match(a[0], /target="_top"/);
  const href = a[0].match(/href="([^"]+)"/)[1];
  const url = new URL(href, 'https://oshal.test');
  assert.equal(url.pathname, '/api/connect/spotify/start');
  assert.equal(url.searchParams.get('return'), '/cockpit/?app=spotify');
});

test('"Already connected? Refresh" is a real button that says it is checking, then what it found', () => {
  assert.match(HTML, /<button type="button" class="linkbtn" id="recheck">Refresh<\/button>/);
  assert.match(HTML, /<button type="button" class="linkbtn" id="recheck2">Refresh<\/button>/);
  assert.doesNotMatch(HTML, /<span[^>]*id="recheck2?"/, 'no span pretending to be a button');
  assert.match(HTML, /id="recheckNote" role="status"/);
  const src = classic().join('\n');
  assert.match(src, /btn\.textContent='Checking…'/);
  for (const state of ['ok', 'needs_allowlist', 'error', 'not_connected']) assert.match(src, new RegExp(`${state}:'[^']+'`), state);
});

test('the recheck runs boot and reports the state it returns (the page script, run in a sandbox)', async () => {
  const nodes = {};
  const node = (sel) => (nodes[sel] = nodes[sel] || { style: {}, textContent: sel === '#recheck' ? 'Refresh' : '', disabled: false,
    classList: { toggle() {}, add() {}, remove() {} }, addEventListener() {}, set onclick(fn) { this._click = fn; }, get onclick() { return this._click; },
    innerHTML: '', value: '', focus() {}, scrollIntoView() {} });
  const sandbox = {
    document: { querySelector: node, getElementById: (id) => node('#' + id), addEventListener() {}, createElement: () => ({ set textContent(v) { this.t = v; }, get innerHTML() { return this.t; } }) },
    localStorage: { getItem: () => '', setItem() {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ connected: false, me: null, status: 'not_connected' }) }),
    console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, URLSearchParams, addEventListener() {}, parent: null, MutationObserver: function () { this.observe = () => {}; },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const s of classic()) vm.runInContext(s, sandbox, { filename: 'spotify-app.html' });
  const btn = nodes['#recheck'];
  const pending = btn.onclick();
  assert.equal(btn.textContent, 'Checking…');
  assert.equal(btn.disabled, true);
  assert.equal(await pending, 'not_connected');
  assert.equal(btn.textContent, 'Refresh');
  assert.equal(btn.disabled, false);
  assert.equal(nodes['#recheckNote'].textContent, 'Still not connected. Press Connect Spotify to sign in.');
  assert.equal(nodes['#gateWrap'].style.display, 'block');
});

test('button ink follows the theme and the page no longer repeats the shell name', () => {
  assert.match(HTML, /\.btn\{[^}]*color:var\(--ds-on-accent,var\(--text-on-accent,#fff\)\)/);
  assert.match(HTML, /a\.btn\{display:inline-block;text-decoration:none\}/);
  assert.doesNotMatch(HTML, /<header>/);
  assert.doesNotMatch(HTML, /OSHAL Spotify<small>/);
});
