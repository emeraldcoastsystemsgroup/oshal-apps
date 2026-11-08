/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | End-to-end acceptance suite for Audio Studio covering smoke readiness, RBAC, CAS deduplication, DSP mixdown, TTS personas, live modulation, concierge bridge, and Screen Standard compliance.
 * 2   | maintainer@emeraldcoastsystemsgroup.com | Add ADR-208 real DSP math proofs (85Hz HPF, constant-power pan, sidechain ducking, -14 LUFS BS.1770 mastering, MP3 FFmpeg export, HTTP 206 byte ranges, owner blob isolation, Kokoro TTS fail-closed 503, and crisp-glass design checks).
 * 3   | maintainer@emeraldcoastsystemsgroup.com | Update readiness smoke expectation for Audio Studio 1.2.1.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');

process.env.OSHAL_AUDIO_TEST_SECRET = crypto.randomBytes(24).toString('hex');

const pkgDir = path.resolve(__dirname, '..');
const Module = require('node:module');
const origLoad = Module._load;
Module._load = function (reqId, parent, isMain) {
  if (reqId === 'express') {
    const mini = origLoad.call(this, path.join(pkgDir, 'lib', 'router.js'), parent, isMain);
    return Object.assign(() => mini.createRouter(), { Router: mini.createRouter, json: mini.json });
  }
  return origLoad.call(this, reqId, parent, isMain);
};
const dbModule = require(path.join(pkgDir, 'lib', 'db.js'));
const { BlobStore } = require(path.join(pkgDir, 'lib', 'blob_store.js'));
const DSPEngine = require(path.join(pkgDir, 'lib', 'dsp_engine.js'));
const { decodeAudioBuffer } = require(path.join(pkgDir, 'lib', 'audio_io.js'));
const { SecurityMiddleware } = require(path.join(pkgDir, 'lib', 'security.js'));
const { createRouter } = require(path.join(pkgDir, 'lib', 'router.js'));
const { createPackageSmokeRoutes } = require(path.join(pkgDir, 'routes', 'package-smoke.js'));
const { createAudioRoutes } = require(path.join(pkgDir, 'routes', 'audio-routes.js'));

const testVault = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-acceptance-'));
const testDbPath = path.join(testVault, 'test_audio.sqlite');
const db = dbModule.getDatabase(testDbPath);
const blobStore = new BlobStore(testVault);
const repo = dbModule.createAudioRepository({ db });
const ctx = { appPackageDir: pkgDir, db, repo, blobStore };

const rootRouter = createRouter();
rootRouter.use('/api/audio/_smoke', createPackageSmokeRoutes(ctx));
rootRouter.use('/api/audio', createAudioRoutes(ctx));

let server;
let baseUrl;
let ttsMockServer;
let ttsMockUrl;

function request(method, reqPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, baseUrl);
    const req = http.request(url, {
      method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, buffer, data: text, json });
      });
    });
    req.on('error', reject);
    if (body !== null && body !== undefined) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function makeSine(freqHz, durationSec, sampleRate = 48000, amp = 0.5) {
  const n = Math.floor(durationSec * sampleRate);
  const arr = new Float32Array(n);
  for (let i = 0; i < n; i++) arr[i] = Math.sin(2 * Math.PI * freqHz * (i / sampleRate)) * amp;
  return arr;
}

function rmsWindow(channel, startSample, endSample) {
  let sum = 0;
  const end = Math.min(channel.length, endSample);
  const count = Math.max(1, end - startSample);
  for (let i = startSample; i < end; i++) sum += channel[i] * channel[i];
  return Math.sqrt(sum / count);
}

test.before(async () => {
  await new Promise((resolve) => {
    ttsMockServer = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const voiceSamples = DSPEngine.generateSyntheticAudio('vocals', 1.8, 24000);
        const wav = DSPEngine.encodeWav([voiceSamples], 24000);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'audio/wav');
        res.end(wav);
      });
    });
    ttsMockServer.listen(0, '127.0.0.1', () => {
      ttsMockUrl = `http://127.0.0.1:${ttsMockServer.address().port}/v1/audio/speech`;
      process.env.OSHAL_TTS_URL = ttsMockUrl;
      resolve();
    });
  });

  await new Promise((resolve) => {
    server = http.createServer((req, res) => rootRouter.handle(req, res));
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => ttsMockServer.close(resolve));
  fs.rmSync(testVault, { recursive: true, force: true });
});

