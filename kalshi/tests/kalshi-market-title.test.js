/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 8: scan rows showed 'Will average **gas prices** be above $5.4900?' because the row printed the escaped title as text. The guard EXECUTES the shipped marketTitle() out of the surface: a bold pair renders bold, a stray marker is dropped, markup in a title stays escaped, and both places that print a market title use it.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'kalshi.html'), 'utf8');

/** marketTitle cut out of the shipped surface, with an escaper equal to the page's textContent/innerHTML round trip. */
function marketTitle() {
  const line = html.match(/^\s*function marketTitle\(t\) \{.*\}$/m);
  assert.ok(line, 'marketTitle is not in the surface');
  const sandbox = { esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') };
  vm.createContext(sandbox);
  new vm.Script(`${line[0]}\nglobalThis.__f = marketTitle;`).runInContext(sandbox);
  return sandbox.__f;
}

test('a markdown-bold market title shows bold words and no asterisks', () => {
  const f = marketTitle();
  assert.equal(f('Will average **gas prices** be above $5.4900?'), 'Will average <strong>gas prices</strong> be above $5.4900?');
  assert.equal(f('Odd ** marker'), 'Odd  marker');
  assert.equal(f('**<img src=x>**'), '<strong>&lt;img src=x&gt;</strong>');
  assert.equal(f(null), '');
});

test('the scan row and the order dialog print titles through marketTitle', () => {
  assert.match(html, /'<td><div class="title">' \+ marketTitle\(h\.title\) \+ '<\/div>/);
  assert.match(html, /'<\/b> · ' \+ marketTitle\(h\.title\) \+/);
  assert.doesNotMatch(html, /esc\(h\.title\)/);
});
