/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The Drone Relay surface: chain list and form (preview without
 *                     |                             | saving, save, update, delete), the sized plan's facts and
 *                     |                             | notes, the corridor map (slots, drones, hops coloured by
 *                     |                             | margin) scrubbed through a run's frames or played, the
 *                     |                             | scenario builder (duration, failures, on station or from the
 *                     |                             | base), the run's verdict and timeline, the envelope trace
 *                     |                             | and the transport comparison. Every node is built with
 *                     |                             | textContent — nothing from the API is ever interpolated into
 *                     |                             | markup — and every call goes through one `api()` helper with
 *                     |                             | same-origin credentials.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The facts card shows the relays needed in rotation beside the
 *                     |                             | farthest relay's time on station.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | The form takes the posture and perched draw, the control
 *                     |                             | channel and heartbeat period, the courier's payload and
 *                     |                             | radio; the facts card shows the posture (with the antenna
 *                     |                             | height a perch needs), the control plane and the courier;
 *                     |                             | the result shows the store-and-forward numbers.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Trees (B5): the map draws every branch and places each slot
 *                     |                             | and drone on its own lane; the facts card shows the trunk
 *                     |                             | and branches, the result every tip's outage, the clock
 *                     |                             | every tip's target; the trace goes to the first tip. A tree
 *                     |                             | is sized through the API / the concierge (`branches`); the
 *                     |                             | form stays a straight corridor.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Lattices (B9): the map draws the survey area and places the
 *                     |                             | grid's slots and each drone at its own point; the facts card
 *                     |                             | shows the grid, its cover and its depth. Sized through the
 *                     |                             | API / the concierge (`area`).
 */
