/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the surface script: polls the owner's world,
 *                     |                             | draws the top-view map, the drone camera, both nodes, and
 *                     |                             | drives draft / execute / abort and manual commands.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The discovered world: a 3-D orbit view of the occupancy map
 *                     |                             | (voxels by height), discovered surfaces and objects, the rover,
 *                     |                             | the arm model and the drone; simulated depth pictures from the
 *                     |                             | drone and wrist cameras; discovered-id task drafting; labels;
 *                     |                             | sensor scan buttons; the top view now shows what is mapped,
 *                     |                             | not the hidden scene.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Drone localisation on the surface: the believed pose is drawn as the drone, the true pose (sim only) as a ghost with the error when they differ; the node panel shows status, registrations, last correction and the sim-only error; the explore controls gain "drone first (rover parked)".
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Drone sensor set selector (applied on Reset world) and the active set in the node panel.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | The drone designer panel: fit selector, generated sizing and mass summary, the printed part list, and "Open in CAD Studio" which posts the part's program to /api/cad-studio/models (the scan-to-print hand-off pattern) and opens the studio.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Two defects the browser proof found: the command gate disabled "Open in CAD Studio" (it shared the jog buttons' class) — the designer's buttons are exempt; a state poll could undo a sensor-set choice made just before Reset world — the selector follows the active set only until the person picks one.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | The physics backend: a selector (applied on Reset world), the engine status in the header with the install command when the container is down, the plant in the node panel, and a reset refused by the engine shown with its reason.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | B19: the Policies panel (training reports with both scores, Certify per report, the gate's verdict), a controller selector that offers only policies this world certified, the plant's controller in the node panel.
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | B20: nodes on the swarm rail — every online node the api lists is a truth-model option (`node:<id>`, applied on Reset world, posted as backend 'node' + node), the header names who has heartbeat in, the node panel says which node flies the plant.
 * 10 | maintainer@emeraldcoastsystemsgroup.com   | B4 + B14: the Room selector (a named hidden scene, applied on Reset world, following the active one until chosen) and the drone's Recover button (one wide sweep).
 * 11 | maintainer@emeraldcoastsystemsgroup.com   | The printed arm in the Build panel: its joints and what drives them, its parts (each opens in CAD Studio), and Check on physics - the container's measured hold beside the design's.
 * 12 | maintainer@emeraldcoastsystemsgroup.com   | B23: the Room selector is filled from /capabilities.scenarios, so a Spaces scan this owner sent here (Send to… → Fly it in Embodied) stands beside the built-in rooms with its solid count, and Reset world flies it.
 * 13 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S1: the Medium panel — choose a medium, drop the explorer hull as one solid. In air the fall is drawn and the numbers are the analytic free fall the plant reproduces; in seawater the answer is the REFUSAL, rendered by its own name with the reason, because nothing here models a free surface and a plausible float would disprove the contract.
 */
