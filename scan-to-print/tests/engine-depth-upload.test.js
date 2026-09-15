/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | A device's range image into the job (BACKLOG B1/B8): a float32 range image decodes bit-for-bit into the DepthMap the carver reads with NaN and Infinity as no return; 16-bit samples decode with 0 as no return and depthScale to millimetres; the photo hull of a cylinder (front, right, top silhouettes) refined by a top range image of the cup recovers the cavity EXACTLY, on the job's own hull grid, and the report lists the silhouette and the depth views; a sensor plane inside the part, an empty map list and every malformed header field are RangeErrors naming the problem.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));

const rect = (uMm, vMm) => e.maskFromPredicate(200, 200, (x, y) => Math.abs(x - 100) < uMm && Math.abs(y - 100) < vMm);
/** Three photos of a solid cylinder r=20 h=50: front and right are 40 x 50 rectangles, top is a disc. */
const cylinderViews = () => [
  { view: 'front', mask: rect(40, 50) },
  { view: 'right', mask: rect(40, 50) },
  { view: 'top', mask: e.maskFromPredicate(200, 200, (x, y) => Math.hypot(x - 100, y - 100) < 40) },
];
const HEIGHT = [{ axis: 'z', mm: 50 }];
const OPTS = { resolution: 64, smoothIterations: 0, generatedAt: '2026-09-14T00:00:00.000Z' };

/** Hollow a grid from the top: radius 14, floor 5 mm thick. */
function hollowed(grid) {
  const g = e.cloneGrid(grid);
  for (let k = 0; k < g.nz; k += 1) for (let j = 0; j < g.ny; j += 1) for (let i = 0; i < g.nx; i += 1) {
    const p = e.voxelCenter(g, i, j, k);
    if (Math.hypot(p.x, p.y) < 14 && p.z > 5) g.data[e.gridIndex(g, i, j, k)] = 0;
  }
  return g;
}

/** The job's hull, the cup carved from it, and a top range image of that cup. */
function cupFixture() {
  const hull = e.reconstructFromSilhouettes(cylinderViews(), HEIGHT, OPTS);
  const cup = hollowed(hull.grid);
  const map = e.renderDepth(cup, 'top', { mmPerPx: 0.5, width: 120, height: 120 });
  return { hull, cup, map };
}

/** The multipart fields a client sends with a range image: every value a string. */
const fieldsOf = (map, format, extra = {}) => ({
  format, view: map.view, width: String(map.width), height: String(map.height), mmPerPx: String(map.mmPerPx),
  uCenterPx: String(map.uCenterPx), vCenterPx: String(map.vCenterPx), uCenterMm: String(map.uCenterMm), vCenterMm: String(map.vCenterMm),
  planeMm: String(map.planeMm), ...extra,
});

test('B1: a float32 range image decodes bit for bit; NaN and Infinity are no return', () => {
  const { map } = cupFixture();
  const bytes = new Uint8Array(map.data.length * 4);
  const view = new DataView(bytes.buffer);
  map.data.forEach((d, i) => view.setFloat32(i * 4, i === 7 ? Infinity : d, true));
  const header = e.parseDepthHeader(fieldsOf(map, 'f32le'));
  const decoded = e.depthMapFromFloat32(bytes, header);
  assert.equal(decoded.view, 'top');
  assert.equal(decoded.planeMm, map.planeMm);
  assert.ok(Number.isNaN(decoded.data[7]), 'Infinity is no return');
  for (let i = 0; i < map.data.length; i += 1) {
    if (i === 7) continue;
    assert.ok(Object.is(decoded.data[i], map.data[i]) || (Number.isNaN(decoded.data[i]) && Number.isNaN(map.data[i])), `pixel ${i}`);
  }
});

