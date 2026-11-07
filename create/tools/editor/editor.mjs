/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Assemble the real Create image editor from bounded model, renderer and owned-project modules.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Admit editable template browsing after current access resolves and preserve saved project links.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Publish bounded read-only selected-layer context with the shared bridge while preserving manual editing when it is unavailable.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Read the brand kit beside permissions and settle it before template deep links, so designs open in the brand.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Offer the named image filter looks from the model; choosing one is a single undoable edit of the selected image layer.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Bind region mode (exclusive with drawing), whole-image selection for keyboard users and Clear region.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Bind the Change a region panel and ask which image service would answer once permissions are known.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Bind region-to-mask, invert, enable, remove and source-pixel feather controls to ordinary undoable edits.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Integrate version 3 brush and arithmetic masks plus editable stack/clipped color adjustments with existing project history.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Integrate isolated group layers with bounded nesting, uniform transforms, ancestor locks and source-space region mapping.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | Integrate editable cubic vector paths, bounded worker booleans, arrangement and explicit SVG interchange with existing private project flows.
 * 12 | maintainer@emeraldcoastsystemsgroup.com | Bind the automatic save-before-reading and refresh-on-return document handoff for Concierge and Jarvis.
 * 13 | maintainer@emeraldcoastsystemsgroup.com | Bind the Generate an image panel.
 * 14 | maintainer@emeraldcoastsystemsgroup.com | Mount the shared editor shell while preserving existing domain controls and AI handoff.
 * 15 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (create--create-editor): a new text, rectangle or ellipse layer lands 16 px down and right of the layer above it instead of on top of it at (180, 160); canvas size and background are edited in the shared Format inspector when nothing is selected (Canvas settings is gone from the tool rail); the app row's menus (the document menu and Export close after a choice, on Escape and on a press outside them; Export… opens Export, a sheet on a phone; the phone's one primary Add opens the Insert tools as a sheet while a desktop keeps them open as the tool rail) are bound here, without a new served module.
 */
import { $, state, edit, notify, subscribe, handle, api, error, openDocument } from './editor-state.mjs';
import { render, fitCanvas, paint } from './editor-view.mjs';
import { bindProjects, queueAutosave } from './editor-projects.mjs';
import { bindFiles, acceptIncomingArtifact } from './editor-files.mjs';
import { bindInteractions } from './editor-interactions.mjs';
import { bindTemplates, acceptIncomingTemplate } from './editor-templates.mjs';
import { bindEditorContext } from './editor-context.mjs';
import { bindEditorHandoff } from './editor-handoff.mjs';
import { bindEditorFoundation } from './editor-foundation-adapter.mjs';
import { bindBrand, loadBrand } from './brand-editor.mjs';
import { bindVectors } from './vector-editor.mjs';
import { parentGroup } from './group-geometry.mjs';
import { IMAGE_FILTER_LOOKS } from './model.mjs';
import { resolveSelection, selectionFromLayer } from './region-select.mjs';
import { bindRegionEditPanel, loadRegionProvider } from './region-edit-panel.mjs';
import { bindGenerateImagePanel } from './generate-image-panel.mjs';

/**
 * @description Where a new layer goes: the usual spot on an empty canvas, else 16 px down and right of the layer above,
 * kept on the canvas, so two new layers never stack exactly on top of each other.
 * @param {number} w New layer width.
 * @param {number} h New layer height.
 * @returns {{x:number,y:number}} Canvas position.
 */
export function nextLayerPosition(w, h) {
  const { width, height, layers } = state.project, last = [...layers].reverse().find(layer => layer.type !== 'adjustment' && layer.visible !== false);
  if (!last) return { x: width * .15, y: height * .2 };
  const clamp = (value, size, room) => Math.max(0, Math.min(value, room - size));
  return { x: clamp(last.x + 16, w, width), y: clamp(last.y + 16, h, height) };
}

function addLayer(type) {
  const w = state.project.width * .5, h = state.project.height * .25;
  const layer = { id: crypto.randomUUID(), type, name: type === 'text' ? 'Your title' : type === 'rect' ? 'Rectangle' : 'Ellipse',
    ...nextLayerPosition(w, h), w, h,
    ...(type === 'text' ? { text: 'Your title', fontSize: 64, fontWeight: 700 } : { fill: '#7c3aed' }) };
  edit({ type: 'add', layer }); state.selected = layer.id; notify();
}

function changeSelected(patch) {
  const layer = state.project.layers.find(item => item.id === state.selected);
  if (layer?.type === 'group') {
    if (patch.w !== undefined) patch.h = patch.w * layer.baseHeight / layer.baseWidth;
    else if (patch.h !== undefined) patch.w = patch.h * layer.baseWidth / layer.baseHeight;
  }
  if (state.selected) edit({ type: 'update', id: state.selected, patch });
}

