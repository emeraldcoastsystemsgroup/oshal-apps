/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Owner-scoped Home work-card actions (Rename, Duplicate, Delete) and file-to-design import across Create, AI Office and PDF Workbench.
 */

const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function uuid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function parseItemId(query, key) {
  const params = new URLSearchParams(String(query || ''));
  const value = params.get(key) || '';
  return UUID_RE.test(value) ? value : '';
}

export function copyTitle(raw) {
  const base = String(raw || 'Untitled').trim().slice(0, 108) || 'Untitled';
  return `${base} (copy)`;
}

export function cleanImportTitle(fileName) {
  const stem = String(fileName || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (stem || 'Imported design').slice(0, 120);
}

async function requestJson(url, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.json !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method: options.method || 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = payload.message || payload.detail || payload.error || `Request failed (HTTP ${res.status}).`;
    const err = new Error(String(msg));
    err.status = res.status;
    throw err;
  }
  return payload;
}

async function resolveByTitle(url, listKey, idKeys, targetTitle) {
  const data = await requestJson(url);
  const rows = Array.isArray(data[listKey]) ? data[listKey] : [];
  const wanted = String(targetTitle || '').trim();
  const hit = rows.find((row) => row && String(row.title || '').trim() === wanted);
  if (!hit) throw new Error('That saved item could not be found in its studio. Refresh Home and try again.');
  for (const key of idKeys) {
    if (typeof hit[key] === 'string' && UUID_RE.test(hit[key])) return hit[key];
  }
  throw new Error('The studio record did not include a valid item identifier.');
}

async function resolveTargetId(app, item, query) {
  const text = item && item.text;
  if (app === 'create') return parseItemId(query, 'project') || resolveByTitle('/api/create/projects', 'projects', ['id'], text);
  if (app === 'presentations') return parseItemId(query, 'document') || resolveByTitle('/api/presentations/editor/documents', 'documents', ['id'], text);
  if (app === 'cad-studio') return parseItemId(query, 'model') || resolveByTitle('/api/cad-studio/models', 'models', ['modelId', 'model_id', 'id'], text);
  if (app === 'scan-to-print') return parseItemId(query, 'job') || resolveByTitle('/api/scan-to-print/jobs', 'jobs', ['job_id', 'jobId', 'id'], text);
  if (app === 'pdf-workbench') return parseItemId(query, 'document') || resolveByTitle('/api/pdf-workbench/documents', 'documents', ['id'], text);
  if (app === 'publishing-studio') return parseItemId(query, 'document') || resolveByTitle('/api/publishing-studio/documents', 'documents', ['id'], text);
  if (app === 'motion-studio') return parseItemId(query, 'project') || resolveByTitle('/api/motion-studio/projects', 'projects', ['id'], text);
  throw new Error('Open this studio directly to manage its items.');
}

async function copyPdfDocument(id, nextTitle) {
  const info = await requestJson(`/api/pdf-workbench/documents/${encodeURIComponent(id)}?receipt=1`);
  const rev = (info.document && (info.document.currentRevision || info.document.revision)) || 1;
  const pdfRes = await fetch(`/api/pdf-workbench/documents/${encodeURIComponent(id)}/revisions/${rev}/content`, { credentials: 'same-origin', cache: 'no-store' });
  if (!pdfRes.ok) throw new Error(`Could not read saved PDF bytes (HTTP ${pdfRes.status}).`);
  const blob = await pdfRes.blob();
  const form = new FormData();
  form.append('file', new File([blob], 'document.pdf', { type: 'application/pdf' }));
  form.append('title', nextTitle);
  form.append('requestKey', uuid());
  const uploaded = await requestJson('/api/pdf-workbench/sources/upload', { method: 'POST', body: form });
  return requestJson('/api/pdf-workbench/documents', {
    method: 'POST',
    json: { title: nextTitle, source: uploaded.source.id, requestKey: uuid() },
  });
}

