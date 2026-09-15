/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Re-based on an EXPLORED world: every guard now reads the
 *                     |                             | discovered map, so the scripted kitchen tasks run after the
 *                     |                             | explore plan; the scene-zone planner is planClearSceneSurface.
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The simulation environment end to end against the COMPILED
 *                     |                             | engine: the clear-the-sink plan rehearses and executes live
 *                     |                             | with every dish on the rack and every command logged; a
 *                     |                             | rehearsal is byte-identical twice; the e-stop latches, aborts
 *                     |                             | the run and refuses motion until a human resets; taking
 *                     |                             | command pauses the plan and releasing resumes it to
 *                     |                             | completion; manual jogs into furniture and commands without
 *                     |                             | command are refused AND logged; a release over nothing drops
 *                     |                             | the object and says so; empty and full surfaces refuse a plan.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { E, explored } = require('./helpers');

/** Run the control authority until the executor leaves `running`, bounded in simulated time. */
function runUntilSettled(control, sim, limitS = 1200) {
  const start = sim.timeMs;
  while (control.executor.state === 'running' && (sim.timeMs - start) / 1000 < limitS) { control.tick(); if (control.executor.state !== 'running') break; sim.advance(200); }
  control.tick();
}

test('the clear-the-sink plan rehearses successfully and identically twice', () => {
  const sim = explored();
  const plan = E.planClearSceneSurface(sim, 'sink', 'rack');
  assert.equal(plan.task, 'clear-surface');
  assert.ok(plan.steps.length > 30);
  const a = E.validatePlan(sim, plan);
  const b = E.validatePlan(sim, plan);
  assert.equal(a.ok, true, JSON.stringify(a.issues));
  assert.deepEqual(a.finalLocations, { 'plate-1': 'rack', 'plate-2': 'rack', 'mug-1': 'rack', 'milk-1': 'fridge-shelf' });
  assert.equal(a.stepsCompleted, plan.steps.length);
  assert.ok(a.minFrontFactor > 1.5, `front factor ${a.minFrontFactor}`);
  assert.deepEqual(a, b, 'rehearsal is deterministic');
  assert.deepEqual(sim.scene.objects.map((o) => o.location.surfaceId), ['sink', 'sink', 'sink', 'fridge-shelf'], 'the live world is untouched by rehearsal');
});

test('a live execution moves every dish to the rack and logs every step accepted then completed', () => {
  const sim = explored();
  const log = [];
  const control = new E.ControlAuthority(sim, (r) => log.push(r));
  const plan = E.planClearSceneSurface(sim, 'sink', 'rack');
  control.execute(plan, 'alice');
  assert.equal(control.mode, 'auto');
  runUntilSettled(control, sim);
  assert.equal(control.executor.state, 'done', control.executor.failure ?? '');
  assert.equal(control.mode, 'idle');
  for (const o of sim.scene.objects.filter((x) => x.id !== 'milk-1')) assert.equal(o.location.surfaceId, 'rack', `${o.id} on the rack`);
  assert.equal(sim.drone.mode, 'landed');
  assert.equal(log.filter((r) => r.outcome === 'refused' || r.outcome === 'failed').length, 0);
  for (const step of plan.steps) {
    assert.ok(log.some((r) => r.actor === `plan:${step.id}` && r.outcome === 'accepted'), `${step.id} accepted`);
    assert.ok(log.some((r) => r.actor === `plan:${step.id}` && r.outcome === 'completed'), `${step.id} completed`);
  }
  assert.ok(log.every((r) => r.nodeId === E.UNIT_NODE_ID || r.nodeId === E.DRONE_NODE_ID));
});

test('the e-stop latches mid-run, aborts the plan, refuses motion and manual command until a human resets', () => {
  const sim = explored();
  const log = [];
  const control = new E.ControlAuthority(sim, (r) => log.push(r));
  control.execute(E.planClearSceneSurface(sim, 'sink', 'rack'), 'alice');
  for (let i = 0; i < 60; i += 1) { control.tick(); sim.advance(200); }
  assert.equal(control.executor.state, 'running');
  control.estop('alice');
  assert.equal(control.mode, 'estop');
  assert.equal(control.executor.state, 'aborted');
  assert.equal(sim.unit.estop, true);
  assert.equal(sim.unit.base.v, 0);
  assert.throws(() => sim.driveTo({ x: 1, y: 1, yaw: 0 }), /e-stop is latched/);
  assert.throws(() => control.take('alice'), /reset the e-stop first/);
  assert.throws(() => control.execute(E.planClearSceneSurface(sim, 'sink', 'rack'), 'alice'), /e-stop is latched/);
  sim.advance(20000);
  assert.equal(sim.drone.mode, 'landed', 'the drone lands on e-stop');
  control.reset('alice');
  assert.equal(control.mode, 'idle');
  assert.equal(sim.unit.estop, false);
  assert.ok(log.some((r) => r.command === 'e-stop' && r.outcome === 'accepted'));
  assert.ok(log.some((r) => r.command === 'e-stop.reset'));
});

