/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove region selections land on the intended source pixels under zoom, crop, rotation and resize, stay put when the layer later moves, and that stale, ambiguous, locked, hidden, malformed and oversized selections are refused.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, applyOperation } from '../../tools/editor/model.mjs';
import { REGION_LIMITS, clientToCanvas, canvasToSource, sourceToCanvas, visibleSourceRect, polygonArea, selectionBounds,
  validateSelection, targetImageLayer, selectionFromCanvas, selectionFromLayer, resolveSelection, selectionSummary } from '../../tools/editor/region-select.mjs';

const SRC = '/api/create/project-assets/12345678-1234-1234-1234-123456789abc';
const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const closePoint = (actual, expected, tolerance = 1e-6) => { near(actual.x, expected.x, tolerance); near(actual.y, expected.y, tolerance); };

function photoProject(patch = {}, extra = []) {
  let project = applyOperation(createProject({ width: 800, height: 600 }), { type: 'add', images: { photo: { src: SRC, width: 400, height: 200 } },
    layer: { id: 'photo', type: 'image', assetId: 'photo', x: 100, y: 50, w: 400, h: 200, ...patch } });
  for (const layer of extra) project = applyOperation(project, { type: 'add', ...layer });
  return project;
}

test('canvas and source mappings are exact inverses through rotation, crop and non-uniform resize', () => {
  for (const rotation of [0, 37, -90, 180, 123.5]) {
    const project = photoProject({ rotation, w: 300, h: 260, crop: { x: .25, y: .1, w: .5, h: .8 } }), layer = project.layers[0], asset = project.images.photo;
    for (const source of [{ x: 100, y: 20 }, { x: 300, y: 180 }, { x: 222.5, y: 99.25 }]) closePoint(canvasToSource(layer, asset, sourceToCanvas(layer, asset, source)), source);
    const center = sourceToCanvas(layer, asset, { x: 200, y: 100 }); closePoint(center, { x: layer.x + layer.w / 2, y: layer.y + layer.h / 2 });
  }
});

test('the displayed zoom never changes which canvas pixel a pointer names', () => {
  const project = { width: 800, height: 600 };
  for (const scale of [.25, 1, 2]) {
    const rect = { left: 40, top: 30, width: 800 * scale, height: 600 * scale };
    closePoint(clientToCanvas({ x: 40 + 250 * scale, y: 30 + 125 * scale }, rect, project), { x: 250, y: 125 });
  }
  assert.throws(() => clientToCanvas({ x: 1, y: 1 }, { left: 0, top: 0, width: 0, height: 10 }, project), /not visible/);
});

test('a lasso over a cropped, rotated, stretched layer lands on the analytically expected source pixels', () => {
  // The layer shows the right half of the source (crop x .5), stretched to 400x400 and turned 90 degrees clockwise.
  const project = photoProject({ x: 200, y: 100, w: 400, h: 400, rotation: 90, crop: { x: .5, y: 0, w: .5, h: 1 } });
  const layer = project.layers[0], asset = project.images.photo;
  // Local (0,0) of an unrotated layer sits at the top-left; turned 90 degrees it moves to the top-right of the footprint.
  closePoint(canvasToSource(layer, asset, { x: 600, y: 100 }), { x: 200, y: 0 });
  closePoint(canvasToSource(layer, asset, { x: 200, y: 500 }), { x: 400, y: 200 });
  const selection = selectionFromCanvas(project, 'photo', [{ x: 300, y: 200 }, { x: 500, y: 200 }, { x: 500, y: 400 }, { x: 300, y: 400 }]);
  assert.equal(selection.kind, 'lasso'); assert.equal(selection.sourceWidth, 400); assert.equal(selection.sourceHeight, 200);
  assert.deepEqual(selectionBounds(selection.points), { x: 250, y: 50, w: 100, h: 100 }); near(polygonArea(selection.points), 10000, 1e-6);
});

