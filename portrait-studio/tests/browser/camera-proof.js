/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-12 09:00:00 | maintainer@emeraldcoastsystemsgroup.com     | Browser proof for camera capture: real Chromium with a fake camera device, exercising the DOM wiring the zero-dep unit runner cannot reach — live preview, snap into the crop stage, track teardown on close, and the desktop/phone fallback branches.
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

// A stand-in for the framework storage rail (/api/files). Two providers, one nested folder,
// and deliberately mixed content so the filter and the hidden-count have something to do.
const ONE_PX_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const FILE_TREE = {
  'oshal-local': {
    '': [
      { name: 'Trips', type: 'folder', path: 'Trips' },
      { name: 'headshot.png', type: 'file', path: 'headshot.png', size: ONE_PX_PNG.length },
      { name: 'taxes.pdf', type: 'file', path: 'taxes.pdf', size: 4096 },
      { name: 'notes.txt', type: 'file', path: 'notes.txt', size: 12 },
      { name: 'toobig.png', type: 'file', path: 'toobig.png', size: 21 * 1024 * 1024 },
    ],
    Trips: [{ name: 'beach.png', type: 'file', path: 'Trips/beach.png', size: ONE_PX_PNG.length }],
  },
  'google-drive': { '': [] },
};

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const q = new URLSearchParams(req.url.split('?')[1] || '');
  if (url === '/api/files/roots') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ roots: [
      { provider: 'oshal-local', label: 'OSHAL Storage', icon: '🗄️' },
      { provider: 'google-drive', label: 'Google Drive', icon: '🟢' },
    ] }));
  }
  if (url === '/api/files/browse') {
    const tree = FILE_TREE[q.get('provider')] || {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ entries: tree[q.get('path') || ''] || [] }));
  }
  if (url === '/api/files/download') {
    // The real route streams octet-stream for every provider — the whole point of deriving
    // the MIME from the name. Reproduce that exactly, or the proof is easier than reality.
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    return res.end(ONE_PX_PNG);
  }
  if (url === '/' || url === '/app') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(fs.readFileSync(path.join(TOOLS, 'portrait-studio.html')));
  }
  if (url === '/api/portrait-studio/capture.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    return res.end(fs.readFileSync(path.join(TOOLS, 'portrait-capture.js')));
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

  // ── Case 5: the connected-asset picker, end to end over the storage rail ──
  const b4 = await chromium.launch();
  const p4 = await newPage(b4);
  const err4 = [];
  p4.on('pageerror', (e) => err4.push(e.message));
  await p4.goto(base);
  await p4.waitForTimeout(500);

  check('connected-files button appears when storage is connected', await p4.locator('#browseFilesBtn').isVisible());
  await p4.locator('#browseFilesBtn').click();
  await p4.waitForTimeout(500);
  check('picker opened', await p4.locator('#fileModal').evaluate((el) => el.classList.contains('open')));
  const roots = await p4.locator('#fpRoots button').allTextContents();
  check('every connected root is offered', roots.length === 2 && /OSHAL Storage/.test(roots[0]), roots.join(', '));

  const rows = await p4.locator('#fpList .fp-row .nm').allTextContents();
  check('folders and images listed, other files filtered out',
    rows.includes('Trips') && rows.includes('headshot.png') && !rows.includes('taxes.pdf') && !rows.includes('toobig.png'),
    rows.join(', '));
  const foot = (await p4.locator('#fpFoot').textContent()) || '';
  check('what was filtered is COUNTED, not silently dropped', /2 non-image files and 1 over 20 MB hidden/.test(foot), foot.trim());

  // Drill into a folder and back out.
  await p4.locator('#fpList .fp-row', { hasText: 'Trips' }).click();
  await p4.waitForTimeout(300);
  const nested = await p4.locator('#fpList .fp-row .nm').allTextContents();
  check('drill-down lists the nested folder', nested.includes('beach.png'), nested.join(', '));
  check('breadcrumb trail shows the folder', ((await p4.locator('#fpCrumbs').textContent()) || '').includes('Trips'));
  await p4.locator('#fpList .fp-row', { hasText: 'Up one folder' }).click();
  await p4.waitForTimeout(300);
  check('up one folder returns to the root', ((await p4.locator('#fpList .fp-row .nm').allTextContents()).includes('headshot.png')));

  // An empty Drive must blame the scope, not claim there are no photos.
  await p4.locator('#fpRoots button', { hasText: 'Google Drive' }).click();
  await p4.waitForTimeout(400);
  const driveFoot = (await p4.locator('#fpFoot').textContent()) || '';
  check('empty Drive names the per-file scope as the cause', /per-file access/i.test(driveFoot), driveFoot.trim());

  // Pick a real file: octet-stream bytes must still reach the crop stage.
  await p4.locator('#fpRoots button', { hasText: 'OSHAL Storage' }).click();
  await p4.waitForTimeout(400);
  await p4.locator('#fpList .fp-row', { hasText: 'headshot.png' }).click();
  await p4.waitForTimeout(700);
  check('picker closed after choosing', !(await p4.locator('#fileModal').evaluate((el) => el.classList.contains('open'))));
  check('stored octet-stream file reached the crop stage', await p4.locator('#cropStage').isVisible());
  check('generate enabled from a connected-storage photo', !(await p4.locator('#generateBtn').isDisabled()));
  check('no page errors in the picker', err4.length === 0, err4.join(' | '));
  await b4.close();

  server.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
})().catch((e) => { console.error('PROOF ERROR', e); server.close(); process.exitCode = 1; });
