/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | End-to-end verification for Video 1.14.0 Reference-Product enhancements (RP-VID-01..10) using real FFmpeg/ffprobe speech synthesis, acoustic auto-caption detection, CC0 procedural sound library, 1080p60/4K multitrack export with speed/atempo/looks/chroma-key/remove-bg/stabilize/stickers, and headless Chromium UI.
 */
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { startPostgres, resetPostgres } from './video-editor-postgres.fixture.mjs';
import { actors, clipProbe, loadCompiled, mediaBytes, mediaForm, startApi, timeline } from './video-editor.fixture.mjs';
import { chromium, openEditor } from './video-editor-browser.fixture.mjs';
import { migrateMultitrack, applyMultitrack } from '../tools/editor/multitrack-model.mjs';
import { addSource } from '../tools/editor/timeline-model.mjs';

const execFileAsync = promisify(execFile);
const { mediaPath, probeWithFfprobe } = loadCompiled('video-editor-media.js');
const { compileTimeline } = loadCompiled('video-edit-compiler.js');
const FONT_FILE = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

let database, cleanup, browser, mediaDir, spokenMp4Bytes, silentMp4Bytes;

async function generateRealClips(dir) {
  const spokenPath = join(dir, 'spoken.mp4'), silentPath = join(dir, 'silent.mp4');
  await execFileAsync('/usr/bin/ffmpeg', [
    '-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i', 'color=c=0x00b140:s=320x180:r=30:d=2',
    '-f', 'lavfi', '-i', "flite=text='Welcome to our studio launch today':voice=slt",
    '-filter_complex', '[0:v]drawbox=x=110:y=40:w=100:h=100:color=0xf97316:t=fill[v];[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_dur=2,atrim=duration=2[a]',
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-frames:v', '60', '-c:a', 'aac', '-ar', '48000', '-ac', '2', spokenPath,
  ]);
  await execFileAsync('/usr/bin/ffmpeg', [
    '-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i', 'color=c=0x1e293b:s=320x180:r=30:d=2',
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000:d=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-frames:v', '60', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest', silentPath,
  ]);
  return { spoken: await readFile(spokenPath), silent: await readFile(silentPath) };
}

before(async () => {
  database = await startPostgres(cb => { cleanup = cb; });
  browser = await chromium.launch({ headless: true });
  mediaDir = await mkdtemp(join(tmpdir(), 'video-rp-clips-'));
  const clips = await generateRealClips(mediaDir);
  spokenMp4Bytes = clips.spoken; silentMp4Bytes = clips.silent;
});

after(async () => {
  await browser?.close();
  await cleanup?.();
  if (mediaDir) await rm(mediaDir, { recursive: true, force: true });
});

beforeEach(async () => { await resetPostgres(database.admin); });

