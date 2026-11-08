/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Immediate in-browser preview for the manual video editor (CREATE-EDIT-05d): a frame-exact playhead over the timeline that shows each segment's own source frame in a media element, the title overlay on its frames and the music bed under everything. A browser that cannot decode a clip says so and keeps the playhead, timing and titles working; the FFmpeg preview render stays the authoritative comparison with export.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Extend the existing private timeline/store/export contract with bounded v2 tracks, linked clips, color/fades/keyframes and timed captions.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Live browser preview for v1 and v2 timelines: pitch-preserved speed, color looks, stabilization margin, chroma-key/remove-bg RGBA compositing over lower video tracks, SVG sticker overlays, timed captions and multitrack audio clips.
 */
import { PROFILE, timelineFrames } from './timeline-validation.mjs';
import { locateFrame } from './timeline-model.mjs';
import { mediaUrl } from './editor-api.mjs';
import { clock } from './timeline-view.mjs';
import { STABILIZE_MODES, applyPreviewMatte, clipDurationFrames, cssFilterForClip } from './editor-effects.mjs';
import { stickerDataUri, stickerPoseAt } from './editor-stickers.mjs';

function activeVisualLayers(doc, at, total) {
  if (doc.version === 1) {
    const hit = locateFrame(doc, Math.min(at, Math.max(0, total - 1)));
    return hit ? [{ clip: hit.segment, source: doc.sources[hit.segment.source], sourceFrame: hit.sourceFrame }] : [];
  }
  const hits = [];
  for (const track of doc.tracks ?? []) {
    if (track.kind !== 'video' || track.muted) continue;
    for (const clip of track.clips) {
      const dur = clipDurationFrames(clip.in, clip.out, clip.speed ?? 100);
      if (at < clip.start || at >= clip.start + dur) continue;
      const speed = clip.speed ?? 100;
      const sourceFrame = Math.min(clip.out - 1, clip.in + Math.floor(((at - clip.start) * speed) / 100));
      hits.push({ clip, source: doc.sources[clip.source], sourceFrame });
    }
  }
  return hits;
}

function renderOverlays(nodes, doc, at) {
  const title = doc.titles.find(item => at >= item.start && at < item.end);
  nodes.overlay.hidden = !title;
  if (title) { nodes.overlay.textContent = title.text; nodes.overlay.dataset.position = title.position; nodes.overlay.dataset.size = title.size; }
  if (nodes.captions) {
    const cue = doc.captions?.find(item => at >= item.start && at < item.end);
    nodes.captions.hidden = !cue;
    if (cue) { nodes.captions.textContent = cue.text; nodes.captions.dataset.position = cue.position; nodes.captions.dataset.size = cue.size; }
  }
  if (nodes.stickers) {
    const active = (doc.stickers ?? []).filter(st => at >= st.start && at < st.end);
    nodes.stickers.hidden = !active.length;
    nodes.stickers.replaceChildren(...active.map(st => {
      const img = document.createElement('img'), pose = stickerPoseAt(st, at);
      img.className = 'sticker-item'; img.alt = ''; img.src = stickerDataUri(st.stickerId);
      img.style.left = `${pose.x}%`; img.style.top = `${pose.y}%`; img.style.width = `${(18 * pose.scale) / 100}%`;
      return img;
    }));
  }
}

function syncElementToLayer(el, layer, playing, previousKey, onDecodeError) {
  const wanted = `${layer.clip.id}:${layer.source.asset}:${layer.clip.speed ?? 100}`;
  const rate = (layer.clip.speed ?? 100) / 100;
  el.preservesPitch = true;
  if (el.playbackRate !== rate) el.playbackRate = rate;
  if (previousKey !== wanted) {
    if (!el.src.endsWith(mediaUrl(layer.source.asset))) el.src = mediaUrl(layer.source.asset);
    el.currentTime = layer.sourceFrame / PROFILE.fps;
    if (playing) el.play().catch(() => onDecodeError?.());
  } else if (!playing) {
    el.currentTime = layer.sourceFrame / PROFILE.fps;
  }
  return wanted;
}

function drawMatteFrame(nodes, clip, filterCss, zoomCss) {
  const matted = Boolean(clip?.chromaKey?.enabled || clip?.removeBg?.enabled);
  if (!nodes.canvas) return;
  if (!matted || nodes.viewer.readyState < 2) {
    nodes.canvas.hidden = true; nodes.viewer.style.opacity = ''; return;
  }
  const ctx = nodes.canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.clearRect(0, 0, nodes.canvas.width, nodes.canvas.height);
  ctx.drawImage(nodes.viewer, 0, 0, nodes.canvas.width, nodes.canvas.height);
  const img = ctx.getImageData(0, 0, nodes.canvas.width, nodes.canvas.height);
  applyPreviewMatte(img, clip.chromaKey, clip.removeBg);
  ctx.putImageData(img, 0, 0);
  nodes.canvas.style.filter = filterCss; nodes.canvas.style.transform = zoomCss;
  nodes.canvas.hidden = false; nodes.viewer.style.opacity = '0';
}

/**
 * @description Build the player over the page's preview elements.
 * @param {object} nodes viewer, underlay, canvas, stickers, captions, screen, bed, overlay, noPicture, playhead, clock and play elements.
 * @param {() => object} documentOf Current timeline document.
 * @param {(frame: number) => void} onFrame Called whenever the playhead moves.
 * @returns {{seek: Function, toggle: Function, pause: Function, step: Function, frame: () => number, refresh: Function}} Controls.
 */
