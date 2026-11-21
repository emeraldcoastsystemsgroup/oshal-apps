#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 2.4.0 (backlog items 7 and 8). The check of garnishment orders and the federal deposit schedule on an installed Payroll, on a test slot, as a test person with the Payroll member role. `person` makes the test person and a made-up company with one made-up employee (no SSN, no EIN). `check` signs in on the slot's own sign-in page at 1440x900 and 412x915 and, at each size, opens Employees > orders, adds a support order and a creditor writ through the form, tries an order without its percentage and reads the refusal, creates a pay run, reads the register line, approves it, and reads Pay & file > Federal tax deposits; the withheld amounts are checked against the federal ceilings worked from the line's own disposable earnings, and the payday's deposit row against its due date. Screenshots and a JSON receipt go to the out folder. Every request that is not a read, the sign-in or one of the permitted payroll writes is stopped and listed. `remove` stops the orders, takes the role back and deactivates the person.
 *
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Three proof defects the first run on blue found (kernel 4f780d36, 2026-11-20 19:36Z), none in Payroll: the refusal was read from the message line before the refused save's answer arrived (the save was refused: three posts, two orders listed); the run was looked up by the pay date asked for, but 2026-06-19 is Juneteenth, a Federal Reserve closure, and Payroll correctly moved it to 2026-06-18 (now the run is found by its period, and the moved date, its reason and its deposit due date are checked, all worked out from Payroll's own calendar module); and on a phone Run payroll is in the bottom bar, not under More (navigation now follows the page's own data-phone-tab and data-more-tab buttons). A stopped write from the cockpit shell (its recents list) is listed apart and is not Payroll's. The pure parts are exported and held to the real page and calendar by tests/payroll-garnish-live-proof.test.mjs; the proof runs only when executed.
 *
 * Usage (a loopback kernel only; the administrator credential is read by name from the env file and never printed; the
 * person's credential stays in its 0600 file and is typed only into the slot's own sign-in page; all three refuse port 38788):
 *   node payroll/tests/payroll-garnish-live-proof.mjs person http://127.0.0.1:38798 <slot env file> <person file>
 *   node payroll/tests/payroll-garnish-live-proof.mjs check  http://127.0.0.1:38798 <person file> <out folder>
 *   node payroll/tests/payroll-garnish-live-proof.mjs remove http://127.0.0.1:38798 <slot env file> <person file>
 * Playwright comes from the store's scripts/toolchain (npm ci --prefix scripts/toolchain).
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const calendar = createRequire(import.meta.url)(path.join(HERE, '..', 'routes', 'payroll-calendar.js'));
const PAYROLL = '/cockpit/?app=payroll';
const FRAME = /\/api\/payroll\/(\?|$)/;
const ALLOWED = /^\/api\/payroll\/(employees\/[^/]+\/deductions|runs|runs\/[^/]+\/approve)$/;
// Each size runs its own pay period, so each approval is a new run. Nothing here is anyone's data. The first pay
// date asked for is Juneteenth, a Federal Reserve closure, on purpose: Payroll must move it to the banking day before.
export const SIZES = Object.freeze([
  { width: 1440, height: 900, touch: false, period: ['2026-06-01', '2026-06-14'], payDate: '2026-06-19' },
  { width: 412, height: 915, touch: true, period: ['2026-06-15', '2026-06-28'], payDate: '2026-07-02' },
]);
/** The words Payroll refuses a support order without its percentage in (payroll-garnish orderFactsFromInput). */
export const REFUSAL = /most this support order may take/;

/**
 * @description What the size's run must show, worked out from Payroll's own calendar module: the pay date it is
 * stored on (a Federal Reserve closure moves it to the banking day before), why it moved, and the monthly deposit
 * due date for that pay date.
 * @param {{payDate:string}} size A size. @returns {{payDate:string, shifted:boolean, reason:string, due:string}}
 */
export function expectedRun(size) {
  const funding = calendar.resolvePayDate(size.payDate, 'earlier');
  return { payDate: funding.payDate, shifted: funding.shifted, reason: funding.reason,
    due: calendar.depositDueDate(funding.payDate, 'monthly').dueDate };
}

/** @description The size's run among the person's runs, by its period (the pay date may have moved). */
export function findRun(runs, size) {
  return (runs || []).find((r) => String(r.period_start).slice(0, 10) === size.period[0]
    && String(r.period_end).slice(0, 10) === size.period[1]) || null;
}

/**
 * @description The clicks that open a Payroll module, read from the page's own buttons: the tab on a wide screen; on
 * a phone the bottom-bar button when the page has one for it, else More and the sheet's button.
 * @param {string} tab A module id (runs, filing). @param {boolean} touch A phone. @param {string} html The page.
 * @returns {string[]} Selectors, clicked in order.
 */
export function navSteps(tab, touch, html) {
  if (!touch) return [`#tab-${tab}`];
  if (html.includes(`data-phone-tab="${tab}"`)) return [`.phone-nav-btn[data-phone-tab="${tab}"]`];
  return ['#phoneMoreBtn', `.more-sheet-item[data-more-tab="${tab}"]`];
}

/** @description The stopped writes Payroll's own frame made; the cockpit shell's (its recents list) are not Payroll's. */
export function payrollStopped(stopped) {
  return (stopped || []).filter((line) => /\(from \/api\/payroll\//.test(line));
}
// The orders the form is given: support at 60% (no other family, nothing over 12 weeks late) and a creditor writ.
const SUPPORT = { amount: '300', pct: '60', served: '2026-05-04', entered: '2026-04-20' };
const WRIT = { amount: '600', served: '2026-05-11', rank: '1' };
const MIN_WAGE_CENTS = 725; // 29 U.S.C. 206(a)(1)(C)

const say = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const message = (error) => String((error && error.message) || error).split('\n')[0].slice(0, 300);

/** @description Playwright from the store's toolchain. @returns {object} The playwright module. */
function playwright() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'toolchain');
  return createRequire(path.join(root, 'noop.js'))('playwright');
}

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
 * @param {string} route The path. @param {object} [options] body (JSON), accepted statuses, headers.
 * @returns {Promise<{status:number,body:any}>} The status and the parsed answer.
 */
async function http(origin, credential, method, route, { body, accepted = [200], headers = {} } = {}) {
  const url = new URL(route, origin);
  if (url.origin !== origin) throw new Error('refusing a request outside the kernel');
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(120000),
    headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
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
    reason: 'Payroll garnishment and deposit proof (test person)', idempotency_key: randomUUID(),
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

/** @description `person`: make the test person, its Payroll role, a made-up company and one made-up employee. */
async function makePerson(origin, envFile, file) {
  const admin = adminToken(envFile);
  if (fs.existsSync(file)) { say('test person kept', { subject: JSON.parse(fs.readFileSync(file, 'utf8')).subject }); return; }
  const subject = `payrollgarn1-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const invite = (await http(origin, admin, 'POST', '/people/invitations', { body: { invitee: subject, tier: 'editor', lifetime_ms: 3600000 } })).body;
  const accepted = (await http(origin, '', 'POST', `/people/invitations/${encodeURIComponent(invite.token)}/accept`, { body: { subject, display_name: 'Payroll Sample (test)' } })).body;
  const person = { base: origin, subject, principal: accepted.principal, token: accepted.token, grants: [] };
  privateWrite(file, person);
  const held = { id: `payrollgarn1-payroll-${randomUUID().slice(0, 8)}`, app: 'payroll', role: '@app-admin' };
  await grant(origin, admin, person.principal, held);
  person.grants.push(held);
  privateWrite(file, person);
  await http(origin, person.token, 'POST', '/packages/payroll/schema', { body: {}, accepted: [200, 404] });
  await http(origin, person.token, 'PUT', '/api/payroll/company', { body: { companyName: 'Sample Widgets (test)', payFrequency: 'biweekly', stateCode: 'FL', shiftPayDate: true } });
  const emp = (await http(origin, person.token, 'POST', '/api/payroll/employees', { body: {
    firstName: 'Avery', lastName: 'Sample', compType: 'hourly', hourlyRateCents: 3_000, defaultHours: 80,
    filingStatus: 'single', stateCode: 'FL', hireDate: '2026-01-05' } })).body;
  person.employeeId = emp.employee ? emp.employee.employee_id : emp.employee_id;
  privateWrite(file, person);
  say('test person', { subject, employee: Boolean(person.employeeId) });
}

/** @description Stop every request of this context that is not a read, the sign-in or a permitted payroll write. */
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

/** @description Sign in on the slot's own sign-in page as the person, landing on Payroll; answers its frame. */
async function signInAndOpen(page, origin, person) {
  await page.goto(`${origin}/login?next=${encodeURIComponent(PAYROLL)}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('#loginTokenBox > summary').click();
  await page.locator('#loginTokenValue').fill(person.token);
  await page.locator('#loginToken button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname.startsWith('/cockpit'), { timeout: 90000 });
  return until(async () => {
    const frame = page.frames().find((one) => FRAME.test(one.url()));
    return frame && (await frame.locator('#empList table').count()) && frame;
  }, 120000, 'Payroll with its roster');
}

/** @description Open a Payroll module by the page's own buttons (navSteps). */
async function openModule(frame, size, tab) {
  const html = await frame.content();
  for (const selector of navSteps(tab, size.touch, html)) await frame.locator(selector).click();
}

/** @description Whether anything in the frame is wider than the screen. */
function layout(frame, width) {
  return frame.evaluate((w) => ({ sideways: document.scrollingElement.scrollWidth > Math.min(window.innerWidth, w) + 1,
    outside: [...document.querySelectorAll('.view:not([style*="display:none"]) *')].filter((el) => el.offsetParent && !el.closest('table')
      && el.getBoundingClientRect().right > Math.min(window.innerWidth, w) + 0.5).length }), width);
}

/** @description Add the two orders through Employees > orders, and read the refusal for an order without its percentage. */
async function addOrders(frame, page, out, label, row) {
  await frame.locator('a.link', { hasText: 'orders' }).first().click();
  await frame.locator('#ordersPanel:not([hidden])').waitFor({ timeout: 30000 });
  await frame.locator('#o_code').selectOption('GARN_SUPPORT');
  await frame.locator('#o_served').fill(SUPPORT.served);
  await frame.locator('#o_amount').fill(SUPPORT.amount);
  await frame.locator('#o_save').click();
  // The refusal arrives with the save's answer: wait for it rather than read the message line at once.
  await frame.locator('#msg', { hasText: REFUSAL }).waitFor({ timeout: 30000 })
    .catch((error) => row.failures.push(`no refusal in words for a support order without its percentage: ${message(error)}`));
  row.refusal = await frame.locator('#msg').innerText();
  await frame.locator('#o_supportPct').selectOption(SUPPORT.pct);
  await frame.locator('#o_entered').fill(SUPPORT.entered);
  await frame.locator('#o_save').click();
  await frame.locator('#msg', { hasText: 'Order saved' }).waitFor({ timeout: 30000 });
  await frame.locator('#o_code').selectOption('GARN_CREDITOR');
  await frame.locator('#o_served').fill(WRIT.served);
  await frame.locator('#o_amount').fill(WRIT.amount);
  await frame.locator('#o_rank').fill(WRIT.rank);
  await frame.locator('#o_save').click();
  await frame.locator('#msg', { hasText: 'Order saved' }).waitFor({ timeout: 30000 });
  await frame.locator('#ordersList tbody tr').nth(1).waitFor({ timeout: 30000 });
  row.layoutOrders = await layout(frame, row.width);
  await page.screenshot({ path: path.join(out, `garnish-${label}-orders.png`) });
}

/** @description The federal ceilings worked from the stored line, as 29 CFR 870.11 applies them in priority. */
function expected(line) {
  const d = Number(line.disposable_cents);
  const supportAsk = Math.round(Number(SUPPORT.amount) * 100), writAsk = Math.round(Number(WRIT.amount) * 100);
  const support = Math.min(supportAsk, Math.floor((d * Number(SUPPORT.pct)) / 100));
  const ordinary = Math.floor(Math.max(0, Math.min(d * 0.25, d - (MIN_WAGE_CENTS * 30 * 52) / 26)));
  return { support, writ: Math.min(writAsk, Math.max(0, ordinary - support)) };
}

/** @description Create the size's run, approve it in the screen, and check what was withheld. */
async function runAndApprove(frame, page, origin, person, size, out, label, row) {
  await openModule(frame, size, 'runs');
  const want = expectedRun(size);
  await frame.locator('#r_start').fill(size.period[0]);
  await frame.locator('#r_end').fill(size.period[1]);
  await frame.locator('#r_pay').fill(size.payDate);
  await frame.getByRole('button', { name: 'New pay run' }).click();
  row.created = await frame.locator('#msg', { hasText: 'Draft run created' }).innerText({ timeout: 60000 });
  if (want.shifted && !row.created.includes(want.reason)) row.failures.push(`the screen did not say why the pay date moved: ${row.created.slice(0, 200)}`);
  const approve = frame.getByRole('button', { name: 'Approve & record' });
  await approve.waitFor({ timeout: 60000 });
  await page.screenshot({ path: path.join(out, `garnish-${label}-draft.png`) });
  await approve.click();
  await frame.locator('#msg', { hasText: 'Run approved' }).waitFor({ timeout: 60000 });
  const runs = (await http(origin, person.token, 'GET', '/api/payroll/runs')).body.runs;
  const run = findRun(runs, size);
  if (!run) throw new Error(`no run for ${size.period.join(' to ')} among the person's runs`);
  row.payDate = String(run.pay_date).slice(0, 10);
  if (row.payDate !== want.payDate) row.failures.push(`the run is stored on ${row.payDate}, the calendar gives ${want.payDate}`);
  const detail = (await http(origin, person.token, 'GET', `/api/payroll/runs/${run.run_id}`)).body;
  const line = detail.lines.find((l) => l.employee_id === person.employeeId);
  const ceilings = expected(line);
  const register = (await http(origin, person.token, 'GET', `/api/payroll/reports/deduction-register?from=${row.payDate}&to=${row.payDate}`)).body;
  row.line = { disposable: Number(line.disposable_cents), garnishment: Number(line.garnishment_cents), expected: ceilings, register };
  if (Number(line.garnishment_cents) !== ceilings.support + ceilings.writ) row.failures.push(`withheld ${line.garnishment_cents}, the ceilings give ${ceilings.support + ceilings.writ}`);
  if (run.status !== 'paid') row.failures.push('the run is not recorded as paid');
  await page.screenshot({ path: path.join(out, `garnish-${label}-paid.png`) });
}

/** @description Read Pay & file > Federal tax deposits and find the size's payday with its due date. */
async function deposits(frame, page, size, out, label, row) {
  await openModule(frame, size, 'filing');
  const want = expectedRun(size);
  await frame.getByRole('button', { name: 'Show deposits' }).click();
  await frame.locator('#depOut table').waitFor({ timeout: 60000 });
  const text = await frame.locator('#depOut').innerText();
  row.deposits = { hasPayday: text.includes(want.payDate), hasDue: text.includes(want.due) };
  if (!row.deposits.hasPayday || !row.deposits.hasDue) row.failures.push(`the deposit schedule does not show ${want.payDate} due ${want.due}`);
  row.layoutDeposits = await layout(frame, size.width);
  await frame.locator('#depOut').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, `garnish-${label}-deposits.png`) });
}

