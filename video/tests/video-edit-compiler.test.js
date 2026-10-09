/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the COMPILED timeline compiler (routes/video-edit-compiler.js) emits one fixed argument array whose filter graph carries only integers: exact frame and sample trims, split per reused clip, exact silence for a silent clip, titles from server-named files with expansion off, the bed padded/cut to the timeline, every graph label produced and consumed exactly once, and hostile title text, fractional or textual numbers, relative or multi-line media paths and unsafe font paths refused.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { compileTimeline, TimelineCompileError, SAMPLES_PER_FRAME } = require('../routes/video-edit-compiler.js');

const load = name => import(pathToFileURL(path.join(__dirname, '..', 'tools', 'editor', name)).href);
const FONT = '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf';
const MEDIA = { v1: '/data/video-edit/owner/aaaaaaaa-0000-4000-8000-000000000001.mp4',
  v2: '/data/video-edit/owner with space/aaaaaaaa-0000-4000-8000-000000000002.mp4',
  m1: '/data/video-edit/owner/aaaaaaaa-0000-4000-8000-000000000003.wav' };
const HOSTILE = "It's a:b,c;d\\e[f]%{localtime} drawtext='x' movie=/etc/passwd";

/** Build the reference edit: B trimmed and first, A split into two reordered halves, a title and a bed. */
async function reference() {
  const model = await load('timeline-model.mjs');
  let document = model.createTimeline('Reference edit');
  ({ document } = model.addSource(document, { kind: 'video', asset: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'A', frames: 60, width: 320, height: 180, audio: true }));
  ({ document } = model.addSource(document, { kind: 'video', asset: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'B', frames: 90, width: 180, height: 320, audio: false }));
  ({ document } = model.addSource(document, { kind: 'audio', asset: 'aaaaaaaa-0000-4000-8000-000000000003', name: 'Bed', frames: 300 }));
  document = model.appendSegment(document, 'v2', { in: 24, out: 72 });
  document = model.appendSegment(document, 'v1', { in: 12, out: 48 });
  document = model.splitSegment(document, 's2', 66).document;
  document = model.setSegmentVolume(document, 's3', 150);
  document = model.addTitle(document, { text: HOSTILE, start: 0, end: 30, position: 'top', size: 'large' }).document;
  document = model.setAudioBed(document, 'm1', 25);
  return document;
}

/** Every intermediate label must be produced once and consumed once; the two mapped outputs only produced. */
function labelAccounting(graph) {
  const produced = new Map(), consumed = new Map();
  for (const chain of graph.split(';')) {
    const inputs = /^((?:\[[^\]]+\])*)/.exec(chain)[1].match(/[^[\]]+/g) ?? [];
    const outputs = /((?:\[[^\]]+\])*)$/.exec(chain)[1].match(/[^[\]]+/g) ?? [];
    inputs.forEach(label => consumed.set(label, (consumed.get(label) ?? 0) + 1));
    outputs.forEach(label => produced.set(label, (produced.get(label) ?? 0) + 1));
  }
  for (const [label, count] of consumed) {
    if (/^\d+:[va]:0$/.test(label)) { assert.equal(count, 1, `input pad ${label} is read once`); continue; }
    assert.equal(produced.get(label), 1, `${label} is produced once`); assert.equal(count, 1, `${label} is consumed once`);
  }
  for (const [label, count] of produced) {
    assert.equal(count, 1, `${label} is produced once`);
    if (!consumed.has(label)) assert.ok(['vout', 'aout'].includes(label), `${label} dangles`);
  }
}

