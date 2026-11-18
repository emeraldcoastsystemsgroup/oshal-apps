/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.12.2 (Roger, 2026-11-16, "for the last time": every chat surface is the core Jarvis chat window, with its model menu). Sports Edge's Concierge rail is the kernel's one chat window as Sports Quant's concierge. In Chromium, over the shipped page and a kernel platform export that carries the window (OSHAL_KERNEL_PLATFORM; without one the suite fails, it never skips), at 1440x900 and at 412x915 on a touch screen: the rail holds the window (concierge=sports-edge, bot=sports-quant) and the window fills it, with its model menu, Files, Tap to talk, Keep trying and New and Recent conversations; a model picked for the request rides on the turn; the turn reaches sports-quant's door as Sports Edge with the board on context.screen_state (the tab, the followed teams, the game in the Preview tab with its event id, and the games the Games tab lists: the keys the old rail sent never reached the model); the page draws no transcript, composer or chat request of its own; nothing runs sideways; no page error; the window's Close hides the rail and the Concierge button brings the same conversation back. A card the person approves in the window reloads the Record they are looking at. Doubled: the model (a scripted answer), the kernel routes the window reads (scripts/one-chat-window/kernel-window.mjs) and Sports Edge's reads (page-shaped answers; the routes have their own suites).
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const TOOLS = path.join(__dirname, '..', 'tools');
const WORDS = 'Is there an edge on this game?';
const RECORD_WORDS = 'Record KC -3.5 as a forward-test pick';
const KICKOFF = new Date(Date.now() + 26 * 3600000).toISOString();
const GAME = { eventId: '401888101', league: 'nfl', date: KICKOFF, homeTeam: 'KC', awayTeam: 'BUF', venue: 'Arrowhead Stadium' };
const FOLLOWED = [{ league: 'nfl', team: 'KC', teamId: '12', displayName: 'Kansas City Chiefs' }];
const TEAMS = [{ abbreviation: 'KC', id: '12', displayName: 'Kansas City Chiefs' }, { abbreviation: 'BUF', id: '2', displayName: 'Buffalo Bills' }];
const GAMES = { games: [{ game: GAME, headline: { projectedMargin: 6.1, homeWinProbability: 0.675, topEdge: { selection: 'KC -3.5', edge: 0.0612 } } }],
  awaitingFollow: false, upstreamOk: true, horizonDays: 8 };
const PREVIEW = { built: true, generatedAt: new Date(Date.now() - 900000).toISOString(), calls: [], preview: {
  ...GAME, neutralSite: false, carriedOver: false, quote: { book: 'DraftKings', homeSpread: -3.5 },
  line: { projectedMargin: 6.1, homeWinProbability: 0.675, signals: [{ model: 'elo', points: 5.8, basis: 'season tape' }], adjustments: [], shadow: [],
    availability: { home: { points: 0, keyLosses: [] }, away: { points: -0.4, keyLosses: [] } } },
  ratings: { KC: { elo: 1612, power: 6.2, offense: 3.1, defense: 3.1 }, BUF: { elo: 1580, power: 4.0, offense: 2.5, defense: 1.5 } },
  context: { restDays: { home: 7, away: 6 }, espnHomeWinPct: 64.2, ats: {}, form: {}, news: [] },
  edges: [{ market: 'spread', side: 'home', selection: 'KC -3.5', price: -110, modelProbability: 0.585, marketProbability: 0.5238, edge: 0.0612, kelly: 0.032 }] } };
const ANSWER = 'The model has an edge of 6.1 points on KC -3.5 against the book.';

let helper, kernel, server, origin, browser;
const reads = { scorecard: 0, ledger: 0 };
const executed = [];

/** @description The record_pick card the scripted concierge proposes; it runs only once the person approves it. */
function proposal() {
  return { id: 'fixture-record-pick', app: 'sports-edge', appName: 'Sports Edge', toolName: 'sports_edge_record_pick', label: 'Record a forward-test pick',
    mode: 'ask', expiresAt: new Date(Date.now() + 300000).toISOString(), input: { action: 'record_pick', eventId: GAME.eventId, selection: 'KC -3.5' } };
}

