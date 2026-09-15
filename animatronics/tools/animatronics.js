/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Two defects the browser suite found: a rehearsal animation still
 *                     |                             | ticking when Arm (or a rig change, a jog, a new rehearsal)
 *                     |                             | replaced the frames read the null set and threw — an animation
 *                     |                             | now belongs to the frames it started with and every frame
 *                     |                             | replacement stops it; and the command log did not refresh after
 *                     |                             | Play or a live jog.
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the surface's behaviour: rigs from templates,
 *                     |                             | the calibration table (a servo picked from the catalog fills
 *                     |                             | its numbers), jog sliders that move the drawing in design mode
 *                     |                             | and the prop once armed, poses (capture, view, play, delete),
 *                     |                             | the scenario editor (JSON of the contract the server enforces),
 *                     |                             | the look-at pad, Rehearse (report + the drawing replays the
 *                     |                             | rate-limited servos), the authority rail — Connect the
 *                     |                             | controller over Web Serial, Arm (browser confirm → server
 *                     |                             | confirm → hello + clamps + neutral to the controller), Play /
 *                     |                             | look-at / jog stream the server's lines, E-STOP goes to the
 *                     |                             | controller first and disarms after — the command log, and a
 *                     |                             | poll that adopts the director's edits from the chat rail.
 *                     |                             | Every node is built with textContent; every call goes through
 *                     |                             | one `api()` helper; the page never composes a pulse.
 */
