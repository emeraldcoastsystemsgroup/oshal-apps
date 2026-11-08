/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Reference-product tool sheets and controls for Video 1.14.0 (RP-VID-01..10): clip speed, auto captions, stickers, color looks, chroma key, background matting, voice synthesis, stabilization, export resolution/fps and CC0 sound library.
 */
import * as timeline from './timeline-model.mjs';
import { applyMultitrack, migrateMultitrack } from './multitrack-model.mjs';
import { timelineFrames, validateTimeline } from './timeline-validation.mjs';
import { BASE, call, describe } from './editor-api.mjs';
import { optionsFromProfile } from './editor-export.mjs';
import {
  EXPORT_FPS_VALUES, EXPORT_RESOLUTIONS, LOOK_CATALOG, SPEED_BOUNDS, SPEED_PRESETS, STABILIZE_MODES,
  clipDurationFrames, formatSpeed, resolveExportSpec,
} from './editor-effects.mjs';
import { STICKER_BY_ID, STICKER_CATALOG, stickerDataUri } from './editor-stickers.mjs';

const VOICES = Object.freeze([
  ['slt', 'Studio Female (SLT)'], ['rms', 'Warm Baritone (RMS)'],
  ['kal16', 'Clear Narrator (KAL16)'], ['awb', 'Scottish Cadence (AWB)'],
]);

function selectedTarget(current, sel) {
  if (!sel) return null;
  if (current.version === 1 && sel.kind === 'segment') {
    const clip = current.segments.find(item => item.id === sel.id);
    return clip ? { version: 1, kind: 'video', clip } : null;
  }
  if (current.version === 2 && sel.kind === 'clip') {
    for (const track of current.tracks ?? []) {
      const clip = track.clips.find(item => item.id === sel.id);
      if (clip) return { version: 2, kind: track.kind, locked: track.locked, clip };
    }
  }
  return null;
}

export function placeAudioClipOnTimeline(current, media, label, startFrame = 0) {
  const base = current.version === 2 ? current : migrateMultitrack(current);
  const existing = Object.entries(base.sources).find(([, s]) => s.asset === media.id);
  const { document: withSource, key } = existing
    ? { document: base, key: existing[0] }
    : timeline.addSource(base, { kind: 'audio', asset: media.id, name: label.slice(0, 120), frames: media.frames });
  const clampedStart = Math.max(0, Math.min(1799, Math.round(startFrame)));
  const out = Math.max(1, Math.min(media.frames, 1800 - clampedStart));
  const freeTrack = withSource.tracks.find(tr => tr.kind === 'audio' && !tr.locked && !tr.clips.some(c => {
    const cEnd = c.start + clipDurationFrames(c.in, c.out, c.speed ?? 100);
    return clampedStart < cEnd && clampedStart + out > c.start;
  }));
  let targetDoc = withSource, trackId = freeTrack?.id;
  if (!trackId) {
    const audioCount = withSource.tracks.filter(tr => tr.kind === 'audio').length;
    if (audioCount < 8) {
      targetDoc = applyMultitrack(withSource, { type: 'addTrack', kind: 'audio', name: `Audio ${audioCount + 1}` });
      trackId = targetDoc.tracks.at(-1).id;
    } else {
      trackId = withSource.tracks.find(tr => tr.kind === 'audio' && !tr.locked)?.id;
    }
  }
  if (!trackId) throw new Error('Unlock an audio track before adding audio.');
  return applyMultitrack(targetDoc, { type: 'addClip', track: trackId, source: key, start: clampedStart, in: 0, out });
}

