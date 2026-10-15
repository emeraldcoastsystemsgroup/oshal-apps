/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add direct multitrack controls and measured waveforms to the existing private Video editor without adding another project store.
 */
import { migrateMultitrack, applyMultitrack } from './multitrack-model.mjs';
import { timelineFrames } from './timeline-validation.mjs';
import { mediaUrl } from './editor-api.mjs';
let selected = null;
const $ = id => document.getElementById(id);
const fields = ['start', 'in', 'out', 'volume', 'x', 'y', 'scale', 'opacity', 'fadeIn', 'fadeOut', 'brightness', 'contrast', 'saturation'];
const button = (text, run, disabled = false) => { const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.disabled = disabled; node.onclick = run; return node; };

/** @description Bind track/clip editing to the host page's existing immutable commits.
 * @param {object} ctx Existing document, apply, editable, frame and error callbacks.
 * @returns {object} Render, source append and selected clip helpers. */
export function createMultitrackEditor(ctx) {
  const operate = operation => ctx.apply(document => applyMultitrack(document, operation));
  const find = () => { for (const track of ctx.doc().tracks ?? []) { const clip = track.clips.find(clip => clip.id === selected); if (clip) return { track, clip }; } return null; };
  const safe = work => async () => { try { await work(); } catch (error) { ctx.error(error.message); } };

  const snapped = value => { const step = Number($('multiSnapFrames').value); return $('multiSnap').checked && Number.isSafeInteger(step) && step >= 1 && step <= 300 ? Math.round(value / step) * step : value; };

  function listTracks(timeline) {
    const list = $('multiTracks'); list.replaceChildren();
    for (const track of timeline.tracks) {
      const row = document.createElement('section'); row.className = 'multi-track';
      const heading = document.createElement('h3'); heading.textContent = `${track.name} · ${track.kind}`; row.append(heading);
      row.append(button(track.muted ? 'Unmute' : 'Mute', () => operate({ type: 'track', id: track.id, patch: { muted: !track.muted } }), !ctx.editable()),
        button(track.locked ? 'Unlock' : 'Lock', () => operate({ type: 'track', id: track.id, patch: { locked: !track.locked } }), !ctx.editable()));
      const strip = document.createElement('div'); strip.className = 'multi-clips';
      for (const clip of track.clips) {
        const node = button(`${timeline.sources[clip.source].name} · ${clip.start}–${clip.start + clip.out - clip.in}f${clip.link ? ' · linked' : ''}`, () => { selected = clip.id; render(); });
        node.dataset.multiClip = clip.id; node.draggable = ctx.editable() && !track.locked;
        const total = Math.max(1, timelineFrames(timeline)); node.style.left = `${clip.start / total * 100}%`; node.style.width = `${(clip.out - clip.in) / total * 100}%`;
        node.ondragstart = event => { event.dataTransfer.setData('text/plain', clip.id); event.dataTransfer.effectAllowed = 'move'; };
         node.setAttribute('aria-pressed', String(selected === clip.id)); strip.append(node);
      }
      strip.ondragover = event => { if (ctx.editable() && !track.locked) event.preventDefault(); };
      strip.ondrop = event => {
        event.preventDefault(); if (!ctx.editable() || track.locked) return;
        const id = event.dataTransfer.getData('text/plain'), own = timeline.tracks.flatMap(track => track.clips).find(clip => clip.id === id); if (!own) return;
        const box = strip.getBoundingClientRect(), frame = snapped(Math.round((event.clientX - box.left) / box.width * Math.max(1, timelineFrames(timeline))));
        operate({ type: 'moveClip', id, track: track.id, start: Math.max(0, Math.min(1800 - own.out + own.in, frame)) });
      };
      row.append(strip); list.append(row);
    }
  }

  function renderText(timeline) {
    const list = $('multiTextList'); list.replaceChildren();
    for (const key of ['titles', 'captions']) for (const entry of timeline[key]) {
      const row = document.createElement('li'), text = document.createElement('span'); text.textContent = `${key}: ${entry.text} · ${entry.start}–${entry.end}f`;
      row.append(text, button('Remove', () => operate({ type: 'removeText', track: key, id: entry.id }), !ctx.editable())); list.append(row);
    }
  }

  function render() {
    const timeline = ctx.doc(), advanced = timeline.version === 2, editable = ctx.editable();
    $('upgradeMultitrack').hidden = advanced; $('upgradeMultitrack').disabled = !editable;
    $('multitrackEditor').hidden = !advanced; if (!advanced) return;
    for (const node of $('multitrackEditor').querySelectorAll('[data-multi-edit]')) node.disabled = !editable;
    listTracks(timeline); renderText(timeline);
    const trackSelect = $('multiPlaceTrack'), oldTrack = trackSelect.value;
    trackSelect.replaceChildren(...timeline.tracks.map(track => new Option(`${track.name} (${track.kind})`, track.id))); trackSelect.value = oldTrack || timeline.tracks[0]?.id || '';
    const audio = $('multiAudioTrack'), oldAudio = audio.value; audio.replaceChildren(...timeline.tracks.filter(track => track.kind === 'audio').map(track => new Option(track.name, track.id))); audio.value = oldAudio || audio.options[0]?.value || '';
    const source = $('multiSource'), oldSource = source.value; source.replaceChildren(...Object.entries(timeline.sources).map(([key, value]) => new Option(value.name, key))); source.value = oldSource || source.options[0]?.value || '';
    const own = find(); $('multiClipControls').hidden = !own;
    if (!own) return;
    $('multiClipControls').disabled = !editable || own.track.locked;
    $('multiVideoEffects').hidden = own.track.kind !== 'video';
    for (const field of fields) if (document.activeElement !== $(`multi-${field}`)) $(`multi-${field}`).value = own.clip[field];
    $('multi-transition').value = own.clip.transition; $('multi-audioEnabled').checked = own.clip.audioEnabled;
    $('multi-audioEnabled').disabled = !editable || own.track.locked || !!own.clip.link;
    $('multiKeys').replaceChildren(...own.clip.keys.map(key => {
      const row = document.createElement('li'); row.textContent = `${key.property}: ${key.value} at clip frame ${key.frame} (${key.interpolation})`;
      row.append(button('Remove', () => operate({ type: 'clip', id: own.clip.id, patch: { keys: own.clip.keys.filter(value => value !== key) } }), !editable || own.track.locked)); return row;
    }));
  }

  function appendSource(document, sourceKey) {
    const kind = document.sources[sourceKey].kind, target = document.tracks.find(track => track.kind === kind && !track.locked);
    if (!target) throw new Error('Add an unlocked track for this source first.');
    const start = Math.max(0, ...target.clips.map(clip => clip.start + clip.out - clip.in));
    if (start >= 1800) return document;
    return applyMultitrack(document, { type: 'addClip', track: target.id, source: sourceKey, start });
  }

  async function waveform() {
    const own = find(), source = own ? ctx.doc().sources[own.clip.source] : ctx.doc().sources[$('multiSource').value];
    if (!source || source.kind === 'video' && !source.audio) throw new Error('Choose a source with sound.');
    const requested = source.asset, response = await fetch(mediaUrl(requested), { credentials: 'same-origin', redirect: 'error' });
    if (!response.ok) throw new Error('This audio source is no longer available.');
    const reader = response.body.getReader(), chunks = []; let bytes = 0;
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 104857600) throw new Error('Waveform source exceeds 100 MiB.'); chunks.push(value); } }
    finally { await reader.cancel(); }
    const data = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    const audio = new AudioContext();
    try {
      const buffer = await audio.decodeAudioData(data.buffer), canvas = $('multiWaveform'), paint = canvas.getContext('2d');
      if (!Object.values(ctx.doc().sources).some(source => source.asset === requested)) throw new Error('The project changed while decoding audio.');
      paint.clearRect(0, 0, canvas.width, canvas.height); paint.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent-primary') || '#7c3aed'; let peak = 0;
      for (let x = 0; x < canvas.width; x++) {
        let value = 0; const start = Math.floor(x * buffer.length / canvas.width), end = Math.max(start + 1, Math.floor((x + 1) * buffer.length / canvas.width));
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) { const values = buffer.getChannelData(channel); for (let index = start; index < end; index++) value = Math.max(value, Math.abs(values[index] ?? 0)); }
        peak = Math.max(peak, value); paint.beginPath(); paint.moveTo(x, canvas.height / 2 - value * canvas.height / 2); paint.lineTo(x, canvas.height / 2 + value * canvas.height / 2); paint.stroke();
      }
      $('multiWaveformStatus').textContent = `Source peak: ${peak > 0 ? (20 * Math.log10(peak)).toFixed(1) : '−∞'} dBFS. ${peak * (own?.clip.volume ?? 100) / 100 > .95 ? 'This gain may trigger the mix limiter.' : ''}`;
    } finally { await audio.close(); }
  }

  $('upgradeMultitrack').onclick = () => ctx.apply(migrateMultitrack);
  $('multiAddTrack').onclick = () => operate({ type: 'addTrack', kind: $('multiTrackKind').value, name: $('multiTrackName').value || 'Track' });
  $('multiPlaceSource').onclick = () => operate({ type: 'addClip', track: $('multiPlaceTrack').value, source: $('multiSource').value, start: snapped(Number($('multiPlaceStart').value)) });
  for (const field of fields) $(`multi-${field}`).onchange = () => { if (selected) operate({ type: 'clip', id: selected, patch: { [field]: field === 'start' ? snapped(Number($(`multi-${field}`).value)) : Number($(`multi-${field}`).value) } }); };
  $('multi-transition').onchange = () => operate({ type: 'clip', id: selected, patch: { transition: $('multi-transition').value } });
  $('multi-audioEnabled').onchange = () => operate({ type: 'clip', id: selected, patch: { audioEnabled: $('multi-audioEnabled').checked } });
  $('multiSplit').onclick = () => operate({ type: 'split', id: selected, frame: Number($('multiSplitFrame').value) });
  $('multiRemove').onclick = () => operate({ type: 'removeClip', id: selected });
  $('multiRipple').onclick = () => operate({ type: 'removeClip', id: selected, ripple: true });
  $('multiExtractAudio').onclick = () => operate({ type: 'extractAudio', id: selected, track: $('multiAudioTrack').value });
  $('multiUnlink').onclick = () => operate({ type: 'unlink', id: selected });
  $('multiAddKey').onclick = () => {
    const own = find(); if (!own) return; const key = { property: $('multiKeyProperty').value, frame: Number($('multiKeyFrame').value), value: Number($('multiKeyValue').value), interpolation: $('multiKeyInterpolation').value };
    operate({ type: 'clip', id: selected, patch: { keys: [...own.clip.keys.filter(value => value.property !== key.property || value.frame !== key.frame), key] } });
  };
  $('multiAddText').onclick = () => operate({ type: 'text', track: $('multiTextKind').value, entry: { text: $('multiText').value,
    start: Number($('multiTextStart').value), end: Number($('multiTextEnd').value), position: $('multiTextPosition').value, size: $('multiTextSize').value } });
  $('multiShowWaveform').onclick = safe(waveform);
  return { render, appendSource, selected: find };
}
