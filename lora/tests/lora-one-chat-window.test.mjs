/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard every concierge entry on LoRA Studio inside Today, both standalone (/cockpit/?app=lora) and as Create's LoRA screen (/cockpit/?app=create&screen=create-lora), at 1440x900 with a mouse and at 412x915 with touch, with no saved characters and with a saved character. Each visible concierge entry is pressed with Playwright's own pointer actionability (never forced, never a script click) and must open LoRA Studio's own one Jarvis chat window (/api/jarvis/?concierge=lora&bot=lora-director), show all window controls, deliver messages to lora-director with no document before selection and with the saved character UUID/revision once selected, and dismiss cleanly when the window's own Close button is pressed.
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

const CHARACTER_ID = '6831f88d-26b6-4d21-952d-2b92cf6c2e10';
const CHARACTER = Object.freeze({
  subject: 'fixture-sprite',
  display_name: 'Fixture Sprite',
  trigger_word: 'fxtsprite',
  hero_image: 'hero.png',
  ident_prompt: 'Illustrated mascot in blue coat',
  storage_key: 'owned-fixture-sprite',
  version_count: 1,
  latest_version: 1,
  active_version: 1,
  latest_score: 0.91,
});

const SIZES = [
  { name: '1440x900', options: { viewport: { width: 1440, height: 900 } } },
  { name: '412x915', options: { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } },
];
const PLACES = [
  { name: 'LoRA Studio alone', address: '/cockpit/?app=lora' },
  { name: "Create's LoRA screen", address: '/cockpit/?app=create&screen=create-lora' },
];
const VIEWS = [
  { name: 'New character start', characters: () => [], ready: () => '#characterForm' },
  { name: 'saved characters', characters: () => [CHARACTER], ready: (touch) => (touch ? '#phoneHome [data-home-index="0"]' : '[data-char-index="0"]') },
];

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/**
 * @description Mount LoRA Studio's HTML, upload module and read-only fixture endpoints on an Express app.
 * @param {object} app Express application.
 * @param {{characters:Array<object>}} data Character rows returned by GET /api/lora/characters.
 */
function loraRoutes(app, { characters }) {
  app.get('/api/lora/ui', (_req, res) => res.sendFile(resolve(root, 'tools/lora.html')));
  app.get('/api/lora/ui/photo-upload.mjs', (_req, res) => res.type('text/javascript').sendFile(resolve(root, 'tools/lora-photo-upload.mjs')));
  app.get('/api/lora/worker', (_req, res) => res.json({ gpuWorker: false }));
  app.get('/api/lora/characters', (_req, res) => res.json({ characters }));
  app.get('/api/lora/characters/:subject/editor', (req, res) => {
    const hit = characters.find((c) => c.subject === req.params.subject);
    if (!hit) return res.status(404).json({ error: 'character_not_found' });
    return res.json({
      subject: hit.subject, characterId: CHARACTER_ID, displayName: hit.display_name,
      revision: 2, canConfigure: true, canExecute: false,
    });
  });
  app.get('/api/lora/dataset', (_req, res) => res.json({ images: [] }));
  app.get('/api/lora/models', (_req, res) => res.json({ models: [] }));
}

/**
 * @description File document-bound turns under doc:<app>:<recordId> as the kernel does.
 * @param {object} kernel Stand-in windowKernel.
 * @returns {object} Wrapped kernel stand-in.
 */
function filedUnderDocument(kernel) {
  const handle = kernel.handle;
  kernel.handle = (request) => {
    const answer = handle(request);
    const job = /^saved-(\d+)$/.exec(answer?.json?.jobId || '');
    const ask = job && kernel.asks[Number(job[1]) - 1];
    if (request.url.pathname === '/api/jarvis/ask/result' && ask?.context?.recordId) {
      answer.json = { ...answer.json, sessionId: `doc:${ask.context.app}:${ask.context.recordId}` };
    }
    return answer;
  };
  return kernel;
}

/**
 * @description Start loopback Today + one-chat-window + LoRA Studio server for one test.
 * @param {object} t Node test context.
 * @param {{characters:Array<object>}} data Initial character fixture data.
 * @returns {Promise<{origin:string,kernel:object}>} Server origin and kernel stand-in.
 */
async function host(t, data) {
  const app = express();
  const kernel = filedUnderDocument(windowKernel({ answer: () => 'LoRA Studio fixture answer.' }));
  loraRoutes(app, data);
  mountWindow(app, { platform, kernel });
  mountToday(app, { platform, apps: ['lora', 'create'] });
  app.use((_req, res) => res.status(404).json({ error: 'outside_fixture' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  });
  return { origin: `http://127.0.0.1:${server.address().port}`, kernel };
}

/**
 * @description Open LoRA Studio inside Today and wait for its target view to settle.
 * @param {object} context BrowserContext.
 * @param {string} origin Loopback origin.
 * @param {{address:string}} place Place descriptor.
 * @param {{ready:function(boolean):string}} view View descriptor.
 * @param {boolean} touch Whether touch mode is active.
 * @returns {Promise<{page:object,screen:object,errors:string[]}>}
 */
async function openPlace(context, origin, place, view, touch) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(origin + place.address);
  const screen = page.frameLocator('.tool-view-container > iframe');
  await screen.locator(view.ready(touch)).first().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(1500);
  return { page, screen, errors };
}

