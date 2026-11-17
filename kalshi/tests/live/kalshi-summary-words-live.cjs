/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.10.1 live check of the company and family summary card on the test slot (:38798 only; it refuses production and any other address), as a throwaway test person who holds only Kalshi (invitation, then the application's @app-admin role through /api/authorization/composites preview and apply, removed at the end, also when the role is refused). The person signs in at /login with its own token and opens /api/kalshi/?audience=company and ?audience=family at 412x915 (touch) and 1440x900, the way the Business shells and the Home shell ask for the card; every request that is not GET or HEAD is stopped (only the sign-in's POST /sessions passes) and listed. The painted card must name its count "With an edge" and show none of monster, fold, playable or verdict, with no page error. Prints labels, counts and the card's words only; never a token or a header.
 * -----------------------------------------------------------------------------
 *
 * usage: node kalshi/tests/live/kalshi-summary-words-live.cjs --env=<oshald.env of the test slot> --out=<proof dir> [--base=http://127.0.0.1:38798]
 * Exit 0 when every check holds. A new person has no scan snapshot of its own, so the card is its waiting state; the
 * stat label and the absence of the retired words are what differ between 1.10.0 and 1.10.1 there. Every rating in the
 * table and the alerts is proven by tests/audience-view.test.cjs.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const STORE = path.resolve(__dirname, '..', '..', '..');
const { chromium } = require(process.env.OSHAL_BROWSER_MODULE || path.join(STORE, 'scripts', 'toolchain', 'node_modules', 'playwright'));
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)));
const BASE = args.base || 'http://127.0.0.1:38798';
const APP = 'kalshi';
const RETIRED = /\b(monster|fold(ed|s)?|playable|verdict)\b/i;
const SIZES = [{ name: '412x915', viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, { name: '1440x900', viewport: { width: 1440, height: 900 } }];
const run = `kalshi-summary-words-${randomUUID().slice(0, 8)}`;
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
  return { id: accepted.json.principal, token: accepted.json.token, assignment: `${run}-kalshi` };
}

/** @description Give the person Kalshi (its @app-admin role). @param {string} admin Bearer. @param {object} person The person. @returns {Promise<void>} */
async function grantKalshi(admin, person) {
  const catalog = (await call(admin, 'GET', '/api/authorization/composites')).json;
  const body = { target: person.id, assignment_id: person.assignment, action: 'assign', expected_revision: catalog.revision, reason: run,
    idempotency_key: randomUUID(), selection: { kind: 'granular', app: APP, role: '@app-admin' } };
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
 * @description Sign in, then open the card for each audience and read its words.
 * @param {object} browser Chromium. @param {object} person The person. @param {object} size A viewport. @returns {Promise<object[]>} One record per audience.
 */
async function load(browser, person, size) {
  const { name, ...options } = size, context = await browser.newContext(options), state = { signingIn: true }, stopped = [], records = [];
  await guard(context, state, stopped);
  const page = await context.newPage();
  page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
  await page.goto(`${BASE}/login?next=${encodeURIComponent('/cockpit/')}`, { waitUntil: 'domcontentloaded' });
  await page.locator('#loginTokenBox > summary').click();
  await page.locator('#loginTokenValue').fill(person.token);
  await Promise.all([page.waitForURL((url) => url.pathname.startsWith('/cockpit'), { timeout: 30000 }), page.locator('#loginToken button[type="submit"]').click()]);
  state.signingIn = false;
  for (const audience of ['company', 'family']) {
    const errors = [], onError = (error) => errors.push(String(error.message || error).slice(0, 200));
    page.on('pageerror', onError);
    stopped.length = 0;
    await page.goto(`${BASE}/api/kalshi/?audience=${audience}`, { waitUntil: 'domcontentloaded' });
    const painted = await page.locator(`#av-root[data-audience="${audience}"]:not(.is-loading)`).waitFor({ timeout: 30000 }).then(() => true, () => false);
    const seen = { size: name, audience, painted, failed: painted ? await page.locator('#av-root.is-error').count() > 0 : null };
    if (painted) Object.assign(seen, await page.evaluate(() => ({
      title: (document.querySelector('#av-root h1, #av-root .av-title') || {}).textContent || null,
      handsLabel: (document.querySelector('[data-stat="hands"] .av-stat-label') || document.querySelector('[data-stat="hands"]') || {}).textContent || null,
      words: (document.querySelector('#av-root').textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1200),
    })));
    seen.screenshot = path.join(args.out, `kalshi-${audience}-${name}.png`);
    await page.screenshot({ path: seen.screenshot, fullPage: true });
    page.off('pageerror', onError);
    seen.pageErrors = errors;
    seen.stopped = [...stopped];
    records.push(seen);
  }
  await context.close();
  return records;
}

/** @description Judge one card. @param {object} seen The card's record. @returns {string[]} Problems. */
function judge(seen) {
  const problems = [];
  if (!seen.painted || seen.failed) problems.push('the card was not painted');
  if (seen.painted && !/With an edge/.test(seen.handsLabel || '')) problems.push(`the count is labelled "${(seen.handsLabel || '').trim()}"`);
  const retired = seen.words ? seen.words.match(RETIRED) : null;
  if (retired) problems.push(`the card says "${retired[0]}"`);
  if (seen.pageErrors.length) problems.push(`page errors: ${seen.pageErrors.join(' | ')}`);
  for (const s of seen.stopped.filter((s) => /^\/api\/kalshi/.test(s.path))) problems.push(`the card sent ${s.method} ${s.path}`);
  return problems.map((line) => `${seen.audience} ${seen.size}: ${line}`);
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

/** @description The check: make the person, read both cards at both sizes, judge, clean up, write the receipt. @returns {Promise<void>} */
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
    await grantKalshi(admin, person);
    for (const size of SIZES) {
      for (const seen of await load(browser, person, size)) {
        receipt.loads.push(seen);
        receipt.problems.push(...judge(seen));
      }
    }
  } catch (error) {
    receipt.problems.push(`run stopped: ${String(error.message || error).split('\n')[0].slice(0, 200)}`);
  } finally {
    await browser.close();
    if (person) await cleanUp(admin, person).catch((error) => receipt.problems.push(`clean-up: ${error.message}`));
    receipt.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(args.out, 'receipt-kalshi-summary-words.json'), `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(JSON.stringify(receipt, null, 2));
    process.exitCode = receipt.problems.length ? 1 : 0;
  }
}

if (require.main === module) main().catch((error) => { console.error(String(error.message || error).split('\n')[0]); process.exitCode = 1; });
