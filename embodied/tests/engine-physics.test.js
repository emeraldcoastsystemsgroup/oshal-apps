/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The physics lane without a container: the MJCF generated from the parts model is exactly the fixture the engine's own tests and self-test load (so the two cannot drift), its numbers are the parts model's (mass, hull, thrust limits, sensor offsets), the sensor specification is the kinematic raycaster's geometry, the plant's compact frames become the sweeps the map integrates with paint by name, and the simulation on a plant double holds a phase until the plant settles, grounds the drone on a reported contact, senses through the plant, clones the plant for a rehearsal, and still validates and runs a drone-first exploration through every unchanged guard.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { E, runUntilSettled } = require('./helpers');
const { FakePlant } = require('./fake-plant');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);
const FIXTURE = path.join(__dirname, '..', 'engine', 'tests', 'fixtures', 'recon-mini.xml');

test('the generated MJCF for the printed drone is the shipped engine fixture, byte for byte', () => {
  const sim = new E.WorldSim({ sensorSet: E.RECON_MINI });
  const xml = E.droneMjcf('recon-mini', sim.sensingSolids(), sim.scene.droneHome);
  assert.equal(xml, fs.readFileSync(FIXTURE, 'utf8').replace(/\r\n/g, '\n'), 'regenerate engine/tests/fixtures/recon-mini.xml when the generator or the scene changes');
  assert.equal((xml.match(/<motor /g) || []).length, 4);
  assert.equal((xml.match(/<geom name=/g) || []).length, sim.sensingSolids().length + 1, 'one geom per solid plus the hull');
  assert.ok(xml.includes('name="fridge-door"') && xml.includes('name="fridge-door.1"'), 'door slices get unique names');
});

test('the plant numbers are the parts model\'s numbers', () => {
  for (const fit of ['recon-mini', 'recon-3d']) {
    const d = E.buildDrone(fit); const p = E.dronePlant(fit);
    near(p.massKg, d.massBudget.allUpG / 1000, 1e-9, `${fit} mass`);
    near(p.maxThrustPerMotorN, 2 * p.hoverThrustPerMotorN, 1e-9, `${fit} T:W 2`);
    near(p.hullHalfXyM, d.layout.armMm / 1000 / Math.SQRT2 + d.layout.propDiameterMm / 2000 + E.GUARD_RING_M, 1e-9, `${fit} hull`);
    near(p.mastM, d.sensorSet.mastM, 1e-9); near(p.padPlateM, d.sensorSet.padPlateM, 1e-9);
    assert.ok(p.inertia.izz > p.inertia.ixx && p.inertia.ixx > 0, 'a flat body spins hardest about z');
    const xml = E.droneMjcf(fit, new E.WorldSim().sensingSolids(), [0.6, 0.6, 0]);
    assert.ok(xml.includes(`mass="${Number(p.massKg.toFixed(6))}"`));
  }
  const mini = E.dronePlant('recon-mini');
  near(mini.massKg, 0.746, 1e-9); near(mini.hoverThrustPerMotorN, 1.8296, 1e-3);
});

test('the sensor specification is the kinematic raycaster\'s geometry; frames become painted sweeps', () => {
  const spec = E.senseSpec(E.RECON_MINI, E.DEFAULT_INTRINSICS);
  assert.equal(spec.ring.azimuthCount, 450); assert.deepEqual(spec.ring.elevationsDeg, [0]); assert.equal(spec.zenith.rays, 8);
  near(spec.depth.fx, 640 / (2 * Math.tan((35 * Math.PI) / 180)), 1e-9); near(spec.depth.fy, 480 / (2 * Math.tan((25 * Math.PI) / 180)), 1e-9);
  assert.equal(spec.depth.stride, 4); assert.equal(spec.nadir.maxRange, 8);
  const threeD = E.senseSpec(E.RECON_3D, E.DEFAULT_INTRINSICS);
  assert.equal(threeD.ring.elevationsDeg.length, 64); assert.equal(threeD.depth, undefined); assert.equal(threeD.nadir, undefined);
  const solids = new E.WorldSim().sensingSolids();
  const frames = { names: ['floor', 'island'], truth: { x: 1, y: 1, z: 2, yaw: 0, tiltRad: 0, speed: 0 },
    ring: { origin: [1, 1, 2], p: [2.4, 1.8, 0.9], n: [0, 0, 1], t: [1.9], geom: [1], misses: [13, 1, 2] },
    nadir: { origin: [1, 1, 1.98], p: [1, 1, 0], n: [0, 0, 1], t: [1.98], geom: [0], misses: [] } };
  const { sweeps, nadirM } = E.framesToSweeps(frames, solids);
  assert.equal(sweeps.length, 2);
  assert.equal(sweeps[0].hits[0].paint, 'counter', 'the island is painted as a counter, by name');
  assert.deepEqual(sweeps[0].misses, [[13, 1, 2]]);
  near(nadirM, 1.98, 1e-9);
});

