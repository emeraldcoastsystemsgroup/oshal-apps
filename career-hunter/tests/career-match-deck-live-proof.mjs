#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.69.0 (career-hunter backlog, "The Discover swipe deck as the Job Board's phone layout"). The check of the phone deck of New matches on an installed Career, on a test slot, as a test person. `person` makes a test person with a made-up résumé and made-up target titles and has Career score a few public openings for them, so the person has real matches (Career reads the résumé and scores with the slot's model, several minutes). `check` signs in as that person on the slot's own sign-in page. At 412x915 with touch it opens My jobs, presses New matches, and on the person's own matches presses Pass, Undo, Save, Undo and More, swipes a card right and undoes that, reading the job back from Career after every step; then it opens /api/career-hunter/mobile and expects the same deck. At 1440x900 it expects the list the stage has always been, with Save and Not interested on each row and no card. It writes screenshots and a JSON receipt and leaves every job as it found it. Every request that is not a read, the sign-in or one of the four moves of the jobs the check holds is stopped and listed, and so is a read that would make Career fetch an employer's page. `remove` takes the person's role back and deactivates them.
 *
 * Usage (a loopback kernel only; the administrator credential is read by name from the env file and never printed, the
 * person's credential stays in its 0600 file and is typed only into the slot's own sign-in page; all three refuse port 38788):
 *   node career-hunter/tests/career-match-deck-live-proof.mjs person http://127.0.0.1:38798 <slot env file> <person file>
 *   node career-hunter/tests/career-match-deck-live-proof.mjs check  http://127.0.0.1:38798 <person file> <out folder>
 *   node career-hunter/tests/career-match-deck-live-proof.mjs remove http://127.0.0.1:38798 <slot env file> <person file>
 * Playwright comes from STORE_CI_TOOLCHAIN or the store's scripts/toolchain (npm ci --prefix scripts/toolchain).
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { playwright } from './helpers/ux-page.mjs';

const MY_JOBS = '/cockpit/?app=career-hunter&screen=career-board';
const BOARD = /\/api\/career-hunter\/board-native/;
const JOBS = '/api/career-hunter/jobs';
const MATCHES = `${JOBS}?matches=1&sort=posted&per=25&page=1`;
const DECK_SCRIPT = '/api/career-hunter/static/career-match-deck.js';
/** The four moves the deck makes, as the bodies of POST /jobs/:id/status. Nothing else is let through. */
const MOVES = ['{"status":"dismissed"}', '{"status":"new"}', '{"favorite":true}', '{"favorite":false}'];
const NEEDED = 4, SCORE_LIMIT = 8;
const TITLES = ['Operations Manager', 'Office Manager', 'Project Coordinator'];
const RESUME = `Sam Example
Operations manager | Sampletown, USA | sam.example@example.com
SUMMARY
Runs offices and operations teams (a made-up résumé for a test).
EXPERIENCE
Operations Manager, Sample Freight, 2019-01 to 2024-06
- Ran scheduling, vendors and a team of eight.
Office Manager, Northwind Logistics, 2014-01 to 2018-12
- Kept the office, its budget and its suppliers running.
SKILLS
Scheduling, Vendor management, Budgeting, Microsoft Excel
EDUCATION
B.A. Business Administration, Sample State University, 2013
`;

const say = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const message = (error) => String((error && error.message) || error).split('\n')[0].slice(0, 300);

/** @description The loopback test slot's origin, or a refusal (never production's port). @param {string} base An address. @returns {string} */
function testSlot(base) {
  const origin = new URL(String(base || '')).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('this proof runs only against a loopback kernel, http://127.0.0.1:<port>');
  if (new URL(origin).port === '38788') throw new Error('this proof writes; it runs on the test slot (http://127.0.0.1:38798), never on production');
  return origin;
}

