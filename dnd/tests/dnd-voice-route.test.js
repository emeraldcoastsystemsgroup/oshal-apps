/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 20:11:11 | roger.murphy@emeraldcoastsystemsgroup.com   | Lock narration to an approved natural server provider, exact voice controls, bounded input, base64 audio, explicit unavailability, and redacted generic route failures.
 * 2026-07-21 20:19:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Prove the launch manifest and route select Gemini natural narration and accept only its approved voice catalog.
 * 2026-07-21 20:38:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Prove OpenAI natural narration selection and one paid synthesis for concurrent or repeated identical multiplayer lines.
 * 2026-07-21 21:59:39 | roger.murphy@emeraldcoastsystemsgroup.com   | Prove fixed Marin/Kore natural narration, safe failover classes, actual provider reporting, silence without a server voice, and primary recovery after fallback caching.
 * 2026-07-21 23:53:25 | roger.murphy@emeraldcoastsystemsgroup.com   | Prove the paid Cloud Chirp narrator precedes quota-limited Gemini in the natural failover chain.
 * 2026-07-23 00:41:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Prove Cedar receives a slow, grave folk-storyteller performance direction and remains the recoverable natural primary.
 * 2026-07-23 02:35:01 | roger.murphy@emeraldcoastsystemsgroup.com   | Prove configured gravelly Cloud Algenib narration is primary and no runtime fallback can select Kore.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const { createMediaService } = require('../lib/dnd-media-service');
const { createDndRoutes } = require('../routes/dnd-routes');

const root = path.join(__dirname, '..');

/** @description Temporarily expose one deterministic framework voice registry. */
async function withVoiceRegistry(registry, work) {
  const originalLoad = Module._load;
  Module._load = function voiceAwareLoad(request, parent, isMain) {
    if (request === '@/features/voice-providers') {
      return { getTTSProviderRegistry: () => registry };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try { return await work(); }
  finally { Module._load = originalLoad; }
}

/** @description Invoke the package route without starting an HTTP server. */
async function request(ctx, method, url, body) {
  const router = createDndRoutes({ appPackageDir: root, ...(ctx || {}) });
  let raw = '';
  const req = { method, url, body, oidc: { user: { sub: 'voice-user', name: 'Voice User' } } };
  const res = {
    statusCode: 0,
    setHeader() {},
    end(value) { raw = String(value || ''); },
  };
  await router(req, res, () => { throw new Error('route unexpectedly fell through'); });
  return { status: res.statusCode, body: JSON.parse(raw) };
}

/** @description Read only production route and D&D service sources. */
function voiceSources() {
  const files = [path.join(root, 'routes', 'dnd-routes.js')]
    .concat(fs.readdirSync(path.join(root, 'lib'))
      .filter((name) => /^dnd-.*\.js$/.test(name))
      .map((name) => path.join(root, 'lib', name)));
  return files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
}

test('narration fixes the primary server narrator to gravelly Cloud Algenib', async () => {
  let captured = null;
  const provider = {
    kind: 'server',
    async getStatus() { return { configured: true, providerId: 'google-cloud-tts' }; },
    async synthesize(input) {
      captured = input;
      return { providerId: 'google-cloud-tts', audio: Buffer.from('natural-audio'), audioFormat: 'audio/mpeg', voiceId: input.voiceId };
    },
  };
  const registry = { get(id) { return id === 'google-cloud-tts' ? provider : undefined; } };
  const body = {
    text: 'The road ahead is dark.', voiceId: 'cedar', languageCode: 'en-US',
    speakingRate: 1.13, pitch: -1.5,
  };
  const response = await withVoiceRegistry(registry,
    () => request({ pool: {} }, 'POST', '/tts', body));
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.audio, Buffer.from('natural-audio').toString('base64'));
  assert.equal(response.body.mime, 'audio/mpeg');
  assert.equal(response.body.provider, 'google-cloud-tts');
  assert.equal(response.body.voiceId, 'en-US-Chirp3-HD-Algenib');
  assert.equal(captured.text, body.text);
  assert.equal(captured.languageCode, 'en-US');
  assert.equal(captured.speakingRate, 1.13);
  assert.equal(captured.pitch, -1.5);
  assert.equal(captured.voiceId, 'en-US-Chirp3-HD-Algenib');
  assert.match(captured.performanceInstructions, /dark fireside folklore/);
  assert.match(captured.performanceInstructions, /never cheerfulness/i);
  assert.match(captured.performanceInstructions, /Never sound like an announcer, assistant, or computer/);
});

test('narration rejects oversized text and voices outside the configured DM list', async () => {
  const tooLong = await request({ pool: {} }, 'POST', '/tts', {
    text: 'x'.repeat(901), voice: 'marin',
  });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.body.code, 'INVALID_TTS_REQUEST');
  const unapproved = await request({ pool: {} }, 'POST', '/tts', {
    text: 'Speak naturally.', voice: 'arbitrary-provider-voice',
  });
  assert.equal(unapproved.status, 400);
  assert.equal(unapproved.body.code, 'INVALID_TTS_VOICE');
});

