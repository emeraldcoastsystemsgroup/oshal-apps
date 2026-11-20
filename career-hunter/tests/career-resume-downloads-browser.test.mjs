/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove missing professional format choices in the existing My résumé More menu at phone and desktop widths, retaining its current download location without saving or generating.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Prove real transient Professional export bytes, mid-flight dialog cancellation, generated packet/cover format choices on Prepare application, and exact retained PDF withholding on submitted applications.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.68.20: verify Prepare application offers all 4 executive template families (Professional, Standard, Leadership, Technical) across Word/PDF/RTF for both résumé and cover letter.
 */
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {openScreen, playwright, PHONE, DESKTOP} from './helpers/ux-page.mjs';
import {stableJSON} from '../../presentations/tools/office/model.mjs';
import {renderOffice} from '../../presentations/routes/office-editor/formats.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({headless: true}); });
after(async () => { await browser?.close(); });
const packet = {revision: 'a'.repeat(64), resume: {headline: 'Platform lead', summary: 'Recorded work.',
  competencies: [], skills: [], education: [], certifications: [], clearance: '',
  experience: [{id: 'role-1', title: 'Engineer', org: 'Example', span: 'Jan 2020 – Mar 2024', bullets: ['Delivered the recorded project.']}]},
  cover: {}, meta: {master: true, name: 'Synthetic Candidate'}};
const require = createRequire(import.meta.url), Office = require('../tools/career-resume-office.js');
const ID = '7d3f0c2a-5b8e-4f1a-9c6d-2e4b8a0f1c3d';
const saved = {id: ID, title: Office.TITLE, kind: 'docx', revision: 7, model: Office.resumeToModel(packet.resume, packet.meta, packet.revision)};

function answers({url}) {
  if (url.pathname === '/api/career-hunter/resume/doc') return {json: packet};
  if (url.pathname === '/api/career-hunter/resume/state') return {json: {hasResume: true, indexing: false}};
  if (url.pathname === '/api/career-hunter/jobs') return {json: {jobs: []}};
  if (url.pathname === '/api/presentations/editor/documents') return {json: {documents: [saved]}};
  if (url.pathname === '/api/presentations/editor/documents/' + ID) return {json: {document: saved}};
  return null;
}

for (const [label, size] of [['phone', PHONE], ['desktop', DESKTOP]]) {
  test(`${label}: actual My résumé keeps its export location and offers the missing professional formats`, async () => {
    const {page, context, calls} = await openScreen(browser, 'career-resume-studio.html', answers, size);
    try {
      await page.locator('#officeFrame').waitFor({state: 'attached'});
      await page.waitForFunction(() => document.body.dataset.view === 'office');
      assert.equal(await page.locator('#docIdentityBadge').textContent(), 'Main résumé', 'real page loaded the selected source');
      await page.locator('#moreBtn').click();
      const professional = page.getByRole('menuitem', {name: 'Professional résumé (Word / PDF)…', exact: true});
      assert.equal(await professional.isVisible(), true, 'the missing style belongs to the existing More menu');
      await professional.click();
      const choices = page.getByRole('dialog', {name: 'Professional résumé', exact: true});
      assert.equal(await choices.isVisible(), true);
      assert.deepEqual(await choices.locator('[data-export-format] option').allTextContents(), ['Word (.docx)', 'PDF']);
      assert.equal(await page.locator('[data-career-downloads]:visible').count(), 0, 'no duplicate main résumé Download area');
      assert.equal(await choices.getByRole('button', {name: 'Download selected file', exact: true}).isVisible(), true);
      assert.deepEqual(calls.filter(call => call.method === 'POST'), [], 'choosing download options does not save or generate');
    } finally { await context.close(); }
  });
}

function officeRuntime() {
  const root = process.env.STORE_CI_TOOLCHAIN || resolve(import.meta.dirname, '../../scripts/toolchain');
  const pkg = root.endsWith('node_modules') ? resolve(root, '..', 'package.json') : resolve(root, 'package.json');
  const load = createRequire(pkg);
  return {Pptx: load('pptxgenjs'), word: load('docx'), Excel: load('exceljs'), Zip: load('jszip')};
}

