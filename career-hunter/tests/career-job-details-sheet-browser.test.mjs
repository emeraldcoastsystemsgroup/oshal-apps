/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.6 (Roger, 2026-11-16: "there are a bunch of jobs from torch technology that i want to apply for but in the my jobs initial screen the popup says that there is no information about the job"). The shipped tools/career-job-lists.html in Chromium at 1440x900 and at 412x915 with touch, over fixture answers shaped as GET /jobs, GET /jobs/:id and POST /jobs/:id/details now answer (invented jobs; the employer name is the one Roger named). The posting sheet never says "No description was provided.": a job with a description shows it and reads nothing; a job with none says "Reading the job description from Torch Technologies…" while POST /jobs/:id/details runs, then shows the text, says it was read from the employer's posting and draws its fit again (a job marked Details needed is no longer); while Career is preparing applications (409 career_run_in_progress) it shows the text read for the view (GET ?details=read); a closed posting says plainly that Career could not read it and why, with Open the posting (the posting's address, web addresses only) and Paste it in Prepare application, whose press closes the sheet, moves the job to Getting ready and opens its application; a site Career cannot read says Career has no description for this job and why, with the same two; an applied job offers no paste; a site that did not answer also offers Try again, which reads it again, and a closed posting or an unreadable site does not. Every button is a 44px target on the phone and nothing is wider than the screen.
 */
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {openScreen, playwright, PHONE, DESKTOP} from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({headless:true}); });
after(async () => { await browser?.close(); });

const at = size => ({...size, locale:'en-US', timezoneId:'UTC'});
const POSTING = id => `https://starfish.wd501.myworkdayjobs.com/en-US/Careers/job/Eglin-AFB-FL/Invented-Role_R${id}`;
const READ = 'Torch Technologies\nThank you for your interest in an invented role.\n\nInvented duties: plan test operations.\nInvented requirements: a clearance.';
const LISTED = 'Invented listing text for a role whose list carried its description. '.repeat(4).trim();
const MARK = {kind:'needs-details', score:null, assessedAt:'2026-11-15T07:30:00.000Z', model:null, inputRecorded:false, currentness:'not-applicable', keyword:40};
const row = (id, extra) => ({id, title:`Invented role ${id}`, company:'Torch Technologies', status:'new', favorite:true, active:1,
  ai_fit_score:null, fit_score:40, fit_assessment:{kind:'keyword', score:40}, posted_date:'2026-11-14', location:'a regional federal hub, FL',
  workplaceType:'onsite', url:POSTING(id), salary_min:null, salary_max:null, ...extra});
const JOBS = {
  10:row(10, {description:null}),
  11:row(11, {description:null}),
  12:row(12, {description:LISTED}),
  13:row(13, {description:null, company:'Invented Eightfold Employer', url:'https://invented.eightfold.ai/careers/job/13'}),
  15:row(15, {description:null, fit_assessment:MARK}),
  19:row(19, {description:null}),
  21:row(21, {description:null, url:'javascript:alert(1)'}),
  22:row(22, {description:null, status:'applied', applied_at:'2026-11-15 10:00:00'}),
  23:row(23, {description:null}),
};
const WHY = {
  closed:'The posting is no longer on the employer’s site.',
  'no-reader':'It cannot read job descriptions from this employer’s job site.',
  refused:'The employer’s site refused the request.',
  unavailable:'The employer’s site did not answer.',
};
/** POST /jobs/:id/details as the route answers each invented job. */
const DETAILS = {
  10:{json:{ok:true, description:READ, description_context:{basis:'employer-detail', retrievedAt:'2026-11-16T21:00:00.000000Z', kept:true}}},
  11:{json:{ok:false, reason:'closed', why:WHY.closed}},
  13:{json:{ok:false, reason:'no-reader', why:WHY['no-reader']}},
  15:{json:{ok:true, description:READ, description_context:{basis:'employer-detail', retrievedAt:'2026-11-16T21:00:00.000000Z', kept:true}}},
  19:{status:409, json:{error:'career_run_in_progress', runId:'run-1'}},
  21:{json:{ok:false, reason:'refused', why:WHY.refused}},
  22:{json:{ok:false, reason:'closed', why:WHY.closed}},
};
/** Job 23's site does not answer the first time (rate-limited), then does. */
let asked23 = 0;
const SITE_BUSY_ONCE = () => (++asked23 === 1 ? {json:{ok:false, reason:'unavailable', why:WHY.unavailable}} : DETAILS[10]);

