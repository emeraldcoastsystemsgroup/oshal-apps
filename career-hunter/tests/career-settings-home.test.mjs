/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Career Settings, grade C). The real tools/career-settings.html in Chromium over a synthetic fixture: it opens on one list of sections with Matching first and no cards; a section row opens only that section with a way back; Matching has one "Remote jobs only" toggle that saves on change (POST /settings/remote-only) with no Save button; target titles save on change with a "Saved" caption; a member never sees the administrator source link and an administrator does; the hardcoded school and county directory is gone.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.52.2: the Target titles list is free text, so it keeps a Save titles button beside save-on-change (career-settings-titles.test.mjs holds its behaviour).
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, changes 1 and 14: the sections read What I'm looking for, Companies I want, Imports, Check for new jobs now, Email updates and Résumé and materials, each with one line in a job seeker's words; every section still opens the controls it held; the example job titles are ordinary ones; and no line a person can open on the page names the vendor's platform or one person's field.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Pull jobs now is the administrator's (career-settings-administrator.test.mjs), so the section a job seeker opens is checked by the one button every person has there. The rows' full lines are still what the page ships; what each person sees of them is held by that file.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Keep Career's own Accounts section in the real Settings navigation without changing the existing sections or admission checks.
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
    if (p === '/api/career-hunter/settings/title-profile' && method === 'POST') return { json: { ok: true, titleTerms: ['Platform Engineer', 'SRE'] } };
    if (p === '/api/v1/agent/schedules') return { json: { schedules: [] } };
    return { json: {} };
  };
}

test('phone: one list of sections; What I\'m looking for opens alone and saves on change', async () => {
  const { page, context, calls } = await openScreen(browser, 'career-settings.html', settings({ admin: false }), PHONE);
  try {
    const home = page.getByRole('list', { name: 'Settings sections' });
    await home.waitFor();
    assert.match(await home.locator('a').first().innerText(), /^What I'm looking for/);
    assert.equal(await page.locator('.card:visible').count(), 0, 'the home is a list, not 14 cards');
    await home.getByRole('link', { name: /^What I'm looking for/ }).tap();
    await page.locator('#titleTerms').waitFor();
    assert.equal(await page.locator('#linkedinJobs').isVisible(), false, 'only that section shows');
    assert.equal(await page.locator('#scopeRemote').isVisible(), false);
    assert.equal(await page.locator('#remoteOnly').isVisible(), false);
    assert.deepEqual(await page.locator('[data-section="matching"] button:visible').filter({ hasText: /^Save/ }).allInnerTexts(), ['Save titles'], 'toggles and the area save on change; the free-text title list also has its own Save');
    await page.getByLabel('Remote jobs only').check();
    await page.waitForFunction(() => document.querySelector('[data-saved="scope"]').textContent === 'Saved');
    assert.ok(calls.some((c) => c.path === '/api/career-hunter/settings/remote-only' && c.body.remoteOnly === true));
    await page.locator('#titleTerms').fill('Platform Engineer, SRE'); await page.locator('#titleTerms').press('Tab');
    await page.waitForFunction(() => document.querySelector('[data-saved="titles"]').textContent === 'Saved 2 titles.');
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

const SECTIONS = [
  ['matching', "What I'm looking for", 'Job titles, where and how far, remote work, nightly matches', '#titleTerms'],
  ['companies', 'Companies I want', 'Career checks these every night', '#targetUrl'],
  ['imports', 'Imports', 'Jobs you saved on LinkedIn', '#linkedinJobsImport'],
  ['refresh', 'Check for new jobs now', 'Look again, see how the last check went, and see how applications are prepared', '#runScore'],
  ['keys', 'Email updates', 'Replies about your applications, and the AI and web search Career uses', '#mailEnable'],
  ['accounts', 'Accounts', 'Gmail for application replies and how LinkedIn uses your browser', '#careerGmailConnect'],
  ['materials', 'Résumé and materials', 'Your résumé, work samples and other materials', 'a[data-career-tool="career-resume-studio"]'],
];

test('the sections are named in a job seeker\'s words and each still opens its own controls', async () => {
  const { page, context } = await openScreen(browser, 'career-settings.html', settings({ admin: false }), DESKTOP);
  try {
    const home = page.getByRole('list', { name: 'Settings sections' });
    await home.waitFor();
    assert.deepEqual(await home.locator('a').evaluateAll((links) => links.map((a) => [a.dataset.open, a.firstChild.textContent, a.querySelector('small').textContent])), SECTIONS.map(([id, name, line]) => [id, name, line]));
    assert.match(await page.locator('.lede').innerText(), /^What you are looking for, the companies you want, and how Career checks for jobs and replies\.$/);
    for (const [id, name, , control] of SECTIONS) {
      await home.getByRole('link', { name: new RegExp('^' + name) }).click();
      await page.locator(`[data-section="${id}"] ${control}`).first().waitFor();
      assert.equal(await page.locator('[data-section]:visible').evaluateAll((cards, want) => cards.every((card) => card.dataset.section === want), id), true, `only ${name} is open`);
      await page.getByRole('button', { name: '‹ Settings' }).click();
      await home.waitFor();
    }
  } finally { await context.close(); }
});

test('no line on the page names the vendor\'s platform or one person\'s field, and the example titles are ordinary', async () => {
  const { page, context } = await openScreen(browser, 'career-settings.html', settings({ admin: true }), DESKTOP);
  try {
    await page.getByRole('list', { name: 'Settings sections' }).waitFor();
    // Every card's words, shown or not: a section the person has not opened yet still ships these lines.
    const words = await page.evaluate(() => [...document.querySelectorAll('.wrap h1, .wrap h2, .wrap h3, .wrap p, .wrap label, .wrap a, .wrap button, .wrap small')].map((el) => el.textContent).join('\n')
      + '\n' + [...document.querySelectorAll('.wrap [placeholder]')].map((el) => el.getAttribute('placeholder')).join('\n'));
    assert.doesNotMatch(words, /OSHAL|\bSAP\b|Basis Administrator|nightly pull|Email and keys|Refresh and sources/);
    assert.equal(await page.locator('#titleTerms').getAttribute('placeholder'), 'One title per line, for example:\nRegistered nurse\nWarehouse supervisor\nOffice manager');
  } finally { await context.close(); }
});
