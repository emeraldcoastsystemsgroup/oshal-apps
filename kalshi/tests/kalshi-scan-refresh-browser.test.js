/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.10.2, @lane-qa1 on the test slot (2026-11-16 22:47Z): after Scan now the Markets tab still said "Nothing has been scanned yet … press Scan now" while the line above said "Scanned just now"; only a reload showed the 1,500 markets. scanNow() refreshed the Scan table, the age lines, the Scorecard and Alerts but never the market list, and the 30-second read of the scan never looked at it either. The real tools/kalshi.html in Chromium at 412 x 915 with the synthetic markets of phone-design-fixture.cjs and Playwright's clock: Scan now lands a scan and the list fills; a scan the background job lands fills the list at the next 30-second read; an unchanged scan does not read the list again. Reads plus the one Scan now the fixture answers; every other write is refused and counted.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { playwright, openPage } = require('./browser/phone-fixture.cjs');
const { PAGE, READS } = require('./browser/phone-design-fixture.cjs');

const PHONE = { width: 412, height: 915 };
const NOW = Date.now();
const EMPTY_MARKETS = { generatedAt: null, awaitingFirstScan: true, total: 0, shown: 0, categories: [], counts: { playable: 0, fold: 0, notEvaluable: 0 }, markets: [] };

/**
 * @description A Kalshi whose scan is missing until something lands one: GET /scan and GET /markets answer from `state`,
 * and POST /scan/run lands a scan (the route finishes its walk inside the request).
 * @param {string|null} generatedAt When the saved scan was taken, or null for none yet.
 * @returns {{state: {gen: string|null}, reads: object, writes: object}} The state the test moves and the fixture's answers.
 */
function kalshi(generatedAt) {
  const state = { gen: generatedAt };
  const scanned = READS['/api/kalshi/scan'];
  const reads = { ...READS,
    '/api/kalshi/scan': () => (state.gen ? { ...scanned, generatedAt: state.gen }
      : { ...scanned, generatedAt: null, awaitingFirstScan: true, hands: [], evaluable: 0, scorecard: [], scan: { ...scanned.scan, ageSeconds: null } }),
    '/api/kalshi/markets': (url) => (state.gen ? { ...READS['/api/kalshi/markets'](url), generatedAt: state.gen } : EMPTY_MARKETS),
  };
  const writes = { 'POST /api/kalshi/scan/run': () => { state.gen = new Date(NOW + 1000).toISOString(); return { __status: 202, body: { accepted: true } }; } };
  return { state, reads, writes };
}

/** @description Read until the answer is good or the time is up (real time: the page's own clock is fake). */
async function until(read, good, ms = 6000) {
  const end = Date.now() + ms;
  let value = await read();
  while (!good(value) && Date.now() < end) { await new Promise((r) => setTimeout(r, 100)); value = await read(); }
  return value;
}

const cards = (page) => page.evaluate(() => document.querySelectorAll('#mk-list .kx-card').length);
const emptyShown = (page) => page.evaluate(() => { const el = document.getElementById('mk-empty'); return el.style.display !== 'none' && /Nothing has been scanned yet/.test(el.textContent); });
const marketReads = (requests) => requests.filter((r) => r.startsWith('/api/kalshi/markets?')).length;

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

/** @description Open the page alone with the given scan, clock at NOW, and wait for its first answers. */
async function open(fixture) {
  const opened = await openPage(browser, PHONE, { url: '/api/kalshi/', files: { '/api/kalshi/': PAGE }, reads: fixture.reads, writes: fixture.writes, clock: NOW });
  await until(() => opened.page.evaluate(() => /Paper trading/.test(document.getElementById('kx-status').textContent)), Boolean);
  return opened;
}

test('Scan now fills the Markets list: no "Nothing has been scanned yet" under "Scanned just now"', async () => {
  const fixture = kalshi(null);
  const { page, context, writes } = await open(fixture);
  try {
    assert.equal(await until(() => emptyShown(page), Boolean), true, 'before: nothing scanned');
    await page.locator('.tab[data-tab="scan"]').tap();
    await page.locator('#scan-now').tap();
    await until(() => writes.length, (n) => n > 0);
    await new Promise((r) => setTimeout(r, 300)); // the answer arrives and the page sets its 6-second check
    await page.clock.runFor(6500);
    await page.locator('.tab[data-tab="markets"]').tap();
    const shown = await until(() => cards(page), (n) => n > 0);
    assert.ok(shown > 0, `Markets lists the scan's markets after Scan now (${shown} cards; empty state ${await emptyShown(page)})`);
    assert.equal(await emptyShown(page), false, 'the "nothing scanned" note is gone');
    assert.match(await page.locator('#mk-counts').innerText(), /^64 open markets · 39 with an edge$/);
    assert.deepEqual(writes, ['POST /api/kalshi/scan/run'], 'Scan now is the one write');
  } finally { await context.close(); }
});

test('a scan the background job lands fills the Markets list at the next 30-second read', async () => {
  const fixture = kalshi(null);
  const { page, context, writes } = await open(fixture);
  try {
    assert.equal(await until(() => emptyShown(page), Boolean), true, 'before: nothing scanned');
    fixture.state.gen = new Date(NOW + 5000).toISOString();
    await page.clock.runFor(30500);
    const shown = await until(() => cards(page), (n) => n > 0);
    assert.ok(shown > 0, `the list fills by itself once the scan lands (${shown} cards)`);
    assert.match(await page.locator('#scan-age').innerText(), /^Scanned/);
    assert.deepEqual(writes, [], 'reads only');
  } finally { await context.close(); }
});

test('an unchanged scan does not read the market list again', async () => {
  const fixture = kalshi(new Date(NOW - 720000).toISOString());
  const { page, context, requests } = await open(fixture);
  try {
    await until(() => cards(page), (n) => n > 0);
    await until(() => marketReads(requests), (n) => n > 0);
    const before = marketReads(requests);
    await page.clock.runFor(61000);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(marketReads(requests), before, 'two 30-second reads of the same scan, no new market list read');
  } finally { await context.close(); }
});
