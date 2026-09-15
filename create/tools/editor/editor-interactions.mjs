/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add pointer and keyboard transforms with one undo entry per completed gesture.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Keep modal browsing from applying editor shortcuts to the underlying canvas.
 */
import { $, state, canEdit, edit, notify, error, handle } from './editor-state.mjs';
import { applyOperation } from './model.mjs';
import { hitTest } from './renderer.mjs';
import { paint, selectedLayer } from './editor-view.mjs';
let gesture = null;

function point(event) {
  const rect = $('artboard').getBoundingClientRect();
  return { x: (event.clientX - rect.left) * state.project.width / rect.width, y: (event.clientY - rect.top) * state.project.height / rect.height };
}
function rotate(x, y, radians) { return { x: x * Math.cos(radians) - y * Math.sin(radians), y: x * Math.sin(radians) + y * Math.cos(radians) }; }

function onHandle(layer, at) {
  if (!layer || layer.locked || !layer.visible) return false;
  const corner = rotate(layer.w / 2, layer.h / 2, layer.rotation * Math.PI / 180);
  const size = 14 * state.project.width / $('artboard').getBoundingClientRect().width;
  return Math.hypot(at.x - layer.x - layer.w / 2 - corner.x, at.y - layer.y - layer.h / 2 - corner.y) <= size;
}

function begin(event) {
  if (event.button !== 0 || gesture || !canEdit()) return;
  const at = point(event), selected = selectedLayer(), resize = onHandle(selected, at);
  const layer = resize ? selected : hitTest(state.project, at, { tolerance: 5 });
  state.selected = state.draw ? null : layer?.id ?? null; notify();
  if (!state.draw && !layer) return;
  gesture = { pointer: event.pointerId, at, layer, resize, original: state.project, points: [at], patch: null };
  $('artboard').setPointerCapture(event.pointerId); $('artboard').focus(); event.preventDefault();
}

function resizePatch(layer, dx, dy) {
  const angle = layer.rotation * Math.PI / 180, local = rotate(dx, dy, -angle);
  const w = Math.min(32768, Math.max(1, layer.w + local.x)), h = Math.min(32768, Math.max(1, layer.h + local.y));
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
    if (state.draw) {
      if (gesture.points.length < 10000) gesture.points.push(at);
      paint(applyOperation(gesture.original, { type: 'add', layer: strokeLayer() })); return;
    }
    const { layer } = gesture, dx = at.x - gesture.at.x, dy = at.y - gesture.at.y;
    gesture.patch = gesture.resize ? resizePatch(layer, dx, dy) : { x: layer.x + dx, y: layer.y + dy };
    paint(applyOperation(gesture.original, { type: 'update', id: layer.id, patch: gesture.patch }));
  } catch (failure) { error(failure.message); }
}

function finish(event, cancelled = false) {
  if (!gesture || event.pointerId !== gesture.pointer) return;
  try {
    if (!cancelled && state.draw) edit({ type: 'add', layer: { ...strokeLayer(), id: crypto.randomUUID() } });
    else if (!cancelled && gesture.patch) edit({ type: 'update', id: gesture.layer.id, patch: gesture.patch });
  } catch (failure) { error(failure.message); }
  finally { gesture = null; paint(); }
}

function keyboard(event) {
  if (event.target.closest('input,textarea,select,[contenteditable]') || document.querySelector('dialog[open]') || !canEdit()) return;
  const key = event.key.toLowerCase(), modifier = event.ctrlKey || event.metaKey;
  if (modifier && ['z', 'y', 's'].includes(key)) {
    event.preventDefault(); if (key === 's') { $('saveProject').click(); return; }
    state.project = key === 'y' || event.shiftKey ? state.history.redo() : state.history.undo(); notify(); return;
  }
  const layer = selectedLayer(); if (!layer || layer.locked) return;
  if (['delete', 'backspace'].includes(key)) { event.preventDefault(); edit({ type: 'remove', id: layer.id }); }
  const delta = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[key];
  if (delta) { event.preventDefault(); const step = event.shiftKey ? 10 : 1; edit({ type: 'update', id: layer.id, patch: { x: layer.x + delta[0] * step, y: layer.y + delta[1] * step } }); }
}

export function bindInteractions() {
  $('artboard').addEventListener('pointerdown', begin); $('artboard').addEventListener('pointermove', move);
  $('artboard').addEventListener('pointerup', event => finish(event));
  $('artboard').addEventListener('pointercancel', event => finish(event, true));
  $('artboard').addEventListener('lostpointercapture', event => finish(event, true));
  document.addEventListener('keydown', handle(keyboard));
}
