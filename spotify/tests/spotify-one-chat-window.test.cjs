/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.1.9 (lane CHATCORE3; Roger, 2026-11-16: every concierge is the core Jarvis chat
 *   window, with its model menu). In Chromium at 1440x900 and at 412x915 (touch) the shipped Spotify page runs over the COMPILED
 *   Spotify router (tests/spotify-routes-harness.cjs: a connected Spotify double under the native kernel) beside the kernel's one
 *   chat window, served from a kernel platform export with its stand-in kernel (scripts/one-chat-window/kernel-window.mjs). The
 *   Music Concierge box under the tracks holds that window (iframe.jarvis-chat-frame, concierge=spotify&bot=spotify-concierge)
 *   with its model menu, Files, Tap to talk, Keep trying and conversations; a model picked for the request rides on the turn;
 *   the listener's words reach spotify-concierge's door with context.app spotify and the screen in context.screen_state (what is
 *   playing, the top tracks with their URIs, the track picked for a playlist and its name, the playlists); the page draws no
 *   message box of its own and sends no POST /api/spotify/chat; the window and its message box sit inside the box and on the
 *   screen; nothing scrolls sideways; no page error; nothing outside the loopback. At 1440x900 a playlist the concierge proposes
 *   is built only when the listener approves its card (POST /api/spotify/playlist once, with the card's tracks), and Your
 *   playlists then shows it without a reload. Needs OSHAL_KERNEL_PLATFORM (fails, never skips) and the store toolchain.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('./spotify-routes-harness.cjs');

const WINDOW = '#spotifyConcierge iframe.jarvis-chat-frame';
const ANSWER = 'Teardrop by Massive Attack is your most played; Glory Box fits the same rainy mood.';
const SHOTS = process.env.SPOTIFY_ONE_CHAT_SCREENSHOTS || '';
const TOP = [harness.track('t1', 'Teardrop', 'Massive Attack'), harness.track('t2', 'Glory Box', 'Portishead')];
const PLAYING = { isPlaying: true, track: harness.track('t3', 'Roads', 'Portishead') };

let helper, fixture, browser;
/** The cards the concierge proposed, by id, so the approved one runs with its own input. */
const cards = new Map();

/** The build-playlist card the concierge proposes, as the kernel's proposal carries it. */
function playlistCard(name, trackUris) {
  const card = { id: `fixture-spotify-playlist-${cards.size + 1}`, app: 'spotify', appName: 'Spotify', toolName: 'build-playlist', label: 'Build Spotify Playlist',
    mode: 'ask', expiresAt: new Date(Date.now() + 300000).toISOString(), input: { name, trackUris } };
  cards.set(card.id, card);
  return card;
}

/** spotify-concierge answers a turn asked as Spotify; a request to build a playlist carries its card. */
function answer(ask) {
  if (ask.bot !== 'spotify-concierge' || ask.context?.app !== 'spotify') return 'Wrong application.';
  if (!/build/i.test(ask.message)) return ANSWER;
  return { answer: 'Approve the card to create Rainy Day on your Spotify.', packageToolProposal: playlistCard('Rainy Day', TOP.map((t) => t.uri)) };
}

async function startFixture() {
  const express = helper.toolchain('express');
  const kernel = helper.windowKernel({ answer });
  const { router, created } = harness.loadRoutes({ express, top: TOP, playing: PLAYING, playlists: [{ id: 'pl-0', name: 'Old Favorites', url: 'https://open.spotify.com/playlist/pl-0', trackCount: 12, imageUrl: null }] });
  const posts = [];
  const web = express();
  web.use(express.json());
  helper.mountWindow(web, { platform: helper.kernelPlatform(), kernel });
  web.use((req, _res, next) => { if (req.method !== 'GET') posts.push({ method: req.method, path: req.path, body: req.body }); next(); });
  // The approved card runs the tool as the kernel does: POST /api/spotify/playlist with the card's input, as the listener.
  web.post('/api/jarvis/package-tools/execute', async (req, res) => {
    const card = cards.get(req.body?.proposalId);
    if (!card) { res.status(404).json({ error: 'no such proposal' }); return; }
    const ran = await fetch(`${origin}/api/spotify/playlist`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(card.input) });
    res.json({ status: ran.status, result: await ran.json(), expiresAt: new Date(Date.now() + 60000).toISOString() });
  });
  web.get('/api/swarm/apps/home-plan', (_req, res) => res.json({ apps: [] }));
  web.use('/api/spotify', (req, _res, next) => { req.oidc = { isAuthenticated: () => true, user: { sub: 'listener-window' } }; next(); }, router);
  web.use((_req, res) => res.status(404).json({ error: 'fixture_route_unavailable' }));
  const server = await new Promise((resolve) => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, kernel, posts, created, close: async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); } };
}

test.before(async () => {
  helper = await import('../../scripts/one-chat-window/kernel-window.mjs');
  helper.kernelPlatform();
  fixture = await startFixture();
  browser = await helper.toolchain('playwright').chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); await fixture?.close(); });

