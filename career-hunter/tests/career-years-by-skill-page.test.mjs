/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.24 (Roger, 2026-11-19: "i have to be able to generate accurate resumes ... i cant have random numbers 2 years vs 11 years vs 20 years getting out of place"). The shipped Work history page's Years by skill section in Chromium at 1440x900 and 412x915, over Career's real compiled résumé route module and the real engine programs on a made-up person (tests/helpers/career-years-fixture.mjs). It names every label the person reads, shows the server's rows, refuses a bad figure in the server's words with nothing saved, saves three figures and a total and then shows what the server answered, and Undo puts the exact earlier file back; nothing is wider than the screen at either size, and on the phone every control is at least 44 px tall with 16 px text. A skill name that holds markup is drawn as text. Figures typed and not yet saved survive a job saved on the same page. A person with no main résumé sees no section.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { packageRoot, yearsHarness } from './helpers/career-years-fixture.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [path.resolve(packageRoot, '../scripts/toolchain')] }));
const h = yearsHarness('career-years-page');
let browser, origin;
before(async () => { origin = await h.start({ page: true }); browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); await h.stop(); });

async function open(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600 });
  const page = await context.newPage(), errors = [], outside = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : (outside.push(route.request().url()), route.abort())));
  await page.goto(origin + '/api/career-hunter/work-history');
  await page.locator('#whJobs .wh-job').first().waitFor({ timeout: 15000 });
  return { page, context, errors, outside };
}
/** The table as a person reads it: skill, counted from the roles, the figure in the box, used on résumés. */
const table = (page) => page.locator('#yrRows tr').evaluateAll((rows) => rows.map((row) => [row.cells[0].textContent, row.cells[1].textContent, row.querySelector('input').value, row.cells[3].textContent]));
/**
 * Nothing wider than the screen, measured against the width the screen was given: a phone browser widens innerWidth
 * to fit a page that overflows, so innerWidth cannot be the measure. On a phone also every control's height and text size.
 */
const fit = (page, width) => page.evaluate((screen) => {
  const section = document.getElementById('whYears'), controls = [...section.querySelectorAll('input, button')].filter((el) => el.offsetParent);
  const name = (el) => el.id || el.getAttribute('aria-label');
  return { sideways: Math.max(0, document.scrollingElement.scrollWidth - screen),
    outside: [...section.querySelectorAll('*')].filter((el) => el.offsetParent && (el.getBoundingClientRect().right > screen + 0.5 || el.getBoundingClientRect().left < -0.5)).map((el) => el.tagName),
    short: controls.filter((el) => el.getBoundingClientRect().height < 44).map(name),
    small: controls.filter((el) => el.tagName === 'INPUT' && parseFloat(getComputedStyle(el).fontSize) < 16).map(name) };
}, width);

const java = (page) => page.getByLabel('Your figure for Java', { exact: true });
const saveYears = (page) => page.getByRole('button', { name: 'Save years' }).click();
const savedNotice = (page) => page.locator('#yrNotice', { hasText: 'Saved.' }).waitFor();

/** Every label the person reads, the server's rows and total, and the fit of the section at this width. */
async function reads(page, width) {
  const section = page.locator('#whYears'), phone = width < 600;
  assert.equal(await section.locator('h2').innerText(), 'Years by skill');
  assert.equal(await section.locator('h2 + p').innerText(), 'Résumés and cover letters state these years exactly. Where you give no figure, Career counts the years from your roles.');
  assert.deepEqual(await section.locator('thead th').allTextContents(), ['Skill', 'From your roles', 'Your figure', 'Used on résumés']);
  assert.deepEqual(await section.locator('legend').allTextContents(), ['Add a skill', 'Years of experience in total']);
  assert.deepEqual(await section.locator('.wh-years-total > :is(div, label)').evaluateAll((items) => items.map((item) => item.firstChild.textContent)), ['From your roles', 'Your figure', 'Used on résumés']);
  assert.deepEqual(await page.locator('#yrRows tr').first().locator('td').evaluateAll((cells) => cells.map((cell) => cell.dataset.label)), ['From your roles', 'Your figure', 'Used on résumés'], 'a phone card names each value');
  assert.equal(await page.getByRole('button', { name: 'Save years' }).count(), 1);
  assert.equal(await page.locator('#yrUndo').isHidden(), true, 'Undo is offered after a save');
  assert.deepEqual(await table(page), [
    ['Python', '3.5 years', '10', '10 years'], ['SAP NetWeaver Java', 'Not in your roles', '6.5', '6.5 years'], ['Java', '5 years', '', 'Up to 5 years'],
    ['SQL', '5 years', '', 'Up to 5 years'], ['Docker', '3.5 years', '', 'Up to 3 years'], ['Linux', '1 year', '', 'No year count (under 2 years)']]);
  assert.deepEqual([await page.locator('#yrCareerRoles').innerText(), await page.locator('#yrCareerYours').inputValue(), await page.locator('#yrCareerUsed').innerText()], ['9.5 years', '15', '15 years']);
  const seen = await fit(page, width);
  assert.deepEqual([seen.sideways, seen.outside], [0, []], 'nothing is wider than the screen');
  if (phone) assert.deepEqual([seen.short, seen.small], [[], []], 'on a phone every control is at least 44 px tall and every box has 16 px text');
  assert.doesNotMatch(await page.locator('body').innerText(), /oshal/i, 'no technical name in what a person reads');
}

