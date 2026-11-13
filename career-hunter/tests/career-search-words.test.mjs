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
 * 6 | maintainer@emeraldcoastsystemsgroup.com | The filters case waits for the request that carries the company, not only for the address. The page writes its address and then sends the request; the fixture records a request when its route handler runs, a moment later on a busy machine, so the case read the request before it (company null) and failed gates now and then (store gates of 2026-11-11 and 2026-11-12, case 806). The page was right; the assertion is unchanged.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | G17 phone search:20-result default, honest page ranges, restored choices and44px More actions over the actual rendered page.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | G7 Most relevant defaults and literal title-first explanation, explicit saved order and honest limited fallback wording on the actual page.
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

test('G7: fresh keyword search defaults to Most relevant and explains literal title order on the shipped phone page',async()=>{
  const seen=[];
  const {page,context}=await openScreen(browser,'career-search.html',search(seen),PHONE,'?q=director',HERE);
  try{
    await until(()=>seen.length>0,'first relevance request');
    assert.equal(seen.at(-1).get('sort'),'relevant');
    await page.locator('#openSearchFilters').click();
    assert.equal(await page.locator('#sort').inputValue(),'relevant');
    assert.match(await page.locator('#sort option[value="relevant"]').textContent(),/Most relevant/);
    assert.match(await page.locator('#sortHelp').textContent(),/every searched keyword.*title|titles.*every searched keyword/i);
    assert.match(await page.locator('#sortHelp').textContent(),/without keywords.*newest/i);
  }finally{await context.close();}
});

test('G7: explicit newest remains selected and fallback paging describes a limited sample',async()=>{
  const seen=[];const base=search(seen);
  const handler=request=>request.url.pathname==='/api/career-hunter/browse'
    ? (seen.push(request.url.searchParams),{json:{jobs,browse:true,page:1,per:20,exhausted:true,pooled:true,deep:true}})
    :base(request);
  const {page,context}=await openScreen(browser,'career-search.html',handler,DESKTOP,'?q=director&sort=recent',HERE);
  try{
    await until(()=>seen.length>0,'explicit sort request');
    assert.equal(seen.at(-1).get('sort'),'recent');
    assert.equal(await page.locator('#sort').inputValue(),'recent');
    assert.match(await page.locator('#count').textContent(),/limited.*sample/i);
    assert.match(await page.locator('#pager').textContent(),/more.*may match/i);
    assert.doesNotMatch(await page.locator('#pager').textContent(),/End of results for these filters/);
  }finally{await context.close();}
});
/**
 * @description Wait until a condition the test can read holds, checking every 25 ms for up to ten seconds.
 * @param {() => boolean} holds - The condition.
 * @param {string} what - What is awaited, for the failure message.
 * @returns {Promise<void>} Resolves when it holds; rejects naming what never came.
 */
