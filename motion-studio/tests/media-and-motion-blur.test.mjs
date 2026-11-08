/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | RP-MOT-01 & RP-MOT-02: verify video/audio uploads, trims, audio-level keyframes, mixed AAC MP4 export, motion blur rendering parity, and refusal cases.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { startApplicationFixture } from './application-fixture.mjs';
import { MotionProjectStore, LIMITS } from '../routes/project-store.mjs';
import { decodeRaster, ownedAssets } from '../routes/assets.mjs';
import { motionEngine } from '../routes/engine-client.mjs';
import { renderExportTo, RENDER_LIMITS } from '../routes/render-export.mjs';
import { parseNative } from '../tools/native-json.mjs';

const exec = promisify(execFile);
const raster = createRequire(join(process.env.MOTION_RASTER_DEPS || '/tmp/oshal-create-proof-ZFGNIA', 'package.json'));
const sharp = raster('sharp');
let fixture, scratchDir, videoBytes, audioBytes, sharedVideoAssetId;

function serviceCtx(sub = 'alice') {
  const actor = { issuer: 'motion-http-fixture', sub, isActive: true };
  const principal = { id: sub, tenant: 'fixture', issuer: 'motion-http-fixture', subject: sub, state: 'active' };
  return {
    ...fixture.ctx,
    intent: async (name, input) => name === 'auth.caller' ? { principal } : fixture.ctx.intent(name, input),
    authorization: {
      ...fixture.ctx.authorization,
      currentActor: () => actor,
      authorize: async ({ permission }) => ({ allowed: !fixture.state.denied.get(sub)?.has(permission) })
    }
  };
}

function serviceStore(sub = 'alice') {
  const ctx = serviceCtx(sub);
  let store;
  store = new MotionProjectStore(ctx, {
    decodeRaster,
    validateDocument: async (document, incoming) => (await motionEngine(ctx, { op: 'inspect', document, assets: incoming ?? await ownedAssets(document, store) })).document
  });
  return { ctx, store };
}

async function call(path, { user = 'alice', method = 'GET', body, status = 200 } = {}) {
  const response = await fetch(fixture.origin + '/api/motion-studio' + path, {
    method,
    headers: { 'x-fixture-user': user, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  assert.equal(response.status, status, text);
  return parseNative(text);
}

async function uploadMediaFile(bytes, type, filename, status = 200) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), filename);
  return call('/assets', { method: 'POST', body: form, status });
}

async function synthesizeTestMedia(dir) {
  const mp4Path = join(dir, 'sample.mp4'), wavPath = join(dir, 'sample.wav');
  await exec('ffmpeg', [
    '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x00ff00:s=160x90:r=30:d=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', '-b:a', '128k', '-shortest', mp4Path
  ]);
  await exec('ffmpeg', [
    '-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=1',
    '-ac', '2', '-c:a', 'pcm_s16le', wavPath
  ]);
  videoBytes = await readFile(mp4Path);
  audioBytes = await readFile(wavPath);
}

async function countPartialAlpha(pngBytes) {
  const { data, info } = await sharp(pngBytes).raw().toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let x = 0; x < info.width; x++) {
    const alpha = data[(45 * info.width + x) * info.channels + 3];
    if (alpha > 0 && alpha < 250) count++;
  }
  return count;
}

before(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), 'motion-media-blur-'));
  await synthesizeTestMedia(scratchDir);
  fixture = await startApplicationFixture();
});

after(async () => {
  await fixture?.close();
  if (scratchDir) await rm(scratchDir, { recursive: true, force: true });
});

test('RP-MOT-01: video and audio layers upload, trim, keyframe audio/levels, preview, and render H.264 + AAC MP4', async () => {
  const { asset: videoAsset } = await uploadMediaFile(videoBytes, 'video/mp4', 'clip.mp4');
  const { asset: audioAsset } = await uploadMediaFile(audioBytes, 'audio/wav', 'tone.wav');
  sharedVideoAssetId = videoAsset.id;
  assert.equal(videoAsset.kind, 'video');
  assert.equal(audioAsset.kind, 'audio');

  const { project } = await call('/projects', {
    method: 'POST', body: { title: 'AV Mix', width: 160, height: 90, frameRate: 30, duration: 2, requestKey: randomUUID() }
  });
  const edited = await call(`/projects/${project.id}/operations`, {
    method: 'POST',
    body: {
      baseRevision: 1, requestKey: randomUUID(),
      commands: [
        { command: 'asset.import', params: { assetId: videoAsset.id, name: 'Clip' } },
        { command: 'layer.timing', params: { layers: ['Clip'], in: 0.1, out: 0.9 } },
        { command: 'asset.import', params: { assetId: audioAsset.id, name: 'Score' } },
        { command: 'prop.addKey', params: { layer: 'Score', path: 'audio/levels', time: 0, value: [0, 0] } },
        { command: 'prop.addKey', params: { layer: 'Score', path: 'audio/levels', time: 1, value: [-12, -12] } }
      ]
    }
  });
  const compId = Object.values(edited.project.document.items).find(item => item.kind.type === 'Comp').id;
  const halfTicks = String(RENDER_LIMITS.ticksPerSecond / 2n), oneTicks = String(RENDER_LIMITS.ticksPerSecond);
  const audioWindow = await call(`/projects/${project.id}/revisions/2/audio/${compId}/0/${oneTicks}`);
  assert.ok(audioWindow.peaks.some(peak => peak > 0.05) && Buffer.from(audioWindow.wav, 'base64').subarray(0, 4).toString('ascii') === 'RIFF');

  const frameReply = await call(`/projects/${project.id}/revisions/2/preview-ticks/${halfTicks}/${compId}/160/0`);
  const { data: px, info } = await sharp(Buffer.from(frameReply.png, 'base64')).raw().toBuffer({ resolveWithObject: true });
  assert.ok(px[(45 * 160 + 80) * info.channels + 1] > 180, 'video frame decodes green stage pixels');

  const { ctx, store } = serviceStore('alice'), chunks = [], outMp4 = join(scratchDir, 'rendered-av.mp4');
  await renderExportTo(ctx, store, project.id, 2, { format: 'mp4', maxSide: 160, endTick: oneTicks }, async chunk => { chunks.push(Buffer.from(chunk)); });
  await writeFile(outMp4, Buffer.concat(chunks));
  const probe = JSON.parse((await exec('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', outMp4])).stdout);
  assert.ok(probe.streams.some(s => s.codec_type === 'video' && s.codec_name === 'h264'));
  assert.ok(probe.streams.some(s => s.codec_type === 'audio' && s.codec_name === 'aac'));
});

