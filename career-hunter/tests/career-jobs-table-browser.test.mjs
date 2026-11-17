/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.68.1 (Roger, 2026-11-16: "this is not a choice in bulk edit"): Prepare applications asks first (the step with the person's Other experience, here none, the count and Prepare N applications); these cases confirm it, and each job's own writes are now its tailoring (the choice), the move, then the preparation. The step itself is proven by tests/career-prepare-other-experience-browser.test.mjs.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.0 (Roger, 2026-11-16: "select multiple rows on a table and push all the applications to prepare application ... bulk select for all of the subsequent screens as well"; "i cant look at jobs near me"). The shipped My jobs page (tools/career-job-lists.html with career-jobs-table.js and career-bulk-queue.js) in Chromium over fixture jobs and a fixture Career that, like the native kernel, runs one preparation at a time: the List | Table switch is remembered per person; the Table has one row per saved job with Company, Title, Location ("Remote", "Location unknown", distance), Match, Stage, Saved and Résumé; columns sort (nearest first); the distance filter and select all work together; the bar's Prepare applications queues the jobs it applies to, names the ones left out, makes each job's own two writes, shows progress on each row and overall, survives a reload and cancels what is queued; Send asks once with the count and the companies and sends nothing until the approval is ticked; Applications move in bulk; with no home location the line and the link to set it are shown. At 1440x900 and at 412x915, where the table is a selectable list. (CAREER_PROOF_SHOTS=<folder> also saves a screenshot of each step there.)
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { playwright, tools, ORIGIN, PHONE, DESKTOP } from './helpers/ux-page.mjs';

/** Where to keep a screenshot of each step, when asked (fixture data only). */
const SHOTS = process.env.CAREER_PROOF_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name + '.png'), fullPage: false }); };

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const API = '/api/career-hunter';
const BOT = 'cb000000-0000-0000-0000-000000000004';
const day = (n) => `2026-11-${String(n).padStart(2, '0')}T15:00:00Z`;
const job = (id, extra) => ({ id, status: 'new', favorite: true, active: 1, has_resume: 0, has_cover: 0, workplaceType: 'onsite', url: `https://jobs.example.com/${id}`,
  description: 'A real description.', ...extra, board: { favorite: true, savedAt: day(extra.saved || 10), ...(extra.board || {}) } });
/** Six saved jobs: near, nearer, remote, prepared and far, unknown place, and one applied to. */
const SAVED = () => [
  job(1, { company: 'Acme Corp', title: 'Operations Manager', location: 'Austin, TX', distanceMiles: 8.2, ai_fit_score: 88, saved: 10 }),
  job(2, { company: 'Beta LLC', title: 'Office Manager', location: 'Round Rock, TX', distanceMiles: 21.6, ai_fit_score: 74, saved: 12 }),
  job(3, { company: 'Gamma Inc', title: 'Project Coordinator', location: 'Remote (US)', workplaceType: 'remote', remote: 1, lat: null, lon: null, distanceMiles: null, ai_fit_score: 91, saved: 9 }),
  job(4, { company: 'Delta Co', title: 'Program Manager', location: 'Dallas, TX', distanceMiles: 189.4, ai_fit_score: 66, status: 'generated', has_resume: 1, has_cover: 1, saved: 8 }),
  job(5, { company: 'Echo Ltd', title: 'Executive Assistant', location: null, workplaceType: null, lat: null, lon: null, distanceMiles: null, saved: 13 }),
  job(6, { company: 'Foxtrot Group', title: 'Operations Lead', location: 'San Marcos, TX', distanceMiles: 47.9, ai_fit_score: 79, status: 'applied', saved: 7 }),
];
const FEEDS = { saved: (j) => j.favorite && j.status !== 'dismissed', queue: (j) => ['promoted', 'generated', 'deferred'].includes(j.status),
  tracked: (j) => ['applied', 'interview', 'offer', 'rejected'].includes(j.status) };

