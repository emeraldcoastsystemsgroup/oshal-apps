/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | One route from a saved job to a sent application (judge's report 2026-11-11, change 6). The shipped tools/career-job-lists.html and tools/career-approvals.html in Chromium over fixture answers, at 1440x900 and at 412x915 with touch. To approve is not a stage. A job Career picked leads Saved, marked "Career picked this for you", with the same Prepare application button a saved job has; pressing it promotes the job and opens the one application page, and never calls the approve route that wrote documents with no guidance. A pick the person has already prepared is not shown, and a pick that is also saved is listed once. Remove declines a pick through the deny route and says so. ?view=approve opens Saved on those jobs, and says so when there are none; the old approvals address forwards there. Picks step aside while a search is typed.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Review of 1.55.0, item 1: Career's picks lead the first page of Saved whatever the filters are. A typed search narrows the saved jobs and leaves the picks in the lead (it used to hide them, and the case that said so is rewritten); a filter the page remembered for a signed-in person and put back on a later visit does not hide them either (seen failing on the code as it was: the page showed "No jobs match these filters" and no pick); and page 2 of Saved shows no pick.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE, DESKTOP, ORIGIN } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const hostile = '<img src=x onerror="window.__injected=1">';
const job = (id, extra = {}) => ({ id, title: `Office Manager ${id}`, company: 'Example Co', location: 'Austin, TX', status: 'new', favorite: false, active: 1, ai_fit_score: 80, description: 'x'.repeat(4000), ...extra });

/**
 * @description Fixture answers for the Job Board with Career's picks.
 * @param {{records: object[], jobs: Record<number, object>, saved: object[], writes: object[], denyFails?: boolean, identity?: object}} state - The
 *   application records GET /applications answers, each job GET /jobs/:id answers, the saved list, where writes go, and who
 *   GET /api/auth/user says the person is (signed out unless given; the page remembers filters only for a signed-in person).
 * @returns {(req: {method: string, url: URL, body: any}) => object|null} The handler openScreen takes.
 */
