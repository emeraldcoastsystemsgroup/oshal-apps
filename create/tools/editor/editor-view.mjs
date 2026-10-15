/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Render live editable layers, geometry and responsive canvas without replacing drafts.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Show a filter slider at its neutral value when the selected layer omits that filter, so it never keeps the previous layer's value.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Outline the current region on the overlay (never in exported pixels), preview a region being drawn, and state in words whether the region is ready or must be reselected.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Full JSDoc tags on the region draft painter.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Reflect mask settings and gate controls on the selected editable image and a valid region.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Integrate version 3 brush and arithmetic masks plus editable stack/clipped color adjustments with existing project history.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Integrate isolated group layers with bounded nesting, uniform transforms, ancestor locks and source-space region mapping.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Integrate editable cubic vector paths, bounded worker booleans, arrangement and explicit SVG interchange with existing private project flows.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Enable validated group duplication through the existing human Duplicate control.
 */
import { $, state, canEdit, dirty, edit, notify, error, status } from './editor-state.mjs';
import { parentGroup, worldLayer } from './group-geometry.mjs';
import { renderProject, loadProjectImages } from './renderer.mjs';
import { resolveSelection, selectionSummary } from './region-select.mjs';
let imageSignature = '', loadingImages = 0, imageAbort;
export const selectedLayer = () => state.project.layers.find(layer => layer.id === state.selected);

/** Fit the display without reducing export resolution or changing project coordinates. */
export function fitCanvas() {
  const viewport = $('canvasViewport'), { width, height } = state.project;
  const fit = Math.min((viewport.clientWidth - 60) / width, (viewport.clientHeight - 60) / height, 1);
  const scale = $('zoom').value === 'fit' ? Math.max(.01, fit) : Number($('zoom').value);
  $('canvasFrame').style.width = `${width * scale}px`; $('canvasFrame').style.height = `${height * scale}px`;
}

function outline(ctx, points, closed) {
  const scale = $('artboard').getBoundingClientRect().width / state.project.width || 1;
  ctx.save(); ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  if (closed) { ctx.closePath(); ctx.fillStyle = 'rgba(124,58,237,0.18)'; ctx.fill('nonzero'); }
  ctx.setLineDash([6 / scale, 4 / scale]); ctx.lineWidth = 2 / scale; ctx.strokeStyle = '#6d28d9'; ctx.stroke(); ctx.restore();
}

/** @description Outline a region the person is still drawing on the overlay canvas only: the lasso path, or the dragged box.
 * @param {{x:number,y:number}[]} points Lasso points, or the two opposite box corners.
 * @param {boolean} box True when the gesture is a box.
 * @returns {void} */
export function paintRegionDraft(points, box) {
  const ctx = $('selection').getContext('2d');
  outline(ctx, box ? [points[0], { x: points[1].x, y: points[0].y }, points[1], { x: points[0].x, y: points[1].y }] : points, box);
}

function paintRegion(ctx, project) {
  if (!state.region) return;
  try { outline(ctx, resolveSelection(project, state.region).canvasPoints, true); } catch { /* A stale region is reported in words by render(); it is not drawn. */ }
}

