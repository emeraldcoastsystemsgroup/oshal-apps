#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.4 (Roger, 2026-11-16: "i can not find where to see my expanded experience.. it doesnt show anywhere ... it covers like 20 different companies over a 4 year span when i was consulting in the field"). Work history's Expanded experience on an installed Career, on the test slot, as a test person with a made-up résumé: `person` makes the person (an invitation, Career's member role through preview and apply, a made-up résumé with a four-year field consulting job), then writes 20 made-up client engagements over those four years through the page's own save (POST /resume/master-edit), places them under the consulting job, and adds a group of client accounts; `check` (read-only) reads the main résumé document and Download my data, then opens Work history in Today at 412x915 and 1440x900 and reads the summary line, the consulting job's Client engagements and the account group, with every write stopped; `remove` takes it all back.
 *
 * Usage (a loopback kernel only; the administrator credential is read by name from the env file and never printed, the
 * person's credential stays in its 0600 file and never enters a page or a log):
 *   node career-hunter/tests/career-engagements-live-proof.mjs person http://127.0.0.1:38798 <slot env file> <person file>
 *   node career-hunter/tests/career-engagements-live-proof.mjs check  http://127.0.0.1:38798 <person file> <out folder>
 *   node career-hunter/tests/career-engagements-live-proof.mjs remove http://127.0.0.1:38798 <slot env file> <person file>
 * Playwright comes from STORE_CI_TOOLCHAIN or the store's scripts/toolchain (npm ci --prefix scripts/toolchain).
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { playwright } from './helpers/ux-page.mjs';
import { CLIENTS } from './helpers/career-engagements-fixture.mjs';

const WORK_HISTORY = '/cockpit/?app=career-hunter&screen=career-work-history';
const FRAME = /\/api\/career-hunter\/work-history/;
const SIZES = [{ width: 412, height: 915, touch: true }, { width: 1440, height: 900 }];
const FIELD_JOB = 'Field Implementation Consultant';
// A made-up résumé, so Career makes the person's store; nothing here is anyone's data.
const RESUME = `Casey Fieldwork
Implementation consultant | Sampletown, USA | casey.fieldwork@example.com
SUMMARY
Puts business systems live at client sites (a made-up résumé for a test).
EXPERIENCE
Principal Consultant, Northwind Advisory, 2022-01 to present
- Leads the advisory practice.
Field Implementation Consultant, Example Systems Group, 2018-01 to 2021-12
- Delivered 20 client implementations in four years.
- Ran go-live weekends on site.
Business Analyst, Sample Bank, 2014-06 to 2017-12
- Wrote the loan reports.
SKILLS
SQL, Python, data migration
EDUCATION
B.S. Information Systems, Sample State University, 2014
`;
/** The 20 made-up engagements of the four-year field job: two a year-quarter, 2018 to 2021. */
const ENGAGEMENTS = CLIENTS.map(([client, project, industry], n) => ({
  project: `${client} ${project}`, role: 'Implementation consultant', industry,
  start: `${2018 + Math.floor(n / 5)}-${String(1 + (n % 5) * 2).padStart(2, '0')}`, end: `${2018 + Math.floor(n / 5)}-${String(2 + (n % 5) * 2).padStart(2, '0')}`,
  tech: ['SQL', n % 2 ? 'Java' : 'Python'],
}));

const say = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const message = (error) => String((error && error.message) || error).split('\n')[0].slice(0, 300);

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
    reason: 'Career Expanded experience proof (test person)', idempotency_key: randomUUID(),
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

/** @description The person's main résumé document, the one Work history reads. */
async function mainDocument(origin, token) {
  return (await http(origin, token, 'GET', '/api/career-hunter/resume/doc?id=master')).body || {};
}

/** @description Send edits the way Work history does: at most 20 a request, each on the revision the last one answered. */
async function saveEdits(origin, token, edits) {
  let revision = (await mainDocument(origin, token)).revision;
  for (let at = 0; at < edits.length; at += 20) {
    revision = (await http(origin, token, 'POST', '/api/career-hunter/resume/master-edit', { body: { revision, edits: edits.slice(at, at + 20) } })).body.revision;
  }
  return revision;
}

/** @description The made-up history: 20 engagements, two with bullets, placed under the field job, and one group of accounts. */
async function writeHistory(origin, token) {
  const doc = await mainDocument(origin, token);
  if (!doc.expanded) throw new Error('this Career has no Expanded experience (career-hunter 1.68.4 is not installed on this slot)');
  // The model reads the made-up résumé, so the job is found by its words, then named exactly as it was saved.
  const jobIndex = (doc.resume.experience || []).findIndex((role) => /field implementation/i.test(role.title || ''));
  if (jobIndex < 0) throw new Error(`the made-up résumé was read without its ${FIELD_JOB} job`);
  const jobTitle = doc.resume.experience[jobIndex].title, at = doc.expanded.engagements.length, job = { index: jobIndex, title: jobTitle };
  await saveEdits(origin, token, ENGAGEMENTS.map((value, n) => ({ op: 'add', field: 'engagement', index: at + n, before: '', value: { ...value, job } })));
  await saveEdits(origin, token, [0, 1].flatMap((n) => [`Went live at ${CLIENTS[n][0]} on schedule`, 'Trained the client\'s floor leads'].map((text, q) => (
    { op: 'add', field: 'engagement-bullet', engagementIndex: at + n, engagementName: ENGAGEMENTS[n].project, index: q, before: '', value: text }))));
  await saveEdits(origin, token, [{ op: 'add', field: 'accounts', key: 'Field clients', before: [], value: CLIENTS.slice(0, 12).map(([client]) => client) }]);
  return { jobIndex, jobTitle, first: at };
}

/** @description `person`: make (or reuse) the test person with a made-up résumé, then write the made-up expanded history. */
async function makePerson(origin, envFile, file) {
  const admin = adminToken(envFile);
  if (fs.existsSync(file)) { say('test person kept', { subject: JSON.parse(fs.readFileSync(file, 'utf8')).subject }); return; }
  const subject = `careerexp1-expanded-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const invite = (await http(origin, admin, 'POST', '/people/invitations', { body: { invitee: subject, tier: 'editor', lifetime_ms: 3600000 } })).body;
  const accepted = (await http(origin, '', 'POST', `/people/invitations/${encodeURIComponent(invite.token)}/accept`, { body: { subject, display_name: 'Casey Fieldwork (test)' } })).body;
  const person = { base: origin, subject, principal: accepted.principal, token: accepted.token, grants: [] };
  privateWrite(file, person);
  const held = { id: `careerexp1-career-hunter-${randomUUID().slice(0, 8)}`, app: 'career-hunter', role: 'member' };
  await grant(origin, admin, person.principal, held);
  person.grants.push(held);
  privateWrite(file, person);
  await http(origin, person.token, 'POST', '/packages/career-hunter/schema', { body: {} });
  const form = new FormData();
  form.append('resume', new Blob([RESUME], { type: 'text/plain' }), 'casey-fieldwork-resume.txt');
  await http(origin, person.token, 'POST', '/api/career-hunter/resume/upload', { form, accepted: [200, 202] });
  await until(async () => {
    const state = (await http(origin, person.token, 'GET', '/api/career-hunter/resume/state')).body;
    if (state && state.ingest && state.ingest.state === 'failed') throw new Error('indexing failed');
    return state && state.hasResume === true && !state.indexing;
  }, 900000, 'Career indexing the made-up résumé');
  person.history = await writeHistory(origin, person.token);
  privateWrite(file, person);
  say('test person', { subject, engagements: ENGAGEMENTS.length, under: FIELD_JOB });
}

/** @description The API half of `check`: the main résumé document and Download my data carry all 20, under the field job. */
async function checkAnswers(origin, person, fail) {
  const doc = await mainDocument(origin, person.token), x = doc.expanded || { engagements: [], accounts: [] }, jobTitle = person.history.jobTitle;
  const mine = x.engagements.filter((e) => ENGAGEMENTS.some((made) => made.project === e.project));
  if (mine.length !== ENGAGEMENTS.length) fail(`the main résumé document lists ${mine.length} of the ${ENGAGEMENTS.length} made-up engagements`);
  if (mine.some((e) => !e.job || e.job.title !== jobTitle)) fail(`not every made-up engagement is under ${jobTitle}`);
  if (mine.some((e, n) => e.start !== ENGAGEMENTS[n].start || e.end !== ENGAGEMENTS[n].end)) fail('an engagement\'s months differ from what was saved');
  if (mine.slice(0, 2).some((e) => e.bullets.length !== 2)) fail('the two engagements with bullets do not show both');
  const group = x.accounts.find((g) => g.label === 'Field clients');
  if (!group || group.items.length !== 12) fail(`the Field clients group has ${group ? group.items.length : 'no'} names`);
  const record = (await http(origin, person.token, 'GET', '/api/career-hunter/master-record?page=1')).body || {};
  if (!record.counts || record.counts.projects !== x.engagements.length) fail(`Download my data counts ${record.counts && record.counts.projects} engagements`);
  return { engagements: x.engagements.length, underFieldJob: mine.filter((e) => e.job && e.job.title === jobTitle).length, accounts: group ? group.items.length : 0 };
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

/** @description What Work history shows, read inside its frame. */
async function readPage(frame, jobTitle) {
  return frame.evaluate((fieldJob) => {
    const text = (node) => (node ? node.textContent.trim() : null);
    const job = [...document.querySelectorAll('.wh-job')].find((card) => text(card.querySelector('h2')) === fieldJob);
    const group = [...document.querySelectorAll('#whGroups .wh-group')].find((g) => /^Field clients \(/.test(text(g.querySelector('h4')) || ''));
    return {
      summary: ['whSumJobs', 'whSumEng', 'whSumAcc'].map((id) => text(document.getElementById(id))),
      head: job ? text(job.querySelector('.wh-eng-head')) : null,
      names: job ? [...job.querySelectorAll('.wh-eng h4')].map(text) : [],
      group: group ? text(group.querySelector('h4')) : null,
      sideways: document.documentElement.scrollWidth > window.innerWidth,
    };
  }, jobTitle);
}

/** @description The page half of `check`: Work history in Today at one size, every write stopped. */
async function checkPage(browser, origin, person, size, out, sessions, fail) {
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
  let shown = {};
  try {
    await page.goto(origin + WORK_HISTORY, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const frame = await until(() => page.frames().find((f) => FRAME.test(f.url())), 90000, 'Work history');
    await frame.locator('.wh-eng-group .wh-eng').first().waitFor({ timeout: 90000 });
    shown = await readPage(frame, person.history.jobTitle);
    const names = ENGAGEMENTS.map((e) => e.project);
    if (shown.head !== `Client engagements (${names.length})`) fail(`${label}: the field job's card says ${JSON.stringify(shown.head)}`);
    if (JSON.stringify(shown.names) !== JSON.stringify(names)) fail(`${label}: the field job's card lists ${shown.names.length} engagements, not the 20 saved in order`);
    if (!/^20 client engagements$/.test(shown.summary[1] || '')) fail(`${label}: the summary says ${JSON.stringify(shown.summary)}`);
    if (shown.group !== 'Field clients (12)') fail(`${label}: the account group reads ${JSON.stringify(shown.group)}`);
    if (shown.sideways) fail(`${label}: the page scrolls sideways`);
    await page.screenshot({ path: path.join(out, `work-history-${label}.png`) });
    await frame.locator('.wh-eng-group').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, `work-history-${label}-engagements.png`) });
  } catch (error) { fail(`${label}: ${message(error)}`); }
  const own = stopped.filter((line) => /\/api\/career-hunter\/resume\/master-(edit|undo)/.test(line));
  if (own.length) fail(`${label}: Work history tried to change the main résumé: ${own.join('; ')}`);
  await context.close();
  return { size: label, summary: shown.summary, head: shown.head, stopped, errors };
}

/** @description `check`: read-only; exit 0 when Work history shows the 20 made-up engagements under the field job. */
async function check(origin, file, out) {
  const person = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  const receipt = { origin, at: new Date().toISOString(), subject: person.subject, failures: [], pages: [] };
  const fail = (why) => receipt.failures.push(why);
  receipt.answers = await checkAnswers(origin, person, fail);
  const browser = await playwright().chromium.launch({ headless: true }), sessions = [];
  try {
    for (const size of SIZES) receipt.pages.push(await checkPage(browser, origin, person, size, out, sessions, fail));
  } finally { await browser.close(); receipt.signedOut = await signOut(origin, sessions); }
  fs.writeFileSync(path.join(out, 'career-engagements-live.json'), JSON.stringify(receipt, null, 2));
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
  console.error(`career-engagements-live-proof: ${message(error)}`);
  process.exitCode = 1;
}
