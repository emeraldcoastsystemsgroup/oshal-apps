/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The orientation cube (BACKLOG B9): each of the six face markers, on a white card beside a real object, names its view; a rotated marker still does and reports the rotation; one wrong cell is tolerated and two are not; no marker, an unknown pattern and two markers each leave the view unassigned and say why; a solid dark square object and a marker too small to read are ignored; the dictionary keeps every pair of faces 6 cells apart in every rotation; six synthetic photos with markers reconstruct a 60 x 40 x 30 box to its exact volume with no manual assignment.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));

const SIZE = 200;
const BACKGROUND = [214, 200, 176];
const OBJECT = [40, 70, 160];
/** Object extents per view for a 60 x 40 x 30 box at 2 px/mm. */
const FACE_MM = { front: [60, 30], back: [60, 30], left: [40, 30], right: [40, 30], top: [60, 40], bottom: [60, 40] };

const rotateGrid = (g) => g[0].map((_, c) => g.map((row) => row[c]).reverse()); // 90 degrees clockwise
/**
 * A synthetic photo: the object centred, and each marker on a white card with one cell of margin.
 * A marker is { cells?, view?, x, y, cell, turns, flips }: `turns` quarter-turns clockwise, `flips` data cells [r, c] inverted.
 */
function photo({ object = [60, 30], objectColour = OBJECT, markers = [] } = {}) {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const paint = (x, y, rgb) => { if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return; data.set([...rgb, 255], (y * SIZE + x) * 4); };
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    paint(x, y, Math.abs(x + 0.5 - SIZE / 2) < object[0] && Math.abs(y + 0.5 - SIZE / 2) < object[1] ? objectColour : BACKGROUND);
  }
  for (const m of markers) {
    let grid = (m.cells ?? e.faceMarkerCells(m.view)).map((row) => [...row]);
    for (const [r, c] of m.flips ?? []) grid[r + 1][c + 1] ^= 1;
    for (let k = 0; k < (m.turns ?? 0); k += 1) grid = rotateGrid(grid);
    const card = grid.length + 2;
    for (let r = 0; r < card; r += 1) for (let c = 0; c < card; c += 1) {
      const black = r > 0 && c > 0 && r < card - 1 && c < card - 1 && grid[r - 1][c - 1] === 1;
      for (let dy = 0; dy < m.cell; dy += 1) for (let dx = 0; dx < m.cell; dx += 1) paint(m.x + (c - 1) * m.cell + dx, m.y + (r - 1) * m.cell + dy, black ? [0, 0, 0] : [255, 255, 255]);
    }
  }
  return { width: SIZE, height: SIZE, data };
}
const at = (view, extra = {}) => ({ view, x: 16, y: 16, cell: 4, ...extra });

test('B9: each of the six face markers, beside a real object, names its view', () => {
  for (const view of e.VIEW_NAMES) {
    const scan = e.detectFaceMarkers(photo({ object: FACE_MM[view], markers: [at(view)] }));
    assert.equal(scan.view, view, scan.reason);
    assert.equal(scan.markers.length, 1);
    assert.equal(scan.markers[0].rotationDeg, 0);
    assert.equal(scan.markers[0].bitErrors, 0);
    assert.match(scan.reason, new RegExp(`this photo is the ${view} view`));
  }
});

test('B9: a rotated marker still names its view and reports how far it is turned', () => {
  for (const [turns, deg] of [[1, 90], [2, 180], [3, 270]]) {
    const scan = e.detectFaceMarkers(photo({ markers: [at('right', { turns })] }));
    assert.equal(scan.view, 'right');
    assert.equal(scan.markers[0].rotationDeg, deg);
  }
});

test('B9: one wrong cell is tolerated; two are not', () => {
  const one = e.detectFaceMarkers(photo({ markers: [at('top', { flips: [[1, 2]] })] }));
  assert.equal(one.view, 'top');
  assert.equal(one.markers[0].bitErrors, 1);
  const two = e.detectFaceMarkers(photo({ markers: [at('top', { flips: [[1, 2], [3, 0]] })] }));
  assert.equal(two.view, null, 'two wrong cells could be another face read badly, so the person decides');
  assert.equal(two.unknown, 1);
});

