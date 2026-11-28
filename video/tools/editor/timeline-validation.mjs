/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The manual video timeline's one document contract, shared by the browser editor and the server: the EDITOR-PLAN first-slice bounds (two clips of at most 30 s, one WAV bed, 20 segments, 60 s total, one title track, one 1280x720/30 fps H.264/AAC profile), integer frame positions in the 30 fps project time base, and refusal of unknown fields, unsafe keys, paths, URLs and control text.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Extend the existing private timeline/store/export contract with bounded v2 tracks, linked clips, color/fades/keyframes and timed captions.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Add backward-compatible per-clip speed, color looks, stabilization, chroma key, background matting, captions and keyframed stickers without external helper dependencies.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Support optional project aspectRatio (16:9, 9:16, 1:1; defaults to 16:9) and canonical even-pixel dimensions across preview, 720p, 1080p and 4K.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Keep shared title sizing in the existing helper admitted by the fixed native renderer.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Preserve complete Unicode title endings with invisible padding for renderers that confuse character and UTF-8 byte lengths.
 */

import { validateMotionSource } from './motion-source.mjs';
import { validateMultitrack } from './multitrack-validation.mjs';

export const PROFILE = Object.freeze({ id: 'hd720p30', width: 1280, height: 720, fps: 30, sampleRate: 48000,
  samplesPerFrame: 1600, videoCodec: 'h264', audioCodec: 'aac' });
export const EXPORT_PROFILES = Object.freeze(['hd720p30', 'hd720p60', 'hd1080p30', 'hd1080p60', 'uhd4k30', 'uhd4k60']);
export const ASPECT_RATIOS = Object.freeze(['16:9', '9:16', '1:1']);
export const DEFAULT_ASPECT_RATIO = '16:9';
export const ASPECT_DIMENSIONS = Object.freeze({
  preview: Object.freeze({ '16:9': Object.freeze({ width: 640, height: 360 }), '9:16': Object.freeze({ width: 360, height: 640 }), '1:1': Object.freeze({ width: 360, height: 360 }) }),
  '720p': Object.freeze({ '16:9': Object.freeze({ width: 1280, height: 720 }), '9:16': Object.freeze({ width: 720, height: 1280 }), '1:1': Object.freeze({ width: 720, height: 720 }) }),
  '1080p': Object.freeze({ '16:9': Object.freeze({ width: 1920, height: 1080 }), '9:16': Object.freeze({ width: 1080, height: 1920 }), '1:1': Object.freeze({ width: 1080, height: 1080 }) }),
  '4k': Object.freeze({ '16:9': Object.freeze({ width: 3840, height: 2160 }), '9:16': Object.freeze({ width: 2160, height: 3840 }), '1:1': Object.freeze({ width: 2160, height: 2160 }) }),
});

export const LIMITS = Object.freeze({ videoSources: 2, audioSources: 1, sourceFrames: 900, bedFrames: 1800,
  segments: 20, totalFrames: 1800, titles: 10, titleText: 120, sourceName: 120, name: 160,
  segmentVolume: 200, bedVolume: 100, sourceDimension: 1920, documentBytes: 262144 });

export const TITLE_POSITIONS = Object.freeze(['top', 'center', 'bottom']);
export const TITLE_SIZES = Object.freeze(['small', 'medium', 'large']);
const LOOK_IDS = new Set(['none', 'warm', 'cool', 'vivid', 'noir', 'vintage', 'cinema']);
const STABILIZE_IDS = new Set(['off', 'light', 'standard', 'strong']);
const STICKER_IDS = new Set(['star', 'heart', 'sparkle', 'fire', 'check', 'arrow', 'speech', 'clap']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SOURCE_KEY = /^[a-z][a-z0-9]{0,15}$/;
const ITEM_ID = /^[a-z][a-z0-9-]{0,31}$/;
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);

export function demand(condition, message) { if (!condition) throw new TypeError(message); }

