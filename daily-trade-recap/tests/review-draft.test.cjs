/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | A brief typed on the review page before "Open it in the cockpit" is there when the cockpit opens the same page. The page's own module script (imports stubbed, everything before its first network read) runs twice over one tab's sessionStorage: typing on the first load keeps the draft, and the second load (the cockpit's frame) fills Title/Brief/Source with it and says so. A hand-off that arrives later still replaces it. Before, the cockpit opened the review with empty fields.
 * -----------------------------------------------------------------------------
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'review.html'), 'utf8');
const moduleStart = html.indexOf('<script type="module">');
const body = html.slice(html.indexOf('{', html.indexOf('if (!window.AppView', moduleStart)) + 1, html.indexOf('await mountConnectedActions', moduleStart));

/** One load of the page's module script in a tab whose sessionStorage is `storage`. */
function load(storage) {
  const field = () => ({ value: '', listeners: [], addEventListener(type, fn) { this.listeners.push(fn); }, type(v) { this.value = v; this.listeners.forEach((fn) => fn()); } });
  const els = { '#title': field(), '#notes': field(), '#sourceUrl': field(), '#status': { textContent: '' } };
  let receive = null;
  const sessionStorage = { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); }, removeItem: (k) => { delete storage[k]; } };
  new Function('document', 'sessionStorage', 'receiveHandoff', body)({ querySelector: (sel) => els[sel] }, sessionStorage, (_spec, fn) => { receive = fn; });
  return { els, receive: (c) => receive(c) };
}

test('a typed brief is back when the cockpit opens the review page in the same tab', () => {
  const tab = {};
  const first = load(tab);
  first.els['#title'].type('Friday recap follow-up');
  first.els['#notes'].type('Check the missed ES fill before Monday.');
  const second = load(tab);
  assert.equal(second.els['#title'].value, 'Friday recap follow-up');
  assert.equal(second.els['#notes'].value, 'Check the missed ES fill before Monday.');
  assert.equal(second.els['#status'].textContent, 'Your unsent brief is back. Edit it before continuing.');
  second.receive({ title: 'Handed over', notes: 'From another app' });
  assert.equal(second.els['#notes'].value, 'From another app', 'a hand-off still replaces the kept draft');
  assert.equal(load(tab).els['#title'].value, 'Handed over', 'and the kept draft follows it');
});

test('a fresh tab or an emptied brief keeps nothing', () => {
  assert.equal(load({}).els['#notes'].value, '');
  const tab = {};
  const page = load(tab);
  page.els['#notes'].type('x');
  page.els['#notes'].type('');
  assert.deepEqual(tab, {});
});
