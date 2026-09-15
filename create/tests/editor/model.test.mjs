/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify editable project round trips, immutable operations, resource refusals and bounded undo history.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, applyOperation, validateProject, serializeProject, parseProject, LIMITS } from '../../tools/editor/model.mjs';
import { createHistory } from '../../tools/editor/history.mjs';
import { hitTest, worldToLayer } from '../../tools/editor/hit-test.mjs';

const SRC = '/api/create/project-assets/12345678-1234-1234-1234-123456789abc';
const rectangle = (id, patch = {}) => ({ id, type: 'rect', x: 10, y: 20, w: 80, h: 40, fill: '#ff0000', ...patch });
const add = (project, layer) => applyOperation(project, { type: 'add', layer });

function layersProject() {
  let project = createProject({ width: 640, height: 480, name: 'Synthetic layered drawing' });
  project = applyOperation(project, { type: 'add', images: { photo: { src: SRC, width: 80, height: 60 } },
    layer: { id: 'photo-layer', type: 'image', assetId: 'photo', w: 160, h: 120, crop: { x: .25, y: 0, w: .5, h: 1 } } });
  for (const layer of [rectangle('rect'), { ...rectangle('ellipse'), type: 'ellipse' },
    { id: 'text', type: 'text', text: 'Synthetic heading\nSecond line' },
    { id: 'stroke', type: 'freehand', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }]) project = add(project, layer);
  return project;
}

test('all five layer kinds and asset references remain editable through normalized JSON', () => {
  const project = layersProject(), json = serializeProject(project, { assetMode: 'reference' }), loaded = parseProject(json, { assetMode: 'reference' });
  assert.deepEqual(loaded, project); assert.deepEqual(loaded.layers.map(layer => layer.type), ['image', 'rect', 'ellipse', 'text', 'freehand']);
  assert.equal(loaded.images.photo.src, SRC); assert.deepEqual(loaded.layers[0].crop, { x: .25, y: 0, w: .5, h: 1 });
  const edited = applyOperation(loaded, { type: 'update', id: 'text', patch: { text: 'Still editable' } });
  assert.equal(edited.layers[3].text, 'Still editable'); assert.equal(project.layers[3].text, 'Synthetic heading\nSecond line');
});

test('new layers receive stable distinct IDs and editing leaves original snapshots untouched', () => {
  const empty = createProject(), first = add(empty, { type: 'rect' }), second = add(first, { type: 'rect' });
  assert.equal(empty.layers.length, 0); assert.equal(first.layers.length, 1); assert.notEqual(first.layers[0].id, second.layers[1].id);
  const moved = applyOperation(second, { type: 'update', id: first.layers[0].id, patch: { x: 30, rotation: 450, opacity: .4 } });
  assert.equal(moved.layers[0].id, first.layers[0].id); assert.equal(moved.layers[0].rotation, 90); assert.equal(first.layers[0].x, 0);
});

test('duplicate, reorder and remove operate on exact IDs while retaining asset identity', () => {
  const project = layersProject(), duplicated = applyOperation(project, { type: 'duplicate', id: 'photo-layer', newId: 'copy', offset: 12 });
  assert.equal(duplicated.layers[1].id, 'copy'); assert.equal(duplicated.layers[1].assetId, 'photo'); assert.equal(duplicated.layers[1].x, 12);
  duplicated.layers[1].crop.x = .1; assert.equal(duplicated.layers[0].crop.x, .25); assert.equal(project.layers[0].crop.x, .25);
  const top = applyOperation(duplicated, { type: 'reorder', id: 'copy', index: 5 }); assert.equal(top.layers.at(-1).id, 'copy');
  const removed = applyOperation(top, { type: 'remove', id: 'photo-layer' }); assert.equal(removed.layers.length, 5); assert.ok(removed.images.photo);
});

test('invalid operations cannot partially mutate layers or image dictionaries', () => {
  const original = layersProject(), before = serializeProject(original);
  for (const operation of [{ type: 'update', id: 'missing', patch: { x: 1 } }, { type: 'remove', id: 'missing' },
    { type: 'reorder', id: 'rect', index: -1 }, { type: 'duplicate', id: 'rect', newId: 'text' },
    { type: 'update', id: 'rect', patch: { type: 'image' } }, { type: 'update', id: 'rect', patch: { id: 'changed' } },
    { type: 'add', images: { extra: { src: SRC, width: 1, height: 1 } }, layer: { type: 'unsupported' } }]) {
    assert.throws(() => applyOperation(original, operation)); assert.equal(serializeProject(original), before);
  }
});

