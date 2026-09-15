/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-09-14 01:30:00 | maintainer@emeraldcoastsystemsgroup.com   | Guard for the Spaces → embodied scene export against the COMPILED module: a synthetic room splat in Spaces' own +Y-up frame (floor, four walls, ceiling, one box) becomes a scene whose room spans the covered extent with the floor at z = 0, whose obstacle boxes cover the box and the walls and stay inside the room with positive volume (embodied's validateScene invariants), whose drone home sits on open floor away from the box; the same room stored −Y up (a 3DGS export) is detected and flipped so the floor is still at the bottom; a non-metric capture is fitted to the ceiling height; the box cap coarsens the covering instead of truncating the room; an empty buffer is refused with a RangeError; the query parser only admits known values.
 *
 * Dependency-free `node --test` suite, matching the store CI contract.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { buildEmbodiedScene, sceneOptionsFromQuery, EMBODIED_SCENE_TYPE, DEFAULT_CEILING_M } = require(path.join(__dirname, '..', 'routes', 'embodied-scene.js'));

/** Pack gaussians (position only matters here) into the 32-byte .splat record. */
function packSplat(points) {
  const buf = Buffer.alloc(points.length * 32);
  points.forEach((p, i) => {
    const o = i * 32;
    buf.writeFloatLE(p[0], o); buf.writeFloatLE(p[1], o + 4); buf.writeFloatLE(p[2], o + 8);
    buf.writeFloatLE(0.02, o + 12); buf.writeFloatLE(0.02, o + 16); buf.writeFloatLE(0.02, o + 20);
    buf.writeUInt8(200, o + 24); buf.writeUInt8(200, o + 25); buf.writeUInt8(200, o + 26); buf.writeUInt8(255, o + 27);
    buf.writeUInt8(255, o + 28); buf.writeUInt8(128, o + 29); buf.writeUInt8(128, o + 30); buf.writeUInt8(128, o + 31);
  });
  return buf;
}

/** A deterministic lattice over a quad: origin + u·a + v·b, `n` samples per axis. */
function quad(origin, a, b, n) {
  const out = [];
  for (let i = 0; i <= n; i++) for (let k = 0; k <= n; k++) {
    const u = i / n; const v = k / n;
    out.push([origin[0] + a[0] * u + b[0] * v, origin[1] + a[1] * u + b[1] * v, origin[2] + a[2] * u + b[2] * v]);
  }
  return out;
}

/** Spaces' synthetic-room frame: x width, y HEIGHT (up), z depth. A 4 × 2.4 × 3 m room with a 0.6 m cube at (2.5, _, 1.5).
 *  Sampled densely (≈ 2 cm) like a real splat, so every 5 cm voxel on a face holds several gaussians. */
function roomYUp({ w = 4, h = 2.4, d = 3, dense = 150 } = {}) {
  const pts = [];
  pts.push(...quad([0, 0, 0], [w, 0, 0], [0, 0, d], dense * 2));            // floor (dense)
  pts.push(...quad([0, h, 0], [w, 0, 0], [0, 0, d], dense));                // ceiling (sparser)
  pts.push(...quad([0, 0, 0], [0, h, 0], [0, 0, d], dense));                // wall x = 0
  pts.push(...quad([w, 0, 0], [0, h, 0], [0, 0, d], dense));                // wall x = w
  pts.push(...quad([0, 0, 0], [w, 0, 0], [0, h, 0], dense));                // wall z = 0
  pts.push(...quad([0, 0, d], [w, 0, 0], [0, h, 0], dense));                // wall z = d
  // the cube: five faces (top + four sides), 0.6 m, sitting on the floor
  const c = [2.2, 0, 1.2]; const s = 0.6;
  pts.push(...quad([c[0], s, c[2]], [s, 0, 0], [0, 0, s], 20));
  pts.push(...quad([c[0], 0, c[2]], [s, 0, 0], [0, s, 0], 20));
  pts.push(...quad([c[0], 0, c[2] + s], [s, 0, 0], [0, s, 0], 20));
  pts.push(...quad([c[0], 0, c[2]], [0, s, 0], [0, 0, s], 20));
  pts.push(...quad([c[0] + s, 0, c[2]], [0, s, 0], [0, 0, s], 20));
  return pts;
}

/** Embodied's own validateScene invariants for obstacles: inside the room and with volume. */
function assertObstaclesValid(scene) {
  const names = new Set();
  for (const o of scene.obstacles) {
    assert.ok(!names.has(o.name), `duplicate obstacle name ${o.name}`); names.add(o.name);
    assert.equal(o.kind, 'fixture');
    for (const p of [o.min, o.max]) {
      assert.ok(p[0] >= scene.room.minX && p[0] <= scene.room.maxX, `${o.name} leaves the room in x`);
      assert.ok(p[1] >= scene.room.minY && p[1] <= scene.room.maxY, `${o.name} leaves the room in y`);
    }
    assert.ok(o.max[2] <= scene.room.ceiling, `${o.name} pierces the ceiling`);
    assert.ok(o.min[0] < o.max[0] && o.min[1] < o.max[1] && o.min[2] < o.max[2], `${o.name} has no volume`);
  }
}

