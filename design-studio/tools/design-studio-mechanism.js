/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D9, lane @ds-plant: the Mechanism screen and the plant a
 *                     |                             | CAD-bound product gets from its own design. The screen lists
 *                     |                             | the parts from the bound CAD Studio models (mass and extents
 *                     |                             | from the kernel's report), the part that is ground, a row per
 *                     |                             | joint (parent, child, hinge / slide / fixed, axis, range, the
 *                     |                             | child's origin in the parent, the motor row from embodied's
 *                     |                             | catalog or Circuit Lab's drivers, the stated gear ratio), the
 *                     |                             | payload and the task read from the brief's line; Save writes
 *                     |                             | it through PUT /projects/{id}/mechanism. The spider's design is
 *                     |                             | read-only here: its joints are the plant's own. Create the
 *                     |                             | parts in CAD Studio builds an example's part programs once with
 *                     |                             | the person's session (the fabricate module's way). The plant
 *                     |                             | spec is composed by this package's route from the mechanism
 *                     |                             | and the reads; Build the plant, Run the baselines, Train the
 *                     |                             | policy and Certify go to embodied's plant routes with the
 *                     |                             | person's session, and the Simulate poster reads concept ->
 *                     |                             | built -> baseline -> trained -> certified from the engine's
 *                     |                             | replies. No number of any machine lives here.
 */
window.DesignStudioMechanism = (function mechanism() {
  'use strict';
  const S = window.DesignStudioStages; const F = window.DesignStudioFabricate;
  const SELF = '/api/design-studio'; const EMB = '/api/embodied'; const CAD = '/api/cad-studio'; const LAB = '/api/circuit-lab';
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs, text) => { const n = document.createElement(tag); if (attrs) for (const [k, v] of Object.entries(attrs)) { if (v === undefined || v === null || v === false) continue; if (k === 'class') n.className = v; else if (k === 'dataset') Object.assign(n.dataset, v); else n.setAttribute(k, v === true ? '' : String(v)); } if (text !== undefined) n.textContent = text; return n; };
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const now = () => new Date().toISOString();
  const JOINT_TYPES = ['hinge', 'slide', 'fixed'];

  async function http(url, opts) {
    const o = opts || {};
    const res = await fetch(url, { method: o.method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: o.json ? { 'Content-Type': 'application/json' } : {}, body: o.json ? JSON.stringify(o.json) : undefined });
    const text = await res.text(); let out = null; try { out = text ? JSON.parse(text) : null; } catch (_) { out = { raw: text }; }
    if (!res.ok) { const err = new Error((out && (out.message || out.reason || out.error)) || `HTTP ${res.status}`); err.status = res.status; err.body = out; throw err; }
    return out;
  }

  // ── The design's parts: the binding's programs matched to the person's CAD Studio models, or its bound models ──
  /** The kernel's extents as [x, y, z] mm whichever way the report writes them. */
  function extents(report) {
    const e = report && report.extentsMm;
    if (Array.isArray(e) && e.length === 3) return e.map(Number);
    if (e && Array.isArray(e.size)) return e.size.map(Number);
    if (e && Array.isArray(e.min) && Array.isArray(e.max)) return e.max.map((v, i) => Number(v) - Number(e.min[i]));
    return null;
  }
  /**
   * @description The parts of a CAD-bound design: each program of the binding with the person's model for it (found by the binding's models map or the source tag), or each bound model.
   * @param {object} project The project. @param {object} binding The design binding. @param {object} modelsRead The CAD Studio models read. @returns {object[]} [{id, name, program, modelId, model, massG, extentsMm, built}].
   */
  function designParts(project, binding, modelsRead) {
    const models = modelsRead && modelsRead.ok && Array.isArray(modelsRead.body.models) ? modelsRead.body.models : [];
    const a = (binding && binding.artifact) || {};
    const withModel = (id, name, program, model) => ({ id, name, program: program || null, modelId: model ? model.model_id : null, model: model || null, massG: model && model.report ? model.report.massG : null, extentsMm: model ? extents(model.report) : null, built: !!(model && model.state === 'built'), revision: model ? model.revision : null });
    if (Array.isArray(a.parts) && a.parts.length) {
      const map = new Map((Array.isArray(a.models) ? a.models : []).map((m) => [m.partId, m.modelId]));
      return a.parts.map((p) => {
        const sha = p.program ? S.revisionOf(p.program) : null;
        const model = models.find((m) => m.model_id === map.get(p.id)) || models.find((m) => m.source && m.source.designStudio && m.source.designStudio.project === project.id && m.source.designStudio.part === p.id && (!sha || m.source.designStudio.programSha === sha)) || null;
        return withModel(p.id, p.name || p.id, p.program, model);
      });
    }
    const ids = Array.isArray(a.modelIds) ? a.modelIds : [];
    const named = new Map((Array.isArray(a.models) ? a.models : []).map((m) => [m.modelId, m.partId]));
    return ids.map((id) => { const m = models.find((x) => x.model_id === id); return withModel(named.get(id) || id, m ? m.title : id, null, m); });
  }

  /**
   * @description Create every program part of the design in CAD Studio once (tagged with the product and the program hash) and bind the models to the Design phase.
   * @param {object} o {project, binding, modelsRead, api, progress(part, line)}. @returns {Promise<object>} The new binding's artifact.
   */
  async function createParts(o) {
    const parts = designParts(o.project, o.binding, o.modelsRead);
    const models = o.modelsRead && o.modelsRead.ok && Array.isArray(o.modelsRead.body.models) ? [...o.modelsRead.body.models] : [];
    if (!o.modelsRead || !o.modelsRead.ok) throw new Error(`CAD Studio did not answer (${S.absence(o.modelsRead || { status: 0, url: `${CAD}/models`, error: 'not read' }, 'cad-studio').line})`);
    const bound = [];
    for (const part of parts) {
      if (!part.program) { o.progress(part, 'no program: nothing to build'); continue; }
      o.progress(part, part.model && part.built ? 'already built' : 'building through CAD Studio');
      const model = part.model && part.built ? part.model : await F.ensureCadModel(o.project, { row: { id: part.id, name: part.name }, program: part.program }, models);
      bound.push({ partId: part.id, modelId: model.model_id, programSha: S.revisionOf(part.program), revision: model.revision });
      o.progress(part, `built · ${model.report && isNum(model.report.massG) ? `${model.report.massG} g by the kernel` : 'no report'}${extents(model.report) ? ` · ${extents(model.report).join(' × ')} mm` : ''}`);
    }
    const artifact = { ...o.binding.artifact, kind: 'cad-models', modelIds: bound.map((b) => b.modelId), models: bound, read: { route: `${CAD}/models`, readAt: now(), models: bound } };
    await o.api(`/projects/${encodeURIComponent(o.project.id)}/bind`, { method: 'POST', json: { phase: 'design', artifact } });
    return artifact;
  }

  // ── The motor rows a joint may be driven by, as read ──
  const DEG = Math.PI / 180;
  /**
   * @description The rows read from embodied's catalog and Circuit Lab's drivers, each with the numbers a drive is built from and whether it can drive a joint.
   * @param {object} E The reads (catalog, drivers). @returns {object[]} [{rowId, source, name, stallNm, noLoadRadS, continuousNm, usable, why, route, readAt}].
   */
  function motorRows(E) {
    const out = [];
    const c = E.reads.catalog;
    if (c && c.ok) {
      for (const r of c.body.servos || []) out.push({ rowId: r.id, source: 'embodied', name: r.name, stallNm: r.stallNm, noLoadRadS: r.noLoadRadS, continuousNm: r.continuousNm, usable: isNum(r.stallNm) && isNum(r.noLoadRadS) && isNum(r.continuousNm), why: '', route: c.url, readAt: now() });
      for (const r of c.body.motors || []) out.push({ rowId: r.id, source: 'embodied', name: r.name, stallNm: null, noLoadRadS: null, continuousNm: null, usable: false, why: r.note || 'no stall torque published', route: c.url, readAt: now() });
    }
    const d = E.reads.drivers;
    if (d && d.ok) {
      for (const r of d.body.drivers || []) {
        const np = r.nameplate || {};
        const stallNm = isNum(np.stallTorqueMnm) ? np.stallTorqueMnm / 1000 : isNum(np.holdingTorqueMnm) ? np.holdingTorqueMnm / 1000 : null;
        const noLoadRadS = isNum(np.noLoadDegPerS) ? np.noLoadDegPerS * DEG : isNum(np.noLoadRpm) ? (np.noLoadRpm * 2 * Math.PI) / 60 : null;
        const twin = out.find((x) => x.source === 'embodied' && r.sharedPart && r.sharedPart.owner === 'embodied' && r.sharedPart.id === x.rowId);
        if (twin) continue;
        out.push({ rowId: r.id, source: 'circuit-lab', name: r.name, stallNm, noLoadRadS, continuousNm: null, usable: false, why: stallNm === null || noLoadRadS === null ? 'no stall torque and no-load speed published' : 'no continuous rating is stated by this row, so the gate cannot hold it to one', route: d.url, readAt: now() });
      }
    }
    return out;
  }
  /** The reads this package's plant-spec route composes from: the parts' kernel reports and the motor rows. */
  function specReads(parts, rows) {
    return {
      parts: parts.filter((p) => isNum(p.massG) && p.extentsMm).map((p) => ({ id: p.id, name: p.name, modelId: p.modelId, massG: p.massG, extentsMm: p.extentsMm, route: `${CAD}/models`, readAt: now(), revision: p.revision })),
      motors: rows.filter((r) => r.usable).map((r) => ({ rowId: r.rowId, source: r.source, name: r.name, stallNm: r.stallNm, noLoadRadS: r.noLoadRadS, continuousNm: r.continuousNm, route: r.route, readAt: r.readAt })),
    };
  }

  // ── The reads the mechanism screen and the plant need ──
  /**
   * @description Read what the Mechanism screen and the plant actions need: this package's mechanism, embodied's catalog and plant state, Circuit Lab's drivers.
   * @param {object} project The project. @param {object} E The engine reads to extend. @returns {Promise<object>} E with mechanism, catalog, drivers, plantState, plantJobs.
   */
  async function readPlant(project, E) {
    const jobs = [
      S.read(`${SELF}/projects/${encodeURIComponent(project.id)}/mechanism`).then((r) => { E.reads.mechanism = r; }),
      S.read(`${EMB}/build/catalog`).then((r) => { E.reads.catalog = r; }),
      S.read(`${LAB}/catalog/drivers`).then((r) => { E.reads.drivers = r; }),
    ];
    if (!E.reads.models) jobs.push(S.read(`${CAD}/models`).then((r) => { E.reads.models = r; }));
    // The engine bridge answers one request at a time: the three reads that reach it go one after another.
    jobs.push((async () => {
      if (!E.reads.reports) E.reads.reports = await S.read(`${EMB}/physics/reports`);
      E.reads.plantState = await S.read(`${EMB}/physics/plant/state?project=${encodeURIComponent(project.id)}`);
      E.reads.plantJobs = await S.read(`${EMB}/physics/plant/train`);
    })());
    await Promise.all(jobs);
    return E;
  }

  // ── The plant actions, with the person's session ──
  /** The spec composed by this package's route from the mechanism and the reads. */
  async function plantSpec(project, parts, rows) {
    const out = await http(`${SELF}/projects/${encodeURIComponent(project.id)}/plant-spec`, { method: 'POST', json: specReads(parts, rows) });
    return out.spec;
  }
  async function buildPlant(project, parts, rows) {
    const spec = await plantSpec(project, parts, rows);
    return http(`${EMB}/physics/plant/load`, { method: 'POST', json: { project: project.id, spec } });
  }
  async function train(project, parts, rows, timesteps, mech) {
    const spec = await plantSpec(project, parts, rows);
    const t = mech.task;
    if (!t) throw new Error('the mechanism has no task: the brief needs a line like "lifts 2 kg to 300 mm in 5 s"');
    const task = { deltaM: t.deltaMm.map((x) => x / 1000), timeS: t.timeS, loadKg: t.loadKg === null ? (mech.payload ? mech.payload.massKg : null) : t.loadKg, line: t.line };
    return http(`${EMB}/physics/plant/train`, { method: 'POST', json: { project: project.id, spec, task, timesteps } });
  }
  async function certify(project, parts, rows, file) {
    const spec = await plantSpec(project, parts, rows);
    return http(`${EMB}/physics/plant/certify`, { method: 'POST', json: { project: project.id, file, spec } });
  }

  // ── The Simulate poster for a product whose plant is generated from its design ──
  const nm = (v) => (isNum(v) ? `${v.toFixed(3)} N·m` : '— N·m');
  const secs = (v) => (isNum(v) ? `${v.toFixed(2)} s` : 'never');
  function plantRead(st) {
    const info = st.body.state && st.body.state.info ? st.body.state.info : {};
    return { kind: 'plant', route: st.body.route, readAt: now(), physicsDt: info.timestepS, controlDtS: info.controlDtS, specSha256: info.specSha256, massKg: info.massKg, actuators: (info.actuators || []).map((a) => ({ joint: a.joint, type: a.type, range: a.range, stallNm: a.stallNm, noLoadRadS: a.noLoadRadS, gearRatio: a.gearRatio, continuousNm: a.continuousNm, forceLimit: a.forceLimit, unit: a.unit, row: a.row })), joints: info.joints || [], senses: info.senses || [], payload: info.payload || null };
  }
  function reportLine(file, r, task, limit) {
    const b = r.baseline || {};
    return `${file}: the PD baseline reached ${b.reached} of ${b.episodes} within ${task.timeS} s, in ${secs(b.reachedS)} · RMS motor torque ${nm(b.rmsTorqueMaxNm)} of ${nm(limit)} continuous, peak ${nm(b.peakTorqueNm)}`;
  }
  function certifiedLine(cert, r, limit) {
    const p = cert.policy || r.policy || {}; const b = cert.baseline || r.baseline || {};
    const verdict = cert.policyBeatsBaseline === true ? 'the policy beats the baseline' : cert.policyBeatsBaseline === false ? 'the baseline still wins' : 'no verdict';
    return `${verdict} (the gate re-measured) · policy reached in ${secs(p.reachedS)} against the baseline's ${secs(b.reachedS)}, RMS motor torque ${nm(p.rmsTorqueMaxNm)} of ${nm(limit)} · certified (${cert.checked} ${cert.unit || 'control steps'}, policy sha ${String(cert.policySha256 || '').slice(0, 12)})`;
  }
  /**
   * @description The Simulate view for a generated plant: concept (no mechanism, or not built), built, baseline, training, trained, certified, every number from the engine's replies.
   * @param {object} project The project. @param {object} E The reads. @param {object} binding The simulate binding. @param {object} entry The phase entry. @returns {object} The view.
   */
  function viewSimulatePlant(project, E, binding, entry) {
    const view = plantView(project, E, binding, entry);
    // A loaded plant is engine memory; its reports and certificates are on disk. After an engine restart the poster keeps
    // what was measured and offers to load the plant again, and a phase closes only with the plant read.
    const st = E.reads.plantState;
    if (st && st.status === 404 && view.stage !== 'concept' && E.reads.reports && E.reads.reports.ok) { view.action = { label: 'Build the plant', buildPlant: true }; view.met = false; }
    return view;
  }
  function plantView(project, E, binding, entry) {
    const a = (binding && binding.artifact) || {}; const mech = E.reads.mechanism; const st = E.reads.plantState; const rep = E.reads.reports;
    const prefix = `plant-${project.id}-`;
    const brain = 'the reach policy (PPO residuals on the PD baseline)';
    if (!mech || !mech.ok) return { stage: 'concept', tone: 'warn', figure: ['—', 'no mechanism'], line: `concept · ${mech && mech.status === 404 ? 'no mechanism is defined for this product: Define the mechanism on the Design poster, or ask the design partner' : `the mechanism could not be read: ${mech ? mech.error : 'not read'}`} · ${brain}`, action: { label: 'Build the plant', buildPlant: true, disabled: true } };
    if (!rep || !rep.ok) { const ab = S.absence(rep || { status: 0, url: `${EMB}/physics/reports`, error: 'not read' }, 'embodied'); return { stage: ab.kind, tone: ab.kind === 'failed' ? 'bad' : 'warn', figure: ['—', 'reports'], line: ab.line, action: { label: 'Build the plant', buildPlant: true, disabled: true } }; }
    const m = mech.body.mechanism; const driven = m.joints.filter((j) => j.drivenBy).length;
    const mechLine = `mechanism r${mech.body.revision}: ${m.parts.length} parts, ${m.joints.length} joint${m.joints.length === 1 ? '' : 's'}, ${driven} driven${m.payload ? `, payload ${m.payload.massKg} kg on the ${m.payload.attachedTo}` : ''}${m.task ? ` · task: ${m.task.line || `${m.task.deltaMm.join('/')} mm in ${m.task.timeS} s`}` : ' · no task line in the brief'}`;
    const built = !!(st && st.ok);
    const plant = built ? plantRead(st) : null;
    const plantNote = built ? `plant built in the engine: ${plant.actuators.length} actuator${plant.actuators.length === 1 ? '' : 's'} at dt ${plant.physicsDt} s, ${isNum(plant.massKg) ? `${plant.massKg.toFixed(3)} kg` : '— kg'}` : st && st.status !== 404 && st.status !== 0 ? `plant: ${S.absence(st, 'embodied').line}` : 'plant not built in the engine';
    const currentSpec = built && plant.specSha256 ? plant.specSha256 : null;
    const all = (rep.body.reports || []).filter((x) => String(x.file).startsWith(prefix) && !(currentSpec && x.report && x.report.specSha256 && x.report.specSha256 !== currentSpec));
    const build = { label: 'Build the plant', buildPlant: true, disabled: !m.task || !driven };
    // The mechanism moved on since this plant was built: nothing the plant measured belongs to the mechanism now saved.
    const drives = m.joints.filter((j) => j.drivenBy);
    const staleBy = built && ((isNum(a.mechanismRevision) && a.mechanismRevision !== mech.body.revision) || drives.some((j) => { const act = plant.actuators.find((x) => x.joint === j.id); return !act || (isNum(act.gearRatio) && act.gearRatio !== j.gearRatio); }));
    if (staleBy) return { stage: 'stale', tone: 'warn', figure: [`r${mech.body.revision}`, 'the mechanism changed'], line: `stale · the plant in the engine is from an older mechanism · ${mechLine} · Build the plant again; nothing measured on the old plant counts`, action: build };
    if (!built && !all.length) return { stage: 'concept', tone: 'warn', figure: [String(m.joints.length), 'joints in the mechanism'], line: `concept · ${mechLine} · ${plantNote}`, action: build };
    const ratings = (plant ? plant.actuators : (all.map((x) => x.report && x.report.actuators).find(Array.isArray) || [])).map((x) => x.continuousNm).filter(isNum);
    const limit = ratings.length ? Math.min(...ratings) : null;
    const training = all.filter((x) => !/\.certificate\.json$/.test(String(x.file)));
    const latest = training.length ? training.reduce((best, x) => (((x.report && (x.report.finishedAt || x.report.startedAt)) || '') > ((best.report && (best.report.finishedAt || best.report.startedAt)) || '') ? x : best), training[0]) : null;
    const jobs = E.reads.plantJobs && E.reads.plantJobs.ok ? E.reads.plantJobs.body.jobs || [] : [];
    const running = jobs.find((j) => j.state === 'running' && String(j.file).startsWith(prefix));
    const read = { route: rep.url, readAt: now(), plant, mechanismRevision: mech.body.revision };
    if (running) return { stage: 'training', tone: 'warn', figure: [`${running.stepsDone}/${running.timesteps}`, 'PPO steps done'], line: `training · ${running.file} seed ${running.seed}: ${running.stepsDone} of ${running.timesteps} steps in ${running.elapsedS} s (Reload to follow) · ${plantNote}`, read, action: { label: 'Training…', disabled: true } };
    if (!latest) return { stage: 'built', tone: 'warn', figure: [String(plant.actuators.length), `actuator${plant.actuators.length === 1 ? '' : 's'} from the rows`], line: `built · ${plantNote} · no ${prefix}* report yet in ${rep.body.dir || 'the reports directory'} · ${brain}`, read, action: { label: 'Run the baselines', plantBaselines: true } };
    const r = latest.report || {}; const task = r.taskSpec || { timeS: m.task ? m.task.timeS : null };
    read.report = { file: latest.file, task: r.task, seed: r.seed, timesteps: r.timesteps, policyFile: r.policyFile, baseline: r.baseline && { reached: r.baseline.reached, episodes: r.baseline.episodes, reachedS: r.baseline.reachedS, finalErrorM: r.baseline.finalErrorM, rmsTorqueMaxNm: r.baseline.rmsTorqueMaxNm, peakTorqueNm: r.baseline.peakTorqueNm }, policy: r.policy && { reached: r.policy.reached, reachedS: r.policy.reachedS, finalErrorM: r.policy.finalErrorM, rmsTorqueMaxNm: r.policy.rmsTorqueMaxNm }, policyBeatsBaseline: r.policyBeatsBaseline, taskSpec: r.taskSpec };
    if (!r.policyFile) return { stage: 'baseline', tone: 'warn', figure: [secs(r.baseline && r.baseline.reachedS), `to the target with ${task.loadKg} kg (the PD baseline; the brief allows ${task.timeS} s)`], line: `baseline · ${reportLine(latest.file, r, task, limit)} · ${plantNote}`, read, action: { label: 'Train the policy', plantTrain: true } };
    const certEntry = all.find((x) => x.file === `${String(r.policyFile).replace(/\.zip$/, '')}.certificate.json`);
    const cert = latest.certified && typeof latest.certified.ok === 'boolean' ? { file: `${String(r.policyFile).replace(/\.zip$/, '')}.certificate.json`, ...latest.certified } : certEntry && certEntry.report && typeof certEntry.report.ok === 'boolean' ? { file: certEntry.file, ...certEntry.report } : null;
    if (cert) read.certificate = { file: cert.file, policyFile: cert.policyFile, policySha256: cert.policySha256, buildHash: cert.buildHash, specSha256: cert.specSha256, ok: cert.ok, checked: cert.checked, refusedCount: cert.refusedCount, certifiedAt: cert.certifiedAt, policyBeatsBaseline: cert.policyBeatsBaseline };
    const verdict = r.policyBeatsBaseline === true ? 'the policy beats the baseline' : r.policyBeatsBaseline === false ? 'the baseline still wins' : 'no verdict';
    if (!cert) return { stage: 'trained', tone: 'warn', figure: [secs(r.policy && r.policy.reachedS), `policy, against the baseline's ${secs(r.baseline && r.baseline.reachedS)}`], line: `trained · ${latest.file} (${r.timesteps} PPO steps, seed ${r.seed}): ${verdict} · policy reached in ${secs(r.policy && r.policy.reachedS)}, RMS motor torque ${nm(r.policy && r.policy.rmsTorqueMaxNm)} of ${nm(limit)} · uncertified · ${plantNote}`, read, action: { label: 'Certify', plantCertify: latest.file } };
    if (!cert.ok) return { stage: 'trained', tone: 'warn', figure: ['refused', `${cert.refusedCount} of ${cert.checked} ${cert.unit || 'control steps'}`], line: `trained · ${latest.file}: certification refused at ${cert.refusedCount} of ${cert.checked} ${cert.unit || 'control steps'}${cert.refused && cert.refused[0] ? ` — first: ${cert.refused[0].reason}` : ''} · ${plantNote}`, read, action: { label: 'Train the policy', plantTrain: true } };
    const line = `certified · ${latest.file} (${r.timesteps} PPO steps, seed ${r.seed}): ${certifiedLine(cert, r, limit)} · ${brain} · ${plantNote}`;
    return { stage: 'certified', tone: 'ok', figure: ['certified', `${training.length} ${prefix}* report${training.length === 1 ? '' : 's'}`], line, met: true, evidence: line, revision: String(cert.policySha256), read, action: { label: 'Run the baselines', plantBaselines: true } };
  }

  // ── The Mechanism screen ──
  const TASK_NOTE = 'The task is read from the brief: a requirement line like "lifts 2 kg to 300 mm in 5 s" (raise, hoist; g or kg; mm, cm or m; s or min) becomes a displacement of the payload, the load and the time. Edit the brief to change it.';
  function option(value, label, selected) { return el('option', { value, selected: selected || undefined }, label); }
  function partSelect(id, parts, chosen, allowNone) {
    const sel = el('select', { id });
    if (allowNone) sel.append(option('', 'none'));
    for (const p of parts) sel.append(option(p.id, p.name === p.id ? p.id : `${p.name} (${p.id})`, p.id === chosen));
    return sel;
  }
  function numInput(id, value, step, placeholder) { return el('input', { id, type: 'number', step: step || 'any', value: value === null || value === undefined ? '' : String(value), placeholder: placeholder || '' }); }
  function vecInputs(prefix, value) {
    const wrap = el('div', { class: 'vec' });
    ['x', 'y', 'z'].forEach((k, i) => wrap.append(numInput(`${prefix}-${k}`, value ? value[i] : 0, 'any', k)));
    return wrap;
  }
  function jointRow(j, i, parts, rows) {
    const row = el('div', { class: 'joint', dataset: { joint: String(i) } });
    const head = el('div', { class: 'joint-head' });
    head.append(el('label', null, 'Joint id'), el('input', { id: `j${i}-id`, type: 'text', value: j.id || `joint-${i + 1}`, maxlength: 64 }));
    head.append(el('label', null, 'Parent'), partSelect(`j${i}-parent`, parts, j.parent, false), el('label', null, 'Child'), partSelect(`j${i}-child`, parts, j.child, false));
    const type = el('select', { id: `j${i}-type` }); for (const t of JOINT_TYPES) type.append(option(t, t, j.type === t));
    head.append(el('label', null, 'Type'), type);
    const remove = el('button', { type: 'button', class: 'btn', id: `j${i}-remove` }, 'Remove'); remove.onclick = () => row.remove();
    head.append(remove);
    const body = el('div', { class: 'joint-body' });
    body.append(el('label', null, 'Axis (parent frame)'), vecInputs(`j${i}-axis`, j.axis || [0, 0, 1]));
    body.append(el('label', null, 'Range lo, hi (rad for a hinge, m for a slide)'), (() => { const w = el('div', { class: 'vec' }); const r = j.type === 'slide' ? j.rangeM : j.rangeRad; w.append(numInput(`j${i}-lo`, r ? r[0] : null, 'any', 'lo'), numInput(`j${i}-hi`, r ? r[1] : null, 'any', 'hi')); return w; })());
    body.append(el('label', null, 'Child origin in the parent, mm'), vecInputs(`j${i}-origin`, j.originMm || [0, 0, 0]));
    const motor = el('select', { id: `j${i}-motor` }); motor.append(option('', 'not driven'));
    for (const r of rows) motor.append(el('option', { value: r.rowId, selected: j.drivenBy === r.rowId || undefined, disabled: !r.usable || undefined, dataset: { source: r.source } }, `${r.name || r.rowId} · ${r.source}${r.usable ? ` · stall ${r.stallNm.toFixed(3)} N·m, no-load ${r.noLoadRadS.toFixed(2)} rad/s, continuous ${r.continuousNm.toFixed(3)} N·m` : ` · ${r.why}`}`));
    body.append(el('label', null, 'Driven by (a bought motor row)'), motor, el('label', null, 'Gear ratio (motor rad per joint rad, or per metre on a slide)'), numInput(`j${i}-ratio`, j.gearRatio, 'any', 'e.g. 40'));
    row.append(head, body);
    return row;
  }
  function renderParts(host, parts) {
    host.textContent = '';
    host.append(el('p', { class: 'step' }, '1 · Parts'), el('p', { class: 'help' }, 'The Design phase\'s bound CAD Studio parts, with the kernel\'s mass and extents; a part not built yet has none and cannot be in the plant.'));
    const ul = el('ul', { class: 'parts', id: 'mech-parts' });
    for (const p of parts) ul.append(el('li', { dataset: { part: p.id, built: p.built ? '1' : '0' } }, `${p.name} (${p.id}) · ${p.built ? `${isNum(p.massG) ? `${p.massG} g` : '— g'} · ${p.extentsMm ? `${p.extentsMm.join(' × ')} mm` : '— mm'} by the kernel, r${p.revision}` : p.program ? 'not in CAD Studio yet (Create the parts in CAD Studio on the Design poster)' : 'not built'}`));
    if (!parts.length) ul.append(el('li', null, 'no part is bound to the Design phase'));
    host.append(ul);
  }
  /**
   * @description Render the Mechanism screen into its form: parts, base, joints, motors, payload, task; read-only for a design embodied computed.
   * @param {object} o {project, parts, mechanism, rows, briefTask, readOnly, plantJoints}.
   */
  function renderMechanism(o) {
    const form = $('mechanism-form'); form.textContent = '';
    const partsCard = el('div', { class: 'card', id: 'mech-parts-card' }); renderParts(partsCard, o.parts); form.append(partsCard);
    if (o.readOnly) {
      const card = el('div', { class: 'card', id: 'mech-readonly' });
      card.append(el('p', { class: 'step' }, '2 · Joints (read-only)'), el('p', { class: 'help' }, 'This design is embodied\'s own: its mechanism is computed by its plant generator and read from the plant\'s MJCF. Nothing here is edited.'));
      const ul = el('ul', { class: 'parts' });
      for (const j of o.plantJoints || []) ul.append(el('li', { dataset: { joint: j.name } }, `${j.name} · hinge · range ${j.rangeRad ? j.rangeRad.map((v) => v.toFixed(4)).join(' to ') : '—'} rad`));
      if (!(o.plantJoints || []).length) ul.append(el('li', null, 'the plant\'s MJCF was not read'));
      card.append(ul); form.append(card);
      return;
    }
    const m = o.mechanism || { parts: o.parts.map((p) => ({ id: p.id, name: p.name })), base: o.parts[0] ? o.parts[0].id : '', joints: [], motors: [], payload: null, task: null };
    const baseCard = el('div', { class: 'card' }); baseCard.append(el('p', { class: 'step' }, '2 · Ground'), el('label', null, 'The part that is ground'), partSelect('mech-base', o.parts, m.base, false)); form.append(baseCard);
    const jointsCard = el('div', { class: 'card', id: 'mech-joints-card' });
    jointsCard.append(el('p', { class: 'step' }, '3 · Joints'), el('p', { class: 'help' }, 'One row per joint: the child part hangs from the parent at the origin given in the parent\'s frame; a hinge turns about the axis within its range in radians, a slide moves along it within its range in metres, a fixed joint only places the part. A driven joint names a bought motor row (embodied\'s catalog, or Circuit Lab\'s drivers when a row states a continuous rating) and the gear ratio the design states.'));
    const list = el('div', { id: 'mech-joints' }); m.joints.forEach((j, i) => list.append(jointRow(j, i, o.parts, o.rows))); jointsCard.append(list);
    const add = el('button', { type: 'button', class: 'btn', id: 'mech-add-joint' }, 'Add a joint');
    add.onclick = () => { list.append(jointRow({ type: 'hinge', axis: [0, 1, 0], rangeRad: [-1.57, 1.57], originMm: [0, 0, 0] }, list.children.length, o.parts, o.rows)); };
    jointsCard.append(add); form.append(jointsCard);
    const payCard = el('div', { class: 'card' });
    payCard.append(el('p', { class: 'step' }, '4 · Payload'), el('label', null, 'Mass, kg'), numInput('mech-payload-mass', m.payload ? m.payload.massKg : (o.briefTask ? o.briefTask.loadKg : null), 'any', 'from the brief'), el('label', null, 'Rides on'), partSelect('mech-payload-part', o.parts, m.payload ? m.payload.attachedTo : '', true));
    form.append(payCard);
    const taskCard = el('div', { class: 'card', id: 'mech-task-card' });
    const t = m.task || o.briefTask;
    taskCard.append(el('p', { class: 'step' }, '5 · Task (from the brief)'), el('p', { id: 'mech-task' }, t ? `${t.line ? `"${t.line}" → ` : ''}move the payload by ${t.deltaMm.join(', ')} mm in ${t.timeS} s${isNum(t.loadKg) ? ` with ${t.loadKg} kg` : ''}` : 'no requirement line names a lift: the plant can be built but not trained until the brief has one'), el('p', { class: 'help' }, TASK_NOTE));
    form.append(taskCard);
    const actions = el('div', { class: 'actions' }); actions.append(el('button', { type: 'submit', class: 'btn btn-primary', id: 'mech-save' }, 'Save the mechanism')); form.append(actions);
  }
  /** Read the screen back into a mechanism body. */
  function collectMechanism(parts) {
    const num = (id) => { const v = $(id).value.trim(); return v === '' ? null : Number(v); };
    const vec = (prefix) => ['x', 'y', 'z'].map((k) => num(`${prefix}-${k}`) || 0);
    const joints = [...document.querySelectorAll('#mech-joints .joint')].map((row, i) => {
      const n = row.dataset.joint; const type = $(`j${n}-type`).value;
      const range = [num(`j${n}-lo`), num(`j${n}-hi`)];
      const motor = $(`j${n}-motor`); const drivenBy = motor.value || null;
      return { id: $(`j${n}-id`).value.trim() || `joint-${i + 1}`, parent: $(`j${n}-parent`).value, child: $(`j${n}-child`).value, type, axis: vec(`j${n}-axis`), rangeRad: type === 'hinge' ? range : null, rangeM: type === 'slide' ? range : null, originMm: vec(`j${n}-origin`), drivenBy, gearRatio: drivenBy ? num(`j${n}-ratio`) : null, source: drivenBy ? motor.selectedOptions[0].dataset.source : null };
    });
    const motors = [...new Map(joints.filter((j) => j.drivenBy).map((j) => [j.drivenBy, { rowId: j.drivenBy, source: j.source }])).values()];
    const payloadPart = $('mech-payload-part').value; const payloadMass = num('mech-payload-mass');
    return { parts: parts.map((p) => ({ id: p.id, name: p.name, modelId: p.modelId })), base: $('mech-base').value, joints: joints.map(({ source, ...j }) => j), motors, payload: payloadPart && payloadMass ? { massKg: payloadMass, attachedTo: payloadPart } : null };
  }
  /** The dialog that shows each part being created in CAD Studio. */
  function openPartsDialog(parts) {
    const list = $('make-steps'); list.textContent = ''; $('make-result').textContent = '';
    $('make-title').textContent = 'Create the parts in CAD Studio';
    $('make-what').textContent = `${parts.length} part program${parts.length === 1 ? '' : 's'} from the design, each built once in CAD Studio with your session and tagged with this product; a part already built is read, not rebuilt.`;
    for (const p of parts) { const li = el('li', { class: 'make-part', dataset: { part: p.id, state: p.program ? 'pending' : 'unprintable' } }); li.append(el('b', null, p.name), el('span', { class: 'when' }, p.program ? 'waiting' : 'no program')); list.append(li); }
    $('make-close').disabled = true;
    if (!$('make-dialog').open) $('make-dialog').showModal();
    return (part, line) => { const li = list.querySelector(`li[data-part="${CSS.escape(part.id)}"]`); if (!li) return; li.dataset.state = /^built/.test(line) || /^already/.test(line) ? 'exported' : /^no program/.test(line) ? 'unprintable' : 'building'; li.querySelector('.when').textContent = line; };
  }

  return { designParts, createParts, motorRows, specReads, readPlant, plantSpec, buildPlant, train, certify, viewSimulatePlant, renderMechanism, collectMechanism, openPartsDialog, extents };
}());
