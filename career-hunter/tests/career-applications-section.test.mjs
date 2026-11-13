/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Submission activity is folded into Applications and each move is said out loud (judge's report 2026-11-11, change 9). First the words in tools/career-status-line.js as plain functions: the five things an application can be, how a sent job says how Career knows, a stored UTC time read as UTC, and the one line for each move. Then the shipped pages and the shipped frame in Chromium, drawn from a fixture profile at each page's real address, at 1440x900 and at 412x915 with touch: the bar's Applications opens the Job Board on the jobs a person has applied to and is marked on Applied, Interviewing, Offer and Closed, and My jobs on the rest; no menu lists the activity page, and the bar marks Applications while it is open; each applied job carries one status line; what Career is sending from the person's computer leads Applied as Waiting, Sending, Needs your answer or Did not go through, each opening its application without a write; one quiet link to the activity page is there only while there is such a record, or the records could not be read; saving a job says so in one line and the bar's count and the stage row follow; I applied on the application page moves the bar from My jobs to Applications and the bar counts the application, and an application opened with no stage in its address is marked on the side its job is on; Home's New matches card shows a number, its pipeline has no To approve, and no card opens the activity page.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The Applied stage holds its filled buttons to the next thing to do on a job: Search and View application were filled beside every Open application.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Review of 1.55.0, item 1: Home's step about Career's picks opens the picks address (?view=approve), not ?view=saved.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Review of 1.55.0, item 5: a job the person marked themselves, and one with no record of how it was sent, leads with Applied; Sent stays for what a computer reported or a confirmation page Career holds. The status-line cases pin the whole line for each source, and the Applied rows in the browser read "Applied · November 10 · You marked this as applied yourself…" and "Applied · Career has no record of how this was sent." beside the two that still read Sent.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Open the phone List view from its Filters sheet while preserving save and stage-count checks.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Keep actionable match counts and links distinct from dated scoring activity while preserving saved and pipeline records.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { openScreen, playwright, PHONE, DESKTOP, ORIGIN } from './helpers/ux-page.mjs';

const line = createRequire(import.meta.url)('../tools/career-status-line.js');

test('an application Career sends is one of five things, a retired record is none of them, and Applied is the word for a person\'s own', () => {
  const word = (status) => line.forSubmission({ status })?.word ?? null;
  assert.deepEqual(['queued', 'claimed', 'reviewing', 'submitting', 'submitted', 'needs_you', 'unknown', 'failed', 'cancelled', 'new-status'].map(word),
    ['Waiting', 'Sending', 'Sending', 'Sending', 'Sent', 'Needs your answer', 'Needs your answer', 'Did not go through', null, null]);
  assert.deepEqual(Object.values(line.WORDS), ['Waiting', 'Sending', 'Sent', 'Applied', 'Needs your answer', 'Did not go through']);
  assert.equal(line.forSubmission({ status: 'unknown' }).detail, 'Career could not confirm that it arrived. Check with the employer before trying again.', 'an uncertain outcome is never called a failure or a success');
  assert.equal(line.forSubmission(null), null);
});

test('an applied job says how Career knows, reads Sent only for what a computer reported or a confirmation Career holds, and claims a confirmation only when one is on record', () => {
  const detail = (extra) => line.forJob({ status: 'applied', applied_at: '2026-11-10T15:00:00Z', ...extra }, 'en-US');
  assert.deepEqual(detail({ application_source: 'manual-mark' }), { kind: 'applied', word: 'Applied', day: 'November 10', detail: 'You marked this as applied yourself. Career has no confirmation that it was sent.' }, 'a person\'s own word is not called Sent');
  assert.deepEqual(detail({ application_source: 'worker-reported' }), { kind: 'sent', word: 'Sent', day: 'November 10', detail: 'Your computer reported it sent. The employer has not confirmed receipt.' });
  assert.deepEqual(detail({ application_source: 'verified-submission', confirmation_path: '/private/confirm.png' }), { kind: 'sent', word: 'Sent', day: 'November 10', detail: 'Career kept a copy of the confirmation page. That does not mean the employer has accepted it.' });
  for (const unproven of [{ application_source: 'verified-submission' }, { application_source: 'verified-submission', confirmation_path: '  ' }, { application_source: 'something-new' }, {}])
    assert.deepEqual(detail(unproven), { kind: 'applied', word: 'Applied', day: 'November 10', detail: 'Career has no record of how this was sent.' }, `with no record of how it was sent the word is Applied: ${JSON.stringify(unproven)}`);
  assert.doesNotMatch(JSON.stringify(detail({ application_source: 'verified-submission', confirmation_path: '/private/confirm.png', application_task_id: 'apply-123456' })), /private|apply-123456/, 'no path or task id is in the line');
  assert.equal(line.forJob({ status: 'applied' }, 'en-US').day, '', 'a job with no recorded day shows none');
});

test('a stored time is read as the UTC it was written in, and a move is one line', () => {
  assert.equal(line.when('2026-11-11 02:00:00').toISOString(), '2026-11-11T02:00:00.000Z', 'SQLite\'s datetime has no zone and is UTC');
  assert.equal(line.when('2026-11-11T02:00:00.000Z').toISOString(), '2026-11-11T02:00:00.000Z');
  assert.equal(line.when('not a time'), null);
  assert.equal(line.when(''), null);
  const job = { title: 'Office Manager', company: 'Acme' }, at = new Date('2026-11-10T15:00:00Z');
  assert.equal(line.move('applied', job, at, 'en-US'), 'Applied to Acme, November 10.');
  assert.equal(line.move('applied', job, at, 'en-GB'), 'Applied to Acme, 10 November.');
  assert.equal(line.move('applied', { title: 'Office Manager' }, at, 'en-US'), 'Applied: Office Manager, November 10.');
  assert.equal(line.move('saved', job), 'Saved: Office Manager at Acme.');
  assert.equal(line.move('unsaved', job), 'Unsaved: Office Manager at Acme.');
  assert.equal(line.move('preparing', job), 'Getting ready: Office Manager at Acme.');
  assert.equal(line.move('removed', { company: 'Acme' }), 'Removed: Acme.');
  assert.equal(line.move('removed', null), 'Removed.');
  assert.equal(line.move('promoted', job), '', 'a move with no name for a person is not said');
  for (const kind of ['applied', 'saved', 'unsaved', 'preparing', 'removed']) assert.doesNotMatch(line.move(kind, job, at, 'en-US'), /—/, 'no em dash');
});

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const BOARD = '/api/career-hunter/board-native';
const tile = (name, label, href) => ({ id: `tool-career-${name}`, label, section: 'top', toolUi: { iframeUrl: href, visibilityToolName: `career-${name}` } });
const PROFILE = { profile: { name: 'career-hunter', ribbon: { items: [
  tile('home', 'Home', '/api/career-hunter/home'), tile('search', 'Search Jobs', '/api/career-hunter/search-ui'), tile('board', 'Job Board', BOARD),
  tile('submission-activity', 'Submission activity', '/api/career-hunter/submissions'), tile('resume-studio', 'Resume Studio', '/api/career-hunter/resume-studio'),
  tile('insights', 'Insights', '/api/career-hunter/insights-ui'), tile('settings', 'Career Settings', '/api/career-hunter/settings'),
] } } };
const at = (size) => ({ ...size, locale: 'en-US', timezoneId: 'UTC' });
const job = (id, extra = {}) => ({ id, title: `Office Manager ${id}`, company: `Employer ${id}`, location: 'Austin, TX', status: 'applied', favorite: true, active: 1, applied_at: '2026-11-10 15:00:00', ...extra });
const item = (postingId, status, extra = {}) => ({ id: `s-${postingId}`, postingId, title: `Office Manager ${postingId}`, company: `Employer ${postingId}`, status, updatedAt: '2026-11-10T15:00:00Z', ...extra });

/**
 * @description Fixture answers for the framed Job Board, the activity page and Home.
 * @param {{stats?: object, jobs?: object[], one?: Record<number, object>, items?: object[]|null, writes?: object[], summary?: object|null, records?: object[]}} state - What
 *   /jobs/stats, the feed, each /jobs/:id, /submission-queue (null: the read fails), /home-summary and /applications answer.
 * @returns {(req: {method: string, url: URL, body: any}) => object|null} The handler openScreen takes.
 */
function career(state) {
  return ({ method, url, body }) => {
    const p = url.pathname, one = p.match(/^\/api\/career-hunter\/jobs\/(\d+)$/);
    if (p === '/api/ui/profile') return url.searchParams.get('name') === 'career-hunter' ? { json: PROFILE } : { status: 403, json: { refused: 'deny' } };
    if (p === '/api/auth/user') return { json: { displayName: 'Ada Lovelace', authenticated: false } };
    if (p === '/api/career-hunter/jobs/stats') return { json: state.stats || { saved: 0, applied: 0, interviewing: 0, queued: 0, tracked: 0, byStatus: [] } };
    if (p === '/api/career-hunter/resume/state') return { json: { hasResume: true, roles: 4, name: 'Ada', indexing: false, scored: 12 } };
    if (p === '/api/career-hunter/applications') return { json: { applications: state.records || [] } };
    if (p === '/api/career-hunter/submission-queue' && method === 'GET') return state.items === null ? { status: 503, json: { error: 'unavailable' } } : { json: { items: state.items || [] } };
    if (one && method === 'GET') return state.one?.[one[1]] ? { json: { job: state.one[one[1]] } } : { status: 404, json: { error: 'not found' } };
    if (method === 'POST') { state.writes?.push({ path: p, body }); if (/\/jobs\/\d+\/status$/.test(p) && body.favorite && state.afterSave) state.stats = state.afterSave; state.onPost?.(p, body); return { json: { ok: true } }; }
    if (p === '/api/career-hunter/jobs') return { json: { jobs: state.jobs || [], exhausted: true, exclusions: [] } };
    if (p === '/api/career-hunter/home-summary') return state.summary === null ? { status: 503, json: { error: 'unavailable' } } : { json: state.summary || { metrics: [] } };
    if (p === '/api/career-hunter/jobs/updates') return { json: { status: 'connected', events: [] } };
    if (p === '/api/career-hunter/experience-bank') return { json: { version: 1, revision: 'r1', entries: [] } };
    if (p === '/api/v1/agent/schedules') return { json: { schedules: [] } };
    if (p === '/api/apply-operator/workers') return { json: { workers: [], available: false, observedBrowserNodes: [] } };
    if (p === BOARD || p === '/api/career-hunter/submissions') return { text: 'another page' };
    return { json: {} };
  };
}
const ready = (page) => page.waitForSelector('.cf-topbar[data-cf-ready]');
const marks = (page, selector) => page.locator(selector).evaluateAll((nodes) => nodes.map((node) => node.textContent.trim() + (node.getAttribute('aria-current') ? '*' : '')));
const board = (state, size, query = '') => openScreen(browser, 'career-job-lists.html', career(state), at(size), query, BOARD);
const press = (size, target) => (size === PHONE ? target.tap() : target.click());

test('computer: Applications opens the jobs a person has applied to, the bar marks it on each of its stages and My jobs on the rest, and no menu lists the activity page', async () => {
  for (const [query, section, row, status] of [
    ['?view=status', 'Applications', ['Applied', 'Interviewing', 'Offer', 'Closed'], 'tracked'], ['?view=interviewing', 'Applications', null, 'interview'],
    ['?view=offer', 'Applications', null, 'offer'], ['?view=closed', 'Applications', null, 'rejected'],
    ['', 'My jobs', ['New matches', 'Saved', 'Getting ready', 'Removed'], 'saved'], ['?view=queue', 'My jobs', null, 'queue'], ['?view=dismissed', 'My jobs', null, 'dismissed'], ['?view=approve', 'My jobs', null, 'saved'],
  ]) {
    const { page, context, calls } = await board({}, DESKTOP, query);
    try {
      await ready(page);
      assert.deepEqual(await marks(page, '.cf-topbar nav a'), ['Home', 'Find jobs', 'My jobs', 'Applications', 'Résumé'].map((label) => (label === section ? label + '*' : label)), query || 'no query');
      if (row) assert.deepEqual(await page.locator('#careerStages a[role=tab]').allTextContents(), row, 'the stage row is the row of that section');
      await page.waitForFunction(() => performance.getEntriesByType('resource').some((r) => r.name.includes('/api/career-hunter/jobs?')));
      assert.ok(calls.some((c) => c.path.startsWith('/api/career-hunter/jobs?') && new URLSearchParams(c.path.split('?')[1]).get('status') === status), `${query} asks the feed for ${status}`);
      const links = await page.locator('.cf-topbar nav a').evaluateAll((nodes) => Object.fromEntries(nodes.map((a) => [a.textContent, [a.getAttribute('href'), a.getAttribute('data-cf-view'), a.getAttribute('data-cf-query')]])));
      assert.deepEqual(links.Applications, [`${BOARD}?view=status`, 'board', 'view=status']);
      assert.deepEqual(links['My jobs'], [`${BOARD}?view=saved`, 'board', 'view=saved']);
      await page.click('.cf-more-desk > summary');
      assert.deepEqual(await marks(page, '.cf-more-desk .cf-menu a'), ['← All applications', 'Insights', 'Career Settings'], 'the activity page is under no menu');
    } finally { await context.close(); }
  }
});

test('phone: the bottom bar marks Applications on a person\'s applications and My jobs on their jobs, and its sheet does not list the activity page', async () => {
  const applied = await board({}, PHONE, '?view=offer');
  try {
    await ready(applied.page);
    assert.deepEqual(await marks(applied.page, '.cf-bottombar > a, .cf-bottombar > details > summary'), ['Home', 'Find jobs', 'My jobs', 'Applications*', 'More']);
    assert.equal(await applied.page.locator('.cf-bottombar > a', { hasText: 'Applications' }).getAttribute('href'), `${BOARD}?view=status`);
    for (const height of await applied.page.locator('.cf-bottombar > a').evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height))) assert.ok(height >= 44);
    await applied.page.tap('.cf-bottom-more > summary');
    assert.deepEqual(await marks(applied.page, '.cf-sheet a'), ['Resume Studio', 'Insights', 'Career Settings', '← All applications']);
    assert.ok(await applied.page.evaluate(() => document.documentElement.scrollWidth <= 412), 'nothing is wider than the screen');
  } finally { await applied.context.close(); }
  const mine = await board({}, PHONE, '?view=queue');
  try {
    await ready(mine.page);
    assert.deepEqual(await marks(mine.page, '.cf-bottombar > a, .cf-bottombar > details > summary'), ['Home', 'Find jobs', 'My jobs*', 'Applications', 'More']);
  } finally { await mine.context.close(); }
});