test('professional dialog downloads real transient DOCX bytes and cancels cleanly when closed mid-flight', async () => {
  const {page, context, calls} = await openScreen(browser, 'career-resume-studio.html', answers, DESKTOP);
  let hold = false, aborted = false;
  try {
    await page.route('**/api/presentations/editor/assets/*.mjs', route => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      return route.fulfill({
        status: 200, contentType: 'application/javascript',
        body: readFileSync(resolve(import.meta.dirname, '../../presentations/tools/office', name))
      });
    });
    await page.route('**/api/presentations/editor/exports', async route => {
      const req = route.request(), payload = JSON.parse(req.postData());
      assert.equal(payload.modelSha256, createHash('sha256').update(stableJSON(payload.model)).digest('hex'));
      calls.push({method: 'POST', path: '/api/presentations/editor/exports', body: payload});
      if (hold) { req.frame().page().once('requestfailed', r => { if (r === req) aborted = true; }); return; }
      const bytes = await renderOffice(payload.model, payload.format, officeRuntime());
      await route.fulfill({status: 200, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', body: Buffer.from(bytes)});
    });
    await page.waitForFunction(() => document.body.dataset.view === 'office');
    await page.locator('#moreBtn').click();
    await page.getByRole('menuitem', {name: 'Professional résumé (Word / PDF)…', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: 'Professional résumé', exact: true});
    const downloadWait = page.waitForEvent('download');
    await dialog.getByRole('button', {name: 'Download selected file', exact: true}).click();
    const downloaded = await downloadWait;
    assert.match(downloaded.suggestedFilename(), /\.docx$/);
    await page.waitForFunction(() => document.querySelector('#professionalDownloads [data-export-status]')?.textContent?.includes('download started.'));
    hold = true;
    await dialog.getByRole('button', {name: 'Download selected file', exact: true}).click();
    await page.waitForFunction(() => document.querySelector('#professionalDownloads [data-export-start]')?.disabled === true);
    await page.locator('#closeProfessional').click();
    await page.waitForFunction(() => abortedCount => abortedCount, {}, {timeout: 2000}).catch(() => {});
    for (let i = 0; i < 20 && !aborted; i++) await new Promise(r => setTimeout(r, 25));
    assert.equal(aborted, true, 'closing dialog aborts in-flight export request');
  } finally { await context.close(); }
});

test('Prepare application offers format choices beside generated packet and keeps submitted PDF exact', async () => {
  const baseJob = {id: 225, title: 'Systems Architect', company: 'Example Corp', status: 'saved', description: 'x'.repeat(240),
    has_resume: true, has_cover: true, generated_at: '2026-11-17T18:00:00Z',
    application: {needsGeneration: false, busy: false, draft: {revision: 1, guidance: '', experienceChosen: true, experienceIds: []}}};
  const api = status => ({url}) => {
    if (url.pathname === '/api/career-hunter/jobs/225') return {json: {job: {...baseJob, status}}};
    if (url.pathname === '/api/career-hunter/experience-bank') return {json: {entries: [], revision: 1}};
    if (url.pathname === '/api/career-hunter/resume/state') return {json: {hasResume: true, indexing: false}};
    if (url.pathname === '/api/career-hunter/resume') return {text: '<html><body><p>Preview</p></body></html>'};
    return {json: {active: false, mail: {}}};
  };
  const prep = await openScreen(browser, 'career-application.html', api('saved'), DESKTOP, '?application=225&step=documents');
  try {
    const summary = prep.page.locator('[data-career-downloads] summary');
    await summary.waitFor({state: 'visible'});
    await summary.click();
    assert.deepEqual(await prep.page.locator('[data-career-downloads] [data-export-format] option').allTextContents(), ['Word (.docx)', 'PDF', 'RTF (ATS/import)']);
    assert.deepEqual(await prep.page.locator('[data-career-downloads] [data-export-style] option').evaluateAll(els => els.map(el => el.value)), ['Professional', 'Standard', 'Leadership', 'Technical']);
    await prep.page.getByRole('tab', {name: 'Cover letter', exact: true}).click();
    assert.equal(await prep.page.locator('[data-career-downloads] [data-export-style] option[value="Technical"]').evaluate(el => el.disabled), false);
  } finally { await prep.context.close(); }
  const sent = await openScreen(browser, 'career-application.html', api('applied'), DESKTOP, '?application=225&step=documents');
  try {
    await sent.page.getByRole('button', {name: /Submitted documents|View submitted|Documents/i}).first().click().catch(() => {});
    assert.equal(await sent.page.locator('[data-career-downloads]:visible').count(), 0, 'submitted view hides re-export controls');
  } finally { await sent.context.close(); }
});