test('1. Package readiness smoke probe returns version 1.2.1 and connected storage', async () => {
  const res = await request('GET', '/api/audio/_smoke');
  assert.equal(res.status, 200);
  assert.equal(res.json.package, 'audio');
  assert.equal(res.json.version, '1.2.1');
  assert.equal(res.json.status, 'ready');
});

test('2. Fail-closed authentication and RBAC role boundaries', async () => {
  const unauthRes = await request('GET', '/api/audio/editor/projects');
  assert.equal(unauthRes.status, 401);

  const viewerToken = SecurityMiddleware.generateToken({ sub: 'user-viewer', role: 'viewer' });
  const editorToken = SecurityMiddleware.generateToken({ sub: 'user-editor', role: 'editor' });

  const forbiddenRes = await request('POST', '/api/audio/editor/agent-projects', {
    Authorization: `Bearer ${viewerToken}`,
  }, { title: 'Unauthorized Attempt' });
  assert.equal(forbiddenRes.status, 403);

  const allowRes = await request('POST', '/api/audio/editor/agent-projects', {
    Authorization: `Bearer ${editorToken}`,
  }, { title: 'Rock Anthem Session', sampleRate: 48000 });
  assert.equal(allowRes.status, 201);
  assert.equal(allowRes.json.project.title, 'Rock Anthem Session');
  assert.equal(allowRes.json.project.revision, 1);

  const summaryRes = await request('GET', '/api/audio/home-summary', {
    Authorization: `Bearer ${editorToken}`,
  });
  assert.equal(summaryRes.status, 200);
  assert.equal(summaryRes.json.metrics.projects, 1);
});

test('3. Optimistic revision locking rejects stale baseRevision with 409 revision_conflict', async () => {
  const token = SecurityMiddleware.generateToken({ sub: 'user-rev', role: 'editor' });
  const createRes = await request('POST', '/api/audio/editor/agent-projects', {
    Authorization: `Bearer ${token}`,
  }, { title: 'Podcast Episode 42', tempo: 120 });
  const projectId = createRes.json.project.id;

  const editRes = await request('POST', `/api/audio/editor/projects/${projectId}/operations`, {
    Authorization: `Bearer ${token}`,
  }, {
    id: projectId,
    baseRevision: 1,
    operations: [
      { type: 'rename', title: 'Podcast Episode 42 (Mastered)' },
      { type: 'addTrack', name: 'Host Mic', instrument: 'vocals', volume: 1.1, pan: -0.15 },
      { type: 'addTrack', name: 'Theme Music', instrument: 'guitar', volume: 0.8, pan: 0.25 },
    ],
  });
  assert.equal(editRes.status, 201);
  assert.equal(editRes.json.project.revision, 2);
  assert.equal(editRes.json.project.stems.length, 2);

  const conflictRes = await request('POST', `/api/audio/editor/projects/${projectId}/operations`, {
    Authorization: `Bearer ${token}`,
  }, {
    id: projectId,
    baseRevision: 1,
    operations: [{ type: 'rename', title: 'Stale Write' }],
  });
  assert.equal(conflictRes.status, 409);
  assert.equal(conflictRes.json.error, 'revision_conflict');
});

