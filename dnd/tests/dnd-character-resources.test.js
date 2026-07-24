/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 23:30:56 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove spent spell slots lock leveled spells while cantrips and weapons remain available.
 */

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

global.esc = (value) => String(value);

const {
  actionResourceStatus,
  inventoryOf,
  spellSlotRows,
} = require('../ui/table-character-sheet');

const fenwick = { slots: { 1: 0 } };
const magicMissile = { name: 'Magic Missile', type: 'spell', slot: 1 };
const burningHands = { name: 'Burning Hands', type: 'spell', slot: 1 };
const fireBolt = { name: 'Fire Bolt', type: 'spell', level: 0 };
const dagger = { name: 'Dagger', type: 'weapon' };

test('zero level-one slots lock both Magic Missile and Burning Hands', () => {
  for (const action of [magicMissile, burningHands]) {
    const status = actionResourceStatus(fenwick, action);
    assert.equal(status.available, false);
    assert.equal(status.label, 'SPENT');
    assert.equal(status.detail, 'No level-1 slots remaining');
  }
});

test('cantrips and weapons remain ready after leveled spells are spent', () => {
  assert.deepEqual(actionResourceStatus(fenwick, fireBolt),
    { available: true, label: 'READY', detail: 'Cantrip · unlimited' });
  assert.deepEqual(actionResourceStatus(fenwick, dagger),
    { available: true, label: 'READY', detail: 'At will' });
});

test('the character view shows current slots against full potential', () => {
  const rows = spellSlotRows(fenwick, { slots: { 1: 2 } });
  assert.match(rows, /Level 1/);
  assert.match(rows, /0 \/ 2/);
  assert.match(rows, /spent until recovery/);
});

test('actual inventory includes sheet weapons without duplicating recorded gear', () => {
  const inventory = inventoryOf({
    inventory: { items: [{ name: 'Dagger', category: 'weapon', actionId: 'dagger' }] },
    actions: [{ id: 'dagger', name: 'Dagger', type: 'weapon' }, { id: 'staff', name: 'Staff', type: 'weapon' }],
  });
  assert.deepEqual(inventory.items.map((item) => item.name), ['Dagger', 'Staff']);
});
