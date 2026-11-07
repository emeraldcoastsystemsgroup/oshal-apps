/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Save immutable revisions, reopen owned work and explicitly resolve stale-tab conflicts.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Cancel a queued autosave when a concierge handoff saves now, so the pending timer cannot overlap that save.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Commit or refuse focused shared properties before capturing a saved revision.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (create--create-editor): automatic saving replaces the Save button, so a new image with content is saved through the same POST /projects route after the same pause as later revisions (Save a copy, conflicts and failures keep their rules); the document menu's Delete image removes the open saved image through the existing DELETE route.
 */
import { $, state, dirty, canEdit, api, jsonRequest, openDocument, notify, error, handle } from './editor-state.mjs';
import { createProject, serializeProject } from './model.mjs';
let saveTimer;

/** Save a captured snapshot; edits made during the request retain their unsaved baseline. */
export async function saveProject(copy = false) {
  clearTimeout(saveTimer);
  await state.foundation?.flushPending();
  if (state.saving || state.loading) throw new Error('Wait for the current action to finish.');
  if (copy ? !state.permissions.create : !canEdit()) throw new Error('Your role does not allow saving this project.');
  if (state.conflict && !copy) throw new Error('Reopen the project or save a copy to resolve the revision conflict.');
  if (!copy && state.id && !dirty()) return;
  const document = JSON.parse(serializeProject(state.project, { assetMode: 'reference' }));
  const path = state.id && !copy ? `/projects/${state.id}/revisions` : '/projects';
  const body = { title: document.name, document, ...(state.id && !copy ? { baseRevision: state.revision } : {}) };
  state.saving = true; notify();
  try {
    const { project } = await api(path, jsonRequest('POST', body));
    state.id = project.id; state.revision = project.revision; state.saved = serializeProject(document); state.conflict = false; state.saveFailed = false; error('');
  } catch (failure) { state.saveFailed = true; if (failure.code === 'project_revision_conflict') state.conflict = true; throw failure; }
  finally { state.saving = false; notify(); }
}

/** @description Whether the open image holds anything worth keeping: a layer, or any edit since it opened.
 * @returns {boolean} True once there is something to save. */
export const hasContent = () => state.project.layers.length > 0 || state.history.canUndo();

/** @description Automatic saving runs while the person keeps it on, nothing blocks it and their role may write this image.
 * A new image is first saved once it has content, through the same create route the explicit Save used.
 * @returns {boolean} True when a pending change will be saved without a press. */
export function autosaveReady() {
  if (!$('autosave').checked || state.loading || state.saving || state.conflict || state.saveFailed || !dirty()) return false;
  return state.id ? canEdit() : Boolean(state.permissions.create) && canEdit() && hasContent();
}

/** Save after a pause; Save a copy and conflict resolution stay explicit. */
export function queueAutosave() {
  clearTimeout(saveTimer);
  if (!autosaveReady()) return;
  saveTimer = setTimeout(() => saveProject().catch(failure => error(failure.message)), 1500);
}

export function mayReplace() {
  if (state.saving || state.loading) throw new Error('Wait for the current action to finish.');
  return !dirty() || (!state.id && !state.project.layers.length) || window.confirm('Discard the unsaved changes in this canvas?');
}

function action(label, callback, disabled = false) {
  const node = document.createElement('button'); node.type = 'button'; node.textContent = label;
  node.disabled = disabled; node.onclick = handle(callback); return node;
}

async function openSaved(id) {
  if (!mayReplace()) return;
  state.loading = true; notify();
  try { const { project } = await api(`/projects/${id}`); openDocument(project.document, project); $('projectDialog').close(); }
  finally { state.loading = false; notify(); }
}

async function revisions(row, record) {
  if (row.querySelector('.revision-row')) return;
  const { revisions: entries } = await api(`/projects/${record.id}/revisions`);
  const wrap = document.createElement('div'), select = document.createElement('select'); wrap.className = 'revision-row';
  select.setAttribute('aria-label', `Revision of ${record.title}`);
  for (const entry of entries) { const option = document.createElement('option'); option.value = entry.revision; option.textContent = `Revision ${entry.revision} · ${new Date(entry.createdAt).toLocaleString()}`; select.append(option); }
  wrap.append(select, action('Restore', async () => {
    if (!mayReplace()) return;
    state.loading = true; notify();
    try {
      const [{ project }, snapshot] = await Promise.all([api(`/projects/${record.id}`), api(`/projects/${record.id}/revisions/${select.value}`)]);
      openDocument(project.document, project); state.project = state.history.commit(snapshot.document ?? snapshot.project?.document);
      $('projectDialog').close();
    } finally { state.loading = false; notify(); }
  }, !state.permissions.change)); row.append(wrap);
}

function projectRow(record) {
  const row = document.createElement('article'); row.className = 'project-row'; row.dataset.projectId = record.id;
  const name = document.createElement('strong'), meta = document.createElement('small'), buttons = document.createElement('div');
  name.textContent = record.title; meta.textContent = `Revision ${record.revision} · ${new Date(record.updatedAt).toLocaleString()}`;
  buttons.className = 'project-buttons'; buttons.append(action('Open', () => openSaved(record.id)), action('Revisions', () => revisions(row, record)));
  buttons.append(action('Delete project', async () => { if (await deleteRecord(record)) await showProjects(); }, !state.permissions.delete)); row.append(name, meta, buttons); return row;
}

/** Delete one saved image and its revisions after confirmation; the open canvas resets when it was that image. */
async function deleteRecord(record) {
  if (state.saving || state.loading) throw new Error('Wait for the current action to finish.');
  if (!window.confirm(`Delete “${record.title}” and its saved revisions?`)) return false;
  await api(`/projects/${record.id}`, jsonRequest('DELETE', { baseRevision: record.revision }));
  if (state.id === record.id) openDocument(createProject());
  return true;
}


/** The project list is always read afresh in the signed-in account. */
export async function showProjects() {
  $('cleanupUploads').disabled = !state.permissions.delete;
  $('projectList').textContent = 'Loading your projects…';
  if (!$('projectDialog').open) $('projectDialog').showModal();
  try {
    const { projects } = await api('/projects'); $('projectList').replaceChildren(...projects.map(projectRow));
    if (!projects.length) $('projectList').textContent = 'No image projects yet. Save your first canvas to keep it here.';
  } catch (failure) { $('projectList').textContent = failure.message; }
}

export function bindProjects() {
  $('cleanupUploads').onclick = handle(async () => {
    if (!window.confirm('Remove your unattached image uploads older than 24 hours? Saved project revisions keep their images.')) return;
    const { deleted } = await api('/project-assets/cleanup', jsonRequest('POST', {}));
    $('cleanupResult').textContent = `Removed ${deleted.length} unused uploads.`;
  });
  $('saveProject').onclick = handle(() => saveProject()); $('saveCopy').onclick = handle(() => saveProject(true));
  $('openProjects').onclick = handle(showProjects); $('closeProjects').onclick = () => $('projectDialog').close();
  $('newProject').onclick = handle(() => { if (state.permissions.create && mayReplace()) openDocument(createProject()); });
  $('autosave').onchange = () => notify();
  $('deleteProject').onclick = handle(async () => {
    if (state.id) await deleteRecord({ id: state.id, title: state.project.name, revision: state.revision });
  });
  window.addEventListener('beforeunload', event => { if (dirty() && state.project.layers.length) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', () => clearTimeout(saveTimer));
}
