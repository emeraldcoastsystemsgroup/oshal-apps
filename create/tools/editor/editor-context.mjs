/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Share only the current selected-layer summary through the existing read-only surface bridge, retiring unavailable context.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Add the current image region as bounded scalar fields (kind, target layer, source-pixel bounds, area, point count) and whether it is ready or must be reselected. Still read-only: no outline points, pixels or asset references.
 */
import { state, subscribe, dirty } from './editor-state.mjs';
import { resolveSelection, selectionSummary } from './region-select.mjs';

const clipped = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
let bound = null;
let pending = null;

/** A region is described by its size and target only; a stale one says why instead of how it looked. */
function regionFields() {
  if (!state.region) return {};
  const summary = selectionSummary(state.region), fields = { regionKind: summary.kind, regionLayerId: clipped(summary.layerId, 100),
    regionX: summary.x, regionY: summary.y, regionWidth: summary.width, regionHeight: summary.height, regionArea: summary.area, regionPoints: summary.points };
  try { resolveSelection(state.project, state.region); return { ...fields, regionState: 'ready' }; }
  catch (failure) { return { ...fields, regionState: 'stale', regionIssue: clipped(failure.message, 160) }; }
}

/** Context describes the visible selection, never image bytes, asset URLs or the whole document. */
function snapshot(reason) {
  const base = { surface: 'create-editor', can: [], customOps: [], fields: { readOnly: true, available: false } };
  if (reason) return { ...base, digest: `Image editor context unavailable: ${reason}.` };
  if (state.loading || !state.permissions.view || !(state.id ? state.permissions.read : state.permissions.create)) return snapshot('not readable');
  if (document.querySelector('dialog[open]')) return snapshot('dialog open');
  const project = state.project;
  const selected = project.layers.find(layer => layer.id === state.selected && layer.visible);
  const fields = { readOnly: true, available: true, revision: state.revision, canvasWidth: project.width,
    canvasHeight: project.height, layerCount: project.layers.length, saved: Boolean(state.id), draft: dirty(), ...regionFields() };
  if (selected) Object.assign(fields, { layerId: clipped(selected.id, 100), layerType: selected.type,
    layerName: clipped(selected.name, 120), locked: selected.locked,
    x: selected.x, y: selected.y, width: selected.w, height: selected.h,
    ...(selected.type === 'text' ? { text: clipped(selected.text, 1000) } : {}) });
  const region = !fields.regionKind ? '' : fields.regionState === 'ready'
    ? ` Region selected (${fields.regionKind}, ${fields.regionWidth} × ${fields.regionHeight} source pixels).` : ' The selected region must be reselected.';
  return { ...base, title: clipped(project.name, 160), ...(state.id ? { recordId: clipped(state.id, 120) } : {}),
    digest: (selected ? `Selected ${selected.type} layer.` : 'Image editor open. No visible layer selected.') + region
      + (selected ? ' Context only; editing commands are unavailable.' : ' Editing commands are unavailable.'), fields };
}

/** Request refresh is the only accepted inbound action; generic field/custom mutation handlers are not attached. */
function refreshRequest(event, publish) {
  const data = event.data;
  if (event.source !== window.parent || event.origin !== location.origin) return;
  if (data?.channel !== 'oshal-surface-bridge' || data.v !== 1 || data.app !== 'create') return;
  if (data.op === 'custom' && data.name === 'request_context') publish(true);
}

/** Use the shared emitter without copying its protocol implementation or enabling mutation listeners. */
async function connect() {
  const { createSurfaceBridgeClient } = await import('/shared/ui/js/surface-bridge-client.js');
  const bridge = createSurfaceBridgeClient({ app: 'create' });
  let previous = '', epoch = 0, stopped = false;
  const publish = (force = false, reason) => {
    if (stopped) return;
    const value = snapshot(reason), signature = JSON.stringify(value);
    if (!force && signature === previous) return;
    previous = signature; value.fields.contextEpoch = ++epoch; bridge.emitContext(value);
  };
  const unsubscribe = subscribe(() => publish());
  const messages = event => refreshRequest(event, publish);
  const observer = new MutationObserver(() => publish());
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
  const dispose = event => {
    if (stopped) return;
    publish(true, 'closed'); stopped = true; unsubscribe(); observer.disconnect();
    window.removeEventListener('message', messages); window.removeEventListener('pagehide', dispose); bound = null;
    if (event?.persisted) window.addEventListener('pageshow', () => {
      void bindEditorContext().catch(() => console.warn('[Create] Shared screen context is unavailable.'));
    }, { once: true });
  };
  window.addEventListener('message', messages); window.addEventListener('pagehide', dispose);
  bound = dispose; publish(true); return dispose;
}

/** Deduplicate startup/restore requests, including callers awaiting the same shared-module import. */
export function bindEditorContext() {
  if (bound) return Promise.resolve(bound);
  if (window.parent === window) return Promise.resolve(() => {});
  pending ??= connect().finally(() => { pending = null; });
  return pending;
}
