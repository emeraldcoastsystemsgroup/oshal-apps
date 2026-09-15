/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-160 S1's guard, and it crosses the boundary the slice claims: the REAL MJCF generators are driven with each of the three media and the emitted scene is asserted to differ accordingly (the gravity vector the plant reads, and which medium answered), never a string match on a constant. Each named refusal is raised and checked by its own name. The committed property rows are checked against the values the other labs hold — 1025 kg/m^3 and 1.05e-6 m^2/s from ocean-lab, ISA sea level from aero-lab — and the package is checked for a SECOND copy of either, which is the defect ADR-160 exists to stop. The explorer hull's numbers are checked against the published design study, and the fall against h - g t^2 / 2.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const E = require('../routes/engine');

const ROW = require('../routes/engine/medium/medium-properties.json');
const HULL_FIXTURE = path.join(__dirname, '..', 'engine', 'tests', 'fixtures', 'explorer-hull-air.xml');
const SRC = path.join(__dirname, '..', 'src-routes');
const LINES = new RegExp('\r?\n');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);
const gravityOf = (xml) => /<option [^>]*gravity="([^"]*)"/.exec(xml)[1];

/** Every .ts under src-routes, so a literal can be hunted across the whole package source. */
function sources(dir = SRC, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

// ── the record itself (D7) ───────────────────────────────────────────────────

test('a medium carries everything D7 requires it to carry, and never defaults what it cannot answer', () => {
  assert.deepEqual([...E.MEDIUM_IDS], ['vacuum', 'air', 'seawater']);
  for (const m of E.allMedia()) {
    assert.equal(m.gravityMps2.length, 3, `${m.id}: gravity is a VECTOR, so zero-g and a tilted bench need no second concept`);
    assert.equal(typeof m.densityKgM3, 'number');
    assert.equal(typeof m.dynamicViscosityPaS, 'number', `${m.id}: dynamic, because that is what an atmosphere produces`);
    assert.ok(m.freeSurface === null, `${m.id}: nothing in this package models a free surface, and the record says so`);
    assert.equal(m.validity.coordinate, 'heightM');
    assert.ok(m.validity.maxM > m.validity.minM && m.validity.why.length > 40, `${m.id}: a band with the reason it is that band`);
    assert.ok(Object.keys(m.provenance).length >= 3, `${m.id}: every value says where it came from`);
  }
  const vac = E.mediumById('vacuum');
  assert.equal(vac.densityKgM3, 0);
  assert.equal(vac.field, null, 'a vacuum has nothing in it to move');
  assert.equal(vac.speedOfSoundMs, null);
  assert.equal(vac.temperatureK, null);
  const sea = E.mediumById('seawater');
  assert.equal(sea.speedOfSoundMs, null, 'ocean-lab commits no speed of sound, so this row carries none rather than a default');
  assert.equal(sea.temperatureK, null, '"coastal temperature" is not a temperature');
  assert.equal(E.mediumById('helium'), null, 'a medium this lab cannot answer for is NOT silently substituted');
});

test('a still field is an answer by name, with an analytic gradient, not a missing value', () => {
  for (const id of ['air', 'seawater']) {
    const f = E.mediumById(id).field;
    assert.equal(f.model, 'still', `${id}: this lab models no wind, wave or current and says which`);
    const s = f.sample(1, 2, 3, 4.5);
    assert.deepEqual([...s.velocityMs], [0, 0, 0]);
    assert.equal(s.gradientPerS.length, 3);
    for (const row of s.gradientPerS) assert.deepEqual([...row], [0, 0, 0], 'the gradient is analytic and identically zero');
    assert.ok(f.why.includes('D3') || f.why.includes('ocean-lab'), `${id}: the field names the lab that does resolve it`);
  }
});

test('kinematic viscosity is DERIVED from mu/rho and is never stored twice', () => {
  const sea = E.mediumById('seawater');
  near(E.kinematicViscosityM2S(sea), 1.05e-6, 1e-18, "seawater's kinematic viscosity comes back out of the dynamic one");
  near(E.kinematicViscosityM2S(E.mediumById('air')), 1.78938e-5 / 1.225, 1e-18, 'air the same way');
  for (const row of Object.values(ROW.media)) {
    assert.ok(!('kinematicViscosityM2S' in row.properties), `${row.id}: the row stores dynamic only — kinematic is mu/rho (D7)`);
  }
});

// ── the shared property values (the note S1 cannot skip) ─────────────────────

test('the property values are ocean-lab\'s and aero-lab\'s own committed numbers, not a third answer', () => {
  const sea = E.mediumById('seawater');
  assert.equal(sea.densityKgM3, 1025, "ocean-lab's SEAWATER_DENSITY_KGM3, which that package declares twice — this row is the value both must agree with");
  near(sea.dynamicViscosityPaS, 1025 * 1.05e-6, 1e-18, "rho * ocean-lab's SEAWATER_KINEMATIC_VISCOSITY_M2S");
  const air = E.mediumById('air');
  assert.equal(air.densityKgM3, 1.225, "aero-lab's ISA sea-level density, the (0.0, 1.2250) pair its atmosphere checks itself against");
  near(air.dynamicViscosityPaS, (1.458e-6 * 288.15 ** 1.5) / (288.15 + 110.4), 1e-10, "Sutherland at 288.15 K on aero-lab's own constants");
  near(air.speedOfSoundMs, Math.sqrt(1.4 * (8314.32 / 28.9644) * 288.15), 1e-4, "aero-lab's GAMMA_AIR, R_AIR and _T0_K");
  assert.equal(air.temperatureK, 288.15);
  assert.ok(ROW.driftTest.checks.length >= 6, 'the row names, for S5, exactly which foreign constants it must equal');
  assert.ok(ROW.driftTest.checks.join(' ').includes('power-budget.ts') && ROW.driftTest.checks.join(' ').includes('rotor-presets.ts'),
    'both of ocean-lab\'s duplicate declarations are named, so S5 can check each');
});

test('the property values live in ONE committed data row, and every surviving copy is pinned by name', () => {
  // An INVENTORY, not a narrowed pattern: the medium-property literals still in this package's code are listed
  // here with the reason each is still there. A NEW one anywhere fails this test; BACKLOG B26 is what closes them.
  const KNOWN = {
    'engine/base/stability.ts': 'pre-existing `export const G = 9.81` — the tip-budget model carries its own gravity. BACKLOG B26.',
    'engine/design/propulsion.ts': 'pre-existing `const G = 9.81` and `airDensity: 1.225` in DEFAULT_SIZING_ASSUMPTIONS — momentum-theory sizing. BACKLOG B26.',
    'engine/physics/arm-mjcf.ts': 'pre-existing literal gravity in the ARM_PREAMBLE <option>: the arm generator is not fed from a medium yet. BACKLOG B26.',
    'engine/physics/hull-mjcf.ts': 'PROSE: the arithmetic 0.0241 m^3 * 1025 kg/m^3 = 24.7025 kg quoted inside EXPLORER_HULL_PROVENANCE. A sentence, not a declaration.',
  };
  const hits = new Map();
  for (const file of sources()) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    for (const line of fs.readFileSync(file, 'utf8').split(LINES)) {
      if (line.trim().startsWith('*') || line.trim().startsWith('//')) continue;
      if (/(^|[^\w.])(1025|1\.225|1\.05e-6|9\.81)([^\w.]|$)/.test(line)) hits.set(rel, (hits.get(rel) ?? 0) + 1);
    }
  }
  assert.deepEqual([...hits.keys()].sort(), Object.keys(KNOWN).sort(),
    'a medium property literal in package CODE is a second answer to "what is seawater" — it belongs in engine/medium/medium-properties.json, and an accepted survivor belongs in KNOWN above with a BACKLOG reference');
  assert.ok(!hits.has('engine/medium/medium.ts'), 'the medium module itself holds NO literal: every value comes from the committed row');
  assert.ok(!hits.has('engine/physics/mjcf.ts'), 'the plant generator holds no literal gravity either — S1 removed the last one');
  assert.equal(E.EARTH_SURFACE_GRAVITY_MPS2, ROW.earthSurfaceGravityMps2);
  assert.equal(E.G_MPS2, E.EARTH_SURFACE_GRAVITY_MPS2, "the arm's bench sizing and the plant's scene read ONE gravity");
});

