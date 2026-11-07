/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise actual Image editor launchers, admitted owner-project links and narrow layouts with the existing read-only fixture.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Distinguish blank-image and template-gallery keyboard launches while preserving the exact query-free blank handoff.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: New is Home's sheet (the old /api/create/new forwards to it) and Home has no studio grid or quick starts, so the launchers are the sheet's Blank Image start and Image templates card and the saved-project card itself; an open saved image may read exactly its own project for its picture, and nothing else under /api/create/project* is ever asked.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | The blank Image start is now Image 1080 × 1080 (the editor's ?size=1080x1080), so its exact handoff carries that size and nothing else.
 */
import { test as nodeTest, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, startFixture } from './create-theme-fixture.mjs';

const TOOL = 'create-editor', EDITOR = '/api/create/editor', SUMMARY = '/api/create/home-summary';
const PROJECT = '11111111-2222-4333-8444-555555555555';
const navigation = { type: 'app-navigate', tool: TOOL };
let browser;
const test = (name, run) => nodeTest(name, { timeout: 20000 }, run);
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

function respond(options, path, query) {
  if (path === '/api/ui/profile') return { profile: { ribbon: { items: [
    { id: 'tool-create-home', label: 'Create Home', toolUi: { iframeUrl: '/api/create/home' } },
    { id: 'tool-create-new', label: 'Create', toolUi: { iframeUrl: '/api/create/new' } },
    { id: `tool-${TOOL}`, label: 'Image editor', toolUi: { iframeUrl: EDITOR } },
    { id: 'tool-create-office', label: 'AI Office', toolUi: { iframeUrl: '/api/presentations/sections/ui' } }
  ] } } };
  if (path === '/api/authorization/me' && query.app === 'create') {
    if (options.unknown) return { status: 503, body: { error: 'synthetic_access_unavailable' } };
    return { status: 'enforced', tier: options.denied ? 'deny' : 'manager', denied: Boolean(options.denied) };
  }
  if (path === SUMMARY) return { items: [{ text: 'Synthetic saved design', detail: 'Revision 2 · 2026-09-12T12:00:00Z',
    actions: options.actions ?? [{ tool: TOOL, query: `project=${PROJECT}` }] }], metrics: [{ label: 'Image projects', value: '1' }] };
  if (path.endsWith('/home-summary')) return { items: [], metrics: [] };
}

async function transport(context, fixture, options, state) {
  let releaseAccess, signalAccess;
  const gate = new Promise(resolve => { releaseAccess = resolve; }), accessSeen = new Promise(resolve => { signalAccess = resolve; });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== fixture.origin) { state.external.push(url.href); return route.abort(); }
    if (options.holdAccess && url.pathname === '/api/authorization/me' && url.searchParams.get('app') === 'create') {
      signalAccess(); return gate.then(() => route.continue());
    }
    return route.continue();
  });
  return { releaseAccess, accessSeen };
}

