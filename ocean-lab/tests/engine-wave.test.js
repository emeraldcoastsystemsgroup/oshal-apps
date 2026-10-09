/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S2 — the wave-propulsion engine and the medium contract, against the COMPILED
 *                     |                             | modules the package ships (routes/engine), under plain node with no framework: the logger is
 *                     |                             | stubbed through the module loader. The report's governing math term by term (heave, the
 *                     |                             | kinematic ceiling, lift that vanishes EXACTLY past the stop while profile drag remains, the
 *                     |                             | vertical balance, Theodorsen through R.T. Jones, ITTC-57), the closure solved under the
 *                     |                             | ceiling, density and viscosity taken from the medium rather than a constant, the table moving
 *                     |                             | with the stop angle and the tether, and every named refusal: air is
 *                     |                             | medium_property_unavailable: freeSurface, vacuum is model_not_valid_in_medium, an undeclared
 *                     |                             | model fails closed, a position outside the band is medium_outside_validity.
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
const vehicleLib = require(path.join(ENGINE, 'vehicle', 'index.js'));

const seed = vehicleLib.explorerSeed();
const seawater = wave.mediumById('seawater');
const fluidOf = (m) => ({ densityKgM3: m.densityKgM3, kinematicViscosityM2S: wave.kinematicViscosityM2S(m), gravityMps2: wave.gravityMagnitude(m) });
const FLUID = fluidOf(seawater);
const { vehicle: EXPLORER } = vehicleLib.deriveWaveVehicle(seed.designVector);
const MODERATE = { id: 'moderate', label: 'Moderate', heightM: 1.0, periodS: 5.12, occurrence: 1 };
const withVector = (edit) => { const v = JSON.parse(JSON.stringify(seed.designVector)); edit(v); return v; };

test('the medium rows: seawater carries the shared properties and the free surface this lab implements; air and vacuum carry none', () => {
  assert.deepEqual(wave.MEDIA_KNOWN, ['vacuum', 'air', 'seawater']);
  assert.equal(seawater.densityKgM3, 1025);
  assert.equal(seawater.dynamicViscosityPaS, 0.00107625);
  assert.ok(Math.abs(wave.kinematicViscosityM2S(seawater) - 1.05e-6) < 1e-15, 'nu = mu / rho is derived, never stored');
  assert.deepEqual(seawater.gravityMps2, [0, 0, -9.81]);
  assert.deepEqual(seawater.freeSurface && { kind: seawater.freeSurface.kind, heightM: seawater.freeSurface.heightM }, { kind: 'plane', heightM: 0 });
  assert.equal(wave.mediumById('air').freeSurface, null);
  assert.equal(wave.mediumById('air').densityKgM3, 1.225);
  assert.equal(wave.mediumById('vacuum').freeSurface, null);
  assert.throws(() => wave.kinematicViscosityM2S(wave.mediumById('vacuum')), (e) => e.refusal === 'medium_property_unavailable: kinematicViscosityM2S');
  assert.throws(() => wave.mediumById('helium'), (e) => e.code === 'unknown_medium' && e.refusal === 'unknown_medium: helium');
});

test('heave is w = A*omega*cos(omega*t) with w_max = pi*H/T, and the ceiling is U_max = w / tan(beta_stop)', () => {
  const sea = { id: 's', label: 's', heightM: 1.0, periodS: 6, occurrence: 1 };
  assert.ok(Math.abs(wave.heaveVelocity(sea, 0) - (0.5 * (2 * Math.PI) / 6)) < 1e-12);
  assert.ok(Math.abs(wave.heaveVelocity(sea, Math.PI / 2)) < 1e-12);
  assert.ok(Math.abs(wave.peakHeaveMs(sea) - Math.PI / 6) < 1e-12, 'steepness, not height');
  assert.ok(Math.abs(wave.peakHeaveMs({ ...sea, periodS: 12 }) - wave.peakHeaveMs(sea) / 2) < 1e-12, 'the same wave at twice the period heaves half as fast');
  const beta = (20 * Math.PI) / 180;
  assert.ok(Math.abs(wave.kinematicCeilingMs(0.5, beta) - 0.5 / Math.tan(beta)) < 1e-12);
});

