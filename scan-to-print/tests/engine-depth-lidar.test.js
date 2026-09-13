/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The LiDAR building block: a simulated depth sensor looking into a cup carves the cavity the visual hull had filled — to the voxel — a no-return pixel never carves, and the point-cloud lane parses ASCII / binary-LE / binary-BE PLY (skipping colour and face elements), voxelises a lattice-sampled box to its exact volume, re-orients a Y-up export, reports a leak instead of hiding it, and refuses oversize clouds.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));

const META = { lane: 'depth', viewsUsed: ['top'], sources: { x: 'known', y: 'known', z: 'known' }, warnings: [], method: 'test' };

/** A solid cylinder r=20, h=50 from front + top silhouettes. */
function cylinder() {
  const rect = (w, h, uMm, vMm, ppm) => e.maskFromPredicate(w, h, (x, y) => Math.abs(x - w / 2) < (uMm * ppm) / 2 && Math.abs(y - h / 2) < (vMm * ppm) / 2);
  return e.reconstructFromSilhouettes([
    { view: 'front', mask: rect(200, 200, 40, 50, 2) },
    { view: 'top', mask: e.maskFromPredicate(200, 200, (x, y) => Math.hypot(x - 100, y - 100) < 40) },
  ], [{ axis: 'z', mm: 50 }], { resolution: 64, smoothIterations: 0 });
}

/** Hollow the cylinder from the top: radius 14, floor 5 mm thick. */
function hollowed(grid) {
  const g = e.cloneGrid(grid);
  for (let k = 0; k < g.nz; k += 1) for (let j = 0; j < g.ny; j += 1) for (let i = 0; i < g.nx; i += 1) {
    const p = e.voxelCenter(g, i, j, k);
    if (Math.hypot(p.x, p.y) < 14 && p.z > 5) g.data[e.gridIndex(g, i, j, k)] = 0;
  }
  return g;
}

test('a top-view depth map carves the cup cavity the visual hull filled, to the voxel', () => {
  const solid = cylinder();
  const cup = hollowed(solid.grid);
  const depth = e.renderDepth(cup, 'top', { mmPerPx: 0.5, width: 120, height: 120 });
  assert.equal(depth.view, 'top');
  assert.ok(depth.data.some((d) => Number.isFinite(d)), 'the sensor saw the object');
  assert.ok(depth.data.some((d) => Number.isNaN(d)), 'rays past the object report no return');
  const working = e.cloneGrid(solid.grid);
  const carved = e.carveDepth(working, depth);
  assert.ok(carved > 0);
  assert.equal(e.countSolid(working), e.countSolid(cup), 'depth carving reproduces the hollow grid exactly');
  const result = e.finishFromGrid(working, solid.report.sizeMm, META, { smoothIterations: 0 });
  assert.equal(result.report.validation.valid, true);
  assert.equal(result.report.lane, 'depth');
});

test('a no-return pixel never carves; refineWithDepth reports a map that carved nothing', () => {
  const solid = cylinder();
  const blind = { view: 'top', width: 4, height: 4, mmPerPx: 20, uCenterPx: 2, vCenterPx: 2, uCenterMm: 0, vCenterMm: 0, planeMm: 0, data: new Float32Array(16).fill(NaN) };
  const working = e.cloneGrid(solid.grid);
  assert.equal(e.carveDepth(working, blind), 0);
  const refined = e.refineWithDepth(e.cloneGrid(solid.grid), solid.report.sizeMm, solid.report.dimensionSources, [blind], [], { smoothIterations: 0 });
  assert.ok(refined.report.warnings.some((w) => /carved nothing/.test(w)));
});

/** Lattice-sample the six faces of a 60×40×30 box at 1 mm. */
function boxPoints() {
  const pts = [];
  for (let a = 0; a <= 60; a += 1) for (let b = 0; b <= 40; b += 1) { pts.push([a - 30, b - 20, 0]); pts.push([a - 30, b - 20, 30]); }
  for (let a = 0; a <= 60; a += 1) for (let c = 0; c <= 30; c += 1) { pts.push([a - 30, -20, c]); pts.push([a - 30, 20, c]); }
  for (let b = 0; b <= 40; b += 1) for (let c = 0; c <= 30; c += 1) { pts.push([-30, b - 20, c]); pts.push([30, b - 20, c]); }
  return pts;
}
const asciiPly = (pts, extraProps = '') => `ply\nformat ascii 1.0\ncomment test\nelement vertex ${pts.length}\nproperty float x\nproperty float y\nproperty float z\n${extraProps}end_header\n${pts.map((p) => p.join(' ')).join('\n')}\n`;

