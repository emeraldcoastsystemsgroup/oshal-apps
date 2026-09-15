/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The compiler and the rehearsal against the COMPILED engine: every template builds from the catalog and EVERY template scenario rehearses ok on its own servos (a template that asks a servo for more than its rated speed fails here — that is how the first BLINK was caught); frames are deterministic and 50 Hz; a `together` lasts as long as its longest child and refuses one axis in two children; runs, repeats, holds and a zero-ms snap expand as written; every pulse stays inside its channel's clamps; the start pose is honoured and an out-of-limit one refused; the caps hold; the servo sim reports lag, saturation, settling and travel.
 *
 * Dependency-free: plain node against routes/engine. Run: node --test "tests/*-*.test.js"
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require(path.join(__dirname, '..', 'routes', 'engine', 'index.js'));

const catalog = E.loadServoCatalog(path.join(__dirname, '..', 'catalog', 'servos.json'));
const rows = E.servoMap(catalog.servos);
const templates = E.buildTemplates(rows);
const skull = templates.find((t) => t.id === 'skull');
const lib = (t) => ({ poses: t.poses, scenarios: t.scenarios });
const run = (name) => [{ kind: 'run', scenario: name }];
const refused = (fn, field) => { try { fn(); } catch (e) { assert.equal(e.name, 'ContractError', e.message); assert.equal(e.field, field, e.message); return e; } assert.fail(`expected a refusal on ${field}`); };

test('the three templates build from the catalog with their libraries', () => {
  assert.deepEqual(templates.map((t) => [t.id, t.rig.channels.length]), [['two-axis-eyes', 2], ['six-servo-face', 6], ['skull', 7]]);
  assert.ok(Object.keys(skull.poses).includes('NEUTRAL') && Object.keys(skull.scenarios).includes('TALK'));
  assert.equal(skull.rig.channels.find((c) => c.id === 'jaw').maxDegPerS, 353);
  assert.equal(skull.rig.channels.find((c) => c.id === 'eye-pan').usPerDeg, 10.56);
});

test('every template scenario rehearses ok on its own servos and within its supply', () => {
  for (const t of templates) {
    for (const name of Object.keys(t.scenarios)) {
      const c = E.compileSteps(t.rig, lib(t), run(name));
      const r = E.rehearse(t.rig, c);
      const p = E.budgetPower(t.rig, rows, c);
      assert.ok(r.verdict.ok, `${t.id}/${name}: ${r.verdict.reasons.join('; ')}`);
      assert.notEqual(p.verdict, 'refuse', `${t.id}/${name}: ${p.reasons.join('; ')}`);
    }
  }
});

