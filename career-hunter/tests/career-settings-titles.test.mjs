/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.52.2 (Roger, 2026-11-10, on a phone): Target titles "says saved after a tabbed out change but it doesnt save" and has "no way to save changes". The real tools/career-settings.html in Chromium at phone size, over a stand-in for the save route that answers the way routes/career-title-score.js does (at most 16 titles of 3 to 60 characters, repeats dropped): the line under the box names what was not kept, a refused save says Not saved and leaves the typed list alone, and one edit is one save.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 14: the section that holds the titles reads What I'm looking for (was Matching); the link the cases open follows.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/** The server's own rule (normalizeTitleTerms): split on commas and new lines, 3 to 60 characters, no repeats, 16 at most. */
function kept(terms) {
  const seen = new Set(), out = [];
  for (const raw of String(terms ?? '').split(/[,\n]/)) {
    const term = raw.replace(/\s+/g, ' ').trim();
    if (term.length < 3 || term.length > 60 || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase()); out.push(term);
    if (out.length >= 16) break;
  }
  return out;
}

function settings(state) {
  return ({ method, url, body }) => {
    const p = url.pathname;
    if (p === '/api/career-hunter/companies-admin') return { status: 403, json: { error: 'forbidden' } };
    if (p === '/api/career-hunter/title-profile/state') return { json: { remoteOnly: false, titleTerms: state.saved, source: 'user', searchScope: { near: 'Austin, TX', radiusMiles: 50, includeRemote: true } } };
    if (p === '/api/career-hunter/settings/title-profile' && method === 'POST') {
      if (state.refuse) return { status: 500, json: { error: 'save failed' } };
      state.saved = kept(body.terms);
      return { json: { ok: true, titleTerms: state.saved } };
    }
    if (p === '/api/v1/agent/schedules') return { json: { schedules: [] } };
    return { json: {} };
  };
}

async function matching(state) {
  const opened = await openScreen(browser, 'career-settings.html', settings(state), PHONE);
  await opened.page.getByRole('list', { name: 'Settings sections' }).getByRole('link', { name: /^What I'm looking for/ }).tap();
  await opened.page.locator('#titleTerms').waitFor();
  await opened.page.waitForFunction((n) => document.querySelector('#titleTerms').value.split('\n').filter(Boolean).length === n, state.saved.length);
  return opened;
}
const saves = (calls) => calls.filter((c) => c.path === '/api/career-hunter/settings/title-profile' && c.method === 'POST');
const caption = (page) => page.locator('#titleSaved').innerText();

test('the list is a multi-line box with its own Save, and the line under it says what was kept and what was not', async () => {
  const state = { saved: ['Platform Engineer', 'SAP Architect'] };
  const { page, context, calls } = await matching(state);
  try {
    const box = page.locator('#titleTerms');
    assert.equal(await box.evaluate((el) => el.tagName), 'TEXTAREA');
    assert.equal(await box.inputValue(), 'Platform Engineer\nSAP Architect', 'one title per line');
    const save = page.getByRole('button', { name: 'Save titles' });
    assert.equal(await save.isVisible(), true, 'there is a way to save');
    const fits = await box.evaluate((el) => el.getBoundingClientRect().right <= document.documentElement.clientWidth && el.getBoundingClientRect().width > 300);
    assert.equal(fits, true, 'the box uses the phone\'s width and stays inside it');
    await box.fill('Platform Engineer\nSAP Architect\nPM\nSite Reliability Engineer\nplatform engineer');
    assert.equal(await caption(page), 'Not saved yet');
    await save.tap();
    await page.waitForFunction(() => document.querySelector('#titleSaved').textContent.startsWith('Saved'));
    assert.equal(await caption(page), 'Saved 3 titles. Not kept: PM (a title needs 3 to 60 characters, and the list holds 16).');
    assert.equal(await box.inputValue(), 'Platform Engineer\nSAP Architect\nSite Reliability Engineer', 'the box shows exactly what is saved');
    assert.deepEqual(state.saved, ['Platform Engineer', 'SAP Architect', 'Site Reliability Engineer']);
    assert.equal(saves(calls).length, 1, 'one press, one save');
  } finally { await context.close(); }
});

test('leaving the box after an edit saves once; more than sixteen names the ones that did not fit', async () => {
  const state = { saved: [] };
  const { page, context, calls } = await matching(state);
  try {
    const many = Array.from({ length: 19 }, (_, i) => `Role number ${i + 1}`);
    await page.locator('#titleTerms').fill(many.join('\n'));
    await page.locator('#titleLimit').focus();
    await page.waitForFunction(() => document.querySelector('#titleSaved').textContent.startsWith('Saved'));
    assert.equal(await caption(page), 'Saved 16 titles. Not kept: Role number 17, Role number 18, Role number 19 (a title needs 3 to 60 characters, and the list holds 16).');
    assert.equal(saves(calls).length, 1);
    await page.locator('#titleTerms').focus();
    await page.locator('#titleLimit').focus();
    await page.waitForTimeout(300);
    assert.equal(saves(calls).length, 1, 'leaving the box without a change saves nothing');
  } finally { await context.close(); }
});

test('a refused save says Not saved with the reason and leaves the typed list in the box', async () => {
  const state = { saved: ['Platform Engineer'], refuse: true };
  const { page, context } = await matching(state);
  try {
    await page.locator('#titleTerms').fill('Platform Engineer\nData Engineer');
    await page.getByRole('button', { name: 'Save titles' }).tap();
    await page.waitForFunction(() => document.querySelector('#titleSaved').textContent.startsWith('Not saved:'));
    assert.equal(await caption(page), 'Not saved: save failed. Your list is still in the box; press Save titles to try again.');
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#titleTerms').inputValue(), 'Platform Engineer\nData Engineer', 'what was typed is not replaced by the old list');
    assert.deepEqual(state.saved, ['Platform Engineer']);
    state.refuse = false;
    await page.getByRole('button', { name: 'Save titles' }).tap();
    await page.waitForFunction(() => document.querySelector('#titleSaved').textContent === 'Saved 2 titles.');
    assert.deepEqual(state.saved, ['Platform Engineer', 'Data Engineer']);
  } finally { await context.close(); }
});