/** @description One size: sign in, add the orders, run and approve, read the deposits, stop the orders, sign out. */
async function checkSize(browser, origin, person, size, out, receipt) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.touch, hasTouch: size.touch, deviceScaleFactor: size.touch ? 2.625 : 1 });
  const label = `${size.width}x${size.height}`;
  const row = { size: label, width: size.width, failures: [], stopped: [], writes: [], errors: [] };
  receipt.sizes.push(row);
  try {
    await guard(context, origin, row);
    const page = await context.newPage();
    page.on('dialog', (dialog) => dialog.accept());
    page.on('pageerror', (error) => row.errors.push(message(error).slice(0, 160)));
    const frame = await signInAndOpen(page, origin, person);
    await addOrders(frame, page, out, label, row);
    await runAndApprove(frame, page, origin, person, size, out, label, row);
    await deposits(frame, page, size, out, label, row);
    for (const name of ['layoutOrders', 'layoutDeposits']) if (row[name] && (row[name].sideways || row[name].outside)) row.failures.push(`${name} ${JSON.stringify(row[name])}`);
    const own = payrollStopped(row.stopped);
    if (own.length) row.failures.push(`Payroll tried a write the check did not permit: ${own.join('; ')}`);
  } catch (error) { row.failures.push(message(error)); }
  finally {
    await stopOrders(origin, person).catch((error) => row.failures.push(`stopping the orders: ${message(error)}`));
    const cookies = await context.cookies(origin).catch((error) => { say('sessions unread', { message: message(error) }); return []; });
    for (const cookie of cookies.filter((one) => /session/i.test(one.name))) await http(origin, cookie.value, 'DELETE', '/sessions', { accepted: [200, 204, 401] }).catch((error) => say('sign-out failed', { message: message(error) }));
    await context.close();
  }
}

