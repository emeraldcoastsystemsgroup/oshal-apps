/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The visual-hull lane end to end on synthetic silhouettes: every view frame is a right-handed camera, a three-view box registers to its exact extents and meshes watertight within 1% of the analytic volume, a cylinder within 1%, one view assumes and flags the unseen depth, tilted proportions warn, the carved solid re-projects to the silhouettes that carved it, two runs are byte-identical, and every refusal is a RangeError with the reason.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));

function rect(w, h, uMm, vMm, ppm) {
  return e.maskFromPredicate(w, h, (x, y) => Math.abs(x - w / 2) < (uMm * ppm) / 2 && Math.abs(y - h / 2) < (vMm * ppm) / 2);
}
const box = () => [
  { view: 'front', mask: rect(200, 200, 60, 30, 2) },
  { view: 'top', mask: rect(200, 200, 60, 40, 2) },
  { view: 'right', mask: rect(200, 200, 40, 30, 2) },
];

test('every canonical view frame is a right-handed camera (right × up = −look)', () => {
  for (const name of e.VIEW_NAMES) {
    const f = e.VIEW_FRAMES[name];
    const up = { axis: f.v.axis, sign: -f.v.sign };
    const c = e.crossAxes(f.u, up);
    const minusLook = e.axisVector({ axis: f.look.axis, sign: -f.look.sign });
    assert.deepEqual(c, minusLook, `${name} is not right-handed`);
  }
  assert.equal(e.VIEW_FRAMES.top.v.axis, 'y');
  assert.equal(e.VIEW_FRAMES.top.v.sign, -1, 'top view: the object front (−Y) is at the bottom of the image');
  assert.equal(e.VIEW_FRAMES.right.u.sign, 1, 'right view: the object front is at the left of the image');
  assert.ok(e.isViewName('front') && !e.isViewName('side'));
});

