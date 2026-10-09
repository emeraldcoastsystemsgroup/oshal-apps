/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Immediate in-browser preview for the manual video editor (CREATE-EDIT-05d): a frame-exact playhead over the timeline that shows each segment's own source frame in a media element, the title overlay on its frames and the music bed under everything. A browser that cannot decode a clip says so and keeps the playhead, timing and titles working; the FFmpeg preview render stays the authoritative comparison with export.
 */
import { PROFILE } from './timeline-validation.mjs';
import { locateFrame, timelineLayout } from './timeline-model.mjs';
import { mediaUrl } from './editor-api.mjs';
import { clock } from './timeline-view.mjs';

/**
 * @description Build the player over the page's preview elements.
 * @param {object} nodes viewer, bed, overlay, noPicture, playhead, clock and play elements.
 * @param {() => object} documentOf Current timeline document.
 * @param {(frame: number) => void} onFrame Called whenever the playhead moves.
 * @returns {{seek: Function, toggle: Function, pause: Function, step: Function, frame: () => number, refresh: Function}} Controls.
 */
export function createPlayer(nodes, documentOf, onFrame) {
  let frame = 0, playing = false, started = 0, showing = null, raf = 0;
  const total = () => timelineLayout(documentOf()).reduce((sum, row) => sum + row.out - row.in, 0);
  nodes.viewer.addEventListener('error', () => { nodes.noPicture.hidden = false; });
  nodes.viewer.addEventListener('loadeddata', () => { nodes.noPicture.hidden = true; });

  function show(at) {
    const doc = documentOf(), located = locateFrame(doc, Math.min(at, Math.max(0, total() - 1)));
    const title = doc.titles.find(item => at >= item.start && at < item.end);
    nodes.overlay.hidden = !title;
    if (title) { nodes.overlay.textContent = title.text; nodes.overlay.dataset.position = title.position; nodes.overlay.dataset.size = title.size; }
    nodes.clock.value = `${clock(at)} / ${clock(total())}`;
    nodes.playhead.max = String(Math.max(0, total())); nodes.playhead.value = String(at);
    if (!located) return;
    const source = doc.sources[located.segment.source], wanted = `${located.segment.id}:${source.asset}`;
    if (showing !== wanted) {
      showing = wanted;
      if (!nodes.viewer.src.endsWith(mediaUrl(source.asset))) nodes.viewer.src = mediaUrl(source.asset);
      nodes.viewer.currentTime = located.sourceFrame / PROFILE.fps;
      if (playing) nodes.viewer.play().catch(() => { nodes.noPicture.hidden = false; });
    } else if (!playing) nodes.viewer.currentTime = located.sourceFrame / PROFILE.fps;
    nodes.viewer.volume = Math.min(1, located.segment.volume / 100);
  }

  function seek(at) {
    frame = Math.max(0, Math.min(Number(at) || 0, total()));
    show(frame); onFrame(frame);
  }
  function tick(now) {
    const next = Math.floor(((now - started) / 1000) * PROFILE.fps);
    if (next >= total()) { pause(); seek(total()); return; }
    if (next !== frame) { frame = next; show(frame); onFrame(frame); }
    raf = requestAnimationFrame(tick);
  }
  function syncBed() {
    const doc = documentOf(), bed = doc.audioBed && doc.sources[doc.audioBed.source];
    if (!bed || !playing) { nodes.bed.pause(); return; }
    if (!nodes.bed.src.endsWith(mediaUrl(bed.asset))) nodes.bed.src = mediaUrl(bed.asset);
    nodes.bed.volume = doc.audioBed.volume / 100; nodes.bed.currentTime = frame / PROFILE.fps;
    nodes.bed.play().catch(() => undefined);
  }
  function play() {
    if (!total()) return;
    if (frame >= total()) frame = 0;
    playing = true; showing = null; started = performance.now() - (frame / PROFILE.fps) * 1000;
    nodes.play.textContent = 'Pause'; show(frame); syncBed(); raf = requestAnimationFrame(tick);
  }
  function pause() {
    playing = false; cancelAnimationFrame(raf); nodes.viewer.pause(); nodes.bed.pause(); nodes.play.textContent = 'Play';
  }
  return { seek, pause, frame: () => frame, playing: () => playing,
    toggle: () => (playing ? pause() : play()),
    step: delta => { pause(); seek(frame + delta); },
    refresh: () => { showing = null; seek(frame); } };
}
