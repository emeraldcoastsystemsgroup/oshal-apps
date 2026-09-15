/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | The solver knobs in the run settings (BACKLOG B7): reltol, gmin and
 *                     |                             | method saved with the design's sim and sent with every run; empty
 *                     |                             | clears a knob back to the lab's default.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | A wire's bends are listed in the inspector; a multi-selection shows
 *                     |                             | Rotate, which turns the group about its centre (BACKLOG B9).
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | The assistant rail: publishContext() tells the surface-bridge what
 *                     |                             | the page shows (the open circuit, parts, wires, readings, warnings,
 *                     |                             | selection — a capped digest) on every open, save, run, selection
 *                     |                             | and view change; Jarvis's custom `circuit_action` ops (add / update /
 *                     |                             | remove a part, connect / disconnect, run, restore, open an example,
 *                     |                             | select, switch view) land through the same routes the canvas uses,
 *                     |                             | one solve at the end; `request_context` republishes.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Readings for the spring, pulley, crank-slider and Arduino Uno; a
 *                     |                             | long text property (the sketch) edits in a textarea and keeps its
 *                     |                             | newlines; id prefixes for the new types.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | The Breadboard view: laid out by the server on first open,
 *                     |                             | every board edit is PUT back and the schematic's wires follow;
 *                     |                             | a design's board re-renders on every adopt and poll.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Clicking a wire adds its net's voltage (a shaft link: its
 *                     |                             | shaft's rpm) to the plots; a multi-selection shows its count
 *                     |                             | and removes together; readings for the 0.2.0 parts and for
 *                     |                             | the servo, stepper and step/dir driver; the driver catalog in
 *                     |                             | the inspector fills a motor's, servo's or stepper's nameplate;
 *                     |                             | id prefixes for every type.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Undo / redo over local circuit snapshots (Ctrl+Z / Ctrl+Y),
 *                     |                             | copy / paste of the selected part (Ctrl+C / Ctrl+V), live
 *                     |                             | values on the canvas behind a toggle, reset view, restore a
 *                     |                             | kept run from the runs list, text properties in the
 *                     |                             | inspector (the sequenced pin's pattern), and "Open in CAD
 *                     |                             | Studio" for a selected gear (the gear-profile route's body
 *                     |                             | posted to CAD Studio under the person's own session).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Palette parts are draggable: drop one on the canvas to place it
 *                     |                             | there (click still adds at a free spot).
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the lab's behaviour: circuits list and the
 *                     |                             | starter examples, the editor (palette → canvas, autosave of
 *                     |                             | every edit, run after edit when ticked), the transient
 *                     |                             | settings, Run, the timeline that drives the canvas animation
 *                     |                             | and the plot cursor, the signal picker and plots, the
 *                     |                             | readings table with the solver's numbers per part, the
 *                     |                             | warnings, the run history and downloads, the inspector that
 *                     |                             | edits a part's properties from the contract the server
 *                     |                             | publishes, the engine-down banner with the install command,
 *                     |                             | and a poll that refreshes the circuit while the concierge
 *                     |                             | edits it from the chat rail. Every node is built with
 *                     |                             | textContent; every call goes through one `api()` helper.
 */
(function () {
  'use strict';
  const BASE = '/api/circuit-lab';
  const $ = (id) => document.getElementById(id);
  const Canvas = window.CircuitLabCanvas, Plot = window.CircuitLabPlot, Board = window.CircuitLabBoard;
  const state = { view: 'schematic', caps: null, catalog: [], designs: [], design: null, runs: [], waveforms: null, report: null, picked: [], timeIndex: 0, playing: false, playStart: 0, lastSeen: '', pollTimer: null, saveTimer: null, saving: false, dirty: false, selection: null, epoch: 0, history: { past: [], future: [] }, snapshot: '', clipboard: null };

  // ── Local history (undo / redo over circuit snapshots) ─────────────────────
  const snapshotNow = () => JSON.stringify(Canvas.circuit());
  function syncCanvas(parts, wires) { Canvas.setCircuit(parts, wires); state.history = { past: [], future: [] }; state.snapshot = snapshotNow(); }
  function recordHistory() {
    const now = snapshotNow();
    if (now === state.snapshot) return;
    state.history.past.push(state.snapshot); if (state.history.past.length > 100) state.history.past.shift();
    state.history.future = []; state.snapshot = now;
  }
  function restoreSnapshot(json) { const c = JSON.parse(json); state.snapshot = json; Canvas.setCircuit(c.parts, c.wires); scheduleSave(); renderInspector(); }
  function undo() { if (!state.history.past.length) return; state.history.future.push(state.snapshot); restoreSnapshot(state.history.past.pop()); }
  function redo() { if (!state.history.future.length) return; state.history.past.push(state.snapshot); restoreSnapshot(state.history.future.pop()); }
  function copySelected() { const sel = state.selection; if (!sel || sel.kind !== 'part') return; const part = Canvas.circuit().parts.find((p) => p.id === sel.id); if (part) { state.clipboard = JSON.parse(JSON.stringify(part)); toast('Copied ' + part.id, 'ok'); } }
  function pasteClipboard() { const c = state.clipboard; if (!c || !state.design) return; const copy = Object.assign({}, c, { id: mintId(c.type), label: '' }); Canvas.addPart(copy, { x: c.x + 40, y: c.y + 40 }); }

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
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v).toFixed(d === undefined ? 2 : d) : '—');
  const mA = (a) => (Number.isFinite(a) ? (Math.abs(a) >= 1 ? a.toFixed(2) + ' A' : (a * 1000).toFixed(Math.abs(a) < 0.001 ? 3 : 1) + ' mA') : '—');
  const W = (w) => (Number.isFinite(w) ? (Math.abs(w) >= 1 ? w.toFixed(2) + ' W' : (w * 1000).toFixed(1) + ' mW') : '—');

  // ── Engine ─────────────────────────────────────────────────────────────────
  function renderEngine(engine) {
    if (!engine) return;
    const pill = $('engine-pill');
    pill.textContent = engine.connected ? 'engine: connected' : (engine.lastError ? 'engine: down' : 'engine: idle');
    pill.className = 'badge ' + (engine.connected ? 'ran' : engine.lastError ? 'failed' : '');
    $('engine-banner').hidden = !engine.lastError;
    $('engine-reason').textContent = engine.lastError || '';
    $('engine-hint').textContent = engine.installHint || '';
  }
  function showBuild(build) {
    if (!build || build.ok) return;
    if (build.code === 'capability_unavailable' || build.code === 'engine_busy' || build.code === 'engine_timeout') renderEngine({ connected: false, lastError: build.reason || build.error, installHint: state.caps && state.caps.engine && state.caps.engine.installHint });
    toast('Run failed: ' + (build.reason || build.error || build.code) + (build.field ? ' [' + build.field + ']' : ''), 'error');
  }

  // ── Capabilities, palette, examples ────────────────────────────────────────
  async function loadCaps() {
    state.caps = await api('/capabilities');
    Canvas.setContract(state.caps.contract);
    renderEngine(state.caps.engine);
    const palette = $('palette');
    palette.replaceChildren();
    Object.entries(state.caps.contract.parts).forEach(([type, spec]) => palette.appendChild(el('button', {
      class: 'ghost' + (spec.category === 'electrical' ? '' : ' mech'), text: spec.label, title: 'click to add a ' + spec.label + ', or drag it onto the canvas', draggable: 'true', 'data-type': type,
      onclick: () => addPart(type), ondragstart: (e) => { e.dataTransfer.setData('text/plain', type); e.dataTransfer.effectAllowed = 'copy'; },
    })));
    const select = $('example-select');
    (state.caps.examples || []).forEach((e) => select.appendChild(el('option', { value: e.id, text: e.title, title: e.description })));
    try { state.catalog = (await api('/catalog/drivers')).drivers || []; } catch (_) { state.catalog = []; }
  }
  function mintId(type) {
    const prefix = { ground: 'GND', junction: 'J', battery: 'B', source: 'V', resistor: 'R', potentiometer: 'P', capacitor: 'C', inductor: 'L', diode: 'D', led: 'D', switch: 'S', npn: 'Q', nmos: 'Q', motor: 'M', gear: 'G', load: 'W', zener: 'Z', lamp: 'LP', regulator: 'U', opamp: 'A', relay: 'K', sequencer: 'SQ', hbridge: 'H', timer555: 'U', servo: 'SV', stepper: 'ST', stepdriver: 'U', spring: 'K', pulley: 'PL', crank: 'CR', arduino: 'MCU' }[type] || 'X';
    const used = new Set(Canvas.circuit().parts.map((p) => p.id.toLowerCase()));
    for (let n = 1; ; n += 1) if (!used.has((prefix + n).toLowerCase())) return prefix + n;
  }
  function addPart(type, at) {
    if (!state.design) { toast('Create or open a circuit first.', 'error'); return; }
    const spec = state.caps.contract.parts[type];
    if (!spec) { toast('Unknown part type ' + type, 'error'); return; }
    const props = {};
    Object.entries(spec.props).forEach(([k, s]) => { props[k] = s.default; });
    Canvas.addPart({ id: mintId(type), type, x: 0, y: 0, rotation: 0, label: '', props }, at);
  }
  async function gearToCad() {
    const sel = state.selection; if (!sel || sel.kind !== 'part' || !state.design) return;
    try {
      const out = await api('/designs/' + state.design.design_id + '/parts/' + sel.id + '/gear-profile');
      const res = await fetch(out.cadStudio.path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out.cadStudio.body) });
      if (res.status === 404) { toast('CAD Studio is not installed on this box.', 'error'); return; }
      if (!res.ok) { let msg = 'HTTP ' + res.status; try { const b = await res.json(); msg = b.message || (b.build && (b.build.reason || b.build.error)) || b.error || msg; } catch (_) { /* keep */ } toast('CAD Studio refused the gear: ' + msg, 'error'); return; }
      toast('Gear sent to CAD Studio (' + out.outline.points + ' outline points).', 'ok');
      setTimeout(() => { window.top.location = out.next; }, 400);
    } catch (e) { toast(e.message, 'error'); }
  }

  // ── Designs ────────────────────────────────────────────────────────────────
  async function loadDesigns() {
    const out = await api('/designs');
    state.designs = out.designs;
    const list = $('design-list');
    list.replaceChildren();
    if (!state.designs.length) list.appendChild(el('p', { class: 'muted small', text: 'No circuits yet.' }));
    state.designs.forEach((d) => list.appendChild(el('button', { class: 'design-item' + (state.design && state.design.design_id === d.design_id ? ' active' : ''), onclick: () => openDesign(d.design_id) }, [
      el('span', { class: 'design-title', text: d.title }), el('span', { class: 'badge ' + d.state, text: d.run_count ? 'run ' + d.run_count : d.state }),
    ])));
  }
  async function createDesign(example) {
    try {
      const out = await api('/designs', { method: 'POST', json: example ? { example } : { title: 'Untitled circuit', run: false } });
      await adopt(out, true);
      await loadDesigns();
    } catch (e) { toast(e.message, 'error'); }
  }
  async function openDesign(designId) {
    stopPoll(); state.epoch += 1; const epoch = state.epoch;
    try {
      const out = await api('/designs/' + designId);
      if (epoch !== state.epoch) return;
      state.design = out.design; state.runs = out.runs || []; state.lastSeen = out.design.updated_at; state.selection = null; state.dirty = false;
      renderEngine(out.engine);
      syncCanvas(state.design.parts, state.design.wires);
      renderDesign();
      await loadReport(state.design);
      startPoll();
      await loadDesigns();
      publishContext();
    } catch (e) { if (epoch === state.epoch) toast(e.message, 'error'); }
  }
  /** Take a mutation reply: the row, the run (if any) and the outcome. */
  async function adopt(out, newDesign) {
    if (!out || !out.design) return;
    if (newDesign) { stopPoll(); state.epoch += 1; state.selection = null; state.dirty = false; syncCanvas(out.design.parts, out.design.wires); }
    else if (state.design && out.design.design_id !== state.design.design_id) return;
    state.design = out.design; state.lastSeen = out.design.updated_at;
    renderDesign();
    if (out.run && out.run.report) { state.report = out.run.report; await loadWaveforms(out.design); renderRun(); }
    if (out.build) showBuild(out.build);
    if (newDesign) startPoll();
    refreshRuns().catch(() => {});
    loadDesigns().catch(() => {});
    publishContext();
  }
  async function refreshRuns() { if (!state.design) return; const out = await api('/designs/' + state.design.design_id + '/runs'); state.runs = out.runs; renderRuns(); }

  // ── The breadboard view ────────────────────────────────────────────────────
  // SVG elements do not reflect the `hidden` IDL property: toggle the attribute itself.
  const show = (el, on) => { if (on) el.removeAttribute('hidden'); else el.setAttribute('hidden', ''); };
  function setView(view) {
    state.view = view;
    show($('canvas'), view === 'schematic'); show($('canvas-hint'), view === 'schematic');
    show($('board'), view === 'board'); show($('board-hint'), view === 'board');
    $('view-schematic').classList.toggle('active', view === 'schematic'); $('view-board').classList.toggle('active', view === 'board');
    Board.setActive(view === 'board');
    if (view === 'board') ensureBoard().catch((e) => toast(e.message, 'error'));
    publishContext();
  }
  async function ensureBoard() {
    if (!state.design) return;
    if (!state.design.board) { await flushSave(); const out = await api('/designs/' + state.design.design_id + '/board', { method: 'POST', json: {} }); await adopt(out); }
    renderBoard();
  }
  function renderBoard() { if (state.view === 'board' && state.design && state.design.board) Board.setBoard(state.design.board, state.design.parts, state.caps.contract); }
  async function boardChanged(board) {
    if (!state.design) return;
    try {
      const out = await api('/designs/' + state.design.design_id + '/board', { method: 'PUT', json: Object.assign({ run: $('auto-run').checked }, board) });
      syncCanvas(out.design.parts, out.design.wires); await adopt(out);
    } catch (e) {
      if (e.status === 400) toast(e.message + (e.body && e.body.field ? ' [' + e.body.field + ']' : ''), 'error');
      else if (e.body && e.body.build) { showBuild(e.body.build); if (e.body.design) await adopt(e.body); } else toast(e.message, 'error');
    }
    renderBoard();
  }

  function renderDesign() {
    const d = state.design;
    $('empty-panel').hidden = !!d; $('design-panel').hidden = !d; $('runs-panel').hidden = !d;
    if (!d) return;
    renderBoard();
    $('design-heading').textContent = d.title;
    $('design-state').textContent = d.state === 'failed' ? 'failed: ' + (d.failure_reason || '').slice(0, 80) : (d.run_count ? 'run ' + d.run_count : 'draft');
    $('design-state').className = 'badge ' + d.state;
    if (document.activeElement !== $('sim-stop')) $('sim-stop').value = d.sim.stopSeconds;
    if (document.activeElement !== $('sim-step')) $('sim-step').value = d.sim.stepSeconds == null ? '' : d.sim.stepSeconds;
    $('sim-rest').checked = d.sim.startFromRest !== false;
    for (const k of ['reltol', 'gmin']) if (document.activeElement !== $('sim-' + k)) $('sim-' + k).value = d.sim[k] == null ? '' : d.sim[k];
    $('sim-method').value = d.sim.method || '';
    $('downloads').replaceChildren();
    if (d.artifacts && d.artifacts.report) ['waveforms', 'netlist', 'report'].forEach((k) => $('downloads').appendChild(el('a', { href: d.artifacts[k] + '?download', text: k, style: 'margin-right:12px' })));
    renderRuns();
    renderInspector();
  }
  function renderRuns() {
    const ul = $('runs'); ul.replaceChildren();
    if (!state.runs.length) ul.appendChild(el('li', { class: 'muted', text: 'not solved yet' }));
    state.runs.forEach((r) => ul.appendChild(el('li', {}, [el('span', { text: 'run ' + r.run }), el('span', { class: 'muted', text: (r.ms || 0) + ' ms · ' + r.partCount + ' parts · ' + r.warningCount + ' warnings' }), el('button', { class: 'link', text: 'show', onclick: () => showRun(r.run) }), el('button', { class: 'link', text: 'restore', title: 'put this run\'s circuit back (as a new run)', onclick: () => restoreRun(r.run) })])));
  }
  async function restoreRun(run) {
    if (!state.design) return;
    try { await flushSave(); const out = await api('/designs/' + state.design.design_id + '/restore', { method: 'POST', json: { run } }); syncCanvas(out.design.parts, out.design.wires); await adopt(out); toast('Restored run ' + run + ' as run ' + out.design.run_count, 'ok'); }
    catch (e) { if (e.body && e.body.build) { showBuild(e.body.build); if (e.body.design) await adopt(e.body); } else toast(e.message, 'error'); }
  }
  async function showRun(run) {
    if (!state.design) return;
    try { const out = await api('/designs/' + state.design.design_id + '/runs/' + run); state.report = out.run.report; await loadWaveforms(state.design, run); renderRun(); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function loadReport(design) {
    state.report = design.report || null; state.waveforms = null;
    if (design.run_count > 0 && design.artifacts && design.artifacts.waveforms) await loadWaveforms(design);
    renderRun();
  }
  async function loadWaveforms(design, run) {
    try { state.waveforms = await api('/designs/' + design.design_id + '/runs/' + (run || design.run_count) + '/artifacts/waveforms'); }
    catch (_) { state.waveforms = null; }
  }

  // ── Run, timeline, plots ───────────────────────────────────────────────────
  function simFromInputs() {
    const sim = { stopSeconds: Number($('sim-stop').value), startFromRest: $('sim-rest').checked };
    const step = $('sim-step').value.trim(); sim.stepSeconds = step ? Number(step) : null;
    // the solver knobs: empty sends null, which the contract reads as the lab's default
    for (const k of ['reltol', 'gmin']) { const v = $('sim-' + k).value.trim(); sim[k] = v ? Number(v) : null; }
    sim.method = $('sim-method').value || null;
    return sim;
  }
  async function run() {
    if (!state.design) return;
    $('run').disabled = true; $('run-status').textContent = 'solving…';
    try {
      await flushSave();
      const out = await api('/designs/' + state.design.design_id + '/run', { method: 'POST', json: simFromInputs() });
      await adopt(out);
      $('run-status').textContent = out.build && out.build.ok ? 'solved in ' + out.build.ms + ' ms' : '';
    } catch (e) { $('run-status').textContent = ''; if (e.body && e.body.build) { showBuild(e.body.build); if (e.body.design) await adopt(e.body); } else toast(e.message, 'error'); }
    finally { $('run').disabled = false; }
  }
  function renderRun() {
    const wf = state.waveforms, report = state.report;
    Canvas.setRun(report, wf);
    const n = wf && wf.time ? wf.time.length : 0;
    $('time-slider').max = Math.max(0, n - 1); $('time-slider').value = 0; state.timeIndex = 0; stopPlay();
    $('time-label').textContent = n ? 't = ' + Plot.fmtTime(wf.time[0]) : 't = —';
    renderSignals(); renderPlots(); renderReadings();
  }
  function renderSignals() {
    const box = $('signals'); box.replaceChildren();
    const wf = state.waveforms; if (!wf) { box.appendChild(el('span', { class: 'muted', text: 'run the circuit to get waveforms' })); return; }
    const names = Object.keys(wf.signals);
    const order = (n) => ['rpm(', 'i(', 'torque(', 'v('].findIndex((p) => n.startsWith(p));
    names.sort((a, b) => order(a) - order(b) || a.localeCompare(b));
    if (!state.picked.length || !state.picked.some((p) => names.includes(p))) {
      const parts = state.design ? state.design.parts : [];
      const led = parts.filter((p) => p.type === 'led').map((p) => 'i(' + p.id + ')');
      const batt = parts.filter((p) => p.type === 'battery').slice(0, 1).map((p) => 'i(' + p.id + ')');
      const motor = parts.filter((p) => p.type === 'motor').map((p) => 'rpm(' + p.id + ')');
      const caps = parts.filter((p) => p.type === 'capacitor').map((p) => 'v(' + (wf.netOfPin[p.id + '.a'] || '') + ')');
      state.picked = [...motor, ...led, ...batt, ...caps].filter((n) => names.includes(n)).slice(0, 6);
      if (!state.picked.length) state.picked = names.filter((n) => n.startsWith('v(')).slice(0, 2);
    }
    names.forEach((name, i) => {
      const cb = el('input', { type: 'checkbox' }); cb.checked = state.picked.includes(name);
      cb.addEventListener('change', () => { state.picked = cb.checked ? [...state.picked, name] : state.picked.filter((p) => p !== name); renderPlots(); });
      const swatch = el('span', { style: 'display:inline-block;width:10px;height:3px;background:' + Plot.COLORS[i % Plot.COLORS.length] + ';margin:0 4px 2px 2px' });
      box.appendChild(el('label', {}, [cb, swatch, name]));
    });
  }
  function renderPlots() { if (state.waveforms) Plot.render($('plots'), state.waveforms, state.picked, state.timeIndex); else $('plots').replaceChildren(); }
  function setTime(index) {
    state.timeIndex = index; $('time-slider').value = index;
    const wf = state.waveforms; if (wf && wf.time[index] !== undefined) $('time-label').textContent = 't = ' + Plot.fmtTime(wf.time[index]);
    Canvas.setTime(index); renderPlots();
  }
  function stopPlay() { state.playing = false; $('play').textContent = '▶ Play'; }
  function togglePlay() {
    if (!state.waveforms) return;
    if (state.playing) { stopPlay(); return; }
    state.playing = true; $('play').textContent = '❚❚ Pause'; state.playStart = performance.now() - (state.timeIndex / Math.max(1, state.waveforms.time.length - 1)) * Number($('play-speed').value) * 1000;
    const frame = (now) => {
      if (!state.playing) return;
      const n = state.waveforms.time.length, total = Number($('play-speed').value) * 1000;
      const frac = ((now - state.playStart) % total) / total;
      setTime(Math.min(n - 1, Math.floor(frac * n)));
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ── Readings ───────────────────────────────────────────────────────────────
  function summary(r) {
    switch (r.type) {
      case 'battery': return `${num(r.voltsFinal)} V · ${mA(r.ampsAvg)} avg (peak ${mA(r.ampsPeak)}) · ${W(r.wattsAvg)}` + (r.runtimeHours ? ` · runtime ≈ ${r.runtimeHours >= 100 ? Math.round(r.runtimeHours) : num(r.runtimeHours, 1)} h` : '');
      case 'source': return `${mA(r.ampsAvg)} avg · peak ${mA(r.ampsPeak)}`;
      case 'resistor': return `${mA(r.ampsFinal)} · ${num(r.voltsFinal)} V · ${W(r.wattsAvg)}` + (r.overRated ? ' · OVER RATING' : '');
      case 'potentiometer': return `${mA(r.ampsFinal)} · wiper ${num(r.wiperVoltsFinal)} V`;
      case 'capacitor': return `${num(r.voltsFinal)} V final · peak ${num(r.voltsPeak)} V` + (r.overRated ? ' · OVER RATED VOLTAGE' : '');
      case 'inductor': return `${mA(r.ampsFinal)} · peak ${mA(r.ampsPeak)}`;
      case 'diode': return `${mA(r.ampsFinal)} · ${num(r.voltsFinal)} V`;
      case 'led': return `${num(r.milliampsFinal, 1)} mA · ${r.lit ? 'lit' : 'dark'} · ${Math.round(r.brightness * 100)}% of max` + (r.overMax ? ' · ABOVE MAX CURRENT' : '');
      case 'switch': return `${r.closed ? 'closed' : 'open'} at the end · ${mA(r.ampsFinal)}`;
      case 'npn': case 'nmos': return `${mA(r.ampsFinal)} · ${num(r.voltsFinal)} V across · ${W(r.wattsAvg)}`;
      case 'motor': return `${Math.round(r.rpmFinal)} rpm · ${mA(r.ampsFinal)} · ${num(r.torqueMnmFinal, 1)} mN·m · ${W(r.mechanicalWattsFinal)} out / ${W(r.electricalWattsFinal)} in · ${Math.round(r.efficiencyPercent)}%` + (r.stalled ? ' · STALLED' : '');
      case 'gear': return `${r.shaft} · ${r.driven ? Math.round(r.rpmFinal) + ' rpm · ratio ' + num(r.ratio, 3) : 'not driven'} · r ${num(r.pitchRadiusMm, 1)} mm`;
      case 'load': return `${r.shaft} · ${r.driven ? Math.round(r.rpmFinal) + ' rpm' : 'not driven'}`;
      case 'zener': return `${num(-r.voltsFinal)} V across · ${mA(r.ampsFinal)}` + (r.regulating ? ' · regulating' : ' · not in breakdown');
      case 'lamp': return `${W(r.wattsAvg)} · ${Math.round(r.brightness * 100)}% of rated · ${r.lit ? 'lit' : 'dark'}` + (r.overRated ? ' · OVER RATING' : '');
      case 'regulator': return `${num(r.voltsFinal)} V out from ${num(r.inputVoltsFinal)} V · ${mA(r.ampsFinal)} · drops ${W(r.droppedWattsFinal)}` + (r.inDropout ? ' · IN DROPOUT' : '') + (r.overMax ? ' · OVER MAX CURRENT' : '');
      case 'opamp': return `${num(r.voltsFinal)} V out · ${mA(r.ampsFinal)}` + (r.saturated ? ' · SATURATED' : '');
      case 'relay': return `coil ${mA(r.coilAmpsFinal)} · ${r.energized ? 'energized' : 'released'} · contact ${mA(r.contactAmpsFinal)}`;
      case 'sequencer': return `${num(r.voltsFinal)} V (level ${num(r.levelFinal, 2)}) · ${r.steps} steps · ${mA(r.ampsAvg)} avg`;
      case 'hbridge': return `${r.direction} · ${num(r.voltsFinal)} V across · ${mA(r.ampsFinal)} out1 · peak ${mA(r.ampsPeak)}`;
      case 'timer555': return `${r.frequencyHz ? num(r.frequencyHz, 2) + ' Hz · ' + Math.round(r.dutyPercent) + '% duty' : 'no edges'} · out ${r.outHigh ? 'high' : 'low'} · ${r.risingEdges} edges`;
      case 'servo': return `${num(r.angleDeg, 1)}° (target ${num(r.targetDeg, 1)}° from ${num(r.pulseMs, 2)} ms) · ${mA(r.ampsFinal)} · peak ${mA(r.ampsPeak)}` + (r.stalled ? ' · STALLED' : r.tracking ? '' : ' · lagging');
      case 'stepper': return `${num(r.angleDeg, 1)}° · ${Math.round(r.rpmFinal)} rpm · load angle ${num(r.loadAngleDeg, 2)}° · ${mA(r.phaseAmpsFinal)} per phase` + (r.slipped ? ' · LOST STEPS' : r.holding ? ' · holding' : '');
      case 'stepdriver': return `${num(r.stepsFinal, 1)} steps · ${mA(r.ampsAvg)} avg from ${num(r.supplyVoltsFinal)} V · phase peak ${mA(r.phaseAmpsPeak)}`;
      case 'spring': return `${num(r.twistDegFinal, 2)}° twist (peak ${num(r.twistDegPeak, 2)}°) · ${num(r.torqueMnmFinal, 1)} mN·m (peak ${num(r.torqueMnmPeak, 1)})`;
      case 'pulley': return `${r.shaft} · ${Math.round(r.rpmFinal)} rpm` + (r.belt ? ` · belt ${num(r.beltForceNFinal, 2)} N · slip ${num(r.slipPercent, 1)}%` + (r.slipping ? ' · SLIPPING' : '') : ' · no belt');
      case 'crank': return `${Math.round(r.rpmFinal)} rpm · slider ${num(r.sliderXmmFinal, 1)} mm (${num(r.sliderXmmMin, 1)} … ${num(r.sliderXmmMax, 1)}) · stroke ${r.strokeMm} mm`;
      case 'arduino': { const pins = r.pinsDriven || []; return `compiled (${r.flashBytes} bytes) · ran ${num(r.simulatedSeconds, 2)} s · drives ${pins.length ? pins.join(' ') : 'no pin'} · ${r.edges || 0} edges · ${mA(r.ampsAvg)} avg from 5 V` + (r.serial ? ` · serial: ${String(r.serial).slice(0, 60).replace(/\s+/g, ' ')}` : ''); }
      default: return '';
    }
  }
  function renderReadings() {
    const box = $('readings'); box.replaceChildren();
    const report = state.report;
    if (!report || !report.readings) { box.appendChild(el('p', { class: 'muted small', text: 'Run the circuit to read every part.' })); $('warnings').replaceChildren(); return; }
    const table = el('table', { class: 'readings' }, [el('tr', {}, [el('th', { text: 'part' }), el('th', { text: 'reading' })])]);
    report.readings.filter((r) => r.type !== 'ground' && r.type !== 'junction').forEach((r) => table.appendChild(el('tr', { class: r.overRated || r.overMax || r.stalled ? 'warn' : '' }, [el('td', { text: r.id + ' (' + r.type + ')' }), el('td', { text: summary(r) })])));
    box.appendChild(table);
    const ul = $('warnings'); ul.replaceChildren();
    (report.warnings || []).forEach((w) => ul.appendChild(el('li', { text: w.message })));
  }

  // ── Inspector ──────────────────────────────────────────────────────────────
  function renderInspector() {
    const sel = state.selection, box = $('inspector');
    const form = $('props-form'); form.replaceChildren(); $('pin-list').replaceChildren();
    $('catalog-row').hidden = true; $('gear-to-cad').hidden = true;
    if (!sel || !state.design) { box.hidden = true; return; }
    box.hidden = false;
    if (sel.kind === 'wire') {
      const w = Canvas.circuit().wires.find((x) => x.id === sel.id); if (!w) { box.hidden = true; return; }
      $('selected-name').textContent = 'wire ' + w.id; $('apply-props').hidden = true; $('rotate-part').hidden = true;
      const routed = !w.route ? '' : Array.isArray(w.route.points) ? ` · ${w.route.points.length} bend${w.route.points.length === 1 ? '' : 's'} (double-click one to remove it)` : ` · routed at ${w.route.mid}`;
      $('pin-list').appendChild(el('li', { text: `${w.from.part}.${w.from.pin} ↔ ${w.to.part}.${w.to.pin}` + routed }));
      return;
    }
    if (sel.kind === 'parts') {
      $('selected-name').textContent = sel.ids.length + ' parts'; $('apply-props').hidden = true; $('rotate-part').hidden = false;
      sel.ids.forEach((id) => $('pin-list').appendChild(el('li', { text: id })));
      return;
    }
    const part = Canvas.circuit().parts.find((p) => p.id === sel.id); if (!part) { box.hidden = true; return; }
    const spec = state.caps.contract.parts[part.type];
    $('selected-name').textContent = `${part.id} — ${spec.label}`; $('apply-props').hidden = false; $('rotate-part').hidden = false;
    $('gear-to-cad').hidden = part.type !== 'gear';
    const rows = state.catalog.filter((r) => r.type === part.type);
    if (rows.length) {
      const pick = $('from-catalog'); pick.replaceChildren(el('option', { value: '', text: 'choose…' }));
      rows.forEach((r) => pick.appendChild(el('option', { value: r.id, text: r.name, title: r.source })));
      pick.value = ''; $('catalog-row').hidden = false;
    }
    form.appendChild(el('label', { text: 'label' })); form.appendChild(el('input', { type: 'text', id: 'prop-label', value: part.label || '' }));
    Object.entries(spec.props).forEach(([key, s]) => {
      form.appendChild(el('label', { text: key + (s.unit ? ' (' + s.unit + ')' : '') }));
      if (s.type === 'enum') { const sel2 = el('select', { id: 'prop-' + key }); s.values.forEach((v) => sel2.appendChild(el('option', { value: v, text: v }))); sel2.value = part.props[key]; form.appendChild(sel2); }
      else if (s.type === 'boolean') { const cb = el('input', { type: 'checkbox', id: 'prop-' + key }); cb.checked = !!part.props[key]; form.appendChild(cb); }
      else if (s.type === 'text' && s.maxLength > 400) { const ta = el('textarea', { id: 'prop-' + key, maxlength: String(s.maxLength), rows: '14', style: 'width:100%;grid-column:1 / -1;font-family:ui-monospace,Menlo,monospace;font-size:12px', spellcheck: 'false' }); ta.value = part.props[key] == null ? '' : String(part.props[key]); form.appendChild(ta); form.appendChild(el('div', { class: 'doc', text: key === 'sketch' ? 'an Uno sketch (setup / loop); compiled with avr-gcc and run in avr8js for the transient, at most 10 s; output pins drive the circuit' : 'text, at most ' + s.maxLength + ' characters' })); }
      else if (s.type === 'text') { form.appendChild(el('input', { type: 'text', id: 'prop-' + key, value: part.props[key] == null ? '' : String(part.props[key]), maxlength: String(s.maxLength), style: 'width:100%' })); form.appendChild(el('div', { class: 'doc', text: key === 'pattern' ? 'steps as level:seconds, e.g. 1:0.5 0:0.5 (level 0..1 of highVolts)' : 'text, at most ' + s.maxLength + ' characters' })); }
      else { form.appendChild(el('input', { type: 'number', id: 'prop-' + key, step: 'any', value: part.props[key] == null ? '' : part.props[key], placeholder: s.optional ? 'none' : '' })); form.appendChild(el('div', { class: 'doc', text: `${s.min} … ${s.max}` + (s.optional ? ' (optional)' : '') })); }
    });
    const pins = Canvas.pinsOf(part);
    Object.keys(pins).forEach((pin) => {
      const wires = Canvas.circuit().wires.filter((w) => (w.from.part === part.id && w.from.pin === pin) || (w.to.part === part.id && w.to.pin === pin));
      $('pin-list').appendChild(el('li', { text: `${pin}: ` + (wires.length ? wires.map((w) => { const o = w.from.part === part.id && w.from.pin === pin ? w.to : w.from; return o.part + '.' + o.pin; }).join(', ') : 'unconnected') }));
    });
  }
  function applyProps() {
    const sel = state.selection; if (!sel || sel.kind !== 'part') return;
    const part = Canvas.circuit().parts.find((p) => p.id === sel.id); if (!part) return;
    const spec = state.caps.contract.parts[part.type], props = {};
    Object.entries(spec.props).forEach(([key, s]) => {
      const input = $('prop-' + key);
      if (s.type === 'enum') props[key] = input.value; else if (s.type === 'boolean') props[key] = input.checked; else if (s.type === 'text') props[key] = s.maxLength > 400 ? input.value.replace(/\r\n/g, '\n') : input.value.trim(); else props[key] = input.value.trim() === '' ? null : Number(input.value);
    });
    Canvas.updatePart(part.id, { label: $('prop-label').value.trim().slice(0, 60), props });
  }
  function applyCatalog(rowId) {
    const sel = state.selection; if (!sel || sel.kind !== 'part' || !rowId) return;
    const row = state.catalog.find((r) => r.id === rowId); if (!row) return;
    Canvas.updatePart(sel.id, { props: Object.assign({}, row.nameplate) });
    toast(`${sel.id}: nameplate from "${row.name}" — ${row.source}`, 'ok');
  }
  /** A clicked wire plots its net's voltage (or its shaft's rpm for a mechanical link). */
  function plotWire(wireId) {
    const wf = state.waveforms, report = state.report; if (!wf || !report) return;
    const w = Canvas.circuit().wires.find((x) => x.id === wireId); if (!w) return;
    const pinKey = w.from.part + '.' + w.from.pin;
    let name = null;
    if (report.netOfPin && report.netOfPin[pinKey] !== undefined) { const net = report.netOfPin[pinKey]; name = net === '0' ? null : 'v(' + net + ')'; }
    else { const shaft = ((report.mechanism && report.mechanism.shafts) || []).find((s) => (s.parts || []).includes(w.from.part)); name = shaft ? 'rpm(' + shaft.id + ')' : null; }
    if (!name || !wf.signals[name]) { if (name === null && report.netOfPin && report.netOfPin[pinKey] === '0') toast('That wire is the 0 V reference.', 'info'); return; }
    if (!state.picked.includes(name)) state.picked = [...state.picked, name];
    renderSignals(); renderPlots();
  }

  // ── Autosave ───────────────────────────────────────────────────────────────
  function scheduleSave() {
    state.dirty = true; clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => { flushSave().catch(() => {}); }, 500);
  }
  async function flushSave() {
    if (!state.design || !state.dirty || state.saving) return;
    state.saving = true; state.dirty = false; clearTimeout(state.saveTimer);
    const designId = state.design.design_id;
    try {
      const out = await api('/designs/' + designId + '/circuit', { method: 'PUT', json: Object.assign({ run: $('auto-run').checked }, Canvas.circuit()) });
      if (state.design && state.design.design_id === designId) await adopt(out);
    } catch (e) {
      if (e.status === 400) toast(e.message + (e.body && e.body.field ? ' [' + e.body.field + ']' : ''), 'error');
      else if (e.body && e.body.build) { showBuild(e.body.build); if (e.body.design) await adopt(e.body); }
      else toast(e.message, 'error');
    } finally { state.saving = false; if (state.dirty) scheduleSave(); }
  }

  // ── Poll (the concierge edits from the chat rail) ──────────────────────────
  function startPoll() { stopPoll(); state.pollTimer = setInterval(poll, 5000); }
  function stopPoll() { if (state.pollTimer) clearInterval(state.pollTimer); state.pollTimer = null; }
  async function poll() {
    if (!state.design || state.dirty || state.saving || Canvas.isDragging()) return;
    const designId = state.design.design_id;
    try {
      const out = await api('/designs/' + designId);
      if (!state.design || state.design.design_id !== designId || out.design.updated_at === state.lastSeen || state.dirty) { renderEngine(out.engine); return; }
      state.design = out.design; state.lastSeen = out.design.updated_at; state.runs = out.runs || [];
      syncCanvas(out.design.parts, out.design.wires);
      renderDesign(); renderEngine(out.engine);
      await loadReport(out.design);
      publishContext();
    } catch (_) { /* transient */ }
  }

  // ── The assistant rail (surface-bridge → Jarvis) ───────────────────────────
  // The exact custom op the handler below matches on, and the action vocabulary inside it. The
  // assistant must be told this or it invents a plausible name and the edit is silently dropped.
  const ACTION_DOC = 'Edit or run the OPEN circuit. data = {"actions":[...]} using ONLY: {"op":"add_part","type","props"?,"id"?,"x"?,"y"?} {"op":"update_part","id","props"} {"op":"remove_part","id"} {"op":"connect","from":{"part","pin"},"to":{"part","pin"}} {"op":"disconnect","id"} {"op":"run","stopSeconds"?,"stepSeconds"?} {"op":"restore","run"} {"op":"open_example","example"} {"op":"select","id"} {"op":"view","name":"schematic"|"breadboard"}. Part types, pin names and property names come from GET /api/circuit-lab/capabilities; use the ids the digest lists.';
  const DIGEST_CAP = 3900;
  function partBrief(p) {
    const props = Object.entries(p.props || {}).filter(([k, v]) => v !== null && v !== '' && k !== 'sketch').map(([k, v]) => k + '=' + v).join(' ');
    const sketch = p.type === 'arduino' ? ' sketch ' + String(p.props.sketch || '').split('\n').length + ' lines' : '';
    return p.id + ' ' + p.type + (props ? ' (' + props.slice(0, 80) + ')' : '') + sketch;
  }
  function contextDigest() {
    const d = state.design; if (!d) return 'No circuit open. Pick a starter example or create a circuit.';
    const lines = [`${d.title}: ${d.parts.length} parts, ${d.wires.length} wires, ${d.run_count ? 'solved (run ' + d.run_count + ')' : 'not solved yet'}${d.state === 'failed' ? '; last solve FAILED: ' + (d.failure_reason || '') : ''}; transient ${d.sim.stopSeconds} s${state.view === 'board' ? '; the Breadboard view is open' : ''}`];
    lines.push('Parts: ' + d.parts.map(partBrief).join('; '));
    lines.push('Wires: ' + d.wires.map((w) => w.id + ' ' + w.from.part + '.' + w.from.pin + '-' + w.to.part + '.' + w.to.pin).join(', '));
    const report = state.report;
    if (report && report.readings) lines.push('Readings: ' + report.readings.filter((r) => r.type !== 'ground' && r.type !== 'junction').map((r) => r.id + ' ' + summary(r)).join('; '));
    if (report && report.warnings && report.warnings.length) lines.push('Warnings: ' + report.warnings.map((w) => w.message).join('; '));
    if (state.selection) lines.push('Selected: ' + (state.selection.kind === 'parts' ? state.selection.ids.join(', ') : state.selection.id));
    const text = lines.join('\n');
    return text.length > DIGEST_CAP ? text.slice(0, DIGEST_CAP) + '\n…(truncated)' : text;
  }
  function publishContext() {
    if (!window.__bridge) return;
    const d = state.design;
    try {
      window.__bridge.emitContext({
        surface: state.view === 'board' ? 'breadboard' : 'schematic',
        title: d ? d.title : 'Circuit Lab',
        ...(d ? { recordId: String(d.design_id) } : {}),
        digest: contextDigest(),
        fields: { view: state.view, parts: d ? d.parts.length : 0, wires: d ? d.wires.length : 0, run: d ? d.run_count : 0, autoRun: !!$('auto-run').checked, engineConnected: !!(state.caps && state.caps.engine && state.caps.engine.connected), selected: state.selection ? (state.selection.kind === 'parts' ? state.selection.ids.join(',') : String(state.selection.id)) : '' },
        can: ['custom', 'notify'],
        customOps: [{ name: 'circuit_action', description: ACTION_DOC }],
      });
    } catch (_) { /* the lab must never break because the assistant is unavailable */ }
  }
  /** Jarvis's edits go through the SAME routes the canvas and the concierge use: one save each, one solve at the end. */
  async function applyAssistantActions(actions) {
    let applied = 0, edited = false, ran = false, last = null;
    const errors = [];
    for (const a of actions) {
      if (!a || typeof a.op !== 'string') continue;
      try {
        if (a.op === 'open_example') { await createDesign(String(a.example || '')); applied += 1; continue; }
        if (a.op === 'view') { setView(a.name === 'breadboard' ? 'board' : 'schematic'); applied += 1; continue; }
        if (!state.design) { errors.push(a.op + ': no circuit is open'); continue; }
        if (a.op === 'select') { Canvas.select({ kind: 'part', id: String(a.id) }); applied += 1; continue; }
        await flushSave();
        const id = state.design.design_id;
        let out = null;
        switch (a.op) {
          case 'add_part': out = await api('/designs/' + id + '/parts', { method: 'POST', json: { type: a.type, id: a.id, props: a.props, x: a.x, y: a.y, label: a.label, run: false } }); edited = true; break;
          case 'update_part': out = await api('/designs/' + id + '/parts/' + encodeURIComponent(String(a.id)), { method: 'PATCH', json: { props: a.props, label: a.label, x: a.x, y: a.y, rotation: a.rotation, run: false } }); edited = true; break;
          case 'remove_part': out = await api('/designs/' + id + '/parts/' + encodeURIComponent(String(a.id)), { method: 'DELETE', json: { run: false } }); edited = true; break;
          case 'connect': out = await api('/designs/' + id + '/wires', { method: 'POST', json: { from: a.from, to: a.to, id: a.id, run: false } }); edited = true; break;
          case 'disconnect': out = await api('/designs/' + id + '/wires/' + encodeURIComponent(String(a.id)), { method: 'DELETE', json: { run: false } }); edited = true; break;
          case 'run': out = await api('/designs/' + id + '/run', { method: 'POST', json: { stopSeconds: a.stopSeconds, stepSeconds: a.stepSeconds, startFromRest: a.startFromRest } }); ran = true; break;
          case 'restore': out = await api('/designs/' + id + '/restore', { method: 'POST', json: { run: a.run } }); ran = true; break;
          default: errors.push(a.op + ': not an action this surface knows'); continue;
        }
        if (out) { last = out; applied += 1; }
      } catch (e) { errors.push(a.op + ': ' + e.message + (e.body && e.body.field ? ' [' + e.body.field + ']' : '')); }
    }
    if (last) { syncCanvas(last.design.parts, last.design.wires); await adopt(last); }
    if (edited && !ran && state.design && $('auto-run').checked && state.design.parts.length) {
      try { await adopt(await api('/designs/' + state.design.design_id + '/run', { method: 'POST', json: {} })); }
      catch (e) { if (e.body && e.body.build) { showBuild(e.body.build); if (e.body.design) await adopt(e.body); } else errors.push('run: ' + e.message); }
    }
    if (applied) toast('Jarvis made ' + applied + ' change' + (applied === 1 ? '' : 's') + (errors.length ? '; ' + errors.length + ' refused' : ''), errors.length ? 'error' : 'ok');
    else if (errors.length) toast('Jarvis: ' + errors[0], 'error');
    publishContext();
    return { applied, errors };
  }
  document.addEventListener('surface-bridge:custom', (evt) => {
    const detail = evt.detail || {};
    // The floating assistant's panel is created lazily and asks for a snapshot when it opens.
    if (detail.name === 'request_context') { publishContext(); return; }
    if (detail.name !== 'circuit_action') return;
    const actions = Array.isArray(detail.data && detail.data.actions) ? detail.data.actions : [detail.data];
    applyAssistantActions(actions).catch((e) => toast(e.message, 'error'));
  });
  window.addEventListener('bridge-ready', publishContext);
  window.CircuitLabAssistant = { contextDigest, applyAssistantActions, publishContext, ACTION_DOC };

  // ── Wiring ─────────────────────────────────────────────────────────────────
  Canvas.init($('canvas'), {
    onChange: () => { recordHistory(); scheduleSave(); renderInspector(); },
    onSelect: (sel) => { state.selection = sel; renderInspector(); if (sel && sel.kind === 'wire') plotWire(sel.id); publishContext(); },
    onError: (message) => toast(message, 'error'),
    onDrop: (type, x, y) => addPart(type, { x, y }),
  });
  Board.init($('board'), { onChange: boardChanged, onError: (message) => toast(message, 'error'), onSelect: () => {} });
  $('view-schematic').addEventListener('click', () => setView('schematic'));
  $('view-board').addEventListener('click', () => setView('board'));
  $('new-design').addEventListener('click', () => createDesign(null));
  $('example-select').addEventListener('change', (e) => { const id = e.target.value; e.target.value = ''; if (id) createDesign(id); });
  $('run').addEventListener('click', run);
  $('play').addEventListener('click', togglePlay);
  $('time-slider').addEventListener('input', (e) => { stopPlay(); setTime(Number(e.target.value)); });
  $('apply-props').addEventListener('click', applyProps);
  $('rotate-part').addEventListener('click', () => Canvas.rotateSelected());
  $('remove-selected').addEventListener('click', () => Canvas.deleteSelected());
  $('gear-to-cad').addEventListener('click', gearToCad);
  $('from-catalog').addEventListener('change', (e) => applyCatalog(e.target.value));
  $('show-values').addEventListener('change', (e) => Canvas.setShowValues(e.target.checked));
  $('reset-view').addEventListener('click', () => Canvas.resetView());
  document.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { undo(); e.preventDefault(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { redo(); e.preventDefault(); }
    else if (k === 'c') { copySelected(); }
    else if (k === 'v') { pasteClipboard(); e.preventDefault(); }
  });
  ['sim-stop', 'sim-step', 'sim-rest', 'sim-reltol', 'sim-gmin', 'sim-method'].forEach((id) => $(id).addEventListener('change', async () => {
    if (!state.design) return;
    try { await adopt(await api('/designs/' + state.design.design_id, { method: 'PATCH', json: { sim: simFromInputs() } })); }
    catch (e) { toast(e.message + (e.body && e.body.field ? ' [' + e.body.field + ']' : ''), 'error'); }
  }));
  $('rename-design').addEventListener('click', async () => {
    if (!state.design) return;
    const title = window.prompt('Circuit name', state.design.title); if (!title) return;
    try { await adopt(await api('/designs/' + state.design.design_id, { method: 'PATCH', json: { title } })); } catch (e) { toast(e.message, 'error'); }
  });
  $('delete-design').addEventListener('click', async () => {
    if (!state.design || !window.confirm('Delete "' + state.design.title + '" and its runs?')) return;
    try { await api('/designs/' + state.design.design_id, { method: 'DELETE' }); stopPoll(); state.design = null; state.report = null; state.waveforms = null; syncCanvas([], []); renderDesign(); await loadDesigns(); }
    catch (e) { toast(e.message, 'error'); }
  });
  window.addEventListener('beforeunload', () => { if (state.dirty) flushSave(); });

  (async () => {
    try { await loadCaps(); await loadDesigns(); }
    catch (e) { toast('Circuit Lab could not load: ' + e.message, 'error'); }
    const params = new URLSearchParams(location.search);
    if (params.get('design')) openDesign(params.get('design'));
  })();
})();