/** One bad figure: the whole save is refused in the server's words, and nothing is written. */
async function refuses(page, before) {
  await java(page).fill('61');
  assert.equal((await table(page))[2][3], 'Not saved yet', 'a typed figure is not shown as used before it is saved');
  await saveYears(page);
  await page.locator('#yrNotice', { hasText: 'The years of row 3 (Java) must be from 0.5 to 60, in steps of 0.5; it is 61. Nothing was saved.' }).waitFor();
  assert.deepEqual([h.text(), await java(page).inputValue()], [before, '61'], 'nothing saved; what was typed stays');
  // A box that holds something that is not a number is never read as an empty box (which would remove the figure).
  await java(page).fill('');
  for (const [box, words] of [[page.getByLabel('Your figure for Python'), 'The years of row 1 (Python) must be a number from 0.5 to 60, in steps of 0.5. Nothing was saved.'],
    [page.locator('#yrCareerYours'), 'Your years of experience in total must be a number from 1 to 70, in steps of 0.5. Nothing was saved.']]) {
    const held = await box.inputValue();
    await box.focus();
    await page.keyboard.press('End');
    await page.keyboard.type('e');
    assert.equal(await box.evaluate((input) => input.validity.badInput), true, 'the browser holds "10e" as no number');
    await saveYears(page);
    await page.locator('#yrNotice', { hasText: words }).waitFor();
    assert.equal(h.text(), before, 'the person\'s figure is not removed');
    await box.fill(held);
  }
}

/** Three figures and a total: one changed, one cleared (empty is none), one added; then the table is the server's. */
async function saves(page, width) {
  await java(page).fill('11.5');
  await page.getByLabel('Your figure for Python').fill('');
  await page.locator('#yrAddSkill').fill('Kubernetes');
  await page.locator('#yrAddYears').fill('3');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  assert.deepEqual((await table(page)).at(-1), ['Kubernetes', 'Counted when you save', '3', 'Not saved yet']);
  await page.locator('#yrCareerYours').fill('19');
  if (width < 600) assert.deepEqual(await fit(page, width), { sideways: 0, outside: [], short: [], small: [] }, 'with an added card too');
  await saveYears(page);
  await page.locator('#yrNotice', { hasText: 'Saved. Your next résumé and cover letter state these years.' }).waitFor();
  assert.deepEqual([h.saved().years_by_skill, h.saved().career_years], [[{ skill: 'SAP NetWeaver Java', years: 6.5 }, { skill: 'Java', years: 11.5 }, { skill: 'Kubernetes', years: 3 }], 19]);
  const { body: served } = await h.read();
  assert.deepEqual(await table(page), served.rows.map((row) => [row.skill, row.from_roles === null ? 'Not in your roles' : `${row.from_roles} ${row.from_roles === 1 ? 'year' : 'years'}`, row.yours === null ? '' : String(row.yours), row.used_words]), 'the table is what the server answers');
  assert.deepEqual((await table(page)).slice(0, 2), [['Java', '5 years', '11.5', '11.5 years'], ['SAP NetWeaver Java', 'Not in your roles', '6.5', '6.5 years']]);
  assert.deepEqual([await page.locator('#yrCareerYours').inputValue(), await page.locator('#yrCareerUsed').innerText()], ['19', '19 years']);
}

/** The figures are there when the page is opened again; a later save is taken back by the Undo that save offers. */
async function reloadsAndUndoes(page) {
  await page.reload();
  await page.locator('#yrRows tr').first().waitFor();
  assert.deepEqual([await java(page).inputValue(), await page.getByLabel('Your figure for Kubernetes').inputValue(), await page.getByLabel('Your figure for Python').inputValue(), await page.locator('#yrCareerYours').inputValue()], ['11.5', '3', '', '19']);
  const sql = page.getByLabel('Your figure for SQL');
  await sql.fill('7');
  await saveYears(page);
  await savedNotice(page);
  const kept = h.text();
  assert.equal(h.saved().years_by_skill.length, 4);
  await sql.fill('8');
  await saveYears(page);
  await savedNotice(page);
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.locator('#yrNotice', { hasText: 'Undone. Your years are as they were before that save.' }).waitFor();
  assert.equal(h.text(), kept, 'Undo puts back the exact earlier file');
  assert.deepEqual([await page.getByLabel('Your figure for SQL').inputValue(), await page.locator('#yrUndo').isHidden()], ['7', true]);
}

