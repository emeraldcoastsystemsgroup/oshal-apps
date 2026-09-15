/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Blind recon against the COMPILED engine: the upward ranger
 *                     |                             | clears the climb without a second node, dead reckoning drifts
 *                     |                             | the truth away from the belief, one sweep registers a 10 cm
 *                     |                             | error back under 2 cm, the pad fix re-anchors on landing, the
 *                     |                             | drone-first exploration maps the room with the rover parked and
 *                     |                             | the rover can still plan against it, and a drone whose
 *                     |                             | odometry lies by a third fails honestly instead of flying on.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | B14 recover from lost: a 22 cm belief error is re-registered by the global search and the plan goes on; a yaw error outside the search window flies the registered trail back to the pad where the fix re-anchors; a belief too wrong for both ends grounded and the plan fails honestly; the manual Recover command is one search sweep.
 *
 * Plain node: `node --test tests/engine-localization.test.js`.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { E, runUntilSettled, explored, surfaceAtHeight } = require('./helpers');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

test('the upward ranger is what clears the climb: the spinning LiDAR alone leaves the column above unknown', () => {
  const sim = new E.WorldSim();
  const home = sim.scene.droneHome;
  const sensor = [home[0], home[1], home[2] + E.DRONE_LIDAR_Z];
  const solids = sim.sensingSolids();
  const spinning = new E.VoxelMap(sim.world.map.bounds, sim.world.map.res);
  spinning.integrateSweep(E.lidarSweep(sensor, 0, solids, E.DEFAULT_LIDAR));
  assert.equal(spinning.stateAt([home[0], home[1], 1.2]), E.UNKNOWN, 'a +60° ceiling on the rings cannot see straight up');
  const withRanger = new E.VoxelMap(sim.world.map.bounds, sim.world.map.res);
  withRanger.integrateSweep(E.lidarSweep(sensor, 0, solids, E.DRONE_LIDAR));
  for (let z = home[2] + 0.4; z <= sim.droneLimits.cruiseAlt; z += 0.05) assert.equal(withRanger.stateAt([home[0], home[1], z]), E.FREE, `column known free at ${z.toFixed(2)}`);
  assert.throws(() => sim.droneTakeoff(), /unknown space .* scan first/, 'nothing has scanned yet');
  sim.scanDrone();
  assert.equal(sim.localization.status, 'anchored', 'on the pad with an empty map the pose is anchored by definition');
  assert.doesNotThrow(() => sim.droneTakeoff(), 'one sweep from the pad, no rover, and the climb is legal');
});

test('dead reckoning drifts the truth away from the belief in flight; one sweep registers it back', () => {
  const sim = explored();
  near(sim.localizationError().positionM, 0, 1e-9, 'on the pad after the pad fix the belief is exact');
  sim.droneTakeoff(); sim.advance(10000);
  sim.droneGoto([2.4, 1.0, 1.9]); sim.advance(10000);
  const before = sim.localizationError();
  assert.ok(before.positionM > 0.02 && before.positionM < 0.25, `a climb and a leg without a fix drift a few centimetres (got ${(before.positionM * 100).toFixed(1)} cm)`);
  near(sim.drone.x, 2.4, 1e-9, 'the autopilot believes it arrived exactly');
  sim.scanDrone();
  const after = sim.localizationError();
  assert.equal(sim.localization.status, 'tracking');
  assert.ok(after.positionM < 0.01, `registration pulls the belief onto the map (residual ${(after.positionM * 100).toFixed(2)} cm)`);
  assert.ok(after.yawRad < 0.005, `heading recovered (residual ${((after.yawRad * 180) / Math.PI).toFixed(3)}°)`);
  near(sim.localization.correctionM, before.positionM, 0.012, 'the correction is the drift it undid');
  assert.ok(sim.localization.matched >= 300, `matched ${sim.localization.matched} anchors`);
});

test('an injected 10 cm, 2° pose error is pulled back under 2 cm by one sweep', () => {
  const sim = explored();
  sim.droneTakeoff(); sim.advance(10000);
  sim.scanDrone();
  sim.drone = { ...sim.drone, x: sim.drone.x + 0.07, y: sim.drone.y - 0.07, z: sim.drone.z + 0.02, yaw: sim.drone.yaw + 0.035 };
  const injected = sim.localizationError();
  assert.ok(injected.positionM > 0.09, `injected ${(injected.positionM * 100).toFixed(1)} cm`);
  sim.scanDrone();
  const after = sim.localizationError();
  assert.ok(after.positionM < 0.02, `recovered to ${(after.positionM * 100).toFixed(2)} cm`);
  assert.ok(after.positionM < 0.01, `and in fact under 1 cm (${(after.positionM * 100).toFixed(2)} cm)`);
  assert.ok(after.yawRad < 0.005, `heading within ${((after.yawRad * 180) / Math.PI).toFixed(3)}°`);
  const m = sim.world.map;
  assert.ok(m.anchorCount > 1000, 'the map keeps an anchor per sensed voxel');
});

