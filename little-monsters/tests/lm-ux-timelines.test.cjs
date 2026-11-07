/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (lm-timelines). An event could only be removed (no edit), Remove was a bare button with no way back, a phone showed the add form before the timeline, and there was no print. Drives the shipped page in Chromium: tapping an event edits it in place (fields filled, Save keeps the change, Cancel keeps the old text); Remove sits in the event's ⋯ and an 8-second Undo puts it back where it was; at 412x915 'Your timeline' comes first and '+ Add an event' (the one visible primary) opens the form as a sheet that adds an event; Print calls window.print; the title ▾ menu holds 'New timeline' as a planned control (aria-disabled, RP-LM-05, opacity 1) whose tap changes nothing.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Named timelines sync to the student's account via GET /student/timelines/dashboard and POST /notify timelineAction, importing localStorage once and offering New, Rename and Delete in #tlTitleMenu without native dialogs (RP-LM-05).
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

const EVENTS = [{ w: '1969-07-20', t: 'Moon landing', n: 'Apollo 11' }, { w: '1776', t: 'Declaration of Independence', n: '' }];

/** @description Serve the shipped timelines page and the frame's data; count every request. @returns {Promise<object>} */
function serve() {
  const app = express();
  const calls = [];
  const accountTimelines = [];
  app.use(express.json());
  app.use((req, _res, next) => { calls.push(`${req.method} ${req.path}`); next(); });
  app.get('/api/education/timelines', (_req, res) => res.sendFile(path.join(TOOLS, 'timelines.html')));
  app.get('/api/education/education.css', (_req, res) => res.sendFile(path.join(TOOLS, 'education.css')));
  app.get('/api/education/mascot.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-mascot.js')));
  app.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: [] } } }));
  app.get('/api/education/me', (_req, res) => res.json({ name: 'Ella', role: 'student', studentId: 'st1' }));
  app.get('/api/education/rewards', (_req, res) => res.json({ xp: 10, level: 1 }));
  app.get('/api/education/student/timelines/dashboard', (_req, res) => res.json({ timelines: accountTimelines }));
  app.post('/api/education/notify', (req, res) => {
    const b = req.body || {};
    if (b.timelineAction === 'import') {
      if (accountTimelines.length > 0) return res.json({ imported: false, timeline: accountTimelines[0] });
      const created = { timelineId: 'tl-1', title: b.title || 'Your timeline', events: b.events || [] };
      accountTimelines.push(created);
      return res.json({ imported: true, timeline: created });
    }
    if (b.timelineAction === 'create') {
      const created = { timelineId: `tl-${accountTimelines.length + 1}`, title: b.title, events: b.events || [] };
      accountTimelines.unshift(created);
      return res.status(201).json({ timeline: created });
    }
    if (b.timelineAction === 'rename') {
      const hit = accountTimelines.find((t) => t.timelineId === b.timelineId);
      if (hit) hit.title = b.title;
      return res.json({ timeline: hit });
    }
    if (b.timelineAction === 'update') {
      const hit = accountTimelines.find((t) => t.timelineId === b.timelineId);
      if (hit) hit.events = b.events || [];
      return res.json({ timeline: hit });
    }
    if (b.timelineAction === 'delete') {
      const idx = accountTimelines.findIndex((t) => t.timelineId === b.timelineId);
      if (idx >= 0) accountTimelines.splice(idx, 1);
      return res.json({ deleted: true });
    }
    return res.status(400).json({ error: 'unsupported' });
  });
  app.use((req, res) => (req.method === 'GET' && /\.(css|js)$/.test(req.path) ? res.type(path.extname(req.path)).send('') : res.status(404).json({})));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close(), calls, accountTimelines }));
  });
}

/** @description Open the page with two saved events. @returns {Promise<object>} page */
async function open(browser, base, viewport) {
  const page = await browser.newPage({ viewport, hasTouch: true, isMobile: viewport.width < 600 });
  page.on('dialog', (d) => { d.dismiss(); throw new Error(`native dialog: ${d.message()}`); });
  await page.addInitScript((events) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('lm-timeline', JSON.stringify(events)); sessionStorage.setItem('seeded', '1'); } }, EVENTS);
  await page.goto(`${base}/api/education/timelines`);
  await page.locator('.lm-topbar[data-lm-ready]').waitFor();
  await page.locator('#tl .ev').first().waitFor();
  return page;
}
const titles = (page) => page.$$eval('#tl .ev .ti', (ts) => ts.map((t) => t.textContent));
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('lm-timeline')));

