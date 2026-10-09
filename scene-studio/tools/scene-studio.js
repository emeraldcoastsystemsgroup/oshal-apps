/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the studio's behaviour: the project list and a
 *                     |                             | new-project form, the engine pill and the engine-down banner with
 *                     |                             | the install command the route supplies, the preview (rendered still
 *                     |                             | + orbit view from the shared OSHAL STL viewer), a headless Godot
 *                     |                             | run, a file editor (text files) with upload and download, direct
 *                     |                             | godot-mcp and Blender Python panels, a Blender model imported into
 *                     |                             | a Godot project, exports, and the revision history with restore
 *                     |                             | (undo). A poll follows the open project while the concierge edits
 *                     |                             | it from the chat rail; every reply is fenced to the selection that
 *                     |                             | asked for it. Every node is built with textContent; every call goes
 *                     |                             | through one `api()` helper.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | 0.1.1 (found in the first live test): the godot-mcp panel opens on
 *                     |                             | add_node and swaps in an example for each tool (it opened on
 *                     |                             | create_scene with add_node's arguments, which replaced main.tscn);
 *                     |                             | a tool or Python call reports its outcome only after the studio has
 *                     |                             | refreshed, so a quick next click is not refused as busy; the preview
 *                     |                             | line marks an older revision even when the image is unchanged.
 */
(function () {
  'use strict';
  const BASE = '/api/scene-studio';
  const $ = (id) => document.getElementById(id);
  const state = { projects: [], project: null, detail: null, caps: null, viewer: null, filePath: '', epoch: 0, pollTimer: null, busy: false, previewShown: '' };

  /** One call to the package's routes; a non-2xx reply throws with the server's message. */
  async function api(method, path, body) {
    const opt = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const res = await fetch(BASE + path, opt);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.reason || json.message || json.error || ('HTTP ' + res.status));
      err.status = res.status;
      throw err;
    }
    return json;
  }

  function status(text, tone) {
    const el = $('status');
    el.textContent = text || '';
    el.className = 'small' + (tone ? ' ' + tone : '');
  }

  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (k === 'text') node.textContent = v;
      else if (k === 'className') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    (children || []).forEach((c) => node.appendChild(c));
    return node;
  }

  const kindLabel = (kind) => (kind === 'godot' ? 'Godot' : 'Blender');
  /** One worked example per godot-mcp tool, shown when the tool is picked. */
  const GODOT_EXAMPLES = {
    add_node: { scenePath: 'main.tscn', parentNodePath: 'root', nodeType: 'OmniLight3D', nodeName: 'Lamp' },
    create_scene: { scenePath: 'levels/level1.tscn', rootNodeType: 'Node3D' },
    save_scene: { scenePath: 'main.tscn', newPath: 'main_variant.tscn' },
    load_sprite: { scenePath: 'main.tscn', nodePath: 'root/Sprite2D', texturePath: 'assets/icon.png' },
    export_mesh_library: { scenePath: 'main.tscn', outputPath: 'meshes.res' },
    get_uid: { filePath: 'main.tscn' },
    get_project_info: {},
  };
  const selection = () => ({ epoch: state.epoch, projectId: state.project && state.project.projectId });
  const current = (intent) => intent.epoch === state.epoch;

  /** Run one user action: disable re-entry, report progress and failure in the status line. */
  async function act(label, fn) {
    if (state.busy) { status('Still working on the last action…', 'bad'); return; }
    state.busy = true;
    status(label + '…');
    try { await fn(); } catch (e) { status(label + ' failed: ' + e.message, 'bad'); } finally { state.busy = false; }
  }

  // ── Engine ──────────────────────────────────────────────────────────────

  async function loadCapabilities() {
    try {
      state.caps = await api('GET', '/capabilities');
    } catch (e) {
      state.caps = { capabilities: null, reason: e.message, engine: {} };
    }
    renderEngine();
  }

  function renderEngine() {
    const caps = state.caps || {};
    const live = !!caps.capabilities;
    const pill = $('engine-pill');
    const versions = (caps.capabilities && caps.capabilities.versions) || {};
    pill.textContent = live ? 'engine: live' : 'engine: down';
    pill.className = 'badge ' + (live ? 'ok' : 'bad');
    pill.title = live ? ['Godot ' + (versions.godot || '?'), versions.blender || 'Blender ?', versions.godotMcp || '', versions.blenderMcp || ''].join(' · ') : (caps.reason || '');
    $('engine-banner').hidden = live;
    $('engine-reason').textContent = caps.reason || '';
    $('engine-hint').textContent = caps.installHint || (caps.engine && caps.engine.installHint) || '';
    const tools = (caps.godotTools || []);
    const select = $('godot-tool');
    if (!select.options.length && tools.length) {
      tools.forEach((t) => select.appendChild(el('option', { value: t, text: t })));
      select.value = tools.includes('add_node') ? 'add_node' : tools[0];
      showGodotExample();
    }
  }

  function showGodotExample() {
    $('godot-args').value = JSON.stringify(GODOT_EXAMPLES[$('godot-tool').value] || {}, null, 1);
  }

  // ── Projects ────────────────────────────────────────────────────────────

  async function loadProjects() {
    const out = await api('GET', '/projects');
    state.projects = out.projects || [];
    renderProjectList();
  }

  function renderProjectList() {
    const list = $('project-list');
    list.replaceChildren();
    if (!state.projects.length) { list.appendChild(el('p', { className: 'muted small', text: 'No projects yet.' })); }
    state.projects.forEach((p) => {
      const active = state.project && state.project.projectId === p.projectId;
      list.appendChild(el('button', { className: 'project-item' + (active ? ' active' : ''), onclick: () => openProject(p.projectId) }, [
        el('span', { className: 'project-title', text: p.title, title: p.title }),
        el('span', { className: 'badge ' + p.kind, text: kindLabel(p.kind) + ' · r' + p.revision }),
      ]));
    });
    const blenders = state.projects.filter((p) => p.kind === 'blender');
    const from = $('import-from');
    from.replaceChildren(...blenders.map((p) => el('option', { value: p.projectId, text: p.title })));
  }

  async function openProject(projectId) {
    state.epoch += 1;
    const intent = selection();
    stopPoll();
    clearPreview();
    state.filePath = '';
    $('file-text').value = '';
    $('file-path').value = '';
    $('run-output').hidden = true;
    $('godot-result').hidden = true;
    $('blender-result').hidden = true;
    $('export-link').hidden = true;
    const detail = await api('GET', '/projects/' + encodeURIComponent(projectId));
    if (!current(intent)) return;
    state.project = detail.project;
    renderDetail(detail);
    renderProjectList();
    history.replaceState(null, '', location.pathname + '?project=' + encodeURIComponent(projectId));
    startPoll();
  }

  /** Re-read the open project; repaint only when something changed (the concierge may be editing it). */
  async function refreshProject(force) {
    if (!state.project) return;
    const intent = selection();
    const detail = await api('GET', '/projects/' + encodeURIComponent(state.project.projectId));
    if (!current(intent)) return;
    const before = state.project;
    const after = detail.project;
    const changed = force || after.revision !== before.revision || JSON.stringify(after.preview) !== JSON.stringify(before.preview) || JSON.stringify(after.lastRun) !== JSON.stringify(before.lastRun) || after.title !== before.title;
    state.project = after;
    if (changed) {
      renderDetail(detail);
      await loadProjects();
      if (!force && after.revision !== before.revision) status('Updated to revision ' + after.revision + ' (' + ((detail.revisions[0] || {}).action || 'change') + ')', 'ok');
    }
  }

  function renderDetail(detail) {
    const p = detail.project;
    state.detail = detail;
    $('empty-panel').hidden = true;
    $('project-panel').hidden = false;
    $('project-heading').textContent = p.title;
    $('project-kind').textContent = p.kind === 'godot' ? 'Godot game' : 'Blender model';
    $('project-kind').className = 'badge ' + p.kind;
    $('project-rev').textContent = 'revision ' + p.revision;
    $('run-section').hidden = p.kind !== 'godot';
    $('godot-tools').hidden = p.kind !== 'godot';
    $('blender-tools').hidden = p.kind !== 'blender';
    $('import-section').hidden = p.kind !== 'godot';
    renderFiles(detail);
    renderRevisions(detail.revisions || []);
    renderRun(p.lastRun);
    renderExportFormats(p.kind);
    showPreview(p.preview);
  }

  function renderFiles(detail) {
    const list = $('file-list');
    list.replaceChildren(...(detail.files || []).map((f) => el('li', { className: f.path === state.filePath ? 'active' : '' }, [
      el('span', { className: 'path', text: f.path, title: f.path, onclick: () => openFile(f.path) }),
      el('span', { className: 'small muted', text: formatBytes(f.bytes) }),
    ])));
    const notes = [];
    if (detail.hidden) notes.push(detail.hidden + ' Godot import files hidden');
    if (detail.more) notes.push(detail.more + ' more not listed');
    $('files-note').textContent = notes.join(' · ');
  }

  function renderRevisions(revisions) {
    const list = $('revision-list');
    const top = state.project ? state.project.revision : 0;
    list.replaceChildren(...revisions.map((r) => el('li', {}, [
      el('span', { className: 'badge', text: 'r' + r.revision }),
      el('span', { text: r.action, style: 'flex:1' }),
      el('span', { className: 'small muted', text: new Date(r.at).toLocaleString() }),
      r.revision === top ? el('span', { className: 'small muted', text: 'current' }) : el('button', { className: 'link', text: 'Restore', onclick: () => restore(r.revision) }),
    ])));
  }

  function renderRun(run) {
    const out = $('run-output');
    if (!run) { out.hidden = true; $('run-info').textContent = ''; return; }
    const lines = (run.output || []).concat((run.errors || []).length ? ['', '— errors —'].concat(run.errors) : []);
    out.textContent = lines.join('\n') || '(no output)';
    out.hidden = false;
    $('run-info').textContent = 'revision ' + run.revision + ' · ' + run.seconds + ' s · ' + (run.errors || []).length + ' error line(s)';
  }

  function renderExportFormats(kind) {
    const formats = ((state.caps || {}).exports || {})[kind] || (kind === 'godot' ? ['zip'] : ['glb', 'fbx', 'obj', 'stl', 'zip']);
    $('export-format').replaceChildren(...formats.map((f) => el('option', { value: f, text: f.toUpperCase() })));
  }

  // ── Preview ─────────────────────────────────────────────────────────────

  function clearPreview() {
    state.previewShown = '';
    $('preview-img').hidden = true;
    $('preview-img').removeAttribute('src');
    $('viewer').hidden = true;
    if (state.viewer) state.viewer.clear();
    $('preview-info').textContent = '';
  }

  async function showPreview(preview) {
    if (!preview) { clearPreview(); $('preview-info').textContent = 'No preview yet — render one.'; return; }
    const info = preview.info || {};
    const stale = state.project && preview.revision !== state.project.revision ? ' (older revision — render again)' : '';
    $('preview-info').textContent = 'revision ' + preview.revision + stale + ' · ' + (info.polygons || 0) + ' polygons · camera ' + (info.camera || '?') + (info.autoCamera ? ' (framed automatically)' : '') + ' · ' + (info.seconds || 0) + ' s';
    const key = preview.png + '|' + preview.at;
    if (state.previewShown === key) return;
    state.previewShown = key;
    const img = $('preview-img');
    img.src = preview.png + '&t=' + encodeURIComponent(preview.at);
    img.hidden = false;
    if (preview.stlUrl) await loadOrbit(preview.stlUrl, selection());
  }

  async function loadOrbit(url, intent) {
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const bytes = await res.arrayBuffer();
      if (!current(intent)) return;
      const viewerApi = window.OSHALStlViewer;
      if (!viewerApi || viewerApi.apiVersion !== 1) throw new Error('this OSHAL core has no shared 3-D viewer');
      $('viewer').hidden = false;
      if (!state.viewer) state.viewer = viewerApi.mount($('viewer'));
      state.viewer.load(bytes);
    } catch (e) {
      $('viewer').hidden = true;
      status('3-D view unavailable: ' + e.message, 'bad');
    }
  }

  async function renderPreview() {
    const intent = selection();
    await act('Rendering the preview', async () => {
      const out = await api('POST', '/projects/' + intent.projectId + '/preview', { samples: Number($('preview-samples').value) });
      if (!current(intent)) return;
      state.project = out.project;
      await showPreview(out.preview);
      status('Preview rendered.', 'ok');
    });
  }

  // ── Run, tools, files ───────────────────────────────────────────────────

  async function runProject() {
    const intent = selection();
    await act('Running the project', async () => {
      const out = await api('POST', '/projects/' + intent.projectId + '/run', { seconds: Number($('run-seconds').value) || 5 });
      if (!current(intent)) return;
      state.project = out.project;
      renderRun(out.run);
      status('Run finished.', (out.run.errors || []).length ? 'bad' : 'ok');
    });
  }

  async function callGodotTool() {
    const intent = selection();
    await act('Calling godot-mcp', async () => {
      let args;
      try { args = JSON.parse($('godot-args').value || '{}'); } catch (e) { throw new Error('the arguments are not valid JSON (' + e.message + ')'); }
      const out = await api('POST', '/projects/' + intent.projectId + '/godot/' + encodeURIComponent($('godot-tool').value), { arguments: args });
      if (!current(intent)) return;
      showResult('godot-result', out);
      await refreshProject(out.changed);
      announce(out);
    });
  }

  async function runBlender(tool) {
    const intent = selection();
    await act(tool === 'summary' ? 'Reading the .blend' : 'Running Blender Python', async () => {
      const path = tool === 'summary' ? '/blender/get_blendfile_summary_datablocks_for_cli' : '/blender/execute_blender_code_for_cli';
      const body = tool === 'summary' ? {} : { code: $('blender-code').value, save: $('blender-save').checked };
      const out = await api('POST', '/projects/' + intent.projectId + path, body);
      if (!current(intent)) return;
      showResult('blender-result', out);
      await refreshProject(out.changed);
      announce(out);
    });
  }

  function showResult(id, out) {
    const r = out.result || {};
    const changes = out.changed ? '\n\n— changed: ' + summarizeDelta(out.delta) : '';
    $(id).textContent = (r.isError ? 'ERROR\n' : '') + (r.text || '(no output)') + changes;
    $(id).hidden = false;
  }

  /** The outcome line, written once the studio shows the refreshed project. */
  function announce(out) {
    const r = out.result || {};
    status(out.changed ? 'Saved as revision ' + out.project.revision + '.' : 'Done (no change to the project).', r.isError ? 'bad' : 'ok');
  }

  function summarizeDelta(delta) {
    const d = delta || {};
    const part = (label, list) => (list && list.length ? label + ' ' + list.join(', ') : '');
    return [part('added', d.added), part('modified', d.modified), part('deleted', d.deleted)].filter(Boolean).join('; ') || 'files';
  }

  async function openFile(path) {
    const intent = selection();
    const out = await api('POST', '/projects/' + intent.projectId + '/files/read', { path }).catch((e) => { status(e.message, 'bad'); return null; });
    if (!out || !current(intent)) return;
    state.filePath = path;
    $('file-path').value = path;
    $('file-text').value = out.binary ? '' : out.text;
    $('file-text').placeholder = out.binary ? 'Binary file (' + formatBytes(out.bytes) + ') — download it to open it.' : '';
    $('file-text').disabled = out.binary;
    const link = $('download-file');
    link.href = BASE + '/projects/' + intent.projectId + '/files/download?path=' + encodeURIComponent(path);
    link.hidden = false;
    renderFiles(state.detail);
  }

  async function saveFile() {
    const intent = selection();
    const path = $('file-path').value.trim();
    if (!path) { status('Type a file path first.', 'bad'); return; }
    await act('Saving ' + path, async () => {
      const out = await api('PUT', '/projects/' + intent.projectId + '/files', { path, text: $('file-text').value });
      if (!current(intent)) return;
      state.filePath = path;
      await refreshProject(true);
      status('Saved ' + path + ' as revision ' + out.project.revision + '.', 'ok');
    });
  }

  async function deleteFile() {
    const intent = selection();
    const path = $('file-path').value.trim();
    if (!path || !confirm('Delete ' + path + '? (Restore brings it back.)')) return;
    await act('Deleting ' + path, async () => {
      await api('DELETE', '/projects/' + intent.projectId + '/files', { path });
      if (!current(intent)) return;
      state.filePath = '';
      $('file-text').value = '';
      $('file-path').value = '';
      await refreshProject(true);
    });
  }

  async function uploadFile(file) {
    if (!file || !state.project) return;
    const intent = selection();
    await act('Uploading ' + file.name, async () => {
      const form = new FormData();
      form.append('path', $('file-path').value.trim() || 'assets/' + file.name);
      form.append('file', file);
      const res = await fetch(BASE + '/projects/' + intent.projectId + '/files/upload', { method: 'POST', credentials: 'same-origin', body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || json.error || 'HTTP ' + res.status);
      if (!current(intent)) return;
      await refreshProject(true);
      status('Uploaded ' + file.name + ' as revision ' + json.project.revision + '.', 'ok');
    });
  }

  // ── Import, export, restore, project lifecycle ──────────────────────────

  async function importModel() {
    const intent = selection();
    const fromProjectId = $('import-from').value;
    const name = $('import-name').value.trim().replace(/[^A-Za-z0-9_-]/g, '_');
    if (!fromProjectId) { status('Create a Blender project first.', 'bad'); return; }
    await act('Importing the model', async () => {
      const body = { fromProjectId, name };
      if ($('import-instance').checked) body.instance = { nodeName: name.replace(/[^A-Za-z0-9_-]/g, '_') || 'Model' };
      const out = await api('POST', '/projects/' + intent.projectId + '/import-model', body);
      if (!current(intent)) return;
      await refreshProject(true);
      status('Imported as ' + out.resPath + ' (revision ' + out.project.revision + ').', 'ok');
    });
  }

  async function exportProject() {
    const intent = selection();
    await act('Exporting', async () => {
      const out = await api('POST', '/projects/' + intent.projectId + '/export', { format: $('export-format').value });
      if (!current(intent)) return;
      const link = $('export-link');
      link.href = out.export.url;
      link.textContent = 'Download ' + out.export.format.toUpperCase() + ' (' + formatBytes(out.export.bytes) + ', revision ' + out.export.revision + ')';
      link.hidden = false;
      status('Export ready.', 'ok');
    });
  }

  async function restore(revision) {
    const intent = selection();
    if (!confirm('Put revision ' + revision + ' back? It becomes a new revision; nothing is lost.')) return;
    await act('Restoring revision ' + revision, async () => {
      await api('POST', '/projects/' + intent.projectId + '/restore', { revision });
      if (current(intent)) await refreshProject(true);
    });
  }

  function showNewForm(show) {
    $('new-form').hidden = !show;
    if (show) { renderTemplates(); $('new-title').focus(); }
  }

  function renderTemplates() {
    const kind = document.querySelector('input[name=kind]:checked').value;
    const templates = ((state.caps || {}).templates || {})[kind] || (kind === 'godot' ? ['3d', '2d', 'empty'] : ['default', 'empty']);
    const names = { '3d': '3-D scene (ground, sun, camera)', '2d': '2-D scene', empty: 'empty', default: 'default scene (cube, camera, light)' };
    $('new-template').replaceChildren(...templates.map((t) => el('option', { value: t, text: names[t] || t })));
  }

  async function createProject() {
    const kind = document.querySelector('input[name=kind]:checked').value;
    await act('Creating the project', async () => {
      const out = await api('POST', '/projects', { kind, title: $('new-title').value.trim(), template: $('new-template').value });
      showNewForm(false);
      $('new-title').value = '';
      await loadProjects();
      await openProject(out.project.projectId);
      status('Created "' + out.project.title + '". Ask the Scene Studio director in the chat to build it, or edit it here.', 'ok');
    });
  }

  async function renameProject() {
    const name = prompt('New name', state.project.title);
    if (!name) return;
    await act('Renaming', async () => {
      await api('PATCH', '/projects/' + state.project.projectId, { title: name });
      await refreshProject(true);
    });
  }

  async function deleteProject() {
    const p = state.project;
    if (!confirm('Delete "' + p.title + '" and every revision of it? This cannot be undone.')) return;
    await act('Deleting', async () => {
      await api('DELETE', '/projects/' + p.projectId, { confirm: true });
      stopPoll();
      state.project = null;
      state.epoch += 1;
      $('project-panel').hidden = true;
      $('empty-panel').hidden = false;
      history.replaceState(null, '', location.pathname);
      await loadProjects();
      status('Deleted "' + p.title + '".', 'ok');
    });
  }

  // ── Poll, wiring ────────────────────────────────────────────────────────

  function startPoll() {
    stopPoll();
    state.pollTimer = setInterval(() => {
      if (document.hidden || state.busy) return;
      refreshProject(false).catch(() => undefined);
    }, 4000);
  }

  function stopPoll() { if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; } }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' kB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function wire() {
    $('new-project').addEventListener('click', () => showNewForm(true));
    $('cancel-new').addEventListener('click', () => showNewForm(false));
    document.querySelectorAll('input[name=kind]').forEach((r) => r.addEventListener('change', renderTemplates));
    $('create-project').addEventListener('click', createProject);
    $('rename-project').addEventListener('click', renameProject);
    $('delete-project').addEventListener('click', deleteProject);
    $('render-preview').addEventListener('click', renderPreview);
    $('run-project').addEventListener('click', runProject);
    $('godot-tool').addEventListener('change', showGodotExample);
    $('run-godot-tool').addEventListener('click', callGodotTool);
    $('run-blender').addEventListener('click', () => runBlender('code'));
    $('blender-summary').addEventListener('click', () => runBlender('summary'));
    $('save-file').addEventListener('click', saveFile);
    $('delete-file').addEventListener('click', deleteFile);
    $('upload-file').addEventListener('change', (ev) => { uploadFile(ev.target.files[0]); ev.target.value = ''; });
    $('import-model').addEventListener('click', importModel);
    $('export-project').addEventListener('click', exportProject);
    window.addEventListener('pagehide', stopPoll);
    setInterval(() => { if (!document.hidden && !state.busy) loadProjects().catch(() => undefined); }, 20000);
  }

  async function boot() {
    wire();
    await loadCapabilities();
    await loadProjects().catch((e) => status(e.message, 'bad'));
    const q = new URLSearchParams(location.search);
    if (q.get('project')) await openProject(q.get('project')).catch((e) => status(e.message, 'bad'));
  }

  // The full studio only: under an audience view the shared kit paints instead (see the head block in scene-studio.html).
  if (!window.AppView || !AppView.active()) document.addEventListener('DOMContentLoaded', boot);
})();
