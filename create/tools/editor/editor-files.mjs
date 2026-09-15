/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Import bounded raster files and portable layers; export only after a fresh permission check.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Keep the current canvas protected throughout asynchronous portable-file reads and restore controls on parse failure.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Leave clipboard input inside dialogs without uploading it into the canvas behind them.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Consume authorized artifact handoffs once and fence delayed reads/uploads to their original canvas.
 */
import { $, state, canEdit, dirty, api, edit, openDocument, notify, handle } from './editor-state.mjs';
import { parseProject, serializeProject, validateProject, LIMITS } from './model.mjs';
import { exportProjectImage, makePortableProject } from './renderer.mjs';
import { saveProject, mayReplace } from './editor-projects.mjs';
const incomingArtifacts = new Set();

/** Capture the actual editable document, including a saved-project identity or revision change. */
function imageTarget() {
  const project = state.project, id = state.id, revision = state.revision;
  return () => state.project === project && state.id === id && state.revision === revision;
}

async function upload(blob) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) || blob.size > 8388608) throw new Error('Choose a PNG, JPEG or WebP image up to 8 MB.');
  const form = new FormData(); form.append('image', blob, blob.name || 'image.png');
  const { asset } = await api('/project-assets', { method: 'POST', body: form }); return asset;
}

/** Normalize every imported raster through the owner-scoped asset boundary before admitting its layer. */
export async function addImage(blob, name = 'Image', current = imageTarget()) {
  if (!current()) return;
  if (!canEdit()) throw new Error('Your role does not allow adding images.');
  if (state.project.layers.length >= LIMITS.layers || Object.keys(state.project.images).length >= LIMITS.images) throw new Error('This project has reached its layer or image limit.');
  state.loading = true; notify();
  try {
    const asset = await upload(blob);
    if (!current()) return;
    const scale = Math.min(state.project.width / asset.width, state.project.height / asset.height, 1);
    const layer = { id: crypto.randomUUID(), type: 'image', name: name.slice(0, 120), assetId: asset.id,
      x: 0, y: 0, w: asset.width * scale, h: asset.height * scale };
    state.loading = false; edit({ type: 'add', layer, images: { [asset.id]: { src: asset.src, width: asset.width, height: asset.height } } });
    state.selected = layer.id; notify();
  } catch (failure) { if (current()) throw failure; }
  finally { if (current()) { state.loading = false; notify(); } }
}

async function importProject(file) {
  if (!state.permissions.create || !mayReplace()) return;
  if (file.size > LIMITS.portableBytes) throw new Error('This project file exceeds the 32 MB limit.');
  state.loading = true; notify();
  try {
    const project = parseProject(await file.text());
    for (const [id, image] of Object.entries(project.images)) {
      if (!image.src.startsWith('data:')) continue;
      const response = await fetch(image.src), asset = await upload(await response.blob());
      project.images[id] = { src: asset.src, width: asset.width, height: asset.height };
    }
    openDocument(validateProject(project, { assetMode: 'reference' }));
  } finally { state.loading = false; notify(); }
}

