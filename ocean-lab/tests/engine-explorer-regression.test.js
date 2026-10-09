/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 D4 / S5 — the study-reproduction regression. The engine at today's version,
 *                     |                             | run from the committed seed in seawater, must reproduce every figure the autonomous-explorer
 *                     |                             | design study published (core docs/research/autonomous-explorer-design-study.md, "Performance")
 *                     |                             | within the STATED TOLERANCE: half a unit in the last digit the study printed, for every column
 *                     |                             | of every row — m/s, knots and km/day — and for the mean in knots, the share of the year under
 *                     |                             | way, km/day and km/year. The seed's wave periods and occurrences were NOT published and were
 *                     |                             | solved against engine 1.0.0 (their provenance says so), so agreement at the seed is by
 *                     |                             | construction at that version; this suite is what turns red when the engine drifts from it,
 *                     |                             | and someone then decides whether it changed for a reason or broke. Independent of that fit:
 *                     |                             | every row sits under its kinematic ceiling and every reconstructed sea is short of breaking.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) };
  return originalLoad.call(this, request, parent, isMain);
};

const ENGINE = path.resolve(__dirname, '..', 'routes', 'engine');
const wave = require(path.join(ENGINE, 'wave', 'index.js'));
const lib = require(path.join(ENGINE, 'vehicle', 'index.js'));

/** The study's performance table and annual figures, exactly as printed, with the digits each carries. */
const PUBLISHED = Object.freeze({
  source: 'docs/research/autonomous-explorer-design-study.md, "The explorer" > "Performance" (2026-08-02)',
  rows: [
    { id: 'flat', speedMs: [0.000, 3], knots: [0.00, 2], kmPerDay: [0.0, 1] },
    { id: 'calm', speedMs: [0.033, 3], knots: [0.06, 2], kmPerDay: [2.8, 1] },
    { id: 'light-swell', speedMs: [0.103, 3], knots: [0.20, 2], kmPerDay: [8.9, 1] },
    { id: 'moderate', speedMs: [0.396, 3], knots: [0.77, 2], kmPerDay: [34.2, 1] },
    { id: 'rough', speedMs: [1.310, 3], knots: [2.55, 2], kmPerDay: [113.2, 1] },
  ],
  meanKnots: [0.46, 2],
  underWayFraction: [0.65, 2],
  kmPerDay: [20.4, 1],
  kmPerYear: [7444, 0],
});

/** The engine version the seed's unpublished periods and occurrences were solved at. */
const SOLVED_AT_ENGINE = '1.0.0';

/** @description Within the stated tolerance: half a unit in the last printed digit. */
function withinPublished(label, value, [printed, digits]) {
  const half = 0.5 * 10 ** -digits;
  assert.ok(Math.abs(value - printed) <= half, `${label}: engine ${value} is not within ±${half} of the published ${printed.toFixed(digits)}`);
}

const seed = lib.explorerSeed();
const evaluation = lib.evaluateExplorer(seed.designVector, wave.mediumById('seawater'));

test('the seed was solved at this engine version — a version bump is the signal to re-decide, not to widen a tolerance', () => {
  assert.equal(wave.WAVE_ENGINE.version, SOLVED_AT_ENGINE);
  assert.match(seed.provenance['site.seaStates.periodS'].basis, new RegExp(`wave-propulsion ${SOLVED_AT_ENGINE.replace(/\./g, '\\.')}`));
});

test('every row of the published sea-state table: m/s, knots and km/day, each to the digit the study printed', () => {
  assert.deepEqual(evaluation.seaStates.map((r) => r.id), PUBLISHED.rows.map((r) => r.id));
  PUBLISHED.rows.forEach((row, i) => {
    const got = evaluation.seaStates[i];
    withinPublished(`${row.id} speed m/s`, got.speedMs, row.speedMs);
    withinPublished(`${row.id} knots`, got.knots, row.knots);
    withinPublished(`${row.id} km/day`, got.kmPerDay, row.kmPerDay);
  });
});

test('the year: 0.46 knots mean, under way 65 % of the time, 20.4 km/day, 7,444 km/year', () => {
  withinPublished('mean knots', evaluation.figures.meanKnots, PUBLISHED.meanKnots);
  withinPublished('share under way', evaluation.figures.underWayFraction, PUBLISHED.underWayFraction);
  withinPublished('km/day', evaluation.figures.kmPerDay, PUBLISHED.kmPerDay);
  withinPublished('km/year', evaluation.figures.kmPerYear, PUBLISHED.kmPerYear);
});

test('independent of the fit: every row sits under its kinematic ceiling, and every reconstructed sea is short of breaking', () => {
  for (const row of evaluation.seaStates) {
    assert.ok(row.speedMs < row.ceilingMs, `${row.id}: ${row.speedMs} under ${row.ceilingMs}`);
    const wavelengthM = (9.81 * row.periodS ** 2) / (2 * Math.PI);
    assert.ok(row.heightM / wavelengthM < 1 / 7, `${row.id}: steepness ${(row.heightM / wavelengthM).toFixed(3)} below the 1/7 breaking limit`);
  }
  assert.equal(evaluation.medium.id, 'seawater');
  assert.equal(evaluation.withinModel.ok, true, 'the seed\'s 20 degree stop is inside the modelled range');
});