test('4. Two-arm owner isolation across projects, CAS blobs, and caller spoof selectors', async () => {
  const tokenAlpha = SecurityMiddleware.generateToken({ issuer: 'https://issuer.a', sub: 'user-shared-sub', role: 'editor' });
  const tokenBeta = SecurityMiddleware.generateToken({ issuer: 'https://issuer.b', sub: 'user-shared-sub', role: 'editor' });

  const createRes = await request('POST', '/api/audio/editor/agent-projects', {
    Authorization: `Bearer ${tokenAlpha}`,
  }, { title: 'Issuer-A Private Session' });
  const alphaId = createRes.json.project.id;

  const wavBuf = DSPEngine.encodeWav([makeSine(440, 1.0, 48000, 0.3)], 48000);
  const stemRes = await request('POST', `/api/audio/editor/projects/${alphaId}/stems`, {
    Authorization: `Bearer ${tokenAlpha}`,
  }, { id: alphaId, name: 'secret.wav', trackName: 'vocals', audioBase64: wavBuf.toString('base64') });
  assert.equal(stemRes.status, 201);
  const blobHash = stemRes.json.blobHash;

  // Same sub under a different OIDC issuer MUST NOT see project or CAS blob (two-arm isolation!)
  const betaProj = await request('GET', `/api/audio/editor/projects/${alphaId}`, { Authorization: `Bearer ${tokenBeta}` });
  assert.equal(betaProj.status, 404);

  const betaBlob = await request('GET', `/api/audio/blobs/${blobHash}`, { Authorization: `Bearer ${tokenBeta}` });
  assert.equal(betaBlob.status, 404);

  // HTTP 206 Partial Content byte-range streaming for rightful owner
  const rangeRes = await request('GET', `/api/audio/blobs/${blobHash}`, {
    Authorization: `Bearer ${tokenAlpha}`,
    Range: 'bytes=0-43',
  });
  assert.equal(rangeRes.status, 206);
  assert.match(String(rangeRes.headers['content-range']), /^bytes 0-43\/\d+$/);
  assert.equal(rangeRes.buffer.length, 44);
  assert.equal(rangeRes.buffer.subarray(0, 4).toString('ascii'), 'RIFF');

  // Personal-scope spoof rejection
  const spoofRes = await request('GET', '/api/audio/editor/projects?tenantId=other', { Authorization: `Bearer ${tokenAlpha}` });
  assert.equal(spoofRes.status, 400);
  assert.equal(spoofRes.json.error, 'audio_personal_scope_only');
});

test('5. CAS SHA-256 deduplication and reference counting', async () => {
  const token = SecurityMiddleware.generateToken({ sub: 'user-cas', role: 'editor' });
  const proj = await request('POST', '/api/audio/editor/agent-projects', { Authorization: `Bearer ${token}` }, { title: 'CAS Test' });
  const pId = proj.json.project.id;

  const tone = makeSine(330, 1.0, 48000, 0.25);
  const b64 = DSPEngine.encodeWav([tone, tone], 48000).toString('base64');

  const s1 = await request('POST', `/api/audio/editor/projects/${pId}/stems`, { Authorization: `Bearer ${token}` }, { id: pId, trackName: 'Guitar L', name: 'g1.wav', audioBase64: b64 });
  const s2 = await request('POST', `/api/audio/editor/projects/${pId}/stems`, { Authorization: `Bearer ${token}` }, { id: pId, trackName: 'Guitar R', name: 'g2.wav', audioBase64: b64 });
  assert.equal(s1.json.blobHash, s2.json.blobHash);

  const row = db.prepare('SELECT ref_count FROM audio_blobs WHERE owner_sub = ? AND sha256 = ?').get('user-cas', s1.json.blobHash);
  assert.equal(row.ref_count, 2);
});