test('the activity page is still served, and the bar marks Applications while it is open', async () => {
  const { page, context } = await openScreen(browser, 'career-submissions.html', career({}), at(DESKTOP), '', '/api/career-hunter/submissions');
  try {
    await ready(page);
    await page.getByRole('heading', { name: 'Nothing sent yet' }).waitFor();
    assert.deepEqual(await marks(page, '.cf-topbar nav a'), ['Home', 'Find jobs', 'My jobs', 'Applications*', 'Résumé']);
  } finally { await context.close(); }
});

test('one application opened with no stage in its address is marked on the side the job is on', async () => {
  const one = { 7: job(7, { application_source: 'manual-mark', application: { needsGeneration: false } }), 8: job(8, { status: 'generated', has_resume: true, has_cover: true, board: {}, application: { needsGeneration: false, draft: { revision: 1, guidance: '', experienceIds: [] } } }) };
  const applied = await openScreen(browser, 'career-application.html', career({ one }), at(DESKTOP), '?application=7', BOARD);
  try {
    await applied.page.getByRole('heading', { name: 'Application status' }).waitFor();
    await applied.page.waitForFunction(() => document.querySelector('.cf-topbar nav a[aria-current]')?.textContent === 'Applications');
    assert.deepEqual(await marks(applied.page, '.cf-topbar nav a'), ['Home', 'Find jobs', 'My jobs', 'Applications*', 'Résumé']);
    assert.equal(new URL(applied.page.url()).searchParams.get('view'), 'status');
  } finally { await applied.context.close(); }
  const preparing = await openScreen(browser, 'career-application.html', career({ one }), at(PHONE), '?application=8', BOARD);
  try {
    await preparing.page.getByRole('heading', { name: 'Review the documents for this job' }).waitFor();
    await ready(preparing.page);
    assert.deepEqual(await marks(preparing.page, '.cf-bottombar > a, .cf-bottombar > details > summary'), ['Home', 'Find jobs', 'My jobs*', 'Applications', 'More']);
  } finally { await preparing.context.close(); }
});

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: I applied moves the bar from My jobs to Applications and the bar counts the application`, async () => {
    const applying = job(8, { status: 'generated', applied_at: null, has_resume: true, has_cover: true, url: 'https://jobs.example.com/apply/8', board: {}, application: { needsGeneration: false, draft: { revision: 1, guidance: '', experienceIds: [] } } });
    const state = { writes: [], one: { 8: applying }, stats: { saved: 3, applied: 0, interviewing: 0, queued: 1, tracked: 0, byStatus: [] } };
    state.onPost = (path, body) => {
      if (!path.endsWith('/jobs/8/status') || body.status !== 'applied') return;
      Object.assign(applying, { status: 'applied', application_source: 'manual-mark', applied_at: '2026-11-10 15:00:00' });
      state.stats = { saved: 3, applied: 1, interviewing: 0, queued: 0, tracked: 1, byStatus: [] };
    };
    const bar = size === PHONE ? '.cf-bottombar > a' : '.cf-topbar nav a';
    const { page, context } = await openScreen(browser, 'career-application.html', career(state), at(size), '?view=queue&application=8', BOARD);
    try {
      await ready(page);
      await page.getByRole('heading', { name: 'Review the documents for this job' }).waitFor();
      assert.ok((await marks(page, bar)).includes('My jobs*'));
      assert.equal((await page.textContent('.cf-chip')).trim(), '3 saved');
      await press(size, page.getByRole('button', { name: 'Continue to send', exact: true }));
      await press(size, page.getByRole('button', { name: 'I applied', exact: true }));
      await page.getByRole('heading', { name: 'Application status' }).waitFor();
      await page.waitForFunction(() => document.querySelector('.cf-chip')?.textContent.trim() === '1 applied');
      const now = await marks(page, bar);
      assert.ok(now.includes('Applications*') && now.includes('My jobs'), `the bar marks Applications: ${now}`);
      assert.match(await page.locator('#message').innerText(), /^Applied to Employer 8, [A-Z][a-z]+ \d{1,2}\.$/);
      const said = await page.locator('#message').boundingBox(), bottom = size === PHONE ? (await page.locator('.cf-bottombar').boundingBox()).y : page.viewportSize().height;
      assert.ok(said.y >= 0 && said.y + said.height <= bottom, 'the line is inside the window, above the phone\'s bottom bar');
    } finally { await context.close(); }
  });
}

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: each applied job carries one status line, and what is being sent leads Applied with its own`, async () => {
    const state = { writes: [],
      jobs: [job(1, { application_source: 'manual-mark' }), job(2, { application_source: 'verified-submission', confirmation_path: '/private/c.png', status: 'interview' }), job(3, { application_source: 'worker-reported' }), job(4, { applied_at: null })],
      items: [item(31, 'queued'), item(32, 'submitting'), item(33, 'needs_you'), item(34, 'failed'), item(35, 'unknown'), item(3, 'submitted'), item(36, 'failed'), item(37, 'cancelled')],
      one: { 31: job(31, { status: 'generated' }), 32: job(32, { status: 'generated' }), 33: job(33, { status: 'deferred' }), 34: job(34, { status: 'generated' }), 36: job(36, { status: 'applied', application_source: 'manual-mark' }) } };
    const { page, context } = await board(state, size, '?view=status');
    try {
      await page.locator('.job-row[data-job-id="sending-35"]').waitFor();
      const lines = await page.locator('.job-row').evaluateAll((rows) => rows.map((row) => [row.dataset.jobId, row.querySelectorAll('.app-line').length, row.querySelector('.app-line')?.textContent ?? null]));
      assert.deepEqual(lines, [
        ['sending-31', 1, 'Waiting · You approved it. Your computer has not started it yet.'],
        ['sending-32', 1, 'Sending · Your computer is filling in the employer\'s form.'],
        ['sending-33', 1, 'Needs your answer · The employer\'s form asks something Career could not answer for you.'],
        ['sending-34', 1, 'Did not go through · Your computer stopped before the form was sent.'],
        ['sending-35', 1, 'Needs your answer · Career could not confirm that it arrived. Check with the employer before trying again.'],
        ['1', 1, 'Applied · November 10 · You marked this as applied yourself. Career has no confirmation that it was sent.'],
        ['2', 1, 'Sent · November 10 · Career kept a copy of the confirmation page. That does not mean the employer has accepted it.'],
        ['3', 1, 'Sent · November 10 · Your computer reported it sent. The employer has not confirmed receipt.'],
        ['4', 1, 'Applied · Career has no record of how this was sent.'],
      ], 'one line each; a job already applied to is not also listed as being sent (36), nor is a sent or retired record (3, 37)');
      assert.equal(await page.locator('#requestState').innerText(), '9 shown', 'the count is what the list shows');
      assert.doesNotMatch(await page.locator('#list').innerText(), /Application recorded|marked manually|verified in/i);
      assert.doesNotMatch(await page.locator('#list').innerText(), /private|c\.png/, 'no confirmation path is shown');
      assert.deepEqual([...new Set(await page.locator(':is(.ck-primary, .btn.primary):visible').allInnerTexts())], ['Open application'],
        'the filled button is the next thing to do on a job; Search and View application are outlined');
      assert.equal(await page.getByRole('button', { name: 'View application', exact: true }).count(), 4, 'each applied job can still be opened');
      const link = page.getByRole('link', { name: 'Follow what is being sent' });
      assert.equal(await link.isVisible(), true, 'one quiet link while something is being sent or did not go through');
      assert.equal(await link.getAttribute('href'), '/api/career-hunter/submissions');
      assert.equal(await page.locator('a[href="/api/career-hunter/submissions"]:visible').count(), 1, 'and only one');
      assert.ok((await link.boundingBox()).height >= 44, 'a 44px target');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'nothing is wider than the screen');
      assert.deepEqual(await page.locator('.job-row[data-job-id="sending-31"] .row-actions button').allTextContents(), ['Open application']);
      await press(size, page.locator('.job-row[data-job-id="sending-31"]').getByRole('button', { name: 'Open application', exact: true }));
      await page.waitForURL((url) => url.pathname === BOARD && url.searchParams.get('application') === '31' && url.searchParams.get('view') === 'queue');
      assert.deepEqual(state.writes.filter((w) => !/\/submission-queue\//.test(w.path)), [], 'opening it changes nothing about the job');
    } finally { await context.close(); }
  });
}

