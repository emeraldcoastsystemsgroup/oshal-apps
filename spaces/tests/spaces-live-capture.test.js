/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The "Open LIVE guided capture" link follows availability. With the scan list answering configured:false (the native runtime has no reconstruction engine and answers the capture plan 503) every capture button was switched off but the link stayed live and opened a page with no plan. The shipped applyAvailability and setLiveCapture (cut out of tools/spaces.html and run against a stub DOM) now switch it off with the reason, and back on where the engine exists.
 *
 * Dependency-free `node --test` suite, matching the store CI contract.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'spaces.html'), 'utf8');

/** One function's source out of the page, by brace matching from its declaration. */
function fn(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, `the page declares ${name}`);
  let depth = 0;
  for (let i = html.indexOf('{', start); i < html.length; i += 1) {
    if (html[i] === '{') depth += 1;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

/** A minimal element with attributes and style. */
function element(attrs = {}) {
  const a = { ...attrs };
  return { disabled: false, hidden: true, innerHTML: '', title: '', style: {},
    setAttribute(k, v) { a[k] = String(v); }, removeAttribute(k) { delete a[k]; if (k === 'title') this.title = ''; }, getAttribute: (k) => (k in a ? a[k] : null) };
}

function page() {
  const els = { 'live-capture': element({ href: '/api/spaces/capture?target=room' }), 'phase-note': element() };
  const sandbox = { document: { getElementById: (id) => els[id] || (els[id] = element()) }, esc: (s) => String(s) };
  vm.createContext(sandbox);
  vm.runInContext(`let unavailable = null;\n${fn('applyAvailability')}\n${fn('setLiveCapture')}\nglobalThis.applyAvailability = applyAvailability;`, sandbox);
  return { els, applyAvailability: sandbox.applyAvailability };
}

test('with no scan engine the LIVE guided capture link is switched off with the reason', () => {
  const { els, applyAvailability } = page();
  applyAvailability({ configured: false, reason: 'no_reconstruction_engine', detail: 'This native runtime has no scan reconstruction engine.' });
  const link = els['live-capture'];
  assert.equal(link.getAttribute('href'), null, 'no href: a tap opens nothing');
  assert.equal(link.getAttribute('aria-disabled'), 'true');
  assert.equal(link.style.pointerEvents, 'none');
  assert.match(link.title, /^Not available here: live guided capture needs a scan engine/);
  assert.equal(els['guide-btn'].disabled, true, 'it matches the guided capture button');
});

test('with a scan engine the link stays live', () => {
  const { els, applyAvailability } = page();
  applyAvailability({ configured: false, reason: 'x' });
  applyAvailability({ scans: [] });
  const link = els['live-capture'];
  assert.equal(link.getAttribute('href'), '/api/spaces/capture?target=room');
  assert.equal(link.getAttribute('aria-disabled'), null);
  assert.equal(link.style.pointerEvents, '');
});

test('a capture plan the server refuses also switches the link off', () => {
  assert.match(html, /catch \(e\) \{ setLiveCapture\(false\); toast\("Capture plan unavailable: " \+ e\.message\); \}/);
  assert.match(html, /<a id="live-capture" href="\/api\/spaces\/capture\?target=room"/);
});
