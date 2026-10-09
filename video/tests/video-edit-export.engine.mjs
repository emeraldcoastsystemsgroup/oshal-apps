/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Runs INSIDE the runtime image (started by video-edit-export.test.mjs): the compiled export runner drives the image's real FFmpeg over real synthesized clips, and the result is DECODED and measured - exact frame count, segment order and source offsets by colour, the aspect-preserving fit, the title only on its frames, clip audio only under its clip with the bed under everything - then cancellation, timeout, revocation, a lost compare-and-set and a missing encoder each leave no output, no work directory and no FFmpeg process behind. The job row store is an in-memory double: the database boundary is proved separately against PostgreSQL.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const logs = [];
const original = Module._load;
Module._load = function load(request, parent, main) {
  if (request === '@/shared/logger') return { createChildLogger: () => Object.fromEntries(['debug', 'info', 'warn', 'error'].map(level => [level, (fields, message) => logs.push({ level, fields, message })])) };
  return original.call(this, request, parent, main);
};
const { ExportRunner } = require('../routes/video-edit-export-jobs.js');
const { inspectUpload, probeWithFfprobe } = require('../routes/video-editor-media.js');
Module._load = original;
const model = await import(pathToFileURL(join(process.cwd(), 'tools/editor/timeline-model.mjs')).href);

const work = mkdtempSync(join(tmpdir(), 'video-edit-export-'));
const workRoot = join(work, 'jobs'), outputs = join(work, 'out');
const OWNER = { issuer: 'https://video-identity.fixture.test', sub: 'alice' };
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { cwd: work, timeout: 120000 });
const h264 = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-r', '30'];

/** In-memory job rows with the same compare-and-set rules as the PostgreSQL store. */
function memoryStore(overrides = {}) {
  const rows = new Map();
  return { rows,
    add(id) { rows.set(id, { status: 'queued', cancelRequested: false }); },
    async markExportRunning(_owner, id) { const row = rows.get(id); if (row?.status !== 'queued' || row.cancelRequested) return false; row.status = 'running'; return true; },
    async finishExport(_owner, id, _epoch, outcome) {
      if (overrides.refuseSuccess && outcome.status === 'succeeded') { this.refused = (this.refused ?? 0) + 1; return false; }
      const row = rows.get(id); if (!row || !['queued', 'running'].includes(row.status)) return false;
      Object.assign(row, outcome); return true;
    } };
}
function ffmpegProcesses() {
  return readdirSync('/proc').filter(name => /^\d+$/.test(name)).filter(pid => {
    try { return readFileSync(`/proc/${pid}/cmdline`, 'latin1').split('\0')[0].endsWith('ffmpeg'); } catch { return false; }
  }).length;
}
/** Wait until the row settled AND the runner released the job (its work directory is removed in the job's own finally). */
async function settle(store, id, runner, timeoutMs = 150000) {
  const deadline = Date.now() + timeoutMs;
  while (['queued', 'running'].includes(store.rows.get(id).status) || runner.holds(OWNER)) {
    assert.ok(Date.now() < deadline, `job ${id} did not settle`); await new Promise(done => setTimeout(done, 100));
  }
  return store.rows.get(id);
}
function rgbAt(file, seconds, width = 32, height = 18) {
  return execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(seconds), '-i', file, '-frames:v', '1', '-vf', `scale=${width}:${height}`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 16 * 1024 * 1024 });
}
function pixel(buffer, x, y, width = 32) { const at = (y * width + x) * 3; return [buffer[at], buffer[at + 1], buffer[at + 2]]; }
function goertzel(samples, frequency, rate = 48000) {
  const k = 2 * Math.cos((2 * Math.PI * frequency) / rate); let a = 0, b = 0;
  for (const sample of samples) { const next = sample + k * a - b; b = a; a = next; }
  return Math.sqrt(a * a + b * b - k * a * b) / samples.length;
}

