/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.5.9 (Roger, 2026-11-16: every concierge is the core Jarvis chat window, with its model menu). In Chromium at
 *   1440x900 and at 412x915 (touch) the shipped Get a Ride page runs over the COMPILED Rides router (route harness: an in-memory pool and a
 *   recording provider) beside the kernel's one chat window, served from a kernel platform export with its stand-in kernel
 *   (scripts/one-chat-window/kernel-window.mjs). With a trip priced and a ride picked on the page, the Rides Concierge is that window
 *   (iframe.jarvis-chat-frame, concierge=rides&bot=rides-concierge) in the builder panel where the page's own chat was; it shows its model
 *   menu, Files, Tap to talk, Keep trying and its conversations; a model picked for the request rides on the turn's context; the person's
 *   words reach rides-concierge's door with context.app rides and the trip on the screen in context.screen_state (the pickup and
 *   destination fields, both map pins, the distance, the priced options with the selected one and the controls); the page draws no
 *   transcript or message box of its own and sends no POST /api/rides/chat; nothing scrolls sideways; no page error; nothing outside the
 *   loopback. On a phone the concierge's hand-off card (prepare-ride-booking) is approved in the window: the real POST /request records
 *   the trip once and the page shows it under Recent trips. Needs OSHAL_KERNEL_PLATFORM (fails, never skips) and the store toolchain.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('./rides-routes-harness');

/** A transparent 1x1 PNG served for every map tile, so the map draws with nothing from outside the loopback. */
const BLANK_TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
/** The Rides Concierge: the one chat window in the builder panel. */
const WINDOW = '.builder iframe.jarvis-chat-frame';
const ANSWER = 'Comfort is the ride you picked: $23-30 for this trip.';
const BOOKED = 'Approve the card to make the Uber link for a Comfort from my location to Pensacola airport; Uber shows the real price before you request.';
const SHOTS = process.env.RIDES_ONE_CHAT_SCREENSHOTS || '';

let helper, fixture, browser;

/** The hand-off card the concierge proposes for the trip on the screen, as the kernel's proposal carries it. */
function handoffCard() {
  return { id: 'fixture-ride-handoff', app: 'rides', appName: 'Get a Ride', toolName: 'prepare-ride-booking', label: 'Prepare Ride Handoff', mode: 'ask',
    expiresAt: new Date(Date.now() + 300000).toISOString(), input: { pickup: 'my location', dropoff: 'Pensacola airport', rideType: 'comfort' } };
}

/** rides-concierge answers a turn asked as Rides; a request to book carries the hand-off card. Any other turn is refused. */
function answer(ask) {
  if (ask.bot !== 'rides-concierge' || ask.context?.app !== 'rides') return 'Wrong application.';
  return /\bbook\b/i.test(ask.message) ? { answer: BOOKED, packageToolProposal: handoffCard() } : ANSWER;
}

/**
 * @description The fixture: the stand-in kernel and its window first, then the page's own requests recorded, the map tiles, the
 * cockpit's offer read, and the compiled Rides router as a signed-in rider.
 * @returns {Promise<{origin: string, kernel: object, pool: object, posts: object[], close: Function}>}
 */
