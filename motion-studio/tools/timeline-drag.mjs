/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.4.4 (CREATE-TOOL-MOTION-STUDIO-04): direct mouse and touch timeline dragging for layer timing bars, trim edges and keyframe diamonds.
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function frameInfo(comp, ticks) {
  const num = Number(comp?.frame_rate?.num || 30), den = Number(comp?.frame_rate?.den || 1);
  const frameSec = den / num;
  const frameTicks = BigInt(ticks) * BigInt(den) / BigInt(num);
  return { frameSec, frameTicks };
}

function snapSeconds(sec, frameSec) {
  if (!Number.isFinite(frameSec) || frameSec <= 0) return Math.round(sec * 1000) / 1000;
  return Math.round(Math.round(sec / frameSec) * frameSec * 1000000) / 1000000;
}

function canEditLayer(state, item) {
  return Boolean(state.project && state.permissions.change && !state.historical && !state.busy && !state.playing && !item?.switches?.locked);
}

function attachPointerTracker(el, onDown, { preventDown = true } = {}) {
  el.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const session = onDown(event);
    if (!session) return;
    if (preventDown) event.preventDefault();
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

function computeSpanTiming(mode, deltaSec, orig, durationSec, frameSec) {
  const minDur = Math.min(durationSec, Math.max(frameSec, 0.05));
  if (mode === 'in') {
    const nextIn = snapSeconds(clamp(orig.inSec + deltaSec, 0, orig.outSec - minDur), frameSec);
    return { start: orig.startSec, in: nextIn, out: orig.outSec };
  }
  if (mode === 'out') {
    const nextOut = snapSeconds(clamp(orig.outSec + deltaSec, orig.inSec + minDur, durationSec), frameSec);
    return { start: orig.startSec, in: orig.inSec, out: nextOut };
  }
  const spanLen = orig.outSec - orig.inSec;
  const maxShift = Math.max(0, durationSec - orig.outSec);
  const minShift = -orig.inSec;
  const shift = snapSeconds(clamp(deltaSec, minShift, maxShift), frameSec);
  return {
    start: snapSeconds(orig.startSec + shift, frameSec),
    in: snapSeconds(clamp(orig.inSec + shift, 0, durationSec - spanLen), frameSec),
    out: snapSeconds(clamp(orig.outSec + shift, spanLen, durationSec), frameSec),
  };
}

/** Make a timeline layer span and its left/right trim grips draggable by mouse and touch. */
export function attachSpanDrag({ span, lane, item, comp, state, apply, problem, onSelect }) {
  const ticks = state.ticks;
  const durationTicks = Number(comp?.duration) || ticks;
  const durationSec = durationTicks / ticks;
  const { frameSec } = frameInfo(comp, ticks);

  const leftGrip = document.createElement('span');
  leftGrip.className = 'motion-span-trim motion-span-trim-in';
  leftGrip.dataset.edge = 'in';
  leftGrip.setAttribute('aria-label', 'Trim ' + item.name + ' start');
  const rightGrip = document.createElement('span');
  rightGrip.className = 'motion-span-trim motion-span-trim-out';
  rightGrip.dataset.edge = 'out';
  rightGrip.setAttribute('aria-label', 'Trim ' + item.name + ' end');
  span.append(leftGrip, rightGrip);

  const orig = {
    startSec: Number(item.start_time || 0) / ticks,
    inSec: Number(item.in_point || 0) / ticks,
    outSec: Number(item.out_point || durationTicks) / ticks,
  };
  span.dataset.layer = String(item.id);
  span.dataset.inTicks = String(item.in_point || 0);
  span.dataset.outTicks = String(item.out_point || durationTicks);
  span.setAttribute('aria-label', 'Drag ' + item.name + ' timing bar');

  function startDrag(event, mode) {
    if (!canEditLayer(state, item)) return null;
    const laneRect = lane.getBoundingClientRect();
    if (laneRect.width <= 0) return null;
    const epoch = state.epoch, projectId = state.project.id, doc = state.project.document;
    const startX = event.clientX;
    let moved = false, next = { start: orig.startSec, in: orig.inSec, out: orig.outSec };
    span.classList.add('is-dragging');
    return {
      move(ev) {
        if (epoch !== state.epoch || doc !== state.project?.document) return;
        const dx = ev.clientX - startX;
        if (!moved && Math.abs(dx) < 4) return;
        moved = true;
        const deltaSec = (dx / laneRect.width) * durationSec;
        next = computeSpanTiming(mode, deltaSec, orig, durationSec, frameSec);
        span.style.left = clamp((next.in / durationSec) * 100, 0, 100) + '%';
        span.style.width = clamp(((next.out - next.in) / durationSec) * 100, 0, 100) + '%';
      },
      async up() {
        span.classList.remove('is-dragging');
        if (epoch !== state.epoch || projectId !== state.project?.id || doc !== state.project?.document) return;
        if (!moved) { onSelect?.(); return; }
        const params = mode === 'in' ? { in: next.in }
          : mode === 'out' ? { out: next.out }
          : { start: next.start, in: next.in, out: next.out };
        try {
          await apply([
            { command: 'layer.select', params: { layers: [item.id] } },
            { command: 'layer.timing', params: { layers: [item.id], ...params } },
          ]);
        } catch (error) {
          problem(error);
        }
      },
      cancel() {
        span.classList.remove('is-dragging');
        span.style.left = clamp((orig.inSec / durationSec) * 100, 0, 100) + '%';
        span.style.width = clamp(((orig.outSec - orig.inSec) / durationSec) * 100, 0, 100) + '%';
      },
    };
  }

  attachPointerTracker(leftGrip, ev => startDrag(ev, 'in'));
  attachPointerTracker(rightGrip, ev => startDrag(ev, 'out'));
  attachPointerTracker(span, ev => startDrag(ev, 'move'));
}

/** Make a timeline keyframe diamond draggable horizontally while keeping tap/click selection intact. */
export function attachKeyDrag({ button, track, item, child, key, comp, state, apply, problem, onSelect }) {
  const ticks = state.ticks;
  const durationTicks = BigInt(comp?.duration || ticks);
  const startTicks = BigInt(item.start_time || 0);
  const origKeyTicks = BigInt(key.time);
  const origCompTicks = startTicks + origKeyTicks;
  const { frameTicks } = frameInfo(comp, ticks);
  const pct = tickVal => clamp(Number(tickVal) / Number(durationTicks || 1n) * 100, 0, 100) + '%';
  let suppressClick = false;

  button.addEventListener('click', event => {
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onSelect(event);
  });

  attachPointerTracker(button, event => {
    if (!canEditLayer(state, item)) return null;
    const trackRect = track.getBoundingClientRect();
    if (trackRect.width <= 0) return null;
    const epoch = state.epoch, projectId = state.project.id, doc = state.project.document;
    const startX = event.clientX;
    let moved = false, nextCompTicks = origCompTicks;
    return {
      move(ev) {
        if (epoch !== state.epoch || doc !== state.project?.document) return;
        const dx = ev.clientX - startX;
        if (!moved && Math.abs(dx) < 5) return;
        moved = true;
        button.classList.add('is-dragging');
        const deltaTicks = BigInt(Math.round((dx / trackRect.width) * Number(durationTicks)));
        let raw = origCompTicks + deltaTicks;
        if (raw < 0n) raw = 0n;
        if (raw > durationTicks) raw = durationTicks;
        if (frameTicks > 0n) {
          raw = ((raw + frameTicks / 2n) / frameTicks) * frameTicks;
          if (raw > durationTicks) raw = durationTicks;
        }
        nextCompTicks = raw;
        button.style.left = pct(nextCompTicks);
      },
      async up() {
        button.classList.remove('is-dragging');
        if (!moved) return;
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 100);
        if (epoch !== state.epoch || projectId !== state.project?.id || doc !== state.project?.document) return;
        const newLayerTicks = nextCompTicks - startTicks;
        if (newLayerTicks === origKeyTicks) { button.style.left = pct(origCompTicks); return; }
        try {
          await apply([{
            command: 'keys.patchExact',
            params: {
              layer: String(item.id),
              prop: String(child.uid),
              timeTicks: String(origKeyTicks),
              newTimeTicks: String(newLayerTicks),
            },
          }]);
        } catch (error) {
          button.style.left = pct(origCompTicks);
          problem(error);
        }
      },
      cancel() {
        button.classList.remove('is-dragging');
        button.style.left = pct(origCompTicks);
      },
    };
  }, { preventDown: false });
}
