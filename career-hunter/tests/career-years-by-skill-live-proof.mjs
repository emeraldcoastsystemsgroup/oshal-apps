#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.24 (Roger, 2026-11-19: "i have to be able to generate accurate resumes ... i cant have random numbers 2 years vs 11 years vs 20 years getting out of place"). The check of Work history's Years by skill section on an installed Career, on a test slot, as a test person. `person` makes a test person with a made-up résumé (Career ingests it with the model, a few minutes). `check` signs in as that person on the slot's own sign-in page at 1440x900 and 412x915, opens Work history, gives three made-up skill figures and a total, saves, reloads and reads them back with what Used on résumés says, saves one more change and presses Undo, tries one figure the form does not take and reads the refusal, and then puts the person's years back as it found them; it writes screenshots and a JSON receipt. Every request that is not a read, the sign-in, a years save or its Undo is stopped and listed. `remove` takes the test person's role back and deactivates it.
 *
 * Usage (a loopback kernel only; the administrator credential is read by name from the env file and never printed, the
 * person's credential stays in its 0600 file and is typed only into the slot's own sign-in page; all three refuse port 38788):
 *   node career-hunter/tests/career-years-by-skill-live-proof.mjs person http://127.0.0.1:38798 <slot env file> <person file>
 *   node career-hunter/tests/career-years-by-skill-live-proof.mjs check  http://127.0.0.1:38798 <person file> <out folder>
 *   node career-hunter/tests/career-years-by-skill-live-proof.mjs remove http://127.0.0.1:38798 <slot env file> <person file>
 * Playwright comes from STORE_CI_TOOLCHAIN or the store's scripts/toolchain (npm ci --prefix scripts/toolchain).
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { playwright } from './helpers/ux-page.mjs';

const WORK_HISTORY = '/cockpit/?app=career-hunter&screen=career-work-history';
const FRAME = /\/api\/career-hunter\/work-history/;
const SECTION = '/api/career-hunter/resume/master-section?field=years';
const EDIT = '/api/career-hunter/resume/master-edit';
const ALLOWED = /^\/api\/career-hunter\/resume\/master-(edit|undo)$/;
// Each size gives its own made-up figures, so each save is a change. Nothing here is anyone's data.
const SIZES = [
  { width: 1440, height: 900, touch: false, total: 12, later: 12.5, figures: [['Lantern scheduling', 3], ['Python', 7], ['Go', 4.5]] },
  { width: 412, height: 915, touch: true, total: 13, later: 13.5, figures: [['Lantern scheduling', 2], ['Python', 8], ['Go', 5.5]] },
];
const LABELS = { heading: 'Years by skill', columns: ['Skill', 'From your roles', 'Your figure', 'Used on résumés'],
  groups: ['Add a skill', 'Years of experience in total'], save: 'Save years', undo: 'Undo' };
const RESUME = `Morgan Sample
Platform engineer | Sampletown, USA | morgan.sample@example.com
SUMMARY
Builds scheduling platforms (a made-up résumé for a test).
EXPERIENCE
Platform Engineer, Sample Freight, 2021-01 to 2024-06
- Ran the build farm in Python and Go.
Systems Engineer, Northwind Logistics, 2016-01 to 2020-12
- Kept the ledger running on Java and SQL.
SKILLS
Python, Go, Java, SQL
EDUCATION
B.S. Computer Science, Sample State University, 2015
`;

const say = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const message = (error) => String((error && error.message) || error).split('\n')[0].slice(0, 300);
const words = (years) => (years === 1 ? '1 year' : `${years} years`);

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
    reason: 'Career years by skill proof (test person)', idempotency_key: randomUUID(),
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

/** @description The person's years as the section reads them, or a refusal naming the missing release. */
async function readYears(origin, token) {
  const answer = await http(origin, token, 'GET', SECTION, { accepted: [200, 400] });
  if (answer.status === 400) throw new Error('this Career cannot read years by skill (career-hunter 1.68.24 is not installed on this slot)');
  return answer.body;
}

/** @description The form a years read amounts to: the person's own figures and total, as a save takes them. */
function formOf(read) {
  return { years_by_skill: read.rows.filter((row) => row.yours !== null).map((row) => ({ skill: row.skill, years: row.yours })), career_years: read.career_yours };
}
/** Two forms hold the same figures; a skill's name is compared without regard to case (a row keeps the name it shows). */
const flat = (form) => JSON.stringify([form.years_by_skill.map((one) => [one.skill.toLowerCase(), one.years]).sort((x, y) => x[0].localeCompare(y[0])), form.career_years]);
const sameForm = (a, b) => flat(a) === flat(b);

