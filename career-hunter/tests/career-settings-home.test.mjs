/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Career Settings, grade C). The real tools/career-settings.html in Chromium over a synthetic fixture: it opens on one list of sections with Matching first and no cards; a section row opens only that section with a way back; Matching has one "Remote jobs only" toggle that saves on change (POST /settings/remote-only) with no Save button; target titles save on change with a "Saved" caption; a member never sees the administrator source link and an administrator does; the hardcoded school and county directory is gone.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE, DESKTOP } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

function settings(state) {
  return ({ method, url }) => {
    const p = url.pathname;
    if (p === '/api/career-hunter/companies-admin') return state.admin ? { text: '<!doctype html>' } : { status: 403, json: { error: 'forbidden' } };
    if (p === '/api/career-hunter/title-profile/state') return { json: { remoteOnly: false, titleTerms: ['Platform Engineer'], searchScope: { near: 'Austin, TX', radiusMiles: 50, includeRemote: true } } };
    if (p === '/api/career-hunter/settings/remote-only' && method === 'POST') return { json: { ok: true } };
    if (p === '/api/career-hunter/settings/title-profile' && method === 'POST') return { json: { ok: true } };
    if (p === '/api/v1/agent/schedules') return { json: { schedules: [] } };
    return { json: {} };
  };
}

test('phone: one list of sections; Matching opens alone and saves on change', async () => {
  const { page, context, calls } = await openScreen(browser, 'career-settings.html', settings({ admin: false }), PHONE);
  try {
    const home = page.getByRole('list', { name: 'Settings sections' });
    await home.waitFor();
    assert.match(await home.locator('a').first().innerText(), /^Matching/);
    assert.equal(await page.locator('.card:visible').count(), 0, 'the home is a list, not 14 cards');
    await home.getByRole('link', { name: /^Matching/ }).tap();
    await page.locator('#titleTerms').waitFor();
    assert.equal(await page.locator('#linkedinJobs').isVisible(), false, 'only the Matching section shows');
    assert.equal(await page.locator('#scopeRemote').isVisible(), false);
    assert.equal(await page.locator('#remoteOnly').isVisible(), false);
    assert.equal(await page.locator('[data-section="matching"] button:visible').filter({ hasText: /^Save/ }).count(), 0, 'no Save buttons in Matching');
    await page.getByLabel('Remote jobs only').check();
    await page.waitForFunction(() => document.querySelector('[data-saved="scope"]').textContent === 'Saved');
    assert.ok(calls.some((c) => c.path === '/api/career-hunter/settings/remote-only' && c.body.remoteOnly === true));
    await page.locator('#titleTerms').fill('Platform Engineer, SRE'); await page.locator('#titleTerms').press('Tab');
    await page.waitForFunction(() => document.querySelector('[data-saved="titles"]').textContent === 'Saved');
    await page.getByRole('button', { name: '‹ Settings' }).tap();
    await home.waitFor();
    assert.equal(await page.locator('#adminSources').isVisible(), false);
  } finally { await context.close(); }
});

test('desktop: the administrator source link shows only to an administrator; no hardcoded school directory', async () => {
  const { page, context } = await openScreen(browser, 'career-settings.html', settings({ admin: true }), DESKTOP, '#refresh');
  try {
    await page.locator('#sourceConfiguration').waitFor();
    await page.locator('#adminSources').waitFor();
    assert.equal(await page.locator('#communitySources').isVisible(), false);
    assert.doesNotMatch(await page.locator('body').innerText(), /Pensacola|Okaloosa|Walton/);
  } finally { await context.close(); }
});
