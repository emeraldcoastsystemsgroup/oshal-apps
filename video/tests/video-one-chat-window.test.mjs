/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Roger, 2026-11-17 02:22Z, in production: the video editor's concierge did not work. On a phone the editor's Concierge (the tool row's ✦ Concierge) opens a sheet holding the one Jarvis chat window, and the window's own Close (.jc-header .jc-panel-close, which says editor-concierge:hide from the pane) never closed that sheet: the editor shell hears that event, but the sheet sits outside the shell, so the sheet stayed over the editor and the next tap on the editor landed on the window ("<iframe class=jarvis-chat-frame> from <dialog open> intercepts pointer events"). This opens Video's editor as a person does, inside the shipped Today page (/cockpit/?app=video&screen=video-editor, scripts/one-chat-window/today-host.mjs, with Video's profile built from this manifest as the kernel builds it) over the real compiled editor routes, the kernel platform's shared UI and the one chat window (scripts/one-chat-window/kernel-window.mjs). At 412x915 with touch and at 1440x900 with a mouse it presses every concierge entry a person can see with Playwright's own actionability (a tap on a phone, a click on a desktop; never forced, never a script click) and asserts that exactly one window opens, at /api/jarvis/?concierge=video&bot=video-editor; that the window's own Close leaves no sheet and no window on screen; and that the editor then takes the next press (Text opens its sheet). The project store is the fixture's strict empty pool (video-editor.fixture.mjs emptyPool): no project is read or written here, the boundary under test is the browser's.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startApi, emptyPool, packageRoot } from './video-editor.fixture.mjs';
import { chromium } from './video-editor-browser.fixture.mjs';
import { kernelPlatform, mountWindow, windowKernel, chatWindow } from '../../scripts/one-chat-window/kernel-window.mjs';
import { mountToday, conciergeEntries, openWindows } from '../../scripts/one-chat-window/today-host.mjs';

// The kernel platform the gate pins (or a sibling kernel checkout, the browser fixture's own default); a platform
// without the window fails here, never skips.
const platform = kernelPlatform(resolve(packageRoot, '../../oshal-kernel/platform'));
const SIZES = [{ name: '412x915', options: { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } },
  { name: '1440x900', options: { viewport: { width: 1440, height: 900 } } }];
/** Video's editor concierge as the page mounts it (tools/editor/editor-foundation-adapter.mjs): the application and its bot. */
const WANT = { app: 'video', bot: 'video-editor' };

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/**
 * @description Start the editor's routes with Today and the one chat window on one loopback server, open Video's editor
 * screen inside Today in a fresh page, and wait until the framed editor is ready and Today has bound its bar.
 * @param {object} t The test. @param {object} context The browser context. @returns {Promise<{page:object,screen:object,errors:string[]}>}
 */
async function openEditorInToday(t, context) {
  const api = await startApi(t, emptyPool(), { extend: app => { mountWindow(app, { platform, kernel: windowKernel() }); mountToday(app, { platform, apps: ['video'] }); } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${api.origin}/cockpit/?app=video&screen=video-editor`);
  const screen = page.frameLocator('.tool-view-container > iframe');
  await screen.locator('html[data-editor-ready="true"]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);   // Today's startup and the framed editor's binding of the bar settle
  return { page, screen, errors };
}

/**
 * @description Wait for the chat windows on screen to be exactly `count`, for up to 15 s.
 * @param {object} page The Today page. @param {number} count How many. @returns {Promise<string[]>} Their addresses.
 */
async function windowsOnScreen(page, count) {
  let found = await openWindows(page);
  for (const until = Date.now() + 15000; Date.now() < until && found.length !== count; await page.waitForTimeout(250)) found = await openWindows(page);
  return found;
}

/**
 * @description Wait for the editor's open sheets (modal dialogs) to be exactly `count`, for up to 5 s.
 * @param {object} screen The framed editor. @param {number} count How many. @returns {Promise<number>} How many are open.
 */
async function sheetsOpen(screen, count) {
  const sheets = screen.locator('dialog[open]');
  let open = await sheets.count();
  for (const until = Date.now() + 5000; Date.now() < until && open !== count; await new Promise(done => setTimeout(done, 100))) open = await sheets.count();
  return open;
}

for (const { name, options } of SIZES) {
  test(`${name}: Video's editor in Today - every concierge entry opens the one chat window as video's concierge, and the window's Close leaves the editor free for the next press`, { timeout: 180000 }, async t => {
    const touch = Boolean(options.hasTouch), press = locator => touch ? locator.tap({ timeout: 5000 }) : locator.click({ timeout: 5000 });
    const context = await browser.newContext(options); t.after(() => context.close());
    const first = await openEditorInToday(t, context), shown = [];
    for (const entry of conciergeEntries(first.page)) if (await entry.locator.isVisible()) shown.push(entry.name);
    await first.page.close();
    assert.ok(shown.length > 0, 'a person sees a concierge entry on the video editor');
    for (const entryName of shown) {
      const { page, screen, errors } = await openEditorInToday(t, context), entry = conciergeEntries(page).find(each => each.name === entryName);
      await press(entry.locator);
      const opened = await windowsOnScreen(page, 1);
      assert.equal(opened.length, 1, `${entryName} opens exactly one chat window (${JSON.stringify(opened)})`);
      const address = new URL(opened[0], 'http://window.fixture');
      assert.equal(address.pathname, '/api/jarvis/', `${entryName} opens the one Jarvis chat window`);
      assert.equal(address.searchParams.get('concierge'), WANT.app, `${entryName} opens video's own concierge (${address.search})`);
      assert.equal(address.searchParams.get('bot'), WANT.bot, `bound to video's bot ${WANT.bot} (${address.search})`);
      // On a phone the window sits in the editor's Concierge sheet; on a desktop in the editor's concierge column.
      const sheet = screen.locator('dialog[open]');
      if (touch) assert.equal(await sheet.locator('iframe.jarvis-chat-frame').count(), 1, 'on a phone the Concierge sheet holds the window');
      const chat = await chatWindow(screen);
      await press(chat.locator('.jc-header .jc-panel-close'));
      assert.equal(await sheetsOpen(screen, 0), 0, `the window's own Close closes the Concierge sheet (${entryName})`);
      assert.deepEqual(await windowsOnScreen(page, 0), [], 'no chat window is left on screen');
      // The editor takes the next press: nothing of the window is left over it.
      await press(screen.locator('[data-ds-toolrow]').getByRole('button', { name: 'Text', exact: true }));
      await screen.locator('dialog[open] .ds-layer-title').filter({ hasText: /^Text$/ }).waitFor({ timeout: 5000 });
      assert.deepEqual(errors, []);
      await page.close();
    }
  });
}
