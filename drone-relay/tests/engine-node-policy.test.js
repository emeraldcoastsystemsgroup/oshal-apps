/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The on-board rule in isolation: battery wins over everything, a good inner link holds, a silent inner link waits the detect window then shifts inward, stops after one hop, and flies home after the RTL window; the outer link never moves a relay.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { decideLocal } = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));

const base = { innerLinkOk: true, innerLostForS: 0, movedInwardM: 0, hopM: 200, remainingS: 400, returnTimeS: 100, reserveS: 90, detectS: 4, rtlAfterS: 60 };

test('battery first, then the inner link, never the outer', () => {
  assert.deepEqual(decideLocal(base), { action: 'hold', reason: 'nominal' });
  assert.deepEqual(decideLocal({ ...base, remainingS: 190 }), { action: 'rtl', reason: 'battery' });
  assert.deepEqual(decideLocal({ ...base, remainingS: 191 }), { action: 'hold', reason: 'nominal' });
  assert.deepEqual(decideLocal({ ...base, innerLinkOk: false, innerLostForS: 3 }), { action: 'hold', reason: 'nominal' });
  assert.deepEqual(decideLocal({ ...base, innerLinkOk: false, innerLostForS: 4 }), { action: 'shift-in', reason: 'inner-link-silent' });
  assert.deepEqual(decideLocal({ ...base, innerLinkOk: false, innerLostForS: 30, movedInwardM: 199 }), { action: 'shift-in', reason: 'inner-link-silent' });
  assert.deepEqual(decideLocal({ ...base, innerLinkOk: false, innerLostForS: 30, movedInwardM: 200 }), { action: 'hold', reason: 'shifted-one-hop' });
  assert.deepEqual(decideLocal({ ...base, innerLinkOk: false, innerLostForS: 60, movedInwardM: 200 }), { action: 'rtl', reason: 'inner-link-timeout' });
  assert.deepEqual(decideLocal({ ...base, innerLinkOk: false, innerLostForS: 60, remainingS: 100 }), { action: 'rtl', reason: 'battery' }, 'battery outranks the link timeout');
});