test('landing on the pad takes the fiducial fix; landing elsewhere keeps tracking', () => {
  const sim = explored();
  sim.droneTakeoff(); sim.advance(10000);
  sim.droneGoto([2.4, 1.0, 1.9]); sim.advance(10000);
  sim.droneGoto([sim.scene.droneHome[0], sim.scene.droneHome[1], 1.9]); sim.advance(10000);
  assert.ok(sim.localizationError().positionM > 0.01, 'drifted on the way back');
  sim.droneLand(); sim.advance(10000);
  assert.equal(sim.drone.mode, 'landed');
  assert.equal(sim.localization.status, 'anchored');
  near(sim.localizationError().positionM, 0, 1e-9, 'the pad fix snaps the belief to the truth');
  assert.ok(sim.events.some((e) => /pad fix/.test(e.text)), 'the fix is on the record');
});

test('drone first: the rover parked, the drone maps the room alone and the rover can plan against that map', () => {
  const sim = new E.WorldSim();
  const park = { ...sim.unit.base };
  const plan = E.planExplore(sim, 14, { droneFirst: true });
  assert.ok(!plan.steps.some((s) => s.kind === 'rover.scan'), 'no base sweep in a drone-first plan');
  assert.match(plan.title, /drone first/);
  const control = new E.ControlAuthority(sim, () => {});
  control.execute(plan, 'explorer');
  const end = runUntilSettled(control, sim, 900);
  assert.equal(end, 'done', control.executor.failure ?? '');
  assert.deepEqual({ x: sim.unit.base.x, y: sim.unit.base.y }, { x: park.x, y: park.y }, 'the rover never moved');
  const st = sim.world.stats();
  assert.ok(st.knownFraction > 0.85, `${(st.knownFraction * 100).toFixed(1)} % known from the air alone`);
  assert.ok(sim.localization.registrations >= 5, `registered ${sim.localization.registrations} sweeps`);
  assert.equal(sim.localization.status, 'anchored', 'home on the pad, re-anchored');
  const basin = surfaceAtHeight(sim, 0.70, 0.04); const counter = surfaceAtHeight(sim, 0.90, 0.04);
  assert.ok(basin && counter, 'the basin and a counter were discovered from the air');
  for (const o of sim.world.objects) {
    const real = sim.scene.objects.map((r) => Math.hypot(r.pose.x - o.centroid[0], r.pose.y - o.centroid[1]));
    assert.ok(Math.min(...real) < 0.06, `${o.id} matches a real object (nearest ${Math.min(...real).toFixed(3)} m) — no phantoms from a drifting drone`);
  }
  assert.ok(sim.world.objectsOn(basin.id).length >= 2, `the dishes in the basin are found (${sim.world.objectsOn(basin.id).length})`);
  const clear = E.planClearSurface(sim, basin.id, counter.id);
  const v = E.validatePlan(sim, clear);
  assert.ok(v.ok, `the rover's plan rehearses on the drone's map: ${v.issues.join('; ')}`);
});

test('odometry that lies by a third: the machine fails closed instead of flying on', () => {
  const limits = { ...E.DEFAULT_DRONE_LIMITS, odometry: { alongPerM: -0.35, crossPerM: 0.02, upPerM: 0, yawRadPerM: 0.03 } };
  const sim = new E.WorldSim({ droneLimits: limits });
  const control = new E.ControlAuthority(sim, () => {});
  control.execute(E.planExplore(sim, 14, { droneFirst: true }), 'explorer');
  const end = runUntilSettled(control, sim, 900);
  assert.equal(end, 'failed', 'a third of the distance unaccounted for is not survivable');
  assert.match(control.executor.failure, /struck|localisation lost|drone down|refused/);
  assert.equal(sim.drone.mode, 'landed', 'the drone is on the floor either way');
});

// ── B14 recover from lost ───────────────────────────────────────────────────────────────────────────────────────

/** A drone that has flown three registered legs east along the kitchen's south half on a set, with no odometry error. */
function flownEast(set) {
  const sim = new E.WorldSim({ droneLimits: { ...E.DEFAULT_DRONE_LIMITS, odometry: null }, sensorSet: set });
  sim.scanDrone(); sim.droneTakeoff(); sim.advance(8000); sim.scanDrone();
  const cruise = sim.droneLimits.cruiseAlt;
  for (const p of [[1.2, 1.0, cruise], [2.0, 0.9, cruise], [2.8, 1.0, cruise]]) { sim.droneGoto(p); sim.advance(6000); sim.scanDrone(); }
  assert.equal(sim.localization.status, 'tracking');
  assert.ok(sim.registeredTrail.length >= 4, 'every registration left a trail point');
  return sim;
}

