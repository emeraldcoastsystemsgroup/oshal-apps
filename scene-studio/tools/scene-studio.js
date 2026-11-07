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
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Work side by side with the concierge: the open project registers with the shared
 *                     |                             | document handoff. Before an assistant reads, prepare() waits for the running action and
 *                     |                             | saves an unsaved file edit through the existing PUT /files, then hands over the project
 *                     |                             | id and revision; refresh() re-reads the project and the open file and redraws them,
 *                     |                             | keeping text the person is still editing and saying so in the status line.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | UX audit 2026-11-06 (scene-studio--scene-studio). Render preview, Run, Run Blender,
 *                     |                             | Call (godot-mcp) and Import are disabled while no project is open as well as for a
 *                     |                             | refused role, and that gating re-runs whenever a project opens or closes (gateActions);
 *                     |                             | renderPreview refuses a missing project instead of posting /projects/null/preview. The
 *                     |                             | first screen is the three types (3D scene, Godot game, Blender model) with nothing saved,
 *                     |                             | and the projects newest first with one New at the bottom right once there are some; a
 *                     |                             | type creates an untitled project at once and renders its first preview, so a new scene
 *                     |                             | never shows "No preview yet". The navigation shows the project selector with full names.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | 0.4.2 (Roger, trial, 2026-11-06, F13): the concierge answers with nothing open (kernel
 *                     |                             | editor-assistant.js 4), so the director can make the project the person asks for from the
 *                     |                             | start card or the list. A turn that began with no project open lists the projects again when
 *                     |                             | it returns and opens the one project that turn made; with none or several made it only lists.
 */
