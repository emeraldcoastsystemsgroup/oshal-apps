/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | End-to-end SQL, HTTP and Chromium (1440x900 + 412x915 touch) proofs for pdf-workbench 0.4.2 parity entries CREATE-TOOL-PDF-WORKBENCH-08, -05 and -03.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { fixture } from '../fixtures/fixture.mjs';
import { requireRuntime } from '../fixtures/runtime.mjs';
import { uploadAndCreate, closeLayers, leaveMode } from './workbench-ui.mjs';

const { chromium } = requireRuntime('playwright');

async function jsonReq(baseUrl, path, init = {}) {
  const res = await fetch(baseUrl + path, {
    ...init,
    headers: init.body instanceof FormData ? init.headers : { 'Content-Type': 'application/json', ...init.headers },
  });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

async function waitJob(baseUrl, jobId) {
  for (let i = 0; i < 120; i += 1) {
    const { body } = await jsonReq(baseUrl, `/api/pdf-workbench/jobs/${jobId}`);
    if (body?.job?.state === 'ready') return body.job;
    if (['failed', 'cancelled'].includes(body?.job?.state)) assert.fail(`Job ${jobId} failed: ${JSON.stringify(body)}`);
    await pause(100);
  }
  assert.fail(`Job ${jobId} timed out`);
}

async function uploadFixturePdf(baseUrl, filePath, title) {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), `${title}.pdf`);
  form.append('title', title);
  form.append('requestKey', randomUUID());
  const { status, body } = await jsonReq(baseUrl, '/api/pdf-workbench/sources/upload', { method: 'POST', body: form });
  assert.equal(status, 200, JSON.stringify(body));
  return body.source;
}