/** @description Stop every order the check added, so the next size starts with none. */
async function stopOrders(origin, person) {
  const list = (await http(origin, person.token, 'GET', `/api/payroll/employees/${person.employeeId}/deductions`)).body.elections;
  for (const e of list.filter((one) => /^GARN_/.test(one.code) && one.active !== false)) {
    await http(origin, person.token, 'DELETE', `/api/payroll/employees/${person.employeeId}/deductions/${e.election_id}`);
  }
}

/** @description `check`: exit 0 when both sizes add the orders, withhold within the ceilings, approve and show the deposit. */
async function check(origin, file, out) {
  const person = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  const served = await http(origin, person.token, 'GET', '/api/payroll/_smoke', { accepted: [200, 401, 403, 404] }).catch((error) => { say('version unread', { message: message(error) }); return { body: null }; });
  const receipt = { origin, at: new Date().toISOString(), payroll: served.body && served.body.version, subject: person.subject, sizes: [] };
  const browser = await playwright().chromium.launch({ headless: true });
  try { for (const size of SIZES) await checkSize(browser, origin, person, size, out, receipt); }
  finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'payroll-garnish-live.json'), JSON.stringify(receipt, null, 2));
  say('check', receipt);
  return receipt.sizes.some((row) => row.failures.length) ? 1 : 0;
}