async function until(holds, what) {
  for (let waited = 0; waited < 10000; waited += 25) {
    if (holds()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}

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
    // The page writes its address and then sends the request, and the fixture records a request only when its route
    // handler runs, a moment later on a busy machine. So wait for the request itself, not the address.
    await until(() => seen.some((query) => query.get('company') === 'Example Freight'), 'the request with the company');
    const last = seen.findLast((query) => query.get('company') === 'Example Freight');
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

/** Synthetic openings: enough pages to expose the phone default and the short final page. */
function resultRows(count = 43) {
  return Array.from({ length: count }, (_, index) => ({ id: index + 101, title: 'Fixture role ' + (index + 1),
    company: 'Fixture employer', location: 'Austin, TX', job_type: 'fte', url: 'https://employer.example/jobs/' + (index + 1) }));
}

/** Serve requested pages and the existing account-search contract without any real records. */
function pagedSearch(seen, state = {}) {
  const rows = state.rows || resultRows(), fallback = search([], true);
  let memory = state.memory || { last: null, saved: [], stored: true };
  return request => {
    const { url, method, body } = request;
    if (url.pathname === '/shared/ui/js/surface-theme.js' && state.seed) return { text: state.seed };
    if (url.pathname === '/api/career-hunter/search-memory') {
      if (method === 'POST' && body.op === 'remember') memory = { ...memory, last: body.criteria };
      return { json: memory };
    }
    if (url.pathname === '/api/career-hunter/browse') {
      seen.push(url.searchParams);
      const per = Number(url.searchParams.get('per')), page = Number(url.searchParams.get('page')), start = (page - 1) * per;
      return { json: { jobs: rows.slice(start, start + per), page, per, browse: true, exhausted: start + per >= rows.length, deep: true } };
    }
    if (url.pathname === '/api/career-hunter/jobs/101/status') {
      state.feedback = (state.feedback || []).concat(body);
      const value = ['Fixture employer', 'Fixture role 1', 'Austin, TX'].map(v => v.toLowerCase()).join('\x1f');
      return { json: { ok: true, exclusions: [{ id: 'fixture-hidden', kind: 'job', value, label: 'Fixture role 1' }] } };
    }
    return fallback(request);
  };
}

test('G7: saved account and named search orders survive the new default',async()=>{
  const seen=[],memory={last:{q:'director',sort:'salary',per:'20'},saved:[
    {id:'chosen-order',name:'Alphabetical roles',criteria:{q:'operations',sort:'title',per:'25'}}],stored:true};
  const {page,context}=await openScreen(browser,'career-search.html',pagedSearch(seen,{memory}),PHONE,'',HERE);
  try{
    await until(()=>seen.length>0,'account sort request');
    assert.equal(seen[0].get('sort'),'salary');
    await page.locator('#savedSearchOpen').click();
    await page.locator('#savedSearchList').selectOption('chosen-order');
    await page.locator('#loadSearch').click();
    await until(()=>seen.at(-1)?.get('sort')==='title','named search order');
    assert.equal(seen.at(-1).get('q'),'operations');
    assert.equal(seen.at(-1).get('per'),'25');
  }finally{await context.close();}
});

for (const [label, size, per] of [['phone', PHONE, 20], ['computer', DESKTOP, 50]]) {
  test(`${label}: first search requests the default batch and describes only its returned range`, async () => {
    const seen = [], { page, context } = await openScreen(browser, 'career-search.html', pagedSearch(seen), size, '', HERE);
    try {
      await page.locator('#list .job').first().waitFor();
      assert.equal(seen[0].get('per'), String(per));
      assert.equal(await page.locator('#list .job').count(), Math.min(per, 43));
      assert.match(await page.locator('#count').innerText(), new RegExp('^Showing 1–' + Math.min(per, 43) + '(?:\\s|$)'));
      assert.doesNotMatch(await page.locator('#count').innerText(), /of \d+|\d+ jobs/);
    } finally { await context.close(); }
  });
}

test('phone: pages show returned ranges and the short final page without inventing a total', async () => {
  const seen = [], { page, context } = await openScreen(browser, 'career-search.html', pagedSearch(seen), PHONE, '', HERE);
  try {
    await page.locator('#job-101').waitFor();
    assert.equal(seen[0].get('per'), '20', 'pagination begins with the phone20-result default');
    await page.getByRole('button', { name: 'Next →', exact: true }).click();
    await page.locator('#job-121').waitFor();
    assert.match(await page.locator('#count').innerText(), /^Showing 21–40(?:\s|$)/);
    await page.getByRole('button', { name: 'Next →', exact: true }).click();
    await page.locator('#job-141').waitFor();
    assert.equal(await page.locator('#list .job').count(), 3);
    assert.match(await page.locator('#count').innerText(), /^Showing 41–43(?:\s|$)/);
    assert.equal(await page.getByRole('button', { name: 'Next →', exact: true }).count(), 0);
    await page.getByRole('button', { name: '← Previous', exact: true }).click();
    await page.locator('#job-121').waitFor();
    assert.deepEqual(seen.map(query => query.get('page')), ['1', '2', '3', '2']);
  } finally { await context.close(); }
});

for (const [label, query, memory, expectedPer, first] of [
  ['explicit link', '?per=5&page=2', { last: { per: '100' }, saved: [], stored: true }, '5', 106],
  ['account preference', '', { last: { per: '100' }, saved: [], stored: true }, '100', 101],
]) {
  test(`phone: ${label} keeps its page size instead of replacing it with the default`, async () => {
    const seen = [], { page, context } = await openScreen(browser, 'career-search.html', pagedSearch(seen, { memory }), PHONE, query, HERE);
    try {
      await page.locator('#job-' + first).waitFor();
      assert.equal(seen[0].get('per'), expectedPer);
      assert.equal(await page.locator('#per').inputValue(), expectedPer);
    } finally { await context.close(); }
  });
}

test('phone: restored session position keeps its chosen25-result second page', async () => {
  const key = 'career-search:v1:fixture:ada:position';
  const seed = 'sessionStorage.setItem(' + JSON.stringify(key) + ',' + JSON.stringify(JSON.stringify({ criteria: { per: '25' }, page: 2 })) + ');';
  const seen = [], { page, context } = await openScreen(browser, 'career-search.html', pagedSearch(seen, { seed }), PHONE, '', HERE);
  try {
    await page.locator('#job-126').waitFor();
    assert.deepEqual([seen[0].get('per'), seen[0].get('page')], ['25', '2']);
  } finally { await context.close(); }
});

test('phone: a saved search keeps its chosen page size when loaded', async () => {
  const memory = { last: { per: '100' }, saved: [{ id: 'small', name: 'Small batch', criteria: { per: '25' } }], stored: true };
  const seen = [], { page, context } = await openScreen(browser, 'career-search.html', pagedSearch(seen, { memory }), PHONE, '', HERE);
  try {
    await page.locator('#job-101').waitFor();
    await page.getByRole('button', { name: 'Saved searches', exact: true }).click();
    await page.locator('#savedSearchList').selectOption('small');
    await page.locator('#loadSearch').click();
    await until(() => seen.at(-1)?.get('per') === '25', 'the saved25-result request');
    assert.equal(await page.locator('#per').inputValue(), '25');
    assert.equal(seen.at(-1).get('page'), '1');
  } finally { await context.close(); }
});

test('phone: duplicate rows are counted as the cards actually shown, with the returned range kept separate', async () => {
  const rows = resultRows(20); rows[19] = { ...rows[0], id: 120 };
  const { page, context } = await openScreen(browser, 'career-search.html', pagedSearch([], { rows }), PHONE, '?per=20', HERE);
  try {
    await page.locator('#job-101').waitFor();
    assert.equal(await page.locator('#list .job').count(), 19);
    assert.match(await page.locator('#count').innerText(), /^Showing 19 jobs · results 1–20(?:\s|$)/);
  } finally { await context.close(); }
});

test('phone: More has a44px target, keeps secondary actions hidden and dismisses with Escape', async () => {
  const { page, context } = await openScreen(browser, 'career-search.html', pagedSearch([]), PHONE, '', HERE);
  try {
    const card = page.locator('#job-101'); await card.waitFor();
    const more = card.getByRole('button', { name: 'More for Fixture role 1', exact: true });
    assert.equal(await more.count(), 1);
    assert.equal(await card.getByRole('button', { name: 'Not interested', exact: true }).isVisible(), false);
    for (const target of [more, card.getByRole('button', { name: 'Save', exact: true }), card.getByRole('link', { name: 'Employer posting ↗' })]) {
      const box = await target.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44, JSON.stringify(box));
    }
    await more.click();
    const menu = card.locator('.job-more-menu'); await menu.waitFor();
    assert.equal(await menu.getByRole('button', { name: 'More at this company' }).isVisible(), true);
    for (const action of await menu.getByRole('button').all()) {
      const box = await action.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44, JSON.stringify(box));
    }
    await menu.getByRole('button', { name: 'Not interested', exact: true }).focus();
    await page.keyboard.press('Escape');
    assert.equal(await menu.isVisible(), false);
    assert.equal(await more.evaluate(node => document.activeElement === node), true);
    await more.click(); await menu.waitFor(); await page.locator('#q').click();
    assert.equal(await menu.isVisible(), false, 'a press outside dismisses the menu');
    assert.ok(await fits(page));
  } finally { await context.close(); }
});

