#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.0 (Roger, 2026-11-16: "select multiple rows on a table and push all the applications to prepare application ... bulk select for all of the subsequent screens as well"). My jobs' Table view on an installed Career, on the test slot, as a test person with a made-up résumé and a few saved public postings, at 1440x900 and 412x915 (touch). The person signs in on the real /login page with an access token. `check` stops every request that is not GET or HEAD and lists it, except that sign-in and, with --prepare, this test person's own two preparation writes for two of their saved jobs; it exits 0 when the Table shows the saved jobs with their columns, is remembered after a reload, select all follows a filter, the bar counts the selection, and (with --prepare) both preparations end Prepared or Failed with words on their rows and in the overall line. `--preview <store root>` serves My jobs' page files from a store checkout over the slot's real answers, to see a branch before it is delivered. `person` makes the test person once (an invitation, the Job seeker role, the made-up résumé through Career's own upload and indexing, six saved postings); `remove` takes its grants back and deactivates it.
 *
 * Usage (a loopback kernel only; the administrator credential is read by name from the env file and never printed, the
 * person's credential stays in its 0600 file and is typed only into the slot's own sign-in page):
 *   node career-hunter/tests/career-bulk-select-live-proof.mjs person http://127.0.0.1:38798 <slot env file> <person file>
 *   node career-hunter/tests/career-bulk-select-live-proof.mjs check  http://127.0.0.1:38798 <person file> <out folder> [--preview <store root>] [--prepare]
 *   node career-hunter/tests/career-bulk-select-live-proof.mjs remove http://127.0.0.1:38798 <slot env file> <person file>
 * Playwright comes from STORE_CI_TOOLCHAIN or the store's scripts/toolchain (npm ci --prefix scripts/toolchain).
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { playwright } from './helpers/ux-page.mjs';

const BOARD_LINK = '/cockpit/?app=career-hunter&screen=career-board';
const BOARD = /\/api\/career-hunter\/board-native/;
const SIZES = [{ name: 'desktop', width: 1440, height: 900, touch: false }, { name: 'phone', width: 412, height: 915, touch: true }];
// A made-up résumé; nothing here is anyone's data.
const RESUME = `Sam Example
Operations manager | Sampletown, USA | sam.example@example.com
SUMMARY
Runs offices and operations teams for growing companies (a made-up résumé for a test).
EXPERIENCE
Operations Manager, Example Logistics, 2020-02 to present
- Runs a team of eight across scheduling, purchasing and facilities.
- Cut vendor costs 14% by consolidating suppliers.
Office Manager, Placeholder Health, 2016-05 to 2020-01
- Opened two new clinics on time and on budget.
- Set up the onboarding checklist used for every new hire.
SKILLS
Scheduling, vendor management, budgeting, Excel
EDUCATION
B.A. Business, Sample State University, 2015
`;

const say = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const message = (error) => String((error && error.message) || error).split('\n')[0].slice(0, 300);

