/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.5.7 (Roger, 2026-11-16: every concierge is the core Jarvis chat window, with its model menu; the
 *   coordinator, 2026-11-17: a saved allergy filters the window's search results). In Chromium at 1440x900 and at 412x915 (touch) the
 *   shipped Order Food page runs over the COMPILED Eats router (route harness: an in-memory pool and a recording Places double that
 *   answers four Thai restaurants, two named for peanut dishes) beside the kernel's one chat window, served from a kernel platform export
 *   with its stand-in kernel (scripts/one-chat-window/kernel-window.mjs), for a diner whose saved diet is a peanut allergy. The page's own
 *   search shows only the two places without peanuts and says which it held back; the Eats Concierge is that window
 *   (iframe.jarvis-chat-frame, concierge=eats&bot=eats-concierge) where the page's own chat was (the side panel; on a phone the sheet
 *   behind the Eats Concierge button); it shows its model menu, Files, Tap to talk, Keep trying and its conversations; a model picked for
 *   the request rides on the turn's context; the person's words reach eats-concierge's door with context.app eats and the screen in
 *   context.screen_state (the delivery address and search fields, the restaurants on screen with their place ids, the held-back ones and
 *   the saved diet and allergies); the page draws no transcript or message box of its own and sends no POST /api/eats/chat; nothing scrolls
 *   sideways; no page error; nothing outside the loopback. On a phone the concierge's hand-off cards (open-uber-eats) are approved in the
 *   window: the real POST /order refuses Peanut Palace for the allergy and records nothing, then hands Thai Garden off once, and the page
 *   lists it under Opened in Uber Eats. Needs OSHAL_KERNEL_PLATFORM (fails, never skips) and the store toolchain.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('./eats-routes-harness');

/** The Eats Concierge: the one chat window in the side panel (on a phone, in its sheet). */
const WINDOW = '#eatsConcierge iframe.jarvis-chat-frame';
const DINER = 'diner-window';
const ADDRESS = '1 Synthetic Way, Pensacola';
const ANSWER = 'Thai Garden and Green Curry House are on your screen; both skip the peanut places.';
const SHOTS = process.env.EATS_ONE_CHAT_SCREENSHOTS || '';

/** Four Thai places near the address, two of them named for peanut dishes (as in eats-allergy-tools.test.js). */
const place = (id, name) => ({ id, displayName: { text: name }, formattedAddress: '1 Synthetic St', location: { latitude: 30.43, longitude: -87.21 },
  types: ['thai_restaurant', 'restaurant'], primaryTypeDisplayName: { text: 'Thai Restaurant' }, rating: 4.5, userRatingCount: 120, priceLevel: 'PRICE_LEVEL_MODERATE' });
const THAI = [place('ChIJ-padthai', 'Pad Thai Kitchen'), place('ChIJ-peanut', 'Peanut Palace'), place('ChIJ-thai-garden', 'Thai Garden'), place('ChIJ-curry', 'Green Curry House')];

let helper, fixture, browser;
/** The cards the concierge proposed, by id, so the approved one runs with its own input. */
const cards = new Map();

/** The hand-off card the concierge proposes for one restaurant, as the kernel's proposal carries it. */
function handoffCard(placeId) {
  const card = { id: `fixture-eats-handoff-${cards.size + 1}`, app: 'eats', appName: 'Eats', toolName: 'open-uber-eats', label: 'Open in Uber Eats', mode: 'ask',
    expiresAt: new Date(Date.now() + 300000).toISOString(), input: { placeId } };
  cards.set(card.id, card);
  return card;
}

/** eats-concierge answers a turn asked as Eats; a request to order from a named place carries its hand-off card. */
function answer(ask) {
  if (ask.bot !== 'eats-concierge' || ask.context?.app !== 'eats') return 'Wrong application.';
  const order = /order from (.+)$/i.exec(ask.message);
  if (!order) return ANSWER;
  const chosen = THAI.find((p) => p.displayName.text.toLowerCase() === order[1].trim().toLowerCase());
  return { answer: `Approve the card to open Uber Eats with ${order[1].trim()} searched.`, packageToolProposal: handoffCard(chosen.id) };
}

/**
 * @description The fixture: the stand-in kernel and its window first, then the page's own requests recorded, the cockpit's
 * offer read, and the compiled Eats router as a signed-in diner whose saved diet is a peanut allergy.
 * @returns {Promise<{origin: string, kernel: object, pool: object, posts: object[], close: Function}>}
 */
