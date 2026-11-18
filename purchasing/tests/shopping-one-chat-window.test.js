/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Shopping 1.5.1 (Roger, 2026-11-16/17: one concierge chat window everywhere):
 *     |                                         | verify in Chromium at 1440x900 and 412x915 (touch) over the compiled
 *     |                                         | Shopping router and a kernel platform export that (1) tools/shopping-chat.html
 *     |                                         | mounts the kernel's one chat window (#shoppingConcierge iframe.jarvis-chat-frame)
 *     |                                         | as purchasing / shopping-concierge with model menu, conversations, Files,
 *     |                                         | Tap to talk and Keep trying, passes screen_state, sends zero POST /api/purchasing/chat,
 *     |                                         | and refreshes the Cart when an approval card runs; and (2) Shopping's live List
 *     |                                         | screen inside Today (/cockpit/?app=purchasing&screen=shop-lists) opens the one
 *     |                                         | chat window with shopping-concierge.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const harness = require('./shopping-routes-harness');

const WINDOW = '#shoppingConcierge iframe.jarvis-chat-frame';
const ANSWER = 'Great Value 2% Milk is $2.78 on your screen.';
const ADDED = 'Approve the card below to add Organic Honey to your shopping list.';
const BOT_ID = 'b0070000-0000-0000-0000-000000000001';

let helper, todayHost, fixture, browser;

function addItemCard() {
  return {
    id: 'fixture-shopping-add',
    app: 'purchasing',
    appName: 'Shopping',
    toolName: 'shopping-list-add',
    label: 'Add to Shopping List',
    cardText: 'Puts this item on your shopping list, exactly as written. Nothing is bought.',
    mode: 'ask',
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    input: { title: 'Organic Honey', quantity: 1 },
  };
}

function answerTurn(ask) {
  const validBot = ask.bot === 'shopping-concierge' || ask.bot === BOT_ID;
  if (!validBot || ask.context?.app !== 'purchasing') return 'Wrong application.';
  if (/\bhoney\b/i.test(ask.message)) return { answer: ADDED, packageToolProposal: addItemCard() };
  return ANSWER;
}