const coversPoint = (scene, p) => scene.obstacles.some((o) => p[0] >= o.min[0] && p[0] <= o.max[0] && p[1] >= o.min[1] && p[1] <= o.max[1] && p[2] >= o.min[2] && p[2] <= o.max[2]);

test('a metric +Y-up room becomes a z-up scene with the floor at 0, the box covered and a free drone home', () => {
  const { scene, stats } = buildEmbodiedScene(packSplat(roomYUp()), { name: 'scan:test', metric: true });
  assert.equal(scene.name, 'scan:test');
  assert.equal(stats.up, 'y');
  assert.equal(stats.unit, 'meters');
  assert.equal(stats.scale, 1);
  assert.equal(stats.resolutionM, 0.05);
  // room: 4 m wide (x), 3 m deep (source z → scene y), 2.4 m tall, plus the margins
  assert.ok(Math.abs(scene.room.maxX - 4.2) < 0.11, `room width ${scene.room.maxX}`);
  assert.ok(Math.abs(scene.room.maxY - 3.2) < 0.11, `room depth ${scene.room.maxY}`);
  assert.ok(scene.room.ceiling >= 2.4 && scene.room.ceiling <= 2.6, `ceiling ${scene.room.ceiling}`);
  assertObstaclesValid(scene);
  // the cube (source x 2.2..2.8, z 1.2..1.8 → scene x 2.3..2.9, y 1.3..1.9, z 0..0.6): a splat is a
  // SURFACE, so its faces are solid (top face voxel 0.60..0.65, sides) and the shell is hollow inside
  assert.ok(coversPoint(scene, [2.6, 1.6, 0.62]), 'cube top face is covered');
  assert.ok(coversPoint(scene, [2.32, 1.6, 0.3]), 'cube side is covered');
  assert.ok(!coversPoint(scene, [2.6, 1.6, 0.3]), 'the shell interior stays hollow (surface capture)');
  // the walls are solids too
  assert.ok(coversPoint(scene, [0.12, 1.5, 1.2]), 'west wall is covered');
  assert.ok(coversPoint(scene, [2.0, 3.12, 1.2]), 'north wall is covered');
  // open floor between the cube and the walls is NOT covered above the floor slab
  assert.ok(!coversPoint(scene, [1.0, 0.8, 0.5]), 'open floor is free');
  // drone home on open floor: away from the cube and inside the room
  const [hx, hy, hz] = scene.droneHome;
  assert.equal(hz, 0);
  assert.ok(hx > 0.2 && hx < scene.room.maxX - 0.2 && hy > 0.2 && hy < scene.room.maxY - 0.2, 'home inside the room');
  assert.ok(Math.hypot(hx - 2.6, hy - 1.6) > 0.6, 'home is not on the cube');
  assert.ok(stats.floorClearanceM >= 0.5, `floor clearance ${stats.floorClearanceM}`);
  assert.deepEqual([scene.surfaces, scene.objects, scene.zones, scene.appliances], [[], [], [], []]);
  assert.deepEqual(scene.basePark, { x: hx, y: hy, yaw: 0 });
});

test('a −Y-up capture (3DGS export) is detected and flipped so the dense floor is still at the bottom', () => {
  const flipped = roomYUp().map(([x, y, z]) => [x, -y, z]);
  const { scene, stats } = buildEmbodiedScene(packSplat(flipped), { name: 'scan:flip', metric: true });
  assert.equal(stats.up, '-y');
  assert.equal(stats.upDetected, true);
  assertObstaclesValid(scene);
  // the cube still sits on the floor (z 0..0.6), not hanging from the ceiling
  assert.ok(coversPoint(scene, [2.6, 1.6, 0.62]), 'cube top face near z 0.6');
  assert.ok(!coversPoint(scene, [2.6, 1.6, 1.9]), 'nothing at the cube spot near the ceiling');
  const explicit = buildEmbodiedScene(packSplat(flipped), { name: 'scan:flip', metric: true, up: '-y' });
  assert.equal(explicit.stats.upDetected, false);
  assert.equal(explicit.scene.room.ceiling, scene.room.ceiling);
});