test('the reference edit compiles to exact integer trims, one input per clip and a mapped bed', async () => {
  const compiled = compileTimeline({ document: await reference(), media: MEDIA, variant: 'export', fontFile: FONT });
  assert.ok(compiled.args.every(arg => typeof arg === 'string'));
  assert.equal(compiled.frames, 48 + 18 + 18);
  assert.equal(compiled.samples, compiled.frames * SAMPLES_PER_FRAME);
  assert.deepEqual([compiled.width, compiled.height, compiled.fps], [1280, 720, 30]);
  const inputs = compiled.args.flatMap((arg, index) => arg === '-i' ? [[compiled.args[index - 3], compiled.args[index - 2], compiled.args[index - 1], compiled.args[index + 1]]] : []);
  assert.deepEqual(inputs, [
    ['file', '-f', 'mov', `file:${MEDIA.v2}`], ['file', '-f', 'mov', `file:${MEDIA.v1}`], ['file', '-f', 'wav', `file:${MEDIA.m1}`]]);
  assert.equal(compiled.args.filter(arg => arg === '-protocol_whitelist').length, 3);
  const graph = compiled.filterGraph;
  assert.match(graph, /\[0:v:0\]fps=30,scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1280:720:\(ow-iw\)\/2:\(oh-ih\)\/2:color=black,setsar=1,format=yuv420p,split=1\[v0_0\]/);
  assert.match(graph, /\[1:v:0\][^;]*split=2\[v1_0\]\[v1_1\]/, 'clip A is decoded once and split for its two halves');
  assert.match(graph, /\[v0_0\]trim=start_frame=24:end_frame=72,setpts=PTS-STARTPTS\[s0\]/);
  assert.match(graph, /\[v1_0\]trim=start_frame=12:end_frame=30,setpts=PTS-STARTPTS\[s1\]/);
  assert.match(graph, /\[v1_1\]trim=start_frame=30:end_frame=48,setpts=PTS-STARTPTS\[s2\]/);
  assert.match(graph, /anullsrc=channel_layout=stereo:sample_rate=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=end_sample=76800,asetpts=PTS-STARTPTS\[c0\]/,
    'the silent clip B gets exactly 48 frames of silence');
  assert.match(graph, /\[1:a:0\]aresample=48000,[^;]*apad=whole_len=96000,asplit=2\[a1_0\]\[a1_1\]/);
  assert.match(graph, /\[a1_0\]atrim=start_sample=19200:end_sample=48000,asetpts=PTS-STARTPTS,volume=100\/100\[c1\]/);
  assert.match(graph, /\[a1_1\]atrim=start_sample=48000:end_sample=76800,asetpts=PTS-STARTPTS,volume=150\/100\[c2\]/);
  assert.match(graph, /\[s0\]\[c0\]\[s1\]\[c1\]\[s2\]\[c2\]concat=n=3:v=1:a=1\[vcat\]\[acat\]/);
  assert.match(graph, /\[2:a:0\]aresample=48000,[^;]*apad=whole_len=134400,atrim=end_sample=134400,asetpts=PTS-STARTPTS,volume=25\/100\[bed\]/);
  assert.match(graph, /\[acat\]\[bed\]amix=inputs=2:duration=first:dropout_transition=0:normalize=0\[aout\]/);
  const at = flag => compiled.args[compiled.args.indexOf(flag) + 1];
  assert.equal(at('-frames:v'), '84'); assert.equal(at('-c:v'), 'libx264'); assert.equal(at('-c:a'), 'aac');
  assert.equal(at('-map'), '[vout]'); assert.equal(compiled.args.at(-1), 'file:output.mp4');
  assert.ok(compiled.args.includes('-nostdin') && compiled.args.includes('-n'), 'never reads stdin, never overwrites');
  labelAccounting(graph);
});

test('title text never enters the arguments: it is written to a server-named file read with expansion off', async () => {
  const compiled = compileTimeline({ document: await reference(), media: MEDIA, variant: 'export', fontFile: FONT });
  assert.deepEqual(compiled.files, [{ name: 'title-0.txt', text: HOSTILE }]);
  for (const arg of compiled.args) {
    for (const fragment of ["It's", 'localtime', 'movie=', '/etc/passwd', "drawtext='x'", 'a:b,c']) assert.ok(!arg.includes(fragment), `${fragment} leaked into ${arg.slice(0, 60)}`);
  }
  assert.match(compiled.filterGraph, /\[vcat\]drawtext=textfile=title-0\.txt:expansion=none:fontfile=\/usr\/share\/fonts\/dejavu\/DejaVuSans-Bold\.ttf:fontsize=72:[^;]*y=60:enable='between\(n,0,29\)'\[vtitled\]/);
});

