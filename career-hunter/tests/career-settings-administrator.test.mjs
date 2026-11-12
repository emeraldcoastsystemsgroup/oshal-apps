/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 14's last line: Settings showed the job-source controls to every person (Sources and pull health, Pull jobs now, Jobs per score pass, the AI model, the Firecrawl key). The shipped tools/career-settings.html runs in Chromium over fixture answers: a person the Companies route refuses sees one button under Check for new jobs now, which starts the same check, and Email updates without the two engine cards; a person it admits sees every control as before; a route that cannot be asked leaves the job seeker's view. The Companies route is the one the catalog binds to career.administer, which this file also reads.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Review of 1.55.0, item 3: where the installation refreshes the shared job sources (GET /run/refresh answers manualRefreshAvailable false) an administrator sees no Pull jobs now, on a computer and on a phone, and keeps the other controls; where a pull can be started from the page the button is there and starts one; a job seeker has it on neither. The fixture takes who refreshes the sources, and the case that lists every administrator control runs where the pull is available. Seen failing on the code as it was: the administrator's list held Pull jobs now on an installation-managed installation.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openScreen, playwright, PHONE, DESKTOP } from './helpers/ux-page.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/**
 * Fixture answers in the shapes the routes give. `companies` is what the administrator's route says to this person. `pull` is
 * who refreshes the shared job sources: 'installation' (the native kernel: GET /run/refresh says a pull cannot be started here,
 * to everyone) or 'application' (the page may start one, for an administrator only, as the route decides).
 */
function settings(companies, pull = 'installation') {
  return ({ method, url }) => {
    const path = url.pathname;
    if (path === '/api/career-hunter/companies-admin') return companies === 'admitted' ? { text: '<!doctype html>' } : companies === 'refused' ? { status: 403, json: { error: 'forbidden' } } : { status: 500, json: {} };
    if (path === '/api/career-hunter/run/refresh') return { json: pull === 'application'
      ? { running: false, corpusFreshAt: null, lastCompletedAt: null, manualRefreshAvailable: companies === 'admitted', refreshMode: 'application-managed' }
      : { running: false, refreshMode: 'installation-managed', manualRefreshAvailable: false, observationAvailable: false } };
    if (path === '/api/career-hunter/run/pull' && method === 'POST') return { json: { ok: true } };
    if (path === '/api/career-hunter/run/score' && method === 'POST') return { json: { started: true, limit: 50 } };
    if (path === '/api/career-hunter/title-profile/state') return { json: { remoteOnly: false, titleTerms: ['Office manager'] } };
    if (path === '/api/v1/agent/schedules') return { json: { schedules: [] } };
    return { json: {} };
  };
}
/** The words of `selector` as a person sees them: text a style hides is left out, and a style's capitals are not applied. */
const shownText = (page, selector) => page.locator(selector).evaluateAll((nodes) => {
  const text = (node) => [...node.childNodes].map((child) => (child.nodeType === 3 ? child.textContent
    : child.nodeType === 1 && getComputedStyle(child).display !== 'none' ? text(child) : '')).join('');
  return nodes.filter((node) => node.offsetParent !== null).map((node) => text(node).replace(/\s+/g, ' ').trim()).filter(Boolean);
});
/** The words of the controls a person can see in the open section. */
const seen = (page) => shownText(page, '[data-section] h2, [data-section] button, [data-section] label, [data-section] a.btn');
const ENGINE = [/Sources & pull health/, /Pull jobs now/, /Jobs per score pass/, /Score fresh now/, /Check refresh status/, /^AI model$/, /Firecrawl/, /Source configuration/];

