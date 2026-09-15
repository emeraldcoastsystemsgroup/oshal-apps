/** CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the actual bundled detector in browser workers, protected assets and manual-edit lifecycle.
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { chromium, firefox, webkit, type Browser, type BrowserType, type Page } from 'playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPortraitFixture, media } from './authorization.fixture';

let fixture: Awaited<ReturnType<typeof createPortraitFixture>>, browser: Browser;
const photo = join(__dirname, 'fixtures/astronaut.png');
beforeEach(async () => { fixture = await createPortraitFixture(); await fixture.change('creator'); });
afterEach(async () => { await browser?.close(); await fixture?.close(); });

async function open(engine: BrowserType = chromium, nativeSource?: string): Promise<Page> {
  browser = await engine.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies([{ name: 'fixture-user', value: 'alice', url: fixture.base }]);
  await context.addInitScript(nativeSource ?? 'Object.defineProperty(window, "FaceDetector", { value: undefined, configurable: true });');
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  await page.goto(fixture.base + '/api/portrait-studio/app');
  await page.waitForFunction(() => !document.querySelector<HTMLElement>('#studioComposer')?.hidden);
  await page.locator('#modeGroup').click();
  await page.locator('#fileInput').setInputFiles(photo);
  await page.waitForFunction(() => document.querySelector('#faceCount')?.textContent?.includes('1 face'));
  await observeDetector(page);
  return page;
}

async function observeDetector(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { PortraitCapture: { detectionsToBoxes: (...args: unknown[]) => unknown }; faceProbe: { boxes: unknown[]; workers: number; terminated: number } };
    w.faceProbe = { boxes: [], workers: 0, terminated: 0 };
    const original = w.PortraitCapture.detectionsToBoxes;
    w.PortraitCapture.detectionsToBoxes = function (...args) { w.faceProbe.boxes = JSON.parse(JSON.stringify(args[0])); return original(...args); };
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) { super(url, options); w.faceProbe.workers++; }
      terminate() { w.faceProbe.terminated++; super.terminate(); }
    };
  });
}

async function probe(page: Page) {
  return page.evaluate(() => (window as unknown as { faceProbe: { boxes: Array<{ x: number; y: number; width: number; height: number }>; workers: number; terminated: number } }).faceProbe);
}

async function noFace(page: Page) {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    const context = canvas.getContext('2d')!; context.fillStyle = '#808080'; context.fillRect(0, 0, 512, 512);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#fileInput').setInputFiles({ name: 'no-face.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
  await page.waitForFunction(() => document.querySelector('#genStatus')?.textContent === '');
}

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  it(`finds the licensed face in a real ${name} worker without image upload or external requests`, async () => {
    const page = await open(engine), requests: Array<{ url: string; method: string; bytes: number }> = [];
    page.context().on('request', request => requests.push({ url: request.url(), method: request.method(), bytes: request.postDataBuffer()?.length ?? 0 }));
    await page.locator('#findFacesBtn').click();
    await expect.poll(() => page.locator('#genStatus').textContent()).toContain('Found 1 face');
    const result = await probe(page); expect(result.workers).toBe(1); expect(result.terminated).toBe(1); expect(result.boxes).toHaveLength(1);
    const face = result.boxes[0]; expect(face.x).toBeGreaterThan(150); expect(face.x).toBeLessThan(190);
    expect(face.y).toBeGreaterThan(40); expect(face.y).toBeLessThan(85); expect(face.width).toBeGreaterThan(80); expect(face.width).toBeLessThan(140);
    expect(requests.filter(request => request.url.startsWith('http')).every(request => new URL(request.url).origin === fixture.base && request.method === 'GET' && request.bytes === 0)).toBe(true);
    expect(requests.some(request => request.url.endsWith('/face-model'))).toBe(true);
    expect(media.calls).toBe(0); await page.locator('#addFaceBtn').click(); expect(await page.locator('#faceCount').textContent()).toContain('2 faces');
  });
}

it('no-face results and model failure preserve the current manual boxes', async () => {
  const page = await open(); await noFace(page); await page.locator('#addFaceBtn').click();
  const manualCount = await page.locator('#faceCount').textContent();
  expect(manualCount).toContain('3 faces'); // One on the first photo; two manually placed on the no-face photo.
  await page.locator('#findFacesBtn').click();
  await expect.poll(() => page.locator('#genStatus').textContent()).toContain('No faces found');
  expect(await page.locator('#faceCount').textContent()).toBe(manualCount);
  await page.context().route('**/face-model', route => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.locator('#findFacesBtn').click();
  await expect.poll(() => page.locator('#genStatus').textContent()).toContain('Face finding is unavailable');
  expect(await page.locator('#faceCount').textContent()).toBe(manualCount); expect((await probe(page)).terminated).toBe(2);
});

