/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com | CAREER_PLACE_SHOTS=<folder> keeps a full-page picture of the screens checked (fixture data only); the gate leaves it unset.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.67.4 (Roger, 2026-11-16: "the job location doesnt transfer to the my jobs page and i cant look at jobs near me"). The shipped tools/career-job-lists.html and tools/career-settings.html in Chromium over fixture answers shaped as GET /jobs now answers (invented jobs, a made-up home), at 1440x900 and at 412x915 with touch: each saved job's facts say where it is (the place, or Location unknown), how it is worked (Fully remote, Hybrid, On-site) and how far from home; Within and Distance from home ask the server, which answers every page; with no home one line says so with Set your home, which opens Settings on What I'm looking for (Matching area) by its address alone, and the choices that need a home are off; a remembered distance with no home says why instead of "Could not update jobs"; the stages of Applications have neither control.
 */
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {openScreen, playwright, PHONE, DESKTOP} from './helpers/ux-page.mjs';

/** CAREER_PLACE_SHOTS=<folder> keeps a picture of each screen checked (fixture data only); unset in the gate. */
const SHOTS = process.env.CAREER_PLACE_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({path:`${SHOTS}/${name}.png`, fullPage:true}) : null);

let browser;
before(async () => { browser = await playwright().chromium.launch({headless:true}); });
after(async () => { await browser?.close(); });

const at = size => ({...size, locale:'en-US', timezoneId:'UTC'});
const SETTINGS = '/api/career-hunter/settings?section=matching';
const KNOWN = {known:true, label:'Bend, OR', radiusMiles:50, line:'Miles are straight-line from Bend, OR, not driving distance.', settingsUrl:SETTINGS};
const UNKNOWN = {known:false, label:null, radiusMiles:null, line:'Set your home city or ZIP to see how far each job is from you.', settingsUrl:SETTINGS};
const job = (id, extra) => ({id, title:`Invented role ${id}`, company:'Invented Co', status:'new', favorite:true, active:1, ai_fit_score:70,
  posted_date:'2026-11-01', salary_min:null, salary_max:null, ...extra});
const JOBS = [
  job(12, {location:'Redmond, OR', remote:0, workplaceType:'onsite', lat:44.42, lon:-121.31, distanceMiles:24.9}),
  job(13, {location:'Sisters, OR', remote:0, workplaceType:'hybrid', lat:44.42, lon:-121.31, distanceMiles:25.1}),
  job(17, {location:'Remote - US', remote:1, workplaceType:'remote', lat:44.13, lon:-121.31, distanceMiles:null}),
  job(20, {location:null, remote:0, workplaceType:null, lat:null, lon:null, distanceMiles:null}),
];

/** Fixture answers for My jobs; GET /jobs answers as the route does, refusing a distance when there is no home. */
function lists(home) {
  return ({url}) => {
    const p = url.pathname, q = url.searchParams;
    if (p === '/api/career-hunter/resume/state') return {json:{hasResume:true, roles:4, indexing:false, scored:12}};
    if (p === '/api/career-hunter/jobs/stats') return {json:{saved:JOBS.length, byStatus:[]}};
    if (p === '/api/career-hunter/applications') return {json:{applications:[]}};
    if (p === '/api/career-hunter/jobs') {
      const needsHome = /^\d+$/.test(q.get('within') || '') || q.get('sort') === 'distance';
      if (needsHome && !home.known) {
        return {status:400, json:{error:'home_location_required', code:'home_location_required', home,
          message:'Set your home city or ZIP in Settings, What I\'m looking for, Matching area, to see the jobs near you.'}};
      }
      // As the route answers: no home, no miles.
      return {json:{jobs:home.known ? JOBS : JOBS.map(row => ({...row, distanceMiles:null})), exhausted:true, exclusions:[], home}};
    }
    if (p === '/api/auth/user') return {json:{authenticated:false}};
    return {json:{}};
  };
}
const jobsAsked = calls => calls.filter(c => c.path.startsWith('/api/career-hunter/jobs?')).map(c => new URLSearchParams(c.path.split('?')[1]));
const facts = (page, id) => page.locator(`.job-row[data-job-id="${id}"] .meta`).evaluate(meta =>
  ['job-place', 'job-work', 'job-distance'].map(kind => meta.querySelector('.' + kind)?.textContent ?? null));
