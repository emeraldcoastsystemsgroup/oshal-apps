/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-31 12:00:00 | maintainer@emeraldcoastsystemsgroup.com     | Guards for the 1.6.0 passport export + email inputs: the size set is CLOSED (300/600 only — anything else must read null, or the export route becomes a free-form resizer) and the recipient validator refuses non-strings, header-injection shapes, and garbage. Plain node against the compiled routes/portrait-ops.js.
 * 2026-08-31 16:00:00 | maintainer@emeraldcoastsystemsgroup.com     | 1.7.0: passportSize → exportFormat over the closed EXPORT_FORMATS catalog. The spec pins the exact catalog (keys AND pixel geometry — 300/600 squares, portrait 1200×1800, landscape 1800×1200) so a drive-by "add a size" or dimension edit goes red here first.
 */

'use strict';

const assert = require('node:assert');
const path = require('node:path');

const ops = require(path.join(__dirname, '..', 'routes', 'portrait-ops.js'));

module.exports = async function run() {
  // The catalog is exactly these four formats with exactly this geometry — the invariant
  // the export/email routes lean on. Change the catalog and this contract together.
  assert.deepStrictEqual(
    Object.fromEntries(Object.entries(ops.EXPORT_FORMATS).map(([k, v]) => [k, { width: v.width, height: v.height }])),
    {
      '300': { width: 300, height: 300 },
      '600': { width: 600, height: 600 },
      portrait: { width: 1200, height: 1800 },
      landscape: { width: 1800, height: 1200 },
    },
    'sanctioned export formats',
  );

  // exportFormat: accepts every catalog key, as string or number, trimmed, case-insensitive.
  assert.strictEqual(ops.exportFormat(300).width, 300);
  assert.strictEqual(ops.exportFormat('600').height, 600);
  assert.deepStrictEqual(
    { w: ops.exportFormat(' Portrait ').width, h: ops.exportFormat(' Portrait ').height },
    { w: 1200, h: 1800 },
  );
  assert.deepStrictEqual(
    { w: ops.exportFormat('LANDSCAPE').width, h: ops.exportFormat('LANDSCAPE').height },
    { w: 1800, h: 1200 },
  );
  assert.strictEqual(ops.exportFormat('600').key, '600');

  // exportFormat: everything else is null — no free-form resizing, no prototype tricks.
  for (const bad of [0, -300, 450, 1200, 299.5, '600x600', 'square', 'wide', '', ' ', null, undefined, true, {}, [], [600], NaN, Infinity, 'toString', '__proto__', 'constructor']) {
    assert.strictEqual(ops.exportFormat(bad), null, `exportFormat(${JSON.stringify(bad)}) must be null`);
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
