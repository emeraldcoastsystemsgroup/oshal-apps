/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise actual configuration health and LinkedIn import UI with bounded synthetic owner data and intercepted upload requests.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Verify unknown/native operation modes never expose unsupported legacy toggles or fetch their saved consent; managed mode describes exact-job review.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, startFixture } from './career-theme-fixture.mjs';

test('configuration exposes actual refresh state, separate private job imports and source coverage', async t => {
  let refreshFailed = false, imported = false, nativeMode = false;
  const fixture = await startFixture({ respond: req => {
    if (req.path === '/career-hunter/run/refresh') return refreshFailed
      ? { status: 503, body: { error: 'Refresh status unavailable' } }
      : { body: { running: true, refreshMode:'application-managed',lastCompletedAt: '2026-10-23T20:00:00Z', corpusFreshAt: '2026-10-24T08:00:00Z',
        ...(nativeMode ? { refreshMode: 'installation-managed', manualRefreshAvailable: false,
          observationAvailable:true,status:'running',enabled:true,lastOk:true,lastStartedAt:'2026-10-24T08:00:00Z',
          lastPublishedAt:'2026-10-23T20:00:00Z',lastPublication:{sources:{confirmed:3,unconfirmed:1}} } : {}) } };
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
  assert.equal(await page.locator('#legacyAutomation').isVisible(),true);
  assert.match(await page.locator('#communitySourceList').innerText(), /external only/);
  assert.match(await page.locator('#linkedinJobsStatus').innerText(), /0 imported/);
  assert.match(await page.locator('#linkedinJobs').innerText(), /does not automatically download LinkedIn recommendations/);
  await page.locator('#linkedinJobsImport').click();
  assert.match(await page.locator('#linkedinJobsStatus').innerText(), /Choose.*Saved Jobs CSV/);
  await page.locator('#linkedinJobsFile').setInputFiles({ name: 'Saved Jobs.csv', mimeType: 'text/csv', buffer: Buffer.from('Job Title,Company,Job URL\nIT Manager,Local College,https://www.linkedin.com/jobs/view/123/\n') });
  await page.locator('#linkedinJobsImport').click();
  await page.waitForFunction(() => document.getElementById('linkedinJobsStatus').textContent.includes('1 new, 0 updated'));
  assert.equal(await page.locator('#linkedinJobsList a').textContent(), '<script>IT manager</script> · Local College');
  assert.equal(await page.locator('#linkedinJobsList script').count(), 0);
  refreshFailed = true; await page.locator('#checkRefreshHealth').click();
  await page.waitForFunction(() => document.getElementById('refreshHealth').textContent.includes('Could not check'));
  assert.match(await page.locator('#refreshHealth').innerText(), /Refresh status unavailable/);
  assert.equal(await page.locator('#legacyAutomation').isVisible(),false);
  assert.equal(await page.locator('#autoSubmit').isDisabled(),true);
  assert.equal(await page.locator('#targetAdd').isDisabled(),true);
  refreshFailed = false; nativeMode = true; await page.locator('#checkRefreshHealth').click();
  await page.waitForFunction(() => document.getElementById('runPull').disabled);
  await page.waitForFunction(()=>document.getElementById('refreshHealth').textContent.includes('Pull running since'));
  assert.match(await page.locator('#refreshHealth').innerText(), /That publication reported 3 confirmed and 1 unconfirmed sources/);
  assert.ok(!fixture.requests.some(row=>row.path==='/api/admin/jobs'),'normal Career read status needs no operator jobs request');
  assert.equal(await page.locator('#targetAdd').isDisabled(), true);
  assert.equal(await page.locator('#legacyAutomation').isVisible(),false);
  assert.equal(await page.locator('#legacyDigest').isVisible(),false);
  assert.equal(await page.locator('#autoSave').isDisabled(),true);
  assert.match(await page.locator('#nativeWorkflow').innerText(),/that job's exact packet/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  assert.deepEqual(fixture.requests.filter(row => !['GET', 'HEAD'].includes(row.method)), []);
});

test('managed startup never reads legacy automation or digest settings and requires selected-job approval',async t=>{
  const fixture=await startFixture({respond:req=>req.path==='/career-hunter/run/refresh'
    ?{body:{refreshMode:'installation-managed',manualRefreshAvailable:false,observationAvailable:true,status:'idle',enabled:true,lastOk:true}}:undefined});
  const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:900}});
  t.after(async()=>{await context.close();await browser.close();await fixture.close();});
  await context.route('**/*',route=>new URL(route.request().url()).origin===fixture.origin?route.continue():route.abort());
  const page=await context.newPage();await page.goto(fixture.origin+'/api/career-hunter/settings');
  await page.locator('#nativeWorkflow').waitFor({state:'visible'});
  assert.equal(await page.locator('#legacyDigest').isVisible(),false);
  assert.equal(await page.locator('#legacyAutomation').isVisible(),false);
  assert.equal(await page.locator('#autoSubmit').isDisabled(),true);
  assert.ok(!fixture.requests.some(row=>/\/(?:automation|digest)\/(?:state|preview)$/.test(row.path)));
  assert.deepEqual(fixture.requests.filter(row=>!['GET','HEAD'].includes(row.method)),[]);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
});
