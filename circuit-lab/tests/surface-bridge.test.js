/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the assistant rail under plain node: the manifest
 *                     |                             | declares surface.ops [context, custom, notify] (without them the
 *                     |                             | cockpit relay is fail-closed) and jarvisMode: delegate on the
 *                     |                             | concierge; the page loads the shared bridge client, publishes a
 *                     |                             | `context` op named `schematic` / `breadboard` with the
 *                     |                             | `circuit_action` vocabulary under the contract's 600-character
 *                     |                             | cap, answers `request_context`, and its digest builder stays
 *                     |                             | under the contract's 4000-character cap on a 200-part circuit.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PKG = path.resolve(__dirname, '..');
const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
const page = fs.readFileSync(path.join(PKG, 'tools', 'circuit-lab.html'), 'utf8');
const script = fs.readFileSync(path.join(PKG, 'tools', 'circuit-lab.js'), 'utf8');

test('the manifest declares the surface-bridge ops and delegate mode — without them the relay is fail-closed and Jarvis only deep-links', () => {
  const block = manifest.match(/^surface:\s*\n\s*ops:\s*\[([^\]]*)\]/m);
  assert.ok(block, 'no `surface: ops:` block — the cockpit relay forwards NOTHING for this app');
  const ops = block[1].split(',').map((s) => s.trim());
  for (const op of ['context', 'custom', 'notify']) assert.ok(ops.includes(op), `surface.ops missing ${op}`);
  for (const op of ops) assert.ok(['render_options', 'set_field', 'set_content', 'propose', 'navigate', 'notify', 'custom', 'select', 'field_change', 'submit', 'event', 'context'].includes(op), `${op} is not a surface-bridge op`);
  assert.match(manifest, /name: circuit-lab-engineer[\s\S]*?jarvisMode: delegate/, 'the concierge is delegate mode');
});

test('the page loads the shared bridge client, publishes context with the circuit_action vocabulary and answers request_context', () => {
  assert.match(page, /import\('\/shared\/ui\/js\/surface-bridge-client\.js'\)/, 'the shared client, not a hand-rolled postMessage');
  assert.match(page, /createSurfaceBridgeClient\(\{ app: 'circuit-lab' \}\)/, 'the app binding');
  assert.match(page, /data-bridge-host="notices"/, 'a notices host for notify');
  assert.match(script, /emitContext\(\{/);
  assert.match(script, /surface: state\.view === 'board' \? 'breadboard' : 'schematic'/);
  assert.match(script, /can: \['custom', 'notify'\]/);
  assert.match(script, /customOps: \[\{ name: 'circuit_action', description: ACTION_DOC \}\]/);
  assert.match(script, /detail\.name === 'request_context'/);
  assert.match(script, /detail\.name !== 'circuit_action'/);
  const doc = /const ACTION_DOC = '([^\n]*)';/.exec(script);
  assert.ok(doc, 'ACTION_DOC is a single-line literal');
  assert.ok(doc[1].length <= 600, `the contract caps a customOps description at 600 characters (${doc[1].length})`);
  for (const op of ['add_part', 'update_part', 'remove_part', 'connect', 'disconnect', 'run', 'restore', 'open_example', 'select', 'view']) {
    assert.ok(doc[1].includes(`"op":"${op}"`), `vocabulary names ${op}`);
    assert.ok(new RegExp(`case '${op}'|a\\.op === '${op}'`).test(script), `the handler applies ${op}`);
  }
  assert.match(script, /window\.addEventListener\('bridge-ready', publishContext\)/, 'republish once the module client is ready');
  assert.match(script, /'Jarvis made '/, 'the person is told what Jarvis changed');
});

test('the digest builder stays under the 4000-character cap on a 200-part circuit', () => {
  // Run the page's marked helpers in a VM with a fake state: partBrief + contextDigest are pure.
  const start = script.indexOf('  function partBrief(p) {');
  const end = script.indexOf('  function publishContext() {');
  assert.ok(start > 0 && end > start, 'the digest helpers are where the guard expects them');
  const helpers = script.slice(start, end);
  const parts = Array.from({ length: 200 }, (_, i) => ({ id: 'R' + i, type: 'resistor', props: { ohms: 1000 + i, ratedWatts: 0.25 } }));
  const wires = Array.from({ length: 199 }, (_, i) => ({ id: 'w' + i, from: { part: 'R' + i, pin: 'b' }, to: { part: 'R' + (i + 1), pin: 'a' } }));
  const readings = parts.map((p) => ({ id: p.id, type: 'resistor', ampsFinal: 0.001, voltsFinal: 1, wattsAvg: 0.001, overRated: false }));
  const ctx = { state: { design: { title: 'Big', parts, wires, run_count: 3, state: 'ran', sim: { stopSeconds: 1 } }, view: 'schematic', report: { readings, warnings: [{ message: 'R7.a is not connected' }] }, selection: { kind: 'part', id: 'R7' } },
    summary: (r) => `${r.ampsFinal} A`, DIGEST_CAP: 3900 };
  vm.createContext(ctx);
  vm.runInContext(helpers + '\nthis.digest = contextDigest();', ctx);
  assert.ok(ctx.digest.length <= 4000, `digest ${ctx.digest.length} chars — over the cap the whole context op is dropped`);
  assert.match(ctx.digest, /^Big: 200 parts, 199 wires, solved \(run 3\)/);
  assert.match(ctx.digest, /…\(truncated\)$/);
  ctx.state.design = { title: 'Small', parts: parts.slice(0, 2), wires: wires.slice(0, 1), run_count: 0, state: 'draft', sim: { stopSeconds: 0.5 } };
  ctx.state.report = null; ctx.state.selection = null;
  vm.runInContext('this.digest = contextDigest();', ctx);
  assert.match(ctx.digest, /Parts: R0 resistor \(ohms=1000 ratedWatts=0\.25\); R1 resistor/);
  assert.match(ctx.digest, /Wires: w0 R0\.b-R1\.a/);
  assert.doesNotMatch(ctx.digest, /Readings:/);
});