test('the quiet link is absent when nothing is being sent, and present when that could not be read', async () => {
  const none = await board({ jobs: [job(1, { application_source: 'manual-mark' })], items: [item(1, 'submitted'), item(9, 'cancelled')] }, DESKTOP, '?view=status');
  try {
    await none.page.locator('.job-row[data-job-id="1"] .app-line').waitFor();
    await none.page.waitForFunction(() => performance.getEntriesByType('resource').filter((r) => r.name.endsWith('/api/career-hunter/submission-queue') && r.responseEnd > 0).length >= 2);
    assert.equal(await none.page.locator('#activityLink').isVisible(), false);
    assert.equal(await none.page.locator('.job-row').count(), 1);
  } finally { await none.context.close(); }
  const unread = await board({ jobs: [job(1)], items: null }, PHONE, '?view=status');
  try {
    await unread.page.getByRole('link', { name: 'Follow what is being sent' }).waitFor();
    assert.equal(await unread.page.locator('.job-row').count(), 1, 'the applied jobs are still listed');
  } finally { await unread.context.close(); }
  const jobs = await board({ jobs: [job(5, { status: 'new' })], items: [item(31, 'queued')], one: { 31: job(31, { status: 'generated' }) } }, DESKTOP, '');
  try {
    await jobs.page.locator('.job-row[data-job-id="5"]').waitFor();
    assert.equal(await jobs.page.locator('#activityLink').isVisible(), false, 'My jobs does not read or link what is being sent');
    assert.ok(!jobs.calls.some((c) => c.path.startsWith('/api/career-hunter/submission-queue')));
  } finally { await jobs.context.close(); }
});

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: saving a job says so in one line, and the bar's count and the stage row follow`, async () => {
    const state = { writes: [], stats: { saved: 1, applied: 0, interviewing: 0, queued: 0, tracked: 0, byStatus: [] }, afterSave: { saved: 2, applied: 0, interviewing: 0, queued: 0, tracked: 0, byStatus: [] },
      jobs: [job(8, { status: 'new', favorite: false, ai_fit_score: 88, title: 'Dispatcher', company: 'Acme' })] };
    const { page, context } = await openScreen(browser, 'career-job-lists.html', career(state), { ...at(size), ...(size === PHONE ? {} : {}) }, '?view=matches', BOARD);
    try {
      await ready(page);
      assert.equal((await page.textContent('.cf-chip')).trim(), '1 saved');
      if (size === PHONE) {
        await page.getByRole('button', { name: 'Filters', exact: true }).tap();
        await page.getByRole('tab', { name: 'List' }).tap();
        await page.getByRole('button', { name: 'Done', exact: true }).tap();
      }
      const save = page.locator('.job-row[data-job-id="8"]').getByRole('button', { name: 'Save', exact: true });
      await save.waitFor();
      await press(size, save);
      await page.getByText('Saved: Dispatcher at Acme.').waitFor();
      assert.equal(await page.locator('#actionState').isVisible(), true, 'the line is on screen');
      await page.waitForFunction(() => document.querySelector('.cf-chip')?.textContent.trim() === '2 saved');
      await page.waitForFunction(() => [...document.querySelectorAll('#careerStages a[role=tab]')].some((a) => a.textContent === 'Saved2'));
      const said = await page.locator('#actionState').boundingBox(), viewport = page.viewportSize(), bar = size === PHONE ? await page.locator('.cf-bottombar').boundingBox() : null;
      assert.ok(said.y >= 0 && said.y + said.height <= (bar ? bar.y : viewport.height), 'inside the window, and above the phone\'s bottom bar');
    } finally { await context.close(); }
  });
}

