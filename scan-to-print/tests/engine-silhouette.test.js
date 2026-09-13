/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Silhouette extraction on synthetic photos: a disc on a tinted background comes out as a disc (coverage and bounds within a pixel), speckle is dropped, a dark logo does not tunnel through the object, an edge-touching object and a uniform photo each warn, and the same raster always yields byte-identical masks.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));

/** Paint an RGBA raster: background colour, then a predicate-driven object colour. */
function raster(width, height, background, object, inside, extra) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      let c = inside(x + 0.5, y + 0.5) ? object : background;
      if (extra) c = extra(x + 0.5, y + 0.5, c) || c;
      data[at] = c[0]; data[at + 1] = c[1]; data[at + 2] = c[2]; data[at + 3] = 255;
    }
  }
  return { width, height, data };
}

const BEIGE = [214, 200, 176];
const BLUE = [40, 70, 160];

test('a disc on a beige table is recovered to within a pixel', () => {
  const img = raster(160, 120, BEIGE, BLUE, (x, y) => Math.hypot(x - 80, y - 60) < 30);
  const result = e.extractSilhouette(img);
  const expectedPixels = Math.PI * 30 * 30;
  assert.ok(Math.abs(result.stats.pixels - expectedPixels) / expectedPixels < 0.03, `pixels ${result.stats.pixels}`);
  assert.deepEqual(result.background, { r: 214, g: 200, b: 176 });
  assert.ok(Math.abs(result.stats.bbox.minX - 50) <= 1 && Math.abs(result.stats.bbox.maxX - 109) <= 1);
  assert.deepEqual(result.warnings, []);
});

test('speckle away from the object is dropped and a dark logo does not become a hole', () => {
  const img = raster(160, 120, BEIGE, BLUE, (x, y) => Math.hypot(x - 80, y - 60) < 30, (x, y) => {
    if (Math.hypot(x - 20, y - 20) < 2) return [20, 20, 20]; // crumb
    if (Math.hypot(x - 80, y - 60) < 6) return [230, 230, 230]; // pale logo on the object
    return null;
  });
  const result = e.extractSilhouette(img);
  assert.equal(e.maskAt(result.mask, 20, 20), 0, 'crumb removed as a minor component');
  assert.equal(e.maskAt(result.mask, 80, 60), 1, 'logo filled as interior');
});

test('an object touching the frame edge and a uniform photo both warn', () => {
  const clipped = e.extractSilhouette(raster(100, 100, BEIGE, BLUE, (x) => x < 40));
  assert.ok(clipped.warnings.some((w) => /edge of the photo/.test(w)));
  const flat = e.extractSilhouette(raster(60, 60, BEIGE, BEIGE, () => false));
  assert.equal(flat.stats.pixels, 0);
  assert.ok(flat.warnings.some((w) => /No object found/.test(w)));
});

test('extraction is deterministic: identical rasters produce byte-identical masks', () => {
  const make = () => raster(120, 90, [200, 190, 170], [90, 30, 30], (x, y) => Math.abs(x - 60) < 25 && Math.abs(y - 45) < 15);
  const a = e.extractSilhouette(make());
  const b = e.extractSilhouette(make());
  assert.equal(a.threshold, b.threshold);
  assert.equal(Buffer.compare(Buffer.from(a.mask.data), Buffer.from(b.mask.data)), 0);
});

test('otsu splits a bimodal histogram and the low-contrast floor is applied', () => {
  const values = new Uint8Array(1000);
  for (let i = 0; i < 1000; i += 1) values[i] = i < 500 ? 20 + (i % 5) : 180 + (i % 5);
  const t = e.otsuThreshold(values);
  assert.ok(t >= 24 && t < 180, `threshold ${t}`);
  const near = raster(80, 80, [120, 120, 120], [126, 126, 126], (x) => x < 40);
  const result = e.extractSilhouette(near);
  assert.ok(result.threshold >= 14);
});

test('maskFromPredicate and maskStats agree on a rectangle', () => {
  const m = e.maskFromPredicate(50, 40, (x, y) => x >= 10 && x < 30 && y >= 5 && y < 15);
  const s = e.maskStats(m);
  assert.equal(s.pixels, 200);
  assert.deepEqual(s.bbox, { minX: 10, minY: 5, maxX: 29, maxY: 14 });
  assert.equal(e.maskAt(m, -1, 0), 0);
  assert.equal(e.maskAt(m, 10, 5), 1);
});
