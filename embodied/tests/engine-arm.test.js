/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The printed arm against the COMPILED engine (ADR-152 D5 task 3):
 *                     |                             | the gravity torque at a pose a hand can check, the worst-pose
 *                     |                             | search staying above the bench, every joint's drive holding its
 *                     |                             | requirement, the mass budget summing from the parts and servos,
 *                     |                             | every part's CAD program validating against CAD Studio's own
 *                     |                             | compiled contract, the MuJoCo model matching the committed
 *                     |                             | fixture and carrying each drive's torque limit, the sim's own
 *                     |                             | inverse kinematics reaching a pick pose, and the document's
 *                     |                             | tables being generated rather than typed.
 *
 * Plain node: `node --test tests/engine-arm.test.js`.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { E } = require('./helpers');

const FIXTURE = path.join(__dirname, '..', 'engine', 'tests', 'fixtures', 'desk-6-arm.xml');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

test('a joint holds what the masses hanging off it weigh, at the lever they hang on', () => {
  const d = E.buildArm('desk-6');
  // Stretched horizontal: the shoulder at q2 = 0, the elbow turned to put the forearm in line with the upper arm.
  const stretched = [0, 0, -Math.PI / 2, 0, 0, 0];
  const tau = E.gravityTorques(d.spec, stretched, d.fit.payloadKg);
  const l = d.spec.joints;
  const lever = [l[1].a / 2, l[1].a, l[1].a + l[3].d / 2, l[1].a + l[3].d, l[1].a + l[3].d + l[5].d / 2];
  const byHand = 9.81 * (d.linkMassesKg[1] * lever[0] + d.linkMassesKg[2] * lever[1] + d.linkMassesKg[3] * lever[2]
    + d.linkMassesKg[4] * lever[3] + d.linkMassesKg[5] * lever[4] + d.fit.payloadKg * (l[1].a + l[3].d + l[5].d));
  near(Math.abs(tau[1]), byHand, 0.01, 'the shoulder carries every outboard mass at its own lever');
  assert.equal(Math.abs(tau[0]) < 1e-9, true, 'gravity cannot turn a vertical axis');
  assert.ok(Math.abs(tau[2]) < Math.abs(tau[1]), 'the elbow carries less than the shoulder');
});

test('the worst pose a joint is sized for is one the arm can actually take', () => {
  const d = E.buildArm('desk-6');
  for (const j of d.joints) {
    assert.equal(E.aboveTheBench(d.spec, j.worstQ), true, `J${j.joint}'s worst pose keeps the arm above the bench`);
    j.worstQ.forEach((v, i) => assert.ok(v >= d.spec.joints[i].min - 1e-9 && v <= d.spec.joints[i].max + 1e-9, `J${j.joint}'s worst pose is inside the limits`));
    const tau = Math.abs(E.gravityTorques(d.spec, j.worstQ, d.fit.payloadKg)[j.joint - 1]);
    near(tau, j.gravityNm, 1e-6, `J${j.joint}'s reported worst torque is the torque in its reported pose`);
  }
});

test('every joint is given the simplest drive that holds it, and says how much it has in hand', () => {
  const d = E.buildArm('desk-6');
  assert.deepEqual(d.undersized, [], 'no joint is left undersized');
  for (const j of d.joints) {
    assert.ok(j.drive, `J${j.joint} has a drive`);
    assert.ok(j.drive.output.usableNm >= j.requiredNm, `J${j.joint} holds its requirement`);
    assert.ok(j.drive.margin >= 1, `J${j.joint} has margin`);
    near(j.requiredNm, j.gravityNm * 1.3 + j.inertialNm, 1e-9, `J${j.joint}'s requirement is its hold plus the allowance`);
  }
  assert.equal(d.joints[1].drive.cfg.servos, 2, 'the shoulder takes the two servos its bracket has cheeks for');
  assert.ok(d.joints.filter((j) => j.joint !== 2).every((j) => j.drive.cfg.servos === 1), 'no other joint is offered a second servo');
  // The elbow with one servo is the tightest: a heavier payload must not silently pass.
  const heavy = E.buildArmFrom({ ...E.ARM_FITS['desk-6'], payloadKg: 0.6 });
  assert.ok(heavy.joints[1].drive.cfg.ratio > 1 || heavy.joints[2].drive.cfg.ratio > 1, 'four times the payload puts a reduction on the shoulder or the elbow');
  const impossible = E.buildArmFrom({ ...E.ARM_FITS['desk-6'], payloadKg: 5 });
  assert.ok(impossible.undersized.length > 0, 'an arm asked to carry 5 kg names the joints no drive holds');
  assert.match(impossible.undersized[0], /N·m continuous/, 'and says how much they would need');
});

test('the mass budget sums from the printed parts and the servos that ride on them', () => {
  const d = E.buildArm('desk-6');
  const printed = d.parts.filter((p) => p.link > 0).reduce((a, p) => a + p.qty * p.massEachG, 0);
  assert.equal(d.massBudget.printedG, printed, 'printed mass is the parts that move');
  assert.equal(d.massBudget.servosG, (d.servoCount - 1) * d.fit.servo.massG, 'every servo but the one in the base moves');
  near(d.massBudget.movingG, printed + d.massBudget.servosG, 2, 'the moving mass is the printed parts plus the servos');
  near(d.linkMassesKg.reduce((a, m) => a + m, 0) * 1000, d.massBudget.movingG, 2, 'the link masses are that same mass, joint by joint');
  assert.equal(d.servoCount, 8, 'six joints with a doubled shoulder, plus the gripper');
  near(d.reachM, 0.415, 0.001, 'reach from the shoulder');
});

