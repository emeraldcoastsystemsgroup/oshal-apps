/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-24 02:32:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Guard-per-fix for the 2026-07-24 operator directive (career automation must be explicit opt-in, default OFF): proves the gate DENIES when the setting is absent, false, or anything short of an explicit true — the regression this guard exists to catch is automation firing for a user who never opted in. node:test (store repo has no vitest runner). Run: node --test career-hunter/lib/automation-gate.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { autoGenerateAllowed, autoSubmitAllowed } = require('./automation-gate.js');

test('DEFAULT-DENY: absent settings row means automation is OFF', () => {
  assert.equal(autoGenerateAllowed(undefined), false);
  assert.equal(autoGenerateAllowed(null), false);
  assert.equal(autoSubmitAllowed(undefined), false);
  assert.equal(autoSubmitAllowed(null), false);
});

test('DEFAULT-DENY: empty or unrelated row means automation is OFF', () => {
  assert.equal(autoGenerateAllowed({}), false);
  assert.equal(autoSubmitAllowed({}), false);
  assert.equal(autoGenerateAllowed({ user_sub: 'x' }), false);
  assert.equal(autoSubmitAllowed({ user_sub: 'x' }), false);
});

test('explicit false stays OFF', () => {
  assert.equal(autoGenerateAllowed({ auto_generate: false }), false);
  assert.equal(autoSubmitAllowed({ auto_submit: false }), false);
  assert.equal(autoGenerateAllowed({ auto_generate: 'f' }), false);
  assert.equal(autoSubmitAllowed({ auto_submit: 'false' }), false);
});

test('near-misses and truthy garbage are NOT an opt-in', () => {
  for (const v of [1, 'yes', 'on', 'TRUE', 'True', ' true', {}, [], 'enabled']) {
    assert.equal(autoGenerateAllowed({ auto_generate: v }), false, `auto_generate ${JSON.stringify(v)}`);
    assert.equal(autoSubmitAllowed({ auto_submit: v }), false, `auto_submit ${JSON.stringify(v)}`);
  }
});

test('only an explicit true (or pg text t/true) opts in', () => {
  assert.equal(autoGenerateAllowed({ auto_generate: true }), true);
  assert.equal(autoGenerateAllowed({ auto_generate: 't' }), true);
  assert.equal(autoGenerateAllowed({ auto_generate: 'true' }), true);
  assert.equal(autoSubmitAllowed({ auto_submit: true }), true);
});

test('the two flags are independent — drafts opt-in does not enable submissions', () => {
  const row = { auto_generate: true, auto_submit: false };
  assert.equal(autoGenerateAllowed(row), true);
  assert.equal(autoSubmitAllowed(row), false);
  const rowSubmitOnly = { auto_generate: false, auto_submit: true };
  assert.equal(autoGenerateAllowed(rowSubmitOnly), false);
  assert.equal(autoSubmitAllowed(rowSubmitOnly), true);
});
