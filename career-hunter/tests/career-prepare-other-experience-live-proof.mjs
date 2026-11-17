#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.1 (Roger, 2026-11-16: "when i get to the application screen it fully generated my resume without asking me about adding in my optional addendum"; "i still need the option of 'Other experience · optional' ... to be selectable. this is not a choice in bulk edit"). Prepare application and bulk Prepare on an installed Career, on the test slot, as a test person with a made-up résumé, two made-up Other experience entries (an open-source project, Lantern, and a volunteer one) and saved public postings, at 1440x900 and 412x915 (touch), signed in on the real /login page with an access token. `check` stops every request that is not GET or HEAD and lists it, except sign-in and the writes it permits at that moment for this person's own saved jobs: the move and draft saves of Prepare application, and (with --prepare) Generate after the check ticked Lantern, and bulk Prepare's writes after its step was confirmed. It exits 0 when GET /experience-bank answers `last`; Prepare application opens step 1 with both boxes and generates nothing until Generate; (--prepare) Generate's preparation records exactly Lantern, the résumé leaves the unticked entry out and Lantern becomes the last choice; at 412 the next job opens with Lantern ticked and says so; Prepare applications in the Table asks once (the boxes, "Include in every selected application", the count), Cancel queues nothing, and (--prepare) Prepare saves Lantern on both jobs' tailoring and both preparations record it. `--preview <store root>` serves Career's page files from a store checkout over the slot's real answers. `person` makes the test person once; `remove` takes its grant back and deactivates it.
 *
 * Usage (a loopback kernel only; the administrator credential is read by name from the env file and never printed, the
 * person's credential stays in its 0600 file and is typed only into the slot's own sign-in page):
 *   node career-hunter/tests/career-prepare-other-experience-live-proof.mjs person http://127.0.0.1:38798 <slot env file> <person file>
 *   node career-hunter/tests/career-prepare-other-experience-live-proof.mjs check  http://127.0.0.1:38798 <person file> <out folder> [--prepare] [--preview <store root>]
 *   node career-hunter/tests/career-prepare-other-experience-live-proof.mjs remove http://127.0.0.1:38798 <slot env file> <person file>
 * Playwright comes from STORE_CI_TOOLCHAIN or the store's scripts/toolchain (npm ci --prefix scripts/toolchain).
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { playwright } from './helpers/ux-page.mjs';

