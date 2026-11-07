/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S2 — the Explorer tile. It reads the record from
 *                     |                             | /api/ocean-lab/vehicles and computes nothing itself: the stage
 *                     |                             | badge and ladder with the `fabricable` sentence ALWAYS beside
 *                     |                             | them (D6); the stop angle and tether length a person edits,
 *                     |                             | saved as the design vector (the stage drops to concept on the
 *                     |                             | next read); Evaluate in seawater, and in air, where the route's
 *                     |                             | refusal is shown by its own name; the five-row sea-state table,
 *                     |                             | the occurrence-weighted mean, km/day and km/year from the latest
 *                     |                             | evaluation, labelled stale when it was computed at another
 *                     |                             | vector; the open limits; and the runs — a row that lacks its
 *                     |                             | medium id or engine fingerprints is NOT rendered (D5), here as
 *                     |                             | on the server. "Record a hull drop" fetches embodied's own route
 *                     |                             | and posts the result to this record AS DATA.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S3 — the parts section, read from GET /:id/parts after
 *                     |                             | every render: the watertight parts with their programs, masses
 *                     |                             | and displaced volumes, each with "Open in CAD Studio" (fetch the
 *                     |                             | part's exact body from GET /:id/parts/:partId, POST it to
 *                     |                             | /api/cad-studio/models and land on the CAD Studio tile, the
 *                     |                             | embodied B16 hand-off); the bought rows with a missing mass or
 *                     |                             | price shown as NOT PUBLISHED, never as zero; the displacement
 *                     |                             | budget badge and why; what keeps the model from complete; and
 *                     |                             | the design document link.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | "Delete this explorer": after the person confirms, DELETE
 *                     |                             | /api/ocean-lab/vehicles/:id (owner-scoped on the server, 204)
 *                     |                             | and back to the create card. Live 2026-10-11 the route existed
 *                     |                             | but the tile had no control, so a created explorer could only
 *                     |                             | be removed through the API.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Work side by side with the concierge: the open explorer registers with the
 *                     |                             | shared document handoff. Before an assistant reads, prepare() waits for writes in
 *                     |                             | flight and saves an unsaved stop angle or tether length through the existing PATCH
 *                     |                             | /design, then hands over the vehicle id and its updated time; refresh() re-reads the
 *                     |                             | record and redraws it when it changed. A field the person is still editing survives
 *                     |                             | every redraw and the status line says it is kept.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | UX batch-7 layout & split: withhold Evaluate in air for the wave explorer;
 *                     |                             | split into Design & sea states (?view=design) and Parts & BOM (?view=parts);
 *                     |                             | format STAGE gates as an expandable checklist with counts and plain English
 *                     |                             | labels (no camelCase keys in prose); move Delete into a card-head overflow
 *                     |                             | menu with an in-page confirm dialog; move Open in CAD Studio into a per-part
 *                     |                             | row overflow menu.
 */

/* global window, document, fetch */