/**
 * @description A fixture Career: the jobs, the person, and preparations that finish on their second read. Like the native
 * kernel, one preparation runs at a time and the person's other writes are refused while it does.
 * @param {{jobs?:object[], home?:object, principal?:string}} [options]
 * @returns {{handler:Function, jobs:Map, writes:object[], runs:Map}}
 */
function career(options = {}) {
  const state = { jobs: new Map((options.jobs || SAVED()).map((j) => [j.id, j])), writes: [], runs: new Map(), refused: 0 };
  const listed = (url) => { const status = url.searchParams.get('status'), keep = FEEDS[status] || ((j) => j.status === status); return [...state.jobs.values()].filter(keep); };
  const finish = (one) => {
    const run = state.runs.get(one.id);
    if (!run || ++run.reads < 2) return;
    state.runs.delete(one.id);
    Object.assign(one, { status: 'generated', has_resume: 1, has_cover: 1, board: { ...one.board, requestId: run.requestId, completedAt: new Date().toISOString(), phase: 'ready' } });
  };
  state.handler = ({ method, url, body }) => {
    const p = url.pathname, id = Number((p.match(/\/jobs\/(\d+)/) || [])[1]), one = state.jobs.get(id);
    if (p === '/api/auth/user') return { json: { authenticated: true, tenant: 'tenant-1', principal_id: options.principal || 'person-1' } };
    if (p === `${API}/resume/state`) return { json: { hasResume: true, roles: 3, indexing: false } };
    if (p === `${API}/jobs/stats`) return { json: { saved: state.jobs.size, byStatus: [] } };
    if (p === `${API}/applications`) return { json: { applications: [] } };
    if (p === `${API}/jobs` && method === 'GET') {
      // The Table's reads ask for 300 a page; the List's own (sort, page size) are not the Table's.
      if (url.searchParams.get('per') === '300' && (url.searchParams.has('within') || url.searchParams.has('sort'))) state.narrowed = true;
      return { json: { jobs: listed(url), exhausted: true, exclusions: [], home: options.home || { known: true, label: 'Austin, TX', radiusMiles: 50, line: 'Miles are straight-line from Austin, TX.', settingsUrl: `${API}/settings?section=matching` } } };
    }
    if (p === `${API}/experience-bank`) return { json: { revision: 'bank-1', entries: [] } };
    if (p === '/api/apply-operator/workers') return { json: { workers: [{ clientId: 'c1', available: true, boundBots: [BOT] }] } };
    if (p === `${API}/submission-queue` && method === 'GET') return { json: { items: [] } };
    if (method !== 'GET' && state.runs.size) { state.refused += 1; return { status: 409, json: { error: 'career_run_in_progress', runId: 'run-1' } }; }
    if (method !== 'GET') state.writes.push({ path: p, body });
    if (one && /\/jobs\/\d+$/.test(p)) { finish(one); return { json: { job: { ...one, application: { draft: { revision: 1, guidance: '', experienceIds: [] }, needsGeneration: !one.has_resume } }, processing: state.runs.size ? 'run-1' : false } }; }
    if (one && p.endsWith('/status')) { if (body.status) one.status = body.status; if (typeof body.favorite === 'boolean') one.favorite = body.favorite; return { json: { ok: true, status: one.status, favorite: one.favorite } }; }
    if (one && p.endsWith('/generate')) { state.runs.set(id, { requestId: body.requestId, reads: 0 }); return { status: 202, json: { ok: true, status: 'generating', requestId: body.requestId } }; }
    const review = p.match(/\/submission-review\/(\d+)$/);
    if (review) { const j = state.jobs.get(Number(review[1])); return { json: { postingId: j.id, company: j.company, title: j.title, packetDigest: 'packet-' + j.id, documents: [], profile: {} } }; }
    if (p === `${API}/submission-queue`) return { json: { item: { id: 'sub-' + body.postingId, postingId: body.postingId, status: 'queued' } } };
    if (/\/submission-queue\/sub-\d+\/(bind|start)$/.test(p)) return { json: { item: { id: p.split('/').at(-2), status: p.endsWith('start') ? 'claimed' : 'queued', nativeTicketId: 't1' } } };
    return { status: 404, json: { error: 'not in fixture' } };
  };
  return state;
}

