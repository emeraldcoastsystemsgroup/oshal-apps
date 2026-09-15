/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The world model and navigation grid against the COMPILED
 *                     |                             | engine: the kitchen's free and blocked cells, A* around the
 *                     |                             | island with every leg clear, determinism, an unreachable goal,
 *                     |                             | line-of-sight simplification, resting heights and enclosure.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | B4: every scenario validates; the studio is explored drone-first to done on both sensor sets and its three work heights are discovered — no discovery code per scene.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | B6: a plant resting a centimetre off the pad with a hair of yaw (a real vehicle on its own estimate) clears the climb after its pad sweep -- the sweep is placed by the pose the plant reports with its frames.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const E = require(path.join(__dirname, '..', 'routes', 'engine', 'index.js'));
const { FakePlant } = require('./fake-plant');

test('the kitchen grid frees the park and standoffs and blocks furniture', () => {
  const scene = E.kitchenScene();
  const grid = E.buildGrid(scene.room, scene.obstacles);
  assert.ok(E.isFree(grid, scene.basePark), 'the park is free');
  for (const z of scene.zones) assert.ok(E.isFree(grid, z.standoff), `${z.id} standoff is free`);
  assert.equal(E.isFree(grid, { x: 2.4, y: 2.0 }), false, 'inside the island');
  assert.equal(E.isFree(grid, { x: 2.4, y: 1.45 }), false, 'within the inflation band of the island');
  assert.equal(E.isFree(grid, { x: 0.1, y: 2.0 }), false, 'too close to the wall');
  assert.equal(E.isFree(grid, { x: -1, y: 2 }), false, 'outside the room');
});

test('A* routes from the park to the sink around the island with every leg clear, deterministically', () => {
  const scene = E.kitchenScene();
  const grid = E.buildGrid(scene.room, scene.obstacles);
  const goal = E.zoneById(scene, 'sink').standoff;
  const a = E.planPath(grid, scene.basePark, goal);
  const b = E.planPath(grid, scene.basePark, goal);
  assert.ok(a && a.length > 2);
  assert.deepEqual(a, b, 'two runs give the same path');
  for (const p of a) assert.ok(E.isFree(grid, p), `waypoint (${p.x}, ${p.y}) is free`);
  const legs = E.simplifyPath(grid, a);
  assert.ok(legs.length < a.length, 'simplification removes cells');
  for (let i = 1; i < legs.length; i += 1) assert.ok(E.lineClear(grid, legs[i - 1], legs[i]), `leg ${i} is clear`);
  assert.deepEqual(legs[0], { x: scene.basePark.x, y: scene.basePark.y });
  assert.deepEqual(legs[legs.length - 1], { x: goal.x, y: goal.y });
});

test('an unreachable goal returns null rather than a path through a wall', () => {
  const scene = E.kitchenScene();
  const grid = E.buildGrid(scene.room, scene.obstacles);
  assert.equal(E.planPath(grid, scene.basePark, { x: 2.0, y: 3.7 }), null, 'inside the counter');
  assert.equal(E.planPath(grid, { x: 2.4, y: 2.0 }, scene.basePark), null, 'starting inside the island');
});

test('objects rest at half their height on a surface and fridge contents are enclosed until the door opens', () => {
  const scene = E.kitchenScene();
  const sink = E.surfaceById(scene, 'sink');
  const plate = E.objectOn('p', 'plate', sink, 1.2, 3.6);
  assert.equal(plate.pose.z, sink.z + 0.01);
  assert.equal(E.isEnclosed(scene, plate), false);
  const shelf = E.surfaceById(scene, 'fridge-shelf');
  const milk = E.objectOn('m', 'mug', shelf, 4.6, 3.6);
  assert.equal(E.isEnclosed(scene, milk), true);
  scene.appliances.find((a) => a.id === 'fridge').open = true;
  assert.equal(E.isEnclosed(scene, milk), false);
  assert.equal(E.objectsOn(scene, 'sink').length, 3);
  assert.ok(E.pointInObstacle(scene, [2.4, 2.0, 0.5]).name === 'island');
  assert.equal(E.pointInObstacle(scene, [2.4, 2.0, 1.5]), null, 'above the island top is clear');
  assert.throws(() => E.zoneById(scene, 'garage'), /unknown zone/);
});

