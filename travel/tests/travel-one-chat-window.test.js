/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.3.5 (lane CHATCORE3; Roger, 2026-11-16: every concierge is the core Jarvis chat
 *   window, with its model menu). In Chromium at 1440x900 and at 412x915 (touch) the shipped Travel page runs over the COMPILED
 *   Travel router (tests/travel-routes-harness.js: an in-memory pool, Duffel test fares and a typical price read) beside the
 *   kernel's one chat window, served from a kernel platform export with its stand-in kernel
 *   (scripts/one-chat-window/kernel-window.mjs). After a VPS to DCA search, the concierge column (on a phone the sheet behind
 *   the Travel concierge button) holds that window (iframe.jarvis-chat-frame, concierge=travel&bot=travel-concierge) with its
 *   model menu, Files, Tap to talk, Keep trying and conversations; a model picked for the request rides on the turn; the
 *   traveller's words reach travel-concierge's door with context.app travel and the screen in context.screen_state (the trip
 *   in the form, the trip searched, the price read, the test-fare notice, the options with their ids and prices); the page
 *   draws no message box of its own and sends no POST /api/travel/chat; the window and its message box sit inside the column
 *   or sheet and on the screen; nothing scrolls sideways; a watch the concierge opens during a turn shows under Watched routes
 *   once the answer is done, without a reload; on a phone the sheet's Done closes it. No page error; nothing outside the
 *   loopback. Needs OSHAL_KERNEL_PLATFORM (fails, never skips) and the store toolchain.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('./travel-routes-harness.js');

const WINDOW = '#travelConcierge iframe.jarvis-chat-frame';
const TRAVELLER = 'traveller-window';
const ANSWER = 'Fixture Air 1 at $180 is a typical price for this route, and it is the only nonstop.';
const SHOTS = process.env.TRAVEL_ONE_CHAT_SCREENSHOTS || '';
const OFFERS = [harness.offer(1, 180), harness.offer(2, 200), harness.offer(3, 220)];

let helper, fixture, browser;

/** travel-concierge answers a turn asked as Travel. Asked to watch the route, its create-fare-watch call has stored the
 * watch (through the kernel, as the traveller) by the time the answer is done. Any other turn is refused. */
function answer(ask) {
  if (ask.bot !== 'travel-concierge' || ask.context?.app !== 'travel') return 'Wrong application.';
  if (!/watch this route/i.test(ask.message)) return ANSWER;
  fixture.pool.tables.watches.unshift({ watch_id: 'w-window', user_sub: TRAVELLER, kind: 'flight', route_key: 'flight:VPS-DCA', status: 'active', last_price: 180,
    query: { origin: 'VPS', destination: 'DCA', departDate: '2026-12-16', pax: 1, cabin: 'economy' } });
  return 'Watching VPS to DCA on December 16 from $180.';
}