for (const [width, height] of [[1440, 900], [412, 915]]) {
  test(`the section reads, refuses in the server's words, saves, shows the server's answer and undoes at ${width}x${height}`, async () => {
    h.reset(`page-${width}`);
    const before = h.text(), { page, context, errors, outside } = await open(width, height);
    try {
      await page.locator('#yrRows tr').first().waitFor();
      await reads(page, width);
      await refuses(page, before);
      await saves(page, width);
      await reloadsAndUndoes(page);
      assert.deepEqual([errors, outside], [[], []]);
    } finally { await context.close(); }
  });
}

test('a skill name that holds markup is drawn as text, a long one wraps inside a phone card, and the script builds no markup from data', async () => {
  h.reset('markup');
  const { page, context, errors } = await open(412, 915), name = '<img src=x onerror="document.title=\'pwned\'"><b>Rust</b>';
  try {
    await page.locator('#yrRows tr').first().waitFor();
    await page.locator('#yrAddSkill').fill(name);
    await page.locator('#yrAddYears').fill('4');
    await page.locator('#yrAddYears').press('Enter');
    assert.deepEqual((await table(page)).at(-1), [name, 'Counted when you save', '4', 'Not saved yet'], 'Enter in the Add a skill boxes adds the row');
    await page.getByRole('button', { name: 'Save years' }).click();
    await page.locator('#yrNotice', { hasText: 'Saved.' }).waitFor();
    assert.deepEqual(h.saved().years_by_skill.at(-1), { skill: name, years: 4 });
    const row = page.locator('#yrRows tr', { hasText: 'onerror' });
    assert.deepEqual([await row.locator('th').textContent(), await row.locator('img, b').count(), await page.title()], [name, 0, 'Work history']);
    assert.deepEqual(await fit(page, 412), { sideways: 0, outside: [], short: [], small: [] }, 'a 44-character run without a space wraps inside its card');
    assert.doesNotMatch(fs.readFileSync(path.join(packageRoot, 'tools/career-years-by-skill.js'), 'utf8'), /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('figures typed and not saved survive a job saved on the same page, and then save on the revision that job left', async () => {
  h.reset('kept');
  const { page, context, errors } = await open(1440, 900);
  try {
    await page.locator('#yrRows tr').first().waitFor();
    await page.getByLabel('Your figure for Java').fill('12');
    await page.locator('#yrAddSkill').fill('Terraform');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByLabel('Your figure for Terraform').fill('2.5');
    await page.locator('#yrCareerYours').fill('20');
    await page.getByRole('button', { name: 'Edit Support Analyst' }).click();
    await page.locator('.wh-editing input[name=title]').fill('Support Engineer');
    await page.locator('.wh-editing button[type=submit]').click();
    await page.locator('#whJobs h2', { hasText: 'Support Engineer' }).waitFor();
    assert.equal(h.saved().roles[2].title, 'Support Engineer');
    assert.deepEqual([await page.getByLabel('Your figure for Java').inputValue(), await page.getByLabel('Your figure for Terraform').inputValue(), await page.locator('#yrCareerYours').inputValue()], ['12', '2.5', '20'], 'what was typed is still in the boxes');
    await page.getByRole('button', { name: 'Save years' }).click();
    await page.locator('#yrNotice', { hasText: 'Saved.' }).waitFor();
    assert.deepEqual([h.saved().years_by_skill, h.saved().career_years, h.saved().roles[2].title],
      [[{ skill: 'Python', years: 10 }, { skill: 'SAP NetWeaver Java', years: 6.5 }, { skill: 'Java', years: 12 }, { skill: 'Terraform', years: 2.5 }], 20, 'Support Engineer']);
    // Work history follows the revision this form left: its next job save is not sent on a stale one.
    const held = h.digest(h.text()), sent = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/resume/master-edit'));
    await page.getByRole('button', { name: 'Edit Support Engineer' }).click();
    await page.locator('.wh-editing input[name=title]').fill('Support Lead');
    await page.locator('.wh-editing button[type=submit]').click();
    assert.equal(JSON.parse((await sent).postData()).revision, held, 'the job is saved on the revision the years save left');
    await page.locator('#whJobs h2', { hasText: 'Support Lead' }).waitFor();
    assert.deepEqual([h.saved().roles[2].title, h.saved().career_years, await page.locator('#yrCareerYours').inputValue()], ['Support Lead', 20, '20']);
    assert.equal(await page.locator('#yrUndo').isHidden(), true, 'the years Undo goes once the main résumé moved past that save');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('a person with no main résumé sees no Years by skill section', async () => {
  h.reset('none', null);
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true }), page = await context.newPage(), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(origin + '/api/career-hunter/work-history');
    await page.locator('#whEmpty').waitFor({ state: 'visible', timeout: 15000 });
    assert.deepEqual([await page.locator('#whYears').isHidden(), errors], [true, []]);
  } finally { await context.close(); }
});