test('once a person has applied, the bar counts their applications, the same number the Applied stage shows', async () => {
  const { page, context } = await board({ stats: { saved: 4, applied: 2, interviewing: 0, queued: 1, tracked: 3, byStatus: [] } }, DESKTOP, '?view=status');
  try {
    await ready(page);
    assert.equal((await page.textContent('.cf-chip')).trim(), '3 applied');
    assert.equal(await page.locator('.cf-chip').getAttribute('href'), `${BOARD}?view=status`);
    assert.deepEqual(await page.locator('#careerStages a[role=tab]').allTextContents(), ['Applied3', 'Interviewing', 'Offer', 'Closed'], 'the row counts what the feed counts');
  } finally { await context.close(); }
});

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: Home's New matches card shows a number, its pipeline has no To approve, and no card opens the activity page`, async () => {
    const state = { stats: { matches:5, saved: 7, applied: 2, interviewing: 1, queued: 3, tracked: 4, byStatus: [{ status: 'interview', n: 1 }, { status: 'offer', n: 1 }] },
      summary: { metrics: [{ id: 'scored-24h', value: '99' }, { id: 'approval-review', value: '9' }] } };
    const { page, context } = await openScreen(browser, 'career-home.html', career(state), at(size), '', '/api/career-hunter/home');
    try {
      await ready(page);
      await page.waitForSelector('#todayPanel[aria-busy="false"]');
      assert.deepEqual(await page.locator('.stage').evaluateAll((nodes) => nodes.map((n) => n.querySelector('span').textContent + ' ' + n.querySelector('b').textContent)),
        ['New matches 5', 'Saved 7', 'Getting ready 3', 'Applied 4', 'Interviewing 1', 'Offer 1']);
      assert.doesNotMatch(await page.locator('#stages').innerText(), /→|To approve/);
      assert.equal(await page.locator('.stage[data-stage="matches"]').getAttribute('data-query'), 'view=matches&page=1');
      assert.deepEqual(await page.locator('#explore .tile strong').allTextContents(), ['Search Jobs', 'Job Board', 'Resume Studio', 'Insights', 'Career Settings']);
      assert.equal(await page.locator('a[href="/api/career-hunter/submissions"]').count(), 0);
      assert.equal(await page.locator('#today .step[data-step="approve"]').count(), 0, 'nine waiting records with no pick a person can act on are not a step');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'nothing is wider than the screen');
    } finally { await context.close(); }
  });
}

