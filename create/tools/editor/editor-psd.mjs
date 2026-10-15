/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Review bounded PSD conversion losses before atomically importing, retaining originals and protecting newer canvases.
 */
import { $, state, api as projectApi, jsonRequest, openDocument, notify, subscribe, handle } from './editor-state.mjs';
import { mayReplace } from './editor-projects.mjs';
const MAX = 4194304;
const errors={psd_file_limit:'Choose a PSD up to4 MiB.',psd_canvas_limit:'PSD import supports canvases up to2048 pixels per side and4 megapixels.',
  psd_decoded_limit:'This PSD exceeds the bounded decoded-pixel or layer limit.',psd_layer_limit:'This PSD has too many layer records.',
  psb_unsupported:'PSB is outside this PSD import profile.',psd_color_mode_unsupported:'Choose an8-bit RGB PSD.',
  psd_compression_unsupported:'This PSD uses unsupported compression. Raw or PackBits/RLE PSD data is supported.',
  psd_import_busy:'PSD import is busy. Retry after the current import finishes.',psd_original_storage_limit:'Stored PSD originals have reached4 MiB. Delete an imported project in My projects to free original storage.',
  psd_editable_unsupported:'This file contains features that cannot retain editable structure. Review its conversion report.',
  psd_flattened_unsupported:'This profile cannot flatten the transparent merged cache. Use editable mode only if its report permits it.',
  psd_source_not_found:'This project has no preserved PSD original.',psd_source_changed:'The source changed after review. Inspect it again.',
  psd_request_conflict:'This retry differs from the reviewed import. Check the saved project before starting another import.',
  invalid_psd:'The PSD data is corrupt or outside this import profile.'};
