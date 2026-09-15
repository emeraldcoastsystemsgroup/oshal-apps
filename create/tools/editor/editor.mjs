/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Assemble the real Create image editor from bounded model, renderer and owned-project modules.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Admit editable template browsing after current access resolves and preserve saved project links.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Publish bounded read-only selected-layer context with the shared bridge while preserving manual editing when it is unavailable.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Read the brand kit beside permissions and settle it before template deep links, so designs open in the brand.
 */
import { $, state, edit, notify, subscribe, handle, api, error, openDocument } from './editor-state.mjs';
import { render, fitCanvas, paint } from './editor-view.mjs';
import { bindProjects, queueAutosave } from './editor-projects.mjs';
import { bindFiles, acceptIncomingArtifact } from './editor-files.mjs';
import { bindInteractions } from './editor-interactions.mjs';
import { bindTemplates, acceptIncomingTemplate } from './editor-templates.mjs';
import { bindEditorContext } from './editor-context.mjs';
import { bindBrand, loadBrand } from './brand-editor.mjs';

function addLayer(type) {
  const layer = { id: crypto.randomUUID(), type, name: type === 'text' ? 'Your title' : type === 'rect' ? 'Rectangle' : 'Ellipse',
    x: state.project.width * .15, y: state.project.height * .2, w: state.project.width * .5, h: state.project.height * .25,
    ...(type === 'text' ? { text: 'Your title', fontSize: 64, fontWeight: 700 } : { fill: '#7c3aed' }) };
  edit({ type: 'add', layer }); state.selected = layer.id; notify();
}

function changeSelected(patch) { if (state.selected) edit({ type: 'update', id: state.selected, patch }); }

function bindProperties() {
  for (const control of document.querySelectorAll('[data-property]')) control.onchange = handle(() => {
    const numeric = ['number', 'range'].includes(control.type) || control.id === 'fontWeight';
    changeSelected({ [control.dataset.property]: numeric ? Number(control.value) : control.value });
  });
  $('applyCrop').onclick = handle(() => changeSelected({ crop: Object.fromEntries(['x', 'y', 'w', 'h'].map(key => [key, Number($(`crop${key.toUpperCase()}`).value) / 100])) }));
  $('resetCrop').onclick = handle(() => changeSelected({ crop: { x: 0, y: 0, w: 1, h: 1 } }));
  $('projectName').onchange = handle(() => edit({ type: 'project', patch: { name: $('projectName').value || 'Untitled image' } }));
  $('applyCanvas').onclick = handle(() => edit({ type: 'project', patch: {
    width: Number($('canvasWidth').value), height: Number($('canvasHeight').value),
    background: $('transparentBackground').checked ? 'transparent' : $('canvasBackground').value } }));
}

function reorder(direction) {
  const index = state.project.layers.findIndex(layer => layer.id === state.selected);
  if (index < 0) return;
  edit({ type: 'reorder', id: state.selected, index: Math.max(0, Math.min(state.project.layers.length - 1, index + direction)) });
}

function bindEditing() {
  for (const [id, type] of [['addText', 'text'], ['addRectangle', 'rect'], ['addEllipse', 'ellipse']]) $(id).onclick = handle(() => addLayer(type));
  $('drawMode').onclick = () => { state.draw = !state.draw; notify(); };
  $('raiseLayer').onclick = handle(() => reorder(1)); $('lowerLayer').onclick = handle(() => reorder(-1));
  $('deleteLayer').onclick = handle(() => edit({ type: 'remove', id: state.selected }));
  $('duplicateLayer').onclick = handle(() => {
    const id = crypto.randomUUID(); edit({ type: 'duplicate', id: state.selected, newId: id }); state.selected = id; notify();
  });
  $('undo').onclick = () => { state.project = state.history.undo(); notify(); };
  $('redo').onclick = () => { state.project = state.history.redo(); notify(); };
  const resize = () => { fitCanvas(); paint(); };
  $('zoom').onchange = resize; new ResizeObserver(resize).observe($('canvasViewport'));
}

async function start() {
  if (matchMedia('(max-width:720px)').matches) $('canvasOptions').open = false;
  bindEditing(); bindProperties(); bindProjects(); bindFiles(); bindInteractions(); bindTemplates(); bindBrand();
  const brandReady = loadBrand();
  subscribe(render); subscribe(queueAutosave); render();
  void bindEditorContext().catch(() => console.warn('[Create] Shared screen context is unavailable. Manual editing remains available.'));
  try {
    const result = await api('/permissions'); state.permissions = result.permissions || {};
    const id = new URLSearchParams(location.search).get('project');
    if (id && /^[a-f0-9-]{36}$/i.test(id) && state.permissions.read) {
      const { project } = await api(`/projects/${id}`); openDocument(project.document, project);
    }
    state.loading = false; notify(); await brandReady; acceptIncomingTemplate(); await acceptIncomingArtifact();
  } catch (failure) { state.loading = false; notify(); error(failure.message); }
}
start();
