/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (lm-myday). My Day stacked eight sections that repeated the dashboard and pushed Due today below the fold, a student could not add a task although POST /calendar exists, and the week strip's days were <span role=button>. Drives the shipped page in Chromium against stubbed routes: Due today is the first section, '+ Add to my day' POSTs the lm-add-reminder body, only the person's own item offers ⋯ Remove (DELETE /calendar/:eventId), the calendar's days are real buttons with aria-pressed in both Week and Month, and My classes / Quick actions are gone.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The week's day buttons are measured once the calendar has redrawn after the save: under the store gate's load the measurement caught the rebuild (0px) and failed once.
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

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const OWN_ID = '6f0c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f';

/** @description Serve My Day with the routes it reads, recording the writes it makes. @returns {Promise<object>} */
function serve() {
  const writes = [];
  const app = express();
  app.use(express.json());
  app.get('/api/education/my-day', (_req, res) => res.sendFile(path.join(TOOLS, 'my-day.html')));
  app.get('/api/education/education.css', (_req, res) => res.sendFile(path.join(TOOLS, 'education.css')));
  app.get('/api/education/mascot.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-mascot.js')));
  app.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: [] } } }));
  app.get('/api/education/me', (_req, res) => res.json({ name: 'Ella Student', role: 'student', studentId: 's1' }));
  app.get('/api/education/classes', (_req, res) => res.json({ classes: [{ class_id: 'c1', name: 'Biology' }] }));
  app.get('/api/education/assignments', (_req, res) => res.json({ assignments: [{ title: 'Teacher essay', class_name: 'Biology', due_date: TODAY, assignment_type: 'homework' }] }));
  app.get('/api/education/calendar', (_req, res) => res.json({ events: [
    { event_id: OWN_ID, student_id: 's1', title: 'My own reminder', event_date: TODAY, event_type: 'reminder' },
    { event_id: 'class-row', student_id: null, title: 'Teacher essay', class_name: 'Biology', event_date: TODAY, event_type: 'assignment' },
  ] }));
  app.post('/api/education/calendar', (req, res) => { writes.push({ method: 'POST', body: req.body }); res.status(201).json({ eventId: '11111111-2222-4333-8444-555555555555' }); });
  app.delete('/api/education/calendar/:eventId', (req, res) => { writes.push({ method: 'DELETE', id: req.params.eventId }); res.json({ eventId: req.params.eventId }); });
  app.use((req, res) => (req.method === 'GET' && /\.(css|js)$/.test(req.path) ? res.type(path.extname(req.path)).send('') : res.status(404).json({})));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, writes, close: () => server.close() }));
  });
}

test('My Day: Due today first, Add to my day saves, own items remove, days are real buttons', async () => {
  const { base, writes, close } = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
    page.on('dialog', (d) => d.dismiss());
    await page.goto(`${base}/api/education/my-day`);
    await page.waitForSelector('#dueToday .lm-item');
    const heads = await page.locator('main .lm-section h2').allTextContents();
    assert.equal(heads[0], 'Due today', `first section is Due today (${heads.join(' | ')})`);
    assert.equal(heads.includes('My classes'), false);
    assert.equal(heads.includes('Quick actions'), false);
    assert.equal(await page.locator('#addToDayBtn.lm-btn-primary').count(), 1);
    assert.equal(await page.locator('main .lm-btn-primary').count(), 1, 'Add to my day is the one primary');

    // Teacher due date: no ⋯. The person's own item: ⋯ Remove → DELETE /calendar/:eventId.
    const teacher = page.locator('#dueToday .lm-item', { hasText: 'Teacher essay' });
    const own = page.locator('#dueToday .lm-item', { hasText: 'My own reminder' });
    assert.equal(await teacher.locator('.row-menu').count(), 0);
    assert.equal(await own.locator('input[type="checkbox"]').count(), 1, 'Due today is a checklist');
    await own.locator('summary').click();
    await own.locator('[data-remove]').click();
    await page.waitForFunction(() => document.querySelector('#lm-toast') && /Removed/.test(document.querySelector('#lm-toast').textContent));
    assert.deepEqual(writes.filter((w) => w.method === 'DELETE'), [{ method: 'DELETE', id: OWN_ID }]);

    // Add to my day: the lm-add-reminder body.
    await page.click('#addToDayBtn');
    assert.equal(await page.inputValue('#addDate'), TODAY);
    await page.fill('#addTitle', 'Study for the quiz');
    await page.fill('#addTime', '15:30');
    await page.selectOption('#addType', 'study-session');
    await page.click('#addSave');
    await page.waitForFunction(() => !document.getElementById('addSheet').classList.contains('is-open'));
    assert.deepEqual(writes.filter((w) => w.method === 'POST').map((w) => w.body),
      [{ title: 'Study for the quiz', eventDate: TODAY, eventType: 'study-session', eventTime: '15:30' }]);

    // One calendar: Week shows 7 real day buttons, Month every day of the month; no span role=button anywhere.
    const cells = () => page.locator('#calGrid .cal-cell:not(.is-empty)');
    // The calendar redraws after the save; measure the drawn week, not the moment it is rebuilt (the gate saw 0px under load).
    await page.waitForFunction(() => {
      const els = [...document.querySelectorAll('#calGrid .cal-cell:not(.is-empty)')];
      return els.length === 7 && els.every((e) => e.getBoundingClientRect().height > 0);
    }, null, { timeout: 10000 });
    assert.equal(await cells().count(), 7);
    const shapes = await cells().evaluateAll((els) => els.map((e) => ({ tag: e.tagName, pressed: e.getAttribute('aria-pressed'), h: e.getBoundingClientRect().height })));
    for (const c of shapes) { assert.equal(c.tag, 'BUTTON'); assert.ok(c.pressed === 'true' || c.pressed === 'false'); assert.ok(c.h >= 44, `day cell ${c.h}px tall`); }
    await page.click('.cal-mode [data-mode="month"]');
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    assert.equal(await cells().count(), days);
    await cells().first().click();
    assert.equal(await cells().first().getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[role="button"]').count(), 0);
    assert.match(await page.textContent('.glance'), /Minutes on this page today/);
    assert.doesNotMatch(await page.textContent('main'), /not sent anywhere|counts the minutes this page is open/);
  } finally {
    await browser.close();
    close();
  }
});
