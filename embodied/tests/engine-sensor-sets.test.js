/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The drone we print versus the drone we would buy, against the
 *                     |                             | COMPILED engine: the 3-D set stays the default and unchanged;
 *                     |                             | the 2-D ring's scan plane is the flight plane; its first sweep
 *                     |                             | at altitude is dead-reckoned (nothing to match) not lost; the
 *                     |                             | nadir ranger fixes altitude; planar registration recovers an
 *                     |                             | in-plane error against the ring's own layer; and the drone-first
 *                     |                             | exploration maps the kitchen and finds the dishes from a single
 *                     |                             | scan plane plus a downward depth camera.
 *
 * Plain node: `node --test tests/engine-sensor-sets.test.js`.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { E, runUntilSettled, surfaceAtHeight } = require('./helpers');

const mini = () => new E.WorldSim({ sensorSet: E.RECON_MINI });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

test('recon-3d is the default set and its behaviour is the 0.4.0 behaviour', () => {
  const sim = new E.WorldSim();
  assert.equal(sim.sensorSet.id, 'recon-3d');
  assert.equal(sim.sensorSet.registration, 'full');
  near(sim.droneMast(), E.DRONE_LIDAR_Z, 1e-9, 'the 3-D LiDAR sits on the 8 cm mast on the ground and in flight');
  assert.deepEqual(Object.keys(E.DRONE_SENSOR_SETS).sort(), ['recon-3d', 'recon-mini']);
  assert.equal(E.sensorSetById('nonsense').id, 'recon-3d');
});

test('recon-mini: the scan plane is the flight plane; the first sweep at altitude is dead-reckoned, not lost; the nadir ranger fixes altitude', () => {
  const sim = mini();
  near(sim.droneMast(), E.RECON_MINI.padPlateM, 1e-9, 'on the pad the ring sits on the pad plate');
  sim.scanDrone();
  assert.equal(sim.localization.status, 'anchored');
  assert.doesNotThrow(() => sim.droneTakeoff(), 'the zenith ranger clears the climb for the printed drone too');
  sim.advance(10000);
  assert.equal(sim.drone.mode, 'hover');
  near(sim.droneMast(), 0, 1e-9, 'in flight the ring IS the flight plane');
  const before = sim.localizationError();
  assert.ok(before.positionM < 0.01, `the ranger held altitude through the climb (${(before.positionM * 100).toFixed(2)} cm off)`);
  assert.ok(before.yawRad > 0.01, `but the heading drifted (${((before.yawRad * 180) / Math.PI).toFixed(2)}°)`);
  sim.scanDrone();
  assert.notEqual(sim.localization.status, 'lost', 'a sweep with nothing to match is not a contradiction');
  assert.ok(['dead-reckoned', 'tracking'].includes(sim.localization.status), sim.localization.status);
  if (sim.localization.status === 'tracking') assert.ok(sim.localizationError().yawRad < 0.01, 'the walls seen from the pad fix the heading at altitude');
  near(sim.drone.z, sim.truth.z, 0.005, 'altitude from the nadir ranger');
  assert.equal(sim.world.map.stateAt([sim.drone.x + 0.5, sim.drone.y, sim.drone.z]), E.FREE, 'the ring carved the flight layer beside the drone');
});

test('recon-mini: planar registration recovers an injected in-plane error against the ring\'s own layer', () => {
  const sim = mini();
  sim.scanDrone(); sim.droneTakeoff(); sim.advance(10000);
  sim.scanDrone();
  sim.droneGoto([sim.drone.x + 0.6, sim.drone.y, sim.drone.z]); sim.advance(10000);
  sim.scanDrone();
  assert.equal(sim.localization.status, 'tracking', 'the second sweep at altitude matches the first ring layer');
  const clean = sim.localizationError();
  assert.ok(clean.positionM < 0.01, `tracking within ${(clean.positionM * 100).toFixed(2)} cm`);
  sim.drone = { ...sim.drone, x: sim.drone.x + 0.06, y: sim.drone.y - 0.05, yaw: sim.drone.yaw + 0.03 };
  const injected = sim.localizationError();
  assert.ok(injected.positionM > 0.07, `injected ${(injected.positionM * 100).toFixed(1)} cm`);
  sim.scanDrone();
  const after = sim.localizationError();
  assert.equal(sim.localization.status, 'tracking');
  assert.ok(after.positionM < 0.02, `recovered to ${(after.positionM * 100).toFixed(2)} cm`);
  assert.ok(after.yawRad < 0.005, `heading within ${((after.yawRad * 180) / Math.PI).toFixed(3)}°`);
});

test('recon-mini: drone first, the printed drone maps the kitchen from a single scan plane and finds the dishes', () => {
  const sim = mini();
  const control = new E.ControlAuthority(sim, () => {});
  control.execute(E.planExplore(sim, 20, { droneFirst: true }), 'explorer');
  const end = runUntilSettled(control, sim, 1500);
  assert.equal(end, 'done', control.executor.failure ?? '');
  // A single scan plane never knows most of the AIR; what matters is the flight layer it flies in and the surfaces the camera sees.
  const layer = sim.world.map.unknownGrid(sim.droneLimits.cruiseAlt);
  let unknownCells = 0; for (const c of layer.cells) if (c) unknownCells += 1;
  const layerKnown = 1 - unknownCells / layer.cells.length;
  assert.ok(layerKnown > 0.6, `${(layerKnown * 100).toFixed(1)} % of the flight layer known from one scan plane`);
  assert.ok(sim.localization.registrations >= 3, `registered ${sim.localization.registrations} sweeps`);
  assert.equal(sim.localization.status, 'anchored', 'home on the pad');
  const basin = surfaceAtHeight(sim, 0.70, 0.04); const counter = surfaceAtHeight(sim, 0.90, 0.04);
  assert.ok(basin && counter, 'the basin and a counter were discovered by the depth camera');
  for (const o of sim.world.objects) {
    const real = sim.scene.objects.map((r) => Math.hypot(r.pose.x - o.centroid[0], r.pose.y - o.centroid[1]));
    assert.ok(Math.min(...real) < 0.06, `${o.id} matches a real object (nearest ${Math.min(...real).toFixed(3)} m)`);
  }
  assert.ok(sim.world.objectsOn(basin.id).length >= 2, `the dishes in the basin are found (${sim.world.objectsOn(basin.id).length})`);
});
