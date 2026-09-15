/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The rig contract against the COMPILED engine: defaults fill a channel, the pulse maths (centre, µs/°, reversal), and every refusal names its field — duplicate ids and outputs, an output beyond the board, a software limit whose pulse leaves the hard clamps, a neutral outside the limits, an unknown property, an unknown mechanism role, a required role unbound, a channel bound twice; the pose and scenario contracts refuse unknown axes, out-of-limit angles, bad ids, unknown poses, cycles and the caps; the published contract carries its version.
 *
 * Dependency-free: plain node against routes/engine. Run: node --test "tests/*-*.test.js"
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require(path.join(__dirname, '..', 'routes', 'engine', 'index.js'));

const ch = (over = {}) => ({ id: 'eye-pan', channel: 0, model: 'sg90', minDeg: -30, maxDeg: 30, minUs: 500, maxUs: 2400, usPerDeg: 10.56, ...over });
const rig = (over = {}) => E.validateRig({ channels: [ch(), ch({ id: 'eye-tilt', channel: 1, minDeg: -25, maxDeg: 25 })], mechanisms: [{ id: 'eyes', kind: 'eye-gimbal', axes: { pan: 'eye-pan', tilt: 'eye-tilt' } }], ...over });
const refused = (fn, field) => { try { fn(); } catch (e) { assert.equal(e.name, 'ContractError', e.message); assert.equal(e.field, field, e.message); return e; } assert.fail(`expected a refusal on ${field}`); };

test('a channel takes defaults and the pulse maths follow the calibration', () => {
  const c = E.validateChannel({ id: 'a', channel: 3, model: 'sg90' });
  assert.equal(c.centerUs, 1500); assert.equal(c.usPerDeg, 10); assert.equal(c.reversed, false); assert.equal(c.neutralDeg, 0);
  assert.deepEqual([c.minDeg, c.maxDeg, c.minUs, c.maxUs, c.maxDegPerS], [-45, 45, 500, 2500, 400]);
  assert.equal(E.pulseFor(c, 0), 1500); assert.equal(E.pulseFor(c, 10), 1600); assert.equal(E.pulseFor(c, -45), 1050);
  const r = E.validateChannel({ id: 'a', channel: 3, model: 'sg90', reversed: true, neutralDeg: 5, centerUs: 1450 });
  assert.equal(E.pulseFor(r, 5), 1450); assert.equal(E.pulseFor(r, 15), 1350);
});

test('a rig validates, exposes its axes and the published contract carries its version', () => {
  const r = rig();
  assert.deepEqual([...E.axisMap(r).keys()], ['eyes.pan', 'eyes.tilt']);
  assert.deepEqual(r.supply, { source: 'bench', volts: 6, amps: 3 });
  assert.deepEqual(r.controller, { board: 'pca9685', transport: 'web-serial', baud: 115200 });
  assert.equal(E.validateSupply({ source: 'usb' }).amps, 0.5);
  assert.equal(E.describeRigContract().version, E.CONTRACT_VERSION);
  assert.equal(E.FRAME_HZ, 50);
});

test('every rig refusal names its field', () => {
  refused(() => rig({ channels: [ch(), ch({ channel: 1 })] }), 'rig.channels[1].id');
  refused(() => rig({ channels: [ch(), ch({ id: 'b' })] }), 'rig.channels[1].channel');
  refused(() => rig({ channels: [ch({ channel: 16 })] }), 'rig.channels[0].channel');
  refused(() => E.validateChannel(ch({ minDeg: -120, maxDeg: 120 })), 'channel.minDeg');
  refused(() => E.validateChannel(ch({ neutralDeg: 40 })), 'channel.neutralDeg');
  refused(() => E.validateChannel(ch({ speed: 3 })), 'channel.speed');
  refused(() => E.validateChannel(ch({ minUs: 2400, maxUs: 500 })), 'channel.minUs');
  refused(() => E.validateChannel(ch({ reversed: 'yes' })), 'channel.reversed');
  refused(() => rig({ mechanisms: [{ id: 'eyes', kind: 'eye-gimbal', axes: { pan: 'eye-pan', roll: 'eye-tilt' } }] }), 'rig.mechanisms[0].axes.roll');
  refused(() => rig({ mechanisms: [{ id: 'eyes', kind: 'eye-gimbal', axes: { pan: 'eye-pan' } }] }), 'rig.mechanisms[0].axes.tilt');
  refused(() => rig({ mechanisms: [{ id: 'eyes', kind: 'eye-gimbal', axes: { pan: 'eye-pan', tilt: 'nope' } }] }), 'rig.mechanisms[0].axes.tilt');
  refused(() => rig({ mechanisms: [{ id: 'eyes', kind: 'eye-gimbal', axes: { pan: 'eye-pan', tilt: 'eye-tilt' } }, { id: 'lids', kind: 'eyelids', axes: { upper: 'eye-pan' } }] }), 'rig.mechanisms[1].axes');
  refused(() => rig({ mechanisms: [{ id: 'x', kind: 'blender', axes: {} }] }), 'rig.mechanisms[0].kind');
  refused(() => rig({ controller: { board: 'pca9685', transport: 'carrier-pigeon' } }), 'controller.transport');
  refused(() => rig({ supply: { volts: 5, amps: 3, source: 'sun' } }), 'supply.source');
  refused(() => rig({ extra: 1 }), 'rig.extra');
  const arm = rig({ mechanisms: [{ id: 'arm', kind: 'arm', axes: { shoulder: 'eye-pan', elbow: 'eye-tilt' } }] });
  assert.deepEqual([...E.axisMap(arm).keys()], ['arm.shoulder', 'arm.elbow']);
});