test('past the stop the wing weathervanes flat: lift thrust is EXACTLY zero and profile drag remains', () => {
  const omega = (2 * Math.PI) / 5;
  const beta = EXPLORER.stopAngleRad;
  const heave = 0.8;
  const atCeiling = heave / Math.tan(beta);
  const past = wave.wingForces(EXPLORER, FLUID, atCeiling * 1.5, heave, omega);
  assert.equal(past.alphaRad, 0);
  assert.equal(past.cl, 0);
  assert.equal(past.liftThrustN, 0, 'zero, not the panel method\'s 1e-15');
  assert.ok(past.profileDragN > 0, 'profile drag remains');
  assert.ok(past.thrustN < 0);
  const below = wave.wingForces(EXPLORER, FLUID, atCeiling * 0.7, heave, omega);
  assert.ok(below.alphaRad > 0 && below.liftThrustN > 0 && below.thrustN > 0, 'under the ceiling the inclined lift pushes');
  assert.ok(Math.tan(below.thetaRad) > below.cd / below.cl, 'positive only when tan(theta) > CD/CL');
});

test('Theodorsen by R.T. Jones: |C(0)| = 1, |C| falls toward 0.5 as the reduced frequency grows, and the wing loses lift to it', () => {
  assert.equal(wave.theodorsenMagnitude(0), 1);
  const ks = [0.05, 0.2, 0.5, 1, 3, 20];
  const mags = ks.map(wave.theodorsenMagnitude);
  for (let i = 1; i < mags.length; i += 1) assert.ok(mags[i] < mags[i - 1], `monotone at k=${ks[i]}`);
  assert.ok(mags[mags.length - 1] > 0.5 && mags[mags.length - 1] < 0.51);
  const f = wave.wingForces(EXPLORER, FLUID, 0.2, 0.3, 2 * Math.PI);
  assert.ok(f.liftDeficiency < 1 && f.liftDeficiency > 0.5);
});

test('the vertical balance slows the heave when the wings load past the budget, and only then', () => {
  const budgets = wave.heaveBudgetsN(EXPLORER, FLUID);
  assert.ok(Math.abs(budgets.upN - (1025 * 9.81 * 0.0241 - 12)) < 1e-9, 'up: the float\'s buoyancy less the sub\'s weight in water');
  assert.equal(budgets.downN, 12, 'down: only the ballast');
  const omega = (2 * Math.PI) / 6;
  assert.equal(wave.balancedHeaveMs(EXPLORER, FLUID, 0.3, -0.05, omega), 0.05, 'a light load follows the wave exactly');
  const light = { ...EXPLORER, subNetWeightN: 0.5 };
  const held = wave.balancedHeaveMs(light, FLUID, 0.3, -1.2, omega);
  assert.ok(held < 1.2, 'the downstroke is slowed');
  assert.ok(light.wingCount * wave.wingForces(light, FLUID, 0.3, held, omega).normalN <= 0.5 + 1e-9, 'to exactly what the ballast carries');
});

test('ITTC-57 and the closure: CF = 0.075/(log10 Re - 2)^2, held at its floor, and D grows with the wetted area', () => {
  assert.ok(Math.abs(wave.ittcFrictionCoefficient(1e6) - 0.075 / 16) < 1e-15);
  assert.equal(wave.ittcFrictionCoefficient(50), wave.ittcFrictionCoefficient(wave.ITTC_REYNOLDS_FLOOR), 'no run to infinity near Re = 100');
  const d1 = wave.resistanceN(EXPLORER, FLUID, 0.4);
  const longer = vehicleLib.deriveWaveVehicle(withVector((v) => { v.tether.lengthM = 4; })).vehicle;
  assert.ok(wave.resistanceN(longer, FLUID, 0.4) > d1, 'a longer tether wets more area');
  assert.equal(wave.resistanceN(EXPLORER, FLUID, 0), 0);
});

