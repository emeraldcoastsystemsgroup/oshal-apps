/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (lm-test-prep, SPLIT + FIX-LAYOUT). The page stacked plan, coach, launchers, mastery table and 20+ lessons into ~3,800px, and a timed test kept the 300px hero so the question navigator was cut off with no Exit. Guards, in Chromium over the shipped page with the package's own session model behind a local server: Plan · Practice · Lessons switch and ?view= deep-links; the plan saves on change with no Save button; Plan has one primary; lessons are grouped and searchable; exam mode at 1440x900 and 412x915 hides the hero, frame bars and tabs, keeps a 48px bar on screen and the navigator's last button fully inside the viewport; a failed save shows Save now in the page; Exit saves and returns to Plan.
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
const { catalog, FORMATS, createSession, changeSession, publicSession, research, officialPractice } = require('../routes/education-prep-model');
const { summarize } = require('../routes/education-prep-progress');

const TOOLS = path.join(PKG, 'tools');
const FILES = { '/api/education/test-prep': 'test-prep.html', '/api/education/prep.js': 'test-prep.js', '/api/education/prep.css': 'test-prep.css',
  '/api/education/education.css': 'education.css', '/api/education/mascot.js': 'lm-mascot.js' };
const FRAME = {
  '/api/ui/profile': { profile: { ribbon: { items: [{ id: 'tool-lm-test-prep', label: 'SAT & ACT', toolUi: { iframeUrl: '/api/education/test-prep' } }] } } },
  '/api/education/me': { name: 'Ella Student', role: 'student', email: 'ella@example.org' },
  '/api/education/rewards': { xp: 40, level: 1 },
};

/** @description An in-memory stand-in for the prep store that runs the package's real session model. @returns {object} The state. */
function prepStore() {
  return { profile: { exam: 'SAT', dailyMinutes: 15, testDate: '', lessons: {} }, sessions: new Map(), profileWrites: [], saves: 0, failSaves: false };
}

/** @description The /prep/progress answer, shaped as the route shapes it. @param {object} store The state. @returns {object} The progress. */
function progressOf(store) {
  const rows = [...store.sessions.entries()].map(([session_id, r]) => ({ session_id, state: r.state }));
  const { seen, ...progress } = summarize(rows, store.profile.exam, Date.now(), false);
  return { ...progress, profile: store.profile, active: [], training: [],
    dashboard: { sessions: progress.history.length, activeMinutes: 0, recentAccuracy: null, reviewedPacks: 0 },
    coach: { name: 'Test Prep Coach', message: 'Start with the diagnostic.', topicId: null, tip: null, caution: null } };
}

/** @description Mount the prep JSON routes over the store. @param {object} app Express app. @param {object} store The state. */
function prepRoutes(app, store) {
  app.get('/api/education/prep/catalog', (_q, res) => res.json({ version: catalog.version, lessons: catalog.lessons, formats: FORMATS, research, officialPractice }));
  app.get('/api/education/prep/progress', (_q, res) => res.json(progressOf(store)));
  app.post('/api/education/prep/profile', (req, res) => { store.profileWrites.push(req.body); Object.assign(store.profile, req.body); res.json({ profile: store.profile }); });
  app.post('/api/education/prep/sessions', (req, res) => {
    const id = `00000000-0000-4000-8000-${String(store.sessions.size + 1).padStart(12, '0')}`;
    const state = createSession(req.body, new Set(), ['linear'], Date.now());
    store.sessions.set(id, { state, revision: 1 });
    res.json(publicSession(state, id, 1, Date.now()));
  });
  app.get('/api/education/prep/sessions/:id', (req, res) => { const r = store.sessions.get(req.params.id); res.json(publicSession(r.state, req.params.id, r.revision, Date.now())); });
  app.post('/api/education/prep/sessions/:id', (req, res) => {
    if (store.failSaves) return res.status(503).json({ error: 'Saving is unavailable right now.' });
    const r = store.sessions.get(req.params.id);
    r.state = changeSession(r.state, req.body, Date.now()); r.revision += 1; store.saves += 1;
    return res.json(publicSession(r.state, req.params.id, r.revision, Date.now()));
  });
}

/** @description Serve the shipped page and its data. @returns {Promise<{base:string, store:object, close:Function}>} */
function serve() {
  const store = prepStore(), app = express();
  app.use(express.json());
  for (const [route, file] of Object.entries(FILES)) app.get(route, (_q, res) => res.sendFile(path.join(TOOLS, file)));
  for (const [route, body] of Object.entries(FRAME)) app.get(route, (_q, res) => res.json(body));
  prepRoutes(app, store);
  app.use((req, res) => (req.method === 'GET' && /\.(css|js)$/.test(req.path) ? res.type(path.extname(req.path)).send('') : res.status(404).json({})));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, store, close: () => server.close() }));
  });
}

/** @description Wait until the page has drawn the Plan view. @param {object} page The Playwright page. */
async function ready(page) {
  await page.locator('#prep-focus article').first().waitFor({ state: 'attached' });
  await page.locator('.lm-topbar[data-lm-ready]').waitFor();
}

