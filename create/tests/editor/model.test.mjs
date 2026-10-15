/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify editable project round trips, immutable operations, resource refusals and bounded undo history.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Cover the four image filters: bounded values, neutral values omitted, Create v1 round trips in both asset modes, refusal on other layer kinds, and named looks that replace rather than stack.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Prove mask versioning, normalized persistence, source isolation and invalid/locked edit refusals.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Prove brush masks, mask combination and editable adjustment persistence with actual rendered pixels and UI gestures.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Integrate isolated group layers with bounded nesting, uniform transforms, ancestor locks and source-space region mapping.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Integrate editable cubic vector paths, bounded worker booleans, arrangement and explicit SVG interchange with existing private project flows.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, applyOperation, validateProject, serializeProject, parseProject, LIMITS, IMAGE_FILTERS, IMAGE_FILTER_LOOKS } from '../../tools/editor/model.mjs';
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
  ['unknown version', project => { project.version = 99; }], ['excessive dimensions', project => { project.width = 8193; }],
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

test('image filters round trip in Create v1 JSON and neutral values keep the unfiltered document shape', () => {
  const plain = layersProject(), before = serializeProject(plain, { assetMode: 'reference' });
  const neutral = applyOperation(plain, { type: 'update', id: 'photo-layer', patch: { saturation: 100, grayscale: 0, sepia: 0, blur: 0 } });
  assert.equal(serializeProject(neutral, { assetMode: 'reference' }), before);
  assert.deepEqual(Object.keys(neutral.layers[0]).filter(key => Object.hasOwn(IMAGE_FILTERS, key)), []);
  const filtered = applyOperation(plain, { type: 'update', id: 'photo-layer', patch: { saturation: 40, grayscale: 25, sepia: 60, blur: 3.5 } });
  for (const mode of ['reference', 'portable']) {
    const loaded = parseProject(serializeProject(filtered, { assetMode: mode }), { assetMode: mode });
    assert.deepEqual(loaded, filtered); assert.equal(loaded.layers[0].blur, 3.5); assert.equal(loaded.layers[0].sepia, 60);
  }
  assert.equal(plain.layers[0].sepia, undefined);
  const cleared = applyOperation(filtered, { type: 'update', id: 'photo-layer', patch: { grayscale: 0 } });
  assert.equal(cleared.layers[0].grayscale, undefined); assert.equal(cleared.layers[0].saturation, 40);
});

test('filter values outside their bounds, of the wrong type, or on non-image layers are refused', () => {
  const project = layersProject(), before = serializeProject(project);
  for (const [name, bounds] of Object.entries(IMAGE_FILTERS)) {
    for (const value of [bounds.min - 1, bounds.max + 0.5, NaN, Infinity, String(bounds.max), null, true]) {
      assert.throws(() => applyOperation(project, { type: 'update', id: 'photo-layer', patch: { [name]: value } }), new RegExp(`Image ${name}`));
    }
    assert.throws(() => applyOperation(project, { type: 'update', id: 'rect', patch: { [name]: bounds.max } }), /unsupported fields/);
  }
  assert.throws(() => applyOperation(project, { type: 'update', id: 'photo-layer', patch: { hueRotate: 90 } }), /unsupported fields/);
  assert.equal(serializeProject(project), before);
});

test('every named filter look is a valid edit that sets all four filters, so a new look replaces the last', () => {
  const project = layersProject();
  assert.deepEqual(Object.keys(IMAGE_FILTER_LOOKS), ['none', 'mono', 'vintage', 'vivid', 'muted', 'soft']);
  for (const look of Object.values(IMAGE_FILTER_LOOKS)) {
    assert.deepEqual(Object.keys(look.patch).sort(), Object.keys(IMAGE_FILTERS).sort()); assert.ok(look.label.length > 0);
    assert.doesNotThrow(() => applyOperation(project, { type: 'update', id: 'photo-layer', patch: look.patch }));
  }
  const vintage = applyOperation(project, { type: 'update', id: 'photo-layer', patch: IMAGE_FILTER_LOOKS.vintage.patch });
  const mono = applyOperation(vintage, { type: 'update', id: 'photo-layer', patch: IMAGE_FILTER_LOOKS.mono.patch });
  assert.equal(mono.layers[0].grayscale, 100); assert.equal(mono.layers[0].sepia, undefined); assert.equal(mono.layers[0].saturation, undefined);
  const none = applyOperation(mono, { type: 'update', id: 'photo-layer', patch: IMAGE_FILTER_LOOKS.none.patch });
  assert.equal(serializeProject(none), serializeProject(project));
  assert.throws(() => { IMAGE_FILTER_LOOKS.mono.patch.grayscale = 0; }); assert.throws(() => { IMAGE_FILTERS.blur.max = 1000; });
});