(function () {
  'use strict';
  const BASE = '/api/drone-relay';
  const $ = (id) => document.getElementById(id);
  const state = { caps: null, plans: [], plan: null, run: null, frame: 0, timer: null, failures: [] };

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
  function svgEl(tag, attrs) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (k === 'text') node.textContent = v; else node.setAttribute(k, v); });
    return node;
  }
  function toast(message, kind) {
    const t = $('toast');
    t.textContent = message; t.className = 'toast ' + (kind || 'info'); t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 5000);
  }
  const fmt = (v, d) => (Number.isFinite(Number(v)) ? Number(v).toFixed(d === undefined ? 1 : d) : '—');
  const fail = (err) => toast(err.body && err.body.field ? `${err.body.field}: ${err.message}` : err.message, 'error');

  // ── Form ────────────────────────────────────────────────────────────────────
  function specFromForm() {
    const length = Number($('f-length').value) || 1000;
    return {
      title: $('f-title').value, transport: $('f-transport').value, path: [{ x: 0, y: 0, z: 0 }, { x: length, y: 0, z: 0 }],
      spacingFactor: Number($('f-spacing').value), requiredMarginDb: Number($('f-margin').value), degradedMarginDb: Number($('f-degraded').value),
      fleetSize: Number($('f-fleet').value), tipDataKbps: Number($('f-kbps').value), enduranceS: Number($('f-endurance').value), reserveS: Number($('f-reserve').value),
      pathLossExponent: Number($('f-exponent').value), gapPolicy: $('f-policy').value,
      posture: $('f-posture').value, perchDrawFraction: Number($('f-perch').value), controlChannel: $('f-control').value, heartbeatS: Number($('f-heartbeat').value),
      courierMB: Number($('f-courier').value), courierTransport: $('f-courier-transport').value,
    };
  }
  function fillForm(spec) {
    if (!spec) return;
    $('f-title').value = spec.title || '';
    $('f-transport').value = spec.transport;
    const last = spec.path[spec.path.length - 1];
    $('f-length').value = Math.round(Math.hypot(last.x, last.y));
    $('f-spacing').value = spec.spacingFactor; $('f-margin').value = spec.requiredMarginDb; $('f-degraded').value = spec.degradedMarginDb;
    $('f-fleet').value = spec.fleetSize; $('f-kbps').value = spec.tipDataKbps; $('f-endurance').value = spec.enduranceS; $('f-reserve').value = spec.reserveS;
    $('f-exponent').value = spec.pathLossExponent; $('f-policy').value = spec.gapPolicy;
    $('f-posture').value = spec.posture; $('f-perch').value = spec.perchDrawFraction; $('f-control').value = spec.controlChannel; $('f-heartbeat').value = spec.heartbeatS;
    $('f-courier').value = spec.courierMB; $('f-courier-transport').value = spec.courierTransport;
  }

  // ── Plans ───────────────────────────────────────────────────────────────────
  async function loadPlans() {
    state.plans = (await api('/plans')).plans;
    const list = $('plan-list');
    list.replaceChildren();
    if (!state.plans.length) list.appendChild(el('p', { class: 'muted small', text: 'No chains yet.' }));
    state.plans.forEach((p) => {
      const verdict = p.last_metrics ? p.last_metrics.verdict : (p.plan.feasible ? 'sized' : 'infeasible');
      const tone = !p.plan.feasible || verdict === 'lost' ? 'bad' : verdict === 'held' || verdict === 'restored' ? 'ok' : verdict === 'degraded' ? 'warn' : '';
      list.appendChild(el('button', { class: 'plan-item' + (state.plan && state.plan.plan_id === p.plan_id ? ' active' : ''), onclick: () => openPlan(p.plan_id) }, [
        el('span', { class: 'plan-title', text: p.title }), el('span', { class: 'badge ' + tone, text: verdict }),
      ]));
    });
  }
  async function openPlan(planId) {
    const { plan } = await api('/plans/' + planId);
    state.plan = plan; state.run = plan.last_sim || null; state.failures = [];
    fillForm(plan.spec);
    $('form-title').textContent = 'Edit chain'; $('save-plan').textContent = 'Update'; $('delete-plan').hidden = false;
    renderPlan(plan.spec, plan.plan, plan.roster);
    renderRun();
    await loadPlans();
  }
  function newPlan() {
    state.plan = null; state.run = null; state.failures = [];
    $('form-title').textContent = 'New chain'; $('save-plan').textContent = 'Save'; $('delete-plan').hidden = true;
    $('plan-panel').hidden = true; $('empty-panel').hidden = false;
    loadPlans();
  }
  async function savePlan() {
    try {
      const spec = specFromForm();
      if (state.plan) { const { plan } = await api('/plans/' + state.plan.plan_id, { method: 'PATCH', json: spec }); state.plan = plan; state.run = null; toast('Chain updated; the last run was cleared.', 'ok'); }
      else { const { plan } = await api('/plans', { method: 'POST', json: spec }); state.plan = plan; state.run = null; toast('Chain saved.', 'ok'); $('form-title').textContent = 'Edit chain'; $('save-plan').textContent = 'Update'; $('delete-plan').hidden = false; }
      renderPlan(state.plan.spec, state.plan.plan, state.plan.roster); renderRun(); await loadPlans();
    } catch (err) { fail(err); }
  }
  async function previewPlan() {
    try { const { spec, sized } = await api('/plan-preview', { method: 'POST', json: specFromForm() }); state.run = null; renderPlan(spec, sized, null, true); renderRun(); } catch (err) { fail(err); }
  }
  async function deletePlan() {
    if (!state.plan || !window.confirm('Delete "' + state.plan.title + '"?')) return;
    await api('/plans/' + state.plan.plan_id, { method: 'DELETE' });
    newPlan();
  }

  // ── Plan rendering ──────────────────────────────────────────────────────────
  function renderPlan(spec, plan, roster, preview) {
    $('empty-panel').hidden = true; $('plan-panel').hidden = false;
    $('plan-heading').textContent = (preview ? 'Preview — ' : '') + (spec.title || 'Chain');
    const facts = $('plan-facts'); facts.replaceChildren();
    const add = (k, v) => { facts.appendChild(el('dt', { text: k })); facts.appendChild(el('dd', { text: v })); };
    add('Transport', plan.transport.name);
    add('Ranges', `design ${plan.designRangeM} m · degraded ${plan.degradedRangeM} m · edge ${plan.hardRangeM} m`);
    add('Corridor', `${fmt(plan.pathLengthM, 0)} m in ${plan.hops} hops of ${fmt(plan.hopM, 0)} m`);
    add('Relays', `${plan.relaysNeeded} needed · ${Math.max(0, plan.sparesAvailable)} spare${plan.sparesAvailable === 1 ? '' : 's'}`);
    add('Margin at the hop', `${fmt(plan.perHopMarginDb)} dB (design ${spec.requiredMarginDb} dB)`);
    add('Throughput', `${fmt(plan.endToEndKbps)} kbps end to end for ${spec.tipDataKbps} kbps · ${plan.endToEndLatencyMs} ms`);
    add('On station', `${plan.onStationS} s for the farthest relay (endurance ${spec.enduranceS} s)`);
    add('Rotation', `about ${plan.sustainFleet} relays hold every slot continuously; the fleet has ${spec.fleetSize}`);
    add('Gap policy', spec.gapPolicy);
    add('Posture', spec.posture === 'perch' ? `perch (${fmt(spec.perchDrawFraction * 100)} % of hover draw) · antenna ≥ ${fmt(plan.perchAntennaHeightM)} m at every perch` : 'hover');
    add('Control plane', plan.control ? `${plan.control.transport} direct: ${plan.control.reachesTipDirect ? 'reaches the tip' : `reaches ${plan.control.directRangeM} m only`} · ${fmt(plan.control.dutyPct)} % of the air for ${plan.control.nodesOnAir} nodes every ${spec.heartbeatS} s` : 'in band (through the chain)');
    if (plan.lattice) add('Lattice', `${fmt(plan.lattice.areaM2, 0)} m² on a ${fmt(plan.lattice.spacingM, 0)} m grid · ${plan.lattice.slots} slots${plan.lattice.feederSlots ? ` (${plan.lattice.feederSlots} feeders)` : ''} · every point within ${fmt(plan.lattice.coverM, 0)} m of a slot · ${plan.lattice.maxDepth} hops deep · a ${fmt(plan.lattice.surveyM, 0)} m sweep`);
    if (plan.tree) add('Tree', `trunk ${fmt(plan.tree.forkS, 0)} m to the fork in ${plan.tree.trunkHops} hops · ` + plan.tree.branches.map((b) => `branch ${b.index}: ${fmt(b.lengthM, 0)} m in ${b.hops} hops`).join(' · '));
    add('Courier', plan.courier ? `${plan.courier.payloadMB} MB per trip over ${plan.courier.transport}: ${plan.courier.tripS} s a trip ≈ ${fmt(plan.courier.equivalentKbps)} kbps${plan.courier.feasible ? '' : ' · NOT feasible on this battery'}` : 'none');
    const notes = $('plan-notes'); notes.replaceChildren();
    notes.appendChild(el('li', { class: plan.feasible ? '' : 'bad', text: plan.feasible ? 'Feasible.' : 'Not feasible.' }));
    plan.reasons.forEach((r) => notes.appendChild(el('li', { class: 'bad', text: r })));
    plan.warnings.forEach((w) => notes.appendChild(el('li', { class: 'warn', text: w })));
    $('open-design').disabled = !!preview; $('trace-cmd').disabled = !!preview; $('run-sim').disabled = !!preview || !plan.feasible;
    const drones = $('s-drone'); drones.replaceChildren();
    (roster || []).filter((id) => !/^tip\d*$/.test(id)).forEach((id) => drones.appendChild(el('option', { value: id, text: id })));
    renderFailures();
    state.viewPlan = plan; state.viewSpec = spec;
    drawMap(null);
    $('c-distance').value = Math.round(plan.hopM); compareTransports();
  }
  function renderFailures() {
    const list = $('s-events'); list.replaceChildren();
    state.failures.forEach((f, i) => list.appendChild(el('li', {}, [`${f.drone} fails at ${f.atS} s `, el('button', { class: 'link danger', text: 'remove', onclick: () => { state.failures.splice(i, 1); renderFailures(); } })])));
  }

  // ── Map ─────────────────────────────────────────────────────────────────────
  /** Lane 0 is the corridor (a tree's trunk); lane i is the trunk continued along branch i. */
  function laneList(spec) {
    return [spec.path].concat((spec.branches || []).map((b) => spec.path.concat(b)));
  }
  function projector(spec) {
    const pts = spec.area ? [{ x: 0, y: 0 }].concat(spec.area) : [].concat(...laneList(spec)); const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
    const scale = Math.min(920 / spanX, 220 / spanY, 920);
    return (p) => ({ x: 40 + (p.x - minX) * scale, y: 260 - (p.y - minY) * scale - (spanY < 1 ? 110 : 0) });
  }
  function pointAt(pts, s) {
    if (s <= 0) return pts[0];
    let remaining = s;
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1], b = pts[i], leg = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (remaining <= leg) { const f = leg ? remaining / leg : 0; return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: 0 }; }
      remaining -= leg;
    }
    return pts[pts.length - 1];
  }
  function drawMap(frame) {
    const spec = state.viewSpec, plan = state.viewPlan; if (!spec || !plan) return;
    const svg = $('map'); svg.replaceChildren();
    const proj = projector(spec);
    const lanes = spec.area ? [spec.area.concat([spec.area[0]])] : laneList(spec);
    lanes.forEach((lane) => {
      const corridor = lane.map((p, i) => `${i ? 'L' : 'M'}${proj(p).x.toFixed(1)},${proj(p).y.toFixed(1)}`).join(' ');
      svg.appendChild(svgEl('path', { d: corridor, fill: 'none', stroke: 'var(--dr-line)', 'stroke-width': 2, 'stroke-dasharray': '6 4' }));
    });
    const base = proj(spec.path[0]);
    svg.appendChild(svgEl('rect', { x: base.x - 7, y: base.y - 7, width: 14, height: 14, fill: 'var(--dr-text)' }));
    svg.appendChild(svgEl('text', { x: base.x, y: base.y + 24, 'text-anchor': 'middle', fill: 'var(--dr-muted)', 'font-size': 11, text: 'base' }));
    const tips = plan.tree ? plan.tree.branches.map((b) => b.tip) : [plan.tip];
    plan.slots.concat(tips).forEach((slot) => {
      const p = proj(slot.pt);
      svg.appendChild(svgEl('circle', { cx: p.x, cy: p.y, r: 7, fill: 'none', stroke: 'var(--dr-muted)', 'stroke-dasharray': '3 2' }));
      svg.appendChild(svgEl('text', { x: p.x, y: p.y - 12, 'text-anchor': 'middle', fill: 'var(--dr-muted)', 'font-size': 10, text: `${Math.round(slot.s)} m` }));
    });
    if (!frame) return;
    const pos = {}; frame.drones.forEach((d) => { pos[d.id] = proj(d.x !== undefined ? d : pointAt(lanes[d.lane || 0], d.s)); });
    frame.hops.forEach((h) => {
      const a = h.from === 'base' ? base : pos[h.from], b = pos[h.to]; if (!a || !b) return;
      const colour = !h.ok ? 'var(--dr-danger)' : h.marginDb < spec.requiredMarginDb ? 'var(--dr-warn)' : 'var(--dr-ok)';
      svg.appendChild(svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: colour, 'stroke-width': 2 }));
      svg.appendChild(svgEl('text', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 6, 'text-anchor': 'middle', fill: colour, 'font-size': 10, text: `${Math.round(h.distanceM)} m · ${fmt(h.marginDb, 0)} dB` }));
    });
    frame.drones.forEach((d) => {
      if (d.state === 'base' || d.state === 'landed') return;
      const p = pos[d.id];
      const colour = d.state === 'failed' || d.state === 'returning' ? 'var(--dr-muted)' : d.reachable ? 'var(--dr-accent)' : 'var(--dr-danger)';
      const yOff = d.state === 'returning' ? -14 : 0;
      svg.appendChild(svgEl('circle', { cx: p.x, cy: p.y + yOff, r: d.role === 'tip' ? 8 : 6, fill: d.state === 'failed' ? 'none' : colour, stroke: colour, 'stroke-width': 2 }));
      svg.appendChild(svgEl('text', { x: p.x, y: p.y + yOff + 22, 'text-anchor': 'middle', fill: colour, 'font-size': 11, text: d.id }));
    });
  }

  // ── Runs ────────────────────────────────────────────────────────────────────
  async function runSim() {
    if (!state.plan) return;
    const scenario = { durationS: Number($('s-duration').value), startDeployed: $('s-deployed').checked, events: state.failures.map((f) => ({ atS: f.atS, kind: 'fail', drone: f.drone })) };
    $('run-note').textContent = 'running…';
    try { const { run } = await api('/plans/' + state.plan.plan_id + '/simulate', { method: 'POST', json: scenario }); state.run = run; renderRun(); toast(`Run finished: ${run.metrics.verdict}.`, run.metrics.verdict === 'lost' ? 'error' : 'ok'); await loadPlans(); }
    catch (err) { fail(err); }
    $('run-note').textContent = '';
  }
  function renderRun() {
    stopPlay();
    const run = state.run;
    $('result-panel').hidden = !run; $('scrub').max = run ? run.frames.length - 1 : 0; $('scrub').value = 0; state.frame = 0;
    if (!run) { $('frame-note').textContent = 'slots of the plan — run a scenario to see the drones'; $('clock').textContent = ''; drawMap(null); return; }
    const m = run.metrics;
    $('verdict').textContent = m.verdict;
    const dl = $('metrics'); dl.replaceChildren();
    const add = (k, v) => { dl.appendChild(el('dt', { text: k })); dl.appendChild(el('dd', { text: v })); };
    add('Tip reachable', `${fmt(m.tipReachableS, 0)} s of ${fmt(m.durationS, 0)} s`);
    add('Outage', `${fmt(m.tipOutageS)} s in ${m.outages.length} outage${m.outages.length === 1 ? '' : 's'}`);
    add('Gap detected at', m.gapDetectedAtS.map((t) => fmt(t, 0) + ' s').join(', ') || '—');
    add('Reconnected at', m.reconnectedAtS.map((t) => fmt(t, 0) + ' s').join(', ') || '—');
    add('Restored at', m.restoredAtS.map((t) => fmt(t, 0) + ' s').join(', ') || '—');
    add('Worst hop margin', m.minHopMarginDb === null ? '—' : `${fmt(m.minHopMarginDb)} dB`);
    add('Spares · swaps · forced', `${m.sparesLaunched} · ${m.swaps} · ${m.forcedReturns}`);
    if (m.branches) add('Every tip', m.branches.map((b) => `${b.tip}: out ${fmt(b.outageS)} s${b.reconnectedAtS.length ? ', back at ' + b.reconnectedAtS.map((t) => fmt(t, 0) + ' s').join(', ') : ''}`).join(' · '));
    add('Store and forward', `longest outage ${fmt(m.longestOutageS)} s → ${fmt(m.tipBufferKB)} KB buffered, drained ${m.drainS === null ? 'never (no spare capacity)' : 'in ' + fmt(m.drainS) + ' s'}`);
    const events = $('events'); events.replaceChildren();
    run.events.forEach((ev) => events.appendChild(el('div', { text: `${fmt(ev.atS, 1)} s  ${ev.kind}  ${ev.text}` })));
    showFrame(0);
  }
  function showFrame(i) {
    const run = state.run; if (!run) return;
    state.frame = Math.max(0, Math.min(run.frames.length - 1, i));
    const f = run.frames[state.frame];
    $('scrub').value = state.frame;
    $('clock').textContent = `t = ${fmt(f.atS, 0)} s · ` + (f.tipTargets ? `tip targets ${f.tipTargets.map((t) => fmt(t, 0)).join(' / ')} m` : `tip target ${fmt(f.tipTargetS, 0)} m`);
    $('frame-note').textContent = 'run frame';
    drawMap(f);
  }
  function stopPlay() { if (state.timer) { clearInterval(state.timer); state.timer = null; } $('play').textContent = 'Play'; }
  function togglePlay() {
    if (state.timer) { stopPlay(); return; }
    if (!state.run) return;
    $('play').textContent = 'Pause';
    state.timer = setInterval(() => { if (state.frame >= state.run.frames.length - 1) { stopPlay(); return; } showFrame(state.frame + 1); }, 80);
  }

  // ── Trace and compare ───────────────────────────────────────────────────────
  async function traceCommand() {
    if (!state.plan) return;
    try {
      const dst = (state.plan.roster || []).find((id) => /^tip\d*$/.test(id)) || 'tip';
      const out = await api('/plans/' + state.plan.plan_id + '/trace', { method: 'POST', json: { dst, kind: 'command' } });
      const body = $('trace-body'); body.replaceChildren();
      out.trace.forEach((t) => body.appendChild(el('tr', { class: t.action === 'drop' ? 'bad' : 'ok' }, [el('td', { text: t.node }), el('td', { class: 'num', text: String(t.hop) }), el('td', { class: 'num', text: String(t.ttl) }), el('td', { text: t.action + (t.to ? ' → ' + t.to : '') + (t.reason ? ' (' + t.reason + ')' : '') })])));
      $('trace-note').textContent = `route ${out.envelope.route.join(' → ')} · reply ${out.replyRoute.join(' → ')} · MAC ${out.verifiedAtDestination ? 'verified at the destination' : 'NOT verified'} · ${out.keyNote}`;
      $('trace-panel').hidden = false;
    } catch (err) { fail(err); }
  }
  async function compareTransports() {
    try {
      const spec = state.viewSpec || specFromForm();
      const out = await api(`/transports?distanceM=${encodeURIComponent($('c-distance').value)}&requiredMarginDb=${encodeURIComponent(spec.requiredMarginDb)}&exponent=${encodeURIComponent(spec.pathLossExponent)}`);
      const body = $('compare-body'); body.replaceChildren();
      out.budgets.forEach((b) => {
        const t = (state.caps.transports || []).find((x) => x.id === b.transport) || { name: b.transport, throughputKbps: '', multiHop: '', module: '' };
        body.appendChild(el('tr', { class: b.ok ? 'ok' : 'bad' }, [el('td', { text: t.name }), el('td', { class: 'num', text: `${b.designRangeM} m` }), el('td', { class: 'num', text: `${fmt(b.marginDb)} dB` }), el('td', { class: 'num', text: String(t.throughputKbps) }), el('td', { text: t.multiHop }), el('td', { text: t.module })]));
      });
    } catch (err) { fail(err); }
  }

  // ── Boot ────────────────────────────────────────────────────────────────────
  async function boot() {
    state.caps = await api('/capabilities');
    const sel = $('f-transport'); sel.replaceChildren();
    state.caps.transports.forEach((t) => sel.appendChild(el('option', { value: t.id, text: t.name })));
    const control = $('f-control'); control.replaceChildren();
    (state.caps.controlChannels || ['in-band']).forEach((id) => control.appendChild(el('option', { value: id, text: id === 'in-band' ? 'in band (through the chain)' : id })));
    const courier = $('f-courier-transport'); courier.replaceChildren();
    state.caps.transports.forEach((t) => courier.appendChild(el('option', { value: t.id, text: t.id })));
    $('new-plan').addEventListener('click', newPlan);
    $('save-plan').addEventListener('click', savePlan);
    $('preview-plan').addEventListener('click', previewPlan);
    $('delete-plan').addEventListener('click', deletePlan);
    $('run-sim').addEventListener('click', runSim);
    $('s-add').addEventListener('click', () => { const drone = $('s-drone').value; if (!drone) return; state.failures.push({ drone, atS: Number($('s-at').value) || 0 }); renderFailures(); });
    $('scrub').addEventListener('input', (e) => { stopPlay(); showFrame(Number(e.target.value)); });
    $('play').addEventListener('click', togglePlay);
    $('open-design').addEventListener('click', () => { if (state.plan) window.open(state.plan.designUrl, '_blank'); });
    $('trace-cmd').addEventListener('click', traceCommand);
    $('compare').addEventListener('click', compareTransports);
    await loadPlans();
    if (state.plans.length) await openPlan(state.plans[0].plan_id);
  }
  boot().catch(fail);
})();
