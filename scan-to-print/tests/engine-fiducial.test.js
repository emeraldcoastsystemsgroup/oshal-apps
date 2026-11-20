/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Deterministic square fiducial detector and automatic scale anchor
 *                     |                             | (BACKLOG B3): synthetic photo with object + known-size fiducial
 *                     |                             | square recovers exact extents within 1 voxel without ruler entry,
 *                     |                             | populates `dimensionSources` with `fiducial` (including drawing
 *                     |                             | notes), supports orientation-cube face markers as fiducials,
 *                     |                             | separates a small object from a larger fiducial, rejects solid
 *                     |                             | objects / flat frames / clipped squares / ambiguous dual markers
 *                     |                             | with zero false positives, and verifies `fiducialMm` settings
 *                     |                             | and surface wiring.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));

/** Create a light-background RGBA raster. */
function blankRaster(width, height, rgb = [240, 238, 232]) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

/** Paint a solid rectangle on a raster. */
function fillRect(raster, x0, y0, w, h, rgb) {
  for (let y = y0; y < y0 + h; y += 1) {
    if (y < 0 || y >= raster.height) continue;
    for (let x = x0; x < x0 + w; x += 1) {
      if (x < 0 || x >= raster.width) continue;
      const at = (y * raster.width + x) * 4;
      raster.data[at] = rgb[0];
      raster.data[at + 1] = rgb[1];
      raster.data[at + 2] = rgb[2];
    }
  }
}

/** Paint a 6x6 concentric high-contrast calibration fiducial square (outer border = 6 * cellPx). */
function drawConcentricFiducial(raster, x0, y0, cellPx) {
  const side = 6 * cellPx;
  fillRect(raster, x0 - cellPx, y0 - cellPx, side + 2 * cellPx, side + 2 * cellPx, [252, 252, 252]);
  fillRect(raster, x0, y0, side, side, [12, 12, 12]);
  fillRect(raster, x0 + cellPx, y0 + cellPx, 4 * cellPx, 4 * cellPx, [252, 252, 252]);
  fillRect(raster, x0 + 2 * cellPx, y0 + 2 * cellPx, 2 * cellPx, 2 * cellPx, [12, 12, 12]);
}

/** Paint an orientation-cube face marker (outer border = 6 * cellPx). */
function drawFaceMarker(raster, view, x0, y0, cellPx) {
  const cells = e.faceMarkerCells(view);
  const side = cells.length * cellPx;
  fillRect(raster, x0 - cellPx, y0 - cellPx, side + 2 * cellPx, side + 2 * cellPx, [252, 252, 252]);
  cells.forEach((row, r) => row.forEach((bit, c) => {
    fillRect(raster, x0 + c * cellPx, y0 + r * cellPx, cellPx, cellPx, bit ? [12, 12, 12] : [252, 252, 252]);
  }));
}

test('B3: concentric fiducial square beside an object sets view scale, recovers extents within 1 voxel, and sets dimensionSources to fiducial', () => {
  // 60 x 40 x 30 mm box photographed at exactly 2 px/mm (0.5 mm/px):
  // front: 120 x 60 px, top: 120 x 80 px, right: 80 x 60 px.
  // A 18 mm fiducial square is 36 x 36 px (cellPx = 6 -> sidePx = 36, 18 / 36 = 0.5 mm/px).
  const fiducialMm = 18;
  const frontPhoto = blankRaster(320, 240);
  fillRect(frontPhoto, 140, 80, 120, 60, [35, 50, 70]);
  drawConcentricFiducial(frontPhoto, 24, 30, 6);

  const topPhoto = blankRaster(320, 240);
  fillRect(topPhoto, 100, 80, 120, 80, [35, 50, 70]);

  const rightPhoto = blankRaster(320, 240);
  fillRect(rightPhoto, 120, 90, 80, 60, [35, 50, 70]);

  const scan = e.detectFiducialSquare(frontPhoto);
  assert.equal(scan.detected, true, scan.reason);
  assert.equal(scan.fiducial.kind, 'fiducial-square');
  assert.equal(scan.fiducial.sidePx, 36);

  const mmPerPx = e.fiducialScaleMmPerPx(scan.fiducial.sidePx, fiducialMm);
  assert.equal(mmPerPx, 0.5);

  const frontSil = e.extractSilhouette(frontPhoto);
  const topSil = e.extractSilhouette(topPhoto);
  const rightSil = e.extractSilhouette(rightPhoto);

  // Confirm extractSilhouette isolated the 120x60 object, NOT the 36x36 fiducial.
  assert.equal(frontSil.stats.bbox.maxX - frontSil.stats.bbox.minX + 1, 120);
  assert.equal(frontSil.stats.bbox.maxY - frontSil.stats.bbox.minY + 1, 60);

  // Reconstruct with ZERO ruler dimensions — scale comes solely from the front view's fiducial!
  const result = e.reconstructFromSilhouettes([
    { view: 'front', mask: frontSil.mask, fiducialMmPerPx: mmPerPx },
    { view: 'top', mask: topSil.mask },
    { view: 'right', mask: rightSil.mask },
  ], [], { resolution: 48, smoothIterations: 0, partName: 'fiducial-box' });

  const voxel = result.report.voxelMm;
  assert.ok(Math.abs(result.report.sizeMm.x - 60) <= voxel, `X=${result.report.sizeMm.x}`);
  assert.ok(Math.abs(result.report.sizeMm.y - 40) <= voxel, `Y=${result.report.sizeMm.y}`);
  assert.ok(Math.abs(result.report.sizeMm.z - 30) <= voxel, `Z=${result.report.sizeMm.z}`);
  assert.deepEqual(result.report.dimensionSources, { x: 'fiducial', y: 'derived', z: 'fiducial' });
  assert.equal(result.report.printable, true);
  assert.equal(result.report.gridVolumeMm3, 72000);

  const exported = e.exportArtifacts(result, 'STP-FID-01');
  assert.match(exported.svg, /\(fiducial\)/, 'engineering drawing notes record fiducial provenance');
});

