/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit (lm-tutor, 2026-11-06): the shipped Tutor page in Chromium. On a 412x915 touch phone the composer is one row (+, box, mic, Send), Send is a 44px target nothing covers, the box is 16px, + opens Camera / File, the starter chips are one row above the composer; the header says "Textbook grounded" only for a class with materials and "No class materials yet" otherwise (regression: it claimed grounding for every class); a pipe table in a reply renders as a table; New chat clears the thread and drops a reply still in flight; on desktop Read aloud lives in the header ⋯ and the page asks the frame to hide the shell's orb.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The History planned control (DS-45, RP-LM-02) left of New chat: aria-disabled, its backlog id, opacity 1, not the accent, and a press makes no request and changes nothing.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | History (#historyBtn) left of New chat opens the saved tutoring threads drawer (#historyDrawer), restores prior turns to continue a thread, and deletes saved threads (RP-LM-02).
 * -----------------------------------------------------------------------------
 *
 * Needs the store toolchain (express, playwright, chromium).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));
const TOOLS = path.join(PKG, 'tools');

const CLASSES = [
  { class_id: 'c-grounded', name: 'Biology', subject: 'Science' },
  { class_id: 'c-empty', name: 'Lm Probe Chemistry', subject: 'Chemistry' },
];
/** Own and approved materials per class: Biology has one approved book, Chemistry has nothing. */
const MATERIALS = { 'c-grounded': { own: [], shared: [{ material_id: 'm1', title: 'Biology 2e' }] }, 'c-empty': { own: [], shared: [] } };
const TABLE_REPLY = 'Here is the balance:\n\n| Element | Left side | Right side |\n| --- | --- | --- |\n| H | 4 | 4 |\n| O | 2 | 2 |\n\nWhich side has more **oxygen**?';

/** @description Serve the shipped Tutor page, its assets and stub data routes; tutor replies are scripted. @returns {Promise<{base:string, close:Function, posts:object[]}>} */
function serve() {
  const posts = [];
  const threads = [];
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.get('/api/education/tutor', (_req, res) => res.sendFile(path.join(TOOLS, 'tutor-chat.html')));
  app.get('/api/education/education.css', (_req, res) => res.sendFile(path.join(TOOLS, 'education.css')));
  app.get('/api/education/mascot.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-mascot.js')));
  app.get('/api/education/lm-voice.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-voice.js')));
  app.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: [
    { id: 'tool-lm-dashboard', label: 'Class dashboard', toolUi: { iframeUrl: '/api/education/dashboard' } },
    { id: 'tool-lm-tutor', label: 'Tutor', toolUi: { iframeUrl: '/api/education/tutor' } }] } } }));
  app.get('/api/education/me', (_req, res) => res.json({ name: 'Ella Student', role: 'student' }));
  app.get('/api/education/rewards', (_req, res) => res.json({ xp: 40, level: 1 }));
  app.get('/api/education/classes', (_req, res) => res.json({ classes: CLASSES }));
  app.get('/api/education/classes/:id/materials', (req, res) => res.json({ materials: (MATERIALS[req.params.id] || { own: [] }).own }));
  app.get('/api/education/classes/:id/shared-materials', (req, res) => res.json({ materials: (MATERIALS[req.params.id] || { shared: [] }).shared }));
  app.post('/api/education/tutor-chat', (req, res) => {
    posts.push(req.body);
    if (req.body && req.body.action === 'list') {
      return res.json({ success: true, threads: threads.filter((t) => !req.body.classId || t.classId === req.body.classId) });
    }
    if (req.body && req.body.action === 'get') {
      const hit = threads.find((t) => t.threadId === req.body.threadId);
      return hit ? res.json({ success: true, thread: hit }) : res.status(404).json({ error: 'Not found' });
    }
    if (req.body && req.body.action === 'delete') {
      const idx = threads.findIndex((t) => t.threadId === req.body.threadId);
      if (idx >= 0) threads.splice(idx, 1);
      return res.json({ success: true, deleted: idx >= 0 });
    }
    const tid = req.body.threadId || `00000000-0000-4000-8000-000000000${100 + threads.length}`;
    let existing = threads.find((t) => t.threadId === tid);
    if (!existing) {
      existing = {
        threadId: tid,
        classId: req.body.classId || null,
        title: String(req.body.message || 'Homework question').slice(0, 60),
        firstQuestion: String(req.body.message || 'Homework question'),
        createdAt: '2026-11-06T12:00:00Z',
        updatedAt: '2026-11-06T12:00:00Z',
        messages: [],
      };
      threads.unshift(existing);
    }
    existing.messages.push(
      { role: 'user', content: String(req.body.message || ''), sources: [], createdAt: '2026-11-06T12:00:00Z' },
      { role: 'assistant', content: TABLE_REPLY, sources: [], createdAt: '2026-11-06T12:00:01Z' },
    );
    const delay = /slow/.test(req.body.message || '') ? 600 : 0;
    setTimeout(() => res.json({ response: TABLE_REPLY, grounded: false, sources: [], threadId: tid }), delay);
  });
  app.use((req, res) => (req.method === 'GET' && /\.(css|js|png)$/.test(req.path) && !req.path.startsWith('/dist/')
    ? res.type(path.extname(req.path)).send('') : res.status(404).json({})));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close(), posts }));
  });
}

