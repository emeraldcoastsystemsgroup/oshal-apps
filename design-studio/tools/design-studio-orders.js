/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D3 as built (0.4.0): runs the design partner's engine orders from the open page with the person's own session. A package route reaches no sibling package; this page does, through the fixed routes below. An order names an action and ids, never a URL. Each result is the engine's own reply; a refusal goes back in the engine's words.
 */
window.DesignStudioOrders = (function orders() {
  'use strict';
  const API = '/api/design-studio'; const CAD = '/api/cad-studio'; const LAB = '/api/circuit-lab'; const EMB = '/api/embodied'; const PRINT = '/api/scan-to-print/service';
  const POLL_MS = 2500;
  const seg = encodeURIComponent;
  /** The id a mechanism names this part by: its name in lower case with dashes. */
  const slug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'part';

  /** Every engine read an order may name. The route file validates `what` and the id's shape first. */
  const READS = {
    'cad-contract': () => `${CAD}/capabilities`, 'cad-models': () => `${CAD}/models`, 'cad-model': (i) => `${CAD}/models/${seg(i.modelId)}`,
    'circuit-contract': () => `${LAB}/capabilities`, 'circuit-examples': () => `${LAB}/examples`, 'circuit-drivers': () => `${LAB}/catalog/drivers`, 'circuit-designs': () => `${LAB}/designs`, 'circuit-design': (i) => `${LAB}/designs/${seg(i.designId)}`,
    'motor-catalog': () => `${EMB}/build/catalog`, 'physics-status': () => `${EMB}/physics/status`, 'physics-reports': () => `${EMB}/physics/reports`, printers: () => `${PRINT}/printers`,
  };

  async function call(method, url, json) {
    const res = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', headers: json === undefined ? {} : { 'Content-Type': 'application/json' }, body: json === undefined ? undefined : JSON.stringify(json) });
    const text = await res.text(); let body = null; try { body = text ? JSON.parse(text) : null; } catch (_) { body = { raw: text.slice(0, 2000) }; }
    return { ok: res.ok, status: res.status, body };
  }
  const refused = (route, r) => ({ ok: false, result: { route, status: r.status, refused: r.status === 404 ? 'this engine is not installed on this swarm, or the record is not there' : r.status === 401 || r.status === 403 ? 'this person is not granted that engine' : undefined, engine: r.body } });
  const modelSummary = (m, build) => ({ modelId: m.model_id, title: m.title, revision: m.revision, state: m.state, report: m.report || null, features: (m.features || []).map((f) => ({ id: f.id, type: f.type, ok: f.status ? f.status.ok : undefined, reason: f.status ? f.status.reason : undefined })), build: build || null });
  const designSummary = (d, out) => ({ designId: d.design_id, title: d.title, runs: d.run_count, state: d.state, parts: (d.parts || []).length, wires: (d.wires || []).length, report: (out && out.report) || d.report || null, build: (out && out.build) || null });

  /** Add a built part to the product's Design phase; a design the embodied parts model owns keeps its own binding. */
  async function bindPart(host, model, partId) {
    const project = host.project(); const binding = host.bindings().design; const artifact = binding ? binding.artifact : {};
    if (artifact.engine === 'embodied') return { bound: false, why: 'this product\'s design is embodied\'s parts model' };
    if (!project.phases.some((p) => p.kind === 'design')) return { bound: false, why: 'this product has no Design phase' };
    const ids = Array.isArray(artifact.modelIds) ? artifact.modelIds : [];
    const named = Array.isArray(artifact.models) ? artifact.models : [];
    const next = { ...artifact, engine: 'cad-studio', kind: 'cad-models', modelIds: ids.includes(model.model_id) ? ids : [...ids, model.model_id], models: [...named.filter((m) => m.modelId !== model.model_id), { partId, modelId: model.model_id }] };
    const r = await call('POST', `${API}/projects/${seg(project.id)}/bind`, { phase: 'design', artifact: next });
    return r.ok ? { bound: true, partId, modelIds: next.modelIds } : { bound: false, why: (r.body && r.body.message) || `HTTP ${r.status}` };
  }

  async function cadCreate(host, i) {
    const project = host.project();
    const route = `${CAD}/models`;
    const r = await call('POST', route, { title: `${project.name} · ${i.name}`.slice(0, 200), base: i.base, features: i.features, source: { designStudio: { project: project.id, part: slug(i.name) } } });
    if (!r.ok) return refused(route, r);
    const model = r.body.model; const built = !!(r.body.build && r.body.build.ok);
    return { ok: built, result: { ...modelSummary(model, r.body.build), design: built ? await bindPart(host, model, slug(i.name)) : { bound: false, why: 'the kernel did not build it' } } };
  }
  async function cadEdit(i) {
    const base = `${CAD}/models/${seg(i.modelId)}/features`;
    const r = i.op === 'add' ? await call('POST', base, i.feature) : i.op === 'update' ? await call('PATCH', `${base}/${seg(i.featureId)}`, i.feature) : await call('DELETE', `${base}/${seg(i.featureId)}`);
    if (!r.ok) return refused(base, r);
    return { ok: !(r.body.build && r.body.build.ok === false), result: modelSummary(r.body.model || {}, r.body.build) };
  }
  async function circuitCreate(host, i) {
    const project = host.project(); const route = `${LAB}/designs`;
    const r = await call('POST', route, i.example ? { example: i.example, title: i.title || `${project.name} power`, run: true } : { title: i.title, parts: i.parts, wires: i.wires, run: true });
    if (!r.ok) return refused(route, r);
    const id = r.body.design && r.body.design.design_id;
    const bound = project.phases.some((p) => p.kind === 'electrical') ? await call('POST', `${API}/projects/${seg(project.id)}/bind`, { phase: 'electrical', artifact: { engine: 'circuit-lab', kind: 'circuit-design', designId: id, example: i.example || undefined } }) : { ok: false };
    return { ok: true, result: { ...designSummary(r.body.design, r.body), electricalBound: bound.ok } };
  }
  async function circuitEdit(i) {
    const base = `${LAB}/designs/${seg(i.designId)}`;
    const routes = { add_part: ['POST', `${base}/parts`], update_part: ['PATCH', `${base}/parts/${seg(i.partId)}`], remove_part: ['DELETE', `${base}/parts/${seg(i.partId)}`], connect: ['POST', `${base}/wires`], disconnect: ['DELETE', `${base}/wires/${seg(i.wireId)}`], run: ['POST', `${base}/run`] };
    const [method, url] = routes[i.op];
    const r = await call(method, url, i.op === 'run' ? {} : i.op.endsWith('part') && i.op !== 'remove_part' || i.op === 'connect' ? { ...i.body, run: true } : { run: true });
    if (!r.ok) return refused(url, r);
    return { ok: true, result: designSummary(r.body.design || {}, r.body) };
  }
  /** Press the poster's own button through the same handler a click reaches; the reply is the poster after it. */
  async function press(host, i) {
    await host.refresh(); // the poster as the engine answers now, not as the page last read it
    const row = host.rows().find((r) => r.entry.kind === i.phase);
    if (!row) return { ok: false, result: { refused: `${i.phase} is not in this product's chain` } };
    const acts = [row.view.action, row.view.secondary].filter(Boolean);
    const act = acts.find((a) => a.label === i.button && !a.disabled);
    if (!act) return { ok: false, result: { refused: `the ${i.phase} poster has no ${i.button} button now`, stage: row.view.stage, line: row.view.line, buttons: acts.map((a) => a.label) } };
    const said = await host.press(row, act);
    const after = host.rows().find((r) => r.entry.kind === i.phase);
    return { ok: !(said && said.kind === 'error'), result: { phase: i.phase, pressed: i.button, said: said ? said.text : null, stage: after.view.stage, line: after.view.line, figure: after.view.figure, buttonNow: after.view.action ? after.view.action.label : null } };
  }

  async function run(host, order) {
    const i = order.input;
    if (order.action === 'read') { const route = READS[i.what](i); const r = await call('GET', route); return r.ok ? { ok: true, result: { route, reply: r.body } } : refused(route, r); }
    if (order.action === 'cad-create') return cadCreate(host, i);
    if (order.action === 'cad-edit') return cadEdit(i);
    if (order.action === 'circuit-create') return circuitCreate(host, i);
    if (order.action === 'circuit-edit') return circuitEdit(i);
    if (order.action === 'press') return press(host, i);
    if (order.action === 'open') { await host.refresh(); const row = host.project(); return { ok: true, result: { opened: row.name, posters: host.rows().map((r) => ({ phase: r.entry.kind, stage: r.view.stage, line: r.view.line, button: r.view.action ? r.view.action.label : null })) } }; }
    return { ok: false, result: { refused: `this page does not know ${order.action}` } };
  }

  /**
   * @description Start running orders while this page is open and visible.
   * @param {object} host {project(), bindings(), rows(), openProduct(id), refresh(), press(row, act), say(text, kind)}.
   * @returns {Function} Runs one pass; the tests call it directly.
   */
  function start(host) {
    let busy = false;
    async function pass() {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const list = await call('GET', `${API}/orders/pending`);
        const order = list.ok && list.body.orders && list.body.orders[0];
        if (!order) return;
        const claim = await call('POST', `${API}/orders/${seg(order.id)}/claim`, {});
        if (!claim.ok) return;
        let out;
        try {
          await host.openProduct(order.project_id);
          host.say(`The design partner: ${order.action === 'press' ? order.input.button : order.action === 'read' ? `reading ${order.input.what}` : order.action}…`, 'info');
          out = await run(host, order);
        } catch (e) { out = { ok: false, result: { refused: e.message } }; }
        await call('POST', `${API}/orders/${seg(order.id)}/finish`, out);
        await host.refresh();
        host.say(out.ok ? 'The design partner\'s order ran.' : 'The design partner\'s order was refused; the partner has the reason.', out.ok ? 'ok' : 'error');
      } catch (e) { host.say(`Design partner order: ${e.message}`, 'error'); }
      finally { busy = false; }
    }
    setInterval(() => { void pass(); }, POLL_MS);
    return pass;
  }
  return { start, READS };
}());
