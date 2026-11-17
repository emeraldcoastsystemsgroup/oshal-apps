/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Study opens the chosen set (Roger's phone, 2026-11-16): on Flashcards, Study on a set opened "No flashcards yet. Pick a set in My flashcards" and its only button went back to the list, in circles. The page asks GET /flashcards/sets/:setId/cards?includePrefs=1; the route read the learner's Shuffle/Term-first choice from lm_flashcard_study_prefs in the same request, and the installation's relationship policy (installed before 1.9.0 added that table) refuses any SQL on it ("refused: SQL table is outside installed relationship policy"), so the route answered 500 for the whole request and the page showed a failed read as "no cards". Drives the shipped hub and study pages in Chromium at 412x915 over the REAL compiled flashcard route (education-study-flashcard-routes.js) with a pool that refuses that table exactly as the kernel does: Study shows the set's first card, the card flips to its back, Got it! moves to the next card, and ← My flashcards returns to the list. A set whose read fails says so and Try again opens it. The class page's Topic Study Pack refreshes the class's sets with the function that exists (it called loadFlashcards, which is not defined, and reported a saved pack as failed) and its Study Flashcards link opens the new set.
 * -----------------------------------------------------------------------------
 *
 * Needs the store toolchain (express, playwright, chromium). The kernel's SQL interpreter is replaced by a pool
 * double at the statement level; the live companion is tests/live/flashcard-study-live.cjs, the same walk read-only
 * on a running kernel as a learner in the installation's tenant (it failed there on 1.9.2 with the 500 above).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const TOOLS = path.join(PKG, 'tools');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

/** The refusal the kernel answers for a statement on a table its installed relationship policy does not list. */
const POLICY_REFUSAL = 'refused: SQL table is outside installed relationship policy';
const ISSUER = 'urn:test:issuer';
const SUBJECT = 'learner-a';
const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STUDENT = '10000000-0000-4000-8000-000000000001';
const CLASS_ID = '30000000-0000-4000-8000-000000000001';
const SET_ID = '40000000-0000-4000-8000-000000000001';
const LECTURE_ID = '60000000-0000-4000-8000-000000000001';
const SET_TITLE = 'Lecture: Energy and Motion Study Pack';
const CARDS = [
  { card_id: '50000000-0000-4000-8000-000000000001', front: 'Kinetic energy', back: 'The energy an object has because it moves', difficulty: 1 },
  { card_id: '50000000-0000-4000-8000-000000000002', front: 'Potential energy', back: 'Energy stored by an object because of where it is', difficulty: 2 },
  { card_id: '50000000-0000-4000-8000-000000000003', front: 'Work', back: 'A force moving something through a distance', difficulty: 2 },
];
const STUDENT_ROW = { student_id: STUDENT, email: null, name: 'Learner A', role: 'student', tenant_id: TENANT, external_id: SUBJECT, external_issuer: ISSUER };
const CLASS_ROW = { class_id: CLASS_ID, name: 'Physics', subject: 'Physics', teacher_student_id: STUDENT, tenant_id: TENANT, status: 'active' };
const SET_ROW = { set_id: SET_ID, class_id: CLASS_ID, title: SET_TITLE, topic: 'Physics', source_type: 'lecture', source_reference: null, card_count: CARDS.length, created_at: '2026-11-16T16:00:00Z', class_name: 'Physics' };

const appLog = { errors: [] };
const STUBS = {
  express,
  '@/shared/logger': {
    createChildLogger: (bindings) => ({
      info() {}, warn() {}, debug() {},
      error(fields, message) { appLog.errors.push({ module: bindings && bindings.module, message, err: fields && fields.err ? String(fields.err.message || fields.err) : '' }); },
    }),
  },
};
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return originalLoad.call(this, request, ...rest);
};
const { createEducationStudyFlashcardRoutes } = require(path.join(PKG, 'routes', 'education-study-flashcard-routes.js'));
process.once('exit', () => { Module._load = originalLoad; });

