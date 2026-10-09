/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Immutable manual timeline operations: add/remove sources, append, trim, split, reorder and remove non-destructive segments, per-segment volume, one title track, one audio bed. Every operation returns a freshly validated document and never edits its input; structural edits refit titles to the new length instead of leaving them past the end.
 */
import { LIMITS, PROFILE, TITLE_POSITIONS, TITLE_SIZES, demand, integer, plainText, timelineFrames, validateTimeline } from './timeline-validation.mjs';

/** @description A new empty project in the one supported profile.
 * @param {string} name Project name. @returns {object} Validated empty document. */
export function createTimeline(name = 'Untitled video') {
  return validateTimeline({ version: 1, name, profile: PROFILE.id, sources: {}, segments: [], titles: [], audioBed: null });
}

/** @description Serialize a validated document as the persisted JSON text.
 * @param {object} document Document. @returns {string} JSON. */
export function serializeTimeline(document) { return JSON.stringify(validateTimeline(document)); }

/** @description Parse and validate persisted JSON text.
 * @param {string} text JSON. @returns {object} Validated document. */
export function parseTimeline(text) {
  demand(typeof text === 'string' && text.length <= LIMITS.documentBytes, 'This project file is too large');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new TypeError('This project file is not valid JSON'); }
  return validateTimeline(parsed);
}

/** @description Where each segment sits on the output timeline.
 * @param {object} document Validated document.
 * @returns {Array<{id:string,source:string,in:number,out:number,volume:number,start:number,end:number,index:number}>} Layout rows. */
export function timelineLayout(document) {
  let cursor = 0;
  return document.segments.map((segment, index) => {
    const row = { ...segment, index, start: cursor, end: cursor + segment.out - segment.in };
    cursor = row.end; return row;
  });
}

/** @description Resolve an output frame to the segment and the exact source frame it shows.
 * @param {object} document Validated document. @param {number} frame Output frame.
 * @returns {{segment:object,sourceFrame:number}|null} The owner, or null past the end. */
export function locateFrame(document, frame) {
  integer(frame, 0, LIMITS.totalFrames, 'Playhead');
  const row = timelineLayout(document).find(item => frame >= item.start && frame < item.end);
  return row ? { segment: row, sourceFrame: row.in + frame - row.start } : null;
}

function nextId(taken, prefix) {
  for (let index = 1; index <= 1000; index += 1) if (!taken.has(`${prefix}${index}`)) return `${prefix}${index}`;
  throw new TypeError('No free identifier remains');
}

/** Keep the title track inside the new length: clamp ends and drop titles that now start after the end. */
function refit(document) {
  const total = timelineFrames(document);
  const titles = document.titles.filter(title => title.start < total).map(title => ({ ...title, end: Math.min(title.end, total) }));
  return validateTimeline({ ...document, titles });
}

function withSegments(document, segments) { return refit({ ...document, segments }); }
function segmentIndex(document, id) {
  const index = document.segments.findIndex(segment => segment.id === id);
  demand(index >= 0, 'That segment is not on the timeline'); return index;
}

/** @description Add one uploaded clip or audio file with its verified metadata.
 * @param {object} document Document. @param {object} source Source record (kind, asset, name, frames[, width, height, audio]).
 * @returns {{document:object,key:string}} New document and the source key it was given. */
export function addSource(document, source) {
  const key = nextId(new Set(Object.keys(document.sources)), source?.kind === 'audio' ? 'm' : 'v');
  return { document: validateTimeline({ ...document, sources: { ...document.sources, [key]: source } }), key };
}

/** @description Remove a source no segment or bed still uses.
 * @param {object} document Document. @param {string} key Source key. @returns {object} New document. */
export function removeSource(document, key) {
  demand(Object.hasOwn(document.sources, key), 'That file is not in this project');
  demand(!document.segments.some(segment => segment.source === key) && document.audioBed?.source !== key, 'Remove it from the timeline first');
  const sources = { ...document.sources }; delete sources[key];
  return validateTimeline({ ...document, sources });
}

/** @description Append a clip to the end of the main track, clamped to the remaining 60-second budget.
 * @param {object} document Document. @param {string} key Video source key. @param {{in?:number,out?:number}} range Optional source range.
 * @returns {object} New document. */
export function appendSegment(document, key, range = {}) {
  const source = document.sources[key];
  demand(source?.kind === 'video', 'Choose a video clip in this project');
  const remaining = LIMITS.totalFrames - timelineFrames(document);
  demand(remaining > 0, 'The timeline is already 60 seconds long');
  const start = range.in ?? 0, end = Math.min(range.out ?? source.frames, start + remaining);
  const id = nextId(new Set(document.segments.map(segment => segment.id)), 's');
  return withSegments(document, [...document.segments, { id, source: key, in: start, out: end, volume: 100 }]);
}