/** @description The administrator credential from an env file, by name; never printed. @param {string} file The env file. @returns {string} */
function adminToken(file) {
  const line = fs.readFileSync(file, 'utf8').split('\n').find((value) => value.startsWith('OSHAL_ADMIN_TOKEN='));
  if (!line) throw new Error('the env file names no OSHAL_ADMIN_TOKEN');
  return line.slice('OSHAL_ADMIN_TOKEN='.length).trim().replace(/^(['"])(.*)\1$/, '$2');
}

/** @description A JSON file only this user can read. @param {string} file Where. @param {object} value What. @returns {void} */
function privateWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/**
 * @description One request to the kernel's own origin; a failure names the method, the route and the status, nothing else.
 * @param {string} origin The kernel. @param {string} credential A bearer or ''. @param {string} method The method.
 * @param {string} route The path. @param {object} [options] body (JSON), form (FormData), accepted statuses, headers.
 * @returns {Promise<{status:number,body:any}>} The status and the parsed answer.
 */
async function http(origin, credential, method, route, { body, form, accepted = [200], headers = {} } = {}) {
  const url = new URL(route, origin);
  if (url.origin !== origin) throw new Error('refusing a request outside the kernel');
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(240000),
    headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : form ? { body: form } : {}) });
  const text = await response.text();
  if (!accepted.includes(response.status)) throw new Error(`${method} ${route.split('?')[0].replace(/\/people\/invitations\/[^/]+\/accept/, '/people/invitations/:private/accept')}: ${response.status}`);
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; } // an answer that is not JSON has no body to read; its status is what was checked
  return { status: response.status, body: parsed };
}

/** @description Assign or take back one application role for the person (preview, then apply). */
async function grant(origin, admin, principal, held, action = 'assign') {
  const catalog = (await http(origin, admin, 'GET', '/api/authorization/composites')).body;
  const input = { target: principal, assignment_id: held.id, action, expected_revision: catalog.revision,
    reason: 'Career swipe deck proof (test person)', idempotency_key: randomUUID(),
    ...(action === 'revoke' ? {} : { selection: { kind: 'granular', app: held.app, role: held.role } }) };
  if (action !== 'revoke') input.expected_plan_revision = (await http(origin, admin, 'POST', '/api/authorization/composites/preview', { body: input })).body.plan_revision;
  await http(origin, admin, 'POST', '/api/authorization/composites/apply', { body: input });
}