/**
 * @description My jobs over the fixture with the page clock installed before load, so the queue's timers run when the test
 * moves time. The person's browser storage stays with the context, as it does across a reload.
 * @returns {Promise<{page:object, context:object, calls:object[]}>}
 */
async function open(fixture, size, query = '', context = null) {
  const own = context || await browser.newContext({ ...size, locale: 'en-US', timezoneId: 'UTC' });
  const calls = [];
  await own.unrouteAll({ behavior: 'ignoreErrors' });
  await own.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname === `${API}/board-native`) return route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(tools, 'career-job-lists.html')) });
    const asset = url.pathname.match(/^\/api\/career-hunter\/static\/([\w.-]+)$/);
    if (asset && existsSync(join(tools, asset[1]))) return route.fulfill({ status: 200, contentType: asset[1].endsWith('.css') ? 'text/css' : 'application/javascript', body: readFileSync(join(tools, asset[1])) });
    if (/^\/(shared|cockpit|ui)\//.test(url.pathname)) return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript', body: '' });
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = req.postData(); }
    calls.push({ method: req.method(), path: url.pathname + url.search, body });
    const out = fixture.handler({ method: req.method(), url, body }) || { status: 404, json: {} };
    return route.fulfill({ status: out.status || 200, contentType: 'application/json', body: JSON.stringify(out.json ?? {}) });
  });
  const page = await own.newPage();
  await page.clock.install();
  await page.goto(`${ORIGIN}${API}/board-native${query}`, { waitUntil: 'load' });
  return { page, context: own, calls };
}

