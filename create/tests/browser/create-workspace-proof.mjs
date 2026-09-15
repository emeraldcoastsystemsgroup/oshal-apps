/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise actual Home/New layout, keyboard navigation, owning-catalog handoffs and narrow viewports using only synthetic read-only HTTP.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Include the single added 3D scan starter in the existing clear-filter and catalog totals.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Include the distinct layered-image starter while retaining exact filter/navigation behavior.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Verify the complete restored catalog with distinct editable templates and blank image design entries.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, startFixture } from './create-theme-fixture.mjs';

const members = [
  ['office', 'presentations', 'AI Office', '/api/presentations/sections/ui'],
  ['portrait', 'portrait-studio', 'Portrait Studio', '/api/portrait-studio/app'],
  ['video', 'video', 'Video Studio', '/api/video/ui'],
  ['lora', 'lora', 'LoRA Studio', '/api/lora/ui'],
  ['vids', 'vids', 'Vids Studio', '/api/vids/app'],
  ['story', 'creative-studio', 'Stories', '/api/creative-studio/review']
];
const kinds = [['pptx', 'Presentation'], ['docx', 'Document'], ['xlsx', 'Spreadsheet']].map(([id, name]) =>
  ({ id, name, noun: name.toLowerCase(), opens: 'AI Office', groups: [{ id: 'work', label: 'Work' }] }));
const starters = [['pitch', 'pptx', 'Launch presentation'], ['resume', 'docx', 'Resume'], ['budget', 'xlsx', 'Budget']].map(([id, kind, name]) =>
  ({ id, kind, name, group: 'work', desc: `A synthetic ${name.toLowerCase()} for local layout checks.`, theme: 'clean', outline: 'Overview\nA local fixture\n\nNext steps\nNo provider calls' }));
let fixture, browser;

/** Every response is local fixture data; policy refusal and provider unavailability remain visible. */
function respond(path, query) {
  if (path === '/api/ui/profile') return { profile: { ribbon: { items: members.map(([key, , label, iframeUrl]) =>
    ({ id: `tool-create-${key}`, label, toolUi: { iframeUrl } })) } } };
  if (path === '/api/presentations/sections/starters') return { kinds, starters };
  if (path === '/api/authorization/me' && query.app === 'lora') return { status: 'catalog', tier: 'deny', denied: true };
  if (path.endsWith('/home-summary')) {
    if (path === '/api/video/home-summary') return { status: 503, body: { error: 'fixture_unavailable' } };
    if (path !== '/api/presentations/home-summary') return { items: [], metrics: [] };
    return { items: [{ text: 'Autumn campaign', detail: 'Synthetic saved outline', actions: [{ tool: 'create-office' }] }], metrics: [{ label: 'Saved projects', value: '1' }] };
  }
}

before(async () => { fixture = await startFixture({ respond }); browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); await fixture?.close(); });

/** Use actual page scripts and parent theme code, with no external requests or desktop browser. */
async function open(t, screen, width = 1280, embedded = true) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  t.after(() => context.close());
  await context.addInitScript(() => localStorage.setItem('cockpit-theme', 'workspace'));
  await context.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  await page.goto(`${fixture.origin}/${embedded ? 'fixture' : 'api/create'}/${screen}`);
  const surface = embedded ? page.frameLocator('iframe') : page;
  await surface.locator(screen === 'home' ? '#recentGrid .btn' : '.card').first().waitFor();
  if (screen === 'new') await surface.locator('.card .name').filter({ hasText: 'Budget' }).first().waitFor();
  return { page, surface };
}

/** Compare scroll geometry without hiding overflow or scrolling controls into view first. */
async function bounds(surface, selector) {
  return surface.locator(selector).evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { label: element.textContent.trim().slice(0, 60), left: rect.left, right: rect.right, width: innerWidth,
      pageWidth: document.documentElement.scrollWidth, height: rect.height };
  }));
}

/** Screenshots are opt-in artifacts containing only the synthetic fixture records. */
async function capture(page, name) {
  if (!process.env.CREATE_WORKSPACE_SCREENSHOT_DIR) return;
  await mkdir(process.env.CREATE_WORKSPACE_SCREENSHOT_DIR, { recursive: true });
  const target = await page.locator('iframe').count() ? page.locator('iframe') : page;
  await target.screenshot({ path: resolve(process.env.CREATE_WORKSPACE_SCREENSHOT_DIR, `${name}.png`) });
}

test('Home prioritizes existing work below a compact intro and has one template entry action', async t => {
  const { page, surface } = await open(t, 'home');
  const sections = await surface.locator('main > section[id]').evaluateAll(nodes => nodes.map(node => node.id));
  assert.ok(sections.indexOf('recent') < sections.indexOf('starters'), 'recent work precedes starting another project');
  assert.ok((await bounds(surface, '.hero'))[0].height <= 275, 'intro leaves room for existing work');
  assert.equal(await surface.locator('#seeAll').count(), 1);
  await capture(page, 'create-home-workspace');
  await surface.locator('#seeAll').click();
  await page.waitForFunction(() => window.navigationMessages.length === 1);
  assert.deepEqual(await page.evaluate(() => window.navigationMessages), [{ type: 'app-navigate', tool: 'create-new' }]);
});

