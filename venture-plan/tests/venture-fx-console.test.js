/**
 * Venture Plan — exact FX Evidence Console unit & parity guards.
 *
 * Verifies:
 * 1. `parseDecimalToNanos` parses decimal strings into exact integer nano-units
 *    (1e-9) with zero floating-point error, rejecting negatives, zero, NaN,
 *    scientific notation, non-numeric input, >9 decimal places, and overflow.
 * 2. `formatNanosAsRate` round-trips exact nano-rates cleanly.
 * 3. `convertMicrosPreview` matches the compiled backend `routes/venture-currency.js`
 *    `convertCurrencyMicros` to the exact integer micro across known values,
 *    sub-cent BOM costs, and signed half-up-away-from-zero ties.
 * 4. `safeHttpUrl` and `parseSourceRefParts` allow only `http:`/`https:` links
 *    and neutralize `javascript:` / `data:` payloads to plain text.
 * 5. The inline FX helper block inside `tools/venture.html` agrees bit-for-bit
 *    with `tools/venture-fx-console.js` across every test vector.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial unit and backend-parity guards for 1.5.6 FX Evidence Console helpers.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { engine } = require('./fixture-venture');

const fxUi = require('../tools/venture-fx-console.js');
const fxBackend = engine('venture-currency');

function loadInlineFxHelpers() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'venture.html'), 'utf8');
  const start = html.indexOf('/* ═══ fx helpers (parity-tested against tools/venture-fx-console.js) ═══ */');
  const end = html.indexOf('/* ═══ end fx helpers ═══');
  assert.ok(start >= 0 && end > start, 'tools/venture.html contains delimited fx helpers block');
  const block = html.slice(start, end);
  const group = (whole) => String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return new Function('group', `${block}\nreturn {
    parseDecimalToNanos, formatNanosAsRate, parseDecimalToMicros,
    convertMicrosPreview, formatCurrencyMicros, safeHttpUrl,
    buildFxSourceRef, parseSourceRefParts, filterSnapshotsForPair, makeFxIdempotencyKey
  };`)(group);
}

const inlineFx = loadInlineFxHelpers();

test('parseDecimalToNanos parses exact decimal strings with zero float drift', () => {
  const vectors = [
    ['1.085', 1_085_000_000],
    ['0.138', 138_000_000],
    ['1', 1_000_000_000],
    ['1.0', 1_000_000_000],
    ['0.000000001', 1],
    ['.5', 500_000_000],
    ['148.2505', 148_250_500_000],
    ['0.006754321', 6_754_321],
    ['1000000', 1_000_000_000_000_000],
    ['  1.085  ', 1_085_000_000],
  ];
  for (const [input, expected] of vectors) {
    assert.equal(fxUi.parseDecimalToNanos(input), expected, `module parseDecimalToNanos(${JSON.stringify(input)})`);
    assert.equal(inlineFx.parseDecimalToNanos(input), expected, `inline parseDecimalToNanos(${JSON.stringify(input)})`);
  }
});

test('parseDecimalToNanos fails closed on zero, negative, NaN, >9 decimals, non-numeric, and overflow', () => {
  const invalid = [
    '', '   ', '0', '0.0', '0.000000000', '-1.085', '-0.1',
    'NaN', 'Infinity', '1e5', '1.2.3', '.', 'abc', '1,085',
    '1.1234567890', '0.0000000001', '1000000.000000001', '1000001',
    null, undefined, 1.085,
  ];
  for (const bad of invalid) {
    assert.throws(() => fxUi.parseDecimalToNanos(bad), { code: 'invalid_fx_rate' }, `module rejects ${String(bad)}`);
    assert.throws(() => inlineFx.parseDecimalToNanos(bad), { code: 'invalid_fx_rate' }, `inline rejects ${String(bad)}`);
  }
});

test('formatNanosAsRate formats integer nanos back to exact decimal strings', () => {
  const vectors = [
    [1_085_000_000, '1.085'],
    [138_000_000, '0.138'],
    [1_000_000_000, '1'],
    [1, '0.000000001'],
    [148_250_500_000, '148.2505'],
  ];
  for (const [nanos, expected] of vectors) {
    assert.equal(fxUi.formatNanosAsRate(nanos), expected);
    assert.equal(inlineFx.formatNanosAsRate(nanos), expected);
    assert.equal(fxUi.parseDecimalToNanos(fxUi.formatNanosAsRate(nanos)), nanos);
  }
  for (const bad of [0, -1, 1.5, NaN, fxUi.MAX_FX_RATE_NANOS + 1, '1085000000']) {
    assert.throws(() => fxUi.formatNanosAsRate(bad), { code: 'invalid_fx_rate' });
    assert.throws(() => inlineFx.formatNanosAsRate(bad), { code: 'invalid_fx_rate' });
  }
});

