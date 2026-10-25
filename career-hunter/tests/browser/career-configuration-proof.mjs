/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise actual configuration health and LinkedIn import UI with bounded synthetic owner data and intercepted upload requests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, startFixture } from './career-theme-fixture.mjs';

test('configuration exposes actual refresh state, separate private job imports and source coverage', async t => {
  let refreshFailed = false, imported = false, nativeMode = false;
  const fixture = await startFixture({ respond: req => {
    if (req.path === '/career-hunter/run/refresh') return refreshFailed
      ? { status: 503, body: { error: 'Refresh status unavailable' } }
      : { body: { running: true, lastCompletedAt: '2026-10-23T20:00:00Z', corpusFreshAt: '2026-10-24T08:00:00Z',
        ...(nativeMode ? { refreshMode: 'installation-managed', manualRefreshAvailable: false } : {}) } };
    if (req.path === '/career-hunter/artifacts') return { body: { importedJobs: imported
      ? [{ id: '123', title: '<script>IT manager</script>', company: 'Local College', url: 'https://www.linkedin.com/jobs/view/123/' }]
      : [] } };
  } });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  t.after(async () => { await context.close(); await browser.close(); await fixture.close(); });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== fixture.origin) return route.abort();
    if (url.pathname.endsWith('/static/career-local-sources.json')) return route.fulfill({ json: { sources: [
      { name: 'Local School District', category: 'Schools', url: 'https://example.edu/jobs', status: 'Official vacancies · external only' },
    ] } });
    if (url.pathname.endsWith('/artifacts/upload')) {
      assert.equal(route.request().method(), 'POST');
      assert.match(route.request().postData(), /linkedin-jobs/); imported = true;
      return route.fulfill({ json: { ok: true, imported: 1, new: 1, updated: 0, total: 1 } });
    }
    return route.continue();
  });
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(fixture.origin + '/api/career-hunter/settings');
  await page.waitForFunction(() => document.getElementById('refreshHealth').textContent.includes('A refresh is running'));
  assert.match(await page.locator('#refreshHealth').innerText(), /2026-10-23T20:00:00Z/);
  assert.match(await page.locator('#communitySourceList').innerText(), /external only/);
  assert.match(await page.locator('#linkedinJobsStatus').innerText(), /0 imported/);
  assert.match(await page.locator('#linkedinJobs').innerText(), /does not automatically download LinkedIn recommendations/);
  await page.locator('#linkedinJobsImport').click();
  assert.match(await page.locator('#linkedinJobsStatus').innerText(), /Choose the Saved Jobs CSV/);
  await page.locator('#linkedinJobsFile').setInputFiles({ name: 'Saved Jobs.csv', mimeType: 'text/csv', buffer: Buffer.from('Job Title,Company,Job URL\nIT Manager,Local College,https://www.linkedin.com/jobs/view/123/\n') });
  await page.locator('#linkedinJobsImport').click();
  await page.waitForFunction(() => document.getElementById('linkedinJobsStatus').textContent.includes('1 new, 0 updated'));
  assert.equal(await page.locator('#linkedinJobsList a').textContent(), '<script>IT manager</script> · Local College');
  assert.equal(await page.locator('#linkedinJobsList script').count(), 0);
  refreshFailed = true; await page.locator('#checkRefreshHealth').click();
  await page.waitForFunction(() => document.getElementById('refreshHealth').textContent.includes('Could not check'));
  assert.match(await page.locator('#refreshHealth').innerText(), /Refresh status unavailable/);
  refreshFailed = false; nativeMode = true; await page.locator('#checkRefreshHealth').click();
  await page.waitForFunction(() => document.getElementById('runPull').disabled);
  assert.match(await page.locator('#refreshHealth').innerText(), /installation manages shared-source refreshes/);
  assert.equal(await page.locator('#targetAdd').isDisabled(), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  assert.deepEqual(fixture.requests.filter(row => !['GET', 'HEAD'].includes(row.method)), []);
});
