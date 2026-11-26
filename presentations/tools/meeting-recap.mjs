/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 2.20.14: Meeting Recap UI controller — chunked multi-GB upload, 7-stage progress tracker, cropped keyframe gallery, timeline/summary previews, explicit Save to Files, and in-page delete confirm.
 */

const API_BASE = '/api/presentations/recap';
const CHUNK_SIZE = 4 * 1024 * 1024;
const INLINE_LIMIT = 4 * 1024 * 1024;
const STAGES = [
  { key: 'queued', label: '1. Intake' },
  { key: 'extracting', label: '2. Audio' },
  { key: 'transcribing', label: '3. Transcribe' },
  { key: 'detecting_scenes', label: '4. Scenes' },
  { key: 'assembling_timeline', label: '5. Timeline' },
  { key: 'summarizing', label: '6. Notes' },
  { key: 'rendering_deck', label: '7. Deck' },
];
const STAGE_ORDER = new Map(STAGES.map((s, i) => [s.key, i]));

const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

let activeJobId = null;
let pendingDeleteId = null;

/** Call JSON API endpoint cleanly with structured error handling. */
async function apiJson(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
  return data;
}

/** Convert File or Blob into base64 string for small inline uploads. */
async function fileToBase64(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) {
    bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Update intake form status message safely via textContent. */
function setFormStatus(msg, isError = false) {
  const node = $('mr-form-status');
  node.textContent = msg || '';
  node.classList.toggle('err', Boolean(isError));
}

/** Format byte size into readable KB/MB label. */
function fmtBytes(bytes) {
  const n = Number(bytes || 0);
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/** Render the 7-stage progress bar for the active recap job. */
function paintStages(job) {
  const list = $('mr-stage-list');
  const currentIdx = job.status === 'completed' ? STAGES.length : (STAGE_ORDER.get(job.status) ?? 0);
  const items = STAGES.map((stage, idx) => {
    let label = stage.label;
    if (stage.key === 'transcribing' && job.totalMinutes > 0) {
      label = `3. Transcribe (${job.minutesProcessed.toFixed(1)}/${job.totalMinutes.toFixed(1)}m)`;
    }
    const li = el('li', 'mr-stage', label);
    if (job.status === 'failed' && idx === currentIdx) li.classList.add('failed');
    else if (idx < currentIdx || job.status === 'completed') li.classList.add('done');
    else if (idx === currentIdx) li.classList.add('active');
    return li;
  });
  list.replaceChildren(...items);
}

/** Render structured Stage 6 summary notes and verbatim timestamped quotes via DOM APIs. */
function paintSummary(notes) {
  const host = $('mr-summary-view');
  if (!notes) { host.replaceChildren(el('p', 'mr-hint', 'Summary notes will appear once processing completes.')); return; }
  const nodes = [el('p', '', notes.overview || '')];
  for (const sec of notes.sections || []) {
    const block = el('div', 'mr-sec-block');
    block.append(el('strong', '', `${sec.title} (${sec.startSec}s – ${sec.endSec}s)`));
    const ul = el('ul');
    for (const b of sec.bullets || []) ul.append(el('li', '', b));
    block.append(ul);
    for (const q of sec.quotes || []) {
      block.append(el('blockquote', 'mr-quote', `"${q.text}" — [${q.timestamp || q.timestampSec}]`));
    }
    nodes.push(block);
  }
  if (notes.decisions?.length) {
    const dec = el('div', 'mr-sec-block');
    dec.append(el('strong', '', 'Decisions'));
    const ul = el('ul');
    for (const d of notes.decisions) ul.append(el('li', '', d));
    dec.append(ul);
    nodes.push(dec);
  }
  if (notes.actionItems?.length) {
    const act = el('div', 'mr-sec-block');
    act.append(el('strong', '', 'Action items'));
    const ul = el('ul');
    for (const a of notes.actionItems) ul.append(el('li', '', a));
    act.append(ul);
    nodes.push(act);
  }
  host.replaceChildren(...nodes);
}

/** Render cropped keyframe gallery safely without innerHTML. */
function paintGallery(keyframes) {
  const host = $('mr-keyframe-gallery');
  if (!keyframes?.length) {
    host.replaceChildren(el('p', 'mr-hint', 'No visual scene changes captured (audio-only recording).'));
    return;
  }
  const figures = keyframes.map((kf) => {
    const fig = el('figure', 'mr-kf-figure');
    const img = document.createElement('img');
    img.src = kf.url;
    img.alt = kf.label || `Scene ${kf.index}`;
    img.loading = 'lazy';
    fig.append(img, el('figcaption', '', `${kf.timestamp || ''} · ${kf.label || `Scene ${kf.index}`}`));
    return fig;
  });
  host.replaceChildren(...figures);
}

/** Render downloadable artifact cards (timeline.md, summary.md, review.pptx). */
function paintArtifacts(artifacts) {
  const host = $('mr-artifacts');
  if (!artifacts?.length) { host.hidden = true; return; }
  host.hidden = false;
  const cards = artifacts.map((art) => {
    const card = el('div', 'mr-art-card');
    card.dataset.artifact = art.name;
    card.append(el('div', 'mr-art-title', art.label || art.name));
    card.append(el('div', 'mr-art-meta', `${art.name} · ${fmtBytes(art.bytes)}`));
    const link = el('a', 'mr-btn mr-btn-secondary', `Download ${art.name}`);
    link.href = art.url;
    link.download = art.name;
    card.append(link);
    return card;
  });
  host.replaceChildren(...cards);
}

/** Display a loaded recap job including progress, artifacts, cropped captures, and timeline. */
async function renderActiveJob(job) {
  activeJobId = job.id;
  $('mr-active-section').hidden = false;
  $('mr-active-title').textContent = job.title || 'Meeting Recap';
  const dur = job.durationSeconds != null ? `${Math.round(job.durationSeconds)}s` : 'pending';
  $('mr-active-meta').textContent = `${job.sourceFilename} · ${fmtBytes(job.sourceBytes)} · duration ${dur} · crop ${job.cropMode} · status: ${job.status}`;
  paintStages(job);

  const banner = $('mr-active-banner');
  if (job.status === 'failed') {
    banner.hidden = false;
    banner.className = 'mr-banner err';
    banner.textContent = job.errorMessage || 'Meeting recap failed.';
  } else if (job.stageMessage) {
    banner.hidden = false;
    banner.className = job.status === 'completed' ? 'mr-banner ok' : 'mr-banner';
    banner.textContent = job.stageMessage;
  } else {
    banner.hidden = true;
  }

  const completed = job.status === 'completed';
  $('mr-save-files-btn').hidden = !completed;
  const openLink = $('mr-open-office-link');
  if (job.savedDeckOpenUrl) {
    openLink.href = job.savedDeckOpenUrl;
    openLink.hidden = false;
  } else {
    openLink.hidden = true;
  }

  paintArtifacts(job.artifacts || []);
  $('mr-results-grid').hidden = !completed;
  if (completed) {
    paintSummary(job.notes);
    paintGallery(job.keyframes || []);
    try {
      const resp = await fetch(`${API_BASE}/jobs/${job.id}/artifacts/timeline.md`, { credentials: 'same-origin' });
      $('mr-timeline-view').textContent = resp.ok ? await resp.text() : 'Timeline preview unavailable.';
    } catch {
      $('mr-timeline-view').textContent = 'Timeline preview unavailable.';
    }
  }
}

/** Load and paint the signed-in owner's recap history list. */
async function refreshHistory() {
  const list = $('mr-history-list');
  try {
    const { jobs } = await apiJson('/jobs');
    if (!jobs?.length) {
      list.replaceChildren(el('p', 'mr-hint', 'No meeting recaps yet. Upload a recording above to create your first recap.'));
      return;
    }
    const rows = jobs.map((job) => {
      const row = el('div', 'mr-history-row');
      row.dataset.jobId = job.id;
      const info = el('div', 'mr-history-info');
      info.append(el('div', 'mr-history-title', job.title || job.sourceFilename));
      info.append(el('div', 'mr-history-meta', `${job.status} · ${job.keyframesCount} captures · ${fmtBytes(job.sourceBytes)}`));
      const btns = el('div', 'mr-history-btns');
      const openBtn = el('button', 'mr-btn mr-btn-secondary', 'Open');
      openBtn.type = 'button';
      openBtn.addEventListener('click', async () => {
        const detail = await apiJson(`/jobs/${job.id}`);
        await renderActiveJob(detail.job);
      });
      const delBtn = el('button', 'mr-btn mr-btn-ghost', 'Delete');
      delBtn.type = 'button';
      delBtn.addEventListener('click', () => openDeleteConfirm(job));
      btns.append(openBtn, delBtn);
      row.append(info, btns);
      return row;
    });
    list.replaceChildren(...rows);
  } catch (err) {
    list.replaceChildren(el('p', 'mr-status err', `Could not load recaps: ${err.message}`));
  }
}

/** Open in-page delete confirmation modal (never native confirm()). */
function openDeleteConfirm(job) {
  pendingDeleteId = job.id;
  $('mr-confirm-title').textContent = `Delete "${job.title || job.sourceFilename}"?`;
  $('mr-confirm-dialog').showModal();
}

/** Upload large recording in sequential 4 MiB chunks to avoid buffering in RAM. */
async function uploadChunked(jobId, file) {
  let offset = 0;
  let index = 0;
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  while (offset < file.size) {
    index += 1;
    setFormStatus(`Uploading chunk ${index} of ${totalChunks}…`);
    const slice = file.slice(offset, Math.min(file.size, offset + CHUNK_SIZE));
    const resp = await fetch(`${API_BASE}/jobs/${jobId}/chunk`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: await slice.arrayBuffer(),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.message || body.error || `Chunk upload failed (${resp.status})`);
    }
    offset += CHUNK_SIZE;
  }
}

/** Submit either inline or multi-GB chunked upload and return completed job object. */
async function submitRecording(file, fields) {
  if (file.size <= INLINE_LIMIT) {
    setFormStatus('Uploading recording and running 7-stage recap pipeline…');
    const mediaBase64 = await fileToBase64(file);
    const res = await apiJson('/jobs', {
      method: 'POST',
      body: JSON.stringify({ ...fields, sourceFilename: file.name, mediaBase64, autoRun: true }),
    });
    return res.job;
  }
  setFormStatus('Initializing chunked upload…');
  const created = await apiJson('/jobs', {
    method: 'POST',
    body: JSON.stringify({ ...fields, mode: 'chunked', sourceFilename: file.name }),
  });
  await uploadChunked(created.job.id, file);
  setFormStatus('Running 7-stage recap pipeline…');
  const ran = await apiJson(`/jobs/${created.job.id}/run`, {
    method: 'POST',
    body: JSON.stringify({ cropMode: fields.cropMode, sampleIntervalSec: fields.sampleIntervalSec, theme: fields.theme }),
  });
  return ran.job;
}

/** Handle intake form submission (auto-chooses inline vs chunked upload, then runs pipeline). */
async function onSubmitForm(event) {
  event.preventDefault();
  const file = $('mr-media-file').files?.[0];
  if (!file) { setFormStatus('Choose a recording file first.', true); return; }
  const btn = $('mr-start-btn');
  btn.disabled = true;
  try {
    const trFile = $('mr-transcript-file').files?.[0];
    const fields = {
      title: $('mr-title').value.trim() || file.name.replace(/\.[^.]+$/, ''),
      cropMode: $('mr-crop-mode').value,
      sampleIntervalSec: $('mr-interval').value,
      theme: $('mr-theme').value,
      transcriptText: trFile ? await trFile.text() : undefined,
      transcriptFormat: trFile ? trFile.name.split('.').pop() : undefined,
    };
    const resultJob = await submitRecording(file, fields);
    setFormStatus('Recap complete.');
    await renderActiveJob(resultJob);
    await refreshHistory();
  } catch (err) {
    setFormStatus(err.message || 'Meeting recap failed.', true);
    await refreshHistory();
  } finally {
    btn.disabled = false;
  }
}

/** Save active recap deck through explicit ADR-108 storage-target action. */
async function onSaveToFiles() {
  if (!activeJobId) return;
  const btn = $('mr-save-files-btn');
  btn.disabled = true;
  try {
    const saved = await apiJson(`/jobs/${activeJobId}/save`, {
      method: 'POST',
      body: JSON.stringify({ includeNotes: true }),
    });
    const banner = $('mr-active-banner');
    banner.hidden = false;
    banner.className = 'mr-banner ok';
    banner.textContent = `Saved to ${saved.provider}: ${saved.savedTo}`;
    const openLink = $('mr-open-office-link');
    if (saved.openUrl) {
      openLink.href = saved.openUrl;
      openLink.hidden = false;
    }
  } catch (err) {
    const banner = $('mr-active-banner');
    banner.hidden = false;
    banner.className = 'mr-banner err';
    banner.textContent = `Save failed: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

/** Wire DOM events and hydrate initial owner recap list. */
function boot() {
  $('mr-form').addEventListener('submit', onSubmitForm);
  $('mr-save-files-btn').addEventListener('click', onSaveToFiles);
  $('mr-refresh-btn').addEventListener('click', refreshHistory);
  $('mr-confirm-cancel').addEventListener('click', () => { pendingDeleteId = null; $('mr-confirm-dialog').close(); });
  $('mr-confirm-ok').addEventListener('click', async () => {
    const id = pendingDeleteId;
    pendingDeleteId = null;
    $('mr-confirm-dialog').close();
    if (!id) return;
    await apiJson(`/jobs/${id}`, { method: 'DELETE' });
    if (activeJobId === id) {
      activeJobId = null;
      $('mr-active-section').hidden = true;
    }
    await refreshHistory();
  });
  document.documentElement.dataset.recapReady = 'true';
  void refreshHistory();
}

boot();