function rows(list) { return { rows: list, rowCount: list.length }; }

/**
 * @description A pool double for the statements the flashcard route sends on the native kernel. Any statement naming
 *   lm_flashcard_study_prefs is refused with the kernel's own words, as an installation whose relationship policy
 *   predates that table answers it.
 * @param {object} options failCardReads: how many card reads fail first with a database error.
 * @returns {object} The pool and the statements it saw.
 */
function policyPool({ failCardReads = 0 } = {}) {
  const seen = [];
  let cardFailures = failCardReads;
  const pool = {
    storageModel: 'kernel-scoped-documents',
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      seen.push(s.slice(0, 70));
      if (/lm_flashcard_study_prefs/.test(s)) throw new Error(POLICY_REFUSAL);
      if (/FROM lm_students WHERE external_issuer = \$1 AND external_id = \$2/.test(s)) {
        return rows(params[0] === ISSUER && params[1] === SUBJECT ? [STUDENT_ROW] : []);
      }
      if (/FROM lm_enrollments e JOIN lm_classes c ON c\.class_id = e\.class_id/.test(s)) {
        return rows(params[0] === STUDENT && params[1] === CLASS_ID && params[2] === TENANT ? [{ allowed: 1 }] : []);
      }
      if (/^SELECT fs\.set_id, fs\.class_id, fs\.title/.test(s)) {
        return rows(/fs\.class_id = \$1 AND/.test(s) && params[0] !== CLASS_ID ? [] : [SET_ROW]);
      }
      if (/^SELECT fs\.set_id AS authorized_set_id/.test(s)) {
        if (cardFailures > 0) { cardFailures -= 1; throw new Error('connection reset by the database'); }
        return rows(params[0] === SET_ID ? CARDS.map((card) => ({ authorized_set_id: SET_ID, set_id: SET_ID, card_type: 'concept', topic: 'Physics', hints: [], created_at: null, ...card })) : []);
      }
      if (/^SELECT fs\.set_id FROM lm_flashcard_sets fs/.test(s)) return rows(params[0] === SET_ID ? [{ set_id: SET_ID }] : []);
      throw new Error(`statement the fixture does not know: ${s.slice(0, 90)}`);
    },
  };
  return { pool, seen };
}

/**
 * @description Serve the shipped hub, study and class pages with a signed-in learner, the real compiled flashcard
 *   route over the policy pool, and stubs for the routes these pages only touch on the way.
 * @param {object} options Pool options.
 * @returns {Promise<object>} The server's base address, close(), and the calls it answered.
 */
function serve(options = {}) {
  const { pool, seen } = policyPool(options);
  const app = express();
  const calls = [];
  app.use(express.json());
  app.use((req, res, next) => {
    res.on('finish', () => calls.push(`${req.method} ${req.originalUrl} ${res.statusCode}`));
    req.oidc = { isAuthenticated: () => true, user: { sub: SUBJECT, name: 'Learner A' }, idTokenClaims: { iss: ISSUER } };
    next();
  });
  const page = (file) => (_req, res) => res.sendFile(path.join(TOOLS, file));
  app.get('/api/education/flashcards-hub', page('flashcard-hub.html'));
  app.get('/api/education/flashcards', page('flashcard-study.html'));
  app.get('/api/education/class', page('class-view.html'));
  app.get('/api/education/education.css', page('education.css'));
  app.get('/api/education/mascot.js', page('lm-mascot.js'));
  app.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: [] } } }));
  app.get('/api/education/me', (_req, res) => res.json({ name: 'Learner A', role: 'student', studentId: STUDENT }));
  app.get('/api/education/rewards', (_req, res) => res.json({ xp: 10, level: 1 }));
  app.get('/api/education/classes', (_req, res) => res.json({ classes: [CLASS_ROW] }));
  app.post('/api/education/flashcards/review', (_req, res) => res.json({ success: true, nextReview: '2026-11-17', interval: 1, easeFactor: 2.5 }));
  app.post('/api/education/xp', (_req, res) => res.json({ xpAwarded: 0 }));
  app.post('/api/education/process-transcript', (_req, res) => res.json({
    lectureId: LECTURE_ID, flashcardSetId: SET_ID, notes: 'Energy is never made or lost; it changes form.',
    slides: [{ title: 'Energy' }, { title: 'Work' }], flashcards: CARDS.map(({ front, back }) => ({ front, back })),
  }));
  app.use('/api/education', createEducationStudyFlashcardRoutes({ pool }));
  app.use((req, res) => {
    if (req.method !== 'GET') return res.status(404).json({});
    if (/\.(css|js)$/.test(req.path)) return res.type(path.extname(req.path)).send('');
    if ((req.get('accept') || '').includes('text/html')) return res.type('html').send('<!doctype html><title>elsewhere</title>');
    return res.json({});
  });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close(), calls, seen }));
  });
}