test('frames are deterministic, 50 Hz, and every pulse stays inside its clamps', () => {
  const a = E.compileSteps(skull.rig, lib(skull), run('SCARE'));
  const b = E.compileSteps(skull.rig, lib(skull), run('SCARE'));
  assert.deepEqual(a, b);
  assert.equal(a.frameMs, 20);
  assert.equal(a.angles.length, Math.floor(a.durationMs / 20) + 1);
  a.pulses.forEach((row) => row.forEach((us, i) => { const ch = skull.rig.channels[i]; assert.ok(us >= ch.minUs && us <= ch.maxUs, `${ch.id} ${us}`); }));
  assert.deepEqual(a.channelIds, skull.rig.channels.map((c) => c.id));
  assert.deepEqual(a.outputs, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(a.axisIndex['jaw.open'], 6);
  assert.equal(a.end['jaw.open'], 0);
});

test('together lasts as long as its longest child; runs, repeats, holds and snaps expand as written', () => {
  const t = templates[0];
  const L = lib(t);
  const both = E.compileSteps(t.rig, L, [{ kind: 'together', steps: [{ kind: 'move', axes: { 'eyes.pan': 20 }, ms: 100, ease: 'linear' }, { kind: 'move', axes: { 'eyes.tilt': -10 }, ms: 400, ease: 'linear' }] }]);
  assert.equal(both.durationMs, 400);
  assert.equal(both.angles[5][0], 20, 'pan finished at 100 ms');
  assert.equal(both.angles[10][1], -5, 'tilt is half-way at 200 ms (linear)');
  const rep = E.compileSteps(t.rig, L, [{ kind: 'repeat', times: 3, steps: [{ kind: 'move', pose: 'LOOK_LEFT', ms: 100, ease: 'linear' }, { kind: 'hold', ms: 100 }] }]);
  assert.equal(rep.durationMs, 600);
  const nested = E.compileSteps(t.rig, L, [{ kind: 'run', scenario: 'GLANCE_LEFT' }, { kind: 'hold', ms: 50 }]);
  assert.equal(nested.durationMs, 1250 + 50);
  const snap = E.compileSteps(t.rig, L, [{ kind: 'move', pose: 'LOOK_RIGHT', ms: 0, ease: 'in-out' }, { kind: 'hold', ms: 40 }]);
  assert.equal(snap.angles[0][0], 25, 'a zero-ms move is in place at frame 0');
  assert.equal(snap.demandDegPerS[0], 0, 'a snap before the first sampled delta asks nothing of the servo');
  const eased = E.compileSteps(t.rig, L, [{ kind: 'move', axes: { 'eyes.pan': 30 }, ms: 200, ease: 'in-out' }]);
  assert.ok(eased.demandDegPerS[0] > 300 && eased.demandDegPerS[0] < 460, `in-out peaks near 3x the average (${eased.demandDegPerS[0]})`);
});

test('a start pose is honoured; the refusals name their field', () => {
  const t = templates[0]; const L = lib(t);
  const c = E.compileSteps(t.rig, L, [{ kind: 'hold', ms: 40 }], { 'eyes.pan': -12 });
  assert.equal(c.angles[0][0], -12); assert.equal(c.angles[2][0], -12);
  refused(() => E.compileSteps(t.rig, L, [{ kind: 'hold', ms: 40 }], { 'eyes.pan': -40 }), 'start.eyes.pan');
  refused(() => E.compileSteps(t.rig, L, [{ kind: 'hold', ms: 40 }], { 'nose.wiggle': 1 }), 'start.nose.wiggle');
  refused(() => E.compileSteps(t.rig, L, [{ kind: 'together', steps: [{ kind: 'move', pose: 'LOOK_LEFT', ms: 100, ease: 'linear' }, { kind: 'move', pose: 'LOOK_RIGHT', ms: 100, ease: 'linear' }] }]), 'steps[0].steps[1]');
  refused(() => E.compileSteps(t.rig, L, [{ kind: 'move', axes: { 'eyes.pan': 31 }, ms: 100, ease: 'linear' }]), 'steps[0]');
  refused(() => E.compileSteps(t.rig, L, [{ kind: 'repeat', times: 100, steps: [{ kind: 'hold', ms: 1300 }] }]), 'steps[0].steps[0]');
  assert.deepEqual(E.neutralPose(t.rig), { 'eyes.pan': 0, 'eyes.tilt': 0 });
});

test('the servo sim reports lag, saturation, settling and travel', () => {
  const t = templates[0]; const L = lib(t);
  const fast = E.compileSteps(t.rig, L, [{ kind: 'move', axes: { 'eyes.pan': 30 }, ms: 20, ease: 'linear' }, { kind: 'hold', ms: 200 }]);
  const r = E.rehearse(t.rig, fast);
  const pan = r.channels[0];
  assert.ok(pan.maxLagDeg > 5, `a 30° step in one frame lags (${pan.maxLagDeg}°)`);
  assert.ok(pan.saturatedFrames >= 2);
  assert.equal(r.verdict.followed, false); assert.equal(r.verdict.ok, false);
  assert.match(r.verdict.reasons[0], /eye-pan lags/);
  assert.equal(pan.settled, true, 'it still gets there during the hold');
  assert.equal(pan.travelDeg, 30);
  assert.equal(r.actual[0][0], 0, 'frame 0 commands the start angle');
  assert.equal(r.actual[1][0], 10, 'SG90 at 500°/s covers 10° in one 20 ms frame');
  const slow = E.compileSteps(t.rig, L, [{ kind: 'move', axes: { 'eyes.pan': 30 }, ms: 400, ease: 'linear' }, { kind: 'hold', ms: 60 }]);
  const s = E.rehearse(t.rig, slow);
  assert.ok(s.verdict.ok, s.verdict.reasons.join('; '));
  assert.ok(s.channels[0].maxLagDeg < 2);
  assert.equal(s.channels[1].travelDeg, 0, 'the untouched axis does not move');
  const never = E.rehearse(t.rig, E.compileSteps(t.rig, L, [{ kind: 'move', axes: { 'eyes.pan': 30 }, ms: 20, ease: 'linear' }]));
  assert.equal(never.verdict.settled, false, 'no hold after a step the servo cannot follow = never settled');
});
