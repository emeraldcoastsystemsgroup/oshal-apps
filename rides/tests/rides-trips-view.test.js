/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (rides-history, rides-concierge). The Trips tile loaded /api/rides/app?view=history and
 *   nothing read view, so it opened the ride planner with one recent trip under the presets. In Chromium at 412x915 the shipped page over a
 *   /history of three trips: ?view=history shows Trips (the planner hidden), one row per trip newest first with its date and time, from → to and
 *   the estimate shown then; Ride again fills Get a Ride and prices that trip (a GET /estimate, no /request); the plain address still opens the
 *   planner. Swap prices the swapped trip at once, and the fare basis is one line under the fares with the server's note as its tooltip. The
 *   manifest keeps one assistant entry (ribbon.hideAssistant) and the page copies no parent tokens. Needs the store toolchain (express,
 *   playwright, chromium).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));
const HTML = fs.readFileSync(path.join(PKG, 'tools', 'rides-app.html'), 'utf8');
const MANIFEST = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');

const TRIPS = [
  { pickup: 'Pensacola Beach, FL', dropoff: 'Pensacola International Airport, Pensacola, FL', ride_type: 'UberX', est_fare_low: '29.00', est_fare_high: '37.00', deep_link: 'https://m.uber.com/a', created_at: '2026-11-05T22:10:00Z' },
  { pickup: 'Destin, FL', dropoff: 'Downtown Pensacola, FL', ride_type: 'Comfort', est_fare_low: null, est_fare_high: null, created_at: '2026-11-04T14:00:00Z' },
  { pickup: 'Home', dropoff: 'Walmart', ride_type: '', est_fare_low: '12', est_fare_high: '12', created_at: '2026-11-01T09:30:00Z' },
];
const NOTE = 'This installation has no Uber rail (no Uber connector exists here). Distance is measured from the two points and the fare is modelled from it.';

async function serve() {
  const app = express();
  const seen = [];
  app.use((req, _res, next) => { seen.push(`${req.method} ${req.path}${req.path === '/api/rides/estimate' ? '?' + new URLSearchParams(req.query) : ''}`); next(); });
  app.get('/api/rides/app', (_req, res) => res.sendFile(path.join(PKG, 'tools', 'rides-app.html')));
  app.get('/api/rides/history', (_req, res) => res.json({ trips: TRIPS }));
  app.get('/api/rides/estimate', (req, res) => res.json({ pickup: req.query.pickup, dropoff: req.query.dropoff, rail: 'keyless', basis: 'geocoded', roadFactor: 1.3,
    distanceKm: 21.1, straightLineKm: 16.2, note: NOTE, options: [{ type: 'uberx', name: 'UberX', fareLow: 29, fareHigh: 37, etaMin: 4 }] }));
  app.use('/api/rides', (_req, res) => res.json({}));
  app.get(/^\/shared\/.*\.js$/, (_req, res) => res.type('js').send(''));
  app.get(/^\/shared\/.*\.css$/, (_req, res) => res.type('css').send(''));
  app.use((_req, res) => res.status(404).type('text').send(''));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, seen, base: `http://127.0.0.1:${server.address().port}` };
}

async function open(t, url) {
  const ctx = await serve();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise((r) => ctx.server.close(r)); });
  const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: 'America/Chicago' })).newPage();
  await page.goto(`${ctx.base}${url}`);
  return { page, seen: ctx.seen };
}

test('?view=history opens Trips: one row per trip, newest first, with when, from → to and the estimate then', async (t) => {
  const { page } = await open(t, '/api/rides/app?view=history');
  await page.locator('#tripList .trip-row').first().waitFor();
  assert.equal(await page.locator('#tripsView').isVisible(), true);
  assert.equal(await page.locator('.content').isVisible(), false, 'the planner is not the Trips screen');
  const rows = await page.locator('#tripList .trip-row').evaluateAll((els) => els.map((e) => ({
    when: e.querySelector('.trip-when').textContent, route: e.querySelector('.trip-route').textContent, fare: e.querySelector('.trip-fare').textContent })));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.route), ['Pensacola Beach, FL → Pensacola International Airport, Pensacola, FL', 'Destin, FL → Downtown Pensacola, FL', 'Home → Walmart']);
  assert.match(rows[0].when, /Nov 5, 2026.*4:10/);
  assert.deepEqual(rows.map((r) => r.fare), ['UberX · $29–37 estimate', 'Comfort · No estimate kept', '$12 estimate']);
  assert.equal(await page.locator('#tripList [data-ride-again]').count(), 3);
});

