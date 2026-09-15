/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The base and its stability budget against the COMPILED engine:
 *                     |                             | unicycle integration, the lift-dependent speed ceiling, the
 *                     |                             | turn–drive–align controller arriving at rest, lift travel
 *                     |                             | clamps, and the hardware design's numbers reproduced — 67 kg,
 *                     |                             | 9 cm forward shift, ≈134 N·m front capacity, factor 2.0 on the
 *                     |                             | 60 N fridge pull, 1.5 sideways, ≈63 J to tip when stowed.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const E = require(path.join(__dirname, '..', 'routes', 'engine', 'index.js'));
const L = E.DEFAULT_BASE_LIMITS;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);
const stowed = { x: 0, y: 0, yaw: 0, v: 0, w: 0, liftZ: L.liftMin };

test('the unicycle integrates a straight line and clamps speed by lift height', () => {
  let s = stowed;
  for (let i = 0; i < 40; i += 1) s = E.integrateUnicycle(s, 0.5, 0, 0.05, L);
  near(s.x, 1.0, 1e-9); near(s.y, 0, 1e-9);
  const lifted = E.integrateUnicycle({ ...stowed, liftZ: 0.6 }, 0.8, 0, 0.05, L);
  near(lifted.v, L.vLifted, 1e-12, 'raised lift caps forward speed');
  assert.equal(E.speedLimit(stowed, L), L.vStowed);
  assert.equal(E.isStowed({ ...stowed, liftZ: 0.5 }, L), false);
});

test('the drive controller reaches a goal pose at rest within bounded steps', () => {
  let s = { ...stowed, x: 1, y: 1, yaw: 0 };
  const goal = { x: 3, y: 2.5, yaw: Math.PI / 2 };
  let steps = 0; let done = false; const phases = new Set();
  for (; steps < 2000 && !done; steps += 1) { const r = E.driveStep(s, goal, L, 0.05); s = r.next; done = r.done; phases.add(r.phase); }
  assert.ok(done, 'arrived');
  near(s.x, goal.x, 0.03); near(s.y, goal.y, 0.03); near(E.wrapAngle(s.yaw - goal.yaw), 0, 0.02);
  assert.equal(s.v, 0);
  assert.deepEqual([...phases].sort(), ['align', 'done', 'drive', 'turn']);
});

test('the lift travels at its rated speed and clamps to its stops', () => {
  let s = stowed; let done = false; let steps = 0;
  for (; steps < 1000 && !done; steps += 1) { const r = E.liftStep(s, 0.6, L, 0.05); s = r.next; done = r.done; }
  near(s.liftZ, 0.6, 1e-9);
  near(steps * 0.05, 0.3 / L.liftSpeed, 0.1, 'time at 40 mm/s');
  assert.equal(E.liftStep(s, 5, L, 100).next.liftZ, L.liftMax);
  assert.equal(E.liftStep(s, -5, L, 100).next.liftZ, L.liftMin);
});

test('the stability budget reproduces the hardware design working case', () => {
  const items = [...E.HARDWARE_BASE_ITEMS.map((i) => ({ ...i, com: [0, 0, i.com[2]] })), { name: 'arm', mass: 13.6, com: [0.35, 0, 1.20] }, { name: 'payload', mass: 2, com: [0.7, 0, 1.20] }];
  const b = E.tipBudget(items, E.HARDWARE_FOOTPRINT);
  near(b.totalMass, 67.1, 1e-9);
  near(b.com[0], 0.092, 0.001, 'forward shift');
  near(b.com[2], 0.557, 0.003, 'working centre of mass height');
  near(b.momentCapacity.front, 134, 1.5, 'front moment capacity');
  const fridge = E.wrenchCheck(b, 60, 0, 1.1);
  near(fridge.factor, 2.0, 0.05, 'fridge pull factor facing the work');
  assert.equal(fridge.ok, true);
  const lateral = E.tipBudget([...items.slice(0, -2), { name: 'arm', mass: 13.6, com: [0, 0.35, 1.20] }, { name: 'payload', mass: 2, com: [0, 0.7, 1.20] }], E.HARDWARE_FOOTPRINT);
  near(E.wrenchCheck(lateral, 0, 60, 1.1).factor, 1.5, 0.05, 'sideways factor');
  assert.equal(E.wrenchCheck(lateral, 0, 60, 1.1, 1.8).ok, false, 'a stricter factor refuses the sideways pull');
});

test('the stability budget reproduces the stowed dead-stop energy case', () => {
  const items = [...E.HARDWARE_BASE_ITEMS.map((i) => ({ ...i, com: [0, 0, i.com[2]] })), { name: 'arm', mass: 13.6, com: [0, 0, 0.50] }];
  const b = E.tipBudget(items, E.HARDWARE_FOOTPRINT);
  near(b.totalMass, 65.1, 1e-9);
  near(b.com[2], 0.39, 0.01, 'stowed centre of mass height');
  near(b.energyToTip.front, 63, 2, 'energy to tip forward');
  const cruise = E.speedCheck(b, 0.8);
  assert.equal(cruise.ok, true);
  near(cruise.factor, 3.0, 0.2);
  assert.equal(E.speedCheck(b, 2.0).ok, false, 'a 2 m/s dead stop tips the machine');
  assert.equal(E.speedCheck(b, 0).factor, Number.POSITIVE_INFINITY);
});
