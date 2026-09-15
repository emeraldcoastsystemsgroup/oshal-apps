/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Forward and inverse kinematics of the sim-6 arm against the
 *                     |                             | COMPILED engine: hand-derived poses at q = 0 and q1 = 90°,
 *                     |                             | joint-1 rotation acting as a world-z rotation, reach and mass
 *                     |                             | totals, inverse-kinematics round trips within tolerance, the
 *                     |                             | out-of-reach refusal, multiple distinct solutions, and
 *                     |                             | byte-identical determinism. Dependency-free plain node.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const E = require(path.join(__dirname, '..', 'routes', 'engine', 'index.js'));
const spec = E.SIM_ARM_6;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

test('the compiled engine imports no framework module', () => {
  const fs = require('node:fs');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const file of walk(path.join(__dirname, '..', 'routes', 'engine'))) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /require\("@\//, `${file} must not import the framework`);
  }
});

test('forward kinematics matches the hand-derived zero and shoulder-yaw poses', () => {
  const p0 = E.tcpPose(spec, [0, 0, 0, 0, 0, 0]);
  near(p0.x, 0.35, 1e-12); near(p0.y, 0, 1e-12); near(p0.z, 0.70, 1e-12);
  near(p0.roll, 0, 1e-9); near(p0.pitch, 0, 1e-9); near(p0.yaw, 0, 1e-9);
  const p1 = E.tcpPose(spec, [Math.PI / 2, 0, 0, 0, 0, 0]);
  near(p1.x, 0, 1e-12); near(p1.y, 0.35, 1e-12); near(p1.z, 0.70, 1e-12);
  near(p1.yaw, Math.PI / 2, 1e-9);
});

test('joint 1 rotates the tool about the world z axis', () => {
  const base = E.tcpPose(spec, E.READY_Q);
  const psi = 0.7;
  const turned = E.tcpPose(spec, [psi, ...E.READY_Q.slice(1)]);
  near(turned.x, Math.cos(psi) * base.x - Math.sin(psi) * base.y, 1e-9);
  near(turned.y, Math.sin(psi) * base.x + Math.cos(psi) * base.y, 1e-9);
  near(turned.z, base.z, 1e-9);
});

test('reach, joint origins and the mass budget agree with the hardware design', () => {
  near(E.maxReach(spec), 0.75, 1e-12);
  assert.equal(E.jointOrigins(spec, E.READY_Q).length, 7);
  const { mass, com } = E.armCenterOfMass(spec, [0, 0, 0, 0, 0, 0]);
  near(mass, 13.6, 1e-9, 'arm + tool mass');
  near(com[0], (3.4 * 0.175 + 2.2 * 0.35 + 1.6 * 0.35 + 1.3 * 0.35 + 0.9 * 0.35 + 1.4 * 0.35) / 13.6, 1e-9, 'com x at q=0');
  assert.ok(com[2] > 0.3 && com[2] < 0.7, 'com z sits within the extended arm');
});

test('inverse kinematics round-trips forward kinematics from a perturbed seed', () => {
  const configs = [E.READY_Q, E.STOW_Q, [0.4, 0.9, -1.8, 0.3, -1.4, 0.2], [-0.6, 0.2, -0.8, -0.5, -0.9, 1.0]];
  for (const q of configs) {
    const target = E.tcpPose(spec, q);
    const seed = q.map((v) => v + 0.15);
    const r = E.solveIk(spec, target, seed);
    assert.ok(r.ok, `converged for ${q}: ${JSON.stringify(r)}`);
    assert.ok(r.positionError < 1e-4, `position error ${r.positionError}`);
    assert.ok(r.orientationError < 1e-3, `orientation error ${r.orientationError}`);
    const back = E.tcpPose(spec, r.q);
    near(back.x, target.x, 2e-4); near(back.y, target.y, 2e-4); near(back.z, target.z, 2e-4);
    assert.ok(E.withinLimits(spec, r.q));
  }
});

test('a target beyond the envelope is refused as out_of_reach before any iteration', () => {
  const r = E.solveIk(spec, { x: 1.0, y: 0, z: 0.3, roll: Math.PI, pitch: 0, yaw: 0 }, E.READY_Q);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'out_of_reach');
  assert.equal(r.iterations, 0);
});

test('a reachable tool-down pose has more than one distinct configuration and solving is deterministic', () => {
  const target = { x: 0.37, y: 0, z: 0.37, roll: Math.PI, pitch: 0, yaw: -Math.PI / 2 };
  const a = E.ikSolutions(spec, target, E.READY_Q);
  assert.ok(a.solutions.length >= 2, `expected ≥2 solutions, got ${a.solutions.length}`);
  const b = E.ikSolutions(spec, target, E.READY_Q);
  assert.deepEqual(a.solutions.map((s) => s.q), b.solutions.map((s) => s.q));
  for (const s of a.solutions) {
    const p = E.tcpPose(spec, s.q);
    near(p.x, target.x, 2e-4); near(p.z, target.z, 2e-4);
  }
});

test('joint stepping honours each joint speed and reports arrival', () => {
  const from = [0, 0, 0, 0, 0, 0];
  const to = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  const one = E.stepJoints(spec, from, to, 0.1);
  assert.equal(one.arrived, false);
  near(one.q[0], 0.1, 1e-12, 'joint 1 at 1.0 rad/s');
  near(one.q[5], 0.2, 1e-12, 'joint 6 at 2.0 rad/s');
  let q = from; let steps = 0;
  for (; steps < 100; steps += 1) { const r = E.stepJoints(spec, q, to, 0.1); q = r.q; if (r.arrived) break; }
  assert.ok(steps < 100);
  assert.deepEqual(q, to);
  assert.deepEqual(E.clampToLimits(spec, [9, 9, 9, 9, 9, 9]), spec.joints.map((j) => j.max));
});
