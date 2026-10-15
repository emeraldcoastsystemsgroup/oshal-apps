/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Sweep 7: the Shopping Concierge printed its reply's Markdown raw ('configured with the status: **NO WALMART RAIL**'). Runs the page's own showReply (tools/shopping-chat.html) with the shared kit's renderer: the reply's Markdown becomes markup through SimpleChat.renderMarkdown, without the kit it stays text, sendChat uses it, and the page loads the kit.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'tools', 'shopping-chat.html'), 'utf8');
const SHOW = HTML.match(/function showReply\(node, text\) \{[\s\S]*?\n\}\n/)[0];

function run(kit) {
  const node = { textContent: '', innerHTML: '', classes: [], classList: { add(c) { node.classes.push(c); } } };
  const window = { SimpleChat: kit };
  const $ = () => ({ scrollTop: 0, scrollHeight: 10 });
  new Function('window', '$', 'node', `${SHOW}\nshowReply(node, 'Walmart is configured with the status: **NO WALMART RAIL**');`)(window, $, node);
  return node;
}

test('a reply renders through the shared escape-first renderer', () => {
  const seen = [];
  const node = run({ renderMarkdown: (t) => { seen.push(t); return '<p>Walmart is configured with the status: <strong>NO WALMART RAIL</strong></p>'; } });
  assert.deepEqual(seen, ['Walmart is configured with the status: **NO WALMART RAIL**']);
  assert.match(node.innerHTML, /<strong>NO WALMART RAIL<\/strong>/);
  assert.deepEqual(node.classes, ['md']);
});

test('without the kit the reply stays plain text, never injected HTML', () => {
  const node = run(undefined);
  assert.equal(node.innerHTML, '');
  assert.equal(node.textContent, 'Walmart is configured with the status: **NO WALMART RAIL**');
});

test('sendChat shows the reply through showReply, and the page loads the kit once', () => {
  const send = HTML.match(/async function sendChat\(\) \{[\s\S]*?\n\}\n/)[0];
  assert.match(send, /showReply\(pending, result\.reply/);
  assert.doesNotMatch(send, /pending\.textContent = result\.reply/);
  assert.equal(HTML.split('<script src="/shared/ui/js/simple-chat.js"></script>').length, 2);
});