test('B1: 16-bit samples decode with 0 as no return and depthScale to millimetres', () => {
  const { map } = cupFixture();
  const scale = 0.01;
  const samples = Uint16Array.from(map.data, (d) => (Number.isFinite(d) ? Math.round(d / scale) : 0));
  const decoded = e.depthMapFromUint16(samples, e.parseDepthHeader(fieldsOf(map, 'png16', { depthScale: String(scale) })));
  for (let i = 0; i < map.data.length; i += 1) {
    if (Number.isNaN(map.data[i])) assert.ok(Number.isNaN(decoded.data[i]), `pixel ${i} stays no-return`);
    else assert.ok(Math.abs(decoded.data[i] - map.data[i]) <= scale / 2 + 1e-6, `pixel ${i}: ${decoded.data[i]} vs ${map.data[i]}`);
  }
  const fromPng = e.parseDepthHeader({ ...fieldsOf(map, 'png16'), width: '', height: '' }, { width: map.width, height: map.height });
  assert.equal(fromPng.width, map.width, 'a PNG carries its own size');
});

test('B8: the photo hull of a cylinder refined by a top range image recovers the cup cavity exactly', () => {
  const { hull, cup, map } = cupFixture();
  const result = e.reconstructHullWithDepth(cylinderViews(), HEIGHT, [map], OPTS);
  assert.equal(result.report.lane, 'depth');
  assert.deepEqual(result.report.viewsUsed, ['front', 'right', 'top'], 'the silhouette views and the depth view, once each');
  assert.deepEqual(result.report.depthViews, ['top']);
  assert.match(result.report.method, /Visual hull from 3 silhouettes \(front, right, top\), depth-carved from 1 range image \(top\)/);
  assert.equal(e.countSolid(result.grid), e.countSolid(cup), 'the cavity is recovered to the voxel, on the job hull grid');
  assert.deepEqual(Buffer.from(result.grid.data), Buffer.from(cup.data));
  const cavity = hull.report.gridVolumeMm3 - result.report.gridVolumeMm3;
  const analytic = Math.PI * 14 * 14 * 45;
  assert.ok(Math.abs(cavity - analytic) / analytic < 0.05, `cavity ${cavity.toFixed(0)} mm3 against ${analytic.toFixed(0)}`);
  assert.equal(result.report.validation.valid, true);
});

test('B1: a sensor plane inside the part, or no range image, is refused', () => {
  const { map } = cupFixture();
  assert.throws(() => e.reconstructHullWithDepth(cylinderViews(), HEIGHT, [{ ...map, planeMm: -25 }], OPTS),
    (err) => err instanceof RangeError && /sensor plane \(-25 mm along its view\) lies inside the part/.test(err.message));
  assert.throws(() => e.reconstructHullWithDepth(cylinderViews(), HEIGHT, [], OPTS), (err) => err instanceof RangeError && /At least one range image/.test(err.message));
});

test('B1: malformed headers and payloads are RangeErrors that name the field', () => {
  const { map } = cupFixture();
  const good = fieldsOf(map, 'f32le');
  const refuses = (fn, pattern) => assert.throws(fn, (err) => err instanceof RangeError && pattern.test(err.message), pattern.source);
  refuses(() => e.parseDepthHeader({ ...good, format: 'jpeg' }), /format must be one of png16, f32le/);
  refuses(() => e.parseDepthHeader({ ...good, view: 'side' }), /view must be one of/);
  refuses(() => e.parseDepthHeader({ ...good, width: '12.5' }), /positive integers/);
  refuses(() => e.parseDepthHeader({ ...good, width: '5000', height: '5000' }), /exceeds/);
  refuses(() => e.parseDepthHeader({ ...good, mmPerPx: '0' }), /mmPerPx must be positive/);
  refuses(() => e.parseDepthHeader({ ...good, mmPerPx: 'abc' }), /mmPerPx must be a finite number/);
  refuses(() => e.parseDepthHeader({ ...good, planeMm: '   ' }), /planeMm must be a finite number/);
  refuses(() => e.parseDepthHeader({ ...good, planeMm: undefined }), /planeMm is required/);
  refuses(() => e.parseDepthHeader({ ...good, depthScale: '0' }), /depthScale must be between/);
  refuses(() => e.parseDepthHeader({ ...good, width: '99' }, { width: 120, height: 120 }), /says 99x120 but the image is 120x120/);
  const header = e.parseDepthHeader(good);
  refuses(() => e.depthMapFromFloat32(new Uint8Array(10), header), /float32 range image is 57600 bytes, not 10/);
  refuses(() => e.depthMapFromUint16(new Uint16Array(3), header), /16-bit range image has 14400 samples, not 3/);
});
