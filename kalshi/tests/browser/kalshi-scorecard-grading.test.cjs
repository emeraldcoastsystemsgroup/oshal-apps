/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | The Scorecard grades what is waiting, on a phone, in Chromium: opening the tab
 *     |                                         | walks POST /grade until the list is done and the table shows the new counts;
 *     |                                         | what Kalshi has no result for is said in words with Grade now left to press;
 *     |                                         | an unreachable Kalshi is said, not hidden; with nothing waiting no call is made.
 * -----------------------------------------------------------------------------
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ORIGIN, playwright, overflow } = require('./phone-fixture.cjs');

const PAGE = path.resolve(__dirname, '../../tools/kalshi.html');
const PHONE = { width: 412, height: 915 };

/** One strategy's Scorecard row. */
const strategy = (graded, pending) => ({ strategy: 'calibration', status: 'unproven', graded, pending,
  brier: graded ? 0.2011 : null, marketBrier: graded ? 0.2143 : null, hitRate: graded ? 0.75 : null, pnlPerContract: graded ? 0.031 : null });

/**
 * @description Open the Kalshi page on a phone against a stand-in API whose ledger the test scripts.
 * @param {import('playwright').Browser} browser The browser.
 * @param {{summary: object, runs: object[]}} script The ledger's standing and the answer to each POST /grade in turn.
 * @returns {Promise<{page: import('playwright').Page, context: import('playwright').BrowserContext, posts: object[]}>}
 * The page, its context and the body of every POST /grade the page sent.
 */
