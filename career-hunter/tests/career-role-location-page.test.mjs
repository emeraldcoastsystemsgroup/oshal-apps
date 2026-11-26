/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane CAREER-LOCATION (BACKLOG "A role's location"). The shipped Work history page in Chromium at 1440x900 and 412x915, over Career's real compiled résumé route module and the real engine programs on a made-up person (tests/helpers/career-years-fixture.mjs): a job's card shows where it was on its own line under its months, and a job with none shows no such line; Edit has an optional Location box under Employer with its one line of help; a location typed there is saved with the job's Save and shown on the card, Undo puts back the exact earlier file, a cleared box takes the location away, a new job saves its own, and a client engagement's form has a Location box whose value shows on the engagement's card. On the phone the box is at least 44 px tall with 16 px text and nothing is wider than the screen.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { packageRoot, yearsHarness } from './helpers/career-years-fixture.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [path.resolve(packageRoot, '../scripts/toolchain')] }));
const h = yearsHarness('career-role-location-page');
let browser, origin;
before(async () => { origin = await h.start({ page: true }); browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); await h.stop(); });

/** A made-up person: a current job with no location, an employer with one, a client engagement in the ledger. */
function person() {
  return {
    profile: { name: 'Jordan Placeholder', headline: 'Operations lead', experience_summary: 'Made-up summary.', clearance: 'None' },
    roles: [
      { id: 'r1', title: 'Operations Lead', org: 'Example Freight Co', start: '2020-02', end: null, deliverables: ['Ran the dispatch floor.'], skills: ['Logistics'] },
      { id: 'r2', title: 'Senior Consultant', org: 'Sample Advisory Group', start: '2015-05', end: '2020-01', location: 'Denver, CO', deliverables: ['Led eleven assessments.'] },
    ],
    project_ledger: [{ project: 'Fixture Health Network', role: 'Lead analyst', start: '2018-02', end: '2018-09', job: 'r2' }],
    skills: { Core: { items: ['Logistics'] } },
  };
}
async function open(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600 });
  const page = await context.newPage(), errors = [], outside = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : (outside.push(route.request().url()), route.abort())));
  await page.goto(origin + '/api/career-hunter/work-history');
  await page.locator('#whJobs .wh-job').first().waitFor({ timeout: 15000 });
  return { page, context, errors, outside };
}
const card = (page, title) => page.locator('#whJobs > .wh-job', { has: page.getByRole('heading', { name: title, exact: true }) });
const where = (page, title) => card(page, title).locator('.wh-where').allInnerTexts();
const changed = (page, text) => page.locator('#careerChangeBar').getByText(text, { exact: true }).waitFor({ timeout: 15000 });