export function exactObject(value, allowed, label) {
  demand(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  demand([Object.prototype, null].includes(Object.getPrototypeOf(value)), `${label} must be a plain object`);
  for (const key of Object.keys(value)) demand(allowed.includes(key), `${label} has an unsupported field`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) demand('value' in descriptor, `${label} must be plain data`);
}

export function integer(value, min, max, label) {
  demand(Number.isSafeInteger(value) && value >= min && value <= max, `${label} must be a whole number from ${min} to ${max}`);
  return value;
}

export function plainText(value, max, label) {
  demand(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `${label} must be 1 to ${max} characters`);
  demand(!UNSAFE_TEXT.test(value), `${label} contains control characters`);
  return value;
}

function choice(value, options, label) { demand(options.includes(value), `${label} is not supported`); return value; }
function key(value, pattern, label) {
  demand(typeof value === 'string' && pattern.test(value) && !RESERVED.has(value), `${label} is not a valid identifier`);
  return value;
}

export function assetId(value) {
  demand(typeof value === 'string' && UUID.test(value), 'Media must be referenced by its uploaded identity');
  return value;
}

/** @description Effective timeline duration in 30fps frames for a source [inFrame, outFrame) range at integer percent speed. */
export function clipDurationFrames(inFrame, outFrame, speed = 100) {
  const raw = outFrame - inFrame;
  if (raw <= 0) return 0;
  return speed === 100 ? raw : Math.max(1, Math.round((raw * 100) / speed));
}

export function validateSpeed(value) {
  return value === undefined ? 100 : integer(value, 25, 400, 'Clip speed');
}

export function validateLook(value) {
  if (value === undefined || value === null) return undefined;
  exactObject(value, ['id', 'strength'], 'Clip look');
  demand(typeof value.id === 'string' && LOOK_IDS.has(value.id), 'Unsupported look');
  const strength = integer(value.strength, 0, 100, 'Look strength');
  return value.id === 'none' || strength === 0 ? undefined : { id: value.id, strength };
}

export function validateStabilize(value) {
  if (value === undefined || value === 'off') return undefined;
  demand(typeof value === 'string' && STABILIZE_IDS.has(value), 'Unsupported stabilization strength');
  return value;
}

export function validateChromaKey(value) {
  if (value === undefined || value === null) return undefined;
  exactObject(value, ['enabled', 'color', 'similarity', 'blend'], 'Chroma key');
  demand(typeof value.enabled === 'boolean' && typeof value.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.color), 'Invalid chroma key color');
  const similarity = integer(value.similarity, 1, 100, 'Chroma key similarity');
  const blend = integer(value.blend, 0, 100, 'Chroma key blend');
  return value.enabled ? { enabled: true, color: value.color.toLowerCase(), similarity, blend } : undefined;
}

export function validateRemoveBg(value) {
  if (value === undefined || value === null) return undefined;
  exactObject(value, ['enabled', 'strength'], 'Remove background');
  demand(typeof value.enabled === 'boolean', 'Invalid remove background toggle');
  const strength = integer(value.strength, 1, 100, 'Remove background strength');
  return value.enabled ? { enabled: true, strength } : undefined;
}

export function validateStickers(value, total) {
  if (value === undefined) return undefined;
  demand(Array.isArray(value) && value.length <= 16, 'At most 16 stickers are supported');
  if (value.length > 0) demand(total > 0, 'Add a clip before placing stickers');
  const ids = new Set();
  return value.map((item, idx) => {
    const label = `Sticker ${idx + 1}`;
    exactObject(item, ['id', 'stickerId', 'start', 'end', 'x', 'y', 'scale', 'keys'], label);
    const id = key(item.id, ITEM_ID, `${label} ID`);
    demand(!ids.has(id), 'Sticker IDs must be unique'); ids.add(id);
    demand(typeof item.stickerId === 'string' && STICKER_IDS.has(item.stickerId), 'Unknown sticker');
    const start = integer(item.start, 0, total - 1, `${label} start`), end = integer(item.end, start + 1, total, `${label} end`);
    const x = integer(item.x, 0, 100, `${label} X`), y = integer(item.y, 0, 100, `${label} Y`), scale = integer(item.scale, 25, 300, `${label} scale`);
    let keys;
    if (item.keys !== undefined) {
      demand(Array.isArray(item.keys) && item.keys.length <= 8, 'At most 8 sticker keyframes');
      let prev = -1;
      keys = item.keys.map(k => {
        exactObject(k, ['frame', 'x', 'y', 'scale'], 'Sticker keyframe');
        const frame = integer(k.frame, prev + 1, end - start, 'Sticker keyframe frame');
        prev = frame;
        return { frame, x: integer(k.x, 0, 100, 'Sticker key X'), y: integer(k.y, 0, 100, 'Sticker key Y'), scale: integer(k.scale, 25, 300, 'Sticker key scale') };
      });
    }
    return { id, stickerId: item.stickerId, start, end, x, y, scale, ...(keys?.length ? { keys } : {}) };
  });
}