async function startFixture() {
  const express = helper.toolchain('express');
  const platform = helper.kernelPlatform();
  const kernel = helper.windowKernel({ answer: answerTurn });
  const pool = harness.fakePool();
  const provider = harness.fakeProvider({
    deals: () => ({ source: 'walmart', feed: 'rollback', items: harness.CATALOG }),
  });
  const { router } = harness.loadRoutes({ pool, provider, express, reply: { say: 'The page asked its own chat.' } });
  const posts = [];
  const web = express();
  web.use(express.json());
  helper.mountWindow(web, { platform, kernel });
  web.use((req, _res, next) => {
    if (req.method !== 'GET') posts.push({ method: req.method, path: req.path, body: req.body });
    next();
  });
  let origin = '';
  web.post('/api/jarvis/package-tools/execute', async (_req, res) => {
    const ran = await fetch(`${origin}/api/purchasing/lists/default/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addItemCard().input),
    });
    res.json({ status: ran.status, result: await ran.json(), expiresAt: new Date(Date.now() + 60000).toISOString() });
  });
  web.get('/api/swarm/apps/home-plan', (_req, res) => res.json({ apps: [] }));
  web.get('/api/purchasing/marketplace', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'tools', 'shopping-chat.html'));
  });
  web.use('/api/purchasing', (req, _res, next) => {
    req.oidc = { isAuthenticated: () => true, user: { sub: 'shopper-window' } };
    next();
  }, router);
  todayHost.mountToday(web, { platform, apps: ['purchasing'] });
  web.use((_req, res) => res.status(404).json({ error: 'fixture_route_unavailable' }));
  const server = await new Promise((resolve) => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    kernel,
    pool,
    posts,
    close: async () => {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    },
  };
}

test.before(async () => {
  helper = await import('../../scripts/one-chat-window/kernel-window.mjs');
  todayHost = await import('../../scripts/one-chat-window/today-host.mjs');
  helper.kernelPlatform();
  fixture = await startFixture();
  browser = await helper.toolchain('playwright').chromium.launch({ headless: true });
});

test.after(async () => {
  await browser?.close();
  await fixture?.close();
});

async function openMarketplace(width, height) {
  const phone = width < 600;
  const context = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone });
  const page = await context.newPage();
  const errors = [], outside = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/*', (route) => (
    new URL(route.request().url()).origin === fixture.origin
      ? route.continue()
      : (outside.push(route.request().url()), route.abort())
  ));
  const press = phone ? (locator) => locator.tap() : (locator) => locator.click();
  await page.goto(`${fixture.origin}/api/purchasing/marketplace`);
  await page.locator('#grid .card').first().waitFor({ timeout: 15000 });
  return { context, page, errors, outside, press };
}

for (const [width, height] of [[1440, 900], [412, 915]]) {
  test(`${width}x${height}: shopping-chat.html mounts the one chat window as shopping-concierge and sends screen_state`, async () => {
    const { context, page, errors, outside, press } = await openMarketplace(width, height);
    try {
      await page.locator('#shipAddress').fill('100 Harbor Way');
      const chat = await helper.chatWindow(page, WINDOW);
      const addr = await todayHost.windowAddress(page, WINDOW);
      assert.equal(addr.path, '/api/jarvis/');
      assert.equal(addr.app, 'purchasing');
      assert.equal(addr.bot, 'shopping-concierge');
      await helper.windowControls(chat);
      const pickedLabel = await helper.pickModel(chat, press, 'picked');
      assert.match(pickedLabel, /Picked model/);
      const { ask } = await helper.sendInWindow(chat, 'Which milk is on screen?', press, fixture.kernel);
      assert.equal(ask.bot, 'shopping-concierge');
      assert.equal(ask.context.app, 'purchasing');
      assert.equal(ask.context.provider, 'picked');
      assert.equal(ask.context.model, 'picked-model');
      const screen = ask.context.screen_state;
      assert.equal(screen.tab, 'Shopping');
      assert.match(screen.text, /\[field\] Ship to: 100 Harbor Way/);
      assert.match(screen.text, /Great Value 2% Reduced Fat Milk/);
      assert.equal(await page.locator('#messages, #chatInput, #chatSend, .chat-row, .msg').count(), 0);
      assert.deepEqual(fixture.posts.filter((p) => p.path === '/api/purchasing/chat'), []);
      await page.locator(WINDOW).scrollIntoViewIfNeeded();
      const box = await page.locator(WINDOW).boundingBox();
      assert.ok(box.height >= (width < 600 ? 480 : 380), `chat window height ${Math.round(box.height)} px`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual([errors, outside], [[], []]);
    } finally {
      await context.close();
    }
  });
}

test('412x915: approving a shopping-list-add card in the chat window adds the item and refreshes the Cart panel', async () => {
  const { context, page, errors, outside, press } = await openMarketplace(412, 915);
  try {
    const chat = await helper.chatWindow(page, WINDOW);
    const before = fixture.pool.tables.items.length;
    const { ask } = await helper.sendInWindow(chat, 'Add Organic Honey to my list', press, fixture.kernel);
    assert.equal(ask.bot, 'shopping-concierge');
    const approve = chat.getByRole('button', { name: 'Approve', exact: true });
    await approve.waitFor({ timeout: 15000 });
    assert.equal(fixture.pool.tables.items.length, before, 'nothing stored before Approve');
    await press(approve);
    await page.locator('#cartItems', { hasText: 'Organic Honey' }).waitFor({ timeout: 15000 });
    assert.equal(fixture.pool.tables.items.length, before + 1);
    assert.deepEqual(fixture.posts.filter((p) => p.path === '/api/purchasing/chat'), []);
    assert.deepEqual([errors, outside], [[], []]);
  } finally {
    await context.close();
  }
});

test('Today (/cockpit/?app=purchasing&screen=shop-lists): Shopping\'s Concierge opens the one chat window with shopping-concierge', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${fixture.origin}/cockpit/?app=purchasing&screen=shop-lists`);
    const listFrame = page.frameLocator('.tool-view-container > iframe');
    await listFrame.locator('#add-title').waitFor({ timeout: 15000 });
    const entries = todayHost.conciergeEntries(page);
    let opened = false;
    for (const entry of entries) {
      if (await entry.locator.isVisible().catch(() => false)) {
        await entry.locator.click();
        opened = true;
        break;
      }
    }
    assert.equal(opened, true, 'Today exposes a visible Concierge entry for Shopping');
    const chat = await helper.chatWindow(page, '#chatWorkspaceFrame');
    const addr = await todayHost.windowAddress(page, '#chatWorkspaceFrame');
    assert.equal(addr.path, '/api/jarvis/');
    assert.equal(addr.app, 'purchasing');
    assert.equal(addr.bot, BOT_ID);
    await helper.windowControls(chat);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
