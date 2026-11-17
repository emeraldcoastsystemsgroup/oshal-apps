#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.67.4 (Roger, 2026-11-16: "the job location doesnt transfer to the my jobs page and i cant look at jobs near me"). My jobs on an installed Career, on the test slot, as a test person with a made-up résumé and a made-up home (Bend, OR): `person` makes the person, records what GET /jobs says before a home is set (no home: the line and the refusal), sets the home, and saves a few public openings from Find jobs (some near, one fully remote) with the place Find jobs showed; `check` (read-only) compares My jobs with what Find jobs showed, checks Within 25 miles, Remote only and nearest first, and opens My jobs in Today at 412x915 and 1440x900 to read each row's place line; `remove` takes it all back.
 *
 * Usage (a loopback kernel only; the administrator credential is read by name from the env file and never printed, the
 * person's credential stays in its 0600 file and never enters a page or a log; jobs are named by id only):
 *   node career-hunter/tests/career-saved-job-place-live-proof.mjs person http://127.0.0.1:38798 <slot env file> <person file>
 *   node career-hunter/tests/career-saved-job-place-live-proof.mjs check  http://127.0.0.1:38798 <person file> <out folder>
 *   node career-hunter/tests/career-saved-job-place-live-proof.mjs remove http://127.0.0.1:38798 <slot env file> <person file>
 * Playwright comes from STORE_CI_TOOLCHAIN or the store's scripts/toolchain (npm ci --prefix scripts/toolchain).
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { playwright } from './helpers/ux-page.mjs';

const HOME = 'Bend, OR';
const BOARD = /\/api\/career-hunter\/board-native/;
const MY_JOBS = '/cockpit/?app=career-hunter&screen=career-board';
const SIZES = [{ width: 412, height: 915, touch: true }, { width: 1440, height: 900 }];
// A made-up résumé, so Career makes the person's store; nothing here is anyone's data.
const RESUME = `Sam Placeholder
Operations coordinator | Sampletown, USA | sam.placeholder@example.com
SUMMARY
Keeps warehouses and field teams on schedule (a made-up résumé for a test).
EXPERIENCE
Operations Coordinator, Example Logistics, 2020-01 to present
- Scheduled crews for 30 sites and cut overtime by a fifth.
- Ran the weekly safety review and its follow-ups.
Shift Lead, Demo Distribution, 2016-05 to 2019-12
- Led a team of twelve on the night shift.
- Set up the returns process used by every shift.
SKILLS
Scheduling, inventory systems, safety programs
EDUCATION
A.S. Business, Sample Community College, 2016
`;

const say = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const message = (error) => String((error && error.message) || error).split('\n')[0].slice(0, 300);
const one = (value) => Math.round(value * 10) / 10;

/** @description The loopback kernel's origin, or a refusal. @param {string} base An address. @returns {string} The origin. */
function loopback(base) {
  const origin = new URL(String(base || '')).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('this proof runs only against a loopback kernel, http://127.0.0.1:<port>');
  return origin;
}

/** @description The writing modes run on a test slot only, never on the production kernel's port. */
function testSlot(origin) {
  if (new URL(origin).port === '38788') throw new Error('person and remove write; they run on the test slot (http://127.0.0.1:38798), never on production');
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
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: response.status, body: parsed };
}

