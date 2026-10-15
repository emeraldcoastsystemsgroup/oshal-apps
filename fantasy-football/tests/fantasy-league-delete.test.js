/**
 * Guard for deleting a hand-typed league on the served surface, tools/fantasy-football.html.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Sweep 6: league delete fired on one click with no confirmation, and
 *                     |                             | the deleted league's board ('Trades both sides gain from · My team')
 *                     |                             | stayed on screen under an empty list. The page's own script, run in
 *                     |                             | a sandbox: delete asks first and sends nothing on Cancel; on OK it
 *                     |                             | deletes and clears that league's board; another league's board
 *                     |                             | stays; a refused delete says so and keeps the board.
 */

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'tools', 'fantasy-football.html'), 'utf8');
const inline = () => [...HTML.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

/** The page's script in a sandbox with a recording fetch and a scripted confirm. */
function page({ confirmed, status = 200 }) {
  const nodes = {};
  const node = (id) => (nodes[id] = nodes[id] || {
    addEventListener() {}, setAttribute() {}, getAttribute: () => null, querySelectorAll: () => [],
    innerHTML: '', textContent: '', value: '', hidden: false, style: {},
  });
  const calls = [];
  const asked = [];
  const sandbox = {
    document: { getElementById: node, querySelectorAll: () => [], addEventListener() {} },
    console: { log() {}, warn() {}, error() {} },
    confirm: (q) => { asked.push(q); return confirmed; },
    fetch: (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET' });
      if ((init.method || 'GET') === 'DELETE') return Promise.resolve({ ok: status < 400, status, text: async () => '{}' });
      return new Promise(() => {});
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(inline(), sandbox, { filename: 'fantasy-football.html' });
  return { sandbox, nodes, calls, asked };
}

/** Put league `id`'s trade board on screen the way the page does (loadBoard), then the route's answer. */
function showBoard(p, id) {
  p.sandbox.loadBoard('manual', '2026', id, 'trades');
  p.nodes.lineupBody.innerHTML = '<div class="card"><h2>Trades both sides gain from &middot; My team</h2></div>';
}

test('Cancel sends no DELETE and keeps the board', async () => {
  const p = page({ confirmed: false });
  showBoard(p, 'L1');
  assert.equal(await p.sandbox.dropManualLeague('L1', 'sweep6 league'), false);
  assert.deepEqual(p.asked, ['Delete the league "sweep6 league"? This cannot be undone.']);
  assert.equal(p.calls.filter((c) => c.method === 'DELETE').length, 0);
  assert.match(p.nodes.lineupBody.innerHTML, /Trades both sides gain from/);
});

test('OK deletes the league and clears its board from the screen', async () => {
  const p = page({ confirmed: true });
  showBoard(p, 'L1');
  assert.equal(await p.sandbox.dropManualLeague('L1', 'sweep6 league'), true);
  assert.ok(p.calls.some((c) => c.method === 'DELETE' && /\/manual-leagues\/L1$/.test(c.url)));
  assert.equal(p.nodes.lineupBody.innerHTML, '', 'the deleted league\'s board is gone');
});

test('deleting another league keeps the board on screen', async () => {
  const p = page({ confirmed: true });
  showBoard(p, 'L1');
  await p.sandbox.dropManualLeague('L2', 'other');
  assert.match(p.nodes.lineupBody.innerHTML, /Trades both sides gain from/);
});

test('a refused delete says so and keeps the board', async () => {
  const p = page({ confirmed: true, status: 500 });
  showBoard(p, 'L1');
  assert.equal(await p.sandbox.dropManualLeague('L1', 'sweep6 league'), false);
  assert.match(p.nodes.mNote.textContent, /could not be deleted \(500\)\. Nothing was removed\./);
  assert.match(p.nodes.lineupBody.innerHTML, /Trades both sides gain from/);
});