const BOARD_LINK = '/cockpit/?app=career-hunter&screen=career-board';
const BOARD = /\/api\/career-hunter\/board-native/;
const DESKTOP = { name: 'desktop', width: 1440, height: 900, touch: false }, PHONE = { name: 'phone', width: 412, height: 915, touch: true };
// Made-up data; nothing here is anyone's.
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
SKILLS
Scheduling, vendor management, budgeting, Excel
EDUCATION
B.A. Business, Sample State University, 2015
`;
const LANTERN = { title: 'Lantern', kind: 'project', organization: 'Lantern (open-source)', period: '2024 to Present',
  facts: 'Built Lantern, a made-up open-source scheduling tool for small offices (a test entry).', skills: ['JavaScript', 'Scheduling'] };
const TEACHING = { title: 'Weekend teaching', kind: 'volunteer', organization: 'Sampletown Community School', period: '2023 to 2024',
  facts: 'Taught a made-up weekend spreadsheet class for adults (a test entry).', skills: ['Teaching', 'Excel'] };

const say = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const message = (error) => String((error && error.message) || error).split('\n')[0].slice(0, 300);

/** @description The loopback kernel's origin, or a refusal. @param {string} base An address. @returns {string} */
function loopback(base) {
  const origin = new URL(String(base || '')).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('this proof runs only against a loopback kernel, http://127.0.0.1:<port>');
  return origin;
}
/** @description Every mode writes this person's own data: the test slot only, never the production kernel's port. */
function testSlot(origin) { if (new URL(origin).port === '38788') throw new Error('this proof writes; it runs on the test slot (http://127.0.0.1:38798), never on production'); return origin; }
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
/** @description One request to the kernel's own origin; a failure names the method, the route and the status, nothing else. */
async function http(origin, credential, method, route, { body, form, accepted = [200], text = false } = {}) {
  const url = new URL(route, origin);
  if (url.origin !== origin) throw new Error('refusing a request outside the kernel');
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(240000),
    headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : form ? { body: form } : {}) });
  const raw = await response.text();
  if (!accepted.includes(response.status)) throw new Error(`${method} ${route.split('?')[0].replace(/\/people\/invitations\/[^/]+\/accept/, '/people/invitations/:private/accept')}: ${response.status}`);
  if (text) return { status: response.status, body: raw };
  try { return { status: response.status, body: JSON.parse(raw) }; } catch { return { status: response.status, body: null }; }
}
/** @description Assign or take back one application role (preview, then apply; a revoke is apply alone). */
async function grant(origin, admin, principal, held, action = 'assign') {
  const catalog = (await http(origin, admin, 'GET', '/api/authorization/composites')).body;
  const input = { target: principal, assignment_id: held.id, action, expected_revision: catalog.revision, reason: 'Career Other experience proof (test person)',
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
    await wait(1000);
  }
}

/** @description A new test person: an invitation, Career's member role, and the made-up résumé through Career's own upload and indexing. */
async function newPerson(origin, admin, file) {
  const subject = `careerprep1-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const invite = (await http(origin, admin, 'POST', '/people/invitations', { body: { invitee: subject, tier: 'editor', lifetime_ms: 3600000 } })).body;
  const accepted = (await http(origin, '', 'POST', `/people/invitations/${encodeURIComponent(invite.token)}/accept`, { body: { subject, display_name: 'Sam Example (test)' } })).body;
  const person = { base: origin, subject, principal: accepted.principal, token: accepted.token, grants: [], saved: [] };
  privateWrite(file, person);
  const held = { id: `careerprep1-career-hunter-${randomUUID().slice(0, 8)}`, app: 'career-hunter', role: 'member' };
  await grant(origin, admin, person.principal, held);
  person.grants.push(held); privateWrite(file, person);
  await http(origin, person.token, 'POST', '/packages/career-hunter/schema', { body: {} });
  const form = new FormData();
  form.append('resume', new Blob([RESUME], { type: 'text/plain' }), 'sam-example-resume.txt');
  await http(origin, person.token, 'POST', '/api/career-hunter/resume/upload', { form, accepted: [200, 202] });
  await until(async () => { const state = (await http(origin, person.token, 'GET', '/api/career-hunter/resume/state')).body; return state && state.hasResume === true && !state.indexing; }, 900000, 'Career indexing the made-up résumé');
  return person;
}
/** @description A new person has no Career store until Career's first run of theirs: made-up target titles and one manual score (at most one job). */
async function ensureStore(origin, person) {
  const ready = async () => { const stats = (await http(origin, person.token, 'GET', '/api/career-hunter/jobs/stats')).body; return stats && stats.empty !== true; };
  if (await ready()) return;
  await http(origin, person.token, 'POST', '/api/career-hunter/settings/title-profile', { body: { terms: ['Operations Manager', 'Office Manager', 'Project Coordinator'] } });
  await http(origin, person.token, 'POST', '/api/career-hunter/run/score', { body: { limit: 1 }, accepted: [200, 202] });
  await until(ready, 300000, "the person's Career store");
}
/** @description The two made-up Other experience entries, each added once through the Other experience page's own route. */
async function ensureEntries(origin, person) {
  for (const entry of [LANTERN, TEACHING]) {
    const bank = (await http(origin, person.token, 'GET', '/api/career-hunter/experience-bank')).body;
    if (bank.entries.some((one) => one.title === entry.title && !one.archived)) continue;
    await http(origin, person.token, 'POST', '/api/career-hunter/experience-bank', { body: { operation: 'save', expectedRevision: bank.revision, entry } });
  }
}
/** @description Public postings for the person to save (each --prepare run prepares three and moves one more). */
async function pickPostings(origin, token) {
  const found = new Map();
  for (const q of ['operations manager', 'office manager', 'project coordinator', 'administrative assistant']) {
    const page = (await http(origin, token, 'GET', `/api/career-hunter/browse?q=${encodeURIComponent(q)}&per=25`)).body;
    for (const job of (page && page.jobs) || []) if (job && Number(job.id) > 0 && !found.has(job.id)) found.set(job.id, job);
  }
  return [...found.values()].slice(0, 40).map((job) => job.id);
}
/** @description `person`: make (or carry on with) the test person: the made-up résumé, a Career store, the two entries and eight saved postings. */
async function makePerson(origin, envFile, file) {
  let person = null;
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const me = await http(origin, saved.token, 'GET', '/api/career-hunter/resume/state', { accepted: [200, 401, 403] }).catch(() => ({ status: 0 }));
    if (me.status === 200 && me.body && me.body.hasResume) person = { saved: [], ...saved };
  }
  person ||= await newPerson(origin, adminToken(envFile), file);
  await ensureStore(origin, person);
  await ensureEntries(origin, person);
  let open = (await unprepared(origin, person)).length;
  for (const id of await pickPostings(origin, person.token)) {
    if (open >= 8) break;
    if (person.saved.includes(id)) continue;
    await http(origin, person.token, 'POST', `/api/career-hunter/jobs/${id}/status`, { body: { favorite: true } });
    person.saved.push(id); privateWrite(file, person); open += 1;
  }
  say('test person', { subject: person.subject, grants: (person.grants || []).map((g) => `${g.app}:${g.role}`), saved: person.saved.length });
}

