/**
 * CHANGE LOG
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
 */
(function () {
  'use strict';
  const BASE = '/api/cad-studio';
  const $ = (id) => document.getElementById(id);
  const state = { models: [], model: null, revisions: [], caps: null, viewer: null, editing: null, lastSeen: '', pollTimer: null };

  async function api(path, opts) {
    const init = Object.assign({ credentials: 'same-origin', headers: {} }, opts || {});
    if (init.json !== undefined) { init.body = JSON.stringify(init.json); init.headers['Content-Type'] = 'application/json'; delete init.json; }
    const res = await fetch(BASE + path, init);
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = { raw: text }; }
    if (!res.ok) { const err = new Error((body && (body.message || (body.build && (body.build.reason || body.build.error)) || body.error)) || ('HTTP ' + res.status)); err.status = res.status; err.body = body; throw err; }
    return body;
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
  function renderEngine(engine) {
    if (!engine) return;
    const pill = $('engine-pill');
    pill.textContent = engine.connected ? 'engine: connected' : (engine.lastError ? 'engine: down' : 'engine: idle');
    pill.className = 'badge ' + (engine.connected ? 'built' : engine.lastError ? 'failed' : '');
    $('engine-banner').hidden = !engine.lastError;
    $('engine-reason').textContent = engine.lastError || '';
    $('engine-hint').textContent = engine.installHint || '';
  }
  function showBuild(build) {
    if (!build) return;
    if (build.ok) return;
    if (build.code === 'capability_unavailable' || build.code === 'engine_busy' || build.code === 'engine_timeout') renderEngine({ connected: false, lastError: build.reason || build.error, installHint: state.caps && state.caps.engine && state.caps.engine.installHint });
    toast('Rebuild failed: ' + (build.reason || build.error || build.code), 'error');
  }

  // ── Models ─────────────────────────────────────────────────────────────────
  async function loadModels() {
    state.models = (await api('/models')).models;
    const list = $('model-list');
    list.replaceChildren();
    if (!state.models.length) list.appendChild(el('p', { class: 'muted small', text: 'No parts yet.' }));
    state.models.forEach((m) => list.appendChild(el('button', { class: 'model-item' + (state.model && state.model.model_id === m.model_id ? ' active' : ''), onclick: () => openModel(m.model_id) }, [
      el('span', { class: 'model-title', text: m.title }), el('span', { class: 'badge ' + m.state, text: 'r' + m.revision }),
    ])));
  }
  async function openModel(modelId) {
    const out = await api('/models/' + modelId);
    state.model = out.model; state.revisions = out.revisions || [];
    renderEngine(out.engine);
    await loadModels();
    renderModel();
    startPoll();
  }
  function applyResponse(out) {
    if (out && out.model) { state.model = out.model; renderModel(); loadModels().catch(() => {}); refreshRevisions().catch(() => {}); }
    if (out && out.build) showBuild(out.build);
  }
  async function refreshRevisions() {
    if (!state.model) return;
    const out = await api('/models/' + state.model.model_id);
    state.revisions = out.revisions || []; renderEngine(out.engine); renderRevisions();
  }
  async function createModel() {
    const title = window.prompt('Name the part (e.g. "bracket")');
    if (!title || !title.trim()) return;
    const sx = Number(window.prompt('Base box — width X (mm)', '60')), sy = Number(window.prompt('depth Y (mm)', '40')), sz = Number(window.prompt('height Z (mm)', '30'));
    if (!(sx > 0 && sy > 0 && sz > 0)) { toast('Enter three positive sizes.', 'error'); return; }
    try {
      const out = await api('/models', { method: 'POST', json: { title: title.trim(), base: { kind: 'box', sizeX: sx, sizeY: sy, sizeZ: sz } } });
      applyResponse(out); await loadModels(); startPoll(); toast('Part created and built.', 'ok');
    } catch (e) { if (e.body && e.body.model) applyResponse(e.body); toast(e.message, 'error'); }
  }
  async function renameModel() {
    if (!state.model) return;
    const title = window.prompt('New name', state.model.title);
    if (!title || !title.trim()) return;
    try { applyResponse(await api('/models/' + state.model.model_id, { method: 'PATCH', json: { title: title.trim() } })); } catch (e) { toast(e.message, 'error'); }
  }
  async function deleteModel() {
    if (!state.model || !window.confirm('Delete "' + state.model.title + '" and every revision?')) return;
    try { await api('/models/' + state.model.model_id, { method: 'DELETE' }); state.model = null; stopPoll(); $('model-panel').hidden = true; $('features-panel').hidden = true; $('empty-panel').hidden = false; await loadModels(); } catch (e) { toast(e.message, 'error'); }
  }
  async function rebuildModel() {
    if (!state.model) return;
    try { toast('Rebuilding…'); const out = await api('/models/' + state.model.model_id + '/rebuild', { method: 'POST' }); applyResponse(out); if (out.build.ok) toast('Rebuilt in ' + out.build.ms + ' ms.', 'ok'); }
    catch (e) { if (e.body && e.body.model) applyResponse(e.body); else toast(e.message, 'error'); }
  }

  // ── Rendering ──────────────────────────────────────────────────────────────
  function renderModel() {
    const m = state.model;
    $('empty-panel').hidden = true; $('model-panel').hidden = false; $('features-panel').hidden = false;
    $('model-heading').textContent = m.title;
    $('model-state').textContent = m.state + ' · revision ' + m.revision; $('model-state').className = 'badge ' + m.state;
    $('model-source').textContent = m.source && m.source.kind === 'scan' ? 'from Scan to Print job "' + (m.source.title || m.source.jobId) + '"' : '';
    if (m.state === 'failed' && m.failure_reason) toast(m.failure_reason, 'error');
    renderBase(m); renderReport(m); renderViews(m); renderFeatures(m); renderRevisions();
    if (m.artifacts && m.artifacts.stl) loadStl(m); else if (state.viewer) state.viewer.clear();
    $('density').value = (m.settings && m.settings.densityGcm3) || (state.caps && state.caps.defaults.densityGcm3) || 1.24;
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
    ['step', 'stl', 'svg-front', 'svg-top', 'svg-right', 'svg-iso', 'report'].forEach((k) => { if (m.artifacts && m.artifacts[k]) links.appendChild(el('a', { href: m.artifacts[k] + '&download', text: k.toUpperCase() })); });
  }
  function renderViews(m) {
    const wrap = $('views'); wrap.replaceChildren();
    if (!m.artifacts) return;
    ['front', 'top', 'right', 'iso'].forEach((v) => { const url = m.artifacts['svg-' + v]; if (url) wrap.appendChild(el('figure', {}, [el('img', { src: url + '&t=' + Date.parse(m.updated_at), alt: v + ' view' }), el('figcaption', { text: v.toUpperCase() })])); });
  }
  async function loadStl(m) {
    try {
      if (!state.viewer) state.viewer = window.CadStudioViewer.mount($('viewer'));
      const res = await fetch(m.artifacts.stl, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('STL fetch failed');
      const info = state.viewer.load(await res.arrayBuffer());
      $('viewer-info').textContent = info.triangles + ' facets · ' + fmt(info.size[0]) + ' × ' + fmt(info.size[1]) + ' × ' + fmt(info.size[2]) + ' mm · revision ' + m.revision;
    } catch (e) { $('viewer-info').textContent = e.message; }
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
          el('span', { class: 'muted small', text: String(i + 1) + '.' }), el('span', { class: 'type', text: f.type + (f.label ? ' — ' + f.label : '') }), el('span', { class: 'spacer' }),
          el('button', { class: 'link', text: '↑', title: 'earlier', onclick: () => moveFeature(f.id, i - 1) }),
          el('button', { class: 'link', text: '↓', title: 'later', onclick: () => moveFeature(f.id, i + 1) }),
          el('button', { class: 'link', text: 'edit', onclick: () => beginEdit(f) }),
          el('button', { class: 'link', text: f.enabled ? 'disable' : 'enable', onclick: () => updateFeature(f.id, { enabled: !f.enabled }) }),
          el('button', { class: 'link danger', text: 'remove', onclick: () => removeFeature(f.id) }),
        ]),
        el('div', { class: 'feature-params', text: JSON.stringify(f.params) }),
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
  function renderTypeOptions() {
    const sel = $('feature-type'); sel.replaceChildren();
    Object.keys((state.caps && state.caps.contract.features) || {}).forEach((t) => sel.appendChild(el('option', { value: t, text: t })));
    renderParamsForm({});
  }
  function fieldFor(name, doc, value) {
    const enumMatch = /one of|\(default '([^']+)'\)/.test(doc) ? doc : null;
    const selectors = { edges: state.caps.contract.edgeSelectors, openFace: state.caps.contract.faceSelectors, axis: state.caps.contract.axes, plane: state.caps.contract.planes, keep: ['below', 'above'], mode: ['add', 'cut'] };
    if (selectors[name]) { const s = el('select', { 'data-param': name }, [el('option', { value: '', text: '(default)' })].concat(selectors[name].map((v) => el('option', { value: v, text: v })))); if (value !== undefined) s.value = String(value); return s; }
    if (name === 'through') { const s = el('select', { 'data-param': name }, [el('option', { value: '', text: '(default)' }), el('option', { value: 'true', text: 'true' }), el('option', { value: 'false', text: 'false' })]); if (value !== undefined) s.value = String(value); return s; }
    if (name === 'points' || name === 'size' || name === 'center') return el('input', { type: 'text', 'data-param': name, 'data-json': '1', placeholder: name === 'points' ? '[[0,0],[30,0],[0,30]]' : '[x, y, z]', value: value !== undefined ? JSON.stringify(value) : '', style: 'width:220px' });
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
      if (name === 'through') { params[name] = raw === 'true'; return; }
      params[name] = node.tagName === 'SELECT' ? raw : Number(raw);
    });
    return params;
  }
  function beginEdit(f) {
    state.editing = f.id; $('feature-type').value = f.type; renderParamsForm(f.params); $('feature-label').value = f.label || '';
    $('feature-submit').textContent = 'Save feature'; $('feature-cancel').hidden = false; renderFeatures(state.model);
  }
  function endEdit() { state.editing = null; $('feature-submit').textContent = 'Add feature'; $('feature-cancel').hidden = true; $('feature-label').value = ''; renderParamsForm({}); if (state.model) renderFeatures(state.model); }
  async function submitFeature() {
    if (!state.model) return;
    let params;
    try { params = readParams(); } catch (e) { toast('Parameters must be valid JSON: ' + e.message, 'error'); return; }
    const body = { type: $('feature-type').value, params, label: $('feature-label').value || undefined };
    $('feature-submit').disabled = true;
    try {
      const out = state.editing
        ? await api('/models/' + state.model.model_id + '/features/' + state.editing, { method: 'PATCH', json: Object.assign({ merge: false }, body) })
        : await api('/models/' + state.model.model_id + '/features', { method: 'POST', json: body });
      applyResponse(out);
      const st = out.feature && statusOf(out.model, out.feature.id);
      if (st && st.ok === false) toast('The kernel refused this feature: ' + st.error, 'error'); else if (out.build.ok) toast('Rebuilt in ' + out.build.ms + ' ms.', 'ok');
      endEdit();
    } catch (e) { if (e.body && e.body.model) applyResponse(e.body); toast(e.message + (e.body && e.body.field ? ' (' + e.body.field + ')' : ''), 'error'); }
    finally { $('feature-submit').disabled = false; }
  }
  async function updateFeature(id, patch) {
    try { applyResponse(await api('/models/' + state.model.model_id + '/features/' + id, { method: 'PATCH', json: patch })); } catch (e) { if (e.body && e.body.model) applyResponse(e.body); toast(e.message, 'error'); }
  }
  async function removeFeature(id) {
    try { applyResponse(await api('/models/' + state.model.model_id + '/features/' + id, { method: 'DELETE' })); if (state.editing === id) endEdit(); } catch (e) { if (e.body && e.body.model) applyResponse(e.body); toast(e.message, 'error'); }
  }
  async function moveFeature(id, to) {
    if (to < 0 || to >= state.model.features.length) return;
    try { applyResponse(await api('/models/' + state.model.model_id + '/features/' + id + '/move', { method: 'POST', json: { to } })); } catch (e) { if (e.body && e.body.model) applyResponse(e.body); toast(e.message, 'error'); }
  }
  async function restoreRevision(revision) {
    if (!window.confirm('Restore the feature list of revision ' + revision + '? (This creates a new revision; nothing is lost.)')) return;
    try { applyResponse(await api('/models/' + state.model.model_id + '/restore', { method: 'POST', json: { revision } })); toast('Restored revision ' + revision + '.', 'ok'); } catch (e) { if (e.body && e.body.model) applyResponse(e.body); toast(e.message, 'error'); }
  }
  async function uploadMesh(file) {
    if (!file || !state.model) return;
    const form = new FormData(); form.append('stl', file, file.name);
    try { toast('Sewing the mesh into a solid…'); applyResponse(await api('/models/' + state.model.model_id + '/base/mesh', { method: 'POST', body: form })); } catch (e) { if (e.body && e.body.model) applyResponse(e.body); toast(e.message, 'error'); }
  }
  async function saveSettings() {
    if (!state.model) return;
    try { applyResponse(await api('/models/' + state.model.model_id, { method: 'PATCH', json: { settings: { densityGcm3: Number($('density').value) } } })); } catch (e) { toast(e.message, 'error'); }
  }

  // ── Live refresh while the concierge edits from the chat rail ──────────────
  function startPoll() {
    stopPoll();
    state.lastSeen = state.model ? state.model.updated_at : '';
    state.pollTimer = setInterval(async () => {
      if (!state.model || document.hidden) return;
      try {
        const out = await api('/models/' + state.model.model_id);
        if (out.model.updated_at !== state.lastSeen) { state.lastSeen = out.model.updated_at; state.model = out.model; state.revisions = out.revisions || []; renderModel(); loadModels().catch(() => {}); }
        renderEngine(out.engine);
      } catch (_) { /* transient */ }
    }, 3000);
  }
  function stopPoll() { if (state.pollTimer) clearInterval(state.pollTimer); state.pollTimer = null; }

  // ── Entry points from elsewhere ────────────────────────────────────────────
  async function intakeArtifact(ref) {
    try {
      const res = await fetch('/api/artifacts/handles/' + encodeURIComponent(ref) + '/content', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('The sent file could not be fetched (' + res.status + ').');
      const bytes = new Uint8Array(await res.arrayBuffer());
      let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const out = await api('/models', { method: 'POST', json: { title: 'Sent mesh ' + new Date().toISOString().slice(0, 16).replace('T', ' '), base: { kind: 'mesh', stl: btoa(bin) }, source: { kind: 'artifact', ref } } });
      applyResponse(out); await loadModels(); startPoll(); toast('Mesh opened as a part.', 'ok');
    } catch (e) { if (e.body && e.body.model) applyResponse(e.body); toast(e.message, 'error'); }
  }
  async function intakeScanJob(jobId) {
    try {
      const res = await fetch('/api/scan-to-print/jobs/' + encodeURIComponent(jobId) + '/artifacts/contours', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Scan to Print did not provide outlines for this job (' + res.status + '). Reconstruct it first.');
      const c = await res.json();
      const out = await api('/models', { method: 'POST', json: { title: c.title || 'Scanned part', base: { kind: 'contours', views: c.views, size: c.sizeMm }, source: { kind: 'scan', jobId, title: c.title } } });
      applyResponse(out); await loadModels(); startPoll(); toast('Scan outlines opened as a CAD part.', 'ok');
    } catch (e) { if (e.body && e.body.model) applyResponse(e.body); toast(e.message, 'error'); }
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  async function boot() {
    try { state.caps = await api('/capabilities'); renderEngine(state.caps.engine); renderTypeOptions(); } catch (e) { toast('Capabilities unavailable: ' + e.message, 'error'); }
    $('new-model').addEventListener('click', () => createModel().catch((e) => toast(e.message, 'error')));
    $('rename-model').addEventListener('click', renameModel);
    $('delete-model').addEventListener('click', deleteModel);
    $('rebuild-model').addEventListener('click', rebuildModel);
    $('feature-type').addEventListener('change', () => renderParamsForm({}));
    $('feature-submit').addEventListener('click', submitFeature);
    $('feature-cancel').addEventListener('click', endEdit);
    $('mesh-upload').addEventListener('change', (ev) => { uploadMesh(ev.target.files[0]); ev.target.value = ''; });
    $('save-settings').addEventListener('click', saveSettings);
    window.addEventListener('pagehide', stopPoll);
    await loadModels().catch((e) => toast(e.message, 'error'));
    const q = new URLSearchParams(location.search);
    if (q.get('artifact')) await intakeArtifact(q.get('artifact'));
    else if (q.get('scanJob')) await intakeScanJob(q.get('scanJob'));
    else if (q.get('model')) await openModel(q.get('model')).catch((e) => toast(e.message, 'error'));
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
