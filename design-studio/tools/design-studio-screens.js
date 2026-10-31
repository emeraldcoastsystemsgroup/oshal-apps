/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D4, lane @ds-app: the four screens' rendering. Products as
 *                     |                             | posters (the whole poster opens the product; the screen's one
 *                     |                             | button is New product), the New product walkthrough's proposal
 *                     |                             | list and brief collection, the Product screen's phase posters
 *                     |                             | (stage, figure, closure line, one button each), the Settings
 *                     |                             | screen (engines per phase, printer, bound artifacts) and
 *                     |                             | the dialogs (close a phase, the build checklist, record the
 *                     |                             | print set). Everything renders with createElement/textContent;
 *                     |                             | nothing here reads an engine or writes a row.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D7, lane @ds-fab: the Fabricate poster closes like every
 *                     |                             | other phase once its set meets the bar, carries a second, plain
 *                     |                             | button only when the view offers one (Send to printer, with a
 *                     |                             | finished set and a chosen printer) and lists the set's files as
 *                     |                             | links; the record-the-manifest dialog is gone, the set is made.
 */
window.DesignStudioScreens = (function screens() {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs, text) => { const n = document.createElement(tag); if (attrs) for (const [k, v] of Object.entries(attrs)) { if (v === undefined || v === null || v === false) continue; if (k === 'class') n.className = v; else if (k === 'dataset') Object.assign(n.dataset, v); else n.setAttribute(k, v === true ? '' : String(v)); } if (text !== undefined) n.textContent = text; return n; };
  const when = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleString() : String(iso); };
  const TITLES = { brief: 'Brief', design: 'Design', mechanical: 'Mechanical spec', electrical: 'Electrical and power', sensors: 'Sensors', controller: 'Controller', simulate: 'Simulate and train', fabricate: 'Fabricate', build: 'Build and test' };

  // ── Products: posters, the whole poster opens the product ──
  function renderProducts(host, projects) {
    host.textContent = '';
    if (!projects.length) { host.append(el('p', { class: 'empty wide', id: 'products-empty' }, 'No products yet. Press New product: the walkthrough writes the brief and proposes the phase chain; the design partner on the rail works through it with you.')); return; }
    projects.forEach((p, i) => {
      const a = el('a', { class: 'poster', href: `#/product/${encodeURIComponent(p.id)}`, dataset: { product: p.id } });
      a.append(el('p', { class: 'step' }, `${i + 1} · product`), el('h2', null, p.name));
      const fig = el('p', { class: 'figure' }); fig.append(el('span', null, `${p.closedPhases}/${p.phases.length}`), el('small', null, 'phases closed'));
      a.append(fig, el('p', { class: 'stage' }, `${p.brief && p.brief.what ? p.brief.what : 'no brief'} · ${p.phases.map((x) => x.kind).join(' → ')}`), el('p', { class: 'closed' }, `changed ${when(p.updated_at)}`));
      host.append(a);
    });
  }

  // ── New product: the proposal list and the brief the form says ──
  function renderProposal(list, proposal, keep) {
    list.textContent = '';
    for (const ph of proposal.phases) {
      const li = el('li', { dataset: { kind: ph.kind } });
      const cb = el('input', { type: 'checkbox', id: `phase-${ph.kind}`, checked: keep ? keep.has(ph.kind) : true, disabled: ph.kind === 'brief' || ph.kind === 'build' || undefined });
      const label = el('label', { for: `phase-${ph.kind}` });
      label.append(el('b', null, TITLES[ph.kind] || ph.kind), el('span', { class: 'engine' }, ph.engine), el('span', { class: 'why' }, ph.why || ''));
      li.append(cb, label); list.append(li);
    }
    for (const line of proposal.unsolved || []) list.append(el('li', { class: 'unsolved' }, line));
  }
  function collectBrief() {
    const num = (id) => { const v = $(id).value.trim(); return v === '' ? undefined : Number(v); };
    const targets = { massG: num('new-mass'), sizeMm: $('new-size').value.trim() || undefined, costUsd: num('new-cost'), runtimeMin: num('new-runtime') };
    return { name: $('new-name').value.trim(), brief: { what: $('new-what').value.trim(), requirements: $('new-requirements').value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), targets } };
  }
  function collectProposal(list, proposal) {
    const kept = new Set([...list.querySelectorAll('li[data-kind] input:checked')].map((cb) => cb.closest('li').dataset.kind));
    return proposal.phases.filter((p) => kept.has(p.kind)).map((p) => ({ kind: p.kind, engine: p.engine, why: p.why }));
  }
  function fillBrief(project) {
    $('new-name').value = project.name; $('new-what').value = project.brief.what || ''; $('new-requirements').value = (project.brief.requirements || []).join('\n');
    const t = project.brief.targets || {};
    $('new-mass').value = t.massG === undefined ? '' : t.massG; $('new-size').value = t.sizeMm || ''; $('new-cost').value = t.costUsd === undefined ? '' : t.costUsd; $('new-runtime').value = t.runtimeMin === undefined ? '' : t.runtimeMin;
  }

  // ── Product: one poster per phase, one button each ──
  function actionButton(entry, view, closure, onAction) {
    const act = view.action || { label: 'Close the phase', close: true };
    const closeable = view.met && !(closure && !closure.stale) && entry.kind !== 'build';
    if (entry.kind === 'brief' && closure && !closure.stale) return Object.assign(el('button', { type: 'button', class: 'btn btn-primary', id: `act-${entry.kind}` }, 'Edit the brief'), { onclick: () => onAction(entry, view, { edit: true }) });
    if (closeable && !act.brief) return Object.assign(el('button', { type: 'button', class: 'btn btn-primary', id: `act-${entry.kind}` }, 'Close the phase'), { onclick: () => onAction(entry, view, { close: true }) });
    if (act.href && !act.top) return el('a', { class: 'btn btn-primary', id: `act-${entry.kind}`, href: act.href, target: '_blank', rel: 'noopener' }, act.label);
    const b = el('button', { type: 'button', class: 'btn btn-primary', id: `act-${entry.kind}`, disabled: act.disabled || undefined }, act.label);
    b.onclick = () => onAction(entry, view, act);
    return b;
  }
  /** The files of a made set, as links the person downloads. */
  function filesList(entry, files) {
    const d = el('details', { class: 'files', id: `${entry.kind}-files` });
    d.append(el('summary', null, `${files.length} file${files.length === 1 ? '' : 's'}`));
    const ul = el('ul');
    for (const f of files) { const li = el('li'); li.append(el('a', { href: f.href, target: '_blank', rel: 'noopener', dataset: { kind: f.kind } }, f.file)); ul.append(li); }
    d.append(ul);
    return d;
  }
  function closureLine(closure) {
    if (!closure) return el('p', { class: 'closed' }, 'open');
    return el('p', { class: `closed${closure.stale ? ' stale' : ''}` }, `${closure.stale ? 'stale · closed' : 'closed'} ${when(closure.closed_at)} by ${closure.closed_by} at ${closure.revision}${closure.stale ? ' · the artifact has moved on; close it again' : ''}`);
  }
  function renderProduct(host, project, rows, onAction) {
    host.textContent = '';
    rows.forEach(({ entry, view, closure }, i) => {
      const poster = el('article', { class: `poster${entry.kind === 'build' ? ' wide' : ''}`, id: `poster-${entry.kind}`, dataset: { stage: view.stage || '', engine: entry.engine, closed: closure && !closure.stale ? '1' : '0' } });
      poster.append(el('p', { class: 'step' }, `${i + 1} · ${TITLES[entry.kind] || entry.kind} · ${entry.engine}`), el('h2', null, TITLES[entry.kind] || entry.kind));
      const fig = el('p', { class: 'figure' }); fig.append(el('span', { id: `${entry.kind}-figure` }, view.figure ? view.figure[0] : '—'), el('small', { id: `${entry.kind}-sub` }, view.figure ? view.figure[1] : ''));
      poster.append(fig, el('p', { class: `stage ${view.tone || ''}`, id: `${entry.kind}-stage`, role: 'status' }, view.line || ''), closureLine(closure));
      const act = el('div', { class: 'act' }); act.append(actionButton(entry, view, closure, onAction));
      if (view.secondary) { const b = el('button', { type: 'button', class: 'btn', id: `act2-${entry.kind}` }, view.secondary.label); b.onclick = () => onAction(entry, view, view.secondary); act.append(b); }
      if (Array.isArray(view.files) && view.files.length) poster.append(filesList(entry, view.files));
      poster.append(act);
      host.append(poster);
    });
  }

  // ── Settings: engines, printer, bound artifacts ──
  function engineOptions(brief, present) {
    return brief.engines.map((e) => ({ value: e, label: e === 'reasoned' ? 'reasoned (no engine)' : `${e}${present[e] === false ? ' — absent on this swarm' : ''}` }));
  }
  function renderEngineRows(card, project, caps, present) {
    card.querySelectorAll('.row').forEach((r) => r.remove());
    for (const entry of project.phases) {
      const brief = caps.briefs[entry.kind];
      const row = el('div', { class: 'row', dataset: { kind: entry.kind } });
      const sel = el('select', { id: `engine-${entry.kind}` });
      for (const o of engineOptions(brief, present)) sel.append(el('option', { value: o.value, selected: o.value === entry.engine || undefined }, o.label));
      row.append(el('span', { class: 'kind' }, TITLES[entry.kind] || entry.kind), sel, el('span', { class: 'note' }, `${brief.produces} · closes when ${brief.closes}`));
      card.append(row);
    }
  }
  function renderPrinters(printersRead, entry) {
    const sel = $('set-printer'); sel.textContent = '';
    const help = $('printer-help');
    if (!printersRead || !printersRead.ok) { sel.append(el('option', { value: '' }, printersRead && printersRead.status !== 404 && printersRead.status !== 0 ? `print service: ${printersRead.error}` : 'no print service on this swarm')); sel.disabled = true; help.textContent = 'The print service (scan-to-print) registers printers; absent, the Fabricate phase makes the print set and you load the files into your own slicer.'; return; }
    sel.disabled = false; sel.append(el('option', { value: '' }, 'none chosen'));
    const printers = Array.isArray(printersRead.body.printers) ? printersRead.body.printers : [];
    for (const p of printers) { const id = p.printer_id || p.id; sel.append(el('option', { value: id, selected: entry && entry.printerId === id || undefined }, `${p.label || id} (${p.kind || 'printer'}${p.autoStart ? ', auto-start' : ''})`)); }
    help.textContent = printers.length ? 'Send to printer on the Fabricate poster sends one file of the made set to this printer through the print service, after you confirm; a print starts only when the printer\'s owner turned its auto-start on.' : 'No printer is registered with the print service yet.';
  }
  function bindingCard(kind, binding, options) {
    const card = el('div', { class: 'row', dataset: { bind: kind } });
    card.append(el('span', { class: 'kind' }, TITLES[kind] || kind));
    const a = binding && binding.artifact;
    if (options) { const sel = el('select', { id: `bind-${kind}`, multiple: options.multiple || undefined, size: options.multiple ? Math.min(6, Math.max(2, options.items.length)) : undefined }); if (!options.multiple) sel.append(el('option', { value: '' }, 'none')); for (const o of options.items) sel.append(el('option', { value: o.value, selected: o.selected || undefined }, o.label)); card.append(sel); }
    else card.append(el('span', null, a ? `${a.engine} · ${a.kind}${a.fit ? ` · ${a.fit}` : ''}${a.example ? ` · ${a.example}` : ''}${a.designId ? ` · ${a.designId}` : ''}${a.certificate ? ` · ${a.certificate}` : ''}` : 'nothing bound'));
    card.append(el('span', { class: 'note' }, a ? `revision ${binding.revision}, bound ${when(binding.bound_at)}${a.read ? ` · read ${when(a.read.readAt)}` : ' · not read yet'}` : 'the design partner binds through design-bind-artifact; the Product page binds on Close the phase'));
    return card;
  }
  function renderBindings(host, project, bindings, E) {
    host.textContent = '';
    for (const entry of project.phases) {
      if (entry.kind === 'brief' || entry.kind === 'build') continue;
      let options = null;
      if (entry.kind === 'design' && entry.engine === 'cad-studio' && E.reads.models && E.reads.models.ok) {
        const chosen = new Set((bindings.design && bindings.design.artifact.modelIds) || []);
        options = { multiple: true, items: (E.reads.models.body.models || []).map((m) => ({ value: m.model_id, label: `${m.title} (r${m.revision}, ${m.state})`, selected: chosen.has(m.model_id) })) };
      }
      if (entry.kind === 'electrical' && entry.engine === 'circuit-lab' && E.reads.circuits && E.reads.circuits.ok) {
        const chosen = bindings.electrical && bindings.electrical.artifact.designId;
        options = { multiple: false, items: (E.reads.circuits.body.designs || []).map((d) => ({ value: d.design_id, label: `${d.title} (${d.run_count ? `run ${d.run_count}` : 'not solved'})`, selected: chosen === d.design_id })) };
      }
      host.append(bindingCard(entry.kind, bindings[entry.kind] || null, options));
    }
  }
  function renderSettings(project, bindings, caps, E, present) {
    renderEngineRows($('settings-engines'), project, caps, present);
    const fab = project.phases.find((p) => p.kind === 'fabricate');
    $('settings-printer').hidden = !fab;
    if (fab) renderPrinters(E.reads.printers, fab);
    renderBindings($('bindings-list'), project, bindings, E);
  }
  function collectSettings(project) {
    const phases = project.phases.map((p) => {
      const next = { ...p, engine: $(`engine-${p.kind}`) ? $(`engine-${p.kind}`).value : p.engine };
      if (p.kind === 'fabricate') { const v = $('set-printer').disabled ? '' : $('set-printer').value; if (v) next.printerId = v; else delete next.printerId; }
      return next;
    });
    const binds = [];
    const cad = $('bind-design'); if (cad) { const ids = [...cad.selectedOptions].map((o) => o.value); binds.push({ phase: 'design', artifact: { engine: 'cad-studio', kind: 'cad-models', modelIds: ids } }); }
    const circuit = $('bind-electrical'); if (circuit && circuit.value) binds.push({ phase: 'electrical', artifact: { engine: 'circuit-lab', kind: 'circuit-design', designId: circuit.value } });
    return { phases, binds };
  }

  // ── Dialogs ──
  function dialogResult(dialog, form, read) {
    return new Promise((resolve) => {
      const onClose = () => { dialog.removeEventListener('close', onClose); resolve(dialog.returnValue === 'close' ? read() : null); };
      dialog.addEventListener('close', onClose);
      dialog.showModal();
    });
  }
  function openCloseDialog(entry, view) {
    const typed = !!(view.action && view.action.typed) || !view.evidence;
    $('close-title').textContent = entry.kind === 'brief' ? 'Confirm the brief' : `Close the ${TITLES[entry.kind] || entry.kind} phase`;
    $('close-what').textContent = typed ? 'No engine on this swarm measured this phase: write what closes it, in your own words, and name what it was read from.' : `The engine's evidence line as read now, with the revision it was read at. ${view.line}`;
    $('close-evidence').value = view.evidence || ''; $('close-evidence').readOnly = !typed;
    $('close-revision').value = view.revision || ''; $('close-revision').readOnly = !typed;
    $('close-help').textContent = typed ? 'What was measured or decided, by whom, with what.' : 'The engine\'s evidence line, in its own numbers.';
    $('close-dialog').querySelector('button[value="close"]').textContent = entry.kind === 'brief' ? 'Confirm the brief' : 'Close the phase';
    return dialogResult($('close-dialog'), $('close-form'), () => ({ evidence: $('close-evidence').value.trim(), revision: $('close-revision').value.trim() }));
  }
  function openBuildDialog(steps, closures, onTick) {
    const list = $('build-steps'); list.textContent = '';
    const ticked = new Map(closures.filter((c) => c.phase === 'build' && c.step).map((c) => [c.step, c]));
    let group = null;
    for (const s of steps) {
      if (s.group !== group) { group = s.group; list.append(el('li', { class: 'group' }, group)); }
      const li = el('li', { dataset: { step: s.id } });
      const done = ticked.get(s.id);
      const cb = el('input', { type: 'checkbox', id: `step-${s.id}`, checked: !!done || undefined, disabled: !!done || undefined });
      const label = el('label', { for: `step-${s.id}` }); label.append(document.createTextNode(s.text));
      if (done) label.append(el('span', { class: 'when' }, `ticked ${when(done.closed_at)} by ${done.closed_by}`));
      cb.addEventListener('change', () => { if (cb.checked) { cb.disabled = true; onTick(s); } });
      li.append(cb, label); list.append(li);
    }
    if (!$('build-dialog').open) $('build-dialog').showModal();
  }

  return { renderProducts, renderProposal, collectBrief, collectProposal, fillBrief, renderProduct, renderSettings, collectSettings, openCloseDialog, openBuildDialog, TITLES };
}());
