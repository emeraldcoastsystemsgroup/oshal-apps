/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Symmetry completion (BACKLOG B11): a U-shaped part whose top photo hides half of one prong reconstructs 8000 mm³ short, and to the full analytic 36000 mm³ once X symmetry is asserted, voxel-for-voxel identical to the fully visible part; a C-shaped part does the same across Y; the report and the drawing both say the material was copied, not seen; an already symmetric part is left alone and says so; any other axis is a RangeError.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));

const PPM = 2;
const SIZE = 200;
const rect = (uMm, vMm) => e.maskFromPredicate(SIZE, SIZE, (x, y) => Math.abs(x - SIZE / 2) < (uMm * PPM) / 2 && Math.abs(y - SIZE / 2) < (vMm * PPM) / 2);
/** A top-view mask from a predicate over world (x, y) millimetres: image right = +X, image down = -Y. */
const topView = (inside) => e.maskFromPredicate(SIZE, SIZE, (px, py) => inside((px - SIZE / 2) / PPM, -(py - SIZE / 2) / PPM));

/** U seen from above: a base bar along the front edge and two prongs running back. Symmetric in X. */
const inU = (x, y) => (Math.abs(x) < 30 && y > -20 && y < -10) || (Math.abs(x) > 10 && Math.abs(x) < 30 && y > -20 && y < 20);
/** C seen from above: a spine on the left and two arms running right. Symmetric in Y. */
const inC = (x, y) => (x > -30 && x < -20 && Math.abs(y) < 20) || (x > -30 && x < 30 && Math.abs(y) > 10 && Math.abs(y) < 20);

/** Front, top and right views of a 20 mm tall extrusion of `inTop`, whose front and right outlines are full rectangles. */
const views = (inTop, uWidth, vDepth) => [
  { view: 'front', mask: rect(uWidth, 20) },
  { view: 'top', mask: topView(inTop) },
  { view: 'right', mask: rect(vDepth, 20) },
];
const OPTS = { resolution: 60, smoothIterations: 0, generatedAt: '2026-09-14T00:00:00.000Z' };
const HEIGHT = [{ axis: 'z', mm: 20 }];

test('B11: a U whose top photo hides half a prong reconstructs to the full analytic volume under X symmetry', () => {
  const hidden = (x, y) => inU(x, y) && !(x < 0 && y > 0);
  const seen = e.reconstructFromSilhouettes(views(hidden, 60, 40), HEIGHT, OPTS);
  assert.deepEqual(seen.report.sizeMm, { x: 60, y: 40, z: 20 }, 'the visible prong keeps the registration honest');
  assert.equal(seen.report.gridVolumeMm3, 28000, 'without the assertion the hidden 20 x 20 x 20 mm is carved away');
  assert.equal(seen.report.mirrored, undefined);

  const mirrored = e.reconstructFromSilhouettes(views(hidden, 60, 40), HEIGHT, { ...OPTS, symmetry: 'x' });
  assert.equal(mirrored.report.gridVolumeMm3, 36000, 'base 60 x 10 plus two 20 x 30 prongs, 20 mm tall');
  assert.deepEqual(mirrored.report.mirrored, { axis: 'x', addedVoxels: 8000, addedMm3: 8000 });
  assert.equal(mirrored.report.validation.valid, true);
  assert.match(mirrored.report.method, /mirrored about X = 0/);
  assert.ok(mirrored.report.warnings.some((w) => /8000 mm³ \(8000 voxels\) were copied from the other half, not seen/.test(w)), JSON.stringify(mirrored.report.warnings));
  assert.match(e.exportArtifacts(mirrored, 'T-B11').svg, /Mirrored about the X = 0 plane/, 'the drawing notes carry it');

  const whole = e.reconstructFromSilhouettes(views(inU, 60, 40), HEIGHT, OPTS);
  assert.deepEqual(Buffer.from(mirrored.grid.data), Buffer.from(whole.grid.data), 'identical, voxel for voxel, to the fully visible part');
});

test('B11: a C whose top photo hides half an arm completes across Y', () => {
  const hidden = (x, y) => inC(x, y) && !(x > 0 && y > 0);
  const seen = e.reconstructFromSilhouettes(views(hidden, 60, 40), HEIGHT, OPTS);
  assert.equal(seen.report.gridVolumeMm3, 22000);
  const mirrored = e.reconstructFromSilhouettes(views(hidden, 60, 40), HEIGHT, { ...OPTS, symmetry: 'y' });
  assert.equal(mirrored.report.gridVolumeMm3, 28000, 'spine 10 x 40 plus two 50 x 10 arms, 20 mm tall');
  assert.equal(mirrored.report.mirrored.axis, 'y');
  assert.equal(mirrored.report.mirrored.addedMm3, 6000);
  const whole = e.reconstructFromSilhouettes(views(inC, 60, 40), HEIGHT, OPTS);
  assert.deepEqual(Buffer.from(mirrored.grid.data), Buffer.from(whole.grid.data));
});

test('B11: asserting symmetry on a part that is already symmetric adds nothing and says so', () => {
  const r = e.reconstructFromSilhouettes(views(inU, 60, 40), HEIGHT, { ...OPTS, symmetry: 'x' });
  assert.equal(r.report.gridVolumeMm3, 36000);
  assert.deepEqual(r.report.mirrored, { axis: 'x', addedVoxels: 0, addedMm3: 0 });
  assert.ok(r.report.warnings.some((w) => /already symmetric, so the mirror added nothing/.test(w)));
});

test('B11: mirrorUnion never removes material and is its own fixed point', () => {
  const g = e.createOccupancyGrid({ x: 10, y: 10, z: 4 }, 1, 1, 0);
  g.data[e.gridIndex(g, 2, 3, 2)] = 1;
  g.data[e.gridIndex(g, 9, 3, 2)] = 1; // already the X mirror of (2, 3, 2): nx = 12
  g.data[e.gridIndex(g, 4, 8, 1)] = 1;
  assert.equal(e.mirrorUnion(g, 'x'), 1, 'only the unpartnered voxel gains a partner');
  assert.equal(g.data[e.gridIndex(g, 7, 8, 1)], 1);
  assert.equal(e.countSolid(g), 4);
  assert.equal(e.mirrorUnion(g, 'x'), 0, 'mirroring a symmetric solid changes nothing');
});

test('B11: symmetry is refused on any axis but x and y, before any work', () => {
  for (const symmetry of ['z', 'X', '', 'xy', 1]) {
    assert.throws(() => e.reconstructFromSilhouettes(views(inU, 60, 40), HEIGHT, { ...OPTS, symmetry }),
      (err) => err instanceof RangeError && /symmetry must be "x" or "y"/.test(err.message), `accepted ${JSON.stringify(symmetry)}`);
  }
});
