/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise actual Career HTML and shared theme code in Chromium, preserving drafts, print content and read-only palette changes.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, screens, startFixture } from './career-theme-fixture.mjs';

let fixture, browser;
before(async () => { fixture = await startFixture(); browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); await fixture?.close(); });

/** Use isolated saved preferences and block all traffic outside the fixture origin. */
async function pageFor(t, theme = 'workspace', mobile = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
  t.after(() => context.close());
  await context.addInitScript(value => localStorage.setItem('cockpit-theme', value), theme);
  await context.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
  return context.newPage();
}

/** Read computed colors, rather than merely checking linked filenames or theme attributes. */
async function colors(page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement), body = getComputedStyle(document.body);
    const probe = document.createElement('span'); probe.style.color = 'var(--bg-primary)'; document.body.append(probe);
    const background = getComputedStyle(probe).color; probe.style.color = 'var(--text-primary)';
    const foreground = getComputedStyle(probe).color; probe.remove();
    return { theme: document.documentElement.dataset.theme, background, foreground,
      actualBackground: body.backgroundColor, actualForeground: body.color,
      brand: root.getPropertyValue('--career-brand-accent').trim() };
  });
}

for (const screen of Object.keys(screens)) test(`${screen} follows saved and live palettes without replacing its screen`, async t => {
  const page = await pageFor(t);
  await page.goto(`${fixture.origin}/api/career-hunter/${screen}`);
  const initial = await colors(page);
  assert.equal(initial.theme, 'workspace');
  assert.equal(initial.actualForeground, initial.foreground);
  assert.equal(initial.actualBackground, initial.background);
  assert.ok(initial.brand, 'shared Career branding must resolve from the palette');
  await page.evaluate(() => { window.retainedDocument = document; localStorage.setItem('cockpit-theme', 'midnight'); window.dispatchEvent(new Event('focus')); });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'midnight');
  const dark = await colors(page);
  assert.equal(dark.actualForeground, dark.foreground);
  assert.equal(dark.actualBackground, dark.background);
  assert.notEqual(dark.background, initial.background);
  assert.equal(await page.evaluate(() => window.retainedDocument === document), true);
  if (screen === 'board-native' && process.env.CAREER_THEME_SCREENSHOT_DIR) {
    await page.evaluate(() => { localStorage.setItem('cockpit-theme', 'workspace'); window.dispatchEvent(new Event('focus')); });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'workspace');
    await mkdir(process.env.CAREER_THEME_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: resolve(process.env.CAREER_THEME_SCREENSHOT_DIR, 'career-workspace-board.png') });
  }
});

test('parent palette and optional application colors preserve the Career draft and iframe', async t => {
  const page = await pageFor(t);
  await page.goto(`${fixture.origin}/fixture/profile-studio`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  const frame = page.frameLocator('iframe');
  await frame.locator('#headline').fill('Unsaved synthetic headline');
  await page.evaluate(() => { window.retainedFrame = document.querySelector('iframe'); });
  await page.locator('#midnight').click();
  await frame.locator('html[data-theme="midnight"]').waitFor();
  await page.locator('#settingsApplicationColors').check();
  await frame.locator('html[data-theme="daylight"]').waitFor();
  await page.locator('#workspace').click();
  await frame.locator('html[data-theme="workspace"]').waitFor();
  assert.equal(await page.locator('#settingsApplicationColors').isChecked(), false);
  assert.equal(await frame.locator('#headline').inputValue(), 'Unsaved synthetic headline');
  assert.equal(await page.evaluate(() => window.retainedFrame === document.querySelector('iframe')), true);
  assert.deepEqual(fixture.requests.filter(row => !['GET', 'HEAD'].includes(row.method)), []);
});

test('resume paper stays white while the editor follows the palette', async t => {
  const page = await pageFor(t, 'midnight');
  await page.goto(`${fixture.origin}/api/career-hunter/resume-studio`);
  await page.locator('.sheet h1').waitFor();
  assert.equal(await page.locator('.sheet').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
  await page.locator('#msg').fill('Unsaved guide request');
  await page.evaluate(() => { localStorage.setItem('cockpit-theme', 'workspace'); window.dispatchEvent(new Event('focus')); });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'workspace');
  assert.equal(await page.locator('.sheet').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
  assert.equal(await page.locator('#msg').inputValue(), 'Unsaved guide request');
});

test('mobile screens keep their viewport and primary controls readable', async t => {
  const page = await pageFor(t, 'workspace', true);
  for (const screen of Object.keys(screens)) {
    await page.goto(`${fixture.origin}/api/career-hunter/${screen}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${screen}: horizontal page overflow`);
    const controls = await page.locator('button.primary, .btn.primary').evaluateAll(elements => elements.filter(el => el.offsetWidth > 0).map(el => {
      const style = getComputedStyle(el); return { color: style.color, background: style.backgroundColor };
    }));
    for (const control of controls) assert.notEqual(control.color, control.background, `${screen}: primary label disappears`);
  }
});

/** Compare opaque computed RGB colors using WCAG relative luminance. */
function contrast(a, b) {
  const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
    const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  }).reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);
  const left = luminance(a), right = luminance(b);
  return (Math.max(left, right) + .05) / (Math.min(left, right) + .05);
}

test('Career primary labels have readable contrast in all twelve portal palettes', async t => {
  const page = await pageFor(t);
  await page.goto(`${fixture.origin}/fixture/settings`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  const frame = page.frameLocator('iframe');
  for (const theme of ['midnight', 'daylight', 'ocean', 'sakura', 'forest', 'gray', 'black', 'light-blue', 'aurora', 'graphite', 'amber', 'workspace']) {
    await page.evaluate(value => window.careerTheme.apply(value), theme);
    await frame.locator(`html[data-theme="${theme}"]`).waitFor();
    await frame.locator('button.primary').first().evaluate(async el => {
      getComputedStyle(el).color;
      await Promise.all(el.getAnimations().map(animation => animation.finished));
    });
    const controls = await frame.locator('button.primary').evaluateAll(elements => elements.map(el => {
      const style = getComputedStyle(el); return { label: el.textContent, color: style.color, background: style.backgroundColor };
    }));
    assert.ok(controls.length > 0);
    for (const control of controls) assert.ok(contrast(control.color, control.background) >= 4.5,
      `${theme}: ${control.label} contrast ${contrast(control.color, control.background).toFixed(2)}`);
  }
});

test('Search retains a selected filter and its results when the portal changes color', async t => {
  const page = await pageFor(t);
  await page.goto(`${fixture.origin}/fixture/search-ui`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  const frame = page.frameLocator('iframe');
  await frame.locator('#adv > summary').click();
  await frame.locator('#title').fill('Platform');
  await frame.locator('#list').getByText('Platform Engineer', { exact: true }).waitFor();
  await page.locator('#midnight').click();
  await frame.locator('html[data-theme="midnight"]').waitFor();
  assert.equal(await frame.locator('#title').inputValue(), 'Platform');
  assert.ok(await frame.locator('#list').getByText('Platform Engineer', { exact: true }).isVisible());
  assert.deepEqual(fixture.requests.filter(row => !['GET', 'HEAD'].includes(row.method)), []);
});
