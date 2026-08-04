/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-03 00:00:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation — Aero Lab cockpit surface script: design-vector form with engine-bounds sync, four proven presets, run flows against the frozen /api/aero-lab routes (polar / evaluate / screen / mission / export / chat), hand-rolled themed SVG plots (SOC limit cycle with night shading + min-SOC marker, polar small-multiples, drag-buildup bars, mass-ledger donut), capability-flag honesty chips, and the verdict card that never renders a number the engine did not return.
 */
/* Served by the package route as /api/aero-lab/app.js next to /app (the HTML).
   All data flows from the routes in BUILD_CONTRACT §2a; the only client-side
   arithmetic on engine numbers is display transforms of returned arrays
   (hours from t_s, CL^1.5/CD from the returned CL/CD columns). */
'use strict';

(function () {
  const D = window.AERO_LAB_DATA;
  const $ = (id) => document.getElementById(id);
  const FIELD_BY_KEY = Object.fromEntries(D.fields.map((f) => [f.k, f]));

  /** Mutable surface state — the design vector is the single source the runs read. */
  const state = {
    design: {},          // current design vector (numbers, frozen wire field names)
    caps: null,          // last GET /capabilities response
    bounds: null,        // engine bounds { field: [min,max] } when provided
    busy: false,
    chat: [],            // [{ role, content }]
    rerenders: [],       // thunks re-run on theme change (charts repaint with new series steps)
  };

  /* ── tiny helpers ─────────────────────────────────────────────────────── */

  /**
   * @description Escape text for safe HTML interpolation. Engine reasons and chat
   * text are untrusted strings; everything rendered via innerHTML goes through here.
   * @param {*} s - Value to escape.
   * @returns {string} HTML-safe string.
   */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /**
   * @description Format a finite number for display; anything else renders as an
   * em-dash so a missing engine value can never look like a real one.
   * @param {*} n - Candidate number.
   * @param {number} dp - Decimal places.
   * @returns {string} Display string.
   */
  function fmt(n, dp) {
    return Number.isFinite(n) ? Number(n).toFixed(dp == null ? 3 : dp) : '—';
  }

  /* ── API client ───────────────────────────────────────────────────────── */

  /**
   * @description Call an /api/aero-lab route and normalize failures into one
   * throwable shape ({ status, body }) so every run button maps errors the same
   * honest way. Non-JSON bodies (proxy pages, auth redirects) become a plain error.
   * @param {string} method - HTTP method.
   * @param {string} path - Path under /api/aero-lab (leading slash).
   * @param {object} [body] - JSON body for POSTs.
   * @returns {Promise<object>} Parsed JSON success body.
   */
  async function api(method, path, body) {
    const res = await fetch('/api/aero-lab' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let parsed = null;
    try { parsed = await res.json(); } catch (_e) { /* non-JSON body */ }
    if (!res.ok) {
      throw { status: res.status, body: parsed || { error: 'HTTP ' + res.status + ' (non-JSON response)' } };
    }
    if (parsed == null) throw { status: res.status, body: { error: 'Engine route returned a non-JSON body' } };
    return parsed;
  }

  /**
   * @description Turn a normalized route failure into the honest sentence the
   * surface shows. Raw enum codes never render — capability_unavailable becomes
   * plain language with the engine's own reason; 422/400 carry the engine text verbatim.
   * @param {{status:number, body:object}} err - Normalized failure.
   * @returns {string} Human sentence.
   */
  function errText(err) {
    const b = err.body || {};
    if (b.code === 'capability_unavailable') {
      return 'Engine module not available yet: ' + (b.reason || b.error || 'no reason given');
    }
    if (err.status === 400) return 'Design rejected before the engine ran: ' + (b.error || 'invalid design vector');
    if (err.status === 422) return 'The engine ran — this design is un-buildable: ' + (b.error || 'no reason given');
    if (err.status === 504) return 'The engine run exceeded its time budget and was stopped. Try a coarser design or re-run.';
    return b.error || ('Unexpected error (HTTP ' + err.status + ')');
  }

  /** @description Show the run-level error banner with an honest message. @param {*} err - api() failure. @returns {void} */
  function showError(err) {
    const el = $('errBanner');
    el.textContent = errText(err);
    el.style.display = 'block';
  }

  /** @description Clear the run-level error banner. @returns {void} */
  function clearError() { $('errBanner').style.display = 'none'; }

  /* ── theme-aware series colors ────────────────────────────────────────── */

  /**
   * @description Decide light vs dark from the active theme's --bg-primary
   * luminance, so chart series use the palette steps validated for that surface.
   * @returns {boolean} True when the surface is light.
   */
  function isLightSurface() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim();
    const m = v.match(/^#([0-9a-f]{6})$/i);
    if (!m) return false;
    const n = parseInt(m[1], 16);
    const lum = (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255;
    return lum > 0.5;
  }

  /** @description Categorical series palette for the current surface (fixed order, never cycled). @returns {string[]} Hex steps. */
  function series() { return isLightSurface() ? D.seriesLight : D.seriesDark; }

  /* ── design form ──────────────────────────────────────────────────────── */

  /**
   * @description Build the grouped slider+number form for every design-vector
   * field. Slider and number stay synced; edits update state.design and the
   * derived readouts, and flag the run bar that plots are stale.
   * @returns {void}
   */
  function buildForm() {
    const root = $('designForm');
    root.innerHTML = '';
    for (const g of D.groups) {
      const grp = document.createElement('div');
      grp.className = 'grp';
      grp.innerHTML = '<div class="grp-head"><span>' + esc(g.label) + '</span></div>';
      for (const f of D.fields.filter((x) => x.g === g.id)) {
        const row = document.createElement('div');
        row.className = 'fld';
        row.id = 'fld-' + f.k;
        row.innerHTML =
          '<div class="f-lab"><label for="in-' + f.k + '">' + esc(f.label) +
          '</label><span class="unit">' + esc(f.unit) + '</span></div>' +
          '<input type="range" id="rg-' + f.k + '" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '">' +
          '<input type="number" id="in-' + f.k + '" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '">';
        grp.appendChild(row);
        row.querySelector('input[type=range]').addEventListener('input', (e) => setField(f.k, e.target.value, 'range'));
        row.querySelector('input[type=number]').addEventListener('change', (e) => setField(f.k, e.target.value, 'number'));
      }
      root.appendChild(grp);
    }
  }

  /**
   * @description Write one field edit into the design vector and refresh the
   * paired control, derived readouts, and out-of-bounds flags.
   * @param {string} k - Field key.
   * @param {string|number} raw - New value from either control.
   * @param {string} from - Which control produced it ('range'|'number'|'code').
   * @returns {void}
   */
  function setField(k, raw, from) {
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    state.design[k] = v;
    if (from !== 'range') { const el = $('rg-' + k); if (el) el.value = String(v); }
    if (from !== 'number') { const el = $('in-' + k); if (el) el.value = String(v); }
    flagOutOfBounds(k);
    updateDerived();
    if (from !== 'code') $('runStatus').textContent = 'design changed — plots show the previous run';
  }

  /** @description Push every state.design value into the form controls. @returns {void} */
  function syncForm() {
    for (const f of D.fields) {
      if (state.design[f.k] == null) continue;
      setField(f.k, state.design[f.k], 'code');
    }
  }

  /**
   * @description Mark a field row amber when its value sits outside the engine's
   * declared bounds — the run will 400 and the surface says so up front.
   * @param {string} k - Field key.
   * @returns {void}
   */
  function flagOutOfBounds(k) {
    const row = $('fld-' + k);
    if (!row) return;
    const b = state.bounds && state.bounds[k];
    const v = state.design[k];
    const oob = Array.isArray(b) && Number.isFinite(v) && (v < b[0] || v > b[1]);
    row.classList.toggle('oob', !!oob);
    row.title = oob ? ('outside engine bounds [' + b[0] + ', ' + b[1] + '] — the engine will reject this design') : '';
  }

  /**
   * @description Recompute the pure-geometry derived readouts (span, chord, pack
   * capacity) — arithmetic on the user's own inputs, not engine claims — and the
   * buoyancy hull note, which only ever quotes engine-recorded numbers.
   * @returns {void}
   */
  function updateDerived() {
    const d = state.design;
    const span = Math.sqrt((d.aspect_ratio || 0) * (d.area_m2 || 0));
    const chord = span > 0 ? d.area_m2 / span : NaN;
    const wh = (d.battery_mass_kg || 0) * (d.pack_Wh_per_kg || 0);
    $('derived').innerHTML =
      'span <b>' + fmt(span, 2) + ' m</b> · mean chord <b>' + fmt(chord, 3) + ' m</b> · pack <b>' + fmt(wh, 1) + ' Wh</b>' +
      '<div class="note">(derived from your inputs — performance numbers only come from engine runs)</div>';
    const f = d.buoyancy_fraction || 0;
    const hybridOk = !!(state.caps && state.caps.capabilities && state.caps.capabilities.hybrid);
    const row = $('fld-buoyancy_fraction');
    if (row) {
      const off = !hybridOk && state.caps !== null;
      row.classList.toggle('disabled', off);
      row.querySelectorAll('input').forEach((i) => { i.disabled = off; });
    }
    let note = '';
    if (state.caps !== null && !hybridOk) {
      note = 'Buoyancy is locked: the engine’s hybrid modules are not available on this box' +
             (f > 0 ? ' — a design with buoyancy > 0 will honestly refuse to run.' : '.');
    } else if (f > 0) {
      note = 'Hull is sized by the engine at evaluate time (3:1 prolate spheroid); its mass shows up in the mass ledger.' +
             (state.presetHull ? '\n' + state.presetHull : '');
    }
    $('hullNote').textContent = note;
  }

  /* ── presets ──────────────────────────────────────────────────────────── */

  /**
   * @description Render the four proven-craft preset buttons and the named
   * site/season quick fills.
   * @returns {void}
   */
  function buildPresets() {
    const root = $('presetBtns');
    for (const p of D.presets) {
      const b = document.createElement('button');
      b.className = 'preset-btn';
      b.innerHTML = '<div class="p-name">' + esc(p.name) + '</div><div class="p-sub">' + esc(p.sub) + '</div>';
      b.addEventListener('click', () => applyPreset(p));
      root.appendChild(b);
    }
    const chips = $('siteChips');
    for (const s of D.sitePresets) {
      const b = document.createElement('button');
      b.textContent = s.label;
      b.addEventListener('click', () => {
        setField('latitude_deg', s.latitude_deg, 'code');
        setField('day_of_year', s.day_of_year, 'code');
        $('runStatus').textContent = 'site changed — plots show the previous run';
      });
      chips.appendChild(b);
    }
  }

  /**
   * @description Load a preset's real recorded design vector into the sliders and
   * show its provenance note (recorded results are history — the engine reproduces
   * them live on Run).
   * @param {object} p - Preset entry from AERO_LAB_DATA.presets.
   * @returns {void}
   */
  function applyPreset(p) {
    state.design = Object.assign({}, p.v);
    state.presetHull = p.hull || '';
    syncForm();
    let note = p.note;
    if (p.needs && state.caps && state.caps.capabilities && !state.caps.capabilities[p.needs]) {
      note = '⚠ This preset needs the "' + p.needs + '" capability, which the engine reports unavailable — runs will honestly refuse.\n\n' + note;
    }
    $('presetNote').textContent = note;
    $('runStatus').textContent = 'preset loaded — press Run to reproduce its numbers live';
  }

  /* ── capabilities ─────────────────────────────────────────────────────── */

  /**
   * @description First-paint engine handshake: fetch capability flags + bounds,
   * render the header badge and chips, gate the run buttons, and adopt the
   * engine's own slider bounds over the HTML fallbacks.
   * @returns {Promise<void>} Resolves when the header reflects engine truth.
   */
  async function loadCaps() {
    try {
      const caps = await api('GET', '/capabilities');
      state.caps = caps;
      state.bounds = (caps && caps.capabilities && caps.bounds) || caps.bounds || null;
      renderEngine(caps);
      applyBounds();
      gateButtons();
      updateDerived();
      renderFingerprint(null);
    } catch (err) {
      state.caps = { engine: { present: false }, capabilities: null };
      renderEngineDown(errText(err));
    }
  }

  /** @description Adopt engine-declared [min,max] per field onto both controls. @returns {void} */
  function applyBounds() {
    if (!state.bounds) return;
    for (const f of D.fields) {
      const b = state.bounds[f.k];
      if (!Array.isArray(b) || b.length !== 2) continue;
      for (const id of ['rg-' + f.k, 'in-' + f.k]) {
        const el = $(id);
        if (el) { el.min = String(b[0]); el.max = String(b[1]); }
      }
      flagOutOfBounds(f.k);
    }
  }

  /**
   * @description Paint the engine badge, capability chips (absent = amber with the
   * reason on hover) and the right-rail engine card from a capabilities response.
   * @param {object} caps - GET /capabilities body.
   * @returns {void}
   */
  function renderEngine(caps) {
    const eng = caps.engine || {};
    const c = caps.capabilities || {};
    const badge = $('engineBadge');
    badge.classList.remove('on', 'off');
    badge.classList.add(eng.present ? 'on' : 'off');
    badge.textContent = eng.present
      ? 'engine: live' + (eng.version ? ' · ' + eng.version : '')
      : 'engine: not found';
    const chips = $('capChips');
    chips.innerHTML = '';
    const flags = ['polar', 'evaluate', 'screen', 'mission', 'export', 'hybrid'];
    for (const k of flags) {
      const on = !!c[k];
      const chip = document.createElement('span');
      chip.className = 'cap-chip ' + (on ? 'on' : 'off');
      chip.textContent = k + (on ? '' : ' ✕');
      if (!on) chip.title = 'The engine reports "' + k + '" unavailable — its run button will refuse honestly. Modules may be mid-upgrade on this box.';
      chips.appendChild(chip);
    }
    const rows = [
      ['status', eng.present ? 'live' : 'not found'],
      ['dir', eng.engineDir || '—'],
      ['python', eng.python || '—'],
      ['venv', eng.venvOk == null ? '—' : (eng.venvOk ? 'ok' : 'missing')],
      ['version', eng.version || 'unknown'],
    ];
    $('engineCard').innerHTML = rows.map(([k, v]) =>
      '<span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span>').join('');
    const mods = (c.modules && Object.entries(c.modules)) || [];
    const missing = mods.filter(([, v]) => !v).map(([k]) => k);
    $('engineNote').textContent = mods.length
      ? (missing.length
        ? 'Modules mid-upgrade / absent: ' + missing.join(', ') + '. Their features report unavailable rather than faking numbers.'
        : 'All feature-detected modules present.')
      : '';
    if (!eng.present) {
      renderEngineDown('No aerosim engine at AERO_LAB_ENGINE_DIR' +
        (eng.engineDir ? ' (' + eng.engineDir + ')' : '') +
        '. Every run button will refuse until an engine checkout + venv exist — see the package engine/README.md.');
    } else {
      $('engineDownBanner').style.display = 'none';
    }
  }

  /**
   * @description Engine-absent state: amber banner with the reason, dead badge,
   * every run disabled. The surface never pretends.
   * @param {string} reason - Honest reason text.
   * @returns {void}
   */
  function renderEngineDown(reason) {
    const badge = $('engineBadge');
    badge.classList.remove('on');
    badge.classList.add('off');
    badge.textContent = 'engine: not found';
    const b = $('engineDownBanner');
    b.textContent = reason;
    b.style.display = 'block';
    $('engineCard').innerHTML = '<span class="k">status</span><span class="v">not found</span>';
    gateButtons();
  }

  /** @description Enable each run button only when its capability flag is true. @returns {void} */
  function gateButtons() {
    const c = (state.caps && state.caps.capabilities) || {};
    const gate = { btnPolar: 'polar', btnEval: 'evaluate', btnScreen: 'screen', btnMission: 'mission', btnExport: 'export' };
    for (const [id, cap] of Object.entries(gate)) {
      const el = $(id);
      el.disabled = !c[cap];
      el.title = c[cap] ? '' : 'The engine reports "' + cap + '" unavailable on this box.';
    }
  }

  /* ── run flows ────────────────────────────────────────────────────────── */

  /**
   * @description Shared run wrapper: one engine call in flight at a time, busy
   * status while it runs, honest error banner on failure.
   * @param {string} label - Busy label.
   * @param {Function} fn - Async work.
   * @returns {Promise<void>} Resolves when the run settles.
   */
  async function run(label, fn) {
    if (state.busy) return;
    state.busy = true;
    clearError();
    const st = $('runStatus');
    st.className = 'busy';
    st.textContent = label + ' — the real engine is computing (this can take a while)…';
    const t0 = performance.now();
    try {
      await fn();
      st.className = '';
      st.textContent = 'done in ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s';
    } catch (err) {
      st.className = '';
      st.textContent = 'run failed';
      showError(err);
    } finally {
      state.busy = false;
    }
  }

  /** @description POST /polar and render the polar small-multiples + drag buildup. @returns {Promise<void>} */
  function runPolar() {
    return run('Wing polar', async () => {
      const r = await api('POST', '/polar', { design: state.design });
      renderPolar(r);
      if (Array.isArray(r.dragBuildup) && r.dragBuildup.length) renderDrag(r.dragBuildup);
      renderFingerprint('polar');
    });
  }

  /** @description POST /evaluate and render SOC, power, mass ledger and the verdict. @returns {Promise<void>} */
  function runEvaluate() {
    return run('24 h energy loop', async () => {
      const r = await api('POST', '/evaluate', { design: state.design });
      renderEnergy(r.energy || {});
      if (r.build && Array.isArray(r.build.massBreakdown)) renderMass(r.build);
      renderVerdict(r);
      renderFingerprint('evaluate');
    });
  }

  /** @description POST /screen and render the admissibility verdict only. @returns {Promise<void>} */
  function runScreen() {
    return run('Admissibility screen', async () => {
      const r = await api('POST', '/screen', { design: state.design });
      renderVerdict({ verdict: r });
      renderFingerprint('screen');
    });
  }

  /** @description POST /mission (capability-gated multi-day loop) and render like evaluate. @returns {Promise<void>} */
  function runMission() {
    const days = Math.max(1, Math.min(14, Number($('missionDays').value) || 3));
    return run('Mission, ' + days + ' d', async () => {
      const r = await api('POST', '/mission', { design: state.design, days });
      if (r.energy) renderEnergy(r.energy);
      if (r.build && Array.isArray(r.build.massBreakdown)) renderMass(r.build);
      renderVerdict(r);
      renderFingerprint('mission ' + days + ' d');
    });
  }

  /** @description POST /export then list each generated build file as a download link. @returns {Promise<void>} */
  function runExport() {
    return run('Build package export', async () => {
      const r = await api('POST', '/export', { design: state.design });
      const files = Array.isArray(r.files) ? r.files : [];
      $('exportCard').innerHTML = '<div class="note">Export <b>' + esc(r.exportId || '?') + '</b> — ' +
        files.length + ' file(s) generated by the engine:</div>';
      $('exportList').innerHTML = files.map((f) =>
        '<a href="/api/aero-lab/export/' + encodeURIComponent(r.exportId) + '/' + encodeURIComponent(f) +
        '" download>' + esc(f) + '</a>').join('');
    });
  }

  /* ── SVG plotting (hand-rolled, themed, no external libs) ─────────────── */

  const NS = 'http://www.w3.org/2000/svg';

  /**
   * @description Create an SVG element with attributes.
   * @param {string} tag - SVG tag name.
   * @param {object} at - Attribute map.
   * @returns {SVGElement} The element.
   */
  function el(tag, at) {
    const e = document.createElementNS(NS, tag);
    for (const k in at) e.setAttribute(k, at[k]);
    return e;
  }

  /**
   * @description Round tick steps to 1/2/5 decades over a range.
   * @param {number} lo - Range low. @param {number} hi - Range high. @param {number} n - Target tick count.
   * @returns {number[]} Tick values.
   */
  function ticks(lo, hi, n) {
    const span = hi - lo || 1;
    const raw = span / n;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || mag * 10;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step / 1e6; v += step) out.push(Number(v.toFixed(10)));
    return out;
  }

  /**
   * @description Generic themed multi-series line chart with grid, axis labels,
   * optional shaded x-bands (night), an optional highlighted point, direct series
   * labels, and a nearest-point hover tooltip. 2px lines per the mark spec.
   * @param {HTMLElement} host - Container to (re)fill.
   * @param {object} o - { series: [{name,color,xs,ys}], xLabel, yLabel, shades, mark, height }
   * @returns {void}
   */
  function linePlot(host, o) {
    host.innerHTML = '';
    const W = Math.max(280, Math.min(host.clientWidth || 460, 900));
    const H = o.height || 190;
    const P = { l: 44, r: 66, t: 8, b: 26 };
    const xs = o.series.flatMap((s) => s.xs);
    const ys = o.series.flatMap((s) => s.ys).filter(Number.isFinite);
    if (!xs.length || !ys.length) { host.innerHTML = '<div class="empty">Engine returned no points for this plot.</div>'; return; }
    let [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    if (o.y0 != null) y0 = Math.min(y0, o.y0);
    if (o.y1 != null) y1 = Math.max(y1, o.y1);
    if (y0 === y1) { y0 -= 1; y1 += 1; }
    const sx = (v) => P.l + (v - x0) / (x1 - x0 || 1) * (W - P.l - P.r);
    const sy = (v) => H - P.b - (v - y0) / (y1 - y0 || 1) * (H - P.t - P.b);
    const svg = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H });
    for (const sh of o.shades || []) {
      svg.appendChild(el('rect', {
        x: sx(sh[0]), y: P.t, width: Math.max(0, sx(sh[1]) - sx(sh[0])), height: H - P.t - P.b,
        fill: 'currentColor', opacity: 0.08,
      }));
    }
    for (const t of ticks(y0, y1, 4)) {
      svg.appendChild(el('line', { class: 'grid', x1: P.l, x2: W - P.r, y1: sy(t), y2: sy(t) }));
      const tx = el('text', { x: P.l - 5, y: sy(t) + 3, 'text-anchor': 'end', class: 'dim' });
      tx.textContent = String(t);
      svg.appendChild(tx);
    }
    for (const t of ticks(x0, x1, 6)) {
      const tx = el('text', { x: sx(t), y: H - P.b + 13, 'text-anchor': 'middle', class: 'dim' });
      tx.textContent = String(t);
      svg.appendChild(tx);
    }
    svg.appendChild(el('line', { class: 'axis', x1: P.l, x2: W - P.r, y1: H - P.b, y2: H - P.b }));
    svg.appendChild(el('line', { class: 'axis', x1: P.l, x2: P.l, y1: P.t, y2: H - P.b }));
    const xl = el('text', { x: (P.l + W - P.r) / 2, y: H - 3, 'text-anchor': 'middle', class: 'dim' });
    xl.textContent = o.xLabel || '';
    svg.appendChild(xl);
    const yl = el('text', { x: 10, y: P.t + 8, class: 'dim' });
    yl.textContent = o.yLabel || '';
    svg.appendChild(yl);
    o.series.forEach((s, i) => {
      const pts = s.xs.map((x, j) => [x, s.ys[j]]).filter((p) => Number.isFinite(p[1]));
      svg.appendChild(el('polyline', {
        points: pts.map((p) => sx(p[0]).toFixed(1) + ',' + sy(p[1]).toFixed(1)).join(' '),
        fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round',
      }));
      if (o.series.length > 1 && i < 4 && pts.length) {
        const last = pts[pts.length - 1];
        const lb = el('text', { x: sx(last[0]) + 4, y: sy(last[1]) + 3 });
        lb.textContent = s.name;
        svg.appendChild(lb);
      }
    });
    if (o.mark && Number.isFinite(o.mark.x) && Number.isFinite(o.mark.y)) {
      svg.appendChild(el('circle', { cx: sx(o.mark.x), cy: sy(o.mark.y), r: 4, fill: o.mark.color || 'currentColor', stroke: 'var(--bg-primary, #06080f)', 'stroke-width': 2 }));
      const mt = el('text', { x: sx(o.mark.x) + 7, y: sy(o.mark.y) - 6 });
      mt.textContent = o.mark.label || '';
      svg.appendChild(mt);
    }
    attachHover(svg, o, sx, x0, x1, P, W, H);
    host.appendChild(svg);
  }

  /**
   * @description Nearest-x hover tooltip for a line chart: crosshair readout of
   * every series at the hovered x, in an opaque tooltip (translucency rule).
   * @param {SVGElement} svg - Chart. @param {object} o - linePlot options.
   * @param {Function} sx - x scale. @param {number} x0 - Min x. @param {number} x1 - Max x.
   * @param {object} P - Padding. @param {number} W - Width. @param {number} H - Height.
   * @returns {void}
   */
  function attachHover(svg, o, sx, x0, x1, P, W, H) {
    const tip = $('tooltip');
    svg.addEventListener('mousemove', (ev) => {
      const r = svg.getBoundingClientRect();
      const fx = x0 + (ev.clientX - r.left - P.l) / (W - P.l - P.r) * (x1 - x0);
      if (fx < x0 || fx > x1) { tip.style.display = 'none'; return; }
      const lines = [(o.xLabel || 'x') + ' ' + fx.toFixed(2)];
      for (const s of o.series) {
        let bi = 0;
        for (let i = 1; i < s.xs.length; i++) if (Math.abs(s.xs[i] - fx) < Math.abs(s.xs[bi] - fx)) bi = i;
        if (Number.isFinite(s.ys[bi])) lines.push(s.name + ' ' + Number(s.ys[bi]).toFixed(3));
      }
      tip.textContent = lines.join('\n');
      tip.style.display = 'block';
      tip.style.left = Math.min(ev.clientX + 14, window.innerWidth - 150) + 'px';
      tip.style.top = (ev.clientY + 12) + 'px';
    });
    svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  }

  /**
   * @description Horizontal single-hue bar rows (magnitude by length, per the
   * dataviz form rule) with visible value labels — used for the drag buildup.
   * @param {HTMLElement} host - Container.
   * @param {Array<{label:string, value:number}>} items - Bars.
   * @param {number} dp - Value decimals.
   * @param {string} unit - Value unit suffix.
   * @returns {void}
   */
  function barPlot(host, items, dp, unit) {
    const max = Math.max(...items.map((i) => i.value), 0) || 1;
    host.innerHTML = items.map((i) => {
      const pct = Math.max(1.2, i.value / max * 100);
      return '<div style="display:grid;grid-template-columns:130px 1fr 78px;gap:8px;align-items:center;margin:3px 0;font-size:11.5px">' +
        '<span style="color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(i.label) + '">' + esc(i.label) + '</span>' +
        '<span style="background:color-mix(in srgb, var(--line) 45%, transparent);border-radius:4px;height:12px;overflow:hidden;display:block">' +
        '<span style="display:block;height:100%;width:' + pct.toFixed(1) + '%;background:var(--accent);border-radius:0 4px 4px 0"></span></span>' +
        '<span style="text-align:right;font-variant-numeric:tabular-nums">' + fmt(i.value, dp) + esc(unit) + '</span></div>';
    }).join('');
  }

  /**
   * @description Mass-ledger donut: engine breakdown labels verbatim, fixed-order
   * validated categorical palette, 2px surface gaps between slices, legend with
   * visible kg + % values (the light-mode contrast relief).
   * @param {HTMLElement} host - SVG container.
   * @param {HTMLElement} legendHost - Legend container.
   * @param {Array<{label:string, kg:number}>} items - Engine massBreakdown.
   * @param {number} totalKg - Engine all-up mass.
   * @returns {void}
   */
  function donut(host, legendHost, items, totalKg) {
    const pal = series();
    let slices = items.filter((i) => Number.isFinite(i.kg) && i.kg > 0);
    if (slices.length > pal.length) {
      const keep = slices.slice().sort((a, b) => b.kg - a.kg).slice(0, pal.length - 1);
      const rest = slices.filter((s) => !keep.includes(s));
      slices = keep.concat([{ label: 'other', kg: rest.reduce((a, s) => a + s.kg, 0) }]);
    }
    const sum = slices.reduce((a, s) => a + s.kg, 0) || 1;
    const R = 62, r = 36, C = 75;
    const svg = el('svg', { width: 150, height: 150, viewBox: '0 0 150 150' });
    let a0 = -Math.PI / 2;
    slices.forEach((s, i) => {
      const a1 = a0 + s.kg / sum * Math.PI * 2;
      const big = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a, rad) => (C + rad * Math.cos(a)).toFixed(2) + ' ' + (C + rad * Math.sin(a)).toFixed(2);
      svg.appendChild(el('path', {
        d: 'M ' + p(a0, R) + ' A ' + R + ' ' + R + ' 0 ' + big + ' 1 ' + p(a1, R) +
           ' L ' + p(a1, r) + ' A ' + r + ' ' + r + ' 0 ' + big + ' 0 ' + p(a0, r) + ' Z',
        fill: pal[i], stroke: 'var(--bg-primary, #06080f)', 'stroke-width': 2,
      }));
      a0 = a1;
    });
    const ct = el('text', { x: C, y: C + 1, 'text-anchor': 'middle', style: 'font-size:13px;font-weight:600' });
    ct.textContent = fmt(totalKg, 2) + ' kg';
    svg.appendChild(ct);
    const cs = el('text', { x: C, y: C + 15, 'text-anchor': 'middle', class: 'dim' });
    cs.textContent = 'all-up';
    svg.appendChild(cs);
    host.innerHTML = '';
    host.appendChild(svg);
    legendHost.innerHTML = slices.map((s, i) =>
      '<span><span class="sw" style="background:' + pal[i] + '"></span>' + esc(s.label) +
      ' <b style="font-variant-numeric:tabular-nums">' + fmt(s.kg, 3) + ' kg</b> (' + (s.kg / sum * 100).toFixed(1) + '%)</span>').join('');
  }

  /* ── result renderers ─────────────────────────────────────────────────── */

  /**
   * @description Registry helper: render now AND remember the thunk so a cockpit
   * theme change repaints every chart with the palette steps for the new surface.
   * @param {string} key - Registry slot (one thunk per chart).
   * @param {Function} thunk - Zero-arg render.
   * @returns {void}
   */
  function remember(key, thunk) {
    state.rerenders = state.rerenders.filter((t) => t.key !== key);
    state.rerenders.push({ key, thunk });
    thunk();
  }

  /**
   * @description Polar card: CL(α) and CD(α) as separate panels (one axis each —
   * never dual-axis), plus an efficiency panel with L/D and CL^1.5/CD (both
   * dimensionless, same scale family). CL^1.5/CD is a display transform of the
   * engine's returned CL/CD columns.
   * @param {object} r - POST /polar response.
   * @returns {void}
   */
  function renderPolar(r) {
    const p = r.polar || {};
    if (!Array.isArray(p.alpha_deg) || !p.alpha_deg.length) { showError({ status: 200, body: { error: 'Polar response carried no points' } }); return; }
    const card = $('polarCard');
    card.querySelector('.empty') && card.querySelector('.empty').remove();
    const panels = $('polarPanels');
    panels.innerHTML = '<div><div class="plot" id="pp-cl"></div></div><div><div class="plot" id="pp-cd"></div></div><div><div class="plot" id="pp-eff"></div><div class="plot-legend" id="pp-eff-lg"></div></div>';
    const a = p.alpha_deg;
    const e15 = p.CL.map((cl, i) => (cl > 0 && p.CD[i] > 0) ? Math.pow(cl, 1.5) / p.CD[i] : NaN);
    const ld = Array.isArray(p.LD) ? p.LD : p.CL.map((cl, i) => p.CD[i] > 0 ? cl / p.CD[i] : NaN);
    remember('polar', () => {
      const s = series();
      linePlot($('pp-cl'), { series: [{ name: 'CL', color: s[0], xs: a, ys: p.CL }], xLabel: 'α °', yLabel: 'CL', height: 170 });
      linePlot($('pp-cd'), { series: [{ name: 'CD', color: s[1], xs: a, ys: p.CD }], xLabel: 'α °', yLabel: 'CD', height: 170, y0: 0 });
      linePlot($('pp-eff'), {
        series: [{ name: 'L/D', color: s[0], xs: a, ys: ld }, { name: 'CL^1.5/CD', color: s[2], xs: a, ys: e15 }],
        xLabel: 'α °', yLabel: 'endurance efficiency', height: 170, y0: 0,
      });
      $('pp-eff-lg').innerHTML =
        '<span><span class="sw" style="background:' + s[0] + '"></span>L/D</span>' +
        '<span><span class="sw" style="background:' + s[2] + '"></span>CL<sup>1.5</sup>/CD</span>' +
        (r.cruise ? '<span class="note">cruise: V ' + fmt(r.cruise.V_ms, 2) + ' m/s · CL ' + fmt(r.cruise.CL, 3) + ' · Re ' + fmt(r.cruise.Re, 0) + '</span>' : '');
    });
  }

  /**
   * @description SOC card: the engine's 24 h (or multi-day) limit-cycle trace with
   * night bands derived from the engine's own p_gen_W==0 intervals, the min-SOC
   * marker, and a generation-vs-load companion chart.
   * @param {object} e - Evaluate response `energy` block.
   * @returns {void}
   */
  function renderEnergy(e) {
    if (!Array.isArray(e.t_s) || !e.t_s.length) { showError({ status: 200, body: { error: 'Energy response carried no trace' } }); return; }
    const card = $('socCard');
    card.querySelector('.empty') && card.querySelector('.empty').remove();
    const th = e.t_s.map((t) => t / 3600);
    const shades = [];
    if (Array.isArray(e.p_gen_W)) {
      let start = null;
      for (let i = 0; i < th.length; i++) {
        const night = e.p_gen_W[i] <= 0;
        if (night && start == null) start = th[i];
        if ((!night || i === th.length - 1) && start != null) { shades.push([start, th[i]]); start = null; }
      }
    }
    let minI = 0;
    e.soc.forEach((v, i) => { if (v < e.soc[minI]) minI = i; });
    remember('soc', () => {
      const s = series();
      linePlot($('socPlot'), {
        series: [{ name: 'SOC', color: s[0], xs: th, ys: e.soc }],
        xLabel: 'h', yLabel: 'state of charge', height: 210, y0: 0, y1: 1, shades,
        mark: { x: th[minI], y: e.soc[minI], color: s[7], label: 'min SOC ' + fmt(e.minSoc != null ? e.minSoc : e.soc[minI], 4) },
      });
      $('socLegend').innerHTML =
        '<span><span class="sw" style="background:' + s[0] + '"></span>SOC</span>' +
        '<span class="note">shaded: engine night (P_gen = 0)</span>' +
        (e.usable != null ? '<span class="note">usable margin ' + fmt(e.usable, 4) + '</span>' : '');
      if (Array.isArray(e.p_gen_W) && Array.isArray(e.p_load_W)) {
        $('powerCard').style.display = '';
        linePlot($('powerPlot'), {
          series: [{ name: 'P_gen', color: s[2], xs: th, ys: e.p_gen_W }, { name: 'P_load', color: s[1], xs: th, ys: e.p_load_W }],
          xLabel: 'h', yLabel: 'W', height: 150, y0: 0, shades,
        });
        $('powerLegend').innerHTML =
          '<span><span class="sw" style="background:' + s[2] + '"></span>P_gen</span>' +
          '<span><span class="sw" style="background:' + s[1] + '"></span>P_load</span>';
      }
    });
  }

  /** @description Drag-buildup card from the engine's labeled CD components. @param {Array} items - dragBuildup. @returns {void} */
  function renderDrag(items) {
    $('dragCard').style.display = '';
    remember('drag', () => barPlot($('dragPlot'), items.map((i) => ({ label: i.label, value: i.CD })), 5, ''));
  }

  /** @description Mass-ledger card from the engine's build block. @param {object} b - Evaluate `build`. @returns {void} */
  function renderMass(b) {
    $('massCard').style.display = '';
    remember('mass', () => donut($('massPlot'), $('massLegend'),
      b.massBreakdown.map((m) => ({ label: m.label, kg: m.kg })), b.massAllUpKg));
  }

  /**
   * @description Verdict card. Renders ONLY what the engine returned: chips for
   * whichever of closed/admissible/certified exist in the response, the named
   * reasons verbatim, and the numeric margins present in the payload.
   * @param {object} r - Evaluate/screen/mission response.
   * @returns {void}
   */
  function renderVerdict(r) {
    const v = r.verdict || {};
    const chips = [];
    const chip = (label, val) => '<span class="v-chip ' + (val ? 'good' : 'fail') + '">' + label + (val ? ' ✓' : ' ✕') + '</span>';
    if ('closed' in r) chips.push(chip('closed', r.closed));
    if ('admissible' in v) chips.push(chip('admissible', v.admissible));
    if ('certified' in v) chips.push(chip('certified', v.certified));
    if ('certified' in r) chips.push(chip('certified', r.certified));
    const kv = [];
    const e = r.energy || {};
    if (e.minSoc != null) kv.push(['min SOC', fmt(e.minSoc, 4)]);
    if (e.usable != null) kv.push(['usable margin', fmt(e.usable, 4)]);
    if (r.build) {
      if (r.build.massAllUpKg != null) kv.push(['all-up mass', fmt(r.build.massAllUpKg, 3) + ' kg']);
      if (r.build.spanM != null) kv.push(['span', fmt(r.build.spanM, 2) + ' m']);
      if (r.build.packWh != null) kv.push(['pack', fmt(r.build.packWh, 1) + ' Wh']);
    }
    const reasons = Array.isArray(v.reasons) ? v.reasons : [];
    $('verdictCard').innerHTML =
      (chips.length ? '<div class="v-chips">' + chips.join('') + '</div>' : '') +
      (kv.length ? '<div class="kv">' + kv.map(([k, val]) => '<span class="k">' + esc(k) + '</span><span class="v">' + esc(val) + '</span>').join('') + '</div>' : '') +
      (reasons.length
        ? '<ul id="reasons">' + reasons.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>'
        : ('admissible' in v && v.admissible ? '<div class="note" style="margin-top:6px">No screen objections — every reason list came back empty.</div>' : ''));
  }

  /**
   * @description The always-on honesty line under the verdict: engine fingerprint
   * (version, python) + live capability flags + which command produced the last
   * numbers on screen.
   * @param {string|null} lastCmd - Last engine command rendered, or null.
   * @returns {void}
   */
  function renderFingerprint(lastCmd) {
    const c = (state.caps && state.caps.capabilities) || {};
    const eng = (state.caps && state.caps.engine) || {};
    const flags = ['polar', 'evaluate', 'screen', 'mission', 'export', 'hybrid']
      .map((k) => k + (c[k] ? '✓' : '✕')).join(' ');
    $('fingerprint').textContent =
      'engine ' + (eng.version || 'version unknown') + ' · python ' + (eng.python || '?') +
      '\ncapabilities: ' + flags +
      (lastCmd ? '\nnumbers on screen: live engine "' + lastCmd + '" run' : '\nno engine numbers on screen yet');
  }

  /* ── chat (Draft with AI) ─────────────────────────────────────────────── */

  /**
   * @description Send a message to the aero-designer concierge. The reply's say
   * text joins the log; a returned draft is previewed field-by-field and applied
   * to the sliders only on an explicit click — never auto-run.
   * @returns {Promise<void>} Resolves when the exchange settles.
   */
  async function sendChat() {
    const input = $('chatInput');
    const msg = input.value.trim();
    if (!msg || state.busy) return;
    input.value = '';
    addMsg('user', msg);
    state.chat.push({ role: 'user', content: msg });
    const btn = $('chatSend');
    btn.disabled = true;
    try {
      const r = await api('POST', '/chat', { message: msg, history: state.chat.slice(-8) });
      addMsg('bot', r.say || '(no reply)');
      state.chat.push({ role: 'assistant', content: r.say || '' });
      if (r.draft && typeof r.draft === 'object') showDraft(r.draft);
      else $('draftBox').style.display = 'none';
    } catch (err) {
      addMsg('bot', errText(err));
    } finally {
      btn.disabled = false;
    }
  }

  /** @description Append a chat bubble. @param {string} who - 'user'|'bot'. @param {string} text - Content. @returns {void} */
  function addMsg(who, text) {
    const log = $('chatLog');
    const m = document.createElement('div');
    m.className = 'msg ' + who;
    m.textContent = text;
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
  }

  /**
   * @description Preview a concierge draft: known finite fields only, rendered as
   * a table with an Apply button. Unknown or non-finite fields void the draft
   * (a bad draft must never reach the sliders).
   * @param {object} draft - Draft design vector from /chat.
   * @returns {void}
   */
  function showDraft(draft) {
    const rows = [];
    for (const [k, v] of Object.entries(draft)) {
      if (!FIELD_BY_KEY[k] || !Number.isFinite(Number(v))) {
        $('draftBox').style.display = 'block';
        $('draftBox').innerHTML = '<div class="note">The concierge returned a draft with an invalid field (' + esc(k) + ') — discarded rather than applied.</div>';
        return;
      }
      rows.push([k, Number(v)]);
    }
    if (!rows.length) { $('draftBox').style.display = 'none'; return; }
    const box = $('draftBox');
    box.style.display = 'block';
    box.innerHTML = '<b>Design draft</b><table>' +
      rows.map(([k, v]) => '<tr><td>' + esc(FIELD_BY_KEY[k].label) + '</td><td>' + fmt(v, FIELD_BY_KEY[k].dp) + ' ' + esc(FIELD_BY_KEY[k].unit) + '</td></tr>').join('') +
      '</table><button id="applyDraft" class="primary">Apply to sliders</button> <span class="note">then press Run yourself</span>';
    $('applyDraft').addEventListener('click', () => {
      for (const [k, v] of rows) setField(k, v, 'code');
      state.presetHull = '';
      $('presetNote').textContent = 'AI draft applied to the sliders — the engine has not judged it yet. Press Run.';
      $('runStatus').textContent = 'draft applied — press Run';
      box.style.display = 'none';
    });
  }

  /* ── theme change repaint ─────────────────────────────────────────────── */

  /** @description Repaint every rendered chart with the palette for the (possibly new) surface. @returns {void} */
  function repaintCharts() { for (const t of state.rerenders) t.thunk(); }

  /* ── boot ─────────────────────────────────────────────────────────────── */

  function init() {
    buildForm();
    buildPresets();
    applyPreset(D.presets[0]);            // Tier-1 sketch: the operator's own starting point
    $('btnPolar').addEventListener('click', runPolar);
    $('btnEval').addEventListener('click', runEvaluate);
    $('btnScreen').addEventListener('click', runScreen);
    $('btnMission').addEventListener('click', runMission);
    $('btnExport').addEventListener('click', runExport);
    $('chatSend').addEventListener('click', sendChat);
    $('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
    // Cockpit theme changes: surface-theme.js flips data-theme live; storage covers other tabs.
    new MutationObserver(repaintCharts).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.addEventListener('storage', repaintCharts);
    window.addEventListener('resize', (() => { let t; return () => { clearTimeout(t); t = setTimeout(repaintCharts, 200); }; })());
    renderFingerprint(null);
    loadCaps();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
