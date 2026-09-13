/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The drawing sheet: contour tracing is exact (a square is one four-point loop, a square with a hole is two), the SVG carries all six view labels, the three overall dimensions with their millimetre values, a title block with method / scale / printability, and a notes column that states every extent's provenance; the scale snaps to the standard series.
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

test('traceContours: a filled square is one loop of four corners; a ring is two loops', () => {
  const square = e.maskFromPredicate(10, 10, (x, y) => x > 2 && x < 8 && y > 2 && y < 8);
  const loops = e.traceContours(square);
  assert.equal(loops.length, 1);
  assert.equal(loops[0].length, 4);
  const ring = e.maskFromPredicate(20, 20, (x, y) => x > 2 && x < 18 && y > 2 && y < 18 && !(x > 7 && x < 13 && y > 7 && y < 13));
  const two = e.traceContours(ring);
  assert.equal(two.length, 2);
  const d = e.loopsToPath(two, 1, { x: 0, y: 0 });
  assert.equal((d.match(/M/g) || []).length, 2);
  assert.ok(d.endsWith('Z'));
});

test('the sheet carries six view labels, three dimensions, a title block and provenance notes', () => {
  const r = e.reconstructFromSilhouettes([
    { view: 'front', mask: rect(200, 200, 60, 30, 2) },
    { view: 'top', mask: rect(200, 200, 60, 40, 2) },
    { view: 'right', mask: rect(200, 200, 40, 30, 2) },
  ], [{ axis: 'x', mm: 60 }], { resolution: 48, smoothIterations: 0, partName: 'bracket <A&B>', generatedAt: '2026-09-12T10:00:00.000Z' });
  const { svg } = e.exportArtifacts(r, 'STP-TEST');
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm"'));
  // All six views are drawn: the sheet re-projects the SOLID, so the back of a visual hull is a
  // real view of the reconstruction even when no back photo was supplied.
  for (const label of ['FRONT', 'TOP', 'RIGHT', 'LEFT', 'BACK', 'BOTTOM']) assert.ok(svg.includes(`>${label}</text>`), label);
  assert.ok(!svg.includes('(no view)'));
  const blank = e.renderEngineeringDrawing({ partName: 'p', drawingNumber: 'D', sizeMm: { x: 1, y: 1, z: 1 }, sources: { x: 'known', y: 'known', z: 'known' }, voxelMm: 1, views: {}, method: 'm', volumeMm3: 0, triangleCount: 0, printable: false, generatedAt: '2026-01-01T00:00:00Z', notes: [] });
  assert.ok(blank.includes('LEFT (no view)') && blank.includes('NO — see notes'));
  for (const mm of ['60.0', '40.0', '30.0']) assert.ok(svg.includes(`>${mm}</text>`), `dimension ${mm}`);
  assert.ok(svg.includes('bracket &lt;A&amp;B&gt;'), 'part name is escaped');
  assert.ok(svg.includes('STP-TEST') && svg.includes('2026-09-12') && svg.includes('THIRD ANGLE'));
  assert.ok(svg.includes('Visual hull from 3 silhouettes'));
  assert.ok(svg.includes('yes (watertight)'));
  assert.ok(svg.includes('X 60.0 (known), Y 40.0 (derived), Z 30.0 (derived)'));
  assert.ok(svg.includes('fill-rule="evenodd"'));
});

test('the drawing scale snaps to the standard series and labels as ratio', () => {
  assert.equal(e.scaleLabel(1), '1:1');
  assert.equal(e.scaleLabel(0.5), '1:2');
  assert.equal(e.scaleLabel(2), '2:1');
  const small = { partName: 'p', drawingNumber: 'D', sizeMm: { x: 10, y: 10, z: 10 }, sources: { x: 'known', y: 'known', z: 'known' }, voxelMm: 1, views: { front: e.maskFromPredicate(12, 12, () => true) }, method: 'm', volumeMm3: 1, triangleCount: 1, printable: true, generatedAt: '2026-01-01T00:00:00Z', notes: [] };
  assert.equal(e.chooseScale(small), 5);
  const big = { ...small, sizeMm: { x: 400, y: 400, z: 400 } };
  assert.equal(e.chooseScale(big), 0.1);
});
