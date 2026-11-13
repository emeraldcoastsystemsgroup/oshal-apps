/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Recruiters, grade F). The real tools/career-recruiters.html in Chromium over a synthetic fixture: a list answering 500 shows "Couldn't load your recruiters" with Retry (role=alert) and never "No recruiters in this view", and Retry recovers all 18 firms; the add form labels its fields with the required mark and on a phone opens as an "Add recruiter" sheet with one Add; status selects are at least 44px; Delete lives in the row menu and confirms in the page (no browser dialog); a search field appears past 10 firms and filters the rows.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 1. A person with no recruiter (no store, or a store with no firm in it) sees "No recruiters yet", what the list is for, and one filled button, Add a recruiter; on a computer that button reveals the form in the page and the form's Add becomes the one filled button; on a phone the form is not on the first screen and the button opens the sheet. The label reads Type, not Bucket, and the request still sends the stored field name. The cases that already added a firm follow the new button name and reveal the form first.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Measure actual44px firm/contact links and long-label wrapping without changing their native destinations or tracker state; await the asynchronous sheet close before checking its replacement action.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE, DESKTOP } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const firms = () => Array.from({ length: 18 }, (_, i) => ({ id: i + 2, firm: `Firm ${String(i + 1).padStart(2, '0')}`,
  bucket: i < 6 ? 'Staffing agency' : 'Executive search', status: 'To contact', website: '', contact_name: '', next_action: '' }));

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

for(const [label,size] of [['computer',DESKTOP],['phone',PHONE]])test(`${label}: firm and contact links have44px targets and wrap long labels`,async()=>{
  const rows=firms().slice(0,2).map((r,i)=>({...r,firm:i?'ExecutiveSearch'.repeat(24):'A',
    website:'https://firm.example.invalid/'+i,contact_name:i?'RecruiterContact'.repeat(24):'Jo',
    contact_link:'https://contact.example.invalid/'+i,contact_role:'Recruiter'}));
  const {page,context,calls}=await openScreen(browser,'career-recruiters.html',tracker({rows,fail:0}),size);
  try{
    await page.locator('.row').nth(1).waitFor();
    const links=page.locator('.row .firm a,.row .contact a');
    const targets=await links.evaluateAll(es=>es.map(e=>({text:e.textContent,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})));
    assert.equal(targets.length,4);
    assert.ok(targets.every(t=>t.width>=44&&t.height>=44),JSON.stringify(targets));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),'long recruiter names wrap within the screen');
    assert.deepEqual(await links.evaluateAll(es=>es.map(e=>[e.getAttribute('href'),e.target,e.rel])),[
      [rows[0].website,'_blank','noopener'],[rows[0].contact_link,'_blank','noopener'],
      [rows[1].website,'_blank','noopener'],[rows[1].contact_link,'_blank','noopener']]);
    await links.first().focus();
    assert.equal(await links.first().evaluate(e=>document.activeElement===e),true);
    assert.equal(calls.some(c=>['POST','DELETE','PATCH'].includes(c.method)),false,'measuring and focusing links cannot update recruiter records');
  }finally{await context.close();}
});

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
    assert.deepEqual(await page.locator('.ck-primary:visible').allInnerTexts(), ['Add a recruiter'], 'one primary on the screen');
    assert.equal(await page.locator('#addForm').isVisible(), false, 'the form waits for its button');
    await page.getByRole('button', { name: 'Add a recruiter' }).click();
    assert.equal(await page.getByLabel(/Firm or recruiter/).count(), 1, 'the firm field has a label above it');
    assert.match(await page.locator('#addForm').innerText(), /Firm or recruiter \*/);
    assert.deepEqual(await page.locator('.ck-primary:visible').allInnerTexts(), ['Add'], 'the form\'s Add is now the one primary');
    assert.equal(await page.getByLabel('Type', { exact: true }).count(), 1, 'the field is labelled Type');
    assert.doesNotMatch(await page.locator('body').innerText(), /bucket/i);
    await page.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(await page.locator('#addForm').isVisible(), false, 'Cancel puts the form away');
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

