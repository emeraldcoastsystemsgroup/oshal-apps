/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add pointer and keyboard transforms with one undo entry per completed gesture.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Keep modal browsing from applying editor shortcuts to the underlying canvas.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Region mode: drag a lasso, Shift-drag a box or click for the whole image; the gesture becomes a source-pixel selection of one image layer and never edits the document. Escape clears it.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Integrate version 3 brush and arithmetic masks plus editable stack/clipped color adjustments with existing project history.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Integrate isolated group layers with bounded nesting, uniform transforms, ancestor locks and source-space region mapping.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Integrate editable cubic vector paths, bounded worker booleans, arrangement and explicit SVG interchange with existing private project flows.
 */
import { $, state, canEdit, edit, notify, error, handle } from './editor-state.mjs';
import { parentGroup, worldLayer } from './group-geometry.mjs';
import { applyOperation } from './model.mjs';
import { hitTest } from './renderer.mjs';
import { paint, paintRegionDraft, selectedLayer } from './editor-view.mjs';
import { canvasToSource, clientToCanvas, targetImageLayer, selectionFromCanvas, selectionFromLayer } from './region-select.mjs';
let gesture = null;

function point(event) {
  return clientToCanvas({ x: event.clientX, y: event.clientY }, $('artboard').getBoundingClientRect(), state.project);
}

/** Start a region gesture on the one image layer it applies to; an ambiguous target is refused before any drawing. */
function beginRegion(event, at) {
  try {
    const layer = targetImageLayer(state.project, state.selected, at);
    state.selected = layer.id; error(''); notify();
    gesture = { pointer: event.pointerId, region: true, layerId: layer.id, box: event.shiftKey || $('regionShape').value === 'box', ellipse: !event.shiftKey && $('regionShape').value === 'ellipse', points: [at] };
    $('artboard').setPointerCapture(event.pointerId); $('artboard').focus(); event.preventDefault();
  } catch (failure) { error(failure.message); }
}

function ellipsePoints(first, last) {
  const center = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
  return Array.from({ length: 64 }, (_, index) => ({
    x: center.x + Math.abs(last.x - first.x) / 2 * Math.cos(index * Math.PI / 32),
    y: center.y + Math.abs(last.y - first.y) / 2 * Math.sin(index * Math.PI / 32) }));
}

function moveRegion(at) {
  const last = gesture.points.at(-1);
  if (Math.hypot(at.x - last.x, at.y - last.y) >= 2 && gesture.points.length < 20000) gesture.points.push(at);
  if (gesture.ellipse) { paint(); paintRegionDraft(ellipsePoints(gesture.points[0], at), false); return; }
  paint(); paintRegionDraft(gesture.box ? [gesture.points[0], at] : gesture.points, gesture.box);
}

/** A click (no real drag) selects the whole visible image; otherwise the lasso or box becomes the region. */
function finishRegion() {
  const xs = gesture.points.map(item => item.x), ys = gesture.points.map(item => item.y);
  const dragged = Math.max(...xs) - Math.min(...xs) >= 4 || Math.max(...ys) - Math.min(...ys) >= 4;
  const points = gesture.ellipse ? ellipsePoints(gesture.points[0], gesture.points.at(-1))
    : gesture.box ? [gesture.points[0], gesture.points.at(-1)] : gesture.points;
  state.region = !dragged ? selectionFromLayer(state.project, gesture.layerId)
    : selectionFromCanvas(state.project, gesture.layerId, points, { kind: gesture.box ? 'box' : 'lasso' });
  error(''); notify();
}
function rotate(x, y, radians) { return { x: x * Math.cos(radians) - y * Math.sin(radians), y: x * Math.sin(radians) + y * Math.cos(radians) }; }

function onHandle(layer, at) {
  if (!layer || layer.locked || !layer.visible) return false;
  const corner = rotate(layer.w / 2, layer.h / 2, layer.rotation * Math.PI / 180);
  const size = 14 * state.project.width / $('artboard').getBoundingClientRect().width;
  return Math.hypot(at.x - layer.x - layer.w / 2 - corner.x, at.y - layer.y - layer.h / 2 - corner.y) <= size;
}

function brushPoint(at) {
  const asset = gesture.original.images[gesture.layer.assetId], source = canvasToSource(gesture.layer, asset, at);
  return { x: Math.max(0, Math.min(asset.width, source.x)), y: Math.max(0, Math.min(asset.height, source.y)) };
}

function brushPatch() {
  const asset = gesture.original.images[gesture.layer.assetId];
  const mask = gesture.layer.mask ?? { enabled: true, inverted: false, feather: 0,
    points: [{ x: 0, y: 0 }, { x: asset.width, y: 0 }, { x: asset.width, y: asset.height }, { x: 0, y: asset.height }] };
  const mode = mask.inverted ? (gesture.brush === 'add' ? 'subtract' : 'add') : gesture.brush;
  return { mask: { ...mask, enabled: true, operations: [...(mask.operations ?? []),
    { kind: 'brush', mode, points: gesture.points, size: gesture.size, opacity: gesture.opacity }] } };
}

function beginBrush(event, at) {
  const selected = selectedLayer(), layer = selected ? worldLayer(state.project, selected) : null;
  if (!layer || layer.type !== 'image' || layer.locked || !layer.visible) { error('Select an unlocked, visible image to paint its mask.'); return; }
  gesture = { pointer: event.pointerId, original: state.project, layer, brush: state.maskBrush,
    size: Number($('maskBrushSize').value), opacity: Number($('maskBrushOpacity').value), points: [] };
  gesture.points.push(brushPoint(at));
  try { applyOperation(gesture.original, { type: 'update', id: layer.id, patch: brushPatch() }); }
  catch (failure) { gesture = null; error(failure.message); return; }
  $('artboard').setPointerCapture(event.pointerId); $('artboard').focus(); event.preventDefault();
}

