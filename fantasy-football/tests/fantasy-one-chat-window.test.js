/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.4.2 (Roger, 2026-11-16, "for the last time": every chat surface is the core Jarvis chat window, with its model menu). Fantasy Football's Concierge rail (and Intelligent Sports, which opens the same page) is the kernel's one chat window as Fantasy Quant's concierge. In Chromium, over the shipped page and a kernel platform export that carries the window (OSHAL_KERNEL_PLATFORM; without one the suite fails, it never skips), at 1440x900 and at 412x915 on a touch screen: the rail holds the window (concierge=fantasy-football, bot=fantasy-quant) and the window fills it, with its model menu, Files, Tap to talk, Keep trying and New and Recent conversations; a model picked for the request rides on the turn; the turn reaches fantasy-quant's door as Fantasy Football with the screen on context.screen_state (the view, the board, the league on screen with the ids the Fantasy Quant tools take, the leagues in the League menu and the board's own words: the activeView, activeBoard and selectedLeague keys the old rail sent never reached the model); the page draws no transcript, composer or chat request of its own; nothing runs sideways; no page error; the window's Close hides the rail and the Concierge button brings the same conversation back. A lineup card the person approves in the window runs once, and the board on screen is read again. Doubled: the model (a scripted answer), the kernel routes the window reads (scripts/one-chat-window/kernel-window.mjs) and Fantasy Football's reads (page-shaped answers; the routes have their own suites).
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const TOOLS = path.join(__dirname, '..', 'tools');
const WORDS = 'Which waiver add helps my lineup most?';
const LINEUP_WORDS = 'Start Jaylen Warren over Tyler Allgeier this week';
const STATUS = { connected: true, credentialSupported: true, season: 2026,
  leagues: [{ season: 2026, leagueId: 4242, leagueName: 'Gulf Coast League', teamName: 'Murphy Law' }] };
const MANUAL = { leagues: [{ id: 7, season: 2026, name: 'Quant Flex League' }] };
const ANSWER = 'Puka Nacua is the add: +21.4 over the rest of the season for an $18 bid, dropping Tyler Allgeier.';

let helper, kernel, server, origin, browser;
const lineupReads = [];
const executed = [];

/** @description A Lineup board as POST /lineup/record answers it, for the league the request names. */
function lineupBoard(body) {
  const team = body && body.manualId ? 'My team' : 'Murphy Law';
  return { scoring: { ok: true }, team: { name: team }, league: { week: 4 }, scoringRules: 'league', currentTotal: 101.4,
    matchup: { opponentName: 'Theirs', yourProjected: 104.6, opponentProjected: 99.1, winProbability: 0.62, meanWinProbability: 0.6, posture: 'favourite', swaps: [] },
    optimal: { total: 104.6, starters: [{ slotId: 0, player: { name: 'Josh Allen' }, points: 24.1 }, { slotId: 2, player: { name: 'Bijan Robinson' }, points: 17.3 },
      { slotId: 23, player: { name: 'Jaylen Warren' }, points: 11 }], bench: [{ player: { name: 'Tyler Allgeier' }, points: 8.2 }] },
    calls: [{ start: { name: 'Jaylen Warren', points: 11 }, sit: { name: 'Tyler Allgeier', points: 8.2 }, gain: 2.8, reason: 'Warren projects 2.8 more this week.' }],
    openSlots: [], projectionsGeneratedAt: new Date(Date.now() - 3600000).toISOString(), projectionsAvailable: 312, projectionFeed: { ok: true, source: 'live' } };
}

/** @description The Waivers board of the hand-typed league. */
const WAIVERS = { team: { name: 'My team' }, mode: 'faab', budget: 90, cap: 30, byesKnown: true, projectionFeed: { ok: true, source: 'live' },
  rows: [{ add: { name: 'Puka Nacua' }, drop: { name: 'Tyler Allgeier' }, gain: 21.4, weeksStarting: 9, bid: 18, scarcity: false }],
  streaming: [], weeks: { fromFeed: [5, 6, 7], fromRate: [8], playoffStart: 15 } };

/** @description The set_lineup card the scripted concierge proposes; it runs only once the person approves it. */
function proposal() {
  return { id: 'fixture-set-lineup', app: 'fantasy-football', appName: 'Fantasy Football', toolName: 'fantasy_quant_set_lineup', label: 'Set or record Fantasy Football lineup',
    mode: 'ask', expiresAt: new Date(Date.now() + 300000).toISOString(), input: { manualId: '7', season: 2026, startPlayerId: 13, sitPlayerId: 12 } };
}

/** @description What Fantasy Quant answers: Fantasy Football's words for a Fantasy Football turn, a refusal for any other. */
function answer(ask) {
  if (ask.bot !== 'fantasy-quant' || ask.context?.app !== 'fantasy-football') return 'Wrong application.';
  if (ask.message === LINEUP_WORDS) return { answer: 'I can start Jaylen Warren over Tyler Allgeier in Quant Flex League. Approve to set it.', packageToolProposal: proposal() };
  return ANSWER;
}

/** @description The fixture: the window and its stand-in kernel first, then the page, its own files and its reads. */
function fixtureApp(express, platform) {
  const app = express();
  app.use(express.json());
  helper.mountWindow(app, { platform, kernel });
  app.get(['/api/fantasy-football/', '/api/fantasy-football/ui'], (_req, res) => res.sendFile('fantasy-football.html', { root: TOOLS }));
  app.get('/api/fantasy-football/concierge.js', (_req, res) => res.type('js').sendFile('concierge.js', { root: TOOLS }));
  app.get('/api/fantasy-football/concierge.css', (_req, res) => res.type('css').sendFile('concierge.css', { root: TOOLS }));
  app.get('/api/fantasy-football/status', (_req, res) => res.json(STATUS));
  app.get('/api/fantasy-football/manual-leagues', (_req, res) => res.json(MANUAL));
  app.post('/api/fantasy-football/lineup/record', (req, res) => { lineupReads.push(req.body); res.json(lineupBoard(req.body)); });
  app.get('/api/fantasy-football/waivers', (_req, res) => res.json(WAIVERS));
  app.get('/api/fantasy-football/record', (_req, res) => res.json({ record: { graded: 0 }, calls: [], weeks: { weeks: 0 } }));
  app.post('/api/jarvis/package-tools/execute', (req, res) => {
    executed.push({ body: req.body, header: req.get('x-oshal-package-tool') });
    res.json({ status: 200, result: { ok: true, startingPlayerIds: [11, 14, 13] }, expiresAt: new Date(Date.now() + 60000).toISOString() });
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

/** @description Fantasy Football in a new browser at one size, with every page error, outside request and chat request of the page's own kept. */
async function open(width, height, touch) {
  const context = await browser.newContext({ viewport: { width, height }, ...(touch ? { isMobile: true, hasTouch: true } : {}) });
  const page = await context.newPage();
  const errors = [], outside = [], pageAsks = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.frame() === page.mainFrame() && /\/api\/swarm\/bots\/|\/api\/voice\/transcribe|\/api\/jarvis\/package-tools\//.test(request.url())) pageAsks.push(request.url());
  });
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : (outside.push(route.request().url()), route.abort())));
  await page.goto(origin + '/api/fantasy-football/');
  await page.locator('#lineupBody h2', { hasText: 'Week 4 vs Theirs' }).waitFor({ timeout: 15000 });
  return { context, page, errors, outside, pageAsks };
}

