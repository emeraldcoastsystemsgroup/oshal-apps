/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 9: the concierge said "Connect my laptop camera" was disabled while
 *   only the Control panel's Connect was. In Chromium at 412x915, the shipped camera-ops.html in the shell's application frame is
 *   read by the kernel's REAL screen snapshot (crates/api/src/shell_screen_state.js captureScreenState, what the concierge
 *   receives): "Connect my laptop camera" is an enabled button, and the Control panel's Connect and Disconnect are disabled with
 *   a hint that they act on the camera selected in the list; the persona says a disabled mark belongs only to its own button.
 *   Seams: every /api/camera read answers an empty fleet, and the shell's shared theme assets are empty stand-ins. Needs the
 *   store toolchain (express, playwright, chromium) and the kernel checkout (OSHAL_KERNEL_ROOT).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const KERNEL = process.env.OSHAL_KERNEL_ROOT || path.join(os.homedir(), 'Documents', 'projects', 'oshal-kernel');
const SNAPSHOT = path.join(KERNEL, 'crates', 'api', 'src', 'shell_screen_state.js');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

async function serve() {
  const app = express();
  app.get('/shell', (_req, res) => res.type('html').send('<!doctype html><title>shell</title><iframe id="active-app-frame" src="/api/camera/app" style="width:412px;height:2000px;border:0"></iframe><script src="/snapshot.js"></script>'));
  app.get('/snapshot.js', (_req, res) => res.type('js').send(fs.readFileSync(SNAPSHOT, 'utf8')));
  app.get('/api/camera/app', (_req, res) => res.sendFile(path.join(PKG, 'tools', 'camera-ops.html')));
  app.use('/api/camera', (_req, res) => res.json({ fleet: [], items: [], metrics: [] }));
  app.get(/^\/shared\/.*\.js$/, (_req, res) => res.type('js').send(''));
  app.get(/^\/shared\/.*\.css$/, (_req, res) => res.type('css').send(''));
  app.use((_req, res) => res.status(404).type('js').send(''));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('the concierge\'s snapshot reads the laptop Connect as enabled and names what the disabled Connect needs', async (t) => {
  assert.ok(fs.existsSync(SNAPSHOT), `the kernel checkout must be present (set OSHAL_KERNEL_ROOT); missing ${SNAPSHOT}`);
  const { server, base } = await serve();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise((r) => server.close(r)); });
  const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true })).newPage();
  await page.goto(`${base}/shell`);
  const frame = page.frameLocator('#active-app-frame');
  await frame.locator('#btnLocalConnect').waitFor();
  const text = await page.evaluate(() => window.captureScreenState(document.getElementById('active-app-frame')).text);
  const lines = text.split('\n');
  const laptop = lines.find((l) => l.startsWith('[button] Connect my laptop camera'));
  assert.equal(laptop, '[button] Connect my laptop camera', text);
  assert.ok(lines.includes('[button] Connect (disabled: Opens the link to the camera selected in the list; select a camera first)'), text);
  assert.ok(lines.includes('[button] Disconnect (disabled: Closes the link to the camera selected in the list)'), text);
  const persona = fs.readFileSync(path.join(PKG, 'personas', 'camera-operator.yaml'), 'utf8');
  assert.match(persona, /a "\(disabled\)" mark belongs only to the one button on\s+that line/);
});