const { runUntilSettled } = require('./helpers');

// ── B4 scenarios ────────────────────────────────────────────────────────────────────────────────────────────────

test('B4: every scenario is a valid hidden scene; the studio is explored drone-first to done on both sensor sets with no discovery code of its own', () => {
  assert.deepEqual(E.listScenarios().map((s) => s.id), ['kitchen', 'studio']);
  for (const id of Object.keys(E.SCENARIOS)) assert.deepEqual(E.validateScene(E.scenarioById(id)), [], `${id} is a sound scene`);
  assert.throws(() => E.scenarioById('attic'), /unknown scenario "attic"/);
  const broken = E.scenarioById('studio');
  broken.objects[0].pose.z += 0.1;
  broken.obstacles.push({ name: 'outside', kind: 'fixture', min: [4.4, 0, 0], max: [4.8, 0.3, 0.5] });
  assert.ok(E.validateScene(broken).some((i) => /floats/.test(i)) && E.validateScene(broken).some((i) => /leaves the room/.test(i)));
  for (const set of [E.RECON_MINI, E.RECON_3D]) {
    const sim = new E.WorldSim({ scenario: 'studio', sensorSet: set });
    assert.equal(sim.scene.name, 'studio');
    assert.equal(sim.snapshot().scenario, 'studio');
    const plan = E.planExplore(sim, 8, { droneFirst: true });
    assert.ok(E.validatePlan(sim, plan).ok);
    const control = new E.ControlAuthority(sim, () => {});
    control.execute(plan, 'explorer');
    assert.equal(runUntilSettled(control, sim, 1200), 'done', control.executor.failure ?? '');
    assert.ok(sim.world.stats().knownFraction > 0.3, `${set.id} known ${sim.world.stats().knownFraction}`);
    const heights = sim.world.surfaces.map((s) => Math.round(s.z * 100) / 100);
    // The desk and the bench are open to the sky; the low shelf sits under the high one, so a scanner looking down from cruise sees only the high shelf — the printed drone's forward-looking camera can see under it.
    assert.ok([0.75, 0.9].every((z) => heights.some((h) => Math.abs(h - z) < 0.03)) && [0.8, 1.3].some((z) => heights.some((h) => Math.abs(h - z) < 0.03)), `${set.id} found the desk, the bench and a shelf: ${heights.join(', ')}`);
    assert.equal(sim.drone.mode, 'landed'); assert.equal(sim.localization.status, 'anchored');
  }
});

test('a plant resting a centimetre off the pad clears the climb after its pad sweep', () => {
  // A real vehicle rests where its own estimate says it does -- here the pose a PX4 SIH vehicle reported at rest, a
  // centimetre off the pad it was loaded on. The sweep is expressed in the frame the plant reports WITH the frames, so it
  // is placed on the belief and the drone's own upward ray clears the belief's column. (With a truth snapshot taken
  // before sensing, the whole sweep landed beside the column and takeoff was refused at 0.5 m.)
  const probe = new E.WorldSim({ sensorSet: E.RECON_MINI });
  const plant = new FakePlant(probe.sensingSolids(), [0.59318, 0.58707, -0.00443], { seed: 0, sway: 0 });
  plant.truth.yaw = 0.001757;
  const sim = new E.WorldSim({ sensorSet: E.RECON_MINI, plant });
  assert.equal(sim.drone.x, 0.6, 'the belief starts on the pad');
  sim.scanDrone();
  assert.equal(sim.localization.status, 'anchored');
  assert.doesNotThrow(() => sim.droneTakeoff(), 'the pad sweep clears the climb column');
  assert.equal(sim.drone.mode, 'takeoff');
});
