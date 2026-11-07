/**
 * CHANGE LOG
 * 2026-11-05 | maintainer@emeraldcoastsystemsgroup.com | Show automatic first-use preparation and bounded readiness-only refresh; never retry a model write or claim an untouched engine is connected.
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the studio's behaviour: parts list, the
 *                     |                             | STL viewer + four drawing views + report for the current
 *                     |                             | revision, the ordered feature list (add / edit / disable /
 *                     |                             | move / remove, each a rebuild), a parameter form generated
 *                     |                             | from the contract the server publishes, revision restore
 *                     |                             | (undo), a mesh base upload, the engine-down banner with the
 *                     |                             | install command, and a poll that refreshes the part while the
 *                     |                             | concierge edits it from the chat rail. Every node is built
 *                     |                             | with textContent; every call goes through one `api()` helper.
 *                     |                             | Honours `?artifact=` (ADR-139: an STL sent from elsewhere) and
 *                     |                             | `?scanJob=` (a Scan to Print job's outlines become the base).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Fence model, revision, poll and preview responses to the current selection; clear deleted previews without discarding another part's feature draft.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | revolve / sweep / loft (BACKLOG B1): `path` and loft `sections` are JSON inputs, `pathPlane` a plane
 *                     |                             | select and `ruled` a true/false select, so the generated form can author every new type.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Stop rebuild (BACKLOG B5): every write that rebuilds the part counts as in flight for
 *                     |                             | that part; while one is, the header offers Stop, which POSTs the part's cancel and says
 *                     |                             | which revision the part stays at. The control follows the selected part only.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | A feature's parameters read as one line of words ("depth 10 · diameter 5 · through yes"
 *                     |                             | , a point list as "3 points", a vector as "40 × 20 × 10") instead of
 *                     |                             | the raw JSON object the feature list printed.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Parts that share a name are told apart in the list. Sweep 8: two
 *                     |                             | 'Centre plate (top and bottom) - recon-mini' rows, made a day apart,
 *                     |                             | both read 'r1', and the concierge called them the same model. Each
 *                     |                             | row whose title another row repeats now carries 'made <date>' (and
 *                     |                             | the part's short id when even that repeats). partNotes() is pure and
 *                     |                             | exposed as window.CadStudioParts for tests/part-list-names.test.js.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | Demo sweep 1: the engine-down banner and toasts showed the person the kernel's failure text three times with the host's install command ('on the kernel host run cad-studio/engine/install-engine.sh ...'). They now say the CAD engine is not answering on this installation (banner once, a short toast), never the address or install command; a modelling refusal is still the engine's own sentence.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | Work side by side with the concierge: the open part registers with the shared
 *                     |                             | document handoff. Before an assistant reads, prepare() waits for writes in flight and
 *                     |                             | saves the feature form (add or edit) and an unsaved density through the existing
 *                     |                             | feature and settings routes, then hands over the part id, revision and updated time;
 *                     |                             | refresh() re-reads the part and redraws it when it is newer. A density the person is
 *                     |                             | still typing survives any redraw (the 3 s poll too) and the toast says the draft is kept.
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | 0.4.0, the design standard (kernel docs/ux/design-standard.md; Roger, 2026-11-06, F9, F10, F12; the reference products Shapr3D, Onshape and Tinkercad, CONVENTIONS.md §5.9). No native prompt or confirm (DS-30): New part opens a ready "Untitled part" on a 60 × 40 × 30 mm base box at once (its sizes are edited in Properties), the name is edited in place in the part's heading (Rename puts the caret there), and Delete and restoring a revision ask in an in-page sheet. The empty canvas shows New part as its one centred first action instead of a create-or-open paragraph; a part's app row is the Part ▾ menu (New part, Rename, Rebuild, Delete part; ⋯ More on a phone) and Export, the finishing action, which opens its own sheet of the part's files (STEP, STL, the drawing views, the report) with one Export at its bottom. Under the canvas a tool strip holds Add feature and Report; the reference functions CAD Studio lacks are greyed "Not available yet" controls in their places: Measure in the strip, the view cube in the canvas's top-right corner, AR on its right edge, OBJ, 3MF and Send to printer in the Export sheet (DS-45, RP-CAD-01 to -05).
 * 10 | maintainer@emeraldcoastsystemsgroup.com  | 0.5.0: live Measure (mm/in), 7-orientation 3D View Cube + Fit to view, Wavefront OBJ + MTL and 3MF exports, View in AR (USDZ + GLB + QR), and honest Send to printer handoff with zero planned placeholders remaining (RP-CAD-01 to -05).
 */
