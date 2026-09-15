/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove actual Stories palette changes retain drafts, connected actions, readable controls and the original document.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, themes, startFixture } from './creative-theme-fixture.mjs';

let fixture, browser;
before(async () => { fixture = await startFixture(); browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); await fixture?.close(); });

/** Seed synthetic preferences and block every external destination. */
async function pageFor(t, saved = 'workspace', width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
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

/** Wait for the unchanged business script to finish its two synthetic reads. */
async function openEmbedded(page) {
  await page.goto(`${fixture.origin}/fixture`);
  const frame = page.frameLocator('iframe');
  await frame.locator('#records .record').waitFor();
  return frame;
}

/** Record the editable nodes to detect destructive rerenders while changing appearance. */
async function enterDraft(frame) {
  await frame.locator('#title').fill('Unsent synthetic title');
  await frame.locator('#notes').fill('Unsent synthetic brief');
  await frame.locator('#sourceUrl').fill('https://example.test/draft');
  await frame.locator('html').evaluate(() => { window.retainedDocument = document; window.retainedFields = ['title', 'notes', 'sourceUrl'].map(id => document.getElementById(id)); });
}

/** Resolve inherited token colors through the browser without replacing production markup. */
async function colors(surface) {
  return surface.locator('body').evaluate(body => {
    const probe = document.createElement('span'); body.append(probe);
    probe.style.color = 'var(--bg-primary)'; const background = getComputedStyle(probe).color;
    probe.style.color = 'var(--text-primary)'; const foreground = getComputedStyle(probe).color; probe.remove();
    return { theme: document.documentElement.dataset.theme, background, foreground, actualBackground: getComputedStyle(body).backgroundColor,
      actualForeground: getComputedStyle(body).color, saved: localStorage.getItem('cockpit-theme'), writes: window.themeWrites };
  });
}

/** Check painted control contrast, including translucent ancestor backgrounds. */
async function contrast(surface, selector) {
  return surface.locator(selector).first().evaluate(element => {
    const rgba = color => {
      const values = color.match(/[\d.]+/g).map(Number);
      return color.startsWith('color(srgb') ? values.map((value, index) => index < 3 ? value * 255 : value) : values;
    };
    const background = [0, 0, 0]; let coverage = 0;
    for (let node = element; node && coverage < 1; node = node.parentElement) {
      const color = rgba(getComputedStyle(node).backgroundColor), alpha = color[3] ?? 1;
      for (let index = 0; index < 3; index++) background[index] += color[index] * alpha * (1 - coverage);
      coverage += alpha * (1 - coverage);
    }
    const luminance = rgb => rgb.slice(0, 3).map(value => {
      const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    const front = luminance(rgba(getComputedStyle(element).color)), back = luminance(background);
    return (Math.max(front, back) + .05) / (Math.min(front, back) + .05);
  });
}

/** Save only synthetic fixture screenshots when a review directory is explicitly supplied. */
async function screenshot(page, name) {
  if (!process.env.CREATIVE_THEME_SCREENSHOT_DIR) return;
  await mkdir(process.env.CREATIVE_THEME_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: resolve(process.env.CREATIVE_THEME_SCREENSHOT_DIR, `${name}.png`), fullPage: true });
}

test('Stories follows twelve live parent palettes without replacing its unsent draft', async t => {
  const page = await pageFor(t), frame = await openEmbedded(page); await enterDraft(frame);
  assert.equal((await colors(frame)).theme, 'workspace');
  for (const theme of themes) {
    await page.evaluate(value => window.storiesTheme.apply(value), theme);
    await frame.locator(`html[data-theme="${theme}"]`).waitFor();
    const actual = await colors(frame);
    assert.equal(actual.actualBackground, actual.background, theme); assert.equal(actual.actualForeground, actual.foreground, theme);
    assert.equal(actual.saved, theme); assert.deepEqual(actual.writes, []);
    assert.deepEqual(await frame.locator('html').evaluate(() => window.retainedFields.map(node => node.value)),
      ['Unsent synthetic title', 'Unsent synthetic brief', 'https://example.test/draft']);
    assert.equal(await frame.locator('html').evaluate(() => window.retainedDocument === document && window.retainedFields.every(node => node === document.getElementById(node.id))), true);
    if (['workspace', 'midnight', 'daylight'].includes(theme)) await screenshot(page, `stories-${theme}`);
  }
  assert.deepEqual(fixture.requests.filter(row => !['GET', 'HEAD'].includes(row.method)), []);
});

test('Stories controls and supporting text remain readable in all twelve palettes', async t => {
  const page = await pageFor(t), frame = await openEmbedded(page);
  for (const theme of themes) {
    await page.evaluate(value => window.storiesTheme.apply(value), theme); await frame.locator(`html[data-theme="${theme}"]`).waitFor();
    for (const selector of ['#title', '#notes', '#sourceUrl', '#refresh', '.hint', '.record p', '.connected-app-actions button', 'a', '.eyebrow']) {
      const ratio = await contrast(frame, selector); assert.ok(ratio >= 4.5, `${theme}/${selector}: ${ratio.toFixed(2)}`);
    }
  }
});

test('Stories follows optional Create colors and returns to the saved portal palette', async t => {
  const page = await pageFor(t, 'midnight'), frame = await openEmbedded(page); await enterDraft(frame);
  await page.locator('#settingsApplicationColors').check(); await frame.locator('html[data-theme="create"]').waitFor();
  const app = await colors(frame); assert.equal(app.actualBackground, app.background); assert.equal(app.saved, 'midnight');
  await page.locator('#workspace').click(); await frame.locator('html[data-theme="workspace"]').waitFor();
  assert.notEqual((await colors(frame)).actualBackground, app.actualBackground);
  assert.equal(await frame.locator('#notes').inputValue(), 'Unsent synthetic brief');
  assert.equal(await page.locator('#settingsApplicationColors').isChecked(), false); assert.deepEqual((await colors(frame)).writes, []);
});

test('Standalone Stories follows a real cross-tab change without writing preferences', async t => {
  const page = await pageFor(t); await page.goto(`${fixture.origin}/api/creative-studio/review`);
  await page.locator('#records .record').waitFor(); await enterDraft(page);
  const chooser = await page.context().newPage(); await chooser.goto(`${fixture.origin}/fixture`);
  await chooser.locator('html[data-ready="true"]').waitFor(); await chooser.locator('#midnight').click();
  await page.locator('html[data-theme="midnight"]').waitFor();
  const actual = await colors(page); assert.equal(actual.actualBackground, actual.background); assert.deepEqual(actual.writes, []);
  assert.equal(await page.locator('#notes').inputValue(), 'Unsent synthetic brief');
});

test('Fresh standalone Stories starts in Workspace without inventing a preference', async t => {
  const page = await pageFor(t, null); await page.goto(`${fixture.origin}/api/creative-studio/review`);
  await page.locator('#records .record').waitFor(); const actual = await colors(page);
  assert.equal(actual.theme, 'workspace'); assert.equal(actual.saved, null); assert.deepEqual(actual.writes, []);
});

test('Recorded evidence and edited connected drafts retain their actual handoff behavior after theme changes', async t => {
  const page = await pageFor(t), frame = await openEmbedded(page);
  await frame.getByRole('button', { name: 'Use this evidence' }).click();
  assert.equal(await frame.locator('#title').inputValue(), 'Synthetic story');
  await frame.locator('#notes').fill('Reviewed manual changes');
  await page.locator('#midnight').click(); await frame.locator('html[data-theme="midnight"]').waitFor();
  await frame.getByRole('button', { name: 'Refresh evidence' }).click();
  await frame.getByRole('button', { name: 'Prepare a document' }).click();
  await page.waitForFunction(() => window.navigations.length === 1);
  const result = await page.evaluate(() => ({ context: handoffRequests[0].context, navigation: navigations[0] }));
  assert.deepEqual(result.context, { title: 'Synthetic story', notes: 'Reviewed manual changes', sourceUrl: 'https://example.test/story' });
  assert.equal(result.navigation.id, 'tool-office'); assert.equal(result.navigation.options.url, '/api/office/app');
  assert.deepEqual(fixture.requests.filter(row => !['GET', 'HEAD'].includes(row.method)), []);
});

test('Stories remains usable at mobile and laptop widths with long unsent text', async t => {
  for (const width of [390, 960]) {
    const page = await pageFor(t, 'workspace', width), frame = await openEmbedded(page);
    await frame.locator('#notes').fill('Synthetic draft '.repeat(110)); await frame.locator('#sourceUrl').fill(`https://example.test/${'path'.repeat(90)}`);
    assert.equal(await frame.locator('html').evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await frame.locator('#notes').focus(); await page.keyboard.press('Tab');
    assert.equal(await frame.locator('#sourceUrl').evaluate(element => element === document.activeElement), true);
    await screenshot(page, `stories-${width}`);
  }
});