/** @description The loopback kernel's origin, or a refusal. @param {string} base An address. @returns {string} */
function loopback(base) {
  const origin = new URL(String(base || '')).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('this proof runs only against a loopback kernel, http://127.0.0.1:<port>');
  return origin;
}
/** @description The writing modes run on a test slot only, never on the production kernel's port. */
function testSlot(origin) { if (new URL(origin).port === '38788') throw new Error('person and remove write; they run on the test slot (http://127.0.0.1:38798), never on production'); return origin; }
/** @description The administrator credential from an env file, by name; never printed. */
function adminToken(file) {
  const line = fs.readFileSync(file, 'utf8').split('\n').find((value) => value.startsWith('OSHAL_ADMIN_TOKEN='));
  if (!line) throw new Error('the env file names no OSHAL_ADMIN_TOKEN');
  return line.slice('OSHAL_ADMIN_TOKEN='.length).trim().replace(/^(['"])(.*)\1$/, '$2');
}
/** @description A JSON file only this user can read. */
function privateWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}
/**
 * @description One request to the kernel's own origin; a failure names the method, the route and the status, nothing else.
 * @returns {Promise<{status:number, body:any}>}
 */
async function http(origin, credential, method, route, { body, form, accepted = [200] } = {}) {
  const url = new URL(route, origin);
  if (url.origin !== origin) throw new Error('refusing a request outside the kernel');
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(240000),
    headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : form ? { body: form } : {}) });
  const text = await response.text();
  if (!accepted.includes(response.status)) throw new Error(`${method} ${route.split('?')[0].replace(/\/people\/invitations\/[^/]+\/accept/, '/people/invitations/:private/accept')}: ${response.status}`);
  try { return { status: response.status, body: JSON.parse(text) }; } catch { return { status: response.status, body: null }; }
}
/** @description Assign or take back one application role (preview, then apply; a revoke is apply alone). */
async function grant(origin, admin, principal, held, action = 'assign') {
  const catalog = (await http(origin, admin, 'GET', '/api/authorization/composites')).body;
  const input = { target: principal, assignment_id: held.id, action, expected_revision: catalog.revision, reason: 'Career bulk select proof (test person)',
    idempotency_key: randomUUID(), ...(action === 'revoke' ? {} : { selection: { kind: 'granular', app: held.app, role: held.role } }) };
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
    await wait(500);
  }
}

/** @description Six public postings for the person to save: some remote, some with a place. */
async function pickPostings(origin, token) {
  const found = new Map();
  for (const q of ['operations manager', 'office manager', 'project coordinator']) {
    const page = (await http(origin, token, 'GET', `/api/career-hunter/browse?q=${encodeURIComponent(q)}&per=25`)).body;
    for (const job of (page && page.jobs) || []) if (job && Number(job.id) > 0 && !found.has(job.id)) found.set(job.id, job);
  }
  const jobs = [...found.values()], remote = jobs.filter((job) => Number(job.remote) === 1), placed = jobs.filter((job) => Number(job.remote) !== 1 && job.location);
  return [...remote.slice(0, 2), ...placed.slice(0, 4)].slice(0, 6).map((job) => job.id);
}

/**
 * @description A new person has no Career store until Career's first run of theirs; saving a job needs one. Save three
 * made-up target titles and start one manual score (at most one job, as a background run), then wait for the store.
 */
async function ensureStore(origin, person) {
  const ready = async () => { const stats = (await http(origin, person.token, 'GET', '/api/career-hunter/jobs/stats')).body; return stats && stats.empty !== true; };
  if (await ready()) return;
  await http(origin, person.token, 'POST', '/api/career-hunter/settings/title-profile', { body: { terms: ['Operations Manager', 'Office Manager', 'Project Coordinator'] } });
  await http(origin, person.token, 'POST', '/api/career-hunter/run/score', { body: { limit: 1 }, accepted: [200, 202] });
  await until(ready, 300000, "the person's Career store");
}

/** @description The person file when its credential still answers and the made-up résumé is indexed; else null. */
async function existing(origin, file) {
  if (!fs.existsSync(file)) return null;
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const me = await http(origin, saved.token, 'GET', '/api/career-hunter/resume/state', { accepted: [200, 401, 403] }).catch(() => ({ status: 0 }));
  return me.status === 200 && me.body && me.body.hasResume ? { saved: [], ...saved } : null;
}

