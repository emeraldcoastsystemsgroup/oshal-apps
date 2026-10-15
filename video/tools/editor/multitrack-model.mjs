/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Keep v2 clips, linked A/V, trims, splits, ripple edits and effect/keyframe changes immutable under the existing history/store contract.
 */
import { validateTimeline, timelineFrames, demand } from './timeline-validation.mjs';
const uid = prefix => prefix + crypto.randomUUID().replaceAll('-', '').slice(0, 32 - prefix.length);
const track = (document, id) => { const value = document.tracks.find(track => track.id === id); demand(value, 'Track does not exist'); return value; };
const editable = value => demand(!value.locked, 'Unlock the track before editing it');
function found(document, id) {
  for (const own of document.tracks) { const clip = own.clips.find(clip => clip.id === id); if (clip) return { track: own, clip }; }
  throw new TypeError('Clip does not exist');
}
function partner(document, clip) { return clip.link ? document.tracks.flatMap(track => track.clips.map(clip => ({ track, clip }))).find(item => item.clip.link === clip.link && item.clip.id !== clip.id) : null; }

/** @description Explicitly migrate a v1 sequential edit without changing clip timing or audio-bed duration.
 * @param {object} value Existing normalized document.
 * @returns {object} V2 tracks; original input remains unchanged. */
export function migrateMultitrack(value) {
  const document = validateTimeline(value); if (document.version === 2) return document;
  let start = 0;
  const clips = document.segments.map(segment => { const clip = { ...segment, start }; start += segment.out - segment.in; return clip; });
  const music = document.audioBed && start ? [{ id: 'bed1', source: document.audioBed.source, in: 0,
    out: Math.min(start, document.sources[document.audioBed.source].frames), start: 0, volume: document.audioBed.volume }] : [];
  return validateTimeline({ ...document, version: 2, segments: [], audioBed: null, captions: [], tracks: [
    { id: 'video1', name: 'Video 1', kind: 'video', muted: false, locked: false, clips },
    { id: 'audio1', name: 'Audio 1', kind: 'audio', muted: false, locked: false, clips: music } ] });
}

/** @description Evaluate a clip-local linear/hold keyframe at an integer frame.
 * @param {object} clip Normalized clip.
 * @param {string} property Animated property.
 * @param {number} frame Clip-local frame.
 * @returns {number} Property value. */
export function valueAt(clip, property, frame) {
  const keys = clip.keys.filter(key => key.property === property);
  if (!keys.length || frame < keys[0].frame) return clip[property];
  let before = keys[0], after;
  for (const key of keys) { if (key.frame <= frame) before = key; else { after = key; break; } }
  return !after || before.interpolation === 'hold' ? before.value : before.value + (after.value - before.value) * (frame - before.frame) / (after.frame - before.frame);
}

function splitPart(clip, offset, right, id) {
  const result = { ...clip, id, in: right ? clip.in + offset : clip.in, out: right ? clip.out : clip.in + offset,
    start: right ? clip.start + offset : clip.start, fadeIn: right ? 0 : clip.fadeIn, fadeOut: right ? clip.fadeOut : 0,
    keys: clip.keys.filter(key => right ? key.frame >= offset : key.frame < offset).map(key => ({ ...key, frame: right ? key.frame - offset : key.frame })) };
  for (const property of new Set(clip.keys.map(key => key.property))) {
    const frame = right ? 0 : offset - 1, original = right ? offset : offset - 1;
    if (right) result[property] = Math.round(valueAt(clip, property, offset));
    if (!result.keys.some(key => key.property === property && key.frame === frame)) {
      const previous = clip.keys.filter(key => key.property === property && key.frame <= original).at(-1);
      result.keys.push({ property, frame, value: Math.round(valueAt(clip, property, original)), interpolation: previous?.interpolation ?? 'hold' });
    }
  }
  return result;
}

function editClip(document, operation) {
  const own = found(document, operation.id); editable(own.track);
  const allowed = ['in', 'out', 'start', 'volume', 'x', 'y', 'scale', 'opacity', 'keys', 'transition', 'fadeIn', 'fadeOut', 'brightness', 'contrast', 'saturation', 'audioEnabled'];
  demand(operation.patch && Object.keys(operation.patch).every(key => allowed.includes(key)), 'Unsupported clip change');
  const linked = partner(document, own.clip);
  if (linked && ['in', 'out', 'start'].some(key => Object.hasOwn(operation.patch, key))) {
    editable(linked.track); for (const key of ['in', 'out', 'start']) if (Object.hasOwn(operation.patch, key)) linked.clip[key] = operation.patch[key];
  }
  Object.assign(own.clip, operation.patch);
}

