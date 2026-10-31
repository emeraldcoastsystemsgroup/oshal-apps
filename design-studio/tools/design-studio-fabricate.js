/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D7, lane @ds-fab: the Fabricate phase's two actions, run
 *                     |                             | from the page with the person's own session because a package
 *                     |                             | route on the native kernel reaches neither a sibling package nor
 *                     |                             | another package's engine. Make the print set: the parts come
 *                     |                             | from the bound Design phase (embodied's printed parts with their
 *                     |                             | CAD programs, or the bound CAD Studio models); each part with a
 *                     |                             | program becomes the person's own CAD Studio part once (found
 *                     |                             | again by its source tag and program hash, so a re-run rebuilds
 *                     |                             | nothing that did not change), its STL and the kernel's report
 *                     |                             | are read from CAD Studio and posted to this package, which
 *                     |                             | checks the mesh and writes the sheet, the BOM and the manifest;
 *                     |                             | a part without a program, not built, or refused by the engine is
 *                     |                             | recorded unprintable with the reason. Send to printer: one file
 *                     |                             | of the set to the printer chosen in Settings through the print
 *                     |                             | service's posted-model route (the path print-to-3d-printer takes
 *                     |                             | for a scan job), after the person confirms; the service's reply
 *                     |                             | is recorded beside the set in its own words.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D9, lane @ds-plant: ensureCadModel is shared with the
 *                     |                             | mechanism module, which creates a product's part programs in
 *                     |                             | CAD Studio the same way (once, tagged with the product and the
 *                     |                             | program hash) before a plant is built from them.
 */