function collectCaptionSources(current) {
  if (current.version === 1) {
    return timeline.timelineLayout(current).filter(seg => current.sources[seg.source]?.audio)
      .map(seg => ({ mediaId: current.sources[seg.source].asset, inFrame: seg.in, outFrame: seg.out, timelineStart: seg.start, speed: seg.speed ?? 100 }));
  }
  const items = [];
  for (const tr of current.tracks ?? []) {
    if (tr.muted) continue;
    for (const c of tr.clips) {
      const src = current.sources[c.source];
      if (tr.kind === 'audio' || (src?.audio && c.audioEnabled !== false)) {
        items.push({ mediaId: src.asset, inFrame: c.in, outFrame: c.out, timelineStart: c.start, speed: c.speed ?? 100 });
      }
    }
  }
  return items;
}

function applyLookToAllVideo(docState, look) {
  if (docState.version === 1) {
    let next = docState;
    for (const seg of docState.segments) next = timeline.patchSegment(next, seg.id, { look });
    return next;
  }
  let next = docState;
  for (const tr of docState.tracks.filter(t => t.kind === 'video' && !t.locked)) {
    for (const c of tr.clips) next = applyMultitrack(next, { type: 'clip', id: c.id, patch: { look } });
  }
  return next;
}

function openSpeedSheet(env) {
  const { adapter, layers, make, act, patchClip } = env;
  const target = selectedTarget(adapter.doc(), adapter.selection());
  if (!target) return;
  const layer = layers.create('Speed', 'ds-sheet'), wrap = make('div', 'rp-section');
  const readout = make('p', 'video-help', ''), pills = make('div', 'rp-pill-group');
  const sliderField = make('label', 'rp-field', 'Playback speed (%)'), slider = make('input', '');
  slider.type = 'range'; slider.min = String(SPEED_BOUNDS.min); slider.max = String(SPEED_BOUNDS.max); slider.step = '5';
  slider.dataset.speedSlider = '';
  const syncUi = speed => {
    const dur = clipDurationFrames(target.clip.in, target.clip.out, speed);
    slider.value = String(speed);
    readout.textContent = `${formatSpeed(speed)} · ${(dur / 30).toFixed(2)}s on timeline · pitch preserved`;
    for (const btn of pills.querySelectorAll('button')) btn.setAttribute('aria-pressed', String(Number(btn.dataset.speedPreset) === speed));
  };
  for (const preset of SPEED_PRESETS) {
    const btn = make('button', 'rp-pill', formatSpeed(preset));
    btn.type = 'button'; btn.dataset.speedPreset = String(preset);
    btn.onclick = act(() => { if (patchClip({ speed: preset })) syncUi(preset); });
    pills.append(btn);
  }
  slider.onchange = act(() => { const next = Number(slider.value); if (patchClip({ speed: next })) syncUi(next); });
  sliderField.append(slider); wrap.append(readout, pills, sliderField);
  syncUi(target.clip.speed ?? 100); layer.body.append(wrap);
  return layers.open(layer);
}

function renderCaptionCueList(env, host) {
  const { adapter, make, act } = env, cues = adapter.doc().captions ?? [];
  host.replaceChildren(...cues.map(cue => {
    const li = make('li', 'rp-cue-item'), head = make('div', 'rp-inline');
    const badge = make('span', 'rp-badge', `${(cue.start / 30).toFixed(1)}s–${(cue.end / 30).toFixed(1)}s`);
    const remove = make('button', '', 'Remove'); remove.type = 'button';
    const input = make('input', ''); input.type = 'text'; input.maxLength = 240; input.value = cue.text; input.dataset.captionCueInput = cue.id;
    input.onchange = act(() => {
      const text = input.value.trim(); if (!text) return;
      adapter.apply(cur => cur.version === 2 ? applyMultitrack(cur, { type: 'updateText', track: 'captions', id: cue.id, patch: { text } }) : timeline.setCaptions(cur, (cur.captions ?? []).map(c => c.id === cue.id ? { ...c, text } : c)));
    });
    remove.onclick = act(() => {
      adapter.apply(cur => cur.version === 2 ? applyMultitrack(cur, { type: 'removeText', track: 'captions', id: cue.id }) : timeline.setCaptions(cur, (cur.captions ?? []).filter(c => c.id !== cue.id)));
      renderCaptionCueList(env, host);
    });
    head.append(badge, remove); li.append(head, input); return li;
  }));
}