test('B3: fiducials in all three views anchor all three axes directly as fiducial, and orientation-cube markers work too', () => {
  const fiducialMm = 18;
  const specs = [
    ['front', 120, 60],
    ['top', 120, 80],
    ['right', 80, 60],
  ];
  const silhouettes = specs.map(([view, ow, oh]) => {
    const photo = blankRaster(320, 240);
    fillRect(photo, 140, 70, ow, oh, [40, 45, 55]);
    drawFaceMarker(photo, view, 24, 30, 6);
    const fid = e.detectFiducialSquare(photo);
    assert.equal(fid.detected, true, `${view}: ${fid.reason}`);
    assert.equal(fid.fiducial.kind, 'face-marker');
    assert.equal(fid.fiducial.sidePx, 36);
    const sil = e.extractSilhouette(photo);
    return { view, mask: sil.mask, fiducialMmPerPx: e.fiducialScaleMmPerPx(fid.fiducial.sidePx, fiducialMm) };
  });

  const reg = e.registerSilhouettes(silhouettes, []);
  assert.deepEqual(reg.sizeMm, { x: 60, y: 40, z: 30 });
  assert.deepEqual(reg.sources, { x: 'fiducial', y: 'fiducial', z: 'fiducial' });
  assert.deepEqual(reg.warnings, []);
});

test('B3: small object beside a larger fiducial is cleanly isolated via excludeBoxes', () => {
  const photo = blankRaster(300, 220);
  // Fiducial is 48x48 (2304 px), object is a smaller 30x24 block (720 px).
  drawConcentricFiducial(photo, 24, 24, 8);
  fillRect(photo, 180, 100, 30, 24, [30, 40, 50]);

  const fid = e.detectFiducialSquare(photo);
  assert.equal(fid.detected, true);
  assert.equal(fid.fiducial.sidePx, 48);

  const sil = e.extractSilhouette(photo, { excludeBoxes: [fid.fiducial.bbox] });
  assert.equal(sil.stats.bbox.minX, 180);
  assert.equal(sil.stats.bbox.maxX - sil.stats.bbox.minX + 1, 30);
  assert.equal(sil.stats.bbox.maxY - sil.stats.bbox.minY + 1, 24);
});