/** @description Career's page files from a store checkout, for --preview (the board route serves Prepare application for ?application=). */
function previewFile(root, url) {
  const tools = path.join(root, 'career-hunter/tools');
  if (url.pathname === '/api/career-hunter/board-native') return path.join(tools, /^[1-9]\d*$/.test(url.searchParams.get('application') || '') ? 'career-application.html' : 'career-job-lists.html');
  const asset = url.pathname.match(/^\/api\/career-hunter\/static\/([\w.-]+)$/);
  if (!asset) return null;
  const full = path.resolve(tools, asset[1]);
  return full.startsWith(tools + path.sep) && fs.existsSync(full) ? full : null;
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

/**
 * @description Stop every request that is not a read, except sign-in and the writes `permit` allows at that moment
 * (permit.moves: job ids whose move and draft saves may go; permit.generate: job ids that may be generated). Lists what was stopped.
 */
async function guard(context, origin, preview, permit, row) {
  await context.route((u) => new URL(u).origin === origin, async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (method !== 'GET' && method !== 'HEAD') {
      const own = url.pathname.match(/^\/api\/career-hunter\/jobs\/(\d+)\/(status|generate)$/), id = own && Number(own[1]);
      const allowed = (method === 'POST' && url.pathname === '/sessions') || (own && method === 'POST' && (own[2] === 'generate' ? permit.generate.has(id) : permit.moves.has(id)));
      if (!allowed) {
        let from = ''; try { from = new URL(request.frame().url()).pathname; } catch { from = ''; }
        row.stopped.push(`${method} ${url.pathname.replace(/\/jobs\/\d+\//, '/jobs/:id/')} (from ${from})`);
        return route.abort();
      }
      if (own) row.writes.push(`${method} /jobs/:id/${own[2]}`);
    }
    const local = preview ? previewFile(preview, url) : null;
    if (local) return route.fulfill({ status: 200, path: local, contentType: TYPES[path.extname(local)] || 'text/javascript; charset=utf-8', headers: { 'cache-control': 'no-store' } });
    return route.continue();
  });
}
/** @description Sign in on the slot's own /login page with the access token, then open My jobs in the cockpit, on the List. */
async function signInAndOpen(page, origin, person) {
  await page.goto(`${origin}/login?next=${encodeURIComponent(BOARD_LINK)}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('#loginTokenBox > summary').click();
  await page.locator('#loginTokenValue').fill(person.token);
  await page.locator('#loginToken button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname.startsWith('/cockpit'), { timeout: 90000 });
  return until(async () => { const f = page.frames().find((frame) => BOARD.test(frame.url()) && !/application=/.test(frame.url())); return f && (await f.locator('#jobsViewSwitch').isVisible().catch(() => false)) && f; }, 120000, 'My jobs with its List | Table switch');
}
/** @description Back to My jobs in the cockpit (already signed in), on its List or Table as the person left it. */
async function openBoard(page, origin) {
  await page.goto(`${origin}${BOARD_LINK}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  return until(async () => { const f = page.frames().find((frame) => BOARD.test(frame.url()) && !/application=/.test(frame.url())); return f && (await f.locator('#jobsViewSwitch').isVisible().catch(() => false)) && f; }, 120000, 'My jobs again');
}
/** @description The frame of Prepare application for one job, once its step heading or its preparing line is drawn. */
function applicationFrame(page, id) {
  return until(async () => { const f = page.frames().find((frame) => BOARD.test(frame.url()) && new URL(frame.url()).searchParams.get('application') === String(id));
    return f && (await f.locator('#application[aria-busy="false"]').count().catch(() => 0)) && f; }, 120000, `Prepare application for the job`);
}
/** @description This person's saved jobs that have no résumé yet, by their job read. */
async function unprepared(origin, person) {
  const fresh = [], moved = [];
  for (const id of person.saved) {
    const job = (await http(origin, person.token, 'GET', `/api/career-hunter/jobs/${id}`)).body.job;
    if (job && !job.has_resume && !['applied', 'interview', 'offer', 'rejected', 'dismissed'].includes(job.status)) (['promoted', 'generated', 'deferred'].includes(job.status) ? moved : fresh).push(id);
  }
  return [...fresh, ...moved];
}
/** @description One preparation's own receipt: the job read once board.completedAt follows the request the press made. */
function receiptOf(origin, person, id, since) {
  return until(async () => { const job = (await http(origin, person.token, 'GET', `/api/career-hunter/jobs/${id}`)).body.job; const board = job.board || {};
    return board.completedAt && Date.parse(board.completedAt) >= since && job; }, 20 * 60000, 'the preparation to end');
}

/** @description The Other experience boxes on step 1 as drawn: each entry's title, whether ticked, and the hint. */
function readBoxes(frame) {
  return frame.evaluate(() => ({ heading: !!document.querySelector('.steps [aria-current="step"]') && document.querySelector('.steps [aria-current="step"]').textContent,
    boxes: [...document.querySelectorAll('#application input[name="experience"]')].map((box) => ({ id: box.value, title: box.closest('label').querySelector('span').firstChild.textContent.trim(), ticked: box.checked })),
    hint: (document.getElementById('experienceSuggested') || {}).textContent || '', sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth }));
}

/** @description Prepare application on one saved job: step 1 with the boxes and no generation; with `generate`, tick Lantern only and press Generate. */
async function single(ctx, size, id, generate) {
  const { page, frame, origin, person, permit, row, out, ids } = ctx;
  permit.moves.add(id);
  const button = frame.locator(`.job-row[data-job-id="${id}"]`).getByRole('button', { name: /^(Prepare application|Open application)$/ });
  if (!(await button.count())) { row.failures.push(`no Prepare application button on the saved job (${size.name})`); return; }
  row.pressed = await button.innerText();
  await button.click();
  const app = await applicationFrame(page, id);
  const drawn = await readBoxes(app);
  row.single = { ...drawn, generated: row.writes.filter((w) => w.endsWith('/generate')).length };
  await page.screenshot({ path: path.join(out, `${size.name}-single-step-1.png`) });
  if (drawn.heading !== '1 · Tailor') row.failures.push(`Prepare application opened on "${drawn.heading}", not 1 · Tailor`);
  if (drawn.boxes.length < 2) row.failures.push(`step 1 shows ${drawn.boxes.length} Other experience boxes, not both entries`);
  if (row.single.generated) row.failures.push('a résumé was generated before Generate was pressed');
  if (drawn.sideways) row.failures.push('the page scrolls sideways');
  if (!generate) return drawn;
  const lantern = drawn.boxes.find((box) => box.title === LANTERN.title), teaching = drawn.boxes.find((box) => box.title === TEACHING.title);
  if (!lantern || !teaching) { row.failures.push('the two made-up entries are not both offered'); return drawn; }
  if (!lantern.ticked) await app.locator(`input[name="experience"][value="${lantern.id}"]`).check();
  if (teaching.ticked) await app.locator(`input[name="experience"][value="${teaching.id}"]`).uncheck();
  permit.generate.add(id);
  const since = Date.now();
  await app.getByRole('button', { name: /^(Generate résumé & cover letter|Retry generation)$/ }).click();
  const job = await receiptOf(origin, person, id, since - 5000).catch((error) => { row.failures.push(message(error)); return null; });
  if (job) await checkPrepared(ctx, job, lantern.id, teaching, 'single');
  ids.lantern = lantern.id;
  return drawn;
}
/** @description One prepared job: the engine's receipt records exactly the ticked entry, the tailoring keeps it, and the résumé leaves the unticked one out. */
async function checkPrepared(ctx, job, lanternId, teaching, label) {
  const { origin, person, row } = ctx, board = job.board || {}, draft = (job.application && job.application.draft) || {};
  const html = board.phase === 'ready' ? (await http(origin, person.token, 'GET', `/api/career-hunter/resume?id=${job.id}&kind=resume&as=html`, { text: true, accepted: [200, 404] })).body || '' : '';
  const fact = { phase: board.phase, error: board.error || null, receipt: board.experienceIds || null, draft: draft.experienceIds || null, chosen: draft.experienceChosen === true,
    lanternInResume: /Lantern/.test(html), teachingInResume: new RegExp(teaching.title).test(html) || /Sampletown Community School/.test(html) };
  (row.prepared ||= []).push({ label, ...fact });
  if (fact.phase !== 'ready') row.failures.push(`${label}: the preparation ended ${fact.phase}${fact.error ? ' (' + fact.error + ')' : ''}`);
  if (JSON.stringify(fact.receipt) !== JSON.stringify([lanternId])) row.failures.push(`${label}: the engine's receipt records ${JSON.stringify(fact.receipt)}, not exactly Lantern`);
  if (JSON.stringify(fact.draft) !== JSON.stringify([lanternId]) || !fact.chosen) row.failures.push(`${label}: the job's tailoring holds ${JSON.stringify(fact.draft)} (chosen ${fact.chosen})`);
  if (fact.teachingInResume) row.failures.push(`${label}: the résumé names the unticked entry`);
}
/** @description Prepare applications in the Table for two jobs: the step, Cancel queues nothing; with `prepare`, Prepare and both receipts. */
async function bulk(ctx, size, two, prepare) {
  const { page, frame, origin, person, permit, row, out, ids } = ctx;
  await frame.getByRole('tab', { name: 'Table' }).click();
  await frame.locator('#jobsTable [data-id]').first().waitFor({ timeout: 60000 });
  const pick = async () => { for (const id of two) await frame.locator(`[data-select="${id}"]`).check(); await frame.locator('#bulkBar').getByRole('button', { name: 'Prepare applications' }).click(); };
  await pick();
  const dialog = frame.getByRole('dialog', { name: 'Prepare 2 applications' });
  const asked = await dialog.waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  if (!asked) { row.failures.push(`Prepare applications asked nothing (${size.name}): 1.68.0 queues at once`); return; }
  const words = (await dialog.innerText()).replace(/\s+/g, ' ');
  const lantern = dialog.getByRole('checkbox', { name: /Lantern/ });
  row.bulk = { words: words.slice(0, 400), lanternTicked: await lantern.isChecked(), boxes: await dialog.getByRole('checkbox').count() };
  await page.screenshot({ path: path.join(out, `${size.name}-bulk-step.png`) });
  if (!/Other experience · optional/.test(words) || !/Include in every selected application/.test(words)) row.failures.push('the bulk step does not show the Other experience boxes under "Include in every selected application"');
  if (row.bulk.boxes < 2) row.failures.push(`the bulk step shows ${row.bulk.boxes} boxes`);
  if (ids.lantern && !row.bulk.lanternTicked) row.failures.push('the bulk step does not tick the last choice (Lantern)');
  const before = row.writes.length;
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await wait(6000);
  if (row.writes.length !== before || row.stopped.some((line) => /\/jobs\/:id\//.test(line))) row.failures.push('Cancel let a write go out');
  if (!prepare) return;
  for (const id of two) { permit.moves.add(id); permit.generate.add(id); }
  const since = Date.now();
  await pick();
  if (!(await lantern.isChecked())) await lantern.check();
  const teaching = frame.getByRole('dialog').getByRole('checkbox', { name: /Weekend teaching/ });
  if (await teaching.isChecked()) await teaching.uncheck();
  await frame.getByRole('dialog').getByRole('button', { name: 'Prepare 2 applications' }).click();
  await page.screenshot({ path: path.join(out, `${size.name}-bulk-queued.png`) });
  const lanternId = ids.lantern || (await http(origin, person.token, 'GET', '/api/career-hunter/experience-bank?summary=1')).body.entries.find((one) => one.title === LANTERN.title).id;
  for (const id of two) { const job = await receiptOf(origin, person, id, since - 5000).catch((error) => { row.failures.push(message(error)); return null; }); if (job) await checkPrepared(ctx, job, lanternId, TEACHING, `bulk job ${two.indexOf(id) + 1}`); }
  await page.screenshot({ path: path.join(out, `${size.name}-bulk-prepared.png`) });
}

/** @description One size: sign in, open My jobs, run Prepare application and bulk Prepare as this size's part of the check. */
async function checkSize(browser, origin, person, size, out, preview, prepare, receipt, plan) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.touch, hasTouch: size.touch, deviceScaleFactor: size.touch ? 2.625 : 1 });
  const row = { size: `${size.width}x${size.height}`, failures: [], stopped: [], writes: [] }, permit = { moves: new Set(), generate: new Set() };
  receipt.sizes.push(row);
  try {
    await guard(context, origin, preview, permit, row);
    const page = await context.newPage();
    let frame = await signInAndOpen(page, origin, person);
    const listTab = frame.getByRole('tab', { name: 'List' });
    if ((await listTab.getAttribute('aria-selected')) !== 'true') { await listTab.click(); await wait(1500); }
    await frame.locator(`.job-row[data-job-id="${plan.single}"]`).waitFor({ timeout: 60000 }).catch(() => row.failures.push('the saved job is not on My jobs'));
    const ctx = { page, frame, origin, person, permit, row, out, ids: receipt.ids };
    const drawn = await single(ctx, size, plan.single, prepare && size === DESKTOP);
    if (size === PHONE && receipt.ids.lantern) {
      const lantern = drawn && drawn.boxes.find((box) => box.title === LANTERN.title);
      if (!lantern || !lantern.ticked || !/Ticked as in the last application you prepared/.test(drawn.hint)) row.failures.push('the next job does not open with the last choice (Lantern) ticked and said');
    }
    frame = await openBoard(page, origin);
    await bulk({ ...ctx, frame }, size, plan.bulk, prepare && size === DESKTOP);
    const own = row.stopped.filter((line) => /\(from \/api\/career-hunter\//.test(line));
    if (own.length) row.failures.push(`the page tried a write the check did not permit: ${own.join('; ')}`);
  } catch (error) { row.failures.push(message(error)); }
  finally {
    const cookies = await context.cookies(origin).catch(() => []);
    for (const cookie of cookies.filter((one) => /session/i.test(one.name))) await http(origin, cookie.value, 'DELETE', '/sessions', { accepted: [200, 204, 401] }).catch(() => {});
    await context.close();
  }
}

/** @description `check`: Prepare application and bulk Prepare at 1440 and 412 as the test person; exit 0 when they meet 1.68.1's bar. */
async function check(origin, file, out, preview, prepare) {
  const person = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  const served = await http(origin, person.token, 'GET', '/api/career-hunter/_smoke', { accepted: [200, 401, 403, 404] }).catch(() => ({ body: null }));
  const bank = (await http(origin, person.token, 'GET', '/api/career-hunter/experience-bank?summary=1')).body;
  const receipt = { origin, at: new Date().toISOString(), career: served.body && served.body.version, preview: Boolean(preview), prepare, ids: {}, sizes: [], failures: [] };
  if (!bank || !Object.prototype.hasOwnProperty.call(bank, 'last')) receipt.failures.push('the experience read names no last choice (Career before 1.68.1)');
  const open = await unprepared(origin, person);
  if (open.length < 5) receipt.failures.push(`the person has ${open.length} saved jobs without a résumé; the check needs 5 (run person again to save more)`);
  const plans = { desktop: { single: open[0], bulk: [open[1], open[2]] }, phone: { single: open[3], bulk: [open[3], open[4]] } };
  const browser = await playwright().chromium.launch({ headless: true });
  try { if (open.length >= 5) for (const size of [DESKTOP, PHONE]) await checkSize(browser, origin, person, size, out, preview, prepare, receipt, plans[size.name]); }
  finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'career-prepare-other-experience-live.json'), JSON.stringify(receipt, null, 2));
  say('check', receipt);
  return receipt.failures.length || receipt.sizes.some((row) => row.failures.length) ? 1 : 0;
}

/** @description `remove`: take the grant back and deactivate the test person. */
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
  const origin = testSlot(loopback(base));
  const previewAt = flags.indexOf('--preview'), preview = previewAt >= 0 ? path.resolve(flags[previewAt + 1] || '') : '';
  if (mode === 'person' && second && third) await makePerson(origin, second, third);
  else if (mode === 'check' && second && third) process.exitCode = await check(origin, second, third, preview, flags.includes('--prepare'));
  else if (mode === 'remove' && second && third) await remove(origin, second, third);
  else throw new Error('usage: person <base> <env file> <person file> | check <base> <person file> <out folder> [--prepare] [--preview <store root>] | remove <base> <env file> <person file>');
} catch (error) {
  console.error(`career-prepare-other-experience-live-proof: ${message(error)}`);
  process.exitCode = 1;
}
