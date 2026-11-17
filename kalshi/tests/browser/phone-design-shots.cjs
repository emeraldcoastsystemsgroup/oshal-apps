/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.10.0 phone design: screenshots of the Markets tab with the synthetic markets of phone-design-fixture.cjs, inside the stand-in for Today's shell, at 412x915, 390x844, 360x780 and 1440x900, plus Why, Filter, Help and the end of the list at 412 when the page has them. Prints where the first market starts. Any page file can be shot, so the version before a change and the one after are pictured the same way. Reads only; not a test.
 *
 * Usage: [KALSHI_SHOT_THEME=light-blue] node tests/browser/phone-design-shots.cjs <out-dir> <label> [page-file]
 * The kernel's theme files are served from OSHAL_PLATFORM_ROOT, else from an oshal-kernel/platform beside the clone, so
 * the pictures wear a real theme (light-blue, Roger's, unless KALSHI_SHOT_THEME names another); without one they are bare.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { playwright, openPage } = require('./phone-fixture.cjs');
const { PAGE, PHONES, DESKTOP, READS, HOST } = require('./phone-design-fixture.cjs');

const [outDir, label = 'shot', pageFile = PAGE] = process.argv.slice(2);
const FIRST = '#mk-list .kx-card, #mk-rows tr[data-ticker]';
const THEME = process.env.KALSHI_SHOT_THEME || 'light-blue';

/** @description The kernel's theme stylesheets by the paths the page asks for, when a platform checkout is at hand. */
function themeFiles() {
  const root = [process.env.OSHAL_PLATFORM_ROOT, path.resolve(__dirname, '../../../../oshal-kernel/platform')].filter(Boolean)
    .find((dir) => fs.existsSync(path.join(dir, 'src/shared/ui/css/surface-themes.css')));
  if (!root) return {};
  const files = {}, css = path.join(root, 'src/shared/ui/css'), themes = path.join(root, 'src/pages/cockpit/css/themes');
  for (const name of fs.readdirSync(css).filter((f) => f.endsWith('.css'))) files[`/shared/ui/css/${name}`] = path.join(css, name);
  for (const name of fs.readdirSync(themes).filter((f) => f.endsWith('.css'))) files[`/cockpit/css/themes/${name}`] = path.join(themes, name);
  return files;
}

/** @description Where the first market starts on the screen, in pixels and as a share of the screen's height. */
async function firstMarket(top, frame, size) {
  const offset = await top.evaluate(() => document.querySelector('iframe').getBoundingClientRect().top);
  const at = await frame.evaluate((sel) => document.querySelector(sel).getBoundingClientRect().top, FIRST);
  return { px: Math.round(offset + at), pct: Math.round(((offset + at) / size.height) * 100) };
}

/** @description The extra pictures at 412: a card's Why, the Filter sheet, Help, and the end of the list. */
async function sheets(top, frame, base) {
  if (!(await frame.locator('#kx-why').count())) return;
  await frame.locator('#mk-list .kx-card').first().tap();
  await frame.waitForFunction(() => /Price vs chance/.test(document.getElementById('kx-why-body').textContent));
  await top.screenshot({ path: `${base}-why.png` });
  await frame.locator('#kx-why [data-sheet-close]').tap();
  await frame.locator('#kx-filter-open').tap();
  await top.screenshot({ path: `${base}-filter.png` });
  await frame.locator('#kx-filter [data-sheet-close]').last().tap();
  await top.locator('.kalshi-host-actions [data-kalshi-host="help"]').tap();
  await top.screenshot({ path: `${base}-help.png` });
  await frame.locator('#kx-help [data-sheet-close]').first().tap();
  await top.locator('.kalshi-host-actions [data-kalshi-host="search"]').tap();
  await frame.locator('#mk-q').fill('coastal test city 2');
  await frame.waitForFunction(() => /match/.test(document.getElementById('mk-counts').textContent));
  await top.screenshot({ path: `${base}-search.png` });
}

(async () => {
  if (!outDir) throw new Error('usage: phone-design-shots.cjs <out-dir> <label> [page-file]');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await playwright().chromium.launch({ headless: true });
  try {
    for (const size of [...PHONES, DESKTOP]) {
      const touch = size.width <= 640;
      const files = { ...themeFiles(), '/api/kalshi/': path.resolve(pageFile) };
      const { page: frame, top, context } = await openPage(browser, size, { url: '/api/kalshi/', files, reads: READS, framed: true, host: HOST, touch });
      try {
        await frame.waitForFunction((sel) => document.querySelectorAll(sel).length > 0, FIRST, { timeout: 15000 });
        await frame.evaluate((theme) => { document.documentElement.setAttribute('data-theme', theme); }, THEME);
        await frame.waitForTimeout(600);
        const base = path.join(outDir, `${label}-fixture-${size.width}`);
        await top.screenshot({ path: `${base}.png` });
        console.log(`${label} ${size.width}x${size.height}: first market at ${JSON.stringify(await firstMarket(top, frame, size))}`);
        await frame.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await frame.waitForTimeout(200);
        await top.screenshot({ path: `${base}-end.png` });
        await frame.evaluate(() => window.scrollTo(0, 0));
        if (size.width === 412) await sheets(top, frame, base);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
