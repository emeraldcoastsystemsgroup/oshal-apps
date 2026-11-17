/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.58.0 live check of the portfolio overview on a loopback kernel (the test slot, :38798), as a throwaway test person who holds only Intelligent Trades (invitation, then the application's @app-admin role through /api/authorization/composites preview and apply) and signs in at /login with an access token, in Chromium at 412x915 and 1440x900. The person has no connected account, so the check is the empty state, no page error, no sideways scroll, and the switch to the Trading status tab and back. Every request that is not GET or HEAD is stopped and listed (the one exception is the sign-in itself); no bearer reaches the browser. It prints labels and counts only, and removes the person, its sessions and its role at the end.
 * -----------------------------------------------------------------------------
 *
 * usage: node trading/tests/live/portfolio-overview-live.cjs --env=<oshald.env of the kernel> --out=<proof dir> [--expect=overview|cards] [--base=http://127.0.0.1:38798]
 * --expect=cards checks a kernel that still serves 1.57.0 (the cards are the first screen). Exit 0 when every check holds.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const STORE = path.resolve(__dirname, '..', '..', '..');
const { chromium } = require(process.env.OSHAL_BROWSER_MODULE || path.join(STORE, 'scripts', 'toolchain', 'node_modules', 'playwright'));
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)));
const BASE = args.base || 'http://127.0.0.1:38798';
const EXPECT = args.expect || 'overview';
const APP = 'intelligent-trades';
const SIZES = [{ name: '412x915', viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, { name: '1440x900', viewport: { width: 1440, height: 900 } }];
const run = `trades-overview-live-${randomUUID().slice(0, 8)}`;
const receipt = { base: BASE, expect: EXPECT, run, startedAt: new Date().toISOString(), loads: [], cleanup: [], problems: [] };

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

/**
 * @description A new person holding only Intelligent Trades: an invitation, its acceptance, and the application's role.
 * @param {string} admin Bearer. @returns {Promise<{id:string,token:string,assignment:string}>} The person (its token is never printed).
 */
async function makePerson(admin) {
  const invite = await call(admin, 'POST', '/people/invitations', { invitee: run, tier: 'editor', lifetime_ms: 3600000 });
  if (invite.status >= 300) throw new Error(`invitation refused: ${invite.status}`);
  const accepted = await call(null, 'POST', `/people/invitations/${encodeURIComponent(invite.json.token)}/accept`, { subject: run });
  if (accepted.status >= 300) throw new Error(`accept refused: ${accepted.status}`);
  const person = { id: accepted.json.principal, token: accepted.json.token, assignment: `${run}-trades` };
  const catalog = (await call(admin, 'GET', '/api/authorization/composites')).json;
  const body = { target: person.id, assignment_id: person.assignment, action: 'assign', expected_revision: catalog.revision, reason: run,
    idempotency_key: randomUUID(), selection: { kind: 'granular', app: APP, role: '@app-admin' } };
  body.expected_plan_revision = (await call(admin, 'POST', '/api/authorization/composites/preview', body)).json.plan_revision;
  const applied = await call(admin, 'POST', '/api/authorization/composites/apply', body);
  if (applied.status !== 200) throw new Error(`role refused: ${applied.status} ${String(applied.json.error || applied.json.message || '').slice(0, 120)}`);
  return person;
}

/**
 * @description Stop every request that is not GET or HEAD, except the sign-in itself while it runs, and list each one by
 *   method, path and the frame that sent it. No header is added: the session cookie the sign-in sets is the only credential.
 * @param {object} context Browser context. @param {{signingIn:boolean}} state Whether the sign-in is under way. @param {Array} stopped The list.
 * @returns {Promise<void>}
 */
async function guard(context, state, stopped) {
  await context.route(() => true, (route) => {
    const request = route.request(), method = request.method(), where = new URL(request.url());
    if (method === 'GET' || method === 'HEAD') return route.continue();
    if (state.signingIn && method === 'POST' && where.origin === BASE && where.pathname === '/sessions') return route.continue();
    let frame = '';
    try { frame = new URL(request.frame().url()).pathname; } catch { frame = '(no frame)'; }
    stopped.push({ method, path: where.origin === BASE ? where.pathname : where.origin, frame });
    return route.abort();
  });
}

/** @description The frame that holds the Trades page once its Accounts screen has drawn, or null. @param {object} page Page. @returns {Promise<object|null>} */
async function tradesFrame(page) {
  for (let i = 0; i < 120; i += 1) {
    for (const frame of page.frames()) {
      if (!/\/api\/trading\//.test(frame.url())) continue;
      const drawn = await frame.evaluate(() => Boolean(document.querySelector('#pfRoot [data-pf-empty], #pfRoot .pf-hero-top, #homeCards [data-story], #tiles'))).catch(() => false);
      if (drawn) return frame;
    }
    await page.waitForTimeout(500);
  }
  return null;
}

/** @description What the Accounts screen shows now, as labels and counts. @param {object} frame The Trades frame. @returns {Promise<object>} */
function readScreen(frame) {
  return frame.evaluate(() => {
    const text = (sel) => (document.querySelector(sel) ? document.querySelector(sel).textContent.replace(/\s+/g, ' ').trim() : null);
    return { screen: document.querySelector('#pfRoot') ? 'overview' : document.querySelector('#homeCards') ? 'cards' : document.querySelector('#tiles') ? 'former-landing' : 'none',
      tabs: [...document.querySelectorAll('[data-accounts-tab]')].map((b) => b.textContent + (b.getAttribute('aria-selected') === 'true' ? ' (selected)' : '')),
      emptyHeading: text('[data-pf-empty] h2'), stripLabel: text('.pf-strip p span'), seeWhy: text('.pf-strip button'),
      statusCards: document.querySelectorAll('#homeCards [data-story]').length, fallbackLine: Boolean(document.querySelector('#homeFallback')),
      sideways: document.documentElement.scrollWidth > window.innerWidth + 1 };
  });
}

/**
 * @description Switch to the Trading status tab and back, and record what each shows.
 * @param {object} page Page. @param {object} frame The Trades frame. @returns {Promise<object>} The status tab's headline label and whether the overview came back.
 */
async function switchTabs(page, frame) {
  await frame.locator('[data-accounts-tab="status"]').click();
  await frame.locator('#homeTop .story-answer').waitFor({ timeout: 30000 });
  const status = await frame.evaluate(() => ({ address: new URLSearchParams(location.search).get('sub'), label: document.querySelector('#homeTop .story-answer span').textContent,
    cards: document.querySelectorAll('#homeCards [data-story]').length }));
  await frame.locator('[data-accounts-tab="overview"]').click();
  await frame.locator('#pfRoot').waitFor({ timeout: 30000 });
  return { statusSub: status.address, statusLabel: status.label, statusCards: status.cards, overviewBack: await frame.locator('#pfRoot').count() === 1 };
}

/**
 * @description Sign in at /login with the person's access token, open Intelligent Trades in Today, and read the screen.
 * @param {object} browser Chromium. @param {object} person The person. @param {object} size A viewport. @returns {Promise<object>} The load's record.
 */
async function load(browser, person, size) {
  const { name, ...options } = size, context = await browser.newContext(options), state = { signingIn: true }, stopped = [], errors = [];
  await guard(context, state, stopped);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(String(error.message || error).slice(0, 200)));
  page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
  await page.goto(`${BASE}/login?next=${encodeURIComponent('/cockpit/?app=' + APP)}`, { waitUntil: 'domcontentloaded' });
  await page.locator('#loginTokenBox > summary').click();
  await page.locator('#loginTokenValue').fill(person.token);
  await Promise.all([page.waitForURL((url) => url.pathname.startsWith('/cockpit'), { timeout: 30000 }), page.locator('#loginToken button[type="submit"]').click()]);
  state.signingIn = false;
  const frame = await tradesFrame(page);
  const seen = { size: name, ...(frame ? await readScreen(frame) : { screen: 'not-found' }) };
  if (frame && seen.screen === 'overview') Object.assign(seen, await switchTabs(page, frame));
  await page.waitForTimeout(1500);
  seen.screenshot = path.join(args.out, `${EXPECT}-${name}.png`);
  await page.screenshot({ path: seen.screenshot, fullPage: false });
  seen.pageErrors = errors;
  seen.stopped = stopped;
  await context.close();
  return seen;
}

/** @description Judge one load against --expect. @param {object} seen The load's record. @returns {string[]} Problems. */
function judge(seen) {
  const problems = [];
  if (EXPECT === 'cards' && seen.screen !== 'cards') problems.push(`expected the 1.57.0 cards, saw ${seen.screen}`);
  if (EXPECT === 'overview') {
    if (seen.screen !== 'overview') problems.push(`expected the overview, saw ${seen.screen}`);
    if (seen.emptyHeading !== 'Connect your brokerage account') problems.push(`empty state heading is "${seen.emptyHeading}"`);
    if (!(seen.tabs || []).includes('Overview (selected)')) problems.push('the Overview tab is not selected');
    if (seen.stripLabel !== 'Is it trading?' || seen.seeWhy !== 'See why') problems.push('the "Is it trading?" line or its See why button is missing');
    if (seen.statusSub !== 'status' || seen.statusLabel !== 'Is it trading?' || !seen.overviewBack) problems.push('the switch to Trading status and back did not hold');
  }
  if (seen.pageErrors.length) problems.push(`page errors: ${seen.pageErrors.join(' | ')}`);
  if (seen.sideways) problems.push('the page scrolls sideways');
  for (const s of seen.stopped.filter((s) => /^\/api\/trading/.test(s.path))) problems.push(`the Trades page sent ${s.method} ${s.path}`);
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
  if (new URL(BASE).hostname !== '127.0.0.1') throw new Error(`refusing ${BASE}: a loopback kernel only`);
  if (!args.env || !args.out || !['overview', 'cards'].includes(EXPECT)) throw new Error('usage: --env=<oshald.env> --out=<dir> [--expect=overview|cards] [--base=]');
  fs.mkdirSync(args.out, { recursive: true });
  const admin = adminToken();
  receipt.packageVersion = ((await call(admin, 'GET', '/packages')).json.packages || []).find((p) => p.name === APP)?.version;
  let person = null;
  const browser = await chromium.launch();
  try {
    person = await makePerson(admin);
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
    fs.writeFileSync(path.join(args.out, `receipt-${EXPECT}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(JSON.stringify(receipt, null, 2));
    process.exitCode = receipt.problems.length ? 1 : 0;
  }
}

// Required by a fixture probe, the screen readers and the judge are used on their own; run as a script, it is the live check.
module.exports = { readScreen, switchTabs, judge };
if (require.main === module) main().catch((error) => { console.error(String(error.message || error).split('\n')[0]); process.exitCode = 1; });