test('parsePly reads ASCII, binary little-endian and big-endian vertices and skips other data', () => {
  const pts = [[1, 2, 3], [-4.5, 0, 6]];
  const ascii = e.parsePly(new TextEncoder().encode(asciiPly(pts.map((p) => [...p, 255, 0, 0]), 'property uchar red\nproperty uchar green\nproperty uchar blue\n')));
  assert.equal(ascii.count, 2);
  assert.deepEqual([...ascii.xyz], [1, 2, 3, -4.5, 0, 6]);
  for (const little of [true, false]) {
    const body = Buffer.alloc(pts.length * 15);
    pts.forEach((p, i) => {
      const at = i * 15;
      if (little) { body.writeFloatLE(p[0], at); body.writeFloatLE(p[1], at + 4); body.writeFloatLE(p[2], at + 8); } else { body.writeFloatBE(p[0], at); body.writeFloatBE(p[1], at + 4); body.writeFloatBE(p[2], at + 8); }
      body[at + 12] = 1; body[at + 13] = 2; body[at + 14] = 3;
    });
    const faces = Buffer.from([3, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
    const header = Buffer.from(`ply\nformat binary_${little ? 'little' : 'big'}_endian 1.0\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\nproperty uchar r\nproperty uchar g\nproperty uchar b\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n`);
    const cloud = e.parsePly(new Uint8Array(Buffer.concat([header, body, faces])));
    assert.equal(cloud.count, 2);
    assert.ok(Math.abs(cloud.xyz[3] + 4.5) < 1e-6);
  }
  assert.throws(() => e.parsePly(new TextEncoder().encode('not a ply')), /Not a PLY/);
  assert.throws(() => e.parsePly(new TextEncoder().encode(asciiPly(pts)), { maxPoints: 1 }), /limit/);
});

test('a lattice-sampled box closes and fills to its exact volume', () => {
  const cloud = e.parsePly(new TextEncoder().encode(asciiPly(boxPoints())));
  const vox = e.voxelizePointCloud(cloud, { voxelMm: 2 });
  assert.deepEqual(vox.sizeMm, { x: 60, y: 40, z: 30 });
  const fill = e.fillSolidFromSurface(vox.grid, 1);
  assert.equal(fill.closed, true);
  const result = e.finishFromGrid(vox.grid, vox.sizeMm, { ...META, lane: 'pointcloud', viewsUsed: [] }, { smoothIterations: 0 });
  assert.equal(result.report.gridVolumeMm3, 72000);
  assert.equal(result.report.validation.valid, true);
  assert.ok(result.report.limitations[0].includes('flood'));
});

test('a Y-up metres export lands upright in millimetres', () => {
  const metres = boxPoints().map(([x, y, z]) => [x / 1000, z / 1000, -y / 1000]); // world (x, y, z) → file (x, up=z, -y)
  const cloud = { count: metres.length, xyz: Float32Array.from(metres.flat()) };
  const vox = e.voxelizePointCloud(cloud, { voxelMm: 2, unitScale: 1000, up: 'y' });
  assert.ok(Math.abs(vox.sizeMm.x - 60) < 1e-3 && Math.abs(vox.sizeMm.y - 40) < 1e-3 && Math.abs(vox.sizeMm.z - 30) < 1e-3, JSON.stringify(vox.sizeMm));
});

test('a missing face leaks: the fill reports not closed and fills nothing', () => {
  const pts = boxPoints().filter(([, , z]) => z !== 30); // no lid
  const cloud = { count: pts.length, xyz: Float32Array.from(pts.flat()) };
  const vox = e.voxelizePointCloud(cloud, { voxelMm: 2 });
  const fill = e.fillSolidFromSurface(vox.grid, 1);
  assert.equal(fill.closed, false);
  assert.equal(fill.interiorFilled, 0);
});

test('voxelize refuses a degenerate cloud and a voxel too fine for the ceiling', () => {
  const flat = { count: 2, xyz: Float32Array.from([0, 0, 0, 10, 10, 0]) };
  assert.throws(() => e.voxelizePointCloud(flat, { voxelMm: 1 }), /zero extent/);
  const cloud = { count: 2, xyz: Float32Array.from([0, 0, 0, 500, 500, 500]) };
  assert.throws(() => e.voxelizePointCloud(cloud, { voxelMm: 1 }), /too fine/);
});