test('source-space masks upgrade documents, survive history and reject invalid geometry without mutation', () => {
  const project = layersProject(), mask = { points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] };
  const edited = applyOperation(project, { type: 'update', id: 'photo-layer', patch: { mask } });
  assert.equal(project.version, 1); assert.equal(edited.version, 2);
  assert.deepEqual(parseProject(serializeProject(edited)), edited);
  assert.equal(edited.layers[0].mask.enabled, true);
  mask.points[0].x = 99; assert.equal(edited.layers[0].mask.points[0].x, 0);
  const removed = applyOperation(edited, { type: 'update', id: 'photo-layer', patch: { mask: null } });
  assert.equal(removed.layers[0].mask, undefined);
  for (const invalid of [{ points: [{ x: 0, y: 0 }] }, { ...edited.layers[0].mask, feather: 65 },
    { ...edited.layers[0].mask, enabled: 'false' }, { points: [{ x: 0, y: 0 }, { x: 9999, y: 0 }, { x: 0, y: 20 }] },
    { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }] }]) {
    assert.throws(() => applyOperation(project, { type: 'update', id: 'photo-layer', patch: { mask: invalid } }));
    assert.equal(project.version, 1); assert.equal(project.layers[0].mask, undefined);
  }
  assert.throws(() => validateProject({ ...edited, version: 1 }), /version 2/);
  const locked = applyOperation(edited, { type: 'update', id: 'photo-layer', patch: { locked: true } });
  assert.throws(() => applyOperation(locked, { type: 'update', id: 'photo-layer', patch: { mask: null } }), /Unlock/);
});


test('mask edit lists are versioned, bounded, copied and source checked', () => {
  const source = layersProject(), points = [{ x: 5, y: 5 }];
  const mask = { points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }],
    operations: [{ kind: 'brush', mode: 'subtract', size: 4, opacity: .5, points }] };
  const next = applyOperation(source, { type: 'update', id: 'photo-layer', patch: { mask } });
  assert.equal(next.version, 3); points[0].x = 100;
  assert.equal(next.layers[0].mask.operations[0].points[0].x, 5);
  assert.deepEqual(parseProject(serializeProject(next)), next);
  for (const operation of [{ kind: 'brush', mode: 'intersect', points: [{ x: 0, y: 0 }] },
    { kind: 'brush', mode: 'subtract', size: 0, points: [{ x: 0, y: 0 }] },
    { kind: 'brush', mode: 'add', points: [{ x: 8000, y: 8000 }] }]) {
    assert.throws(() => applyOperation(source, { type: 'update', id: 'photo-layer', patch: { mask: { ...mask, operations: [operation] } } }));
  }
  assert.throws(() => validateProject({ ...next, version: 2 }), /version 3/);
});

test('editable adjustment layers retain curves and refuse invalid scopes, targets and levels', () => {
  const source = layersProject(), next = applyOperation(source, { type: 'add', layer: { id: 'grade', type: 'adjustment',
    scope: 'layer', targetId: 'photo-layer', exposure: -1, black: 10, white: 245, gamma: 1.5,
    curve: [{ x: 0, y: 0 }, { x: .5, y: .6 }, { x: 1, y: 1 }] } });
  assert.equal(next.version, 3); assert.deepEqual(parseProject(serializeProject(next)), next);
  for (const patch of [{ black: 245 }, { scope: 'bad' }, { targetId: 'missing' }, { exposure: 9 },
    { curve: [{ x: 0, y: 0 }, { x: .5, y: 1 }, { x: .5, y: 0 }, { x: 1, y: 1 }] }]) {
    assert.throws(() => applyOperation(next, { type: 'update', id: 'grade', patch }));
  }
  const removed = applyOperation(next, { type: 'remove', id: 'photo-layer' });
  assert.ok(!removed.layers.some(layer => layer.id === 'grade')); assert.ok(removed.images.photo);
  assert.throws(() => applyOperation(next, { type: 'reorder', id: 'grade', index: 0 }), /lower/);
});