for (const [width, height] of [[1440, 900], [412, 915]]) {
  test(`${width}x${height}: a job's location is typed on Edit, saved, shown on its card, undone, cleared, and given to a new job`, async () => {
    h.reset('jobs-' + width, person());
    const preimage = h.text(), { page, context, errors, outside } = await open(width, height);
    try {
      assert.deepEqual(await where(page, 'Senior Consultant'), ['Denver, CO'], 'where the job was, on its own line');
      assert.deepEqual(await where(page, 'Operations Lead'), [], 'a job with no location shows no such line');
      assert.match(await card(page, 'Senior Consultant').locator('.wh-meta').first().innerText(), /^Sample Advisory Group · May 2015 – Jan 2020$/);
      await card(page, 'Operations Lead').getByRole('button', { name: 'Edit Operations Lead' }).click();
      const form = page.locator('.wh-form'), box = form.getByLabel('Location', { exact: true });
      assert.equal(await box.inputValue(), '');
      assert.equal(await box.getAttribute('placeholder'), 'City, State');
      assert.equal(await page.locator('#' + await box.getAttribute('aria-describedby')).innerText(), 'Optional. Where you did this job, as employer forms ask for it: Austin, TX or Remote.');
      assert.equal(await box.evaluate((input) => input.required), false, 'optional');
      const order = await form.locator('input[name=title], input[name=org], input[name=location]').evaluateAll((inputs) => inputs.map((input) => input.name));
      assert.deepEqual(order, ['title', 'org', 'location'], 'under Employer');
      if (width < 600) {
        const fit = await box.evaluate((input) => ({ height: input.getBoundingClientRect().height, font: getComputedStyle(input).fontSize, right: input.getBoundingClientRect().right }));
        assert.ok(fit.height >= 44, 'at least 44 px tall: ' + fit.height);
        assert.equal(fit.font, '16px');
        assert.ok(fit.right <= width, 'inside the screen');
      }
      await box.fill('Austin, TX');
      await form.getByRole('button', { name: 'Save', exact: true }).click();
      await changed(page, 'Saved Operations Lead at Example Freight Co.');
      assert.equal(h.saved().roles[0].location, 'Austin, TX');
      assert.deepEqual(await where(page, 'Operations Lead'), ['Austin, TX']);
      await page.locator('#careerChangeBar').getByRole('button', { name: 'Undo', exact: true }).click();
      await changed(page, 'Put back. Your work history is as it was.');
      assert.equal(h.text(), preimage, 'Undo puts back the exact earlier file');
      assert.deepEqual(await where(page, 'Operations Lead'), []);
      await card(page, 'Senior Consultant').getByRole('button', { name: 'Edit Senior Consultant' }).click();
      assert.equal(await page.locator('.wh-form').getByLabel('Location', { exact: true }).inputValue(), 'Denver, CO');
      await page.locator('.wh-form').getByLabel('Location', { exact: true }).fill('');
      await page.locator('.wh-form').getByRole('button', { name: 'Save', exact: true }).click();
      await changed(page, 'Saved Senior Consultant at Sample Advisory Group.');
      assert.equal('location' in h.saved().roles[1], false, 'a cleared box takes the location away');
      assert.deepEqual(await where(page, 'Senior Consultant'), []);
      await page.getByRole('button', { name: 'Add a job' }).click();
      const added = page.locator('.wh-form');
      await added.getByLabel('Job title').fill('Director of Operations'); await added.getByLabel('Employer').fill('Example Harbor Co');
      await added.getByLabel('Location', { exact: true }).fill('Mobile, AL');
      await added.getByLabel('Start month').selectOption('10'); await added.getByLabel('Start year').fill('2026');
      await added.getByRole('button', { name: 'Add this job' }).click();
      await changed(page, 'Added Director of Operations at Example Harbor Co.');
      assert.deepEqual([h.saved().roles[0].title, h.saved().roles[0].location], ['Director of Operations', 'Mobile, AL']);
      assert.deepEqual(await where(page, 'Director of Operations'), ['Mobile, AL']);
      assert.equal(await page.evaluate(() => document.scrollingElement.scrollWidth), width, 'nothing is wider than the screen');
      assert.deepEqual([errors, outside], [[], []]);
    } finally { await context.close(); }
  });

  test(`${width}x${height}: a client engagement's form has a Location box and its card shows the saved value`, async () => {
    h.reset('engagement-' + width, person());
    const { page, context, errors } = await open(width, height);
    try {
      const engagement = page.locator('.wh-eng', { has: page.getByRole('heading', { name: 'Fixture Health Network' }) });
      await engagement.getByRole('button', { name: 'Edit Fixture Health Network' }).click();
      const form = page.locator('.wh-eng-form'), box = form.getByLabel('Location', { exact: true });
      assert.equal(await box.getAttribute('placeholder'), 'City, State');
      await box.fill('Houston, TX');
      await form.getByRole('button', { name: 'Save engagement' }).click();
      await changed(page, 'Saved Fixture Health Network.');
      assert.equal(h.saved().project_ledger[0].location, 'Houston, TX');
      const shown = page.locator('.wh-eng', { has: page.getByRole('heading', { name: 'Fixture Health Network' }) });
      assert.match(await shown.locator('.wh-meta').first().innerText(), /^Lead analyst · Houston, TX · Feb 2018 – Sep 2018$/);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
