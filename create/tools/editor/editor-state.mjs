/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Centralize permission-aware edits, bounded undo and observable project state.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Keep gateway and bounded-timeout failures readable without changing admission codes or request deadlines.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Explain bounded save-queue refusals while preserving the current draft.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Return an unsubscribe callback so optional context observers release their owned state listener.
 */
import { createProject, applyOperation, serializeProject } from './model.mjs';
import { createHistory } from './history.mjs';

export const $ = id => document.getElementById(id);
export const state = { project: createProject(), history: null, selected: null, id: null, revision: 0,
  saved: '', permissions: {}, loading: true, saving: false, conflict: false, saveFailed: false, draw: false, images: new Map() };
state.history = createHistory(state.project);
const listeners = new Set();
export const dirty = () => serializeProject(state.project) !== state.saved;
export const canEdit = () => !state.loading && Boolean(state.id ? state.permissions.change : state.permissions.create);
export const notify = () => { for (const listener of listeners) listener(); };
export const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export const error = message => { $('editorError').textContent = message || ''; $('editorError').hidden = !message; };
export const status = message => { $('saveStatus').textContent = message; };
const API_MESSAGES = {
  project_revision_conflict: 'A newer revision was saved elsewhere. Reopen the project or save your edits as a copy.',
  project_limit_reached: 'Your account has reached its project limit. Delete an unused project before creating another.',
  project_revision_limit_reached: 'This project has reached its revision limit. Save your edits as a new copy.',
  project_write_queue_full: 'Project storage is busy. Your edits are still here; please try saving again.',
  project_write_queue_timeout: 'Project storage is busy. Your edits are still here; please try saving again.',
  project_asset_limit_reached: 'Your image storage limit has been reached. Clean unused uploads in My projects.',
  project_permission_denied: 'Your current role does not permit this action.',
  project_not_found: 'This project is unavailable to your account.',
  project_image_too_large: 'This image exceeds the 8 MB upload or normalized-image limit.',
  invalid_project_image: 'Choose a supported raster image within the canvas size limits.',
};

/** Apply only authorized local edits and leave rejected operations untouched. */
export function edit(operation) {
  if (!canEdit()) throw new Error('Your role does not allow changing this project.');
  state.project = state.history.commit(applyOperation(state.project, operation));
  state.saveFailed = false;
  if (!state.project.layers.some(layer => layer.id === state.selected)) state.selected = null;
  error(''); notify();
}

/** Preserve a distinct saved baseline and reset undo only when opening a document. */
export function openDocument(project, record = null) {
  state.project = state.history.reset(project); state.id = record?.id ?? null;
  state.revision = record?.revision ?? 0; state.saved = record ? serializeProject(state.project) : '';
  state.selected = null; state.conflict = false; state.saveFailed = false; state.draw = false; error(''); notify();
}

/** Keep event-handler failures visible without leaking a rejected promise. */
export function handle(work) {
  return async event => { try { await work(event); } catch (failure) { error(failure.message || 'This action could not finish.'); } };
}

async function responseBody(response) {
  try { return await response.json(); }
  catch {
    const message = response.ok ? 'The server returned an unreadable response. Please try again.'
      : `The server could not complete this request (${response.status}). Please try again.`;
    const failure = new Error(message); failure.status = response.status; throw failure;
  }
}

/** Request JSON without persisting identities or session credentials in the project. */
export async function api(path, options = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch('/api/create' + path, { credentials: 'same-origin', ...options, signal: controller.signal });
    if (response.status === 204) return null;
    const body = await responseBody(response);
    if (!response.ok) {
      const failure = new Error(API_MESSAGES[body?.error] || body?.message || body?.error || `Request failed (${response.status}).`);
      failure.status = response.status; failure.code = body?.error; throw failure;
    }
    return body;
  } catch (failure) {
    if (controller.signal.aborted) throw new Error('The server took too long to respond. Please try again.');
    throw failure;
  } finally { clearTimeout(timer); }
}
export const jsonRequest = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
