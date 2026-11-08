/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | RP-LORA-01: client-side multi-photo picker, drag-and-drop, interactive crop/framing canvas, per-photo captioning, and chunked owner-scoped upload into POST /api/lora/dataset/upload.
 */

const ASPECTS = {
  '1:1': { ratio: 1, width: 1024, height: 1024 },
  '3:4': { ratio: 3 / 4, width: 896, height: 1194 },
  '4:3': { ratio: 4 / 3, width: 1194, height: 896 },
};

const MAX_CHUNK_CHARS = 1_350_000;
const ACCEPTED_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const byId = (id) => document.getElementById(id);
const clamp = (v, min, max) => Math.min(max, Math.max(min, Number(v) || 0));

function loadBitmap(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read image "${file.name}". Choose a PNG, JPEG, or WebP photo.`));
    };
    img.src = url;
  });
}

/** Compute the source crop rectangle in natural image pixels from aspect, zoom, and normalized pan. */
export function computeCropBox(srcW, srcH, aspectKey, zoom, panX, panY) {
  const spec = ASPECTS[aspectKey] || ASPECTS['1:1'];
  const srcRatio = srcW / Math.max(1, srcH);
  const baseW = srcRatio > spec.ratio ? srcH * spec.ratio : srcW;
  const baseH = srcRatio > spec.ratio ? srcH : srcW / spec.ratio;
  const z = clamp(zoom, 1, 3);
  const cropW = Math.max(1, baseW / z);
  const cropH = Math.max(1, baseH / z);
  const sx = Math.max(0, srcW - cropW) * (clamp(panX, -1, 1) + 1) * 0.5;
  const sy = Math.max(0, srcH - cropH) * (clamp(panY, -1, 1) + 1) * 0.5;
  return { sx, sy, sw: cropW, sh: cropH, spec };
}

function drawPreview(canvas, entry) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !entry) return;
  const { sx, sy, sw, sh, spec } = computeCropBox(entry.width, entry.height, entry.aspect, entry.zoom, entry.panX, entry.panY);
  const cw = spec.ratio >= 1 ? 280 : Math.round(280 * spec.ratio);
  const ch = spec.ratio >= 1 ? Math.round(280 / spec.ratio) : 280;
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  ctx.clearRect(0, 0, cw, ch);
  ctx.drawImage(entry.img, sx, sy, sw, sh, 0, 0, cw, ch);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1;
  for (const frac of [1 / 3, 2 / 3]) {
    ctx.beginPath();
    ctx.moveTo(Math.round(cw * frac) + 0.5, 0); ctx.lineTo(Math.round(cw * frac) + 0.5, ch);
    ctx.moveTo(0, Math.round(ch * frac) + 0.5); ctx.lineTo(cw, Math.round(ch * frac) + 0.5);
    ctx.stroke();
  }
}

function renderCroppedDataUrl(entry) {
  const { sx, sy, sw, sh, spec } = computeCropBox(entry.width, entry.height, entry.aspect, entry.zoom, entry.panX, entry.panY);
  const scale = Math.min(1, spec.width / Math.max(1, sw), spec.height / Math.max(1, sh));
  const outW = Math.max(1, Math.round(sw * scale));
  const outH = Math.max(1, Math.round(sh * scale));
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  out.getContext('2d').drawImage(entry.img, sx, sy, sw, sh, 0, 0, outW, outH);
  if (entry.mime === 'image/png') {
    const png = out.toDataURL('image/png');
    if (png.length <= 900_000) return png;
  }
  return out.toDataURL('image/jpeg', 0.9);
}

function chunkPayloads(items) {
  const batches = [];
  let current = [], chars = 0;
  for (const item of items) {
    const len = item.dataBase64.length + item.caption.length + item.name.length + 64;
    if (current.length > 0 && chars + len > MAX_CHUNK_CHARS) { batches.push(current); current = []; chars = 0; }
    current.push(item);
    chars += len;
  }
  if (current.length) batches.push(current);
  return batches;
}

function isOpen(sheet) {
  return Boolean(sheet.open || !sheet.hidden);
}

function syncActiveInputs(st) {
  const cur = st.queue[st.active];
  if (!cur) return;
  cur.name = byId('photoNameInput').value.trim() || cur.name;
  cur.caption = byId('photoCaptionInput').value;
}

function sheetError(msg) {
  const el = byId('photoUploadStatus');
  el.className = msg ? 'result err' : 'result';
  el.textContent = msg || '';
}

function paintActive(st) {
  const cur = st.queue[st.active];
  if (!cur) return;
  byId('photoUploadCount').textContent = `${st.active + 1} of ${st.queue.length} photo${st.queue.length === 1 ? '' : 's'}`;
  byId('photoNameInput').value = cur.name;
  byId('photoCaptionInput').value = cur.caption;
  byId('photoZoomRange').value = String(Math.round(cur.zoom * 100));
  byId('photoPanXRange').value = String(Math.round(cur.panX * 100));
  byId('photoPanYRange').value = String(Math.round(cur.panY * 100));
  st.sheet.querySelectorAll('[data-crop-aspect]').forEach((btn) => {
    btn.setAttribute('aria-checked', btn.dataset.cropAspect === cur.aspect ? 'true' : 'false');
  });
  const thumbs = byId('photoUploadThumbs');
  thumbs.innerHTML = '';
  st.queue.forEach((item, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lora-upload-thumb';
    btn.dataset.noGlass = '';
    btn.dataset.thumbIndex = String(idx);
    btn.setAttribute('aria-current', idx === st.active ? 'true' : 'false');
    btn.setAttribute('aria-label', `Photo ${idx + 1}: ${item.name}`);
    const img = document.createElement('img');
    img.src = item.url; img.alt = '';
    btn.append(img);
    btn.addEventListener('click', () => { if (!st.busy) { syncActiveInputs(st); st.active = idx; paintActive(st); } });
    thumbs.append(btn);
  });
  drawPreview(st.canvas, cur);
}

function closeSheet(st) {
  if (!isOpen(st.sheet)) return;
  if (typeof st.sheet.close === 'function' && st.sheet.open) st.sheet.close();
  st.sheet.hidden = true;
  sheetError('');
  for (const item of st.queue) URL.revokeObjectURL(item.url);
  st.queue = [];
  st.active = 0;
  st.pushedHistory = false;
  st.openBtn.focus({ preventScroll: true });
}

async function ingestFiles(st, fileList) {
  const subject = st.opts.getSubject();
  if (!subject) { st.opts.showStatus('err', 'Choose or create a character before uploading photos.'); return; }
  const files = Array.from(fileList || []).filter(Boolean);
  if (!files.length) return;
  const defaultCap = st.opts.getDefaultCaption() || subject;
  const loaded = [];
  for (const file of files.slice(0, 24 - st.queue.length)) {
    if (file.type && !ACCEPTED_MIMES.has(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name || '')) {
      st.opts.showStatus('err', `"${file.name}" is not a PNG, JPEG, or WebP image.`); return;
    }
    try {
      const bmp = await loadBitmap(file);
      const stem = String(file.name || 'photo').replace(/\.[a-z0-9]{1,8}$/i, '') || 'photo';
      loaded.push({ ...bmp, mime: ACCEPTED_MIMES.has(file.type) ? file.type : 'image/jpeg', name: stem, caption: defaultCap, aspect: '1:1', zoom: 1, panX: 0, panY: 0 });
    } catch (err) {
      for (const item of loaded) URL.revokeObjectURL(item.url);
      st.opts.showStatus('err', err.message); return;
    }
  }
  if (!loaded.length) return;
  if (!st.queue.length) st.active = 0;
  st.queue.push(...loaded);
  sheetError('');
  if (!isOpen(st.sheet)) {
    st.sheet.hidden = false;
    if (typeof st.sheet.showModal === 'function' && !st.sheet.open) st.sheet.showModal();
    history.pushState({ loraPhotoSheet: true }, '');
    st.pushedHistory = true;
  }
  paintActive(st);
  byId('photoCaptionInput').focus({ preventScroll: true });
}

async function submitQueue(st) {
  if (st.busy || !st.queue.length) return;
  syncActiveInputs(st);
  const subject = st.opts.getSubject();
  if (!subject) { sheetError('Choose a character first.'); return; }
  const blankIdx = st.queue.findIndex((item) => !item.caption.trim());
  if (blankIdx >= 0) {
    st.active = blankIdx; paintActive(st);
    sheetError(`Enter a caption for photo ${blankIdx + 1} (${st.queue[blankIdx].name}).`);
    byId('photoCaptionInput').focus(); return;
  }
  st.busy = true; byId('photoUploadSaveBtn').disabled = true; sheetError('');
  try {
    const encoded = st.queue.map((item) => ({ name: item.name, caption: item.caption.trim(), dataBase64: renderCroppedDataUrl(item) }));
    let savedCount = 0, lastMessage = '';
    for (const photos of chunkPayloads(encoded)) {
      const res = await fetch('/api/lora/dataset/upload', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject, photos }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || body.message || `Upload failed (HTTP ${res.status}).`);
      savedCount += Number(body.count || photos.length);
      lastMessage = body.message || '';
    }
    closeSheet(st);
    await st.opts.onUploaded(savedCount, lastMessage || `${savedCount} photo${savedCount === 1 ? '' : 's'} saved to ${subject}'s dataset.`);
  } catch (err) {
    sheetError(err.message);
  } finally {
    st.busy = false; byId('photoUploadSaveBtn').disabled = false;
  }
}