function validateSource(value, label) {
  demand(value && typeof value === 'object' && (value.kind === 'video' || value.kind === 'audio'), `${label} must be a video clip or an audio bed`);
  const video = value.kind === 'video';
  exactObject(value, video ? ['kind', 'asset', 'name', 'frames', 'width', 'height', 'audio', 'motion'] : ['kind', 'asset', 'name', 'frames'], label);
  const source = { kind: value.kind, asset: assetId(value.asset), name: plainText(value.name, LIMITS.sourceName, `${label} name`),
    frames: integer(value.frames, 1, video ? LIMITS.sourceFrames : LIMITS.bedFrames, `${label} length in frames`) };
  if (!video) return source;
  demand(typeof value.audio === 'boolean', `${label} must say whether it carries sound`);
  return { ...source, width: integer(value.width, 2, LIMITS.sourceDimension, `${label} width`),
    height: integer(value.height, 2, LIMITS.sourceDimension, `${label} height`), audio: value.audio,
    ...(value.motion === undefined ? {} : { motion: validateMotionSource(value.motion) }) };
}

export function validateTimelineSources(value, limits = LIMITS) {
  exactObject(value, Object.keys(value ?? {}), 'Sources');
  const sources = Object.create(null), counts = { video: 0, audio: 0 };
  for (const [name, entry] of Object.entries(value)) {
    key(name, SOURCE_KEY, 'Source key');
    sources[name] = validateSource(entry, `Source ${name}`);
    counts[sources[name].kind] += 1;
  }
  demand(counts.video <= limits.videoSources, `A project holds at most ${limits.videoSources} video clips`);
  demand(counts.audio <= limits.audioSources, `A project holds at most ${limits.audioSources} audio bed`);
  const assets = Object.values(sources).map(source => source.asset);
  demand(new Set(assets).size === assets.length, 'Each uploaded file is added once');
  return sources;
}

function validateSegments(value, sources) {
  demand(Array.isArray(value) && value.length <= LIMITS.segments, `The timeline holds at most ${LIMITS.segments} segments`);
  const ids = new Set();
  let total = 0;
  const segments = value.map((entry, index) => {
    const label = `Segment ${index + 1}`;
    exactObject(entry, ['id', 'source', 'in', 'out', 'volume', 'speed', 'look', 'stabilize', 'chromaKey', 'removeBg'], label);
    const id = key(entry.id, ITEM_ID, `${label} ID`);
    demand(!ids.has(id), 'Segment IDs must be unique'); ids.add(id);
    const source = sources[key(entry.source, SOURCE_KEY, `${label} source`)];
    demand(source?.kind === 'video', `${label} must use a video clip in this project`);
    const start = integer(entry.in, 0, source.frames - 1, `${label} start`), end = integer(entry.out, start + 1, source.frames, `${label} end`);
    const speed = validateSpeed(entry.speed), look = validateLook(entry.look), stabilize = validateStabilize(entry.stabilize);
    const chromaKey = validateChromaKey(entry.chromaKey), removeBg = validateRemoveBg(entry.removeBg);
    total += clipDurationFrames(start, end, speed);
    return {
      id, source: entry.source, in: start, out: end, volume: integer(entry.volume, 0, LIMITS.segmentVolume, `${label} volume`),
      ...(speed !== 100 ? { speed } : {}), ...(look ? { look } : {}), ...(stabilize ? { stabilize } : {}),
      ...(chromaKey ? { chromaKey } : {}), ...(removeBg ? { removeBg } : {}),
    };
  });
  demand(total <= LIMITS.totalFrames, `The timeline is at most ${LIMITS.totalFrames / PROFILE.fps} seconds`);
  return { segments, total };
}