test('New lists each owning-catalog template once and retains exact Office handoff context', async t => {
  const { page, surface } = await open(t, 'new');
  const names = await surface.locator('.card .name').allTextContents();
  assert.equal(new Set(names).size, names.length, 'the default catalog does not repeat suggested cards');
  await surface.locator('#q').fill('Budget');
  assert.equal(await surface.locator('.card').count(), 1);
  await surface.locator('#q').press('Enter');
  await page.waitForFunction(() => window.navigationMessages.length === 1);
  assert.deepEqual(await page.evaluate(() => window.navigationMessages),
    [{ type: 'app-navigate', tool: 'create-office', query: 'kind=xlsx&starter=budget&theme=clean' }]);
  await capture(page, 'create-new-search-workspace');
});

for (const width of [320, 768, 1280]) test(`Home and New keep cards and controls within a ${width}px viewport`, async t => {
  for (const screen of ['home', 'new']) {
    const { page, surface } = await open(t, screen, width);
    const boxes = await bounds(surface, screen === 'home' ? '#q, #seeAll, .tile, .card, .metric' : '#q, .cat, .card');
    for (const box of boxes) {
      assert.ok(box.pageWidth <= box.width + 1, `${screen}: document overflow ${box.pageWidth}/${box.width}`);
      assert.ok(box.left >= -1 && box.right <= box.width + 1, `${screen}: ${box.label} lies outside the viewport`);
    }
    if (width === 320 || width === 1280) await capture(page, `create-${screen}-${width}`);
  }
});

test('keyboard Home search preserves the chosen starter kind and empty search stays recoverable', async t => {
  const { page, surface } = await open(t, 'home');
  await surface.locator('#q').fill('Spreadsheet'); await surface.locator('#q').press('Enter');
  await page.waitForFunction(() => window.navigationMessages.length === 1);
  assert.deepEqual(await page.evaluate(() => window.navigationMessages), [{ type: 'app-navigate', tool: 'create-office', query: 'kind=xlsx' }]);
  await surface.locator('#q').fill('No such synthetic thing');
  assert.match(await surface.locator('#filterStatus').innerText(), /no matches/i);
  await surface.locator('#clearQ').click();
  assert.equal(await surface.locator('#q').inputValue(), '');
  assert.equal(await surface.locator('.tile:not(.hidden)').count(), 12);
});

test('section controls move keyboard focus and New returns Home through the existing navigation contract', async t => {
  const { page, surface } = await open(t, 'home');
  await surface.locator('[data-jump="studios"]').focus(); await surface.locator('[data-jump="studios"]').press('Enter');
  assert.equal(await surface.locator('html').evaluate(() => document.activeElement.id), 'studios');
  const next = await open(t, 'new');
  await next.surface.locator('#backHome').focus(); await next.surface.locator('#backHome').press('Enter');
  await next.page.waitForFunction(() => window.navigationMessages.length === 1);
  assert.deepEqual(await next.page.evaluate(() => window.navigationMessages), [{ type: 'app-navigate', tool: 'create-home' }]);
  assert.deepEqual(await page.evaluate(() => window.navigationMessages), []);
});

test('New format and purpose filters retain keyboard focus and truthful selection after rendering', async t => {
  const { surface } = await open(t, 'new');
  const format = surface.getByRole('button', { name: /Spreadsheets/ });
  await format.focus(); await format.press('Enter');
  assert.equal(await format.getAttribute('aria-pressed'), 'true');
  assert.equal(await format.evaluate(node => node === document.activeElement), true);
  assert.deepEqual(await surface.locator('.card .name').allTextContents(), ['Budget']);
  const purpose = surface.locator('#chips').getByRole('button', { name: 'Work', exact: true });
  await purpose.focus(); await purpose.press('Enter');
  assert.equal(await purpose.getAttribute('aria-pressed'), 'true');
  assert.equal(await purpose.evaluate(node => node === document.activeElement), true);
  await surface.getByRole('button', { name: /All templates/ }).click();
  assert.deepEqual(await surface.locator('.card .name').allTextContents(), ['Launch presentation', 'Resume', 'Budget',
    'Image templates', 'Image design', 'Headshot', 'Character portrait', 'Group portrait', 'Short video', 'Video clip', 'Story episode', '3D scan to print']);
});

test('locked studios do not navigate or probe and unavailable summaries never masquerade as zero work', async t => {
  const { page, surface } = await open(t, 'home');
  const locked = surface.locator('#studioGrid .studio').filter({ hasText: 'LoRA Studio' });
  await locked.waitFor(); assert.equal(await locked.getAttribute('aria-disabled'), 'true');
  await locked.evaluate(node => node.click());
  assert.deepEqual(await page.evaluate(() => window.navigationMessages), []);
  assert.equal(fixture.requests.some(request => request.path === '/api/lora/home-summary'), false);
  assert.match(await surface.locator('#weekNote').innerText(), /Can't check: Video Studio/);
  assert.equal(await surface.locator('#recentGrid .title').innerText(), 'Autumn campaign');
  assert.deepEqual(fixture.requests.filter(request => !['GET', 'HEAD'].includes(request.method)), []);
});

test('standalone New preserves its category link and returns to the real Home URL', async t => {
  const { page } = await open(t, 'new', 768, false);
  await page.goto(`${fixture.origin}/api/create/new?cat=xlsx`);
  await page.getByRole('button', { name: /Spreadsheets/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Spreadsheets/ }).getAttribute('aria-pressed'), 'true');
  await page.locator('#backHome').click();
  await page.waitForURL(`${fixture.origin}/api/create/home`);
  assert.equal(await page.locator('h1').count(), 1);
});
