/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The discovered world against the COMPILED engine: ray/box hits,
 *                     |                             | voxel carving and the height map, discovery of a table and a
 *                     |                             | mug from sweeps of a synthetic scene, the kitchen explored
 *                     |                             | from nothing (frontier exploration converges, every discovered
 *                     |                             | object matches a real one within 6 cm, no phantoms), the
 *                     |                             | guards refusing motion into unknown space, and the full loop:
 *                     |                             | explore → draft against discovered ids → rehearse → run live →
 *                     |                             | the plates end on the counter the machine found for itself.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { E, runUntilSettled, explored, surfaceAtHeight } = require('./helpers');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

test('rays hit boxes at the right distance and the nearest solid wins', () => {
  near(E.rayBox([0, 0, 1], [1, 0, 0], [2, -1, 0], [3, 1, 2]), 2, 1e-12);
  assert.equal(E.rayBox([0, 0, 1], [-1, 0, 0], [2, -1, 0], [3, 1, 2]), null, 'behind the ray');
  assert.equal(E.rayBox([0, 0, 5], [1, 0, 0], [2, -1, 0], [3, 1, 2]), null, 'misses above');
  assert.equal(E.rayBox([2.5, 0, 1], [1, 0, 0], [2, -1, 0], [3, 1, 2]), 0, 'origin inside');
  const solids = [{ name: 'far', min: [4, -1, 0], max: [5, 1, 2], paint: 'wall' }, { name: 'near', min: [2, -1, 0], max: [3, 1, 2], paint: 'counter' }];
  const hit = E.castRay([0, 0, 1], [1, 0, 0], solids, 8);
  assert.equal(hit.name, 'near'); near(hit.t, 2, 1e-12);
  assert.equal(E.castRay([0, 0, 1], [1, 0, 0], solids, 1.5), null, 'beyond range');
});

test('a ray carves free space, marks its hit occupied inside the solid, and writes the height map', () => {
  const map = new E.VoxelMap({ minX: 0, maxX: 2, minY: 0, maxY: 2, minZ: 0, maxZ: 2 });
  map.integrateRay([1.025, 1.025, 1.5], [1.025, 1.025, 0.9], true);
  assert.equal(map.stateAt([1.025, 1.025, 1.2]), E.FREE, 'carved along the way');
  assert.equal(map.stateAt([1.025, 1.025, 0.89]), E.OCCUPIED, 'the hit is recorded just inside the face');
  assert.equal(map.stateAt([1.025, 1.025, 0.92]), E.FREE, 'the air above the face stays free');
  near(map.topZ[map.column(1.025, 1.025)], 0.898, 1e-3, 'height map');
  map.integrateRay([0.5, 0.5, 1.0], [0.5, 1.9, 1.0], false);
  assert.equal(map.stateAt([0.5, 1.5, 1.0]), E.FREE);
  assert.equal(map.stateAt([0.5, 1.9, 1.0]), E.FREE, 'a miss frees its end voxel');
  assert.equal(map.stateAt([1.5, 1.5, 1.5]), E.UNKNOWN, 'untouched voxels stay unknown');
  assert.ok(map.stats().knownFraction > 0 && map.stats().knownFraction < 0.01);
});

test('sweeps of a synthetic room discover the floor, a table at its height, and a mug at its centroid', () => {
  const solids = [
    { name: 'floor', min: [0, 0, -0.05], max: [3, 3, 0], paint: 'floor' },
    { name: 'table', min: [1.0, 1.0, 0], max: [2.0, 1.6, 0.75], paint: 'table' },
    { name: 'mug', min: [1.45, 1.25, 0.75], max: [1.55, 1.35, 0.85], paint: 'mug' },
    { name: 'wall-n', min: [0, 3, 0], max: [3, 3.05, 2.3], paint: 'wall' }, { name: 'wall-s', min: [0, -0.05, 0], max: [3, 0, 2.3], paint: 'wall' },
    { name: 'wall-e', min: [3, 0, 0], max: [3.05, 3, 2.3], paint: 'wall' }, { name: 'wall-w', min: [-0.05, 0, 0], max: [0, 3, 2.3], paint: 'wall' },
  ];
  const world = new E.WorldModel({ minX: 0, maxX: 3, minY: 0, maxY: 3, minZ: 0, maxZ: 2.3 });
  for (const v of [[0.5, 0.5, 1.9], [2.5, 2.5, 1.9], [1.5, 0.5, 1.9]]) world.map.integrateSweep(E.lidarSweep(v, 0, solids));
  world.refresh();
  const floor = surfaceAtHeight({ world }, 0.0);
  const table = surfaceAtHeight({ world }, 0.75);
  assert.ok(floor && floor.areaM2 > 5, 'the floor is the big surface');
  assert.ok(table, 'the table top is a surface');
  near(table.z, 0.75, 0.012, 'table height');
  assert.ok(table.areaM2 > 0.4 && table.areaM2 < 0.7, `table area ${table.areaM2}`);
  const mug = world.objects.find((o) => o.surfaceId === table.id);
  assert.ok(mug, `an object on the table (objects: ${JSON.stringify(world.objects.map((o) => [o.id, o.guess, o.surfaceId]))})`);
  near(mug.centroid[0], 1.5, 0.03); near(mug.centroid[1], 1.3, 0.03); near(mug.centroid[2], 0.8, 0.02);
  assert.equal(mug.guess, 'mug');
  const again = world.clone(); again.refresh();
  assert.deepEqual(again.objects.map((o) => o.id), world.objects.map((o) => o.id), 'ids are stable across refreshes');
});

