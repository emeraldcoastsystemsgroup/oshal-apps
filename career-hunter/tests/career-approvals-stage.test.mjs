/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Approvals). The real tools/career-approvals.html in Chromium: it carries the Job Board stage control with To approve selected; "Add top matches" replaces "Generate draft candidates" and sends the stepper's value clamped to the route's 1-50; adding nothing says "No scored matches yet" with one primary Find & score jobs that starts POST /run/build; a queued role's Approve sits in its row menu and Deny confirms in the page without a browser dialog.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 1. No control or line on the page names the vendor's project. With the independent work saved with a résumé listed in Additional experience (GET /experience-bank, the saved-portfolio entry), a tick box, Include my other experience, names that entry; Approve sends oshal false with the box clear and oshal true with it ticked, the two shapes the route always took. With no such entry (other entries only, the entry archived, or no answer) the box is absent and Approve sends oshal false. A role approved with it is badged With other experience, and a status the person recorded themselves says "You marked this as applied yourself".
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Page names, judge's report 2026-11-11 (tests/career-page-names.test.mjs holds them): the tick box's line names the page Other experience.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 6 (one route from a saved job to a sent application). To approve is no longer a stage or a page, so what entries 1 and 2 held of it is gone with it: the shipped page forwards, on a computer and on a phone, to the Job Board on Career's picks (?view=approve), reads no application record, asks no route to write documents, and offers neither Approve, Add top matches nor Mark applied manually. What a person does with a pick is proved where it now happens: tests/career-apply-one-route.test.mjs and tests/career-apply-by-hand.test.mjs.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openScreen, playwright, PHONE, DESKTOP, ORIGIN, tools } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/** Answers for anything the page might ask; the test then checks that it asked for none of them. */
function fixture() {
  return ({ url }) => {
    const p = url.pathname;
    if (p === '/api/career-hunter/board-native') return { text: 'the Job Board' };
    if (p === '/api/career-hunter/applications') return { json: { applications: [{ posting_id: 11, title: 'Office Manager', company: 'Example', status: 'approval_required' }] } };
    return { json: {} };
  };
}

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: the approvals address forwards to Career's picks on the Job Board and asks for nothing`, async () => {
    const { page, context, calls } = await openScreen(browser, 'career-approvals.html', fixture(), size, '', '/api/career-hunter/approvals');
    try {
      await page.waitForURL(`${ORIGIN}/api/career-hunter/board-native?view=approve`);
      const asked = calls.filter((c) => c.path.startsWith('/api/career-hunter/') && !c.path.startsWith('/api/career-hunter/board-native'));
      assert.deepEqual(asked.filter((c) => c.method !== 'GET'), [], 'nothing was written');
      assert.ok(!asked.some((c) => /\/applications|\/enqueue-drafts|\/run\/build/.test(c.path)), 'no queue was read, filled or scored');
      assert.equal(calls.filter((c) => c.method === 'DIALOG').length, 0, 'no browser dialog');
    } finally { await context.close(); }
  });
}

test('the page is the forward and nothing else: no queue, no Approve, no second way to documents', () => {
  const html = readFileSync(join(tools, 'career-approvals.html'), 'utf8'), shown = html.replace(/<!--[\s\S]*?-->/g, '');
  assert.match(shown, /location\.replace\('\/api\/career-hunter\/board-native\?view=approve'\)/);
  for (const gone of [/enqueue-drafts/, /\/approve\b/, /\/applied\b/, /\/deny\b/, /Add top matches/, /Mark applied manually/, /To approve/, /career-stages\.js/]) assert.doesNotMatch(shown, gone, `the page still carries ${gone}`);
  // With scripts off the page says where the jobs went and links there.
  assert.match(shown, /<a class="ck-primary" href="\/api\/career-hunter\/board-native\?view=approve">Open My jobs<\/a>/);
  assert.equal((shown.match(/ck-primary/g) || []).length, 1, 'one filled button');
});
