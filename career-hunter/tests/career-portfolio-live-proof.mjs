#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.7 (Roger, 2026-11-17: "the bullets for oshal now should be oswarm and updated"). The blue check of the saved portfolio's Edit form on a test slot. `person` makes a test person with a made-up résumé (Career ingests it with the model, a few minutes) and writes a made-up saved portfolio through the real edit (POST /resume/master-edit, field portfolio). `check` signs the person in by a cookie session at 412x915 and 1440x900, opens Other experience in Today, opens the portfolio, changes its organization and first bullet, saves, reads the saved portfolio back, sees the list's title follow, presses Undo and reads the earlier version back; every other write the page tries is stopped and listed; the person's sessions are signed out. `remove` takes the role back and deactivates the person. Nothing here is anyone's data.
 *
 * Usage (a loopback kernel only; the administrator credential is read by name from the env file and never printed, the
 * person's credential stays in its 0600 file and never enters a page or a log; person, check and remove refuse port 38788):
 *   node career-hunter/tests/career-portfolio-live-proof.mjs person http://127.0.0.1:38798 <slot env file> <person file>
 *   node career-hunter/tests/career-portfolio-live-proof.mjs check  http://127.0.0.1:38798 <person file> <out folder>
 *   node career-hunter/tests/career-portfolio-live-proof.mjs remove http://127.0.0.1:38798 <slot env file> <person file>
 * Playwright comes from STORE_CI_TOOLCHAIN or the store's scripts/toolchain (npm ci --prefix scripts/toolchain).
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { playwright } from './helpers/ux-page.mjs';

const SCREEN = '/cockpit/?app=career-hunter&screen=career-experience-library';
const FRAME = /\/api\/career-hunter\/experience-library/;
const SIZES = [{ width: 412, height: 915, touch: true }, { width: 1440, height: 900 }];
const ALLOWED = /\/api\/career-hunter\/resume\/master-(edit|undo)$/;
// A made-up résumé and portfolio, so Career makes the person's store; nothing here is anyone's data.
const RESUME = `Robin Sample
Platform engineer | Sampletown, USA | robin.sample@example.com
SUMMARY
Builds scheduling platforms (a made-up résumé for a test).
EXPERIENCE
Platform Engineer, Sample Freight, 2019-03 to present
- Ran the build farm.
SKILLS
Go, Python
EDUCATION
B.S. Computer Science, Sample State University, 2018
`;
const PORTFOLIO = { label: 'Lantern work', note: 'Made-up portfolio for the 1.68.7 blue check.', title: 'Founder', org: 'Lantern (test portfolio)',
  span: '2024 to Present', person_url: 'https://robin.example.com/', platform_url: 'https://lantern.example.com/', product_url: '',
  scoring_blurb: 'Lantern: a made-up job scheduler for a test.', bullets: ['Wrote the Lantern scheduler.', 'Kept 12 plugins working.'],
  tech: ['Go', 'PostgreSQL'], applications: ['Ledger', 'Atlas'], skills: ['Go', 'Scheduling'] };

const say = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));
/** Two forms hold the same values, whatever their key order. */
const same = (a, b) => JSON.stringify(Object.keys(a || {}).sort().map((key) => [key, a[key]])) === JSON.stringify(Object.keys(b || {}).sort().map((key) => [key, b[key]]));
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
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: response.status, body: parsed };
}