test('a three-view box registers to its exact extents and meshes watertight', () => {
  const r = e.reconstructFromSilhouettes(box(), [{ axis: 'x', mm: 60 }], { resolution: 48, smoothIterations: 0, partName: 'box', generatedAt: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(r.report.sizeMm, { x: 60, y: 40, z: 30 });
  assert.deepEqual(r.report.dimensionSources, { x: 'known', y: 'derived', z: 'derived' });
  assert.equal(r.report.validation.valid, true);
  assert.equal(r.report.printable, true);
  assert.equal(r.report.gridVolumeMm3, 72000);
  assert.ok(Math.abs(r.report.meshVolumeMm3 - 72000) / 72000 < 0.01);
  assert.deepEqual(r.report.viewsUsed, ['front', 'top', 'right']);
  assert.equal(r.report.lane, 'silhouettes');
  assert.ok(r.report.limitations[0].includes('Visual hull'));
});

test('smoothing keeps the mesh valid and close to the voxel volume', () => {
  const r = e.reconstructFromSilhouettes(box(), [{ axis: 'x', mm: 60 }], { resolution: 48, smoothIterations: 3 });
  assert.equal(r.report.validation.valid, true);
  assert.ok(Math.abs(r.report.meshVolumeMm3 - 72000) / 72000 < 0.03);
});

test('a cylinder from front + top matches π·r²·h within 1%', () => {
  const cyl = [
    { view: 'front', mask: rect(200, 200, 40, 50, 2) },
    { view: 'top', mask: e.maskFromPredicate(200, 200, (x, y) => Math.hypot(x - 100, y - 100) < 40) },
  ];
  const r = e.reconstructFromSilhouettes(cyl, [{ axis: 'z', mm: 50 }], { resolution: 64, smoothIterations: 1 });
  assert.deepEqual(r.report.sizeMm, { x: 40, y: 40, z: 50 });
  const expected = Math.PI * 20 * 20 * 50;
  assert.ok(Math.abs(r.report.gridVolumeMm3 - expected) / expected < 0.01, `grid ${r.report.gridVolumeMm3}`);
  assert.equal(r.report.validation.valid, true);
});

test('one view assumes the unseen depth and says so; an extrusion results', () => {
  const r = e.reconstructFromSilhouettes([{ view: 'front', mask: rect(200, 200, 60, 30, 2) }], [{ axis: 'x', mm: 60 }], { resolution: 32, smoothIterations: 0 });
  assert.equal(r.report.dimensionSources.y, 'assumed');
  assert.equal(r.report.sizeMm.y, 60);
  assert.ok(r.report.warnings.some((w) => /Extent along Y/.test(w)));
  assert.equal(r.report.validation.watertight, true);
});

test('views whose proportions disagree raise a registration warning', () => {
  const skewed = [
    { view: 'front', mask: rect(200, 200, 60, 30, 2) },
    { view: 'top', mask: rect(200, 200, 60, 40, 2) },
    { view: 'right', mask: rect(200, 200, 40, 42, 2) }, // height 42 instead of 30 → 40% disagreement
  ];
  const reg = e.registerSilhouettes(skewed, [{ axis: 'x', mm: 60 }]);
  assert.ok(reg.warnings.some((w) => /right view/.test(w) && /disagree/.test(w)), reg.warnings.join(' | '));
});

test('the carved solid re-projects to the silhouettes that carved it', () => {
  const r = e.reconstructFromSilhouettes(box(), [{ axis: 'x', mm: 60 }], { resolution: 60, smoothIterations: 0 });
  const front = e.maskStats(r.projections.front);
  const px = r.report.voxelMm;
  assert.ok(Math.abs((front.bbox.maxX - front.bbox.minX + 1) * px - 60) <= px, 'front width');
  assert.ok(Math.abs((front.bbox.maxY - front.bbox.minY + 1) * px - 30) <= px, 'front height');
  const top = e.maskStats(r.projections.top);
  assert.ok(Math.abs((top.bbox.maxY - top.bbox.minY + 1) * px - 40) <= px, 'top depth');
});

test('two runs on the same inputs are byte-identical', () => {
  const opts = { resolution: 40, smoothIterations: 2, partName: 'p', generatedAt: '2026-01-01T00:00:00.000Z' };
  const a = e.exportArtifacts(e.reconstructFromSilhouettes(box(), [{ axis: 'x', mm: 60 }], opts), 'D');
  const b = e.exportArtifacts(e.reconstructFromSilhouettes(box(), [{ axis: 'x', mm: 60 }], opts), 'D');
  assert.equal(Buffer.compare(Buffer.from(a.stl), Buffer.from(b.stl)), 0);
  assert.equal(a.svg, b.svg);
  assert.equal(a.obj, b.obj);
});

test('refusals are RangeErrors that name the problem', () => {
  const empty = e.createMask(50, 50);
  assert.throws(() => e.reconstructFromSilhouettes([{ view: 'front', mask: empty }], [{ axis: 'x', mm: 10 }]), /empty silhouette/);
  assert.throws(() => e.reconstructFromSilhouettes(box(), []), /known dimension/);
  assert.throws(() => e.reconstructFromSilhouettes([...box(), { view: 'front', mask: rect(200, 200, 60, 30, 2) }], [{ axis: 'x', mm: 60 }]), /supplied twice/);
  assert.throws(() => e.reconstructFromSilhouettes(box(), [{ axis: 'x', mm: 60 }], { resolution: 5000 }), /resolution/);
  assert.throws(() => e.reconstructFromSilhouettes(box(), [{ axis: 'x', mm: -1 }]), /positive/);
  assert.throws(() => e.createOccupancyGrid({ x: 10, y: 10, z: 10 }, 0.01), /exceeds/);
});

test('chooseVoxelMm puts the resolution along the largest extent', () => {
  assert.equal(e.chooseVoxelMm({ x: 10, y: 96, z: 3 }, 96), 1);
  assert.throws(() => e.chooseVoxelMm({ x: 1, y: 1, z: 1 }, 0), RangeError);
});
