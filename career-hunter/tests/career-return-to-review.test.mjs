/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.19: prove edited tailored résumés sync documentGeneration via markEdited(), acceptCurrent() unlocks outdated-draft review without forced regeneration while preserving missingRoles/lock/revision guards, My résumé always offers Review documents for any tailored job (desktop and phone), and Prepare application provides clickable Tailor/Review step navigation.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { playwright, tools, ORIGIN, DESKTOP, PHONE } from './helpers/ux-page.mjs';

const require = createRequire(import.meta.url);
const draft = require('../lib/career-application-draft');
const board = require('../lib/career-board-state');
const bank = require('../lib/career-experience-bank');
const queue = require('../lib/career-submission-queue');

const API = '/api/career-hunter';

function makeStore(t, { withCurrentRole = true, resumeIncludesCurrent = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'career-return-review-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const profile = {
    profile: { name: 'Jordan Rivera' },
    roles: withCurrentRole ? [{ title: 'Principal Engineer', org: 'Harbor Systems', span: '2023 - Present', current: true }] : [],
  };
  writeFileSync(join(dir, 'career_db.json'), JSON.stringify(profile));
  const pktDir = join(dir, 'applications', 'acme__81');
  mkdirSync(pktDir, { recursive: true });
  const resumePath = join(pktDir, 'Resume_ATS.pdf');
  const coverPath = join(pktDir, 'CoverLetter.pdf');
  writeFileSync(resumePath, '%PDF-1.4 initial resume');
  writeFileSync(coverPath, '%PDF-1.4 initial cover');
  const packet = {
    posting_id: 81,
    company: 'Acme Corp',
    title: 'Staff Engineer',
    generated: {
      resume: {
        headline: 'Staff Platform Engineer',
        summary: 'Initial tailored summary for Acme Corp.',
        experience: resumeIncludesCurrent
          ? [{ title: 'Principal Engineer', org: 'Harbor Systems', span: '2023 - Present', bullets: ['Built platform services.'] }]
          : [{ title: 'Earlier Engineer', org: 'OldCo', span: '2018 - 2021', bullets: ['Built APIs.'] }],
        skills: ['TypeScript', 'Rust'],
      },
      cover: { greeting: 'Dear Hiring Team,', paragraphs: ['Excited about Acme Corp.'], closing: 'Sincerely,' },
    },
    profile_snapshot: profile,
  };
  writeFileSync(join(pktDir, 'application.json'), JSON.stringify(packet, null, 2));
  const job = {
    id: 81, title: 'Staff Engineer', company: 'Acme Corp', location: 'Remote', status: 'generated',
    url: 'https://jobs.example.com/81', description: 'Lead distributed systems at Acme Corp. '.repeat(10),
    has_resume: true, has_cover: true, resume_path: resumePath, cover_path: coverPath,
    generated_at: '2026-11-19T12:00:00Z',
  };
  return { dir, pktDir, job, packet };
}

function finishGeneration(dir, id, requestId, phase = 'ready') {
  board.updateBoardState(dir, id, { requestId, phase, completedAt: '2026-11-19T12:01:00Z' });
}

