/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Search under Career's own frame (judge's report 2026-11-11, changes 5, 7 and 10). The shipped tools/career-search.html in Chromium with the shipped frame drawn from a fixture profile, at 1440x900 and 412x915: the strip "Job Board / All openings / Recommended for you" is not shown under the frame and saved searches open from a button that says so; with the frame off, or under a frame whose bar came up with no Job Board link, the strip is as it was. A computer has one search box, and Job title contains, Job description contains and Company sit in Filters and still reach the request. On a phone the first job starts within 320px of the frame, every job title is a 44px target, the job type is in words beside one 44px link "About this pay estimate" that names the survey and month, Results per page and Sort are in the Filters sheet and still reach the request, and nothing is wider than the screen. Save and Saved replace the star and the Job Board wording.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.54.0's bar has Find jobs and My jobs as their own links and no row under it for Search, so the phone check reads the two links from the bottom bar.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The phone check also holds the search row to one filled button: Filters was filled beside Search.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Page names, judge's report 2026-11-11 (tests/career-page-names.test.mjs holds them): the strip's first link and the fixture's tile say My jobs.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 9: Applications is the Job Board's applied side, so a person who can open the Job Board has both My jobs and Applications in the phone's bottom bar; the expected links follow.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE, DESKTOP } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const item = (id, label, group, href, toolName) => ({ id, label, group, section: 'top', toolUi: { iframeUrl: href, visibilityToolName: toolName } });
/** The person's sections as the kernel answers them: enough for the frame's bar, the row under it and the phone's bottom bar. */
const profile = { name: 'career-hunter', profile: { name: 'career-hunter', ribbon: { items: [
  item('tool-career-home', 'Home', null, '/api/career-hunter/home', 'career-home'),
  item('tool-career-search', 'Search Jobs', 'Job Search', '/api/career-hunter/search-ui', 'career-search'),
  item('tool-career-board', 'My jobs', 'Job Search', '/api/career-hunter/board-native', 'career-board'),
  item('tool-career-resume-studio', 'Resume Studio', 'Resume', '/api/career-hunter/resume-studio', 'career-resume-studio'),
] } } };
const hostile = '<img src=x onerror="window.__injected=1">';
const jobs = [
  { id: 1, title: 'Senior Software Engineer, Data Engineering', company: 'Example Co', location: 'Palo Alto, CA', posted_date: '2026-11-06', industry: 'Software', job_type: 'fte', remote: 1,
    salary_min: 105210, salary_max: 171980, salary_currency: 'USD', salary_period: 'year', salary_source: 'bls_estimated',
    salary_estimate: { source: 'BLS OEWS', survey: 'May 2025', occupation: `Software Developers ${hostile}`, method: 'National occupation wage range.' }, url: 'https://employer.example.com/1' },
  { id: 2, title: 'Warehouse Supervisor', company: 'Example Freight', location: 'Austin, TX', posted_date: '2026-11-05', job_type: 'parttime', favorite: true },
  ...Array.from({ length: 4 }, (_, i) => ({ id: i + 3, title: `Office Manager ${i + 3}`, company: 'Example Co', location: 'Austin, TX', posted_date: '2026-11-01', job_type: 'contract' })),
];

