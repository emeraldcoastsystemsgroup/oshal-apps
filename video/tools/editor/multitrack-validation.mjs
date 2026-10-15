/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Validate private version 2 multitrack documents with integer timing, bounded effects/keyframes and explicit linked audio/video pairs.
 */
import { demand, exactObject, integer, plainText, PROFILE, LIMITS, validateTimelineSources } from './timeline-validation.mjs';
const ID = /^[a-z][a-z0-9-]{0,31}$/;
const ranges = { x: [-100, 100], y: [-100, 100], scale: [10, 200], opacity: [0, 100], volume: [0, 200] };
function id(value) { demand(typeof value === 'string' && ID.test(value), 'Invalid track or clip identity'); return value; }
function bool(value, fallback, label) { if (value === undefined) return fallback; demand(typeof value === 'boolean', `${label} must be true or false`); return value; }

function keyframes(value = [], duration) {
  demand(Array.isArray(value) && value.length <= 64, 'A clip supports at most 64 keyframes');
  const used = new Set();
  return value.map(entry => {
    exactObject(entry, ['frame', 'property', 'value', 'interpolation'], 'Keyframe');
    demand(Object.hasOwn(ranges, entry.property), 'Unsupported animated property');
    const frame = integer(entry.frame, 0, duration - 1, 'Keyframe frame'), stamp = `${entry.property}:${frame}`;
    demand(!used.has(stamp), 'A property has only one keyframe per frame'); used.add(stamp);
    const interpolation = entry.interpolation ?? 'linear'; demand(['linear', 'hold'].includes(interpolation), 'Unsupported interpolation');
    return { frame, property: entry.property, value: integer(entry.value, ...ranges[entry.property], 'Keyframe value'), interpolation };
  }).sort((a, b) => a.property.localeCompare(b.property) || a.frame - b.frame);
}

function clip(value, source, kind) {
  exactObject(value, ['id', 'source', 'in', 'out', 'start', 'volume', 'x', 'y', 'scale', 'opacity', 'keys', 'transition', 'fadeIn', 'fadeOut', 'brightness', 'contrast', 'saturation', 'audioEnabled', 'link'], 'Track clip');
  demand(source && (kind === 'video' ? source.kind === 'video' : source.kind === 'audio' || source.audio === true), 'Clip source is incompatible with this track');
  const start = integer(value.start, 0, LIMITS.totalFrames - 1, 'Timeline start');
  const first = integer(value.in, 0, source.frames - 1, 'Source in'), last = integer(value.out, first + 1, source.frames, 'Source out'), duration = last - first;
  demand(start + duration <= LIMITS.totalFrames, 'Clip exceeds the 60-second timeline');
  const fadeIn = integer(value.fadeIn ?? 0, 0, duration, 'Fade in'), fadeOut = integer(value.fadeOut ?? 0, 0, duration, 'Fade out');
  demand(fadeIn + fadeOut <= duration, 'Clip fades may not overlap');
  const transition = value.transition ?? 'dissolve'; demand(['dissolve', 'black'].includes(transition), 'Unsupported transition');
  return { id: id(value.id), source: value.source, in: first, out: last, start, volume: integer(value.volume ?? 100, 0, 200, 'Clip volume'),
    x: integer(value.x ?? 0, -100, 100, 'Clip X'), y: integer(value.y ?? 0, -100, 100, 'Clip Y'), scale: integer(value.scale ?? 100, 10, 200, 'Clip scale'),
    opacity: integer(value.opacity ?? 100, 0, 100, 'Clip opacity'), keys: keyframes(value.keys, duration), transition, fadeIn, fadeOut,
    brightness: integer(value.brightness ?? 0, -100, 100, 'Brightness'), contrast: integer(value.contrast ?? 100, 0, 300, 'Contrast'), saturation: integer(value.saturation ?? 100, 0, 300, 'Saturation'),
    audioEnabled: bool(value.audioEnabled, true, 'Clip audio'), ...(value.link == null ? {} : { link: id(value.link) }) };
}

