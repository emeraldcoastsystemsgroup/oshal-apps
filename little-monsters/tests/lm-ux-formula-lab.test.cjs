/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (lm-formula-lab MERGE into lm-stem). Formula Lab was a static sheet with its own tile beside STEM Helpers. The tile left ui.static, its address opens STEM's Formulas tab, and the tab carries Formula Lab's fixes: subject chips All · Physics 1 · Chemistry (44px), a × that clears the search, each card one button with a chevron and no repeated 'Tap for a worked example ›'.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Regression guard: 1.8.1 removed the lm-formula-lab tile, which home-experience and classroom-experience name as a surface, and every composite of those experiences went component_unavailable on the trial. Every surface an experience names for little-monsters or youtube-kids must exist in that package's ui.static; the Formula Lab tile stays and its address opens STEM's Formulas tab.
 * -----------------------------------------------------------------------------
 *
 * Needs the store toolchain (express, js-yaml, playwright, chromium).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLS = path.join(PKG, 'tools');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const yaml = require(path.join(TOOLCHAIN, 'js-yaml'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

/** @description Serve STEM and Formula Lab with an empty profile. @returns {Promise<{base:string, close:Function}>} */
function serve() {
  const app = express();
  app.get('/api/education/stem-helpers', (_req, res) => res.sendFile(path.join(TOOLS, 'stem-helpers.html')));
  app.get('/api/education/formula-lab', (_req, res) => res.sendFile(path.join(TOOLS, 'formula-lab.html')));
  app.get('/api/education/education.css', (_req, res) => res.sendFile(path.join(TOOLS, 'education.css')));
  app.get('/api/education/mascot.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-mascot.js')));
  app.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: [] } } }));
  app.get('/api/education/me', (_req, res) => res.json({ name: 'Ella', role: 'student' }));
  app.use((req, res) => (req.method === 'GET' && /\.(css|js)$/.test(req.path) ? res.type(path.extname(req.path)).send('') : res.status(404).json({})));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}

test('every surface an experience names exists in this package and in Kid Lens (removing one suspends the experience composites)', () => {
  const STORE = path.join(PKG, '..');
  const tabs = (app) => new Set(yaml.load(fs.readFileSync(path.join(STORE, app, 'oshal-app.yaml'), 'utf8')).ui.static.map((t) => t.toolName));
  const own = { 'little-monsters': tabs('little-monsters'), 'youtube-kids': tabs('youtube-kids') };
  const missing = [];
  for (const dir of fs.readdirSync(STORE).filter((d) => /-experience$/.test(d))) {
    const file = path.join(STORE, dir, 'oshal-app.yaml');
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/- app: (little-monsters|youtube-kids)\s*\n\s*surface: ([\w-]+)/g)) if (!own[m[1]].has(m[2])) missing.push(`${dir} -> ${m[1]}/${m[2]}`);
  }
  assert.deepEqual(missing, []);
  assert.ok(own['little-monsters'].has('lm-formula-lab'), 'the Formula Lab tile stays: home-experience and classroom-experience name it');
  assert.match(fs.readFileSync(path.join(PKG, 'authorization.yaml'), 'utf8'), /path: \/formula-lab, allOf: \[app\.open\]/);
});

test("Formula Lab's address opens STEM's Formulas tab, with subject chips, a clear button and one chevron per card", async () => {
  const { base, close } = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
    await page.goto(`${base}/api/education/formula-lab`);
    await page.waitForURL(/\/api\/education\/stem-helpers\?tab=formulas$/);
    await page.locator('#panel-formulas:not([hidden]) .f').first().waitFor();
    assert.equal(await page.getAttribute('#tab-formulas', 'aria-selected'), 'true');
    assert.equal(await page.getByText('Tap for a worked example').count(), 0);
    assert.equal(await page.locator('.f .chev').count(), await page.locator('.f').count());
    const chips = await page.$$eval('.subject-chips button', (bs) => bs.map((b) => ({ t: b.textContent, h: b.getBoundingClientRect().height })));
    assert.deepEqual(chips.map((c) => c.t), ['All', 'Physics 1', 'Chemistry']);
    assert.ok(chips.every((c) => c.h >= 44), JSON.stringify(chips));
    await page.locator('.subject-chips button', { hasText: 'Chemistry' }).tap();
    assert.deepEqual(await page.$$eval('#out h2', (hs) => hs.map((h) => h.textContent)), ['Chemistry']);
    assert.equal(await page.locator('#searchClear').isVisible(), false);
    await page.fill('#search', 'mol');
    assert.equal(await page.locator('#searchClear').isVisible(), true);
    await page.locator('#searchClear').tap();
    assert.equal(await page.inputValue('#search'), '');
    assert.equal(await page.locator('#searchClear').isVisible(), false);
    await page.locator('.f').first().tap();
    assert.equal(await page.locator('.f').first().getAttribute('aria-expanded'), 'true');
  } finally {
    await browser.close();
    close();
  }
});
