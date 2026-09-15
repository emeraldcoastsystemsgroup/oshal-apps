/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Printability beyond topology (BACKLOG B13): a solid cube flags nothing; a 0.6 mm wall at a 0.4 mm nozzle is flagged thin (and passes at a 0.25 mm nozzle, so the nozzle is an input, not a literal); the medial ridge finds a thin fin standing on a thick body; a flat ceiling reads 90 degrees; the SAME 55-degree ramp passes on 0.2 mm layers and fails on 0.4 mm layers, so the layer height changes the verdict; the overhang reading stays inside its published band across voxelised ramps; a failing check reaches the drawing's notes; every refusal is a RangeError naming the input.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));

const META = { lane: 'depth', viewsUsed: [], sources: { x: 'known', y: 'known', z: 'known' }, warnings: [], method: 'test' };

/** A grid of the given size whose voxels are solid where `inside` holds at the voxel centre. */
function gridFrom(sizeMm, voxelMm, inside) {
  const g = e.createOccupancyGrid(sizeMm, voxelMm, 1, 0);
  for (let k = 0; k < g.nz; k += 1) for (let j = 0; j < g.ny; j += 1) for (let i = 0; i < g.nx; i += 1) {
    if (inside(e.voxelCenter(g, i, j, k))) g.data[e.gridIndex(g, i, j, k)] = 1;
  }
  e.clearBorder(g);
  return g;
}

const cube = () => gridFrom({ x: 20, y: 20, z: 20 }, 1, (p) => Math.abs(p.x) < 10 && Math.abs(p.y) < 10 && p.z > 0 && p.z < 20);
const plate = () => gridFrom({ x: 12, y: 12, z: 0.6 }, 0.2, (p) => Math.abs(p.x) < 6 && Math.abs(p.y) < 6 && p.z > 0 && p.z < 0.6);
/** A 6 x 6 post carrying a 30 x 30 x 5 mm top: a flat ceiling 15 mm above the bed. */
const table = () => gridFrom({ x: 30, y: 30, z: 20 }, 0.5, (p) => (Math.abs(p.x) < 3 && Math.abs(p.y) < 3 && p.z > 0 && p.z < 20)
  || (Math.abs(p.x) < 15 && Math.abs(p.y) < 15 && p.z > 15 && p.z < 20));
/** A block whose underside leans out `deg` from vertical, either along -Y or along the XY diagonal. */
function ramp(deg, lean = 'y', voxelMm = 1) {
  const t = Math.tan((deg * Math.PI) / 180);
  if (lean === 'y') return gridFrom({ x: 24, y: 60, z: 24 }, voxelMm, (p) => Math.abs(p.x) < 12 && p.z > 0 && p.z < 20 && p.y < 28 && p.y > -p.z * t);
  const along = (p) => (p.x + p.y) / Math.SQRT2;
  return gridFrom({ x: 60, y: 60, z: 24 }, voxelMm, (p) => Math.abs(p.x) < 28 && Math.abs(p.y) < 28 && p.z > 0 && p.z < 20 && along(p) > -p.z * t && along(p) < 18);
}

test('B13: a solid cube flags nothing', () => {
  const checks = e.evaluatePrintChecks(cube(), { nozzleMm: 0.4, layerHeightMm: 0.2 });
  assert.equal(checks.thinWall, false);
  assert.equal(checks.steepOverhang, false);
  assert.deepEqual(checks.failures, []);
  assert.equal(checks.largestOverhangDeg, 0, 'nothing above the bed faces down');
  assert.equal(checks.largestOverhangAtMm, null);
  assert.equal(checks.minWallMm, 19, 'a 20-voxel block is one voxel conservative: 2 * 10 - 1');
  assert.ok(Math.abs(checks.minWallAtMm.x) <= 1 && Math.abs(checks.minWallAtMm.y) <= 1, 'the thinnest inscribed sphere of a cube is at its centre');
  assert.equal(checks.minWallLimitMm, 0.8);
  assert.ok(Math.abs(checks.overhangLimitDeg - (Math.atan(2) * 180) / Math.PI) < 1e-9, 'the overhang ceiling is derived from the two inputs');
});

test('B13: a 0.6 mm wall at a 0.4 mm nozzle is flagged thin; the same wall passes a 0.25 mm nozzle', () => {
  const thick = e.evaluatePrintChecks(plate(), { nozzleMm: 0.4, layerHeightMm: 0.2 });
  assert.ok(Math.abs(thick.minWallMm - 0.6) < 1e-9, `measured ${thick.minWallMm}`);
  assert.equal(thick.thinWall, true);
  assert.equal(thick.failures.length, 1);
  assert.match(thick.failures[0], /thinnest wall is 0\.60 mm, under the 0\.80 mm a 0\.4 mm nozzle needs for 2 perimeters/);
  const fine = e.evaluatePrintChecks(plate(), { nozzleMm: 0.25, layerHeightMm: 0.1 });
  assert.equal(fine.thinWall, false, '0.6 mm clears two 0.25 mm perimeters');
  const single = e.evaluatePrintChecks(plate(), { nozzleMm: 0.4, layerHeightMm: 0.2, perimeters: 1 });
  assert.equal(single.thinWall, false, 'the perimeter count is an input too');
});