test('markEdited syncs documentGeneration.inputsHash, clears outdated/failed state, preserves experienceChosen, and keeps missingRoles truthful', (t) => {
  const { dir, pktDir, job, packet } = makeStore(t);
  const input = { revision: 0, guidance: 'Highlight platform leadership.', experienceIds: [], experienceRevision: bank.read(dir).revision, experienceChosen: true };
  draft.begin(dir, 81, job, input, 'req-1', true);
  finishGeneration(dir, 81, 'req-1', 'ready');
  assert.equal(draft.view(dir, 81, job).needsGeneration, false);

  // Main résumé changes after generation -> documents become outdated.
  writeFileSync(join(dir, 'career_db.json'), JSON.stringify({
    profile: { name: 'Jordan Rivera', headline: 'Updated Main' },
    roles: [{ title: 'Principal Engineer', org: 'Harbor Systems', span: '2023 - Present', current: true }],
  }));
  assert.equal(draft.view(dir, 81, job).documentsOutdated, true);
  assert.equal(draft.view(dir, 81, job).needsGeneration, true);

  // Saving an edited tailored résumé calls markEdited().
  const updated = draft.markEdited(dir, 81);
  assert.ok(updated?.editedAt);
  const afterEdit = draft.view(dir, 81, job);
  assert.equal(afterEdit.documentsOutdated, false);
  assert.equal(afterEdit.needsGeneration, false);
  assert.equal(afterEdit.draft.experienceChosen, true, 'experienceChosen is preserved');
  assert.doesNotThrow(() => draft.assertReady(dir, 81, job));

  // If the edited résumé genuinely deleted a required current role, missingRoles still blocks truthfully.
  packet.generated.resume.experience = [{ title: 'Earlier Engineer', org: 'OldCo', span: '2018 - 2021', bullets: ['Built APIs.'] }];
  writeFileSync(join(pktDir, 'application.json'), JSON.stringify(packet, null, 2));
  draft.markEdited(dir, 81);
  const withMissing = draft.view(dir, 81, job);
  assert.equal(withMissing.documentsOutdated, false);
  assert.equal(withMissing.missingRoles.length, 1);
  assert.equal(withMissing.needsGeneration, true);
});

test('acceptCurrent clears documentsOutdated safely while enforcing missingRoles, cover presence, revision, and lock checks', (t) => {
  const { dir, job } = makeStore(t);
  const input = { revision: 0, guidance: '', experienceIds: [], experienceRevision: bank.read(dir).revision, experienceChosen: true };
  draft.begin(dir, 81, job, input, 'req-1', true);
  finishGeneration(dir, 81, 'req-1', 'ready');

  writeFileSync(join(dir, 'career_db.json'), JSON.stringify({
    profile: { name: 'Jordan Rivera', summary: 'Edited main profile' },
    roles: [{ title: 'Principal Engineer', org: 'Harbor Systems', span: '2023 - Present', current: true }],
  }));
  const outdated = draft.view(dir, 81, job);
  assert.equal(outdated.documentsOutdated, true);

  // Rejects bad fields, stale revision, missing cover letter.
  assert.throws(() => draft.acceptCurrent(dir, 81, job, { acceptCurrent: true, revision: outdated.draft.revision, extra: 1 }), { code: 'draft_invalid' });
  assert.throws(() => draft.acceptCurrent(dir, 81, job, { acceptCurrent: true, revision: outdated.draft.revision + 5 }), { code: 'draft_conflict' });
  assert.throws(() => draft.acceptCurrent(dir, 81, { ...job, has_cover: false }, { acceptCurrent: true, revision: outdated.draft.revision }), { code: 'documents_unavailable' });

  const accepted = draft.acceptCurrent(dir, 81, job, { acceptCurrent: true, revision: outdated.draft.revision });
  assert.equal(accepted.documentsOutdated, false);
  assert.equal(accepted.needsGeneration, false);
  assert.equal(accepted.draft.experienceChosen, true);

  // Locked application refuses acceptCurrent.
  queue.enqueue(dir, { approved: true, postingId: 81, url: job.url, resumeSha256: 'a'.repeat(64), coverSha256: 'b'.repeat(64), profileSha256: 'c'.repeat(64) });
  assert.throws(() => draft.acceptCurrent(dir, 81, job, { acceptCurrent: true, revision: accepted.draft.revision }), { code: 'application_locked' });

  // Missing required role refuses acceptCurrent.
  const missingStore = makeStore(t, { withCurrentRole: true, resumeIncludesCurrent: false });
  const rev = draft.view(missingStore.dir, 81, missingStore.job).draft.revision;
  assert.throws(() => draft.acceptCurrent(missingStore.dir, 81, missingStore.job, { acceptCurrent: true, revision: rev }), { code: 'roles_missing' });
});