// ── the medium drives the real generator (the whole point of the slice) ──────

test('the MJCF <option> is fed from the chosen medium, not from a module constant', () => {
  const vacuum = E.mediumById('vacuum');
  const air = E.mediumById('air');
  const vacXml = E.explorerHullMjcf(vacuum);
  const airXml = E.explorerHullMjcf(air);

  // The same generator, three media, and what it emits follows the medium it was given.
  assert.notEqual(vacXml, airXml, 'the scene records WHICH medium answered, the way it records which engine did');
  assert.ok(vacXml.includes('model="explorer-hull-vacuum"') && airXml.includes('model="explorer-hull-air"'));
  assert.ok(airXml.includes('rho = 1.225 kg/m^3') && vacXml.includes('rho = 0 kg/m^3'), 'the medium the run used is written into the scene');
  assert.equal(gravityOf(airXml), '0 0 -9.81');

  // Not a string match on a constant: a DIFFERENT gravity vector reaches the plant unchanged.
  const zeroG = { ...air, id: 'air', gravityMps2: [0, 0, 0] };
  assert.equal(gravityOf(E.explorerHullMjcf(zeroG)), '0 0 0', 'zero-g is expressible because gravity is a vector on the medium');
  const tilted = { ...air, gravityMps2: [1.5, 0, -9.68] };
  assert.equal(gravityOf(E.explorerHullMjcf(tilted)), '1.5 0 -9.68', 'a tilted bench needs no second concept either');

  // And no fluid claim is ever made: D7 is explicit that this generator emits neither.
  for (const xml of [vacXml, airXml]) {
    assert.ok(!/<option[^>]*density=/.test(xml), 'no <option> density: MuJoCo\'s own fluid model must not run');
    assert.ok(!/<option[^>]*viscosity=/.test(xml), 'no <option> viscosity either');
  }
});

