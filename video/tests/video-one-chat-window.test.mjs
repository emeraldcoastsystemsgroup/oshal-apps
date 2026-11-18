/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Roger, 2026-11-17 02:22Z, in production: the video editor's concierge did not work. On a phone the editor's Concierge (the tool row's ✦ Concierge) opens a sheet holding the one Jarvis chat window, and the window's own Close (.jc-header .jc-panel-close, which says editor-concierge:hide from the pane) never closed that sheet: the editor shell hears that event, but the sheet sits outside the shell, so the sheet stayed over the editor and the next tap on the editor landed on the window ("<iframe class=jarvis-chat-frame> from <dialog open> intercepts pointer events"). This opens Video's editor as a person does, inside the shipped Today page (/cockpit/?app=video&screen=video-editor, scripts/one-chat-window/today-host.mjs, with Video's profile built from this manifest as the kernel builds it) over the real compiled editor routes, the kernel platform's shared UI and the one chat window (scripts/one-chat-window/kernel-window.mjs). At 412x915 with touch and at 1440x900 with a mouse it presses every concierge entry a person can see with Playwright's own actionability (a tap on a phone, a click on a desktop; never forced, never a script click) and asserts that exactly one window opens, at /api/jarvis/?concierge=video&bot=video-editor; that the window's own Close leaves no sheet and no window on screen; and that the editor then takes the next press (Text opens its sheet). The project store is the fixture's strict empty pool (video-editor.fixture.mjs emptyPool): no project is read or written here, the boundary under test is the browser's.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.14.4: also cover Create's Video screen (/cockpit/?app=create&screen=create-video) and guard the cold-load / early-press window after switching to create-video inside Create. Before 1.14.4, while editor.html fetched its 15 ES modules and awaited editor-foundation/editor-assistant, Today still drew Create's #jarvisOrbFab instead of Video's bar Concierge, and pressing Concierge during that load window opened Today's rail only for createEditorFoundation + editor-concierge:hide to collapse both and leave zero chat windows on screen.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startApi, emptyPool, packageRoot } from './video-editor.fixture.mjs';
import { chromium } from './video-editor-browser.fixture.mjs';
import { kernelPlatform, mountWindow, windowKernel, chatWindow } from '../../scripts/one-chat-window/kernel-window.mjs';
import { mountToday, conciergeEntries, openWindows } from '../../scripts/one-chat-window/today-host.mjs';

const platform = kernelPlatform(resolve(packageRoot, '../../oshal-kernel/platform'));
const SIZES = [
  { name: '412x915', options: { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } },
  { name: '1440x900', options: { viewport: { width: 1440, height: 900 } } },
];
const PLACES = [
  { name: "Video's editor", address: '/cockpit/?app=video&screen=video-editor' },
  { name: "Create's Video screen", address: '/cockpit/?app=create&screen=create-video' },
];
const WANT = { app: 'video', bot: 'video-editor' };

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/**
 * @description Start loopback Today + one-chat-window + real compiled Video editor routes.
 * @param {object} t Node test context.
 * @returns {Promise<{origin:string}>} Loopback API origin.
 */
async function startTodayVideo(t) {
  return startApi(t, emptyPool(), {
    extend: (app) => {
      app.get('/api/create/home', (_req, res) => res.type('html').send('<!doctype html><title>Create Home</title><main>Create Home</main>'));
      mountWindow(app, { platform, kernel: windowKernel() });
      mountToday(app, { platform, apps: ['video', 'create'] });
    },
  });
}

/**
 * @description Open `address` inside Today in a fresh page and wait until the framed Video editor is ready.
 * @param {object} t Node test context.
 * @param {object} context BrowserContext.
 * @param {string} address Cockpit path+query.
 * @returns {Promise<{page:object,screen:object,errors:string[]}>}
 */