let clipA, clipB, bed, document;
test.before(async () => {
  ffmpeg('-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=30:d=0.5', '-f', 'lavfi', '-i', 'color=c=green:s=320x180:r=30:d=1',
    '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=1.5', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
    '-map', '[v]', '-map', '2:a', ...h264, '-c:a', 'aac', 'a.mp4');
  ffmpeg('-f', 'lavfi', '-i', 'color=c=blue:s=180x320:r=30:d=1', ...h264, 'b.mp4');
  ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=5', '-c:a', 'pcm_s16le', 'bed.wav');
  clipA = await inspectUpload(join(work, 'a.mp4'), 'video', probeWithFfprobe);
  clipB = await inspectUpload(join(work, 'b.mp4'), 'video', probeWithFfprobe);
  bed = await inspectUpload(join(work, 'bed.wav'), 'audio', probeWithFfprobe);
  const source = (media, name) => media.kind === 'video'
    ? { kind: 'video', asset: media.id, name, frames: media.frames, width: media.width, height: media.height, audio: media.hasAudio }
    : { kind: 'audio', asset: media.id, name, frames: media.frames };
  let timeline = model.createTimeline('Engine edit');
  timeline = model.addSource(timeline, source(clipA, 'A')).document;
  timeline = model.addSource(timeline, source(clipB, 'B')).document;
  timeline = model.addSource(timeline, source(bed, 'Bed')).document;
  timeline = model.appendSegment(timeline, 'v2', { in: 0, out: 30 });
  timeline = model.appendSegment(timeline, 'v1', { in: 15, out: 45 });
  timeline = model.appendSegment(timeline, 'v1', { in: 0, out: 15 });
  timeline = model.addTitle(timeline, { text: 'HELLO', start: 0, end: 15, position: 'center', size: 'large' }).document;
  document = model.setAudioBed(timeline, 'm1', 50);
});

const media = () => ({ v1: join(work, 'a.mp4'), v2: join(work, 'b.mp4'), m1: join(work, 'bed.wav') });
function job(store, id, overrides = {}) {
  store.add(id);
  return { id, owner: OWNER, authorize: overrides.authorize ?? (async () => undefined),
    prepare: async () => ({ document: overrides.document ?? document, media: media(), variant: overrides.variant ?? 'export', outputFile: join(outputs, `${id}.mp4`) }) };
}

test('a real export decodes to exactly the edit: frames, order, offsets, fit, title and audio', async () => {
  assert.deepEqual([clipA.frames, clipB.frames, clipA.hasAudio, clipB.hasAudio, bed.frames], [45, 30, true, false, 150]);
  const store = memoryStore(), runner = new ExportRunner({ store, workRoot });
  runner.admit(job(store, 'export-real'));
  const row = await settle(store, 'export-real', runner);
  assert.equal(row.status, 'succeeded', JSON.stringify(row));
  const file = join(outputs, 'export-real.mp4');
  assert.equal(row.output.frames, 75);
  assert.ok(Math.abs(row.output.durationMs - 2500) <= 67, String(row.output.durationMs));
  assert.equal(row.output.sha256, createHash('sha256').update(readFileSync(file)).digest('hex'));
  const blue = rgbAt(file, 0.8), green = rgbAt(file, 1.5), red = rgbAt(file, 2.2);
  const dominant = ([r, g, b]) => (r > 150 && g < 80 && b < 80 ? 'red' : g > 90 && r < 80 && b < 80 ? 'green' : b > 150 && r < 80 && g < 80 ? 'blue' : 'other');
  assert.deepEqual([dominant(pixel(blue, 16, 9)), dominant(pixel(green, 16, 9)), dominant(pixel(red, 16, 9))], ['blue', 'green', 'red'],
    'B first, then A from its 16th frame, then A from its first frame');
  assert.ok(pixel(blue, 1, 9).every(channel => channel < 30), 'the portrait clip is fitted with black pillar bars, not stretched');
  const white = buffer => { let count = 0; for (let i = 0; i < buffer.length; i += 3) if (buffer[i] > 200 && buffer[i + 1] > 200 && buffer[i + 2] > 200) count += 1; return count; };
  assert.ok(white(rgbAt(file, 0.2, 320, 180)) > 40, 'the title is burned on its frames');
  assert.equal(white(rgbAt(file, 0.8, 320, 180)), 0, 'and absent after them');
  const pcm = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024 });
  const samples = Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2));
  const window = (from, to) => samples.slice(Math.round(from * 48000), Math.round(to * 48000));
  const silentClip = window(0.1, 0.9), toneClip = window(1.1, 1.9);
  assert.ok(goertzel(toneClip, 880) > 10 * goertzel(silentClip, 880), 'clip A sound plays only under clip A');
  assert.ok(goertzel(silentClip, 220) > 50 && goertzel(toneClip, 220) > 50, 'the bed plays under everything');
  assert.deepEqual(readdirSync(workRoot), [], 'the private work directory is gone');
});