test('missing or browser providers stay silent without a synthesis directive', async () => {
  let browserCalls = 0;
  const browser = { kind: 'browser', async synthesize() { browserCalls++; return {}; } };
  const service = createMediaService({ ttsProviderId: 'openai-tts' });
  const browserResult = await withVoiceRegistry({ get: () => browser },
    () => service.synthesizeNarration({ text: 'No robot.', voice: 'marin' }));
  assert.equal(browserResult.ok, false);
  assert.equal(browserResult.unavailable, true);
  assert.equal(browserCalls, 0);
  assert.equal(Object.hasOwn(browserResult, 'useBrowserSynthesis'), false);
  const missingResult = await withVoiceRegistry({ get: () => undefined },
    () => service.synthesizeNarration({ text: 'No substitute.', voice: 'marin' }));
  assert.equal(missingResult.unavailable, true);
});

test('an unavailable Cloud narrator reaches Gemini Algenib without selecting Kore', async () => {
  let captured = null;
  const unavailable = { kind: 'server', async getStatus() { return { configured: false, reason: 'not configured' }; } };
  const gemini = {
    kind: 'server', async getStatus() { return { configured: true }; },
    async synthesize(input) {
      captured = input;
      return { providerId: 'gemini-tts', voiceId: input.voiceId, audio: Buffer.from('natural'), audioFormat: 'audio/mpeg' };
    },
  };
  const service = createMediaService({});
  const result = await withVoiceRegistry({ get: (id) => id === 'gemini-tts' ? gemini : unavailable },
    () => service.synthesizeNarration({ text: 'Natural backup, please.' }));
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'gemini-tts');
  assert.equal(result.voiceId, 'Algenib');
  assert.equal(result.mime, 'audio/mpeg');
  assert.equal(captured.voiceId, 'Algenib');
});

test('only safe primary Cloud failures activate the natural backup chain', async () => {
  let geminiCalls = 0;
  const gemini = {
    kind: 'server', async getStatus() { return { configured: true }; },
    async synthesize(input) {
      geminiCalls++;
      return { providerId: 'gemini-tts', voiceId: input.voiceId, audio: Buffer.from('backup') };
    },
  };
  const primary = (message) => ({
    kind: 'server', async getStatus() { return { configured: true }; },
    async synthesize() { throw new Error(message); },
  });
  const transient = createMediaService({});
  const recovered = await withVoiceRegistry({ get: (id) => id === 'google-cloud-tts' ? primary('TTS API HTTP 503: unavailable') : id === 'gemini-tts' ? gemini : undefined },
    () => transient.synthesizeNarration({ text: 'Use the safe backup.' }));
  assert.equal(recovered.provider, 'gemini-tts');
  const permanent = createMediaService({});
  const rejected = await withVoiceRegistry({ get: (id) => id === 'google-cloud-tts' ? primary('TTS API HTTP 400: invalid input') : id === 'gemini-tts' ? gemini : undefined },
    () => permanent.synthesizeNarration({ text: 'Do not hide a permanent request error.' }));
  assert.equal(rejected.unavailable, true);
  assert.equal(geminiCalls, 1);
});

