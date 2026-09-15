/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Browser proof for camera capture: real Chromium with a fake camera device, exercising the DOM wiring the zero-dep unit runner cannot reach — live preview, snap into the crop stage, track teardown on close, and the desktop/phone fallback branches.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Provide explicit fixture operation grants before exercising protected camera composition.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Serve the same closed local detector assets while preserving the real camera regression.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Use the framework artifact picker and remove the private file-picker implementation; source listings remain read-only and caller-scoped.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Run under the node:test harness instead of a hand-run main(): the same camera branches become real test points with assertions, and Playwright plus the shared picker asset resolve from OSHAL_CORE_ROOT instead of two hand-typed CLI arguments, so the Test Lab can run this recipe unattended rather than refusing it.
 */

/**
 * Browser recipe for Portrait Studio camera capture — real Chromium, the browser's own real
 * getUserMedia over Chromium's synthetic capture device, real DOM wiring.
 *
 * Run it the way the Test Lab does, from the store root:
 *
 *   OSHAL_CORE_ROOT=C:/Projects/oshal node --test portrait-studio/tests/browser/camera-proof.js
 *
 * Playwright and the shared core artifact picker both resolve from OSHAL_CORE_ROOT (default: an
 * `oshal` checkout beside this store). Missing inputs FAIL the file loudly — they never skip.
 * Chromium comes from that Playwright install; no browser download happens here.
 *
 * WHAT THE FAKE DEVICE IS, AND IS NOT. `--use-fake-device-for-media-stream` is a Chromium capture
 * device, not a page-side stub: the page calls the real `navigator.mediaDevices.getUserMedia`, gets
 * a real MediaStream, and the `<video>` decodes real frames (videoWidth is read from them), so the
 * permission grant, the track lifecycle and the teardown are the browser's own. What it cannot
 * cover is a PHYSICAL camera: device enumeration across real webcams, a human answering the OS
 * permission prompt, and real lens/exposure behaviour. That part needs hardware and a person, is
 * NOT registered as a Lab case, and is described in README "Proving the camera on real hardware".
 *
 * The desktop and phone branches below deliberately REMOVE `navigator.mediaDevices` (and, for the
 * phone, add the HTML Media Capture IDL). Those are capability shapes, not a faked camera: they
 * prove the fallbacks a browser without an in-page camera must take.
 */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const CORE = path.resolve(process.env.OSHAL_CORE_ROOT || path.resolve(__dirname, '..', '..', '..', '..', 'oshal'));
const PICKER = path.join(CORE, 'src', 'pages', 'cockpit', 'js', 'components', 'artifact-picker.js');
const TOOLS = path.resolve(__dirname, '..', '..', 'tools');

/**
 * @description Resolve Playwright from the framework checkout and confirm the shared picker asset
 * is there. A missing input throws at load so the runner reports a failure, never a silent skip.
 * @returns {{ chromium: object }} The Playwright browser type used by every case below.
 */
function frameworkPlaywright() {
  if (!fs.existsSync(PICKER)) {
    throw new Error(`OSHAL_CORE_ROOT must name a framework checkout holding the shared artifact picker (looked for ${PICKER})`);
  }
  try {
    return createRequire(path.join(CORE, 'package.json'))('playwright');
  } catch (cause) {
    throw new Error(`OSHAL_CORE_ROOT must name a framework checkout with playwright installed (got ${CORE})`, { cause });
  }
}
const { chromium } = frameworkPlaywright();

const CATALOG = {
  presets: {
    professional: [{ id: 'linkedin', name: 'LinkedIn Classic', group: 'Office', icon: '💼', desc: 'clean', layers: {} }],
    character: [{ id: 'gothic', name: 'American Gothic', group: 'Classic', icon: '🌾', desc: 'fun', layers: {} }],
  },
  backgrounds: [{ id: 'grey', name: 'Grey' }], attire: [{ id: 'suit', name: 'Suit' }],
  headwear: [{ id: 'none', name: 'None' }], props: [{ id: 'none', name: 'None' }],
  finishes: [{ id: 'color', name: 'Color' }], framings: [{ id: 'head', name: 'Head' }],
};
const FACE_ASSETS = {
  '/api/portrait-studio/face-module': 'portrait-face.js',
  '/api/portrait-studio/face-worker': 'portrait-face-worker.js',
  '/api/portrait-studio/face-cascade': 'portrait-face-cascade.js',
  '/api/portrait-studio/face-model': 'face-model/facefinder.json',
};
const JSON_ROUTES = {
  '/api/portrait-studio/permissions': { permissions: { view: true, read: true, create: true, change: true, delete: true, export: true }, unavailable: {} },
  '/api/portrait-studio/catalog': CATALOG,
  '/api/portrait-studio/provider': { configured: true, provider: 'codex' },
  '/api/portrait-studio/portraits': { portraits: [] },
};

