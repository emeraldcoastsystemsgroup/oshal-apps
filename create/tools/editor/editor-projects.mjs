/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Save immutable revisions, reopen owned work and explicitly resolve stale-tab conflicts.
 */
import { $, state, dirty, canEdit, api, jsonRequest, openDocument, notify, error, handle } from './editor-state.mjs';
import { createProject, serializeProject } from './model.mjs';
let saveTimer;

/** Save a captured snapshot; edits made during the request retain their unsaved baseline. */
export async function saveProject(copy = false) {
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

/** Autosave existing projects only; the first save is an explicit user action. */
export function queueAutosave() {
  clearTimeout(saveTimer);
  if (!$('autosave').checked || !state.id || !canEdit() || !dirty() || state.saving || state.conflict || state.saveFailed) return;
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
  buttons.append(action('Delete project', async () => {
    if (state.saving || state.loading) throw new Error('Wait for the current action to finish.');
    if (!window.confirm(`Delete “${record.title}” and its saved revisions?`)) return;
    await api(`/projects/${record.id}`, jsonRequest('DELETE', { baseRevision: record.revision }));
    if (state.id === record.id) openDocument(createProject()); await showProjects();
  }, !state.permissions.delete)); row.append(name, meta, buttons); return row;
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
  $('autosave').onchange = queueAutosave;
  window.addEventListener('beforeunload', event => { if (dirty() && state.project.layers.length) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', () => clearTimeout(saveTimer));
}
