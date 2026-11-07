/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Recruiters, grade F). The real tools/career-recruiters.html in Chromium over a synthetic fixture: a list answering 500 shows "Couldn't load your recruiters" with Retry (role=alert) and never "No recruiters in this view", and Retry recovers all 18 firms; the add form labels its fields with the required mark and on a phone opens as an "Add recruiter" sheet with one Add; status selects are at least 44px; Delete lives in the row menu and confirms in the page (no browser dialog); a search field appears past 10 firms and filters the rows.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE, DESKTOP } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const firms = () => Array.from({ length: 18 }, (_, i) => ({ id: i + 2, firm: `Firm ${String(i + 1).padStart(2, '0')}`,
  bucket: i < 6 ? 'Cleared / GovTech' : 'Exec Search', status: 'To contact', website: '', contact_name: '', next_action: '' }));

/** An in-memory tracker; `fail` makes the list answer 500 that many times. */
function tracker(state) {
  return ({ method, url }) => {
    if (url.pathname === '/api/career-hunter/recruiters' && method === 'GET') {
      if (state.fail > 0) { state.fail -= 1; return { status: 500, json: { error: 'read failed' } }; }
      const byStatus = [...new Set(state.rows.map((r) => r.status))].map((s) => ({ status: s, n: state.rows.filter((r) => r.status === s).length }));
      return { json: { recruiters: state.rows, byStatus, buckets: [] } };
    }
    if (url.pathname.startsWith('/api/career-hunter/recruiters/') && method === 'DELETE') {
      const id = Number(url.pathname.split('/').pop()); state.rows = state.rows.filter((r) => r.id !== id); return { json: { ok: true } };
    }
    if (url.pathname.startsWith('/api/career-hunter/recruiters/')) return { json: { ok: true } };
    if (url.pathname === '/api/career-hunter/recruiters') return { status: 201, json: { ok: true, id: 99 } };
    return null;
  };
}

test('a failed list is an alert with Retry, never the empty state, and Retry shows every firm', async () => {
  const state = { rows: firms(), fail: 1 };
  const { page, context } = await openScreen(browser, 'career-recruiters.html', tracker(state), DESKTOP);
  try {
    const alert = page.getByRole('alert');
    await alert.waitFor();
    assert.match(await alert.innerText(), /Couldn.t load your recruiters/);
    assert.doesNotMatch(await page.locator('#list').innerText(), /No recruiters in this view/);
    await page.getByRole('button', { name: 'Retry' }).click();
    await page.locator('.row').nth(17).waitFor();
    assert.equal(await page.locator('.row').count(), 18);
  } finally { await context.close(); }
});

test('desktop: labelled add form, 44px status selects, search past 10 firms, Delete confirms in the page', async () => {
  const state = { rows: firms(), fail: 0 };
  const { page, context, calls } = await openScreen(browser, 'career-recruiters.html', tracker(state), DESKTOP);
  try {
    await page.locator('.row').nth(17).waitFor();
    assert.equal(await page.getByLabel(/Firm or recruiter/).count(), 1, 'the firm field has a label above it');
    assert.match(await page.locator('#addForm').innerText(), /Firm or recruiter \*/);
    assert.equal(await page.locator('.ck-primary:visible').count(), 1, 'one primary on the screen');
    const h = await page.locator('.row select').first().evaluate((el) => el.getBoundingClientRect().height);
    assert.ok(h >= 44, `status select is ${h}px`);
    await page.locator('#search').fill('Firm 03');
    assert.equal(await page.locator('.row').count(), 1);
    await page.locator('#search').fill('');
    await page.getByRole('button', { name: 'More for Firm 01' }).click();
    await page.getByRole('menuitem', { name: 'Delete…' }).click();
    const confirm = page.getByRole('alertdialog');
    assert.match(await confirm.innerText(), /Delete Firm 01\?/);
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.row').length === 17);
    assert.equal(calls.filter((c) => c.method === 'DIALOG').length, 0, 'no browser dialog');
    assert.ok(calls.some((c) => c.method === 'DELETE' && c.path === '/api/career-hunter/recruiters/2'));
  } finally { await context.close(); }
});

test('phone: Add recruiter opens a sheet whose one primary adds the firm', async () => {
  const state = { rows: firms().slice(0, 4), fail: 0 };
  const { page, context, calls } = await openScreen(browser, 'career-recruiters.html', tracker(state), PHONE);
  try {
    await page.locator('.row').first().waitFor();
    assert.equal(await page.locator('#search').isVisible(), false, 'no search for four firms');
    assert.equal(await page.locator('#firm').isVisible(), false, 'the form waits in its sheet');
    await page.getByRole('button', { name: 'Add recruiter' }).tap();
    const sheet = page.getByRole('dialog', { name: 'Add recruiter' });
    await sheet.waitFor();
    await sheet.getByLabel(/Firm or recruiter/).fill('Acme Search');
    await sheet.getByRole('button', { name: 'Add', exact: true }).tap();
    await page.waitForFunction(() => !document.getElementById('addSheet').open);
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/career-hunter/recruiters');
    assert.equal(post.body.firm, 'Acme Search');
  } finally { await context.close(); }
});