test('taking command pauses the plan; releasing resumes it to completion', () => {
  const sim = explored();
  const control = new E.ControlAuthority(sim, () => {});
  control.execute(E.planClearSceneSurface(sim, 'sink', 'rack'), 'alice');
  for (let i = 0; i < 80; i += 1) { control.tick(); sim.advance(200); }
  const stepBefore = control.executor.stepIndex;
  control.take('alice');
  assert.equal(control.mode, 'manual');
  assert.equal(control.executor.state, 'paused');
  assert.equal(sim.unit.driveGoal, null);
  assert.throws(() => control.take('bob'), /alice already holds command/);
  assert.throws(() => control.release('bob'), /alice holds command/);
  const manual = control.manual({ nodeId: E.UNIT_NODE_ID, command: 'lift', params: { z: 0.5 } }, 'alice');
  assert.equal(manual.ok, true);
  sim.advance(1000);
  control.release('alice');
  assert.equal(control.mode, 'auto');
  assert.equal(control.executor.state, 'running');
  assert.ok(control.executor.stepIndex <= stepBefore, 'the interrupted step is re-issued');
  runUntilSettled(control, sim);
  assert.equal(control.executor.state, 'done', control.executor.failure ?? '');
  for (const o of sim.scene.objects.filter((x) => x.id !== 'milk-1')) assert.equal(o.location.surfaceId, 'rack');
});

test('manual commands are refused without command, refused into furniture, and every refusal is logged', () => {
  const sim = explored();
  const log = [];
  const control = new E.ControlAuthority(sim, (r) => log.push(r));
  assert.throws(() => control.manual({ nodeId: E.UNIT_NODE_ID, command: 'jog', params: { v: 0.2, w: 0, seconds: 0.5 } }, 'alice'), /take command first/);
  assert.equal(log.at(-1).outcome, 'refused');
  control.take('alice');
  sim.unit.base = { ...sim.unit.base, x: 1.25, y: 2.95, yaw: Math.PI / 2 };
  assert.throws(() => control.manual({ nodeId: E.UNIT_NODE_ID, command: 'jog', params: { v: 0.8, w: 0, seconds: 2 } }, 'alice'), /would enter an obstacle/);
  assert.equal(log.at(-1).command, 'jog');
  assert.equal(log.at(-1).outcome, 'refused');
  assert.match(log.at(-1).reason, /obstacle/);
  const away = control.manual({ nodeId: E.UNIT_NODE_ID, command: 'jog', params: { v: -0.3, w: 0, seconds: 1 } }, 'alice');
  assert.equal(away.ok, true);
  sim.advance(1200);
  assert.ok(sim.unit.base.y < 2.95, 'the base backed away');
  assert.throws(() => control.manual({ nodeId: E.UNIT_NODE_ID, command: 'grasp' }, 'alice'), /nothing within grasp tolerance/);
  assert.throws(() => control.manual({ nodeId: 'toaster', command: 'on' }, 'alice'), /unknown node/);
  assert.throws(() => control.manual({ nodeId: E.DRONE_NODE_ID, command: 'goto', params: { x: 1, y: 1, z: 1.5 } }, 'alice'), /airborne|unknown space|mapped obstacle/);
  const lift = control.manual({ nodeId: E.UNIT_NODE_ID, command: 'lift', params: { z: 9 } }, 'alice');
  assert.equal(lift.ok, true);
  assert.equal(sim.unit.liftTarget, sim.baseLimits.liftMax, 'lift clamps to travel');
  assert.ok(log.filter((r) => r.outcome === 'refused').length >= 5);
});

test('a release over nothing drops the object to the floor and the event says so', () => {
  const sim = explored();
  const plate = E.objectById(sim.scene, 'plate-1');
  sim.unit.base = { ...sim.unit.base, x: 1.25, y: 2.95, yaw: Math.PI / 2, liftZ: 0.85 };
  sim.unit.q = [...E.READY_Q];
  sim.moveArmToWorldPose(E.toolDown(plate.pose.x, plate.pose.y, plate.pose.z, 0), 0, 0.2);
  sim.advance(8000);
  assert.equal(sim.grasp(), 'plate-1');
  assert.equal(plate.location.kind, 'gripper');
  sim.moveArmToWorldPose(E.toolDown(1.25, 3.20, 1.10, 0));
  sim.advance(8000);
  const r = sim.release();
  assert.deepEqual(r, { objectId: 'plate-1', surfaceId: null });
  assert.equal(plate.location.kind, 'floor');
  assert.ok(sim.events.some((e) => e.level === 'warn' && /DROPPED plate-1/.test(e.text)));
});

test('planning refuses an empty source and a destination without room', () => {
  const sim = explored();
  assert.throws(() => E.planClearSceneSurface(sim, 'rack', 'sink'), /nothing to move/);
  const rack = E.surfaceById(sim.scene, 'rack');
  for (let i = 0; i < 6; i += 1) sim.scene.objects.push(E.objectOn(`filler-${i}`, 'plate', rack, rack.area.minX + 0.14 + i * 0.05, 3.6));
  assert.throws(() => E.planClearSceneSurface(sim, 'sink', 'rack'), /free slot/);
});