const onwardPlan = (sim) => ({ task: 'x', title: 'fly on', summary: [], steps: [{ id: 'g1', kind: 'drone.goto', label: 'fly on east', target: [3.4, 1.0, sim.droneLimits.cruiseAlt] }, { id: 'g2', kind: 'drone.land', label: 'land' }] });

test('B14: a drone that has declared itself lost with a 22 cm belief error recovers by the global search and the plan goes on', () => {
  for (const set of [E.RECON_3D, E.RECON_MINI]) {
    const sim = flownEast(set);
    sim.drone = { ...sim.drone, x: sim.drone.x + 0.22 };
    sim.localization = { ...sim.localization, status: 'lost' };
    assert.throws(() => sim.droneGoto([3.4, 1.0, sim.droneLimits.cruiseAlt]), /localisation lost/);
    const log = [];
    const control = new E.ControlAuthority(sim, (r) => log.push(r));
    control.execute(onwardPlan(sim), 'test');
    assert.equal(runUntilSettled(control, sim, 600), 'done', `${set.id}: ${control.executor.failure ?? ''}`);
    const rows = log.map((r) => `${r.command}:${r.outcome}`);
    assert.ok(rows.includes('drone.goto:refused') && rows.includes('drone.recover:accepted') && rows.includes('drone.recover:completed'), rows.join(' '));
    const note = log.find((r) => r.command === 'drone.recover-result');
    assert.match(note.params.text, /recovered by a wide sweep/);
    assert.ok(sim.localizationError().positionM < 0.05, `${set.id} error ${sim.localizationError().positionM}`);
    assert.equal(sim.drone.mode, 'landed'); assert.equal(sim.droneDown, null);
    assert.equal(control.executor.current.steps.length, 3, 'the recovery step was spliced into the plan');
  }
});

test('B14: a loss the search cannot resolve (yaw 34° off, outside its window) ends with the trail back to the pad, where the fix re-anchors', () => {
  const sim = flownEast(E.RECON_3D);
  sim.drone = { ...sim.drone, yaw: sim.drone.yaw + 0.6 };
  sim.localization = { ...sim.localization, status: 'lost' };
  const log = [];
  const control = new E.ControlAuthority(sim, (r) => log.push(r));
  control.execute(onwardPlan(sim), 'test');
  const end = runUntilSettled(control, sim, 900);
  const note = log.find((r) => r.command === 'drone.recover-result');
  assert.ok(note && /landed and re-anchored on the pad/.test(note.params.text), `${end} ${control.executor.failure ?? ''} ${note ? note.params.text : 'no recovery note'}`);
  assert.equal(sim.localization.status, 'anchored');
  assert.equal(sim.drone.mode, 'landed');
  assert.ok(Math.hypot(sim.truth.x - sim.scene.droneHome[0], sim.truth.y - sim.scene.droneHome[1]) < E.PAD_FIX_RADIUS, 'the drone really is on the pad');
  assert.equal(sim.droneDown, null, 'nothing was struck on the way back');
});

test('B14: a loss with a belief too wrong for the search and for the pad ends grounded, and the plan fails honestly', () => {
  const sim = flownEast(E.RECON_3D);
  sim.drone = { ...sim.drone, x: sim.drone.x + 0.3, y: sim.drone.y + 0.3, yaw: sim.drone.yaw + 0.5 };
  sim.localization = { ...sim.localization, status: 'lost' };
  const log = [];
  const control = new E.ControlAuthority(sim, (r) => log.push(r));
  control.execute(onwardPlan(sim), 'test');
  assert.equal(runUntilSettled(control, sim, 900), 'failed');
  assert.match(control.executor.failure, /grounded/);
  assert.match(sim.droneDown, /grounded: still lost/);
  assert.equal(sim.drone.mode, 'landed');
  assert.ok(Math.hypot(sim.truth.x - sim.scene.droneHome[0], sim.truth.y - sim.scene.droneHome[1]) > E.PAD_FIX_RADIUS, 'it landed off the pad, so no fix');
});

test('B14: the manual Recover command is one global-search sweep, and a recovered drone may fly again', () => {
  const sim = flownEast(E.RECON_MINI);
  sim.drone = { ...sim.drone, x: sim.drone.x + 0.3 };
  sim.localization = { ...sim.localization, status: 'lost' };
  const control = new E.ControlAuthority(sim, () => {});
  control.take('roger');
  const r = control.manual({ nodeId: E.DRONE_NODE_ID, command: 'recover' }, 'roger');
  assert.equal(r.status, 'tracking');
  assert.ok(r.correctionM > 0.25 && r.correctionM < 0.35, `corrected ${r.correctionM}`);
  assert.ok(sim.localizationError().positionM < 0.02);
  assert.doesNotThrow(() => sim.droneGoto([3.4, 1.0, sim.droneLimits.cruiseAlt]));
});
