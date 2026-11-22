#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane CAREER-REGEN (Roger, 2026-11-21: 200 applications by Monday; his open jobs need Generate résumé & cover letter again, as one action). The check of Generate again on an installed Career, on a test slot, as a test person. `person` makes a test person with a made-up résumé and two prepared jobs (Career's model writes them, a few minutes). `check` signs in on the slot's own sign-in page: at 1440x900 it selects both jobs in My jobs' List, presses Generate again (2), reads the confirmation's words, confirms, sees the panel start, and CLOSES the page, then follows the queue with no Career page open until both jobs have new documents (his career-regenerate background job moves it on); at 412x915 it queues one job, pauses, reloads, goes on and stops it from the panel, and clears it. Every request that is not a read, the sign-in, a Generate again route or the activation of his own background job is stopped and listed. Screenshots and a JSON receipt go to the out folder. `remove` turns his background job off, takes the test person's role back and deactivates it.
 *
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Lane REGEN-PROOF: the check could never pass on the test slot (blue), which runs no schedules (its /readyz says schedulerEnabled:false), so his career-regenerate job never fired and the 1440x900 row waited 30 minutes for nothing. When /readyz says schedulerEnabled:false, the check now makes the schedule's own call itself once the page is closed (POST /api/career-hunter/regenerate/advance as the person, every 20 s, empty body; 409 while a job is being written is an answer, not a failure) and the receipt says so in words; with schedules on it still relies on his job. The guard permits the cockpit's own POST /api/cockpit/recents (a platform write when an application opens, not Career's). Each row starts with no queue: a queue left by a failed row or an earlier run is stopped, its job in hand settled and cleared first (the phone row of 2026-11-22 started on the 1440 row's two jobs). The phone row's "locator.click: Timeout 30000ms" was this check, not the page: after the reload it went to /login again, the slot sends a signed-in person straight on, and the sign-in form it clicked was not there; a reload now only reopens Getting ready. Each row names the step a failure came from.
 *
 * Usage (a loopback kernel only; the administrator credential is read by name from the env file and never printed, the
 * person's credential stays in its 0600 file and is typed only into the slot's own sign-in page; all three refuse port 38788):
 *   node career-hunter/tests/career-regenerate-live-proof.mjs person http://127.0.0.1:38798 <slot env file> <person file>
 *   node career-hunter/tests/career-regenerate-live-proof.mjs check  http://127.0.0.1:38798 <person file> <out folder>
 *   node career-hunter/tests/career-regenerate-live-proof.mjs remove http://127.0.0.1:38798 <slot env file> <person file>
 * Playwright comes from STORE_CI_TOOLCHAIN or the store's scripts/toolchain (npm ci --prefix scripts/toolchain).
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { playwright } from './helpers/ux-page.mjs';

const BOARD_LINK = '/cockpit/?app=career-hunter&screen=career-board';
const BOARD = /\/api\/career-hunter\/board-native/;
// The Generate again routes, the activation of his own background job, and the cockpit's own recents write when an application opens.
const ALLOWED = /^\/api\/career-hunter\/regenerate(?:\/(?:advance|pause|go-on|stop|clear))?$|^\/api\/v1\/agent\/schedules\/[^/]+\/activate$|^\/api\/cockpit\/recents$/;
const NO_SCHEDULES = 'this slot runs no schedules; the check made the schedule\'s own call';
const SCHEDULED = 'his career-regenerate background job moved the queue on';
const CONFIRM = (n) => `Career makes new documents for ${n} ${n === 1 ? 'job' : 'jobs'}, one after another, in the background. Each takes about a minute. Your notes and choices for each job are kept.`;
// Made-up data; nothing here is anyone's.
const RESUME = `Riley Sample
Operations manager | Sampletown, USA | riley.sample@example.com
SUMMARY
Runs logistics operations for growing companies (a made-up résumé for a test).
EXPERIENCE
Operations Manager, Example Logistics, 2020-02 to present
- Runs a team of eight across scheduling, purchasing and facilities.
Logistics Coordinator, Sample Freight Co, 2016-05 to 2020-01
- Scheduled 300 deliveries a week across four depots.
SKILLS
Scheduling, vendor management, budgeting, Excel
EDUCATION
B.A. Business, Sample State University, 2012 - 2016
`;
const JOB_TEXT = 'Logistics Operations Manager (a made-up posting for a test). Run a regional logistics team: scheduling, dispatch, '
  + 'vendor contracts and warehouse operations. Requirements: five years of logistics operations and two years leading a team. '.repeat(4);

