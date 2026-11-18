/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.4.6 (lane CHATCORE3; Roger, 2026-11-16: every concierge is the core Jarvis chat
 *   window, with its model menu). In Chromium at 1440x900 and at 412x915 (touch) the shipped Aero Lab page runs over the
 *   COMPILED Aero Lab router (an engine that is not present, as the route tests stand it in) beside the kernel's one chat
 *   window, served from a kernel platform export with its stand-in kernel (scripts/one-chat-window/kernel-window.mjs). Draft
 *   with AI (on a phone in the Design sheet) holds that window (iframe.jarvis-chat-frame, concierge=aero-lab&bot=aero-designer)
 *   with its model menu, Files, Tap to talk, Keep trying and conversations; a model picked for the request rides on the turn;
 *   the person's words reach aero-designer's door with context.app aero-lab and the screen in context.screen_state (the
 *   CURRENT DESIGN field by field, exactly the sliders); before the turn the page sent its sliders to POST /draft/design; a
 *   draft the concierge offers during the turn (propose-aero-draft, made here as the kernel would make the call, as the
 *   person) shows under the window with Apply to sliders once the answer is done, and Apply puts it on the sliders, clears it
 *   (DELETE /draft) and runs nothing; the page sends no POST /api/aero-lab/chat; the window and its message box are inside
 *   Draft with AI and on the screen; nothing scrolls sideways; no page error; nothing outside the loopback. Needs
 *   OSHAL_KERNEL_PLATFORM (fails, never skips) and the store toolchain.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const WINDOW = '#aeroConcierge iframe.jarvis-chat-frame';
const DESIGNER = 'designer-window';
const ANSWER = 'Your Tier-1 sketch needs more battery for the night; I put a draft at 0.6 kg under this window. Apply it, then press Run.';
const SHOTS = process.env.AERO_ONE_CHAT_SCREENSHOTS || '';

let helper, fixture, browser;

/** The compiled Aero Lab router, its framework logger stubbed and express the toolchain's own. */
function aeroRouter(express) {
  const original = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'express') return express;
    if (request === '@/shared/logger') return { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) };
    if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
    return original.call(this, request, ...rest);
  };
  try {
    const routes = require('../routes/aero-lab-routes.js');
    const adapter = { capabilities: async () => ({ capabilities: { hybrid: false }, bounds: null }), engineStatus: () => ({ present: false, reason: 'no engine in this fixture' }) };
    return routes.createAeroLabRoutes({ adapter, ctx: { appPackageDir: PKG } });
  } finally { Module._load = original; }
}

