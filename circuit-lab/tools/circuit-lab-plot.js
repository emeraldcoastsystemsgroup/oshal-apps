/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the waveform plots: one canvas per unit
 *                     |                             | family (volts, amps, rpm, mN·m) holding the ticked signals,
 *                     |                             | auto-scaled axes with unit-aware ticks, a legend, and a
 *                     |                             | cursor at the timeline's current time with the values read
 *                     |                             | out. Plain canvas 2D, no library; exposed as
 *                     |                             | window.CircuitLabPlot.
 */
(function () {
  'use strict';
  const FAMILIES = [
    { key: 'v', unit: 'V', test: (n) => n.startsWith('v('), label: 'Voltage' },
    { key: 'i', unit: 'A', test: (n) => n.startsWith('i('), label: 'Current' },
    { key: 'rpm', unit: 'rpm', test: (n) => n.startsWith('rpm('), label: 'Speed' },
    { key: 'torque', unit: 'mN·m', test: (n) => n.startsWith('torque('), label: 'Torque' },
  ];
  const COLORS = ['#4f8cff', '#3fb950', '#e5534b', '#d29922', '#b57bee', '#39c5cf', '#ff8ac2', '#a3be8c'];

  function fmt(v, unit) {
    const a = Math.abs(v);
    if (unit === 'A' && a < 1) return (v * 1000).toFixed(a < 0.01 ? 3 : 1) + ' mA';
    if (unit === 'V' && a < 1) return (v * 1000).toFixed(0) + ' mV';
    if (a >= 1000) return v.toFixed(0) + ' ' + unit;
    return v.toFixed(a < 10 ? 2 : 1) + ' ' + unit;
  }
  function fmtTime(t) {
    if (t < 1e-3) return (t * 1e6).toFixed(0) + ' µs';
    if (t < 1) return (t * 1e3).toFixed(t < 0.01 ? 2 : 1) + ' ms';
    return t.toFixed(3) + ' s';
  }
  function niceStep(range, ticks) {
    const raw = range / ticks, mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    for (const m of [1, 2, 5, 10]) if (raw <= m * mag) return m * mag;
    return 10 * mag;
  }

  /** Draw one family's chart: `series` = [{name, values, color}], `time` = seconds, `cursor` = index or -1. */
  function drawChart(canvas, family, time, series, cursor) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600, h = canvas.clientHeight || 150;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const style = getComputedStyle(document.body);
    const text = style.getPropertyValue('--cl-muted').trim() || '#9aa3b2', line = style.getPropertyValue('--cl-line').trim() || '#2f3646';
    const left = 58, right = 10, top = 8, bottom = 22;
    const pw = w - left - right, ph = h - top - bottom;
    let lo = Infinity, hi = -Infinity;
    series.forEach((s) => s.values.forEach((v) => { if (v < lo) lo = v; if (v > hi) hi = v; }));
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-12) { hi = lo + 1; lo -= 1; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    if (lo > 0 && lo < (hi - lo) * 0.5) lo = 0;
    if (hi < 0 && -hi < (hi - lo) * 0.5) hi = 0;
    const t0 = time[0], t1 = time[time.length - 1] || 1;
    const x = (t) => left + ((t - t0) / (t1 - t0 || 1)) * pw, y = (v) => top + (1 - (v - lo) / (hi - lo)) * ph;
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = text; ctx.strokeStyle = line; ctx.lineWidth = 1;
    const ystep = niceStep(hi - lo, 4);
    for (let v = Math.ceil(lo / ystep) * ystep; v <= hi + 1e-12; v += ystep) {
      ctx.beginPath(); ctx.moveTo(left, y(v)); ctx.lineTo(w - right, y(v)); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(fmt(v, family.unit), left - 6, y(v) + 4);
    }
    const xstep = niceStep(t1 - t0, 6);
    for (let t = Math.ceil(t0 / xstep) * xstep; t <= t1 + 1e-12; t += xstep) {
      ctx.beginPath(); ctx.moveTo(x(t), top); ctx.lineTo(x(t), h - bottom); ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillText(fmtTime(t), x(t), h - 6);
    }
    if (lo < 0 && hi > 0) { ctx.strokeStyle = text; ctx.beginPath(); ctx.moveTo(left, y(0)); ctx.lineTo(w - right, y(0)); ctx.stroke(); }
    series.forEach((s) => {
      ctx.strokeStyle = s.color; ctx.lineWidth = 1.6; ctx.beginPath();
      const step = Math.max(1, Math.floor(s.values.length / (pw * 2)));
      for (let i = 0; i < s.values.length; i += step) { const px = x(time[i]), py = y(s.values[i]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
      ctx.stroke();
    });
    let lx = left + 6;
    ctx.textAlign = 'left';
    series.forEach((s) => {
      ctx.fillStyle = s.color; ctx.fillRect(lx, top + 4, 10, 3); ctx.fillStyle = text;
      const label = s.name + (cursor >= 0 && cursor < s.values.length ? ' = ' + fmt(s.values[cursor], family.unit) : '');
      ctx.fillText(label, lx + 14, top + 10); lx += ctx.measureText(label).width + 26;
    });
    if (cursor >= 0 && cursor < time.length) {
      ctx.strokeStyle = style.getPropertyValue('--cl-accent').trim() || '#4f8cff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x(time[cursor]), top); ctx.lineTo(x(time[cursor]), h - bottom); ctx.stroke();
    }
    ctx.fillStyle = text; ctx.textAlign = 'right'; ctx.fillText(family.label, w - right - 2, top + 10);
  }

  /**
   * Render every family that has a ticked signal into `container` (one canvas each).
   * @param container element that receives the canvases (reused between calls)
   * @param waveforms {time, signals}
   * @param picked array of signal names to show
   * @param cursor timeline index (or -1)
   */
  function render(container, waveforms, picked, cursor) {
    const wanted = [];
    FAMILIES.forEach((family) => {
      const names = picked.filter((n) => family.test(n) && waveforms.signals[n]);
      if (names.length) wanted.push({ family, series: names.map((n, i) => ({ name: n, values: waveforms.signals[n], color: COLORS[(picked.indexOf(n)) % COLORS.length] || COLORS[i] })) });
    });
    while (container.children.length > wanted.length) container.removeChild(container.lastChild);
    wanted.forEach((entry, i) => {
      let canvas = container.children[i];
      if (!canvas) { canvas = document.createElement('canvas'); canvas.className = 'plot'; container.appendChild(canvas); }
      drawChart(canvas, entry.family, waveforms.time, entry.series, cursor);
    });
    if (!wanted.length && !container.querySelector('p')) { const p = document.createElement('p'); p.className = 'muted small'; p.textContent = 'Tick a signal above to plot it.'; container.appendChild(p); }
    if (wanted.length) { const p = container.querySelector('p'); if (p) p.remove(); }
  }

  function familyOf(name) { return FAMILIES.find((f) => f.test(name)) || null; }

  window.CircuitLabPlot = { render, fmt, fmtTime, familyOf, FAMILIES, COLORS };
})();