/** @description `person`: make (or reuse) the test person with a made-up résumé Career has finished reading. */
async function makePerson(origin, envFile, file) {
  const admin = adminToken(envFile);
  if (fs.existsSync(file)) { say('test person kept', { subject: JSON.parse(fs.readFileSync(file, 'utf8')).subject }); return; }
  const subject = `careeryears1-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const invite = (await http(origin, admin, 'POST', '/people/invitations', { body: { invitee: subject, tier: 'editor', lifetime_ms: 3600000 } })).body;
  const accepted = (await http(origin, '', 'POST', `/people/invitations/${encodeURIComponent(invite.token)}/accept`, { body: { subject, display_name: 'Morgan Sample (test)' } })).body;
  const person = { base: origin, subject, principal: accepted.principal, token: accepted.token, grants: [] };
  privateWrite(file, person);
  const held = { id: `careeryears1-career-hunter-${randomUUID().slice(0, 8)}`, app: 'career-hunter', role: 'member' };
  await grant(origin, admin, person.principal, held);
  person.grants.push(held);
  privateWrite(file, person);
  await http(origin, person.token, 'POST', '/packages/career-hunter/schema', { body: {} });
  const form = new FormData();
  form.append('resume', new Blob([RESUME], { type: 'text/plain' }), 'morgan-sample-resume.txt');
  await http(origin, person.token, 'POST', '/api/career-hunter/resume/upload', { form, accepted: [200, 202] });
  await until(async () => {
    const state = (await http(origin, person.token, 'GET', '/api/career-hunter/resume/state')).body;
    if (state && state.ingest && state.ingest.state === 'failed') throw new Error('indexing failed');
    return state && state.hasResume === true && !state.indexing;
  }, 900000, 'Career indexing the made-up résumé');
  const read = await readYears(origin, person.token);
  say('test person', { subject, skillsCounted: read.rows.length, totalFromRoles: read.career_from_roles });
}

/** @description Stop every request of this context that is not a read, the sign-in, a years save or its Undo. */
async function guard(context, origin, row) {
  await context.route((url) => new URL(url).origin === origin, (route) => {
    const request = route.request(), where = new URL(request.url()).pathname, method = request.method();
    if (method === 'GET' || method === 'HEAD' || (method === 'POST' && where === '/sessions')) return route.continue();
    if (method === 'POST' && ALLOWED.test(where)) { row.writes.push(`${method} ${where}`); return route.continue(); }
    let from = '';
    try { from = new URL(request.frame().url()).pathname; } catch { from = ''; } // a request with no frame left is listed without one
    row.stopped.push(`${method} ${where} (from ${from})`);
    return route.abort();
  });
}

/** @description Sign in on the slot's own sign-in page as the person, landing on Work history; answers its frame. */
async function signInAndOpen(page, origin, person) {
  await page.goto(`${origin}/login?next=${encodeURIComponent(WORK_HISTORY)}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('#loginTokenBox > summary').click();
  await page.locator('#loginTokenValue').fill(person.token);
  await page.locator('#loginToken button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname.startsWith('/cockpit'), { timeout: 90000 });
  return section(page);
}

/** @description Work history's frame once the Years by skill section has drawn its form. */
function section(page) {
  return until(async () => {
    const frame = page.frames().find((one) => FRAME.test(one.url()));
    return frame && (await frame.locator('#whYears:not([hidden]) #yrSave:not([disabled])').count()) && frame;
  }, 120000, 'Work history with its Years by skill section');
}

/** @description What the section shows: its labels, each row, the total, the notice, and whether anything is too wide. */
function shown(frame, top) {
  return frame.evaluate((screen) => {
    const part = document.getElementById('whYears'), text = (node) => (node ? node.textContent.trim() : '');
    const controls = [...part.querySelectorAll('input, button')].filter((el) => el.offsetParent);
    return {
      heading: text(part.querySelector('h2')), columns: [...part.querySelectorAll('thead th')].map(text), groups: [...part.querySelectorAll('legend')].map(text),
      buttons: [...part.querySelectorAll('button')].filter((el) => !el.hidden).map(text),
      rows: Object.fromEntries([...document.querySelectorAll('#yrRows tr')].map((row) => [row.dataset.skill.toLowerCase(), { name: row.dataset.skill, roles: text(row.cells[1]), yours: row.querySelector('input').value, used: text(row.cells[3]) }])),
      total: { roles: text(document.getElementById('yrCareerRoles')), yours: document.getElementById('yrCareerYours').value, used: text(document.getElementById('yrCareerUsed')) },
      notice: text(document.getElementById('yrNotice')),
      layout: { sideways: document.scrollingElement.scrollWidth > Math.min(window.innerWidth, screen) + 1,
        outside: [...part.querySelectorAll('*')].filter((el) => el.offsetParent && el.getBoundingClientRect().right > Math.min(window.innerWidth, screen) + 0.5).length,
        short: controls.filter((el) => el.getBoundingClientRect().height < 44).length,
        small: controls.filter((el) => el.tagName === 'INPUT' && parseFloat(getComputedStyle(el).fontSize) < 16).length },
    };
  }, top);
}

/** @description Give the size's three figures through Add a skill, and its total. */
async function give(frame, figures, total) {
  for (const [skill, years] of figures) {
    await frame.locator('#yrAddSkill').fill(skill);
    await frame.locator('#yrAddYears').fill(String(years));
    await frame.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await frame.locator('#yrCareerYours').fill(String(total));
}

/** @description Whether what the section shows is the size's three figures and the given total, each used exactly. */
function holds(view, figures, total) {
  return figures.every(([skill, years]) => { const row = view.rows[skill.toLowerCase()]; return row && row.yours === String(years) && row.used === words(years); })
    && view.total.yours === String(total) && view.total.used === words(total);
}

/** @description The steps of one size, on a signed-in page: labels and layout, save, reload, Undo, one refused figure. */
async function steps({ page, frame, origin, person, size, out, row }) {
  // The screen as the person sees it, with one part of the section brought into view (the section is taller than a phone).
  const label = `${size.width}x${size.height}`, first3 = `#yrRows tr[data-skill="${size.figures[0][0]}"]`;
  const shot = async (name, part) => { await frame.locator(part).first().scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(out, `years-${label}-${name}.png`) }); };
  const saved = () => frame.locator('#yrNotice', { hasText: 'Saved.' }).waitFor({ timeout: 60000 });
  const first = await shown(frame, size.width);
  row.labels = { heading: first.heading, columns: first.columns, groups: first.groups, buttons: first.buttons };
  if (first.heading !== LABELS.heading || JSON.stringify(first.columns) !== JSON.stringify(LABELS.columns) || JSON.stringify(first.groups) !== JSON.stringify(LABELS.groups)
    || !first.buttons.includes(LABELS.save)) row.failures.push('the section does not carry its labels');
  row.layout = first.layout;
  if (first.layout.sideways || first.layout.outside || (size.touch && (first.layout.short || first.layout.small))) row.failures.push(`layout ${JSON.stringify(first.layout)}`);
  await shot('open', '#whYearsTitle');
  await give(frame, size.figures, size.total);
  await frame.getByRole('button', { name: LABELS.save }).click();
  await saved();
  const wanted = { years_by_skill: [...formOf(row.before).years_by_skill.filter((one) => !size.figures.some(([skill]) => skill.toLowerCase() === one.skill.toLowerCase())),
    ...size.figures.map(([skill, years]) => ({ skill, years }))], career_years: size.total };
  if (!sameForm(formOf(await readYears(origin, person.token)), wanted)) row.failures.push('the saved years are not the three figures and the total given');
  if (!holds(await shown(frame, size.width), size.figures, size.total)) row.failures.push('after Save the table does not show the saved figures as used');
  await shot('saved', '#yrNotice');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
  frame = await section(page);
  const again = await shown(frame, size.width);
  row.reloaded = { rows: Object.fromEntries(size.figures.map(([skill]) => [skill, again.rows[skill.toLowerCase()] || null])), total: again.total };
  if (!holds(again, size.figures, size.total)) row.failures.push('after a reload the figures or what Used on résumés says are not the saved ones');
  await shot('reloaded', first3);
  await frame.locator('#yrCareerYours').fill(String(size.later));
  await frame.getByRole('button', { name: LABELS.save }).click();
  await saved();
  if ((await readYears(origin, person.token)).career_yours !== size.later) row.failures.push('the second save did not change the total');
  await frame.getByRole('button', { name: LABELS.undo }).click();
  await frame.locator('#yrNotice', { hasText: 'Undone.' }).waitFor({ timeout: 60000 });
  if (!sameForm(formOf(await readYears(origin, person.token)), wanted) || !holds(await shown(frame, size.width), size.figures, size.total)) row.failures.push('after Undo the years are not the ones saved before');
  await shot('undone', '#yrNotice');
  await frame.getByLabel(`Your figure for ${again.rows[size.figures[0][0].toLowerCase()].name}`, { exact: true }).fill('61');
  await frame.getByRole('button', { name: LABELS.save }).click();
  await frame.locator('#yrNotice', { hasText: 'Nothing was saved.' }).waitFor({ timeout: 60000 });
  row.refusal = (await shown(frame, size.width)).notice;
  if (!/must be from 0\.5 to 60/.test(row.refusal) || !row.refusal.includes(size.figures[0][0])) row.failures.push(`the refusal does not name the row and the bounds: ${row.refusal.slice(0, 200)}`);
  if (!sameForm(formOf(await readYears(origin, person.token)), wanted)) row.failures.push('the refused figure changed the saved years');
  await shot('refused', '#yrNotice');
}