function physicsWorld() {
  const probe = new E.WorldSim({ sensorSet: E.RECON_MINI });
  const plant = new FakePlant(probe.sensingSolids(), probe.scene.droneHome);
  return { sim: new E.WorldSim({ sensorSet: E.RECON_MINI, plant }), plant };
}

test('on a plant the belief holds a finished phase until the plant settles, and the truth is the plant\'s', () => {
  const { sim, plant } = physicsWorld();
  sim.scanDrone();
  assert.equal(sim.localization.status, 'anchored');
  near(sim.truth.z, 0.03, 1e-9, 'the pad plate: the plant\'s rest height is the truth');
  sim.droneTakeoff();
  const cruise = sim.droneLimits.cruiseAlt;
  const climbS = (cruise - 0) / sim.droneLimits.climbSpeed;
  sim.advance(climbS * 1000 + 100);
  assert.equal(sim.drone.mode, 'takeoff', 'the belief has reached altitude but the plant lags: the phase is held');
  sim.advance(3000);
  assert.equal(sim.drone.mode, 'hover');
  near(sim.truth.z, cruise, 0.05);
  assert.ok(plant.steps > 100);
  sim.scanDrone();
  assert.ok(['tracking', 'dead-reckoned'].includes(sim.localization.status), sim.localization.status);
  assert.ok(sim.localizationError().positionM < 0.06, 'the sway is what the belief is off by');
});

test('a contact the plant reports puts the drone down and the plan-level guard sees it', () => {
  const { sim, plant } = physicsWorld();
  sim.scanDrone(); sim.droneTakeoff(); sim.advance(8000);
  plant.forceContact('island');
  sim.advance(50);
  assert.match(sim.droneDown, /struck island at true position/);
  assert.equal(sim.drone.mode, 'landed');
  assert.throws(() => sim.droneTakeoff(), /drone is down/);
});

test('a rehearsal clones the plant; a drone-first exploration validates and runs on the plant through every guard', () => {
  const { sim, plant } = physicsWorld();
  const plan = E.planExplore(sim, 3, { droneFirst: true });
  const v = E.validatePlan(sim, plan);
  assert.ok(v.ok, v.issues.join('; '));
  assert.equal(plant.clones, 1, 'the rehearsal ran on a cloned plant, not the live one');
  const control = new E.ControlAuthority(sim, () => {});
  control.execute(plan, 'physics');
  assert.equal(runUntilSettled(control, sim, 900), 'done', control.executor.failure ?? '');
  assert.ok(sim.world.stats().knownFraction > 0.2);
  assert.equal(sim.drone.mode, 'landed');
  assert.equal(sim.localization.status, 'anchored', 'home again on the pad');
});

test('a drone that overshot the fence ceiling may fly back down to a legal target, but not onward above it', () => {
  const sim = new E.WorldSim({ sensorSet: E.RECON_MINI });
  sim.scanDrone(); sim.droneTakeoff(); sim.advance(8000); sim.scanDrone();
  const cruise = sim.droneLimits.cruiseAlt;
  const high = sim.fence.ceiling + 0.03;
  sim.drone = { ...sim.drone, z: high, mode: 'hover' };
  const target = [sim.drone.x, sim.drone.y, cruise];
  assert.doesNotThrow(() => sim.droneGoto(target), 'straight down into the fence is the way back in');
  const fence = { ...sim.fence, keepOut: [] };
  const hoverAt = (z) => ({ ...sim.drone, z, mode: 'hover', target: null });
  assert.throws(() => E.gotoPoint(hoverAt(high), [sim.drone.x + 1.0, sim.drone.y, high], fence, sim.droneLimits), /above ceiling/, 'a target above the ceiling is still refused');
  assert.throws(() => E.gotoPoint(hoverAt(sim.fence.ceiling + E.FENCE_BACKOUT_M + 0.05), target, fence, sim.droneLimits), /above ceiling by more than/, 'further outside than the backout distance is refused outright');
  assert.equal(E.gotoPoint(hoverAt(high), [sim.drone.x + 1.5, sim.drone.y, cruise], fence, sim.droneLimits).mode, 'moving', 'a long shallow descent is judged from just under the ceiling');
});