test('every printed part is a CAD Studio program its own contract accepts', () => {
  const contractPath = path.join(__dirname, '..', '..', 'cad-studio', 'routes', 'feature-contract.js');
  if (!fs.existsSync(contractPath)) { assert.ok(true, 'cad-studio is not checked out beside this package; skipped'); return; }
  const contract = require(contractPath);
  const d = E.buildArm('desk-6');
  assert.ok(d.parts.length >= 10, 'the arm is made of parts, not one lump');
  for (const p of d.parts) {
    assert.doesNotThrow(() => contract.validateBase(p.cad.base), `${p.id} base`);
    const list = contract.validateFeatureList(p.cad.features);
    assert.equal(list.length, p.cad.features.length, `${p.id} features`);
    assert.ok(p.massEachG > 0, `${p.id} has an estimated mass`);
  }
  // A servo pocket is the case plus its clearance: the one number every cradle is cut from.
  const servo = d.fit.servo;
  const pocket = E.pocketSize(servo, 'x', 'y');
  near(pocket[0], servo.bodyMm[2] + 2 * E.CRADLE_CLEARANCE_MM, 1e-9, 'the spline axis takes the case height');
  near(pocket[1], servo.bodyMm[0] + 2 * E.CRADLE_CLEARANCE_MM, 1e-9, 'the length axis takes the case length');
});

test('the MuJoCo model is generated from the same design and matches the committed fixture', () => {
  const xml = E.armMjcf('desk-6');
  assert.equal(xml, fs.readFileSync(FIXTURE, 'utf8').replace(/\r\n/g, '\n'), 'regenerate engine/tests/fixtures/desk-6-arm.xml when the generator or the design changes');
  assert.match(xml, /<compiler angle="radian"/, 'angles are radians: MuJoCo reads degrees by default and a 2.6 rad limit becomes 2.6°');
  const plant = E.armPlant('desk-6');
  const d = E.buildArm('desk-6');
  plant.joints.forEach((j, i) => {
    assert.match(xml, new RegExp(`<position name="${j.name}" joint="${j.name}" kp="[0-9.]+" forcelimited="true" forcerange="-?${j.stallNm.toFixed(2)}`), `${j.name} is limited to its drive's stall torque`);
    near(j.stallNm, d.joints[i].drive.output.stallNm, 1e-9, `${j.name} carries the drive's stall`);
    near(j.usableNm, d.joints[i].drive.output.usableNm, 1e-9, `${j.name} carries the drive's continuous torque`);
    near(j.damping, (d.fit.servo.stallNm * d.joints[i].drive.cfg.servos * d.joints[i].drive.cfg.ratio ** 2) / d.fit.servo.noLoadRadS, 1e-9, `${j.name}'s damping is the motor's torque-speed line`);
  });
  assert.equal((xml.match(/type="hinge"/g) || []).length, 7, 'six joints and the jaw');
  assert.equal((xml.match(/<body name="link/g) || []).length, 6, 'one body per joint');
  assert.match(xml, /<geom name="block"/, 'a block to pick');
  assert.match(xml, /<exclude body1="link2" body2="link4"\/>/, 'the arm\'s own lumped links never collide with each other');
});

test('the arm the sim already knows: its own inverse kinematics reaches a pick pose reaches a pick pose on the printed arm', () => {
  const d = E.buildArm('desk-6');
  const seeds = [[0, 0.6, -1.2, 0, -1, 0], [0, 0.95, -2.7, 0, -1.4, 0], [0, -0.67, -0.22, 0, -2.25, 0]];
  const target = { x: 0.25, y: 0, z: 0.05, roll: Math.PI, pitch: 0, yaw: Math.PI };
  const ik = E.ikSolutions(d.spec, target, E.READY_Q, { seeds, maxIterations: 400 }).solutions[0];
  assert.ok(ik, 'a tool-down pose over the bench is reachable');
  const tcp = E.tcpPose(d.spec, ik.q);
  near(tcp.x, target.x, 0.002, 'tool x'); near(tcp.y, target.y, 0.002, 'tool y'); near(tcp.z, target.z, 0.002, 'tool z');
  assert.equal(E.withinLimits(d.spec, ik.q), true, 'the solution is inside the printed brackets limits');
  // The same grasp with the jaw axis turned a half turn asks the tool roll for 180 degrees, which the brackets stop at
  // 170: a planner picks the approach yaw modulo pi, which a two-jaw gripper is free to do.
  const halfTurn = E.ikSolutions(d.spec, { ...target, yaw: 0 }, E.READY_Q, { seeds, maxIterations: 400 });
  assert.equal(halfTurn.solutions.length, 0, 'the half-turned approach is out of the tool rolls range');
  near(Math.abs(halfTurn.bestFailure.q[5]), d.spec.joints[5].max, 0.01, 'and it is the tool roll that runs out');
});

test('the design document is generated: the joint table, the sweep and the parts come from the model', () => {
  const md = E.armDesignMarkdown('desk-6');
  const d = E.buildArm('desk-6');
  assert.match(md, /## How a joint is sized/);
  for (const j of d.joints) assert.ok(md.includes(`J${j.joint} ${j.name}`), `the document lists J${j.joint}`);
  assert.ok(md.includes(d.joints[1].drive.cfg.label), 'the shoulder\'s drive is named');
  assert.ok(md.includes(`${d.repeatability.worstMm} mm`), 'the repeatability budget is the computed one');
  assert.ok(md.includes(`USD ${d.approxUsd}`), 'the price is the summed one');
  assert.ok(md.includes('180 / 180 mm'), 'the sweep shows the lengths that were not chosen');
  assert.ok(md.includes('**160 / 160 mm**'), 'and marks the one that was');
  assert.ok(md.includes('robonine.com'), 'the continuous-duty figure says where it comes from');
});