test('RP-VID-02, RP-VID-07, RP-VID-10: real voice TTS, CC0 sound library and acoustic auto-captions (honest empty on silence)', async t => {
  const api = await startApi(t, database.pool, { prober: probeWithFfprobe, exports: { fontFile: FONT_FILE } });
  const lib = await api.call('/editor/sound-library');
  assert.equal(lib.status, 200);
  assert.equal(lib.body.items.length, 8);
  assert.ok(lib.body.items.every(item => item.license === 'CC0-1.0' && item.attribution === 'OSHAL-Procedural'));

  const preview = await api.call('/editor/sound-library/chime-ding/preview');
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('content-type'), 'audio/wav');
  assert.equal(preview.body.subarray(0, 4).toString('latin1'), 'RIFF');

  const importedSfx = await api.call('/editor/sound-library/whoosh-transition/import', 'POST', {});
  assert.equal(importedSfx.status, 201);
  assert.equal(importedSfx.body.item.license, 'CC0-1.0');
  assert.ok(importedSfx.body.media.frames >= 30);

  const voice = await api.call('/editor/voice', 'POST', { text: 'Hello everyone welcome to Video Studio', voice: 'slt' });
  assert.equal(voice.status, 201);
  assert.ok(voice.body.media.frames >= 20);

  const upSpoken = await api.call('/editor/media?kind=video', 'POST', mediaForm(spokenMp4Bytes, 'spoken.mp4'));
  const upSilent = await api.call('/editor/media?kind=video', 'POST', mediaForm(silentMp4Bytes, 'silent.mp4'));
  assert.equal(upSpoken.status, 201); assert.equal(upSilent.status, 201);

  const voiceDoc = migrateMultitrack(timeline('Voice test', {
    v1: { kind: 'video', asset: upSilent.body.media.id, name: 'Plate', frames: 60, width: 320, height: 180, audio: false },
    m1: { kind: 'audio', asset: voice.body.media.id, name: 'Narration', frames: voice.body.media.frames },
  }, [{ id: 's1', source: 'v1', in: 0, out: 60, volume: 0 }]));
  const voiceDocWithClip = applyMultitrack(voiceDoc, { type: 'addClip', track: 'audio1', source: 'm1', start: 0, in: 0, out: Math.min(60, voice.body.media.frames) });
  const voiceCaptions = await api.call('/editor/auto-captions', 'POST', { document: voiceDocWithClip });
  assert.equal(voiceCaptions.status, 200);
  assert.ok(voiceCaptions.body.cues.length >= 1);
  assert.match(voiceCaptions.body.cues.map(c => c.text).join(' '), /Hello/);

  const spokenDoc = timeline('Spoken test', {
    v1: { kind: 'video', asset: upSpoken.body.media.id, name: 'Presenter clip', frames: upSpoken.body.media.frames, width: 320, height: 180, audio: true },
  }, [{ id: 's1', source: 'v1', in: 0, out: upSpoken.body.media.frames, volume: 100 }]);
  const acousticCues = await api.call('/editor/auto-captions', 'POST', { document: spokenDoc });
  assert.equal(acousticCues.status, 200);
  assert.ok(acousticCues.body.cues.length >= 1, 'real voiced speech produces acoustic caption segments');

  const silentDoc = timeline('Silent test', {
    v1: { kind: 'video', asset: upSilent.body.media.id, name: 'Silent clip', frames: upSilent.body.media.frames, width: 320, height: 180, audio: true },
  }, [{ id: 's1', source: 'v1', in: 0, out: upSilent.body.media.frames, volume: 100 }]);
  const silentCues = await api.call('/editor/auto-captions', 'POST', { document: silentDoc });
  assert.equal(silentCues.status, 200);
  assert.deepEqual(silentCues.body.cues, [], 'silent audio honestly returns zero caption cues');
});