test('Plan · Practice · Lessons switch, deep-link by ?view=, and the plan saves on change', async () => {
  const { base, store, close } = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base + '/api/education/test-prep');
    await ready(page);
    assert.equal(await page.locator('#prep-view-plan').isVisible(), true);
    assert.equal(await page.locator('#prep-view-lessons').isVisible(), false);
    assert.equal(await page.locator('#prep-view-plan .lm-btn-primary:visible').count(), 1, 'Plan has one primary');
    assert.equal(await page.locator('#prep-view-plan .lm-btn-primary').textContent(), 'Start diagnostic');
    assert.equal(await page.getByRole('button', { name: 'Save plan' }).count(), 0, 'no Save button: the plan saves on change');
    await page.locator('#prep-budget').selectOption('20');
    await page.waitForFunction(() => document.querySelector('#prep-plan-saved').textContent === 'Saved');
    assert.equal(store.profileWrites.at(-1).dailyMinutes, 20);
    await page.getByRole('tab', { name: 'Lessons' }).click();
    assert.match(page.url(), /\?view=lessons$/);
    assert.deepEqual(await page.locator('.prep-lesson-group > h3').allTextContents(), ['Math', 'Reading and Writing']);
    await page.locator('#prep-lesson-search').fill('percent');
    assert.ok(await page.locator('.prep-lesson-card').count() >= 1);
    assert.ok(await page.locator('.prep-lesson-card').count() < 5, 'the search narrows the list');
    await page.goto(base + '/api/education/test-prep?view=practice');
    await ready(page);
    assert.equal(await page.locator('#prep-view-practice').isVisible(), true);
    assert.equal(await page.getByRole('tab', { name: 'Practice' }).getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#prep-view-plan').isVisible(), false);
  } finally {
    await browser.close();
    close();
  }
});

/** @description Measure exam mode: what is hidden, the bar's height, and whether the navigator's last button is on screen. */
async function examGeometry(page) {
  return page.evaluate(() => {
    const map = document.querySelector('.prep-map'); map.scrollLeft = map.scrollWidth;
    const last = map.lastElementChild.getBoundingClientRect(), bar = document.querySelector('#prep-exambar').getBoundingClientRect();
    const exit = [...document.querySelectorAll('#prep-exambar button')].find((b) => b.textContent === 'Exit').getBoundingClientRect();
    const shown = (sel) => [...document.querySelectorAll(sel)].some((e) => e.getClientRects().length && getComputedStyle(e).display !== 'none');
    return { exam: document.body.classList.contains('exam-mode'), bar: bar.height, barTop: bar.top, exitRight: exit.right,
      last: { left: last.left, right: last.right, top: last.top, bottom: last.bottom }, w: innerWidth, h: innerHeight,
      page: document.documentElement.scrollWidth, hero: shown('.lm-hero'), topbar: shown('.lm-topbar'), bottombar: shown('.lm-bottombar'), tabs: shown('.prep-tabs') };
  });
}

for (const [width, height] of [[1440, 900], [412, 915]]) {
  test(`exam mode at ${width}x${height}: no hero or frame bars, a 48px bar, the whole navigator on screen, Exit returns to Plan`, async () => {
    const { base, store, close } = await serve();
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600 });
      await page.goto(base + '/api/education/test-prep');
      await ready(page);
      await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<nav class="lm-bottombar">Home Tutor Flashcards Games More</nav>'));
      await page.locator('[data-start="diagnostic"]').click();
      await page.getByRole('heading', { name: 'Question 1 of 18' }).waitFor();
      const g = await examGeometry(page);
      assert.equal(g.exam, true);
      assert.deepEqual([g.hero, g.topbar, g.bottombar, g.tabs], [false, false, false, false], 'hero, frame bars and tabs hidden');
      assert.ok(g.bar <= 48 && g.barTop === 0, `exam bar ${g.bar}px at ${g.barTop}`);
      assert.ok(g.exitRight <= g.w, 'Exit on screen');
      assert.ok(g.last.left >= 0 && g.last.right <= g.w && g.last.top >= 0 && g.last.bottom <= g.h, `last navigator button inside ${JSON.stringify(g)}`);
      assert.ok(g.page <= g.w, 'no sideways scroll');
      await page.locator('.prep-choice').first().click();
      await page.waitForFunction(() => document.querySelector('#prep-saved').textContent === 'Saved');
      store.failSaves = true;
      await page.locator('.prep-choice').nth(1).click();
      await page.getByRole('button', { name: 'Save now', exact: true }).waitFor();
      assert.equal(await page.locator('#prep-saved').textContent(), 'Not saved');
      store.failSaves = false;
      await page.getByRole('button', { name: 'Save now', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#prep-saved').textContent === 'Saved');
      const saves = store.saves;
      await page.getByRole('button', { name: 'Exit', exact: true }).click();
      await page.locator('#prep-view-plan').waitFor();
      assert.ok(store.saves > saves, 'Exit saves first');
      assert.equal(await page.evaluate(() => document.body.classList.contains('exam-mode')), false);
      assert.equal(await page.locator('#prep-exambar').isVisible(), false);
      assert.equal(await page.locator('.lm-hero').isVisible(), true);
      assert.doesNotMatch(page.url(), /session=/);
    } finally {
      await browser.close();
      close();
    }
  });
}