function bindCropControls(st) {
  st.sheet.querySelectorAll('[data-crop-aspect]').forEach((btn) => {
    btn.addEventListener('click', () => { const cur = st.queue[st.active]; if (cur && !st.busy) { cur.aspect = btn.dataset.cropAspect; paintActive(st); } });
  });
  for (const [id, key, min, max] of [['photoZoomRange', 'zoom', 1, 3], ['photoPanXRange', 'panX', -1, 1], ['photoPanYRange', 'panY', -1, 1]]) {
    byId(id).addEventListener('input', (e) => { const cur = st.queue[st.active]; if (cur) { cur[key] = clamp(Number(e.target.value) / 100, min, max); drawPreview(st.canvas, cur); } });
  }
  let drag = null;
  st.canvas.addEventListener('pointerdown', (e) => {
    const cur = st.queue[st.active]; if (!cur || st.busy) return;
    st.canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, panX: cur.panX, panY: cur.panY };
  });
  st.canvas.addEventListener('pointermove', (e) => {
    const cur = st.queue[st.active]; if (!cur || !drag) return;
    cur.panX = clamp(drag.panX - ((e.clientX - drag.x) / Math.max(80, st.canvas.clientWidth)) * 2, -1, 1);
    cur.panY = clamp(drag.panY - ((e.clientY - drag.y) / Math.max(80, st.canvas.clientHeight)) * 2, -1, 1);
    byId('photoPanXRange').value = String(Math.round(cur.panX * 100));
    byId('photoPanYRange').value = String(Math.round(cur.panY * 100));
    drawPreview(st.canvas, cur);
  });
  st.canvas.addEventListener('pointerup', () => { drag = null; });
  st.canvas.addEventListener('pointercancel', () => { drag = null; });
}

