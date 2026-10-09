/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the real Create Brand Graphics launchers (Home studio card, Brand intro clip quick start, New Video card), the access-gated owner summary, exact navigation and narrow layouts, with synthetic local HTTP only and no render, provider or business activity.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, startFixture } from './create-theme-fixture.mjs';

const APP = 'brand-graphics', TOOL = 'create-brand-graphics', URL = '/api/brand-graphics/review';
const SUMMARY = '/api/brand-graphics/home-summary';
const navigation = { type: 'app-navigate', tool: TOOL };
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/** The existing fixture serves real HTML; these records substitute only account-owned API data. */
function respond(options, path, query) {
  if (path === '/api/ui/profile') return options.profileFailure ? { status: 503, body: {} } : {
    profile: { ribbon: { items: [
      { id: 'tool-create-office', label: 'AI Office', toolUi: { iframeUrl: '/api/presentations/sections/ui' } },
      { id: `tool-${TOOL}`, label: 'Brand Graphics', toolUi: { iframeUrl: URL } },
    ] } },
  };
  if (path === '/api/authorization/me' && query.app === APP) return options.denied
    ? { status: 'catalog', denied: true, tier: 'deny' } : { status: 'enforced', denied: false, tier: 'manager' };
  if (path === SUMMARY) return options.summaryFailure ? { status: 503, body: { error: 'synthetic_unavailable' } }
    : options.empty ? { items: [], metrics: [] } : {
      items: [{ text: 'Synthetic brand intro', detail: 'A saved owner-scoped fixture clip', actions: [{ tool: TOOL }] }],
      metrics: [{ label: 'Brand clips', value: '3' }],
    };
  if (path.endsWith('/home-summary')) return { items: [], metrics: [] };
}

/** Refuse external requests; hold only the exact access response when testing summary ordering. */
async function transport(context, fixture, options, state) {
  let releaseAccess, noteAccess;
  const gate = new Promise(resolve => { releaseAccess = resolve; });
  const accessSeen = new Promise(resolve => { noteAccess = resolve; });
  await context.route('**/*', route => {
    const url = new globalThis.URL(route.request().url());
    if (url.origin !== fixture.origin) { state.external.push(url.href); return route.abort(); }
    if (options.holdAccess && url.pathname === '/api/authorization/me' && url.searchParams.get('app') === APP) {
      noteAccess(); return gate.then(() => route.continue());
    }
    return route.continue();
  });
  return { releaseAccess, accessSeen };
}

