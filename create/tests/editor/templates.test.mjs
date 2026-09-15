/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify all original designs stay editable through persistence, reject untrusted IDs and isolate projects from catalog mutation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, createTemplate } from '../../tools/editor/templates.mjs';
import { applyOperation, parseProject, serializeProject, validateProject, LIMITS } from '../../tools/editor/model.mjs';

const EXPECTED = [
  ['square-announcement', 1080, 1080], ['story-promo', 1080, 1920], ['presentation-title', 1920, 1080],
  ['video-thumbnail', 1280, 720], ['event-flyer', 1080, 1350], ['quote-card', 1080, 1080],
  ['product-card', 1080, 1080], ['profile-banner', 1500, 500],
];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

for (const [id, width, height] of EXPECTED) test(`${id} retains independent editable layers through portable and server JSON`, () => {
  const project = createTemplate(id), metadata = TEMPLATES.find(item => item.id === id);
  assert.equal(project.width, width); assert.equal(project.height, height); assert.equal(project.name, metadata.name);
  assert.deepEqual(project.images, {}); assert.ok(project.layers.length >= 7);
  assert.deepEqual(validateProject(project), project);
  for (const assetMode of ['portable', 'reference']) {
    const source = serializeProject(project, { assetMode });
    assert.ok(Buffer.byteLength(source) < LIMITS.referenceBytes);
    const loaded = parseProject(source, { assetMode }); assert.deepEqual(loaded, project);
    const text = loaded.layers.find(layer => layer.type === 'text');
    const edited = applyOperation(loaded, { type: 'update', id: text.id, patch: { text: 'My own headline', fill: '#13579b' } });
    assert.equal(edited.layers.find(layer => layer.id === text.id).text, 'My own headline');
    assert.equal(loaded.layers.find(layer => layer.id === text.id).text, text.text);
    const shape = loaded.layers.find(layer => layer.type === 'rect' || layer.type === 'ellipse');
    const moved = applyOperation(edited, { type: 'update', id: shape.id, patch: { x: shape.x + 10, fill: '#2468ac' } });
    assert.equal(moved.layers.find(layer => layer.id === shape.id).x, shape.x + 10);
    assert.equal(moved.layers.find(layer => layer.id === shape.id).fill, '#2468ac');
    assert.equal(project.layers.find(layer => layer.id === shape.id).x, shape.x);
  }
});

test('catalog publishes exactly eight immutable complete format descriptions', () => {
  assert.deepEqual(TEMPLATES.map(item => [item.id, item.width, item.height]), EXPECTED);
  assert.equal(new Set(TEMPLATES.map(item => item.name)).size, 8);
  assert.ok(Object.isFrozen(TEMPLATES));
  for (const item of TEMPLATES) {
    assert.deepEqual(Object.keys(item).sort(), ['category', 'description', 'height', 'id', 'name', 'width']);
    assert.ok(item.description.length > 30); assert.ok(item.category.length > 0); assert.ok(Object.isFrozen(item));
  }
  assert.throws(() => TEMPLATES.push({ id: 'injected' }), TypeError);
  assert.throws(() => { TEMPLATES[0].id = 'injected'; }, TypeError);
  assert.throws(() => { TEMPLATES[0].width = 1; }, TypeError);
  assert.equal(createTemplate('square-announcement').width, 1080);
});

test('untrusted IDs refuse without prototype lookup, trimming, decoding or string coercion', () => {
  let coerced = false;
  const hostile = { toString() { coerced = true; return 'square-announcement'; } };
  for (const value of [undefined, null, 0, false, [], hostile, Symbol('square-announcement'), new String('square-announcement'),
    '', '__proto__', 'constructor', 'toString', 'prototype', 'square-announcement ', 'SQUARE-ANNOUNCEMENT',
    '../square-announcement', '%73quare-announcement', 'square-announcement?project=other', 'x'.repeat(100000)]) {
    assert.throws(() => createTemplate(value), { name: 'TypeError', message: 'Choose an available image template' });
  }
  assert.equal(coerced, false); assert.equal({}.width, undefined);
});

test('every instantiation receives fresh UUIDs while keeping design content and layer order', () => {
  const ids = new Set();
  for (const metadata of TEMPLATES) {
    const first = createTemplate(metadata.id), second = createTemplate(metadata.id);
    assert.notStrictEqual(first, second); assert.notStrictEqual(first.layers, second.layers); assert.notStrictEqual(first.images, second.images);
    assert.deepEqual(first.layers.map(({ id, ...layer }) => layer), second.layers.map(({ id, ...layer }) => layer));
    for (const layer of [...first.layers, ...second.layers]) { assert.match(layer.id, UUID); assert.equal(ids.has(layer.id), false); ids.add(layer.id); }
  }
});

test('editing returned projects cannot change another project or future catalog instances', () => {
  const metadataBefore = JSON.stringify(TEMPLATES);
  for (const metadata of TEMPLATES) {
    const first = createTemplate(metadata.id), second = createTemplate(metadata.id), before = serializeProject(second);
    first.layers[0].name = 'Changed'; first.layers[0].x = 8000;
    first.layers.find(layer => layer.type === 'text').text = 'Changed';
    first.layers.pop(); first.images.injected = { src: 'not-an-asset' }; first.width = 1; first.name = 'Changed';
    assert.equal(serializeProject(second), before);
    const fresh = createTemplate(metadata.id);
    assert.deepEqual(fresh.layers.map(({ id, ...layer }) => layer), second.layers.map(({ id, ...layer }) => layer));
    assert.deepEqual(fresh.images, {}); assert.equal(fresh.width, metadata.width); assert.equal(fresh.name, metadata.name);
  }
  assert.equal(JSON.stringify(TEMPLATES), metadataBefore);
});

test('compositions use named unlocked visible native shapes and text entirely inside their canvas', () => {
  const backgrounds = new Set();
  for (const metadata of TEMPLATES) {
    const project = createTemplate(metadata.id); backgrounds.add(project.background);
    assert.equal(new Set(project.layers.map(layer => layer.name)).size, project.layers.length);
    for (const layer of project.layers) {
      assert.ok(['rect', 'ellipse', 'text'].includes(layer.type)); assert.ok(layer.name.length > 6);
      assert.equal(layer.locked, false); assert.equal(layer.visible, true); assert.equal(layer.opacity, 1);
      assert.equal(layer.rotation, 0); assert.ok(layer.x >= 0 && layer.y >= 0);
      assert.ok(layer.x + layer.w <= project.width); assert.ok(layer.y + layer.h <= project.height);
      if (layer.type === 'text') {
        assert.ok(layer.text.trim()); assert.ok(layer.fontSize >= 21);
        assert.ok(layer.h >= layer.text.split('\n').length * layer.fontSize * 1.2, `${metadata.id}: ${layer.name} line height`);
      }
    }
  }
  assert.equal(backgrounds.size, 8);
});
