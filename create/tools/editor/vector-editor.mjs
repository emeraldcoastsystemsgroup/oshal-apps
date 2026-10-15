/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Bind cubic pen/node controls, stroke/gradient/clip properties and cancellable worker booleans to private Create projects.
 */
import { $, state, canEdit, edit, notify, handle, error, subscribe } from './editor-state.mjs';
import { clientToCanvas } from './region-select.mjs';
import { serializeProject } from './model.mjs';
import { parentGroup } from './group-geometry.mjs';
import { paint, selectedLayer } from './editor-view.mjs';
let gesture = null, running = false, cancelBoolean;
const selected = () => selectedLayer()?.type === 'path' ? selectedLayer() : null;
const update = patch => { const layer = selected(); if (layer) edit({ type: 'update', id: layer.id, patch }); };

function coordinates(event) {
  return clientToCanvas({ x: event.clientX, y: event.clientY }, $('artboard').getBoundingClientRect(), state.project);
}

function penEvent(event) {
  if (!state.vectorMode || !canEdit()) return;
  event.stopImmediatePropagation(); event.preventDefault();
  const at = coordinates(event);
  if (event.type === 'pointerdown') {
    if (event.button !== 0 || gesture) return;
    if (state.vectorDraft.length >= 2000) { error('Finish this path before adding more nodes.'); return; }
    gesture = { pointer: event.pointerId, at, last: at };
    $('artboard').setPointerCapture(event.pointerId); $('artboard').focus();
  } else if (gesture && gesture.pointer === event.pointerId) {
    if (event.type === 'pointermove') { gesture.last = at; return; }
    if (event.type === 'pointerup') {
      const out = { x: (at.x - gesture.at.x) / state.project.width, y: (at.y - gesture.at.y) / state.project.height };
      state.vectorDraft.push({ x: gesture.at.x / state.project.width, y: gesture.at.y / state.project.height,
        out, in: { x: -out.x, y: -out.y } });
    }
    gesture = null; notify();
  }
}

function finishPen() {
  if (state.vectorDraft.length < 2) throw new Error('Place at least two vector nodes.');
  const id = crypto.randomUUID(); edit({ type: 'add', layer: { id, type: 'path', name: 'Vector path',
    x: 0, y: 0, w: state.project.width, h: state.project.height, fill: '#7c3aed', stroke: '#111827', strokeWidth: 2,
    contours: [{ closed: $('vectorClosed').checked, nodes: state.vectorDraft }] } });
  state.vectorMode = false; state.vectorDraft = []; state.selected = id; notify();
}

function nodeEdit(transform) {
  const layer = selected(); if (!layer) return;
  const contour = Number($('vectorContour').value), index = Number($('vectorNode').value), contours = structuredClone(layer.contours);
  if (!contours[contour]?.nodes[index]) throw new Error('Select a vector node.');
  transform(contours[contour], index, layer); update({ contours });
}

function bindNodeControls() {
  for (const id of ['vectorContour', 'vectorNode']) $(id).onchange = () => renderVector();
  $('applyVectorNode').onclick = handle(() => nodeEdit((contour, index, layer) => {
    contour.nodes[index] = { x: Number($('vectorNodeX').value) / layer.w, y: Number($('vectorNodeY').value) / layer.h,
      in: { x: Number($('vectorInX').value) / layer.w, y: Number($('vectorInY').value) / layer.h },
      out: { x: Number($('vectorOutX').value) / layer.w, y: Number($('vectorOutY').value) / layer.h } };
  }));
  $('cornerVectorNode').onclick = handle(() => nodeEdit((contour, index) => { contour.nodes[index].in = { x: 0, y: 0 }; contour.nodes[index].out = { x: 0, y: 0 }; }));
  $('smoothVectorNode').onclick = handle(() => nodeEdit((contour, index) => {
    const before = contour.nodes[(index + contour.nodes.length - 1) % contour.nodes.length], after = contour.nodes[(index + 1) % contour.nodes.length];
    const node = contour.nodes[index], dx = (after.x - before.x) / 6, dy = (after.y - before.y) / 6;
    node.in = { x: -dx, y: -dy }; node.out = { x: dx, y: dy };
  }));
  $('insertVectorNode').onclick = handle(() => nodeEdit((contour, index) => {
    if (!contour.closed && index === contour.nodes.length - 1) throw new Error('Select a node before the last segment to insert.');
    const a = contour.nodes[index], b = contour.nodes[(index + 1) % contour.nodes.length];
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const c = { x: a.x + a.out.x, y: a.y + a.out.y }, d = { x: b.x + b.in.x, y: b.y + b.in.y };
    const ac = mid(a, c), cd = mid(c, d), db = mid(d, b), first = mid(ac, cd), last = mid(cd, db), center = mid(first, last);
    a.out = { x: ac.x - a.x, y: ac.y - a.y }; b.in = { x: db.x - b.x, y: db.y - b.y };
    contour.nodes.splice(index + 1, 0, { ...center, in: { x: first.x - center.x, y: first.y - center.y }, out: { x: last.x - center.x, y: last.y - center.y } });
  }));
  $('deleteVectorNode').onclick = handle(() => nodeEdit((contour, index) => {
    if (contour.nodes.length <= 2) throw new Error('Keep at least two vector nodes.'); contour.nodes.splice(index, 1);
  }));
}