/** @description Assign or take back one application role for the person (preview, then apply). */
async function grant(origin, admin, principal, held, action = 'assign') {
  const catalog = (await http(origin, admin, 'GET', '/api/authorization/composites')).body;
  const input = { target: principal, assignment_id: held.id, action, expected_revision: catalog.revision,
    reason: 'Career My jobs place and near-me proof (test person)', idempotency_key: randomUUID(),
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

/** @description Straight-line miles, written out here so the route is checked against arithmetic it did not do. */
function miles(a, b) {
  const r = (d) => d * Math.PI / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * 3958.7613 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

/** @description What GET /jobs says before any home is set: the `home` it answers and how it meets Within 25 miles. */
async function noHomeState(origin, token) {
  const list = await http(origin, token, 'GET', '/api/career-hunter/jobs?status=saved&per=10', { accepted: [200] });
  const near = await http(origin, token, 'GET', '/api/career-hunter/jobs?status=saved&within=25', { accepted: [200, 400] });
  return { home: list.body && list.body.home, within25: { status: near.status, error: near.body && near.body.error } };
}

/** @description Up to `count` openings from Find jobs: near the made-up home (on-site, with a point), or fully remote. */
async function findJobs(origin, token, remote, count) {
  const tries = remote ? ['/api/career-hunter/browse?remote=1&per=50&sort=recent']
    : [60, 120, 250].map((radius) => `/api/career-hunter/browse?near=${encodeURIComponent(HOME)}&radius_miles=${radius}&remote=0&per=50&sort=recent`);
  for (const route of tries) {
    const jobs = ((await http(origin, token, 'GET', route)).body || {}).jobs || [];
    const fit = jobs.filter((job) => (remote ? job.remote : !job.remote && typeof job.lat === 'number' && typeof job.distance_miles === 'number'));
    if (fit.length >= count) return fit.slice(0, count);
  }
  throw new Error(`Find jobs gave fewer than ${count} ${remote ? 'fully remote' : 'nearby'} openings`);
}

/** @description `person`: make (or reuse) the test person, record the no-home state, set the home, save openings. */
async function makePerson(origin, envFile, file) {
  const admin = adminToken(envFile);
  if (fs.existsSync(file)) { say('test person kept', { subject: JSON.parse(fs.readFileSync(file, 'utf8')).subject }); return; }
  const subject = `careerloc1-saved-place-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const invite = (await http(origin, admin, 'POST', '/people/invitations', { body: { invitee: subject, tier: 'editor', lifetime_ms: 3600000 } })).body;
  const accepted = (await http(origin, '', 'POST', `/people/invitations/${encodeURIComponent(invite.token)}/accept`, { body: { subject, display_name: 'Sam Placeholder (test)' } })).body;
  const person = { base: origin, subject, principal: accepted.principal, token: accepted.token, grants: [], saved: [] };
  privateWrite(file, person);
  const held = { id: `careerloc1-career-hunter-${randomUUID().slice(0, 8)}`, app: 'career-hunter', role: 'member' };
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
  await http(origin, person.token, 'POST', '/api/career-hunter/settings/title-profile', { body: { terms: 'Operations Coordinator\nShift Lead' } });
  await http(origin, person.token, 'POST', '/api/career-hunter/run/score', { body: { limit: 1 }, accepted: [200, 202] });
  await until(async () => {
    const runs = ((await http(origin, person.token, 'GET', '/api/career-hunter/runs')).body || {}).runs || [];
    const list = (await http(origin, person.token, 'GET', '/api/career-hunter/jobs?status=saved&per=1')).body;
    return !runs.some((run) => run.state === 'running') && list && list.empty !== true;
  }, 1200000, 'the first match making the person\'s Career store');
  person.noHome = await noHomeState(origin, person.token);
  const saved = (await http(origin, person.token, 'POST', '/api/career-hunter/settings/title-profile', { body: { scope: { near: HOME, radiusMiles: 50, includeRemote: true } } })).body;
  person.home = { label: saved.searchScope.near, lat: saved.searchScope.lat, lon: saved.searchScope.lon };
  const picks = [...await findJobs(origin, person.token, false, 4), ...await findJobs(origin, person.token, true, 1)];
  for (const job of picks) {
    await until(async () => (await http(origin, person.token, 'POST', `/api/career-hunter/jobs/${job.id}/status`, { body: { favorite: true }, accepted: [200, 409] })).status === 200, 120000, `saving job ${job.id}`);
    person.saved.push({ id: Number(job.id), location: typeof job.location === 'string' ? job.location.trim() : null, lat: job.lat ?? null,
      lon: job.lon ?? null, remote: Boolean(job.remote), shownMiles: job.distance_miles ?? null });
    privateWrite(file, person);
  }
  privateWrite(file, person);
  say('test person', { subject, home: person.home.label, saved: person.saved.map((job) => job.id), noHome: person.noHome });
}

/** @description The API half of `check`: My jobs against what Find jobs showed, Within, Remote only and nearest first. */
async function checkAnswers(origin, person, fail) {
  const get = async (query) => (await http(origin, person.token, 'GET', `/api/career-hunter/jobs?status=saved&per=100${query}`, { accepted: [200, 400] }));
  const all = await get('');
  if (all.status !== 200) return fail(`My jobs answered ${all.status}`), {};
  const home = all.body.home || {};
  if (home.known !== true || home.label !== person.home.label) fail(`home is ${JSON.stringify(home && { known: home.known, label: home.label })}`);
  const mine = new Map((all.body.jobs || []).map((job) => [Number(job.id), job]));
  const expected = new Map();
  for (const job of person.saved) {
    const row = mine.get(job.id);
    if (!row) { fail(`job ${job.id} is not on My jobs`); continue; }
    const want = job.remote ? null : one(miles(person.home, job));
    expected.set(job.id, want);
    if (row.location !== job.location) fail(`job ${job.id}: place text differs from Find jobs`);
    if (row.lat !== job.lat || row.lon !== job.lon) fail(`job ${job.id}: map point differs from Find jobs`);
    if (job.remote ? row.workplaceType !== 'remote' : row.workplaceType === 'remote') fail(`job ${job.id}: workplaceType ${row.workplaceType}`);
    if (want === null ? row.distanceMiles !== null : !(Math.abs(row.distanceMiles - want) <= 0.051)) fail(`job ${job.id}: ${row.distanceMiles} miles, expected ${want}`);
    if (!job.remote && typeof job.shownMiles === 'number' && Math.abs(row.distanceMiles - one(job.shownMiles)) > 0.11) fail(`job ${job.id}: Find jobs showed ${one(job.shownMiles)} miles`);
  }
  const within = await get('&within=25'), within25 = (within.body.jobs || []).map((job) => Number(job.id)).sort((a, b) => a - b);
  const want25 = [...expected].filter(([, value]) => value !== null && value <= 25).map(([id]) => id).sort((a, b) => a - b);
  if (within.status !== 200 || JSON.stringify(within25) !== JSON.stringify(want25)) fail(`Within 25 miles gave ${JSON.stringify(within25)}, expected ${JSON.stringify(want25)}`);
  const remote = await get('&within=remote'), remoteIds = (remote.body.jobs || []).map((job) => Number(job.id));
  if (!person.saved.filter((job) => job.remote).every((job) => remoteIds.includes(job.id)) || person.saved.some((job) => !job.remote && remoteIds.includes(job.id))) fail('Remote only is not exactly the fully remote jobs');
  const sorted = await get('&sort=distance'), distances = (sorted.body.jobs || []).map((job) => job.distanceMiles);
  const known = distances.filter((value) => value !== null);
  if (sorted.status !== 200 || known.some((value, index) => index && value < known[index - 1]) || distances.indexOf(null) !== -1 && distances.slice(distances.indexOf(null)).some((value) => value !== null)) fail('nearest first is out of order');
  return { saved: mine.size, within25: within25.length, remoteOnly: remoteIds.length, expected: Object.fromEntries(expected) };
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

/** @description The page half of `check`: My jobs in Today at one size, each saved row's place line, every write stopped. */
async function checkPage(browser, origin, person, size, out, sessions, fail, expected) {
  const context = await signIn(browser, origin, person, size, sessions), stopped = [];
  await context.route((u) => new URL(u).origin === origin, (route) => {
    const request = route.request();
    if (request.method() === 'GET' || request.method() === 'HEAD') return route.continue();
    let from = ''; try { from = new URL(request.frame().url()).pathname; } catch { from = ''; }
    stopped.push(`${request.method()} ${new URL(request.url()).pathname} (from ${from})`);
    return route.abort();
  });
  const page = await context.newPage(), errors = [], label = `${size.width}x${size.height}`;
  page.on('pageerror', (error) => errors.push(message(error).slice(0, 160)));
  try {
    await page.goto(origin + MY_JOBS, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const board = await until(() => page.frames().find((frame) => BOARD.test(frame.url())), 90000, 'My jobs');
    await board.locator('.job-row').first().waitFor({ timeout: 90000 });
    const rows = await board.evaluate(() => Object.fromEntries([...document.querySelectorAll('.job-row[data-job-id]')].map((row) => [row.dataset.jobId,
      ['job-place', 'job-work', 'job-distance'].map((kind) => row.querySelector('.meta .' + kind)?.textContent ?? null)])));
    for (const job of person.saved) {
      const line = rows[String(job.id)];
      if (!line) { fail(`${label}: job ${job.id} has no row`); continue; }
      if (line[0] !== (job.location || 'Location unknown') && !(job.remote && !job.location)) fail(`${label}: job ${job.id} has ${line[0] === null ? 'no place line (.job-place)' : 'another place in its place line'}`);
      if (job.remote ? line[1] !== 'Fully remote' : line[2] !== `${(expected[job.id] ?? 0).toLocaleString('en-US', { maximumFractionDigits: 1 })} mi from home`) fail(`${label}: job ${job.id} work and miles read ${JSON.stringify(line.slice(1))}`);
    }
    if (!(await board.locator('#within option').count())) fail(`${label}: no Within choice`);
    if (await board.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) fail(`${label}: the page scrolls sideways`);
    await page.screenshot({ path: path.join(out, `my-jobs-${label}.png`) });
  } catch (error) { fail(`${label}: ${message(error)}`); }
  const own = stopped.filter((line) => /\(from \/api\/career-hunter\//.test(line));
  if (own.length) fail(`${label}: My jobs tried to write: ${own.join('; ')}`);
  await context.close();
  return { size: label, stopped, errors };
}

/** @description `check`: read-only; exit 0 when My jobs carries each saved job's place and its miles from home. */
async function check(origin, file, out) {
  const person = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  const receipt = { origin, at: new Date().toISOString(), subject: person.subject, noHomeAtSetup: person.noHome, failures: [], pages: [] };
  const fail = (why) => receipt.failures.push(why);
  if (!person.noHome || !person.noHome.home || person.noHome.home.known !== false || person.noHome.within25.error !== 'home_location_required') {
    fail(`before a home was set, My jobs said ${JSON.stringify(person.noHome)}`);
  }
  receipt.answers = await checkAnswers(origin, person, fail);
  const browser = await playwright().chromium.launch({ headless: true }), sessions = [];
  try {
    for (const size of SIZES) receipt.pages.push(await checkPage(browser, origin, person, size, out, sessions, fail, receipt.answers.expected || {}));
  } finally { await browser.close(); receipt.signedOut = await signOut(origin, sessions); }
  fs.writeFileSync(path.join(out, 'career-saved-job-place-live.json'), JSON.stringify(receipt, null, 2));
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
  const origin = mode === 'check' ? loopback(base) : testSlot(loopback(base));
  if (mode === 'person' && second && third) await makePerson(origin, second, third);
  else if (mode === 'check' && second && third) process.exitCode = await check(origin, second, third);
  else if (mode === 'remove' && second && third) await remove(origin, second, third);
  else throw new Error('usage: person <base> <env file> <person file> | check <base> <person file> <out folder> | remove <base> <env file> <person file>');
} catch (error) {
  console.error(`career-saved-job-place-live-proof: ${message(error)}`);
  process.exitCode = 1;
}