/** Paint only from validated state; selection handles never enter exported image pixels. */
export function paint(project = state.project) {
  const canvas = $('artboard'), overlay = $('selection');
  if (canvas.width !== project.width || canvas.height !== project.height) {
    canvas.width = overlay.width = project.width; canvas.height = overlay.height = project.height;
  }
  let layers = project.layers.filter(layer => layer.type !== 'image' || state.images.has(layer.assetId));
  for (let pass = 0; pass < 6; pass++) {
    const present = new Set(layers.map(layer => layer.id));
    layers = layers.filter(layer => layer.type !== 'adjustment' || layer.scope !== 'layer' || present.has(layer.targetId));
    const ready = new Set(layers.map(layer => layer.id));
    layers = layers.map(layer => layer.type === 'group' ? { ...layer, children: layer.children.filter(id => ready.has(id)) } : layer)
      .filter(layer => layer.type !== 'group' || layer.children.length);
  }
  const preview = { ...project, layers };
  renderProject(canvas.getContext('2d'), preview, { images: state.images });
  const ctx = overlay.getContext('2d'); ctx.clearRect(0, 0, overlay.width, overlay.height); paintRegion(ctx, project);
  const selected = project.layers.find(item => item.id === state.selected);
  const layer = selected ? worldLayer(project, selected) : null;
  if (!layer?.visible || layer.type === 'adjustment') return;
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
    select.className = 'layer-select'; if (parentGroup(state.project, layer.id)) select.textContent = '↳ ' + layer.name; select.setAttribute('aria-pressed', String(state.selected === layer.id)); row.append(select);
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = state.arrangeIds.includes(layer.id);
    check.setAttribute('aria-label', `Arrange ${layer.name}`); check.onchange = () => { state.arrangeIds = check.checked ? [...state.arrangeIds, layer.id] : state.arrangeIds.filter(id => id !== layer.id); }; row.append(check);
    row.append(button(layer.visible ? '◉' : '○', `${layer.visible ? 'Hide' : 'Show'} ${layer.name}`, () => edit({ type: 'update', id: layer.id, patch: { visible: !layer.visible } }), !canEdit()));
    row.append(button(layer.locked ? '◆' : '◇', `${layer.locked ? 'Unlock' : 'Lock'} ${layer.name}`, () => edit({ type: 'update', id: layer.id, patch: { locked: !layer.locked } }), !canEdit())); list.append(row);
  }
  if (!list.children.length) { const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = 'Your layers will appear here.'; list.append(hint); }
}

function value(id, next) { if (document.activeElement !== $(id)) $(id).value = next; }

function renderMask(layer) {
  const mask = layer?.mask, editable = canEdit() && layer?.type === 'image' && !layer.locked;
  let regionReady = false;
  try { regionReady = resolveSelection(state.project, state.region).layer.id === layer?.id; } catch { /* No ready region. */ }
  $('maskFromRegion').disabled = !editable || !regionReady;
  $('combineMaskRegion').disabled = !editable || !regionReady || !mask;
  $('maskBrush').disabled = !editable; value('maskBrush', state.maskBrush || '');
  for (const id of ['invertMask', 'toggleMask', 'removeMask', 'maskFeather']) $(id).disabled = !editable || !mask;
  $('toggleMask').textContent = mask?.enabled ? 'Disable mask' : 'Enable mask';
  $('invertMask').setAttribute('aria-pressed', String(Boolean(mask?.inverted)));
  value('maskFeather', mask?.feather ?? 0);
  $('maskStatus').textContent = mask ? `${mask.enabled ? 'Enabled' : 'Disabled'} · ${mask.inverted ? 'outside' : 'inside'} region · ${mask.feather} source px feather · ${mask.operations?.length ?? 0} edits` : 'No mask. Select a region, then keep it with a mask.';
}

function renderAdjustment(layer) {
  $('adjustmentProperties').hidden = layer?.type !== 'adjustment';
  if (layer?.type !== 'adjustment') return;
  value('adjustmentScope', layer.scope);
  const parent = parentGroup(state.project, layer.id);
  const siblings = parent ? parent.children.map(id => state.project.layers.find(item => item.id === id)) : state.project.layers.filter(item => !parentGroup(state.project, item.id));
  const lower = siblings.slice(0, siblings.findIndex(item => item.id === layer.id)).filter(item => item.type !== 'adjustment');
  const target = $('adjustmentTarget'); target.replaceChildren(...lower.map(item => new Option(item.name, item.id)));
  target.value = layer.targetId ?? lower.at(-1)?.id ?? ''; target.disabled = !canEdit() || layer.locked;
  value('adjustmentCurve', layer.curve.map(point => `${point.x}:${point.y}`).join(', '));
}