async function open(t, screen = 'home', options = {}) {
  const fixture = await startFixture({ respond: (path, query) => respond(options, path, query) });
  const context = await browser.newContext({ viewport: { width: options.width ?? 1280, height: 900 }, reducedMotion: 'reduce' });
  t.after(async () => { try { await context.close(); } finally { await fixture.close(); } });
  await context.addInitScript(() => { localStorage.setItem('cockpit-theme', 'workspace'); localStorage.setItem('cockpit-application-colors', 'false'); });
  const state = { errors: [], external: [] }, controls = await transport(context, fixture, options, state);
  const page = await context.newPage(); page.setDefaultTimeout(5000); page.on('pageerror', error => state.errors.push(error.message));
  const embedded = options.embedded !== false;
  await page.goto(`${fixture.origin}/${embedded ? 'fixture' : 'api/create'}/${screen}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  const surface = embedded ? page.frameLocator('iframe') : page;
  if (options.holdAccess) await controls.accessSeen;
  else if (screen === 'home') await surface.locator('#weekNote').filter({ hasText: /Counts come|Can't check/ }).waitFor();
  else {
    await templates(surface).waitFor();
    if (options.denied) await templates(surface).locator('.lock').waitFor();
    if (options.unknown) await templates(surface).locator('.lock.unknown').waitFor();
  }
  return { page, surface, fixture, state, ...controls };
}

async function sheet(surface) {
  if (!await surface.locator('#newSheet[open]').count()) await surface.locator('#newBtn').click();
  await surface.locator('#newSheet[open]').waitFor();
}
function blank(surface) { return surface.locator('#blankRow .blank[data-blank="image-square"]'); }
const SIZE = 'size=1080x1080';
function templates(surface) { return surface.locator('#newSheet[open] #sections .card').filter({ hasText: 'Image templates' }); }
function saved(surface) { return surface.locator('#recentGrid .wcard .wopen'); }

/** No error, no outside request, no write; the only project read allowed is an admitted card's own picture. */
function clean(value, picture = false) {
  assert.deepEqual(value.state.errors, []); assert.deepEqual(value.state.external, []);
  assert.deepEqual(value.fixture.requests.filter(row => !['GET', 'HEAD'].includes(row.method)), []);
  const reads = value.fixture.requests.filter(row => row.path.startsWith('/api/create/project')).map(row => row.path);
  for (const read of reads) assert.equal(read, `/api/create/projects/${PROJECT}`, 'only the admitted card\'s own picture');
  if (!picture) assert.deepEqual(reads, []);
}

async function expectLaunch(value, locator, query, picture = true) {
  await locator.click(); await value.page.waitForFunction(() => window.navigationMessages.length === 1);
  assert.deepEqual(await value.page.evaluate(() => window.navigationMessages), [{ ...navigation, ...(query ? { query } : {}) }]); clean(value, picture);
}

test('Home offers one blank Image start and one Image templates card in New, and no bare Create studio', async t => {
  const value = await open(t); await sheet(value.surface);
  assert.equal(await value.surface.locator('#studioGrid, #starterTiles').count(), 0, 'no studio grid or quick-start list');
  assert.equal(await blank(value.surface).count(), 1); assert.match(await blank(value.surface).innerText(), /Image\s+1080 × 1080/);
  assert.equal(await templates(value.surface).count(), 1);
  await expectLaunch(value, blank(value.surface), SIZE);
});

test('New Image designs distinguish blank and template entries with exact keyboard handoffs', async t => {
  const value = await open(t, 'new'); await value.surface.locator('#cats').getByRole('button', { name: /Image designs/ }).click();
  assert.deepEqual(await value.surface.locator('#sections .card .name').allTextContents(), ['Image templates']);
  await blank(value.surface).focus(); await blank(value.surface).press('Enter');
  await value.page.waitForFunction(() => window.navigationMessages.length === 1);
  assert.deepEqual(await value.page.evaluate(() => window.navigationMessages), [{ ...navigation, query: SIZE }]);
  await sheet(value.surface);
  await templates(value.surface).focus(); await templates(value.surface).press('Enter');
  await value.page.waitForFunction(() => window.navigationMessages.length === 2);
  assert.deepEqual(await value.page.evaluate(() => window.navigationMessages), [{ ...navigation, query: SIZE }, { ...navigation, query: 'templates=1' }]); clean(value, true);
});

test('own project summaries wait for confirmed access then preserve the exact canonical project query', async t => {
  const value = await open(t, 'home', { holdAccess: true });
  assert.equal(value.fixture.requests.some(row => row.path === SUMMARY), false); assert.equal(await value.surface.locator('#recentGrid .wcard').count(), 0);
  await sheet(value.surface); await blank(value.surface).click(); assert.deepEqual(await value.page.evaluate(() => window.navigationMessages), []);
  await value.surface.locator('#newDone').click();
  value.releaseAccess(); await value.surface.locator('#recentGrid .title').filter({ hasText: 'Synthetic saved design' }).waitFor();
  assert.match(await value.surface.locator('#metrics').innerText(), /1\s+Image projects/);
  const access = value.fixture.requests.findIndex(row => row.path === '/api/authorization/me' && row.query.app === 'create');
  assert.ok(value.fixture.requests.findIndex(row => row.path === SUMMARY) > access);
  await expectLaunch(value, saved(value.surface), `project=${PROJECT}`, true);
});

for (const screen of ['home', 'new']) test(`standalone ${screen} launches the exact editor URL without stale query context`, async t => {
  const value = await open(t, screen, { embedded: false }); await sheet(value.surface);
  await blank(value.surface).click();
  await value.page.waitForURL(value.fixture.origin + EDITOR + '?' + SIZE); assert.equal(new URL(value.page.url()).search, '?' + SIZE); clean(value, true);
});

test('standalone saved-project launch retains its canonical project ID', async t => {
  const value = await open(t, 'home', { embedded: false }); await saved(value.surface).click();
  await value.page.waitForURL(`${value.fixture.origin}${EDITOR}?project=${PROJECT}`); clean(value, true);
});

for (const screen of ['home', 'new']) test(`${screen} explicitly denied editor launchers do not navigate or probe projects`, async t => {
  const value = await open(t, screen, { denied: true }); await sheet(value.surface);
  await templates(value.surface).locator('.lock').waitFor();
  for (const locator of [blank(value.surface), templates(value.surface)]) { await locator.waitFor(); assert.equal(await locator.getAttribute('aria-disabled'), 'true'); await locator.evaluate(node => node.click()); }
  assert.deepEqual(await value.page.evaluate(() => window.navigationMessages), []); assert.equal(value.fixture.requests.some(row => row.path === SUMMARY), false); clean(value);
});

test('unknown Create access does not fetch a private project summary or invent saved-project links', async t => {
  const value = await open(t, 'home', { unknown: true });
  assert.equal(value.fixture.requests.some(row => row.path === SUMMARY), false); assert.equal(await value.surface.locator('#recentGrid .wcard').count(), 0);
  await sheet(value.surface); await templates(value.surface).locator('.lock.unknown').waitFor();
  assert.match(await templates(value.surface).innerText(), /can't check|can’t check/i);
  await blank(value.surface).click(); await value.page.waitForTimeout(100);
  assert.deepEqual(await value.page.evaluate(() => window.navigationMessages), []); clean(value);
});

test('New unknown access is labeled and cannot navigate before access is confirmed', async t => {
  const value = await open(t, 'new', { unknown: true });
  assert.match(await templates(value.surface).innerText(), /can't check|can’t check/i);
  assert.equal(value.fixture.requests.some(row => row.path === SUMMARY), false); await templates(value.surface).click(); await value.page.waitForTimeout(100);
  assert.deepEqual(await value.page.evaluate(() => window.navigationMessages), []); clean(value);
});

for (const query of ['project=' + '-'.repeat(36), `project=${PROJECT}&artifact=unexpected`]) test(`malformed summary query is never forwarded: ${query}`, async t => {
  const value = await open(t, 'home', { actions: [{ tool: TOOL, query }] });
  await expectLaunch(value, saved(value.surface));
});

test('null and unrelated summary actions cannot crash or alter an editor destination', async t => {
  const value = await open(t, 'home', { actions: [null, { tool: 'unrelated-tool', query: `project=${PROJECT}` }] });
  await expectLaunch(value, saved(value.surface));
});

for (const width of [390, 768]) test(`the blank Image start and the New sheet remain usable within ${width}px`, async t => {
  for (const screen of ['home', 'new']) {
    const value = await open(t, screen, { width }); await sheet(value.surface);
    const locator = blank(value.surface); await locator.waitFor();
    const geometry = await locator.evaluate(node => { const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, height: rect.height, width: innerWidth, scroll: document.documentElement.scrollWidth }; });
    assert.ok(geometry.left >= -1 && geometry.right <= geometry.width + 1); assert.ok(geometry.height >= 44); assert.ok(geometry.scroll <= geometry.width + 1);
    await expectLaunch(value, locator, SIZE);
  }
});