test('timelines: edit in place, Remove in ⋯ with an 8-second Undo, Print', async () => {
  const srv = await serve();
  const browser = await chromium.launch();
  try {
    const page = await open(browser, srv.base, { width: 1440, height: 900 });
    assert.deepEqual(await titles(page), ['Declaration of Independence', 'Moon landing'], 'sorted by date');
    await page.locator('#tl .ev-body', { hasText: 'Moon landing' }).click();
    assert.equal(await page.inputValue('#et0'), 'Moon landing', 'the fields are filled');
    assert.equal(await page.inputValue('#en0'), 'Apollo 11');
    await page.fill('#et0', 'Apollo 11 lands on the Moon');
    await page.click('[data-act="save"]');
    assert.deepEqual(await titles(page), ['Declaration of Independence', 'Apollo 11 lands on the Moon']);
    assert.equal((await stored(page))[0].t, 'Apollo 11 lands on the Moon');
    await page.locator('#tl .ev-body', { hasText: 'Declaration' }).click();
    await page.fill('#et1', 'Typo that is cancelled');
    await page.click('[data-act="cancel"]');
    assert.deepEqual(await titles(page), ['Declaration of Independence', 'Apollo 11 lands on the Moon'], 'Cancel keeps the old text');

    assert.equal(await page.locator('#tl .ev-head > [data-act="remove"]').count(), 0, 'Remove is not a bare button');
    await page.locator('#tl .ev', { hasText: 'Declaration' }).locator('.ev-menu summary').click();
    await page.locator('.ev-menu[open] [data-act="remove"]').click();
    assert.deepEqual(await titles(page), ['Apollo 11 lands on the Moon']);
    assert.match(await page.textContent('#undoBar'), /Removed “Declaration of Independence”/);
    await page.click('#undoBtn');
    assert.deepEqual(await titles(page), ['Declaration of Independence', 'Apollo 11 lands on the Moon']);
    assert.equal((await stored(page))[1].t, 'Declaration of Independence', 'back at its own place');
    assert.equal(await page.locator('#undoBar').isVisible(), false);
    const src = require('node:fs').readFileSync(path.join(TOOLS, 'timelines.html'), 'utf8');
    assert.match(src, /UNDO_MS = 8000/, 'the Undo bar stays 8 seconds');

    await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; });
    const print = page.locator('#printBtn');
    assert.doesNotMatch(await print.getAttribute('class'), /lm-btn-primary/, 'Print is secondary');
    await print.click();
    assert.equal(await page.evaluate(() => window.__printed), 1);
    await page.close();
  } finally {
    await browser.close();
    srv.close();
  }
});

test('timelines on a phone: timeline first, + Add an event sheet, and named account timelines without dialogs (RP-LM-05)', async () => {
  const srv = await serve();
  const browser = await chromium.launch();
  try {
    const page = await open(browser, srv.base, { width: 412, height: 915 });
    assert.equal(await page.locator('#addCard').isVisible(), false, 'the form waits in a sheet');
    assert.equal(await page.locator('.lm-btn-primary:visible').count(), 1);
    assert.match(await page.locator('.lm-btn-primary:visible').textContent(), /Add an event/);
    const tl = await page.locator('#tl').boundingBox();
    assert.ok(tl.y < 400, `the timeline starts at ${tl.y}px`);
    await page.waitForFunction(() => /Saved to your student account/.test(document.getElementById('tlSyncHelp').textContent));
    assert.equal(srv.accountTimelines.length, 1, 'imported existing localStorage timeline once');

    await page.locator('#addOpenBtn').tap();
    const sheet = await page.locator('#addCard').boundingBox();
    assert.ok(sheet && sheet.y + sheet.height >= 914 && sheet.x === 0, 'a sheet from the bottom');
    await page.fill('#when', '1492');
    await page.fill('#what', 'Columbus sails');
    await page.locator('#addBtn').tap();
    assert.equal(await page.locator('#addCard').isVisible(), false, 'the sheet closes after adding');
    assert.deepEqual(await titles(page), ['Columbus sails', 'Declaration of Independence', 'Moon landing']);

    await page.locator('#tlTitleMenu summary').tap();
    assert.equal(await page.locator('#tlTitleMenu [data-ds-not-yet]').count(), 0);
    await page.locator('#tlNewAction').tap();
    await page.locator('#tlNameInput').waitFor();
    await page.fill('#tlNameInput', 'Space Race');
    await page.locator('#tlManageSaveBtn').tap();
    await page.waitForFunction(() => document.getElementById('tlTitle').textContent === 'Space Race');
    assert.equal(await page.locator('#tl .ev').count(), 0, 'new named timeline starts empty');

    await page.locator('#tlTitleMenu summary').tap();
    await page.locator('#tlRenameAction').tap();
    await page.fill('#tlNameInput', 'Apollo Program');
    await page.locator('#tlManageSaveBtn').tap();
    await page.waitForFunction(() => document.getElementById('tlTitle').textContent === 'Apollo Program');

    await page.locator('#tlTitleMenu summary').tap();
    await page.locator('[data-tl-pick="tl-1"]').tap();
    assert.equal(await page.textContent('#tlTitle'), 'Your timeline');
    assert.deepEqual(await titles(page), ['Columbus sails', 'Declaration of Independence', 'Moon landing']);
    await page.close();
  } finally {
    await browser.close();
    srv.close();
  }
});