test('phone: More keeps the existing company filter and confirmed feedback actions', async () => {
  const seen = [], state = {}, { page, context } = await openScreen(browser, 'career-search.html', pagedSearch(seen, state), PHONE, '', HERE);
  try {
    const card = () => page.locator('#job-101'); await card().waitFor();
    assert.equal(await card().getByRole('button', { name: 'More for Fixture role 1', exact: true }).count(), 1);
    await card().getByRole('button', { name: 'More for Fixture role 1', exact: true }).click();
    await card().getByRole('button', { name: 'More at this company' }).click();
    await until(() => seen.some(query => query.get('company') === 'Fixture employer'), 'the unchanged company filter');
    await page.waitForFunction(() => document.getElementById('list').getAttribute('aria-busy') === 'false');
    await card().getByRole('button', { name: 'More for Fixture role 1', exact: true }).click();
    await card().getByRole('button', { name: 'Not interested', exact: true }).click();
    const dialog = page.locator('#jobFeedbackDialog'); await dialog.waitFor();
    assert.equal(state.feedback, undefined, 'opening the choices records no preference');
    await dialog.getByRole('button', { name: 'Hide matching jobs' }).click();
    await page.waitForFunction(() => !document.getElementById('job-101'));
    assert.equal(state.feedback.length, 1);
    assert.deepEqual(state.feedback[0], { feedback: { kind: 'job' } });
    assert.match(await page.locator('#count').innerText(), /^Showing 19 jobs · results 1–20(?:\s|$)/);
  } finally { await context.close(); }
});
