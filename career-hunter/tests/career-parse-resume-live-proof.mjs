#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.72.0 (Roger, 2026-11-21: "making sure there is a version of the resume that fills their stuff accurately .. we keep getting offset"). The check of the résumé for upload forms on an installed Career, on a test slot, as a test person. `person` makes a test person with a made-up résumé of four jobs (one held by year only). `check` prepares one job with the slot's real model, signs in as that person on the slot's own sign-in page at 1440x900 and 412x915, opens the job's Step 3 · Send, presses For upload forms (.docx) and keeps the file it downloads; the file must be named <Company> - <Job title> - Job <id> - Resume (for upload).docx, hold no tab, table, text box, column, header or footer, and the plain line reader of tests/helpers/resume_line_parser.py must recover every job on that job's résumé with its exact title and employer and its dates as MM/YYYY, a year alone or Present. Every request that is not a read or the sign-in is stopped and listed; the check discards the job's documents at the end. `remove` takes the test person's role back and deactivates it.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Lane CAREER-PROOFS (blue, 2026-11-25): the check read every job back exactly at 1440x900 and 412x915 and still exited 1, "the page tried a write: POST /api/cockpit/recents". That write is the cockpit recording the application a person opens (platform cockpit-view-controller.js, RP-SHL-01), not Career's, and the check stopped it as if it were. The guard now lets it through, as tests/career-regenerate-live-proof.mjs does; every other write is still stopped, listed and fails the size. The command also runs only when it is the program started, so tests/career-parse-resume-live-proof.test.mjs imports the guard and the judgement and proves both in Chromium.
 *
 * Usage (a loopback kernel only; the administrator credential is read by name from the env file and never printed, the
 * person's credential stays in its 0600 file and is typed only into the slot's own sign-in page; all three refuse port 38788):
 *   node career-hunter/tests/career-parse-resume-live-proof.mjs person http://127.0.0.1:38798 <slot env file> <person file>
 *   node career-hunter/tests/career-parse-resume-live-proof.mjs check  http://127.0.0.1:38798 <person file> <out folder>
 *   node career-hunter/tests/career-parse-resume-live-proof.mjs remove http://127.0.0.1:38798 <slot env file> <person file>
 * Playwright comes from STORE_CI_TOOLCHAIN or the store's scripts/toolchain; python3 reads the downloaded file.
 */
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { playwright } from './helpers/ux-page.mjs';

