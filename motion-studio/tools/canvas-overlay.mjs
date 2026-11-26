/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.4.4 (CREATE-TOOL-MOTION-STUDIO-01): interactive on-canvas drag, scale and rotate overlay handles supporting mouse and touch pointer events.
 */

const readable = value => typeof value === 'number' && Number.isFinite(value);
const round2 = value => Math.round(value * 100) / 100;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function normalizeDeltaDegrees(deg) {
  let d = deg;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

function estimateLayerSize(selected, comp, items, textInfo) {
  const source = selected?.source;
  if (source?.type === 'Solid' && source.width > 0 && source.height > 0) {
    return [Number(source.width), Number(source.height)];
  }
  if ((source?.type === 'Footage' || source?.type === 'Comp') && items?.[source.id]?.kind) {
    const kind = items[source.id].kind;
    if (kind.width > 0 && kind.height > 0) return [Number(kind.width), Number(kind.height)];
  }
  if (source?.type === 'Text') {
    const box = textInfo?.value?.box_size;
    if (Array.isArray(box) && box[0] > 0 && box[1] > 0) return [Number(box[0]), Number(box[1])];
    return [Math.max(120, Number(comp.width) * 0.36), Math.max(60, Number(comp.height) * 0.16)];
  }
  return [Math.max(100, Number(comp.width) * 0.2), Math.max(60, Number(comp.height) * 0.14)];
}

function getTransformProps(adapter) {
  const info = adapter.state.propertiesInfo, selected = adapter.layer();
  if (!adapter.propertiesCurrent() || !info || info.locked || info.threeD || selected?.parent || adapter.state.playing || adapter.state.busy) {
    return null;
  }
  const byPath = path => info.properties.find(item => item.path === path);
  const pos = byPath('transform/position');
  if (!pos || pos.hasExpression || !Array.isArray(pos.value) || !pos.value.slice(0, 2).every(readable)) return null;
  const scaleProp = byPath('transform/scale');
  const rotProp = byPath('transform/rotation');
  const scale = scaleProp && !scaleProp.hasExpression && Array.isArray(scaleProp.value) && scaleProp.value.slice(0, 2).every(readable) ? scaleProp : null;
  const rotation = rotProp && !rotProp.hasExpression && readable(rotProp.value) ? rotProp : null;
  return { pos, scale, rotation };
}

function bindPointerDrag(el, onStart) {
  el.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const session = onStart(event);
    if (!session) return;
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    try { el.setPointerCapture(pointerId); } catch { /* synthetic pointer events */ }
    const onMove = move => { if (move.pointerId === pointerId) session.move(move); };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    const onUp = up => { if (up.pointerId !== pointerId) return; cleanup(); void session.up(up); };
    const onCancel = cancel => { if (cancel.pointerId !== pointerId) return; cleanup(); session.cancel(); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  });
}

function createOverlayElements(stage) {
  const overlay = make('div', 'motion-transform-overlay');
  overlay.hidden = true;
  const frame = make('div', 'motion-transform-box');
  frame.dataset.handle = 'move-box';
  frame.setAttribute('aria-label', 'Drag selected layer on canvas');
  const handle = make('button', 'motion-position-handle', '↔');
  handle.type = 'button';
  handle.dataset.handle = 'move';
  handle.setAttribute('aria-label', 'Move selected layer in composition');
  const corners = {};
  const cornerLabels = { nw: 'top-left', ne: 'top-right', sw: 'bottom-left', se: 'bottom-right' };
  for (const [corner, desc] of Object.entries(cornerLabels)) {
    const btn = make('button', 'motion-scale-handle motion-corner-' + corner);
    btn.type = 'button';
    btn.dataset.handle = 'scale';
    btn.dataset.corner = corner;
    btn.setAttribute('aria-label', 'Scale selected layer from ' + desc);
    corners[corner] = btn;
    frame.append(btn);
  }
  const stem = make('span', 'motion-rotate-stem');
  stem.setAttribute('aria-hidden', 'true');
  const rotate = make('button', 'motion-rotate-handle', '↻');
  rotate.type = 'button';
  rotate.dataset.handle = 'rotate';
  rotate.setAttribute('aria-label', 'Rotate selected layer');
  const readout = make('output', 'motion-transform-readout');
  readout.hidden = true;
  frame.append(stem, rotate);
  overlay.append(frame, handle, readout);
  stage.append(overlay);
  return { overlay, frame, handle, corners, rotate, readout };
}

