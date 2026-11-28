#!/usr/bin/env node
/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise actual Audio controls and native sessions with a dedicated empty test owner, independently decode WAV/MP3 outputs and clean only captured resources.
 *
 * Run explicitly with --execute, OSHAL_AUDIO_ACCEPTANCE_BASE_URL,
 * OSHAL_AUDIO_ACCEPTANCE_TOKEN, OSHAL_AUDIO_ACCEPTANCE_DISPOSABLE_OWNER=1,
 * OSHAL_AUDIO_ACCEPTANCE_OUTPUT and STORE_CI_TOOLCHAIN (pinned Playwright).
 * The caller provisions the dedicated original-owner credential; this script
 * cannot create people or grant roles. Source tests reuse only the UI workflow
 * functions with their explicitly identified authentication fixture.
 */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, stat, writeFile, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @description Stable identifier of the installed Test Lab scenario. @type {string} */
export const CASE_ID = 'audio:installed-studio-workflow';
const root = resolve(import.meta.dirname, '../..');

function tone() {
  const samples = 48000, data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(48000, 24); data.writeUInt32LE(96000, 28); data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(8000 * Math.sin(i * Math.PI * 880 / 48000)), 44 + i * 2);
  return data;
}

function command(program, args) {
  const result = spawnSync(program, args, { maxBuffer: 8 * 1024 * 1024, timeout: 15000 });
  assert.equal(result.status, 0, program + ' failed: ' + (result.stderr?.toString() || result.error?.message || ''));
  return result.stdout;
}

/** @description Decode genuine output independently of the app DSP and verify its audible stereo pan. @param {string} file Output path. @param {string} format wav or mp3. @param {number} pan Expected pan direction. @returns {Promise<object>} Measured artifact. */
export async function inspectAudio(file, format, pan) {
  const size = (await stat(file)).size; assert.ok(size > 1024 && size < 4 * 1024 * 1024);
  const probe = JSON.parse(command('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,sample_rate,channels', '-of', 'json', file]));
  const stream = probe.streams[0]; assert.equal(stream.codec_name, format === 'wav' ? 'pcm_s16le' : 'mp3');
  assert.equal(stream.channels, 2); assert.equal(Number(stream.sample_rate), 48000);
  assert.ok(Math.abs(Number(probe.format.duration) - 1) < 0.15, 'one-second input must remain one second');
  const pcm = command('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', '2', '-ar', '48000', 'pipe:1']);
  assert.ok(pcm.length >= 48000 * 8 && pcm.length <= 56000 * 8);
  let left = 0, right = 0, peak = 0;
  for (let i = 0; i + 7 < pcm.length; i += 8) {
    const l = pcm.readFloatLE(i), r = pcm.readFloatLE(i + 4); assert.ok(Number.isFinite(l) && Number.isFinite(r));
    left += l * l; right += r * r; peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }
  left = Math.sqrt(left / (pcm.length / 8)); right = Math.sqrt(right / (pcm.length / 8));
  assert.ok(left > 0.001 && right > 0.001 && peak < 1, 'both channels must be audible without clipping');
  assert.ok(pan > 0 ? right > left : left > right, 'decoded channel energy must follow the saved pan');
  return { file, bytes: size, sha256: createHash('sha256').update(await readFile(file)).digest('hex'),
    codec: stream.codec_name, channels: stream.channels, sampleRate: Number(stream.sample_rate),
    duration: Number(probe.format.duration), rms: { left, right }, peak };
}

async function action(page, suffix, perform) {
  const [response] = await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(suffix)), perform()]);
  assert.equal(response.status(), 201, 'Audio ' + suffix + ' must commit');
  return response.json();
}

async function field(page, selector, value) {
  await page.locator(selector).fill(String(value)); await page.locator(selector).press('Tab');
}

async function transport(page, activate = locator => locator.click()) {
  await activate(page.locator('#btn-play'));
  await page.waitForFunction(() => document.getElementById('timecode').textContent !== '00:00.000');
  await activate(page.locator('#btn-pause'));
  const paused = await page.locator('#timecode').textContent();
  await page.waitForTimeout(150); assert.equal(await page.locator('#timecode').textContent(), paused);
  await activate(page.locator('#btn-stop'));
  assert.equal(await page.locator('#timecode').textContent(), '00:00.000');
  return { advanced: true, pausedAt: paused, stoppedAt: '00:00.000' };
}