test('compiled routes wire markEdited on POST /resume/save and acceptCurrent on POST /jobs/:id/status', () => {
  const studioRoute = readFileSync(new URL('../routes/career-resume-studio-routes.js', import.meta.url), 'utf8');
  const boardRoute = readFileSync(new URL('../routes/career-board-routes.js', import.meta.url), 'utf8');
  assert.match(studioRoute, /career-application-draft['"]\)\.markEdited\(/);
  assert.match(boardRoute, /acceptCurrent\s*===\s*true\s*\?\s*['"]acceptCurrent['"]/);
});

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function handleHarnessRoute(route, store, state) {
  const req = route.request(), url = new URL(req.url()), p = url.pathname;
  if (url.origin !== ORIGIN) return route.abort();
  if (p === `${API}/board-native`) {
    const file = /^[1-9]\d*$/.test(url.searchParams.get('application') || '') ? 'career-application.html' : 'career-job-lists.html';
    return route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(tools, file)) });
  }
  if (p === `${API}/resume-studio`) return route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(tools, 'career-resume-studio.html')) });
  const asset = p.match(/^\/api\/career-hunter\/static\/([\w.-]+)$/);
  if (asset && existsSync(join(tools, asset[1]))) return route.fulfill({ status: 200, contentType: asset[1].endsWith('.css') ? 'text/css' : 'application/javascript', body: readFileSync(join(tools, asset[1])) });
  if (p === '/shared/ui/js/surface-bridge-client.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export function createSurfaceBridgeClient(){ return { attach(){}, emitContext(){} }; }' });
  if (p === '/shared/ui/js/document-handoff.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export function registerDocumentSession(){}' });
  if (/^\/(shared|cockpit|ui)\//.test(p) || p === '/api/artifacts/send-to.js') return route.fulfill({ status: 200, contentType: p.endsWith('.css') ? 'text/css' : 'application/javascript', body: '' });
  return handleApiRoute(route, req, url, store, state);
}

