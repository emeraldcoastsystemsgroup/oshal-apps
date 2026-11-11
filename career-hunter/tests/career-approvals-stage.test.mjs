/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Approvals). The real tools/career-approvals.html in Chromium: it carries the Job Board stage control with To approve selected; "Add top matches" replaces "Generate draft candidates" and sends the stepper's value clamped to the route's 1-50; adding nothing says "No scored matches yet" with one primary Find & score jobs that starts POST /run/build; a queued role's Approve sits in its row menu and Deny confirms in the page without a browser dialog.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 1. No control or line on the page names the vendor's project. With the independent work saved with a résumé listed in Additional experience (GET /experience-bank, the saved-portfolio entry), a tick box, Include my other experience, names that entry; Approve sends oshal false with the box clear and oshal true with it ticked, the two shapes the route always took. With no such entry (other entries only, the entry archived, or no answer) the box is absent and Approve sends oshal false. A role approved with it is badged With other experience, and a status the person recorded themselves says "You marked this as applied yourself".
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
    if (p === '/api/career-hunter/jobs' && url.searchParams.get('status') === 'applied') return { json: { jobs: state.applied || [] } };
    if (p === '/api/career-hunter/jobs') return { json: { jobs: [] } };
    if (p === '/api/career-hunter/experience-bank') return state.bank ? { json: state.bank } : { status: 404, json: { error: 'not in fixture' } };
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

const queued = () => [{ posting_id: 11, title: 'Office Manager', company: 'Example', status: 'approval_required' }, { posting_id: 12, title: 'Warehouse Supervisor', company: 'Example', status: 'approval_required' }];
const entry = (id, extra = {}) => ({ id, title: 'Neighbourhood food bank website', kind: 'project', organization: '', period: '', facts: 'Built and ran it.', skills: [], archived: false, ...extra });

test('Include my other experience is a tick box that names the entry and decides what Approve sends', async () => {
  const state = { apps: queued(), bank: { version: 1, revision: 'r1', entries: [entry('saved-portfolio'), entry('3f2b8a10-own-entry', { title: 'Evening bookkeeping course' })] } };
  const { page, context, calls } = await openScreen(browser, 'career-approvals.html', approvals(state), DESKTOP);
  try {
    const box = page.getByLabel(/Include my other experience/);
    await box.waitFor();
    assert.equal(await box.isChecked(), false, 'clear until the person ticks it');
    assert.match(await page.locator('#otherExp').innerText(), /Adds “Neighbourhood food bank website” from Additional experience to the résumé as its own section\./);
    await page.getByRole('button', { name: 'Actions for Office Manager' }).click();
    assert.deepEqual(await page.getByRole('menuitem').allInnerTexts(), ['Approve', 'Deny…'], 'one Approve, no second button');
    await page.getByRole('menuitem', { name: 'Approve', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.app').length === 1);
    assert.equal(calls.find((c) => c.path === '/api/career-hunter/applications/11/approve').body.oshal, false);
    await box.check();
    await page.getByRole('button', { name: 'Actions for Warehouse Supervisor' }).click();
    await page.getByRole('menuitem', { name: 'Approve', exact: true }).click();
    await page.getByRole('heading', { name: 'Nothing waiting for approval' }).waitFor();
    assert.equal(calls.find((c) => c.path === '/api/career-hunter/applications/12/approve').body.oshal, true);
    assert.doesNotMatch(await page.content(), />[^<]*OSHAL[^<]*</, 'no text on the page names the vendor\'s project');
  } finally { await context.close(); }
});

for (const [name, bank] of [
  ['only entries the person wrote themselves', { version: 1, revision: 'r2', entries: [entry('3f2b8a10-own-entry')] }],
  ['the saved entry archived', { version: 1, revision: 'r3', entries: [entry('saved-portfolio', { archived: true })] }],
  ['no answer from Additional experience', null],
]) {
  test(`with ${name} the tick box is absent and Approve sends what it always sent`, async () => {
    const state = { apps: queued().slice(0, 1), bank };
    const { page, context, calls } = await openScreen(browser, 'career-approvals.html', approvals(state), PHONE);
    try {
      await page.getByRole('button', { name: 'Actions for Office Manager' }).tap();
      await page.getByRole('menuitem', { name: 'Approve', exact: true }).tap();
      await page.getByRole('heading', { name: 'Nothing waiting for approval' }).waitFor();
      assert.ok(calls.some((c) => c.path === '/api/career-hunter/experience-bank'), 'the page asked Additional experience');
      assert.equal(await page.locator('#otherExp').isVisible(), false, 'and, with its answer long in, offers no tick box');
      assert.equal(calls.find((c) => c.path === '/api/career-hunter/applications/11/approve').body.oshal, false);
    } finally { await context.close(); }
  });
}

test('a role approved with other experience is badged in words, and a status the person set says so', async () => {
  const state = { apps: [{ posting_id: 21, title: 'Office Manager', company: 'Example', status: 'drafted', include_oshal: true }, { posting_id: 22, title: 'Dispatcher', company: 'Example', status: 'applied' }],
    applied: [{ id: 22, status: 'applied', application_source: 'manual-mark' }] };
  const { page, context } = await openScreen(browser, 'career-approvals.html', approvals(state), DESKTOP);
  try {
    await page.locator('.app[data-app="22"] .application-proof').waitFor();
    assert.match(await page.locator('.app[data-app="21"] .title').textContent(), /Office Manager\s+With other experience/);
    const proof = await page.locator('.app[data-app="22"] .application-proof').innerText();
    assert.match(proof, /Marked applied manually/);
    assert.match(proof, /You marked this as applied yourself\. Career has no confirmation that it was sent\./);
    assert.doesNotMatch(await page.locator('body').innerText(), /operator|OSHAL/i);
  } finally { await context.close(); }
});