async function startFixture() {
  const express = helper.toolchain('express');
  const kernel = helper.windowKernel({ answer });
  const pool = harness.fakePool();
  const { router } = harness.loadRoutes({ pool, express, reply: { say: 'The page asked its own chat.' } });
  const posts = [];
  const web = express();
  web.use(express.json());
  helper.mountWindow(web, { platform: helper.kernelPlatform(), kernel });
  web.use((req, _res, next) => { if (req.method !== 'GET') posts.push({ method: req.method, path: req.path, body: req.body }); next(); });
  // The approved card runs the tool as the kernel does: POST /api/rides/request with the card's input, as the rider.
  web.post('/api/jarvis/package-tools/execute', async (_req, res) => {
    const ran = await fetch(`${origin}/api/rides/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(handoffCard().input) });
    res.json({ status: ran.status, result: await ran.json(), expiresAt: new Date(Date.now() + 60000).toISOString() });
  });
  web.get('/tiles/:z/:x/:y.png', (_req, res) => res.type('png').send(BLANK_TILE));
  web.get('/api/swarm/apps/home-plan', (_req, res) => res.json({ apps: [] }));
  web.use('/api/rides', (req, _res, next) => { req.oidc = { isAuthenticated: () => true, user: { sub: 'rider-window' } }; next(); }, router);
  web.use((_req, res) => res.status(404).json({ error: 'fixture_route_unavailable' }));
  const server = await new Promise((resolve) => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  // /config reads the tile address per request: the map's tiles come from this server.
  const savedTiles = process.env.OSHAL_MAP_TILE_URL;
  process.env.OSHAL_MAP_TILE_URL = `${origin}/tiles/{z}/{x}/{y}.png`;
  return { origin, kernel, pool, posts, close: async () => {
    if (savedTiles === undefined) delete process.env.OSHAL_MAP_TILE_URL; else process.env.OSHAL_MAP_TILE_URL = savedTiles;
    server.closeAllConnections(); await new Promise((done) => server.close(done));
  } };
}

test.before(async () => {
  helper = await import('../../scripts/one-chat-window/kernel-window.mjs');
  helper.kernelPlatform();
  fixture = await startFixture();
  browser = await helper.toolchain('playwright').chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); await fixture?.close(); });

/**
 * @description Open Get a Ride at one size and price a trip on it: a destination typed, Show rides, Comfort picked.
 * @param {number} width @param {number} height
 * @returns {Promise<{context: object, page: object, errors: string[], outside: string[], press: Function}>}
 */
async function openPriced(width, height) {
  const phone = width < 600;
  const context = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone });
  const page = await context.newPage(), errors = [], outside = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === fixture.origin ? route.continue() : (outside.push(route.request().url()), route.abort())));
  const press = phone ? (locator) => locator.tap() : (locator) => locator.click();
  await page.goto(`${fixture.origin}/api/rides/app`);
  await page.locator('#osmMap.leaflet-container').waitFor({ timeout: 15000 });
  await page.locator('#dropoff').fill('Pensacola airport');
  await press(page.locator('#estimateBtn'));
  await page.locator('#options .ride-card').nth(3).waitFor({ timeout: 15000 });
  await press(page.locator('#options .ride-card').nth(1));
  await page.locator('#options .ride-card.is-selected', { hasText: 'Comfort' }).waitFor();
  return { context, page, errors, outside, press };
}

for (const [width, height] of [[1440, 900], [412, 915]]) {
  test(`${width}x${height}: the Rides Concierge is the one chat window in the builder panel, and the trip on the screen reaches rides-concierge`, async () => {
    const { context, page, errors, outside, press } = await openPriced(width, height);
    try {
      const frame = page.locator(WINDOW);
      const chat = await helper.chatWindow(page, WINDOW);
      assert.match(await frame.getAttribute('src'), /^\/api\/jarvis\/\?concierge=rides&bot=rides-concierge&/, 'the window is Rides\' concierge');
      await helper.windowControls(chat);
      assert.equal(await helper.pickModel(chat, press), 'Picked model', 'the model picked for this request is shown on the control');
      const asked = 'Which ride on my screen is cheapest?';
      const { ask, answer: bubble } = await helper.sendInWindow(chat, asked, press, fixture.kernel);
      assert.deepEqual([ask.door, ask.message, ask.context.app], ['/api/swarm/bots/rides-concierge/ask', asked, 'rides'], 'the person\'s words reach Rides\' bot as Rides');
      assert.deepEqual([ask.context.provider, ask.context.model], ['picked', 'picked-model'], 'the pick rides on that request');
      await bubble.getByText(/Comfort is the ride you picked/).waitFor();
      // Rides' own context, which the page's chat request carried as fields and pins, is the screen the concierge is told of.
      const screen = ask.context.screen_state;
      assert.equal(screen.tab, 'Get a Ride');
      assert.equal(screen.title, 'Ride to Pensacola airport');
      for (const line of ['[field] Pickup: my location', '[field] Destination: Pensacola airport', '[button] Show rides',
        'Pickup / my location / pin at 30.00000, -86.00000', 'Dropoff / Pensacola airport / pin at 30.07000, -86.05000',
        'Distance / 7.7 km straight line · ~10 km (6.2 mi) road estimate (straight line × 1.3)',
        'UberX / 4 seats · ~20 min trip / $18-23 estimate', 'Comfort / 4 seats · ~20 min trip / $23-30 estimate (selected)', '[button] Open Uber handoff']) {
        assert.ok(screen.text.split('\n').includes(line), `the screen the concierge is told of holds "${line}":\n${screen.text}`);
      }
      assert.equal('recordId' in ask.context, false, 'no document: the trip is the screen, so the conversation stays the concierge\'s own');
      // The page draws no chat of its own and sends none.
      assert.equal(await page.locator('#messages, #chatInput, #chatSend, .chat-row, .msg').count(), 0, 'no transcript or message box on the page');
      assert.deepEqual(fixture.posts.filter((post) => post.path === '/api/rides/chat'), [], 'no POST /api/rides/chat');
      // In the place the page's chat had: the builder panel, under its search, with the window's message box inside it.
      const placed = await page.evaluate((selector) => {
        const frameEl = document.querySelector(selector), host = frameEl.parentElement, builder = host.closest('.builder');
        return { host: host.id, last: builder.lastElementChild === host, afterSearch: host.previousElementSibling?.classList.contains('search-stack') };
      }, WINDOW);
      assert.deepEqual(placed, { host: 'ridesConcierge', last: true, afterSearch: true });
      await frame.scrollIntoViewIfNeeded();
      const [panel, box, composer] = await Promise.all([page.locator('.builder').boundingBox(), frame.boundingBox(), chat.locator('.jc-composer').boundingBox()]);
      assert.ok(box.x >= panel.x - 1 && box.x + box.width <= panel.x + panel.width + 1 && box.y + box.height <= panel.y + panel.height + 1, 'the window sits inside the builder panel');
      assert.ok(composer.y >= box.y - 1 && composer.y + composer.height <= box.y + box.height + 1 && composer.x + composer.width <= box.x + box.width + 1, 'the message box sits inside the window');
      assert.ok(box.height >= (width < 600 ? 480 : 380), `the window has room for a conversation (${Math.round(box.height)} px)`);
      if (width >= 600) assert.ok(box.y + box.height <= height + 1, 'on a desktop the window is on the screen without scrolling');
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(sideways, false, 'nothing runs sideways off the screen');
      assert.equal(await chat.locator('html').evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'nor inside the window');
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `rides-one-chat-window-${width}.png`), fullPage: width < 600 });
        fs.writeFileSync(path.join(SHOTS, `rides-screen-state-${width}.json`), JSON.stringify(screen, null, 2));
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(outside, []);
    } finally { await context.close(); }
  });
}

test('412x915: the concierge\'s hand-off card is approved in the window, the trip is recorded once and the page lists it under Recent trips', async () => {
  const { context, page, errors, outside, press } = await openPriced(412, 915);
  try {
    const chat = await helper.chatWindow(page, WINDOW);
    const before = fixture.pool.tables.requests.length;
    const { ask } = await helper.sendInWindow(chat, 'Book the Comfort on my screen', press, fixture.kernel);
    assert.equal(ask.bot, 'rides-concierge');
    const approve = chat.getByRole('button', { name: 'Approve', exact: true });
    await approve.waitFor({ timeout: 15000 });
    assert.equal(fixture.pool.tables.requests.length, before, 'nothing is recorded before the rider approves');
    await press(approve);
    await chat.getByText('Open uber.com').waitFor({ timeout: 15000 });
    assert.equal(fixture.pool.tables.requests.length, before + 1, 'the approved hand-off is recorded once');
    await page.locator('#recentTrips .suggestion', { hasText: 'Pensacola airport' }).waitFor({ timeout: 10000 });
    assert.deepEqual(fixture.posts.filter((post) => post.path === '/api/rides/chat'), [], 'no POST /api/rides/chat');
    assert.deepEqual(errors, []);
    assert.deepEqual(outside, []);
  } finally { await context.close(); }
});
