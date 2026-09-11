/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-12 09:00:00 | maintainer@emeraldcoastsystemsgroup.com     | Browser proof for camera capture: real Chromium with a fake camera device, exercising the DOM wiring the zero-dep unit runner cannot reach — live preview, snap into the crop stage, track teardown on close, and the desktop/phone fallback branches.
 * 2026-09-10 | maintainer@emeraldcoastsystemsgroup.com | Use the framework artifact picker and remove the private file-picker implementation; source listings remain read-only and caller-scoped.
 */

/**
 * Browser proof for Portrait Studio camera capture — real Chromium, real getUserMedia
 * (fake device), real DOM wiring.
 *
 * NOT part of `node tests/run.js`: that runner is deliberately zero-dependency, and this needs
 * Playwright. It is the reproducible re-proof step for the wiring, run by hand after any change
 * to Step 1 or tools/portrait-capture.js:
 *
 *   node portrait-studio/tests/browser/camera-proof.js --playwright <framework-checkout>/node_modules/playwright
 *
 * (The default path assumes a sibling `oshal` framework checkout. Chromium comes from whatever
 * Playwright install is named; no browser download happens here.)
 *
 * Serves the package tools dir with the same paths the route exposes, then:
 *   1. secure context + camera present  → live modal, snap, crop stage appears, retake offered
 *   2. camera tracks stop when the modal closes (no light left on)
 *   3. desktop with no getUserMedia     → button HIDDEN with a reason, never dead
 *   4. phone shape (capture attribute)  → hands off to the camera app with the right lens
 */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const flag = process.argv.indexOf('--playwright');
const PW = flag > -1 && process.argv[flag + 1]
  ? process.argv[flag + 1]
  : path.resolve(__dirname, '../../../../oshal/node_modules/playwright');
let chromium;
try { ({ chromium } = require(PW)); } catch (e) {
  console.error(`Playwright not found at ${PW}\nPass one with --playwright <path/to/node_modules/playwright>`);
  process.exit(2);
}

const TOOLS = path.resolve(__dirname, '..', '..', 'tools');
const CATALOG = {
  presets: {
    professional: [{ id: 'linkedin', name: 'LinkedIn Classic', group: 'Office', icon: '💼', desc: 'clean', layers: {} }],
    character: [{ id: 'gothic', name: 'American Gothic', group: 'Classic', icon: '🌾', desc: 'fun', layers: {} }],
  },
  backgrounds: [{ id: 'grey', name: 'Grey' }], attire: [{ id: 'suit', name: 'Suit' }],
  headwear: [{ id: 'none', name: 'None' }], props: [{ id: 'none', name: 'None' }],
  finishes: [{ id: 'color', name: 'Color' }], framings: [{ id: 'head', name: 'Head' }],
};

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/app') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(fs.readFileSync(path.join(TOOLS, 'portrait-studio.html')));
  }
  if (url === '/api/portrait-studio/capture.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    return res.end(fs.readFileSync(path.join(TOOLS, 'portrait-capture.js')));
  }
  if (url === '/api/artifacts/picker.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    return res.end(fs.readFileSync(path.resolve(PW, '../../src/pages/cockpit/js/components/artifact-picker.js')));
  }
  if (url === '/api/portrait-studio/catalog') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(CATALOG));
  }
  if (url === '/api/portrait-studio/provider') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ configured: true, provider: 'codex' }));
  }
  if (url === '/api/portrait-studio/portraits') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ portraits: [] }));
  }
  res.writeHead(404); res.end('');
});

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ok  ' : '  FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

/** Every page gets a short action budget: a wedged locator must fail the proof, not hang it. */
async function newPage(browser, opts) {
  const ctx = await browser.newContext(opts || {});
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  return page;
}