test('CREATE-TOOL-PDF-WORKBENCH-08, -05, -03 backend routes: pdf-export link, pdf-delete-source guard, update-annotation revision, and pdf-go-to-page navigate', async (t) => {
  const f = await fixture();
  t.after(() => f.close());

  const srcUsed = await uploadFixturePdf(f.url, join(f.directory, 'first.pdf'), 'Used contract');
  const srcUnused = await uploadFixturePdf(f.url, join(f.directory, 'first.pdf'), 'Unused original');

  const created = await jsonReq(f.url, '/api/pdf-workbench/documents', {
    method: 'POST',
    body: JSON.stringify({ source: srcUsed.id, title: 'Parity Contract', requestKey: randomUUID() }),
  });
  assert.equal(created.status, 200);
  const docId = created.body.document.id;
  const [p1, p2] = created.body.document.model.pages.map((p) => p.id);

  // pdf-delete-source refuses used source and deletes unused source.
  const delUsed = await jsonReq(f.url, `/api/pdf-workbench/sources/${srcUsed.id}`, { method: 'DELETE' });
  assert.equal(delUsed.status, 409);
  assert.equal(delUsed.body.error, 'pdf_source_retained_by_history');

  const delUnused = await jsonReq(f.url, `/api/pdf-workbench/sources/${srcUnused.id}`, { method: 'DELETE' });
  assert.equal(delUnused.status, 200);
  assert.equal(delUnused.body.deleted, true);

  // pdf-export returns guarded downloadUrl serving exact PDF bytes and enforces document.export.
  const exp = await jsonReq(f.url, `/api/pdf-workbench/documents/${docId}/export`, {
    method: 'POST',
    body: JSON.stringify({ id: docId, revision: 1 }),
  });
  assert.equal(exp.status, 200, JSON.stringify(exp.body));
  assert.equal(exp.body.ok, true);
  assert.equal(exp.body.documentId, docId);
  assert.equal(exp.body.revision, 1);
  assert.equal(exp.body.downloadUrl, `/api/pdf-workbench/documents/${docId}/revisions/1/content`);
  assert.equal(exp.body.filename, 'Parity-Contract.pdf');

  const dl = await fetch(f.url + exp.body.downloadUrl);
  assert.equal(dl.status, 200);
  const pdfBuf = Buffer.from(await dl.arrayBuffer());
  assert.equal(pdfBuf.subarray(0, 5).toString(), '%PDF-');
  assert.equal(pdfBuf.length, exp.body.bytes);
  assert.equal(createHash('sha256').update(pdfBuf).digest('hex'), exp.body.sha256);

  f.states.get('alice').add('document.export');
  const expDenied = await jsonReq(f.url, `/api/pdf-workbench/documents/${docId}/export`, { method: 'POST', body: JSON.stringify({}) });
  assert.equal(expDenied.status, 403);
  f.states.get('alice').delete('document.export');

  // pdf-go-to-page validates page bounds and returns openUrl + surfaceOp.
  const nav = await jsonReq(f.url, `/api/pdf-workbench/documents/${docId}/navigate?page=2`);
  assert.equal(nav.status, 200, JSON.stringify(nav.body));
  assert.equal(nav.body.page, 2);
  assert.equal(nav.body.pageId, p2);
  assert.equal(nav.body.totalPages, 2);
  assert.equal(nav.body.openUrl, `/api/pdf-workbench/app?document=${docId}&page=2`);
  assert.equal(nav.body.surfaceOp.name, 'pdf:go-to-page');
  assert.equal((await jsonReq(f.url, `/api/pdf-workbench/documents/${docId}/navigate?page=5`)).status, 400);

  // update-annotation moves and edits a note by id and produces a new revision.
  const noteId = randomUUID();
  const addJob = await jsonReq(f.url, `/api/pdf-workbench/documents/${docId}/revisions`, {
    method: 'POST',
    body: JSON.stringify({
      baseRevision: 1,
      requestKey: randomUUID(),
      operations: [{ op: 'annotate', annotation: { id: noteId, page: p1, kind: 'text', rect: [20, 20, 140, 60], text: 'Draft note', color: 'ffcc00' } }],
    }),
  });
  assert.equal(addJob.status, 202);
  await waitJob(f.url, addJob.body.job.id);

  const updJob = await jsonReq(f.url, `/api/pdf-workbench/documents/${docId}/revisions`, {
    method: 'POST',
    body: JSON.stringify({
      baseRevision: 2,
      requestKey: randomUUID(),
      operations: [{ op: 'update-annotation', id: noteId, properties: { text: 'Moved by concierge', rect: [40, 80, 160, 120], color: '2563eb' } }],
    }),
  });
  assert.equal(updJob.status, 202);
  await waitJob(f.url, updJob.body.job.id);

  const latest = (await jsonReq(f.url, `/api/pdf-workbench/documents/${docId}`)).body.document;
  assert.equal(latest.revision, 3);
  assert.equal(latest.model.annotations.length, 1);
  assert.equal(latest.model.annotations[0].text, 'Moved by concierge');
  assert.deepEqual(latest.model.annotations[0].rect, [40, 80, 160, 120]);
});

