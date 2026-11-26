/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 1.4.3: end-to-end tool parity tests for CREATE-TOOL-BRAND-04, -05, -06, -07 (api render & status tools, no-worker refusal, full brief/voiceover/music fields, two-owner brand-kit isolation, real ffmpeg/ffprobe MP4 verification, and Chromium 1440x900 + 412x915 UI proof).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const toolchain = process.env.STORE_CI_TOOLCHAIN || path.resolve(ROOT, '../scripts/toolchain');
process.env.NODE_PATH = [path.resolve(toolchain, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(':');
Module._initPaths();
const need = createRequire(path.resolve(toolchain, 'package.json'));
const express = need('express');
const yaml = need('js-yaml');
const { chromium } = need('playwright');
const { createReviewRoutes } = need(path.join(ROOT, 'routes/review.js'));

const ALICE = { issuer: 'https://issuer.test', sub: 'alice-sub', principalId: 'p-alice', tenantIds: ['t-1'], isActive: true };
const BOB = { issuer: 'https://issuer.test', sub: 'bob-sub', principalId: 'p-bob', tenantIds: ['t-1'], isActive: true };

function ffprobeJson(mp4File) {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', mp4File,
  ], { encoding: 'utf8', timeout: 10000 });
  return JSON.parse(out);
}

function firstFramePng(mp4File) {
  return execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-i', mp4File, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1',
  ], { timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
}

async function startRenderServer(t, { disabled = false, roleBySub = {} } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-graphics-parity-'));
  let activeActor = ALICE;
  const ctx = {
    appPackageDir: ROOT,
    brandGraphicsDataDir: dataDir,
    brandGraphicsRendererDisabled: disabled,
    authorization: {
      currentActor: () => activeActor,
      authorize: async ({ permission }) => {
        const role = roleBySub[activeActor.sub] || 'admin';
        const allowed = role === 'admin'
          || (role === 'reader' && ['app.open', 'legacy.read', 'source.read'].includes(permission));
        return { allowed };
      },
    },
  };
  const app = express();
  app.use((req, _res, next) => {
    const who = req.headers['x-test-actor'];
    activeActor = who === 'bob' ? BOB : ALICE;
    next();
  });
  app.use('/api/brand-graphics', createReviewRoutes(ctx));
  app.get('/api/brand-graphics/home-summary', (_q, res) => res.json({ metrics: [{ id: 'a', label: 'Brand jobs in progress', value: '0' }], items: [] }));
  app.get('/api/brand-graphics/source-projects', (_q, res) => res.json({ projects: [] }));
  app.get('/api/brand-graphics/source-project-editor.mjs', (_q, res) => res.type('text/javascript').sendFile(path.join(ROOT, 'tools/source-project-editor.mjs')));
  app.get('/api/create/brand-kit', (_q, res) => res.json({
    kit: { version: 1, name: 'Northwind Studio', colors: { primary: '#1d4ed8', secondary: '#0ea5e9', accent: '#f59e0b', dark: '#0f172a', light: '#f8fafc' }, extras: [], fonts: { heading: 'Georgia', body: 'Calibri' }, voice: 'Clear', logo: null },
    revision: 1,
    words: { phrase: 'cobalt blue and amber' },
  }));
  const platform = process.env.OSHAL_PLATFORM_ROOT;
  if (platform) {
    app.use('/shared/ui', express.static(path.resolve(platform, 'src/shared/ui')));
    app.use('/cockpit', express.static(path.resolve(platform, 'src/pages/cockpit')));
  }
  app.get('/api/swarm/apps/home-plan', (_q, res) => res.json({ apps: [] }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${server.address().port}`, dataDir };
}

test('CREATE-TOOL-BRAND-04: manifest declares api brand_graphic (held) and read-only brand-graphics-job-status with lastingStorage', () => {
  const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
  const catalog = yaml.load(fs.readFileSync(path.join(ROOT, 'authorization.yaml'), 'utf8'));
  assert.equal(manifest.lastingStorage, true);
  const renderTool = manifest.tools.find((t) => t.name === 'brand_graphic');
  assert.equal(renderTool.executor.executorType, 'api');
  assert.equal(renderTool.executor.apiEndpoint, 'POST /api/brand-graphics/renders');
  assert.equal(renderTool.defaultAuthMode, 'ask');
  assert.equal(renderTool.requiresApproval, true);
  assert.ok(renderTool.cardText);
  for (const field of ['brief', 'title', 'sourceLink', 'voiceover', 'music', 'brandStyle', 'durationSec', 'aspect', 'format']) {
    assert.ok(renderTool.inputSchema.properties[field], `brand_graphic inputSchema includes ${field}`);
  }
  const statusTool = manifest.tools.find((t) => t.name === 'brand-graphics-job-status');
  assert.equal(statusTool.executor.executorType, 'api');
  assert.equal(statusTool.executor.apiEndpoint, 'GET /api/brand-graphics/renders');
  assert.equal(statusTool.defaultAuthMode, 'auto');
  assert.equal(statusTool.requiresApproval, false);
  assert.deepEqual(catalog.bindings.tools.find((b) => b.id === 'brand_graphic').allOf, ['app.open', 'legacy.execute']);
  assert.deepEqual(catalog.bindings.tools.find((b) => b.id === 'brand-graphics-job-status').allOf, ['app.open', 'legacy.read']);
});

test('CREATE-TOOL-BRAND-04: without a renderer/worker, POST /renders refuses honestly with 503 worker_unavailable and queues nothing', async (t) => {
  const { base } = await startRenderServer(t, { disabled: true });
  const before = await (await fetch(`${base}/api/brand-graphics/renders`)).json();
  assert.equal(before.capabilities.available, false);
  assert.equal(before.count, 0);
  const res = await fetch(`${base}/api/brand-graphics/renders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ brief: '10-second intro for the daily recap', durationSec: 10, aspect: '16:9' }),
  });
  assert.equal(res.status, 503);
  const err = await res.json();
  assert.equal(err.error, 'worker_unavailable');
  const afterList = await (await fetch(`${base}/api/brand-graphics/renders`)).json();
  assert.equal(afterList.count, 0, 'nothing was queued when no renderer is available');
});

