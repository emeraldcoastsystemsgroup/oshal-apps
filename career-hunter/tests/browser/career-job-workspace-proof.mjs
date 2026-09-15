/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise actual board/search entry, responsive job results, filters and retained workflow boundaries over synthetic local HTTP.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, startFixture } from './career-theme-fixture.mjs';

const jobs = [
  { id: 42, title: 'Senior Platform Engineer', company: 'Northstar Research', location: 'Remote, US', remote: true,
    ai_fit_score: 89, land_prob: 34, high_win: 81, salary_min: 140000, salary_max: 180000,
    has_resume: true, has_cover: true, status: 'generated', job_type: 'fte', posted_date: '2026-09-10', url: 'https://employer.invalid/jobs/42' },
  { id: 43, title: 'Infrastructure Engineer', company: 'Harbor Systems', location: 'Chicago, IL', remote: false,
    ai_fit_score: 83, salary_min: 120000, salary_max: 155000, status: 'applied', application_source: 'manual-mark', job_type: 'fte' },
];
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/** All data comes from this disposable server; even attempted mutations are refused. */
async function open(t, screen = 'board-native', options = {}) {
  const fixture = await startFixture({ respond: req => {
    if (req.path.endsWith('/resume/state')) return { body: { hasResume: !options.noResume, scored: options.noResume ? 0 : 2 } };
    if (req.path.endsWith('/jobs/stats')) return { body: { byStatus: [{ status: 'generated', n: 1 }, { status: 'applied', n: 1 }] } };
    if (req.path.endsWith('/jobs') || req.path.endsWith('/browse')) return options.denied
      ? { status: Number(options.denied) > 1 ? options.denied : 403, body: { error: 'Synthetic access denied' } }
      : { body: { jobs: options.empty || req.query.q === 'missing' ? [] : jobs, exhausted: !options.paging, browse: req.path.endsWith('/browse') } };
    if (req.path.endsWith('/jobs/42')) return { body: { job: { ...jobs[0], description: 'Synthetic job description.', rationale: 'Experience aligns with platform work.' } } };
  } });
  const context = await browser.newContext({ viewport: options.viewport ?? { width: 1280, height: 900 } });
  t.after(async () => { await context.close(); await fixture.close(); });
  await context.addInitScript(theme => { if (window.parent === window) localStorage.setItem('cockpit-theme', theme); }, options.theme ?? 'workspace');
  const external = [], errors = [];
  let releaseFeed, heldRequests = 0;
  const feedGate = options.holdJobs ? new Promise(resolve => { releaseFeed = resolve; }) : Promise.resolve();
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === fixture.origin) {
      if (options.holdJobs && new URL(route.request().url()).pathname.endsWith('/jobs')
        && (!options.holdFirstOnly || heldRequests++ === 0)) return feedGate.then(() => route.continue());
      return route.continue();
    }
    external.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(7000); page.on('pageerror', error => errors.push(error.message));
  if (options.clock) await page.clock.install();
  await page.goto(`${fixture.origin}/${options.embedded ? 'fixture/' : 'api/career-hunter/'}${screen}${options.query ?? ''}`);
  const surface = options.embedded ? page.frameLocator('iframe') : page;
  if (!options.holdJobs) await surface.locator(options.denied || options.empty ? '.empty' : screen === 'board-native' ? '#list .card' : '#list .job').first().waitFor();
  return { page, surface, fixture, external, errors, releaseFeed };
}

/** Geometry is checked before focusing inputs can silently scroll a broken page into view. */
async function geometry(surface) {
  return surface.locator('body').evaluate(body => ({
    width: document.documentElement.clientWidth, height: innerHeight, overflow: body.scrollWidth > innerWidth,
    firstJobTop: document.querySelector('#list > :first-child').getBoundingClientRect().top,
  }));
}

function clean(value) {
  assert.deepEqual(value.external, []); assert.deepEqual(value.errors, []);
  assert.deepEqual(value.fixture.requests.filter(row => !['GET', 'HEAD'].includes(row.method)), []);
}

/** Optional evidence uses these same asserted screens; screenshot capture is not a separate test. */
async function screenshot(page, name) {
  if (!process.env.CAREER_JOB_SCREENSHOT_DIR) return;
  await mkdir(process.env.CAREER_JOB_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: resolve(process.env.CAREER_JOB_SCREENSHOT_DIR, `${name}.png`) });
}

/** Arm the actual HTTP observation before the UI action can complete its request. */
async function queryAfter(page, path, key, value, action) {
  const [response] = await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === path
    && new URL(response.url()).searchParams.get(key) === value), action()]);
  return response;
}