/** Move the page's time on until `done` answers truthy (fetches in between run in real time). */
async function advance(page, done, most = 240) {
  for (let i = 0; i < most; i += 1) {
    if (await done()) return true;
    await page.clock.runFor(1500);
    await new Promise((resolve) => setTimeout(resolve, 12));
  }
  return done();
}
const table = (page) => page.locator('#jobsTable');
const rowText = (page) => table(page).locator('[data-id]').evaluateAll((rows) => rows.map((row) => row.querySelector('.jt-col-company, .jt-co').textContent.trim()));
const cell = (page, id, name) => table(page).locator(`[data-id="${id}"] ${name}`);
async function showTable(page) { await page.getByRole('tab', { name: 'Table' }).click(); await table(page).locator('[data-id]').first().waitFor(); }
/** Bulk Prepare's one step (1.68.1): press its Prepare button, which carries the count. */
async function confirmPrepare(page, count) {
  const dialog = page.getByRole('dialog', { name: `Prepare ${count} ${count === 1 ? 'application' : 'applications'}` });
  await dialog.waitFor();
  await dialog.getByRole('button', { name: `Prepare ${count} ${count === 1 ? 'application' : 'applications'}` }).click();
}

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: the Table shows one row per saved job with its place, and is remembered for this person only`, async () => {
    const fixture = career();
    const { page, context } = await open(fixture, size);
    try {
      await page.getByRole('tab', { name: 'List' }).waitFor();
      assert.equal(await page.getByRole('tab', { name: 'List' }).getAttribute('aria-selected'), 'true', 'today\'s view is the default');
      await showTable(page);
      assert.equal(await table(page).locator('[data-id]').count(), 6);
      if (size === DESKTOP) {
        const header = (await table(page).locator('thead th').allInnerTexts()).map((text) => text.replace(/[▲▼\s]/g, ''));
        assert.deepEqual(header, ['', 'Company', 'Title', 'Location', 'Match', 'Stage', 'Saved', 'Résumé', 'Open']);
        assert.equal(await table(page).locator('thead th[aria-sort="descending"]').innerText().then((text) => text.replace(/[▲▼\s]/g, '')), 'Match', 'best match first');
      }
      const place = size === DESKTOP ? '.jt-col-location' : '.jt-meta';
      assert.match(await cell(page, 3, place).innerText(), /^Remote/);
      assert.match(await cell(page, 5, place).innerText(), /^Location unknown/);
      assert.match(await cell(page, 1, place).innerText(), /^Austin, TX · 8\.2 mi from home/);
      assert.match(await table(page).locator('[data-id="4"]').innerText(), /Prepared/);
      assert.match(await table(page).locator('[data-id="6"]').innerText(), /Applied/);
      await shot(page, `${label}-table`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'nothing is wider than the screen');
      assert.equal(fixture.narrowed, undefined, 'the Table reads the whole stage, with no distance or sort of the List\'s own');
      await page.reload({ waitUntil: 'load' });
      await table(page).locator('[data-id]').first().waitFor();
      assert.equal(await page.getByRole('tab', { name: 'Table' }).getAttribute('aria-selected'), 'true', 'the Table is remembered');
      const other = await open(career({ principal: 'person-2' }), size, '', context);
      await other.page.getByRole('tab', { name: 'List' }).waitFor();
      assert.equal(await other.page.getByRole('tab', { name: 'List' }).getAttribute('aria-selected'), 'true', 'another person in the same browser keeps their own view');
    } finally { await context.close(); }
  });

  test(`${label}: nearest first, Within 25 miles, and select all of what the filter shows`, async () => {
    const { page, context } = await open(career(), size);
    try {
      await showTable(page);
      if (size === DESKTOP) await table(page).getByRole('button', { name: 'Location' }).click();
      else await table(page).locator('#jtSort').selectOption('location');
      assert.deepEqual(await rowText(page), ['Acme Corp', 'Beta LLC', 'Foxtrot Group', 'Delta Co', 'Gamma Inc', 'Echo Ltd'], 'nearest first; remote, then an unknown place, last');
      await table(page).locator('#jtWithin').selectOption('25');
      assert.deepEqual(await rowText(page), ['Acme Corp', 'Beta LLC']);
      await table(page).locator('#jtAll').check();
      await page.locator('#bulkBar').getByText('2 selected').waitFor();
      assert.match(await table(page).locator('#jtCount').innerText(), /2 of 6 jobs · 2 selected/);
      await shot(page, `${label}-within-25-miles-selected`);
      await table(page).locator('#jtWithin').selectOption('remote');
      assert.deepEqual(await rowText(page), ['Gamma Inc']);
      assert.equal(await page.locator('#bulkBar').isVisible(), false, 'a job the filter hides is not left selected');
      if (size === PHONE) {
        const box = await table(page).locator('[data-id="3"] .jt-pick').boundingBox();
        assert.ok(box.width >= 44 && box.height >= 44, 'a 44px target');
        await table(page).locator('[data-id="3"] .jt-meta').tap();
        await page.locator('#bulkBar').getByText('1 selected').waitFor();
        await shot(page, 'phone-card-selected');
        const bar = await page.locator('#bulkBar').boundingBox();
        assert.ok(bar.y + bar.height <= 915, 'the bar is on the screen');
      }
    } finally { await context.close(); }
  });
}

test('Prepare applications queues the jobs it applies to, names the others, and shows progress on each row and overall', async () => {
  const fixture = career();
  const { page, context, calls } = await open(fixture, DESKTOP);
  try {
    await showTable(page);
    await table(page).locator('#jtAll').check();
    await page.locator('#bulkBar').getByText('6 selected').waitFor();
    assert.deepEqual(await page.locator('#bulkBar :is(.ck-primary, .btn.primary)').allInnerTexts(), ['Prepare applications'], 'one filled button');
    await page.locator('#bulkBar').getByRole('button', { name: 'Prepare applications' }).click();
    await confirmPrepare(page, 4);
    await page.locator('#actionState').getByText('4 applications queued. Career prepares them one or two at a time while My jobs is open. 2 left out: 1 already applied, 1 already prepared.').waitFor();
    await page.locator('#bulkProgress').getByText('Prepare applications').waitFor();
    assert.ok(await advance(page, async () => /Preparing…/.test(await cell(page, 3, '[data-resume-cell]').innerText())), 'the first job shows Preparing…');
    assert.match(await cell(page, 1, '[data-resume-cell]').innerText(), /Queued/);
    assert.match(await page.locator('#bulkProgress').innerText(), /1 preparing · 3 queued/);
    await shot(page, 'computer-preparing');
    const first = fixture.writes.filter((write) => write.path.includes('/jobs/3/'));
    assert.deepEqual(first.map((write) => [write.path.split('/').at(-1), write.body.draft ? 'tailoring' : write.body.status || write.body.documents]), [['status', 'tailoring'], ['status', 'promoted'], ['generate', true]], 'its own writes, in order: the choice on its tailoring, the move, the preparation');
    assert.ok(await advance(page, async () => /4 prepared/.test(await page.locator('#bulkProgress').innerText())), 'all four prepared');
    for (const id of [1, 2, 3, 5]) assert.match(await cell(page, id, '[data-resume-cell]').innerText(), /Prepared/);
    await shot(page, 'computer-prepared');
    assert.equal(fixture.writes.filter((write) => write.path.endsWith('/generate')).length, 4, 'one preparation each');
    assert.deepEqual(calls.filter((call) => call.method === 'POST' && /\/jobs\/(4|6)\//.test(call.path)), [], 'nothing was written for the jobs left out');
  } finally { await context.close(); }
});

test('the queue survives a reload, and Cancel stops what has not started', async () => {
  const fixture = career();
  const first = await open(fixture, DESKTOP);
  try {
    await showTable(first.page);
    for (const id of [1, 2, 3]) await table(first.page).locator(`[data-select="${id}"]`).check();
    await first.page.locator('#bulkBar').getByRole('button', { name: 'Prepare applications' }).click();
    await confirmPrepare(first.page, 3);
    assert.ok(await advance(first.page, async () => /1 preparing · 2 queued/.test(await first.page.locator('#bulkProgress').innerText())));
    await first.page.close();
    const again = await open(fixture, DESKTOP, '', first.context);
    await again.page.locator('#bulkProgress').getByText('1 preparing · 2 queued').waitFor();
    assert.match(await cell(again.page, 1, '[data-resume-cell]').innerText(), /Queued/, 'each row keeps its state after the reload');
    await shot(again.page, 'computer-after-reload');
    await again.page.locator('#bulkProgress').getByRole('button', { name: 'Cancel 2 queued' }).click();
    await again.page.locator('#actionState').getByText('2 jobs were cancelled before they started.').waitFor();
    assert.ok(await advance(again.page, async () => /1 prepared · 2 cancelled/.test(await again.page.locator('#bulkProgress').innerText())));
    assert.equal(fixture.writes.filter((write) => write.path.endsWith('/generate')).length, 1, 'only the running one was prepared');
  } finally { await first.context.close(); }
});

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: Send asks once with the count and the companies, and sends nothing until the approval is ticked`, async () => {
    const jobs = SAVED().map((one) => (one.id <= 2 ? { ...one, status: 'generated', has_resume: 1, has_cover: 1 } : one.id === 4 ? { ...one, status: 'promoted', has_resume: 0, has_cover: 0 } : one));
    const fixture = career({ jobs });
    const { page, context, calls } = await open(fixture, size, '?view=queue');
    try {
      await showTable(page);
      await table(page).locator('#jtAll').check();
      await page.locator('#bulkBar').getByRole('button', { name: 'Send from my computer' }).click();
      const dialog = page.getByRole('dialog', { name: 'Send 2 applications from your computer?' });
      await dialog.waitFor();
      assert.match(await dialog.innerText(), /Acme Corp · Operations Manager/);
      assert.match(await dialog.innerText(), /Beta LLC · Office Manager/);
      assert.match(await dialog.innerText(), /Not sent: Delta Co \(no résumé and cover letter yet\)\./, 'the third is named, with why');
      await shot(page, `${label}-send-question`);
      const send = dialog.getByRole('button', { name: 'Send 2 applications' });
      assert.equal(await send.isDisabled(), true, 'off until the approval is ticked');
      await send.evaluate((button) => { button.disabled = false; button.click(); });
      await dialog.getByText('Tick the approval first. Nothing was sent.').waitFor();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await page.locator('#actionState').getByText('Nothing was sent.').waitFor();
      assert.deepEqual(calls.filter((call) => call.path.includes('/submission-queue') && call.method === 'POST'), [], 'nothing sent without the approval');
      await table(page).locator('#jtAll').check();
      await page.locator('#bulkBar').getByRole('button', { name: 'Send from my computer' }).click();
      await page.getByRole('dialog').getByLabel('I checked these 2 applications and approve sending them.').check();
      await page.getByRole('dialog').getByRole('button', { name: 'Send 2 applications' }).click();
      assert.ok(await advance(page, async () => fixture.writes.filter((write) => write.path.endsWith('/start')).length === 2), 'both started');
      assert.deepEqual(fixture.writes.filter((write) => write.path === `${API}/submission-queue`).map((write) => write.body), [
        { postingId: 1, packetDigest: 'packet-1', approved: true }, { postingId: 2, packetDigest: 'packet-2', approved: true }], 'the exact packets the person approved');
    } finally { await context.close(); }
  });
}