function workerBoolean(project, ids, operation) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./vector-worker.mjs', import.meta.url), { type: 'module' });
    let finished = false;
    const finish = (failure, result) => { if (finished) return; finished = true; clearTimeout(timer); worker.terminate(); cancelBoolean = null; failure ? reject(failure) : resolve(result); };
    cancelBoolean = () => finish(new Error('Path combination canceled.'));
    const timer = setTimeout(() => finish(new Error('Path combination exceeded five seconds. Simplify the paths and retry.')), 5000);
    worker.onerror = () => finish(new Error('The vector worker could not run.'));
    worker.onmessage = event => finish(event.data.error ? new Error(event.data.error) : null, event.data.result);
    worker.postMessage({ project, ids, operation });
  });
}

async function booleanEdit() {
  if (running) return; const layer = selected(), other = $('vectorOperand').value;
  if (!layer || !other) throw new Error('Select two root vector paths.');
  const project = state.project, revision = serializeProject(project), ids = [layer.id, other]; running = true; renderVector();
  try {
    const result = await workerBoolean(project, ids, $('vectorBoolean').value);
    if (!canEdit() || serializeProject(state.project) !== revision) throw new Error('The project changed. Retry the path combination.');
    result.id = crypto.randomUUID(); edit({ type: 'booleanResult', ids, result }); state.selected = result.id; notify();
  } finally { running = false; renderVector(); }
}

/** @description Refresh bounded vector controls without overwriting focused node fields.
 * @returns {void} */
export function renderVector() {
  $('cancelVectorBoolean').disabled = !running;
  $('vectorPen').setAttribute('aria-pressed', String(state.vectorMode));
  $('finishVector').disabled = !canEdit() || state.vectorDraft.length < 2;
  $('vectorDraftStatus').textContent = state.vectorMode ? `${state.vectorDraft.length} nodes. Click for corners; drag for handles; Finish creates the path.` : '';
  const layer = selected(); $('vectorProperties').hidden = !layer; if (!layer) return;
  const contourIndex = Math.min(Number($('vectorContour').value) || 0, layer.contours.length - 1);
  const nodeIndex = Math.min(Number($('vectorNode').value) || 0, layer.contours[contourIndex].nodes.length - 1);
  $('vectorContour').replaceChildren(...layer.contours.map((_, index) => new Option(`Contour ${index + 1}`, index))); $('vectorContour').value = contourIndex;
  $('vectorNode').replaceChildren(...layer.contours[contourIndex].nodes.map((_, index) => new Option(`Node ${index + 1}`, index))); $('vectorNode').value = nodeIndex;
  const node = layer.contours[contourIndex].nodes[nodeIndex];
  for (const [id, value] of Object.entries({ vectorNodeX: node.x * layer.w, vectorNodeY: node.y * layer.h,
    vectorInX: node.in.x * layer.w, vectorInY: node.in.y * layer.h, vectorOutX: node.out.x * layer.w, vectorOutY: node.out.y * layer.h })) {
    if (document.activeElement !== $(id)) $(id).value = Math.round(value * 1000) / 1000;
  }
  if (document.activeElement !== $('vectorDash')) $('vectorDash').value = layer.dash.join(',');
  const oldOperand = $('vectorOperand').value;
  $('vectorOperand').replaceChildren(new Option('Choose another path', ''), ...state.project.layers.filter(item => item.type === 'path' && item.id !== layer.id && item.visible && !item.locked && !parentGroup(state.project, item.id)).map(item => new Option(item.name, item.id)));
  $('vectorOperand').value = oldOperand; $('applyVectorBoolean').disabled = running || !canEdit() || layer.locked || !!parentGroup(state.project, layer.id);
}

/** @description Install pen gestures and vector properties through the existing editor state/history.
 * @returns {void} */
export function bindVectors() {
  $('vectorPen').onclick = () => { state.vectorMode = !state.vectorMode; if (state.vectorMode) { state.draw = false; state.regionMode = false; state.maskBrush = ''; } notify(); };
  $('finishVector').onclick = handle(finishPen); $('cancelVector').onclick = () => { state.vectorMode = false; state.vectorDraft = []; gesture = null; notify(); };
  for (const event of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) $('artboard').addEventListener(event, penEvent);
  $('arrangeLayers').onclick = handle(() => edit({ type: 'arrange', ids: state.arrangeIds, mode: $('arrangeMode').value }));
  bindNodeControls(); $('applyVectorBoolean').onclick = handle(booleanEdit); $('cancelVectorBoolean').onclick = () => cancelBoolean?.();
  $('applyVectorDash').onclick = handle(() => update({ dash: $('vectorDash').value.trim() ? $('vectorDash').value.split(',').map(Number) : [] }));
  $('applyVectorGradient').onclick = handle(() => update({ gradient: { from: { x: 0, y: 0 }, to: { x: 1, y: 0 },
    stops: [{ offset: 0, color: $('gradientStart').value }, { offset: 1, color: $('gradientEnd').value }] } }));
  $('removeVectorGradient').onclick = handle(() => update({ gradient: null }));
  $('applyVectorClip').onclick = handle(() => update({ clip: [{ x: Number($('clipLeft').value), y: Number($('clipTop').value) },
    { x: Number($('clipRight').value), y: Number($('clipTop').value) }, { x: Number($('clipRight').value), y: Number($('clipBottom').value) },
    { x: Number($('clipLeft').value), y: Number($('clipBottom').value) }] }));
  $('removeVectorClip').onclick = handle(() => update({ clip: null }));
  subscribe(renderVector); subscribe(() => {
    if (!state.vectorDraft.length) return; const ctx = $('selection').getContext('2d'); ctx.beginPath();
    state.vectorDraft.forEach((node, index) => index ? ctx.lineTo(node.x * state.project.width, node.y * state.project.height) : ctx.moveTo(node.x * state.project.width, node.y * state.project.height));
    ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 2; ctx.stroke();
  });
}
