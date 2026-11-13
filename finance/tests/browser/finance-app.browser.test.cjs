/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.5.0: Finance as its own application, in headless Chromium with stand-in answers in the shapes the kernel
 *     |                                             | really gives (read on the test slot, 2026-11-11). The real page from disk: its own bar with Home and the
 *     |                                             | menu's sections; a Home that shows each summary's tiles (a net worth as money), the finance jobs grouped by
 *     |                                             | application with last run, result and next run, and the link to the Jobs page; a section opens inside the
 *     |                                             | page and a reload returns to it; a phone gets a bottom bar and no sideways scroll; inside a cockpit-like
 *     |                                             | page the cockpit's frame is hidden; and the page makes no request other than GET.
 *     |                                             | A summary that does not answer is said in words while the others still show. FX_SHOTS=<folder> keeps screenshots.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Bank/trading journey leads with dated saved bank data, filtered navigation and accessible More; secondary activity is disclosed; leaving Finance restores host chrome and opening Home issues reads only.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Keep declared withheld bank totals Unknown on Home while retaining a reported zero.
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ORIGIN = 'http://finance.fixture.test';
const PAGE = process.env.FINANCE_FRAME_HTML || path.resolve(__dirname, '../../tools/finance-app.html');
/** @description Load Playwright from the store toolchain or a sibling checkout. @returns {object} The playwright module. */
function playwright() {
  const roots = [process.env.STORE_CI_TOOLCHAIN, path.resolve(__dirname, '../../../scripts/toolchain/node_modules'),
    path.resolve(__dirname, '../../../../oshal-apps/scripts/toolchain/node_modules'), path.resolve(__dirname, '../../../../oshal/src/node_modules')].filter(Boolean);
  for (const root of roots) if (fs.existsSync(path.join(root, 'playwright'))) return require(path.join(root, 'playwright'));
  throw new Error(`BLOCKED: playwright not found (npm ci --prefix scripts/toolchain). Tried ${roots.join(', ')}`);
}

const item = (id, label, iframeUrl, section = 'top') => ({ id: `tool-${id}`, label, section, toolUi: { iframeUrl } });
const PROFILE = { profile: { ribbon: { items: [
  item('finance-app', 'Finance', '/api/finance/app'), item('finance-home', 'Money', '/api/finance/'),
  item('finance-banks', 'Linked banks', '/api/finance/?view=banks', 'bottom'), item('finance-trading', 'Intelligent Trades', '/api/trading/'),
  item('finance-world', 'World Intelligence', '/api/world/app'), item('finance-kalshi', 'Kalshi Edge', '/api/kalshi/'),
  item('finance-recap', 'Daily recap', '/api/daily-trade-recap/review'),
] } } };
const job = (app, name, cron, more = {}) => ({ app, name, cron, cadence: cron, description: `${name} does its work.`, status: 'not-activated', executionCount: 0, failureCount: 0,
  lastRunAt: null, lastOutcome: null, lastDurationMs: null, nextRunAt: null, history: [], ...more });
