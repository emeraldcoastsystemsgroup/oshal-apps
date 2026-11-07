/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (print-ingest--print-ingest, P2): the selected tab was accent-filled like a second primary, the printed text sat in a heading, 'MEDIUM' was shouted, 'Readable by...' repeated on every row, Approve fell below the fold on a phone and the page repeated the shell's title. The page's own functions in a sandbox: Match words, one readers line for a group, the editable title as the heading with a 3-line excerpt, the selected tab's count; the CSS keeps the selected tab off the accent and the actions sticky on a phone.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
function extract(name) {
  const start = html.search(new RegExp(`function ${name}\\(`));
  assert.ok(start >= 0, name);
  let depth = 0;
  for (let i = html.indexOf('{', html.indexOf(')', start)); i < html.length; i += 1) {
    if (html[i] === '{') depth += 1; else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error('never closed');
}
const tabs = [{ dataset: { state: 'awaiting_approval' }, c: { textContent: '' } }, { dataset: { state: '' }, c: { textContent: '' } }];
tabs.forEach((t) => { t.querySelector = () => t.c; });
const sb = { document: { querySelectorAll: () => tabs } };
vm.createContext(sb);
vm.runInContext(['esc', 'matchWords', 'destinationRow', 'destinationGroup', 'showCount'].map(extract).join('\n') +
  '\nglobalThis.t = { matchWords, destinationGroup, showCount };', sb);

test('confidence reads as sentence-case Match words with a tooltip', () => {
  assert.equal(sb.t.matchWords('MEDIUM'), 'Match: medium');
  assert.match(html, /class="conf" title="how well the text matches this destination"/);
  assert.doesNotMatch(html, /\.conf \{[^}]*text-transform: uppercase/);
});

test('Readable by is said once under a group whose destinations share their readers', () => {
  const same = sb.t.destinationGroup([{ id: 'a', label: 'A', confidence: 'HIGH', reason: 'r', readableBy: 'the named readers' }, { id: 'b', label: 'B', confidence: 'LOW', reason: 'r', readableBy: 'the named readers' }]);
  assert.equal((same.match(/Readable by/g) || []).length, 1);
  const mixed = sb.t.destinationGroup([{ id: 'a', label: 'A', readableBy: 'one' }, { id: 'b', label: 'B', readableBy: 'two' }]);
  assert.equal((mixed.match(/Readable by/g) || []).length, 2);
});

test('the selected tab carries its count, is inverted ink not the accent, and the page names itself only for screen readers', () => {
  sb.t.showCount('awaiting_approval', 3);
  assert.equal(tabs[0].c.textContent, '3');
  assert.equal(tabs[1].c.textContent, '');
  assert.match(html, /\.tab\[aria-selected="true"\] \{ background: var\(--ink\); border-color: var\(--ink\); color: var\(--bg\); \}/);
  assert.match(html, /<h1 class="sr-only">Print Inbox<\/h1>/);
});

test('the editable title is the heading, the printed text a 3-line excerpt, and Approve stays in view on a phone', () => {
  assert.match(html, /'<input class="title-edit heading" value="'/);
  assert.match(html, /'<p class="excerpt" tabindex="0" title="Show the whole text">'/);
  assert.match(html, /\.excerpt \{[^}]*-webkit-line-clamp: 3/);
  assert.match(html, /@media \(max-width: 640px\) \{\s*\.doc \.actions \{ position: sticky; bottom: 0;/);
});