(function () {
  'use strict';
  const BASE = '/api/animatronics';
  const $ = (id) => document.getElementById(id);
  const Protocol = window.AnimatronicsProtocol, Serial = window.AnimatronicsSerial, View = window.AnimatronicsView;
  const state = { caps: null, catalog: [], controllers: [], rigs: [], rig: null, runs: [], power: null, report: null, frames: null, timeIndex: 0, angles: {}, playTimer: null, pollTimer: null, jogTimer: null, lastSeen: '', link: null, scenarioId: null };

  async function api(path, opts) {
    const init = Object.assign({ credentials: 'same-origin', headers: {} }, opts || {});
    if (init.json !== undefined) { init.body = JSON.stringify(init.json); init.headers['Content-Type'] = 'application/json'; delete init.json; }
    const res = await fetch(BASE + path, init);
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = { raw: text }; }
    if (!res.ok) { const err = new Error((body && (body.message || (body.report && body.report.verdict && body.report.verdict.summary) || body.error)) || ('HTTP ' + res.status)); err.status = res.status; err.body = body; throw err; }
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
  const axesOf = () => (state.rig ? state.rig.axes : []);
  const channelOfAxis = (axis) => { const [mech, role] = axis.split('.'); const m = state.rig.rig.mechanisms.find((x) => x.id === mech); const id = m && m.axes[role]; return state.rig.rig.channels.find((c) => c.id === id); };

  // ── Capabilities, catalog, templates ────────────────────────────────────────
  async function loadCaps() {
    state.caps = await api('/capabilities');
    const cat = await api('/catalog/servos'); state.catalog = cat.servos; state.controllers = cat.controllers;
    const sel = $('template-select'); sel.replaceChildren();
    state.caps.templates.forEach((t) => sel.appendChild(el('option', { value: t.id, text: t.title + ' (' + t.channels + ' servos)', title: t.description })));
    const boards = $('controller-board'); boards.replaceChildren();
    Object.entries(state.caps.contract.controllerBoards).forEach(([id, b]) => boards.appendChild(el('option', { value: id, text: id + ' — ' + b.channels + ' outputs', title: b.label })));
  }

  // ── Rigs ─────────────────────────────────────────────────────────────────────
  async function loadRigs(selectId) {
    state.rigs = (await api('/rigs')).rigs;
    renderRigs();
    const want = selectId || (state.rig && state.rig.rig_id) || (state.rigs[0] && state.rigs[0].rig_id);
    if (want && state.rigs.some((r) => r.rig_id === want)) await selectRig(want); else { state.rig = null; renderEditor(); }
  }
  function renderRigs() {
    const box = $('rigs'); box.replaceChildren();
    state.rigs.forEach((r) => box.appendChild(el('button', { class: 'rig-item' + (state.rig && state.rig.rig_id === r.rig_id ? ' active' : ''), onclick: () => selectRig(r.rig_id) }, [el('span', { class: 'rig-title', text: r.title }), el('span', { class: 'badge ' + (r.armed ? 'danger' : ''), text: r.armed ? 'armed' : r.rig.channels.length + ' ch' })])));
  }
  async function selectRig(id) {
    const res = await api('/rigs/' + id);
    if (!state.rig || state.rig.rig_id !== id) { stopAnimation(); state.frames = null; state.report = null; }
    adopt(res);
    state.scenarioId = Object.keys(state.rig.scenarios)[0] || null;
    renderRigs(); renderEditor();
  }
  function adopt(res) {
    state.rig = res.rig; state.runs = res.runs || state.runs; state.power = res.power || state.power; state.lastSeen = res.rig.updated_at;
    if (!state.frames) state.angles = Object.assign({}, res.rig.current_pose);
    if (res.rig.last_report && !state.report) state.report = res.rig.last_report;
  }

  function renderEditor() {
    const has = Boolean(state.rig);
    $('empty').hidden = has; $('editor').hidden = !has;
    renderRail();
    if (!has) return;
    renderRigForm(); renderJog(); renderPoses(); renderScenarios(); renderReport(); renderRuns(); renderBudget(); view();
  }

  // ── Rig form: title, supply, controller, channels ───────────────────────────
  function renderRigForm() {
    const r = state.rig;
    $('rig-title').value = r.title;
    $('supply-source').value = r.rig.supply.source; $('supply-volts').value = r.rig.supply.volts; $('supply-amps').value = r.rig.supply.amps;
    $('controller-board').value = r.rig.controller.board; $('controller-transport').value = r.rig.controller.transport; $('controller-baud').value = r.rig.controller.baud;
    $('axes-label').textContent = 'axes: ' + r.axes.join(', ');
    const body = $('channels').querySelector('tbody'); body.replaceChildren();
    r.rig.channels.forEach((c) => {
      const num = (key, step) => el('input', { type: 'number', step: step || 1, value: c[key], 'data-key': key });
      const model = el('select', { 'data-key': 'model' });
      state.catalog.forEach((s) => model.appendChild(el('option', { value: s.id, text: s.name.split(' (')[0] })));
      model.value = c.model;
      const row = el('tr', { 'data-id': c.id }, [el('td', { text: c.id }), el('td', { text: String(c.channel) }), el('td', {}, [model]), el('td', {}, [num('centerUs')]), el('td', {}, [num('usPerDeg', 0.01)]), el('td', {}, [el('input', Object.assign({ type: 'checkbox', 'data-key': 'reversed' }, c.reversed ? { checked: '' } : {}))]), el('td', {}, [num('minDeg')]), el('td', {}, [num('maxDeg')]), el('td', {}, [num('neutralDeg')]), el('td', {}, [num('minUs')]), el('td', {}, [num('maxUs')]), el('td', {}, [num('maxDegPerS')])]);
      model.addEventListener('change', () => { const s = state.catalog.find((x) => x.id === model.value); if (!s) return; const set = (k, v) => { row.querySelector('[data-key=' + k + ']').value = v; }; set('usPerDeg', Math.round(((s.pulseMaxUs - s.pulseMinUs) / s.travelDeg) * 100) / 100); set('minUs', s.pulseMinUs); set('maxUs', s.pulseMaxUs); set('maxDegPerS', Math.round(60 / s.secondsPer60)); set('centerUs', Math.round((s.pulseMinUs + s.pulseMaxUs) / 2)); });
      body.appendChild(row);
    });
  }
  function gatherRig() {
    const r = state.rig.rig;
    const channels = Array.from($('channels').querySelectorAll('tbody tr')).map((row) => {
      const c = Object.assign({}, r.channels.find((x) => x.id === row.getAttribute('data-id')));
      row.querySelectorAll('[data-key]').forEach((input) => { const k = input.getAttribute('data-key'); c[k] = k === 'reversed' ? input.checked : (k === 'model' ? input.value : Number(input.value)); });
      return c;
    });
    return { channels, mechanisms: r.mechanisms, supply: { source: $('supply-source').value, volts: Number($('supply-volts').value), amps: Number($('supply-amps').value) }, controller: { board: $('controller-board').value, transport: $('controller-transport').value, baud: Number($('controller-baud').value) } };
  }
  async function saveRig() {
    try {
      const res = await api('/rigs/' + state.rig.rig_id, { method: 'PATCH', json: { rig: gatherRig() } });
      stopAnimation(); state.frames = null; state.report = null;
      adopt(res); state.angles = Object.assign({}, res.rig.current_pose);
      toast(res.disarmed ? 'Calibration saved — the rig is disarmed; arm it again to move the prop' : 'Calibration saved', 'ok');
      renderRigs(); renderEditor();
    } catch (e) { toast('Refused: ' + e.message + (e.body && e.body.field ? ' [' + e.body.field + ']' : ''), 'error'); }
  }

  // ── Jog ───────────────────────────────────────────────────────────────────────
  function renderJog() {
    const box = $('jog'); box.replaceChildren();
    axesOf().forEach((axis) => {
      const ch = channelOfAxis(axis); if (!ch) return;
      const value = Number.isFinite(state.angles[axis]) ? state.angles[axis] : ch.neutralDeg;
      const range = el('input', { type: 'range', min: ch.minDeg, max: ch.maxDeg, step: 0.5, value, 'data-axis': axis });
      const num = el('span', { class: 'small', text: fmt(value) + '°' });
      range.addEventListener('input', () => { state.angles[axis] = Number(range.value); num.textContent = fmt(range.value) + '°'; stopAnimation(); state.frames = null; view(); scheduleJog(axis, Number(range.value)); });
      box.appendChild(el('div', { class: 'jog-row' }, [el('span', { class: 'small', text: axis + ' (' + ch.minDeg + '…' + ch.maxDeg + '°)' }), range, num]));
    });
    $('jog-hint').textContent = state.rig.armed && linkUp() ? 'armed — sliders move the prop' : 'sliders move the drawing; arm with the controller connected to move the prop';
  }
  function scheduleJog(axis, value) {
    if (!state.rig.armed || !linkUp()) return;
    clearTimeout(state.jogTimer);
    state.jogTimer = setTimeout(async () => {
      try { const res = await api('/rigs/' + state.rig.rig_id + '/jog', { method: 'POST', json: { axes: { [axis]: value } } }); stopAnimation(); adoptDrive(res, false); await state.link.stream(res.lines, res.frames.frameMs); await refreshRuns(); }
      catch (e) { toast('Jog refused: ' + e.message, 'error'); }
    }, 120);
  }
  async function capturePose() {
    const name = (prompt('Pose name (UPPER_CASE, e.g. LOOK_LEFT_UP)') || '').trim();
    if (!name) return;
    const axes = {}; axesOf().forEach((a) => { const ch = channelOfAxis(a); axes[a] = Number.isFinite(state.angles[a]) ? state.angles[a] : ch.neutralDeg; });
    try { adopt(await api('/rigs/' + state.rig.rig_id + '/poses/' + encodeURIComponent(name), { method: 'PUT', json: { axes } })); toast('Pose ' + name + ' saved', 'ok'); renderPoses(); }
    catch (e) { toast('Refused: ' + e.message, 'error'); }
  }

  // ── Poses ─────────────────────────────────────────────────────────────────────
  function renderPoses() {
    const box = $('poses'); box.replaceChildren();
    const names = Object.keys(state.rig.poses);
    if (!names.length) box.appendChild(el('span', { class: 'muted small', text: 'No poses yet — jog the sliders and capture one.' }));
    names.forEach((name) => box.appendChild(el('span', { class: 'chip' }, [
      el('span', { text: name, title: JSON.stringify(state.rig.poses[name]) }),
      el('button', { class: 'link', text: 'view', title: 'rehearse a 400 ms move to this pose', onclick: () => rehearse({ pose: name, ms: 400 }) }),
      el('button', { class: 'link', text: '▶', title: 'play on the prop (armed only)', onclick: () => play({ pose: name, ms: 400 }) }),
      el('button', { class: 'link danger', text: '×', title: 'delete', onclick: () => deletePose(name) }),
    ])));
  }
  async function deletePose(name) {
    if (!confirm('Delete pose ' + name + '?')) return;
    try { adopt(await api('/rigs/' + state.rig.rig_id + '/poses/' + name, { method: 'DELETE' })); renderPoses(); }
    catch (e) { toast(e.status === 409 ? 'In use: ' + e.message : 'Refused: ' + e.message, 'error'); }
  }

  // ── Scenarios ─────────────────────────────────────────────────────────────────
  function renderScenarios() {
    const sel = $('scenario-select'); sel.replaceChildren();
    const names = Object.keys(state.rig.scenarios);
    names.forEach((n) => sel.appendChild(el('option', { value: n, text: n })));
    if (!names.includes(state.scenarioId)) state.scenarioId = names[0] || null;
    sel.value = state.scenarioId || '';
    $('scenario-json').value = state.scenarioId ? JSON.stringify(state.rig.scenarios[state.scenarioId], null, 2) : '';
    $('play').disabled = !(state.rig.armed && linkUp()) || !state.scenarioId;
    $('rehearse').disabled = !state.scenarioId;
  }
  async function saveScenario() {
    if (!state.scenarioId) return;
    let parsed;
    try { parsed = JSON.parse($('scenario-json').value); } catch (e) { toast('Not valid JSON: ' + e.message, 'error'); return; }
    try { adopt(await api('/rigs/' + state.rig.rig_id + '/scenarios/' + state.scenarioId, { method: 'PUT', json: parsed })); toast('Scenario ' + state.scenarioId + ' saved', 'ok'); renderScenarios(); }
    catch (e) { toast('Refused: ' + e.message + (e.body && e.body.field ? ' [' + e.body.field + ']' : ''), 'error'); }
  }
  async function newScenario() {
    const name = (prompt('Scenario name (UPPER_CASE, e.g. GREET)') || '').trim();
    if (!name) return;
    const pose = Object.keys(state.rig.poses)[0];
    const steps = pose ? [{ kind: 'move', pose, ms: 500, ease: 'in-out' }, { kind: 'hold', ms: 300 }] : [{ kind: 'hold', ms: 300 }];
    try { adopt(await api('/rigs/' + state.rig.rig_id + '/scenarios/' + encodeURIComponent(name), { method: 'PUT', json: { steps, description: 'new scenario' } })); state.scenarioId = name; renderScenarios(); }
    catch (e) { toast('Refused: ' + e.message, 'error'); }
  }
  async function deleteScenario() {
    if (!state.scenarioId || !confirm('Delete scenario ' + state.scenarioId + '?')) return;
    try { adopt(await api('/rigs/' + state.rig.rig_id + '/scenarios/' + state.scenarioId, { method: 'DELETE' })); state.scenarioId = null; renderScenarios(); }
    catch (e) { toast(e.status === 409 ? 'In use: ' + e.message : 'Refused: ' + e.message, 'error'); }
  }

  // ── Rehearse / play / look-at ────────────────────────────────────────────────
  function adoptFrames(res) {
    state.report = res.report; state.frames = res.frames; state.timeIndex = 0;
    $('timeline').max = String(res.frames.actual.length - 1); $('timeline').value = '0'; $('replay').disabled = false;
    renderReport();
  }
  function adoptDrive(res, animate) { if (res.rig) { state.rig = res.rig; state.lastSeen = res.rig.updated_at; } adoptFrames(res); if (animate) animateFrames(); renderRuns(); }
  async function rehearse(body) {
    try { const res = await api('/rigs/' + state.rig.rig_id + '/rehearse', { method: 'POST', json: body }); adoptFrames(res); animateFrames(); await refreshRuns(); toast(res.report.verdict.summary, res.report.verdict.ok ? 'ok' : 'error'); }
    catch (e) { toast('Rehearsal refused: ' + e.message + (e.body && e.body.field ? ' [' + e.body.field + ']' : ''), 'error'); }
  }
  async function play(body) {
    if (!state.rig.armed) { toast('Arm the rig first (controller connected)', 'error'); return; }
    if (!linkUp()) { toast('The controller is not connected — reconnect, then arm again', 'error'); return; }
    try {
      const res = await api('/rigs/' + state.rig.rig_id + '/play', { method: 'POST', json: body });
      stopAnimation();
      adoptDrive(res, false);
      await streamWithView(res.lines, res.frames);
      await refreshRuns();
      toast(res.report.verdict.summary, 'ok');
    } catch (e) { toast('Play refused: ' + e.message, 'error'); if (e.body && e.body.report) { state.report = e.body.report; renderReport(); } }
  }
  async function lookAt(azDeg, elDeg) {
    const live = state.rig.armed && linkUp();
    try {
      const res = await api('/rigs/' + state.rig.rig_id + '/look-at', { method: 'POST', json: live ? { azDeg, elDeg } : { azDeg, elDeg, rehearse: true } });
      $('look-readout').textContent = 'az ' + fmt(azDeg) + '°, el ' + fmt(elDeg) + '° → ' + Object.entries(res.lookAt.pose).map(([k, v]) => k + ' ' + fmt(v) + '°').join(', ') + (res.lookAt.reachable ? '' : ' — residual az ' + fmt(res.lookAt.residualDeg.az) + '°, el ' + fmt(res.lookAt.residualDeg.el) + '°') + (live ? '' : ' (rehearsed; arm to move)');
      if (live) { stopAnimation(); adoptDrive(res, false); await streamWithView(res.lines, res.frames); } else { adoptFrames(res); animateFrames(); }
      await refreshRuns();
    } catch (e) { toast('Look-at refused: ' + e.message, 'error'); }
  }
  async function streamWithView(lines, frames) {
    $('stream-state').textContent = 'streaming'; $('stream-state').className = 'badge accent';
    const result = await state.link.stream(lines, frames.frameMs, { onProgress: (i) => showFrame(i) });
    $('stream-state').textContent = result.aborted ? 'stopped' : 'idle'; $('stream-state').className = 'badge' + (result.aborted ? ' danger' : '');
  }

  // ── The view and its timeline ───────────────────────────────────────────────
  function view() { if (state.rig) View.render($('view'), state.rig.rig, state.angles); }
  function showFrame(i) {
    if (!state.frames) return;
    const row = state.frames.actual[Math.min(i, state.frames.actual.length - 1)];
    Object.entries(state.frames.axisIndex).forEach(([axis, idx]) => { state.angles[axis] = row[idx]; });
    state.timeIndex = i; $('timeline').value = String(i); $('time-label').textContent = (i * state.frames.frameMs) + ' ms / ' + ((state.frames.actual.length - 1) * state.frames.frameMs) + ' ms';
    view();
    $('jog').querySelectorAll('input[type=range]').forEach((r) => { const a = r.getAttribute('data-axis'); if (Number.isFinite(state.angles[a])) r.value = state.angles[a]; });
  }
  function animateFrames() {
    clearTimeout(state.playTimer);
    const frames = state.frames;
    if (!frames) return;
    let i = 0;
    // The animation belongs to the frames it started with: an arm, a rig change or a new rehearsal
    // replaces state.frames, and a stale timer must stop rather than read the new (or null) set.
    const step = () => { if (state.frames !== frames) return; showFrame(i); i += 1; if (i < frames.actual.length) state.playTimer = setTimeout(step, frames.frameMs); };
    step();
  }
  function stopAnimation() { clearTimeout(state.playTimer); state.playTimer = null; }

  // ── Report, runs, budget ────────────────────────────────────────────────────
  function renderReport() {
    const r = state.report; const v = $('verdict'); const body = $('report-channels').querySelector('tbody'); body.replaceChildren();
    if (!r) { v.textContent = 'No rehearsal yet.'; v.className = 'verdict muted'; $('power').textContent = ''; return; }
    v.className = 'verdict ' + (r.verdict.ok ? 'ok' : 'bad');
    v.replaceChildren(el('div', { text: r.verdict.summary }), ...(r.verdict.reasons || []).map((x) => el('div', { class: 'small', text: '• ' + x })));
    (r.channels || []).forEach((c) => body.appendChild(el('tr', {}, [c.id, String(c.demandDegPerS), String(c.maxDegPerS), fmt(c.maxLagDeg, 2), String(c.saturatedFrames), c.settled ? 'yes (' + c.settleMs + ' ms)' : 'no', String(c.travelDeg)].map((t) => el('td', { text: t })))));
    const p = r.power;
    $('power').replaceChildren(el('div', {}, [el('b', { text: 'Supply ' }), document.createTextNode(p.supply.volts + ' V / ' + p.supply.amps + ' A (' + p.supply.source + ') — idle ' + p.idleA + ' A, peak ' + p.peakMovingA + ' A at frame ' + p.peakMovingFrame + ' (' + (p.peakMovingChannels || []).join(', ') + '), all stalled ' + p.stallA + ' A, headroom ' + Math.round(p.headroom * 100) + ' % — '), el('span', { class: 'badge ' + (p.verdict === 'ok' ? 'ok' : p.verdict === 'warn' ? 'warn' : 'danger'), text: p.verdict })]), ...(p.notes || []).map((n) => el('div', { class: 'muted', text: n })));
  }
  async function refreshRuns() { if (!state.rig) return; state.runs = (await api('/rigs/' + state.rig.rig_id + '/runs')).runs; renderRuns(); }
  function renderRuns() {
    const ul = $('runs'); ul.replaceChildren();
    (state.runs || []).slice(0, 30).forEach((r) => ul.appendChild(el('li', {}, [el('span', { class: 'muted', text: '#' + r.run }), el('span', { class: 'badge ' + (r.kind === 'play' || r.kind === 'look-at' || r.kind === 'jog' ? 'accent' : r.kind === 'arm' ? 'danger' : ''), text: r.kind }), el('span', { text: (r.scenario || '') + (r.frames ? ' · ' + r.frames + ' frames' : '') }), el('span', { class: 'muted', text: r.verdict || '' }), el('span', { class: 'muted', text: new Date(r.created_at).toLocaleTimeString() })])));
    if (!(state.runs || []).length) ul.appendChild(el('li', { class: 'muted', text: 'Nothing logged yet.' }));
  }
  function renderBudget() {
    const p = state.power; const box = $('budget');
    if (!p) { box.textContent = '—'; return; }
    box.replaceChildren(...[['supply', p.supply.volts + ' V / ' + p.supply.amps + ' A ' + p.supply.source], ['idle', p.idleA + ' A'], ['all moving', p.peakMovingA + ' A'], ['all stalled', p.stallA + ' A'], ['verdict', p.verdict]].flatMap(([k, v]) => [el('b', { text: k }), el('span', { text: v })]), ...(p.reasons || []).concat(p.notes || []).flatMap((n) => [el('b', { text: '' }), el('span', { class: 'small', text: n })]));
  }

  // ── Controller link and the authority rail ──────────────────────────────────
  const linkUp = () => Boolean(state.link && state.link.isConnected());
  function renderRail() {
    const up = linkUp(); const armed = Boolean(state.rig && state.rig.armed);
    $('armed-pill').textContent = armed ? 'ARMED' : 'disarmed'; $('armed-pill').className = 'badge ' + (armed ? 'danger' : '');
    const st = state.link ? state.link.state : 'disconnected';
    $('link-pill').textContent = 'controller: ' + (up ? st + (state.link.hello ? ' · ' + state.link.hello.board + '/' + state.link.hello.channels : '') : 'not connected');
    $('link-pill').className = 'badge ' + (st === 'estopped' ? 'danger' : up ? 'ok' : '');
    $('connect').disabled = up; $('disconnect').disabled = !up; $('estop').disabled = !up; $('release').disabled = !(up && st === 'estopped');
    $('arm').disabled = !(up && state.rig && !armed); $('disarm').disabled = !(state.rig && armed);
    $('serial-support').textContent = Serial.supported() ? 'Web Serial available — Connect asks the browser for the USB port of the ESP32 / Arduino.' : 'Web Serial needs a Chromium desktop browser (Chrome, Edge) on HTTPS or localhost; the drawing and the rehearsal still work here.';
    const info = $('link-info'); info.replaceChildren();
    if (state.link) [['state', st], ['hello', state.link.hello ? state.link.hello.name + '/' + state.link.hello.version + ' ' + state.link.hello.board + ' ' + state.link.hello.channels + ' ch' : '—'], ['sent / ok / err', state.link.counters.sent + ' / ' + state.link.counters.ok + ' / ' + state.link.counters.err], ['last error', state.link.lastError || '—']].forEach(([k, v]) => { info.appendChild(el('b', { text: k })); info.appendChild(el('span', { text: v })); });
    if (state.rig) { $('play').disabled = !(armed && up) || !state.scenarioId; $('jog-hint').textContent = armed && up ? 'armed — sliders move the prop' : 'sliders move the drawing; arm with the controller connected to move the prop'; }
  }
  function ensureLink() {
    if (state.link) return state.link;
    state.link = Serial.createControllerLink({ serial: navigator.serial, protocol: Protocol, onMessage: () => renderRail(), onState: (s) => { renderRail(); if (s === 'disconnected' && state.rig && state.rig.armed) disarm('controller link lost'); } });
    return state.link;
  }
  async function connect() { try { await ensureLink().connect(); toast('Controller connected — arm the rig to bring it up', 'ok'); } catch (e) { toast(e.message, 'error'); } renderRail(); }
  async function disconnect() { if (state.rig && state.rig.armed) await disarm('disconnect'); if (state.link) await state.link.disconnect(); renderRail(); }
  async function arm() {
    if (!linkUp()) { toast('Connect the controller first', 'error'); return; }
    if (!confirm('Arm "' + state.rig.title + '"?\n\nThe controller receives hello, every channel\'s pulse clamps and the neutral frame, and Play / look-at / jog will move the prop. Keep hands clear of the mechanism.')) return;
    try {
      const res = await api('/rigs/' + state.rig.rig_id + '/arm', { method: 'POST', json: { confirm: true } });
      await state.link.sendLines(res.lines);
      stopAnimation(); state.rig = res.rig; state.frames = null; state.angles = Object.assign({}, res.rig.current_pose);
      toast('Armed — ' + res.lines.length + ' bring-up lines sent', 'ok');
      await refreshRuns(); renderRigs(); renderEditor();
    } catch (e) { toast('Arm refused: ' + e.message + (e.body && e.body.power && e.body.power.reasons ? ' — ' + e.body.power.reasons[0] : ''), 'error'); }
  }
  async function estop() {
    try { if (linkUp()) await state.link.estop(Protocol.encodeEstop()); } catch (e) { toast('E-STOP line failed: ' + e.message, 'error'); }
    await disarm('e-stop'); toast('E-STOP — outputs off, rig disarmed', 'error');
  }
  async function disarm(reason) {
    if (!state.rig) return;
    try { const res = await api('/rigs/' + state.rig.rig_id + '/disarm', { method: 'POST', json: { reason: reason || 'operator' } }); state.rig = res.rig; if (reason === 'operator' && linkUp()) await state.link.estop(res.lines[0]); }
    catch (e) { toast('Disarm failed: ' + e.message, 'error'); }
    await refreshRuns(); renderRigs(); renderEditor();
  }
  async function release() { try { await state.link.release(Protocol.encodeRelease()); toast('Controller released — arm the rig again to move it', 'ok'); } catch (e) { toast(e.message, 'error'); } renderRail(); }

  // ── Poll for the director's edits ───────────────────────────────────────────
  function startPoll() {
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(async () => {
      if (!state.rig || (state.link && state.link.state === 'streaming')) return;
      try { const res = await api('/rigs/' + state.rig.rig_id); if (res.rig.updated_at !== state.lastSeen) { adopt(res); renderRigs(); renderEditor(); } }
      catch (e) { if (e.status === 404) await loadRigs(); }
    }, 5000);
  }

  // ── Wire-up ──────────────────────────────────────────────────────────────────
  function wire() {
    $('new-rig').addEventListener('click', async () => { try { const res = await api('/rigs', { method: 'POST', json: { template: $('template-select').value } }); stopAnimation(); state.frames = null; state.report = null; await loadRigs(res.rig.rig_id); toast('Rig created from ' + $('template-select').value, 'ok'); } catch (e) { toast(e.message, 'error'); } });
    $('save-title').addEventListener('click', async () => { try { adopt(await api('/rigs/' + state.rig.rig_id, { method: 'PATCH', json: { title: $('rig-title').value } })); renderRigs(); } catch (e) { toast(e.message, 'error'); } });
    $('delete-rig').addEventListener('click', async () => { if (!confirm('Delete rig "' + state.rig.title + '" and its log?')) return; try { await api('/rigs/' + state.rig.rig_id, { method: 'DELETE' }); stopAnimation(); state.rig = null; state.frames = null; state.report = null; await loadRigs(); } catch (e) { toast(e.message, 'error'); } });
    $('save-rig').addEventListener('click', saveRig);
    $('capture-pose').addEventListener('click', capturePose);
    $('jog-neutral').addEventListener('click', () => { axesOf().forEach((a) => { const ch = channelOfAxis(a); state.angles[a] = ch.neutralDeg; }); stopAnimation(); state.frames = null; renderJog(); view(); if (state.rig.armed && linkUp()) rehearseOrPlayNeutral(); });
    $('scenario-select').addEventListener('change', (e) => { state.scenarioId = e.target.value; renderScenarios(); });
    $('new-scenario').addEventListener('click', newScenario);
    $('delete-scenario').addEventListener('click', deleteScenario);
    $('save-scenario').addEventListener('click', saveScenario);
    $('rehearse').addEventListener('click', () => rehearse({ scenario: state.scenarioId }));
    $('play').addEventListener('click', () => play({ scenario: state.scenarioId }));
    $('replay').addEventListener('click', animateFrames);
    $('timeline').addEventListener('input', (e) => { clearTimeout(state.playTimer); showFrame(Number(e.target.value)); });
    $('lookpad').addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); const fx = (e.clientX - r.left) / r.width; const fy = (e.clientY - r.top) / r.height; e.currentTarget.querySelector('.mark').style.left = (fx * 100) + '%'; e.currentTarget.querySelector('.mark').style.top = (fy * 100) + '%'; lookAt(Math.round((fx - 0.5) * 120 * 10) / 10, Math.round((0.5 - fy) * 60 * 10) / 10); });
    $('connect').addEventListener('click', connect);
    $('disconnect').addEventListener('click', disconnect);
    $('arm').addEventListener('click', arm);
    $('disarm').addEventListener('click', () => disarm('operator'));
    $('estop').addEventListener('click', estop);
    $('release').addEventListener('click', release);
    window.addEventListener('beforeunload', () => { if (linkUp() && state.rig && state.rig.armed) { navigator.sendBeacon && navigator.sendBeacon(BASE + '/rigs/' + state.rig.rig_id + '/disarm', new Blob([JSON.stringify({ reason: 'page closed' })], { type: 'application/json' })); } });
  }
  async function rehearseOrPlayNeutral() { const axes = {}; axesOf().forEach((a) => { axes[a] = channelOfAxis(a).neutralDeg; }); await play({ axes, ms: 600 }); }

  (async function main() {
    try { await loadCaps(); wire(); renderRail(); await loadRigs(); startPoll(); }
    catch (e) { toast('The app could not load: ' + e.message, 'error'); }
  })();
})();