const BOARD_LINK = '/cockpit/?app=career-hunter&screen=career-board';
const BOARD = /\/api\/career-hunter\/board-native/;
const READER = new URL('./helpers/resume_line_parser.py', import.meta.url).pathname;
const SIZES = [{ width: 1440, height: 900, touch: false }, { width: 412, height: 915, touch: true }];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// Made-up data; nothing here is anyone's.
const RESUME = `Avery Sample
Operations manager | Sampletown, USA | avery.sample@example.com
SUMMARY
Runs logistics operations for growing companies (a made-up résumé for a test).
EXPERIENCE
Operations Manager, Example Logistics, 2020-02 to present
- Runs a team of eight across scheduling, purchasing and facilities.
Logistics Coordinator, Sample Freight Co, 2016-05 to 2020-01
- Scheduled 300 deliveries a week across four depots.
Dispatch Lead, Northwind Haulage, 2012 to 2016
- Ran the night dispatch desk.
Warehouse Associate, Contoso Depot, 2009-06 to 2012-03
- Kept the inventory counts.
SKILLS
Scheduling, vendor management, budgeting, Excel
EDUCATION
B.A. Business, Sample State University, 2005 - 2009
`;
const JOB_TEXT = 'Logistics Operations Manager (a made-up posting for a test). Run a regional logistics team: scheduling, dispatch, '
  + 'vendor contracts and warehouse operations. Requirements: five years of logistics operations, two years leading a team, '
  + 'and a record of on-time delivery. '.repeat(4);

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
/**
 * @description One request to the kernel's own origin; a failure names the method, the route and the status, nothing else.
 * @param {string} origin @param {string} credential A bearer or ''. @param {string} method @param {string} route
 * @param {object} [options] body (JSON), form (FormData), accepted statuses, headers. @returns {Promise<{status:number,body:any}>}
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
    reason: 'Career résumé for upload forms proof (test person)', idempotency_key: randomUUID(),
    ...(action === 'revoke' ? {} : { selection: { kind: 'granular', app: held.app, role: held.role } }) };
  if (action !== 'revoke') input.expected_plan_revision = (await http(origin, admin, 'POST', '/api/authorization/composites/preview', { body: input })).body.plan_revision;
  await http(origin, admin, 'POST', '/api/authorization/composites/apply', { body: input });
}
/** @description Poll until a check answers truthy; a timeout names the wait and the last thing that went wrong in it. */
async function until(check, ms, label) {
  const end = Date.now() + ms;
  let last = '';
  for (;;) {
    const value = await Promise.resolve().then(check).catch((error) => { last = message(error); return null; });
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out: ${label}${last ? ` (${last})` : ''}`);
    await wait(1000);
  }
}

/** @description `person`: make (or reuse) the test person with a made-up résumé Career has finished reading. */
async function makePerson(origin, envFile, file) {
  const admin = adminToken(envFile);
  if (fs.existsSync(file)) { say('test person kept', { subject: JSON.parse(fs.readFileSync(file, 'utf8')).subject }); return; }
  const subject = `careerparse1-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const invite = (await http(origin, admin, 'POST', '/people/invitations', { body: { invitee: subject, tier: 'editor', lifetime_ms: 3600000 } })).body;
  const accepted = (await http(origin, '', 'POST', `/people/invitations/${encodeURIComponent(invite.token)}/accept`, { body: { subject, display_name: 'Avery Sample (test)' } })).body;
  const person = { base: origin, subject, principal: accepted.principal, token: accepted.token, grants: [] };
  privateWrite(file, person);
  const held = { id: `careerparse1-career-hunter-${randomUUID().slice(0, 8)}`, app: 'career-hunter', role: 'member' };
  await grant(origin, admin, person.principal, held);
  person.grants.push(held);
  privateWrite(file, person);
  await http(origin, person.token, 'POST', '/packages/career-hunter/schema', { body: {} });
  const form = new FormData();
  form.append('resume', new Blob([RESUME], { type: 'text/plain' }), 'avery-sample-resume.txt');
  await http(origin, person.token, 'POST', '/api/career-hunter/resume/upload', { form, accepted: [200, 202] });
  await until(async () => {
    const state = (await http(origin, person.token, 'GET', '/api/career-hunter/resume/state')).body;
    if (state && state.ingest && state.ingest.state === 'failed') throw new Error('indexing failed');
    return state && state.hasResume === true && !state.indexing;
  }, 900000, 'Career indexing the made-up résumé');
  say('test person', { subject });
}

/** @description One job from the shared listings for the person to prepare (its text is replaced by a made-up paste). */
async function pickJob(origin, token) {
  for (const q of ['operations manager', 'logistics', 'manager']) {
    const jobs = (await http(origin, token, 'GET', `/api/career-hunter/browse?q=${encodeURIComponent(q)}&per=20`)).body?.jobs || [];
    const job = jobs.find((row) => Number.isSafeInteger(Number(row.id)) && !['applied', 'interview', 'offer', 'rejected'].includes(row.status));
    if (job) return Number(job.id);
  }
  throw new Error('no listing to prepare on this slot');
}
/** @description A new person's job store is made by their first title pass; run a one-job pass when it is missing. */
async function ensureStore(origin, token, id) {
  const ready = async () => (await http(origin, token, 'GET', `/api/career-hunter/jobs/${id}`, { accepted: [200, 404] })).status === 200;
  if (await ready()) return;
  await http(origin, token, 'POST', '/api/career-hunter/settings/title-profile', { body: { terms: ['Operations Manager', 'Logistics Manager'] } });
  await until(async () => [202, 409].includes((await http(origin, token, 'POST', '/api/career-hunter/title-pass/run-now',
    { body: { limit: 1 }, accepted: [202, 409, 429, 502] })).status), 600000, 'a title pass slot');
  await until(ready, 1800000, 'the title pass that makes the job store');
}
/** @description Prepare one job as the person does (Generate résumé & cover letter) and wait for its documents. */
async function prepare(origin, token, id) {
  const requestId = `careerparse1-${randomUUID()}`;
  await http(origin, token, 'POST', `/api/career-hunter/jobs/${id}/generate`, { body: { documents: true, requestId, jobDescription: JOB_TEXT }, accepted: [202] });
  return until(async () => {
    const job = (await http(origin, token, 'GET', `/api/career-hunter/jobs/${id}`)).body?.job;
    return job && ['ready', 'failed'].includes(job.board?.phase) && job.board?.requestId === requestId ? job : null;
  }, 1200000, 'the documents');
}

/** @description A résumé span's start and end as the parse résumé writes them (MM/YYYY, a year alone, Present). */
function spanDates(span) {
  const one = (text) => {
    const value = String(text || '').trim(), named = value.match(/^([A-Za-z]{3,9})\.? ((?:19|20)\d{2})$/), numeric = value.match(/^((?:19|20)\d{2})-(\d{1,2})$/);
    if (/present|current/i.test(value)) return 'Present';
    if (named && MONTHS.includes(named[1].slice(0, 3).toLowerCase())) return `${String(MONTHS.indexOf(named[1].slice(0, 3).toLowerCase()) + 1).padStart(2, '0')}/${named[2]}`;
    if (numeric) return `${numeric[2].padStart(2, '0')}/${numeric[1]}`;
    return /^(19|20)\d{2}$/.test(value) ? value : '';
  };
  const parts = String(span || '').split(/\s+(?:to|-|–|—)\s+/i);
  return parts.length > 1 ? [one(parts[0]), one(parts[1])] : [one(parts[0]), one(parts[0])];
}
/** @description What a downloaded file holds, read by python3: the format's faults and the roles the plain reader recovers. */
function readFile(file) {
  const faults = spawnSync('python3', ['-c', [
    'import re, sys, zipfile', 'z = zipfile.ZipFile(sys.argv[1]); x = "\\n".join(z.read(n).decode() for n in z.namelist() if n.endswith((".xml", ".rels")))',
    'bad = [n for n, p in (("tab", r"<w:tabs?\\b"), ("table", r"<w:tbl"), ("text box", r"txbxContent|v:textbox"), ("header or footer", r"headerReference|footerReference"), ("drawing", r"<w:drawing|<w:pict"))',
    '       if re.search(p, x)] + ["columns" for n in re.findall(r"<w:cols\\b[^>]*w:num=\\"(\\d+)\\"", x) if int(n) > 1]', 'print(",".join(bad))'].join('\n'), file], { encoding: 'utf8' });
  const roles = spawnSync('python3', [READER, file], { encoding: 'utf8' });
  if (faults.status !== 0 || roles.status !== 0) throw new Error(`python3 could not read the download: ${(faults.stderr || roles.stderr).slice(-200)}`);
  return { faults: faults.stdout.trim() ? faults.stdout.trim().split(',') : [], roles: JSON.parse(roles.stdout) };
}

/**
 * @description Stop every request of this context that is not a read, the sign-in or the cockpit's own record of the
 * application opened (POST /api/cockpit/recents, a platform write when an application opens, not Career's).
 */
async function guard(context, origin, row) {
  await context.route((url) => new URL(url).origin === origin, (route) => {
    const request = route.request(), where = new URL(request.url()).pathname, method = request.method();
    if (method === 'GET' || method === 'HEAD' || (method === 'POST' && (where === '/sessions' || where === '/api/cockpit/recents'))) return route.continue();
    row.stopped.push(`${method} ${where}`);
    return route.abort();
  });
}
/** @description Sign in on the slot's own sign-in page, open My jobs, and open the job's Step 3 · Send in its frame. */
async function openSend(page, origin, person, id) {
  await page.goto(`${origin}/login?next=${encodeURIComponent(BOARD_LINK)}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('#loginTokenBox > summary').click();
  await page.locator('#loginTokenValue').fill(person.token);
  await page.locator('#loginToken button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname.startsWith('/cockpit'), { timeout: 90000 });
  const board = await until(() => page.frames().find((frame) => BOARD.test(frame.url())), 120000, 'My jobs');
  await board.goto(`${origin}/api/career-hunter/board-native?view=queue&application=${id}&step=review`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  return until(async () => {
    const frame = page.frames().find((one) => BOARD.test(one.url()) && new URL(one.url()).searchParams.get('application') === String(id));
    if (!frame) return null;
    for (const name of ['Continue to send', 'I checked the cover letter']) {
      const button = frame.getByRole('button', { name, exact: true });
      if (await button.isVisible().catch(() => false)) await button.click();
    }
    return (await frame.getByRole('heading', { name: 'Send your application' }).isVisible().catch(() => false)) && frame;
  }, 120000, 'Step 3 · Send');
}

/** @description One size: sign in, open Send, press For upload forms (.docx), keep the download and read it. */
async function checkSize(browser, origin, person, job, size, out) {
  const label = `${size.width}x${size.height}`, row = { size: label, failures: [], stopped: [], errors: [] };
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.touch, hasTouch: size.touch, deviceScaleFactor: size.touch ? 2.625 : 1, acceptDownloads: true });
  try {
    await guard(context, origin, row);
    const page = await context.newPage();
    page.on('pageerror', (error) => row.errors.push(message(error).slice(0, 160)));
    const frame = await openSend(page, origin, person, job.id);
    const link = frame.locator('#sendFiles a[data-file="parse:docx"]');
    row.button = (await link.innerText()).trim();
    row.sideways = await frame.evaluate(() => document.scrollingElement.scrollWidth > window.innerWidth + 1);
    await link.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, `parse-resume-${label}-send.png`) });
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), size.touch ? link.tap() : link.click()]);
    row.fileName = download.suggestedFilename();
    const file = path.join(out, `parse-resume-${label}.docx`);
    await download.saveAs(file);
    Object.assign(row, readFile(file));
    judge(row, job);
    if (row.errors.length) row.failures.push(`the page raised an error: ${row.errors[0]}`);
  } catch (error) { row.failures.push(message(error)); }
  finally { await context.close(); }
  return row;
}
/** @description The size's failures: the button, the name, the format and every job on the résumé read back exactly. */
function judge(row, job) {
  if (row.button !== 'For upload forms (.docx)') row.failures.push(`the button reads ${row.button}`);
  if (row.sideways) row.failures.push('the Send step scrolls sideways');
  const safe = (value) => String(value ?? '').replace(/[\u0000-\u001f\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const name = [safe(job.company) || 'Employer', safe(job.title) || 'Job', 'Job ' + job.id, 'Resume (for upload)'].join(' - ') + '.docx';
  if (row.fileName !== name) row.failures.push(`the download is named ${row.fileName}, not ${name}`);
  if (row.faults.length) row.failures.push(`the file holds ${row.faults.join(', ')}`);
  for (const [title, org, span] of job.experience) {
    const [start, end] = spanDates(span), found = row.roles.filter((role) => role.title === title && role.company === org);
    if (found.length !== 1) row.failures.push(`${title} at ${org} is read ${found.length} times`);
    else if (found[0].start !== start || found[0].end !== end) row.failures.push(`${title} reads ${found[0].start} to ${found[0].end}, not ${start} to ${end}`);
  }
  if (row.roles.length !== job.experience.length) row.failures.push(`the reader found ${row.roles.length} jobs; the résumé has ${job.experience.length}`);
  if (row.stopped.length) row.failures.push(`the page tried a write: ${row.stopped.join('; ')}`);
}

/** @description `check`: exit 0 when both sizes download the résumé for upload forms and the reader recovers every job exactly. */
async function check(origin, file, out) {
  const person = JSON.parse(fs.readFileSync(file, 'utf8')), receipt = { at: new Date().toISOString(), base: origin, subject: person.subject, sizes: [], failures: [] };
  fs.mkdirSync(out, { recursive: true });
  const id = await pickJob(origin, person.token);
  await ensureStore(origin, person.token, id);
  try {
    const prepared = await prepare(origin, person.token, id);
    if (prepared.board?.phase !== 'ready') throw new Error(`preparation ended ${prepared.board?.phase}: ${prepared.board?.error || ''}`);
    const doc = (await http(origin, person.token, 'GET', `/api/career-hunter/resume/doc?id=${id}`)).body;
    const job = { id, company: prepared.company, title: prepared.title,
      experience: (doc.resume?.experience || []).map((role) => [role.title, role.org, role.span]) };
    receipt.job = job;
    const browser = await playwright().chromium.launch({ headless: true });
    try { for (const size of SIZES) receipt.sizes.push(await checkSize(browser, origin, person, job, size, out)); }
    finally { await browser.close(); }
  } catch (error) { receipt.failures.push(message(error)); }
  finally {
    receipt.discarded = (await http(origin, person.token, 'DELETE', `/api/career-hunter/jobs/${id}/packet`, { accepted: [200, 404] }).catch((error) => ({ status: message(error) }))).status;
  }
  fs.writeFileSync(path.join(out, 'career-parse-resume-live.json'), JSON.stringify(receipt, null, 2));
  say('check', receipt);
  return receipt.failures.length || receipt.sizes.some((row) => row.failures.length) ? 1 : 0;
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

// The proof is a command; its guard and its judgement are also imported by tests/career-parse-resume-live-proof.test.mjs.
export { guard, judge };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, base, second, third] = process.argv.slice(2);
  try {
    if (!['person', 'check', 'remove'].includes(mode) || !base || !second || !third) throw new Error('usage: person <base> <env file> <person file> | check <base> <person file> <out folder> | remove <base> <env file> <person file>');
    const origin = testSlot(base);
    if (mode === 'person') await makePerson(origin, second, third);
    else if (mode === 'check') process.exitCode = await check(origin, second, third);
    else await remove(origin, second, third);
  } catch (error) {
    console.error(`career-parse-resume-live-proof: ${message(error)}`);
    process.exitCode = 1;
  }
}