/** @description Open the hand-typed league's board of one kind from This week's League menu and Board control. */
async function showBoard(page, press, kind, heading) {
  await page.selectOption('#fLeagueSel', 'manual|2026|7');
  await page.locator('#lineupBody h2', { hasText: 'My team' }).first().waitFor({ timeout: 15000 });
  if (kind !== 'lineup') await press(page.locator(`#fBoards button[data-kind="${kind}"]`));
  await page.locator('#lineupBody h2', { hasText: heading }).first().waitFor({ timeout: 15000 });
}

/** @description The page draws no chat of its own: no transcript, no message box, no prompt chips, nothing in the rail but the window. */
async function noOwnChat(page) {
  assert.equal(await page.locator('#conciergeLog, #conciergeForm, #conciergeInput, #conciergeSend, .concierge-composer, .concierge-chip, [role="log"]').count(), 0,
    'the page draws no transcript, composer or prompt chips of its own');
  assert.equal(await page.locator('#conciergeRail :is(textarea, input, button, form)').count(), 0, 'the rail holds the window and nothing of its own');
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

/** @description With FANTASY_SCREENSHOTS naming a folder, the screen as the person sees it after the turn. */
async function shoot(page, name) {
  if (process.env.FANTASY_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.FANTASY_SCREENSHOTS, name) });
}