test('B18: the guards read the hull from the parts model on both truth models', () => {
  for (const [set, fit] of [[E.RECON_MINI, 'recon-mini'], [E.RECON_3D, 'recon-3d']]) {
    const sim = new E.WorldSim({ sensorSet: set });
    const hull = E.dronePlant(fit);
    near(sim.droneRadiusM, hull.hullHalfXyM, 1e-12, `${fit} hull`);
    near(sim.droneClearanceM, hull.hullHalfXyM + E.DRONE_CLEARANCE_MARGIN_M, 1e-12, `${fit} lateral clearance`);
    near(sim.droneClearanceZM, hull.hullHalfZM + hull.mastM + E.DRONE_CLEARANCE_MARGIN_M, 1e-12, `${fit} vertical clearance: height plus mast plus margin, not the half-width`);
    assert.equal(E.fitForSensorSet(set.id), fit);
    assert.equal(sim.snapshot().drone.radiusM, sim.droneRadiusM);
  }
  const sim = new E.WorldSim({ sensorSet: E.RECON_MINI });
  sim.scanDrone(); sim.droneTakeoff(); sim.advance(8000); sim.scanDrone();
  const z = sim.drone.z;
  assert.match(sim.droneClear([0.15, 1.5, z]) ?? '', /obstacle/, '15 cm from the mapped west wall is inside the 0.178 m hull plus margin (the old 0.10 m body passed here)');
  assert.equal(sim.droneClear([0.6, 1.5, z]), null, '60 cm from the wall is clear');
  assert.equal(sim.droneClear([0.6, 1.5, 2.075]), null, 'the mission altitude 22.5 cm under the ceiling is clear: the vertical clearance is the hull height, not its width');
});

test('B19: the certification gate replays a recorded flight through the fence and the map guards', () => {
  const blind = new E.WorldSim({ sensorSet: E.RECON_MINI });
  const cruise = blind.droneLimits.cruiseAlt;
  const home = blind.scene.droneHome;
  const path = Array.from({ length: 15 }, (_, i) => [home[0] + 0.1 * i, home[1], cruise]);
  const unseen = E.certifyFlight(blind, path);
  assert.equal(unseen.ok, false, 'a map that has seen nothing certifies nothing');
  assert.equal(unseen.refusedCount, path.length); assert.match(unseen.refused[0].reason, /unknown/);
  const { E: engine, runUntilSettled } = require('./helpers');
  const sim = new engine.WorldSim({ sensorSet: E.RECON_MINI });
  const control = new engine.ControlAuthority(sim, () => {});
  control.execute(engine.planExplore(sim, 8, { droneFirst: true }), 'gate');
  assert.equal(runUntilSettled(control, sim, 900), 'done');
  const flown = E.certifyFlight(sim, path);
  assert.ok(flown.ok, `the hover-and-leg path over explored floor passes: ${JSON.stringify(flown.refused[0] ?? null)}`);
  assert.equal(flown.checked, path.length);
  const high = E.certifyFlight(sim, [[home[0], home[1], cruise], [home[0], home[1], sim.fence.ceiling + 0.2]]);
  assert.equal(high.ok, false); assert.match(high.refused[0].reason, /above ceiling/);
  const island = E.certifyFlight(sim, [[2.4, 2.0, 0.5]]);
  assert.equal(island.ok, false, 'a point inside the island is refused by the map guard');
  assert.equal(E.certifyFlight(sim, []).ok, false, 'an empty path is not a flight');
  assert.equal(E.certifyFlight(sim, [[Number.NaN, 0, 0]]).refused[0].reason, 'not a point');
});