async function openKalshi(browser, script) {
  const context = await browser.newContext({ viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const posts = [];
  let summary = script.summary;
  await context.route('**/*', (route) => {
    const req = route.request(); const url = new URL(req.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname === '/api/kalshi/') return route.fulfill({ status: 200, path: PAGE, contentType: 'text/html; charset=utf-8' });
    if (url.pathname === '/api/kalshi/grade' && req.method() === 'GET') return json(summary);
    if (url.pathname === '/api/kalshi/grade' && req.method() === 'POST') {
      posts.push(JSON.parse(req.postData() || '{}'));
      const answer = script.runs[Math.min(posts.length, script.runs.length) - 1];
      if (answer.summary) summary = answer.summary;
      return json({ run: answer.run, summary });
    }
    if (url.pathname === '/api/kalshi/scan' && req.method() === 'GET') {
      return json({ hands: [], evaluable: 1500, scorecard: [strategy(summary.graded, summary.due + summary.open)], gateReason: '',
        scan: { ageSeconds: 600, lastMs: 35600 }, exchangeActive: true, calibrationGeneratedAt: '2026-07-13T00:00:00Z' });
    }
    if (req.method() !== 'GET') return json({ error: 'not part of this fixture' }, 405);
    if (/\.css$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (/\.m?js$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    return json({ error: 'synthetic endpoint unavailable' }, 404);
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/api/kalshi/`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('#score-rows tr').length === 1);
  return { page, context, posts };
}

const words = (page) => page.locator('#grade-state').textContent();
const run = (fields) => ({ due: 0, markets: 0, checked: 0, graded: 0, waiting: 0, failedLookups: 0, lastTicker: null, done: true, ...fields });

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

test('opening the Scorecard grades what is waiting, call after call, and the table shows the new counts', async () => {
  const { page, context, posts } = await openKalshi(browser, {
    summary: { due: 5, open: 2, graded: 0, lastGradedAt: null },
    runs: [
      { run: run({ due: 5, markets: 80, checked: 40, graded: 3, lastTicker: 'M-039', done: false }), summary: { due: 2, open: 2, graded: 3, lastGradedAt: '2026-11-10T23:00:00Z' } },
      { run: run({ due: 2, markets: 40, checked: 40, graded: 1, waiting: 1, lastTicker: 'M-079', done: true }), summary: { due: 1, open: 2, graded: 4, lastGradedAt: '2026-11-10T23:00:05Z' } },
      { run: run({ due: 1, markets: 1, checked: 1, waiting: 1, lastTicker: 'M-079', done: true }) },
    ],
  });
  try {
    assert.equal(await page.locator('#score-rows tr td').nth(2).textContent(), '0', 'before grading the table says graded 0');
    await page.locator('.tab[data-tab="scorecard"]').click();
    await page.waitForFunction(() => /just now/.test(document.getElementById('grade-state').textContent));
    assert.deepEqual(posts, [{ after: '' }, { after: 'M-039' }], 'the walk carried on after the last market the first call asked about');
    assert.equal(await words(page),
      'Graded 4 predictions just now. 1 is past its close and Kalshi has not posted its result yet; they are looked up again on the next run. 2 are on markets still open.');
    await page.waitForFunction(() => document.querySelector('#score-rows tr td:nth-child(3)').textContent === '4');
    assert.equal(await page.locator('#score-rows tr td').nth(3).textContent(), '3', 'pending fell to what is left');
    const button = page.locator('#grade-now');
    assert.ok(await button.isVisible() && await button.isEnabled(), 'Grade now is there to press while something waits');
    assert.equal(await button.textContent(), 'Grade now');
    const fit = await overflow(page);
    assert.ok(fit.scrollWidth <= fit.clientWidth, `the Scorecard is ${fit.scrollWidth}px wide in a ${fit.clientWidth}px screen`);
    assert.deepEqual(fit.offenders, []);

    await button.click();
    await page.waitForFunction(() => /^1 is past its close/.test(document.getElementById('grade-state').textContent));
    assert.deepEqual(posts[2], { after: '' }, 'Grade now starts a new walk from the top');
    // Coming back to the tab does not grade again on its own.
    await page.locator('.tab[data-tab="scan"]').click();
    await page.locator('.tab[data-tab="scorecard"]').click();
    await page.waitForTimeout(300);
    assert.equal(posts.length, 3);
  } finally { await context.close(); }
});

test('an unreachable Kalshi is said in words and Grade now stays', async () => {
  const { page, context, posts } = await openKalshi(browser, {
    summary: { due: 5, open: 0, graded: 0, lastGradedAt: null },
    runs: [{ run: run({ due: 5, markets: 5, done: false, error: 'Kalshi GET: HTTP 503' }) }],
  });
  try {
    await page.locator('.tab[data-tab="scorecard"]').click();
    await page.waitForFunction(() => /Nothing more was graded/.test(document.getElementById('grade-state').textContent));
    assert.equal(await words(page), 'Nothing more was graded: Kalshi could not be reached (Kalshi GET: HTTP 503). Grade now tries again.');
    assert.equal(posts.length, 1, 'one refusal ends the walk');
    assert.ok(await page.locator('#grade-now').isVisible());
    assert.ok(await page.locator('#grade-bar').evaluate((el) => el.classList.contains('bad')));
  } finally { await context.close(); }
});

test('a walk that stops before the end says how far it got, never that Kalshi has no result for what it did not ask', async () => {
  // 1.8.1: on a ledger of thousands the first walk could end at its call limit with most markets unasked, and the line
  // then read "... Kalshi has not posted their results yet".
  const { page, context, posts } = await openKalshi(browser, {
    summary: { due: 900, open: 0, graded: 0, lastGradedAt: null },
    runs: [
      { run: run({ due: 900, markets: 800, checked: 40, graded: 55, lastTicker: 'M-039', done: false }), summary: { due: 845, open: 0, graded: 55, lastGradedAt: '2026-11-11T00:00:00Z' } },
      { run: run({ due: 845, markets: 760, checked: 0, graded: 0, lastTicker: 'M-039', done: false }) },
    ],
  });
  try {
    await page.locator('.tab[data-tab="scorecard"]').click();
    await page.waitForFunction(() => /Not finished/.test(document.getElementById('grade-state').textContent));
    assert.equal(posts.length, 2);
    assert.equal(await words(page),
      'Graded 55 predictions just now. Not finished: asked Kalshi about 40 of 800 markets. 845 predictions are still waiting to be graded. Grade now carries on.');
    assert.ok(await page.locator('#grade-now').isVisible());
  } finally { await context.close(); }
});

test('with nothing waiting the tab says so, makes no call and shows no button', async () => {
  const { page, context, posts } = await openKalshi(browser, { summary: { due: 0, open: 2, graded: 9, lastGradedAt: '2026-11-10T22:00:00Z' }, runs: [{ run: run({}) }] });
  try {
    await page.locator('.tab[data-tab="scorecard"]').click();
    await page.waitForFunction(() => document.getElementById('grade-state').textContent.length > 0);
    assert.equal(await words(page), 'Every prediction past its close is graded. 2 are on markets still open.');
    assert.equal(await page.locator('#grade-now').isHidden(), true);
    assert.deepEqual(posts, []);
  } finally { await context.close(); }
});
