/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Render live editable layers, geometry and responsive canvas without replacing drafts.
 */
import { $, state, canEdit, dirty, edit, notify, error, status } from './editor-state.mjs';
import { renderProject, loadProjectImages } from './renderer.mjs';
let imageSignature = '', loadingImages = 0, imageAbort;
export const selectedLayer = () => state.project.layers.find(layer => layer.id === state.selected);

/** Fit the display without reducing export resolution or changing project coordinates. */
export function fitCanvas() {
  const viewport = $('canvasViewport'), { width, height } = state.project;
  const fit = Math.min((viewport.clientWidth - 60) / width, (viewport.clientHeight - 60) / height, 1);
  const scale = $('zoom').value === 'fit' ? Math.max(.01, fit) : Number($('zoom').value);
  $('canvasFrame').style.width = `${width * scale}px`; $('canvasFrame').style.height = `${height * scale}px`;
}

/** Paint only from validated state; selection handles never enter exported image pixels. */
export function paint(project = state.project) {
  const canvas = $('artboard'), overlay = $('selection');
  if (canvas.width !== project.width || canvas.height !== project.height) {
    canvas.width = overlay.width = project.width; canvas.height = overlay.height = project.height;
  }
  const preview = { ...project, layers: project.layers.filter(layer => layer.type !== 'image' || state.images.has(layer.assetId)) };
  renderProject(canvas.getContext('2d'), preview, { images: state.images });
  const ctx = overlay.getContext('2d'); ctx.clearRect(0, 0, overlay.width, overlay.height);
  const layer = project.layers.find(item => item.id === state.selected);
  if (!layer?.visible) return;
  const scale = canvas.getBoundingClientRect().width / project.width || 1, size = 8 / scale;
  ctx.save(); ctx.translate(layer.x + layer.w / 2, layer.y + layer.h / 2); ctx.rotate(layer.rotation * Math.PI / 180);
  ctx.strokeStyle = '#6d28d9'; ctx.fillStyle = '#ffffff'; ctx.lineWidth = 2 / scale;
  ctx.strokeRect(-layer.w / 2, -layer.h / 2, layer.w, layer.h);
  if (!layer.locked && canEdit()) { ctx.fillRect(layer.w / 2 - size / 2, layer.h / 2 - size / 2, size, size); ctx.strokeRect(layer.w / 2 - size / 2, layer.h / 2 - size / 2, size, size); }
  ctx.restore();
}

/** Cancel stale asset loads when a different project is opened. */
function refreshImages() {
  const signature = JSON.stringify(state.project.images);
  if (signature === imageSignature) return;
  imageSignature = signature; const generation = ++loadingImages;
  imageAbort?.abort(); imageAbort = new AbortController();
  loadProjectImages(state.project, { signal: imageAbort.signal }).then(images => {
    if (generation === loadingImages) { state.images = images; paint(); }
  }).catch(failure => { if (generation === loadingImages) error(failure.message); });
}

function button(label, title, run, disabled = false) {
  const node = document.createElement('button'); node.type = 'button'; node.textContent = label;
  node.title = title; node.setAttribute('aria-label', title); node.disabled = disabled;
  node.onclick = () => { try { run(); } catch (failure) { error(failure.message); } }; return node;
}

/** Show the topmost layer first, with independent visibility and lock controls. */
function renderLayers() {
  const list = $('layers'); list.replaceChildren(); $('layerCount').textContent = state.project.layers.length;
  for (const layer of [...state.project.layers].reverse()) {
    const row = document.createElement('div'); row.className = 'layer-row' + (state.selected === layer.id ? ' selected' : '');
    row.setAttribute('role', 'listitem'); row.dataset.layerId = layer.id;
    const select = button(layer.name, `Select ${layer.name}`, () => { state.selected = layer.id; notify(); });
    select.className = 'layer-select'; select.setAttribute('aria-pressed', String(state.selected === layer.id)); row.append(select);
    row.append(button(layer.visible ? '◉' : '○', `${layer.visible ? 'Hide' : 'Show'} ${layer.name}`, () => edit({ type: 'update', id: layer.id, patch: { visible: !layer.visible } }), !canEdit()));
    row.append(button(layer.locked ? '◆' : '◇', `${layer.locked ? 'Unlock' : 'Lock'} ${layer.name}`, () => edit({ type: 'update', id: layer.id, patch: { locked: !layer.locked } }), !canEdit())); list.append(row);
  }
  if (!list.children.length) { const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = 'Your layers will appear here.'; list.append(hint); }
}

function value(id, next) { if (document.activeElement !== $(id)) $(id).value = next; }

function renderProperties() {
  const layer = selectedLayer(); $('noSelection').hidden = Boolean(layer); $('propertyFields').hidden = !layer;
  $('properties').disabled = !canEdit() || !layer || layer.locked;
  for (const control of document.querySelectorAll('[data-selected]')) control.disabled = !canEdit() || !layer || layer.locked;
  if (!layer) return;
  for (const control of document.querySelectorAll('[data-property]')) {
    const next = layer[control.dataset.property];
    if (next !== undefined && document.activeElement !== control) control.value = control.type === 'color' && !/^#[a-f0-9]{6}$/i.test(next) ? '#000000' : next;
  }
  $('textProperties').hidden = layer.type !== 'text'; $('imageProperties').hidden = layer.type !== 'image';
  $('fillProperty').hidden = !['text', 'rect', 'ellipse'].includes(layer.type);
  $('strokeProperties').hidden = !['rect', 'ellipse', 'freehand'].includes(layer.type);
  if (layer.type === 'image') for (const [key, next] of Object.entries(layer.crop)) value(`crop${key.toUpperCase()}`, Math.round(next * 10000) / 100);
}

/** Preserve focused text fields while refreshing admission, selection and save state. */
export function render() {
  const editable = canEdit(), busy = state.loading || state.saving;
  for (const control of document.querySelectorAll('[data-edit]')) control.disabled = !editable;
  $('importProject').disabled = busy || !state.permissions.create;
  $('newProject').disabled = busy || !state.permissions.create; $('openProjects').disabled = busy || !state.permissions.read;
  $('saveProject').disabled = busy || !editable || state.conflict || !dirty(); $('saveCopy').disabled = busy || !state.permissions.create;
  $('projectName').disabled = !editable; $('canvasSettings').disabled = !editable;
  for (const id of ['exportPng', 'exportJpeg', 'exportJson']) $(id).disabled = busy || !state.permissions.export || !state.permissions.read || (!state.id && !editable);
  $('undo').disabled = !editable || !state.history.canUndo(); $('redo').disabled = !editable || !state.history.canRedo();
  $('drawMode').setAttribute('aria-pressed', String(state.draw)); value('projectName', state.project.name);
  value('canvasWidth', state.project.width); value('canvasHeight', state.project.height);
  value('canvasBackground', state.project.background === 'transparent' ? '#ffffff' : state.project.background);
  $('transparentBackground').checked = state.project.background === 'transparent';
  $('canvasDimensions').textContent = `${state.project.width} × ${state.project.height}`;
  $('selectionHint').textContent = state.draw ? 'Draw on the canvas. Select Draw again to move layers.' : 'Drag to move. Drag the corner to resize. Arrow keys nudge.';
  status(state.loading ? 'Loading…' : state.saving ? 'Saving…' : state.conflict ? 'Save conflict · autosave paused' : state.saveFailed ? 'Save failed · retry Save' : dirty() ? 'Unsaved changes' : `Saved · revision ${state.revision}`);
  renderLayers(); renderProperties(); fitCanvas(); paint(); refreshImages();
}