async function openEditorInToday(t, context, address) {
  const api = await startTodayVideo(t);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${api.origin}${address}`);
  const screen = page.frameLocator('.tool-view-container > iframe');
  await screen.locator('html[data-editor-ready="true"]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  return { page, screen, errors };
}

/**
 * @description Wait for open chat windows on screen (with non-empty src when opening) to equal `count`.
 * @param {object} page Outer Today page.
 * @param {number} count Expected open window count.
 * @returns {Promise<string[]>} Open window src URLs.
 */
async function windowsOnScreen(page, count) {
  let found = await openWindows(page);
  const ready = () => (count === 0 ? found.length === 0 : found.length === count && found.every(Boolean));
  for (const until = Date.now() + 15000; Date.now() < until && !ready(); await page.waitForTimeout(250)) {
    found = await openWindows(page);
  }
  return found;
}

/**
 * @description Wait for open modal dialogs in the framed Video editor to equal `count`.
 * @param {object} screen Framed Video editor locator.
 * @param {number} count Expected open dialog count.
 * @returns {Promise<number>} Open dialog count.
 */
async function sheetsOpen(screen, count) {
  const sheets = screen.locator('dialog[open]');
  let open = await sheets.count();
  for (const until = Date.now() + 5000; Date.now() < until && open !== count; await new Promise((done) => setTimeout(done, 100))) {
    open = await sheets.count();
  }
  return open;
}

/**
 * @description Assert an opened window is Video's own concierge and closes cleanly via its own Close button.
 * @param {object} page Outer Today page.
 * @param {object} screen Framed Video editor.
 * @param {function(object):Promise} press Real pointer click or tap.
 * @param {boolean} touch Whether touch mode is active.
 * @param {string} entryName Entry label for diagnostics.
 */
async function verifyAndCloseVideoWindow(page, screen, press, touch, entryName) {
  const opened = await windowsOnScreen(page, 1);
  assert.equal(opened.length, 1, `${entryName} opens exactly one chat window (${JSON.stringify(opened)})`);
  const address = new URL(opened[0], 'http://window.fixture');
  assert.equal(address.pathname, '/api/jarvis/', `${entryName} opens the one Jarvis chat window`);
  assert.equal(address.searchParams.get('concierge'), WANT.app, `${entryName} opens video's own concierge (${address.search})`);
  assert.equal(address.searchParams.get('bot'), WANT.bot, `bound to video's bot ${WANT.bot} (${address.search})`);
  if (touch) {
    assert.equal(await screen.locator('dialog[open] iframe.jarvis-chat-frame').count(), 1, 'on a phone the Concierge sheet holds the window');
  }
  const chat = await chatWindow(screen);
  await press(chat.locator('.jc-header .jc-panel-close'));
  assert.equal(await sheetsOpen(screen, 0), 0, `the window's own Close closes the Concierge sheet (${entryName})`);
  assert.deepEqual(await windowsOnScreen(page, 0), [], 'no chat window is left on screen');
}

for (const place of PLACES) for (const { name, options } of SIZES) {
  test(`${name}: ${place.name} in Today - every concierge entry opens video's concierge, and Close leaves the editor free`, { timeout: 180000 }, async (t) => {
    const touch = Boolean(options.hasTouch);
    const press = (locator) => (touch ? locator.tap({ timeout: 5000 }) : locator.click({ timeout: 5000 }));
    const context = await browser.newContext(options);
    t.after(() => context.close());
    const first = await openEditorInToday(t, context, place.address);
    const shown = [];
    for (const entry of conciergeEntries(first.page)) {
      if (await entry.locator.isVisible()) shown.push(entry.name);
    }
    await first.page.close();
    assert.ok(shown.length > 0, `a person sees a concierge entry on ${place.name}`);
    for (const entryName of shown) {
      const { page, screen, errors } = await openEditorInToday(t, context, place.address);
      const entry = conciergeEntries(page).find((each) => each.name === entryName);
      await press(entry.locator);
      await verifyAndCloseVideoWindow(page, screen, press, touch, entryName);
      await press(screen.locator('[data-ds-toolrow]').getByRole('button', { name: 'Text', exact: true }));
      await screen.locator('dialog[open] .ds-layer-title').filter({ hasText: /^Text$/ }).waitFor({ timeout: 5000 });
      assert.deepEqual(errors, []);
      await page.close();
    }
  });
}

for (const { name, options } of SIZES) {
  test(`${name}: Create's Video screen cold-load early press - #jarvisOrbFab steps aside at once and pressing Concierge while modules load opens video's concierge`, { timeout: 180000 }, async (t) => {
    const touch = Boolean(options.hasTouch);
    const press = (locator) => (touch ? locator.tap({ timeout: 5000 }) : locator.click({ timeout: 5000 }));
    const api = await startTodayVideo(t);
    const context = await browser.newContext(options);
    t.after(() => context.close());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    let releaseAdapter;
    const adapterGate = new Promise((done) => { releaseAdapter = done; });
    await page.route('**/api/video/editor/assets/editor-foundation-adapter.mjs', async (route) => {
      await adapterGate;
      await route.continue();
    });

    await page.goto(`${api.origin}/cockpit/?app=create`);
    await page.frameLocator('.tool-view-container > iframe').locator('main').waitFor({ timeout: 15000 });
    await page.waitForTimeout(600);
    await page.evaluate(() => { window.postMessage({ type: 'app-navigate', tool: 'create-video' }, location.origin); });
    const screen = page.frameLocator('.tool-view-container > iframe');
    await screen.locator('header.bar').waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(400);

    const earlyShown = [];
    for (const entry of conciergeEntries(page)) {
      if (await entry.locator.isVisible()) earlyShown.push(entry);
    }
    assert.ok(earlyShown.length > 0, `${name}: a concierge entry is visible while Video's editor modules are still loading`);
    await press(earlyShown[0].locator);
    releaseAdapter();
    await screen.locator('html[data-editor-ready="true"]').waitFor({ timeout: 20000 });

    await verifyAndCloseVideoWindow(page, screen, press, touch, `${earlyShown[0].name} (early press during module load)`);
    assert.notEqual(earlyShown[0].name, 'the floating ball', `${name}: Create's floating ball stepped aside as soon as Video's editor screen painted`);
    assert.deepEqual(errors, []);
    await page.close();
  });
}