async function startFixture() {
  const express = helper.toolchain('express');
  const kernel = helper.windowKernel({ answer });
  const pool = harness.fakePool({ profiles: { [DINER]: { user_sub: DINER, dietary: ['peanut allergy'], favorite_cuisines: [], default_address: ADDRESS, onboarded: true } } });
  const { router } = harness.loadRoutes({ pool, express, places: harness.fakePlaces({ search: () => ({ places: THAI }) }), reply: { say: 'The page asked its own chat.' } });
  const posts = [];
  const web = express();
  web.use(express.json());
  helper.mountWindow(web, { platform: helper.kernelPlatform(), kernel });
  web.use((req, _res, next) => { if (req.method !== 'GET') posts.push({ method: req.method, path: req.path, body: req.body }); next(); });
  // The approved card runs the tool as the kernel does: POST /api/eats/order with the card's input, as the diner.
  web.post('/api/jarvis/package-tools/execute', async (req, res) => {
    const card = cards.get(req.body?.proposalId);
    if (!card) { res.status(404).json({ error: 'no such proposal' }); return; }
    const ran = await fetch(`${origin}/api/eats/order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(card.input) });
    res.json({ status: ran.status, result: await ran.json(), expiresAt: new Date(Date.now() + 60000).toISOString() });
  });
  web.get('/api/swarm/apps/home-plan', (_req, res) => res.json({ apps: [] }));
  web.use('/api/eats', (req, _res, next) => { req.oidc = { isAuthenticated: () => true, user: { sub: DINER } }; next(); }, router);
  web.use((_req, res) => res.status(404).json({ error: 'fixture_route_unavailable' }));
  const server = await new Promise((resolve) => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, kernel, pool, posts, close: async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); } };
}

test.before(async () => {
  helper = await import('../../scripts/one-chat-window/kernel-window.mjs');
  helper.kernelPlatform();
  fixture = await startFixture();
  browser = await helper.toolchain('playwright').chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); await fixture?.close(); });

/**
 * @description Open Order Food at one size, wait for its restaurants, and on a phone open the concierge's sheet.
 * @param {number} width @param {number} height
 * @returns {Promise<{context: object, page: object, errors: string[], outside: string[], press: Function}>}
 */
async function openEats(width, height) {
  const phone = width < 600;
  const context = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone });
  const page = await context.newPage(), errors = [], outside = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === fixture.origin ? route.continue() : (outside.push(route.request().url()), route.abort())));
  const press = phone ? (locator) => locator.tap() : (locator) => locator.click();
  await page.goto(`${fixture.origin}/api/eats/app`);
  await page.locator('#grid .card').nth(1).waitFor({ timeout: 15000 });
  if (phone) {
    assert.equal(await page.locator('#eatsConciergeSheet').isVisible(), false, 'on a phone the concierge starts behind its button');
    await press(page.locator('#eatsConciergeOpen'));
    await page.locator('#eatsConciergeSheet.sheet-open').waitFor();
  }
  return { context, page, errors, outside, press };
}

for (const [width, height] of [[1440, 900], [412, 915]]) {
  test(`${width}x${height}: the saved peanut allergy holds the page's restaurants, and the Eats Concierge is the one chat window, told the screen`, async () => {
    const { context, page, errors, outside, press } = await openEats(width, height);
    try {
      // The page's own search went through the guarded route: only the places without peanuts, and the held ones said.
      assert.deepEqual(await page.locator('#grid .card .card-title').allTextContents(), ['Thai Garden', 'Green Curry House']);
      assert.equal(await page.locator('#allergyLine').textContent(), 'Held back for your allergies and diet: Pad Thai Kitchen (peanuts), Peanut Palace (peanuts).');
      const frame = page.locator(WINDOW);
      const chat = await helper.chatWindow(page, WINDOW);
      assert.match(await frame.getAttribute('src'), /^\/api\/jarvis\/\?concierge=eats&bot=eats-concierge&/, 'the window is Eats\' concierge');
      await helper.windowControls(chat);
      assert.equal(await helper.pickModel(chat, press), 'Picked model', 'the model picked for this request is shown on the control');
      const asked = 'Which of these is best for me?';
      const { ask, answer: bubble } = await helper.sendInWindow(chat, asked, press, fixture.kernel);
      assert.deepEqual([ask.door, ask.message, ask.context.app], ['/api/swarm/bots/eats-concierge/ask', asked, 'eats'], 'the person\'s words reach Eats\' bot as Eats');
      assert.deepEqual([ask.context.provider, ask.context.model], ['picked', 'picked-model'], 'the pick rides on that request');
      await bubble.getByText(/Thai Garden and Green Curry House/).waitFor();
      // What the page's chat request carried (the address, the diet the route read) reaches the concierge as the screen.
      const screen = ask.context.screen_state;
      assert.deepEqual([screen.tab, screen.title], ['Order Food', `Eats near ${ADDRESS}`]);
      for (const line of [`[field] Delivery address: ${ADDRESS}`, '[field] Search: (empty)', '# Restaurants near you',
        'Held back for your allergies and diet: Pad Thai Kitchen (peanuts), Peanut Palace (peanuts).',
        'Thai Garden / Thai Restaurant · $$ · 1.2 km / 4.5 stars (120) / place ChIJ-thai-garden / [button] Order on Uber Eats',
        'Green Curry House / Thai Restaurant · $$ · 1.2 km / 4.5 stars (120) / place ChIJ-curry / [button] Order on Uber Eats',
        'Saved diet and allergies (Settings): peanut allergy']) {
        assert.ok(screen.text.split('\n').includes(line), `the screen the concierge is told of holds "${line}":\n${screen.text}`);
      }
      assert.doesNotMatch(screen.text, /Peanut Palace \//, 'a held-back restaurant is never offered on the screen');
      assert.equal('recordId' in ask.context, false, 'no document: the screen is the context, so the conversation stays the concierge\'s own');
      // The page draws no chat of its own and sends none.
      assert.equal(await page.locator('#messages, #chatInput, #chatSend, .chat-row, .msg').count(), 0, 'no transcript or message box on the page');
      assert.deepEqual(fixture.posts.filter((post) => post.path === '/api/eats/chat'), [], 'no POST /api/eats/chat');
      // In the place the page's chat had, with the window's message box inside it.
      const host = width < 600 ? '#eatsConciergeSheet' : '.side';
      const [panel, box, composer] = await Promise.all([page.locator(host).boundingBox(), frame.boundingBox(), chat.locator('.jc-composer').boundingBox()]);
      assert.ok(box.x >= panel.x - 1 && box.x + box.width <= panel.x + panel.width + 1 && box.y >= panel.y - 1 && box.y + box.height <= panel.y + panel.height + 1,
        `the window sits inside ${host}`);
      assert.ok(composer.y >= box.y - 1 && composer.y + composer.height <= box.y + box.height + 1 && composer.x + composer.width <= box.x + box.width + 1, 'the message box sits inside the window');
      assert.ok(box.height >= (width < 600 ? 520 : 400), `the window has room for a conversation (${Math.round(box.height)} px)`);
      assert.ok(box.y + box.height <= height + 1, 'the window is on the screen without scrolling');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'nothing runs sideways off the screen');
      assert.equal(await chat.locator('html').evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'nor inside the window');
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `eats-one-chat-window-${width}.png`) });
        fs.writeFileSync(path.join(SHOTS, `eats-screen-state-${width}.json`), JSON.stringify(screen, null, 2));
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(outside, []);
    } finally { await context.close(); }
  });
}

