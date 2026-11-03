/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | The published lesson videos, decoded: real video that keeps moving, a monster in the room, a voice whose pitch moves like a person's, captions that match the script, a file that streams. Regression: five still text cards read by a flat synthesizer (2.7 semitones of pitch movement) passed the old file-exists test.
 * -----------------------------------------------------------------------------
 *
 * Needs ffmpeg and ffprobe. It fails, never skips, without them.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const MEDIA = path.join(PKG, 'tools/prep-media');
const VIDEOS = path.join(PKG, '.videos');
const STUDIO = path.join(PKG, 'scripts/lesson-studio');
const { describe, scriptDigest, spokenWords } = require(path.join(STUDIO, 'lessons-json.cjs'));
const catalog = JSON.parse(fs.readFileSync(path.join(PKG, 'data/test-prep/catalog.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(MEDIA, 'manifest.json'), 'utf8')).lessons;

const W = 160, H = 90;
const MIN_MOVING_SHARE = 0.75, MIN_MONSTER_AREA = 0.2, MIN_PITCH_SPREAD = 10;

const ffmpeg = (args) => execFileSync('ffmpeg', ['-v', 'error', ...args], { maxBuffer: 1 << 30 });
const probe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8' }));

/** Every keyframe (one each four seconds) as small RGB frames. */
function keyframes(file) {
  const raw = ffmpeg(['-skip_frame', 'nokey', '-i', file, '-vf', `scale=${W}:${H}`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const size = W * H * 3, frames = [];
  for (let i = 0; i + size <= raw.length; i += size) frames.push(raw.subarray(i, i + size));
  return frames;
}

const plate = () => ffmpeg(['-i', path.join(STUDIO, 'art/room.jpg'), '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);

/** Mean per-channel change between two frames. */
function difference(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/** Share of neighboring keyframes where the picture visibly changed. */
function movingShare(frames) {
  if (frames.length < 2) return 0;
  let moving = 0;
  for (let i = 1; i < frames.length; i++) if (difference(frames[i - 1], frames[i]) > 0.25) moving += 1;
  return moving / (frames.length - 1);
}

/** Share of the monster's corner of the frame that is not the empty room. */
function monsterArea(frame, room) {
  let covered = 0, total = 0;
  for (let y = Math.floor(H * 0.4); y < H * 0.92; y++) {
    for (let x = Math.floor(W * 0.72); x < W; x++) {
      const i = (y * W + x) * 3;
      total += 1;
      if (Math.abs(frame[i] - room[i]) + Math.abs(frame[i + 1] - room[i + 1]) + Math.abs(frame[i + 2] - room[i + 2]) > 70) covered += 1;
    }
  }
  return covered / total;
}

/** How far the voice's pitch travels, in semitones (5th to 95th percentile of voiced windows). */
function pitchSpread(file) {
  const raw = ffmpeg(['-i', file, '-ar', '16000', '-ac', '1', '-f', 's16le', '-']);
  const pcm = new Int16Array(raw.buffer, raw.byteOffset, raw.length >> 1);
  const win = 640, lowLag = 36, highLag = 228, pitches = [];
  for (let start = 0; start + win < pcm.length; start += 960) {
    let energy = 0;
    for (let i = 0; i < win; i++) energy += pcm[start + i] * pcm[start + i];
    if (Math.sqrt(energy / win) < 500) continue;
    let best = 0, bestLag = 0;
    for (let lag = lowLag; lag < highLag; lag++) {
      let c = 0;
      for (let i = 0; i < win - lag; i += 2) c += pcm[start + i] * pcm[start + i + lag];
      if (c > best) { best = c; bestLag = lag; }
    }
    if (bestLag && best / (energy / 2) > 0.45) pitches.push(16000 / bestLag);
  }
  if (pitches.length < 20) return 0;
  const notes = pitches.map((p) => 12 * Math.log2(p)).sort((a, b) => a - b);
  return notes[Math.floor(notes.length * 0.95)] - notes[Math.floor(notes.length * 0.05)];
}

/** Integrated loudness in LUFS. */
function loudness(file) {
  const log = execFileSync('sh', ['-c', `ffmpeg -hide_banner -nostats -i "${file}" -af ebur128=framelog=quiet -f null - 2>&1 | tail -12`], { encoding: 'utf8' });
  return Number(/I:\s+(-?[\d.]+) LUFS/.exec(log)[1]);
}

/** True when the MP4's index comes before its data, so it can play while still downloading. */
function indexFirst(file) {
  const bytes = fs.readFileSync(file);
  let at = 0;
  while (at + 8 <= bytes.length) {
    const size = bytes.readUInt32BE(at), type = bytes.toString('latin1', at + 4, at + 8);
    if (type === 'moov') return true;
    if (type === 'mdat') return false;
    at += size === 1 ? Number(bytes.readBigUInt64BE(at + 8)) : size;
    if (size === 0) break;
  }
  return false;
}

const room = plate();

test('negative controls: the checks catch what the old videos were', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-video-guard-'));
  try {
    const still = path.join(dir, 'still.mp4');
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x173c40:s=1280x720:r=12:d=30', '-c:v', 'libx264', '-g', '48', '-pix_fmt', 'yuv420p', still]);
    assert.equal(movingShare(keyframes(still)), 0, 'a still card does not count as moving');
    const empty = path.join(dir, 'empty.mp4');
    ffmpeg(['-loop', '1', '-t', '4', '-i', path.join(STUDIO, 'art/room.jpg'), '-c:v', 'libx264', '-g', '12', '-pix_fmt', 'yuv420p', empty]);
    assert.ok(monsterArea(keyframes(empty)[0], room) < 0.02, 'the empty room has no monster in it');
    const flat = path.join(dir, 'flat.wav');
    ffmpeg(['-f', 'lavfi', '-i', 'aevalsrc=0.5*sin(2*PI*170*t)+0.3*sin(4*PI*170*t):d=12:s=16000', flat]);
    assert.ok(pitchSpread(flat) < 1, 'a flat voice has almost no pitch movement');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const lesson of catalog.lessons) {
  const id = lesson.id, video = path.join(VIDEOS, `${id}.mp4`);

  test(`${id}: a real 1080p video that streams`, () => {
    const info = probe(video);
    const v = info.streams.find((s) => s.codec_type === 'video'), a = info.streams.find((s) => s.codec_type === 'audio');
    assert.equal(v.codec_name, 'h264');
    assert.equal(v.pix_fmt, 'yuv420p');
    assert.deepEqual([v.width, v.height], [1920, 1080]);
    assert.equal(v.r_frame_rate, '30/1');
    assert.equal(a.codec_name, 'aac');
    assert.ok(Number(info.format.duration) >= 60, `${id} is ${info.format.duration} s`);
    assert.ok(indexFirst(video), 'the index comes first, so playback starts before the download ends');
    assert.ok(fs.statSync(video).size < 30 << 20, 'small enough for a phone');
  });

  test(`${id}: the picture keeps moving and the monster is in it`, () => {
    const frames = keyframes(video);
    assert.ok(movingShare(frames) >= MIN_MOVING_SHARE, `moving share ${movingShare(frames)}`);
    const withMonster = frames.filter((f) => monsterArea(f, room) >= MIN_MONSTER_AREA).length;
    assert.ok(withMonster / frames.length >= 0.9, `monster in ${withMonster} of ${frames.length} keyframes`);
  });

  test(`${id}: the voice moves like a person's and sits at the common loudness`, () => {
    const spread = pitchSpread(video);
    assert.ok(spread >= MIN_PITCH_SPREAD, `pitch moves ${spread.toFixed(1)} semitones`);
    const level = loudness(video);
    assert.ok(level >= -20 && level <= -13, `loudness ${level} LUFS`);
  });

  test(`${id}: the manifest describes this exact file and this exact script`, () => {
    const entry = manifest[id], script = describe(id);
    assert.equal(entry.sha256, crypto.createHash('sha256').update(fs.readFileSync(video)).digest('hex'), 'the video changed without the manifest');
    assert.equal(entry.script, scriptDigest(script), 'the script changed since this video was filmed');
    assert.notEqual(entry.voice.engine, 'kokoro', 'a rehearsal voice is never published');
    assert.ok(entry.checks.wordMatch >= 0.9, `the take matched ${entry.checks.wordMatch} of the script`);
    assert.equal(entry.teacher, script.teacher.name);
    assert.equal(lesson.teacher, entry.teacher, 'the catalog names the teacher who was filmed');
    assert.equal(lesson.seconds, entry.seconds);
    assert.equal(lesson.poster, `/api/education/prep-media/${id}.jpg`);
    assert.ok(fs.statSync(path.join(MEDIA, `${id}.jpg`)).size > 10000, 'a poster exists');
  });

  test(`${id}: captions and transcript say the script's words`, () => {
    const script = describe(id).beats.flatMap((b) => spokenWords(b.say));
    const cues = fs.readFileSync(path.join(MEDIA, `${id}.vtt`), 'utf8').split('\n\n').slice(1).filter(Boolean);
    assert.ok(cues.length >= 20, `${cues.length} cues`);
    let last = 0;
    const stamp = (s) => { const [h, m, r] = s.split(':'); return Number(h) * 3600 + Number(m) * 60 + Number(r); };
    for (const cue of cues) {
      const [times] = cue.split('\n');
      const [from, to] = times.split(' --> ').map(stamp);
      assert.ok(from >= last - 0.001 && to > from, `cue order at ${times}`);
      last = from;
    }
    assert.deepEqual(cues.map((c) => c.split('\n').slice(1).join(' ')).join(' ').split(/\s+/).filter(Boolean), script);
    assert.deepEqual(lesson.transcript.map((c) => c.text).join(' ').split(/\s+/), script);
  });
}