test('Ride again fills Get a Ride with that trip and prices it, requesting nothing', async (t) => {
  const { page, seen } = await open(t, '/api/rides/app?view=history');
  await page.locator('#tripList [data-ride-again]').nth(1).tap();
  await page.locator('.ride-card, #options .empty').first().waitFor();
  assert.equal(await page.locator('.content').isVisible(), true);
  assert.equal(await page.locator('#tripsView').isVisible(), false);
  assert.equal(await page.inputValue('#pickup'), 'Destin, FL');
  assert.equal(await page.inputValue('#dropoff'), 'Downtown Pensacola, FL');
  await page.waitForFunction(() => document.querySelector('#fareBasis').textContent.length > 0);
  assert.ok(seen.some((s) => s.startsWith('GET /api/rides/estimate?') && s.includes('dropoff=Downtown+Pensacola')), seen.join('\n'));
  assert.ok(!seen.some((s) => s.startsWith('POST /api/rides/request')), 'Ride again requests no ride');
  assert.equal(await page.textContent('#fareBasis'), 'Estimate from a straight line × 1.3');
  assert.equal(await page.getAttribute('#fareBasis', 'title'), NOTE, 'the full explanation is the tooltip, not a paragraph over the map');
});

test('the plain address opens the planner, and Swap prices the swapped trip at once', async (t) => {
  const { page, seen } = await open(t, '/api/rides/app');
  assert.equal(await page.locator('.content').isVisible(), true);
  assert.equal(await page.locator('#distanceRow').isVisible(), false, 'no empty Distance row before a route');
  assert.equal(await page.locator('#tripsView').isVisible(), false);
  await page.fill('#pickup', 'Destin, FL');
  await page.fill('#dropoff', 'Pensacola Beach, FL');
  const before = seen.filter((s) => s.startsWith('GET /api/rides/estimate')).length;
  await page.locator('#swapBtn').tap();
  await page.waitForFunction(() => document.querySelector('#fareBasis').textContent.length > 0);
  const priced = seen.filter((s) => s.startsWith('GET /api/rides/estimate'));
  assert.equal(priced.length, before + 1, seen.join('\n'));
  assert.match(priced[priced.length - 1], /pickup=Pensacola\+Beach%2C\+FL&dropoff=Destin%2C\+FL/);
  assert.doesNotMatch(await page.textContent('#options'), /press Show rides/);
});

test('one assistant entry, and the page follows its own theme', () => {
  const ribbon = MANIFEST.slice(MANIFEST.indexOf('\nribbon:\n'), MANIFEST.indexOf('\nintegrations:\n'));
  assert.match(ribbon, /\n  hideAssistant: true\n/);
  assert.match(MANIFEST, /iframeUrl: \/api\/rides\/app\?view=history/, 'the Trips tile keeps its address, which the page now reads');
  assert.doesNotMatch(HTML, /parentWindow\.getComputedStyle|documentElement\.style\.setProperty\(localName/);
  const css = HTML.slice(HTML.indexOf('<style>\n  :root {\n    --bg: var(--bg-primary'), HTML.indexOf('</style>', HTML.indexOf('--bg: var(--bg-primary')));
  for (const hex of ['#0a0c11', '#11141a', 'rgba(18, 20, 27', 'rgba(13, 15, 20', '#d8d3ff']) assert.ok(!css.includes(hex), `${hex} is gone`);
  assert.doesNotMatch(css, /color: #fff;|color: #0d0f14;/, 'accent ink comes from the theme');
});