/** @description Whether the element under a box's centre is the element itself (nothing covers it). */
function uncovered(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel); const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { ok: hit === el || el.contains(hit), box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }, vw: innerWidth, vh: innerHeight };
  }, selector);
}

test('phone: the composer is one row and Send is a 44px target nothing covers', async () => {
  const { base, close } = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
    await page.goto(base + '/api/education/tutor?classId=c-grounded');
    await page.locator('#groundBadge').waitFor();
    assert.equal(await page.getAttribute('body', 'data-lm-assistant'), 'self', 'the page asks the frame to hide the shell orb');
    const send = await uncovered(page, '#sendBtn');
    assert.ok(send.ok, 'nothing sits over Send');
    assert.ok(send.box.w >= 44 && send.box.h >= 44, `Send is ${send.box.w}x${send.box.h}`);
    assert.ok(send.box.right <= send.vw && send.box.bottom <= send.vh, 'Send is on screen');
    const row = await page.evaluate(() => ['plusBtn', 'input', 'micBtn', 'sendBtn'].map((id) => {
      const r = document.getElementById(id).getBoundingClientRect(); return { id, visible: r.width > 0, mid: r.top + r.height / 2 };
    }));
    assert.ok(row.every((c) => c.visible), 'plus, box, mic and Send are all shown');
    assert.ok(Math.max(...row.map((c) => c.mid)) - Math.min(...row.map((c) => c.mid)) < 8, 'one row');
    assert.equal(await page.locator('#camBtn').isVisible(), false, 'camera moves into the + sheet');
    assert.equal(await page.locator('#attachBtn').isVisible(), false, 'file moves into the + sheet');
    assert.equal(await page.$eval('#input', (el) => getComputedStyle(el).fontSize), '16px');
    await page.tap('#plusBtn');
    assert.deepEqual(await page.locator('#attachSheet [role="menuitem"]').allInnerTexts(), ['📷 Camera', '📎 File']);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#attachSheet').isVisible(), false, 'Escape closes the sheet');
    const chips = await page.evaluate(() => {
      const tops = [...document.querySelectorAll('#suggestions .suggestion')].map((b) => Math.round(b.getBoundingClientRect().top));
      return { rows: new Set(tops).size, bottom: document.getElementById('suggestions').getBoundingClientRect().bottom,
        composer: document.querySelector('.tutor-compose').getBoundingClientRect().top };
    });
    assert.equal(chips.rows, 1, 'the starter chips are one sideways row');
    assert.ok(chips.bottom <= chips.composer + 1, 'the chips sit above the composer, not under it');
  } finally {
    await browser.close();
    close();
  }
});

test('the header claims textbook grounding only for a class with materials', async () => {
  const { base, close } = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base + '/api/education/tutor?classId=c-empty');
    await page.locator('#groundBadge').waitFor();
    assert.equal(await page.textContent('#groundBadge'), 'No class materials yet');
    assert.doesNotMatch(await page.textContent('#tutorClass'), /Textbook grounded/);
    await page.selectOption('#classSelect', 'c-grounded');
    await page.waitForFunction(() => document.getElementById('groundBadge')?.textContent === 'Textbook grounded');
    await page.selectOption('#classSelect', '');
    assert.equal(await page.textContent('#tutorClass'), 'Any of your classes');
  } finally {
    await browser.close();
    close();
  }
});

