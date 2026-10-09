/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Pilot proof for enterprise authorization in the UI: the ACTUAL Little Monsters pages in headless Chromium over the two-school PostgreSQL fixture and core's real HTTP guard. Each synthetic person gets a disposable browser context; the pages paint only that person's records, a learner never receives the teacher page, an unassigned person gets core's role-guidance page, a tutor deny refuses the Tutor turn from the real page, and a mid-session revocation refuses the teacher's next request and navigation.
 */
/**
 * Isolated fixture evidence, not live acceptance: the session is a loopback header chosen per browser
 * context (see school-postgres.fixture.cjs for everything else that is real or doubled). Requires Docker and
 * Chromium from the framework checkout's Playwright. Every request leaves 127.0.0.1 only through the
 * fixture origin; anything else is aborted and fails the run.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { coreRequire } = require('./fixture.cjs');
const { ID, startSchool } = require('./school-postgres.fixture.cjs');

let env, browser;
const contexts = [];
test.before(async () => {
  env = await startSchool();
  browser = await coreRequire('playwright').chromium.launch({ headless: true });
});
test.after(async () => {
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close();
  await env?.close();
});

/** One disposable browser context per synthetic person; off-origin requests are aborted and recorded. */
async function open(sub, route) {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-fixture-user': sub } });
  contexts.push(context);
  const state = { offOrigin: [], pageErrors: [] };
  await context.route('**/*', item => {
    if (new URL(item.request().url()).origin === env.origin) return item.continue();
    state.offOrigin.push(item.request().url());
    return item.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => state.pageErrors.push(error.message));
  const response = await page.goto(`${env.base}${route}`);
  return { page, response, state };
}

test('a learner\'s dashboard paints only their own record and no teaching overview', async () => {
  const learner = await open('student-a', '/dashboard');
  await learner.page.waitForFunction(() => document.getElementById('quizAvg')?.textContent === '50%');
  await learner.page.waitForFunction(() => document.querySelectorAll('#classList .lm-card').length > 0);
  const classes = await learner.page.locator('#classList').innerText();
  assert.match(classes, /Math A1/); assert.match(classes, /Science A2/); assert.doesNotMatch(classes, /Math B1/);
  assert.equal(await learner.page.locator('#teacherSection').isVisible(), false);
  const peer = await open('peer-a', '/dashboard');
  await peer.page.waitForFunction(() => document.getElementById('quizAvg')?.textContent === '60%');
  await peer.page.waitForFunction(() => document.querySelectorAll('#classList .lm-card').length > 0);
  assert.doesNotMatch(await peer.page.locator('#classList').innerText(), /Science A2/);
  assert.deepEqual([...learner.state.offOrigin, ...peer.state.offOrigin], []);
});

test('a learner never receives the teacher page and an unassigned person gets the role-guidance page', async () => {
  const learner = await open('student-a', '/teacher');
  assert.equal(learner.response.status(), 403);
  const body = await learner.page.locator('body').innerText();
  assert.match(body, /authorization_permission_denied/);
  assert.doesNotMatch(body, /A moment for each learner|student-a|peer-a/);
  const stranger = await open('student-b', '/dashboard');
  assert.equal(stranger.response.status(), 403);
  assert.equal(await stranger.page.locator('h1').innerText(), 'Application role required');
  assert.equal(await stranger.page.locator('#classList, #quizAvg').count(), 0);
});

test('the teacher view lists only the teacher\'s own class, roster and aggregates', async () => {
  const teacher = await open('teacher-a1', '/teacher');
  assert.equal(teacher.response.status(), 200);
  await teacher.page.waitForFunction(() => document.querySelectorAll('#rosterBody tr strong').length > 0);
  assert.deepEqual(await teacher.page.locator('#classGrid .class-tile h3').allInnerTexts(), ['Math A1']);
  assert.deepEqual((await teacher.page.locator('#rosterBody tr strong').allInnerTexts()).sort(), ['peer-a', 'student-a']);
  assert.match(await teacher.page.locator('#summaryRow').innerText(), /70%/);
  const other = await open('teacher-a2', '/teacher');
  await other.page.waitForFunction(() => document.querySelectorAll('#rosterBody tr strong').length > 0);
  assert.deepEqual(await other.page.locator('#classGrid .class-tile h3').allInnerTexts(), ['Science A2']);
  assert.deepEqual(await other.page.locator('#rosterBody tr strong').allInnerTexts(), ['student-a']);
  assert.deepEqual(teacher.state.pageErrors, []);
});

test('an explicit tutor deny refuses the Tutor turn from the real page', async () => {
  await env.change('deny', 'student-a', { permission: 'tutor.execute' });
  const tutor = await open('student-a', `/tutor?classId=${ID.classA1}`);
  assert.equal(tutor.response.status(), 200, 'the page shell is app.open only');
  const refused = tutor.page.waitForResponse(response => response.url().endsWith('/api/education/tutor-chat'));
  await tutor.page.fill('#input', 'Can you check my fraction work?');
  await tutor.page.click('#sendBtn');
  assert.equal((await refused).status(), 403);
  await tutor.page.waitForFunction(() => /couldn't connect/.test(document.querySelector('#messages .msg.tutor:last-child')?.textContent || ''));
  await env.change('clear-deny', 'student-a', { permission: 'tutor.execute' });
});

test('revoking a teacher mid-session refuses the next request and the next navigation', async () => {
  const teacher = await open('teacher-a2', '/teacher');
  await teacher.page.waitForFunction(() => document.querySelectorAll('#rosterBody tr strong').length > 0);
  await env.change('revoke', 'teacher-a2', { role: 'teacher' });
  const refused = teacher.page.waitForResponse(response => response.url().includes('/analytics'));
  await teacher.page.locator('#classGrid .class-tile').first().click();
  assert.equal((await refused).status(), 403);
  await teacher.page.waitForFunction(() => /HTTP 403/.test(document.getElementById('rosterBody')?.textContent || ''));
  assert.equal(await teacher.page.locator('#rosterBody tr strong').count(), 0);
  const reload = await teacher.page.reload();
  assert.equal(reload.status(), 403);
  assert.doesNotMatch(await teacher.page.locator('body').innerText(), /Science A2|student-a/);
});
