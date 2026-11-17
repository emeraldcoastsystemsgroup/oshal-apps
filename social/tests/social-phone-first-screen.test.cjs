/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.7.4 (lane mobilesweep1, the phone first-screen sweep of 2026-11-16: the feed started 345 px down a 915 px phone, 38%, under the page's title, the account pills wrapping onto two rows, the "Worth commenting on" row and the focus-terms row). The real Workspace in a stand-in for Today (tests/browser/today-phone-fixture.cjs) with three synthetic feed cards and three accounts, every write refused: at 412x915, 390x844 and 360x780 with touch the first card starts within the top quarter of the screen, the title is not drawn, the account pills are one row, the refresh sits in the focus-terms row, nothing scrolls the page sideways and nothing to tap sits under the floating Jarvis button at the end; at 1440x900 the desktop keeps its title and its "Worth commenting on" row. Red on 1.7.3.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { SIZES, playwright, openInToday, screenTop, rowLines, sideways, underOrbAtEnd } = require('./browser/today-phone-fixture.cjs');

const PAGE = path.join(__dirname, '..', 'tools', 'social-workspace.html');
const card = (n) => ({ title: `Fixture article ${n} about agents in production`, whyItMatters: 'Teams ship agent loops now.', source: 'Example News', date: '2026-11-05', url: `https://news.example.test/${n}` });
const READS = {
  '/api/social/profiles': { profiles: { linkedin: { name: 'Fixture Person' } } },
  '/api/social/content/focus': { focus: 'agents, RAG' },
  '/api/social/content/topics': { cards: [card(1), card(2), card(3)] },
  '/api/social/content/settings': { emailSocialScan: false },
  '/api/social/content/signals': { enabled: false, signals: [] },
  '/api/social/content/drafts': { drafts: [] },
};

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

/** Open the Workspace inside the stand-in Today and wait for the three feed cards and the accounts. */
function openFeed(size) {
  return openInToday(browser, size, { url: '/api/social/workspace', files: { '/api/social/workspace': PAGE }, reads: READS,
    ready: (frame) => frame.waitForFunction(() => document.querySelectorAll('#feed .art').length === 3 && document.querySelectorAll('#accounts .acct').length >= 3, null, { timeout: 15000 }) });
}

const drawn = (frame, selector) => frame.evaluate((sel) => { const el = document.querySelector(sel); return Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'); }, selector);

for (const size of SIZES) {
  test(`${size.width}x${size.height}: the feed starts right under one row of accounts and one row of focus terms`, { timeout: 60000 }, async (t) => {
    const phone = size.width <= 640;
    const { page, frame, context, writes, errors } = await openFeed(size);
    try {
      const first = await screenTop(page, frame, '#feed .art');
      const accounts = await rowLines(frame, '#accounts');
      t.diagnostic(`first card ${first}px (${Math.round((first / size.height) * 100)}%), account rows ${accounts.join('/')}`);
      const fit = await sideways(frame);
      assert.ok(fit.scrollWidth <= fit.clientWidth, `nothing scrolls the page sideways (${fit.scrollWidth} > ${fit.clientWidth})`);
      if (phone) {
        assert.ok(first <= size.height * 0.25, `the first feed card starts within the top quarter: ${first}px of ${size.height}`);
        assert.deepEqual(accounts, [1], 'the account pills are one row');
        assert.equal(await drawn(frame, '.top h1'), false, 'Today\'s bar names the page; its title is not drawn again');
        const focus = await frame.locator('#focus').boundingBox(), refresh = await frame.locator('#refreshFeed').boundingBox();
        assert.ok(Math.abs((focus.y + focus.height / 2) - (refresh.y + refresh.height / 2)) < 8, 'the feed\'s refresh sits in the focus-terms row');
        assert.ok(refresh.width >= 44 && refresh.height >= 44, 'and is a whole 44 px target');
        assert.deepEqual(await underOrbAtEnd(page, frame), [], 'nothing to tap under the floating Jarvis button at the end');
      } else {
        assert.equal(await drawn(frame, '.top h1'), true, 'the desktop keeps its title');
        assert.equal(await frame.locator('#feedView .lbl').innerText().then((s) => /Worth commenting on/i.test(s)), true, 'and its "Worth commenting on" row');
      }
      assert.deepEqual(writes, [], 'opening the Workspace writes nothing');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