/** @description What Sports Quant answers: Sports Edge's words for a Sports Edge turn, a refusal for any other. */
function answer(ask) {
  if (ask.bot !== 'sports-quant' || ask.context?.app !== 'sports-edge') return 'Wrong application.';
  if (ask.message === RECORD_WORDS) return { answer: 'I can record KC -3.5 on BUF at KC as a forward-test pick. Approve to record it.', packageToolProposal: proposal() };
  return ANSWER;
}

/** @description The fixture: the window and its stand-in kernel first, then the page, its own files and its reads. */
function fixtureApp(express, platform) {
  const app = express();
  app.use(express.json());
  helper.mountWindow(app, { platform, kernel });
  app.get(['/api/sports-edge/', '/api/sports-edge/ui'], (_req, res) => res.sendFile('sports-edge.html', { root: TOOLS }));
  app.get('/api/sports-edge/concierge.js', (_req, res) => res.type('js').sendFile('concierge.js', { root: TOOLS }));
  app.get('/api/sports-edge/concierge.css', (_req, res) => res.type('css').sendFile('concierge.css', { root: TOOLS }));
  app.get('/api/sports-edge/follow', (_req, res) => res.json({ teams: FOLLOWED }));
  app.get('/api/sports-edge/teams', (_req, res) => res.json({ teams: TEAMS }));
  app.get('/api/sports-edge/games', (_req, res) => res.json(GAMES));
  app.get('/api/sports-edge/preview/:eventId', (_req, res) => res.json(PREVIEW));
  app.get('/api/sports-edge/status', (_req, res) => res.json({ season: { nfl: 2026, nba: 2026 }, refresh: { lastPassAt: new Date(Date.now() - 3600000).toISOString() } }));
  app.get('/api/sports-edge/scorecard', (_req, res) => { reads.scorecard += 1; res.json({ verdicts: [] }); });
  app.get('/api/sports-edge/ledger', (_req, res) => { reads.ledger += 1; res.json({ rows: [] }); });
  app.get('/api/v1/agent/schedules', (_req, res) => res.json({ schedules: [] }));
  app.post('/api/jarvis/package-tools/execute', (req, res) => {
    executed.push({ body: req.body, header: req.get('x-oshal-package-tool') });
    res.json({ status: 200, result: { ok: true, recorded: 'KC -3.5' }, expiresAt: new Date(Date.now() + 60000).toISOString() });
  });
  return app;
}

before(async () => {
  helper = await import('../../scripts/one-chat-window/kernel-window.mjs');
  // The window comes from the kernel's platform: a platform without it is refused in words, never skipped.
  const platform = helper.kernelPlatform();
  kernel = helper.windowKernel({ answer });
  server = fixtureApp(helper.toolchain('express'), platform).listen(0, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await helper.toolchain('playwright').chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  server?.closeAllConnections();
  await new Promise((done) => (server ? server.close(done) : done()));
});

/** @description Sports Edge in a new browser at one size, with every page error, outside request and chat request of the page's own kept. */
async function open(width, height, touch) {
  const context = await browser.newContext({ viewport: { width, height }, ...(touch ? { isMobile: true, hasTouch: true } : {}) });
  const page = await context.newPage();
  const errors = [], outside = [], pageAsks = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.frame() === page.mainFrame() && /\/api\/swarm\/bots\/|\/api\/sports-edge\/chat/.test(request.url())) pageAsks.push(request.url());
  });
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : (outside.push(route.request().url()), route.abort())));
  await page.goto(origin + '/api/sports-edge/');
  await page.locator('#gamelist .gamerow').first().waitFor({ timeout: 15000 });
  return { context, page, errors, outside, pageAsks };
}

