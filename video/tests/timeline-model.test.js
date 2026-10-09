/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the manual timeline contract with the shipped browser/server modules: integer frame boundaries, trim/split/reorder/remove never change a source, the 2-clip/20-segment/60-second/one-title-track/one-bed bounds, refusal of unknown fields, unsafe keys, paths, URLs and control text, and bounded independent undo history.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = name => import(pathToFileURL(path.join(__dirname, '..', 'tools', 'editor', name)).href);
const ASSET_A = '11111111-1111-4111-8111-111111111111';
const ASSET_B = 'bbbbbbbb-2222-4222-a222-bbbbbbbbbbbb';
const ASSET_M = '33333333-3333-4333-8333-333333333333';
const clip = (asset, frames = 900, audio = true) => ({ kind: 'video', asset, name: 'Synthetic clip', frames, width: 1920, height: 1080, audio });
const bed = (frames = 1800) => ({ kind: 'audio', asset: ASSET_M, name: 'Synthetic bed', frames });

/** Deep-freeze a value so an operation that mutates its input throws instead of passing silently. */
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

async function twoClips() {
  const model = await load('timeline-model.mjs');
  let document = model.createTimeline('Two clips');
  ({ document } = model.addSource(document, clip(ASSET_A, 90)));
  ({ document } = model.addSource(document, clip(ASSET_B, 60, false)));
  document = model.appendSegment(document, 'v1');
  document = model.appendSegment(document, 'v2');
  return { model, document };
}

test('an empty project validates and round-trips through its persisted JSON unchanged', async () => {
  const model = await load('timeline-model.mjs');
  const empty = model.createTimeline('First edit');
  assert.deepEqual(empty, { version: 1, name: 'First edit', profile: 'hd720p30', sources: {}, segments: [], titles: [], audioBed: null });
  assert.deepEqual(model.parseTimeline(model.serializeTimeline(empty)), empty);
});

test('split, trim, reorder and remove are non-destructive: every output frame still names the same source frame', async () => {
  const { model, document } = await twoClips();
  assert.deepEqual(model.timelineLayout(document).map(row => [row.id, row.source, row.in, row.out, row.start, row.end]),
    [['s1', 'v1', 0, 90, 0, 90], ['s2', 'v2', 0, 60, 90, 150]]);
  const before = [0, 29, 30, 89, 90, 149].map(frame => model.locateFrame(document, frame));
  const { document: split, right } = model.splitSegment(freeze(document), 's1', 30);
  assert.equal(right, 's3');
  assert.deepEqual(split.segments.map(segment => [segment.id, segment.in, segment.out]), [['s1', 0, 30], ['s3', 30, 90], ['s2', 0, 60]]);
  const after = [0, 29, 30, 89, 90, 149].map(frame => model.locateFrame(split, frame));
  assert.deepEqual(after.map(row => [row.segment.source, row.sourceFrame]), before.map(row => [row.segment.source, row.sourceFrame]));
  const moved = model.moveSegment(split, 's2', 0);
  assert.deepEqual(model.timelineLayout(moved).map(row => [row.id, row.start, row.end]), [['s2', 0, 60], ['s1', 60, 90], ['s3', 90, 150]]);
  assert.deepEqual(model.locateFrame(moved, 60), { segment: model.timelineLayout(moved)[1], sourceFrame: 0 });
  const trimmed = model.trimSegment(moved, 's3', { in: 45, out: 80 });
  assert.deepEqual(trimmed.segments.find(segment => segment.id === 's3'), { id: 's3', source: 'v1', in: 45, out: 80, volume: 100 });
  assert.deepEqual(model.removeSegment(trimmed, 's2').segments.map(segment => segment.id), ['s1', 's3']);
  assert.deepEqual(document.segments.length, 2, 'the original document is untouched');
});

test('frame boundaries are whole numbers inside the source, and a split must fall strictly inside its segment', async () => {
  const { model, document } = await twoClips();
  for (const range of [{ in: 0, out: 91 }, { in: 10, out: 10 }, { in: -1, out: 10 }, { in: 0.5, out: 10 }, { in: '0', out: 10 }, { in: 0, out: 1e308 }]) {
    assert.throws(() => model.trimSegment(document, 's1', range), TypeError, JSON.stringify(range));
  }
  for (const frame of [0, 90, 150, 10.5, '30']) assert.throws(() => model.splitSegment(document, 's1', frame), TypeError, String(frame));
  assert.throws(() => model.splitSegment(document, 'missing', 30), /not on the timeline/);
  assert.throws(() => model.locateFrame(document, 1801), TypeError);
  assert.equal(model.locateFrame(document, 150), null);
});