test('Applications move in bulk with the body each application page sends', async () => {
  const jobs = SAVED().map((one) => (one.id <= 3 ? { ...one, status: 'applied' } : one));
  const fixture = career({ jobs });
  const { page, context } = await open(fixture, DESKTOP, '?view=status');
  try {
    await showTable(page);
    await table(page).locator('[data-select="1"]').check();
    await table(page).locator('[data-select="3"]').check();
    await page.locator('#bulkBar [data-bulk-move]').selectOption('interview');
    await page.locator('#actionState').getByText('Moving 2 jobs.').waitFor();
    await shot(page, 'computer-applications-moving');
    assert.ok(await advance(page, async () => fixture.writes.length === 2));
    assert.deepEqual(fixture.writes.map((write) => [write.path, write.body]).sort(), [[`${API}/jobs/1/status`, { status: 'interview' }], [`${API}/jobs/3/status`, { status: 'interview' }]]);
  } finally { await context.close(); }
});

test('with no home location the Table shows the line the job route gives and the link to set it', async () => {
  const home = { known: false, label: null, radiusMiles: null, line: 'Set your home city or ZIP to see how far each job is from you.', settingsUrl: `${API}/settings?section=matching` };
  const { page, context } = await open(career({ home }), DESKTOP);
  try {
    await showTable(page);
    // One line on the screen, drawn by the page (career-job-place.js) once the List has read it, else by the Table.
    await page.getByText(home.line).first().waitFor();
    assert.equal(await page.getByText(home.line).evaluateAll((all) => all.filter((el) => el.getClientRects().length).length), 1, 'the line is said once');
    assert.ok(await page.locator(`a[href="${API}/settings?section=matching"]`).evaluateAll((all) => all.some((el) => el.getClientRects().length)), 'with the link that sets home');
    assert.deepEqual(await table(page).locator('#jtWithin option:disabled').allInnerTexts(), ['Within 10 miles', 'Within 25 miles', 'Within 50 miles', 'Within 100 miles']);
    assert.equal(await table(page).locator('#jtWithin option[value="remote"]').isDisabled(), false, 'Remote still works');
    await shot(page, 'computer-no-home-location');
  } finally { await context.close(); }
});