/** @description A phone page that collects page errors and fails the test on any native dialog. @returns {Promise<object>} */
async function phone(browser, url) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  page.pageErrors = [];
  page.on('pageerror', (error) => page.pageErrors.push(String(error.message)));
  page.on('dialog', (d) => { d.dismiss(); throw new Error(`native dialog: ${d.message()}`); });
  await page.goto(url);
  await page.locator('.lm-topbar[data-lm-ready]').waitFor();
  return page;
}

/** @description Wait until the study page has either shown a card or put a message in its place. */
async function settled(page) {
  await page.waitForFunction(() => document.getElementById('cardFront').textContent !== 'Loading…'
    || !document.getElementById('emptyState').classList.contains('hide'));
}

test('Study on a set opens its first card, the card flips, Got it! moves on, and ← My flashcards returns to the list', async () => {
  appLog.errors.length = 0;
  const srv = await serve();
  const browser = await chromium.launch();
  try {
    const page = await phone(browser, `${srv.base}/api/education/flashcards-hub`);
    await page.locator('.set-card').first().waitFor();
    assert.match(await page.textContent('.set-card h3'), /Energy and Motion/);
    await page.locator('.set-card [data-act="study"]').first().tap();
    await page.waitForURL((url) => url.pathname === '/api/education/flashcards' && url.searchParams.get('setId') === SET_ID);
    await page.locator('.lm-topbar[data-lm-ready]').waitFor();
    await settled(page);

    assert.equal(await page.isHidden('#emptyState'), true, `the chosen set opened, not "${(await page.textContent('#emptyState')).replace(/\s+/g, ' ').trim()}"`);
    assert.equal(await page.textContent('#cardFront'), CARDS[0].front, 'Study shows the set\'s first card');
    assert.equal(await page.textContent('#deckTitle'), `${SET_TITLE} — 3 cards`);
    assert.equal(await page.textContent('#progressText'), '0/3');
    assert.ok(srv.calls.includes(`GET /api/education/flashcards/sets/${SET_ID}/cards?includePrefs=1 200`),
      `the cards read answers 200 while the preferences table is refused: ${srv.calls.filter((c) => c.includes('/cards')).join(', ')}`);
    assert.ok(appLog.errors.some((e) => e.err === POLICY_REFUSAL), 'the refused preferences read is logged, not swallowed');

    await page.locator('#cardContainer').tap();
    await page.waitForFunction(() => document.getElementById('cardInner').classList.contains('flipped'));
    assert.equal(await page.textContent('#cardBack'), CARDS[0].back);
    assert.equal(await page.getAttribute('#cardBackFace', 'aria-hidden'), 'false');
    assert.equal(await page.isVisible('#answerBtns'), true, 'the answer buttons show after the flip');

    await page.locator('#answerBtns .lm-btn-success').tap();
    await page.waitForFunction((front) => document.getElementById('cardFront').textContent === front, CARDS[1].front);
    assert.equal(await page.getAttribute('#cardBackFace', 'aria-hidden'), 'true', 'the next card starts face up');
    assert.equal(await page.textContent('#progressText'), '1/3');

    await page.locator('main a.lm-btn-quiet', { hasText: 'My flashcards' }).tap();
    await page.waitForURL((url) => url.pathname === '/api/education/flashcards-hub');
    await page.locator('.set-card [data-act="study"]').first().waitFor();
    assert.deepEqual(page.pageErrors, []);
    await page.context().close();
  } finally {
    await browser.close();
    srv.close();
  }
});