test('the first-slice bounds hold: two clips, one bed, 30 s per clip, 60 s total and 20 segments', async () => {
  const model = await load('timeline-model.mjs');
  let document = model.createTimeline('Bounds');
  ({ document } = model.addSource(document, clip(ASSET_A)));
  ({ document } = model.addSource(document, clip(ASSET_B)));
  assert.throws(() => model.addSource(document, clip('44444444-4444-4444-8444-444444444444')), /at most 2 video clips/);
  assert.throws(() => model.addSource(model.addSource(model.createTimeline('x'), clip(ASSET_A)).document, clip(ASSET_A)), /added once/);
  assert.throws(() => model.addSource(model.createTimeline('x'), clip(ASSET_A, 901)), TypeError);
  assert.throws(() => model.addSource(model.createTimeline('x'), { ...clip(ASSET_A), width: 3840 }), TypeError);
  assert.throws(() => model.addSource(model.createTimeline('x'), bed(1801)), TypeError);
  const withBed = model.addSource(document, bed());
  assert.equal(withBed.key, 'm1');
  assert.throws(() => model.addSource(withBed.document, { ...bed(), asset: '55555555-5555-4555-8555-555555555555' }), /at most 1 audio bed/);
  document = model.appendSegment(model.appendSegment(document, 'v1'), 'v2');
  assert.equal(document.segments.reduce((sum, row) => sum + row.out - row.in, 0), 1800);
  assert.throws(() => model.appendSegment(document, 'v1'), /already 60 seconds/);
  let short = model.appendSegment(model.addSource(model.createTimeline('Split limit'), clip(ASSET_A)).document, 'v1');
  while (short.segments.length < 20) {
    const last = model.timelineLayout(short).at(-1);
    short = model.splitSegment(short, last.id, last.start + 1).document;
  }
  assert.equal(short.segments.length, 20);
  assert.throws(() => model.splitSegment(short, short.segments.at(-1).id, model.timelineLayout(short).at(-1).start + 1), /at most 20 segments/);
});

test('titles live on one track: ordered, non-overlapping, printable, and refit when the timeline shortens', async () => {
  const { model, document } = await twoClips();
  let titled = model.addTitle(document, { text: 'Closing', start: 100, end: 140 }).document;
  titled = model.addTitle(titled, { text: 'Opening', start: 0, end: 30, position: 'top', size: 'large' }).document;
  assert.deepEqual(titled.titles.map(title => [title.id, title.text, title.start, title.end, title.position, title.size]),
    [['t2', 'Opening', 0, 30, 'top', 'large'], ['t1', 'Closing', 100, 140, 'bottom', 'medium']]);
  assert.throws(() => model.addTitle(titled, { text: 'Overlap', start: 20, end: 40 }), TypeError);
  assert.throws(() => model.addTitle(titled, { text: 'Too long', start: 140, end: 151 }), TypeError);
  for (const text of ['', '   ', 'x'.repeat(121), 'line\nbreak', 'bell\u0007', 'spoof‮evil', 'tab\there']) {
    assert.throws(() => model.addTitle(document, { text, start: 0, end: 10 }), TypeError, JSON.stringify(text));
  }
  assert.throws(() => model.addTitle(document, { text: 'x', start: 0, end: 10, position: 'left' }), /not supported/);
  assert.throws(() => model.addTitle(model.createTimeline('Empty'), { text: 'Nothing to show', start: 0, end: 1 }), TypeError);
  const shortened = model.removeSegment(titled, 's2');
  assert.deepEqual(shortened.titles.map(title => [title.id, title.end]), [['t2', 30]], 'a title past the new end is dropped');
  const clamped = model.trimSegment(titled, 's2', { in: 0, out: 20 });
  assert.deepEqual(clamped.titles.map(title => [title.id, title.start, title.end]), [['t2', 0, 30], ['t1', 100, 110]]);
  assert.deepEqual(model.updateTitle(titled, 't1', { text: 'Renamed' }).titles[1].text, 'Renamed');
  assert.throws(() => model.updateTitle(titled, 't1', { id: 'other' }), /not supported/);
  assert.deepEqual(model.removeTitle(titled, 't2').titles.map(title => title.id), ['t1']);
});

test('the audio bed and clip volumes are bounded, and a bed must be an audio file while segments must be video', async () => {
  const { model, document } = await twoClips();
  const { document: withBed, key } = model.addSource(document, bed());
  const mixed = model.setAudioBed(withBed, key, 35);
  assert.deepEqual(mixed.audioBed, { source: 'm1', volume: 35 });
  assert.throws(() => model.setAudioBed(withBed, 'v1', 35), /audio file/);
  assert.throws(() => model.setAudioBed(withBed, key, 101), TypeError);
  assert.throws(() => model.appendSegment(withBed, key), /video clip/);
  assert.throws(() => model.removeSource(mixed, key), /Remove it from the timeline first/);
  assert.equal(model.setAudioBed(mixed, null).audioBed, null);
  assert.equal(model.setSegmentVolume(document, 's1', 0).segments[0].volume, 0);
  assert.throws(() => model.setSegmentVolume(document, 's1', 201), TypeError);
  assert.throws(() => model.setSegmentVolume(document, 's1', 50.5), TypeError);
});

