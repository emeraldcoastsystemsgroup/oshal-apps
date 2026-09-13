/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the surface's behaviour: job list, capture
 *                     |                             | (photos / video / point cloud), view assignment, the ruler
 *                     |                             | measurement, reconstruct, the report card, the drawing, the
 *                     |                             | STL viewer, printers and the confirmed print step. Every node
 *                     |                             | is built with textContent — nothing from the API is ever
 *                     |                             | interpolated into markup — and every write goes through one
 *                     |                             | `api()` helper with same-origin credentials. Honours the
 *                     |                             | ADR-139 `artifact` URL parameter: an image sent from anywhere
 *                     |                             | in the swarm becomes the first photo of a new job.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Phone camera capture: a live viewfinder (rear camera first,
 *                     |                             | flip), one-tap capture per view with framing guidance, and a
 *                     |                             | countdown "record six views" sequence. Each frame is bounded
 *                     |                             | to 1280 px, uploaded through the existing images route and
 *                     |                             | assigned its view, so the engine's input contract is
 *                     |                             | unchanged. A capture=environment file input is the fallback
 *                     |                             | when the browser will not hand this page a live camera.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | "Open in CAD Studio": the job's outlines (the new contours
 *                     |                             | artifact) become a CAD Studio part with a `contours` base, then
 *                     |                             | the cockpit switches to that app. Refuses honestly when the
 *                     |                             | package is not installed or not granted.
 */
