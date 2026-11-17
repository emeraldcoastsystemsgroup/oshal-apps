/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | 1.10.2: the test-person and call helpers are exported for kalshi-refresh-words-live.cjs; run directly, this script does what it did.
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.10.0 phone design, the check on a running kernel (lane kalshiux1). The TEST SLOT only (http://127.0.0.1:38798; production and any other address are refused): as a test person, never Roger and never the operator persona, it opens /cockpit/?app=kalshi in Chromium at 412x915, 390x844, 360x780 and 1440x900 and measures what the phone design promises: the first market within the top 30% of the screen, this page's search and help icons in the shell's bar with Reload a small icon, one whole status line and one age line, one chip row, no sideways scroll, five equal bottom tabs edge to edge, and nothing under the floating Jarvis button at the end of the list. The browser aborts every request that is not GET or HEAD and lists them; the bearer is added only to the kernel's own origin. Prints labels, counts and measurements only. Exit 0 = every check held.
 *
 * Usage (from the store checkout):
 *   node kalshi/tests/live/kalshi-phone-live.cjs --base=http://127.0.0.1:38798 --env=$HOME/.local/state/oshal-native-green/oshald.env \
 *     [--person=<file with {principal, token}>] [--page=<kalshi.html to show in place of the kernel's>] [--out=<dir>] [--label=after]
 * With --env and no --person it invites a test person (tier editor), gives it Kalshi as the slot's Kalshi users hold it
 * (granular kalshi @app-admin), runs one Scan now on that person's own ledger so the list has markets, and at the end
 * revokes that assignment and erases the person. --page previews a page file before it is delivered.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const TEST_SLOT = 'http://127.0.0.1:38798';
const SIZES = [{ width: 412, height: 915 }, { width: 390, height: 844 }, { width: 360, height: 780 }, { width: 1440, height: 900 }];
const FIRST_MARKET = '#mk-list .kx-card, #mk-rows tr[data-ticker]';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)).map(([k, v]) => [k, v === undefined ? true : v]));

/** @description Playwright from the store toolchain beside this package. @returns {object} The module. */
function playwright() {
  const roots = [process.env.OSHAL_BROWSER_MODULE, path.resolve(__dirname, '../../../scripts/toolchain/node_modules/playwright')].filter(Boolean);
  for (const root of roots) if (fs.existsSync(root)) return require(root);
  throw new Error('playwright not found: npm ci --prefix scripts/toolchain');
}