function renderProperties() {
  renderMask(selectedLayer()); renderAdjustment(selectedLayer());
  const rawLayer = selectedLayer(), layer = rawLayer ? { ...rawLayer, locked: worldLayer(state.project, rawLayer).locked } : null; $('noSelection').hidden = Boolean(layer); $('propertyFields').hidden = !layer;
  $('properties').disabled = !canEdit() || !layer || layer.locked;
  for (const control of document.querySelectorAll('[data-selected]')) control.disabled = !canEdit() || !layer || layer.locked;
  $('ungroupLayer').disabled = !canEdit() || layer?.type !== 'group' || layer.locked;
  $('duplicateLayer').disabled = !canEdit() || !layer || layer.locked;
  if (!layer) return;
  for (const control of document.querySelectorAll('[data-property]')) {
    const neutral = control.dataset.neutral === undefined ? undefined : Number(control.dataset.neutral);
    const next = layer[control.dataset.property] ?? neutral;
    if (['x', 'y', 'w', 'h', 'rotation'].includes(control.dataset.property)) control.closest('label').hidden = layer.type === 'adjustment';
    if (next !== undefined && document.activeElement !== control) control.value = control.type === 'color' && !/^#[a-f0-9]{6}$/i.test(next) ? '#000000' : next;
  }
  $('textProperties').hidden = layer.type !== 'text'; $('imageProperties').hidden = layer.type !== 'image';
  $('fillProperty').hidden = !['text', 'rect', 'ellipse', 'path'].includes(layer.type);
  $('strokeProperties').hidden = !['rect', 'ellipse', 'freehand', 'path'].includes(layer.type);
  if (layer.type === 'image') for (const [key, next] of Object.entries(layer.crop)) value(`crop${key.toUpperCase()}`, Math.round(next * 10000) / 100);
}

/** Preserve focused text fields while refreshing admission, selection and save state. */
export function render() {
  const editable = canEdit(), busy = state.loading || state.saving;
  for (const control of document.querySelectorAll('[data-edit]')) control.disabled = !editable;
  $('importVectorSvg').disabled = busy || !state.permissions.create;
  $('importProject').disabled = busy || !state.permissions.create;
  $('newProject').disabled = busy || !state.permissions.create; $('openProjects').disabled = busy || !state.permissions.read;
  $('saveProject').disabled = busy || !editable || state.conflict || !dirty(); $('saveCopy').disabled = busy || !state.permissions.create;
  $('projectName').disabled = !editable; $('canvasSettings').disabled = !editable;
  for (const id of ['exportPng', 'exportJpeg', 'exportJson', 'exportSvg']) $(id).disabled = busy || !state.permissions.export || !state.permissions.read || (!state.id && !editable);
  $('undo').disabled = !editable || !state.history.canUndo(); $('redo').disabled = !editable || !state.history.canRedo();
  $('drawMode').setAttribute('aria-pressed', String(state.draw)); value('projectName', state.project.name);
  value('canvasWidth', state.project.width); value('canvasHeight', state.project.height);
  value('canvasBackground', state.project.background === 'transparent' ? '#ffffff' : state.project.background);
  $('transparentBackground').checked = state.project.background === 'transparent';
  $('canvasDimensions').textContent = `${state.project.width} × ${state.project.height}`;
  $('selectionHint').textContent = state.draw ? 'Draw on the canvas. Select Draw again to move layers.' : 'Drag to move. Drag the corner to resize. Arrow keys nudge.';
  status(state.loading ? 'Loading…' : state.saving ? 'Saving…' : state.conflict ? 'Save conflict · autosave paused' : state.saveFailed ? 'Save failed · retry Save' : dirty() ? 'Unsaved changes' : `Saved · revision ${state.revision}`);
  renderRegion(); renderLayers(); renderProperties(); fitCanvas(); paint(); refreshImages();
}

/** Region controls and a plain-words status: ready with its size, or why it must be selected again. */
function renderRegion() {
  const editable = canEdit(), selected = selectedLayer();
  $('regionMode').disabled = !editable; $('regionMode').setAttribute('aria-pressed', String(state.regionMode));
  $('selectWholeImage').disabled = !editable || selected?.type !== 'image'; $('clearRegion').disabled = !state.region;
  if (!state.region) { $('regionStatus').textContent = state.regionMode ? 'Region mode: drag a lasso, Shift-drag a box, or click an image for all of it.' : ''; return; }
  try {
    const { layer } = resolveSelection(state.project, state.region), summary = selectionSummary(state.region);
    $('regionStatus').textContent = `Region: ${summary.width} × ${summary.height} source pixels of ${layer.name}. Esc clears it.`;
  } catch (failure) { $('regionStatus').textContent = `Region needs reselecting: ${failure.message}`; }
}
