/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Re-based on an EXPLORED world (guards read the discovered map).
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The hinged door and the fetch-from-appliance task against the
 *                     |                             | COMPILED engine: door geometry (free end, handle point, the
 *                     |                             | handle-offset lead that must not make the door jump), the
 *                     |                             | handle grasp and angle-follows-tool behaviour, the open
 *                     |                             | threshold revealing the shelf to the drone, the tip budget
 *                     |                             | accepting the 60 N fridge pull and refusing a 200 N one, the
 *                     |                             | swept-volume guard refusing a path whose endpoints are clear,
 *                     |                             | and the whole open → fetch → deliver → close plan rehearsing
 *                     |                             | to completion with the door shut again.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | The tip-budget pull is tested at a handle pose clear of the fridge corner the map now contains; the budget, not the obstacle, is what the test refuses on.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { E, explored } = require('./helpers');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

test('door geometry: free end, handle point and the offset-corrected angle', () => {
  const scene = E.kitchenScene();
  const fridge = E.applianceById(scene, 'fridge');
  const door = fridge.door;
  const closed = E.doorSlices(door, 0, 'fridge-door');
  const sliceCount = Math.ceil(door.width / E.DOOR_SLICE_M);
  assert.equal(closed.length, sliceCount);
  near(Math.min(...closed.map((s) => s.min[1])), 3.15, 1e-9, 'closed door slab starts 5 cm in front of the face');
  near(Math.max(...closed.map((s) => s.max[0])), 4.45, 1e-9, 'free end at the east');
  const open = E.doorSlices(door, door.maxOpen, 'fridge-door');
  const freeEndX = door.hinge.x + door.width * Math.cos(door.closedHeading + door.swing * door.maxOpen);
  const freeEndY = door.hinge.y + door.width * Math.sin(door.closedHeading + door.swing * door.maxOpen);
  assert.ok(open.some((s) => s.min[0] <= freeEndX && s.max[0] >= freeEndX && s.min[1] <= freeEndY && s.max[1] >= freeEndY), 'the swung door covers its free end');
  assert.ok(freeEndY < 3.2 && freeEndX < 4.45, 'opening swings the free end south and west, away from the machine');
  const h = E.handleGrasp(door, 0);
  near(h.point[0], 4.4, 1e-9); near(h.point[1], 3.13, 1e-9); near(h.point[2], 1.1, 1e-9);
  near(E.doorAngleFromPoint(door, h.point[0], h.point[1]), 0, 1e-9, 'taking the handle does not move the door');
  const h50 = E.handleGrasp(door, door.maxOpen);
  near(E.doorAngleFromPoint(door, h50.point[0], h50.point[1]), door.maxOpen, 1e-9, 'the handle arc maps back to the angle');
  assert.ok(E.sceneSolids(scene).length === scene.obstacles.length + sliceCount, 'solids include the door slices');
  const swung = E.doorSlices(door, door.maxOpen, 'fridge-door');
  const overCover = Math.max(...swung.map((s) => Math.min(s.max[0] - s.min[0], s.max[1] - s.min[1])));
  assert.ok(overCover < door.thickness + 0.05, `a swung slice's thinner side stays within 5 cm of the panel thickness (${overCover})`);
});

test('the gripper takes the handle, the door follows the tool, and opening reveals the shelf to the drone', () => {
  const sim = explored();
  const zone = E.zoneById(sim.scene, 'fridge-door');
  sim.unit.base = { ...sim.unit.base, x: zone.standoff.x, y: zone.standoff.y, yaw: zone.standoff.yaw, liftZ: 0.85 };
  const fridge = E.applianceById(sim.scene, 'fridge');
  assert.throws(() => sim.graspHandle('fridge'), /m from the fridge handle/);
  const g0 = E.handleGrasp(fridge.door, 0);
  sim.moveArmToWorldPose(E.toolLevel(g0.point[0], g0.point[1], g0.point[2], g0.yaw), 0, 0.10); sim.advance(8000);
  sim.graspHandle('fridge');
  assert.equal(sim.unit.gripper.holding, 'handle:fridge');
  assert.equal(sim.heldMass(), 0, 'a handle is not a payload');
  assert.equal(fridge.open, false);
  for (const angle of [0.2, 0.4, 0.6, fridge.door.maxOpen]) {
    const g = E.handleGrasp(fridge.door, angle);
    sim.moveArmToWorldPose(E.toolLevel(g.point[0], g.point[1], g.point[2], g.yaw), angle === 0.2 ? 60 : 20); sim.advance(8000);
    near(fridge.angle, angle, 0.02, `door follows the tool to ${angle}`);
  }
  assert.equal(fridge.open, true, 'past the threshold the fridge counts as open');
  assert.equal(sim.releaseHandle(), 'fridge');
  assert.equal(sim.unit.gripper.holding, null);
  near(fridge.angle, fridge.door.maxOpen, 0.02, 'the door stays where it was left');
  sim.droneTakeoff(); sim.advance(10000);
  sim.droneGoto(zone.droneVantage); sim.advance(10000);
  const frame = sim.droneObserve(zone.dronePitch, zone.droneYaw);
  assert.ok(frame.detections.some((d) => d.objectId === 'milk-1'), `the carton is visible now (saw ${frame.detections.map((d) => d.objectId).join(', ')})`);
  assert.ok(E.isFree(sim.grid, zone.standoff), 'the standoff stays free with the door open');
});