/**
 * @description Wait until the open chat windows on Today equal `count` (with non-empty src when opening).
 * @param {object} page Playwright Page.
 * @param {number} count Expected open window count.
 * @returns {Promise<string[]>} Open window src URLs.
 */
async function waitWindows(page, count) {
  let found = await openWindows(page);
  const ready = () => (count === 0 ? found.length === 0 : found.length === count && found.every(Boolean));
  for (const until = Date.now() + 15000; Date.now() < until && !ready(); await page.waitForTimeout(200)) {
    found = await openWindows(page);
  }
  assert.equal(found.length, count, `expected ${count} open chat window(s), got ${JSON.stringify(found)}`);
  return found;
}

/**
 * @description Verify the opened window belongs to LoRA Studio's own concierge pane and has live controls.
 * @param {object} page Outer Today page.
 * @param {object} screen Framed LoRA Studio locator.
 * @param {string} where Diagnostic label.
 * @returns {Promise<object>} Inner chat window FrameLocator.
 */
async function verifyLoraWindow(page, screen, where) {
  const found = await waitWindows(page, 1);
  const rail = await page.evaluate(() => document.getElementById('chatWorkspaceFrame')?.getAttribute('src') || '');
  const address = new URL(found[0], 'http://window.fixture');
  assert.equal(address.pathname, '/api/jarvis/', `${where}: opens the one Jarvis chat window`);
  assert.equal(found[0] === rail, false, `${where}: opens LoRA Studio's own pane, not Today's outer rail (${found[0]})`);
  assert.equal(address.searchParams.get('concierge'), 'lora', `${where}: bound to concierge=lora (${address.search})`);
  assert.equal(address.searchParams.get('bot'), 'lora-director', `${where}: bound to bot=lora-director (${address.search})`);
  const chat = await chatWindow(screen);
  await windowControls(chat);
  return chat;
}

for (const place of PLACES) for (const view of VIEWS) for (const { name, options } of SIZES) {
  test(`${name}: ${place.name}, ${view.name} - every concierge entry opens LoRA Studio's own chat window and Close dismisses it`, { timeout: 240000 }, async (t) => {
    const touch = Boolean(options.hasTouch);
    const press = (locator) => (touch ? locator.tap({ timeout: 5000 }) : locator.click({ timeout: 5000 }));
    const { origin, kernel } = await host(t, { characters: view.characters() });
    const context = await browser.newContext(options);
    t.after(() => context.close());

    const first = await openPlace(context, origin, place, view, touch);
    const shown = [];
    for (const entry of conciergeEntries(first.page)) {
      if (await entry.locator.isVisible()) shown.push(entry.name);
    }
    await first.page.close();
    assert.ok(shown.length > 0, `a person sees a concierge entry on ${view.name} (${place.name}, ${name})`);

    let asked = false;
    for (const entryName of shown) {
      const { page, screen, errors } = await openPlace(context, origin, place, view, touch);
      const entry = conciergeEntries(page).find((each) => each.name === entryName);
      await press(entry.locator);
      const where = `${entryName} on ${view.name} (${place.name}, ${name})`;
      const chat = await verifyLoraWindow(page, screen, where);
      if (!asked && !view.characters().length) {
        asked = true;
        const { ask } = await sendInWindow(chat, 'Check my LoRA character readiness.', press, kernel);
        assert.equal(ask.bot, 'lora-director', 'turn reaches lora-director');
        assert.equal(ask.context.app, 'lora', 'turn carries context.app=lora');
        assert.equal(ask.context.recordId, undefined, 'New character start names no saved document');
      }
      await press(chat.locator('.jc-header .jc-panel-close'));
      await waitWindows(page, 0);
      if (!asked && view.characters().length) {
        asked = true;
        await press(screen.locator(touch ? '#phoneHome [data-home-index="0"]' : '[data-char-index="0"]'));
        await screen.locator('#datasetPanel').waitFor({ state: 'visible', timeout: 10000 });
        const reopen = conciergeEntries(page).find((each) => each.name === entryName);
        await press(reopen.locator);
        const charChat = await verifyLoraWindow(page, screen, `${where} (selected character)`);
        const { ask } = await sendInWindow(charChat, 'Check this character dataset.', press, kernel);
        assert.equal(ask.bot, 'lora-director', 'turn reaches lora-director');
        assert.equal(ask.context.app, 'lora', 'turn carries context.app=lora');
        assert.equal(ask.context.recordId, CHARACTER_ID, 'selected character hands over its UUID');
        assert.equal(ask.context.fields?.subject, CHARACTER.subject, 'and its subject');
        assert.equal(ask.context.fields?.revision, 2, 'and its revision');
        await press(charChat.locator('.jc-header .jc-panel-close'));
        await waitWindows(page, 0);
      }
      assert.deepEqual(errors, [], 'no page error');
      await page.close();
    }
  });
}