test('Home shows a dash, not a zero or an arrow, when the number of new matches could not be read, and counts Career\'s picks that are still waiting', async () => {
  const state = { summary: null, stats: { saved: 1, applied: 0, interviewing: 0, queued: 0, tracked: 0, byStatus: [] },
    records: [{ posting_id: 21, status: 'approval_required' }, { posting_id: 22, status: 'approval_required' }, { posting_id: 23, status: 'approval_required' }],
    one: { 21: job(21, { status: 'new' }), 22: job(22, { status: 'promoted' }), 23: job(23, { status: 'new' }) } };
  const { page, context } = await openScreen(browser, 'career-home.html', career(state), at(DESKTOP), '', '/api/career-hunter/home');
  try {
    await ready(page);
    await page.waitForSelector('#todayPanel[aria-busy="false"]');
    assert.equal(await page.locator('.stage[data-stage="matches"] b').textContent(), '–');
    const step = page.locator('#today .step[data-step="approve"]');
    assert.equal(await step.locator('strong').textContent(), '2 jobs Career picked are waiting for you', 'the one already prepared is not counted');
    assert.equal(await step.locator('a').textContent(), 'See Career\'s picks');
    assert.equal(await step.locator('a').getAttribute('href'), `${BOARD}?view=approve`, 'the picks address, which puts back no remembered filter');
    await step.locator('a').click();
    await page.waitForURL(`${ORIGIN}${BOARD}?view=approve`);
  } finally { await context.close(); }
});