test('convertMicrosPreview matches backend venture-currency.js to the exact micro across ties and sub-cent values', () => {
  const cases = [
    // EUR 10.00 @ 1.085 -> USD 10.85 exactly.
    [10_000_000, 1_085_000_000, 10_850_000],
    // EUR 41.00 @ 1.085 -> USD 44.485 exactly.
    [41_000_000, 1_085_000_000, 44_485_000],
    // Sub-cent BOM fastener: EUR 0.003400 @ 1.085 -> USD 0.003689.
    [3_400, 1_085_000_000, 3_689],
    // CNY 72.50 @ 0.138 -> USD 10.005.
    [72_500_000, 138_000_000, 10_005_000],
    // Exact half-up ties away from zero on both signs.
    [1, 500_000_000, 1],
    [-1, 500_000_000, -1],
    [3, 500_000_000, 2],
    [-3, 500_000_000, -2],
    // Just below half rounds toward zero.
    [1, 499_999_999, 0],
    [-1, 499_999_999, 0],
    // Zero amount converts to zero.
    [0, 1_085_000_000, 0],
  ];
  for (const [micros, rateNanos, expected] of cases) {
    const snap = fxBackend.freezeFxSnapshot({
      id: 'fx-parity', sourceCurrency: 'EUR', reportingCurrency: 'USD', rateNanos,
    });
    const backendResult = fxBackend.convertCurrencyMicros(micros, snap);
    assert.equal(backendResult, expected, `backend sanity (${micros}, ${rateNanos})`);
    assert.equal(fxUi.convertMicrosPreview(micros, rateNanos), backendResult, `module parity (${micros}, ${rateNanos})`);
    assert.equal(inlineFx.convertMicrosPreview(micros, rateNanos), backendResult, `inline parity (${micros}, ${rateNanos})`);
  }
  assert.throws(() => fxUi.convertMicrosPreview(fxUi.MAX_SAFE_MICROS, fxUi.MAX_FX_RATE_NANOS), { code: 'fx_conversion_overflow' });
  assert.throws(() => inlineFx.convertMicrosPreview(fxUi.MAX_SAFE_MICROS, fxUi.MAX_FX_RATE_NANOS), { code: 'fx_conversion_overflow' });
});

test('parseDecimalToMicros and formatCurrencyMicros handle exact amounts and sub-cent precision', () => {
  assert.equal(fxUi.parseDecimalToMicros('10.00'), 10_000_000);
  assert.equal(fxUi.parseDecimalToMicros('0.0034'), 3_400);
  assert.equal(fxUi.parseDecimalToMicros('0'), 0);
  assert.equal(inlineFx.parseDecimalToMicros('10.00'), 10_000_000);
  assert.throws(() => fxUi.parseDecimalToMicros('-1'), { code: 'invalid_currency_amount' });
  assert.throws(() => fxUi.parseDecimalToMicros('1.1234567'), { code: 'invalid_currency_amount' });

  assert.equal(fxUi.formatCurrencyMicros(10_000_000, 'EUR'), '€10.00');
  assert.equal(fxUi.formatCurrencyMicros(10_850_000, 'USD'), '$10.85');
  assert.equal(fxUi.formatCurrencyMicros(3_689, 'USD'), '$0.003689');
  assert.equal(fxUi.formatCurrencyMicros(12_500_000, 'MXN'), 'MXN 12.50');
  assert.equal(inlineFx.formatCurrencyMicros(10_850_000, 'USD'), '$10.85');
});

test('safeHttpUrl, sourceRef parts, snapshot filtering, and idempotency keys enforce safety boundaries', () => {
  assert.equal(fxUi.safeHttpUrl('https://www.ecb.europa.eu/stats/fx'), 'https://www.ecb.europa.eu/stats/fx');
  assert.equal(fxUi.safeHttpUrl('http://example.com/rates'), 'http://example.com/rates');
  assert.equal(fxUi.safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(fxUi.safeHttpUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(fxUi.safeHttpUrl('ECB daily reference'), null);
  assert.equal(inlineFx.safeHttpUrl('javascript:alert(1)'), null);

  const combined = fxUi.buildFxSourceRef('https://www.ecb.europa.eu/rates', 'Q4 supplier quote');
  assert.equal(combined, 'https://www.ecb.europa.eu/rates | Q4 supplier quote');
  assert.deepEqual(fxUi.parseSourceRefParts(combined), {
    url: 'https://www.ecb.europa.eu/rates',
    label: 'https://www.ecb.europa.eu/rates',
    notes: 'Q4 supplier quote',
  });
  assert.deepEqual(fxUi.parseSourceRefParts('javascript:alert(1) | hostile'), {
    url: null,
    label: 'javascript:alert(1)',
    notes: 'hostile',
  });

  const snaps = [
    { id: 'fx-old', sourceCurrency: 'EUR', reportingCurrency: 'USD', rateNanos: 1_050_000_000, observedAt: '2026-10-01T00:00:00Z', createdAt: '2026-10-01T00:00:00Z' },
    { id: 'fx-cny', sourceCurrency: 'CNY', reportingCurrency: 'USD', rateNanos: 138_000_000, observedAt: '2026-11-20T00:00:00Z', createdAt: '2026-11-20T00:00:00Z' },
    { id: 'fx-new', sourceCurrency: 'EUR', reportingCurrency: 'USD', rateNanos: 1_085_000_000, observedAt: '2026-11-25T12:00:00Z', createdAt: '2026-11-25T12:00:00Z' },
  ];
  assert.deepEqual(fxUi.filterSnapshotsForPair(snaps, 'EUR', 'USD').map((s) => s.id), ['fx-new', 'fx-old']);
  assert.deepEqual(inlineFx.filterSnapshotsForPair(snaps, 'EUR', 'USD').map((s) => s.id), ['fx-new', 'fx-old']);
  assert.deepEqual(fxUi.filterSnapshotsForPair(snaps, 'GBP', 'USD'), []);

  const key = fxUi.makeFxIdempotencyKey('EUR', 'USD');
  assert.match(key, /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
});
