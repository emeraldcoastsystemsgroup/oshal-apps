/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 2.20.14: comprehensive Meeting Recap tests — isoluminant RGB vs greyscale scene detection, camera-strip privacy crop, 16 kHz mono WAV extraction, local-only STT chunking, text-only Stage 6 boundary, full 7-stage chunked route flow, valid chart-free review.pptx, ADR-108 save, two-owner 404 isolation, read-only GET admission, and DELETE cleanup.
 */
import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  detectSceneChanges,
  extractAudioWav,
  extractCroppedKeyframe,
  meanAbsDiffLuma,
  meanAbsDiffRgb,
  probeMediaInfo,
  resolveBinary,
} from '../routes/meeting-recap/recap-media.mjs';
import {
  buildSummaryPrompt,
  repairCoverage,
} from '../routes/meeting-recap/recap-pipeline.mjs';
import {
  parseTranscriptInput,
  sliceWavIntoChunks,
  transcribeLocalWav,
} from '../routes/meeting-recap/recap-transcribe.mjs';
import { jobDirectoryPath } from '../routes/meeting-recap/recap-store.mjs';

const execFile = promisify(execFileCb);
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');
const STORE_ROOT = path.resolve(APP_ROOT, '..');

function resolveDep(name) {
  const bases = [
    process.env.STORE_CI_TOOLCHAIN && path.join(path.resolve(process.env.STORE_CI_TOOLCHAIN), 'package.json'),
    path.join(STORE_ROOT, 'scripts', 'toolchain', 'package.json'),
    process.env.OSHAL_FRAMEWORK && path.join(path.resolve(process.env.OSHAL_FRAMEWORK), 'package.json'),
    import.meta.url,
  ].filter(Boolean);
  for (const base of bases) {
    try { return createRequire(base)(name); } catch { /* continue */ }
  }
  throw new Error(`Missing test dependency: ${name}`);
}

/** Generate a real 6s 640x360 .mp4 with two isoluminant colour-only slides + right-side yellow camera strip + audio. */
async function buildIsoluminantMp4(outPath) {
  // Green (0,170,0) Y≈100 and Magenta (242,0,242) Y≈100 have nearly identical BT.601 luma,
  // while right 22% (x=500..640) carries a bright yellow (#FFFF00) simulated participant camera tile.
  const filter = [
    'color=c=0x00AA00:s=500x360:d=3:r=10[g]',
    'color=c=0xF200F2:s=500x360:d=3:r=10[m]',
    '[g][m]concat=n=2:v=1:a=0[slides]',
    'color=c=0xFFFF00:s=140x360:d=6:r=10[cam]',
    '[slides][cam]hstack=inputs=2[v]',
    'sine=frequency=440:sample_rate=44100:duration=6[a]',
  ].join(';');
  await execFile(resolveBinary('ffmpeg'), [
    '-y', '-v', 'error',
    '-filter_complex', filter,
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k',
    outPath,
  ], { timeout: 60000 });
  return outPath;
}

