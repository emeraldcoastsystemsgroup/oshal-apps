/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Automatically save the visible draft before concierge/Jarvis editing, then refresh the same project after its saved edit without discarding concurrent browser changes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Report the saved project's real edit permission separately from the read-only screen bridge.
 */
import { state, dirty, api, notify, subscribe, error, canEdit } from './editor-state.mjs';
import { saveProject } from './editor-projects.mjs';
import { serializeProject } from './model.mjs';
import { editorSnapshot } from './editor-context.mjs';

function waitForSave() {
  if (!state.saving) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('The document is still saving. Please try again in a moment.')); }, 25000);
    const unsubscribe = subscribe(() => { if (!state.saving) { clearTimeout(timer); unsubscribe(); resolve(); } });
  });
}

function ready() {
  if (state.loading) throw new Error('Wait for the document to finish opening.');
  if (!state.permissions.view || !state.permissions.read) throw new Error('Your current access does not allow the concierge to read this project.');
  if (document.querySelector('dialog[open]')) throw new Error('Finish or close the open dialog before asking about the document.');
  if (state.vectorDraft.length) throw new Error('Finish the path you are drawing before handing the document to the concierge.');
}

/** Save through the exact same original-owner revision route as the editor's own Save button. */
async function prepare() {
  try {
    document.activeElement?.blur?.();
    ready(); await waitForSave();
    // If a person types during the first save, capture that change too before the assistant reads.
    for (let attempt = 0; attempt < 3 && dirty(); attempt++) { await saveProject(); await waitForSave(); }
    if (dirty()) throw new Error('The document is still changing. Finish your edit and ask again.');
    const snapshot = editorSnapshot();
    if (!snapshot.fields.available) throw new Error('The current document is unavailable.');
    return { app: 'create', screen: 'surface', ...snapshot, fields: { ...snapshot.fields, readOnly: !canEdit() } };
  } catch (failure) { error(failure.message); throw failure; }
}

/** Accept an assistant's saved revision as one undoable edit, preserving the selected layer. */
async function refresh(expected) {
  const id = state.id, revision = state.revision;
  if (expected?.recordId && expected.recordId !== id) return;
  if (!id || state.loading || !state.permissions.read) return;
  try {
    await waitForSave();
    if (state.id !== id || state.revision !== revision) return;
    const { project } = await api(`/projects/${id}`);
    if (state.id !== id || state.revision !== revision || state.loading || project.revision <= revision) return;
    document.activeElement?.blur?.();
    if (dirty() || state.vectorDraft.length) {
      state.conflict = true; notify();
      throw new Error('The concierge saved an update while you were editing. Your draft is still here. Save a copy or reopen the saved project to choose which to keep.');
    }
    state.project = state.history.commit(project.document);
    state.revision = project.revision; state.saved = serializeProject(state.project);
    state.conflict = false; state.saveFailed = false;
    if (!state.project.layers.some(layer => layer.id === state.selected)) state.selected = null;
    error(''); notify();
  } catch (failure) { error(failure.message); throw failure; }
}

/**
 * @description Register this editor's automatic save/refresh handoff with both assistant entry points.
 * @returns {Promise<Function>} Release the current document registration.
 */
export async function bindEditorHandoff() {
  const { registerDocumentSession } = await import('/shared/ui/js/document-handoff.js');
  return registerDocumentSession({ app: 'create', prepare, refresh });
}
