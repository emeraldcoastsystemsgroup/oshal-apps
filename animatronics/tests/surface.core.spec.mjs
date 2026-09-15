/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The actual packaged page in headless Chromium over the compiled
 *                     |                             | routes on loopback (tests/core.fixture.js), with a fake Web
 *                     |                             | Serial port injected as `navigator.serial` that answers the way
 *                     |                             | the reference firmware does (HELLO to H, OK to frames and
 *                     |                             | clamps, ESTOP to E): a rig is created from the skull template,
 *                     |                             | a jog slider moves the pupil, a pose is captured, BLINK
 *                     |                             | rehearses to an ok verdict with the report table filled, the
 *                     |                             | controller connects, ARM (confirmed) writes hello + seven clamp
 *                     |                             | lines + the neutral frame and the hello reply names the board,
 *                     |                             | TALK plays and every frame line reaches the port, E-STOP writes
 *                     |                             | `E*45` last and the rig is disarmed on the server — and the
 *                     |                             | page raises no errors.
 *
 * FRAMEWORK-COUPLED: needs a core checkout for express and playwright. Not part of the store-CI
 * wildcard; run locally: OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/surface.core.spec.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startApp } = require('./core.fixture.js');

let app, browser, page;
const errors = [];
const rig = () => app.pool.tables.animatronic_rig[0];
const written = () => page.evaluate(() => window.__serial.written.slice());

/** Installed before any page script: a Web Serial port that replies like the reference firmware. */
function installFakeSerial() {
  const enc = new TextEncoder(); const dec = new TextDecoder();
  const checksum = (b) => { let x = 0; for (let i = 0; i < b.length; i += 1) x ^= b.charCodeAt(i) & 0xff; return x.toString(16).toUpperCase().padStart(2, '0'); };
  let feed = null;
  const reply = (body) => { if (feed) feed.enqueue(enc.encode(body + '*' + checksum(body) + '\n')); };
  window.__serial = { written: [], opened: null, requested: 0 };
  const port = {
    async open(o) { window.__serial.opened = o; },
    async close() { if (feed) { try { feed.close(); } catch (_) { /* closed */ } } },
    readable: new ReadableStream({ start(c) { feed = c; } }),
    writable: new WritableStream({ write(chunk) {
      const text = dec.decode(chunk); window.__serial.written.push(text);
      const body = text.trim().replace(/\*[0-9A-F]{2}$/, '');
      if (body === 'H') reply('HELLO oshal-animatronics/1 board=pca9685 channels=16');
      else if (body === 'E') reply('ESTOP');
      else if (body === 'R') reply('OK R');
      else if (body.startsWith('L ')) reply('OK L ' + body.split(' ')[1]);
      else if (body.startsWith('F ')) reply('OK ' + body.split(' ')[1]);
    } }),
  };
  Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort: async () => { window.__serial.requested += 1; return port; } } });
}

test.before(async () => {
  app = await startApp({ defaultSub: 'alice' });
  const { chromium } = app.coreRequire('playwright');
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept('LOOK_TEST') : d.accept()));
  await page.addInitScript(installFakeSerial);
  await page.goto(app.baseUrl + '/api/animatronics/app');
  await page.waitForFunction(() => document.querySelectorAll('#template-select option').length === 3);
});
test.after(async () => { if (browser) await browser.close(); if (app) await app.stop(); });

test('a rig is created from the skull template and the editor shows its channels, poses and scenarios', async () => {
  assert.equal(await page.locator('#empty').isVisible(), true);
  await page.selectOption('#template-select', 'skull');
  await page.click('#new-rig');
  await page.waitForSelector('#editor:not([hidden])');
  assert.equal(await page.locator('#channels tbody tr').count(), 7);
  assert.equal(await page.locator('#rigs .rig-item').count(), 1);
  const scenarios = await page.locator('#scenario-select option').allTextContents();
  assert.ok(scenarios.includes('BLINK') && scenarios.includes('TALK') && scenarios.includes('SCARE'), scenarios.join(','));
  assert.ok((await page.locator('#poses .chip').count()) >= 10);
  assert.equal(await page.locator('#jog input[type=range]').count(), 7);
  assert.match(await page.locator('#axes-label').textContent(), /jaw\.open/);
  assert.equal(await page.locator('#armed-pill').textContent(), 'disarmed');
});

