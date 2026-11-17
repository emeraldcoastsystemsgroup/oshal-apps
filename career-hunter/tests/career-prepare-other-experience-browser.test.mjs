/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.1 (Roger, 2026-11-16: "when i get to the application screen it fully generated my resume without asking me about adding in my optional addendum"; "when i click prepare application i still need the option of 'Other experience · optional — Agentic Federal | oshal (open-source)' to be selectable. this is not a choice in bulk edit"). The shipped My jobs and Prepare application pages (career-job-lists.html with career-jobs-table.js and career-bulk-queue.js; career-application.html at the address the board route serves it) in Chromium at 1440x900 and at 412x915 with touch, over a fixture Career for a made-up person whose Other experience is an open-source project (the saved-portfolio entry, "Lantern") and a volunteer entry, and who prepared their last application with Lantern. (1) Prepare application on a saved job moves it and opens step 1 · Tailor with both boxes, Lantern ticked as last time and said so, and nothing generated; Generate sends exactly what is ticked at that moment (the volunteer entry after the person changes it) with experienceChosen. (2) A job whose documents were made without a choice opens on step 1 · Tailor with the boxes and the notice, never on the generated documents, and Review generated documents still opens them; a job the person chose for opens on its documents. (3) Prepare applications in the Table asks once before anything is queued: the same boxes under "Include in every selected application", the count, Lantern ticked; Cancel queues and writes nothing; Prepare saves the choice on each queued job's tailoring before its move and its preparation, and Generate carries exactly it. Red on store main da410a45 (no last choice, step 2 for an unchosen packet, bulk Prepare queues at once with none). CAREER_PROOF_SHOTS=<folder> keeps a screenshot of each step (fixture data only).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { playwright, tools, ORIGIN, PHONE, DESKTOP } from './helpers/ux-page.mjs';

const SHOTS = process.env.CAREER_PROOF_SHOTS || '';
const shot = async (page, name) => { if (!SHOTS) return; mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, name + '.png'), fullPage: false }); };

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const API = '/api/career-hunter';
const PORTFOLIO = { id: 'saved-portfolio', title: 'Lantern', kind: 'project', organization: 'Lantern (open-source)', archived: false };
const VOLUNTEER = { id: 'volunteer-teaching-01', title: 'Weekend teaching', kind: 'volunteer', organization: 'Community school', archived: false };
const entry = (name, label, path) => ({ id: 'tool-career-' + name, label, toolUi: { iframeUrl: API + '/' + path, visibilityToolName: 'career-' + name } });
const PROFILE = { ribbon: { items: [entry('home', 'Home', 'home'), entry('board', 'My jobs', 'board-native'), entry('resume-studio', 'My résumé', 'resume-studio')] } };
const READY = new Set(['promoted', 'generated', 'deferred']), DONE = new Set(['applied', 'interview', 'offer', 'rejected']);

/** A saved job of the made-up person; `draft` is its tailoring as the draft writer keeps it. */
const job = (id, extra = {}) => ({ id, title: 'Office Manager', company: `Example ${id}`, location: 'Austin, TX', workplaceType: 'onsite', distanceMiles: 4 + id,
  status: 'new', favorite: true, active: 1, url: `https://jobs.example.com/${id}`, description: 'Run the office, the budget and the front desk. '.repeat(12),
  ai_fit_score: 80 + id, has_resume: 0, has_cover: 0, board: { favorite: true, savedAt: `2026-11-1${id}T15:00:00Z` },
  draft: { revision: 0, guidance: '', experienceIds: [] }, ...extra });

/**
 * @description A fixture Career for one made-up person: their saved jobs, their Other experience and last choice, the draft writer's
 * rules (the saved revision only; it moves on when the inputs change; experienceChosen is kept), and preparations that finish on their
 * second read. Every write is recorded.
 * @param {{jobs?:object[], last?:string[]|null}} [options]
 * @returns {{api:Function, jobs:Map, writes:object[]}}
 */