test('412x915: approved in the window, the hand-off to a peanut place is refused for the allergy and records nothing; Thai Garden is handed off once', async () => {
  const { context, page, errors, outside, press } = await openEats(412, 915);
  try {
    const chat = await helper.chatWindow(page, WINDOW);
    const before = fixture.pool.tables.orders.length;
    await helper.sendInWindow(chat, 'Order from Peanut Palace', press, fixture.kernel);
    await press(chat.getByRole('button', { name: 'Approve', exact: true }).last());
    await chat.getByText(/Eats did not do this: Peanut Palace is held back because its name points to food that usually contains peanuts/).waitFor({ timeout: 15000 });
    assert.equal(fixture.pool.tables.orders.length, before, 'a refused hand-off records nothing');
    await helper.sendInWindow(chat, 'Order from Thai Garden', press, fixture.kernel);
    const approve = chat.getByRole('button', { name: 'Approve', exact: true }).last();
    await approve.waitFor({ timeout: 15000 });
    assert.equal(fixture.pool.tables.orders.length, before, 'nothing is recorded before the diner approves');
    await press(approve);
    await chat.getByText('Open ubereats.com').waitFor({ timeout: 15000 });
    assert.equal(fixture.pool.tables.orders.length, before + 1, 'the approved hand-off is recorded once');
    await page.locator('#handoffList .handoff-row', { hasText: 'Thai Garden' }).waitFor({ timeout: 10000 });
    assert.deepEqual(fixture.posts.filter((post) => post.path === '/api/eats/chat'), [], 'no POST /api/eats/chat');
    assert.deepEqual(errors, []);
    assert.deepEqual(outside, []);
  } finally { await context.close(); }
});