/** @description Poll until a check answers truthy; a timeout names the wait and the last thing that went wrong in it. */
async function until(check, ms, label, every = 1000) {
  const end = Date.now() + ms;
  let last = '';
  for (;;) {
    const value = await Promise.resolve().then(check).catch((error) => { last = message(error); return null; });
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out: ${label}${last ? ` (${last})` : ''}`);
    await wait(every);
  }
}

/** @description The person's new matches as Career lists them, newest first. */
async function matches(origin, token) {
  const answer = (await http(origin, token, 'GET', MATCHES)).body;
  return (answer && answer.jobs) || [];
}

/** @description One job as Career holds it for the person: its status and whether it is saved. */
async function held(origin, token, id) {
  const job = (await http(origin, token, 'GET', `${JOBS}/${id}`)).body.job;
  return { status: job.status || '', favorite: job.favorite === true, described: /\S/.test(String(job.description ?? '')), title: job.title, company: job.company };
}

/** @description The person file when its credential still answers and the made-up résumé is read; else null. */
async function existing(origin, file) {
  if (!fs.existsSync(file)) return null;
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const state = await http(origin, saved.token, 'GET', '/api/career-hunter/resume/state', { accepted: [200, 401, 403] }).catch(() => ({ status: 0 }));
  return state.status === 200 && state.body && state.body.hasResume ? saved : null;
}

/** @description A new test person: an invitation, the Job seeker role, and the made-up résumé through Career's own upload. */
async function newPerson(origin, admin, file) {
  const subject = `careerdeck1-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const invite = (await http(origin, admin, 'POST', '/people/invitations', { body: { invitee: subject, tier: 'editor', lifetime_ms: 3600000 } })).body;
  const accepted = (await http(origin, '', 'POST', `/people/invitations/${encodeURIComponent(invite.token)}/accept`, { body: { subject, display_name: 'Sam Example (test)' } })).body;
  const person = { base: origin, subject, principal: accepted.principal, token: accepted.token, grants: [] };
  privateWrite(file, person);
  const role = { id: `careerdeck1-career-hunter-${randomUUID().slice(0, 8)}`, app: 'career-hunter', role: 'member' };
  await grant(origin, admin, person.principal, role);
  person.grants.push(role); privateWrite(file, person);
  await http(origin, person.token, 'POST', '/packages/career-hunter/schema', { body: {} });
  const form = new FormData();
  form.append('resume', new Blob([RESUME], { type: 'text/plain' }), 'sam-example-resume.txt');
  await http(origin, person.token, 'POST', '/api/career-hunter/resume/upload', { form, accepted: [200, 202] });
  await until(async () => {
    const state = (await http(origin, person.token, 'GET', '/api/career-hunter/resume/state')).body;
    if (state && state.ingest && state.ingest.state === 'failed') throw new Error('indexing failed');
    return state && state.hasResume === true && !state.indexing;
  }, 900000, 'Career reading the made-up résumé');
  return person;
}

/** @description `person`: make (or carry on with) the test person, and have Career score a few public openings so they have matches. */
async function makePerson(origin, envFile, file) {
  const person = (await existing(origin, file)) || await newPerson(origin, adminToken(envFile), file);
  let listed = await matches(origin, person.token).catch(() => []);
  if (listed.length < NEEDED) {
    await http(origin, person.token, 'POST', '/api/career-hunter/settings/title-profile', { body: { terms: TITLES } });
    await http(origin, person.token, 'POST', '/api/career-hunter/run/score', { body: { limit: SCORE_LIMIT }, accepted: [200, 202, 409] });
    listed = await until(async () => { const now = await matches(origin, person.token); return now.length >= NEEDED && now; }, 30 * 60000, `Career scoring at least ${NEEDED} openings for the test person`, 5000);
  }
  say('test person', { subject: person.subject, grants: (person.grants || []).map((one) => `${one.app}:${one.role}`), matches: listed.length });
}

/**
 * @description Stop every request of this context that is not a read, the sign-in or one of the four moves of a job
 * the check holds. A read that would make Career fetch an employer's page (?details=read) is stopped too.
 */
async function guard(context, origin, row) {
  await context.route((url) => new URL(url).origin === origin, (route) => {
    const request = route.request(), url = new URL(request.url()), where = url.pathname, method = request.method();
    let from = '';
    try { from = new URL(request.frame().url()).pathname; } catch { from = ''; } // a request with no frame left is listed without one
    if (method === 'GET' || method === 'HEAD') {
      if (url.searchParams.get('details') === 'read') { row.heldBack.push(`GET ${where}?details=read`); return route.abort(); }
      return route.continue();
    }
    if (method === 'POST' && where === '/sessions') return route.continue();
    const own = where.match(/^\/api\/career-hunter\/jobs\/(\d+)\/status$/);
    if (method === 'POST' && own && row.holds.has(Number(own[1])) && MOVES.includes(request.postData() || '')) { row.writes.push(`${own[1]} ${request.postData()}`); return route.continue(); }
    if (method === 'POST' && /^\/api\/career-hunter\/jobs\/\d+\/details$/.test(where)) { row.heldBack.push(`POST ${where}`); return route.abort(); }
    row.stopped.push(`${method} ${where} (from ${from})`);
    return route.abort();
  });
}

/** @description Sign in on the slot's own sign-in page as the person, landing on My jobs; answers its frame. */
async function signInAndOpen(page, origin, person) {
  await page.goto(`${origin}/login?next=${encodeURIComponent(MY_JOBS)}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('#loginTokenBox > summary').click();
  await page.locator('#loginTokenValue').fill(person.token);
  await page.locator('#loginToken button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname.startsWith('/cockpit'), { timeout: 90000 });
  return board(page, '#careerStages [data-stage="matches"]', 'My jobs with its row of stages');
}

/** @description My jobs' frame (or the page itself, opened on its own) once `ready` is drawn in it. */
function board(page, ready, label) {
  return until(async () => {
    const frame = page.frames().find((one) => BOARD.test(one.url()));
    return frame && (await frame.locator(ready).first().isVisible().catch(() => false)) && frame;
  }, 120000, label);
}

/** @description What the deck shows: the lead card's facts, the buttons, and whether anything is off the screen or too small. */
function deck(frame) {
  return frame.evaluate(() => {
    const card = document.querySelector('.match-card.lead'), text = (node) => (node ? node.textContent.replace(/\s+/g, ' ').trim() : '');
    const buttons = [...document.querySelectorAll('#deckActionButtons [data-deck-act]')], wide = window.innerWidth;
    const bar = document.querySelector('.cf-bottombar:not([hidden])'), floor = bar ? bar.getBoundingClientRect().top : window.innerHeight;
    return {
      id: card ? Number(card.dataset.deckId) : null, employer: text(card?.querySelector('.co')), title: text(card?.querySelector('h2')),
      facts: text(card?.querySelector('.meta')), fit: text(card?.querySelector('.match-fit')), cards: document.querySelectorAll('.match-card.lead').length,
      rows: document.querySelectorAll('.job-row').length, said: text(document.getElementById('actionState')),
      buttons: buttons.map((el) => ({ name: text(el), disabled: el.disabled, width: Math.round(el.getBoundingClientRect().width), height: Math.round(el.getBoundingClientRect().height),
        onScreen: el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= wide + 0.5 && el.getBoundingClientRect().bottom <= floor + 0.5 })),
      sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      cardOutside: card ? card.getBoundingClientRect().left < -0.5 || card.getBoundingClientRect().right > wide + 0.5 : null,
    };
  });
}

/** @description Wait for the page's status line to begin with the given words. */
const saidLine = (frame, words) => frame.locator('#actionState').getByText(words).first().waitFor({ timeout: 60000 });

/** @description One finger across the lead card, through the browser's own touch input. */
async function swipeRight(page, frame) {
  const wire = await page.context().newCDPSession(page), box = await frame.locator('.match-card.lead .meta').boundingBox();
  const from = [box.x + 30, box.y + box.height / 2];
  await wire.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from[0], y: from[1] }] });
  for (let i = 1; i <= 12; i++) { await wire.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from[0] + 230 * i / 12, y: from[1] }] }); await wait(15); }
  await wire.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** @description Press one deck button, wait for the line it ends with, and compare the job with what Career now holds. */
async function step(ctx, name, button, line, expected) {
  const { frame, origin, person, row, page, out } = ctx, id = ctx.job;
  if (button === 'swipe') await swipeRight(page, frame); else await frame.getByRole('button', { name: button, exact: true }).tap();
  await saidLine(frame, line);
  const now = await held(origin, person.token, id), shown = await deck(frame);
  row.steps.push({ step: name, said: shown.said.slice(0, 160), status: now.status, favorite: now.favorite, lead: shown.id });
  if (now.status !== expected.status || now.favorite !== expected.favorite) row.failures.push(`${name}: Career holds the job as ${JSON.stringify({ status: now.status, favorite: now.favorite })}, not ${JSON.stringify(expected)}`);
  if (expected.lead === 'same' ? shown.id !== id : shown.id === id) row.failures.push(`${name}: the lead card is ${expected.lead === 'same' ? 'not the job again' : 'still the job'}`);
  await page.screenshot({ path: path.join(out, `deck-412x915-${name}.png`) });
}

/** @description The phone steps: the deck and its layout, Pass, Undo, Save, Undo, More, a swipe and its Undo, then /mobile. */
async function phoneSteps(ctx) {
  const { page, origin, row, out } = ctx;
  let frame = ctx.frame;
  await frame.locator('#careerStages [data-stage="matches"]').tap();
  frame = ctx.frame = await board(page, '.match-card.lead', 'New matches with its card');
  const first = await deck(frame);
  ctx.job = first.id; row.card = { employer: Boolean(first.employer), title: Boolean(first.title), facts: first.facts.slice(0, 120), fit: first.fit, buttons: first.buttons };
  if (!row.holds.has(first.id)) throw new Error('the lead card is not one of the matches Career listed for the person');
  // The one job every step acts on, as Career holds it before the first press.
  const found = row.before[first.id] = await held(origin, ctx.person.token, first.id);
  if (found.status !== 'new' && found.status !== '') throw new Error('the lead card is not a new match in Career\'s own record');
  if (first.cards !== 1 || first.rows !== 0) row.failures.push('New matches is not one card at a time');
  if (!first.employer || !first.title || !first.fit) row.failures.push('the card lacks its employer, its title or its fit');
  if (first.buttons.map((one) => one.name).join() !== 'Undo,Pass,Save,More') row.failures.push(`the buttons are ${first.buttons.map((one) => one.name).join()}`);
  if (first.buttons.some((one) => one.height < 44 || one.width < 44 || !one.onScreen) || first.sideways || first.cardOutside) row.failures.push(`layout ${JSON.stringify({ buttons: first.buttons, sideways: first.sideways, cardOutside: first.cardOutside })}`);
  if (!first.buttons[0].disabled) row.failures.push('Undo can be pressed before anything was done');
  await page.screenshot({ path: path.join(out, 'deck-412x915-open.png') });
  await step(ctx, 'pass', 'Pass', /^Removed: /, { status: 'dismissed', favorite: false, lead: 'next' });
  await step(ctx, 'undo-pass', 'Undo', /^Brought back: /, { status: 'new', favorite: false, lead: 'same' });
  await step(ctx, 'save', 'Save', /^Saved: /, { status: 'new', favorite: true, lead: 'next' });
  await step(ctx, 'undo-save', 'Undo', /^Unsaved: /, { status: 'new', favorite: false, lead: 'same' });
  const writes = row.writes.length;
  await frame.getByRole('button', { name: 'More', exact: true }).tap();
  const sheet = frame.locator('dialog[open]');
  await sheet.getByRole('heading', { name: 'Fit assessment' }).waitFor({ timeout: 60000 });
  row.more = { title: (await sheet.locator('h1').innerText()).length > 0, sideways: (await deck(frame)).sideways };
  await page.screenshot({ path: path.join(out, 'deck-412x915-more.png') });
  await sheet.getByRole('button', { name: 'Close posting' }).tap();
  await frame.locator('dialog[open]').waitFor({ state: 'detached', timeout: 30000 });
  if (row.writes.length !== writes) row.failures.push('More wrote something');
  if ((await deck(frame)).id !== ctx.job) row.failures.push('after More the lead card is another job');
  await step(ctx, 'swipe-right', 'swipe', /^Saved: /, { status: 'new', favorite: true, lead: 'next' });
  await step(ctx, 'undo-swipe', 'Undo', /^Unsaved: /, { status: 'new', favorite: false, lead: 'same' });
  await page.goto(`${origin}/api/career-hunter/mobile`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForURL((url) => BOARD.test(url.pathname) && url.searchParams.get('view') === 'matches', { timeout: 60000 });
  const opened = await deck(await board(page, '.match-card.lead', 'the deck opened from /api/career-hunter/mobile'));
  row.mobile = { lead: opened.id, buttons: opened.buttons.map((one) => one.name) };
  if (opened.cards !== 1 || opened.buttons.length !== 4) row.failures.push('/api/career-hunter/mobile did not open the deck');
  await page.screenshot({ path: path.join(out, 'deck-412x915-from-mobile.png') });
}

/** @description The desktop steps: New matches is the list it was, and nothing is written. */
async function desktopSteps(ctx) {
  const { page, row, out } = ctx;
  await ctx.frame.locator('#careerStages [data-stage="matches"]').click();
  const frame = await board(page, '.job-row', 'New matches with its list');
  const list = await frame.evaluate(() => ({ rows: document.querySelectorAll('.job-row').length, cards: document.querySelectorAll('.match-card, [data-deck-state]').length,
    deckButtons: document.querySelectorAll('[data-deck-act]').length, actions: [...new Set([...document.querySelectorAll('.job-row .row-actions')].map((el) => [...el.querySelectorAll('button')].map((b) => b.textContent.trim()).join('|')))],
    search: Boolean(document.getElementById('keywordSearch')?.offsetParent), sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 }));
  row.list = list;
  if (!list.rows || list.cards || list.deckButtons) row.failures.push('at 1440 New matches is not the list alone');
  if (list.actions.join() !== 'Save|Not interested') row.failures.push(`the rows' buttons are ${list.actions.join(' ; ')}`);
  if (!list.search || list.sideways) row.failures.push('the search row is missing or the page scrolls sideways');
  if (row.writes.length) row.failures.push('looking at the list wrote something');
  await page.screenshot({ path: path.join(out, 'matches-1440x900-list.png') });
}

/** @description Put every job the check held back as it found it, by the moves the deck itself makes. */
async function restore(origin, person, row) {
  let same = true;
  for (const [id, found] of Object.entries(row.before)) {
    let now = await held(origin, person.token, id);
    if (now.status === 'dismissed' && found.status !== 'dismissed') await http(origin, person.token, 'POST', `${JOBS}/${id}/status`, { body: { status: 'new' } });
    if (now.favorite && !found.favorite) await http(origin, person.token, 'POST', `${JOBS}/${id}/status`, { body: { favorite: false } });
    now = await held(origin, person.token, id);
    if ((now.status || 'new') !== (found.status || 'new') || now.favorite !== found.favorite) same = false;
  }
  return same;
}

/** @description One size: sign in, run its steps, put the jobs back, sign out. */
async function checkSize(browser, origin, person, size, out, receipt) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.touch, hasTouch: size.touch, deviceScaleFactor: size.touch ? 2.625 : 1 });
  const row = { size: `${size.width}x${size.height}`, failures: [], stopped: [], heldBack: [], writes: [], errors: [], steps: [], holds: new Set(), before: {} };
  receipt.sizes.push(row);
  try {
    const listed = await matches(origin, person.token);
    if (listed.length < NEEDED) throw new Error(`the test person has ${listed.length} new matches; run person again (it needs ${NEEDED})`);
    for (const job of listed) row.holds.add(Number(job.id));
    await guard(context, origin, row);
    const page = await context.newPage();
    page.on('pageerror', (error) => row.errors.push(message(error).slice(0, 160)));
    const frame = await signInAndOpen(page, origin, person);
    await (size.touch ? phoneSteps : desktopSteps)({ page, frame, origin, person, row, out });
    const own = row.stopped.filter((line) => /\(from \/api\/career-hunter\//.test(line));
    if (own.length) row.failures.push(`My jobs tried a write the check did not permit: ${own.join('; ')}`);
    if (row.errors.length) row.failures.push(`the page raised an error: ${row.errors[0]}`);
  } catch (error) { row.failures.push(message(error)); }
  finally {
    row.restored = await restore(origin, person, row).catch((error) => { row.failures.push(`putting the jobs back: ${message(error)}`); return false; });
    if (!row.restored) row.failures.push('a job was not left as the check found it');
    row.holds = row.holds.size; row.before = Object.keys(row.before).length;
    const cookies = await context.cookies(origin).catch((error) => { say('sessions unread', { message: message(error) }); return []; });
    for (const cookie of cookies.filter((one) => /session/i.test(one.name))) await http(origin, cookie.value, 'DELETE', '/sessions', { accepted: [200, 204, 401] }).catch((error) => say('sign-out failed', { message: message(error) }));
    await context.close();
  }
}

/** @description `check`: exit 0 when the deck passes, saves, undoes and opens details at 412, /mobile opens it, 1440 is the list, and every job ends as found. */
async function check(origin, file, out) {
  const person = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  const script = await http(origin, person.token, 'GET', DECK_SCRIPT, { accepted: [200, 401, 403, 404] });
  if (script.status !== 200) throw new Error('this Career has no swipe deck script (career-hunter 1.69.0 is not installed on this slot)');
  const served = await http(origin, person.token, 'GET', '/api/career-hunter/_smoke', { accepted: [200, 401, 403, 404] }).catch((error) => { say('version unread', { message: message(error) }); return { body: null }; });
  const receipt = { origin, at: new Date().toISOString(), career: served.body && served.body.version, subject: person.subject, sizes: [], failures: [] };
  const browser = await playwright().chromium.launch({ headless: true });
  try {
    for (const size of [{ width: 412, height: 915, touch: true }, { width: 1440, height: 900, touch: false }]) await checkSize(browser, origin, person, size, out, receipt);
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'career-match-deck-live.json'), JSON.stringify(receipt, null, 2));
  say('check', receipt);
  return receipt.failures.length || receipt.sizes.some((row) => row.failures.length) ? 1 : 0;
}