function buildAutoCaptionsNode(env) {
  const { adapter, make, act } = env, box = make('section', 'rp-section'), top = make('div', 'rp-inline');
  const title = make('h3', 'ds-layer-title', 'Auto captions'), badge = make('span', 'rp-badge', 'EN');
  badge.dataset.captionLangBadge = '';
  const langField = make('label', 'rp-field', 'Spoken language'), lang = make('select', '');
  lang.dataset.captionLang = '';
  for (const [code, name] of [['en', 'English (EN)'], ['es', 'Español (ES)'], ['fr', 'Français (FR)'], ['de', 'Deutsch (DE)']]) lang.append(new Option(name, code));
  lang.onchange = () => { badge.textContent = lang.value.toUpperCase(); };
  const runBtn = make('button', '', 'Auto captions'); runBtn.type = 'button'; runBtn.dataset.autoCaptionsRun = '';
  const status = make('p', 'video-help', 'Transcribe speech from clips on the timeline into editable timed captions.');
  status.dataset.autoCaptionsStatus = '';
  const cueList = make('ul', 'rp-cue-list'); cueList.dataset.autoCaptionsList = '';
  runBtn.onclick = act(async () => {
    const targets = collectCaptionSources(adapter.doc());
    if (!targets.length) { status.textContent = 'Add a clip with audio before generating captions.'; return; }
    runBtn.disabled = true; status.textContent = 'Analyzing clip speech…';
    try {
      const res = await call('/auto-captions', { method: 'POST', body: { document: adapter.doc() } });
      badge.textContent = String(res.language || lang.value).toUpperCase();
      const merged = (res.cues ?? []).slice(0, 50);
      if (!merged.length) { status.textContent = 'No voiced speech detected in timeline audio.'; renderCaptionCueList(env, cueList); return; }
      adapter.apply(cur => cur.version === 2 ? applyMultitrack(cur, { type: 'setCaptions', cues: merged }) : timeline.setCaptions(cur, merged));
      status.textContent = `Added ${merged.length} caption ${merged.length === 1 ? 'cue' : 'cues'} (${badge.textContent}).`;
      renderCaptionCueList(env, cueList);
    } catch (err) { status.textContent = describe(err); } finally { runBtn.disabled = false; }
  });
  langField.append(lang); top.append(title, badge); box.append(top, langField, runBtn, status, cueList);
  renderCaptionCueList(env, cueList);
  return box;
}

function renderPlacedStickers(env, host) {
  const { adapter, make, act } = env, list = adapter.doc().stickers ?? [], total = Math.max(1, timelineFrames(adapter.doc()));
  host.replaceChildren(...list.map(st => {
    const meta = STICKER_BY_ID.get(st.stickerId), li = make('li', 'rp-cue-item'), top = make('div', 'rp-inline');
    top.append(make('span', '', `${meta?.glyph ?? '★'} ${meta?.label ?? st.stickerId} (${st.start}–${st.end}f)`), make('span', 'rp-badge', meta?.license ?? 'CC0-1.0'));
    const controls = make('div', 'rp-inline');
    const mkNum = (lbl, val, min, max, key) => {
      const l = make('label', 'small', lbl), inp = make('input', '');
      inp.type = 'number'; inp.min = String(min); inp.max = String(max); inp.value = String(val); inp.style.width = '72px';
      inp.onchange = act(() => {
        const patch = { [key]: Number(inp.value) };
        adapter.apply(cur => cur.version === 2 ? applyMultitrack(cur, { type: 'updateSticker', id: st.id, patch }) : timeline.updateSticker(cur, st.id, patch));
        renderPlacedStickers(env, host);
      });
      l.append(inp); return l;
    };
    const motionBtn = make('button', '', st.keys?.length ? 'Static pose' : 'Slide motion'); motionBtn.type = 'button';
    motionBtn.onclick = act(() => {
      const dur = st.end - st.start;
      const keys = st.keys?.length ? undefined : [{ frame: 0, x: Math.max(10, st.x - 15), y: st.y, scale: st.scale }, { frame: dur, x: Math.min(90, st.x + 15), y: st.y, scale: st.scale }];
      adapter.apply(cur => cur.version === 2 ? applyMultitrack(cur, { type: 'updateSticker', id: st.id, patch: { keys } }) : timeline.updateSticker(cur, st.id, { keys }));
      renderPlacedStickers(env, host);
    });
    const del = make('button', '', 'Remove'); del.type = 'button';
    del.onclick = act(() => {
      adapter.apply(cur => cur.version === 2 ? applyMultitrack(cur, { type: 'removeSticker', id: st.id }) : timeline.removeSticker(cur, st.id));
      renderPlacedStickers(env, host);
    });
    controls.append(mkNum('X%', st.x, 0, 100, 'x'), mkNum('Y%', st.y, 0, 100, 'y'), mkNum('Scale%', st.scale, 25, 300, 'scale'), mkNum('End', st.end, st.start + 1, total, 'end'), motionBtn, del);
    li.append(top, controls); return li;
  }));
}