function removeClip(document, operation) {
  const own = found(document, operation.id); editable(own.track); const linked = partner(document, own.clip); if (linked) editable(linked.track);
  const ids = new Set([own.clip.id, ...(linked ? [linked.clip.id] : [])]), end = own.clip.start + own.clip.out - own.clip.in, duration = own.clip.out - own.clip.in;
  if (operation.ripple) for (const track of document.tracks) for (const clip of track.clips) {
    if (ids.has(clip.id)) continue;
    if (clip.start < end && clip.start + clip.out - clip.in > own.clip.start) throw new TypeError('Split other clips crossing the ripple range first.');
    if (clip.start >= end) { editable(track); clip.start -= duration; }
  }
  for (const track of document.tracks) track.clips = track.clips.filter(clip => !ids.has(clip.id));
  if (operation.ripple) for (const list of [document.titles, document.captions]) for (const title of list) {
    if (title.start >= end) { title.start -= duration; title.end -= duration; }
    else if (title.end > own.clip.start) title.end = Math.max(title.start, own.clip.start);
  }
  const total = timelineFrames(document);
  for (const key of ['titles', 'captions']) document[key] = document[key].map(title => ({ ...title, end: Math.min(title.end, total) })).filter(title => title.start < title.end);
}

function splitClip(document, operation) {
  const own = found(document, operation.id), linked = partner(document, own.clip); editable(own.track); if (linked) editable(linked.track);
  const offset = operation.frame - own.clip.start;
  demand(Number.isSafeInteger(offset) && offset > 0 && offset < own.clip.out - own.clip.in, 'Split inside the clip');
  for (const item of [own, ...(linked ? [linked] : [])]) demand(offset >= item.clip.fadeIn && offset <= item.clip.out - item.clip.in - item.clip.fadeOut, 'Split outside fade ranges or remove the fades first');
  const nextLink = linked ? uid('link') : undefined;
  for (const item of [own, ...(linked ? [linked] : [])]) {
    const index = item.track.clips.indexOf(item.clip), left = splitPart(item.clip, offset, false, item.clip.id), right = splitPart(item.clip, offset, true, uid('clip'));
    if (nextLink) right.link = nextLink; item.track.clips.splice(index, 1, left, right);
  }
}

function extractAudio(document, operation) {
  const own = found(document, operation.id), target = track(document, operation.track); editable(own.track); editable(target);
  demand(own.track.kind === 'video' && target.kind === 'audio' && document.sources[own.clip.source].audio && !own.clip.link, 'Choose unlinked video with sound and an audio track');
  const link = uid('link'); own.clip.link = link; own.clip.audioEnabled = false;
  target.clips.push({ ...own.clip, id: uid('clip'), audioEnabled: true, opacity: 100, scale: 100, x: 0, y: 0,
    keys: own.clip.keys.filter(key => key.property === 'volume'), link });
}

/** @description Apply one immutable v2 edit and validate the whole result before returning it.
 * @param {object} value V2 document.
 * @param {object} operation Track/clip/text operation.
 * @returns {object} Independent normalized document. */
export function applyMultitrack(value, operation) {
  const document = validateTimeline(value); demand(document.version === 2, 'Upgrade to multitrack first');
  if (operation.type === 'addTrack') document.tracks.push({ id: uid('track'), name: operation.name, kind: operation.kind, clips: [], muted: false, locked: false });
  else if (operation.type === 'track') {
    const own = track(document, operation.id); demand(operation.patch && Object.keys(operation.patch).every(key => ['name', 'muted', 'locked'].includes(key)), 'Unsupported track change'); Object.assign(own, operation.patch);
  } else if (operation.type === 'addClip') {
    const own = track(document, operation.track); editable(own);
    const source = document.sources[operation.source]; demand(source, 'Choose an uploaded source');
    const start = operation.start ?? 0; own.clips.push({ id: uid('clip'), source: operation.source, in: operation.in ?? 0,
      out: operation.out ?? Math.min(source.frames, 1800 - start), start, volume: source.kind === 'audio' ? 40 : 100 });
  } else if (operation.type === 'clip') editClip(document, operation);
  else if (operation.type === 'moveClip') {
    const own = found(document, operation.id), target = track(document, operation.track); editable(own.track); editable(target);
    demand(own.track.kind === target.kind, 'Move between tracks of the same kind');
    if (operation.start !== undefined) editClip(document, { id: own.clip.id, patch: { start: operation.start } });
    own.track.clips = own.track.clips.filter(clip => clip.id !== own.clip.id); target.clips.push(own.clip);
  } else if (operation.type === 'removeClip') removeClip(document, operation);
  else if (operation.type === 'split') splitClip(document, operation);
  else if (operation.type === 'extractAudio') extractAudio(document, operation);
  else if (operation.type === 'unlink') { const own = found(document, operation.id), linked = partner(document, own.clip); editable(own.track); if (linked) { editable(linked.track); delete linked.clip.link; } delete own.clip.link; }
  else if (operation.type === 'text') { demand(['titles', 'captions'].includes(operation.track), 'Choose titles or captions'); document[operation.track].push({ ...operation.entry, id: uid('text') }); }
  else if (operation.type === 'removeText') { demand(['titles', 'captions'].includes(operation.track), 'Choose titles or captions'); document[operation.track] = document[operation.track].filter(entry => entry.id !== operation.id); }
  else throw new TypeError('Unsupported multitrack edit');
  return validateTimeline(document);
}