function bindProperties() {
  for (const control of document.querySelectorAll('[data-property]')) control.onchange = handle(() => {
    const numeric = ['number', 'range'].includes(control.type) || control.id === 'fontWeight';
    changeSelected({ [control.dataset.property]: numeric ? Number(control.value) : control.value });
  });
  $('applyCrop').onclick = handle(() => changeSelected({ crop: Object.fromEntries(['x', 'y', 'w', 'h'].map(key => [key, Number($(`crop${key.toUpperCase()}`).value) / 100])) }));
  $('resetCrop').onclick = handle(() => changeSelected({ crop: { x: 0, y: 0, w: 1, h: 1 } }));
  for (const [id, look] of Object.entries(IMAGE_FILTER_LOOKS)) $('filterLook').append(new Option(look.label, id));
  $('filterLook').onchange = handle(() => {
    const id = $('filterLook').value; $('filterLook').value = '';
    if (Object.hasOwn(IMAGE_FILTER_LOOKS, id)) changeSelected({ ...IMAGE_FILTER_LOOKS[id].patch });
  });
  $('projectName').onchange = handle(() => edit({ type: 'project', patch: { name: $('projectName').value || 'Untitled image' } }));
}

function reorder(direction) {
  const index = state.project.layers.findIndex(layer => layer.id === state.selected);
  if (index < 0) return;
  edit({ type: 'reorder', id: state.selected, index: Math.max(0, Math.min(state.project.layers.length - 1, index + direction)) });
}

function bindMasks() {
  const selected = () => state.project.layers.find(layer => layer.id === state.selected);
  $('maskFromRegion').onclick = handle(() => {
    const { layer } = resolveSelection(state.project, state.region);
    if (layer.id !== state.selected) throw new Error('Select the image that owns this region first.');
    changeSelected({ mask: { points: state.region.points, enabled: true, inverted: false, feather: 0 } });
  });
  $('combineMaskRegion').onclick = handle(() => {
    const { layer, selection } = resolveSelection(state.project, state.region);
    if (layer.id !== state.selected || !layer.mask) throw new Error('Select the masked image and a region first.');
    const operation = { kind: 'polygon', mode: $('maskCombine').value, points: selection.points };
    changeSelected({ mask: { ...layer.mask, operations: [...(layer.mask.operations ?? []), operation] } });
  });
  $('maskBrush').onchange = () => {
    state.maskBrush = $('maskBrush').value;
    if (state.maskBrush) { state.draw = false; state.regionMode = false; }
    notify();
  };
  $('invertMask').onclick = handle(() => { const mask = selected()?.mask; if (mask) changeSelected({ mask: { ...mask, inverted: !mask.inverted } }); });
  $('toggleMask').onclick = handle(() => { const mask = selected()?.mask; if (mask) changeSelected({ mask: { ...mask, enabled: !mask.enabled } }); });
  $('removeMask').onclick = handle(() => changeSelected({ mask: null }));
  $('maskFeather').onchange = handle(() => { const mask = selected()?.mask; if (mask) changeSelected({ mask: { ...mask, feather: Number($('maskFeather').value) } }); });
}

function bindAdjustments() {
  $('addAdjustment').onclick = handle(() => {
    const id = crypto.randomUUID(); edit({ type: 'add', layer: { id, type: 'adjustment', name: 'Adjustment',
      x: 0, y: 0, w: state.project.width, h: state.project.height } }); state.selected = id; notify();
  });
  $('adjustmentScope').onchange = handle(() => changeSelected({ scope: $('adjustmentScope').value,
    ...($('adjustmentScope').value === 'layer' ? { targetId: $('adjustmentTarget').value } : { targetId: undefined }) }));
  $('adjustmentTarget').onchange = handle(() => { if ($('adjustmentScope').value === 'layer') changeSelected({ targetId: $('adjustmentTarget').value }); });
  $('applyAdjustmentCurve').onclick = handle(() => {
    const curve = $('adjustmentCurve').value.split(',').map(pair => {
      const values = pair.trim().split(':'); if (values.length !== 2) throw new Error('Use input:output pairs separated by commas.');
      return { x: Number(values[0]), y: Number(values[1]) };
    }); changeSelected({ curve });
  });
}

