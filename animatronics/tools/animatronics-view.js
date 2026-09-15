/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the rig view: a stylised face whose eyes,
 *                     |                             | lids, head and jaw follow the axis angles of the eye-gimbal,
 *                     |                             | eyelids, neck and jaw mechanisms, and a bar per axis for arms
 *                     |                             | and custom mechanisms. `layout()` is a pure function of the
 *                     |                             | rig and the angles (testable under node); `render()` paints
 *                     |                             | it into an SVG with textContent and attributes only. Reads
 *                     |                             | the SAME angles the rehearsal produced, so what the drawing
 *                     |                             | does is what the servos were asked to do.
 *                     |                             | UMD: window.AnimatronicsView + module.exports.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AnimatronicsView = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const W = 480; const H = 360;

  function limitsOf(rig, mech, role) {
    const id = mech.axes[role]; if (!id) return null;
    const ch = rig.channels.find((c) => c.id === id); return ch ? { key: mech.id + '.' + role, min: ch.minDeg, max: ch.maxDeg, neutral: ch.neutralDeg } : null;
  }
  const frac = (lim, deg) => (lim && lim.max > lim.min ? Math.min(1, Math.max(0, (deg - lim.min) / (lim.max - lim.min))) : 0.5);
  const signed = (lim, deg) => (lim ? Math.max(-1, Math.min(1, (deg - lim.neutral) / Math.max(1e-6, Math.max(lim.max - lim.neutral, lim.neutral - lim.min)))) : 0);

  /**
   * @description The geometry a set of angles implies (pure).
   * @param {object} rig - The rig.
   * @param {object} angles - Axis key → degrees.
   * @returns {object} { head:{dx,dy,roll}, pupil:{dx,dy}, lids:{upper,lower} (0 open…1 closed), jaw:{dy}, bars:[{key,deg,frac}], has:{eyes,lids,neck,jaw} }
   */
  function layout(rig, angles) {
    const out = { head: { dx: 0, dy: 0, roll: 0 }, pupil: { dx: 0, dy: 0 }, lids: { upper: 0, lower: 0 }, jaw: { dy: 0 }, bars: [], has: { eyes: false, lids: false, neck: false, jaw: false } };
    const a = (key) => (angles && Number.isFinite(angles[key]) ? angles[key] : 0);
    for (const m of rig.mechanisms || []) {
      if (m.kind === 'eye-gimbal') { out.has.eyes = true; const pan = limitsOf(rig, m, 'pan'); const tilt = limitsOf(rig, m, 'tilt'); out.pupil.dx = signed(pan, a(pan && pan.key)) * 14; out.pupil.dy = -signed(tilt, a(tilt && tilt.key)) * 10; }
      else if (m.kind === 'eyelids') { out.has.lids = true; for (const role of ['upper', 'lower']) { const l = limitsOf(rig, m, role); if (l) out.lids[role] = frac(l, a(l.key)); } for (const role of ['left', 'right']) { const l = limitsOf(rig, m, role); if (l) out.lids.upper = Math.max(out.lids.upper, frac(l, a(l.key))); } }
      else if (m.kind === 'neck') { out.has.neck = true; const yaw = limitsOf(rig, m, 'yaw'); const pitch = limitsOf(rig, m, 'pitch'); const roll = limitsOf(rig, m, 'roll'); out.head.dx = signed(yaw, a(yaw && yaw.key)) * 40; out.head.dy = -signed(pitch, a(pitch && pitch.key)) * 24; out.head.roll = signed(roll, a(roll && roll.key)) * 20; }
      else if (m.kind === 'jaw') { out.has.jaw = true; const open = limitsOf(rig, m, 'open'); out.jaw.dy = frac(open, a(open && open.key)) * 36; }
      else for (const role of Object.keys(m.axes)) { const l = limitsOf(rig, m, role); if (l) out.bars.push({ key: l.key, deg: a(l.key), frac: frac(l, a(l.key)) }); }
    }
    return out;
  }

  function el(svg, tag, attrs, text) {
    const node = svg.ownerDocument.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, String(v)));
    if (text !== undefined) node.textContent = text;
    svg.appendChild(node);
    return node;
  }

  /**
   * @description Paint the layout into an SVG element (replaces its children).
   * @param {SVGSVGElement} svg - Target.
   * @param {object} rig - The rig.
   * @param {object} angles - Axis key → degrees.
   * @returns {object} The layout used.
   */
  function render(svg, rig, angles) {
    const L = layout(rig, angles);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    const cx = W / 2 + L.head.dx; const cy = 150 + L.head.dy;
    const g = el(svg, 'g', { class: 'head', transform: 'rotate(' + L.head.roll.toFixed(1) + ' ' + cx + ' ' + cy + ')' });
    el(g, 'ellipse', { class: 'skull', cx, cy, rx: 120, ry: 130 });
    if (L.has.jaw) el(g, 'path', { class: 'jaw', d: 'M ' + (cx - 70) + ' ' + (cy + 70 + L.jaw.dy) + ' Q ' + cx + ' ' + (cy + 130 + L.jaw.dy) + ' ' + (cx + 70) + ' ' + (cy + 70 + L.jaw.dy) });
    if (L.has.jaw) el(g, 'rect', { class: 'mouth', x: cx - 60, y: cy + 62, width: 120, height: Math.max(2, L.jaw.dy), rx: 4 });
    for (const side of [-1, 1]) {
      const ex = cx + side * 48; const ey = cy - 20;
      el(g, 'circle', { class: 'eye', cx: ex, cy: ey, r: 30 });
      if (L.has.eyes) el(g, 'circle', { class: 'pupil', cx: ex + L.pupil.dx, cy: ey + L.pupil.dy, r: 11 });
      if (L.has.lids) {
        el(g, 'rect', { class: 'lid', x: ex - 31, y: ey - 31, width: 62, height: Math.round(62 * 0.55 * L.lids.upper) });
        el(g, 'rect', { class: 'lid', x: ex - 31, y: ey + 31 - Math.round(62 * 0.45 * L.lids.lower), width: 62, height: Math.round(62 * 0.45 * L.lids.lower) });
      }
    }
    L.bars.forEach((b, i) => {
      const y = 300 + i * 14; if (y > H - 8) return;
      el(svg, 'text', { class: 'barlabel', x: 12, y: y + 9 }, b.key + ' ' + b.deg.toFixed(1) + '°');
      el(svg, 'rect', { class: 'bartrack', x: 200, y, width: 260, height: 10, rx: 3 });
      el(svg, 'rect', { class: 'bar', x: 200, y, width: Math.round(260 * b.frac), height: 10, rx: 3 });
    });
    return L;
  }

  return { layout, render, W, H };
}));
