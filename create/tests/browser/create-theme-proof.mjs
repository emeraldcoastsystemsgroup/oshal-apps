/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove actual Create Home and New follow all portal palettes, optional package colors and cross-tab changes without losing input or replacing their documents.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, themes, startFixture } from './create-theme-fixture.mjs';

let fixture, browser;
before(async () => { fixture = await startFixture(); browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); await fixture?.close(); });

/** Seed only synthetic browser preferences and record application writes while refusing external requests. */
async function pageFor(t, saved = 'workspace') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
  t.after(() => context.close());
  await context.addInitScript(value => {
    if (window === window.top && value !== null && localStorage.getItem('cockpit-theme') === null) localStorage.setItem('cockpit-theme', value);
    window.themeWrites = [];
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === 'cockpit-theme') window.themeWrites.push(value); return set.call(this, key, value); };
  }, saved);
  await context.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  return page;
}

/** Read real rendered colors, resolving framework tokens through the browser's CSS engine. */
async function colors(surface) {
  return surface.locator('body').evaluate(body => {
    const probe = document.createElement('span'); body.append(probe);
    probe.style.color = 'var(--bg-primary)'; const background = getComputedStyle(probe).color;
    probe.style.color = 'var(--text-primary)'; const foreground = getComputedStyle(probe).color; probe.remove();
    const actual = getComputedStyle(body);
    return { theme: document.documentElement.dataset.theme, background, foreground, actualBackground: actual.backgroundColor,
      actualForeground: actual.color, saved: localStorage.getItem('cockpit-theme'), writes: window.themeWrites };
  });
}

/** Retain only screenshots of synthetic content when the operator requested review artifacts. */
async function screenshot(page, name) {
  if (!process.env.CREATE_THEME_SCREENSHOT_DIR) return;
  await mkdir(process.env.CREATE_THEME_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: resolve(process.env.CREATE_THEME_SCREENSHOT_DIR, `${name}.png`), fullPage: true });
}