async function openFilters(page, size) {
  if (size === PHONE) await page.getByRole('button', {name:'Filters', exact:true}).tap();
  else await page.locator('#filters > summary').click();
}
async function closeFilters(page, size) { if (size === PHONE) await page.getByRole('button', {name:'Done', exact:true}).tap(); }

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: each saved job says where it is, how it is worked and how far from home`, async () => {
    const {page, context} = await openScreen(browser, 'career-job-lists.html', lists(KNOWN), at(size));
    try {
      await page.locator('.job-row[data-job-id="12"]').waitFor();
      assert.deepEqual(await facts(page, 12), ['Redmond, OR', 'On-site', '24.9 mi from home']);
      assert.deepEqual(await facts(page, 13), ['Sisters, OR', 'Hybrid', '25.1 mi from home']);
      assert.deepEqual(await facts(page, 17), ['Remote - US', 'Fully remote', null], 'a fully remote job has no trip to measure');
      assert.deepEqual(await facts(page, 20), ['Location unknown', null, null], 'a posting that names no place says so');
      assert.equal(await page.locator('.job-row').filter({hasText:'Location unavailable'}).count(), 0);
      assert.equal(await page.locator('#jobsHomeLine').isVisible(), false, 'nothing to set when Career knows the home');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'nothing is wider than the screen');
      await shot(page, `my-jobs-places-${label}`);
    } finally { await context.close(); }
  });

  test(`${label}: Within and Distance from home are asked of the server, which answers every page`, async () => {
    const {page, context, calls} = await openScreen(browser, 'career-job-lists.html', lists(KNOWN), at(size));
    try {
      await page.locator('.job-row[data-job-id="12"]').waitFor();
      await openFilters(page, size);
      assert.deepEqual(await page.locator('#within option').allTextContents(), ['Any distance', '10 miles', '25 miles', '50 miles', '100 miles', 'Remote only']);
      await page.locator('#within').selectOption('25');
      await page.waitForFunction(() => /within=25/.test(location.search));
      await page.locator('#sort').selectOption('distance');
      await page.waitForFunction(() => /sort=distance/.test(location.search));
      await shot(page, `my-jobs-within-${label}`);
      await closeFilters(page, size);
      const asked = jobsAsked(calls);
      assert.ok(asked.some(q => q.get('within') === '25' && q.get('status') === 'saved'), 'Within 25 miles is a request, not a page filter');
      assert.ok(asked.some(q => q.get('within') === '25' && q.get('sort') === 'distance'), 'and nearest first goes with it');
    } finally { await context.close(); }
  });

  test(`${label}: with no home one line says so, Set your home opens Matching area, and what needs a home is off`, async () => {
    const {page, context} = await openScreen(browser, 'career-job-lists.html', lists(UNKNOWN), at(size));
    try {
      const line = page.locator('#jobsHomeLine');
      await line.waitFor({state:'visible'});
      assert.match(await line.innerText(), /^Set your home city or ZIP to see how far each job is from you\. Set your home$/);
      const link = line.getByRole('link', {name:'Set your home'});
      assert.equal(await link.getAttribute('href'), SETTINGS);
      assert.equal(await link.getAttribute('data-career-tool'), 'career-settings');
      if (size === PHONE) assert.ok((await link.boundingBox()).height >= 44, 'a 44px target on a phone');
      assert.deepEqual(await page.locator('#within option').evaluateAll(options => options.map(o => [o.value, o.disabled])),
        [['', false], ['10', true], ['25', true], ['50', true], ['100', true], ['remote', false]]);
      assert.equal(await page.locator('#sort option[value="distance"]').evaluate(option => option.disabled), true, 'Distance from home is off');
      assert.deepEqual(await facts(page, 12), ['Redmond, OR', 'On-site', null], 'the place is there, the miles are not');
      await shot(page, `my-jobs-no-home-${label}`);
    } finally { await context.close(); }
  });

  test(`${label}: a remembered distance with no home says why and how to fix it`, async () => {
    const {page, context} = await openScreen(browser, 'career-job-lists.html', lists(UNKNOWN), at(size), '?within=25');
    try {
      await page.locator('#jobsHomeLine').waitFor({state:'visible'});
      await page.waitForFunction(() => document.getElementById('requestState').textContent.length > 0);
      const said = await page.locator('#requestState').innerText();
      assert.match(said, /Matching area/);
      assert.doesNotMatch(said, /Could not update jobs|home_location_required/);
      await page.getByRole('button', {name:'Clear filters'}).first().waitFor();
    } finally { await context.close(); }
  });
}

test('the stages of Applications have no Within and no Distance from home', async () => {
  const {page, context} = await openScreen(browser, 'career-job-lists.html', lists(KNOWN), at(DESKTOP), '?view=status');
  try {
    await page.locator('#list').waitFor();
    await page.locator('#filters > summary').click();
    assert.equal(await page.locator('label:has(> #within)').isVisible(), false);
    assert.equal(await page.locator('#sort option[value="distance"]').evaluate(o => o.hidden), true);
  } finally { await context.close(); }
});

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: Settings opened at ?section=matching shows What I'm looking for with Matching area, and Settings goes back`, async () => {
    const {page, context} = await openScreen(browser, 'career-settings.html', () => ({json:{}}), at(size), '?section=matching');
    try {
      await page.locator('#scopeNear').waitFor({state:'visible'});
      assert.equal(await page.evaluate(() => document.documentElement.dataset.settingsSection), 'matching');
      assert.equal(await page.locator('.settings-home').isVisible(), false);
      await page.locator('#sectionBack').click();
      await page.locator('.settings-home').waitFor({state:'visible'});
      assert.equal(await page.evaluate(() => location.search), '', 'the section leaves the address');
      assert.equal(await page.locator('#scopeNear').isVisible(), false);
    } finally { await context.close(); }
  });
}