/** @description The page draws no chat of its own: no transcript, no message box, no prompt chips. */
async function noOwnChat(page) {
  assert.equal(await page.locator('#conciergeLog, #conciergeForm, #conciergeInput, .concierge-composer, .concierge-chip, main textarea, [role="log"]').count(), 0,
    'the page draws no transcript, composer or prompt chips of its own');
}

/** @description Neither the page nor the window inside it scrolls sideways. */
async function nothingSideways(page, chat) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page does not scroll sideways');
  assert.equal(await chat.locator('html').evaluate((html) => html.scrollWidth <= html.ownerDocument.defaultView.innerWidth), true, 'the window does not scroll sideways');
}

/** @description The window's frame box against the rail's, within a pixel. */
async function fills(page) {
  const [rail, frame] = await Promise.all([page.locator('#conciergeRail').boundingBox(), page.locator('#conciergeRail iframe.jarvis-chat-frame').boundingBox()]);
  for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(rail[key] - frame[key]) <= 1, `the window fills the rail (${key}: rail ${rail[key]}, window ${frame[key]})`);
  return rail;
}

/** @description With SPORTS_EDGE_SCREENSHOTS naming a folder, the screen as the person sees it after the turn. */
async function shoot(page, name) {
  if (process.env.SPORTS_EDGE_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.SPORTS_EDGE_SCREENSHOTS, name) });
}

/** @description The window the rail holds, named for Sports Edge's concierge. */
async function railWindow(page) {
  const chat = await helper.chatWindow(page.locator('#conciergeRail'));
  const src = await page.locator('#conciergeRail iframe.jarvis-chat-frame').getAttribute('src');
  const address = new URL(src, origin);
  assert.deepEqual([address.pathname, address.searchParams.get('concierge'), address.searchParams.get('bot')], ['/api/jarvis/', 'sports-edge', 'sports-quant'],
    'the rail is the one chat window as Sports Edge\'s concierge');
  return chat;
}

test('1440x900: the Concierge rail is the one chat window, and the board on screen reaches Sports Quant', async () => {
  const { context, page, errors, outside, pageAsks } = await open(1440, 900, false);
  const click = (locator) => locator.click();
  try {
    await page.locator('#gamelist .gamerow').first().click();
    await page.locator('#previewBody h2', { hasText: 'BUF @ KC' }).waitFor({ timeout: 15000 });
    assert.equal(await page.getAttribute('body', 'data-concierge'), 'open', 'on a desktop the rail is open');
    const chat = await railWindow(page);
    await helper.windowControls(chat);
    const rail = await fills(page);
    assert.ok(Math.abs(rail.x + rail.width - 1440) <= 1 && rail.y <= 1 && Math.abs(rail.height - 900) <= 1, `the rail is the right column, full height (${JSON.stringify(rail)})`);
    assert.equal(await helper.pickModel(chat, click), 'Picked model', 'the model picked for this request is shown on the control');
    const { ask } = await helper.sendInWindow(chat, WORDS, click, kernel);
    assert.deepEqual([ask.door, ask.message, ask.context.app], ['/api/swarm/bots/sports-quant/ask', WORDS, 'sports-edge'], 'the person\'s words reach Sports Quant as Sports Edge');
    assert.deepEqual([ask.context.provider, ask.context.model], ['picked', 'picked-model'], 'the pick rides on that request');
    const screen = ask.context.screen_state || {};
    assert.deepEqual([screen.title, screen.tab], ['Sports Edge', 'Preview'], 'the screen is named with its tab');
    assert.match(screen.text || '', /Followed teams \(1\): NFL KC \(Kansas City Chiefs\)\./, 'the followed teams reach the bot');
    assert.match(screen.text || '', /Game in the Preview tab: BUF @ KC, NFL, event 401888101, /, 'the game in the Preview tab reaches the bot with its event id');
    assert.match(screen.text || '', /Games tab: 1 upcoming game for the followed teams\./, 'the games the Games tab lists reach the bot');
    await noOwnChat(page);
    assert.deepEqual(pageAsks, [], 'every turn is the window\'s: the page sends no chat request of its own');
    await nothingSideways(page, chat);
    await shoot(page, 'sports-edge-1440.png');
    // The window's own Close hides the rail; the page's Concierge button brings the same conversation back.
    await click(chat.locator('.jc-header .jc-panel-close'));
    await page.locator('#conciergeRail').waitFor({ state: 'hidden', timeout: 5000 });
    await click(page.locator('#conciergeToggle'));
    await page.locator('#conciergeRail').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await chat.locator('#convo .msg.bot').count(), 1, 'the conversation is still there');
    assert.deepEqual([errors, outside], [[], []]);
  } finally { await context.close(); }
});

