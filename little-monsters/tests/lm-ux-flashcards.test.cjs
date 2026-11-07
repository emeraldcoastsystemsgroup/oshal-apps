/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (lm-flashcards). The hub showed a primary Study on every set beside the primary '+ New flashcard set', a bare trash icon and the browser's confirm dialog; the study view exposed the unflipped answer to a screen reader and its three audio buttons overlapped (the hidden face's buttons sat on top of the shown face's). Drives the shipped hub and study pages in Chromium at 412x915: one primary, Study secondary, Edit and Delete in the set's ⋯ with an in-page confirm (no dialog), Delete sends DELETE; the answer face is aria-hidden until the flip; Read aloud, Speak answer and Read answer are one row of 44px targets that do not overlap, Read answer waits for the flip; Shuffle is a planned control (aria-disabled, RP-LM-04, opacity 1) whose tap changes nothing.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Shuffle (#shuffleBtn) and Term first | Definition first (#promptSideSwitch) persist per set for the learner via GET /cards?includePrefs=1 and POST /flashcards/review while keeping reviews bound to cardId (RP-LM-04).
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

const SETS = [{ set_id: 's1', title: 'Cell biology', card_count: 2, class_id: null }];
const CARDS = [{ card_id: 'k1', front: 'Mitochondria', back: 'The powerhouse of the cell' }, { card_id: 'k2', front: 'Ribosome', back: 'Makes proteins' }];

/** @description Serve the hub and the study page with a student, one private set and its cards. @returns {Promise<object>} */
function serve({ sets = SETS } = {}) {
  const app = express();
  const calls = [];
  const prefsBySet = {};
  const reviews = [];
  app.use(express.json());
  app.use((req, _res, next) => { calls.push(`${req.method} ${req.path}`); next(); });
  app.get('/api/education/flashcards-hub', (_req, res) => res.sendFile(path.join(TOOLS, 'flashcard-hub.html')));
  app.get('/api/education/flashcards', (_req, res) => res.sendFile(path.join(TOOLS, 'flashcard-study.html')));
  app.get('/api/education/education.css', (_req, res) => res.sendFile(path.join(TOOLS, 'education.css')));
  app.get('/api/education/mascot.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-mascot.js')));
  app.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: [] } } }));
  app.get('/api/education/me', (_req, res) => res.json({ name: 'Ella', role: 'student', studentId: 'st1' }));
  app.get('/api/education/rewards', (_req, res) => res.json({ xp: 10, level: 1 }));
  app.get('/api/education/classes', (_req, res) => res.json({ classes: [] }));
  app.get('/api/education/flashcards/sets', (_req, res) => res.json({ sets }));
  app.get('/api/education/flashcards/sets/:id/cards', (req, res) => {
    const preferences = prefsBySet[req.params.id] || { shuffle: false, promptSide: 'term' };
    res.json(req.query.includePrefs === '1' ? { cards: CARDS, preferences } : { cards: CARDS });
  });
  app.post('/api/education/flashcards/review', (req, res) => {
    if (req.body && req.body.preferences) {
      prefsBySet[req.body.setId] = req.body.preferences;
      return res.json({ success: true, preferences: req.body.preferences });
    }
    reviews.push(req.body);
    return res.json({ success: true, nextReview: '2026-11-07', interval: 1, easeFactor: 2.5 });
  });
  app.post('/api/education/rewards', (_req, res) => res.json({ xp: 15, level: 1 }));
  app.delete('/api/education/flashcards/sets/:id', (_req, res) => res.json({ success: true }));
  app.use((req, res) => (req.method === 'GET' && /\.(css|js)$/.test(req.path) ? res.type(path.extname(req.path)).send('') : res.status(404).json({})));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close(), calls, prefsBySet, reviews }));
  });
}

/** @description A phone page that fails the test on any native dialog. @returns {Promise<object>} */
async function phone(browser, url) {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  page.on('dialog', (d) => { d.dismiss(); throw new Error(`native dialog: ${d.message()}`); });
  await page.goto(url);
  await page.locator('.lm-topbar[data-lm-ready]').waitFor();
  return page;
}

