/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Runs INSIDE the runtime image (started by video-editor-media.test.mjs, never on the host): FFmpeg synthesizes real clips and beds, and the compiled upload inspector probes them with the image's real ffprobe. Real H.264/AAC, silent H.264 and PCM WAV are accepted with measured metadata; another codec, a second audio track, an over-long or over-large clip, a mu-law bed, a truncated file and a playlist dressed as an MP4 are refused.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | CREATE-EDIT-05d: the committed acceptance clip (tests/fixtures/editor-acceptance-clip.mp4) is accepted by the real ffprobe with exactly the metadata the installed-box acceptance and its loopback proof expect.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { inspectUpload, probeWithFfprobe } = require('../routes/video-editor-media.js');
const work = mkdtempSync(join(tmpdir(), 'video-edit-media-'));
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { cwd: work, timeout: 60000 });
const tone = (seconds, frequency = 440) => ['-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000:duration=${seconds}`];
const picture = (seconds, size = '320x180', rate = 30) => ['-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${rate}:duration=${seconds}`];
const h264 = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'];

test.before(() => {
  ffmpeg(...picture(3), ...tone(3), ...h264, '-c:a', 'aac', '-shortest', 'clip.mp4');
  ffmpeg(...picture(2, '180x320', 25), ...h264, 'silent.mp4');
  ffmpeg(...tone(5), '-c:a', 'pcm_s16le', 'bed.wav');
  ffmpeg(...picture(2), '-c:v', 'mpeg4', 'mpeg4.mp4');
  ffmpeg(...picture(2), ...tone(2), ...tone(2, 880), ...h264, '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:a', 'aac', '-shortest', 'two-audio.mp4');
  ffmpeg(...picture(31, '64x36', 10), ...h264, 'long.mp4');
  ffmpeg(...picture(1, '2560x1440', 1), ...h264, 'large.mp4');
  ffmpeg(...tone(2), '-c:a', 'pcm_mulaw', 'mulaw.wav');
  ffmpeg(...tone(61, 220), '-c:a', 'pcm_s16le', '-ac', '1', '-ar', '8000', 'long.wav');
  const clip = readFileSync(join(work, 'clip.mp4'));
  writeFileSync(join(work, 'truncated.mp4'), clip.subarray(0, Math.floor(clip.length / 2)));
  writeFileSync(join(work, 'playlist.mp4'), Buffer.concat([Buffer.from('\0\0\0\x18ftypisom', 'latin1'),
    Buffer.from('#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nfile:/etc/hostname\n#EXT-X-ENDLIST\n')]));
});

test('the image has the FFmpeg the export profile needs', () => {
  const version = execFileSync('ffprobe', ['-version'], { encoding: 'utf8' }).split('\n')[0];
  assert.match(version, /^ffprobe version/);
});

test('a real H.264/AAC clip is accepted with its measured size, length and sound', async () => {
  const media = await inspectUpload(join(work, 'clip.mp4'), 'video', probeWithFfprobe);
  assert.deepEqual([media.kind, media.container, media.videoCodec, media.audioCodec, media.width, media.height, media.hasAudio, media.frames],
    ['video', 'mp4', 'h264', 'aac', 320, 180, true, 90]);
  assert.ok(Math.abs(media.durationMs - 3000) <= 50, String(media.durationMs));
  assert.equal(media.bytes, readFileSync(join(work, 'clip.mp4')).length);
});

test('a silent portrait clip and a PCM bed are accepted as what they are', async () => {
  const silent = await inspectUpload(join(work, 'silent.mp4'), 'video', probeWithFfprobe);
  assert.deepEqual([silent.width, silent.height, silent.hasAudio, silent.audioCodec, silent.frames], [180, 320, false, null, 60]);
  const bed = await inspectUpload(join(work, 'bed.wav'), 'audio', probeWithFfprobe);
  assert.deepEqual([bed.kind, bed.container, bed.audioCodec, bed.frames, bed.width], ['audio', 'wav', 'pcm_s16le', 150, null]);
});

test('real files outside the first-slice profile are refused, never trimmed or silently dropped', async () => {
  const cases = [['mpeg4.mp4', 'video', 'video_edit_media_unsupported'], ['two-audio.mp4', 'video', 'video_edit_media_unsupported'],
    ['long.mp4', 'video', 'video_edit_media_too_long'], ['large.mp4', 'video', 'video_edit_media_unsupported'],
    ['mulaw.wav', 'audio', 'video_edit_media_unsupported'], ['long.wav', 'audio', 'video_edit_media_too_long'],
    ['truncated.mp4', 'video', 'video_edit_media_unsupported'], ['playlist.mp4', 'video', 'video_edit_media_unsupported'],
    ['clip.mp4', 'audio', 'video_edit_media_unsupported'], ['bed.wav', 'video', 'video_edit_media_unsupported']];
  for (const [file, kind, code] of cases) {
    await assert.rejects(inspectUpload(join(work, file), kind, probeWithFfprobe), error => error.code === code, `${file} as ${kind}`);
  }
});

test('the committed acceptance clip is what the installed-box acceptance expects', async () => {
  const media = await inspectUpload(join(process.cwd(), 'tests', 'fixtures', 'editor-acceptance-clip.mp4'), 'video', probeWithFfprobe);
  assert.deepEqual([media.frames, media.width, media.height, media.hasAudio, media.videoCodec, media.audioCodec, media.durationMs], [30, 160, 90, true, 'h264', 'aac', 1000]);
});