test('CREATE-TOOL-BRAND-04, -05, -07: renders real 9:16 10s MP4 with title, sourceLink, voiceover, music, verified via ffprobe and saved under dataDir', async (t) => {
  const { base, dataDir } = await startRenderServer(t);
  const pkgBefore = fs.readdirSync(ROOT).sort();
  const payload = {
    title: 'Daily Recap Opener',
    brief: '10-second vertical intro for the daily recap',
    sourceLink: 'https://example.invalid/recap/42',
    brandMode: 'intro',
    voiceover: 'Good morning, here are today highlights across energy and technology.',
    music: 'broadcast-sting',
    brandStyle: 'oshal',
    durationSec: 10,
    aspect: '9:16',
    format: 'mp4',
  };
  const createRes = await fetch(`${base}/api/brand-graphics/renders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.equal(created.ok, true);
  assert.equal(created.job.title, payload.title);
  assert.equal(created.job.sourceLink, payload.sourceLink);
  assert.equal(created.job.voiceover, payload.voiceover);
  assert.equal(created.job.music, 'broadcast-sting');
  assert.equal(created.job.brandStyle, 'oshal');
  assert.equal(created.job.brandKit.brandName, 'Open Swarm');
  assert.equal(created.job.aspect, '9:16');
  assert.equal(created.job.durationSec, 10);
  assert.equal(created.job.width, 720);
  assert.equal(created.job.height, 1280);
  assert.equal(created.job.format, 'mp4');

  // Job status tool endpoint returns the exact saved job record.
  const listRes = await fetch(`${base}/api/brand-graphics/renders`);
  assert.equal(listRes.status, 200);
  const list = await listRes.json();
  assert.equal(list.count, 1);
  assert.equal(list.latest.id, created.job.id);
  assert.equal(list.latest.voiceover, payload.voiceover);
  assert.equal(list.latest.music, 'broadcast-sting');
  assert.match(list.summary, /Daily Recap Opener/);

  // Download MP4 and verify dimensions, duration, audio stream, and metadata with ffprobe.
  const dlRes = await fetch(`${base}${created.downloadUrl}`);
  assert.equal(dlRes.status, 200);
  assert.match(dlRes.headers.get('content-type') || '', /video\/mp4/);
  assert.match(dlRes.headers.get('content-disposition') || '', /attachment; filename="daily-recap-opener-9x16\.mp4"/);
  const bytes = Buffer.from(await dlRes.arrayBuffer());
  assert.ok(bytes.length > 5000, 'MP4 payload is non-trivial');
  const tmpMp4 = path.join(dataDir, 'probe-9x16.mp4');
  fs.writeFileSync(tmpMp4, bytes);
  const probe = ffprobeJson(tmpMp4);
  const vStream = probe.streams.find((s) => s.codec_type === 'video');
  const aStream = probe.streams.find((s) => s.codec_type === 'audio');
  assert.equal(vStream.width, 720);
  assert.equal(vStream.height, 1280);
  assert.ok(aStream, 'MP4 carries synthesized audio track');
  const dur = Number(probe.format.duration);
  assert.ok(dur >= 9.5 && dur <= 10.6, `duration ${dur}s is ~10s`);
  assert.equal(probe.format.tags.title, 'Daily Recap Opener');
  assert.equal(probe.format.tags.artist, 'Open Swarm');
  assert.match(probe.format.tags.comment, /music=broadcast-sting/);
  assert.match(probe.format.tags.comment, /source=https:\/\/example\.invalid\/recap\/42/);
  assert.deepEqual(fs.readdirSync(ROOT).sort(), pkgBefore, 'zero files written into package root');
});

test('CREATE-TOOL-BRAND-06 & -07: two owners with different brand kits produce distinct isolated clips and enforce permissions & personal scope', async (t) => {
  const { base, dataDir } = await startRenderServer(t, { roleBySub: { 'alice-sub': 'admin', 'bob-sub': 'admin' } });
  const putA = await fetch(`${base}/api/brand-graphics/brand-kit`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-test-actor': 'alice' },
    body: JSON.stringify({ brandName: 'Acme Solar', primaryColor: '#e11d48', accentColor: '#f59e0b', backgroundColor: '#1e1b4b' }),
  });
  assert.equal(putA.status, 200);
  const putB = await fetch(`${base}/api/brand-graphics/brand-kit`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-test-actor': 'bob' },
    body: JSON.stringify({ brandName: 'Harbor Bio', primaryColor: '#059669', accentColor: '#22d3ee', backgroundColor: '#064e3b' }),
  });
  assert.equal(putB.status, 200);

  const renderA = await (await fetch(`${base}/api/brand-graphics/renders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-actor': 'alice' },
    body: JSON.stringify({ title: 'Solar Launch', brief: 'Clean energy clip', brandStyle: 'my-brand', aspect: '1:1', durationSec: 5, music: 'clean-pulse' }),
  })).json();
  const renderB = await (await fetch(`${base}/api/brand-graphics/renders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-actor': 'bob' },
    body: JSON.stringify({ title: 'Bio Launch', brief: 'Marine science clip', brandStyle: 'my-brand', aspect: '1:1', durationSec: 5, music: 'warm-ambient' }),
  })).json();
  assert.equal(renderA.job.brandKit.brandName, 'Acme Solar');
  assert.equal(renderA.job.brandKit.primaryColor, '#e11d48');
  assert.equal(renderB.job.brandKit.brandName, 'Harbor Bio');
  assert.equal(renderB.job.brandKit.primaryColor, '#059669');

  // Strict per-owner isolation on job read, list, download, and delete.
  const bobList = await (await fetch(`${base}/api/brand-graphics/renders`, { headers: { 'x-test-actor': 'bob' } })).json();
  assert.deepEqual(bobList.jobs.map((j) => j.id), [renderB.job.id]);
  assert.equal((await fetch(`${base}/api/brand-graphics/renders/${renderA.job.id}`, { headers: { 'x-test-actor': 'bob' } })).status, 404);
  assert.equal((await fetch(`${base}/api/brand-graphics/renders/${renderA.job.id}/download`, { headers: { 'x-test-actor': 'bob' } })).status, 404);
  assert.equal((await fetch(`${base}/api/brand-graphics/renders/${renderA.job.id}`, { method: 'DELETE', headers: { 'x-test-actor': 'bob' } })).status, 404);

  // Scope spoofing refused with 400.
  assert.equal((await fetch(`${base}/api/brand-graphics/renders?owner=alice`, { headers: { 'x-test-actor': 'bob' } })).status, 400);
  assert.equal((await fetch(`${base}/api/brand-graphics/renders`, { headers: { 'x-test-actor': 'bob', 'x-oshal-tenant-id': 'other' } })).status, 400);

  // Visually distinct 1:1 720x720 rendered MP4 frames between Account A and Account B.
  const fileA = path.join(dataDir, 'a.mp4');
  const fileB = path.join(dataDir, 'b.mp4');
  fs.writeFileSync(fileA, Buffer.from(await (await fetch(`${base}${renderA.previewUrl}`, { headers: { 'x-test-actor': 'alice' } })).arrayBuffer()));
  fs.writeFileSync(fileB, Buffer.from(await (await fetch(`${base}${renderB.previewUrl}`, { headers: { 'x-test-actor': 'bob' } })).arrayBuffer()));
  const probeA = ffprobeJson(fileA);
  const probeB = ffprobeJson(fileB);
  assert.equal(probeA.streams.find((s) => s.codec_type === 'video').width, 720);
  assert.equal(probeA.streams.find((s) => s.codec_type === 'video').height, 720);
  assert.equal(probeA.format.tags.artist, 'Acme Solar');
  assert.equal(probeB.format.tags.artist, 'Harbor Bio');
  assert.notEqual(Buffer.compare(firstFramePng(fileA), firstFramePng(fileB)), 0, 'two accounts produce distinct branded frames');

  // Reader role cannot POST /renders.
  const readerServer = await startRenderServer(t, { roleBySub: { 'alice-sub': 'reader' } });
  const denied = await fetch(`${readerServer.base}/api/brand-graphics/renders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ brief: 'Denied render' }),
  });
  assert.equal(denied.status, 403);
});

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

