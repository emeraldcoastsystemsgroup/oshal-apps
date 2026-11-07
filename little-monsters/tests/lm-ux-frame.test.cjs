/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 LM-FRAME and lm-dashboard. On a phone the frame was three rows (brand; More, Level, name; section tabs) above a 290px hero, the floating assistant sat on Send and '=', and 'Record' was clipped at 1440px. Drives the shipped frame in Chromium: at 412x915 ONE top bar of at most 56px whose ⋯ holds All applications first, the signed-in pill, Voice and Teacher; a bottom bar Home · Tutor · Flashcards · Games · More whose sheet lists the other sections; the selected item's 3px bar; the page's bottom reserve (bar + 48 + 16); the hero one line with the work inside 120px; a same-origin host gets --oshal-app-bottom-inset and the Tutor (body[data-lm-assistant="self"]) hides the host assistant until another page opens. At 1440x900 no nav label is clipped (overflow goes into More ▾). Dashboard: Coming up before My classes, no launcher grid, the XP line opens My Monsters, one primary in My classes. Disabled buttons are opaque.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The More sheet ends with the planned control 'Parent summary · Not available yet' (RP-LM-01): aria-disabled, its backlog id, opacity 1, and a tap changes nothing.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The trial door's floating '← All apps' pill (body > .visitor-back) rests above the phone bottom bar instead of covering Home.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Parent summary in the More sheet and desktop More ▾ links to /api/education/dashboard?view=guardian and renders the learner's guardian invite and single-learner summary card (RP-LM-01).
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

const manifest = yaml.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));
/** The ribbon profile the kernel serves an admin: one item per static tab of the shipped manifest. */
const profile = { profile: { ribbon: { items: manifest.ui.static.map((tab) => ({
  id: `tool-${tab.toolName}`, label: tab.label, section: tab.section, toolUi: { iframeUrl: tab.iframeUrl } })) } } };
const PAGES = { '/api/education/dashboard': 'student-dashboard.html', '/api/education/tutor': 'tutor-chat.html',
  '/api/education/presentation': 'presentation.html', '/api/education/citations': 'citations.html' };
const DATA = {
  '/api/ui/profile': profile,
  '/api/education/me': { name: 'admin', role: 'student', email: 'a@example.org', studentId: 's1' },
  '/api/education/rewards': { xp: 45, level: 1, boxes: 0 },
  '/api/education/classes': { classes: [{ class_id: 'c1', name: 'Biology', subject: 'Science' }] },
  '/api/education/student/s1/dashboard': { student: { xp: 45, level: 1, streak_days: 0 }, stats: { flashcardsReviewed: 3, quizAverage: 0 },
    classes: [{ class_id: 'c1', name: 'Biology', teacher_name: 'Ms Rivera', lecture_count: 1, flashcard_count: 4 }],
    upcoming: [1, 2, 3, 4].map((i) => ({ title: `Worksheet ${i}`, due_date: `2026-11-1${i}T12:00:00Z`, class_name: 'Biology' })) },
  '/api/education/student/guardian-summary/dashboard': {
    ownSummary: {
      learnerName: 'admin',
      xp: 45,
      level: 1,
      due: [{ title: 'Worksheet 1', className: 'Biology', dueAt: '2026-11-11T12:00:00Z' }],
      missing: [],
      recentStudy: [{ kind: 'Flashcards', detail: '3 cards studied', occurredAt: '2026-11-06T12:00:00Z' }],
    },
    guardians: [],
    linkedLearners: [],
  },
};