(function (global) {
  'use strict';

  var BASE = '/api/ocean-lab/vehicles';
  var HULL_DROP = '/api/embodied/physics/hull?medium=air';
  var SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
  var SHA256 = /^[0-9a-f]{64}$/;
  var state = { kinds: null, record: null, shown: null, writes: [], partsById: {}, view: 'design' };
  var EDITED = [['stop-angle', function (v) { return v.wings.stopAngleDeg; }], ['tether-length', function (v) { return v.tether.lengthM; }]];
  var PROSE_TERMS = [
    ['site.seaStates.occurrence', 'sea-state share'],
    ['site.seaStates.heightM', 'sea-state height'],
    ['site.seaStates.periodS', 'sea-state period'],
    ['site.underWayMinSpeedMs', 'minimum under-way speed'],
    ['wings.stopAngleDeg', 'wing stop angle'],
    ['wings.count', 'wing count'],
    ['wings.spanM', 'wing span'],
    ['wings.chordM', 'wing chord'],
    ['wings.section', 'wing section'],
    ['tether.lengthM', 'tether length'],
    ['tether.diameterM', 'tether diameter'],
    ['float.displacementL', 'float displacement'],
    ['float.diameterM', 'float diameter'],
    ['float.heightM', 'float height'],
    ['sub.netWeightN', 'sub net weight'],
    ['sub.diameterM', 'sub diameter'],
    ['sub.lengthM', 'sub length'],
    ['underWayFraction', 'share under way'],
    ['meanSpeedMs', 'mean speed'],
    ['meanKnots', 'mean knots'],
    ['kmPerYear', 'km/year'],
    ['kmPerDay', 'km/day'],
    ['stopAngleDeg', 'wing stop angle']
  ];

  /** @description The element with an id. @param {string} id Element id. @returns {HTMLElement} The element. */
  function el(id) { return document.getElementById(id); }

  /** @description Escape text for HTML. @param {unknown} v Any value. @returns {string} Safe text. */
  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** @description Replace camelCase and dotted field keys in prose with plain labels. @param {unknown} v Text. @returns {string} Plain text. */
  function humanizeProse(v) {
    var out = String(v === null || v === undefined ? '' : v);
    PROSE_TERMS.forEach(function (pair) { out = out.split(pair[0]).join(pair[1]); });
    return out;
  }

  /** @description A number to fixed places, or a dash. @param {unknown} v Value. @param {number} d Places. @returns {string} Text. */
  function fx(v, d) { return typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '—'; }

  /** @description Say something in the status line. @param {string} text Message. @returns {void} */
  function say(text) { el('status').textContent = text; }

  /** @description JSON over fetch, same origin, never throwing on a status. @param {string} url URL. @param {object} [init] fetch init. @returns {Promise<{status:number, body:any}>} The answer. */
  function call(url, init) {
    var opts = Object.assign({ credentials: 'same-origin', headers: { 'content-type': 'application/json' } }, init || {});
    var answer = fetch(url, opts).then(function (res) {
      return res.text().then(function (text) {
        var body = null;
        try { body = text ? JSON.parse(text) : null; } catch (err) { body = { error: 'not_json', detail: String(err) }; }
        return { status: res.status, body: body };
      });
    });
    if (opts.method && opts.method !== 'GET') {
      var settle = function () { state.writes = state.writes.filter(function (w) { return w !== answer; }); };
      state.writes.push(answer); answer.then(settle, settle);
    }
    return answer;
  }

  /** @description The rule every surface applies before drawing a run (ADR-160 D5). @param {object} run Run row. @returns {string[]} Missing fields. */
  function missingFingerprints(run) {
    var missing = [];
    var fp = (run && run.engineFingerprints) || {};
    if (!run || typeof run.mediumId !== 'string' || !run.mediumId) missing.push('medium.id');
    if (typeof fp.packageVersion !== 'string' || !SEMVER.test(fp.packageVersion)) missing.push('engine.packageVersion');
    if (typeof fp.routesBuildHash !== 'string' || !SHA256.test(fp.routesBuildHash)) missing.push('engine.routesBuildHash');
    return missing;
  }

  /** @description The most recent displayable evaluation, preferring one at the current vector. @param {object} record Full record. @returns {{run: object, current: boolean}|null} Run. */
  function latestEvaluation(record) {
    var plant = state.kinds && state.kinds.evaluationPlant;
    var evals = (record.runs || []).filter(function (r) { return r.plant === plant && missingFingerprints(r).length === 0; });
    if (!evals.length) return null;
    var current = record.stage.currentVectorFingerprint;
    var atCurrent = evals.filter(function (r) { return r.vectorFingerprint === current; });
    var pick = (atCurrent.length ? atCurrent : evals).sort(function (a, b) { return b.sequence - a.sequence; })[0];
    return { run: pick, current: pick.vectorFingerprint === current };
  }

  /** @description Display name for a part slug when parts metadata is loaded. @param {string} id Part slug. @returns {string} Readable part label. */
  function partName(id) {
    var clean = String(id || '').trim();
    var known = state.partsById[clean];
    return known && known !== clean ? known + ' (' + clean + ')' : clean;
  }

  /** @description Split a comma-separated slug list into trimmed entries. @param {string} raw Raw list. @returns {string[]} Slugs. */
  function splitSlugs(raw) {
    return String(raw || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /** @description Parse a stage blocker sentence into a structured checklist gate with count and expandable items. @param {string} raw Blocker text. @returns {{label:string, items:string[], detail:string}} Gate item. */
  function parseGate(raw) {
    var text = String(raw || '');
    var mass = text.match(/(\d+)\s+bought or fabricated row\(s\) carry no mass \(([^)]+)\)/i);
    if (mass) return { label: 'Parts with no mass: ' + mass[1], items: splitSlugs(mass[2]), detail: 'No mass was published in the study.' };
    var price = text.match(/(\d+)\s+bought or fabricated row\(s\) carry no approximate price \(([^)]+)\)/i);
    if (price) return { label: 'Parts with no price: ' + price[1], items: splitSlugs(price[2]), detail: 'Unit prices were omitted in the study.' };
    var body = text.match(/(\d+)\s+row\(s\) are placed on neither[^()]*\(([^)]+)\)/i);
    if (body) return { label: 'Parts on no body: ' + body[1], items: splitSlugs(body[2]), detail: 'No carrier hull or tether was assigned.' };
    var budget = text.match(/the displacement budget is ([A-Za-z]+):\s*(.+)/i);
    if (budget) {
      var groups = budget[2].match(/\(([^)]+)\)/);
      var parts = groups ? groups[1].replace(/no published mass:\s*|placed on no body:\s*/gi, '').replace(/;/g, ',') : '';
      var detail = humanizeProse(budget[2].replace(/\s*\([^)]+\)/, ''));
      return { label: 'Displacement budget: ' + budget[1].toLowerCase(), items: splitSlugs(parts), detail: detail };
    }
    if (/no evaluation at the current design vector/i.test(text)) {
      return { label: 'Seawater evaluation: open', items: [], detail: 'Run Evaluate in seawater for the current design vector.' };
    }
    return { label: humanizeProse(text.replace(/^the parts model is incomplete:\s*/i, '')), items: [], detail: '' };
  }

  /** @description Render one structured gate item for the STAGE checklist. @param {{label:string, items:string[], detail:string}} gate Parsed gate. @returns {string} HTML. */
  function renderGateItem(gate) {
    if (!gate.items.length && !gate.detail) return '<li><div class="gate-static">' + esc(gate.label) + '</div></li>';
    var list = gate.items.length
      ? '<ul class="gate-parts">' + gate.items.map(function (id) { return '<li>' + esc(partName(id)) + '</li>'; }).join('') + '</ul>'
      : '';
    var note = gate.detail ? '<p class="note">' + esc(gate.detail) + '</p>' : '';
    return '<li><details class="gate-item"><summary>' + esc(gate.label) + '</summary><div class="gate-body">' + note + list + '</div></details></li>';
  }

  /** @description Draw the stage badge, ladder, humanized summary, expandable gate checklist, and fabricable notice. @param {object} stage Stage view. @returns {void} */
  function renderStage(stage) {
    el('stage-badge').textContent = stage.stage;
    var stages = (state.kinds && state.kinds.stages) || [];
    el('stage-ladder').innerHTML = stages.map(function (s) {
      return '<li class="' + (stage.reached.indexOf(s) >= 0 ? 'reached' : '') + '">' + esc(s) + '</li>';
    }).join('');
    el('stage-because').textContent = 'Why: ' + humanizeProse(stage.because);
    var blockers = (stage.blockedBy || []).map(parseGate);
    el('stage-blocked').hidden = !stage.next;
    el('stage-blocked').textContent = stage.next ? 'Next stage: ' + stage.next : '';
    el('stage-gates').innerHTML = blockers.map(renderGateItem).join('');
    el('fabricable').textContent = stage.fabricable;
  }

  /** @description The parameter table, each field with its seed provenance tag. @param {object} vector Design vector. @returns {void} */
  function renderVector(vector) {
    var prov = (state.kinds && state.kinds.seed && state.kinds.seed.provenance) || {};
    var rows = [
      ['wings.count', vector.wings.count], ['wings.spanM', vector.wings.spanM + ' m'], ['wings.chordM', vector.wings.chordM + ' m'],
      ['wings.section', vector.wings.section], ['wings.stopAngleDeg', vector.wings.stopAngleDeg + '°'],
      ['tether.lengthM', vector.tether.lengthM + ' m'], ['tether.diameterM', vector.tether.diameterM + ' m'],
      ['float.displacementL', vector.float.displacementL + ' L'], ['sub.netWeightN', vector.sub.netWeightN + ' N']
    ];
    el('vector-table').querySelector('tbody').innerHTML = rows.map(function (r) {
      var p = prov[r[0]];
      return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td><td>' + (p ? '<span class="tag ' + esc(p.source) + '" title="' + esc(p.basis) + '">' + esc(p.source) + '</span>' : '') + '</td></tr>';
    }).join('');
    var kept = drafts();
    EDITED.forEach(function (field) { if (kept.indexOf(field[0]) < 0) el(field[0]).value = field[1](vector); });
    state.shown = { id: state.record.vehicle.vehicleId, values: EDITED.map(function (field) { return field[1](vector); }) };
  }

  /** @description The edited fields whose value differs from the one last drawn for this explorer. @returns {string[]} Field ids. */
  function drafts() {
    var shown = state.shown;
    if (!shown || !state.record || shown.id !== state.record.vehicle.vehicleId) return [];
    return EDITED.filter(function (field, i) { return Number(el(field[0]).value) !== shown.values[i]; }).map(function (field) { return field[0]; });
  }

  /** @description The sea-state table and the year, from the latest evaluation. @param {object} record Full record. @returns {void} */
  function renderTable(record) {
    var latest = latestEvaluation(record);
    var body = el('sea-table').querySelector('tbody');
    if (!latest) {
      body.innerHTML = '';
      el('summary').innerHTML = '';
      el('within-model').textContent = '';
      el('table-note').textContent = 'Not evaluated yet. Evaluate in seawater to compute the table from the current vector.';
      return;
    }
    var result = latest.run.result;
    el('table-note').textContent = (latest.current ? 'Computed at the current vector' : 'STALE — computed at an earlier vector; evaluate again')
      + ' by run ' + latest.run.sequence + ' in ' + latest.run.mediumId + ' (' + result.engine.engine.id + ' ' + result.engine.engine.version + ').';
    body.innerHTML = (result.seaStates || []).map(function (r) {
      return '<tr><td>' + esc(r.label) + '</td><td class="num">' + fx(r.heightM, 2) + '</td><td class="num">' + fx(r.periodS, 2) + '</td><td class="num">'
        + fx(r.occurrence * 100, 1) + ' %</td><td class="num">' + fx(r.speedMs, 3) + '</td><td class="num">' + fx(r.knots, 2) + '</td><td class="num">'
        + fx(r.kmPerDay, 1) + '</td><td class="num">' + fx(r.ceilingMs, 3) + '</td><td>' + (r.underWay ? 'yes' : 'drifts') + '</td></tr>';
    }).join('');
    var f = result.figures;
    el('summary').innerHTML = [['Mean, knots', fx(f.meanKnots, 2)], ['Under way', fx(f.underWayFraction * 100, 0) + ' %'], ['km/day', fx(f.kmPerDay, 1)], ['km/year', Math.round(f.kmPerYear).toLocaleString('en-US')]]
      .map(function (p) { return '<div class="figure"><div class="v" data-figure="' + esc(p[0]) + '">' + esc(p[1]) + '</div><div class="k">' + esc(p[0]) + '</div></div>'; }).join('');
    el('within-model').textContent = (result.withinModel && result.withinModel.notes.length ? result.withinModel.notes.join(' ') + ' ' : '')
      + 'Not modelled: ' + (result.notModelled || []).join('; ') + '.';
  }

  /** @description The open limits, each with its blocking tag. @param {object} record Full record. @returns {void} */
  function renderLimits(record) {
    var open = record.stage.openLimits || [];
    el('limit-count').textContent = String(open.length);
    el('limits').innerHTML = open.map(function (l) {
      return '<li data-limit="' + esc(l.id) + '">' + esc(l.sentence) + (l.blocking ? ' <span class="tag blocking">blocks built</span>' : '')
        + '<br><span class="note">Retires when ' + esc(l.retireWhen) + '.</span></li>';
    }).join('');
  }

  /** @description One run's summary cell: the year for an evaluation, the fall for a hull drop. @param {object} run Run row. @returns {string} Text. */
  function runSummary(run) {
    var r = run.result || {};
    if (r.figures) return fx(r.figures.kmPerYear, 0) + ' km/year, ' + fx(r.figures.meanKnots, 2) + ' kn';
    if (r.fall) return 'fell ' + fx(r.fall.dropHeightM, 2) + ' m in ' + fx(r.fall.fallTimeS, 3) + ' s at ' + fx(r.fall.gMagnitudeMps2, 2) + ' m/s²';
    return 'recorded';
  }

  /** @description The runs table. A row lacking its medium id or fingerprints is NOT drawn. @param {object} record Full record. @returns {void} */
  function renderRuns(record) {
    var shown = [];
    var refused = (record.withheld || []).map(function (w) { return 'run ' + w.sequence + ' (missing ' + w.missing.join(', ') + ')'; });
    (record.runs || []).forEach(function (run) {
      var missing = missingFingerprints(run);
      if (missing.length) refused.push('run ' + run.sequence + ' (missing ' + missing.join(', ') + ')');
      else shown.push(run);
    });
    el('runs').querySelector('tbody').innerHTML = shown.map(function (run) {
      var fp = run.engineFingerprints;
      return '<tr data-run="' + esc(run.sequence) + '"><td>' + esc(run.sequence) + '</td><td>' + esc(run.mediumId) + '</td><td>' + esc(run.plant) + '</td><td>'
        + esc((fp.package || '?') + ' ' + fp.packageVersion + ' · ' + fp.routesBuildHash.slice(0, 12)) + '</td><td>' + esc(runSummary(run)) + '</td></tr>';
    }).join('');
    el('runs-withheld').hidden = refused.length === 0;
    el('runs-withheld').textContent = refused.length ? 'Not displayed — a run without its medium id and engine fingerprints is not drawn: ' + refused.join('; ') + '.' : '';
  }

  /** @description A mass in grams, or NOT PUBLISHED for a value nobody has. @param {number|null} kg Mass, kg. @param {number} d Places. @returns {string} Text. */
  function grams(kg, d) { return typeof kg === 'number' && isFinite(kg) ? (kg * 1000).toFixed(d) : 'not published'; }

  /** @description One table row with a per-part ⋯ overflow action when it opens in CAD Studio. @param {string[]} cells Cell texts. @param {object} part Part row. @param {number[]} numeric Numeric column indexes. @returns {string} HTML. */
  function partRow(cells, part, numeric) {
    var tds = cells.map(function (c, i) { return '<td' + (numeric.indexOf(i) >= 0 ? ' class="num"' : '') + '>' + esc(c) + '</td>'; }).join('');
    var more = part.opensInCadStudio
      ? '<button class="icon-btn row-more-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Actions for ' + esc(part.name) + '" title="Part actions" data-part-menu="' + esc(part.id) + '">⋯</button>'
      : '';
    return '<tr data-part="' + esc(part.id) + '">' + tds + '<td class="act">' + more + '</td></tr>';
  }

  /** @description Draw the parts model, displacement budget, and completeness items. @param {object} body GET /:id/parts. @returns {void} */
  function renderParts(body) {
    state.partsById = {};
    (body.printed || []).forEach(function (p) { state.partsById[p.id] = p.name; });
    (body.bought || []).forEach(function (b) { state.partsById[b.id] = b.name; });
    el('parts-count').textContent = body.watertightParts + ' watertight parts';
    el('parts-note').textContent = 'Derived from the current vector by ' + body.engine.id + ' ' + body.engine.version + '. Masses are estimates at the assumed ' + body.fabrication.material + ' (' + body.fabrication.densityGcm3 + ' g/cm³); ' + body.fabrication.hulls + '.';
    el('budget-badge').textContent = 'budget ' + body.budget.status;
    el('budget-why').textContent = humanizeProse(body.budget.why);
    el('printed-parts').querySelector('tbody').innerHTML = body.printed.map(function (p) {
      return partRow([p.name, String(p.qty), p.program, p.material, grams(p.massEachKg, 1), fx(p.displacedTotalMm3 / 1e6, 3)], p, [1, 4, 5]);
    }).join('');
    el('bought-parts').querySelector('tbody').innerHTML = body.bought.map(function (b) {
      var mass = b.derived === 'ballast' ? 'derived by the budget' : grams(b.massEachKg, 0);
      return partRow([b.name, String(b.qty), b.make, b.carriedBy || 'not placed', mass, typeof b.approxUsdEach === 'number' ? fx(b.approxUsdEach, 0) : 'not published', b.source], b, [1, 4, 5]);
    }).join('');
    el('parts-problems').innerHTML = body.problems.map(function (p) { return '<li>' + esc(humanizeProse(p)) + '</li>'; }).join('');
    el('design-md').href = recordUrl('/design.md');
    if (state.record && state.record.stage) renderStage(state.record.stage);
  }

  /** @description Read the parts model for the loaded record. @returns {Promise<void>} Done. */
  function loadParts() {
    return call(recordUrl('/parts')).then(function (a) {
      if (a.status !== 200) { el('parts-note').textContent = 'The parts model is unavailable (' + a.status + ')' + (a.body && a.body.problems ? ': ' + a.body.problems.join('; ') : '') + '.'; return; }
      renderParts(a.body);
    });
  }

  /** @description Post one part's exact CAD Studio body and land on the CAD Studio tile. @param {string} partId Part id. @returns {Promise<void>} Done. */
  function openInCadStudio(partId) {
    el('cad-status').textContent = 'Creating the part in CAD Studio…';
    return call(recordUrl('/parts/' + encodeURIComponent(partId))).then(function (a) {
      if (a.status !== 200) { el('cad-status').textContent = 'The part is unavailable (' + a.status + ').'; return undefined; }
      return call('/api/cad-studio/models', { method: 'POST', body: JSON.stringify(a.body.cadStudio) }).then(function (r) {
        if (r.status === 404 || r.status === 401 || r.status === 403) { el('cad-status').textContent = 'CAD Studio is not installed on this swarm, or you are not granted access to it.'; return; }
        var out = r.body || {};
        if (r.status < 200 || r.status >= 300) { el('cad-status').textContent = 'CAD Studio did not build it: ' + ((out.build && (out.build.reason || out.build.error)) || out.message || out.error || ('HTTP ' + r.status)); return; }
        el('cad-status').textContent = 'Opened in CAD Studio as "' + out.model.title + '" (revision ' + out.model.revision + ').';
        (global.top || global).location.assign('/cockpit/?app=cad-studio');
      });
    });
  }

  /** @description Switch between Design & sea states (?view=design) and Parts & BOM (?view=parts). @param {string} next View name. @param {boolean} [syncUrl] Update URL search param. @returns {void} */
  function setView(next, syncUrl) {
    var v = next === 'parts' ? 'parts' : 'design';
    state.view = v;
    closeMenus();
    el('view-design').hidden = v !== 'design';
    el('view-parts').hidden = v !== 'parts';
    if (el('tab-design').setAttribute) el('tab-design').setAttribute('aria-pressed', v === 'design' ? 'true' : 'false');
    if (el('tab-parts').setAttribute) el('tab-parts').setAttribute('aria-pressed', v === 'parts' ? 'true' : 'false');
    if (syncUrl && global.history && global.history.replaceState && global.location) {
      var url = new global.URL(global.location.href);
      url.searchParams.set('view', v);
      global.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  }

  /** @description Close open overflow menus. @returns {void} */
  function closeMenus() {
    el('stage-more-menu').hidden = true;
    if (el('stage-more-btn').setAttribute) el('stage-more-btn').setAttribute('aria-expanded', 'false');
    el('part-menu').hidden = true;
  }

  /** @description Anchor and open the floating part actions menu for a row button. @param {HTMLElement} btn Trigger button. @returns {void} */
  function openPartMenu(btn) {
    var partId = btn.getAttribute ? btn.getAttribute('data-part-menu') : '';
    if (!partId) return;
    closeMenus();
    var menu = el('part-menu');
    var item = el('part-menu-open-cad');
    if (item.setAttribute) item.setAttribute('data-open-part', partId);
    menu.hidden = false;
    if (btn.getBoundingClientRect && menu.style) {
      var rect = btn.getBoundingClientRect();
      var width = 208;
      var left = Math.max(8, Math.min((global.innerWidth || 412) - width - 8, rect.right - width));
      var top = rect.bottom + 4;
      if (global.innerHeight && top + 56 > global.innerHeight) top = Math.max(8, rect.top - 56);
      menu.style.left = left + 'px';
      menu.style.top = top + 'px';
    }
  }

  /** @description Draw the whole record. @param {object} record Full record from the routes. @returns {void} */
  function render(record) {
    state.record = record;
    el('no-vehicle').hidden = true;
    el('record').hidden = false;
    renderStage(record.stage);
    renderVector(record.vehicle.designVector);
    renderTable(record);
    renderLimits(record);
    renderRuns(record);
    loadParts().catch(function (err) { el('parts-note').textContent = 'The parts model could not be loaded: ' + err; });
  }

  /** @description Take an answer: a record re-renders, a named refusal is shown by its name. @param {{status:number, body:any}} answer Route answer. @param {string} done Success status text. @returns {void} */
  function take(answer, done) {
    el('medium-refusal').hidden = true;
    if (answer.status >= 200 && answer.status < 300 && answer.body && answer.body.stage) { render(answer.body); say(done); return; }
    var b = answer.body || {};
    if (b.refusal) {
      el('medium-refusal').hidden = false;
      el('medium-refusal').textContent = 'Refused: ' + b.refusal + ' — ' + b.because;
      say('The medium was refused by name; nothing was recorded.');
      return;
    }
    say('Not done (' + answer.status + '): ' + (b.error || 'error') + (b.problems ? ' — ' + b.problems.join('; ') : '') + (b.missing ? ' — missing ' + b.missing.join(', ') : ''));
  }

  /** @description The vector with the two edited fields applied. @returns {object} Copy of stored vector. */
  function editedVector() {
    var v = JSON.parse(JSON.stringify(state.record.vehicle.designVector));
    v.wings.stopAngleDeg = Number(el('stop-angle').value);
    v.tether.lengthM = Number(el('tether-length').value);
    return v;
  }

  /** @description The record's own URL. @param {string} [suffix] Path under it. @returns {string} URL. */
  function recordUrl(suffix) { return BASE + '/' + encodeURIComponent(state.record.vehicle.vehicleId) + (suffix || ''); }

  /** @description Save the edited vector. @returns {Promise<void>} Done. */
  function saveDesign() {
    say('Saving the design vector…');
    return call(recordUrl('/design'), { method: 'PATCH', body: JSON.stringify({ designVector: editedVector() }) })
      .then(function (a) { take(a, 'Saved. The stage is recomputed from the new vector; evaluate to size it again.'); });
  }

  /** @description Evaluate at the stored vector in a medium. @param {string} mediumId Medium id. @returns {Promise<void>} Done. */
  function evaluate(mediumId) {
    say('Evaluating in ' + mediumId + '…');
    return call(recordUrl('/evaluate'), { method: 'POST', body: JSON.stringify({ mediumId: mediumId }) })
      .then(function (a) { take(a, 'Evaluated in ' + mediumId + '; the run is recorded.'); });
  }

  /** @description Fetch a hull drop from embodied's own route and post it to this record as data. @returns {Promise<void>} Done. */
  function recordHullDrop() {
    say('Asking Embodied to drop the hull in air…');
    return call(HULL_DROP).then(function (drop) {
      if (drop.status !== 200) { say('Embodied did not answer the drop (' + drop.status + ')' + (drop.body && drop.body.refusal ? ': ' + drop.body.refusal : '') + '. Nothing was recorded.'); return undefined; }
      return call(recordUrl('/runs'), { method: 'POST', body: JSON.stringify({ run: drop.body }) }).then(function (a) { take(a, 'The hull drop is recorded as a run on the Explorer.'); });
    });
  }

  /** @description Open the in-page delete confirmation dialog (no native window.confirm). @returns {void} */
  function deleteExplorer() {
    if (!state.record) return;
    closeMenus();
    var dlg = el('delete-dialog');
    dlg.hidden = false;
    if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
  }

  /** @description Close the in-page delete confirmation dialog without deleting. @returns {void} */
  function closeDeleteDialog() {
    var dlg = el('delete-dialog');
    if (typeof dlg.close === 'function' && dlg.open) dlg.close();
    dlg.hidden = true;
  }

  /** @description Execute the confirmed DELETE against the open explorer. @returns {Promise<void>|undefined} Done. */
  function confirmDeleteExplorer() {
    if (!state.record) { closeDeleteDialog(); return undefined; }
    closeDeleteDialog();
    say('Deleting the explorer…');
    return call(recordUrl(''), { method: 'DELETE' }).then(function (a) {
      if (a.status !== 204 && a.status !== 200) { say('The explorer was not deleted (' + a.status + (a.body && a.body.error ? ': ' + a.body.error : '') + ').'); return; }
      state.record = null;
      el('record').hidden = true;
      el('no-vehicle').hidden = false;
      say('The explorer is deleted. Create it again from the seed when you want one.');
    });
  }

  /** @description Load the kinds and the caller's explorer; offer to create it when there is none. @returns {Promise<void>} Done. */
  function load() {
    return Promise.all([call(BASE + '/kinds'), call(BASE)]).then(function (answers) {
      if (answers[0].status !== 200 || answers[1].status !== 200) { say('The record is unavailable (' + answers[1].status + ').'); return undefined; }
      state.kinds = answers[0].body;
      var mine = (answers[1].body.vehicles || []).filter(function (v) { return v.vehicle.kind === 'wave-explorer'; });
      if (!mine.length) { el('no-vehicle').hidden = false; el('record').hidden = true; say('No explorer on this account yet.'); return undefined; }
      return call(BASE + '/' + encodeURIComponent(mine[0].vehicle.vehicleId)).then(function (a) { take(a, 'Record loaded.'); });
    });
  }

  /** @description Wait until every write this page started has answered. @returns {Promise<void>} Done. */
  function settleWrites() {
    if (!state.writes.length) return Promise.resolve();
    return Promise.all(state.writes.map(function (w) { return w.catch(function () { return null; }); })).then(settleWrites);
  }

  /** @description The saved explorer's identity and version for assistant handoff. @param {object} record Full record. @returns {object} Snapshot. */
  function documentSnapshot(record) {
    var v = record.vehicle;
    return { app: 'ocean-lab', screen: 'surface', surface: 'ocean-lab-explorer', recordId: v.vehicleId, title: v.name || 'Explorer',
      fields: { revision: v.updatedAt, updatedAt: v.updatedAt, stage: record.stage.stage, stopAngleDeg: v.designVector.wings.stopAngleDeg, tetherLengthM: v.designVector.tether.lengthM, readOnly: false, draft: false } };
  }

  /** @description Save an unsaved design change through the page's own save, then hand over the saved explorer. @returns {Promise<object|null>} Snapshot. */
  function prepareDocumentHandoff() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    return settleWrites().then(function () {
      if (!state.record) return null;
      var id = state.record.vehicle.vehicleId;
      return (drafts().length ? saveDesign().then(settleWrites) : Promise.resolve()).then(function () {
        if (!state.record || state.record.vehicle.vehicleId !== id) throw new Error('The open explorer changed while it was being saved. Ask again from the explorer you want to edit.');
        if (drafts().length) throw new Error('Your design change could not be saved (' + el('status').textContent + ') It is still in the fields; correct it, then ask again.');
        return documentSnapshot(state.record);
      });
    });
  }

  /** @description Re-read the handed-over explorer and redraw it when it changed, keeping a field the person is still editing. @param {object} [expected] Handed-over snapshot. @returns {Promise<void>} Done. */
  function refreshDocumentHandoff(expected) {
    return settleWrites().then(function () {
      var record = state.record;
      if (!record || (expected && expected.recordId && expected.recordId !== record.vehicle.vehicleId)) return undefined;
      var id = record.vehicle.vehicleId;
      return call(BASE + '/' + encodeURIComponent(id)).then(function (a) {
        if (!state.record || state.record.vehicle.vehicleId !== id) return;
        if (a.status !== 200 || !a.body || !a.body.stage) { say('The explorer could not be read again (' + a.status + '); the page shows what you last saw.'); return; }
        if (JSON.stringify(a.body) === JSON.stringify(state.record)) return;
        render(a.body);
        var kept = drafts();
        say(kept.length ? 'The concierge saved a change; it is shown. Your unsaved ' + kept.join(' and ') + ' is kept; Save writes it on top.' : 'The concierge saved a change; it is shown.');
      });
    });
  }

  /** @description Offer this explorer to the conversation through the shared document handoff. @returns {void} */
  function registerDocumentHandoff() {
    var reported = function (fn) { return function (expected) { return fn(expected).catch(function (err) { say(err.message); throw err; }); }; };
    import('/shared/ui/js/document-handoff.js').then(function (mod) {
      mod.registerDocumentSession({ app: 'ocean-lab', prepare: reported(prepareDocumentHandoff), refresh: reported(refreshDocumentHandoff) });
    }).catch(function (err) { say('The concierge cannot synchronize this explorer: ' + err.message); });
  }

  /** @description Wire menus, view tabs, and dismissal handlers. @returns {void} */
  function wireChrome() {
    var initial = global.location && global.location.search && /[?&]view=parts(?:&|$)/.test(global.location.search) ? 'parts' : 'design';
    setView(initial, false);
    el('tab-design').addEventListener('click', function () { setView('design', true); });
    el('tab-parts').addEventListener('click', function () { setView('parts', true); });
    el('stage-more-btn').addEventListener('click', function (event) {
      if (event && event.stopPropagation) event.stopPropagation();
      var next = el('stage-more-menu').hidden;
      closeMenus();
      el('stage-more-menu').hidden = !next;
      if (el('stage-more-btn').setAttribute) el('stage-more-btn').setAttribute('aria-expanded', next ? 'true' : 'false');
    });
    el('part-menu-open-cad').addEventListener('click', function () {
      var partId = el('part-menu-open-cad').getAttribute ? el('part-menu-open-cad').getAttribute('data-open-part') : '';
      closeMenus();
      if (partId) openInCadStudio(partId).catch(function (err) { el('cad-status').textContent = 'CAD Studio could not be reached: ' + err; });
    });
    if (document.addEventListener) {
      document.addEventListener('click', function (event) {
        var t = event && event.target;
        if (t && t.closest && (t.closest('#stage-more-menu') || t.closest('#stage-more-btn') || t.closest('#part-menu') || t.closest('[data-part-menu]'))) return;
        closeMenus();
      });
      document.addEventListener('keydown', function (event) {
        if (event && event.key === 'Escape') { closeMenus(); closeDeleteDialog(); }
      });
    }
  }

  /** @description Wire the buttons and load. @returns {void} */
  function start() {
    wireChrome();
    el('create-explorer').addEventListener('click', function () {
      call(BASE + '/explorer/seed', { method: 'POST', body: '{}' }).then(function (a) { take(a, 'The Explorer is created at concept.'); });
    });
    el('save-design').addEventListener('click', saveDesign);
    el('evaluate').addEventListener('click', function () { evaluate('seawater'); });
    el('record-hull-drop').addEventListener('click', recordHullDrop);
    el('delete-explorer').addEventListener('click', deleteExplorer);
    el('delete-cancel').addEventListener('click', closeDeleteDialog);
    el('delete-confirm').addEventListener('click', confirmDeleteExplorer);
    el('parts-card').addEventListener('click', function (event) {
      var btn = event && event.target && event.target.closest ? event.target.closest('[data-part-menu]') : null;
      if (btn) { if (event.stopPropagation) event.stopPropagation(); openPartMenu(btn); }
    });
    registerDocumentHandoff();
    load().catch(function (err) { say('The record could not be loaded: ' + err); });
  }

  global.OceanExplorer = {
    start: start,
    missingFingerprints: missingFingerprints,
    latestEvaluation: latestEvaluation,
    grams: grams,
    humanizeProse: humanizeProse,
    parseGate: parseGate
  };
}(window));
