/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Re-based on the discovered map: the fence is what the machine
 *                     |                             | has mapped, so unknown space and mapped furniture refuse.
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The mini drone and its camera against the COMPILED engine:
 *                     |                             | the mode machine and battery, every fence refusal (room,
 *                     |                             | ceiling, floor, keep-out, a path through furniture), pinhole
 *                     |                             | projection, detection of unenclosed objects only, and
 *                     |                             | monocular localisation recovering each dish within 1 cm.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | The drone registers (scans) at each vantage before it observes: pictures form at the TRUE pose, back-projection uses the BELIEVED one.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { E, explored } = require('./helpers');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

test('takeoff climbs to cruise altitude, drains battery, and landing returns to the pad', () => {
  const sim = explored();
  const batteryBefore = sim.drone.battery;
  sim.droneTakeoff();
  assert.equal(sim.drone.mode, 'takeoff');
  sim.advance(10000);
  assert.equal(sim.drone.mode, 'hover');
  near(sim.drone.z, sim.droneLimits.cruiseAlt, 1e-9);
  assert.ok(sim.drone.battery < batteryBefore && sim.drone.battery > batteryBefore - 0.02, 'battery drains while airborne');
  sim.droneLand();
  sim.advance(10000);
  assert.equal(sim.drone.mode, 'landed');
  near(sim.drone.z, sim.scene.droneHome[2], 1e-9);
  assert.throws(() => sim.droneGoto([1, 1, 1.5]), /airborne|unknown space|mapped obstacle/);
});

test('the drone is refused into unknown space, mapped furniture, and beyond the map edge', () => {
  const blind = new E.WorldSim();
  assert.throws(() => blind.droneTakeoff(), /unknown space .* scan first/);
  const sim = explored();
  sim.droneTakeoff(); sim.advance(10000);
  assert.throws(() => sim.droneGoto([-1, 1, 1.5]), /mapped obstacle/, 'outside the map reads as solid');
  assert.throws(() => sim.droneGoto([2.4, 2.0, 0.8]), /mapped obstacle|unknown space/, 'into the island');
  assert.throws(() => sim.droneGoto([4.4, 3.6, 1.9]), /mapped obstacle|unknown space/, 'over the fridge at its height');
  sim.droneGoto([2.4, 1.0, 1.9]);
  sim.advance(10000);
  near(sim.drone.x, 2.4, 1e-9);
  assert.equal(sim.drone.mode, 'hover');
});

test('the pinhole camera projects the optical axis to the principal point and right to larger u', () => {
  const cam = { position: [0, 0, 1], yaw: 0, pitch: 0 };
  const T = E.cameraToWorld(cam);
  const ahead = E.projectPoint(E.DEFAULT_INTRINSICS, T, [2, 0, 1]);
  near(ahead.u, 320, 1e-9); near(ahead.v, 240, 1e-9); near(ahead.depth, 2, 1e-9);
  const right = E.projectPoint(E.DEFAULT_INTRINSICS, T, [2, -0.5, 1]);
  assert.ok(right.u > 320, 'a point to the right of the heading appears right of centre');
  const below = E.projectPoint(E.DEFAULT_INTRINSICS, T, [2, 0, 0.5]);
  assert.ok(below.v > 240, 'a point below the optical axis appears lower in the image');
  assert.equal(E.projectPoint(E.DEFAULT_INTRINSICS, T, [-1, 0, 1]), null, 'behind the camera is not projected');
});

test('observation from the sink vantage detects the dishes, never an enclosed or held object, and localises within 1 cm', () => {
  const sim = explored();
  const fridgeShelf = E.surfaceById(sim.scene, 'fridge-shelf');
  sim.scene.objects.push(E.objectOn('mug-fridge', 'mug', fridgeShelf, 4.6, 3.6));
  sim.droneTakeoff(); sim.advance(10000);
  const zone = E.zoneById(sim.scene, 'sink');
  sim.droneGoto(zone.droneVantage); sim.advance(10000);
  sim.scanDrone(); // register before looking: a picture back-projected from a drifted pose is a wrong measurement
  const frame = sim.droneObserve(zone.dronePitch, zone.droneYaw);
  assert.equal(frame.simulated, true);
  assert.deepEqual(frame.detections.map((d) => d.objectId).sort(), ['mug-1', 'plate-1', 'plate-2']);
  for (const d of frame.detections) {
    const loc = sim.localize(d, frame.camera);
    const truth = E.objectById(sim.scene, d.objectId).pose;
    assert.equal(loc.surfaceId, 'sink');
    near(loc.position[0], truth.x, 0.01, `${d.objectId} x`); near(loc.position[1], truth.y, 0.01, `${d.objectId} y`); near(loc.position[2], truth.z, 1e-6, `${d.objectId} z`);
    assert.ok(d.bbox.u1 > d.bbox.u0 && d.bbox.v1 > d.bbox.v0);
  }
  const fridge = sim.scene.appliances.find((a) => a.id === 'fridge');
  fridge.angle = fridge.door.maxOpen;
  const doorZone = E.zoneById(sim.scene, 'fridge-door');
  sim.droneGoto(doorZone.droneVantage); sim.advance(10000);
  sim.scanDrone();
  const open = sim.droneObserve(doorZone.dronePitch, doorZone.droneYaw);
  assert.ok(open.detections.some((d) => d.objectId === 'mug-fridge'), `an open fridge reveals its shelf (saw ${open.detections.map((d) => d.objectId).join(', ')})`);
  assert.ok(open.detections.some((d) => d.objectId === 'milk-1'), 'the carton on the shelf is seen too');
  assert.ok(frame.outlines.length === sim.solids().length, 'every solid, door included, is outlined for the picture');
});