test('RP-MOT-01 refusals: corrupt media, oversized media, cross-actor reads, and deleting referenced media fail closed', async () => {
  const corruptBytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42'), Buffer.alloc(96, 0xde)]);
  await uploadMediaFile(corruptBytes, 'video/mp4', 'corrupt.mp4', 400);
  const { store } = serviceStore('alice');
  await assert.rejects(
    store.uploadMediaAsset({ bytes: Buffer.alloc(LIMITS.mediaBytes + 1, 1), probe: {} }),
    error => error.status === 413 && error.code === 'motion_media_limit'
  );
  assert.ok(sharedVideoAssetId);
  await call(`/assets/${sharedVideoAssetId}`, { user: 'bob', status: 404 });
  await call(`/assets/${sharedVideoAssetId}`, { user: 'bob', method: 'DELETE', status: 404 });
  await call(`/assets/${sharedVideoAssetId}`, { method: 'DELETE', status: 409 });
});

test('RP-MOT-02: composition and layer motion blur render directional streaks identically in preview and export', async () => {
  const { project } = await call('/projects', {
    method: 'POST', body: { title: 'Motion Blur Proof', width: 320, height: 90, frameRate: 30, duration: 1, requestKey: randomUUID() }
  });
  const animated = await call(`/projects/${project.id}/operations`, {
    method: 'POST',
    body: {
      baseRevision: 1, requestKey: randomUUID(),
      commands: [
        { command: 'layer.newSolid', params: { name: 'Mover', color: '#ffffff', width: 24, height: 24 } },
        { command: 'prop.addKey', params: { layer: 'Mover', path: 'transform/position', time: 0, value: [20, 45] } },
        { command: 'prop.addKey', params: { layer: 'Mover', path: 'transform/position', time: 1, value: [300, 45] } }
      ]
    }
  });
  const compId = Object.values(animated.project.document.items).find(item => item.kind.type === 'Comp').id;
  const midTicks = String(RENDER_LIMITS.ticksPerSecond / 2n);
  const sharpFrame = await call(`/projects/${project.id}/revisions/2/preview-ticks/${midTicks}/${compId}/320/1`);
  const sharpPartial = await countPartialAlpha(Buffer.from(sharpFrame.png, 'base64'));

  await call(`/projects/${project.id}/operations`, {
    method: 'POST',
    body: {
      baseRevision: 2, requestKey: randomUUID(),
      commands: [
        { command: 'comp.setSwitch', params: { switch: 'motionBlur', value: true } },
        { command: 'comp.settings', params: { shutterAngle: 360, shutterPhase: -180, motionBlurSamples: 16 } },
        { command: 'layer.setSwitch', params: { layers: ['Mover'], switch: 'motionBlur', value: true } }
      ]
    }
  });
  const blurFrame = await call(`/projects/${project.id}/revisions/3/preview-ticks/${midTicks}/${compId}/320/1`);
  const blurPng = Buffer.from(blurFrame.png, 'base64');
  assert.ok((await countPartialAlpha(blurPng)) > sharpPartial + 6, 'motion blur produces directional trail pixels');

  const { ctx, store } = serviceStore('alice'), tarChunks = [], tarPath = join(scratchDir, 'blur-frames.tar');
  const nextTick = String(RENDER_LIMITS.ticksPerSecond / 2n + RENDER_LIMITS.ticksPerSecond / 30n);
  await renderExportTo(ctx, store, project.id, 3, { format: 'png-sequence', maxSide: 320, startTick: midTicks, endTick: nextTick }, async c => { tarChunks.push(Buffer.from(c)); });
  await writeFile(tarPath, Buffer.concat(tarChunks));
  const exportedPng = (await exec('tar', ['-xOf', tarPath, 'frames/frame-000000000000.png'], { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 })).stdout;
  assert.equal(createHash('sha256').update(exportedPng).digest('hex'), createHash('sha256').update(blurPng).digest('hex'));

  for (const invalid of [{ shutterAngle: 900 }, { shutterPhase: 400 }, { motionBlurSamples: 1 }]) {
    await call(`/projects/${project.id}/operations`, {
      method: 'POST', body: { baseRevision: 3, requestKey: randomUUID(), commands: [{ command: 'comp.settings', params: invalid }] }, status: 400
    });
  }
  assert.equal((await call(`/projects/${project.id}`)).project.revision, 3);
});
