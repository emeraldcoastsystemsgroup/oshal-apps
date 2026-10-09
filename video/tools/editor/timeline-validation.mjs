/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The manual video timeline's one document contract, shared by the browser editor and the server: the EDITOR-PLAN first-slice bounds (two clips of at most 30 s, one WAV bed, 20 segments, 60 s total, one title track, one 1280x720/30 fps H.264/AAC profile), integer frame positions in the 30 fps project time base, and refusal of unknown fields, unsafe keys, paths, URLs and control text.
 */

/** @description The one output profile of the first slice. Frames are counted at `fps`; one frame is
 *  exactly `sampleRate / fps` audio samples, so every audio boundary is an integer sample too.
 * @returns {object} Immutable profile. */
export const PROFILE = Object.freeze({ id: 'hd720p30', width: 1280, height: 720, fps: 30, sampleRate: 48000,
  samplesPerFrame: 1600, videoCodec: 'h264', audioCodec: 'aac' });

/** @description The first-slice ceilings from video/EDITOR-PLAN.md "Preferred first delivery".
 * @returns {object} Immutable numeric limits. */
export const LIMITS = Object.freeze({ videoSources: 2, audioSources: 1, sourceFrames: 900, bedFrames: 1800,
  segments: 20, totalFrames: 1800, titles: 10, titleText: 120, sourceName: 120, name: 160,
  segmentVolume: 200, bedVolume: 100, sourceDimension: 1920, documentBytes: 262144 });

export const TITLE_POSITIONS = Object.freeze(['top', 'center', 'bottom']);
export const TITLE_SIZES = Object.freeze(['small', 'medium', 'large']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SOURCE_KEY = /^[a-z][a-z0-9]{0,15}$/;
const ITEM_ID = /^[a-z][a-z0-9-]{0,31}$/;
// C0/C1 controls, and the bidirectional overrides/isolates that can make a title read differently than it is stored.
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/;
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);

/** @description Reject invalid input with a stable, user-readable boundary error.
 * @param {boolean} condition Required condition. @param {string} message Rejection explanation.
 * @returns {void} Throws a TypeError when the condition is false. */
export function demand(condition, message) { if (!condition) throw new TypeError(message); }

/** @description Accept only plain objects (including prototype-less JSON) with exactly the allowed keys.
 * @param {unknown} value Candidate. @param {string[]} allowed Allowed keys. @param {string} label Error context.
 * @returns {void} Throws on arrays, exotic objects and unknown fields. */