test('desktop 1440x900: annotations list edit/move/delete + reader zoom, fit width, page jump, selectable text, print and surface bridge go-to-page', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(`${f.url}/api/pdf-workbench/app`);
  await page.locator('[data-pdf-view]').first().waitFor();
  await uploadAndCreate(page, join(f.directory, 'first.pdf'), 'Reader source', 'Reader Doc');
  await page.waitForFunction(() => document.querySelectorAll('#pages > .page').length === 2);

  // Add a highlight and a text note via Annotate mode, then save revision 2.
  const stage = page.locator('[data-pdf-stage]').first();
  const stageBox = await stage.boundingBox();
  await page.locator('.pdf-mode[data-mode="annotate"]').click();
  await page.locator('.pdf-strip [data-pdf-pick="highlight"]').click();
  await page.mouse.move(stageBox.x + 30, stageBox.y + 40);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + 160, stageBox.y + 60, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('1 unsaved operation'));

  await page.locator('.pdf-strip [data-pdf-pick="note"]').click();
  await page.mouse.click(stageBox.x + 120, stageBox.y + 120);
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('2 unsaved operation'));

  await page.locator('#save').click();
  await page.waitForFunction(() => document.getElementById('revision').textContent.includes('Saved revision 2'), null, { timeout: 60000 });

  // Open Annotations list from Annotate strip List button: edit note, move note, delete highlight.
  await page.locator('.pdf-strip').getByRole('button', { name: 'List' }).click();
  const sheet = page.locator('dialog.ds-layer[open][data-pdf-sheet="annotations"]');
  await sheet.waitFor();
  assert.equal(await sheet.locator('.pdf-ann-row').count(), 2);

  // Edit the text note (second row).
  const noteRow = sheet.locator('.pdf-ann-row').nth(1);
  await noteRow.getByRole('button', { name: /^Edit annotation/ }).click();
  await noteRow.getByRole('textbox', { name: 'Annotation text' }).fill('Edited via list');
  await noteRow.getByRole('button', { name: 'Apply edit' }).click();
  assert.match(await sheet.locator('.pdf-ann-row').nth(1).textContent(), /Edited via list/);

  // Move the text note.
  const movedRow = sheet.locator('.pdf-ann-row').nth(1);
  await movedRow.getByRole('button', { name: /^Move annotation/ }).click();
  await movedRow.getByRole('button', { name: 'Right' }).click();

  // Delete the highlight (first row).
  await sheet.locator('.pdf-ann-row').first().getByRole('button', { name: /^Delete annotation/ }).click();
  assert.equal(await sheet.locator('.pdf-ann-row').count(), 1);
  await closeLayers(page);
  await leaveMode(page);

  await page.locator('#save').click();
  await page.waitForFunction(() => document.getElementById('revision').textContent.includes('Saved revision 3'), null, { timeout: 60000 });

  const docId = new URL(page.url()).searchParams.get('document');
  const saved = (await jsonReq(f.url, `/api/pdf-workbench/documents/${docId}`)).body.document;
  assert.equal(saved.model.annotations.length, 1);
  assert.equal(saved.model.annotations[0].kind, 'text');
  assert.equal(saved.model.annotations[0].text, 'Edited via list');

  // Reader bar: zoom in, fit width, page jump, selectable text layer, print, and surface-bridge go-to-page.
  await page.getByRole('button', { name: 'Zoom in' }).click();
  assert.equal(await page.locator('body').getAttribute('data-pdf-zoom'), '125');
  assert.equal(await page.locator('body').getAttribute('data-pdf-fit-width'), 'false');
  await page.getByRole('button', { name: 'Fit width' }).click();
  assert.equal(await page.locator('body').getAttribute('data-pdf-zoom'), '100');
  assert.equal(await page.locator('body').getAttribute('data-pdf-fit-width'), 'true');

  const jump = page.getByRole('spinbutton', { name: 'Jump to page' });
  await jump.fill('2');
  await jump.press('Enter');
  assert.equal(await page.locator('.pdf-pager-label').textContent(), 'Page 2 of 2');
  assert.equal(new URL(page.url()).searchParams.get('page'), '2');

  await page.getByRole('button', { name: 'Select text' }).click();
  await page.locator('.pdf-text-layer .pdf-text-word').first().waitFor({ timeout: 20000 });
  const layerText = await page.locator('.pdf-text-layer').first().textContent();
  assert.match(layerText, /FIRST/i);

  // Spy on window.print and click Print button.
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; });
  await page.getByRole('button', { name: 'Print PDF' }).click();
  assert.equal(await page.evaluate(() => window.__printed), 1);

  // Concierge surface-bridge custom op jumps reader back to page 1.
  await page.evaluate((id) => {
    document.dispatchEvent(new CustomEvent('surface-bridge:custom', {
      detail: { name: 'pdf:go-to-page', data: { documentId: id, page: 1 } },
    }));
  }, docId);
  assert.equal(await page.locator('.pdf-pager-label').textContent(), 'Page 1 of 2');
  assert.deepEqual(errors, []);
});

