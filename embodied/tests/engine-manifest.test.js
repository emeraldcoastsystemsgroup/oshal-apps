/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The ADR-151 capability manifest validator against the COMPILED
 *                     |                             | engine: both simulated nodes validate; an unknown kind, an act
 *                     |                             | outside the vocabulary, a safety class below the kind's floor,
 *                     |                             | a kinetic node without e-stop, and a non-finite envelope are
 *                     |                             | each refused with a named issue; confirm rules by class.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-156 D6: the `prop` kind now lives in this vocabulary, so
 *                     |                             | it is proved here beside the others — a micro-servo rig at
 *                     |                             | class 1 and a torque rig at class 2 both validate, the five
 *                     |                             | refusals the kind implies each name the rule they broke, and
 *                     |                             | `disarm` joins `e-stop` as an act that removes authority and
 *                     |                             | therefore never waits for a confirm.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const E = require(path.join(__dirname, '..', 'routes', 'engine', 'index.js'));

const unit = { nodeId: 'rover-arm-1', kind: 'mobile-manipulator', model: 'sim-6 on a differential base', safetyClass: 2, senses: ['pose', 'joint-state', 'lift', 'gripper', 'tip-budget'], acts: ['drive-to', 'jog', 'stop', 'lift', 'move-to-pose', 'move-joints', 'grasp', 'release', 'abort', 'e-stop'], envelope: { reachM: 0.75, vStowed: 0.8, vLifted: 0.3 } };
const drone = { nodeId: 'mini-drone-1', kind: 'drone', model: 'sim indoor quad', safetyClass: 2, senses: ['pose', 'battery', 'camera'], acts: ['takeoff', 'goto', 'hover', 'land', 'observe', 'abort'], envelope: { maxSpeed: 1.0, ceiling: 2.1 } };

test('both simulated nodes validate and come back typed and copied', () => {
  for (const m of [unit, drone]) {
    const r = E.validateManifest(m);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.manifest, m);
    assert.notEqual(r.manifest.acts, m.acts, 'the validated manifest is a copy');
  }
});

test('every malformed shape is refused with a named issue', () => {
  const refuse = (patch, pattern) => {
    const r = E.validateManifest({ ...unit, ...patch });
    assert.equal(r.ok, false, `expected refusal for ${JSON.stringify(patch)}`);
    assert.ok(r.issues.some((i) => pattern.test(i)), `issues ${JSON.stringify(r.issues)} lack ${pattern}`);
  };
  refuse({ kind: 'toaster' }, /unknown/);
  refuse({ acts: [...unit.acts, 'launch'] }, /outside the kind's vocabulary/);
  refuse({ senses: ['pose', 'pose'] }, /repeats/);
  refuse({ safetyClass: 1 }, /at least safety class 2/);
  refuse({ safetyClass: 5 }, /must be 0, 1, 2 or 3/);
  refuse({ acts: ['drive-to', 'lift'] }, /must declare e-stop or abort/);
  refuse({ envelope: { reachM: Number.NaN } }, /finite number/);
  refuse({ envelope: [1] }, /object of numbers/);
  refuse({ nodeId: 'Rover Arm' }, /nodeId/);
  assert.equal(E.validateManifest(null).ok, false);
  assert.equal(E.validateManifest('x').ok, false);
});

test('confirm is required for kinetic acts except the ones that stop or shelter', () => {
  const m = E.validateManifest(unit).manifest;
  assert.equal(E.actRequiresConfirm(m, 'grasp'), true);
  assert.equal(E.actRequiresConfirm(m, 'drive-to'), true);
  assert.equal(E.actRequiresConfirm(m, 'e-stop'), false);
  assert.equal(E.actRequiresConfirm(m, 'abort'), false);
  assert.equal(E.actRequiresConfirm(m, 'stop'), false);
  const d = E.validateManifest(drone).manifest;
  assert.equal(E.actRequiresConfirm(d, 'goto'), true);
  assert.equal(E.actRequiresConfirm(d, 'land'), false);
  assert.equal(E.actRequiresConfirm(d, 'observe'), false);
  const light = E.validateManifest({ nodeId: 'lamp-1', kind: 'light', model: 'sim', safetyClass: 1, senses: ['state'], acts: ['on', 'off'], envelope: {} }).manifest;
  assert.equal(E.actRequiresConfirm(light, 'on'), false);
});

// ─── ADR-156 D6: `prop` — an animatronic rig of calibrated servos ─────────────────────────────
// A prop is the vocabulary's first kind whose floor is 1 rather than 0 or 2: an eye gimbal on
// micro servos is low-energy, and the SAME mechanism built with torque servos is kinetic. Both
// shapes are proved, because the difference between them is the whole point of the floor.
const eyes = { nodeId: 'prop-eyes', kind: 'prop', model: 'esp32-pca9685/2ch', safetyClass: 1, senses: ['channel-state', 'controller-hello'], acts: ['pose', 'scenario', 'look-at', 'jog', 'arm', 'disarm'], envelope: { channels: 2, maxDegPerS: 300, supplyVolts: 5, supplyAmps: 2, stallKgCm: 1.8 } };
const skull = { nodeId: 'prop-skull', kind: 'prop', model: 'esp32-pca9685/7ch', safetyClass: 2, senses: ['channel-state', 'controller-hello', 'supply'], acts: ['pose', 'scenario', 'look-at', 'jog', 'arm', 'disarm', 'e-stop'], envelope: { channels: 7, maxDegPerS: 600, supplyVolts: 6, supplyAmps: 5, stallKgCm: 11 } };

test('a prop validates at both ends of its range — a micro-servo rig and a torque rig', () => {
  for (const m of [eyes, skull]) {
    const r = E.validateManifest(m);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.manifest, m);
    assert.notEqual(r.manifest.senses, m.senses, 'the validated manifest is a copy');
  }
  assert.deepEqual(E.KIND_VOCABULARY.prop, {
    senses: ['channel-state', 'controller-hello', 'supply'],
    acts: ['pose', 'scenario', 'look-at', 'jog', 'arm', 'disarm', 'e-stop'],
    minSafetyClass: 1,
  });
});