/** @description Assign or take back one application role for the person (preview, then apply). */
async function grant(origin, admin, principal, held, action = 'assign') {
  const catalog = (await http(origin, admin, 'GET', '/api/authorization/composites')).body;
  const input = { target: principal, assignment_id: held.id, action, expected_revision: catalog.revision,
    reason: 'Career saved portfolio proof (test person)', idempotency_key: randomUUID(),
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

/** @description The person's saved portfolio as the Edit form reads it, or a refusal naming the missing release. */
async function readPortfolio(origin, token) {
  const answer = await http(origin, token, 'GET', '/api/career-hunter/resume/master-section?field=portfolio', { accepted: [200, 400] });
  if (answer.status === 400) throw new Error('this Career cannot read the saved portfolio (career-hunter 1.68.7 is not installed on this slot)');
  return answer.body;
}

/** @description `person`: make (or reuse) the test person with a made-up résumé, then write the made-up portfolio. */
async function makePerson(origin, envFile, file) {
  const admin = adminToken(envFile);
  if (fs.existsSync(file)) { say('test person kept', { subject: JSON.parse(fs.readFileSync(file, 'utf8')).subject }); return; }
  const subject = `careerportfolio1-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const invite = (await http(origin, admin, 'POST', '/people/invitations', { body: { invitee: subject, tier: 'editor', lifetime_ms: 3600000 } })).body;
  const accepted = (await http(origin, '', 'POST', `/people/invitations/${encodeURIComponent(invite.token)}/accept`, { body: { subject, display_name: 'Robin Sample (test)' } })).body;
  const person = { base: origin, subject, principal: accepted.principal, token: accepted.token, grants: [] };
  privateWrite(file, person);
  const held = { id: `careerportfolio1-career-hunter-${randomUUID().slice(0, 8)}`, app: 'career-hunter', role: 'member' };
  await grant(origin, admin, person.principal, held);
  person.grants.push(held);
  privateWrite(file, person);
  await http(origin, person.token, 'POST', '/packages/career-hunter/schema', { body: {} });
  const form = new FormData();
  form.append('resume', new Blob([RESUME], { type: 'text/plain' }), 'robin-sample-resume.txt');
  await http(origin, person.token, 'POST', '/api/career-hunter/resume/upload', { form, accepted: [200, 202] });
  await until(async () => {
    const state = (await http(origin, person.token, 'GET', '/api/career-hunter/resume/state')).body;
    if (state && state.ingest && state.ingest.state === 'failed') throw new Error('indexing failed');
    return state && state.hasResume === true && !state.indexing;
  }, 900000, 'Career indexing the made-up résumé');
  const opened = await readPortfolio(origin, person.token);
  const made = (await http(origin, person.token, 'POST', '/api/career-hunter/resume/master-edit', { body: { revision: opened.revision,
    edits: [{ op: 'set', field: 'portfolio', value: PORTFOLIO, summary: 'Made-up portfolio for the blue check' }] } })).body;
  if (!made.changed) throw new Error('the made-up portfolio was not written');
  say('test person', { subject, portfolio: PORTFOLIO.org });
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

/** @description The form's layout at this size: sideways scroll, short controls and small fields. */
function layout(frame) {
  return frame.evaluate(() => {
    const form = document.getElementById('portfolioForm');
    const controls = [...form.querySelectorAll('input, textarea, button:not([hidden])')].filter((el) => el.offsetParent);
    return { sideways: document.documentElement.scrollWidth > window.innerWidth,
      short: controls.filter((el) => el.getBoundingClientRect().height < 44).map((el) => el.id),
      small: controls.filter((el) => el.tagName !== 'BUTTON' && parseFloat(getComputedStyle(el).fontSize) < 16).map((el) => el.id) };
  });
}

/** @description One size: open the portfolio, change it, save, see it read back and in the list, Undo, see it back. */
async function checkPage(browser, origin, person, size, out, sessions, fail) {
  const context = await signIn(browser, origin, person, size, sessions), stopped = [];
  await context.route((u) => new URL(u).origin === origin, (route) => {
    const request = route.request(), where = new URL(request.url()).pathname;
    if (request.method() === 'GET' || request.method() === 'HEAD' || ALLOWED.test(where)) return route.continue();
    stopped.push(`${request.method()} ${where}`);
    return route.abort();
  });
  const page = await context.newPage(), errors = [], label = `${size.width}x${size.height}`, org = `Lantern Cloud (blue check ${label})`;
  page.on('pageerror', (error) => errors.push(message(error).slice(0, 160)));
  let fit = {};
  try {
    await page.goto(origin + SCREEN, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const frame = await until(() => page.frames().find((f) => FRAME.test(f.url())), 90000, 'Other experience');
    await frame.locator('#entries .entry', { hasText: PORTFOLIO.org }).click({ timeout: 90000 });
    await frame.locator('#portfolioForm').waitFor({ state: 'visible', timeout: 30000 });
    if (await frame.locator('#pfOrg').inputValue() !== PORTFOLIO.org) fail(`${label}: the form does not show the saved organization`);
    if (size.touch) {
      fit = await layout(frame);
      if (fit.sideways || fit.short.length || fit.small.length) fail(`${label}: layout ${JSON.stringify(fit)}`);
    }
    await page.screenshot({ path: path.join(out, `portfolio-${label}-open.png`) });
    await frame.locator('#pfOrg').fill(org);
    await frame.locator('#pfBullets').fill(['Rebuilt Lantern for the blue check.', ...PORTFOLIO.bullets.slice(1)].join('\n'));
    await frame.getByRole('button', { name: 'Save portfolio' }).click();
    await frame.locator('#pfNotice', { hasText: 'Saved.' }).waitFor({ timeout: 60000 });
    const after = (await readPortfolio(origin, person.token)).portfolio;
    if (after.org !== org || after.bullets[0] !== 'Rebuilt Lantern for the blue check.') fail(`${label}: the saved portfolio reads ${JSON.stringify([after.org, after.bullets[0]])}`);
    await frame.locator('#entries .entry', { hasText: org }).waitFor({ timeout: 30000 });
    await page.screenshot({ path: path.join(out, `portfolio-${label}-saved.png`) });
    await frame.getByRole('button', { name: 'Undo' }).click();
    await frame.locator('#pfNotice', { hasText: 'Undone.' }).waitFor({ timeout: 60000 });
    const back = (await readPortfolio(origin, person.token)).portfolio;
    if (!same(back, PORTFOLIO)) fail(`${label}: after Undo the portfolio is not the one saved before`);
  } catch (error) { fail(`${label}: ${message(error)}`); }
  await context.close();
  return { size: label, layout: fit, stopped, errors };
}

/** @description `check`: exit 0 when the form saves, the list follows and Undo puts the portfolio back at both sizes. */
async function check(origin, file, out) {
  const person = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  const receipt = { origin, at: new Date().toISOString(), subject: person.subject, failures: [], pages: [] };
  const fail = (why) => receipt.failures.push(why);
  const before = await readPortfolio(origin, person.token);
  if (!before.present || !same(before.portfolio, PORTFOLIO)) fail('the test person\'s portfolio is not the made-up one; run remove, then person');
  const browser = await playwright().chromium.launch({ headless: true }), sessions = [];
  try {
    for (const size of SIZES) receipt.pages.push(await checkPage(browser, origin, person, size, out, sessions, fail));
  } finally { await browser.close(); receipt.signedOut = await signOut(origin, sessions); }
  const record = (await http(origin, person.token, 'GET', '/api/career-hunter/master-record?page=1')).body || {};
  if (!String(record.text || '').includes(PORTFOLIO.org)) fail('Download my data does not list the saved portfolio');
  fs.writeFileSync(path.join(out, 'career-portfolio-live.json'), JSON.stringify(receipt, null, 2));
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
  const origin = testSlot(base);
  if (mode === 'person' && second && third) await makePerson(origin, second, third);
  else if (mode === 'check' && second && third) process.exitCode = await check(origin, second, third);
  else if (mode === 'remove' && second && third) await remove(origin, second, third);
  else throw new Error('usage: person <base> <env file> <person file> | check <base> <person file> <out folder> | remove <base> <env file> <person file>');
} catch (error) {
  console.error(`career-portfolio-live-proof: ${message(error)}`);
  process.exitCode = 1;
}