function openStickersSheet(env) {
  const { domDoc, adapter, layers, make, act } = env, layer = layers.create('Stickers', 'ds-sheet'), grid = make('div', 'rp-grid');
  const status = make('p', 'video-help', 'Built-in OSHAL Original SVG stickers (CC0-1.0). Tap to add onto the timeline.');
  const placed = make('ul', 'rp-cue-list'); placed.dataset.placedStickers = '';
  for (const item of STICKER_CATALOG) {
    const card = make('button', 'rp-sticker-card'), img = domDoc.createElement('img');
    card.type = 'button'; card.dataset.stickerPick = item.id;
    img.src = stickerDataUri(item.id); img.alt = '';
    card.append(img, make('span', '', item.label), make('span', 'rp-badge', item.license));
    card.onclick = act(() => {
      const total = timelineFrames(adapter.doc());
      if (total <= 0) { status.textContent = 'Add a clip to the timeline before placing stickers.'; return; }
      const start = Math.min(adapter.frame(), total - 1), end = Math.min(total, Math.max(start + 1, start + 90));
      const entry = { stickerId: item.id, start, end, x: 50, y: 25, scale: 100 };
      if (adapter.apply(cur => cur.version === 2 ? applyMultitrack(cur, { type: 'addSticker', entry }) : timeline.addSticker(cur, entry))) {
        status.textContent = `Placed ${item.label}.`; renderPlacedStickers(env, placed);
      }
    });
    grid.append(card);
  }
  renderPlacedStickers(env, placed);
  layer.body.append(status, grid, placed);
  return layers.open(layer);
}