function textTrack(value, total, maximum) {
  demand(Array.isArray(value) && value.length <= maximum, 'Too many timed text entries'); const ids = new Set();
  return value.map(entry => {
    exactObject(entry, ['id', 'text', 'start', 'end', 'position', 'size'], 'Timed text');
    const key = id(entry.id); demand(!ids.has(key), 'Timed text IDs must be unique'); ids.add(key);
    const start = integer(entry.start, 0, Math.max(0, total - 1), 'Text start'), end = integer(entry.end, start + 1, total, 'Text end');
    demand(['top', 'center', 'bottom'].includes(entry.position) && ['small', 'medium', 'large'].includes(entry.size), 'Unsupported text style');
    return { id: key, text: plainText(entry.text, 240, 'Text'), start, end, position: entry.position, size: entry.size };
  }).sort((a, b) => a.start - b.start);
}

function validateLinks(tracks) {
  const groups = new Map();
  for (const track of tracks) for (const clip of track.clips) if (clip.link) {
    const linked = groups.get(clip.link) ?? []; linked.push({ clip, track }); groups.set(clip.link, linked);
  }
  for (const pair of groups.values()) {
    demand(pair.length === 2 && pair[0].track.kind !== pair[1].track.kind, 'A link joins exactly one video and one audio clip');
    const [a, b] = pair.map(item => item.clip); demand(['source', 'in', 'out', 'start'].every(key => a[key] === b[key]), 'Linked clips must share source timing');
    demand(pair.find(item => item.track.kind === 'video').clip.audioEnabled === false, 'Linked audio must not be mixed twice');
  }
}

/** @description Normalize the whole v2 timeline; v1 documents are migrated only by an explicit operation.
 * @param {object} value Candidate v2 project.
 * @returns {object} Independent validated document. */
export function validateMultitrack(value) {
  exactObject(value, ['version', 'name', 'profile', 'sources', 'segments', 'titles', 'audioBed', 'tracks', 'captions'], 'Multitrack project');
  demand(value.version === 2 && value.profile === PROFILE.id, 'Unsupported multitrack profile');
  demand(Array.isArray(value.segments) && !value.segments.length && value.audioBed === null, 'V2 uses tracks instead of sequential segments or a bed');
  const sources = validateTimelineSources(value.sources, { ...LIMITS, videoSources: 8, audioSources: 8 });
  demand(Array.isArray(value.tracks) && value.tracks.length <= 12, 'Use at most four video and eight audio tracks');
  const ids = new Set(), clips = new Set(), counts = { video: 0, audio: 0 }; let total = 0;
  const tracks = value.tracks.map(entry => {
    exactObject(entry, ['id', 'name', 'kind', 'muted', 'locked', 'clips'], 'Track');
    demand(['video', 'audio'].includes(entry.kind), 'Unsupported track kind'); const key = id(entry.id);
    demand(!ids.has(key), 'Track IDs must be unique'); ids.add(key); counts[entry.kind]++;
    demand(Array.isArray(entry.clips) && entry.clips.length <= 32, 'Too many clips');
    const own = entry.clips.map(value => {
      demand(typeof value.source === 'string' && Object.hasOwn(sources, value.source), 'Clip source is missing');
      const normalized = clip(value, sources[value.source], entry.kind);
      demand(!clips.has(normalized.id), 'Clip IDs must be unique'); clips.add(normalized.id); total = Math.max(total, normalized.start + normalized.out - normalized.in); return normalized;
    }).sort((a, b) => a.start - b.start);
    return { id: key, name: plainText(entry.name, 120, 'Track name'), kind: entry.kind,
      muted: bool(entry.muted, false, 'Track mute'), locked: bool(entry.locked, false, 'Track lock'), clips: own };
  });
  demand(counts.video <= 4 && counts.audio <= 8 && clips.size <= 32, 'Track or clip budget exceeded'); validateLinks(tracks);
  const result = { version: 2, name: plainText(value.name, LIMITS.name, 'Project name'), profile: PROFILE.id, sources,
    segments: [], titles: textTrack(value.titles, total, 20), audioBed: null, tracks, captions: textTrack(value.captions ?? [], total, 50) };
  demand(new TextEncoder().encode(JSON.stringify(result)).length <= LIMITS.documentBytes, 'Project is too large'); return result;
}
