/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-31 12:00:00 | maintainer@emeraldcoastsystemsgroup.com     | Guards for the 1.6.0 passport export + email inputs: the size set is CLOSED (300/600 only — anything else must read null, or the export route becomes a free-form resizer) and the recipient validator refuses non-strings, header-injection shapes, and garbage. Plain node against the compiled routes/portrait-ops.js.
 */

'use strict';

const assert = require('node:assert');
const path = require('node:path');

const ops = require(path.join(__dirname, '..', 'routes', 'portrait-ops.js'));

module.exports = async function run() {
  // The sanctioned set is exactly {300, 600} — the invariant the routes lean on.
  assert.deepStrictEqual(Array.from(ops.PASSPORT_SIZES), [300, 600], 'sanctioned passport sizes');

  // passportSize: accepts both sizes, as number or string (query values arrive as strings).
  assert.strictEqual(ops.passportSize(300), 300);
  assert.strictEqual(ops.passportSize(600), 600);
  assert.strictEqual(ops.passportSize('300'), 300);
  assert.strictEqual(ops.passportSize(' 600 '), 600);

  // passportSize: everything else is null — no free-form resizing.
  for (const bad of [0, -300, 450, 1200, 299.5, '600x600', 'large', '', null, undefined, true, {}, [], [600], NaN, Infinity]) {
    assert.strictEqual(ops.passportSize(bad), null, `passportSize(${JSON.stringify(bad)}) must be null`);
  }

  // isValidEmailAddress: plausible single recipients pass.
  assert.ok(ops.isValidEmailAddress('name@example.com'));
  assert.ok(ops.isValidEmailAddress('  a@b.co  '), 'surrounding whitespace is trimmed');
  assert.ok(ops.isValidEmailAddress('first.last+tag@sub.domain.org'));

  // isValidEmailAddress: garbage, header-injection shapes, and non-strings are refused.
  for (const bad of [
    'no-at-sign.com', 'two@@ats.com', 'spaces in@local.com', 'a@nodot',
    'a@b.c\r\nBcc: x@y.com',            // CRLF — the header-injection shape
    '', '   ', 'a@b', '@example.com', 'name@',
    null, undefined, 42, true, {}, ['a@b.co'],
    'x'.repeat(250) + '@a.co',          // over the 254-char bound
  ]) {
    assert.ok(!ops.isValidEmailAddress(bad), `isValidEmailAddress(${JSON.stringify(bad)}) must be false`);
  }

  return 6; // check groups
};