function openLooksSheet(env, mode = 'clip') {
  const { adapter, layers, make, act, patchClip } = env;
  const target = mode === 'clip' ? selectedTarget(adapter.doc(), adapter.selection()) : null;
  const initial = target?.clip?.look ?? (adapter.doc().segments?.[0]?.look ?? adapter.doc().tracks?.find(t => t.kind === 'video')?.clips?.[0]?.look);
  let chosenId = initial?.id ?? 'none', strength = initial?.strength ?? 80;
  const layer = layers.create(mode === 'clip' ? 'Effects' : 'Filters', 'ds-sheet');
  const grid = make('div', 'rp-grid'), status = make('p', 'video-help', 'Named color grade previewed live and baked into FFmpeg export.');
  const sliderField = make('label', 'rp-field', `Filter strength (${strength}%)`), slider = make('input', '');
  slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '5'; slider.value = String(strength); slider.dataset.lookStrength = '';
  const commitLook = () => {
    const look = chosenId === 'none' || strength === 0 ? undefined : { id: chosenId, strength };
    if (mode === 'clip') { patchClip({ look }); return; }
    const cur = adapter.doc(), hasVideo = cur.version === 2 ? cur.tracks.some(t => t.kind === 'video' && t.clips.length) : cur.segments.length > 0;
    if (!hasVideo) { status.textContent = 'Add a video clip first to apply a color filter.'; return; }
    adapter.apply(docState => applyLookToAllVideo(docState, look));
  };
  const syncCards = () => {
    sliderField.firstChild.textContent = `Filter strength (${strength}%)`;
    for (const btn of grid.querySelectorAll('button')) btn.setAttribute('aria-pressed', String(btn.dataset.lookPick === chosenId));
  };
  for (const item of LOOK_CATALOG) {
    const card = make('button', 'rp-look-card'), swatch = make('span', 'rp-swatch');
    card.type = 'button'; card.dataset.lookPick = item.id; swatch.style.backgroundColor = item.swatch;
    card.append(swatch, make('span', '', item.label));
    card.onclick = act(() => { chosenId = item.id; if (chosenId !== 'none' && strength === 0) { strength = 80; slider.value = '80'; } syncCards(); commitLook(); });
    grid.append(card);
  }
  slider.onchange = act(() => { strength = Number(slider.value); syncCards(); commitLook(); });
  sliderField.append(slider); syncCards(); layer.body.append(status, grid, sliderField);
  return layers.open(layer);
}

function openChromaKeySheet(env) {
  const { adapter, layers, make, act, patchClip } = env;
  const target = selectedTarget(adapter.doc(), adapter.selection());
  if (!target || target.kind !== 'video') return;
  const ck = target.clip.chromaKey ?? { enabled: false, color: '#00b140', similarity: 35, blend: 15 };
  const layer = layers.create('Chroma key', 'ds-sheet'), wrap = make('div', 'rp-section');
  const toggleRow = make('label', 'rp-inline', ''), toggle = make('input', '');
  toggle.type = 'checkbox'; toggle.checked = Boolean(ck.enabled); toggle.dataset.chromakeyEnabled = '';
  toggleRow.append(toggle, make('span', '', 'Enable chroma key transparency'));
  const colorRow = make('label', 'rp-field', 'Key color'), color = make('input', '');
  color.type = 'color'; color.value = ck.color; color.dataset.chromakeyColor = '';
  const presets = make('div', 'rp-pill-group');
  const simRow = make('label', 'rp-field', 'Similarity (%)'), sim = make('input', '');
  sim.type = 'range'; sim.min = '1'; sim.max = '100'; sim.value = String(ck.similarity); sim.dataset.chromakeySimilarity = '';
  const blendRow = make('label', 'rp-field', 'Edge blend (%)'), blend = make('input', '');
  blend.type = 'range'; blend.min = '0'; blend.max = '100'; blend.value = String(ck.blend); blend.dataset.chromakeyBlend = '';
  const save = () => patchClip({ chromaKey: toggle.checked ? { enabled: true, color: color.value, similarity: Number(sim.value), blend: Number(blend.value) } : undefined });
  for (const [label, hex] of [['Green screen', '#00b140'], ['Blue screen', '#0047bb'], ['Cyan plate', '#00bcd4']]) {
    const p = make('button', 'rp-pill', label); p.type = 'button';
    p.onclick = act(() => { color.value = hex; toggle.checked = true; save(); });
    presets.append(p);
  }
  for (const el of [toggle, color, sim, blend]) el.onchange = act(save);
  colorRow.append(color); simRow.append(sim); blendRow.append(blend);
  wrap.append(toggleRow, presets, colorRow, simRow, blendRow); layer.body.append(wrap);
  return layers.open(layer);
}