async function api(path,options){try{return await projectApi(path,options);}catch(failure){if(errors[failure.code])failure.message=errors[failure.code];throw failure;}}
const messages = {
  layer_mask: 'Layer masks cannot become editable Create masks.', clipping_layer: 'Clipped layers cannot retain editable clipping.',
  embedded_color_profile: 'The embedded color profile is not converted.', global_mask: 'A global mask cannot become editable.',
  global_layer_information: 'Additional global Photoshop features are preserved only in the original.',
  no_editable_layers: 'This file has no editable pixel layers.', empty_pixel_layer: 'An empty pixel layer cannot become an image layer.',
  transparency_lock_promoted_to_layer_lock: 'A transparency lock becomes a full layer lock; you can unlock it deliberately.',
  layer_name_normalized: 'A layer name is shortened or has control characters removed.',
  group_fixed_frame: 'This folder becomes a fixed-frame group. Moving children outside its imported frame clips them.',
  layer_tag_TySh_unsupported: 'Photoshop text cannot retain editable text structure.',
  layer_tag_lrFX_unsupported: 'Photoshop layer effects cannot retain editable settings.',
  layer_tag_lfx2_unsupported: 'Photoshop layer effects cannot retain editable settings.',
};
function findings(rows) {
  return rows.map(row => `${row.layer === null ? '' : `Layer ${row.layer + 1}: `}${messages[row.code] ?? (/^resource_\d+_preserved_only$/.test(row.code)?'Nonvisual Photoshop metadata is kept in the original only.':`Photoshop feature ${row.code} is preserved in the original, not as an editable feature.`)}`);
}
function node(tag, text, props = {}) { const element = document.createElement(tag); element.textContent = text; Object.assign(element, props); return element; }
function title(name) { return name.replace(/\.psd$/i, '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160) || 'Imported PSD'; }
function currentCanvas() { const project = state.project, id = state.id, revision = state.revision; return () => state.project === project && state.id === id && state.revision === revision; }
function multipart(file, fields = {}) { const body = new FormData(); body.append('psd', file, file.name || 'original.psd'); for (const [key, value] of Object.entries(fields)) body.append(key, value); return { method: 'POST', body }; }
function review(source, inspection, current) {
  const dialog = node('dialog', '', { id: 'psdReview', className: 'project-dialog' });
  const form = node('form', ''), heading = node('h2', 'Review PSD import');
  const summary = node('p', `${inspection.width} × ${inspection.height} · ${inspection.pixelLayers} pixel layers. The exact original PSD and this conversion report will be kept.`);
  const name = node('input', '', { value: title(source.name), maxLength: 160, required: true }); name.id = 'psdTitle';
  const label = node('label', 'Project name'); label.append(name);
  const mode = node('select', ''); mode.id = 'psdMode';
  mode.append(new Option('Editable layers and groups', 'editable', inspection.editable, inspection.editable), new Option('Flattened merged image', 'flattened', !inspection.editable, !inspection.editable));
  mode.options[0].disabled = !inspection.editable; mode.options[1].disabled = !inspection.flattened;
  const modeLabel = node('label', 'Conversion'); modeLabel.append(mode);
  const report = node('ul', ''); report.id = 'psdLossReport';
  for (const message of findings(inspection.report)) report.append(node('li', message));
  if (!inspection.report.length) report.append(node('li', 'No unsupported features were found in this bounded profile.'));
  const warning = node('p', 'Flattened import is one image. Text, masks, effects and other Photoshop structure will not be editable. This is not full Photoshop fidelity or PSD export.');
  const notice = node('p', '', { hidden: true }); notice.setAttribute('role', 'alert');
  const submit = node('button', 'Import and save', { type: 'submit', disabled: !inspection.editable && !inspection.flattened }); submit.id = 'psdConfirm';
  const cancel = node('button', 'Cancel', { type: 'button' }); cancel.id = 'psdCancel';
  form.append(heading, summary, label, modeLabel, report, warning, notice, submit, cancel); dialog.append(form); document.body.append(dialog);
  let busy = false, requestKey = null, sealed = null;
  const close = () => { if (!busy) { dialog.close(); dialog.remove(); } };
  cancel.onclick = close; dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  form.onsubmit = handle(async event => {
    event.preventDefault(); if (busy) return;
    if (!current() || state.loading || state.saving) throw new Error('The canvas changed while this file was reviewed. Start the import again.');
    busy = true; state.loading = true; notify(); submit.disabled = true; cancel.disabled = true; let opened = false;
    try {
      requestKey ??= crypto.randomUUID(); sealed ??= { title: name.value, mode: mode.value, expectedSha256: inspection.sha256, requestKey };
      const result = source.ref ? await api('/psd-artifact-imports', jsonRequest('POST', { ref: source.ref, ...sealed }))
        : await api('/psd-imports', multipart(source.file, sealed));
      if (!current()) throw new Error('The import is saved in My projects; the newer canvas was kept.');
      // A sealed retry returns revision1; fetch current state before opening so an
      // intervening edit can never be replaced by the original import snapshot.
      const { project } = await api(`/projects/${result.project.id}`);
      if (!current()) throw new Error('The import is saved in My projects; the newer canvas was kept.');
      openDocument(project.document, project); opened = true; dialog.close(); dialog.remove();
    } catch (failure) {
      notice.textContent = failure.message + (requestKey ? ' Retry this same import or check My projects before starting another.' : ''); notice.hidden = false;
      name.disabled = !!sealed; mode.disabled = !!sealed; submit.textContent = 'Retry same import';
    } finally { busy = false; cancel.disabled = false; submit.disabled = false; if (current() || opened) { state.loading = false; notify(); } }
  });
  dialog.showModal();
}
/** Review consumes no project quota or image writes; closing the review saves nothing. */
export async function importPsdFile(file) {
  if (!state.permissions.create || !state.permissions.read || !mayReplace()) return;
  if (!file.size || file.size > MAX) throw new Error('PSD import is limited to 4 MiB.');
  const current = currentCanvas(); state.loading = true; notify();
  try { const inspection = await api('/psd-inspect', multipart(file)); if (current()) review({ file, name: file.name }, inspection, current); }
  finally { if (current()) { state.loading = false; notify(); } }
}
async function choosePsd() {
  if (!state.permissions.create || !state.permissions.read || !mayReplace()) return;
  if (typeof window.oshalPickArtifact !== 'function') throw new Error('The OSHAL file picker is unavailable. Use Import PSD.');
  const current = currentCanvas();
  const selected = await window.oshalPickArtifact({ accept: ['image/vnd.adobe.photoshop', 'image/x-photoshop', 'application/x-photoshop', 'application/octet-stream'], maxBytes: MAX, title: 'Import a PSD' });
  if (!selected || !current()) return;
  state.loading = true; notify();
  try { const inspection = await api(`/psd-artifacts/${encodeURIComponent(selected.ref)}/inspect`); if (current()) review({ ref: selected.ref, name: selected.name || 'Imported PSD' }, inspection, current); }
  finally { if (current()) { state.loading = false; notify(); } }
}
async function sourceDetails() {
  const id = state.id; if (!id || !state.permissions.read) return;
  const { source } = await api(`/projects/${id}/psd-source`); if (state.id !== id) return;
  const dialog = node('dialog', '', { id: 'psdSourceDetails', className: 'project-dialog' });
  dialog.append(node('h2', 'Original PSD'), node('p', `Revision1 was imported as ${source.mode}. Later edits keep this original unchanged. ${source.bytes} bytes · SHA256 ${source.sha256}`));
  const report = node('ul', ''); for (const message of findings(source.report)) report.append(node('li', message)); dialog.append(report);
  const download = node('button', 'Download PSD original', { type: 'button', disabled: !state.permissions.export }); download.id = 'psdDownloadOriginal';
  download.onclick = handle(async () => {
    if (state.id !== id) throw new Error('The selected project changed.');
    const response = await fetch(`/api/create/projects/${id}/psd-original`, { credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('The original is unavailable under your current read/export permission.');
    const reader = response.body.getReader(), parts = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX) throw new Error('Invalid original size.'); parts.push(value); } }
    finally { await reader.cancel(); }
    const blob = new Blob(parts, { type: 'image/vnd.adobe.photoshop' }), hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');
    if (size !== source.bytes || hash !== source.sha256 || state.id !== id) throw new Error('The original could not be verified.');
    const url = URL.createObjectURL(blob), link = node('a', '', { href: url, download: title(state.project.name) + '.psd' }); link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
  const close = node('button', 'Close', { type: 'button' }); close.onclick = () => { dialog.close(); dialog.remove(); };
  dialog.addEventListener('cancel', event => { event.preventDefault(); close.click(); }); dialog.append(download, close); document.body.append(dialog); dialog.showModal();
}
export function bindPsd() {
  $('importPsd').onclick = () => $('psdFile').click(); $('choosePsdArtifact').onclick = handle(choosePsd);
  $('psdFile').onchange = handle(async () => { const file = $('psdFile').files[0]; $('psdFile').value = ''; if (file) await importPsdFile(file); });
  $('psdSource').onclick = handle(sourceDetails);
  subscribe(() => { const busy = state.loading || state.saving;
    $('importPsd').disabled = $('choosePsdArtifact').disabled = busy || !state.permissions.create || !state.permissions.read;
    $('psdSource').disabled = busy || !state.id || !state.permissions.read;
  });
}