test('a pipe table renders as a table, and New chat clears the thread and drops a late reply', async () => {
  const { base, close, posts } = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
    await page.goto(base + '/api/education/tutor?classId=c-grounded');
    await page.locator('#groundBadge').waitFor();
    await page.tap('#suggestions .suggestion >> nth=1');
    const table = page.locator('#messages .msg.tutor table');
    await table.waitFor();
    assert.deepEqual(await table.locator('th').allInnerTexts(), ['Element', 'Left side', 'Right side']);
    assert.equal(await table.locator('tbody tr').count(), 2);
    assert.equal(await page.locator('#suggestions').isVisible(), false, 'the chips leave once the conversation starts');
    assert.equal(posts[0].classId, 'c-grounded');
    await page.fill('#input', 'slow question');
    await page.tap('#sendBtn');
    await page.locator('#messages .msg.typing').waitFor();
    await page.tap('#newChatBtn');
    assert.equal(await page.locator('#messages .msg').count(), 0, 'New chat clears the thread');
    assert.equal(await page.locator('#welcome').isVisible(), true);
    assert.equal(await page.locator('#suggestions').isVisible(), true, 'the starter chips come back');
    await page.waitForTimeout(900);
    assert.equal(await page.locator('#messages .msg').count(), 0, 'the reply to the cleared conversation is dropped');
    assert.equal(await page.isEnabled('#sendBtn'), true);
  } finally {
    await browser.close();
    close();
  }
});

test('desktop: camera and file stay as buttons, and Read aloud is a toggle in the header ⋯', async () => {
  const { base, close } = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base + '/api/education/tutor');
    await page.locator('#groundBadge').waitFor();
    assert.equal(await page.locator('#plusBtn').isVisible(), false);
    assert.equal(await page.locator('#camBtn').isVisible(), true);
    assert.equal(await page.locator('#ttsToggle').isVisible(), false, 'Read aloud is not in the header row');
    await page.click('#tutorMore summary');
    await page.click('#ttsToggle');
    assert.equal(await page.getAttribute('#ttsToggle', 'aria-pressed'), 'true');
    assert.match(await page.textContent('#ttsToggle'), /On/);
    assert.ok(await page.locator('#newChatBtn').isVisible(), 'New chat sits beside the class picker');
  } finally {
    await browser.close();
    close();
  }
});

test('History button left of New chat saves, restores, continues and deletes tutoring threads (RP-LM-02)', async () => {
  const { base, close, posts } = await serve();
  const browser = await chromium.launch();
  try {
    for (const viewport of [{ width: 412, height: 915 }, { width: 1440, height: 900 }]) {
      const p = await browser.newPage({ viewport });
      await p.goto(base + '/api/education/tutor?classId=c-grounded');
      await p.locator('#groundBadge').waitFor();
      const order = await p.$$eval('.tutor-head > button', (bs) => bs.map((b) => b.id));
      assert.ok(order.indexOf('historyBtn') !== -1 && order.indexOf('historyBtn') + 1 === order.indexOf('newChatBtn'), order.join(','));
      const box = await p.locator('#historyBtn').boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= viewport.width, `History is on screen at ${viewport.width}px`);
      await p.close();
    }

    const page = await browser.newPage({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
    await page.goto(base + '/api/education/tutor?classId=c-grounded');
    await page.locator('#groundBadge').waitFor();
    await page.fill('#input', 'Why do cells divide?');
    await page.tap('#sendBtn');
    await page.locator('#messages .msg.tutor').waitFor();
    await page.tap('#newChatBtn');
    assert.equal(await page.locator('#messages .msg').count(), 0);

    await page.tap('#historyBtn');
    await page.locator('#historyDrawer.is-open').waitFor();
    await page.locator('#historyList .history-row').first().waitFor();
    assert.match(await page.textContent('#historyList'), /Why do cells divide\?/);
    await page.tap('#historyList [data-thread-open]');
    await page.waitForFunction(() => !document.getElementById('historyDrawer').classList.contains('is-open'));
    assert.equal(await page.locator('#messages .msg').count(), 2, 'restored user + tutor messages');

    await page.fill('#input', 'Tell me more about mitosis');
    await page.tap('#sendBtn');
    await page.waitForFunction(() => document.querySelectorAll('#messages .msg').length === 4);
    const followUp = posts.filter((b) => b.message === 'Tell me more about mitosis')[0];
    assert.ok(followUp && followUp.threadId, 'follow-up continues the restored threadId');

    await page.tap('#historyBtn');
    await page.locator('#historyList [data-thread-delete]').waitFor();
    await page.tap('#historyList [data-thread-delete]');
    await page.waitForFunction(() => /No saved conversations yet/.test(document.getElementById('historyList').textContent));
    await page.close();
  } finally {
    await browser.close();
    close();
  }
});
