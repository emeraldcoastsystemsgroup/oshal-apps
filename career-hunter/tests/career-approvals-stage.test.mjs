/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Approvals). The real tools/career-approvals.html in Chromium: it carries the Job Board stage control with To approve selected; "Add top matches" replaces "Generate draft candidates" and sends the stepper's value clamped to the route's 1-50; adding nothing says "No scored matches yet" with one primary Find & score jobs that starts POST /run/build; a queued role's Approve sits in its row menu and Deny confirms in the page without a browser dialog.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE, DESKTOP } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

function approvals(state) {
  return ({ method, url, body }) => {
    const p = url.pathname;
    if (p === '/api/career-hunter/applications') return { json: { applications: state.apps } };
    if (p === '/api/career-hunter/jobs/stats') return { json: { saved: 2, byStatus: [] } };
    if (p === '/api/career-hunter/jobs') return { json: { jobs: [] } };
    if (p === '/api/career-hunter/enqueue-drafts') { state.limit = body.limit; return { json: { created: 0 } }; }
    if (p === '/api/career-hunter/run/build' && method === 'POST') return { json: { ok: true } };
    if (/\/applications\/\d+\/(approve|deny)$/.test(p)) { state.apps = state.apps.filter((a) => !p.includes(`/${a.posting_id}/`)); return { json: { ok: true } }; }
    return null;
  };
}

test('phone: Add top matches with nothing scored says why, with one primary that starts scoring', async () => {
  const state = { apps: [] };
  const { page, context, calls } = await openScreen(browser, 'career-approvals.html', approvals(state), PHONE);
  try {
    const tab = page.getByRole('tab', { name: 'To approve' });
    await tab.waitFor();
    assert.equal(await tab.getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByRole('button', { name: /Generate draft candidates/ }).count(), 0);
    await page.locator('#n').fill('99'); await page.locator('#n').dispatchEvent('change');
    assert.equal(await page.locator('#n').inputValue(), '50', 'the stepper keeps the route bound');
    await page.getByRole('button', { name: 'Add top matches' }).tap();
    await page.getByRole('heading', { name: 'No scored matches yet' }).waitFor();
    assert.equal(state.limit, 50);
    assert.deepEqual(await page.locator('.ck-primary:visible').allInnerTexts(), ['Find & score jobs']);
    await page.getByRole('button', { name: 'Find & score jobs' }).tap();
    await page.getByText(/Scoring started/).waitFor();
    assert.ok(calls.some((c) => c.method === 'POST' && c.path === '/api/career-hunter/run/build'));
  } finally { await context.close(); }
});

test('desktop: Approve is in the row menu and Deny confirms in the page', async () => {
  const state = { apps: [{ posting_id: 11, title: 'Platform Engineer', company: 'Example', status: 'approval_required' }, { posting_id: 12, title: 'Data Engineer', company: 'Example', status: 'approval_required' }] };
  const { page, context, calls } = await openScreen(browser, 'career-approvals.html', approvals(state), DESKTOP);
  try {
    await page.getByRole('button', { name: 'Actions for Platform Engineer' }).click();
    await page.getByRole('menuitem', { name: 'Approve', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.app').length === 1);
    assert.ok(calls.some((c) => c.path === '/api/career-hunter/applications/11/approve' && c.body.oshal === false));
    await page.getByRole('button', { name: 'Actions for Data Engineer' }).click();
    await page.getByRole('menuitem', { name: 'Deny…' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Deny this role' });
    await confirm.getByRole('button', { name: 'Deny' }).click();
    await page.getByRole('heading', { name: 'Nothing waiting for approval' }).waitFor();
    assert.equal(calls.filter((c) => c.method === 'DIALOG').length, 0, 'no browser dialog');
  } finally { await context.close(); }
});