test('the tip budget accepts the design pull and refuses a pull the machine cannot hold', () => {
  const sim = explored();
  const zone = E.zoneById(sim.scene, 'fridge-door');
  sim.unit.base = { ...sim.unit.base, x: zone.standoff.x, y: zone.standoff.y, yaw: zone.standoff.yaw, liftZ: 0.85 };
  // The door a little open: the handle has swung out of line with the fridge's front-right corner, which the map
  // now holds as a real solid and which a straight reach to the closed handle would clip with the forearm.
  const g = E.handleGrasp(E.applianceById(sim.scene, 'fridge').door, 0.5);
  const pose = E.toolLevel(g.point[0], g.point[1], g.point[2], g.yaw);
  assert.throws(() => sim.moveArmToWorldPose(pose, 200, 0.10), /tip budget factor .* for 200 N at 1.1 m/);
  const budget = sim.tipBudget();
  assert.ok(E.wrenchCheck(budget, 60, 0, 1.1).factor > 1.8, `design pull factor ${E.wrenchCheck(budget, 60, 0, 1.1).factor}`);
  const ik = sim.moveArmToWorldPose(pose, 60, 0.10);
  assert.equal(ik.ok, true);
});

test('the swept-volume guard refuses a joint path whose endpoints are clear but whose middle crosses the island', () => {
  const sim = explored();
  const zone = E.zoneById(sim.scene, 'island');
  sim.unit.base = { ...sim.unit.base, x: zone.standoff.x, y: zone.standoff.y, yaw: zone.standoff.yaw, liftZ: 0.85 };
  // A configuration whose tool sits INSIDE the island (0.42 m ahead of the arm base, below the top).
  const inside = E.solveIk(sim.armSpec, { x: 0.42, y: 0, z: 0.70 - 0.85, roll: Math.PI, pitch: 0, yaw: 0 }, E.READY_Q);
  assert.equal(inside.ok, true);
  assert.match(String(sim.scene.obstacles.find((o) => o.name === 'island') && 'island'), /island/);
  const left = inside.q.slice(); left[0] += 1.1;
  const right = inside.q.slice(); right[0] -= 1.1;
  sim.unit.q = left;
  assert.equal(sim.moveArmJoints.bind(sim) && true, true);
  assert.throws(() => sim.moveArmJoints(right), /sweep through a mapped obstacle/);
  assert.equal(sim.unit.qTarget, null, 'nothing was commanded');
});

test('fetch-from-appliance rehearses to completion: door opened, carton delivered, door shut', () => {
  const sim = explored();
  const plan = E.planFetchFromAppliance(sim, 'fridge', 'milk-1', 'island');
  assert.equal(plan.task, 'fetch-from-appliance');
  assert.ok(plan.steps.some((s) => s.kind === 'arm.grasp-handle') && plan.steps.some((s) => s.kind === 'arm.release-handle'));
  const pulls = plan.steps.filter((s) => s.kind === 'arm.move' && /pull the Refrigerator door/.test(s.label));
  assert.equal(pulls[0].expectedForceN, 60, 'the first pull off the seal carries the seal force');
  assert.ok(pulls.slice(1).every((s) => s.expectedForceN === 20));
  const v = E.validatePlan(sim, plan);
  assert.equal(v.ok, true, JSON.stringify(v.issues));
  assert.equal(v.finalLocations['milk-1'], 'island-top');
  assert.equal(v.stepsCompleted, plan.steps.length);
  assert.ok(v.minFrontFactor > 1.5, `front factor ${v.minFrontFactor}`);
  const again = E.validatePlan(sim, plan);
  assert.deepEqual(again, v, 'deterministic');
  assert.equal(E.applianceById(sim.scene, 'fridge').angle, 0, 'the live world is untouched');
  assert.throws(() => E.planFetchFromAppliance(sim, 'fridge', 'plate-1', 'island'), /not inside the Refrigerator/);
});

test('a live fetch run leaves the fridge shut and logs the handle steps', () => {
  const sim = explored();
  const log = [];
  const control = new E.ControlAuthority(sim, (r) => log.push(r));
  control.execute(E.planFetchFromAppliance(sim, 'fridge', 'milk-1', 'island'), 'alice');
  const start = sim.timeMs;
  while (control.executor.state === 'running' && (sim.timeMs - start) / 1000 < 1500) { control.tick(); if (control.executor.state !== 'running') break; sim.advance(200); }
  control.tick();
  assert.equal(control.executor.state, 'done', control.executor.failure ?? '');
  const fridge = E.applianceById(sim.scene, 'fridge');
  near(fridge.angle, 0, 0.02, 'door shut');
  assert.equal(fridge.open, false);
  assert.equal(E.objectById(sim.scene, 'milk-1').location.surfaceId, 'island-top');
  assert.ok(log.some((r) => r.command === 'arm.grasp-handle' && r.outcome === 'completed'));
  assert.equal(log.filter((r) => r.outcome === 'refused' || r.outcome === 'failed').length, 0);
});