function validateTitles(value, total) {
  demand(Array.isArray(value) && value.length <= LIMITS.titles, `The title track holds at most ${LIMITS.titles} titles`);
  const ids = new Set();
  let previousEnd = 0;
  return value.map((entry, index) => {
    const label = `Title ${index + 1}`;
    exactObject(entry, ['id', 'text', 'start', 'end', 'position', 'size'], label);
    const id = key(entry.id, ITEM_ID, `${label} ID`);
    demand(!ids.has(id), 'Title IDs must be unique'); ids.add(id);
    const start = integer(entry.start, previousEnd, Math.max(previousEnd, total - 1), `${label} start`);
    demand(start < total, `${label} starts after the timeline ends`);
    const end = integer(entry.end, start + 1, total, `${label} end`);
    previousEnd = end;
    return { id, text: plainText(entry.text, LIMITS.titleText, `${label} text`), start, end,
      position: choice(entry.position, TITLE_POSITIONS, `${label} position`), size: choice(entry.size, TITLE_SIZES, `${label} size`) };
  });
}

function validateCaptions(value, total) {
  if (value === undefined) return undefined;
  demand(Array.isArray(value) && value.length <= 50, 'The captions track holds at most 50 cues');
  const ids = new Set();
  return value.map((entry, index) => {
    const label = `Caption ${index + 1}`;
    exactObject(entry, ['id', 'text', 'start', 'end', 'position', 'size'], label);
    const id = key(entry.id, ITEM_ID, `${label} ID`);
    demand(!ids.has(id), 'Caption IDs must be unique'); ids.add(id);
    demand(total > 0, `${label} starts after the timeline ends`);
    const start = integer(entry.start, 0, total - 1, `${label} start`), end = integer(entry.end, start + 1, total, `${label} end`);
    return { id, text: plainText(entry.text, 240, `${label} text`), start, end,
      position: choice(entry.position, TITLE_POSITIONS, `${label} position`), size: choice(entry.size, TITLE_SIZES, `${label} size`) };
  }).sort((a, b) => a.start - b.start);
}

function validateBed(value, sources) {
  if (value === null) return null;
  exactObject(value, ['source', 'volume'], 'Audio bed');
  demand(sources[key(value.source, SOURCE_KEY, 'Audio bed source')]?.kind === 'audio', 'The audio bed must use an audio file in this project');
  return { source: value.source, volume: integer(value.volume, 0, LIMITS.bedVolume, 'Audio bed volume') };
}

export function validateAspectRatio(value) {
  if (value === undefined) return undefined;
  demand(typeof value === 'string' && ASPECT_RATIOS.includes(value), 'Project aspectRatio must be 16:9, 9:16, or 1:1');
  return value;
}

export function resolveAspectRatio(document) {
  return document?.aspectRatio ?? DEFAULT_ASPECT_RATIO;
}

export function aspectDimensions(resolution, aspectRatio = DEFAULT_ASPECT_RATIO) {
  const ratio = validateAspectRatio(aspectRatio) ?? DEFAULT_ASPECT_RATIO;
  const row = ASPECT_DIMENSIONS[resolution];
  demand(Boolean(row), 'This output resolution is not supported');
  return row[ratio];
}