function handleApiRoute(route, req, url, store, state) {
  const p = url.pathname, json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (p === '/api/auth/user') return json({ authenticated: true, tenant: 't1', principal_id: 'p1', sub: 'jordan' });
  if (p === '/api/ui/profile') return json({ profile: { ribbon: { items: [] } } });
  if (p === `${API}/resume/state`) return json({ hasResume: true, roles: 1, indexing: false });
  if (p === `${API}/experience-bank`) return json(bank.read(store.dir));
  if (p === `${API}/jobs/stats`) return json({ saved: 1, byStatus: [] });
  if (p === `${API}/jobs`) return json({ jobs: [{ id: 81, title: store.job.title, company: store.job.company, has_resume: true, has_cover: true }], exhausted: true });
  if (p === `${API}/jobs/81` && req.method() === 'GET') return json({ job: { ...store.job, board: board.readBoardState(store.dir).jobs[81] || {}, application: draft.view(store.dir, 81, store.job) } });
  if (p === `${API}/jobs/81/status` && req.method() === 'POST') {
    const body = req.postDataJSON();
    if (body?.draft?.acceptCurrent === true) { state.accepts += 1; return json({ ok: true, application: draft.acceptCurrent(store.dir, 81, store.job, body.draft) }); }
    if (body?.draft?.restore === true) return json({ ok: true, application: draft.restore(store.dir, 81, store.job, body.draft) });
    if (body?.draft) return json({ ok: true, application: draft.save(store.dir, 81, store.job, body.draft) });
    return json({ ok: true });
  }
  if (p === `${API}/jobs/81/generate` && req.method() === 'POST') { state.generates += 1; return json({ ok: true, requestId: 'unexpected' }, 202); }
  if (p === `${API}/resume/doc`) {
    if (url.searchParams.get('id') === 'master') return json({ resume: { headline: 'Main Engineer', summary: 'Main summary.', experience: [] }, cover: {}, meta: { master: true, name: 'Jordan Rivera' }, revision: 'rev-main-1' });
    return json({ resume: state.doc.generated.resume, cover: state.doc.generated.cover, meta: { name: 'Jordan Rivera', postingId: 81, company: 'Acme Corp', title: 'Staff Engineer' } });
  }
  if (p === `${API}/resume/save` && req.method() === 'POST') {
    const body = req.postDataJSON();
    state.saves += 1; state.doc.generated = { resume: body.resume, cover: body.cover };
    writeFileSync(join(store.pktDir, 'application.json'), JSON.stringify(state.doc, null, 2));
    draft.markEdited(store.dir, 81);
    return json({ ok: true });
  }
  if (p === `${API}/resume`) return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><body><h1>Jordan Rivera</h1><p>${state.doc.generated.resume.summary || ''}</p></body></html>` });
  if (p === '/api/apply-operator/workers') return json({ workers: [] });
  return json({ error: 'unmocked ' + p }, 404);
}

async function openHarness(t, size, { resumeIncludesCurrent = true } = {}) {
  const store = makeStore(t, { withCurrentRole: true, resumeIncludesCurrent });
  const input = { revision: 0, guidance: '', experienceIds: [], experienceRevision: bank.read(store.dir).revision, experienceChosen: true };
  draft.begin(store.dir, 81, store.job, input, 'req-1', true);
  finishGeneration(store.dir, 81, 'req-1', 'ready');
  writeFileSync(join(store.dir, 'career_db.json'), JSON.stringify({
    profile: { name: 'Jordan Rivera', headline: 'Updated after generation' },
    roles: [{ title: 'Principal Engineer', org: 'Harbor Systems', span: '2023 - Present', current: true }],
  }));
  const state = { saves: 0, generates: 0, accepts: 0, doc: JSON.parse(readFileSync(join(store.pktDir, 'application.json'), 'utf8')) };
  const context = await browser.newContext({ ...size, locale: 'en-US', timezoneId: 'UTC' });
  t.after(() => context.close());
  await context.route('**/*', (route) => handleHarnessRoute(route, store, state));
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return { page, store, state, errors };
}

test('browser: editing a tailored résumé after a main-résumé change saves via markEdited and lands directly on 2 · Review documents without regeneration', async (t) => {
  const { page, state, errors } = await openHarness(t, DESKTOP);
  await page.goto(`${ORIGIN}${API}/resume-studio?id=81&application=1`, { waitUntil: 'load' });
  const summary = page.locator('#sheet .summary[contenteditable="true"]');
  await summary.waitFor();
  await summary.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Hand-edited tailored summary for Acme Corp.');
  await page.getByRole('button', { name: 'Save & return to application' }).click();

  await page.getByRole('heading', { name: 'Review the documents for this job' }).waitFor();
  assert.equal((await page.locator('.steps [aria-current="step"]').innerText()).trim(), '2 · Review documents');
  assert.equal(state.saves, 1);
  assert.equal(state.generates, 0, 'must never force regeneration');
  await page.frameLocator('.preview iframe').getByText('Hand-edited tailored summary for Acme Corp.').waitFor();
  assert.deepEqual(errors, []);
});

for (const [label, size] of [['desktop', DESKTOP], ['phone', PHONE]]) {
  test(`browser (${label}): picking a tailored job from My résumé without ?application=1 shows Review documents, saves edits, and opens 2 · Review documents`, async (t) => {
    const { page, state, errors } = await openHarness(t, size);
    await page.goto(`${ORIGIN}${API}/resume-studio`, { waitUntil: 'load' });
    await page.locator('#docIdentity[data-doc-kind="main"]').waitFor();
    assert.equal(await page.locator('#reviewApplication').isVisible(), false, 'hidden on main résumé');

    await page.locator('#pick option[value="81"]').waitFor({ state: 'attached' });
    await page.locator('#pick').selectOption('81');
    await page.locator('#docIdentity[data-doc-kind="tailored"]').waitFor();

    const reviewBtn = page.locator('#reviewApplication');
    assert.equal(await reviewBtn.isVisible(), true, 'Review documents button visible for any tailored job');
    assert.ok((await reviewBtn.boundingBox()).height >= 44, '44px touch target');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'zero horizontal overflow');

    const summary = page.locator('#sheet .summary[contenteditable="true"]');
    await summary.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(`Edited via My résumé on ${label}.`);

    await reviewBtn.click();
    await page.getByRole('heading', { name: 'Review the documents for this job' }).waitFor();
    assert.equal((await page.locator('.steps [aria-current="step"]').innerText()).trim(), '2 · Review documents');
    assert.equal(state.saves, 1, 'auto-saved unsaved edits before returning');
    assert.equal(state.generates, 0, 'never regenerated');
    assert.deepEqual(errors, []);
  });
}

test('browser: Step 1 with documentsOutdated opens 2 · Review documents via Review current documents AND via clickable step bar without regenerating', async (t) => {
  // Path A: click "Review current documents" button in footer
  const a = await openHarness(t, DESKTOP);
  await a.page.goto(`${ORIGIN}${API}/board-native?view=queue&application=81`, { waitUntil: 'load' });
  await a.page.getByRole('heading', { name: 'What should this application emphasize?' }).waitFor();
  assert.equal((await a.page.locator('.steps [aria-current="step"]').innerText()).trim(), '1 · Tailor');
  await a.page.getByRole('button', { name: 'Review current documents' }).click();
  await a.page.getByRole('heading', { name: 'Review the documents for this job' }).waitFor();
  assert.equal((await a.page.locator('.steps [aria-current="step"]').innerText()).trim(), '2 · Review documents');
  assert.equal(a.state.accepts, 1);
  assert.equal(a.state.generates, 0);
  assert.deepEqual(a.errors, []);

  // Path B: click "2 · Review documents" directly in the step bar
  const b = await openHarness(t, DESKTOP);
  await b.page.goto(`${ORIGIN}${API}/board-native?view=queue&application=81`, { waitUntil: 'load' });
  await b.page.getByRole('heading', { name: 'What should this application emphasize?' }).waitFor();
  await b.page.locator('.steps').getByRole('button', { name: '2 · Review documents' }).click();
  await b.page.getByRole('heading', { name: 'Review the documents for this job' }).waitFor();
  assert.equal((await b.page.locator('.steps [aria-current="step"]').innerText()).trim(), '2 · Review documents');
  assert.equal(b.state.accepts, 1);
  assert.equal(b.state.generates, 0);
  // Step 1 is also clickable from Step 2
  await b.page.locator('.steps').getByRole('button', { name: '1 · Tailor' }).click();
  await b.page.getByRole('heading', { name: 'What should this application emphasize?' }).waitFor();
  assert.deepEqual(b.errors, []);
});

test('browser: Step 1 with missing required current role keeps step 2 locked and offers Edit documents beside Generate', async (t) => {
  const { page, errors } = await openHarness(t, DESKTOP, { resumeIncludesCurrent: false });
  await page.goto(`${ORIGIN}${API}/board-native?view=queue&application=81`, { waitUntil: 'load' });
  await page.locator('#rolesLeftOut').waitFor();
  assert.equal(await page.locator('.steps').getByRole('button', { name: '2 · Review documents' }).count(), 0, 'step 2 stays unclickable when required role is missing');
  assert.equal(await page.getByRole('button', { name: 'Edit documents' }).isVisible(), true, 'Edit documents offered beside Generate');
  assert.equal(await page.getByRole('button', { name: 'Review current documents' }).count(), 0);
  assert.deepEqual(errors, []);
});