(function embodiedSurface() {
  'use strict';
  const API = '/api/embodied';
  const $ = (id) => document.getElementById(id);
  const state = { snapshot: null, task: null, voxels: null, voxelsVersion: -1, world: null, sensorSetChosen: false, scenarioChosen: false, media: null };

  async function call(path, init) {
    const res = await fetch(API + path, { credentials: 'same-origin', ...init });
    const text = await res.text();
    let body = null; try { body = text ? JSON.parse(text) : null; } catch (_) { body = { raw: text }; }
    if (!res.ok) { const err = new Error((body && (body.message || body.error)) || `HTTP ${res.status}`); err.body = body; err.status = res.status; throw err; }
    return body;
  }
  const post = (path, body) => call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

  let toastTimer = null;
  function toast(text, kind) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); document.body.appendChild(el); }
    el.className = `toast ${kind || ''}`; el.textContent = text;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), 5000);
  }

  // ── 3-D view ──────────────────────────────────────────────────────────────
  const cam = { yaw: -0.6, pitch: -0.9, dist: 6.5, target: [2.5, 2.0, 0.6] };
  const cv3 = $('view3d');
  function project(p) {
    const dx = p[0] - cam.target[0]; const dy = p[1] - cam.target[1]; const dz = p[2] - cam.target[2];
    const cy = Math.cos(cam.yaw); const sy = Math.sin(cam.yaw);
    const x1 = dx * cy - dy * sy; const y1 = dx * sy + dy * cy;
    const cp = Math.cos(cam.pitch); const sp = Math.sin(cam.pitch);
    const y2 = y1 * cp - dz * sp; const z2 = y1 * sp + dz * cp;
    const depth = y2 + cam.dist;
    if (depth <= 0.05) return null;
    const f = cv3.width * 0.85;
    return [cv3.width / 2 + (f * x1) / depth, cv3.height / 2 - (f * z2) / depth, depth];
  }
  function line3(g, a, b, style, width) { const pa = project(a); const pb = project(b); if (!pa || !pb) return; g.strokeStyle = style; g.lineWidth = width || 1; g.beginPath(); g.moveTo(pa[0], pa[1]); g.lineTo(pb[0], pb[1]); g.stroke(); }
  function box3(g, min, max, style, width) {
    const c = [[min[0], min[1], min[2]], [max[0], min[1], min[2]], [max[0], max[1], min[2]], [min[0], max[1], min[2]], [min[0], min[1], max[2]], [max[0], min[1], max[2]], [max[0], max[1], max[2]], [min[0], max[1], max[2]]];
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) line3(g, c[a], c[b], style, width);
  }
  function heightColor(z) { const t = Math.max(0, Math.min(1, z / 1.8)); const r = Math.round(70 + 120 * t); const gc = Math.round(90 + 60 * t); const b = Math.round(150 - 40 * t); return `rgb(${r},${gc},${b})`; }
  function draw3d() {
    const g = cv3.getContext('2d'); const W = cv3.width; const H = cv3.height;
    g.fillStyle = '#0b0d12'; g.fillRect(0, 0, W, H);
    const s = state.snapshot; if (!s) return;
    const room = s.scene.room;
    for (let x = room.minX; x <= room.maxX + 1e-9; x += 0.5) line3(g, [x, room.minY, 0], [x, room.maxY, 0], 'rgba(255,255,255,.07)');
    for (let y = room.minY; y <= room.maxY + 1e-9; y += 0.5) line3(g, [room.minX, y, 0], [room.maxX, y, 0], 'rgba(255,255,255,.07)');
    box3(g, [room.minX, room.minY, 0], [room.maxX, room.maxY, room.ceiling], 'rgba(255,255,255,.12)');
    if (state.voxels) {
      const { res, bounds, occupied } = state.voxels; const half = res / 2;
      const items = [];
      for (const [i, j, k] of occupied) { const p = [bounds.minX + (i + 0.5) * res, bounds.minY + (j + 0.5) * res, bounds.minZ + (k + 0.5) * res]; const pr = project(p); if (pr) items.push({ p, pr }); }
      items.sort((a, b) => b.pr[2] - a.pr[2]);
      for (const { p, pr } of items) {
        const size = Math.max(1.5, (cv3.width * 0.85 * res) / pr[2]);
        g.fillStyle = heightColor(p[2]); g.fillRect(pr[0] - size / 2, pr[1] - size / 2, size, size);
        g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(pr[0] - size / 2, pr[1] + size / 2 - 1, size, 1);
      }
    }
    if (s.lastSweep) { g.fillStyle = 'rgba(255,255,255,.35)'; for (const pt of s.lastSweep.points) { const pr = project(pt); if (pr) g.fillRect(pr[0], pr[1], 1, 1); } }
    for (const sf of (s.world.surfaces || [])) { box3(g, [sf.bbox.minX, sf.bbox.minY, sf.z], [sf.bbox.maxX, sf.bbox.maxY, sf.z + 0.005], '#3fb950', 1.2); const pr = project([sf.centroid[0], sf.centroid[1], sf.z + 0.02]); if (pr) { g.fillStyle = '#3fb950'; g.font = '11px system-ui'; g.fillText(sf.label || sf.id, pr[0] + 3, pr[1] - 3); } }
    for (const o of (s.world.objects || [])) { box3(g, o.min, o.max, '#f6c177', 1.5); const pr = project([o.centroid[0], o.centroid[1], o.max[2] + 0.03]); if (pr) { g.fillStyle = '#f6c177'; g.font = '11px system-ui'; g.fillText(`${o.label || o.id} · ${o.guess}`, pr[0] + 3, pr[1]); } }
    const u = s.unit; const b = u.base; const c = Math.cos(b.yaw); const sn = Math.sin(b.yaw);
    const corner = (dx, dy, z) => [b.x + c * dx - sn * dy, b.y + sn * dx + c * dy, z];
    const foot = [corner(0.325, 0.275, 0), corner(0.325, -0.275, 0), corner(-0.325, -0.275, 0), corner(-0.325, 0.275, 0)];
    const deck = foot.map((p) => [p[0], p[1], 0.22]);
    for (let i = 0; i < 4; i += 1) { line3(g, foot[i], foot[(i + 1) % 4], u.estop ? '#e5534b' : '#4f8cff', 1.5); line3(g, deck[i], deck[(i + 1) % 4], '#4f8cff', 1.5); line3(g, foot[i], deck[i], '#4f8cff'); }
    line3(g, corner(-0.05, 0, 0.22), corner(-0.05, 0, 1.45), '#4f8cff', 4);
    line3(g, corner(-0.05, 0, 1.45), corner(0.25, 0, 1.6), '#4f8cff', 2);
    const pts = u.armPoints;
    for (let i = 1; i < pts.length; i += 1) line3(g, pts[i - 1], pts[i], '#f6c177', i < 3 ? 6 : 4);
    for (const p of pts) { const pr = project(p); if (pr) { g.fillStyle = '#ffd88a'; g.beginPath(); g.arc(pr[0], pr[1], 3, 0, Math.PI * 2); g.fill(); } }
    const tcp = project([u.tcp.x, u.tcp.y, u.tcp.z]); if (tcp) { g.fillStyle = u.gripper.holding ? '#3fb950' : '#fff'; g.beginPath(); g.arc(tcp[0], tcp[1], 4, 0, Math.PI * 2); g.fill(); }
    const d = s.drone; box3(g, [d.x - 0.12, d.y - 0.12, d.z - 0.03], [d.x + 0.12, d.y + 0.12, d.z + 0.03], d.down ? '#e5534b' : '#c792ea', 1.5);
    line3(g, [d.x, d.y, d.z], [d.x, d.y, 0], 'rgba(199,146,234,.35)');
    if (d.truth && d.localization && d.localization.errorM > 0.005) {
      const t = d.truth; box3(g, [t.x - 0.12, t.y - 0.12, t.z - 0.03], [t.x + 0.12, t.y + 0.12, t.z + 0.03], 'rgba(199,146,234,.4)', 1);
      line3(g, [d.x, d.y, d.z], [t.x, t.y, t.z], 'rgba(229,83,75,.8)', 1);
      const pr = project([t.x, t.y, t.z + 0.08]); if (pr) { g.fillStyle = 'rgba(199,146,234,.7)'; g.font = '10px system-ui'; g.fillText(`true pose (sim) · off by ${(d.localization.errorM * 100).toFixed(1)} cm`, pr[0] + 3, pr[1]); }
    }
    const look = [d.x + Math.cos(d.yaw) * Math.cos(d.gimbalPitch), d.y + Math.sin(d.yaw) * Math.cos(d.gimbalPitch), d.z + Math.sin(d.gimbalPitch)];
    line3(g, [d.x, d.y, d.z], look, '#c792ea', 1);
    g.fillStyle = 'rgba(255,255,255,.5)'; g.font = '11px system-ui'; g.fillText(`${state.voxels ? state.voxels.occupied.length : 0} mapped voxels · yaw ${(cam.yaw * 57.3).toFixed(0)}° pitch ${(cam.pitch * 57.3).toFixed(0)}°`, 10, H - 10);
  }
  let drag = null;
  cv3.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; cv3.setPointerCapture(e.pointerId); });
  cv3.addEventListener('pointermove', (e) => { if (!drag) return; cam.yaw += (e.clientX - drag.x) * 0.008; cam.pitch = Math.max(-1.5, Math.min(-0.1, cam.pitch + (e.clientY - drag.y) * 0.006)); drag = { x: e.clientX, y: e.clientY }; requestAnimationFrame(draw3d); });
  cv3.addEventListener('pointerup', () => { drag = null; });
  cv3.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = Math.max(2, Math.min(14, cam.dist * (e.deltaY > 0 ? 1.1 : 0.9))); requestAnimationFrame(draw3d); }, { passive: false });

  // ── Top view (discovered) ─────────────────────────────────────────────────
  const SVG = 'http://www.w3.org/2000/svg';
  function el(name, attrs, text) { const n = document.createElementNS(SVG, name); Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v)); if (text !== undefined) n.textContent = text; return n; }
  const CLASS_COLOR = { plate: '#8ab4f8', bowl: '#f6c177', mug: '#c792ea', carton: '#f0dc78', unknown: '#9aa3b2' };
  function drawMap(s) {
    const svg = $('map'); const room = s.scene.room; const W = 500; const H = 400;
    const sx = W / (room.maxX - room.minX); const sy = H / (room.maxY - room.minY);
    const X = (x) => (x - room.minX) * sx; const Y = (y) => H - (y - room.minY) * sy;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.appendChild(el('rect', { x: 0, y: 0, width: W, height: H, fill: 'none', stroke: 'currentColor', 'stroke-opacity': .35 }));
    for (const sf of (s.world.surfaces || [])) {
      svg.appendChild(el('rect', { x: X(sf.bbox.minX), y: Y(sf.bbox.maxY), width: (sf.bbox.maxX - sf.bbox.minX) * sx, height: (sf.bbox.maxY - sf.bbox.minY) * sy, fill: '#3fb950', 'fill-opacity': Math.min(.35, .08 + sf.z / 4), stroke: '#3fb950', 'stroke-opacity': .8 }));
      svg.appendChild(el('text', { x: X(sf.bbox.minX) + 3, y: Y(sf.bbox.maxY) + 11, 'font-size': 9, fill: '#3fb950' }, `${sf.label || sf.id} ${sf.z.toFixed(2)} m`));
    }
    for (const a of s.scene.appliances) {
      if (!a.door) continue;
      const h = a.door.closedHeading + a.door.swing * a.angle;
      const fx = a.door.hinge.x + a.door.width * Math.cos(h); const fy = a.door.hinge.y + a.door.width * Math.sin(h);
      svg.appendChild(el('line', { x1: X(a.door.hinge.x), y1: Y(a.door.hinge.y), x2: X(fx), y2: Y(fy), stroke: a.open ? '#3fb950' : '#e5534b', 'stroke-width': 4, 'stroke-linecap': 'round' }));
      svg.appendChild(el('text', { x: X(a.door.hinge.x) - 8, y: Y(a.door.hinge.y) - 6, 'font-size': 9, fill: 'currentColor' }, `${a.name} door ${(a.angle * 180 / Math.PI).toFixed(0)}°`));
    }
    drawPlanLegs(svg, X, Y);
    for (const o of (s.world.objects || [])) {
      const r = Math.max(4, (Math.max(o.size.l, o.size.w) / 2) * sx);
      svg.appendChild(el('circle', { cx: X(o.centroid[0]), cy: Y(o.centroid[1]), r, fill: CLASS_COLOR[o.guess] || '#ccc', 'fill-opacity': .7 }));
      svg.appendChild(el('text', { x: X(o.centroid[0]) + r + 2, y: Y(o.centroid[1]) + 3, 'font-size': 9, fill: 'currentColor' }, o.label || o.id));
    }
    const u = s.unit; const b = u.base; const L = 0.65; const Wd = 0.55; const c = Math.cos(b.yaw); const sn = Math.sin(b.yaw);
    const corners = [[L / 2, Wd / 2], [L / 2, -Wd / 2], [-L / 2, -Wd / 2], [-L / 2, Wd / 2]].map(([dx, dy]) => `${X(b.x + c * dx - sn * dy)},${Y(b.y + sn * dx + c * dy)}`).join(' ');
    svg.appendChild(el('polygon', { points: corners, fill: u.estop ? '#e5534b' : '#4f8cff', 'fill-opacity': .25, stroke: u.estop ? '#e5534b' : '#4f8cff' }));
    svg.appendChild(el('polyline', { points: u.armPoints.map((p) => `${X(p[0])},${Y(p[1])}`).join(' '), fill: 'none', stroke: '#f6c177', 'stroke-width': 3, 'stroke-linejoin': 'round' }));
    const d = s.drone; const dc = Math.cos(d.yaw); const ds = Math.sin(d.yaw);
    const tri = [[0.18, 0], [-0.12, 0.12], [-0.12, -0.12]].map(([dx, dy]) => `${X(d.x + dc * dx - ds * dy)},${Y(d.y + ds * dx + dc * dy)}`).join(' ');
    svg.appendChild(el('polygon', { points: tri, fill: d.mode === 'landed' ? '#9aa3b2' : '#c792ea', stroke: '#fff', 'stroke-opacity': .5 }));
    svg.appendChild(el('text', { x: X(d.x) + 10, y: Y(d.y) - 8, 'font-size': 9, fill: '#c792ea' }, `${d.mode} ${d.z.toFixed(1)} m`));
  }
  function drawPlanLegs(svg, X, Y) {
    const t = state.task; const ctl = state.snapshot && state.snapshot.control;
    if (!t || !ctl || ctl.stepIndex < 0 || !t.plan.steps[ctl.stepIndex]) return;
    const step = t.plan.steps[ctl.stepIndex];
    if (step.kind !== 'base.drive') return;
    const b = state.snapshot.unit.base;
    svg.appendChild(el('polyline', { points: [[b.x, b.y], ...step.legs.map((l) => [l.x, l.y])].map(([x, y]) => `${X(x)},${Y(y)}`).join(' '), fill: 'none', stroke: '#4f8cff', 'stroke-dasharray': '5 4', 'stroke-opacity': .7 }));
  }

  // ── Pictures ──────────────────────────────────────────────────────────────
  function drawPicture(canvas, caption, pic) {
    const g = canvas.getContext('2d');
    canvas.width = pic.width; canvas.height = pic.height;
    const bytes = Uint8Array.from(atob(pic.rgb), (ch) => ch.charCodeAt(0));
    const img = g.createImageData(pic.width, pic.height);
    for (let i = 0; i < pic.width * pic.height; i += 1) { img.data[i * 4] = bytes[i * 3]; img.data[i * 4 + 1] = bytes[i * 3 + 1]; img.data[i * 4 + 2] = bytes[i * 3 + 2]; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    $(caption).textContent = `${pic.sensor} camera · ${pic.returns} returns · at (${pic.camera.position.map((v) => v.toFixed(2)).join(', ')}) pitch ${(pic.camera.pitch * 57.3).toFixed(0)}° · SIMULATED`;
  }

  // ── Panels ────────────────────────────────────────────────────────────────
  function dl(id, rows) { const node = $(id); node.innerHTML = ''; for (const [k, v] of rows) { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; node.append(dt, dd); } }
  function drawNodes(s) {
    const u = s.unit; const b = u.base;
    dl('unit', [['pose', `(${b.x.toFixed(2)}, ${b.y.toFixed(2)}) ${(b.yaw * 180 / Math.PI).toFixed(0)}°`], ['speed', `${b.v.toFixed(2)} m/s (limit ${u.speedLimit} — ${u.stowed ? 'stowed' : 'lifted'})`], ['lift', `${b.liftZ.toFixed(2)} m`], ['tool', `(${u.tcp.x.toFixed(2)}, ${u.tcp.y.toFixed(2)}, ${u.tcp.z.toFixed(2)})`], ['gripper', u.gripper.holding ? `holding ${u.gripper.holding}` : `open ${(u.gripper.width * 1000).toFixed(0)} mm`], ['phase', u.estop ? 'E-STOP' : u.phase]]);
    const factor = u.tipBudget.momentCapacity.front / 66;
    const gauge = $('tip-gauge'); gauge.className = `gauge ${factor < 1.5 ? 'bad' : factor < 2 ? 'warn' : ''}`; gauge.firstElementChild.style.width = `${Math.min(100, factor / 3 * 100).toFixed(0)}%`;
    $('tip-text').textContent = `front ${u.tipBudget.momentCapacity.front.toFixed(0)} N·m → factor ${factor.toFixed(2)} · mass ${u.tipBudget.totalMass.toFixed(1)} kg · CoM z ${u.tipBudget.com[2].toFixed(2)} m · payload ${u.payloadKg.toFixed(2)} kg`;
    const d = s.drone;
    const loc = d.localization || {};
    // The selector follows the active set until the person picks one; a poll must never undo a choice made a moment before Reset world is clicked.
    if (d.sensorSet && !state.sensorSetChosen && $('sensor-set').value !== d.sensorSet && document.activeElement !== $('sensor-set')) $('sensor-set').value = d.sensorSet;
    if (s.scenario && !state.scenarioChosen && $('scenario').value !== s.scenario && document.activeElement !== $('scenario')) $('scenario').value = s.scenario;
    dl('drone', [['sensors', d.sensorSet || '—'], ['truth model', d.plant ? `physics${d.node && d.node.link === 'rail' ? ` on rail node ${d.node.nodeId}` : ''}: ${d.plant.engine} ${d.plant.version}, seed ${d.plant.seed}, flown by ${d.plant.controller || 'pid'}` : 'kinematic (odometry drift model)'], ['mode', d.down ? `DOWN — ${d.down}` : d.mode], ['believed position', `(${d.x.toFixed(2)}, ${d.y.toFixed(2)}, ${d.z.toFixed(2)})`], ['heading', `${(d.yaw * 180 / Math.PI).toFixed(0)}°`], ['battery', `${(d.battery * 100).toFixed(0)} %`],
      ['localisation', `${loc.status || '—'} · ${loc.registrations || 0} registration(s) · last correction ${((loc.correctionM || 0) * 100).toFixed(1)} cm · ${loc.matched || 0} matches`],
      ['truth (sim only)', `off by ${((loc.errorM || 0) * 100).toFixed(1)} cm, ${(((loc.yawErrorRad || 0) * 180) / Math.PI).toFixed(2)}°`]]);
  }
  // ── The drone designer: the parts model behind the sim, each part a CAD Studio program ─────
  async function pollBuild() {
    const fit = $('build-fit').value;
    try {
      const d = await call(`/build/drone?fit=${encodeURIComponent(fit)}`);
      $('build-md').href = `${API}/build/drone/design.md?fit=${encodeURIComponent(fit)}`;
      const z = d.sizing;
      $('build-summary').textContent = `${d.fit.label}. Wheelbase ${d.layout.wheelbaseMm} mm, ${z.propIn} in props clearing by ${d.layout.propClearanceMm} mm, mast ${d.layout.mastMm} mm. All-up ${d.massBudget.allUpG} g (printed ${d.massBudget.printedG.toFixed(0)}, bought ${d.massBudget.boughtG.toFixed(0)}, battery ${d.massBudget.batteryG}). Hover ${z.pElectricalW.toFixed(0)} W electrical → ${z.hoverMin.toFixed(1)} min theoretical on ${z.cells}S ${z.mAh} mAh (real ≈ 70–80 %); ${z.thrustPerMotorHoverG.toFixed(0)} g per motor at hover, ${z.thrustPerMotorTw2G.toFixed(0)} g at T:W 2; tip speed ${d.tipSpeedMps.toFixed(0)} m/s. About $${d.approxUsd} in bought parts. Momentum theory — aero-lab's propeller curves replace the figure of merit.`;
      const tb = $('build-parts').querySelector('tbody'); tb.innerHTML = '';
      for (const p of d.parts) {
        const b = p.cad.base;
        const base = b.kind === 'box' ? `box ${b.sizeX}×${b.sizeY}×${b.sizeZ}` : b.kind === 'cylinder' ? `Ø${b.diameter}×${b.height}` : `sketch ${b.points.length} pts ×${b.height}`;
        const tr = document.createElement('tr');
        for (const v of [p.name, String(p.qty), base, String(p.cad.features.length), p.material, `${p.massEachG} g`]) { const td = document.createElement('td'); td.textContent = v; tr.append(td); }
        const td = document.createElement('td'); const btn = document.createElement('button'); btn.className = 'jog build'; btn.textContent = 'Open in CAD Studio'; btn.title = 'Creates the part as a real CAD model (STEP, STL, drawings) in CAD Studio and opens it there.';
        btn.addEventListener('click', () => openInCadStudio(fit, p.id)); td.append(btn); tr.append(td); tb.append(tr);
      }
      $('build-bought').textContent = 'Bought: ' + d.bought.map((b) => `${b.name}${b.qty > 1 ? ' ×' + b.qty : ''}`).join(' · ');
    } catch (e) { $('build-summary').textContent = `Design unavailable: ${e.message}`; }
  }
  async function openInCadStudio(fit, partId) {
    try {
      const { cadStudio } = await call(`/build/drone/parts/${encodeURIComponent(partId)}?fit=${encodeURIComponent(fit)}`);
      const res = await fetch('/api/cad-studio/models', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cadStudio) });
      if (res.status === 404 || res.status === 401 || res.status === 403) throw new Error('CAD Studio is not installed on this swarm, or you are not granted access to it.');
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((out.build && (out.build.reason || out.build.error)) || out.message || out.error || ('HTTP ' + res.status));
      toast(`Opened in CAD Studio as "${out.model.title}" (revision ${out.model.revision}).`, 'ok');
      (window.top || window).location.assign('/cockpit/?app=cad-studio');
    } catch (e) { toast(e.message, 'error'); }
  }
  $('sensor-set').addEventListener('change', () => { state.sensorSetChosen = true; });
  $('scenario').addEventListener('change', () => { state.scenarioChosen = true; });
  $('build-fit').addEventListener('change', pollBuild);
  void pollBuild();
  // -- The printed arm: the same parts model, and the check the engine container runs on it ------
  async function pollArm() {
    const fit = $('arm-fit').value;
    try {
      const d = await call(`/build/arm?fit=${encodeURIComponent(fit)}`);
      $('arm-md').href = `${API}/build/arm/design.md?fit=${encodeURIComponent(fit)}`;
      $('arm-summary').textContent = `${d.fit.label}. Reach ${d.reachM.toFixed(3)} m, payload ${d.fit.payloadKg} kg, ${d.servoCount} servos, moving mass ${d.massBudget.movingG} g, about USD ${d.approxUsd}. Repeatability budget ${d.repeatability.worstMm} mm worst case (${d.repeatability.rssMm} mm root sum of squares) from the servo's measured backlash.${d.undersized.length ? ' UNDERSIZED: ' + d.undersized.join('; ') : ''}`;
      const jb = $('arm-joints').querySelector('tbody'); jb.innerHTML = '';
      for (const joint of d.joints) {
        const tr = document.createElement('tr');
        tr.dataset.joint = `j${joint.joint}`;
        const cells = [`J${joint.joint} ${joint.name}`, `${joint.gravityNm.toFixed(2)} N\u00b7m`, `${joint.requiredNm.toFixed(2)} N\u00b7m`,
          joint.drive ? joint.drive.cfg.label : 'none holds it', joint.drive ? `${joint.drive.output.usableNm.toFixed(2)} N\u00b7m` : '\u2014',
          joint.drive ? joint.drive.margin.toFixed(2) : '\u2014', '\u2014'];
        for (const v of cells) { const td = document.createElement('td'); td.textContent = v; tr.append(td); }
        jb.append(tr);
      }
      const pb = $('arm-parts').querySelector('tbody'); pb.innerHTML = '';
      for (const p of d.parts) {
        const tr = document.createElement('tr');
        for (const v of [p.name, String(p.qty), p.material, `${p.massEachG} g`]) { const td = document.createElement('td'); td.textContent = v; tr.append(td); }
        const td = document.createElement('td'); const btn = document.createElement('button'); btn.className = 'jog build'; btn.textContent = 'Open in CAD Studio';
        btn.addEventListener('click', () => openArmPartInCadStudio(fit, p.id)); td.append(btn); tr.append(td); pb.append(tr);
      }
      $('arm-bought').textContent = 'Bought: ' + d.bought.map((b) => `${b.name}${b.qty > 1 ? ' \u00d7' + b.qty : ''}`).join(' \u00b7 ');
    } catch (e) { $('arm-summary').textContent = `Arm design unavailable: ${e.message}`; }
  }
  async function openArmPartInCadStudio(fit, partId) {
    try {
      const { cadStudio } = await call(`/build/arm/parts/${encodeURIComponent(partId)}?fit=${encodeURIComponent(fit)}`);
      const res = await fetch('/api/cad-studio/models', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cadStudio) });
      if (res.status === 404 || res.status === 401 || res.status === 403) throw new Error('CAD Studio is not installed on this swarm, or you are not granted access to it.');
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((out.build && (out.build.reason || out.build.error)) || out.message || out.error || ('HTTP ' + res.status));
      toast(`Opened in CAD Studio as "${out.model.title}" (revision ${out.model.revision}).`, 'ok');
      (window.top || window).location.assign('/cockpit/?app=cad-studio');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function runArmCheck() {
    const btn = $('arm-check');
    btn.disabled = true; const was = btn.textContent; btn.textContent = 'Checking on physics\u2026';
    try {
      const out = await post('/physics/arm/check', { fit: $('arm-fit').value });
      const r = out.report;
      for (const hold of r.holds) {
        const row = $('arm-joints').querySelector(`tr[data-joint="${hold.joint}"]`);
        if (!row) continue;
        row.lastChild.textContent = hold.poseBlocked ? 'pose blocked' : `${hold.measuredNm.toFixed(2)} N\u00b7m${hold.withinContinuous ? '' : ' \u2014 over its continuous torque'}`;
      }
      const v = r.verdict;
      const said = [v.holdsItsPayload ? 'holds its payload' : 'does NOT hold its payload',
        v.physicsAgreesWithDesign ? 'physics agrees with the sizing' : 'physics DISAGREES with the sizing',
        v.taskSucceeds ? 'the taught pick-and-place works' : 'the taught pick-and-place FAILED',
        v.withinDutyCycle ? 'inside its duty cycle' : 'OVER its duty cycle'];
      $('arm-summary').textContent = `Checked in the engine container over ${r.seeds} scene(s) in ${r.wallSeconds} s: ${said.join(' \u00b7 ')}. Pick-and-place ${Math.round(r.run.successRate * 100)}% in ${r.run.meanSeconds} s each.`;
      const allGood = Object.values(v).every(Boolean);
      toast(allGood ? 'The arm holds its payload and the taught task works.' : 'The check found something \u2014 read the row that changed.', allGood ? 'ok' : 'error');
    } catch (e) { toast(`Arm check: ${e.message}`, 'error'); } finally { btn.disabled = false; btn.textContent = was; }
  }
  $('arm-fit').addEventListener('change', pollArm);
  $('arm-check').addEventListener('click', runArmCheck);
  void pollArm();

  function drawWorld(s) {
    const w = s.world; const st = w.stats;
    $('world-stats').textContent = st.scans ? `${(st.knownFraction * 100).toFixed(0)} % of the room known after ${st.scans} scan(s) · ${st.occupied} occupied voxels · ${w.surfaces.length} surface(s) · ${w.objects.length} object(s)` : 'No scans yet — the map is entirely unknown. Explore the room first.';
    const sb = $('surfaces').querySelector('tbody'); sb.innerHTML = '';
    for (const sf of w.surfaces) { const tr = document.createElement('tr'); tr.innerHTML = `<td>${sf.id}</td><td>${sf.z.toFixed(2)} m</td><td>${sf.areaM2.toFixed(2)} m²</td><td><input data-label="${sf.id}" value="${sf.label || ''}" placeholder="name it" /></td>`; sb.appendChild(tr); }
    const ob = $('objects').querySelector('tbody'); ob.innerHTML = '';
    for (const o of w.objects) { const tr = document.createElement('tr'); tr.innerHTML = `<td>${o.id}</td><td>${o.guess}</td><td>(${o.centroid.map((v) => v.toFixed(2)).join(', ')})</td><td>${o.surfaceId}</td><td><input data-label="${o.id}" value="${o.label || ''}" placeholder="name it" /></td>`; ob.appendChild(tr); }
    document.querySelectorAll('input[data-label]').forEach((inp) => inp.addEventListener('change', async () => { try { await post('/world/label', { id: inp.dataset.label, label: inp.value }); toast(`Labelled ${inp.dataset.label}.`, 'ok'); } catch (e) { toast(e.message, 'error'); } }));
    const fill = (sel) => { const cur = sel.value; sel.innerHTML = ''; for (const sf of w.surfaces) { const opt = document.createElement('option'); opt.value = sf.id; opt.textContent = `${sf.label || sf.id} · ${sf.z.toFixed(2)} m · ${sf.areaM2.toFixed(2)} m²`; sel.appendChild(opt); } if ([...sel.options].some((o) => o.value === cur)) sel.value = cur; };
    if (document.activeElement !== $('from') && document.activeElement !== $('to')) { fill($('from')); fill($('to')); }
  }
  function drawControl(s) {
    const c = s.control; const mode = $('mode'); mode.textContent = c.mode; mode.className = `badge ${c.mode}`;
    $('holder').textContent = c.holder ? `held by ${c.holder}` : c.executor === 'running' ? `running: ${c.currentStep || ''} (${c.stepIndex + 1}/${c.stepsTotal})` : c.failure ? c.failure : '';
    $('take').hidden = c.mode === 'manual' || c.mode === 'estop'; $('release').hidden = c.mode !== 'manual'; $('reset-estop').hidden = c.mode !== 'estop';
    document.querySelectorAll('button.jog:not(.build)').forEach((btn) => { btn.disabled = c.mode !== 'manual'; }); // the designer's buttons share the style, not the command gate
    $('execute').disabled = !(state.task && state.task.status === 'draft' && c.mode === 'idle');
    $('abort').disabled = c.executor !== 'running';
    $('draft').disabled = c.executor === 'running'; $('explore').disabled = c.executor === 'running' || c.mode !== 'idle';
    if (state.task) drawSteps(state.task, c);
  }
  function drawSteps(task, c) {
    const ol = $('steps'); ol.innerHTML = '';
    task.plan.steps.forEach((st, i) => {
      const li = document.createElement('li'); li.textContent = st.label;
      const running = c.taskId === task.task_id;
      if (running && i < c.stepIndex) li.className = 'done';
      else if (running && i === c.stepIndex) li.className = c.executor === 'failed' ? 'failed' : 'current';
      else if (task.status === 'done') li.className = 'done';
      ol.appendChild(li);
    });
    if (c.taskId !== task.task_id && task.status === 'executing') refreshTask(task.task_id);
  }
  async function refreshTask(id) { try { state.task = await call(`/tasks/${id}`); } catch (_) { /* keep the last copy */ } }
  function drawLog(rows) {
    const ul = $('log'); ul.innerHTML = '';
    for (const r of rows) { const li = document.createElement('li'); li.className = r.outcome; li.textContent = `${(r.sim_ms / 1000).toFixed(1)}s ${r.node_id} ${r.command} ← ${r.actor} · ${r.outcome}${r.reason ? ` · ${r.reason}` : ''}`; ul.appendChild(li); }
  }

  // ── Polling ───────────────────────────────────────────────────────────────
  async function pollState() {
    try { const s = await call('/state'); state.snapshot = s; drawMap(s); drawNodes(s); drawWorld(s); drawControl(s); draw3d(); } catch (e) { $('holder').textContent = `state unavailable: ${e.message}`; }
  }
  async function pollVoxels() { try { const v = await call('/world/voxels'); if (v.version !== state.voxelsVersion) { state.voxels = v; state.voxelsVersion = v.version; draw3d(); } } catch (_) { /* transient */ } }
  async function pollPictures() { try { drawPicture($('pic-drone'), 'cap-drone', await call('/picture?sensor=drone')); drawPicture($('pic-wrist'), 'cap-wrist', await call('/picture?sensor=wrist')); } catch (_) { /* transient */ } }
  async function pollLog() { try { drawLog(await call('/log?limit=60')); } catch (_) { /* transient */ } }

  // ── Actions ───────────────────────────────────────────────────────────────
  $('task').addEventListener('change', () => { const task = $('task').value; document.querySelectorAll('[data-task]').forEach((el2) => { el2.hidden = el2.dataset.task !== task; }); });
  async function draft(body) {
    const row = await post('/tasks/draft', body);
    state.task = row;
    $('task-summary').textContent = `${row.title} — ${row.plan.summary.join(' ')}`;
    const r = row.rehearsal;
    $('rehearsal').textContent = r.ok ? `Rehearsal OK on a clone: ${r.stepsCompleted}/${r.stepsTotal} steps in ${r.durationS.toFixed(0)} simulated s.` : `Rehearsal REFUSED: ${r.issues.join('; ')}`;
    $('rehearsal').style.color = r.ok ? '' : 'var(--em-danger)';
    await pollState();
    return row;
  }
  async function execute(row) {
    await post(`/tasks/${row.task_id}/execute`, { confirm: true });
    state.task.status = 'executing';
    await pollState();
  }
  $('draft').addEventListener('click', async () => {
    try {
      const task = $('task').value;
      const body = task === 'explore' ? { task, maxScans: Number($('max-scans').value) || 12, droneFirst: $('drone-first').checked } : task === 'fetch-from-appliance' ? { task, appliance: 'fridge', object: $('object').value, to: 'island' } : { task, from: $('from').value, to: $('to').value };
      const row = await draft(body);
      toast(row.rehearsal.ok ? 'Plan drafted and rehearsed. Execute when ready.' : 'Plan drafted but the rehearsal refused it.', row.rehearsal.ok ? 'ok' : 'error');
    } catch (e) { toast(`Draft refused: ${e.message}`, 'error'); }
  });
  $('explore').addEventListener('click', async () => {
    const droneFirst = $('drone-first').checked;
    if (!window.confirm(droneFirst ? 'Explore the room — drone first?\n\nThe rover stays parked. The drone clears its own climb with its upward ranger, maps the room frontier to frontier, and registers every sweep against the map it has built. You can abort or E-STOP at any time.' : 'Explore the room?\n\nThe base LiDAR and the drone will map it: the drone flies frontier to frontier through space it has already seen free. You can abort or E-STOP at any time.')) return;
    try { const row = await draft({ task: 'explore', maxScans: Number($('max-scans').value) || 12, droneFirst }); if (!row.rehearsal.ok) throw new Error(row.rehearsal.issues.join('; ')); await execute(row); toast('Exploring.', 'ok'); } catch (e) { toast(`Explore refused: ${e.message}`, 'error'); }
  });
  $('execute').addEventListener('click', async () => {
    if (!state.task) return;
    if (!window.confirm(`Execute "${state.task.title}" on the simulated machine?\n\nThe plan is rehearsed again on the live world first, and every kinetic step is re-validated as it runs against the discovered map. You can take command, abort or E-STOP at any time.`)) return;
    try { await execute(state.task); toast('Executing.', 'ok'); } catch (e) { toast(`Execute refused: ${e.message}${e.body && e.body.rehearsal ? ` — ${e.body.rehearsal.issues.join('; ')}` : ''}`, 'error'); }
  });
  $('abort').addEventListener('click', async () => { if (!state.task) return; try { await post(`/tasks/${state.task.task_id}/abort`); await refreshTask(state.task.task_id); await pollState(); toast('Aborted.', 'ok'); } catch (e) { toast(e.message, 'error'); } });
  const controlBtn = (id, path, msg) => $(id).addEventListener('click', async () => { try { await post(path); await pollState(); if (msg) toast(msg, 'ok'); } catch (e) { toast(e.message, 'error'); } });
  controlBtn('take', '/control/take', 'You hold command. The plan (if any) is paused.');
  controlBtn('release', '/control/release', 'Command released.');
  controlBtn('estop', '/control/estop', 'E-STOP latched. Reset when the area is safe.');
  controlBtn('reset-estop', '/control/reset', 'E-stop reset.');
  async function certify(file) {
    try { const r = await post('/physics/certify', { file }); toast(r.certification.ok ? `Certified: ${r.certification.checked} points passed the fence and the map guards.` : `Refused at ${r.certification.refusedCount} of ${r.certification.checked} points — first: ${r.certification.refused[0].reason} at (${r.certification.refused[0].point.map((v) => v.toFixed(2)).join(', ')}). Explore more, then certify again.`, r.certification.ok ? 'ok' : 'error'); await pollPolicies(); } catch (e) { toast(e.message, 'error'); }
  }
  async function pollPolicies() {
    const tb = $('policies').querySelector('tbody'); const sel = $('controller');
    try {
      const l = await call('/physics/reports'); tb.innerHTML = '';
      const chosen = sel.value; sel.innerHTML = '<option value="pid">flown by PID</option>';
      for (const r of l.reports) {
        const rep = r.report || {}; const b = rep.baseline || {}; const p = rep.policy || {}; const cm = (v) => (typeof v === 'number' ? (v * 100).toFixed(1) + ' cm' : '—');
        const tr = document.createElement('tr');
        for (const v of [r.file, rep.mode || '—', String(rep.timesteps ?? '—'), `${cm(b.holdEndErrM)} / ${cm(b.legEndErrM)}`, `${cm(p.holdEndErrM)} / ${cm(p.legEndErrM)}`, rep.policyBeatsBaseline === true ? 'yes' : rep.policyBeatsBaseline === false ? 'no' : '—', r.certified ? (r.certified.ok ? 'passed' : `refused ${r.certified.refusedCount}`) : 'not run']) { const td = document.createElement('td'); td.textContent = v; tr.append(td); }
        const td = document.createElement('td'); if (p.trajectory && p.trajectory.length) { const btn = document.createElement('button'); btn.className = 'jog build'; btn.textContent = 'Certify'; btn.addEventListener('click', () => certify(r.file)); td.append(btn); } tr.append(td); tb.append(tr);
        if (r.certified && r.certified.ok && rep.policyFile) { const opt = document.createElement('option'); opt.value = `policy:${rep.policyFile}`; opt.textContent = `flown by ${rep.policyFile}`; sel.append(opt); }
      }
      if ([...sel.options].some((o) => o.value === chosen)) sel.value = chosen;
      $('policies-note').textContent = l.reports.length ? `${l.reports.length} report(s) in ${l.dir}. A policy may fly the plant only after its recorded flight passes this world's guards.` : `No training reports yet in ${l.dir} — run engine/tasks/train_hover.py in the engine container.`;
    } catch (e) { $('policies-note').textContent = `Policies unavailable: ${e.message}`; }
  }
  /** B23: the rooms this owner can reset onto — the built-in hidden scenes plus every Spaces scan
   *  sent here through the shared Send to… chip. The active room stays selected until a person picks another. */
  async function pollScenarios() {
    const sel = $('scenario');
    try {
      const caps = await call('/capabilities');
      const chosen = state.scenarioChosen ? sel.value : (state.snapshot && state.snapshot.scenario) || sel.value;
      sel.innerHTML = '';
      for (const sc of caps.scenarios || []) {
        const opt = document.createElement('option');
        opt.value = sc.id;
        const span = sc.room ? `${(sc.room.maxX - sc.room.minX).toFixed(1)} × ${(sc.room.maxY - sc.room.minY).toFixed(1)} m` : '';
        opt.textContent = sc.source === 'scan' ? `${sc.name} (scan, ${sc.solids} solids, ${span})` : sc.name;
        if (sc.source === 'scan') opt.title = `Imported from Spaces scan ${sc.scanId} at ${sc.importedAt}`;
        sel.append(opt);
      }
      if ([...sel.options].some((o) => o.value === chosen)) sel.value = chosen;
    } catch (_) { /* the built-in options in the markup stand */ }
  }
  async function pollPhysics() {
    try {
      const p = await call('/physics/status'); const e = p.engine;
      const nodes = (p.nodes || []).filter((n) => n.online);
      const rail = nodes.length ? `rail: ${nodes.map((n) => `${n.nodeId} online${n.stale ? ' (STALE build)' : ''}`).join(', ')}` : 'rail: no node has heartbeat in';
      $('physics-status').textContent = `${e.connected ? `physics engine: ${e.engine} ${e.version} connected` : `physics engine: not reachable (${e.reason || e.code}) — install: ${e.installHint}`} · ${rail}`;
      $('physics-status').title = `${e.connected ? `container build ${String(e.buildHash).slice(0, 12)}` : `${e.addr}`}; nodes heartbeat ${p.rail && p.rail.heartbeat ? p.rail.heartbeat : ''}`;
      const sel = $('backend'); const chosen = sel.value;
      for (const o of [...sel.options]) if (o.dataset.node) o.remove();
      for (const n of nodes) { const o = document.createElement('option'); o.value = `node:${n.nodeId}`; o.dataset.node = n.nodeId; o.textContent = `rail node ${n.nodeId} (${n.engine} ${n.version}${n.stale ? ', STALE build' : ''})`; sel.appendChild(o); }
      if ([...sel.options].some((o) => o.value === chosen)) sel.value = chosen;
    } catch (err) { $('physics-status').textContent = `physics engine: ${err.message}`; }
  }
  $('reset-world').addEventListener('click', async () => { const sensorSet = $('sensor-set').value; const scenario = $('scenario').value; const chosen = $('backend').value; const backend = chosen.startsWith('node:') ? 'node' : chosen; const node = chosen.startsWith('node:') ? chosen.slice(5) : undefined; const controller = $('controller').value; if (!window.confirm(`Reset the simulated ${scenario} world with the ${sensorSet === 'recon-mini' ? '2-D ring + ToF (printed drone)' : '3-D LiDAR'} sensor set on the ${backend === 'physics' ? 'physics (MuJoCo)' : backend === 'node' ? `physics of rail node ${node}` : 'kinematic'} truth model${controller !== 'pid' ? `, ${controller.replace('policy:', 'flown by policy ')}` : ''}? The map is forgotten too — the machine starts knowing nothing.`)) return; try { await post('/world/reset', { sensorSet, scenario, backend, node, controller }); state.sensorSetChosen = false; state.scenarioChosen = false; state.task = null; state.voxelsVersion = -1; state.voxels = null; $('steps').innerHTML = ''; $('task-summary').textContent = 'No plan drafted.'; $('rehearsal').textContent = ''; await pollState(); await pollVoxels(); await pollPictures(); await pollPhysics(); await pollPolicies(); await pollScenarios(); } catch (e) { toast(e.body && e.body.installHint ? `${e.message}${e.body.reason ? ' — ' + e.body.reason : ''}. Install: ${e.body.installHint}` : e.message, 'error'); } });

  async function manual(nodeId, command, params) {
    try { await post('/control/command', { nodeId, command, params }); await pollState(); await pollVoxels(); } catch (e) { toast(`Refused: ${e.message}`, 'error'); await pollState(); }
  }
  document.querySelectorAll('button.jog').forEach((btn) => btn.addEventListener('click', async () => {
    const d = btn.dataset; const s = state.snapshot; if (!s) return;
    switch (d.cmd) {
      case 'scan': { try { await post('/scan', { sensor: d.sensor }); await pollState(); await pollVoxels(); await pollPictures(); toast(`${d.sensor} scan integrated.`, 'ok'); } catch (e) { toast(`Refused: ${e.message}`, 'error'); } return; }
      case 'jog': return manual('rover-arm-1', 'jog', { v: Number(d.v), w: Number(d.w), seconds: 1 });
      case 'stop': return manual('rover-arm-1', 'stop', {});
      case 'lift': return manual('rover-arm-1', 'lift', { z: s.unit.base.liftZ + Number(d.dz) });
      case 'arm': return manual('rover-arm-1', 'move-to-pose', { dx: Number(d.dx || 0), dy: Number(d.dy || 0), dz: Number(d.dz || 0), toolDown: true });
      case 'joints': return manual('rover-arm-1', 'move-joints', { q: d.q });
      case 'grasp': return manual('rover-arm-1', 'grasp', {});
      case 'release': return manual('rover-arm-1', 'release', {});
      case 'drone': {
        if (d.drone === 'frontier') { toast('Frontier flight is a plan step: run Explore.', 'ok'); return; }
        return manual('mini-drone-1', d.drone, {});
      }
      default: return undefined;
    }
  }));

  // -- ADR-160 S1: the medium as a parameter, and the boat that falls ---------
  const fmt = (v, n) => (typeof v === 'number' && isFinite(v) ? v.toFixed(n) : '\u2014');

  /** Fill the medium chooser from the package's own records, and say what each one can answer. */
  async function pollMedia() {
    try {
      const data = await call('/physics/media');
      state.media = data.media;
      const sel = $('medium');
      if (!sel.options.length) {
        data.media.forEach((m) => { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; sel.append(o); });
        sel.value = 'air';
      }
      describeMedium();
    } catch (e) { $('medium-summary').textContent = e.message; }
  }

  /** What the chosen medium carries, and what it cannot answer -- read from the record, never typed here. */
  function describeMedium() {
    const m = (state.media || []).find((x) => x.id === $('medium').value);
    if (!m) return;
    const nu = m.kinematicViscosityM2S === null ? 'undefined (zero density)' : `${m.kinematicViscosityM2S.toExponential(3)} m\u00b2/s`;
    $('medium-summary').innerHTML = `<b>${m.label}</b> \u2014 ${m.summary}<br>`
      + `g = [${m.gravityMps2.join(', ')}] m/s\u00b2 \u00b7 \u03c1 = ${m.densityKgM3} kg/m\u00b3 \u00b7 \u03bc = ${m.dynamicViscosityPaS} Pa\u00b7s \u00b7 \u03bd = ${nu}`
      + ` \u00b7 sound ${m.speedOfSoundMs === null ? 'not carried' : m.speedOfSoundMs + ' m/s'} \u00b7 temperature ${m.temperatureK === null ? 'not carried' : m.temperatureK + ' K'}`
      + `<br>field: ${m.field ? m.field.model : 'none'} \u00b7 free surface: ${m.freeSurface ? 'yes' : 'none'} \u00b7 answers over ${m.validity.coordinate} [${m.validity.minM}, ${m.validity.maxM}] m (${m.resolution})`;
    $('hull-mjcf').href = `${API}/physics/hull/mjcf?medium=${encodeURIComponent(m.id)}&dropHeightM=${encodeURIComponent($('drop-height').value)}`;
  }

  /** Draw the fall: the hull at each sampled instant, left to right, above the floor it lands on. */
  function drawFall(fall) {
    const svg = $('fall');
    const W = 320; const H = 128; const pad = 10; const floorY = H - 14;
    const top = Math.max(0.001, fall.dropHeightM);
    const parts = [`<line x1="0" y1="${floorY}" x2="${W}" y2="${floorY}" stroke="var(--em-line)" stroke-width="2"/>`];
    fall.trace.forEach((p, i) => {
      const x = pad + (i * (W - 2 * pad - 16)) / Math.max(1, fall.trace.length - 1);
      const y = floorY - (p.heightM / top) * (floorY - pad) - 14;
      const last = i === fall.trace.length - 1;
      parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="14" height="14" rx="2" fill="${last ? 'var(--em-accent)' : 'var(--em-muted)'}" opacity="${last ? 1 : 0.35 + (0.5 * i) / fall.trace.length}"/>`);
      if (last || i === 0) parts.push(`<text x="${x.toFixed(1)}" y="${(floorY + 11).toFixed(1)}" font-size="9" fill="var(--em-muted)">${p.tS.toFixed(2)}s</text>`);
    });
    svg.innerHTML = parts.join('');
  }

  /** Drop the hull in the chosen medium. In air it falls at g; in seawater this renders the REFUSAL, by name. */
  async function dropHull() {
    const medium = $('medium').value;
    const dropHeightM = $('drop-height').value;
    const out = $('drop-result');
    out.innerHTML = 'Dropping\u2026';
    try {
      const d = await call(`/physics/hull?medium=${encodeURIComponent(medium)}&dropHeightM=${encodeURIComponent(dropHeightM)}`);
      drawFall(d.fall);
      out.innerHTML = `<b>It falls.</b> ${d.hull.envelopeM * 1000} mm envelope, ${d.hull.allUpMassKg} kg all-up, one solid \u2014 `
        + `${fmt(d.fall.dropHeightM, 2)} m in ${fmt(d.fall.fallTimeS, 3)} s, hitting the floor at ${fmt(d.fall.impactSpeedMs, 2)} m/s `
        + `under |g| = ${fmt(d.fall.gMagnitudeMps2, 2)} m/s\u00b2 from the ${d.medium.label} record.<br>`
        + `<span class="muted">${d.fall.basis}</span><br>`
        + `<span style="color:var(--em-warn)">Does it float? <b>${d.flotation.refusal}</b> \u2014 ${d.flotation.because}</span><br>`
        + `<span class="muted">Not modelled: ${d.notModelled.join('; ')}. Simulated \u2014 nothing was built or wetted.</span>`;
    } catch (e) {
      $('fall').innerHTML = '';
      const b = e.body || {};
      if (b.refusal) {
        out.innerHTML = `<span style="color:var(--em-danger)"><b>Refused by name: ${b.refusal}</b></span><br>`
          + `<span class="muted">${b.because}</span><br>`
          + '<span class="muted">This is the answer, not a failure: a plausible-looking float would have disproved the contract (ADR-160 D9).</span>';
      } else { out.innerHTML = `<span style="color:var(--em-danger)">${e.message}</span>`; }
    }
  }

  $('medium').addEventListener('change', describeMedium);
  $('drop-height').addEventListener('change', describeMedium);
  $('drop-hull').addEventListener('click', dropHull);

  pollState(); pollVoxels(); pollPictures(); pollLog(); pollPhysics(); pollPolicies(); pollScenarios(); pollMedia();
  setInterval(pollState, 600); setInterval(pollVoxels, 2000); setInterval(pollPictures, 2500); setInterval(pollLog, 3000);
})();