export function createPlayer(nodes, documentOf, onFrame) {
  let frame = 0, playing = false, started = 0, showing = null, underShowing = null, raf = 0;
  const trackAudios = new Map();
  const total = () => timelineFrames(documentOf());
  nodes.viewer.addEventListener('error', () => { nodes.noPicture.hidden = false; });
  nodes.viewer.addEventListener('loadeddata', () => { nodes.noPicture.hidden = true; drawMatteFrame(nodes, activeTop()?.clip, nodes.viewer.style.filter, nodes.viewer.style.transform); });
  const activeTop = () => activeVisualLayers(documentOf(), frame, total()).at(-1) ?? null;

  function syncTrackAudios(doc, at) {
    if (!playing || doc.version !== 2) { for (const a of trackAudios.values()) a.pause(); return; }
    const activeIds = new Set();
    for (const track of doc.tracks ?? []) {
      if (track.kind !== 'audio' || track.muted) continue;
      for (const clip of track.clips) {
        const dur = clipDurationFrames(clip.in, clip.out, clip.speed ?? 100);
        if (at < clip.start || at >= clip.start + dur) continue;
        activeIds.add(clip.id);
        let audio = trackAudios.get(clip.id);
        if (!audio) { audio = new Audio(); audio.preload = 'auto'; trackAudios.set(clip.id, audio); }
        const url = mediaUrl(doc.sources[clip.source].asset), rate = (clip.speed ?? 100) / 100;
        if (!audio.src.endsWith(url)) audio.src = url;
        audio.preservesPitch = true; audio.playbackRate = rate; audio.volume = Math.min(1, (clip.volume ?? 100) / 100);
        if (audio.paused) { audio.currentTime = (clip.in + ((at - clip.start) * (clip.speed ?? 100)) / 100) / PROFILE.fps; audio.play().catch(() => undefined); }
      }
    }
    for (const [id, audio] of trackAudios) if (!activeIds.has(id)) audio.pause();
  }

  function show(at) {
    const doc = documentOf(), len = total();
    renderOverlays(nodes, doc, at);
    nodes.clock.value = `${clock(at)} / ${clock(len)}`;
    nodes.playhead.max = String(Math.max(0, len)); nodes.playhead.value = String(at);
    const layers = activeVisualLayers(doc, at, len), top = layers.at(-1), under = layers.length > 1 ? layers.at(-2) : null;
    if (!top) {
      nodes.viewer.pause(); nodes.viewer.hidden = true;
      if (nodes.underlay) { nodes.underlay.pause(); nodes.underlay.hidden = true; }
      if (nodes.canvas) nodes.canvas.hidden = true;
      nodes.screen?.removeAttribute('data-matte-backdrop');
      return;
    }
    nodes.viewer.hidden = false;
    const filterVal = cssFilterForClip({ ...top.clip, color: top.clip.brightness !== undefined ? top.clip : undefined });
    const filterCss = filterVal === 'none' ? '' : filterVal;
    const zoom = STABILIZE_MODES[top.clip.stabilize]?.zoom ?? 1, zoomCss = zoom > 1 ? `scale(${zoom})` : '';
    nodes.viewer.style.filter = filterCss; nodes.viewer.style.transform = zoomCss;
    const matted = Boolean(top.clip.chromaKey?.enabled || top.clip.removeBg?.enabled);
    nodes.screen?.toggleAttribute('data-matte-backdrop', matted && !under);
    if (under && nodes.underlay && matted) {
      nodes.underlay.hidden = false;
      underShowing = syncElementToLayer(nodes.underlay, under, playing, underShowing);
    } else if (nodes.underlay) {
      nodes.underlay.pause(); nodes.underlay.hidden = true; underShowing = null;
    }
    showing = syncElementToLayer(nodes.viewer, top, playing, showing, () => { nodes.noPicture.hidden = false; });
    nodes.viewer.volume = top.clip.audioEnabled === false ? 0 : Math.min(1, (top.clip.volume ?? 100) / 100);
    drawMatteFrame(nodes, top.clip, filterCss, zoomCss);
    syncTrackAudios(doc, at);
  }

  function seek(at) { frame = Math.max(0, Math.min(Number(at) || 0, total())); show(frame); onFrame(frame); }
  function syncBed() {
    const doc = documentOf(), bed = doc.audioBed && doc.sources[doc.audioBed.source];
    if (!bed || !playing) { nodes.bed.pause(); return; }
    if (!nodes.bed.src.endsWith(mediaUrl(bed.asset))) nodes.bed.src = mediaUrl(bed.asset);
    nodes.bed.volume = doc.audioBed.volume / 100; nodes.bed.currentTime = frame / PROFILE.fps;
    nodes.bed.play().catch(() => undefined);
  }
  function tick(now) {
    const next = Math.floor(((now - started) / 1000) * PROFILE.fps);
    if (next >= total()) { pause(); seek(total()); return; }
    if (next !== frame) { frame = next; show(frame); onFrame(frame); }
    else drawMatteFrame(nodes, activeTop()?.clip, nodes.viewer.style.filter, nodes.viewer.style.transform);
    raf = requestAnimationFrame(tick);
  }
  function play() {
    if (!total()) return;
    if (frame >= total()) frame = 0;
    playing = true; showing = null; underShowing = null; started = performance.now() - (frame / PROFILE.fps) * 1000;
    nodes.play.textContent = 'Pause'; show(frame); syncBed(); raf = requestAnimationFrame(tick);
  }
  function pause() {
    playing = false; cancelAnimationFrame(raf); nodes.viewer.pause(); nodes.underlay?.pause(); nodes.bed.pause();
    for (const a of trackAudios.values()) a.pause();
    nodes.play.textContent = 'Play';
  }
  return { seek, pause, frame: () => frame, playing: () => playing, toggle: () => (playing ? pause() : play()),
    step: delta => { pause(); seek(frame + delta); }, refresh: () => { showing = null; underShowing = null; seek(frame); } };
}
