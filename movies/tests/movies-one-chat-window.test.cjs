/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.1.8 (lane CHATCORE3; Roger, 2026-11-16: every concierge is the core Jarvis chat
 *   window, with its model menu). In Chromium at 1440x900 and at 412x915 (touch) the shipped Movies & TV page runs over the COMPILED
 *   Movies router (tests/movies-routes-harness.cjs: an in-memory pool, a TMDB double connected through the kernel) beside the
 *   kernel's one chat window, served from a kernel platform export with its stand-in kernel (scripts/one-chat-window/kernel-window.mjs).
 *   Ask opens the sheet, which holds that window (iframe.jarvis-chat-frame, concierge=movies&bot=movies-concierge) with its model
 *   menu, Files, Tap to talk, Keep trying and conversations; a model picked for the request rides on the turn; the person's words
 *   reach movies-concierge's door with context.app movies and the screen in context.screen_state (the view, the type shown, the
 *   trending titles with their keys, the watchlist); the page draws no message box of its own and sends no POST /api/movies/chat;
 *   the window and its message box sit inside the sheet; nothing scrolls sideways; the window's own Close closes the sheet; no page
 *   error; nothing outside the loopback. Needs OSHAL_KERNEL_PLATFORM (fails, never skips) and the store toolchain. At
 *   1440x900 a title the concierge saves with add-to-watchlist during a turn shows on the page's watchlist once the answer
 *   is done, without a reload (the window's host refresh reads the watchlist again).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('./movies-routes-harness.cjs');

const WINDOW = '#moviesConcierge iframe.jarvis-chat-frame';
const ANSWER = 'Game of Thrones is the show on your screen; the other two are movies.';
const SHOTS = process.env.MOVIES_ONE_CHAT_SCREENSHOTS || '';
const TRENDING = [harness.title(603, 'The Matrix', 1999), harness.title(1399, 'Game of Thrones', 2011, 'tv'), harness.title(27205, 'Inception', 2010)];

let helper, fixture, browser;

/** movies-concierge answers a turn asked as Movies; any other turn is refused. Asked to save a title, its add-to-watchlist
 * tool call has stored it in the viewer's watchlist (through the kernel, as the person) by the time the answer is done. */
function answer(ask) {
  if (ask.bot !== 'movies-concierge' || ask.context?.app !== 'movies') return 'Wrong application.';
  if (!/save inception/i.test(ask.message)) return ANSWER;
  fixture.pool.tables.watchlist.unshift({ row_id: 'row-saved', user_sub: 'viewer-window', item_key: 'movie:27205', media_type: 'movie', tmdb_id: 27205, title: 'Inception', year: '2010', status: 'want' });
  return 'Inception is on your watchlist now.';
}

async function startFixture() {
  const express = helper.toolchain('express');
  const kernel = helper.windowKernel({ answer });
  const pool = harness.fakePool({ watchlist: [{ row_id: 'row-1', user_sub: 'viewer-window', item_key: 'movie:155', media_type: 'movie', tmdb_id: 155, title: 'The Dark Knight', year: '2008', status: 'want' }] });
  const { router } = harness.loadRoutes({ pool, express, trending: TRENDING });
  const posts = [];
  const web = express();
  web.use(express.json());
  helper.mountWindow(web, { platform: helper.kernelPlatform(), kernel });
  web.use((req, _res, next) => { if (req.method !== 'GET') posts.push({ method: req.method, path: req.path }); next(); });
  web.get('/api/swarm/apps/home-plan', (_req, res) => res.json({ apps: [] }));
  web.use('/api/movies', (req, _res, next) => { req.oidc = { isAuthenticated: () => true, user: { sub: 'viewer-window' } }; next(); }, router);
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
  test(`${width}x${height}: Ask opens the Movie Concierge, the one chat window, told the screen; its own Close closes the sheet`, async () => {
    const phone = width < 600;
    const context = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone });
    const page = await context.newPage(), errors = [], outside = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await context.route('**/*', (route) => (new URL(route.request().url()).origin === fixture.origin ? route.continue() : (outside.push(route.request().url()), route.abort())));
    const press = phone ? (locator) => locator.tap() : (locator) => locator.click();
    try {
      await page.goto(`${fixture.origin}/api/movies/app`);
      await page.locator('#grid .card').nth(2).waitFor({ timeout: 15000 });
      await page.locator('#wlRow .card').first().waitFor({ timeout: 15000 });
      await press(page.locator('#askBtn'));
      await page.locator('#askModal.show').waitFor();
      const frame = page.locator(WINDOW);
      const chat = await helper.chatWindow(page, WINDOW);
      assert.match(await frame.getAttribute('src'), /^\/api\/jarvis\/\?concierge=movies&bot=movies-concierge&/, 'the window is Movies\' concierge');
      await helper.windowControls(chat);
      assert.equal(await helper.pickModel(chat, press), 'Picked model');
      const asked = 'Which of these is a show?';
      const { ask, answer: bubble } = await helper.sendInWindow(chat, asked, press, fixture.kernel);
      assert.deepEqual([ask.door, ask.message, ask.context.app], ['/api/swarm/bots/movies-concierge/ask', asked, 'movies']);
      assert.deepEqual([ask.context.provider, ask.context.model], ['picked', 'picked-model']);
      await bubble.getByText(/Game of Thrones is the show/).waitFor();
      const screen = ask.context.screen_state;
      assert.deepEqual([screen.tab, screen.title], ['Home', 'Movies & TV: Home']);
      for (const line of ['[button] Showing: Movies & Shows (on)', '# Trending this week', 'The Matrix / 1999 · Movie / key movie:603',
        'Game of Thrones / 2011 · TV series / key tv:1399', 'Inception / 2010 · Movie / key movie:27205', '# Watchlist (1 saved)',
        'The Dark Knight / 2008 · Movie / key movie:155']) {
        assert.ok(screen.text.split('\n').includes(line), `the screen the concierge is told of holds "${line}":\n${screen.text}`);
      }
      assert.equal('recordId' in ask.context, false, 'no document: the conversation stays the concierge\'s own');
      assert.equal(await page.locator('#chatq, #sendBtn, #msgs').count(), 0, 'no message box of the page\'s own');
      assert.deepEqual(fixture.posts.filter((post) => post.path === '/api/movies/chat'), [], 'no POST /api/movies/chat');
      const [sheet, box, composer] = await Promise.all([page.locator('#moviesConcierge').boundingBox(), frame.boundingBox(), chat.locator('.jc-composer').boundingBox()]);
      assert.ok(box.x >= sheet.x - 1 && box.x + box.width <= sheet.x + sheet.width + 1 && box.y >= sheet.y - 1 && box.y + box.height <= sheet.y + sheet.height + 1, 'the window sits inside the sheet');
      assert.ok(composer.y + composer.height <= box.y + box.height + 1 && composer.x + composer.width <= box.x + box.width + 1, 'the message box sits inside the window');
      assert.ok(box.height >= (phone ? 520 : 700), `room for a conversation (${Math.round(box.height)} px)`);
      assert.ok(box.y + box.height <= height + 1, 'on the screen without scrolling');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'nothing runs sideways');
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `movies-one-chat-window-${width}.png`) });
        fs.writeFileSync(path.join(SHOTS, `movies-screen-state-${width}.json`), JSON.stringify(screen, null, 2));
      }
      await press(chat.getByRole('button', { name: 'Close the assistant', exact: true }));
      await page.waitForFunction(() => !document.getElementById('askModal').classList.contains('show'), null, { timeout: 5000 });
      assert.deepEqual(errors, []);
      assert.deepEqual(outside, []);
    } finally { await context.close(); }
  });
}

test('1440x900: a title the concierge saves during a turn shows on the watchlist once its answer is done, without a reload', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(), errors = [], outside = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === fixture.origin ? route.continue() : (outside.push(route.request().url()), route.abort())));
  try {
    await page.goto(`${fixture.origin}/api/movies/app`);
    await page.locator('#wlRow .card').first().waitFor({ timeout: 15000 });
    assert.equal(await page.locator('#wlRow .card', { hasText: 'Inception' }).count(), 0, 'not saved before the turn');
    await page.locator('#askBtn').click();
    const chat = await helper.chatWindow(page, WINDOW);
    await helper.sendInWindow(chat, 'Save Inception to my watchlist', (locator) => locator.click(), fixture.kernel);
    await page.locator('#wlRow .card', { hasText: 'Inception' }).waitFor({ timeout: 10000 });
    assert.deepEqual(errors, []);
    assert.deepEqual(outside, []);
  } finally { await context.close(); }
});
