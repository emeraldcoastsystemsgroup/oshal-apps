/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise actual Leaflet job pins, entered and explicit GPS centers, account-scoped remembered searches, and phone geometry over disposable synthetic HTTP.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Use ordinary pointer and keyboard activation on centered/off-center waypoints with a radius, and prove direct posting links stay safe.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Prove results precede delayed map assets, list view defers downloads, and superseded searches abort while prior results remain visible.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, startFixture } from './career-theme-fixture.mjs';

const jobs = [
  { id: 42, title: 'Platform Engineer', company: 'Harbor Systems', location: 'Chicago, IL', city: 'Chicago', lat: 41.88, lon: -87.63 },
  { id: 43, title: 'IT Manager', company: 'Example Company', location: 'Chicago, IL', city: 'Chicago', lat: 41.88, lon: -87.63 },
  { id: 44, title: 'Unlocated opening', company: 'Example Company', location: 'Location not recorded' },
];
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/** All requests stay on this disposable server; the real Leaflet assets run without external tiles. */
async function open(t, options = {}) {
  const account = { principal: 'alice' };
  const fixture = await startFixture({ respond: req => {
    if (req.originalUrl.split('?')[0] === '/api/auth/user') return { body: { authenticated: true, tenant: 'fixture-tenant', principal_id: account.principal } };
    if (options.failQuery && req.path.endsWith('/browse') && req.query.q === options.failQuery) return { status: 503, body: { error: 'Synthetic search unavailable.' } };
    if (req.path.endsWith('/browse')) return { body: { jobs: options.jobs || jobs, exhausted: true,
      ...(req.query.near || req.query.lat ? { location: { label: req.query.near || 'Your location',
        center: { lat: Number(req.query.lat || options.center?.lat || 41.88), lon: Number(req.query.lon || options.center?.lon || -87.63) },
        radius_miles: Number(req.query.radius_miles || 25) } } : {}) } };
  } });
  const context = await browser.newContext({ viewport: options.viewport || { width: 1280, height: 900 } });
  t.after(async () => { await context.close(); await fixture.close(); });
  const external = [], errors = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === fixture.origin) {
      if (options.mapGate && /career-(?:leaflet\.(?:js|css)|search-map\.js)$/.test(url.pathname)) await options.mapGate;
      return route.continue();
    }
    external.push(url.href);
    if (process.env.CAREER_MAP_REAL_TILES === '1' && url.origin === 'https://tile.openstreetmap.org') {
      return route.fetch({ timeout: 5000 }).then(response => route.fulfill({ response })).catch(() => route.abort());
    }
    return route.abort();
  });
  await context.addInitScript(denied => {
    window.gpsCalls = 0;
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition(success, failure) {
        window.gpsCalls++;
        if (denied) failure({ code: 1, message: 'Synthetic permission denied' });
        else success({ coords: { latitude: 41.88123, longitude: -87.63123 } });
      },
    } });
  }, !!options.denied);
  const page = await context.newPage(); page.setDefaultTimeout(7000);
  page.on('pageerror', error => errors.push(error.message));
  const url = `${fixture.origin}/api/career-hunter/search-ui`;
  await page.goto(url + (options.query || ''), { waitUntil: 'domcontentloaded' });
  await page.locator('#list .job').first().waitFor();
  if (!options.noMapWait && !options.query?.includes('view=list')) await page.locator('#jobMap path[role="button"]').first().waitFor();
  return { page, fixture, account, external, errors, url };
}

/** Observe actual browse parameters before the action can send its request. */
async function browseAfter(page, expected, action) {
  const [response] = await Promise.all([page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/career-hunter/browse'
      && Object.entries(expected).every(([key, value]) => url.searchParams.get(key) === value);
  }), action()]);
  assert.equal(response.status(), 200);
  await page.locator('#list .job').first().waitFor();
  return new URL(response.url()).searchParams;
}

