/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 6: after the person filled the review fields the connected
 *   actions asked for, the notice 'Nothing on this screen to hand on yet' stayed on screen. The shipped settleHandOnNotice
 *   (cut out of tools/finance.html and run) replaces it once title and evidence are both there, and touches no other
 *   status; the page wires it to input on both fields.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'finance.html'), 'utf8');
const NOTICE = html.match(/const NOTHING_TO_HAND_ON='([^']*)'/)[1];

function settle() {
  const a = html.indexOf('/* hand-on-notice:start */');
  const b = html.indexOf('/* hand-on-notice:end */');
  assert.ok(a > 0 && b > a, 'settleHandOnNotice is marked in the page');
  return new Function(html.slice(a, b) + '\nreturn settleHandOnNotice;')();
}

test('the stale notice clears once title and evidence are both filled', () => {
  const status = { textContent: NOTICE };
  settle()(status, { title: 'Rent vs savings', notes: '' });
  assert.equal(status.textContent, NOTICE, 'still incomplete: the notice stays');
  settle()(status, { title: 'Rent vs savings', notes: 'Rent is 40 % of take-home.' });
  assert.equal(status.textContent, 'Ready to hand on. Choose the action again.');
});

test('any other status is left alone', () => {
  const status = { textContent: 'Opening AI Office…' };
  settle()(status, { title: 't', notes: 'n' });
  assert.equal(status.textContent, 'Opening AI Office…');
  settle()(null, { title: 't', notes: 'n' });
});

test('the page listens for input on both review fields', () => {
  assert.match(html, /\['reviewTitle','reviewNotes'\]\.forEach\(id=>field\(id\)\.addEventListener\('input',\(\)=>settleHandOnNotice\(element\.querySelector\('\[role="status"\]'\),draft\(\)\)\)\)/);
});
