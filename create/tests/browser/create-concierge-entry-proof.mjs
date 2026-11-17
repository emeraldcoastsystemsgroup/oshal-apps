/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Roger, 2026-11-17 02:22Z, in production: "when im in image editor the image concierge button can not be clicked ... portrait has a jarvis ball that opens create-editor not a concierge". A person reaches these as Create's own screens inside Today (/cockpit/?app=create&screen=<toolName>), where the concierge entry is Today's: the bar's Concierge that a framed editor takes over, the floating ball, or the screen's own Concierge. This opens the shipped Today page from the kernel platform export (scripts/one-chat-window/today-host.mjs, with Create's profile built from this manifest as the kernel builds it) over the real Image editor and Portrait Studio's real page, presses every entry a person can see with Playwright's own actionability (a click on a desktop, a tap on a phone; never forced, never a script click), and asserts that the one Jarvis chat window opens as that screen's own application's concierge: /api/jarvis/?concierge=<app>&bot=<its chat bot>, its message box ready. The Image editor is Create's (create-editor); Portrait is Portrait Studio's (portrait-artist), whose page is served from this store as files only (its data routes answer 404 here).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Portrait Studio 1.17.8 (lane CHATCORE3): Portrait's screen is opened as a person who may use Portrait Studio sees it, as Roger does: its permission, catalog, provider, portrait and saved-source reads are answered (none of them was, so the page found no access, built no studio and no concierge, and the proof could not tell a page with its own concierge from one without), and the screen is ready once the studio's Step 1 is on screen. A pane frames its window once it is on screen (jarvis-chat-frame.js lazy), so a window is read once it has its address; read before, an empty address failed the Image editor's phone case at random.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { startEditorFixture, chromium } from './create-editor-fixture.mjs';
import { kernelPlatform, mountWindow, windowKernel, chatWindow } from '../../../scripts/one-chat-window/kernel-window.mjs';
import { mountToday, profileFor, conciergeEntries, openWindows } from '../../../scripts/one-chat-window/today-host.mjs';

const packageRoot = resolve(import.meta.dirname, '../..'), store = resolve(packageRoot, '..');
// The kernel platform the gate pins (or a sibling kernel checkout); a platform without the window fails here, never skips.
const platform = kernelPlatform(resolve(store, '../oshal-kernel/platform'));
const SIZES = [{ name: '1440x900', options: { viewport: { width: 1440, height: 900 } } },
  { name: '412x915', options: { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } }];
/** Create's screens a person opened in Roger's report, and the application whose concierge each must open. */
const SCREENS = [{ screen: 'create-editor', label: 'Image editor', app: 'create', ready: '.ef-shell' },
  { screen: 'create-portrait', label: 'Portrait', app: 'portrait-studio', ready: '#stepPhoto' }];
/** Portrait Studio's page and the modules it loads, as its routes serve them (routes/portrait-studio-routes.js, portrait-face-assets.js). */
const PORTRAIT = { '/api/portrait-studio/app': ['portrait-studio.html', 'text/html'], '/api/portrait-studio/capture-module': ['portrait-capture.js', 'text/javascript'],
  '/api/portrait-studio/face-module': ['portrait-face.js', 'text/javascript'], '/api/portrait-studio/face-cascade': ['portrait-face-cascade.js', 'text/javascript'],
  '/api/portrait-studio/face-model': ['face-model/facefinder.json', 'application/json'] };
/** What Portrait Studio's page reads for a person who may use it, with no portraits yet (portrait-studio/tests/studio-steps.test.mjs). */
const { clientCatalog } = createRequire(resolve(store, 'portrait-studio/oshal-app.yaml'))('./routes/portrait-catalog.js');
const PORTRAIT_READS = { '/api/portrait-studio/permissions': () => ({ permissions: { view: true, read: true, create: true, change: true, export: true }, unavailable: { email: true } }),
  '/api/portrait-studio/provider': () => ({ configured: true, provider: 'fixture-no-generation' }), '/api/portrait-studio/catalog': () => clientCatalog(),
  '/api/portrait-studio/portraits': () => ({ portraits: [] }), '/api/portrait-studio/source-projects': () => ({ projects: [] }) };

let fixture, browser;
before(async () => {
  fixture = await startEditorFixture({ extend: app => {
    for (const [path, [file, type]] of Object.entries(PORTRAIT))
      app.get(path, async (_req, res) => res.type(type).send(await readFile(resolve(store, 'portrait-studio/tools', file))));
    for (const [path, read] of Object.entries(PORTRAIT_READS)) app.get(path, (_req, res) => res.json(read()));
    mountWindow(app, { platform, kernel: windowKernel() });
    mountToday(app, { platform, apps: ['create'] });
  } });
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await fixture?.close(); });

/** Open Create's screen inside Today and wait until the framed screen is there. */
async function openScreen(context, { screen, ready }) {
  const page = await context.newPage();
  await page.goto(`${fixture.origin}/cockpit/?app=create&screen=${screen}`);
  await page.frameLocator('.tool-view-container > iframe').locator(ready).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);   // Today's startup and the framed editor's binding of the bar settle
  return page;
}

/** The one chat window an entry opened, waited for: its address, and its message box ready. */
async function openedWindow(page) {
  let found = [];
  // A pane frames its window once it is on screen (jarvis-chat-frame.js lazy), so a window is read once it has its address.
  for (const until = Date.now() + 15000; Date.now() < until && !(found.length && found.every(Boolean)); await page.waitForTimeout(250)) found = await openWindows(page);
  assert.equal(found.length, 1, `exactly one chat window opens (${JSON.stringify(found)})`);
  const rail = await page.evaluate(() => document.getElementById('chatWorkspaceFrame')?.getAttribute('src') || '');
  await (found[0] === rail ? chatWindow(page, '#chatWorkspaceFrame') : chatWindow(page.frameLocator('.tool-view-container > iframe')));
  return new URL(found[0], fixture.origin);
}

for (const target of SCREENS) for (const { name, options } of SIZES) {
  test(`${name}: Create's ${target.label} in Today - every concierge entry a person sees opens the one chat window as ${target.app}'s concierge`, { timeout: 180000 }, async t => {
    const want = profileFor(target.app).profile.chatAgent, press = locator => options.hasTouch ? locator.tap({ timeout: 5000 }) : locator.click({ timeout: 5000 });
    const context = await browser.newContext(options); t.after(() => context.close());
    const first = await openScreen(context, target), shown = [];
    for (const entry of conciergeEntries(first)) if (await entry.locator.isVisible()) shown.push(entry.name);
    await first.close();
    assert.ok(shown.length > 0, 'a person sees a concierge entry on this screen');
    for (const entryName of shown) {
      const page = await openScreen(context, target), entry = conciergeEntries(page).find(each => each.name === entryName);
      await press(entry.locator);
      const opened = await openedWindow(page);
      assert.equal(opened.pathname, '/api/jarvis/', `${entryName} opens the one Jarvis chat window`);
      assert.equal(opened.searchParams.get('concierge'), target.app, `${entryName} opens ${target.app}'s own concierge (${opened.pathname}${opened.search})`);
      assert.ok([want.agentId, want.name].includes(opened.searchParams.get('bot')), `bound to ${target.app}'s bot ${want.name} (${opened.search})`);
      await page.close();
    }
  });
}