/** Open the Spotify page at one size and wait for its tracks and playlists. */
async function openSpotify(width, height) {
  const phone = width < 600;
  const context = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone });
  const page = await context.newPage(), errors = [], outside = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === fixture.origin ? route.continue() : (outside.push(route.request().url()), route.abort())));
  const press = phone ? (locator) => locator.tap() : (locator) => locator.click();
  await page.goto(`${fixture.origin}/api/spotify/app`);
  await page.locator('#grid .card').nth(1).waitFor({ timeout: 15000 });
  await page.locator('#playlists .pl').first().waitFor({ timeout: 15000 });
  return { context, page, errors, outside, press, phone };
}

for (const [width, height] of [[1440, 900], [412, 915]]) {
  test(`${width}x${height}: the Music Concierge is the one chat window under the tracks, told the screen`, async () => {
    const { context, page, errors, outside, press, phone } = await openSpotify(width, height);
    try {
      await press(page.locator('#grid .card').first().locator('.pick'));
      await page.locator('#plName').fill('Rainy Day');
      const frame = page.locator(WINDOW);
      await frame.scrollIntoViewIfNeeded();
      const chat = await helper.chatWindow(page, WINDOW);
      assert.match(await frame.getAttribute('src'), /^\/api\/jarvis\/\?concierge=spotify&bot=spotify-concierge&/, 'the window is Spotify\'s concierge');
      await helper.windowControls(chat);
      assert.equal(await helper.pickModel(chat, press), 'Picked model');
      const asked = 'What fits a rainy day?';
      const { ask, answer: bubble } = await helper.sendInWindow(chat, asked, press, fixture.kernel);
      assert.deepEqual([ask.door, ask.message, ask.context.app], ['/api/swarm/bots/spotify-concierge/ask', asked, 'spotify']);
      assert.deepEqual([ask.context.provider, ask.context.model], ['picked', 'picked-model']);
      await bubble.getByText(/Teardrop by Massive Attack/).waitFor();
      const screen = ask.context.screen_state;
      assert.deepEqual([screen.tab, screen.title], ['Music', 'Music: Your top tracks']);
      for (const line of ['Now playing: Roads / Portishead / uri spotify:track:t3', '# Your top tracks (2)', 'Teardrop / Massive Attack / uri spotify:track:t1',
        'Glory Box / Portishead / uri spotify:track:t2', '# Picked for a playlist (1)', '[field] Playlist name: Rainy Day', '# Your playlists (1)', 'Old Favorites / 12 tracks']) {
        assert.ok(screen.text.split('\n').includes(line), `the screen the concierge is told of holds "${line}":\n${screen.text}`);
      }
      assert.equal(await page.locator('#chatq, #sendBtn, #msgs').count(), 0, 'no message box of the page\'s own');
      assert.deepEqual(fixture.posts.filter((post) => post.path === '/api/spotify/chat'), [], 'no POST /api/spotify/chat');
      const [box, win, composer] = await Promise.all([page.locator('#spotifyConcierge').boundingBox(), frame.boundingBox(), chat.locator('.jc-composer').boundingBox()]);
      assert.ok(win.x >= box.x - 1 && win.x + win.width <= box.x + box.width + 1 && win.y >= box.y - 1 && win.y + win.height <= box.y + box.height + 1, 'the window fills its box');
      assert.ok(composer.y + composer.height <= win.y + win.height + 1 && composer.x + composer.width <= win.x + win.width + 1, 'the message box sits inside the window');
      assert.ok(win.height >= 560, `room for a conversation (${Math.round(win.height)} px)`);
      assert.ok(win.height <= height, 'the whole window fits on the screen');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'nothing runs sideways');
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `spotify-one-chat-window-${width}.png`) });
        fs.writeFileSync(path.join(SHOTS, `spotify-screen-state-${width}.json`), JSON.stringify(screen, null, 2));
      }
      assert.equal(phone, width < 600);
      assert.deepEqual(errors, []);
      assert.deepEqual(outside, []);
    } finally { await context.close(); }
  });
}

test('1440x900: a playlist the concierge proposes is built only when the listener approves its card, and Your playlists shows it', async () => {
  const { context, page, errors, outside, press } = await openSpotify(1440, 900);
  try {
    const chat = await helper.chatWindow(page, WINDOW);
    const before = fixture.created.length;
    await helper.sendInWindow(chat, 'Build me a rainy-day playlist', press, fixture.kernel);
    const approve = chat.getByRole('button', { name: 'Approve', exact: true }).last();
    await approve.waitFor({ timeout: 15000 });
    assert.equal(fixture.created.length, before, 'nothing is created before the listener approves');
    await press(approve);
    await page.locator('#playlists .pl', { hasText: 'Rainy Day' }).waitFor({ timeout: 15000 });
    assert.equal(fixture.created.length, before + 1, 'the approved playlist is created once');
    assert.deepEqual(fixture.created.at(-1), { userId: 'listener-1', name: 'Rainy Day', uris: ['spotify:track:t1', 'spotify:track:t2'] });
    assert.deepEqual(fixture.posts.filter((post) => post.path === '/api/spotify/chat'), [], 'no POST /api/spotify/chat');
    assert.deepEqual(errors, []);
    assert.deepEqual(outside, []);
  } finally { await context.close(); }
});
