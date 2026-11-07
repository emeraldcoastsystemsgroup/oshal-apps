/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | 0.10.0: interactive 3D Crop (RP-SCN-01), Rotate / Lay-flat leveling (RP-SCN-02), Point-to-point 3D Measure (RP-SCN-03), revocable Share sheet (RP-SCN-05), and View in AR sheet with iOS Quick Look, Android Scene Viewer, and pure-JS ISO/IEC 18004 SVG QR handoff (RP-SCN-06).
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ── Pure-JS ISO/IEC 18004 QR Code (Byte Mode, ECC Level L, Versions 1..9) ──
  const QR_VERSIONS = [
    null,
    { size: 21, total: 26, data: 19, ecPerBlock: 7, blocks: 1, align: [] },
    { size: 25, total: 44, data: 34, ecPerBlock: 10, blocks: 1, align: [6, 18] },
    { size: 29, total: 70, data: 55, ecPerBlock: 15, blocks: 1, align: [6, 22] },
    { size: 33, total: 100, data: 80, ecPerBlock: 20, blocks: 1, align: [6, 26] },
    { size: 37, total: 134, data: 108, ecPerBlock: 26, blocks: 1, align: [6, 30] },
    { size: 41, total: 172, data: 136, ecPerBlock: 18, blocks: 2, align: [6, 34] },
    { size: 45, total: 196, data: 156, ecPerBlock: 20, blocks: 2, align: [6, 22, 38] },
    { size: 49, total: 242, data: 194, ecPerBlock: 24, blocks: 2, align: [6, 24, 42] },
    { size: 53, total: 292, data: 232, ecPerBlock: 30, blocks: 2, align: [6, 26, 46] },
  ];

  function gfTables() {
    const exp = new Uint8Array(512), log = new Uint8Array(256);
    let x = 1;
    for (let i = 0; i < 255; i += 1) {
      exp[i] = x; log[x] = i;
      x = (x << 1) ^ ((x & 0x80) ? 0x11d : 0);
    }
    for (let i = 255; i < 512; i += 1) exp[i] = exp[i - 255];
    return { exp, log };
  }
  const GF = gfTables();
  const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : GF.exp[GF.log[a] + GF.log[b]]);

  function rsEncode(data, ecLen) {
    let gen = [1];
    for (let i = 0; i < ecLen; i += 1) {
      const next = new Array(gen.length + 1).fill(0);
      for (let j = 0; j < gen.length; j += 1) {
        next[j] ^= gen[j];
        next[j + 1] ^= gfMul(gen[j], GF.exp[i]);
      }
      gen = next;
    }
    const rem = new Uint8Array(ecLen);
    for (let i = 0; i < data.length; i += 1) {
      const factor = data[i] ^ rem[0];
      rem.copyWithin(0, 1);
      rem[ecLen - 1] = 0;
      for (let j = 0; j < ecLen; j += 1) rem[j] ^= gfMul(gen[j + 1], factor);
    }
    return rem;
  }

  function encodeQrCodewords(text) {
    const utf8 = new TextEncoder().encode(text);
    const verIndex = QR_VERSIONS.findIndex((v, idx) => idx > 0 && utf8.length + (idx >= 10 ? 3 : 2) <= v.data);
    if (verIndex < 1) throw new Error('URL is too long for QR handoff');
    const spec = QR_VERSIONS[verIndex];
    const bits = [];
    const pushBits = (val, n) => { for (let i = n - 1; i >= 0; i -= 1) bits.push((val >>> i) & 1); };
    pushBits(0b0100, 4);
    pushBits(utf8.length, 8);
    for (const byte of utf8) pushBits(byte, 8);
    for (let i = 0; i < 4 && bits.length < spec.data * 8; i += 1) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);
    const dataBytes = new Uint8Array(spec.data);
    for (let i = 0; i < bits.length / 8; i += 1) {
      let b = 0;
      for (let k = 0; k < 8; k += 1) b = (b << 1) | bits[i * 8 + k];
      dataBytes[i] = b;
    }
    for (let i = bits.length / 8, pad = 0; i < spec.data; i += 1, pad ^= 1) {
      dataBytes[i] = pad === 0 ? 0xec : 0x11;
    }
    const blockLen = spec.data / spec.blocks;
    const dBlocks = [], eBlocks = [];
    for (let b = 0; b < spec.blocks; b += 1) {
      const slice = dataBytes.subarray(b * blockLen, (b + 1) * blockLen);
      dBlocks.push(slice); eBlocks.push(rsEncode(slice, spec.ecPerBlock));
    }
    const out = [];
    for (let i = 0; i < blockLen; i += 1) for (let b = 0; b < spec.blocks; b += 1) out.push(dBlocks[b][i]);
    for (let i = 0; i < spec.ecPerBlock; i += 1) for (let b = 0; b < spec.blocks; b += 1) out.push(eBlocks[b][i]);
    return { ver: verIndex, spec, codewords: out };
  }

  function buildQrSvgData(text) {
    const { ver, spec, codewords } = encodeQrCodewords(text);
    const n = spec.size;
    const grid = Array.from({ length: n }, () => new Int8Array(n));
    const reserved = Array.from({ length: n }, () => new Uint8Array(n));
    const setMod = (r, c, dark) => { if (r >= 0 && r < n && c >= 0 && c < n) { grid[r][c] = dark ? 1 : 0; reserved[r][c] = 1; } };
    const finder = (r0, c0) => {
      for (let dr = -1; dr <= 7; dr += 1) for (let dc = -1; dc <= 7; dc += 1) {
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        setMod(r0 + dr, c0 + dc, inOuter && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4)));
      }
    };
    finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
    for (let i = 8; i < n - 8; i += 1) { setMod(6, i, i % 2 === 0); setMod(i, 6, i % 2 === 0); }
    for (const ar of spec.align) for (const ac of spec.align) {
      if (reserved[ar][ac]) continue;
      for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) setMod(ar + dr, ac + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
    for (let i = 0; i < 9; i += 1) { reserved[8][i] = 1; reserved[i][8] = 1; }
    for (let i = 0; i < 8; i += 1) { reserved[8][n - 1 - i] = 1; reserved[n - 1 - i][8] = 1; }
    setMod(n - 8, 8, true);
    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem & (1 << 11)) ? 0x1f25 : 0);
      const vBits = (ver << 12) | rem;
      for (let i = 0; i < 18; i += 1) {
        const bit = ((vBits >>> i) & 1) === 1;
        setMod(Math.floor(i / 3), n - 11 + (i % 3), bit); setMod(n - 11 + (i % 3), Math.floor(i / 3), bit);
      }
    }
    placeQrBits(grid, reserved, n, codewords);
    return toQrPath(grid, n);
  }

  function placeQrBits(grid, reserved, n, codewords) {
    let bitIdx = 0, upward = true;
    for (let col = n - 1; col >= 1; col -= 2) {
      if (col === 6) col -= 1;
      for (let step = 0; step < n; step += 1) {
        const r = upward ? n - 1 - step : step;
        for (const dc of [0, -1]) {
          const c = col + dc;
          if (reserved[r][c]) continue;
          const bit = bitIdx < codewords.length * 8 ? ((codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) : 0;
          bitIdx += 1;
          grid[r][c] = bit ^ (((r + c) % 2 === 0) ? 1 : 0);
        }
      }
      upward = !upward;
    }
    const fmt = 0x77c4;
    const fPosA = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
    for (let i = 0; i < 15; i += 1) {
      const dark = ((fmt >>> (14 - i)) & 1) === 1;
      grid[fPosA[i][0]][fPosA[i][1]] = dark ? 1 : 0;
      if (i < 7) grid[n - 1 - i][8] = dark ? 1 : 0;
      else grid[8][n - 15 + i] = dark ? 1 : 0;
    }
  }

  function toQrPath(grid, n) {
    const margin = 3, dim = n + margin * 2;
    let d = '';
    for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) if (grid[r][c]) d += `M${c + margin},${r + margin}h1v1h-1z`;
    return { dim, d };
  }

  function renderQrSvg(text) {
    const { dim, d } = buildQrSvgData(text);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="180" height="180" role="img" aria-label="QR code for mobile AR view"><rect width="${dim}" height="${dim}" fill="#ffffff" rx="2"/><path d="${d}" fill="#0c0d10"/></svg>`;
  }

  function mountQrElement(container, text) {
    const { dim, d } = buildQrSvgData(text);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${dim} ${dim}`);
    svg.setAttribute('width', '180');
    svg.setAttribute('height', '180');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'QR code for mobile AR view');
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('width', String(dim)); rect.setAttribute('height', String(dim));
    rect.setAttribute('fill', '#ffffff'); rect.setAttribute('rx', '2');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d); path.setAttribute('fill', '#0c0d10');
    svg.append(rect, path);
    container.replaceChildren(svg);
  }

  function wireScanTools() {
    const app = window.ScanToPrintApp;
    if (!app || !$('tool-crop')) return;

    let activePanel = null;

    function syncUndoReset(meshState) {
      const canUndo = Boolean(meshState && meshState.canUndo);
      const canReset = Boolean(meshState && meshState.canReset);
      for (const id of ['crop-undo', 'rotate-undo']) if ($(id)) $(id).disabled = !canUndo;
      for (const id of ['crop-reset', 'rotate-reset']) if ($(id)) $(id).disabled = !canReset;
    }

    function closeToolPanels() {
      activePanel = null;
      for (const id of ['crop-panel', 'rotate-panel', 'measure-panel']) if ($(id)) $(id).hidden = true;
      for (const id of ['tool-crop', 'tool-rotate', 'tool-measure']) if ($(id)) $(id).setAttribute('aria-pressed', 'false');
      const v = app.getViewer();
      if (v) {
        if (v.setTool) v.setTool('orbit');
        if (v.setCropBox) v.setCropBox(null);
        if (v.setPreviewTransform) v.setPreviewTransform(null);
      }
    }

    function writeCropFields(b) {
      for (const k of ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ']) {
        const input = $('crop-' + k);
        if (input && Number.isFinite(b[k])) input.value = Number(b[k]).toFixed(1);
      }
    }

    function readCropFields() {
      const out = {};
      for (const k of ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ']) out[k] = Number($('crop-' + k).value);
      return out;
    }

    async function openCropPanel() {
      if (activePanel === 'crop') { closeToolPanels(); return; }
      const job = app.getJob();
      if (!job || !app.isFresh()) return;
      closeToolPanels();
      activePanel = 'crop';
      $('crop-panel').hidden = false;
      $('tool-crop').setAttribute('aria-pressed', 'true');
      const v = app.getViewer();
      if (v && v.setCallbacks) {
        v.setCallbacks({ onCropChange: (next) => writeCropFields(next) });
      }
      try {
        const ms = await app.api('/jobs/' + job.job_id + '/mesh-state');
        const b = {
          minX: ms.bounds.min.x, maxX: ms.bounds.max.x,
          minY: ms.bounds.min.y, maxY: ms.bounds.max.y,
          minZ: ms.bounds.min.z, maxZ: ms.bounds.max.z,
        };
        writeCropFields(b);
        syncUndoReset(ms);
        if (v && v.setCropBox) v.setCropBox(b);
      } catch (e) { app.toast(e.message, 'error'); }
    }

    async function applyCrop() {
      const job = app.getJob();
      if (!job) return;
      try {
        $('crop-apply').disabled = true;
        const out = await app.api('/jobs/' + job.job_id + '/mesh/crop', {
          method: 'POST',
          json: { bounds: readCropFields(), snapToBed: $('crop-snap').checked },
        });
        syncUndoReset(out.meshState);
        await app.reloadJob();
        closeToolPanels();
        app.toast('Cropped model (' + out.report.triangleCount + ' facets).', 'ok');
      } catch (e) { app.toast(e.message, 'error'); }
      finally { $('crop-apply').disabled = false; }
    }

    async function openRotatePanel() {
      if (activePanel === 'rotate') { closeToolPanels(); return; }
      const job = app.getJob();
      if (!job || !app.isFresh()) return;
      closeToolPanels();
      activePanel = 'rotate';
      $('rotate-panel').hidden = false;
      $('tool-rotate').setAttribute('aria-pressed', 'true');
      $('rot-x').value = '0'; $('rot-y').value = '0'; $('rot-z').value = '0';
      $('rot-x-val').textContent = '0°'; $('rot-y-val').textContent = '0°'; $('rot-z-val').textContent = '0°';
      try { syncUndoReset(await app.api('/jobs/' + job.job_id + '/mesh-state')); } catch { /* ignore */ }
    }

    function previewRotation() {
      const rxDeg = Number($('rot-x').value || 0), ryDeg = Number($('rot-y').value || 0), rzDeg = Number($('rot-z').value || 0);
      $('rot-x-val').textContent = rxDeg + '°'; $('rot-y-val').textContent = ryDeg + '°'; $('rot-z-val').textContent = rzDeg + '°';
      const v = app.getViewer();
      if (v && v.setPreviewTransform) v.setPreviewTransform({ rxDeg, ryDeg, rzDeg });
    }

    async function applyTransform(spec) {
      const job = app.getJob();
      if (!job) return;
      try {
        $('rotate-apply').disabled = true;
        const out = await app.api('/jobs/' + job.job_id + '/mesh/transform', { method: 'POST', json: spec });
        syncUndoReset(out.meshState);
        await app.reloadJob();
        $('rot-x').value = '0'; $('rot-y').value = '0'; $('rot-z').value = '0';
        previewRotation();
        app.toast(spec.layFlat ? 'Model leveled flat on the build plate (Z = 0).' : 'Rotation saved on the build plate.', 'ok');
      } catch (e) { app.toast(e.message, 'error'); }
      finally { $('rotate-apply').disabled = false; }
    }

    async function runUndoOrReset(action) {
      const job = app.getJob();
      if (!job) return;
      try {
        const out = await app.api('/jobs/' + job.job_id + '/mesh/' + action, { method: 'POST', json: {} });
        syncUndoReset(out.meshState);
        await app.reloadJob();
        closeToolPanels();
        app.toast(action === 'undo' ? 'Reverted the last mesh edit.' : 'Restored the original reconstructed mesh.', 'ok');
      } catch (e) { app.toast(e.message, 'error'); }
    }

    function openMeasurePanel() {
      if (activePanel === 'measure') { closeToolPanels(); return; }
      if (!app.getJob() || !app.isFresh()) return;
      closeToolPanels();
      activePanel = 'measure';
      $('measure-panel').hidden = false;
      $('tool-measure').setAttribute('aria-pressed', 'true');
      $('measure-readout').textContent = 'Click two points on the 3D model surface to measure exact distance in millimetres.';
      const v = app.getViewer();
      if (v) {
        if (v.setCallbacks) {
          v.setCallbacks({
            onMeasure: (m) => {
              if (!m || !m.a) {
                $('measure-readout').textContent = 'Click two points on the 3D model surface to measure exact distance in millimetres.';
              } else if (!m.b) {
                $('measure-readout').textContent = `Point A: (${m.a.x.toFixed(2)}, ${m.a.y.toFixed(2)}, ${m.a.z.toFixed(2)}) mm — click Point B.`;
              } else {
                $('measure-readout').textContent =
                  `Distance: ${m.distanceMm.toFixed(2)} mm · ΔX ${m.absDeltaMm.x.toFixed(2)} mm · ΔY ${m.absDeltaMm.y.toFixed(2)} mm · ΔZ ${m.absDeltaMm.z.toFixed(2)} mm`;
              }
            },
          });
        }
        if (v.clearMeasure) v.clearMeasure();
        if (v.setTool) v.setTool('measure');
      }
    }

    async function refreshShares() {
      const job = app.getJob();
      if (!job) return [];
      const out = await app.api('/jobs/' + job.job_id + '/shares');
      const list = $('share-list');
      list.replaceChildren();
      const active = (out.shares || []).filter((s) => s.active);
      if (!active.length) {
        const li = document.createElement('li');
        li.className = 'muted';
        li.textContent = 'No active share links. Create one to share a read-only 3D viewer that you can revoke at any time.';
        list.appendChild(li);
        return [];
      }
      for (const s of active) {
        const fullUrl = location.origin + s.sharePath;
        const li = document.createElement('li');
        li.className = 'share-item';
        const input = document.createElement('input');
        input.type = 'text'; input.readOnly = true; input.value = fullUrl; input.setAttribute('aria-label', 'Share link URL');
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button'; copyBtn.className = 'ghost'; copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', () => {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(fullUrl).then(() => app.toast('Copied read-only viewer link.', 'ok'), () => { input.select(); });
          } else { input.select(); }
        });
        const revokeBtn = document.createElement('button');
        revokeBtn.type = 'button'; revokeBtn.className = 'link danger'; revokeBtn.textContent = 'Revoke';
        revokeBtn.addEventListener('click', async () => {
          try {
            await app.api('/jobs/' + job.job_id + '/shares/' + s.shareId, { method: 'DELETE' });
            await refreshShares();
            app.toast('Share link revoked.', 'ok');
          } catch (e) { app.toast(e.message, 'error'); }
        });
        li.append(input, copyBtn, revokeBtn);
        list.appendChild(li);
      }
      return active;
    }

    async function openShareSheet() {
      const job = app.getJob();
      if (!job || !app.isFresh()) return;
      const sheet = $('share-sheet');
      if (!sheet.open) sheet.showModal();
      await refreshShares().catch((e) => app.toast(e.message, 'error'));
    }

    async function createShare() {
      const job = app.getJob();
      if (!job) return;
      try {
        $('share-create').disabled = true;
        const label = $('share-label').value.trim();
        await app.api('/jobs/' + job.job_id + '/shares', { method: 'POST', json: { label } });
        $('share-label').value = '';
        await refreshShares();
        app.toast('Created read-only share link.', 'ok');
      } catch (e) { app.toast(e.message, 'error'); }
      finally { $('share-create').disabled = false; }
    }

    async function openArSheet() {
      const job = app.getJob();
      if (!job || !app.isFresh()) return;
      const usdzUrl = location.origin + app.BASE + '/jobs/' + job.job_id + '/artifacts/usdz';
      const glbUrl = location.origin + app.BASE + '/jobs/' + job.job_id + '/artifacts/glb';
      $('ar-quicklook').href = usdzUrl;
      $('ar-sceneviewer').href =
        'intent://arvr.google.com/scene-viewer/1.0?file=' + encodeURIComponent(glbUrl) +
        '&mode=ar_preferred&title=' + encodeURIComponent(job.title || '3D Model') +
        '#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;S.browser_fallback_url=' +
        encodeURIComponent(glbUrl) + ';end';
      $('ar-glb-download').href = glbUrl + '?download';

      let handoffUrl = location.origin + '/api/scan-to-print/app';
      try {
        const out = await app.api('/jobs/' + job.job_id + '/shares');
        const active = (out.shares || []).find((s) => s.active);
        if (active) handoffUrl = location.origin + active.sharePath;
      } catch { /* fallback to app URL */ }
      mountQrElement($('ar-qr'), handoffUrl);
      $('ar-qr-url').textContent = handoffUrl;
      const sheet = $('ar-sheet');
      if (!sheet.open) sheet.showModal();
    }

    $('tool-crop').addEventListener('click', () => { openCropPanel().catch((e) => app.toast(e.message, 'error')); });
    $('tool-rotate').addEventListener('click', () => { openRotatePanel().catch((e) => app.toast(e.message, 'error')); });
    $('tool-measure').addEventListener('click', openMeasurePanel);
    $('tool-share').addEventListener('click', () => { openShareSheet().catch((e) => app.toast(e.message, 'error')); });
    $('tool-ar').addEventListener('click', () => { openArSheet().catch((e) => app.toast(e.message, 'error')); });

    for (const k of ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ']) {
      $('crop-' + k).addEventListener('input', () => {
        const v = app.getViewer();
        if (v && v.setCropBox) v.setCropBox(readCropFields());
      });
    }
    $('crop-apply').addEventListener('click', () => { applyCrop(); });
    $('crop-undo').addEventListener('click', () => { runUndoOrReset('undo'); });
    $('crop-reset').addEventListener('click', () => { runUndoOrReset('reset'); });
    $('crop-close').addEventListener('click', closeToolPanels);

    for (const axis of ['x', 'y', 'z']) $('rot-' + axis).addEventListener('input', previewRotation);
    document.querySelectorAll('[data-lay-flat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyTransform({ layFlat: btn.getAttribute('data-lay-flat'), snapToBed: true });
      });
    });
    $('rotate-apply').addEventListener('click', () => {
      applyTransform({
        rxDeg: Number($('rot-x').value || 0),
        ryDeg: Number($('rot-y').value || 0),
        rzDeg: Number($('rot-z').value || 0),
        snapToBed: $('rot-snap').checked,
      });
    });
    $('rotate-undo').addEventListener('click', () => { runUndoOrReset('undo'); });
    $('rotate-reset').addEventListener('click', () => { runUndoOrReset('reset'); });
    $('rotate-close').addEventListener('click', closeToolPanels);

    $('measure-clear').addEventListener('click', () => { const v = app.getViewer(); if (v && v.clearMeasure) v.clearMeasure(); });
    $('measure-close').addEventListener('click', closeToolPanels);

    $('share-create').addEventListener('click', () => { createShare(); });
    for (const id of ['share-sheet', 'ar-sheet']) {
      const sheet = $(id);
      sheet.addEventListener('click', (ev) => {
        if (ev.target === sheet || (ev.target && ev.target.closest && ev.target.closest('[data-stp-close]'))) sheet.close();
      });
    }
  }

  window.ScanToPrintQr = { renderQrSvg, encodeQrCodewords };
  if (typeof document !== 'undefined' && (!window.AppView || !window.AppView.active())) {
    document.addEventListener('DOMContentLoaded', wireScanTools);
  }
})();
