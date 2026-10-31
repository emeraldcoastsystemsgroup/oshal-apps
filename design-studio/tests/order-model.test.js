/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D3 as built (0.4.0): the engine order's vocabulary is closed. No input can carry a URL or a path, and a phase closure, the bench and a printer are not orders.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const M = require(path.join(__dirname, '..', 'routes', 'order-model.js'));

const refused = (body) => { try { M.validateOrder(body); } catch (e) { return { code: e.code, field: e.field }; } return null; };

test('every action validates, reduced to the fields it reads', () => {
  assert.deepEqual(M.validateOrder({ action: 'open', input: { url: 'http://elsewhere' } }), { action: 'open', input: {} });
  assert.deepEqual(M.validateOrder({ action: 'read', input: { what: 'cad-contract', url: 'http://elsewhere' } }), { action: 'read', input: { what: 'cad-contract' } });
  assert.deepEqual(M.validateOrder({ action: 'read', input: { what: 'cad-model', modelId: 'abc-1' } }).input, { what: 'cad-model', modelId: 'abc-1' });
  assert.equal(M.validateOrder({ action: 'cad-create', input: { name: 'Hook', base: { kind: 'box' } } }).input.features.length, 0);
  assert.equal(M.validateOrder({ action: 'cad-edit', input: { modelId: 'm1', op: 'remove', featureId: 'f1' } }).input.featureId, 'f1');
  assert.equal(M.validateOrder({ action: 'circuit-create', input: { example: 'hexapod-power' } }).input.example, 'hexapod-power');
  assert.equal(M.validateOrder({ action: 'circuit-edit', input: { designId: 'd1', op: 'run' } }).input.op, 'run');
  assert.equal(M.validateOrder({ action: 'press', input: { phase: 'simulate', button: 'Certify' } }).input.button, 'Certify');
});

test('anything outside the vocabulary is refused by name', () => {
  assert.deepEqual(refused({ action: 'fetch', input: {} }), { code: 'bad_order', field: 'action' });
  assert.deepEqual(refused({ action: 'read', input: { what: '/api/identity/people' } }), { code: 'bad_order', field: 'input.what' });
  assert.deepEqual(refused({ action: 'read', input: { what: 'cad-model', modelId: '../../etc' } }), { code: 'bad_order', field: 'input.modelId' });
  assert.deepEqual(refused({ action: 'cad-create', input: { name: 'x' } }), { code: 'bad_order', field: 'input.base' });
  assert.deepEqual(refused({ action: 'circuit-edit', input: { designId: 'd1', op: 'drop_table' } }), { code: 'bad_order', field: 'input.op' });
});

test('closing a phase, the bench and a printer stay the person\'s', () => {
  for (const button of ['Close the phase', 'Confirm the brief', 'Start the build', 'Send to printer']) {
    assert.deepEqual(refused({ action: 'press', input: { phase: 'fabricate', button } }), { code: 'bad_order', field: 'input.button' }, button);
  }
});