/** @description A new test person: an invitation, the Job seeker role, and the made-up résumé through Career's own upload and indexing. */
async function newPerson(origin, admin, file) {
  const subject = `careerbulk1-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const invite = (await http(origin, admin, 'POST', '/people/invitations', { body: { invitee: subject, tier: 'editor', lifetime_ms: 3600000 } })).body;
  const accepted = (await http(origin, '', 'POST', `/people/invitations/${encodeURIComponent(invite.token)}/accept`, { body: { subject, display_name: 'Sam Example (test)' } })).body;
  const person = { base: origin, subject, principal: accepted.principal, token: accepted.token, grants: [], saved: [] };
  privateWrite(file, person);
  const held = { id: `careerbulk1-career-hunter-${randomUUID().slice(0, 8)}`, app: 'career-hunter', role: 'member' };
  await grant(origin, admin, person.principal, held);
  person.grants.push(held); privateWrite(file, person);
  await http(origin, person.token, 'POST', '/packages/career-hunter/schema', { body: {} });
  const form = new FormData();
  form.append('resume', new Blob([RESUME], { type: 'text/plain' }), 'sam-example-resume.txt');
  await http(origin, person.token, 'POST', '/api/career-hunter/resume/upload', { form, accepted: [200, 202] });
  await until(async () => { const state = (await http(origin, person.token, 'GET', '/api/career-hunter/resume/state')).body; return state && state.hasResume === true && !state.indexing; }, 900000, 'Career indexing the made-up résumé');
  return person;
}

/** @description `person`: make (or carry on with) the test person: Job seeker, the made-up résumé, a Career store, six saved postings. */
async function makePerson(origin, envFile, file) {
  const person = (await existing(origin, file)) || await newPerson(origin, adminToken(envFile), file);
  await ensureStore(origin, person);
  if (!person.saved.length) {
    for (const id of await pickPostings(origin, person.token)) {
      await http(origin, person.token, 'POST', `/api/career-hunter/jobs/${id}/status`, { body: { favorite: true } });
      person.saved.push(id); privateWrite(file, person);
    }
  }
  say('test person', { subject: person.subject, grants: (person.grants || []).map((g) => `${g.app}:${g.role}`), saved: person.saved.length });
}

/** @description My jobs' page files from a store checkout, for --preview. */
function previewFile(root, pathname) {
  const tools = path.join(root, 'career-hunter/tools');
  if (pathname === '/api/career-hunter/board-native') return path.join(tools, 'career-job-lists.html');
  const asset = pathname.match(/^\/api\/career-hunter\/static\/([\w.-]+)$/);
  if (!asset) return null;
  const full = path.resolve(tools, asset[1]);
  return full.startsWith(tools + path.sep) && fs.existsSync(full) ? full : null;
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

/**
 * @description Stop every request that is not a read, except sign-in and (when asked) this person's own preparation writes for
 * the jobs named; list what was stopped and from which page.
 */
async function guard(context, origin, preview, allowed, stopped, writes) {
  await context.route((u) => new URL(u).origin === origin, async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (method !== 'GET' && method !== 'HEAD') {
      const own = url.pathname.match(/^\/api\/career-hunter\/jobs\/(\d+)\/(status|generate)$/), body = request.postData() || '';
      const sign = method === 'POST' && url.pathname === '/sessions';
      const prepare = own && allowed.has(Number(own[1])) && method === 'POST' && (own[2] === 'generate' || body === JSON.stringify({ status: 'promoted', favorite: true }));
      if (!sign && !prepare) {
        let from = ''; try { from = new URL(request.frame().url()).pathname; } catch { from = ''; }
        stopped.push(`${method} ${url.pathname} (from ${from})`);
        return route.abort();
      }
      if (prepare) writes.push(`${method} ${url.pathname}`);
    }
    const local = preview ? previewFile(preview, url.pathname) : null;
    if (local) return route.fulfill({ status: 200, path: local, contentType: TYPES[path.extname(local)] || 'text/javascript; charset=utf-8', headers: { 'cache-control': 'no-store' } });
    return route.continue();
  });
}

/** @description Sign in on the slot's own /login page with the access token, then open My jobs in the cockpit. */
async function signInAndOpen(page, origin, person) {
  await page.goto(`${origin}/login?next=${encodeURIComponent(BOARD_LINK)}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('#loginTokenBox > summary').click();
  await page.locator('#loginTokenValue').fill(person.token);
  await page.locator('#loginToken button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname.startsWith('/cockpit'), { timeout: 90000 });
  return until(async () => { const f = page.frames().find((frame) => BOARD.test(frame.url())); return f && (await f.locator('#jobsViewSwitch').isVisible().catch(() => false)) && f; }, 120000, 'My jobs with its List | Table switch');
}

/** @description Facts of the Table as drawn: rows, header, the sample of places, and whether anything is wider than the screen. */
function readTable(frame) {
  return frame.evaluate(() => ({ rows: document.querySelectorAll('#jobsTable [data-id]').length,
    header: [...document.querySelectorAll('#jobsTable thead th')].map((th) => th.textContent.trim()),
    places: [...document.querySelectorAll('#jobsTable .jt-col-location, #jobsTable .jt-meta')].slice(0, 6).map((el) => el.textContent.trim().split(' · ')[0]),
    sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth }));
}

/** @description Press Prepare applications for two jobs that have no résumé yet, and wait for both to end with words. */
async function prepareTwo(frame, page, out, size, row) {
  const ids = await frame.evaluate(() => [...document.querySelectorAll('#jobsTable [data-id]')].filter((el) => /Not prepared/.test(el.querySelector('[data-resume-cell]').textContent)).slice(0, 2).map((el) => Number(el.dataset.id)));
  if (ids.length < 2) { row.failures.push('fewer than two saved jobs without a résumé to prepare'); return; }
  for (const id of ids) await frame.locator(`[data-select="${id}"]`).check();
  await frame.locator('#bulkBar').getByRole('button', { name: 'Prepare applications' }).click();
  await frame.locator('#bulkProgress').getByText('Prepare applications').waitFor({ timeout: 30000 });
  await page.screenshot({ path: path.join(out, `${size.name}-preparing.png`) });
  const ended = await until(async () => {
    const words = await frame.evaluate((list) => list.map((id) => document.querySelector(`#jobsTable [data-id="${id}"] [data-resume-cell]`).textContent.trim()), ids);
    return words.every((text) => /^(Prepared|Failed)/.test(text)) && words;
  }, 20 * 60000, 'both preparations to end').catch((error) => { row.failures.push(message(error)); return null; });
  row.prepared = { ids, ended, overall: (await frame.locator('#bulkProgress').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300) };
  await page.screenshot({ path: path.join(out, `${size.name}-prepared.png`) });
}

/** @description One size: sign in, open My jobs, show the Table, check it, follow a filter with select all, and (desktop, --prepare) prepare two. */
async function checkSize(browser, origin, person, size, out, preview, prepare, receipt) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.touch, hasTouch: size.touch, deviceScaleFactor: size.touch ? 2.625 : 1 });
  const stopped = [], writes = [], row = { size: `${size.width}x${size.height}`, failures: [], stopped, writes };
  receipt.sizes.push(row);
  try {
    await guard(context, origin, preview, new Set(prepare && size.name === 'desktop' ? person.saved : []), stopped, writes);
    const page = await context.newPage();
    let frame = await signInAndOpen(page, origin, person);
    await frame.getByRole('tab', { name: 'Table' }).click();
    await frame.locator('#jobsTable [data-id]').first().waitFor({ timeout: 60000 });
    Object.assign(row, await readTable(frame));
    await page.screenshot({ path: path.join(out, `${size.name}-table.png`) });
    if (row.rows < person.saved.length) row.failures.push(`the Table shows ${row.rows} of ${person.saved.length} saved jobs`);
    if (size.name === 'desktop' && row.header.slice(1, 8).join('|').replace(/[▲▼]/g, '') !== 'Company|Title|Location|Match|Stage|Saved|Résumé') row.failures.push(`columns: ${row.header.join('|')}`);
    if (row.sideways) row.failures.push('the page scrolls sideways');
    await page.reload({ waitUntil: 'domcontentloaded' });
    frame = await until(async () => { const f = page.frames().find((one) => BOARD.test(one.url())); return f && (await f.locator('#jobsTable [data-id]').first().isVisible().catch(() => false)) && f; }, 120000, 'the Table after a reload');
    await frame.locator('#jtResume').selectOption('none');
    const shown = await frame.locator('#jobsTable [data-id]').count();
    await frame.locator('#jtAll').check();
    const counted = await frame.locator('#bulkBar .jt-selected').innerText();
    if (counted !== `${shown} selected`) row.failures.push(`select all within "Not prepared" counted "${counted}" for ${shown} rows`);
    await page.screenshot({ path: path.join(out, `${size.name}-selected.png`) });
    const bar = await frame.locator('#bulkBar').boundingBox();
    row.bar = bar && { top: Math.round(bar.y), bottom: Math.round(bar.y + bar.height) };
    if (!bar || bar.y + bar.height > size.height) row.failures.push('the selected-rows bar is not on the screen');
    await frame.locator('#bulkBar').getByRole('button', { name: 'Clear the selection' }).click();
    await frame.locator('#jtResume').selectOption('');
    if (prepare && size.name === 'desktop') await prepareTwo(frame, page, out, size, row);
    const own = stopped.filter((line) => /\(from \/api\/career-hunter\//.test(line));
    if (own.length) row.failures.push(`the page tried to write: ${own.join('; ')}`);
  } catch (error) { row.failures.push(message(error)); }
  finally {
    const cookies = await context.cookies(origin).catch(() => []);
    for (const cookie of cookies.filter((one) => /session/i.test(one.name))) await http(origin, cookie.value, 'DELETE', '/sessions', { accepted: [200, 204, 401] }).catch(() => {});
    await context.close();
  }
}

/** @description `check`: the Table at 1440 and 412 as the test person; exit 0 when it meets 1.68.0's bar. */
async function check(origin, file, out, preview, prepare) {
  const person = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  const served = await http(origin, person.token, 'GET', '/api/career-hunter/_smoke', { accepted: [200, 401, 403, 404] }).catch(() => ({ body: null }));
  const receipt = { origin, at: new Date().toISOString(), career: served.body && served.body.version, preview: Boolean(preview), prepare, sizes: [] };
  const browser = await playwright().chromium.launch({ headless: true });
  try { for (const size of SIZES) await checkSize(browser, origin, person, size, out, preview, prepare, receipt); }
  finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'career-bulk-select-live.json'), JSON.stringify(receipt, null, 2));
  say('check', receipt);
  return receipt.sizes.some((row) => row.failures.length) ? 1 : 0;
}

