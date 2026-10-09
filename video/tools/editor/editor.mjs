/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The manual video editor page controller (CREATE-EDIT-05d): import clips and music with the native picker, trim, split, reorder and remove segments, set clip and music volume, add titles, undo and redo, save and reopen optimistically, and export - every edit a validated document from the shared model, every action also on the keyboard. The unsaved draft lives in memory, survives theme changes and failed requests, and is kept per project in this browser so a reload or a conflict never loses it.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Preserve legacy routes while enabling bounded original-owner native media transport.
 */
import * as model from './timeline-model.mjs';
import { createTimelineHistory } from './timeline-history.mjs';
import { call, describe, upload, configureMediaTransport } from './editor-api.mjs';
import { remainingFrames, renderBed, renderInspector, renderSources, renderTitles, renderTrack } from './timeline-view.mjs';
import { createPlayer } from './editor-player.mjs';
import { createExporter } from './editor-export.mjs';

const $ = id => document.getElementById(id);
const state = { history: null, projectId: null, revision: null, savedText: '', selected: null, permissions: {}, busy: false };
let player, exporter;

const doc = () => state.history.current();
const dirty = () => JSON.stringify(doc()) !== state.savedText;
const editable = () => !!(state.projectId ? state.permissions.change : state.permissions.create);
const draftKey = () => `video-editor-draft:${state.projectId ?? 'new'}`;

function setStatus(text) { $('status').textContent = text; }
function showError(text) { $('error').textContent = text; $('error').hidden = false; }
function hideError() { $('error').hidden = true; $('conflictActions').hidden = true; }

