/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D2, lane @ds-app: a phase's stage, computed when the page is
 *                     |                             | read from the bound artifact's engine reply through the person's
 *                     |                             | own session (circuit-lab B17: never server-side), and never
 *                     |                             | stored. One read per engine the chain binds (embodied's design,
 *                     |                             | status, reports and plant; Circuit Lab's designs; CAD Studio's
 *                     |                             | models; the print service's printers), then one view per phase:
 *                     |                             | the stage word, the tone, the big figure, the line, the one
 *                     |                             | button, whether the phase brief's bar is met, and the evidence
 *                     |                             | line, revision and reply excerpt a closure records. An absent
 *                     |                             | engine is "no engine on this swarm for this phase"; a failed
 *                     |                             | read is shown. No number of any machine lives here.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D7, lane @ds-fab: the Fabricate poster reads this package's
 *                     |                             | own print-set listing (GET /projects/{id}/print-set) beside the
 *                     |                             | design and the print service: fabricated when a finished set
 *                     |                             | exists at the current design revision with every part exported
 *                     |                             | watertight and none unprintable (the evidence line names the
 *                     |                             | manifest's sha256, which the closure records), unprintable when
 *                     |                             | a part is listed so with its reason, printable when the set is
 *                     |                             | stale or not made yet. The files are linked; Send to printer
 *                     |                             | appears only with a finished set and a printer chosen in Settings.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D9, lane @ds-plant: a CAD-bound design carries the
 *                     |                             | example's part programs matched to the person's models (Create
 *                     |                             | the parts in CAD Studio when none is built) and a second button,
 *                     |                             | Define the mechanism; the Simulate poster of a product whose
 *                     |                             | plant is generated from its mechanism reads this package's
 *                     |                             | mechanism, embodied's catalog, the plant's state and the
 *                     |                             | training jobs beside the reports (the mechanism module renders
 *                     |                             | concept -> built -> baseline -> trained -> certified).
 */
window.DesignStudioStages = (function stages() {
  'use strict';
  const API = { embodied: '/api/embodied', 'circuit-lab': '/api/circuit-lab', 'cad-studio': '/api/cad-studio', 'scan-to-print': '/api/scan-to-print' };
  const SELF = '/api/design-studio';
  const ENGINE_NAME = { embodied: 'embodied', 'circuit-lab': 'Circuit Lab', 'cad-studio': 'CAD Studio', 'scan-to-print': 'the print service', reasoned: 'no engine' };

  // ── Reads: every answer keeps its status, so a failure is rendered, never swallowed ──
  async function read(url, text) {
    try {
      const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      const raw = await res.text();
      let body = null;
      if (!text) { try { body = raw ? JSON.parse(raw) : null; } catch (_) { body = { raw }; } }
      const error = res.ok ? null : ((body && (body.message || body.error)) || `HTTP ${res.status}`);
      return { ok: res.ok, status: res.status, body, text: text ? raw : null, error, url };
    } catch (e) { return { ok: false, status: 0, body: null, text: null, error: e.message || 'network failure', url }; }
  }
  /** The honest line for a read that did not answer: absent (404 or no answer), refused (401/403), or the failure itself. */
  function absence(r, engine) {
    if (r.status === 404 || r.status === 0) return { kind: 'absent', line: `no engine on this swarm for this phase (${ENGINE_NAME[engine]} did not answer ${r.url.replace(/\?.*$/, '')})` };
    if (r.status === 401 || r.status === 403) return { kind: 'refused', line: `${ENGINE_NAME[engine]} refused this account (HTTP ${r.status})` };
    return { kind: 'failed', line: `unavailable · ${r.url.replace(/\?.*$/, '')}: ${r.error}` };
  }
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const grams = (v) => (isNum(v) ? `${Math.round(v)} g` : '— g');
  const nm = (v) => (isNum(v) ? `${v.toFixed(2)} N·m` : '— N·m');
  /** A content revision for a reply: FNV-1a over its JSON, so the same reply always names the same revision. */
  function revisionOf(value) {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }
  const now = () => new Date().toISOString();

  // ── The engine reads a chain needs, once per refresh ──
  function fitOf(bindings) {
    for (const kind of ['design', 'mechanical', 'sensors', 'simulate', 'fabricate']) {
      const a = bindings[kind] && bindings[kind].artifact;
      if (a && a.engine === 'embodied' && a.fit) return { machine: a.machine || 'hexapod', fit: a.fit, jump: (bindings.simulate && bindings.simulate.artifact && bindings.simulate.artifact.jump) || a.jump || null };
    }
    return null;
  }
  async function readEngines(project, bindings, opts) {
    const engines = new Set(opts && opts.all ? Object.keys(API) : project.phases.map((p) => p.engine));
    const E = { fit: fitOf(bindings), reads: {}, plantProduct: isPlantProduct(bindings) };
    const jobs = [];
    if (engines.has('embodied')) {
      jobs.push(read(`${API.embodied}/physics/status`).then((r) => { E.reads.status = r; }));
      jobs.push(read(`${API.embodied}/physics/reports`).then((r) => { E.reads.reports = r; }));
      if (E.fit) {
        E.reads.designUrl = `${API.embodied}/build/${encodeURIComponent(E.fit.machine)}?fit=${encodeURIComponent(E.fit.fit)}`;
        jobs.push(read(E.reads.designUrl).then((r) => { E.reads.design = r; }));
        if (project.phases.some((p) => p.kind === 'simulate' && p.engine === 'embodied')) {
          const jump = E.fit.jump ? `&jump=${encodeURIComponent(E.fit.jump)}` : '';
          jobs.push(read(`${API.embodied}/physics/${encodeURIComponent(E.fit.machine)}/mjcf?fit=${encodeURIComponent(E.fit.fit)}${jump}`, true).then((r) => { E.reads.mjcf = r; }));
        }
      }
    }
    if (engines.has('circuit-lab')) {
      jobs.push(read(`${API['circuit-lab']}/designs`).then((r) => { E.reads.circuits = r; }));
      jobs.push(read(`${API['circuit-lab']}/examples`).then((r) => { E.reads.examples = r; }));
    }
    if (engines.has('cad-studio')) jobs.push(read(`${API['cad-studio']}/models`).then((r) => { E.reads.models = r; }));
    if (engines.has('scan-to-print') || project.phases.some((p) => p.kind === 'fabricate')) jobs.push(read(`${API['scan-to-print']}/printers`).then((r) => { E.reads.printers = r; }));
    if (project.phases.some((p) => p.kind === 'fabricate')) jobs.push(read(`${SELF}/projects/${encodeURIComponent(project.id)}/print-set`).then((r) => { E.reads.printSet = r; }));
    await Promise.all(jobs);
    if (E.plantProduct && window.DesignStudioMechanism) await window.DesignStudioMechanism.readPlant(project, E);
    return E;
  }
  /** A product whose plant is generated from its design: bound to embodied's generic plant, or designed in CAD Studio with no fit or report of its own (ADR-203 D9). */
  function isPlantProduct(bindings) {
    const a = bindings.simulate && bindings.simulate.artifact;
    if (a && a.engine === 'embodied' && a.kind === 'plant') return true;
    const d = bindings.design && bindings.design.artifact;
    return !!(d && d.kind === 'cad-models' && !(a && (a.reportPrefix || a.report)));
  }

  // ── The plant: the MJCF's timestep and joint ranges (what the body contract publishes) ──
  function parsePlant(mjcfRead) {
    if (!mjcfRead || !mjcfRead.ok || !mjcfRead.text) return null;
    const doc = new DOMParser().parseFromString(mjcfRead.text, 'application/xml');
    const option = doc.querySelector('option');
    const physicsDt = option && option.getAttribute('timestep') ? Number(option.getAttribute('timestep')) : null;
    const actuated = new Set([...doc.querySelectorAll('actuator > *')].map((a) => a.getAttribute('joint')).filter(Boolean));
    const joints = [...doc.querySelectorAll('joint')].filter((j) => actuated.has(j.getAttribute('name'))).map((j) => {
      const range = String(j.getAttribute('range') || '').trim().split(/\s+/).map(Number);
      return { name: j.getAttribute('name'), rangeRad: range.length === 2 && range.every(isNum) ? range : null };
    }).filter((j) => j.rangeRad);
    return { route: mjcfRead.url, readAt: now(), physicsDt: isNum(physicsDt) ? physicsDt : null, joints, actuators: joints.map((j) => j.name) };
  }

  // ── Design (embodied): concept → sized → parts-complete, from the design object ──
  const printedParts = (d) => (Array.isArray(d.printed) ? d.printed : []);
  const boughtParts = (d) => (Array.isArray(d.bought) ? d.bought : []);
  const hasProgram = (p) => !!(p && p.cad && p.cad.base && Array.isArray(p.cad.features));
  function jointRows(joints) {
    if (!joints || typeof joints !== 'object') return [];
    if (Array.isArray(joints)) return joints;
    return Object.entries(joints).filter(([, v]) => v && typeof v === 'object').map(([joint, v]) => ({ joint, ...v }));
  }
  function worstJoint(joints) {
    const loaded = joints.filter((j) => isNum(j.nm));
    return loaded.length ? loaded.reduce((a, b) => (b.nm > a.nm ? b : a)) : null;
  }
  function designStage(d) {
    const budget = d.massBudget || {};
    const within = typeof budget.withinTarget === 'boolean' ? budget.withinTarget : (isNum(budget.totalG) && isNum(budget.targetG) && budget.totalG <= budget.targetG);
    const joints = jointRows(d.joints);
    const over = joints.filter((j) => j.withinContinuous === false).map((j) => j.joint || 'a joint');
    const printed = printedParts(d); const programs = printed.filter(hasProgram).length;
    const because = [];
    if (!within) because.push(`${grams(budget.totalG)} over the ${grams(budget.targetG)} target`);
    if (over.length) because.push(`${over.join(', ')} over its continuous torque`);
    if (because.length) return { stage: 'concept', tone: 'warn', line: `concept · ${because.join(' · ')}`, met: false };
    const w = worstJoint(joints);
    const closed = `${grams(budget.totalG)} under the ${grams(budget.targetG)} target${w ? ` · worst ${w.joint} ${nm(w.nm)} of ${nm(w.usableNm)} continuous` : ''}`;
    if (printed.length && programs === printed.length) return { stage: 'parts-complete', tone: 'ok', line: `parts-complete · ${closed} · ${programs} printed programs`, met: true };
    return { stage: 'sized', tone: 'ok', line: `sized · ${closed} · ${programs} of ${printed.length} printed parts have a program`, met: false };
  }
  /** The design reply excerpt a binding keeps: the servo row, the limits, the joint rows, the budget - what the body contract reads. */
  function designRead(d, url) {
    const spec = d.spec || {};
    return { route: url, readAt: now(), revision: revisionOf(d), servo: d.servo ? { id: d.servo.id, name: d.servo.name, stallNm: d.servo.stallNm, noLoadRadS: d.servo.noLoadRadS } : null,
      limitsDeg: spec.limits || null, servoCount: spec.servoCount, joints: jointRows(d.joints).map((j) => ({ joint: j.joint, nm: j.nm, usableNm: j.usableNm, stallNm: j.stallNm, withinContinuous: j.withinContinuous })),
      massBudget: d.massBudget ? { totalG: d.massBudget.totalG, targetG: d.massBudget.targetG, withinTarget: d.massBudget.withinTarget } : null, printed: printedParts(d).length, programs: printedParts(d).filter(hasProgram).length };
  }
  function viewDesignEmbodied(E) {
    const r = E.reads.design;
    if (!E.fit) return { stage: 'unbound', tone: 'warn', figure: ['—', 'no fit bound'], line: 'no fit bound to this phase: ask the design partner to bind one, or set it in Settings', action: { label: 'Open the design', disabled: true } };
    if (!r.ok) { const a = absence(r, 'embodied'); return { stage: a.kind, tone: a.kind === 'failed' ? 'bad' : 'warn', figure: ['—', 'all-up mass against the target'], line: a.line, action: { label: 'Open the design', disabled: true } }; }
    const d = r.body; const s = designStage(d); const budget = d.massBudget || {};
    return { stage: s.stage, tone: s.tone, figure: [grams(budget.totalG), `all-up, of the ${grams(budget.targetG)} target · the design's figures`], line: s.line, met: s.met,
      evidence: s.line, revision: revisionOf(d), read: designRead(d, E.reads.designUrl), action: { label: 'Open the design', href: `${E.reads.designUrl.replace(/\?/, '/design.md?')}` } };
  }

  // ── Design (CAD Studio): the bound parts' build states; an example's programs until they are created ──
  function viewDesignCad(project, E, binding) {
    const r = E.reads.models;
    const mechanism = { label: 'Define the mechanism', mechanism: true };
    if (!r || !r.ok) { const a = absence(r || { status: 0, url: `${API['cad-studio']}/models`, error: 'not read' }, 'cad-studio'); return { stage: a.kind, tone: a.kind === 'failed' ? 'bad' : 'warn', figure: ['—', 'parts built'], line: a.line, action: { label: 'Open in CAD Studio', disabled: true }, secondary: mechanism }; }
    const a = (binding && binding.artifact) || {};
    const programs = Array.isArray(a.parts) ? a.parts : [];
    const ids = Array.isArray(a.modelIds) ? a.modelIds : [];
    if (programs.length && !ids.length) {
      const named = programs.filter((p) => p.program).length;
      return { stage: 'concept', tone: 'warn', figure: [`0/${programs.length}`, 'parts built'], line: `concept · ${named} of ${programs.length} parts are programs from the design (${programs.map((p) => p.name || p.id).join(', ')}); none is in CAD Studio yet: Create the parts in CAD Studio builds them with your session`, action: { label: 'Create the parts in CAD Studio', createParts: true, disabled: !named }, secondary: mechanism };
    }
    const models = (Array.isArray(r.body.models) ? r.body.models : []).filter((m) => ids.includes(m.model_id));
    const built = models.filter((m) => m.state === 'built');
    const open = { label: 'Open in CAD Studio', href: `/api/cad-studio/app${models[0] ? `?model=${encodeURIComponent(models[0].model_id)}` : ''}` };
    if (!ids.length) return { stage: 'concept', tone: 'warn', figure: ['0', 'parts bound'], line: 'concept · no CAD Studio part is bound to this phase yet: bind parts in Settings or ask the design partner', action: open, secondary: mechanism };
    const missing = ids.length - models.length;
    const line = `${built.length === models.length && !missing ? 'parts-complete' : 'sized'} · ${built.length} of ${ids.length} bound parts built${missing ? ` · ${missing} bound id${missing === 1 ? '' : 's'} not among your parts` : ''} · ${models.map((m) => `${m.title} r${m.revision}`).join(', ')}`;
    const met = built.length === ids.length && !missing;
    return { stage: met ? 'parts-complete' : 'sized', tone: met ? 'ok' : 'warn', figure: [`${built.length}/${ids.length}`, 'parts built'], line, met, evidence: line, revision: models.map((m) => `${m.model_id.slice(0, 8)}@r${m.revision}`).join('+') || 'none',
      read: { route: r.url, readAt: now(), models: models.map((m) => ({ modelId: m.model_id, title: m.title, revision: m.revision, state: m.state, massG: m.report ? m.report.massG : null })) }, action: open, secondary: mechanism };
  }

  // ── Mechanical: every joint inside its continuous torque (the design's rows) ──
  function viewMechanical(E) {
    const r = E.reads.design;
    if (!E.fit || !r) return { stage: 'unbound', tone: 'warn', figure: ['—', 'worst joint load'], line: 'no design bound: the mechanical spec reads the design\'s joint rows', action: { label: 'Open the design', disabled: true } };
    if (!r.ok) { const a = absence(r, 'embodied'); return { stage: a.kind, tone: a.kind === 'failed' ? 'bad' : 'warn', figure: ['—', 'worst joint load'], line: a.line, action: { label: 'Open the design', disabled: true } }; }
    const joints = jointRows(r.body.joints); const w = worstJoint(joints);
    if (!w) return { stage: 'unsized', tone: 'warn', figure: ['—', 'worst joint load'], line: 'unsized · the design carries no joint loads', action: { label: 'Open the design', href: E.reads.designUrl.replace(/\?/, '/design.md?') } };
    const over = joints.filter((j) => j.withinContinuous === false);
    const line = over.length ? `over-torque · ${over.map((j) => `${j.joint} ${nm(j.nm)} of ${nm(j.usableNm)}`).join(', ')}` : `sized · ${joints.map((j) => `${j.joint} ${nm(j.nm)}`).join(', ')} of ${nm(w.usableNm)} continuous (margin ${isNum(w.margin) ? w.margin.toFixed(2) : '—'})`;
    return { stage: over.length ? 'over-torque' : 'sized', tone: over.length ? 'warn' : 'ok', figure: [nm(w.nm), `worst ${w.joint} of ${nm(w.usableNm)} continuous`], line, met: !over.length, evidence: line, revision: revisionOf(r.body),
      read: { route: E.reads.designUrl, readAt: now(), joints: joints.map((j) => ({ joint: j.joint, nm: j.nm, usableNm: j.usableNm, withinContinuous: j.withinContinuous })) }, action: { label: 'Open the design', href: E.reads.designUrl.replace(/\?/, '/design.md?') } };
  }

  // ── Electrical (Circuit Lab): drafted → solved → holds, from the person's own design ──
  function ownCircuit(E, binding) {
    const list = E.reads.circuits && E.reads.circuits.ok && Array.isArray(E.reads.circuits.body.designs) ? E.reads.circuits.body.designs : [];
    const a = (binding && binding.artifact) || {};
    if (a.designId) return list.find((d) => d.design_id === a.designId) || null;
    if (a.example) return list.filter((d) => d.source && d.source.example === a.example).sort((x, y) => (x.updated_at < y.updated_at ? 1 : -1))[0] || null;
    return null;
  }
  function circuitHolds(report) {
    const readings = report && Array.isArray(report.readings) ? report.readings : [];
    const regulators = readings.filter((x) => x.type === 'regulator');
    const bad = regulators.filter((x) => x.inDropout || x.overMax).map((x) => `${x.id} ${x.inDropout ? 'in dropout' : 'over its current'}`);
    const warnings = report && Array.isArray(report.warnings) ? report.warnings.length : 0;
    const battery = readings.find((x) => (x.type === 'battery' || x.type === 'source') && isNum(x.runtimeHours));
    return { holds: !bad.length && !warnings, bad, warnings, regulators: regulators.map((x) => `${x.id} ${isNum(x.voltsFinal) ? x.voltsFinal.toFixed(2) + ' V' : ''}`.trim()), runtime: battery ? `${(battery.runtimeHours * 60).toFixed(1)} min at the run's average draw` : 'runtime not stated by a battery reading' };
  }
  function viewElectrical(E, binding) {
    const r = E.reads.circuits;
    if (!r || !r.ok) { const a = absence(r || { status: 0, url: `${API['circuit-lab']}/designs`, error: 'not read' }, 'circuit-lab'); return { stage: a.kind, tone: a.kind === 'failed' ? 'bad' : 'warn', figure: ['—', 'bus and rails'], line: a.line, action: { label: 'Open in Circuit Lab', disabled: true } }; }
    const a = (binding && binding.artifact) || {};
    const own = ownCircuit(E, binding);
    if (!own) {
      const examples = E.reads.examples && E.reads.examples.ok && Array.isArray(E.reads.examples.body.examples) ? E.reads.examples.body.examples : [];
      const ex = a.example ? examples.find((x) => x.id === a.example) : null;
      const line = a.example ? (ex ? `drafted · the ${ex.title || a.example} example is in the lab; Open in Circuit Lab makes your copy and solves it on the engine` : `drafted · the example ${a.example} is not in this lab's list`) : 'drafted · no circuit bound: Open in Circuit Lab starts one, or ask the design partner';
      return { stage: 'drafted', tone: 'warn', figure: ['—', 'bus and rails'], line, action: { label: 'Open in Circuit Lab', circuit: { example: a.example || null } } };
    }
    const open = { label: 'Open in Circuit Lab', href: `/api/circuit-lab/app?design=${encodeURIComponent(own.design_id)}` };
    if (!own.run_count) return { stage: 'drafted', tone: 'warn', figure: [String(own.parts.length), `parts · ${own.title}`], line: `drafted · ${own.title} is not solved yet${own.state === 'failed' ? ` · last solve failed: ${own.failure_reason || ''}` : ''}`, action: open, read: { route: r.url, readAt: now(), designId: own.design_id } };
    const h = circuitHolds(own.report);
    const line = h.holds ? `holds · run ${own.run_count} of ${own.title}: ${h.regulators.join(', ') || 'no regulator'} · ${h.runtime}` : `solved · run ${own.run_count} of ${own.title}: ${[...h.bad, h.warnings ? `${h.warnings} warning${h.warnings === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')}`;
    return { stage: h.holds ? 'holds' : 'solved', tone: h.holds ? 'ok' : 'warn', figure: [`run ${own.run_count}`, own.title], line, met: h.holds, evidence: line, revision: `${own.design_id.slice(0, 8)}@run${own.run_count}`,
      read: { route: r.url, readAt: now(), designId: own.design_id, run: own.run_count, regulators: h.regulators, warnings: h.warnings, runtime: h.runtime }, action: open };
  }

  // ── Sensors: each named sense has a row and a mount in the design ──
  function viewSensors(E, binding) {
    const r = E.reads.design; const names = (binding && binding.artifact && Array.isArray(binding.artifact.senses)) ? binding.artifact.senses : [];
    if (!E.fit || !r) return { stage: 'unspecified', tone: 'warn', figure: ['—', 'senses'], line: 'no design bound: the senses are rows and parts of the design', action: { label: 'Open the design', disabled: true } };
    if (!r.ok) { const a = absence(r, 'embodied'); return { stage: a.kind, tone: a.kind === 'failed' ? 'bad' : 'warn', figure: ['—', 'senses'], line: a.line, action: { label: 'Open the design', disabled: true } }; }
    const d = r.body; const bought = boughtParts(d); const printed = printedParts(d);
    const find = (re) => bought.find((b) => re.test(`${b.id} ${b.name}`));
    const senses = names.map((name) => {
      if (name === 'joints') return { name, present: isNum(d.spec && d.spec.servoCount), count: d.spec ? d.spec.servoCount : null, reader: 'the node (joint feedback on the servo bus)' };
      const row = find(new RegExp(name, 'i')); const mount = printed.find((p) => new RegExp(name, 'i').test(`${p.id} ${p.name}`));
      return { name, present: !!row, row: row ? { id: row.id, name: row.name } : null, mount: mount ? mount.name : null };
    });
    const missing = senses.filter((s) => !s.present).map((s) => s.name);
    const line = missing.length ? `unspecified · no row in the design for ${missing.join(', ')}` : `specified · ${senses.map((s) => `${s.name}${s.row ? ` (${s.row.name}${s.mount ? `, on the ${s.mount}` : ''})` : s.count ? ` (${s.count})` : ''}`).join(' · ')}`;
    return { stage: missing.length ? 'unspecified' : 'specified', tone: missing.length ? 'warn' : 'ok', figure: [String(senses.filter((s) => s.present).length), `of ${senses.length} senses in the design`], line, met: !missing.length && senses.length > 0, evidence: line, revision: revisionOf(d),
      read: { route: E.reads.designUrl, readAt: now(), senses }, action: { label: 'Open the design', href: E.reads.designUrl.replace(/\?/, '/design.md?') } };
  }

  // ── Controller: the engine hello and a node of the kind on the rail ──
  function viewController(E, binding) {
    const r = E.reads.status; const kind = (binding && binding.artifact && binding.artifact.nodeKind) || null;
    if (E.plantProduct && !kind && r && r.ok) {
      const connected = !!(r.body.engine && r.body.engine.connected);
      const line = connected ? `the plant in the engine stands in for the machine · physics engine ${r.body.engine.engine} ${r.body.engine.version} connected · a node joins the rail when there is hardware` : 'physics engine not available on this installation';
      return { stage: connected ? 'on-the-plant' : 'nothing-on-the-rail', tone: connected ? 'ok' : 'warn', figure: ['plant', 'runs the controller in simulation'], line, met: connected, evidence: line, revision: connected ? String(r.body.engine.buildHash) : undefined, read: { route: r.url, readAt: now(), engine: connected ? { connected, engine: r.body.engine.engine, version: r.body.engine.version, buildHash: r.body.engine.buildHash } : null }, action: { label: 'Node status', status: true } };
    }
    if (!r || !kind) return { stage: 'unbound', tone: 'warn', figure: ['—', 'nodes on the rail'], line: 'no node kind bound to this phase: ask the design partner to bind one (a node on the rail speaking the body contract)', action: { label: 'Node status', status: true, disabled: !r } };
    if (!r.ok) { const a = absence(r, 'embodied'); return { stage: a.kind, tone: a.kind === 'failed' ? 'bad' : 'warn', figure: ['—', 'nodes on the rail'], line: a.line, action: { label: 'Node status', status: true } }; }
    const nodes = Array.isArray(r.body.nodes) ? r.body.nodes : [];
    const ofKind = kind ? nodes.filter((n) => n && n.kind === kind) : nodes;
    const on = ofKind.filter((n) => n.online);
    const connected = !!(r.body.engine && r.body.engine.connected);
    const engineLine = connected ? `physics engine ${r.body.engine.engine} ${r.body.engine.version} connected` : 'physics engine not available on this installation';
    const nodeLine = !ofKind.length ? `no ${kind || ''} node has joined the rail` : !on.length ? `${kind} node ${ofKind.map((n) => n.nodeId).join(', ')} offline` : `${kind} node ${on.map((n) => `${n.nodeId} online (${n.engine} ${n.version})`).join(', ')}`;
    const stage = on.length ? 'on-the-rail' : connected ? 'engine-ready' : 'nothing-on-the-rail';
    const node = on[0] || ofKind[0] || null;
    return { stage, tone: on.length ? 'ok' : 'warn', figure: [String(on.length), on.length === 1 ? `${kind} node on the rail` : `${kind} nodes on the rail`], line: `${engineLine} · ${nodeLine}`, met: on.length > 0, evidence: `${engineLine} · ${nodeLine}`, revision: node ? `${node.nodeId}@${node.version || '?'}` : 'none',
      read: { route: r.url, readAt: now(), engine: r.body.engine ? { connected, engine: r.body.engine.engine, version: r.body.engine.version, buildHash: r.body.engine.buildHash } : null, node: node ? { nodeId: node.nodeId, kind: node.kind, online: node.online, engine: node.engine, version: node.version, endpoint: node.endpointUrl || node.endpoint || null, tickHz: isNum(node.tickHz) ? node.tickHz : (node.hello && isNum(node.hello.tickHz) ? node.hello.tickHz : null) } : null },
      action: { label: 'Node status', status: true } };
  }

  // ── Simulate: baseline → trained → certified, from the reports and the certificate ──
  const isTraining = (x) => !/\.certificate\.json$/.test(String(x.file));
  const stamp = (x) => (x.report && (x.report.finishedAt || x.report.startedAt)) || '';
  function certificateOf(entry, all, bound) {
    if (bound) { const c = all.find((x) => x.file === bound); if (c && c.report && typeof c.report.ok === 'boolean') return { file: c.file, ...c.report }; }
    if (entry && entry.certified) return { file: `${String(entry.report.policyFile).replace(/\.zip$/, '')}.certificate.json`, ...entry.certified };
    const policy = entry && entry.report && entry.report.policyFile;
    if (!policy) return null;
    const file = `${String(policy).replace(/\.zip$/, '')}.certificate.json`;
    const c = all.find((x) => x.file === file);
    return c && c.report && typeof c.report.ok === 'boolean' ? { file: c.file, ...c.report } : null;
  }
  function viewSimulate(project, E, binding, entry) {
    const r = E.reads.reports; const a = (binding && binding.artifact) || {};
    if (E.plantProduct) return window.DesignStudioMechanism.viewSimulatePlant(project, E, binding, entry);
    const brain = 'the walker';
    if (!r) return { stage: 'unbound', tone: 'warn', figure: ['—', 'reports'], line: 'no engine bound to this phase', action: { label: 'Run the baselines', disabled: true } };
    if (!a.reportPrefix && !a.report) return { stage: 'unbound', tone: 'warn', figure: ['—', 'reports'], line: `unbound · no plant or report bound to this phase: ask the design partner to bind one${E.fit ? '' : ' (no fit is bound either)'} · ${brain}`, action: { label: 'Run the baselines', disabled: !E.fit, baselines: true } };
    if (!r.ok) { const ab = absence(r, 'embodied'); return { stage: ab.kind, tone: ab.kind === 'failed' ? 'bad' : 'warn', figure: ['—', 'reports'], line: ab.line, action: { label: 'Run the baselines', disabled: true } }; }
    const prefix = a.reportPrefix || ''; const all = (Array.isArray(r.body.reports) ? r.body.reports : []).filter((x) => String(x.file).startsWith(prefix));
    const training = all.filter(isTraining);
    const bound = a.report ? training.find((x) => x.file === a.report) : null;
    const latest = bound || (training.length ? training.reduce((best, x) => (stamp(x) > stamp(best) ? x : best), training[training.length - 1]) : null);
    const plant = parsePlant(E.reads.mjcf);
    const plantNote = plant ? `plant ${plant.actuators.length} actuators at dt ${plant.physicsDt} s` : E.reads.mjcf ? `plant: ${absence(E.reads.mjcf, 'embodied').line}` : 'plant not read';
    if (!latest) return { stage: 'baseline', tone: 'warn', figure: ['0', `${prefix}* reports`], line: `baseline · no ${prefix}* report yet in ${r.body.dir || 'the reports directory'} · ${brain} · ${plantNote}`, action: { label: 'Run the baselines', baselines: true } };
    const cert = certificateOf(latest, all, a.certificate);
    const rep = latest.report || {};
    const judged = cert && typeof cert.policyBeatsBaseline === 'boolean' ? cert : rep;
    const verdict = judged.policyBeatsBaseline === true ? 'policy beats the baseline' : judged.policyBeatsBaseline === false ? 'the baseline still wins' : 'no verdict';
    const certified = !!(cert && cert.ok);
    const certLine = !cert ? 'uncertified' : cert.ok ? `certified (${cert.checked} ${cert.unit || 'points'}, policy sha ${String(cert.policySha256 || '').slice(0, 12)})` : `certification refused at ${cert.refusedCount} of ${cert.checked} ${cert.unit || 'points'}`;
    const line = `${certified ? 'certified' : 'trained'} · ${latest.file} (${rep.task || 'task ?'}, seed ${rep.seed === undefined ? '?' : rep.seed}): ${verdict}${judged === cert ? ' (the gate re-measured)' : ''} · ${certLine} · ${brain} · ${plantNote}`;
    return { stage: certified ? 'certified' : 'trained', tone: certified ? 'ok' : 'warn', figure: [certified ? 'certified' : judged.policyBeatsBaseline === true ? 'policy wins' : 'trained', `${training.length} ${prefix}* report${training.length === 1 ? '' : 's'}`], line, met: certified, evidence: line, revision: cert && cert.policySha256 ? String(cert.policySha256) : `${latest.file}@uncertified`,
      read: { route: r.url, readAt: now(), report: { file: latest.file, task: rep.task, seed: rep.seed, mode: rep.mode, policyFile: rep.policyFile }, certificate: cert ? { file: cert.file, policyFile: cert.policyFile, policySha256: cert.policySha256, buildHash: cert.buildHash, ok: cert.ok, checked: cert.checked, refusedCount: cert.refusedCount, certifiedAt: cert.certifiedAt } : null, plant, brain: entry && entry.brain ? entry.brain : 'walker' },
      action: certified ? { label: 'Run the baselines', baselines: true } : { label: 'Certify', certify: latest.file } };
  }

  // ── Fabricate: the design's parts, this package's print set, the print service ──
  function printerLine(E, entry) {
    const r = E.reads.printers;
    if (!r || !r.ok) return (r && r.status !== 404 && r.status !== 0) ? absence(r, 'scan-to-print').line : 'no print service on this swarm';
    const printers = Array.isArray(r.body.printers) ? r.body.printers : [];
    const chosen = chosenPrinter(E, entry);
    return printers.length ? `${printers.length} printer${printers.length === 1 ? '' : 's'} registered${chosen ? ` · ${chosen.label || chosen.printerId} chosen` : ' · none chosen in Settings'}` : 'no printer registered with the print service';
  }
  /** The printer Settings chose, as the print service lists it now, or null. */
  function chosenPrinter(E, entry) {
    const r = E.reads.printers; if (!r || !r.ok || !entry || !entry.printerId) return null;
    const p = (Array.isArray(r.body.printers) ? r.body.printers : []).find((x) => (x.printer_id || x.id) === entry.printerId);
    return p ? { printerId: p.printer_id || p.id, label: p.label || null, kind: p.kind || null, autoStart: p.autoStart === true || p.auto_start === true } : null;
  }
  /** The design's printed parts and how many have a program, from whichever engine owns the design. */
  function fabricateParts(E, a) {
    if (E.reads.design && E.reads.design.ok) { const parts = printedParts(E.reads.design.body); return { parts, programs: parts.filter(hasProgram).length, source: 'the design\'s printed parts', revision: revisionOf(E.reads.design.body) }; }
    if (E.reads.models && E.reads.models.ok && Array.isArray(a.modelIds)) { const parts = (E.reads.models.body.models || []).filter((m) => a.modelIds.includes(m.model_id)); return { parts, programs: parts.filter((m) => m.state === 'built').length, source: 'the bound CAD Studio parts', revision: parts.map((m) => `${m.model_id.slice(0, 8)}@r${m.revision}`).join('+') || 'none' }; }
    return null;
  }
  /** The set's files as links on the poster. */
  function setFiles(project, set) {
    const base = `${SELF}/projects/${encodeURIComponent(project.id)}/print-set/`;
    const files = Array.isArray(set.manifest && set.manifest.files) ? set.manifest.files : [];
    return [...files.map((f) => ({ file: f.file, href: base + encodeURIComponent(f.file), kind: f.kind })), { file: set.files.manifest, href: base + encodeURIComponent(set.files.manifest), kind: 'manifest' }];
  }
  function fabricateFinished(project, entry, E, set, p, printers) {
    const stale = set.designRevision !== p.revision; const bad = Array.isArray(set.unprintable) ? set.unprintable : [];
    const sent = Array.isArray(set.sent) && set.sent.length ? ` · ${set.sent.length} file${set.sent.length === 1 ? '' : 's'} sent to ${[...new Set(set.sent.map((x) => x.printerLabel || x.printerId))].join(', ')} (${set.sent[set.sent.length - 1].started ? 'the last one started' : set.sent[set.sent.length - 1].uploaded ? 'the last one waits on the printer' : 'the last one was not sent: ' + (set.sent[set.sent.length - 1].message || '')})` : '';
    const sha = String(set.manifestSha256 || '').slice(0, 12);
    const line = stale ? `printable · the set (${set.exported} of ${set.parts} parts, manifest ${sha}) was made at design revision ${set.designRevision}; the design is now ${p.revision}: make it again · ${printers}`
      : bad.length ? `unprintable · ${set.exported} of ${set.parts} parts exported watertight through CAD Studio · ${bad.length} unprintable: ${bad.map((u) => `${u.name} (${u.reason})`).join('; ')} · manifest ${sha}${sent} · ${printers}`
        : `fabricated · ${set.exported} of ${set.parts} parts exported watertight through CAD Studio · manifest ${sha}${sent} · ${printers}`;
    const met = !stale && !bad.length;
    const printer = chosenPrinter(E, entry);
    return { stage: stale ? 'printable' : bad.length ? 'unprintable' : 'fabricated', tone: met ? 'ok' : 'warn', figure: [`${set.exported}/${set.parts}`, 'parts in the print set, watertight'], line, met, evidence: line, revision: set.manifestSha256,
      read: { route: E.reads.printSet.url, readAt: now(), manifestSha256: set.manifestSha256, exported: set.exported, parts: set.parts, unprintable: bad.length, designRevision: set.designRevision, finishedAt: set.finishedAt },
      files: setFiles(project, set), action: { label: 'Make the print set', make: true }, secondary: printer && set.exported > 0 ? { label: 'Send to printer', send: true, printer } : null };
  }
  function viewFabricate(project, E, bindings, entry) {
    const design = (bindings.design && bindings.design.artifact) || {};
    const printers = printerLine(E, entry);
    const p = fabricateParts(E, design);
    if (!p) {
      const r = E.reads.design || E.reads.models;
      const ab = !r ? { kind: 'unbound', line: 'no design bound: the print set is made from the design\'s part programs' } : r.ok ? { kind: 'unbound', line: 'unbound · no CAD Studio part is bound to the Design phase yet: bind parts in Settings or ask the design partner' } : absence(r, E.reads.design ? 'embodied' : 'cad-studio');
      return { stage: ab.kind, tone: ab.kind === 'failed' ? 'bad' : 'warn', figure: ['—', 'printed programs'], line: `${ab.line} · ${printers}`, action: { label: 'Make the print set', make: true, disabled: true } };
    }
    const ps = E.reads.printSet;
    if (ps && ps.ok && ps.body.finished) return fabricateFinished(project, entry, E, ps.body, p, printers);
    const printable = p.parts.length > 0 && p.programs === p.parts.length;
    const setLine = !ps ? 'the print set was not read' : ps.ok ? `a set begun ${ps.body.begunAt} was not finished (${(ps.body.pending || []).length} parts pending): make it again` : ps.status === 404 ? 'no print set made yet' : absence(ps, 'cad-studio').line.replace('CAD Studio', 'this package');
    const line = `${printable ? 'printable' : 'unprintable'} · ${p.programs} of ${p.parts.length} ${p.source} have a program · ${setLine} · ${printers}`;
    return { stage: printable ? 'printable' : 'unprintable', tone: printable ? 'ok' : 'warn', figure: [String(p.programs), `printed programs of ${p.parts.length}`], line, met: false, read: { route: (E.reads.design || E.reads.models).url, readAt: now(), parts: p.parts.length, programs: p.programs }, action: { label: 'Make the print set', make: true, disabled: !p.parts.length } };
  }

  // ── Build and test: the checklist from the design, the controller and the certified brain (D8) ──
  function buildChecklist(E, bindings) {
    const steps = []; const push = (group, id, text) => steps.push({ group, id, text });
    if (E.reads.design && E.reads.design.ok) {
      const parts = printedParts(E.reads.design.body); const links = [...new Set(parts.map((p) => p.link || 'parts'))];
      for (const link of links) for (const p of parts.filter((x) => (x.link || 'parts') === link)) push(`assemble the ${link}`, `assemble:${p.id}`, `${p.name} × ${p.qty}${p.option ? ` (${p.option} only)` : ''}`);
      for (const b of boughtParts(E.reads.design.body)) push('fit the bought parts', `fit:${b.id}`, `${b.name} × ${b.qty}${b.role ? ` — ${b.role}` : ''}`);
    } else if (E.reads.models && E.reads.models.ok && bindings.design && Array.isArray(bindings.design.artifact.modelIds)) {
      for (const m of (E.reads.models.body.models || []).filter((x) => bindings.design.artifact.modelIds.includes(x.model_id))) push('assemble the parts', `assemble:${m.model_id}`, `${m.title} (revision ${m.revision})`);
    }
    const node = bindings.controller && bindings.controller.artifact;
    if (node && node.nodeKind) {
      const count = E.reads.design && E.reads.design.ok && E.reads.design.body.spec ? E.reads.design.body.spec.servoCount : null;
      push('bring-up', 'bringup:serial-body', `the ${node.nodeKind} node on the serial body answers hello`);
      push('bring-up', 'bringup:one-actuator', 'one actuator follows a pose command');
      push('bring-up', 'bringup:row', count ? `the row: all ${count} actuators answer` : 'the row: every actuator answers');
    }
    const sim = bindings.simulate && bindings.simulate.artifact && bindings.simulate.artifact.read && bindings.simulate.artifact.read.certificate;
    if (sim && sim.ok && sim.policyFile) push('the certified brain', 'brain:load', `load {controller: "policy:${sim.policyFile}"} through the node, then walk`);
    else if (bindings.simulate) push('the certified brain', 'brain:load', 'load the certified policy through the node (close the Simulate phase first so its certificate is bound)');
    return steps;
  }
  function viewBuild(E, bindings, closures) {
    const steps = buildChecklist(E, bindings);
    const ticked = new Set(closures.filter((c) => c.phase === 'build' && c.step).map((c) => c.step));
    const done = steps.filter((s) => ticked.has(s.id)).length;
    const stage = !steps.length ? 'not-started' : done === 0 ? 'not-started' : done === steps.length ? 'bench-complete' : 'in-progress';
    const line = !steps.length ? 'not started · no design bound yet, so there is nothing to assemble' : `${stage} · ${done} of ${steps.length} steps ticked on the bench · no software closes this phase`;
    return { stage, tone: stage === 'bench-complete' ? 'ok' : 'warn', figure: [`${done}/${steps.length}`, 'steps ticked'], line, met: false, steps, action: { label: 'Start the build', build: true, disabled: !steps.length } };
  }

  // ── Brief and reasoned phases: no engine; the person's words close them ──
  function viewBrief(project) {
    const b = project.brief || {}; const n = Array.isArray(b.requirements) ? b.requirements.length : 0;
    const line = `drafted · ${b.what || 'no words yet'} · ${n} requirement${n === 1 ? '' : 's'}${b.targets && Object.keys(b.targets).length ? ` · targets ${Object.entries(b.targets).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}`;
    return { stage: 'drafted', tone: 'warn', figure: [String(n), n === 1 ? 'requirement' : 'requirements'], line, met: true, evidence: `the brief is right: ${b.what} · ${n} requirements`, revision: revisionOf(b), read: null, action: { label: 'Confirm the brief', brief: true } };
  }
  function viewReasoned(kind, brief) {
    return { stage: 'reasoned', tone: 'warn', figure: ['—', 'no engine'], line: `no engine on this swarm for this phase · ${brief.produces}`, met: true, evidence: '', revision: 'reasoned', read: null, action: { label: 'Close the phase', close: true, typed: true } };
  }

  /**
   * @description The view of one phase: the stage, the figure, the line and the one button, from the reads.
   * @param {object} project The project. @param {object} entry The phase entry. @param {object} E The engine reads.
   * @param {object} bindings Newest binding per phase. @param {object[]} closures Every closure. @param {object} brief The phase brief.
   * @returns {object} The view.
   */
  function phaseView(project, entry, E, bindings, closures, brief) {
    const binding = bindings[entry.kind] || null;
    if (entry.kind === 'brief') return viewBrief(project);
    if (entry.kind === 'build') return viewBuild(E, bindings, closures);
    if (entry.engine === 'reasoned') return viewReasoned(entry.kind, brief);
    if (entry.kind === 'design') return entry.engine === 'cad-studio' ? viewDesignCad(project, E, binding) : viewDesignEmbodied(E);
    if (entry.kind === 'mechanical') return viewMechanical(E);
    if (entry.kind === 'electrical') return viewElectrical(E, binding);
    if (entry.kind === 'sensors') return viewSensors(E, binding);
    if (entry.kind === 'controller') return viewController(E, binding);
    if (entry.kind === 'simulate') return viewSimulate(project, E, binding, entry);
    if (entry.kind === 'fabricate') return viewFabricate(project, E, bindings, entry);
    return viewReasoned(entry.kind, brief);
  }

  /** The newest closure of a phase (a build step closure never counts as the phase's), and whether it is stale against the view's revision. */
  function closureOf(kind, closures, view) {
    const own = closures.filter((c) => c.phase === kind && !c.step);
    if (!own.length) return null;
    const last = own[own.length - 1];
    return { ...last, stale: !!(view.revision && last.revision !== view.revision) };
  }

  return { read, readEngines, phaseView, closureOf, buildChecklist, revisionOf, parsePlant, absence, chosenPrinter, isPlantProduct, API, SELF, ENGINE_NAME };
}());