function clean(value) {
  assert.deepEqual(value.errors, []);
  assert.ok(value.external.every(url => url.startsWith('https://tile.openstreetmap.org/')), 'only optional background tiles attempted external requests');
  assert.deepEqual(value.fixture.requests.filter(row => !['GET', 'HEAD'].includes(row.method)), []);
}

test('actual Leaflet groups approximate city pins, retains unlocated jobs, and sends entered radius criteria', async t => {
  const value = await open(t), { page } = value;
  assert.equal(await page.evaluate(() => window.gpsCalls), 0);
  await page.locator('#jobMap.leaflet-container').waitFor();
  assert.equal(await page.locator('#jobMap .leaflet-overlay-pane path.leaflet-interactive').count(), 1, 'same-city jobs share one real Leaflet point');
  assert.match(await page.locator('#mapNote').innerText(), /2 of 3 jobs.*1 without coordinates remain in the list/);
  assert.equal(await page.locator('#job-44').count(), 1);
  await page.locator('#jobMap .leaflet-overlay-pane path.leaflet-interactive').click();
  assert.equal(await page.locator('.leaflet-popup-content button').count(), 2);
  await page.locator('.leaflet-popup-content button').filter({ hasText: 'IT Manager' }).click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'job-43');
  await browseAfter(page, { near: 'Chicago, IL', radius_miles: '25' }, () => page.locator('#near').fill('Chicago, IL'));
  await browseAfter(page, { near: 'Chicago, IL', radius_miles: '50' }, async () => {
    await page.locator('#radius_miles').fill('50'); await page.locator('#radius_miles').dispatchEvent('change');
  });
  assert.match(await page.locator('#locationStatus').innerText(), /Chicago, IL.*50 mile radius/);
  assert.equal(await page.locator('#jobMap .leaflet-overlay-pane path.leaflet-interactive').count(), 1, 'only job waypoints receive pointer events; radius and search center stay decorative');
  await page.locator('#listView').click(); assert.equal(await page.locator('#mapPanel').isVisible(), false);
  await page.locator('#mapView').click(); assert.equal(await page.locator('#jobMap.leaflet-container').isVisible(), true);
  assert.equal(await page.evaluate(() => window.gpsCalls), 0);
  clean(value);
});

