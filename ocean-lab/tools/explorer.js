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
 */

/* global window, document, fetch */

(function (global) {
  'use strict';

  var BASE = '/api/ocean-lab/vehicles';
  var HULL_DROP = '/api/embodied/physics/hull?medium=air';
  var SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
  var SHA256 = /^[0-9a-f]{64}$/;
  var state = { kinds: null, record: null };

  /** @description The element with an id. @param {string} id Element id. @returns {HTMLElement} The element. */
  function el(id) { return document.getElementById(id); }

  /** @description Escape text for HTML. @param {unknown} v Any value. @returns {string} Safe text. */
  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** @description A number to fixed places, or a dash. @param {unknown} v Value. @param {number} d Places. @returns {string} Text. */
  function fx(v, d) { return typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '—'; }

  /** @description Say something in the status line. @param {string} text Message. @returns {void} */
  function say(text) { el('status').textContent = text; }

  /** @description JSON over fetch, same origin, never throwing on a status. @param {string} url URL. @param {object} [init] fetch init. @returns {Promise<{status:number, body:any}>} The answer. */
  function call(url, init) {
    var opts = Object.assign({ credentials: 'same-origin', headers: { 'content-type': 'application/json' } }, init || {});
    return fetch(url, opts).then(function (res) {
      return res.text().then(function (text) {
        var body = null;
        try { body = text ? JSON.parse(text) : null; } catch (err) { body = { error: 'not_json', detail: String(err) }; }
        return { status: res.status, body: body };
      });
    });
  }

  /**
   * @description The rule every surface applies before drawing a run (ADR-160 D5): its medium id, a real
   * package version and a 64-hex engine build hash, or it is not drawn. Mirrors the server's rule.
   * @param {object} run A run as the record publishes it. @returns {string[]} Missing fields; empty when displayable.
   */
  function missingFingerprints(run) {
    var missing = [];
    var fp = (run && run.engineFingerprints) || {};
    if (!run || typeof run.mediumId !== 'string' || !run.mediumId) missing.push('medium.id');
    if (typeof fp.packageVersion !== 'string' || !SEMVER.test(fp.packageVersion)) missing.push('engine.packageVersion');
    if (typeof fp.routesBuildHash !== 'string' || !SHA256.test(fp.routesBuildHash)) missing.push('engine.routesBuildHash');
    return missing;
  }

  /** @description The most recent displayable evaluation, preferring one at the current vector. @param {object} record The full record. @returns {{run: object, current: boolean}|null} The run. */
  function latestEvaluation(record) {
    var plant = state.kinds && state.kinds.evaluationPlant;
    var evals = (record.runs || []).filter(function (r) { return r.plant === plant && missingFingerprints(r).length === 0; });
    if (!evals.length) return null;
    var current = record.stage.currentVectorFingerprint;
    var atCurrent = evals.filter(function (r) { return r.vectorFingerprint === current; });
    var pick = (atCurrent.length ? atCurrent : evals).sort(function (a, b) { return b.sequence - a.sequence; })[0];
    return { run: pick, current: pick.vectorFingerprint === current };
  }

  /** @description Draw the stage badge, the ladder, why, what blocks the next stage, and the fabricable sentence. @param {object} stage The stage view. @returns {void} */
  function renderStage(stage) {
    el('stage-badge').textContent = stage.stage;
    var stages = (state.kinds && state.kinds.stages) || [];
    el('stage-ladder').innerHTML = stages.map(function (s) {
      return '<li class="' + (stage.reached.indexOf(s) >= 0 ? 'reached' : '') + '">' + esc(s) + '</li>';
    }).join('');
    el('stage-because').textContent = 'Why: ' + stage.because;
    el('stage-blocked').textContent = stage.next ? 'To reach ' + stage.next + ': ' + stage.blockedBy.join(' ') : '';
    el('fabricable').textContent = stage.fabricable;
  }

  /** @description The parameter table, each field with its seed provenance tag. @param {object} vector The design vector. @returns {void} */
  function renderVector(vector) {
    var prov = (state.kinds && state.kinds.seed && state.kinds.seed.provenance) || {};
    var rows = [
      ['wings.count', vector.wings.count], ['wings.spanM', vector.wings.spanM + ' m'], ['wings.chordM', vector.wings.chordM + ' m'],
      ['wings.section', vector.wings.section], ['wings.stopAngleDeg', vector.wings.stopAngleDeg + '°'],
      ['tether.lengthM', vector.tether.lengthM + ' m'], ['tether.diameterM', vector.tether.diameterM + ' m'],
      ['float.displacementL', vector.float.displacementL + ' L'], ['sub.netWeightN', vector.sub.netWeightN + ' N'],
    ];
    el('vector-table').querySelector('tbody').innerHTML = rows.map(function (r) {
      var p = prov[r[0]];
      return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td><td>' + (p ? '<span class="tag ' + esc(p.source) + '" title="' + esc(p.basis) + '">' + esc(p.source) + '</span>' : '') + '</td></tr>';
    }).join('');
    el('stop-angle').value = vector.wings.stopAngleDeg;
    el('tether-length').value = vector.tether.lengthM;
  }

  /** @description The sea-state table and the year, from the latest evaluation. @param {object} record The full record. @returns {void} */
  function renderTable(record) {
    var latest = latestEvaluation(record);
    var body = el('sea-table').querySelector('tbody');
    if (!latest) {
      body.innerHTML = '';
      el('summary').innerHTML = '';
      el('within-model').textContent = '';
      el('table-note').textContent = 'Not evaluated yet. Evaluate to compute the table from the current vector.';
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

  /** @description The open limits, each with its blocking tag. @param {object} record The full record. @returns {void} */
  function renderLimits(record) {
    var open = record.stage.openLimits || [];
    el('limit-count').textContent = String(open.length);
    el('limits').innerHTML = open.map(function (l) {
      return '<li data-limit="' + esc(l.id) + '">' + esc(l.sentence) + (l.blocking ? ' <span class="tag blocking">blocks built</span>' : '')
        + '<br><span class="note">Retires when ' + esc(l.retireWhen) + '.</span></li>';
    }).join('');
  }

  /** @description One run's summary cell: the year for an evaluation, the fall for a hull drop. @param {object} run The run. @returns {string} Text. */
  function runSummary(run) {
    var r = run.result || {};
    if (r.figures) return fx(r.figures.kmPerYear, 0) + ' km/year, ' + fx(r.figures.meanKnots, 2) + ' kn';
    if (r.fall) return 'fell ' + fx(r.fall.dropHeightM, 2) + ' m in ' + fx(r.fall.fallTimeS, 3) + ' s at ' + fx(r.fall.gMagnitudeMps2, 2) + ' m/s²';
    return 'recorded';
  }

  /** @description The runs table. A row lacking its medium id or fingerprints is NOT drawn; the tile says which field is missing instead. @param {object} record The full record. @returns {void} */
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

  /** @description One table row with an optional Open in CAD Studio button. @param {string[]} cells Cell texts. @param {object} part The part. @param {number[]} numeric Indexes of numeric cells. @returns {string} HTML. */
  function partRow(cells, part, numeric) {
    var tds = cells.map(function (c, i) { return '<td' + (numeric.indexOf(i) >= 0 ? ' class="num"' : '') + '>' + esc(c) + '</td>'; }).join('');
    var btn = part.opensInCadStudio ? '<button class="btn" type="button" data-open-part="' + esc(part.id) + '" title="Creates the part as a real CAD model (STEP, STL, drawings) in CAD Studio and opens it there.">Open in CAD Studio</button>' : '';
    return '<tr data-part="' + esc(part.id) + '">' + tds + '<td>' + btn + '</td></tr>';
  }

  /** @description Draw the parts model, the budget and what keeps it from complete. @param {object} body GET /:id/parts. @returns {void} */
  function renderParts(body) {
    el('parts-count').textContent = body.watertightParts + ' watertight parts';
    el('parts-note').textContent = 'Derived from the current vector by ' + body.engine.id + ' ' + body.engine.version + '. Masses are estimates at the assumed ' + body.fabrication.material + ' (' + body.fabrication.densityGcm3 + ' g/cm³); ' + body.fabrication.hulls + '.';
    el('budget-badge').textContent = 'budget ' + body.budget.status;
    el('budget-why').textContent = body.budget.why;
    el('printed-parts').querySelector('tbody').innerHTML = body.printed.map(function (p) {
      return partRow([p.name, String(p.qty), p.program, p.material, grams(p.massEachKg, 1), fx(p.displacedTotalMm3 / 1e6, 3)], p, [1, 4, 5]);
    }).join('');
    el('bought-parts').querySelector('tbody').innerHTML = body.bought.map(function (b) {
      var mass = b.derived === 'ballast' ? 'derived by the budget' : grams(b.massEachKg, 0);
      return partRow([b.name, String(b.qty), b.make, b.carriedBy || 'not placed', mass, typeof b.approxUsdEach === 'number' ? fx(b.approxUsdEach, 0) : 'not published', b.source], b, [1, 4, 5]);
    }).join('');
    el('parts-problems').innerHTML = body.problems.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
    el('design-md').href = recordUrl('/design.md');
  }

  /** @description Read the parts model for the loaded record. @returns {Promise<void>} Done. */
  function loadParts() {
    return call(recordUrl('/parts')).then(function (a) {
      if (a.status !== 200) { el('parts-note').textContent = 'The parts model is unavailable (' + a.status + ')' + (a.body && a.body.problems ? ': ' + a.body.problems.join('; ') : '') + '.'; return; }
      renderParts(a.body);
    });
  }

  /** @description Post one part's exact CAD Studio body and land on the CAD Studio tile. @param {string} partId The part. @returns {Promise<void>} Done. */
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

  /** @description Draw the whole record. @param {object} record The full record from the routes. @returns {void} */
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

  /** @description Take an answer: a record re-renders, a named refusal is shown by its name. @param {{status:number, body:any}} answer The route's answer. @param {string} done What to say on success. @returns {void} */
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

  /** @description The vector with the two edited fields applied. @returns {object} A copy of the stored vector. */
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

  /** @description Evaluate at the stored vector in a medium. @param {string} mediumId The medium. @returns {Promise<void>} Done. */
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

  /** @description Wire the buttons and load. @returns {void} */
  function start() {
    el('create-explorer').addEventListener('click', function () {
      call(BASE + '/explorer/seed', { method: 'POST', body: '{}' }).then(function (a) { take(a, 'The Explorer is created at concept.'); });
    });
    el('save-design').addEventListener('click', saveDesign);
    el('evaluate').addEventListener('click', function () { evaluate('seawater'); });
    el('evaluate-air').addEventListener('click', function () { evaluate('air'); });
    el('record-hull-drop').addEventListener('click', recordHullDrop);
    el('parts-card').addEventListener('click', function (event) {
      var target = event.target && event.target.closest ? event.target.closest('[data-open-part]') : null;
      if (target) openInCadStudio(target.getAttribute('data-open-part')).catch(function (err) { el('cad-status').textContent = 'CAD Studio could not be reached: ' + err; });
    });
    load().catch(function (err) { say('The record could not be loaded: ' + err); });
  }

  global.OceanExplorer = { start: start, missingFingerprints: missingFingerprints, latestEvaluation: latestEvaluation, grams: grams };
}(window));
