/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard every concierge entry on Motion Studio inside Today, both standalone (/cockpit/?app=motion-studio) and as Create's Motion Studio screen (/cockpit/?app=create&screen=create-motion-studio), at 412x915 with touch and at 1440x900 with a mouse. Each visible concierge entry is pressed with Playwright's own pointer actionability (never forced, never a script click) and must open Motion Studio's own one Jarvis chat window (/api/jarvis/?concierge=motion-studio&bot=motion-editor); pressing the window's own Close (.jc-header .jc-panel-close) must close the phone's Concierge sheet and leave the editor free to take the next press on Layers.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  kernelPlatform, mountWindow, windowKernel, chatWindow, windowControls, sendInWindow, toolchain,
} from '../../scripts/one-chat-window/kernel-window.mjs';
import { mountToday, conciergeEntries, openWindows } from '../../scripts/one-chat-window/today-host.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const store = resolve(root, '..');
const platform = kernelPlatform(resolve(store, '../oshal-kernel/platform'));
const express = toolchain('express');
const { chromium } = toolchain('playwright');

const SIZES = [
  { name: '412x915', options: { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } },
  { name: '1440x900', options: { viewport: { width: 1440, height: 900 } } },
];
const PLACES = [
  { name: 'Motion Studio alone', address: '/cockpit/?app=motion-studio' },
  { name: "Create's Motion Studio screen", address: '/cockpit/?app=create&screen=create-motion-studio' },
];
const UI_FILES = [
  'workbench.mjs', 'editor-foundation-adapter.mjs', 'editor-handoff.mjs', 'workbench.css',
  'native-json.mjs', 'bundle-client.mjs', 'sha256-stream.mjs', 'value-patch.mjs',
  'render-client.mjs', 'media-workbench.mjs', 'busy-retry.mjs',
];

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/**
 * @description Mount Motion Studio's workbench HTML, UI modules and read-only bootstrap endpoints on an Express app.
 * @param {object} app Express application.
 */
function motionRoutes(app) {
  app.get('/api/motion-studio/app', (_req, res) => res.sendFile(resolve(root, 'tools/workbench.html')));
  for (const file of UI_FILES) {
    app.get(`/api/motion-studio/ui/${file}`, (_req, res) => {
      res.type(file.endsWith('.css') ? 'text/css' : 'text/javascript').sendFile(resolve(root, 'tools', file));
    });
  }
  app.get('/api/motion-studio/permissions', (_req, res) => res.json({
    permissions: { view: true, read: true, create: true, change: true, delete: true, export: true, copy: true },
  }));
  app.get('/api/motion-studio/editing-contract', (_req, res) => res.json({
    schemaVersion: 1,
    engine: { ticksPerSecond: 30000, commands: [], effects: [], fonts: [] },
  }));
  app.get('/api/motion-studio/projects', (_req, res) => res.json({ projects: [] }));
  app.get('/api/motion-studio/assets', (_req, res) => res.json({ assets: [] }));
}

/**
 * @description Start loopback Today + one-chat-window + Motion Studio server and open `place` in a fresh page.
 * @param {object} t Node test context.
 * @param {object} context Playwright BrowserContext.
 * @param {{address:string}} place Place descriptor.
 * @returns {Promise<{page:object,screen:object,kernel:object,errors:string[]}>}
 */
