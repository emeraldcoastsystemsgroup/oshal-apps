/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.5.3 live proof of Your devices on a loopback kernel (blue, :38798), as a throwaway test person holding phone-control's Device Control Administrator template, in a real Chromium at 412x915 with touch. The person saves one Android phone through phone-control's own POST /devices. Two loads of /cockpit/?app=phone-control: the person's real state (no computers), and the same with the kernel's GET /api/computers answer replaced in the browser by one connected, controllable Android node whose name does not contain the phone's name (the shape on Roger's phone; enrolling a real node on the dev slot would be copied into production by the dev-mode back-sync). With --expect broken the second load must show "Your devices could not be read: isTvNode is not defined" (1.5.2); with --expect reads neither load may show "could not be read" and both rows must render (1.5.3). The admin bearer is read from the env file, sent only to the loopback kernel and never printed; the person's session is a cookie set on the kernel's origin only. The phone record, the person's sessions (on the kernel and, because the dev slot copies sessions into production, on the production loopback when named), the assignment and the person are removed at the end. Receipt and screenshots go to the output folder.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const STORE = path.resolve(__dirname, '..', '..', '..');
const { chromium } = require(path.join(STORE, 'scripts', 'toolchain', 'node_modules', 'playwright'));
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)));
const BASE = args.base || 'http://127.0.0.1:38798';
const PRODUCTION = args.production || '';
const OUT = args.out;
const EXPECT = args.expect;
const PHONE = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const NODE = { id: '7d3c6a10-5b1e-4c55-9e0e-3f1a2b9c4d70', name: 'Living Room Fire TV', platform: 'android', connected: true,
  can_control: true, busy: false, tools: ['desktop.control', 'screen.capture', 'app.open'] };
const run = `phone-istvnode-proof-${randomUUID().slice(0, 8)}`;
const receipt = { base: BASE, expect: EXPECT, run, startedAt: new Date().toISOString(), loads: [], cleanup: [], problems: [] };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (const origin of [BASE, PRODUCTION].filter(Boolean)) {
  if (new URL(origin).hostname !== '127.0.0.1') throw new Error(`refusing ${origin}: the bearer goes to loopback only`);
}
if (!OUT || !['broken', 'reads'].includes(EXPECT) || !args.env) throw new Error('usage: --env=<oshald.env> --out=<dir> --expect=broken|reads [--base=] [--production=]');

/** @description The installer's bearer from the kernel's env file; never printed. @returns {string} Token. */
function adminToken() {
  const line = fs.readFileSync(args.env, 'utf8').match(/^OSHAL_ADMIN_TOKEN=(.*)$/m);
  if (!line) throw new Error('no OSHAL_ADMIN_TOKEN in the env file');
  return line[1].trim().replace(/^['"]|['"]$/g, '');
}

/** @description One JSON call; answers status and body, never headers. @param {string} origin Kernel. @param {string|null} token Bearer. @param {string} method Verb. @param {string} route Path. @param {object} [body] JSON. @param {object} [extra] Headers. @returns {Promise<{status:number,json:object|null}>} Answer. */
async function call(origin, token, method, route, body, extra = {}) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra };
  const answer = await fetch(origin + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await answer.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { text: text.slice(0, 160) }; }
  return { status: answer.status, json };
}

