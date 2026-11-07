/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (lm-monsters). The page showed '45 XP' with no target, a faded disabled 'Open a box' as its primary, the level-up sentence twice, a greyed Pinky in every locked slot, a brown-on-olive gold badge and a parade under the floating assistant. Drives the shipped page in Chromium: with 0 boxes the XP bar reads '45 / 100 XP · 55 to the next box', the one primary is 'Earn XP' and it opens Games, 'Open a box' is absent; with a box waiting 'Open a box' is the primary and 'Earn XP' is gone; the level-up sentence appears once; a locked slot is a '?' egg with no mascot picture; badges paint the ink colour; at 412x915 the parade strip ends 64px before the right edge and sits on the bottom bar.
 * -----------------------------------------------------------------------------
 *
 * Needs the store toolchain (express, playwright, chromium).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLS = path.join(PKG, 'tools');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

const CATALOG = [
  { id: 'mon-pink', type: 'monster', name: 'Pinky', rarity: 'common', hue: 0 },
  { id: 'mon-blue', type: 'monster', name: 'Bluey', rarity: 'rare', hue: 180 },
  { id: 'mon-gold', type: 'monster', name: 'Goldie', rarity: 'legendary', hue: 40 },
];
const PROFILE = { profile: { ribbon: { items: [
  { id: 'tool-lm-dashboard', label: 'Class dashboard', section: 'top', toolUi: { iframeUrl: '/api/education/dashboard' } },
  { id: 'tool-lm-arcade', label: 'Games', section: 'top', toolUi: { iframeUrl: '/api/education/arcade' } },
  { id: 'tool-lm-monsters', label: 'My Monsters', section: 'top', toolUi: { iframeUrl: '/api/education/my-monsters' } },
] } } };

/** @description Serve the shipped page with a rewards state of `boxes` boxes. @returns {Promise<object>} */
function serve(boxes) {
  const app = express();
  app.get('/api/education/my-monsters', (_req, res) => res.sendFile(path.join(TOOLS, 'my-monsters.html')));
  app.get('/api/education/arcade', (_req, res) => res.type('html').send('<!DOCTYPE html><title>Games</title><p id="games">Games</p>'));
  app.get('/api/education/education.css', (_req, res) => res.sendFile(path.join(TOOLS, 'education.css')));
  app.get('/api/education/mascot.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-mascot.js')));
  app.get('/api/ui/profile', (_req, res) => res.json(PROFILE));
  app.get('/api/education/me', (_req, res) => res.json({ name: 'Ella', role: 'student', studentId: 'st1' }));
  app.get('/api/education/rewards', (_req, res) => res.json({ xp: 45, level: 1, boxes, catalog: CATALOG, inventory: ['mon-pink'], equipped: { monster: 'mon-pink' } }));
  app.use((req, res) => (req.method === 'GET' && /\.(css|js|png)$/.test(req.path) ? res.type(path.extname(req.path)).send('') : res.status(404).json({})));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}

/** @description Open My Monsters as a phone and wait for the collection. @returns {Promise<object>} page */
async function open(browser, base) {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  await page.goto(`${base}/api/education/my-monsters`);
  await page.locator('.lm-topbar[data-lm-ready]').waitFor();
  await page.locator('#grid .it').first().waitFor();
  return page;
}

test('monsters with no box: XP has a target, Earn XP is the one primary and opens Games, locked slots are eggs', async () => {
  const srv = await serve(0);
  const browser = await chromium.launch();
  try {
    const page = await open(browser, srv.base);
    assert.equal(await page.textContent('#xp'), '45 / 100 XP · 55 to the next box');
    assert.equal(await page.getAttribute('#xpBar', 'aria-valuenow'), '45');
    assert.equal(await page.locator('#openBtn').isVisible(), false, 'no faded Open a box');
    assert.equal(await page.locator('.lm-btn-primary:visible').count(), 1);
    assert.match(await page.locator('.lm-btn-primary:visible').textContent(), /Earn XP/);
    const text = await page.textContent('main');
    assert.equal((text.match(/every (new )?level drops a (mystery )?box/gi) || []).length, 1, 'the level-up sentence is said once');
    const locked = page.locator('#grid .it:disabled');
    assert.equal(await locked.count(), 2);
    assert.equal(await locked.locator('img').count(), 0, 'no mascot picture in a locked slot');
    assert.equal(await locked.locator('.egg').count(), 2);
    assert.equal(await locked.first().evaluate((b) => getComputedStyle(b).opacity), '1');
    const ink = await page.evaluate(() => { const s = document.createElement('span'); s.style.color = 'var(--lm-ink)'; document.body.append(s); return getComputedStyle(s).color; });
    for (const color of await page.$$eval('#grid .rar', (rs) => rs.map((r) => getComputedStyle(r).color))) assert.equal(color, ink, 'badges paint ink');

    await page.evaluate(() => { window.parade(); });
    const strip = await page.locator('#parade').boundingBox();
    assert.ok(strip.x + strip.width <= 412 - 64, `the parade reaches ${strip.x + strip.width}px, into the assistant's corner`);
    assert.ok(strip.y + strip.height <= 915 - 56 + 1, 'the parade sits on the bottom bar, not under it');

    await page.locator('#earnBtn').tap();
    await page.waitForURL(/\/api\/education\/arcade$/);
    await page.close();
  } finally {
    await browser.close();
    srv.close();
  }
});

test('monsters with a box waiting: Open a box is the primary and Earn XP is gone', async () => {
  const srv = await serve(1);
  const browser = await chromium.launch();
  try {
    const page = await open(browser, srv.base);
    assert.equal(await page.locator('.lm-btn-primary:visible').count(), 1);
    assert.match(await page.locator('.lm-btn-primary:visible').textContent(), /Open a box/);
    assert.equal(await page.isDisabled('#openBtn'), false);
    assert.equal(await page.locator('#earnBtn').isVisible(), false);
    await page.close();
  } finally {
    await browser.close();
    srv.close();
  }
});