/** @description `remove`: take the grants back and deactivate the test person. */
async function remove(origin, envFile, file) {
  const admin = adminToken(envFile), person = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const role of person.grants || []) await grant(origin, admin, person.principal, role, 'revoke').catch((error) => say('revoke failed', { message: message(error) }));
  const confirmation = (await http(origin, admin, 'POST', '/confirmations', { body: {} })).body;
  await http(origin, admin, 'POST', `/people/${person.principal}/deactivate`, { body: {}, headers: { 'x-oshal-confirm': confirmation.confirmation } });
  await http(origin, person.token, 'GET', '/api/authorization/me', { accepted: [401, 403] });
  fs.rmSync(file, { force: true });
  say('test person removed', { subject: person.subject, grantsRevoked: (person.grants || []).length });
}

const [mode, base, second, third] = process.argv.slice(2);
try {
  if (!['person', 'check', 'remove'].includes(mode) || !base || !second || !third) throw new Error('usage: person <base> <env file> <person file> | check <base> <person file> <out folder> | remove <base> <env file> <person file>');
  const origin = testSlot(base);
  if (mode === 'person') await makePerson(origin, second, third);
  else if (mode === 'check') process.exitCode = await check(origin, second, third);
  else await remove(origin, second, third);
} catch (error) {
  console.error(`career-match-deck-live-proof: ${message(error)}`);
  process.exitCode = 1;
}