async function startFixture() {
  const express = helper.toolchain('express');
  const kernel = helper.windowKernel({ answer });
  const { router, pool } = harness.loadRoutes({ express, offers: OFFERS, price: { verdict: 'typical', advice: 'A typical price for this route.' } });
  const posts = [];
  const web = express();
  web.use(express.json());
  helper.mountWindow(web, { platform: helper.kernelPlatform(), kernel });
  web.use((req, _res, next) => { if (req.method !== 'GET') posts.push({ method: req.method, path: req.path }); next(); });
  web.get('/api/swarm/apps/home-plan', (_req, res) => res.json({ apps: [] }));
  web.use('/api/travel', (req, _res, next) => { req.oidc = { isAuthenticated: () => true, user: { sub: TRAVELLER } }; next(); }, router);
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

for (const [width, height] of [[1440, 900], [412, 915]]) {
  test(`${width}x${height}: the Travel Concierge is the one chat window beside the search, told the screen`, async () => {
    const phone = width < 600;
    const context = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone });
    const page = await context.newPage(), errors = [], outside = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await context.route('**/*', (route) => (new URL(route.request().url()).origin === fixture.origin ? route.continue() : (outside.push(route.request().url()), route.abort())));
    const press = phone ? (locator) => locator.tap() : (locator) => locator.click();
    try {
      fixture.pool.tables.watches = [];
      await page.goto(`${fixture.origin}/api/travel/app`);
      await page.locator('#f_origin').waitFor({ timeout: 15000 });
      await page.locator('#f_origin').fill('VPS');
      await page.locator('#f_dest').fill('DCA');
      await page.locator('#f_depart').fill('2026-12-16');
      await press(page.locator('#searchForm button[type="submit"]'));
      await page.locator('#results .card').nth(2).waitFor({ timeout: 15000 });
      if (phone) {
        await press(page.locator('#conciergeOpen'));
        await page.waitForFunction(() => document.body.classList.contains('concierge-open'));
      }
      const frame = page.locator(WINDOW);
      const chat = await helper.chatWindow(page, WINDOW);
      assert.match(await frame.getAttribute('src'), /^\/api\/jarvis\/\?concierge=travel&bot=travel-concierge&/, 'the window is Travel\'s concierge');
      await helper.windowControls(chat);
      assert.equal(await helper.pickModel(chat, press), 'Picked model');
      const asked = 'Is this a good price?';
      const { ask, answer: bubble } = await helper.sendInWindow(chat, asked, press, fixture.kernel);
      assert.deepEqual([ask.door, ask.message, ask.context.app], ['/api/swarm/bots/travel-concierge/ask', asked, 'travel']);
      assert.deepEqual([ask.context.provider, ask.context.model], ['picked', 'picked-model']);
      await bubble.getByText(/typical price for this route/).waitFor();
      const screen = ask.context.screen_state;
      assert.deepEqual([screen.tab, screen.title], ['Flights', 'Travel: Flights']);
      for (const line of ['[form] From VPS to DCA, depart 2026-12-16, economy cabin.', '# Searched: From VPS to DCA, depart 2026-12-16, economy cabin.',
        'Price read: typical price. A typical price for this route.', 'Duffel test fares, not real prices.', '# Options (3)',
        'Fixture Air 1 / Economy / VPS→DCA nonstop / dep 2026-12-16 08:00 / $180 USD / id fixture-offer-1',
        'Fixture Air 3 / Economy / VPS→DCA 1 stop / dep 2026-12-16 08:00 / $220 USD / id fixture-offer-3']) {
        assert.ok(screen.text.split('\n').includes(line), `the screen the concierge is told of holds "${line}":\n${screen.text}`);
      }
      assert.equal(await page.locator('#chatbox, #chatlog, .chatin').count(), 0, 'no message box of the page\'s own');
      await helper.sendInWindow(chat, 'Watch this route for a drop', press, fixture.kernel);
      await page.locator('#watched .row', { hasText: 'VPS → DCA · 2026-12-16 · Economy · last $180' }).waitFor({ timeout: 10000 });
      assert.deepEqual(fixture.posts.filter((post) => post.path === '/api/travel/chat'), [], 'no POST /api/travel/chat');
      const [column, box, composer] = await Promise.all([page.locator('#conciergeSheet').boundingBox(), frame.boundingBox(), chat.locator('.jc-composer').boundingBox()]);
      assert.ok(box.x >= column.x - 1 && box.x + box.width <= column.x + column.width + 1 && box.y >= column.y - 1 && box.y + box.height <= column.y + column.height + 1, 'the window sits inside the concierge column');
      assert.ok(composer.y + composer.height <= box.y + box.height + 1 && composer.x + composer.width <= box.x + box.width + 1, 'the message box sits inside the window');
      assert.ok(box.height >= 520, `room for a conversation (${Math.round(box.height)} px)`);
      assert.ok(box.y >= 0 && box.y + box.height <= height + 1, 'the whole window is on the screen');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'nothing runs sideways');
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `travel-one-chat-window-${width}.png`) });
        fs.writeFileSync(path.join(SHOTS, `travel-screen-state-${width}.json`), JSON.stringify(screen, null, 2));
      }
      if (phone) {
        await press(page.locator('#conciergeClose'));
        await page.waitForFunction(() => !document.body.classList.contains('concierge-open'), null, { timeout: 5000 });
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(outside, []);
    } finally { await context.close(); }
  });
}