export function validateTimeline(value) {
  if (value?.version === 2) return validateMultitrack(value);
  exactObject(value, ['version', 'name', 'profile', 'aspectRatio', 'sources', 'segments', 'titles', 'audioBed', 'captions', 'stickers'], 'Project');
  demand(value.version === 1, 'This project version is not supported');
  demand(EXPORT_PROFILES.includes(value.profile), 'This output profile is not supported');
  const aspectRatio = validateAspectRatio(value.aspectRatio);
  const sources = validateTimelineSources(value.sources);
  const { segments, total } = validateSegments(value.segments, sources);
  const captions = validateCaptions(value.captions, total), stickers = validateStickers(value.stickers, total);
  const document = {
    version: 1, name: plainText(value.name, LIMITS.name, 'Project name'), profile: value.profile,
    ...(aspectRatio ? { aspectRatio } : {}),
    sources: { ...sources }, segments, titles: validateTitles(value.titles, total), audioBed: validateBed(value.audioBed, sources),
    ...(captions?.length ? { captions } : {}), ...(stickers?.length ? { stickers } : {}),
  };
  demand(new TextEncoder().encode(JSON.stringify(document)).length <= LIMITS.documentBytes, 'This project is too large');
  return document;
}

export function timelineFrames(document) {
  if (document.version === 2) return Math.max(0, ...document.tracks.flatMap(track => track.clips.map(clip => clip.start + clipDurationFrames(clip.in, clip.out, clip.speed ?? 100))));
  return document.segments.reduce((sum, segment) => sum + clipDurationFrames(segment.in, segment.out, segment.speed ?? 100), 0);
}

export function timelineAssets(document) {
  return Object.entries(document.sources).map(([name, source]) => ({ key: name, asset: source.asset, kind: source.kind }));
}

const DIVISORS = Object.freeze({small:24, medium:16, large:10});
// Unkerned DejaVu Sans Bold advance widths at 2048 units/em, printable ASCII.
// A four-percent allowance and conservative fallback also cover substituted glyphs.
const ADVANCES = [713,934,1067,1716,1425,2052,1786,627,936,936,1071,1716,778,850,778,748,
  1425,1425,1425,1425,1425,1425,1425,1425,1425,1425,819,819,1716,1716,1716,1188,2048,
  1585,1561,1503,1700,1399,1399,1681,1714,762,762,1587,1305,2038,1714,1741,1501,1741,
  1577,1475,1397,1663,1585,2259,1579,1483,1485,936,748,936,1716,1024,1024,1382,1466,
  1214,1466,1389,891,1466,1458,702,702,1362,702,2134,1458,1407,1466,1466,1010,1219,
  979,1458,1335,1892,1321,1335,1192,1458,748,1458,1716];
const PUNCTUATION = {'–':1024,'—':2048,'…':2048,'’':778,'‘':778,'“':1346,'”':1346};

/** @description Fit a single-line title within a five-percent horizontal safe area at any canvas size.
 * @param {string} text Plain title. @param {'small'|'medium'|'large'} size Requested size.
 * @param {number} width Canvas pixels. @param {number} height Canvas pixels.
 * @returns {number} Pixel font size, or zero for invalid layout inputs.
 */
export function titleFontSize(text, size, width, height) {
  if (typeof text !== 'string' || !Object.hasOwn(DIVISORS,size) || ![width,height].every(value => Number.isFinite(value) && value > 0)) return 0;
  const scale = Math.min(width,height) / 720;
  const advance = [...text].reduce((sum,char) => {
    const code = char.codePointAt(0);
    return sum + (code >= 32 && code <= 126 ? ADVANCES[code-32] : PUNCTUATION[char] ?? 4096);
  },0) / 2048;
  const fitted = Math.floor((width / scale * 0.9) / Math.max(1,advance * 1.04));
  return Math.max(1,Math.round(Math.min(720 / DIVISORS[size],Math.max(1,fitted)) * scale));
}

/** @description Keep the saved title intact and pad only the encoder file with zero-width spaces.
 * FFmpeg 6.1.1 passes a character count as a UTF-8 byte limit, dropping the ending after non-ASCII text.
 * One zero-width character per excess byte lets that limit include the complete original string.
 * @param {string} text Validated single-line title. @returns {string} Encoder-only title text.
 */
export function renderTitleText(text) {
  return text + '\u200b'.repeat(new TextEncoder().encode(text).length - [...text].length);
}