test('the kitchen explored from nothing: exploration converges, discoveries match reality, no phantoms', () => {
  const sim = explored(12);
  const st = sim.world.stats();
  assert.ok(st.knownFraction > 0.85, `known fraction ${st.knownFraction}`);
  assert.ok(st.scans >= 5 && st.scans <= 14, `scans ${st.scans}`);
  assert.equal(sim.drone.mode, 'landed');
  const basin = surfaceAtHeight(sim, 0.72);
  assert.ok(basin, 'the sink basin is discovered as a surface at 0.72 m');
  const counters = sim.world.surfaces.filter((s) => Math.abs(s.z - 0.9) < 0.03);
  assert.ok(counters.length >= 2, 'the counters and the island are discovered at 0.9 m');
  const truth = sim.scene.objects.filter((o) => o.location.kind === 'surface' && !E.isEnclosed(sim.scene, o));
  for (const o of sim.world.objects) {
    const match = truth.find((t) => Math.hypot(t.pose.x - o.centroid[0], t.pose.y - o.centroid[1]) < 0.06);
    assert.ok(match, `${o.id} (${o.guess}) at (${o.centroid.map((v) => v.toFixed(2)).join(', ')}) matches a real object`);
    assert.equal(o.guess, match.cls, `${o.id} guessed as ${match.cls}`);
  }
  const plates = sim.world.objects.filter((o) => o.guess === 'plate');
  assert.ok(plates.length >= 2, `both plates are discovered (${plates.length})`);
  assert.ok(E.isFree(sim.grid, sim.scene.basePark), 'the park is mapped free');
});

test('nothing moves into unknown space: base, drone and arm are refused until the map knows the way', () => {
  const sim = new E.WorldSim();
  assert.throws(() => sim.driveTo({ x: 2.4, y: 1.2, yaw: Math.PI / 2 }), /inflated obstacle|crosses an obstacle/, 'unknown ground blocks the base');
  assert.throws(() => sim.droneTakeoff(), /unknown space .* scan first/);
  sim.unit.base = { ...sim.unit.base, liftZ: 0.85 };
  assert.throws(() => sim.moveArmToWorldPose(E.toolDown(sim.unit.base.x, sim.unit.base.y + 0.8, 1.0, 0)), /unknown space|unreachable/);
  sim.scanRover();
  sim.scanDrone();
  assert.doesNotThrow(() => sim.droneTakeoff(), 'after scanning the column above is known');
  sim.advance(8000);
  assert.equal(sim.drone.mode, 'hover');
  assert.throws(() => sim.droneGoto([4.5, 3.6, 1.9]), /unknown space|mapped obstacle/, 'the far corner is still unknown');
});

test('the full loop: explore, draft against discovered ids, rehearse, run live — the plates end on the counter the machine found', () => {
  const sim = explored(12);
  const log = [];
  const control = new E.ControlAuthority(sim, (r) => log.push(r));
  const basin = surfaceAtHeight(sim, 0.72);
  const counter = surfaceAtHeight(sim, 0.9);
  const before = sim.world.objectsOn(basin.id).map((o) => o.id);
  assert.ok(before.length >= 2, `objects on the basin: ${before}`);
  const plan = E.planClearSurface(sim, basin.id, counter.id);
  assert.ok(plan.steps.some((s) => s.kind === 'wrist.scan') && plan.steps.some((s) => s.kind === 'world.expect'));
  assert.ok(plan.steps.every((s) => s.kind !== 'arm.grasp' || s.objectId === '*'), 'grasps name no hidden object id');
  const v = E.validatePlan(sim, plan);
  assert.equal(v.ok, true, JSON.stringify(v.issues));
  assert.deepEqual(E.validatePlan(sim, plan), v, 'rehearsal is deterministic');
  control.execute(plan, 'alice');
  assert.equal(runUntilSettled(control, sim), 'done', control.executor.failure ?? '');
  for (const id of ['plate-1', 'plate-2']) assert.ok(['top:counter-right', 'rack'].includes(E.objectById(sim.scene, id).location.surfaceId), `${id} rests on the real counter (at ${E.objectById(sim.scene, id).location.surfaceId})`);
  assert.equal(log.filter((r) => r.outcome === 'refused' || r.outcome === 'failed').length, 0);
  sim.world.refresh();
  assert.equal(sim.world.objectsOn(basin.id).filter((o) => o.guess === 'plate').length, 0, 'the map no longer shows plates in the basin');
  assert.ok(sim.world.objectsOn(counter.id).length >= 2, 'the map shows them on the counter');
});