test('floaters far outside the room are clipped instead of stretching the scene', () => {
  const floaters = [[40, 30, -25], [-60, 5, 12], [3, 80, 2], [2, -45, 1.5], [1, 1, 90], [2.5, 1.2, -70]];
  const pts = roomYUp().concat(floaters, floaters, floaters);
  const clean = buildEmbodiedScene(packSplat(roomYUp()), { name: 'scan:clean', metric: true });
  const { scene, stats } = buildEmbodiedScene(packSplat(pts), { name: 'scan:floaters', metric: true });
  assert.ok(stats.clippedGaussians >= floaters.length * 3, `clipped ${stats.clippedGaussians}`);
  assert.ok(Math.abs(scene.room.maxX - clean.scene.room.maxX) < 0.3, `room width ${scene.room.maxX} vs ${clean.scene.room.maxX}`);
  assert.ok(Math.abs(scene.room.maxY - clean.scene.room.maxY) < 0.3, `room depth ${scene.room.maxY} vs ${clean.scene.room.maxY}`);
  assert.ok(Math.abs(scene.room.ceiling - clean.scene.room.ceiling) < 0.3, `ceiling ${scene.room.ceiling} vs ${clean.scene.room.ceiling}`);
  assertObstaclesValid(scene);
  assert.equal(clean.stats.clippedGaussians, 0, 'a clean room clips nothing');
});

test('a non-metric capture is fitted so its vertical extent equals the ceiling height', () => {
  const tiny = roomYUp().map(([x, y, z]) => [x * 0.01, y * 0.01, z * 0.01]);
  const { scene, stats } = buildEmbodiedScene(packSplat(tiny), { name: 'scan:fit', metric: false });
  assert.equal(stats.unit, 'fitted');
  // the 1st–99th percentile extent of a lattice room is a hair under the full height, so the fit lands a little over 100
  assert.ok(Math.abs(stats.scale - 100) < 4, `scale ${stats.scale}`);
  assert.ok(Math.abs(scene.room.ceiling - (DEFAULT_CEILING_M + 0.1)) < 0.11, `ceiling ${scene.room.ceiling}`);
  const custom = buildEmbodiedScene(packSplat(tiny), { name: 'scan:fit', metric: false, ceilingM: 3.0 });
  assert.ok(Math.abs(custom.scene.room.ceiling - 3.1) < 0.11, `custom ceiling ${custom.scene.room.ceiling}`);
  const scaled = buildEmbodiedScene(packSplat(tiny), { name: 'scan:fit', metric: false, scaleM: 50 });
  assert.ok(Math.abs(scaled.scene.room.ceiling - 1.3) < 0.11, `explicit scale ceiling ${scaled.scene.room.ceiling}`);
});

test('the box cap coarsens the covering rather than cutting the room short', () => {
  const fine = buildEmbodiedScene(packSplat(roomYUp()), { name: 'scan:cap', metric: true });
  const capped = buildEmbodiedScene(packSplat(roomYUp()), { name: 'scan:cap', metric: true, maxBoxes: Math.max(50, Math.floor(fine.stats.boxes / 4)) });
  assert.ok(capped.stats.resolutionM > fine.stats.resolutionM, `coarsened ${fine.stats.resolutionM} → ${capped.stats.resolutionM}`);
  assert.ok(capped.stats.boxes <= Math.max(50, Math.floor(fine.stats.boxes / 4)) || capped.stats.resolutionM === 0.3, 'under the cap or at the coarsest rung');
  assert.ok(Math.abs(capped.scene.room.maxX - fine.scene.room.maxX) < 0.35, 'room width kept');
  assert.ok(Math.abs(capped.scene.room.maxY - fine.scene.room.maxY) < 0.35, 'room depth kept');
  assertObstaclesValid(capped.scene);
});

test('an empty or flat buffer is refused with a RangeError, not a scene', () => {
  assert.throws(() => buildEmbodiedScene(Buffer.alloc(0), { name: 'x', metric: true }), RangeError);
  const flat = packSplat(quad([0, 0, 0], [4, 0, 0], [0, 0, 3], 40));
  assert.throws(() => buildEmbodiedScene(flat, { name: 'x', metric: false }), /flat/);
});

test('the query parser admits only known up values and positive numbers', () => {
  const o = sceneOptionsFromQuery({ up: 'sideways', scaleM: '-3', ceilingM: '2.7', maxBoxes: 'lots', minPoints: '1' }, 'scan:q', true);
  assert.equal(o.up, 'auto');
  assert.equal(o.scaleM, undefined);
  assert.equal(o.ceilingM, 2.7);
  assert.equal(o.maxBoxes, undefined);
  assert.equal(o.minPointsPerVoxel, 1);
  assert.equal(o.metric, true);
  assert.equal(sceneOptionsFromQuery({ up: '-y' }, 'scan:q', false).up, '-y');
  assert.equal(EMBODIED_SCENE_TYPE, 'application/vnd.oshal.embodied-scene+json');
});