export function exactObject(value, allowed, label) {
  demand(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  demand([Object.prototype, null].includes(Object.getPrototypeOf(value)), `${label} must be a plain object`);
  for (const key of Object.keys(value)) demand(allowed.includes(key), `${label} has an unsupported field`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) demand('value' in descriptor, `${label} must be plain data`);
}

/** @description Require a safe integer inside an inclusive range; strings and fractions are never coerced.
 * @param {unknown} value Candidate. @param {number} min Minimum. @param {number} max Maximum. @param {string} label Error context.
 * @returns {number} The integer. */
export function integer(value, min, max, label) {
  demand(Number.isSafeInteger(value) && value >= min && value <= max, `${label} must be a whole number from ${min} to ${max}`);
  return value;
}

/** @description Printable single-line text of bounded length.
 * @param {unknown} value Candidate. @param {number} max Maximum length. @param {string} label Error context.
 * @returns {string} The text, unchanged. */
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

/** @description A server-issued media identity: a lower-case UUID and nothing else (no path, URL or scheme).
 * @param {unknown} value Candidate. @returns {string} The UUID. */
export function assetId(value) {
  demand(typeof value === 'string' && UUID.test(value), 'Media must be referenced by its uploaded identity');
  return value;
}

function validateSource(value, label) {
  demand(value && typeof value === 'object' && (value.kind === 'video' || value.kind === 'audio'), `${label} must be a video clip or an audio bed`);
  const video = value.kind === 'video';
  exactObject(value, video ? ['kind', 'asset', 'name', 'frames', 'width', 'height', 'audio'] : ['kind', 'asset', 'name', 'frames'], label);
  const source = { kind: value.kind, asset: assetId(value.asset), name: plainText(value.name, LIMITS.sourceName, `${label} name`),
    frames: integer(value.frames, 1, video ? LIMITS.sourceFrames : LIMITS.bedFrames, `${label} length in frames`) };
  if (!video) return source;
  demand(typeof value.audio === 'boolean', `${label} must say whether it carries sound`);
  return { ...source, width: integer(value.width, 2, LIMITS.sourceDimension, `${label} width`),
    height: integer(value.height, 2, LIMITS.sourceDimension, `${label} height`), audio: value.audio };
}

function validateSources(value) {
  exactObject(value, Object.keys(value ?? {}), 'Sources');
  const sources = Object.create(null);
  const counts = { video: 0, audio: 0 };
  for (const [name, entry] of Object.entries(value)) {
    key(name, SOURCE_KEY, 'Source key');
    sources[name] = validateSource(entry, `Source ${name}`);
    counts[sources[name].kind] += 1;
  }
  demand(counts.video <= LIMITS.videoSources, `A project holds at most ${LIMITS.videoSources} video clips`);
  demand(counts.audio <= LIMITS.audioSources, `A project holds at most ${LIMITS.audioSources} audio bed`);
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
    exactObject(entry, ['id', 'source', 'in', 'out', 'volume'], label);
    const id = key(entry.id, ITEM_ID, `${label} ID`);
    demand(!ids.has(id), 'Segment IDs must be unique'); ids.add(id);
    const source = sources[key(entry.source, SOURCE_KEY, `${label} source`)];
    demand(source?.kind === 'video', `${label} must use a video clip in this project`);
    const start = integer(entry.in, 0, source.frames - 1, `${label} start`);
    const end = integer(entry.out, start + 1, source.frames, `${label} end`);
    total += end - start;
    return { id, source: entry.source, in: start, out: end, volume: integer(entry.volume, 0, LIMITS.segmentVolume, `${label} volume`) };
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

function validateBed(value, sources) {
  if (value === null) return null;
  exactObject(value, ['source', 'volume'], 'Audio bed');
  demand(sources[key(value.source, SOURCE_KEY, 'Audio bed source')]?.kind === 'audio', 'The audio bed must use an audio file in this project');
  return { source: value.source, volume: integer(value.volume, 0, LIMITS.bedVolume, 'Audio bed volume') };
}

/** @description Validate and normalize a whole timeline document. Titles must be in time order and
 *  never overlap (one title track); every frame boundary is an integer inside its source.
 * @param {unknown} value Parsed JSON document. @returns {object} A fresh normalized document. */
export function validateTimeline(value) {
  exactObject(value, ['version', 'name', 'profile', 'sources', 'segments', 'titles', 'audioBed'], 'Project');
  demand(value.version === 1, 'This project version is not supported');
  demand(value.profile === PROFILE.id, 'This output profile is not supported');
  const sources = validateSources(value.sources);
  const { segments, total } = validateSegments(value.segments, sources);
  const document = { version: 1, name: plainText(value.name, LIMITS.name, 'Project name'), profile: PROFILE.id,
    sources: { ...sources }, segments, titles: validateTitles(value.titles, total), audioBed: validateBed(value.audioBed, sources) };
  demand(new TextEncoder().encode(JSON.stringify(document)).length <= LIMITS.documentBytes, 'This project is too large');
  return document;
}

/** @description Output length of a validated timeline, in project frames.
 * @param {{segments:Array<{in:number,out:number}>}} document Validated document. @returns {number} Frames. */
export function timelineFrames(document) {
  return document.segments.reduce((sum, segment) => sum + segment.out - segment.in, 0);
}

/** @description Every uploaded media identity a document references, for owner-qualified checks.
 * @param {object} document Validated document. @returns {Array<{key:string,asset:string,kind:string}>} References. */
export function timelineAssets(document) {
  return Object.entries(document.sources).map(([name, source]) => ({ key: name, asset: source.asset, kind: source.kind }));
}
