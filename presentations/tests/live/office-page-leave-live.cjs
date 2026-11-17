/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 2.20.7 live check of AI Office page leave on the test slot (:38798 only; it refuses production and any other address), as a throwaway test person who holds only AI Office (invitation, then the application's own editor role through /api/authorization/composites preview and apply, removed at the end, also when the role is refused). The person signs in at /login with its own token and opens a new Word document in the editor at 412x915 (touch) and 1440x900; every request that is not GET or HEAD is stopped (only the sign-in's POST /sessions passes) and listed. Leaving the page, by the pagehide event the browser sends and then by a real navigation, must raise no error (2.20.6 raised "assistant is not defined"). Prints labels, counts and error text only; never a token, a header or document text.
 * -----------------------------------------------------------------------------
 *
 * usage: node presentations/tests/live/office-page-leave-live.cjs --env=<oshald.env of the test slot> --out=<proof dir> [--base=http://127.0.0.1:38798]
 * Exit 0 when every check holds.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const STORE = path.resolve(__dirname, '..', '..', '..');
const { chromium } = require(process.env.OSHAL_BROWSER_MODULE || path.join(STORE, 'scripts', 'toolchain', 'node_modules', 'playwright'));
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)));
const BASE = args.base || 'http://127.0.0.1:38798';
const APP = 'presentations';
const EDITOR = '/api/presentations/editor/app?kind=docx';
const SIZES = [{ name: '412x915', viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, { name: '1440x900', viewport: { width: 1440, height: 900 } }];
const run = `office-page-leave-${randomUUID().slice(0, 8)}`;
const receipt = { base: BASE, run, startedAt: new Date().toISOString(), loads: [], cleanup: [], problems: [] };

/** @description The installer's bearer from the kernel's env file, for the person's set-up and removal only; never printed. @returns {string} Token. */
function adminToken() {
  const line = fs.readFileSync(args.env, 'utf8').match(/^OSHAL_ADMIN_TOKEN=(.*)$/m);
  if (!line) throw new Error('no OSHAL_ADMIN_TOKEN in the env file');
  return line[1].trim().replace(/^['"]|['"]$/g, '');
}

/**
 * @description One JSON call to the kernel; answers status and body, never headers.
 * @param {string|null} token Bearer. @param {string} method Verb. @param {string} route Path. @param {object} [body] JSON. @param {object} [extra] Headers.
 * @returns {Promise<{status:number,json:object}>} The answer.
 */
async function call(token, method, route, body, extra = {}) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra };
  const answer = await fetch(BASE + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await answer.text();
  try { return { status: answer.status, json: JSON.parse(text) }; } catch { return { status: answer.status, json: { text: text.slice(0, 160) } }; }
}

/** @description A new person (an accepted invitation), not yet holding anything. @param {string} admin Bearer. @returns {Promise<{id:string,token:string,assignment:string}>} The person. */
async function makePerson(admin) {
  const invite = await call(admin, 'POST', '/people/invitations', { invitee: run, tier: 'editor', lifetime_ms: 3600000 });
  if (invite.status >= 300) throw new Error(`invitation refused: ${invite.status}`);
  const accepted = await call(null, 'POST', `/people/invitations/${encodeURIComponent(invite.json.token)}/accept`, { subject: run });
  if (accepted.status >= 300) throw new Error(`accept refused: ${accepted.status}`);
  return { id: accepted.json.principal, token: accepted.json.token, assignment: `${run}-office` };
}

/** @description Give the person AI Office's editor role (AI Office declares admin, editor and viewer). @param {string} admin Bearer. @param {object} person The person. @returns {Promise<void>} */
async function grantOffice(admin, person) {
  const catalog = (await call(admin, 'GET', '/api/authorization/composites')).json;
  const body = { target: person.id, assignment_id: person.assignment, action: 'assign', expected_revision: catalog.revision, reason: run,
    idempotency_key: randomUUID(), selection: { kind: 'granular', app: APP, role: 'editor' } };
  body.expected_plan_revision = (await call(admin, 'POST', '/api/authorization/composites/preview', body)).json.plan_revision;
  const applied = await call(admin, 'POST', '/api/authorization/composites/apply', body);
  if (applied.status !== 200) throw new Error(`role refused: ${applied.status}`);
}

/**
 * @description Stop every request that is not GET or HEAD, except the sign-in itself while it runs, and list each by method and path.
 * @param {object} context Browser context. @param {{signingIn:boolean}} state Sign-in state. @param {Array} stopped The list. @returns {Promise<void>}
 */
async function guard(context, state, stopped) {
  await context.route(() => true, (route) => {
    const request = route.request(), method = request.method(), where = new URL(request.url());
    if (method === 'GET' || method === 'HEAD') return route.continue();
    if (state.signingIn && method === 'POST' && where.origin === BASE && where.pathname === '/sessions') return route.continue();
    stopped.push({ method, path: where.origin === BASE ? where.pathname : where.origin });
    return route.abort();
  });
}

/**
 * @description Sign in, open a new Word document, leave by pagehide and by navigation, and record what was raised.
 * @param {object} browser Chromium. @param {object} person The person. @param {object} size A viewport. @returns {Promise<object>} The load's record.
 */
async function load(browser, person, size) {
  const { name, ...options } = size, context = await browser.newContext(options), state = { signingIn: true }, stopped = [], errors = [];
  await guard(context, state, stopped);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(String(error.message || error).slice(0, 200)));
  page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
  await page.goto(`${BASE}/login?next=${encodeURIComponent('/cockpit/')}`, { waitUntil: 'domcontentloaded' });
  await page.locator('#loginTokenBox > summary').click();
  await page.locator('#loginTokenValue').fill(person.token);
  await Promise.all([page.waitForURL((url) => url.pathname.startsWith('/cockpit'), { timeout: 30000 }), page.locator('#loginToken button[type="submit"]').click()]);
  state.signingIn = false;
  await page.goto(BASE + EDITOR, { waitUntil: 'domcontentloaded' });
  const ready = await page.locator('html[data-office-ready=true]').waitFor({ timeout: 45000 }).then(() => true, () => false);
  const seen = { size: name, editorReady: ready, concierge: ready ? await page.locator('#office-ai').count() : null };
  seen.screenshot = path.join(args.out, `office-${name}.png`);
  await page.screenshot({ path: seen.screenshot, fullPage: false });
  seen.pagehideError = ready ? await page.evaluate(() => { let thrown = null; const note = (event) => { thrown = thrown || String(event.message || event.error); };
    addEventListener('error', note); dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })); removeEventListener('error', note); return thrown; }) : 'editor not ready';
  await page.goto(`${BASE}/cockpit/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  seen.pageErrors = errors;
  seen.stopped = stopped;
  await context.close();
  return seen;
}

/** @description Judge one load. @param {object} seen The load's record. @returns {string[]} Problems. */
function judge(seen) {
  const problems = [];
  if (!seen.editorReady) problems.push('the editor did not finish starting');
  if (seen.pagehideError) problems.push(`leaving the page raised: ${seen.pagehideError}`);
  if (seen.pageErrors.length) problems.push(`page errors: ${seen.pageErrors.join(' | ')}`);
  for (const s of seen.stopped.filter((s) => /^\/api\/presentations/.test(s.path))) problems.push(`the editor sent ${s.method} ${s.path}`);
  return problems.map((line) => `${seen.size}: ${line}`);
}

/** @description Remove the person's sessions, its role and the person. @param {string} admin Bearer. @param {object} person The person. @returns {Promise<void>} */
async function cleanUp(admin, person) {
  const note = (what, answer) => receipt.cleanup.push(`${what}: ${answer.status}`);
  const session = await call(null, 'POST', '/sessions', { token: person.token });
  if (session.json && session.json.session) note('sign out everywhere', await call(session.json.session, 'POST', '/api/auth/signout-everywhere', {}));
  const catalog = (await call(admin, 'GET', '/api/authorization/composites')).json;
  note('revoke role', await call(admin, 'POST', '/api/authorization/composites/apply', { target: person.id, assignment_id: person.assignment,
    action: 'revoke', expected_revision: catalog.revision, reason: run, idempotency_key: randomUUID() }));
  for (const [method, route] of [['DELETE', `/people/${person.id}`], ['POST', `/people/${person.id}/deactivate`]]) {
    const confirmation = (await call(admin, 'POST', '/confirmations', {})).json.confirmation;
    note(`${method} ${route.replace(person.id, '<person>')}`, await call(admin, method, route, method === 'POST' ? {} : undefined, { 'x-oshal-confirm': confirmation }));
  }
}

/** @description The check: make the person, load both sizes, judge, clean up, write the receipt. @returns {Promise<void>} */
async function main() {
  if (BASE !== 'http://127.0.0.1:38798') throw new Error(`refusing ${BASE}: the test slot (http://127.0.0.1:38798) only, never production`);
  if (!args.env || !args.out) throw new Error('usage: --env=<oshald.env> --out=<dir> [--base=http://127.0.0.1:38798]');
  fs.mkdirSync(args.out, { recursive: true });
  const admin = adminToken();
  receipt.packageVersion = ((await call(admin, 'GET', '/packages')).json.packages || []).find((p) => p.name === APP)?.version;
  let person = null;
  const browser = await chromium.launch();
  try {
    person = await makePerson(admin);
    await grantOffice(admin, person);
    for (const size of SIZES) {
      const seen = await load(browser, person, size);
      receipt.loads.push(seen);
      receipt.problems.push(...judge(seen));
    }
  } catch (error) {
    receipt.problems.push(`run stopped: ${String(error.message || error).split('\n')[0].slice(0, 200)}`);
  } finally {
    await browser.close();
    if (person) await cleanUp(admin, person).catch((error) => receipt.problems.push(`clean-up: ${error.message}`));
    receipt.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(args.out, 'receipt-office-page-leave.json'), `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(JSON.stringify(receipt, null, 2));
    process.exitCode = receipt.problems.length ? 1 : 0;
  }
}

if (require.main === module) main().catch((error) => { console.error(String(error.message || error).split('\n')[0]); process.exitCode = 1; });