test('unknown fields, unsafe keys, paths, URLs and non-plain data are refused at every level', async () => {
  const { validateTimeline } = await load('timeline-validation.mjs');
  const { document } = await twoClips();
  const good = JSON.parse(JSON.stringify(document));
  assert.deepEqual(validateTimeline(good), document);
  const variants = {
    'extra document field': { ...good, owner: 'someone' },
    'version 2': { ...good, version: 2 },
    'another profile': { ...good, profile: 'uhd2160p60' },
    'extra source field': { ...good, sources: { ...good.sources, v1: { ...good.sources.v1, path: '/etc/passwd' } } },
    'asset as a path': { ...good, sources: { ...good.sources, v1: { ...good.sources.v1, asset: '../../etc/passwd' } } },
    'asset as a URL': { ...good, sources: { ...good.sources, v1: { ...good.sources.v1, asset: 'http://192.168.50.10/clip.mp4' } } },
    'asset upper-case': { ...good, sources: { ...good.sources, v2: { ...good.sources.v2, asset: ASSET_B.toUpperCase() } } },
    'source key with a path': { ...good, sources: { 'a/b': good.sources.v1 } },
    'raw ffmpeg in a segment': { ...good, segments: [{ ...good.segments[0], filter: 'movie=/etc/passwd' }] },
    'segment start as text': { ...good, segments: [{ ...good.segments[0], in: '0;drawtext' }] },
    'segment on a missing source': { ...good, segments: [{ ...good.segments[0], source: 'v9' }] },
    'duplicate segment IDs': { ...good, segments: [good.segments[0], { ...good.segments[1], id: good.segments[0].id }] },
    'title extra field': { ...good, titles: [{ id: 't1', text: 'x', start: 0, end: 5, position: 'top', size: 'small', font: '/tmp/x.ttf' }] },
    'bed on a video': { ...good, audioBed: { source: 'v1', volume: 10 } },
    'segments not an array': { ...good, segments: { 0: good.segments[0] } },
  };
  for (const [name, value] of Object.entries(variants)) assert.throws(() => validateTimeline(value), TypeError, name);
  const proto = JSON.parse(`{"version":1,"name":"x","profile":"hd720p30","sources":{"__proto__":${JSON.stringify(good.sources.v1)}},"segments":[],"titles":[],"audioBed":null}`);
  assert.throws(() => validateTimeline(proto), TypeError, '__proto__ source key');
  const accessor = { ...good };
  Object.defineProperty(accessor, 'name', { enumerable: true, get() { return 'computed'; } });
  assert.throws(() => validateTimeline(accessor), TypeError, 'accessor property');
  class Project { constructor() { Object.assign(this, good); } }
  assert.throws(() => validateTimeline(new Project()), TypeError, 'class instance');
});

test('history keeps bounded independent snapshots and records a no-op commit as nothing', async () => {
  const { createTimelineHistory } = await load('timeline-history.mjs');
  const { model, document } = await twoClips();
  const history = createTimelineHistory(document, { limit: 3 });
  assert.equal(history.canUndo(), false);
  const split = model.splitSegment(document, 's1', 45).document;
  history.commit(split);
  history.commit(split);
  assert.equal(history.size(), 2, 'committing the same document again records nothing');
  const moved = model.moveSegment(split, 's2', 0);
  history.commit(moved);
  history.commit(model.removeSegment(moved, 's2'));
  assert.equal(history.size(), 3, 'the oldest snapshot is dropped at the limit');
  assert.deepEqual(history.undo().segments.map(segment => segment.id), ['s2', 's1', 's3']);
  const returned = history.current(); returned.segments.length = 0;
  assert.equal(history.current().segments.length, 3, 'a returned document cannot edit history');
  assert.deepEqual(history.undo().segments.map(segment => segment.id), ['s1', 's3', 's2']);
  assert.equal(history.canUndo(), false);
  assert.deepEqual(history.redo().segments.map(segment => segment.id), ['s2', 's1', 's3']);
  history.commit(document);
  assert.equal(history.canRedo(), false, 'a new edit discards the redo branch');
  assert.throws(() => createTimelineHistory(document, { limit: 0 }), TypeError);
  assert.throws(() => history.commit({ ...document, owner: 'x' }), TypeError);
});
