/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.10.2, the check on a running kernel for @lane-qa1's two findings (2026-11-16). The TEST SLOT only (http://127.0.0.1:38798; every other address is refused). It invites a test person (never Roger, never the operator persona) and gives it Kalshi as the slot's Kalshi users hold it; opens /cockpit/?app=kalshi at 412 x 915, where Markets says nothing has been scanned yet; lands one scan on that person's own ledger from outside the browser (Scan now's own route) and waits for the page's next 30-second read to fill the Markets list by itself; then reads every screen a person reads (Markets, a card's Why, Scan, Alerts, Settings, Help) for hand, playable, monster or fold. The browser aborts every request that is not GET or HEAD; the bearer goes only to the kernel's own origin; it prints labels, counts and the words found, then revokes and erases the person. Exit 0 = both held.
 *
 * Usage: node kalshi/tests/live/kalshi-refresh-words-live.cjs --base=http://127.0.0.1:38798 --env=$HOME/.local/state/oshal-native-green/oshald.env [--out=<dir>] [--page=<kalshi.html>]
 * --page shows that page file in place of the kernel's before a delivery (the routes, the manifest and their words stay the
 * kernel's, so only the refresh is a fair check then).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { TEST_SLOT, call, adminToken, invitePerson, erasePerson, playwright } = require('./kalshi-phone-live.cjs');

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)));
const OLD_WORDS = /\b(hands?|playable|monsters?|folds?|folded)\b/i;

/** @description Read in the page until the answer is good or the time is up. */
async function until(read, good, ms) {
  const end = Date.now() + ms;
  let value = await read();
  while (!good(value) && Date.now() < end) { await new Promise((r) => setTimeout(r, 500)); value = await read(); }
  return value;
}

/** @description The Kalshi frame inside Today, opened as the test person with reads only. */
async function openKalshi(browser, person, refused) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 });
  await context.route('**/*', (route) => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() !== 'GET' && req.method() !== 'HEAD') { refused.add(req.method() + ' ' + url.pathname); return route.abort(); }
    if (url.origin !== TEST_SLOT) return route.continue();
    if (args.page && url.pathname === '/api/kalshi/') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', path: path.resolve(args.page) });
    return route.continue({ headers: { ...req.headers(), authorization: 'Bearer ' + person.token } });
  });
  const page = await context.newPage();
  await page.goto(TEST_SLOT + '/cockpit/?app=kalshi', { waitUntil: 'domcontentloaded' });
  const frame = await (await page.waitForSelector('iframe[src^="/api/kalshi/"]', { timeout: 30000 })).contentFrame();
  await frame.waitForSelector('#mk-empty', { state: 'attached', timeout: 30000 });
  return { context, page, frame };
}

/** @description The words a person reads in the frame now, with the screen's name, when one says an old word. */
async function oldWords(frame, screen) {
  const text = await frame.evaluate(() => document.body.innerText);
  return text.split('\n').filter((line) => OLD_WORDS.test(line)).map((line) => `${screen}: "${line.trim().slice(0, 120)}"`);
}

/** @description Visit each screen a person reads and collect any old word, picturing each when asked. */
async function readScreens(page, frame, out) {
  const found = [], shot = async (name) => { if (out) await page.screenshot({ path: path.join(out, `1.10.2-blue-${name}.png`) }); };
  found.push(...await oldWords(frame, 'Markets')); await shot('markets');
  await frame.locator('#mk-list .kx-card').first().tap();
  await until(() => frame.evaluate(() => /Price vs chance|Book:/.test(document.getElementById('kx-why-body').textContent)), Boolean, 15000);
  found.push(...await oldWords(frame, 'Why')); await shot('why');
  await frame.locator('#kx-why [data-sheet-close]').first().tap();
  for (const [tab, viaMore] of [['scan', false], ['alerts', true], ['settings', true]]) {
    if (viaMore) { await frame.locator('#tab-more').tap(); await frame.locator(`#more-menu [data-more="${tab}"]`).tap(); } else await frame.locator(`.tab[data-tab="${tab}"]`).tap();
    await page.waitForTimeout(tab === 'settings' ? 2500 : 1000);
    found.push(...await oldWords(frame, tab)); await shot(tab);
  }
  await frame.locator('.tab[data-tab="markets"]').tap();
  const help = page.locator('.kalshi-host-actions [data-kalshi-host="help"]');
  if (await help.count()) await help.tap(); else await frame.locator('#kx-help-open').tap();
  await page.waitForTimeout(500);
  found.push(...await oldWords(frame, 'Help')); await shot('help');
  return found;
}

async function main() {
  if (args.base !== TEST_SLOT) throw new Error('the test slot only: pass --base=' + TEST_SLOT);
  if (!args.env) throw new Error('pass --env with the test slot\'s oshald.env (to invite and erase the test person)');
  if (args.out) fs.mkdirSync(path.resolve(args.out), { recursive: true });
  const admin = adminToken(path.resolve(args.env)), person = await invitePerson(admin), refused = new Set();
  let failed = 0;
  const browser = await playwright().chromium.launch({ headless: true });
  try {
    const { context, page, frame } = await openKalshi(browser, person, refused);
    try {
      const empty = await until(() => frame.evaluate(() => { const el = document.getElementById('mk-empty'); return Boolean(el && el.style.display !== 'none' && /Nothing has been scanned yet/.test(el.textContent)); }), Boolean, 30000);
      console.log(`before the scan, Markets says nothing has been scanned yet: ${empty}`);
      let run = await call(person.token, 'POST', '/api/kalshi/scan/run', {});
      if (run.status === 429) { // one manual scan per two minutes across the installation: wait it out once
        const wait = Math.min(125, Number(run.body && run.body.retryAfterSeconds) || 120) + 3;
        console.log(`Scan now is resting after another scan; trying again in ${wait} s`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        run = await call(person.token, 'POST', '/api/kalshi/scan/run', {});
      }
      console.log(`one Scan now on the test person's own ledger, outside the browser: ${run.status}`);
      const cards = await until(() => frame.evaluate(() => document.querySelectorAll('#mk-list .kx-card').length), (n) => n > 0, 45000);
      const held = empty && cards > 0;
      if (!held) failed += 1;
      console.log(`${held ? 'ok  ' : 'FAIL'} the Markets list fills by itself after the scan lands: ${cards} cards`);
      const found = cards > 0 ? await readScreens(page, frame, args.out && path.resolve(args.out)) : ['no cards to read'];
      if (found.length) failed += 1;
      console.log(`${found.length ? 'FAIL' : 'ok  '} no screen says hand, playable, monster or fold${found.length ? ':\n  ' + found.join('\n  ') : ''}`);
    } finally { await context.close(); }
  } finally { await browser.close(); await erasePerson(admin, person); }
  console.log(`requests refused in the browser (not GET or HEAD): ${refused.size ? [...refused].join(', ') : 'none'}`);
  console.log(failed ? `${failed} check(s) did not hold` : 'every check held');
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