const JOBS = { schedules: [
  job('little-monsters', 'lesson-refresh', '0 6 * * *', { status: 'active' }),
  job('intelligent-trades', 'paper-autopilot', '*/5 9-15 * * 1-5', { status: 'active', description: 'Runs your paper strategies during the session.', executionCount: 692, failureCount: 3,
    lastRunAt: '2026-11-10T20:55:17.530Z', lastOutcome: 'completed', lastDurationMs: 4200, nextRunAt: '2026-11-11T14:00:00.000Z' }),
  job('intelligent-trades', 'oshal-daily-report', '5 17 * * 1-5', { status: 'active', description: 'Writes the daily report after the close.', executionCount: 12, failureCount: 1,
    lastRunAt: '2026-11-10T17:05:09.000Z', lastOutcome: 'failed', nextRunAt: '2026-11-11T17:05:00.000Z' }),
  job('intelligent-trades', 'quant-desk', '* 17-23 * * 1-5'),
  job('kalshi', 'background-scan', '*/15 * * * *', { description: "Scan Kalshi's open markets when the snapshot is due." }),
  job('daily-trade-recap', 'daily-trade-recap-recorded-reports', '*/15 * * * *', { status: 'suspended' }),
] };
const SUMMARIES = {
  '/api/finance/home-summary': { tiles: [{ id: 'linked-institutions', label: 'Saved bank links', value: '1' }, { id: 'cached-net-worth', label: 'Cached net worth', value: '{"assets":86541.74,"liabilities":163705.89,"net":-77164.15}' }],
    items: [{ text: 'Your saved account snapshot', detail: 'Source: sandbox', tone: 'neutral', fix: 'finance-home' }] },
  '/api/trading/home-summary': { tiles: [{ id: 'live-orders-24h', label: 'Live order records / 24h', value: '0' }, { id: 'paper-orders-24h', label: 'Paper order records / 24h', value: '14' }],
    items: [{ text: 'No saved trading books yet.', tone: 'neutral', fix: 'intelligent-trades-home' }] },
  '/api/kalshi/home-summary': { tiles: [{ id: 'alerts-24h', label: 'Recorded alerts / 24h', value: '2' }], items: [] },
  '/api/daily-trade-recap/home-summary': { tiles: [{ id: 'awaiting', label: 'Recaps awaiting review', value: '1' }], items: [{ text: 'One recap is waiting for your review.', tone: 'warn', fix: 'recap-review' }] },
};
const BANK_STATUS = { connected: 1, env: 'sandbox', configured: true, items: [], hasData: true };
const BANK_SNAPSHOT = { syncedAt: '2026-11-10T18:15:00Z', aggregate: { sourceEnvironment: 'sandbox', netWorth: { assets: 2450, liabilities: 1050, net: 1400 } } };
const HOST = '<!doctype html><html><head><title>Cockpit</title><style>html,body{margin:0;height:100%}.header-bar{height:48px;background:#333}#ribbonContainer{height:40px;background:#555}.cockpit-body{padding:8px;height:calc(100vh - 88px)}.tool-view-container{height:100%}iframe{width:100%;height:100%;border:0}</style></head>'
  + '<body><div class="header-bar">cockpit header</div><div id="ribbonContainer">cockpit menu</div><div class="cockpit-body"><div class="tool-view-container"><iframe id="tool" src="/api/finance/app"></iframe></div></div></body></html>';

/** Open the page at a viewport with only stand-in answers; every request is recorded. */
async function openApp(browser, viewport, url = `${ORIGIN}/api/finance/app`, failing = '', profile = PROFILE, snapshot = BANK_SNAPSHOT) {
  const phone = viewport.width < 700;
  const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone, deviceScaleFactor: 2, timezoneId: 'America/Chicago', locale: 'en-US' });
  const requests = [];
  await context.route('**/*', (route) => {
    const req = route.request(), u = new URL(req.url());
    requests.push(`${req.method()} ${u.pathname}${u.search}`);
    if (u.origin !== ORIGIN) return route.abort();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname === '/api/finance/app') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', path: PAGE });
    if (u.pathname === '/host') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HOST });
    if (u.pathname === '/api/ui/profile') return json(profile);
    if (failing && u.pathname === failing) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"fixture: this summary does not answer"}' });
    if (u.pathname === '/api/finance/status') return json(BANK_STATUS);
    if (u.pathname === '/api/finance/summary') return json(snapshot);
    if (u.pathname === '/api/v1/agent/schedules') return json(JOBS);
    if (u.pathname === '/api/swarm/roles/me') return json({ displayName: 'Rita Example', email: 'rita@example.test' });
    if (failing && u.pathname === failing) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"fixture: this summary does not answer"}' });
    if (SUMMARIES[u.pathname]) return json(SUMMARIES[u.pathname]);
    if (/^\/shared\//.test(u.pathname)) return route.fulfill({ status: 200, contentType: u.pathname.endsWith('.css') ? 'text/css' : 'application/javascript', body: '' });
    if (/^\/api\/(finance|trading|kalshi|world|daily-trade-recap)\//.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'text/html', body: `<title>section</title><body style="font:16px sans-serif;padding:24px">The page of ${u.pathname}</body>` });
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not in this fixture"}' });
  });
  // The page words times against the clock ("Yesterday", "Today"), so the clock is fixed: 6:00 AM in Chicago on 11 November 2026.
  await context.clock.setFixedTime(new Date('2026-11-11T12:00:00Z'));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'load' });
  return { page, context, requests, errors };
}
const shot = async (page, name) => { if (process.env.FX_SHOTS) { fs.mkdirSync(process.env.FX_SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.FX_SHOTS, `${name}.png`), fullPage: false }); } };
const texts = (page, selector) => page.locator(selector).evaluateAll((nodes) => nodes.map((n) => n.textContent.replace(/\s+/g, ' ').trim()));
async function showActivity(page) { await page.locator('#fxJourney [data-journey="banks"]').waitFor(); await page.locator('#fxMoreActivity>summary').click(); await page.waitForSelector('#fxJobs .fx-row'); }

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

