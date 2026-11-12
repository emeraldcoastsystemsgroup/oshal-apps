/**
 * Guards for the calibration-build module.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial test suite for the calibration table arithmetic module. Verifies pickPrice, bucketIndex, samplesOf, usableSettled, buildCalibrationTable, and bucket structure.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BUCKET_EDGES,
  HORIZONS,
  pickPrice,
  bucketIndex,
  aggregate,
  samplesOf,
  usableSettled,
  buildCalibrationTable,
} = require('../lib/kalshi-calibration-build.js');

// ---- pickPrice ----

test('pickPrice: close in valid range is used', () => {
  assert.equal(pickPrice(0.5, null, null), 0.5);
  assert.equal(pickPrice(0.5, 0.45, 0.55), 0.5);
});

test('pickPrice: close at 0.003 falls back to bid/ask mid', () => {
  assert.equal(pickPrice(0.003, 0.45, 0.55), 0.5);
});

test('pickPrice: close at 0.997 falls back to bid/ask mid', () => {
  assert.equal(pickPrice(0.997, 0.45, 0.55), 0.5);
});

test('pickPrice: close null falls back to bid/ask mid', () => {
  assert.equal(pickPrice(null, 0.45, 0.55), 0.5);
});

test('pickPrice: mid outside valid range gives null', () => {
  assert.equal(pickPrice(0.003, 0.0001, 0.0002), null);   // mid = 0.00015 < 0.005
  assert.equal(pickPrice(0.997, 0.998, 0.999), null);     // mid = 0.9985 > 0.995
});

test('pickPrice: ask of 1 gives null', () => {
  assert.equal(pickPrice(0.003, 0.45, 1), null);
});

test('pickPrice: bid of 0 gives null', () => {
  assert.equal(pickPrice(0.003, 0, 0.55), null);
});

test('pickPrice: missing side gives null', () => {
  assert.equal(pickPrice(0.003, null, 0.55), null);
  assert.equal(pickPrice(0.003, 0.45, null), null);
});

test('pickPrice: close at boundary 0.005 is rejected', () => {
  assert.equal(pickPrice(0.005, 0.45, 0.55), 0.5);  // 0.005 is NOT > 0.005, so falls back to mid 0.5
});

test('pickPrice: close at boundary 0.995 is rejected', () => {
  assert.equal(pickPrice(0.995, 0.45, 0.55), 0.5);  // 0.995 is NOT < 0.995, so falls back to mid 0.5
});

// ---- bucketIndex ----

test('bucketIndex: 0 -> 0', () => {
  assert.equal(bucketIndex(0), 0);
});

test('bucketIndex: 0.029 -> 0', () => {
  assert.equal(bucketIndex(0.029), 0);
});

test('bucketIndex: 0.03 -> 1', () => {
  assert.equal(bucketIndex(0.03), 1);
});

test('bucketIndex: 0.5 -> 8', () => {
  assert.equal(bucketIndex(0.5), 8);
});

test('bucketIndex: 0.97 -> 15', () => {
  assert.equal(bucketIndex(0.97), 15);
});

test('bucketIndex: 1.0 -> 15', () => {
  assert.equal(bucketIndex(1.0), 15);
});

test('bucketIndex: -0.1 -> -1', () => {
  assert.equal(bucketIndex(-0.1), -1);
});

test('bucketIndex: 1.1 -> -1', () => {
  assert.equal(bucketIndex(1.1), -1);
});


// ---- samplesOf ----

test('samplesOf: market open 30 hours with hourly candles gives 3 samples', () => {
  const closeTime = new Date('2026-01-15T12:00:00Z');
  const openTime = new Date('2026-01-14T06:00:00Z');  // 30 hours before close
  const market = { ticker: 'T', result: 'yes', closeTime, openTime };

  const candles = [];
  for (let i = 0; i <= 30; i++) {
    const ts = openTime.getTime() / 1000 + i * 3600;  // every hour
    candles.push({ endPeriodTs: Math.floor(ts), close: 0.5, yesBidClose: null, yesAskClose: null });
  }

  const samples = samplesOf(market, 'A', candles);
  assert.equal(samples.length, 3);
  assert.equal(samples[0].horizonHours, 24);
  assert.equal(samples[1].horizonHours, 6);
  assert.equal(samples[2].horizonHours, 1);
  assert.equal(samples[0].settledYes, true);
  assert.equal(samples[0].price, 0.5);
  assert.equal(samples[1].price, 0.5);
  assert.equal(samples[2].price, 0.5);
});

test('samplesOf: market open only 3 hours gives only 1-hour sample', () => {
  const closeTime = new Date('2026-01-15T12:00:00Z');
  const openTime = new Date('2026-01-15T09:00:00Z');  // 3 hours before close
  const market = { ticker: 'T', result: 'yes', closeTime, openTime };

  const candles = [];
  for (let i = 0; i <= 3; i++) {
    const ts = openTime.getTime() / 1000 + i * 3600;
    candles.push({ endPeriodTs: Math.floor(ts), close: 0.5, yesBidClose: null, yesAskClose: null });
  }

  const samples = samplesOf(market, 'A', candles);
  assert.equal(samples.length, 1);
  assert.equal(samples[0].horizonHours, 1);
  // 24h target: closeS - 86400 < openS + 1800 => skip
  // 6h target: closeS - 21600 < openS + 1800 => skip
  // 1h target: closeS - 3600 = openS + 5400 >= openS + 1800 => ok
});

test('samplesOf: no candles gives no samples', () => {
  const market = { ticker: 'T', result: 'yes', closeTime: '2026-01-15T12:00:00Z', openTime: '2026-01-14T06:00:00Z' };
  assert.deepEqual(samplesOf(market, 'A', []), []);
});

test('samplesOf: horizon whose candle has no usable price is skipped', () => {
  const closeTime = new Date('2026-01-15T12:00:00Z');
  const openTime = new Date('2026-01-14T06:00:00Z');
  const market = { ticker: 'T', result: 'yes', closeTime, openTime };

  // Candle at 24h target has close=0.003 (too low), no bid/ask => null price
  const candles = [
    { endPeriodTs: Math.floor(closeTime.getTime() / 1000) - 24 * 3600, close: 0.003, yesBidClose: null, yesAskClose: null },
    { endPeriodTs: Math.floor(closeTime.getTime() / 1000) - 6 * 3600, close: 0.5, yesBidClose: null, yesAskClose: null },
    { endPeriodTs: Math.floor(closeTime.getTime() / 1000) - 1 * 3600, close: 0.5, yesBidClose: null, yesAskClose: null },
  ];

  const samples = samplesOf(market, 'A', candles);
  assert.equal(samples.length, 2);
  assert.equal(samples[0].horizonHours, 6);
  assert.equal(samples[1].horizonHours, 1);
});

test('samplesOf: settledYes follows result', () => {
  const closeTime = new Date('2026-01-15T12:00:00Z');
  const openTime = new Date('2026-01-14T06:00:00Z');
  const market = { ticker: 'T', result: 'no', closeTime, openTime };

  const candles = [
    { endPeriodTs: Math.floor(closeTime.getTime() / 1000) - 1 * 3600, close: 0.5, yesBidClose: null, yesAskClose: null },
  ];

  const samples = samplesOf(market, 'A', candles);
  assert.equal(samples[0].settledYes, false);
});

test('samplesOf: closeTime/openTime as ISO strings', () => {
  const market = { ticker: 'T', result: 'yes', closeTime: '2026-01-15T12:00:00Z', openTime: '2026-01-14T06:00:00Z' };
  const candles = [
    { endPeriodTs: Math.floor(Date.parse('2026-01-15T12:00:00Z') / 1000) - 1 * 3600, close: 0.5, yesBidClose: null, yesAskClose: null },
  ];
  const samples = samplesOf(market, 'A', candles);
  assert.equal(samples.length, 1);
});


// ---- usableSettled ----

test('usableSettled: multivariate is excluded', () => {
  const markets = [
    { ticker: 'M1', isMultivariate: true, result: 'yes', closeTime: '2026-01-01T00:00:00Z', openTime: '2025-12-01T00:00:00Z', volume: 100 },
    { ticker: 'M2', isMultivariate: false, result: 'yes', closeTime: '2026-01-01T00:00:00Z', openTime: '2025-12-01T00:00:00Z', volume: 100 },
  ];
  const result = usableSettled(markets);
  assert.equal(result.length, 1);
  assert.equal(result[0].ticker, 'M2');
});

test('usableSettled: result not yes/no is excluded', () => {
  const markets = [
    { ticker: 'M1', isMultivariate: false, result: 'pending', closeTime: '2026-01-01T00:00:00Z', openTime: '2025-12-01T00:00:00Z', volume: 100 },
    { ticker: 'M2', isMultivariate: false, result: 'yes', closeTime: '2026-01-01T00:00:00Z', openTime: '2025-12-01T00:00:00Z', volume: 100 },
  ];
  const result = usableSettled(markets);
  assert.equal(result.length, 1);
  assert.equal(result[0].ticker, 'M2');
});

test('usableSettled: missing closeTime is excluded', () => {
  const markets = [
    { ticker: 'M1', isMultivariate: false, result: 'yes', openTime: '2025-12-01T00:00:00Z', volume: 100 },
    { ticker: 'M2', isMultivariate: false, result: 'yes', closeTime: '2026-01-01T00:00:00Z', openTime: '2025-12-01T00:00:00Z', volume: 100 },
  ];
  const result = usableSettled(markets);
  assert.equal(result.length, 1);
  assert.equal(result[0].ticker, 'M2');
});

test('usableSettled: missing openTime is excluded', () => {
  const markets = [
    { ticker: 'M1', isMultivariate: false, result: 'yes', closeTime: '2026-01-01T00:00:00Z', volume: 100 },
    { ticker: 'M2', isMultivariate: false, result: 'yes', closeTime: '2026-01-01T00:00:00Z', openTime: '2025-12-01T00:00:00Z', volume: 100 },
  ];
  const result = usableSettled(markets);
  assert.equal(result.length, 1);
  assert.equal(result[0].ticker, 'M2');
});

test('usableSettled: volume 0 is excluded', () => {
  const markets = [
    { ticker: 'M1', isMultivariate: false, result: 'yes', closeTime: '2026-01-01T00:00:00Z', openTime: '2025-12-01T00:00:00Z', volume: 0 },
    { ticker: 'M2', isMultivariate: false, result: 'yes', closeTime: '2026-01-01T00:00:00Z', openTime: '2025-12-01T00:00:00Z', volume: 100 },
  ];
  const result = usableSettled(markets);
  assert.equal(result.length, 1);
  assert.equal(result[0].ticker, 'M2');
});

test('usableSettled: all rules pass -> market is included', () => {
  const markets = [
    { ticker: 'M1', isMultivariate: false, result: 'no', closeTime: '2026-01-01T00:00:00Z', openTime: '2025-12-01T00:00:00Z', volume: 50 },
  ];
  const result = usableSettled(markets);
  assert.equal(result.length, 1);
  assert.equal(result[0].ticker, 'M1');
});


// ---- buildCalibrationTable ----

test('buildCalibrationTable: structure, counts, and hand-computed buckets', () => {
  // 12 hand-made samples across 2 categories (A, B) and 2 horizons (6, 1)
  // Category A: 6 samples
  //   horizon 6: prices 0.10(yes), 0.12(yes), 0.14(no) — all in bucket 3
  //   horizon 1: prices 0.50(yes), 0.55(yes), 0.50(no) — all in bucket 8
  // Category B: 6 samples
  //   horizon 6: prices 0.70(yes), 0.75(no), 0.80(yes) — buckets 10, 10, 11
  //   horizon 1: prices 0.90(no), 0.92(yes), 0.03(yes) — buckets 13, 13, 1

  const samples = [
    { ticker: 'T1', category: 'A', horizonHours: 6, price: 0.10, settledYes: true },
    { ticker: 'T2', category: 'A', horizonHours: 6, price: 0.12, settledYes: true },
    { ticker: 'T3', category: 'A', horizonHours: 6, price: 0.14, settledYes: false },
    { ticker: 'T4', category: 'A', horizonHours: 1, price: 0.50, settledYes: true },
    { ticker: 'T5', category: 'A', horizonHours: 1, price: 0.55, settledYes: true },
    { ticker: 'T6', category: 'A', horizonHours: 1, price: 0.50, settledYes: false },
    { ticker: 'T7', category: 'B', horizonHours: 6, price: 0.70, settledYes: true },
    { ticker: 'T8', category: 'B', horizonHours: 6, price: 0.75, settledYes: false },
    { ticker: 'T9', category: 'B', horizonHours: 6, price: 0.80, settledYes: true },
    { ticker: 'T10', category: 'B', horizonHours: 1, price: 0.90, settledYes: false },
    { ticker: 'T11', category: 'B', horizonHours: 1, price: 0.92, settledYes: true },
    { ticker: 'T12', category: 'B', horizonHours: 1, price: 0.03, settledYes: true },
  ];

  const fixedNow = new Date('2026-08-01T00:00:00.000Z');
  const table = buildCalibrationTable(samples, fixedNow);

  // generatedAt is the given time
  assert.equal(table.generatedAt, '2026-08-01T00:00:00.000Z');

  // sampleCounts
  assert.deepEqual(table.sampleCounts, { A: 6, B: 6 });

  // horizons has "6" and "1" only
  assert.ok(table.horizons['6'], 'horizon "6" exists');
  assert.ok(table.horizons['1'], 'horizon "1" exists');
  assert.ok(!table.horizons['24'], 'horizon "24" does not exist');

  // each horizon has "*" and its own categories
  assert.ok(table.horizons['6']['*'], 'horizon 6 has "*"');
  assert.ok(table.horizons['6']['A'], 'horizon 6 has category "A"');
  assert.ok(table.horizons['6']['B'], 'horizon 6 has category "B"');
  assert.ok(table.horizons['1']['*'], 'horizon 1 has "*"');
  assert.ok(table.horizons['1']['A'], 'horizon 1 has category "A"');
  assert.ok(table.horizons['1']['B'], 'horizon 1 has category "B"');
  // Category B should NOT be under horizon 6's sibling (1h) — wait, B IS under 1h. Let me check that the structure is correct.
  // Actually, B appears under BOTH horizons. The structure says: a category appears under a horizon only when it has samples there.
  // B has samples in both horizon 6 and horizon 1, so it appears in both. That's correct.

  // Hand-computed bucket 3 for horizon 6, category A:
  // samples: 0.10(yes), 0.12(yes), 0.14(no) — 3 samples, all in bucket index 3 (lo=0.1, hi=0.15)
  // n=3, avgPrice=(0.10+0.12+0.14)/3=0.12, yesRate=2/3
  const b3 = table.horizons['6']['A'][3];
  assert.equal(b3.n, 3);
  assert.equal(b3.avgPrice, 0.12);
  assert.equal(b3.yesRate, 2 / 3);

  // Hand-computed bucket 8 for horizon 1, category A:
  // samples: 0.50(yes), 0.55(yes), 0.50(no) — 3 samples, all in bucket index 8 (lo=0.5, hi=0.6)
  // n=3, avgPrice=(0.50+0.55+0.50)/3=1.55/3=0.516666..., yesRate=2/3
  const b8 = table.horizons['1']['A'][8];
  assert.equal(b8.n, 3);
  assert.equal(b8.avgPrice, (0.5 + 0.55 + 0.5) / 3);
  assert.equal(b8.yesRate, 2 / 3);

  // Hand-computed bucket 10 for horizon 6, category B:
  // samples: 0.70(yes), 0.75(no) — 2 samples in bucket 10 (lo=0.7, hi=0.8)
  // n=2, avgPrice=(0.70+0.75)/2=0.725, yesRate=1/2=0.5
  const b10 = table.horizons['6']['B'][10];
  assert.equal(b10.n, 2);
  assert.equal(b10.avgPrice, 0.725);
  assert.equal(b10.yesRate, 0.5);
});

// ---- bucket structure ----

test('every bucket list has 16 entries with correct lo/hi', () => {
  const samples = [
    { ticker: 'T', category: 'X', horizonHours: 6, price: 0.50, settledYes: true },
  ];
  const table = buildCalibrationTable(samples, new Date('2026-08-01T00:00:00Z'));

  for (const hKey of Object.keys(table.horizons)) {
    const h = table.horizons[hKey];
    for (const cKey of Object.keys(h)) {
      const buckets = h[cKey];
      assert.equal(buckets.length, 16, `horizon ${hKey} category ${cKey} has 16 buckets`);
      for (let i = 0; i < 16; i++) {
        assert.equal(buckets[i].lo, BUCKET_EDGES[i], `horizon ${hKey} category ${cKey} bucket ${i} lo`);
        assert.equal(buckets[i].hi, BUCKET_EDGES[i + 1], `horizon ${hKey} category ${cKey} bucket ${i} hi`);
      }
    }
  }
});