/** @description One call to the test slot; answers status and parsed body, never headers. */
async function call(token, method, route, body) {
  const r = await fetch(TEST_SLOT + route, { method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null;
  try { json = JSON.parse(text); } catch { json = {}; }
  return { status: r.status, body: json };
}

/** @description The test slot's administrator token from its oshald.env, used only to invite and erase the test person. */
function adminToken(file) {
  const line = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('OSHAL_ADMIN_TOKEN='));
  if (!line) throw new Error('no OSHAL_ADMIN_TOKEN in the env file');
  return line.slice('OSHAL_ADMIN_TOKEN='.length).trim().replace(/^['"]|['"]$/g, '');
}

/** @description A new test person with Kalshi, as the slot's Kalshi users hold it. */
async function invitePerson(admin) {
  const name = 'kalshi-phone-live-' + randomUUID().slice(0, 8);
  const invite = await call(admin, 'POST', '/people/invitations', { invitee: name, tier: 'editor', lifetime_ms: 3600000 });
  if (invite.status !== 200) throw new Error('invitation answered ' + invite.status);
  const accepted = await call(null, 'POST', '/people/invitations/' + encodeURIComponent(invite.body.token) + '/accept', { subject: name, display_name: 'Kalshi Test' });
  if (accepted.status !== 200) throw new Error('acceptance answered ' + accepted.status);
  const person = { principal: accepted.body.principal, token: accepted.body.token, assignmentId: randomUUID(), created: true };
  const catalog = (await call(admin, 'GET', '/api/authorization/composites')).body;
  const plan = { target: person.principal, assignment_id: person.assignmentId, action: 'assign', expected_revision: catalog.revision, reason: 'kalshi phone live check',
    idempotency_key: randomUUID(), selection: { kind: 'granular', app: 'kalshi', role: '@app-admin' } };
  plan.expected_plan_revision = (await call(admin, 'POST', '/api/authorization/composites/preview', plan)).body.plan_revision;
  const applied = await call(admin, 'POST', '/api/authorization/composites/apply', plan);
  if (applied.status !== 200) throw new Error('the Kalshi role answered ' + applied.status);
  console.log('test person invited; Kalshi assigned');
  return person;
}

/** @description Revoke the run's own assignment and erase the person it invited. */
async function erasePerson(admin, person) {
  const catalog = (await call(admin, 'GET', '/api/authorization/composites')).body;
  const revoked = await call(admin, 'POST', '/api/authorization/composites/apply', { target: person.principal, assignment_id: person.assignmentId, action: 'revoke', expected_revision: catalog.revision, reason: 'kalshi phone live check done', idempotency_key: randomUUID() });
  const steps = [['DELETE', '/people/' + person.principal], ['POST', '/people/' + person.principal + '/deactivate']];
  const answers = [];
  for (const [method, route] of steps) {
    const confirmation = (await call(admin, 'POST', '/confirmations', {})).body.confirmation;
    const r = await fetch(TEST_SLOT + route, { method, headers: { authorization: 'Bearer ' + admin, 'x-oshal-confirm': confirmation, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) }, body: method === 'POST' ? '{}' : undefined });
    answers.push(method + ' ' + r.status);
  }
  console.log('test person: role revoke ' + revoked.status + ', ' + answers.join(', '));
}

/** @description Make sure the person's market list has markets: one Scan now on their own ledger when nothing is scanned. */
async function ensureMarkets(person) {
  const before = await call(person.token, 'GET', '/api/kalshi/markets?verdict=all&sort=verdict&limit=1');
  if (before.status !== 200) throw new Error('the test person cannot read Kalshi (' + before.status + ')');
  if (!before.body.awaitingFirstScan) { console.log('markets on the list: ' + before.body.total); return; }
  if (!person.created && !args.scan) throw new Error('nothing scanned for this person; pass --scan to run one Scan now on their ledger');
  const run = await call(person.token, 'POST', '/api/kalshi/scan/run', {});
  const after = await call(person.token, 'GET', '/api/kalshi/markets?verdict=all&sort=verdict&limit=1');
  console.log('one Scan now on the test person\'s ledger: ' + run.status + '; markets on the list: ' + after.body.total);
}

/** @description In the Today page: where the frame is, what the bar shows, where the floating Jarvis button rests. */
function hostFacts() {
  const box = (el) => (el && el.getClientRects().length ? (({ top, bottom, left, right }) => ({ top, bottom, left, right }))(el.getBoundingClientRect()) : null);
  const frame = document.querySelector('iframe[src^="/api/kalshi/"]'), fb = frame.getBoundingClientRect();
  const reload = document.querySelector('.tool-view-container:has(> iframe[src^="/api/kalshi/"]) > .tool-view-header [data-tool-view-reload]'), cs = reload && getComputedStyle(reload);
  return { frameTop: fb.top, frameLeft: fb.left, search: Boolean(box(document.querySelector('.kalshi-host-actions [data-kalshi-host="search"]'))),
    help: Boolean(box(document.querySelector('.kalshi-host-actions [data-kalshi-host="help"]'))), shellHelp: Boolean(box(document.getElementById('surfaceHelpBtn'))),
    profile: Boolean(box(document.getElementById('profileBtn'))), reloadBox: cs ? cs.borderTopColor !== 'rgba(0, 0, 0, 0)' : null,
    orb: box(document.getElementById('jarvisOrbFab')), scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
}

/** @description In the Kalshi page: the first market, the two lines, the chips, the bottom tabs and the page's width. */
function pageFacts(first) {
  const line = (id) => { const el = document.getElementById(id); return el ? { h: Math.round(el.getBoundingClientRect().height), cut: el.scrollWidth > el.clientWidth + 1, text: el.innerText } : null; };
  const market = document.querySelector(first), chips = [...document.querySelectorAll('#kx-chips .kx-chip')];
  const tabs = [...document.querySelectorAll('.tabnav > .tab, .tabnav > .more-tab')].filter((t) => t.getClientRects().length).map((t) => t.getBoundingClientRect());
  return { firstTop: market ? market.getBoundingClientRect().top : null, cards: document.querySelectorAll('#mk-list .kx-card').length, status: line('kx-status') || line('acct-label'),
    fresh: line('kx-fresh'), chipCount: chips.length, chipRows: new Set(chips.map((c) => c.offsetTop)).size,
    tabs: tabs.map((b) => ({ top: b.top, left: b.left, right: b.right, width: b.width })), scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
}

/** @description At the end of the list, the market cards and buttons the floating Jarvis button covers (frame coordinates). */
function underOrb(orb) {
  return [...document.querySelectorAll('#mk-list .kx-card, #mk-rows tr[data-ticker], [data-panel="markets"] button')].filter((el) => el.getClientRects().length)
    .map((el) => el.getBoundingClientRect()).filter((b) => b.bottom > orb.top && b.top < orb.bottom && b.right > orb.left && b.left < orb.right).length;
}

/** @description The checks for one size, in words, each true when it held. */
function verdicts(size, host, page, under) {
  const phone = size.width <= 640, top = page.firstTop === null ? null : host.frameTop + page.firstTop, widths = page.tabs.map((t) => t.width);
  const list = [
    ['first market within the top 30%', top !== null && top <= size.height * 0.3, top === null ? 'no market' : `${Math.round(top)} px = ${Math.round((top / size.height) * 100)}%`],
    ['the list is cards', page.cards > 0, `${page.cards} cards`],
    ['this page\'s help in the bar, the shell\'s general help aside, profile kept', host.help && !host.shellHelp && host.profile, `help ${host.help}, shell help ${host.shellHelp}, profile ${host.profile}`],
    ['one whole status line, no "trading active"', Boolean(page.status && page.status.h <= 22 && !page.status.cut && !/trading active/i.test(page.status.text)), page.status ? `"${page.status.text}" ${page.status.h} px` : 'none'],
    ['one whole line for the scan and the model', Boolean(page.fresh && page.fresh.h <= 22 && !page.fresh.cut), page.fresh ? `"${page.fresh.text}" ${page.fresh.h} px` : 'none'],
    ['the categories are one chip row', page.chipCount > 1 && page.chipRows === 1, `${page.chipCount} chips on ${page.chipRows} row(s)`],
    ['nothing scrolls sideways', page.scrollW <= page.clientW && host.scrollW <= host.clientW, `page ${page.scrollW}/${page.clientW}, shell ${host.scrollW}/${host.clientW}`],
    ['nothing under the floating Jarvis button at the end of the list', host.orb !== null && under === 0, host.orb ? `${under} under it` : 'no button'],
  ];
  if (!phone) return list;
  return list.concat([
    ['a search icon in the bar, Reload a small icon with no box', host.search && host.reloadBox === false, `search ${host.search}, reload box ${host.reloadBox}`],
    ['five equal bottom tabs edge to edge', widths.length === 5 && Math.max(...widths) - Math.min(...widths) <= 1 && page.tabs[0].left <= 1 && page.tabs[4].right >= size.width - 1, widths.map(Math.round).join('/')],
    ['the Jarvis button rests above the bottom bar', Boolean(host.orb && page.tabs.length && host.orb.bottom <= host.frameTop + page.tabs[0].top), host.orb ? `${Math.round(host.orb.bottom)} <= ${Math.round(host.frameTop + (page.tabs[0] || {}).top)}` : 'no button'],
  ]);
}

/** @description One size: open Kalshi in Today as the test person, reads only, measure, picture, and say what held. */
async function checkSize(browser, person, size) {
  const phone = size.width <= 640, refused = new Set();
  const context = await browser.newContext({ viewport: size, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2.625 : 1 });
  await context.route('**/*', (route) => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() !== 'GET' && req.method() !== 'HEAD') { refused.add(req.method() + ' ' + url.pathname); return route.abort(); }
    if (url.origin !== TEST_SLOT) return route.continue();
    if (args.page && url.pathname === '/api/kalshi/') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', path: path.resolve(args.page) });
    return route.continue({ headers: { ...req.headers(), authorization: 'Bearer ' + person.token } });
  });
  try {
    const page = await context.newPage();
    await page.goto(TEST_SLOT + '/cockpit/?app=kalshi', { waitUntil: 'domcontentloaded' });
    const frame = await (await page.waitForSelector('iframe[src^="/api/kalshi/"]', { timeout: 30000 })).contentFrame();
    await frame.waitForFunction((sel) => document.querySelectorAll(sel).length > 0, FIRST_MARKET, { timeout: 30000 });
    // The account line answers after the portfolio read and the floating button after the shell's own start: wait for both
    // (each at most ten seconds; one that never comes is measured as missing).
    await frame.waitForFunction(() => /\S/.test(((document.getElementById('kx-status') || document.getElementById('acct-label') || {}).textContent || '').replace('Checking your Kalshi account…', '')), null, { timeout: 10000 }).catch(() => {});
    await page.waitForFunction(() => { const b = document.getElementById('jarvisOrbFab'); return Boolean(b && b.getClientRects().length); }, null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const host = await page.evaluate(hostFacts), facts = await frame.evaluate(pageFacts, FIRST_MARKET), out = args.out && path.resolve(args.out), label = args.label || 'after';
    if (out) await page.screenshot({ path: path.join(out, `${label}-blue-${size.width}.png`) });
    await frame.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(400);
    const orb = host.orb && { top: host.orb.top - host.frameTop, bottom: host.orb.bottom - host.frameTop, left: host.orb.left - host.frameLeft, right: host.orb.right - host.frameLeft };
    const under = orb ? await frame.evaluate(underOrb, orb) : 0;
    if (out) await page.screenshot({ path: path.join(out, `${label}-blue-${size.width}-end.png`) });
    return { checks: verdicts(size, host, facts, under), refused: [...refused] };
  } finally { await context.close(); }
}

async function main() {
  if (args.base !== TEST_SLOT) throw new Error('the test slot only: pass --base=' + TEST_SLOT + ' (production and every other address are refused)');
  if (args.out) fs.mkdirSync(path.resolve(args.out), { recursive: true });
  const admin = args.env ? adminToken(path.resolve(args.env)) : null;
  const person = args.person ? JSON.parse(fs.readFileSync(path.resolve(args.person), 'utf8')) : admin ? await invitePerson(admin) : null;
  if (!person) throw new Error('pass --env (to invite a test person) or --person');
  let failed = 0;
  try {
    await ensureMarkets(person);
    const browser = await playwright().chromium.launch({ headless: true });
    try {
      for (const size of SIZES) {
        const { checks, refused } = await checkSize(browser, person, size);
        for (const [what, held, measured] of checks) { if (!held) failed += 1; console.log(`${size.width}x${size.height} ${held ? 'ok  ' : 'FAIL'} ${what}: ${measured}`); }
        console.log(`${size.width}x${size.height} requests refused (not GET or HEAD): ${refused.length ? refused.join(', ') : 'none'}`);
      }
    } finally { await browser.close(); }
  } finally { if (person.created && admin) await erasePerson(admin, person); }
  console.log(failed ? `${failed} check(s) did not hold` : 'every check held');
  process.exitCode = failed ? 1 : 0;
}

module.exports = { TEST_SLOT, call, adminToken, invitePerson, erasePerson, playwright };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
