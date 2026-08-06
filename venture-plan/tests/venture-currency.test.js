/**
 * Venture Plan - exact foreign-exchange arithmetic guards.
 *
 * These tests run the compiled module the package mounts. Known values are
 * derived in the assertion comments, boundaries fail closed, and the mutation
 * guard proves a validated snapshot cannot change between binding and use.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard integer-nanorate known values, half-away rounding, overflow/shape boundaries, and immutable FX snapshots.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { engine } = require('./fixture-venture');

const F = engine('venture-currency');
const P = engine('venture-primitives');

test('known-value EUR to USD quotes convert in integer micros with no float drift', () => {
  const fx = F.freezeFxSnapshot({
    id: 'fx-eur-usd-1', sourceCurrency: 'eur', reportingCurrency: 'usd',
    rateNanos: 1_085_000_000,
  });
  // EUR 41.000000 * 1.085 USD/EUR = USD 44.485000 exactly.
  assert.equal(F.convertCurrencyMicros(41_000_000, fx), 44_485_000);
  // EUR 0.003400 * 1.085 = USD 0.003689: sub-cent BOM precision survives.
  assert.equal(F.convertCurrencyMicros(3_400, fx), 3_689);
  assert.equal(fx.sourceCurrency, 'EUR');
  assert.equal(fx.reportingCurrency, 'USD');
});

test('FX division rounds half-up away from zero on both signs', () => {
  const half = F.freezeFxSnapshot({
    id: 'fx-half', sourceCurrency: 'EUR', reportingCurrency: 'USD',
    rateNanos: 500_000_000,
  });
  assert.equal(F.convertCurrencyMicros(1, half), 1, '+0.5 reporting micro rounds to +1');
  assert.equal(F.convertCurrencyMicros(-1, half), -1, '-0.5 reporting micro rounds to -1');
  assert.equal(F.convertCurrencyMicros(3, half), 2, '+1.5 rounds to +2');
  assert.equal(F.convertCurrencyMicros(-3, half), -2, '-1.5 rounds to -2');
});

test('invalid currencies, fractional values, zero rates and overflow fail closed', () => {
  assert.throws(() => F.normalizeCurrencyCode('US'), { code: 'invalid_currency' });
  assert.throws(() => F.normalizeCurrencyCode('U$D'), { code: 'invalid_currency' });
  assert.throws(() => F.assertFxRateNanos(0), { code: 'invalid_fx_rate' });
  assert.throws(() => F.assertFxRateNanos(1.5), { code: 'invalid_fx_rate' });
  assert.throws(() => F.assertCurrencyMicros(1.5, 'amount'), { code: 'invalid_currency_amount' });
  assert.throws(() => F.freezeFxSnapshot({
    id: 'same', sourceCurrency: 'USD', reportingCurrency: 'USD', rateNanos: F.FX_RATE_SCALE,
  }), { code: 'redundant_fx_assumption' });
  assert.throws(() => F.convertCurrencyMicros(P.MAX_SAFE_MICROS, {
    id: 'overflow', sourceCurrency: 'EUR', reportingCurrency: 'USD',
    rateNanos: F.MAX_FX_RATE_NANOS,
  }), { code: 'fx_conversion_overflow' });
});

test('MUTATION: a validated FX snapshot cannot be changed before conversion', () => {
  const fx = F.freezeFxSnapshot({
    id: 'fx-immutable', sourceCurrency: 'EUR', reportingCurrency: 'USD',
    rateNanos: 1_100_000_000,
  });
  assert.ok(Object.isFrozen(fx));
  assert.throws(() => { fx.rateNanos = 900_000_000; }, TypeError);
  assert.equal(F.convertCurrencyMicros(10_000_000, fx), 11_000_000,
    'the conversion still uses the captured immutable rate');
});
