#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.67.2 (Roger, 2026-11-16, from his phone: "Half of this page on mobile is taken by the header"). My résumé on an installed Career, on the test slot, as a test person with a made-up résumé: where the résumé page starts at 412x915, 390x844 and 360x780 (touch), whether the section tabs are one row, how many bars sit over the document, and how much of the screen the résumé has once the person scrolls into it. `check` is read-only (every request that is not GET or HEAD is stopped and listed) and exits 0 only when the page meets 1.67.2's bar; `--preview <store root>` serves My résumé's and AI Office's page files from a store checkout over the slot's real answers, to see a branch before it is delivered. `person` makes the test person once (an invitation, Job seeker and AI Office editor, the made-up résumé through Career's own upload and indexing, My résumé opened once so AI Office makes its document); `remove` signs it out, takes its grants back and deactivates it.
 *
 * Usage (a loopback kernel only; the administrator credential is read by name from the env file and never printed, the
 * person's credential stays in its 0600 file and never enters a page or a log):
 *   node career-hunter/tests/career-resume-header-live-proof.mjs person http://127.0.0.1:38798 <slot env file> <person file>
 *   node career-hunter/tests/career-resume-header-live-proof.mjs check  http://127.0.0.1:38798 <person file> <out folder> [--preview <store root>]
 *   node career-hunter/tests/career-resume-header-live-proof.mjs remove http://127.0.0.1:38798 <slot env file> <person file>
 * Playwright comes from STORE_CI_TOOLCHAIN or the store's scripts/toolchain (npm ci --prefix scripts/toolchain).
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { playwright } from './helpers/ux-page.mjs';

const STUDIO_LINK = '/cockpit/?app=career-hunter&screen=career-resume-studio';
const STUDIO = /\/api\/career-hunter\/resume-studio/;
const OFFICE = /\/api\/presentations\/editor\/app/;
const PHONES = [{ width: 412, height: 915 }, { width: 390, height: 844 }, { width: 360, height: 780 }];
// A made-up résumé (as long as a real two-page one, so there is somewhere to scroll); nothing here is anyone's data.
const RESUME = `Alex Sample
Platform engineering lead | Sampletown, USA | alex.sample@example.com
SUMMARY
Builds and runs cloud platforms that teams ship on every day. Leads small teams through migrations without downtime (a made-up résumé for a test).
EXPERIENCE
Platform Lead, Sample Cloud Co, 2021-03 to present
- Led the team that moved 40 services onto one platform without a missed release.
- Cut deploy time from 50 to 9 minutes by rebuilding the delivery pipeline.
- Set up on-call, the incident review and a runbook for every service.
- Hired and coached six engineers, two of them now team leads.
Senior Engineer, Example Freight, 2017-06 to 2021-02
- Built the shipment tracking pipeline that answers 2 million updates a day.
- Moved the tracking store to a managed database with no downtime.
- Mentored four engineers through their first on-call rotations.
- Wrote the team's guide to safe schema changes.
Engineer, Demo Retail, 2013-01 to 2017-05
- Wrote the store inventory service used by 300 stores.
- Added the nightly stock reconciliation and its alerts.
- Ported the checkout service to the new payments provider.
Junior Developer, Placeholder Media, 2011-06 to 2012-12
- Built internal tools for the newsroom.
- Kept the content site fast during election nights.
SKILLS
Cloud: AWS, Kubernetes, Terraform
Languages: Python, Go, SQL
EDUCATION
B.S. Computer Science, Sample State University, 2012
CERTIFICATIONS
AWS Solutions Architect
`;

const say = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const message = (error) => String((error && error.message) || error).split('\n')[0].slice(0, 300);

/** @description The loopback kernel's origin, or a refusal. @param {string} base An address. @returns {string} The origin. */
function loopback(base) {
  const origin = new URL(String(base || '')).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('this proof runs only against a loopback kernel, http://127.0.0.1:<port>');
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
    reason: 'Career My résumé phone header proof (test person)', idempotency_key: randomUUID(),
    ...(action === 'revoke' ? {} : { selection: { kind: 'granular', app: held.app, role: held.role } }) };
  if (action !== 'revoke') input.expected_plan_revision = (await http(origin, admin, 'POST', '/api/authorization/composites/preview', { body: input })).body.plan_revision;
  await http(origin, admin, 'POST', '/api/authorization/composites/apply', { body: input });
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
const frameOf = (page, pattern) => page.frames().find((frame) => pattern.test(frame.url()));

/** @description Open My résumé in the cockpit and wait for the main résumé's Word document. */
async function openStudio(page, origin) {
  await page.goto(origin + STUDIO_LINK, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const studio = await until(async () => { const f = frameOf(page, STUDIO); return f && (await f.evaluate(() => document.readyState === 'complete')) && f; }, 90000, 'My résumé');
  const office = await until(() => frameOf(page, OFFICE), 120000, "the main résumé's Word document");
  await until(() => office.evaluate(() => document.documentElement.dataset.officeReady === 'true' && Boolean(document.querySelector('.office-word-page'))), 90000, 'the document open');
  await until(() => studio.evaluate(() => (document.getElementById('status') || {}).textContent || ''), 60000, 'the save state');
  await page.waitForTimeout(800);
  return { studio, office };
}

/** @description `person`: make (or reuse) the test person with Job seeker, AI Office editor and the made-up résumé. */
async function makePerson(origin, envFile, file) {
  const admin = adminToken(envFile);
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const me = await http(origin, saved.token, 'GET', '/api/career-hunter/resume/state', { accepted: [200, 401, 403] }).catch(() => ({ status: 0 }));
    if (me.status === 200 && me.body && me.body.hasResume) { say('test person kept', { subject: saved.subject }); return; }
  }
  const subject = `careerhead1-resume-header-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const invite = (await http(origin, admin, 'POST', '/people/invitations', { body: { invitee: subject, tier: 'editor', lifetime_ms: 3600000 } })).body;
  const accepted = (await http(origin, '', 'POST', `/people/invitations/${encodeURIComponent(invite.token)}/accept`, { body: { subject, display_name: 'Alex Sample (test)' } })).body;
  const person = { base: origin, subject, principal: accepted.principal, token: accepted.token, grants: [] };
  privateWrite(file, person);
  for (const [app, role] of [['career-hunter', 'member'], ['presentations', 'editor']]) {
    const held = { id: `careerhead1-${app}-${randomUUID().slice(0, 8)}`, app, role };
    await grant(origin, admin, person.principal, held);
    person.grants.push(held);
    privateWrite(file, person);
  }
  for (const app of ['career-hunter', 'presentations']) await http(origin, person.token, 'POST', `/packages/${app}/schema`, { body: {} });
  say('test person', { subject, grants: person.grants.map((g) => `${g.app}:${g.role}`) });
  const form = new FormData();
  form.append('resume', new Blob([RESUME], { type: 'text/plain' }), 'alex-sample-resume.txt');
  const started = Date.now();
  await http(origin, person.token, 'POST', '/api/career-hunter/resume/upload', { form, accepted: [200, 202] });
  let state = null;
  await until(async () => {
    state = (await http(origin, person.token, 'GET', '/api/career-hunter/resume/state')).body;
    if (state && state.ingest && state.ingest.state === 'failed') throw new Error('indexing failed');
    return state && state.hasResume === true && !state.indexing;
  }, 900000, 'Career indexing the made-up résumé').catch((error) => { throw new Error(`${error.message}; ingest ${JSON.stringify(state && state.ingest && state.ingest.state)}`); });
  say('made-up résumé indexed', { seconds: Math.round((Date.now() - started) / 1000) });
  // My résumé opened once, with writes allowed, so AI Office makes the person's document; the check never writes.
  const browser = await playwright().chromium.launch({ headless: true }), sessions = [];
  try {
    const context = await signIn(browser, origin, person, { width: 1280, height: 900 }, sessions);
    const page = await context.newPage();
    const { studio } = await openStudio(page, origin);
    say('My résumé opened once', { status: await studio.evaluate(() => document.getElementById('status').textContent.trim()) });
  } finally { await browser.close(); say('signed out', { sessions: await signOut(origin, sessions) }); }
}

/** @description What the window shows: the résumé page's top, the rows over it and the bars, in the top window's pixels. */
function readLayout(studio) {
  return studio.evaluate(() => {
    const visible = (el) => Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    const outer = window.frameElement ? window.frameElement.getBoundingClientRect() : { top: 0 };
    const frame = document.getElementById('officeFrame'), f = frame.getBoundingClientRect(), inner = frame.contentDocument;
    const paper = inner.querySelector('.office-word-page').getBoundingClientRect();
    const sub = document.querySelector('.cf-subnav'), tabs = sub ? [...sub.querySelectorAll('a')] : [];
    const row = inner.querySelector('#office-header'), bottom = document.querySelector('.cf-bottombar');
    return { height: window.top.innerHeight, width: window.top.innerWidth, paperTop: Math.round(outer.top + f.top + paper.top),
      tabRows: new Set(tabs.map((a) => Math.round(a.getBoundingClientRect().top))).size, tabsHeight: sub ? Math.round(sub.getBoundingClientRect().height) : 0,
      documentBar: visible(document.getElementById('docbar')) ? Math.round(document.getElementById('docbar').getBoundingClientRect().height) : 0,
      officeRow: visible(row) ? Math.round(row.getBoundingClientRect().height) : 0,
      banner: visible(document.getElementById('docIdentity')) ? Math.round(document.getElementById('docIdentity').getBoundingClientRect().height) : 0,
      bottomTop: visible(bottom) ? Math.round(outer.top + bottom.getBoundingClientRect().top) : window.top.innerHeight,
      sideways: document.documentElement.scrollWidth > window.innerWidth };
  });
}

/** @description The share of the window the résumé has after the person scrolls into it (AI Office's canvas, a step at a time). */
async function scrolledShare(page, studio, office) {
  for (let i = 0; i < 5; i++) { await office.evaluate(() => document.getElementById('document-canvas').scrollBy(0, 160)); await page.waitForTimeout(90); }
  await page.waitForTimeout(700);
  return studio.evaluate(() => {
    const outer = window.frameElement ? window.frameElement.getBoundingClientRect() : { top: 0 };
    const f = document.getElementById('officeFrame').getBoundingClientRect(), bottom = document.querySelector('.cf-bottombar');
    const bottomTop = bottom && bottom.getClientRects().length ? outer.top + bottom.getBoundingClientRect().top : window.top.innerHeight;
    const area = Math.min(outer.top + f.bottom, bottomTop) - Math.max(outer.top + f.top, 0);
    return { area: Math.round(area), share: Math.round((100 * area) / window.top.innerHeight) };
  });
}

/** @description My résumé's and AI Office's page files from a store checkout, for --preview. */
function previewFile(root, pathname) {
  const inside = (folder, name) => { const full = path.resolve(folder, name); return full.startsWith(folder + path.sep) && fs.existsSync(full) ? full : null; };
  const career = path.join(root, 'career-hunter/tools'), office = path.join(root, 'presentations/tools/office');
  if (pathname === '/api/career-hunter/resume-studio') return path.join(career, 'career-resume-studio.html');
  if (pathname.startsWith('/api/career-hunter/static/')) return inside(career, path.basename(pathname));
  if (pathname === '/api/presentations/editor/app') return path.join(office, 'editor.html');
  if (pathname.startsWith('/api/presentations/editor/assets/')) return inside(office, path.basename(pathname));
  return null;
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

/** @description `check`: read-only, at the three phone sizes; exit 0 when the page meets 1.67.2's bar. */
async function check(origin, file, out, preview) {
  const person = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  const served = await http(origin, person.token, 'GET', '/api/career-hunter/_smoke', { accepted: [200, 401, 403, 404] }).catch(() => ({ body: null }));
  const receipt = { origin, at: new Date().toISOString(), career: served.body && served.body.version, preview: Boolean(preview), sizes: [], failures: [] };
  const browser = await playwright().chromium.launch({ headless: true }), sessions = [];
  try {
    for (const size of PHONES) {
      const context = await signIn(browser, origin, person, { ...size, touch: true }, sessions), stopped = [];
      await context.route((u) => new URL(u).origin === origin, (route) => {
        const request = route.request(), url = new URL(request.url());
        if (request.method() !== 'GET' && request.method() !== 'HEAD') {
          let from = ''; try { from = new URL(request.frame().url()).pathname; } catch { from = ''; }
          stopped.push(`${request.method()} ${url.pathname} (from ${from})`);
          return route.abort();
        }
        const local = preview ? previewFile(preview, url.pathname) : null;
        if (local) return route.fulfill({ status: 200, path: local, contentType: TYPES[path.extname(local)] || 'text/javascript; charset=utf-8', headers: { 'cache-control': 'no-store' } });
        return route.continue();
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', (error) => errors.push(message(error).slice(0, 160)));
      const { studio, office } = await openStudio(page, origin);
      const layout = await readLayout(studio);
      await page.screenshot({ path: path.join(out, `${size.width}x${size.height}-open.png`) });
      const scrolled = await scrolledShare(page, studio, office);
      await page.screenshot({ path: path.join(out, `${size.width}x${size.height}-scrolled.png`) });
      const own = stopped.filter((line) => /\(from \/api\/(career-hunter|presentations)\//.test(line));
      const row = { size: `${size.width}x${size.height}`, ...layout, quarter: Math.round(size.height / 4), scrolled, stoppedFromThePage: own.length, stopped, errors };
      receipt.sizes.push(row);
      const fail = (why) => receipt.failures.push(`${row.size}: ${why}`);
      if (layout.paperTop > size.height / 4) fail(`the résumé page starts ${layout.paperTop}px down, below the top quarter (${row.quarter}px)`);
      if (layout.tabRows !== 1) fail(`the section tabs take ${layout.tabRows} rows`);
      if (layout.officeRow) fail(`AI Office draws its own ${layout.officeRow}px row over the document`);
      if (!layout.documentBar || layout.documentBar > 56) fail(`the document bar is ${layout.documentBar}px`);
      if (scrolled.share < 85) fail(`scrolled into, the résumé has ${scrolled.share}% of the screen`);
      if (layout.sideways) fail('the page scrolls sideways');
      if (own.length) fail(`the page tried to write: ${own.join('; ')}`);
      await context.close();
    }
  } finally { await browser.close(); receipt.signedOut = await signOut(origin, sessions); }
  fs.writeFileSync(path.join(out, 'career-resume-header-live.json'), JSON.stringify(receipt, null, 2));
  say('check', receipt);
  return receipt.failures.length ? 1 : 0;
}

/** @description `remove`: sign out, take the grants back and deactivate the test person. */
async function remove(origin, envFile, file) {
  const admin = adminToken(envFile), person = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const held of person.grants || []) await grant(origin, admin, person.principal, held, 'revoke').catch((error) => say('revoke failed', { message: message(error) }));
  const confirmation = (await http(origin, admin, 'POST', '/confirmations', { body: {} })).body;
  await http(origin, admin, 'POST', `/people/${person.principal}/deactivate`, { body: {}, headers: { 'x-oshal-confirm': confirmation.confirmation } });
  await http(origin, person.token, 'GET', '/api/authorization/me', { accepted: [401, 403] });
  fs.rmSync(file, { force: true });
  say('test person removed', { subject: person.subject, grantsRevoked: (person.grants || []).length });
}

/** @description The two writing modes run on a test slot only: never on the production kernel's port. */
function testSlot(origin) {
  if (new URL(origin).port === '38788') throw new Error('person and remove write; they run on the test slot (http://127.0.0.1:38798), never on production');
  return origin;
}

const [mode, base, second, third, flag, previewRoot] = process.argv.slice(2);
try {
  const origin = mode === 'check' ? loopback(base) : testSlot(loopback(base));
  if (mode === 'person' && second && third) await makePerson(origin, second, third);
  else if (mode === 'check' && second && third) process.exitCode = await check(origin, second, third, flag === '--preview' ? path.resolve(previewRoot || '') : '');
  else if (mode === 'remove' && second && third) await remove(origin, second, third);
  else throw new Error('usage: person <base> <env file> <person file> | check <base> <person file> <out folder> [--preview <store root>] | remove <base> <env file> <person file>');
} catch (error) {
  console.error(`career-resume-header-live-proof: ${message(error)}`);
  process.exitCode = 1;
}