async function render(page, format, output, pan, record) {
  await page.locator('#select-export-format').selectOption(format);
  const committed = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/render'))
    .then(async response => { assert.equal(response.status(), 201, 'actual mixdown render must succeed'); return response.json(); });
  const [result, download] = await Promise.all([committed, page.waitForEvent('download', { timeout: 30000 }), page.locator('#btn-download-master').click()]);
  record('blob', result.mixdown.blobHash);
  assert.ok(download.suggestedFilename().endsWith('.' + format));
  try { await download.saveAs(output); }
  catch { throw new Error('Audio download failed: ' + await download.failure()); }
  return inspectAudio(output, format, pan);
}

/** @description Run real desktop authoring controls; caller supplies actual page/API and an exact resource journal. @param {object} options Page, API, title, output directory and record callback. @returns {Promise<object>} Saved project and independently decoded outputs. */
export async function exerciseStudio({ page, call, title, output, record = () => {} }) {
  await page.locator('#input-project-title').fill(title);
  const created = await action(page, '/agent-projects', () => page.locator('#btn-create-project').click());
  record('project', created.project.id);
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Created session'));
  assert.equal(await page.locator('.track-card').count(), 0, 'New Session must show its actual empty tracks');
  await page.locator('#audio-file-input').setInputFiles({ name: 'Review tone.wav', mimeType: 'audio/wav', buffer: tone() });
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Imported'));
  for (const [key, value] of [['gain-db', -3], ['pan', 0.5], ['eq-low', -3], ['reverb-mix', 0], ['comp-ratio', 1]]) await field(page, '#strip-' + key, value);
  const saved = (await action(page, '/operations', () => page.locator('#btn-save-project').click())).project;
  assert.equal(saved.id, created.project.id); assert.equal(saved.stems.length, 1); record('blob', saved.stems[0].blobHash);
  for (const [key, value] of Object.entries({ gainDb: -3, pan: 0.5, eqLowDb: -3, reverbMix: 0, compRatio: 1 })) assert.equal(saved.stems[0][key], value);
  await page.reload(); await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Loaded'));
  assert.equal(await page.locator('#project-title').textContent(), title); assert.equal(await page.locator('#strip-pan').inputValue(), '0.5');
  assert.equal(await page.locator('.trk-reverb-mix').inputValue(), '0', 'the surface field must preserve zero reverb');
  const playback = await transport(page);
  const wav = await render(page, 'wav', join(output, 'desktop.wav'), 0.5, record);
  const mp3 = await render(page, 'mp3', join(output, 'desktop.mp3'), 0.5, record);
  const current = (await call('GET', '/api/audio/editor/projects/' + saved.id)).body.project;
  assert.equal(current.stems[0].pan, 0.5);
  return { project: current, playback, artifacts: [wav, mp3] };
}

/** @description Edit and export the same saved project through touch-enabled phone controls. @param {object} options Actual phone page, API, project identity and output directory. @returns {Promise<object>} Phone output and saved revision. */
export async function exercisePhone({ page, call, project, output, record = () => {} }) {
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Loaded'));
  assert.equal(await page.locator('#project-title').textContent(), project.title);
  const playback = await transport(page, locator => locator.tap());
  await page.locator('#btn-nav-editor-view').tap();
  await field(page, '#strip-pan', -0.5);
  const artifact = await render(page, 'mp3', join(output, 'phone.mp3'), -0.5, record);
  const current = (await call('GET', '/api/audio/editor/projects/' + project.id)).body.project;
  assert.equal(current.stems.length, 1); assert.equal(current.stems[0].pan, -0.5); assert.equal(current.stems[0].gainDb, -3);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone must not scroll sideways');
  return { revision: current.revision, playback, artifact };
}

function client(base, token) {
  return async (method, route, body) => {
    const url = new URL(route, base); assert.equal(url.origin, new URL(base).origin);
    const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const bytes = Buffer.from(await response.arrayBuffer()); let value = null;
    try { value = JSON.parse(bytes.toString()); } catch { /* Artifact/refusal bytes are not assumed to be JSON. */ }
    return { status: response.status, body: value };
  };
}

async function nativeSession(context, base, token) {
  const response = await context.request.post(base + '/sessions', { data: { token } });
  assert.equal(response.status(), 201); const issued = await response.json();
  assert.ok(typeof issued.session === 'string' && issued.session.length > 10 && issued.principal);
  return issued.session;
}

async function cleanup(call, resources) {
  const errors = [];
  for (const id of resources.projects) {
    try {
      assert.equal((await call('DELETE', '/api/audio/editor/projects/' + id)).status, 204);
      assert.equal((await call('GET', '/api/audio/editor/projects/' + id)).status, 404);
    } catch { errors.push('captured project cleanup: ' + id); }
  }
  if (resources.projects.size) {
    try {
      assert.equal((await call('POST', '/api/audio/editor/media/cleanup', {})).status, 200);
      for (const hash of resources.blobs) assert.equal((await call('GET', '/api/audio/blobs/' + hash)).status, 404);
    } catch { errors.push('captured audio blob cleanup'); }
  }
  return errors;
}