test('a jog slider moves the pupil in the drawing, and the slider angles capture as a pose', async () => {
  const before = await page.locator('svg#view .pupil').first().getAttribute('cx');
  await page.locator('#jog input[data-axis="eyes.pan"]').evaluate((el) => { el.value = '30'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const after = await page.locator('svg#view .pupil').first().getAttribute('cx');
  assert.equal(Number(after) - Number(before), 14, 'full right pan moves the pupil 14 units');
  await page.click('#capture-pose');
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#poses .chip span')).some((s) => s.textContent === 'LOOK_TEST'));
  assert.equal(rig().poses.LOOK_TEST['eyes.pan'], 30);
  assert.equal(rig().poses.LOOK_TEST['jaw.open'], 0);
});

test('BLINK rehearses to an ok verdict with the report filled and the run logged', async () => {
  await page.selectOption('#scenario-select', 'BLINK');
  assert.match(await page.locator('#scenario-json').inputValue(), /"EYES_CLOSED"/);
  await page.click('#rehearse');
  await page.waitForFunction(() => /^ok — 320 ms/.test(document.querySelector('#verdict')?.textContent || ''));
  assert.equal(await page.locator('#report-channels tbody tr').count(), 7);
  assert.match(await page.locator('#power').textContent(), /peak 0\.55 A/);
  await page.waitForFunction(() => document.querySelectorAll('#runs li .badge').length >= 1);
  assert.equal(await page.locator('#runs li .badge').first().textContent(), 'rehearse');
  assert.equal(await page.locator('#play').isDisabled(), true, 'play stays disabled until the rig is armed with a controller');
});

test('connect, arm: hello, seven clamps and the neutral frame reach the port, and the board answers', async () => {
  await page.click('#connect');
  await page.waitForFunction(() => /controller: connected/.test(document.querySelector('#link-pill').textContent));
  assert.deepEqual(await page.evaluate(() => window.__serial.opened), { baudRate: 115200 });
  assert.equal(await page.locator('#arm').isDisabled(), false);
  await page.click('#arm');
  await page.waitForFunction(() => document.querySelector('#armed-pill').textContent === 'ARMED');
  const lines = await written();
  assert.equal(lines[0], 'H*48\n');
  assert.equal(lines.filter((l) => l.startsWith('L ')).length, 7);
  assert.match(lines[8], /^F 0 0=1450,1=1450,2=1450,3=1450,4=1500,5=1500,6=1500\*[0-9A-F]{2}\n$/);
  await page.waitForFunction(() => /pca9685\/16/.test(document.querySelector('#link-pill').textContent));
  assert.equal(rig().armed, true);
  assert.equal(await page.locator('#play').isDisabled(), false);
});

test('TALK plays: every frame line the server compiled reaches the port and the believed pose advances', async () => {
  const before = (await written()).length;
  await page.selectOption('#scenario-select', 'TALK');
  await page.click('#play');
  await page.waitForFunction(() => document.querySelector('#stream-state').textContent === 'idle' && window.__serial.written.length > 60, null, { timeout: 15000 });
  const lines = (await written()).slice(before);
  assert.equal(lines.length, 66, 'TALK is 1300 ms = 66 frames at 50 Hz');
  assert.ok(lines.every((l) => /^F \d+( [0-9=,]+)?\*[0-9A-F]{2}\n$/.test(l)));
  assert.equal(rig().current_pose['jaw.open'], 0, 'TALK ends with the jaw closed');
  assert.equal(await page.locator('#runs li .badge').first().textContent(), 'play');
});

test('E-STOP writes E*45 last, the rig is disarmed on the server, and the page raised no errors', async () => {
  await page.click('#estop');
  await page.waitForFunction(() => document.querySelector('#armed-pill').textContent === 'disarmed');
  const lines = await written();
  assert.equal(lines[lines.length - 1], 'E*45\n');
  assert.equal(rig().armed, false);
  await page.waitForFunction(() => /estopped/.test(document.querySelector('#link-pill').textContent));
  assert.equal(await page.locator('#release').isDisabled(), false);
  assert.equal(await page.locator('#play').isDisabled(), true);
  assert.deepEqual(errors, []);
});
