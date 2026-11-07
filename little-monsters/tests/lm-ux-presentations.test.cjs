/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (lm-presentations, grade F). The class picker stayed on 'Loading classes…' because showPicker() filled #presClass and then the no-lectures branch rewrote the whole card, so Generate always answered 'Please select a class first.' Drives the shipped page in Chromium with one or more classes and NO saved lectures (the exact failing shape), asserts the select lists the classes after every render step, and that Generate deck sends POST /api/education/process-transcript with the chosen class. Also: a failed class read shows "Couldn't load your classes" with Retry, and Retry fills the picker; the picker has no Close and the student empty state says 'Make your first deck above'.
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

const CLASSES = [
  { class_id: 'c1', name: 'Biology', subject: 'Science' },
  { class_id: 'c2', name: 'Algebra I', subject: 'Math' },
];

/**
 * @description Serve the shipped page with a student identity, classes and an empty lecture list.
 * @param {{classesFailFirst?: boolean}} opts When set, the first class read answers 500 (Retry case).
 * @returns {Promise<{base:string, close:Function, posts:Array<object>}>} The server and the POST bodies it received.
 */
function serve(opts = {}) {
  const app = express();
  const posts = [];
  let classReads = 0;
  app.use(express.json());
  app.get('/api/education/presentation', (_req, res) => res.sendFile(path.join(TOOLS, 'presentation.html')));
  app.get('/api/education/education.css', (_req, res) => res.sendFile(path.join(TOOLS, 'education.css')));
  app.get('/api/education/mascot.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-mascot.js')));
  app.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: [] } } }));
  app.get('/api/education/me', (_req, res) => res.json({ name: 'Ella', role: 'student', studentId: 's1' }));
  app.get('/api/education/rewards', (_req, res) => res.json({ xp: 10, level: 1 }));
  app.get('/api/education/classes', (_req, res) => {
    classReads += 1;
    if (opts.classesFailFirst && classReads === 1) return res.status(500).json({ error: 'down' });
    // Answer late, so the class list lands BEFORE the lecture list's empty-state render (the failing order).
    return res.json({ classes: CLASSES });
  });
  app.get('/api/education/lectures/recent', (_req, res) => setTimeout(() => res.json({ lectures: [] }), 150));
  app.post('/api/education/process-transcript', (req, res) => { posts.push(req.body); res.status(503).json({ error: 'stub' }); });
  app.use((req, res) => (req.method === 'GET' && /\.(css|js)$/.test(req.path) ? res.type(path.extname(req.path)).send('') : res.status(404).json({})));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close(), posts }));
  });
}

/** @description The option values the class select offers right now. @returns {Promise<string[]>} */
function optionValues(page) {
  return page.$$eval('#presClass option', (os) => os.map((o) => o.value));
}

test('presentations: with classes and no lectures the picker stays filled and Generate deck posts the chosen class', async () => {
  const srv = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
    await page.goto(`${srv.base}/api/education/presentation`);
    await page.waitForSelector('.pres-list .lm-empty');
    assert.deepEqual(await optionValues(page), ['c1', 'c2'], 'the empty-state render must not reset the filled select');
    assert.match(await page.textContent('.pres-list'), /Make your first deck above/);
    assert.equal(await page.getByText('Back to my dashboard').count(), 0);
    assert.equal(await page.locator('#closeBtn').isVisible(), false, 'the picker is not a modal: no Close');
    assert.match(await page.textContent('.pres-gen h3'), /^New presentation$/);
    const btn = await page.locator('#presGenBtn').boundingBox();
    assert.ok(btn.x + btn.width <= 412, `Generate deck runs off a 412px screen (${btn.x}+${btn.width})`);
    assert.equal((await page.textContent('#presGenBtn')).trim(), '✨ Generate deck');

    await page.selectOption('#presClass', 'c2');
    await page.fill('#presTopic', 'Photosynthesis');
    await page.click('#presGenBtn');
    await page.waitForFunction(() => /Could not generate/.test(document.getElementById('presGenStatus').textContent));
    assert.deepEqual(srv.posts, [{ classId: 'c2', topic: 'Photosynthesis', title: 'Topic: Photosynthesis' }]);
    assert.doesNotMatch(await page.textContent('#presGenStatus'), /select a class first/);
  } finally {
    await browser.close();
    srv.close();
  }
});

test('presentations: a failed class read says so with Retry, and Retry fills the picker', async () => {
  const srv = await serve({ classesFailFirst: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${srv.base}/api/education/presentation`);
    await page.waitForSelector('#presClassProblem:not(.hide)');
    assert.match(await page.textContent('#presClassProblem'), /Couldn’t load your classes/);
    assert.ok(errors.some((t) => /class list could not be loaded/.test(t)), 'the failure is logged, not swallowed');
    await page.click('#presClassRetry');
    await page.waitForFunction(() => document.querySelectorAll('#presClass option[value="c1"]').length === 1);
    assert.equal(await page.locator('#presClassProblem').isVisible(), false);
    assert.deepEqual(await optionValues(page), ['c1', 'c2']);
  } finally {
    await browser.close();
    srv.close();
  }
});