/** The first mixed 4 x 4 pattern at least 3 cells from every face in every rotation: a marker that is not in the dictionary. */
function foreignCells() {
  const faces = e.VIEW_NAMES.flatMap((v) => { let g = e.faceMarkerCells(v).slice(1, -1).map((r) => r.slice(1, -1)); const out = []; for (let k = 0; k < 4; k += 1) { out.push(g.flat()); g = rotateGrid(g); } return out; });
  for (let v = 1; v < 0xffff; v += 1) {
    const bits = Array.from({ length: 16 }, (_, i) => (v >> (15 - i)) & 1);
    if (faces.every((f) => f.reduce((s, b, i) => s + (b !== bits[i] ? 1 : 0), 0) >= 3)) {
      return Array.from({ length: 6 }, (_, r) => Array.from({ length: 6 }, (_, c) => (r === 0 || c === 0 || r === 5 || c === 5 ? 1 : bits[(r - 1) * 4 + (c - 1)])));
    }
  }
  throw new Error('no foreign pattern');
}

test('B9: no marker, an unknown pattern, or two markers leave the view unassigned and say why', () => {
  const none = e.detectFaceMarkers(photo());
  assert.equal(none.view, null);
  assert.match(none.reason, /No orientation-cube marker is visible/);
  const foreign = e.detectFaceMarkers(photo({ markers: [{ cells: foreignCells(), x: 16, y: 16, cell: 4 }] }));
  assert.equal(foreign.view, null);
  assert.equal(foreign.unknown, 1);
  assert.match(foreign.reason, /not an orientation-cube face/);
  const both = e.detectFaceMarkers(photo({ object: [40, 20], markers: [at('front'), at('top', { x: 150 })] }));
  assert.equal(both.view, null);
  assert.deepEqual(both.markers.map((m) => m.view).sort(), ['front', 'top']);
  assert.match(both.reason, /Markers for front and top are both visible/);
});

test('B9: a solid dark square object and a marker too small to read are not markers', () => {
  const block = e.detectFaceMarkers(photo({ object: [30, 30], objectColour: [0, 0, 0] }));
  assert.equal(block.view, null);
  assert.equal(block.unknown, 0, 'a uniformly dark part has no mixed data cells, so it is not even a candidate');
  const tiny = e.detectFaceMarkers(photo({ markers: [at('front', { cell: 2 })] }));
  assert.equal(tiny.view, null, `cells under ${e.FACE_MARKER_LIMITS.minCellPx} px are not read`);
});

test('B9: the dictionary keeps every pair of faces at least 6 cells apart, in every rotation', () => {
  const rotations = (v) => { let g = e.faceMarkerCells(v).slice(1, -1).map((r) => r.slice(1, -1)); const out = []; for (let k = 0; k < 4; k += 1) { out.push(g.flat()); g = rotateGrid(g); } return out; };
  const dist = (a, b) => a.reduce((s, x, i) => s + (x !== b[i] ? 1 : 0), 0);
  for (const [i, a] of e.VIEW_NAMES.entries()) {
    const own = rotations(a);
    for (let k = 1; k < 4; k += 1) assert.ok(dist(own[0], own[k]) >= 6, `${a} is ambiguous under its own rotation`);
    for (const b of e.VIEW_NAMES.slice(i + 1)) for (const r of rotations(b)) assert.ok(dist(own[0], r) >= 6, `${a} and ${b} are too close`);
  }
});

test('B9: six synthetic photos with markers reconstruct with no manual assignment', () => {
  const silhouettes = e.VIEW_NAMES.map((truth) => {
    const raster = photo({ object: FACE_MM[truth], markers: [at(truth)] });
    const scan = e.detectFaceMarkers(raster);
    assert.equal(scan.view, truth);
    return { view: scan.view, mask: e.extractSilhouette(raster).mask };
  });
  const r = e.reconstructFromSilhouettes(silhouettes, [{ axis: 'x', mm: 60 }], { resolution: 60, smoothIterations: 0 });
  assert.deepEqual(r.report.sizeMm, { x: 60, y: 40, z: 30 }, 'the marker card never became part of a silhouette');
  assert.deepEqual(r.report.viewsUsed, e.VIEW_NAMES);
  assert.equal(r.report.gridVolumeMm3, 72000);
});

test('B9: a face prints as an SVG with its border and code, and a bad size is refused', () => {
  const svg = e.faceMarkerSvg('front', 25);
  const blacks = (svg.match(/<rect x=/g) || []).length;
  assert.equal(blacks, 20 + [...e.FACE_MARKER_CODES.front].filter((c) => c === '1').length, 'the 20 border cells and the black code cells');
  assert.match(svg, /width="25mm"/);
  assert.throws(() => e.faceMarkerSvg('front', 0), (err) => err instanceof RangeError && /sideMm/.test(err.message));
});