/** @description `remove`: take the grants back and deactivate the test person. */
async function remove(origin, envFile, file) {
  const admin = adminToken(envFile), person = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const held of person.grants || []) await grant(origin, admin, person.principal, held, 'revoke').catch((error) => say('revoke failed', { message: message(error) }));
  const confirmation = (await http(origin, admin, 'POST', '/confirmations', { body: {} })).body;
  await fetch(new URL(`/people/${person.principal}/deactivate`, origin), { method: 'POST', headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json', 'x-oshal-confirm': confirmation.confirmation }, body: '{}' });
  await http(origin, person.token, 'GET', '/api/authorization/me', { accepted: [401, 403] });
  fs.rmSync(file, { force: true });
  say('test person removed', { subject: person.subject, grantsRevoked: (person.grants || []).length });
}

const [mode, base, second, third, ...flags] = process.argv.slice(2);
try {
  const origin = mode === 'check' ? loopback(base) : testSlot(loopback(base));
  const previewAt = flags.indexOf('--preview'), preview = previewAt >= 0 ? path.resolve(flags[previewAt + 1] || '') : '';
  if (mode === 'person' && second && third) await makePerson(origin, second, third);
  else if (mode === 'check' && second && third) process.exitCode = await check(origin, second, third, preview, flags.includes('--prepare') && new URL(origin).port !== '38788');
  else if (mode === 'remove' && second && third) await remove(origin, second, third);
  else throw new Error('usage: person <base> <env file> <person file> | check <base> <person file> <out folder> [--preview <store root>] [--prepare] | remove <base> <env file> <person file>');
} catch (error) {
  console.error(`career-bulk-select-live-proof: ${message(error)}`);
  process.exitCode = 1;
}
