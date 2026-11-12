/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Insights is honest about whose numbers are whose (judge's report 2026-11-11, change 15: one funnel began with a count shared by everyone and ran into the person's own steps). The shipped tools/career-insights.html in Chromium, at 1440x900 and 412x915. The market answer is the served readAnalytics over real SQLite built from the engine's own schema, so the page is held to the shape the route really gives; the person's counts are a fixture in the shape GET /jobs/stats gives. Your search shows only Saved, Prepared, Applied, Interview and Offer, with no shared total in it; with none of those it says what will appear and offers Find jobs; the shared numbers sit under "The job market Career can see", say they are the same for everyone, and own the period control; the numbers that come from the person's own scores have their own heading; "In-lane roles", "Sourced", "Qualified" and "Promoted" are gone; each part reports its own failed read.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Page names, judge's report 2026-11-11 (tests/career-page-names.test.mjs holds them): the fixture's not-ready answer is the reason the route now gives.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { openScreen, playwright, PHONE, DESKTOP, ORIGIN } from './helpers/ux-page.mjs';

const { readAnalytics } = createRequire(import.meta.url)('../routes/career-insights.js');

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/** The engine's own schema text and Insights index statement, as the engine creates them. */
function engine(name) {
  const source = fs.readFileSync(new URL('../engine/jobhunter/db.py', import.meta.url), 'utf8');
  if (name === 'INSIGHTS_INDEX_SQL') return [...source.match(/\nINSIGHTS_INDEX_SQL = \(([\s\S]*?)\n\)/)[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]).join('');
  return source.match(new RegExp(`\\n${name} = """([\\s\\S]*?)"""`))[1];
}

/** What GET /analytics answers for a person whose résumé scored some of forty open jobs at three companies. */
function marketAnswer(days) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("ATTACH DATABASE ':memory:' AS corpus");
    for (const part of ['CORPUS_SCHEMA', 'USER_SCHEMA', 'INSIGHTS_INDEX_SQL']) db.exec(engine(part));
    db.exec("INSERT INTO corpus.companies (id, name) VALUES (1, 'Acme Robotics'), (2, 'Globex'), (3, 'Initech')");
    const posting = db.prepare('INSERT INTO corpus.postings_corpus (id, company_id, ats_job_id, active, target_role, state, posted_date, salary_max) VALUES (?, ?, ?, 1, 1, ?, ?, ?)');
    const signal = db.prepare('INSERT INTO user_signals (posting_id, ai_fit_score, status) VALUES (?, ?, ?)');
    const day = db.prepare("SELECT date('now') AS today, date('now','-40 days') AS old").get();
    for (let id = 1; id <= 40; id += 1) {
      posting.run(id, (id % 3) + 1, `j${id}`, id % 4 ? 'TX' : 'FL', id <= 12 ? day.today : day.old, 100000 + id * 1000);
      if (id <= 9) signal.run(id, id <= 5 ? 85 : 72, 'new');
    }
    return JSON.parse(JSON.stringify(readAnalytics(db, days)));
  } finally { db.close(); }
}

/**
 * @description Fixture answers for Insights.
 * @param {{stats: object|number, market?: number}} state - What /jobs/stats answers (or a status for a failed read), and a status for a failed /analytics.
 * @returns {(req: {url: URL}) => object|null} The handler openScreen takes.
 */