test('cancel, timeout, revocation and a lost compare-and-set leave no output, work directory or FFmpeg process', async () => {
  ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=30', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30', ...h264, '-c:a', 'aac', '-shortest', 'long.mp4');
  const long = await inspectUpload(join(work, 'long.mp4'), 'video', probeWithFfprobe);
  let heavy = model.addSource(model.createTimeline('Heavy'), { kind: 'video', asset: long.id, name: 'Long', frames: long.frames, width: long.width, height: long.height, audio: true }).document;
  heavy = model.appendSegment(model.appendSegment(heavy, 'v1'), 'v1');
  const heavyJob = (store, id, extra = {}) => ({ ...job(store, id, { document: heavy, ...extra }), prepare: async () => ({ document: heavy, media: { v1: join(work, 'long.mp4') }, variant: 'export', outputFile: join(outputs, `${id}.mp4`) }) });

  const cancelled = memoryStore(), runner = new ExportRunner({ store: cancelled, workRoot });
  runner.admit(heavyJob(cancelled, 'export-cancel'));
  const started = Date.now();
  while (!(runner.progress('export-cancel') > 0)) { assert.ok(Date.now() - started < 60000, 'encode never reported progress'); await new Promise(done => setTimeout(done, 50)); }
  assert.equal(runner.cancel('export-cancel'), true);
  assert.equal((await settle(cancelled, 'export-cancel', runner)).status, 'cancelled');
  assert.ok(Date.now() - started < 60000, 'cancellation ended the encode early');

  const timed = memoryStore(), timeoutRunner = new ExportRunner({ store: timed, workRoot, limits: { wallMs: 400 } });
  timeoutRunner.admit(heavyJob(timed, 'export-timeout'));
  assert.deepEqual([(await settle(timed, 'export-timeout', timeoutRunner)).status, timed.rows.get('export-timeout').error], ['failed', 'video_edit_export_timeout']);

  let allowed = true;
  const revoked = memoryStore(), revokeRunner = new ExportRunner({ store: revoked, workRoot, limits: { recheckMs: 150 } });
  revokeRunner.admit(heavyJob(revoked, 'export-revoked', { authorize: async () => { if (!allowed) throw new Error('revoked'); } }));
  while (!(revokeRunner.progress('export-revoked') > 0)) await new Promise(done => setTimeout(done, 50));
  allowed = false;
  assert.deepEqual([(await settle(revoked, 'export-revoked', revokeRunner)).status, revoked.rows.get('export-revoked').error], ['failed', 'video_edit_permission_revoked']);

  const stale = memoryStore({ refuseSuccess: true }), staleRunner = new ExportRunner({ store: stale, workRoot });
  staleRunner.admit(job(stale, 'export-stale'));
  const deadline = Date.now() + 120000;
  while (staleRunner.holds(OWNER)) { assert.ok(Date.now() < deadline, 'the stale job never finished'); await new Promise(done => setTimeout(done, 100)); }
  assert.equal(stale.refused, 1, 'the encode completed and tried to record its success once');
  assert.equal(stale.rows.get('export-stale').status, 'running', 'the lost compare-and-set recorded nothing');

  for (const id of ['export-cancel', 'export-timeout', 'export-revoked', 'export-stale']) assert.equal(existsSync(join(outputs, `${id}.mp4`)), false, id);
  assert.deepEqual(readdirSync(workRoot), []);
  assert.equal(ffmpegProcesses(), 0, 'no FFmpeg child outlives its job');
});

test('an encoder that cannot start fails the job honestly and cleans up', async () => {
  const previous = process.env.FFMPEG_PATH;
  process.env.FFMPEG_PATH = '/nonexistent/ffmpeg';
  try {
    const store = memoryStore(), runner = new ExportRunner({ store, workRoot });
    runner.admit(job(store, 'export-missing'));
    const row = await settle(store, 'export-missing', runner);
    assert.deepEqual([row.status, row.error], ['failed', 'video_edit_encoder_unavailable']);
  } finally { if (previous === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = previous; }
  assert.deepEqual(readdirSync(workRoot), []);
});