test('board exposes Open jobs search and results before optional desktop setup', async t => {
  const value = await open(t), { page } = value;
  assert.equal(await page.getByRole('link', { name: 'Open jobs search', exact: true }).count(), 1);
  assert.equal(await page.getByRole('link', { name: 'Open jobs search', exact: true }).getAttribute('href'), '/api/career-hunter/search-ui');
  assert.equal(await page.locator('.career-submit-tools').getAttribute('open'), null);
  assert.match(await page.locator('#workerHint').innerText(), /No computer connected/);
  assert.ok((await geometry(page)).firstJobTop < 640);
  await screenshot(page, 'board-native-1280');
  await page.locator('.career-submit-tools > summary').click();
  assert.equal(await page.locator('#subAll').isVisible(), true);
  assert.equal(await page.locator('#copyAutofill').isVisible(), true);
  assert.equal(await page.locator('#applyRules > summary').isVisible(), true);
  clean(value);
});

test('standalone Board and Open jobs search round trip through their actual routes', async t => {
  const value = await open(t, 'board-native', { query: '?q=platform&remote=1' }), { page, fixture } = value;
  await page.locator('#q').fill('platform engineering');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('career-board.filters.v1') || '{}').q === 'platform engineering');
  await page.getByRole('link', { name: 'Open jobs search', exact: true }).click();
  await page.waitForURL(`${fixture.origin}/api/career-hunter/search-ui`);
  assert.equal(await page.locator('#q').inputValue(), '');
  await page.getByRole('link', { name: 'Job Board', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#q')?.value === 'platform engineering');
  assert.equal(await page.locator('#remote').isChecked(), true);
  clean(value);
});

test('embedded search entry sends only the admitted tool bridge and retains the current frame', async t => {
  const value = await open(t, 'board-native', { embedded: true }), { page, surface } = value;
  await page.evaluate(() => { window.originalFrame = document.querySelector('iframe'); });
  await surface.getByRole('link', { name: 'Open jobs search', exact: true }).click();
  await page.waitForFunction(() => window.careerNavigation?.length === 1);
  assert.deepEqual(await page.evaluate(() => window.careerNavigation), [{ type: 'app-navigate', tool: 'career-search' }]);
  assert.equal(await page.evaluate(() => document.querySelector('iframe') === window.originalFrame), true);
  clean(value);
});

for (const width of [320, 390, 768]) test(`open-job results precede expandable filters at ${width}px`, async t => {
  const value = await open(t, 'search-ui', { viewport: { width, height: 844 } }), { page } = value;
  const initial = await geometry(page);
  assert.equal(initial.overflow, false); assert.ok(initial.firstJobTop < 620, 'first opening must be visible without traversing the filter form');
  assert.equal(await page.locator('#jobSearchFilters').getAttribute('open'), null);
  if (width === 390) await screenshot(page, 'search-ui-390');
  await page.locator('#jobSearchFilters > summary').click();
  assert.equal(await page.locator('#state').isVisible(), true);
  await queryAfter(page, '/api/career-hunter/browse', 'state', 'IL', () => page.locator('#state').fill('IL'));
  await page.locator('#jobSearchFilters > summary').click();
  assert.match(await page.locator('#chips').innerText(), /Location: IL/);
  assert.equal((await geometry(page)).overflow, false); clean(value);
});

test('search keeps precise remote, company and advanced query controls with clearable chips', async t => {
  const value = await open(t, 'search-ui', { query: '?description=distributed&remote=1', paging: true }), { page } = value;
  assert.equal(await page.locator('#description').inputValue(), 'distributed');
  assert.equal(await page.locator('[data-remote="1"]').getAttribute('aria-pressed'), 'true');
  await queryAfter(page, '/api/career-hunter/browse', 'company', 'Northstar Research', () => page.locator('[data-company="Northstar Research"]').first().click());
  await queryAfter(page, '/api/career-hunter/browse', 'page', '2', () => page.locator('#next').click());
  await page.locator('#clear').click();
  await page.waitForFunction(() => document.querySelector('#chips').textContent === '');
  assert.equal(await page.locator('#description').inputValue(), ''); clean(value);
  await screenshot(page, 'search-ui-1280');
});

test('board keeps visible application provenance and actual detail request without a mutation', async t => {
  const value = await open(t), { page, fixture } = value;
  assert.match(await page.locator('[data-job-id="43"] .application-proof').innerText(), /Marked applied manually/);
  await page.locator('[data-job-id="42"]').getByRole('button', { name: 'Details', exact: true }).click();
  await page.locator('#d42').waitFor({ state: 'visible' });
  assert.ok(fixture.requests.some(row => row.path === '/api/career-hunter/jobs/42'));
  assert.equal(await page.locator('[data-job-id="42"]').getByRole('link', { name: 'Resume', exact: true }).getAttribute('href'), '/api/career-hunter/resume?id=42&kind=resume');
  clean(value);
});

test('no-resume browsing retains search access and hides submission tools', async t => {
  const value = await open(t, 'board-native', { noResume: true }), { page } = value;
  await page.waitForFunction(() => document.querySelector('#sub').textContent.includes('resume'));
  assert.equal(await page.getByRole('link', { name: 'Open jobs search', exact: true }).isVisible(), true);
  assert.equal(await page.locator('#subAll').isVisible(), false);
  assert.equal(await page.locator('.scores').count(), 0); clean(value);
});