test('phone 412x915 touch: ?page=2 deep jump, zero overflow, pinch zoom, long-press sentence copy and Annotations sheet', async (t) => {
  const f = await fixture();
  t.after(() => f.close());

  const src = await uploadFixturePdf(f.url, join(f.directory, 'first.pdf'), 'Phone reader');
  const created = await jsonReq(f.url, '/api/pdf-workbench/documents', {
    method: 'POST',
    body: JSON.stringify({ source: src.id, title: 'Mobile Guide', requestKey: randomUUID() }),
  });
  const docId = created.body.document.id;
  const pageId = created.body.document.model.pages[0].id;
  const addJob = await jsonReq(f.url, `/api/pdf-workbench/documents/${docId}/revisions`, {
    method: 'POST',
    body: JSON.stringify({
      baseRevision: 1,
      requestKey: randomUUID(),
      operations: [{ op: 'annotate', annotation: { id: randomUUID(), page: pageId, kind: 'highlight', rect: [20, 20, 120, 45], color: 'ffcc00' } }],
    }),
  });
  await waitJob(f.url, addJob.body.job.id);

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(`${f.url}/api/pdf-workbench/app?document=${docId}&page=2`);
  await page.locator('[data-pdf-view="document"]').waitFor({ timeout: 60000 });
  assert.equal(await page.locator('.pdf-pager-label').textContent(), 'Page 2 of 2');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'zero horizontal overflow at 412px');

  // Jump to page 1.
  const jump = page.getByRole('spinbutton', { name: 'Jump to page' });
  await jump.fill('1');
  await jump.press('Enter');
  assert.equal(await page.locator('.pdf-pager-label').textContent(), 'Page 1 of 2');

  // Pinch-to-zoom via two-finger touch event updates zoom percentage, then Fit resets to 100%.
  await page.evaluate(() => {
    const host = document.getElementById('pages');
    const mk = (id, x, y) => ({ identifier: id, clientX: x, clientY: y, target: host });
    const start = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(start, 'touches', { value: [mk(1, 100, 300), mk(2, 200, 300)] });
    host.dispatchEvent(start);
    const move = new Event('touchmove', { bubbles: true, cancelable: true });
    Object.defineProperty(move, 'touches', { value: [mk(1, 75, 300), mk(2, 225, 300)] });
    host.dispatchEvent(move);
    const end = new Event('touchend', { bubbles: true, cancelable: true });
    Object.defineProperty(end, 'touches', { value: [] });
    host.dispatchEvent(end);
  });
  assert.equal(await page.locator('body').getAttribute('data-pdf-zoom'), '150');
  await page.getByRole('button', { name: 'Fit width' }).tap();
  assert.equal(await page.locator('body').getAttribute('data-pdf-zoom'), '100');

  // Long-press on page 1 word selects text and Copy copies it.
  const textBtn = page.locator('[data-pdf-stage]').first().getByRole('button', { name: /^Text: FIRST PAGE 1/ });
  await textBtn.waitFor();
  const box = await textBtn.boundingBox();
  await page.evaluate(({ x, y }) => {
    const stage = document.querySelector('[data-pdf-stage]');
    stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 7, clientX: x, clientY: y }));
  }, { x: box.x + 12, y: box.y + box.height / 2 });
  await page.locator('.pdf-word-bar').waitFor({ timeout: 10000 });
  await page.locator('.pdf-word-bar').getByRole('button', { name: 'Select full line' }).click();
  await page.locator('.pdf-word-bar').getByRole('button', { name: 'Copy selected text' }).click();
  const copied = await page.locator('body').getAttribute('data-pdf-copied-text');
  assert.match(copied ?? '', /FIRST/i);

  // Open More -> Annotations… and delete the highlight.
  await page.getByRole('button', { name: 'More', exact: true }).tap();
  await page.getByRole('menuitem', { name: 'Annotations…' }).tap();
  const sheet = page.locator('dialog.ds-layer[open][data-pdf-sheet="annotations"]');
  await sheet.waitFor();
  assert.equal(await sheet.locator('.pdf-ann-row').count(), 1);
  await sheet.getByRole('button', { name: 'Delete annotation 1' }).tap();
  assert.equal(await sheet.locator('.pdf-ann-row').count(), 0);
  await closeLayers(page);
  assert.deepEqual(errors, []);
});