(async () => {
  await new Promise((r) => server.listen(8931, r));
  const base = 'http://localhost:8931/';

  // ── Case 1+2: live camera, snap, and track teardown ──────────────────────
  const live = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const page = await newPage(live, { permissions: ['camera'] });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForTimeout(400);

  check('module loaded into the page', await page.evaluate(() => typeof window.PortraitCapture === 'object'));
  check('mode chosen is live on a secure page with a camera',
    (await page.evaluate(() => window.PortraitCapture.chooseCaptureMode(window.PortraitCapture.readEnv(window, document)))) === 'live');
  check('camera button is visible', await page.locator('#useCameraBtn').isVisible());
  check('no fallback hint shown when live works', !(await page.locator('#cameraHint').isVisible()));

  await page.locator('#useCameraBtn').click();
  await page.waitForTimeout(1200);
  check('modal opened', await page.locator('#camModal').evaluate((el) => el.classList.contains('open')));
  const vw = await page.locator('#camVideo').evaluate((v) => v.videoWidth);
  check('live video has frames', vw > 0, 'videoWidth=' + vw);
  check('preview is mirrored for the front lens',
    (await page.locator('#camVideo').evaluate((v) => getComputedStyle(v).transform)).includes('-1'));

  await page.locator('#camSnap').click();
  await page.waitForTimeout(1200);
  check('crop stage replaced the dropzone', await page.locator('#cropStage').isVisible() && !(await page.locator('#dropzone').isVisible()));
  check('generate button enabled after capture', !(await page.locator('#generateBtn').isDisabled()));
  check('modal closed after the snap', !(await page.locator('#camModal').evaluate((el) => el.classList.contains('open'))));
  check('retake button is offered on the crop toolbar', await page.locator('#retakePhoto').isVisible());

  // Track teardown: re-open via Retake (the post-capture path), close via Cancel, assert ended.
  await page.locator('#retakePhoto').click();
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const v = document.getElementById('camVideo');
    window.__tracks = v.srcObject ? v.srcObject.getTracks() : [];
  });
  const before = await page.evaluate(() => window.__tracks.map((t) => t.readyState));
  await page.locator('#camCancel').click();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => window.__tracks.map((t) => t.readyState));
  check('every track stopped on close', before.length > 0 && after.every((s) => s === 'ended'),
    'before=' + JSON.stringify(before) + ' after=' + JSON.stringify(after));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await live.close();

  // ── Case 3: desktop with no getUserMedia → button HIDDEN, honest reason ──
  // Desktop browsers have no `capture` attribute and no camera app to hand off to, so the
  // only correct outcome is upload-only. A visible button here would be a dead button.
  const b2 = await chromium.launch();
  const p2 = await newPage(b2);
  await p2.addInitScript(() => { Object.defineProperty(navigator, 'mediaDevices', { get: () => undefined }); });
  const err2 = [];
  p2.on('pageerror', (e) => err2.push(e.message));
  await p2.goto(base);
  await p2.waitForTimeout(400);
  check('desktop, no getUserMedia → upload-only',
    (await p2.evaluate(() => window.PortraitCapture.chooseCaptureMode(window.PortraitCapture.readEnv(window, document)))) === 'upload-only');
  check('camera button hidden rather than dead', !(await p2.locator('#useCameraBtn').isVisible()));
  const hint = (await p2.locator('#cameraHint').textContent()) || '';
  check('hidden button explains itself', await p2.locator('#cameraHint').isVisible() && hint.trim().length > 0, hint.trim());
  check('no page errors when the camera is absent', err2.length === 0, err2.join(' | '));
  await b2.close();

  // ── Case 4: phone-shaped browser (capture attribute, no getUserMedia) ────
  const b3 = await chromium.launch();
  const p3 = await newPage(b3);
  await p3.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { get: () => undefined });
    // Simulate the HTML Media Capture IDL that mobile browsers expose.
    Object.defineProperty(HTMLInputElement.prototype, 'capture', { value: '', writable: true, configurable: true });
  });
  const err3 = [];
  p3.on('pageerror', (e) => err3.push(e.message));
  await p3.goto(base);
  await p3.waitForTimeout(400);
  check('phone, no getUserMedia → file-capture mode',
    (await p3.evaluate(() => window.PortraitCapture.chooseCaptureMode(window.PortraitCapture.readEnv(window, document)))) === 'file-capture');
  check('button still shown on a phone', await p3.locator('#useCameraBtn').isVisible());
  const hint3 = (await p3.locator('#cameraHint').textContent()) || '';
  check('phone fallback promises the camera app', /camera app/i.test(hint3), hint3.trim());
  check('phone click opens the capture input with the right lens', await p3.evaluate(() => {
    let clicked = false;
    const ci = document.getElementById('cameraInput');
    ci.click = () => { clicked = true; };
    document.getElementById('useCameraBtn').click();
    return clicked && ci.getAttribute('capture') === 'user';
  }));
  check('character mode flips the fallback lens to the rear camera', await p3.evaluate(() => {
    let clicked = false;
    const ci = document.getElementById('cameraInput');
    ci.click = () => { clicked = true; };
    document.getElementById('modeCharacter').click();
    document.getElementById('useCameraBtn').click();
    return clicked && ci.getAttribute('capture') === 'environment';
  }));
  check('no page errors on the phone path', err3.length === 0, err3.join(' | '));
  await b3.close();

  // Cross-app file selection is covered by core tests/unit/artifact-picker.spec.ts.

  server.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
})().catch((e) => { console.error('PROOF ERROR', e); server.close(); process.exitCode = 1; });