function board(state) {
  return ({ method, url, body }) => {
    const p = url.pathname, one = p.match(/^\/api\/career-hunter\/jobs\/(\d+)$/), status = p.match(/^\/api\/career-hunter\/jobs\/(\d+)\/status$/), deny = p.match(/^\/api\/career-hunter\/applications\/(\d+)\/(deny|approve|applied)$/);
    if (p === '/api/career-hunter/resume/state') return { json: { hasResume: true, roles: 4, name: 'Ada', indexing: false, scored: 12 } };
    if (p === '/api/career-hunter/jobs/stats') return { json: { saved: state.saved.length, queued: 0, tracked: 0, byStatus: [] } };
    if (p === '/api/career-hunter/applications') return { json: { applications: state.records } };
    if (one) return state.jobs[one[1]] ? { json: { job: state.jobs[one[1]] } } : { status: 404, json: { error: 'not found' } };
    if (status && method === 'POST') { state.writes.push({ path: p, body }); return { json: { ok: true } }; }
    if (deny && method === 'POST') {
      state.writes.push({ path: p, body });
      if (state.denyFails) return { status: 500, json: { ok: false, error: 'career application ticket is missing' } };
      state.records = state.records.filter((record) => String(record.posting_id) !== deny[1]);
      return { json: { ok: true } };
    }
    if (p === '/api/career-hunter/jobs') return { json: { jobs: url.searchParams.get('q') ? [] : state.saved, exhausted: true, exclusions: [] } };
    if (p === '/api/career-hunter/board-native') return { text: 'the board or one application' };
    if (p === '/api/auth/user') return { json: state.identity || { authenticated: false } };
    return { json: {} };
  };
}
const record = (id, status = 'approval_required') => ({ posting_id: id, title: `Office Manager ${id}`, company: 'Example Co', status, ticket_id: `t-${id}` });
/** Two waiting picks (21, and 1 which the person also saved), one already prepared (22), one already drafted (23), and two saved jobs (1, 2). */
function account(extra = {}) {
  return { records: [record(21), record(22), record(23, 'drafted'), record(1)],
    jobs: { 21: job(21, { title: `${hostile} Office Manager 21` }), 22: job(22, { status: 'promoted' }), 23: job(23, { status: 'generated' }), 1: job(1, { favorite: true }) },
    saved: [job(1, { favorite: true }), job(2, { favorite: true })], writes: [], ...extra };
}
const rowsOf = (page) => page.locator('.job-row').evaluateAll((rows) => rows.map((row) => [Number(row.dataset.jobId), row.querySelector('.pick-mark')?.textContent ?? null, [...row.querySelectorAll('.row-actions button')].map((b) => b.textContent)]));
const press = (size, target) => (size === PHONE ? target.tap() : target.click());

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: To approve is not a stage, and a job Career picked leads Saved with the button a saved job has`, async () => {
    const state = account();
    const { page, context, calls } = await openScreen(browser, 'career-job-lists.html', board(state), size);
    try {
      await page.locator('.job-row[data-job-id="21"]').waitFor();
      const stages = page.getByRole('tablist', { name: 'Application stages' });
      assert.deepEqual((await stages.locator('a[role=tab]').allTextContents()).map((text) => text.replace(/\d+$/, '')), ['New matches', 'Saved', 'Getting ready', 'Removed']);
      assert.equal(await page.getByText('To approve').count(), 0, 'no stage, tab or link is called To approve');
      assert.deepEqual(await rowsOf(page), [
        [21, 'Career picked this for you', ['Prepare application', 'Remove']],
        [1, 'Career picked this for you', ['Prepare application', 'Remove']],
        [2, null, ['Prepare application', 'Unsave']],
      ], 'picks lead, a pick that is also saved is listed once, and a prepared or drafted pick is not a pick any more');
      assert.equal(await page.evaluate(() => window.__injected), undefined, 'a job title is text');
      assert.equal(await page.locator('#requestState').innerText(), '3 shown', 'the count is what the list shows');
      assert.ok((await page.locator('.job-row[data-job-id="21"] .pick-mark').boundingBox()).y < (await page.locator('.job-row[data-job-id="21"] .job-title').boundingBox()).y, 'the mark is its own line above the title');
      assert.equal(await page.locator('.job-row[data-job-id="21"] .status').count(), 0, 'a pick is not called saved');
      assert.ok(!calls.some((c) => /\/applications\/\d+\/approve$/.test(c.path)), 'nothing asks the approve route for documents');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'nothing is wider than the screen');
      if (size === PHONE) for (const box of await page.locator('.job-row[data-picked] .row-actions button').evaluateAll((buttons) => buttons.map((b) => b.getBoundingClientRect().height))) assert.ok(box >= 44, 'each button is a 44px target');
    } finally { await context.close(); }
  });

  test(`${label}: Prepare application on a pick promotes the job and opens the one application page`, async () => {
    const state = account();
    const { page, context, calls } = await openScreen(browser, 'career-job-lists.html', board(state), size);
    try {
      const prepare = page.locator('.job-row[data-job-id="21"]').getByRole('button', { name: 'Prepare application', exact: true });
      await prepare.waitFor();
      await press(size, prepare);
      await page.waitForURL((url) => url.pathname === '/api/career-hunter/board-native' && url.searchParams.get('application') === '21' && url.searchParams.get('view') === 'queue');
      assert.deepEqual(state.writes, [{ path: '/api/career-hunter/jobs/21/status', body: { status: 'promoted', favorite: true } }], 'the same one write a saved job gets');
      assert.ok(!calls.some((c) => c.path.startsWith('/api/career-hunter/applications/')), 'and no call to the approve, applied or deny routes');
      const kept = await page.evaluate(() => JSON.parse(sessionStorage.getItem('career-move-line') || 'null'));
      assert.match(kept.text, /^Getting ready: .*Office Manager 21 at Example Co\.$/, 'the move is said on the page the press opens');
    } finally { await context.close(); }
  });

  test(`${label}: Remove declines a pick, says so, and its row leaves`, async () => {
    const state = account();
    const { page, context } = await openScreen(browser, 'career-job-lists.html', board(state), size);
    try {
      const remove = page.locator('.job-row[data-job-id="1"]').getByRole('button', { name: 'Remove', exact: true });
      await remove.waitFor();
      await press(size, remove);
      await page.waitForFunction(() => !document.querySelector('.job-row[data-job-id="1"]'));
      assert.deepEqual(state.writes, [{ path: '/api/career-hunter/applications/1/deny', body: {} }]);
      assert.equal(await page.locator('#actionState').innerText(), 'Removed: Office Manager 1 at Example Co.');
      assert.equal(await page.locator('#actionState').isVisible(), true, 'the line is on screen');
      assert.deepEqual((await rowsOf(page)).map((row) => row[0]), [21, 2]);
    } finally { await context.close(); }
  });
}

test('a Remove the route refuses leaves the pick where it was and says why', async () => {
  const state = account({ denyFails: true });
  const { page, context } = await openScreen(browser, 'career-job-lists.html', board(state), DESKTOP);
  try {
    const remove = page.locator('.job-row[data-job-id="21"]').getByRole('button', { name: 'Remove', exact: true });
    await remove.click();
    await page.getByText('Could not remove this job: career application ticket is missing. Try again.').waitFor();
    assert.equal(await page.locator('.job-row[data-job-id="21"]').count(), 1);
    assert.equal(await remove.isEnabled(), true, 'the button can be pressed again');
  } finally { await context.close(); }
});

test('?view=approve opens Saved on Career\'s picks, and says so when there are none', async () => {
  const withPicks = await openScreen(browser, 'career-job-lists.html', board(account()), DESKTOP, '?view=approve');
  try {
    await withPicks.page.locator('.job-row[data-job-id="21"] .pick-mark').waitFor();
    assert.equal(new URL(withPicks.page.url()).pathname, '/screen', 'the page stayed: it did not go to the retired approvals page');
    assert.equal(await withPicks.page.getByRole('tab', { name: /^Saved/ }).getAttribute('aria-selected'), 'true');
    assert.equal((await withPicks.page.locator('#actionState').innerText()).trim(), '');
    assert.ok(!withPicks.calls.some((c) => c.path === '/api/career-hunter/approvals'));
  } finally { await withPicks.context.close(); }
  const none = await openScreen(browser, 'career-job-lists.html', board(account({ records: [record(22), record(23, 'drafted')] })), PHONE, '?view=approve');
  try {
    await none.page.getByText('Career has no picks waiting for you. Your saved jobs are here.').waitFor();
    assert.deepEqual((await rowsOf(none.page)).map((row) => row[0]), [1, 2], 'the saved jobs are there');
    assert.equal(await none.page.locator('.pick-mark').count(), 0);
  } finally { await none.context.close(); }
});

test('the approvals address still answers and takes a person to those jobs', async () => {
  const state = account();
  const { page, context } = await openScreen(browser, 'career-approvals.html', board(state), DESKTOP, '', '/api/career-hunter/approvals');
  try {
    await page.waitForURL(`${ORIGIN}/api/career-hunter/board-native?view=approve`);
    assert.deepEqual(state.writes, [], 'opening the address writes nothing');
  } finally { await context.close(); }
});

test('a typed search narrows the saved jobs and Career\'s picks stay in the lead', async () => {
  const state = account();
  const { page, context } = await openScreen(browser, 'career-job-lists.html', board(state), DESKTOP);
  try {
    await page.locator('.job-row[data-job-id="21"]').waitFor();
    await page.locator('#q').fill('nurse');
    await page.getByText('No saved jobs match these filters.').waitFor();
    assert.deepEqual(await rowsOf(page), [
      [21, 'Career picked this for you', ['Prepare application', 'Remove']],
      [1, 'Career picked this for you', ['Prepare application', 'Remove']],
    ], 'a pick is not a filtered result: both picks are still there, and the saved job the search did not match is not');
    assert.equal(await page.getByRole('heading', { name: 'No jobs match these filters' }).count(), 0, 'the page is not an empty state while it shows picks');
    assert.equal(await page.locator('#requestState').innerText(), '2 shown');
    await page.locator('#list').getByRole('button', { name: 'Clear filters' }).click();
    await page.locator('.job-row[data-job-id="2"]').waitFor();
    assert.deepEqual((await rowsOf(page)).map((row) => row[0]), [21, 1, 2]);
    assert.equal(await page.getByText('No saved jobs match these filters.').count(), 0, 'the note leaves with the filter');
  } finally { await context.close(); }
});

test('a filter the page remembered from an earlier visit does not hide Career\'s picks', async () => {
  const state = account({ identity: { authenticated: true, tenant: 'fixture', principal_id: 'ada' } });
  const { page, context } = await openScreen(browser, 'career-job-lists.html', board(state), DESKTOP, '?view=saved');
  try {
    await page.locator('.job-row[data-job-id="21"]').waitFor();
    await page.locator('#q').fill('nurse');
    await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('career-journey:fixture:ada:saved') || 'null')?.filters?.q === 'nurse');
    await page.goto(`${ORIGIN}/screen?view=saved`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('q').value === 'nurse');
    await page.locator('.job-row[data-job-id="21"] .pick-mark').waitFor({ timeout: 5000 });
    assert.deepEqual((await rowsOf(page)).map((row) => [row[0], row[1]]), [[21, 'Career picked this for you'], [1, 'Career picked this for you']], 'the picks lead although the remembered search matches no saved job');
    assert.equal(await page.getByRole('heading', { name: 'No jobs match these filters' }).count(), 0);
  } finally { await context.close(); }
});

test('the second page of Saved does not repeat Career\'s picks', async () => {
  const state = account();
  const { page, context } = await openScreen(browser, 'career-job-lists.html', board(state), DESKTOP, '?view=saved&page=2');
  try {
    await page.locator('.job-row[data-job-id="2"]').waitFor();
    await page.waitForFunction(() => /^Showing 51/.test(document.getElementById('pager').innerText));
    // The page read its picks when it opened. A second read answers after the first has, so the picks are in hand by then.
    assert.deepEqual(await page.evaluate(async () => (await CareerStages.picks()).map((job) => job.id)), [21, 1], 'there are picks to repeat');
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    assert.deepEqual(await rowsOf(page), [[1, null, ['Prepare application', 'Unsave']], [2, null, ['Prepare application', 'Unsave']]], 'page 2 is the saved jobs only, each once and none marked as a pick');
  } finally { await context.close(); }
});