(function () {
  'use strict';
  const BASE = '/api/scan-to-print';
  const $ = (id) => document.getElementById(id);
  const state = { jobs: [], job: null, detail: null, capabilities: null, printers: [], viewer: null, showMask: false };

  /** One fetch helper: JSON in, JSON out, errors as Error with the server's message. */
  async function api(path, opts) {
    const init = Object.assign({ credentials: 'same-origin', headers: {} }, opts || {});
    if (init.json !== undefined) { init.body = JSON.stringify(init.json); init.headers['Content-Type'] = 'application/json'; delete init.json; }
    const res = await fetch(BASE + path, init);
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = { raw: text }; }
    if (!res.ok) { const err = new Error((body && (body.message || body.error)) || ('HTTP ' + res.status)); err.status = res.status; err.body = body; throw err; }
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
    t.textContent = message;
    t.className = 'toast ' + (kind || 'info');
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 5000);
  }
  const fmt = (v, d) => (Number.isFinite(Number(v)) ? Number(v).toFixed(d === undefined ? 1 : d) : '—');

  // ── Jobs ────────────────────────────────────────────────────────────────────
  async function loadJobs() {
    state.jobs = (await api('/jobs')).jobs;
    const list = $('job-list');
    list.replaceChildren();
    if (!state.jobs.length) list.appendChild(el('p', { class: 'muted', text: 'No objects yet. Create one to begin.' }));
    state.jobs.forEach((job) => {
      const item = el('button', { class: 'job-item' + (state.job && state.job.job_id === job.job_id ? ' active' : ''), onclick: () => openJob(job.job_id) }, [
        el('span', { class: 'job-title', text: job.title }),
        el('span', { class: 'badge ' + job.state, text: job.state }),
      ]);
      list.appendChild(item);
    });
  }
  async function createJob() {
    const title = window.prompt('Name the object (e.g. "phone stand")');
    if (!title || !title.trim()) return;
    const { job } = await api('/jobs', { method: 'POST', json: { title: title.trim() } });
    await loadJobs();
    await openJob(job.job_id);
  }
  async function openJob(jobId) {
    state.detail = await api('/jobs/' + jobId);
    state.job = state.detail.job;
    await loadJobs();
    renderJob();
  }
  async function deleteJob() {
    if (!state.job || !window.confirm('Delete "' + state.job.title + '" and all its files?')) return;
    closeCamera();
    await api('/jobs/' + state.job.job_id, { method: 'DELETE' });
    state.job = null; state.detail = null;
    $('job-panel').hidden = true; $('empty-panel').hidden = false;
    await loadJobs();
  }

  // ── Job panel ──────────────────────────────────────────────────────────────
  function renderJob() {
    const { job, images, artifacts } = state.detail;
    $('empty-panel').hidden = true; $('job-panel').hidden = false;
    $('job-heading').textContent = job.title;
    $('job-state').textContent = job.state + ' · ' + job.source_kind;
    $('job-state').className = 'badge ' + job.state;
    renderImages(images);
    renderDimensions(job);
    renderSettings(job);
    renderReport(job.report, artifacts);
    renderPrint(artifacts);
    loadSubmissions();
  }

  function renderImages(images) {
    const grid = $('image-grid');
    grid.replaceChildren();
    const views = ['front', 'back', 'left', 'right', 'top', 'bottom'];
    images.forEach((img) => {
      const src = BASE + '/jobs/' + state.job.job_id + '/images/' + img.image_id + '/file?kind=' + (state.showMask ? 'mask' : 'source') + '&t=' + Date.parse(img.created_at);
      const select = el('select', { onchange: (ev) => assignView(img.image_id, ev.target.value) }, [el('option', { value: '', text: 'unassigned' })].concat(views.map((v) => el('option', { value: v, text: v }))));
      select.value = img.view || '';
      const warnings = (img.silhouette && img.silhouette.warnings) || [];
      const stats = (img.silhouette && img.silhouette.stats) || {};
      grid.appendChild(el('div', { class: 'image-card' + (img.view ? ' assigned' : '') }, [
        el('img', { src, alt: img.file_name }),
        el('div', { class: 'image-meta' }, [
          el('span', { class: 'muted small', text: img.file_name + ' · ' + img.width + '×' + img.height + ' · ' + fmt((stats.coverage || 0) * 100, 0) + '% of frame' }),
          select,
          el('button', { class: 'link danger', text: 'remove', onclick: () => removeImage(img.image_id) }),
        ]),
        warnings.length ? el('ul', { class: 'warnings small' }, warnings.map((w) => el('li', { text: w }))) : el('span'),
      ]));
    });
    $('assigned-summary').textContent = 'Assigned: ' + (images.filter((i) => i.view).map((i) => i.view).join(', ') || 'none') + '. Minimum for a solid: front, top and right.';
  }
  async function assignView(imageId, view) {
    try { await api('/jobs/' + state.job.job_id + '/images/' + imageId, { method: 'PATCH', json: { view: view || null } }); await openJob(state.job.job_id); } catch (e) { toast(e.message, 'error'); }
  }
  async function removeImage(imageId) {
    try { await api('/jobs/' + state.job.job_id + '/images/' + imageId, { method: 'DELETE' }); await openJob(state.job.job_id); } catch (e) { toast(e.message, 'error'); }
  }
  async function uploadPhotos(files) {
    if (!files.length) return;
    const form = new FormData();
    Array.from(files).slice(0, 12).forEach((f) => form.append('images', f, f.name));
    try { toast('Extracting silhouettes…'); await api('/jobs/' + state.job.job_id + '/images', { method: 'POST', body: form }); await openJob(state.job.job_id); toast('Photos added.'); } catch (e) { toast(e.message, 'error'); }
  }
  async function uploadVideo(file) {
    if (!file) return;
    const form = new FormData();
    form.append('video', file, file.name);
    try { toast('Extracting frames…'); const out = await api('/jobs/' + state.job.job_id + '/video', { method: 'POST', body: form }); await openJob(state.job.job_id); toast(out.frames + ' frames added — assign the square-on ones to views.'); } catch (e) { toast(e.message, 'error'); }
  }
  async function uploadPointCloud(file) {
    if (!file) return;
    const form = new FormData();
    form.append('model', file, file.name);
    form.append('voxelMm', $('pc-voxel').value);
    form.append('unitScale', $('pc-units').value);
    form.append('up', $('pc-up').value);
    try { toast('Voxelising point cloud…'); const out = await api('/jobs/' + state.job.job_id + '/pointcloud', { method: 'POST', body: form }); await openJob(state.job.job_id); toast(out.closed ? 'Point cloud closed and filled.' : 'Surface did not close — see the report.', out.closed ? 'ok' : 'error'); } catch (e) { toast(e.message, 'error'); }
  }

  // ── Dimensions + settings ──────────────────────────────────────────────────
  function renderDimensions(job) {
    const dims = { x: '', y: '', z: '' };
    (job.known_dimensions || []).forEach((d) => { dims[d.axis] = d.mm; });
    $('dim-x').value = dims.x; $('dim-y').value = dims.y; $('dim-z').value = dims.z;
  }
  async function saveDimensions() {
    const known = ['x', 'y', 'z'].map((a) => ({ axis: a, mm: Number($('dim-' + a).value) })).filter((d) => d.mm > 0);
    if (!known.length) { toast('Enter at least one measurement in millimetres.', 'error'); return; }
    try { await api('/jobs/' + state.job.job_id, { method: 'PATCH', json: { knownDimensions: known } }); await openJob(state.job.job_id); toast('Scale saved.'); } catch (e) { toast(e.message, 'error'); }
  }
  function renderSettings(job) {
    const s = job.settings || {};
    const limits = state.capabilities ? state.capabilities.limits : { resolution: { default: 96, min: 16, max: 198 }, smoothIterations: { default: 2, min: 0, max: 10 } };
    $('res').min = limits.resolution.min; $('res').max = limits.resolution.max; $('res').value = s.resolution || limits.resolution.default;
    $('smooth').min = limits.smoothIterations.min; $('smooth').max = limits.smoothIterations.max; $('smooth').value = s.smoothIterations === undefined ? limits.smoothIterations.default : s.smoothIterations;
    $('res-label').textContent = $('res').value; $('smooth-label').textContent = $('smooth').value;
  }
  async function reconstruct() {
    const settings = { resolution: Number($('res').value), smoothIterations: Number($('smooth').value) };
    try {
      $('reconstruct').disabled = true; toast('Carving the visual hull…');
      await api('/jobs/' + state.job.job_id, { method: 'PATCH', json: { settings } });
      const out = await api('/jobs/' + state.job.job_id + '/reconstruct', { method: 'POST', json: settings });
      await openJob(state.job.job_id);
      toast('Reconstructed in ' + out.durationMs + ' ms — ' + out.report.triangleCount + ' facets.', 'ok');
    } catch (e) { toast(e.message, 'error'); await openJob(state.job.job_id); } finally { $('reconstruct').disabled = false; }
  }

  // ── Report, drawing, viewer ────────────────────────────────────────────────
  function renderReport(report, artifacts) {
    const card = $('report');
    card.replaceChildren();
    $('drawing-wrap').hidden = !artifacts.svg;
    $('viewer-wrap').hidden = !artifacts.stl;
    if (!report) { card.appendChild(el('p', { class: 'muted', text: 'Not reconstructed yet.' })); if (state.viewer) state.viewer.clear(); return; }
    const src = report.dimensionSources || {};
    const rows = [
      ['Extents (X × Y × Z)', fmt(report.sizeMm.x) + ' × ' + fmt(report.sizeMm.y) + ' × ' + fmt(report.sizeMm.z) + ' mm  (' + src.x + ' / ' + src.y + ' / ' + src.z + ')'],
      ['Method', report.method], ['Voxel', fmt(report.voxelMm, 2) + ' mm · grid ' + report.gridDims.nx + '×' + report.gridDims.ny + '×' + report.gridDims.nz],
      ['Volume', fmt(report.gridVolumeMm3 / 1000, 2) + ' cm³ (mesh ' + fmt(report.meshVolumeMm3 / 1000, 2) + ' cm³) · surface ' + fmt(report.surfaceAreaMm2 / 100, 1) + ' cm²'],
      ['Mesh', report.triangleCount + ' facets, ' + report.vertexCount + ' vertices · χ = ' + report.validation.eulerCharacteristic],
      ['Printable', report.printable ? 'yes — watertight, consistently wound, outward-facing' : 'NO — ' + report.validation.openEdges + ' open edges, ' + report.validation.degenerate + ' degenerate facets'],
    ];
    const dl = el('dl', {}, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]));
    card.appendChild(dl);
    if (report.warnings.length) card.appendChild(el('ul', { class: 'warnings' }, report.warnings.map((w) => el('li', { text: w }))));
    card.appendChild(el('ul', { class: 'limits' }, report.limitations.map((w) => el('li', { text: w }))));
    const links = el('p', { class: 'downloads' });
    ['stl', 'obj', 'svg', 'report', 'gcode'].forEach((k) => { if (artifacts[k]) links.appendChild(el('a', { href: BASE + '/jobs/' + state.job.job_id + '/artifacts/' + k + '?download', text: k.toUpperCase() })); });
    if (artifacts.contours) links.appendChild(el('button', { class: 'link', text: 'Open in CAD Studio →', title: 'The front / top / right outlines become a real CAD part (holes, fillets, STEP)', onclick: openInCadStudio }));
    card.appendChild(links);
    if (artifacts.svg) $('drawing').src = BASE + '/jobs/' + state.job.job_id + '/artifacts/svg?t=' + Date.parse(state.job.updated_at);
    if (artifacts.stl) loadStl();
  }
  async function loadStl() {
    try {
      if (!state.viewer) state.viewer = window.ScanToPrintViewer.mount($('viewer'));
      const res = await fetch(BASE + '/jobs/' + state.job.job_id + '/artifacts/stl', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('STL fetch failed');
      const info = state.viewer.load(await res.arrayBuffer());
      $('viewer-info').textContent = info.triangles + ' facets · ' + fmt(info.size[0]) + ' × ' + fmt(info.size[1]) + ' × ' + fmt(info.size[2]) + ' mm · drag to orbit, wheel to zoom, shift-drag to pan';
    } catch (e) { $('viewer-info').textContent = e.message; }
  }

  // ── Printers + print ───────────────────────────────────────────────────────
  async function loadPrinters() {
    const out = await api('/printers');
    state.printers = out.printers;
    const sel = $('printer');
    sel.replaceChildren(el('option', { value: '', text: state.printers.length ? 'choose a printer' : 'no printers registered' }));
    state.printers.forEach((p) => sel.appendChild(el('option', { value: p.printer_id, text: p.label + ' (' + p.kind + ', ' + p.base_url + ')' })));
    $('slicer-note').textContent = out.slicerConfigured ? 'A slicer is configured on this swarm: G-code is produced on demand.' : 'No slicer is configured on this swarm (SCAN_TO_PRINT_SLICER_CMD). Send the STL to an OctoPrint host that slices, or download the STL and slice it yourself.';
    const list = $('printer-list');
    list.replaceChildren();
    state.printers.forEach((p) => list.appendChild(el('li', {}, [
      el('span', { text: p.label + ' · ' + p.kind + ' · ' + p.base_url + ' ' }),
      el('button', { class: 'link', text: 'status', onclick: () => printerStatus(p.printer_id) }),
      el('button', { class: 'link danger', text: 'remove', onclick: () => removePrinter(p.printer_id) }),
    ])));
  }
  async function addPrinter(ev) {
    ev.preventDefault();
    const json = { label: $('p-label').value, kind: $('p-kind').value, baseUrl: $('p-url').value, apiKey: $('p-key').value };
    try { await api('/printers', { method: 'POST', json }); $('p-label').value = ''; $('p-url').value = ''; $('p-key').value = ''; await loadPrinters(); toast('Printer saved. The key is stored encrypted and never shown again.', 'ok'); } catch (e) { toast(e.message, 'error'); }
  }
  async function removePrinter(id) { try { await api('/printers/' + id, { method: 'DELETE' }); await loadPrinters(); } catch (e) { toast(e.message, 'error'); } }
  async function printerStatus(id) {
    try { const out = await api('/printers/' + id + '/status', { method: 'POST' }); toast(out.printer.label + ': ' + out.status.state, 'ok'); } catch (e) { toast('Printer did not answer: ' + ((e.body && e.body.status && e.body.status.state) || e.message), 'error'); }
  }
  function renderPrint(artifacts) {
    $('print-step').hidden = !artifacts.stl;
    loadPrinters().catch((e) => toast(e.message, 'error'));
  }
  async function sendToPrinter() {
    const printerId = $('printer').value;
    if (!printerId) { toast('Choose a printer first.', 'error'); return; }
    const fileKind = $('file-kind').value;
    const startPrint = $('start-print').checked;
    const printer = state.printers.find((p) => p.printer_id === printerId);
    const ok = window.confirm('Send "' + state.job.title + '" as ' + fileKind.toUpperCase() + ' to ' + printer.label + (startPrint ? ' AND START PRINTING' : '') + '?\n\nThis leaves the swarm and reaches your printer host.');
    if (!ok) return;
    try {
      $('send').disabled = true;
      const out = await api('/jobs/' + state.job.job_id + '/print', { method: 'POST', json: { printerId, fileKind, startPrint, confirm: true } });
      toast(out.outcome.message, 'ok');
      await loadSubmissions();
    } catch (e) { toast(e.message, 'error'); await loadSubmissions(); } finally { $('send').disabled = false; }
  }
  async function loadSubmissions() {
    if (!state.job) return;
    try {
      const { submissions } = await api('/jobs/' + state.job.job_id + '/submissions');
      const list = $('submissions');
      list.replaceChildren();
      submissions.forEach((s) => list.appendChild(el('li', { class: s.state }, [el('span', { text: new Date(s.created_at).toLocaleString() + ' · ' + s.file_name + ' · ' + s.state + (s.failure_reason ? ' — ' + s.failure_reason : '') })])));
    } catch (_) { /* the list is informational */ }
  }

  // ── Hand-off to CAD Studio: the outlines become a B-rep part ─────────────
  async function openInCadStudio() {
    if (!state.job) return;
    try {
      const contours = await api('/jobs/' + state.job.job_id + '/artifacts/contours');
      const res = await fetch('/api/cad-studio/models', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: state.job.title, base: { kind: 'contours', views: contours.views, size: contours.sizeMm }, source: { kind: 'scan', jobId: state.job.job_id, title: state.job.title } }) });
      if (res.status === 404 || res.status === 401 || res.status === 403) throw new Error('CAD Studio is not installed on this swarm, or you are not granted access to it.');
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((out.build && (out.build.reason || out.build.error)) || out.message || out.error || ('HTTP ' + res.status));
      toast('Opened in CAD Studio as "' + out.model.title + '" (revision ' + out.model.revision + ').', 'ok');
      (window.top || window).location.assign('/cockpit/?app=cad-studio');
    } catch (e) { toast(e.message, 'error'); }
  }

  // ── ADR-139: an image sent from elsewhere becomes the first photo of a new job ──
  async function intakeArtifact(ref) {
    try {
      const res = await fetch('/api/artifacts/handles/' + encodeURIComponent(ref) + '/content', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('The sent image could not be fetched (' + res.status + ').');
      const blob = await res.blob();
      const { job } = await api('/jobs', { method: 'POST', json: { title: 'Sent image ' + new Date().toISOString().slice(0, 16).replace('T', ' ') } });
      const form = new FormData();
      form.append('images', blob, 'sent-image.png');
      await api('/jobs/' + job.job_id + '/images', { method: 'POST', body: form });
      await loadJobs();
      await openJob(job.job_id);
      toast('Sent image added — assign it a view.', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  // ── Phone camera capture ───────────────────────────────────────────────────
  const cam = { lib: window.ScanToPrintCamera, stream: null, seq: null, view: 'front' };
  function camAvailable() { return Boolean(cam.lib && cam.lib.hasCamera(navigator, window.isSecureContext !== false)); }
  function assignedViews() { return ((state.detail && state.detail.images) || []).filter((i) => i.view).map((i) => i.view); }
  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  async function openCamera() {
    if (!state.job) { toast('Create or open an object first.', 'error'); return; }
    if (!camAvailable()) { toast('This browser will not open a live camera here (HTTPS + permission needed). Use "Take a photo" instead.', 'error'); return; }
    $('camera-panel').hidden = false;
    if (!cam.stream) cam.stream = cam.lib.createCameraStream(navigator.mediaDevices, $('cam-video'));
    try {
      const info = await cam.stream.start();
      $('cam-info').textContent = (info.label || 'camera') + (info.width ? ' · ' + info.width + '×' + info.height : '');
    } catch (e) { toast('Camera unavailable: ' + e.message, 'error'); closeCamera(); return; }
    selectCamView(cam.lib.nextView(assignedViews()) || 'front');
    $('cam-video').scrollIntoView({ block: 'nearest' });
  }
  function closeCamera() {
    if (cam.seq) { cam.seq.stop(); cam.seq = null; }
    if (cam.stream) cam.stream.stop();
    $('camera-panel').hidden = true;
    setSequenceUi(false);
  }
  function selectCamView(view) {
    cam.view = view;
    $('cam-guide').textContent = view.toUpperCase() + ' — ' + cam.lib.guideFor(view);
    $('cam-shutter').textContent = 'Capture ' + view.toUpperCase();
    renderCamViews();
  }
  function renderCamViews() {
    const row = $('cam-views');
    row.replaceChildren();
    const done = new Set(assignedViews());
    cam.lib.SEQUENCE.forEach((s) => row.appendChild(el('button', {
      class: 'chip' + (s.view === cam.view ? ' active' : '') + (done.has(s.view) ? ' done' : ''),
      text: (done.has(s.view) ? '✓ ' : '') + s.view + (s.required ? '' : ' (optional)'), onclick: () => selectCamView(s.view),
    })));
  }
  /** Grab the current frame, upload it as a photo of `view`, and assign the view — the engine never learns it came from a camera. */
  async function captureView(view) {
    const shot = await cam.stream.capture(makeCanvas, 1280, 0.92);
    const form = new FormData();
    form.append('images', shot.blob, cam.lib.fileNameFor(view));
    const out = await api('/jobs/' + state.job.job_id + '/images', { method: 'POST', body: form });
    const image = out.images && out.images[0];
    if (image) await api('/jobs/' + state.job.job_id + '/images/' + image.image_id, { method: 'PATCH', json: { view } });
    const strip = $('cam-shots');
    strip.appendChild(el('figure', {}, [shot.canvas, el('figcaption', { class: 'small muted', text: view })]));
    strip.scrollLeft = strip.scrollWidth;
    if (navigator.vibrate) navigator.vibrate(40);
    await openJob(state.job.job_id);
    return image;
  }
  async function shutter() {
    if (!cam.stream || !cam.stream.active()) { toast('The camera is not running.', 'error'); return; }
    const view = cam.view;
    $('cam-shutter').disabled = true;
    try {
      toast('Capturing ' + view + '…');
      await captureView(view);
      toast(view.toUpperCase() + ' captured — silhouette extracted.', 'ok');
      selectCamView(cam.lib.nextView(assignedViews()) || view);
    } catch (e) { toast(e.message, 'error'); } finally { $('cam-shutter').disabled = false; }
  }
  function setSequenceUi(running) {
    $('cam-auto').textContent = running ? 'Stop' : 'Record six views';
    $('cam-skip').hidden = !running; $('cam-shutter').hidden = running; $('cam-flip').disabled = running;
    if (!running) $('cam-count').hidden = true;
  }
  /** The "just record it" flow: a 3-second countdown per view, capture, next view — stop or skip at any time. */
  function toggleSequence() {
    if (cam.seq) { cam.seq.stop(); cam.seq = null; setSequenceUi(false); toast('Recording stopped.'); return; }
    if (!cam.stream || !cam.stream.active()) { toast('The camera is not running.', 'error'); return; }
    const views = cam.lib.VIEWS.filter((v) => !assignedViews().includes(v));
    if (!views.length) { toast('All six views are already assigned.', 'ok'); return; }
    cam.seq = cam.lib.createSequence({
      views, countdownMs: 3000, tickMs: 1000,
      onTick: (view, ms) => { selectCamView(view); $('cam-count').hidden = false; $('cam-count').textContent = String(Math.ceil(ms / 1000)); },
      onCapture: (view) => { $('cam-count').textContent = '●'; return captureView(view); },
      onDone: () => { cam.seq = null; setSequenceUi(false); toast('Recorded ' + views.length + ' views — check the silhouettes, then set the scale.', 'ok'); renderCamViews(); },
      onError: (e, view) => { cam.seq = null; setSequenceUi(false); toast('Stopped at ' + view + ': ' + e.message, 'error'); },
    });
    setSequenceUi(true);
    cam.seq.start();
  }
  async function flipCamera() {
    if (!cam.stream) return;
    try { const info = await cam.stream.flip(); $('cam-info').textContent = (info.label || info.facing) + (info.width ? ' · ' + info.width + '×' + info.height : ''); }
    catch (e) { toast('Could not switch camera: ' + e.message, 'error'); }
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  async function boot() {
    try { state.capabilities = await api('/capabilities'); } catch (e) { toast('Capabilities unavailable: ' + e.message, 'error'); }
    if (state.capabilities && state.capabilities.video && !state.capabilities.video.configured) $('video-note').textContent = 'Frame extraction is not configured: ' + state.capabilities.video.error;
    $('new-job').addEventListener('click', () => createJob().catch((e) => toast(e.message, 'error')));
    $('delete-job').addEventListener('click', () => deleteJob().catch((e) => toast(e.message, 'error')));
    $('photos').addEventListener('change', (ev) => { uploadPhotos(ev.target.files); ev.target.value = ''; });
    $('photo-capture').addEventListener('change', (ev) => { uploadPhotos(ev.target.files); ev.target.value = ''; });
    $('open-camera').addEventListener('click', () => openCamera().catch((e) => toast(e.message, 'error')));
    $('cam-shutter').addEventListener('click', shutter);
    $('cam-auto').addEventListener('click', toggleSequence);
    $('cam-skip').addEventListener('click', () => { if (cam.seq) cam.seq.skip(); });
    $('cam-flip').addEventListener('click', flipCamera);
    $('cam-close').addEventListener('click', closeCamera);
    window.addEventListener('pagehide', closeCamera);
    if (!camAvailable()) { $('open-camera').hidden = true; $('camera-note').textContent = 'Live camera needs HTTPS and a camera-capable browser — "Take a photo" opens the phone camera app instead.'; }
    $('video').addEventListener('change', (ev) => { uploadVideo(ev.target.files[0]); ev.target.value = ''; });
    $('pointcloud').addEventListener('change', (ev) => { uploadPointCloud(ev.target.files[0]); ev.target.value = ''; });
    $('toggle-mask').addEventListener('click', () => { state.showMask = !state.showMask; $('toggle-mask').textContent = state.showMask ? 'show photos' : 'show silhouettes'; renderImages(state.detail.images); });
    $('save-dims').addEventListener('click', saveDimensions);
    $('res').addEventListener('input', () => { $('res-label').textContent = $('res').value; });
    $('smooth').addEventListener('input', () => { $('smooth-label').textContent = $('smooth').value; });
    $('reconstruct').addEventListener('click', reconstruct);
    $('printer-form').addEventListener('submit', addPrinter);
    $('send').addEventListener('click', sendToPrinter);
    await loadJobs().catch((e) => toast(e.message, 'error'));
    const ref = new URLSearchParams(location.search).get('artifact');
    if (ref) await intakeArtifact(ref);
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