/** @description Put the person's years back as the check found them, by the same edit the form makes. */
async function restore(origin, person, before) {
  const now = await readYears(origin, person.token);
  if (sameForm(formOf(now), formOf(before))) return true;
  await http(origin, person.token, 'POST', EDIT, { body: { revision: now.revision, edits: [{ op: 'set', field: 'years', value: formOf(before), summary: 'Years by skill proof: back as found' }] } });
  return sameForm(formOf(await readYears(origin, person.token)), formOf(before));
}

/** @description One size: sign in, run the steps, put the years back, sign out. */
async function checkSize(browser, origin, person, size, out, receipt) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.touch, hasTouch: size.touch, deviceScaleFactor: size.touch ? 2.625 : 1 });
  const row = { size: `${size.width}x${size.height}`, failures: [], stopped: [], writes: [], errors: [] };
  receipt.sizes.push(row);
  try {
    row.before = await readYears(origin, person.token);
    await guard(context, origin, row);
    const page = await context.newPage();
    page.on('pageerror', (error) => row.errors.push(message(error).slice(0, 160)));
    const frame = await signInAndOpen(page, origin, person);
    await steps({ page, frame, origin, person, size, out, row });
    const own = row.stopped.filter((line) => /\(from \/api\/career-hunter\//.test(line));
    if (own.length) row.failures.push(`Work history tried a write the check did not permit: ${own.join('; ')}`);
    if (row.errors.length) row.failures.push(`the page raised an error: ${row.errors[0]}`);
  } catch (error) { row.failures.push(message(error)); }
  finally {
    row.restored = row.before ? await restore(origin, person, row.before).catch((error) => { row.failures.push(`putting the years back: ${message(error)}`); return false; }) : false;
    if (!row.restored) row.failures.push('the person\'s years were not put back as found');
    row.before = row.before ? formOf(row.before) : null;
    const cookies = await context.cookies(origin).catch((error) => { say('sessions unread', { message: message(error) }); return []; });
    for (const cookie of cookies.filter((one) => /session/i.test(one.name))) await http(origin, cookie.value, 'DELETE', '/sessions', { accepted: [200, 204, 401] }).catch((error) => say('sign-out failed', { message: message(error) }));
    await context.close();
  }
}

/** @description `check`: exit 0 when the section saves, reads back, undoes and refuses at both sizes, and the years end as found. */
async function check(origin, file, out) {
  const person = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  const served = await http(origin, person.token, 'GET', '/api/career-hunter/_smoke', { accepted: [200, 401, 403, 404] }).catch((error) => { say('version unread', { message: message(error) }); return { body: null }; });
  const receipt = { origin, at: new Date().toISOString(), career: served.body && served.body.version, subject: person.subject, sizes: [], failures: [] };
  await readYears(origin, person.token);
  const browser = await playwright().chromium.launch({ headless: true });
  try { for (const size of SIZES) await checkSize(browser, origin, person, size, out, receipt); }
  finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'career-years-by-skill-live.json'), JSON.stringify(receipt, null, 2));
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

const [mode, base, second, third] = process.argv.slice(2);
try {
  if (!['person', 'check', 'remove'].includes(mode) || !base || !second || !third) throw new Error('usage: person <base> <env file> <person file> | check <base> <person file> <out folder> | remove <base> <env file> <person file>');
  const origin = testSlot(base);
  if (mode === 'person') await makePerson(origin, second, third);
  else if (mode === 'check') process.exitCode = await check(origin, second, third);
  else await remove(origin, second, third);
} catch (error) {
  console.error(`career-years-by-skill-live-proof: ${message(error)}`);
  process.exitCode = 1;
}