test('B13: the medial ridge finds a 0.6 mm fin standing on a thick block', () => {
  const fin = gridFrom({ x: 20, y: 20, z: 20 }, 0.2, (p) => (Math.abs(p.x) < 10 && Math.abs(p.y) < 10 && p.z > 0 && p.z < 10)
    || (Math.abs(p.x) < 0.3 && Math.abs(p.y) < 8 && p.z > 0 && p.z < 20));
  const checks = e.evaluatePrintChecks(fin, { nozzleMm: 0.4, layerHeightMm: 0.2 });
  assert.ok(Math.abs(checks.minWallMm - 0.6) < 1e-9);
  assert.equal(checks.thinWall, true);
  assert.ok(Math.abs(checks.minWallAtMm.x) < 0.3 && checks.minWallAtMm.z > 10, `the thin wall is located in the fin: ${JSON.stringify(checks.minWallAtMm)}`);
});

test('B13: a flat ceiling reads 90 degrees and fails; the layer height changes a 55-degree verdict', () => {
  const ceiling = e.evaluatePrintChecks(table(), { nozzleMm: 0.4, layerHeightMm: 0.2 });
  assert.equal(ceiling.largestOverhangDeg, 90);
  assert.ok(ceiling.largestOverhangAtMm.z > 15 && ceiling.largestOverhangAtMm.z < 16, 'located on the underside of the top');
  assert.equal(ceiling.steepOverhang, true);
  assert.match(ceiling.failures.join(' '), /steepest overhang is 90° from vertical, over the 63°/);
  const slope = ramp(55);
  const coarse = e.evaluatePrintChecks(slope, { nozzleMm: 0.4, layerHeightMm: 0.2 });
  assert.equal(coarse.steepOverhang, false, `55-degree ramp read ${coarse.largestOverhangDeg} against ${coarse.overhangLimitDeg}`);
  const tall = e.evaluatePrintChecks(slope, { nozzleMm: 0.4, layerHeightMm: 0.4 });
  assert.ok(Math.abs(tall.overhangLimitDeg - 45) < 1e-9);
  assert.equal(tall.steepOverhang, true, 'a bead as tall as it is wide only overlaps up to 45 degrees');
});

test('B13: the overhang reading stays inside its published band on voxelised ramps', () => {
  const band = e.OVERHANG_READING_BAND_DEG;
  for (const lean of ['y', 'diagonal']) {
    for (const deg of [20, 30, 45, 60, 75]) {
      const read = e.evaluatePrintChecks(ramp(deg, lean)).largestOverhangDeg;
      assert.ok(read >= deg - band.under && read <= deg + band.over, `${lean} ramp at ${deg} degrees read ${read.toFixed(2)}`);
    }
  }
});

test('B13: every report carries printChecks and a failing check reaches the drawing notes', () => {
  const passing = e.finishFromGrid(cube(), { x: 20, y: 20, z: 20 }, META, { smoothIterations: 0, generatedAt: '2026-09-14T00:00:00.000Z' });
  assert.deepEqual(passing.report.printChecks.failures, []);
  assert.equal(passing.report.printChecks.nozzleMm, e.PRINT_CHECK_LIMITS.nozzleMm.default, 'the report states the machine it was checked against');
  assert.doesNotMatch(e.exportArtifacts(passing, 'T-1').svg, /Print check/);
  const thin = e.finishFromGrid(plate(), { x: 12, y: 12, z: 0.6 }, META, { smoothIterations: 0, printCheck: { nozzleMm: 0.4, layerHeightMm: 0.2 } });
  assert.equal(thin.report.printChecks.thinWall, true);
  assert.equal(thin.report.printable, true, 'printable stays the topological verdict');
  assert.match(e.exportArtifacts(thin, 'T-2').svg, /Print check: thinnest wall is 0\.60 mm/);
});

test('B13: the check is deterministic', () => {
  const a = JSON.stringify(e.evaluatePrintChecks(table()));
  const b = JSON.stringify(e.evaluatePrintChecks(table()));
  assert.equal(a, b);
});

test('B13: refusals are RangeErrors that name the input', () => {
  const g = cube();
  for (const nozzleMm of [0, -0.4, Number.NaN, Infinity, 3]) {
    assert.throws(() => e.evaluatePrintChecks(g, { nozzleMm, layerHeightMm: 0.02 }), (err) => err instanceof RangeError && /nozzleMm/.test(err.message));
  }
  assert.throws(() => e.evaluatePrintChecks(g, { nozzleMm: 0.4, layerHeightMm: 0 }), (err) => err instanceof RangeError && /layerHeightMm/.test(err.message));
  assert.throws(() => e.evaluatePrintChecks(g, { nozzleMm: 0.4, layerHeightMm: 0.5 }), (err) => err instanceof RangeError && /must not exceed nozzleMm/.test(err.message));
  assert.throws(() => e.evaluatePrintChecks(g, { perimeters: 1.5 }), (err) => err instanceof RangeError && /perimeters/.test(err.message));
  assert.throws(() => e.evaluatePrintChecks(g, { normalRadiusVoxels: 0 }), (err) => err instanceof RangeError && /normalRadiusVoxels/.test(err.message));
  assert.throws(() => e.evaluatePrintChecks(e.createOccupancyGrid({ x: 4, y: 4, z: 4 }, 1, 1, 0)), (err) => err instanceof RangeError && /at least one solid voxel/.test(err.message));
  assert.throws(() => e.finishFromGrid(cube(), { x: 20, y: 20, z: 20 }, META, { printCheck: { nozzleMm: -1 } }), (err) => err instanceof RangeError && /nozzleMm/.test(err.message));
});