/** Fixture answers for My jobs and the posting sheet. */
function api({method, url}) {
  const p = url.pathname, id = Number((/^\/api\/career-hunter\/jobs\/(\d+)/.exec(p) || [])[1]);
  if (p === '/api/career-hunter/resume/state') return {json:{hasResume:true, roles:4, indexing:false, scored:12}};
  if (p === '/api/career-hunter/jobs/stats') return {json:{saved:Object.keys(JOBS).length, byStatus:[]}};
  if (p === '/api/career-hunter/applications') return {json:{applications:[]}};
  if (p === '/api/career-hunter/jobs') return {json:{jobs:Object.values(JOBS).filter(job => job.status !== 'applied').map(({description, ...job}) => job), exhausted:true, exclusions:[], home:{known:true, label:'Sampletown, FL', radiusMiles:50, line:'', settingsUrl:''}}};
  if (p === '/api/auth/user') return {json:{authenticated:false}};
  if (id && p === `/api/career-hunter/jobs/${id}/details` && method === 'POST') return id === 23 ? SITE_BUSY_ONCE() : DETAILS[id];
  if (id && p === `/api/career-hunter/jobs/${id}/status` && method === 'POST') return {json:{ok:true}};
  if (id && p === `/api/career-hunter/jobs/${id}` && method === 'GET') {
    if (url.searchParams.get('details') === 'read') return {json:{job:{...JOBS[id], description:READ, description_context:{basis:'employer-detail', kept:false}}}};
    return {json:{job:JOBS[id]}};
  }
  if (p === '/api/career-hunter/board-native') return {text:'application opened'};
  return null;
}