test('locked content refuses edits, removals and ordering but permits deliberate unlocking', () => {
  const project = add(createProject(), rectangle('locked', { locked: true }));
  for (const operation of [{ type: 'update', id: 'locked', patch: { x: 0 } }, { type: 'remove', id: 'locked' },
    { type: 'duplicate', id: 'locked' }, { type: 'reorder', id: 'locked', index: 0 }]) assert.throws(() => applyOperation(project, operation), /Unlock/);
  const hidden = applyOperation(project, { type: 'update', id: 'locked', patch: { visible: false } }); assert.equal(hidden.layers[0].visible, false);
  const unlocked = applyOperation(hidden, { type: 'update', id: 'locked', patch: { locked: false } });
  assert.equal(applyOperation(unlocked, { type: 'update', id: 'locked', patch: { x: 50 } }).layers[0].x, 50);
});

test('canvas edits do not flatten, stretch or discard layer positions', () => {
  const project = layersProject(), resized = applyOperation(project, { type: 'project', patch: { width: 320, height: 240, background: '#fff', name: 'Resized' } });
  assert.equal(resized.width, 320); assert.equal(resized.background, '#fff'); assert.deepEqual(resized.layers, project.layers);
});

for (const [name, change] of [
  ['unknown version', project => { project.version = 2; }], ['excessive dimensions', project => { project.width = 8193; }],
  ['pixel budget', project => { project.width = 8192; project.height = 8192; }], ['nonfinite values', project => { project.layers[0].opacity = NaN; }],
  ['duplicate IDs', project => { project.layers[1].id = project.layers[0].id; }], ['missing image', project => { delete project.images.photo; }],
  ['unknown fields', project => { project.ownerSub = 'not-part-of-document'; }], ['unsafe image reference', project => { project.images.photo.src = 'https://example.invalid/image.png'; }],
  ['source crop overflow', project => { project.layers[0].crop = { x: .9, y: 0, w: .5, h: 1 }; }],
  ['unbounded strokes', project => { project.layers[4].points = Array.from({ length: LIMITS.points + 1 }, () => ({ x: 0, y: 0 })); }],
]) test(`rejects ${name}`, () => { const project = layersProject(); change(project); assert.throws(() => validateProject(project)); });

test('prototype-like image IDs and nested project surprises cannot enter the schema', () => {
  const project = layersProject(); project.images = JSON.parse('{"__proto__":{"src":"x","width":1,"height":1}}');
  assert.throws(() => validateProject(project), /ID/); assert.equal({}.src, undefined);
  assert.throws(() => add(createProject(), rectangle('constructor')), /ID/);
});

test('portable raster mappings are allowed locally and refused by reference-only saves', () => {
  const project = layersProject(); project.images.photo.src = 'data:image/png;base64,YWJjZA==';
  assert.equal(parseProject(serializeProject(project)).images.photo.src, project.images.photo.src);
  assert.throws(() => serializeProject(project, { assetMode: 'reference' }), /uploads/);
  project.images.photo.src = 'data:image/svg+xml;base64,YWJjZA=='; assert.throws(() => validateProject(project), /Unsupported/);
});

test('reference document, layer count and aggregate decoded image budgets are bounded', () => {
  const project = createProject(); project.layers = Array.from({ length: 201 }, (_, index) => rectangle(`rect-${index}`));
  assert.throws(() => validateProject(project), /layers/);
  const text = createProject(); text.layers = Array.from({ length: 15 }, (_, index) => ({ id: `text-${index}`, type: 'text', text: 'x'.repeat(20000) }));
  assert.throws(() => validateProject(text, { assetMode: 'reference' }), /too large/);
  assert.throws(() => parseProject(' '.repeat(LIMITS.referenceBytes + 1), { assetMode: 'reference' }), /too large/);
  const images = createProject(); images.images = { a: { src: SRC, width: 8192, height: 4096 }, b: { src: SRC, width: 1, height: 1 } };
  assert.throws(() => validateProject(images), /Total decoded/);
});