test('isolated groups preserve child identity, nesting, uniform transforms and immutable undo', () => {
  const original = createProject({ width: 100, height: 100 });
  let project = applyOperation(original, { type: 'add', layer: { id: 'a', type: 'rect', x: 10, y: 10, w: 20, h: 20 } });
  project = applyOperation(project, { type: 'add', layer: { id: 'b', type: 'rect', x: 20, y: 20, w: 20, h: 20 } });
  const group = applyOperation(project, { type: 'group', ids: ['a', 'b'], id: 'g' });
  assert.equal(group.version, 3); assert.deepEqual(group.layers.at(-1).children, ['a', 'b']);
  assert.equal(project.layers[0].x, 10); assert.equal(group.layers[0].x, 0);
  assert.deepEqual(parseProject(serializeProject(group)), group);
  const transformed = applyOperation(group, { type: 'update', id: 'g', patch: { x: 30, w: 60, h: 60, rotation: 90 } });
  const ungrouped = applyOperation(transformed, { type: 'ungroup', id: 'g' });
  assert.ok(ungrouped.layers.every(layer => layer.rotation === 90)); assert.equal(ungrouped.layers[0].w, 40);
  assert.throws(() => applyOperation(group, { type: 'update', id: 'g', patch: { w: 60 } }), /aspect ratio/);
  assert.throws(() => applyOperation(group, { type: 'update', id: 'g', patch: { children: ['g'] } }), /child/);
  const locked = applyOperation(group, { type: 'update', id: 'g', patch: { locked: true } });
  assert.throws(() => applyOperation(locked, { type: 'update', id: 'a', patch: { x: 2 } }), /Unlock/);
  assert.equal(applyOperation(group, { type: 'remove', id: 'g' }).layers.length, 0);
});

test('duplicating a nested group remaps children and clipped adjustments without changing owned assets', () => {
  let project = layersProject();
  project = applyOperation(project, { type: 'add', layer: { id: 'grade', type: 'adjustment', scope: 'layer', targetId: 'photo-layer', exposure: -1 } });
  // Keep the clipped adjustment directly above its target before grouping.
  project = applyOperation(project, { type: 'reorder', id: 'grade', index: 1 });
  project = applyOperation(project, { type: 'group', ids: ['photo-layer', 'grade'], id: 'inner' });
  project = applyOperation(project, { type: 'group', ids: ['inner', 'rect'], id: 'outer' });
  project = applyOperation(project, { type: 'update', id: 'outer', patch: { opacity: .5, rotation: 30 } });
  const before = serializeProject(project), duplicated = applyOperation(project, { type: 'duplicate', id: 'outer', newId: 'copy', offset: 40 });
  const copied = duplicated.layers.find(layer => layer.id === 'copy');
  const inner = duplicated.layers.find(layer => layer.id === copied.children.find(id => duplicated.layers.find(item => item.id === id).type === 'group'));
  const photo = duplicated.layers.find(layer => layer.id === inner.children[0]), grade = duplicated.layers.find(layer => layer.id === inner.children[1]);
  assert.equal(photo.assetId, 'photo'); assert.equal(grade.targetId, photo.id);
  assert.equal(copied.x, project.layers.find(layer => layer.id === 'outer').x + 40);
  assert.equal(copied.rotation, 30); assert.equal(copied.opacity, .5);
  assert.deepEqual(duplicated.images, project.images); assert.equal(serializeProject(project), before);
  assert.deepEqual(parseProject(serializeProject(duplicated)), duplicated);
  assert.deepEqual(applyOperation(project, { type: 'duplicate', id: 'outer', newId: 'copy', offset: 40 }), duplicated);
  const edited = applyOperation(duplicated, { type: 'update', id: grade.id, patch: { exposure: 1 } });
  assert.equal(edited.layers.find(layer => layer.id === 'grade').exposure, -1);
  assert.equal(duplicated.layers.find(layer => layer.id === grade.id).exposure, -1);
});