/** Fixture answers; `seen` collects every browse request's query. */
function search(seen = [], sections = true) {
  return ({ url }) => {
    const p = url.pathname;
    if (p === '/api/ui/profile') return sections && url.searchParams.get('name') === 'career-hunter' ? { json: profile } : { status: 403, json: { refused: 'deny' } };
    if (p === '/api/auth/user') return { json: { authenticated: true, tenant: 'fixture', principal_id: 'ada', displayName: 'Ada Lovelace' } };
    if (p === '/api/career-hunter/jobs/stats') return { json: { saved: 1, byStatus: [] } };
    if (p === '/api/career-hunter/browse') { seen.push(url.searchParams); return { json: { jobs, browse: true, page: 1, per: 50, exhausted: true } }; }
    return null;
  };
}
/** The page's real address, so the frame knows it is Search Jobs and draws the Job Search row under its bar. */
const HERE = '/api/career-hunter/search-ui';
const framed = (page) => page.waitForSelector('.cf-topbar[data-cf-ready]');
/** Where the frame ends: the bottom of the bar and of the row of the section's pages under it. */
const frameEnd = (page) => page.evaluate(() => Math.max(...[...document.querySelectorAll('.cf-topbar, .cf-subnav')].filter((el) => !el.hidden).map((el) => el.getBoundingClientRect().bottom)));
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('phone: under the frame the first job starts within 320px, with 44px titles and nothing wider than the screen', async () => {
  const seen = [];
  const { page, context } = await openScreen(browser, 'career-search.html', search(seen), PHONE, '', HERE);
  try {
    await framed(page);
    const first = page.locator('#list .job').first();
    await first.waitFor();
    assert.equal(await page.locator('.cf-bottombar').isVisible(), true, 'the phone has its bottom bar');
    assert.deepEqual(await page.locator('.cf-bottombar a[data-cf-view="search"], .cf-bottombar a[data-cf-view="board"]').allTextContents(), ['Find jobs', 'My jobs', 'Applications'], 'and it already goes to those places: the Job Board is My jobs and Applications');
    assert.equal(await page.locator('.career-view-nav').isVisible(), false, 'so the strip is not shown');
    const fill = (selector) => page.locator(selector).evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.notEqual(await fill('#openSearchFilters'), await fill('#keywordSearch .ck-primary'), 'Search is the one filled button in the search row; Filters is outlined');
    assert.doesNotMatch(await page.locator('.wrap').innerText(), /All openings|Recommended for you/);
    const below = (await first.boundingBox()).y + await page.evaluate(() => window.scrollY) - await frameEnd(page);
    assert.ok(below <= 320, `the first job starts ${Math.round(below)}px under the frame`);
    for (const title of await page.locator('#list .job-title').all()) assert.ok((await title.boundingBox()).height >= 44, 'a job title is a 44px target');
    assert.ok(await fits(page), 'nothing is wider than the screen');
    assert.equal(await page.locator('#per').isVisible(), false, 'Results per page waits in the Filters sheet');
    await page.getByRole('button', { name: 'Filters', exact: true }).tap();
    const sheet = page.getByRole('dialog', { name: 'Filters' });
    await sheet.waitFor();
    await sheet.getByLabel('Sort by').selectOption('salary');
    await page.waitForFunction(() => new URLSearchParams(location.search).get('sort') === 'salary');
    await sheet.getByLabel('Results per page').selectOption('25');
    await page.waitForFunction(() => new URLSearchParams(location.search).get('per') === '25');
    assert.equal(seen.at(-1).get('sort'), 'salary');
    assert.equal(seen.at(-1).get('per'), '25');
    await sheet.getByText('Advanced: job title, description, company').tap();
    assert.equal(await sheet.getByLabel('Job title contains').isVisible(), true);
    await sheet.getByRole('button', { name: 'Done' }).tap();
    await page.waitForFunction(() => !document.getElementById('searchSheet').open && document.querySelector('.bar > #viewOptions') && document.querySelector('.cols > #rail'));
    assert.ok(await fits(page));
  } finally { await context.close(); }
});

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: a job says its type in words and where its pay estimate comes from, in one row`, async () => {
    const { page, context } = await openScreen(browser, 'career-search.html', search(), size, '', HERE);
    try {
      await framed(page);
      const card = page.locator('#job-1');
      await card.waitFor();
      const row = card.locator('.job-about');
      assert.deepEqual(await row.locator('span').allTextContents(), ['Full time', 'Remote']);
      const about = row.getByRole('link', { name: /^About this pay estimate/ });
      assert.equal(await about.textContent(), `About this pay estimate: US wages for Software Developers ${hostile}, May 2025`);
      assert.equal(await about.getAttribute('href'), 'https://www.bls.gov/oes/tables.htm');
      assert.equal(await page.evaluate(() => window.__injected), undefined, 'text from the feed stays text');
      if (size === PHONE) assert.ok((await about.boundingBox()).height >= 44, 'a 44px target on a phone');
      const text = await card.innerText();
      assert.match(text, /\$105k–\$172k \/yr · estimate/);
      assert.doesNotMatch(text, /\bfte\b|BLS May 2025|US national/);
      assert.deepEqual(await page.locator('#job-2 .job-about span').allTextContents(), ['Part time']);
      assert.equal(await page.locator('#job-2 .pay-about').count(), 0, 'no estimate, no link');
      assert.equal(await card.getByRole('button', { name: 'Save', exact: true }).count(), 1);
      assert.equal(await page.locator('#job-2').getByRole('link', { name: 'Saved', exact: true }).count(), 1);
      assert.doesNotMatch(await page.locator('.wrap').innerText(), /★|shortlist|Save to Job Board|On your Job Board/);
      assert.ok(await fits(page));
    } finally { await context.close(); }
  });

  test(`${label}: saved searches open from a button that says so`, async () => {
    const { page, context } = await openScreen(browser, 'career-search.html', search(), size, '', HERE);
    try {
      await framed(page);
      await page.locator('#list .job').first().waitFor();
      const open = page.getByRole('button', { name: 'Saved searches', exact: true });
      assert.equal(await open.innerText(), 'Saved searches', 'a visible word, not an icon');
      assert.ok((await open.boundingBox()).height >= 44);
      if (size === PHONE) await open.tap(); else await open.click();
      const popup = page.getByRole('dialog', { name: 'Saved searches' });
      await popup.waitFor();
      assert.equal(await popup.getByLabel('Save this search').isEnabled(), true);
      assert.ok(await fits(page));
    } finally { await context.close(); }
  });
}

test('computer: one search box; title, description and company are in Filters and reach the request', async () => {
  const seen = [];
  const { page, context } = await openScreen(browser, 'career-search.html', search(seen), DESKTOP, '', HERE);
  try {
    await framed(page);
    await page.locator('#list .job').first().waitFor();
    assert.equal(await page.locator('#keywordSearch input:visible').count(), 1, 'one box in the search row');
    assert.equal(await page.locator('#rail #adv').count(), 1, 'Advanced is part of Filters');
    assert.equal(await page.locator('#title').isVisible(), false);
    await page.getByText('Advanced: job title, description, company').click();
    for (const [name, value, key] of [['Job title contains', 'supervisor', 'title'], ['Job description contains', 'forklift', 'description'], ['Company', 'Example Freight', 'company']]) {
      await page.locator('#rail').getByLabel(name).fill(value);
      await page.waitForFunction(([k, v]) => new URLSearchParams(location.search).get(k) === v, [key, value]);
    }
    const last = seen.at(-1);
    assert.deepEqual([last.get('title'), last.get('description'), last.get('company')], ['supervisor', 'forklift', 'Example Freight']);
    assert.equal(await page.locator('#per').isVisible(), true, 'a computer keeps Results per page beside the results');
  } finally { await context.close(); }
});

test('computer: a link that carries an advanced filter opens Advanced so the filter is never hidden', async () => {
  const { page, context } = await openScreen(browser, 'career-search.html', search(), DESKTOP, '?company=Example%20Freight', HERE);
  try {
    await page.locator('#list .job').first().waitFor();
    assert.equal(await page.locator('#rail').getByLabel('Company').inputValue(), 'Example Freight');
    assert.equal(await page.locator('#rail').getByLabel('Company').isVisible(), true);
  } finally { await context.close(); }
});

test('without the frame the strip of view links and its saved-search control are as they were', async () => {
  const { page, context } = await openScreen(browser, 'career-search.html', search(), DESKTOP, '?frame=off', HERE);
  try {
    await page.locator('#list .job').first().waitFor();
    assert.equal(await page.locator('html').getAttribute('data-career-frame'), null);
    assert.deepEqual((await page.locator('.career-view-nav > :is(a, span)').allTextContents()).map((t) => t.trim()), ['My jobs', 'All openings', 'Recommended for you']);
    assert.equal(await page.locator('.saved-search-toggle').isVisible(), true);
    assert.equal(await page.locator('#savedSearchOpen').isVisible(), false);
  } finally { await context.close(); }
});

test('under a frame whose bar has no My jobs link, the strip stays as the way there', async () => {
  const { page, context } = await openScreen(browser, 'career-search.html', search([], false), DESKTOP, '', HERE);
  try {
    await framed(page);
    await page.locator('#list .job').first().waitFor();
    assert.equal(await page.locator('.cf-topbar a[data-cf-view]').count(), 0, 'the person\'s profile gave the frame no section');
    await page.locator('.career-view-nav').getByRole('link', { name: 'My jobs', exact: true }).waitFor();
    assert.equal(await page.locator('.saved-search-toggle').isVisible(), true);
    assert.equal(await page.locator('#savedSearchOpen').isVisible(), false, 'one saved-search control, not two');
  } finally { await context.close(); }
});
