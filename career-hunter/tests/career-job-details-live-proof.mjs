#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.6 (Roger, 2026-11-16: "there are a bunch of jobs from torch technology that i want to apply for but in the my jobs initial screen the popup says that there is no information about the job"). On an installed Career, on the test slot, as a test person with a made-up résumé who saved open Torch Technologies postings the corpus holds no description for: POST /jobs/:id/details reads one through the kernel's egress and keeps it, GET /jobs/:id reads it back, and on My jobs in Today at 412x915 and 1440x900 another one's posting sheet says it is reading, then shows the employer's text and never "No description was provided."
 *
 * Usage (a loopback kernel only; the administrator credential is read by name from the env file and never printed, the
 * person's credential stays in its 0600 file and never enters a page or a log; jobs are named by id only):
 *   node career-hunter/tests/career-job-details-live-proof.mjs person http://127.0.0.1:38798 <slot env file> <person file>
 *   node career-hunter/tests/career-job-details-live-proof.mjs check  http://127.0.0.1:38798 <person file> <out folder>
 *   node career-hunter/tests/career-job-details-live-proof.mjs remove http://127.0.0.1:38798 <slot env file> <person file>
 * Playwright comes from STORE_CI_TOOLCHAIN or the store's scripts/toolchain (npm ci --prefix scripts/toolchain).
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { playwright } from './helpers/ux-page.mjs';

const EMPLOYER = 'Torch Technologies';
const BOARD = /\/api\/career-hunter\/board-native/;
const MY_JOBS = '/cockpit/?app=career-hunter&screen=career-board';
const SIZES = [{ width: 412, height: 915, touch: true }, { width: 1440, height: 900 }];
// A made-up résumé, so Career makes the person's store; nothing here is anyone's data.
const RESUME = `Sam Placeholder
Test engineer | Sampletown, USA | sam.placeholder@example.com
SUMMARY
Plans and runs test operations for invented flight programs (a made-up résumé for a test).
EXPERIENCE
Test Operations Engineer, Example Aero Labs, 2019-01 to present
- Planned range schedules for 40 invented test events a year.
- Wrote the test reports program offices relied on.
Systems Engineer, Demo Defense Works, 2014-05 to 2018-12
- Kept requirements traced from design through verification.
SKILLS
Test planning, systems engineering, configuration management
EDUCATION
B.S. Engineering, Sample State University, 2014
`;

const say = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const message = (error) => String((error && error.message) || error).split('\n')[0].slice(0, 300);

/** @description The loopback kernel's origin, or a refusal. @param {string} base An address. @returns {string} The origin. */
function loopback(base) {
  const origin = new URL(String(base || '')).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('this proof runs only against a loopback kernel, http://127.0.0.1:<port>');
  if (new URL(origin).port === '38788') throw new Error('this proof writes a test person\'s copies; it runs on the test slot (http://127.0.0.1:38798), never on production');
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

/**
 * @description One request to the kernel's own origin; a failure names the method, the route and the status, nothing else.
 * @param {string} origin @param {string} credential A bearer or ''. @param {string} method @param {string} route
 * @param {object} [options] body (JSON), form (FormData), accepted statuses, headers.
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
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: response.status, body: parsed };
}

/** @description Assign or take back one application role for the person (preview, then apply; a revoke applies at once). */
async function grant(origin, admin, principal, held, action = 'assign') {
  const catalog = (await http(origin, admin, 'GET', '/api/authorization/composites')).body;
  const input = { target: principal, assignment_id: held.id, action, expected_revision: catalog.revision,
    reason: 'Career job description proof (test person)', idempotency_key: randomUUID(),
    ...(action === 'revoke' ? {} : { selection: { kind: 'granular', app: held.app, role: held.role } }) };
  if (action !== 'revoke') input.expected_plan_revision = (await http(origin, admin, 'POST', '/api/authorization/composites/preview', { body: input })).body.plan_revision;
  await http(origin, admin, 'POST', '/api/authorization/composites/apply', { body: input });
}

/** @description Poll until a check answers truthy. */
async function until(check, ms, label) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await Promise.resolve().then(check).catch(() => null);
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out: ${label}`);
    await wait(1000);
  }
}

/** @description `person`: make (or reuse) the test person, give them a Career store, and save the employer's newest openings. */
async function makePerson(origin, envFile, file) {
  const admin = adminToken(envFile);
  if (fs.existsSync(file)) { say('test person kept', { subject: JSON.parse(fs.readFileSync(file, 'utf8')).subject }); return; }
  const subject = `careerjobinfo1-details-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const invite = (await http(origin, admin, 'POST', '/people/invitations', { body: { invitee: subject, tier: 'editor', lifetime_ms: 3600000 } })).body;
  const accepted = (await http(origin, '', 'POST', `/people/invitations/${encodeURIComponent(invite.token)}/accept`, { body: { subject, display_name: 'Sam Placeholder (test)' } })).body;
  const person = { base: origin, subject, principal: accepted.principal, token: accepted.token, grants: [], saved: [] };
  privateWrite(file, person);
  const held = { id: `careerjobinfo1-career-hunter-${randomUUID().slice(0, 8)}`, app: 'career-hunter', role: 'member' };
  await grant(origin, admin, person.principal, held);
  person.grants.push(held);
  privateWrite(file, person);
  await http(origin, person.token, 'POST', '/packages/career-hunter/schema', { body: {} });
  const form = new FormData();
  form.append('resume', new Blob([RESUME], { type: 'text/plain' }), 'sam-placeholder-resume.txt');
  await http(origin, person.token, 'POST', '/api/career-hunter/resume/upload', { form, accepted: [200, 202] });
  await until(async () => {
    const state = (await http(origin, person.token, 'GET', '/api/career-hunter/resume/state')).body;
    if (state && state.ingest && state.ingest.state === 'failed') throw new Error('indexing failed');
    return state && state.hasResume === true && !state.indexing;
  }, 900000, 'Career indexing the made-up résumé');
  // Career makes a person's store with their first match, so the person saves titles and runs one bounded pass (limit 1).
  await http(origin, person.token, 'POST', '/api/career-hunter/settings/title-profile', { body: { terms: 'Test Operations Engineer\nSystems Engineer' } });
  await http(origin, person.token, 'POST', '/api/career-hunter/run/score', { body: { limit: 1 }, accepted: [200, 202] });
  await until(async () => {
    const runs = ((await http(origin, person.token, 'GET', '/api/career-hunter/runs')).body || {}).runs || [];
    const list = (await http(origin, person.token, 'GET', '/api/career-hunter/jobs?status=saved&per=1')).body;
    return !runs.some((run) => run.state === 'running') && list && list.empty !== true;
  }, 1200000, 'the first match making the person\'s Career store');
  const found = ((await http(origin, person.token, 'GET', `/api/career-hunter/browse?company=${encodeURIComponent(EMPLOYER)}&per=50&sort=recent`)).body || {}).jobs || [];
  for (const job of found.filter((item) => item.company === EMPLOYER).slice(0, 6)) {
    const read = (await http(origin, person.token, 'GET', `/api/career-hunter/jobs/${job.id}`, { accepted: [200, 404] })).body;
    if (!read || !read.job || /\S/.test(String(read.job.description || ''))) continue;  // only openings the corpus has no description for
    await until(async () => (await http(origin, person.token, 'POST', `/api/career-hunter/jobs/${job.id}/status`, { body: { favorite: true }, accepted: [200, 409] })).status === 200, 120000, `saving job ${job.id}`);
    person.saved.push(Number(job.id));
    privateWrite(file, person);
  }
  if (person.saved.length < 3) throw new Error(`fewer than three open ${EMPLOYER} openings with no description were found (${person.saved.length})`);
  say('test person', { subject, saved: person.saved });
}

/** @description The API half of `check`: read one saved job's description through the kernel and read it back. */
async function checkAnswers(origin, person, fail) {
  const notes = [];
  for (const id of person.saved) {
    const before = (await http(origin, person.token, 'GET', `/api/career-hunter/jobs/${id}`)).body.job;
    if (/\S/.test(String(before.description || ''))) { notes.push(`job ${id} already has a description`); continue; }
    const answer = await http(origin, person.token, 'POST', `/api/career-hunter/jobs/${id}/details`, { body: {}, accepted: [200, 403, 404, 409] });
    if (answer.status !== 200) { fail(`POST /jobs/${id}/details answered ${answer.status}${answer.body && answer.body.error ? ' ' + answer.body.error : ''}`); return { readJob: null, notes }; }
    const read = answer.body;
    if (!read.ok) { notes.push(`job ${id}: ${read.reason}`); continue; }
    const after = (await http(origin, person.token, 'GET', `/api/career-hunter/jobs/${id}`)).body.job;
    if (String(read.description).length < 200) fail(`job ${id}: a description of ${String(read.description).length} characters`);
    if (read.description_context?.kept !== true) fail(`job ${id}: the description was not kept`);
    if (after.description !== read.description || after.description_context?.basis !== 'employer-detail') fail(`job ${id}: GET /jobs/${id} does not show the description it kept`);
    return { readJob: id, characters: String(read.description).length, view: await checkViewRead(origin, person, id, fail), notes };
  }
  fail(`no saved ${EMPLOYER} opening could be read: ${notes.join('; ')}`);
  return { readJob: null, notes };
}

/** @description GET /jobs/:id?details=read on another saved opening reads it for the view through the kernel and keeps nothing. */
async function checkViewRead(origin, person, readJob, fail) {
  const id = person.saved.find((other) => other !== readJob);
  const view = (await http(origin, person.token, 'GET', `/api/career-hunter/jobs/${id}?details=read`)).body;
  const plain = (await http(origin, person.token, 'GET', `/api/career-hunter/jobs/${id}`)).body.job;
  if (view.details_read) return { job: id, reason: view.details_read.reason };
  if (String(view.job.description || '').length < 200 || view.job.description_context?.kept !== false) fail(`job ${id}: the view read gave ${String(view.job.description || '').length} characters`);
  if (/\S/.test(String(plain.description || ''))) fail(`job ${id}: a view read kept a copy`);
  return { job: id, characters: String(view.job.description || '').length };
}

/** @description A browser context signed in as the person by a cookie session (the credential never enters a page). */
async function signIn(browser, origin, person, size, sessions) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: Boolean(size.touch), hasTouch: Boolean(size.touch), deviceScaleFactor: size.touch ? 2.625 : 1 });
  const response = await context.request.post(`${origin}/sessions`, { data: { token: person.token } });
  if (response.status() !== 201) throw new Error(`sign-in answered ${response.status()}`);
  const issued = await response.json();
  if (issued.principal !== person.principal) throw new Error('sign-in made another principal');
  sessions.push(issued.session);
  return context;
}