/** @description Move a segment's source start and end; the source file itself never changes.
 * @param {object} document Document. @param {string} id Segment. @param {{in:number,out:number}} range New source range.
 * @returns {object} New document. */
export function trimSegment(document, id, range) {
  const index = segmentIndex(document, id), segments = [...document.segments];
  segments[index] = { ...segments[index], in: range.in, out: range.out };
  return withSegments(document, segments);
}

/** @description Split one segment in two at an output frame strictly inside it; both halves keep the same source.
 * @param {object} document Document. @param {string} id Segment. @param {number} frame Output frame of the cut.
 * @returns {{document:object,left:string,right:string}} New document and the two segment IDs. */
export function splitSegment(document, id, frame) {
  demand(document.segments.length < LIMITS.segments, `The timeline holds at most ${LIMITS.segments} segments`);
  const row = timelineLayout(document)[segmentIndex(document, id)];
  integer(frame, row.start + 1, row.end - 1, 'Split point');
  const cut = row.in + frame - row.start;
  const right = nextId(new Set(document.segments.map(segment => segment.id)), 's');
  const segments = [...document.segments];
  segments.splice(row.index, 1, { ...segments[row.index], out: cut }, { ...segments[row.index], id: right, in: cut });
  return { document: withSegments(document, segments), left: id, right };
}

/** @description Reorder a segment to a new index on the main track.
 * @param {object} document Document. @param {string} id Segment. @param {number} to Destination index.
 * @returns {object} New document. */
export function moveSegment(document, id, to) {
  const from = segmentIndex(document, id);
  integer(to, 0, document.segments.length - 1, 'Position');
  const segments = [...document.segments];
  segments.splice(to, 0, ...segments.splice(from, 1));
  return withSegments(document, segments);
}

/** @description Remove one segment; later segments close the gap.
 * @param {object} document Document. @param {string} id Segment. @returns {object} New document. */
export function removeSegment(document, id) {
  const index = segmentIndex(document, id);
  return withSegments(document, document.segments.filter((_, position) => position !== index));
}

/** @description Set one segment's clip volume, as a percentage (100 is unchanged, 0 is silent).
 * @param {object} document Document. @param {string} id Segment. @param {number} volume Percent 0-200.
 * @returns {object} New document. */
export function setSegmentVolume(document, id, volume) {
  const index = segmentIndex(document, id), segments = [...document.segments];
  segments[index] = { ...segments[index], volume: integer(volume, 0, LIMITS.segmentVolume, 'Clip volume') };
  return validateTimeline({ ...document, segments });
}

function placeTitles(document, titles) {
  return validateTimeline({ ...document, titles: [...titles].sort((left, right) => left.start - right.start) });
}

/** @description Add a timed title on the one title track; it may not overlap another title.
 * @param {object} document Document. @param {{text:string,start:number,end:number,position?:string,size?:string}} title Title.
 * @returns {{document:object,id:string}} New document and the title ID. */
export function addTitle(document, title) {
  const id = nextId(new Set(document.titles.map(item => item.id)), 't');
  const entry = { id, text: plainText(title.text, LIMITS.titleText, 'Title text'), start: title.start, end: title.end,
    position: title.position ?? TITLE_POSITIONS[2], size: title.size ?? TITLE_SIZES[1] };
  return { document: placeTitles(document, [...document.titles, entry]), id };
}

/** @description Change a title's text, timing, position or size.
 * @param {object} document Document. @param {string} id Title. @param {object} changes Fields to replace.
 * @returns {object} New document. */
export function updateTitle(document, id, changes) {
  const index = document.titles.findIndex(title => title.id === id);
  demand(index >= 0, 'That title is not on the timeline');
  const allowed = ['text', 'start', 'end', 'position', 'size'];
  demand(Object.keys(changes ?? {}).every(name => allowed.includes(name)), 'That title change is not supported');
  const titles = [...document.titles];
  titles[index] = { ...titles[index], ...changes, id };
  return placeTitles(document, titles);
}

/** @description Remove a title. @param {object} document Document. @param {string} id Title. @returns {object} New document. */
export function removeTitle(document, id) {
  demand(document.titles.some(title => title.id === id), 'That title is not on the timeline');
  return validateTimeline({ ...document, titles: document.titles.filter(title => title.id !== id) });
}

/** @description Use an audio source as the bed under the whole timeline, or clear it with null.
 * @param {object} document Document. @param {string|null} key Audio source key. @param {number} volume Percent 0-100.
 * @returns {object} New document. */
export function setAudioBed(document, key, volume = 40) {
  return validateTimeline({ ...document, audioBed: key === null ? null : { source: key, volume } });
}

/** @description Rename the project. @param {object} document Document. @param {string} name New name. @returns {object} New document. */
export function renameTimeline(document, name) { return validateTimeline({ ...document, name }); }
