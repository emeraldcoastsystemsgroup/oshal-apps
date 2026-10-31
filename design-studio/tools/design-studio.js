/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D4, lane @ds-app: the Design Studio page. Four screens on one
 *                     |                             | hash route (#/ Products, #/new New product, #/product/<id> Product,
 *                     |                             | #/product/<id>/settings Settings). The Product screen reads the
 *                     |                             | engines through the person's session (design-studio-stages.js)
 *                     |                             | and renders one poster per phase with one button; a button's
 *                     |                             | write goes through this package's routes (bind, close) or the
 *                     |                             | engine's own (the baselines, the gate, a circuit from an
 *                     |                             | example). The open product registers with the shared document
 *                     |                             | handoff so the design partner edits what the person sees, and
 *                     |                             | the assistant rail gets a context digest and custom ops.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D7, lane @ds-fab: Make the print set runs the fabricate
 *                     |                             | module (every part through CAD Studio with the person's session,
 *                     |                             | the set written by this package) and shows each part's outcome
 *                     |                             | and the manifest's sha256; Send to printer asks, then sends one
 *                     |                             | file through the print service. The record-the-manifest flow is
 *                     |                             | gone: the Fabricate phase closes on the made set's manifest.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D9, lane @ds-plant: a fifth screen, Mechanism
 *                     |                             | (#/product/<id>/mechanism), reached from the Design poster of a
 *                     |                             | CAD-bound product; Create the parts in CAD Studio builds an
 *                     |                             | example's programs with the person's session; the Simulate
 *                     |                             | poster's Build the plant, Run the baselines, Train the policy
 *                     |                             | and Certify go to embodied's plant routes (the mechanism module).
 */
function designStudio() {
  'use strict';
  const S = window.DesignStudioStages; const V = window.DesignStudioScreens; const F = window.DesignStudioFabricate; const M = window.DesignStudioMechanism;
  const API = '/api/design-studio';
  const $ = (id) => document.getElementById(id);
  const state = { screen: '', caps: null, projects: [], project: null, bindings: {}, closures: [], E: null, rows: [], proposal: null, present: {}, editing: null, planTimer: null, writes: new Set() };

  // ── HTTP: this package's routes ──
  async function api(path, opts) {
    const o = opts || {};
    const res = await fetch(API + path, { method: o.method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: o.json ? { 'Content-Type': 'application/json' } : {}, body: o.json ? JSON.stringify(o.json) : undefined });
    const text = await res.text(); let out = null; try { out = text ? JSON.parse(text) : null; } catch (_) { out = { raw: text }; }
    if (!res.ok) { const err = new Error((out && (out.message || out.error)) || `HTTP ${res.status}`); err.status = res.status; err.body = out; throw err; }
    return out;
  }
  const tracked = (p) => { state.writes.add(p); p.finally(() => state.writes.delete(p)); return p; };
  async function settleWrites() { while (state.writes.size) await Promise.allSettled(Array.from(state.writes)); }
  let toastTimer = null; let lastToast = null;
  function toast(text, kind) {
    lastToast = { text, kind: kind || '' };
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); document.body.appendChild(t); }
    t.className = `toast ${kind || ''}`; t.textContent = text;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 7000);
  }

  // ── Screens ──
  function show(screen, title, lede) {
    state.screen = screen;
    for (const id of ['screen-products', 'screen-new', 'screen-product', 'screen-settings', 'screen-mechanism']) $(id).hidden = id !== `screen-${screen}`;
    $('title').textContent = title; if (lede !== undefined) $('lede').textContent = lede;
    $('back').hidden = screen === 'products'; $('new-product').hidden = screen !== 'products'; $('settings-link').hidden = screen !== 'product';
    $('studio').dataset.screen = screen;
    if (state.project) { $('settings-link').href = `#/product/${encodeURIComponent(state.project.id)}/settings`; $('back').href = screen === 'settings' || screen === 'mechanism' || state.editing ? `#/product/${encodeURIComponent(state.project.id)}` : '#/'; $('back').textContent = screen === 'settings' || screen === 'mechanism' || state.editing ? 'Product' : 'Products'; }
    else { $('back').href = '#/'; $('back').textContent = 'Products'; }
    $('kicker').textContent = state.project && screen !== 'products' && screen !== 'new' ? `Design Studio · ${state.project.name}` : 'Design Studio';
  }
  function markReady() { const m = $('studio'); m.dataset.reads = String(Number(m.dataset.reads || 0) + 1); m.dataset.ready = '1'; publishContext(); }

  async function showProducts() {
    state.project = null; state.editing = null;
    show('products', 'Products', 'Brief → Design → Mechanical → Electrical → Sensors → Controller → Simulate → Fabricate → Build. A product carries the phases its brief needs; each phase is read from its engine when this page opens and is never stored.');
    try { state.projects = (await api('/projects')).projects; V.renderProducts($('screen-products'), state.projects); }
    catch (e) { $('screen-products').textContent = ''; $('screen-products').append(Object.assign(document.createElement('p'), { className: 'empty', textContent: `The products could not be read: ${e.message}` })); }
    markReady();
  }
  async function showNew(editing) {
    state.editing = editing || null;
    show('new', editing ? 'Edit the brief' : 'New product', editing ? 'Change the words; the phase chain is kept, and the Brief phase re-opens because its revision moves.' : 'The walkthrough writes the brief: a name, what it is in one line, what it must do one requirement per line, the targets; then the phase chain is proposed from the requirement lines and you press Create.');
    if (!$('new-form').dataset.wired) { wireNewForm(); $('new-form').dataset.wired = '1'; }
    if (editing) V.fillBrief(editing); else $('new-form').reset();
    $('proposal-card').hidden = !!editing; $('create').textContent = editing ? 'Save the brief' : 'Create';
    if (!editing) await plan();
    markReady();
  }
  async function showProduct(id) {
    show('product', state.project && state.project.id === id ? state.project.name : 'Product', 'One poster per phase, in chain order. The stage is what the engine answered when this page was read; the one button is the phase\'s action.');
    try { await loadProduct(id); } catch (e) { $('screen-product').textContent = ''; $('screen-product').append(Object.assign(document.createElement('p'), { className: 'empty', textContent: e.status === 404 ? 'This product is not yours or no longer exists.' : `The product could not be read: ${e.message}` })); markReady(); return; }
    show('product', state.project.name, state.project.brief.what || '');
    await readAndRender();
  }
  async function showSettings(id) {
    try { if (!state.caps) state.caps = await api('/capabilities'); await loadProduct(id); } catch (e) { toast(e.message, 'error'); location.hash = '#/'; return; }
    show('settings', `Settings · ${state.project.name}`, 'Engines per phase and the printer the print set goes to. An engine that did not answer this session is marked absent.');
    state.E = await S.readEngines(state.project, state.bindings, { all: true }); state.present = presence(state.E);
    V.renderSettings(state.project, state.bindings, state.caps, state.E, state.present);
    markReady();
  }
  async function loadProduct(id) {
    const out = await api(`/projects/${encodeURIComponent(id)}`);
    state.project = out.project; state.bindings = out.bindings || {}; state.closures = out.closures || []; state.mechanism = out.mechanism || null;
  }
  async function showMechanism(id) {
    try { await loadProduct(id); } catch (e) { toast(e.message, 'error'); location.hash = '#/'; return; }
    show('mechanism', `Mechanism · ${state.project.name}`, 'The part that is ground, the joints between parts, which bought motor row drives each and through what ratio, the payload, and the task read from the brief. The plant embodied\'s engine builds from it is never stored here: every mass comes from the kernel\'s report and every drive from the row when it is built.');
    const design = state.project.phases.find((p) => p.kind === 'design'); const binding = state.bindings.design || null;
    state.E = await S.readEngines(state.project, state.bindings); await M.readPlant(state.project, state.E);
    const readOnly = !design || design.engine !== 'cad-studio';
    const parts = readOnly ? [] : M.designParts(state.project, binding, state.E.reads.models);
    const mech = state.E.reads.mechanism && state.E.reads.mechanism.ok ? state.E.reads.mechanism.body : null;
    const briefTask = state.E.reads.mechanism && state.E.reads.mechanism.body ? state.E.reads.mechanism.body.briefTask : null;
    state.mechParts = parts;
    M.renderMechanism({ project: state.project, parts, mechanism: mech ? mech.mechanism : null, rows: M.motorRows(state.E), briefTask, readOnly, plantJoints: readOnly ? (S.parsePlant(state.E.reads.mjcf) || { joints: [] }).joints : [] });
    markReady();
  }
  function presence(E) {
    const p = {};
    const mark = (engine, r) => { if (r) p[engine] = !(r.status === 404 || r.status === 0); };
    mark('embodied', E.reads.status); mark('circuit-lab', E.reads.circuits); mark('cad-studio', E.reads.models); mark('scan-to-print', E.reads.printers);
    return p;
  }
  async function readAndRender() {
    if (!state.caps) { try { state.caps = await api('/capabilities'); } catch (e) { toast(`Capabilities unavailable: ${e.message}`, 'error'); } }
    state.E = await S.readEngines(state.project, state.bindings); state.present = presence(state.E);
    state.rows = state.project.phases.map((entry) => {
      let view;
      try { view = S.phaseView(state.project, entry, state.E, state.bindings, state.closures, state.caps ? state.caps.briefs[entry.kind] : { produces: '' }); }
      catch (e) { view = { stage: 'render-failed', tone: 'bad', figure: ['—', ''], line: `this poster could not render: ${e.message}`, action: { label: 'Reload', reload: true } }; }
      return { entry, view, closure: S.closureOf(entry.kind, state.closures, view) };
    });
    V.renderProduct($('screen-product'), state.project, state.rows, onAction);
    markReady();
  }

  // ── New product: the proposal and Create ──
  async function plan() {
    const { brief } = V.collectBrief();
    if (!brief.what) { $('proposal').textContent = ''; state.proposal = null; return; }
    try {
      const keep = state.proposal ? new Set([...$('proposal').querySelectorAll('li[data-kind] input:checked')].map((cb) => cb.closest('li').dataset.kind)) : null;
      state.proposal = await api('/plan', { method: 'POST', json: { brief } });
      V.renderProposal($('proposal'), state.proposal, keep && keep.size ? null : null);
    } catch (e) { $('proposal').textContent = ''; $('proposal').append(Object.assign(document.createElement('li'), { className: 'unsolved', textContent: `The chain could not be proposed: ${e.message}` })); state.proposal = null; }
  }
  function wireNewForm() {
    const schedule = () => { clearTimeout(state.planTimer); state.planTimer = setTimeout(() => { if (!state.editing) plan(); }, 400); };
    for (const id of ['new-what', 'new-requirements']) $(id).addEventListener('input', schedule);
    $('new-form').addEventListener('submit', (ev) => { ev.preventDefault(); void create(); });
  }
  async function create() {
    const { name, brief } = V.collectBrief();
    if (!name || !brief.what) { toast('A product needs a name and one line saying what it is.', 'error'); return; }
    $('create').disabled = true;
    try {
      if (state.editing) {
        const out = await tracked(api(`/projects/${encodeURIComponent(state.editing.id)}`, { method: 'PATCH', json: { name, brief } }));
        toast('The brief is saved; the Brief phase re-opens at its new revision.', 'ok'); location.hash = `#/product/${encodeURIComponent(out.project.id)}`; return;
      }
      if (!state.proposal) await plan();
      const phases = state.proposal ? V.collectProposal($('proposal'), state.proposal) : undefined;
      const out = await tracked(api('/projects', { method: 'POST', json: { name, brief, ...(phases ? { phases } : {}) } }));
      toast(`${out.project.name} created with ${out.project.phases.length} phases.`, 'ok');
      location.hash = `#/product/${encodeURIComponent(out.project.id)}`;
    } catch (e) { toast(`${e.message}${e.body && e.body.field ? ` (${e.body.field})` : ''}`, 'error'); }
    finally { $('create').disabled = false; }
  }

  // ── Product actions: one button each ──
  async function onAction(entry, view, act) {
    try {
      if (act.edit) { location.hash = `#/product/${encodeURIComponent(state.project.id)}/brief`; return; }
      if (act.reload) { await readAndRender(); return; }
      if (act.close || act.brief) { await closePhase(entry, view); return; }
      if (act.status) { showStatus(); return; }
      if (act.baselines) { await runBaselines(); return; }
      if (act.certify) { await certify(act.certify); return; }
      if (act.circuit) { await openCircuit(act.circuit); return; }
      if (act.make) { await makePrintSet(entry, view); return; }
      if (act.send) { await sendToPrinter(entry, view, act); return; }
      if (act.mechanism) { location.hash = `#/product/${encodeURIComponent(state.project.id)}/mechanism`; return; }
      if (act.createParts) { await createParts(); return; }
      if (act.buildPlant || act.plantBaselines || act.plantTrain || act.plantCertify) { await plantAction(act); return; }
      if (act.build) { V.openBuildDialog(view.steps || [], state.closures, (step) => { void tickStep(step); }); return; }
      if (act.href) { window.open(act.href, '_blank', 'noopener'); }
    } catch (e) { toast(e.message, 'error'); }
  }
  async function bindRead(entry, view) {
    const current = state.bindings[entry.kind] ? state.bindings[entry.kind].artifact : null;
    if (!view.read && !current) return;
    const artifact = { ...(current || { engine: entry.engine, kind: entry.kind }), engine: current ? current.engine : entry.engine, read: view.read || (current && current.read) || undefined };
    if (!artifact.read) return;
    const out = await tracked(api(`/projects/${encodeURIComponent(state.project.id)}/bind`, { method: 'POST', json: { phase: entry.kind, artifact } }));
    state.bindings = out.bindings || state.bindings;
  }
  async function closePhase(entry, view) {
    const answer = await V.openCloseDialog(entry, view);
    if (!answer) return;
    if (view.read) await bindRead(entry, view);
    const out = await tracked(api(`/projects/${encodeURIComponent(state.project.id)}/close`, { method: 'POST', json: { phase: entry.kind, evidence: answer.evidence, revision: answer.revision, by: 'person' } }));
    state.closures = out.closures || state.closures; state.project = out.project || state.project;
    toast(entry.kind === 'brief' ? 'The brief is confirmed.' : `${V.TITLES[entry.kind]} closed at ${answer.revision}.`, 'ok');
    await readAndRender();
  }
  async function tickStep(step) {
    try {
      const out = await tracked(api(`/projects/${encodeURIComponent(state.project.id)}/close`, { method: 'POST', json: { phase: 'build', step: step.id, evidence: `ticked on the bench: ${step.text}`, revision: 'bench', by: 'person' } }));
      state.closures = out.closures || state.closures; toast(`Ticked: ${step.text}`, 'ok'); await readAndRender();
      const build = state.rows.find((r) => r.entry.kind === 'build');
      if (build && $('build-dialog').open) V.openBuildDialog(build.view.steps || [], state.closures, (next) => { void tickStep(next); });
    } catch (e) { toast(e.message, 'error'); }
  }
  async function makePrintSet(entry) {
    const set = F.partsOf(state.E, state.bindings.design || null);
    let closed = false;
    const progress = F.openMakeDialog(set, () => { closed = true; void readAndRender(); });
    if (!set) { F.finishMakeDialog(null, 'no design is bound to this product'); return; }
    try {
      const out = await tracked(F.makePrintSet({ project: state.project, E: state.E, binding: state.bindings.design || null, progress }));
      F.finishMakeDialog(out.listing, null);
      toast(`The print set is made: ${out.listing.exported} of ${out.listing.parts} parts, manifest ${String(out.listing.manifestSha256).slice(0, 12)}.`, out.listing.unprintable.length ? 'error' : 'ok');
    } catch (e) { F.finishMakeDialog(null, e.message); toast(`Make the print set: ${e.message}`, 'error'); }
    if (closed) await readAndRender();
  }
  async function sendToPrinter(entry, view, act) {
    const set = state.E.reads.printSet && state.E.reads.printSet.ok ? state.E.reads.printSet.body : null;
    if (!set || !set.finished) { toast('Make the print set first.', 'error'); return; }
    const file = await F.openSendDialog(set, act.printer);
    if (!file) return;
    try {
      const reply = await tracked(F.sendToPrinter({ project: state.project, file, printer: act.printer }));
      const o = reply.outcome || {};
      toast(o.started ? `${file} is printing on ${act.printer.label || act.printer.printerId}.` : o.uploaded ? `${file} is on ${act.printer.label || act.printer.printerId}: ${o.message || 'start it on the printer'}` : `${file} was not sent: ${o.message || reply.message || 'the print service said no'}`, o.uploaded ? 'ok' : 'error');
    } catch (e) { toast(`Send to printer: ${e.message}`, 'error'); }
    await readAndRender();
  }
  // ── The plant from the design (ADR-203 D9) ──
  async function createParts() {
    const binding = state.bindings.design; if (!binding) { toast('No design is bound.', 'error'); return; }
    const parts = M.designParts(state.project, binding, state.E.reads.models);
    const progress = M.openPartsDialog(parts);
    try {
      await tracked(M.createParts({ project: state.project, binding, modelsRead: state.E.reads.models, api, progress }));
      $('make-result').textContent = `${parts.filter((p) => p.program).length} parts are in CAD Studio and bound to the Design phase.`;
      toast('The parts are built in CAD Studio and bound.', 'ok');
    } catch (e) { $('make-result').textContent = `The parts could not be created: ${e.message}`; toast(`Create the parts: ${e.message}`, 'error'); }
    $('make-close').disabled = false;
    await loadProduct(state.project.id); await readAndRender();
  }
  function plantInputs() {
    const parts = M.designParts(state.project, state.bindings.design || null, state.E.reads.models);
    return { parts, rows: M.motorRows(state.E), mech: state.E.reads.mechanism && state.E.reads.mechanism.ok ? state.E.reads.mechanism.body.mechanism : null };
  }
  async function plantAction(act) {
    const { parts, rows, mech } = plantInputs();
    if (!mech) { toast('Define the mechanism first.', 'error'); return; }
    try {
      if (act.buildPlant) { const out = await M.buildPlant(state.project, parts, rows); const p = out.plant || {};
        const sim = state.bindings.simulate && state.bindings.simulate.artifact;
        const revision = state.E.reads.mechanism && state.E.reads.mechanism.ok ? state.E.reads.mechanism.body.revision : undefined;
        const artifact = { ...(sim && sim.kind === 'plant' ? sim : { engine: 'embodied', kind: 'plant' }), mechanismRevision: revision };
        const bound = await tracked(api(`/projects/${encodeURIComponent(state.project.id)}/bind`, { method: 'POST', json: { phase: 'simulate', artifact } })); state.bindings = bound.bindings || state.bindings;
        toast(`The plant is built in the engine: ${p.bodies} bodies, ${(p.actuators || []).length} actuator${(p.actuators || []).length === 1 ? '' : 's'}, ${typeof p.massKg === 'number' ? p.massKg.toFixed(3) : '—'} kg at dt ${p.timestepS} s.`, 'ok'); }
      else if (act.plantBaselines) { const out = await M.train(state.project, parts, rows, 0, mech); const b = out.report && out.report.baseline ? out.report.baseline : {}; toast(`The PD baseline ran in the engine: reached ${b.reached} of ${b.episodes} episodes within the brief's time, in ${typeof b.reachedS === 'number' ? b.reachedS.toFixed(2) : '—'} s; RMS motor torque ${typeof b.rmsTorqueMaxNm === 'number' ? b.rmsTorqueMaxNm.toFixed(3) : '—'} N·m.`, 'ok'); }
      else if (act.plantTrain) { const jobs = state.E.reads.plantJobs && state.E.reads.plantJobs.ok ? state.E.reads.plantJobs.body : {}; const steps = jobs.defaults && jobs.defaults.timesteps ? jobs.defaults.timesteps : 1; const out = await M.train(state.project, parts, rows, steps, mech); toast(`Training started in the engine: ${out.job ? out.job.timesteps : steps} PPO steps (${out.job ? out.job.file : ''}). Reload to follow it.`, 'ok'); }
      else if (act.plantCertify) { const out = await M.certify(state.project, parts, rows, act.plantCertify); const c = out.certification || {}; toast(c.ok ? `Certified: ${c.checked} ${c.unit || 'control steps'} passed the gate; ${c.policyBeatsBaseline ? 'the policy beats the baseline' : 'the baseline still wins'}.` : `Refused at ${c.refusedCount} of ${c.checked} ${c.unit || 'control steps'}${c.refused && c.refused[0] ? ` — first: ${c.refused[0].reason}` : ''}.`, c.ok ? 'ok' : 'error'); }
    } catch (e) { toast(e.status === 404 && e.body && e.body.error === 'fixture_route_unavailable' ? 'No engine on this swarm answered the plant route.' : `${e.message}${e.body && e.body.field ? ` (${e.body.field})` : ''}`, 'error'); }
    await readAndRender();
  }
  function showStatus() {
    const r = state.E && state.E.reads.status;
    $('status-json').textContent = JSON.stringify(r ? (r.ok ? r.body : { error: r.error, status: r.status, route: r.url }) : { error: 'not read' }, null, 2);
    $('status-dialog').showModal();
  }
  async function enginePost(path, body) {
    const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const text = await res.text(); let out = null; try { out = text ? JSON.parse(text) : null; } catch (_) { out = { raw: text }; }
    if (!res.ok) { const err = new Error((out && (out.message || out.error)) || `HTTP ${res.status}`); err.status = res.status; err.body = out; throw err; }
    return out;
  }
  async function runBaselines() {
    const fit = state.E.fit; if (!fit) { toast('No fit is bound: nothing to run the baselines on.', 'error'); return; }
    const sim = state.bindings.simulate && state.bindings.simulate.artifact;
    try {
      const out = await enginePost(`${S.API.embodied}/physics/${encodeURIComponent(fit.machine)}/check`, { fit: fit.fit, seeds: 1, jump: (sim && sim.jump) || fit.jump || undefined });
      const rep = out && out.report ? out.report : {};
      const verdict = rep.verdict && typeof rep.verdict === 'object' ? Object.entries(rep.verdict).map(([k, v]) => `${k}: ${v === true ? 'yes' : v === false ? 'NO' : v}`).join(', ') : '';
      toast(`The baselines ran in the engine container${typeof rep.wallSeconds === 'number' ? ` in ${rep.wallSeconds} s` : ''}.${verdict ? ' ' + verdict + '.' : ''}`, 'ok');
    } catch (e) { toast(e.status === 404 ? 'No engine on this swarm answered the baselines route.' : `Baselines: ${e.message}${e.body && e.body.reason ? ' — ' + e.body.reason : ''}`, 'error'); }
    await readAndRender();
  }
  async function certify(file) {
    const fit = state.E.fit; const route = fit ? `${S.API.embodied}/physics/${encodeURIComponent(fit.machine)}/certify` : `${S.API.embodied}/physics/certify`;
    try {
      const r = await enginePost(route, { file }); const c = r.certification || {}; const unit = c.unit || 'points';
      toast(c.ok ? `Certified: ${c.checked} ${unit} passed the gate.` : `Refused at ${c.refusedCount} of ${c.checked} ${unit}${c.refused && c.refused[0] ? ` — first: ${c.refused[0].reason}` : ''}.`, c.ok ? 'ok' : 'error');
    } catch (e) { toast(e.status === 404 && !(e.body && e.body.error && e.body.error !== 'fixture_route_unavailable') ? 'No engine on this swarm answered the gate route.' : `Certify: ${e.message}${e.body && e.body.message ? ' — ' + e.body.message : ''}`, 'error'); }
    await readAndRender();
  }
  async function openCircuit(circuit) {
    const base = `${S.API['circuit-lab']}/designs`;
    // The lab opens beside this page, on the person's copy (the cockpit does not hand a record id to an application's frame).
    const tab = window.open('', '_blank');
    try {
      const out = await enginePost(base, circuit.example ? { example: circuit.example, title: `${state.project.name} power`, run: true } : { title: `${state.project.name} power`, parts: [], wires: [], run: false });
      const id = out.design && out.design.design_id; if (!id) throw new Error('Circuit Lab answered without a design id');
      await tracked(api(`/projects/${encodeURIComponent(state.project.id)}/bind`, { method: 'POST', json: { phase: 'electrical', artifact: { engine: 'circuit-lab', kind: 'circuit-design', designId: id, example: circuit.example || undefined } } }));
      toast(`Opened in Circuit Lab as "${out.design.title}"${out.build && out.build.ok ? ' and solved' : ''}.`, 'ok');
      if (tab) { tab.opener = null; tab.location.assign(`/api/circuit-lab/app?design=${encodeURIComponent(id)}`); }
      await loadProduct(state.project.id); await readAndRender();
    } catch (e) { if (tab) tab.close(); toast(e.status === 404 || e.status === 401 || e.status === 403 ? 'Circuit Lab is not installed on this swarm, or you are not granted access to it.' : `Circuit Lab: ${e.message}`, 'error'); }
  }

  // ── The assistant rail: context and custom ops ──
  function contextDigest() {
    if (state.screen === 'product' && state.project) return [`${state.project.name}: ${state.project.brief.what}`, ...state.rows.map((r) => `${r.entry.kind} [${r.entry.engine}] ${r.view.stage}: ${r.view.line}${r.closure ? ` (closed${r.closure.stale ? ', stale' : ''})` : ''}`)].join('\n').slice(0, 3900);
    if (state.screen === 'products') return state.projects.length ? `Products: ${state.projects.map((p) => `${p.name} (${p.closedPhases}/${p.phases.length} closed)`).join('; ')}` : 'No products yet.';
    if (state.screen === 'new') return 'The New product walkthrough is open.';
    if (state.screen === 'mechanism' && state.project) return `Mechanism of ${state.project.name}: ${state.mechanism ? `${state.mechanism.joints.length} joints, revision ${state.mechanism.revision}` : 'not defined yet'}`;
    return state.project ? `Settings of ${state.project.name}` : 'Design Studio';
  }
  function publishContext() {
    if (!window.__bridge) return;
    try {
      window.__bridge.emitContext({ surface: state.screen || 'products', title: state.project ? state.project.name : 'Design Studio', ...(state.project ? { recordId: state.project.id } : {}), digest: contextDigest(),
        fields: { screen: state.screen, phases: state.project ? state.project.phases.length : 0, closed: state.rows.filter((r) => r.closure && !r.closure.stale).length }, can: ['custom', 'notify'],
        customOps: [{ name: 'design_action', description: 'Drive the OPEN Design Studio page. data = {"op":"open_product","id"} | {"op":"reload"} | {"op":"new_product"} | {"op":"products"}. Bindings and closures go through the package tools, never through this op.' }] });
    } catch (_) { /* the studio must never break because the assistant is unavailable */ }
  }
  document.addEventListener('surface-bridge:custom', (evt) => {
    const d = evt.detail || {};
    if (d.name === 'request_context') { publishContext(); return; }
    if (d.name !== 'design_action' || !d.data) return;
    if (d.data.op === 'open_product' && d.data.id) location.hash = `#/product/${encodeURIComponent(String(d.data.id))}`;
    else if (d.data.op === 'reload') void route();
    else if (d.data.op === 'new_product') location.hash = '#/new';
    else if (d.data.op === 'products') location.hash = '#/';
  });
  window.addEventListener('bridge-ready', publishContext);

  // A running training job moves on the poster by itself.
  setInterval(() => {
    if (state.screen === 'product' && !document.hidden && state.rows.some((r) => r.view.stage === 'training')) void readAndRender();
  }, 15000);
  // A product the design partner made appears without a reload.
  const productsMark = (list) => list.map((p) => `${p.id}:${p.updated_at}`).join('|');
  setInterval(async () => {
    if (state.screen !== 'products' || document.hidden) return;
    try { const out = await api('/projects'); if (productsMark(out.projects) !== productsMark(state.projects)) { state.projects = out.projects; V.renderProducts($('screen-products'), state.projects); publishContext(); } } catch (_) { /* the next tick or Reload says what is wrong */ }
  }, 5000);

  // ── The design partner's engine orders: run from this page with the person's session ──
  async function openForOrder(id) {
    if (state.screen === 'product' && state.project && state.project.id === id) return;
    await new Promise((done) => { const m = $('studio'); const before = m.dataset.reads; location.hash = `#/product/${encodeURIComponent(id)}`; const t = setInterval(() => { if (m.dataset.reads !== before && state.project && state.project.id === id) { clearInterval(t); done(); } }, 100); setTimeout(() => { clearInterval(t); done(); }, 30000); });
  }
  async function pressForOrder(row, act) {
    lastToast = null;
    await onAction(row.entry, row.view, act);
    const said = lastToast;
    const make = $('make-dialog'); if (make && make.open) make.close();
    await settleWrites(); await loadProduct(state.project.id); await readAndRender();
    return said;
  }
  window.DesignStudioOrders.start({
    project: () => state.project, bindings: () => state.bindings, rows: () => state.rows, openProduct: openForOrder, press: pressForOrder, say: toast,
    refresh: async () => { if (state.project) { await loadProduct(state.project.id); if (state.screen === 'product') await readAndRender(); } publishContext(); },
  });

  // ── The shared document handoff: the open product is what the design partner edits ──
  function snapshot(p) { return { app: 'design-studio', screen: state.screen, surface: 'design-studio', recordId: p.id, title: String(p.name).slice(0, 200), fields: { updatedAt: p.updated_at, phases: p.phases.map((x) => x.kind).join(','), closed: state.rows.filter((r) => r.closure && !r.closure.stale).map((r) => r.entry.kind).join(','), readOnly: false, draft: false } }; }
  async function prepareDocumentHandoff() { await settleWrites(); return state.project ? snapshot(state.project) : null; }
  async function refreshDocumentHandoff(expected) {
    await settleWrites();
    const p = state.project; if (!p || (expected && expected.recordId && expected.recordId !== p.id)) return;
    const out = await api(`/projects/${encodeURIComponent(p.id)}`);
    if (!state.project || out.project.id !== state.project.id) return;
    state.project = out.project; state.bindings = out.bindings || {}; state.closures = out.closures || [];
    if (state.screen === 'product') await readAndRender(); else if (state.screen === 'settings') await showSettings(p.id);
    toast('The design partner\'s change is shown.', 'ok');
  }
  function registerDocumentHandoff() {
    const reported = (fn) => async (...args) => { try { return await fn(...args); } catch (e) { toast(e.message, 'error'); throw e; } };
    import('/shared/ui/js/document-handoff.js')
      .then(({ registerDocumentSession }) => registerDocumentSession({ app: 'design-studio', prepare: reported(prepareDocumentHandoff), refresh: reported(refreshDocumentHandoff) }))
      .catch((e) => toast(`The design partner cannot synchronize this product: ${e.message}`, 'error'));
  }

  // ── Routing ──
  async function route() {
    $('studio').dataset.ready = '0';
    const h = location.hash.replace(/^#/, '') || '/';
    const m = /^\/product\/([^/]+)(\/settings|\/brief|\/mechanism)?$/.exec(h);
    if (h === '/new') await showNew(null);
    else if (m && m[2] === '/brief') { try { await loadProduct(decodeURIComponent(m[1])); } catch (e) { toast(e.message, 'error'); location.hash = '#/'; return; } await showNew(state.project); }
    else if (m && m[2] === '/mechanism') await showMechanism(decodeURIComponent(m[1]));
    else if (m && m[2]) await showSettings(decodeURIComponent(m[1]));
    else if (m) await showProduct(decodeURIComponent(m[1]));
    else await showProducts();
  }
  window.addEventListener('hashchange', () => { void route(); });
  $('reload').addEventListener('click', () => { void route(); });
  $('settings-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const { phases, binds } = V.collectSettings(state.project);
      await tracked(api(`/projects/${encodeURIComponent(state.project.id)}/phases`, { method: 'PUT', json: { phases } }));
      for (const b of binds) { const cur = state.bindings[b.phase] && state.bindings[b.phase].artifact; if (!cur || JSON.stringify({ ...cur, read: undefined }) !== JSON.stringify(b.artifact)) await tracked(api(`/projects/${encodeURIComponent(state.project.id)}/bind`, { method: 'POST', json: b })); }
      toast('Settings saved.', 'ok'); location.hash = `#/product/${encodeURIComponent(state.project.id)}`;
    } catch (e) { toast(`${e.message}${e.body && e.body.field ? ` (${e.body.field})` : ''}`, 'error'); }
  });
  $('mechanism-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const mechanism = M.collectMechanism(state.mechParts || []);
      const out = await tracked(api(`/projects/${encodeURIComponent(state.project.id)}/mechanism`, { method: 'PUT', json: { mechanism } }));
      toast(`The mechanism is saved (revision ${out.revision}): ${out.mechanism.joints.length} joint${out.mechanism.joints.length === 1 ? '' : 's'}, ${out.mechanism.joints.filter((j) => j.drivenBy).length} driven.`, 'ok');
      location.hash = `#/product/${encodeURIComponent(state.project.id)}`;
    } catch (e) { toast(`${e.message}${e.body && e.body.field ? ` (${e.body.field})` : ''}`, 'error'); }
  });
  $('delete-product').addEventListener('click', async () => {
    if (!state.project || !window.confirm(`Delete ${state.project.name}, its bindings and its closures? The engines' artifacts are untouched.`)) return;
    try { await tracked(api(`/projects/${encodeURIComponent(state.project.id)}`, { method: 'DELETE' })); toast('Deleted.', 'ok'); location.hash = '#/'; } catch (e) { toast(e.message, 'error'); }
  });
  registerDocumentHandoff();
  const q = new URLSearchParams(location.search);
  if (q.get('project') && !location.hash) location.hash = `#/product/${encodeURIComponent(q.get('project'))}`;
  void route();
}
designStudio();