function insights(state) {
  return ({ url }) => {
    const p = url.pathname;
    if (p === '/api/career-hunter/jobs/stats') return typeof state.stats === 'number' ? { status: state.stats, json: { error: 'stats failed' } } : { json: state.stats };
    if (p === '/api/career-hunter/analytics') {
      if (state.market) return { status: state.market, json: { error: 'Job market is not ready yet: the job list gains the index this page reads at its next nightly refresh.', reason: 'insights_index_missing' } };
      return { json: marketAnswer(Number(url.searchParams.get('days')) || undefined) };
    }
    if (p === '/api/career-hunter/search-ui') return { text: 'search' };
    return null;
  };
}
/** A person part-way through a search, in the shape GET /jobs/stats gives; 300 scored jobs and 4 queued ones are not steps of theirs. */
const SEARCHING = { byStatus: [{ status: 'new', n: 300 }, { status: 'promoted', n: 4 }, { status: 'dismissed', n: 3 }, { status: 'applied', n: 2 }, { status: 'generated', n: 1 }], total: 310, applied: 2, interviewing: 0, queued: 5, tracked: 2, earlierPreparation: 0, saved: 7 };
const rows = (page) => page.locator('#own .frow').evaluateAll((list) => list.map((row) => [row.querySelector('.lbl').textContent, row.querySelector('.bar').textContent]));
/** The label and value of each card in the nth group of cards under the market heading. */
const cards = (page, group) => page.locator('#market .stats').nth(group).locator('.stat').evaluateAll((list) => list.map((card) => [card.querySelector('.l').textContent, card.querySelector('.v').textContent]));

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: Your search is the person's own five counts, and the shared numbers sit under their own heading`, async () => {
    const { page, context, calls } = await openScreen(browser, 'career-insights.html', insights({ stats: SEARCHING }), size);
    try {
      await page.locator('#own .frow').first().waitFor();
      await page.locator('#market .stat').first().waitFor();
      assert.deepEqual(await rows(page), [['Saved', '7'], ['Prepared', '1'], ['Applied', '2'], ['Interview', '0'], ['Offer', '0']]);
      assert.deepEqual(await page.locator('#body h2').allTextContents(), ['Your search', 'The job market Career can see', 'Companies with the most open jobs', 'Open jobs by state', 'How these jobs fit your résumé', 'Pay of jobs with fit 70 or better']);
      assert.deepEqual(await cards(page, 0), [['Open technology and professional jobs', '40'], ['Posted in the last 7 days', '12'], ['Companies hiring', '3']]);
      assert.deepEqual(await cards(page, 1), [['Fit 70 or better', '9'], ['Fit 80 or better', '5'], ['Average pay, fit 70 or better', '$105k']]);
      assert.match(await page.locator('#body .note').innerText(), /They are the same for everyone who uses Career, and they are not your progress\./);
      assert.deepEqual(await page.locator('#market .list').last().locator('.nm').allTextContents(), ['Under $150k a year'], 'a pay band carries its unit');
      assert.doesNotMatch(await page.locator('#own').innerText(), /40|300|310/, 'no shared or unrelated total among the person\'s own steps');
      assert.doesNotMatch(await page.locator('.wrap').innerText(), /in-lane|sourced|qualified|promoted|pipeline funnel/i);
      assert.equal(await page.locator('section[aria-labelledby="marketTitle"] #periodTabs').count(), 1, 'the period control belongs to the market numbers');
      const ownReads = () => calls.filter((c) => c.path === '/api/career-hunter/jobs/stats').length, before = ownReads();
      const week = page.getByRole('tab', { name: '7 days', exact: true });
      if (size === PHONE) await week.tap(); else await week.click();
      await page.waitForFunction(() => document.querySelector('#market .stat .v').textContent === '12');
      assert.deepEqual(await rows(page), [['Saved', '7'], ['Prepared', '1'], ['Applied', '2'], ['Interview', '0'], ['Offer', '0']], 'a period never changes the person\'s own counts');
      assert.equal(ownReads(), before, 'and the page does not read them again (the frame reads the same route once for its own chip)');
      assert.ok(calls.some((c) => c.path === '/api/career-hunter/analytics?days=7'));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'nothing is wider than the screen');
    } finally { await context.close(); }
  });
}

for (const [name, stats] of [
  ['only scored jobs, none saved or applied to', { byStatus: [{ status: 'new', n: 120 }, { status: 'dismissed', n: 2 }], total: 122, applied: 0, interviewing: 0, queued: 0, tracked: 0, earlierPreparation: 0, saved: 0 }],
  ['no store yet', { byStatus: [], total: 0, applied: 0, interviewing: 0, empty: true }],
]) {
  test(`with ${name}, Your search says what will appear and offers Find jobs`, async () => {
    const { page, context } = await openScreen(browser, 'career-insights.html', insights({ stats }), PHONE);
    try {
      await page.locator('#own .ck-empty').waitFor();
      assert.match(await page.locator('#own').innerText(), /Save or apply to a job and your progress appears here\./);
      assert.equal(await page.locator('#own .frow').count(), 0, 'no row of zeros');
      assert.deepEqual(await page.locator('.ck-primary:visible').allInnerTexts(), ['Find jobs']);
      await page.locator('#market .stat').first().waitFor();
      await page.getByRole('link', { name: 'Find jobs', exact: true }).tap();
      await page.waitForURL(`${ORIGIN}/api/career-hunter/search-ui`);
    } finally { await context.close(); }
  });
}

test('each part reports its own failed read and the other part still shows', async () => {
  const market = await openScreen(browser, 'career-insights.html', insights({ stats: SEARCHING, market: 503 }), DESKTOP);
  try {
    await market.page.locator('#own .frow').first().waitFor();
    const alert = market.page.locator('#market [role=alert]');
    await alert.waitFor();
    assert.match(await alert.innerText(), /The job market numbers could not be loaded: Job market is not ready yet/);
    assert.equal(await market.page.locator('#market .stat').count(), 0, 'no zeros in place of the numbers');
  } finally { await market.context.close(); }
  const own = await openScreen(browser, 'career-insights.html', insights({ stats: 500 }), DESKTOP);
  try {
    await own.page.locator('#market .stat').first().waitFor();
    assert.match(await own.page.locator('#own [role=alert]').innerText(), /Your own numbers could not be loaded: stats failed/);
    assert.equal(await own.page.locator('#own .ck-empty').count(), 0, 'a failed read is not "nothing yet"');
  } finally { await own.context.close(); }
});