test('identical multiplayer narration shares one provider synthesis', async () => {
  let calls = 0;
  const provider = {
    kind: 'server',
    async getStatus() { return { configured: true, providerId: 'google-cloud-tts' }; },
    async synthesize(input) {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { providerId: 'google-cloud-tts', audio: Buffer.from(input.text), audioFormat: 'audio/mpeg', voiceId: input.voiceId };
    },
  };
  const service = createMediaService({ ttsProviderId: 'google-cloud-tts' });
  const body = { text: 'One shared line for the whole table.', voice: 'marin' };
  const results = await withVoiceRegistry({ get: (id) => id === 'google-cloud-tts' ? provider : undefined },
    () => Promise.all([service.synthesizeNarration(body), service.synthesizeNarration(body)]));
  const cached = await withVoiceRegistry({ get: (id) => id === 'google-cloud-tts' ? provider : undefined },
    () => service.synthesizeNarration(body));
  assert.equal(calls, 1);
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(cached, results[0]);
});

test('short fallback caching lets the preferred Cloud Algenib narrator recover', async () => {
  let clock = 1000, cloudReady = false, cloudCalls = 0, geminiCalls = 0;
  const cloud = {
    kind: 'server', async getStatus() { return { configured: cloudReady, reason: 'not configured' }; },
    async synthesize(input) {
      cloudCalls++;
      return { providerId: 'google-cloud-tts', voiceId: input.voiceId, audio: Buffer.from('algenib') };
    },
  };
  const gemini = {
    kind: 'server', async getStatus() { return { configured: true }; },
    async synthesize(input) {
      geminiCalls++;
      return { providerId: 'gemini-tts', voiceId: input.voiceId, audio: Buffer.from('algenib-backup') };
    },
  };
  const service = createMediaService({ now: () => clock });
  const unavailable = { kind: 'server', async getStatus() { return { configured: false }; } };
  const registry = { get: (id) => id === 'google-cloud-tts' ? cloud : id === 'gemini-tts' ? gemini : unavailable };
  const body = { text: 'Retry the preferred narrator after a brief cache.' };
  const first = await withVoiceRegistry(registry, () => service.synthesizeNarration(body));
  cloudReady = true;
  const cached = await withVoiceRegistry(registry, () => service.synthesizeNarration(body));
  clock += 30001;
  const recovered = await withVoiceRegistry(registry, () => service.synthesizeNarration(body));
  assert.equal(first.provider, 'gemini-tts');
  assert.equal(cached.provider, 'gemini-tts');
  assert.equal(recovered.provider, 'google-cloud-tts');
  assert.equal(cloudCalls, 1);
  assert.equal(geminiCalls, 1);
});

test('production voice route has no direct key endpoint or browser fallback path', () => {
  const source = voiceSources();
  assert.doesNotMatch(source, /texttospeech\.googleapis\.com/);
  assert.doesNotMatch(source, /GOOGLE_API_KEY|GEMINI_API_KEY|OPENAI_API_KEY/);
  assert.doesNotMatch(source, /speechSynthesis|useBrowserSynthesis/);
  assert.match(source, /getTTSProviderRegistry/);
  assert.match(source, /providerId:\s*'google-cloud-tts',\s*voiceId:\s*'en-US-Chirp3-HD-Algenib'/);
  assert.match(source, /providerId:\s*'openai-tts',\s*voiceId:\s*'cedar'/);
  assert.match(source, /providerId:\s*'gemini-tts',\s*voiceId:\s*'Algenib'/);
  assert.doesNotMatch(source, /voiceId:\s*'Kore'|Chirp3-HD-Kore/);
  const manifest = fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8');
  assert.match(manifest, /tts:\s*\{\s*provider:\s*google-cloud-tts\s*\}/);
});

test('generic route failures are logged but never returned with implementation detail', async () => {
  let logged = null;
  const secret = 'private database topology';
  const response = await request({
    pool: { async query() { throw new Error(secret); } },
    logger: { error(fields, message) { logged = { fields, message }; } },
  }, 'GET', '/campaigns');
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: 'server error' });
  assert.doesNotMatch(JSON.stringify(response.body), new RegExp(secret));
  assert.equal(logged.message, 'D&D route request failed');
  assert.equal(logged.fields.err.message, secret);
});