test('the drone plant now NAMES the medium it always ran in, and that changed nothing it emits', () => {
  const sim = new E.WorldSim({ sensorSet: E.RECON_MINI });
  const solids = sim.sensingSolids();
  const home = sim.scene.droneHome;
  const fixture = fs.readFileSync(path.join(__dirname, '..', 'engine', 'tests', 'fixtures', 'recon-mini.xml'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(E.droneMjcf('recon-mini', solids, home), fixture, 'the default medium is vacuum, and the shipped fixture is untouched');
  assert.equal(E.droneMjcf('recon-mini', solids, home, E.mediumById('vacuum')), fixture, 'naming it explicitly is the same bytes');
  const air = E.droneMjcf('recon-mini', solids, home, E.mediumById('air'));
  assert.equal(gravityOf(air), '0 0 -9.81', 'air over a room is the same gravity; the plant takes nothing else from a medium');
  assert.throws(() => E.droneMjcf('recon-mini', solids, home, E.mediumById('seawater')),
    (e) => e.refusal === 'model_not_valid_in_medium: rigid-body-plant, seawater', 'a drone scene in water is the same refusal as a hull one');
});

// ── the explorer hull as one solid, from the published study ────────────────

test('the hull is one solid built from the published envelope and all-up mass', () => {
  assert.equal(E.EXPLORER_HULL.envelopeM, 0.3, 'the study\'s 300 mm envelope');
  assert.equal(E.EXPLORER_HULL.bodyDiameterM, 0.28);
  assert.equal(E.EXPLORER_HULL.wingSpanDeployedM, 0.296);
  assert.equal(E.EXPLORER_HULL.tetherM, 2);
  assert.equal(E.EXPLORER_HULL.floatDisplacementL, 24.1);
  assert.equal(E.EXPLORER_HULL.allUpMassKg, 24.7);
  assert.ok(E.EXPLORER_HULL.envelopeM >= E.EXPLORER_HULL.wingSpanDeployedM && E.EXPLORER_HULL.envelopeM >= E.EXPLORER_HULL.bodyDiameterM,
    'the envelope bounds the two dimensions the study tabulates');
  // The published buoyancy closes on the shared seawater row, which is why the mass may be read from it.
  near(E.EXPLORER_HULL.floatDisplacementL / 1000 * E.mediumById('seawater').densityKgM3, E.EXPLORER_HULL.allUpMassKg, 0.005,
    '24.1 L of the seawater row is the published 24.7 kg');
  const i = E.explorerHullInertia();
  assert.equal(i.massKg, 24.7);
  assert.equal(i.halfM, 0.15);
  near(i.ixx, (24.7 * (0.09 + 0.09)) / 12, 1e-12, 'a uniform box about its own centre — an estimate, and it travels as one');
  assert.equal(i.ixx, i.iyy); assert.equal(i.iyy, i.izz);
  assert.ok(E.EXPLORER_HULL_PROVENANCE.allUpMassKg.includes('READ, not quoted'), 'the one number that is a reading says so');
  const xml = E.explorerHullMjcf(E.mediumById('air'));
  assert.ok(xml.includes('mass="24.7"') && xml.includes('size="0.15 0.15 0.15"'), 'one solid, one body, no eleven-part model');
  assert.equal((xml.match(/<body /g) || []).length, 1);
  assert.equal((xml.match(/<geom name=/g) || []).length, 2, 'the floor and the hull, and nothing else');
});

test('the generated hull MJCF is the shipped engine fixture, byte for byte', () => {
  assert.equal(E.explorerHullMjcf(E.mediumById('air')), fs.readFileSync(HULL_FIXTURE, 'utf8').replace(/\r\n/g, '\n'),
    'regenerate engine/tests/fixtures/explorer-hull-air.xml when the generator, the hull or the air row changes');
});

test('in AIR the hull falls at g', () => {
  const drop = E.dropExplorerHull(E.mediumById('air'), { dropHeightM: 2 });
  const g = 9.81;
  near(drop.fall.gMagnitudeMps2, g, 1e-12);
  near(drop.fall.fallTimeS, Math.sqrt((2 * 2) / g), 1e-12, 'sqrt(2h/g)');
  near(drop.fall.impactSpeedMs, Math.sqrt(2 * g * 2), 1e-9, 'sqrt(2gh)');
  for (const p of drop.fall.trace) near(p.heightM, Math.max(0, 2 - (g * p.tS * p.tS) / 2), 5e-4, `h - g t^2/2 at t=${p.tS}`);
  assert.equal(drop.fall.trace[0].heightM, 2);
  near(drop.fall.trace[drop.fall.trace.length - 1].heightM, 0, 5e-4, 'and it reaches the ground');
  assert.equal(gravityOf(drop.mjcf), '0 0 -9.81', 'the plant is handed the same gravity the prediction used');
  assert.ok(drop.notModelled.some((s) => s.includes('free-surface')), 'the answer states what it does not model');
});

// ── the two named refusals, actually raised ─────────────────────────────────

test('model_not_valid_in_medium: the plant declines seawater by name rather than pretending', () => {
  const sea = E.mediumById('seawater');
  for (const call of [() => E.explorerHullMjcf(sea), () => E.dropExplorerHull(sea)]) {
    assert.throws(call, (e) => {
      assert.ok(e instanceof E.MediumRefused);
      assert.equal(e.code, 'model_not_valid_in_medium');
      assert.equal(e.refusal, 'model_not_valid_in_medium: rigid-body-plant, seawater');
      assert.equal(e.model, 'rigid-body-plant');
      assert.equal(e.mediumId, 'seawater');
      assert.ok(e.because.includes('confidently wrong'), 'the refusal carries the author\'s own reason');
      return true;
    });
  }
  // The envelope is declared by the model author and is checked BEFORE any property is read.
  assert.deepEqual([...E.RIGID_BODY_PLANT.validIn], ['vacuum', 'air']);
  assert.ok(!E.RIGID_BODY_PLANT.validIn.includes('seawater'));
  assert.throws(() => E.satisfy(E.RIGID_BODY_PLANT, sea), (e) => e.code === 'model_not_valid_in_medium');
});

test('medium_property_unavailable: the float is refused by name, never a plausible number', () => {
  for (const id of ['vacuum', 'air', 'seawater']) {
    assert.throws(() => E.hullFlotation(E.mediumById(id)), (e) => {
      assert.ok(e instanceof E.MediumRefused);
      assert.equal(e.code, 'medium_property_unavailable');
      assert.equal(e.refusal, 'medium_property_unavailable: freeSurface');
      assert.equal(e.property, 'freeSurface');
      assert.equal(e.mediumId, id);
      return true;
    }, `${id}: nothing here models a free surface, so "does it float" has no answer`);
  }
  // The same refusal reaches a caller who only asked for a drop — the refusal is as much the proof as the fall.
  const air = E.dropExplorerHull(E.mediumById('air'));
  assert.equal(air.flotation.error, 'medium_property_unavailable');
  assert.equal(air.flotation.refusal, 'medium_property_unavailable: freeSurface');
  // And every property a medium cannot answer refuses the same way, rather than defaulting.
  assert.throws(() => E.requireProperty(E.mediumById('seawater'), 'temperatureK'), (e) => e.refusal === 'medium_property_unavailable: temperatureK');
  assert.throws(() => E.requireProperty(E.mediumById('vacuum'), 'field'), (e) => e.refusal === 'medium_property_unavailable: field');
  assert.throws(() => E.kinematicViscosityM2S(E.mediumById('vacuum')), (e) => e.refusal === 'medium_property_unavailable: kinematicViscosityM2S');
});

test('a medium refuses outside its own band rather than extrapolating', () => {
  const air = E.mediumById('air');
  assert.throws(() => E.explorerHullMjcf(air, { dropHeightM: 500 }), (e) => {
    assert.equal(e.code, 'medium_outside_validity');
    assert.equal(e.refusal, 'medium_outside_validity: heightM=500');
    assert.ok(e.because.includes('[-100, 100]'));
    return true;
  }, 'this lab answers one station and will not extrapolate a constant up a column it does not resolve');
  assert.doesNotThrow(() => E.explorerHullMjcf(air, { dropHeightM: 99 }));
  E.requireWithinValidity(air, 0);
  assert.throws(() => E.requireWithinValidity(air, Number.NaN), (e) => e.code === 'medium_outside_validity');
});

test('the envelope is checked before the properties, so a declining model says so first', () => {
  // seawater carries no free surface AND is outside the plant's envelope; the drop must name the envelope.
  assert.throws(() => E.dropExplorerHull(E.mediumById('seawater')), (e) => e.code === 'model_not_valid_in_medium');
  // flotation's envelope admits every medium, so the same medium answers with the PROPERTY refusal instead.
  assert.deepEqual([...E.HULL_FLOTATION.validIn], ['vacuum', 'air', 'seawater']);
  assert.throws(() => E.hullFlotation(E.mediumById('seawater')), (e) => e.code === 'medium_property_unavailable');
});