test('undo and redo retain distinct snapshots, drop the old future on a branch, and ignore no-op commits', () => {
  const history = createHistory(createProject()), first = history.commit(add(history.current(), rectangle('one')));
  history.commit(add(first, rectangle('two'))); assert.equal(history.undo().layers.length, 1); assert.equal(history.canRedo(), true);
  const exposed = history.current(); exposed.layers[0].x = 999; assert.equal(history.current().layers[0].x, 10);
  history.commit(history.current()); assert.equal(history.canRedo(), true); assert.equal(history.redo().layers.length, 2);
  history.undo(); history.commit(add(history.current(), rectangle('branch'))); assert.equal(history.canRedo(), false);
  assert.deepEqual(history.current().layers.map(layer => layer.id), ['one', 'branch']);
});

test('history evicts older snapshots by count and bytes without losing the current edit', () => {
  const history = createHistory(createProject(), { limit: 2 });
  history.commit(add(history.current(), rectangle('one'))); history.commit(add(history.current(), rectangle('two')));
  assert.equal(history.undo().layers.length, 1); assert.equal(history.canUndo(), false); assert.equal(history.redo().layers.length, 2);
  const compact = createHistory(createProject(), { maxBytes: 1024 });
  compact.commit(add(compact.current(), { id: 'text', type: 'text', text: 'a'.repeat(200) }));
  compact.commit(applyOperation(compact.current(), { type: 'update', id: 'text', patch: { text: 'b'.repeat(200) } }));
  assert.equal(compact.canUndo(), false); assert.equal(compact.current().layers[0].text[0], 'b');
  assert.throws(() => compact.commit(add(compact.current(), { id: 'large', type: 'text', text: 'x'.repeat(2000) })), /budget/);
  assert.equal(compact.current().layers.length, 1); compact.reset(createProject()); assert.equal(compact.canUndo(), false);
});

test('hit testing follows paint order and visibility, lock, opacity and rotated geometry', () => {
  let project = add(createProject(), rectangle('bottom'));
  project = add(project, rectangle('top', { locked: true }));
  assert.equal(hitTest(project, { x: 20, y: 30 }).id, 'bottom'); assert.equal(hitTest(project, { x: 20, y: 30 }, { includeLocked: true }).id, 'top');
  project = applyOperation(project, { type: 'update', id: 'top', patch: { locked: false, visible: false } });
  assert.equal(hitTest(project, { x: 20, y: 30 }).id, 'bottom');
  project = applyOperation(project, { type: 'update', id: 'top', patch: { visible: true, opacity: 0 } });
  assert.equal(hitTest(project, { x: 20, y: 30 }).id, 'bottom');
  const rotated = add(createProject(), rectangle('rotated', { x: 100, y: 100, w: 100, h: 20, rotation: 90 }));
  assert.equal(hitTest(rotated, { x: 150, y: 145 }).id, 'rotated'); assert.equal(hitTest(rotated, { x: 105, y: 110 }), null);
  assert.deepEqual(worldToLayer(rotated.layers[0], { x: 150, y: 110 }), { x: 50, y: 10 });
});

test('ellipse corners and empty rectangle interiors do not intercept visible lower layers', () => {
  let project = add(createProject(), rectangle('lower', { x: 0, y: 0, w: 100, h: 100 }));
  project = add(project, { ...rectangle('oval', { x: 0, y: 0, w: 100, h: 100 }), type: 'ellipse' });
  assert.equal(hitTest(project, { x: 1, y: 1 }).id, 'lower'); assert.equal(hitTest(project, { x: 50, y: 50 }).id, 'oval');
  project = add(project, rectangle('outline', { x: 0, y: 0, w: 100, h: 100, fill: 'transparent', stroke: '#000', strokeWidth: 4 }));
  assert.equal(hitTest(project, { x: 50, y: 50 }).id, 'oval'); assert.equal(hitTest(project, { x: 1, y: 50 }).id, 'outline');
});

test('freehand selection measures actual segment distance and honors a bounded tolerance', () => {
  const project = add(createProject(), { id: 'stroke', type: 'freehand', x: 0, y: 0, w: 100, h: 100, strokeWidth: 4,
    points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
  assert.equal(hitTest(project, { x: 50, y: 50 }).id, 'stroke'); assert.equal(hitTest(project, { x: 10, y: 90 }), null);
  assert.equal(hitTest(project, { x: 50, y: 55 }), null); assert.equal(hitTest(project, { x: 50, y: 55 }, { tolerance: 3 }).id, 'stroke');
});