(function () {
  'use strict';
  const BASE = '/api/cad-studio';
  const $ = (id) => document.getElementById(id);
  const ENGINE_DOWN = 'The CAD engine is not answering on this installation, so parts cannot be built right now. Try again shortly.';
  const ENGINE_SHORT = 'The CAD engine is not answering on this installation.';
  const state = { models: [], model: null, revisions: [], caps: null, viewer: null, editing: null, lastSeen: '', pollTimer: null, selection: 0, listRequest: 0, previewRequest: 0, building: {}, writes: new Set(), densityShown: null, editBaseline: '' };

  /** Capture user selection without reconstructing or changing server authority. */
  const selection = () => ({ epoch: state.selection, modelId: state.model && state.model.model_id });
  const selected = (intent) => intent.epoch === state.selection;
  const olderModel = (model) => state.model && model.model_id === state.model.model_id &&
    (model.revision < state.model.revision || Date.parse(model.updated_at) < Date.parse(state.model.updated_at));

  /** Retire the old geometry and its pending bytes before another selection or deletion. */
  function clearPreview() {
    state.previewRequest += 1;
    if (state.viewer) state.viewer.clear();
    $('viewer-info').textContent = '';
  }

  /** Begin an explicit part selection; same-part background refresh never resets the draft form. */
  function clearSelection() {
    state.selection += 1; stopPoll(); clearPreview();
    state.model = null; state.revisions = []; state.lastSeen = ''; state.densityShown = null;
    $('model-panel').hidden = true; $('features-panel').hidden = true; $('empty-panel').hidden = false;
    $('feature-submit').disabled = false; $('header-title').textContent = ''; renderPartControls(false);
    endEdit(); renderStop();
    return selection();
  }

  /** Count rebuild-triggering writes per part; Stop is offered only for the selected part's. */
  function trackRebuild(modelId, delta) { state.building[modelId] = Math.max(0, (state.building[modelId] || 0) + delta); renderStop(); }
  function renderStop() { $('cancel-rebuild').hidden = !(state.model && (state.building[state.model.model_id] || 0) > 0); }

  /** Every call to the package's routes; a write stays in `state.writes` until it settles, so a handoff can wait for it. */
  function api(path, opts) {
    const call = send(path, opts);
    if (opts && opts.method && opts.method !== 'GET') { const settle = () => state.writes.delete(call); state.writes.add(call); call.then(settle, settle); }
    return call;
  }
  async function send(path, opts) {
    const init = Object.assign({ credentials: 'same-origin', headers: {} }, opts || {});
    const rebuilds = init.rebuilds; delete init.rebuilds;
    if (init.json !== undefined) { init.body = JSON.stringify(init.json); init.headers['Content-Type'] = 'application/json'; delete init.json; }
    if (rebuilds) trackRebuild(rebuilds, 1);
    try {
      const res = await fetch(BASE + path, init);
      const text = await res.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch (_) { body = { raw: text }; }
      if (!res.ok) { const err = new Error((body && (body.message || (body.build && buildWords(body.build)) || body.error)) || ('HTTP ' + res.status)); err.status = res.status; err.body = body; throw err; }
      return body;
    } finally { if (rebuilds) trackRebuild(rebuilds, -1); }
  }
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (k === 'class') node.className = v; else if (k === 'text') node.textContent = v; else if (k.startsWith('on')) node.addEventListener(k.slice(2), v); else node.setAttribute(k, v); });
    (children || []).forEach((c) => node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return node;
  }
  function toast(message, kind) {
    const t = $('toast');
    t.textContent = message; t.className = 'toast ' + (kind || 'info'); t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 6000);
  }
  const fmt = (v, d) => (Number.isFinite(Number(v)) ? Number(v).toFixed(d === undefined ? 1 : d) : '—');

  // ── Engine status ──────────────────────────────────────────────────────────
  let enginePoll = null;
  let enginePollUntil = 0;
  let enginePollStopped = false;
  function stopEnginePoll() { enginePollStopped = true; clearTimeout(enginePoll); enginePoll = null; enginePollUntil = 0; }
  async function refreshEngine() {
    if (enginePollStopped) return;
    try {
      const caps = await api('/capabilities');
      if (enginePollStopped) return;
      state.caps = caps;
      renderEngine(caps.engine);
    } catch (_) {
      if (enginePollStopped) return;
      clearTimeout(enginePoll); enginePoll = null; enginePollUntil = 0;
      $('engine-pill').textContent = 'Readiness unavailable';
      $('engine-pill').className = 'badge failed';
      $('engine-banner').hidden = false;
      $('engine-reason').textContent = 'Engine readiness is unavailable. Refresh to try again.';
    }
  }
  function renderEngine(engine) {
    if (!engine) return;
    const lifecycle = engine.lifecycle;
    const phase = lifecycle && lifecycle.state;
    const preparing = phase === 'not-prepared' || phase === 'preparing';
    const failed = phase === 'failed' || phase === 'none';
    const transportError = engine.lastError && (!phase || phase === 'pinned');
    const pill = $('engine-pill');
    const labels = { 'not-prepared': 'Preparing engine…', preparing: 'Downloading engine…', ready: 'Ready', running: 'Running', failed: 'Preparation failed', none: 'Unavailable', pinned: 'Ready to connect' };
    const pillText = phase ? labels[phase] : (engine.connected ? 'Connected' : engine.lastError ? 'Connection unavailable' : 'Not contacted');
    const pillClass = 'badge ' + (engine.connected || phase === 'ready' || phase === 'running' ? 'built' : failed || transportError ? 'failed' : '');
    // The 3 s poll redraws this pill: write only what changed, so an unchanged engine leaves the page untouched.
    if (pill.textContent !== pillText) pill.textContent = pillText;
    if (pill.className !== pillClass) pill.className = pillClass;
    $('engine-banner').hidden = !(preparing || failed || transportError);
    let message = preparing ? 'The engine is being prepared automatically. You can keep editing while it downloads.' : failed ? 'The engine could not be prepared. Try again shortly.' : transportError ? ENGINE_DOWN : '';
    if (preparing && Number.isSafeInteger(lifecycle.doneBytes) && Number.isSafeInteger(lifecycle.totalBytes) && lifecycle.totalBytes > 0) message += ' ' + Math.min(100, Math.floor(100 * lifecycle.doneBytes / lifecycle.totalBytes)) + '% downloaded.';
    if ($('engine-reason').textContent !== message) $('engine-reason').textContent = message;
    clearTimeout(enginePoll); enginePoll = null;
    if (preparing && !enginePollStopped) {
      if (!enginePollUntil) enginePollUntil = Date.now() + 600000;
      if (Date.now() < enginePollUntil) enginePoll = setTimeout(refreshEngine, 2000);
      else $('engine-reason').textContent = 'The engine is still being prepared. Refresh to check again.';
    } else enginePollUntil = 0;
  }

  /** A person's words for a failed build: an engine that is not answering is one plain sentence (never the
   * kernel's address or the host's install command); any other refusal is the engine's own sentence. */
  function buildWords(build) {
    return build.code === 'capability_unavailable' ? ENGINE_SHORT : (build.reason || build.error || build.code);
  }
  function showBuild(build) {
    if (!build) return;
    if (build.ok) return;
    if (build.code === 'capability_unavailable' || build.code === 'engine_busy' || build.code === 'engine_timeout') { renderEngine({ connected: false, lastError: buildWords(build) }); void refreshEngine(); }
    toast('Rebuild failed: ' + buildWords(build), 'error');
  }

  // ── Models ─────────────────────────────────────────────────────────────────
  /**
   * The note that tells apart parts sharing a title: '' for a unique title, else 'made <date>', plus the part's short
   * id when two same-named parts were also made in the same minute.
   */
  function partNotes(models) {
    const key = (t) => String(t || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const made = (m) => { const t = Date.parse(m.created_at); return Number.isFinite(t) ? 'made ' + new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'made at an unknown time'; };
    const count = (list, f) => list.reduce((acc, m) => acc.set(f(m), (acc.get(f(m)) || 0) + 1), new Map());
    const byTitle = count(models, (m) => key(m.title));
    const notes = models.map((m) => (byTitle.get(key(m.title)) > 1 ? made(m) : ''));
    const byNote = count(models.map((m, i) => ({ m, i })), (x) => key(x.m.title) + '|' + notes[x.i]);
    return notes.map((n, i) => (n && byNote.get(key(models[i].title) + '|' + n) > 1 ? n + ' · #' + String(models[i].model_id || '').slice(0, 8) : n));
  }
  window.CadStudioParts = { partNotes };
  async function loadModels() {
    const request = ++state.listRequest, out = await api('/models');
    if (request !== state.listRequest) return;
    state.models = out.models;
    const list = $('model-list');
    list.replaceChildren();
    if (!state.models.length) list.appendChild(el('p', { class: 'muted small', text: 'No parts yet.' }));
    const notes = partNotes(state.models);
    state.models.forEach((m, i) => list.appendChild(el('button', { class: 'model-item' + (state.model && state.model.model_id === m.model_id ? ' active' : ''), onclick: () => openModel(m.model_id) }, [
      el('span', { class: 'model-name' }, [el('span', { class: 'model-title', text: m.title })].concat(notes[i] ? [el('span', { class: 'model-note', text: notes[i] })] : [])),
      el('span', { class: 'badge ' + m.state, text: 'r' + m.revision }),
    ])));
  }
  async function openModel(modelId) {
    const intent = clearSelection();
    try {
      const out = await api('/models/' + modelId);
      if (!selected(intent) || !out.model || out.model.model_id !== modelId) return;
      state.model = out.model; state.revisions = out.revisions || [];
      renderEngine(out.engine); renderModel(); startPoll();
      await loadModels();
    } catch (e) { if (selected(intent)) toast(e.message, 'error'); }
  }
  function applyResponse(out, intent, newPart) {
    if (!selected(intent) || !out || !out.model || olderModel(out.model)) return false;
    if (!newPart && out.model.model_id !== intent.modelId) return false;
    if (newPart) { clearSelection(); intent.epoch = state.selection; intent.modelId = out.model.model_id; }
    state.model = out.model; state.lastSeen = out.model.updated_at;
    renderModel(); loadModels().catch(() => {}); refreshRevisions().catch(() => {});
    if (out && out.build) showBuild(out.build);
    return true;
  }
  async function refreshRevisions() {
    if (!state.model) return;
    const intent = selection(), model = state.model;
    const out = await api('/models/' + model.model_id);
    if (!selected(intent) || state.model !== model || out.model.model_id !== model.model_id || out.model.revision !== model.revision || olderModel(out.model)) return;
    state.revisions = out.revisions || []; renderEngine(out.engine); renderRevisions();
  }
  /** The base box a new part starts from, in mm; the person changes it in Properties once the part is open. */
  const NEW_PART = { title: 'Untitled part', base: { kind: 'box', sizeX: 60, sizeY: 40, sizeZ: 30 } };
  /** New part opens a ready part at once: no prompt (DS-30); its name is edited in place and its base in Properties. */
  async function createModel() {
    const intent = selection();
    try {
      const out = await api('/models', { method: 'POST', json: { title: NEW_PART.title, base: Object.assign({}, NEW_PART.base) } });
      if (!applyResponse(out, intent, true)) return;
      await loadModels(); if (!selected(intent)) return;
      startPoll(); // the part opening on the canvas is the confirmation; no toast (§4.8)
    } catch (e) { if (!selected(intent)) return; if (e.body && e.body.model) applyResponse(e.body, intent, true); if (e.body && e.body.build) showBuild(e.body.build); else toast(e.message, 'error'); }
  }
  /** Rename puts the caret in the part's heading, where the name is edited in place (no prompt). */
  function startRename() {
    const heading = $('model-heading'); if (!state.model) return;
    heading.focus();
    const range = document.createRange(); range.selectNodeContents(heading);
    const pick = window.getSelection(); pick.removeAllRanges(); pick.addRange(range);
  }
  /** The heading lost focus: save the name it now holds, or put back the saved one when it is empty. */
  async function renameModel() {
    if (!state.model) return;
    const intent = selection(), title = $('model-heading').textContent.trim().slice(0, 120);
    if (!title || title === state.model.title) { $('model-heading').textContent = state.model.title; return; }
    try { applyResponse(await api('/models/' + intent.modelId, { method: 'PATCH', json: { title } }), intent); } catch (e) { if (selected(intent)) { $('model-heading').textContent = state.model.title; toast(e.message, 'error'); } }
  }
  async function deleteModel() {
    if (!state.model || !(await ask('Delete "' + state.model.title + '" and every revision?', { yes: 'Delete', danger: true }))) return;
    const model = state.model, revisions = state.revisions, intent = clearSelection();
    try { await api('/models/' + model.model_id, { method: 'DELETE' }); await loadModels(); }
    catch (e) { if (selected(intent)) { state.model = model; state.revisions = revisions; renderModel(); startPoll(); toast(e.message, 'error'); } }
  }
  async function rebuildModel() {
    if (!state.model) return;
    const intent = selection();
    try { toast('Rebuilding…'); const out = await api('/models/' + intent.modelId + '/rebuild', { method: 'POST', rebuilds: intent.modelId }); if (applyResponse(out, intent) && out.build.ok) toast('Rebuilt in ' + out.build.ms + ' ms.', 'ok'); }
    catch (e) { if (!selected(intent)) return; if (e.body && e.body.model) applyResponse(e.body, intent); else toast(e.message, 'error'); }
  }

  // ── Rendering ──────────────────────────────────────────────────────────────
  function renderModel() {
    const m = state.model;
    $('empty-panel').hidden = true; $('model-panel').hidden = false; $('features-panel').hidden = false;
    if (document.activeElement !== $('model-heading')) $('model-heading').textContent = m.title;
    $('model-heading').contentEditable = 'plaintext-only'; $('header-title').textContent = m.title; renderPartControls(true); renderExport(m);
    $('model-state').textContent = m.state + ' · revision ' + m.revision; $('model-state').className = 'badge ' + m.state;
    $('model-source').textContent = m.source && m.source.kind === 'scan' ? 'from Scan to Print job "' + (m.source.title || m.source.jobId) + '"' : '';
    if (m.state === 'failed' && m.failure_reason) toast(m.failure_reason, 'error');
    renderBase(m); renderReport(m); renderViews(m); renderFeatures(m); renderRevisions(); renderStop();editorFoundation?.refresh();
    if (m.artifacts && m.artifacts.stl) loadStl(m); else clearPreview();
    const density = (m.settings && m.settings.densityGcm3) || (state.caps && state.caps.defaults.densityGcm3) || 1.24;
    if (!densityDirty()) $('density').value = density;
    state.densityShown = { id: m.model_id, value: Number(density) };
  }
  function renderBase(m) {
    const b = m.base || {};
    const text = b.kind === 'box' ? 'box ' + b.sizeX + ' × ' + b.sizeY + ' × ' + b.sizeZ + ' mm'
      : b.kind === 'cylinder' ? 'cylinder ⌀' + b.diameter + ' × ' + b.height + ' mm'
      : b.kind === 'sketch' ? 'sketch on ' + b.plane + ', ' + (b.points || []).length + ' points, extruded ' + b.height + ' mm'
      : b.kind === 'contours' ? 'scan outlines (' + Object.keys(b.views || {}).join(', ') + ') — the visual hull as a solid'
      : b.kind === 'mesh' ? 'mesh ' + (b.bytes ? Math.round(b.bytes / 1024) + ' KB' : '') + ' (sha256 ' + String(b.sha256 || '').slice(0, 12) + ')' : String(b.kind);
    $('base-summary').textContent = text;
  }
  function renderReport(m) {
    const card = $('report'); card.replaceChildren();
    const r = m.report;
    if (!r) { card.appendChild(el('p', { class: 'muted', text: m.failure_reason || 'Not built yet.' })); $('downloads').replaceChildren(); return; }
    const size = r.extentsMm && r.extentsMm.size ? r.extentsMm.size : [0, 0, 0];
    const rows = [
      ['Extents (X × Y × Z)', fmt(size[0]) + ' × ' + fmt(size[1]) + ' × ' + fmt(size[2]) + ' mm'],
      ['Volume', fmt(r.volumeMm3 / 1000, 2) + ' cm³ · surface ' + fmt(r.surfaceAreaMm2 / 100, 1) + ' cm²'],
      ['Mass', fmt(r.massG, 1) + ' g at ' + fmt(r.densityGcm3, 2) + ' g/cm³'],
      ['Topology', r.faces + ' faces · ' + r.edges + ' edges · ' + r.vertices + ' vertices · ' + (r.valid ? 'valid solid' : 'INVALID')],
      ['Centre of mass', (r.centerOfMassMm || []).map((v) => fmt(v)).join(', ') + ' mm'],
    ];
    card.appendChild(el('dl', {}, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])));
    if (m.failure_reason) card.appendChild(el('p', { class: 'feature-error', text: 'Last rebuild failed: ' + m.failure_reason + ' (showing revision ' + m.revision + ')' }));
    const links = $('downloads'); links.replaceChildren();
    ['step', 'stl', 'obj', '3mf', 'svg-front', 'svg-top', 'svg-right', 'svg-iso', 'report'].forEach((k) => { const u = exportUrl(m, k); if (u) links.appendChild(el('a', { href: u + '&download', text: k.toUpperCase() })); });
  }
  function renderViews(m) {
    const wrap = $('views'); wrap.replaceChildren();
    if (!m.artifacts) return;
    ['front', 'top', 'right', 'iso'].forEach((v) => { const url = m.artifacts['svg-' + v]; if (url) wrap.appendChild(el('figure', {}, [el('img', { src: url + '&t=' + Date.parse(m.updated_at), alt: v + ' view' }), el('figcaption', { text: v.toUpperCase() })])); });
  }
  async function loadStl(m) {
    clearPreview();
    const intent = selection(), request = state.previewRequest;
    const current = () => selected(intent) && state.model === m && state.previewRequest === request;
    $('viewer-info').textContent = 'Loading preview…';
    try {
      if (!state.viewer) { state.viewer = (window.CadStudioGl || window.CadStudioViewer).mount($('viewer')); viewportTools?.attachViewer(state.viewer); }
      const res = await fetch(m.artifacts.stl, { credentials: 'same-origin' });
      if (!current()) return;
      if (!res.ok) throw new Error('STL fetch failed');
      const bytes = await res.arrayBuffer();
      if (!current()) return;
      const info = state.viewer.load(bytes);
      viewportTools?.onModelLoaded();
      $('viewer-info').textContent = info.triangles + ' facets · ' + fmt(info.size[0]) + ' × ' + fmt(info.size[1]) + ' × ' + fmt(info.size[2]) + ' mm · revision ' + m.revision;
    } catch (e) { if (current()) $('viewer-info').textContent = e.message; }
  }
  /** A parameter name as words: `pathPlane` -> "path plane", `size_mm` -> "size mm". */
  function words(name) { return String(name).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(); }
  /** One parameter value in plain terms: a point list counts its points, a vector reads x × y × z. */
  function valueText(v) {
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
    if (Array.isArray(v)) {
      if (v.length && v.every(Array.isArray)) return v.length + (v.length === 1 ? ' point' : ' points');
      if (v.every((n) => typeof n === 'number')) return v.map(valueText).join(' × ');
      return v.length + (v.length === 1 ? ' item' : ' items');
    }
    if (v && typeof v === 'object') return Object.keys(v).map((k) => words(k) + ' ' + valueText(v[k])).join(', ');
    return v === null || v === undefined || v === '' ? '—' : String(v);
  }
  /** A feature's parameters as one readable line, never raw JSON. */
  function paramsText(params) {
    const keys = params && typeof params === 'object' ? Object.keys(params) : [];
    return keys.length ? keys.map((k) => words(k) + ' ' + valueText(params[k])).join(' · ') : 'no parameters';
  }
  function statusOf(m, id) { return ((m.feature_status || []).find((s) => s.id === id)) || null; }
  function renderFeatures(m) {
    const list = $('feature-list'); list.replaceChildren();
    if (!m.features.length) list.appendChild(el('li', { class: 'muted small', text: 'No features yet — add one below or ask the designer in the chat.' }));
    m.features.forEach((f, i) => {
      const st = statusOf(m, f.id);
      const failed = st && st.ok === false;
      const item = el('li', { class: (failed ? 'failed ' : '') + (f.enabled ? '' : 'disabled ') + (state.editing === f.id ? 'selected' : '') }, [
        el('div', { class: 'feature-head' }, [
          el('button', { class: 'cad-feature-selection', text: String(i + 1)+'. '+f.type+(f.label?' — '+f.label:''), 'aria-pressed': String(state.editing===f.id), onclick: () => {if(featureDraft()&&state.editing!==f.id)return toast('Save or cancel your feature form first.','error');if(!featureDraft())beginEdit(f);} }),
          el('details', { class: 'cad-feature-menu' }, [el('summary', {text:'Actions'}),
            el('button', {text:'Move earlier',onclick:()=>moveFeature(f.id,i-1)}),el('button',{text:'Move later',onclick:()=>moveFeature(f.id,i+1)}),
            el('button',{text:'Native parameter form',onclick:()=>{beginEdit(f);editorFoundation?.showFeatureForm();}}),
            el('button',{text:f.enabled?'Disable':'Enable',onclick:()=>updateFeature(f.id,{enabled:!f.enabled})}),el('button',{text:'Remove feature',onclick:()=>removeFeature(f.id)})]),
        ]),
        el('div', { class: 'feature-params', text: paramsText(f.params) }),
      ]);
      if (failed) item.appendChild(el('div', { class: 'feature-error', text: 'skipped: ' + st.error }));
      list.appendChild(item);
    });
  }
  function renderRevisions() {
    const list = $('revisions'); list.replaceChildren();
    state.revisions.forEach((r) => list.appendChild(el('li', {}, [
      el('span', { text: 'r' + r.revision + ' · ' + new Date(r.created_at).toLocaleString() + ' · ' + r.featureCount + ' features · ' + (r.volumeMm3 !== null && r.volumeMm3 !== undefined ? fmt(Number(r.volumeMm3) / 1000, 2) + ' cm³' : '') }),
      el('span', { class: 'spacer', style: 'flex:1' }),
      state.model && r.revision !== state.model.revision ? el('button', { class: 'link', text: 'restore', onclick: () => restoreRevision(r.revision) }) : el('span', { class: 'muted', text: 'current' }),
    ])));
  }

  // ── Feature editing ────────────────────────────────────────────────────────
  function specFor(type) { return state.caps && state.caps.contract.features[type]; }
  /** Parameters typed as JSON (lists and objects), with the shape the contract expects as the hint. */
  const JSON_PLACEHOLDERS = { points: '[[0,0],[30,0],[0,30]]', path: '[[0,0],[0,40],[30,40]]', size: '[x, y, z]', center: '[x, y, z]',
    sections: '[{"points":[[-10,-10],[10,-10],[10,10],[-10,10]],"offset":20},{"points":[[-5,-5],[5,-5],[5,5],[-5,5]],"offset":50}]' };
  const BOOLEAN_PARAMS = new Set(['through', 'ruled']);
  function renderTypeOptions() {
    const sel = $('feature-type'); sel.replaceChildren();
    Object.keys((state.caps && state.caps.contract.features) || {}).forEach((t) => sel.appendChild(el('option', { value: t, text: t })));
    renderParamsForm({});
  }
  function fieldFor(name, doc, value) {
    const enumMatch = /one of|\(default '([^']+)'\)/.test(doc) ? doc : null;
    const selectors = { edges: state.caps.contract.edgeSelectors, openFace: state.caps.contract.faceSelectors, axis: state.caps.contract.axes, plane: state.caps.contract.planes, pathPlane: state.caps.contract.planes, keep: ['below', 'above'], mode: ['add', 'cut'] };
    if (selectors[name]) { const s = el('select', { 'data-param': name }, [el('option', { value: '', text: '(default)' })].concat(selectors[name].map((v) => el('option', { value: v, text: v })))); if (value !== undefined) s.value = String(value); return s; }
    if (BOOLEAN_PARAMS.has(name)) { const s = el('select', { 'data-param': name }, [el('option', { value: '', text: '(default)' }), el('option', { value: 'true', text: 'true' }), el('option', { value: 'false', text: 'false' })]); if (value !== undefined) s.value = String(value); return s; }
    if (JSON_PLACEHOLDERS[name]) return el('input', { type: 'text', 'data-param': name, 'data-json': '1', placeholder: JSON_PLACEHOLDERS[name], value: value !== undefined ? JSON.stringify(value) : '', style: 'width:220px' });
    void enumMatch;
    return el('input', { type: 'number', step: 'any', 'data-param': name, value: value !== undefined ? String(value) : '' });
  }
  function renderParamsForm(values) {
    const type = $('feature-type').value;
    const spec = specFor(type);
    const form = $('params-form'); form.replaceChildren();
    $('feature-doc').textContent = spec ? spec.doc : '';
    if (!spec) return;
    [['required', spec.required], ['optional', spec.optional]].forEach(([group, params]) => Object.entries(params).forEach(([name, doc]) => {
      form.appendChild(el('label', { text: name + (group === 'required' ? ' *' : '') }));
      form.appendChild(fieldFor(name, doc, values[name]));
      form.appendChild(el('div', { class: 'doc', text: doc }));
    }));
  }
  function readParams() {
    const params = {};
    $('params-form').querySelectorAll('[data-param]').forEach((node) => {
      const name = node.getAttribute('data-param'); const raw = node.value;
      if (raw === '' || raw === undefined) return;
      if (node.getAttribute('data-json')) { params[name] = JSON.parse(raw); return; }
      if (BOOLEAN_PARAMS.has(name)) { params[name] = raw === 'true'; return; }
      params[name] = node.tagName === 'SELECT' ? raw : Number(raw);
    });
    return params;
  }
  function beginEdit(f) {
    state.editing = f.id; $('feature-type').value = f.type; renderParamsForm(f.params); $('feature-label').value = f.label || '';
    $('feature-submit').textContent = 'Save feature'; $('feature-cancel').hidden = false; renderFeatures(state.model);
    state.editBaseline = featureFormState();editorFoundation?.refresh();
  }
  function endEdit() { state.editing = null; state.editBaseline = ''; $('feature-submit').textContent = 'Add feature'; $('feature-cancel').hidden = true; $('feature-label').value = ''; renderParamsForm({}); if (state.model) renderFeatures(state.model);else{$('feature-list').replaceChildren();$('revisions').replaceChildren();}editorFoundation?.refresh(); }
  /** Keep newer manual input when an earlier submitted feature finishes rebuilding. */
  function featureFormState() {
    return JSON.stringify({ editing: state.editing, type: $('feature-type').value, label: $('feature-label').value,
      params: Array.from($('params-form').querySelectorAll('[data-param]'), node => [node.getAttribute('data-param'), node.value]) });
  }
  async function submitFeature() {
    if (!state.model) return;
    const intent = selection();
    let params;
    try { params = readParams(); } catch (e) { toast('Parameters must be valid JSON: ' + e.message, 'error'); return; }
    const body = { type: $('feature-type').value, params, label: $('feature-label').value || undefined };
    const submittedForm = featureFormState();
    $('feature-submit').disabled = true;
    try {
      const out = state.editing
        ? await api('/models/' + state.model.model_id + '/features/' + state.editing, { method: 'PATCH', json: Object.assign({ merge: false }, body), rebuilds: intent.modelId })
        : await api('/models/' + state.model.model_id + '/features', { method: 'POST', json: body, rebuilds: intent.modelId });
      if (!applyResponse(out, intent)) return;
      const st = out.feature && statusOf(out.model, out.feature.id);
      if (st && st.ok === false) toast('The kernel refused this feature: ' + st.error, 'error'); else if (out.build.ok) toast('Rebuilt in ' + out.build.ms + ' ms.', 'ok');
      if (featureFormState() === submittedForm) endEdit();
    } catch (e) { if (!selected(intent)) return; if (e.body && e.body.model) applyResponse(e.body, intent); toast(e.message + (e.body && e.body.field ? ' (' + e.body.field + ')' : ''), 'error'); }
    finally { if (selected(intent)) $('feature-submit').disabled = false; }
  }
  async function updateFeature(id, patch) {
    if (!state.model) return; const intent = selection();
    try { applyResponse(await api('/models/' + intent.modelId + '/features/' + id, { method: 'PATCH', json: patch, rebuilds: intent.modelId }), intent); } catch (e) { if (!selected(intent)) return; if (e.body && e.body.model) applyResponse(e.body, intent); toast(e.message, 'error'); }
  }
  async function removeFeature(id) {
    if (!state.model) return; const intent = selection();
    try { if (applyResponse(await api('/models/' + intent.modelId + '/features/' + id, { method: 'DELETE', rebuilds: intent.modelId }), intent) && state.editing === id) endEdit(); } catch (e) { if (!selected(intent)) return; if (e.body && e.body.model) applyResponse(e.body, intent); toast(e.message, 'error'); }
  }
  async function moveFeature(id, to) {
    if (!state.model || to < 0 || to >= state.model.features.length) return;
    const intent = selection();
    try { applyResponse(await api('/models/' + intent.modelId + '/features/' + id + '/move', { method: 'POST', json: { to }, rebuilds: intent.modelId }), intent); } catch (e) { if (!selected(intent)) return; if (e.body && e.body.model) applyResponse(e.body, intent); toast(e.message, 'error'); }
  }
  async function restoreRevision(revision) {
    if (!state.model) return; const intent = selection();
    if (!(await ask('Restore the feature list of revision ' + revision + '? This creates a new revision; nothing is lost.', { yes: 'Restore' }))) return;
    try { if (applyResponse(await api('/models/' + intent.modelId + '/restore', { method: 'POST', json: { revision }, rebuilds: intent.modelId }), intent)) toast('Restored revision ' + revision + '.', 'ok'); } catch (e) { if (!selected(intent)) return; if (e.body && e.body.model) applyResponse(e.body, intent); toast(e.message, 'error'); }
  }
  async function uploadMesh(file) {
    if (!file || !state.model) return;
    const intent = selection();
    const form = new FormData(); form.append('stl', file, file.name);
    try { toast('Sewing the mesh into a solid…'); applyResponse(await api('/models/' + intent.modelId + '/base/mesh', { method: 'POST', body: form, rebuilds: intent.modelId }), intent); } catch (e) { if (!selected(intent)) return; if (e.body && e.body.model) applyResponse(e.body, intent); toast(e.message, 'error'); }
  }
  async function saveSettings() {
    if (!state.model) return;
    const intent = selection();
    try { applyResponse(await api('/models/' + intent.modelId, { method: 'PATCH', json: { settings: { densityGcm3: Number($('density').value) } }, rebuilds: intent.modelId }), intent); } catch (e) { if (selected(intent)) toast(e.message, 'error'); }
  }

  /** Stop the selected part's running rebuild; the server keeps the part at its last good revision. */
  async function cancelRebuild() {
    if (!state.model) return;
    const intent = selection(), button = $('cancel-rebuild');
    button.disabled = true;
    try {
      const out = await api('/models/' + intent.modelId + '/cancel', { method: 'POST' });
      if (selected(intent)) toast(out.cancelled ? 'Rebuild stopped — the part stays at revision ' + out.lastGoodRevision + '.' : 'Nothing was rebuilding.', out.cancelled ? 'ok' : 'info');
    } catch (e) { if (selected(intent)) toast(e.message, 'error'); }
    finally { button.disabled = false; }
  }

  // ── Live refresh while the concierge edits from the chat rail ──────────────
  // A redraw or a request under a pressing finger can lose the press (the review of kernel PR #183, B1): the poll skips a
  // tick while a press is in progress and for 1.5 s after it. Registered on the window's capture phase from the start, so
  // it also sees presses that a planned control keeps from the page's own handlers.
  let pressedUntil = 0;
  if (typeof window.addEventListener === 'function') window.addEventListener('pointerdown', () => { pressedUntil = Date.now() + 1500; }, true);
  function startPoll() {
    stopPoll();
    state.lastSeen = state.model ? state.model.updated_at : '';
    state.pollTimer = setInterval(async () => {
      if (!state.model || document.hidden || Date.now() < pressedUntil) return;
      const intent = selection(), model = state.model;
      try {
        const out = await api('/models/' + model.model_id);
        if (!selected(intent) || state.model !== model || out.model.model_id !== model.model_id || olderModel(out.model)) return;
        if (out.model.updated_at !== state.lastSeen) { state.lastSeen = out.model.updated_at; state.model = out.model; state.revisions = out.revisions || []; renderModel(); loadModels().catch(() => {}); }
        renderEngine(out.engine);
      } catch (_) { /* transient */ }
    }, 3000);
  }
  function stopPoll() { if (state.pollTimer) clearInterval(state.pollTimer); state.pollTimer = null; }

  // ── Side by side with the concierge (the shared document handoff) ─────────
  /** True when the feature form holds input the part does not have yet: a changed edit, or any value for a new feature. */
  function featureDraft() {
    if (!state.model) return false;
    if (state.editing) return featureFormState() !== state.editBaseline;
    return $('feature-label').value !== '' || Array.from($('params-form').querySelectorAll('[data-param]')).some((node) => node.value !== '');
  }
  /** True when the density field differs from the value last drawn for this part. */
  function densityDirty() {
    const shown = state.densityShown;
    return Boolean(shown && state.model && shown.id === state.model.model_id && Number($('density').value) !== shown.value);
  }
  async function settleWrites() { while (state.writes.size) await Promise.allSettled(Array.from(state.writes)); }
  const newerModel = (a, b) => a.revision > b.revision || Date.parse(a.updated_at) > Date.parse(b.updated_at);
  const draftWords = () => [featureDraft() ? 'feature in the editor' : '', densityDirty() ? 'density' : ''].filter(Boolean).join(' and ');
  /** The saved part's identity and revision: what the assistant is told it is reading. */
  function documentSnapshot(m) {
    return { app: 'cad-studio', screen: 'surface', surface: 'cad-studio', recordId: m.model_id, title: String(m.title).slice(0, 200),
      fields: { revision: m.revision, updatedAt: m.updated_at, state: m.state, featureCount: m.features.length, selectedFeature:state.editing||null, readOnly: false, draft: false } };
  }
  /** Save every unsaved change through the page's own save paths, then hand over the saved part. */
  async function prepareDocumentHandoff() {
    await editorFoundation?.flushPending();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    await settleWrites();
    if (!state.model) return null;
    const id = state.model.model_id;
    const unsaved = (what) => new Error('The ' + what + ' you are editing could not be saved (' + $('toast').textContent + '). It is still on the page; correct or clear it, then ask again.');
    if (featureDraft()) { await submitFeature(); await settleWrites(); if (featureDraft()) throw unsaved('feature'); }
    if (densityDirty()) { await saveSettings(); await settleWrites(); if (densityDirty()) throw unsaved('density'); }
    if (!state.model || state.model.model_id !== id) throw new Error('The open part changed while it was being saved. Ask again from the part you want to edit.');
    return documentSnapshot(state.model);
  }
  /** Re-read the handed-over part and redraw it when it is newer, keeping any field the person is still editing. */
  async function refreshDocumentHandoff(expected) {
    await settleWrites();
    const model = state.model;
    if (!model || (expected && expected.recordId && expected.recordId !== model.model_id)) return;
    const intent = selection(), out = await api('/models/' + model.model_id);
    if (!selected(intent) || !state.model || out.model.model_id !== state.model.model_id || !newerModel(out.model, state.model)) return;
    state.model = out.model; state.revisions = out.revisions || []; state.lastSeen = out.model.updated_at;
    renderEngine(out.engine); renderModel(); loadModels().catch(() => {});
    if (draftWords()) toast('Revision ' + out.model.revision + ' from the concierge is shown. Your unsaved ' + draftWords() + ' is kept; save it to apply it on top.', 'info');
  }
  function registerDocumentHandoff() {
    const reported = (fn) => async (...args) => { try { return await fn(...args); } catch (e) { toast(e.message, 'error'); throw e; } };
    import('/shared/ui/js/document-handoff.js')
      .then(({ registerDocumentSession }) => registerDocumentSession({ app: 'cad-studio', prepare: reported(prepareDocumentHandoff), refresh: reported(refreshDocumentHandoff) }))
      .catch((e) => toast('The concierge cannot synchronize this part: ' + e.message, 'error'));
  }

  // ── Entry points from elsewhere ────────────────────────────────────────────
  async function intakeArtifact(ref) {
    const intent = selection();
    try {
      const res = await fetch('/api/artifacts/handles/' + encodeURIComponent(ref) + '/content', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('The sent file could not be fetched (' + res.status + ').');
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!selected(intent)) return;
      let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const out = await api('/models', { method: 'POST', json: { title: 'Sent mesh ' + new Date().toISOString().slice(0, 16).replace('T', ' '), base: { kind: 'mesh', stl: btoa(bin) }, source: { kind: 'artifact', ref } } });
      if (!applyResponse(out, intent, true)) return;
      await loadModels(); if (!selected(intent)) return;
      startPoll(); toast('Mesh opened as a part.', 'ok');
    } catch (e) { if (!selected(intent)) return; if (e.body && e.body.model) applyResponse(e.body, intent, true); toast(e.message, 'error'); }
  }
  async function intakeScanJob(jobId) {
    const intent = selection();
    try {
      const res = await fetch('/api/scan-to-print/jobs/' + encodeURIComponent(jobId) + '/artifacts/contours', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Scan to Print did not provide outlines for this job (' + res.status + '). Reconstruct it first.');
      const c = await res.json();
      if (!selected(intent)) return;
      const out = await api('/models', { method: 'POST', json: { title: c.title || 'Scanned part', base: { kind: 'contours', views: c.views, size: c.sizeMm }, source: { kind: 'scan', jobId, title: c.title } } });
      if (!applyResponse(out, intent, true)) return;
      await loadModels(); if (!selected(intent)) return;
      startPoll(); toast('Scan outlines opened as a CAD part.', 'ok');
    } catch (e) { if (!selected(intent)) return; if (e.body && e.body.model) applyResponse(e.body, intent, true); toast(e.message, 'error'); }
  }

  // ── The Part menu, Export and in-page questions (no native dialogs, DS-30) ─────────────────────
  /** A part's own commands are offered only while a part is open; Export, the finishing action, is the app row's primary. */
  function renderPartControls(open) {
    for (const id of ['rename-model', 'rebuild-model', 'delete-model']) $(id).disabled = !open;
    $('export-model').hidden = !open;
  }
  const EXPORTS = [['step', 'STEP', 'the solid, for other CAD'], ['stl', 'STL', 'the mesh, for a slicer'], ['obj', 'OBJ', 'Wavefront mesh, for DCC and renderers'], ['mtl', 'MTL', 'companion material library for OBJ'], ['3mf', '3MF', 'packaged mesh and metadata, for slicers'], ['svg-front', 'Front view (SVG)', 'hidden-line drawing'], ['svg-top', 'Top view (SVG)', 'hidden-line drawing'],
    ['svg-right', 'Right view (SVG)', 'hidden-line drawing'], ['svg-iso', 'Isometric view (SVG)', 'hidden-line drawing'], ['report', 'Report', 'extents, volume, mass']];
  function exportUrl(m, key) {
    if (!m || !m.artifacts) return null;
    if (m.artifacts[key]) return m.artifacts[key];
    if (m.artifacts.stl && (key === 'obj' || key === 'mtl' || key === '3mf' || key === 'glb' || key === 'usdz')) {
      return m.artifacts.stl.replace('/artifacts/stl', '/artifacts/' + key);
    }
    return null;
  }
  /** The saved file's name: the part's title made safe, then its kind's extension (the native kernel sends no Content-Disposition). */
  function fileName(title, key) { return (String(title || '').replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'part') + '.' + (key === 'report' ? 'json' : key.startsWith('svg-') ? key.slice(4) + '.svg' : key); }
  /** The Export sheet lists the files this revision has, the first one chosen. */
  function renderExport(m) {
    const list = $('export-list'); if (!list) return;
    const rows = EXPORTS.filter(([key]) => Boolean(exportUrl(m, key))).map(([key, label, note], index) => el('label', { class: 'export-row' }, [
      el('input', Object.assign({ type: 'radio', name: 'export-kind', value: key }, index === 0 ? { checked: '' } : {})), el('span', { text: label }), el('small', { text: note })]));
    list.replaceChildren(...rows);
    $('export-go').disabled = !rows.length;
  }
  function openExport() { closeMenu(); if (state.model && !$('export-sheet').open) $('export-sheet').showModal(); }
  function exportChosen() {
    const chosen = document.querySelector('input[name="export-kind"]:checked');
    const url = chosen ? exportUrl(state.model, chosen.value) : null;
    if (!state.model || !chosen || !url) return;
    const link = el('a', { href: url + '&download', download: fileName(state.model.title, chosen.value) });
    document.body.appendChild(link); link.click(); link.remove();
    $('export-sheet').close();
  }
  let asking = null;
  /**
   * @description Ask the person in the page, never with window.confirm: a modal sheet with the question, Cancel and the
   * action named. Resolves true for the action, false for Cancel, Escape or a tap outside.
   * @param {string} message - The question.
   * @param {{yes?: string, danger?: boolean}} [options] - The action's words, and whether it destroys something.
   * @returns {Promise<boolean>} The answer.
   */
  function ask(message, options) {
    const opts = options || {}, sheet = $('ask-sheet');
    if (asking) settleAsk(false);
    $('ask-text').textContent = message; $('ask-yes').textContent = opts.yes || 'Continue';
    $('ask-yes').className = opts.danger ? 'ghost danger-action' : 'ghost';
    return new Promise((resolve) => { asking = resolve; sheet.showModal(); $('ask-no').focus(); });
  }
  function settleAsk(answer) {
    const resolve = asking; asking = null;
    const sheet = $('ask-sheet'); if (sheet.open) sheet.close();
    if (resolve) resolve(answer);
  }
  function closeMenu() { const menu = $('part-menu-items'); if (menu && typeof menu.hidePopover === 'function' && menu.matches(':popover-open')) menu.hidePopover(); }
  /** The Part menu opens under its trigger, its right edge on the trigger's, kept on screen. */
  function placeMenu(ev) {
    const menu = $('part-menu-items'), trigger = $('part-menu'), open = ev.newState === 'open';
    trigger.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const box = trigger.getBoundingClientRect(), width = menu.offsetWidth;
    menu.style.top = Math.round(box.bottom + 4) + 'px';
    menu.style.left = Math.round(Math.max(8, Math.min(box.right - width, window.innerWidth - width - 8))) + 'px';
  }
  function wireSheets() {
    for (const sheet of [$('export-sheet')]) sheet.addEventListener('click', (ev) => { if (ev.target === sheet || (ev.target && ev.target.closest && ev.target.closest('[data-cs-close]'))) sheet.close(); });
    $('ask-yes').addEventListener('click', () => settleAsk(true));
    $('ask-no').addEventListener('click', () => settleAsk(false));
    $('ask-sheet').addEventListener('cancel', (ev) => { ev.preventDefault(); settleAsk(false); });
    $('export-go').addEventListener('click', exportChosen);
    $('export-model').addEventListener('click', openExport);
    $('part-menu-items').addEventListener('toggle', placeMenu);
    $('model-heading').addEventListener('blur', () => renameModel().catch((e) => toast(e.message, 'error')));
    $('model-heading').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.target.blur(); } if (ev.key === 'Escape' && state.model) { ev.target.textContent = state.model.title; ev.target.blur(); } });
    $('tool-add').addEventListener('click', () => { if (featureDraft() && state.editing) return toast('Save or cancel the feature you are editing first.', 'error'); endEdit(); editorFoundation?.showFeatureForm(); });
    $('tool-report').addEventListener('click', () => editorFoundation?.showReport());
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  let editorFoundation = null;
  let viewportTools = null;
  window.CadStudioApp = { getState: () => state, getModel: () => state.model, getViewer: () => state.viewer, api, toast };
  async function boot() {
    window.addEventListener('pagehide', stopEnginePoll);
    const {bindCadFoundation}=await import('/api/cad-studio/assets/editor-foundation-adapter.mjs');
    editorFoundation=await bindCadFoundation({state,createPart:()=>createModel(),dirty:()=>featureDraft()||densityDirty(),prepare:prepareDocumentHandoff,selectBase:()=>{if(featureDraft())return toast('Save or cancel the feature form before selecting the base.','error');endEdit();editorFoundation.refresh();},changeProperty:async(key,value)=>{
      const intent=selection(),m=state.model,feature=m.features.find(f=>f.id===state.editing);let path='/models/'+m.model_id,body;
      if(feature){body=key==='label'?{label:value}:key==='enabled'?{enabled:value}:{params:{[key.slice(6)]:typeof feature.params[key.slice(6)]==='object'?JSON.parse(value):value}};path+='/features/'+feature.id;}
      else body=key==='title'?{title:value}:key==='density'?{settings:{densityGcm3:value}}:{base:{...m.base,[key.slice(5)]:value}};
      const out=await api(path,{method:'PATCH',json:body,rebuilds:intent.modelId});if(!applyResponse(out,intent))throw new Error('The part changed while rebuilding.');if(out.build&&out.build.ok===false)throw new Error(buildWords(out.build));if(feature){const latest=state.model.features.find(f=>f.id===feature.id);if(latest)beginEdit(latest);}
    }});
    viewportTools = window.CadViewportTools ? window.CadViewportTools.initCadViewportTools(window.CadStudioApp) : null;
    try { state.caps = await api('/capabilities'); renderEngine(state.caps.engine); renderTypeOptions(); } catch (e) { toast('Capabilities unavailable: ' + e.message, 'error'); }
    $('new-model').addEventListener('click', () => { closeMenu(); createModel().catch((e) => toast(e.message, 'error')); });
    $('rename-model').addEventListener('click', () => { closeMenu(); startRename(); });
    $('delete-model').addEventListener('click', () => { closeMenu(); deleteModel(); });
    $('rebuild-model').addEventListener('click', () => { closeMenu(); rebuildModel(); });
    wireSheets();
    $('cancel-rebuild').addEventListener('click', cancelRebuild);
    $('feature-type').addEventListener('change', () => renderParamsForm({}));
    $('feature-submit').addEventListener('click', submitFeature);
    $('feature-cancel').addEventListener('click', endEdit);
    $('mesh-upload').addEventListener('change', (ev) => { uploadMesh(ev.target.files[0]); ev.target.value = ''; });
    $('save-settings').addEventListener('click', saveSettings);
    window.addEventListener('pagehide', stopPoll);
    registerDocumentHandoff();
    await loadModels().catch((e) => toast(e.message, 'error'));
    const q = new URLSearchParams(location.search);
    if (q.get('artifact')) await intakeArtifact(q.get('artifact'));
    else if (q.get('scanJob')) await intakeScanJob(q.get('scanJob'));
    else if (q.get('model')) await openModel(q.get('model')).catch((e) => toast(e.message, 'error'));
  }
  // The full studio only: under an audience view the shared kit paints instead (see the head block in cad-studio.html).
  if (!window.AppView || !AppView.active()) document.addEventListener('DOMContentLoaded', boot);
})();