test('RP-VID-01, 03, 04, 05, 06, 08, 09: real FFmpeg 1080p60 multitrack export with speed+atempo, looks, chroma-key, remove-bg, stabilize & stickers', async t => {
  const api = await startApi(t, database.pool, { prober: probeWithFfprobe, exports: { fontFile: FONT_FILE } });
  const baseUp = await api.call('/editor/media?kind=video', 'POST', mediaForm(silentMp4Bytes, 'plate.mp4'));
  const fgUp = await api.call('/editor/media?kind=video', 'POST', mediaForm(spokenMp4Bytes, 'presenter.mp4'));
  const voice = await api.call('/editor/voice', 'POST', { text: 'Fast cut export verification', voice: 'rms' });
  const sfx = await api.call('/editor/sound-library/pop-accent/import', 'POST', {});

  const fgDiskPath = mediaPath(api.dataRoot, actors.alice, { id: fgUp.body.media.id, kind: 'video' });
  const beforeSha = createHash('sha256').update(await readFile(fgDiskPath)).digest('hex');

  let doc = migrateMultitrack({
    version: 1, name: 'RP Full Slice', profile: 'hd1080p60',
    sources: {
      v1: { kind: 'video', asset: baseUp.body.media.id, name: 'Plate', frames: baseUp.body.media.frames, width: 320, height: 180, audio: true },
      v2: { kind: 'video', asset: fgUp.body.media.id, name: 'Presenter', frames: fgUp.body.media.frames, width: 320, height: 180, audio: true },
      m1: { kind: 'audio', asset: voice.body.media.id, name: 'Voice', frames: voice.body.media.frames },
    },
    segments: [{ id: 's1', source: 'v1', in: 0, out: 60, volume: 80, speed: 200, look: { id: 'warm', strength: 85 }, stabilize: 'light' }],
    titles: [], audioBed: null,
  });
  const addedSfx = addSource(doc, { kind: 'audio', asset: sfx.body.media.id, name: 'Pop', frames: sfx.body.media.frames });
  doc = addedSfx.document;
  doc = applyMultitrack(doc, { type: 'addTrack', kind: 'video', name: 'Overlay Video' });
  const overlayTrackId = doc.tracks.find(tr => tr.name === 'Overlay Video').id;
  doc = applyMultitrack(doc, { type: 'addClip', track: overlayTrackId, source: 'v2', start: 0, in: 0, out: 60 });
  const overlayClipId = doc.tracks.find(tr => tr.id === overlayTrackId).clips[0].id;
  doc = applyMultitrack(doc, {
    type: 'clip', id: overlayClipId,
    patch: { speed: 200, chromaKey: { enabled: true, color: '#00b140', similarity: 38, blend: 12 }, removeBg: { enabled: true, strength: 60 } },
  });
  doc = applyMultitrack(doc, { type: 'addClip', track: 'audio1', source: 'm1', start: 0, in: 0, out: Math.min(30, voice.body.media.frames) });
  doc = applyMultitrack(doc, { type: 'addTrack', kind: 'audio', name: 'Audio 2' });
  doc = applyMultitrack(doc, { type: 'addClip', track: doc.tracks.at(-1).id, source: 'm2', start: 5, in: 0, out: Math.min(25, sfx.body.media.frames) });
  doc = applyMultitrack(doc, { type: 'setCaptions', cues: [{ id: 'c1', text: 'Fast cut export', start: 0, end: 25, position: 'bottom', size: 'small' }] });
  doc = applyMultitrack(doc, {
    type: 'addSticker',
    entry: { stickerId: 'star', start: 0, end: 30, x: 25, y: 25, scale: 100, keys: [{ frame: 0, x: 20, y: 25, scale: 100 }, { frame: 30, x: 75, y: 25, scale: 120 }] },
  });

  const uhdCompiled = compileTimeline({
    document: { ...doc, profile: 'uhd4k60' },
    media: { v1: '/tmp/a.mp4', v2: '/tmp/b.mp4', m1: '/tmp/c.wav', m2: '/tmp/d.wav' },
    variant: 'export', resolution: '4k', fps: 60, fontFile: FONT_FILE,
  });
  assert.equal(uhdCompiled.width, 3840); assert.equal(uhdCompiled.height, 2160); assert.equal(uhdCompiled.fps, 60);
  assert.match(uhdCompiled.filterGraph, /atempo=2\.000000/);
  assert.match(uhdCompiled.filterGraph, /colorkey=0x00B140/);
  assert.match(uhdCompiled.filterGraph, /deshake=rx=16:ry=16/);

  assert.match(uhdCompiled.filterGraph, /backgroundkey=/);
  const created = await api.call('/editor/projects', 'POST', { title: doc.name, document: doc });
  assert.equal(created.status, 201);
  const started = await api.call(`/editor/projects/${created.body.project.id}/exports`, 'POST', {
    revision: 1, variant: 'export', resolution: '1080p', fps: 60,
  });
  assert.equal(started.status, 202);
  assert.equal(started.body.export.totalFrames, 60, '30 timeline frames at 60 fps = 60 output frames');

  let finalExport = started.body.export;
  for (let i = 0; i < 80 && ['queued', 'running'].includes(finalExport.status); i += 1) {
    await new Promise(r => setTimeout(r, 250));
    finalExport = (await api.call(`/editor/exports/${started.body.export.id}`)).body.export;
  }
  assert.equal(finalExport.status, 'succeeded', `real FFmpeg export succeeded (error=${finalExport.error})`);
  assert.equal(finalExport.outputFrames, 60);
  const dl = await api.call(`/editor/exports/${started.body.export.id}/download`);
  assert.equal(dl.status, 200);
  const outPath = join(mediaDir, 'rendered-1080p60.mp4');
  await writeFile(outPath, dl.body);
  const { stdout: probeJson } = await execFileAsync('/usr/bin/ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', outPath]);
  const probed = JSON.parse(probeJson);
  const vStream = probed.streams.find(s => s.codec_type === 'video');
  assert.equal(vStream.width, 1920);
  assert.equal(vStream.height, 1080);
  assert.equal(vStream.avg_frame_rate, '60/1');
  const afterSha = createHash('sha256').update(await readFile(fgDiskPath)).digest('hex');
  assert.equal(afterSha, beforeSha, 'source clip file remains completely intact after removeBg and chromaKey export');
});