/**
 * @description Serve the package tools directory on the same paths the real route exposes, so the
 * page under test loads exactly the shipped HTML, capture module and detector assets.
 * @returns {import('node:http').Server} An unstarted loopback server.
 */
function createFixtureServer() {
  const send = (res, type, body) => { res.writeHead(200, { 'Content-Type': type }); res.end(body); };
  return http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (Object.hasOwn(FACE_ASSETS, url)) {
      const type = url.endsWith('/face-model') ? 'application/json' : 'application/javascript';
      return send(res, type, fs.readFileSync(path.join(TOOLS, FACE_ASSETS[url])));
    }
    if (Object.hasOwn(JSON_ROUTES, url)) return send(res, 'application/json', JSON.stringify(JSON_ROUTES[url]));
    if (url === '/' || url === '/app') return send(res, 'text/html', fs.readFileSync(path.join(TOOLS, 'portrait-studio.html')));
    if (url === '/api/portrait-studio/capture-module') return send(res, 'application/javascript', fs.readFileSync(path.join(TOOLS, 'portrait-capture.js')));
    if (url === '/api/artifacts/picker.js') return send(res, 'application/javascript', fs.readFileSync(PICKER));
    res.writeHead(404); res.end('');
  });
}

let server;
let base;
before(async () => {
  server = createFixtureServer();
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
});

/**
 * @description Open the fixture page in a fresh Chromium, closed when the case ends. Every page
 * gets a short action budget and may only reach the fixture origin, so a wedged locator or a
 * stray external asset fails the case instead of hanging it.
 * @param {object} t The node:test context, used for per-case teardown.
 * @param {object} [options] `launch` / `newContext` arguments and an optional page-side `init` script.
 * @returns {Promise<{ page: object, errors: string[] }>} The open page and its collected page errors.
 */
async function openPage(t, options = {}) {
  const browser = await chromium.launch(options.launch || {});
  t.after(async () => { await browser.close(); });
  const context = await browser.newContext(options.context || {});
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort()));
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  if (options.init) await page.addInitScript(options.init);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.waitForTimeout(400);
  return { page, errors };
}

const LIVE = { launch: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }, context: { permissions: ['camera'] } };
const NO_CAMERA = () => { Object.defineProperty(navigator, 'mediaDevices', { get: () => undefined }); };
const PHONE = () => {
  Object.defineProperty(navigator, 'mediaDevices', { get: () => undefined });
  // The HTML Media Capture IDL a mobile browser exposes in place of an in-page camera.
  Object.defineProperty(HTMLInputElement.prototype, 'capture', { value: '', writable: true, configurable: true });
};

/** @description Ask the shipped capture module which mode the page's real capabilities imply. @param {object} page Open page. @returns {Promise<string>} The chosen mode. */
const captureMode = (page) => page.evaluate(() => window.PortraitCapture.chooseCaptureMode(window.PortraitCapture.readEnv(window, document)));

/**
 * @description Click the camera button with the capture input's own click intercepted, so the
 * hand-off to the camera app can be observed without a real camera app.
 * @param {object} page Open page.
 * @returns {Promise<{clicked: boolean, lens: string|null}>} Whether the input fired, and its lens.
 */
const fallbackClick = (page) => page.evaluate(() => {
  let clicked = false;
  const input = document.getElementById('cameraInput');
  input.click = () => { clicked = true; };
  document.getElementById('useCameraBtn').click();
  return { clicked, lens: input.getAttribute('capture') };
});