test('a region keeps naming the same source pixels when the layer is later moved, resized, rotated or zoomed', () => {
  const project = photoProject({ crop: { x: .1, y: .1, w: .8, h: .8 } });
  const selection = selectionFromCanvas(project, 'photo', [{ x: 200, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 180 }, { x: 200, y: 180 }]);
  const moved = applyOperation(project, { type: 'update', id: 'photo', patch: { x: -50, y: 300, w: 123, h: 456, rotation: 71 } });
  const before = resolveSelection(project, selection), after = resolveSelection(moved, selection);
  assert.deepEqual(after.selection.points, before.selection.points);
  after.canvasPoints.forEach((point, index) => closePoint(canvasToSource(moved.layers[0], moved.images.photo, point), selection.points[index]));
  assert.notDeepEqual(after.canvasPoints, before.canvasPoints);
});

test('regions are clipped to exactly what the layer shows; a region wholly outside it is refused', () => {
  const project = photoProject({ crop: { x: .25, y: 0, w: .5, h: 1 } }), layer = project.layers[0], asset = project.images.photo;
  assert.deepEqual(visibleSourceRect(layer, asset), { x: 100, y: 0, w: 200, h: 200 });
  const clipped = selectionFromCanvas(project, 'photo', [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 150 }, { x: 0, y: 150 }]);
  assert.deepEqual(selectionBounds(clipped.points), { x: 100, y: 0, w: 100, h: 100 });
  assert.ok(clipped.points.every(point => point.x >= 100 && point.x <= 300 && point.y >= 0 && point.y <= 200));
  assert.throws(() => selectionFromCanvas(project, 'photo', [{ x: 600, y: 400 }, { x: 700, y: 400 }, { x: 700, y: 500 }]), /visible part/);
  assert.throws(() => selectionFromCanvas(project, 'photo', [{ x: 150, y: 100 }, { x: 152, y: 100 }, { x: 152, y: 102 }]), /too small/);
});

test('box and whole-image selections follow rotation and crop', () => {
  const project = photoProject({ rotation: 90, crop: { x: 0, y: .5, w: 1, h: .5 } });
  const whole = selectionFromLayer(project, 'photo');
  assert.equal(whole.kind, 'layer'); assert.deepEqual(selectionBounds(whole.points), { x: 0, y: 100, w: 400, h: 100 });
  const box = selectionFromCanvas(project, 'photo', [{ x: 250, y: 100 }, { x: 350, y: 200 }], { kind: 'box' });
  assert.equal(box.kind, 'box'); assert.equal(box.points.length, 4);
  box.points.forEach(point => assert.ok(point.y >= 100 && point.y <= 200));
  assert.throws(() => selectionFromCanvas(project, 'photo', [{ x: 1, y: 1 }], { kind: 'box' }), /larger region/);
  assert.throws(() => selectionFromCanvas(project, 'photo', [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 1 }], { kind: 'brush' }), /Unsupported/);
});

test('stale selections are refused with the reason: replaced image, deleted, hidden or locked layer, changed crop', () => {
  const project = photoProject({ crop: { x: 0, y: 0, w: .5, h: 1 } });
  const selection = selectionFromCanvas(project, 'photo', [{ x: 150, y: 80 }, { x: 250, y: 80 }, { x: 250, y: 180 }, { x: 150, y: 180 }]);
  const replaced = applyOperation(project, { type: 'add', images: { other: { src: SRC, width: 400, height: 200 } }, layer: { id: 'spare', type: 'rect' } });
  assert.throws(() => resolveSelection(applyOperation(replaced, { type: 'update', id: 'photo', patch: { assetId: 'other' } }), selection), /image changed/);
  assert.throws(() => resolveSelection(applyOperation(project, { type: 'remove', id: 'photo' }), selection), /no longer exists/);
  assert.throws(() => resolveSelection(applyOperation(project, { type: 'update', id: 'photo', patch: { visible: false } }), selection), /Show the image/);
  assert.throws(() => resolveSelection(applyOperation(project, { type: 'update', id: 'photo', patch: { locked: true } }), selection), /Unlock/);
  assert.throws(() => resolveSelection(applyOperation(project, { type: 'update', id: 'photo', patch: { crop: { x: .5, y: 0, w: .5, h: 1 } } }), selection), /crop changed/);
  assert.doesNotThrow(() => resolveSelection(applyOperation(project, { type: 'update', id: 'photo', patch: { crop: { x: 0, y: 0, w: 1, h: 1 } } }), selection));
});