test('every shape the prop kind refuses names the rule it broke', () => {
  const refuse = (patch, pattern) => {
    const r = E.validateManifest({ ...skull, ...patch });
    assert.equal(r.ok, false, `expected refusal for ${JSON.stringify(patch)}`);
    assert.ok(r.issues.some((i) => pattern.test(i)), `issues ${JSON.stringify(r.issues)} lack ${pattern}`);
  };
  // A prop's acts are the rig's vocabulary, not a drone's: `takeoff` is not a thing a skull does.
  refuse({ acts: [...skull.acts, 'takeoff'] }, /acts entry "takeoff" is outside the kind's vocabulary/);
  // Servo positions come back as channel-state; a prop has no camera in this vocabulary.
  refuse({ senses: [...skull.senses, 'camera'] }, /senses entry "camera" is outside the kind's vocabulary/);
  // Class 0 is a sensor. Anything that can move a mechanism is at least low-energy.
  refuse({ safetyClass: 0 }, /kind prop is at least safety class 1/);
  // The kinetic rule bites the moment a rig claims real torque: no stop, no enrolment.
  refuse({ acts: ['pose', 'scenario', 'look-at', 'jog', 'arm', 'disarm'] }, /must declare e-stop or abort/);
  // The supply is part of the envelope and a supply that is not a number is not a supply.
  refuse({ envelope: { channels: 7, supplyAmps: Number.POSITIVE_INFINITY } }, /envelope\.supplyAmps must be a finite number/);
});

test('disarm removes authority, so like e-stop it never waits for a confirm', () => {
  const m = E.validateManifest(skull).manifest;
  assert.equal(E.actRequiresConfirm(m, 'disarm'), false);
  assert.equal(E.actRequiresConfirm(m, 'e-stop'), false);
  assert.equal(E.actRequiresConfirm(m, 'pose'), true);
  assert.equal(E.actRequiresConfirm(m, 'scenario'), true);
  assert.equal(E.actRequiresConfirm(m, 'look-at'), true);
  assert.equal(E.actRequiresConfirm(m, 'jog'), true);
  assert.equal(E.actRequiresConfirm(m, 'arm'), true, 'arming a kinetic rig is the confirm the vocabulary asks for');
  // A class-1 rig needs no confirm from the vocabulary — a package may still demand one on its
  // own rail (animatronics answers 428 to an unconfirmed arm at every class), and that is the
  // floor working as intended: the kind is the minimum, never the ceiling.
  const low = E.validateManifest(eyes).manifest;
  assert.equal(E.actRequiresConfirm(low, 'arm'), false);
  assert.equal(E.actRequiresConfirm(low, 'disarm'), false);
});

test('the prop kind is vocabulary only — learning the word does not mint a node on the rail', () => {
  // ADR-156 D5 and BACKLOG B20: a package-owned machine caller is refused by the ADR-149 gate, so
  // a prop is driven from the person's browser session, not by enrolling on the swarm rail. The
  // vocabulary and the rail are two different lists and this is the seam between them — if a prop
  // ever heartbeats as a node that has to be a decision, never a side effect of naming the kind.
  assert.throws(
    () => E.validateHeartbeat({ nodeId: 'prop-skull', kind: 'prop', endpointUrl: 'http://127.0.0.1:9000', protocol: 1, engine: 'animatronics', version: '0.2.0', buildHash: 'x', sessions: 0 }),
    /kind must be "plant" or "drone"/,
  );
});
