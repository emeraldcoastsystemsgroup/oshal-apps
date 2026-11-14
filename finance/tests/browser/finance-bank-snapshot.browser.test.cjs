/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the shipped bank snapshot with synthetic API and Link replies; distinguish saved data, sync and explicit analysis without real accounts or network access.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Model independently persisted snapshot and brief dates through Sync, explicit analysis and reload; first Sync never invents a saved analysis.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Pin declared unknown and mixed-currency snapshot display contracts and an explicit stale-analysis refusal using synthetic API replies.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Guard incomplete and unknown transaction coverage through actual saved readers, analysis or rendered views without changing independent balances.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.6.4: the kernel ending a slow analysis with only a status code reads as a sentence, never HTTP 503 (judge defect 4), with the true wait and one press at a time; spending categories read as words (judge defect 11).
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 1.6.5: Request analysis answered at once while the analyst works after the press. The panel says working above the earlier analysis, which stays until the new one is saved; the page asks every five seconds (the browser's clock is driven by the test) and shows the new analysis, or the failure in words with the earlier analysis kept; opening the page during a request shows the same without asking for anything new; a failure newer than the saved analysis is said on opening and an older one is not; and a phone's width holds it.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..');
const PAGE = process.env.FINANCE_BANK_HTML || path.join(ROOT, 'finance/tools/finance.html');
const KERNEL = path.resolve(ROOT, '../oshal-kernel/platform/src');
const { chromium } = require(path.join(ROOT, 'scripts/toolchain/node_modules/playwright'));
const ORIGIN = 'http://bank-snapshot.fixture.test';
const STAMP = '2026-11-10T18:15:00.000Z';
const BRIEF_STAMP = '2026-11-09T17:05:00.000Z';
const SYNC_STAMP = '2026-11-12T19:00:00.000Z';
const REFRESH_STAMP = '2026-11-12T19:05:00.000Z';
const status = () => ({ configured: true, env: 'sandbox', connected: 1, hasData: true,
  items: [{ itemId: 'synthetic-item', institution: 'Example Bank', linkedAt: STAMP }], syncedAt: STAMP });
const summary = () => ({ syncedAt: STAMP, aggregate: { currency: 'USD', sourceEnvironment: 'sandbox',
  netWorth: { assets: null, liabilities: 0, net: null },
  accounts: [{ name: 'Everyday', institution: 'Example Bank', type: 'depository', balance: null },
    { name: 'Zero balance', institution: 'Example Bank', type: 'depository', balance: 0 },
    { name: 'Loan', institution: 'Example Bank', type: 'loan', balance: null }],
  holdings: [], topSpending: [], notes: [] } });

/** Serve real HTML and record every synthetic request. */
async function openFixture(browser, options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'UTC' });
  const requests = [], errors = [];
  let snapshot = structuredClone(options.summary || summary());
  let brief = options.noBrief ? null : { brief: '## Account observations\nSaved fixture commentary.', briefAt: BRIEF_STAMP };
  // What the saved read carries about the latest analysis request, and what each later ask answers, in order.
  let analysis = options.analysis || null;
  const polls = [...(options.polls || [])];
  await context.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url());
    requests.push(`${req.method()} ${url.pathname}${url.search}`);
    if (url.origin !== ORIGIN) return route.abort();
    const json = (body, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/finance/') return route.fulfill({ contentType: 'text/html', path: PAGE });
    if (url.pathname === '/api/finance/status') return json({ ...status(), ...options.status });
    if (url.pathname === '/api/finance/summary') return options.failReadAfterSync && requests.includes('POST /api/finance/sync') ? json({ message: 'Snapshot could not be read.' }, 503) : json(snapshot);
    if (url.pathname === '/api/finance/brief') return brief ? json({ ...brief, cached: true, ...(analysis ? { analysis } : {}) }) : json({ error: 'no_saved_brief', ...(analysis ? { analysis } : {}) }, 404);
    if (url.pathname === '/api/finance/brief/analysis' && polls.length) {
      analysis = polls.length > 1 ? polls.shift() : polls[0];
      if (analysis.state === 'done') brief = { brief: '## New analysis\nBackground fixture commentary.', briefAt: REFRESH_STAMP };
      return json({ analysis });
    }
    if (url.pathname === '/api/finance/brief/refresh') {
      if (options.background) { analysis = { state: 'working', requestedAt: SYNC_STAMP, finishedAt: null, message: null }; return json({ analysis }, 202); }
      if (options.briefConflict) return json({ error: 'snapshot_changed', message: 'The account snapshot changed while analysis was running. The previous saved analysis is unchanged. Request analysis again.' }, 409);
      if (options.failBrief) return json({ message: 'The example analyst did not answer.' }, 502);
      if (options.kernelCut) {
        options.briefPresses = (options.briefPresses || 0) + 1;
        await new Promise((resolve) => setTimeout(resolve, 400));
        return options.kernelCut === 'code' ? json({ error: 'store_unavailable' }, 503) : route.fulfill({ status: 503, contentType: 'text/plain', body: '' });
      }
      brief = { brief: '## New analysis\nExplicit fixture commentary.', briefAt: REFRESH_STAMP };
      return json({ ...brief, cached: false });
    }
    if (url.pathname === '/api/finance/sync') {
      if (options.failSync) return json({ error: 'fixture_sync_refused', message: 'Example Bank did not answer.' }, 502);
      snapshot.syncedAt = SYNC_STAMP;
      return json({ ok: true });
    }
    if (url.pathname === '/api/finance/payments') return json({ payments: [] });
    if (url.pathname === '/api/finance/link-token') return json({ linkToken: 'synthetic-link-token' });
    if (url.pathname === '/api/finance/exchange') return json({ institution: 'Example Bank' });
    if (url.pathname === '/cockpit/js/app-handoff.js') return route.fulfill({ contentType: 'application/javascript', body: 'export function receiveHandoff(){}' });
    if (url.pathname === '/cockpit/js/app-workflows.js') return route.fulfill({ contentType: 'application/javascript', body: 'export async function mountConnectedActions(){}' });
    if (url.pathname.startsWith('/shared/ui/css/') && fs.existsSync(path.join(KERNEL, url.pathname))) return route.fulfill({ contentType: 'text/css', path: path.join(KERNEL, url.pathname) });
    if (url.pathname.endsWith('.css')) return route.fulfill({ contentType: 'text/css', body: ':root{--bg-primary:#101827;--bg-card:#162238;--bg-tertiary:#22314b;--border-color:#526073;--text-primary:#eef3ff;--text-muted:#bdc9da;--text-secondary:#c7d3e6}' });
    if (url.pathname.endsWith('.js')) return route.fulfill({ contentType: 'application/javascript', body: '' });
    return json({ error: 'unexpected_fixture_request' }, 404);
  });
  await context.addInitScript(({ oauth }) => {
    window.Plaid = { create: (options) => { window.fixtureLinkOptions = options; return { open: () => options.onSuccess('synthetic-public-token') }; } };
    if (oauth) localStorage.setItem('finance.plaidLink', JSON.stringify({ token: 'synthetic-resume-token', at: Date.now() }));
  }, { oauth: options.oauth });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  // The page asks about a working analysis on a timer; a test that waits on it drives the browser's clock.
  if (options.clock) await page.clock.install();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${ORIGIN}/api/finance/${options.oauth ? '?oauth_state_id=synthetic-resume' : options.banks ? '?view=banks' : ''}`, { waitUntil: 'networkidle' });
  return { page, context, requests, errors };
}

let browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

test('saved snapshot has dated source, unknown balances stay unknown and opening only reads', async () => {
  const f = await openFixture(browser);
  try {
    assert.match(await f.page.locator('body').innerText(), /Test bank data/);
    assert.match(await f.page.locator('body').innerText(), /Snapshot saved/);
    assert.equal(await f.page.locator('.stat').filter({ hasText: 'net worth' }).locator('.n').textContent(), 'Unknown');
    assert.equal(await f.page.locator('tr').filter({ hasText: 'Everyday' }).locator('td.num').textContent(), 'Unknown');
    assert.equal(await f.page.locator('tr').filter({ hasText: 'Loan' }).locator('td.num').textContent(), 'Unknown');
    assert.equal(await f.page.locator('tr').filter({ hasText: 'Zero balance' }).locator('td.num').textContent(), '$0');
    assert.match(await f.page.locator('#briefPanel').innerText(), /Saved analysis/);
    assert.match(await f.page.locator('#briefPanel').innerText(), /Nov 9, 2026/);
    assert.deepEqual(f.requests.filter((r) => !r.startsWith('GET ')), []);
    assert.deepEqual(f.errors, []);
    if (process.env.FINANCE_SHOTS) { fs.mkdirSync(process.env.FINANCE_SHOTS, { recursive: true }); await f.page.screenshot({ path: path.join(process.env.FINANCE_SHOTS, 'bank-snapshot-desktop.png'), fullPage: true }); }
  } finally { await f.context.close(); }
});

test('Sync accounts refreshes only the snapshot; analysis requires its own click', async () => {
  const f = await openFixture(browser);
  try {
    const saved = f.page.waitForResponse((r) => /\/brief(?:\/refresh)?$/.test(new URL(r.url()).pathname));
    await f.page.getByRole('button', { name: 'Sync accounts', exact: true }).click();
    await saved;
    assert.equal(f.requests.filter((r) => r === 'POST /api/finance/sync').length, 1);
    assert.equal(f.requests.filter((r) => r === 'POST /api/finance/brief/refresh').length, 0, 'sync must not commission analysis');
    assert.match(await f.page.locator('.snapshot-date').innerText(), /Nov 12, 2026/);
    assert.match(await f.page.locator('#briefPanel').innerText(), /Nov 9, 2026/);
    assert.match(await f.page.locator('#briefPanel').innerText(), /analysis was saved before the account snapshot/);
    await f.page.reload({ waitUntil: 'networkidle' });
    assert.match(await f.page.locator('#briefPanel').innerText(), /Saved fixture commentary\./);
    assert.match(await f.page.locator('#briefPanel').innerText(), /Nov 9, 2026/);
    await f.page.getByRole('button', { name: 'Request analysis', exact: true }).click();
    await f.page.getByText('Explicit fixture commentary.').waitFor();
    assert.equal(f.requests.filter((r) => r === 'POST /api/finance/brief/refresh').length, 1);
    assert.match(await f.page.locator('#briefPanel').innerText(), /Nov 12, 2026.*7:05 PM/);
    assert.equal(await f.page.locator('.analysis-stale').count(), 0);
    await f.page.reload({ waitUntil: 'networkidle' });
    assert.match(await f.page.locator('#briefPanel').innerText(), /Explicit fixture commentary\./);
    assert.match(await f.page.locator('#briefPanel').innerText(), /Nov 12, 2026.*7:05 PM/);
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test('Sync without prior analysis keeps the truthful no-saved-analysis notice', async () => {
  const f = await openFixture(browser, { noBrief: true });
  try {
    await f.page.getByRole('button', { name: 'Sync accounts', exact: true }).click();
    await f.page.getByText('Account snapshot refreshed. Saved analysis has not been changed.').waitFor();
    assert.match(await f.page.locator('#briefPanel').innerText(), /No saved analysis yet/);
    assert.equal(f.requests.filter((r) => r === 'POST /api/finance/brief/refresh').length, 0);
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test('a refused sync preserves the saved snapshot and gives an explicit retry', async () => {
  const f = await openFixture(browser, { failSync: true });
  try {
    await f.page.getByRole('button', { name: 'Sync accounts', exact: true }).click();
    await f.page.getByText('Example Bank did not answer.').waitFor();
    assert.equal(await f.page.locator('table.accounts tr').filter({ hasText: 'Everyday' }).isVisible(), true);
    assert.equal(await f.page.getByRole('button', { name: 'Sync accounts', exact: true }).isEnabled(), true);
    assert.equal(f.requests.filter((r) => r === 'POST /api/finance/brief/refresh').length, 0);
  } finally { await f.context.close(); }
});

test('linking a synthetic institution performs its initial sync without commissioning analysis', async () => {
  const f = await openFixture(browser, { banks: true });
  try {
    const saved = f.page.waitForResponse((r) => /\/brief(?:\/refresh)?$/.test(new URL(r.url()).pathname));
    await f.page.getByRole('button', { name: 'Add account', exact: true }).click();
    await saved;
    assert.equal(f.requests.filter((r) => r === 'POST /api/finance/exchange').length, 1);
    assert.equal(f.requests.filter((r) => r === 'POST /api/finance/sync').length, 1);
    assert.equal(f.requests.filter((r) => r === 'POST /api/finance/brief/refresh').length, 0);
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test('unconfigured linked-bank screen explains unavailable linking without enabling it', async () => {
  const f = await openFixture(browser, { banks: true, status: { configured: false } });
  try {
    assert.equal(await f.page.getByRole('button', { name: 'Add account', exact: true }).isDisabled(), true);
    assert.match(await f.page.locator('body').innerText(), /Bank linking is not set up/);
    assert.deepEqual(f.requests.filter((r) => !r.startsWith('GET ')), []);
  } finally { await f.context.close(); }
});

test('a 412 px bank snapshot has readable controls without document overflow', async () => {
  const f = await openFixture(browser, { viewport: { width: 412, height: 915 } });
  try {
    const targets = f.page.getByRole('button', { name: /^(Sync accounts|Request analysis)$/ });
    assert.equal(await targets.count(), 2);
    for (const box of await targets.evaluateAll((nodes) => nodes.map((n) => ({ width: n.getBoundingClientRect().width, height: n.getBoundingClientRect().height })))) assert.ok(box.width >= 44 && box.height >= 44);
    assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.deepEqual(f.errors, []);
    if (process.env.FINANCE_SHOTS) { fs.mkdirSync(process.env.FINANCE_SHOTS, { recursive: true }); await f.page.screenshot({ path: path.join(process.env.FINANCE_SHOTS, 'bank-snapshot-phone.png'), fullPage: true }); }
  } finally { await f.context.close(); }
});

test('malformed saved values stay unknown and account labels are rendered as text', async () => {
  const saved = summary();
  saved.syncedAt = 'not-a-date';
  saved.aggregate.sourceEnvironment = null;
  saved.aggregate.netWorth = {};
  saved.aggregate.accounts = [{ name: '<b>Literal account</b>', institution: '<i>Example</i>', type: 'loan', balance: 'not-a-number' }];
  const f = await openFixture(browser, { summary: saved });
  try {
    assert.match(await f.page.locator('body').innerText(), /Source unknown/);
    assert.match(await f.page.locator('body').innerText(), /Snapshot date unknown/);
    assert.match(await f.page.locator('body').innerText(), /<b>Literal account<\/b>/);
    assert.equal(await f.page.locator('table.accounts b, table.accounts i').count(), 0);
    assert.equal(await f.page.locator('tr').filter({ hasText: 'Literal account' }).locator('td.num').textContent(), 'Unknown');
    assert.doesNotMatch(await f.page.locator('body').innerText(), /NaN|Invalid Date/);
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test('failed explicit analysis retains its dated saved result and remains retryable', async () => {
  const f = await openFixture(browser, { failBrief: true });
  try {
    await f.page.getByRole('button', { name: 'Request analysis', exact: true }).click();
    await f.page.getByText('The example analyst did not answer.').waitFor();
    assert.match(await f.page.locator('#briefPanel').innerText(), /Saved fixture commentary\./);
    assert.equal(await f.page.getByRole('button', { name: 'Request analysis', exact: true }).isEnabled(), true);
    assert.equal(await f.page.locator('table.accounts tr').filter({ hasText: 'Everyday' }).isVisible(), true);
    assert.equal(f.requests.filter((r) => r === 'POST /api/finance/sync').length, 0);
  } finally { await f.context.close(); }
});

for (const kernelCut of ['empty', 'code']) {
  test(`the kernel ending a slow analysis (${kernelCut} 503) reads as a sentence, never a status code, and one press runs at a time`, async () => {
    const options = { kernelCut };
    const f = await openFixture(browser, options);
    try {
      const button = f.page.getByRole('button', { name: 'Request analysis', exact: true });
      await button.click();
      const waiting = await f.page.locator('#briefPanel [role="status"]').first().innerText();
      const busy = await button.isDisabled();
      await f.page.locator('#briefPanel .notice.err').waitFor();
      const text = await f.page.locator('#briefPanel').innerText();
      assert.doesNotMatch(text, /HTTP 503|store_unavailable/, 'the judge read "HTTP 503" here (defect 4)');
      assert.match(text, /The analysis did not finish, so nothing was saved\. Your earlier analysis, if any, is unchanged\. Try Request analysis again in a few minutes\./);
      assert.match(waiting, /Your finance analyst is reading your saved accounts\. This can take up to a minute\./);
      assert.equal(busy, true, 'a second press cannot start while one runs');
      assert.match(text, /Saved fixture commentary\./, 'the saved analysis stays on screen');
      assert.equal(await button.isEnabled(), true);
      assert.equal(options.briefPresses, 1);
      assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
  });
}

test('OAuth return resumes the real Link flow without a new link-token or automatic analysis', async () => {
  const f = await openFixture(browser, { oauth: true });
  try {
    assert.equal(await f.page.evaluate(() => window.fixtureLinkOptions.token), 'synthetic-resume-token');
    assert.match(await f.page.evaluate(() => window.fixtureLinkOptions.receivedRedirectUri), /oauth_state_id=synthetic-resume/);
    assert.equal(new URL(f.page.url()).search, '');
    assert.equal(f.requests.filter((r) => r === 'POST /api/finance/link-token').length, 0);
    assert.equal(f.requests.filter((r) => r === 'POST /api/finance/exchange').length, 1);
    assert.equal(f.requests.filter((r) => r === 'POST /api/finance/sync').length, 1);
    assert.equal(f.requests.filter((r) => r === 'POST /api/finance/brief/refresh').length, 0);
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test('a successful link followed by refused sync states both outcomes', async () => {
  const f = await openFixture(browser, { banks: true, failSync: true });
  try {
    await f.page.getByRole('button', { name: 'Add account', exact: true }).click();
    await f.page.getByText('Bank linked. Sync failed: Example Bank did not answer.').waitFor();
    assert.equal(await f.page.locator('table.accounts tr').filter({ hasText: 'Everyday' }).isVisible(), true);
    assert.equal(f.requests.filter((r) => r === 'POST /api/finance/brief/refresh').length, 0);
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test('a failed read after sync keeps the dated saved account context', async () => {
  const f = await openFixture(browser, { failReadAfterSync: true });
  try {
    await f.page.getByRole('button', { name: 'Sync accounts', exact: true }).click();
    await f.page.getByText('Snapshot could not be read.').waitFor();
    assert.equal(await f.page.locator('table.accounts tr').filter({ hasText: 'Everyday' }).isVisible(), true);
    assert.match(await f.page.locator('.snapshot-date').innerText(), /Nov 10, 2026/);
    assert.equal(await f.page.getByRole('button', { name: 'Sync accounts', exact: true }).isEnabled(), true);
    assert.equal(f.requests.filter((r) => r === 'POST /api/finance/brief/refresh').length, 0);
  } finally { await f.context.close(); }
});


test('declared mixed-currency contract withholds tiles while preserving known account units', async () => {
  const saved = summary(); saved.aggregate.netWorth = { assets: null, liabilities: null, net: null };
  saved.aggregate.accounts = [{ name: 'Dollar account', type: 'depository', balance: 100, currency: 'USD' }, { name: 'Euro account', type: 'depository', balance: 100, currency: 'EUR' }];
  const f = await openFixture(browser, { summary: saved });
  try {
    assert.equal(await f.page.locator('.stat').filter({ hasText: 'net worth' }).locator('.n').textContent(), 'Unknown');
    assert.deepEqual(await f.page.locator('table.accounts td.num').allTextContents(), ['$100', '€100']);
    assert.deepEqual(f.requests.filter(r => !r.startsWith('GET ')), []); assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test('analysis conflict visibly preserves the previous dated analysis and permits retry', async () => {
  const f = await openFixture(browser, { briefConflict: true });
  try {
    await f.page.getByRole('button', { name: 'Request analysis', exact: true }).click();
    await f.page.getByText(/The account snapshot changed while analysis was running/).waitFor();
    const text = await f.page.locator('#briefPanel').innerText();
    assert.match(text, /Saved fixture commentary/); assert.match(text, /Nov 9, 2026/);
    assert.doesNotMatch(text, /Nov 12, 2026.*7:05/);
    assert.equal(await f.page.getByRole('button', { name: 'Request analysis', exact: true }).isEnabled(), true);
    assert.equal(f.requests.filter(r => r === 'POST /api/finance/brief/refresh').length, 1); assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});


for (const width of [412, 1280]) for (const state of ['partial', 'unknown', 'complete']) {
  test(`${width}px bank page distinguishes ${state} coverage from complete spending`, async () => {
    const saved = summary(), a = saved.aggregate;
    a.transactionsComplete = state === 'complete';
    a.transactionCoverage = { state, returned: 2000, total: state === 'unknown' ? null : state === 'partial' ? 2501 : 2000,
      institutions: [{ institution: 'Example', state, returned: 2000, total: state === 'complete' ? 2000 : 2501, pages: 4, reason: state === 'complete' ? null : 'page_limit' }] };
    a.topSpending = [{ category: '<b>Available category</b>', total: 25000, count: 2000 }];
    a.spendByMonth = [{ month: '2026-10', spend: 25000, income: 0 }];
    const f = await openFixture(browser, { summary: saved, viewport: { width, height: 915 } });
    try {
      const text = await f.page.locator('body').innerText();
      if (state === 'complete') { assert.equal(await f.page.locator('table').filter({ hasText: 'Category' }).count(), 1); assert.match(await f.page.locator('#main').textContent(), /\$25,000/); }
      else {
        assert.match(text, new RegExp(`Transaction coverage is ${state}`, 'i'));
        assert.match(text, /Full-window spending and income totals are unavailable/);
        assert.doesNotMatch(await f.page.locator('#main').textContent(), /\$25,000/);
        assert.equal(await f.page.locator('table').filter({ hasText: 'Category' }).count(), 0);
        if (state === 'partial') assert.match(text, /2,000 of 2,501/);
      }
      assert.equal(await f.page.locator('tr').filter({ hasText: 'Zero balance' }).locator('td.num').textContent(), '$0');
      assert.equal(await f.page.locator('table b').count(), 0);
      assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(f.requests.filter(r => !r.startsWith('GET ')), []); assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
  });
}


test('spending categories read as words, never the bank\'s codes, in every view of the page', async () => {
  const saved = summary(), a = saved.aggregate;
  Object.assign(a, { transactionsComplete: true, transactionCoverage: { state: 'complete', returned: 3, total: 3,
    institutions: [{ institution: 'Example', state: 'complete', returned: 3, total: 3, pages: 1, reason: null }] },
  topSpending: [{ category: 'TRANSFER_OUT', total: 300, count: 1 }, { category: 'LOAN_PAYMENTS', total: 200, count: 1 },
    { category: 'FOOD_AND_DRINK', total: 50, count: 1 }, { category: 'SOME_NEW_CODE', total: 5, count: 1 }, { category: 'Coffee shops', total: 4, count: 1 }] });
  const f = await openFixture(browser, { summary: saved });
  try {
    const table = await f.page.locator('table').filter({ hasText: 'Category' }).textContent();
    for (const words of ['Transfers out', 'Loan payments', 'Food and drink', 'Some new code', 'Coffee shops']) assert.match(table, new RegExp(words));
    assert.doesNotMatch(table, /TRANSFER_OUT|LOAN_PAYMENTS|FOOD_AND_DRINK|SOME_NEW_CODE/, 'judge defect 11: codes printed as they arrive');
    const html = fs.readFileSync(PAGE, 'utf8');
    assert.equal((html.match(/label: financeCategoryName\(t\.category\)/g) || []).length, 1, 'the household and company views name categories the same way');
    assert.equal((html.match(/financeCategoryName\(t\.category\)/g) || []).length, 2, 'their recent activity too');
    assert.deepEqual(f.requests.filter(r => !r.startsWith('GET ')), []); assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});


for (const row of [{ state: 'complete', returned: 1, total: 1, pages: 1, reason: null },
  { institution: 'Example', state: 'complete', returned: 1, total: 1, pages: 4, reason: null }]) {
  test(`bank page refuses invalid complete evidence ${JSON.stringify(row)}`, async () => {
    const saved = summary(); Object.assign(saved.aggregate, { transactionsComplete: true,
      transactionCoverage: { state: 'complete', returned: 1, total: 1, institutions: [row] },
      topSpending: [{ category: 'Unverified category', total: 25000, count: 1 }] });
    const f = await openFixture(browser, { summary: saved, viewport: { width: 412, height: 915 } });
    try {
      const text = await f.page.locator('#main').textContent();
      assert.match(text, /Transaction coverage is unknown/); assert.doesNotMatch(text, /\$25,000/);
      assert.deepEqual(f.requests.filter(r => !r.startsWith('GET ')), []); assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
  });
}


test('bank coverage notice lets an unknown institution override a contradictory partial count', async () => {
  const saved = summary(); Object.assign(saved.aggregate, { transactionsComplete: false,
    transactionCoverage: { state: 'partial', returned: 1, total: 10,
      institutions: [{ institution: 'Example', state: 'unknown', returned: 1, total: null, pages: 1, reason: 'unknown_total' }] } });
  const f = await openFixture(browser, { summary: saved });
  try {
    const text = await f.page.locator('#main').textContent();
    assert.match(text, /Transaction coverage is unknown/); assert.doesNotMatch(text, /1 of 10/);
    assert.deepEqual(f.requests.filter(r => !r.startsWith('GET ')), []); assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});


const WORKING = /Your finance analyst is working on a new analysis/;
const LATE = 'Your finance analyst did not answer within 5 minutes, so nothing was saved. Your earlier analysis, if any, is unchanged. Try Request analysis again later.';
const view = (state, extra = {}) => ({ state, requestedAt: SYNC_STAMP, finishedAt: null, message: null, ...extra });
const requestButton = (f) => f.page.getByRole('button', { name: 'Request analysis', exact: true });
const analysisAsks = (f) => f.requests.filter((r) => r === 'GET /api/finance/brief/analysis').length;
const analysisPresses = (f) => f.requests.filter((r) => r === 'POST /api/finance/brief/refresh').length;
/** Let five seconds pass in the browser and wait for the page's next ask to be answered and painted. */
async function nextAsk(f) {
  const answered = f.page.waitForResponse((r) => new URL(r.url()).pathname === '/api/finance/brief/analysis');
  await f.page.clock.fastForward(5000);
  await answered;
  await new Promise((resolve) => setTimeout(resolve, 150));
}

test('Request analysis answered at once: working is said above the earlier analysis until the new one is saved', async () => {
  const f = await openFixture(browser, { clock: true, background: true, polls: [view('working'), view('done', { finishedAt: REFRESH_STAMP })] });
  try {
    await requestButton(f).click();
    await f.page.getByText(WORKING).waitFor();
    let text = await f.page.locator('#briefPanel').innerText();
    assert.match(text, /Saved fixture commentary/, 'the earlier analysis stays visible');
    assert.match(text, /Nov 9, 2026/);
    assert.equal(await requestButton(f).isDisabled(), true, 'one request at a time');
    assert.equal(await f.page.locator('#syncIcon').isDisabled(), true);
    assert.equal(analysisAsks(f), 0, 'the page waits before it asks');
    await nextAsk(f);
    text = await f.page.locator('#briefPanel').innerText();
    assert.match(text, WORKING); assert.match(text, /Saved fixture commentary/);
    assert.equal(await requestButton(f).isDisabled(), true);
    await nextAsk(f);
    await f.page.getByText('Background fixture commentary.').waitFor();
    text = await f.page.locator('#briefPanel').innerText();
    assert.doesNotMatch(text, WORKING); assert.doesNotMatch(text, /Saved fixture commentary/);
    assert.match(text, /Saved Nov 12, 2026/);
    assert.equal(await requestButton(f).isEnabled(), true);
    assert.equal(await f.page.locator('#syncIcon').isEnabled(), true);
    await f.page.clock.fastForward(30000);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(analysisAsks(f), 2, 'the page stops asking once the analysis is saved');
    assert.equal(analysisPresses(f), 1); assert.deepEqual(f.errors, []);
    if (process.env.FINANCE_SHOTS) await f.page.screenshot({ path: path.join(process.env.FINANCE_SHOTS, 'analysis-saved-desktop.png'), fullPage: true });
  } finally { await f.context.close(); }
});

test('an analysis that fails after the press says so in words and keeps the earlier analysis', async () => {
  const f = await openFixture(browser, { clock: true, background: true, polls: [view('failed', { finishedAt: REFRESH_STAMP, message: LATE })] });
  try {
    await requestButton(f).click();
    await f.page.getByText(WORKING).waitFor();
    await nextAsk(f);
    await f.page.getByText(LATE).waitFor();
    const text = await f.page.locator('#briefPanel').innerText();
    assert.doesNotMatch(text, WORKING); assert.doesNotMatch(text, /HTTP \d|undefined/);
    assert.match(text, /Saved fixture commentary/); assert.match(text, /Nov 9, 2026/);
    assert.doesNotMatch(text, /Background fixture commentary/, 'nothing new was saved');
    assert.equal(await requestButton(f).isEnabled(), true, 'the person can ask again');
    await f.page.clock.fastForward(30000);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(analysisAsks(f), 1); assert.equal(analysisPresses(f), 1); assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

test('opening the page while a request is working shows it, presses nothing and shows the analysis once saved', async () => {
  const f = await openFixture(browser, { clock: true, analysis: view('working'), polls: [view('done', { finishedAt: REFRESH_STAMP })] });
  try {
    await f.page.getByText(WORKING).waitFor();
    assert.match(await f.page.locator('#briefPanel').innerText(), /Saved fixture commentary/);
    assert.equal(await requestButton(f).isDisabled(), true);
    await nextAsk(f);
    await f.page.getByText('Background fixture commentary.').waitFor();
    assert.doesNotMatch(await f.page.locator('#briefPanel').innerText(), WORKING);
    assert.equal(await requestButton(f).isEnabled(), true);
    assert.deepEqual(f.requests.filter((r) => !r.startsWith('GET ')), [], 'opening and waiting only read');
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

for (const [when, said] of [[REFRESH_STAMP, true], ['2026-11-08T10:00:00.000Z', false]]) {
  test(`a request that failed ${said ? 'after' : 'before'} the saved analysis ${said ? 'is said' : 'is not said'} when the page opens`, async () => {
    const f = await openFixture(browser, { analysis: view('failed', { requestedAt: when, finishedAt: when, message: LATE }) });
    try {
      const text = await f.page.locator('#briefPanel').innerText();
      assert.equal(text.includes(LATE), said);
      assert.match(text, /Saved fixture commentary/);
      assert.equal(await requestButton(f).isEnabled(), true);
      assert.equal(analysisAsks(f), 0, 'a closed request is not asked about again');
      assert.deepEqual(f.requests.filter((r) => !r.startsWith('GET ')), []); assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
  });
}

test('412px: a first analysis working with none saved yet fits the screen', async () => {
  const f = await openFixture(browser, { clock: true, background: true, noBrief: true, polls: [view('working')], viewport: { width: 412, height: 915 } });
  try {
    await requestButton(f).click();
    await f.page.getByText(WORKING).waitFor();
    const text = await f.page.locator('#briefPanel').innerText();
    assert.match(text, /No saved analysis yet/);
    assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll');
    await nextAsk(f);
    assert.match(await f.page.locator('#briefPanel').innerText(), WORKING);
    assert.equal(analysisPresses(f), 1); assert.deepEqual(f.errors, []);
    if (process.env.FINANCE_SHOTS) await f.page.screenshot({ path: path.join(process.env.FINANCE_SHOTS, 'analysis-working-phone.png'), fullPage: true });
  } finally { await f.context.close(); }
});