test('hub: one primary, Study secondary, Edit and Delete in the set ⋯, Delete confirms in the page', async () => {
  const srv = await serve();
  const browser = await chromium.launch();
  try {
    const page = await phone(browser, `${srv.base}/api/education/flashcards-hub`);
    await page.locator('.set-card').first().waitFor();
    assert.equal(await page.locator('.lm-btn-primary:visible').count(), 1, 'only + New flashcard set is a primary');
    assert.match(await page.locator('.lm-btn-primary:visible').textContent(), /New flashcard set/);
    const studyClass = await page.getAttribute('[data-act="study"]', 'class');
    assert.doesNotMatch(studyClass, /lm-btn-primary/);
    assert.equal(await page.locator('.set-actions > [data-act="del"], .set-actions > [data-act="edit"]').count(), 0, 'no bare edit/delete buttons');
    await page.locator('.set-menu summary').tap();
    assert.deepEqual(await page.$$eval('.set-menu[open] .lm-more-menu button', (bs) => bs.map((b) => b.textContent.trim())), ['✎ Edit', '🗑 Delete']);
    await page.locator('.set-menu [data-act="del"]').tap();
    await page.locator('.set-confirm').waitFor();
    assert.match(await page.textContent('.set-confirm'), /Delete this set/);
    await page.locator('[data-confirm="no"]').tap();
    await page.locator('.set-menu').waitFor();
    assert.ok(!srv.calls.some((c) => c.startsWith('DELETE')), 'Keep deletes nothing');
    await page.locator('.set-menu summary').tap();
    await page.locator('.set-menu [data-act="del"]').tap();
    await page.locator('[data-confirm="yes"]').tap();
    await page.waitForFunction(() => !document.querySelector('.set-confirm'));
    assert.ok(srv.calls.includes('DELETE /api/education/flashcards/sets/s1'));
    await page.close();
  } finally {
    await browser.close();
    srv.close();
  }
});

test('hub empty state adds no second primary', async () => {
  const srv = await serve({ sets: [] });
  const browser = await chromium.launch();
  try {
    const page = await phone(browser, `${srv.base}/api/education/flashcards-hub`);
    await page.locator('#app .lm-empty').waitFor();
    assert.equal(await page.locator('.lm-btn-primary:visible').count(), 1);
    await page.close();
  } finally {
    await browser.close();
    srv.close();
  }
});

test('study: answer hidden until flip; 44px audio tools; Shuffle and Definition first persist per set (RP-LM-04)', async () => {
  const srv = await serve();
  const browser = await chromium.launch();
  try {
    const page = await phone(browser, `${srv.base}/api/education/flashcards?setId=s1`);
    await page.waitForFunction(() => document.getElementById('cardFront').textContent === 'Mitochondria');
    assert.equal(await page.getAttribute('#cardBackFace', 'aria-hidden'), 'true');
    const tools = await page.$$eval('#studyTools > button', (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return { l: b.getAttribute('aria-label'), x: r.x, y: r.y, w: r.width, h: r.height }; }));
    assert.deepEqual(tools.map((t) => t.l), ['Read aloud', 'Speak answer', 'Read answer', 'Shuffle cards']);
    for (const t of tools) assert.ok(t.h >= 44 && t.w >= 44, `${t.l} is ${t.w}x${t.h}`);
    assert.ok(tools.every((t) => Math.abs(t.y - tools[0].y) < 1), 'one row');
    for (let i = 1; i < tools.length; i += 1) assert.ok(tools[i].x >= tools[i - 1].x + tools[i - 1].w, `${tools[i].l} overlaps ${tools[i - 1].l}`);
    assert.ok(tools.every((t) => t.x >= 0 && t.x + t.w <= 412), 'all on screen');
    assert.equal(await page.isDisabled('#readBackBtn'), true, 'Read answer waits for the flip');

    await page.locator('#defFirstBtn').tap();
    await page.waitForFunction(() => document.getElementById('cardFront').textContent === 'The powerhouse of the cell');
    await page.waitForFunction(() => Boolean(window.localStorage.getItem('lm-flashcard-prefs:s1')));
    assert.deepEqual(srv.prefsBySet.s1, { shuffle: false, promptSide: 'definition' });

    await page.locator('#shuffleBtn').tap();
    assert.equal(await page.getAttribute('#shuffleBtn', 'aria-pressed'), 'true');
    await page.waitForFunction(() => JSON.parse(window.localStorage.getItem('lm-flashcard-prefs:s1')).shuffle === true);
    assert.deepEqual(srv.prefsBySet.s1, { shuffle: true, promptSide: 'definition' });

    await page.reload();
    await page.locator('.lm-topbar[data-lm-ready]').waitFor();
    await page.waitForFunction(() => document.getElementById('shuffleBtn').getAttribute('aria-pressed') === 'true');
    assert.equal(await page.getAttribute('#defFirstBtn', 'aria-pressed'), 'true');

    await page.locator('#cardContainer').tap();
    await page.waitForFunction(() => document.getElementById('cardBackFace').getAttribute('aria-hidden') === 'false');
    assert.equal(await page.getAttribute('.card-front', 'aria-hidden'), 'true');
    assert.equal(await page.isDisabled('#readBackBtn'), false);
    assert.equal(await page.isDisabled('#voiceAnswerBtn'), true);
    await page.close();
  } finally {
    await browser.close();
    srv.close();
  }
});