const say = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const message = (error) => String((error && error.message) || error).split('\n')[0].slice(0, 300);

/** @description The loopback test slot's origin, or a refusal (never production's port). @param {string} base @returns {string} */
function testSlot(base) {
  const origin = new URL(String(base || '')).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('this proof runs only against a loopback kernel, http://127.0.0.1:<port>');
  if (new URL(origin).port === '38788') throw new Error('this proof writes; it runs on the test slot (http://127.0.0.1:38798), never on production');
  return origin;
}
/** @description The administrator credential from an env file, by name; never printed. @param {string} file @returns {string} */
function adminToken(file) {
  const line = fs.readFileSync(file, 'utf8').split('\n').find((value) => value.startsWith('OSHAL_ADMIN_TOKEN='));
  if (!line) throw new Error('the env file names no OSHAL_ADMIN_TOKEN');
  return line.slice('OSHAL_ADMIN_TOKEN='.length).trim().replace(/^(['"])(.*)\1$/, '$2');
}
/** @description A JSON file only this user can read. @param {string} file @param {object} value @returns {void} */
function privateWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}
/** @description One request to the kernel; a failure names the method, the route and the status, nothing else. */
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
  const input = { target: principal, assignment_id: held.id, action, expected_revision: catalog.revision, reason: 'Career Generate again proof (test person)', idempotency_key: randomUUID(),
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
/** @description Listings for the person to prepare (their text is replaced by a made-up paste). */
async function pickJobs(origin, token) {
  const found = new Set();
  for (const q of ['operations manager', 'logistics', 'manager']) {
    const jobs = (await http(origin, token, 'GET', `/api/career-hunter/browse?q=${encodeURIComponent(q)}&per=20`)).body?.jobs || [];
    for (const job of jobs) if (Number.isSafeInteger(Number(job.id)) && !['applied', 'interview', 'offer', 'rejected'].includes(job.status)) found.add(Number(job.id));
    if (found.size >= 2) return [...found].slice(0, 2);
  }
  throw new Error('fewer than two listings to prepare on this slot');
}
/** @description A new person's job store is made by their first title pass; run a one-job pass when it is missing. */
async function ensureStore(origin, token, id) {
  const ready = async () => (await http(origin, token, 'GET', `/api/career-hunter/jobs/${id}`, { accepted: [200, 404] })).status === 200;
  if (await ready()) return;
  await http(origin, token, 'POST', '/api/career-hunter/settings/title-profile', { body: { terms: ['Operations Manager', 'Logistics Manager'] } });
  await until(async () => [202, 409].includes((await http(origin, token, 'POST', '/api/career-hunter/title-pass/run-now', { body: { limit: 1 }, accepted: [202, 409, 429, 502] })).status), 600000, 'a title pass slot');
  await until(ready, 1800000, 'the title pass that makes the job store');
}
/** @description Prepare one job as the person does (Generate résumé & cover letter) and wait for its documents. */
async function prepare(origin, token, id) {
  const requestId = `careerregen1-${randomUUID()}`;
  await until(async () => (await http(origin, token, 'POST', `/api/career-hunter/jobs/${id}/generate`, { body: { documents: true, requestId, jobDescription: JOB_TEXT }, accepted: [202, 409] })).status === 202, 600000, 'a free moment to prepare');
  return until(async () => {
    const job = (await http(origin, token, 'GET', `/api/career-hunter/jobs/${id}`)).body?.job;
    return job && job.board?.requestId === requestId && job.board.phase === 'ready' ? job : null;
  }, 1200000, 'the documents', 5000);
}
/** @description `person`: make (or reuse) the test person, with a made-up résumé and two prepared jobs. */
async function makePerson(origin, envFile, file) {
  const admin = adminToken(envFile);
  if (fs.existsSync(file)) { say('test person kept', { subject: JSON.parse(fs.readFileSync(file, 'utf8')).subject }); return; }
  const subject = `careerregen1-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const invite = (await http(origin, admin, 'POST', '/people/invitations', { body: { invitee: subject, tier: 'editor', lifetime_ms: 3600000 } })).body;
  const accepted = (await http(origin, '', 'POST', `/people/invitations/${encodeURIComponent(invite.token)}/accept`, { body: { subject, display_name: 'Riley Sample (test)' } })).body;
  const person = { base: origin, subject, principal: accepted.principal, token: accepted.token, grants: [], jobs: [] };
  privateWrite(file, person);
  const held = { id: `careerregen1-career-hunter-${randomUUID().slice(0, 8)}`, app: 'career-hunter', role: 'member' };
  await grant(origin, admin, person.principal, held);
  person.grants.push(held);
  privateWrite(file, person);
  await http(origin, person.token, 'POST', '/packages/career-hunter/schema', { body: {} });
  const form = new FormData();
  form.append('resume', new Blob([RESUME], { type: 'text/plain' }), 'riley-sample-resume.txt');
  await http(origin, person.token, 'POST', '/api/career-hunter/resume/upload', { form, accepted: [200, 202] });
  await until(async () => {
    const state = (await http(origin, person.token, 'GET', '/api/career-hunter/resume/state')).body;
    if (state && state.ingest && state.ingest.state === 'failed') throw new Error('indexing failed');
    return state && state.hasResume === true && !state.indexing;
  }, 900000, 'Career indexing the made-up résumé');
  const jobs = await pickJobs(origin, person.token);
  await ensureStore(origin, person.token, jobs[0]);
  for (const id of jobs) { await http(origin, person.token, 'POST', `/api/career-hunter/jobs/${id}/status`, { body: { favorite: true } }); await prepare(origin, person.token, id); }
  person.jobs = jobs;
  privateWrite(file, person);
  say('test person', { subject, jobs });
}
/** @description Stop every request of this context that is not a read, the sign-in, a Generate again route, his background job's activation or the cockpit's recents. */
async function guard(context, origin, row) {
  await context.route((url) => new URL(url).origin === origin, (route) => {
    const request = route.request(), where = new URL(request.url()).pathname, method = request.method();
    if (method === 'GET' || method === 'HEAD' || (method === 'POST' && where === '/sessions')) return route.continue();
    if (method === 'POST' && ALLOWED.test(where)) { row.writes.push(`${method} ${where.replace(/schedules\/[^/]+/, 'schedules/:id')}`); return route.continue(); }
    row.stopped.push(`${method} ${where}`);
    return route.abort();
  });
}
/** @description Sign in on the slot's own sign-in page and open My jobs, Getting ready; answers its frame. */
async function openBoard(page, origin, person) {
  await page.goto(`${origin}/login?next=${encodeURIComponent(BOARD_LINK)}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('#loginTokenBox > summary').click();
  await page.locator('#loginTokenValue').fill(person.token);
  await page.locator('#loginToken button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname.startsWith('/cockpit'), { timeout: 90000 });
  return queueFrame(page, origin);
}
/**
 * @description My jobs on Getting ready in a page that is already signed in. A reload keeps the session, and the slot's /login
 * sends a signed-in person straight on with no sign-in form, so a reload comes here, never back through openBoard.
 */
async function queueFrame(page, origin) {
  const board = await until(() => page.frames().find((frame) => BOARD.test(frame.url())), 120000, 'My jobs');
  await board.goto(`${origin}/api/career-hunter/board-native?view=queue`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  return until(() => page.frames().find((frame) => BOARD.test(frame.url()) && new URL(frame.url()).searchParams.get('view') === 'queue'), 60000, 'Getting ready');
}
const queueOf = async (origin, person) => (await http(origin, person.token, 'GET', '/api/career-hunter/regenerate')).body?.queue || null;
/** @description Select these jobs in the List and confirm Generate again from the bar; answers the confirmation's words. */
async function generateFromBar(frame, ids) {
  for (const id of ids) await frame.locator(`[data-job-id="${id}"] [data-select]`).check({ timeout: 120000 });
  await frame.locator('#bulkBar').getByRole('button', { name: `Generate again (${ids.length})` }).click();
  const sheet = frame.getByRole('dialog', { name: `Generate again for ${ids.length} ${ids.length === 1 ? 'job' : 'jobs'}?` });
  await sheet.waitFor({ timeout: 30000 });
  const words = await sheet.locator('.rg-confirm').innerText();
  await sheet.getByRole('button', { name: `Generate again (${ids.length})` }).click();
  return words;
}
const sideways = (frame) => frame.evaluate(() => document.scrollingElement.scrollWidth > window.innerWidth + 1);
const countLine = (queue) => `${queue.state}: ${queue.counts.done} done, ${queue.counts.left} left, ${queue.counts.failed} failed`;
/** @description One press on his queue through the route the panel calls; 404 (no queue) and 409 (ended, or a job being written) are answers. */
const pressAs = (origin, person, name) => http(origin, person.token, 'POST', `/api/career-hunter/regenerate/${name}`, { body: {}, accepted: [200, 404, 409] });
/**
 * @description Begin a row with no queue: one left by a failed row or an earlier run is stopped, the job Career is writing is
 * settled (advance) and the queue cleared. @returns {Promise<boolean>} False, with the failure on the row, when it stayed.
 */
async function startClean(origin, person, row) {
  try {
    const left = await queueOf(origin, person);
    if (!left) return true;
    await until(async () => {
      const queue = await queueOf(origin, person);
      if (!queue) return true;
      await pressAs(origin, person, !['done', 'stopped'].includes(queue.state) ? 'stop' : queue.current ? 'advance' : 'clear');
      return false;
    }, 20 * 60000, 'stopping and clearing a queue left from before', 5000);
    row.startedClean = `a queue left from before (${countLine(left)}) was stopped and cleared first`;
    return true;
  } catch (error) { row.failures.push(`before this row: ${message(error)}`); return false; }
}
/**
 * @description With no Career page open, follow the queue until both jobs are done. Where the slot runs schedules his
 * career-regenerate job moves it on; where it runs none the check makes that job's own call (POST advance as him, empty body)
 * every 20 s and the receipt says so. Then his job must be on and neither job may still count as older.
 */
async function follow(origin, person, row, scheduler) {
  const closedAt = Date.now(), answers = {};
  row.movedOnBy = scheduler ? SCHEDULED : NO_SCHEDULES;
  if (!scheduler) row.advanceAnswers = answers;
  try {
    const ended = await until(async () => {
      const moved = scheduler ? 0 : (await http(origin, person.token, 'POST', '/api/career-hunter/regenerate/advance', { body: {}, accepted: [200, 409] })).status;
      if (moved) answers[moved] = (answers[moved] || 0) + 1;
      const queue = await queueOf(origin, person);
      row.timeline.push({ secondsSinceClosed: Math.round((Date.now() - closedAt) / 1000), state: queue?.state, counts: queue?.counts, ...(moved ? { advance: moved } : {}) });
      return queue && queue.state === 'done' ? queue : null;
    }, 30 * 60000, `Generate again finishing with no Career page open (${row.movedOnBy})`, scheduler ? 15000 : 20000);
    row.ended = ended.entries.map((entry) => ({ postingId: entry.postingId, state: entry.state, attempts: entry.attempts, reason: entry.reason }));
    if (ended.counts.done !== 2) row.failures.push(`with the page closed ${ended.counts.done} of 2 were written`);
    const schedules = (await http(origin, person.token, 'GET', '/api/v1/agent/schedules')).body?.schedules || [];
    row.background = schedules.find((job) => job.app === 'career-hunter' && job.name === 'career-regenerate')?.status || 'missing';
    if (row.background !== 'active') row.failures.push(`his background job is ${row.background}`);
    const older = (await http(origin, person.token, 'GET', '/api/career-hunter/regenerate/older')).body;
    if (older.jobs.some((job) => person.jobs.includes(job.id))) row.failures.push('a regenerated job still counts as older');
    await http(origin, person.token, 'POST', '/api/career-hunter/regenerate/clear', { body: {} });
  } catch (error) { row.failures.push(message(error)); }
}
/** @description 1440x900: queue both jobs from the bar, close the page, and follow the queue with no Career page open. */
async function computer(browser, origin, person, out, receipt, scheduler) {
  const row = { size: '1440x900', failures: [], stopped: [], writes: [], timeline: [] };
  receipt.sizes.push(row);
  if (!await startClean(origin, person, row)) return;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    await guard(context, origin, row);
    row.step = 'sign in and open Getting ready';
    const page = await context.newPage(), frame = await openBoard(page, origin, person);
    row.step = 'Generate again (2)';
    row.confirmation = await generateFromBar(frame, person.jobs);
    if (row.confirmation !== CONFIRM(2)) row.failures.push(`the confirmation says: ${row.confirmation}`);
    row.step = 'the panel starting';
    await frame.locator('#regenerateTitle', { hasText: 'Generating again' }).waitFor({ timeout: 60000 });
    row.heading = await frame.locator('#regenerateTitle').innerText();
    row.sideways = await sideways(frame);
    if (row.sideways) row.failures.push('the page is wider than the screen');
    await page.screenshot({ path: path.join(out, 'regenerate-1440x900-started.png') });
  } catch (error) { row.failures.push(`${row.step}: ${message(error)}`); }
  finally { await context.close(); }
  // No Career page is open from here.
  await follow(origin, person, row, scheduler);
}
/** @description 412x915: queue one job, then Pause, a reload, Go on and Stop from the panel, and Clear. */
async function phone(browser, origin, person, out, receipt) {
  const row = { size: '412x915', failures: [], stopped: [], writes: [] };
  receipt.sizes.push(row);
  if (!await startClean(origin, person, row)) return;
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 });
  const panel = (frame, name) => frame.locator('#regenerate').getByRole('button', { name });
  const title = (frame, text, timeout) => frame.locator('#regenerateTitle', { hasText: text }).waitFor({ timeout });
  try {
    await guard(context, origin, row);
    const page = await context.newPage();
    row.step = 'sign in and open Getting ready';
    let frame = await openBoard(page, origin, person);
    row.step = 'Generate again (1)';
    row.confirmation = await generateFromBar(frame, person.jobs.slice(0, 1));
    if (row.confirmation !== CONFIRM(1)) row.failures.push(`the confirmation says: ${row.confirmation}`);
    row.queued = (await until(() => queueOf(origin, person), 60000, 'the queue Generate again (1) makes'))?.counts?.total;
    if (row.queued !== 1) row.failures.push(`Generate again (1) left ${row.queued} jobs in the queue`);
    row.step = 'Pause';
    await panel(frame, 'Pause').click({ timeout: 60000 });
    await title(frame, 'Generate again is paused', 600000);
    await page.screenshot({ path: path.join(out, 'regenerate-412x915-paused.png') });
    row.step = 'the reload';
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
    frame = await queueFrame(page, origin);
    await title(frame, 'Generate again is paused', 60000);
    row.step = 'Go on';
    await panel(frame, 'Go on').click();
    await title(frame, 'Generating again', 600000);
    row.step = 'Stop';
    await panel(frame, 'Stop').click();
    await title(frame, 'Generate again stopped', 600000);
    row.step = 'the job being written finishing';
    await until(async () => !(await queueOf(origin, person))?.current, 600000, 'the job being written to finish', 5000);
    row.ended = (await queueOf(origin, person)).counts;
    row.sideways = await sideways(frame);
    if (row.sideways) row.failures.push('the page is wider than the screen');
    await page.screenshot({ path: path.join(out, 'regenerate-412x915-stopped.png') });
    row.step = 'Clear';
    await panel(frame, 'Clear').click({ timeout: 60000 });
    await until(async () => (await queueOf(origin, person)) === null, 120000, 'Clear');
  } catch (error) { row.failures.push(`${row.step}: ${message(error)}`); }
  finally { await context.close(); }
}
/** @description Whether the slot runs schedules, from its own /readyz (the test slot, blue, runs none). @returns {Promise<boolean>} */
async function schedulerOn(origin) {
  const ready = (await http(origin, '', 'GET', '/readyz')).body;
  if (typeof ready?.schedulerEnabled !== 'boolean') throw new Error('the slot\'s /readyz does not say whether it runs schedules');
  return ready.schedulerEnabled;
}
/** @description `check`: exit 0 when both sizes pass and the queue ran to the end with no Career page open. */
async function check(origin, file, out) {
  const person = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  if (!Array.isArray(person.jobs) || person.jobs.length !== 2) throw new Error('the person file names no two prepared jobs: run person first');
  const served = await http(origin, person.token, 'GET', '/api/career-hunter/_smoke', { accepted: [200, 401, 403, 404] }).catch((error) => { say('version unread', { message: message(error) }); return { body: null }; });
  const scheduler = await schedulerOn(origin);
  const receipt = { origin, at: new Date().toISOString(), career: served.body && served.body.version, subject: person.subject, schedulerEnabled: scheduler, sizes: [] };
  if ((await http(origin, person.token, 'GET', '/api/career-hunter/regenerate', { accepted: [200, 404] })).status === 404) throw new Error('this Career has no Generate again (its release is not installed on this slot)');
  const browser = await playwright().chromium.launch({ headless: true });
  try { await computer(browser, origin, person, out, receipt, scheduler); await phone(browser, origin, person, out, receipt); }
  finally { await browser.close(); }
  for (const row of receipt.sizes) if (row.stopped.length) row.failures.push(`the page tried a write the check did not permit: ${row.stopped.join('; ')}`);
  fs.writeFileSync(path.join(out, 'career-regenerate-live.json'), JSON.stringify(receipt, null, 2));
  say('check', receipt);
  return receipt.sizes.some((row) => row.failures.length) ? 1 : 0;
}
/** @description `remove`: turn his background job off, take the grants back and deactivate the test person. */
async function remove(origin, envFile, file) {
  const admin = adminToken(envFile), person = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const name of ['stop', 'clear']) await http(origin, person.token, 'POST', `/api/career-hunter/regenerate/${name}`, { body: {}, accepted: [200, 404, 409] }).catch((error) => say(`${name} failed`, { message: message(error) }));
  const schedules = (await http(origin, person.token, 'GET', '/api/v1/agent/schedules').catch((error) => { say('schedules unread', { message: message(error) }); return { body: null }; })).body?.schedules || [];
  const job = schedules.find((one) => one.app === 'career-hunter' && one.name === 'career-regenerate');
  if (job?.status === 'active') await http(origin, person.token, 'POST', `/api/v1/agent/schedules/${encodeURIComponent(job.id)}/deactivate`, { body: {} }).catch((error) => say('background job not turned off', { message: message(error) }));
  for (const held of person.grants || []) await grant(origin, admin, person.principal, held, 'revoke').catch((error) => say('revoke failed', { message: message(error) }));
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
  console.error(`career-regenerate-live-proof: ${message(error)}`);
  process.exitCode = 1;
}