async function sourceArtifact(ref) {
  if (!ref || ref.length > 500) throw new Error('This file reference is invalid.');
  const response = await fetch('/api/artifacts/handles/' + encodeURIComponent(ref) + '/content', { credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('This image is no longer available. Choose it again.');
  const length = Number(response.headers.get('content-length'));
  if (length > 8388608) throw new Error('Choose an image up to 8 MB.');
  const reader = response.body.getReader(), parts = []; let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength; if (bytes > 8388608) throw new Error('Choose an image up to 8 MB.'); parts.push(value);
    }
  } finally { await reader.cancel(); }
  return new Blob(parts, { type: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream' });
}

async function chooseArtifact() {
  const current = imageTarget();
  if (typeof window.oshalPickArtifact !== 'function') throw new Error('The OSHAL file picker is unavailable. You can still upload an image.');
  const selected = await window.oshalPickArtifact({ accept: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: 8388608, title: 'Add an image layer' });
  if (selected && current()) await addArtifact(selected.ref, selected.name || 'OSHAL image', current);
}

/** A late read failure belongs to its original canvas just as the bytes do. */
async function addArtifact(ref, name, current = imageTarget()) {
  try { await addImage(await sourceArtifact(ref), name, current); }
  catch (failure) { if (current()) throw failure; }
}

function download(blob, extension) {
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url;
  link.download = (state.project.name.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 100) || 'image') + extension;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Server export admission is checked before fetching or flattening a saved snapshot. */
async function exportFile(type) {
  if (!state.id || dirty()) await saveProject();
  const { document } = await api(`/projects/${state.id}/export`);
  if (serializeProject(document) !== state.saved || dirty()) throw new Error('The saved project changed. Reopen it before exporting.');
  state.loading = true; notify();
  try {
    if (type === 'json') download(new Blob([serializeProject(await makePortableProject(document))], { type: 'application/json' }), '.create.json');
    else download(await exportProjectImage(document, { type }), type === 'image/png' ? '.png' : '.jpg');
    $('exportMenu').open = false;
  } finally { state.loading = false; notify(); }
}

/** Remove only this consumed handle; a cross-origin parent is deliberately inaccessible. */
function consumeArtifact(target, ref) {
  try {
    if (target.location.origin !== location.origin) return false;
    const url = new URL(target.location.href), refs = url.searchParams.getAll('artifact');
    if (!refs.length || refs.some(value => value !== ref)) return false;
    url.searchParams.delete('artifact'); target.history.replaceState(target.history.state, '', url); return true;
  } catch { return false; /* Cross-origin or sandbox refusal leaves that unrelated URL untouched. */ }
}

/** The shell forwards its first value; retain ambiguity checks when that same-origin URL has more. */
function parentArtifacts() {
  try {
    return window.parent !== window && window.parent.location.origin === location.origin
      ? new URLSearchParams(window.parent.location.search).getAll('artifact') : [];
  } catch { return []; /* Cross-origin parents contribute no readable handoff context. */ }
}

/** Open-mode dispatch may forward the same shell handle twice; differing handles are never guessed. */
export async function acceptIncomingArtifact() {
  const refs = new URLSearchParams(location.search).getAll('artifact');
  if (!refs.length) return;
  const ref = refs[0];
  if (!/^art_[A-Za-z0-9_-]{8,64}$/.test(ref) || [...refs, ...parentArtifacts()].some(value => value !== ref)) throw new Error('Choose one valid image file.');
  if (!canEdit() || incomingArtifacts.has(ref)) return;
  incomingArtifacts.add(ref); consumeArtifact(window, ref);
  if (window.parent !== window) consumeArtifact(window.parent, ref);
  await addArtifact(ref, 'Imported image');
}

export function bindFiles() {
  $('uploadImage').onclick = () => $('imageFile').click(); $('chooseArtifact').onclick = handle(chooseArtifact);
  $('imageFile').onchange = handle(async () => { const file = $('imageFile').files[0]; $('imageFile').value = ''; if (file) await addImage(file, file.name); });
  $('importProject').onclick = () => $('projectFile').click();
  $('projectFile').onchange = handle(async () => { const file = $('projectFile').files[0]; $('projectFile').value = ''; if (file) await importProject(file); });
  for (const [id, type] of [['exportPng', 'image/png'], ['exportJpeg', 'image/jpeg'], ['exportJson', 'json']]) $(id).onclick = handle(() => exportFile(type));
  document.addEventListener('paste', handle(async event => {
    if (event.target.closest('input,textarea,[contenteditable]') || document.querySelector('dialog[open]') || !canEdit()) return;
    const file = Array.from(event.clipboardData?.files ?? []).find(item => item.type.startsWith('image/'));
    if (file) { event.preventDefault(); await addImage(file, 'Pasted image'); }
  }));
}