/** @description Run only on an explicitly designated empty original-owner account with real native admission. @param {object} options Base URL, dedicated-owner token, private output root and pinned browser module. @returns {Promise<object>} Live result with cleanup failures preserved. */
export async function runInstalled({ base, token, output, toolchain, disposableOwner }) {
  assert.equal(disposableOwner, true); assert.ok(typeof token === 'string' && token.length > 10);
  const origin = new URL(base); assert.ok(origin.protocol === 'https:' || origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname));
  assert.equal(origin.pathname, '/'); assert.ok(!origin.username && !origin.password && !origin.search && !origin.hash);
  base = origin.origin;
  command('ffprobe', ['-version']); command('ffmpeg', ['-version']);
  await mkdir(output, { recursive: true, mode: 0o700 }); const directory = await mkdtemp(join(resolve(output), 'audio-installed-'));
  const call = client(base, token), resources = { projects: new Set(), blobs: new Set() };
  const result = { case: CASE_ID, state: 'fail', output: directory, evidence: {}, cleanupErrors: [] };
  let browser, context, phone, session;
  const journalFile = join(directory, 'recovery.private.json');
  const journal = () => writeFileSync(journalFile, JSON.stringify({ case: CASE_ID, base, session, projects: [...resources.projects], blobs: [...resources.blobs] }), { mode: 0o600 });
  const record = (kind, id) => {
    assert.match(id, kind === 'project' ? /^[a-f0-9-]{36}$/i : /^[a-f0-9]{64}$/i);
    resources[kind === 'project' ? 'projects' : 'blobs'].add(id); journal();
  };
  try {
    const before = await call('GET', '/api/audio/editor/projects'); assert.equal(before.status, 200); assert.deepEqual(before.body.projects, [], 'dedicated empty test owner required');
    const require = createRequire(join(resolve(toolchain), 'package.json'));
    browser = await require('playwright').chromium.launch({ headless: true }); context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    session = await nativeSession(context, base, token); journal(); const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/api/audio/ui'); await page.locator('#btn-play').waitFor();
    const desktop = await exerciseStudio({ page, call, title: 'Media Review Audio ' + randomUUID(), output: directory, record });
    phone = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, storageState: await context.storageState(), acceptDownloads: true });
    const touch = await phone.newPage(); touch.on('pageerror', error => errors.push(error.message)); await touch.goto(base + '/api/audio/ui');
    const mobile = await exercisePhone({ page: touch, call, project: desktop.project, output: directory, record }); assert.deepEqual(errors, []);
    const version = await call('GET', '/api/audio/_smoke'); assert.equal(version.status, 200);
    result.evidence = { version: version.body.version, project: desktop.project.id, desktop, mobile };
  } catch (error) { result.failure = String(error.message).replaceAll(token, '[redacted]'); }
  result.cleanupErrors.push(...await cleanup(call, resources));
  if (session) try { assert.equal((await client(base, session)('DELETE', '/sessions')).status, 200); } catch { result.cleanupErrors.push('native session revocation'); }
  for (const [name, resource] of [['phone context', phone], ['desktop context', context], ['browser', browser]]) {
    try { await resource?.close(); } catch { result.cleanupErrors.push(name + ' cleanup'); }
  }
  if (!result.failure && !result.cleanupErrors.length) result.state = 'pass';
  if (!result.cleanupErrors.length) await unlink(journalFile).catch(() => {});
  await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = process.env;
  assert.ok(process.argv.includes('--execute') && env.OSHAL_AUDIO_ACCEPTANCE_DISPOSABLE_OWNER === '1', 'Explicit --execute and disposable original-owner designation required');
  assert.ok(env.OSHAL_AUDIO_ACCEPTANCE_TOKEN && env.OSHAL_AUDIO_ACCEPTANCE_OUTPUT, 'Dedicated owner token and private output root required');
  const result = await runInstalled({ base: env.OSHAL_AUDIO_ACCEPTANCE_BASE_URL || 'http://127.0.0.1:38788', token: env.OSHAL_AUDIO_ACCEPTANCE_TOKEN,
    output: env.OSHAL_AUDIO_ACCEPTANCE_OUTPUT, toolchain: env.STORE_CI_TOOLCHAIN || join(root, 'scripts/toolchain'), disposableOwner: true });
  process.stdout.write('RESULT ' + JSON.stringify(result) + '\n'); process.exitCode = result.state === 'pass' ? 0 : 1;
}
