/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | LOOK_AT against the COMPILED engine: a bearing splits between eyes and neck by the eye share, saturated eyes hand the rest to the neck, an eyes-only rig takes everything it can, what neither can reach is the residual (never clamped away), the steps are a `together` with the eyes faster than the neck, the pose compiles and rehearses, and bad bearings or a rig with nothing to look with are refused naming the field.
 *
 * Dependency-free: plain node against routes/engine. Run: node --test "tests/*-*.test.js"
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require(path.join(__dirname, '..', 'routes', 'engine', 'index.js'));

const rows = E.servoMap(E.loadServoCatalog(path.join(__dirname, '..', 'catalog', 'servos.json')).servos);
const templates = E.buildTemplates(rows);
const face = templates.find((t) => t.id === 'six-servo-face');
const eyes = templates.find((t) => t.id === 'two-axis-eyes');
const refused = (fn, field) => { try { fn(); } catch (e) { assert.equal(e.name, 'ContractError', e.message); assert.equal(e.field, field, e.message); return e; } assert.fail(`expected a refusal on ${field}`); };

test('a small bearing splits by the eye share; the eyes move first and faster', () => {
  const la = E.lookAt(face.rig, { azDeg: 20, elDeg: 10 });
  assert.deepEqual(la.pose, { 'eyes.pan': 12, 'eyes.tilt': 6, 'neck.yaw': 8, 'neck.pitch': 4 });
  assert.deepEqual(la.residualDeg, { az: 0, el: 0 }); assert.equal(la.reachable, true);
  assert.equal(la.steps[0].kind, 'together');
  assert.equal(la.steps[0].steps[0].ms, 120); assert.equal(la.steps[0].steps[1].ms, 350);
  assert.deepEqual(la.used, { eyes: 'eyes', neck: 'neck' });
  const c = E.compileSteps(face.rig, { poses: {}, scenarios: {} }, la.steps);
  assert.equal(c.durationMs, 350); assert.equal(c.end['eyes.pan'], 12);
  assert.ok(E.rehearse(face.rig, c).verdict.ok);
});

test('saturated eyes hand the remainder to the neck; beyond both is the residual', () => {
  const la = E.lookAt(face.rig, { azDeg: 60, elDeg: -20 });
  assert.deepEqual(la.pose, { 'eyes.pan': 30, 'eyes.tilt': -12, 'neck.yaw': 30, 'neck.pitch': -8 });
  assert.equal(la.reachable, true);
  const far = E.lookAt(face.rig, { azDeg: 100, elDeg: 0 });
  assert.equal(far.pose['eyes.pan'], 30); assert.equal(far.pose['neck.yaw'], 45);
  assert.deepEqual(far.residualDeg, { az: 25, el: 0 }); assert.equal(far.reachable, false);
  const share = E.lookAt(face.rig, { azDeg: 20, elDeg: 0 }, { eyeShare: 1 });
  assert.equal(share.pose['eyes.pan'], 20); assert.equal(share.pose['neck.yaw'], 0);
});

test('an eyes-only rig takes all it can and reports the rest', () => {
  const la = E.lookAt(eyes.rig, { azDeg: 45, elDeg: 5 });
  assert.deepEqual(la.pose, { 'eyes.pan': 30, 'eyes.tilt': 5 });
  assert.deepEqual(la.residualDeg, { az: 15, el: 0 }); assert.equal(la.reachable, false);
  assert.equal(la.steps.length, 1); assert.equal(la.steps[0].kind, 'move');
  assert.equal(la.used.neck, undefined);
});

test('bad bearings and a rig with nothing to look with are refused', () => {
  refused(() => E.lookAt(face.rig, { azDeg: 200, elDeg: 0 }), 'azDeg');
  refused(() => E.lookAt(face.rig, { azDeg: 0, elDeg: 'up' }), 'elDeg');
  refused(() => E.lookAt(face.rig, { azDeg: 0, elDeg: 0 }, { eyeShare: 2 }), 'eyeShare');
  const jawOnly = E.validateRig({ channels: [face.rig.channels[0]], mechanisms: [{ id: 'jaw', kind: 'jaw', axes: { open: 'eye-pan' } }] });
  refused(() => E.lookAt(jawOnly, { azDeg: 1, elDeg: 0 }), 'rig.mechanisms');
});