/** @description The window the rail holds, named for Fantasy Football's concierge. */
async function railWindow(page) {
  const chat = await helper.chatWindow(page.locator('#conciergeRail'));
  const src = await page.locator('#conciergeRail iframe.jarvis-chat-frame').getAttribute('src');
  const address = new URL(src, origin);
  assert.deepEqual([address.pathname, address.searchParams.get('concierge'), address.searchParams.get('bot')], ['/api/jarvis/', 'fantasy-football', 'fantasy-quant'],
    'the rail is the one chat window as Fantasy Football\'s concierge');
  return chat;
}

test('1440x900: the Concierge rail is the one chat window, and the league and board on screen reach Fantasy Quant', { timeout: 120000 }, async () => {
  const { context, page, errors, outside, pageAsks } = await open(1440, 900, false);
  const click = (locator) => locator.click();
  try {
    await showBoard(page, click, 'waivers', 'Waiver board');
    assert.equal(await page.getAttribute('body', 'data-concierge'), 'open', 'on a desktop the rail is open');
    const chat = await railWindow(page);
    await helper.windowControls(chat);
    const rail = await fills(page);
    assert.ok(Math.abs(rail.x + rail.width - 1440) <= 1 && rail.y <= 1 && Math.abs(rail.height - 900) <= 1, `the rail is the right column, full height (${JSON.stringify(rail)})`);
    assert.equal(await helper.pickModel(chat, click), 'Picked model', 'the model picked for this request is shown on the control');
    const { ask } = await helper.sendInWindow(chat, WORDS, click, kernel);
    assert.deepEqual([ask.door, ask.message, ask.context.app], ['/api/swarm/bots/fantasy-quant/ask', WORDS, 'fantasy-football'], 'the person\'s words reach Fantasy Quant as Fantasy Football');
    assert.deepEqual([ask.context.provider, ask.context.model], ['picked', 'picked-model'], 'the pick rides on that request');
    const screen = ask.context.screen_state || {};
    assert.deepEqual([screen.title, screen.tab], ['Fantasy Football', 'Waivers'], 'the screen is named with the board on it');
    assert.match(screen.text || '', /^Fantasy Football, This week view, Waivers board\./, 'the view and the board reach the bot');
    assert.match(screen.text || '', /League on screen: 2026 · Quant Flex League \(typed in\); a league typed in by hand, manualId 7, season 2026\./,
      'the league on screen reaches the bot with the ids the Fantasy Quant tools take');
    assert.match(screen.text || '', /Leagues in the League menu \(2\): 2026 · Gulf Coast League · Murphy Law; 2026 · Quant Flex League \(typed in\)\./, 'the saved leagues reach the bot');
    assert.match(screen.text || '', /Board on screen:\nWaiver board · My team\nBudget left: \$90\nMost one claim may spend: \$30\nAdd \/ Drop \/ Rest-of-season gain \/ Weeks starting \/ Bid\nPuka Nacua \/ Tyler Allgeier \/ \+21\.4 \/ 9 \/ \$18\n/,
      'the board\'s own words reach the bot, a table row with its cells');
    for (const key of ['activeView', 'activeBoard', 'selectedLeague']) assert.equal(key in ask.context, false, `the old rail's ${key} key, which the kernel never read, is not sent`);
    await noOwnChat(page);
    assert.deepEqual(pageAsks, [], 'every turn is the window\'s: the page sends no chat request of its own');
    await nothingSideways(page, chat);
    await shoot(page, 'fantasy-football-1440.png');
    // The window's own Close hides the rail; the page's Concierge button brings the same conversation back.
    await click(chat.locator('.jc-header .jc-panel-close'));
    await page.locator('#conciergeRail').waitFor({ state: 'hidden', timeout: 5000 });
    await click(page.locator('#conciergeToggle'));
    await page.locator('#conciergeRail').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await chat.locator('#convo .msg.bot').count(), 1, 'the conversation is still there');
    assert.deepEqual([errors, outside], [[], []]);
  } finally { await context.close(); }
});