(function () {
  'use strict';
  const BASE = '/api/scene-studio';
  const $ = (id) => document.getElementById(id);
  const state = { projects: [], project: null, detail: null, caps: null, viewer: null, filePath: '', epoch: 0, pollTimer: null, busy: false, acting: null, previewShown: '', fileBaseline: '', listed: false, pendingFirst: null };
  /** The three things New makes; each opens untitled and ready, with its first preview. */
  const TYPES = [
    { key: 'scene3d', label: '3D scene', note: 'Ground, sun and camera, ready to build on', icon: 'scene', kind: 'godot', template: '3d', title: 'Untitled scene' },
    { key: 'game', label: 'Godot game', note: 'A 2-D Godot game with its camera', icon: 'game', kind: 'godot', template: '2d', title: 'Untitled game' },
    { key: 'model', label: 'Blender model', note: 'A cube, a camera and a light', icon: 'mesh', kind: 'blender', template: 'default', title: 'Untitled model' },
  ];
  /** The adapter's icon drawer (an empty node until the editor is bound). */
  let sceneIcon = () => document.createTextNode('');

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
    state.busy = true;editorFoundation?.refresh();
    status(label + '…');
    const run = (async () => {
      try { await fn(); } catch (e) { status(label + ' failed: ' + e.message, 'bad'); } finally { state.busy = false;editorFoundation?.refresh(); }
    })();
    state.acting = run;
    await run;
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

  const refusedRun = () => (state.caps || {}).access?.execute === false;

  /** The engine actions need an open project and execution access; re-run whenever either changes. */
  function gateActions() {
    const refused = refusedRun(), none = !state.project;
    for (const id of ['run-godot-tool', 'run-blender', 'import-model', 'run-project', 'render-preview']) {
      const button = $(id);
      button.disabled = refused || none;
      button.title = refused ? 'Your current role permits source editing but does not permit running project code.' : none ? 'Open or create a project first.' : '';
    }
    editorFoundation?.refresh();
  }

  function renderEngine() {
    const caps = state.caps || {};
    const refused = refusedRun();
    gateActions();
    $('execution-access').hidden = !refused;
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
    state.listed = true;
    renderProjectList();
  }

  const opener = (projectId) => () => openProject(projectId).catch((e) => status(e.message, 'bad'));

  /** The navigation's project selector (full names, newest first) while a project is open; the first screen otherwise. */
  function renderProjectList() {
    const list = $('project-list');
    list.className = 'scene-projects';
    list.hidden = !state.project;
    list.replaceChildren(el('button', { type: 'button', className: 'scene-secondary', text: '‹ All projects', onclick: goHome }), ...state.projects.map((p) => {
      const props = { type: 'button', onclick: opener(p.projectId) };
      if (state.project && state.project.projectId === p.projectId) props['aria-current'] = 'true';
      return el('button', props, [el('span', { text: p.title }), el('span', { className: 'badge ' + p.kind, text: kindLabel(p.kind) + ' · r' + p.revision })]);
    }));
    renderHome();
    const blenders = state.projects.filter((p) => p.kind === 'blender');
    const from = $('import-from');
    from.replaceChildren(...blenders.map((p) => el('option', { value: p.projectId, text: p.title })));
  }

  /** The first screen: the three types with nothing saved, else the projects newest first with one New. */
  function renderHome() {
    const open = !!state.project, none = !state.projects.length;
    $('home').hidden = open || !state.listed;
    $('home-types').hidden = open || !none;
    $('home-list').hidden = open || none;
    $('new-project').hidden = !open;
    if (open || none) return;
    $('home-cards').replaceChildren(...state.projects.map((p) => el('button', { type: 'button', className: 'scene-card', onclick: opener(p.projectId) }, [
      p.preview && p.preview.png ? el('img', { className: 'scene-card-thumb', alt: '', src: p.preview.png + '&t=' + encodeURIComponent(p.preview.at) }) : null,
      el('span', { className: 'scene-card-title', text: p.title }),
      el('span', { className: 'badge ' + p.kind, text: p.kind === 'godot' ? 'Godot game' : 'Blender model' }),
      el('span', { className: 'scene-card-meta', text: 'revision ' + p.revision + ' · ' + new Date(p.updatedAt).toLocaleString() }),
    ].filter(Boolean))));
  }

  /** Close the open project and show the first screen. */
  function goHome() {
    stopPoll();
    state.project = null;
    state.detail = null;
    state.epoch += 1;
    clearPreview();
    $('project-panel').hidden = true;
    history.replaceState(null, '', location.pathname);
    renderProjectList();
    gateActions();
  }

  function renderTypes() {
    document.querySelectorAll('[data-scene-types]').forEach((host) => host.replaceChildren(...TYPES.map((t) => el('button', { type: 'button', 'data-scene-type': t.key, onclick: () => createProject(t) }, [
      el('span', { className: 'scene-type-icon', 'aria-hidden': 'true' }, [sceneIcon(t.icon)]),
      el('span', { className: 'scene-type-label', text: t.label }),
      el('span', { className: 'scene-type-note', text: t.note }),
    ]))));
  }

  async function openProject(projectId) {
    state.epoch += 1;
    const intent = selection();
    stopPoll();
    clearPreview();
    state.filePath = '';
    state.fileBaseline = '';
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
    renderHome();
    gateActions();
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
    if (!preview) {
      clearPreview();
      const first = state.project && state.pendingFirst === state.project.projectId;
      $('preview-info').textContent = first ? 'Rendering the first preview…' : refusedRun() ? 'Previews need execution access.' : 'No preview yet — render one.';
      return;
    }
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
    if (!intent.projectId) { status('Open or create a project first.', 'bad'); return; }
    await act('Rendering the preview', () => renderNow(intent));
  }

  async function renderNow(intent, doneText) {
    const out = await api('POST', '/projects/' + encodeURIComponent(intent.projectId) + '/preview', { samples: Number($('preview-samples').value) });
    if (!current(intent)) return;
    state.project = out.project;
    await showPreview(out.preview);
    status(doneText || 'Preview rendered.', 'ok');
  }

  /** A new project renders its first preview at once, so its viewport never asks for one. */
  async function firstPreview(created) {
    const intent = selection();
    const done = 'Created "' + created.title + '". Ask the Scene Studio director in the chat to build it, or edit it here.';
    if (intent.projectId !== created.projectId) { state.pendingFirst = null; return; }
    if ($('render-preview').disabled) { state.pendingFirst = null; status(done, 'ok'); showPreview(null); return; }
    await act('Rendering the first preview', () => renderNow(intent, done));
    state.pendingFirst = null;
    if (current(intent) && !(state.project && state.project.preview)) $('preview-info').textContent = 'The first preview could not be rendered. Render preview tries again.';
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
    state.fileBaseline = out.binary ? '' : out.text;
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
    const text = $('file-text').value;
    await act('Saving ' + path, async () => {
      const out = await api('PUT', '/projects/' + intent.projectId + '/files', { path, text });
      if (!current(intent)) return;
      state.filePath = path;
      state.fileBaseline = text;
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
      state.fileBaseline = '';
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

  function showNewSheet(show) {
    const sheet = $('new-sheet');
    if (show && !sheet.open) sheet.showModal();
    if (!show && sheet.open) sheet.close();
  }

  /** New: one press makes an untitled project of the chosen type, opens it and renders its first preview. */
  async function createProject(type) {
    showNewSheet(false);
    let created = null;
    await act('Creating the project', async () => {
      const out = await api('POST', '/projects', { kind: type.kind, title: type.title, template: type.template });
      state.pendingFirst = out.project.projectId;
      await loadProjects();
      await openProject(out.project.projectId);
      created = out.project;
    });
    if (created) await firstPreview(created);
    else state.pendingFirst = null;
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
      goHome();
      await loadProjects();
      status('Deleted "' + p.title + '".', 'ok');
    });
  }

  // ── Side by side with the concierge (the shared document handoff) ─────

  /** True when the editor holds text or a path the project does not have yet. */
  function fileDraft() {
    const path = $('file-path').value.trim(), text = $('file-text').value;
    if (!state.project || $('file-text').disabled || !path) return false;
    if (!state.filePath && !text) return false;
    return path !== state.filePath || text !== state.fileBaseline;
  }

  async function settleActions() { while (state.busy && state.acting) await state.acting; }

  /** The saved project's identity and revision: what the assistant is told it is reading. */
  function documentSnapshot(p) {
    return { app: 'scene-studio', screen: 'surface', surface: 'scene-studio', recordId: p.projectId, title: p.title,
      fields: { revision: p.revision, updatedAt: p.updatedAt, kind: p.kind, openFile: state.filePath || null, selection:editorFoundation?.selection()||null, readOnly: false, draft: false } };
  }

  /** Save the editor's unsaved file through the page's own save, then hand over the saved project. */
  async function prepareDocumentHandoff() {
    await editorFoundation?.flushPending();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    await settleActions();
    if (!state.project) { if (!state.listed) await loadProjects(); state.askedWithout = new Set(state.projects.map((p) => p.projectId)); return null; }
    state.askedWithout = null;
    const id = state.project.projectId, path = $('file-path').value.trim();
    if (fileDraft()) {
      await saveFile(); await settleActions();
      if (fileDraft()) throw new Error('Your edit to ' + path + ' could not be saved (' + $('status').textContent + '). It is still in the editor; correct it or save it, then ask again.');
    }
    if (!state.project || state.project.projectId !== id) throw new Error('The open project changed while it was being saved. Ask again from the project you want to edit.');
    return documentSnapshot(state.project);
  }

  /** Re-read the project and the open file; text the person is still editing is kept and the status line says so. */
  async function refreshDocumentHandoff(expected) {
    await settleActions();
    const p = state.project;
    if (!p) return openMadeProject();
    if (expected && expected.recordId && expected.recordId !== p.projectId) return;
    const intent = selection();
    await refreshProject(false);
    if (!current(intent) || !state.filePath) return;
    if (fileDraft()) { status('The project is at revision ' + state.project.revision + '. Your unsaved edit to ' + state.filePath + ' is kept; Save file writes it on top.', 'bad'); return; }
    if ((state.detail.files || []).some((f) => f.path === state.filePath)) await openFile(state.filePath);
  }

  /** After a concierge turn that began with no project open: list the projects again and open the one that turn made. */
  async function openMadeProject() {
    const before = state.askedWithout;
    state.askedWithout = null;
    if (!before) return;
    await loadProjects();
    const made = state.projects.filter((p) => !before.has(p.projectId));
    if (made.length === 1 && !state.project) await openProject(made[0].projectId);
  }

  function registerDocumentHandoff() {
    const reported = (fn) => async (...args) => { try { return await fn(...args); } catch (e) { status(e.message, 'bad'); throw e; } };
    import('/shared/ui/js/document-handoff.js')
      .then(({ registerDocumentSession }) => registerDocumentSession({ app: 'scene-studio', prepare: reported(prepareDocumentHandoff), refresh: reported(refreshDocumentHandoff) }))
      .catch((e) => status('The concierge cannot synchronize this project: ' + e.message, 'bad'));
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
    $('new-project').addEventListener('click', () => showNewSheet(true));
    $('home-new').addEventListener('click', () => showNewSheet(true));
    $('cancel-new').addEventListener('click', () => showNewSheet(false));
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

  let editorFoundation=null;
  async function boot() {
    const {bindSceneFoundation,sceneIcon:icon}=await import('/api/scene-studio/assets/editor-foundation-adapter.mjs');
    sceneIcon=icon;
    editorFoundation=await bindSceneFoundation({state,api,fileDraft,prepare:prepareDocumentHandoff,refresh:async force=>{await refreshProject(force);if(state.filePath&&!fileDraft())await openFile(state.filePath);},undo:async()=>{const previous=(state.detail?.revisions||[]).find(r=>r.revision<state.project?.revision);if(previous)await restore(previous.revision);},notice:text=>status(text,'ok'),problem:error=>status(error.message||String(error),'bad')});
    wire();
    renderTypes();
    gateActions();
    registerDocumentHandoff();
    await loadCapabilities();
    await loadProjects().catch((e) => status(e.message, 'bad'));
    const q = new URLSearchParams(location.search);
    if (q.get('project')) await openProject(q.get('project')).catch((e) => status(e.message, 'bad'));
  }

  // The full studio only: under an audience view the shared kit paints instead (see the head block in scene-studio.html).
  if (!window.AppView || !AppView.active()) document.addEventListener('DOMContentLoaded', boot);
})();