/** @description Sign every session this run made out again. */
async function signOut(origin, sessions) {
  let out = 0;
  for (const session of sessions) { try { await http(origin, session, 'DELETE', '/sessions', { accepted: [200, 204] }); out += 1; } catch (error) { say('sign-out failed', { message: message(error) }); } }
  return out;
}

/** @description The page half of `check`: on My jobs in Today, open one saved job's posting sheet and read its description. */
async function checkSheet(browser, origin, person, size, id, out, sessions, fail) {
  const context = await signIn(browser, origin, person, size, sessions), stopped = [], allowed = [];
  await context.route((u) => new URL(u).origin === origin, (route) => {
    const request = route.request(), where = new URL(request.url()).pathname;
    if (request.method() === 'GET' || request.method() === 'HEAD') return route.continue();
    if (request.method() === 'POST' && /^\/api\/career-hunter\/jobs\/\d+\/details$/.test(where)) { allowed.push(where); return route.continue(); }
    let from = ''; try { from = new URL(request.frame().url()).pathname; } catch { from = ''; }
    stopped.push(`${request.method()} ${where} (from ${from})`);
    return route.abort();
  });
  const page = await context.newPage(), errors = [], label = `${size.width}x${size.height}`;
  let reading = '';
  page.on('pageerror', (error) => errors.push(message(error).slice(0, 160)));
  try {
    await page.goto(origin + MY_JOBS, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const board = await until(() => page.frames().find((frame) => BOARD.test(frame.url())), 90000, 'My jobs');
    const title = board.locator(`[data-job-id="${id}"] button.job-title, button.jt-title[data-posting="${id}"]`).first();
    await title.waitFor({ timeout: 90000 });
    await title.click();
    const sheet = board.locator('dialog.edit-dialog[open]');
    // The reading line shows while the kernel reads the posting; a fast read can end before it is seen, so it is noted only.
    reading = await sheet.locator('.posting-reading').innerText({ timeout: 5000 }).catch(() => '');
    await sheet.locator('.posting-text, .posting-missing').first().waitFor({ timeout: 60000 });
    const text = await sheet.locator('.posting-text').innerText().catch(() => '');
    if (reading && !reading.startsWith(`Reading the job description from ${EMPLOYER}`)) fail(`${label}: job ${id}: the reading line says ${JSON.stringify(reading.slice(0, 80))}`);
    if (text.length < 200) fail(`${label}: job ${id}: the sheet shows ${text.length} characters of description: ${JSON.stringify((await sheet.innerText()).slice(-200))}`);
    if (/No description was provided/.test(await sheet.innerText())) fail(`${label}: job ${id}: the sheet still says No description was provided`);
    if (await board.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) fail(`${label}: the page scrolls sideways`);
    await page.screenshot({ path: path.join(out, `job-details-sheet-${label}.png`) });
  } catch (error) { fail(`${label}: ${message(error)}`); }
  const own = stopped.filter((line) => /\(from \/api\/career-hunter\//.test(line));
  if (own.length) fail(`${label}: the page tried other writes: ${own.join('; ')}`);
  await context.close();
  return { size: label, job: id, readingLineSeen: Boolean(reading), descriptionReads: allowed.length, stopped, errors };
}

/** @description `check`: exit 0 when a saved Torch posting's description is read, kept and shown on My jobs. */
async function check(origin, file, out) {
  const person = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  const receipt = { origin, at: new Date().toISOString(), subject: person.subject, failures: [], pages: [] };
  const fail = (why) => receipt.failures.push(why);
  receipt.answers = await checkAnswers(origin, person, fail);
  const left = person.saved.filter((id) => id !== receipt.answers.readJob);
  const browser = await playwright().chromium.launch({ headless: true }), sessions = [];
  try {
    for (const [index, size] of SIZES.entries()) {
      if (!left[index]) { fail(`no saved opening left for the ${size.width}px sheet`); continue; }
      receipt.pages.push(await checkSheet(browser, origin, person, size, left[index], out, sessions, fail));
    }
  } finally { await browser.close(); receipt.signedOut = await signOut(origin, sessions); }
  fs.writeFileSync(path.join(out, 'career-job-details-live.json'), JSON.stringify(receipt, null, 2));
  say('check', receipt);
  return receipt.failures.length ? 1 : 0;
}

/** @description `remove`: take the grants back and deactivate the test person. */
async function remove(origin, envFile, file) {
  const admin = adminToken(envFile), person = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const held of person.grants || []) await grant(origin, admin, person.principal, held, 'revoke').catch((error) => say('revoke failed', { message: message(error) }));
  const confirmation = (await http(origin, admin, 'POST', '/confirmations', { body: {} })).body;
  await http(origin, admin, 'POST', `/people/${person.principal}/deactivate`, { body: {}, headers: { 'x-oshal-confirm': confirmation.confirmation } });
  await http(origin, person.token, 'GET', '/api/authorization/me', { accepted: [401, 403] });
  fs.rmSync(file, { force: true });
  say('test person removed', { subject: person.subject, grantsRevoked: (person.grants || []).length });
}

const [mode, base, second, third] = process.argv.slice(2);
try {
  const origin = loopback(base);
  if (mode === 'person' && second && third) await makePerson(origin, second, third);
  else if (mode === 'check' && second && third) process.exitCode = await check(origin, second, third);
  else if (mode === 'remove' && second && third) await remove(origin, second, third);
  else throw new Error('usage: person <base> <env file> <person file> | check <base> <person file> <out folder> | remove <base> <env file> <person file>');
} catch (error) {
  console.error(`career-job-details-live-proof: ${message(error)}`);
  process.exitCode = 1;
}
