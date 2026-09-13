/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the CAD Studio bridge under plain node: a box's
 *                     |                             | three outlines are exact rectangles in world millimetres
 *                     |                             | (footprint centred, Z from 0), a cylinder's top outline is
 *                     |                             | a circle within the simplification tolerance, the closed-
 *                     |                             | polygon simplifier keeps corners and drops staircase
 *                     |                             | noise, and the vertex budget is honoured.
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
const bbox = (pts) => ({ minU: Math.min(...pts.map((p) => p[0])), maxU: Math.max(...pts.map((p) => p[0])), minV: Math.min(...pts.map((p) => p[1])), maxV: Math.max(...pts.map((p) => p[1])) });
const area = (pts) => Math.abs(pts.reduce((acc, p, i) => { const q = pts[(i + 1) % pts.length]; return acc + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

test('a box\'s three outlines are exact rectangles in world millimetres, in the engine\'s frame', () => {
  const r = e.reconstructFromSilhouettes(box(), [{ axis: 'x', mm: 60 }], { resolution: 48, smoothIterations: 0 });
  const out = e.exportContours(r.grid, r.projections, r.report.sizeMm);
  assert.deepEqual(Object.keys(out.views).sort(), ['front', 'right', 'top']);
  assert.deepEqual(out.sizeMm, { x: 60, y: 40, z: 30 });
  assert.equal(out.voxelMm, 1.25);
  assert.equal(out.views.front.length, 4); assert.equal(out.views.top.length, 4); assert.equal(out.views.right.length, 4);
  assert.deepEqual(bbox(out.views.front), { minU: -30, maxU: 30, minV: 0, maxV: 30 }, 'front is (X, Z) with Z from the bed');
  assert.deepEqual(bbox(out.views.top), { minU: -30, maxU: 30, minV: -20, maxV: 20 }, 'top is (X, Y) centred');
  assert.deepEqual(bbox(out.views.right), { minU: -20, maxU: 20, minV: 0, maxV: 30 }, 'right is (Y, Z)');
  assert.equal(area(out.views.front), 1800); assert.equal(area(out.views.top), 2400); assert.equal(area(out.views.right), 1200);
  assert.deepEqual(out.pointCounts, { front: 4, top: 4, right: 4 });
});

test('a cylinder\'s top outline is a circle within the tolerance and the budget is honoured', () => {
  const cyl = [
    { view: 'front', mask: rect(200, 200, 40, 50, 2) },
    { view: 'top', mask: e.maskFromPredicate(200, 200, (x, y) => Math.hypot(x - 100, y - 100) < 40) },
  ];
  const r = e.reconstructFromSilhouettes(cyl, [{ axis: 'z', mm: 50 }], { resolution: 64, smoothIterations: 0 });
  const out = e.exportContours(r.grid, r.projections, r.report.sizeMm);
  const top = out.views.top;
  assert.ok(top.length >= 12 && top.length <= 1500, `points ${top.length}`);
  assert.ok(Math.abs(area(top) - Math.PI * 400) / (Math.PI * 400) < 0.03, `area ${area(top)}`);
  for (const [x, y] of top) assert.ok(Math.abs(Math.hypot(x, y) - 20) <= out.voxelMm + 1e-9, `vertex ${x},${y} off the circle`);
  const right = bbox(out.views.right);
  assert.ok(Math.abs(right.minU + 20) <= out.voxelMm && Math.abs(right.maxU - 20) <= out.voxelMm && right.minV === 0 && right.maxV === 50,
    `the right outline is the grid re-projected (within one voxel across Y) even though no right photo was supplied: ${JSON.stringify(right)}`);
  const budget = e.exportContours(r.grid, r.projections, r.report.sizeMm, 8);
  assert.ok(budget.views.top.length <= 8);
  assert.ok(budget.toleranceMm.top > out.toleranceMm.top, 'the budget raised the tolerance');
});

test('the closed-polygon simplifier keeps corners, drops staircase noise and is deterministic', () => {
  const square = [];
  for (let i = 0; i <= 10; i += 1) square.push({ x: i, y: 0 });
  for (let i = 1; i <= 10; i += 1) square.push({ x: 10, y: i });
  for (let i = 9; i >= 0; i -= 1) square.push({ x: i, y: 10 });
  for (let i = 9; i >= 1; i -= 1) square.push({ x: 0, y: i });
  const simple = e.simplifyPolygon(square, 0.5);
  assert.deepEqual(simple, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
  const stairs = [];
  for (let i = 0; i < 20; i += 1) { stairs.push({ x: i, y: i }); stairs.push({ x: i + 1, y: i }); }
  stairs.push({ x: 20, y: 20 }, { x: 0, y: 20 });
  const smooth = e.simplifyPolygon(stairs, 0.75);
  assert.ok(smooth.length <= 4, `staircase collapsed to ${smooth.length} points`);
  assert.deepEqual(e.simplifyPolygon(stairs, 0.75), smooth);
  assert.deepEqual(e.simplifyPolygon([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], 5), [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]);
  assert.ok(e.simplifyToBudget(square, 0.01, 6).loop.length <= 6);
});
