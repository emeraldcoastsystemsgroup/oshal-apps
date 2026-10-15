/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 14: the Projected starters table's Slot column printed ESPN's raw lineup slot ids
 *   ("0 Patrick Mahomes", "4 CeeDee Lamb", "4 Ja'Marr Chase"). The page's own startersCard, run as shipped in a sandbox over an
 *   optimiser answer, names each slot as ESPN does (QB, WR, FLEX, D/ST, K) and an unknown id as "Slot <id>".
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'tools', 'fantasy-football.html'), 'utf8');
const inline = () => [...HTML.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

function sandbox() {
  const node = () => ({ addEventListener() {}, setAttribute() {}, getAttribute: () => null, querySelectorAll: () => [], innerHTML: '', textContent: '', value: '', hidden: false, style: {} });
  const box = { document: { getElementById: node, querySelectorAll: () => [], addEventListener() {} }, console: { log() {}, warn() {}, error() {} }, fetch: () => new Promise(() => {}) };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(inline(), box, { filename: 'fantasy-football.html' });
  return box;
}

test('the Projected starters Slot column names each slot, never the raw ESPN id', () => {
  const page = sandbox();
  const starter = (slotId, name, points) => ({ slotId, player: { name }, points });
  const html = page.startersCard({ optimal: { starters: [starter(0, 'Patrick Mahomes', 22.1), starter(4, 'CeeDee Lamb', 18.4), starter(23, 'Flex Guy', 9), starter(16, 'Bills D/ST', 7), starter(17, 'Kicker', 8), starter(99, 'Future', 1)], bench: [] } });
  const slots = [...html.matchAll(/<tr><td class="muted">([^<]*)<\/td><td>([^<]*)<\/td>/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(slots, ['QB Patrick Mahomes', 'WR CeeDee Lamb', 'FLEX Flex Guy', 'D/ST Bills D/ST', 'K Kicker', 'Slot 99 Future']);
});