async function openMotionInToday(t, context, place) {
  const app = express();
  const kernel = windowKernel({ answer: () => 'Motion Studio fixture answer.' });
  motionRoutes(app);
  mountWindow(app, { platform, kernel });
  mountToday(app, { platform, apps: ['motion-studio', 'create'] });
  app.use((_req, res) => res.status(404).json({ error: 'outside_fixture' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${server.address().port}${place.address}`);
  const screen = page.frameLocator('.tool-view-container > iframe');
  await screen.locator('#status').filter({ hasText: 'Ready' }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  return { page, screen, kernel, errors };
}

/**
 * @description Wait for open chat windows on Today to reach `count` (with non-empty src when opening).
 * @param {object} page Outer Today page.
 * @param {number} count Expected window count.
 * @returns {Promise<string[]>} Open window src URLs.
 */
async function windowsOnScreen(page, count) {
  let found = await openWindows(page);
  const ready = () => (count === 0 ? found.length === 0 : found.length === count && found.every(Boolean));
  for (const until = Date.now() + 15000; Date.now() < until && !ready(); await page.waitForTimeout(200)) {
    found = await openWindows(page);
  }
  return found;
}

/**
 * @description Wait for open modal dialogs inside the framed Motion Studio screen to equal `count`.
 * @param {object} screen Framed Motion Studio locator.
 * @param {number} count Expected open dialog count.
 * @returns {Promise<number>} Actual open dialog count.
 */
async function sheetsOpen(screen, count) {
  const sheets = screen.locator('dialog[open]');
  let open = await sheets.count();
  for (const until = Date.now() + 5000; Date.now() < until && open !== count; await new Promise((done) => setTimeout(done, 100))) {
    open = await sheets.count();
  }
  return open;
}

for (const place of PLACES) for (const { name, options } of SIZES) {
  test(`${name}: ${place.name} - every concierge entry opens Motion Studio's own chat window, and the window's Close leaves the editor free`, { timeout: 240000 }, async (t) => {
    const touch = Boolean(options.hasTouch);
    const press = (locator) => (touch ? locator.tap({ timeout: 5000 }) : locator.click({ timeout: 5000 }));
    const context = await browser.newContext(options);
    t.after(() => context.close());

    const first = await openMotionInToday(t, context, place);
    const shown = [];
    for (const entry of conciergeEntries(first.page)) {
      if (await entry.locator.isVisible()) shown.push(entry.name);
    }
    await first.page.close();
    assert.ok(shown.length > 0, `a person sees a concierge entry on ${place.name} (${name})`);

    let asked = false;
    for (const entryName of shown) {
      const { page, screen, kernel, errors } = await openMotionInToday(t, context, place);
      const entry = conciergeEntries(page).find((each) => each.name === entryName);
      await press(entry.locator);
      const opened = await windowsOnScreen(page, 1);
      assert.equal(opened.length, 1, `${entryName} opens exactly one chat window (${JSON.stringify(opened)})`);
      const address = new URL(opened[0], 'http://window.fixture');
      assert.equal(address.pathname, '/api/jarvis/', `${entryName} opens the one Jarvis chat window`);
      assert.equal(address.searchParams.get('concierge'), 'motion-studio', `${entryName} opens motion-studio's concierge (${address.search})`);
      assert.equal(address.searchParams.get('bot'), 'motion-editor', `bound to motion-editor (${address.search})`);
      if (touch) {
        assert.equal(await screen.locator('dialog[open] iframe.jarvis-chat-frame').count(), 1, 'on a phone the Concierge sheet holds the window');
      }
      const chat = await chatWindow(screen);
      await windowControls(chat);
      if (!asked) {
        asked = true;
        const { ask } = await sendInWindow(chat, 'Suggest an opening title card.', press, kernel);
        assert.equal(ask.bot, 'motion-editor', 'turn reaches motion-editor');
        assert.equal(ask.context.app, 'motion-studio', 'turn carries context.app=motion-studio');
      }
      await press(chat.locator('.jc-header .jc-panel-close'));
      assert.equal(await sheetsOpen(screen, 0), 0, `the window's own Close closes the Concierge sheet (${entryName})`);
      assert.deepEqual(await windowsOnScreen(page, 0), [], 'no chat window is left on screen');
      await press(screen.locator('[data-ds-toolrow]').getByRole('button', { name: 'Layers', exact: true }));
      await screen.locator('dialog[open] .ds-layer-title').filter({ hasText: /^Layers$/ }).waitFor({ timeout: 5000 });
      assert.deepEqual(errors, [], 'no page error');
      await page.close();
    }
  });
}