test('the equilibrium sits under the kinematic ceiling, where thrust and drag balance', () => {
  const eq = wave.equilibrium(EXPLORER, FLUID, MODERATE);
  assert.ok(eq.speedMs > 0 && eq.speedMs < eq.ceilingMs, `${eq.speedMs} under ${eq.ceilingMs}`);
  const net = (u) => wave.cycleMeanThrustN(EXPLORER, FLUID, MODERATE, u) - wave.resistanceN(EXPLORER, FLUID, u);
  assert.ok(net(eq.speedMs * 0.9) > 0 && net(eq.speedMs * 1.1) < 0, 'thrust exceeds drag below it and falls short above it');
  assert.ok(wave.cycleMeanThrustN(EXPLORER, FLUID, MODERATE, eq.ceilingMs * 1.01) < 0, 'past the ceiling every wing is flat and only drag remains');
});

test('density and viscosity come from the medium: a denser fluid changes the answer, nothing reads a constant', () => {
  const base = wave.equilibrium(EXPLORER, FLUID, MODERATE).speedMs;
  const thicker = wave.equilibrium(EXPLORER, { ...FLUID, kinematicViscosityM2S: FLUID.kinematicViscosityM2S * 4 }, MODERATE).speedMs;
  assert.notEqual(thicker, base, 'viscosity reaches the section polar and the friction line');
  const denser = wave.heaveBudgetsN(EXPLORER, { ...FLUID, densityKgM3: 2000 });
  assert.ok(denser.upN > wave.heaveBudgetsN(EXPLORER, FLUID).upN, 'density reaches the buoyancy budget');
});

test('the table moves with the stop angle and with the tether length — each monotone over the modelled range', () => {
  const kmYear = (edit) => vehicleLib.evaluateExplorer(withVector(edit), seawater).figures.kmPerYear;
  const byStop = [15, 20, 25].map((deg) => kmYear((v) => { v.wings.stopAngleDeg = deg; }));
  const byTether = [1, 2, 4, 8].map((m) => kmYear((v) => { v.tether.lengthM = m; }));
  assert.ok(byStop[0] < byStop[1] && byStop[1] < byStop[2], `stop angle: ${byStop.join(' < ')}`);
  assert.ok(byTether[0] > byTether[1] && byTether[1] > byTether[2] && byTether[2] > byTether[3], `tether: ${byTether.join(' > ')}`);
  const shallow = vehicleLib.evaluateExplorer(withVector((v) => { v.wings.stopAngleDeg = 10; }), seawater);
  assert.equal(shallow.withinModel.ok, false, 'below ~15 degrees the table is computed and labelled outside the model');
});

test('air is refused by name — medium_property_unavailable: freeSurface — never a quiet zero', () => {
  assert.throws(() => vehicleLib.evaluateExplorer(seed.designVector, wave.mediumById('air')), (e) => {
    assert.equal(e.name, 'MediumRefusal');
    assert.equal(e.code, 'medium_property_unavailable');
    assert.equal(e.refusal, 'medium_property_unavailable: freeSurface');
    assert.equal(e.toJSON().property, 'freeSurface');
    return true;
  });
});

test('vacuum is declined by the envelope — model_not_valid_in_medium: wave-propulsion, vacuum', () => {
  assert.throws(() => vehicleLib.evaluateExplorer(seed.designVector, wave.mediumById('vacuum')), (e) => e.code === 'model_not_valid_in_medium' && e.refusal === 'model_not_valid_in_medium: wave-propulsion, vacuum');
});

test('an undeclared force model fails closed: its own default medium only, refused by name everywhere else', () => {
  const env = wave.envelopeFor('surf-ski');
  assert.equal(env.declared, false);
  assert.deepEqual(env.validIn, ['seawater']);
  assert.doesNotThrow(() => wave.requireModelValidIn('surf-ski', seawater));
  assert.throws(() => wave.requireModelValidIn('surf-ski', wave.mediumById('air')), (e) => e.refusal === 'model_not_valid_in_medium: surf-ski, air');
  assert.equal(wave.envelopeFor('wave-propulsion').declared, true);
});

test('a position outside the medium\'s band is medium_outside_validity', () => {
  assert.doesNotThrow(() => wave.requireWithinValidity(seawater, -2));
  assert.throws(() => wave.requireWithinValidity(seawater, 0.5), (e) => e.code === 'medium_outside_validity');
  assert.throws(() => wave.requireWithinValidity(seawater, -1500), (e) => e.code === 'medium_outside_validity');
});
