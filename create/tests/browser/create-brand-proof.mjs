/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the Brand Kit in real Chromium: edit, preview, logo, suggested colors, save and reload; branded templates, swatches, fonts and logo in the editor; the Home band; and read/change refusals.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, syntheticImage, startBrandFixture, seedLogo } from './create-brand-fixture.mjs';
import { defaultBrandKit } from '../../tools/editor/brand-kit.mjs';

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const KIT = { ...defaultBrandKit(), name: 'Northwind', colors: { primary: '#123abc', secondary: '#2a9d8f', accent: '#e76f51', dark: '#111827', light: '#fafaf7' },
  fonts: { heading: 'Georgia', body: 'Garamond' }, extras: [{ name: 'Sand', hex: '#e9d8a6' }] };

async function open(t, path, options = {}) {
  const fixture = await startBrandFixture(options);
  if (options.logo) fixture.brand.kit = { ...fixture.brand.kit, logo: seedLogo(fixture, await syntheticImage(), 40, 20) };
  const context = await browser.newContext({ viewport: { width: options.width ?? 1440, height: options.height ?? 1000 } });
  t.after(async () => { await context.close(); await fixture.close(); });
  const errors = [], external = [];
  await context.addInitScript(() => { localStorage.setItem('cockpit-theme', 'workspace'); localStorage.setItem('cockpit-application-colors', 'false'); });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== fixture.origin) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(fixture.origin + path, { waitUntil: 'domcontentloaded', timeout: 15000 });
  return { page, fixture, errors, external };
}

/** One painted pixel as a hex color, read from a canvas in the given frame or page. */
function pixel(scope, selector, x, y) {
  return scope.locator(selector).evaluate((canvas, [px, py]) => {
    const data = canvas.getContext('2d').getImageData(px, py, 1, 1).data;
    return '#' + [data[0], data[1], data[2]].map(v => v.toString(16).padStart(2, '0')).join('');
  }, [x, y]);
}
function near(actual, expected, tolerance = 6) {
  const parse = hex => [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16));
  return parse(actual).every((value, i) => Math.abs(value - parse(expected)[i]) <= tolerance);
}
async function eventually(read, expected, label) {
  const deadline = Date.now() + 5000; let last;
  while (Date.now() < deadline) { last = await read(); if (near(last, expected)) return; await new Promise(done => setTimeout(done, 100)); }
  assert.fail(`${label}: expected ${expected}, painted ${last}`);
}
async function editorState(surface) {
  return surface.locator('html').evaluate(async () => {
    const { state } = await import('/api/create/editor/editor-state.mjs');
    return { project: structuredClone(state.project), selected: state.selected };
  });
}
// The square announcement's large circle, clear of its nested circles, in 1080-unit coordinates.
const CIRCLE = [620, 800];

test('a first brand kit: edit, live preview, logo, suggested colors, save and reload', async t => {
  const { page, fixture, errors, external } = await open(t, '/api/create/brand');
  await page.locator('#workspace').waitFor();
  await page.locator('#saveStatus').filter({ hasText: 'Not saved yet' }).waitFor();
  const square = () => pixel(page, '#previewSquare', Math.round(CIRCLE[0] * 640 / 1080), Math.round(CIRCLE[1] * 640 / 1080));
  await eventually(square, '#7d2ae8', 'default primary paints the preview');
  await page.locator('#brandName').fill('Acme Studio');
  await page.locator('#hex-primary').fill('#123abc'); await page.locator('#hex-primary').press('Tab');
  await page.locator('[data-pairing="classic"]').click();
  await eventually(square, '#123abc', 'a new primary repaints the real template');
  assert.match(await page.locator('.specimen-heading').evaluate(node => node.style.fontFamily), /Georgia/);
  await page.locator('#logoFile').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: await syntheticImage() });
  await page.locator('#logoLight').waitFor(); assert.equal(fixture.brand.logos, 1);
  await page.locator('#suggestColors').click();
  await page.locator('#suggestColors', { hasText: 'Undo suggested colors' }).waitFor();
  assert.equal(await page.locator('#hex-primary').inputValue(), '#ff0000'); assert.equal(await page.locator('#hex-secondary').inputValue(), '#0000ff');
  await page.locator('#suggestColors', { hasText: 'Undo suggested colors' }).click();
  await page.locator('#suggestColors', { hasText: 'Suggest colors from logo' }).waitFor();
  assert.equal(await page.locator('#hex-primary').inputValue(), '#123abc');
  await page.locator('#saveKit').click();
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 1' }).waitFor();
  const [write] = fixture.brand.writes;
  assert.equal(write.baseRevision, 0); assert.equal(write.kit.name, 'Acme Studio'); assert.deepEqual(write.kit.fonts, { heading: 'Georgia', body: 'Garamond' });
  assert.match(write.kit.logo.src, /^\/api\/create\/project-assets\/[0-9a-f-]{36}$/); assert.equal(write.kit.colors.primary, '#123abc');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 1' }).waitFor();
  assert.equal(await page.locator('#brandName').inputValue(), 'Acme Studio'); assert.equal(await page.locator('#hex-primary').inputValue(), '#123abc');
  assert.equal(await page.locator('#saveKit').isDisabled(), true);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
});