/** @description Serve the shipped pages, a same-origin host page, the stylesheet, the frame and stub data. @returns {Promise<object>} */
function serve() {
  const app = express();
  for (const [route, file] of Object.entries(PAGES)) app.get(route, (_req, res) => res.sendFile(path.join(TOOLS, file)));
  app.get('/host', (req, res) => res.type('html').send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>.visitor-back{position:fixed;left:12px;bottom:12px}</style></head><body style="margin:0"><iframe id="f" src="${String(req.query.src)}" style="border:0;width:100vw;height:100vh"></iframe><a class="visitor-back" href="/">← All apps</a></body></html>`));
  app.get('/api/education/education.css', (_req, res) => res.sendFile(path.join(TOOLS, 'education.css')));
  app.get('/api/education/mascot.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-mascot.js')));
  for (const [route, body] of Object.entries(DATA)) app.get(route, (_req, res) => res.json(body));
  app.use((req, res) => (req.method === 'GET' && /\.(css|js)$/.test(req.path) ? res.type(path.extname(req.path)).send('') : res.status(404).json({})));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}

/** @description Open a page as a phone and wait for the frame. @returns {Promise<object>} page */
async function phone(browser, url) {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  await page.goto(url);
  await page.locator('.lm-topbar[data-lm-ready]').waitFor();
  return page;
}

test('phone frame: one 56px top bar, ⋯ with the way back first, a bottom bar with a More sheet, bottom reserve', async () => {
  const { base, close } = await serve();
  const browser = await chromium.launch();
  try {
    const page = await phone(browser, `${base}/api/education/citations`);
    const bar = await page.locator('.lm-topbar').boundingBox();
    assert.ok(bar.height <= 56, `top bar is ${bar.height}px`);
    assert.equal(await page.locator('.lm-topbar nav').isVisible(), false, 'the section tabs left the top bar');
    assert.equal(await page.locator('.lm-topbar-side > .lm-pill').isVisible(), false);
    await page.locator('.lm-more-phone summary').tap();
    const menu = await page.$$eval('.lm-more-phone .lm-more-menu > *', (els) => els.map((e) => e.textContent.trim()));
    assert.match(menu[0], /All applications/);
    assert.match(menu[1], /admin · student/);
    assert.deepEqual(menu.slice(2), ['Teacher', 'Voice']);
    const bottom = await page.$$eval('.lm-bottombar > a, .lm-bottombar > details > summary', (els) => els.map((e) => e.lastElementChild.textContent.trim()));
    assert.deepEqual(bottom, ['Home', 'Tutor', 'Flashcards', 'Games', 'More']);
    await page.locator('.lm-bottom-more summary').tap();
    const sheet = await page.$$eval('.lm-sheet a', (as) => as.map((a) => a.textContent.trim()));
    assert.deepEqual(sheet.slice(0, 10), ['SAT & ACT', 'My Day', 'My Monsters', 'Record', 'Presentations', 'Timelines', 'STEM Helpers', 'Citations', 'My Files', 'Email']);
    assert.equal(sheet.at(-1), 'Parent summary');
    assert.equal(await page.locator('.lm-sheet [data-ds-not-yet]').count(), 0, 'Parent summary is active, not a planned placeholder');
    const parentHref = await page.locator('.lm-sheet a', { hasText: 'Parent summary' }).getAttribute('href');
    assert.equal(parentHref, '/api/education/dashboard?view=guardian');
    const current = await page.$eval('.lm-bottom-more summary', (s) => ({ on: s.getAttribute('aria-current'), shadow: getComputedStyle(s).boxShadow }));
    assert.equal(current.on, 'page', 'Citations is in the sheet, so More is the selected item');
    assert.match(current.shadow, /0px 3px 0px 0px inset/);
    const pad = await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom));
    assert.ok(pad >= 56 + 48 + 16, `bottom reserve ${pad}px`);
    const work = await page.evaluate(() => document.querySelector('.lm-hero').getBoundingClientRect().bottom);
    assert.ok(work <= 120, `the hero ends at ${work}px; the work must start within 120px`);
    await page.goto(`${base}/api/education/dashboard?view=guardian`);
    await page.locator('#guardianSummarySection').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#guardianEmailInput').isVisible(), true);
    await page.waitForFunction(() => document.getElementById('guardianOwnPreview').textContent.includes('Worksheet 1'));
    assert.match(await page.textContent('#guardianOwnPreview'), /Worksheet 1/);
    await page.close();
  } finally {
    await browser.close();
    close();
  }
});

test('hosted on a phone: the host assistant rests above the bottom bar and the Tutor hides it until another page opens', async () => {
  const { base, close } = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
    await page.goto(`${base}/host?src=${encodeURIComponent('/api/education/tutor')}`);
    const frame = page.frame({ url: /\/api\/education\/tutor/ });
    await frame.locator('.lm-topbar[data-lm-ready]').waitFor();
    const host = () => page.evaluate(() => ({ inset: document.documentElement.style.getPropertyValue('--oshal-app-bottom-inset'),
      hidden: document.documentElement.getAttribute('data-oshal-assistant-hidden') }));
    assert.deepEqual(await host(), { inset: '56px', hidden: 'true' });
    const pill = await page.$eval('.visitor-back', (a) => innerHeight - a.getBoundingClientRect().bottom);
    assert.ok(pill >= 56 + 12, `the trial's "All apps" pill sits ${pill}px above the bottom, over the bottom bar`);
    const moved = page.waitForEvent('framenavigated', (f) => /\/api\/education\/citations/.test(f.url()));
    await page.evaluate(() => { document.getElementById('f').src = '/api/education/citations'; });
    await (await moved).locator('.lm-topbar[data-lm-ready]').waitFor();
    assert.deepEqual(await host(), { inset: '56px', hidden: null }, 'leaving the Tutor gives the assistant back');
  } finally {
    await browser.close();
    close();
  }
});