test('Eglin radius renders with stable point sizes, projected geographic bounds and an explicit tile outcome', async t => {
  const center = { lat: 30.4605, lon: -86.5505 };
  const localJobs = [
    { id: 42, title: 'Information System Security Manager', company: 'Fixture employer', location: 'a regional federal hub, FL', city: 'a regional federal hub', ...center },
    { id: 43, title: 'IT Systems Manager', company: 'Example employer', location: 'Niceville, FL', city: 'Niceville', lat: 30.5169, lon: -86.4822 },
  ];
  const value = await open(t, { viewport: { width: 1440, height: 1100 }, center, jobs: localJobs,
    query: '?near=Eglin%20AFB%2C%20FL&radius_miles=25' });
  const { page } = value;
  await page.waitForFunction(() => !document.querySelector('#jobMap').classList.contains('leaflet-zoom-anim'));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const geometry = await page.evaluate(() => {
    const map = document.getElementById('jobMap').getBoundingClientRect();
    const paths = [...document.querySelectorAll('#jobMap .leaflet-overlay-pane path')];
    const bounds = path => { const box = path.getBoundingClientRect(); return { left: box.left - map.left,
      right: box.right - map.left, top: box.top - map.top, bottom: box.bottom - map.top, width: box.width, height: box.height }; };
    const radius = paths.find(path => path.getAttribute('fill-opacity') === '0.06');
    const tile = document.querySelector('#jobMap .leaflet-tile');
    return { map: { width: map.width, height: map.height }, radius: radius && bounds(radius),
      points: paths.filter(path => path.getAttribute('stroke') !== '#0f766e').map(bounds),
      zoom: Number(tile?.src.match(/openstreetmap\.org\/(\d+)\//)?.[1]) };
  });
  assert.equal(geometry.points.length, 2);
  for (const point of geometry.points) assert.ok(point.width >= 20 && point.width <= 44, `point diameter ${point.width} CSS pixels is bounded independently of zoom`);
  assert.ok(geometry.radius && Number.isInteger(geometry.zoom));
  const expectedDiameter = 2 * 25 * 1609.344 / (156543.03392804097 * Math.cos(center.lat * Math.PI / 180) / 2 ** geometry.zoom);
  assert.ok(Math.abs(geometry.radius.width - expectedDiameter) / expectedDiameter < 0.03,
    `25-mile projected diameter ${geometry.radius.width}px agrees with ${expectedDiameter.toFixed(2)}px at zoom ${geometry.zoom}`);
  assert.ok(geometry.radius.left >= 10 && geometry.radius.right <= geometry.map.width - 10);
  assert.ok(geometry.radius.top >= 10 && geometry.radius.bottom <= geometry.map.height - 10);
  await page.waitForFunction(() => {
    const tiles = [...document.querySelectorAll('#jobMap .leaflet-tile')];
    return tiles.length > 0 && tiles.every(tile => tile.complete && (!tile.naturalWidth || Number(getComputedStyle(tile).opacity) >= 0.99));
  }, null, { timeout: 7000 });
  const tiles = await page.locator('#jobMap .leaflet-tile').evaluateAll(tiles => ({ loaded: tiles.filter(tile => tile.naturalWidth > 0).length,
    failed: tiles.filter(tile => !tile.naturalWidth).length }));
  assert.ok(tiles.loaded > 0 || /Background map tiles are unavailable/.test(await page.locator('#mapNote').innerText()), 'map background loads or reports its unavailability');
  if (process.env.CAREER_MAP_SCREENSHOT_DIR) {
    await mkdir(process.env.CAREER_MAP_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: resolve(process.env.CAREER_MAP_SCREENSHOT_DIR, 'career-local-map-settled.png'), fullPage: true });
  }
  clean(value);
});

test('radius and center overlays never block waypoint clicks, posting links, or keyboard activation', async t => {
  const center = { lat: 30.4605, lon: -86.5505 };
  const value = await open(t, { center, query: '?near=Eglin%20AFB%2C%20FL&radius_miles=25', jobs: [
    { id: 42, title: 'Base IT Manager', company: 'Example employer', city: 'a regional federal hub', ...center,
      url: 'https://example.org/jobs/42' },
    { id: 43, title: 'College IT Manager', city: 'Niceville', lat: 30.5169, lon: -86.4822,
      url: 'javascript:alert(1)' },
  ] });
  const { page } = value;
  const base = page.getByRole('button', { name: '1 job · a regional federal hub', exact: true });
  await base.click();
  const popup = page.locator('.leaflet-popup-content');
  await popup.getByRole('button', { name: 'Base IT Manager · Example employer', exact: true }).waitFor();
  const link = popup.getByRole('link', { name: 'View & apply' });
  assert.equal(await link.getAttribute('href'), 'https://example.org/jobs/42');
  assert.equal(await link.getAttribute('target'), '_blank');
  assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
  await popup.getByRole('button', { name: 'Base IT Manager · Example employer', exact: true }).click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'job-42');
  await page.locator('.leaflet-popup-close-button').last().click();
  await base.focus(); await page.keyboard.press('Enter');
  await popup.getByRole('link', { name: 'View & apply' }).waitFor();
  await page.locator('.leaflet-popup-close-button').last().click();
  const college = page.getByRole('button', { name: '1 job · Niceville', exact: true });
  await college.click();
  await popup.getByRole('button', { name: 'College IT Manager', exact: true }).waitFor();
  assert.equal(await popup.filter({ has: page.getByRole('button', { name: 'College IT Manager', exact: true }) }).locator('a').count(), 0, 'unsafe provider URLs never become popup links');
  await page.locator('.leaflet-popup-close-button').last().click();
  await college.focus(); await page.keyboard.press('Space');
  await popup.getByRole('button', { name: 'College IT Manager', exact: true }).waitFor();
  clean(value);
});

test('job results and subsequent searches do not wait for slow map assets', async t => {
  let release;
  const mapGate = new Promise(resolve => { release = resolve; });
  const value = await open(t, { noMapWait: true, mapGate }), { page } = value;
  t.after(() => release());
  assert.equal(await page.locator('#list .job').count(), 3);
  assert.equal(await page.locator('#jobMap.leaflet-container').count(), 0);
  assert.match(await page.locator('#mapNote').innerText(), /Loading map.*results are ready/);
  await browseAfter(page, { q: 'platform' }, () => page.locator('#q').fill('platform'));
  assert.equal(await page.locator('#list .job').count(), 3);
  release(); await page.locator('#jobMap path[role="button"]').first().waitFor();
  assert.match(await page.locator('#mapNote').innerText(), /2 of 3 jobs/);
  clean(value);
});

test('list-only searches download no map assets until Map is selected', async t => {
  const value = await open(t, { query: '?view=list' }), { page, fixture } = value;
  const mapRequests = () => fixture.requests.filter(row => /career-(?:leaflet\.(?:js|css)|search-map\.js)$/.test(row.path));
  assert.equal(mapRequests().length, 0);
  await page.locator('#mapView').click();
  await page.locator('#jobMap path[role="button"]').first().waitFor();
  assert.equal(mapRequests().length, 3);
  clean(value);
});

test('GPS is requested only by its button and denied permission preserves entered search criteria', async t => {
  const value = await open(t, { denied: true, query: '?near=Chicago%2C%20IL&radius_miles=35' }), { page, fixture } = value;
  const before = fixture.requests.filter(row => row.path.endsWith('/browse')).length;
  assert.equal(await page.evaluate(() => window.gpsCalls), 0);
  await page.locator('#useLocation').click();
  assert.equal(await page.evaluate(() => window.gpsCalls), 1);
  assert.match(await page.locator('#locationStatus').innerText(), /permission was denied.*Enter a city/);
  assert.equal(await page.locator('#near').inputValue(), 'Chicago, IL');
  assert.equal(await page.locator('#radius_miles').inputValue(), '35');
  assert.equal(await page.locator('#useLocation').isEnabled(), true);
  assert.equal(fixture.requests.filter(row => row.path.endsWith('/browse')).length, before);
  clean(value);
});

test('explicit GPS success submits rounded coordinates and radius without an entered place', async t => {
  const value = await open(t), { page } = value;
  const query = await browseAfter(page, { lat: '41.88123', lon: '-87.63123', radius_miles: '25' }, () => page.locator('#useLocation').click());
  assert.equal(query.has('near'), false);
  assert.equal(await page.evaluate(() => window.gpsCalls), 1);
  assert.match(await page.locator('#locationStatus').innerText(), /Your location.*25 mile radius/);
  clean(value);
});

test('named and last successful searches reopen for the same account and remain isolated from another account', async t => {
  const value = await open(t), { page, account, url } = value;
  await browseAfter(page, { q: 'platform' }, () => page.locator('#q').fill('platform'));
  await browseAfter(page, { q: 'platform', near: 'Chicago, IL', radius_miles: '25' }, () => page.locator('#near').fill('Chicago, IL'));
  await page.locator('#savedSearchName').fill('Local platform roles'); await page.locator('#saveSearch').click();
  assert.match(await page.locator('#savedSearchStatus').innerText(), /Search saved/);
  const savedId = await page.locator('#savedSearchList option').nth(1).getAttribute('value');
  await browseAfter(page, { q: 'manager' }, () => page.locator('#q').fill('manager'));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#q').value === 'manager');
  assert.equal(await page.locator('#near').inputValue(), 'Chicago, IL');
  await page.locator('#savedSearchList').selectOption(savedId);
  await browseAfter(page, { q: 'platform' }, () => page.locator('#loadSearch').click());
  account.principal = 'bob'; await page.goto(url); await page.locator('#list .job').first().waitFor();
  assert.equal(await page.locator('#q').inputValue(), '');
  assert.equal(await page.locator('#savedSearchList option').count(), 1);
  account.principal = 'alice'; await page.goto(url); await page.locator('#list .job').first().waitFor();
  assert.equal(await page.locator('#q').inputValue(), 'platform');
  await page.locator('#savedSearchList').selectOption(savedId); await page.locator('#deleteSearch').click();
  assert.match(await page.locator('#savedSearchStatus').innerText(), /Saved search removed/);
  await page.goto(url); await page.locator('#list .job').first().waitFor();
  assert.equal(await page.locator('#savedSearchList option').count(), 1);
  clean(value);
});

test('failed or superseded searches cannot replace the last successful criteria or current results', async t => {
  const value = await open(t, { failQuery: 'broken' }), { page, url } = value;
  await browseAfter(page, { q: 'platform' }, () => page.locator('#q').fill('platform'));
  const [failed] = await Promise.all([page.waitForResponse(response => new URL(response.url()).searchParams.get('q') === 'broken'),
    page.locator('#q').fill('broken')]);
  assert.equal(failed.status(), 503);
  await page.locator('#searchStatus').filter({ hasText: 'Could not update results' }).waitFor();
  assert.equal(await page.locator('#list .job').count(), 3, 'failed updates retain explicitly labeled prior results');
  await page.locator('#savedSearchName').fill('Must not save failed results'); await page.locator('#saveSearch').click();
  assert.match(await page.locator('#savedSearchStatus').innerText(), /Wait for a successful search/);
  const key = 'career-search:v1:fixture-tenant:alice';
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).last.q, key), 'platform');
  await page.goto(url); await page.locator('#list .job').first().waitFor();
  assert.equal(await page.locator('#q').inputValue(), 'platform');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/browse?*', async route => {
    if (new URL(route.request().url()).searchParams.get('q') !== 'slow') return route.continue();
    await gate; return route.fulfill({ status: 503, json: { error: 'Superseded failure' } });
  });
  await Promise.all([page.waitForRequest(request => new URL(request.url()).searchParams.get('q') === 'slow'), page.locator('#q').fill('slow')]);
  const aborted = page.waitForEvent('requestfailed', request => new URL(request.url()).searchParams.get('q') === 'slow');
  assert.equal(await page.locator('#list .job').count(), 3, 'prior results stay visible during the pending request');
  assert.match(await page.locator('#searchStatus').innerText(), /Updating results/);
  await browseAfter(page, { q: 'current' }, () => page.locator('#q').fill('current'));
  assert.match((await aborted).failure().errorText, /ABORTED|abort/i);
  release();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('#list .job').count(), 3);
  assert.doesNotMatch(await page.locator('#locationStatus').innerText(), /Superseded failure/);
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).last.q, key), 'current');
  clean(value);
});

for (const width of [320, 390, 768]) test(`map, location controls and remembered searches fit at ${width}px`, async t => {
  const value = await open(t, { viewport: { width, height: 844 } }), { page } = value;
  const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
    boxes: ['jobMap', 'near', 'radius_miles', 'savedSearchName', 'savedSearchList'].map(id => {
      const box = document.getElementById(id).getBoundingClientRect(); return { id, left: box.left, right: box.right };
    }) }));
  assert.ok(geometry.scroll <= geometry.width, `document ${geometry.scroll}px in ${geometry.width}px`);
  for (const box of geometry.boxes) assert.ok(box.left >= 0 && box.right <= width, `${box.id} fits the screen`);
  assert.equal(await page.evaluate(() => window.gpsCalls), 0);
  clean(value);
});