/** @description A new person holding phone-control's admin template, signed in. @param {string} admin Bearer. @returns {Promise<object>} Person. */
async function makePerson(admin) {
  const invite = await call(BASE, admin, 'POST', '/people/invitations', { invitee: run, tier: args.tier || 'editor', lifetime_ms: 3600000 });
  if (invite.status >= 300) throw new Error(`invitation refused: ${invite.status}`);
  const accepted = await call(BASE, null, 'POST', `/people/invitations/${encodeURIComponent(invite.json.token)}/accept`, { subject: run });
  if (accepted.status >= 300) throw new Error(`accept refused: ${accepted.status}`);
  const person = { id: accepted.json.principal, token: accepted.json.token, assignment: `${run}-phone-control` };
  const catalog = (await call(BASE, admin, 'GET', '/api/authorization/composites')).json;
  const body = { target: person.id, assignment_id: person.assignment, action: 'assign', expected_revision: catalog.revision, reason: run,
    idempotency_key: randomUUID(), selection: { kind: 'composite', app: 'phone-control', template: 'admin' } };
  body.expected_plan_revision = (await call(BASE, admin, 'POST', '/api/authorization/composites/preview', body)).json.plan_revision;
  const applied = await call(BASE, admin, 'POST', '/api/authorization/composites/apply', body);
  if (applied.status !== 200) throw new Error(`assignment refused: ${applied.status} ${JSON.stringify(applied.json).slice(0, 160)}`);
  const session = await fetch(`${BASE}/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: person.token }) });
  if (session.status !== 201 && session.status !== 200) throw new Error(`person sign-in refused: ${session.status}`);
  person.session = (await session.json()).session;
  person.cookie = (session.headers.get('set-cookie') || 'oshal_session=').split('=')[0];
  return person;
}

/** @description The person saves one Android phone through the package's own route. @param {object} person Person. @returns {Promise<object>} The saved device. */
async function savePhone(person) {
  const saved = await call(BASE, person.session, 'POST', '/api/phone-control/devices',
    { platform: 'android', form: 'phone', name: 'Proof Pixel', address: '192.0.2.10:5555', computerNodeId: 'b6f2e8a4-0c71-4f3e-8d2a-5e9c1a7b3f20' });
  if (saved.status >= 300) throw new Error(`POST /api/phone-control/devices answered ${saved.status} ${JSON.stringify(saved.json).slice(0, 160)}`);
  return saved.json.device;
}

/** @description What the served session-computer.js imports from computer-link.js. @param {object} person Person. @returns {Promise<string>} The import line. */
async function servedImport(person) {
  const answer = await fetch(`${BASE}/api/phone-control/ui/session-computer.js`, { headers: { authorization: `Bearer ${person.session}` } });
  return ((await answer.text()).match(/^import \{[^}]*\} from '\/api\/phone-control\/ui\/computer-link\.js';$/m) || ['(no import line)'])[0];
}

/** @description The phone-control frame inside the cockpit, once the page has read. @param {object} page Page. @returns {Promise<object>} Frame. */
async function readPage(page) {
  for (let i = 0; i < 120; i += 1) {
    const frame = page.frames().find((f) => f.url().includes('/api/phone-control/ui'));
    const state = frame && await frame.evaluate(() => ({
      lede: document.getElementById('pageLede')?.textContent || '',
      rows: document.getElementById('phoneRail')?.children.length || 0
    })).catch(() => null);
    if (state && !/^Reading your phones/.test(state.lede) && state.lede) { await sleep(1500); return frame; }
    await sleep(250);
  }
  throw new Error('the phone-control page never finished reading');
}

/** @description Load the page once as the person and record what it says. @param {object} browser Chromium. @param {object} person Person. @param {boolean} androidNode Whether /api/computers answers one Android node. @returns {Promise<object>} The load's record. */
async function load(browser, person, androidNode) {
  const context = await browser.newContext(PHONE);
  await context.addCookies([{ name: person.cookie, value: person.session, domain: new URL(BASE).hostname, path: '/', httpOnly: true, sameSite: 'Lax' }]);
  if (androidNode) {
    await context.route((url) => url.origin === BASE && url.pathname === '/api/computers',
      (route) => (route.request().method() === 'GET' ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ computers: [NODE] }) }) : route.continue()));
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error.message || error)));
  page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
  await page.goto(`${BASE}/cockpit/?app=phone-control`, { waitUntil: 'domcontentloaded' });
  const frame = await readPage(page);
  const seen = await frame.evaluate(() => ({
    heading: document.getElementById('pageHeading')?.textContent || '',
    lede: document.getElementById('pageLede')?.textContent || '',
    devices: [...document.querySelectorAll('#phoneRail > *')].map((row) => row.textContent.replace(/\s+/g, ' ').trim()),
    addDisabled: Boolean(document.getElementById('addDeviceBtn')?.disabled),
    scrollsSideways: document.documentElement.scrollWidth > window.innerWidth + 1
  }));
  const file = path.join(OUT, `${EXPECT}-${androidNode ? 'with-android-node' : 'real-state'}-412x915.png`);
  await page.screenshot({ path: file, fullPage: false });
  await context.close();
  return { androidNodeDoubled: androidNode, ...seen, pageErrors: errors, screenshot: file };
}

/** @description Judge one load against --expect. @param {object} seen The load's record. @returns {string[]} Problems. */
function judge(seen) {
  const problems = [];
  const unread = /could not be read/.test(seen.lede);
  if (seen.heading !== 'Your devices') problems.push(`heading is "${seen.heading}"`);
  if (EXPECT === 'broken' && seen.androidNodeDoubled && !/Your devices could not be read: isTvNode is not defined/.test(seen.lede)) problems.push(`expected the 1.5.2 refusal, read "${seen.lede}"`);
  if (EXPECT === 'reads' && unread) problems.push(`"${seen.lede}"`);
  if (EXPECT === 'reads' && !seen.devices.some((row) => row.includes('Proof Pixel'))) problems.push('the saved phone has no row');
  if (EXPECT === 'reads' && seen.androidNodeDoubled && !seen.devices.some((row) => row.includes(NODE.name))) problems.push('the Android node has no row');
  if (EXPECT === 'reads' && seen.pageErrors.length) problems.push(`page errors: ${seen.pageErrors.join(' | ')}`);
  if (seen.scrollsSideways) problems.push('the page scrolls sideways at 412 px');
  return problems.map((line) => `${seen.androidNodeDoubled ? 'with Android node' : 'real state'}: ${line}`);
}

/** @description Remove the phone, the person's sessions, the assignment and the person. @param {string} admin Bearer. @param {object} person Person. @param {object} device Saved device. @returns {Promise<void>} Done. */
async function cleanUp(admin, person, device) {
  const note = (what, answer) => receipt.cleanup.push(`${what}: ${answer.status}`);
  if (device) note('DELETE phone', await call(BASE, person.session, 'DELETE', `/api/phone-control/devices/${encodeURIComponent(device.id)}`));
  if (person.session) note('sign out everywhere (kernel)', await call(BASE, person.session, 'POST', '/api/auth/signout-everywhere', {}));
  if (person.session && PRODUCTION) note('sign out everywhere (production copy)', await call(PRODUCTION, person.session, 'POST', '/api/auth/signout-everywhere', {}));
  const catalog = (await call(BASE, admin, 'GET', '/api/authorization/composites')).json;
  note('revoke assignment', await call(BASE, admin, 'POST', '/api/authorization/composites/apply', { target: person.id, assignment_id: person.assignment,
    action: 'revoke', expected_revision: catalog.revision, reason: run, idempotency_key: randomUUID() }));
  for (const [method, route] of [['DELETE', `/people/${person.id}`], ['POST', `/people/${person.id}/deactivate`]]) {
    const confirmation = (await call(BASE, admin, 'POST', '/confirmations', {})).json.confirmation;
    note(`${method} ${route.replace(person.id, '<person>')}`, await call(BASE, admin, method, route, method === 'POST' ? {} : undefined, { 'x-oshal-confirm': confirmation }));
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const admin = adminToken();
  receipt.packageVersion = ((await call(BASE, admin, 'GET', '/packages')).json.packages || []).find((p) => p.name === 'phone-control')?.version;
  let person = null;
  let device = null;
  const browser = await chromium.launch();
  try {
    person = await makePerson(admin);
    device = await savePhone(person);
    receipt.servedImport = await servedImport(person);
    for (const androidNode of [false, true]) {
      const seen = await load(browser, person, androidNode);
      receipt.loads.push(seen);
      receipt.problems.push(...judge(seen));
    }
  } catch (error) {
    receipt.problems.push(`run stopped: ${error.message}`);
  } finally {
    await browser.close();
    if (person) await cleanUp(admin, person, device).catch((error) => receipt.problems.push(`clean-up: ${error.message}`));
    receipt.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(OUT, `receipt-${EXPECT}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(JSON.stringify({ ...receipt, loads: receipt.loads.map(({ screenshot, ...rest }) => ({ ...rest, screenshot })) }, null, 2));
    process.exitCode = receipt.problems.length ? 1 : 0;
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