test('the editor opens templates in the brand and applies its swatches, fonts and logo', async t => {
  const { page, fixture, errors } = await open(t, '/fixture?templates=1', { kit: KIT, logo: true });
  const surface = page.frameLocator('#editorFrame');
  await surface.locator('#templateDialog[open]').waitFor();
  assert.equal(await surface.locator('#brandTemplates').isChecked(), true);
  const thumb = () => pixel(surface, '[data-template-id="square-announcement"] canvas', Math.round(CIRCLE[0] * 320 / 1080), Math.round(CIRCLE[1] * 320 / 1080));
  await eventually(thumb, KIT.colors.primary, 'branded thumbnail');
  await surface.locator('#brandTemplates').uncheck(); await eventually(thumb, '#153d35', 'the plain design returns');
  await surface.locator('#brandTemplates').check();
  await surface.locator('[data-template-id="square-announcement"]').click();
  const { project } = await editorState(surface), allowed = new Set([...Object.values(KIT.colors), '#000000', '#ffffff', 'transparent']);
  assert.deepEqual([project.background, ...project.layers.flatMap(l => [l.fill, l.stroke].filter(Boolean))].filter(c => !allowed.has(c)), []);
  assert.equal(project.layers.find(l => l.name === 'Brand signature').text, 'NORTHWIND');
  assert.ok(project.layers.some(l => l.name === 'Brand logo')); assert.equal(Object.keys(project.images).length, 1);
  assert.equal(await surface.locator('#brandSwatches button').count(), 6);
  assert.ok((await surface.locator('#fontFamily optgroup[label="Your brand"] option').allTextContents()).includes('Georgia · brand heading'));
  await surface.locator('#layers button[aria-label="Select Announcement headline"]').click();
  await surface.locator(`#brandSwatches [data-brand-color="${KIT.colors.accent}"]`).click();
  const recolored = (await editorState(surface)).project.layers.find(l => l.name === 'Announcement headline');
  assert.equal(recolored.fill, KIT.colors.accent);
  await surface.locator('#addLogo').click();
  const withTwo = (await editorState(surface)).project;
  assert.equal(withTwo.layers.filter(l => l.name === 'Brand logo').length, 2); assert.equal(Object.keys(withTwo.images).length, 1);
  await surface.locator('#saveProject').click();
  await surface.locator('#saveStatus').filter({ hasText: /Saved/ }).waitFor();
  assert.equal(fixture.state.successfulWrites, 1); assert.deepEqual(errors, []);
});

test('Home shows the saved brand, a setup prompt without one, and nothing without brand access', async t => {
  const saved = await open(t, '/api/create/home', { kit: KIT, logo: true });
  await saved.page.locator('#brandBand:not([hidden])').waitFor();
  assert.equal(await saved.page.locator('#brandTitle').textContent(), 'Northwind');
  assert.equal(await saved.page.locator('#brandSws span').count(), 5);
  assert.equal(await saved.page.locator('#brandOpen').textContent(), 'Edit brand kit');
  assert.equal(await saved.page.locator('#brandLogo img').count(), 1);
  await saved.page.locator('#brandOpen').click(); await saved.page.waitForURL('**/api/create/brand');
  const empty = await open(t, '/api/create/home');
  await empty.page.locator('#brandBand:not([hidden])').waitFor();
  assert.equal(await empty.page.locator('#brandOpen').textContent(), 'Set up brand kit');
  const refused = await open(t, '/api/create/home', { brand: { read: false } });
  await refused.page.locator('#studioGrid .card').first().waitFor();
  await refused.page.waitForTimeout(300); assert.equal(await refused.page.locator('#brandBand').isHidden(), true);
  assert.deepEqual([...saved.errors, ...empty.errors, ...refused.errors], []);
});

test('without brand read the page is locked and the editor is unchanged; without change the kit is view-only', async t => {
  const locked = await open(t, '/api/create/brand', { brand: { read: false } });
  await locked.page.locator('#locked:not([hidden])').waitFor();
  assert.equal(await locked.page.locator('#workspace').isHidden(), true);
  const editor = await open(t, '/fixture?templates=1', { brand: { read: false } }), surface = editor.page.frameLocator('#editorFrame');
  await surface.locator('#templateDialog[open]').waitFor();
  assert.equal(await surface.locator('#brandTemplateToggle').isHidden(), true); assert.equal(await surface.locator('#brandPanel').isHidden(), true);
  const viewOnly = await open(t, '/api/create/brand', { kit: KIT, brand: { change: false } });
  await viewOnly.page.locator('#saveStatus').filter({ hasText: 'View only' }).waitFor();
  for (const selector of ['#brandName', '#hex-primary', '#uploadLogo', '#saveKit', '#headingFont']) assert.equal(await viewOnly.page.locator(selector).isDisabled(), true, selector);
  assert.equal(await viewOnly.page.locator('#removeKit').isHidden(), true);
  assert.equal(viewOnly.fixture.brand.writes.length, 0);
});

test('a narrow screen keeps the Brand Kit page inside the viewport', async t => {
  const { page } = await open(t, '/api/create/brand', { kit: KIT, width: 390, height: 844 });
  await page.locator('#workspace').waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  const preview = await page.locator('.brand-preview').boundingBox(), editor = await page.locator('.brand-editor').boundingBox();
  assert.ok(preview.y < editor.y, 'the preview leads on a phone');
});