function applyBoxLayout(els, layout) {
  const { cx, cy, halfW, halfH, rotDeg, showScale, showRotate, stageHeight } = layout;
  els.handle.style.left = cx + 'px';
  els.handle.style.top = cy + 'px';
  els.frame.style.left = cx + 'px';
  els.frame.style.top = cy + 'px';
  els.frame.style.width = (halfW * 2) + 'px';
  els.frame.style.height = (halfH * 2) + 'px';
  els.frame.style.transform = `translate(-50%, -50%) rotate(${rotDeg}deg)`;
  for (const btn of Object.values(els.corners)) btn.hidden = !showScale;
  els.rotate.hidden = !showRotate;
  els.frame.classList.toggle('motion-rotate-inside', cy - halfH < 44 && stageHeight > 0);
}

/** Attach direct-manipulation position, scale and rotation handles to the composition stage. */
export function setupCanvasOverlay({ $, adapter, stage, target }) {
  const els = createOverlayElements(stage);
  let activeDrag = false;

  els.handle.addEventListener('dblclick', () => $('preview').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  els.frame.addEventListener('dblclick', () => $('preview').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));

  function computeLayout(props) {
    const image = $('preview'), comp = adapter.comp();
    const area = stage.getBoundingClientRect(), box = image.getBoundingClientRect();
    if (!comp || box.width <= 0 || box.height <= 0) return null;
    const sx = box.width / Number(comp.width), sy = box.height / Number(comp.height);
    const cx = box.left - area.left + Number(props.pos.value[0]) * sx;
    const cy = box.top - area.top + Number(props.pos.value[1]) * sy;
    const [baseW, baseH] = estimateLayerSize(adapter.layer(), comp, adapter.state.project?.document.items, adapter.state.textInfo);
    const scX = props.scale ? Number(props.scale.value[0]) : 100;
    const scY = props.scale ? Number(props.scale.value[1]) : 100;
    const halfW = clamp(Math.abs(baseW * (scX / 100)) * sx / 2, 38, Math.max(42, box.width * 0.45));
    const halfH = clamp(Math.abs(baseH * (scY / 100)) * sy / 2, 30, Math.max(34, box.height * 0.45));
    const rotDeg = props.rotation ? Number(props.rotation.value) : 0;
    return { area, box, comp, sx, sy, cx, cy, halfW, halfH, rotDeg, showScale: Boolean(props.scale), showRotate: Boolean(props.rotation), stageHeight: area.height };
  }

  function place() {
    if (activeDrag) return;
    const props = getTransformProps(adapter), image = $('preview'), comp = adapter.comp();
    const visible = Boolean(props && !image.hidden && comp);
    els.overlay.hidden = !visible;
    els.handle.hidden = !visible;
    if (!visible) return;
    const layout = computeLayout(props);
    if (!layout) { els.overlay.hidden = true; els.handle.hidden = true; return; }
    applyBoxLayout(els, layout);
    els.handle.title = 'Drag ' + adapter.layer().name;
    els.readout.hidden = true;
  }

  function showReadout(text, x, y) {
    els.readout.hidden = false;
    els.readout.textContent = text;
    els.readout.style.left = clamp(x, 60, Math.max(60, stage.clientWidth - 60)) + 'px';
    els.readout.style.top = clamp(y - 36, 16, Math.max(16, stage.clientHeight - 28)) + 'px';
  }

  function startMove(event) {
    const props = getTransformProps(adapter); if (!props) return null;
    const layout = computeLayout(props); if (!layout) return null;
    const origin = target(), start = [event.clientX, event.clientY], original = props.pos.value;
    let updated = original, moved = false;
    activeDrag = true;
    return {
      move(ev) {
        if (origin !== target()) return;
        const dx = ev.clientX - start[0], dy = ev.clientY - start[1];
        if (!moved && Math.hypot(dx, dy) < 2) return;
        moved = true;
        updated = original.map((val, i) => i === 0 ? val + dx / layout.sx : i === 1 ? val + dy / layout.sy : val);
        const nx = layout.box.left - layout.area.left + updated[0] * layout.sx;
        const ny = layout.box.top - layout.area.top + updated[1] * layout.sy;
        applyBoxLayout(els, { ...layout, cx: nx, cy: ny });
        showReadout(`X ${Math.round(updated[0])}, Y ${Math.round(updated[1])}`, nx, ny - layout.halfH);
      },
      async up() {
        activeDrag = false; els.readout.hidden = true;
        if (!moved || origin !== target()) { place(); return; }
        try { await adapter.patchProperties([{ prop: props.pos.prop, value: updated }]); }
        catch (error) { adapter.problem(error); }
        place();
      },
      cancel() { activeDrag = false; place(); }
    };
  }

  function startScale(event) {
    const props = getTransformProps(adapter); if (!props?.scale) return null;
    const layout = computeLayout(props); if (!layout) return null;
    const origin = target(), original = props.scale.value;
    const centerX = layout.area.left + layout.cx, centerY = layout.area.top + layout.cy;
    const rad = -layout.rotDeg * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    const toLocal = (x, y) => {
      const dx = x - centerX, dy = y - centerY;
      return [dx * cos - dy * sin, dx * sin + dy * cos];
    };
    const [startLx, startLy] = toLocal(event.clientX, event.clientY);
    const startDist = Math.max(12, Math.hypot(startLx, startLy));
    let updated = original, moved = false;
    activeDrag = true;
    return {
      move(ev) {
        if (origin !== target()) return;
        const [lx, ly] = toLocal(ev.clientX, ev.clientY);
        if (!moved && Math.hypot(lx - startLx, ly - startLy) < 2) return;
        moved = true;
        const linked = Boolean($('transform')?.elements?.linkScale?.checked) || ev.shiftKey;
        const ratioUniform = clamp(Math.hypot(lx, ly) / startDist, 0.05, 20);
        const rx = linked ? ratioUniform : clamp(Math.abs(lx) / Math.max(12, Math.abs(startLx)), 0.05, 20);
        const ry = linked ? ratioUniform : clamp(Math.abs(ly) / Math.max(12, Math.abs(startLy)), 0.05, 20);
        updated = original.map((val, i) => i === 0 ? round2(clamp(val * rx, 1, 10000)) : i === 1 ? round2(clamp(val * ry, 1, 10000)) : val);
        const scaleFactorX = original[0] ? updated[0] / original[0] : 1;
        const scaleFactorY = original[1] ? updated[1] / original[1] : 1;
        applyBoxLayout(els, { ...layout, halfW: clamp(layout.halfW * scaleFactorX, 24, layout.box.width * 0.48), halfH: clamp(layout.halfH * scaleFactorY, 20, layout.box.height * 0.48) });
        showReadout(`Scale ${updated[0]}%, ${updated[1]}%`, layout.cx, layout.cy - layout.halfH);
      },
      async up() {
        activeDrag = false; els.readout.hidden = true;
        if (!moved || origin !== target()) { place(); return; }
        try { await adapter.patchProperties([{ prop: props.scale.prop, value: updated }]); }
        catch (error) { adapter.problem(error); }
        place();
      },
      cancel() { activeDrag = false; place(); }
    };
  }

  function startRotate(event) {
    const props = getTransformProps(adapter); if (!props?.rotation) return null;
    const layout = computeLayout(props); if (!layout) return null;
    const origin = target(), origRot = Number(props.rotation.value);
    const centerX = layout.area.left + layout.cx, centerY = layout.area.top + layout.cy;
    const startAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI;
    let updated = origRot, moved = false;
    activeDrag = true;
    return {
      move(ev) {
        if (origin !== target()) return;
        const nowAngle = Math.atan2(ev.clientY - centerY, ev.clientX - centerX) * 180 / Math.PI;
        const delta = normalizeDeltaDegrees(nowAngle - startAngle);
        if (!moved && Math.abs(delta) < 0.5) return;
        moved = true;
        const snapped = ev.shiftKey ? Math.round((origRot + delta) / 15) * 15 : origRot + delta;
        updated = round2(snapped);
        applyBoxLayout(els, { ...layout, rotDeg: updated });
        showReadout(`Rotate ${updated}°`, layout.cx, layout.cy - layout.halfH);
      },
      async up() {
        activeDrag = false; els.readout.hidden = true;
        if (!moved || origin !== target()) { place(); return; }
        try { await adapter.patchProperties([{ prop: props.rotation.prop, value: updated }]); }
        catch (error) { adapter.problem(error); }
        place();
      },
      cancel() { activeDrag = false; place(); }
    };
  }

  bindPointerDrag(els.handle, startMove);
  bindPointerDrag(els.frame, startMove);
  for (const btn of Object.values(els.corners)) bindPointerDrag(btn, startScale);
  bindPointerDrag(els.rotate, startRotate);
  new ResizeObserver(place).observe(stage);
  $('preview').addEventListener('load', place);
  return { place };
}