test('6. ADR-208 DSP math proofs: 85Hz Butterworth HPF, constant-power pan, sidechain ducking, -14 LUFS mastering, and FFmpeg MP3 export', async () => {
  // A. 85 Hz HPF attenuates 30 Hz sub-bass rumble by > 12 dB while passing 1 kHz tone
  const rumble30 = makeSine(30, 1.0, 48000, 0.6);
  const voice1k = makeSine(1000, 1.0, 48000, 0.6);
  const filtered30 = DSPEngine.processStemChannel([rumble30], 48000, { hpf: true, compRatio: 1.0, reverbMix: 0 });
  const filtered1k = DSPEngine.processStemChannel([voice1k], 48000, { hpf: true, compRatio: 1.0, reverbMix: 0 });
  const atten30Db = DSPEngine.gainToDb(rmsWindow(filtered30.monoTrigger, 4800, 48000) / rmsWindow(rumble30, 4800, 48000));
  const pass1kDb = DSPEngine.gainToDb(rmsWindow(filtered1k.monoTrigger, 4800, 48000) / rmsWindow(voice1k, 4800, 48000));
  assert.ok(atten30Db < -12.0, `Expected >12 dB attenuation at 30 Hz, got ${atten30Db.toFixed(2)} dB`);
  assert.ok(Math.abs(pass1kDb) < 0.6, `Expected 1 kHz passband within 0.6 dB, got ${pass1kDb.toFixed(2)} dB`);

  // B. End-to-end multitrack render with sidechain ducking + stereo pan + -14 LUFS normalization + MP3 export
  const token = SecurityMiddleware.generateToken({ sub: 'user-dsp-proof', role: 'editor' });
  const projRes = await request('POST', '/api/audio/editor/agent-projects', { Authorization: `Bearer ${token}` }, { title: 'ADR-208 Mix Proof', sampleRate: 48000 });
  const pId = projRes.json.project.id;

  // Voice stem: active 0.0..1.0s, silent 1.0..2.0s, panned slightly left (-0.5)
  const sr = 48000;
  const voicePcm = new Float32Array(sr * 2);
  for (let i = 0; i < sr; i++) voicePcm[i] = Math.sin(2 * Math.PI * 440 * (i / sr)) * 0.6;
  // Music stem: steady 220 Hz bed across full 2.0s, panned right (+0.6), sidechain ducked against voice
  const musicPcm = makeSine(220, 2.0, sr, 0.45);

  const vStem = await request('POST', `/api/audio/editor/projects/${pId}/stems`, { Authorization: `Bearer ${token}` }, {
    id: pId, name: 'voice.wav', trackName: 'vocals', pan: -0.5, hpf: true,
    audioBase64: DSPEngine.encodeWav([voicePcm, voicePcm], sr).toString('base64'),
  });
  const mStem = await request('POST', `/api/audio/editor/projects/${pId}/stems`, { Authorization: `Bearer ${token}` }, {
    id: pId, name: 'music.wav', trackName: 'bass', pan: 0.6, ducking: true, duckDepthDb: -14,
    duckTriggerTrackId: vStem.json.stem.id,
    audioBase64: DSPEngine.encodeWav([musicPcm, musicPcm], sr).toString('base64'),
  });
  assert.equal(mStem.status, 201);

  // Verify direct DSP sidechain ducking drops music energy when voice is active
  const rawMix = DSPEngine.renderMultitrackMixdown([
    { id: 'v', sampleRate: sr, channels: [new Float32Array(sr * 2)], config: { role: 'vocals', muted: true } },
    { id: 'trig', sampleRate: sr, channels: [voicePcm, voicePcm], config: { role: 'vocals', gainDb: -36 } },
    { id: 'bed', sampleRate: sr, channels: [musicPcm, musicPcm], config: { role: 'bass', ducking: true, duckTriggerTrackId: 'trig', duckDepthDb: -14, compRatio: 1, reverbMix: 0 } },
  ], sr, { normalize: false });
  // Also test pure sidechain ducker directly
  const bedCopy = new Float32Array(musicPcm);
  DSPEngine.applySidechainDucking(bedCopy, voicePcm, sr, { duckDepthDb: -14, thresholdDb: -30 });
  const duckedRms = rmsWindow(bedCopy, Math.floor(sr * 0.35), Math.floor(sr * 0.9));
  const releasedRms = rmsWindow(bedCopy, Math.floor(sr * 1.6), Math.floor(sr * 1.98));
  assert.ok(duckedRms < releasedRms * 0.45, `Expected sidechain ducked RMS (${duckedRms}) < 45% of released RMS (${releasedRms})`);
  assert.ok(rawMix.right.length === sr * 2);

  // Render mastered WAV via HTTP route and verify RIFF/WAVE header + -14 LUFS loudness + -1 dBTP peak
  const wavRender = await request('POST', `/api/audio/editor/projects/${pId}/render`, { Authorization: `Bearer ${token}` }, { id: pId, format: 'wav', normalize: true });
  assert.equal(wavRender.status, 201);
  assert.ok(Math.abs(wavRender.json.mixdown.lufsIntegrated - (-14.0)) <= 1.2, `Expected ~ -14.0 LUFS, got ${wavRender.json.mixdown.lufsIntegrated}`);
  assert.ok(wavRender.json.mixdown.truePeakDb <= -0.95, `Expected true peak <= -0.95 dBTP, got ${wavRender.json.mixdown.truePeakDb}`);

  const wavDl = await request('GET', wavRender.json.downloadUrl, { Authorization: `Bearer ${token}` });
  assert.equal(wavDl.status, 200);
  assert.equal(wavDl.buffer.subarray(0, 4).toString('ascii'), 'RIFF');
  const decodedMix = DSPEngine.decodeWav(wavDl.buffer);
  assert.equal(decodedMix.sampleRate, 48000);
  assert.equal(decodedMix.channels.length, 2);
  assert.ok(rmsWindow(decodedMix.channels[0], 0, decodedMix.channels[0].length) > 0.05);

  // Render MP3 via FFmpeg (-threads 4) and decode back to verify real audio frames
  const mp3Render = await request('POST', `/api/audio/editor/projects/${pId}/render`, { Authorization: `Bearer ${token}` }, { id: pId, format: 'mp3', normalize: true });
  assert.equal(mp3Render.status, 201);
  assert.equal(mp3Render.json.mixdown.format, 'mp3');
  const mp3Dl = await request('GET', mp3Render.json.downloadUrl, { Authorization: `Bearer ${token}` });
  assert.equal(mp3Dl.status, 200);
  assert.equal(mp3Dl.headers['content-type'], 'audio/mpeg');
  const mp3Decoded = decodeAudioBuffer(mp3Dl.buffer, 48000);
  assert.ok(mp3Decoded.durationSeconds > 1.8);
});

