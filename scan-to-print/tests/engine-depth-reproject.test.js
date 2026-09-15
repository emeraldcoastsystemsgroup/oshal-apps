/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Perspective range images into the orthographic contract (BACKLOG B2): a pinhole camera above the cup, off-centre and tilted, renders a perspective depth image; re-projected into the nearest canonical view (top) it carves within one voxel of the orthographic map and agrees with it to half a voxel wherever that map is flat, for both z-depth and ray-range images, while a mislabelled depth kind fails that agreement; the nearest view follows the optical axis; samples behind the plane, off the map or leaning past the limit are dropped AND counted; no-return never lands; every malformed image, pose or target is a RangeError naming it.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));

/** The cup fixture of engine-depth-lidar: a solid cylinder r=20 h=50, and the same hollowed from the top (r 14, floor 5 mm). */
function cylinder() {
  const rect = (w, h, uMm, vMm, ppm) => e.maskFromPredicate(w, h, (x, y) => Math.abs(x - w / 2) < (uMm * ppm) / 2 && Math.abs(y - h / 2) < (vMm * ppm) / 2);
  return e.reconstructFromSilhouettes([
    { view: 'front', mask: rect(200, 200, 40, 50, 2) },
    { view: 'top', mask: e.maskFromPredicate(200, 200, (x, y) => Math.hypot(x - 100, y - 100) < 40) },
  ], [{ axis: 'z', mm: 50 }], { resolution: 64, smoothIterations: 0 });
}
function hollowed(grid) {
  const g = e.cloneGrid(grid);
  for (let k = 0; k < g.nz; k += 1) for (let j = 0; j < g.ny; j += 1) for (let i = 0; i < g.nx; i += 1) {
    const p = e.voxelCenter(g, i, j, k);
    if (Math.hypot(p.x, p.y) < 14 && p.z > 5) g.data[e.gridIndex(g, i, j, k)] = 0;
  }
  return g;
}

/** Camera-to-world rotation (row-major) for a camera at `from` looking at `to`, image-down along `down`. */
function lookAt(from, to, down) {
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const unit = (a) => { const n = Math.hypot(a.x, a.y, a.z); return { x: a.x / n, y: a.y / n, z: a.z / n }; };
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const z = unit(sub(to, from));
  const x = unit(cross(down, z));
  const y = cross(z, x);
  return [x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z];
}

/** Every voxel where two grids disagree must find the other grid's value within one voxel, in both directions. */
function voxelsBeyondOne(a, b) {
  let bad = 0;
  const near = (g, i, j, k, value) => {
    for (let dk = -1; dk <= 1; dk += 1) for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) {
      const i2 = i + di; const j2 = j + dj; const k2 = k + dk;
      if (i2 < 0 || j2 < 0 || k2 < 0 || i2 >= g.nx || j2 >= g.ny || k2 >= g.nz) continue;
      if (g.data[e.gridIndex(g, i2, j2, k2)] === value) return true;
    }
    return false;
  };
  for (let k = 0; k < a.nz; k += 1) for (let j = 0; j < a.ny; j += 1) for (let i = 0; i < a.nx; i += 1) {
    const at = e.gridIndex(a, i, j, k);
    if (a.data[at] === b.data[at]) continue;
    if (!near(a, i, j, k, b.data[at]) || !near(b, i, j, k, a.data[at])) bad += 1;
  }
  return bad;
}

/**
 * Where the orthographic map is flat (its 3 x 3 neighbourhood varies by under one voxel), the
 * re-projected depth must agree with it to within half a voxel, the carver's own tolerance. This is
 * the check with teeth: reading z-depth as ray range (or the reverse) puts about 1700 of these
 * pixels a voxel or more out, while the grid comparison alone lets an error hugging a wall pass.
 */
function flatPixelDisagreement(ortho, map, voxelMm) {
  let flat = 0;
  let beyond = 0;
  for (let r = 1; r < ortho.height - 1; r += 1) for (let c = 1; c < ortho.width - 1; c += 1) {
    const near = [];
    for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) near.push(ortho.data[(r + dr) * ortho.width + c + dc]);
    if (!near.every(Number.isFinite) || Math.max(...near) - Math.min(...near) >= voxelMm) continue;
    const got = map.data[r * ortho.width + c];
    if (!Number.isFinite(got)) continue;
    flat += 1;
    if (Math.abs(got - ortho.data[r * ortho.width + c]) > voxelMm / 2) beyond += 1;
  }
  return { flat, beyond };
}