test('an ambiguous target is refused: stacked images with none selected, a non-image selection, locked or hidden images', () => {
  const second = { images: { second: { src: SRC, width: 400, height: 200 } }, layer: { id: 'second', type: 'image', assetId: 'second', x: 300, y: 100, w: 400, h: 200 } };
  const title = { layer: { id: 'title', type: 'text', x: 0, y: 0, w: 800, h: 100, text: 'Title' } };
  const project = photoProject({}, [second, title]);
  assert.equal(targetImageLayer(project, null, { x: 150, y: 100 }).id, 'photo');
  assert.throws(() => targetImageLayer(project, null, { x: 400, y: 150 }), /More than one image/);
  assert.equal(targetImageLayer(project, 'second', { x: 400, y: 150 }).id, 'second');
  assert.throws(() => targetImageLayer(project, 'title', { x: 400, y: 150 }), /image layers/);
  assert.throws(() => targetImageLayer(project, null, { x: 790, y: 590 }), /Select an image layer/);
  const locked = applyOperation(project, { type: 'update', id: 'second', patch: { locked: true } });
  assert.equal(targetImageLayer(locked, null, { x: 400, y: 150 }).id, 'photo');
  assert.throws(() => targetImageLayer(locked, 'second', { x: 400, y: 150 }), /Unlock/);
  assert.throws(() => selectionFromLayer(locked, 'second'), /Unlock/);
});

test('selection validation refuses unknown fields, unsafe IDs, out-of-range points and unbounded outlines', () => {
  const valid = selectionFromLayer(photoProject(), 'photo');
  assert.deepEqual(validateSelection(structuredClone(valid)), valid);
  for (const [name, change] of [
    ['unknown field', value => { value.ownerSub = 'someone'; }], ['version', value => { value.version = 2; }],
    ['kind', value => { value.kind = 'brush'; }], ['unsafe layer ID', value => { value.layerId = '__proto__'; }],
    ['fractional source', value => { value.sourceWidth = 400.5; }], ['point outside source', value => { value.points[0].x = 401; }],
    ['negative point', value => { value.points[1].y = -1; }], ['non-numeric point', value => { value.points[0].x = '10'; }],
    ['extra point field', value => { value.points[0].z = 1; }], ['too few points', value => { value.points = value.points.slice(0, 2); }],
    ['too many points', value => { value.points = Array.from({ length: REGION_LIMITS.points + 1 }, (_, index) => ({ x: index % 400, y: index % 7 ? 0 : 199 })); }],
    ['feather', value => { value.feather = REGION_LIMITS.feather + 1; }], ['tiny area', value => { value.points = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }]; }],
  ]) { const value = structuredClone(valid); change(value); assert.throws(() => validateSelection(value), undefined, name); }
});

test('a long freehand lasso is decimated within the point budget and summarized without pixels', () => {
  const project = photoProject(), outline = Array.from({ length: 6000 }, (_, index) => {
    const angle = index / 6000 * Math.PI * 2; return { x: 300 + Math.cos(angle) * 80, y: 150 + Math.sin(angle) * 80 };
  });
  const selection = selectionFromCanvas(project, 'photo', outline, { feather: 4 });
  assert.ok(selection.points.length <= REGION_LIMITS.points); assert.equal(selection.feather, 4);
  near(polygonArea(selection.points), Math.PI * 80 * 80, 60);
  const summary = selectionSummary(selection);
  assert.deepEqual(Object.keys(summary), ['kind', 'layerId', 'x', 'y', 'width', 'height', 'area', 'points']);
  assert.ok(Object.values(summary).every(value => ['string', 'number'].includes(typeof value)));
  assert.deepEqual({ x: summary.x, y: summary.y, width: summary.width, height: summary.height }, { x: 120, y: 20, width: 160, height: 160 });
});