function begin(event) {
  if (event.button !== 0 || gesture || !canEdit()) return;
  if (state.maskBrush) { beginBrush(event, point(event)); return; }
  if (state.regionMode) { beginRegion(event, point(event)); return; }
  const at = point(event), selected = selectedLayer();
  const resize = !parentGroup(state.project, selected?.id) && onHandle(selected, at);
  const layer = resize ? selected : hitTest(state.project, at, { tolerance: 5 });
  state.selected = state.draw ? null : layer?.id ?? null; notify();
  if (!state.draw && !layer) return;
  gesture = { pointer: event.pointerId, at, layer, resize, original: state.project, points: [at], patch: null };
  $('artboard').setPointerCapture(event.pointerId); $('artboard').focus(); event.preventDefault();
}

function resizePatch(layer, dx, dy) {
  const angle = layer.rotation * Math.PI / 180, local = rotate(dx, dy, -angle);
  const w = Math.min(32768, Math.max(1, layer.w + local.x)), h = layer.type === 'group' ? w * layer.baseHeight / layer.baseWidth : Math.min(32768, Math.max(1, layer.h + local.y));
  const delta = rotate((w - layer.w) / 2, (h - layer.h) / 2, angle);
  return { w, h, x: layer.x + delta.x - (w - layer.w) / 2, y: layer.y + delta.y - (h - layer.h) / 2 };
}

function strokeLayer() {
  const { width, height } = gesture.original;
  return { id: 'drawing-preview', type: 'freehand', name: 'Drawing', x: 0, y: 0, w: width, h: height,
    stroke: '#7c3aed', strokeWidth: 5, points: gesture.points.map(at => ({ x: Math.min(1, Math.max(0, at.x / width)), y: Math.min(1, Math.max(0, at.y / height)) })) };
}

function move(event) {
  if (!gesture || event.pointerId !== gesture.pointer) return;
  const at = point(event);
  try {
    if (gesture.brush) {
      if (gesture.points.length < 2000) gesture.points.push(brushPoint(at));
      gesture.patch = brushPatch(); paint(applyOperation(gesture.original, { type: 'update', id: gesture.layer.id, patch: gesture.patch })); return;
    }
    if (gesture.region) { moveRegion(at); return; }
    if (state.draw) {
      if (gesture.points.length < 10000) gesture.points.push(at);
      paint(applyOperation(gesture.original, { type: 'add', layer: strokeLayer() })); return;
    }
    const { layer } = gesture, dx = at.x - gesture.at.x, dy = at.y - gesture.at.y;
    gesture.patch = gesture.resize ? resizePatch(layer, dx, dy) : { x: layer.x + dx, y: layer.y + dy };
    if (!gesture.resize && $('snapGrid').checked) {
      const step = Number($('snapSpacing').value); if (Number.isFinite(step) && step >= 1 && step <= 100) { gesture.patch.x = Math.round(gesture.patch.x / step) * step; gesture.patch.y = Math.round(gesture.patch.y / step) * step; }
    }
    paint(applyOperation(gesture.original, { type: 'update', id: layer.id, patch: gesture.patch }));
  } catch (failure) { error(failure.message); }
}

function finish(event, cancelled = false) {
  if (!gesture || event.pointerId !== gesture.pointer) return;
  try {
    if (gesture.brush) { if (!cancelled) edit({ type: 'update', id: gesture.layer.id, patch: brushPatch() }); }
    else if (gesture.region) { if (!cancelled) finishRegion(); }
    else if (!cancelled && state.draw) edit({ type: 'add', layer: { ...strokeLayer(), id: crypto.randomUUID() } });
    else if (!cancelled && gesture.patch) edit({ type: 'update', id: gesture.layer.id, patch: gesture.patch });
  } catch (failure) { error(failure.message); }
  finally { gesture = null; paint(); }
}

function keyboard(event) {
  if (event.target.closest('input,textarea,select,[contenteditable]') || document.querySelector('dialog[open]') || !canEdit()) return;
  const key = event.key.toLowerCase(), modifier = event.ctrlKey || event.metaKey;
  if (key === 'escape' && (state.region || state.regionMode || state.maskBrush)) { event.preventDefault(); state.region = null; state.regionMode = false; state.maskBrush = ''; notify(); return; }
  if (modifier && ['z', 'y', 's'].includes(key)) {
    event.preventDefault(); if (key === 's') { $('saveProject').click(); return; }
    state.project = key === 'y' || event.shiftKey ? state.history.redo() : state.history.undo(); notify(); return;
  }
  const layer = selectedLayer(); if (!layer || layer.locked) return;
  if (['delete', 'backspace'].includes(key)) { event.preventDefault(); edit({ type: 'remove', id: layer.id }); }
  const delta = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[key];
  if (delta && layer.type !== 'adjustment') { event.preventDefault(); const step = event.shiftKey ? 10 : 1; edit({ type: 'update', id: layer.id, patch: { x: layer.x + delta[0] * step, y: layer.y + delta[1] * step } }); }
}

export function bindInteractions() {
  $('artboard').addEventListener('pointerdown', begin); $('artboard').addEventListener('pointermove', move);
  $('artboard').addEventListener('pointerup', event => finish(event));
  $('artboard').addEventListener('pointercancel', event => finish(event, true));
  $('artboard').addEventListener('lostpointercapture', event => finish(event, true));
  document.addEventListener('keydown', handle(keyboard));
}