async function startFixture() {
  const express = helper.toolchain('express');
  const kernel = helper.windowKernel({ answer: (ask) => (ask.bot === 'aero-designer' && ask.context?.app === 'aero-lab' ? ANSWER : 'Wrong application.') });
  const posts = [];
  let draftAsked = false;
  const web = express();
  web.use(express.json());
  // The concierge's propose-aero-draft call, made as the kernel makes it (POST /api/aero-lab/draft as the person) while the
  // turn runs: before the window reads the turn's result.
  web.use(async (req, _res, next) => {
    if (req.method === 'POST' && req.path === '/api/swarm/bots/aero-designer/ask' && /battery/i.test(String(req.body?.message || ''))) draftAsked = true;
    if (req.method === 'GET' && req.path === '/api/jarvis/ask/result' && draftAsked) {
      draftAsked = false;
      await fetch(`${fixture.origin}/api/aero-lab/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft: { battery_mass_kg: 0.6 }, moves: { battery_mass_kg: 'up' }, say: 'More battery for the night.', said: 'What battery would close this design?' }) });
    }
    next();
  });
  helper.mountWindow(web, { platform: helper.kernelPlatform(), kernel });
  web.use((req, _res, next) => { if (req.method !== 'GET') posts.push({ method: req.method, path: req.path, body: req.body }); next(); });
  web.get('/api/swarm/apps/home-plan', (_req, res) => res.json({ apps: [] }));
  web.get('/api/aero-lab/vehicles', (_req, res) => res.json({ vehicles: [], stages: [], fabricable: '' }));
  web.use('/api/aero-lab', (req, _res, next) => { req.oidc = { isAuthenticated: () => true, user: { sub: DESIGNER } }; next(); }, aeroRouter(express));
  web.use((_req, res) => res.status(404).json({ error: 'fixture_route_unavailable' }));
  const server = await new Promise((resolve) => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, kernel, posts, close: async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); } };
}

test.before(async () => {
  helper = await import('../../scripts/one-chat-window/kernel-window.mjs');
  helper.kernelPlatform();
  fixture = await startFixture();
  browser = await helper.toolchain('playwright').chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); await fixture?.close(); });

for (const [width, height] of [[1440, 900], [412, 915]]) {
  test(`${width}x${height}: Draft with AI is the one chat window, told the sliders, and its draft is applied only by the person`, async () => {
    const phone = width < 600;
    const context = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone });
    const page = await context.newPage(), errors = [], outside = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await context.route('**/*', (route) => (new URL(route.request().url()).origin === fixture.origin ? route.continue() : (outside.push(route.request().url()), route.abort())));
    const press = phone ? (locator) => locator.tap() : (locator) => locator.click();
    try {
      const before = fixture.posts.length;
      await page.goto(`${fixture.origin}/api/aero-lab/app`);
      await page.locator('#designForm input').first().waitFor({ state: 'attached', timeout: 15000 });
      if (phone) await press(page.locator('#pb-design'));
      const frame = page.locator(WINDOW);
      await page.locator('#aeroConcierge').scrollIntoViewIfNeeded();
      const chat = await helper.chatWindow(page, WINDOW);
      assert.match(await frame.getAttribute('src'), /^\/api\/jarvis\/\?concierge=aero-lab&bot=aero-designer&/, 'the window is Aero Lab\'s designer');
      await helper.windowControls(chat);
      assert.equal(await helper.pickModel(chat, press), 'Picked model');
      const sliders = (await page.evaluate(() => window.aeroLabWindow.screen())).text;
      const asked = 'What battery would close this design?';
      const { ask, answer: bubble } = await helper.sendInWindow(chat, asked, press, fixture.kernel);
      assert.deepEqual([ask.door, ask.message, ask.context.app], ['/api/swarm/bots/aero-designer/ask', asked, 'aero-lab']);
      assert.deepEqual([ask.context.provider, ask.context.model], ['picked', 'picked-model']);
      await bubble.getByText(/needs more battery for the night/).waitFor();
      const screen = ask.context.screen_state;
      assert.deepEqual([screen.tab, screen.title], ['Sizing & flight envelope', 'Aero Lab: Sizing & flight envelope']);
      assert.equal(screen.text, sliders, 'the screen the designer is told of is the sliders as they are');
      assert.match(screen.text, /^# CURRENT DESIGN \(the sliders; a draft starts from these\)$/m);
      const battery = /^battery_mass_kg = ([0-9.]+) kg \(Battery mass\)$/m.exec(screen.text);
      assert.ok(battery, `the battery slider is on the screen:\n${screen.text}`);
      const sent = fixture.posts.slice(before).find((post) => post.path === '/api/aero-lab/draft/design');
      assert.ok(sent && sent.body.design.battery_mass_kg === Number(battery[1]), 'the page sent its sliders before the turn');
      const box = page.locator('#draftBox');
      await box.getByRole('button', { name: 'Apply to sliders' }).waitFor({ timeout: 10000 });
      assert.match(await box.textContent(), /Battery mass/);
      const runs = () => fixture.posts.filter((post) => /^\/api\/aero-lab\/(polar|evaluate|screen|mission|export)$/.test(post.path)).length;
      const ran = runs();
      await press(box.getByRole('button', { name: 'Apply to sliders' }));
      await page.waitForFunction(() => /^battery_mass_kg = 0\.6 kg/m.test(window.aeroLabWindow.screen().text), null, { timeout: 5000 });
      assert.equal(await page.locator('#runStatus').textContent(), 'draft applied — press Run');
      await page.waitForFunction(() => true);
      for (let i = 0; i < 20 && !fixture.posts.some((post) => post.method === 'DELETE' && post.path === '/api/aero-lab/draft'); i += 1) await page.waitForTimeout(100);
      assert.ok(fixture.posts.some((post) => post.method === 'DELETE' && post.path === '/api/aero-lab/draft'), 'applied, the draft is cleared');
      assert.equal(runs(), ran, 'nothing runs until the person presses Run');
      assert.equal(await page.locator('#chatInput, #chatSend, #chatLog').count(), 0, 'no message box of the page\'s own');
      assert.deepEqual(fixture.posts.filter((post) => post.path === '/api/aero-lab/chat'), [], 'no POST /api/aero-lab/chat');
      await frame.scrollIntoViewIfNeeded();
      const [host, win, composer] = await Promise.all([page.locator('#aeroConcierge').boundingBox(), frame.boundingBox(), chat.locator('.jc-composer').boundingBox()]);
      assert.ok(win.x >= host.x - 1 && win.x + win.width <= host.x + host.width + 1 && win.y >= host.y - 1 && win.y + win.height <= host.y + host.height + 1, 'the window sits in Draft with AI');
      assert.ok(composer.y + composer.height <= win.y + win.height + 1 && composer.x + composer.width <= win.x + win.width + 1, 'the message box sits inside the window');
      assert.ok(win.height >= 520, `room for a conversation (${Math.round(win.height)} px)`);
      assert.ok(win.y >= 0 && win.y + win.height <= height + 1, 'the whole window is on the screen');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'nothing runs sideways');
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `aero-one-chat-window-${width}.png`) });
        fs.writeFileSync(path.join(SHOTS, `aero-screen-state-${width}.json`), JSON.stringify(screen, null, 2));
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(outside, []);
    } finally { await context.close(); }
  });
}