function bindEditing() {
  $('layerArrange').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); $('layerArrange').open = false; $('layerArrange').querySelector('summary').focus(); }
  });
  for (const [id, type] of [['addText', 'text'], ['addRectangle', 'rect'], ['addEllipse', 'ellipse']]) $(id).onclick = handle(() => addLayer(type));
  $('drawMode').onclick = () => { state.draw = !state.draw; if (state.draw) { state.regionMode = false; state.maskBrush = ''; state.vectorMode = false; } notify(); };
  $('regionMode').onclick = () => { state.regionMode = !state.regionMode; if (state.regionMode) { state.draw = false; state.maskBrush = ''; state.vectorMode = false; } notify(); };
  $('selectWholeImage').onclick = handle(() => { state.region = selectionFromLayer(state.project, state.selected); notify(); });
  $('clearRegion').onclick = () => { state.region = null; notify(); };
  $('raiseLayer').onclick = handle(() => reorder(1)); $('lowerLayer').onclick = handle(() => reorder(-1));
  $('groupBelow').onclick = handle(() => {
    const parent = parentGroup(state.project, state.selected);
    const siblings = parent ? parent.children : state.project.layers.filter(layer => !parentGroup(state.project, layer.id)).map(layer => layer.id);
    const index = siblings.indexOf(state.selected); if (index < 1) throw new Error('Choose a layer with a sibling below it.');
    const id = crypto.randomUUID(); edit({ type: 'group', ids: [siblings[index - 1], state.selected], id }); state.selected = id; notify();
  });
  $('ungroupLayer').onclick = handle(() => edit({ type: 'ungroup', id: state.selected }));
  $('deleteLayer').onclick = handle(() => edit({ type: 'remove', id: state.selected }));
  $('duplicateLayer').onclick = handle(() => {
    const id = crypto.randomUUID(); edit({ type: 'duplicate', id: state.selected, newId: id }); state.selected = id; notify();
  });
  $('undo').onclick = () => { state.project = state.history.undo(); notify(); };
  $('redo').onclick = () => { state.project = state.history.redo(); notify(); };
  const resize = () => { fitCanvas(); paint(); };
  $('zoom').onchange = resize; new ResizeObserver(resize).observe($('canvasViewport'));
}

const NARROW = '(max-width:800px)';
const MENUS = ['documentMenu', 'exportMenu'];

/** Close a desktop popover menu and give focus back to its summary when asked. */
function close(menu, focus = false) {
  if (!menu.open) return;
  menu.open = false;
  if (focus) menu.querySelector(':scope > summary')?.focus({ preventScroll: true });
}

/** Desktop menus behave like menus: a choice, Escape or a press elsewhere closes them. On a phone the shell's sheet does this. */
function bindPopovers() {
  for (const id of MENUS) {
    const menu = $(id);
    menu.addEventListener('click', event => {
      const item = event.target.closest('button');
      if (item && !item.disabled && menu.contains(item) && !matchMedia(NARROW).matches) close(menu);
    });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape' && menu.open && !matchMedia(NARROW).matches) { event.preventDefault(); event.stopPropagation(); close(menu, true); }
    });
  }
  document.addEventListener('pointerdown', event => {
    if (matchMedia(NARROW).matches) return;
    for (const id of MENUS) if (!$(id).contains(event.target)) close($(id));
  }, true);
}

/** The Insert tools: a sheet opened by Add on a phone, the always-open tool rail on a desktop. */
function bindInsert() {
  const insert = $('insertMenu'), narrow = matchMedia(NARROW);
  const fit = () => { insert.open = !narrow.matches; };
  fit(); narrow.addEventListener('change', () => setTimeout(fit, 0));
  insert.addEventListener('toggle', () => { if (!narrow.matches && !insert.open) insert.open = true; });
  $('addPrimary').onclick = () => { if (narrow.matches) insert.open = !insert.open; };
}

/** Bind the app row: document menu, Export and the phone's Add. */
function bindMenus() {
  bindPopovers(); bindInsert();
  $('exportFromMenu').onclick = () => {
    close($('documentMenu'));
    // The document menu's sheet closes after this press; Export opens once it has.
    setTimeout(() => { $('exportMenu').open = true; $('exportMenu').querySelector('button:not(:disabled)')?.focus({ preventScroll: true }); }, 60);
  };
}

async function start() {
  bindEditing(); bindMenus(); bindProperties(); bindMasks(); bindAdjustments(); bindProjects(); bindFiles(); bindTemplates(); bindBrand(); bindRegionEditPanel(); bindGenerateImagePanel();
  const brandReady = loadBrand();
  subscribe(render); bindVectors(); bindInteractions(); subscribe(queueAutosave); render();
  void bindEditorFoundation().catch(() => console.warn('[Create] Shared editor layout is unavailable. The existing editor remains available.'));
  void bindEditorContext().catch(() => console.warn('[Create] Shared screen context is unavailable. Manual editing remains available.'));
  void bindEditorHandoff().catch(failure => error(`The concierge cannot synchronize this document: ${failure.message}`));
  try {
    const result = await api('/permissions'); state.permissions = result.permissions || {};
    const id = new URLSearchParams(location.search).get('project');
    if (id && /^[a-f0-9-]{36}$/i.test(id) && state.permissions.read) {
      const { project } = await api(`/projects/${id}`); openDocument(project.document, project);
    }
    state.loading = false; notify(); void loadRegionProvider(); await brandReady; acceptIncomingTemplate(); await acceptIncomingArtifact();
  } catch (failure) { state.loading = false; notify(); error(failure.message); }
}
start();
