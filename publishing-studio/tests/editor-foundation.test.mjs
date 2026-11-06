/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify the shared property adapter produces valid owned publishing edits without losing styled content or accepting out-of-page geometry.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {initial, apply} from '../routes/model.mjs';
import {publishingProperties, publishingPropertyOperation} from '../tools/editor-foundation-adapter.mjs';

test('geometry and fill properties produce native validated operations and preserve other objects', () => {
  const model = initial('Foundation proof', 1), page = model.pages[0];
  const item = {id: 'shape', kind: 'rect', x: 36, y: 36, width: 80, height: 40, color: [30, 40, 50]};
  page.objects.push(item);
  const operation = publishingPropertyOperation(model, page, item, 'x', 42);
  const next = apply(model, [operation]);
  assert.equal(next.pages[0].objects[0].x, 42);
  assert.deepEqual(next.pages[0].frames, model.pages[0].frames);
  assert.deepEqual(next.stories, model.stories);
  const fill = publishingPropertyOperation(model, page, item, 'color', '#56aacc');
  assert.deepEqual(apply(model, [fill]).pages[0].objects[0].color, [86, 170, 204]);
  for (const value of [NaN, Infinity, -10, 5000]) assert.throws(() => publishingPropertyOperation(model, page, item, 'x', value));
  assert.throws(() => publishingPropertyOperation(model, page, item, 'shadow', 20));
  assert.throws(() => publishingPropertyOperation(model, page, item, 'color', '#fff'));
});

test('simple text keeps its paragraph and character styles; complex runs stay in the owning tools', () => {
  const model = initial('Styles proof', 1), page = model.pages[0], frame = page.frames[0];
  model.stories[0].paragraphs[0].runs[0].style = 'header';
  const operation = publishingPropertyOperation(model, page, frame, 'text', 'A manual revision');
  const changed = apply(model, [operation]);
  assert.deepEqual(changed.stories[0].paragraphs, [{style: 'body', runs: [{text: 'A manual revision', style: 'header'}]}]);
  model.stories[0].paragraphs[0].runs.push({text: 'Second styled run', style: 'default'});
  assert.equal(publishingProperties(model, page, frame).some(property => property.key === 'text'), false);
  assert.throws(() => publishingPropertyOperation(model, page, frame, 'text', 'flattened'));
});

test('linked frame sizing remains constrained by the renderer contract', () => {
  const model = initial('Linked proof', 2), page = model.pages[0], frame = page.frames[0];
  const properties = publishingProperties(model, page, frame);
  assert.equal(properties.find(property => property.key === 'width').disabled, true);
  assert.equal(properties.find(property => property.key === 'height').disabled, true);
  assert.throws(() => publishingPropertyOperation(model, page, frame, 'width', 300));
  const operation = publishingPropertyOperation(model, page, frame, 'y', 70);
  assert.equal(apply(model, [operation]).pages[0].frames[0].y, 70);
});