function openRemoveBgSheet(env) {
  const { adapter, layers, make, act, patchClip } = env;
  const target = selectedTarget(adapter.doc(), adapter.selection());
  if (!target || target.kind !== 'video') return;
  const cur = target.clip.removeBg ?? { enabled: false, strength: 60 };
  const layer = layers.create('Remove background', 'ds-sheet'), wrap = make('div', 'rp-section');
  const help = make('p', 'video-help', 'Isolates foreground subject from border backdrop into RGBA alpha while keeping the original source clip intact.');
  const toggleRow = make('label', 'rp-inline', ''), toggle = make('input', '');
  toggle.type = 'checkbox'; toggle.checked = Boolean(cur.enabled); toggle.dataset.removebgEnabled = '';
  toggleRow.append(toggle, make('span', '', 'Remove clip background'));
  const strengthRow = make('label', 'rp-field', 'Foreground matte strength (%)'), strength = make('input', '');
  strength.type = 'range'; strength.min = '1'; strength.max = '100'; strength.value = String(cur.strength); strength.dataset.removebgStrength = '';
  const save = () => patchClip({ removeBg: toggle.checked ? { enabled: true, strength: Number(strength.value) } : undefined });
  toggle.onchange = act(save); strength.onchange = act(save);
  strengthRow.append(strength); wrap.append(help, toggleRow, strengthRow); layer.body.append(wrap);
  return layers.open(layer);
}

function openStabilizeSheet(env) {
  const { adapter, layers, make, act, patchClip } = env;
  const target = selectedTarget(adapter.doc(), adapter.selection());
  if (!target || target.kind !== 'video') return;
  const layer = layers.create('Stabilize', 'ds-sheet'), wrap = make('div', 'rp-section');
  const help = make('p', 'video-help', 'Smooths handheld camera motion in preview and FFmpeg deshake export.');
  const group = make('div', 'rp-pill-group');
  const sync = mode => { for (const b of group.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.stabilizeMode === mode)); };
  for (const spec of Object.values(STABILIZE_MODES)) {
    const cropPct = Math.round((spec.zoom - 1) * 100);
    const btn = make('button', 'rp-pill', cropPct ? `${spec.label} (${cropPct}% margin)` : spec.label);
    btn.type = 'button'; btn.dataset.stabilizeMode = spec.id;
    btn.onclick = act(() => { if (patchClip({ stabilize: spec.id === 'off' ? undefined : spec.id })) sync(spec.id); });
    group.append(btn);
  }
  sync(target.clip.stabilize ?? 'off'); wrap.append(help, group); layer.body.append(wrap);
  return layers.open(layer);
}

function openVoiceSheet(env) {
  const { adapter, layers, make, act, setStatus } = env, layer = layers.create('Voice narration', 'ds-sheet'), wrap = make('div', 'rp-section');
  const textField = make('label', 'rp-field', 'Narration script'), text = make('textarea', '');
  text.rows = 3; text.maxLength = 400; text.placeholder = 'Write narration to synthesize onto an audio track…'; text.dataset.voiceText = '';
  const voiceField = make('label', 'rp-field', 'Voice'), voice = make('select', ''); voice.dataset.voiceSelect = '';
  for (const [id, label] of VOICES) voice.append(new Option(label, id));
  const placeField = make('label', 'rp-field', 'Placement'), place = make('select', '');
  place.append(new Option('At playhead', 'playhead'), new Option('Start of timeline', 'start'));
  const submit = make('button', '', 'Synthesize voice clip'); submit.type = 'button'; submit.dataset.voiceSubmit = '';
  const status = make('p', 'video-help', 'Synthesizes a 48 kHz WAV voice clip onto a timeline audio track.'); status.dataset.voiceStatus = '';
  submit.onclick = act(async () => {
    const script = text.value.trim();
    if (!script) { status.textContent = 'Enter narration text first.'; return; }
    submit.disabled = true; status.textContent = 'Synthesizing voice clip…';
    try {
      const startFrame = place.value === 'playhead' ? adapter.frame() : 0;
      const res = await call('/voice', { method: 'POST', body: { text: script, voice: voice.value } });
      const ok = adapter.apply(cur => placeAudioClipOnTimeline(cur, res.media, `Voice: ${script.slice(0, 36)}`, startFrame));
      status.textContent = ok ? 'Voice clip added to audio track.' : 'Could not place voice clip on timeline.';
      if (ok) setStatus?.('Voice narration added.');
    } catch (err) { status.textContent = describe(err); } finally { submit.disabled = false; }
  });
  textField.append(text); voiceField.append(voice); placeField.append(place);
  wrap.append(textField, voiceField, placeField, submit, status); layer.body.append(wrap);
  return layers.open(layer);
}