test('Browser (1440x900 & 412x915): form controls render an MP4 and show in-app video preview and Download MP4 button', async (t) => {
  const { base } = await startRenderServer(t);
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  t.after(async () => { await desktop.close(); });
  const page = await desktop.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.setDefaultTimeout(15000);
  await page.goto(`${base}/api/brand-graphics/review`);
  await page.locator('#render').waitFor({ state: 'visible' });
  await page.locator('#title').fill('Browser Parity Clip');
  await page.locator('#notes').fill('A crisp vertical brand opener rendered right in the app.');
  await page.locator('#voiceover').fill('Welcome to Northwind Studio.');
  await page.locator('#music').selectOption('warm-ambient');
  await page.locator('#brandStyle').selectOption('my-brand');
  await page.locator('#durationSec').fill('6');
  await page.locator('#aspect').selectOption('9:16');
  await page.locator('#render').click();
  await page.locator('#status').filter({ hasText: 'Brand clip rendered' }).waitFor();
  const video = page.locator('#records video.brand-preview-video').first();
  await video.waitFor({ state: 'visible' });
  assert.match(await video.getAttribute('src'), /^\/api\/brand-graphics\/renders\/[0-9a-f-]+\/download$/);
  const dlLink = page.locator('#records a.brand-download').first();
  assert.equal(await dlLink.textContent(), 'Download MP4');
  assert.match(await dlLink.getAttribute('href'), /\?download=1$/);
  assert.deepEqual(errors, []);

  // Mobile 412x915 viewport check: zero horizontal overflow and all controls accessible.
  const phone = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  t.after(async () => { await phone.close(); });
  const mPage = await phone.newPage();
  const mErrors = [];
  mPage.on('pageerror', (e) => mErrors.push(e.message));
  await mPage.goto(`${base}/api/brand-graphics/review`);
  await mPage.locator('#voiceover').waitFor({ state: 'visible' });
  await mPage.locator('#aspect').waitFor({ state: 'visible' });
  assert.equal(await mPage.locator('html').evaluate((el) => el.scrollWidth > window.innerWidth + 1), false, 'no horizontal overflow at 412x915');
  assert.deepEqual(mErrors, []);
});
