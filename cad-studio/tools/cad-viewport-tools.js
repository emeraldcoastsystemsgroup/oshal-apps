/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | 0.5.0: live CAD viewport tools for Measure in mm/in (RP-CAD-01), 7-orientation 3D View Cube + Fit to view (RP-CAD-02), iOS USDZ Quick Look + Android GLB Scene Viewer + ISO/IEC 18004 SVG QR View in AR (RP-CAD-04), and honest Scan to Print / OctoPrint / Moonraker / PrusaLink / local slicer Send to printer handoff (RP-CAD-05).
 */
(function () {
  'use strict';

  const QR_VERSIONS = [
    null,
    { size: 21, totalCodewords: 26, ecCodewords: 7, align: [] },
    { size: 25, totalCodewords: 44, ecCodewords: 10, align: [6, 18] },
    { size: 29, totalCodewords: 70, ecCodewords: 15, align: [6, 22] },
    { size: 33, totalCodewords: 100, ecCodewords: 20, align: [6, 26] },
    { size: 37, totalCodewords: 134, ecCodewords: 26, align: [6, 30] },
    { size: 41, totalCodewords: 172, ecCodewords: 18, blocks: 2, align: [6, 34] },
  ];

  const GF_EXP = new Uint8Array(512);
  const GF_LOG = new Uint8Array(256);
  (function initGalois() {
    let x = 1;
    for (let i = 0; i < 255; i += 1) {
      GF_EXP[i] = x; GF_LOG[x] = i;
      x <<= 1; if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
  })();

  function gfMul(a, b) {
    return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  function rsGenerator(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i += 1) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j += 1) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsRemainder(data, ecLen) {
    const gen = rsGenerator(ecLen);
    const rem = new Uint8Array(ecLen);
    for (let i = 0; i < data.length; i += 1) {
      const factor = data[i] ^ rem[0];
      rem.copyWithin(0, 1); rem[ecLen - 1] = 0;
      for (let j = 0; j < ecLen; j += 1) rem[j] ^= gfMul(gen[j + 1], factor);
    }
    return rem;
  }

  function buildCodewords(bytes, spec) {
    const blocks = spec.blocks || 1;
    const dataTotal = spec.totalCodewords - spec.ecCodewords * blocks;
    const bits = [];
    const pushBits = (val, len) => { for (let i = len - 1; i >= 0; i -= 1) bits.push((val >>> i) & 1); };
    pushBits(0b0100, 4);
    pushBits(bytes.length, 8);
    for (let i = 0; i < bytes.length; i += 1) pushBits(bytes[i], 8);
    for (let i = 0; i < 4 && bits.length < dataTotal * 8; i += 1) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);
    const dataBytes = new Uint8Array(dataTotal);
    for (let i = 0; i < bits.length / 8; i += 1) {
      let b = 0;
      for (let k = 0; k < 8; k += 1) b = (b << 1) | bits[i * 8 + k];
      dataBytes[i] = b;
    }
    for (let i = bits.length / 8, p = 0; i < dataTotal; i += 1, p ^= 1) dataBytes[i] = p === 0 ? 0xec : 0x11;
    if (blocks === 1) {
      const ec = rsRemainder(dataBytes, spec.ecCodewords);
      const all = new Uint8Array(spec.totalCodewords);
      all.set(dataBytes, 0); all.set(ec, dataBytes.length);
      return all;
    }
    const half = dataTotal / 2;
    const b0 = dataBytes.subarray(0, half), b1 = dataBytes.subarray(half);
    const e0 = rsRemainder(b0, spec.ecCodewords), e1 = rsRemainder(b1, spec.ecCodewords);
    const out = new Uint8Array(spec.totalCodewords);
    let pos = 0;
    for (let i = 0; i < half; i += 1) { out[pos++] = b0[i]; out[pos++] = b1[i]; }
    for (let i = 0; i < spec.ecCodewords; i += 1) { out[pos++] = e0[i]; out[pos++] = e1[i]; }
    return out;
  }

  function stampFinder(grid, used, r0, c0, size) {
    for (let dr = -1; dr <= 7; dr += 1) for (let dc = -1; dc <= 7; dc += 1) {
      const r = r0 + dr, c = c0 + dc;
      if (r < 0 || c < 0 || r >= size || c >= size) continue;
      const dark = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
      grid[r][c] = dark ? 1 : 0; used[r][c] = true;
    }
  }

  function reservePatterns(grid, used, spec) {
    const n = spec.size;
    stampFinder(grid, used, 0, 0, n);
    stampFinder(grid, used, 0, n - 7, n);
    stampFinder(grid, used, n - 7, 0, n);
    for (let i = 8; i < n - 8; i += 1) {
      grid[6][i] = i % 2 === 0 ? 1 : 0; used[6][i] = true;
      grid[i][6] = i % 2 === 0 ? 1 : 0; used[i][6] = true;
    }
    for (const r of spec.align) for (const c of spec.align) {
      if (used[r][c]) continue;
      for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) {
        grid[r + dr][c + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0;
        used[r + dr][c + dc] = true;
      }
    }
    for (let i = 0; i < 9; i += 1) {
      if (i < n) { used[8][i] = true; used[i][8] = true; }
      if (i < 8) { used[8][n - 1 - i] = true; used[n - 1 - i][8] = true; }
    }
    grid[n - 8][8] = 1; used[n - 8][8] = true;
  }

  function writeFormatBits(grid, n) {
    let rem = (0b01000 << 10);
    for (let i = 14; i >= 10; i -= 1) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
    const fmt = ((0b01000 << 10) | rem) ^ 0x5412;
    const coordsA = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
    const coordsB = [[n - 1, 8], [n - 2, 8], [n - 3, 8], [n - 4, 8], [n - 5, 8], [n - 6, 8], [n - 7, 8], [8, n - 8], [8, n - 7], [8, n - 6], [8, n - 5], [8, n - 4], [8, n - 3], [8, n - 2], [8, n - 1]];
    for (let i = 0; i < 15; i += 1) {
      const bit = (fmt >>> i) & 1;
      grid[coordsA[i][0]][coordsA[i][1]] = bit;
      grid[coordsB[i][0]][coordsB[i][1]] = bit;
    }
  }

  function encodeQrMatrix(text) {
    const bytes = new TextEncoder().encode(String(text || ''));
    let spec = null;
    for (let v = 1; v < QR_VERSIONS.length; v += 1) {
      const candidate = QR_VERSIONS[v];
      const cap = candidate.totalCodewords - candidate.ecCodewords * (candidate.blocks || 1) - 2;
      if (bytes.length <= cap) { spec = candidate; break; }
    }
    if (!spec) throw new RangeError('QR payload exceeds supported length');
    const n = spec.size;
    const grid = Array.from({ length: n }, () => new Uint8Array(n));
    const used = Array.from({ length: n }, () => new Array(n).fill(false));
    reservePatterns(grid, used, spec);
    const codewords = buildCodewords(bytes, spec);
    let bitIdx = 0, upward = true;
    for (let col = n - 1; col > 0; col -= 2) {
      if (col === 6) col -= 1;
      for (let step = 0; step < n; step += 1) {
        const r = upward ? n - 1 - step : step;
        for (let dc = 0; dc < 2; dc += 1) {
          const c = col - dc;
          if (used[r][c]) continue;
          const bit = bitIdx < codewords.length * 8 ? (codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1 : 0;
          bitIdx += 1;
          grid[r][c] = bit ^ ((r + c) % 2 === 0 ? 1 : 0);
        }
      }
      upward = !upward;
    }
    writeFormatBits(grid, n);
    return grid;
  }

  function renderQrSvg(doc, text, label) {
    const matrix = encodeQrMatrix(text);
    const quiet = 4, total = matrix.length + quiet * 2;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
    svg.setAttribute('width', '184');
    svg.setAttribute('height', '184');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label || 'QR code for AR preview');
    const bg = doc.createElementNS(ns, 'rect');
    bg.setAttribute('width', String(total)); bg.setAttribute('height', String(total)); bg.setAttribute('fill', '#ffffff');
    svg.appendChild(bg);
    const pathEl = doc.createElementNS(ns, 'path');
    const segs = [];
    for (let r = 0; r < matrix.length; r += 1) {
      for (let c = 0; c < matrix.length; c += 1) {
        if (matrix[r][c]) segs.push(`M${c + quiet},${r + quiet}h1v1h-1z`);
      }
    }
    pathEl.setAttribute('d', segs.join(''));
    pathEl.setAttribute('fill', '#111827');
    svg.appendChild(pathEl);
    return svg;
  }

  function formatMeasureReadout(m) {
    if (!m || m.mode === 'off') return '';
    if (m.pending) return m.pending;
    const dec = m.unit === 'in' ? 3 : 2;
    const f = (n) => Number(n).toFixed(dec);
    if (m.mode === 'bbox') {
      return `Bounds: ${f(m.sizeX)} × ${f(m.sizeY)} × ${f(m.sizeZ)} ${m.unit} · Diagonal ${f(m.diagonal)} ${m.unit}`;
    }
    if (m.mode === 'face') {
      return m.parallelOffset !== null && m.parallelOffset !== undefined
        ? `Parallel faces: ${f(m.parallelOffset)} ${m.unit} apart · Angle ${m.angleDeg.toFixed(1)}°`
        : `Face dihedral angle: ${m.angleDeg.toFixed(1)}°`;
    }
    const prefix = m.mode === 'edge' ? 'Edge length' : 'Distance';
    return `${prefix}: ${f(m.distance)} ${m.unit} (ΔX ${f(m.dx)} · ΔY ${f(m.dy)} · ΔZ ${f(m.dz)} ${m.unit})`;
  }

  function bindViewCube(app) {
    const cube = document.querySelector('.viewer-cube');
    if (!cube) return;
    const buttons = [...cube.querySelectorAll('[data-cad-view]')];
    const syncActive = (name) => {
      buttons.forEach((btn) => btn.setAttribute('aria-pressed', String(btn.getAttribute('data-cad-view') === name)));
    };
    buttons.forEach((btn) => btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-cad-view');
      const v = app.getViewer();
      if (v && v.setView) v.setView(view);
      syncActive(view);
    }));
    const fit = document.getElementById('view-fit');
    if (fit) fit.addEventListener('click', () => { const v = app.getViewer(); if (v && v.fitToView) v.fitToView(); });
    return syncActive;
  }

  function bindMeasureTools(app) {
    const btn = document.getElementById('tool-measure'), bar = document.getElementById('cad-measure-bar');
    const readout = document.getElementById('cad-measure-readout'), unitSel = document.getElementById('cad-measure-unit');
    const clearBtn = document.getElementById('cad-measure-clear');
    if (!btn || !bar) return () => {};
    let activeMode = 'point';
    const modeBtns = [...bar.querySelectorAll('[data-measure-mode]')];
    const syncModes = () => modeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-measure-mode') === activeMode)));
    btn.addEventListener('click', () => {
      const open = bar.hidden;
      bar.hidden = !open;
      btn.setAttribute('aria-pressed', String(open));
      const v = app.getViewer();
      if (v && v.setMeasureMode) v.setMeasureMode(open ? activeMode : 'off');
    });
    modeBtns.forEach((b) => b.addEventListener('click', () => {
      activeMode = b.getAttribute('data-measure-mode') || 'point';
      syncModes();
      const v = app.getViewer();
      if (v && v.setMeasureMode && !bar.hidden) v.setMeasureMode(activeMode);
    }));
    if (unitSel) unitSel.addEventListener('change', () => {
      const v = app.getViewer();
      if (v && v.setUnit) v.setUnit(unitSel.value);
    });
    if (clearBtn) clearBtn.addEventListener('click', () => {
      const v = app.getViewer();
      if (v && v.clearMeasure) v.clearMeasure();
    });
    syncModes();
    return (payload) => { if (readout) readout.textContent = formatMeasureReadout(payload); };
  }

  function bindArSheet(app) {
    const btn = document.getElementById('tool-ar'), sheet = document.getElementById('ar-sheet');
    if (!btn || !sheet) return;
    sheet.addEventListener('click', (ev) => { if (ev.target === sheet || ev.target.closest?.('[data-cs-close]')) sheet.close(); });
    const openAr = () => {
      const m = app.getModel();
      if (!m || m.revision < 1) { app.toast('Build a part before opening AR.', 'error'); return; }
      const rev = m.revision;
      const usdzRel = `/api/cad-studio/models/${m.model_id}/artifacts/usdz?revision=${rev}`;
      const glbRel = `/api/cad-studio/models/${m.model_id}/artifacts/glb?revision=${rev}`;
      const glbAbs = new URL(glbRel, window.location.origin).href;
      const handoffUrl = new URL(`/api/cad-studio/app?model=${encodeURIComponent(m.model_id)}&ar=1`, window.location.origin).href;
      const usdzLink = document.getElementById('cad-ar-usdz');
      const androidLink = document.getElementById('cad-ar-android');
      const glbDl = document.getElementById('cad-ar-glb-dl');
      const usdzDl = document.getElementById('cad-ar-usdz-dl');
      if (usdzLink) usdzLink.setAttribute('href', usdzRel);
      if (androidLink) {
        androidLink.setAttribute('href', `intent://arvr.google.com/scene-viewer/1.0?file=${encodeURIComponent(glbAbs)}&mode=ar_preferred&title=${encodeURIComponent(m.title)}#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(glbAbs)};end;`);
      }
      if (glbDl) glbDl.setAttribute('href', `${glbRel}&download`);
      if (usdzDl) usdzDl.setAttribute('href', `${usdzRel}&download`);
      const qrBox = document.getElementById('cad-ar-qr');
      if (qrBox) qrBox.replaceChildren(renderQrSvg(document, handoffUrl, `Scan to view ${m.title} in AR`));
      if (!sheet.open) sheet.showModal();
    };
    btn.addEventListener('click', openAr);
    return openAr;
  }

  async function refreshSwarmPrinters(app, listNode) {
    if (!listNode) return;
    listNode.replaceChildren();
    const note = document.createElement('p');
    note.className = 'small muted';
    note.textContent = 'Checking Scan to Print printers…';
    listNode.appendChild(note);
    try {
      const res = await fetch('/api/scan-to-print/printers', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!res.ok) { note.textContent = 'Scan to Print printer registry is not active on this workspace.'; return; }
      const body = await res.json();
      const printers = Array.isArray(body?.printers) ? body.printers : [];
      if (!printers.length) { note.textContent = 'No printers are registered in Scan to Print yet.'; return; }
      listNode.replaceChildren();
      printers.forEach((p) => {
        const row = document.createElement('div'); row.className = 'row';
        const lbl = document.createElement('span'); lbl.textContent = `${p.label} (${p.kind})`; lbl.style.flex = '1';
        const sendBtn = document.createElement('button'); sendBtn.type = 'button'; sendBtn.className = 'ghost'; sendBtn.textContent = 'Queue STL';
        sendBtn.addEventListener('click', () => queueViaScanToPrint(app, p, sendBtn));
        row.append(lbl, sendBtn); listNode.appendChild(row);
      });
    } catch (_) {
      note.textContent = 'Scan to Print is unavailable here; use a direct HTTP printer URL or download 3MF/STL below.';
    }
  }

  async function queueViaScanToPrint(app, printer, btn) {
    const m = app.getModel();
    if (!m || m.revision < 1) return;
    const statusEl = document.getElementById('printer-status-msg');
    btn.disabled = true;
    try {
      const stlRes = await fetch(`/api/cad-studio/models/${m.model_id}/artifacts/stl?revision=${m.revision}`, { credentials: 'same-origin' });
      if (!stlRes.ok) throw new Error('Could not read revision STL');
      const blob = new Blob([await stlRes.arrayBuffer()], { type: 'model/stl' });
      const form = new FormData();
      form.append('file', blob, `${(m.title || 'part').replace(/[^A-Za-z0-9._-]+/g, '_')}.stl`);
      form.append('printerId', printer.printer_id);
      form.append('confirm', 'true');
      const res = await fetch('/api/scan-to-print/service/print', { method: 'POST', body: form, credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      const msg = data.started ? `Sent to ${printer.label} and started.` : `Uploaded to ${printer.label} (${data.state || 'stored'} — start on the printer when sliced).`;
      if (statusEl) statusEl.textContent = msg;
      app.toast(msg, 'ok');
    } catch (err) {
      if (statusEl) statusEl.textContent = err.message;
      app.toast(err.message, 'error');
    } finally { btn.disabled = false; }
  }

  function readDirectConfig() {
    return {
      kind: document.getElementById('printer-kind')?.value || 'octoprint',
      baseUrl: (document.getElementById('printer-url')?.value || '').trim(),
      apiKey: (document.getElementById('printer-apikey')?.value || '').trim(),
      format: document.getElementById('printer-format')?.value === 'stl' ? 'stl' : '3mf',
      startPrint: Boolean(document.getElementById('printer-start')?.checked),
    };
  }

  function bindPrinterSheet(app) {
    const trigger = document.getElementById('send-printer'), sheet = document.getElementById('print-sheet');
    if (!trigger || !sheet) return;
    const statusEl = document.getElementById('printer-status-msg');
    sheet.addEventListener('click', (ev) => { if (ev.target === sheet || ev.target.closest?.('[data-cs-close]')) sheet.close(); });
    trigger.addEventListener('click', () => {
      const m = app.getModel();
      if (!m || m.revision < 1) { app.toast('Build the part before sending to a printer.', 'error'); return; }
      document.getElementById('export-sheet')?.close();
      const stem = (m.title || 'part').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'part';
      const dl3mf = document.getElementById('printer-dl-3mf'), dlStl = document.getElementById('printer-dl-stl');
      if (dl3mf) { dl3mf.setAttribute('href', `/api/cad-studio/models/${m.model_id}/artifacts/3mf?revision=${m.revision}&download`); dl3mf.setAttribute('download', `${stem}-r${m.revision}.3mf`); }
      if (dlStl) { dlStl.setAttribute('href', `/api/cad-studio/models/${m.model_id}/artifacts/stl?revision=${m.revision}&download`); dlStl.setAttribute('download', `${stem}-r${m.revision}.stl`); }
      if (statusEl) statusEl.textContent = readDirectConfig().baseUrl ? 'Ready to check status or upload.' : 'No direct printer URL configured yet. Configure one below or download 3MF/STL for your slicer.';
      void refreshSwarmPrinters(app, document.getElementById('stp-printer-list'));
      if (!sheet.open) sheet.showModal();
    });
    document.getElementById('printer-check')?.addEventListener('click', async () => {
      const cfg = readDirectConfig();
      if (!cfg.baseUrl) { if (statusEl) statusEl.textContent = 'No printer URL is configured. Enter an http:// or https:// printer address first.'; return; }
      if (statusEl) statusEl.textContent = 'Checking printer connection…';
      try {
        const out = await app.api('/printers/status', { method: 'POST', json: { printer: cfg } });
        if (statusEl) statusEl.textContent = `Connected (${out.kind}): ${out.printerState}.`;
      } catch (err) { if (statusEl) statusEl.textContent = err.message; }
    });
    document.getElementById('printer-upload')?.addEventListener('click', async () => {
      const m = app.getModel(), cfg = readDirectConfig();
      if (!m) return;
      if (!cfg.baseUrl) { if (statusEl) statusEl.textContent = 'Cannot send: no printer URL is configured. Enter a printer URL or download 3MF/STL for your slicer.'; return; }
      if (statusEl) statusEl.textContent = `Uploading ${cfg.format.toUpperCase()} to ${cfg.baseUrl}…`;
      try {
        const out = await app.api(`/models/${m.model_id}/print`, { method: 'POST', json: { confirm: true, format: cfg.format, startPrint: cfg.startPrint, printer: cfg } });
        if (statusEl) statusEl.textContent = out.message;
        app.toast(out.message, 'ok');
      } catch (err) { if (statusEl) statusEl.textContent = err.message; app.toast(err.message, 'error'); }
    });
  }

  function initCadViewportTools(app) {
    const syncCube = bindViewCube(app);
    const onMeasure = bindMeasureTools(app);
    const openAr = bindArSheet(app);
    bindPrinterSheet(app);
    return {
      attachViewer(viewer) {
        if (!viewer || !viewer.setCallbacks) return;
        viewer.setCallbacks({ onMeasure, onViewChange: syncCube });
      },
      onModelLoaded() {
        const q = new URLSearchParams(window.location.search);
        if (q.get('ar') === '1' && openAr) openAr();
      },
    };
  }

  window.CadStudioQr = { encodeQrMatrix, renderQrSvg };
  window.CadViewportTools = { initCadViewportTools, formatMeasureReadout };
})();