test('the preview variant uses the same graph at 640x360 and faster encoder settings', async () => {
  const document = await reference();
  const exported = compileTimeline({ document, media: MEDIA, variant: 'export', fontFile: FONT });
  const preview = compileTimeline({ document, media: MEDIA, variant: 'preview', fontFile: FONT });
  assert.deepEqual([preview.width, preview.height, preview.frames], [640, 360, exported.frames]);
  assert.equal(preview.filterGraph.replaceAll('640:360', '1280:720').replace('fontsize=36', 'fontsize=72').replace('y=30:', 'y=60:'), exported.filterGraph);
  assert.equal(preview.args[preview.args.indexOf('-preset') + 1], 'ultrafast');
});

test('a document that bypassed validation cannot smuggle text or fractions into the graph', async () => {
  const good = await reference();
  const tamper = change => { const copy = JSON.parse(JSON.stringify(good)); change(copy); return copy; };
  const variants = {
    'textual start': tamper(doc => { doc.segments[0].in = '0:end_frame=1,movie=/etc/passwd'; }),
    'fractional end': tamper(doc => { doc.segments[0].out = 40.5; }),
    'end past the source': tamper(doc => { doc.segments[0].out = 91; }),
    'fractional volume': tamper(doc => { doc.segments[1].volume = 1.5; }),
    'textual title start': tamper(doc => { doc.titles[0].start = '0)+1,(1'; }),
    'bed on a video': tamper(doc => { doc.audioBed.source = 'v1'; }),
    'segment on the bed': tamper(doc => { doc.segments[0].source = 'm1'; }),
    'bed volume text': tamper(doc => { doc.audioBed.volume = '25/100[bed];movie=x'; }),
    'another profile': tamper(doc => { doc.profile = 'custom'; }),
  };
  for (const [name, document] of Object.entries(variants)) {
    assert.throws(() => compileTimeline({ document, media: MEDIA, variant: 'export', fontFile: FONT }),
      error => error instanceof TimelineCompileError && error.code === 'timeline_invalid', name);
  }
});

test('media must be server-resolved absolute single-line paths, the font plain path characters, and a timeline non-empty', async () => {
  const document = await reference();
  const code = expected => error => error instanceof TimelineCompileError && error.code === expected;
  for (const media of [{ ...MEDIA, v1: undefined }, { ...MEDIA, v1: 'relative/clip.mp4' }, { ...MEDIA, v1: 'http://192.168.50.10/a.mp4' },
    { ...MEDIA, v1: '/data/a.mp4\n-i /etc/passwd' }, { ...MEDIA, m1: '' }]) {
    assert.throws(() => compileTimeline({ document, media, variant: 'export', fontFile: FONT }), code('timeline_media_unavailable'));
  }
  for (const fontFile of ['relative.ttf', '/fonts/a:b.ttf', '/fonts/a,b.ttf', "/fonts/it's.ttf", '/fonts/sans.pfb']) {
    assert.throws(() => compileTimeline({ document, media: MEDIA, variant: 'export', fontFile }), code('timeline_font_unavailable'), fontFile);
  }
  const untitled = { ...document, titles: [] };
  assert.equal(compileTimeline({ document: untitled, media: MEDIA, variant: 'export', fontFile: 'unused' }).files.length, 0,
    'no title, no font needed');
  const empty = { ...document, segments: [], titles: [], audioBed: null };
  assert.throws(() => compileTimeline({ document: empty, media: MEDIA, variant: 'export', fontFile: FONT }), code('timeline_empty'));
  assert.throws(() => compileTimeline({ document, media: MEDIA, variant: 'lossless', fontFile: FONT }), code('timeline_invalid'));
  assert.throws(() => compileTimeline({ document, media: MEDIA, variant: 'export', fontFile: FONT, threads: 64 }), code('timeline_invalid'));
});