test('group duplication refuses descendant locks, identifier collisions and resource overflow atomically', () => {
  let project = createProject({ width: 100, height: 100 });
  for (const id of ['a', 'b']) project = applyOperation(project, { type: 'add', layer: { id, type: 'rect', w: 10, h: 10 } });
  project = applyOperation(project, { type: 'group', ids: ['a', 'b'], id: 'g' });
  const locked = applyOperation(project, { type: 'update', id: 'a', patch: { locked: true } });
  assert.throws(() => applyOperation(locked, { type: 'duplicate', id: 'g', newId: 'copy' }), /Unlock/);
  const collision = applyOperation(project, { type: 'add', layer: { id: 'copy:1', type: 'rect' } });
  assert.throws(() => applyOperation(collision, { type: 'duplicate', id: 'g', newId: 'copy' }), /unique/);
  const longId = 'c'.repeat(100), longCopy = applyOperation(project, { type: 'duplicate', id: 'g', newId: longId });
  assert.ok(longCopy.layers.every(layer => layer.id.length <= 100));
  assert.equal(longCopy.layers.find(layer => layer.id === longId).children.length, 2);
  const capped = validateProject({ ...createProject({ width:100,height:100 }), version:3,
    layers: Array.from({length:16}, (_,i) => [
      {id:`a${i}`,type:'rect',w:10,h:10},{id:`b${i}`,type:'rect',w:10,h:10},
      {id:`g${i}`,type:'group',w:10,h:10,baseWidth:10,baseHeight:10,children:[`a${i}`,`b${i}`]}]).flat() });
  assert.throws(() => applyOperation(capped, { type:'duplicate',id:'g0',newId:'copy' }), /at most 16 groups/);
  while (project.layers.length < LIMITS.layers - 1) project = applyOperation(project, { type: 'add', layer: { id: `filler-${project.layers.length}`, type: 'rect' } });
  const before = serializeProject(project);
  assert.throws(() => applyOperation(project, { type: 'duplicate', id: 'g', newId: 'copy' }), /Too many layers/);
  assert.equal(serializeProject(project), before);
});


test('cubic vector geometry and styles survive private project serialization and reject malformed controls', () => {
  const shape = { id: 'curve', type: 'path', contours: [{ closed: true, nodes: [{ x: 0, y: 0, out: { x: .4, y: .3 } }, { x: 1, y: 1, in: { x: -.4, y: -.3 } }] }],
    cap: 'round', join: 'bevel', dash: [8, 4], gradient: { from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] } };
  const project = applyOperation(createProject(), { type: 'add', layer: shape });
  assert.equal(project.version, 3); assert.deepEqual(parseProject(serializeProject(project)), project);
  for (const patch of [{ cap: 'bad' }, { dash: [-1] }, { contours: [{ closed: true, nodes: [{ x: -1, y: 0 }, { x: 1, y: 1 }] }] }]) assert.throws(() => applyOperation(project, { type: 'update', id: 'curve', patch }));
});

test('path booleans keep hidden editable operands and commit their result as one independent snapshot', async () => {
  const { pathFromRings, combinePaths } = await import('../../tools/editor/vector-geometry.mjs');
  let project = createProject({ width: 100, height: 100 });
  for (const [id, points] of [['a', [[0, 0], [40, 0], [40, 40], [0, 40]]], ['b', [[20, 20], [60, 20], [60, 60], [20, 60]]]]) {
    project = applyOperation(project, { type: 'add', layer: { ...pathFromRings([points]), id } });
  }
  for (const operation of ['union', 'difference', 'intersection', 'xor']) {
    const result = combinePaths(project, ['a', 'b'], operation); result.id = 'result';
    const next = applyOperation(project, { type: 'booleanResult', ids: ['a', 'b'], result });
    assert.equal(next.layers.length, 3); assert.equal(next.layers[0].visible, false); assert.equal(project.layers[0].visible, true);
    assert.deepEqual(next.layers[2].sourceIds, ['a', 'b']); assert.deepEqual(parseProject(serializeProject(next)), next);
  }
  const aligned = applyOperation(project, { type: 'arrange', ids: ['a', 'b'], mode: 'left' });
  assert.equal(aligned.layers[0].x, aligned.layers[1].x); assert.equal(project.layers[1].x, 20);
});
