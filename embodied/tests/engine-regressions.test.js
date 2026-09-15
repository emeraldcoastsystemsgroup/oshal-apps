/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | One targeted case per defect the single scan plane exposed in 0.4.0/0.5.0, each small enough to name the rule it guards: a hit ON a voxel-boundary face names the air voxel by stepping OUT along the normal (never marking the solid's own cell FREE); a hit is recorded INTO the solid along its face normal, not along the ray (no phantom column in front of a grazed top); every sensor set's mission altitude is a voxel centre; a downward hit above the 1.6 m surface cap still counts the column's top as seen; a top is only "with clearance" when the voxel above it is known FREE; planar registration ignores returns whose normal disagrees with the anchor's (a floor return beside a wall is not a wall return); the fence inset keeps every exploration goal a drift buffer inside the room; the rehearsal's completed-step count excludes the executor's own registration sweeps; a landing on the pad re-anchors the belief exactly.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { E } = require('./helpers');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);
const bounds = { minX: 0, maxX: 2, minY: 0, maxY: 2, minZ: 0, maxZ: 2 };

test('a hit exactly on a voxel-boundary face marks the AIR side free and the SOLID side occupied (the air voxel is found by stepping out along the normal)', () => {
  const map = new E.VoxelMap(bounds, 0.05);
  // A wall whose face lies exactly on x = 1.00, struck from x = 0.5 by a horizontal ray; normal points back toward the sensor.
  map.integrateRay([0.5, 1.025, 1.025], [1.0, 1.025, 1.025], true, [-1, 0, 0]);
  assert.equal(map.stateAt([0.975, 1.025, 1.025]), E.FREE, 'the cell in front of the face is free air');
  assert.equal(map.stateAt([1.025, 1.025, 1.025]), E.OCCUPIED, 'the cell behind the face is the solid');
  assert.equal(map.anchorCount, 1, 'the exact hit point is kept as an anchor with its normal');
});

test('a grazing hit on a top face is recorded INTO the solid along the face normal, not along the ray (no phantom column in the air in front)', () => {
  const map = new E.VoxelMap(bounds, 0.05);
  // A counter top at z = 0.90 whose front edge is at y = 1.00; a ray from above-and-in-front grazes the top just behind the edge.
  const hit = [1.0, 1.004, 0.9];
  map.integrateRay([1.0, 0.4, 1.9], hit, true, [0, 0, 1]);
  assert.equal(map.stateAt([1.0, 1.004, 0.875]), E.OCCUPIED, 'the solid under the top face is occupied');
  assert.equal(map.stateAt([1.0, 0.975, 0.875]), E.UNKNOWN, 'the air column in front of the counter is untouched — a nudge along the ray would have marked it occupied');
});

test('every sensor set flies its missions at a voxel centre, never on a layer boundary', () => {
  for (const id of Object.keys(E.DRONE_SENSOR_SETS)) {
    const sim = new E.WorldSim({ sensorSet: E.DRONE_SENSOR_SETS[id] });
    const alt = sim.droneLimits.cruiseAlt;
    const k = (alt - sim.world.map.bounds.minZ) / sim.world.map.res;
    near(k - Math.floor(k), 0.5, 1e-6, `${id}: cruise ${alt} sits at the centre of layer ${Math.floor(k)}`);
  }
});

test('a downward hit above the surface cap marks the column top as SEEN without becoming a surface height', () => {
  const map = new E.VoxelMap(bounds, 0.05);
  map.integrateRay([1.0, 1.0, 1.95], [1.0, 1.0, 1.8], true, [0, 0, 1]);
  const col = map.column(1.0, 1.0);
  assert.equal(map.topSeen[col], 1, 'the fridge top was read — exploration must not chase it forever');
  assert.ok(!Number.isFinite(map.topZ[col]) || map.topZ[col] <= E.SURFACE_Z_CAP, 'nothing above the cap enters the height map');
});

test('a column top counts as "with clearance" only when the voxel above it is KNOWN free', () => {
  const map = new E.VoxelMap(bounds, 0.05);
  // A side hit read by an oblique downward ray: the top height is recorded but the air above was never traversed.
  map.integrateRay([0.2, 1.0, 1.5], [1.0, 1.0, 0.7], true, [-1, 0, 0]);
  const col = map.column(1.0, 1.0);
  assert.ok(Number.isFinite(map.topZ[col]), 'the side hit records a column height');
  assert.ok(Number.isNaN(map.topWithClearance(col)), 'but it is not a top anything may hover over or stand on');
  // Now a true top: a ray straight down through the air above it.
  map.integrateRay([1.0, 1.0, 1.9], [1.0, 1.0, 0.7], true, [0, 0, 1]);
  near(map.topWithClearance(col), 0.7, 0.01, 'a top under known-free air is a top with clearance');
});