window.DesignStudioFabricate = (function fabricate() {
  'use strict';
  const S = window.DesignStudioStages;
  const API = '/api/design-studio'; const CAD = '/api/cad-studio'; const PRINT = '/api/scan-to-print/service';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

  async function http(url, opts) {
    const o = opts || {};
    const res = await fetch(url, { method: o.method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: o.json ? { 'Content-Type': 'application/json' } : {}, body: o.form ? o.form : o.json ? JSON.stringify(o.json) : undefined });
    if (o.blob) { if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.status = res.status; throw err; } return res.blob(); }
    const text = await res.text(); let out = null; try { out = text ? JSON.parse(text) : null; } catch (_) { out = { raw: text }; }
    if (!res.ok) { const b = out && out.build; const err = new Error((out && (out.message || out.reason || (b && (b.reason || b.error)) || out.error)) || `HTTP ${res.status}`); err.status = res.status; err.body = out; throw err; }
    return out;
  }
  const hasProgram = (p) => !!(p && p.cad && p.cad.base && Array.isArray(p.cad.features));
  const row = (p, program) => ({ id: p.id, name: p.name, qty: p.qty, material: p.material, printNotes: p.printNotes, option: p.option, link: p.link, massEachG: p.massEachG, orientation: p.orientation, layerHeightMm: p.layerHeightMm, supports: p.supports, program });

  /**
   * @description The parts a set is made from: the bound Design phase's, whichever engine owns it.
   * @param {object} E The engine reads. @param {object} binding The design binding. @returns {object|null} The set input, each part with its program or model.
   */
  function partsOf(E, binding) {
    if (E.reads.design && E.reads.design.ok) {
      const d = E.reads.design.body;
      const printed = Array.isArray(d.printed) ? d.printed : [];
      const bought = (Array.isArray(d.bought) ? d.bought : []).map((b) => ({ id: b.id, name: b.name, qty: b.qty, massEachG: b.massEachG, approxUsdEach: b.approxUsdEach, role: b.role, source: b.source }));
      return { engine: 'embodied', designRevision: S.revisionOf(d), designRoute: E.reads.designUrl, bought, parts: printed.map((p) => ({ row: row(p, hasProgram(p)), program: hasProgram(p) ? p.cad : null, model: null })) };
    }
    const ids = binding && binding.artifact && Array.isArray(binding.artifact.modelIds) ? binding.artifact.modelIds : [];
    if (E.reads.models && E.reads.models.ok && ids.length) {
      const models = (E.reads.models.body.models || []).filter((m) => ids.includes(m.model_id));
      return { engine: 'cad-studio', designRevision: models.map((m) => `${m.model_id.slice(0, 8)}@r${m.revision}`).join('+'), designRoute: E.reads.models.url, bought: [], parts: models.map((m) => ({ row: row({ id: m.model_id, name: m.title, qty: 1 }, m.state === 'built'), program: null, model: m })) };
    }
    return null;
  }

  /** The person's CAD Studio part for an embodied program: found by its source tag and program hash, or created and built now. */
  async function ensureCadModel(project, part, models) {
    const programSha = S.revisionOf(part.program);
    const found = models.find((m) => m.source && m.source.designStudio && m.source.designStudio.project === project.id && m.source.designStudio.part === part.row.id && m.source.designStudio.programSha === programSha);
    if (found && found.state === 'built' && found.revision > 0) return found;
    const out = await http(`${CAD}/models`, { method: 'POST', json: { title: `${project.name} · ${part.row.name}`.slice(0, 200), base: part.program.base, features: part.program.features, source: { designStudio: { project: project.id, part: part.row.id, programSha } } } });
    if (!out || !out.model || !(out.build && out.build.ok)) throw new Error(`CAD Studio did not build it: ${out && out.build ? (out.build.reason || out.build.error || out.build.code) : 'no model in the reply'}`);
    models.push(out.model);
    return out.model;
  }

  /** Read a built model's STL and report from CAD Studio and post them to this package's set. */
  async function exportPart(project, part, model) {
    const url = model.artifacts && model.artifacts.stl ? model.artifacts.stl : `${CAD}/models/${encodeURIComponent(model.model_id)}/artifacts/stl?revision=${model.revision}`;
    const stl = await http(url, { blob: true });
    const r = model.report || {};
    const form = new FormData();
    form.append('stl', stl, `${part.row.id}.stl`);
    form.append('meta', JSON.stringify({ source: { engine: 'cad-studio', modelId: model.model_id, revision: model.revision, route: url, title: model.title }, report: { valid: r.valid === true, massG: r.massG, volumeMm3: r.volumeMm3, extentsMm: r.extentsMm, densityGcm3: r.densityGcm3, engineBuild: model.engine_build || null } }));
    return http(`${API}/projects/${encodeURIComponent(project.id)}/print-set/parts/${encodeURIComponent(part.row.id)}`, { method: 'PUT', form });
  }

  /** Record why one part is not in the set. */
  function unprintable(project, part, reason) {
    return http(`${API}/projects/${encodeURIComponent(project.id)}/print-set/parts/${encodeURIComponent(part.row.id)}`, { method: 'PUT', json: { reason } });
  }

  /** One part, end to end; the outcome line goes to the progress list. */
  async function onePart(project, part, models, cadAbsent, progress) {
    if (!part.row.program) { await unprintable(project, part, part.model ? `not built in CAD Studio (state ${part.model.state})` : 'no CAD program in the design for this part'); progress(part, 'unprintable', part.model ? `not built in CAD Studio (${part.model.state})` : 'no CAD program in the design'); return; }
    if (cadAbsent) { await unprintable(project, part, cadAbsent); progress(part, 'unprintable', cadAbsent); return; }
    try {
      progress(part, 'building', part.model ? 'reading the built part from CAD Studio' : 'building through CAD Studio');
      const model = part.model || await ensureCadModel(project, part, models);
      const out = await exportPart(project, part, model);
      const p = out.part;
      progress(part, p.status, p.status === 'exported' ? `exported · ${p.triangles} triangles · ${p.extentsMm ? p.extentsMm.join(' × ') + ' mm' : ''} · ${p.kernelMassEachG === null ? '' : p.kernelMassEachG + ' g by the kernel'} · watertight` : p.reason);
    } catch (e) {
      const reason = `CAD Studio: ${e.message}`;
      await unprintable(project, part, reason.slice(0, 400));
      progress(part, 'unprintable', reason);
    }
  }

  /**
   * @description Make the print set for a product: begin it from the design's rows, run every part, finish it.
   * @param {object} o {project, E, binding, progress(part, state, line)}. @returns {Promise<object>} The finished listing.
   */
  async function makePrintSet(o) {
    const set = partsOf(o.E, o.binding);
    if (!set) throw new Error('no design is bound to this product, so there is nothing to print');
    const begin = await http(`${API}/projects/${encodeURIComponent(o.project.id)}/print-set`, { method: 'POST', json: { engine: set.engine, designRevision: set.designRevision, designRoute: set.designRoute, parts: set.parts.map((p) => p.row), bought: set.bought } });
    let models = []; let cadAbsent = null;
    if (set.parts.some((p) => p.row.program)) {
      const r = await S.read(`${CAD}/models`);
      if (r.ok) models = Array.isArray(r.body.models) ? r.body.models : [];
      else cadAbsent = `CAD Studio is not on this swarm or refused this account (${S.absence(r, 'cad-studio').line})`;
    }
    for (const part of set.parts) await onePart(o.project, part, models, cadAbsent, o.progress);
    const done = await http(`${API}/projects/${encodeURIComponent(o.project.id)}/print-set/finish`, { method: 'POST', json: {} });
    return { begun: begin, listing: done };
  }

  /**
   * @description Send one file of the finished set to the chosen printer through the print service, then record the reply beside the set.
   * @param {object} o {project, file, printer:{printerId,label}}. @returns {Promise<object>} The service's reply.
   */
  async function sendToPrinter(o) {
    const blob = await http(`${API}/projects/${encodeURIComponent(o.project.id)}/print-set/${encodeURIComponent(o.file)}`, { blob: true });
    const form = new FormData();
    form.append('model', blob, `${String(o.project.name).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40) || 'product'}-${o.file}`);
    form.append('printerId', o.printer.printerId);
    let reply; let failed = null;
    try { reply = await http(`${PRINT}/print`, { method: 'POST', form }); } catch (e) { failed = e; reply = e.body || {}; }
    const outcome = reply.outcome || {};
    const sub = reply.submission && typeof reply.submission === 'object' ? (reply.submission.submission_id || reply.submission.id || null) : null;
    await http(`${API}/projects/${encodeURIComponent(o.project.id)}/print-set/sent`, { method: 'POST', json: { file: o.file, printerId: o.printer.printerId, printerLabel: (reply.printer && reply.printer.label) || o.printer.label || null, submissionId: sub ? String(sub) : null, uploaded: outcome.uploaded === true, started: outcome.started === true, message: outcome.message || reply.message || (failed ? failed.message : null) } });
    if (failed) throw failed;
    return reply;
  }

  // ── Dialogs ──
  function openMakeDialog(set, onClose) {
    const list = $('make-steps'); list.textContent = ''; $('make-result').textContent = '';
    $('make-what').textContent = set ? `${set.parts.length} printed part${set.parts.length === 1 ? '' : 's'} from ${set.engine === 'embodied' ? 'the design' : 'the bound CAD Studio parts'} at revision ${set.designRevision}. Each part with a program is built through CAD Studio once and its STL checked watertight here; a part without one is listed unprintable.` : 'No design is bound to this product.';
    for (const p of (set ? set.parts : [])) { const li = el('li', 'make-part'); li.dataset.part = p.row.id; li.dataset.state = p.row.program ? 'pending' : 'unprintable'; li.append(el('b', null, p.row.name), el('span', 'when', p.row.program ? 'waiting' : 'no program')); list.append(li); }
    $('make-close').disabled = true;
    const dialog = $('make-dialog');
    const done = () => { dialog.removeEventListener('close', done); onClose(); };
    dialog.addEventListener('close', done);
    if (!dialog.open) dialog.showModal();
    return (part, state, line) => { const li = list.querySelector(`li[data-part="${CSS.escape(part.row.id)}"]`); if (!li) return; li.dataset.state = state; li.querySelector('.when').textContent = line; };
  }
  function finishMakeDialog(listing, error) {
    $('make-result').textContent = error ? `The set could not be finished: ${error}` : `${listing.exported} of ${listing.parts} parts exported watertight · manifest sha256 ${listing.manifestSha256}${listing.unprintable.length ? ` · ${listing.unprintable.length} unprintable: ${listing.unprintable.map((u) => `${u.name} (${u.reason})`).join('; ')}` : ''}`;
    $('make-result').dataset.sha = listing ? listing.manifestSha256 : '';
    $('make-close').disabled = false;
  }
  function openSendDialog(set, printer) {
    const sel = $('send-file'); sel.textContent = '';
    for (const f of set.manifest.files.filter((x) => x.kind === 'stl')) { const o = document.createElement('option'); o.value = f.file; o.textContent = `${f.file} (${Math.round(f.bytes / 1024)} KB)`; sel.append(o); }
    $('send-what').textContent = `One file at a time to ${printer.label || printer.printerId} (${printer.kind || 'printer'}${printer.autoStart ? ', auto-start on' : ', auto-start off: the file waits on the printer for you to start it'}) through the print service, the way print-to-3d-printer sends a scan job. It asks first, as that tool does.`;
    $('send-plate').checked = false;
    return new Promise((resolve) => { const d = $('send-dialog'); const onClose = () => { d.removeEventListener('close', onClose); resolve(d.returnValue === 'send' && $('send-plate').checked ? sel.value : null); }; d.addEventListener('close', onClose); d.showModal(); });
  }

  return { partsOf, makePrintSet, sendToPrinter, openMakeDialog, finishMakeDialog, openSendDialog, ensureCadModel };
}());