it.each([
  ['rejecting', 'Promise.reject(new Error("unavailable"))'],
  ['hung', 'new Promise(() => {})'],
  ['malformed', 'Promise.resolve([{boundingBox:{x:NaN,y:0,width:Infinity,height:5}}])'],
])('a %s native detector falls back to the actual bundled worker', async (_name, expression) => {
  const page = await open(chromium, `window.FaceDetector = class { detect() { return ${expression}; } };`);
  await page.locator('#findFacesBtn').click();
  // Native fallback has its own 1.5-second deadline before the bounded worker begins.
  await expect.poll(() => page.locator('#genStatus').textContent(), { timeout: 10000 }).toContain('Found 1 face');
  expect((await probe(page)).terminated).toBe(1);
});

it('explicit cancellation and the worker deadline terminate local work without changing boxes', async () => {
  const page = await open(); let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.context().route('**/face-model', async route => { await held; await route.abort().catch(() => {}); });
  try {
    const count = await page.locator('#faceCount').textContent();
    let requested = page.context().waitForEvent('request', request => request.url().endsWith('/face-model'));
    await page.locator('#findFacesBtn').click(); await requested; await page.locator('#findFacesBtn').click();
    expect((await probe(page)).terminated).toBe(1); expect(await page.locator('#genStatus').textContent()).toContain('cancelled');
    requested = page.context().waitForEvent('request', request => request.url().endsWith('/face-model'));
    await page.locator('#findFacesBtn').click(); await requested;
    await expect.poll(() => page.locator('#genStatus').textContent(), { timeout: 10000 }).toContain('Face finding is unavailable');
    expect((await probe(page)).terminated).toBe(2); expect((await probe(page)).boxes).toEqual([]);
    expect(await page.locator('#faceCount').textContent()).toBe(count);
  } finally { release(); }
});

it('a late local result cannot replace manual changes, another photo, a changed mode or revoked create access', async () => {
  const page = await open();
  for (const change of ['manual', 'photo', 'mode', 'permission']) {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.context().route('**/face-model', async route => { await held; await route.fulfill({ status: 200, contentType: 'application/json', body: readFileSync(join(__dirname, '../tools/face-model/facefinder.json')) }).catch(() => {}); });
    const requested = page.context().waitForEvent('request', request => request.url().endsWith('/face-model'));
    await page.locator('#findFacesBtn').click(); await requested;
    if (change === 'manual') await page.locator('#addFaceBtn').click();
    if (change === 'photo') await noFace(page);
    if (change === 'mode') await page.locator('#modeProfessional').click();
    if (change === 'permission') { await fixture.change('creator', 'alice', 'revoke'); await fixture.change('viewer'); await page.evaluate(() => window.dispatchEvent(new Event('focus'))); }
    release();
    await expect.poll(async () => (await probe(page)).terminated).toBe(['manual', 'photo', 'mode', 'permission'].indexOf(change) + 1);
    expect((await probe(page)).boxes).toHaveLength(0);
    await page.context().unroute('**/face-model');
    if (change !== 'permission') { await page.locator('#modeGroup').click(); await page.locator('#fileInput').setInputFiles(photo); }
  }
  expect(await page.locator('#studioComposer').isVisible()).toBe(false); expect(media.calls).toBe(0);
});

it('asset access requires current exact-principal view grants and exposes only the closed four files', async () => {
  for (const path of ['/face-module', '/face-worker', '/face-cascade', '/face-model']) {
    expect((await fixture.call(path)).status).toBe(200);
    expect((await fixture.call(path, 'collision')).status).toBe(403);
  }
  await fixture.change('creator', 'alice', 'revoke');
  expect((await fixture.call('/face-model')).status).toBe(403);
  await fixture.change('viewer'); expect((await fixture.call('/face-model')).status).toBe(200);
  expect((await fixture.call('/face-model/LICENSE.txt')).status).not.toBe(200);
  expect((await fixture.call('/face-worker', 'alice', 'POST')).status).not.toBe(200);
});