test('a set whose read fails says so and offers Try again instead of the "Pick a set" screen; Try again opens it', async () => {
  appLog.errors.length = 0;
  const srv = await serve({ failCardReads: 1 });
  const browser = await chromium.launch();
  try {
    const page = await phone(browser, `${srv.base}/api/education/flashcards?setId=${SET_ID}`);
    await settled(page);
    const shown = (await page.textContent('#emptyState')).replace(/\s+/g, ' ').trim();
    assert.match(shown, /could not be opened/i, `a failed read is not "no cards": ${shown}`);
    assert.doesNotMatch(shown, /No flashcards yet|Pick a set/);
    assert.equal(await page.isVisible('#retryBtn'), true, 'Try again is offered');
    assert.equal(await page.locator('#emptyActions a[href="/api/education/flashcards-hub"]').count(), 1, 'the way back to the list stays');

    await page.locator('#retryBtn').tap();
    await page.waitForFunction((front) => document.getElementById('cardFront').textContent === front, CARDS[0].front);
    assert.equal(await page.isHidden('#emptyState'), true);
    assert.equal(await page.isVisible('#cardContainer'), true);
    assert.deepEqual(page.pageErrors, []);
    await page.context().close();
  } finally {
    await browser.close();
    srv.close();
  }
});

test('the class page\'s Topic Study Pack reports the saved pack, refreshes the class\'s sets, and its Study Flashcards link opens the set', async () => {
  appLog.errors.length = 0;
  const srv = await serve();
  const browser = await chromium.launch();
  try {
    const page = await phone(browser, `${srv.base}/api/education/class?classId=${CLASS_ID}`);
    // A repeated read may come back 304 (the browser revalidates its copy), so count the request, not its status.
    const setReads = () => srv.calls.filter((c) => c.startsWith(`GET /api/education/flashcards/sets?classId=${CLASS_ID} `)).length;
    await page.waitForFunction(() => document.getElementById('fcCount').textContent === '1');
    const before = setReads();
    await page.fill('#clsTopicInput', 'Conservation of energy');
    await page.locator('#clsTopicBtn').tap();
    await page.waitForFunction(() => !document.getElementById('clsTopicBtn').disabled);
    const status = (await page.textContent('#clsTopicStatus')).trim();
    assert.deepEqual(page.pageErrors, [], 'no script error after the pack is saved');
    assert.match(status, /^✨ Study Pack ready!/, `the saved pack is reported as saved: ${status}`);
    for (let i = 0; i < 40 && setReads() <= before; i += 1) await page.waitForTimeout(50);
    assert.equal(setReads(), before + 1, 'the class\'s flashcard sets are read again after the pack');

    await page.locator('#clsTopicResult a', { hasText: 'Study Flashcards' }).tap();
    await page.waitForURL((url) => url.pathname === '/api/education/flashcards' && url.searchParams.get('setId') === SET_ID && url.searchParams.get('classId') === CLASS_ID);
    await page.locator('.lm-topbar[data-lm-ready]').waitFor();
    await settled(page);
    assert.equal(await page.textContent('#cardFront'), CARDS[0].front, 'the generated set opens on its first card');
    assert.deepEqual(page.pageErrors, []);
    await page.context().close();
  } finally {
    await browser.close();
    srv.close();
  }
});
