/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 13: with sweep13-iss (#25544) in the catalog, the concierge answered
 *   "ID in the field is sat-1: sweep13-iss": the empty register form came prefilled with value "sat-1" under an unattached
 *   "sat id" label, so the screen read as a satellite id. The new-satellite field starts empty under its own label, and
 *   Register TLE with no id still refuses (the page's own handler, run as shipped over a stub DOM).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'sat-ops.html'), 'utf8');

test('the register form starts empty under a label naming it as a new satellite', () => {
  const input = /<input id="catId"[^>]*>/.exec(html);
  assert.ok(input, 'the sat id field is on the page');
  assert.doesNotMatch(input[0], /\bvalue=/, 'no prefilled id reads as a satellite on screen');
  assert.match(html, /<label for="catId">New satellite id<\/label>/);
  assert.match(html, /<label for="catTle">two-line element set/);
});

test('Register TLE with the empty field still refuses and sends nothing', async () => {
  const start = html.indexOf("$('catAdd').onclick = async () => {");
  const end = html.indexOf('\n};', start) + 3;
  assert.ok(start > 0 && end > start);
  const els = { catAdd: {}, catId: { value: '' }, catTle: { value: '1 25544U ...\n2 25544 ...' } };
  const toasts = [], calls = [];
  new Function('$', 'toast', 'api', 'refreshCatalog', html.slice(start, end))((id) => els[id], (m, bad) => toasts.push([m, bad]), async (...a) => { calls.push(a); }, async () => {});
  await els.catAdd.onclick();
  assert.deepEqual(toasts, [['sat id and TLE are required', true]]);
  assert.equal(calls.length, 0);
});