async function openSoundLibrarySheet(env) {
  const { domDoc, adapter, layers, make, act } = env, layer = layers.create('Sound effects & music', 'ds-sheet'), wrap = make('div', 'rp-section');
  const tabs = make('div', 'rp-pill-group'), list = make('ul', 'rp-sound-list'), previewAudio = domDoc.createElement('audio');
  const status = make('p', 'video-help', 'Loading CC0-1.0 procedural music beds and sound effects…');
  let catalog = [], filter = 'all';
  const renderItems = () => {
    for (const b of tabs.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.soundTab === filter));
    list.replaceChildren(...catalog.filter(item => filter === 'all' || item.category === filter).map(item => {
      const li = make('li', 'rp-sound-item'), head = make('div', 'rp-inline'), btns = make('div', 'rp-inline');
      head.append(make('strong', '', `${item.title} · ${item.durationSeconds ?? item.seconds}s`), make('span', 'rp-badge', `${item.license} · ${item.attribution}`));
      const listen = make('button', '', 'Preview'); listen.type = 'button';
      listen.onclick = () => { previewAudio.src = `${BASE}/sound-library/${encodeURIComponent(item.id)}/preview`; previewAudio.play().catch(() => {}); };
      const add = make('button', '', 'Add to timeline'); add.type = 'button'; add.dataset.soundImport = item.id;
      add.onclick = act(async () => {
        add.disabled = true; status.textContent = `Adding ${item.title}…`;
        try {
          const res = await call(`/sound-library/${encodeURIComponent(item.id)}/import`, { method: 'POST', body: {} });
          const ok = adapter.apply(cur => placeAudioClipOnTimeline(cur, res.media, item.title, item.category === 'sfx' ? adapter.frame() : 0));
          status.textContent = ok ? `Added ${item.title} (${item.license}) to audio track.` : 'Timeline audio tracks are full.';
        } catch (err) { status.textContent = describe(err); } finally { add.disabled = false; }
      });
      btns.append(listen, add); li.append(head, btns); return li;
    }));
  };
  for (const [id, label] of [['all', 'All'], ['music', 'Music beds'], ['sfx', 'Sound effects']]) {
    const b = make('button', 'rp-pill', label); b.type = 'button'; b.dataset.soundTab = id;
    b.onclick = () => { filter = id; renderItems(); }; tabs.append(b);
  }
  wrap.append(status, tabs, list); layer.body.append(wrap);
  const opened = layers.open(layer);
  call('/sound-library').then(res => { catalog = res.items ?? []; status.textContent = 'CC0-1.0 licensed procedural audio. Preview or add to an audio track.'; renderItems(); }).catch(err => { status.textContent = describe(err); });
  return opened;
}

function buildAudioActionsNode(env) {
  const { layers, make, act } = env, box = make('div', 'ds-menu-list');
  const voiceBtn = make('button', 'ds-menu-row', 'Voice'); voiceBtn.type = 'button'; voiceBtn.dataset.audioVoice = '';
  const sfxBtn = make('button', 'ds-menu-row', 'Sound effects'); sfxBtn.type = 'button'; sfxBtn.dataset.audioSfx = '';
  voiceBtn.onclick = act(async () => { const top = layers.top(); if (top) await layers.close(top); await openVoiceSheet(env); });
  sfxBtn.onclick = act(async () => { const top = layers.top(); if (top) await layers.close(top); await openSoundLibrarySheet(env); });
  box.append(voiceBtn, sfxBtn);
  return box;
}

