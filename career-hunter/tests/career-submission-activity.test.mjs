/**
 * CHANGE LOG
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Verify shared per-press words and picture links in the expanded activity page.
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Submission activity, grade C). The real tools/career-submissions.html in Chromium over a synthetic fixture: one status row "No computer connected · last seen 30 days ago" with one Connect a computer (no picker row, no repeated "no worker" lines, no hour count); the lanes are 44px role=tab chips that filter the list; an empty queue is "Nothing sent yet" with one primary Open Job Board; Job Apply's counters are one row computed from these records and each row names its portal; Connect a computer opens the kit sheet with a primary, a tertiary Cancel and an X close, and never a browser dialog.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Guard trial guest behavior: withhold Connect a computer when /api/guest/session reports an active guest visitor.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 5: the lanes read Needs your answer and Removed (were Needs you and Dismissed); the expected lane names follow.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Page names, judge's report 2026-11-11 (tests/career-page-names.test.mjs holds them): the empty queue's button says Open My jobs.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, changes 6, 8 and 9: the lanes read Waiting, Sending, Sent, Needs your answer, Did not go through and Removed; the counters row says what is being sent and what did not go through, and "marked manually" and "verified in" are gone; the computer's row is drawn only for a person who has had a computer (one seen, one bound, or a record of something sent from one), on a computer and on a phone; a job Career only picked is not listed as activity.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE, DESKTOP } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const lastSeen = Date.now() - 30 * 86400000 - 3600000;
function api(state) {
  return ({ url }) => {
    const p = url.pathname;
    if (p === '/api/guest/session') return { json: { guest: Boolean(state.guest), active: Boolean(state.guest) } };
    if (p === '/api/apply-operator/workers') return { json: { workers: [], available: false, observedBrowserNodes: state.never ? [] : [{ lastSeen }] } };
    if (p === '/api/career-hunter/submission-queue') return { json: { items: state.items } };
    if (p === '/api/career-hunter/applications') return { json: { applications: state.records || [] } };
    if (p === '/api/career-hunter/jobs') return { json: { jobs: [] } };
    return { json: {} };
  };
}

test('phone: one status row, chips for lanes and an empty queue with Open My jobs', async () => {
  const { page, context } = await openScreen(browser, 'career-submissions.html', api({ items: [] }), PHONE);
  try {
    await page.getByRole('heading', { name: 'Nothing sent yet' }).waitFor();
    const status = await page.locator('#worker').innerText();
    assert.match(status, /No computer connected · last seen 30 days ago/);
    assert.doesNotMatch(await page.locator('body').innerText(), /\d{3}h \d+m/);
    assert.equal(await page.locator('#nodeSel').isVisible(), false, 'no picker row');
    assert.deepEqual(await page.locator('.ck-primary:visible').allInnerTexts(), ['Open My jobs']);
    const chips = page.getByRole('tablist', { name: 'Submission lanes' }).getByRole('tab');
    assert.deepEqual((await chips.allTextContents()).map((t) => t.replace(/\d+$/, '')), ['All', 'Waiting', 'Sending', 'Sent', 'Needs your answer', 'Did not go through', 'Removed']);
    for (const chip of await chips.all()) assert.ok((await chip.boundingBox()).height >= 44);
    assert.equal(await page.getByRole('link', { name: /Application status/ }).isVisible().catch(() => false), false);
  } finally { await context.close(); }
});

test('desktop: counters row, portal on each row, chips filter, and the connect sheet', async () => {
  const now = new Date().toISOString();
  const items = [
    { id: 's1', postingId: 1, title: 'Platform Engineer', company: 'Example Co', status: 'submitted', updatedAt: now, url: 'https://boards.greenhouse.io/example/jobs/1', confirmationFile: 'c.png' },
    { id: 's2', postingId: 2, title: 'SRE', company: 'Other Co', status: 'failed', updatedAt: now, url: 'https://jobs.lever.co/other/2' },
    { id: 's3', postingId: 3, title: 'Architect', company: 'Third Co', status: 'queued', updatedAt: now, nativeTicketId: 't3', nativeWorkId: 'w3' },
  ];
  const { page, context, calls } = await openScreen(browser, 'career-submissions.html', api({ items }), DESKTOP);
  try {
    await page.locator('.activity-row').nth(2).waitFor();
    assert.equal((await page.locator('#applyCounters').innerText()).replace(/\s+/g, ' ').trim(), '1 being sent 1 did not go through');
    assert.doesNotMatch(await page.locator('body').innerText(), /marked manually|verified in|failed or unknown/);
    assert.deepEqual(await page.locator('.activity-row .pill').allInnerTexts(), ['SENT', 'DID NOT GO THROUGH', 'WAITING'], 'each row is named in the lanes\' words');
    assert.match(await page.locator('.activity-row').first().innerText(), /Example Co · boards\.greenhouse\.io/);
    await page.getByRole('tab', { name: /^Did not go through/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('.activity-row').length === 1);
    await page.getByRole('button', { name: 'Connect a computer' }).click();
    const sheet = page.getByRole('dialog', { name: 'Connect your Career browser worker' });
    await sheet.waitFor();
    assert.match(await sheet.getByRole('button', { name: 'Create and connect worker' }).getAttribute('class'), /ck-primary/);
    assert.match(await sheet.getByRole('button', { name: 'Cancel' }).getAttribute('class'), /ck-tertiary/);
    await sheet.getByRole('button', { name: 'Close' }).click();
    await page.waitForFunction(() => !document.querySelector('dialog.ck-sheet'));
    assert.equal(calls.filter((c) => c.method === 'DIALOG').length, 0);
  } finally { await context.close(); }
});

test('guest visitor: Connect a computer is withheld', async () => {
  const { page, context } = await openScreen(browser, 'career-submissions.html', api({ items: [], guest: true }), PHONE);
  try {
    await page.getByRole('heading', { name: 'Nothing sent yet' }).waitFor();
    assert.match(await page.locator('#worker').innerText(), /No computer connected/);
    assert.equal(await page.locator('#connectComputer').count(), 0);
  } finally { await context.close(); }
});

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: a person who has never had a computer connected is not shown a computer row; one who has is`, async () => {
    const never = await openScreen(browser, 'career-submissions.html', api({ items: [], never: true }), size);
    try {
      await never.page.getByRole('heading', { name: 'Nothing sent yet' }).waitFor();
      assert.equal(await never.page.locator('#worker').isVisible(), false, 'no row, red or otherwise');
      assert.doesNotMatch(await never.page.locator('body').innerText(), /No computer connected|Connect a computer/);
      assert.equal(await never.page.locator('#applyCounters').isVisible(), false, 'and no row of zero counters');
      assert.match(await never.page.locator('#list').innerText(), /The jobs you applied to yourself are in Applications\./);
    } finally { await never.context.close(); }
    const now = new Date().toISOString();
    const tried = await openScreen(browser, 'career-submissions.html', api({ never: true, items: [{ id: 's9', postingId: 9, title: 'Dispatcher', company: 'Example Co', status: 'failed', updatedAt: now }] }), size);
    try {
      await tried.page.locator('.activity-row').waitFor();
      assert.match(await tried.page.locator('#worker').innerText(), /No computer connected/, 'Career tried to send from one, so its absence is news');
      assert.equal(await tried.page.getByRole('button', { name: 'Connect a computer' }).isVisible(), true);
    } finally { await tried.context.close(); }
  });
}

test('a job Career only picked is not activity', async () => {
  const records = [{ posting_id: 11, title: 'Office Manager', company: 'Example Co', status: 'approval_required', ticket_id: 't11' }, { posting_id: 12, title: 'Warehouse Supervisor', company: 'Example Co', status: 'drafted', ticket_id: 't12' }];
  const { page, context } = await openScreen(browser, 'career-submissions.html', api({ items: [], records }), DESKTOP);
  try {
    await page.locator('.activity-row').waitFor();
    assert.deepEqual(await page.locator('.activity-row .rtitle').allInnerTexts(), ['Warehouse Supervisor']);
    assert.doesNotMatch(await page.locator('body').innerText(), /Waiting for your approval/);
  } finally { await context.close(); }
});

test('expanded activity shows the same press words and digest-backed picture addresses',async()=>{
  const items=[{id:'press-story',postingId:4,title:'Fixture',status:'unknown',updatedAt:new Date().toISOString(),pressesAllowed:4,
    presses:[{step:1,kind:'continue',label:'Continue',result:'unknown',origin:'https://jobs.example.com'}],pressPictures:[{step:1,file:'kept.png'}]}];
  const f=await openScreen(browser,'career-submissions.html',api({items}),DESKTOP);
  try{
    await f.page.getByRole('link',{name:/View activity/}).click();
    assert.match(await f.page.locator('.story').innerText(),/Step 1 of up to 4/);
    assert.match(await f.page.locator('.story').innerText(),/The page did not move on in 10 seconds/);
    assert.equal(await f.page.locator('img[src$="/press-story/press-picture/1"]').count(),1);
  }finally{await f.context.close();}
});