test('phone: Add a recruiter opens a sheet whose one primary adds the firm', async () => {
  const state = { rows: firms().slice(0, 4), fail: 0 };
  const { page, context, calls } = await openScreen(browser, 'career-recruiters.html', tracker(state), PHONE);
  try {
    await page.locator('.row').first().waitFor();
    assert.equal(await page.locator('#search').isVisible(), false, 'no search for four firms');
    assert.equal(await page.locator('#firm').isVisible(), false, 'the form waits in its sheet');
    await page.getByRole('button', { name: 'Add a recruiter' }).tap();
    const sheet = page.getByRole('dialog', { name: 'Add a recruiter' });
    await sheet.waitFor();
    await sheet.getByLabel(/Firm or recruiter/).fill('Acme Search');
    await sheet.getByLabel('Type', { exact: true }).fill('Staffing agency');
    await sheet.getByRole('button', { name: 'Add', exact: true }).tap();
    await page.waitForFunction(() => !document.getElementById('addSheet').open);
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/career-hunter/recruiters');
    assert.equal(post.body.firm, 'Acme Search');
    assert.equal(post.body.bucket, 'Staffing agency', 'the stored field keeps its name');
  } finally { await context.close(); }
});

/** What the list route answers for a person with no recruiter: no store at all, or a store with no firm in it. */
const NO_RECRUITERS = { 'no store yet': { recruiters: [], buckets: [], byStatus: [], empty: true }, 'a store with no firm': { recruiters: [], buckets: [], byStatus: [] } };

for (const [name, answer] of Object.entries(NO_RECRUITERS)) {
  for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
    test(`${label}, ${name}: "No recruiters yet", what the list is for, and one filled button`, async () => {
      const state = { rows: [], fail: 0 };
      const api = (req) => (req.url.pathname === '/api/career-hunter/recruiters' && req.method === 'GET' && !state.rows.length ? { json: answer } : tracker(state)(req));
      const { page, context, calls } = await openScreen(browser, 'career-recruiters.html', api, size);
      try {
        await page.getByRole('heading', { name: 'No recruiters yet' }).waitFor();
        const body = await page.locator('body').innerText();
        assert.match(body, /When a recruiter or a staffing firm gets in touch, add them here\./);
        assert.doesNotMatch(body, /No recruiters in this view|All\s*0|Choose another status/, 'never the filtered-list wording');
        assert.deepEqual(await page.locator('.ck-primary:visible').allInnerTexts(), ['Add a recruiter']);
        assert.equal(await page.locator('#firm').isVisible(), false, 'the form is not on the first screen');
        assert.equal(await page.locator('.row').count(), 0, 'no firm the person did not add');
        const open = page.getByRole('button', { name: 'Add a recruiter' });
        if (size === PHONE) await open.tap(); else await open.click();
        await page.locator('#firm').waitFor();
        assert.deepEqual(await page.locator('.ck-primary:visible').allInnerTexts(), ['Add']);
        await page.locator('#firm').fill('Northside Staffing');
        state.rows = [{ id: 1, firm: 'Northside Staffing', bucket: 'Other', status: 'To contact', website: '', contact_name: '', next_action: '' }];
        const add = page.getByRole('button', { name: 'Add', exact: true });
        if (size === PHONE) await add.tap(); else await add.click();
        await page.locator('.row').first().waitFor();
        await page.locator('#openAdd').waitFor({state:'visible'});
        assert.equal(calls.filter((c) => c.method === 'POST' && c.path === '/api/career-hunter/recruiters').length, 1);
        assert.equal(await page.getByRole('heading', { name: 'No recruiters yet' }).count(), 0);
        assert.deepEqual(await page.locator('.ck-primary:visible').allInnerTexts(), ['Add a recruiter'], 'the form is put away after the add');
      } finally { await context.close(); }
    });
  }
}