function buildExportProfileNode(env, exportMp4Button) {
  const { adapter, exporter, make, act } = env, rows = make('div', 'video-export-rows'), resGroup = make('div', 'rp-pill-group'), fpsGroup = make('div', 'rp-pill-group');
  const estimate = make('p', 'video-help', ''), working = make('div', 'video-export-row');
  working.dataset.exportSummaryRow = '';
  const summaryLabel = make('span', 'video-export-name', '');
  let chosen = optionsFromProfile(adapter.doc().profile);
  exporter.setOptions(chosen);
  const updateSummary = () => {
    const spec = resolveExportSpec({ variant: 'export', resolution: chosen.resolution, fps: chosen.fps, timelineFrames30: Math.max(30, timelineFrames(adapter.doc())) });
    summaryLabel.textContent = `${EXPORT_RESOLUTIONS[chosen.resolution].label} (${spec.width}×${spec.height}) · ${spec.fps} fps`;
    estimate.textContent = `Estimated output: ~${(spec.estimatedBytes / 1048576).toFixed(1)} MB · ~${spec.estimatedSeconds}s render`;
    for (const b of resGroup.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.exportRes === chosen.resolution));
    for (const b of fpsGroup.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.exportFps) === chosen.fps));
  };
  const choose = async patch => {
    chosen = { ...chosen, ...patch }; exporter.setOptions(chosen);
    const spec = resolveExportSpec({ variant: 'export', resolution: chosen.resolution, fps: chosen.fps, timelineFrames30: Math.max(30, timelineFrames(adapter.doc())) });
    updateSummary();
    if (adapter.editable() && adapter.doc().profile !== spec.profile) { adapter.apply(cur => validateTimeline({ ...cur, profile: spec.profile })); await adapter.save(); }
  };
  for (const res of Object.values(EXPORT_RESOLUTIONS)) {
    const b = make('button', 'rp-pill', res.label); b.type = 'button'; b.dataset.exportRes = res.id;
    b.onclick = act(() => choose({ resolution: res.id })); resGroup.append(b);
  }
  for (const fps of EXPORT_FPS_VALUES) {
    const b = make('button', 'rp-pill', `${fps} fps`); b.type = 'button'; b.dataset.exportFps = String(fps);
    b.onclick = act(() => choose({ fps })); fpsGroup.append(b);
  }
  updateSummary();
  working.append(summaryLabel, exportMp4Button); rows.append(resGroup, fpsGroup, estimate, working);
  return rows;
}

export function createRpSheets({ doc: domDoc, adapter, exporter, layers, make, act, setStatus }) {
  const patchClip = patch => adapter.apply(current => {
    const sel = adapter.selection();
    if (!sel) throw new Error('Select a clip on the timeline first.');
    return current.version === 2 ? applyMultitrack(current, { type: 'clip', id: sel.id, patch }) : timeline.patchSegment(current, sel.id, patch);
  });
  const env = { domDoc, adapter, exporter, layers, make, act, setStatus, patchClip };
  return {
    openSpeedSheet: () => openSpeedSheet(env),
    buildAutoCaptionsNode: () => buildAutoCaptionsNode(env),
    openStickersSheet: () => openStickersSheet(env),
    openLooksSheet: mode => openLooksSheet(env, mode),
    openChromaKeySheet: () => openChromaKeySheet(env),
    openRemoveBgSheet: () => openRemoveBgSheet(env),
    openStabilizeSheet: () => openStabilizeSheet(env),
    openVoiceSheet: () => openVoiceSheet(env),
    openSoundLibrarySheet: () => openSoundLibrarySheet(env),
    buildAudioActionsNode: () => buildAudioActionsNode(env),
    buildExportProfileNode: btn => buildExportProfileNode(env, btn),
  };
}
