/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 6: the Recap Review screen's eyebrow read 'Connected creative workspace' (copied
 *   from a creative app) and its empty state said 'Open the app to begin.' though Recap Review is this application's only
 *   screen. The compiled home summary, run with a pool that answers no session, names where sessions come from; the page's
 *   eyebrow names the recap.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

/** The compiled route with a stub express Router that records its GET handler. */
function summaryHandler() {
  const original = Module._load;
  let handler = null;
  Module._load = function (request, ...rest) {
    if (request === 'express') return { Router: () => ({ get: (_p, h) => { handler = h; } }) };
    return original.call(this, request, ...rest);
  };
  try {
    const file = require.resolve('../routes/home-summary.js');
    delete require.cache[file];
    // Queries in order: the 7-day counts, the review count, recent sessions, parked tickets. No session, no ticket.
    const answers = [[{ sessions: '0', recaps: '0', missed: '0' }], [{ review: '0' }], [], []];
    let n = 0;
    require(file).createHomeSummaryRoutes({ pool: { query: async () => ({ rows: answers[n++] || [] }) } });
  } finally {
    Module._load = original;
  }
  return handler;
}

test('with no session in the window the summary says where sessions come from, not "Open the app"', async () => {
  const handler = summaryHandler();
  assert.equal(typeof handler, 'function');
  let body;
  await handler({ oidc: { user: { sub: 'owner-1' }, isAuthenticated: () => true } },
    { setHeader() {}, status() { return this; }, json(b) { body = b; } });
  const texts = body.items.map((i) => i.text);
  assert.ok(texts.some((t) => /^No trading session recorded in the last 7 days\. Sessions come from Intelligent Trades' schedule/.test(t)), texts.join(' | '));
  assert.ok(!texts.some((t) => /Open the app to begin/.test(t)));
});

test('the Recap Review eyebrow names the recap, not a creative workspace', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'review.html'), 'utf8');
  assert.match(html, /<div class="eyebrow">Trading recap review<\/div><h1>Daily Trade Recap<\/h1>/);
  assert.doesNotMatch(html, /Connected creative workspace/);
});