const geometryOf = (map) => ({ mmPerPx: map.mmPerPx, width: map.width, height: map.height, uCenterPx: map.uCenterPx, vCenterPx: map.vCenterPx, uCenterMm: map.uCenterMm, vCenterMm: map.vCenterMm, planeMm: map.planeMm });
const CAMERA = { width: 240, height: 240, intrinsics: { fx: 500, fy: 500, cx: 120, cy: 120 } };
/** Off-centre by 10 mm and tilted about 4.6 degrees: still above the cavity, so its whole floor is in view. */
const POSE = { positionMm: { x: 6, y: -8, z: 150 }, rotation: lookAt({ x: 6, y: -8, z: 150 }, { x: 0, y: 0, z: 25 }, { x: 0, y: -1, z: 0 }) };

test('B2: a perspective image of the cup, re-projected to the top view, carves within one voxel of the orthographic map', () => {
  const solid = cylinder();
  const cup = hollowed(solid.grid);
  const ortho = e.renderDepth(cup, 'top', { mmPerPx: 0.5, width: 120, height: 120 });
  const expected = e.cloneGrid(solid.grid);
  e.carveDepth(expected, ortho);
  assert.equal(e.countSolid(expected), e.countSolid(cup), 'the orthographic carve is the reference: it recovers the cup exactly');
  for (const depthKind of ['z', 'range']) {
    const image = e.renderPerspectiveDepth(cup, { ...CAMERA, pose: POSE, depthKind });
    const { map, stats } = e.reprojectToCanonicalView(image, geometryOf(ortho));
    assert.equal(map.view, 'top');
    assert.equal(stats.view, 'top');
    assert.ok(stats.poseAngleDeg > 4 && stats.poseAngleDeg < 5.5, `pose angle ${stats.poseAngleDeg}`);
    assert.equal(stats.leanDropped, 0);
    assert.equal(stats.behindPlane, 0);
    assert.equal(stats.outsideMap, 0);
    assert.ok(stats.landed === stats.samples && stats.samples > 10000, JSON.stringify(stats));
    const flat = flatPixelDisagreement(ortho, map, solid.grid.voxelMm);
    assert.ok(flat.flat > 4000, `the comparison covers the rim and the floor: ${flat.flat} flat pixels`);
    assert.equal(flat.beyond, 0, `${depthKind}: ${flat.beyond} flat pixels disagree with the orthographic map by more than half a voxel`);
    const carved = e.cloneGrid(solid.grid);
    e.carveDepth(carved, map);
    assert.equal(voxelsBeyondOne(expected, carved), 0, `${depthKind}: the perspective carve strays more than one voxel from the orthographic one`);
    const cavity = e.countSolid(solid.grid) - e.countSolid(cup);
    assert.ok(e.countSolid(solid.grid) - e.countSolid(carved) > 0.97 * cavity, `${depthKind}: the cavity is recovered`);
  }
});

test('B2: the flat-pixel check has teeth: confusing z-depth with ray range is caught', () => {
  const solid = cylinder();
  const cup = hollowed(solid.grid);
  const ortho = e.renderDepth(cup, 'top', { mmPerPx: 0.5, width: 120, height: 120 });
  const rangeImage = e.renderPerspectiveDepth(cup, { ...CAMERA, pose: POSE, depthKind: 'range' });
  const misread = e.reprojectToCanonicalView({ ...rangeImage, depthKind: 'z' }, geometryOf(ortho));
  assert.ok(flatPixelDisagreement(ortho, misread.map, solid.grid.voxelMm).beyond > 500, 'a mislabelled depth kind must fail the agreement check');
});