test('Chromium UI exercises Voice, Sound effects, Auto captions, Filters, Chroma key, Remove background, Stabilize and 1080p60 Export', async t => {
  const { page, encoder, errors } = await openEditor(t, browser, database, { viewport: { width: 1440, height: 900 }, theme: 'graphite' });
  await page.locator('#addClip').setInputFiles({ name: 'Studio.mp4', mimeType: 'video/mp4', buffer: mediaBytes('video', clipProbe({ seconds: 4, audio: false })) });
  await page.locator('#status').filter({ hasText: 'Studio.mp4 added.' }).waitFor();

  await page.locator('[data-ds-toolrow]').getByRole('button', { name: /Filters/ }).click();
  const filterSheet = page.locator('dialog.ds-layer[open][aria-label="Filters"]'); await filterSheet.waitFor();
  await filterSheet.locator('[data-look-pick="vivid"]').click();
  await page.goBack(); await filterSheet.waitFor({ state: 'detached' });
  assert.match(await page.locator('#viewer').evaluate(el => el.style.filter), /saturate/);

  await page.locator('#track .segment').first().click();
  const row = page.locator('[data-ds-toolrow]');
  await row.getByRole('button', { name: /Chroma key/ }).click();
  const ckSheet = page.locator('dialog.ds-layer[open][aria-label="Chroma key"]'); await ckSheet.waitFor();
  await ckSheet.getByRole('button', { name: 'Green screen' }).click();
  await page.goBack(); await ckSheet.waitFor({ state: 'detached' });
  assert.equal(await page.locator('#previewScreen').getAttribute('data-matte-backdrop'), '');

  await row.getByRole('button', { name: /Remove background/ }).click();
  const bgSheet = page.locator('dialog.ds-layer[open][aria-label="Remove background"]'); await bgSheet.waitFor();
  await bgSheet.locator('[data-removebg-enabled]').check();
  await page.goBack(); await bgSheet.waitFor({ state: 'detached' });

  await row.getByRole('button', { name: /Stabilize/ }).click();
  const stabSheet = page.locator('dialog.ds-layer[open][aria-label="Stabilize"]'); await stabSheet.waitFor();
  await stabSheet.locator('[data-stabilize-mode="standard"]').click();
  await page.goBack(); await stabSheet.waitFor({ state: 'detached' });
  assert.equal(await page.locator('#viewer').evaluate(el => el.style.transform), 'scale(1.08)');
  await row.getByRole('button', { name: /Done/ }).click();

  await row.getByRole('button', { name: /Audio/ }).click();
  await page.locator('[data-audio-voice]').click();
  const voiceSheet = page.locator('dialog.ds-layer[open][aria-label="Voice narration"]'); await voiceSheet.waitFor();
  await voiceSheet.locator('[data-voice-text]').fill('Welcome to our creative release');
  await voiceSheet.locator('[data-voice-submit]').click();
  await voiceSheet.locator('[data-voice-status]').filter({ hasText: 'Voice clip added' }).waitFor();
  await page.goBack(); await voiceSheet.waitFor({ state: 'detached' });

  await row.getByRole('button', { name: /Audio/ }).click();
  await page.locator('[data-audio-sfx]').click();
  const sfxSheet = page.locator('dialog.ds-layer[open][aria-label="Sound effects & music"]'); await sfxSheet.waitFor();
  await sfxSheet.locator('[data-sound-import="chime-ding"]').waitFor();
  await sfxSheet.locator('[data-sound-import="chime-ding"]').click();
  await sfxSheet.locator('.video-help').filter({ hasText: 'Added Bright Chime' }).waitFor();
  await page.goBack(); await sfxSheet.waitFor({ state: 'detached' });

  await row.getByRole('button', { name: /Text/ }).click();
  const textSheet = page.locator('dialog.ds-layer[open][aria-label="Text"]'); await textSheet.waitFor();
  await textSheet.locator('[data-auto-captions-run]').click();
  await textSheet.locator('[data-auto-captions-list] input').first().waitFor();
  await page.goBack(); await textSheet.waitFor({ state: 'detached' });

  await page.locator('button.video-export').click();
  const expSheet = page.locator('dialog.ds-layer[open][aria-label="Export"]'); await expSheet.waitFor();
  await expSheet.locator('[data-export-res="1080p"]').click();
  await expSheet.locator('[data-export-fps="60"]').click();
  await expSheet.locator('#exportMp4:not([disabled])').waitFor();
  await expSheet.locator('#exportMp4').click();
  await expSheet.locator('#downloadExport:not([hidden])').waitFor();
  assert.equal(encoder.calls.at(-1).fps, 60);
  assert.deepEqual(errors, []);
});