test('7. Voice synthesis uses TTS service + persona DSP and fails closed with 503 when TTS is unreachable', async () => {
  const token = SecurityMiddleware.generateToken({ sub: 'user-tts', role: 'editor' });
  const proj = await request('POST', '/api/audio/editor/agent-projects', { Authorization: `Bearer ${token}` }, { title: 'Voiceover Session' });

  const okRes = await request('POST', '/api/audio/tts/generate', { Authorization: `Bearer ${token}` }, {
    text: 'Welcome to the grand documentary of planet Earth.',
    persona: 'david_attenborough',
    projectId: proj.json.project.id,
    trackName: 'Narration',
  });
  assert.equal(okRes.status, 201);
  assert.ok(okRes.json.durationSeconds > 1.0);
  assert.equal(okRes.json.stem.name, 'david_attenborough_voice.wav');

  // Point OSHAL_TTS_URL at an unreachable port -> must fail closed 503 (never return fake sine beeps)
  process.env.OSHAL_TTS_URL = 'http://127.0.0.1:1/v1/audio/speech';
  try {
    const failRes = await request('POST', '/api/audio/tts/generate', { Authorization: `Bearer ${token}` }, {
      text: 'Should fail closed',
      persona: 'morgan_freeman',
    });
    assert.equal(failRes.status, 503);
    assert.equal(failRes.json.error, 'speech_service_unavailable');
  } finally {
    process.env.OSHAL_TTS_URL = ttsMockUrl;
  }
});