/** No installed surface or account is contacted, even when the standalone fallback navigates. */
async function open(t, screen = 'home', options = {}) {
  const fixture = await startFixture({ respond: (path, query) => respond(options, path, query) });
  const context = await browser.newContext({ viewport: { width: options.width ?? 1280, height: 900 }, reducedMotion: 'reduce' });
  t.after(async () => { try { await context.close(); } finally { await fixture.close(); } });
  const state = { external: [], errors: [] };
  await context.addInitScript(theme => {
    if (window.parent === window) localStorage.setItem('cockpit-theme', theme);
  }, options.theme ?? 'workspace');
  const controls = await transport(context, fixture, options, state);
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  page.on('pageerror', error => state.errors.push(error.message));
  const embedded = options.embedded !== false;
  await page.goto(`${fixture.origin}/${embedded ? 'fixture' : 'api/create'}/${screen}${options.query ?? ''}`);
  const surface = embedded ? page.frameLocator('iframe') : page;
  if (options.holdAccess) await controls.accessSeen;
  else if (screen === 'home') {
    await surface.locator('#studioGrid .studio').first().waitFor();
    await surface.locator('#weekNote').filter({ hasText: /Counts come|Can't check/ }).waitFor();
  } else await surface.locator('#sections .card').first().waitFor();
  return { page, surface, fixture, state, ...controls };
}

/** Launches may read the summary or open the exact app URL; every other brand-graphics request is a regression. */
function clean(value) {
  assert.deepEqual(value.state.external, []); assert.deepEqual(value.state.errors, []);
  assert.deepEqual(value.fixture.requests.filter(row => !['GET', 'HEAD'].includes(row.method)), []);
  assert.deepEqual(value.fixture.requests.filter(row => row.path.startsWith('/api/brand-graphics/')
    && ![SUMMARY, URL].includes(row.path)), []);
}

function studio(surface) { return surface.locator('#studioGrid .studio').filter({ hasText: 'Brand Graphics' }); }
function starter(surface) { return surface.locator(`#starterTiles [data-tool="${TOOL}"]`); }
function newCard(surface) { return surface.locator('#sections .card').filter({ hasText: 'Brand intro clip' }); }

async function expectLaunch(value, action) {
  await action(); await value.page.waitForFunction(() => window.navigationMessages.length === 1);
  assert.deepEqual(await value.page.evaluate(() => window.navigationMessages), [navigation]); clean(value);
}

test('Home exposes one Brand Graphics studio and its owner summary through the existing access gate', async t => {
  const value = await open(t), { surface, fixture } = value;
  assert.equal(await studio(surface).count(), 1);
  assert.equal(await surface.locator('#recentGrid .title').innerText(), 'Synthetic brand intro');
  assert.match(await surface.locator('#metrics').innerText(), /3\s+Brand clips/);
  const access = fixture.requests.findIndex(row => row.path === '/api/authorization/me' && row.query.app === APP);
  assert.ok(access >= 0 && fixture.requests.findIndex(row => row.path === SUMMARY) > access);
  await expectLaunch(value, () => studio(surface).click());
});

test('Home Quick start has one Brand intro clip entry in Video that opens Brand Graphics', async t => {
  const value = await open(t), { surface } = value;
  assert.equal(await starter(surface).count(), 1);
  assert.equal(await starter(surface).getAttribute('data-cat'), 'video');
  assert.match(await starter(surface).innerText(), /Brand intro clip/);
  await surface.locator('#chips [data-cat="video"]').click();
  assert.equal(await surface.locator(`#starterTiles .tile:not(.hidden)[data-tool="${TOOL}"]`).count(), 1);
  await expectLaunch(value, () => starter(surface).click());
});

test('New Video category contains one Brand intro clip card with the exact embedded handoff', async t => {
  const value = await open(t, 'new'), { surface } = value;
  const category = surface.locator('#cats .cat').filter({ hasText: 'Video' });
  assert.equal(await category.count(), 1); await category.click();
  assert.equal(await category.getAttribute('aria-pressed'), 'true');
  assert.equal(await newCard(surface).count(), 1);
  await expectLaunch(value, () => newCard(surface).click());
});

test('New keyboard search finds the single Brand intro clip card', async t => {
  const value = await open(t, 'new'), { surface } = value;
  await surface.locator('#q').fill('Brand intro clip');
  assert.equal(await surface.locator('#sections .card').count(), 1);
  await expectLaunch(value, () => surface.locator('#q').press('Enter'));
});

test('denied Home Brand Graphics studio and Quick start never navigate or request the owner summary', async t => {
  const value = await open(t, 'home', { denied: true }), { page, surface, fixture } = value;
  assert.equal(await studio(surface).getAttribute('aria-disabled'), 'true');
  assert.equal(await starter(surface).getAttribute('aria-disabled'), 'true');
  await studio(surface).evaluate(node => node.click()); await starter(surface).evaluate(node => node.click());
  assert.deepEqual(await page.evaluate(() => window.navigationMessages), []);
  assert.equal(fixture.requests.some(row => row.path === SUMMARY || row.path === URL), false);
  assert.equal(await studio(surface).locator('a').getAttribute('href'), '/access?app=brand-graphics'); clean(value);
});

test('denied New Brand intro clip card stays visibly locked and sends no navigation or summary', async t => {
  const value = await open(t, 'new', { denied: true }), { page, surface, fixture } = value;
  await newCard(surface).locator('.lock').waitFor();
  assert.equal(await newCard(surface).getAttribute('aria-disabled'), 'true');
  await newCard(surface).evaluate(node => node.click());
  assert.deepEqual(await page.evaluate(() => window.navigationMessages), []);
  assert.equal(fixture.requests.some(row => row.path === SUMMARY || row.path === URL), false); clean(value);
});

test('Home waits for the Brand Graphics access response before reading its summary', async t => {
  const value = await open(t, 'home', { holdAccess: true });
  assert.equal(value.fixture.requests.some(row => row.path === SUMMARY), false);
  value.releaseAccess();
  await value.surface.locator('#recentGrid .title').filter({ hasText: 'Synthetic brand intro' }).waitFor();
  assert.equal(value.fixture.requests.filter(row => row.path === SUMMARY).length, 1); clean(value);
});

test('an unavailable Brand Graphics summary stays visibly unknown while its studio can still open', async t => {
  const value = await open(t, 'home', { summaryFailure: true }), { surface } = value;
  assert.match(await surface.locator('#weekNote').innerText(), /Can't check:.*Brand Graphics/);
  assert.equal(await surface.locator('#metrics .metric').count(), 0);
  assert.equal(await surface.locator('#recentGrid .card').count(), 0);
  await expectLaunch(value, () => studio(surface).click());
});

test('a valid empty Brand Graphics summary keeps an empty state without an unavailable claim', async t => {
  const value = await open(t, 'home', { empty: true }), { surface, fixture } = value;
  assert.equal(fixture.requests.filter(row => row.path === SUMMARY).length, 1);
  assert.match(await surface.locator('#recentGrid .empty').innerText(), /No saved work/);
  assert.doesNotMatch(await surface.locator('#weekNote').innerText(), /Can't check/); clean(value);
});

for (const screen of ['home', 'new']) test(`standalone ${screen} opens only the fixed Brand Graphics URL without inherited query context`, async t => {
  const value = await open(t, screen, { embedded: false, profileFailure: true, query: '?cat=video&artifact=fixture-only&job=unrelated' });
  const target = screen === 'home' ? studio(value.surface) : newCard(value.surface);
  await target.click(); await value.page.waitForURL(`${value.fixture.origin}${URL}`);
  assert.equal(value.page.url(), `${value.fixture.origin}${URL}`); clean(value);
});

for (const theme of ['workspace', 'midnight']) test(`Brand Graphics entries remain reachable on narrow ${theme} Home and New surfaces`, async t => {
  for (const screen of ['home', 'new']) {
    const value = await open(t, screen, { width: 390, theme }), { surface } = value;
    assert.equal(await surface.locator('html').getAttribute('data-theme'), theme);
    const target = screen === 'home' ? starter(surface) : newCard(surface);
    assert.equal(await target.count(), 1);
    const box = await target.evaluate(node => ({ left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right,
      width: innerWidth, pageWidth: document.documentElement.scrollWidth }));
    assert.ok(box.left >= -1 && box.right <= box.width + 1 && box.pageWidth <= box.width + 1);
    await expectLaunch(value, () => target.click());
  }
});