/** Compute real control contrast after compositing translucent backgrounds over their painted ancestors. */
async function controlContrast(frame, selector) {
  return frame.locator(selector).first().evaluate(element => {
    const rgba = color => color.match(/[\d.]+/g).map(Number);
    const background = [0, 0, 0]; let coverage = 0;
    for (let node = element; node && coverage < 1; node = node.parentElement) {
      const color = rgba(getComputedStyle(node).backgroundColor), alpha = color[3] ?? 1;
      for (let index = 0; index < 3; index++) background[index] += color[index] * alpha * (1 - coverage);
      coverage += alpha * (1 - coverage);
    }
    const luminance = rgb => rgb.slice(0, 3).map(value => {
      const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    const foreground = luminance(rgba(getComputedStyle(element).color)), back = luminance(background);
    return (Math.max(foreground, back) + .05) / (Math.min(foreground, back) + .05);
  });
}

for (const screen of ['home', 'new']) test(`${screen} follows all twelve parent palettes and retains its actual search document`, async t => {
  const page = await pageFor(t); await page.goto(`${fixture.origin}/fixture/${screen}`);
  const frame = page.frameLocator('iframe'); await frame.locator('#q').waitFor();
  assert.equal((await colors(frame)).theme, 'workspace');
  await frame.locator('#q').fill('Synthetic');
  await frame.locator('html').evaluate(() => { window.retainedDocument = document; window.retainedSearch = document.getElementById('q'); });
  for (const theme of themes) {
    await page.evaluate(value => window.createTheme.apply(value), theme);
    await frame.locator(`html[data-theme="${theme}"]`).waitFor();
    const actual = await colors(frame);
    assert.equal(actual.actualBackground, actual.background, theme); assert.equal(actual.actualForeground, actual.foreground, theme);
    assert.equal(actual.saved, theme); assert.deepEqual(actual.writes, []);
    assert.equal(await frame.locator('#q').inputValue(), 'Synthetic');
    assert.equal(await frame.locator('html').evaluate(() => window.retainedDocument === document && window.retainedSearch === document.getElementById('q')), true);
    if (['workspace', 'midnight'].includes(theme)) await screenshot(page, `create-${screen}-${theme}`);
  }
  assert.deepEqual(fixture.requests.filter(row => !['GET', 'HEAD'].includes(row.method)), []);
});

for (const screen of ['home', 'new']) test(`${screen} preserves the optional Create skin and returns to the chosen portal palette`, async t => {
  const page = await pageFor(t, 'midnight'); await page.goto(`${fixture.origin}/fixture/${screen}`);
  const frame = page.frameLocator('iframe'); await frame.locator('#q').waitFor();
  await frame.locator('#q').fill('Synthetic');
  await page.evaluate(() => { window.retainedFrame = document.querySelector('iframe'); });
  await page.locator('#settingsApplicationColors').check(); await frame.locator('html[data-theme="create"]').waitFor();
  const app = await colors(frame); assert.equal(app.actualBackground, 'rgb(248, 247, 253)'); assert.equal(app.saved, 'midnight');
  await screenshot(page, `create-${screen}-application-colors`);
  await page.locator('#workspace').click(); await frame.locator('html[data-theme="workspace"]').waitFor();
  const portal = await colors(frame); assert.notEqual(portal.actualBackground, app.actualBackground); assert.equal(portal.saved, 'workspace');
  assert.equal(await page.locator('#settingsApplicationColors').isChecked(), false);
  assert.equal(await frame.locator('#q').inputValue(), 'Synthetic'); assert.deepEqual(portal.writes, []);
  assert.equal(await page.evaluate(() => window.retainedFrame === document.querySelector('iframe')), true);
});

for (const screen of ['home', 'new']) test(`${screen} follows a real cross-tab theme change when opened standalone without writing preferences`, async t => {
  const page = await pageFor(t); await page.goto(`${fixture.origin}/api/create/${screen}`); await page.locator('#q').waitFor();
  assert.equal((await colors(page)).theme, 'workspace'); await page.locator('#q').fill('Synthetic');
  const chooser = await page.context().newPage(); await chooser.goto(`${fixture.origin}/fixture/home`);
  await chooser.locator('html[data-ready="true"]').waitFor(); await chooser.locator('#midnight').click();
  await page.locator('html[data-theme="midnight"]').waitFor();
  const actual = await colors(page); assert.equal(actual.actualBackground, actual.background); assert.equal(actual.saved, 'midnight');
  assert.equal(await page.locator('#q').inputValue(), 'Synthetic'); assert.deepEqual(actual.writes, []);
});

test('fresh standalone Create starts in Workspace and does not manufacture a saved preference', async t => {
  const page = await pageFor(t, null);
  for (const screen of ['home', 'new']) {
    await page.goto(`${fixture.origin}/api/create/${screen}`); await page.locator('#q').waitFor();
    const actual = await colors(page); assert.equal(actual.theme, 'workspace'); assert.equal(actual.saved, null); assert.deepEqual(actual.writes, []);
  }
});

for (const screen of ['home', 'new']) test(`${screen} retains readable primary or preview labels in every portal palette`, async t => {
  const page = await pageFor(t); await page.goto(`${fixture.origin}/fixture/${screen}`);
  const frame = page.frameLocator('iframe'), selector = screen === 'home' ? '#recentGrid .btn' : '.card .pv .badge';
  await frame.locator(selector).first().waitFor();
  for (const theme of themes) {
    await page.evaluate(value => window.createTheme.apply(value), theme);
    await frame.locator(`html[data-theme="${theme}"]`).waitFor();
    const contrast = await controlContrast(frame, selector);
    assert.ok(contrast >= 4.5, `${screen}/${theme}: label contrast ${contrast.toFixed(2)}`);
  }
});
