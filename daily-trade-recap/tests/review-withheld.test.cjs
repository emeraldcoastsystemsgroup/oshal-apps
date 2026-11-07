/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Regression for the UX audit 2026-11-05 (recap-review, D, FIX-BROKEN): after Title, Brief and Source link were filled no hand-off button ever rendered, so the brief could be neither saved nor sent. Cause: the cockpit's shared mountConnectedActions (kernel 5174083d, /cockpit/js/app-workflows.js change log 5) turns cross-app continuation off for every application: it empties its container, sets hidden and display:none, and offers nothing. The page now withholds the brief form whenever no action mounted, and no row offers "Use this evidence". The rules run as shipped (the page module's pure part, before its first network read); the mount runs with that kernel function's exact effect on a filled brief.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | @ux-career's shape (board 08:15:14Z): the brief starts hidden, the mount sits in a try so a failed mount still withholds it, and an offer counts only when the container holds a button or a link.
 * -----------------------------------------------------------------------------
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'review.html'), 'utf8');
const moduleStart = html.indexOf('<script type="module">');
const pure = html.slice(html.indexOf('{', html.indexOf('if (!window.AppView', moduleStart)) + 1, html.indexOf('try{await mountConnectedActions', moduleStart));
const afterMount = html.slice(html.indexOf('try{await mountConnectedActions', moduleStart));

/** The page module's pure rules, with the same stubs the draft test uses for everything before the first read. */
function rules() {
  const field = () => ({ value: '', addEventListener() {} });
  const els = { '#title': field(), '#notes': field(), '#sourceUrl': field(), '#status': { textContent: '' } };
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const api = new Function('document', 'sessionStorage', 'receiveHandoff', `${pure}\nreturn { briefOffered, shownMetrics, quietWeek, COUNTING, NO_SESSION };`)(
    { querySelector: (sel) => els[sel] }, storage, () => {});
  return Object.assign(api, { els });
}

/** What the kernel's mountConnectedActions does to its container today (app-workflows.js, change log 5). */
function kernelMount(element) {
  element.children.length = 0;
  element.hidden = true;
  element.style.display = 'none';
}

test('a filled brief with no connected action mounted is withheld, not left stranded', () => {
  const r = rules();
  const actions = { hidden: false, style: { display: 'flex' }, children: { length: 0 }, querySelector: () => null };
  r.els['#title'].value = 'Friday recap follow-up';
  r.els['#notes'].value = 'Check the missed ES fill before Monday.';
  r.els['#sourceUrl'].value = 'https://example.org/recap';
  kernelMount(actions);
  assert.equal(r.briefOffered(actions), false);
  assert.equal(r.briefOffered({ hidden: false, style: { display: 'flex' }, querySelector: (sel) => (sel === 'button,a' ? {} : null) }), true, 'an offer that mounts a button keeps the brief');
  assert.equal(r.briefOffered({ hidden: false, style: { display: 'flex' }, querySelector: () => null }), false, 'a container with no button or link offers nothing');
  assert.match(afterMount, /const offered=briefOffered\(document\.querySelector\('\.connected-app-actions'\)\);/);
  assert.match(afterMount, /\{const brief=document\.querySelector\('#brief'\),layout=document\.querySelector\('\.layout'\);if\(brief\)brief\.hidden=!offered;/);
  assert.match(html.slice(moduleStart), /try\{await mountConnectedActions\(/, 'a failed mount still withholds the brief');
  assert.match(afterMount, /if\(context&&offered\)\{const b=document\.createElement\('button'\);/, 'no row fills a withheld brief');
  assert.match(html, /<section class="panel" id="brief" hidden><h2>Your next brief<\/h2>/, 'the brief starts hidden: no form flashes before the mount answers');
});

test('counters show only tiles with data, and a week with no session is one empty state with Open Trading', () => {
  const r = rules();
  const metrics = [{ id: 'trading-sessions', value: '0' }, { id: 'recaps-recorded', value: '0' }, { id: 'recaps-missed', value: 'Unavailable' }, { id: 'recaps-awaiting-review', value: '2' }];
  assert.deepEqual(r.shownMetrics(metrics).map((m) => m.id), ['recaps-missed', 'recaps-awaiting-review']);
  assert.equal(r.quietWeek({ metrics }, 0), true);
  assert.equal(r.quietWeek({ metrics }, 1), false, 'a parked ticket row is not an empty week');
  assert.equal(r.quietWeek({ metrics: [{ id: 'trading-sessions', value: '3' }] }, 0), false);
  assert.match(afterMount, /h\.textContent='No trading sessions this week'/);
  assert.match(afterMount, /a\.href='\/cockpit\/\?app=intelligent-trades';a\.target='_top';a\.textContent='Open Trading'/);
});

test('the counting rules are help under the records, not a paragraph in the work', () => {
  const r = rules();
  assert.ok(r.COUNTING.test('Counts exact-owner Eastern trading days: sessions recorded by the trading schedule'));
  assert.ok(r.NO_SESSION.test("No trading session recorded in the last 7 days. Sessions come from Intelligent Trades' schedule"));
  assert.match(afterMount, /s\.textContent='How these are counted'/);
});
