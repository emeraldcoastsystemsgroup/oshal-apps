/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The LinkedIn profile page in plain words (judge's report 2026-11-11, change 13). The shipped tools/career-profile-studio.html in Chromium over fixture answers: it is titled LinkedIn profile; its steps read 1. Write, 2. Check, 3. Update LinkedIn; Save, Approve and Update LinkedIn are its buttons; the help says where the changes are made and names no operator bot or desktop browser worker; the stored state reads in words at each step. When the server refuses to start the update (the 500 "dispatch failed" the native kernel answers) and the plan is still approved, a line that stays on the page says the update did not start. The requests are the ones the page always made.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE, DESKTOP } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/**
 * @description The Profile Studio routes over one in-memory plan.
 * @param {{plan: object, dispatch: 'refused'|'started'}} state - The plan, and what POST /dispatch does.
 * @returns {(req: {method: string, url: URL, body: any}) => object|null} The handler openScreen takes.
 */
function studio(state) {
  const touch = (changes) => { state.plan = { ...state.plan, ...changes, updatedAt: new Date(Date.parse(state.plan.updatedAt) + 1000).toISOString() }; return { json: { plan: state.plan } }; };
  return ({ method, url, body }) => {
    const p = url.pathname.replace('/api/career-hunter/profile-studio', '');
    if (!url.pathname.startsWith('/api/career-hunter/profile-studio')) return null;
    if (p === '/plan' && method === 'GET') return { json: { plan: state.plan } };
    if (p === '/plan' && method === 'POST') return touch({ headline: body.headline, about: body.about, skills: body.skills, customUrl: body.customUrl });
    if (p === '/approve') return touch({ state: 'approved' });
    if (p === '/reset') return touch({ state: 'draft' });
    if (p === '/dispatch') return state.dispatch === 'started' ? touch({ state: 'dispatched' }) : { status: 500, json: { error: 'dispatch failed' } };
    return null;
  };
}
const draft = () => ({ id: 'plan-1', state: 'draft', headline: 'Office manager who keeps forty people on schedule', about: '', skills: ['Scheduling'], customUrl: '', updatedAt: '2026-11-10T12:00:00.000Z' });
const stepNow = (page) => page.locator('#stepLine li[aria-current="step"]').innerText();
const pill = (page) => page.locator('#state').textContent();

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: the page is titled LinkedIn profile and its steps, buttons and help are in plain words`, async () => {
    const { page, context } = await openScreen(browser, 'career-profile-studio.html', studio({ plan: draft(), dispatch: 'refused' }), size);
    try {
      await page.waitForFunction(() => document.getElementById('headline').value !== '');
      assert.equal(await page.title(), 'LinkedIn profile');
      assert.equal(await page.locator('h1').textContent(), 'LinkedIn profile');
      assert.deepEqual(await page.locator('#stepLine li').allTextContents(), ['1. Write', '2. Check', '3. Update LinkedIn']);
      assert.equal(await stepNow(page), '1. Write');
      assert.equal(await pill(page), 'Draft');
      assert.deepEqual(await page.locator('.card .bar').first().locator('button:visible').allInnerTexts(), ['Save', 'Approve']);
      assert.match(await page.locator('#profileFormWork').innerText(), /RÉSUMÉ FOR YOUR FEATURED SECTION \(PDF\)|Résumé for your Featured section \(PDF\)/);
      const help = page.getByRole('button', { name: 'Help' });
      if (size === PHONE) await help.tap(); else await help.click();
      const sheet = page.getByRole('dialog', { name: 'How Career updates LinkedIn' });
      await sheet.waitFor();
      const words = await sheet.innerText();
      assert.match(words, /Career makes the changes in your own Chrome, on your computer, after you press Update LinkedIn\./);
      assert.match(words, /Nothing changes on LinkedIn until you have pressed both Approve and Update LinkedIn/);
      assert.doesNotMatch(await page.locator('body').innerText(), /operator bot|browser worker|desktop worker|Save plan|Sent to your computer|Send to my desktop|Profile Studio/i);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'nothing is wider than the screen');
    } finally { await context.close(); }
  });
}

test('when the update cannot start, a line that stays on the page says so and the plan is still approved', async () => {
  const state = { plan: draft(), dispatch: 'refused' };
  const { page, context, calls } = await openScreen(browser, 'career-profile-studio.html', studio(state), DESKTOP);
  try {
    await page.waitForFunction(() => document.getElementById('headline').value !== '');
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    const update = page.getByRole('button', { name: 'Update LinkedIn', exact: true });
    await update.waitFor();
    assert.equal(await pill(page), 'Approved');
    assert.equal(await stepNow(page), '2. Check');
    assert.equal(await page.locator('#sendError').isVisible(), false, 'no warning before anything was refused');
    await update.click();
    assert.equal(await page.locator('#confirmText').innerText(), 'Update LinkedIn now? Career makes these changes in your own Chrome, on your computer.');
    await page.getByRole('button', { name: 'Update now', exact: true }).click();
    const alert = page.getByRole('alert');
    await alert.waitFor();
    assert.equal(await alert.innerText(), 'The LinkedIn update did not start. Your plan is still approved, so you can try again.');
    assert.equal(await pill(page), 'Approved');
    assert.equal(calls.filter((c) => c.method === 'POST' && c.path === '/api/career-hunter/profile-studio/dispatch').length, 1);
    assert.doesNotMatch(await page.locator('body').innerText(), /dispatch failed/i);
    await page.getByRole('button', { name: 'Back to draft' }).click();
    await page.getByRole('button', { name: 'Approve', exact: true }).waitFor();
    assert.equal(await page.locator('#sendError').isVisible(), false, 'the line goes when the person moves on');
  } finally { await context.close(); }
});

test('when the update starts, the page says LinkedIn is being updated and offers Stop waiting', async () => {
  const state = { plan: { ...draft(), state: 'approved' }, dispatch: 'started' };
  const { page, context } = await openScreen(browser, 'career-profile-studio.html', studio(state), PHONE);
  try {
    const update = page.getByRole('button', { name: 'Update LinkedIn', exact: true });
    await update.waitFor();
    await update.tap();
    await page.getByRole('button', { name: 'Update now', exact: true }).tap();
    await page.getByRole('button', { name: 'Stop waiting', exact: true }).waitFor();
    assert.equal(await pill(page), 'Updating LinkedIn');
    assert.equal(await stepNow(page), '3. Update LinkedIn');
    assert.equal(await page.locator('#sendError').isVisible(), false);
  } finally { await context.close(); }
});