function career(options = {}) {
  const state = { jobs: new Map((options.jobs || [job(1), job(2)]).map((one) => [one.id, one])), writes: [], runs: new Map() };
  const last = options.last === undefined ? [PORTFOLIO.id] : options.last;
  const read = (one) => {
    const run = state.runs.get(one.id);
    if (run && ++run.reads >= 2) { state.runs.delete(one.id); Object.assign(one, { status: 'generated', has_resume: 1, has_cover: 1, board: { ...one.board, requestId: run.requestId, completedAt: new Date().toISOString(), phase: 'ready' } }); }
    const busy = state.runs.has(one.id);
    return { ...one, application: { draft: one.draft, needsGeneration: !one.has_resume || busy, documentsOutdated: false, busy, failed: false, intent: null, workflow: null,
      missingRoles: [], rolesNotice: '', legacy: !one.draft.experienceChosen }, ...(busy ? { board: { ...one.board, generationDraft: { requestId: state.runs.get(one.id).requestId, state: 'requested' } } } : {}) };
  };
  const tailor = (one, draft) => {
    if (draft.revision !== (one.draft.revision || 0)) return { status: 409, json: { error: 'This draft changed in another tab.' } };
    const same = draft.guidance === one.draft.guidance && JSON.stringify(draft.experienceIds) === JSON.stringify(one.draft.experienceIds);
    one.draft = { revision: same ? one.draft.revision || 0 : (one.draft.revision || 0) + 1, guidance: draft.guidance, experienceIds: [...draft.experienceIds],
      experienceRevision: draft.experienceRevision, ...(draft.experienceChosen === true || one.draft.experienceChosen ? { experienceChosen: true } : {}) };
    return { json: { ok: true, application: read(one).application } };
  };
  state.api = ({ method, url, body }) => {
    const p = url.pathname, id = Number((p.match(/\/jobs\/(\d+)/) || [])[1]), one = state.jobs.get(id);
    if (p === '/api/auth/user') return { json: { authenticated: true, tenant: 'tenant-1', principal_id: 'person-1', sub: 'olive' } };
    if (p === '/api/ui/profile') return { json: { profile: PROFILE } };
    if (p === `${API}/resume/state`) return { json: { hasResume: true, roles: 3, indexing: false } };
    if (p === `${API}/jobs/stats`) return { json: { saved: state.jobs.size, byStatus: [] } };
    if (p === `${API}/applications` || p === `${API}/submission-queue`) return { json: { applications: [], items: [] } };
    if (p === '/api/apply-operator/workers') return { json: { workers: [] } };
    if (p === '/api/v1/agent/schedules') return { json: { schedules: [] } };
    if (p === `${API}/experience-bank`) return { json: { version: 1, revision: 'bank-1', entries: [PORTFOLIO, VOLUNTEER], last: last ? { experienceIds: last, savedAt: '2026-11-16T19:00:00Z' } : null } };
    if (p === `${API}/resume`) return { text: '<p>Fictional document preview</p>', type: 'text/html' };
    if (p === `${API}/jobs` && method === 'GET') {
      const status = url.searchParams.get('status'), keep = status === 'queue' ? (j) => READY.has(j.status) : (j) => j.favorite && j.status !== 'dismissed' && !DONE.has(j.status);
      return { json: { jobs: [...state.jobs.values()].filter(keep).map((j) => read(j)), exhausted: true, exclusions: [], home: { known: true, label: 'Austin, TX', radiusMiles: 50, line: 'Miles are straight-line from Austin, TX.' } } };
    }
    if (method !== 'GET') state.writes.push({ path: p, body });
    if (one && /\/jobs\/\d+$/.test(p)) return { json: { job: read(one), processing: state.runs.size ? 'run-1' : false } };
    if (one && p.endsWith('/status') && body && body.draft) return tailor(one, body.draft);
    if (one && p.endsWith('/status')) { if (body.status) one.status = body.status; if (typeof body.favorite === 'boolean') one.favorite = body.favorite; return { json: { ok: true, status: one.status, favorite: one.favorite } }; }
    if (one && p.endsWith('/generate')) { state.runs.set(id, { requestId: body.requestId, reads: 0 }); one.draft = { ...one.draft, experienceIds: [...body.experienceIds], ...(body.experienceChosen ? { experienceChosen: true } : {}) }; return { status: 202, json: { ok: true, status: 'generating', requestId: body.requestId } }; }
    return { status: 404, json: { error: 'not in fixture' } };
  };
  return state;
}

/**
 * @description A page of Career at its real address over the fixture: /board-native serves Prepare application when the address names
 * an application, as the board route does, and My jobs otherwise. The page clock is installed before load when asked.
 * @returns {Promise<{page:object, context:object}>}
 */