/** The draft is a per-browser convenience: storage may be unavailable, and the in-memory draft stays authoritative. */
function persistDraft() {
  try {
    if (dirty()) localStorage.setItem(draftKey(), JSON.stringify({ baseRevision: state.revision, document: doc() }));
    else localStorage.removeItem(draftKey());
  } catch { /* storage unavailable: the in-memory draft is unaffected */ }
}
function readDraft() {
  try { const raw = localStorage.getItem(draftKey()); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function render() {
  const current = doc(), canEdit = editable();
  renderSources($('sources'), current, canEdit);
  if (state.selected && !current.segments.some(segment => segment.id === state.selected)) state.selected = null;
  renderTrack($('track'), current, state.selected);
  renderTitles($('titleTrack'), $('titles'), current, canEdit);
  renderInspector({ none: $('noSelection'), controls: $('segmentControls'), trimIn: $('trimIn'), trimOut: $('trimOut'), volume: $('segmentVolume'),
    volumeValue: $('segmentVolumeValue'), buttons: [$('split'), $('moveLeft'), $('moveRight'), $('removeSegment')] }, current, state.selected, canEdit);
  renderBed($('bedSource'), $('bedVolume'), $('bedVolumeValue'), current, canEdit);
  $('projectName').value = current.name; $('projectName').disabled = !canEdit;
  const canUpload = !!(state.permissions.create || state.permissions.change) && canEdit;
  $('addClip').disabled = !canUpload; $('addBed').disabled = !canUpload;
  $('undo').disabled = !state.history.canUndo(); $('redo').disabled = !state.history.canRedo();
  $('saveProject').disabled = state.busy || !canEdit || (!!state.projectId && !dirty());
  $('saveAsNew').disabled = state.busy || !state.permissions.create;
  $('addTitle').disabled = !canEdit || !current.segments.length;
  $('dirtyFlag').hidden = !dirty();
  player.refresh(); exporter.refresh();
}

function commit(next) {
  try { state.history.commit(next); } catch (error) { showError(error.message); return false; }
  hideError(); persistDraft(); render(); return true;
}
function apply(change) {
  try { return commit(change(doc())); } catch (error) { showError(error.message); return false; }
}

function cleanName(name, kind) {
  const text = String(name || '').replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, '').trim().slice(0, 120);
  return text || (kind === 'video' ? 'Clip' : 'Music');
}
function sourceOf(media, name) {
  return media.kind === 'video'
    ? { kind: 'video', asset: media.id, name, frames: media.frames, width: media.width, height: media.height, audio: media.hasAudio }
    : { kind: 'audio', asset: media.id, name, frames: media.frames };
}

async function uploadFile(kind, input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  hideError(); setStatus(`Uploading ${cleanName(file.name, kind)}…`);
  try {
    const media = await upload(kind, file);
    apply(current => {
      const added = model.addSource(current, sourceOf(media, cleanName(file.name, kind)));
      if (kind === 'audio' && !added.document.audioBed) return model.setAudioBed(added.document, added.key, 40);
      return kind === 'video' && remainingFrames(added.document) > 0 ? model.appendSegment(added.document, added.key) : added.document;
    });
    setStatus(`${cleanName(file.name, kind)} added.`);
  } catch (error) { showError(describe(error)); setStatus('Upload failed. Your edits are still here.'); }
}

async function loadProjects() {
  if (!state.permissions.read) return;
  try {
    const { projects } = await call('/projects');
    const select = $('projectList');
    select.replaceChildren(new Option('Open a saved project…', ''), ...projects.map(project => new Option(`${project.title} · revision ${project.revision}`, project.id)));
    select.value = state.projectId ?? ''; select.disabled = !projects.length;
  } catch (error) { showError(describe(error)); }
}

function adopt(project) {
  state.projectId = project.id; state.revision = project.revision; state.selected = null;
  state.history.reset(project.document); state.savedText = JSON.stringify(doc());
  try { history.replaceState(null, '', `?project=${project.id}`); } catch { /* embedded without history access */ }
}

async function open(id) {
  hideError(); setStatus('Opening…');
  try {
    adopt((await call(`/projects/${encodeURIComponent(id)}`)).project);
    const draft = readDraft();
    if (draft && draft.baseRevision === state.revision && commit(draft.document)) setStatus('Restored your unsaved edits.');
    else setStatus(`Saved · revision ${state.revision}`);
  } catch (error) { showError(describe(error)); setStatus('That project could not be opened.'); }
  render(); await loadProjects();
}

async function save(asNew = false) {
  if (state.busy || (asNew ? !state.permissions.create : !editable())) return;
  hideError(); state.busy = true; setStatus('Saving…'); render();
  const current = doc(), body = { title: current.name, document: current }, previousKey = draftKey();
  try {
    const { project } = asNew || !state.projectId
      ? await call('/projects', { method: 'POST', body })
      : await call(`/projects/${state.projectId}/revisions`, { method: 'POST', body: { baseRevision: state.revision, ...body } });
    try { localStorage.removeItem(previousKey); } catch { /* storage unavailable */ }
    state.projectId = project.id; state.revision = project.revision; state.savedText = JSON.stringify(current);
    try { localStorage.removeItem(draftKey()); history.replaceState(null, '', `?project=${project.id}`); } catch { /* storage or history unavailable */ }
    setStatus(`Saved · revision ${project.revision}`);
    loadProjects();
  } catch (error) {
    showError(describe(error)); setStatus('Not saved. Your edits are still here.');
    $('conflictActions').hidden = error.code !== 'video_edit_revision_conflict';
  } finally { state.busy = false; render(); }
}

function startNew() {
  hideError(); state.projectId = null; state.revision = null; state.selected = null;
  state.history.reset(model.createTimeline('Untitled video')); state.savedText = JSON.stringify(doc());
  try { history.replaceState(null, '', location.pathname); } catch { /* embedded without history access */ }
  const draft = readDraft();
  if (draft && draft.baseRevision === null && commit(draft.document)) setStatus('Restored your unsaved edits.');
  else setStatus('New project.');
  render();
}

function selectedIndex() { return doc().segments.findIndex(segment => segment.id === state.selected); }
function split() {
  const located = model.locateFrame(doc(), player.frame());
  if (!located || player.frame() === located.segment.start) { showError('Move the playhead inside a segment to split it.'); return; }
  apply(current => { const result = model.splitSegment(current, located.segment.id, player.frame()); state.selected = result.right; return result.document; });
}
function move(delta) {
  const index = selectedIndex();
  if (index < 0) return;
  const to = index + delta;
  if (to < 0 || to >= doc().segments.length) return;
  apply(current => model.moveSegment(current, state.selected, to));
}
function removeSelected() { if (selectedIndex() >= 0) apply(current => model.removeSegment(current, state.selected)); }
function undo() { if (state.history.canUndo()) { state.history.undo(); persistDraft(); render(); } }
function redo() { if (state.history.canRedo()) { state.history.redo(); persistDraft(); render(); } }

function addTitle(event) {
  event.preventDefault();
  const start = player.frame(), total = doc().segments.reduce((sum, segment) => sum + segment.out - segment.in, 0);
  const end = Math.min(total, start + Math.max(1, Math.round(Number($('titleSeconds').value) * 30)));
  if (apply(current => model.addTitle(current, { text: $('titleText').value, start, end, position: $('titlePosition').value, size: $('titleSize').value }).document)) {
    $('titleText').value = '';
  }
}

function onKey(event) {
  const key = event.key.toLowerCase(), modifier = event.ctrlKey || event.metaKey;
  if (modifier && key === 's') { event.preventDefault(); save(); return; }
  if (modifier && (key === 'y' || (key === 'z' && event.shiftKey))) { event.preventDefault(); redo(); return; }
  if (modifier && key === 'z') { event.preventDefault(); undo(); return; }
  if (modifier || event.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
  const actions = { ' ': () => player.toggle(), arrowleft: () => player.step(event.shiftKey ? -30 : -1), arrowright: () => player.step(event.shiftKey ? 30 : 1),
    s: () => editable() && split(), delete: () => editable() && removeSelected(), backspace: () => editable() && removeSelected(),
    '[': () => editable() && move(-1), ']': () => editable() && move(1) };
  if (!actions[key]) return;
  event.preventDefault(); actions[key]();
}

function wireTimeline() {
  $('track').addEventListener('click', event => {
    const id = event.target.closest('[data-segment]')?.dataset.segment;
    if (!id) return;
    state.selected = id; render();
    player.seek(model.timelineLayout(doc()).find(row => row.id === id).start);
  });
  $('sources').addEventListener('click', event => {
    const remove = event.target.closest('[data-remove-source]')?.dataset.removeSource, append = event.target.closest('[data-append-source]')?.dataset.appendSource;
    if (remove) apply(current => model.removeSource(current, remove));
    if (append) apply(current => model.appendSegment(current, append));
  });
  $('titles').addEventListener('click', event => {
    const id = event.target.closest('[data-remove-title]')?.dataset.removeTitle;
    if (id) apply(current => model.removeTitle(current, id));
  });
  $('playhead').addEventListener('input', () => player.seek(Number($('playhead').value)));
  $('play').addEventListener('click', () => player.toggle());
  $('stepBack').addEventListener('click', () => player.step(-1));
  $('stepForward').addEventListener('click', () => player.step(1));
}

function wireInspector() {
  const trim = () => apply(current => model.trimSegment(current, state.selected, { in: Number($('trimIn').value), out: Number($('trimOut').value) }));
  $('trimIn').addEventListener('change', trim); $('trimOut').addEventListener('change', trim);
  $('segmentVolume').addEventListener('input', () => { $('segmentVolumeValue').value = `${$('segmentVolume').value}%`; });
  $('segmentVolume').addEventListener('change', () => apply(current => model.setSegmentVolume(current, state.selected, Number($('segmentVolume').value))));
  $('split').addEventListener('click', split);
  $('moveLeft').addEventListener('click', () => move(-1)); $('moveRight').addEventListener('click', () => move(1));
  $('removeSegment').addEventListener('click', removeSelected);
  $('titleForm').addEventListener('submit', addTitle);
  $('bedSource').addEventListener('change', () => apply(current => model.setAudioBed(current, $('bedSource').value || null, Number($('bedVolume').value))));
  $('bedVolume').addEventListener('input', () => { $('bedVolumeValue').value = `${$('bedVolume').value}%`; });
  $('bedVolume').addEventListener('change', () => apply(current => model.setAudioBed(current, current.audioBed.source, Number($('bedVolume').value))));
  $('projectName').addEventListener('change', () => { if (!apply(current => model.renameTimeline(current, $('projectName').value))) $('projectName').value = doc().name; });
}

function wireProject() {
  $('addClip').addEventListener('change', event => uploadFile('video', event.target));
  $('addBed').addEventListener('change', event => uploadFile('audio', event.target));
  $('undo').addEventListener('click', undo); $('redo').addEventListener('click', redo);
  $('saveProject').addEventListener('click', () => save());
  $('saveAsNew').addEventListener('click', () => save(true));
  $('reloadSaved').addEventListener('click', () => { try { localStorage.removeItem(draftKey()); } catch { /* unavailable */ } open(state.projectId); });
  $('newProject').addEventListener('click', startNew);
  $('projectList').addEventListener('change', () => { if ($('projectList').value) open($('projectList').value); });
  document.addEventListener('keydown', onKey);
}

async function init() {
  state.history = createTimelineHistory(model.createTimeline('Untitled video'));
  state.savedText = JSON.stringify(doc());
  player = createPlayer({ viewer: $('viewer'), bed: $('bedAudio'), overlay: $('titleOverlay'), noPicture: $('noPicture'), playhead: $('playhead'),
    clock: $('clock'), play: $('play') }, doc, () => undefined);
  exporter = createExporter({ exportButton: $('exportMp4'), previewButton: $('renderPreview'), cancel: $('cancelExport'), progress: $('exportProgress'),
    status: $('exportStatus'), hint: $('exportHint'), download: $('downloadExport'), watch: $('watchExport') },
  () => ({ projectId: state.projectId, revision: state.revision, dirty: dirty(), canExport: !!state.permissions.export }));
  wireTimeline(); wireInspector(); wireProject();
  try { const current = await call('/permissions'); state.permissions = current.permissions; configureMediaTransport(current.nativeMedia); }
  catch (error) {
    showError(describe(error)); setStatus('The video editor is not available to you.'); render();
    document.documentElement.dataset.editorReady = 'true'; return;
  }
  $('newProject').disabled = !state.permissions.create;
  const id = new URLSearchParams(location.search).get('project');
  if (id && state.permissions.read) await open(id);
  else { startNew(); await loadProjects(); setStatus(state.permissions.create ? 'Ready. Add a clip to start.' : 'Your access does not include creating projects.'); }
  document.documentElement.dataset.editorReady = 'true';
}

init();
