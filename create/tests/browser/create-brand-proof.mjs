/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the Brand Kit in real Chromium: edit, preview, logo, suggested colors, save and reload; branded templates, swatches, fonts and logo in the editor; the Home band; and read/change refusals.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: the brand faces are offered by the one Format inspector's Font field (the duplicate form and its grouped list are gone), and automatic saving saves the branded design without a Save press.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: Home shows one 44px "Set up your brand" row only while no kit exists, so a saved kit leaves Home's work alone (the Brand Kit rail tile edits it) and the row opens the Brand Kit page.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (create-brand): on a phone the form leads and Preview opens a half sheet from the app row; the dark logo tile maintains >=4.5:1 ink in light-blue; extra-color controls are >=44px tall; edits autosave with a sticky phone Save bar; Remove brand kit confirms in-page without window.confirm.
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
  await surface.locator('#layers button[aria-label="Select Announcement headline"]').click();
  assert.ok((await surface.locator('[data-editor-property="fontFamily"] option').allTextContents()).includes('Georgia · brand heading'));
  await surface.locator(`#brandSwatches [data-brand-color="${KIT.colors.accent}"]`).click();
  const recolored = (await editorState(surface)).project.layers.find(l => l.name === 'Announcement headline');
  assert.equal(recolored.fill, KIT.colors.accent);
  await surface.locator('#addLogo').click();
  const withTwo = (await editorState(surface)).project;
  assert.equal(withTwo.layers.filter(l => l.name === 'Brand logo').length, 2); assert.equal(Object.keys(withTwo.images).length, 1);
  await surface.locator('#saveStatus').filter({ hasText: /Saved/ }).waitFor();
  assert.equal(fixture.state.successfulWrites, 1); assert.deepEqual(errors, []);
});

test('Home shows one Set up your brand row only without a kit, and nothing with a kit or without brand access', async t => {
  const empty = await open(t, '/api/create/home');
  await empty.page.locator('#brandBand:not([hidden])').waitFor();
  assert.equal(await empty.page.locator('#brandTitle').textContent(), 'Set up your brand');
  const row = await empty.page.locator('#brandBand').boundingBox(); assert.ok(row.height >= 44 && row.height <= 52, 'one 44px row');
  await empty.page.locator('#brandBand').click(); await empty.page.waitForURL('**/api/create/brand');
  const saved = await open(t, '/api/create/home', { kit: KIT, logo: true });
  await saved.page.locator('#recentGrid[aria-busy="false"]').waitFor();
  await saved.page.waitForTimeout(300); assert.equal(await saved.page.locator('#brandBand').isHidden(), true, 'a saved kit needs no prompt');
  const refused = await open(t, '/api/create/home', { brand: { read: false } });
  await refused.page.locator('#recentGrid[aria-busy="false"]').waitFor();
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

test('a narrow screen leads with the form, opens Preview in a half sheet, keeps >=4.5:1 dark-tile ink, autosaves, and confirms removal in-page', async t => {
  const { page, fixture } = await open(t, '/api/create/brand', { kit: KIT, width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light-blue'); });
  await page.locator('#workspace').waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  assert.equal(await page.locator('.brand-preview').isVisible(), false, 'inline preview hides on phone so the form leads');
  const editor = await page.locator('.brand-editor').boundingBox();
  assert.ok(editor.y < 140, 'the form leads on a phone');
  const darkTile = await page.locator('.logo-tile.on-dark').evaluate(node => {
    const cs = getComputedStyle(node);
    const emptyCs = getComputedStyle(node.querySelector('.logo-empty'));
    return { bg: cs.backgroundColor, fg: emptyCs.color, opacity: Number(emptyCs.opacity) };
  });
  assert.equal(darkTile.bg, 'rgb(17, 24, 39)', 'dark tile fills with the kit text color even in light-blue');
  assert.equal(darkTile.fg, 'rgb(255, 255, 255)', 'No logo yet ink stays readable >=4.5:1');
  assert.equal(darkTile.opacity, 1);
  const addBox = await page.locator('#addExtra').boundingBox();
  const removeExtraBox = await page.locator('.extra button').first().boundingBox();
  assert.ok(addBox.height >= 44 && removeExtraBox.height >= 44, 'extra color controls are >=44px tall');
  await page.locator('#previewBtn').click();
  await page.locator('#previewSheet[open]').waitFor();
  await page.locator('#closePreviewSheet').click();
  assert.equal(await page.locator('#previewSheet').evaluate(d => d.open), false);
  await page.locator('#brandName').fill('Northwind Labs');
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 2' }).waitFor({ timeout: 5000 });
  assert.equal(fixture.brand.writes.at(-1).kit.name, 'Northwind Labs');
  let nativeDialogFired = false;
  page.on('dialog', d => { nativeDialogFired = true; d.dismiss(); });
  await page.locator('#removeKit').click();
  await page.locator('#removeKitDialog[open]').waitFor();
  await page.locator('#confirmRemoveKit').click();
  await page.locator('#saveStatus').filter({ hasText: 'Not saved yet' }).waitFor();
  assert.equal(nativeDialogFired, false, 'in-page confirm replaces window.confirm');
});