for (const [size, name] of [[DESKTOP, 'a computer'], [PHONE, 'a phone']]) {
  test(`on ${name} a job seeker has one button under Check for new jobs now and no job-source control`, async () => {
    const { page, context, calls } = await openScreen(browser, 'career-settings.html', settings('refused'), size, '#refresh');
    try {
      await page.locator('#checkNow').waitFor();
      await page.waitForFunction(() => document.querySelector('#refreshHealth').textContent.startsWith('Shared job pulls'));
      const words = await seen(page);
      for (const control of ENGINE) assert.equal(words.some((word) => control.test(word)), false, `${control} is the administrator's: ${words.join(' | ')}`);
      assert.deepEqual(await shownText(page, '#checkNow button'), ['Check for new jobs now']);
      assert.deepEqual(await shownText(page, '#checkNow h2'), ['Check for new jobs now']);
      assert.equal(await page.locator('#scoreLimit').isVisible(), false);
      await page.locator('#runScore').click();
      await page.waitForFunction(() => /Score accepted/.test(document.querySelector('#runOut').textContent));
      assert.deepEqual(calls.filter((call) => call.method === 'POST' && call.path === '/api/career-hunter/run/score').map((call) => call.body), [{ limit: 50 }], 'the one button starts the same check');
      await page.getByRole('button', { name: '‹ Settings' }).click();
      const home = page.getByRole('list', { name: 'Settings sections' });
      await home.waitFor();
      assert.deepEqual(await shownText(page, '.settings-home a[data-open="refresh"] small, .settings-home a[data-open="keys"] small'), ['Look again and see how applications are prepared', 'Replies about your applications']);
      await home.getByRole('link', { name: /^Email updates/ }).click();
      await page.locator('#mailEnable').waitFor();
      const keys = await seen(page);
      for (const control of ENGINE) assert.equal(keys.some((word) => control.test(word)), false, `${control} is the administrator's: ${keys.join(' | ')}`);
      assert.ok(keys.includes('Application email updates'));
      assert.equal(await page.locator('#firecrawlKey').isVisible(), false);
    } finally { await context.close(); }
  });
}

test('an administrator keeps every job-source control', async () => {
  const { page, context } = await openScreen(browser, 'career-settings.html', settings('admitted', 'application'), DESKTOP, '#refresh');
  try {
    await page.locator('#adminSources').waitFor();
    const words = await seen(page);
    for (const control of ['Sources & pull health', 'Pull jobs now', 'Score fresh now', 'Check refresh status', 'Refresh', 'Source configuration & pull health (administrator)']) assert.ok(words.includes(control), `${control}: ${words.join(' | ')}`);
    assert.ok(words.some((word) => /^Jobs per score pass/.test(word)));
    assert.equal(words.includes('Check for new jobs now'), false, 'the administrator\'s button keeps its own word');
    assert.equal(await page.locator('#scoreLimit').isVisible(), true);
    assert.equal(await page.locator('#checkNow details.help').isVisible(), true, 'the long explanation is still one line with the rest under Help');
    await page.getByRole('button', { name: '‹ Settings' }).click();
    const home = page.getByRole('list', { name: 'Settings sections' });
    await home.waitFor();
    assert.deepEqual(await shownText(page, '.settings-home a[data-open="refresh"] small, .settings-home a[data-open="keys"] small'),
      ['Look again, see how the last check went, and see how applications are prepared', 'Replies about your applications, and the AI and web search Career uses']);
    await home.getByRole('link', { name: /^Email updates/ }).click();
    await page.locator('#firecrawlKey').waitFor();
    const keys = await seen(page);
    for (const control of ['AI model', 'Firecrawl (optional)', 'Application email updates']) assert.ok(keys.includes(control), `${control}: ${keys.join(' | ')}`);
  } finally { await context.close(); }
});

