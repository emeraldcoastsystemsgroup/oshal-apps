/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the actual scan screen and WebGL viewer with local HTTP reconstruction, bounded synthetic photos and no external/device traffic.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Reuse the framework's exact-owned browser cleanup while the existing HTTP fixture serves the shared STL viewer; retain all seven rendering and freshness cases.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Resolve the framework checkout from OSHAL_CORE_ROOT first (what the Test Lab sandbox sets, /app) and OSHAL_CORE_DIR second, and fail loud when neither is set. The old default C:/Projects/oshal existed on one Windows box only and turned a missing variable into a confusing module error.
 */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import fixtureModule from './routes-core.fixture.js';
const { startFixture, readyJob, photo, coreRequire } = fixtureModule;
coreRequire('tsx/cjs');
const { launchIsolatedBrowser } = coreRequire(path.join(process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR, 'tests/fixtures/isolated-browser.ts'));
let browser, ownedBrowser, context, page, f, job;
before(async () => {
  ownedBrowser = await launchIsolatedBrowser({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  browser = ownedBrowser.browser;
});
after(async () => {
  const receipt = await ownedBrowser.close();
  const directory = process.env.SCAN_BROWSER_CLEANUP_RECEIPT_DIR;
  if (directory) fs.writeFileSync(path.join(directory, `scan-shared-viewer-cleanup-${receipt.pid}-${Date.now()}.json`),
    JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
});
beforeEach(async () => {
  f = await startFixture(); job = await readyJob(f);
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', (route) => new URL(route.request().url()).origin === f.origin ? route.continue() : route.abort());
  page = await context.newPage();
  await page.addInitScript(() => {
    window.__scanDraws = [];
    const draw = WebGLRenderingContext.prototype.drawArrays;
    WebGLRenderingContext.prototype.drawArrays = function (mode, first, count) {
      window.__scanDraws.push({ mode, count });
      return draw.call(this, mode, first, count);
    };
  });
});
afterEach(async () => { await context.close(); await f.close(); });

async function open() {
  await page.goto(f.base + '/app');
  await page.locator('.job-item').filter({ hasText: 'Synthetic box' }).click();
  await page.locator('.downloads a').filter({ hasText: 'STL' }).waitFor();
}

async function noOutputs() {
  assert.equal(await page.locator('.downloads a').count(), 0);
  for (const id of ['drawing-wrap', 'viewer-wrap', 'print-step']) assert.equal(await page.locator('#' + id).isVisible(), false, id);
  assert.equal(await page.locator('#send').isDisabled(), true);
  assert.equal(f.fetchCalls.length, 0, 'the fixture has made no printer calls');
}

async function renderedPixels() {
  const image = coreRequire('sharp')(await page.locator('#viewer').screenshot());
  const { width, height } = await image.metadata();
  const pixels = await image.extract({ left: Math.floor(width / 4), top: Math.floor(height / 4),
    width: Math.floor(width / 2), height: Math.floor(height / 2) }).removeAlpha().raw().toBuffer();
  const colors = new Set();
  for (let i = 0; i < pixels.length; i += 3) colors.add(pixels.subarray(i, i + 3).toString('hex'));
  assert.ok(colors.size > 20, `the actual shaded mesh must render, observed only ${colors.size} colors`);
  const triangles = Number((await page.locator('#viewer-info').innerText()).match(/^(\d+) facets/)[1]);
  assert.ok(await page.evaluate((count) => window.__scanDraws.some((draw) => draw.mode === WebGLRenderingContext.TRIANGLES && draw.count === count), triangles * 3),
    'the original WebGL drawArrays must draw the actual mesh triangles, not only grid lines');
  return pixels;
}

test('changing a ruler value immediately clears outputs; save and reconstruct displays real width80', async () => {
  await open();
  await page.waitForFunction(() => document.getElementById('viewer-info').textContent.length > 0);
  assert.match(await page.locator('#viewer-info').innerText(), /facets/);
  await renderedPixels();
  await page.locator('#dim-x').fill('80');
  await noOutputs();
  assert.match(await page.locator('#report').innerText(), /save.*scale.*reconstruct/i);
  await page.locator('#save-dims').click();
  await page.waitForFunction(() => document.getElementById('job-state').textContent.includes('capturing'));
  await noOutputs();
  assert.match(await page.locator('#report').innerText(), /reconstruct/i);
  await page.locator('#reconstruct').click();
  await page.locator('.downloads a').filter({ hasText: 'STL' }).waitFor();
  await page.waitForFunction(() => document.getElementById('viewer-info').textContent.includes('80.0'));
  await renderedPixels();
  assert.match(await page.locator('#report').innerText(), /80\.0/);
  assert.equal((await f.call(`/jobs/${job.id}`)).body.job.report.sizeMm.x, 80);
  assert.equal(await page.locator('#send').isEnabled(), true);
});

test('changing reconstruction settings clears export and print actions until rebuilt', async () => {
  await open();
  await page.locator('#smooth').fill('1');
  await noOutputs();
  assert.match(await page.locator('#report').innerText(), /reconstruct/i);
  await page.locator('#reconstruct').click();
  await page.locator('.downloads a').filter({ hasText: 'STL' }).waitFor();
  assert.equal((await f.call(`/jobs/${job.id}`)).body.job.settings.smoothIterations, 1);
});

function signal() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('photo upload clears old outputs while its HTTP response is still pending', async () => {
  await open();
  const entered = signal(), release = signal();
  await page.route(f.base + `/jobs/${job.id}/images`, async (route) => {
    const response = await route.fetch(); entered.resolve(response.status()); await release.promise;
    await route.fulfill({ response });
  });
  try {
    await page.locator('#photos').setInputFiles({ name: 'extra.png', mimeType: 'image/png', buffer: await photo(30, 20) });
    assert.equal(await entered.promise, 201);
    await noOutputs();
    assert.match(await page.locator('#report').innerText(), /photos changed/i);
  } finally { release.resolve(); }
  await page.locator('.image-card').nth(3).waitFor();
  await noOutputs();
});

test('a late STL response cannot restore the cleared viewer after an input edit', async () => {
  const entered = signal(), release = signal();
  await page.route(f.base + `/jobs/${job.id}/artifacts/stl`, async (route) => {
    const response = await route.fetch(); entered.resolve(response.status()); await release.promise;
    await route.fulfill({ response });
  });
  await open();
  assert.equal(await entered.promise, 200);
  const completed = page.waitForResponse((r) => r.url() === f.base + `/jobs/${job.id}/artifacts/stl`);
  try {
    await page.locator('#dim-x').fill('80');
    await noOutputs();
  } finally { release.resolve(); }
  await (await completed).finished();
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await noOutputs();
  assert.equal(await page.locator('#viewer-info').textContent(), '');
  assert.equal(await page.locator('#drawing').getAttribute('src'), null);
});

test('failed reconstruction leaves an actionable empty result instead of the previous report and mesh', async () => {
  await open();
  const owner = fs.readdirSync(f.tmp)[0];
  fs.writeFileSync(path.join(f.tmp, owner, job.id, 'masks', job.images[0].image_id + '.png'), 'broken synthetic mask');
  const reply = page.waitForResponse((r) => r.url().endsWith('/reconstruct') && r.request().method() === 'POST');
  await page.locator('#reconstruct').click();
  assert.ok([422, 500].includes((await reply).status()));
  await page.waitForFunction(() => !document.getElementById('reconstruct').disabled);
  await noOutputs();
  assert.match(await page.locator('#report').innerText(), /reconstruct|unsupported|input/i);
});

test('editing the scale during a delayed rebuild response keeps the newer input and hides the older result', async () => {
  await open();
  const entered = signal(), release = signal();
  await page.route(f.base + `/jobs/${job.id}/reconstruct`, async (route) => {
    const response = await route.fetch(); entered.resolve(response.status()); await release.promise;
    await route.fulfill({ response });
  });
  try {
    await page.locator('#reconstruct').click();
    assert.equal(await entered.promise, 200);
    await page.locator('#dim-x').fill('80');
    await noOutputs();
  } finally { release.resolve(); }
  await page.waitForFunction(() => !document.getElementById('reconstruct').disabled);
  assert.equal(await page.locator('#dim-x').inputValue(), '80');
  await noOutputs();
  assert.match(await page.locator('#report').innerText(), /save.*scale.*reconstruct/i);
  assert.equal((await f.call(`/jobs/${job.id}`)).body.job.report.sizeMm.x, 60, 'the newer unsaved edit must not masquerade as a completed reconstruction');
});

test('a delayed final job-detail refresh cannot overwrite newer unsaved measurements', async () => {
  await open();
  const entered = signal(), release = signal();
  await page.route(f.base + `/jobs/${job.id}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch(); entered.resolve(response.status()); await release.promise;
    await route.fulfill({ response });
  });
  try {
    await page.locator('#reconstruct').click();
    assert.equal(await entered.promise, 200);
    await page.locator('#dim-x').fill('80');
  } finally { release.resolve(); }
  await page.waitForFunction(() => !document.getElementById('reconstruct').disabled);
  assert.equal(await page.locator('#dim-x').inputValue(), '80');
  await noOutputs();
  assert.match(await page.locator('#report').innerText(), /save.*scale.*reconstruct/i);
});