test('412x915 touch: the Concierge opens the one chat window over the whole screen, with the board on the turn', { timeout: 120000 }, async () => {
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
      ['/api/swarm/bots/fantasy-quant/ask', WORDS, 'fantasy-football', 'picked', 'picked-model']);
    const screen = ask.context.screen_state || {};
    assert.deepEqual([screen.title, screen.tab], ['Fantasy Football', 'Lineup'], 'This week opens on the first league\'s Lineup');
    assert.match(screen.text || '', /^Fantasy Football, This week view, Lineup board\./);
    assert.match(screen.text || '', /League on screen: 2026 · Gulf Coast League · Murphy Law; an ESPN league, leagueId 4242, season 2026\./);
    assert.match(screen.text || '', /Board on screen:\nWeek 4 vs Theirs\nYou project: 104\.6\nThey project: 99\.1\nWin chance: 62%\n/);
    assert.match(screen.text || '', /\nJaylen Warren \(11\.0\) \/ Tyler Allgeier \(8\.2\) \/ \+2\.8 \/ Warren projects 2\.8 more this week\.\n/, 'the Start / sit call on screen reaches the bot');
    await noOwnChat(page);
    assert.deepEqual(pageAsks, []);
    await nothingSideways(page, chat);
    await shoot(page, 'fantasy-football-412.png');
    await tap(chat.locator('.jc-header .jc-panel-close'));
    await page.locator('#conciergeRail').waitFor({ state: 'hidden', timeout: 5000 });
    assert.equal(await page.getAttribute('body', 'data-concierge'), 'closed');
    assert.deepEqual([errors, outside], [[], []]);
  } finally { await context.close(); }
});

test('a lineup card the person approves in the window runs once, and the board on screen is read again', { timeout: 120000 }, async () => {
  const { context, page, errors } = await open(1440, 900, false);
  const click = (locator) => locator.click();
  try {
    await showBoard(page, click, 'lineup', 'My team · week 4');
    const chat = await railWindow(page);
    const { ask } = await helper.sendInWindow(chat, LINEUP_WORDS, click, kernel);
    assert.match(ask.context.screen_state?.text || '', /This week view, Lineup board\.[\s\S]*manualId 7, season 2026\./, 'the turn names the hand-typed league the card is for');
    const approve = chat.getByRole('button', { name: 'Approve', exact: true });
    await approve.waitFor({ timeout: 15000 });
    assert.equal(executed.length, 0, 'nothing is set before the person approves');
    // The turn's own hand-back reads the board again too: count from once those reads have settled.
    for (let seen = -1; seen !== lineupReads.length;) { seen = lineupReads.length; await page.waitForTimeout(500); }
    const before = lineupReads.length;
    await click(approve);
    for (const until = Date.now() + 10000; !(executed.length === 1 && lineupReads.length > before);) {
      assert.ok(Date.now() < until, `the approved card ran once and the Lineup board was read again (ran ${executed.length}, board reads ${lineupReads.length} after ${before})`);
      await new Promise((done) => setTimeout(done, 100));
    }
    assert.deepEqual(executed, [{ body: { proposalId: 'fixture-set-lineup' }, header: '1' }]);
    assert.deepEqual(lineupReads.at(-1), { manualId: '7', season: 2026 }, 'the board read again is the hand-typed league on screen');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