test('failed search stays an error while navigation and filters remain available', async t => {
  const value = await open(t, 'search-ui', { denied: true }), { page } = value;
  assert.match(await page.locator('#list').innerText(), /Synthetic access denied/);
  assert.equal(await page.getByRole('link', { name: 'Job Board', exact: true }).isVisible(), true);
  assert.equal(await page.locator('#q').isEnabled(), true); clean(value);
});

test('both refined screens fit a narrow dark palette and preserve real controls', async t => {
  for (const screen of ['board-native', 'search-ui']) {
    const value = await open(t, screen, { theme: 'midnight', viewport: { width: 390, height: 844 } });
    assert.equal((await geometry(value.page)).overflow, false);
    assert.equal(await value.page.locator('html').getAttribute('data-theme'), 'midnight'); clean(value);
  }
});

test('mobile board keeps results near the top and its existing filters accessible', async t => {
  const value = await open(t, 'board-native', { viewport: { width: 390, height: 844 } }), { page } = value;
  assert.ok((await geometry(page)).firstJobTop < 650);
  await screenshot(page, 'board-native-390');
  await page.locator('#jobBoardFilters > summary').click();
  await queryAfter(page, '/api/career-hunter/jobs', 'min_score', '80', () => page.locator('#min_score').selectOption('80'));
  await page.locator('#jobBoardFilters > summary').click();
  assert.equal(await page.locator('#min_score').inputValue(), '80');
  assert.equal((await geometry(page)).overflow, false); clean(value);
});

test('expanding desktop tools preserves bulk confirmation and cancelling makes no request', async t => {
  const value = await open(t), { page } = value;
  await page.locator('.career-submit-tools > summary').click();
  const dialogue = new Promise(resolve => page.once('dialog', async dialog => {
    const message = dialog.message(); await dialog.dismiss(); resolve(message);
  }));
  await page.locator('#subAll').click();
  assert.match(await dialogue, /Queue EVERY packet-ready/);
  assert.equal(await page.locator('#subAll').isEnabled(), true); clean(value);
});

test('initial board visibly waits for the existing feed instead of leaving an empty area', async t => {
  const value = await open(t, 'board-native', { holdJobs: true }), { page } = value;
  try {
    assert.match(await page.locator('#list').innerText(), /Loading job matches/);
    assert.equal(await page.getByRole('link', { name: 'Open jobs search', exact: true }).isVisible(), true);
  } finally { value.releaseFeed(); }
  await page.locator('#list .card').first().waitFor(); clean(value);
});

test('a stalled board read times out visibly and retries only on request', async t => {
  const value = await open(t, 'board-native', { holdJobs: true, clock: true }), { page, fixture } = value;
  await page.clock.fastForward(30001);
  await page.locator('#retryJobs').waitFor();
  assert.match(await page.locator('#list').innerText(), /longer than 30 seconds/);
  assert.equal(fixture.requests.filter(row => row.path.endsWith('/jobs')).length, 0, 'held transport never reached the server');
  value.releaseFeed();
  await page.locator('#retryJobs').click();
  await page.locator('#list .card').first().waitFor(); clean(value);
});

for (const status of [403, 500]) test(`board HTTP ${status} is a retryable error, not an empty match set`, async t => {
  const value = await open(t, 'board-native', { denied: status }), { page, fixture } = value;
  await page.locator('#retryJobs').waitFor();
  assert.match(await page.locator('#list').innerText(), /Could not load jobs: Synthetic access denied/);
  assert.equal(fixture.requests.filter(row => row.path.endsWith('/jobs')).length, 1, 'initial failure must not start another request');
  clean(value);
});

test('valid zero matches remain an empty state with no error or retry mutation', async t => {
  const value = await open(t, 'board-native', { empty: true }), { page } = value;
  await page.waitForFunction(() => document.querySelector('#list').textContent.includes('No scored jobs'));
  assert.equal(await page.locator('#retryJobs').count(), 0); clean(value);
});

test('an older initial response cannot replace results for newer selected filters', async t => {
  const value = await open(t, 'board-native', { holdJobs: true, holdFirstOnly: true }), { page } = value;
  await queryAfter(page, '/api/career-hunter/jobs', 'q', 'missing', () => page.locator('#q').fill('missing'));
  await page.waitForFunction(() => document.querySelector('#list').textContent.includes('No scored jobs'));
  const released = await queryAfter(page, '/api/career-hunter/jobs', 'q', null, async () => value.releaseFeed());
  await released.finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.match(await page.locator('#list').innerText(), /No scored jobs/);
  assert.equal(await page.locator('#q').inputValue(), 'missing');
  assert.equal(await page.locator('#list .card').count(), 0); clean(value);
});