/** Render a real PPTX archive honoring #image: data URIs with pptxgenjs (zero chart parts). */
async function renderRealPptx(title, sections, opts = {}) {
  const PptxGen = resolveDep('pptxgenjs');
  const pptx = new PptxGen();
  const cover = pptx.addSlide();
  cover.addText(title, { x: 0.5, y: 1.0, w: 9, h: 1 });
  if (opts.subtitle) cover.addText(opts.subtitle, { x: 0.5, y: 2.2, w: 9, h: 0.6 });
  for (const sec of sections) {
    const slide = pptx.addSlide();
    slide.addText(sec.title || '', { x: 0.5, y: 0.4, w: 9, h: 0.6 });
    const lines = String(sec.content || '').split('\n');
    const imgLine = lines.find((l) => /^#image:\s*data:image\/png;base64,/i.test(l));
    const textLines = lines.filter((l) => !/^#(layout|image|caption):/i.test(l)).join('\n');
    if (textLines) slide.addText(textLines, { x: 0.5, y: 1.2, w: imgLine ? 4.8 : 9, h: 3.8 });
    if (imgLine) {
      const dataUri = imgLine.replace(/^#image:\s*/i, '').trim();
      slide.addImage({ data: dataUri, x: 5.5, y: 1.2, w: 4.0, h: 2.8 });
    }
    if (sec.notes) slide.addNotes(sec.notes);
  }
  const out = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

/** Create in-memory SQL pool that enforces read-only checks on reader mode. */
function makeRecapPool() {
  const rows = new Map();
  const savedDecks = [];
  let mode = 'writer';
  const mutations = [];
  const pool = {
    rows,
    savedDecks,
    setMode(next) { mode = next; mutations.length = 0; },
    getMutations() { return [...mutations]; },
    async query(sql, params = []) {
      const text = String(sql).trim();
      if (/^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(text) && mode === 'reader') {
        mutations.push(text);
        throw new Error('refused: SQL mutation under reader admission');
      }
      if (/^INSERT INTO oshal_presentation_recaps/i.test(text)) {
        const now = new Date().toISOString();
        rows.set(params[0], {
          id: params[0], owner_sub: params[1], title: params[2], source_filename: params[3],
          source_sha256: params[4], source_bytes: Number(params[5] || 0), duration_seconds: null,
          status: params[6], stage_message: params[7], minutes_processed: 0, total_minutes: 0,
          keyframes_count: 0, crop_mode: params[8], sample_interval_sec: Number(params[9]),
          theme: params[10], saved_deck_path: null, saved_deck_open_url: null,
          error_code: null, error_message: null, meta_json: params[11], created_at: now, updated_at: now,
        });
        return { rows: [], rowCount: 1 };
      }
      if (/^SELECT[\s\S]*FROM oshal_presentation_recaps[\s\S]*WHERE owner_sub = \$1 AND id = \$2/i.test(text)) {
        const r = rows.get(params[1]);
        return { rows: r && r.owner_sub === params[0] ? [r] : [], rowCount: r && r.owner_sub === params[0] ? 1 : 0 };
      }
      if (/^SELECT[\s\S]*FROM oshal_presentation_recaps[\s\S]*WHERE owner_sub = \$1/i.test(text)) {
        const list = [...rows.values()].filter((r) => r.owner_sub === params[0]);
        return { rows: list, rowCount: list.length };
      }
      if (/^UPDATE oshal_presentation_recaps SET/i.test(text)) {
        const r = rows.get(params[1]);
        if (!r || r.owner_sub !== params[0]) return { rows: [], rowCount: 0 };
        const setPart = text.match(/SET([\s\S]*)WHERE/i)[1];
        for (const assign of setPart.split(',').map((s) => s.trim())) {
          const m = /^(\w+)\s*=\s*\$(\d+)$/.exec(assign);
          if (m) r[m[1]] = params[Number(m[2]) - 1];
        }
        r.updated_at = new Date().toISOString();
        return { rows: [r], rowCount: 1 };
      }
      if (/^DELETE FROM oshal_presentation_recaps WHERE owner_sub = \$1 AND id = \$2/i.test(text)) {
        const r = rows.get(params[1]);
        if (!r || r.owner_sub !== params[0]) return { rows: [], rowCount: 0 };
        rows.delete(params[1]);
        return { rows: [], rowCount: 1 };
      }
      if (/^INSERT INTO oshal_presentations/i.test(text)) {
        savedDecks.push({ user_sub: params[0], title: params[1], file_name: params[2], provider: params[3], slides: params[6], format: params[9] });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL in test harness: ${text}`);
    },
  };
  return pool;
}

/** Create lightweight Express router recorder + invoker. */
function makeRouterHarness() {
  const routes = new Map();
  const reg = (m) => (p, ...fns) => routes.set(`${m} ${p}`, fns.at(-1));
  const router = { routes, get: reg('GET'), post: reg('POST'), delete: reg('DELETE'), use() {} };
  const pass = () => (_q, _s, next) => next?.();
  return {
    express: { Router: () => router, json: pass, raw: pass },
    async call(method, routePath, { params = {}, query = {}, body = {}, headers = {} } = {}) {
      const handler = routes.get(`${method} ${routePath}`);
      assert.ok(handler, `Route not registered: ${method} ${routePath}`);
      const out = { status: 200, headers: {}, body: null, raw: null, file: null };
      const res = {
        headersSent: false,
        setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
        status(c) { out.status = c; return res; },
        json(b) { out.body = b; res.headersSent = true; return res; },
        send(b) { out.raw = b; res.headersSent = true; return res; },
        sendFile(f) { out.file = f; res.headersSent = true; return res; },
      };
      await handler({ params, query, body, headers }, res);
      return out;
    },
  };
}

test('RGB colour-space scene detection catches isoluminant colour-only slide changes missed by greyscale + crops right camera strip', async (t) => {
  const greenFrame = new Uint8Array(160 * 90 * 3);
  const magentaFrame = new Uint8Array(160 * 90 * 3);
  for (let i = 0; i < greenFrame.length; i += 3) {
    greenFrame[i] = 0; greenFrame[i + 1] = 170; greenFrame[i + 2] = 0;
    magentaFrame[i] = 242; magentaFrame[i + 1] = 0; magentaFrame[i + 2] = 242;
  }
  assert.equal(meanAbsDiffLuma(greenFrame, magentaFrame), 0, 'greyscale luma MAD is 0 on isoluminant green vs magenta');
  assert.ok(meanAbsDiffRgb(greenFrame, magentaFrame) > 150, 'RGB colour-space MAD >> 6.0 on isoluminant slides');

  const workDir = mkdtempSync(path.join(tmpdir(), 'recap-media-test-'));
  t.after(() => rmSync(workDir, { recursive: true, force: true }));
  const mp4 = await buildIsoluminantMp4(path.join(workDir, 'isoluminant.mp4'));

  const wavPath = path.join(workDir, 'audio.wav');
  await extractAudioWav(mp4, wavPath);
  const wavBuf = readFileSync(wavPath);
  assert.equal(wavBuf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wavBuf.readUInt16LE(22), 1, 'mono channel');
  assert.equal(wavBuf.readUInt32LE(24), 16000, '16 kHz sample rate');

  const detected = await detectSceneChanges(mp4, { durationSec: 6, sampleIntervalSec: 2, threshold: 6.0 });
  assert.ok(detected.keyframes.length >= 2, `expected >= 2 keyframes on colour-only slide transition, got ${JSON.stringify(detected)}`);
  assert.equal(detected.keyframes[0].timestampSec, 0);
  assert.ok(detected.keyframes[1].score > 6.0);

  const croppedPng = path.join(workDir, 'cropped.png');
  await extractCroppedKeyframe(mp4, 0, croppedPng, 'right-strip');
  const croppedProbe = await probeMediaInfo(croppedPng);
  assert.equal(croppedProbe.width, 498, 'right 22% camera strip cropped from 640px source');
  const { stdout: rawRgb } = await execFile(resolveBinary('ffmpeg'), [
    '-v', 'error', '-i', croppedPng, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ], { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 });
  let yellowPixels = 0;
  for (let i = 0; i < rawRgb.length; i += 3) {
    if (rawRgb[i] > 200 && rawRgb[i + 1] > 200 && rawRgb[i + 2] < 60) yellowPixels += 1;
  }
  assert.equal(yellowPixels, 0, 'privacy crop removed all yellow camera-strip pixels');
});

test('local-only transcription chunks WAV <= 90s, offsets timestamps, makes zero outbound fetch calls, and fails cleanly when unconfigured', async (t) => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'recap-stt-test-'));
  t.after(() => rmSync(workDir, { recursive: true, force: true }));
  const wavPath = path.join(workDir, 'long.wav');
  await execFile(resolveBinary('ffmpeg'), [
    '-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=16000:duration=105',
    '-ac', '1', '-ar', '16000', '-f', 'wav', wavPath,
  ], { timeout: 30000 });

  const sliced = await sliceWavIntoChunks(wavPath, 90);
  assert.equal(sliced.chunks.length, 2, '105s WAV splits into 90s + 15s chunks');
  assert.ok(sliced.chunks.every((c) => c.buffer.length < 4 * 1024 * 1024), 'every WAV chunk fits below 4 MiB VoiceExecutor cap');

  const origFetch = globalThis.fetch;
  let outboundCalls = 0;
  globalThis.fetch = async () => { outboundCalls += 1; throw new Error('Outbound network forbidden in Stage 3'); };
  t.after(() => { globalThis.fetch = origFetch; });

  const calls = [];
  const progress = [];
  const fakeVoice = {
    async transcribeAudio(buf, mimeType, opts) {
      calls.push({ bytes: buf.length, mimeType, providerId: opts.providerId });
      return { segments: [{ startTime: 2, endTime: 5, text: `Chunk ${calls.length} spoken line` }] };
    },
  };
  const out = await transcribeLocalWav(wavPath, { voiceService: fakeVoice, onProgress: (p) => progress.push(p) });
  assert.equal(outboundCalls, 0, 'zero outbound HTTP calls during local transcription');
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.providerId === 'local-stt' && c.mimeType === 'audio/wav'));
  assert.equal(out.segments[0].startTime, 2);
  assert.equal(out.segments[1].startTime, 92, 'second chunk timestamp offset by +90s');
  assert.equal(progress.length, 2);

  await assert.rejects(
    () => transcribeLocalWav(wavPath, { voiceService: { transcribeAudio: async () => { throw new Error('stt unconfigured'); } } }),
    (err) => err?.code === 'local_stt_unavailable',
  );
});

test('Stage 6 prompt contains zero media bytes and repairCoverage preserves the recording tail', () => {
  const segs = parseTranscriptInput('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nOpening architecture review.\n\n00:04:50.000 --> 00:05:00.000\nFinal budget sign-off agreed.');
  const kfs = [{ id: 'kf-1', index: 1, timestampSec: 0, file: 'keyframe-1.png', label: 'Scene 1 at 00:00' }];
  const prompt = buildSummaryPrompt({ title: 'Board Review', durationSec: 300, segments: segs, keyframes: kfs });
  assert.doesNotMatch(prompt, /data:image|base64/i, 'Stage 6 prompt must never embed media bytes');
  assert.match(prompt, /Final budget sign-off agreed/);

  const repaired = repairCoverage(
    { overview: 'Short', sections: [{ title: 'Start', startSec: 0, endSec: 60, bullets: ['Intro'], quotes: [], keyframeIds: [] }] },
    { title: 'Board Review', durationSec: 300, segments: segs, keyframes: kfs },
  );
  assert.ok(repaired.sections.length >= 2, 'dropped tail repaired with closing section');
  assert.equal(repaired.sections.at(-1).endSec, 300);
  assert.ok(repaired.sections.every((s) => s.keyframeIds.length >= 1), 'every section carries >= 1 keyframe');
});

test('full 7-stage Meeting Recap route flow: chunked upload -> run -> artifacts -> chart-free PPTX -> save -> owner 404 -> read-only GET -> delete', async (t) => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'recap-data-test-'));
  const prevDataDir = process.env.OSHAL_PACKAGE_DATA_DIR;
  process.env.OSHAL_PACKAGE_DATA_DIR = dataDir;
  const harness = makeRouterHarness();
  const savedFiles = new Map();
  const pool = makeRecapPool();
  const actorState = { sub: 'alice' };

  const stubs = {
    express: harness.express,
    '@/features/presentation-generation': { renderPptx: renderRealPptx, isThemeId: (id) => ['executive', 'midnight'].includes(id) },
    '@/app/routes/storage-target': {
      saveContent: async (_ctx, _sub, _kind, name, buf) => {
        savedFiles.set(name, buf);
        return { provider: 'oshal-local', location: `oshal/a0000000-0000-0000-0000-000000000042/${name}`, downloadUrl: `/dl/${name}` };
      },
    },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => null },
    '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: '{}' }) },
  };
  const origLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return origLoad.call(this, request, parent, isMain);
  };
  t.after(() => {
    Module._load = origLoad;
    if (prevDataDir === undefined) delete process.env.OSHAL_PACKAGE_DATA_DIR;
    else process.env.OSHAL_PACKAGE_DATA_DIR = prevDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  const { createMeetingRecapRoutes } = await import(`../routes/meeting-recap-routes.mjs?t=${Date.now()}`);
  const ctx = {
    appPackageDir: APP_ROOT,
    pool,
    authorization: {
      registerResource() {},
      currentActor: () => ({ isActive: true, issuer: 'oshal-test', sub: actorState.sub, principalId: `p-${actorState.sub}`, tenantIds: ['t-1'] }),
      authorize: async () => ({ allowed: true }),
    },
  };
  createMeetingRecapRoutes(ctx);

  // Scope spoofing rejected with 400
  const spoof = await harness.call('GET', '/jobs', { query: { tenant: 'other' } });
  assert.equal(spoof.status, 400);

  // Build real isoluminant mp4 fixture & upload across 2 chunks
  const mp4Path = await buildIsoluminantMp4(path.join(dataDir, 'fixture.mp4'));
  const mp4Bytes = readFileSync(mp4Path);
  const mid = Math.floor(mp4Bytes.length / 2);
  const vtt = [
    'WEBVTT', '',
    '00:00:00.500 --> 00:00:02.500',
    'We decided to standardize on RGB scene detection.', '',
    '00:00:03.200 --> 00:00:05.500',
    'Action item: Alice will send the architecture summary by Friday.',
  ].join('\n');

  const initRes = await harness.call('POST', '/jobs', {
    body: { mode: 'chunked', title: 'Q4 Architecture Sync', sourceFilename: 'sync.mp4', cropMode: 'right-strip', sampleIntervalSec: 2, theme: 'executive' },
  });
  assert.equal(initRes.status, 201, JSON.stringify(initRes.body));
  const jobId = initRes.body.job.id;

  const ch1 = await harness.call('POST', '/jobs/:id/chunk', { params: { id: jobId }, body: mp4Bytes.subarray(0, mid), headers: { 'content-type': 'application/octet-stream' } });
  const ch2 = await harness.call('POST', '/jobs/:id/chunk', { params: { id: jobId }, body: mp4Bytes.subarray(mid), headers: { 'content-type': 'application/octet-stream' } });
  assert.equal(ch1.status, 200);
  assert.equal(ch2.status, 200);
  assert.equal(ch2.body.totalBytes, mp4Bytes.length);

  const runRes = await harness.call('POST', '/jobs/:id/run', {
    params: { id: jobId },
    body: { transcriptText: vtt, transcriptFormat: 'vtt', sampleIntervalSec: 2, cropMode: 'right-strip' },
  });
  assert.equal(runRes.status, 200, JSON.stringify(runRes.body));
  assert.equal(runRes.body.job.status, 'completed');
  assert.ok(runRes.body.job.keyframesCount >= 2, 'colour-only slide change captured >= 2 keyframes');

  // Strict read-only GET admission checks
  pool.setMode('reader');
  const listRes = await harness.call('GET', '/jobs');
  const getRes = await harness.call('GET', '/jobs/:id', { params: { id: jobId } });
  const tlRes = await harness.call('GET', '/jobs/:id/artifacts/:name', { params: { id: jobId, name: 'timeline.md' } });
  const sumRes = await harness.call('GET', '/jobs/:id/artifacts/:name', { params: { id: jobId, name: 'summary.md' } });
  const pptxRes = await harness.call('GET', '/jobs/:id/artifacts/:name', { params: { id: jobId, name: 'review.pptx' } });
  const kfRes = await harness.call('GET', '/jobs/:id/artifacts/:name', { params: { id: jobId, name: 'keyframe-1.png' } });
  const travRes = await harness.call('GET', '/jobs/:id/artifacts/:name', { params: { id: jobId, name: '../source.mp4' } });
  assert.deepEqual(pool.getMutations(), [], 'GET routes perform zero SQL writes');
  assert.equal(listRes.status, 200);
  assert.equal(getRes.status, 200);
  assert.equal(tlRes.status, 200);
  assert.equal(sumRes.status, 200);
  assert.equal(pptxRes.status, 200);
  assert.equal(kfRes.status, 200);
  assert.equal(travRes.status, 404, 'path traversal and raw source video rejected');

  const timelineMd = tlRes.raw.toString('utf8');
  const summaryMd = sumRes.raw.toString('utf8');
  assert.match(timelineMd, /!\[Scene 1 at 00:00\]\(keyframes\/keyframe-1\.png\)/);
  assert.match(timelineMd, /RGB scene detection/);
  assert.match(summaryMd, /## Decisions/);
  assert.match(summaryMd, /## Action Items/);
  assert.match(summaryMd, /\[00:00\]/);

  // Inspect real PPTX archive: valid slides + embedded PNG + ZERO chart parts
  const JSZip = resolveDep('jszip');
  const zip = await JSZip.loadAsync(pptxRes.raw);
  const fileEntries = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name);
  assert.ok(fileEntries.includes('ppt/slides/slide1.xml'), 'valid PPTX slide1.xml');
  assert.ok(fileEntries.some((e) => /^ppt\/media\/.+\.png$/i.test(e)), `embedded cropped PNG in PPTX (entries: ${fileEntries.filter((e) => e.startsWith('ppt/media/')).join(', ')})`);
  assert.equal(fileEntries.some((e) => e.startsWith('ppt/charts/')), false, 'ZERO chart parts in recap PPTX');

  // Explicit ADR-108 Save to Files
  pool.setMode('writer');
  const saveRes = await harness.call('POST', '/jobs/:id/save', { params: { id: jobId }, body: { includeNotes: true } });
  assert.equal(saveRes.status, 200, JSON.stringify(saveRes.body));
  assert.match(saveRes.body.openUrl, /^\/cockpit\/\?app=presentations&open=/);
  assert.equal(pool.savedDecks.length, 1);
  assert.ok(savedFiles.size >= 1);

  // Two-owner isolation: bob receives 404 on every endpoint
  actorState.sub = 'bob';
  assert.equal((await harness.call('GET', '/jobs/:id', { params: { id: jobId } })).status, 404);
  assert.equal((await harness.call('GET', '/jobs/:id/artifacts/:name', { params: { id: jobId, name: 'timeline.md' } })).status, 404);
  assert.equal((await harness.call('POST', '/jobs/:id/save', { params: { id: jobId } })).status, 404);
  assert.equal((await harness.call('DELETE', '/jobs/:id', { params: { id: jobId } })).status, 404);

  // Owner DELETE removes row and workspace directory on disk
  actorState.sub = 'alice';
  const wsDir = jobDirectoryPath('alice', jobId);
  assert.equal(existsSync(wsDir), true);
  const delRes = await harness.call('DELETE', '/jobs/:id', { params: { id: jobId } });
  assert.equal(delRes.status, 200);
  assert.equal(existsSync(wsDir), false, 'DELETE cleaned workspace on disk');
});