test('a secure page with a camera opens a live modal showing decoded frames', async (t) => {
  const { page, errors } = await openPage(t, LIVE);
  assert.equal(await page.evaluate(() => typeof window.PortraitCapture), 'object', 'the capture module loaded into the page');
  assert.equal(await captureMode(page), 'live', 'a secure page with a camera chooses live capture');
  assert.ok(await page.locator('#useCameraBtn').isVisible(), 'the camera button is visible');
  assert.ok(!(await page.locator('#cameraHint').isVisible()), 'no fallback hint is shown when live capture works');
  await page.locator('#useCameraBtn').click();
  await page.waitForTimeout(1200);
  assert.ok(await page.locator('#camModal').evaluate((el) => el.classList.contains('open')), 'the camera modal opened');
  const videoWidth = await page.locator('#camVideo').evaluate((video) => video.videoWidth);
  assert.ok(videoWidth > 0, `the live video decoded frames (videoWidth=${videoWidth})`);
  const transform = await page.locator('#camVideo').evaluate((video) => getComputedStyle(video).transform);
  assert.match(transform, /-1/, 'the preview is mirrored for the front lens');
  assert.deepEqual(errors, [], 'no page errors on the live path');
});

test('a snap reaches the crop stage and closing the modal stops every camera track', async (t) => {
  const { page, errors } = await openPage(t, LIVE);
  await page.locator('#useCameraBtn').click();
  await page.waitForTimeout(1200);
  await page.locator('#camSnap').click();
  await page.waitForTimeout(1200);
  assert.ok(await page.locator('#cropStage').isVisible(), 'the crop stage appeared after the snap');
  assert.ok(!(await page.locator('#dropzone').isVisible()), 'the crop stage replaced the dropzone');
  assert.ok(!(await page.locator('#generateBtn').isDisabled()), 'the generate button is enabled after a capture');
  assert.ok(!(await page.locator('#camModal').evaluate((el) => el.classList.contains('open'))), 'the modal closed after the snap');
  assert.ok(await page.locator('#retakePhoto').isVisible(), 'a retake is offered on the crop toolbar');

  // Re-open through Retake (the post-capture path), close through Cancel, and read the real tracks.
  await page.locator('#retakePhoto').click();
  await page.waitForTimeout(1000);
  const before = await page.evaluate(() => {
    const video = document.getElementById('camVideo');
    window.__tracks = video.srcObject ? video.srcObject.getTracks() : [];
    return window.__tracks.map((track) => track.readyState);
  });
  assert.deepEqual(before, ['live'], 'the retake re-opened a live camera track');
  await page.locator('#camCancel').click();
  await page.waitForTimeout(400);
  const ended = await page.evaluate(() => window.__tracks.map((track) => track.readyState));
  assert.deepEqual(ended, ['ended'], 'every track stopped on close — no light left on');
  assert.deepEqual(errors, [], 'no page errors on the snap and teardown path');
});

test('a desktop browser with no getUserMedia hides the camera button and explains why', async (t) => {
  // Desktop browsers have no `capture` attribute and no camera app to hand off to, so upload-only
  // is the only correct outcome. A visible button here would be a dead button.
  const { page, errors } = await openPage(t, { init: NO_CAMERA });
  assert.equal(await captureMode(page), 'upload-only', 'no getUserMedia on a desktop shape means upload-only');
  assert.ok(!(await page.locator('#useCameraBtn').isVisible()), 'the camera button is hidden rather than dead');
  assert.ok(await page.locator('#cameraHint').isVisible(), 'the hidden button leaves a hint in its place');
  const hint = ((await page.locator('#cameraHint').textContent()) || '').trim();
  assert.ok(hint.length > 0, `the hint explains itself (${hint})`);
  assert.deepEqual(errors, [], 'no page errors when the camera is absent');
});

test('a phone with no getUserMedia hands off to the camera app with the right lens', async (t) => {
  const { page, errors } = await openPage(t, { init: PHONE });
  assert.equal(await captureMode(page), 'file-capture', 'a phone without getUserMedia chooses file-capture');
  assert.ok(await page.locator('#useCameraBtn').isVisible(), 'the button is still shown on a phone');
  const hint = ((await page.locator('#cameraHint').textContent()) || '').trim();
  assert.match(hint, /camera app/i, `the phone fallback promises the camera app (${hint})`);
  assert.deepEqual(await fallbackClick(page), { clicked: true, lens: 'user' }, 'professional mode opens the capture input with the front lens');
  await page.locator('#modeCharacter').click();
  assert.deepEqual(await fallbackClick(page), { clicked: true, lens: 'environment' }, 'character mode flips the fallback to the rear camera');
  assert.deepEqual(errors, [], 'no page errors on the phone path');
});

// Cross-app file selection is covered by core tests/unit/artifact-picker.spec.ts.