const sheet = page => page.locator('dialog.edit-dialog[open]');
async function open(page, id) {
  await page.locator(`.job-row[data-job-id="${id}"] button.job-title`).click();
  await sheet(page).getByRole('heading', {name:`Invented role ${id}`}).waitFor();
  return sheet(page);
}
const detailsCalls = (calls, id) => calls.filter(c => c.method === 'POST' && c.path === `/api/career-hunter/jobs/${id}/details`);
const target = locator => locator.evaluate(node => { const r = node.getBoundingClientRect(); return {height:r.height, right:r.right, width:innerWidth}; });

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: a job with a description shows it and reads nothing`, async () => {
    const {page, context, calls} = await openScreen(browser, 'career-job-lists.html', api, at(size));
    try {
      await page.locator('.job-row[data-job-id="12"]').waitFor();
      const box = await open(page, 12);
      assert.equal(await box.locator('.posting-text').innerText(), LISTED);
      assert.equal(await box.getByRole('link', {name:'Employer posting ↗'}).getAttribute('href'), POSTING(12));
      assert.equal(detailsCalls(calls, 12).length, 0, 'nothing to read');
    } finally { await context.close(); }
  });

  test(`${label}: a Torch Technologies job with no description is read while the sheet says so, then shown`, async () => {
    const {page, context, calls} = await openScreen(browser, 'career-job-lists.html', api, at(size));
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route('**/api/career-hunter/jobs/10/details', async route => { await held; await route.fallback(); });
    try {
      await page.locator('.job-row[data-job-id="10"]').waitFor();
      const box = await open(page, 10);
      const reading = box.locator('.posting-reading');
      await reading.waitFor();
      assert.equal(await reading.innerText(), 'Reading the job description from Torch Technologies…');
      release();
      await box.locator('.posting-text').waitFor();
      assert.equal(await box.locator('.posting-text').innerText(), READ, 'the employer’s words, its paragraphs kept');
      assert.equal(await box.locator('.posting-source').innerText(), 'Read from the employer’s posting.');
      assert.equal(detailsCalls(calls, 10).length, 1, 'one read, kept by the route');
      assert.doesNotMatch(await box.innerText(), /No description was provided|no information/i);
    } finally { release(); await context.close(); }
  });

  test(`${label}: a closed posting says plainly why, with the posting and the paste path`, async () => {
    const {page, context, calls} = await openScreen(browser, 'career-job-lists.html', api, at(size));
    try {
      await page.locator('.job-row[data-job-id="11"]').waitFor();
      const box = await open(page, 11);
      const missing = box.locator('.posting-missing');
      await missing.waitFor();
      assert.equal(await missing.getAttribute('data-read'), 'failed');
      assert.equal(await missing.innerText(), 'Career could not read this job’s description from Torch Technologies. The posting is no longer on the employer’s site.\n\n'
        + 'Open the posting, copy the job description and paste it in Prepare application, step 1 · Tailor. Career uses it to check your fit and write your résumé and cover letter.\n\n'
        + 'Open the posting ↗\nPaste it in Prepare application');
      const link = missing.getByRole('link', {name:'Open the posting ↗'});
      assert.equal(await link.getAttribute('href'), POSTING(11));
      assert.equal(await link.getAttribute('target'), '_blank');
      assert.doesNotMatch(await box.innerText(), /No description was provided|no information/i);
      if (size === PHONE) {
        for (const control of [link, missing.getByRole('button', {name:'Paste it in Prepare application'})]) {
          const box44 = await target(control);
          assert.ok(box44.height >= 44 && box44.right <= box44.width, 'a 44 px target inside the window: ' + JSON.stringify(box44));
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'nothing is wider than the screen');
      }
      assert.equal(detailsCalls(calls, 11).length, 1);
    } finally { await context.close(); }
  });

  test(`${label}: a job Career cannot read from its site says Career has no description for it, with the posting and the paste path`, async () => {
    const {page, context} = await openScreen(browser, 'career-job-lists.html', api, at(size));
    try {
      await page.locator('.job-row[data-job-id="13"]').waitFor();
      const box = await open(page, 13);
      const missing = box.locator('.posting-missing');
      await missing.waitFor();
      assert.equal(await missing.getAttribute('data-read'), 'never');
      assert.match(await missing.innerText(), /^Career has no description for this job\. It cannot read job descriptions from this employer’s job site\.\n\nOpen the posting, copy the job description and paste it in Prepare application, step 1 · Tailor\./);
      assert.equal(await missing.getByRole('link', {name:'Open the posting ↗'}).getAttribute('href'), 'https://invented.eightfold.ai/careers/job/13');
      assert.equal(await missing.getByRole('button', {name:'Paste it in Prepare application'}).count(), 1);
    } finally { await context.close(); }
  });
}

test('a job the nightly pass marked Details needed is no longer, once its description is read', async () => {
  const {page, context} = await openScreen(browser, 'career-job-lists.html', api, at(DESKTOP));
  try {
    await page.locator('.job-row[data-job-id="15"]').waitFor();
    assert.match(await page.locator('.job-row[data-job-id="15"]').innerText(), /Details needed/, 'the row says what the nightly pass found');
    const box = await open(page, 15);
    await box.locator('.posting-text').waitFor();
    const fit = await box.locator('[data-posting-fit="15"]').innerText();
    assert.doesNotMatch(fit, /Details needed|could not read this job/, 'its fit is drawn again with the description');
    assert.match(fit, /Not scored yet/);
    assert.equal(await box.getByRole('button', {name:'Check my fit'}).count(), 1, 'its fit can be checked now');
  } finally { await context.close(); }
});

test('while Career is preparing applications the sheet shows the description read for the view', async () => {
  const {page, context, calls} = await openScreen(browser, 'career-job-lists.html', api, at(DESKTOP));
  try {
    await page.locator('.job-row[data-job-id="19"]').waitFor();
    const box = await open(page, 19);
    await box.locator('.posting-text').waitFor();
    assert.equal(await box.locator('.posting-text').innerText(), READ);
    assert.deepEqual(calls.filter(c => c.path.startsWith('/api/career-hunter/jobs/19')).map(c => `${c.method} ${c.path}`),
      ['GET /api/career-hunter/jobs/19', 'POST /api/career-hunter/jobs/19/details', 'GET /api/career-hunter/jobs/19?details=read']);
  } finally { await context.close(); }
});

test('a posting address that is not a web address is no link; an applied job offers no paste', async () => {
  const {page, context} = await openScreen(browser, 'career-job-lists.html', api, at(DESKTOP));
  try {
    await page.locator('.job-row[data-job-id="21"]').waitFor();
    let box = await open(page, 21);
    await box.locator('.posting-missing').waitFor();
    assert.equal(await box.locator('a').count(), 0, 'no link to javascript:');
    assert.match(await box.locator('.posting-missing').innerText(), /Copy the job description from the employer’s posting and paste it in Prepare application, step 1 · Tailor\./);
    await box.getByRole('button', {name:'Close posting'}).click();
    await page.evaluate(() => { const b = document.createElement('button'); b.className = 'job-title'; b.dataset.posting = '22'; b.id = 'openApplied'; b.textContent = 'Invented role 22'; document.body.prepend(b); });
    await page.locator('#openApplied').click();
    box = sheet(page);
    await box.locator('.posting-missing').waitFor();
    assert.equal(await box.getByRole('button', {name:'Paste it in Prepare application'}).count(), 0, 'nothing to prepare on an applied job');
  } finally { await context.close(); }
});

test('a site that did not answer says so and offers Try again, which reads it again', async () => {
  const {page, context, calls} = await openScreen(browser, 'career-job-lists.html', api, at(DESKTOP));
  try {
    await page.locator('.job-row[data-job-id="23"]').waitFor();
    const box = await open(page, 23);
    const missing = box.locator('.posting-missing');
    await missing.waitFor();
    assert.match(await missing.innerText(), /^Career could not read this job’s description from Torch Technologies\. The employer’s site did not answer\./);
    await missing.getByRole('button', {name:'Try again'}).click();
    await box.locator('.posting-text').waitFor();
    assert.equal(await box.locator('.posting-text').innerText(), READ);
    assert.equal(detailsCalls(calls, 23).length, 2, 'one read, then one more when asked');
    assert.equal(await box.getByRole('button', {name:'Try again'}).count(), 0);
  } finally { await context.close(); }
});

test('a closed posting and a site Career cannot read offer no Try again', async () => {
  const {page, context} = await openScreen(browser, 'career-job-lists.html', api, at(DESKTOP));
  try {
    for (const id of [11, 13]) {
      await page.locator(`.job-row[data-job-id="${id}"]`).waitFor();
      const box = await open(page, id);
      await box.locator('.posting-missing').waitFor();
      assert.equal(await box.getByRole('button', {name:'Try again'}).count(), 0, String(id));
      await box.getByRole('button', {name:'Close posting'}).click();
      await sheet(page).waitFor({state:'detached'});
    }
  } finally { await context.close(); }
});

test('Paste it in Prepare application closes the sheet, moves the job to Getting ready and opens its application', async () => {
  const {page, context, calls} = await openScreen(browser, 'career-job-lists.html', api, at(PHONE));
  try {
    await page.locator('.job-row[data-job-id="11"]').waitFor();
    const box = await open(page, 11);
    await box.getByRole('button', {name:'Paste it in Prepare application'}).tap();
    await page.waitForURL(/\/api\/career-hunter\/board-native\?/);
    const opened = new URL(page.url());
    assert.deepEqual([opened.searchParams.get('view'), opened.searchParams.get('application')], ['queue', '11']);
    const moved = calls.find(c => c.method === 'POST' && c.path === '/api/career-hunter/jobs/11/status');
    assert.deepEqual(moved?.body, {status:'promoted', favorite:true});
  } finally { await context.close(); }
});