async function open(state, size, query, { clock = false } = {}) {
  const context = await browser.newContext({ ...size, locale: 'en-US', timezoneId: 'UTC' });
  await context.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname === `${API}/board-native`) return route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(tools, /^[1-9]\d*$/.test(url.searchParams.get('application') || '') ? 'career-application.html' : 'career-job-lists.html')) });
    const asset = url.pathname.match(/^\/api\/career-hunter\/static\/([\w.-]+)$/);
    if (asset && existsSync(join(tools, asset[1]))) return route.fulfill({ status: 200, contentType: asset[1].endsWith('.css') ? 'text/css' : 'application/javascript', body: readFileSync(join(tools, asset[1])) });
    if (/^\/(shared|cockpit|ui)\//.test(url.pathname) || url.pathname === '/api/artifacts/send-to.js') return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript', body: '' });
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = req.postData(); }
    const out = state.api({ method: req.method(), url, body }) || { status: 404, json: {} };
    if (out.text != null) return route.fulfill({ status: out.status || 200, contentType: out.type || 'text/plain', body: out.text });
    return route.fulfill({ status: out.status || 200, contentType: 'application/json', body: JSON.stringify(out.json ?? {}) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  if (clock) await page.clock.install();
  await page.goto(`${ORIGIN}${API}/board-native${query}`, { waitUntil: 'load' });
  return { page, context };
}
/** Move the page's time on until `done` answers truthy (fetches in between run in real time). */
async function advance(page, done, most = 240) {
  for (let i = 0; i < most; i += 1) { if (await done()) return true; await page.clock.runFor(1500); await new Promise((resolve) => setTimeout(resolve, 12)); }
  return done();
}
const box = (page, entryId) => page.locator(`#application input[name="experience"][value="${entryId}"]`);
const generated = (state) => state.writes.filter((write) => write.path.endsWith('/generate'));
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const press = (page, locator, size) => (size === PHONE ? locator.tap() : locator.click());

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: Prepare application opens step 1 with the Other experience boxes, last time's ticked, and generates nothing until Generate`, async () => {
    const state = career();
    const { page, context } = await open(state, size, '?view=saved');
    try {
      const row = page.locator('.job-row[data-job-id="1"]');
      await row.waitFor();
      await press(page, row.getByRole('button', { name: 'Prepare application' }), size);
      await page.getByRole('heading', { name: 'What should this application emphasize?' }).waitFor();
      assert.deepEqual(state.writes.map((write) => [write.path, write.body.status]), [[`${API}/jobs/1/status`, 'promoted']], 'only the move: no résumé is generated before the person chooses');
      const section = page.locator('#application');
      assert.match(await section.innerText(), /Other experience · optional/);
      assert.equal(await box(page, PORTFOLIO.id).isChecked(), true, 'the open-source entry is ticked, as in the last application prepared');
      assert.equal(await box(page, VOLUNTEER.id).isChecked(), false);
      assert.equal(await page.locator('#experienceSuggested').innerText(), 'Ticked as in the last application you prepared. Untick anything this job should not show.');
      assert.match(await box(page, PORTFOLIO.id).locator('xpath=..').innerText(), /Lantern\s*Lantern \(open-source\)/, 'each box is labelled with its title and organization');
      assert.ok(await noSideways(page), 'nothing is wider than the screen');
      await shot(page, `${label}-single-step-1-ticked-as-last-time`);
      assert.deepEqual(generated(state), [], 'still nothing generated');
      // The person changes it for this job: the open-source entry off, the volunteer entry on.
      await press(page, box(page, PORTFOLIO.id), size);
      await press(page, box(page, VOLUNTEER.id), size);
      await page.waitForFunction(() => document.getElementById('draftState')?.textContent === 'Draft saved to your account');
      const saved = state.writes.filter((write) => write.body && write.body.draft).at(-1).body.draft;
      assert.deepEqual([saved.experienceIds, saved.experienceChosen], [[VOLUNTEER.id], true], 'the saved draft holds the choice, marked as chosen');
      await press(page, page.getByRole('button', { name: 'Generate résumé & cover letter' }), size);
      await page.waitForFunction(() => document.getElementById('applicationState')?.textContent === 'Generating documents');
      assert.equal(generated(state).length, 1, 'one preparation, after the press');
      const sent = generated(state)[0].body;
      assert.deepEqual(sent.experienceIds, [VOLUNTEER.id], 'Generate sends exactly the ticked entry; the unticked one stays out');
      assert.equal(sent.experienceChosen, true);
      await shot(page, `${label}-single-generating`);
    } finally { await context.close(); }
  });

  test(`${label}: a job whose documents were made without a choice opens on step 1 with the boxes; one chosen for opens on its documents`, async () => {
    const unchosen = job(3, { status: 'generated', has_resume: 1, has_cover: 1 });
    const chosen = job(4, { status: 'generated', has_resume: 1, has_cover: 1, draft: { revision: 2, guidance: '', experienceIds: [PORTFOLIO.id], experienceChosen: true } });
    const state = career({ jobs: [unchosen, chosen] });
    const first = await open(state, size, '?view=queue&application=3');
    try {
      const page = first.page;
      await page.getByRole('heading', { name: 'What should this application emphasize?' }).waitFor();
      assert.equal(await page.locator('.steps [aria-current="step"]').innerText(), '1 · Tailor', 'not the generated documents');
      assert.equal(await page.locator('#experienceAsk').innerText(), 'These documents were made before you chose this application’s other experience. Tick what it should include and press Generate résumé & cover letter, or review them as they are.');
      assert.equal(await box(page, PORTFOLIO.id).isChecked(), true);
      assert.equal(await box(page, VOLUNTEER.id).isChecked(), false);
      await shot(page, `${label}-unchosen-documents-step-1`);
      await press(page, page.getByRole('button', { name: 'Review generated documents' }), size);
      await page.getByRole('heading', { name: 'Review the documents for this job' }).waitFor();
      assert.deepEqual(state.writes, [], 'looking at the documents as they are writes nothing');
    } finally { await first.context.close(); }
    const second = await open(state, size, '?view=queue&application=4');
    try {
      await second.page.getByRole('heading', { name: 'Review the documents for this job' }).waitFor();
      assert.equal(await second.page.locator('#experienceAsk').count(), 0);
    } finally { await second.context.close(); }
  });

  test(`${label}: Prepare applications asks once, with the boxes, the count and last time's choice, and queues nothing until Prepare`, async () => {
    const state = career({ jobs: [job(1), job(2), job(5, { status: 'generated', has_resume: 1, has_cover: 1 })] });
    const { page, context } = await open(state, size, '?view=saved', { clock: true });
    try {
      await page.getByRole('tab', { name: 'Table' }).click();
      const table = page.locator('#jobsTable');
      await table.locator('[data-id]').first().waitFor();
      await table.locator('#jtAll').check();
      await page.locator('#bulkBar').getByRole('button', { name: 'Prepare applications' }).click();
      const dialog = page.getByRole('dialog', { name: 'Prepare 2 applications' });
      await dialog.waitFor();
      const words = await dialog.innerText();
      assert.match(words, /Other experience · optional/);
      assert.match(words, /Include in every selected application/);
      assert.match(words, /1 left out: 1 already prepared\./, 'the job it does not apply to is named');
      const lantern = dialog.getByRole('checkbox', { name: /Lantern/ }), teaching = dialog.getByRole('checkbox', { name: /Weekend teaching/ });
      assert.equal(await lantern.isChecked(), true, 'ticked as in the last application prepared');
      assert.equal(await teaching.isChecked(), false);
      assert.equal(await dialog.getByRole('button', { name: 'Prepare 2 applications' }).isVisible(), true, 'the count is on the button');
      await shot(page, `${label}-bulk-step`);
      assert.deepEqual(state.writes, [], 'nothing is queued or written while the step is open');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await page.locator('#actionState').getByText('Nothing was queued.').waitFor();
      await page.clock.runFor(6000);
      assert.deepEqual(state.writes, [], 'Cancel queues nothing');
      assert.equal(await page.locator('#bulkProgress').isVisible(), false);
      await table.locator('#jtAll').check();
      await page.locator('#bulkBar').getByRole('button', { name: 'Prepare applications' }).click();
      await page.getByRole('dialog', { name: 'Prepare 2 applications' }).getByRole('button', { name: 'Prepare 2 applications' }).click();
      await page.locator('#actionState').getByText('2 applications queued. Career prepares them one or two at a time while My jobs is open. Each includes Lantern. 1 left out: 1 already prepared.').waitFor();
      assert.ok(await advance(page, async () => generated(state).length === 2), 'both prepared');
      for (const id of [1, 2]) {
        const own = state.writes.filter((write) => write.path.startsWith(`${API}/jobs/${id}/`));
        assert.deepEqual(own.map((write) => (write.body.draft ? 'tailoring' : write.body.status ? 'move' : 'generate')), ['tailoring', 'move', 'generate'], 'the choice is on the job before it moves and is prepared');
        assert.deepEqual([own[0].body.draft.experienceIds, own[0].body.draft.experienceChosen], [[PORTFOLIO.id], true]);
        assert.deepEqual(state.jobs.get(id).draft.experienceIds, [PORTFOLIO.id], 'saved on the job\'s own tailoring');
        assert.deepEqual([own[2].body.experienceIds, own[2].body.experienceChosen], [[PORTFOLIO.id], true], 'its preparation uses exactly that choice');
      }
      assert.deepEqual(state.writes.filter((write) => write.path.includes('/jobs/5/')), [], 'nothing for the job left out');
      assert.ok(await noSideways(page));
      await shot(page, `${label}-bulk-queued`);
    } finally { await context.close(); }
  });
}
