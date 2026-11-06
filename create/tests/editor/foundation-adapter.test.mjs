/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the real foundation adapter against Create validation/history, including stale drafts, group scaling and inherited locks.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, applyOperation } from '../../tools/editor/model.mjs';
import { state, openDocument } from '../../tools/editor/editor-state.mjs';
import { createLayerProperties, applyLayerProperty } from '../../tools/editor/editor-foundation-adapter.mjs';

globalThis.document = { getElementById: () => ({ textContent: '', hidden: true }) };
beforeEach(() => { state.foundation = null; state.loading = false; state.permissions = { create: true, change: true }; openDocument(createProject()); });
const context = () => ({ documentId: state.id ?? `draft:${state.documentSession}`, revision: state.revision, selection: { kind: 'layers', ids: [state.selected] } });
function add(type = 'rect') {
  const layer = { id: 'shape', type, name: 'Original', x: 20, y: 30, w: 100, h: 50, ...(type === 'text' ? { text: 'Original text' } : {}) };
  state.project = state.history.commit(applyOperation(state.project, { type: 'add', layer })); state.selected = 'shape';
}

test('shared properties use the validated edit/history path and expose supported appearance only', () => {
  add(); const expected = context();
  assert.equal(createLayerProperties().find(field => field.key === 'shadowEnabled').value, false);
  assert.equal(createLayerProperties().find(field => field.key === 'stroke').value, 'transparent');
  applyLayerProperty('opacity', 35, expected);
  assert.equal(state.project.layers[0].opacity, .35);
  assert.equal(state.history.undo().layers[0].opacity, 1);
  assert.throws(() => applyLayerProperty('id', 'replacement', expected), /cannot be changed/);
  assert.throws(() => applyLayerProperty('w', -20, expected), /out of range/);
  assert.equal(state.project.layers[0].w, 100);
});

test('two unsaved drafts have distinct identities and a stale property cannot edit the new document', () => {
  add(); const stale = context(); openDocument(createProject()); add();
  assert.notEqual(stale.documentId, context().documentId);
  assert.throws(() => applyLayerProperty('fill', '#ff0000', stale), /selected layer changed/);
  assert.equal(state.project.layers[0].fill, '#3b82f6');
});

test('group resize retains aspect ratio and inherited locks disable every child property', () => {
  add(); state.project = applyOperation(state.project, { type: 'add', layer: { id: 'second', type: 'rect', x: 140, y: 30, w: 100, h: 50 } });
  state.project = state.history.commit(applyOperation(state.project, { type: 'group', ids: ['shape', 'second'], id: 'group' }));
  state.selected = 'group'; const group = state.project.layers.find(layer => layer.id === 'group');
  applyLayerProperty('w', 440, context());
  const resized = state.project.layers.find(layer => layer.id === 'group');
  assert.equal(resized.h, 440 * group.baseHeight / group.baseWidth);
  state.project = applyOperation(state.project, { type: 'update', id: 'group', patch: { locked: true } }); state.selected = 'shape';
  assert.ok(createLayerProperties().every(field => field.disabled));
  assert.throws(() => applyLayerProperty('fill', '#ff0000', context()), /cannot be changed/);
});

test('changed selection and withdrawn edit authority refuse mutations without modifying text', () => {
  add('text'); const expected = context(); state.selected = null;
  assert.throws(() => applyLayerProperty('text', 'Wrong target', expected), /selected layer changed/);
  state.selected = 'shape'; state.permissions = {};
  assert.throws(() => applyLayerProperty('text', 'Refused', context()), /role does not allow/);
  assert.equal(state.project.layers[0].text, 'Original text');
});

test('document replacement discards fields only after a valid incoming document is fully prepared', () => {
  add(); const original = state.project, history = state.history; let discarded = 0;
  state.foundation = { discardPending() { discarded++; } };
  assert.throws(() => openDocument({ version: -1 }), /Unsupported/);
  assert.equal(discarded, 0); assert.equal(state.project, original); assert.equal(state.history, history);
  state.foundation.discardPending = () => { throw new Error('Property update still running'); };
  assert.throws(() => openDocument(createProject()), /still running/);
  assert.equal(state.project, original); assert.equal(state.history, history);
  state.foundation.discardPending = () => { discarded++; };
  openDocument(createProject()); assert.equal(discarded, 1); assert.equal(state.project.layers.length, 0); assert.equal(state.history.canUndo(), false);
});

test('native shape, outline and shadow controls edit real versioned properties with history',()=>{
 add();applyLayerProperty('shape','rounded-rectangle',context());applyLayerProperty('radius',18,context());applyLayerProperty('dash','8, 4',context());applyLayerProperty('shadowEnabled',true,context());applyLayerProperty('shadowX',10,context());
 assert.equal(state.project.version,4);assert.equal(state.project.layers[0].shape,'rounded-rectangle');assert.deepEqual(state.project.layers[0].dash,[8,4]);assert.equal(state.project.layers[0].shadow.offsetX,10);
 const before=state.project;assert.throws(()=>applyLayerProperty('dash','0, bad',context()),/range/);assert.equal(state.project,before);assert.throws(()=>applyLayerProperty('shadowBlur',65,context()),/range/);assert.equal(state.project,before);
 applyLayerProperty('shadowEnabled',false,context());assert.equal(state.project.layers[0].shadow,undefined);assert.equal(state.history.undo().layers[0].shadow.offsetX,10);
});