test('planar registration ignores returns whose normal disagrees with the anchor (a floor return beside a wall is not a wall return)', () => {
  const map = new E.VoxelMap(bounds, 0.05);
  // A wall on x = 1.5 seen from the pad, anchors every 5 cm along y and z.
  for (let y = 0.1; y < 1.9; y += 0.05) for (let z = 0.1; z < 1.0; z += 0.05) map.integrateRay([0.5, y, z], [1.5, y, z], true, [-1, 0, 0]);
  assert.ok(map.anchorCount > 300);
  // A sweep of FLOOR returns (normal up) that lies 10 cm from the wall plane, plus nothing else.
  const n = 200; const hits = new Float64Array(3 * n); const normals = new Float64Array(3 * n); const names = []; const paints = [];
  for (let i = 0; i < n; i += 1) { hits[3 * i] = 0.9 + (i % 10) * 0.005; hits[3 * i + 1] = 0.2 + Math.floor(i / 10) * 0.08; hits[3 * i + 2] = -1.0; normals[3 * i + 2] = 1; names.push('floor'); paints.push(0); }
  const body = { hits, normals, n, names, paints, misses: new Float64Array(0), m: 0, origin: [0, 0, 1.0] };
  const reg = E.registerSweep(map, body, { x: 0.5, y: 0, z: 1.0, yaw: 0 }, E.PLANAR_REGISTER);
  assert.equal(reg.matched, 0, 'no floor return is scored against the wall plane');
  assert.equal(reg.unobservable, true, 'with nothing to match the sweep is dead-reckoned, never dragged onto the wall');
});

test('exploration goals stay a drift buffer inside the fence for both sensor sets (the map shell does not move the wall inset outward)', () => {
  for (const id of Object.keys(E.DRONE_SENSOR_SETS)) {
    const sim = new E.WorldSim({ sensorSet: E.DRONE_SENSOR_SETS[id] });
    sim.scanDrone(); sim.droneTakeoff(); sim.advance(6000); sim.scanDrone();
    const goal = sim.nextExplorationGoal();
    assert.ok(goal, `${id}: a goal exists after the first sweep`);
    const f = sim.fence; const b = E.FENCE_DRIFT_BUFFER_M - 1e-9;
    for (const p of [goal.point, ...goal.legs]) {
      assert.ok(p[0] >= f.minX + b && p[0] <= f.maxX - b && p[1] >= f.minY + b && p[1] <= f.maxY - b, `${id}: (${p[0].toFixed(2)}, ${p[1].toFixed(2)}) is inside the fence by the buffer`);
      near(p[2], sim.droneLimits.cruiseAlt, 1e-9, `${id}: every leg flies at the mission altitude`);
    }
  }
});

test('the rehearsal counts plan steps only — the executor\'s own registration sweeps are not steps', () => {
  const sim = new E.WorldSim();
  const plan = E.planExplore(sim, 3, { droneFirst: true });
  const v = E.validatePlan(sim, plan);
  assert.ok(v.ok, v.issues.join('; '));
  assert.ok(v.stepsCompleted <= v.stepsTotal, `completed ${v.stepsCompleted} of ${v.stepsTotal}`);
  assert.equal(v.stepsCompleted, plan.steps.length, 'every step completed, none counted twice');
});

test('landing on the pad re-anchors the belief to the truth exactly', () => {
  const sim = new E.WorldSim({ sensorSet: E.RECON_3D });
  sim.scanDrone(); sim.droneTakeoff(); sim.advance(6000);
  assert.ok(sim.localizationError().positionM > 0, 'the climb drifted the truth from the belief (the 3-D set has no altitude hold to hide it)');
  sim.droneLand(); sim.advance(8000);
  assert.equal(sim.drone.mode, 'landed');
  assert.equal(sim.localization.status, 'anchored');
  near(sim.localizationError().positionM, 0, 1e-9, 'the fiducial fix leaves no error');
});