test('desktop frame: no nav label is clipped at 1440 or 1100px; the overflow sits in More ▾', async () => {
  const { base, close } = await serve();
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 1100]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(`${base}/api/education/citations`);
      await page.locator('.lm-topbar[data-lm-ready]').waitFor();
      const fit = await page.$eval('.lm-topbar nav', (nav) => {
        const box = nav.getBoundingClientRect();
        return { clipped: [...nav.querySelectorAll('a')].filter((a) => a.getBoundingClientRect().right > box.right + 1).map((a) => a.textContent),
          overflow: nav.scrollWidth - nav.clientWidth, spill: [...document.querySelectorAll('.lm-more-desk .lm-spill a')].map((a) => a.textContent) };
      });
      assert.deepEqual(fit.clipped, [], `${width}px: clipped ${fit.clipped}`);
      assert.ok(fit.overflow <= 1, `${width}px: nav overflows by ${fit.overflow}px`);
      if (width === 1100) assert.ok(fit.spill.length > 0, 'at 1100px some sections move into More ▾');
      assert.equal(await page.locator('.lm-bottombar').isVisible(), false, 'no bottom bar on a desktop');
      await page.close();
    }
  } finally {
    await browser.close();
    close();
  }
});

test('dashboard: Coming up first (3 rows), no launcher, the XP line opens My Monsters, one primary in My classes', async () => {
  const { base, close } = await serve();
  const browser = await chromium.launch();
  try {
    const page = await phone(browser, `${base}/api/education/dashboard`);
    await page.locator('#classList .class-card').first().waitFor();
    await page.locator('#upcomingList .lm-item').first().waitFor();
    assert.equal(await page.locator('#upcomingList .lm-item').count(), 3);
    const order = await page.$$eval('main > section:not(.hide) h2', (hs) => hs.map((h) => h.textContent.trim()));
    assert.ok(order.indexOf('Coming up') < order.indexOf('My classes'), order.join(' | '));
    assert.equal(await page.locator('#actions').count(), 0, 'the 9-card launcher is gone');
    assert.match(await page.textContent('#xpLine'), /Level 1 · 45 \/ 100 XP/);
    assert.equal(await page.locator('#xpLine').getAttribute('data-go'), 'monsters');
    const head = page.locator('#classesHeading').locator('xpath=..');
    assert.equal(await head.locator('.lm-btn-primary').count(), 1);
    assert.match(await head.locator('.lm-btn-primary').textContent(), /Create a class/);
    await page.locator('.class-menu summary').first().tap();
    assert.equal(await page.locator('.class-menu[open] button', { hasText: 'Open' }).count(), 1);
    assert.doesNotMatch(await page.textContent('body'), /practise/);
    const disabled = await page.evaluate(() => { const b = document.createElement('button'); b.className = 'lm-btn lm-btn-primary'; b.disabled = true; document.body.append(b); return getComputedStyle(b).opacity; });
    assert.equal(disabled, '1', 'disabled buttons are solid');
    await page.close();
  } finally {
    await browser.close();
    close();
  }
});
