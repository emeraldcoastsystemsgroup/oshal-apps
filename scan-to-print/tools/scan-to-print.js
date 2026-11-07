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
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Clear stale output controls on input changes and ignore late STL responses; require saved scale and fresh reconstruction before printing.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | "Open in CAD Studio": the job's outlines (the new contours
 *                     |                             | artifact) become a CAD Studio part with a `contours` base, then
 *                     |                             | the cockpit switches to that app. Refuses honestly when the
 *                     |                             | package is not installed or not granted.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Fence CAD handoff with the existing output epoch and source revision so delayed contours cannot create another object's part or replace newer feedback.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | "Seal base" on the point-cloud import (BACKLOG B7): a phone scan
 *                     |                             | of an object on a table has no underside, so the operator asserts
 *                     |                             | the bed plane and the toast says the base was assumed rather than
 *                     |                             | measured. Changing it invalidates the outputs like every other
 *                     |                             | point-cloud setting.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | "Suggest views from the video" (BACKLOG B12): the square-on frame
 *                     |                             | per unassigned view comes back from /frame-suggestions and is
 *                     |                             | listed with an Assign button; nothing is assigned until the
 *                     |                             | person clicks. Views the clip never showed are named, not filled.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | The upload toast says how many views the orientation cube named
 *                     |                             | (BACKLOG B9); those photos arrive already assigned.
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | The surface's one start path (the DOMContentLoaded boot: the
 *                     |                             | capabilities and objects reads, every listener, the camera and
 *                     |                             | the ADR-139 ?artifact intake that creates an object) runs only
 *                     |                             | when no audience view renders (ADR-164 D6): under
 *                     |                             | ?audience=company the page's head script paints the saved
 *                     |                             | objects through the shared kit and nothing here starts. A core
 *                     |                             | without the kit, or any other request, runs the page unchanged.
 * 10 | maintainer@emeraldcoastsystemsgroup.com   | Bambu Lab printers and the print service's owner settings: register one from
 *                     |                             | its address + LAN access code, see the slicer engine's state and install
 *                     |                             | command, choose plate / filament / nozzle, and turn per-printer auto-start
 *                     |                             | on (a confirm that says agents' jobs will start the machine) or off.
 * 11 | maintainer@emeraldcoastsystemsgroup.com   | Printers are listed and registered with no object open: the boot reads
 *                     |                             | them (without holding up the ?artifact intake), and the list, the form
 *                     |                             | and the slicer engine note live in a Printers panel at the top of the
 *                     |                             | object list. They used to sit inside the print step, which stays hidden
 *                     |                             | until an object is reconstructed, so a printer for the print service
 *                     |                             | could not be added from a fresh page.
 * 12 | maintainer@emeraldcoastsystemsgroup.com   | A refusal reads as a sentence. A server answer with no
 *                     |                             | message (the native kernel's bare `application_route_failed`
 *                     |                             | when a request fails after the route ran) showed the raw code in
 *                     |                             | the toast; it now says the request did not finish and nothing
 *                     |                             | was saved, keeping the code in brackets. A refusal's `detail` is
 *                     |                             | used when it has no message. Guard: tests/surface-errors.test.js.
 * 13 | maintainer@emeraldcoastsystemsgroup.com   | The page states and enforces the upload limit that holds on this
 *                     |                             | installation (/capabilities `upload`, the native kernel's 10 MiB
 *                     |                             | per file): a note under Capture names it, an oversized video or
 *                     |                             | .ply is refused before anything is sent (and before the outputs
 *                     |                             | are cleared) with its size, the limit and how to make it fit, and
 *                     |                             | photos go in requests that fit (planUpload), oversized ones named
 *                     |                             | and skipped. Guard: tests/surface-upload-limits.test.js.
 * 14 | maintainer@emeraldcoastsystemsgroup.com   | K4: a refused point-cloud import left the report on 'Processing the new point cloud. Previous outputs are unavailable.' indefinitely, the reason only a passing toast. The catch now reloads the object as the server holds it and keeps the refusal in the report (role alert), saying the earlier outputs were retired when the import started.
 * 15 | maintainer@emeraldcoastsystemsgroup.com   | Demo sweep 1: a failed Open in CAD Studio toasted CAD Studio's build.reason, which carries the kernel's failure and the host's install command ('on the kernel host run cad-studio/engine/install-engine.sh ...'). cadRefusal says the CAD engine is not answering on this installation instead; any other refusal is CAD Studio's own sentence.
 * 16 | maintainer@emeraldcoastsystemsgroup.com | Save durable calibration before native AI reading and preserve failed, invalid, concurrent and switched-object source drafts.
 * 17 | maintainer@emeraldcoastsystemsgroup.com | 0.8.5, phones (Roger, trial.oswarm.ai, 2026-11-06, F2/F3: "I can't use it due to the page layout"): one primary action, Take photos (it creates the object with a default name when none is open and opens the guided camera, or the phone's photo picker, which offers its camera, when the live camera is refused), then Make 3D model once Front, Top and Right are placed, then Download STL; a three-slot checklist with thumbnails sits directly under it with the photo grid; video, .ply, silhouettes and frame suggestions move under a closed Advanced; Take photos names the object for today without a prompt (New object still asks, prefilled), and the name is edited in place; Make 3D model starts the same reconstruction as the Properties step; a seat without scan.edit (canReconstruct false) is not offered Make 3D model, a video or a .ply; the camera reveals itself inside the editor viewport only, never by scrolling the page that frames it.
 * 18 | maintainer@emeraldcoastsystemsgroup.com | 0.8.7, the trial check (2026-11-06): Make 3D model was offered before the ruler measurement it needs and its first press answered 422 in developer words ("knownDimensions must be a list of 1 to 3 {axis, mm} entries"), because the measurement field sat only in the Properties sheet on a phone. Once Front, Top and Right are placed, a "2 · Measure" field (the width, written to the same Width X calibration field) shows directly above Make 3D model, which stays disabled until a width is entered or saved; that refusal now reads as a sentence. A reload reopens the object that was open in that tab (sessionStorage); removing a photo asks first; the name and tagline are not repeated on a phone (data-ef-phone="brand"), where the app bar names the open object instead.
 * 19 | maintainer@emeraldcoastsystemsgroup.com | 0.9.0, the design standard (docs/ux/design-standard.md; Roger, 2026-11-06, F2, F3 and F12; the reference products Polycam and KIRI Engine, lanes/design-standard-2026-11-06/reference-products/CONVENTIONS.md §5.8). No native alert, confirm or prompt anywhere (DS-30): New object names the object for today without asking, and every question (discard a calibration draft, delete an object, remove a photo, turn auto-start on, send a print) is an in-page sheet with Cancel and the action named; a Bambu printer's slice settings are fields in the Printers sheet instead of three prompts. One primary on every screen (DS-24): New object is an item of the Object ▾ menu (New object, Printers…, Export…, Delete object; the ⋯ More sheet on a phone), Reconstruct and Send to printer are secondary, and the first action is Take a photo, with Choose photos, Use a video and Import a LiDAR scan as the start card's other ways in (mode first, C-SCN-2). An object shows its steps (1 Capture · 2 Scale · 3 Model · 4 Print) and a Photos · Video · LiDAR file choice; Printers is a sheet, not a panel crushing the object list; the model viewer has Export, Print and the reference tools; Export is its own sheet listing the files with one Export at its bottom (N13). The planned tools both references have (Crop, Rotate, Measure, GLB and USDZ, Share, AR) are greyed "Not available yet" controls in their places (DS-45, RP-SCN-01 to -06). The concierge's help names the object.
 * 20 | maintainer@emeraldcoastsystemsgroup.com | 0.10.0: GLB and USDZ export rows and download links (RP-SCN-04), plus the window.ScanToPrintApp seam consumed by scan-to-print-tools.js for interactive 3D Crop, Rotate/Lay-flat, Measure, Share, and AR (RP-SCN-01..06).
 */
(function () {
  'use strict';
  const BASE = '/api/scan-to-print';
  const $ = (id) => document.getElementById(id);
  const state = { jobs: [], job: null, detail: null, capabilities: null, printers: [], profiles: null, viewer: null, showMask: false,
    outputEpoch: 0, outputsFresh: false, scaleDirty: false, suggestions: [], calibration: null, sourceError: null, viewGeneration: 0, loadGeneration: 0, savingCalibration: false };

  let scanEditor, scanAssistant;
  const calibrationKeys=['dim-x','dim-y','dim-z','res','smooth'];
  const calibrationSignature=()=>JSON.stringify(calibrationKeys.map(key=>$(key).value));
  const sourceRevision=()=>state.calibration?state.calibration.sourceSha+':'+state.viewGeneration:null;
  const sourceSelection=()=>({kind:'scan-calibration',ids:state.job?[state.job.job_id]:[]});
  function calibrationDraft(){
    const knownDimensions=[];for(const axis of ['x','y','z']){const raw=$('dim-'+axis).value;if(raw==='')continue;const mm=Number(raw);if(!Number.isFinite(mm)||mm<=0||mm>100000)throw Error('Measured dimensions must be positive and at most 100000 mm.');knownDimensions.push({axis,mm});}
    const settings={resolution:Number($('res').value),smoothIterations:Number($('smooth').value)};
    for(const [key,id]of [['resolution','res'],['smoothIterations','smooth']])if(!$(id).checkValidity()||!Number.isInteger(settings[key]))throw Error('Enter valid whole-number reconstruction settings.');
    return{knownDimensions,settings};
  }
  function sourceDirty(){if(!state.calibration)return state.scaleDirty;try{const draft=calibrationDraft();return JSON.stringify(draft.knownDimensions)!==JSON.stringify(state.calibration.knownDimensions)||JSON.stringify(draft.settings)!==JSON.stringify(state.calibration.settings);}catch{return true;}}
  const sourceState=()=>({documentId:state.job?.job_id??null,revision:sourceRevision(),title:state.job?.title??'Scan to Print',readOnly:!state.calibration?.canEdit,busy:state.savingCalibration,dirty:sourceDirty()||Boolean(scanEditor?.hasPending()),selection:sourceSelection(),status:state.sourceError||(state.outputsFresh?'Current reconstructed output':'Calibration source saved separately; reconstruct for output')});
  async function prepareScanSource(){await scanEditor?.flushPending();if(state.savingCalibration)throw Error('Wait for the current calibration save.');if(!state.job||!state.calibration)throw Error(state.sourceError||'Open an owned scan calibration first.');if(sourceDirty())await saveDimensions();if(sourceDirty()||scanEditor?.hasPending())throw Error('Your calibration draft is still here. Finish it before asking.');return{app:'scan-to-print',screen:'calibration',surface:'scan-editor',recordId:state.job.job_id,title:state.job.title,selection:sourceSelection(),fields:{revision:sourceRevision(),sourceSha:state.calibration.sourceSha,readOnly:!state.calibration.canEdit,sourceKind:state.job.source_kind},digest:'Actual saved measured dimensions and bounded reconstruction settings. Calibration edits retire outputs; they never reconstruct, slice or print.'};}
  async function refreshScanSource(expected){
    if(!state.job)return;
    if(expected?.recordId!==undefined&&expected.recordId!==state.job.job_id)return;
    if(expected?.fields?.revision!==undefined&&expected.fields.revision!==sourceRevision())return;
    const id=state.job.job_id,generation=state.viewGeneration,signature=calibrationSignature();
    const [detail,calibration]=await Promise.all([api('/jobs/'+id),api('/jobs/'+id+'/calibration')]);
    if(state.job?.job_id!==id||state.viewGeneration!==generation)return;
    if(sourceDirty()||scanEditor?.hasPending()||signature!==calibrationSignature())throw Error('Your concurrent calibration draft is still here. Reopen the saved object to choose which source to keep.');
    if(calibration.sourceSha===state.calibration.sourceSha&&JSON.stringify(detail.job)===JSON.stringify(state.job))return;
    clearOutputs('Reading the actual saved scan update.');state.detail=detail;state.job=detail.job;state.calibration=calibration;state.sourceError=null;state.viewGeneration++;renderJob();scanAssistant?.refresh();
  }


  function scanProperties() {
    if (!state.job) return [];
    return (state.job.source_kind==='pointcloud'?['smooth']:['dim-x','dim-y','dim-z','res','smooth']).map(key => {
      const field = $(key), dimensions = key.startsWith('dim-');
      return { key, label: ({'dim-x':'Width X','dim-y':'Depth Y','dim-z':'Height Z',res:'Resolution',smooth:'Smoothing'})[key],
        type: 'number', value: field.value === '' ? '' : Number(field.value), min: dimensions ? .1 : Number(field.min),
        disabled:!state.calibration?.canEdit||(state.job.source_kind==='pointcloud'&&key!=='smooth'), max: dimensions ? 100000 : Number(field.max), step: dimensions ? .1 : 1, unit: dimensions ? 'mm' : key === 'res' ? 'voxels' : 'passes', group: dimensions ? 'Measured scale' : 'Reconstruction' };
    });
  }
  function applyScanProperty(key, value, expected) {
    if (!state.calibration?.canEdit || !state.job || expected.documentId !== state.job.job_id || expected.revision!==sourceRevision() || !scanProperties().some(field => field.key === key)) throw Error('Select the current scan object before editing.');
    const field = $(key), previous = field.value; field.value = String(value);
    if (!field.checkValidity()) { field.value = previous; throw Error('Enter a valid measurement or reconstruction setting.'); }
    field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true }));
  }
  async function mountScanWorkspace() {
    const { createEditorFoundation } = await import('/shared/ui/js/editor-foundation.js');
    const root = document.querySelector('body>.layout'), inspector = document.createElement('section');
    inspector.id = 'scan-inspector'; inspector.className = 'scan-inspector'; inspector.hidden = !state.job;
    for (const key of ['scale-step','reconstruct-controls','print-step']) inspector.append($(key));
    root.append(inspector);
    const {createEditorAssistant}=await import('/shared/ui/js/editor-assistant.js');
    scanAssistant=createEditorAssistant({app:'scan-to-print',bot:'scan-to-print-operator',title:'Scan to Print AI partner',root,getState:sourceState,prepare:prepareScanSource,refresh:refreshScanSource});
    const {registerDocumentSession}=await import('/shared/ui/js/document-handoff.js');registerDocumentSession({app:'scan-to-print',prepare:prepareScanSource,refresh:refreshScanSource});
    const help = scanAssistant.element && scanAssistant.element.querySelector('.ef-assistant-help');
    if (help) help.textContent = 'Ask about this object or request a change. Your draft is saved before each message.';
    // A video or a .ply needs the reconstruct right; until an object has told us the seat holds it, only photos are offered.
    const may = () => state.mayReconstruct === true;
    const start = { when: () => !state.job, lede: 'Photograph an object from the front, top and right, and get a 3D model you can print.',
      desktopLede: 'Photograph an object from the front, top and right, and get a 3D model you can print.', label: 'Take a photo', run: () => takePhotos(), replaces: $('empty-panel'),
      secondary: [{ label: 'Choose photos', run: () => startWith('photos') }, { label: () => (may() ? 'Use a video' : ''), run: () => startWith('video') },
        { label: () => (may() ? 'Import a LiDAR scan (.ply)' : ''), run: () => startWith('lidar') }] };
    scanEditor = createEditorFoundation({ root, navigationLabel: 'Objects', start, navigation: root.querySelector('aside'), viewport: root.querySelector('main'), inspector, header: document.querySelector('body>header'),
      ai:scanAssistant.element,getState:sourceState,
      getSelection: () => ({ kind: 'scan object', ids: state.job ? [state.job.job_id] : [] }), getProperties: scanProperties, applyProperty: applyScanProperty,
      actions: { save: saveDimensions } });
    // The work is the editor's viewport (data-ds-work, the design standard's contract); on desktop the concierge opens from
    // the Today bar's Concierge, so the first screen is the canvas and its one first action (F12: one assistant entry).
    root.querySelector('.ef-viewport')?.setAttribute('data-ds-work', '');
    if (!window.matchMedia('(max-width:800px)').matches) scanAssistant.element.dispatchEvent(new CustomEvent('editor-concierge:hide', { bubbles: true }));
    root.addEventListener('input', () => {scanEditor.refresh();scanAssistant.refresh();}); root.addEventListener('change', () => {scanEditor.refresh();scanAssistant.refresh();});
    window.addEventListener('pagehide', event => { if (!event.persisted) scanEditor.destroy(); }, { once: true });
  }

  /** Codes a server may answer with no message, in words (the code stays in brackets for support). */
  const READABLE = Object.freeze({
    application_route_failed: 'The server could not finish this request, so nothing was saved. Try again; if it repeats, lower the resolution.',
    native_executor_unavailable: 'This installation cannot run that step.',
    reconstruction_failed: 'Reconstruction failed on the server, so nothing was saved.',
    measure_first: 'Measure the object first: enter its width in millimetres under 2 · Measure, then press Make 3D model.',
  });

  /**
   * @description The sentence a failed request shows: the server's message, else its detail, else a known code
   * in words, else the code itself made readable. Never a bare snake_case code.
   * @param {object|null} body - The parsed answer.
   * @param {number} status - The HTTP status.
   * @returns {string} The toast text.
   */
  function failureText(body, status) {
    if (body && typeof body.message === 'string' && /knownDimensions/.test(body.message)) return READABLE.measure_first;
    if (body && typeof body.message === 'string' && body.message) return body.message;
    const code = body && typeof body.error === 'string' ? body.error : '';
    if (body && typeof body.detail === 'string' && body.detail) return body.detail + (code ? ' (' + code + ')' : '');
    if (READABLE[code]) return READABLE[code] + ' (' + code + ')';
    if (/^[a-z0-9_]+$/.test(code)) return 'The server refused this request: ' + code.replace(/_/g, ' ') + ' (HTTP ' + status + ').';
    return code || ('The server answered HTTP ' + status + '.');
  }

  /**
   * @description A byte count in MiB the way the limit note and refusals say it ("10 MiB", "23.4 MiB").
   * @param {number} bytes - Size in bytes.
   * @returns {string} The size in words.
   */
  function sizeText(bytes) {
    const mib = bytes / (1024 * 1024);
    return (Number.isInteger(mib) ? String(mib) : mib.toFixed(1)) + ' MiB';
  }

  /**
   * @description Split chosen files into upload requests this installation accepts: a file over its per-file
   * limit is refused (named, never sent); the rest go at most `perRequest` to a request and, when the host bounds
   * a request (`requestBytes`), no more file bytes per request than that.
   * @param {{name:string,size:number}[]} files - The chosen files, in order.
   * @param {number} maxFileBytes - The per-file limit.
   * @param {number|null} requestBytes - The most file bytes one request may carry, or null for no bound.
   * @param {number} perRequest - The most files one request may carry.
   * @returns {{batches:object[][], refused:object[]}} The requests to send and the files refused.
   */
  function planUpload(files, maxFileBytes, requestBytes, perRequest) {
    const batches = [], refused = [];
    let batch = [], bytes = 0;
    for (const file of files) {
      if (file.size > maxFileBytes) { refused.push(file); continue; }
      if (batch.length && (batch.length >= perRequest || (requestBytes && bytes + file.size > requestBytes))) { batches.push(batch); batch = []; bytes = 0; }
      batch.push(file); bytes += file.size;
    }
    if (batch.length) batches.push(batch);
    return { batches, refused };
  }

  /**
   * @description The refusal for one file over the limit: its size, the limit, and how to make it fit.
   * @param {{name:string,size:number}} file - The refused file.
   * @param {number} maxBytes - The limit it exceeded.
   * @param {string} hint - What to do instead.
   * @returns {string} The toast text.
   */
  function tooLargeText(file, maxBytes, hint) {
    return file.name + ' is ' + sizeText(file.size) + '; this installation accepts files up to ' + sizeText(maxBytes) + '. ' + hint;
  }

  /**
   * @description The note under Capture naming the upload limits that hold here (from /capabilities `upload`).
   * @param {object|null} upload - The capabilities' upload section.
   * @returns {string} The note, or '' when the limits are unknown.
   */
  function uploadNote(upload) {
    if (!upload || !Number.isFinite(upload.plyBytes)) return '';
    if (upload.host === 'native') return 'Uploads on this installation: at most ' + sizeText(upload.plyBytes) + ' per file (photo, video or .ply).';
    return 'Upload limits: photos ' + sizeText(upload.imageBytes) + ', video ' + sizeText(upload.videoBytes) + ', .ply ' + sizeText(upload.plyBytes) + ' each.';
  }

  /** The current upload limits, or null before /capabilities answered (the server still enforces its own). */
  function uploadLimits() { return state.capabilities && state.capabilities.upload ? state.capabilities.upload : null; }

  /** One fetch helper: JSON in, JSON out, errors as Error with the server's message. */
  async function api(path, opts) {
    const init = Object.assign({ credentials: 'same-origin', headers: {} }, opts || {});
    if (init.json !== undefined) { init.body = JSON.stringify(init.json); init.headers['Content-Type'] = 'application/json'; delete init.json; }
    const res = await fetch(BASE + path, init);
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = { raw: text }; }
    if (!res.ok) { const err = new Error(failureText(body, res.status)); err.status = res.status; err.body = body; throw err; }
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
    if (!state.jobs.length) list.appendChild(el('p', { class: 'muted', text: 'No objects yet.' }));
    state.jobs.forEach((job) => {
      // A choice puts the object in view: on a phone the Objects sheet closes, even when it is the object already open.
      const item = el('button', { class: 'job-item' + (state.job && state.job.job_id === job.job_id ? ' active' : ''), onclick: () => { scanEditor?.showPanel(null); void openJob(job.job_id).catch(e=>toast(e.message,'error')); } }, [
        el('span', { class: 'job-title', text: job.title }),
        el('span', { class: 'badge ' + job.state, text: job.state }),
      ]);
      list.appendChild(item);
    });
  }
  /** A new object is named for today and opened at 1 Capture; its name is edited in place (no prompt, DS-30). */
  async function createJob() {
    const title = 'Object · ' + new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const { job } = await api('/jobs', { method: 'POST', json: { title } });
    await loadJobs();
    await openJob(job.job_id);
  }
  async function openJob(jobId) {
    if(state.savingCalibration){toast('Wait for the calibration save.','error');return;}
    if((sourceDirty()||scanEditor?.hasPending())&&!(await ask('Discard the unsaved calibration and open the saved object?',{yes:'Discard'})))return;
    const generation=++state.loadGeneration,signature=calibrationSignature();
    const [detail,source]=await Promise.all([api('/jobs/'+jobId),api('/jobs/'+jobId+'/calibration').then(value=>({value}),error=>({error}))]);
    if(generation!==state.loadGeneration)return;
    if(signature!==calibrationSignature()){toast('Your calibration changed while opening. Its draft is kept.','error');return;}
    try { sessionStorage.setItem(OPEN_KEY, jobId); } catch { /* storage off: a reload starts from the list */ }
    scanEditor?.discardPending();clearOutputs('Loading the actual saved object.');state.detail=detail;state.job=detail.job;state.calibration=source.value??null;state.sourceError=source.error?.message??null;state.viewGeneration++;renderJob();scanAssistant?.refresh();await loadJobs();
  }

  async function deleteJob() {
    if (!state.job || !(await ask('Delete "' + state.job.title + '" and all its files?', { yes: 'Delete', danger: true }))) return;
    closeCamera();
    await api('/jobs/' + state.job.job_id, { method: 'DELETE' });
    state.job = null; state.detail = null;state.calibration=null;state.sourceError=null;state.viewGeneration++;state.loadGeneration++;
    try { sessionStorage.removeItem(OPEN_KEY); } catch { /* storage off */ }
    $('job-panel').hidden = true; $('empty-panel').hidden = false; $('header-title').textContent = ''; $('delete-job').disabled = true; $('open-export').disabled = true; renderSteps();
    if ($('scan-inspector')) $('scan-inspector').hidden = true; scanEditor?.refresh();
    await loadJobs();
  }

  /** The object's name is edited in place in its heading (no prompt). */
  async function renameJob() {
    const title = $('job-heading').textContent.trim();
    if (!state.job || !title || title === state.job.title) { if (state.job) $('job-heading').textContent = state.job.title; return; }
    const { job } = await api('/jobs/' + state.job.job_id, { method: 'PATCH', json: { title: title.slice(0, 120) } });
    state.job = { ...state.job, ...(job || { title }) }; $('header-title').textContent = state.job.title; await loadJobs();
  }
  // ── Job panel ──────────────────────────────────────────────────────────────
  function renderJob() {
    const { job, images, artifacts } = state.detail;
    $('empty-panel').hidden = true; $('job-panel').hidden = false;
    $('job-heading').textContent = job.title; $('header-title').textContent = job.title; $('job-heading').contentEditable = state.calibration?.canEdit ? 'plaintext-only' : 'false';
    $('job-state').textContent = job.state + ' · ' + job.source_kind;
    $('job-state').className = 'badge ' + job.state;
    renderImages(images);
    renderDimensions(job);
    renderSettings(job);
    renderReport(job.report, artifacts);
    renderPrint(artifacts);
    for(const key of calibrationKeys)$(key).disabled=!state.calibration?.canEdit||(state.job.source_kind==='pointcloud'&&key!=='smooth');
    $('save-dims').disabled=!state.calibration?.canEdit;$('reconstruct').disabled=!state.calibration?.canEdit||state.job.source_kind==='pointcloud';$('reconstruct').title=state.job.source_kind==='pointcloud'?'Reimport the original point cloud to rebuild this capture lane.':'';$('scale-step').hidden=state.job.source_kind==='pointcloud';
    if(state.sourceError)toast(state.sourceError,'error');
    loadSubmissions();
    $('delete-job').disabled = !state.job;
    if (state.calibration && typeof state.calibration.canReconstruct === 'boolean') state.mayReconstruct = state.calibration.canReconstruct;
    if (state.modeJob !== job.job_id) { state.modeJob = job.job_id; setMode(MODES[job.source_kind] || 'photos'); }
    renderSteps();
    if ($('scan-inspector')) $('scan-inspector').hidden = false; scanEditor?.refresh();
  }

  // ── Steps and capture modes ──────────────────────────────────────────────────
  const MODES = { photos: 'photos', video: 'video', pointcloud: 'lidar' };
  /** Where the open object is: 1 Capture until Front, Top and Right are placed, 2 Scale until it is measured, 3 Model until it is built, 4 Print. */
  function currentStep() {
    if (!state.job || !state.detail) return 'capture';
    if (state.outputsFresh) return 'print';
    if (state.job.source_kind === 'pointcloud') return 'model';
    const images = state.detail.images || [];
    if (!['front', 'top', 'right'].every((v) => images.some((i) => i.view === v))) return 'capture';
    return measured() ? 'model' : 'scale';
  }
  /** Mark the current step in every stepper (the app row on desktop, the object's own line on a phone). */
  function renderSteps() {
    if (typeof document.querySelectorAll !== 'function') return;
    const step = currentStep();
    for (const item of document.querySelectorAll('[data-stp-steps] li')) { if (item.dataset.step === step) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current'); }
  }
  /** Mode first (C-SCN-2): show the capture controls of one source, Photos, Video or LiDAR file. */
  function setMode(mode) {
    if (typeof document.querySelectorAll !== 'function') return;
    for (const button of document.querySelectorAll('#capture-modes [data-mode]')) button.setAttribute('aria-checked', String(button.dataset.mode === mode));
    for (const part of document.querySelectorAll('.stp-mode[data-stp-mode]')) part.hidden = part.dataset.stpMode !== mode;
    const take = $('take-photos'); if (take) take.hidden = mode !== 'photos';
  }
  /** The start card's other ways in: an object named for today, then that source's file picker. */
  async function startWith(mode) {
    if (!state.job) await createJob();
    if (!state.job) return;
    setMode(mode);
    ({ photos: $('photos'), video: $('video'), lidar: $('pointcloud') })[mode].click();
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
    $('assigned-summary').textContent = 'Placed: ' + (images.filter((i) => i.view).map((i) => i.view).join(', ') || 'none') + '. A solid needs front, top and right; back, left and bottom are optional.';
    renderChecklist(images);
    $('suggest-panel').hidden = !images.some((i) => /^frame-\d{3}\.png$/.test(i.file_name));
    $('suggest-list').replaceChildren();
    $('suggest-all').hidden = true;
    $('suggest-note').textContent = '';
  }
  /** Front, Top and Right as three tiles (a thumbnail once placed, a dashed tap-to-take tile until then), and the one primary action that follows. */
  function renderChecklist(images) {
    const tiles = ['front', 'top', 'right'].map((view) => {
      const img = images.find((i) => i.view === view), label = view[0].toUpperCase() + view.slice(1);
      if (!img) return el('button', { class: 'view-slot missing', role: 'listitem', text: label + ' · tap to take', onclick: () => takeView(view).catch((e) => toast(e.message, 'error')) });
      const src = BASE + '/jobs/' + state.job.job_id + '/images/' + img.image_id + '/file?kind=source&t=' + Date.parse(img.created_at);
      return el('div', { class: 'view-slot', role: 'listitem' }, [el('img', { src, alt: label + ' photo' }), el('b', { text: label + ' ✓' })]);
    });
    $('view-checklist').replaceChildren(...tiles);
    const complete = ['front', 'top', 'right'].every((v) => images.some((i) => i.view === v)), may = state.calibration?.canReconstruct !== false;
    const stl = state.detail?.artifacts?.stl && state.job.state === 'reconstructed';
    $('make-model').hidden = !complete || !may || stl || state.job.source_kind === 'pointcloud';
    $('measure-step').hidden = !complete || !may || state.job.source_kind === 'pointcloud';
    syncMeasure();
    $('download-stl').hidden = !stl; if (stl) { $('download-stl').href = BASE + '/jobs/' + state.job.job_id + '/artifacts/stl?download'; $('download-stl').setAttribute('download', fileName(state.job.title, 'stl')); }
    $('take-photos').className = complete ? 'ghost' : 'primary'; $('take-photos').textContent = complete ? 'Take more photos' : 'Take a photo';
    for (const id of ['video-pick', 'pointcloud-row', 'reconstruct', 'mode-video', 'mode-lidar']) if ($(id)) $(id).hidden = !may;
  }
  const OPEN_KEY = 'scan-to-print:open-object';
  /** True when the scale has one positive measurement, typed now or saved with the object. */
  function measured() {
    const typed = Number($('dim-x').value || $('dim-y').value || $('dim-z').value);
    return (Number.isFinite(typed) && typed > 0) || Boolean(state.job && (state.job.known_dimensions || []).length);
  }
  /** The visible width field mirrors Width X; Make 3D model waits for a measurement. */
  function syncMeasure() {
    if (document.activeElement !== $('measure-width')) $('measure-width').value = $('dim-x').value;
    $('measure-width').disabled = !state.calibration?.canEdit;
    $('make-model').disabled = !measured();
    $('measure-step').classList.remove('needed');
  }
  function makeModel() {
    if (!measured()) { $('measure-step').classList.add('needed'); $('measure-width').focus({ preventScroll: true }); reveal($('measure-step')); toast(READABLE.measure_first, 'error'); return; }
    $('reconstruct').click();
  }
  /** The phone's one first step: an object (named for today when none is open), then the guided camera, or the phone camera app. */
  async function takePhotos() {
    if (!state.job) await createJob();
    if (!state.job) return;
    if (!camAvailable()) { $('photos').click(); return; }
    await openCamera();
    if ($('camera-panel').hidden) $('photos').click();
  }
  async function takeView(view) { await takePhotos(); if (!$('camera-panel').hidden) selectCamView(view); }
  /** Bring an element into the editor's own viewport without scrolling any page around it. */
  function reveal(node) {
    const port = node.closest('.ef-viewport') || node.closest('main'); if (!port) return;
    const box = node.getBoundingClientRect(), frame = port.getBoundingClientRect();
    if (box.top < frame.top || box.bottom > frame.bottom) port.scrollTop += box.top - frame.top - 8;
  }
  // Frame suggestion (B12): the server proposes, the person confirms each assignment.
  async function suggestViews() {
    const out = await api('/jobs/' + state.job.job_id + '/frame-suggestions');
    const list = $('suggest-list');
    list.replaceChildren();
    out.suggestions.forEach((s) => list.appendChild(el('li', {}, [
      el('span', { text: s.view + ' → ' + s.fileName }),
      el('button', { class: 'link', text: 'assign', onclick: () => confirmSuggestion(s).catch((e) => toast(e.message, 'error')) }),
    ])));
    const notes = [];
    if (out.unmatched.length) notes.push('No square-on frame for: ' + out.unmatched.join(', ') + '.');
    if (out.proportionsKnown < 3) notes.push('Enter all three dimensions to also compare proportions; these were ranked on where the outline turns.');
    if (!out.suggestions.length && !out.unmatched.length) notes.push('Every view is already assigned.');
    $('suggest-note').textContent = notes.join(' ');
    $('suggest-all').hidden = out.suggestions.length === 0;
    state.suggestions = out.suggestions;
  }
  async function confirmSuggestion(s) {
    await assignView(s.imageId, s.view);
    await suggestViews();
  }
  async function assignAllSuggested() {
    const pending = state.suggestions;
    if (!pending.length) return;
    clearOutputs('Views changed. Reconstruct to refresh the model and downloads.');
    for (const s of pending) await api('/jobs/' + state.job.job_id + '/images/' + s.imageId, { method: 'PATCH', json: { view: s.view } });
    await openJob(state.job.job_id);
    toast(pending.length + ' views assigned from the video.');
  }
  async function assignView(imageId, view) {
    clearOutputs('Views changed. Reconstruct to refresh the model and downloads.');
    try { await api('/jobs/' + state.job.job_id + '/images/' + imageId, { method: 'PATCH', json: { view: view || null } }); await openJob(state.job.job_id); } catch (e) { toast(e.message, 'error'); }
  }
  async function removeImage(imageId) {
    if (!(await ask('Remove this photo from "' + state.job.title + '"?', { yes: 'Remove', danger: true }))) return;
    clearOutputs('Photos changed. Reconstruct to refresh the model and downloads.');
    try { await api('/jobs/' + state.job.job_id + '/images/' + imageId, { method: 'DELETE' }); await openJob(state.job.job_id); } catch (e) { toast(e.message, 'error'); }
  }
  async function uploadPhotos(files) {
    if (!files.length) return;
    const limits = uploadLimits();
    const chosen = Array.from(files).slice(0, limits ? limits.imagesPerJob : 24);
    const plan = limits ? planUpload(chosen, limits.imageBytes, limits.requestBytes, limits.imagesPerRequest) : { batches: [chosen.slice(0, 12)], refused: [] };
    const skipped = plan.refused.length ? ' Not sent (over ' + sizeText(limits.imageBytes) + '): ' + plan.refused.map((f) => f.name).join(', ') + '.' : '';
    if (!plan.batches.length) { toast(plan.refused.length === 1 ? tooLargeText(plan.refused[0], limits.imageBytes, 'Use the camera here, or a smaller photo.') : 'No photo was sent.' + skipped, 'error'); return; }
    clearOutputs('Photos changed. Assign the views, then reconstruct.');
    let markers = 0;
    try {
      toast('Extracting silhouettes…');
      for (const batch of plan.batches) {
        const form = new FormData();
        batch.forEach((f) => form.append('images', f, f.name));
        const out = await api('/jobs/' + state.job.job_id + '/images', { method: 'POST', body: form });
        markers += out.viewsFromMarkers || 0;
      }
      await openJob(state.job.job_id);
      toast((markers ? 'Photos added; ' + markers + ' view' + (markers === 1 ? '' : 's') + ' read from the orientation cube.' : 'Photos added.') + skipped, skipped ? 'error' : undefined);
    } catch (e) { await openJob(state.job.job_id).catch(() => undefined); toast(e.message, 'error'); }
  }
  async function uploadVideo(file) {
    if (!file) return;
    const limits = uploadLimits();
    if (limits && file.size > limits.videoBytes) { toast(tooLargeText(file, limits.videoBytes, 'Trim the clip or record at a lower resolution, or take photos instead.'), 'error'); return; }
    clearOutputs('Capture changed. Assign the new views, then reconstruct.');
    const form = new FormData();
    form.append('video', file, file.name);
    try { toast('Extracting frames…'); const out = await api('/jobs/' + state.job.job_id + '/video', { method: 'POST', body: form }); await openJob(state.job.job_id); toast(out.frames + ' frames added. Use "Suggest views from the video", or assign the square-on ones by hand.'); } catch (e) { toast(e.message, 'error'); }
  }
  async function uploadPointCloud(file) {
    if (!file) return;
    const limits = uploadLimits();
    if (limits && file.size > limits.plyBytes) { toast(tooLargeText(file, limits.plyBytes, 'A binary .ply export, or a decimated or cropped scan, is smaller.'), 'error'); return; }
    clearOutputs('Processing the new point cloud. Previous outputs are unavailable.');
    const form = new FormData();
    form.append('model', file, file.name);
    form.append('voxelMm', $('pc-voxel').value);
    form.append('unitScale', $('pc-units').value);
    form.append('up', $('pc-up').value);
    form.append('sealBase', $('pc-seal').checked ? 'true' : 'false');
    try { toast('Voxelising point cloud…'); const out = await api('/jobs/' + state.job.job_id + '/pointcloud', { method: 'POST', body: form }); await openJob(state.job.job_id); toast(out.closed ? (out.sealedBase ? 'Point cloud closed and filled — base sealed, so the underside is assumed.' : 'Point cloud closed and filled.') : 'Surface did not close — see the report.', out.closed ? 'ok' : 'error'); } catch (e) { await showImportRefusal(e); }
  }
  /** A refused import: reload the object as the server now holds it, and keep the reason in the report, not only a toast. */
  async function showImportRefusal(e) {
    const reason = (e && e.message) || 'The server refused the point cloud.';
    await openJob(state.job.job_id).catch(() => undefined);
    $('report').replaceChildren(el('p', { role: 'alert', text: 'The point cloud was not imported: ' + reason
      + ' The earlier outputs were retired when the import started; change the import settings and import again, or reconstruct.' }));
    toast(reason, 'error');
  }

  // ── Dimensions + settings ──────────────────────────────────────────────────
  function renderDimensions(job) {
    state.scaleDirty = false;
    const dims = { x: '', y: '', z: '' };
    (job.known_dimensions || []).forEach((d) => { dims[d.axis] = d.mm; });
    $('dim-x').value = dims.x; $('dim-y').value = dims.y; $('dim-z').value = dims.z;
    syncMeasure();
  }
  async function saveDimensions() {
    await scanEditor?.flushPending();if(!state.job||!state.calibration?.canEdit)throw Error(state.sourceError||'Current calibration editing permission is required.');if(state.savingCalibration)throw Error('Wait for the current calibration save.');
    const id=state.job.job_id,generation=state.viewGeneration,draft=calibrationDraft(),signature=calibrationSignature();if(!sourceDirty())return;
    state.savingCalibration=true;scanEditor?.refresh();
    try{const result=await api('/jobs/'+id+'/calibration',{method:'PATCH',json:{expectedSourceSha:state.calibration.sourceSha,...draft}});if(state.job?.job_id!==id||state.viewGeneration!==generation||signature!==calibrationSignature())throw Error('The earlier calibration was saved. Your newer visible draft is kept; reopen the saved object to continue.');clearOutputs('Calibration saved. Reconstruct with the original capture lane to refresh geometry.');state.job=result.job;state.detail.job=result.job;state.calibration=result.calibration;state.viewGeneration++;renderJob();toast('Calibration saved; outputs require reconstruction.');}finally{state.savingCalibration=false;scanEditor?.refresh();scanAssistant?.refresh();}
  }
  function renderSettings(job) {
    const s = job.settings || {};
    const limits = state.capabilities ? state.capabilities.limits : { resolution: { default: 96, min: 16, max: 198 }, smoothIterations: { default: 2, min: 0, max: 10 } };
    $('res').min = limits.resolution.min; $('res').max = limits.resolution.max; $('res').value = s.resolution || limits.resolution.default;
    $('smooth').min = limits.smoothIterations.min; $('smooth').max = limits.smoothIterations.max; $('smooth').value = s.smoothIterations === undefined ? limits.smoothIterations.default : s.smoothIterations;
    $('res-label').textContent = $('res').value; $('smooth-label').textContent = $('smooth').value;
  }
  async function reconstruct() {
    try { await saveDimensions(); } catch (e) { toast(e.message, 'error'); return; }
    const settings = { resolution: Number($('res').value), smoothIterations: Number($('smooth').value) };
    const jobId = state.job.job_id;
    clearOutputs('Reconstructing. Previous outputs are unavailable.');
    const epoch = state.outputEpoch;
    try {
      $('reconstruct').disabled = true; toast('Carving the visual hull…');
      const out = await api('/jobs/' + jobId + '/reconstruct', { method: 'POST', json: settings });
      if (epoch !== state.outputEpoch || jobId !== state.job.job_id) return;
      await openJob(jobId);
      toast('Reconstructed in ' + out.durationMs + ' ms — ' + out.report.triangleCount + ' facets.', 'ok');
    } catch (e) {
      toast(e.message, 'error');
      if (epoch === state.outputEpoch && jobId === state.job.job_id) await openJob(jobId);
    } finally { $('reconstruct').disabled = false; }
  }

  // ── Report, drawing, viewer ────────────────────────────────────────────────
  function clearOutputs(message) {
    state.outputEpoch += 1; state.outputsFresh = false;
    $('report').replaceChildren(el('p', { class: 'muted', role: 'status', text: message }));
    $('drawing-wrap').hidden = true; $('viewer-wrap').hidden = true; $('print-step').hidden = true;
    $('drawing').removeAttribute('src'); $('viewer-info').textContent = '';
    $('send').disabled = true; $('open-export').disabled = true;
    if (state.viewer) state.viewer.clear();
    renderSteps();
  }

  function renderReport(report, artifacts) {
    clearOutputs(state.job.failure_reason || 'Reconstruct to refresh the model and downloads.');
    if (!report || state.job.state !== 'reconstructed') return;
    state.outputsFresh = Boolean(artifacts.stl);
    const card = $('report');
    card.replaceChildren();
    $('drawing-wrap').hidden = !artifacts.svg;
    $('viewer-wrap').hidden = !artifacts.stl;
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
    if (artifacts.stl) ['glb', 'usdz'].forEach((k) => links.appendChild(el('a', { href: BASE + '/jobs/' + state.job.job_id + '/artifacts/' + k + '?download', text: k.toUpperCase() })));
    if (artifacts.contours) links.appendChild(el('button', { class: 'link', text: 'Open in CAD Studio →', title: 'The front / top / right outlines become a real CAD part (holes, fillets, STEP)', onclick: openInCadStudio }));
    card.appendChild(links);
    if (artifacts.svg) $('drawing').src = BASE + '/jobs/' + state.job.job_id + '/artifacts/svg?t=' + Date.parse(state.job.updated_at);
    renderExport(artifacts); $('open-export').disabled = !state.outputsFresh; renderSteps();
    if (artifacts.stl) loadStl();
  }

  // ── Export: its own sheet listing the files, one Export at its bottom (N13, C-SCN-7) ──────────
  /** The saved file's name: the object's title made safe, then its kind's extension (the native kernel sends no Content-Disposition). */
  function fileName(title, key) { return (String(title || '').replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'scan') + '.' + ({ report: 'json', contours: 'json' }[key] || key); }
  const EXPORTS = [['stl', 'STL', 'the printable mesh'], ['obj', 'OBJ', 'mesh for other 3D tools'], ['glb', 'GLB', 'binary glTF 2.0 scene for web and AR', 'stl'], ['usdz', 'USDZ', 'Apple AR Quick Look scene', 'stl'], ['svg', 'Drawing (SVG)', 'third-angle views, mm'], ['report', 'Report', 'extents, volume, checks'], ['gcode', 'G-code', 'sliced for printing']];
  function renderExport(artifacts) {
    const list = $('export-list'); if (!list) return;
    const rows = EXPORTS.filter(([key, , , srcKey]) => artifacts && artifacts[srcKey || key]).map(([key, label, note], index) => el('label', { class: 'export-row' }, [
      el('input', Object.assign({ type: 'radio', name: 'export-kind', value: key }, index === 0 ? { checked: '' } : {})), el('span', { text: label }), el('small', { text: note })]));
    list.replaceChildren(...rows);
    $('export-go').disabled = !rows.length;
  }
  function openExport() {
    if (!state.job || !state.outputsFresh) return;
    const sheet = $('export-sheet'); if (sheet && !sheet.open) sheet.showModal();
  }
  function exportChosen() {
    const chosen = document.querySelector('input[name="export-kind"]:checked');
    if (!state.job || !chosen) return;
    const link = el('a', { href: BASE + '/jobs/' + state.job.job_id + '/artifacts/' + chosen.value + '?download', download: fileName(state.job.title, chosen.value) });
    document.body.appendChild(link); link.click(); link.remove();
    $('export-sheet').close();
  }
  async function loadStl() {
    const epoch = state.outputEpoch, jobId = state.job.job_id;
    try {
      if (!state.viewer) state.viewer = (window.ScanToPrintGl || window.ScanToPrintViewer).mount($('viewer'));
      const res = await fetch(BASE + '/jobs/' + jobId + '/artifacts/stl', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('STL fetch failed');
      const bytes = await res.arrayBuffer();
      if (epoch !== state.outputEpoch || !state.outputsFresh || jobId !== state.job.job_id) return;
      const info = state.viewer.load(bytes);
      $('viewer-info').textContent = info.triangles + ' facets · ' + fmt(info.size[0]) + ' × ' + fmt(info.size[1]) + ' × ' + fmt(info.size[2]) + ' mm · drag to orbit, wheel to zoom, shift-drag to pan';
    } catch (e) { if (epoch === state.outputEpoch) $('viewer-info').textContent = e.message; }
  }

  // ── Printers + print ───────────────────────────────────────────────────────
  const isBambu = (p) => p && p.kind === 'bambu-lan';
  function modelName(p) {
    const known = (state.profiles && state.profiles.printers || []).find((m) => m.modelId === p.device_model);
    return known ? known.printerModel : (p.device_model || 'Bambu Lab');
  }
  function printerText(p) {
    const on = p.auto_start ? ', auto-start on' : '';
    if (!isBambu(p)) return p.label + ' (' + p.kind + ', ' + p.base_url + on + ')';
    return p.label + ' (' + modelName(p) + ', ' + p.base_url.replace('bambu://', '') + on + ')';
  }
  async function loadProfiles() {
    // Only a Bambu printer needs the slicer engine; fetched once per page unless it was unavailable.
    if (!state.printers.some(isBambu)) { $('engine-note').hidden = true; return; }
    if (!state.profiles || !(state.profiles.engine && state.profiles.engine.ready && !state.profiles.engine.busy)) {
      try { state.profiles = await api('/printers/profiles'); } catch (e) { state.profiles = { printers: [], plates: [], reason: e.message }; }
    }
    const note = $('engine-note');
    const needed = true;
    const busy = !!(state.profiles.engine && state.profiles.engine.busy);
    note.hidden = !(needed && state.profiles.engine && (state.profiles.engine.ready === false || busy));
    note.textContent = note.hidden ? '' : (busy ? 'The slicer for Bambu Lab printers is busy: ' : 'The slicer for Bambu Lab printers is not ready: ') + (state.profiles.reason || 'unavailable') + '.';
  }
  function printerRow(p) {
    const parts = [el('span', { text: printerText(p) + ' ' }), el('button', { class: 'link', text: 'status', onclick: () => printerStatus(p.printer_id) }),
      el('button', { class: 'link', text: p.auto_start ? 'turn auto-start off' : 'turn auto-start on', onclick: () => setAutoStart(p, !p.auto_start) })];
    if (isBambu(p)) parts.push(el('button', { class: 'link', text: 'slice settings', onclick: () => editSlice(p) }));
    if (isBambu(p)) parts.push(el('button', { class: 'link', text: 'access code', onclick: (e) => editCode(p, e.target) }));
    parts.push(el('button', { class: 'link danger', text: 'remove', onclick: () => removePrinter(p.printer_id) }));
    return el('li', {}, parts);
  }
  async function loadPrinters() {
    const out = await api('/printers');
    state.printers = out.printers;
    const sel = $('printer');
    sel.replaceChildren(el('option', { value: '', text: state.printers.length ? 'choose a printer' : 'no printers registered' }));
    state.printers.forEach((p) => sel.appendChild(el('option', { value: p.printer_id, text: printerText(p) })));
    $('slicer-note').textContent = out.slicerConfigured ? 'A slicer is configured on this swarm: G-code is produced on demand.' : 'No slicer is configured on this swarm (SCAN_TO_PRINT_SLICER_CMD). Send the STL to an OctoPrint host that slices, or download the STL and slice it yourself. Bambu Lab printers are sliced by the bundled engine.';
    $('printer-list').replaceChildren(...state.printers.map(printerRow));
    printerChosen();
    // Model names and the engine note follow; the printer list never waits on the slicer engine.
    loadProfiles().then(() => {
      state.printers.forEach((p, i) => { const opt = sel.options[i + 1]; if (opt) opt.textContent = printerText(p); });
      $('printer-list').replaceChildren(...state.printers.map(printerRow));
    }, (e) => toast(e.message, 'error'));
  }
  function kindChosen() {
    const bambu = $('p-kind').value === 'bambu-lan';
    $('http-fields').hidden = bambu; $('bambu-fields').hidden = !bambu; $('bambu-help').hidden = !bambu;
    $('p-url').required = !bambu; $('p-key').required = !bambu; $('p-host').required = bambu; $('p-code').required = bambu;
  }
  function printerChosen() {
    const printer = state.printers.find((p) => p.printer_id === $('printer').value);
    $('file-kind').hidden = isBambu(printer);
  }
  async function addPrinter(ev) {
    ev.preventDefault();
    const kind = $('p-kind').value;
    const json = kind === 'bambu-lan'
      ? { label: $('p-label').value, kind, host: $('p-host').value, accessCode: $('p-code').value }
      : { label: $('p-label').value, kind, baseUrl: $('p-url').value, apiKey: $('p-key').value };
    try {
      if (kind === 'bambu-lan') toast('Contacting the printer…', 'info');
      await api('/printers', { method: 'POST', json });
      ['p-label', 'p-url', 'p-key', 'p-host', 'p-code'].forEach((id) => { $(id).value = ''; });
      await loadPrinters();
      toast(kind === 'bambu-lan' ? 'Printer added. Its access code is stored encrypted and never shown again.' : 'Printer saved. The key is stored encrypted and never shown again.', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function setAutoStart(p, on) {
    if (on && !(await ask('Turn on auto-start for ' + p.label + '?\n\nJobs that agents and apps send through the print service will START this printer without anyone pressing Print. Only turn this on if the plate is cleared after every print.', { yes: 'Turn auto-start on' }))) return;
    try {
      await api('/printers/' + p.printer_id, { method: 'PATCH', json: on ? { autoStart: true, confirm: true } : { autoStart: false } });
      await loadPrinters();
      toast(on ? 'Auto-start is on for ' + p.label + '.' : 'Auto-start is off for ' + p.label + '. Service jobs will wait on the printer.', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }
  /** A Bambu printer's build plate, filament and nozzle: fields in the Printers sheet, not prompts (DS-30). */
  function editSlice(p) {
    const current = p.slice_profile || {};
    const model = (state.profiles && state.profiles.printers || []).find((m) => m.modelId === p.device_model);
    $('slice-printer').textContent = p.label;
    $('slice-plates').replaceChildren(...((state.profiles && state.profiles.plates) || []).map((plate) => el('option', { value: plate })));
    $('slice-plate').value = current.plate || (model && model.defaultPlate) || 'Textured PEI Plate';
    $('slice-filament').value = current.filament || 'Bambu PLA Basic';
    $('slice-nozzle').value = current.nozzle || '0.4';
    state.slicing = p; $('slice-form').hidden = false; $('slice-plate').focus();
  }
  async function saveSlice() {
    const p = state.slicing; if (!p) return;
    const sliceProfile = { plate: $('slice-plate').value.trim(), filament: $('slice-filament').value.trim(), nozzle: $('slice-nozzle').value };
    if (!sliceProfile.plate || !sliceProfile.filament) { toast('Enter the build plate and the filament profile.', 'error'); return; }
    try { await api('/printers/' + p.printer_id, { method: 'PATCH', json: { sliceProfile } }); state.slicing = null; $('slice-form').hidden = true; await loadPrinters(); toast('Slice settings saved for ' + p.label + '.', 'ok'); } catch (e) { toast(e.message, 'error'); }
  }
  /** Replace a printer's stored access code in place: its pinned identity stays. */
  function editCode(p, anchor) {
    const input = el('input', { type: 'password', placeholder: 'code on the printer screen', autocomplete: 'off', 'aria-label': 'Access code' });
    const save = el('button', { class: 'link', text: 'save code', onclick: async () => {
      try { await api('/printers/' + p.printer_id, { method: 'PATCH', json: { accessCode: input.value } }); await loadPrinters(); toast('Access code saved for ' + p.label + '. It is stored encrypted and never shown again.', 'ok'); } catch (e) { toast(e.message, 'error'); }
    } });
    anchor.replaceWith(input, save); input.focus();
  }
  async function removePrinter(id) { try { await api('/printers/' + id, { method: 'DELETE' }); await loadPrinters(); } catch (e) { toast(e.message, 'error'); } }
  async function printerStatus(id) {
    try {
      const out = await api('/printers/' + id + '/status', { method: 'POST' });
      const d = out.status.detail || {};
      const extra = isBambu(out.printer) ? (d.percent != null && out.status.state === 'printing' ? ' · ' + d.percent + '%, ' + d.remainingMinutes + ' min left' : '') + (d.signatureRequired ? ' · starts only from the printer (Developer Mode off)' : ' · oshal can start prints') : '';
      toast(out.printer.label + ': ' + out.status.state + extra, 'ok');
    } catch (e) { toast('Printer did not answer: ' + ((e.body && e.body.status && e.body.status.detail && e.body.status.detail.message) || (e.body && e.body.status && e.body.status.state) || e.message), 'error'); }
  }
  function renderPrint(artifacts) {
    $('print-step').hidden = !artifacts.stl || !state.outputsFresh;
    $('send').disabled = !state.outputsFresh;
    loadPrinters().catch((e) => toast(e.message, 'error'));
  }
  async function sendToPrinter() {
    if (!state.outputsFresh) { toast('Reconstruct before sending this model to a printer.', 'error'); return; }
    const printerId = $('printer').value;
    if (!printerId) { toast('Choose a printer first.', 'error'); return; }
    const fileKind = $('file-kind').value;
    const startPrint = $('start-print').checked;
    const printer = state.printers.find((p) => p.printer_id === printerId);
    const what = isBambu(printer) ? 'sliced for ' + modelName(printer) : 'as ' + fileKind.toUpperCase();
    const ok = await ask('Send "' + state.job.title + '" ' + what + ' to ' + printer.label + (startPrint ? ' AND START PRINTING' : '') + '?\n\nThis leaves the swarm and reaches your printer' + (isBambu(printer) ? ' over your home network.' : ' host.'), { yes: startPrint ? 'Send and print' : 'Send' });
    if (!ok) return;
    try {
      $('send').disabled = true;
      const out = await api('/jobs/' + state.job.job_id + '/print', { method: 'POST', json: { printerId, fileKind, startPrint, confirm: true } });
      const est = out.outcome.estimate;
      toast(out.outcome.message + (est ? ' About ' + Math.round(est.printSeconds / 60) + ' min' + (est.filamentGrams ? ', ' + est.filamentGrams + ' g.' : '.') : ''), 'ok');
      await loadSubmissions();
    } catch (e) { toast(e.message, 'error'); await loadSubmissions(); } finally { $('send').disabled = !state.outputsFresh; }
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
  /** CAD Studio's refusal in a person's words: an engine that is not answering is one sentence (never the
   * kernel's address or the host's install command, which ride build.reason for the operator); any other
   * refusal is CAD Studio's own sentence. */
  function cadRefusal(out) {
    const build = out.build || {};
    if (build.code === 'capability_unavailable') return "CAD Studio's engine is not answering on this installation, so the part cannot be made there right now.";
    return build.error || build.reason || out.message || out.error || '';
  }
  async function openInCadStudio() {
    if (!state.job || !state.outputsFresh) return;
    const { job_id: jobId, title, updated_at: revision } = state.job, epoch = state.outputEpoch;
    const current = () => state.job && state.job.job_id === jobId && state.job.updated_at === revision
      && state.outputsFresh && state.outputEpoch === epoch;
    try {
      const contours = await api('/jobs/' + jobId + '/artifacts/contours');
      if (!current()) return;
      const res = await fetch('/api/cad-studio/models', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, base: { kind: 'contours', views: contours.views, size: contours.sizeMm }, source: { kind: 'scan', jobId, title } }) });
      if (res.status === 404 || res.status === 401 || res.status === 403) throw new Error('CAD Studio is not installed on this swarm, or you are not granted access to it.');
      const out = await res.json().catch(() => ({}));
      if (!current()) return;
      if (!res.ok) throw new Error(cadRefusal(out) || ('HTTP ' + res.status));
      toast('Opened in CAD Studio as "' + out.model.title + '" (revision ' + out.model.revision + ').', 'ok');
      (window.top || window).location.assign('/cockpit/?app=cad-studio');
    } catch (e) { if (current()) toast(e.message, 'error'); }
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
    reveal($('camera-panel'));
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
    $('cam-shutter').setAttribute('aria-label', 'Capture ' + view); $('cam-shutter').title = 'Capture ' + view;
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
    clearOutputs('Capture changed. Assign the views, then reconstruct.');
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
    $('cam-auto').textContent = running ? 'Stop' : 'Auto';
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

  // ── Sheets, the Object menu and in-page questions (no native dialogs, DS-30) ─────────────────────
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
  /** A sheet closes with Done, a tap on its scrim or Escape. */
  function wireSheet(sheet) {
    sheet.addEventListener('click', (ev) => { if (ev.target === sheet || (ev.target && ev.target.closest && ev.target.closest('[data-stp-close]'))) sheet.close(); });
  }
  function openSheet(id) { const sheet = $(id); if (!sheet.open) sheet.showModal(); }
  function closeMenu() { const menu = $('object-menu-items'); if (menu && typeof menu.hidePopover === 'function' && menu.matches(':popover-open')) menu.hidePopover(); }
  /** The Object menu opens under its trigger, its right edge on the trigger's, kept on screen. */
  function placeMenu(ev) {
    const menu = $('object-menu-items'), trigger = $('object-menu'), open = ev.newState === 'open';
    trigger.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const box = trigger.getBoundingClientRect(), width = menu.offsetWidth;
    menu.style.top = Math.round(box.bottom + 4) + 'px';
    menu.style.left = Math.round(Math.max(8, Math.min(box.right - width, window.innerWidth - width - 8))) + 'px';
  }
  /** The viewer's Print tool: the print step, in the inspector on desktop and the Properties sheet on a phone. */
  function showPrint() {
    if (window.matchMedia('(max-width:800px)').matches) scanEditor?.showPanel('properties');
    const step = $('print-step'); if (!step || step.hidden) return;
    // Scroll only the pane that holds the step, never the page that frames the editor (F3).
    const port = step.closest('.ef-inspector, .ef-sheet-content, .ef-viewport'); if (!port) return;
    port.scrollTop += step.getBoundingClientRect().top - port.getBoundingClientRect().top - 8;
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  async function boot() {
    const capsRead = api('/capabilities');
    await mountScanWorkspace().catch(e => toast('The shared editor could not open: ' + e.message, 'error'));
    try { state.capabilities = await capsRead; } catch (e) { toast('Capabilities unavailable: ' + e.message, 'error'); }
    if (state.capabilities && state.capabilities.video && !state.capabilities.video.configured) $('video-note').textContent = 'Frame extraction is not configured: ' + state.capabilities.video.error;
    $('upload-note').textContent = uploadNote(uploadLimits());
    $('new-job').addEventListener('click', () => { closeMenu(); createJob().catch((e) => toast(e.message, 'error')); });
    $('object-menu-items').addEventListener('toggle', placeMenu);
    $('open-printers').addEventListener('click', () => { closeMenu(); openSheet('printers'); });
    $('print-printers').addEventListener('click', () => openSheet('printers'));
    $('open-export').addEventListener('click', () => { closeMenu(); openExport(); });
    $('tool-export').addEventListener('click', openExport);
    $('tool-print').addEventListener('click', showPrint);
    $('export-go').addEventListener('click', exportChosen);
    $('capture-modes').addEventListener('click', (ev) => { const b = ev.target && ev.target.closest && ev.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); });
    $('slice-save').addEventListener('click', () => void saveSlice());
    $('slice-cancel').addEventListener('click', () => { state.slicing = null; $('slice-form').hidden = true; });
    for (const id of ['printers', 'export-sheet']) wireSheet($(id));
    $('ask-yes').addEventListener('click', () => settleAsk(true));
    $('ask-no').addEventListener('click', () => settleAsk(false));
    $('ask-sheet').addEventListener('cancel', (ev) => { ev.preventDefault(); settleAsk(false); });
    $('delete-job').addEventListener('click', () => { closeMenu(); deleteJob().catch((e) => toast(e.message, 'error')); });
    $('photos').addEventListener('change', (ev) => { uploadPhotos(ev.target.files); ev.target.value = ''; });
    $('photo-capture').addEventListener('change', (ev) => { uploadPhotos(ev.target.files); ev.target.value = ''; });
    $('open-camera').addEventListener('click', () => openCamera().catch((e) => toast(e.message, 'error')));
    $('take-photos').addEventListener('click', () => takePhotos().catch((e) => toast(e.message, 'error')));
    $('make-model').addEventListener('click', makeModel);
    $('measure-width').addEventListener('input', () => { $('dim-x').value = $('measure-width').value; $('dim-x').dispatchEvent(new Event('input', { bubbles: true })); $('make-model').disabled = !measured(); $('measure-step').classList.remove('needed'); });
    $('job-heading').addEventListener('blur', () => renameJob().catch((e) => toast(e.message, 'error')));
    $('job-heading').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.target.blur(); } });
    $('cam-shutter').addEventListener('click', shutter);
    $('cam-auto').addEventListener('click', toggleSequence);
    $('cam-skip').addEventListener('click', () => { if (cam.seq) cam.seq.skip(); });
    $('cam-flip').addEventListener('click', flipCamera);
    $('cam-close').addEventListener('click', closeCamera);
    window.addEventListener('pagehide', closeCamera);
    if (!camAvailable()) { $('open-camera').hidden = true; $('camera-note').textContent = 'Live camera needs HTTPS and a camera-capable browser — "Take a photo" opens the phone camera app instead.'; }
    $('video').addEventListener('change', (ev) => { uploadVideo(ev.target.files[0]); ev.target.value = ''; });
    $('suggest-views').addEventListener('click', () => suggestViews().catch((e) => toast(e.message, 'error')));
    $('suggest-all').addEventListener('click', () => assignAllSuggested().catch((e) => toast(e.message, 'error')));
    $('pointcloud').addEventListener('change', (ev) => { uploadPointCloud(ev.target.files[0]); ev.target.value = ''; });
    $('toggle-mask').addEventListener('click', () => { state.showMask = !state.showMask; $('toggle-mask').textContent = state.showMask ? 'show photos' : 'show silhouettes'; renderImages(state.detail.images); });
    $('save-dims').textContent='Save calibration';$('save-dims').addEventListener('click',()=>void saveDimensions().catch(e=>toast(e.message,'error')));
    ['dim-x', 'dim-y', 'dim-z'].forEach((id) => $(id).addEventListener('input', () => {
      state.scaleDirty = true; clearOutputs('Scale changed. Save the scale, then reconstruct.');
      if (document.activeElement !== $('measure-width')) $('measure-width').value = $('dim-x').value;
      $('make-model').disabled = !measured();
    }));
    $('res').addEventListener('input', () => { $('res-label').textContent = $('res').value; clearOutputs('Settings changed. Reconstruct to refresh the model and downloads.'); });
    $('smooth').addEventListener('input', () => { $('smooth-label').textContent = $('smooth').value; clearOutputs('Settings changed. Reconstruct to refresh the model and downloads.'); });
    ['pc-voxel', 'pc-units', 'pc-up', 'pc-seal'].forEach((id) => $(id).addEventListener('change', () => {
      if (state.job && state.job.source_kind === 'pointcloud') clearOutputs('Point-cloud settings changed. Import the point cloud again to rebuild.');
    }));
    $('reconstruct').addEventListener('click', reconstruct);
    $('printer-form').addEventListener('submit', addPrinter);
    $('p-kind').addEventListener('change', kindChosen);
    kindChosen();   // a browser may restore the selected kind without firing 'change'
    $('printer').addEventListener('change', printerChosen);
    $('send').addEventListener('click', sendToPrinter);
    const untouched = state.loadGeneration;
    await loadJobs().catch((e) => toast(e.message, 'error'));
    loadPrinters().catch((e) => toast(e.message, 'error'));
    const ref = new URLSearchParams(location.search).get('artifact');
    if (ref) await intakeArtifact(ref);
    // A reload comes back to the object that was open in this tab, unless the person already chose one.
    else {
      let open = null; try { open = sessionStorage.getItem(OPEN_KEY); } catch { /* storage off: start from the list */ }
      if (open && !state.job && state.loadGeneration === untouched && (state.jobs || []).some((job) => job.job_id === open)) await openJob(open).catch((e) => toast(e.message, 'error'));
    }
  }
  if (typeof window !== 'undefined') {
    window.ScanToPrintApp = {
      BASE, api, toast, ask, fmt, fileName,
      getJob: () => state.job,
      isFresh: () => state.outputsFresh,
      getViewer: () => state.viewer,
      reloadJob: () => (state.job ? openJob(state.job.job_id) : Promise.resolve()),
    };
  }
  // The full page only: under an audience view (?audience=company) the shared kit paints instead (see the page's head
  // script), so no capability or object read, no listener, no camera and no ?artifact intake (which creates an object) starts.
  if (!window.AppView || !AppView.active()) document.addEventListener('DOMContentLoaded', boot);
})();