test('poses and scenarios validate against the rig and refuse what is not there', () => {
  const r = rig();
  const poses = E.validatePoses({ LOOK_LEFT: { 'eyes.pan': -25 }, NEUTRAL: { 'eyes.pan': 0, 'eyes.tilt': 0 } }, r);
  assert.equal(poses.LOOK_LEFT['eyes.pan'], -25);
  refused(() => E.validatePoses({ LOOK_LEFT: { 'eyes.pan': -31 } }, r), 'poses.LOOK_LEFT.eyes.pan');
  refused(() => E.validatePoses({ LOOK_LEFT: { 'jaw.open': 1 } }, r), 'poses.LOOK_LEFT.jaw.open');
  refused(() => E.validatePoses({ lookLeft: { 'eyes.pan': 1 } }, r), 'poses.lookLeft');
  refused(() => E.validatePoses({ EMPTY: {} }, r), 'poses.EMPTY');
  const scenarios = E.validateScenarios({ GLANCE: { steps: [{ kind: 'move', pose: 'LOOK_LEFT', ms: 200 }, { kind: 'hold', ms: 100 }, { kind: 'move', pose: 'NEUTRAL', ms: 300, ease: 'out' }] }, TWICE: { steps: [{ kind: 'repeat', times: 2, steps: [{ kind: 'run', scenario: 'GLANCE' }] }] } }, r, poses);
  assert.equal(scenarios.GLANCE.steps[0].ease, 'in-out');
  refused(() => E.validateScenarios({ A: { steps: [{ kind: 'move', pose: 'NOPE', ms: 1 }] } }, r, poses), 'scenarios.A.steps[0].pose');
  refused(() => E.validateScenarios({ A: { steps: [{ kind: 'move', ms: 1 }] } }, r, poses), 'scenarios.A.steps[0]');
  refused(() => E.validateScenarios({ A: { steps: [{ kind: 'move', pose: 'NEUTRAL', ms: 1, ease: 'bounce' }] } }, r, poses), 'scenarios.A.steps[0].ease');
  refused(() => E.validateScenarios({ A: { steps: [{ kind: 'jump', ms: 1 }] } }, r, poses), 'scenarios.A.steps[0].kind');
  refused(() => E.validateScenarios({ A: { steps: [{ kind: 'run', scenario: 'B' }] } }, r, poses), 'scenarios.A.steps[0].scenario');
  refused(() => E.validateScenarios({ A: { steps: [{ kind: 'run', scenario: 'B' }] }, B: { steps: [{ kind: 'run', scenario: 'A' }] } }, r, poses), 'scenarios.A');
  refused(() => E.validateScenarios({ A: { steps: [{ kind: 'repeat', times: 101, steps: [{ kind: 'hold', ms: 1 }] }] } }, r, poses), 'scenarios.A.steps[0].times');
  refused(() => E.validateScenarios({ A: { steps: [{ kind: 'hold', ms: 200000 }] } }, r, poses), 'scenarios.A.steps[0].ms');
  let deep = { kind: 'hold', ms: 1 };
  for (let i = 0; i < 9; i += 1) deep = { kind: 'together', steps: [deep] };
  const e = refused(() => E.validateScenarios({ A: { steps: [deep] } }, r, poses), 'scenarios.A.steps[0]' + '.steps[0]'.repeat(8));
  assert.match(e.message, /deeper than 8/);
  assert.deepEqual(E.describeBehaviourContract().easings, ['linear', 'in', 'out', 'in-out', 'snap']);
});