export async function renameWorkItem(studio, item, query, rawTitle) {
  const nextTitle = String(rawTitle || '').trim().slice(0, 120);
  if (!nextTitle) throw new Error('Enter a name before saving.');
  const app = studio.app;
  const id = await resolveTargetId(app, item, query);
  if (app === 'create') {
    const { project } = await requestJson(`/api/create/projects/${encodeURIComponent(id)}`);
    await requestJson(`/api/create/projects/${encodeURIComponent(id)}/revisions`, {
      method: 'POST',
      json: { title: nextTitle, baseRevision: project.revision, document: { ...project.document, name: nextTitle } },
    });
    return { title: nextTitle, query: `project=${id}` };
  }
  if (app === 'presentations') {
    const { document } = await requestJson(`/api/presentations/editor/documents/${encodeURIComponent(id)}`);
    await requestJson(`/api/presentations/editor/documents/${encodeURIComponent(id)}/revisions`, {
      method: 'POST',
      json: { baseRevision: document.currentRevision, requestKey: uuid(), operations: [{ op: 'document', patch: { title: nextTitle } }] },
    });
    return { title: nextTitle, query: `document=${id}` };
  }
  if (app === 'cad-studio') {
    await requestJson(`/api/cad-studio/models/${encodeURIComponent(id)}`, { method: 'PATCH', json: { title: nextTitle } });
    return { title: nextTitle, query: `model=${id}` };
  }
  if (app === 'scan-to-print') {
    await requestJson(`/api/scan-to-print/jobs/${encodeURIComponent(id)}`, { method: 'PATCH', json: { title: nextTitle } });
    return { title: nextTitle, query: `job=${id}` };
  }
  if (app === 'pdf-workbench') {
    const created = await copyPdfDocument(id, nextTitle);
    await requestJson(`/api/pdf-workbench/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return { title: nextTitle, query: `document=${created.document.id}` };
  }
  if (app === 'motion-studio') {
    const { project } = await requestJson(`/api/motion-studio/projects/${encodeURIComponent(id)}`);
    await requestJson(`/api/motion-studio/projects/${encodeURIComponent(id)}/revisions`, {
      method: 'POST',
      json: { id, title: nextTitle, document: project.document, baseRevision: project.revision, requestKey: uuid() },
    });
    return { title: nextTitle, query: `project=${id}` };
  }
  throw new Error(`Open ${studio.name} to rename this item.`);
}

async function duplicateStudioDocument(app, id, nextTitle) {
  if (app === 'pdf-workbench') {
    const created = await copyPdfDocument(id, nextTitle);
    return { title: created.document.title, query: `document=${created.document.id}` };
  }
  if (app === 'publishing-studio') {
    const { document } = await requestJson(`/api/publishing-studio/documents/${encodeURIComponent(id)}?receipt=1`);
    const created = await requestJson('/api/publishing-studio/documents', {
      method: 'POST',
      json: { title: nextTitle, pageCount: document.pages || 4, requestKey: uuid() },
    });
    return { title: created.document.title, query: `document=${created.document.id}` };
  }
  if (app === 'motion-studio') {
    const { project } = await requestJson(`/api/motion-studio/projects/${encodeURIComponent(id)}`);
    const created = await requestJson(`/api/motion-studio/projects/${encodeURIComponent(id)}/fork`, {
      method: 'POST',
      json: { id, revision: project.revision, title: nextTitle, requestKey: uuid() },
    });
    return { title: created.project.title, query: `project=${created.project.id}` };
  }
  return null;
}

export async function duplicateWorkItem(studio, item, query) {
  const app = studio.app;
  const id = await resolveTargetId(app, item, query);
  const nextTitle = copyTitle(item && item.text);
  if (app === 'create') {
    const { project } = await requestJson(`/api/create/projects/${encodeURIComponent(id)}`);
    const created = await requestJson('/api/create/projects', {
      method: 'POST',
      json: { title: nextTitle, document: { ...project.document, name: nextTitle } },
    });
    return { title: created.project.title, query: `project=${created.project.id}` };
  }
  if (app === 'presentations') {
    const { document } = await requestJson(`/api/presentations/editor/documents/${encodeURIComponent(id)}`);
    const created = await requestJson('/api/presentations/editor/documents', {
      method: 'POST',
      json: { title: nextTitle, kind: document.kind, model: { ...document.model, title: nextTitle }, requestKey: uuid() },
    });
    return { title: created.document.title, query: `document=${created.document.id}` };
  }
  if (app === 'cad-studio') {
    const { model } = await requestJson(`/api/cad-studio/models/${encodeURIComponent(id)}`);
    const created = await requestJson('/api/cad-studio/models', {
      method: 'POST',
      json: { title: nextTitle, base: model.base, features: model.features, source: model.source, settings: model.settings },
    });
    const newId = created.model.modelId || created.model.model_id || created.model.id;
    return { title: created.model.title || nextTitle, query: `model=${newId}` };
  }
  if (app === 'scan-to-print') {
    const created = await requestJson('/api/scan-to-print/jobs', { method: 'POST', json: { title: nextTitle } });
    const newId = created.job.job_id || created.job.jobId || created.job.id;
    return { title: created.job.title || nextTitle, query: `job=${newId}` };
  }
  const copied = await duplicateStudioDocument(app, id, nextTitle);
  if (copied) return copied;
  throw new Error(`Open ${studio.name} to duplicate this item.`);
}

export async function deleteWorkItem(studio, item, query) {
  const app = studio.app;
  const id = await resolveTargetId(app, item, query);
  if (app === 'create') {
    const { project } = await requestJson(`/api/create/projects/${encodeURIComponent(id)}`);
    await requestJson(`/api/create/projects/${encodeURIComponent(id)}`, { method: 'DELETE', json: { baseRevision: project.revision } });
    return { deleted: id };
  }
  if (app === 'presentations') {
    const { document } = await requestJson(`/api/presentations/editor/documents/${encodeURIComponent(id)}`);
    await requestJson(`/api/presentations/editor/documents/${encodeURIComponent(id)}`, { method: 'DELETE', json: { baseRevision: document.currentRevision } });
    return { deleted: id };
  }
  if (app === 'cad-studio') return requestJson(`/api/cad-studio/models/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (app === 'scan-to-print') return requestJson(`/api/scan-to-print/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (app === 'pdf-workbench') return requestJson(`/api/pdf-workbench/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (app === 'publishing-studio') return requestJson(`/api/publishing-studio/documents/${encodeURIComponent(id)}`, { method: 'DELETE', json: {} });
  if (app === 'motion-studio') return requestJson(`/api/motion-studio/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
  throw new Error(`Open ${studio.name} to delete this item.`);
}

const IMPORT_SPECS = [
  { ext: /\.(png|jpe?g|webp)$/i, kind: 'raster', app: 'create', studio: 'Image editor', tool: 'create-editor', maxBytes: 8 * 1024 * 1024, maxLabel: '8 MB' },
  { ext: /\.svg$/i, kind: 'svg', app: 'create', studio: 'Image editor', tool: 'create-editor', maxBytes: 2 * 1024 * 1024, maxLabel: '2 MB' },
  { ext: /\.(pptx|docx)$/i, kind: 'office', app: 'presentations', studio: 'AI Office', tool: 'create-office', maxBytes: 10 * 1024 * 1024, maxLabel: '10 MB' },
  { ext: /\.pdf$/i, kind: 'pdf', app: 'pdf-workbench', studio: 'PDF Workbench', tool: 'create-pdf-workbench', maxBytes: 16 * 1024 * 1024, maxLabel: '16 MB' },
];

export function classifyImportFile(file, access = {}) {
  if (!file || typeof file.name !== 'string') return { ok: false, message: 'Choose a file to import.' };
  const spec = IMPORT_SPECS.find((entry) => entry.ext.test(file.name));
  if (!spec) return { ok: false, message: 'Choose a PDF, PPTX, DOCX, SVG, PNG, JPG or WebP file.' };
  if (!file.size || file.size <= 0) return { ok: false, message: 'The selected file is empty.' };
  if (file.size > spec.maxBytes) return { ok: false, message: `${spec.studio} imports files up to ${spec.maxLabel}.` };
  if (spec.app === 'create' && access.create !== 'open') return { ok: false, message: 'Image editor access could not be confirmed. Refresh this page or review Access.' };
  if (access[spec.app] === 'locked') return { ok: false, message: `${spec.studio} is not assigned to you — an administrator grants it in Access.` };
  return { ok: true, spec };
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

async function importRaster(file, title) {
  const form = new FormData();
  form.append('image', file);
  const { asset } = await requestJson('/api/create/project-assets', { method: 'POST', body: form });
  const { createProject, applyOperation } = await import('./model.mjs');
  const w = Math.max(16, Math.min(4096, Math.round(Number(asset.width) || 1080)));
  const h = Math.max(16, Math.min(4096, Math.round(Number(asset.height) || 1080)));
  const base = createProject({ name: title, width: w, height: h });
  const document = applyOperation(base, {
    type: 'add',
    layer: { id: uuid(), type: 'image', name: title, assetId: asset.id, x: 0, y: 0, w, h },
    images: { [asset.id]: { src: asset.src, width: Number(asset.width) || w, height: Number(asset.height) || h } },
  });
  const created = await requestJson('/api/create/projects', { method: 'POST', json: { title, document } });
  return { ok: true, tool: 'create-editor', query: `project=${created.project.id}` };
}

async function importSvg(file, title) {
  const { importVectorSvg } = await import('./vector-svg.mjs');
  const parsed = importVectorSvg(await file.text());
  parsed.project.name = title;
  const created = await requestJson('/api/create/projects', { method: 'POST', json: { title, document: parsed.project } });
  return { ok: true, tool: 'create-editor', query: `project=${created.project.id}` };
}

async function importOffice(file, opts) {
  const inspected = opts.inspected || await requestJson('/api/presentations/editor/import/inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  if (inspected.requiresConversion && !opts.acceptConversion) {
    return { ok: false, review: true, findings: Array.isArray(inspected.findings) ? inspected.findings : [], inspected };
  }
  const data = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
  const created = await requestJson('/api/presentations/editor/import', {
    method: 'POST',
    json: { data, name: file.name, sha256: inspected.sha256, acceptConversion: Boolean(opts.acceptConversion), requestKey: uuid() },
  });
  return { ok: true, tool: 'create-office', query: `document=${created.document.id}` };
}

async function importPdf(file, title) {
  const form = new FormData();
  form.append('file', file);
  form.append('title', title);
  form.append('requestKey', uuid());
  const uploaded = await requestJson('/api/pdf-workbench/sources/upload', { method: 'POST', body: form });
  const created = await requestJson('/api/pdf-workbench/documents', {
    method: 'POST',
    json: { title, source: uploaded.source.id, requestKey: uuid() },
  });
  return { ok: true, tool: 'create-pdf-workbench', query: `document=${created.document.id}` };
}

export async function importDesignFile(file, access = {}, opts = {}) {
  const check = classifyImportFile(file, access);
  if (!check.ok) return check;
  const title = cleanImportTitle(file.name);
  if (check.spec.kind === 'raster') return importRaster(file, title);
  if (check.spec.kind === 'svg') return importSvg(file, title);
  if (check.spec.kind === 'office') return importOffice(file, opts);
  return importPdf(file, title);
}

function bindRenameModal(host, state) {
  const dlg = document.getElementById('renameDialog');
  const input = document.getElementById('renameInput');
  const errEl = document.getElementById('renameError');
  const saveBtn = document.getElementById('renameSave');
  document.getElementById('renameCancel').addEventListener('click', () => { if (dlg.open) dlg.close(); });
  document.getElementById('renameForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!state.active) return;
    const ctx = state.active;
    saveBtn.disabled = true; errEl.hidden = true;
    renameWorkItem(ctx.studio, ctx.item, ctx.query, input.value).then((res) => {
      ctx.item.text = res.title;
      if (res.query) ctx.item.actions = [{ tool: ctx.studio.tool, query: res.query }];
      if (dlg.open) dlg.close();
      host.renderRecent(); host.toast(`Renamed to "${res.title}".`); void host.loadSummaries();
    }).catch((err) => { errEl.textContent = (err && err.message) || 'Could not rename this item.'; errEl.hidden = false; })
      .finally(() => { saveBtn.disabled = false; });
  });
  return (studio, item, query) => {
    state.active = { studio, item, query };
    input.value = item.text || ''; errEl.hidden = true; errEl.textContent = '';
    if (!dlg.open) dlg.showModal();
    input.focus(); input.select();
  };
}

function bindDeleteModal(host, state) {
  const dlg = document.getElementById('deleteDialog');
  const msgEl = document.getElementById('deleteMessage');
  const errEl = document.getElementById('deleteError');
  const confirmBtn = document.getElementById('deleteConfirm');
  document.getElementById('deleteCancel').addEventListener('click', () => { if (dlg.open) dlg.close(); });
  confirmBtn.addEventListener('click', () => {
    if (!state.active) return;
    const ctx = state.active;
    confirmBtn.disabled = true; errEl.hidden = true;
    deleteWorkItem(ctx.studio, ctx.item, ctx.query).then(() => {
      host.removeRecentItem(ctx.item);
      if (dlg.open) dlg.close();
      host.renderRecent(); host.toast(`Deleted "${ctx.item.text}".`); void host.loadSummaries();
    }).catch((err) => { errEl.textContent = (err && err.message) || 'Could not delete this item.'; errEl.hidden = false; })
      .finally(() => { confirmBtn.disabled = false; });
  });
  return (studio, item, query) => {
    state.active = { studio, item, query };
    msgEl.textContent = `Delete "${item.text}" from ${studio.name}? This removes your saved record.`;
    errEl.hidden = true; errEl.textContent = '';
    if (!dlg.open) dlg.showModal();
    document.getElementById('deleteCancel').focus();
  };
}

function bindImportControls(host) {
  const input = document.getElementById('importInput');
  const box = document.getElementById('importBox');
  const stat = document.getElementById('importStatus');
  const list = document.getElementById('importFindings');
  const acts = document.getElementById('importReviewActions');
  let staged = null;
  const reset = () => { staged = null; box.hidden = true; list.hidden = true; acts.hidden = true; stat.textContent = ''; list.replaceChildren(); input.value = ''; };
  const run = (file, opts = {}) => {
    box.hidden = false; list.hidden = true; acts.hidden = true; stat.textContent = `Importing "${file.name}"…`;
    importDesignFile(file, host.getAccess(), opts).then((res) => {
      if (res.ok) { reset(); if (host.go(res.tool, res.query)) host.closeNew(true); return; }
      if (res.review) {
        staged = { file, inspected: res.inspected };
        stat.textContent = `AI Office can import an editable copy of "${file.name}" with these notes:`;
        list.replaceChildren();
        (res.findings.length ? res.findings : [{ message: 'Formatting outside the editable model will be simplified.' }]).forEach((f) => {
          const li = document.createElement('li'); li.textContent = String((f && (f.message || f.code)) || f); list.appendChild(li);
        });
        list.hidden = false; acts.hidden = false; return;
      }
      stat.textContent = res.message || 'Could not import that file.';
    }).catch((err) => { stat.textContent = (err && err.message) || 'Could not import that file.'; });
  };
  document.getElementById('importAccept').addEventListener('click', () => { if (staged) run(staged.file, { inspected: staged.inspected, acceptConversion: true }); });
  document.getElementById('importCancel').addEventListener('click', reset);
  return { reset, run };
}

export function createHomeController(host) {
  const state = { active: null };
  const openRename = bindRenameModal(host, state);
  const openDelete = bindDeleteModal(host, state);
  const imp = bindImportControls(host);
  const duplicate = (studio, item, query) => {
    host.toast(`Duplicating "${item.text}"…`);
    duplicateWorkItem(studio, item, query).then((res) => {
      host.prependRecent(studio, { text: res.title, detail: item.detail || '', actions: [{ tool: studio.tool, query: res.query || '' }] });
      host.renderRecent(); host.toast(`Created "${res.title}".`); void host.loadSummaries();
    }).catch((err) => { host.toast((err && err.message) || 'Could not duplicate this item.'); });
  };
  return { openRename, openDelete, duplicate, resetImport: imp.reset, runImport: imp.run };
}