test('B3: negative controls produce zero false positives and fall back cleanly', () => {
  // 1. Solid dark square object only (no fiducial) -> must NOT trigger false positive.
  const solidBox = blankRaster(240, 240);
  fillRect(solidBox, 70, 70, 60, 60, [20, 20, 20]);
  const solidScan = e.detectFiducialSquare(solidBox);
  assert.equal(solidScan.detected, false);
  assert.equal(solidScan.fiducial, null);

  // 2. Solid dark disc -> rejected.
  const disc = blankRaster(240, 240);
  for (let y = 0; y < 240; y += 1) {
    for (let x = 0; x < 240; x += 1) {
      if (Math.hypot(x - 120, y - 120) <= 36) fillRect(disc, x, y, 1, 1, [15, 15, 15]);
    }
  }
  assert.equal(e.detectFiducialSquare(disc).detected, false);

  // 3. Flat / low-contrast frame -> rejected.
  const flat = blankRaster(200, 200, [180, 180, 180]);
  assert.equal(e.detectFiducialSquare(flat).detected, false);

  // 4. Border-clipped fiducial -> rejected.
  const clipped = blankRaster(200, 200);
  drawConcentricFiducial(clipped, 0, 0, 6);
  assert.equal(e.detectFiducialSquare(clipped).detected, false);

  // 5. Too-small fiducial (cellPx = 2 -> 12 px < 18 px minSidePx) -> rejected.
  const tiny = blankRaster(200, 200);
  drawConcentricFiducial(tiny, 30, 30, 2);
  assert.equal(e.detectFiducialSquare(tiny).detected, false);

  // 6. Ambiguous dual generic fiducials -> refused rather than guessing.
  const dual = blankRaster(320, 200);
  drawConcentricFiducial(dual, 20, 40, 6);
  drawConcentricFiducial(dual, 160, 40, 8);
  const dualScan = e.detectFiducialSquare(dual);
  assert.equal(dualScan.detected, false);
  assert.equal(dualScan.candidates.length, 2);

  // 7. Registration with neither ruler nor fiducial -> RangeError; ruler fallback still works cleanly.
  const sil = e.extractSilhouette(solidBox);
  assert.throws(() => e.registerSilhouettes([{ view: 'front', mask: sil.mask }], []), RangeError);
  assert.throws(() => e.registerSilhouettes([{ view: 'front', mask: sil.mask, fiducialMmPerPx: 0 }], []), RangeError);
  const rulerFallback = e.registerSilhouettes([{ view: 'front', mask: sil.mask }], [{ axis: 'x', mm: 60 }]);
  assert.equal(rulerFallback.sources.x, 'known');
  assert.equal(rulerFallback.sizeMm.x, 60);
});

test('B3: printable fiducialSquareSvg and fiducialMm settings/UI validation hold', () => {
  const svg = e.fiducialSquareSvg(20);
  assert.match(svg, /^<svg /);
  assert.match(svg, /20 mm outer square/);
  assert.throws(() => e.fiducialSquareSvg(1), RangeError);
  assert.throws(() => e.fiducialSquareSvg(600), RangeError);
  assert.throws(() => e.fiducialScaleMmPerPx(0, 20), RangeError);
  assert.throws(() => e.fiducialScaleMmPerPx(40, 0), RangeError);

  const Module = require('node:module');
  const origLoad = Module._load;
  let parseSettings;
  Module._load = function stubLoad(request, parent, isMain) {
    if (request === 'express') return { Router: () => ({}) };
    if (request === 'multer') { const m = () => ({}); m.memoryStorage = () => ({}); m.diskStorage = () => ({}); return m; }
    if (request === 'sharp') return () => ({});
    if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {} }) };
    return origLoad.call(this, request, parent, isMain);
  };
  try {
    const resolved = require.resolve(path.resolve(__dirname, '..', 'routes', 'job-routes.js'));
    delete require.cache[resolved];
    parseSettings = require(resolved).parseSettings;
  } finally {
    Module._load = origLoad;
  }
  assert.equal(parseSettings({ fiducialMm: 20 }).fiducialMm, 20);
  assert.equal(parseSettings({ fiducialMm: '' }).fiducialMm, undefined);
  assert.equal(parseSettings({ fiducialMm: null }).fiducialMm, undefined);
  for (const bad of [0, 4.9, 500.1, -10, 'big', Number.NaN]) {
    assert.throws(() => parseSettings({ fiducialMm: bad }), RangeError, `expected RangeError for ${String(bad)}`);
  }

  const html = fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'scan-to-print.html'), 'utf8');
  const js = fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'scan-to-print.js'), 'utf8');
  const routesJs = fs.readFileSync(path.resolve(__dirname, '..', 'routes', 'job-routes.js'), 'utf8');
  assert.match(html, /id="fiducial-mm"/, 'surface exposes optional fiducial square size input');
  assert.match(js, /hasFiducialScale/, 'surface enables Make 3D model when fiducial scale is active');
  assert.match(js, /settings\.fiducialMm/, 'surface sends fiducialMm on reconstruct');
  assert.match(routesJs, /detectFiducialSquare/, 'job-routes runs deterministic fiducial detector on ingest');
  assert.match(routesJs, /resolveKnownForBuild/, 'job-routes permits fiducial-anchored builds without manual ruler entry');
});