test('412x915 touch: the Concierge opens the one chat window over the whole screen, with the board on the turn', async () => {
  const { context, page, errors, outside, pageAsks } = await open(412, 915, true);
  const tap = (locator) => locator.tap();
  try {
    assert.equal(await page.getAttribute('body', 'data-concierge'), 'closed', 'on a phone the rail starts closed');
    assert.equal(await page.locator('#conciergeRail').isVisible(), false);
    await tap(page.locator('#conciergeToggle'));
    const chat = await railWindow(page);
    await helper.windowControls(chat);
    const rail = await fills(page);
    assert.deepEqual([rail.x, rail.y, rail.width, rail.height].map(Math.round), [0, 0, 412, 915], 'the window is the whole screen');
    assert.equal(await helper.pickModel(chat, tap), 'Picked model');
    const { ask } = await helper.sendInWindow(chat, WORDS, tap, kernel);
    assert.deepEqual([ask.door, ask.message, ask.context.app, ask.context.provider, ask.context.model],
      ['/api/swarm/bots/sports-quant/ask', WORDS, 'sports-edge', 'picked', 'picked-model']);
    const screen = ask.context.screen_state || {};
    assert.deepEqual([screen.title, screen.tab], ['Sports Edge', 'Games'], 'a followed team opens on Games');
    assert.match(screen.text || '', /Followed teams \(1\): NFL KC \(Kansas City Chiefs\)\./);
    assert.match(screen.text || '', /Games tab: 1 upcoming game for the followed teams\./);
    assert.match(screen.text || '', /Game in the Preview tab: none yet/);
    await noOwnChat(page);
    assert.deepEqual(pageAsks, []);
    await nothingSideways(page, chat);
    await shoot(page, 'sports-edge-412.png');
    await tap(chat.locator('.jc-header .jc-panel-close'));
    await page.locator('#conciergeRail').waitFor({ state: 'hidden', timeout: 5000 });
    assert.equal(await page.getAttribute('body', 'data-concierge'), 'closed');
    assert.deepEqual([errors, outside], [[], []]);
  } finally { await context.close(); }
});

test('a card the person approves in the window runs once, and the Record they are looking at is read again', async () => {
  const { context, page, errors } = await open(1440, 900, false);
  const click = (locator) => locator.click();
  try {
    await click(page.locator('nav button[data-tab="record"]'));
    await page.waitForFunction(() => !/loading/.test(document.getElementById('ledger').textContent));
    const chat = await railWindow(page);
    await helper.sendInWindow(chat, RECORD_WORDS, click, kernel);
    const approve = chat.getByRole('button', { name: 'Approve', exact: true });
    await approve.waitFor({ timeout: 15000 });
    assert.equal(executed.length, 0, 'nothing is recorded before the person approves');
    await page.waitForTimeout(400);
    const before = { ...reads };
    await click(approve);
    for (const until = Date.now() + 10000; !(executed.length === 1 && reads.scorecard > before.scorecard && reads.ledger > before.ledger);) {
      assert.ok(Date.now() < until, `the approved card ran once and the Record was read again (ran ${executed.length}, reads ${JSON.stringify(reads)} after ${JSON.stringify(before)})`);
      await new Promise((done) => setTimeout(done, 100));
    }
    assert.deepEqual(executed, [{ body: { proposalId: 'fixture-record-pick' }, header: '1' }]);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