for (const [size, name] of [[DESKTOP, 'a computer'], [PHONE, 'a phone']]) {
  test(`on ${name} an administrator sees no Pull jobs now where the installation refreshes the shared job sources itself`, async () => {
    const { page, context, calls } = await openScreen(browser, 'career-settings.html', settings('admitted'), size, '#refresh');
    try {
      await page.locator('#adminSources').waitFor();
      await page.waitForFunction(() => document.querySelector('#refreshHealth').textContent.startsWith('Shared job pulls'));
      const words = await seen(page);
      assert.equal(words.includes('Pull jobs now'), false, `a button its route always refuses is not offered: ${words.join(' | ')}`);
      assert.equal(await page.locator('#runPull').isVisible(), false);
      for (const control of ['Score fresh now', 'Check refresh status', 'Source configuration & pull health (administrator)']) assert.ok(words.includes(control), `${control} is still the administrator's: ${words.join(' | ')}`);
      assert.equal(await page.locator('#scoreLimit').isVisible(), true);
      assert.ok(!calls.some((call) => call.method === 'POST' && call.path === '/api/career-hunter/run/pull'));
    } finally { await context.close(); }
  });
}

test('an administrator still has Pull jobs now where a pull can be started from this page, and it starts one', async () => {
  const { page, context, calls } = await openScreen(browser, 'career-settings.html', settings('admitted', 'application'), DESKTOP, '#refresh');
  try {
    await page.locator('#adminSources').waitFor();
    await page.waitForFunction(() => document.querySelector('#refreshHealth').textContent.startsWith('No refresh is running.'));
    const pull = page.getByRole('button', { name: 'Pull jobs now', exact: true });
    assert.equal(await pull.isVisible(), true);
    assert.equal(await pull.isEnabled(), true);
    await pull.click();
    await page.waitForFunction(() => document.querySelector('#runOut').textContent === 'Done.');
    assert.deepEqual(calls.filter((call) => call.method === 'POST' && call.path === '/api/career-hunter/run/pull').map((call) => call.body), [{}]);
  } finally { await context.close(); }
});

test('a job seeker has no Pull jobs now on either kind of installation', async () => {
  for (const pull of ['installation', 'application']) {
    const { page, context } = await openScreen(browser, 'career-settings.html', settings('refused', pull), DESKTOP, '#refresh');
    try {
      await page.locator('#checkNow').waitFor();
      await page.waitForFunction(() => /^(Shared job pulls|No refresh is running\.)/.test(document.querySelector('#refreshHealth').textContent));
      assert.equal(await page.locator('#runPull').isVisible(), false, pull);
    } finally { await context.close(); }
  }
});

test('when the route cannot be asked the page stays as a job seeker sees it', async () => {
  const { page, context } = await openScreen(browser, 'career-settings.html', settings('broken'), DESKTOP, '#refresh');
  try {
    await page.locator('#checkNow').waitFor();
    await page.waitForFunction(() => document.querySelector('#refreshHealth').textContent.startsWith('Shared job pulls'));
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-career-administrator')), false);
    assert.deepEqual(await shownText(page, '#checkNow button'), ['Check for new jobs now']);
    assert.equal(await page.locator('#sourceConfiguration').isVisible(), false);
  } finally { await context.close(); }
});

test('the route the page asks is the one the catalog binds to career.administer, and the controls\' own routes keep their bindings', () => {
  const page = readFileSync(resolve(root, 'tools/career-settings.html'), 'utf8');
  assert.match(page, /fetch\(API\+'\/companies-admin',\{headers:\{Accept:'application\/json'\},cache:'no-store'\}\)\.then\(r=>showAdministrator\(r\.ok\)\)\.catch\(\(\)=>showAdministrator\(false\)\)/);
  const catalog = readFileSync(resolve(root, 'authorization.yaml'), 'utf8');
  assert.match(catalog, /- \{ id: companies-admin-ui, method: GET, path: \/companies-admin, allOf: \[career\.administer\] \}/);
  // What a job seeker's own button and Settings itself still need: these are a person's own check and reads.
  assert.match(catalog, /- \{ id: run-verb, method: POST, path: \/run\/:verb, allOf: \[career\.execute\] \}/);
  assert.match(catalog, /- \{ id: run-refresh-state, method: GET, path: \/run\/refresh, allOf: \[career\.read\] \}/);
});