/** @description `remove`: stop the orders, take the role back and deactivate the test person. */
async function remove(origin, envFile, file) {
  const admin = adminToken(envFile), person = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (person.employeeId) await stopOrders(origin, person).catch((error) => say('orders not stopped', { message: message(error) }));
  for (const held of person.grants || []) await grant(origin, admin, person.principal, held, 'revoke').catch((error) => say('revoke failed', { message: message(error) }));
  const confirmation = (await http(origin, admin, 'POST', '/confirmations', { body: {} })).body;
  await http(origin, admin, 'POST', `/people/${person.principal}/deactivate`, { body: {}, headers: { 'x-oshal-confirm': confirmation.confirmation } });
  await http(origin, person.token, 'GET', '/api/authorization/me', { accepted: [401, 403] });
  fs.rmSync(file, { force: true });
  say('test person removed', { subject: person.subject, grantsRevoked: (person.grants || []).length });
}

/** @description Run a mode from the command line. */
async function main() {
  const [mode, base, second, third] = process.argv.slice(2);
  try {
    if (!['person', 'check', 'remove'].includes(mode) || !base || !second || !third) throw new Error('usage: person <base> <env file> <person file> | check <base> <person file> <out folder> | remove <base> <env file> <person file>');
    const origin = testSlot(base);
    if (mode === 'person') await makePerson(origin, second, third);
    else if (mode === 'check') process.exitCode = await check(origin, second, third);
    else await remove(origin, second, third);
  } catch (error) {
    console.error(`payroll-garnish-live-proof: ${message(error)}`);
    process.exitCode = 1;
  }
}

// Only when executed: the test imports the pure parts above without running anything.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