test('B2: the nearest canonical view follows the optical axis', () => {
  const at = { x: 0, y: 0, z: 0 };
  const cases = [
    [{ x: 3, y: -200, z: 10 }, { x: 0, y: 0, z: -1 }, 'front'],
    [{ x: -4, y: 200, z: -6 }, { x: 0, y: 0, z: -1 }, 'back'],
    [{ x: 200, y: 5, z: 8 }, { x: 0, y: 0, z: -1 }, 'right'],
    [{ x: -200, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, 'left'],
    [{ x: 2, y: 3, z: 200 }, { x: 0, y: -1, z: 0 }, 'top'],
    [{ x: 0, y: 7, z: -200 }, { x: 0, y: 1, z: 0 }, 'bottom'],
  ];
  for (const [from, down, view] of cases) {
    assert.equal(e.nearestCanonicalView({ positionMm: from, rotation: lookAt(from, at, down) }).view, view);
  }
});

test('B2: no-return never lands; samples behind the plane, off the map or leaning too far are dropped and counted', () => {
  const pose = { positionMm: { x: 0, y: 0, z: 100 }, rotation: lookAt({ x: 0, y: 0, z: 100 }, { x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }) };
  const k = { fx: 10, fy: 10, cx: 2, cy: 2 };
  const data = new Float32Array(16).fill(NaN);
  data[5] = 50; // pixel (1,1): lands 50 mm below the camera
  data[10] = 50; // pixel (2,2)
  data[0] = Infinity; // no return, never counted
  const image = { width: 4, height: 4, intrinsics: k, pose, depthKind: 'z', data };
  const target = { mmPerPx: 1, width: 20, height: 20, uCenterPx: 10, vCenterPx: 10, uCenterMm: 0, vCenterMm: 0 };
  const plain = e.reprojectToCanonicalView(image, target);
  assert.equal(plain.stats.samples, 2);
  assert.equal(plain.stats.landed, 2);
  assert.equal(plain.map.data.filter((d) => Number.isFinite(d)).length, 2);
  assert.ok(plain.map.data.filter((d) => Number.isFinite(d)).every((d) => Math.abs(d - 50) < 1e-4), 'z-depth from a camera looking straight down is the map depth');
  assert.equal(e.reprojectToCanonicalView(image, { ...target, planeMm: -40 }).stats.behindPlane, 2, 'a plane below the samples puts them behind it');
  assert.equal(e.reprojectToCanonicalView(image, { ...target, width: 1, height: 1, uCenterPx: -50 }).stats.outsideMap, 2);
  const leaning = e.reprojectToCanonicalView(image, { ...target, maxLeanDeg: 0 });
  assert.equal(leaning.stats.leanDropped, 2, 'off-axis pixels lean past a zero-degree limit');
  assert.ok(leaning.map.data.every((d) => Number.isNaN(d)), 'a dropped sample never certifies its column');
});

test('B2: re-projection is deterministic', () => {
  const cup = hollowed(cylinder().grid);
  const image = e.renderPerspectiveDepth(cup, { ...CAMERA, pose: POSE, depthKind: 'z' });
  const target = { mmPerPx: 0.5, width: 120, height: 120, uCenterPx: 60, vCenterPx: 60, uCenterMm: 0, vCenterMm: 0 };
  const a = e.reprojectToCanonicalView(image, target);
  const b = e.reprojectToCanonicalView(image, target);
  assert.deepEqual(Buffer.from(a.map.data.buffer), Buffer.from(b.map.data.buffer));
  assert.deepEqual(a.stats, b.stats);
});

test('B2: malformed images, poses and targets are RangeErrors that name the problem', () => {
  const pose = { positionMm: { x: 0, y: 0, z: 100 }, rotation: [1, 0, 0, 0, -1, 0, 0, 0, -1] };
  const good = { width: 2, height: 2, intrinsics: { fx: 10, fy: 10, cx: 1, cy: 1 }, pose, depthKind: 'z', data: new Float32Array(4) };
  const target = { mmPerPx: 1, width: 4, height: 4, uCenterPx: 2, vCenterPx: 2, uCenterMm: 0, vCenterMm: 0 };
  const refuses = (image, t, pattern) => assert.throws(() => e.reprojectToCanonicalView(image, t), (err) => err instanceof RangeError && pattern.test(err.message), pattern.source);
  refuses({ ...good, pose: { ...pose, rotation: [2, 0, 0, 0, -1, 0, 0, 0, -1] } }, target, /proper rotation/);
  refuses({ ...good, pose: { ...pose, rotation: [1, 0, 0, 0, 1, 0, 0, 0, -1] } }, target, /proper rotation/); // a reflection: det -1
  refuses({ ...good, pose: { ...pose, rotation: [1, 0, 0] } }, target, /nine finite numbers/);
  refuses({ ...good, pose: { ...pose, positionMm: { x: 0, y: NaN, z: 0 } } }, target, /positionMm/);
  refuses({ ...good, intrinsics: { fx: 0, fy: 10, cx: 1, cy: 1 } }, target, /fx and fy/);
  refuses({ ...good, intrinsics: { fx: 10, fy: 10, cx: NaN, cy: 1 } }, target, /cx and cy/);
  refuses({ ...good, data: new Float32Array(3) }, target, /width x height/);
  refuses({ ...good, data: [0, 0, 0, 0] }, target, /Float32Array/);
  refuses({ ...good, depthKind: 'disparity' }, target, /depthKind/);
  refuses({ ...good, width: 0 }, target, /positive integers/);
  refuses(good, { ...target, mmPerPx: 0 }, /mmPerPx/);
  refuses(good, { ...target, width: 2.5 }, /target width and height/);
  refuses(good, { ...target, uCenterMm: Infinity }, /centre/);
  refuses(good, { ...target, planeMm: NaN }, /planeMm/);
  refuses(good, { ...target, maxLeanDeg: 90 }, /maxLeanDeg/);
  refuses(good, { ...target, view: 'side' }, /target view/);
});