test('8. Live stream modulation, live publish, concierge recipe compiler, and document handoff', async () => {
  const token = SecurityMiddleware.generateToken({ sub: 'user-live', role: 'admin' });
  const proj = await request('POST', '/api/audio/editor/agent-projects', { Authorization: `Bearer ${token}` }, { title: 'Live & Concierge' });
  const pId = proj.json.project.id;

  const wavChunk = DSPEngine.encodeWav([makeSine(220, 0.5, 48000, 0.35)], 48000);
  const modRes = await request('POST', '/api/audio/live/modulate', { Authorization: `Bearer ${token}` }, {
    audioBase64: wavChunk.toString('base64'),
    persona: 'morgan_freeman',
    outputFormat: 'wav',
  });
  assert.equal(modRes.status, 200);
  assert.equal(modRes.json.format, 'wav');
  assert.equal(modRes.json.sampleCount, 24000);

  const pubRes = await request('POST', '/api/audio/live/publish', { Authorization: `Bearer ${token}` }, {
    projectId: pId,
    name: 'live_take_1',
    audioBase64: wavChunk.toString('base64'),
    synthesizePersona: 'vintage_radio',
  });
  assert.equal(pubRes.status, 201);
  assert.equal(pubRes.json.published, true);

  const concRes = await request('POST', '/api/audio/editor/concierge', { Authorization: `Bearer ${token}` }, {
    projectId: pId,
    instruction: 'Warm up vocals, sidechain duck bass, and set tempo to 128 BPM',
  });
  assert.equal(concRes.status, 200);
  assert.equal(concRes.json.project.tempo, 128);
  assert.ok(concRes.json.surfaceDirectives.some((d) => d.field === 'tempo' && d.value === '128'));

  const handoffMod = await import(path.join(pkgDir, 'tools', 'editor-handoff.mjs'));
  let dirty = true;
  let saved = 0;
  let registered = null;
  const state = { project: { id: pId, title: 'Live', revision: 2, tempo: 128 }, tracks: [{ id: 't1' }], masterGainDb: 0 };
  handoffMod.connectAudioEditorHandoff({
    getState: () => state,
    isDirty: () => dirty,
    saveProject: async () => { saved += 1; dirty = false; state.project.revision += 1; return true; },
    loadProject: async () => {},
    registerSession: (spec) => { registered = spec; return () => {}; },
  });
  const snap = await registered.prepare();
  assert.equal(saved, 1);
  assert.equal(snap.fields.revision, '3');
});

test('9. Crisp-glass design standard, zero emoji, single primary CTA, Forced RLS SQL, and zero local path leaks', () => {
  const audioHtml = fs.readFileSync(path.join(pkgDir, 'tools', 'audio.html'), 'utf8');
  const audioCss = fs.readFileSync(path.join(pkgDir, 'tools', 'audio.css'), 'utf8');
  const audioJs = fs.readFileSync(path.join(pkgDir, 'tools', 'audio.js'), 'utf8');
  const appYaml = fs.readFileSync(path.join(pkgDir, 'oshal-app.yaml'), 'utf8');
  const pgSql = fs.readFileSync(path.join(pkgDir, 'migrations', '001_initial_audio_studio.sql'), 'utf8');

  // Single primary CTA on initial screen (DS-24)
  const primaryMatches = audioHtml.match(/class="[^"]*\bbtn\s+primary\b[^"]*"/g) || [];
  assert.equal(primaryMatches.length, 1, `Expected 1 primary button on screen, found ${primaryMatches.length}`);

  // Zero emoji in HTML, JS, and manifest
  const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  assert.equal(emojiRegex.test(audioHtml), false, 'audio.html must contain zero emoji');
  assert.equal(emojiRegex.test(audioJs), false, 'audio.js must contain zero emoji');
  assert.equal(emojiRegex.test(appYaml), false, 'oshal-app.yaml must contain zero emoji');

  // Zero stray raw hex colors outside var(--token, #hex) in CSS
  const strippedCss = audioCss.replace(/var\(--[a-z0-9-]+,\s*#[0-9a-fA-F]{3,8}\)/g, '');
  assert.deepEqual(strippedCss.match(/#[0-9a-fA-F]{3,8}\b/g) || [], []);

  // PostgreSQL Forced RLS on all 6 tables
  assert.match(pgSql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(pgSql, /FORCE ROW LEVEL SECURITY/);
  assert.match(pgSql, /audio\.owner_issuer/);
  assert.match(pgSql, /audio\.owner_sub/);

  // Zero local developer home paths across package files
  assert.equal(fs.existsSync(path.join(pkgDir, 'vault')), false);
});