test('Home leads with dated bank context and a trading review, with other saved activity disclosed', async () => {
  const { page, context, requests, errors } = await openApp(browser, { width: 1280, height: 900 });
  try {
    await page.locator('#fxJourney [data-journey="banks"]').waitFor();
    assert.deepEqual(await texts(page, '#fxNav > .fx-tab, #fxNav > details > summary'), ['Home', 'Bank accounts', 'Trades', 'More']);
    assert.match(await page.locator('[data-journey="banks"]').innerText(), /Test bank data[\s\S]*\$1,400[\s\S]*Snapshot saved Nov 10, 2026/i);
    assert.equal(await page.getByRole('button', { name: 'Review trading accounts', exact: true }).isVisible(), true);
    assert.equal(await page.locator('#fxJobs').isVisible(), false, 'technical activity does not overwhelm the entry');
    await shot(page, 'finance-app-journey-desktop');
    await showActivity(page);
    assert.equal(await page.locator('#fxNav .fx-tab[aria-current="page"]').first().textContent(), 'Home');
    assert.equal(await page.locator('#fxName').textContent(), 'Rita Example');
    const tiles = await texts(page, '#fxTiles .fx-tile');
    assert.ok(tiles.includes('Money · Cached net worth−$77,164$86,542 owned · $163,706 owed'), `net worth reads as money: ${JSON.stringify(tiles)}`);
    assert.ok(tiles.includes('Trades · Paper order records / 24h14') && tiles.includes('Markets · Recorded alerts / 24h2') && tiles.includes('Recap · Recaps awaiting review1'), JSON.stringify(tiles));
    assert.deepEqual(await texts(page, '#fxJobs .fx-group'), ['Trades', 'Markets', 'Recap'], 'jobs are grouped by application; another application\'s job is not listed');
    const rows = await page.locator('#fxJobs .fx-row').evaluateAll((nodes) => nodes.map((n) => ({ job: n.dataset.job, state: n.dataset.state, text: n.innerText.replace(/\s+/g, ' ').trim() })));
    assert.deepEqual(rows.map((r) => [r.job, r.state]), [['paper-autopilot', 'ok'], ['oshal-daily-report', 'bad'], ['quant-desk', 'off'], ['background-scan', 'off'], ['daily-trade-recap-recorded-reports', 'off']]);
    assert.match(rows[0].text, /^Paper autopilot Runs your paper strategies during the session\. Yesterday 2:55 PM Finished in 4 s Next: Today 8:00 AM 692 runs, 3 did not finish$/);
    assert.match(rows[1].text, /The last run did not finish/);
    assert.match(rows[2].text, /Has not run yet Not turned on No next run Every minute in its daily window, on trading days$/);
    assert.match(rows[4].text, /Paused/);
    assert.equal(await page.locator('#fxJobs a.fx-jobs-link').getAttribute('href'), '/swarm-admin/jobs');
    const notes = await texts(page, '#fxNotes .fx-note strong');
    assert.equal(notes[0], 'Recap: One recap is waiting for your review.', 'what needs attention comes first');
    assert.match(await page.locator('#fxAsOf').textContent(), /^View refreshed \d{1,2}:\d{2} [AP]M · saved information is dated below$/);
    await shot(page, 'finance-app-home-desktop');
    assert.deepEqual(requests.filter((r) => !r.startsWith('GET ')), [], 'the page only reads');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('a section opens inside the application, More holds the rest, and a reload returns to the section', async () => {
  const { page, context, errors } = await openApp(browser, { width: 1280, height: 900 });
  try {
    await page.waitForSelector('#fxNav .fx-tab');
    await page.locator('#fxNav .fx-tab', { hasText: 'Trades' }).click();
    assert.equal(await page.locator('#fxFrame').getAttribute('src'), '/api/trading/?view=accounts');
    assert.deepEqual([await page.locator('#fxFrame').isVisible(), await page.locator('#fxHome').isVisible()], [true, false]);
    assert.equal(await page.locator('#fxNav .fx-tab[aria-current="page"]').first().textContent(), 'Trades');
    assert.equal(new URL(page.url()).hash, '#/finance-trading');
    assert.equal(await page.title(), 'Intelligent Trades · Finance');
    await page.frameLocator('#fxFrame').locator('body').waitFor();
    assert.match(await page.frameLocator('#fxFrame').locator('body').textContent(), /The page of \/api\/trading\//);
    await shot(page, 'finance-app-section-desktop');
    await page.locator('#fxNav details > summary').click();
    assert.deepEqual(await texts(page, '#fxNav .fx-menu .fx-tab'), ['Connections', 'World', 'Markets', 'Recap']);
    await page.locator('#fxNav .fx-menu .fx-tab', { hasText: 'Connections' }).click();
    assert.equal(await page.locator('#fxFrame').getAttribute('src'), '/api/finance/?view=banks');
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#fxFrame:not([hidden])');
    assert.equal(await page.locator('#fxFrame').getAttribute('src'), '/api/finance/?view=banks', 'the address kept the section');
    await page.locator('#fxNav .fx-tab', { hasText: 'Home' }).click();
    await page.locator('#fxJourney [data-journey="banks"]').waitFor();
    assert.equal(await page.locator('#fxHome').isVisible(), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('a phone gets a bottom bar, rows that stack, targets large enough to press and no sideways scroll', async () => {
  const { page, context, errors } = await openApp(browser, { width: 390, height: 844 });
  try {
    await showActivity(page);
    assert.equal(await page.locator('#fxNav').isVisible(), false, 'the top sections give way to the bottom bar');
    assert.deepEqual(await texts(page, '#fxBottom > .fx-tab, #fxBottom > details > summary'), ['Home', 'Bank accounts', 'Trades', 'More']);
    const sizes = await page.locator('#fxBottom > .fx-tab, #fxBottom > details > summary, #fxRefresh').evaluateAll((nodes) => nodes.map((n) => { const r = n.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    assert.ok(sizes.every(([w, h]) => w >= 44 && h >= 44), `every control is at least 44 x 44: ${JSON.stringify(sizes)}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll');
    const row = await page.locator('#fxJobs .fx-row').first().boundingBox();
    assert.ok(row.width <= 390, 'a job row fits the screen');
    await shot(page, 'finance-app-home-phone');
    await page.locator('#fxBottom details > summary').click();
    assert.deepEqual(await texts(page, '#fxBottom .fx-menu .fx-tab'), ['Connections', 'World', 'Markets', 'Recap']);
    await page.locator('#fxBottom .fx-menu .fx-tab', { hasText: 'Markets' }).click();
    assert.equal(await page.locator('#fxFrame').getAttribute('src'), '/api/kalshi/');
    const frame = await page.locator('#fxFrame').boundingBox(), bar = await page.locator('#fxBottom').boundingBox();
    assert.ok(Math.round(frame.y + frame.height) <= Math.round(bar.y) + 1, 'the section ends where the bottom bar begins');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('opened inside the cockpit, Finance owns the window: the cockpit\'s header and menu are hidden', async () => {
  const { page, context, errors } = await openApp(browser, { width: 1280, height: 900 }, `${ORIGIN}/host`);
  try {
    await page.frameLocator('#tool').locator('#fxJourney [data-journey="banks"]').waitFor({ timeout: 8000 });
    const host = await page.evaluate(() => ({ zen: document.body.classList.contains('zen-mode'), style: Boolean(document.getElementById('fx-own-window')),
      header: getComputedStyle(document.querySelector('.header-bar')).display, menu: getComputedStyle(document.getElementById('ribbonContainer')).display,
      frameTop: Math.round(document.getElementById('tool').getBoundingClientRect().top), frameHeight: Math.round(document.getElementById('tool').getBoundingClientRect().height) }));
    assert.deepEqual(host, { zen: false, style: true, header: 'none', menu: 'none', frameTop: 0, frameHeight: 900 });
    await shot(page, 'finance-app-in-cockpit');
    await page.locator('#tool').evaluate((frame) => { frame.src = '/api/world/app'; });
    await page.frameLocator('#tool').locator('body').waitFor();
    assert.equal(await page.locator('.header-bar').isVisible(), true, 'host chrome returns when another app replaces Finance');
    assert.equal(await page.locator('#ribbonContainer').isVisible(), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('a summary that does not answer is said in words, and the others still show', async () => {
  const { page, context, errors } = await openApp(browser, { width: 1280, height: 900 }, `${ORIGIN}/api/finance/app`, '/api/kalshi/home-summary');
  try {
    await showActivity(page);
    const tiles = await texts(page, '#fxTiles .fx-tile');
    assert.equal(tiles.some((t) => t.startsWith('Markets')), false, 'no Markets tile is invented');
    assert.ok(tiles.some((t) => t.startsWith('Money')) && tiles.some((t) => t.startsWith('Trades')) && tiles.some((t) => t.startsWith('Recap')), JSON.stringify(tiles));
    assert.deepEqual(await texts(page, '#fxNotes .fx-note[data-unread] strong'), ['Markets: could not be read just now.']);
    assert.equal(await page.locator('#fxNotes .fx-note[data-unread] small').textContent(), 'Press Refresh to try again, or open Markets to see it.');
    assert.equal(await page.locator('#fxJobs .fx-row').count(), 5, 'the jobs still show');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('an unavailable bank snapshot stays unknown while trading remains an explicit review entry', async () => {
  const f = await openApp(browser, { width: 412, height: 915 }, `${ORIGIN}/api/finance/app`, '/api/finance/summary');
  try {
    await f.page.locator('[data-journey="banks"]').waitFor();
    assert.equal(await f.page.locator('[data-journey="banks"] .fx-balance').textContent(), 'Unknown');
    assert.match(await f.page.locator('[data-journey="banks"]').innerText(), /Source unknown[\s\S]*Snapshot date unknown/i);
    assert.equal(await f.page.getByRole('button', { name: 'Review trading accounts', exact: true }).isVisible(), true);
    assert.deepEqual(f.requests.filter((r) => !r.startsWith('GET ')), []);
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test('the server-filtered profile controls entry cards and sections', async () => {
  const profile = { profile: { ribbon: { items: [item('finance-home', 'Money', '/api/finance/')] } } };
  const f = await openApp(browser, { width: 1280, height: 900 }, `${ORIGIN}/api/finance/app`, '', profile);
  try {
    await f.page.locator('[data-journey="banks"]').waitFor();
    assert.equal(await f.page.locator('[data-journey="trades"]').count(), 0);
    assert.equal(await f.page.getByRole('button', { name: 'Trades', exact: true }).count(), 0);
    assert.equal(f.requests.some((r) => r.includes('/api/trading/')), false);
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test('browser Back returns to the previous admitted Finance section', async () => {
  const f = await openApp(browser, { width: 1280, height: 900 });
  try {
    await f.page.locator('#fxNav .fx-tab', { hasText: 'Trades' }).click();
    await f.page.locator('#fxNav .fx-tab', { hasText: 'Bank accounts' }).click();
    await f.page.frameLocator('#fxFrame').locator('body').waitFor();
    await f.page.goBack({ waitUntil: 'commit' });
    await f.page.waitForFunction(() => document.getElementById('fxFrame').getAttribute('src') === '/api/trading/?view=accounts');
    assert.equal(new URL(f.page.url()).hash, '#/finance-trading');
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});


test('declared withheld bank totals stay Unknown on Home and a reported zero stays zero', async () => {
  for (const net of [null, 0]) {
    const snapshot = { syncedAt: BANK_SNAPSHOT.syncedAt, aggregate: { currency: 'USD', netWorth: { assets: net, liabilities: net, net } } };
    const f = await openApp(browser, { width: 412, height: 915 }, `${ORIGIN}/api/finance/app`, '', PROFILE, snapshot);
    try {
      assert.equal(await f.page.locator('[data-journey="banks"] .fx-balance').textContent(), net === null ? 'Unknown' : '$0');
      assert.deepEqual(f.requests.filter(r => !r.startsWith('GET ')), []);
    } finally { await f.context.close(); }
  }
});