export function mountPhotoUpload(opts) {
  const st = { opts, sheet: byId('photoUploadSheet'), fileInput: byId('uploadPhotosInput'), openBtn: byId('uploadPhotosBtn'), dropZone: byId('datasetPanel'), canvas: byId('photoCropCanvas'), queue: [], active: 0, busy: false, pushedHistory: false };
  if (!st.sheet || !st.fileInput || !st.openBtn || !st.canvas) return;
  st.openBtn.addEventListener('click', () => { st.fileInput.value = ''; st.fileInput.click(); });
  byId('photoUploadAddBtn').addEventListener('click', () => { if (!st.busy) { syncActiveInputs(st); st.fileInput.value = ''; st.fileInput.click(); } });
  st.fileInput.addEventListener('change', () => { void ingestFiles(st, st.fileInput.files); });
  byId('photoUploadRemoveBtn').addEventListener('click', () => {
    if (st.busy || !st.queue.length) return;
    const [removed] = st.queue.splice(st.active, 1);
    if (removed) URL.revokeObjectURL(removed.url);
    if (!st.queue.length) { closeSheet(st); return; }
    st.active = Math.min(st.active, st.queue.length - 1); paintActive(st);
  });
  for (const id of ['photoUploadCloseBtn', 'photoUploadCancelBtn']) byId(id).addEventListener('click', () => { if (!st.busy) closeSheet(st); });
  st.sheet.addEventListener('cancel', (e) => { e.preventDefault(); if (!st.busy) closeSheet(st); });
  st.sheet.addEventListener('click', (e) => { if (e.target === st.sheet && !st.busy) closeSheet(st); });
  window.addEventListener('popstate', () => { if (isOpen(st.sheet)) closeSheet(st); });
  byId('photoNameInput').addEventListener('input', () => syncActiveInputs(st));
  byId('photoCaptionInput').addEventListener('input', () => syncActiveInputs(st));
  byId('photoUploadSaveBtn').addEventListener('click', () => { void submitQueue(st); });
  bindCropControls(st);
  if (st.dropZone) {
    st.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); st.dropZone.classList.add('lora-drop-active'); });
    st.dropZone.addEventListener('dragleave', (e) => { if (!st.dropZone.contains(e.relatedTarget)) st.dropZone.classList.remove('lora-drop-active'); });
    st.dropZone.addEventListener('drop', (e) => { e.preventDefault(); st.dropZone.classList.remove('lora-drop-active'); if (e.dataTransfer?.files?.length) void ingestFiles(st, e.dataTransfer.files); });
  }
}
